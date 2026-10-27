//! Desktop I/O and registry adapter for the portable volume lifecycle service.
use crate::*;
use volume_service::{LoadScope, PreparedVolume, VolumeRepository, VolumeSource};

pub(crate) struct NativeVolumeSource<'a> {
    pub path: String,
    pub state: &'a BridgeState,
}

#[async_trait::async_trait]
impl VolumeSource for NativeVolumeSource<'_> {
    async fn acquire(&self, scope: &LoadScope) -> BridgeResult<PreparedVolume> {
        let path = self.path.clone();
        info!("Bridge: load_file called with path: {}", path);
        scope.check()?;

        // Materialize a remote-backed file into local cache when needed.
        let file_path = PathBuf::from(&path);
        materialize_remote_file_if_needed(self.state, &file_path).await?;

        // Validate that the file exists and is loadable.
        if !file_path.exists() {
            return Err(BridgeError::Io {
                code: 1001,
                details: format!("File not found: {}", path),
            });
        }

        if !core_loaders::is_loadable(&file_path) {
            return Err(BridgeError::Input {
                code: 1002,
                details: format!("File format not supported: {}", path),
            });
        }

        // Load the volume data.
        // [perf] The decode (gzip inflate + full f32 materialization) is CPU-bound
        // and ~100ms+ on a real volume. Run it on a blocking thread so it does not
        // stall the async runtime (and every other in-flight command) for that span.
        let decode_start = Instant::now();
        let decode_path = file_path.clone();
        // Dispatches on the header: multi-frame files load every frame as a
        // TimeSeries4D (the 3D-only loader would keep frame 0).
        let volume_sendable = tokio::task::spawn_blocking(move || {
            nifti_loader::load_nifti_auto_dimension(&decode_path)
        })
        .await
        .map_err(|e| BridgeError::Internal {
            code: 1004,
            details: format!("Volume decode task failed for {}: {}", path, e),
        })?
        .map_err(|e| BridgeError::Loader {
            code: 1003,
            details: format!("Failed to load file {}: {}", path, e),
        })?;
        info!(
            "[perf] load_file decode (spawn_blocking, off async runtime): {} ms ({})",
            decode_start.elapsed().as_millis(),
            path
        );

        scope.check()?;

        // 4D files carry a repetition time (TR) in the NIfTI header that the loaded
        // volume does not retain. Re-read it lazily (header only — cheap) *inside*
        // this closure so only 4D loads pay for it; the 3D arms never call it. `tr`
        // is normalized to seconds.
        let make_time_series_info = |num_timepoints: usize| {
            let temporal_meta = nifti_loader::read_temporal_metadata(&file_path);
            bridge_types::TimeSeriesInfo {
                num_timepoints,
                tr: temporal_meta.tr_seconds,
                temporal_unit: temporal_meta.temporal_unit,
                acquisition_time: temporal_meta
                    .tr_seconds
                    .map(|tr| tr * num_timepoints as f32),
            }
        };

        // Derive dimensions/type metadata directly from the already-loaded volume.
        // This avoids a second full parse/decode pass through NiftiLoader::load.
        let (dims, dtype, volume_type, time_series_info) = match &volume_sendable {
            VolumeSendable::VolF32(vol, _) => (
                vol.space().dim.clone(),
                "f32".to_string(),
                bridge_types::VolumeType::Volume3D,
                None,
            ),
            VolumeSendable::VolI16(vol, _) => (
                vol.space().dim.clone(),
                "i16".to_string(),
                bridge_types::VolumeType::Volume3D,
                None,
            ),
            VolumeSendable::VolU8(vol, _) => (
                vol.space().dim.clone(),
                "u8".to_string(),
                bridge_types::VolumeType::Volume3D,
                None,
            ),
            VolumeSendable::VolI8(vol, _) => (
                vol.space().dim.clone(),
                "i8".to_string(),
                bridge_types::VolumeType::Volume3D,
                None,
            ),
            VolumeSendable::VolU16(vol, _) => (
                vol.space().dim.clone(),
                "u16".to_string(),
                bridge_types::VolumeType::Volume3D,
                None,
            ),
            VolumeSendable::VolI32(vol, _) => (
                vol.space().dim.clone(),
                "i32".to_string(),
                bridge_types::VolumeType::Volume3D,
                None,
            ),
            VolumeSendable::VolU32(vol, _) => (
                vol.space().dim.clone(),
                "u32".to_string(),
                bridge_types::VolumeType::Volume3D,
                None,
            ),
            VolumeSendable::VolF64(vol, _) => (
                vol.space().dim.clone(),
                "f64".to_string(),
                bridge_types::VolumeType::Volume3D,
                None,
            ),
            VolumeSendable::Vec4DF32(vec) => (
                vec.space().dim.clone(),
                "f32".to_string(),
                bridge_types::VolumeType::TimeSeries4D,
                Some(make_time_series_info(
                    vec.space().dim.get(3).copied().unwrap_or(1),
                )),
            ),
            VolumeSendable::Vec4DI16(vec) => (
                vec.space().dim.clone(),
                "i16".to_string(),
                bridge_types::VolumeType::TimeSeries4D,
                Some(make_time_series_info(
                    vec.space().dim.get(3).copied().unwrap_or(1),
                )),
            ),
            VolumeSendable::Vec4DU8(vec) => (
                vec.space().dim.clone(),
                "u8".to_string(),
                bridge_types::VolumeType::TimeSeries4D,
                Some(make_time_series_info(
                    vec.space().dim.get(3).copied().unwrap_or(1),
                )),
            ),
            VolumeSendable::Vec4DI8(vec) => (
                vec.space().dim.clone(),
                "i8".to_string(),
                bridge_types::VolumeType::TimeSeries4D,
                Some(make_time_series_info(
                    vec.space().dim.get(3).copied().unwrap_or(1),
                )),
            ),
            VolumeSendable::Vec4DU16(vec) => (
                vec.space().dim.clone(),
                "u16".to_string(),
                bridge_types::VolumeType::TimeSeries4D,
                Some(make_time_series_info(
                    vec.space().dim.get(3).copied().unwrap_or(1),
                )),
            ),
            VolumeSendable::Vec4DI32(vec) => (
                vec.space().dim.clone(),
                "i32".to_string(),
                bridge_types::VolumeType::TimeSeries4D,
                Some(make_time_series_info(
                    vec.space().dim.get(3).copied().unwrap_or(1),
                )),
            ),
            VolumeSendable::Vec4DU32(vec) => (
                vec.space().dim.clone(),
                "u32".to_string(),
                bridge_types::VolumeType::TimeSeries4D,
                Some(make_time_series_info(
                    vec.space().dim.get(3).copied().unwrap_or(1),
                )),
            ),
            VolumeSendable::Vec4DF64(vec) => (
                vec.space().dim.clone(),
                "f64".to_string(),
                bridge_types::VolumeType::TimeSeries4D,
                Some(make_time_series_info(
                    vec.space().dim.get(3).copied().unwrap_or(1),
                )),
            ),
        };

        // Generate a unique handle ID based on the file name
        let file_name = file_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown");
        let handle_id = format!("volume_{}", uuid::Uuid::new_v4());

        // Create volume metadata
        let metadata = VolumeMetadataInfo {
            name: file_name.to_string(),
            path: path.clone(),
            dtype: dtype.clone(),
            volume_type: volume_type.clone(),
            time_series_info: time_series_info.clone(),
        };

        // Statistic/label intent from one header read, off the async runtime.
        let intent = stat_metadata::read_volume_intent(file_path.clone()).await;

        // Return the handle
        let handle = VolumeHandleInfo {
            id: handle_id,
            name: file_name.to_string(),
            dims,
            dtype,
            volume_type,
            num_timepoints: time_series_info.as_ref().map(|ts| ts.num_timepoints),
            current_timepoint: None,
            time_series_info,
            statistic: intent.statistic,
            is_label_map: intent.is_label_map,
        };
        scope.check()?;
        Ok(PreparedVolume {
            data: volume_sendable,
            metadata,
            handle,
        })
    }
}

