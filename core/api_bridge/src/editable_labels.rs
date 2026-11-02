//! Core publication of editable categorical volumes. Module adapters call this
//! without core importing any editor's session or policy. Arc copy-on-write
//! preserves snapshots held by concurrent scientific readers.
use crate::{VolumeMetadataInfo, VolumeRegistry};
use bridge_types::{BridgeError, BridgeResult, VolumeSendable};
use render_loop::LabelRegionUpdate;
use std::sync::Arc;

fn invalid(details: &str) -> BridgeError {
    BridgeError::Input {
        code: 4080,
        details: details.into(),
    }
}
impl VolumeRegistry {
    pub(crate) fn insert_editable_labels(
        &mut self,
        id: String,
        data: VolumeSendable,
        metadata: VolumeMetadataInfo,
        revision: u64,
    ) -> BridgeResult<()> {
        if self.volumes.contains_key(&id) {
            return Err(invalid("Editable volume id is already registered"));
        }
        if !matches!(data, VolumeSendable::VolU16(_, _)) {
            return Err(invalid("Editable label volumes require u16 CPU storage"));
        }
        self.insert(id.clone(), data, metadata);
        let entry = self.volumes.get_mut(&id).expect("inserted volume");
        entry.editable_revision = Some(revision);
        entry.retained_by_document = true;
        Ok(())
    }

    pub(crate) fn update_editable_labels(
        &mut self,
        id: &str,
        update: &LabelRegionUpdate<'_>,
    ) -> BridgeResult<()> {
        let entry = self
            .volumes
            .get_mut(id)
            .ok_or_else(|| invalid("Editable volume was removed"))?;
        if entry.editable_revision != Some(update.expected_revision) {
            return Err(invalid("Editable CPU volume revision conflict"));
        }
        let VolumeSendable::VolU16(volume, _) = entry.data.as_ref() else {
            return Err(invalid("Volume is not editable u16 labels"));
        };
        let dims = volume.space().dim.as_slice();
        let full = update.origin == [0; 3]
            && update
                .dimensions
                .iter()
                .zip(dims)
                .all(|(&a, &b)| a as usize == b);
        if update.revision <= update.expected_revision
            || (!full && update.expected_revision.checked_add(1) != Some(update.revision))
        {
            return Err(invalid("Editable CPU update skips or repeats a revision"));
        }
        if update.data_range.0 > update.data_range.1
            || update
                .labels
                .iter()
                .any(|&v| v < update.data_range.0 || v > update.data_range.1)
        {
            return Err(invalid("Editable label range does not contain the update"));
        }
        // Validate shape before Arc::make_mut: a rejected update does not even
        // duplicate a reader's immutable snapshot.
        let count = update
            .dimensions
            .iter()
            .try_fold(1usize, |count, &size| count.checked_mul(size as usize))
            .ok_or_else(|| invalid("Editable region overflows"))?;
        if count != update.labels.len()
            || update.dimensions.contains(&0)
            || (0..3).any(|a| {
                update.origin[a]
                    .checked_add(update.dimensions[a])
                    .is_none_or(|end| end as usize > dims[a])
            })
        {
            return Err(invalid("Editable label region is outside the volume"));
        }
        let VolumeSendable::VolU16(volume, _) = Arc::make_mut(&mut entry.data) else {
            unreachable!("validated label volume")
        };
        let mut index = 0;
        for z in update.origin[2]..update.origin[2] + update.dimensions[2] {
            for y in update.origin[1]..update.origin[1] + update.dimensions[1] {
                for x in update.origin[0]..update.origin[0] + update.dimensions[0] {
                    volume
                        .set_at([x as usize, y as usize, z as usize], update.labels[index])
                        .map_err(|e| invalid(&e.to_string()))?;
                    index += 1;
                }
            }
        }
        entry.editable_revision = Some(update.revision);
        Ok(())
    }
}

/// The caller holds volume_operations while admitting and applying the document
/// edit. CPU publication is authoritative. A GPU failure is returned separately
/// so an accepted edit is retained and the UI can stop painting until resync.
pub(crate) async fn publish_locked(
    state: &crate::BridgeState,
    _operation: &tokio::sync::MutexGuard<'_, ()>,
    volume_id: &str,
    update: &LabelRegionUpdate<'_>,
) -> BridgeResult<Option<String>> {
    state
        .volume_registry
        .lock()
        .await
        .update_editable_labels(volume_id, update)?;
    synchronize_locked(state, _operation, volume_id, Some(update)).await
}

