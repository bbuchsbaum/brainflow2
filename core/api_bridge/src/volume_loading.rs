//! Desktop I/O and registry adapter for the portable volume lifecycle service.
use crate::*;
use std::{
    fs::Metadata,
    path::{Path, PathBuf},
    time::SystemTime,
};
use volume_service::{LoadScope, PreparedVolume, VolumeRepository, VolumeSource};

/// Filesystem identity observed for one native acquisition. This is an
/// optimistic consistency check over the source reads; it is not an immutable
/// snapshot against metadata-invisible changes.
#[derive(Clone, Debug, PartialEq, Eq)]
struct AcquisitionFileStamp {
    length: u64,
    modified: SystemTime,
    #[cfg(unix)]
    identity: (u64, u64, i64, i64),
}

impl AcquisitionFileStamp {
    fn read(metadata: Metadata) -> BridgeResult<Self> {
        #[cfg(unix)]
        use std::os::unix::fs::MetadataExt;

        Ok(Self {
            length: metadata.len(),
            modified: metadata.modified()?,
            #[cfg(unix)]
            identity: (
                metadata.dev(),
                metadata.ino(),
                metadata.ctime(),
                metadata.ctime_nsec(),
            ),
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct AcquisitionSourceStamp {
    canonical_path: PathBuf,
    file: AcquisitionFileStamp,
}

impl AcquisitionSourceStamp {
    fn capture(path: &Path) -> BridgeResult<Self> {
        let canonical_path = path.canonicalize()?;
        Ok(Self {
            file: AcquisitionFileStamp::read(canonical_path.metadata()?)?,
            canonical_path,
        })
    }

    fn validate(&self, original_path: &Path) -> BridgeResult<()> {
        match Self::capture(original_path) {
            Ok(observed) if observed == *self => Ok(()),
            Ok(_) | Err(_) => Err(BridgeError::Input {
                code: 1005,
                details: "Source changed while loading file; retry the load.".into(),
            }),
        }
    }
}

#[cfg(test)]
type AfterRawHeaderHook = Box<dyn FnOnce() + Send + 'static>;
#[cfg(test)]
fn after_raw_header_hooks(
) -> &'static std::sync::Mutex<std::collections::HashMap<PathBuf, AfterRawHeaderHook>> {
    static HOOKS: std::sync::OnceLock<
        std::sync::Mutex<std::collections::HashMap<PathBuf, AfterRawHeaderHook>>,
    > = std::sync::OnceLock::new();
    HOOKS.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}
#[cfg(test)]
fn run_after_raw_header_hook(path: &Path) {
    if let Some(hook) = after_raw_header_hooks().lock().unwrap().remove(path) {
        hook();
    }
}

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

        // Capture one identity after remote materialization and keep its resolved
        // path for every source read in this acquisition. A final re-resolution
        // prevents publishing a header, decoded data, and metadata from different
        // same-sized source revisions.
        let source_stamp = AcquisitionSourceStamp::capture(&file_path)?;

        // Load the volume data.
        // [perf] The decode (gzip inflate + full f32 materialization) is CPU-bound
        // and ~100ms+ on a real volume. Run it on a blocking thread so it does not
        // stall the async runtime (and every other in-flight command) for that span.
        let decode_start = Instant::now();
        let decode_path = source_stamp.canonical_path.clone();
        // Dispatches on the header: multi-frame files load every frame as a
        // TimeSeries4D (the 3D-only loader would keep frame 0).
        let (volume_sendable, source_nifti_header) = tokio::task::spawn_blocking(move || {
            nifti_loader::check_nifti_file(&decode_path)?;
            let header = nifti_loader::read_source_header_bytes(&decode_path)?;
            #[cfg(test)]
            run_after_raw_header_hook(&decode_path);
            let volume = nifti_loader::load_nifti_auto_dimension(&decode_path)?;
            Ok::<_, nifti_loader::NiftiError>((volume, header))
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
            let temporal_meta = nifti_loader::read_temporal_metadata(&source_stamp.canonical_path);
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
        let intent = stat_metadata::read_volume_intent(source_stamp.canonical_path.clone()).await;

        // Return the handle
        let handle = VolumeHandleInfo {
            id: handle_id,
            name: file_name.to_string(),
            dims,
            dtype,
            volume_type,
            num_timepoints: time_series_info.as_ref().map(|ts| ts.num_timepoints),
            // Matches the registry, which starts a 4D volume at frame 0.
            current_timepoint: time_series_info.as_ref().map(|_| 0),
            time_series_info,
            statistic: intent.statistic,
            is_label_map: intent.is_label_map,
        };
        scope.check()?;
        // The temporal and intent reads above must belong to the same source as
        // the header and decoded volume. Re-resolve the original pathname at the
        // final publication boundary so a replacement cannot reach the registry.
        source_stamp.validate(&file_path)?;
        Ok(PreparedVolume {
            source_nifti_header: Some(source_nifti_header),
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
    /// The residency the upload filled. Dropped unpublished, only that
    /// residency is released: if its index was freed and refilled meanwhile,
    /// the new owner's texture and bookkeeping are left alone.
    slot: render_loop::SlotHandle,
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
    pub(crate) fn new(slot: render_loop::SlotHandle, owner: UploadOwner) -> Self {
        Self {
            owner: Some(owner),
            slot,
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
        let slot = self.slot;
        let runtime = owner.runtime.clone();
        runtime.spawn(async move {
            let _operation = owner.operations.lock().await;
            let mut renderer = owner.renderer.lock().await;
            if let Err(error) = renderer.release_layer_slot(slot) {
                warn!(
                    "Failed to release provisional upload {}: {}",
                    slot.index(),
                    error
                );
            }
            // The same test as a lease release: the layer's bookkeeping goes
            // when it names this upload's index (released here, or refilled by
            // another layer whose texture it must not draw) or an empty slot.
            let mut atlas = owner.atlas.lock().await;
            let ours = atlas.get(&owner.layer_id).is_some_and(|&index| {
                index == slot.index() || renderer.slot_handle(index).is_none()
            });
            if ours {
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
            let id = volume.handle.id.clone();
            registry.insert(id.clone(), volume.data, volume.metadata);
            registry
                .volumes
                .get_mut(&id)
                .expect("published volume")
                .source_nifti_header = volume.source_nifti_header.map(Arc::from);
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
        if registry
            .get_entry(volume_id)
            .is_some_and(|entry| entry.document_references > 0)
        {
            // Releasing the last display reference must not discard an open document.
            return Ok(());
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
        renderer.remove_custom_colormap(&format!("editable-label:{}", volume_id));
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
            source_nifti_header: None,
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

    #[cfg(unix)]
    #[tokio::test]
    async fn native_acquisition_rejects_same_size_same_mtime_replacement_after_header() {
        let path = std::env::temp_dir().join(format!(
            "brainflow-source-replacement-{}.nii",
            uuid::Uuid::new_v4()
        ));
        let replacement = path.with_extension("replacement.nii");
        struct Cleanup(Vec<PathBuf>);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                for path in &self.0 {
                    let _ = std::fs::remove_file(path);
                }
            }
        }
        let _cleanup = Cleanup(vec![path.clone(), replacement.clone()]);

        write_fixture_style_nifti(&path, [3, 2, 2, 1], 1.0);
        let original_metadata = std::fs::metadata(&path).unwrap();
        let original_len = original_metadata.len();
        let original_mtime = original_metadata.modified().unwrap();

        // Same layout and byte count, but a different world transform and payload.
        write_fixture_style_nifti(&replacement, [3, 2, 2, 1], 1.0);
        let mut replacement_bytes = std::fs::read(&replacement).unwrap();
        replacement_bytes[280..284].copy_from_slice(&9.0f32.to_le_bytes());
        replacement_bytes[352..356].copy_from_slice(&9.0f32.to_le_bytes());
        std::fs::write(&replacement, replacement_bytes).unwrap();
        std::fs::File::open(&replacement)
            .unwrap()
            .set_times(std::fs::FileTimes::new().set_modified(original_mtime))
            .unwrap();
        assert_eq!(std::fs::metadata(&replacement).unwrap().len(), original_len);
        assert_eq!(
            std::fs::metadata(&replacement).unwrap().modified().unwrap(),
            original_mtime
        );

        let hook_path = path.canonicalize().unwrap();
        after_raw_header_hooks().lock().unwrap().insert(
            hook_path,
            Box::new({
                let path = path.clone();
                let replacement = replacement.clone();
                move || {
                    std::fs::rename(&replacement, &path).unwrap();
                    let observed = std::fs::metadata(&path).unwrap();
                    assert_eq!(observed.len(), original_len);
                    assert_eq!(observed.modified().unwrap(), original_mtime);
                }
            }),
        );

        let state = BridgeState::default().unwrap();
        let error = VolumeLoadingService::load(
            &NativeVolumeSource {
                path: path.to_string_lossy().into(),
                state: &state,
            },
            &DesktopVolumeRepository(&state),
            &LoadScope::default(),
        )
        .await
        .unwrap_err();
        assert!(matches!(error, BridgeError::Input { code: 1005, .. }));
        assert!(state.volume_registry.lock().await.volumes.is_empty());
    }

    #[tokio::test]
    async fn native_acquisition_retains_original_header_after_source_changes() {
        let path = std::env::temp_dir().join(format!(
            "brainflow-reference-header-{}.nii",
            uuid::Uuid::new_v4()
        ));
        struct Cleanup(PathBuf);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = std::fs::remove_file(&self.0);
            }
        }
        let _cleanup = Cleanup(path.clone());
        write_fixture_style_nifti(&path, [3, 2, 2, 1], 1.0);
        let mut bytes = std::fs::read(&path).unwrap();
        bytes[40..42].copy_from_slice(&3i16.to_le_bytes());
        bytes[252..254].copy_from_slice(&1i16.to_le_bytes());
        bytes[268..272].copy_from_slice(&7.0f32.to_le_bytes());
        std::fs::write(&path, &bytes).unwrap();
        let expected = bytes[..348].to_vec();
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
        bytes[268..272].copy_from_slice(&9000.0f32.to_le_bytes());
        std::fs::write(&path, bytes).unwrap();
        let registry = state.volume_registry.lock().await;
        let captured = registry
            .get_entry(&handle.id)
            .unwrap()
            .source_nifti_header
            .as_ref()
            .unwrap();
        assert_eq!(captured.as_ref(), expected);
        let header = nifti::NiftiHeader::from_reader(captured.as_ref()).unwrap();
        assert_eq!(
            (header.qform_code, header.sform_code, header.quatern_x),
            (1, 4, 7.0)
        );
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
        assert_eq!(handle.current_timepoint, Some(0));
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

    /// Native round 2: a freshly loaded 4D file must draw frame 0 on its first
    /// render, before any timepoint change. Real Metal; a missing adapter fails.
    #[tokio::test]
    async fn freshly_loaded_4d_file_renders_frame_zero_before_any_timepoint_change() {
        let path =
            std::env::temp_dir().join(format!("brainflow-4d-gpu-{}.nii", uuid::Uuid::new_v4()));
        write_fixture_style_nifti(&path, [8, 8, 8, 3], 2.0);
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
        let service = render_loop::RenderLoopService::new()
            .await
            .expect("GPU adapter required for this test");
        *state.render_loop_service.lock().await = Some(Arc::new(tokio::sync::Mutex::new(service)));

        // Voxel centres 0..28 mm on each axis; frame t holds t + 1 everywhere.
        let payload = |timepoint: Option<usize>| {
            let mut payload = serde_json::json!({
                "views": {
                    "axial": {"origin_mm": [-2.0, 30.0, 14.0], "u_mm": [1.0, 0.0, 0.0], "v_mm": [0.0, -1.0, 0.0]},
                    "sagittal": {"origin_mm": [14.0, -2.0, 30.0], "u_mm": [0.0, 1.0, 0.0], "v_mm": [0.0, 0.0, -1.0]},
                    "coronal": {"origin_mm": [-2.0, 14.0, 30.0], "u_mm": [1.0, 0.0, 0.0], "v_mm": [0.0, 0.0, -1.0]}
                },
                "crosshair": {"world_mm": [14.0, 14.0, 14.0], "visible": false},
                "layers": [{
                    "id": "layer-4d-fresh",
                    "volumeId": handle.id,
                    "visible": true,
                    "opacity": 1.0,
                    "colormap": "gray",
                    "intensity": [0.0, 2.0],
                    "threshold": [0.0, 0.0],
                    "blendMode": "alpha",
                    "interpolation": "nearest"
                }],
                "requestedView": {
                    "type": "axial",
                    "origin_mm": [-2.0, 30.0, 14.0, 1.0],
                    "u_mm": [32.0, 0.0, 0.0, 0.0],
                    "v_mm": [0.0, -32.0, 0.0, 0.0],
                    "width": 32,
                    "height": 32
                }
            });
            if let Some(timepoint) = timepoint {
                payload["timepoint"] = serde_json::json!(timepoint);
            }
            payload.to_string()
        };

        // A first render that names frame 0 draws it: frame 0 (value 1 of the
        // 0..2 window) is uploaded at layer creation, no timepoint change needed.
        let first =
            crate::render_view_with_diagnostics_for_testing(payload(Some(0)), &state, Some("rgba"))
                .await
                .expect("first 4D render");
        let rgba = &first.data[8..];
        let lit = rgba
            .chunks_exact(4)
            .filter(|px| px[0] > 0 || px[1] > 0 || px[2] > 0)
            .count();
        assert!(
            lit > rgba.len() / 4 / 2,
            "frame 0 rendered black: {lit} lit pixels"
        );
        let centre = &rgba[(16 * 32 + 16) * 4..(16 * 32 + 16) * 4 + 4];
        assert!(
            (100..=156).contains(&centre[0]),
            "frame 0 grey level {centre:?}"
        );

        // A render that omits the timepoint is refused (4103), not drawn black.
        match crate::render_view_with_diagnostics_for_testing(payload(None), &state, Some("rgba"))
            .await
        {
            Err(BridgeError::Input { code: 4103, .. }) => {}
            other => panic!(
                "expected 4103 for a 4D render without timepoint, got {:?}",
                other.map(|_| ())
            ),
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