pub(crate) struct DesktopVolumeRepository<'a>(pub &'a BridgeState);

/// A successful upload belongs to this guard before any async bookkeeping.
/// Construct inside the blocking worker so a dropped JoinHandle cannot orphan it.
pub(crate) struct ProvisionalUpload {
    owner: Option<UploadOwner>,
    atlas_index: u32,
}

pub(crate) struct UploadOwner {
    runtime: tokio::runtime::Handle,
    operations: Arc<Mutex<()>>,
    renderer: Arc<Mutex<RenderLoopService>>,
    layer_id: String,
    atlas: Arc<Mutex<HashMap<String, u32>>>,
    volumes: Arc<Mutex<HashMap<String, String>>>,
    timepoints: Arc<Mutex<HashMap<String, Option<usize>>>>,
}

impl UploadOwner {
    pub(crate) fn new(
        state: &BridgeState,
        renderer: Arc<Mutex<RenderLoopService>>,
        layer_id: String,
    ) -> Self {
        Self {
            runtime: tokio::runtime::Handle::current(),
            operations: Arc::clone(&state.volume_operations),
            renderer,
            layer_id,
            atlas: Arc::clone(&state.layer_to_atlas_map),
            volumes: Arc::clone(&state.layer_to_volume_map),
            timepoints: Arc::clone(&state.layer_to_timepoint_map),
        }
    }
}

