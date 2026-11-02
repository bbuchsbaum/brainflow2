//! Derivative pipelines: identity, coverage and staleness. Each pipeline root
//! is read here because bids-rs `Auto` mode only records the first one.

use super::fd::run_key;
use super::remote::ScanFiles;
use super::{finding, parse_name, FindingSpec};
use bids_rs::provenance::{parse_pipeline_provenance, DerivativeProvenance};
use bridge_types::bids::{
    BidsCheck, BidsDerivativeInfo, BidsFinding, BidsRunRecord, BidsSubjectDerivative,
};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

pub(crate) const OWN_PIPELINE: &str = "brainflow";

/// Status of a subject with no images here: nothing could have been processed,
/// so neither `missing` nor a pipeline's coverage of them says anything.
pub(crate) const NO_LOCAL_DATA: &str = "no_local_data";
/// Outputs exist but do not record which dataset version they were built from.
pub(crate) const UNRECORDED: &str = "unrecorded";

#[derive(Debug, Clone)]
pub(crate) struct Pipeline {
    /// Directory name below `derivatives/`.
    pub name: String,
    /// Dataset-relative root.
    pub root: String,
    pub generated_name: Option<String>,
    pub version: Option<String>,
    pub source_version: Option<String>,
}

fn doi_version(doi: &str) -> Option<String> {
    let (_, version) = doi.rsplit_once(".v")?;
    version
        .starts_with(|c: char| c.is_ascii_digit())
        .then(|| version.to_string())
}

/// Raw dataset version: `DatasetVersion`, or the version suffix of its DOI.
pub(crate) fn dataset_version(description: &HashMap<String, Value>) -> Option<String> {
    ["DatasetVersion", "Version"]
        .iter()
        .find_map(|key| description.get(*key)?.as_str().map(str::to_string))
        .or_else(|| doi_version(description.get("DatasetDOI")?.as_str()?))
}

/// Typed provenance of one description key. Parsed apart, so a malformed
/// `SourceDatasets` does not also lose `GeneratedBy`.
fn provenance_of(description: &HashMap<String, Value>, key: &str) -> DerivativeProvenance {
    let only: HashMap<String, Value> = description
        .get(key)
        .map(|value| (key.to_string(), value.clone()))
        .into_iter()
        .collect();
    parse_pipeline_provenance(&only).unwrap_or_else(|error| {
        log::warn!("Ignoring {key} in a derivative description: {error}");
        DerivativeProvenance::default()
    })
}

fn pipeline(name: String, description: &HashMap<String, Value>) -> Pipeline {
    let generated = provenance_of(description, "GeneratedBy")
        .generated_by
        .into_iter()
        .next();
    let source = provenance_of(description, "SourceDatasets")
        .source_datasets
        .into_iter()
        .next();
    Pipeline {
        root: format!("derivatives/{name}"),
        generated_name: generated.as_ref().map(|item| item.name.clone()),
        version: generated.and_then(|item| item.version),
        source_version: source
            .and_then(|item| item.version.or_else(|| doi_version(item.doi.as_deref()?))),
        name,
    }
}

/// Pipelines under `derivatives/`, sorted, fMRIPrep first as the FD source.
pub(crate) fn list_pipelines(root: &Path) -> Vec<Pipeline> {
    pipelines_in(root, &ScanFiles::Disk)
}

/// `derivatives/brainflow` is ours and not a derivative of interest.
pub(crate) fn pipelines_in(root: &Path, files: &ScanFiles) -> Vec<Pipeline> {
    let derivatives = root.join("derivatives");
    let mut pipelines = Vec::new();
    for name in files.directories_in(&derivatives) {
        if name == OWN_PIPELINE || name.starts_with('.') {
            continue;
        }
        let description: HashMap<String, Value> = files
            .text(&derivatives.join(&name).join("dataset_description.json"))
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default();
        pipelines.push(pipeline(name, &description));
    }
    pipelines.sort_by_key(|p| (!p.name.to_lowercase().contains("fmriprep"), p.name.clone()));
    pipelines
}

impl Pipeline {
    fn display_name(&self) -> String {
        self.generated_name
            .clone()
            .unwrap_or_else(|| self.name.clone())
            .to_lowercase()
    }

    /// `fmriprep 24.1.1`
    pub fn label(&self) -> String {
        match &self.version {
            Some(version) => format!("{} {version}", self.display_name()),
            None => self.display_name(),
        }
    }

    pub fn is_mriqc(&self) -> bool {
        self.display_name().contains("mriqc") || self.name.to_lowercase().contains("mriqc")
    }

    pub fn group_tables(&self, root: &Path, files: &ScanFiles) -> Vec<PathBuf> {
        let mut tables: Vec<PathBuf> = files
            .files_in(&root.join(&self.root))
            .into_iter()
            .filter(|path| {
                path.file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.starts_with("group_") && n.ends_with(".tsv"))
            })
            .collect();
        tables.sort();
        tables
    }

    /// `Some(true)` when outputs were made from another raw version.
    fn stale(&self, raw_version: Option<&str>) -> bool {
        matches!((self.source_version.as_deref(), raw_version), (Some(a), Some(b)) if a != b)
    }
}

/// Outputs seen for a pipeline, from one walk of its root.
#[derive(Debug, Default)]
pub(crate) struct Coverage {
    run_keys: HashSet<String>,
    subjects: HashSet<String>,
}

impl Coverage {
    pub fn add_name(&mut self, file_name: &str) {
        let stem = file_name.split('.').next().unwrap_or(file_name);
        if stem.starts_with("sub-") && !stem.contains('_') {
            self.subjects.insert(stem.trim_start_matches("sub-").into());
        }
        if let Some(name) = parse_name(file_name) {
            if let Some(subject) = name.subject() {
                self.subjects.insert(subject.to_string());
            }
            if name.entity("task").is_some() {
                self.run_keys.insert(run_key(&name));
            }
        }
    }

