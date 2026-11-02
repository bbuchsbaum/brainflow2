//! Scans of real public datasets, run by hand. They are `#[ignore]`d because
//! the data is not in the repository:
//!
//! ```text
//! BRAINFLOW_BIDS_DATA=/path/to/brainflow-bids \
//! BRAINFLOW_BIDS_REPORT=/some/report/dir \
//!   cargo test -p api-bridge --lib real_data -- --ignored --nocapture
//! ```
//!
//! `BRAINFLOW_BIDS_DATA` holds one folder per dataset. Without it a test
//! prints why and passes. Each run writes `<dataset>.json`, `<dataset>.txt`
//! and its index cache into a fresh folder below `BRAINFLOW_BIDS_REPORT`,
//! which must lie outside the datasets. Nothing is written into a dataset: the
//! exclusion writer runs on a copy of its small files in that folder.

use super::exclusions::{revert_exclusions, write_exclusions};
use super::scan::{run_detail, run_scan, ScanRequest};
use super::sha256_hex;
use bridge_types::bids::*;
use serde_json::json;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::time::{Instant, UNIX_EPOCH};

fn data_root() -> Option<PathBuf> {
    match std::env::var_os("BRAINFLOW_BIDS_DATA") {
        Some(path) => Some(PathBuf::from(path)),
        None => {
            eprintln!("BRAINFLOW_BIDS_DATA is not set; skipping the real-data scan.");
            None
        }
    }
}

/// Fresh output folder, so a cold scan is cold and nothing needs deleting.
fn output_dir(dataset: &Path, name: &str) -> PathBuf {
    let base = PathBuf::from(
        std::env::var_os("BRAINFLOW_BIDS_REPORT")
            .expect("BRAINFLOW_BIDS_REPORT must be set with BRAINFLOW_BIDS_DATA"),
    );
    let dataset = dataset.canonicalize().expect("dataset exists");
    std::fs::create_dir_all(&base).expect("report folder");
    let base = base.canonicalize().expect("report folder exists");
    assert!(
        !base.starts_with(&dataset),
        "the report folder must lie outside the dataset"
    );
    let dir = base
        .join(format!("{}", uuid::Uuid::new_v4()))
        .join(format!("{name}-cache"));
    std::fs::create_dir_all(&dir).expect("cache folder");
    dir
}

/// `(path, size, mtime)` of every file, sorted and hashed.
fn tree_hash(root: &Path) -> (String, usize) {
    fn walk(dir: &Path, root: &Path, out: &mut Vec<String>) {
        for entry in std::fs::read_dir(dir).expect("readable folder").flatten() {
            let path = entry.path();
            let meta = std::fs::symlink_metadata(&path).expect("stat");
            if meta.is_dir() {
                walk(&path, root, out);
                continue;
            }
            let mtime = meta
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map_or(0, |since| since.as_nanos());
            let rel = path.strip_prefix(root).expect("below root").display();
            out.push(format!("{rel}|{}|{mtime}", meta.len()));
        }
    }
    let mut lines = Vec::new();
    walk(root, root, &mut lines);
    lines.sort();
    let refs: Vec<&str> = lines.iter().map(String::as_str).collect();
    (sha256_hex(&refs), lines.len())
}

fn scan(dataset: &Path, cache: &Path) -> (BidsBrowserIndex, f64) {
    let cancel = AtomicBool::new(false);
    let request = ScanRequest {
        dataset,
        scan_id: "real-data",
        remote: None,
        cache_root: cache,
    };
    let start = Instant::now();
    let index = run_scan(&request, &cancel, |_| {}).expect("scan succeeds");
    (index, start.elapsed().as_secs_f64())
}

fn count_by<'a>(items: impl Iterator<Item = &'a str>) -> BTreeMap<&'a str, usize> {
    let mut counts = BTreeMap::new();
    for item in items {
        *counts.entry(item).or_default() += 1;
    }
    counts
}

