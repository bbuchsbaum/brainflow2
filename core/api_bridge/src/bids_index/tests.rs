//! Temp-dir fixtures. Every dataset here is synthetic.

use super::derivatives::Pipeline;
use super::events::check_events;
use super::exclusions::{read_exclusions, revert_exclusions, write_exclusions, DatasetLock};
use super::fd::{self, read_fd, FdTrace};
use super::images::{self, plan_axial, Affine3x4};
use super::meta::{canonical, SidecarResolver};
use super::remote::{RemoteDataset, RemoteEntry, RemoteKind, MAX_FETCHED_FILE_BYTES};
use super::scan::{run_detail, run_events, run_scan, ScanControl, ScanRequest};
use super::{natural_cmp, parse_name, series_label};
use bridge_types::bids::*;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

struct TempDataset {
    dir: PathBuf,
    root: PathBuf,
    cache: PathBuf,
}

impl TempDataset {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!("bf-bids-{}", uuid::Uuid::new_v4()));
        let root = dir.join("ds");
        let cache = dir.join("cache");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&cache).unwrap();
        let this = Self {
            dir,
            root: root.canonicalize().unwrap(),
            cache,
        };
        this.json(
            "dataset_description.json",
            json!({"Name": "Synthetic", "BIDSVersion": "1.9.0", "DatasetVersion": "1.2.0",
                   "License": "CC0", "Authors": ["A. Example"]}),
        );
        this.text(
            "participants.tsv",
            "participant_id\tage\tgroup\nsub-01\t30\tcontrol\nsub-02\t31\tpatient\n",
        );
        this
    }

    fn path(&self, rel: &str) -> PathBuf {
        self.root.join(rel)
    }

    fn text(&self, rel: &str, content: &str) {
        let path = self.path(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, content).unwrap();
    }

    fn json(&self, rel: &str, value: Value) {
        self.text(rel, &value.to_string());
    }

    /// A 4x4x3 image with `volumes` volumes (3D when `None`) and TR in pixdim[4].
    fn nifti(&self, rel: &str, volumes: Option<usize>, tr: f32) {
        let path = self.path(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        write_nifti(
            &path,
            [4, 4, 3],
            volumes,
            [2.0, 2.0, 3.0],
            [-3.0, 5.0, -30.0],
            tr,
        );
    }

    fn scan(&self) -> BidsBrowserIndex {
        self.scan_with(None, |_| {})
    }

    fn scan_with(
        &self,
        remote: Option<&dyn RemoteDataset>,
        on_progress: impl FnMut(BidsScanProgress),
    ) -> BidsBrowserIndex {
        // On a server the tree is `root`, and the local mirror holds nothing.
        let mirror = self.cache.join("empty-mirror");
        let request = ScanRequest {
            dataset: if remote.is_some() {
                &mirror
            } else {
                &self.root
            },
            scan_id: "test-scan",
            remote,
            cache_root: &self.cache,
        };
        run_scan(&request, &AtomicBool::new(false), on_progress).unwrap()
    }

    fn project(&self) -> bids_rs::BidsProject {
        bids_rs::BidsProject::with_options(&self.root, bids_rs::DerivativesMode::None, false)
            .unwrap()
    }
}

/// A server over a local tree that answers with one header, or fails headers
/// while `failing` is set. It records what it was asked for.
struct FakeServer {
    tree: PathBuf,
    failing: AtomicBool,
    /// Header paths asked for.
    asked: std::sync::Mutex<Vec<String>>,
    fetched: std::sync::Mutex<Vec<String>>,
    listed: std::sync::Mutex<Vec<String>>,
    /// Directories that fail to list.
    unlistable: std::sync::Mutex<Vec<String>>,
    /// Sizes reported instead of the real one.
    sizes: std::sync::Mutex<HashMap<String, u64>>,
    /// Files that fail to fetch.
    unfetchable: std::sync::Mutex<Vec<String>>,
}

impl FakeServer {
    fn new(ds: &TempDataset, failing: bool) -> Self {
        Self {
            tree: ds.root.clone(),
            failing: AtomicBool::new(failing),
            asked: Default::default(),
            fetched: Default::default(),
            listed: Default::default(),
            unlistable: Default::default(),
            sizes: Default::default(),
            unfetchable: Default::default(),
        }
    }

    fn fetched(&self) -> Vec<String> {
        self.fetched.lock().unwrap().clone()
    }

    fn entry(&self, rel: &str, path: &Path) -> RemoteEntry {
        let name = path.file_name().unwrap().to_str().unwrap().to_string();
        let symlink = path.is_symlink();
        let target = std::fs::metadata(path).ok();
        let kind = match &target {
            None => RemoteKind::Dangling,
            Some(meta) if meta.is_dir() => RemoteKind::Directory,
            Some(_) => RemoteKind::File,
        };
        let child = if rel.is_empty() {
            name.clone()
        } else {
            format!("{rel}/{name}")
        };
        RemoteEntry {
            name,
            kind,
            size: self
                .sizes
                .lock()
                .unwrap()
                .get(&child)
                .copied()
                .or(target.as_ref().map(|meta| meta.len()))
                .unwrap_or(0),
            modified: target.and_then(|meta| meta.modified().ok()),
            symlink,
        }
    }
}

impl RemoteDataset for FakeServer {
    fn list(&self, rel_dirs: &[String]) -> Vec<Result<Vec<RemoteEntry>, String>> {
        self.listed.lock().unwrap().extend_from_slice(rel_dirs);
        rel_dirs
            .iter()
            .map(|rel| {
                if self.unlistable.lock().unwrap().contains(rel) {
                    return Err("permission denied".to_string());
                }
                let entries = std::fs::read_dir(self.tree.join(rel)).map_err(|e| e.to_string())?;
                Ok(entries
                    .flatten()
                    .map(|entry| self.entry(rel, &entry.path()))
                    .collect())
            })
            .collect()
    }

    fn fetch(&self, rel_paths: &[String], max_bytes: u64) -> Vec<Result<Vec<u8>, String>> {
        self.fetched.lock().unwrap().extend_from_slice(rel_paths);
        rel_paths
            .iter()
            .map(|rel| {
                if self.unfetchable.lock().unwrap().contains(rel) {
                    return Err("connection lost".to_string());
                }
                let bytes = std::fs::read(self.tree.join(rel)).map_err(|e| e.to_string())?;
                if bytes.len() as u64 > max_bytes {
                    return Err("larger than the bound".to_string());
                }
                Ok(bytes)
            })
            .collect()
    }

    fn headers(&self, rel_paths: &[String]) -> Vec<Result<nifti_loader::HeaderSummary, String>> {
        self.asked.lock().unwrap().extend_from_slice(rel_paths);
        rel_paths
            .iter()
            .map(|_| {
                if self.failing.load(Ordering::Relaxed) {
                    return Err("connection lost".to_string());
                }
                Ok(nifti_loader::HeaderSummary {
                    dim: vec![64, 64, 30, 100],
                    pixdim: vec![2.0, 2.0, 2.0, 1.5],
                    qform_code: 1,
                    sform_code: 1,
                    tr_seconds: Some(1.5),
                    n_volumes: Some(100),
                })
            })
            .collect()
    }
}

impl Drop for TempDataset {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn write_nifti(
    path: &Path,
    dim: [usize; 3],
    volumes: Option<usize>,
    spacing: [f32; 3],
    origin: [f32; 3],
    tr: f32,
) {
    let mut header = nifti::NiftiHeader {
        sform_code: 1,
        qform_code: 0,
        srow_x: [spacing[0], 0.0, 0.0, origin[0]],
        srow_y: [0.0, spacing[1], 0.0, origin[1]],
        srow_z: [0.0, 0.0, spacing[2], origin[2]],
        xyzt_units: 2 | 8,
        ..Default::default()
    };
    header.pixdim[1..4].copy_from_slice(&spacing);
    header.pixdim[4] = tr;
    let writer = nifti::writer::WriterOptions::new(path).reference_header(&header);
    match volumes {
        Some(n_t) => {
            let array = ndarray::Array4::<f32>::from_shape_fn(
                (dim[0], dim[1], dim[2], n_t),
                |(x, y, z, t)| 100.0 + (x + 10 * y + 100 * z) as f32 + t as f32,
            );
            writer.write_nifti(&array).unwrap();
        }
        None => {
            let array =
                ndarray::Array3::<f32>::from_shape_fn((dim[0], dim[1], dim[2]), |(x, y, z)| {
                    1.0 + (x + 10 * y + 100 * z) as f32
                });
            writer.write_nifti(&array).unwrap();
        }
    }
}

fn run<'a>(index: &'a BidsBrowserIndex, id: &str) -> &'a BidsRunRecord {
    index
        .runs
        .iter()
        .find(|run| run.id == id)
        .unwrap_or_else(|| {
            panic!(
                "no run {id}: {:?}",
                index.runs.iter().map(|r| &r.id).collect::<Vec<_>>()
            )
        })
}

fn meta<'a>(record: &'a BidsRunRecord, key: &str) -> &'a BidsMetaValue {
    record
        .sidecar
        .iter()
        .find(|entry| entry.key == key)
        .unwrap()
}

fn codes(index: &BidsBrowserIndex) -> Vec<&str> {
    index.findings.iter().map(|f| f.code.as_str()).collect()
}

fn with_code<'a>(index: &'a BidsBrowserIndex, code: &str) -> Vec<&'a BidsFinding> {
    index.findings.iter().filter(|f| f.code == code).collect()
}

fn parsed(name: &str) -> super::ParsedName {
    parse_name(name).unwrap()
}

#[test]
fn bids_names_parse_and_series_keep_acquisitions_apart() {
    assert_eq!(
        series_label(&parsed("sub-01_task-nback_run-1_bold.nii.gz")),
        "task-nback_bold"
    );
    assert_eq!(series_label(&parsed("sub-01_ses-02_T1w.nii")), "T1w");
    assert_eq!(
        series_label(&parsed("sub-01_dir-AP_epi.nii.gz")),
        "epi_dir-AP"
    );
    assert_eq!(
        series_label(&parsed(
            "sub-01_task-a_acq-mb6_ce-x_rec-y_dir-PA_echo-2_run-3_bold.nii"
        )),
        "task-a_acq-mb6_ce-x_rec-y_dir-PA_echo-2_bold"
    );
    assert!(parse_name("README").is_none());
    assert!(parse_name("dataset_description.json").is_none());
}

#[test]
fn bids_natural_order_puts_run_10_after_run_2() {
    let mut names = vec!["run-10", "run-2", "run-1", "run-02x"];
    names.sort_by(|a, b| natural_cmp(a, b));
    assert_eq!(names, ["run-1", "run-2", "run-02x", "run-10"]);
}

#[test]
fn bids_runs_are_images_with_series_and_natural_order() {
    let ds = TempDataset::new();
    for run in [1, 2, 10] {
        let stem = format!("sub-01/func/sub-01_task-a_run-{run}_bold");
        ds.nifti(&format!("{stem}.nii.gz"), Some(5), 2.0);
        ds.json(&format!("{stem}.json"), json!({"RepetitionTime": 2.0}));
    }
    ds.nifti("sub-01/fmap/sub-01_dir-AP_epi.nii.gz", Some(2), 7.0);
    ds.nifti("sub-01/fmap/sub-01_dir-PA_epi.nii.gz", Some(2), 7.0);
    ds.nifti("sub-01/dwi/sub-01_dwi.nii.gz", Some(3), 3.0);
    ds.text("sub-01/dwi/sub-01_dwi.bval", "0 1000 1000\n");
    ds.text("sub-01/dwi/sub-01_dwi.bvec", "0 1 0\n0 0 1\n0 0 0\n");
    // A derivative image is not a run.
    ds.nifti(
        "derivatives/fmriprep/sub-01/func/sub-01_task-a_run-1_space-MNI_desc-preproc_bold.nii.gz",
        Some(5),
        2.0,
    );
    // On disk, absent from participants.tsv.
    ds.nifti("sub-03/anat/sub-03_T1w.nii.gz", None, 0.0);

    let index = ds.scan();
    let ids: Vec<&str> = index.runs.iter().map(|r| r.id.as_str()).collect();
    assert_eq!(index.runs.len(), 7, "{ids:?}");
    let bold: Vec<&str> = ids
        .iter()
        .copied()
        .filter(|id| id.ends_with("bold"))
        .collect();
    assert_eq!(
        bold,
        [
            "sub-01_task-a_run-1_bold",
            "sub-01_task-a_run-2_bold",
            "sub-01_task-a_run-10_bold"
        ]
    );
    assert_eq!(run(&index, "sub-01_dir-AP_epi").series, "epi_dir-AP");
    assert_eq!(run(&index, "sub-01_dir-PA_epi").series, "epi_dir-PA");
    assert_eq!(
        run(&index, "sub-01_task-a_run-10_bold").series,
        "task-a_bold"
    );
    assert_eq!(index.subjects, ["01", "02", "03"]);
    let header = run(&index, "sub-01_task-a_run-1_bold")
        .header
        .as_ref()
        .unwrap();
    assert_eq!(header.n_volumes, Some(5));
    assert_eq!(header.dim, [4, 4, 3, 5]);
    assert_eq!(index.participant_columns, ["age", "group"]);
    assert_eq!(index.dataset_version.as_deref(), Some("1.2.0"));
    assert!(index.complete);
}

#[test]
fn bids_missing_participants_tsv_does_not_fail_the_scan() {
    let ds = TempDataset::new();
    std::fs::remove_file(ds.path("participants.tsv")).unwrap();
    ds.nifti("sub-07/anat/sub-07_T1w.nii.gz", None, 0.0);
    let index = ds.scan();
    assert_eq!(index.subjects, ["07"]);
    assert_eq!(index.runs.len(), 1);
}

#[test]
fn bids_unreadable_headers_do_not_stop_a_scan() {
    let ds = TempDataset::new();
    // A NIfTI-2 sizeof_hdr, then nothing this nifti version can parse.
    let mut bytes = 540i32.to_le_bytes().to_vec();
    bytes.resize(600, 0);
    ds.text("sub-01/anat/.keep", "");
    std::fs::write(ds.path("sub-01/anat/sub-01_T1w.nii"), bytes).unwrap();
    let index = ds.scan();
    let record = run(&index, "sub-01_T1w");
    assert!(record.header.is_none());
    assert_eq!(with_code(&index, "HEADER_UNREADABLE").len(), 1);
}

#[test]
fn bids_provenance_names_the_file_in_the_chain_that_supplied_each_key() {
    let ds = TempDataset::new();
    ds.json(
        "task-a_bold.json",
        json!({"RepetitionTime": 2.0, "EchoTime": 0.03, "FlipAngle": 70}),
    );
    ds.json("sub-01/sub-01_task-a_bold.json", json!({"FlipAngle": 60}));
    let stem = "sub-01/func/sub-01_task-a_run-1_bold";
    ds.nifti(&format!("{stem}.nii.gz"), Some(4), 2.0);
    ds.json(&format!("{stem}.json"), json!({"EchoTime": 0.035}));
    let index = ds.scan();
    let record = run(&index, "sub-01_task-a_run-1_bold");

    let tr = meta(record, "RepetitionTime");
    assert_eq!(tr.value, "2.0");
    assert_eq!(tr.source, "task-a_bold.json");
    assert_eq!(tr.source_kind, "dataset");
    let te = meta(record, "EchoTime");
    assert_eq!(te.value, "0.035");
    assert_eq!(te.source, format!("{stem}.json"));
    assert_eq!(te.source_kind, "run");
    let flip = meta(record, "FlipAngle");
    assert_eq!(flip.value, "60");
    assert_eq!(flip.source, "sub-01/sub-01_task-a_bold.json");
    assert_eq!(meta(record, "VoxelSize").source_kind, "nifti");
    assert_eq!(meta(record, "VoxelSize").source, "NIfTI");
}

