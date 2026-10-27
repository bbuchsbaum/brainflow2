//! Cluster-id label volumes emitted by `compute_clusters` (`emitLabelVolume`).
//!
//! The label volume is a hidden registry volume on the analysed grid: voxel
//! value = cluster `id` (1-based table rank), 0 elsewhere. It carries a
//! "Cluster 1…N" parcel dictionary, so it works wherever a catalogue atlas
//! does (region loci, ROI statistics, parcel tables).
//!
//! Storage is f32, like every scalar the registry and label paths read
//! (`read_member_frame_at_voxel` returns f32; GPU uploads promote integers);
//! ids are at most `MAX_CLUSTERS_LIMIT` (5000), far inside f32's exact
//! integer range.
//!
//! Ownership: the clusters module owns the latest label volume per source
//! volume. It is replaced by the next emission for that source and released
//! when the source volume is unloaded. If a layer displays the label volume
//! at that moment, ownership passes to the layer: it is no longer tracked
//! here and is released by the normal layer unload path
//! (`release_layer_gpu_resources` removes the mapping, then `unload_volume`).
use crate::clusters::{cancelled, Generation};
use crate::{BridgeState, VolumeRegistry};
use bridge_types::{BridgeError, BridgeResult, VolumeSendable};
use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};

/// Latest emitted label volume per source volume id (process-wide; volume
/// ids are unique).
fn emitted() -> &'static Mutex<HashMap<String, String>> {
    static EMITTED: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    EMITTED.get_or_init(Default::default)
}

fn emitted_map() -> std::sync::MutexGuard<'static, HashMap<String, String>> {
    emitted()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// The label volume currently owned for `source_id`.
#[cfg(test)]
pub(crate) fn owned_label_volume(source_id: &str) -> Option<String> {
    emitted_map().get(source_id).cloned()
}

/// A 3D f32 volume on the analysed grid holding `image`. Both the affine slot
/// and the NeuroSpace transform carry the full source affine, so oblique
/// grids are represented exactly.
pub(crate) fn label_volume_from_image(
    image: Vec<f32>,
    dims: [usize; 3],
    affine: nalgebra::Affine3<f32>,
) -> BridgeResult<VolumeSendable> {
    use volmath::{DenseVolume3, NeuroSpace};
    let m = affine.matrix();
    let trans = nalgebra::DMatrix::<f64>::from_fn(4, 4, |r, c| f64::from(m[(r, c)]));
    let space = NeuroSpace::new(dims.to_vec(), None, None, None, Some(trans)).map_err(|error| {
        BridgeError::Internal {
            code: 5074,
            details: format!("Cluster label volume space: {error}"),
        }
    })?;
    Ok(VolumeSendable::VolF32(
        DenseVolume3::<f32>::from_data(space, image),
        affine,
    ))
}

/// "Cluster 1…N" dictionary for a label volume with `clusters` ids.
pub(crate) fn cluster_dictionary(
    name: &str,
    clusters: u32,
) -> atlases::parcel_dictionary::ParcelDictionary {
    atlases::parcel_dictionary::ParcelDictionary {
        name: name.to_string(),
        labels: (1..=clusters)
            .map(|id| neuroatlas::Label::new(id, format!("Cluster {id}")))
            .collect(),
        full_labels: None,
    }
}

/// Register `volume` (with `clusters` ids) as the label volume of
/// `source_id`. Supersession is re-checked under the registry lock, so a stale
/// computation finishing late cannot replace a newer emission. The previous
/// label volume for the source is unloaded, or handed to the layer that
/// displays it.
pub(crate) async fn register(
    state: &BridgeState,
    source_id: &str,
    volume: VolumeSendable,
    clusters: u32,
    generation: &Generation,
) -> BridgeResult<String> {
    let label_id = format!("clusters_{}", uuid::Uuid::new_v4());
    let metadata = crate::VolumeMetadataInfo {
        name: format!("{source_id} clusters"),
        path: "<memory>".into(),
        dtype: "f32".into(),
        volume_type: bridge_types::VolumeType::Volume3D,
        time_series_info: None,
    };
    // Same lock order as the unload path: layer mappings, then the registry.
    let displayed: HashSet<String> = state
        .layer_to_volume_map
        .lock()
        .await
        .values()
        .cloned()
        .collect();
    let mut registry = state.volume_registry.lock().await;
    if generation.is_superseded() {
        return Err(cancelled());
    }
    let previous = emitted_map().insert(source_id.to_string(), label_id.clone());
    if let Some(previous) = previous.filter(|previous| !displayed.contains(previous)) {
        registry.remove(&previous);
    }
    registry.insert(label_id.clone(), volume, metadata);
    registry.parcel_dictionaries.insert(
        label_id.clone(),
        cluster_dictionary(&format!("{source_id} clusters"), clusters),
    );
    Ok(label_id)
}