fn summary_text(index: &BidsBrowserIndex, times: &[f64; 3], files: usize, hash: &str) -> String {
    let bold: Vec<&BidsRunRecord> = index.runs.iter().filter(|r| r.suffix == "bold").collect();
    let count = |test: &dyn Fn(&BidsRunRecord) -> bool| bold.iter().filter(|r| test(r)).count();
    let mut out = format!(
        "{} (BIDS {}, version {:?})\nscanner: {:?}\nlicense: {:?}\n",
        index.name, index.bids_version, index.dataset_version, index.scanner, index.license
    );
    out += &format!(
        "subjects {} of which with runs {}; participants {}\n",
        index.subjects.len(),
        count_by(index.runs.iter().map(|r| r.subject.as_str())).len(),
        index.participants.len()
    );
    out += &format!(
        "runs {}; bold {}; with FD {}; with IQMs {}; with events {}\n",
        index.runs.len(),
        bold.len(),
        count(&|r| r.fd.is_some()),
        count(&|r| r.iqms.is_some()),
        count(&|r| r.has_events),
    );
    out += &format!(
        "scan seconds: cold {:.3}, repeat {:.3}, repeat {:.3}\n",
        times[0], times[1], times[2]
    );
    out += &format!(
        "files read: {}; tree {files} files, {hash}\n",
        index.files_opened
    );
    out += "\nseries\n";
    for (series, n) in count_by(index.runs.iter().map(|r| r.series.as_str())) {
        out += &format!("  {series}: {n}\n");
    }
    out += "\nvariants\n";
    for variant in &index.variants {
        out += &format!(
            "  {} {} ({} runs): {} [{}]\n",
            variant.series,
            variant.id,
            variant.run_ids.len(),
            variant.name,
            variant.diff
        );
    }
    out += "\nderivatives\n";
    for info in &index.derivatives {
        out += &format!(
            "  {} {:?} from {:?}, stale {}, {} of {} {}s\n",
            info.name, info.version, info.source_version, info.stale, info.runs, info.of, info.unit
        );
    }
    out += "\nderivative status\n";
    let status = index
        .derivative_status
        .iter()
        .map(|row| format!("{} {}", row.name, row.status));
    let status: Vec<String> = status.collect();
    for (row, n) in count_by(status.iter().map(String::as_str)) {
        out += &format!("  {row}: {n}\n");
    }
    out += "\nfindings by tag, severity, code\n";
    let keys: Vec<String> = index
        .findings
        .iter()
        .map(|f| format!("{} {} {}", f.tag, f.severity, f.code))
        .collect();
    for (key, n) in count_by(keys.iter().map(String::as_str)) {
        out += &format!("  {key}: {n}\n");
    }
    out
}

/// Scan three times, confirm the tree did not change, and write the report.
fn report(name: &str, detail_ids: &[&str]) -> Option<BidsBrowserIndex> {
    let dataset = data_root()?.join(name);
    let cache = output_dir(&dataset, name);
    let dir = cache.parent().expect("cache has a parent").to_path_buf();
    let (before, files) = tree_hash(&dataset);
    let (index, cold) = scan(&dataset, &cache);
    let (repeat, first_repeat) = scan(&dataset, &cache);
    let (_, second_repeat) = scan(&dataset, &cache);
    let (after, _) = tree_hash(&dataset);
    assert_eq!(before, after, "the scan changed {name}");
    assert_eq!(repeat.runs.len(), index.runs.len());
    assert_eq!(repeat.findings.len(), index.findings.len());
    assert_eq!(repeat.files_opened, 0.0, "a repeat scan re-read files");

    let details: BTreeMap<&str, Result<BidsRunDetail, String>> = detail_ids
        .iter()
        .map(|id| (*id, run_detail(&dataset, id)))
        .collect();
    let timing = [cold, first_repeat, second_repeat];
    let text = summary_text(&index, &timing, files, &before);
    println!("{text}");
    let value = json!({
        "timing_seconds": { "cold": cold, "repeat": first_repeat, "repeat_again": second_repeat },
        "tree": { "files": files, "sha256": before },
        "index": index,
        "details": details,
    });
    let bytes = serde_json::to_vec_pretty(&value).expect("report encodes");
    std::fs::write(dir.join(format!("{name}.json")), bytes).expect("report written");
    std::fs::write(dir.join(format!("{name}.txt")), text).expect("summary written");
    println!("report: {}", dir.display());
    Some(index)
}

fn bold_runs(index: &BidsBrowserIndex) -> Vec<&BidsRunRecord> {
    index.runs.iter().filter(|r| r.suffix == "bold").collect()
}