#[test]
fn bids_resolver_agrees_with_the_library_merge_order() {
    let ds = TempDataset::new();
    ds.json("task-a_bold.json", json!({"A": 1, "B": 1}));
    ds.json("task-a_run-1_bold.json", json!({"B": 2}));
    ds.json("task-b_bold.json", json!({"A": 9}));
    let stem = "sub-01/func/sub-01_task-a_run-1_bold";
    ds.nifti(&format!("{stem}.nii.gz"), Some(2), 2.0);
    let file = ds.path(&format!("{stem}.nii.gz"));
    let project = ds.project();
    let effective = SidecarResolver::new(&project).effective(&file);
    assert_eq!(effective["A"].value, json!(1));
    assert_eq!(effective["B"].value, json!(2));
    assert_eq!(effective["B"].source, "task-a_run-1_bold.json");
}

#[test]
fn bids_a_malformed_inherited_sidecar_is_reported_once_and_keeps_direct_values() {
    let ds = TempDataset::new();
    ds.text("task-a_bold.json", "{ not json");
    for subject in ["01", "02"] {
        let stem = format!("sub-{subject}/func/sub-{subject}_task-a_bold");
        ds.nifti(&format!("{stem}.nii.gz"), Some(2), 2.0);
        ds.json(&format!("{stem}.json"), json!({"RepetitionTime": 2.0}));
    }
    let index = ds.scan();
    let flagged = with_code(&index, "SIDECAR_UNREADABLE");
    assert_eq!(flagged.len(), 1, "{:?}", codes(&index));
    assert_eq!(flagged[0].file.as_deref(), Some("task-a_bold.json"));
    assert!(flagged[0].detail.contains("invalid JSON"));
    let record = run(&index, "sub-02_task-a_bold");
    assert_eq!(meta(record, "RepetitionTime").source_kind, "run");
}

#[cfg(unix)]
#[test]
fn bids_a_dangling_annex_link_is_a_present_run_with_no_image() {
    let ds = TempDataset::new();
    let fetched = "sub-01/func/sub-01_task-a_bold";
    let unfetched = "sub-02/func/sub-02_task-a_bold";
    ds.nifti(&format!("{fetched}.nii.gz"), Some(4), 2.0);
    let link = ds.path(&format!("{unfetched}.nii.gz"));
    std::fs::create_dir_all(link.parent().unwrap()).unwrap();
    std::os::unix::fs::symlink("../../.git/annex/objects/XX/absent", &link).unwrap();
    for stem in [fetched, unfetched] {
        ds.json(&format!("{stem}.json"), json!({"RepetitionTime": 2.0}));
    }
    ds.text(
        "sub-02/func/sub-02_task-a_events.tsv",
        "onset\tduration\n1\t1\n",
    );

    let index = ds.scan();
    let record = run(&index, "sub-02_task-a_bold");
    assert!(record.header.is_none());
    assert_eq!(record.size_bytes, 0.0);
    assert_eq!(meta(record, "RepetitionTime").value, "2.0");
    assert!(record.has_events);
    assert_eq!(with_code(&index, "IMAGE_UNAVAILABLE").len(), 1);
    assert!(with_code(&index, "HEADER_UNREADABLE").is_empty());
    assert!(
        record.variant_id.is_none() && index.variants.is_empty(),
        "an unfetched image is not an acquisition variant: {:?}",
        index.variants
    );

    let request = BidsSliceRequest {
        path: link.to_string_lossy().into_owned(),
        kind: "mean".into(),
        world_z_mm: None,
        max_px: 64,
    };
    assert!(images::cached_slice(&ds.cache, &request).is_none());
    assert!(images::get_slice(&ds.cache, &request).is_err());
    let detail = run_detail(&ds.root, "sub-02_task-a_bold").unwrap();
    assert!(!detail.event_checks.is_empty());
}

#[test]
fn bids_slice_timing_compares_as_vectors_with_unique_counts() {
    assert_eq!(
        canonical(&json!([0.0, 0.5, 1.0])),
        canonical(&json!([0, 0.50, 1.000]))
    );
    assert_ne!(
        canonical(&json!([0.0, 0.5, 1.0])),
        canonical(&json!([1.0, 0.5, 0.0]))
    );

    let ds = TempDataset::new();
    let timing = |values: Value| json!({"RepetitionTime": 2.0, "SliceTiming": values});
    for (subject, values) in [
        ("01", json!([0.0, 1.0, 0.5])),
        ("02", json!([0.0, 1.00, 0.50])),
        ("03", json!([0.0, 1.0, 0.5])),
        ("04", json!([0.0, 0.0, 1.0])),
    ] {
        let stem = format!("sub-{subject}/func/sub-{subject}_task-a_bold");
        ds.nifti(&format!("{stem}.nii.gz"), Some(4), 2.0);
        ds.json(&format!("{stem}.json"), timing(values));
    }
    let index = ds.scan();
    assert_eq!(index.variants.len(), 1);
    let group = &index.variants[0];
    assert_eq!(group.keys, ["SliceTiming"]);
    assert_eq!(group.run_ids, ["sub-04_task-a_bold"]);
    assert!(group.diff.contains("2 unique times"), "{}", group.diff);
    assert!(
        group.diff.contains("modal 3 unique times"),
        "{}",
        group.diff
    );
    assert!(run(&index, "sub-02_task-a_bold").variant_id.is_none());
}

#[test]
fn bids_variants_group_on_effective_values_and_notes_state_consequences() {
    let ds = TempDataset::new();
    ds.json(
        "task-a_bold.json",
        json!({"RepetitionTime": 0.8, "MultibandAccelerationFactor": 6,
        "PhaseEncodingDirection": "j-"}),
    );
    for subject in ["01", "02", "03", "04", "05", "06"] {
        ds.nifti(
            &format!("sub-{subject}/func/sub-{subject}_task-a_bold.nii.gz"),
            Some(10),
            0.8,
        );
    }
    // Inherited override makes these a group; fewer volumes is a consequence.
    for subject in ["05", "06"] {
        let stem = format!("sub-{subject}/func/sub-{subject}_task-a_bold");
        ds.json(
            &format!("{stem}.json"),
            json!({"RepetitionTime": 1.0, "MultibandAccelerationFactor": 4}),
        );
        ds.nifti(&format!("{stem}.nii.gz"), Some(8), 1.0);
    }
    let index = ds.scan();
    assert_eq!(index.variants.len(), 1, "{:?}", index.variants);
    let group = &index.variants[0];
    assert_eq!(group.id, "A");
    assert_eq!(group.series, "task-a_bold");
    assert_eq!(
        group.keys,
        ["RepetitionTime", "MultibandAccelerationFactor"]
    );
    assert!(group.diff.contains("TR 1 (modal 0.8)"), "{}", group.diff);
    assert!(
        group.diff.contains("8 volumes (modal 10)"),
        "{}",
        group.diff
    );
    assert!(
        group.note.contains("FD is not comparable"),
        "{}",
        group.note
    );
    assert_eq!(
        run(&index, "sub-05_task-a_bold").variant_id.as_deref(),
        Some("A")
    );
    assert!(run(&index, "sub-01_task-a_bold").variant_id.is_none());
    // A variant's shorter length is not truncation.
    assert!(
        with_code(&index, "TRUNCATED_RUN").is_empty(),
        "{:?}",
        codes(&index)
    );
    let modal = &index.series_modal[0];
    assert_eq!(modal.n_runs, 6);
    assert!(modal
        .values
        .iter()
        .any(|v| v.key == "RepetitionTime" && v.value == "0.8"));
}

#[test]
fn bids_truncated_and_missing_timing_are_content_findings() {
    let ds = TempDataset::new();
    for (subject, volumes) in [("01", 10), ("02", 10), ("03", 7)] {
        let stem = format!("sub-{subject}/func/sub-{subject}_task-a_bold");
        ds.nifti(&format!("{stem}.nii.gz"), Some(volumes), 2.0);
        ds.json(
            &format!("{stem}.json"),
            json!({"RepetitionTime": 2.0, "SliceTiming": [0.0, 1.0, 0.5]}),
        );
    }
    let stem = "sub-04/func/sub-04_task-a_bold";
    ds.nifti(&format!("{stem}.nii.gz"), Some(10), 2.0);
    ds.json(&format!("{stem}.json"), json!({"RepetitionTime": 2.0}));
    let index = ds.scan();

    let truncated = with_code(&index, "TRUNCATED_RUN");
    assert_eq!(truncated.len(), 1);
    assert_eq!(truncated[0].title, "Truncated run: 7 of 10 volumes");
    assert_eq!(truncated[0].tag, "content");
    assert!(truncated[0].detail.contains("14.0 s"));
    let missing = with_code(&index, "SLICE_TIMING_MISSING");
    assert_eq!(missing.len(), 1);
    assert_eq!(missing[0].run_ids, ["sub-04_task-a_bold"]);
    // The same run is not also an acquisition variant.
    assert!(index.variants.is_empty(), "{:?}", index.variants);
}

#[test]
fn bids_pixdim_is_checked_against_repetition_time() {
    let ds = TempDataset::new();
    let stem = "sub-01/func/sub-01_task-a_bold";
    ds.nifti(&format!("{stem}.nii.gz"), Some(4), 2.5);
    ds.json(&format!("{stem}.json"), json!({"RepetitionTime": 2.0}));
    let stem = "sub-02/func/sub-02_task-a_bold";
    ds.nifti(&format!("{stem}.nii.gz"), Some(4), 2.0);
    ds.json(&format!("{stem}.json"), json!({"RepetitionTime": 2.0}));
    let index = ds.scan();
    let mismatch = with_code(&index, "PIXDIM_TR_MISMATCH");
    assert_eq!(mismatch.len(), 1);
    assert_eq!(mismatch[0].subject.as_deref(), Some("01"));
}

fn confounds(values: &[&str]) -> String {
    let mut text = "csf\tframewise_displacement\ttrans_x\n".to_string();
    for value in values {
        text.push_str(&format!("0.1\t{value}\t0.0\n"));
    }
    text
}

fn fmriprep_description(ds: &TempDataset, source_version: &str) {
    ds.json(
        "derivatives/fmriprep/dataset_description.json",
        json!({"Name": "fMRIPrep", "BIDSVersion": "1.9.0", "DatasetType": "derivative",
               "GeneratedBy": [{"Name": "fMRIPrep", "Version": "24.1.1"}],
               "SourceDatasets": [{"URL": "../..", "Version": source_version}]}),
    );
}

#[test]
fn bids_fd_summary_handles_a_leading_na_and_counts_frames_over_lines() {
    let ds = TempDataset::new();
    let path = ds.path("c.tsv");
    ds.text(
        "c.tsv",
        &confounds(&["n/a", "0.1", "0.3", "0.7", "n/a", "0.1"]),
    );
    let trace = read_fd(&path).unwrap();
    assert_eq!(trace.values.len(), 6);
    assert_eq!(trace.values[0], None);
    assert_eq!(trace.values[4], None);
    let summary = fd::summarize(&trace, "fmriprep 24.1.1 confounds").unwrap();
    assert_eq!(summary.n_frames, 4);
    assert!((summary.mean - 0.3).abs() < 1e-6, "{}", summary.mean);
    assert_eq!(summary.over_0_2, 2);
    assert_eq!(summary.over_0_5, 1);
    assert_eq!(summary.peak_volume, 3);
    assert_eq!(summary.max, 0.7);
    assert_eq!(summary.trace.len(), 28);
    // Bins keep their spike, and n/a does not become NaN on the wire.
    assert_eq!(summary.trace.iter().cloned().fold(0f32, f32::max), 0.7);
    assert!(summary.trace.iter().all(|v| v.is_finite()));
    assert!(!summary.filtered);
    assert_eq!(summary.definition, "Power");

    assert!(fd::summarize(
        &FdTrace {
            values: vec![None, None],
            filtered: false,
            non_steady: Vec::new(),
        },
        "x"
    )
    .is_none());
    ds.text("no-fd.tsv", "csf\n0.1\n");
    assert!(read_fd(&ds.path("no-fd.tsv")).is_err());
}

/// One volume per entry of `fd`, then one one-hot column per `flags` entry.
fn flagged_trace(fd: &[&str], flags: &[(&str, &[usize])]) -> FdTrace {
    let ds = TempDataset::new();
    let mut text = String::from("framewise_displacement");
    for (name, _) in flags {
        text += &format!("\t{name}");
    }
    for (volume, value) in fd.iter().enumerate() {
        text += &format!("\n{value}");
        for (_, volumes) in flags {
            text += if volumes.contains(&volume) {
                "\t1"
            } else {
                "\t0"
            };
        }
    }
    ds.text("c.tsv", &format!("{text}\n"));
    read_fd(&ds.path("c.tsv")).unwrap()
}

/// Everything that must not depend on the flags.
fn raw_stats(summary: &BidsFdSummary) -> (f32, f32, u32, u32, u32, Vec<f32>) {
    (
        summary.mean,
        summary.max,
        summary.n_frames,
        summary.over_0_2,
        summary.over_0_5,
        summary.trace.clone(),
    )
}

fn assert_raw_stats_ignore_flags(trace: &FdTrace, summary: &BidsFdSummary) {
    let unflagged = FdTrace {
        non_steady: Vec::new(),
        ..trace.clone()
    };
    let plain = fd::summarize(&unflagged, "x").unwrap();
    assert_eq!(raw_stats(summary), raw_stats(&plain));
}

#[test]
fn bids_fd_without_outlier_columns_keeps_the_plain_peak() {
    let trace = flagged_trace(&["n/a", "1.5", "0.2", "0.3"], &[]);
    assert!(trace.non_steady.is_empty());
    let summary = fd::summarize(&trace, "x").unwrap();
    assert_eq!(summary.peak_volume, 1);
    assert_eq!(summary.first_valid_volume, 0);
    assert!(summary.non_steady_volumes.is_empty());
}

#[test]
fn bids_fd_one_outlier_column_skips_the_jump_out_of_the_volume() {
    let trace = flagged_trace(
        &["n/a", "1.5", "0.2", "0.3", "0.1"],
        &[("non_steady_state_outlier00", &[0])],
    );
    assert_eq!(trace.non_steady, [0]);
    let summary = fd::summarize(&trace, "x").unwrap();
    assert_eq!(summary.peak_volume, 3);
    assert_eq!(summary.first_valid_volume, 1);
    assert_eq!(summary.non_steady_volumes, [0]);
    assert_eq!(summary.max, 1.5);
    assert_raw_stats_ignore_flags(&trace, &summary);
}

#[test]
fn bids_fd_several_outlier_columns_end_the_leading_run() {
    let trace = flagged_trace(
        &["n/a", "2.0", "1.8", "1.6", "0.2", "0.4"],
        &[
            ("non_steady_state_outlier00", &[0]),
            ("non_steady_state_outlier01", &[1]),
            ("non_steady_state_outlier02", &[2]),
        ],
    );
    assert_eq!(trace.non_steady, [0, 1, 2]);
    let summary = fd::summarize(&trace, "x").unwrap();
    // Volume 3 is the jump out of volume 2.
    assert_eq!(summary.peak_volume, 5);
    assert_eq!(summary.first_valid_volume, 3);
    assert_raw_stats_ignore_flags(&trace, &summary);
}

#[test]
fn bids_fd_accepts_the_older_outlier_name_alongside_the_new_one() {
    let trace = flagged_trace(
        &["n/a", "2.0", "1.0", "0.3", "0.1"],
        &[
            ("NonSteadyStateOutlier00", &[0]),
            ("non_steady_state_outlier01", &[1]),
        ],
    );
    assert_eq!(trace.non_steady, [0, 1]);
    assert_eq!(fd::summarize(&trace, "x").unwrap().peak_volume, 3);
}

#[test]
fn bids_fd_does_not_treat_unrelated_or_blank_cells_as_flags() {
    let ds = TempDataset::new();
    ds.text(
        "c.tsv",
        "framewise_displacement\tmotion_outlier00\tnon_steady_state_outlier00\n\
         n/a\t1\t0.0\n0.1\t0\tn/a\n0.2\t0\t1.0\n",
    );
    assert_eq!(read_fd(&ds.path("c.tsv")).unwrap().non_steady, [2]);
}

