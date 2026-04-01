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