fn all_bold(index: &BidsBrowserIndex, test: impl Fn(&BidsRunRecord) -> bool) -> bool {
    bold_runs(index).into_iter().all(test)
}

/// Every peak avoids flagged frames and the frame after them. Returns how many
/// bold runs have flags and how many peaks land in the first two frames.
fn peak_landing(index: &BidsBrowserIndex) -> (usize, usize) {
    let (mut flagged, mut early) = (0, 0);
    for run in bold_runs(index) {
        let Some(fd) = &run.fd else { continue };
        let flags = &fd.non_steady_volumes;
        flagged += usize::from(!flags.is_empty());
        early += usize::from(fd.peak_volume < 2);
        assert!(!flags.contains(&fd.peak_volume), "{}", run.id);
        assert!(
            fd.peak_volume == 0 || !flags.contains(&(fd.peak_volume - 1)),
            "{}",
            run.id
        );
        let leading = flags.iter().zip(0u32..).filter(|(v, i)| **v == *i).count();
        assert_eq!(fd.first_valid_volume as usize, leading, "{}", run.id);
    }
    println!(
        "{}: {flagged} runs flagged, {early} peaks in the first 2 frames",
        index.name
    );
    (flagged, early)
}

#[test]
#[ignore = "needs BRAINFLOW_BIDS_DATA"]
fn real_data_ds000114() {
    let details = [
        "sub-01_ses-test_task-fingerfootlips_bold",
        "sub-01_ses-test_task-linebisection_bold",
        "sub-09_ses-retest_task-overtwordrepetition_bold",
    ];
    let Some(index) = report("ds000114", &details) else {
        return;
    };
    // Numbers below were established from the files, without this code.
    assert_eq!((index.runs.len(), bold_runs(&index).len()), (140, 100));
    assert_eq!(index.subjects.len(), 10);
    assert_eq!(index.license, None);
    assert_eq!(index.scanner, None, "no sidecar names a scanner");
    assert!(all_bold(&index, |r| r.has_events));
    assert!(all_bold(&index, |r| r.fd.is_some() && r.iqms.is_some()));
    // Real: one permuted T1w grid and one dwi at 1 mm in-plane. Voxel-size
    // noise in the third decimal is not a variant.
    let variants: Vec<(&str, usize)> = index
        .variants
        .iter()
        .map(|v| (v.series.as_str(), v.run_ids.len()))
        .collect();
    assert_eq!(variants, [("T1w", 1), ("dwi", 1)]);
    assert!(index.derivatives.iter().all(|d| !d.stale));
    // Every run has a non-steady volume, and 97 raw peaks were the jump out.
    assert_eq!(peak_landing(&index), (100, 0));
}

#[test]
#[ignore = "needs BRAINFLOW_BIDS_DATA"]
fn real_data_ds001734() {
    let Some(index) = report("ds001734", &["sub-001_task-MGT_run-01_bold"]) else {
        return;
    };
    assert_eq!((index.runs.len(), bold_runs(&index).len()), (84, 28));
    assert_eq!(index.subjects.len(), 108);
    assert_eq!(index.scanner.as_deref(), Some("SIEMENS Prisma 3T"));
    assert!(index.variants.is_empty());
    assert_eq!(peak_landing(&index), (11, 0));
    assert!(all_bold(&index, |r| r.has_events
        && r.fd.is_some()
        && r.iqms.is_some()));
    assert!(all_bold(&index, |r| r
        .fmap
        .as_ref()
        .is_some_and(|link| link.via == "IntendedFor")));
    let note: Vec<&BidsFinding> = index
        .findings
        .iter()
        .filter(|f| f.code == "PARTICIPANTS_WITHOUT_DATA")
        .collect();
    assert_eq!(note.len(), 1);
    assert!(
        index.findings.len() < 10,
        "{} findings",
        index.findings.len()
    );
    let without_data = |name: &str| {
        index
            .derivative_status
            .iter()
            .filter(|row| row.name == name && row.status == "no_local_data")
            .count()
    };
    assert_eq!(
        (without_data("fmriprep"), without_data("mriqc")),
        (101, 101)
    );
}