#[test]
fn bids_fd_with_every_frame_excluded_falls_back_to_the_plain_peak() {
    let trace = flagged_trace(
        &["n/a", "0.2", "0.9"],
        &[
            ("non_steady_state_outlier00", &[0]),
            ("non_steady_state_outlier01", &[1]),
            ("non_steady_state_outlier02", &[2]),
        ],
    );
    let summary = fd::summarize(&trace, "x").unwrap();
    assert_eq!(summary.peak_volume, 2);
    assert_eq!(summary.non_steady_volumes, [0, 1, 2]);
    // No volume follows the run, and the field must stay a valid index.
    assert_eq!(summary.first_valid_volume, 0);
    assert_raw_stats_ignore_flags(&trace, &summary);

    // Unflagged, but excluded as the frame after a flagged one.
    let trace = flagged_trace(&["n/a", "0.2"], &[("non_steady_state_outlier00", &[0])]);
    let summary = fd::summarize(&trace, "x").unwrap();
    assert_eq!((summary.peak_volume, summary.first_valid_volume), (1, 1));
}

#[test]
fn bids_fd_non_leading_flags_exclude_peaks_but_not_the_leading_run() {
    let late = flagged_trace(
        &["n/a", "0.3", "0.2", "2.0", "1.9", "0.4"],
        &[("non_steady_state_outlier00", &[3])],
    );
    let summary = fd::summarize(&late, "x").unwrap();
    assert_eq!(summary.first_valid_volume, 0);
    assert_eq!(summary.peak_volume, 5);
    assert_raw_stats_ignore_flags(&late, &summary);

    let gap = flagged_trace(
        &["n/a", "2.0", "1.0", "1.9", "1.8", "0.1"],
        &[
            ("non_steady_state_outlier00", &[0]),
            ("non_steady_state_outlier01", &[3]),
        ],
    );
    let summary = fd::summarize(&gap, "x").unwrap();
    assert_eq!(summary.first_valid_volume, 1);
    assert_eq!(summary.peak_volume, 2);
    assert_eq!(summary.non_steady_volumes, [0, 3]);
}

#[test]
fn bids_fd_reads_gzip_and_prefers_a_filtered_column() {
    use std::io::Write;
    let ds = TempDataset::new();
    let path = ds.path("c.tsv.gz");
    let mut encoder = flate2::write::GzEncoder::new(
        std::fs::File::create(&path).unwrap(),
        flate2::Compression::fast(),
    );
    write!(
        encoder,
        "framewise_displacement\tframewise_displacement_filtered\n0.9\t0.2\n"
    )
    .unwrap();
    encoder.finish().unwrap();
    let trace = read_fd(&path).unwrap();
    assert_eq!(trace.values, [Some(0.2)]);
    assert!(trace.filtered);
}

#[test]
fn bids_scan_reads_fd_from_confounds_and_keeps_derivatives_out_of_runs() {
    let ds = TempDataset::new();
    fmriprep_description(&ds, "1.2.0");
    ds.nifti("sub-01/func/sub-01_task-a_run-01_bold.nii.gz", Some(5), 2.0);
    ds.text(
        "derivatives/fmriprep/sub-01/func/sub-01_task-a_run-1_desc-confounds_timeseries.tsv",
        &confounds(&["n/a", "0.2", "0.4", "0.2", "0.2"]),
    );
    let index = ds.scan();
    assert_eq!(index.runs.len(), 1);
    let fd = run(&index, "sub-01_task-a_run-01_bold")
        .fd
        .as_ref()
        .unwrap();
    assert!((fd.mean - 0.25).abs() < 1e-6, "{}", fd.mean);
    assert_eq!(fd.source, "fmriprep 24.1.1 confounds");
    assert_eq!(fd.n_frames, 4);

    let detail = run_detail(&ds.root, "sub-01_task-a_run-01_bold").unwrap();
    assert_eq!(detail.fd_trace.len(), 5);
    assert_eq!(detail.fd_trace[0], None);
    let drawn: Vec<f32> = detail.fd_trace.iter().flatten().copied().collect();
    let mean = drawn.iter().sum::<f32>() / drawn.len() as f32;
    assert!(
        (mean - fd.mean).abs() < 1e-6,
        "the mean shown is the mean of the trace"
    );
    assert_eq!(
        detail.fd_source.as_deref(),
        Some("fmriprep 24.1.1 confounds")
    );
}

#[test]
fn bids_run_detail_rejects_ids_that_leave_the_dataset() {
    let ds = TempDataset::new();
    assert!(run_detail(&ds.root, "../../etc/passwd_bold").is_err());
    assert!(run_detail(&ds.root, "sub-01/../x_bold").is_err());
}

#[test]
fn bids_mriqc_group_tables_supply_iqms_with_source() {
    let ds = TempDataset::new();
    ds.json(
        "derivatives/mriqc/dataset_description.json",
        json!({"Name": "MRIQC", "GeneratedBy": [{"Name": "MRIQC", "Version": "24.0.2"}]}),
    );
    ds.text(
        "derivatives/mriqc/group_bold.tsv",
        "bids_name\ttsnr\tfd_mean\tgsr_y\nsub-01_task-a_bold\t55.5\t0.12\tn/a\n",
    );
    ds.nifti("sub-01/func/sub-01_task-a_bold.nii.gz", Some(3), 2.0);
    let index = ds.scan();
    let iqms = run(&index, "sub-01_task-a_bold").iqms.as_ref().unwrap();
    assert_eq!(iqms.tsnr, Some(55.5));
    assert_eq!(iqms.fd_mean, Some(0.12));
    assert_eq!(iqms.gsr_y, None);
    assert_eq!(iqms.source, "mriqc 24.0.2");
    let info = index
        .derivatives
        .iter()
        .find(|d| d.name == "mriqc")
        .unwrap();
    assert_eq!((info.runs, info.of, info.unit.as_str()), (1, 1, "run"));
}

#[test]
fn bids_stale_partial_and_missing_derivatives_are_reported() {
    let ds = TempDataset::new();
    fmriprep_description(&ds, "1.1.0");
    for subject in ["01", "02"] {
        for run in [1, 2] {
            ds.nifti(
                &format!("sub-{subject}/func/sub-{subject}_task-a_run-{run}_bold.nii.gz"),
                Some(3),
                2.0,
            );
        }
    }
    ds.nifti("sub-03/func/sub-03_task-a_run-1_bold.nii.gz", Some(3), 2.0);
    for (subject, run) in [("01", 1), ("01", 2), ("02", 1)] {
        ds.text(
            &format!("derivatives/fmriprep/sub-{subject}/func/sub-{subject}_task-a_run-{run}_desc-confounds_timeseries.tsv"),
            &confounds(&["n/a", "0.1", "0.1"]),
        );
    }
    ds.text("derivatives/freesurfer/sub-01/mri/T1.mgz", "x");
    let index = ds.scan();
    let info = index
        .derivatives
        .iter()
        .find(|d| d.name == "fmriprep")
        .unwrap();
    assert!(info.stale);
    assert_eq!(info.source_version.as_deref(), Some("1.1.0"));
    assert_eq!(info.version.as_deref(), Some("24.1.1"));
    assert_eq!((info.runs, info.of), (3, 5));
    let status: BTreeMap<_, _> = index
        .derivative_status
        .iter()
        .filter(|s| s.name == "fmriprep")
        .map(|s| (s.subject.as_str(), s.status.as_str()))
        .collect();
    assert_eq!(status["01"], "stale");
    assert_eq!(status["02"], "partial");
    assert_eq!(status["03"], "missing");
    let fs = index
        .derivatives
        .iter()
        .find(|d| d.name == "freesurfer")
        .unwrap();
    assert_eq!((fs.runs, fs.of, fs.unit.as_str()), (1, 3, "subject"));
    assert!(!fs.stale);
    assert_eq!(with_code(&index, "DERIVATIVE_STALE").len(), 1);
    let detail = run_detail(&ds.root, "sub-01_task-a_run-1_bold").unwrap();
    assert!(detail
        .derivative_checks
        .iter()
        .any(|c| !c.ok && c.text.contains("built from 1.1.0")));
}

#[test]
fn bids_fieldmap_links_through_b0_source_and_checks_the_pair() {
    let ds = TempDataset::new();
    let bold = "sub-01/func/sub-01_task-a_bold";
    ds.nifti(&format!("{bold}.nii.gz"), Some(4), 2.0);
    ds.json(
        &format!("{bold}.json"),
        json!({"B0FieldSource": "pepolar", "PhaseEncodingDirection": "j",
        "TotalReadoutTime": 0.05}),
    );
    for (dir, direction) in [("AP", "j-"), ("PA", "j")] {
        let fmap = format!("sub-01/fmap/sub-01_dir-{dir}_epi");
        ds.nifti(&format!("{fmap}.nii.gz"), Some(2), 7.0);
        ds.json(
            &format!("{fmap}.json"),
            json!({"B0FieldIdentifier": "pepolar",
            "PhaseEncodingDirection": direction, "TotalReadoutTime": 0.05}),
        );
    }
    let index = ds.scan();
    let link = run(&index, "sub-01_task-a_bold").fmap.as_ref().unwrap();
    assert_eq!(link.via, "B0FieldSource");
    assert_eq!(link.source_id.as_deref(), Some("pepolar"));
    assert_eq!(link.fmap_run_ids.len(), 2);
    assert!(link.checks.iter().all(|c| c.ok), "{:?}", link.checks);
    assert!(with_code(&index, "NO_FIELDMAP").is_empty());
}

#[test]
fn bids_fieldmap_falls_back_to_intended_for_and_flags_bad_pairs() {
    let ds = TempDataset::new();
    let bold = "ses-01/func/sub-01_ses-01_task-a_bold.nii.gz";
    ds.nifti(&format!("sub-01/{bold}"), Some(4), 2.0);
    ds.json(
        "sub-01/ses-01/func/sub-01_ses-01_task-a_bold.json",
        json!({"PhaseEncodingDirection": "j", "TotalReadoutTime": 0.05}),
    );
    let fmap = "sub-01/ses-02/fmap/sub-01_ses-02_dir-AP_epi";
    let path = ds.path(&format!("{fmap}.nii.gz"));
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    write_nifti(
        &path,
        [8, 8, 3],
        Some(2),
        [2.0, 2.0, 3.0],
        [0.0, 0.0, 0.0],
        7.0,
    );
    ds.json(
        &format!("{fmap}.json"),
        json!({"PhaseEncodingDirection": "j", "TotalReadoutTime": 0.09,
               "IntendedFor": [format!("bids::sub-01/{bold}"), "bids::sub-01/ses-01/func/sub-01_ses-01_task-gone_bold.nii.gz"]}),
    );
    let index = ds.scan();
    let link = run(&index, "sub-01_ses-01_task-a_bold")
        .fmap
        .as_ref()
        .unwrap();
    assert_eq!(link.via, "IntendedFor");
    assert_eq!(link.fmap_run_ids, ["sub-01_ses-02_dir-AP_epi"]);
    assert!(link.checks.iter().any(|c| !c.ok));
    for code in [
        "FMAP_PE_NOT_OPPOSED",
        "FMAP_READOUT_MISMATCH",
        "FMAP_GRID_MISMATCH",
        "FMAP_SESSION_MISMATCH",
    ] {
        assert_eq!(
            with_code(&index, code).len(),
            1,
            "{code}: {:?}",
            codes(&index)
        );
        assert_eq!(with_code(&index, code)[0].tag, "content");
    }
    let broken = with_code(&index, "INTENDEDFOR_BROKEN");
    assert_eq!(broken.len(), 1);
    assert_eq!(broken[0].severity, "error");
    assert_eq!(broken[0].tag, "content");
    assert!(broken[0].detail.contains("task-gone"));
}

#[test]
fn bids_intended_for_accepts_legacy_subject_relative_paths() {
    let ds = TempDataset::new();
    ds.nifti("sub-01/func/sub-01_task-a_bold.nii.gz", Some(4), 2.0);
    let fmap = "sub-01/fmap/sub-01_dir-AP_epi";
    ds.nifti(&format!("{fmap}.nii.gz"), Some(2), 7.0);
    ds.json(
        &format!("{fmap}.json"),
        json!({"IntendedFor": "func/sub-01_task-a_bold.nii.gz"}),
    );
    let index = ds.scan();
    assert_eq!(
        run(&index, "sub-01_task-a_bold").fmap.as_ref().unwrap().via,
        "IntendedFor"
    );
    assert!(with_code(&index, "INTENDEDFOR_BROKEN").is_empty());
}

#[test]
fn bids_runs_without_a_fieldmap_are_flagged_and_a_dataset_with_none_gets_one_note() {
    let ds = TempDataset::new();
    ds.nifti("sub-01/func/sub-01_task-a_bold.nii.gz", Some(4), 2.0);
    ds.nifti("sub-02/func/sub-02_task-a_bold.nii.gz", Some(4), 2.0);
    let index = ds.scan();
    assert!(with_code(&index, "NO_FIELDMAP").is_empty());
    assert_eq!(with_code(&index, "NO_FIELDMAPS_IN_DATASET").len(), 1);
    assert_eq!(
        run(&index, "sub-01_task-a_bold").fmap.as_ref().unwrap().via,
        "none"
    );

    ds.nifti("sub-02/fmap/sub-02_dir-AP_epi.nii.gz", Some(2), 7.0);
    let index = ds.scan();
    let flagged = with_code(&index, "NO_FIELDMAP");
    assert_eq!(flagged.len(), 2, "{:?}", codes(&index));
}

fn events_with(ds: &TempDataset, content: &str, sidecar: Value) -> super::events::EventReport {
    ds.text("sub-01/func/sub-01_task-a_events.tsv", content);
    ds.json("sub-01/func/sub-01_task-a_events.json", sidecar);
    let path = ds.path("sub-01/func/sub-01_task-a_events.tsv");
    let project = ds.project();
    let effective = SidecarResolver::new(&project).effective(&path);
    check_events(&path, &effective, Some(100.0), Some(2.0)).unwrap()
}

fn issue_codes(report: &super::events::EventReport) -> Vec<&'static str> {
    report.issues.iter().map(|issue| issue.code).collect()
}

#[test]
fn bids_clean_events_pass_every_check() {
    let ds = TempDataset::new();
    let report = events_with(
        &ds,
        "onset\tduration\ttrial_type\tresponse_time\n0\t2\tgo\t0.5\n10\t2\tstop\t0.6\n",
        json!({"trial_type": {"Levels": {"go": "Go", "stop": "Stop"}}}),
    );
    assert!(report.issues.is_empty(), "{:?}", report.issues);
    assert!(report.checks.iter().all(|c| c.ok));
    assert_eq!(report.events_duration, Some(12.0));
}

#[test]
fn bids_events_checks_catch_each_problem() {
    let ds = TempDataset::new();
    let report = events_with(&ds, "onset\ttrial_type\n0\tgo\n", json!({}));
    assert_eq!(issue_codes(&report), ["EVENTS_COLUMNS_MISSING"]);

    let report = events_with(
        &ds,
        "onset\tduration\ttrial_type\tresponse_time\nn/a\t2\tgo\tn/a\n1\t2\tother\tn/a\n120\t2\tgo\t0.4\n",
        json!({"trial_type": {"Levels": {"go": "Go"}}}),
    );
    assert_eq!(
        issue_codes(&report),
        [
            "EVENTS_NA_ONSET",
            "EVENTS_AFTER_SCAN",
            "EVENTS_UNDECLARED_LEVELS",
            "EVENTS_RT_MISSING"
        ]
    );
    let after = report
        .issues
        .iter()
        .find(|i| i.code == "EVENTS_AFTER_SCAN")
        .unwrap();
    assert_eq!(after.title, "1 events after scan end");
    assert!(
        after.detail.contains("Last onset 120.0 s"),
        "{}",
        after.detail
    );
    let rt = report
        .issues
        .iter()
        .find(|i| i.code == "EVENTS_RT_MISSING")
        .unwrap();
    assert_eq!((rt.tag, rt.severity), ("note", "info"));
    let levels = report
        .issues
        .iter()
        .find(|i| i.code == "EVENTS_UNDECLARED_LEVELS")
        .unwrap();
    assert!(levels.detail.contains("other"));
}

