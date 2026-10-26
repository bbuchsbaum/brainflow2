//! Statistic metadata (NIfTI intent and description) attached to volume handles.
//!
//! The in-memory volume does not retain the header intent, so it is re-read
//! from the source file (header only), like the xform codes and TR.
use bridge_types::StatisticInfo;
use std::path::{Path, PathBuf};

/// What the NIfTI header says about a volume's values, from one header read.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct VolumeIntent {
    /// Declared statistic; `None` when unreadable (in-memory volumes, moved
    /// files) or not a statistic (label maps, time series, other data).
    pub statistic: Option<StatisticInfo>,
    /// `Some(true)` for a declared label map (`intent_code` 1002).
    pub is_label_map: Option<bool>,
}

/// Read the header at `path` once (blocking I/O).
pub(crate) fn volume_intent(path: &Path) -> VolumeIntent {
    let Some(meta) = nifti_loader::read_statistic_metadata(path) else {
        return VolumeIntent::default();
    };
    let is_label_map = meta.statistic.is_label_map().then_some(true);
    VolumeIntent {
        statistic: Some(meta.statistic).filter(StatisticInfo::is_statistic),
        is_label_map,
    }
}

/// [`volume_intent`] on a blocking worker, so header I/O (open, gunzip) never
/// runs on the async runtime. Call it without holding registry locks.
pub(crate) async fn read_volume_intent(path: PathBuf) -> VolumeIntent {
    tokio::task::spawn_blocking(move || volume_intent(&path))
        .await
        .unwrap_or_default()
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
        let stat = volume_intent(&path).statistic.expect("t statistic");
        std::fs::remove_file(&path).ok();
        assert_eq!(stat.kind, StatisticKind::T);
        assert_eq!(stat.label, "t(24)");
    }

    #[test]
    fn reads_spm_description_when_intent_unset() {
        let path = write_nifti(0, 0.0, "SPM{T_[11.0]} - contrast 1");
        let stat = volume_intent(&path)
            .statistic
            .expect("SPM description statistic");
        std::fs::remove_file(&path).ok();
        assert_eq!(stat.label, "t(11)");
        assert!(stat.from_description);
    }

    #[test]
    fn non_statistical_or_missing_files_have_no_statistic() {
        let path = write_nifti(0, 0.0, "T1w");
        assert!(volume_intent(&path).statistic.is_none());
        std::fs::remove_file(&path).ok();
        assert!(volume_intent(Path::new("<memory>")).statistic.is_none());
        assert!(volume_intent(Path::new("<memory>")).is_label_map.is_none());
    }

    #[test]
    fn label_maps_and_time_series_are_not_statistics() {
        let label = write_nifti(1002, 0.0, "");
        assert!(volume_intent(&label).statistic.is_none());
        assert_eq!(volume_intent(&label).is_label_map, Some(true));
        std::fs::remove_file(&label).ok();

        let series = write_nifti(2001, 0.0, "");
        assert!(volume_intent(&series).statistic.is_none());
        assert_eq!(volume_intent(&series).is_label_map, None);
        std::fs::remove_file(&series).ok();

        let z = write_nifti(5, 0.0, "");
        assert_eq!(volume_intent(&z).is_label_map, None);
        std::fs::remove_file(&z).ok();
    }

    #[tokio::test]
    async fn async_read_matches_blocking_read() {
        let path = write_nifti(4, 2.0, "");
        let intent = read_volume_intent(path.clone()).await;
        assert_eq!(intent, volume_intent(&path));
        std::fs::remove_file(&path).ok();
        assert_eq!(intent.statistic.map(|s| s.label).as_deref(), Some("F"));
        assert_eq!(
            read_volume_intent(PathBuf::from("<memory>")).await,
            VolumeIntent::default()
        );
    }
}
