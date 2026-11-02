//! The scan: one walk, then per-subject work that streams results, then the
//! series-level pass. Also the lazy per-run detail, which reads files directly
//! so a run opened mid-scan does not wait for the scan.

use super::derivatives::{self, Coverage, Pipeline};
use super::events::{check_events, check_table, EventFiles};
use super::exclusions;
use super::fd::{self, fd_from, iqm_key, is_confounds, read_fd, run_key, FD_DEFINITION};
use super::fieldmap::{self, meta_f64};
use super::meta::{acquisition_values, SidecarResolver};
use super::remote::{self, Listing, RemoteDataset, RemoteFiles, ScanFiles};
use super::series::{self, NVOLUMES_KEY};
use super::store::{self, StoredIndex, SubjectCache, ValidatorCache};
use super::{
    entry_stamp, finding, is_image_extension, natural_cmp, parse_name, rel_text, rfc3339_utc,
    series_label, sha256_hex, FindingSpec, ParsedName,
};
use bids_rs::{
    BidsProject, ComplianceChecker, DerivativesMode, FileIndex, IndexEntry, IndexingOptions,
    ProjectManifest, SidecarContent,
};
use bridge_types::bids::*;
use serde_json::Value;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::SystemTime;

pub(crate) struct ScanRequest<'a> {
    pub dataset: &'a Path,
    pub scan_id: &'a str,
    /// Set for a remote mount: the dataset is read from the server. `dataset`
    /// stays the local path of its mirror, which images are materialized into.
    pub remote: Option<&'a dyn RemoteDataset>,
    pub cache_root: &'a Path,
}

/// Decides what a stopping scan may persist.
pub(crate) trait ScanControl {
    fn cancelled(&self) -> bool;
    /// False once a newer scan of this dataset took over.
    fn owns_index(&self) -> bool;
}

impl ScanControl for AtomicBool {
    fn cancelled(&self) -> bool {
        self.load(Ordering::Relaxed)
    }
    fn owns_index(&self) -> bool {
        true
    }
}

/// A raw image with everything known before reading any file.
struct RunSeed {
    name: ParsedName,
    subject: String,
    datatype: String,
    abs_path: PathBuf,
    rel_path: String,
    size: u64,
    modified: Option<SystemTime>,
    /// False for a dangling symlink, such as an annexed file not yet fetched.
    available: bool,
}

/// Image files of the raw tree, by subject. Companions and derivatives are not
/// runs; when both `.nii` and `.nii.gz` exist for a stem, one run is kept.
fn collect_runs(entries: &[IndexEntry]) -> BTreeMap<String, Vec<RunSeed>> {
    let mut by_subject: BTreeMap<String, Vec<RunSeed>> = BTreeMap::new();
    let mut seen = HashSet::new();
    for entry in entries {
        if entry.is_derivative {
            continue;
        }
        let Some(datatype) = entry.datatype_dir.clone() else {
            continue;
        };
        let name = entry
            .abs_path
            .file_name()
            .and_then(|n| n.to_str())
            .and_then(parse_name);
        let Some(name) = name.filter(|n| is_image_extension(&n.extension)) else {
            continue;
        };
        let Some(subject) = name.subject().map(str::to_string) else {
            continue;
        };
        if !seen.insert(name.stem.clone()) {
            continue;
        }
        by_subject
            .entry(subject.clone())
            .or_default()
            .push(RunSeed {
                subject,
                datatype,
                abs_path: entry.abs_path.clone(),
                rel_path: rel_text(&entry.rel_path),
                size: entry.size,
                modified: entry.modified,
                available: entry.is_available,
                name,
            });
    }
    for seeds in by_subject.values_mut() {
        seeds.sort_by(|a, b| natural_cmp(&a.rel_path, &b.rel_path));
    }
    by_subject
}

fn nifti_value(key: &str, value: Value) -> BidsMetaValue {
    BidsMetaValue {
        key: key.to_string(),
        value: value.to_string(),
        source: "NIfTI".to_string(),
        source_kind: "nifti".to_string(),
    }
}

fn read_header(path: &Path) -> Result<BidsHeaderSummary, String> {
    nifti_loader::read_header_summary(path)
        .map(bridge_header)
        .map_err(|e| e.to_string())
}

fn bridge_header(summary: nifti_loader::HeaderSummary) -> BidsHeaderSummary {
    BidsHeaderSummary {
        dim: summary.dim,
        pixdim: summary.pixdim,
        qform_code: summary.qform_code,
        sform_code: summary.sform_code,
        tr_seconds: summary.tr_seconds,
        n_volumes: summary.n_volumes,
    }
}

fn header_values(header: &BidsHeaderSummary) -> Vec<BidsMetaValue> {
    let spatial = |values: Vec<String>| values[..values.len().min(3)].join("x");
    let mut out = vec![
        nifti_value(
            "VoxelSize",
            Value::String(spatial(
                header.pixdim.iter().map(|v| format!("{v:.3}")).collect(),
            )),
        ),
        nifti_value(
            "Matrix",
            Value::String(spatial(header.dim.iter().map(u32::to_string).collect())),
        ),
    ];
    if let Some(volumes) = header.n_volumes {
        out.push(nifti_value(NVOLUMES_KEY, Value::from(volumes)));
    }
    if let Some(tr) = header.tr_seconds {
        out.push(nifti_value("pixdim[4]", Value::from(f64::from(tr))));
    }
    out
}

/// `<stem without the BIDS suffix>_events.tsv` beside the run, whether or not
/// it exists. Events are per run, so the `echo` and `part` of a multi-echo
/// series are not in their name. An inherited table still has this run's
/// metadata: sidecars resolve against this name, not the table's own.
fn events_path(run_path: &Path, name: &ParsedName) -> Option<PathBuf> {
    let prefix = name.stem.strip_suffix(&format!("_{}", name.suffix))?;
    let kept: Vec<&str> = prefix
        .split('_')
        .filter(|part| !part.starts_with("echo-") && !part.starts_with("part-"))
        .collect();
    Some(run_path.with_file_name(format!("{}_events.tsv", kept.join("_"))))
}

struct SubjectContext<'a> {
    remote: Option<&'a dyn RemoteDataset>,
    files: &'a ScanFiles,
    confounds: &'a HashMap<String, (PathBuf, usize)>,
    pipelines: &'a [Pipeline],
    known_files: &'a HashSet<String>,
    event_files: &'a EventFiles,
    listing_complete: bool,
}

#[derive(Default)]
struct SubjectResult {
    runs: Vec<BidsRunRecord>,
    findings: Vec<BidsFinding>,
    reads: u64,
    /// A remote read failed, which can pass: do not store this subject.
    retry: bool,
}