#[test]
fn bids_events_within_a_tr_of_the_end_and_low_rt_loss_are_quiet() {
    let ds = TempDataset::new();
    let report = events_with(
        &ds,
        "onset\tduration\tresponse_time\n99\t2\t0.4\n1\t1\t0.4\n2\t1\t0.4\n3\t1\t0.4\n4\t1\t0.4\n5\t1\tn/a\n",
        json!({}),
    );
    assert!(report.issues.is_empty(), "{:?}", report.issues);
    assert!(report.checks.iter().any(|c| c.text.contains("1 of 6")));
}

#[test]
fn bids_scan_attaches_event_findings_to_the_run_and_detail_lists_passes() {
    let ds = TempDataset::new();
    let stem = "sub-01/func/sub-01_task-a_bold";
    ds.nifti(&format!("{stem}.nii.gz"), Some(5), 2.0);
    ds.json(&format!("{stem}.json"), json!({"RepetitionTime": 2.0}));
    ds.text(
        "sub-01/func/sub-01_task-a_events.tsv",
        "onset\tduration\n0\t1\n30\t1\n",
    );
    let index = ds.scan();
    assert!(run(&index, "sub-01_task-a_bold").has_events);
    let after = with_code(&index, "EVENTS_AFTER_SCAN");
    assert_eq!(after[0].run_ids, ["sub-01_task-a_bold"]);
    let detail = run_detail(&ds.root, "sub-01_task-a_bold").unwrap();
    assert!(detail.event_checks.iter().any(|c| c.ok));
    assert!(detail.event_checks.iter().any(|c| !c.ok));
    assert_eq!(detail.events_duration, Some(31.0));
}

#[test]
fn bids_finding_ids_are_stable_across_scans_and_differ_by_run() {
    let ds = TempDataset::new();
    for (subject, volumes) in [("01", 10), ("02", 10), ("03", 7), ("04", 6)] {
        ds.nifti(
            &format!("sub-{subject}/func/sub-{subject}_task-a_bold.nii.gz"),
            Some(volumes),
            2.0,
        );
    }
    let first = ds.scan();
    let truncated: Vec<&str> = with_code(&first, "TRUNCATED_RUN")
        .iter()
        .map(|f| f.id.as_str())
        .collect();
    assert_eq!(truncated.len(), 2);
    assert_ne!(truncated[0], truncated[1]);
    // Rewriting a file changes numbers and forces a reread, not the identity.
    ds.nifti("sub-03/func/sub-03_task-a_bold.nii.gz", Some(5), 2.0);
    let second = ds.scan();
    let mut before: Vec<&str> = truncated;
    let mut after: Vec<&str> = with_code(&second, "TRUNCATED_RUN")
        .iter()
        .map(|f| f.id.as_str())
        .collect();
    before.sort();
    after.sort();
    assert_eq!(before, after);
}

#[test]
fn bids_rescans_read_only_what_changed_and_report_new_subjects() {
    let ds = TempDataset::new();
    for subject in ["01", "02"] {
        let stem = format!("sub-{subject}/func/sub-{subject}_task-a_bold");
        ds.nifti(&format!("{stem}.nii.gz"), Some(4), 2.0);
        ds.json(&format!("{stem}.json"), json!({"RepetitionTime": 2.0}));
    }
    let first = ds.scan();
    assert!(first.previous_scan_at.is_none());
    assert!(first.new_subjects.is_empty());
    assert!(first.files_opened >= 4.0, "{}", first.files_read);

    let unchanged = ds.scan();
    assert_eq!(unchanged.files_opened, 0.0);
    assert!(unchanged.previous_scan_at.is_some());
    assert!(unchanged.new_subjects.is_empty());
    assert_eq!(unchanged.runs.len(), 2);
    assert_eq!(
        serde_json::to_string(&unchanged.findings).unwrap(),
        serde_json::to_string(&first.findings).unwrap()
    );

    ds.nifti("sub-03/func/sub-03_task-a_bold.nii.gz", Some(4), 2.0);
    let added = ds.scan();
    assert_eq!(added.new_subjects, ["03"]);
    assert_eq!(added.files_opened, 1.0, "only the new subject's header");
    assert_eq!(added.runs.len(), 3);

    ds.json(
        "sub-01/func/sub-01_task-a_bold.json",
        json!({"RepetitionTime": 2.5}),
    );
    let edited = ds.scan();
    assert!(edited.new_subjects.is_empty());
    assert_eq!(
        meta(run(&edited, "sub-01_task-a_bold"), "RepetitionTime").value,
        "2.5"
    );
    assert_eq!(
        edited.files_opened, 2.0,
        "header and sidecar of sub-01 only"
    );

    // A root sidecar reaches everyone.
    ds.json("task-a_bold.json", json!({"FlipAngle": 70}));
    let inherited = ds.scan();
    assert_eq!(
        meta(run(&inherited, "sub-02_task-a_bold"), "FlipAngle").value,
        "70"
    );
}

struct CancelAfter {
    flag: AtomicBool,
    owner: bool,
}

impl ScanControl for CancelAfter {
    fn cancelled(&self) -> bool {
        self.flag.load(Ordering::Relaxed)
    }
    fn owns_index(&self) -> bool {
        self.owner
    }
}

#[test]
fn bids_progress_streams_subjects_and_a_cancelled_scan_is_partial() {
    let ds = TempDataset::new();
    for subject in ["01", "02", "03"] {
        ds.nifti(
            &format!("sub-{subject}/anat/sub-{subject}_T1w.nii.gz"),
            None,
            0.0,
        );
    }
    let request = ScanRequest {
        dataset: &ds.root,
        scan_id: "s1",
        remote: None,
        cache_root: &ds.cache,
    };
    let control = CancelAfter {
        flag: AtomicBool::new(false),
        owner: true,
    };
    let mut seen = Vec::new();
    let index = run_scan(&request, &control, |progress| {
        if progress.subject.is_some() {
            seen.push((progress.subject.clone().unwrap(), progress.runs.len()));
            control.flag.store(true, Ordering::Relaxed);
        }
    })
    .unwrap();
    assert_eq!(seen, [("01".to_string(), 1)]);
    assert!(!index.complete);
    assert_eq!(index.runs.len(), 1);
    assert_eq!(index.subjects.len(), 3, "unread rows stay listed, empty");

    // A cancelled scan keeps its work but is not a baseline for "new".
    let next = ds.scan();
    assert!(next.complete);
    assert_eq!(next.runs.len(), 3);
    assert!(next.previous_scan_at.is_none());
    assert_eq!(next.files_opened, 2.0, "sub-01 came from the partial index");
}

#[test]
fn bids_a_superseded_scan_does_not_write_the_index() {
    let ds = TempDataset::new();
    ds.nifti("sub-01/anat/sub-01_T1w.nii.gz", None, 0.0);
    let request = ScanRequest {
        dataset: &ds.root,
        scan_id: "old",
        remote: None,
        cache_root: &ds.cache,
    };
    let control = CancelAfter {
        flag: AtomicBool::new(false),
        owner: false,
    };
    run_scan(&request, &control, |_| {}).unwrap();
    assert!(ds.scan().previous_scan_at.is_none());
}

#[test]
fn bids_corrupt_stored_index_is_a_first_scan() {
    let ds = TempDataset::new();
    ds.nifti("sub-01/anat/sub-01_T1w.nii.gz", None, 0.0);
    ds.scan();
    std::fs::write(super::store::store_path(&ds.cache, &ds.root), "{not json").unwrap();
    let index = ds.scan();
    assert!(index.previous_scan_at.is_none());
    assert_eq!(index.runs.len(), 1);
}

#[test]
fn bids_remote_scans_read_sidecars_only() {
    let ds = TempDataset::new();
    let stem = "sub-01/func/sub-01_task-a_bold";
    // Not a real image: a remote scan must not open it.
    ds.text(&format!("{stem}.nii.gz"), "stub");
    ds.json(&format!("{stem}.json"), json!({"RepetitionTime": 2.0}));
    ds.text(
        "derivatives/fmriprep/sub-01/func/sub-01_task-a_desc-confounds_timeseries.tsv",
        &confounds(&["n/a", "0.1"]),
    );
    ds.json(
        "derivatives/mriqc/dataset_description.json",
        json!({"Name": "MRIQC"}),
    );
    ds.text(
        "derivatives/mriqc/group_bold.tsv",
        "bids_name\tfd_mean\nsub-01_task-a_bold\t0.2\n",
    );
    let server = FakeServer::new(&ds, false);
    let index = ds.scan_with(Some(&server), |_| {});
    assert!(index.is_remote);
    assert!(index.listing_complete);
    let record = run(&index, "sub-01_task-a_bold");
    assert_eq!(
        *server.asked.lock().unwrap(),
        ["sub-01/func/sub-01_task-a_bold.nii.gz"]
    );
    assert_eq!(record.header.as_ref().unwrap().n_volumes, Some(100));
    assert_eq!(meta(record, "pixdim[4]").source_kind, "nifti");
    // Remote confounds are fetched now, so a remote run has its FD.
    assert_eq!(record.fd.as_ref().unwrap().n_frames, 1);
    assert_eq!(meta(record, "RepetitionTime").value, "2.0");
    assert_eq!(record.iqms.as_ref().unwrap().fd_mean, Some(0.2));
    assert!(with_code(&index, "HEADER_UNREADABLE").is_empty());
    assert_eq!(with_code(&index, "REMOTE_PARTIAL_SCAN").len(), 1);
}

#[test]
fn bids_a_failed_remote_header_is_reported_and_retried_on_the_next_scan() {
    let ds = TempDataset::new();
    let stem = "sub-01/func/sub-01_task-a_bold";
    ds.text(&format!("{stem}.nii.gz"), "stub");
    let server = FakeServer::new(&ds, true);
    let index = ds.scan_with(Some(&server), |_| {});
    assert!(run(&index, "sub-01_task-a_bold").header.is_none());
    assert_eq!(with_code(&index, "HEADER_UNREADABLE").len(), 1);

    server.failing.store(false, Ordering::Relaxed);
    let index = ds.scan_with(Some(&server), |_| {});
    assert!(run(&index, "sub-01_task-a_bold").header.is_some());
    assert!(with_code(&index, "HEADER_UNREADABLE").is_empty());

    let index = ds.scan_with(Some(&server), |_| {});
    assert_eq!(index.files_opened, 0.0, "a good read is stored");
    assert_eq!(server.asked.lock().unwrap().len(), 2);
}

/// A dataset with what a server walk must skip, and a pipeline with images only.
fn remote_fixture(ds: &TempDataset) -> FakeServer {
    let stem = "sub-01/func/sub-01_task-a_bold";
    ds.text(&format!("{stem}.nii.gz"), "stub");
    ds.json(&format!("{stem}.json"), json!({"RepetitionTime": 2.0}));
    ds.text(
        "sub-01/func/sub-01_task-a_events.tsv",
        "onset\tduration\n1\t1\n",
    );
    ds.text("sub-02/anat/sub-02_T1w.nii.gz", "stub");
    ds.json("sub-02/anat/sub-02_T1w.json", json!({"FlipAngle": 8}));
    ds.text("sub-02/anat/stray.txt", "x");
    ds.text(".git/objects/aa", "never");
    ds.text(".datalad/config", "never");
    ds.text("sourcedata/raw.json", "{}");
    ds.json(
        "derivatives/fmriprep/dataset_description.json",
        json!({"GeneratedBy": [{"Name": "fMRIPrep", "Version": "24.1.1"}]}),
    );
    ds.text(
        "derivatives/fmriprep/sub-01/func/sub-01_task-a_desc-confounds_timeseries.tsv",
        &confounds(&["n/a", "0.1", "0.3"]),
    );
    ds.text("derivatives/fmriprep/sourcedata/freesurfer/x.json", "{}");
    ds.json(
        "derivatives/masks/dataset_description.json",
        json!({"GeneratedBy": [{"Name": "masks"}]}),
    );
    ds.text(
        "derivatives/masks/sub-01/func/sub-01_task-a_desc-brain_mask.nii.gz",
        "stub",
    );
    ds.json(
        "derivatives/masks/sub-01/func/sub-01_task-a_desc-brain_mask.json",
        json!({"Type": "Brain"}),
    );
    FakeServer::new(ds, false)
}

#[test]
fn bids_a_remote_walk_lists_the_server_and_reads_no_image() {
    let ds = TempDataset::new();
    let server = remote_fixture(&ds);
    let index = ds.scan_with(Some(&server), |_| {});

    assert!(index.is_remote && index.complete && index.listing_complete);
    assert_eq!(index.subjects, ["01", "02"]);
    let listed = server.listed.lock().unwrap().clone();
    assert!(!listed.iter().any(|dir| {
        dir.starts_with(".git") || dir.starts_with(".datalad") || dir.contains("sourcedata")
    }));
    let fetched = server.fetched();
    assert!(
        !fetched.iter().any(|rel| rel.contains(".nii")),
        "{fetched:?}"
    );
    assert!(!fetched.iter().any(|rel| rel.contains("sourcedata")));

    let record = run(&index, "sub-01_task-a_bold");
    assert!(record
        .path
        .ends_with("empty-mirror/sub-01/func/sub-01_task-a_bold.nii.gz"));
    assert!(record.mtime.is_some());
    assert_eq!(record.fd.as_ref().unwrap().over_0_2, 1);
    assert!(record.fd.as_ref().unwrap().source.contains("fmriprep"));
    assert!(record.has_events);
    assert_eq!(meta(record, "RepetitionTime").value, "2.0");
    assert_eq!(run(&index, "sub-02_T1w").sidecar[0].key, "FlipAngle");

    // A pipeline of images is covered although none of them is in the manifest.
    let masks = index
        .derivatives
        .iter()
        .find(|d| d.name == "masks")
        .unwrap();
    assert_eq!((masks.runs, masks.of), (1, 1));
    assert_eq!(index.derivatives.len(), 2);

    // Rows on the server show, and the validator ran on the snapshot.
    assert!(codes(&index)
        .iter()
        .all(|code| *code != "EXCLUSIONS_UNREADABLE"));
    // A sidecar beside a derivative image the listing left out is not orphaned.
    assert!(codes(&index).iter().all(|code| *code != "orphaned_sidecar"));
    assert!(
        index.findings.iter().any(|f| f.tag == "validator"),
        "{:?}",
        codes(&index)
    );
    let note = with_code(&index, "REMOTE_PARTIAL_SCAN")[0];
    assert!(
        note.title.contains("listed on the server"),
        "{}",
        note.title
    );
    assert!(note.detail.contains("Images were not downloaded"));
    assert!(note.detail.contains("32 MiB"));
    assert!(note.detail.contains("absences here are real"));
}

#[test]
fn bids_remote_exclusions_come_from_the_server() {
    let ds = TempDataset::new();
    let server = remote_fixture(&ds);
    write_exclusions(&ds.root, &[row("sub-01", "motion")], &context(), "1").unwrap();
    let index = ds.scan_with(Some(&server), |_| {});
    assert_eq!(index.exclusions.len(), 1);
    assert_eq!(index.exclusions[0].entity, "sub-01");
}

#[test]
fn bids_a_remote_rescan_fetches_no_sidecar_of_an_unchanged_subject() {
    let ds = TempDataset::new();
    let server = remote_fixture(&ds);
    ds.scan_with(Some(&server), |_| {});
    server.fetched.lock().unwrap().clear();
    let index = ds.scan_with(Some(&server), |_| {});
    assert_eq!(index.files_opened, 0.0);
    assert!(run(&index, "sub-01_task-a_bold").fd.is_some());
    assert_eq!(
        meta(run(&index, "sub-01_task-a_bold"), "RepetitionTime").value,
        "2.0"
    );
    let fetched = server.fetched();
    assert!(
        !fetched.iter().any(|rel| rel.starts_with("sub-")),
        "{fetched:?}"
    );

    ds.json("sub-02/anat/sub-02_T1w.json", json!({"FlipAngle": 9}));
    // A size that changes the stamp whatever the clock resolution.
    ds.text("sub-02/anat/sub-02_acq-x_T1w.json", "{}");
    server.fetched.lock().unwrap().clear();
    let index = ds.scan_with(Some(&server), |_| {});
    assert_eq!(meta(run(&index, "sub-02_T1w"), "FlipAngle").value, "9");
    let fetched = server.fetched();
    assert!(fetched.iter().any(|rel| rel.starts_with("sub-02/")));
    assert!(
        !fetched.iter().any(|rel| rel.starts_with("sub-01/")),
        "{fetched:?}"
    );
}