impl ProvisionalUpload {
    pub(crate) fn new(atlas_index: u32, owner: UploadOwner) -> Self {
        Self {
            owner: Some(owner),
            atlas_index,
        }
    }

    /// The existing LayerLease now owns allocation and map teardown.
    pub(crate) fn transfer_to_lease(&mut self) {
        self.owner = None;
    }
}

impl Drop for ProvisionalUpload {
    fn drop(&mut self) {
        let Some(owner) = self.owner.take() else {
            return;
        };
        let atlas_index = self.atlas_index;
        let runtime = owner.runtime.clone();
        runtime.spawn(async move {
            let _operation = owner.operations.lock().await;
            let mut renderer = owner.renderer.lock().await;
            if let Err(error) = renderer.release_layer_resources(atlas_index) {
                warn!(
                    "Failed to release provisional upload {}: {}",
                    atlas_index, error
                );
            }
            let mut atlas = owner.atlas.lock().await;
            // Never remove another allocation's bookkeeping.
            if atlas.get(&owner.layer_id) == Some(&atlas_index) {
                atlas.remove(&owner.layer_id);
                owner.volumes.lock().await.remove(&owner.layer_id);
                owner.timepoints.lock().await.remove(&owner.layer_id);
            }
        });
    }
}

#[async_trait::async_trait]
impl VolumeRepository for DesktopVolumeRepository<'_> {
    async fn publish(
        &self,
        volume: PreparedVolume,
        scope: &LoadScope,
    ) -> BridgeResult<VolumeHandleInfo> {
        let _operation = self.0.volume_operations.lock().await;
        let mut registry = self.0.volume_registry.lock().await;
        scope.commit(|| {
            registry.insert(volume.handle.id.clone(), volume.data, volume.metadata);
            Ok(volume.handle)
        })
    }

    async fn remove(&self, volume_id: &str) -> BridgeResult<()> {
        let state = self.0;
        // Serialize with GPU preparation/publication so unload cannot race an upload.
        let _operation = state.volume_operations.lock().await;
        let mappings = state.layer_to_volume_map.lock().await;
        let active: Vec<_> = mappings
            .iter()
            .filter(|(_, id)| id.as_str() == volume_id)
            .map(|(layer, _)| layer.clone())
            .collect();
        if !active.is_empty() {
            return Err(BridgeError::Input {
                code: 4048,
                details: format!(
                    "Cannot unload volume '{}' while active layer mappings exist: {}",
                    volume_id,
                    active.join(", ")
                ),
            });
        }
        // Volumes shown by a layer; a cluster label volume owned by this
        // source is released below unless it is among them.
        let displayed: std::collections::HashSet<String> = mappings.values().cloned().collect();
        drop(mappings);
        // Do all awaited host work before the final synchronous removal.
        let renderer = state.render_loop_service.lock().await.clone();
        let mut renderer = match &renderer {
            Some(s) => Some(s.lock().await),
            None => None,
        };
        let mut samplers = state.surface_samplers.lock().await;
        let mut registry = state.volume_registry.lock().await;
        if !registry.contains(volume_id) {
            return Err(BridgeError::VolumeNotFound {
                code: 4041,
                details: volume_id.into(),
            });
        }
        release_volume(
            renderer.as_deref_mut(),
            &mut samplers,
            &mut registry,
            volume_id,
        );
        // A cluster label volume owned by this source goes with it (unless a
        // layer displays it), through the same release.
        if let Some(label_id) = crate::cluster_labels::owned_after_removal(volume_id, &displayed) {
            release_volume(
                renderer.as_deref_mut(),
                &mut samplers,
                &mut registry,
                &label_id,
            );
        }
        crate::clusters::forget_generation(volume_id);
        Ok(())
    }
}

