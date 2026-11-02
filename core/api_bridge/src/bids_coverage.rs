//! Pure coverage aggregation for the BIDS browser.
//!
//! Columns are one per (session, modality, suffix, task, run), so each run is
//! its own column. Cells aggregate the files that match a subject and column;
//! `run_count` is the number of matching files. Kept free of I/O so it can be
//! unit-tested directly.

use bridge_types::bids::{BidsCoverageCell, BidsCoverageColumn, BidsCoverageMatrix};
use std::collections::{BTreeSet, HashMap};

/// One indexed file, with its size already read from disk.
#[derive(Debug, Clone)]
pub struct CoverageFile {
    pub subject: String,
    pub session: Option<String>,
    pub modality: String,
    pub suffix: String,
    pub task: Option<String>,
    pub run: Option<String>,
    pub path: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
struct ColumnKey {
    session: Option<String>,
    modality: String,
    suffix: String,
    task: Option<String>,
    run: Option<String>,
}

impl ColumnKey {
    fn of(f: &CoverageFile) -> Self {
        Self {
            session: f.session.clone(),
            modality: f.modality.clone(),
            suffix: f.suffix.clone(),
            task: f.task.clone(),
            run: f.run.clone(),
        }
    }

    fn label(&self) -> String {
        let mut parts = Vec::new();
        if let Some(s) = &self.session {
            parts.push(format!("ses-{}", s));
        }
        parts.push(self.suffix.clone());
        if let Some(t) = &self.task {
            parts.push(format!("task-{}", t));
        }
        if let Some(r) = &self.run {
            parts.push(format!("run-{}", r));
        }
        parts.join("_")
    }
}

/// Build the subject-by-run coverage matrix.
///
/// Files whose subject is not in `subjects` are ignored. Columns are sorted by
/// label, which keeps `run-1` before `run-2` within a series.
pub fn build_coverage_matrix(subjects: &[String], files: &[CoverageFile]) -> BidsCoverageMatrix {
    let mut columns_set: BTreeSet<ColumnKey> = BTreeSet::new();
    // (subject, column) -> matching files
    let mut grouped: HashMap<(&str, ColumnKey), Vec<&CoverageFile>> = HashMap::new();
    let subject_set: BTreeSet<&str> = subjects.iter().map(|s| s.as_str()).collect();

    for f in files {
        if !subject_set.contains(f.subject.as_str()) {
            continue;
        }
        let key = ColumnKey::of(f);
        columns_set.insert(key.clone());
        grouped
            .entry((f.subject.as_str(), key))
            .or_default()
            .push(f);
    }

    let mut keys: Vec<ColumnKey> = columns_set.into_iter().collect();
    keys.sort_by(|a, b| a.label().cmp(&b.label()).then_with(|| a.cmp(b)));

    let columns: Vec<BidsCoverageColumn> = keys
        .iter()
        .map(|k| BidsCoverageColumn {
            session: k.session.clone(),
            modality: k.modality.clone(),
            suffix: k.suffix.clone(),
            task: k.task.clone(),
            run: k.run.clone(),
            label: k.label(),
        })
        .collect();

    let cells: Vec<Vec<BidsCoverageCell>> = subjects
        .iter()
        .map(|sub| {
            keys.iter()
                .map(|k| {
                    let matching = grouped
                        .get(&(sub.as_str(), k.clone()))
                        .map(Vec::as_slice)
                        .unwrap_or(&[]);
                    let run_count = matching.len();
                    BidsCoverageCell {
                        present: run_count > 0,
                        run_count,
                        size_bytes: matching.iter().map(|f| f.size_bytes).sum(),
                        file_paths: matching.iter().map(|f| f.path.clone()).collect(),
                    }
                })
                .collect()
        })
        .collect();

    BidsCoverageMatrix {
        subjects: subjects.to_vec(),
        columns,
        cells,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(
        sub: &str,
        ses: Option<&str>,
        suffix: &str,
        task: Option<&str>,
        run: Option<&str>,
        size: u64,
    ) -> CoverageFile {
        CoverageFile {
            subject: sub.to_string(),
            session: ses.map(str::to_string),
            modality: if suffix == "bold" { "func" } else { "anat" }.to_string(),
            suffix: suffix.to_string(),
            task: task.map(str::to_string),
            run: run.map(str::to_string),
            path: format!("/d/sub-{sub}/{suffix}-{run:?}"),
            size_bytes: size,
        }
    }

    #[test]
    fn each_run_is_its_own_column() {
        let subjects = vec!["01".to_string(), "02".to_string()];
        let files = vec![
            file("01", Some("01"), "bold", Some("nback"), Some("1"), 10),
            file("01", Some("01"), "bold", Some("nback"), Some("2"), 20),
            file("02", Some("01"), "bold", Some("nback"), Some("1"), 30),
        ];
        let m = build_coverage_matrix(&subjects, &files);
        let labels: Vec<&str> = m.columns.iter().map(|c| c.label.as_str()).collect();
        assert_eq!(
            labels,
            vec![
                "ses-01_bold_task-nback_run-1",
                "ses-01_bold_task-nback_run-2"
            ]
        );
        assert_eq!(m.columns[0].run.as_deref(), Some("1"));
        // sub 01 has run-1 and run-2; sub 02 only run-1
        assert_eq!(m.cells[0][0].run_count, 1);
        assert_eq!(m.cells[0][1].run_count, 1);
        assert_eq!(m.cells[1][0].run_count, 1);
        assert!(!m.cells[1][1].present);
        assert_eq!(m.cells[1][1].run_count, 0);
        assert_eq!(m.cells[0][1].size_bytes, 20);
    }

    #[test]
    fn repeated_files_in_one_run_column_aggregate() {
        let subjects = vec!["01".to_string()];
        let files = vec![
            file("01", None, "T1w", None, None, 5),
            file("01", None, "T1w", None, None, 7),
        ];
        let m = build_coverage_matrix(&subjects, &files);
        assert_eq!(m.columns.len(), 1);
        assert_eq!(m.cells[0][0].run_count, 2);
        assert_eq!(m.cells[0][0].size_bytes, 12);
        assert_eq!(m.cells[0][0].file_paths.len(), 2);
    }

    #[test]
    fn files_for_unknown_subjects_are_ignored() {
        let subjects = vec!["01".to_string()];
        let files = vec![file("99", None, "T1w", None, None, 1)];
        let m = build_coverage_matrix(&subjects, &files);
        assert!(m.columns.is_empty());
        assert!(m.cells[0].is_empty());
    }
}