#[test]
fn bids_a_gap_in_a_remote_listing_stays_unknown_and_stores_nothing() {
    let ds = TempDataset::new();
    let server = remote_fixture(&ds);
    server.unlistable.lock().unwrap().push("sub-02/anat".into());
    let index = ds.scan_with(Some(&server), |_| {});
    assert!(!index.listing_complete);
    assert!(index.findings.iter().all(|f| f.tag != "validator"));
    let note = with_code(&index, "REMOTE_PARTIAL_SCAN")[0];
    assert!(note.title.contains("partial listing"));
    assert!(
        note.detail
            .contains("sub-02/anat directory could not be listed"),
        "{}",
        note.detail
    );
    assert!(note.detail.contains("mean unknown"));

    // Nothing from the short view was kept, so the next scan reads subjects again.
    server.unlistable.lock().unwrap().clear();
    let index = ds.scan_with(Some(&server), |_| {});
    assert!(index.listing_complete);
    assert_eq!(index.previous_scan_at, None);
    assert!(run(&index, "sub-02_T1w").header.is_some());
}

#[test]
fn bids_a_cancelled_remote_walk_returns_an_incomplete_listing() {
    let ds = TempDataset::new();
    let server = remote_fixture(&ds);
    let mirror = ds.cache.join("empty-mirror");
    let request = ScanRequest {
        dataset: &mirror,
        scan_id: "test-scan",
        remote: Some(&server),
        cache_root: &ds.cache,
    };
    let index = run_scan(&request, &AtomicBool::new(true), |_| {}).unwrap();
    assert!(!index.complete && !index.listing_complete);
    assert!(index.runs.is_empty());
    assert_eq!(*server.listed.lock().unwrap(), [""]);
    assert!(with_code(&index, "REMOTE_PARTIAL_SCAN")[0]
        .detail
        .contains("stopped"));
}

#[test]
fn bids_a_remote_scan_keeps_files_over_the_bound_unread() {
    let ds = TempDataset::new();
    let server = remote_fixture(&ds);
    let table = "derivatives/fmriprep/sub-01/func/sub-01_task-a_desc-confounds_timeseries.tsv";
    server
        .sizes
        .lock()
        .unwrap()
        .insert(table.to_string(), MAX_FETCHED_FILE_BYTES + 1);
    let index = ds.scan_with(Some(&server), |_| {});
    assert!(!server.fetched().iter().any(|rel| rel == table));
    assert!(run(&index, "sub-01_task-a_bold").fd.is_none());
    let unread = with_code(&index, "CONFOUNDS_UNREADABLE");
    assert!(unread[0].detail.contains("32 MiB"), "{}", unread[0].detail);
}

#[test]
fn bids_a_dangling_link_on_the_server_is_a_run_without_a_read() {
    let ds = TempDataset::new();
    let server = remote_fixture(&ds);
    let link = ds.path("sub-03/anat/sub-03_T1w.nii.gz");
    std::fs::create_dir_all(link.parent().unwrap()).unwrap();
    std::os::unix::fs::symlink("/nonexistent/annex/object", &link).unwrap();
    let index = ds.scan_with(Some(&server), |_| {});
    let record = run(&index, "sub-03_T1w");
    assert!(record.header.is_none());
    assert_eq!(record.size_bytes, 0.0);
    assert_eq!(with_code(&index, "IMAGE_UNAVAILABLE").len(), 1);
    assert!(!server
        .asked
        .lock()
        .unwrap()
        .iter()
        .any(|rel| rel.contains("sub-03")));
}

#[test]
fn bids_a_bad_pipeline_description_on_the_server_does_not_stop_the_scan() {
    let ds = TempDataset::new();
    let server = remote_fixture(&ds);
    ds.text("derivatives/masks/dataset_description.json", "{ not json");
    ds.text("participants.tsv", "no_id_column\nx\n");
    let index = ds.scan_with(Some(&server), |_| {});
    assert!(index.derivatives.iter().any(|d| d.name == "masks"));
    assert!(index.runs.iter().any(|r| r.id == "sub-01_task-a_bold"));
}

#[test]
fn bids_validator_findings_are_tagged_validator() {
    let ds = TempDataset::new();
    ds.text("sub-01/anat/stray.txt", "x");
    ds.nifti("sub-01/anat/sub-01_T1w.nii.gz", None, 0.0);
    let index = ds.scan();
    let validator: Vec<_> = index
        .findings
        .iter()
        .filter(|f| f.tag == "validator")
        .collect();
    assert!(!validator.is_empty(), "{:?}", codes(&index));
    let mut ids: Vec<&str> = index.findings.iter().map(|f| f.id.as_str()).collect();
    let total = ids.len();
    ids.sort();
    ids.dedup();
    assert_eq!(ids.len(), total, "finding ids are unique");
}

fn row(entity: &str, reason: &str) -> BidsExclusion {
    BidsExclusion {
        entity: entity.to_string(),
        scope: String::new(),
        reason: reason.to_string(),
        criterion: "mean FD > 0.25 mm".to_string(),
        value: "0.61".to_string(),
        author: "bb".to_string(),
        date: "2026-11-01".to_string(),
        source: "fmriprep 24.1.1 confounds".to_string(),
        threshold: "0.25".to_string(),
        definition: "Power".to_string(),
        triggered_by: String::new(),
    }
}

fn key(entity: &str) -> BidsExclusionKey {
    BidsExclusionKey {
        entity: entity.to_string(),
        criterion: "mean FD > 0.25 mm".to_string(),
    }
}

fn context() -> BidsExclusionContext {
    BidsExclusionContext {
        source_version: Some("1.2.0".to_string()),
    }
}

fn tree(root: &Path) -> BTreeMap<String, Vec<u8>> {
    walkdir::WalkDir::new(root)
        .into_iter()
        .flatten()
        .filter(|entry| entry.file_type().is_file())
        .map(|entry| {
            (
                entry
                    .path()
                    .strip_prefix(root)
                    .unwrap()
                    .to_string_lossy()
                    .into_owned(),
                std::fs::read(entry.path()).unwrap(),
            )
        })
        .collect()
}

#[test]
fn bids_exclusions_write_only_below_the_derivative_and_leave_raw_identical() {
    let ds = TempDataset::new();
    ds.nifti("sub-01/func/sub-01_task-a_bold.nii.gz", Some(3), 2.0);
    ds.json(
        "sub-01/func/sub-01_task-a_bold.json",
        json!({"RepetitionTime": 2.0}),
    );
    let before = tree(&ds.root);

    let rows = write_exclusions(
        &ds.root,
        &[row("sub-01_task-a_bold", "motion")],
        &context(),
        "0.9.0",
    )
    .unwrap();
    assert_eq!(rows.all.len(), 1);
    assert_eq!(rows.added.len(), 1);
    assert_eq!(rows.all[0].scope, "run");

    let mut after = tree(&ds.root);
    let added: Vec<String> = after
        .keys()
        .filter(|k| !before.contains_key(*k))
        .cloned()
        .collect();
    assert_eq!(
        added,
        [
            "derivatives/brainflow/dataset_description.json",
            "derivatives/brainflow/exclusions.json",
            "derivatives/brainflow/exclusions.tsv"
        ]
    );
    after.retain(|key, _| !key.starts_with("derivatives/"));
    assert_eq!(after, before, "raw tree byte-identical");
}