fn spec<'a>(seed: &'a RunSeed, code: &'a str, title: String, detail: String) -> FindingSpec<'a> {
    FindingSpec {
        tag: "content",
        severity: "warning",
        code,
        title,
        detail,
        subject: Some(&seed.subject),
        session: seed.name.entity("ses"),
        run_ids: vec![seed.name.stem.clone()],
        file: None,
    }
}

fn check_tr(seed: &RunSeed, record: &BidsRunRecord) -> Option<BidsFinding> {
    let header = record.header.as_ref()?;
    header.n_volumes.filter(|&n| n > 1)?;
    let sidecar_tr = meta_f64(record, "RepetitionTime")?;
    let pixdim_tr = f64::from(header.tr_seconds?);
    ((pixdim_tr - sidecar_tr).abs() > 1e-3).then(|| {
        finding(spec(
            seed,
            "PIXDIM_TR_MISMATCH",
            format!("pixdim[4] {pixdim_tr:.3} s, RepetitionTime {sidecar_tr:.3} s"),
            "The NIfTI header and the effective sidecar disagree on TR.".into(),
        ))
    })
}

fn scan_subject(
    seeds: &[RunSeed],
    resolver: &mut SidecarResolver<'_>,
    context: &SubjectContext<'_>,
) -> SubjectResult {
    let mut out = SubjectResult::default();
    let mut remote_headers = context.remote.map(|remote| {
        let paths: Vec<String> = seeds
            .iter()
            .filter(|seed| seed.available)
            .map(|seed| seed.rel_path.clone())
            .collect();
        remote.headers(&paths).into_iter()
    });
    for seed in seeds {
        let effective = resolver.effective(&seed.abs_path);
        let mut sidecar = acquisition_values(&effective);
        let mut header = None;
        let read = match remote_headers.as_mut() {
            _ if !seed.available => None,
            Some(results) => {
                let result = results.next().unwrap_or_else(|| Err("No response".into()));
                out.retry |= result.is_err();
                Some(result.map(bridge_header))
            }
            None => Some(read_header(&seed.abs_path)),
        };
        match read {
            Some(Ok(summary)) => {
                out.reads += 1;
                sidecar.extend(header_values(&summary));
                header = Some(summary);
            }
            Some(Err(e)) => {
                out.reads += 1;
                out.findings.push(finding(spec(
                    seed,
                    "HEADER_UNREADABLE",
                    "NIfTI header could not be read".into(),
                    e,
                )));
            }
            None => out.findings.push(finding(spec(
                seed,
                "IMAGE_UNAVAILABLE",
                "Image is a dangling link".into(),
                "The run is present but its image is not, as with an annexed file not yet fetched. It has no header or slices.".into(),
            ))),
        }
        let mut record = BidsRunRecord {
            id: seed.name.stem.clone(),
            subject: seed.subject.clone(),
            session: seed.name.entity("ses").map(str::to_string),
            datatype: seed.datatype.clone(),
            suffix: seed.name.suffix.clone(),
            task: seed.name.entity("task").map(str::to_string),
            acq: seed.name.entity("acq").map(str::to_string),
            dir: seed.name.entity("dir").map(str::to_string),
            run: seed.name.entity("run").map(str::to_string),
            echo: seed.name.entity("echo").map(str::to_string),
            path: seed.abs_path.to_string_lossy().into_owned(),
            rel_path: seed.rel_path.clone(),
            size_bytes: seed.size as f64,
            series: series_label(&seed.name),
            sidecar,
            header,
            variant_id: None,
            fmap: None,
            fd: None,
            iqms: None,
            has_events: false,
            mtime: seed.modified.and_then(rfc3339_utc),
        };
        out.findings.extend(check_tr(seed, &record));

        if seed.name.suffix == "bold" {
            if let Some((path, pipeline)) = context.confounds.get(&run_key(&seed.name)) {
                out.reads += 1;
                match context.files.tsv(path).and_then(|t| fd_from(t, path)) {
                    Ok(trace) => {
                        let source = format!("{} confounds", context.pipelines[*pipeline].label());
                        record.fd = fd::summarize(&trace, &source);
                    }
                    Err(e) => {
                        out.retry |= context.remote.is_some();
                        out.findings.push(finding(spec(
                            seed,
                            "CONFOUNDS_UNREADABLE",
                            "Confounds could not be read".into(),
                            e,
                        )));
                    }
                }
            }
        }

        if seed.name.suffix == "bold" {
            let table = context.event_files.applicable(&seed.rel_path, &seed.name);
            if let Some(path) = table {
                record.has_events = true;
                out.reads += 1;
                let named = events_path(&seed.abs_path, &seed.name);
                let sidecar = resolver.effective(named.as_deref().unwrap_or(path));
                let (scan_end, tr) = scan_timing(&record);
                let checked = context
                    .files
                    .tsv(path)
                    .and_then(|table| check_table(table, path, &sidecar, scan_end, tr));
                match checked {
                    Ok(report) => {
                        for issue in report.issues {
                            let mut item = spec(seed, issue.code, issue.title, issue.detail);
                            item.tag = issue.tag;
                            item.severity = issue.severity;
                            out.findings.push(finding(item));
                        }
                    }
                    Err(e) => {
                        out.retry |= context.remote.is_some();
                        out.findings.push(finding(spec(
                            seed,
                            "EVENTS_UNREADABLE",
                            "events.tsv could not be read".into(),
                            e,
                        )));
                    }
                }
            }
        }
        out.runs.push(record);
    }
    if let Some(subject) = seeds.first().map(|seed| seed.subject.as_str()) {
        out.findings.extend(fieldmap::link_subject(
            subject,
            &mut out.runs,
            context.known_files,
            context.listing_complete,
        ));
    }
    out
}

/// `n_volumes × TR` from effective metadata, falling back to `pixdim[4]`.
fn scan_timing(record: &BidsRunRecord) -> (Option<f64>, Option<f64>) {
    let header = record.header.as_ref();
    let tr = meta_f64(record, "RepetitionTime")
        .or_else(|| header.and_then(|h| h.tr_seconds).map(f64::from));
    let volumes = header.and_then(|h| h.n_volumes);
    (volumes.zip(tr).map(|(n, tr)| f64::from(n) * tr), tr)
}

fn subject_of(rel_path: &Path) -> Option<String> {
    let first = rel_path.iter().next()?.to_str()?;
    first.strip_prefix("sub-").map(str::to_string)
}

/// Hashes of (path, size, mtime) that key the incremental rescan. Each subject
/// hash covers its own tree and confounds, plus what it shares: root sidecars,
/// root events tables, and pipeline descriptions, which name the FD source.
struct Fingerprints {
    dataset: String,
    subjects: HashMap<String, String>,
}