/// Bring every resident editable display up to the authoritative CPU revision.
/// Reconciliation runs on resume too, so a previous failed GPU update can never
/// be cleared merely by reading the document. Missing leases remain an error.
pub(crate) async fn synchronize_locked(
    state: &crate::BridgeState,
    _operation: &tokio::sync::MutexGuard<'_, ()>,
    volume_id: &str,
    incremental: Option<&LabelRegionUpdate<'_>>,
) -> BridgeResult<Option<String>> {
    let layer_ids: Vec<_> = state
        .layer_to_volume_map
        .lock()
        .await
        .iter()
        .filter(|(_, source)| source.as_str() == volume_id)
        .map(|(id, _)| id.clone())
        .collect();
    let slots: std::collections::HashSet<_> = {
        let map = state.layer_to_atlas_map.lock().await;
        layer_ids
            .iter()
            .filter_map(|id| map.get(id).copied())
            .filter(|&id| id != u32::MAX)
            .collect()
    };
    let renderer = state.render_loop_service.lock().await.clone();
    let mut renderer = match renderer.as_ref() {
        Some(renderer) => Some(renderer.lock().await),
        None => None,
    };
    let registry = state.volume_registry.lock().await;
    let entry = registry
        .get_entry(volume_id)
        .ok_or_else(|| invalid("Editable volume was removed"))?;
    let revision = entry
        .editable_revision
        .ok_or_else(|| invalid("Volume is not editable"))?;
    let VolumeSendable::VolU16(current, _) = entry.data.as_ref() else {
        return Err(invalid("Volume is not editable u16 labels"));
    };
    let Some(renderer) = renderer.as_mut() else {
        return Ok(None);
    };
    let mut errors = Vec::new();
    for index in slots {
        let Some(handle) = renderer
            .multi_texture_manager
            .as_ref()
            .and_then(|manager| manager.editable_handle(index))
        else {
            errors.push(format!(
                "Editable texture slot {index} is no longer resident"
            ));
            continue;
        };
        let uploaded = renderer
            .multi_texture_manager
            .as_ref()
            .expect("resident manager")
            .editable_revision(handle)
            .map_err(|e| invalid(&e.to_string()))?;
        if uploaded == revision {
            continue;
        }
        let result = if let Some(update) =
            incremental.filter(|update| uploaded == update.expected_revision)
        {
            renderer.update_volume_region(handle, update)
        } else {
            let values = current.values_contiguous();
            let dimensions = current.space().dim.as_slice();
            let data_range = values.iter().fold((u16::MAX, u16::MIN), |(low, high), &v| {
                (low.min(v), high.max(v))
            });
            renderer.update_volume_region(
                handle,
                &LabelRegionUpdate {
                    expected_revision: uploaded,
                    revision,
                    origin: [0; 3],
                    dimensions: [
                        dimensions[0] as u32,
                        dimensions[1] as u32,
                        dimensions[2] as u32,
                    ],
                    labels: &values,
                    data_range,
                },
            )
        };
        if let Err(error) = result {
            errors.push(error.to_string());
        }
    }
    Ok((!errors.is_empty()).then(|| errors.join("; ")))
}