/// Host-side release of one registered volume: its parcel colormap, the
/// surface samplers bound to it, and its registry entry (with dictionaries
/// and overlays). Callers hold `volume_operations`, and take the renderer,
/// sampler and registry locks in that order (after any layer-map snapshot),
/// so no layer allocation can interleave with the removal.
pub(crate) fn release_volume(
    renderer: Option<&mut RenderLoopService>,
    samplers: &mut HashMap<String, SurfaceSamplerEntry>,
    registry: &mut VolumeRegistry,
    volume_id: &str,
) {
    if let Some(renderer) = renderer {
        renderer.remove_custom_colormap(&format!("parcel:{}", volume_id));
    }
    samplers.retain(|_, entry| entry.template_volume_id != volume_id);
    registry.remove(volume_id);
}

#[cfg(test)]
mod tests {
    use super::*;
    use volume_service::VolumeLoadingService;

    fn volume() -> VolumeSendable {
        let space = volmath::NeuroSpace::new(vec![2, 3, 4], None, None, None, None).unwrap();
        VolumeSendable::VolF32(
            volmath::DenseVolume3::from_data(space, vec![1_f32; 24]),
            Default::default(),
        )
    }

    fn prepared() -> PreparedVolume {
        PreparedVolume {
            data: volume(),
            metadata: VolumeMetadataInfo {
                name: "brain".into(),
                path: "memory:brain".into(),
                dtype: "f32".into(),
                volume_type: bridge_types::VolumeType::Volume3D,
                time_series_info: None,
            },
            handle: VolumeHandleInfo {
                id: "volume".into(),
                name: "brain".into(),
                dims: vec![2, 3, 4],
                dtype: "f32".into(),
                volume_type: bridge_types::VolumeType::Volume3D,
                num_timepoints: None,
                current_timepoint: None,
                time_series_info: None,
                statistic: None,
                is_label_map: Some(false),
            },
        }
    }

    fn layer() -> LayerSpec {
        LayerSpec::Volume(VolumeLayerSpec {
            id: "layer".into(),
            source_resource_id: "volume".into(),
            colormap: "gray".into(),
            slice_axis: None,
            slice_index: None,
        })
    }

    async fn register(state: &BridgeState) {
        DesktopVolumeRepository(state)
            .publish(prepared(), &LoadScope::default())
            .await
            .unwrap();
    }