#[test]
fn bids_first_write_creates_a_valid_derivative_description() {
    let ds = TempDataset::new();
    write_exclusions(&ds.root, &[row("sub-01", "gone")], &context(), "0.9.0").unwrap();
    let description: Value = serde_json::from_slice(
        &std::fs::read(ds.path("derivatives/brainflow/dataset_description.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(description["DatasetType"], "derivative");
    assert_eq!(description["GeneratedBy"][0]["Name"], "Brainflow");
    assert_eq!(description["GeneratedBy"][0]["Version"], "0.9.0");
    assert_eq!(description["SourceDatasets"][0]["URL"], "../..");
    assert_eq!(description["SourceDatasets"][0]["Version"], "1.2.0");
    assert_eq!(description["BIDSVersion"], "1.9.0");

    let sidecar: Value = serde_json::from_slice(
        &std::fs::read(ds.path("derivatives/brainflow/exclusions.json")).unwrap(),
    )
    .unwrap();
    for column in [
        "entity",
        "reason",
        "criterion",
        "value",
        "author",
        "date",
        "source",
        "threshold",
        "definition",
        "triggered_by",
    ] {
        assert!(sidecar[column]["Description"].is_string(), "{column}");
    }
    let rows = read_exclusions(&ds.root).unwrap();
    assert_eq!(rows[0].definition, "Power");
    assert_eq!(rows[0].source, "fmriprep 24.1.1 confounds");
    assert_eq!(rows[0].threshold, "0.25");

    // A second write leaves the first description alone.
    let bytes = std::fs::read(ds.path("derivatives/brainflow/dataset_description.json")).unwrap();
    write_exclusions(&ds.root, &[row("sub-02", "gone")], &context(), "1.0.0").unwrap();
    assert_eq!(
        bytes,
        std::fs::read(ds.path("derivatives/brainflow/dataset_description.json")).unwrap()
    );
}

#[test]
fn bids_exclusions_prefer_the_raw_doi_as_source() {
    let ds = TempDataset::new();
    ds.json(
        "dataset_description.json",
        json!({"Name": "S", "BIDSVersion": "1.9.0", "DatasetDOI": "10.18112/example.v1.2.0"}),
    );
    write_exclusions(&ds.root, &[row("sub-01", "gone")], &context(), "0.9.0").unwrap();
    let description: Value = serde_json::from_slice(
        &std::fs::read(ds.path("derivatives/brainflow/dataset_description.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(
        description["SourceDatasets"][0]["DOI"],
        "doi:10.18112/example.v1.2.0"
    );
    assert!(description["SourceDatasets"][0].get("URL").is_none());
}

#[test]
fn bids_exclusion_text_is_escaped_and_round_trips() {
    let ds = TempDataset::new();
    let reason = "tab\there\nnew line\r\\slash \"quoted\"";
    write_exclusions(
        &ds.root,
        &[row("sub-01_ses-02", reason)],
        &context(),
        "0.9.0",
    )
    .unwrap();
    let text = std::fs::read_to_string(ds.path("derivatives/brainflow/exclusions.tsv")).unwrap();
    assert_eq!(
        text.lines().count(),
        2,
        "one physical line per row: {text:?}"
    );
    assert_eq!(text.lines().nth(1).unwrap().split('\t').count(), 10);
    assert_eq!(
        text.lines().next().unwrap(),
        "entity\treason\tcriterion\tvalue\tauthor\tdate\tsource\tthreshold\tdefinition\ttriggered_by"
    );
    let rows = read_exclusions(&ds.root).unwrap();
    assert_eq!(rows[0].reason, reason);
    assert_eq!(rows[0].scope, "session");
}

#[test]
fn bids_exclusions_reject_bad_entities_and_a_hand_edited_table() {
    let ds = TempDataset::new();
    assert!(write_exclusions(&ds.root, &[row("../evil", "x")], &context(), "0").is_err());
    assert!(write_exclusions(&ds.root, &[row("sub-01\tx", "x")], &context(), "0").is_err());
    assert!(!ds.path("derivatives").exists());

    ds.text(
        "derivatives/brainflow/exclusions.tsv",
        "id\tnote\nsub-01\tmine\n",
    );
    assert!(write_exclusions(&ds.root, &[row("sub-02", "x")], &context(), "0").is_err());
    assert_eq!(
        std::fs::read_to_string(ds.path("derivatives/brainflow/exclusions.tsv")).unwrap(),
        "id\tnote\nsub-01\tmine\n"
    );
}

#[test]
fn bids_exclusions_require_a_bids_root() {
    let ds = TempDataset::new();
    let plain = ds.dir.join("plain");
    std::fs::create_dir_all(&plain).unwrap();
    assert!(write_exclusions(&plain, &[row("sub-01", "x")], &context(), "0").is_err());
    assert!(!plain.join("derivatives").exists());
    assert!(write_exclusions(
        &ds.dir.join("nowhere"),
        &[row("sub-01", "x")],
        &context(),
        "0"
    )
    .is_err());
}

#[cfg(unix)]
#[test]
fn bids_exclusions_refuse_symlinked_components() {
    use std::os::unix::fs::symlink;
    // derivatives/ is a link.
    let ds = TempDataset::new();
    let elsewhere = ds.dir.join("elsewhere");
    std::fs::create_dir_all(&elsewhere).unwrap();
    symlink(&elsewhere, ds.path("derivatives")).unwrap();
    assert!(write_exclusions(&ds.root, &[row("sub-01", "x")], &context(), "0").is_err());
    assert_eq!(std::fs::read_dir(&elsewhere).unwrap().count(), 0);

    // derivatives/brainflow is a link.
    let ds = TempDataset::new();
    let elsewhere = ds.dir.join("elsewhere");
    std::fs::create_dir_all(&elsewhere).unwrap();
    std::fs::create_dir_all(ds.path("derivatives")).unwrap();
    symlink(&elsewhere, ds.path("derivatives/brainflow")).unwrap();
    assert!(write_exclusions(&ds.root, &[row("sub-01", "x")], &context(), "0").is_err());
    assert_eq!(std::fs::read_dir(&elsewhere).unwrap().count(), 0);
    assert!(revert_exclusions(&ds.root, &[key("sub-01")]).is_err());

    // A file in the output folder is a link.
    let ds = TempDataset::new();
    let outside = ds.dir.join("outside.tsv");
    std::fs::write(&outside, "keep").unwrap();
    std::fs::create_dir_all(ds.path("derivatives/brainflow")).unwrap();
    symlink(&outside, ds.path("derivatives/brainflow/exclusions.tsv")).unwrap();
    assert!(write_exclusions(&ds.root, &[row("sub-01", "x")], &context(), "0").is_err());
    assert_eq!(std::fs::read_to_string(&outside).unwrap(), "keep");
}

#[test]
fn bids_exclusions_revert_and_show_in_the_next_scan() {
    let ds = TempDataset::new();
    ds.nifti("sub-01/anat/sub-01_T1w.nii.gz", None, 0.0);
    write_exclusions(
        &ds.root,
        &[row("sub-01", "a"), row("sub-02", "b")],
        &context(),
        "0",
    )
    .unwrap();
    // Same entity and criterion is one row.
    let rows = write_exclusions(&ds.root, &[row("sub-02", "b again")], &context(), "0").unwrap();
    assert_eq!(rows.all.len(), 2);
    assert!(rows.added.is_empty(), "nothing new was written");
    let index = ds.scan();
    assert_eq!(index.exclusions.len(), 2);
    assert_eq!(index.exclusions[0].scope, "participant");
    assert!(index.derivatives.iter().all(|d| d.name != "brainflow"));

    let remaining = revert_exclusions(&ds.root, &[key("sub-01")]).unwrap();
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].entity, "sub-02");
    assert_eq!(read_exclusions(&ds.root).unwrap(), remaining);
    let remaining = revert_exclusions(&ds.root, &[key("sub-02")]).unwrap();
    assert!(remaining.is_empty());
    let text = std::fs::read_to_string(ds.path("derivatives/brainflow/exclusions.tsv")).unwrap();
    assert_eq!(text.lines().count(), 1, "the header stays");
    // No temporary files left behind.
    let names: Vec<_> = std::fs::read_dir(ds.path("derivatives/brainflow"))
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    assert!(names.iter().all(|n| !n.ends_with(".tmp")), "{names:?}");
    // Reverting with nothing written creates nothing.
    let fresh = TempDataset::new();
    assert!(revert_exclusions(&fresh.root, &[key("sub-01")])
        .unwrap()
        .is_empty());
    assert!(!fresh.path("derivatives").exists());
}

fn slice_request(path: &Path, kind: &str, z: Option<f32>) -> BidsSliceRequest {
    BidsSliceRequest {
        path: path.to_string_lossy().into_owned(),
        kind: kind.to_string(),
        world_z_mm: z,
        max_px: 64,
    }
}

#[test]
fn bids_axial_plan_goes_through_the_affine_with_the_origin_in_the_last_column() {
    // Five-column (4D) neuroim space: the time column must not be read as origin.
    let vec_path = std::env::temp_dir().join(format!("bf-bids-{}.nii", uuid::Uuid::new_v4()));
    write_nifti(
        &vec_path,
        [4, 5, 6],
        Some(3),
        [2.0, 3.0, 4.0],
        [-7.0, 11.0, -30.0],
        2.0,
    );
    let vec = neuroim::io::read_vec_f32(&vec_path).unwrap();
    assert_eq!(vec.space.trans.ncols(), 5);
    let affine = Affine3x4::from_space(&vec.space);
    assert_eq!(affine.rows[2][3], -30.0);
    let plan = plan_axial(&affine, [4, 5, 6], Some(-22.0));
    assert_eq!(plan.world_z, -22.0);
    // Nearest slice, clamped to the volume at both ends.
    assert_eq!(plan_axial(&affine, [4, 5, 6], Some(-21.0)).world_z, -22.0);
    assert_eq!(plan_axial(&affine, [4, 5, 6], Some(500.0)).world_z, -10.0);
    assert_eq!(plan_axial(&affine, [4, 5, 6], Some(-500.0)).world_z, -30.0);
    assert_eq!(plan_axial(&affine, [4, 5, 6], None).world_z, -22.0);
    std::fs::remove_file(vec_path).unwrap();
}

#[test]
fn bids_axial_plan_finds_the_world_z_axis_of_a_permuted_volume() {
    // Voxel axis 0 runs along world z; axis 2 along world x.
    let affine = Affine3x4 {
        rows: [
            [0.0, 0.0, 2.0, -10.0],
            [0.0, 3.0, 0.0, -20.0],
            [4.0, 0.0, 0.0, 50.0],
        ],
    };
    let plan = plan_axial(&affine, [6, 8, 10], Some(62.0));
    assert_eq!(plan.world_z, 62.0);
}

#[test]
fn bids_slices_draw_the_requested_world_z_and_scale_with_the_header() {
    let ds = TempDataset::new();
    ds.nifti("sub-01/func/sub-01_task-a_bold.nii", Some(3), 2.0);
    let path = ds.path("sub-01/func/sub-01_task-a_bold.nii");
    // z index 1 of origin -30 at 3 mm spacing.
    let image = images::render_slice(&slice_request(&path, "mean", Some(-27.0))).unwrap();
    assert_eq!(image.world_z_mm, Some(-27.0));
    assert_eq!(image.volumes_used, 3);
    assert_eq!((image.width, image.height), (4, 4));
    // Slice values are 100 + x + 10y + 100z + t, so the mean at z=1 sits at or above 201.
    assert!(
        image.window_low >= 200.9 && image.window_high <= 234.1,
        "{image:?}"
    );

    let first = images::render_slice(&slice_request(&path, "first", Some(-27.0))).unwrap();
    assert_eq!(first.volumes_used, 1);
    assert!(first.window_low < image.window_low);
    let tsnr = images::render_slice(&slice_request(&path, "tsnr", Some(-27.0))).unwrap();
    assert_eq!(tsnr.volumes_used, 3);
}

#[test]
fn bids_slices_keep_scaled_integers_scaled() {
    let ds = TempDataset::new();
    let path = ds.path("scaled.nii");
    let mut header = nifti::NiftiHeader {
        sform_code: 1,
        srow_x: [1.0, 0.0, 0.0, 0.0],
        srow_y: [0.0, 1.0, 0.0, 0.0],
        srow_z: [0.0, 0.0, 1.0, 0.0],
        ..Default::default()
    };
    header.pixdim[1..4].copy_from_slice(&[1.0; 3]);
    let array =
        ndarray::Array3::<i16>::from_shape_fn((3, 3, 3), |(x, y, z)| (x + y + z) as i16 + 2);
    nifti::writer::WriterOptions::new(&path)
        .reference_header(&header)
        .write_nifti(&array)
        .unwrap();
    // The writer forces slope 1, so put real scaling into the header bytes.
    let mut bytes = std::fs::read(&path).unwrap();
    bytes[112..116].copy_from_slice(&0.5f32.to_le_bytes());
    bytes[116..120].copy_from_slice(&1000.0f32.to_le_bytes());
    std::fs::write(&path, bytes).unwrap();
    let image = images::render_slice(&slice_request(&path, "anat", None)).unwrap();
    assert!(image.window_low > 1000.0, "{image:?}");
}

#[test]
fn bids_slice_orientation_is_axial_with_anterior_up_and_right_to_the_right() {
    let ds = TempDataset::new();
    let path = ds.path("oriented.nii");
    // x runs to -R (negative srow_x), y to +A.
    let mut header = nifti::NiftiHeader {
        sform_code: 1,
        srow_x: [-1.0, 0.0, 0.0, 10.0],
        srow_y: [0.0, 1.0, 0.0, 0.0],
        srow_z: [0.0, 0.0, 1.0, 0.0],
        ..Default::default()
    };
    header.pixdim[1..4].copy_from_slice(&[1.0; 3]);
    // Bright voxel at index x=0 (world +R side) and y=max (anterior).
    let array = ndarray::Array3::<f32>::from_shape_fn((4, 4, 1), |(x, y, _)| {
        if x == 0 && y == 3 {
            1000.0
        } else {
            1.0
        }
    });
    nifti::writer::WriterOptions::new(&path)
        .reference_header(&header)
        .write_nifti(&array)
        .unwrap();
    let image = images::render_slice(&slice_request(&path, "anat", None)).unwrap();
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&image.png_base64)
        .unwrap();
    let decoded = image::load_from_memory(&bytes).unwrap().to_luma8();
    let brightest = decoded
        .enumerate_pixels()
        .max_by_key(|(_, _, p)| p.0[0])
        .unwrap();
    assert_eq!(
        (brightest.0, brightest.1),
        (3, 0),
        "top right is anterior right"
    );
}

#[test]
fn bids_slices_are_cached_on_size_mtime_and_parameters() {
    let ds = TempDataset::new();
    ds.nifti("sub-01/anat/sub-01_T1w.nii", None, 0.0);
    let path = ds.path("sub-01/anat/sub-01_T1w.nii");
    let request = slice_request(&path, "anat", None);
    assert!(images::cached_slice(&ds.cache, &request).is_none());
    let image = images::get_slice(&ds.cache, &request).unwrap();
    let cached = images::cached_slice(&ds.cache, &request).unwrap();
    assert_eq!(cached.png_base64, image.png_base64);
    assert!(images::cached_slice(&ds.cache, &slice_request(&path, "anat", Some(0.0))).is_none());
    write_nifti(
        &path,
        [4, 4, 4],
        None,
        [2.0, 2.0, 3.0],
        [0.0, 0.0, 0.0],
        0.0,
    );
    assert!(
        images::cached_slice(&ds.cache, &request).is_none(),
        "rewrite invalidates"
    );
}

#[test]
fn bids_median_uses_the_modal_grid_and_reports_skips() {
    let ds = TempDataset::new();
    let mut paths = Vec::new();
    for subject in ["01", "02", "03"] {
        let rel = format!("sub-{subject}/anat/sub-{subject}_T1w.nii");
        ds.nifti(&rel, None, 0.0);
        paths.push(ds.path(&rel).to_string_lossy().into_owned());
    }
    let odd = ds.path("sub-04_T1w.nii");
    write_nifti(&odd, [9, 9, 3], None, [1.0, 1.0, 1.0], [0.0, 0.0, 0.0], 0.0);
    paths.push(odd.to_string_lossy().into_owned());
    paths.push(ds.path("missing.nii").to_string_lossy().into_owned());
    let request = slice_request(Path::new(""), "anat", None);
    let median = images::get_median_slice(&ds.cache, &paths, &request).unwrap();
    assert_eq!(median.runs_used, 3);
    assert_eq!(median.runs_skipped, 2);
    assert_eq!((median.image.width, median.image.height), (4, 4));

    let many: Vec<String> = (0..20).map(|i| paths[i % 3].clone()).collect();
    assert_eq!(
        images::get_median_slice(&ds.cache, &many, &request)
            .unwrap()
            .runs_used,
        15
    );
}

#[test]
fn bids_carpet_samples_in_brain_voxels_over_time() {
    let ds = TempDataset::new();
    ds.nifti("sub-01/func/sub-01_task-a_bold.nii", Some(20), 2.0);
    let path = ds.path("sub-01/func/sub-01_task-a_bold.nii");
    let image = images::get_carpet(&ds.cache, &path, 16, 16).unwrap();
    assert_eq!(image.width, 16);
    assert!(image.height <= 16 && image.height >= 1);
    assert_eq!(image.volumes_used, 20);
    assert!(image.world_z_mm.is_none());
    ds.nifti("sub-01/anat/sub-01_T1w.nii", None, 0.0);
    assert!(images::get_carpet(&ds.cache, &ds.path("sub-01/anat/sub-01_T1w.nii"), 16, 16).is_err());
}

#[test]
fn bids_pipelines_list_every_root_and_skip_our_own() {
    let ds = TempDataset::new();
    std::fs::create_dir_all(ds.path("derivatives/freesurfer")).unwrap();
    fmriprep_description(&ds, "1.2.0");
    ds.json("derivatives/mriqc/dataset_description.json", json!({}));
    std::fs::create_dir_all(ds.path("derivatives/brainflow")).unwrap();
    let pipelines: Vec<Pipeline> = super::derivatives::list_pipelines(&ds.root);
    let names: Vec<&str> = pipelines.iter().map(|p| p.name.as_str()).collect();
    assert_eq!(names, ["fmriprep", "freesurfer", "mriqc"]);
    assert_eq!(pipelines[0].label(), "fmriprep 24.1.1");
}

// Regressions found by scanning ds000114 and ds001734.

/// Bold runs of `ds` with one sidecar value each, for variant tests.
fn two_runs_with(ds: &TempDataset, key: &str, values: [Value; 2]) {
    for (subject, value) in ["01", "02"].iter().zip(values) {
        let stem = format!("sub-{subject}/func/sub-{subject}_task-a_bold");
        ds.nifti(&format!("{stem}.nii.gz"), Some(4), 2.0);
        ds.json(&format!("{stem}.json"), json!({ key: value }));
    }
}

#[test]
fn bids_a_malformed_sidecar_leaves_the_other_sidecars_of_the_run_in_force() {
    let ds = TempDataset::new();
    ds.json(
        "task-a_bold.json",
        json!({"RepetitionTime": 2.0, "FlipAngle": 70}),
    );
    ds.text("sub-01/sub-01_task-a_bold.json", "{ not json");
    ds.json(
        "sub-01/func/sub-01_task-a_bold.json",
        json!({"EchoTime": 0.03, "FlipAngle": 80}),
    );
    ds.nifti("sub-01/func/sub-01_task-a_bold.nii.gz", Some(4), 2.0);
    let index = ds.scan();
    let flagged = with_code(&index, "SIDECAR_UNREADABLE");
    assert_eq!(flagged.len(), 1, "{:?}", codes(&index));
    assert_eq!(
        flagged[0].file.as_deref(),
        Some("sub-01/sub-01_task-a_bold.json")
    );
    assert_eq!(flagged[0].subject.as_deref(), Some("01"));
    let record = run(&index, "sub-01_task-a_bold");
    assert_eq!(meta(record, "RepetitionTime").source, "task-a_bold.json");
    assert_eq!(meta(record, "RepetitionTime").source_kind, "dataset");
    assert_eq!(meta(record, "EchoTime").source_kind, "run");
    assert_eq!(meta(record, "FlipAngle").value, "80");
}

#[test]
fn bids_a_malformed_direct_sidecar_keeps_the_inherited_keys() {
    let ds = TempDataset::new();
    ds.json("task-a_bold.json", json!({"RepetitionTime": 2.0}));
    ds.text("sub-01/func/sub-01_task-a_bold.json", "[1, 2");
    ds.nifti("sub-01/func/sub-01_task-a_bold.nii.gz", Some(4), 2.0);
    let index = ds.scan();
    assert_eq!(with_code(&index, "SIDECAR_UNREADABLE").len(), 1);
    let record = run(&index, "sub-01_task-a_bold");
    assert_eq!(meta(record, "RepetitionTime").source, "task-a_bold.json");
}

#[test]
fn bids_a_malformed_root_sidecar_is_named_on_no_subject() {
    let ds = TempDataset::new();
    ds.text("task-a_bold.json", "{ not json");
    ds.json(
        "sub-01/sub-01_task-a_bold.json",
        json!({"RepetitionTime": 2.0}),
    );
    ds.nifti("sub-01/func/sub-01_task-a_bold.nii.gz", Some(4), 2.0);
    let index = ds.scan();
    let flagged = with_code(&index, "SIDECAR_UNREADABLE");
    assert_eq!(flagged.len(), 1);
    assert_eq!(flagged[0].subject, None);
    let record = run(&index, "sub-01_task-a_bold");
    assert_eq!(
        meta(record, "RepetitionTime").source,
        "sub-01/sub-01_task-a_bold.json"
    );
}

#[test]
fn bids_root_events_apply_to_every_run_and_the_nearest_table_wins() {
    let ds = TempDataset::new();
    ds.text("task-a_events.tsv", "onset\tduration\n1\t1\n100\t1\n");
    let stem = |s: &str| format!("sub-{s}/func/sub-{s}_task-a_bold");
    ds.nifti(&format!("{}.nii.gz", stem("01")), Some(10), 2.0);
    ds.nifti(&format!("{}.nii.gz", stem("02")), Some(10), 2.0);
    ds.text(
        "sub-02/func/sub-02_task-a_events.tsv",
        "onset\tduration\n1\t1\n",
    );
    ds.nifti("sub-02/anat/sub-02_T1w.nii.gz", None, 2.0);
    let index = ds.scan();
    assert!(run(&index, "sub-01_task-a_bold").has_events);
    assert!(run(&index, "sub-02_task-a_bold").has_events);
    assert!(!run(&index, "sub-02_T1w").has_events);
    // The root table runs past a 20 s scan; sub-02's own table does not.
    let flagged = with_code(&index, "EVENTS_AFTER_SCAN");
    assert_eq!(flagged.len(), 1, "{:?}", codes(&index));
    assert_eq!(flagged[0].run_ids, ["sub-01_task-a_bold"]);

    let inherited = run_detail(&ds.root, "sub-01_task-a_bold").unwrap();
    assert_eq!(inherited.events_duration, Some(101.0));
    assert!(inherited.event_checks.iter().any(|check| !check.ok));
    let own = run_detail(&ds.root, "sub-02_task-a_bold").unwrap();
    assert_eq!(own.events_duration, Some(2.0));
}

#[test]
fn bids_events_inherit_across_sessions_and_only_for_matching_entities() {
    let ds = TempDataset::new();
    ds.text("sub-01/sub-01_task-a_events.tsv", "onset\tduration\n1\t1\n");
    ds.text("task-b_run-2_events.tsv", "onset\tduration\n1\t1\n");
    let bold = |rest: &str| format!("sub-01/ses-1/func/sub-01_ses-1_{rest}_bold.nii.gz");
    ds.nifti(&bold("task-a"), Some(4), 2.0);
    ds.nifti(&bold("task-b_run-1"), Some(4), 2.0);
    ds.nifti(&bold("task-b_run-2"), Some(4), 2.0);
    let index = ds.scan();
    assert!(run(&index, "sub-01_ses-1_task-a_bold").has_events);
    assert!(!run(&index, "sub-01_ses-1_task-b_run-1_bold").has_events);
    assert!(run(&index, "sub-01_ses-1_task-b_run-2_bold").has_events);
}

#[test]
fn bids_inherited_events_are_checked_against_the_runs_own_events_json() {
    let ds = TempDataset::new();
    ds.text(
        "task-a_events.tsv",
        "onset\tduration\ttrial_type\n1\t1\tgo\n",
    );
    ds.json(
        "sub-01/sub-01_task-a_events.json",
        json!({"trial_type": {"Levels": {"stop": "Stop"}}}),
    );
    ds.nifti("sub-01/func/sub-01_task-a_bold.nii.gz", Some(4), 2.0);
    let index = ds.scan();
    assert_eq!(with_code(&index, "EVENTS_UNDECLARED_LEVELS").len(), 1);
}

#[test]
fn bids_rescans_notice_root_events_and_pipeline_versions() {
    let ds = TempDataset::new();
    ds.text("task-a_events.tsv", "onset\tduration\n1\t1\n");
    ds.nifti("sub-01/func/sub-01_task-a_bold.nii.gz", Some(10), 2.0);
    let description = |version: &str| {
        json!({"Name": "fMRIPrep", "BIDSVersion": "1.9.0", "DatasetType": "derivative",
               "GeneratedBy": [{"Name": "fMRIPrep", "Version": version}]})
    };
    ds.json(
        "derivatives/fmriprep/dataset_description.json",
        description("21.0.2"),
    );
    ds.text(
        "derivatives/fmriprep/sub-01/func/sub-01_task-a_desc-confounds_timeseries.tsv",
        "framewise_displacement\nn/a\n0.1\n",
    );
    let first = ds.scan();
    assert!(with_code(&first, "EVENTS_AFTER_SCAN").is_empty());

    ds.text("task-a_events.tsv", "onset\tduration\n1\t1\n500\t1\n");
    ds.json(
        "derivatives/fmriprep/dataset_description.json",
        description("24.1.1"),
    );
    let second = ds.scan();
    assert_eq!(with_code(&second, "EVENTS_AFTER_SCAN").len(), 1);
    let fd = run(&second, "sub-01_task-a_bold").fd.as_ref().unwrap();
    assert_eq!(fd.source, "fmriprep 24.1.1 confounds");
}

#[test]
fn bids_voxel_size_noise_is_not_a_variant_and_a_real_difference_is() {
    let ds = TempDataset::new();
    let sizes = [("01", 1.2994), ("02", 1.3006), ("03", 1.5)];
    for (subject, size) in sizes {
        let path = ds.path(&format!("sub-{subject}/anat/sub-{subject}_T1w.nii.gz"));
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        write_nifti(&path, [4, 4, 3], None, [1.0, size, 1.0], [0.0; 3], 2.0);
    }
    let index = ds.scan();
    assert_eq!(index.variants.len(), 1, "{:?}", index.variants);
    assert_eq!(index.variants[0].run_ids, ["sub-03_T1w"]);
    assert_eq!(index.variants[0].keys, ["VoxelSize"]);
    assert_eq!(run(&index, "sub-01_T1w").variant_id, None);
    assert_eq!(run(&index, "sub-02_T1w").variant_id, None);
}

#[test]
fn bids_small_numbers_keep_their_differences_and_lose_only_noise() {
    let real = TempDataset::new();
    two_runs_with(
        &real,
        "EffectiveEchoSpacing",
        [json!(0.00027), json!(0.00031)],
    );
    assert_eq!(real.scan().variants.len(), 1);

    let noise = TempDataset::new();
    two_runs_with(
        &noise,
        "EffectiveEchoSpacing",
        [json!(0.000275), json!(0.00027500001)],
    );
    assert!(noise.scan().variants.is_empty());

    let converter = TempDataset::new();
    two_runs_with(&converter, "RepetitionTime", [json!(2.0), json!(2.00001)]);
    assert!(converter.scan().variants.is_empty());
}

#[test]
fn bids_a_phasediff_may_have_its_own_grid() {
    let ds = TempDataset::new();
    ds.nifti("sub-01/func/sub-01_task-a_bold.nii.gz", Some(4), 2.0);
    let fmap = ds.path("sub-01/fmap/sub-01_phasediff.nii.gz");
    std::fs::create_dir_all(fmap.parent().unwrap()).unwrap();
    write_nifti(&fmap, [8, 8, 3], None, [2.0, 2.0, 6.0], [0.0; 3], 0.0);
    ds.json(
        "sub-01/fmap/sub-01_phasediff.json",
        json!({"EchoTime1": 0.00492, "EchoTime2": 0.00738,
               "IntendedFor": ["func/sub-01_task-a_bold.nii.gz"]}),
    );
    let index = ds.scan();
    assert!(with_code(&index, "FMAP_GRID_MISMATCH").is_empty());
    let link = run(&index, "sub-01_task-a_bold").fmap.as_ref().unwrap();
    assert_eq!(link.via, "IntendedFor");
    assert_eq!(link.fmap_run_ids, ["sub-01_phasediff"]);
    assert!(
        link.checks.iter().all(|check| check.ok),
        "{:?}",
        link.checks
    );
}

#[test]
fn bids_phasediff_echo_times_define_a_variant() {
    let ds = TempDataset::new();
    for (subject, second) in [("01", 0.00738), ("02", 0.00738), ("03", 0.0098)] {
        let stem = format!("sub-{subject}/fmap/sub-{subject}_phasediff");
        ds.nifti(&format!("{stem}.nii.gz"), None, 0.0);
        ds.json(
            &format!("{stem}.json"),
            json!({"EchoTime1": 0.00492, "EchoTime2": second}),
        );
    }
    let index = ds.scan();
    assert_eq!(index.variants.len(), 1);
    assert_eq!(index.variants[0].keys, ["EchoTime2"]);
    assert_eq!(index.variants[0].run_ids, ["sub-03_phasediff"]);
}

#[test]
fn bids_mriqc_rows_join_by_entities_not_by_spelling() {
    let ds = TempDataset::new();
    let image = "sub-01/ses-a/func/sub-01_ses-a_task-x_run-01_bold.nii.gz";
    ds.nifti(image, Some(4), 2.0);
    ds.nifti(
        "sub-01/ses-b/func/sub-01_ses-b_task-x_run-01_bold.nii.gz",
        Some(4),
        2.0,
    );
    ds.nifti("sub-01/ses-a/anat/sub-01_ses-a_T1w.nii.gz", None, 2.0);
    ds.json(
        "derivatives/mriqc/dataset_description.json",
        json!({"GeneratedBy": [{"Name": "MRIQC", "Version": "22.0.1"}]}),
    );
    ds.text(
        "derivatives/mriqc/group_bold.tsv",
        "bids_name\ttsnr\tfd_mean\n\
         sub-01_ses-a_task-x_run-1_bold\t41.5\t0.1\n\
         sub-01_ses-b_task-x_run-1_bold\t52.5\t0.2\n",
    );
    let index = ds.scan();
    let tsnr = |id: &str| run(&index, id).iqms.as_ref().and_then(|iqms| iqms.tsnr);
    assert_eq!(tsnr("sub-01_ses-a_task-x_run-01_bold"), Some(41.5));
    assert_eq!(tsnr("sub-01_ses-b_task-x_run-01_bold"), Some(52.5));
    assert!(run(&index, "sub-01_ses-a_T1w").iqms.is_none());
}

#[test]
fn bids_participants_without_images_are_one_note_and_not_a_gap_in_coverage() {
    let ds = TempDataset::new();
    ds.text(
        "participants.tsv",
        "participant_id\tage\nsub-01\t30\nsub-02\t31\nsub-03\t32\nsub-04\t33\n",
    );
    ds.nifti("sub-01/func/sub-01_task-a_bold.nii.gz", Some(4), 2.0);
    ds.json(
        "derivatives/freesurfer/dataset_description.json",
        json!({"GeneratedBy": [{"Name": "FreeSurfer", "Version": "7.4"}]}),
    );
    ds.text("derivatives/freesurfer/sub-01/stats/aseg.stats", "x");
    ds.text("derivatives/freesurfer/sub-02/stats/aseg.stats", "x");
    let index = ds.scan();
    assert_eq!(index.subjects, ["01", "02", "03", "04"]);
    let note = with_code(&index, "PARTICIPANTS_WITHOUT_DATA");
    assert_eq!(note.len(), 1, "{:?}", codes(&index));
    assert_eq!(note[0].tag, "note");
    assert!(note[0].title.starts_with("3 of 4"), "{}", note[0].title);
    for code in ["subject_directory", "participant_directory_missing"] {
        assert!(with_code(&index, code).is_empty(), "{:?}", codes(&index));
    }
    let info = &index.derivatives[0];
    assert_eq!((info.runs, info.of, info.unit.as_str()), (1, 1, "subject"));
    let status: BTreeMap<_, _> = index
        .derivative_status
        .iter()
        .map(|row| (row.subject.as_str(), row.status.as_str()))
        .collect();
    // These outputs name no source version, so "current" would be a guess.
    assert_eq!(status["01"], "unrecorded");
    assert_eq!(status["02"], "no_local_data");
    assert_eq!(status["04"], "no_local_data");
}

#[test]
fn bids_a_complete_dataset_has_no_participant_note() {
    let ds = TempDataset::new();
    for subject in ["01", "02"] {
        let path = format!("sub-{subject}/func/sub-{subject}_task-a_bold.nii.gz");
        ds.nifti(&path, Some(4), 2.0);
    }
    assert!(with_code(&ds.scan(), "PARTICIPANTS_WITHOUT_DATA").is_empty());
}

#[test]
fn bids_empty_dataset_fields_are_absent_not_blank() {
    let ds = TempDataset::new();
    ds.json(
        "dataset_description.json",
        json!({"Name": "S", "BIDSVersion": "1.9.0", "License": "", "DatasetDOI": ""}),
    );
    ds.nifti("sub-01/func/sub-01_task-a_bold.nii.gz", Some(4), 2.0);
    let index = ds.scan();
    assert_eq!(index.license, None);
    assert_eq!(index.doi, None);
}

#[test]
fn bids_scanner_field_comes_from_runs_of_the_modal_model_that_state_it() {
    let ds = TempDataset::new();
    // Three sbrefs name the model but not the field, as in NARPS.
    ds.json(
        "task-a_sbref.json",
        json!({"Manufacturer": "SIEMENS", "ManufacturersModelName": "Prisma"}),
    );
    ds.json(
        "T1w.json",
        json!({"Manufacturer": "SIEMENS", "ManufacturersModelName": "Prisma",
               "MagneticFieldStrength": 3}),
    );
    for run_index in 1..=3 {
        ds.nifti(
            &format!("sub-01/func/sub-01_task-a_run-{run_index}_sbref.nii.gz"),
            None,
            2.0,
        );
    }
    ds.nifti("sub-01/anat/sub-01_T1w.nii.gz", None, 2.0);
    assert_eq!(ds.scan().scanner.as_deref(), Some("SIEMENS Prisma 3T"));
}

#[test]
fn bids_exclusion_derivative_states_its_own_bids_version_and_omits_unknowns() {
    let ds = TempDataset::new();
    ds.json(
        "dataset_description.json",
        json!({"Name": "Old", "BIDSVersion": "1.0.0rc2", "DatasetDOI": "10.18112/x.v1.0.1"}),
    );
    let bare = BidsExclusionContext {
        source_version: None,
    };
    write_exclusions(&ds.root, &[row("sub-01", "gone")], &bare, "0.9.0").unwrap();
    let read = |name: &str| -> Value {
        let path = format!("derivatives/brainflow/{name}");
        serde_json::from_slice(&std::fs::read(ds.path(&path)).unwrap()).unwrap()
    };
    assert_eq!(read("dataset_description.json")["BIDSVersion"], "1.9.0");
    assert!(read("exclusions.json")
        .get("FramewiseDisplacement")
        .is_none());
}

#[test]
fn bids_exclusion_write_reports_only_what_it_added() {
    let ds = TempDataset::new();
    write_exclusions(&ds.root, &[row("sub-01", "older")], &context(), "0").unwrap();
    let write: BidsExclusionWrite =
        write_exclusions(&ds.root, &[row("sub-02", "new")], &context(), "0").unwrap();
    assert_eq!(write.all.len(), 2);
    assert_eq!(write.added.len(), 1);
    assert_eq!(write.added[0].entity, "sub-02");
}

#[test]
fn bids_exclusion_revert_removes_one_criterion_of_an_entity() {
    let ds = TempDataset::new();
    let mut manual = row("sub-01", "by hand");
    manual.criterion = "manual".to_string();
    write_exclusions(&ds.root, &[row("sub-01", "fd"), manual], &context(), "0").unwrap();
    let left = revert_exclusions(&ds.root, &[key("sub-01")]).unwrap();
    assert_eq!(left.len(), 1);
    assert_eq!(left[0].criterion, "manual");
    assert_eq!(read_exclusions(&ds.root).unwrap(), left);
}

#[test]
fn bids_exclusion_rows_keep_their_own_criteria() {
    let ds = TempDataset::new();
    let mut other = row("sub-02", "stricter");
    other.threshold = "0.2".to_string();
    other.triggered_by = "sub-02_task-a_bold".to_string();
    write_exclusions(&ds.root, &[row("sub-01", "a"), other], &context(), "0").unwrap();
    let rows = read_exclusions(&ds.root).unwrap();
    assert_eq!(rows[0].threshold, "0.25");
    assert_eq!(rows[1].threshold, "0.2");
    assert_eq!(rows[1].triggered_by, "sub-02_task-a_bold");
    let sidecar: Value = serde_json::from_slice(
        &std::fs::read(ds.path("derivatives/brainflow/exclusions.json")).unwrap(),
    )
    .unwrap();
    assert!(sidecar.get("FramewiseDisplacement").is_none());
    assert!(sidecar.get("threshold").is_some());
}

#[test]
fn bids_exclusions_read_files_from_before_rows_carried_criteria() {
    let ds = TempDataset::new();
    write_exclusions(&ds.root, &[row("sub-01", "a")], &context(), "0").unwrap();
    let legacy = "entity\treason\tcriterion\tvalue\tauthor\tdate\tsource\n\
                  sub-09\told\tfd_mean>0.25\t0.3\tbb\t2026-11-01\tfmriprep\n";
    std::fs::write(ds.path("derivatives/brainflow/exclusions.tsv"), legacy).unwrap();
    let rows = read_exclusions(&ds.root).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].threshold, "");
    let write = write_exclusions(&ds.root, &[row("sub-01", "a")], &context(), "0").unwrap();
    assert_eq!(write.all.len(), 2, "the old row survives the upgrade");
}