/// Unload hook (called with the registry lock held, after `volume_id` was
/// removed): release the label volume owned for a removed source unless a
/// layer displays it, and forget a removed label volume.
pub(crate) fn on_volume_removed(
    registry: &mut VolumeRegistry,
    volume_id: &str,
    displayed: &HashSet<String>,
) {
    let mut map = emitted_map();
    if let Some(label_id) = map.remove(volume_id) {
        if !displayed.contains(&label_id) {
            registry.remove(&label_id);
        }
    }
    map.retain(|_, label_id| label_id != volume_id);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oblique_affine_is_kept_in_the_space_record() {
        // 30 degree rotation about z, 2 mm voxels, shifted origin.
        let (s, c) = (30f32.to_radians().sin(), 30f32.to_radians().cos());
        let affine = nalgebra::Affine3::from_matrix_unchecked(nalgebra::Matrix4::new(
            2.0 * c,
            -2.0 * s,
            0.0,
            -10.0,
            2.0 * s,
            2.0 * c,
            0.0,
            5.0,
            0.0,
            0.0,
            2.0,
            -3.0,
            0.0,
            0.0,
            0.0,
            1.0,
        ));
        let volume = label_volume_from_image(vec![0.0; 24], [2, 3, 4], affine).unwrap();
        let VolumeSendable::VolF32(dense, slot) = &volume else {
            panic!("f32 label volume expected")
        };
        assert_eq!(*slot, affine);
        let trans = &dense.space().trans;
        for r in 0..4 {
            for c in 0..4 {
                assert!(
                    (trans[(r, c)] - f64::from(affine.matrix()[(r, c)])).abs() < 1e-6,
                    "trans[{r},{c}]"
                );
            }
        }
        assert_eq!(crate::get_affine_from_volume(&volume).unwrap(), affine);
    }

    #[test]
    fn dictionary_names_each_cluster() {
        let dictionary = cluster_dictionary("stat clusters", 3);
        let names: Vec<_> = dictionary
            .labels
            .iter()
            .map(|l| (l.id, l.name.as_str()))
            .collect();
        assert_eq!(
            names,
            vec![(1, "Cluster 1"), (2, "Cluster 2"), (3, "Cluster 3")]
        );
    }

    use crate::clusters::{compute_clusters_impl, ComputeClustersRequest, Generation};
    use crate::volume_queries::test_support::volume_3d;

    /// Two positive 2x2x2 blobs on an 8^3, 2 mm grid.
    fn stat_volume() -> VolumeSendable {
        let mut values = vec![0.0f32; 512];
        let at = |i: usize, j: usize, k: usize| i + 8 * (j + 8 * k);
        for k in 1..=2 {
            for j in 1..=2 {
                for i in 1..=2 {
                    values[at(i, j, k)] = 5.0;
                    values[at(i + 4, j + 4, k + 4)] = 4.0;
                }
            }
        }
        volume_3d([8, 8, 8], [2.0; 3], [0.0; 3], values)
    }

    async fn setup(source: &str) -> BridgeState {
        let state = BridgeState::default().unwrap();
        state.volume_registry.lock().await.insert(
            source.into(),
            stat_volume(),
            crate::VolumeMetadataInfo {
                name: source.into(),
                path: "<memory>".into(),
                dtype: "f32".into(),
                volume_type: bridge_types::VolumeType::Volume3D,
                time_series_info: None,
            },
        );
        state
    }

    async fn emit(state: &BridgeState, source: &str) -> String {
        let request: ComputeClustersRequest = serde_json::from_str(&format!(
            r#"{{"volumeId":"{source}","threshold":1.0,"emitLabelVolume":true}}"#
        ))
        .unwrap();
        compute_clusters_impl(request, state)
            .await
            .unwrap()
            .label_volume_id
            .expect("label volume id")
    }

    async fn unload(state: &BridgeState, id: &str) -> BridgeResult<()> {
        volume_service::VolumeLoadingService::unload(
            &crate::volume_loading::DesktopVolumeRepository(state),
            id,
        )
        .await
    }

    #[tokio::test]
    async fn emission_registers_dictionary_and_replaces_previous() {
        let source = format!("src-{}", uuid::Uuid::new_v4());
        let state = setup(&source).await;
        let first = emit(&state, &source).await;
        {
            let registry = state.volume_registry.lock().await;
            assert!(registry.contains(&first));
            let dictionary = registry
                .parcel_dictionaries
                .get(&first)
                .expect("dictionary");
            let names: Vec<_> = dictionary.labels.iter().map(|l| l.name.clone()).collect();
            assert_eq!(names, vec!["Cluster 1", "Cluster 2"]);
        }
        let second = emit(&state, &source).await;
        let registry = state.volume_registry.lock().await;
        assert!(
            !registry.contains(&first),
            "undisplayed previous is unloaded"
        );
        assert!(!registry.parcel_dictionaries.contains_key(&first));
        assert!(registry.contains(&second));
        assert_eq!(owned_label_volume(&source), Some(second));
    }

    #[tokio::test]
    async fn displayed_previous_passes_to_its_layer_and_unloads_normally() {
        let source = format!("src-{}", uuid::Uuid::new_v4());
        let state = setup(&source).await;
        let first = emit(&state, &source).await;
        state
            .layer_to_volume_map
            .lock()
            .await
            .insert("cluster-layer".into(), first.clone());
        let second = emit(&state, &source).await;
        assert!(
            state.volume_registry.lock().await.contains(&first),
            "kept while displayed"
        );
        assert_eq!(owned_label_volume(&source), Some(second.clone()));
        // Unloading the source releases only the owned (undisplayed) volume.
        unload(&state, &source).await.unwrap();
        assert_eq!(owned_label_volume(&source), None);
        {
            let registry = state.volume_registry.lock().await;
            assert!(!registry.contains(&second));
            assert!(registry.contains(&first));
        }
        // The layer's normal unload path: release the mapping, unload the volume.
        assert!(
            unload(&state, &first).await.is_err(),
            "refused while mapped"
        );
        state
            .layer_to_volume_map
            .lock()
            .await
            .remove("cluster-layer");
        unload(&state, &first).await.unwrap();
        assert!(!state.volume_registry.lock().await.contains(&first));
    }

    #[tokio::test]
    async fn source_unload_releases_owned_label_volume() {
        let source = format!("src-{}", uuid::Uuid::new_v4());
        let state = setup(&source).await;
        let label = emit(&state, &source).await;
        unload(&state, &source).await.unwrap();
        assert!(!state.volume_registry.lock().await.contains(&label));
        assert_eq!(owned_label_volume(&source), None);
        // Unloading a label volume directly forgets it.
        let source2 = format!("src-{}", uuid::Uuid::new_v4());
        state.volume_registry.lock().await.insert(
            source2.clone(),
            stat_volume(),
            crate::VolumeMetadataInfo {
                name: "s2".into(),
                path: "<memory>".into(),
                dtype: "f32".into(),
                volume_type: bridge_types::VolumeType::Volume3D,
                time_series_info: None,
            },
        );
        let label2 = emit(&state, &source2).await;
        unload(&state, &label2).await.unwrap();
        assert_eq!(owned_label_volume(&source2), None);
    }

    #[tokio::test]
    async fn stale_emission_is_rejected_under_the_registry_lock() {
        let source = format!("src-{}", uuid::Uuid::new_v4());
        let state = setup(&source).await;
        let current = emit(&state, &source).await;
        // A computation that started earlier and finishes now.
        let stale = Generation::begin(&source);
        let _newer = Generation::begin(&source);
        let volume = label_volume_from_image(
            vec![0.0; 512],
            [8, 8, 8],
            crate::get_affine_from_volume(&stat_volume()).unwrap(),
        )
        .unwrap();
        match register(&state, &source, volume, 1, &stale).await {
            Err(BridgeError::Input { code, .. }) => {
                assert_eq!(code, crate::clusters::CANCELLED_CODE)
            }
            other => panic!("expected cancellation, got {other:?}"),
        }
        assert_eq!(owned_label_volume(&source), Some(current.clone()));
        assert!(state.volume_registry.lock().await.contains(&current));
    }
}