    async fn await_no_gpu_resources(state: &BridgeState) {
        tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                let renderer = state
                    .render_loop_service
                    .lock()
                    .await
                    .as_ref()
                    .unwrap()
                    .clone();
                let empty = renderer
                    .lock()
                    .await
                    .multi_texture_manager
                    .as_ref()
                    .unwrap()
                    .resident_slot_count()
                    == 0;
                if empty {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("provisional upload cleanup completed");
        assert!(state.layer_to_atlas_map.lock().await.is_empty());
        assert!(state.layer_to_volume_map.lock().await.is_empty());
        assert!(state.layer_to_timepoint_map.lock().await.is_empty());
        assert!(state.layer_leases.lock().await.is_empty());
    }

    #[tokio::test]
    async fn native_load_register_unload_keeps_decoded_data_owned() {
        let path = std::env::temp_dir().join(format!(
            "brainflow-lifecycle-{}.nii.gz",
            uuid::Uuid::new_v4()
        ));
        struct FileCleanup(PathBuf);
        impl Drop for FileCleanup {
            fn drop(&mut self) {
                let _ = std::fs::remove_file(&self.0);
            }
        }
        let _file = FileCleanup(path.clone());
        let VolumeSendable::VolF32(vol, _) = volume() else {
            unreachable!()
        };
        neuroim::io::write_vol(vol.inner(), &path).unwrap();
        let state = BridgeState::default().unwrap();
        let handle = VolumeLoadingService::load(
            &NativeVolumeSource {
                path: path.to_string_lossy().into(),
                state: &state,
            },
            &DesktopVolumeRepository(&state),
            &LoadScope::default(),
        )
        .await
        .unwrap();
        assert_eq!(handle.dims, vec![2, 3, 4]);
        let observed = Arc::downgrade(
            &state
                .volume_registry
                .lock()
                .await
                .get_arc(&handle.id)
                .unwrap(),
        );
        assert!(observed.upgrade().is_some());
        VolumeLoadingService::unload(&DesktopVolumeRepository(&state), &handle.id)
            .await
            .unwrap();
        assert!(observed.upgrade().is_none());
    }

    /// A single-file NIfTI-1 written byte for byte like the native-check
    /// fixture generator (.hillclimb/native-check/p4/gen/make_fixtures.py
    /// `write_nifti`): x-fastest float32, sform code 4, xyzt_units mm + s,
    /// pixdim[4] = TR, 4 empty extension bytes.
    fn write_fixture_style_nifti(path: &std::path::Path, dims: [usize; 4], tr: f32) {
        let mut header = vec![0u8; 348];
        header[0..4].copy_from_slice(&348i32.to_le_bytes());
        let dim: [i16; 8] = [
            4,
            dims[0] as i16,
            dims[1] as i16,
            dims[2] as i16,
            dims[3] as i16,
            1,
            1,
            1,
        ];
        for (index, value) in dim.iter().enumerate() {
            header[40 + 2 * index..42 + 2 * index].copy_from_slice(&value.to_le_bytes());
        }
        header[70..72].copy_from_slice(&16i16.to_le_bytes()); // float32
        header[72..74].copy_from_slice(&32i16.to_le_bytes());
        let pixdim = [1.0f32, 4.0, 4.0, 4.0, tr, 1.0, 1.0, 1.0];
        for (index, value) in pixdim.iter().enumerate() {
            header[76 + 4 * index..80 + 4 * index].copy_from_slice(&value.to_le_bytes());
        }
        header[108..112].copy_from_slice(&352f32.to_le_bytes()); // vox_offset
        header[112..116].copy_from_slice(&1f32.to_le_bytes()); // scl_slope
        header[123] = 2 | 8; // mm + seconds
        header[254..256].copy_from_slice(&4i16.to_le_bytes()); // sform_code (MNI)
        for axis in 0..3 {
            let mut row = [0f32; 4];
            row[axis] = 4.0;
            for (index, value) in row.iter().enumerate() {
                let at = 280 + 16 * axis + 4 * index;
                header[at..at + 4].copy_from_slice(&value.to_le_bytes());
            }
        }
        header[344..348].copy_from_slice(b"n+1\0");
        header.extend_from_slice(&[0u8; 4]);
        // Frame t holds t + 1 everywhere (x-fastest within each frame).
        for t in 0..dims[3] {
            for _ in 0..dims[0] * dims[1] * dims[2] {
                header.extend_from_slice(&((t + 1) as f32).to_le_bytes());
            }
        }
        std::fs::write(path, header).unwrap();
    }

    #[tokio::test]
    async fn four_d_file_loads_every_frame_through_the_native_path() {
        let path = std::env::temp_dir().join(format!("brainflow-4d-{}.nii", uuid::Uuid::new_v4()));
        write_fixture_style_nifti(&path, [4, 3, 2, 5], 2.0);
        let state = BridgeState::default().unwrap();
        let handle = VolumeLoadingService::load(
            &NativeVolumeSource {
                path: path.to_string_lossy().into(),
                state: &state,
            },
            &DesktopVolumeRepository(&state),
            &LoadScope::default(),
        )
        .await
        .unwrap();
        std::fs::remove_file(&path).ok();
        assert_eq!(handle.volume_type, bridge_types::VolumeType::TimeSeries4D);
        assert_eq!(handle.dims, vec![4, 3, 2, 5]);
        assert_eq!(handle.num_timepoints, Some(5));
        let series = handle.time_series_info.as_ref().unwrap();
        assert_eq!((series.num_timepoints, series.tr), (5, Some(2.0)));
        // Every frame is resident: the last frame holds 5.
        let registry = state.volume_registry.lock().await;
        let volume = registry.get(&handle.id).unwrap();
        assert_eq!(
            crate::read_member_frame_at_voxel(volume, 3, 2, 1, 4),
            Some(5.0)
        );
        assert_eq!(
            crate::read_member_frame_at_voxel(volume, 0, 0, 0, 0),
            Some(1.0)
        );
    }

    #[tokio::test]
    async fn gzipped_fir_map_loads_all_lags_through_the_native_path() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../field_table/fixtures/neurotabs/fir4d/maps/sub-01_task-faces_fir.nii.gz");
        let state = BridgeState::default().unwrap();
        let handle = VolumeLoadingService::load(
            &NativeVolumeSource {
                path: path.to_string_lossy().into(),
                state: &state,
            },
            &DesktopVolumeRepository(&state),
            &LoadScope::default(),
        )
        .await
        .unwrap();
        assert_eq!(handle.dims, vec![41, 49, 40, 6]);
        assert_eq!(handle.num_timepoints, Some(6));
        let registry = state.volume_registry.lock().await;
        let volume = registry.get(&handle.id).unwrap();
        let lags: Vec<f32> = (0..6)
            .map(|lag| crate::read_member_frame_at_voxel(volume, 7, 23, 30, lag).unwrap())
            .collect();
        for (got, want) in lags.iter().zip([0.1f32, 0.6, 1.1, 0.7, 0.3, 0.1]) {
            assert!((got - want).abs() < 1e-6, "{lags:?}");
        }
    }

