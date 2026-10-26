//! Statistic metadata (NIfTI intent and description) attached to volume handles.
//!
//! The in-memory volume does not retain the header intent, so it is re-read
//! from the source file (header only), like the xform codes and TR.
use bridge_types::StatisticInfo;
use std::path::Path;

/// Statistic declared by the NIfTI header at `path`, or `None` when the file is
/// unreadable (in-memory volumes, moved files) or declares no statistic.
pub(crate) fn statistic_for_path(path: &Path) -> Option<StatisticInfo> {
    nifti_loader::read_statistic_metadata(path)
        .map(|meta| meta.statistic)
        .filter(StatisticInfo::is_statistic)
}

#[cfg(test)]
mod tests {
    use super::*;
    use bridge_types::StatisticKind;

    fn write_nifti(intent_code: i16, p1: f32, descrip: &str) -> std::path::PathBuf {
        let path =
            std::env::temp_dir().join(format!("brainflow-stat-{}.nii", uuid::Uuid::new_v4()));
        let mut descrip_bytes = descrip.as_bytes().to_vec();
        descrip_bytes.resize(80, 0);
        let header = nifti::NiftiHeader {
            intent_code,
            intent_p1: p1,
            descrip: descrip_bytes,
            ..Default::default()
        };
        let data = ndarray::Array3::<f32>::zeros((2, 2, 2));
        nifti::writer::WriterOptions::new(&path)
            .reference_header(&header)
            .write_nifti(&data)
            .expect("write synthetic nifti");
        path
    }

    #[test]
    fn reads_t_intent_from_written_file() {
        let path = write_nifti(3, 24.0, "");
        let stat = statistic_for_path(&path).expect("t statistic");
        std::fs::remove_file(&path).ok();
        assert_eq!(stat.kind, StatisticKind::T);
        assert_eq!(stat.label, "t(24)");
    }

    #[test]
    fn reads_spm_description_when_intent_unset() {
        let path = write_nifti(0, 0.0, "SPM{T_[11.0]} - contrast 1");
        let stat = statistic_for_path(&path).expect("SPM description statistic");
        std::fs::remove_file(&path).ok();
        assert_eq!(stat.label, "t(11)");
        assert!(stat.from_description);
    }

    #[test]
    fn non_statistical_or_missing_files_have_no_statistic() {
        let path = write_nifti(0, 0.0, "T1w");
        assert!(statistic_for_path(&path).is_none());
        std::fs::remove_file(&path).ok();
        assert!(statistic_for_path(Path::new("<memory>")).is_none());
    }
}