fn fingerprints(entries: &[IndexEntry], extra_tag: &str) -> Fingerprints {
    let mut global: Vec<String> = vec![extra_tag.to_string()];
    let mut per_subject: HashMap<String, Vec<String>> = HashMap::new();
    let mut everything: Vec<String> = Vec::new();
    for entry in entries {
        let rel = rel_text(&entry.rel_path);
        if rel.starts_with("derivatives/brainflow/") {
            continue;
        }
        let line = format!("{rel}|{}", entry_stamp(entry));
        everything.push(line.clone());
        if entry.is_derivative {
            if rel.split('/').count() == 3 && rel.ends_with("/dataset_description.json") {
                global.push(line.clone());
            }
            let name = entry.abs_path.file_name().and_then(|n| n.to_str());
            if let Some(name) = name.and_then(parse_name).filter(is_confounds) {
                if let Some(subject) = name.subject() {
                    per_subject.entry(subject.into()).or_default().push(line);
                }
            }
        } else if let Some(subject) = subject_of(&entry.rel_path) {
            per_subject.entry(subject).or_default().push(line);
        } else if rel.ends_with(".json") || rel.ends_with("events.tsv") {
            global.push(line);
        }
    }
    let digest = |lines: &mut Vec<String>| {
        lines.sort();
        let refs: Vec<&str> = lines.iter().map(String::as_str).collect();
        sha256_hex(&refs)
    };
    let global = digest(&mut global);
    Fingerprints {
        dataset: digest(&mut everything),
        subjects: per_subject
            .into_iter()
            .map(|(subject, mut lines)| {
                let hash = digest(&mut lines);
                (subject, sha256_hex(&[&global, &hash]))
            })
            .collect(),
    }
}

/// The scanner line: the modal maker and model, then the modal field strength
/// of the runs on that model. Sidecars of one scanner often differ in which of
/// these keys they carry, so runs missing the field still count for the model.
fn modal_scanner(runs: &[BidsRunRecord]) -> Option<String> {
    let text = |run: &BidsRunRecord, key: &str| -> Option<String> {
        let entry = run.sidecar.iter().find(|entry| entry.key == key)?;
        serde_json::from_str::<Value>(&entry.value)
            .ok()?
            .as_str()
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    };
    let machine = |run: &BidsRunRecord| {
        let parts = [
            text(run, "Manufacturer"),
            text(run, "ManufacturersModelName"),
        ];
        let parts: Vec<String> = parts.into_iter().flatten().collect();
        parts.join(" ")
    };
    let model = series::mode(runs.iter().map(machine).filter(|name| !name.is_empty()));
    let field = series::mode(
        runs.iter()
            .filter(|run| model.as_ref().is_none_or(|top| machine(run) == *top))
            .filter_map(|run| meta_f64(run, "MagneticFieldStrength"))
            .map(|tesla| format!("{tesla}T")),
    );
    let parts: Vec<String> = [model, field].into_iter().flatten().collect();
    (!parts.is_empty()).then(|| parts.join(" "))
}

/// One note for participants with no images here, as in a partial copy. It
/// replaces the validator's two errors per such subject, which state one fact.
fn fold_absent_participants(
    validator: Vec<BidsFinding>,
    absent: &[&str],
    total: usize,
) -> Vec<BidsFinding> {
    if absent.is_empty() {
        return validator;
    }
    let mut out: Vec<BidsFinding> = validator
        .into_iter()
        .filter(|f| {
            !matches!(
                f.code.as_str(),
                "subject_directory" | "participant_directory_missing"
            )
        })
        .collect();
    let shown: Vec<String> = absent.iter().take(3).map(|s| format!("sub-{s}")).collect();
    let more = match absent.len() - shown.len() {
        0 => String::new(),
        rest => format!(" and {rest} more"),
    };
    out.push(finding(FindingSpec {
        tag: "note",
        severity: "warning",
        code: "PARTICIPANTS_WITHOUT_DATA",
        title: format!("{} of {total} participants have no images here", absent.len()),
        detail: format!(
            "participants.tsv lists {}{more} with no images in this copy. They have no runs, and derivative coverage does not count them.",
            shown.join(", ")
        ),
        subject: None,
        session: None,
        run_ids: Vec::new(),
        file: Some("participants.tsv".into()),
    }));
    out
}