    #[tokio::test]
    async fn closed_scope_waiting_for_registry_never_publishes() {
        let state = BridgeState::default().unwrap();
        let scope = LoadScope::default();
        let operation = state.volume_operations.lock().await;
        let repository = DesktopVolumeRepository(&state);
        let mut publish = Box::pin(repository.publish(prepared(), &scope));
        assert!(futures::poll!(&mut publish).is_pending());
        scope.close();
        drop(operation);
        assert!(publish.await.is_err());
        assert!(state.volume_registry.lock().await.volumes.is_empty());
    }

    #[tokio::test]
    async fn post_upload_failure_reclaims_allocation_before_unload() {
        let state = BridgeState::default().unwrap();
        state.ensure_render_loop().await.unwrap();
        register(&state).await;
        let error = request_layer_gpu_resources_with_upload_hook(layer(), None, &state, || {
            Err(BridgeError::GpuError {
                code: 5012,
                details: "injected failure after real upload".into(),
            })
        })
        .await
        .unwrap_err();
        assert!(matches!(error, BridgeError::GpuError { code: 5012, .. }));
        await_no_gpu_resources(&state).await;
        VolumeLoadingService::unload(&DesktopVolumeRepository(&state), "volume")
            .await
            .unwrap();
        assert!(state.volume_registry.lock().await.volumes.is_empty());
    }

    #[tokio::test]
    async fn cancelled_waiter_does_not_abandon_blocking_upload() {
        let state = Arc::new(BridgeState::default().unwrap());
        state.ensure_render_loop().await.unwrap();
        register(&state).await;
        let (finish, wait) = std::sync::mpsc::channel();
        let started = Arc::new(tokio::sync::Notify::new());
        let started_worker = Arc::clone(&started);
        let load_state = Arc::clone(&state);
        let task = tokio::spawn(async move {
            request_layer_gpu_resources_with_upload_hook(layer(), None, &load_state, move || {
                started_worker.notify_one();
                wait.recv().unwrap();
                Ok(())
            })
            .await
        });
        started.notified().await;
        task.abort();
        assert!(task.await.unwrap_err().is_cancelled());
        finish.send(()).unwrap();
        await_no_gpu_resources(&state).await;
        VolumeLoadingService::unload(&DesktopVolumeRepository(&state), "volume")
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn active_gpu_layer_refuses_unload_then_releases_cleanly() {
        let state = BridgeState::default().unwrap();
        state.ensure_render_loop().await.unwrap();
        register(&state).await;
        request_layer_gpu_resources_for_testing(layer(), None, &state)
            .await
            .unwrap();
        let duplicate = request_layer_gpu_resources_for_testing(layer(), None, &state)
            .await
            .unwrap_err();
        assert!(matches!(duplicate, BridgeError::Input { code: 1006, .. }));
        let renderer = state
            .render_loop_service
            .lock()
            .await
            .as_ref()
            .unwrap()
            .clone();
        assert_eq!(
            renderer
                .lock()
                .await
                .multi_texture_manager
                .as_ref()
                .unwrap()
                .resident_slot_count(),
            1
        );
        assert!(
            VolumeLoadingService::unload(&DesktopVolumeRepository(&state), "volume")
                .await
                .is_err()
        );
        assert!(state.volume_registry.lock().await.contains("volume"));
        release_layer_gpu_resources_internal("layer".into(), &state)
            .await
            .unwrap();
        VolumeLoadingService::unload(&DesktopVolumeRepository(&state), "volume")
            .await
            .unwrap();
        await_no_gpu_resources(&state).await;
    }
}
