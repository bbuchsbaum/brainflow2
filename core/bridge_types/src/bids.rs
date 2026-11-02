use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BidsDatasetSummary {
    pub path: String,
    pub name: String,
    pub bids_version: String,
    pub license: Option<String>,
    pub authors: Vec<String>,
    pub subject_count: usize,
    pub session_ids: Vec<String>,
    pub task_ids: Vec<String>,
    pub modalities: Vec<String>,
    pub total_file_count: usize,
    pub total_size_bytes: u64,
    pub coverage: BidsCoverageMatrix,
    pub participants: Vec<BidsParticipantRow>,
    pub participant_columns: Vec<String>,
    pub task_designs: Vec<BidsTaskDesign>,
    pub validation: BidsValidationResult,
    pub storage_by_modality: HashMap<String, u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BidsCoverageMatrix {
    pub subjects: Vec<String>,
    pub columns: Vec<BidsCoverageColumn>,
    pub cells: Vec<Vec<BidsCoverageCell>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BidsCoverageColumn {
    pub session: Option<String>,
    pub modality: String,
    pub suffix: String,
    pub task: Option<String>,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BidsCoverageCell {
    pub present: bool,
    pub run_count: usize,
    pub size_bytes: u64,
    pub file_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BidsParticipantRow {
    pub participant_id: String,
    pub values: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BidsTaskDesign {
    pub task: String,
    pub trial_types: Vec<String>,
    pub avg_duration_secs: f64,
    pub total_runs: usize,
    pub events_per_type: HashMap<String, usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BidsEventRow {
    pub onset: f64,
    pub duration: f64,
    pub trial_type: String,
    pub additional: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BidsValidationResult {
    pub passed: bool,
    pub critical_count: usize,
    pub warning_count: usize,
    pub issues: Vec<BidsValidationIssue>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BidsValidationIssue {
    pub severity: String,
    pub description: String,
    pub file: Option<String>,
    pub rule: String,
}

// --- BIDS browser contract (docs/plans/bids-browser-implementation.md) ---

/// Everything the BIDS browser knows about a dataset. Columns and counts are
/// derived from this in the UI model; the backend reports per-run facts.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BidsBrowserIndex {
    pub scan_id: String,
    pub dataset_path: String,
    pub name: String,
    pub bids_version: String,
    pub dataset_version: Option<String>,
    pub doi: Option<String>,
    pub license: Option<String>,
    pub authors: Vec<String>,
    /// Modal Manufacturer, ManufacturersModelName and field strength.
    pub scanner: Option<String>,
    pub is_remote: bool,
    /// False when the scan was cancelled or superseded: results are partial.
    pub complete: bool,
    /// True when every directory was walked: always for a local dataset, and
    /// for a remote one when the server walk finished. Otherwise an absent file
    /// is unknown, not missing.
    pub listing_complete: bool,
    pub default_author: String,
    pub previous_scan_at: Option<String>,
    pub new_subjects: Vec<String>,
    pub total_file_count: f64,
    pub total_size_bytes: f64,
    /// Files this scan has covered, of `total_file_count`. A complete scan
    /// covers all of them, whether read or served from the stored index.
    pub files_read: f64,
    /// Files actually opened; unchanged subjects are served from the index.
    pub files_opened: f64,
    /// Sessions in acquisition order, from `acq_time` in sessions or scans
    /// files. Empty when the dataset does not say.
    pub session_order: Vec<String>,
    pub participants: Vec<BidsParticipantRow>,
    pub participant_columns: Vec<String>,
    /// Natural order, without the `sub-` prefix. Includes subjects found on
    /// disk that participants.tsv does not list.
    pub subjects: Vec<String>,
    pub runs: Vec<BidsRunRecord>,
    pub series_modal: Vec<BidsSeriesModal>,
    pub variants: Vec<BidsVariantGroup>,
    pub findings: Vec<BidsFinding>,
    pub derivatives: Vec<BidsDerivativeInfo>,
    pub derivative_status: Vec<BidsSubjectDerivative>,
    pub exclusions: Vec<BidsExclusion>,
    /// `derivatives/brainflow/dataset_description.json` already exists.
    pub exclusions_described: bool,
}

/// One image file of the raw dataset. Companions are not runs.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BidsRunRecord {
    /// File stem including the BIDS suffix, e.g. `sub-01_ses-02_task-nback_run-1_bold`.
    pub id: String,
    pub subject: String,
    pub session: Option<String>,
    pub datatype: String,
    pub suffix: String,
    pub task: Option<String>,
    pub acq: Option<String>,
    pub dir: Option<String>,
    pub run: Option<String>,
    pub echo: Option<String>,
    pub path: String,
    pub rel_path: String,
    pub size_bytes: f64,
    /// e.g. `task-nback_bold`, `T1w`, `epi_dir-AP`. Keeps acq/ce/rec/dir/echo apart.
    pub series: String,
    /// Effective acquisition metadata with provenance.
    pub sidecar: Vec<BidsMetaValue>,
    pub header: Option<BidsHeaderSummary>,
    /// `None` is the modal acquisition of the series.
    pub variant_id: Option<String>,
    pub fmap: Option<BidsFieldmapLink>,
    pub fd: Option<BidsFdSummary>,
    pub iqms: Option<BidsIqms>,
    pub has_events: bool,
    /// RFC 3339, UTC.
    pub mtime: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BidsMetaValue {
    pub key: String,
    /// JSON-encoded value.
    pub value: String,
    /// Relative path of the supplying file, or `NIfTI`.
    pub source: String,
    /// `run`, `dataset` or `nifti`.
    pub source_kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BidsHeaderSummary {
    pub dim: Vec<u32>,
    pub pixdim: Vec<f32>,
    pub qform_code: i16,
    pub sform_code: i16,
    pub tr_seconds: Option<f32>,
    pub n_volumes: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BidsSeriesModal {
    pub series: String,
    pub values: Vec<BidsMetaValue>,
    pub n_runs: u32,
}

/// CuBIDS-style acquisition group. Letters start at `A` per series; the modal
/// group has no entry.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BidsVariantGroup {
    pub id: String,
    pub series: String,
    pub name: String,
    pub diff: String,
    pub note: String,
    pub keys: Vec<String>,
    pub run_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BidsFinding {
    /// Stable across scans.
    pub id: String,
    /// `validator`, `content` or `note`.
    pub tag: String,
    /// `error`, `warning` or `info`.
    pub severity: String,
    pub code: String,
    pub title: String,
    pub detail: String,
    pub subject: Option<String>,
    pub session: Option<String>,
    pub run_ids: Vec<String>,
    pub file: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BidsFdSummary {
    /// Mean of `framewise_displacement` over frames with a value. Like `max`,
    /// `n_frames`, the over-threshold counts and `trace`, it includes
    /// non-steady-state frames, so it matches the raw confounds and checks that
    /// do not depend on MRIQC.
    pub mean: f32,
    pub max: f32,
    /// Frames with a value. A leading `n/a` frame is not counted.
    pub n_frames: u32,
    pub over_0_2: u32,
    pub over_0_5: u32,
    /// 0-based volume index in the full series of the largest FD, skipping
    /// non-steady-state volumes and the frame after each, whose FD measures the
    /// jump out of it. If that skips every frame, the largest FD of all frames.
    pub peak_volume: u32,
    /// First volume after the leading run of non-steady-state volumes; 0 if
    /// there is no such run or every volume is flagged.
    pub first_valid_volume: u32,
    /// Ascending 0-based volumes flagged by `non_steady_state_outlier*`
    /// confounds. They need not be contiguous.
    pub non_steady_volumes: Vec<u32>,
    /// 28 points; each is the maximum of its bin, so spikes stay visible.
    pub trace: Vec<f32>,
    pub source: String,
    pub definition: String,
    pub filtered: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BidsIqms {
    pub tsnr: Option<f32>,
    pub fd_mean: Option<f32>,
    pub gsr_y: Option<f32>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BidsFieldmapLink {
    pub source_id: Option<String>,
    pub fmap_run_ids: Vec<String>,
    /// `B0FieldSource`, `IntendedFor` or `none`.
    pub via: String,
    pub checks: Vec<BidsCheck>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BidsCheck {
    pub ok: bool,
    /// `ok`, `warning` or `error`.
    pub severity: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BidsDerivativeInfo {
    pub name: String,
    pub version: Option<String>,
    pub source_version: Option<String>,
    pub stale: bool,
    pub runs: u32,
    pub of: u32,
    /// What `runs` and `of` count: `run` or `subject`.
    pub unit: String,
    pub root: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BidsSubjectDerivative {
    pub subject: String,
    pub name: String,
    /// `current`, `partial`, `missing`, `stale`, `no_local_data`, or
    /// `unrecorded`: outputs exist but their source version does not say what
    /// they were built from.
    pub status: String,
}

/// One row of `derivatives/brainflow/exclusions.tsv`. `scope` is not a TSV
/// column: it is derived from the entity on read. Each row carries its own
/// threshold and FD definition, so rows made under different criteria stay
/// truthful side by side.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BidsExclusion {
    /// A run id, `sub-XX_ses-YY` or `sub-XX`.
    pub entity: String,
    /// `run`, `session` or `participant`.
    pub scope: String,
    pub reason: String,
    pub criterion: String,
    pub value: String,
    pub author: String,
    pub date: String,
    pub source: String,
    /// The threshold the criterion used, or empty.
    #[serde(default)]
    pub threshold: String,
    /// The FD definition behind `value`, or empty.
    #[serde(default)]
    pub definition: String,
    /// For a session or participant row: the run `value` was measured on.
    #[serde(default)]
    pub triggered_by: String,
}

/// What a write needs that no row says.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BidsExclusionContext {
    pub source_version: Option<String>,
}

/// Identifies one exclusion row: an entity can be excluded under several criteria.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BidsExclusionKey {
    pub entity: String,
    pub criterion: String,
}

/// The rows on disk after a write, and which of them it added.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BidsExclusionWrite {
    pub all: Vec<BidsExclusion>,
    pub added: Vec<BidsExclusion>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BidsScanProgress {
    pub scan_id: String,
    /// The dataset is read from a server, from the first event of a scan.
    pub is_remote: bool,
    /// False until a remote walk has reached every directory.
    pub listing_complete: bool,
    /// `listing`, `reading`, `indexing`, `subjects`, `finalizing`.
    pub phase: String,
    pub subjects_done: u32,
    pub subjects_total: u32,
    pub files_done: f64,
    pub files_total: f64,
    pub current: Option<String>,
    pub subject: Option<String>,
    pub runs: Vec<BidsRunRecord>,
    pub findings: Vec<BidsFinding>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BidsRunDetail {
    pub run_id: String,
    /// One entry per volume; `null` where the confounds file says `n/a`.
    pub fd_trace: Vec<Option<f32>>,
    pub fd_source: Option<String>,
    pub fd_definition: Option<String>,
    pub fd_filtered: bool,
    /// Ascending 0-based volumes flagged by the same confounds file.
    pub non_steady_volumes: Vec<u32>,
    pub event_checks: Vec<BidsCheck>,
    pub events_duration: Option<f32>,
    pub derivative_checks: Vec<BidsCheck>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BidsSliceRequest {
    pub path: String,
    /// `mean`, `first`, `tsnr` or `anat`.
    pub kind: String,
    pub world_z_mm: Option<f32>,
    pub max_px: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BidsSliceImage {
    pub png_base64: String,
    pub width: u32,
    pub height: u32,
    /// World z of the slice actually drawn; `None` for a carpet.
    pub world_z_mm: Option<f32>,
    /// Data values at black and white (2nd and 98th percentile of nonzero voxels).
    pub window_low: f32,
    pub window_high: f32,
    /// Volumes averaged into the image.
    pub volumes_used: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BidsMedianSliceImage {
    pub image: BidsSliceImage,
    pub runs_used: u32,
    /// Runs left out: different grid from the modal one, or unreadable.
    pub runs_skipped: u32,
}