    pub fn add_subject_dir(&mut self, subject: &str) {
        self.subjects.insert(subject.to_string());
    }
}

/// Read `bids_name` from MRIQC group tables, which cover runs even when the
/// per-run reports were cleaned up.
pub(crate) fn add_group_rows(
    root: &Path,
    pipeline: &Pipeline,
    coverage: &mut Coverage,
    files: &ScanFiles,
) {
    for path in pipeline.group_tables(root, files) {
        let Ok(mut reader) = files.tsv(&path) else {
            continue;
        };
        for record in reader.records().flatten() {
            if let Some(name) = record.get(0) {
                coverage.add_name(&format!("{name}.nii.gz"));
            }
        }
    }
}

pub(crate) struct DerivativeSummary {
    pub infos: Vec<BidsDerivativeInfo>,
    pub status: Vec<BidsSubjectDerivative>,
    pub findings: Vec<BidsFinding>,
}

/// Pipelines with task-level outputs are counted per bold run, the others per
/// subject. A stale pipeline marks present outputs stale.
pub(crate) fn summarize(
    pipelines: &[Pipeline],
    coverage: &[Coverage],
    subjects: &[String],
    absent: &[&str],
    runs: &[BidsRunRecord],
    raw_version: Option<&str>,
) -> DerivativeSummary {
    let is_present = |subject: &&String| !absent.contains(&subject.as_str());
    // Echoes and parts of one acquisition are one run to a pipeline.
    let mut bold_keys: Vec<(&str, String)> = runs
        .iter()
        .filter(|run| run.suffix == "bold")
        .filter_map(|run| {
            let name = parse_name(&format!("{}.nii", run.id))?;
            Some((run.subject.as_str(), run_key(&name)))
        })
        .collect();
    bold_keys.sort();
    bold_keys.dedup();
    let mut out = DerivativeSummary {
        infos: Vec::new(),
        status: Vec::new(),
        findings: Vec::new(),
    };
    for (pipeline, seen) in pipelines.iter().zip(coverage) {
        let per_run = !seen.run_keys.is_empty();
        let stale = pipeline.stale(raw_version);
        let (done, of);
        if per_run {
            done = bold_keys
                .iter()
                .filter(|(_, key)| seen.run_keys.contains(key))
                .count();
            of = bold_keys.len();
        } else {
            let present = || subjects.iter().filter(is_present);
            done = present().filter(|s| seen.subjects.contains(*s)).count();
            of = present().count();
        }
        for subject in subjects {
            let status = if !is_present(&subject) {
                NO_LOCAL_DATA
            } else if per_run {
                let own: Vec<&String> = bold_keys
                    .iter()
                    .filter(|(run_subject, _)| run_subject == subject)
                    .map(|(_, key)| key)
                    .collect();
                let present = own
                    .iter()
                    .filter(|key| seen.run_keys.contains(**key))
                    .count();
                if present == 0 && !(own.is_empty() && seen.subjects.contains(subject)) {
                    "missing"
                } else if present < own.len() {
                    "partial"
                } else {
                    "current"
                }
            } else if seen.subjects.contains(subject) {
                "current"
            } else {
                "missing"
            };
            let status = match status {
                "current" if stale => "stale",
                // Without a source version, "current" would be a guess.
                "current" if pipeline.source_version.is_none() => UNRECORDED,
                other => other,
            };
            out.status.push(BidsSubjectDerivative {
                subject: subject.clone(),
                name: pipeline.name.clone(),
                status: status.to_string(),
            });
        }
        if stale {
            out.findings.push(stale_finding(pipeline, raw_version));
        }
        out.infos.push(BidsDerivativeInfo {
            name: pipeline.name.clone(),
            version: pipeline.version.clone(),
            source_version: pipeline.source_version.clone(),
            stale,
            runs: done as u32,
            of: of as u32,
            unit: if per_run { "run" } else { "subject" }.to_string(),
            root: pipeline.root.clone(),
        });
    }
    out
}

fn stale_finding(pipeline: &Pipeline, raw_version: Option<&str>) -> BidsFinding {
    finding(FindingSpec {
        tag: "content",
        severity: "warning",
        code: "DERIVATIVE_STALE",
        title: format!("{} was built from another dataset version", pipeline.name),
        detail: format!(
            "SourceDatasets names version {}; the raw dataset is {}.",
            pipeline.source_version.as_deref().unwrap_or("unknown"),
            raw_version.unwrap_or("unknown")
        ),
        subject: None,
        session: None,
        run_ids: Vec::new(),
        file: Some(format!("{}/dataset_description.json", pipeline.root)),
    })
}

/// One line per pipeline for the inspector.
pub(crate) fn pipeline_checks(pipelines: &[Pipeline], raw_version: Option<&str>) -> Vec<BidsCheck> {
    pipelines
        .iter()
        .map(|pipeline| {
            let stale = pipeline.stale(raw_version);
            let text = match (&pipeline.source_version, raw_version) {
                (Some(source), Some(raw)) if stale => {
                    format!("{}: built from {source}, raw is {raw}", pipeline.label())
                }
                (Some(source), _) => format!("{}: built from {source}", pipeline.label()),
                _ => format!("{}: source version not recorded", pipeline.label()),
            };
            BidsCheck {
                ok: !stale,
                severity: if stale { "warning" } else { "ok" }.to_string(),
                text,
            }
        })
        .collect()
}