/// Sidecars and tables of the raw tree, and no images: the root files, the
/// pipeline descriptions and two subjects.
fn copy_small_files(from: &Path, to: &Path) {
    fn copy_if_small(file: &Path, from: &Path, to: &Path) {
        let small = file
            .extension()
            .is_some_and(|ext| ext == "json" || ext == "tsv");
        let keep = small || file.parent() == Some(from);
        if keep && file.is_file() {
            let target = to.join(file.strip_prefix(from).expect("below root"));
            std::fs::create_dir_all(target.parent().expect("has parent")).expect("mkdir");
            std::fs::copy(file, target).expect("copy");
        }
    }
    for entry in std::fs::read_dir(from).expect("dataset").flatten() {
        copy_if_small(&entry.path(), from, to);
    }
    for pipeline in ["fmriprep", "mriqc"] {
        let file = from.join("derivatives").join(pipeline);
        copy_if_small(&file.join("dataset_description.json"), from, to);
    }
    for subject in ["sub-01", "sub-02"] {
        for entry in walkdir::WalkDir::new(from.join(subject))
            .into_iter()
            .flatten()
        {
            copy_if_small(entry.path(), from, to);
        }
    }
}

/// Every file's bytes, by relative path.
fn bytes_of(root: &Path) -> BTreeMap<String, Vec<u8>> {
    walkdir::WalkDir::new(root)
        .into_iter()
        .flatten()
        .filter(|entry| entry.file_type().is_file())
        .map(|entry| {
            let rel = entry.path().strip_prefix(root).expect("below root");
            let bytes = std::fs::read(entry.path()).expect("read");
            (rel.to_string_lossy().into_owned(), bytes)
        })
        .collect()
}

#[test]
#[ignore = "needs BRAINFLOW_BIDS_DATA"]
fn real_data_exclusions_on_a_copy() {
    let Some(data) = data_root() else {
        return;
    };
    let source = data.join("ds000114");
    let cache = output_dir(&source, "exclusions");
    let dir = cache.parent().expect("cache has a parent");
    let copy = dir.join("ds000114-copy");
    copy_small_files(&source, &copy);
    let raw_before = bytes_of(&copy);

    let row = |entity: &str, reason: &str| BidsExclusion {
        entity: entity.to_string(),
        scope: String::new(),
        reason: reason.to_string(),
        criterion: "mean FD > 0.25 mm".to_string(),
        value: "0.31".to_string(),
        author: "real-data test".to_string(),
        date: "2026-11-01".to_string(),
        source: "fmriprep 21.0.2 confounds".to_string(),
        threshold: "0.25".to_string(),
        definition: "Power".to_string(),
        triggered_by: String::new(),
    };
    let rows = [
        row(
            "sub-01_ses-test_task-fingerfootlips_bold",
            "head motion\tduring task",
        ),
        row("sub-02_ses-retest", ""),
        row("sub-02", "withdrew"),
    ];
    let context = BidsExclusionContext {
        source_version: Some("1.0.1".to_string()),
    };
    let written = write_exclusions(&copy, &rows, &context, "0.0.0-test").expect("write");
    assert_eq!(written.all.len(), 3);
    let (index, _) = scan(&copy, &cache);
    assert_eq!(index.exclusions.len(), 3);

    // Kept for checking with other tools.
    let out = copy.join("derivatives/brainflow");
    let kept = dir.join("after-write");
    std::fs::create_dir_all(&kept).expect("mkdir");
    for name in [
        "exclusions.tsv",
        "exclusions.json",
        "dataset_description.json",
    ] {
        std::fs::copy(out.join(name), kept.join(name)).expect("keep");
    }

    let key = |row: &BidsExclusion| BidsExclusionKey {
        entity: row.entity.clone(),
        criterion: row.criterion.clone(),
    };
    let left = revert_exclusions(&copy, &[key(&rows[0])]).expect("revert");
    assert_eq!(left.len(), 2);
    let left = revert_exclusions(&copy, &[key(&rows[1]), key(&rows[2])]).expect("revert");
    assert!(left.is_empty());

    let mut raw_after = bytes_of(&copy);
    let added: Vec<String> = raw_after
        .keys()
        .filter(|path| path.starts_with("derivatives/brainflow/"))
        .cloned()
        .collect();
    assert_eq!(added.len(), 3, "{added:?}");
    raw_after.retain(|path, _| !path.starts_with("derivatives/brainflow/"));
    assert_eq!(raw_before, raw_after, "the raw tree changed");
    println!("exclusions: {}", dir.display());
}