/// Called by core workspace disposal under volume_operations. A normal display
/// layer inherits a published snapshot; unreferenced documents are fully freed.
pub(crate) async fn release_documents_locked(state: &crate::BridgeState, volume_ids: &[String]) {
    let displayed: std::collections::HashSet<_> = state
        .layer_to_volume_map
        .lock()
        .await
        .values()
        .cloned()
        .collect();
    let renderer = state.render_loop_service.lock().await.clone();
    let mut renderer = match renderer.as_ref() {
        Some(renderer) => Some(renderer.lock().await),
        None => None,
    };
    let mut samplers = state.surface_samplers.lock().await;
    let mut registry = state.volume_registry.lock().await;
    for id in volume_ids {
        let Some(entry) = registry.volumes.get_mut(id) else {
            continue;
        };
        entry.retained_by_document = false;
        if !displayed.contains(id) {
            crate::volume_loading::release_volume(
                renderer.as_deref_mut(),
                &mut samplers,
                &mut registry,
                id,
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nalgebra::Affine3;
    use volmath::{DenseVolume3, NeuroSpace, NeuroSpaceExt};
    fn volume() -> VolumeSendable {
        VolumeSendable::VolU16(
            DenseVolume3::from_data(
                NeuroSpace::from_dims_spacing_origin(vec![3, 2, 2], vec![1.0; 3], vec![0.0; 3])
                    .unwrap(),
                vec![0; 12],
            ),
            Affine3::identity(),
        )
    }
    fn metadata() -> VolumeMetadataInfo {
        VolumeMetadataInfo {
            name: "Synthetic labels".into(),
            path: "memory:labels".into(),
            dtype: "u16".into(),
            volume_type: bridge_types::VolumeType::Volume3D,
            time_series_info: None,
        }
    }
    fn values(data: &VolumeSendable) -> Vec<u16> {
        let VolumeSendable::VolU16(v, _) = data else {
            panic!("u16 labels expected")
        };
        v.values()
    }
    #[test]
    fn editable_region_keeps_old_reader_snapshots_and_current_x_fastest_values() {
        let mut registry = VolumeRegistry::new();
        registry
            .insert_editable_labels("labels".into(), volume(), metadata(), 0)
            .unwrap();
        let reader = registry.get_arc("labels").unwrap();
        let update = LabelRegionUpdate {
            expected_revision: 0,
            revision: 1,
            origin: [1, 0, 1],
            dimensions: [2, 2, 1],
            labels: &[7, 8, 301, 65535],
            data_range: (0, 65535),
        };
        registry.update_editable_labels("labels", &update).unwrap();
        assert_eq!(values(&reader), [0; 12]);
        assert_eq!(
            values(registry.get("labels").unwrap()),
            [0, 0, 0, 0, 0, 0, 0, 7, 8, 0, 301, 65535]
        );
        assert_eq!(
            registry.get_entry("labels").unwrap().editable_revision,
            Some(1)
        );
        assert!(registry.update_editable_labels("labels", &update).is_err());
    }
    #[test]
    fn bad_region_and_immutable_images_are_refused_without_publication() {
        let mut registry = VolumeRegistry::new();
        registry
            .insert_editable_labels("labels".into(), volume(), metadata(), 0)
            .unwrap();
        let update = LabelRegionUpdate {
            expected_revision: 0,
            revision: 1,
            origin: [2, 0, 0],
            dimensions: [2, 1, 1],
            labels: &[1, 2],
            data_range: (0, 2),
        };
        assert!(registry.update_editable_labels("labels", &update).is_err());
        assert_eq!(values(registry.get("labels").unwrap()), [0; 12]);
        assert_eq!(
            registry.get_entry("labels").unwrap().editable_revision,
            Some(0)
        );
        assert!(registry
            .insert_editable_labels("labels".into(), volume(), metadata(), 0)
            .is_err());
        registry.insert("image".into(), volume(), metadata());
        assert!(registry.update_editable_labels("image", &update).is_err());
    }
    #[tokio::test]
    async fn normal_layer_upload_and_dirty_publication_share_the_document_revision() {
        use crate::{request_layer_gpu_resources_for_testing, LayerSpec, VolumeLayerSpec};
        let state = crate::BridgeState::default().unwrap();
        state
            .ensure_render_loop()
            .await
            .expect("GPU required for editable publication acceptance");
        state
            .volume_registry
            .lock()
            .await
            .insert_editable_labels("labels".into(), volume(), metadata(), 0)
            .unwrap();
        let info = request_layer_gpu_resources_for_testing(
            LayerSpec::Volume(VolumeLayerSpec {
                id: "label-layer".into(),
                source_resource_id: "labels".into(),
                colormap: "gray".into(),
                slice_axis: None,
                slice_index: None,
            }),
            None,
            &state,
        )
        .await
        .unwrap();
        assert!(matches!(info.tex_format, crate::GpuTextureFormat::R32Float));
        let operation = state.volume_operations.lock().await;
        let update = LabelRegionUpdate {
            expected_revision: 0,
            revision: 1,
            origin: [1, 0, 1],
            dimensions: [2, 2, 1],
            labels: &[7, 8, 301, 65535],
            data_range: (0, 65535),
        };
        assert!(publish_locked(&state, &operation, "labels", &update)
            .await
            .unwrap()
            .is_none());
        let renderer = state.render_loop_service.lock().await.clone().unwrap();
        let renderer = renderer.lock().await;
        let handle = renderer
            .editable_volume_handle("labels")
            .expect("normal layer owns editable residency");
        assert_eq!(
            renderer
                .multi_texture_manager
                .as_ref()
                .unwrap()
                .editable_revision(handle)
                .unwrap(),
            1
        );
        assert_eq!(
            values(state.volume_registry.lock().await.get("labels").unwrap()),
            [0, 0, 0, 0, 0, 0, 0, 7, 8, 0, 301, 65535]
        );
        drop(renderer);
        // Simulate accepted CPU publication whose repaint was interrupted.
        state
            .volume_registry
            .lock()
            .await
            .update_editable_labels(
                "labels",
                &LabelRegionUpdate {
                    expected_revision: 1,
                    revision: 2,
                    origin: [0; 3],
                    dimensions: [1; 3],
                    labels: &[42],
                    data_range: (0, 65535),
                },
            )
            .unwrap();
        assert!(synchronize_locked(&state, &operation, "labels", None)
            .await
            .unwrap()
            .is_none());
        let renderer = state.render_loop_service.lock().await.clone().unwrap();
        let renderer = renderer.lock().await;
        assert_eq!(
            renderer
                .multi_texture_manager
                .as_ref()
                .unwrap()
                .editable_revision(handle)
                .unwrap(),
            2
        );
    }
    #[tokio::test]
    async fn failed_gpu_publication_keeps_accepted_cpu_labels_and_reports_the_failure() {
        use crate::{request_layer_gpu_resources_for_testing, LayerSpec, VolumeLayerSpec};
        let state = crate::BridgeState::default().unwrap();
        state
            .ensure_render_loop()
            .await
            .expect("GPU required for publication failure acceptance");
        state
            .volume_registry
            .lock()
            .await
            .insert_editable_labels("labels".into(), volume(), metadata(), 0)
            .unwrap();
        let info = request_layer_gpu_resources_for_testing(
            LayerSpec::Volume(VolumeLayerSpec {
                id: "label-layer".into(),
                source_resource_id: "labels".into(),
                colormap: "gray".into(),
                slice_axis: None,
                slice_index: None,
            }),
            None,
            &state,
        )
        .await
        .unwrap();
        let renderer = state.render_loop_service.lock().await.clone().unwrap();
        {
            let mut renderer = renderer.lock().await;
            let handle = renderer.editable_volume_handle("labels").unwrap();
            renderer.release_volume(handle.texture_index()).unwrap();
        }
        let operation = state.volume_operations.lock().await;
        let update = LabelRegionUpdate {
            expected_revision: 0,
            revision: 1,
            origin: [1, 0, 1],
            dimensions: [2, 2, 1],
            labels: &[7, 8, 301, 65535],
            data_range: (0, 65535),
        };
        assert!(
            publish_locked(&state, &operation, "labels", &update)
                .await
                .unwrap()
                .is_some(),
            "a failed resident texture must not report a successful repaint"
        );
        assert_eq!(
            state
                .volume_registry
                .lock()
                .await
                .get_entry("labels")
                .unwrap()
                .editable_revision,
            Some(1)
        );
        assert_eq!(
            values(state.volume_registry.lock().await.get("labels").unwrap()),
            [0, 0, 0, 0, 0, 0, 0, 7, 8, 0, 301, 65535]
        );
        assert!(
            synchronize_locked(&state, &operation, "labels", None)
                .await
                .unwrap()
                .is_some(),
            "reading a document must not clear a missing resident lease failure"
        );
        let _ = info;
    }
    #[tokio::test]
    async fn documents_retain_cpu_labels_without_a_layer_and_transfer_snapshots_on_disposal() {
        use volume_service::VolumeRepository;
        let state = crate::BridgeState::default().unwrap();
        state
            .volume_registry
            .lock()
            .await
            .insert_editable_labels("labels".into(), volume(), metadata(), 0)
            .unwrap();
        crate::volume_loading::DesktopVolumeRepository(&state)
            .remove("labels")
            .await
            .unwrap();
        assert!(state.volume_registry.lock().await.contains("labels"));
        assert!(state
            .volume_registry
            .lock()
            .await
            .remove("labels")
            .is_none());
        state
            .layer_to_volume_map
            .lock()
            .await
            .insert("another-view-layer".into(), "labels".into());
        {
            let _operation = state.volume_operations.lock().await;
            release_documents_locked(&state, &["labels".into()]).await;
        }
        assert!(
            !state
                .volume_registry
                .lock()
                .await
                .get_entry("labels")
                .unwrap()
                .retained_by_document
        );
        state.layer_to_volume_map.lock().await.clear();
        crate::volume_loading::DesktopVolumeRepository(&state)
            .remove("labels")
            .await
            .unwrap();
        assert!(!state.volume_registry.lock().await.contains("labels"));
        state
            .volume_registry
            .lock()
            .await
            .insert_editable_labels("unreferenced".into(), volume(), metadata(), 0)
            .unwrap();
        {
            let _operation = state.volume_operations.lock().await;
            release_documents_locked(&state, &["unreferenced".into()]).await;
        }
        assert!(!state.volume_registry.lock().await.contains("unreferenced"));
    }
}