#[test]
fn bids_exclusion_metadata_is_written_before_the_row() {
    let ds = TempDataset::new();
    std::fs::create_dir_all(ds.path("derivatives/brainflow/dataset_description.json")).unwrap();
    assert!(write_exclusions(&ds.root, &[row("sub-01", "a")], &context(), "0").is_err());
    assert!(
        !ds.path("derivatives/brainflow/exclusions.tsv").exists(),
        "a failed write leaves no row behind"
    );
}

#[test]
fn bids_exclusion_writer_waits_for_a_live_lock_and_clears_a_dead_one() {
    let ds = TempDataset::new();
    write_exclusions(&ds.root, &[row("sub-01", "a")], &context(), "0").unwrap();
    let lock = ds.path("derivatives/brainflow/.exclusions.lock");
    std::fs::write(&lock, "").unwrap();
    assert!(
        write_exclusions(&ds.root, &[row("sub-02", "b")], &context(), "0").is_err(),
        "a held lock stops the write"
    );
    assert_eq!(read_exclusions(&ds.root).unwrap().len(), 1);
    let old = std::time::SystemTime::now() - std::time::Duration::from_secs(600);
    std::fs::File::options()
        .write(true)
        .open(&lock)
        .unwrap()
        .set_modified(old)
        .unwrap();
    assert_eq!(
        write_exclusions(&ds.root, &[row("sub-02", "b")], &context(), "0")
            .unwrap()
            .all
            .len(),
        2
    );
    assert!(!lock.exists(), "the lock is released");
}