fn participants_columns(root: &Path, files: &ScanFiles) -> Vec<String> {
    let Ok(mut reader) = files.tsv(&root.join("participants.tsv")) else {
        return Vec::new();
    };
    reader
        .headers()
        .map(|headers| {
            headers
                .iter()
                .filter(|column| *column != "participant_id")
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn default_author() -> String {
    ["USER", "USERNAME", "LOGNAME"]
        .iter()
        .find_map(|key| std::env::var(key).ok().filter(|value| !value.is_empty()))
        .unwrap_or_else(|| "unknown".to_string())
}

/// Tie validator findings to the runs their files belong to, so a validation
/// error marks its cell and a lens on it finds the run.
pub(super) fn attach_validator_runs(findings: &mut [BidsFinding], runs: &[BidsRunRecord]) {
    let ids: HashSet<&str> = runs.iter().map(|run| run.id.as_str()).collect();
    for item in findings.iter_mut().filter(|item| item.tag == "validator") {
        let Some(file) = item.file.as_deref() else {
            continue;
        };
        let name = file.rsplit('/').next().unwrap_or(file);
        let stem = name.split('.').next().unwrap_or(name);
        if ids.contains(stem) {
            item.run_ids = vec![stem.to_string()];
        }
        item.session = file
            .split('/')
            .find_map(|part| part.strip_prefix("ses-"))
            .map(str::to_string);
    }
}

/// `sub-XX` below a derivative root or at the top of the raw tree.
fn subject_in_path(rel: &str) -> Option<&str> {
    rel.split('/').find_map(|part| {
        part.strip_prefix("sub-")
            .filter(|id| !id.contains('.') && !id.contains('_'))
    })
}

/// Sessions in acquisition order, when `acq_time` in `*_sessions.tsv` or
/// `*_scans.tsv` shows it. Each participant ranks their own sessions; the
/// order is by mean rank. Empty when no participant has two dated sessions.
fn session_order(root: &Path, entries: &[IndexEntry], files: &ScanFiles) -> Vec<String> {
    let mut dated: HashMap<String, HashMap<String, String>> = HashMap::new();
    let mut note = |subject: &str, session: &str, time: &str| {
        if time.is_empty() || time == "n/a" {
            return;
        }
        let earliest = dated
            .entry(subject.to_string())
            .or_default()
            .entry(session.to_string())
            .or_insert_with(|| time.to_string());
        if time < earliest.as_str() {
            *earliest = time.to_string();
        }
    };
    for entry in entries.iter().filter(|entry| !entry.is_derivative) {
        let rel = rel_text(&entry.rel_path);
        let is_sessions = rel.ends_with("_sessions.tsv");
        if !is_sessions && !rel.ends_with("_scans.tsv") {
            continue;
        }
        let Some(subject) = subject_in_path(&rel) else {
            continue;
        };
        let Ok(mut reader) = files.tsv(&root.join(&entry.rel_path)) else {
            continue;
        };
        let Ok(headers) = reader.headers().cloned() else {
            continue;
        };
        let column = |name: &str| headers.iter().position(|header| header == name);
        let Some(time) = column("acq_time") else {
            continue;
        };
        let session_column = column("session_id");
        let session_of_path = rel
            .split('/')
            .find_map(|part| part.strip_prefix("ses-"))
            .map(str::to_string);
        for record in reader.records().flatten() {
            let session = if is_sessions {
                session_column
                    .and_then(|index| record.get(index))
                    .map(|id| id.trim_start_matches("ses-").to_string())
            } else {
                session_of_path.clone()
            };
            if let (Some(session), Some(time)) = (session, record.get(time)) {
                note(subject, &session, time);
            }
        }
    }
    let mut ranks: HashMap<String, (f64, f64)> = HashMap::new();
    let mut ordered = false;
    for sessions in dated.values() {
        let mut own: Vec<(&String, &String)> = sessions.iter().collect();
        own.sort_by(|a, b| a.1.cmp(b.1).then_with(|| natural_cmp(a.0, b.0)));
        ordered |= own.len() > 1;
        for (rank, (session, _)) in own.iter().enumerate() {
            let entry = ranks.entry((*session).clone()).or_default();
            entry.0 += rank as f64;
            entry.1 += 1.0;
        }
    }
    if !ordered {
        return Vec::new();
    }
    let mean = |id: &String| ranks.get(id).map_or(0.0, |(sum, n)| sum / n);
    let mut order: Vec<String> = ranks.keys().cloned().collect();
    order.sort_by(|a, b| mean(a).total_cmp(&mean(b)).then_with(|| natural_cmp(a, b)));
    order
}

fn validator_findings(project: &BidsProject) -> Vec<BidsFinding> {
    use bids_rs::compliance::Severity;
    let result = match ComplianceChecker::new().check_project(project) {
        Ok(result) => result,
        Err(e) => {
            return vec![finding(FindingSpec {
                tag: "note",
                severity: "info",
                code: "VALIDATOR_FAILED",
                title: "The validator did not finish".into(),
                detail: e.to_string(),
                subject: None,
                session: None,
                run_ids: Vec::new(),
                file: None,
            })]
        }
    };
    result
        .issues
        .iter()
        .chain(&result.warnings)
        .filter_map(|issue| {
            let file = issue
                .file
                .as_ref()
                .map(|path| rel_text(path.strip_prefix(project.path()).unwrap_or(path)));
            // A derivative's images may be absent by design: a partial copy
            // keeps its JSON, and a server listing leaves images out.
            let derived = file
                .as_deref()
                .is_some_and(|f| f.starts_with("derivatives/"));
            if derived && issue.rule == "orphaned_sidecar" {
                return None;
            }
            let subject = file.as_deref().and_then(|f| subject_of(Path::new(f)));
            let severity = match issue.severity {
                Severity::Critical | Severity::High => "error",
                Severity::Medium => "warning",
                Severity::Low => "info",
            };
            let mut item = finding(FindingSpec {
                tag: "validator",
                severity,
                code: &issue.rule,
                title: issue.description.clone(),
                detail: issue.description.clone(),
                subject: subject.as_deref(),
                session: None,
                run_ids: Vec::new(),
                file,
            });
            // Rules can repeat for one file, so the id also takes the text.
            let hash = sha256_hex(&[&item.id, &issue.description]);
            item.id = format!("{}:{}", issue.rule, &hash[..16]);
            Some(item)
        })
        .collect()
}

/// Count one derivative output as coverage. Returns its pipeline and file name.
fn add_coverage<'a>(
    rel: &'a str,
    pipelines: &[Pipeline],
    coverage: &mut [Coverage],
) -> Option<(usize, &'a str)> {
    let index = pipelines
        .iter()
        .position(|p| rel.starts_with(&format!("{}/", p.root)))?;
    let file_name = rel.rsplit('/').next()?;
    coverage[index].add_name(file_name);
    for part in rel.split('/').filter_map(|c| c.strip_prefix("sub-")) {
        if !part.contains('_') && !part.contains('.') {
            coverage[index].add_subject_dir(part);
        }
    }
    Some((index, file_name))
}

/// Build every derivative's coverage and the confounds lookup in one pass.
/// `image_names` are derivative images a server listing kept out of `entries`.
fn derivative_inputs(
    root: &Path,
    entries: &[IndexEntry],
    image_names: &[String],
    pipelines: &[Pipeline],
    files: &ScanFiles,
) -> (Vec<Coverage>, HashMap<String, (PathBuf, usize)>) {
    let mut coverage: Vec<Coverage> = pipelines.iter().map(|_| Coverage::default()).collect();
    let mut confounds: HashMap<String, (PathBuf, usize)> = HashMap::new();
    for rel in image_names {
        add_coverage(rel, pipelines, &mut coverage);
    }
    for entry in entries.iter().filter(|entry| entry.is_derivative) {
        let rel = rel_text(&entry.rel_path);
        let Some((index, file_name)) = add_coverage(&rel, pipelines, &mut coverage) else {
            continue;
        };
        if let Some(name) = parse_name(file_name).filter(is_confounds) {
            // Pipelines are sorted with fMRIPrep first, as in `find_confounds`:
            // the lowest index wins whatever order the walk found them in.
            let candidate = (entry.abs_path.clone(), index);
            confounds
                .entry(run_key(&name))
                .and_modify(|held| {
                    if index < held.1 {
                        *held = candidate.clone();
                    }
                })
                .or_insert(candidate);
        }
    }
    for (pipeline, seen) in pipelines.iter().zip(coverage.iter_mut()) {
        derivatives::add_group_rows(root, pipeline, seen, files);
    }
    (coverage, confounds)
}

/// Part of every subject hash: results read under another policy do not match.
const LOCAL_TAG: &str = "local";
const REMOTE_TAG: &str = "remote-listing";

/// The walk's outcome, kept for the index and the scan note.
struct Walked {
    listing: Listing,
    unread: Vec<(String, String)>,
}

/// Sidecars that failed to arrive and what they reach: those outside any
/// subject reach every subject; the rest, only their own.
#[derive(Default)]
struct UnreadSidecars {
    shared: bool,
    subjects: HashSet<String>,
}

fn unread_sidecars(unread: &[(String, String)]) -> UnreadSidecars {
    let mut out = UnreadSidecars::default();
    for (rel, _) in unread.iter().filter(|(rel, _)| rel.ends_with(".json")) {
        match subject_of(Path::new(rel)) {
            Some(subject) => {
                out.subjects.insert(subject);
            }
            None => out.shared = true,
        }
    }
    out
}

fn indexing(request: &ScanRequest<'_>, phase: &str, listing_complete: bool) -> BidsScanProgress {
    BidsScanProgress {
        scan_id: request.scan_id.to_string(),
        is_remote: request.remote.is_some(),
        listing_complete,
        phase: phase.to_string(),
        subjects_done: 0,
        subjects_total: 0,
        files_done: 0.0,
        files_total: 0.0,
        current: None,
        subject: None,
        runs: Vec::new(),
        findings: Vec::new(),
    }
}

/// A snapshot of the dataset on the server: walk it, fetch the shared small
/// files, see from the stored fingerprints which subjects changed, and fetch
/// only their sidecars. An unchanged subject's sidecars stay unread, which is
/// safe because cached subjects do not resolve metadata.
fn open_remote(
    request: &ScanRequest<'_>,
    server: &dyn RemoteDataset,
    control: &dyn ScanControl,
    stored: &StoredIndex,
    on_progress: &mut dyn FnMut(BidsScanProgress),
) -> Result<(BidsProject, ScanFiles, Walked), String> {
    let root = request.dataset;
    let stop = || control.cancelled();
    on_progress(indexing(request, "listing", false));
    let mut listing = remote::walk(server, &stop)?;
    on_progress(indexing(request, "reading", listing.complete()));
    let files = ScanFiles::Remote(RemoteFiles::new(root, &listing));
    let ScanFiles::Remote(fetched) = &files else {
        unreachable!("built on the line above")
    };
    fetched.fetch(server, &listing.shared_paths(), &|| false);
    let description = root.join("dataset_description.json");
    files
        .text(&description)
        .map_err(|e| format!("Failed to load BIDS dataset: {e}"))?;

    let tables: Vec<String> = derivatives::pipelines_in(root, &files)
        .iter()
        .flat_map(|pipeline| pipeline.group_tables(root, &files))
        .map(|path| fetched.rel_of(&path))
        .collect();
    fetched.fetch(server, &tables, &|| false);

    // Local scans tolerate a pipeline's bad description and a bad participants
    // table. A manifest does not, so they leave it; they are still read here.
    let is_object = |rel: &str| {
        files
            .text(&root.join(rel))
            .ok()
            .and_then(|text| serde_json::from_str::<Value>(&text).ok())
            .is_some_and(|value| value.is_object())
    };
    let unusable_table = |text: &str| {
        let probe = ProjectManifest {
            files: vec![
                bids_rs::ManifestEntry::new("dataset_description.json", 2),
                bids_rs::ManifestEntry::new("participants.tsv", text.len() as u64),
            ],
            sidecars: HashMap::from([(
                PathBuf::from("dataset_description.json"),
                SidecarContent::Json("{}".into()),
            )]),
            participants_tsv: Some(text.to_string()),
        };
        BidsProject::from_manifest(root, probe).is_err()
    };
    let participants = files
        .text(&root.join("participants.tsv"))
        .ok()
        .filter(|text| !unusable_table(text));
    listing.files.retain(|file| {
        let rel = rel_text(&file.relative_path);
        if rel == "participants.tsv" {
            return participants.is_some();
        }
        let nested = rel.starts_with("derivatives/")
            && rel.split('/').count() == 3
            && rel.ends_with("/dataset_description.json");
        !nested || is_object(&rel)
    });

    let snapshot = FileIndex::from_manifest(root, listing.files.iter().cloned())
        .map_err(|e| format!("Failed to load BIDS dataset: {e}"))?;
    let prints = fingerprints(snapshot.files(), REMOTE_TAG);
    let changed = |subject: &str| {
        let held = stored.subjects.get(subject);
        held.is_none_or(|cached| prints.subjects.get(subject) != Some(&cached.fingerprint))
    };
    let sidecars = listing.subject_sidecars(&changed);
    fetched.fetch(server, &sidecars, &stop);

    let json = listing
        .files
        .iter()
        .map(|file| file.relative_path.clone())
        .filter(|rel| rel.extension().is_some_and(|ext| ext == "json"))
        .filter(|rel| fetched.answered(&rel_text(rel)))
        .map(|rel| {
            let content = match files.text(&root.join(&rel)) {
                Ok(text) => SidecarContent::Json(text),
                Err(error) => SidecarContent::Unavailable(error),
            };
            (rel, content)
        })
        .collect();
    let unread = fetched.failures();
    let manifest = ProjectManifest {
        files: listing.files.clone(),
        sidecars: json,
        participants_tsv: participants,
    };
    let project = BidsProject::from_manifest(root, manifest)
        .map_err(|e| format!("Failed to load BIDS dataset: {e}"))?;
    Ok((project, files, Walked { listing, unread }))
}

/// Events and confounds a subject's runs read. Fetched per subject, so a large
/// dataset holds one subject's tables at a time.
fn subject_tables(
    seeds: &[RunSeed],
    context: &SubjectContext<'_>,
    fetched: &RemoteFiles,
) -> Vec<String> {
    let mut tables: Vec<String> = seeds
        .iter()
        .filter(|seed| seed.name.suffix == "bold")
        .flat_map(|seed| {
            let events = context.event_files.applicable(&seed.rel_path, &seed.name);
            let confounds = context.confounds.get(&run_key(&seed.name));
            events
                .into_iter()
                .chain(confounds.map(|(path, _)| path.as_path()))
        })
        .map(|path| fetched.rel_of(path))
        .collect();
    tables.sort();
    tables.dedup();
    tables
}

/// Scan a dataset. `on_progress` receives each subject as it finishes. Series
/// results arrive only in the returned index.
pub(crate) fn run_scan(
    request: &ScanRequest<'_>,
    control: &dyn ScanControl,
    mut on_progress: impl FnMut(BidsScanProgress),
) -> Result<BidsBrowserIndex, String> {
    let (project, files, walked, stored) = match request.remote {
        Some(server) => {
            let stored = store::load(request.cache_root, request.dataset);
            let (project, files, walked) =
                open_remote(request, server, control, &stored, &mut on_progress)?;
            (project, files, Some(walked), stored)
        }
        None => {
            let project = BidsProject::with_options(request.dataset, DerivativesMode::None, false)
                .map_err(|e| format!("Failed to load BIDS dataset: {e}"))?;
            let stored = store::load(request.cache_root, project.path());
            (project, ScanFiles::Disk, None, stored)
        }
    };
    let root = project.path().to_path_buf();
    let entries = project.index().files();
    let description = project.description();
    let raw_version = derivatives::dataset_version(description);
    let text = |key: &str| {
        description
            .get(key)
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    };

    let by_subject = collect_runs(entries);
    let pipelines = derivatives::pipelines_in(&root, &files);
    let image_names = walked
        .as_ref()
        .map_or(&[][..], |w| &w.listing.derivative_images);
    let (coverage, confounds) = derivative_inputs(&root, entries, image_names, &pipelines, &files);
    let mriqc = fd::read_mriqc(&root, &pipelines, &files);
    let known_files: HashSet<String> = entries
        .iter()
        .filter(|entry| !entry.is_derivative)
        .map(|entry| rel_text(&entry.rel_path))
        .collect();

    let mut subjects: Vec<String> = by_subject.keys().cloned().collect();
    for participant in project.participants() {
        if !subjects.iter().any(|known| known == participant) {
            subjects.push(participant.to_string());
        }
    }
    subjects.sort_by(|a, b| natural_cmp(a, b));
    let absent: Vec<&str> = subjects
        .iter()
        .map(String::as_str)
        .filter(|subject| !by_subject.contains_key(*subject))
        .collect();
    let event_files = EventFiles::new(entries);

    let is_remote = request.remote.is_some();
    // True for a local walk: it either finishes or the scan fails.
    let listing_complete = walked.as_ref().is_none_or(|w| w.listing.complete());
    let tag = if is_remote { REMOTE_TAG } else { LOCAL_TAG };
    let prints = fingerprints(entries, tag);
    let mut next = stored.clone();

    let subjects_total = subjects.len() as u32;
    let files_total = entries.len() as f64;
    let mut files_by_subject: HashMap<&str, f64> = HashMap::new();
    let entry_paths: Vec<String> = entries.iter().map(|e| rel_text(&e.rel_path)).collect();
    for rel in &entry_paths {
        if let Some(subject) = subject_in_path(rel) {
            *files_by_subject.entry(subject).or_default() += 1.0;
        }
    }
    on_progress(BidsScanProgress {
        is_remote,
        listing_complete,
        scan_id: request.scan_id.to_string(),
        phase: "indexing".into(),
        subjects_done: 0,
        subjects_total,
        files_done: 0.0,
        files_total,
        current: None,
        subject: None,
        runs: Vec::new(),
        findings: Vec::new(),
    });

    let context = SubjectContext {
        remote: request.remote,
        files: &files,
        confounds: &confounds,
        pipelines: &pipelines,
        known_files: &known_files,
        event_files: &event_files,
        listing_complete,
    };
    let mut resolver = SidecarResolver::with_files(&project, &files);
    let (mut runs, mut findings) = (Vec::new(), Vec::new());
    let mut reads = 0u64;
    let mut complete = true;
    let mut files_done = 0f64;
    let mut new_shared: Vec<BidsFinding> = Vec::new();
    let mut every_subject_rescanned = true;
    // The resolver reports a sidecar once, so what a failure above the subject
    // level costs is remembered for the subjects that come after the first.
    let unread = walked
        .as_ref()
        .map_or_else(UnreadSidecars::default, |w| unread_sidecars(&w.unread));
    let mut shared_sidecar_failed = unread.shared;
    for (position, subject) in subjects.iter().enumerate() {
        if control.cancelled() {
            complete = false;
            break;
        }
        let seeds = by_subject.get(subject).map_or(&[][..], Vec::as_slice);
        let fingerprint = prints.subjects.get(subject).cloned().unwrap_or_default();
        let (subject_runs, subject_findings) =
            match stored.subjects.get(subject).filter(|cached| {
                !cached.fingerprint.is_empty() && cached.fingerprint == fingerprint
            }) {
                Some(cached) => {
                    every_subject_rescanned = false;
                    (cached.runs.clone(), cached.findings.clone())
                }
                None => {
                    let tables = match (request.remote, &files) {
                        (Some(server), ScanFiles::Remote(fetched)) => {
                            let tables = subject_tables(seeds, &context, fetched);
                            fetched.fetch(server, &tables, &|| false);
                            tables
                        }
                        _ => Vec::new(),
                    };
                    let mut result = scan_subject(seeds, &mut resolver, &context);
                    if let ScanFiles::Remote(fetched) = &files {
                        // A failure stays for the note; root tables serve others.
                        let own = tables.iter().filter(|rel| rel.contains('/')).cloned();
                        fetched.forget_read(&own.collect::<Vec<_>>());
                    }
                    // A sidecar above the subject level belongs to no subject:
                    // kept apart, so it survives whichever subject first read it.
                    let sidecar_findings = resolver.take_findings();
                    let (shared, own): (Vec<_>, Vec<_>) = sidecar_findings
                        .into_iter()
                        .partition(|item| item.subject.is_none());
                    shared_sidecar_failed |= !shared.is_empty();
                    // A sidecar may only have failed to arrive, so it is retried.
                    result.retry |= is_remote
                        && (shared_sidecar_failed
                            || !own.is_empty()
                            || unread.subjects.contains(subject));
                    new_shared.extend(shared);
                    result.findings.extend(own);
                    reads += result.reads;
                    // With a gap in the listing, this subject's view may be short.
                    if !result.retry && listing_complete {
                        next.subjects.insert(
                            subject.clone(),
                            SubjectCache {
                                fingerprint,
                                runs: result.runs.clone(),
                                findings: result.findings.clone(),
                            },
                        );
                    }
                    (result.runs, result.findings)
                }
            };
        files_done += files_by_subject
            .get(subject.as_str())
            .copied()
            .unwrap_or(0.0);
        on_progress(BidsScanProgress {
            is_remote,
            listing_complete,
            scan_id: request.scan_id.to_string(),
            phase: "subjects".into(),
            subjects_done: position as u32 + 1,
            subjects_total,
            files_done,
            files_total,
            current: seeds.last().map(|seed| seed.rel_path.clone()),
            subject: Some(subject.clone()),
            runs: subject_runs.clone(),
            findings: subject_findings.clone(),
        });
        runs.extend(subject_runs);
        findings.extend(subject_findings);
    }
    if listing_complete {
        next.subjects
            .retain(|subject, _| subjects.contains(subject));
    }
    let mut shared = if complete && every_subject_rescanned {
        Vec::new()
    } else {
        stored.shared_findings.clone()
    };
    for item in new_shared {
        if !shared.iter().any(|held| held.id == item.id) {
            shared.push(item);
        }
    }
    shared.retain(|item| {
        item.file
            .as_ref()
            .is_none_or(|rel| files.exists(&root.join(rel)))
    });
    next.shared_findings = shared.clone();
    findings.extend(shared);

    on_progress(BidsScanProgress {
        is_remote,
        listing_complete,
        scan_id: request.scan_id.to_string(),
        phase: "finalizing".into(),
        subjects_done: subjects_total,
        subjects_total,
        files_done,
        files_total,
        current: None,
        subject: None,
        runs: Vec::new(),
        findings: Vec::new(),
    });

    let series_results = series::finalize(&mut runs);
    findings.extend(series_results.findings);
    series::collapse_no_fieldmap(&mut findings, &runs, listing_complete);
    if let (Some(walked), ScanFiles::Remote(fetched)) = (&walked, &files) {
        findings.push(remote_note(walked, fetched, reads));
    }

    for run in &mut runs {
        run.iqms = iqm_key(&run.id).and_then(|key| mriqc.get(&key).cloned());
    }

    let summary = derivatives::summarize(
        &pipelines,
        &coverage,
        &subjects,
        &absent,
        &runs,
        raw_version.as_deref(),
    );
    findings.extend(summary.findings);

    // A listing with gaps would read as missing files.
    let whole = complete && listing_complete;
    if whole {
        let cached = stored
            .validator
            .as_ref()
            .filter(|cached| cached.fingerprint == prints.dataset);
        let validator = match cached {
            Some(cached) => cached.findings.clone(),
            None => validator_findings(&project),
        };
        next.validator = Some(ValidatorCache {
            fingerprint: prints.dataset.clone(),
            findings: validator.clone(),
        });
        let mut validator = fold_absent_participants(validator, &absent, subjects.len());
        attach_validator_runs(&mut validator, &runs);
        findings.extend(validator);
    }

    let exclusions = match read_scan_exclusions(&root, &files) {
        Ok(rows) => rows,
        Err(detail) => {
            findings.push(finding(FindingSpec {
                tag: "note",
                severity: "warning",
                code: "EXCLUSIONS_UNREADABLE",
                title: "derivatives/brainflow/exclusions.tsv could not be used".into(),
                detail,
                subject: None,
                session: None,
                run_ids: Vec::new(),
                file: Some("derivatives/brainflow/exclusions.tsv".into()),
            }));
            Vec::new()
        }
    };

    let new_subjects = match stored.scanned_at {
        Some(_) => subjects
            .iter()
            .filter(|subject| !stored.known_subjects.contains(subject))
            .cloned()
            .collect(),
        None => Vec::new(),
    };
    if whole {
        next.scanned_at = rfc3339_utc(SystemTime::now());
        next.known_subjects = subjects.clone();
    }
    if control.owns_index() {
        // The scan's results stand without the cache; the next one is just slower.
        if let Err(error) = store::save(request.cache_root, &root, &next) {
            log::warn!("BIDS index not saved: {error}");
        }
    }

    let mut participant_columns = participants_columns(&root, &files);
    if participant_columns.is_empty() {
        let mut keys: Vec<String> = project
            .participants_full()
            .iter()
            .flat_map(|p| p.metadata.keys().cloned())
            .collect();
        keys.sort();
        keys.dedup();
        participant_columns = keys;
    }
    let authors = description
        .get("Authors")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();

    Ok(BidsBrowserIndex {
        scan_id: request.scan_id.to_string(),
        dataset_path: root.to_string_lossy().into_owned(),
        name: text("Name").unwrap_or_else(|| project.name().to_string()),
        bids_version: text("BIDSVersion").unwrap_or_else(|| "unknown".to_string()),
        dataset_version: raw_version,
        doi: text("DatasetDOI"),
        license: text("License"),
        authors,
        scanner: modal_scanner(&runs),
        is_remote,
        complete,
        listing_complete,
        default_author: default_author(),
        previous_scan_at: stored.scanned_at.clone(),
        new_subjects,
        total_file_count: project.index().file_count() as f64,
        total_size_bytes: project.index().total_size() as f64,
        files_read: if complete { files_total } else { files_done },
        files_opened: (reads + resolver.reads) as f64,
        session_order: session_order(&root, entries, &files),
        participants: project
            .participants_full()
            .iter()
            .map(|p| BidsParticipantRow {
                participant_id: p.id.clone(),
                values: p.metadata.clone(),
            })
            .collect(),
        participant_columns,
        subjects,
        runs,
        series_modal: series_results.modal,
        variants: series_results.variants,
        findings,
        derivatives: summary.infos,
        derivative_status: summary.status,
        exclusions,
        exclusions_described: root
            .join("derivatives/brainflow/dataset_description.json")
            .exists(),
    })
}

/// Exclusions on the disk, or, for a remote dataset, the server's: a mirror's
/// copy may be older, or missing with the mirror itself.
fn read_scan_exclusions(root: &Path, files: &ScanFiles) -> Result<Vec<BidsExclusion>, String> {
    let table = root.join(exclusions::EXCLUSIONS_REL_PATH);
    match files {
        ScanFiles::Disk => exclusions::read_exclusions(root),
        ScanFiles::Remote(_) if !files.exists(&table) => Ok(Vec::new()),
        ScanFiles::Remote(_) => exclusions::parse_tsv(&files.text(&table)?),
    }
}

/// What a remote scan actually read.
fn remote_note(walked: &Walked, fetched: &RemoteFiles, reads: u64) -> BidsFinding {
    let (small, bytes) = fetched.fetched();
    let limit = remote::MAX_FETCHED_FILE_BYTES >> 20;
    let mut detail = format!(
        "This scan fetched {small} sidecars and tables ({:.1} MiB; none over {limit} MiB) and made {reads} header and table reads from the server. Images were not downloaded. Derivative images were listed by name only.",
        bytes as f64 / f64::from(1 << 20),
    );
    if let [(first, why), rest @ ..] = walked.unread.as_slice() {
        let more = match rest.len() {
            0 => String::new(),
            count => format!(" and {count} more"),
        };
        detail.push_str(&format!(" {first}{more} could not be read: {why}."));
    }
    let title = match walked.listing.gap() {
        Some(gap) => {
            detail.push_str(&format!(
                " The listing is incomplete: {gap}. Absences here mean unknown, not missing."
            ));
            "Remote dataset: partial listing from the server"
        }
        None => {
            detail.push_str(" The whole dataset was listed, so absences here are real.");
            "Remote dataset: listed on the server"
        }
    };
    finding(FindingSpec {
        tag: "note",
        severity: "info",
        code: "REMOTE_PARTIAL_SCAN",
        title: title.into(),
        detail,
        subject: None,
        session: None,
        run_ids: Vec::new(),
        file: None,
    })
}

/// A project of the root files and one subject, so opening one run does not
/// read every sidecar in the dataset.
fn subject_project(root: &Path, subject: &str) -> Result<BidsProject, String> {
    let own = format!("sub-{subject}");
    let mut options = IndexingOptions::new().ignore_path("derivatives");
    let entries = std::fs::read_dir(root).map_err(|e| format!("Cannot read dataset: {e}"))?;
    for name in entries.flatten().map(|entry| entry.file_name()) {
        let other = name
            .to_str()
            .is_some_and(|n| n.starts_with("sub-") && n != own);
        if other {
            options = options.ignore_path(name);
        }
    }
    BidsProject::with_indexing_options(root, DerivativesMode::None, false, options)
        .map_err(|e| format!("Failed to load BIDS dataset: {e}"))
}

/// Find a run's image from its id alone. Ids are validated against traversal.
fn locate_run(root: &Path, run_id: &str) -> Result<(ParsedName, Option<PathBuf>), String> {
    let valid = run_id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-'));
    let name = parse_name(&format!("{run_id}.nii.gz"))
        .filter(|_| valid)
        .ok_or_else(|| format!("Invalid run id: {run_id}"))?;
    let subject = name
        .subject()
        .ok_or_else(|| format!("Run id has no subject: {run_id}"))?;
    let mut base = root.join(format!("sub-{subject}"));
    if let Some(session) = name.entity("ses") {
        base.push(format!("ses-{session}"));
    }
    let image = ["func", "anat", "dwi", "fmap", "perf", "pet"]
        .iter()
        .flat_map(|datatype| {
            let dir = base.join(datatype);
            [".nii.gz", ".nii"].map(|extension| dir.join(format!("{run_id}{extension}")))
        })
        .find(|path| path.symlink_metadata().is_ok());
    Ok((name, image))
}

/// The events table that applies to a run, inherited or its own. Rows without
/// a numeric onset are left out; `check_events` reports them.
pub(crate) fn run_events(dataset: &Path, run_id: &str) -> Result<Vec<BidsEventRow>, String> {
    let root = dataset
        .canonicalize()
        .map_err(|e| format!("Cannot access {}: {e}", dataset.display()))?;
    let (name, image) = locate_run(&root, run_id)?;
    let Some(image) = image else {
        return Ok(Vec::new());
    };
    let project = subject_project(&root, name.subject().unwrap_or_default())?;
    let image_rel = rel_text(image.strip_prefix(&root).unwrap_or(&image));
    let event_files = EventFiles::new(project.index().files());
    let Some(path) = event_files.applicable(&image_rel, &name) else {
        return Ok(Vec::new());
    };
    let mut reader = super::tsv_reader(path)?;
    let headers = reader
        .headers()
        .map_err(|e| format!("Cannot read {}: {e}", path.display()))?
        .clone();
    let mut rows = Vec::new();
    for record in reader.records() {
        let record = record.map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
        let cell = |column: &str| {
            headers
                .iter()
                .position(|header| header == column)
                .and_then(|index| record.get(index))
        };
        let Some(onset) = cell("onset").and_then(|text| text.trim().parse::<f64>().ok()) else {
            continue;
        };
        let additional = headers
            .iter()
            .zip(record.iter())
            .filter(|(column, _)| !matches!(*column, "onset" | "duration" | "trial_type"))
            .map(|(column, value)| (column.to_string(), value.to_string()))
            .collect();
        rows.push(BidsEventRow {
            onset,
            duration: cell("duration")
                .and_then(|text| text.trim().parse().ok())
                .unwrap_or(0.0),
            trial_type: cell("trial_type").unwrap_or("").to_string(),
            additional,
        });
    }
    Ok(rows)
}

/// Everything the inspector loads on select: per-volume FD, events checks with
/// the passing ones, and derivative provenance.
pub(crate) fn run_detail(dataset: &Path, run_id: &str) -> Result<BidsRunDetail, String> {
    let root = dataset
        .canonicalize()
        .map_err(|e| format!("Cannot access {}: {e}", dataset.display()))?;
    let (name, image) = locate_run(&root, run_id)?;
    let pipelines = derivatives::list_pipelines(&root);

    let mut detail = BidsRunDetail {
        run_id: run_id.to_string(),
        fd_trace: Vec::new(),
        fd_source: None,
        fd_definition: None,
        fd_filtered: false,
        non_steady_volumes: Vec::new(),
        event_checks: Vec::new(),
        events_duration: None,
        derivative_checks: Vec::new(),
    };
    if let Some((path, index)) = fd::find_confounds(&root, &pipelines, &name) {
        let trace = read_fd(&path)?;
        detail.fd_trace = trace.values;
        detail.fd_filtered = trace.filtered;
        detail.non_steady_volumes = trace.non_steady;
        detail.fd_source = Some(format!("{} confounds", pipelines[index].label()));
        detail.fd_definition = Some(FD_DEFINITION.to_string());
    }

    let bold_image = image.as_deref().filter(|_| name.suffix == "bold");
    if let Some(image_path) = bold_image {
        let project = subject_project(&root, name.subject().unwrap_or_default())?;
        let image_rel = rel_text(image_path.strip_prefix(&root).unwrap_or(image_path));
        let event_files = EventFiles::new(project.index().files());
        if let Some(events) = event_files.applicable(&image_rel, &name) {
            let mut resolver = SidecarResolver::new(&project);
            let header = read_header(image_path).ok();
            let effective = resolver.effective(image_path);
            let tr = effective
                .get("RepetitionTime")
                .and_then(|entry| entry.value.as_f64())
                .or_else(|| header.as_ref().and_then(|h| h.tr_seconds).map(f64::from));
            let scan_end = header
                .as_ref()
                .and_then(|h| h.n_volumes)
                .zip(tr)
                .map(|(n, tr)| f64::from(n) * tr);
            let named = events_path(image_path, &name);
            let sidecar = resolver.effective(named.as_deref().unwrap_or(events));
            let report = check_events(events, &sidecar, scan_end, tr)?;
            detail.event_checks = report.checks;
            detail.events_duration = report.events_duration;
        }
    }

    let raw: HashMap<String, Value> =
        std::fs::read_to_string(root.join("dataset_description.json"))
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default();
    let raw_version = derivatives::dataset_version(&raw);
    detail.derivative_checks = derivatives::pipeline_checks(&pipelines, raw_version.as_deref());
    Ok(detail)
}