#[test]
fn bids_a_complete_scan_reads_all_files_and_counts_what_it_opened_apart() {
    let ds = TempDataset::new();
    ds.nifti("sub-01/anat/sub-01_T1w.nii.gz", None, 0.0);
    ds.text("README", "hello");
    let first = ds.scan();
    assert_eq!(first.files_read, first.total_file_count);
    let again = ds.scan();
    assert_eq!(again.files_read, again.total_file_count);
    assert_eq!(again.files_opened, 0.0);
}

#[test]
fn bids_session_order_comes_from_acquisition_time_only() {
    let ds = TempDataset::new();
    ds.nifti("sub-01/ses-test/anat/sub-01_ses-test_T1w.nii.gz", None, 0.0);
    ds.nifti(
        "sub-01/ses-retest/anat/sub-01_ses-retest_T1w.nii.gz",
        None,
        0.0,
    );
    assert!(ds.scan().session_order.is_empty());
    ds.text(
        "sub-01/sub-01_sessions.tsv",
        "session_id\tacq_time\nses-retest\t2021-03-01T10:00:00\nses-test\t2021-01-01T10:00:00\n",
    );
    assert_eq!(ds.scan().session_order, ["test", "retest"]);
}

#[test]
fn bids_session_order_reads_scans_files() {
    let ds = TempDataset::new();
    ds.nifti("sub-01/ses-b/anat/sub-01_ses-b_T1w.nii.gz", None, 0.0);
    ds.nifti("sub-01/ses-a/anat/sub-01_ses-a_T1w.nii.gz", None, 0.0);
    ds.text(
        "sub-01/ses-b/sub-01_ses-b_scans.tsv",
        "filename\tacq_time\nanat/sub-01_ses-b_T1w.nii.gz\t2021-01-01T10:00:00\n",
    );
    ds.text(
        "sub-01/ses-a/sub-01_ses-a_scans.tsv",
        "filename\tacq_time\nanat/sub-01_ses-a_T1w.nii.gz\t2021-02-01T10:00:00\n",
    );
    assert_eq!(ds.scan().session_order, ["b", "a"]);
}

#[test]
fn bids_a_root_sidecar_finding_is_one_and_survives_a_partial_rescan() {
    let ds = TempDataset::new();
    ds.nifti("sub-01/func/sub-01_task-a_bold.nii.gz", None, 0.0);
    ds.nifti("sub-02/func/sub-02_task-a_bold.nii.gz", None, 0.0);
    ds.text("task-a_bold.json", "{ not json");
    assert_eq!(with_code(&ds.scan(), "SIDECAR_UNREADABLE").len(), 1);
    // Only sub-02 is read again: the finding must neither vanish nor double.
    ds.nifti("sub-02/anat/sub-02_T1w.nii.gz", None, 0.0);
    assert_eq!(with_code(&ds.scan(), "SIDECAR_UNREADABLE").len(), 1);
    assert!(with_code(&ds.scan(), "SIDECAR_UNREADABLE")[0]
        .subject
        .is_none());
}

#[test]
fn bids_echoes_of_one_run_count_once_for_a_pipeline() {
    let ds = TempDataset::new();
    for echo in 1..=3 {
        let name = format!("sub-01/func/sub-01_task-a_echo-{echo}_bold.nii.gz");
        ds.nifti(&name, None, 0.0);
    }
    ds.text(
        "derivatives/fmriprep/dataset_description.json",
        r#"{"Name":"fMRIPrep","GeneratedBy":[{"Name":"fMRIPrep","Version":"24"}]}"#,
    );
    ds.text(
        "derivatives/fmriprep/sub-01/func/sub-01_task-a_desc-confounds_timeseries.tsv",
        "framewise_displacement\nn/a\n0.1\n",
    );
    let index = ds.scan();
    let info = &index.derivatives[0];
    assert_eq!((info.runs, info.of), (1, 1));
}

#[test]
fn bids_outputs_without_a_source_version_are_not_called_current() {
    let ds = TempDataset::new();
    ds.nifti("sub-01/func/sub-01_task-a_bold.nii.gz", None, 0.0);
    ds.text(
        "derivatives/fmriprep/dataset_description.json",
        r#"{"Name":"fMRIPrep","GeneratedBy":[{"Name":"fMRIPrep","Version":"24"}]}"#,
    );
    ds.text(
        "derivatives/fmriprep/sub-01/func/sub-01_task-a_desc-confounds_timeseries.tsv",
        "framewise_displacement\nn/a\n0.1\n",
    );
    let index = ds.scan();
    assert_eq!(index.derivative_status[0].status, "unrecorded");
}

#[test]
fn bids_the_scan_and_detail_read_fd_from_the_same_pipeline() {
    let ds = TempDataset::new();
    ds.nifti("sub-01/func/sub-01_task-a_bold.nii.gz", None, 0.0);
    // `aroma` sorts first in a walk; fMRIPrep is the preferred FD source.
    for (pipeline, value) in [("aroma", "0.9"), ("fmriprep", "0.1")] {
        ds.text(
            &format!("derivatives/{pipeline}/dataset_description.json"),
            r#"{"Name":"x"}"#,
        );
        ds.text(
            &format!(
                "derivatives/{pipeline}/sub-01/func/sub-01_task-a_desc-confounds_timeseries.tsv"
            ),
            &format!("framewise_displacement\nn/a\n{value}\n"),
        );
    }
    let index = ds.scan();
    let fd = run(&index, "sub-01_task-a_bold").fd.as_ref().unwrap();
    assert!((fd.mean - 0.1).abs() < 1e-6, "{}", fd.mean);
    let detail = run_detail(&ds.root, "sub-01_task-a_bold").unwrap();
    assert_eq!(detail.fd_source.as_deref(), Some(fd.source.as_str()));
}

#[test]
fn bids_run_events_deliver_an_inherited_table() {
    let ds = TempDataset::new();
    ds.nifti("sub-01/func/sub-01_task-a_bold.nii.gz", None, 0.0);
    ds.text(
        "task-a_events.tsv",
        "onset\tduration\ttrial_type\trt\n0\t10\tgo\t0.4\nn/a\t1\tgo\t1\n20\t10\tstop\tn/a\n",
    );
    let rows = run_events(&ds.root, "sub-01_task-a_bold").unwrap();
    assert_eq!(rows.len(), 2, "the row with no onset is left out");
    assert_eq!(rows[1].trial_type, "stop");
    assert_eq!(rows[0].additional["rt"], "0.4");
}

#[test]
fn bids_validator_findings_name_their_run() {
    let ds = TempDataset::new();
    ds.nifti(
        "sub-01/ses-a/func/sub-01_ses-a_task-x_bold.nii.gz",
        Some(4),
        2.0,
    );
    let runs = ds.scan().runs;
    let mut item = BidsFinding {
        id: "rule:x".to_string(),
        tag: "validator".to_string(),
        severity: "error".to_string(),
        code: "rule".to_string(),
        title: "Bad".to_string(),
        detail: "Bad".to_string(),
        subject: Some("01".to_string()),
        session: None,
        run_ids: Vec::new(),
        file: Some("sub-01/ses-a/func/sub-01_ses-a_task-x_bold.nii.gz".to_string()),
    };
    super::scan::attach_validator_runs(std::slice::from_mut(&mut item), &runs);
    assert_eq!(item.run_ids, ["sub-01_ses-a_task-x_bold"]);
    assert_eq!(item.session.as_deref(), Some("a"));
}

#[test]
fn bids_the_index_says_when_the_derivative_is_already_described() {
    let ds = TempDataset::new();
    ds.nifti("sub-01/anat/sub-01_T1w.nii.gz", None, 0.0);
    assert!(!ds.scan().exclusions_described);
    write_exclusions(&ds.root, &[row("sub-01", "a")], &context(), "0").unwrap();
    revert_exclusions(&ds.root, &[key("sub-01")]).unwrap();
    let index = ds.scan();
    assert!(index.exclusions.is_empty());
    assert!(
        index.exclusions_described,
        "reverting leaves the description"
    );
}

/// Two subjects whose runs inherit `RepetitionTime` from a root sidecar.
fn root_sidecar_fixture(ds: &TempDataset) -> (FakeServer, &'static str) {
    let sidecar = "task-a_bold.json";
    ds.json(sidecar, json!({"RepetitionTime": 2.0}));
    for subject in ["01", "02"] {
        ds.text(
            &format!("sub-{subject}/func/sub-{subject}_task-a_bold.nii.gz"),
            "stub",
        );
    }
    (FakeServer::new(ds, false), sidecar)
}

#[test]
fn bids_a_failed_root_sidecar_keeps_every_subject_out_of_the_store() {
    let ds = TempDataset::new();
    let (server, sidecar) = root_sidecar_fixture(&ds);
    server.unfetchable.lock().unwrap().push(sidecar.to_string());
    let index = ds.scan_with(Some(&server), |_| {});
    assert_eq!(with_code(&index, "SIDECAR_UNREADABLE").len(), 1);
    for id in ["sub-01_task-a_bold", "sub-02_task-a_bold"] {
        assert!(run(&index, id)
            .sidecar
            .iter()
            .all(|e| e.key != "RepetitionTime"));
    }

    server.unfetchable.lock().unwrap().clear();
    server.asked.lock().unwrap().clear();
    let index = ds.scan_with(Some(&server), |_| {});
    assert_eq!(
        server.asked.lock().unwrap().len(),
        2,
        "neither subject was stored"
    );
    assert!(with_code(&index, "SIDECAR_UNREADABLE").is_empty());
    for id in ["sub-01_task-a_bold", "sub-02_task-a_bold"] {
        assert_eq!(meta(run(&index, id), "RepetitionTime").value, "2.0");
    }
}

#[test]
fn bids_a_malformed_root_sidecar_keeps_every_remote_subject_out_of_the_store() {
    let ds = TempDataset::new();
    let (server, sidecar) = root_sidecar_fixture(&ds);
    ds.text(sidecar, "{ not json");
    ds.scan_with(Some(&server), |_| {});
    let stored = super::store::load(&ds.cache, &ds.cache.join("empty-mirror"));
    assert!(stored.subjects.is_empty(), "{:?}", stored.subjects.keys());
}

#[test]
fn bids_a_failed_subject_sidecar_keeps_only_that_subject_out_of_the_store() {
    let ds = TempDataset::new();
    let (server, _) = root_sidecar_fixture(&ds);
    let own = "sub-01/func/sub-01_task-a_bold.json";
    ds.json(own, json!({"EchoTime": 0.03}));
    server.unfetchable.lock().unwrap().push(own.to_string());
    ds.scan_with(Some(&server), |_| {});
    let stored = super::store::load(&ds.cache, &ds.cache.join("empty-mirror"));
    assert!(!stored.subjects.contains_key("01"));
    assert!(stored.subjects.contains_key("02"));
}

#[test]
fn bids_progress_says_a_scan_is_remote_from_its_first_event() {
    let ds = TempDataset::new();
    let server = remote_fixture(&ds);
    server.unlistable.lock().unwrap().push("sub-02/anat".into());
    let mut seen = Vec::new();
    ds.scan_with(Some(&server), |p| {
        seen.push((p.phase.clone(), p.is_remote, p.listing_complete));
    });
    assert_eq!(seen[0], ("listing".to_string(), true, false));
    assert!(seen
        .iter()
        .all(|(_, remote, complete)| *remote && !*complete));

    server.unlistable.lock().unwrap().clear();
    let mut last = None;
    ds.scan_with(Some(&server), |p| last = Some(p.listing_complete));
    assert_eq!(last, Some(true));

    let local = TempDataset::new();
    let mut flags = Vec::new();
    local.scan_with(None, |p| flags.push((p.is_remote, p.listing_complete)));
    assert!(flags.iter().all(|flag| *flag == (false, true)));
}

#[test]
fn bids_a_partial_listing_says_nothing_that_depends_on_absence() {
    let ds = TempDataset::new();
    ds.text("sub-01/func/sub-01_task-a_bold.nii.gz", "stub");
    ds.text("sub-02/func/sub-02_task-a_bold.nii.gz", "stub");
    ds.text("sub-01/fmap/sub-01_epi.nii.gz", "stub");
    ds.json(
        "sub-01/fmap/sub-01_epi.json",
        json!({"IntendedFor": "func/sub-01_task-b_bold.nii.gz"}),
    );
    let server = FakeServer::new(&ds, false);
    server.unlistable.lock().unwrap().push("sub-02/fmap".into());
    ds.text("sub-02/fmap/.keep", "");
    let index = ds.scan_with(Some(&server), |_| {});
    assert!(!index.listing_complete);
    for code in [
        "NO_FIELDMAP",
        "NO_FIELDMAPS_IN_DATASET",
        "INTENDEDFOR_BROKEN",
    ] {
        assert!(with_code(&index, code).is_empty(), "{code}");
    }
    assert!(run(&index, "sub-02_task-a_bold").fmap.is_none());

    server.unlistable.lock().unwrap().clear();
    let index = ds.scan_with(Some(&server), |_| {});
    assert_eq!(with_code(&index, "INTENDEDFOR_BROKEN").len(), 1);
    assert!(!with_code(&index, "NO_FIELDMAP").is_empty());
}

#[test]
fn bids_no_field_maps_at_all_is_not_claimed_from_a_partial_listing() {
    let ds = TempDataset::new();
    ds.text("sub-01/func/sub-01_task-a_bold.nii.gz", "stub");
    ds.text("sub-02/anat/sub-02_T1w.nii.gz", "stub");
    let server = FakeServer::new(&ds, false);
    server.unlistable.lock().unwrap().push("sub-02/anat".into());
    let index = ds.scan_with(Some(&server), |_| {});
    assert!(with_code(&index, "NO_FIELDMAPS_IN_DATASET").is_empty());
    assert!(with_code(&index, "NO_FIELDMAP").is_empty());
}

fn stale_lock(ds: &TempDataset) -> PathBuf {
    let dir = ds.path("derivatives/brainflow");
    std::fs::create_dir_all(&dir).unwrap();
    let lock = dir.join(".exclusions.lock");
    std::fs::write(&lock, "dead").unwrap();
    std::fs::File::options()
        .write(true)
        .open(&lock)
        .unwrap()
        .set_modified(std::time::SystemTime::now() - std::time::Duration::from_secs(600))
        .unwrap();
    lock
}

#[test]
fn bids_two_takers_of_a_stale_lock_never_hold_it_together() {
    let ds = TempDataset::new();
    for _ in 0..20 {
        let lock = stale_lock(&ds);
        let dir = lock.parent().unwrap();
        let holders = std::sync::atomic::AtomicU32::new(0);
        let start = std::sync::Barrier::new(2);
        std::thread::scope(|scope| {
            for _ in 0..2 {
                scope.spawn(|| {
                    start.wait();
                    let held = DatasetLock::take(dir).unwrap();
                    assert_eq!(holders.fetch_add(1, Ordering::SeqCst), 0, "two holders");
                    std::thread::sleep(std::time::Duration::from_millis(5));
                    holders.fetch_sub(1, Ordering::SeqCst);
                    drop(held);
                });
            }
        });
        let left: Vec<_> = std::fs::read_dir(dir).unwrap().flatten().collect();
        assert!(left.is_empty(), "nothing is left behind: {left:?}");
    }
}

#[test]
fn bids_a_lock_taken_over_is_not_removed_by_its_old_owner() {
    let ds = TempDataset::new();
    let dir = ds.path("derivatives/brainflow");
    std::fs::create_dir_all(&dir).unwrap();
    let lock = dir.join(".exclusions.lock");
    let held = DatasetLock::take(&dir).unwrap();
    std::fs::write(&lock, "someone-else").unwrap();
    drop(held);
    assert_eq!(std::fs::read_to_string(&lock).unwrap(), "someone-else");
}
