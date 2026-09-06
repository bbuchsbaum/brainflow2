pub mod atlas_roi;
mod population_sampling;
mod set_sample_cache;
pub use atlas_roi::AtlasRoiLocation;
use population_sampling::{SampleCancellation, SampleTicket};
pub mod parcel_overlay;
pub use parcel_overlay::{
    ParcelColumnInfo, ParcelOverlayInfo, ParcelTablePreview, ParcelTableRequest, SurfaceParcelTable,
};
use tauri::command;
// Import necessary volmath types directly
use volmath::DenseVolume3;
use volmath::DenseVolumeExt; // Import DenseVolumeExt trait
use volmath::NeuroSpaceExt; // Import NeuroSpaceExt trait
use volmath::NeuroVecTrait; // Import NeuroVecTrait for volume() method // Import DenseVolume3 type
                            // Import neuroim types through volmath re-exports
                            // use wgpu; // No longer needed directly
use std::collections::{HashMap, HashSet, VecDeque};
use std::convert::TryInto;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::State; // Need State for accessing registry
                  // Import types from bridge_types
use bridge_types::{
    self, icons, BatchRenderRequest, BridgeError, BridgeResult, DataRange, FlatNode,
    GpuTextureFormat, LayerPatch, Loader, NiftiHeaderInfo, PeekVolumeMetadata, RemoteAuthChallenge,
    RemoteAuthPrompt, RemoteHostKeyChallenge, RemoteMountConnectRequest, RemoteMountConnectResult,
    RemoteMountInfo, RemoteMountOrigin, RemoteMountProfile, SliceAxisMeta, SliceInfo,
    StudioDiscoveryDesignValue, StudioDiscoveryPromotionRequest, StudioDiscoveryPromotionResult,
    StudioFolderOntologyPreviewRequest, StudioFolderOntologySummary, StudioImportCandidate,
    StudioImportPreviewRequest, TextureCoordinates, TreePayload, VolumeHandleInfo,
    VolumeLayerGpuInfo, VolumeSendable,
};
use colormap::colormap_by_name;
// Import NiftiLoader for registration
// use nifti_loader::NiftiLoader;
use render_loop::{RenderLoopService, SliceFeatureUbo}; // Remove unused RenderLoopError
                                                       // Import async_trait attribute
                                                       // use async_trait::async_trait;
use log::{debug, error, info, warn}; // Added error, warn, and debug
use serde::{Deserialize, Serialize}; // Need Serialize/Deserialize for new types
                                     // For JSON parsing
use ts_rs::TS;
// For generating unique IDs // Add TS trait
// Use futures::executor::block_on when needed (now removed)
// use futures;
// Added imports for plugin creation
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Emitter, Manager, Runtime};
// Re-add tokio::sync::Mutex
use directories::ProjectDirs;
use keyring::Entry as KeyringEntry;
use nalgebra::{Affine3, Matrix4}; // Removed unused Vector4
use neuro_types::{ViewOrientation, ViewRectMm, VolumeMetadata};
use remotely::ssh::{
    AuthMethod as RemoteAuthMethod, ConnectConfig as RemoteConnectConfig,
    ConnectOutcome as RemoteConnectOutcome, HostKeyDisposition,
};
use remotely::{FilesystemProbeOptions, RemoteClient};
use tokio::runtime::Handle;
use tokio::sync::Mutex;
use tokio::time::{interval, MissedTickBehavior};
// Add tracing facade import // For get_initial_views

// Imports for fs_list_directory
// Assuming core_loaders is the crate name for the new module
use brainflow_loaders as core_loaders;
// GIFTI support

// Import error helpers
mod analysis;
mod command_registry;
mod error_context;
mod error_helpers;
mod histogram;
pub mod image_set;
mod materialization;
mod projection_geometry;
mod remote_cache;
mod remote_transfer;
mod render_bridge_adapter;
mod render_lifecycle;
mod surface_loading;
mod user_errors;
use command_registry::bridge_commands;
use error_context::*;
use projection_geometry::build_volume3d_from_projection;

// Bring the analysis commands into crate-root scope so `command_list.rs` can list
// them as bare identifiers alongside the commands defined in this file.
use analysis::{cancel_analysis, get_analysis_job_status, list_analyses, start_analysis};
use error_helpers::*;

// Import atlas system
use atlases::{
    AtlasCatalogEntry, AtlasConfig, AtlasFilter, AtlasLoadProgress, AtlasService,
    SurfaceAtlasLoadResult,
};

// --- Add Correlation ID Macro ---
#[macro_export]
macro_rules! new_request_span {
    ($name:literal) => {
        // Use tracing::info_span! which includes target/file/line info by default
        tracing::info_span!($name, request_id = %uuid::Uuid::new_v4())
    };
}
// --- End Correlation ID Macro ---

// Use VolumeHandleInfo from bridge_types instead of defining locally

// Event payload for volume-loaded event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VolumeLoadedEvent {
    pub volume_id: String,
    pub name: String,
    pub dims: [usize; 3],
    pub dtype: String,
    pub path: String,
}

/// Result of an atlas load request exposed to the frontend.
/// Wraps atlas metadata together with a concrete registered volume handle.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AtlasLoadResult {
    pub success: bool,
    pub atlas_metadata: Option<atlases::AtlasMetadata>,
    /// Convenience handle string for display/debugging (mirrors VolumeHandleInfo.id)
    pub volume_handle: Option<String>,
    /// Rich volume handle info the UI can pass into VolumeLoadingService
    pub volume_handle_info: Option<VolumeHandleInfo>,
    /// Present when the operation failed before a handle could be created
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)] // Add derives
#[ts(export)]
pub struct TimeSeriesResult {
    pub matrix: Vec<f32>, // Example field
    pub num_coords: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct VolumeBounds {
    pub min: [f32; 3],
    pub max: [f32; 3],
    pub center: [f32; 3],
    pub dims: [u32; 3],
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)] // Add derives
#[ts(export)]
pub struct LayerGpuResources {
    pub layer_id: String, // Renamed field
                          // Add other relevant GPU resource identifiers if needed
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)] // Add derives
#[ts(export)]
pub enum LayerSpec {
    Volume(VolumeLayerSpec), // Example variant
                             // Add other layer types (e.g., SurfaceLayerSpec)
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, TS)] // Add derives
#[ts(export)]
#[derive(Default)]
pub enum SliceAxis {
    Sagittal = 0, // X axis (YZ plane)
    Coronal = 1,  // Y axis (XZ plane)
    #[default]
    Axial = 2, // Z axis (XY plane)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)] // Add derives
#[ts(export)]
#[derive(Default)]
pub enum SliceIndex {
    Fixed(usize), // Specific slice index
    #[default]
    Middle, // Middle slice (default)
    Relative(f32), // Relative position (0.0 = first, 1.0 = last)
    WorldCoordinate(f32), // Slice at specific world coordinate
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)] // Add derives
#[ts(export)]
pub struct VolumeLayerSpec {
    // Example struct for Volume variant
    pub id: String,                 // ID of the layer itself
    pub source_resource_id: String, // ID of the underlying volume (from VolumeHandleInfo.id)
    pub colormap: String,
    pub slice_axis: Option<SliceAxis>, // Optional: axis for slice extraction (default: Axial)
    pub slice_index: Option<SliceIndex>, // Optional: slice index specification (default: Middle)
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)] // Add derives
#[ts(export)]
pub struct ReleaseResult {
    pub success: bool,
    pub message: String,
}

#[derive(Debug, Clone)]
struct ReleaseOutcome {
    atlas_index: u32,
    #[allow(dead_code)]
    render_state_entry_removed: bool,
}

struct LayerLease {
    inner: Arc<LayerLeaseInner>,
}

struct LayerLeaseInner {
    layer_id: String,
    atlas_index: u32,
    render_loop_service: Arc<Mutex<Option<Arc<Mutex<RenderLoopService>>>>>,
    layer_to_atlas_map: Arc<Mutex<HashMap<String, u32>>>,
    layer_to_volume_map: Arc<Mutex<HashMap<String, String>>>,
    layer_to_timepoint_map: Arc<Mutex<HashMap<String, Option<usize>>>>,
    resident_image_sets: Arc<Mutex<HashMap<String, image_set::ResidentImageSet>>>,
    is_released: AtomicBool,
    created_at: Instant,
}

const LAYER_WATCHDOG_INTERVAL: Duration = Duration::from_secs(60);
const LAYER_WATCHDOG_STALE_AGE: Duration = Duration::from_secs(5 * 60);

impl LayerLease {
    fn new(
        layer_id: String,
        atlas_index: u32,
        render_loop_service: Arc<Mutex<Option<Arc<Mutex<RenderLoopService>>>>>,
        layer_to_atlas_map: Arc<Mutex<HashMap<String, u32>>>,
        layer_to_volume_map: Arc<Mutex<HashMap<String, String>>>,
        layer_to_timepoint_map: Arc<Mutex<HashMap<String, Option<usize>>>>,
        resident_image_sets: Arc<Mutex<HashMap<String, image_set::ResidentImageSet>>>,
    ) -> Self {
        Self {
            inner: Arc::new(LayerLeaseInner {
                layer_id,
                atlas_index,
                render_loop_service,
                layer_to_atlas_map,
                layer_to_volume_map,
                layer_to_timepoint_map,
                resident_image_sets,
                is_released: AtomicBool::new(false),
                created_at: Instant::now(),
            }),
        }
    }

    fn atlas_index(&self) -> u32 {
        self.inner.atlas_index
    }

    #[allow(dead_code)]
    fn layer_id(&self) -> &str {
        &self.inner.layer_id
    }

    fn is_released(&self) -> bool {
        self.inner.is_released.load(Ordering::SeqCst)
    }

    fn age(&self) -> Duration {
        self.inner.created_at.elapsed()
    }

    async fn release(&self, reason: &'static str) -> BridgeResult<Option<ReleaseOutcome>> {
        self.inner.release(reason).await
    }

    async fn release_with_service(
        &self,
        render_service: &mut RenderLoopService,
        reason: &'static str,
    ) -> BridgeResult<Option<ReleaseOutcome>> {
        self.inner
            .release_with_service(render_service, reason)
            .await
    }
}

impl LayerLeaseInner {
    async fn prepare_release(&self) -> Option<u32> {
        if self.is_released.swap(true, Ordering::SeqCst) {
            return None;
        }

        // Remove from front-end tracking maps. If the entries are already gone,
        // fall back to the original atlas index stored on the lease.
        let atlas_index = {
            let mut layer_map = self.layer_to_atlas_map.lock().await;
            layer_map.remove(&self.layer_id).unwrap_or(self.atlas_index)
        };

        {
            let mut volume_map = self.layer_to_volume_map.lock().await;
            volume_map.remove(&self.layer_id);
        }

        {
            let mut timepoint_map = self.layer_to_timepoint_map.lock().await;
            timepoint_map.remove(&self.layer_id);
        }

        Some(atlas_index)
    }

    async fn release_from_service(
        &self,
        render_service: &mut RenderLoopService,
        atlas_index: u32,
        reason: &'static str,
    ) -> BridgeResult<Option<ReleaseOutcome>> {
        release_resident_image_set_allocations(
            &self.layer_id,
            &self.resident_image_sets,
            render_service,
        )
        .await;
        let removed_from_render_state = render_service
            .release_layer_resources(atlas_index)
            .map_err(|err| BridgeError::GpuError {
                code: 5080,
                details: format!("Failed to release layer {}: {err}", self.layer_id),
            })?;
        info!(
            "LayerLease({}) released atlas index {} (reason: {})",
            self.layer_id, atlas_index, reason
        );

        Ok(Some(ReleaseOutcome {
            atlas_index,
            render_state_entry_removed: removed_from_render_state,
        }))
    }

    async fn release_with_service(
        &self,
        render_service: &mut RenderLoopService,
        reason: &'static str,
    ) -> BridgeResult<Option<ReleaseOutcome>> {
        let Some(atlas_index) = self.prepare_release().await else {
            return Ok(None);
        };

        self.release_from_service(render_service, atlas_index, reason)
            .await
    }

    async fn release(&self, reason: &'static str) -> BridgeResult<Option<ReleaseOutcome>> {
        let Some(atlas_index) = self.prepare_release().await else {
            return Ok(None);
        };

        let service_option = {
            let guard = self.render_loop_service.lock().await;
            guard.clone()
        };

        let service_arc = service_option.ok_or_else(|| BridgeError::ServiceNotInitialized {
            code: 5008,
            details: format!(
                "GPU rendering service is not initialized. Cannot release layer {}.",
                self.layer_id
            ),
        })?;

        let mut render_service = service_arc.lock().await;
        self.release_from_service(&mut render_service, atlas_index, reason)
            .await
    }
}

impl Drop for LayerLease {
    fn drop(&mut self) {
        if self.inner.is_released.load(Ordering::SeqCst) {
            return;
        }

        let inner = Arc::clone(&self.inner);
        match Handle::try_current() {
            Ok(handle) => {
                handle.spawn(async move {
                    if let Err(err) = inner.release("drop").await {
                        warn!("LayerLease drop release failed: {:?}", err);
                    }
                });
            }
            Err(_) => {
                std::thread::spawn(move || {
                    if let Ok(rt) = tokio::runtime::Runtime::new() {
                        if let Err(err) = rt.block_on(inner.release("drop")) {
                            eprintln!("LayerLease drop release failed (thread): {:?}", err);
                        }
                    }
                });
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AtlasStats {
    pub total_layers: u32,
    pub used_layers: u32,
    pub free_layers: u32,
    pub allocations: u64,
    pub releases: u64,
    pub high_watermark: u32,
    pub full_events: u64,
    pub is_3d: bool,
    pub last_allocation_ms: Option<u64>,
    pub last_release_ms: Option<u64>,
}

// Helper alias for Result
// type BridgeResult<T> = Result<T, BridgeError>; // Now defined in bridge_types

// --- Helper Functions ---

/// Extract affine transform from a VolumeSendable
/// Extract a 3D affine transform from a NeuroSpace's DMatrix transform.
fn affine_from_neurospace_trans(trans: &nalgebra::DMatrix<f64>) -> Affine3<f32> {
    use nalgebra::Matrix4;
    if trans.nrows() >= 4 && trans.ncols() >= 4 {
        // The spatial translation (origin) lives in the LAST column. neuroim
        // stores an (ndim+1)-square transform: a 3D space is 4x4 with the origin
        // in column 3, but a 4D space is 5x5 with the spatial origin in column 4
        // — column 3 there holds the time-axis scaling. Reading a hardcoded
        // column 3 silently dropped the origin for every 4D volume, so the
        // crosshair time-series (`sample_stack`) and the extracted-timepoint
        // render affine sampled/rendered as if the volume sat at world origin.
        let t = trans.ncols() - 1;
        let m = Matrix4::new(
            trans[(0, 0)] as f32,
            trans[(0, 1)] as f32,
            trans[(0, 2)] as f32,
            trans[(0, t)] as f32,
            trans[(1, 0)] as f32,
            trans[(1, 1)] as f32,
            trans[(1, 2)] as f32,
            trans[(1, t)] as f32,
            trans[(2, 0)] as f32,
            trans[(2, 1)] as f32,
            trans[(2, 2)] as f32,
            trans[(2, t)] as f32,
            0.0,
            0.0,
            0.0,
            1.0,
        );
        Affine3::from_matrix_unchecked(m)
    } else {
        Affine3::identity()
    }
}

fn get_affine_from_volume(volume_data: &VolumeSendable) -> BridgeResult<Affine3<f32>> {
    match volume_data {
        // 3D volumes already have affine
        VolumeSendable::VolF32(_, affine)
        | VolumeSendable::VolI16(_, affine)
        | VolumeSendable::VolU8(_, affine)
        | VolumeSendable::VolI8(_, affine)
        | VolumeSendable::VolU16(_, affine)
        | VolumeSendable::VolI32(_, affine)
        | VolumeSendable::VolU32(_, affine)
        | VolumeSendable::VolF64(_, affine) => Ok(*affine),
        // 4D volumes - extract affine from NeuroSpace transform
        VolumeSendable::Vec4DF32(vec) => Ok(affine_from_neurospace_trans(&vec.space.trans)),
        VolumeSendable::Vec4DI16(vec) => Ok(affine_from_neurospace_trans(&vec.space.trans)),
        VolumeSendable::Vec4DU8(vec) => Ok(affine_from_neurospace_trans(&vec.space.trans)),
        VolumeSendable::Vec4DI8(vec) => Ok(affine_from_neurospace_trans(&vec.space.trans)),
        VolumeSendable::Vec4DU16(vec) => Ok(affine_from_neurospace_trans(&vec.space.trans)),
        VolumeSendable::Vec4DI32(vec) => Ok(affine_from_neurospace_trans(&vec.space.trans)),
        VolumeSendable::Vec4DU32(vec) => Ok(affine_from_neurospace_trans(&vec.space.trans)),
        VolumeSendable::Vec4DF64(vec) => Ok(affine_from_neurospace_trans(&vec.space.trans)),
    }
}

/// Get spatial dimensions (first 3 dimensions) from a VolumeSendable
fn get_spatial_dims_from_volume(volume_data: &VolumeSendable) -> Vec<usize> {
    match volume_data {
        // 3D volumes
        VolumeSendable::VolF32(vol, _) => vol.space().dims().to_vec(),
        VolumeSendable::VolI16(vol, _) => vol.space().dims().to_vec(),
        VolumeSendable::VolU8(vol, _) => vol.space().dims().to_vec(),
        VolumeSendable::VolI8(vol, _) => vol.space().dims().to_vec(),
        VolumeSendable::VolU16(vol, _) => vol.space().dims().to_vec(),
        VolumeSendable::VolI32(vol, _) => vol.space().dims().to_vec(),
        VolumeSendable::VolU32(vol, _) => vol.space().dims().to_vec(),
        VolumeSendable::VolF64(vol, _) => vol.space().dims().to_vec(),
        // 4D volumes - return first 3 dimensions
        VolumeSendable::Vec4DF32(vec) => vec.space.dim.iter().take(3).copied().collect(),
        VolumeSendable::Vec4DI16(vec) => vec.space.dim.iter().take(3).copied().collect(),
        VolumeSendable::Vec4DU8(vec) => vec.space.dim.iter().take(3).copied().collect(),
        VolumeSendable::Vec4DI8(vec) => vec.space.dim.iter().take(3).copied().collect(),
        VolumeSendable::Vec4DU16(vec) => vec.space.dim.iter().take(3).copied().collect(),
        VolumeSendable::Vec4DI32(vec) => vec.space.dim.iter().take(3).copied().collect(),
        VolumeSendable::Vec4DU32(vec) => vec.space.dim.iter().take(3).copied().collect(),
        VolumeSendable::Vec4DF64(vec) => vec.space.dim.iter().take(3).copied().collect(),
    }
}

/// Compute min/max data range for a volume payload.
/// Used as a fallback when render metadata is unavailable.
fn compute_data_range_from_volume(volume_data: &VolumeSendable) -> (f32, f32) {
    match volume_data {
        VolumeSendable::VolF32(vol, _) => vol.range().unwrap_or((0.0, 1.0)),
        VolumeSendable::VolI16(vol, _) => vol
            .range()
            .map(|(min, max)| (min as f32, max as f32))
            .unwrap_or((0.0, 1.0)),
        VolumeSendable::VolU8(vol, _) => vol
            .range()
            .map(|(min, max)| (min as f32, max as f32))
            .unwrap_or((0.0, 1.0)),
        VolumeSendable::VolI8(vol, _) => vol
            .range()
            .map(|(min, max)| (min as f32, max as f32))
            .unwrap_or((0.0, 1.0)),
        VolumeSendable::VolU16(vol, _) => vol
            .range()
            .map(|(min, max)| (min as f32, max as f32))
            .unwrap_or((0.0, 1.0)),
        VolumeSendable::VolI32(vol, _) => vol
            .range()
            .map(|(min, max)| (min as f32, max as f32))
            .unwrap_or((0.0, 1.0)),
        VolumeSendable::VolU32(vol, _) => vol
            .range()
            .map(|(min, max)| (min as f32, max as f32))
            .unwrap_or((0.0, 1.0)),
        VolumeSendable::VolF64(vol, _) => vol
            .range()
            .map(|(min, max)| (min as f32, max as f32))
            .unwrap_or((0.0, 1.0)),
        VolumeSendable::Vec4DF32(vec) => {
            let mut min = f32::MAX;
            let mut max = f32::MIN;
            for &value in vec.data.iter() {
                if value.is_finite() {
                    min = min.min(value);
                    max = max.max(value);
                }
            }
            if min > max {
                (0.0, 1.0)
            } else {
                (min, max)
            }
        }
        VolumeSendable::Vec4DI16(vec) => {
            let mut min = f32::MAX;
            let mut max = f32::MIN;
            for &value in vec.data.iter() {
                let value = value as f32;
                min = min.min(value);
                max = max.max(value);
            }
            if min > max {
                (0.0, 1.0)
            } else {
                (min, max)
            }
        }
        VolumeSendable::Vec4DU8(vec) => {
            let mut min = f32::MAX;
            let mut max = f32::MIN;
            for &value in vec.data.iter() {
                let value = value as f32;
                min = min.min(value);
                max = max.max(value);
            }
            if min > max {
                (0.0, 1.0)
            } else {
                (min, max)
            }
        }
        VolumeSendable::Vec4DI8(vec) => {
            let mut min = f32::MAX;
            let mut max = f32::MIN;
            for &value in vec.data.iter() {
                let value = value as f32;
                min = min.min(value);
                max = max.max(value);
            }
            if min > max {
                (0.0, 1.0)
            } else {
                (min, max)
            }
        }
        VolumeSendable::Vec4DU16(vec) => {
            let mut min = f32::MAX;
            let mut max = f32::MIN;
            for &value in vec.data.iter() {
                let value = value as f32;
                min = min.min(value);
                max = max.max(value);
            }
            if min > max {
                (0.0, 1.0)
            } else {
                (min, max)
            }
        }
        VolumeSendable::Vec4DI32(vec) => {
            let mut min = f32::MAX;
            let mut max = f32::MIN;
            for &value in vec.data.iter() {
                let value = value as f32;
                min = min.min(value);
                max = max.max(value);
            }
            if min > max {
                (0.0, 1.0)
            } else {
                (min, max)
            }
        }
        VolumeSendable::Vec4DU32(vec) => {
            let mut min = f32::MAX;
            let mut max = f32::MIN;
            for &value in vec.data.iter() {
                let value = value as f32;
                min = min.min(value);
                max = max.max(value);
            }
            if min > max {
                (0.0, 1.0)
            } else {
                (min, max)
            }
        }
        VolumeSendable::Vec4DF64(vec) => {
            let mut min = f32::MAX;
            let mut max = f32::MIN;
            for &value in vec.data.iter() {
                let value = value as f32;
                if value.is_finite() {
                    min = min.min(value);
                    max = max.max(value);
                }
            }
            if min > max {
                (0.0, 1.0)
            } else {
                (min, max)
            }
        }
    }
}

/// Convert world coordinates to grid coordinates
#[allow(dead_code)]
fn coord_to_grid_for_volume(
    volume_data: &VolumeSendable,
    coords: &Vec<Vec<f64>>,
) -> Result<Vec<Vec<i32>>, String> {
    fn ensure_4d_coords(
        coords: &Vec<Vec<f64>>,
        target_dims: usize,
    ) -> Result<Vec<Vec<f64>>, String> {
        let mut adapted = Vec::with_capacity(coords.len());
        for coord in coords {
            match coord.len() {
                len if len == target_dims => adapted.push(coord.clone()),
                3 if target_dims == 4 => {
                    let mut extended = coord.clone();
                    extended.push(0.0);
                    adapted.push(extended);
                }
                other => {
                    return Err(format!(
                        "Coordinates must have {} dimensions (received {} values)",
                        target_dims, other
                    ));
                }
            }
        }
        Ok(adapted)
    }

    match volume_data {
        // 3D volumes
        VolumeSendable::VolF32(vol, _) => {
            vol.space().coord_to_grid(coords).map_err(|e| e.to_string())
        }
        VolumeSendable::VolI16(vol, _) => {
            vol.space().coord_to_grid(coords).map_err(|e| e.to_string())
        }
        VolumeSendable::VolU8(vol, _) => {
            vol.space().coord_to_grid(coords).map_err(|e| e.to_string())
        }
        VolumeSendable::VolI8(vol, _) => {
            vol.space().coord_to_grid(coords).map_err(|e| e.to_string())
        }
        VolumeSendable::VolU16(vol, _) => {
            vol.space().coord_to_grid(coords).map_err(|e| e.to_string())
        }
        VolumeSendable::VolI32(vol, _) => {
            vol.space().coord_to_grid(coords).map_err(|e| e.to_string())
        }
        VolumeSendable::VolU32(vol, _) => {
            vol.space().coord_to_grid(coords).map_err(|e| e.to_string())
        }
        VolumeSendable::VolF64(vol, _) => {
            vol.space().coord_to_grid(coords).map_err(|e| e.to_string())
        }
        // 4D volumes - use only spatial dimensions
        VolumeSendable::Vec4DF32(vec) => {
            let prepared = ensure_4d_coords(coords, vec.space.ndim())
                .map_err(|e| format!("Invalid 4D coordinate: {e}"))?;
            vec.space
                .coord_to_grid(&prepared)
                .map_err(|e| e.to_string())
        }
        VolumeSendable::Vec4DI16(vec) => {
            let prepared = ensure_4d_coords(coords, vec.space.ndim())
                .map_err(|e| format!("Invalid 4D coordinate: {e}"))?;
            vec.space
                .coord_to_grid(&prepared)
                .map_err(|e| e.to_string())
        }
        VolumeSendable::Vec4DU8(vec) => {
            let prepared = ensure_4d_coords(coords, vec.space.ndim())
                .map_err(|e| format!("Invalid 4D coordinate: {e}"))?;
            vec.space
                .coord_to_grid(&prepared)
                .map_err(|e| e.to_string())
        }
        VolumeSendable::Vec4DI8(vec) => {
            let prepared = ensure_4d_coords(coords, vec.space.ndim())
                .map_err(|e| format!("Invalid 4D coordinate: {e}"))?;
            vec.space
                .coord_to_grid(&prepared)
                .map_err(|e| e.to_string())
        }
        VolumeSendable::Vec4DU16(vec) => {
            let prepared = ensure_4d_coords(coords, vec.space.ndim())
                .map_err(|e| format!("Invalid 4D coordinate: {e}"))?;
            vec.space
                .coord_to_grid(&prepared)
                .map_err(|e| e.to_string())
        }
        VolumeSendable::Vec4DI32(vec) => {
            let prepared = ensure_4d_coords(coords, vec.space.ndim())
                .map_err(|e| format!("Invalid 4D coordinate: {e}"))?;
            vec.space
                .coord_to_grid(&prepared)
                .map_err(|e| e.to_string())
        }
        VolumeSendable::Vec4DU32(vec) => {
            let prepared = ensure_4d_coords(coords, vec.space.ndim())
                .map_err(|e| format!("Invalid 4D coordinate: {e}"))?;
            vec.space
                .coord_to_grid(&prepared)
                .map_err(|e| e.to_string())
        }
        VolumeSendable::Vec4DF64(vec) => {
            let prepared = ensure_4d_coords(coords, vec.space.ndim())
                .map_err(|e| format!("Invalid 4D coordinate: {e}"))?;
            vec.space
                .coord_to_grid(&prepared)
                .map_err(|e| e.to_string())
        }
    }
}

/// Extract a single 3D volume from a 4D time series at a specific timepoint
pub(crate) fn extract_3d_volume_at_timepoint(
    volume_4d: &VolumeSendable,
    timepoint: usize,
) -> BridgeResult<VolumeSendable> {
    match volume_4d {
        // For 3D volumes, just return as-is (ignore timepoint)
        VolumeSendable::VolF32(vol, affine) => Ok(VolumeSendable::VolF32(vol.clone(), *affine)),
        VolumeSendable::VolI16(vol, affine) => Ok(VolumeSendable::VolI16(vol.clone(), *affine)),
        VolumeSendable::VolU8(vol, affine) => Ok(VolumeSendable::VolU8(vol.clone(), *affine)),
        VolumeSendable::VolI8(vol, affine) => Ok(VolumeSendable::VolI8(vol.clone(), *affine)),
        VolumeSendable::VolU16(vol, affine) => Ok(VolumeSendable::VolU16(vol.clone(), *affine)),
        VolumeSendable::VolI32(vol, affine) => Ok(VolumeSendable::VolI32(vol.clone(), *affine)),
        VolumeSendable::VolU32(vol, affine) => Ok(VolumeSendable::VolU32(vol.clone(), *affine)),
        VolumeSendable::VolF64(vol, affine) => Ok(VolumeSendable::VolF64(vol.clone(), *affine)),

        // For 4D volumes, extract the requested timepoint
        VolumeSendable::Vec4DF32(vec) => {
            let neuro_vol = vec.volume(timepoint).map_err(|e| BridgeError::Internal {
                code: 5011,
                details: format!("Failed to extract timepoint {}: {}", timepoint, e),
            })?;
            let dense_vol = DenseVolume3::new(neuro_vol);
            let affine = affine_from_neurospace_trans(&vec.space.trans);
            Ok(VolumeSendable::VolF32(dense_vol, affine))
        }
        VolumeSendable::Vec4DI16(vec) => {
            let neuro_vol = vec.volume(timepoint).map_err(|e| BridgeError::Internal {
                code: 5011,
                details: format!("Failed to extract timepoint {}: {}", timepoint, e),
            })?;
            let dense_vol = DenseVolume3::new(neuro_vol);
            let affine = affine_from_neurospace_trans(&vec.space.trans);
            Ok(VolumeSendable::VolI16(dense_vol, affine))
        }
        VolumeSendable::Vec4DU8(vec) => {
            let neuro_vol = vec.volume(timepoint).map_err(|e| BridgeError::Internal {
                code: 5011,
                details: format!("Failed to extract timepoint {}: {}", timepoint, e),
            })?;
            let dense_vol = DenseVolume3::new(neuro_vol);
            let affine = affine_from_neurospace_trans(&vec.space.trans);
            Ok(VolumeSendable::VolU8(dense_vol, affine))
        }
        VolumeSendable::Vec4DI8(vec) => {
            let neuro_vol = vec.volume(timepoint).map_err(|e| BridgeError::Internal {
                code: 5011,
                details: format!("Failed to extract timepoint {}: {}", timepoint, e),
            })?;
            let dense_vol = DenseVolume3::new(neuro_vol);
            let affine = affine_from_neurospace_trans(&vec.space.trans);
            Ok(VolumeSendable::VolI8(dense_vol, affine))
        }
        VolumeSendable::Vec4DU16(vec) => {
            let neuro_vol = vec.volume(timepoint).map_err(|e| BridgeError::Internal {
                code: 5011,
                details: format!("Failed to extract timepoint {}: {}", timepoint, e),
            })?;
            let dense_vol = DenseVolume3::new(neuro_vol);
            let affine = affine_from_neurospace_trans(&vec.space.trans);
            Ok(VolumeSendable::VolU16(dense_vol, affine))
        }
        VolumeSendable::Vec4DI32(vec) => {
            let neuro_vol = vec.volume(timepoint).map_err(|e| BridgeError::Internal {
                code: 5011,
                details: format!("Failed to extract timepoint {}: {}", timepoint, e),
            })?;
            let dense_vol = DenseVolume3::new(neuro_vol);
            let affine = affine_from_neurospace_trans(&vec.space.trans);
            Ok(VolumeSendable::VolI32(dense_vol, affine))
        }
        VolumeSendable::Vec4DU32(vec) => {
            let neuro_vol = vec.volume(timepoint).map_err(|e| BridgeError::Internal {
                code: 5011,
                details: format!("Failed to extract timepoint {}: {}", timepoint, e),
            })?;
            let dense_vol = DenseVolume3::new(neuro_vol);
            let affine = affine_from_neurospace_trans(&vec.space.trans);
            Ok(VolumeSendable::VolU32(dense_vol, affine))
        }
        VolumeSendable::Vec4DF64(vec) => {
            let neuro_vol = vec.volume(timepoint).map_err(|e| BridgeError::Internal {
                code: 5011,
                details: format!("Failed to extract timepoint {}: {}", timepoint, e),
            })?;
            let dense_vol = DenseVolume3::new(neuro_vol);
            let affine = affine_from_neurospace_trans(&vec.space.trans);
            Ok(VolumeSendable::VolF64(dense_vol, affine))
        }
    }
}

/// Calculate the actual slice index from a SliceIndex specification
pub fn calculate_slice_index(
    slice_spec: &SliceIndex,
    vol_dims: &[usize],
    axis: SliceAxis,
    volume_data: &VolumeSendable,
) -> BridgeResult<usize> {
    let axis_idx = axis as usize;
    let max_index = vol_dims[axis_idx];

    if max_index == 0 {
        return Err(BridgeError::Input {
            code: 2002,
            details: format!(
                "Volume has zero size along {} axis. The volume may be corrupted or improperly loaded.",
                match axis {
                    SliceAxis::Axial => "Z (axial)",
                    SliceAxis::Coronal => "Y (coronal)",
                    SliceAxis::Sagittal => "X (sagittal)",
                }
            ),
        });
    }

    let slice_idx = match slice_spec {
        SliceIndex::Fixed(idx) => {
            if *idx >= max_index {
                return Err(BridgeError::Input {
                    code: 2003,
                    details: format!(
                        "Slice index {} is out of bounds for {} axis. Valid range is 0-{} for this volume.",
                        idx,
                        match axis {
                            SliceAxis::Axial => "axial",
                            SliceAxis::Coronal => "coronal",
                            SliceAxis::Sagittal => "sagittal",
                        },
                        max_index - 1
                    ),
                });
            }
            *idx
        }
        SliceIndex::Middle => max_index / 2,
        SliceIndex::Relative(position) => {
            if *position < 0.0 || *position > 1.0 {
                return Err(BridgeError::Input {
                    code: 2004,
                    details: format!(
                        "Relative slice position {} is invalid. Please provide a value between 0.0 (first slice) and 1.0 (last slice).",
                        position
                    ),
                });
            }
            ((max_index - 1) as f32 * position) as usize
        }
        SliceIndex::WorldCoordinate(world_coord) => {
            // Convert world coordinate to voxel index
            let voxel_coord = world_to_voxel_coord(world_coord, axis, volume_data)?;
            if voxel_coord >= max_index {
                return Err(BridgeError::Input {
                    code: 2005,
                    details: format!(
                        "World coordinate {} mm is outside the volume bounds for {} axis. The coordinate maps to voxel index {}, but valid range is 0-{}.",
                        world_coord,
                        match axis {
                            SliceAxis::Axial => "axial",
                            SliceAxis::Coronal => "coronal",
                            SliceAxis::Sagittal => "sagittal",
                        },
                        voxel_coord,
                        max_index - 1
                    ),
                });
            }
            voxel_coord
        }
    };

    Ok(slice_idx)
}

/// Convert world coordinate to voxel index for a specific axis
fn world_to_voxel_coord(
    world_coord: &f32,
    axis: SliceAxis,
    volume_data: &VolumeSendable,
) -> BridgeResult<usize> {
    // Get the affine transform
    let affine = get_affine_from_volume(volume_data)?;

    // Get world_to_voxel matrix (inverse of voxel_to_world)
    let voxel_to_world = affine.to_homogeneous();
    let world_to_voxel = voxel_to_world.try_inverse()
        .ok_or_else(|| BridgeError::Internal {
            code: 5007,
            details: "Failed to invert affine transformation matrix. The volume's coordinate system may be corrupted.".to_string()
        })?;

    // Create a world point with the coordinate on the specified axis
    let mut world_point = nalgebra::Vector4::new(0.0, 0.0, 0.0, 1.0);
    world_point[axis as usize] = *world_coord;

    // Transform to voxel space
    let voxel_point = world_to_voxel * world_point;
    let voxel_coord = voxel_point[axis as usize] / voxel_point[3];

    // Round to nearest voxel
    Ok(voxel_coord.round() as usize)
}

// --- Loader Trait ---

// Use a type alias for the boxed trait object
// pub type BoxedLoader = Box<dyn Loader + Send + Sync>;

// --- Loader Registry ---

// Removed LoaderRegistry struct definition
// Removed LoaderRegistry impl block

// --- Enhanced Volume Registry for 4D Support ---

/// Stores volume data with timepoint tracking for 4D volumes
#[derive(Debug, Clone)]
pub struct VolumeEntry {
    /// The actual volume data (3D or 4D).
    /// Stored behind an `Arc` so consumers (histogram, stats, GPU upload) can
    /// cheaply share the volume and drop the registry lock before doing heavy
    /// work, instead of deep-copying ~tens of MB per access.
    pub data: Arc<VolumeSendable>,
    /// Current timepoint for 4D volumes (None for 3D)
    pub current_timepoint: Option<usize>,
    /// Metadata about the volume
    pub metadata: VolumeMetadataInfo,
}

/// Enhanced metadata for volumes
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VolumeMetadataInfo {
    pub name: String,
    pub path: String,
    pub dtype: String,
    pub volume_type: bridge_types::VolumeType,
    pub time_series_info: Option<bridge_types::TimeSeriesInfo>,
}

/// Compute the expected neuroatlas cache directory used for atlas NIfTI files.
fn neuroatlas_cache_dir() -> std::path::PathBuf {
    if let Some(proj_dirs) = ProjectDirs::from("", "", "neuroatlas") {
        proj_dirs.cache_dir().to_path_buf()
    } else {
        std::path::PathBuf::from(".cache/neuroatlas")
    }
}

/// Derive the on-disk NIfTI path for a given atlas configuration, matching neuroatlas' layout.
fn get_neuroatlas_nifti_path(config: &AtlasConfig) -> Result<std::path::PathBuf, String> {
    let cache_dir = neuroatlas_cache_dir();

    match config.atlas_id.as_str() {
        "schaefer2018" => {
            let networks = config.networks.unwrap_or(7);
            let parcels = config.parcels.unwrap_or(400);

            let resolution = match config.resolution.as_str() {
                "1mm" | "2mm" => config.resolution.as_str(),
                other => return Err(format!("Unsupported Schaefer resolution '{}'", other)),
            };

            let filename = format!(
                "Schaefer2018_{}Parcels_{}Networks_order_FSLMNI152_{}",
                parcels, networks, resolution
            );

            let primary = cache_dir.join(format!("{}.nii", filename));
            if primary.exists() {
                return Ok(primary);
            }

            let gz = cache_dir.join(format!("{}.nii.gz", filename));
            if gz.exists() {
                return Ok(gz);
            }

            Err(format!(
                "Schaefer atlas NIfTI not found in neuroatlas cache for parcels={} networks={} resolution={}.\n\
Expected one of:\n  - {}\n  - {}",
                parcels,
                networks,
                resolution,
                primary.display(),
                gz.display()
            ))
        }
        "glasser2016" => Ok(cache_dir.join("glasser/glasser360MNI.nii")),
        "freesurfer_aseg" => Ok(cache_dir.join("aseg/atlas_aparc_aseg_prob33.nii")),
        "olsen_mtl" => Ok(cache_dir.join("olsen_mtl/Olsen_MNI_MTL_prob33.nii")),
        other => Err(format!("Unknown atlas id '{}'", other)),
    }
}

/// Registry that manages both 3D and 4D volumes with timepoint tracking
#[derive(Debug)]
pub struct VolumeRegistry {
    volumes: HashMap<String, VolumeEntry>,
    parcel_dictionaries: HashMap<String, atlases::parcel_dictionary::ParcelDictionary>,
    parcel_overlays: HashMap<String, parcel_overlay::ParcelOverlay>,
}

impl Default for VolumeRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl VolumeRegistry {
    pub fn new() -> Self {
        Self {
            volumes: HashMap::new(),
            parcel_dictionaries: HashMap::new(),
            parcel_overlays: HashMap::new(),
        }
    }

    /// Insert a new volume into the registry
    pub fn insert(&mut self, id: String, data: VolumeSendable, metadata: VolumeMetadataInfo) {
        let current_timepoint = if metadata.volume_type == bridge_types::VolumeType::TimeSeries4D {
            Some(0) // Start at first timepoint
        } else {
            None
        };

        self.volumes.insert(
            id,
            VolumeEntry {
                data: Arc::new(data),
                current_timepoint,
                metadata,
            },
        );
    }

    /// Get a volume by ID (returns the current timepoint for 4D)
    pub fn get(&self, id: &str) -> Option<&VolumeSendable> {
        self.volumes.get(id).map(|entry| entry.data.as_ref())
    }

    /// Get a shared (`Arc`) handle to a volume by ID. Cloning the returned
    /// handle is cheap, so callers can take it, drop the registry lock, and do
    /// heavy work (histogram, stats, conversion) without holding the lock or
    /// deep-copying the volume.
    pub fn get_arc(&self, id: &str) -> Option<Arc<VolumeSendable>> {
        self.volumes.get(id).map(|entry| Arc::clone(&entry.data))
    }

    /// Render uploads retain exact atlas codes; CPU readers see statistics.
    fn get_render_arc(&self, id: &str) -> Option<Arc<VolumeSendable>> {
        self.parcel_overlays
            .get(id)
            .map(|overlay| Arc::clone(&overlay.geometry))
            .or_else(|| self.get_arc(id))
    }

    /// Get a volume entry with all metadata
    pub fn get_entry(&self, id: &str) -> Option<&VolumeEntry> {
        self.volumes.get(id)
    }

    /// Set the current timepoint for a 4D volume
    pub fn set_timepoint(&mut self, id: &str, timepoint: usize) -> BridgeResult<()> {
        let entry = self
            .volumes
            .get_mut(id)
            .ok_or_else(|| BridgeError::VolumeNotFound {
                code: 4041,
                details: format!("Volume {} not found", id),
            })?;

        if entry.metadata.volume_type != bridge_types::VolumeType::TimeSeries4D {
            return Err(BridgeError::Input {
                code: 2006,
                details: "Cannot set timepoint on a 3D volume".to_string(),
            });
        }

        // Validate timepoint
        if let Some(ts_info) = &entry.metadata.time_series_info {
            if timepoint >= ts_info.num_timepoints {
                return Err(BridgeError::Input {
                    code: 2007,
                    details: format!(
                        "Timepoint {} out of range. Valid range: 0-{}",
                        timepoint,
                        ts_info.num_timepoints - 1
                    ),
                });
            }
        }

        entry.current_timepoint = Some(timepoint);
        Ok(())
    }

    /// Get the current timepoint for a 4D volume
    pub fn get_timepoint(&self, id: &str) -> Option<usize> {
        self.volumes
            .get(id)
            .and_then(|entry| entry.current_timepoint)
    }

    /// Remove a volume from the registry
    pub fn remove(&mut self, id: &str) -> Option<VolumeEntry> {
        self.parcel_dictionaries.remove(id);
        self.parcel_overlays.remove(id);
        self.volumes.remove(id)
    }

    /// Check if a volume exists
    pub fn contains(&self, id: &str) -> bool {
        self.volumes.contains_key(id)
    }

    /// Get all volume IDs
    pub fn keys(&self) -> impl Iterator<Item = &String> {
        self.volumes.keys()
    }
}

// --- Surface Registry for GIFTI Support ---

/// Stores surface geometry data
#[derive(Debug)]
pub struct SurfaceEntry {
    /// The surface geometry from neurosurf-rs
    pub geometry: neurosurf_rs::geometry::SurfaceGeometry,
    /// Transformation matrix
    pub transform: Affine3<f32>,
    /// Metadata about the surface
    pub metadata: SurfaceMetadataInfo,
}

/// Metadata for surfaces
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SurfaceMetadataInfo {
    pub name: String,
    pub path: String,
    pub hemisphere: Option<String>,
    pub surface_type: Option<String>,
    pub vertex_count: usize,
    pub face_count: usize,
}

/// Registry that manages surface geometries and data
#[derive(Debug)]
pub struct SurfaceRegistry {
    surfaces: HashMap<String, SurfaceEntry>,
    surface_data: HashMap<String, Vec<f64>>,
}

impl Default for SurfaceRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl SurfaceRegistry {
    pub fn new() -> Self {
        Self {
            surfaces: HashMap::new(),
            surface_data: HashMap::new(),
        }
    }

    /// Insert a new surface into the registry
    pub fn insert_surface(
        &mut self,
        id: String,
        geometry: neurosurf_rs::geometry::SurfaceGeometry,
        transform: Affine3<f32>,
        metadata: SurfaceMetadataInfo,
    ) {
        self.surfaces.insert(
            id,
            SurfaceEntry {
                geometry,
                transform,
                metadata,
            },
        );
    }

    /// Insert surface data into the registry
    pub fn insert_data(&mut self, id: String, data: Vec<f64>) {
        self.surface_data.insert(id, data);
    }

    /// Get a surface by ID
    pub fn get_surface(&self, id: &str) -> Option<&SurfaceEntry> {
        self.surfaces.get(id)
    }

    /// Get surface data by ID
    pub fn get_data(&self, id: &str) -> Option<&Vec<f64>> {
        self.surface_data.get(id)
    }

    /// Remove a surface from the registry
    pub fn remove_surface(&mut self, id: &str) -> Option<SurfaceEntry> {
        self.surfaces.remove(id)
    }

    /// Remove surface data from the registry
    pub fn remove_data(&mut self, id: &str) -> Option<Vec<f64>> {
        self.surface_data.remove(id)
    }

    /// Remove all overlay datasets associated with a surface handle.
    pub fn remove_data_for_surface(&mut self, surface_id: &str) -> usize {
        let prefix = format!("overlay_{}_", surface_id);
        let projection_prefix = format!("vol2surf_{}_", surface_id);
        let keys: Vec<String> = self
            .surface_data
            .keys()
            .filter(|key| key.starts_with(&prefix) || key.starts_with(&projection_prefix))
            .cloned()
            .collect();

        let removed_count = keys.len();
        for key in keys {
            self.surface_data.remove(&key);
        }

        removed_count
    }

    /// Check if a surface exists
    pub fn contains_surface(&self, id: &str) -> bool {
        self.surfaces.contains_key(id)
    }

    /// Check if surface data exists
    pub fn contains_data(&self, id: &str) -> bool {
        self.surface_data.contains_key(id)
    }
}

const REMOTE_KEYRING_SERVICE: &str = "brainflow.remote_mount";
const REMOTE_PROFILE_FILE: &str = "remote_mount_profiles.json";
const REMOTE_CACHE_DIR_NAME: &str = "remote_mounts";
const REMOTE_CACHE_METADATA_DIR_NAME: &str = ".metadata";
const REMOTE_MOUNT_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(45);
const REMOTE_FS_OPERATION_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone)]
struct NormalizedRemoteMountRequest {
    host: String,
    port: u16,
    user: String,
    remote_path: String,
    auth_method: String,
    password: Option<String>,
    key_path: Option<String>,
    key_passphrase: Option<String>,
    verify_host_key: bool,
    accept_unknown_host_keys: bool,
    known_hosts_path: Option<PathBuf>,
    remember_password: bool,
    save_profile: bool,
    profile_name: Option<String>,
}

#[derive(Debug, Clone)]
struct PendingRemoteMountContext {
    request: NormalizedRemoteMountRequest,
}

#[derive(Debug, Clone, Serialize)]
struct RemoteMountRecoveryEvent {
    mount_id: String,
    origin_label: String,
    attempt: usize,
    reason: String,
}

/// Max concurrent SFTP operations per remote mount. Each remote list/stat/
/// download opens its own SFTP channel (`remotely` builds a fresh `RemoteFs`
/// per op), and SSH servers cap concurrent channels (OpenSSH `MaxSessions`,
/// commonly ~10). We bound concurrency well below that so a burst of listings
/// — e.g. hover-prefetch plus user clicks — can never exhaust the channel
/// limit and fail with "Failed to open channel (ConnectFailed)".
const REMOTE_MOUNT_MAX_CONCURRENT_OPS: usize = 4;

#[derive(Clone)]
struct RemoteMountEntry {
    mount_id: String,
    local_root: PathBuf,
    remote_root: String,
    display_name: String,
    origin_label: String,
    host: String,
    port: u16,
    user: String,
    client: Arc<RemoteClient>,
    /// Per-mount gate bounding concurrent SFTP channel opens. Shared across all
    /// clones of this entry (it's an `Arc`), so every command touching this
    /// mount contends on the same permits.
    op_semaphore: Arc<tokio::sync::Semaphore>,
    transfers: Arc<remote_transfer::Control>,
    progress: Arc<dyn Fn(remote_transfer::Progress) + Send + Sync>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct RemoteFileCacheMetadata {
    version: u8,
    mount_id: String,
    host: String,
    port: u16,
    user: String,
    remote_path: String,
    remote_size: u64,
    remote_modified_unix_secs: Option<u64>,
}

// --- Define App State to hold the registry ---
// This might conflict/need merging with AppState in src-tauri/lib.rs later
// Several fields hold internal-only types (LayerLease, RemoteMountEntry,
// PendingRemoteMountContext) that are intentionally not part of the public API.
#[allow(private_interfaces)]
pub struct BridgeState {
    // Small content-addressed dictionary cache, independent of mesh/GPU lifetimes.
    // Bound to 64 variants; eviction only expires future import previews, never overlays.
    pub surface_parcel_dictionaries: Arc<
        Mutex<std::collections::VecDeque<(String, atlases::parcel_dictionary::ParcelDictionary)>>,
    >,
    // Removed: pub loader_registry: Arc<Mutex<LoaderRegistry>>,
    pub volume_registry: Arc<Mutex<VolumeRegistry>>,
    pub surface_registry: Arc<Mutex<SurfaceRegistry>>,
    pub render_loop_service: Arc<Mutex<Option<Arc<Mutex<RenderLoopService>>>>>,
    // NEW: Map UI layer ID to GPU texture atlas layer index
    pub layer_to_atlas_map: Arc<Mutex<HashMap<String, u32>>>,
    // Map UI layer ID to volume handle
    pub layer_to_volume_map: Arc<Mutex<HashMap<String, String>>>,
    // Map UI layer ID to the timepoint currently uploaded into the atlas slot.
    pub layer_to_timepoint_map: Arc<Mutex<HashMap<String, Option<usize>>>>,
    // Arc owns the lease itself: dropping a watchdog snapshot must not run
    // LayerLease::drop while the registry still owns the live allocation.
    pub layer_leases: Arc<Mutex<HashMap<String, Arc<LayerLease>>>>,
    // Atlas service for brain atlas management
    pub atlas_service: Arc<Mutex<AtlasService>>,
    // Template service for brain template management
    pub template_service: Arc<Mutex<templates::TemplateService>>,
    // Analysis registry and running jobs
    pub analysis_registry: Arc<Mutex<analysis::AnalysisRegistry>>,
    pub analysis_jobs: Arc<Mutex<analysis::AnalysisJobManager>>,
    pub set_studio_materialization_jobs:
        Arc<Mutex<materialization::StudioMaterializationJobManager>>,
    // Active remote mounts keyed by mount_id.
    pub remote_mounts: Arc<Mutex<HashMap<String, RemoteMountEntry>>>,
    // Pending host-key prompt context keyed by challenge UUID.
    pub pending_remote_host_key: Arc<Mutex<HashMap<uuid::Uuid, PendingRemoteMountContext>>>,
    // Pending keyboard-interactive context keyed by conversation UUID.
    pub pending_remote_auth: Arc<Mutex<HashMap<uuid::Uuid, PendingRemoteMountContext>>>,
    // CPU-only path-keyed cache for Set-Studio cohort sampling. Keeps member
    // NIfTIs loaded across repeated crosshair moves without ever registering
    // them into the GPU VolumeRegistry/atlas (avoids AtlasPressureMonitor thrash
    // for large cohorts).
    // Byte-bounded decoded payloads; source snapshot identity is retained for plots.
    pub set_sample_cache: set_sample_cache::SetSampleCache,
    population_sampling: population_sampling::PopulationSampling,
    // Precomputed volume->surface samplers keyed by sampler handle (vol2surf M5).
    // Built once per (surface, template grid); reused across timepoints/volumes.
    pub surface_samplers: Arc<Mutex<HashMap<String, SurfaceSamplerEntry>>>,
    // Per-layer GPU-resident image-set rings (flagship). Each keeps several
    // co-registered members (timepoints / subjects / contrasts / conditions)
    // uploaded at once so a member change is a `texture_index` swap instead of a
    // CPU extract + full GPU re-upload. Keyed by UI layer id; absent => no ring.
    pub resident_image_sets: Arc<Mutex<HashMap<String, image_set::ResidentImageSet>>>,
}

impl BridgeState {
    pub fn new(
        // Removed loader_registry parameter
        volume_registry: Arc<Mutex<VolumeRegistry>>,
        surface_registry: Arc<Mutex<SurfaceRegistry>>,
        render_loop_service: Arc<Mutex<Option<Arc<Mutex<RenderLoopService>>>>>,
        layer_to_atlas_map: Arc<Mutex<HashMap<String, u32>>>,
        layer_to_volume_map: Arc<Mutex<HashMap<String, String>>>,
        atlas_service: Arc<Mutex<AtlasService>>,
        template_service: Arc<Mutex<templates::TemplateService>>,
    ) -> Self {
        Self {
            surface_parcel_dictionaries: Arc::new(Mutex::new(std::collections::VecDeque::new())),
            /* Removed loader_registry field */ volume_registry,
            surface_registry,
            render_loop_service,
            layer_to_atlas_map,
            layer_to_volume_map,
            layer_to_timepoint_map: Arc::new(Mutex::new(HashMap::new())),
            layer_leases: Arc::new(Mutex::new(HashMap::new())),
            atlas_service,
            template_service,
            analysis_registry: Arc::new(Mutex::new(analysis::build_default_registry())),
            analysis_jobs: Arc::new(Mutex::new(analysis::AnalysisJobManager::new())),
            set_studio_materialization_jobs: Arc::new(Mutex::new(
                materialization::StudioMaterializationJobManager::new(),
            )),
            remote_mounts: Arc::new(Mutex::new(HashMap::new())),
            pending_remote_host_key: Arc::new(Mutex::new(HashMap::new())),
            pending_remote_auth: Arc::new(Mutex::new(HashMap::new())),
            set_sample_cache: set_sample_cache::SetSampleCache::default(),
            population_sampling: population_sampling::PopulationSampling::default(),
            surface_samplers: Arc::new(Mutex::new(HashMap::new())),
            resident_image_sets: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    // Fallible constructor; intentionally not the std `Default` trait (returns Result).
    #[allow(clippy::should_implement_trait)]
    pub fn default() -> Result<Self, String> {
        Self::with_cache_dir(std::env::temp_dir().join("brainflow_atlas_cache"))
    }

    /// Construct the registries once, using the application's cache directory.
    pub fn with_cache_dir(cache_dir: PathBuf) -> Result<Self, String> {
        let atlas_service = AtlasService::new(cache_dir.clone())
            .map_err(|e| format!("Failed to initialize atlas service: {e}"))?;
        let template_service = templates::TemplateService::new(cache_dir)
            .map_err(|e| format!("Failed to initialize template service: {e}"))?;
        Ok(Self::new(
            Arc::new(Mutex::new(VolumeRegistry::new())),
            Arc::new(Mutex::new(SurfaceRegistry::new())),
            Arc::new(Mutex::new(None)),
            Arc::new(Mutex::new(HashMap::new())),
            Arc::new(Mutex::new(HashMap::new())),
            Arc::new(Mutex::new(atlas_service)),
            Arc::new(Mutex::new(template_service)),
        ))
    }

    /// Shared by desktop warmup and the frontend command. A visible slot always
    /// contains a fully initialized renderer; failures leave it empty for retry.
    pub async fn ensure_render_loop(&self) -> BridgeResult<()> {
        render_lifecycle::initialize_once(&self.render_loop_service, || async {
            let mut service = RenderLoopService::new()
                .await
                .context_bridge("initializing render loop service", 5005)?;
            service
                .load_shaders()
                .context_bridge("loading GPU shaders", 5011)?;
            info!("RenderLoopService initialized and shaders loaded successfully");
            Ok::<_, BridgeError>(service)
        })
        .await?;
        Ok(())
    }

    pub fn start_layer_watchdog(&self) {
        let leases = Arc::clone(&self.layer_leases);
        let layer_map = Arc::clone(&self.layer_to_atlas_map);
        let render_loop_service = Arc::clone(&self.render_loop_service);

        tauri::async_runtime::spawn(async move {
            let mut ticker = interval(LAYER_WATCHDOG_INTERVAL);
            ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);

            loop {
                ticker.tick().await;

                let service_arc_option = {
                    let guard = render_loop_service.lock().await;
                    guard.clone()
                };

                let Some(service_arc) = service_arc_option else {
                    continue;
                };

                let active_indices: HashSet<u32> = {
                    let service_guard = service_arc.lock().await;
                    service_guard.active_atlas_indices().into_iter().collect()
                };

                let layer_map_snapshot: HashMap<String, u32> = {
                    let guard = layer_map.lock().await;
                    guard.clone()
                };

                let leases_snapshot: Vec<(String, Arc<LayerLease>)> = {
                    let guard = leases.lock().await;
                    guard
                        .iter()
                        .map(|(layer_id, lease)| (layer_id.clone(), lease.clone()))
                        .collect()
                };

                if leases_snapshot.is_empty() {
                    continue;
                }

                let mut to_remove = Vec::new();

                for (layer_id, lease) in leases_snapshot {
                    if lease.is_released() {
                        to_remove.push(layer_id);
                        continue;
                    }

                    let atlas_index = lease.atlas_index();
                    let atlas_active = active_indices.contains(&atlas_index);
                    let has_mapping = layer_map_snapshot.contains_key(&layer_id);

                    if atlas_active {
                        continue;
                    }

                    if !has_mapping || lease.age() >= LAYER_WATCHDOG_STALE_AGE {
                        match lease.release("watchdog").await {
                            Ok(_) => {
                                info!(
                                    "Layer watchdog released stale layer '{}' (atlas index {})",
                                    layer_id, atlas_index
                                );
                                to_remove.push(layer_id);
                            }
                            Err(err) => {
                                warn!(
                                    "Layer watchdog failed to release layer '{}': {:?}",
                                    layer_id, err
                                );
                            }
                        }
                    }
                }

                if !to_remove.is_empty() {
                    let mut guard = leases.lock().await;
                    for id in to_remove {
                        guard.remove(&id);
                    }
                }
            }
        });
    }
}

fn sanitize_remote_path(input: &str) -> String {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        "/".to_string()
    } else if trimmed.starts_with('/') {
        trimmed.trim_end_matches('/').to_string()
    } else {
        format!("/{}", trimmed.trim_end_matches('/'))
    }
}

fn build_origin_label(user: &str, host: &str, port: u16, remote_path: &str) -> String {
    if port == 22 {
        format!("{user}@{host}:{remote_path}")
    } else {
        format!("{user}@{host}:{port}:{remote_path}")
    }
}

fn default_mount_display_name(remote_path: &str, host: &str) -> String {
    Path::new(remote_path)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .map(|name| name.to_string())
        .unwrap_or_else(|| host.to_string())
}

fn remote_profile_store_path() -> BridgeResult<PathBuf> {
    let dirs = ProjectDirs::from("org", "Brainflow", "Brainflow").ok_or_else(|| {
        BridgeError::Internal {
            code: 8201,
            details: "Could not resolve app config directory for remote profiles".to_string(),
        }
    })?;
    Ok(dirs.config_dir().join(REMOTE_PROFILE_FILE))
}

fn remote_cache_root() -> BridgeResult<PathBuf> {
    let dirs = ProjectDirs::from("org", "Brainflow", "Brainflow").ok_or_else(|| {
        BridgeError::Internal {
            code: 8202,
            details: "Could not resolve app cache directory for remote mounts".to_string(),
        }
    })?;
    Ok(dirs.cache_dir().join(REMOTE_CACHE_DIR_NAME))
}

fn remote_cache_metadata_root() -> BridgeResult<PathBuf> {
    Ok(remote_cache_root()?.join(REMOTE_CACHE_METADATA_DIR_NAME))
}

fn normalize_key_path(key_path: Option<&str>) -> Option<String> {
    key_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn password_credential_account_key(host: &str, port: u16, user: &str) -> String {
    format!("{user}@{host}:{port}")
}

fn read_cached_password(host: &str, port: u16, user: &str) -> Option<String> {
    let account = password_credential_account_key(host, port, user);
    let entry = KeyringEntry::new(REMOTE_KEYRING_SERVICE, &account).ok()?;
    entry.get_password().ok()
}

fn write_cached_password(host: &str, port: u16, user: &str, password: &str) -> BridgeResult<()> {
    let account = password_credential_account_key(host, port, user);
    let entry =
        KeyringEntry::new(REMOTE_KEYRING_SERVICE, &account).map_err(|e| BridgeError::Internal {
            code: 8203,
            details: format!("Failed to initialize credential store: {e}"),
        })?;
    entry
        .set_password(password)
        .map_err(|e| BridgeError::Internal {
            code: 8204,
            details: format!("Failed to persist remote password in keychain: {e}"),
        })
}

fn delete_cached_password(host: &str, port: u16, user: &str) {
    let account = password_credential_account_key(host, port, user);
    if let Ok(entry) = KeyringEntry::new(REMOTE_KEYRING_SERVICE, &account) {
        let _ = entry.delete_password();
    }
}

fn key_passphrase_account_key(host: &str, port: u16, user: &str, key_path: Option<&str>) -> String {
    let key_path = normalize_key_path(key_path).unwrap_or_else(|| "__default__".to_string());
    format!("key-file:{user}@{host}:{port}:{key_path}")
}

fn read_cached_key_passphrase(
    host: &str,
    port: u16,
    user: &str,
    key_path: Option<&str>,
) -> Option<String> {
    let account = key_passphrase_account_key(host, port, user, key_path);
    let entry = KeyringEntry::new(REMOTE_KEYRING_SERVICE, &account).ok()?;
    entry.get_password().ok()
}

fn write_cached_key_passphrase(
    host: &str,
    port: u16,
    user: &str,
    key_path: Option<&str>,
    passphrase: &str,
) -> BridgeResult<()> {
    let account = key_passphrase_account_key(host, port, user, key_path);
    let entry =
        KeyringEntry::new(REMOTE_KEYRING_SERVICE, &account).map_err(|e| BridgeError::Internal {
            code: 8233,
            details: format!("Failed to initialize credential store: {e}"),
        })?;
    entry
        .set_password(passphrase)
        .map_err(|e| BridgeError::Internal {
            code: 8234,
            details: format!("Failed to persist SSH key passphrase in keychain: {e}"),
        })
}

fn delete_cached_key_passphrase(host: &str, port: u16, user: &str, key_path: Option<&str>) {
    let account = key_passphrase_account_key(host, port, user, key_path);
    if let Ok(entry) = KeyringEntry::new(REMOTE_KEYRING_SERVICE, &account) {
        let _ = entry.delete_password();
    }
}

fn remote_cache_metadata_path(
    mount: &RemoteMountEntry,
    local_path: &Path,
) -> BridgeResult<PathBuf> {
    let relative = local_path
        .strip_prefix(&mount.local_root)
        .map_err(|e| BridgeError::Input {
            code: 8235,
            details: format!(
                "Local cache path '{}' is not inside mount '{}': {e}",
                local_path.display(),
                mount.local_root.display()
            ),
        })?;
    let file_name = relative
        .file_name()
        .ok_or_else(|| BridgeError::Input {
            code: 8236,
            details: format!(
                "Remote cache metadata requires a file path: {}",
                local_path.display()
            ),
        })?
        .to_string_lossy()
        .to_string();

    let mut metadata_dir = remote_cache_metadata_root()?.join(remote_cache::identity(
        &mount.host,
        mount.port,
        &mount.user,
        &mount.remote_root,
    ));
    if let Some(parent) = relative.parent() {
        metadata_dir = metadata_dir.join(parent);
    }

    Ok(metadata_dir.join(format!("{file_name}.json")))
}

fn remote_stat_modified_unix_secs(metadata: &remotely::fs::Metadata) -> Option<u64> {
    metadata
        .modified
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
}

async fn load_remote_file_cache_metadata(
    metadata_path: &Path,
) -> BridgeResult<Option<RemoteFileCacheMetadata>> {
    if !tokio::fs::try_exists(metadata_path).await.unwrap_or(false) {
        return Ok(None);
    }

    let bytes = tokio::fs::read(metadata_path)
        .await
        .map_err(|e| BridgeError::Io {
            code: 8237,
            details: format!(
                "Failed to read remote cache metadata {}: {e}",
                metadata_path.display()
            ),
        })?;

    let metadata = serde_json::from_slice::<RemoteFileCacheMetadata>(&bytes).map_err(|e| {
        BridgeError::Internal {
            code: 8238,
            details: format!(
                "Failed to parse remote cache metadata {}: {e}",
                metadata_path.display()
            ),
        }
    })?;

    Ok(Some(metadata))
}

async fn save_remote_file_cache_metadata(
    metadata_path: &Path,
    metadata: &RemoteFileCacheMetadata,
) -> BridgeResult<()> {
    if let Some(parent) = metadata_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| BridgeError::Io {
                code: 8239,
                details: format!(
                    "Failed to create remote cache metadata directory {}: {e}",
                    parent.display()
                ),
            })?;
    }

    let tmp_path = metadata_path.with_extension("json.tmp");
    let payload = serde_json::to_vec_pretty(metadata).map_err(|e| BridgeError::Internal {
        code: 8240,
        details: format!(
            "Failed to serialize remote cache metadata {}: {e}",
            metadata_path.display()
        ),
    })?;

    tokio::fs::write(&tmp_path, payload)
        .await
        .map_err(|e| BridgeError::Io {
            code: 8241,
            details: format!(
                "Failed to write remote cache metadata temp file {}: {e}",
                tmp_path.display()
            ),
        })?;

    tokio::fs::rename(&tmp_path, metadata_path)
        .await
        .map_err(|e| BridgeError::Io {
            code: 8242,
            details: format!(
                "Failed to finalize remote cache metadata {}: {e}",
                metadata_path.display()
            ),
        })
}

fn remote_cache_metadata_matches(
    metadata: &RemoteFileCacheMetadata,
    mount_id: &str,
    host: &str,
    port: u16,
    user: &str,
    remote_path: &str,
    remote_stat: &remotely::fs::Metadata,
) -> bool {
    ((metadata.version == 1 && metadata.mount_id == mount_id) || metadata.version == 2)
        && metadata.host == host
        && metadata.port == port
        && metadata.user == user
        && metadata.remote_path == remote_path
        && metadata.remote_size == remote_stat.size
        && metadata.remote_modified_unix_secs.is_some()
        && metadata.remote_modified_unix_secs == remote_stat_modified_unix_secs(remote_stat)
}

fn map_remotely_error(err: remotely::Error, code: u16) -> BridgeError {
    match &err {
        remotely::Error::Readiness(remotely::error::ReadinessError::RemotePathNotDirectory {
            ..
        }) => {
            return BridgeError::Input {
                code,
                details: err.to_string(),
            };
        }
        remotely::Error::Readiness(
            remotely::error::ReadinessError::SftpSubsystemUnavailable { .. }
            | remotely::error::ReadinessError::FilesystemProbeTimeout { .. },
        ) => {
            return BridgeError::Io {
                code,
                details: err.to_string(),
            };
        }
        remotely::Error::Runtime(_) => {
            return BridgeError::Internal {
                code,
                details: err.to_string(),
            };
        }
        _ => {}
    }

    match err.category() {
        remotely::ErrorCategory::AuthDenied => BridgeError::Input {
            code,
            details: format!("SSH authentication denied: {err}"),
        },
        remotely::ErrorCategory::AuthChallengeRequired => BridgeError::Input {
            code,
            details: format!("SSH authentication challenge required: {err}"),
        },
        remotely::ErrorCategory::HostKeyMismatch | remotely::ErrorCategory::HostKeyUnknown => {
            BridgeError::Input {
                code,
                details: format!("SSH host-key validation failed: {err}"),
            }
        }
        remotely::ErrorCategory::PermissionDenied => BridgeError::Scope {
            code,
            path: err.to_string(),
        },
        remotely::ErrorCategory::NotFound => BridgeError::Io {
            code,
            details: err.to_string(),
        },
        remotely::ErrorCategory::NetworkTransient | remotely::ErrorCategory::NetworkFatal => {
            BridgeError::Io {
                code,
                details: err.to_string(),
            }
        }
        remotely::ErrorCategory::Other => BridgeError::Internal {
            code,
            details: err.to_string(),
        },
    }
}

fn remote_probe_options(request: &NormalizedRemoteMountRequest) -> FilesystemProbeOptions {
    FilesystemProbeOptions::new(request.remote_path.clone())
        .canonicalize(true)
        .timeout(Duration::from_secs(15))
}

fn normalize_remote_mount_request(
    request: RemoteMountConnectRequest,
) -> BridgeResult<NormalizedRemoteMountRequest> {
    let host = request.host.trim().to_string();
    let user = request.user.trim().to_string();
    let remote_path = sanitize_remote_path(&request.remote_path);
    let key_path = normalize_key_path(request.key_path.as_deref());
    let key_passphrase =
        request
            .key_passphrase
            .and_then(|value| if value.is_empty() { None } else { Some(value) });

    if host.is_empty() {
        return Err(BridgeError::Input {
            code: 8205,
            details: "host is required".to_string(),
        });
    }
    if user.is_empty() {
        return Err(BridgeError::Input {
            code: 8206,
            details: "user is required".to_string(),
        });
    }

    let auth_method = request
        .auth_method
        .unwrap_or_else(|| {
            if request.password.is_some() {
                "password".to_string()
            } else {
                "key_file".to_string()
            }
        })
        .trim()
        .to_lowercase();

    Ok(NormalizedRemoteMountRequest {
        host,
        port: request.port.unwrap_or(22),
        user,
        remote_path,
        auth_method,
        password: request.password,
        key_path,
        key_passphrase,
        verify_host_key: request.verify_host_key.unwrap_or(true),
        accept_unknown_host_keys: request.accept_unknown_host_keys.unwrap_or(false),
        known_hosts_path: request.known_hosts_path.map(PathBuf::from),
        remember_password: request.remember_password.unwrap_or(false),
        save_profile: request.save_profile.unwrap_or(false),
        profile_name: request.profile_name,
    })
}

fn select_remote_auth(request: &NormalizedRemoteMountRequest) -> BridgeResult<RemoteAuthMethod> {
    match request.auth_method.as_str() {
        "password" => {
            let password = request
                .password
                .clone()
                .or_else(|| read_cached_password(&request.host, request.port, &request.user))
                .ok_or_else(|| BridgeError::Input {
                    code: 8207,
                    details: "password auth selected but no password was provided/cached"
                        .to_string(),
                })?;
            Ok(RemoteAuthMethod::Password(password))
        }
        "agent" => Ok(RemoteAuthMethod::Agent),
        "keyboard_interactive" | "keyboard-interactive" => {
            Ok(RemoteAuthMethod::KeyboardInteractive { submethods: None })
        }
        "key_file" | "key" => {
            let passphrase = request.key_passphrase.clone().or_else(|| {
                read_cached_key_passphrase(
                    &request.host,
                    request.port,
                    &request.user,
                    request.key_path.as_deref(),
                )
            });
            if let Some(key_path) = request.key_path.as_ref() {
                Ok(RemoteAuthMethod::KeyFile {
                    source: remotely::ssh::KeySource::File(PathBuf::from(key_path)),
                    passphrase,
                })
            } else {
                Ok(RemoteAuthMethod::KeyFile {
                    source: remotely::ssh::KeySource::DefaultLocations,
                    passphrase,
                })
            }
        }
        other => Err(BridgeError::Input {
            code: 8208,
            details: format!("Unsupported auth method: {other}"),
        }),
    }
}

async fn load_remote_profiles() -> BridgeResult<Vec<RemoteMountProfile>> {
    let path = remote_profile_store_path()?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let bytes = tokio::fs::read(&path).await.map_err(|e| BridgeError::Io {
        code: 8209,
        details: format!(
            "Failed to read remote profile store {}: {e}",
            path.display()
        ),
    })?;
    serde_json::from_slice::<Vec<RemoteMountProfile>>(&bytes).map_err(|e| BridgeError::Internal {
        code: 8210,
        details: format!(
            "Failed to parse remote profile store {}: {e}",
            path.display()
        ),
    })
}

async fn save_remote_profiles(profiles: &[RemoteMountProfile]) -> BridgeResult<()> {
    let path = remote_profile_store_path()?;
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| BridgeError::Io {
                code: 8211,
                details: format!(
                    "Failed to create remote profile directory {}: {e}",
                    parent.display()
                ),
            })?;
    }
    let tmp_path = path.with_extension("json.tmp");
    let payload = serde_json::to_vec_pretty(profiles).map_err(|e| BridgeError::Internal {
        code: 8212,
        details: format!("Failed to serialize remote profiles: {e}"),
    })?;
    tokio::fs::write(&tmp_path, payload)
        .await
        .map_err(|e| BridgeError::Io {
            code: 8213,
            details: format!(
                "Failed to write remote profile temp file {}: {e}",
                tmp_path.display()
            ),
        })?;
    tokio::fs::rename(&tmp_path, &path)
        .await
        .map_err(|e| BridgeError::Io {
            code: 8214,
            details: format!(
                "Failed to finalize remote profile file {}: {e}",
                path.display()
            ),
        })
}

fn now_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn profile_id_for_request(request: &NormalizedRemoteMountRequest) -> String {
    format!(
        "{}@{}:{}:{}",
        request.user, request.host, request.port, request.remote_path
    )
}

async fn upsert_remote_profile(
    request: &NormalizedRemoteMountRequest,
    has_password: bool,
    has_key_passphrase: bool,
) -> BridgeResult<()> {
    let mut profiles = load_remote_profiles().await?;
    let profile_id = profile_id_for_request(request);
    let name = request
        .profile_name
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            build_origin_label(
                &request.user,
                &request.host,
                request.port,
                &request.remote_path,
            )
        });

    let profile = RemoteMountProfile {
        id: profile_id.clone(),
        name,
        host: request.host.clone(),
        port: request.port,
        user: request.user.clone(),
        remote_path: request.remote_path.clone(),
        auth_method: request.auth_method.clone(),
        key_path: request.key_path.clone(),
        verify_host_key: request.verify_host_key,
        accept_unknown_host_keys: request.accept_unknown_host_keys,
        known_hosts_path: request
            .known_hosts_path
            .as_ref()
            .map(|path| path.to_string_lossy().to_string()),
        has_password,
        has_key_passphrase,
        updated_at_ms: now_unix_ms(),
    };

    if let Some(existing) = profiles
        .iter_mut()
        .find(|candidate| candidate.id == profile_id)
    {
        *existing = profile;
    } else {
        profiles.push(profile);
    }

    save_remote_profiles(&profiles).await
}

fn host_key_challenge_to_bridge(challenge: &remotely::HostKeyChallenge) -> RemoteHostKeyChallenge {
    let disposition = match challenge.disposition {
        HostKeyDisposition::Unknown => "unknown",
        HostKeyDisposition::Mismatch => "mismatch",
    };

    RemoteHostKeyChallenge {
        challenge_id: challenge.challenge_id.to_string(),
        host: challenge.host.clone(),
        port: challenge.port,
        algorithm: challenge.algo.clone(),
        sha256_fingerprint: challenge.sha256_fingerprint.clone(),
        disposition: disposition.to_string(),
    }
}

fn auth_challenge_to_bridge(challenge: &remotely::AuthChallenge) -> RemoteAuthChallenge {
    RemoteAuthChallenge {
        conversation_id: challenge.conversation_id.to_string(),
        name: challenge.name.clone(),
        instructions: challenge.instructions.clone(),
        prompts: challenge
            .prompts
            .iter()
            .map(|prompt| RemoteAuthPrompt {
                prompt: prompt.prompt.clone(),
                echo: prompt.echo,
            })
            .collect(),
    }
}

async fn resolve_remote_mount_for_local_path(
    state: &BridgeState,
    local_path: &Path,
) -> Option<(RemoteMountEntry, String)> {
    let mounts = state.remote_mounts.lock().await;

    let best_match = mounts
        .values()
        .filter(|mount| local_path.starts_with(&mount.local_root))
        .max_by_key(|mount| mount.local_root.components().count())
        .cloned()?;

    let relative = local_path.strip_prefix(&best_match.local_root).ok()?;
    let mut remote = best_match.remote_root.clone();
    if remote.is_empty() {
        remote.push('/');
    }
    if remote != "/" {
        remote = remote.trim_end_matches('/').to_string();
    }

    for component in relative.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::Normal(segment) => {
                if remote != "/" {
                    remote.push('/');
                }
                remote.push_str(&segment.to_string_lossy());
            }
            _ => return None,
        }
    }

    Some((best_match, remote))
}

fn icon_for_entry(path: &Path, is_dir: bool) -> u8 {
    if is_dir {
        return icons::FOLDER;
    }

    match path.extension().and_then(|ext| ext.to_str()) {
        Some("nii") | Some("gz") => icons::NIFTI,
        Some("gii") => icons::GIFTI,
        Some("csv") | Some("tsv") => icons::TABLE,
        Some("png") | Some("jpg") | Some("jpeg") => icons::IMAGE,
        _ => icons::FILE,
    }
}

/// List through an owned worker; the operation permit survives timeout cleanup.
async fn list_remote_directory_for_local_path(
    state: &BridgeState,
    local_path: &Path,
) -> BridgeResult<Option<TreePayload>> {
    let Some((mount, remote_path)) = resolve_remote_mount_for_local_path(state, local_path).await
    else {
        return Ok(None);
    };

    if !local_path.exists() {
        tokio::fs::create_dir_all(local_path)
            .await
            .map_err(|e| BridgeError::Io {
                code: 8215,
                details: format!(
                    "Failed to prepare local cache directory {}: {e}",
                    local_path.display()
                ),
            })?;
    }

    let entries = remote_transfer::list_owned(mount.clone(), remote_path.clone()).await?;

    let mut nodes = Vec::with_capacity(entries.len());

    for entry in entries {
        let child_local_path = local_path.join(&entry.name);
        let is_dir = entry.is_dir();

        if is_dir {
            let _ = tokio::fs::create_dir_all(&child_local_path).await;
        }

        nodes.push(FlatNode {
            id: child_local_path.to_string_lossy().to_string(),
            name: entry.name,
            parent_idx: None,
            icon_id: icon_for_entry(&child_local_path, is_dir),
            is_dir,
        });
    }

    nodes.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(Some(TreePayload { nodes }))
}

async fn list_local_directory(path: &Path) -> BridgeResult<TreePayload> {
    let entries = std::fs::read_dir(path).map_err(|e| BridgeError::Io {
        code: 1003,
        details: format!("Failed to read directory {}: {e}", path.display()),
    })?;

    let mut nodes = Vec::new();
    for entry in entries.flatten() {
        let child_path = entry.path();
        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };

        nodes.push(FlatNode {
            id: child_path.to_string_lossy().to_string(),
            name: entry.file_name().to_string_lossy().to_string(),
            parent_idx: None,
            icon_id: icon_for_entry(&child_path, metadata.is_dir()),
            is_dir: metadata.is_dir(),
        });
    }

    nodes.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(TreePayload { nodes })
}

async fn materialize_remote_file_if_needed(state: &BridgeState, path: &Path) -> BridgeResult<()> {
    let Some((mount, remote_path)) = resolve_remote_mount_for_local_path(state, path).await else {
        return Ok(());
    };

    let _cache_admission = remote_cache::ADMISSION.lock().await;
    if mount.transfers.is_stopped() {
        return Err(remote_transfer::error("Remote mount has been unmounted"));
    }
    let _ = tokio::fs::write(mount.local_root.join(".last-used"), []).await;
    let metadata_path = remote_cache_metadata_path(&mount, path)?;
    let remote_stat = remote_transfer::stat_owned(mount.clone(), remote_path.clone()).await?;

    if tokio::fs::metadata(path)
        .await
        .is_ok_and(|metadata| metadata.len() == remote_stat.size)
    {
        if let Some(metadata) = load_remote_file_cache_metadata(&metadata_path).await? {
            if remote_cache_metadata_matches(
                &metadata,
                &mount.mount_id,
                &mount.host,
                mount.port,
                &mount.user,
                &remote_path,
                &remote_stat,
            ) {
                return Ok(());
            }
        }
    }

    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| BridgeError::Io {
                code: 8217,
                details: format!("Failed to prepare cache path {}: {e}", parent.display()),
            })?;
    }

    let active_roots = state
        .remote_mounts
        .lock()
        .await
        .values()
        .map(|entry| entry.local_root.clone())
        .collect();
    let cache_root = remote_cache_root()?;
    let incoming_size = remote_stat.size;
    tokio::task::spawn_blocking(move || {
        remote_cache::make_room(
            &cache_root,
            &active_roots,
            incoming_size,
            remote_cache::budget(),
        )
    })
    .await
    .map_err(|e| remote_transfer::error(&e.to_string()))??;
    remote_transfer::download_owned(
        mount.clone(),
        remote_path.clone(),
        path.to_path_buf(),
        remote_stat.size,
        Duration::from_secs(90),
    )
    .await?;

    let after = remote_transfer::stat_owned(mount.clone(), remote_path.clone()).await?;
    if after.size != remote_stat.size
        || remote_stat_modified_unix_secs(&after) != remote_stat_modified_unix_secs(&remote_stat)
    {
        let _ = tokio::fs::remove_file(path).await;
        return Err(remote_transfer::error(
            "Remote file changed during download; retry loading it",
        ));
    }
    save_remote_file_cache_metadata(
        &metadata_path,
        &RemoteFileCacheMetadata {
            version: 2,
            mount_id: mount.mount_id.clone(),
            host: mount.host.clone(),
            port: mount.port,
            user: mount.user.clone(),
            remote_path,
            remote_size: remote_stat.size,
            remote_modified_unix_secs: remote_stat_modified_unix_secs(&remote_stat),
        },
    )
    .await?;

    Ok(())
}

async fn finalize_remote_mount<R: Runtime>(
    state: &BridgeState,
    request: NormalizedRemoteMountRequest,
    client: RemoteClient,
    app: tauri::AppHandle<R>,
) -> BridgeResult<RemoteMountConnectResult> {
    let mount_id = uuid::Uuid::new_v4().to_string();
    let cache_root = remote_cache_root()?;
    tokio::fs::create_dir_all(&cache_root)
        .await
        .map_err(|e| BridgeError::Io {
            code: 8219,
            details: format!(
                "Failed to create remote cache root {}: {e}",
                cache_root.display()
            ),
        })?;

    let local_root = cache_root.join(remote_cache::identity(
        &request.host,
        request.port,
        &request.user,
        &request.remote_path,
    ));
    {
        let mounts = state.remote_mounts.lock().await;
        if let Some(existing) = mounts.values().find(|mount| mount.local_root == local_root) {
            let info = remote_mount_info_from_entry(existing);
            drop(mounts);
            client
                .close()
                .await
                .map_err(|e| map_remotely_error(e, 8229))?;
            return Ok(RemoteMountConnectResult::Connected { mount: info });
        }
    }
    tokio::fs::create_dir_all(&local_root)
        .await
        .map_err(|e| BridgeError::Io {
            code: 8220,
            details: format!(
                "Failed to create mount cache directory {}: {e}",
                local_root.display()
            ),
        })?;

    if request.auth_method == "password" {
        if request.remember_password {
            if let Some(password) = request.password.as_ref() {
                write_cached_password(&request.host, request.port, &request.user, password)?;
            }
        } else {
            delete_cached_password(&request.host, request.port, &request.user);
        }
    }

    if request.auth_method == "key_file" {
        if request.remember_password {
            if let Some(passphrase) = request.key_passphrase.as_ref() {
                write_cached_key_passphrase(
                    &request.host,
                    request.port,
                    &request.user,
                    request.key_path.as_deref(),
                    passphrase,
                )?;
            }
        } else {
            delete_cached_key_passphrase(
                &request.host,
                request.port,
                &request.user,
                request.key_path.as_deref(),
            );
        }
    }

    if request.save_profile {
        let has_password = request.auth_method == "password"
            && request.remember_password
            && (request.password.is_some()
                || read_cached_password(&request.host, request.port, &request.user).is_some());
        let has_key_passphrase = request.auth_method == "key_file"
            && request.remember_password
            && (request.key_passphrase.is_some()
                || read_cached_key_passphrase(
                    &request.host,
                    request.port,
                    &request.user,
                    request.key_path.as_deref(),
                )
                .is_some());
        upsert_remote_profile(&request, has_password, has_key_passphrase).await?;
    }

    let display_name = request
        .profile_name
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| default_mount_display_name(&request.remote_path, &request.host));
    let origin_label = build_origin_label(
        &request.user,
        &request.host,
        request.port,
        &request.remote_path,
    );

    let client = Arc::new(client);
    install_remote_recovery_hook(&client, &mount_id, &origin_label, &app);

    let mount_entry = RemoteMountEntry {
        mount_id: mount_id.clone(),
        local_root: local_root.clone(),
        remote_root: request.remote_path.clone(),
        display_name: display_name.clone(),
        origin_label: origin_label.clone(),
        host: request.host.clone(),
        port: request.port,
        user: request.user.clone(),
        client: Arc::clone(&client),
        op_semaphore: Arc::new(tokio::sync::Semaphore::new(REMOTE_MOUNT_MAX_CONCURRENT_OPS)),
        transfers: Arc::new(remote_transfer::Control::default()),
        progress: Arc::new(move |progress| {
            let _ = app.emit("remote-file-progress", progress);
        }),
    };

    {
        let mut mounts = state.remote_mounts.lock().await;
        mounts.insert(mount_id.clone(), mount_entry);
    }

    let mount_info = RemoteMountInfo {
        mount_id: mount_id.clone(),
        local_path: local_root.to_string_lossy().to_string(),
        display_name: display_name.clone(),
        origin: RemoteMountOrigin {
            mount_id: mount_id.clone(),
            host: request.host.clone(),
            port: request.port,
            user: request.user.clone(),
            remote_path: request.remote_path.clone(),
            label: origin_label.clone(),
        },
    };

    Ok(RemoteMountConnectResult::Connected { mount: mount_info })
}

fn remote_mount_info_from_entry(mount: &RemoteMountEntry) -> RemoteMountInfo {
    RemoteMountInfo {
        mount_id: mount.mount_id.clone(),
        local_path: mount.local_root.to_string_lossy().to_string(),
        display_name: mount.display_name.clone(),
        origin: RemoteMountOrigin {
            mount_id: mount.mount_id.clone(),
            host: mount.host.clone(),
            port: mount.port,
            user: mount.user.clone(),
            remote_path: mount.remote_root.clone(),
            label: mount.origin_label.clone(),
        },
    }
}

fn install_remote_recovery_hook<R: Runtime>(
    client: &RemoteClient,
    mount_id: &str,
    origin_label: &str,
    app: &tauri::AppHandle<R>,
) {
    let mount_id = mount_id.to_string();
    let origin_label = origin_label.to_string();
    let app_handle = app.clone();

    client.fs().set_recovery_hook(move |event| {
        tracing::warn!(
            mount_id = %mount_id,
            origin = %origin_label,
            attempt = event.attempt,
            reason = %event.reason,
            "Remote mount SFTP session recovered after retry"
        );

        let payload = RemoteMountRecoveryEvent {
            mount_id: mount_id.clone(),
            origin_label: origin_label.clone(),
            attempt: event.attempt,
            reason: event.reason.clone(),
        };

        if let Err(err) = app_handle.emit("remote-mount-recovery", &payload) {
            tracing::debug!(mount_id = %mount_id, error = %err, "Failed to emit remote recovery event");
        }
    });
}

async fn handle_remote_connect_outcome<R: Runtime>(
    state: &BridgeState,
    context: PendingRemoteMountContext,
    outcome: RemoteConnectOutcome,
    app: tauri::AppHandle<R>,
) -> BridgeResult<RemoteMountConnectResult> {
    match outcome {
        RemoteConnectOutcome::Connected(client) => {
            finalize_remote_mount(state, context.request, client, app).await
        }
        RemoteConnectOutcome::NeedHostKeyConfirmation(challenge) => {
            {
                let mut pending = state.pending_remote_host_key.lock().await;
                pending.insert(challenge.challenge_id, context);
            }
            Ok(RemoteMountConnectResult::NeedHostKey {
                challenge: host_key_challenge_to_bridge(&challenge),
            })
        }
        RemoteConnectOutcome::NeedKeyboardInteractive(challenge) => {
            {
                let mut pending = state.pending_remote_auth.lock().await;
                pending.insert(challenge.conversation_id, context);
            }
            Ok(RemoteMountConnectResult::NeedAuth {
                challenge: auth_challenge_to_bridge(&challenge),
            })
        }
    }
}

// --- Tauri Command Stubs ---

#[command]
#[tracing::instrument(skip_all, err, name = "api.load_file")]
async fn load_file(path: String, state: State<'_, BridgeState>) -> BridgeResult<VolumeHandleInfo> {
    info!("Bridge: load_file called with path: {}", path);
    let load_start = Instant::now();

    // Materialize a remote-backed file into local cache when needed.
    let file_path = PathBuf::from(&path);
    materialize_remote_file_if_needed(state.inner(), &file_path).await?;

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
    let (volume_sendable, _affine) =
        tokio::task::spawn_blocking(move || nifti_loader::load_nifti_volume_auto(&decode_path))
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

    // Register the volume in the state
    let mut registry = state.volume_registry.lock().await;
    registry.insert(handle_id.clone(), volume_sendable, metadata);
    drop(registry);

    info!(
        "Bridge: Successfully loaded volume with handle: {} (dtype={}, dims={:?}, elapsed={}ms)",
        handle_id,
        dtype,
        dims,
        load_start.elapsed().as_millis()
    );

    // Return the handle
    Ok(VolumeHandleInfo {
        id: handle_id,
        name: file_name.to_string(),
        dims,
        dtype,
        volume_type,
        num_timepoints: time_series_info.as_ref().map(|ts| ts.num_timepoints),
        current_timepoint: None,
        time_series_info,
    })
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.load_surface")]
async fn load_surface(
    path: String,
    state: State<'_, BridgeState>,
) -> BridgeResult<bridge_types::LoadedContent> {
    info!("Bridge: load_surface called with path: {}", path);

    // Materialize remote-backed files into local cache when needed.
    let file_path = PathBuf::from(&path);
    materialize_remote_file_if_needed(state.inner(), &file_path).await?;

    // Validate that the file exists and is loadable.
    if !file_path.exists() {
        return Err(BridgeError::Io {
            code: 1001,
            details: format!("File not found: {}", path),
        });
    }

    // Check if this is a GIFTI file
    if !gifti_loader::GiftiLoader::can_load(&file_path) {
        return Err(BridgeError::Input {
            code: 1002,
            details: format!("File is not a GIFTI file: {}", path),
        });
    }

    // Load the file using the GIFTI loader
    let decode_path = file_path.clone();
    let (loaded, geometry) =
        tokio::task::spawn_blocking(move || surface_loading::decode(&decode_path))
            .await
            .map_err(|error| BridgeError::Internal {
                code: 1006,
                details: format!("Surface decoder task failed: {error}"),
            })??;

    match loaded {
        bridge_types::Loaded::Surface {
            handle,
            vertex_count,
            face_count,
            path: _loaded_path,
        } => {
            // Load the actual surface geometry
            let geometry = geometry.ok_or_else(|| BridgeError::Internal {
                code: 1006,
                details: "Surface decoder returned metadata without geometry".to_string(),
            })?;

            // Create an identity transform for now
            let transform = Affine3::identity();

            // Extract metadata
            let hemisphere = match geometry.hemisphere() {
                neurosurf_rs::geometry::Hemisphere::Left => Some("left".to_string()),
                neurosurf_rs::geometry::Hemisphere::Right => Some("right".to_string()),
                neurosurf_rs::geometry::Hemisphere::Both => Some("both".to_string()),
                neurosurf_rs::geometry::Hemisphere::Unknown => None,
            };

            let surface_type = match geometry.surface_type() {
                neurosurf_rs::geometry::SurfaceType::White => Some("white".to_string()),
                neurosurf_rs::geometry::SurfaceType::Pial => Some("pial".to_string()),
                neurosurf_rs::geometry::SurfaceType::Inflated => Some("inflated".to_string()),
                _ => None, // Handle any other surface types
            };

            // Create metadata
            let metadata = SurfaceMetadataInfo {
                name: file_path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("unknown")
                    .to_string(),
                path: path.clone(),
                hemisphere: hemisphere.clone(),
                surface_type: surface_type.clone(),
                vertex_count,
                face_count,
            };

            // Register the surface
            let mut registry = state.surface_registry.lock().await;
            registry.insert_surface(handle.0.clone(), geometry, transform, metadata);
            drop(registry);

            info!(
                "Bridge: Successfully loaded surface with handle: {}",
                handle.0
            );

            // Return the loaded content
            Ok(bridge_types::LoadedContent::Surface {
                handle: handle.0,
                vertex_count,
                face_count,
                hemisphere,
                surface_type,
            })
        }
        bridge_types::Loaded::SurfaceData {
            handle,
            data_count,
            path: _loaded_path,
        } => {
            // For surface data, we'll need to implement loading the actual data
            // For now, return a placeholder
            Ok(bridge_types::LoadedContent::SurfaceData {
                handle: handle.0,
                data_count,
                intent: "unknown".to_string(), // TODO: Extract intent from GIFTI
            })
        }
        _ => Err(BridgeError::Internal {
            code: 1006,
            details: "Unexpected loaded content type from GIFTI loader".to_string(),
        }),
    }
}

/// Convert surface geometry to the wire format, exporting vertices in WORLD
/// space (`surf_to_world` applied via `vertices_world`) so the rendered mesh and
/// GPU atlas overlay sample the same coordinates `vol_to_surf` projects to.
/// `get_surface_geometry` is a thin registry lookup over this pure, tested helper.
fn surface_geometry_data(
    geometry: &neurosurf_rs::geometry::SurfaceGeometry,
) -> BridgeResult<bridge_types::SurfaceGeometryData> {
    // World-space vertices: surf_to_world is applied here (identity -> unchanged).
    let vertices_array = geometry
        .vertices_world()
        .map_err(|e| BridgeError::Internal {
            code: 2002,
            details: format!("Failed to get world vertices: {}", e),
        })?;
    let mut vertices = Vec::with_capacity(vertices_array.nrows() * 3);
    for row in vertices_array.rows() {
        vertices.push(row[0] as f32);
        vertices.push(row[1] as f32);
        vertices.push(row[2] as f32);
    }

    let faces_array = geometry.faces().map_err(|e| BridgeError::Internal {
        code: 2003,
        details: format!("Failed to get faces: {}", e),
    })?;
    let mut faces = Vec::with_capacity(faces_array.nrows() * 3);
    for row in faces_array.rows() {
        faces.push(row[0] as u32);
        faces.push(row[1] as u32);
        faces.push(row[2] as u32);
    }

    Ok(bridge_types::SurfaceGeometryData { vertices, faces })
}

#[cfg(test)]
mod surface_geometry_data_tests {
    use super::*;
    use ndarray::array;
    use neurosurf_rs::geometry::{Hemisphere, SurfaceGeometry, SurfaceType};
    use neurosurf_rs::nalgebra::Matrix4;

    fn tri_surface(surf_to_world: Matrix4<f64>) -> SurfaceGeometry {
        // Vertex 0 at (1,2,3) is the probe point.
        let vertices = array![[1.0, 2.0, 3.0], [0.0, 0.0, 0.0], [4.0, 5.0, 6.0]];
        let faces = array![[0usize, 1, 2]];
        SurfaceGeometry::new_with_surf_to_world(
            vertices,
            faces,
            Hemisphere::Left,
            SurfaceType::White,
            surf_to_world,
        )
        .expect("valid surface")
    }

    #[test]
    fn identity_transform_exports_raw_vertices() {
        let data = surface_geometry_data(&tri_surface(Matrix4::identity())).unwrap();
        assert_eq!(&data.vertices[0..3], &[1.0f32, 2.0, 3.0]);
        assert_eq!(data.faces, vec![0u32, 1, 2]);
    }

    #[test]
    fn nonidentity_transform_exports_world_vertices() {
        // Translate (+10, +20, +30): vertex 0 (1,2,3) -> world (11,22,33).
        let mut m = Matrix4::identity();
        m[(0, 3)] = 10.0;
        m[(1, 3)] = 20.0;
        m[(2, 3)] = 30.0;
        let data = surface_geometry_data(&tri_surface(m)).unwrap();
        assert_eq!(
            &data.vertices[0..3],
            &[11.0f32, 22.0, 33.0],
            "bridge must export world-space vertices (surf_to_world applied)"
        );
    }
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.get_surface_geometry")]
async fn get_surface_geometry(
    handle: String,
    state: State<'_, BridgeState>,
) -> BridgeResult<bridge_types::SurfaceGeometryData> {
    info!("Bridge: get_surface_geometry called for handle: {}", handle);

    // Get the surface from registry
    let registry = state.surface_registry.lock().await;
    let surface_entry = registry
        .get_surface(&handle)
        .ok_or_else(|| BridgeError::Input {
            code: 2001,
            details: format!("Surface not found: {}", handle),
        })?;

    surface_geometry_data(&surface_entry.geometry)
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.unload_surface")]
async fn unload_surface(
    handle: String,
    state: State<'_, BridgeState>,
) -> BridgeResult<ReleaseResult> {
    unload_surface_impl(&handle, &state).await
}

async fn unload_surface_impl(handle: &str, state: &BridgeState) -> BridgeResult<ReleaseResult> {
    info!("Bridge: unload_surface called for handle: {}", handle);

    let mut registry = state.surface_registry.lock().await;
    registry
        .remove_surface(&handle)
        .ok_or_else(|| BridgeError::Input {
            code: 2013,
            details: format!("Surface not found: {}", handle),
        })?;
    let removed_overlay_count = registry.remove_data_for_surface(handle);
    // Keep registry -> sampler lock ordering consistent with sampler publication.
    state
        .surface_samplers
        .lock()
        .await
        .retain(|_, entry| entry.surface_id != handle);
    drop(registry);

    info!(
        "Bridge: Unloaded surface '{}' ({} associated overlay dataset(s) removed)",
        handle, removed_overlay_count
    );

    Ok(ReleaseResult {
        success: true,
        message: format!(
            "Unloaded surface '{}' ({} associated overlay dataset(s) removed)",
            handle, removed_overlay_count
        ),
    })
}

// --- Surface Overlay Commands ---

fn build_surface_overlay_handle(target_surface_id: &str, file_path: &Path) -> String {
    let stem = file_path
        .file_stem()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("unknown");

    format!(
        "overlay_{}_{}_{}",
        target_surface_id,
        stem,
        uuid::Uuid::new_v4()
    )
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.load_surface_overlay")]
async fn load_surface_overlay(
    path: String,
    target_surface_id: String,
    state: State<'_, BridgeState>,
) -> BridgeResult<bridge_types::LoadedContent> {
    info!(
        "Bridge: load_surface_overlay called with path: {}, target: {}",
        path, target_surface_id
    );

    let file_path = PathBuf::from(&path);
    materialize_remote_file_if_needed(state.inner(), &file_path).await?;

    if !file_path.exists() {
        return Err(BridgeError::Io {
            code: 2010,
            details: format!("Overlay file not found: {}", path),
        });
    }

    // Verify target surface exists
    {
        let registry = state.surface_registry.lock().await;
        if !registry.contains_surface(&target_surface_id) {
            return Err(BridgeError::Input {
                code: 2011,
                details: format!("Target surface not found: {}", target_surface_id),
            });
        }
    }

    // Load the overlay data using the gifti loader
    let data = gifti_loader::load_gifti_surface_data(&file_path)?;
    let data_count = data.len();

    // Detect intent from filename
    let filename = file_path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    let intent = if filename.contains(".func.gii") {
        "functional".to_string()
    } else if filename.contains(".shape.gii") {
        "shape".to_string()
    } else if filename.contains(".label.gii") {
        "label".to_string()
    } else {
        "unknown".to_string()
    };

    // Generate a handle for this overlay
    let handle = build_surface_overlay_handle(&target_surface_id, &file_path);

    // Store the data as f64 in the registry
    let data_f64: Vec<f64> = data.iter().map(|&v| v as f64).collect();
    {
        let mut registry = state.surface_registry.lock().await;
        registry.insert_data(handle.clone(), data_f64);
    }

    info!(
        "Bridge: Overlay loaded - handle: {}, data_count: {}, intent: {}",
        handle, data_count, intent
    );

    Ok(bridge_types::LoadedContent::SurfaceData {
        handle,
        data_count,
        intent,
    })
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.get_surface_overlay_data")]
async fn get_surface_overlay_data(
    handle: String,
    state: State<'_, BridgeState>,
) -> BridgeResult<Vec<f64>> {
    info!(
        "Bridge: get_surface_overlay_data called for handle: {}",
        handle
    );

    let registry = state.surface_registry.lock().await;
    let data = registry
        .get_data(&handle)
        .ok_or_else(|| BridgeError::Input {
            code: 2012,
            details: format!("Overlay data not found: {}", handle),
        })?;

    Ok(data.clone())
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.unload_surface_overlay")]
async fn unload_surface_overlay(
    handle: String,
    state: State<'_, BridgeState>,
) -> BridgeResult<ReleaseResult> {
    info!(
        "Bridge: unload_surface_overlay called for handle: {}",
        handle
    );

    let mut registry = state.surface_registry.lock().await;
    registry
        .remove_data(&handle)
        .ok_or_else(|| BridgeError::Input {
            code: 2014,
            details: format!("Overlay data not found: {}", handle),
        })?;
    drop(registry);

    Ok(ReleaseResult {
        success: true,
        message: format!("Unloaded surface overlay '{}'", handle),
    })
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.unload_volume")]
async fn unload_volume(
    volume_id: String,
    state: State<'_, BridgeState>,
) -> BridgeResult<ReleaseResult> {
    info!("Bridge: unload_volume called for volume: {}", volume_id);

    let active_layer_ids: Vec<String> = {
        let layer_to_volume = state.layer_to_volume_map.lock().await;
        layer_to_volume
            .iter()
            .filter_map(|(layer_id, mapped_volume_id)| {
                if mapped_volume_id == &volume_id {
                    Some(layer_id.clone())
                } else {
                    None
                }
            })
            .collect()
    };

    if !active_layer_ids.is_empty() {
        return Err(BridgeError::Input {
            code: 4048,
            details: format!(
                "Cannot unload volume '{}' while active layer mappings exist: {}",
                volume_id,
                active_layer_ids.join(", ")
            ),
        });
    }

    let mut volume_registry = state.volume_registry.lock().await;
    volume_registry
        .remove(&volume_id)
        .ok_or_else(|| BridgeError::VolumeNotFound {
            code: 4041,
            details: volume_id.clone(),
        })?;
    drop(volume_registry);
    if let Some(service) = state.render_loop_service.lock().await.as_ref() {
        service
            .lock()
            .await
            .remove_custom_colormap(&format!("parcel:{}", volume_id));
    }

    Ok(ReleaseResult {
        success: true,
        message: format!("Unloaded volume '{}'", volume_id),
    })
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.get_volume_bounds")]
async fn get_volume_bounds(
    volume_id: String,
    state: State<'_, BridgeState>,
) -> BridgeResult<VolumeBounds> {
    info!("Bridge: get_volume_bounds called for {}", volume_id);

    let volume_registry = state.volume_registry.lock().await;
    let volume_data =
        volume_registry
            .get(&volume_id)
            .ok_or_else(|| BridgeError::VolumeNotFound {
                code: 4041,
                details: volume_id.clone(),
            })?;

    // Calculate world bounds from volume dimensions and affine transform
    let dims_vec = get_spatial_dims_from_volume(volume_data);
    let dims = [dims_vec[0], dims_vec[1], dims_vec[2]];
    let affine = get_affine_from_volume(volume_data)?;
    let voxel_to_world = affine.to_homogeneous();

    // Calculate the 8 corners of the volume in voxel space
    let corners_voxel = vec![
        nalgebra::Vector4::new(0.0, 0.0, 0.0, 1.0),
        nalgebra::Vector4::new((dims[0] - 1) as f32, 0.0, 0.0, 1.0),
        nalgebra::Vector4::new(0.0, (dims[1] - 1) as f32, 0.0, 1.0),
        nalgebra::Vector4::new((dims[0] - 1) as f32, (dims[1] - 1) as f32, 0.0, 1.0),
        nalgebra::Vector4::new(0.0, 0.0, (dims[2] - 1) as f32, 1.0),
        nalgebra::Vector4::new((dims[0] - 1) as f32, 0.0, (dims[2] - 1) as f32, 1.0),
        nalgebra::Vector4::new(0.0, (dims[1] - 1) as f32, (dims[2] - 1) as f32, 1.0),
        nalgebra::Vector4::new(
            (dims[0] - 1) as f32,
            (dims[1] - 1) as f32,
            (dims[2] - 1) as f32,
            1.0,
        ),
    ];

    // Transform corners to world space and find min/max bounds
    let mut min_bounds = [f32::INFINITY; 3];
    let mut max_bounds = [f32::NEG_INFINITY; 3];

    for corner_voxel in corners_voxel {
        let corner_world = voxel_to_world * corner_voxel;
        for i in 0..3 {
            min_bounds[i] = min_bounds[i].min(corner_world[i]);
            max_bounds[i] = max_bounds[i].max(corner_world[i]);
        }
    }

    // Calculate center in world space
    let center_voxel = nalgebra::Vector4::new(
        (dims[0] as f32 - 1.0) * 0.5,
        (dims[1] as f32 - 1.0) * 0.5,
        (dims[2] as f32 - 1.0) * 0.5,
        1.0,
    );
    let center_world = voxel_to_world * center_voxel;

    Ok(VolumeBounds {
        min: min_bounds,
        max: max_bounds,
        center: [center_world[0], center_world[1], center_world[2]],
        dims: [dims[0] as u32, dims[1] as u32, dims[2] as u32],
    })
}

// --- 4D Volume Commands ---

#[command]
#[tracing::instrument(skip_all, err, name = "api.set_volume_timepoint")]
async fn set_volume_timepoint(
    volume_id: String,
    timepoint: usize,
    state: State<'_, BridgeState>,
) -> BridgeResult<()> {
    info!(
        "Bridge: set_volume_timepoint called for {} at timepoint {}",
        volume_id, timepoint
    );

    let mut registry = state.volume_registry.lock().await;
    registry.set_timepoint(&volume_id, timepoint)?;

    info!(
        "Successfully set timepoint {} for volume {}",
        timepoint, volume_id
    );
    Ok(())
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.get_volume_timepoint")]
async fn get_volume_timepoint(
    volume_id: String,
    state: State<'_, BridgeState>,
) -> BridgeResult<Option<usize>> {
    info!("Bridge: get_volume_timepoint called for {}", volume_id);

    let registry = state.volume_registry.lock().await;
    let timepoint = registry.get_timepoint(&volume_id);

    info!("Volume {} current timepoint: {:?}", volume_id, timepoint);
    Ok(timepoint)
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.get_volume_info")]
async fn get_volume_info(
    volume_id: String,
    state: State<'_, BridgeState>,
) -> BridgeResult<VolumeHandleInfo> {
    info!("Bridge: get_volume_info called for {}", volume_id);

    let registry = state.volume_registry.lock().await;
    let entry = registry
        .get_entry(&volume_id)
        .ok_or_else(|| BridgeError::VolumeNotFound {
            code: 4041,
            details: format!("Volume {} not found", volume_id),
        })?;

    // Extract dimensions based on volume type
    let dims = get_spatial_dims_from_volume(&entry.data);

    let handle_info = VolumeHandleInfo {
        id: volume_id.clone(),
        name: entry.metadata.name.clone(),
        dims,
        dtype: entry.metadata.dtype.clone(),
        volume_type: entry.metadata.volume_type.clone(),
        num_timepoints: entry
            .metadata
            .time_series_info
            .as_ref()
            .map(|ts| ts.num_timepoints),
        current_timepoint: entry.current_timepoint,
        time_series_info: entry.metadata.time_series_info.clone(),
    };

    Ok(handle_info)
}

/// Derive an orientation string (e.g. "RAS", "LPI") from the voxel-to-world affine.
/// Each voxel axis maps to the world axis with the largest absolute component.
fn derive_orientation_string(affine: &nalgebra::Matrix4<f32>) -> String {
    let axis_labels = [
        ['R', 'L'], // +X = R, -X = L
        ['A', 'P'], // +Y = A, -Y = P
        ['S', 'I'], // +Z = S, -Z = I
    ];
    let mut result = String::with_capacity(3);
    for voxel_axis in 0..3 {
        // Column voxel_axis gives the world direction for that voxel axis
        let col = [
            affine[(0, voxel_axis)],
            affine[(1, voxel_axis)],
            affine[(2, voxel_axis)],
        ];
        // Find which world axis this column most aligns with
        let (max_world_axis, &max_val) = col
            .iter()
            .enumerate()
            .max_by(|(_, a), (_, b)| {
                a.abs()
                    .partial_cmp(&b.abs())
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .unwrap_or((0, &col[0]));
        let label_pair = axis_labels[max_world_axis];
        result.push(if max_val >= 0.0 {
            label_pair[0]
        } else {
            label_pair[1]
        });
    }
    result
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.peek_volume_metadata")]
async fn peek_volume_metadata(
    path: String,
    state: State<'_, BridgeState>,
) -> BridgeResult<PeekVolumeMetadata> {
    info!("Bridge: peek_volume_metadata called for {}", path);

    let path_buf = PathBuf::from(&path);
    let lower = path.to_ascii_lowercase();

    // GIfTI: surface meshes have no voxel grid, so report mesh dims via the
    // gifti loader. The Files-panel only needs enough to render a one-line
    // preview row.
    if lower.ends_with(".gii") || lower.ends_with(".surf.gii") || lower.ends_with(".func.gii") {
        let kind = if lower.ends_with(".surf.gii") {
            "gifti-surf"
        } else if lower.ends_with(".func.gii") {
            "gifti-func"
        } else {
            "gifti"
        };
        return Ok(PeekVolumeMetadata {
            path: path.clone(),
            kind: kind.to_string(),
            dims: Vec::new(),
            voxel_size: Vec::new(),
            dtype: None,
            is_four_d: false,
            num_timepoints: None,
            tr: None,
        });
    }

    // Remote-backed files are only materialized locally on an explicit load
    // (see `load_file`). A header preview must NOT pull the whole (possibly
    // multi-GB) volume across SFTP just because the user selected the row, and
    // must not add to the shared SSH session's channel pressure. So if the path
    // is not present locally but resolves to a remote mount, return a light
    // stub instead of erroring; real dimensions appear once the file is loaded
    // and cached. A genuinely missing local file still falls through and errors.
    if !path_buf.exists()
        && resolve_remote_mount_for_local_path(state.inner(), &path_buf)
            .await
            .is_some()
    {
        return Ok(PeekVolumeMetadata {
            path,
            kind: "nifti".to_string(),
            dims: Vec::new(),
            voxel_size: Vec::new(),
            dtype: None,
            is_four_d: false,
            num_timepoints: None,
            tr: None,
        });
    }

    // NIfTI / NIfTI.gz: use neuroim's header-only reader. Run on the blocking
    // pool so we don't tie up the tokio reactor while reading from disk.
    let header_info = tokio::task::spawn_blocking(move || neuroim::io::read_header(&path_buf))
        .await
        .map_err(|join_err| BridgeError::Internal {
            code: 5040,
            details: format!("peek_volume_metadata join error: {join_err}"),
        })?
        .map_err(|err| BridgeError::Loader {
            code: 4040,
            details: format!("Failed to read NIfTI header: {err}"),
        })?;

    let dims = header_info.dim.clone();
    let mut voxel_size: Vec<f32> = header_info.spacing.iter().copied().take(3).collect();
    while voxel_size.len() < 3 {
        voxel_size.push(0.0);
    }

    let is_four_d = dims.len() >= 4 && dims[3] > 1;
    let num_timepoints = if is_four_d { Some(dims[3]) } else { None };
    let tr = if is_four_d && header_info.spacing.len() > 3 && header_info.spacing[3] > 0.0 {
        Some(header_info.spacing[3])
    } else {
        None
    };

    Ok(PeekVolumeMetadata {
        path,
        kind: "nifti".to_string(),
        dims,
        voxel_size,
        dtype: Some(header_info.datatype),
        is_four_d,
        num_timepoints,
        tr,
    })
}

/// Best-effort coordinate-space tag for a volume.
///
/// NIfTI xform codes are the primary signal, but unreliable in practice: many
/// genuine MNI-space files ship with sform/qform code 1 (the bundled
/// MNI152NLin2009cAsym template is (1, 1), not (4, 4)), so a filename / BIDS
/// space-entity hint is also consulted. Heuristic, not a guarantee — features
/// that auto-mount a template should treat a non-"MNI" result as "ask the user".
fn detect_coordinate_space(sform_code: i16, qform_code: i16, source: &str) -> String {
    // NIfTI code 4 explicitly declares MNI152 space.
    if sform_code == 4 || qform_code == 4 {
        return "MNI".to_string();
    }
    // Filename / BIDS space-entity hint (e.g. tpl-MNI152..., space-MNI152...,
    // ICBM152 which is the MNI registration target).
    let lower = source.to_ascii_lowercase();
    if lower.contains("mni") || lower.contains("icbm") {
        return "MNI".to_string();
    }
    match sform_code.max(qform_code) {
        3 => "talairach".to_string(),
        2 => "aligned".to_string(),
        1 => "scanner".to_string(),
        _ => "unknown".to_string(),
    }
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.get_nifti_header_info")]
async fn get_nifti_header_info(
    volume_id: String,
    state: State<'_, BridgeState>,
) -> BridgeResult<NiftiHeaderInfo> {
    info!("Bridge: get_nifti_header_info called for {}", volume_id);

    let registry = state.volume_registry.lock().await;
    let entry = registry
        .get_entry(&volume_id)
        .ok_or_else(|| BridgeError::VolumeNotFound {
            code: 4041,
            details: format!("Volume {} not found", volume_id),
        })?;

    let dims = get_spatial_dims_from_volume(&entry.data);
    let affine = get_affine_from_volume(&entry.data)?;
    let voxel_to_world = affine.to_homogeneous();

    // Flatten 4x4 matrix to row-major [f32; 16]
    let mut vtw_flat = [0.0f32; 16];
    for row in 0..4 {
        for col in 0..4 {
            vtw_flat[row * 4 + col] = voxel_to_world[(row, col)];
        }
    }

    // Approximate voxel spacing from affine column magnitudes
    let voxel_spacing = [
        (voxel_to_world[(0, 0)].powi(2)
            + voxel_to_world[(1, 0)].powi(2)
            + voxel_to_world[(2, 0)].powi(2))
        .sqrt(),
        (voxel_to_world[(0, 1)].powi(2)
            + voxel_to_world[(1, 1)].powi(2)
            + voxel_to_world[(2, 1)].powi(2))
        .sqrt(),
        (voxel_to_world[(0, 2)].powi(2)
            + voxel_to_world[(1, 2)].powi(2)
            + voxel_to_world[(2, 2)].powi(2))
        .sqrt(),
    ];

    // Compute world bounds from 8 corners of the volume
    let spatial_dims = [
        dims.first().copied().unwrap_or(1),
        dims.get(1).copied().unwrap_or(1),
        dims.get(2).copied().unwrap_or(1),
    ];
    let corners = [
        [0.0f32, 0.0, 0.0],
        [(spatial_dims[0] - 1) as f32, 0.0, 0.0],
        [0.0, (spatial_dims[1] - 1) as f32, 0.0],
        [
            (spatial_dims[0] - 1) as f32,
            (spatial_dims[1] - 1) as f32,
            0.0,
        ],
        [0.0, 0.0, (spatial_dims[2] - 1) as f32],
        [
            (spatial_dims[0] - 1) as f32,
            0.0,
            (spatial_dims[2] - 1) as f32,
        ],
        [
            0.0,
            (spatial_dims[1] - 1) as f32,
            (spatial_dims[2] - 1) as f32,
        ],
        [
            (spatial_dims[0] - 1) as f32,
            (spatial_dims[1] - 1) as f32,
            (spatial_dims[2] - 1) as f32,
        ],
    ];
    let mut world_bounds_min = [f32::INFINITY; 3];
    let mut world_bounds_max = [f32::NEG_INFINITY; 3];
    for corner in &corners {
        let world = voxel_to_world * nalgebra::Vector4::new(corner[0], corner[1], corner[2], 1.0);
        for i in 0..3 {
            world_bounds_min[i] = world_bounds_min[i].min(world[i]);
            world_bounds_max[i] = world_bounds_max[i].max(world[i]);
        }
    }

    let orientation_string = derive_orientation_string(&voxel_to_world);

    // Re-read the NIfTI xform codes from the source file (the in-memory volume
    // representation does not retain them). Best-effort: synthetic/in-memory
    // volumes (path "<memory>") or moved files fall back to (0, 0) -> unknown.
    let (sform_code, qform_code) =
        nifti_loader::read_xform_codes(std::path::Path::new(&entry.metadata.path))
            .unwrap_or((0, 0));
    let coordinate_space = detect_coordinate_space(sform_code, qform_code, &entry.metadata.path);

    // Extract 4D metadata if available
    let (num_timepoints, tr_seconds, temporal_units) = match &entry.metadata.time_series_info {
        Some(ts) => (Some(ts.num_timepoints), ts.tr, ts.temporal_unit.clone()),
        None => (None, None, None),
    };

    Ok(NiftiHeaderInfo {
        filename: entry.metadata.path.clone(),
        dimensions: dims,
        voxel_spacing,
        data_type: entry.metadata.dtype.clone(),
        voxel_to_world: vtw_flat,
        world_bounds_min,
        world_bounds_max,
        sform_code: sform_code.max(0) as u8,
        qform_code: qform_code.max(0) as u8,
        coordinate_space,
        orientation_string,
        spatial_units: "mm".to_string(),
        temporal_units,
        tr_seconds,
        num_timepoints,
        description: String::new(),
        data_range: None,
    })
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.get_initial_views")]
async fn get_initial_views(
    volume_id: String,
    max_px: Vec<u32>, // [width, height]
    state: State<'_, BridgeState>,
) -> BridgeResult<HashMap<String, ViewRectMm>> {
    info!(
        "Bridge: get_initial_views called for {} with max_px: {:?}",
        volume_id, max_px
    );

    // Validate max_px input
    if max_px.len() != 2 {
        return Err(BridgeError::Input {
            code: 4001,
            details: "max_px must have exactly 2 elements [width, height]".to_string(),
        });
    }
    let screen_px_max = [max_px[0], max_px[1]];

    // Get volume from registry
    let volume_registry = state.volume_registry.lock().await;
    let volume_data =
        volume_registry
            .get(&volume_id)
            .ok_or_else(|| BridgeError::VolumeNotFound {
                code: 4041,
                details: format!("Volume '{}' not found", volume_id),
            })?;

    // Extract dimensions and voxel_to_world transform
    let dims_vec = get_spatial_dims_from_volume(volume_data);
    let dims = [dims_vec[0], dims_vec[1], dims_vec[2]];
    let affine = get_affine_from_volume(volume_data)?;
    let voxel_to_world = affine.to_homogeneous();

    // Create VolumeMetadata for ViewRectMm calculations
    let volume_meta = VolumeMetadata {
        dimensions: [dims[0], dims[1], dims[2]],
        voxel_to_world,
    };

    // Calculate center of volume in world coordinates
    let center_voxel = [
        (dims[0] as f32 - 1.0) / 2.0,
        (dims[1] as f32 - 1.0) / 2.0,
        (dims[2] as f32 - 1.0) / 2.0,
    ];
    let center_world_point = voxel_to_world
        * nalgebra::Point4::new(center_voxel[0], center_voxel[1], center_voxel[2], 1.0);
    let crosshair_world = [
        center_world_point[0] / center_world_point[3],
        center_world_point[1] / center_world_point[3],
        center_world_point[2] / center_world_point[3],
    ];

    // Calculate views for all three orientations
    let mut views = HashMap::new();

    // Axial view
    let axial_view = ViewRectMm::full_extent(
        &volume_meta,
        ViewOrientation::Axial,
        crosshair_world,
        screen_px_max,
    );
    views.insert("axial".to_string(), axial_view);

    // Sagittal view
    let sagittal_view = ViewRectMm::full_extent(
        &volume_meta,
        ViewOrientation::Sagittal,
        crosshair_world,
        screen_px_max,
    );
    views.insert("sagittal".to_string(), sagittal_view);

    // Coronal view
    let coronal_view = ViewRectMm::full_extent(
        &volume_meta,
        ViewOrientation::Coronal,
        crosshair_world,
        screen_px_max,
    );
    views.insert("coronal".to_string(), coronal_view);

    Ok(views)
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.recalculate_view_for_dimensions")]
async fn recalculate_view_for_dimensions(
    volume_id: String,
    view_type: String,      // "axial", "sagittal", or "coronal"
    dimensions: Vec<u32>,   // [width, height]
    crosshair_mm: Vec<f32>, // [x, y, z]
    state: State<'_, BridgeState>,
) -> BridgeResult<ViewRectMm> {
    debug!("[Backend] recalculate_view_for_dimensions called:");
    debug!("  - volume_id: {}", volume_id);
    debug!("  - view_type: {}", view_type);
    debug!("  - requested dimensions: {:?}", dimensions);
    debug!("  - crosshair_mm: {:?}", crosshair_mm);

    // Validate inputs
    if dimensions.len() != 2 {
        return Err(BridgeError::Input {
            code: 4001,
            details: "dimensions must have exactly 2 elements [width, height]".to_string(),
        });
    }
    if crosshair_mm.len() != 3 {
        return Err(BridgeError::Input {
            code: 4001,
            details: "crosshair_mm must have exactly 3 elements [x, y, z]".to_string(),
        });
    }

    let screen_px_max = [dimensions[0], dimensions[1]];
    let crosshair_world = [crosshair_mm[0], crosshair_mm[1], crosshair_mm[2]];

    debug!("[Backend] Parsed parameters:");
    debug!("  - screen_px_max: {:?}", screen_px_max);
    debug!("  - crosshair_world: {:?}", crosshair_world);

    // Parse view type
    let orientation = match view_type.as_str() {
        "axial" => ViewOrientation::Axial,
        "sagittal" => ViewOrientation::Sagittal,
        "coronal" => ViewOrientation::Coronal,
        _ => {
            return Err(BridgeError::Input {
                code: 4001,
                details: format!(
                    "Invalid view type: {}. Must be 'axial', 'sagittal', or 'coronal'",
                    view_type
                ),
            });
        }
    };

    // Get volume from registry
    let volume_registry = state.volume_registry.lock().await;
    let volume_data =
        volume_registry
            .get(&volume_id)
            .ok_or_else(|| BridgeError::VolumeNotFound {
                code: 4041,
                details: format!("Volume '{}' not found", volume_id),
            })?;

    // Extract dimensions and voxel_to_world transform
    let dims_vec = get_spatial_dims_from_volume(volume_data);
    let dims = [dims_vec[0], dims_vec[1], dims_vec[2]];
    let affine = get_affine_from_volume(volume_data)?;
    let voxel_to_world = affine.to_homogeneous();

    debug!("[Backend] Volume metadata:");
    debug!("  - volume dims: {:?}", dims);
    debug!("  - voxel_to_world transform: {:?}", voxel_to_world);

    // Create VolumeMetadata
    let volume_meta = VolumeMetadata {
        dimensions: [dims[0], dims[1], dims[2]],
        voxel_to_world,
    };

    // Calculate view using the same logic as get_initial_views
    debug!("[Backend] Calling ViewRectMm::full_extent with:");
    debug!("  - orientation: {:?}", orientation);
    debug!("  - crosshair_world: {:?}", crosshair_world);
    debug!("  - screen_px_max: {:?}", screen_px_max);

    let view = ViewRectMm::full_extent(&volume_meta, orientation, crosshair_world, screen_px_max);

    debug!("[Backend] Calculated ViewRectMm:");
    debug!("  - origin_mm: {:?}", view.origin_mm);
    debug!("  - u_mm: {:?}", view.u_mm);
    debug!("  - v_mm: {:?}", view.v_mm);
    debug!("  - width_px: {}", view.width_px);
    debug!("  - height_px: {}", view.height_px);

    // Log pixel sizes
    let u_pixel_size = (view.u_mm[0].powi(2) + view.u_mm[1].powi(2) + view.u_mm[2].powi(2)).sqrt();
    let v_pixel_size = (view.v_mm[0].powi(2) + view.v_mm[1].powi(2) + view.v_mm[2].powi(2)).sqrt();
    debug!("[Backend] Pixel sizes:");
    debug!("  - u pixel size: {} mm", u_pixel_size);
    debug!("  - v pixel size: {} mm", v_pixel_size);

    // CRITICAL: Check if calculated dimensions match requested
    if view.width_px != screen_px_max[0] || view.height_px != screen_px_max[1] {
        warn!("[Backend] ⚠️ WARNING: Calculated dimensions differ from requested!");
        warn!("  - Requested: {}x{}", screen_px_max[0], screen_px_max[1]);
        warn!("  - Calculated: {}x{}", view.width_px, view.height_px);
    }

    Ok(view)
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.recalculate_all_views")]
async fn recalculate_all_views(
    volume_id: String,
    dimensions_by_view: HashMap<String, Vec<u32>>,
    crosshair_mm: Vec<f32>, // [x, y, z]
    state: State<'_, BridgeState>,
) -> BridgeResult<HashMap<String, ViewRectMm>> {
    info!(
        "Bridge: recalculate_all_views called for {} with dims {:?} and crosshair {:?}",
        volume_id, dimensions_by_view, crosshair_mm
    );

    if crosshair_mm.len() != 3 {
        return Err(BridgeError::Input {
            code: 4001,
            details: "crosshair_mm must have exactly 3 elements [x, y, z]".to_string(),
        });
    }

    let crosshair_world = [crosshair_mm[0], crosshair_mm[1], crosshair_mm[2]];

    let mut resolved_dims: HashMap<&str, [u32; 2]> = HashMap::new();
    for key in ["axial", "sagittal", "coronal"] {
        let dims_vec = dimensions_by_view
            .get(key)
            .ok_or_else(|| BridgeError::Input {
                code: 4001,
                details: format!(
                    "dimensions missing for view '{}'. Expected keys: axial, sagittal, coronal",
                    key
                ),
            })?;
        if dims_vec.len() != 2 {
            return Err(BridgeError::Input {
                code: 4001,
                details: format!(
                    "dimensions for view '{}' must have exactly 2 elements [width, height]",
                    key
                ),
            });
        }
        resolved_dims.insert(key, [dims_vec[0], dims_vec[1]]);
    }

    let volume_registry = state.volume_registry.lock().await;
    let volume_data =
        volume_registry
            .get(&volume_id)
            .ok_or_else(|| BridgeError::VolumeNotFound {
                code: 4041,
                details: format!("Volume '{}' not found", volume_id),
            })?;

    let dims_vec = get_spatial_dims_from_volume(volume_data);
    let dims = [dims_vec[0], dims_vec[1], dims_vec[2]];
    let affine = get_affine_from_volume(volume_data)?;
    let voxel_to_world = affine.to_homogeneous();

    let volume_meta = VolumeMetadata {
        dimensions: [dims[0], dims[1], dims[2]],
        voxel_to_world,
    };

    let mut views = HashMap::new();

    for (key, orientation) in [
        ("axial", ViewOrientation::Axial),
        ("sagittal", ViewOrientation::Sagittal),
        ("coronal", ViewOrientation::Coronal),
    ] {
        let dims = resolved_dims
            .get(key)
            .copied()
            .ok_or_else(|| BridgeError::Input {
                code: 4001,
                details: format!(
                    "Internal error - missing resolved dimensions for view '{}'",
                    key
                ),
            })?;
        let view = ViewRectMm::full_extent(&volume_meta, orientation, crosshair_world, dims);
        debug!(
            "[recalculate_all_views] {:?} view -> origin {:?}, dims {}x{}",
            orientation, view.origin_mm, view.width_px, view.height_px
        );
        views.insert(key.to_string(), view);
    }

    Ok(views)
}

pub async fn request_layer_gpu_resources_for_testing(
    layer_spec: LayerSpec,
    metadata_only: Option<bool>,
    bridge_state: &BridgeState,
) -> BridgeResult<VolumeLayerGpuInfo> {
    let state = bridge_state;
    // Update return type
    info!(
        "Bridge: request_layer_gpu_resources called with spec: {:?}",
        layer_spec
    );
    info!("Bridge: request_layer_gpu_resources called");
    // error!("request_layer_gpu_resources is not implemented yet!"); // Remove error log

    match &layer_spec {
        LayerSpec::Volume(vol_spec) => {
            let source_volume_id = vol_spec.source_resource_id.clone();
            let ui_layer_id = vol_spec.id.clone();
            let metadata_only_flag = metadata_only.unwrap_or(false);

            info!(
                "Requesting {} for UI layer '{}' (source volume '{}')",
                if metadata_only_flag {
                    "metadata only"
                } else {
                    "GPU resources"
                },
                ui_layer_id,
                source_volume_id
            );

            // --- 1. Get the RenderLoopService handle (only if not metadata_only) ---
            // Clone the inner Arc<Mutex<RenderLoopService>> and release the outer lock
            // immediately. The heavy upload below runs on a blocking thread and locks
            // this itself, so we must NOT hold a guard across it (that would deadlock
            // the blocking task's blocking_lock).
            let service_arc = if !metadata_only_flag {
                let guard = state.render_loop_service.lock().await;
                let arc = guard
                    .as_ref()
                    .ok_or_else(|| {
                        error!("RenderLoopService is not available.");
                        BridgeError::ServiceNotInitialized {
                            code: 5002,
                            details: "GPU rendering service is not initialized. Please ensure the application has started correctly.".to_string()
                        }
                    })?
                    .clone();
                Some(arc)
            } else {
                None
            };

            // --- 2. Get VolumeSendable with Enhanced Registry Verification ---
            let volume_registry_guard = state.volume_registry.lock().await;

            // Enhanced verification for template loading timing issues
            if !volume_registry_guard
                .volumes
                .contains_key(&source_volume_id)
            {
                warn!(
                    "Volume {} not found in registry during GPU allocation - possible timing issue",
                    source_volume_id
                );

                // Log registry state for debugging
                info!(
                    "Registry contains {} volumes: {:?}",
                    volume_registry_guard.volumes.len(),
                    volume_registry_guard.volumes.keys().collect::<Vec<_>>()
                );

                drop(volume_registry_guard);
                return Err(BridgeError::VolumeNotFound {
                    code: 4044,
                    details: format!(
                        "Volume {} not ready in registry. This may indicate a timing issue between template loading and GPU allocation.",
                        source_volume_id
                    ),
                });
            }

            let volume_arc = volume_registry_guard
                .get_render_arc(&source_volume_id)
                .ok_or_else(|| {
                    error!("Volume not found in registry: {}", source_volume_id);
                    BridgeError::VolumeNotFound {
                        code: 4042,
                        details: format!(
                            "Volume '{}' not found. Please load the volume first using load_file.",
                            source_volume_id
                        ),
                    }
                })?;

            // Atlas/parcellation volumes are discrete label maps; they must keep exact
            // integer ids on the GPU (no R8Unorm normalization). load_atlas tags them
            // with an "atlas:" metadata path.
            let is_label_atlas = volume_registry_guard
                .get_entry(&source_volume_id)
                .map(|e| e.metadata.path.starts_with("atlas:"))
                .unwrap_or(false);

            // Capture the current 4D timepoint before releasing the registry lock so
            // neither the off-reactor upload nor the post-upload bookkeeping needs the
            // registry. `timepoint` is the unwrapped index used during upload;
            // `timepoint_opt` preserves the None-vs-Some distinction the layer map wants.
            let timepoint_opt = volume_registry_guard.get_timepoint(&source_volume_id);
            let timepoint = timepoint_opt.unwrap_or(0);

            // Release the registry lock now. Everything downstream reads the volume
            // through this Arc clone, so the lock is no longer needed -- and it must
            // not be held across the heavy upload.
            drop(volume_registry_guard);
            let volume_data: &VolumeSendable = volume_arc.as_ref();

            // --- 3. Extract slice parameters from layer spec ---
            let slice_axis = vol_spec.slice_axis.unwrap_or_default();
            let slice_index_spec = vol_spec.slice_index.clone().unwrap_or_default();

            // Get volume dimensions to calculate actual slice index
            let vol_dims_temp = get_spatial_dims_from_volume(volume_data);

            // Calculate the actual slice index based on the specification
            let _slice_idx =
                calculate_slice_index(&slice_index_spec, &vol_dims_temp, slice_axis, volume_data)?;

            // Upload the entire volume as a 3D texture and get the world-to-voxel transform
            // Skip if metadata_only is true
            let (atlas_layer_idx, volume_world_to_voxel) = if metadata_only_flag {
                info!("Metadata-only mode: skipping GPU upload");
                (u32::MAX, nalgebra::Matrix4::<f32>::identity()) // Dummy values
            } else {
                debug!("About to upload volume to GPU (off the async reactor)");
                // Run the heavy convert + GPU write on a blocking thread so the async
                // reactor stays responsive, holding ONLY the render-service lock (the
                // registry lock was already dropped). The volume is an Arc clone.
                let upload_service = service_arc
                    .clone()
                    .expect("service arc present when not in metadata_only mode");
                let upload_volume = volume_arc.clone();
                let upload_ui_layer_id = ui_layer_id.clone();
                tokio::task::spawn_blocking(
                    move || -> BridgeResult<(u32, nalgebra::Matrix4<f32>)> {
                        let mut render_service_guard = upload_service.blocking_lock();
                        let render_service = &mut *render_service_guard;
                        let volume_data: &VolumeSendable = upload_volume.as_ref();
                        let ui_layer_id = upload_ui_layer_id;
                        let upload_result = match volume_data {
                            VolumeSendable::VolF32(vol, _) => {
                                debug!("Uploading F32 volume with {} voxels", vol.data().len());
                                render_service
                                    .upload_volume_3d_labelaware(vol, is_label_atlas)
                                    .map_err(|e| {
                                        gpu_allocation_error(&ui_layer_id, &e.to_string())
                                    })?
                            }
                            VolumeSendable::VolI16(vol, _) => render_service
                                .upload_volume_3d_labelaware(vol, is_label_atlas)
                                .map_err(|e| gpu_allocation_error(&ui_layer_id, &e.to_string()))?,
                            VolumeSendable::VolU8(vol, _) => render_service
                                .upload_volume_3d_labelaware(vol, is_label_atlas)
                                .map_err(|e| gpu_allocation_error(&ui_layer_id, &e.to_string()))?,
                            VolumeSendable::VolI8(vol, _) => render_service
                                .upload_volume_3d_labelaware(vol, is_label_atlas)
                                .map_err(|e| gpu_allocation_error(&ui_layer_id, &e.to_string()))?,
                            VolumeSendable::VolU16(vol, _) => render_service
                                .upload_volume_3d_labelaware(vol, is_label_atlas)
                                .map_err(|e| gpu_allocation_error(&ui_layer_id, &e.to_string()))?,
                            VolumeSendable::VolI32(vol, _) => render_service
                                .upload_volume_3d_labelaware(vol, is_label_atlas)
                                .map_err(|e| gpu_allocation_error(&ui_layer_id, &e.to_string()))?,
                            VolumeSendable::VolU32(vol, _) => render_service
                                .upload_volume_3d_labelaware(vol, is_label_atlas)
                                .map_err(|e| gpu_allocation_error(&ui_layer_id, &e.to_string()))?,
                            VolumeSendable::VolF64(vol, _) => render_service
                                .upload_volume_3d_labelaware(vol, is_label_atlas)
                                .map_err(|e| gpu_allocation_error(&ui_layer_id, &e.to_string()))?,
                            // 4D volumes - extract current timepoint
                            VolumeSendable::Vec4DF32(_vec) => {
                                // Get the current timepoint from the registry
                                info!("Extracting timepoint {} from 4D F32 volume", timepoint);

                                // Extract 3D volume at the specified timepoint
                                let extracted =
                                    extract_3d_volume_at_timepoint(volume_data, timepoint)?;

                                // Upload the extracted 3D volume
                                match extracted {
                                    VolumeSendable::VolF32(vol, _) => {
                                        render_service.upload_volume_3d(&vol).map_err(|e| {
                                            gpu_allocation_error(&ui_layer_id, &e.to_string())
                                        })?
                                    }
                                    _ => {
                                        return Err(BridgeError::Internal {
                                            code: 5014,
                                            details: "Unexpected volume type after 4D extraction"
                                                .to_string(),
                                        });
                                    }
                                }
                            }
                            VolumeSendable::Vec4DI16(_vec) => {
                                info!("Extracting timepoint {} from 4D I16 volume", timepoint);
                                let extracted =
                                    extract_3d_volume_at_timepoint(volume_data, timepoint)?;
                                match extracted {
                                    VolumeSendable::VolI16(vol, _) => {
                                        render_service.upload_volume_3d(&vol).map_err(|e| {
                                            gpu_allocation_error(&ui_layer_id, &e.to_string())
                                        })?
                                    }
                                    _ => {
                                        return Err(BridgeError::Internal {
                                            code: 5014,
                                            details: "Unexpected volume type after 4D extraction"
                                                .to_string(),
                                        });
                                    }
                                }
                            }
                            VolumeSendable::Vec4DU8(_vec) => {
                                info!("Extracting timepoint {} from 4D U8 volume", timepoint);
                                let extracted =
                                    extract_3d_volume_at_timepoint(volume_data, timepoint)?;
                                match extracted {
                                    VolumeSendable::VolU8(vol, _) => {
                                        render_service.upload_volume_3d(&vol).map_err(|e| {
                                            gpu_allocation_error(&ui_layer_id, &e.to_string())
                                        })?
                                    }
                                    _ => {
                                        return Err(BridgeError::Internal {
                                            code: 5014,
                                            details: "Unexpected volume type after 4D extraction"
                                                .to_string(),
                                        });
                                    }
                                }
                            }
                            VolumeSendable::Vec4DI8(_vec) => {
                                info!("Extracting timepoint {} from 4D I8 volume", timepoint);
                                let extracted =
                                    extract_3d_volume_at_timepoint(volume_data, timepoint)?;
                                match extracted {
                                    VolumeSendable::VolI8(vol, _) => {
                                        render_service.upload_volume_3d(&vol).map_err(|e| {
                                            gpu_allocation_error(&ui_layer_id, &e.to_string())
                                        })?
                                    }
                                    _ => {
                                        return Err(BridgeError::Internal {
                                            code: 5014,
                                            details: "Unexpected volume type after 4D extraction"
                                                .to_string(),
                                        });
                                    }
                                }
                            }
                            VolumeSendable::Vec4DU16(_vec) => {
                                info!("Extracting timepoint {} from 4D U16 volume", timepoint);
                                let extracted =
                                    extract_3d_volume_at_timepoint(volume_data, timepoint)?;
                                match extracted {
                                    VolumeSendable::VolU16(vol, _) => {
                                        render_service.upload_volume_3d(&vol).map_err(|e| {
                                            gpu_allocation_error(&ui_layer_id, &e.to_string())
                                        })?
                                    }
                                    _ => {
                                        return Err(BridgeError::Internal {
                                            code: 5014,
                                            details: "Unexpected volume type after 4D extraction"
                                                .to_string(),
                                        });
                                    }
                                }
                            }
                            VolumeSendable::Vec4DI32(_vec) => {
                                info!("Extracting timepoint {} from 4D I32 volume", timepoint);
                                let extracted =
                                    extract_3d_volume_at_timepoint(volume_data, timepoint)?;
                                match extracted {
                                    VolumeSendable::VolI32(vol, _) => {
                                        render_service.upload_volume_3d(&vol).map_err(|e| {
                                            gpu_allocation_error(&ui_layer_id, &e.to_string())
                                        })?
                                    }
                                    _ => {
                                        return Err(BridgeError::Internal {
                                            code: 5014,
                                            details: "Unexpected volume type after 4D extraction"
                                                .to_string(),
                                        });
                                    }
                                }
                            }
                            VolumeSendable::Vec4DU32(_vec) => {
                                info!("Extracting timepoint {} from 4D U32 volume", timepoint);
                                let extracted =
                                    extract_3d_volume_at_timepoint(volume_data, timepoint)?;
                                match extracted {
                                    VolumeSendable::VolU32(vol, _) => {
                                        render_service.upload_volume_3d(&vol).map_err(|e| {
                                            gpu_allocation_error(&ui_layer_id, &e.to_string())
                                        })?
                                    }
                                    _ => {
                                        return Err(BridgeError::Internal {
                                            code: 5014,
                                            details: "Unexpected volume type after 4D extraction"
                                                .to_string(),
                                        });
                                    }
                                }
                            }
                            VolumeSendable::Vec4DF64(_vec) => {
                                info!("Extracting timepoint {} from 4D F64 volume", timepoint);
                                let extracted =
                                    extract_3d_volume_at_timepoint(volume_data, timepoint)?;
                                match extracted {
                                    VolumeSendable::VolF64(vol, _) => {
                                        render_service.upload_volume_3d(&vol).map_err(|e| {
                                            gpu_allocation_error(&ui_layer_id, &e.to_string())
                                        })?
                                    }
                                    _ => {
                                        return Err(BridgeError::Internal {
                                            code: 5014,
                                            details: "Unexpected volume type after 4D extraction"
                                                .to_string(),
                                        });
                                    }
                                }
                            }
                        };
                        Ok(upload_result)
                    },
                )
                .await
                .map_err(|e| BridgeError::Internal {
                    code: 5099,
                    details: format!("GPU upload task panicked: {e}"),
                })??
            };

            // Re-acquire the render-service lock for the light post-upload bookkeeping
            // below (data range, declarative registration, layer add). It was released
            // when the blocking upload task finished.
            let mut render_loop_service = match service_arc.as_ref() {
                Some(arc) => Some(arc.lock().await),
                None => None,
            };

            // For 3D textures, texture coordinates are always the full texture
            let (u_min, v_min, u_max, v_max) = (0.0, 0.0, 1.0, 1.0);

            // Get volume dimensions and format for the response
            let spatial_dims = get_spatial_dims_from_volume(volume_data);
            let vol_dims = [
                spatial_dims[0] as u32,
                spatial_dims[1] as u32,
                spatial_dims[2] as u32,
            ];

            let gpu_format = match volume_data {
                VolumeSendable::VolF32(_, _) | VolumeSendable::Vec4DF32(_) => {
                    GpuTextureFormat::R32Float
                }
                VolumeSendable::VolI16(_, _) | VolumeSendable::Vec4DI16(_) => {
                    GpuTextureFormat::R16Float
                }
                VolumeSendable::VolU8(_, _) | VolumeSendable::Vec4DU8(_) => {
                    GpuTextureFormat::R8Unorm
                }
                VolumeSendable::VolI8(_, _) | VolumeSendable::Vec4DI8(_) => {
                    GpuTextureFormat::R8Unorm
                }
                VolumeSendable::VolU16(_, _) | VolumeSendable::Vec4DU16(_) => {
                    GpuTextureFormat::R16Float
                }
                VolumeSendable::VolI32(_, _) | VolumeSendable::Vec4DI32(_) => {
                    GpuTextureFormat::R32Float
                }
                VolumeSendable::VolU32(_, _) | VolumeSendable::Vec4DU32(_) => {
                    GpuTextureFormat::R32Float
                }
                VolumeSendable::VolF64(_, _) | VolumeSendable::Vec4DF64(_) => {
                    GpuTextureFormat::R32Float
                }
            };

            // Get the affine transform (voxel to world) and extract space info - clone before dropping the guard
            let affine = get_affine_from_volume(volume_data)?;

            let (origin, spacing) = match volume_data {
                // 3D volumes
                VolumeSendable::VolF32(vol, _) => {
                    let space = vol.space();
                    (space.origin().to_vec(), space.spacing().to_vec())
                }
                VolumeSendable::VolI16(vol, _) => {
                    let space = vol.space();
                    (space.origin().to_vec(), space.spacing().to_vec())
                }
                VolumeSendable::VolU8(vol, _) => {
                    let space = vol.space();
                    (space.origin().to_vec(), space.spacing().to_vec())
                }
                VolumeSendable::VolI8(vol, _) => {
                    let space = vol.space();
                    (space.origin().to_vec(), space.spacing().to_vec())
                }
                VolumeSendable::VolU16(vol, _) => {
                    let space = vol.space();
                    (space.origin().to_vec(), space.spacing().to_vec())
                }
                VolumeSendable::VolI32(vol, _) => {
                    let space = vol.space();
                    (space.origin().to_vec(), space.spacing().to_vec())
                }
                VolumeSendable::VolU32(vol, _) => {
                    let space = vol.space();
                    (space.origin().to_vec(), space.spacing().to_vec())
                }
                VolumeSendable::VolF64(vol, _) => {
                    let space = vol.space();
                    (space.origin().to_vec(), space.spacing().to_vec())
                }
                // 4D volumes
                VolumeSendable::Vec4DF32(vec) => {
                    let space = &vec.space;
                    // Extract origin and spacing from first 3 dimensions, converting to f32
                    let origin = vec![
                        space.origin[0] as f32,
                        space.origin[1] as f32,
                        space.origin[2] as f32,
                    ];
                    let spacing = vec![
                        space.spacing[0] as f32,
                        space.spacing[1] as f32,
                        space.spacing[2] as f32,
                    ];
                    (origin, spacing)
                }
                VolumeSendable::Vec4DI16(vec) => {
                    let space = &vec.space;
                    let origin = vec![
                        space.origin[0] as f32,
                        space.origin[1] as f32,
                        space.origin[2] as f32,
                    ];
                    let spacing = vec![
                        space.spacing[0] as f32,
                        space.spacing[1] as f32,
                        space.spacing[2] as f32,
                    ];
                    (origin, spacing)
                }
                VolumeSendable::Vec4DU8(vec) => {
                    let space = &vec.space;
                    let origin = vec![
                        space.origin[0] as f32,
                        space.origin[1] as f32,
                        space.origin[2] as f32,
                    ];
                    let spacing = vec![
                        space.spacing[0] as f32,
                        space.spacing[1] as f32,
                        space.spacing[2] as f32,
                    ];
                    (origin, spacing)
                }
                VolumeSendable::Vec4DI8(vec) => {
                    let space = &vec.space;
                    let origin = vec![
                        space.origin[0] as f32,
                        space.origin[1] as f32,
                        space.origin[2] as f32,
                    ];
                    let spacing = vec![
                        space.spacing[0] as f32,
                        space.spacing[1] as f32,
                        space.spacing[2] as f32,
                    ];
                    (origin, spacing)
                }
                VolumeSendable::Vec4DU16(vec) => {
                    let space = &vec.space;
                    let origin = vec![
                        space.origin[0] as f32,
                        space.origin[1] as f32,
                        space.origin[2] as f32,
                    ];
                    let spacing = vec![
                        space.spacing[0] as f32,
                        space.spacing[1] as f32,
                        space.spacing[2] as f32,
                    ];
                    (origin, spacing)
                }
                VolumeSendable::Vec4DI32(vec) => {
                    let space = &vec.space;
                    let origin = vec![
                        space.origin[0] as f32,
                        space.origin[1] as f32,
                        space.origin[2] as f32,
                    ];
                    let spacing = vec![
                        space.spacing[0] as f32,
                        space.spacing[1] as f32,
                        space.spacing[2] as f32,
                    ];
                    (origin, spacing)
                }
                VolumeSendable::Vec4DU32(vec) => {
                    let space = &vec.space;
                    let origin = vec![
                        space.origin[0] as f32,
                        space.origin[1] as f32,
                        space.origin[2] as f32,
                    ];
                    let spacing = vec![
                        space.spacing[0] as f32,
                        space.spacing[1] as f32,
                        space.spacing[2] as f32,
                    ];
                    (origin, spacing)
                }
                VolumeSendable::Vec4DF64(vec) => {
                    let space = &vec.space;
                    let origin = vec![
                        space.origin[0] as f32,
                        space.origin[1] as f32,
                        space.origin[2] as f32,
                    ];
                    let spacing = vec![
                        space.spacing[0] as f32,
                        space.spacing[1] as f32,
                        space.spacing[2] as f32,
                    ];
                    (origin, spacing)
                }
            };

            // Get world_to_voxel matrix (inverse of voxel_to_world affine)
            let voxel_to_world = affine.to_homogeneous();
            let world_to_voxel = voxel_to_world
                .try_inverse()
                .unwrap_or_else(Matrix4::identity);

            // CRITICAL FIX: Convert to column-major order for WGSL
            // WGSL expects mat4x4<f32> in column-major order
            // nalgebra uses column-major internally, but we need to flatten correctly
            let world_to_voxel_flat: [f32; 16] = [
                world_to_voxel[(0, 0)],
                world_to_voxel[(1, 0)],
                world_to_voxel[(2, 0)],
                world_to_voxel[(3, 0)], // Column 0
                world_to_voxel[(0, 1)],
                world_to_voxel[(1, 1)],
                world_to_voxel[(2, 1)],
                world_to_voxel[(3, 1)], // Column 1
                world_to_voxel[(0, 2)],
                world_to_voxel[(1, 2)],
                world_to_voxel[(2, 2)],
                world_to_voxel[(3, 2)], // Column 2
                world_to_voxel[(0, 3)],
                world_to_voxel[(1, 3)],
                world_to_voxel[(2, 3)],
                world_to_voxel[(3, 3)], // Column 3
            ];

            // Convert voxel_to_world matrix to flat array (column-major for WGSL)
            let voxel_to_world_flat: [f32; 16] = [
                voxel_to_world[(0, 0)],
                voxel_to_world[(1, 0)],
                voxel_to_world[(2, 0)],
                voxel_to_world[(3, 0)], // Column 0
                voxel_to_world[(0, 1)],
                voxel_to_world[(1, 1)],
                voxel_to_world[(2, 1)],
                voxel_to_world[(3, 1)], // Column 1
                voxel_to_world[(0, 2)],
                voxel_to_world[(1, 2)],
                voxel_to_world[(2, 2)],
                voxel_to_world[(3, 2)], // Column 2
                voxel_to_world[(0, 3)],
                voxel_to_world[(1, 3)],
                voxel_to_world[(2, 3)],
                voxel_to_world[(3, 3)], // Column 3
            ];

            // Calculate center world coordinates
            let center_voxel = nalgebra::Vector4::new(
                (vol_dims[0] as f32 - 1.0) * 0.5,
                (vol_dims[1] as f32 - 1.0) * 0.5,
                (vol_dims[2] as f32 - 1.0) * 0.5,
                1.0,
            );
            let center_world = voxel_to_world * center_voxel;
            let center_world_coords = [center_world.x, center_world.y, center_world.z];

            debug!(
                "Volume center calculation: voxel [{:.1}, {:.1}, {:.1}] -> world [{:.1}, {:.1}, {:.1}]",
                center_voxel.x,
                center_voxel.y,
                center_voxel.z,
                center_world_coords[0],
                center_world_coords[1],
                center_world_coords[2]
            );

            // Debug the transform matrices - log in column-major format for nalgebra
            debug!("Voxel Dims: {:?}", vol_dims);
            debug!(
                "Center Voxel Input: [{:.1}, {:.1}, {:.1}, {:.1}]",
                center_voxel.x, center_voxel.y, center_voxel.z, center_voxel.w
            );
            debug!("Voxel-to-world transform matrix (column-major):");
            for i in 0..4 {
                debug!(
                    "  [{:.3}, {:.3}, {:.3}, {:.3}]",
                    voxel_to_world[(i, 0)],
                    voxel_to_world[(i, 1)],
                    voxel_to_world[(i, 2)],
                    voxel_to_world[(i, 3)]
                );
            }
            debug!("World-to-voxel transform matrix (column-major):");
            for i in 0..4 {
                debug!(
                    "  [{:.3}, {:.3}, {:.3}, {:.3}]",
                    world_to_voxel[(i, 0)],
                    world_to_voxel[(i, 1)],
                    world_to_voxel[(i, 2)],
                    world_to_voxel[(i, 3)]
                );
            }

            // Also log the affine directly
            debug!("Original affine from NIfTI:");
            let affine_matrix = affine.to_homogeneous();
            for i in 0..4 {
                debug!(
                    "  [{:.3}, {:.3}, {:.3}, {:.3}]",
                    affine_matrix[(i, 0)],
                    affine_matrix[(i, 1)],
                    affine_matrix[(i, 2)],
                    affine_matrix[(i, 3)]
                );
            }

            // Determine slice dimensions based on axis
            let _slice_dims = match slice_axis {
                SliceAxis::Sagittal => [vol_dims[1], vol_dims[2]], // YZ plane
                SliceAxis::Coronal => [vol_dims[0], vol_dims[2]],  // XZ plane
                SliceAxis::Axial => [vol_dims[0], vol_dims[1]],    // XY plane
            };

            // Create slice info - use axis 255 to indicate full 3D volume
            let slice_info = SliceInfo {
                axis: 255, // Special value indicating 3D volume, not a slice
                index: 0,  // Not used for 3D volumes
                axis_name: "3D Volume".to_string(),
                dimensions: [vol_dims[0], vol_dims[1]], // Just use first two dims for compatibility
            };

            // Create texture coordinates
            let texture_coords = TextureCoordinates {
                u_min,
                v_min,
                u_max,
                v_max,
            };

            // Get current timestamp
            let allocated_at = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();

            debug!(
                "Successfully uploaded volume to GPU - layer_id: {}, atlas_layer: {}, dims: {:?}, format: {:?}",
                ui_layer_id, atlas_layer_idx, vol_dims, gpu_format
            );
            debug!(
                "Texture coordinates - u: [{:.4}, {:.4}], v: [{:.4}, {:.4}]",
                u_min, u_max, v_min, v_max
            );

            // --- Compute data range and binary-like flag ---
            let (min_val, max_val) = if metadata_only_flag {
                compute_data_range_from_volume(volume_data)
            } else {
                let render_service = render_loop_service
                    .as_ref()
                    .expect("RenderLoopService should be available when not in metadata_only mode");
                render_service
                    .get_volume_data_range(atlas_layer_idx)
                    .unwrap_or_else(|| {
                        warn!(
                            "No cached data_range for atlas index {}; falling back to CPU scan",
                            atlas_layer_idx
                        );
                        compute_data_range_from_volume(volume_data)
                    })
            };
            let is_binary_like = (min_val >= 0.0 && max_val <= 1.0) && ((max_val - min_val) <= 1.0);
            let data_range = Some(DataRange {
                min: min_val,
                max: max_val,
            });

            // Get colormap ID first
            let colormap_id = match colormap_by_name(&vol_spec.colormap) {
                Some(id) => id.id() as u32,
                None => {
                    error!(
                        "Unknown colormap '{}', defaulting to grayscale",
                        vol_spec.colormap
                    );
                    0 // Default to grayscale
                }
            };

            // Register the volume for the declarative API using the source volume ID
            // This enables request_frame to access this volume with correct data range
            // Skip if metadata_only mode
            let layer_index = if metadata_only_flag {
                info!("Metadata-only mode: skipping volume registration and layer addition");
                0 // Dummy value
            } else {
                let render_service = render_loop_service
                    .as_mut()
                    .expect("RenderLoopService should be available when not in metadata_only mode");

                if let Err(e) = render_service.register_volume_with_range(
                    source_volume_id.clone(),
                    atlas_layer_idx,
                    (min_val, max_val),
                ) {
                    warn!(
                        "Failed to register volume {} with atlas index {}: {:?}",
                        source_volume_id, atlas_layer_idx, e
                    );
                    // Continue anyway - the volume is uploaded and can be used imperatively
                } else {
                    info!(
                        "Successfully registered volume '{}' with atlas index {} for declarative API with data range ({}, {})",
                        source_volume_id, atlas_layer_idx, min_val, max_val
                    );
                }

                // Add the layer to the render state using world-space rendering
                info!(
                    "Adding layer to render state: texture_index={}, dims={:?}",
                    atlas_layer_idx, vol_dims
                );
                // Default to linear interpolation for initial load
                // The actual interpolation mode will be set when layers are configured
                let interpolation_mode_u32 = 1; // Linear interpolation

                let layer_idx = render_service
                    .add_layer_3d(
                        atlas_layer_idx,
                        volume_world_to_voxel,
                        (vol_dims[0], vol_dims[1], vol_dims[2]),
                        1.0, // Initial opacity
                        colormap_id,
                        interpolation_mode_u32,
                    )
                    .map_err(|e| BridgeError::GpuError {
                        code: 5012,
                        details: format!("Failed to add layer to render state: {:?}", e),
                    })?;
                info!("Successfully added layer at index: {}", layer_idx);

                // Update intensity range - for binary masks, force 0-1 range
                // IMPORTANT: For U8 volumes using R8Unorm texture format, the GPU automatically
                // normalizes 0-255 to 0.0-1.0 when sampling. So we must use 0-1 range in shaders!
                let is_u8 = matches!(
                    &volume_data,
                    VolumeSendable::VolU8(_, _) | VolumeSendable::Vec4DU8(_)
                );
                let (display_min, display_max) = if is_u8 {
                    // For U8 data, always use 0-1 range because R8Unorm normalizes to this range
                    (0.0, 1.0)
                } else if is_binary_like && max_val <= 1.0 {
                    // For float data that's already 0-1
                    (0.0, 1.0)
                } else {
                    (min_val, max_val)
                };

                render_service
                    .update_layer_intensity(layer_idx, display_min, display_max)
                    .map_err(|e| BridgeError::GpuError {
                        code: 5014,
                        details: format!("Failed to set layer intensity range: {:?}", e),
                    })?;

                layer_idx
            };

            // Log the layer addition (skip detailed logging in metadata_only mode)
            if !metadata_only_flag {
                // Recalculate display_min/max for logging (they were in the else block scope)
                let is_u8 = matches!(
                    &volume_data,
                    VolumeSendable::VolU8(_, _) | VolumeSendable::Vec4DU8(_)
                );
                let (display_min, display_max) = if is_u8 || (is_binary_like && max_val <= 1.0) {
                    (0.0, 1.0)
                } else {
                    (min_val, max_val)
                };

                info!(
                    "Added render layer {} with colormap {} (id {}) and intensity range ({}, {}) -> display range ({}, {})",
                    layer_index,
                    vol_spec.colormap,
                    colormap_id,
                    min_val,
                    max_val,
                    display_min,
                    display_max
                );
            }
            if is_binary_like {
                info!("Detected binary mask - using 0-1 display range");
            }

            // Store the mapping between UI layer ID and atlas index (only if GPU was allocated)
            if !metadata_only_flag {
                {
                    let mut layer_map = state.layer_to_atlas_map.lock().await;
                    debug!(
                        "📌 STORING layer mapping: UI layer '{}' -> atlas index {}",
                        ui_layer_id, atlas_layer_idx
                    );
                    layer_map.insert(ui_layer_id.clone(), atlas_layer_idx);
                    debug!(
                        "📌 Layer map now contains {} entries: {:?}",
                        layer_map.len(),
                        layer_map.keys().collect::<Vec<_>>()
                    );
                }

                {
                    // Also store the volume handle mapping
                    let mut volume_map = state.layer_to_volume_map.lock().await;
                    let LayerSpec::Volume(vol_spec) = &layer_spec;
                    volume_map.insert(ui_layer_id.clone(), vol_spec.source_resource_id.clone());
                }

                {
                    let uploaded_timepoint = if volume_sendable_uses_timepoint(volume_data) {
                        timepoint_opt
                    } else {
                        None
                    };
                    let mut timepoint_map = state.layer_to_timepoint_map.lock().await;
                    timepoint_map.insert(ui_layer_id.clone(), uploaded_timepoint);
                }

                let lease = LayerLease::new(
                    ui_layer_id.clone(),
                    atlas_layer_idx,
                    Arc::clone(&state.render_loop_service),
                    Arc::clone(&state.layer_to_atlas_map),
                    Arc::clone(&state.layer_to_volume_map),
                    Arc::clone(&state.layer_to_timepoint_map),
                    Arc::clone(&state.resident_image_sets),
                );

                {
                    let mut lease_map = state.layer_leases.lock().await;
                    lease_map.insert(ui_layer_id.clone(), Arc::new(lease));
                }
            }

            Ok(VolumeLayerGpuInfo {
                layer_id: ui_layer_id,
                world_to_voxel: world_to_voxel_flat,
                dim: vol_dims,
                pad_slices: 1,
                tex_format: gpu_format,
                atlas_layer_index: atlas_layer_idx,
                slice_info,
                texture_coords,
                voxel_to_world: voxel_to_world_flat,
                origin: [origin[0], origin[1], origin[2]],
                center_world: center_world_coords,
                spacing: [spacing[0], spacing[1], spacing[2]],
                data_range,
                source_volume_id,
                allocated_at,
                is_binary_like,
            })
        } // Other layer types would go here
    }
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.request_gpu")]
async fn request_layer_gpu_resources(
    layer_spec: LayerSpec,
    metadata_only: Option<bool>,
    state: State<'_, BridgeState>,
) -> BridgeResult<VolumeLayerGpuInfo> {
    request_layer_gpu_resources_for_testing(layer_spec, metadata_only, state.inner()).await
}

async fn release_layer_gpu_resources_internal(
    layer_id: String,
    bridge_state: &BridgeState,
) -> BridgeResult<ReleaseResult> {
    info!(
        "Bridge: release_layer_gpu_resources called for layer {}",
        layer_id
    );

    // Prefer the RAII-managed lease path when available.
    if let Some(lease) = {
        let mut leases = bridge_state.layer_leases.lock().await;
        leases.remove(&layer_id)
    } {
        let service_guard = bridge_state.render_loop_service.lock().await;
        let service_arc =
            service_guard
                .as_ref()
                .ok_or_else(|| BridgeError::ServiceNotInitialized {
                    code: 5008,
                    details:
                        "GPU rendering service is not initialized. Cannot release GPU resources."
                            .to_string(),
                })?;
        let mut render_loop_service = service_arc.lock().await;

        match lease
            .release_with_service(&mut render_loop_service, "manual")
            .await?
        {
            Some(outcome) => {
                return Ok(ReleaseResult {
                    success: true,
                    message: format!(
                        "Released GPU resources for layer {} (atlas layer {})",
                        layer_id, outcome.atlas_index
                    ),
                });
            }
            None => {
                return Ok(ReleaseResult {
                    success: true,
                    message: format!(
                        "Layer {} was already released; no GPU resources were active",
                        layer_id
                    ),
                });
            }
        }
    }

    // Look up the atlas layer index for this UI layer
    let atlas_layer_idx = {
        let layer_map = bridge_state.layer_to_atlas_map.lock().await;
        match layer_map.get(&layer_id) {
            Some(&idx) => idx,
            None => {
                return Ok(ReleaseResult {
                    success: false,
                    message: format!("Layer {} not found in GPU resources", layer_id),
                });
            }
        }
    };

    // Get the render loop service
    let service_guard = bridge_state.render_loop_service.lock().await;
    let service_arc = service_guard
        .as_ref()
        .ok_or_else(|| BridgeError::ServiceNotInitialized {
            code: 5008,
            details: "GPU rendering service is not initialized. Cannot release GPU resources."
                .to_string(),
        })?;
    let mut render_loop_service = service_arc.lock().await;

    // Reclaim the layer's GPU-resident image-set ring (its extra resident members
    // hold multi-texture slots not tracked by the lease) before the atlas teardown.
    release_resident_image_set(&layer_id, bridge_state, &mut render_loop_service).await;

    // Release the atlas layer
    let removed_from_render_state = render_loop_service
        .release_layer_resources(atlas_layer_idx)
        .map_err(|e| BridgeError::GpuError {
            code: 5080,
            details: format!(
                "Failed to remove layer {} from render state: {:?}",
                layer_id, e
            ),
        })?;

    if !removed_from_render_state {
        warn!(
            "Release requested for layer '{}' but no render-state entry matched atlas index {}",
            layer_id, atlas_layer_idx
        );
    }

    // Remove from our tracking map
    {
        let mut layer_map = bridge_state.layer_to_atlas_map.lock().await;
        layer_map.remove(&layer_id);
    }
    {
        let mut volume_map = bridge_state.layer_to_volume_map.lock().await;
        volume_map.remove(&layer_id);
    }
    {
        let mut timepoint_map = bridge_state.layer_to_timepoint_map.lock().await;
        timepoint_map.remove(&layer_id);
    }
    {
        let mut lease_map = bridge_state.layer_leases.lock().await;
        lease_map.remove(&layer_id);
    }

    info!(
        "Released GPU resources for layer {} (atlas layer {})",
        layer_id, atlas_layer_idx
    );

    Ok(ReleaseResult {
        success: true,
        message: if removed_from_render_state {
            format!(
                "Released GPU resources and render state for layer {} (atlas layer {})",
                layer_id, atlas_layer_idx
            )
        } else {
            format!(
                "Released GPU resources for layer {} (atlas layer {}), but no render state entry was found",
                layer_id, atlas_layer_idx
            )
        },
    })
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.release_gpu")]
async fn release_layer_gpu_resources(
    layer_id: String,
    state: State<'_, BridgeState>,
) -> BridgeResult<ReleaseResult> {
    release_layer_gpu_resources_internal(layer_id, state.inner()).await
}

#[doc(hidden)]
pub async fn release_layer_gpu_resources_for_testing(
    layer_id: String,
    bridge_state: &BridgeState,
) -> BridgeResult<ReleaseResult> {
    release_layer_gpu_resources_internal(layer_id, bridge_state).await
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.get_atlas_stats")]
async fn get_atlas_stats(state: State<'_, BridgeState>) -> BridgeResult<AtlasStats> {
    let service_guard = state.render_loop_service.lock().await;
    let service_arc = service_guard
        .as_ref()
        .ok_or_else(|| BridgeError::ServiceNotInitialized {
            code: 5008,
            details: "GPU rendering service is not initialized. Cannot query atlas stats."
                .to_string(),
        })?;
    let service = service_arc.lock().await;
    let metrics = service.atlas_metrics();

    let last_allocation_ms = metrics
        .last_allocation
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64);
    let last_release_ms = metrics
        .last_release
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64);

    Ok(AtlasStats {
        total_layers: metrics.total_layers,
        used_layers: metrics.used_layers,
        free_layers: metrics.free_layers,
        allocations: metrics.allocations,
        releases: metrics.releases,
        high_watermark: metrics.high_watermark,
        full_events: metrics.full_events,
        is_3d: metrics.is_3d,
        last_allocation_ms,
        last_release_ms,
    })
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.remote_mount_connect")]
async fn remote_mount_connect<R: Runtime>(
    request: RemoteMountConnectRequest,
    state: State<'_, BridgeState>,
    window: tauri::Window<R>,
) -> BridgeResult<RemoteMountConnectResult> {
    let normalized = normalize_remote_mount_request(request)?;
    let auth = select_remote_auth(&normalized)?;
    let probe_options = remote_probe_options(&normalized);

    let connect_config = RemoteConnectConfig {
        host: normalized.host.clone(),
        port: normalized.port,
        user: normalized.user.clone(),
        auth,
        connect_timeout: Duration::from_secs(12),
        operation_timeout: Duration::from_secs(30),
        retry_count: 1,
        retry_delay: Duration::from_millis(250),
        verify_host_key: normalized.verify_host_key,
        accept_unknown_host_keys: normalized.accept_unknown_host_keys,
        known_hosts_path: normalized.known_hosts_path.clone(),
        ..Default::default()
    };

    let context = PendingRemoteMountContext {
        request: normalized,
    };

    let outcome = tokio::time::timeout(
        REMOTE_MOUNT_HANDSHAKE_TIMEOUT,
        RemoteClient::connect_interactive_with_probe_blocking(connect_config, probe_options),
    )
    .await
    .map_err(|_| BridgeError::Io {
        code: 8221,
        details: format!(
            "SSH connection timed out after {}s while connecting/authenticating.",
            REMOTE_MOUNT_HANDSHAKE_TIMEOUT.as_secs()
        ),
    })?
    .map_err(|e| map_remotely_error(e, 8221))?;

    handle_remote_connect_outcome(state.inner(), context, outcome, window.app_handle().clone())
        .await
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.remote_mount_respond_host_key")]
async fn remote_mount_respond_host_key<R: Runtime>(
    challenge_id: String,
    trust: bool,
    state: State<'_, BridgeState>,
    window: tauri::Window<R>,
) -> BridgeResult<RemoteMountConnectResult> {
    let challenge_uuid = uuid::Uuid::parse_str(&challenge_id).map_err(|e| BridgeError::Input {
        code: 8222,
        details: format!("Invalid challenge id '{challenge_id}': {e}"),
    })?;

    let context = {
        let mut pending = state.pending_remote_host_key.lock().await;
        pending.remove(&challenge_uuid)
    }
    .ok_or_else(|| BridgeError::Input {
        code: 8223,
        details: format!("Unknown host-key challenge id: {challenge_id}"),
    })?;

    let probe_options = remote_probe_options(&context.request);

    let outcome = tokio::time::timeout(
        REMOTE_MOUNT_HANDSHAKE_TIMEOUT,
        RemoteClient::respond_host_key_with_probe_blocking(challenge_uuid, trust, probe_options),
    )
    .await
    .map_err(|_| BridgeError::Io {
        code: 8224,
        details: format!(
            "SSH connection timed out after {}s while resuming host-key validation.",
            REMOTE_MOUNT_HANDSHAKE_TIMEOUT.as_secs()
        ),
    })?
    .map_err(|e| map_remotely_error(e, 8224))?;

    handle_remote_connect_outcome(state.inner(), context, outcome, window.app_handle().clone())
        .await
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.remote_mount_respond_auth")]
async fn remote_mount_respond_auth<R: Runtime>(
    conversation_id: String,
    responses: Vec<String>,
    state: State<'_, BridgeState>,
    window: tauri::Window<R>,
) -> BridgeResult<RemoteMountConnectResult> {
    let conversation_uuid =
        uuid::Uuid::parse_str(&conversation_id).map_err(|e| BridgeError::Input {
            code: 8225,
            details: format!("Invalid conversation id '{conversation_id}': {e}"),
        })?;

    let context = {
        let mut pending = state.pending_remote_auth.lock().await;
        pending.remove(&conversation_uuid)
    }
    .ok_or_else(|| BridgeError::Input {
        code: 8226,
        details: format!("Unknown auth conversation id: {conversation_id}"),
    })?;

    let probe_options = remote_probe_options(&context.request);

    let outcome = tokio::time::timeout(
        REMOTE_MOUNT_HANDSHAKE_TIMEOUT,
        RemoteClient::respond_auth_with_probe_blocking(conversation_uuid, responses, probe_options),
    )
    .await
    .map_err(|_| BridgeError::Io {
        code: 8227,
        details: format!(
            "SSH connection timed out after {}s while completing authentication.",
            REMOTE_MOUNT_HANDSHAKE_TIMEOUT.as_secs()
        ),
    })?
    .map_err(|e| map_remotely_error(e, 8227))?;

    handle_remote_connect_outcome(state.inner(), context, outcome, window.app_handle().clone())
        .await
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.remote_mount_unmount")]
async fn remote_mount_unmount(
    mount_id: String,
    purge_cache: Option<bool>,
    state: State<'_, BridgeState>,
) -> BridgeResult<ReleaseResult> {
    let removed = {
        let mut mounts = state.remote_mounts.lock().await;
        mounts.remove(&mount_id)
    };

    let Some(mount) = removed else {
        return Err(BridgeError::Input {
            code: 8228,
            details: format!("Unknown remote mount id: {mount_id}"),
        });
    };

    mount.transfers.stop();
    let _cache_admission = remote_cache::ADMISSION.lock().await;
    // New admissions fail; draining all permits proves every transfer writer
    // finished its staging cleanup before unmount can purge the cache.
    let _drain = mount
        .op_semaphore
        .clone()
        .acquire_many_owned(REMOTE_MOUNT_MAX_CONCURRENT_OPS as u32)
        .await
        .map_err(|_| remote_transfer::error("Remote mount operation gate closed"))?;
    mount
        .client
        .close()
        .await
        .map_err(|e| map_remotely_error(e, 8229))?;

    if purge_cache.unwrap_or(false) {
        if let Err(e) = tokio::fs::remove_dir_all(&mount.local_root).await {
            warn!(
                "Failed to purge remote mount cache {}: {}",
                mount.local_root.display(),
                e
            );
        }
        if let Ok(metadata_dir) = remote_cache_metadata_root().map(|root| {
            root.join(remote_cache::identity(
                &mount.host,
                mount.port,
                &mount.user,
                &mount.remote_root,
            ))
        }) {
            if let Err(e) = tokio::fs::remove_dir_all(&metadata_dir).await {
                warn!(
                    "Failed to purge remote cache metadata {}: {}",
                    metadata_dir.display(),
                    e
                );
            }
        }
    }

    Ok(ReleaseResult {
        success: true,
        message: format!("Unmounted remote folder '{}'", mount.display_name),
    })
}

#[command]
async fn cancel_remote_file_load(
    path: String,
    state: State<'_, BridgeState>,
) -> BridgeResult<bool> {
    let Some((mount, _)) =
        resolve_remote_mount_for_local_path(state.inner(), Path::new(&path)).await
    else {
        return Ok(false);
    };
    Ok(mount.transfers.cancel(Path::new(&path)))
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.list_remote_mounts")]
async fn list_remote_mounts(state: State<'_, BridgeState>) -> BridgeResult<Vec<RemoteMountInfo>> {
    let mounts = state.remote_mounts.lock().await;
    let mut items: Vec<RemoteMountInfo> =
        mounts.values().map(remote_mount_info_from_entry).collect();
    items.sort_by(|left, right| left.display_name.cmp(&right.display_name));
    Ok(items)
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.list_remote_directory")]
async fn list_remote_directory(
    mount_id: String,
    relative_path: Option<String>,
    state: State<'_, BridgeState>,
) -> BridgeResult<TreePayload> {
    let mount = {
        let mounts = state.remote_mounts.lock().await;
        mounts.get(&mount_id).cloned()
    }
    .ok_or_else(|| BridgeError::Input {
        code: 8244,
        details: format!("Unknown remote mount id: {mount_id}"),
    })?;

    let mut local_path = mount.local_root.clone();
    let requested = relative_path.unwrap_or_default();
    for component in Path::new(requested.trim()).components() {
        match component {
            std::path::Component::CurDir | std::path::Component::RootDir => {}
            std::path::Component::Normal(segment) => local_path.push(segment),
            _ => {
                return Err(BridgeError::Input {
                    code: 8245,
                    details: format!(
                        "Remote directory path must stay inside the mounted root: {}",
                        requested
                    ),
                });
            }
        }
    }

    list_remote_directory_for_local_path(state.inner(), &local_path)
        .await?
        .ok_or_else(|| BridgeError::Input {
            code: 8246,
            details: format!(
                "Resolved remote directory '{}' is not within mount '{}'.",
                local_path.display(),
                mount_id
            ),
        })
}

fn join_remote_child(parent: &str, child: &str) -> String {
    if parent == "/" {
        format!("/{child}")
    } else {
        format!("{}/{}", parent.trim_end_matches('/'), child)
    }
}

fn normalize_relative_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn is_remote_neuroimaging_path(path: &str) -> bool {
    let path = path.to_lowercase();
    path.ends_with(".nii")
        || path.ends_with(".nii.gz")
        || path.ends_with(".gii")
        || path.ends_with(".surf.gii")
        || path.ends_with(".func.gii")
}

async fn list_remote_discovery_inventory_files(
    mount: &RemoteMountEntry,
    local_root: &Path,
    remote_root: &str,
    max_depth: Option<usize>,
    max_inventory_files: usize,
) -> BridgeResult<(Vec<field_table::DiscoveryInventoryFile>, bool)> {
    let mut queue = VecDeque::from([(remote_root.to_string(), PathBuf::new())]);
    let mut files = Vec::new();
    let mut truncated = false;

    while let Some((remote_dir, relative_dir)) = queue.pop_front() {
        let entries = remote_transfer::list_owned(mount.clone(), remote_dir.clone()).await?;

        for entry in entries {
            let child_relative = if relative_dir.as_os_str().is_empty() {
                PathBuf::from(&entry.name)
            } else {
                relative_dir.join(&entry.name)
            };
            let child_depth = child_relative.components().count();
            let child_remote = join_remote_child(&remote_dir, &entry.name);
            let relative_label = normalize_relative_path(&child_relative);

            if entry.is_dir() {
                if max_depth.map(|depth| child_depth < depth).unwrap_or(true) {
                    queue.push_back((child_remote, child_relative));
                }
                continue;
            }

            if !is_remote_neuroimaging_path(&relative_label)
                && !is_remote_neuroimaging_path(&child_remote)
            {
                continue;
            }

            if files.len() >= max_inventory_files {
                truncated = true;
                continue;
            }

            files.push(field_table::DiscoveryInventoryFile {
                source_path: local_root
                    .join(&child_relative)
                    .to_string_lossy()
                    .to_string(),
                relative_path: relative_label,
            });
        }
    }

    files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok((files, truncated))
}

fn inactive_remote_discovery_inventory(
    root_path: &Path,
) -> Option<field_table::DiscoveryInventory> {
    let cache_root = remote_cache_root().ok()?;
    if !root_path.starts_with(&cache_root) {
        return None;
    }

    let relative = root_path.strip_prefix(&cache_root).ok()?;
    let mount_id = relative
        .components()
        .find_map(|component| match component {
            std::path::Component::Normal(segment) => Some(segment.to_string_lossy().to_string()),
            _ => None,
        })
        .unwrap_or_else(|| "unknown".to_string());
    let root = root_path.to_string_lossy();

    Some(field_table::DiscoveryInventory {
        root_exists: false,
        source_label: Some(format!("inactive remote mount {mount_id}")),
        root_issue: Some(format!(
            "Remote mount is not active for root '{}' (mount id {}). Reconnect the remote folder and try again.",
            root, mount_id
        )),
        ..field_table::DiscoveryInventory::default()
    })
}

async fn remote_discovery_inventory_for_request(
    state: &BridgeState,
    request: &StudioImportPreviewRequest,
) -> BridgeResult<Option<field_table::DiscoveryInventory>> {
    let Some(root) = request.discovery_root.as_deref() else {
        return Ok(None);
    };
    let root_path = PathBuf::from(root);
    let Some((mount, remote_root)) = resolve_remote_mount_for_local_path(state, &root_path).await
    else {
        return Ok(inactive_remote_discovery_inventory(&root_path));
    };

    let requested_max_files = request.discovery_max_files.unwrap_or(200).max(1);
    let max_inventory_files = requested_max_files.saturating_mul(8).max(200);
    let (files, inventory_truncated) = list_remote_discovery_inventory_files(
        &mount,
        &root_path,
        &remote_root,
        request.discovery_max_depth,
        max_inventory_files,
    )
    .await?;

    let mut notes = vec![format!(
        "Remote inventory listed {} neuroimaging file(s) from mount {} without downloading NIfTI payloads.",
        files.len(),
        mount.mount_id
    )];
    if inventory_truncated {
        notes.push(format!(
            "Remote inventory stopped after {} neuroimaging file(s); narrow the root or max file count for a fuller preview.",
            max_inventory_files
        ));
    }

    let mut inventory = field_table::DiscoveryInventory {
        root_exists: true,
        source_label: Some(mount.origin_label.clone()),
        files,
        notes,
        ..field_table::DiscoveryInventory::default()
    };

    if request.discovery_sample_headers.unwrap_or(false) {
        let mut grouping_request = request.clone();
        grouping_request.discovery_sample_headers = Some(false);
        let sample_source_path = field_table::preview_import_candidates_with_discovery_inventory(
            grouping_request,
            Some(inventory.clone()),
        )
        .into_iter()
        .next()
        .and_then(|candidate| {
            candidate
                .set
                .member_summaries
                .into_iter()
                .find_map(|member| member.source_path)
        });

        if let Some(sample_source_path) = sample_source_path {
            let sample_path = PathBuf::from(&sample_source_path);
            match materialize_remote_file_if_needed(state, &sample_path).await {
                Ok(()) => {
                    inventory.sample_header = Some(field_table::DiscoverySampleHeader {
                        source_path: sample_source_path.clone(),
                        local_path: sample_path.clone(),
                        note: format!(
                            "Staged one remote sample header from '{}' for validation; other preview files were listed only.",
                            sample_source_path
                        ),
                    });
                }
                Err(error) => {
                    inventory.sample_header_error = Some(format!(
                        "Failed to stage remote sample header '{}' from mount {}: {}",
                        sample_source_path, mount.mount_id, error
                    ));
                }
            }
        } else {
            inventory.sample_header_error = Some(format!(
                "Remote discovery for root '{}' found no grouped sample file to stage from mount {}.",
                root, mount.mount_id
            ));
        }
    }

    Ok(Some(inventory))
}

async fn remote_discovery_inventory_for_folder_ontology_request(
    state: &BridgeState,
    request: &StudioFolderOntologyPreviewRequest,
) -> BridgeResult<Option<field_table::DiscoveryInventory>> {
    let root_path = PathBuf::from(&request.root);
    let Some((mount, remote_root)) = resolve_remote_mount_for_local_path(state, &root_path).await
    else {
        return Ok(inactive_remote_discovery_inventory(&root_path));
    };

    let requested_max_files = request.max_files.unwrap_or(500).max(1);
    let max_inventory_files = requested_max_files.saturating_mul(8).max(500);
    let (files, inventory_truncated) = list_remote_discovery_inventory_files(
        &mount,
        &root_path,
        &remote_root,
        request.max_depth,
        max_inventory_files,
    )
    .await?;

    let mut notes = vec![format!(
        "Remote ontology inventory listed {} neuroimaging file(s) from mount {} without downloading NIfTI payloads.",
        files.len(),
        mount.mount_id
    )];
    if inventory_truncated {
        notes.push(format!(
            "Remote ontology inventory stopped after {} neuroimaging file(s); narrow the root or max file count for a fuller preview.",
            max_inventory_files
        ));
    }

    Ok(Some(field_table::DiscoveryInventory {
        root_exists: true,
        source_label: Some(mount.origin_label.clone()),
        files,
        notes,
        ..field_table::DiscoveryInventory::default()
    }))
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.list_remote_mount_profiles")]
async fn list_remote_mount_profiles() -> BridgeResult<Vec<RemoteMountProfile>> {
    load_remote_profiles().await
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.remove_remote_mount_profile")]
async fn remove_remote_mount_profile(profile_id: String) -> BridgeResult<()> {
    let mut profiles = load_remote_profiles().await?;
    let initial_len = profiles.len();

    let removed_profiles: Vec<RemoteMountProfile> = profiles
        .iter()
        .filter(|profile| profile.id == profile_id)
        .cloned()
        .collect();
    profiles.retain(|profile| profile.id != profile_id);

    if profiles.len() == initial_len {
        return Err(BridgeError::Input {
            code: 8230,
            details: format!("Unknown remote profile id: {profile_id}"),
        });
    }

    for profile in removed_profiles {
        delete_cached_password(&profile.host, profile.port, &profile.user);
        delete_cached_key_passphrase(
            &profile.host,
            profile.port,
            &profile.user,
            profile.key_path.as_deref(),
        );
    }

    save_remote_profiles(&profiles).await
}

// --- Directory Listing Command ---
#[command]
#[tracing::instrument(skip_all, err, name = "api.fs_list_directory")]
async fn fs_list_directory(
    path: String,
    state: State<'_, BridgeState>,
) -> BridgeResult<TreePayload> {
    info!("Bridge: fs_list_directory called for path: {}", path);

    let root_path = PathBuf::from(&path);
    if let Some(remote_payload) =
        list_remote_directory_for_local_path(state.inner(), &root_path).await?
    {
        return Ok(remote_payload);
    }

    if let Ok(cache_root) = remote_cache_root() {
        if root_path.starts_with(&cache_root) {
            return Err(BridgeError::Input {
                code: 8232,
                details: format!(
                    "Remote mount is not active for '{}'. Reconnect the remote folder and try again.",
                    path
                ),
            });
        }
    }

    if !root_path.exists() {
        return Err(BridgeError::Io {
            code: 1002,
            details: format!(
                "Directory '{}' does not exist. Please check the path and try again.",
                path
            ),
        });
    }

    if !root_path.is_dir() {
        return Err(BridgeError::Input {
            code: 2001,
            details: format!(
                "'{}' is not a directory. Please provide a valid directory path.",
                path
            ),
        });
    }

    list_local_directory(&root_path).await
}

// --- GPU Service Commands ---
#[command]
#[tracing::instrument(skip_all, err, name = "api.init_render_loop")]
async fn init_render_loop(state: State<'_, BridgeState>) -> BridgeResult<()> {
    info!("Bridge: init_render_loop called");

    state.ensure_render_loop().await
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.resize_canvas")]
async fn resize_canvas(width: u32, height: u32, state: State<'_, BridgeState>) -> BridgeResult<()> {
    info!("Bridge: resize_canvas called with {}x{}", width, height);

    let bridge_state = state.inner();
    let service_guard = bridge_state.render_loop_service.lock().await;
    let service_arc = service_guard
        .as_ref()
        .ok_or_else(|| BridgeError::ServiceNotInitialized {
            code: 5006,
            details:
                "GPU rendering service is not initialized. Please initialize the render loop first."
                    .to_string(),
        })?;

    let mut service = service_arc.lock().await;
    service.resize(width, height);

    Ok(())
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.update_frame_ubo")]
async fn update_frame_ubo(
    origin_mm: Vec<f32>, // 4 elements - plane center in world mm
    u_mm: Vec<f32>,      // 4 elements - world vector for clip space +X
    v_mm: Vec<f32>,      // 4 elements - world vector for clip space +Y
    state: State<'_, BridgeState>,
) -> BridgeResult<()> {
    info!("Bridge: update_frame_ubo called with:");
    info!("  origin_mm: {:?}", origin_mm);
    info!("  u_mm: {:?}", u_mm);
    info!("  v_mm: {:?}", v_mm);

    let bridge_state = state.inner();

    // Validate input arrays
    if origin_mm.len() != 4 {
        return Err(BridgeError::Input {
            code: 2010,
            details: "origin_mm must be a 4-element array".to_string(),
        });
    }
    if u_mm.len() != 4 {
        return Err(BridgeError::Input {
            code: 2011,
            details: "u_mm must be a 4-element array".to_string(),
        });
    }
    if v_mm.len() != 4 {
        return Err(BridgeError::Input {
            code: 2012,
            details: "v_mm must be a 4-element array".to_string(),
        });
    }

    // Get render loop service
    let service_guard = bridge_state.render_loop_service.lock().await;
    let service_arc = service_guard
        .as_ref()
        .ok_or_else(|| BridgeError::ServiceNotInitialized {
            code: 5006,
            details:
                "GPU rendering service is not initialized. Please initialize the render loop first."
                    .to_string(),
        })?;
    let service = service_arc.lock().await;

    // Convert Vec<f32> to fixed arrays
    let origin_mm_arr: [f32; 4] = origin_mm.try_into().map_err(|_| BridgeError::Internal {
        code: 5008,
        details: "Failed to convert origin_mm to array".to_string(),
    })?;
    let u_mm_arr: [f32; 4] = u_mm.try_into().map_err(|_| BridgeError::Internal {
        code: 5009,
        details: "Failed to convert u_mm to array".to_string(),
    })?;
    let v_mm_arr: [f32; 4] = v_mm.try_into().map_err(|_| BridgeError::Internal {
        code: 5010,
        details: "Failed to convert v_mm to array".to_string(),
    })?;

    // Update the frame UBO
    service.update_frame_ubo(origin_mm_arr, u_mm_arr, v_mm_arr);

    Ok(())
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.set_crosshair")]
async fn set_crosshair(
    world_coords: Vec<f32>, // 3 elements for world position
    state: State<'_, BridgeState>,
) -> BridgeResult<()> {
    info!(
        "Bridge: set_crosshair called with coords: {:?}",
        world_coords
    );

    let bridge_state = state.inner();

    // Validate input
    if world_coords.len() != 3 {
        return Err(BridgeError::Input {
            code: 2014,
            details: "world_coords must be a 3-element array for [x, y, z] position".to_string(),
        });
    }

    // Get render loop service
    let service_guard = bridge_state.render_loop_service.lock().await;
    let service_arc = service_guard
        .as_ref()
        .ok_or_else(|| BridgeError::ServiceNotInitialized {
            code: 5006,
            details:
                "GPU rendering service is not initialized. Please initialize the render loop first."
                    .to_string(),
        })?;
    let service = service_arc.lock().await;

    // Convert Vec<f32> to fixed array
    let world_coords_arr: [f32; 3] =
        world_coords.try_into().map_err(|_| BridgeError::Internal {
            code: 5010,
            details: "Failed to convert world_coords to array".to_string(),
        })?;

    // Update the crosshair UBO
    service.set_crosshair(world_coords_arr);

    Ok(())
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.update_slice_outline")]
async fn update_slice_outline(
    enabled: bool,
    outline_layer_index: u32,
    selected_label_id: u32,
    color: Vec<f32>,
    thickness_px: f32,
    state: State<'_, BridgeState>,
) -> BridgeResult<()> {
    if color.len() != 4 {
        return Err(BridgeError::Input {
            code: 2020,
            details: "color must be a 4-element RGBA array".to_string(),
        });
    }

    let color_arr: [f32; 4] = color.try_into().map_err(|_| BridgeError::Internal {
        code: 5020,
        details: "Failed to convert outline color to array".to_string(),
    })?;

    let service_guard = state.render_loop_service.lock().await;
    let service_arc = service_guard
        .as_ref()
        .ok_or_else(|| BridgeError::ServiceNotInitialized {
            code: 5006,
            details:
                "GPU rendering service is not initialized. Please initialize the render loop first."
                    .to_string(),
        })?;
    let service = service_arc.lock().await;

    service.update_slice_feature_ubo(SliceFeatureUbo {
        outline_enabled: u32::from(enabled),
        outline_layer_index,
        selected_label_id,
        outline_color: color_arr,
        outline_thickness_px: thickness_px.max(1.0),
        ..SliceFeatureUbo::default()
    });

    Ok(())
}

// ViewPlaneUbo has been removed - view plane info is now encoded in frame vectors.
// The former `set_view_plane` command was retired with it.

#[command]
#[tracing::instrument(skip_all, err, name = "api.update_frame_for_synchronized_view")]
async fn update_frame_for_synchronized_view(
    view_width_mm: f32,
    view_height_mm: f32,
    crosshair_world: Vec<f32>,
    plane_id: u32,
    state: State<'_, BridgeState>,
) -> BridgeResult<()> {
    info!(
        "Bridge: update_frame_for_synchronized_view called - view: {}x{}mm, plane: {}",
        view_width_mm, view_height_mm, plane_id
    );
    debug!(
        "API_BRIDGE: Received view dimensions: {}x{}mm",
        view_width_mm, view_height_mm
    );

    // Validate crosshair coordinates
    if crosshair_world.len() != 3 {
        return Err(BridgeError::Input {
            code: 2015,
            details: "crosshair_world must be a 3-element array for [x, y, z] position".to_string(),
        });
    }
    let service_guard = state.render_loop_service.lock().await;
    let service_arc = service_guard
        .as_ref()
        .ok_or_else(|| BridgeError::ServiceNotInitialized {
            code: 5006,
            details:
                "GPU rendering service is not initialized. Please initialize the render loop first."
                    .to_string(),
        })?;
    let service = service_arc.lock().await;

    // Convert Vec<f32> to fixed array
    let crosshair_arr: [f32; 3] =
        crosshair_world
            .try_into()
            .map_err(|_| BridgeError::Internal {
                code: 5011,
                details: "Failed to convert crosshair_world to array".to_string(),
            })?;

    // Update the frame for synchronized view
    service.update_frame_for_synchronized_view(
        view_width_mm,
        view_height_mm,
        crosshair_arr,
        plane_id,
    );

    Ok(())
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.create_offscreen_render_target")]
async fn create_offscreen_render_target(
    width: u32,
    height: u32,
    state: State<'_, BridgeState>,
) -> BridgeResult<()> {
    info!(
        "Bridge: create_offscreen_render_target called with {}x{}",
        width, height
    );

    // Get render loop service
    let service_guard = state.render_loop_service.lock().await;
    let service_arc = service_guard
        .as_ref()
        .ok_or_else(|| BridgeError::ServiceNotInitialized {
            code: 5006,
            details:
                "GPU rendering service is not initialized. Please initialize the render loop first."
                    .to_string(),
        })?;
    let mut service = service_arc.lock().await;

    // Create the offscreen render target
    service
        .create_offscreen_target(width, height)
        .map_err(|e| BridgeError::Internal {
            code: 5013,
            details: format!("Failed to create offscreen render target: {}", e),
        })?;

    info!(
        "Offscreen render target created successfully: {}x{}",
        width, height
    );

    Ok(())
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.add_render_layer")]
async fn add_render_layer(
    atlas_index: u32,
    opacity: f32,
    texture_coords: Vec<f32>, // 4 elements: u_min, v_min, u_max, v_max
    state: State<'_, BridgeState>,
) -> BridgeResult<usize> {
    info!(
        "Bridge: add_render_layer called with atlas_index: {}, opacity: {}",
        atlas_index, opacity
    );

    // Validate texture_coords
    if texture_coords.len() != 4 {
        return Err(BridgeError::Input {
            code: 2015,
            details: "texture_coords must be a 4-element array [u_min, v_min, u_max, v_max]"
                .to_string(),
        });
    }

    // Get render loop service
    let service_guard = state.render_loop_service.lock().await;
    let service_arc = service_guard
        .as_ref()
        .ok_or_else(|| BridgeError::ServiceNotInitialized {
            code: 5006,
            details:
                "GPU rendering service is not initialized. Please initialize the render loop first."
                    .to_string(),
        })?;
    let mut service = service_arc.lock().await;

    // Convert Vec to tuple
    let texture_coords_tuple = (
        texture_coords[0],
        texture_coords[1],
        texture_coords[2],
        texture_coords[3],
    );

    // Add the layer to render state
    let layer_index = service
        .add_render_layer(atlas_index, opacity, texture_coords_tuple)
        .map_err(|e| BridgeError::Internal {
            code: 5015,
            details: format!("Failed to add render layer: {}", e),
        })?;

    info!(
        "Added render layer {} with atlas index {}",
        layer_index, atlas_index
    );

    Ok(layer_index)
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.patch_layer")]
async fn patch_layer(
    layer_id: String,
    patch: LayerPatch,
    state: State<'_, BridgeState>,
) -> BridgeResult<()> {
    info!(
        "Bridge: patch_layer called for layer {} with patch: {:?}",
        layer_id, patch
    );

    // For now, we'll just log the patch since we don't have layer property storage yet
    // In a real implementation, this would:
    // 1. Update layer properties in a layer registry
    // 2. Update GPU uniforms for the layer
    // 3. Trigger a re-render if needed

    // Look up the atlas layer index for this UI layer
    let atlas_layer_idx = {
        let layer_map = state.layer_to_atlas_map.lock().await;
        match layer_map.get(&layer_id) {
            Some(&idx) => idx,
            None => {
                return Err(BridgeError::VolumeNotFound {
                    code: 4043,
                    details: format!("Layer {} not found in GPU resources", layer_id),
                });
            }
        }
    };

    // Get mutable access to the service
    let service_guard = state.render_loop_service.lock().await;
    let service_arc = service_guard
        .as_ref()
        .ok_or_else(|| BridgeError::ServiceNotInitialized {
            code: 5006,
            details:
                "GPU rendering service is not initialized. Please initialize the render loop first."
                    .to_string(),
        })?;
    let mut service = service_arc.lock().await;

    // Update opacity if provided
    if let Some(opacity) = patch.opacity {
        // For now, we'll use colormap 0 (grayscale) as default
        // In a full implementation, we'd track the current colormap
        service
            .update_layer(atlas_layer_idx as usize, opacity, 0)
            .map_err(|e| BridgeError::GpuError {
                code: 5007,
                details: format!("Failed to update layer opacity: {:?}", e),
            })?;
        info!(
            "Updated layer {} (atlas {}) opacity to {}",
            layer_id, atlas_layer_idx, opacity
        );
    }

    // Update colormap if provided
    if let Some(colormap) = patch.colormap {
        let colormap_id = match colormap_by_name(&colormap) {
            Some(id) => id.id() as u32,
            None => {
                error!("Unknown colormap '{}', defaulting to grayscale", colormap);
                0 // Default to grayscale
            }
        };
        service
            .set_layer_colormap(atlas_layer_idx as usize, colormap_id)
            .map_err(|e| BridgeError::GpuError {
                code: 5008,
                details: format!("Failed to update layer colormap: {:?}", e),
            })?;
        info!(
            "Updated layer {} colormap to {} (id {})",
            layer_id, colormap, colormap_id
        );
    }

    // Update intensity window - prefer direct min/max over center/width
    let intensity_update = match (patch.intensity_min, patch.intensity_max) {
        (Some(min), Some(max)) => Some((min, max)),
        _ => {
            // Fall back to window_center/window_width if provided
            match (patch.window_center, patch.window_width) {
                (Some(center), Some(width)) => Some((center - width / 2.0, center + width / 2.0)),
                _ => None,
            }
        }
    };

    if let Some((intensity_min, intensity_max)) = intensity_update {
        service
            .update_layer_intensity(atlas_layer_idx as usize, intensity_min, intensity_max)
            .map_err(|e| BridgeError::GpuError {
                code: 5009,
                details: format!("Failed to update layer intensity window: {:?}", e),
            })?;
        info!(
            "Updated layer {} intensity window: min={}, max={}",
            layer_id, intensity_min, intensity_max
        );
    }

    // Update threshold range if provided
    if let (Some(low), Some(high)) = (patch.threshold_low, patch.threshold_high) {
        service
            .update_layer_threshold(atlas_layer_idx as usize, low, high)
            .map_err(|e| BridgeError::GpuError {
                code: 5010,
                details: format!("Failed to update layer threshold: {:?}", e),
            })?;
        info!(
            "Updated layer {} threshold: low={}, high={}",
            layer_id, low, high
        );
    }

    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct HistogramBin {
    pub x0: f32,
    pub x1: f32,
    pub count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct HistogramResult {
    pub bins: Vec<HistogramBin>,
    pub total_count: u64,
    pub min_value: f32,
    pub max_value: f32,
    pub mean: f32,
    pub std: f32,
    pub bin_count: u32,
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.compute_layer_histogram")]
async fn compute_layer_histogram(
    layer_id: String,
    bin_count: Option<u32>,
    range: Option<Vec<f32>>,
    exclude_zeros: Option<bool>,
    state: State<'_, BridgeState>,
) -> BridgeResult<HistogramResult> {
    info!(
        "Bridge: compute_layer_histogram called for layer {}",
        layer_id
    );

    let bin_count = bin_count.unwrap_or(256);
    let exclude_zeros = exclude_zeros.unwrap_or(false);

    info!(
        "Histogram parameters: bin_count={}, exclude_zeros={}, range={:?}",
        bin_count, exclude_zeros, range
    );

    // Look up the volume for this layer with fallback mechanisms
    let volume_handle = {
        let layer_map = state.layer_to_volume_map.lock().await;
        match layer_map.get(&layer_id) {
            Some(handle) => {
                info!(
                    "Found volume handle {} for layer {} in layer_to_volume_map",
                    handle, layer_id
                );
                handle.clone()
            }
            None => {
                warn!(
                    "Layer {} not found in layer_to_volume_map, attempting fallback mechanisms",
                    layer_id
                );

                // Log available mappings for debugging
                info!(
                    "Available layer mappings: {:?}",
                    layer_map.keys().collect::<Vec<_>>()
                );

                // Drop the lock before proceeding
                drop(layer_map);

                // Fallback 1: Try using layer_id as volume_handle directly
                // This works when the frontend uses volume_id as layer_id
                let registry = state.volume_registry.lock().await;
                if registry.contains(&layer_id) {
                    info!(
                        "Fallback 1 succeeded: Found volume using layer_id {} as volume_handle",
                        layer_id
                    );
                    drop(registry);
                    layer_id.clone()
                } else {
                    // Fallback 2: Search registry for volumes that might match
                    // This handles cases where there's a mismatch in ID formats
                    let matching_volumes: Vec<String> = registry
                        .keys()
                        .filter(|k| {
                            // Check if volume key contains layer_id or vice versa
                            k.contains(&layer_id) || layer_id.contains(*k)
                        })
                        .cloned()
                        .collect();

                    if let Some(volume_handle) = matching_volumes.first() {
                        info!(
                            "Fallback 2 succeeded: Found matching volume {} for layer {}",
                            volume_handle, layer_id
                        );
                        drop(registry);
                        volume_handle.clone()
                    } else {
                        // Log all available volumes for debugging
                        error!(
                            "No volume found for layer {}. Available volumes: {:?}",
                            layer_id,
                            registry.keys().collect::<Vec<_>>()
                        );
                        drop(registry);

                        return Err(BridgeError::VolumeNotFound {
                            code: 4044,
                            details: format!(
                                "Volume for layer {} not found. Tried: layer_to_volume_map lookup, direct volume registry lookup, and pattern matching",
                                layer_id
                            ),
                        });
                    }
                }
            }
        }
    };

    // Take a cheap Arc handle to the volume and release the registry lock before
    // the full-volume scan below. (Previously this deep-cloned the whole volume,
    // ~tens of MB, just to scan it.)
    let volume = {
        let registry = state.volume_registry.lock().await;
        match registry.get_arc(&volume_handle) {
            Some(vol) => vol,
            None => {
                return Err(BridgeError::VolumeNotFound {
                    code: 4045,
                    details: format!("Volume {} not found in registry", volume_handle),
                });
            }
        }
    };

    let timepoint = state
        .volume_registry
        .lock()
        .await
        .get_timepoint(&volume_handle)
        .unwrap_or(0);
    tokio::task::spawn_blocking(move || {
        histogram::for_volume(
            &volume,
            timepoint,
            bin_count,
            range.as_deref(),
            exclude_zeros,
        )
    })
    .await
    .map_err(|error| BridgeError::Internal {
        code: 5014,
        details: format!("Histogram task failed: {error}"),
    })?
}

async fn sample_world_coordinate_impl(
    handle_id: &str,
    world_coords: &[f32],
    state: &BridgeState,
) -> BridgeResult<f32> {
    info!(
        "Bridge: sample_world_coordinate called for handle {} at {:?}",
        handle_id, world_coords
    );

    // Validate input
    if world_coords.len() != 3 {
        return Err(BridgeError::Input {
            code: 2016,
            details: "world_coords must be a 3-element array for [x, y, z] position".to_string(),
        });
    }

    // Get the volume handle
    let registry = state.volume_registry.lock().await;
    let volume_data = registry
        .get(handle_id)
        .ok_or_else(|| BridgeError::VolumeNotFound {
            code: 4001,
            details: format!("Volume handle {} not found", handle_id),
        })?;

    // Convert world coordinates to voxel coordinates
    let world_to_voxel = get_affine_from_volume(volume_data)?.inverse();

    // Transform world to voxel
    let world_point = nalgebra::Point3::new(world_coords[0], world_coords[1], world_coords[2]);
    let voxel_point = world_to_voxel.transform_point(&world_point);
    let voxel_coords = [voxel_point.x, voxel_point.y, voxel_point.z];

    info!(
        "Transformed world {:?} to voxel {:?}",
        world_coords, voxel_coords
    );

    // Get current timepoint for 4D volumes
    let timepoint = registry.get_timepoint(handle_id).unwrap_or(0);

    // Check bounds and sample
    let value = match volume_data {
        VolumeSendable::VolF32(vol, _) => {
            let dims = vol.space().dims();
            if voxel_coords[0] >= 0.0
                && voxel_coords[0] < dims[0] as f32
                && voxel_coords[1] >= 0.0
                && voxel_coords[1] < dims[1] as f32
                && voxel_coords[2] >= 0.0
                && voxel_coords[2] < dims[2] as f32
            {
                // Use nearest neighbor interpolation
                let x = voxel_coords[0].round() as usize;
                let y = voxel_coords[1].round() as usize;
                let z = voxel_coords[2].round() as usize;
                vol.get_at_coords(&[x, y, z]).unwrap_or(0.0)
            } else {
                0.0 // Out of bounds
            }
        }
        VolumeSendable::VolF64(vol, _) => {
            let dims = vol.space().dims();
            if voxel_coords[0] >= 0.0
                && voxel_coords[0] < dims[0] as f32
                && voxel_coords[1] >= 0.0
                && voxel_coords[1] < dims[1] as f32
                && voxel_coords[2] >= 0.0
                && voxel_coords[2] < dims[2] as f32
            {
                let x = voxel_coords[0].round() as usize;
                let y = voxel_coords[1].round() as usize;
                let z = voxel_coords[2].round() as usize;
                vol.get_at_coords(&[x, y, z])
                    .map(|v| v as f32)
                    .unwrap_or(0.0)
            } else {
                0.0
            }
        }
        VolumeSendable::VolI16(vol, _) => {
            let dims = vol.space().dims();
            if voxel_coords[0] >= 0.0
                && voxel_coords[0] < dims[0] as f32
                && voxel_coords[1] >= 0.0
                && voxel_coords[1] < dims[1] as f32
                && voxel_coords[2] >= 0.0
                && voxel_coords[2] < dims[2] as f32
            {
                let x = voxel_coords[0].round() as usize;
                let y = voxel_coords[1].round() as usize;
                let z = voxel_coords[2].round() as usize;
                vol.get_at_coords(&[x, y, z])
                    .map(|v| v as f32)
                    .unwrap_or(0.0)
            } else {
                0.0
            }
        }
        VolumeSendable::VolI32(vol, _) => {
            let dims = vol.space().dims();
            if voxel_coords[0] >= 0.0
                && voxel_coords[0] < dims[0] as f32
                && voxel_coords[1] >= 0.0
                && voxel_coords[1] < dims[1] as f32
                && voxel_coords[2] >= 0.0
                && voxel_coords[2] < dims[2] as f32
            {
                let x = voxel_coords[0].round() as usize;
                let y = voxel_coords[1].round() as usize;
                let z = voxel_coords[2].round() as usize;
                vol.get_at_coords(&[x, y, z])
                    .map(|v| v as f32)
                    .unwrap_or(0.0)
            } else {
                0.0
            }
        }
        VolumeSendable::VolU8(vol, _) => {
            let dims = vol.space().dims();
            if voxel_coords[0] >= 0.0
                && voxel_coords[0] < dims[0] as f32
                && voxel_coords[1] >= 0.0
                && voxel_coords[1] < dims[1] as f32
                && voxel_coords[2] >= 0.0
                && voxel_coords[2] < dims[2] as f32
            {
                let x = voxel_coords[0].round() as usize;
                let y = voxel_coords[1].round() as usize;
                let z = voxel_coords[2].round() as usize;
                vol.get_at_coords(&[x, y, z])
                    .map(|v| v as f32)
                    .unwrap_or(0.0)
            } else {
                0.0
            }
        }
        VolumeSendable::VolU16(vol, _) => {
            let dims = vol.space().dims();
            if voxel_coords[0] >= 0.0
                && voxel_coords[0] < dims[0] as f32
                && voxel_coords[1] >= 0.0
                && voxel_coords[1] < dims[1] as f32
                && voxel_coords[2] >= 0.0
                && voxel_coords[2] < dims[2] as f32
            {
                let x = voxel_coords[0].round() as usize;
                let y = voxel_coords[1].round() as usize;
                let z = voxel_coords[2].round() as usize;
                vol.get_at_coords(&[x, y, z])
                    .map(|v| v as f32)
                    .unwrap_or(0.0)
            } else {
                0.0
            }
        }
        VolumeSendable::VolI8(vol, _) => {
            let dims = vol.space().dims();
            if voxel_coords[0] >= 0.0
                && voxel_coords[0] < dims[0] as f32
                && voxel_coords[1] >= 0.0
                && voxel_coords[1] < dims[1] as f32
                && voxel_coords[2] >= 0.0
                && voxel_coords[2] < dims[2] as f32
            {
                let x = voxel_coords[0].round() as usize;
                let y = voxel_coords[1].round() as usize;
                let z = voxel_coords[2].round() as usize;
                vol.get_at_coords(&[x, y, z])
                    .map(|v| v as f32)
                    .unwrap_or(0.0)
            } else {
                0.0
            }
        }
        VolumeSendable::VolU32(vol, _) => {
            let dims = vol.space().dims();
            if voxel_coords[0] >= 0.0
                && voxel_coords[0] < dims[0] as f32
                && voxel_coords[1] >= 0.0
                && voxel_coords[1] < dims[1] as f32
                && voxel_coords[2] >= 0.0
                && voxel_coords[2] < dims[2] as f32
            {
                let x = voxel_coords[0].round() as usize;
                let y = voxel_coords[1].round() as usize;
                let z = voxel_coords[2].round() as usize;
                vol.get_at_coords(&[x, y, z])
                    .map(|v| v as f32)
                    .unwrap_or(0.0)
            } else {
                0.0
            }
        }
        // 4D volumes - sample from the current timepoint
        VolumeSendable::Vec4DF32(vec) => {
            let dims = vec.data.dim();
            let t = timepoint.min(dims.3.saturating_sub(1));
            if voxel_coords[0] >= 0.0
                && voxel_coords[0] < dims.0 as f32
                && voxel_coords[1] >= 0.0
                && voxel_coords[1] < dims.1 as f32
                && voxel_coords[2] >= 0.0
                && voxel_coords[2] < dims.2 as f32
            {
                let x = voxel_coords[0].round() as usize;
                let y = voxel_coords[1].round() as usize;
                let z = voxel_coords[2].round() as usize;
                vec.data[[x, y, z, t]]
            } else {
                0.0
            }
        }
        VolumeSendable::Vec4DI16(vec) => {
            let dims = vec.data.dim();
            let t = timepoint.min(dims.3.saturating_sub(1));
            if voxel_coords[0] >= 0.0
                && voxel_coords[0] < dims.0 as f32
                && voxel_coords[1] >= 0.0
                && voxel_coords[1] < dims.1 as f32
                && voxel_coords[2] >= 0.0
                && voxel_coords[2] < dims.2 as f32
            {
                let x = voxel_coords[0].round() as usize;
                let y = voxel_coords[1].round() as usize;
                let z = voxel_coords[2].round() as usize;
                vec.data[[x, y, z, t]] as f32
            } else {
                0.0
            }
        }
        VolumeSendable::Vec4DU8(vec) => {
            let dims = vec.data.dim();
            let t = timepoint.min(dims.3.saturating_sub(1));
            if voxel_coords[0] >= 0.0
                && voxel_coords[0] < dims.0 as f32
                && voxel_coords[1] >= 0.0
                && voxel_coords[1] < dims.1 as f32
                && voxel_coords[2] >= 0.0
                && voxel_coords[2] < dims.2 as f32
            {
                let x = voxel_coords[0].round() as usize;
                let y = voxel_coords[1].round() as usize;
                let z = voxel_coords[2].round() as usize;
                vec.data[[x, y, z, t]] as f32
            } else {
                0.0
            }
        }
        VolumeSendable::Vec4DI8(vec) => {
            let dims = vec.data.dim();
            let t = timepoint.min(dims.3.saturating_sub(1));
            if voxel_coords[0] >= 0.0
                && voxel_coords[0] < dims.0 as f32
                && voxel_coords[1] >= 0.0
                && voxel_coords[1] < dims.1 as f32
                && voxel_coords[2] >= 0.0
                && voxel_coords[2] < dims.2 as f32
            {
                let x = voxel_coords[0].round() as usize;
                let y = voxel_coords[1].round() as usize;
                let z = voxel_coords[2].round() as usize;
                vec.data[[x, y, z, t]] as f32
            } else {
                0.0
            }
        }
        VolumeSendable::Vec4DU16(vec) => {
            let dims = vec.data.dim();
            let t = timepoint.min(dims.3.saturating_sub(1));
            if voxel_coords[0] >= 0.0
                && voxel_coords[0] < dims.0 as f32
                && voxel_coords[1] >= 0.0
                && voxel_coords[1] < dims.1 as f32
                && voxel_coords[2] >= 0.0
                && voxel_coords[2] < dims.2 as f32
            {
                let x = voxel_coords[0].round() as usize;
                let y = voxel_coords[1].round() as usize;
                let z = voxel_coords[2].round() as usize;
                vec.data[[x, y, z, t]] as f32
            } else {
                0.0
            }
        }
        VolumeSendable::Vec4DI32(vec) => {
            let dims = vec.data.dim();
            let t = timepoint.min(dims.3.saturating_sub(1));
            if voxel_coords[0] >= 0.0
                && voxel_coords[0] < dims.0 as f32
                && voxel_coords[1] >= 0.0
                && voxel_coords[1] < dims.1 as f32
                && voxel_coords[2] >= 0.0
                && voxel_coords[2] < dims.2 as f32
            {
                let x = voxel_coords[0].round() as usize;
                let y = voxel_coords[1].round() as usize;
                let z = voxel_coords[2].round() as usize;
                vec.data[[x, y, z, t]] as f32
            } else {
                0.0
            }
        }
        VolumeSendable::Vec4DU32(vec) => {
            let dims = vec.data.dim();
            let t = timepoint.min(dims.3.saturating_sub(1));
            if voxel_coords[0] >= 0.0
                && voxel_coords[0] < dims.0 as f32
                && voxel_coords[1] >= 0.0
                && voxel_coords[1] < dims.1 as f32
                && voxel_coords[2] >= 0.0
                && voxel_coords[2] < dims.2 as f32
            {
                let x = voxel_coords[0].round() as usize;
                let y = voxel_coords[1].round() as usize;
                let z = voxel_coords[2].round() as usize;
                vec.data[[x, y, z, t]] as f32
            } else {
                0.0
            }
        }
        VolumeSendable::Vec4DF64(vec) => {
            let dims = vec.data.dim();
            let t = timepoint.min(dims.3.saturating_sub(1));
            if voxel_coords[0] >= 0.0
                && voxel_coords[0] < dims.0 as f32
                && voxel_coords[1] >= 0.0
                && voxel_coords[1] < dims.1 as f32
                && voxel_coords[2] >= 0.0
                && voxel_coords[2] < dims.2 as f32
            {
                let x = voxel_coords[0].round() as usize;
                let y = voxel_coords[1].round() as usize;
                let z = voxel_coords[2].round() as usize;
                vec.data[[x, y, z, t]] as f32
            } else {
                0.0
            }
        }
    };

    info!(
        "Sampled value: {} at voxel coords {:?}",
        value, voxel_coords
    );

    Ok(value)
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.sample_world_coordinate")]
async fn sample_world_coordinate(
    handle_id: String,
    world_coords: Vec<f32>, // 3 elements for world position
    state: State<'_, BridgeState>,
) -> BridgeResult<f32> {
    sample_world_coordinate_impl(&handle_id, &world_coords, state.inner()).await
}

#[doc(hidden)]
pub async fn sample_world_coordinate_for_testing<C>(
    handle_id: &str,
    world_coords: &C,
    bridge_state: &BridgeState,
) -> BridgeResult<f32>
where
    C: AsRef<[f32]> + ?Sized,
{
    sample_world_coordinate_impl(handle_id, world_coords.as_ref(), bridge_state).await
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.clear_render_layers")]
async fn clear_render_layers(state: State<'_, BridgeState>) -> BridgeResult<()> {
    info!("Bridge: clear_render_layers called");

    // Get render loop service
    let service_guard = state.render_loop_service.lock().await;
    let service_arc = service_guard
        .as_ref()
        .ok_or_else(|| BridgeError::ServiceNotInitialized {
            code: 5006,
            details:
                "GPU rendering service is not initialized. Please initialize the render loop first."
                    .to_string(),
        })?;
    let mut service = service_arc.lock().await;

    // Clear all layers
    service.clear_render_layers();

    info!("Cleared all render layers");
    Ok(())
}

/// Sample a voxel value at world-space position for a given UI layer id.
/// Resolves the UI layer to its volume handle and performs nearest-neighbour sampling on CPU.
async fn sample_layer_value_at_world_impl(
    layer_id: &str,
    world_coords: &[f32],
    state: &BridgeState,
) -> BridgeResult<f32> {
    if world_coords.len() != 3 {
        return Err(BridgeError::Input {
            code: 2016,
            details: "world_coords must be [x, y, z] in mm".to_string(),
        });
    }

    let handle_id = {
        let map = state.layer_to_volume_map.lock().await;
        map.get(layer_id)
            .cloned()
            .ok_or_else(|| BridgeError::Input {
                code: 2017,
                details: format!(
                    "No volume handle mapped for layer '{}'. Ensure the layer is registered.",
                    layer_id
                ),
            })?
    };

    // Reuse the sampling logic from sample_world_coordinate
    sample_world_coordinate_impl(&handle_id, world_coords, state).await
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.sample_layer_value_at_world")]
async fn sample_layer_value_at_world(
    layer_id: String,
    world_coords: Vec<f32>,
    state: State<'_, BridgeState>,
) -> BridgeResult<f32> {
    sample_layer_value_at_world_impl(&layer_id, &world_coords, state.inner()).await
}

#[doc(hidden)]
pub async fn sample_layer_value_at_world_for_testing<C>(
    layer_id: &str,
    world_coords: &C,
    bridge_state: &BridgeState,
) -> BridgeResult<f32>
where
    C: AsRef<[f32]> + ?Sized,
{
    sample_layer_value_at_world_impl(layer_id, world_coords.as_ref(), bridge_state).await
}

#[doc(hidden)]
#[derive(Debug, Clone)]
pub struct VolumeProjectionForTesting {
    pub volume_id: String,
    pub dims: [usize; 3],
    pub volume_data: Vec<f32>,
    pub affine_matrix: [f32; 16],
    pub data_range: DataRange,
    pub timepoint: Option<usize>,
}

fn volume_data_as_f32_for_projection(volume_data: &VolumeSendable) -> BridgeResult<Vec<f32>> {
    match volume_data {
        VolumeSendable::VolF32(vol, _) => Ok(vol.data()),
        VolumeSendable::VolI16(vol, _) => Ok(vol.data().into_iter().map(|v| v as f32).collect()),
        VolumeSendable::VolU8(vol, _) => Ok(vol.data().into_iter().map(|v| v as f32).collect()),
        VolumeSendable::VolI8(vol, _) => Ok(vol.data().into_iter().map(|v| v as f32).collect()),
        VolumeSendable::VolU16(vol, _) => Ok(vol.data().into_iter().map(|v| v as f32).collect()),
        VolumeSendable::VolI32(vol, _) => Ok(vol.data().into_iter().map(|v| v as f32).collect()),
        VolumeSendable::VolU32(vol, _) => Ok(vol.data().into_iter().map(|v| v as f32).collect()),
        VolumeSendable::VolF64(vol, _) => Ok(vol.data().into_iter().map(|v| v as f32).collect()),
        // 4D variants are extracted to a 3D timepoint upstream; anything else
        // (e.g. RGB) is unsupported for scalar projection.
        _ => Err(BridgeError::Input {
            code: 2025,
            details: "volume->surface projection supports scalar volumes only".to_string(),
        }),
    }
}

/// True if the payload is a 4D time series. Projection extracts a single 3D
/// timepoint from these; 3D payloads are read directly (no copy).
fn volume_is_time_series(volume_data: &VolumeSendable) -> bool {
    matches!(
        volume_data,
        VolumeSendable::Vec4DF32(_)
            | VolumeSendable::Vec4DI16(_)
            | VolumeSendable::Vec4DU8(_)
            | VolumeSendable::Vec4DI8(_)
            | VolumeSendable::Vec4DU16(_)
            | VolumeSendable::Vec4DI32(_)
            | VolumeSendable::Vec4DU32(_)
            | VolumeSendable::Vec4DF64(_)
    )
}

/// Serializable result for the `get_volume_for_projection` command.
///
/// Carries the raw voxel buffer plus the voxel->world affine (column-major)
/// so the frontend GPU path (`VolumeSurfaceProjectionService.getVolumeForGPUProjection`
/// -> neurosurface `VolumeProjectionLayer`) can invert the affine and sample
/// the volume per surface vertex in-shader. For 4D time series the requested
/// `timepoint` (default 0) is extracted to a 3D volume first.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct VolumeProjectionData {
    pub volume_id: String,
    /// Spatial dimensions [nx, ny, nz].
    pub dims: [u32; 3],
    /// Raw scalar values as f32, x-fastest (flat index = x + nx*(y + ny*z)).
    pub volume_data: Vec<f32>,
    /// 4x4 voxel->world affine, column-major (16 elements).
    pub affine_matrix: Vec<f32>,
    pub data_range: DataRange,
    pub timepoint: Option<usize>,
}

async fn get_volume_for_projection_impl(
    volume_id: &str,
    timepoint: Option<usize>,
    bridge_state: &BridgeState,
) -> BridgeResult<VolumeProjectionData> {
    let registry = bridge_state.volume_registry.lock().await;
    let volume_data = registry
        .get(volume_id)
        .ok_or_else(|| BridgeError::VolumeNotFound {
            code: 4045,
            details: format!("Volume {} not found", volume_id),
        })?;

    // For 4D time series, materialize the requested 3D timepoint (default 0).
    // 3D payloads are read in place to avoid copying the whole volume.
    let extracted_3d;
    let volume_3d: &VolumeSendable = if volume_is_time_series(volume_data) {
        extracted_3d = extract_3d_volume_at_timepoint(volume_data, timepoint.unwrap_or(0))?;
        &extracted_3d
    } else {
        volume_data
    };

    let dims_vec = get_spatial_dims_from_volume(volume_3d);
    let dims = [
        dims_vec.first().copied().unwrap_or(0) as u32,
        dims_vec.get(1).copied().unwrap_or(0) as u32,
        dims_vec.get(2).copied().unwrap_or(0) as u32,
    ];
    let volume_data_f32 = volume_data_as_f32_for_projection(volume_3d)?;
    let affine = get_affine_from_volume(volume_3d)?.to_homogeneous();
    let mut affine_matrix = vec![0.0_f32; 16];
    for col in 0..4 {
        for row in 0..4 {
            affine_matrix[col * 4 + row] = affine[(row, col)];
        }
    }
    let (min, max) = compute_data_range_from_volume(volume_3d);

    Ok(VolumeProjectionData {
        volume_id: volume_id.to_string(),
        dims,
        volume_data: volume_data_f32,
        affine_matrix,
        data_range: DataRange { min, max },
        timepoint,
    })
}

/// Return raw volume data + voxel->world affine for GPU volume->surface
/// projection. 3D scalar volumes only (errors on 4D/non-scalar via
/// `volume_data_as_f32_for_projection`); 4D timepoint extraction is vol2surf M3.
#[command]
#[tracing::instrument(skip_all, err, name = "api.get_volume_for_projection")]
async fn get_volume_for_projection(
    volume_id: String,
    timepoint: Option<usize>,
    state: State<'_, BridgeState>,
) -> BridgeResult<VolumeProjectionData> {
    get_volume_for_projection_impl(&volume_id, timepoint, state.inner()).await
}

#[doc(hidden)]
pub async fn get_volume_for_projection_for_testing(
    volume_id: &str,
    timepoint: Option<usize>,
    bridge_state: &BridgeState,
) -> BridgeResult<VolumeProjectionForTesting> {
    let data = get_volume_for_projection_impl(volume_id, timepoint, bridge_state).await?;
    let mut affine_matrix = [0.0_f32; 16];
    affine_matrix.copy_from_slice(&data.affine_matrix);
    Ok(VolumeProjectionForTesting {
        volume_id: data.volume_id,
        dims: [
            data.dims[0] as usize,
            data.dims[1] as usize,
            data.dims[2] as usize,
        ],
        volume_data: data.volume_data,
        affine_matrix,
        data_range: data.data_range,
        timepoint: data.timepoint,
    })
}

// ---------------------------------------------------------------------------
// vol2surf M5: CPU volume -> surface projection + reusable sampler tier.
//
// Wraps the authoritative R-parity algorithm in `neurosurf_rs::analysis`
// (vol_to_surf / surface_sampler / apply_surface_sampler). Result structs are
// Serialize-only on purpose: the frontend declares its own inline interfaces
// (VolToSurfProjectionResult / SamplerInfo) in VolumeSurfaceProjectionService.ts,
// so these are NOT ts-exported. Field names MUST match those interfaces exactly.
// ---------------------------------------------------------------------------

/// Per-vertex projection result. Mirrors the frontend `VolToSurfProjectionResult`.
#[derive(Debug, Clone, Serialize)]
pub struct VolToSurfProjectionResult {
    /// Handle to the stored per-vertex overlay (fetch via get_surface_overlay_data).
    pub data_handle: String,
    pub surface_handle: String,
    pub volume_id: String,
    pub valid_vertex_count: usize,
    pub total_vertex_count: usize,
    pub coverage_percent: f32,
    pub data_range: Option<DataRange>,
    pub timepoint: Option<usize>,
}

/// Sampler creation result. Mirrors the frontend `SamplerInfo`.
#[derive(Debug, Clone, Serialize)]
pub struct SamplerInfoResult {
    pub sampler_handle: String,
    pub surface_handle: String,
    pub volume_dims: [u32; 3],
    pub vertex_count: usize,
    pub sampling_mode: String,
    pub valid: bool,
}

/// Precomputed sampler held on `BridgeState`.
pub struct SurfaceSamplerEntry {
    pub surface_id: String,
    pub sampler: neurosurf_rs::analysis::SurfaceSampler,
    pub volume_dims: [u32; 3],
    pub vertex_count: usize,
    pub sampling_mode: String,
}

fn parse_mapping_function(s: Option<&str>) -> neurosurf_rs::analysis::MappingFunction {
    use neurosurf_rs::analysis::MappingFunction;
    match s.unwrap_or("average") {
        "nearest_neighbor" | "nearest" | "nn" => MappingFunction::NearestNeighbor,
        "mode" => MappingFunction::Mode,
        _ => MappingFunction::Average,
    }
}

fn parse_sampling_mode(s: Option<&str>) -> neurosurf_rs::analysis::SamplingMode {
    use neurosurf_rs::analysis::SamplingMode;
    match s.unwrap_or("midpoint") {
        "thickness" => SamplingMode::Thickness,
        "normal_line" | "normalline" => SamplingMode::NormalLine,
        _ => SamplingMode::Midpoint,
    }
}

fn sampling_mode_to_str(m: neurosurf_rs::analysis::SamplingMode) -> String {
    use neurosurf_rs::analysis::SamplingMode;
    match m {
        SamplingMode::Thickness => "thickness",
        SamplingMode::NormalLine => "normal_line",
        SamplingMode::Midpoint => "midpoint",
    }
    .to_string()
}

/// Translate the frontend `params` object into `VolToSurfParams`, keeping
/// library defaults for any field the caller omits.
fn parse_vol_to_surf_params(params: &serde_json::Value) -> neurosurf_rs::analysis::VolToSurfParams {
    // Default fill to NaN (no-coverage sentinel) rather than the library's 0.0,
    // which is indistinguishable from a real stat value of 0 and is wrongly
    // counted as coverage. A NaN fill is excluded by coverage_and_range's
    // is_finite() check and rendered transparent on the frontend.
    let mut p = neurosurf_rs::analysis::VolToSurfParams {
        fill: f64::NAN,
        ..neurosurf_rs::analysis::VolToSurfParams::default()
    };
    if let Some(s) = params.get("mapping_function").and_then(|v| v.as_str()) {
        p.mapping_function = parse_mapping_function(Some(s));
    }
    if let Some(s) = params
        .get("sampling_mode")
        .or_else(|| params.get("sampling"))
        .and_then(|v| v.as_str())
    {
        p.sampling = parse_sampling_mode(Some(s));
    }
    if let Some(v) = params.get("knn").and_then(|v| v.as_u64()) {
        p.knn = v as usize;
    }
    if let Some(v) = params.get("sigma").and_then(|v| v.as_f64()) {
        p.sigma = v;
    }
    if let Some(v) = params.get("distance_threshold").and_then(|v| v.as_f64()) {
        p.distance_threshold = v;
    }
    if let Some(v) = params.get("fill").and_then(|v| v.as_f64()) {
        p.fill = v;
    }
    if let Some(v) = params.get("n_samples").and_then(|v| v.as_u64()) {
        p.n_samples = Some(v as usize);
    }
    if let Some(v) = params.get("radius").and_then(|v| v.as_f64()) {
        p.radius = v;
    }
    if let Some(arr) = params
        .get("depth_fractions")
        .or_else(|| params.get("depth"))
        .and_then(|v| v.as_array())
    {
        let depth: Vec<f64> = arr.iter().filter_map(|x| x.as_f64()).collect();
        if !depth.is_empty() {
            p.depth = Some(depth);
        }
    }
    p
}

/// Coverage (count of vertices with valid data) + data range over valid values.
/// For label mappings, `fill` marks "no data"; for averaging, any finite value
/// counts (genuine zeros are real data).
fn coverage_and_range(
    values: &[f64],
    mapping: neurosurf_rs::analysis::MappingFunction,
    fill: f64,
) -> (usize, Option<DataRange>) {
    use neurosurf_rs::analysis::MappingFunction;
    let mut valid = 0usize;
    let mut min = f64::INFINITY;
    let mut max = f64::NEG_INFINITY;
    for &v in values {
        let ok = v.is_finite()
            && match mapping {
                MappingFunction::NearestNeighbor | MappingFunction::Mode => v != fill,
                MappingFunction::Average => true,
            };
        if ok {
            valid += 1;
            min = min.min(v);
            max = max.max(v);
        }
    }
    let range = if valid > 0 {
        Some(DataRange {
            min: min as f32,
            max: max as f32,
        })
    } else {
        None
    };
    (valid, range)
}

#[cfg(test)]
mod coverage_and_range_tests {
    use super::*;
    use neurosurf_rs::analysis::MappingFunction;

    #[test]
    fn nan_fill_excluded_real_zero_retained() {
        // No-coverage vertices are NaN; a genuine stat value of 0.0 must still
        // count toward coverage and the data range.
        let vals = vec![1.0_f64, f64::NAN, 0.0, 3.0, f64::NAN];
        for mapping in [MappingFunction::Average, MappingFunction::NearestNeighbor] {
            let (valid, range) = coverage_and_range(&vals, mapping, f64::NAN);
            assert_eq!(
                valid, 3,
                "NaN fills excluded, real 0.0 retained ({mapping:?})"
            );
            let r = range.expect("range over finite values");
            assert_eq!(r.min, 0.0);
            assert_eq!(r.max, 3.0);
        }
    }
}

/// Clone the white-matter (+ optional pial) surface geometry out of the registry
/// without holding the lock across the projection compute.
async fn clone_surface_geometries(
    surface_id: &str,
    pial_surface_id: &Option<String>,
    state: &BridgeState,
) -> BridgeResult<(
    neurosurf_rs::geometry::SurfaceGeometry,
    neurosurf_rs::geometry::SurfaceGeometry,
)> {
    let reg = state.surface_registry.lock().await;
    let wm = reg
        .get_surface(surface_id)
        .ok_or_else(|| BridgeError::Input {
            code: 2030,
            details: format!("Surface not found: {surface_id}"),
        })?
        .geometry
        .clone();
    let pial = match pial_surface_id {
        Some(pid) => reg
            .get_surface(pid)
            .ok_or_else(|| BridgeError::Input {
                code: 2030,
                details: format!("Pial surface not found: {pid}"),
            })?
            .geometry
            .clone(),
        // Single-surface projection: white == pial, midpoint == the surface.
        None => wm.clone(),
    };
    Ok((wm, pial))
}

async fn project_volume_to_surface_impl(
    volume_id: String,
    surface_id: String,
    pial_surface_id: Option<String>,
    params: Option<serde_json::Value>,
    timepoint: Option<usize>,
    bridge_state: &BridgeState,
) -> BridgeResult<VolToSurfProjectionResult> {
    let (wm_geom, pial_geom) =
        clone_surface_geometries(&surface_id, &pial_surface_id, bridge_state).await?;
    let vol = get_volume_for_projection_impl(&volume_id, timepoint, bridge_state).await?;
    let volume3d = build_volume3d_from_projection(&vol)?;
    let vts = parse_vol_to_surf_params(&params.unwrap_or(serde_json::Value::Null));
    let mapping = vts.mapping_function;
    let fill = vts.fill;

    let surface = neurosurf_rs::analysis::vol_to_surf(&wm_geom, &pial_geom, &volume3d, None, &vts)
        .map_err(|e| BridgeError::Internal {
            code: 5061,
            details: format!("vol_to_surf projection failed: {e}"),
        })?;
    let values: Vec<f64> = surface.data().to_vec();
    let total = values.len();
    let (valid, range) = coverage_and_range(&values, mapping, fill);
    let coverage_percent = if total > 0 {
        (valid as f32 / total as f32) * 100.0
    } else {
        0.0
    };

    let handle = format!(
        "vol2surf_{surface_id}_{volume_id}_t{}",
        timepoint.unwrap_or(0)
    );
    {
        let mut reg = bridge_state.surface_registry.lock().await;
        if reg.get_surface(&surface_id).is_none() {
            return Err(BridgeError::Input {
                code: 2013,
                details: "Surface was unloaded while projecting data".into(),
            });
        }
        reg.insert_data(handle.clone(), values);
    }

    Ok(VolToSurfProjectionResult {
        data_handle: handle,
        surface_handle: surface_id,
        volume_id,
        valid_vertex_count: valid,
        total_vertex_count: total,
        coverage_percent,
        data_range: range,
        timepoint,
    })
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.project_volume_to_surface")]
async fn project_volume_to_surface(
    volume_id: String,
    surface_id: String,
    pial_surface_id: Option<String>,
    params: Option<serde_json::Value>,
    timepoint: Option<usize>,
    state: State<'_, BridgeState>,
) -> BridgeResult<VolToSurfProjectionResult> {
    project_volume_to_surface_impl(
        volume_id,
        surface_id,
        pial_surface_id,
        params,
        timepoint,
        state.inner(),
    )
    .await
}

async fn create_surface_sampler_impl(
    surface_id: String,
    pial_surface_id: Option<String>,
    template_volume_id: String,
    params: Option<serde_json::Value>,
    bridge_state: &BridgeState,
) -> BridgeResult<SamplerInfoResult> {
    let (wm_geom, pial_geom) =
        clone_surface_geometries(&surface_id, &pial_surface_id, bridge_state).await?;
    let vol = get_volume_for_projection_impl(&template_volume_id, None, bridge_state).await?;
    let volume3d = build_volume3d_from_projection(&vol)?;
    let vts = parse_vol_to_surf_params(&params.unwrap_or(serde_json::Value::Null));

    let sampler = neurosurf_rs::analysis::surface_sampler(
        &wm_geom,
        &pial_geom,
        &volume3d,
        None,
        vts.sampling,
        vts.n_samples,
        vts.depth.clone(),
        vts.radius,
        vts.knn,
        vts.distance_threshold,
    )
    .map_err(|e| BridgeError::Internal {
        code: 5062,
        details: format!("surface_sampler build failed: {e}"),
    })?;

    let vertex_count = sampler.nn_index.dim().0;
    let sampling_mode = sampling_mode_to_str(vts.sampling);
    let handle = format!("sampler_{surface_id}_{template_volume_id}");
    {
        let registry = bridge_state.surface_registry.lock().await;
        if registry.get_surface(&surface_id).is_none() {
            return Err(BridgeError::Input {
                code: 2013,
                details: "Surface was unloaded while preparing its sampler".into(),
            });
        }
        let mut samplers = bridge_state.surface_samplers.lock().await;
        samplers.insert(
            handle.clone(),
            SurfaceSamplerEntry {
                surface_id: surface_id.clone(),
                sampler,
                volume_dims: vol.dims,
                vertex_count,
                sampling_mode: sampling_mode.clone(),
            },
        );
    }

    Ok(SamplerInfoResult {
        sampler_handle: handle,
        surface_handle: surface_id,
        volume_dims: vol.dims,
        vertex_count,
        sampling_mode,
        valid: true,
    })
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.create_surface_sampler")]
async fn create_surface_sampler(
    surface_id: String,
    pial_surface_id: Option<String>,
    template_volume_id: String,
    params: Option<serde_json::Value>,
    state: State<'_, BridgeState>,
) -> BridgeResult<SamplerInfoResult> {
    create_surface_sampler_impl(
        surface_id,
        pial_surface_id,
        template_volume_id,
        params,
        state.inner(),
    )
    .await
}

async fn apply_sampler_impl(
    sampler_handle: String,
    volume_id: String,
    timepoint: Option<usize>,
    mapping_function: Option<String>,
    sigma: Option<f32>,
    fill: Option<f32>,
    bridge_state: &BridgeState,
) -> BridgeResult<VolToSurfProjectionResult> {
    // Build the volume first (locks/drops the volume registry) so we never hold
    // the sampler lock across another registry lock.
    let vol = get_volume_for_projection_impl(&volume_id, timepoint, bridge_state).await?;
    let volume3d = build_volume3d_from_projection(&vol)?;
    let mapping = parse_mapping_function(mapping_function.as_deref());
    let fill_v = fill.unwrap_or(f32::NAN) as f64; // NaN = no-coverage sentinel (see parse_vol_to_surf_params)
    let sigma_v = sigma.unwrap_or(8.0) as f64;

    let (values, surface_id) = {
        let samplers = bridge_state.surface_samplers.lock().await;
        let entry = samplers
            .get(&sampler_handle)
            .ok_or_else(|| BridgeError::Input {
                code: 2031,
                details: format!("Sampler not found: {sampler_handle}"),
            })?;
        let surface = neurosurf_rs::analysis::apply_surface_sampler(
            &entry.sampler,
            &volume3d,
            mapping,
            sigma_v,
            fill_v,
        )
        .map_err(|e| BridgeError::Internal {
            code: 5063,
            details: format!("apply_surface_sampler failed: {e}"),
        })?;
        (surface.data().to_vec(), entry.surface_id.clone())
    };

    let total = values.len();
    let (valid, range) = coverage_and_range(&values, mapping, fill_v);
    let coverage_percent = if total > 0 {
        (valid as f32 / total as f32) * 100.0
    } else {
        0.0
    };

    let handle = format!(
        "vol2surf_{surface_id}_{volume_id}_t{}",
        timepoint.unwrap_or(0)
    );
    {
        let mut reg = bridge_state.surface_registry.lock().await;
        if reg.get_surface(&surface_id).is_none() {
            return Err(BridgeError::Input {
                code: 2013,
                details: "Surface was unloaded while projecting data".into(),
            });
        }
        reg.insert_data(handle.clone(), values);
    }

    Ok(VolToSurfProjectionResult {
        data_handle: handle,
        surface_handle: surface_id,
        volume_id,
        valid_vertex_count: valid,
        total_vertex_count: total,
        coverage_percent,
        data_range: range,
        timepoint,
    })
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.apply_sampler")]
async fn apply_sampler(
    sampler_handle: String,
    volume_id: String,
    timepoint: Option<usize>,
    mapping_function: Option<String>,
    sigma: Option<f32>,
    fill: Option<f32>,
    state: State<'_, BridgeState>,
) -> BridgeResult<VolToSurfProjectionResult> {
    apply_sampler_impl(
        sampler_handle,
        volume_id,
        timepoint,
        mapping_function,
        sigma,
        fill,
        state.inner(),
    )
    .await
}

async fn release_sampler_impl(sampler_handle: String, bridge_state: &BridgeState) {
    let mut samplers = bridge_state.surface_samplers.lock().await;
    samplers.remove(&sampler_handle);
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.release_sampler")]
async fn release_sampler(
    sampler_handle: String,
    state: State<'_, BridgeState>,
) -> BridgeResult<()> {
    release_sampler_impl(sampler_handle, state.inner()).await;
    Ok(())
}

async fn is_layer_ready_internal(layer_id: &str, state: &BridgeState) -> bool {
    let atlas_idx = {
        let atlas_map = state.layer_to_atlas_map.lock().await;
        atlas_map.get(layer_id).copied()
    };
    let Some(atlas_idx) = atlas_idx else {
        return false;
    };

    let has_volume_mapping = {
        let volume_map = state.layer_to_volume_map.lock().await;
        volume_map.contains_key(layer_id)
    };
    if !has_volume_mapping {
        return false;
    }

    let service_arc_opt = { state.render_loop_service.lock().await.clone() };
    let Some(service_arc) = service_arc_opt else {
        return false;
    };

    let service = service_arc.lock().await;
    service.find_layer_index_by_atlas(atlas_idx).is_some()
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.wait_for_layer_ready")]
async fn wait_for_layer_ready(
    layer_id: String,
    timeout_ms: Option<u64>,
    poll_interval_ms: Option<u64>,
    state: State<'_, BridgeState>,
) -> BridgeResult<bool> {
    let timeout = timeout_ms.unwrap_or(5_000).clamp(100, 60_000);
    let poll_interval = poll_interval_ms.unwrap_or(25).clamp(5, 500);
    let start = Instant::now();

    loop {
        if is_layer_ready_internal(&layer_id, state.inner()).await {
            return Ok(true);
        }

        if start.elapsed() >= Duration::from_millis(timeout) {
            warn!(
                "Layer '{}' did not become ready within {}ms (poll={}ms)",
                layer_id, timeout, poll_interval
            );
            return Ok(false);
        }

        tokio::time::sleep(Duration::from_millis(poll_interval)).await;
    }
}

/// Set per-layer slice border settings by UI layer id
#[command]
#[tracing::instrument(skip_all, err, name = "api.set_layer_border")]
async fn set_layer_border(
    layer_id: String,
    enabled: bool,
    thickness_px: f32,
    state: State<'_, BridgeState>,
) -> BridgeResult<()> {
    let atlas_idx = {
        let map = state.layer_to_atlas_map.lock().await;
        *map.get(&layer_id).ok_or_else(|| BridgeError::Input {
            code: 2018,
            details: format!("Layer '{}' not mapped to an atlas index", layer_id),
        })?
    };

    let service_arc_opt = { state.render_loop_service.lock().await.clone() };
    let Some(service_arc) = service_arc_opt else {
        return Err(BridgeError::ServiceNotInitialized {
            code: 5006,
            details: "Render loop not initialized".into(),
        });
    };
    let mut service = service_arc.lock().await;
    let index = service
        .find_layer_index_by_atlas(atlas_idx)
        .ok_or_else(|| BridgeError::Internal {
            code: 8008,
            details: format!(
                "No active render layer found for atlas index {} (layer '{}')",
                atlas_idx, layer_id
            ),
        })?;
    service
        .set_layer_border(index, enabled, thickness_px)
        .map_err(|e| BridgeError::GpuError {
            code: 5016,
            details: format!("Failed to set layer border: {}", e),
        })?;
    Ok(())
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.update_layer_opacity")]
async fn update_layer_opacity(
    layer_index: usize,
    opacity: f32,
    state: State<'_, BridgeState>,
) -> BridgeResult<()> {
    info!(
        "Bridge: update_layer_opacity called for layer {} with opacity {}",
        layer_index, opacity
    );

    // Get render loop service
    let service_guard = state.render_loop_service.lock().await;
    let service_arc = service_guard
        .as_ref()
        .ok_or_else(|| BridgeError::ServiceNotInitialized {
            code: 5006,
            details:
                "GPU rendering service is not initialized. Please initialize the render loop first."
                    .to_string(),
        })?;
    let mut service = service_arc.lock().await;

    // Get current colormap ID to preserve it
    let current_colormap = service
        .layer_state_manager
        .get_layer(layer_index)
        .ok_or_else(|| BridgeError::GpuError {
            code: 5016,
            details: format!("Layer {} not found", layer_index),
        })?
        .colormap_id;

    // Update opacity while preserving colormap
    service
        .update_layer(layer_index, opacity, current_colormap)
        .map_err(|e| BridgeError::GpuError {
            code: 5016,
            details: format!("Failed to update layer opacity: {:?}", e),
        })?;

    Ok(())
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.update_layer_colormap")]
async fn update_layer_colormap(
    layer_index: usize,
    colormap_id: u32,
    state: State<'_, BridgeState>,
) -> BridgeResult<()> {
    info!(
        "Bridge: update_layer_colormap called for layer {} with colormap {}",
        layer_index, colormap_id
    );

    // Get render loop service
    let service_guard = state.render_loop_service.lock().await;
    let service_arc = service_guard
        .as_ref()
        .ok_or_else(|| BridgeError::ServiceNotInitialized {
            code: 5006,
            details:
                "GPU rendering service is not initialized. Please initialize the render loop first."
                    .to_string(),
        })?;
    let mut service = service_arc.lock().await;

    // Update colormap
    service
        .set_layer_colormap(layer_index, colormap_id)
        .map_err(|e| BridgeError::GpuError {
            code: 5017,
            details: format!("Failed to update layer colormap: {:?}", e),
        })?;

    Ok(())
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.update_layer_intensity")]
async fn update_layer_intensity(
    layer_index: usize,
    intensity_min: f32,
    intensity_max: f32,
    state: State<'_, BridgeState>,
) -> BridgeResult<()> {
    info!(
        "Bridge: update_layer_intensity called for layer {} with range [{}, {}]",
        layer_index, intensity_min, intensity_max
    );

    // Get render loop service
    let service_guard = state.render_loop_service.lock().await;
    let service_arc = service_guard
        .as_ref()
        .ok_or_else(|| BridgeError::ServiceNotInitialized {
            code: 5006,
            details:
                "GPU rendering service is not initialized. Please initialize the render loop first."
                    .to_string(),
        })?;
    let mut service = service_arc.lock().await;

    // Update intensity range
    service
        .update_layer_intensity(layer_index, intensity_min, intensity_max)
        .map_err(|e| BridgeError::GpuError {
            code: 5018,
            details: format!("Failed to update layer intensity: {:?}", e),
        })?;

    Ok(())
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.update_layer_threshold")]
async fn update_layer_threshold(
    layer_index: usize,
    threshold_low: f32,
    threshold_high: f32,
    state: State<'_, BridgeState>,
) -> BridgeResult<()> {
    info!(
        "Bridge: update_layer_threshold called for layer {} with range [{}, {}]",
        layer_index, threshold_low, threshold_high
    );

    // Get render loop service
    let service_guard = state.render_loop_service.lock().await;
    let service_arc = service_guard
        .as_ref()
        .ok_or_else(|| BridgeError::ServiceNotInitialized {
            code: 5006,
            details:
                "GPU rendering service is not initialized. Please initialize the render loop first."
                    .to_string(),
        })?;
    let mut service = service_arc.lock().await;

    // Update threshold range
    service
        .update_layer_threshold(layer_index, threshold_low, threshold_high)
        .map_err(|e| BridgeError::GpuError {
            code: 5019,
            details: format!("Failed to update layer threshold: {:?}", e),
        })?;

    Ok(())
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.set_layer_mask")]
async fn set_layer_mask(
    layer_index: usize,
    is_mask: bool,
    state: State<'_, BridgeState>,
) -> BridgeResult<()> {
    info!(
        "Bridge: set_layer_mask called for layer {} with is_mask={}",
        layer_index, is_mask
    );

    // Get render loop service
    let service_guard = state.render_loop_service.lock().await;
    let service_arc = service_guard
        .as_ref()
        .ok_or_else(|| BridgeError::ServiceNotInitialized {
            code: 5006,
            details:
                "GPU rendering service is not initialized. Please initialize the render loop first."
                    .to_string(),
        })?;
    let mut service = service_arc.lock().await;

    // Set mask flag
    service
        .set_layer_mask(layer_index, is_mask)
        .map_err(|e| BridgeError::GpuError {
            code: 5020,
            details: format!("Failed to set layer mask flag: {:?}", e),
        })?;

    Ok(())
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.request_frame")]
async fn request_frame(
    origin_mm: Vec<f32>,  // 3 elements - view origin in world mm
    u_dir: Vec<f32>,      // 3 elements - unit vector for screen X
    v_dir: Vec<f32>,      // 3 elements - unit vector for screen Y
    pixels_per_mm: f32,   // Scale factor
    viewport_width: u32,  // Viewport width in pixels
    viewport_height: u32, // Viewport height in pixels
    state: State<'_, BridgeState>,
) -> BridgeResult<()> {
    info!(
        "Bridge: request_frame called - viewport {}x{}, scale {}",
        viewport_width, viewport_height, pixels_per_mm
    );

    // Validate inputs
    if origin_mm.len() != 3 {
        return Err(BridgeError::Input {
            code: 2020,
            details: "origin_mm must be a 3-element array".to_string(),
        });
    }
    if u_dir.len() != 3 {
        return Err(BridgeError::Input {
            code: 2021,
            details: "u_dir must be a 3-element array".to_string(),
        });
    }
    if v_dir.len() != 3 {
        return Err(BridgeError::Input {
            code: 2022,
            details: "v_dir must be a 3-element array".to_string(),
        });
    }

    // Get render loop service
    let service_guard = state.render_loop_service.lock().await;
    let service_arc = service_guard
        .as_ref()
        .ok_or_else(|| BridgeError::ServiceNotInitialized {
            code: 5006,
            details:
                "GPU rendering service is not initialized. Please initialize the render loop first."
                    .to_string(),
        })?;
    let service = service_arc.lock().await;

    // Calculate frame parameters
    // The u and v vectors need to be scaled by viewport size and pixels_per_mm
    let u_mm = vec3::scale(
        Vec3 {
            x: u_dir[0],
            y: u_dir[1],
            z: u_dir[2],
        },
        viewport_width as f32 / pixels_per_mm,
    );
    let v_mm = vec3::scale(
        Vec3 {
            x: v_dir[0],
            y: v_dir[1],
            z: v_dir[2],
        },
        viewport_height as f32 / pixels_per_mm,
    );

    // Update frame UBO
    service.update_frame_ubo(
        [origin_mm[0], origin_mm[1], origin_mm[2], 1.0],
        [u_mm.x, u_mm.y, u_mm.z, 0.0],
        [v_mm.x, v_mm.y, v_mm.z, 0.0],
    );

    Ok(())
}

// Helper module for vector math
mod vec3 {
    use super::Vec3;

    pub fn scale(v: Vec3, s: f32) -> Vec3 {
        Vec3 {
            x: v.x * s,
            y: v.y * s,
            z: v.z * s,
        }
    }
}

// Simple Vec3 type for internal use
#[derive(Debug, Clone, Copy)]
struct Vec3 {
    x: f32,
    y: f32,
    z: f32,
}

/// Resident image-set ring: maximum co-registered members kept uploaded per layer.
/// Bounded well below the shared texture-slot cap (`MAX_TEXTURES`) so overlay
/// layers keep slots available.
const RESIDENT_RING_MAX_SLOTS: usize = 6;
/// Resident image-set ring: per-layer VRAM byte budget. The effective residency is
/// `min(max_slots, budget / bytes_per_member)`, always at least the shown member.
const RESIDENT_RING_BUDGET_BYTES: u64 = 512 * 1024 * 1024;
/// Resident image-set ring: neighbours prefetched around the shown member.
const RESIDENT_RING_PREFETCH_RADIUS: usize = 2;

/// Whether the GPU-resident image-set fast path is enabled. On by default; set
/// `BRAINFLOW_RESIDENT_IMAGE_SET=0` (or `false`/`off`) to force the legacy
/// extract + re-upload path.
fn resident_image_set_enabled() -> bool {
    !matches!(
        std::env::var("BRAINFLOW_RESIDENT_IMAGE_SET")
            .ok()
            .as_deref()
            .map(str::trim),
        Some("0") | Some("false") | Some("off")
    )
}

/// Drop a layer's resident image-set ring (if any) and free every texture slot it
/// still holds. Safe to call for layers that never had a ring. Errors from freeing
/// an already-free slot are swallowed — teardown is best-effort.
async fn release_resident_image_set(
    layer_id: &str,
    bridge_state: &BridgeState,
    service: &mut RenderLoopService,
) {
    release_resident_image_set_allocations(layer_id, &bridge_state.resident_image_sets, service)
        .await;
}

async fn release_resident_image_set_allocations(
    layer_id: &str,
    resident_image_sets: &Mutex<HashMap<String, image_set::ResidentImageSet>>,
    service: &mut RenderLoopService,
) {
    let resident = {
        let mut sets = resident_image_sets.lock().await;
        sets.remove(layer_id)
    };
    if let Some(resident) = resident {
        for tex_idx in resident.ring.resident_texture_indices() {
            if let Err(e) = service.release_volume(tex_idx) {
                debug!(
                    "Resident image-set teardown: slot {} for layer '{}' already free: {:?}",
                    tex_idx, layer_id, e
                );
            }
        }
    }
}

/// Try to satisfy a member change through the GPU-resident ring instead of the
/// legacy invalidate + extract + re-upload path.
///
/// Returns `Ok(Some(slot))` with the texture slot the layer now samples — a pure
/// `texture_index` swap on a resident hit, or one in-place upload on a miss. Returns
/// `Ok(None)` to fall back to the legacy path (feature disabled, not a multi-member
/// volume, member out of range, missing volume, or the layer could not be
/// repointed). The ring is created lazily on the first member change, seeded at the
/// slot the layer currently occupies.
async fn try_resident_swap(
    layer_id: &str,
    volume_id: &str,
    current_slot: u32,
    cached_member: Option<usize>,
    requested_member: usize,
    bridge_state: &BridgeState,
    service: &mut RenderLoopService,
) -> BridgeResult<Option<u32>> {
    if !resident_image_set_enabled() {
        return Ok(None);
    }

    let mut sets = bridge_state.resident_image_sets.lock().await;

    if !sets.contains_key(layer_id) {
        let (volume_arc, tr_seconds, preserve_labels) = {
            let registry = bridge_state.volume_registry.lock().await;
            match registry.get_entry(volume_id) {
                Some(entry) => (
                    entry.data.clone(),
                    entry
                        .metadata
                        .time_series_info
                        .as_ref()
                        .and_then(|ts| ts.tr),
                    entry.metadata.path.starts_with("atlas:"),
                ),
                None => return Ok(None),
            }
        };

        let set = match image_set::Raw4DImageSet::new(volume_arc, tr_seconds) {
            Some(set) => set,
            None => return Ok(None), // plain 3-D volume: no member axis
        };

        let seed_member = cached_member.unwrap_or(0);
        let resident = image_set::ResidentImageSet::new(
            Box::new(set),
            seed_member,
            current_slot,
            RESIDENT_RING_MAX_SLOTS,
            RESIDENT_RING_BUDGET_BYTES,
            preserve_labels,
        );
        sets.insert(layer_id.to_string(), resident);
    }

    // Phase 1: make the requested member resident (may upload once on a miss).
    let outcome = {
        let resident = sets.get_mut(layer_id).expect("resident set inserted above");
        if requested_member >= resident.member_count() {
            return Ok(None);
        }
        resident.ensure_member(requested_member, service)?
    };

    // Phase 2: if the imperative render-layer path owns an entry for this slot,
    // repoint that layer before publishing the new ViewState registry binding.
    // Some ViewState-only call paths have no imperative layer entry; those still
    // render from `RenderLoopService::volumes[volume_id].atlas_index` below.
    if service.has_render_layer_for_atlas(current_slot) {
        if let Err(e) = service.set_layer_texture_index(current_slot, outcome.texture_index) {
            warn!(
                "Resident image-set could not repoint layer '{}' from slot {} to {}; falling back to re-upload: {:?}",
                layer_id, current_slot, outcome.texture_index, e
            );
            if let Some(resident) = sets.remove(layer_id) {
                for tex_idx in resident.ring.resident_texture_indices() {
                    let _ = service.release_volume(tex_idx);
                }
            }
            return Ok(None);
        }
    }

    // Phase 3: repoint the `volume_id -> slot` binding the ViewState render
    // resolves (`RenderLoopService::volumes[volume_id].atlas_index`) at the resident
    // member. This is the actual swap the ViewState renderer reads each frame — a
    // metadata update with no `write_texture`. On failure, tear the ring down and
    // fall back so the legacy path can rebuild cleanly.
    let data_range = service
        .get_volume_data_range(outcome.texture_index)
        .unwrap_or((0.0, 1.0));
    if let Err(e) =
        service.register_volume_with_range(volume_id.to_string(), outcome.texture_index, data_range)
    {
        warn!(
            "Resident image-set could not repoint volume '{}' to slot {}; falling back to re-upload: {:?}",
            volume_id, outcome.texture_index, e
        );
        if let Some(resident) = sets.remove(layer_id) {
            for tex_idx in resident.ring.resident_texture_indices() {
                let _ = service.release_volume(tex_idx);
            }
        }
        return Ok(None);
    }

    // Phase 4: record the current member and prefetch neighbours into free capacity.
    {
        let resident = sets.get_mut(layer_id).expect("resident set present");
        resident.current_member = requested_member;
        if let Err(e) =
            resident.prefetch_around(requested_member, RESIDENT_RING_PREFETCH_RADIUS, service)
        {
            debug!("Resident image-set prefetch around {requested_member} failed: {e:?}");
        }
    }

    // Keep the bridge's per-layer maps consistent with the swap.
    {
        let mut layer_map = bridge_state.layer_to_atlas_map.lock().await;
        layer_map.insert(layer_id.to_string(), outcome.texture_index);
    }
    {
        let mut timepoint_map = bridge_state.layer_to_timepoint_map.lock().await;
        timepoint_map.insert(layer_id.to_string(), Some(requested_member));
    }

    Ok(Some(outcome.texture_index))
}

// Helper function to allocate GPU resources for a layer on-demand
async fn allocate_gpu_resources_for_layer(
    layer_id: &str,
    volume_id: &str,
    state: &BridgeState,
    render_service: &mut RenderLoopService,
    timepoint: Option<usize>,
) -> BridgeResult<VolumeLayerGpuInfo> {
    info!(
        "Allocating GPU resources on-demand for layer '{}' (volume '{}', timepoint: {:?})",
        layer_id, volume_id, timepoint
    );

    // Get the volume data from registry
    let volume_registry_guard = state.volume_registry.lock().await;
    let volume_arc = volume_registry_guard
        .get_render_arc(volume_id)
        .ok_or_else(|| BridgeError::VolumeNotFound {
            code: 4042,
            details: volume_id.to_owned(),
        })?;
    let volume_data = volume_arc.as_ref();
    let uploaded_timepoint = if volume_sendable_uses_timepoint(volume_data) {
        timepoint
    } else {
        None
    };

    // For 4D volumes, extract the appropriate timepoint
    let volume_to_upload = if let Some(tp) = timepoint {
        // Check if this is a 4D volume
        match volume_data {
            VolumeSendable::Vec4DF32(_)
            | VolumeSendable::Vec4DI16(_)
            | VolumeSendable::Vec4DU8(_)
            | VolumeSendable::Vec4DI8(_)
            | VolumeSendable::Vec4DU16(_)
            | VolumeSendable::Vec4DI32(_)
            | VolumeSendable::Vec4DU32(_)
            | VolumeSendable::Vec4DF64(_) => {
                info!("Extracting timepoint {} from 4D volume", tp);
                // Extract 3D volume at the specified timepoint
                let extracted = extract_3d_volume_at_timepoint(volume_data, tp)?;
                // We need to store this extracted volume temporarily
                std::borrow::Cow::Owned(extracted)
            }
            // For 3D volumes, just use as-is
            _ => std::borrow::Cow::Borrowed(volume_data),
        }
    } else {
        // No timepoint specified, use volume as-is
        std::borrow::Cow::Borrowed(volume_data)
    };

    // Upload to GPU (data range is retrieved from render metadata after upload).
    let (atlas_idx, _world_to_voxel) = match volume_to_upload.as_ref() {
        VolumeSendable::VolF32(vol, _) => {
            let (idx, w2v) = render_service
                .upload_volume_3d(vol)
                .map_err(|e| gpu_allocation_error(layer_id, &e.to_string()))?;
            (idx, w2v)
        }
        VolumeSendable::VolI16(vol, _) => {
            let (idx, w2v) = render_service
                .upload_volume_3d(vol)
                .map_err(|e| gpu_allocation_error(layer_id, &e.to_string()))?;
            (idx, w2v)
        }
        VolumeSendable::VolU8(vol, _) => {
            let (idx, w2v) = render_service
                .upload_volume_3d(vol)
                .map_err(|e| gpu_allocation_error(layer_id, &e.to_string()))?;
            (idx, w2v)
        }
        VolumeSendable::VolI8(vol, _) => {
            let (idx, w2v) = render_service
                .upload_volume_3d(vol)
                .map_err(|e| gpu_allocation_error(layer_id, &e.to_string()))?;
            (idx, w2v)
        }
        VolumeSendable::VolU16(vol, _) => {
            let (idx, w2v) = render_service
                .upload_volume_3d(vol)
                .map_err(|e| gpu_allocation_error(layer_id, &e.to_string()))?;
            (idx, w2v)
        }
        VolumeSendable::VolI32(vol, _) => {
            let (idx, w2v) = render_service
                .upload_volume_3d(vol)
                .map_err(|e| gpu_allocation_error(layer_id, &e.to_string()))?;
            (idx, w2v)
        }
        VolumeSendable::VolU32(vol, _) => {
            let (idx, w2v) = render_service
                .upload_volume_3d(vol)
                .map_err(|e| gpu_allocation_error(layer_id, &e.to_string()))?;
            (idx, w2v)
        }
        VolumeSendable::VolF64(vol, _) => {
            let (idx, w2v) = render_service
                .upload_volume_3d(vol)
                .map_err(|e| gpu_allocation_error(layer_id, &e.to_string()))?;
            (idx, w2v)
        }
        // 4D volumes should have been extracted to 3D already
        VolumeSendable::Vec4DF32(_)
        | VolumeSendable::Vec4DI16(_)
        | VolumeSendable::Vec4DU8(_)
        | VolumeSendable::Vec4DI8(_)
        | VolumeSendable::Vec4DU16(_)
        | VolumeSendable::Vec4DI32(_)
        | VolumeSendable::Vec4DU32(_)
        | VolumeSendable::Vec4DF64(_) => {
            return Err(BridgeError::Internal {
                code: 5013,
                details:
                    "Unexpected 4D volume in GPU allocation - should have been extracted to 3D"
                        .to_string(),
            });
        }
    };

    let (min_val, max_val) = render_service
        .get_volume_data_range(atlas_idx)
        .unwrap_or_else(|| {
            warn!(
                "On-demand allocation missing cached data_range for atlas index {}; falling back to CPU scan",
                atlas_idx
            );
            compute_data_range_from_volume(volume_to_upload.as_ref())
        });

    // Store the mapping
    {
        let mut layer_map = state.layer_to_atlas_map.lock().await;
        debug!(
            "📌 STORING in allocate_gpu_resources_for_layer: layer '{}' -> atlas index {}",
            layer_id, atlas_idx
        );
        layer_map.insert(layer_id.to_string(), atlas_idx);
        debug!(
            "📌 Layer map now contains {} entries: {:?}",
            layer_map.len(),
            layer_map.keys().collect::<Vec<_>>()
        );

        // Also store the volume handle mapping
        let mut volume_map = state.layer_to_volume_map.lock().await;
        volume_map.insert(layer_id.to_string(), volume_id.to_string());

        let mut timepoint_map = state.layer_to_timepoint_map.lock().await;
        timepoint_map.insert(layer_id.to_string(), uploaded_timepoint);
    }

    // Register the volume with the correct data range
    if let Err(e) = render_service.register_volume_with_range(
        volume_id.to_string(),
        atlas_idx,
        (min_val, max_val),
    ) {
        warn!(
            "Failed to register volume {} with atlas index {} and range ({}, {}): {:?}",
            volume_id, atlas_idx, min_val, max_val, e
        );
    } else {
        info!(
            "Successfully registered volume '{}' with atlas index {} and data range ({}, {})",
            volume_id, atlas_idx, min_val, max_val
        );
    }

    // Return minimal GPU info - we only need the atlas index for rendering
    Ok(VolumeLayerGpuInfo {
        layer_id: layer_id.to_string(),
        world_to_voxel: [0.0; 16], // Not needed for on-demand allocation
        dim: [1, 1, 1],            // Not needed
        pad_slices: 0,
        tex_format: GpuTextureFormat::R32Float,
        atlas_layer_index: atlas_idx,
        slice_info: SliceInfo {
            // Dummy slice info
            axis: 2, // Axial
            index: 0,
            axis_name: "Axial".to_string(),
            dimensions: [512, 512],
        },
        texture_coords: TextureCoordinates {
            u_min: 0.0,
            v_min: 0.0,
            u_max: 1.0,
            v_max: 1.0,
        },
        voxel_to_world: [0.0; 16], // Not needed
        origin: [0.0, 0.0, 0.0],
        center_world: [0.0, 0.0, 0.0],
        spacing: [1.0, 1.0, 1.0],
        data_range: Some(DataRange {
            min: min_val,
            max: max_val,
        }),
        source_volume_id: volume_id.to_string(),
        allocated_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs(),
        is_binary_like: (min_val >= 0.0 && max_val <= 1.0) && ((max_val - min_val) <= 1.0),
    })
}

/// Robust layer lookup helper that tries multiple strategies
fn find_layer_atlas_index_robust(
    layer_map: &HashMap<String, u32>,
    layer_id: &str,
    volume_id: &str,
) -> Option<u32> {
    // Strategy 1: Try exact match with layer_id
    if let Some(&idx) = layer_map.get(layer_id) {
        info!(
            "🔍 Found layer via exact layer_id match: '{}' -> {}",
            layer_id, idx
        );
        return Some(idx);
    }

    // Strategy 2: Try exact match with volume_id
    if let Some(&idx) = layer_map.get(volume_id) {
        info!(
            "🔍 Found layer via exact volume_id match: '{}' -> {}",
            volume_id, idx
        );
        return Some(idx);
    }

    // Strategy 3: Try case-insensitive match
    for (key, &idx) in layer_map.iter() {
        if key.eq_ignore_ascii_case(layer_id) {
            warn!(
                "🔍 Found layer via case-insensitive layer_id match: '{}' -> {} (actual key: '{}')",
                layer_id, idx, key
            );
            return Some(idx);
        }
        if key.eq_ignore_ascii_case(volume_id) {
            warn!(
                "🔍 Found layer via case-insensitive volume_id match: '{}' -> {} (actual key: '{}')",
                volume_id, idx, key
            );
            return Some(idx);
        }
    }

    // Strategy 4: Try trimmed match (in case of whitespace issues)
    let layer_id_trimmed = layer_id.trim();
    let volume_id_trimmed = volume_id.trim();

    for (key, &idx) in layer_map.iter() {
        let key_trimmed = key.trim();
        if key_trimmed == layer_id_trimmed {
            warn!(
                "🔍 Found layer via trimmed layer_id match: '{}' -> {} (key had whitespace)",
                layer_id, idx
            );
            return Some(idx);
        }
        if key_trimmed == volume_id_trimmed {
            warn!(
                "🔍 Found layer via trimmed volume_id match: '{}' -> {} (key had whitespace)",
                volume_id, idx
            );
            return Some(idx);
        }
    }

    // Strategy 5: Log detailed comparison for debugging
    error!("🔍 Layer lookup failed completely. Detailed comparison:");
    error!(
        "  Looking for layer_id: '{}' (len: {})",
        layer_id,
        layer_id.len()
    );
    error!(
        "  Looking for volume_id: '{}' (len: {})",
        volume_id,
        volume_id.len()
    );
    error!("  Keys in map:");
    for (key, idx) in layer_map.iter() {
        error!("    Key: '{}' (len: {}) -> idx: {}", key, key.len(), idx);
        error!("      layer_id == key: {}", layer_id == key);
        error!("      volume_id == key: {}", volume_id == key);
    }

    None
}

fn volume_sendable_uses_timepoint(volume_data: &VolumeSendable) -> bool {
    matches!(
        volume_data,
        VolumeSendable::Vec4DF32(_)
            | VolumeSendable::Vec4DI16(_)
            | VolumeSendable::Vec4DU8(_)
            | VolumeSendable::Vec4DI8(_)
            | VolumeSendable::Vec4DU16(_)
            | VolumeSendable::Vec4DI32(_)
            | VolumeSendable::Vec4DU32(_)
            | VolumeSendable::Vec4DF64(_)
    )
}

async fn resolve_requested_render_timepoint(
    volume_id: &str,
    requested_timepoint: Option<usize>,
    state: &BridgeState,
) -> BridgeResult<(bool, Option<usize>)> {
    let volume_registry_guard = state.volume_registry.lock().await;
    let entry =
        volume_registry_guard
            .get_entry(volume_id)
            .ok_or_else(|| BridgeError::VolumeNotFound {
                code: 4042,
                details: format!(
                    "Volume '{}' not found. Please load the volume first.",
                    volume_id
                ),
            })?;

    let requires_timepoint = volume_sendable_uses_timepoint(&entry.data);
    if requires_timepoint && requested_timepoint.is_none() {
        return Err(BridgeError::Input {
            code: 4103,
            details: format!(
                "Render request for 4D volume '{}' must include a timepoint.",
                volume_id
            ),
        });
    }

    Ok((
        requires_timepoint,
        if requires_timepoint {
            requested_timepoint
        } else {
            None
        },
    ))
}

async fn invalidate_cached_layer_for_render(
    layer_id: &str,
    atlas_index: u32,
    bridge_state: &BridgeState,
    service: &mut RenderLoopService,
    reason: &'static str,
) -> BridgeResult<()> {
    // Reclaim any GPU-resident image-set ring for this layer first: its extra
    // resident members occupy multi-texture slots the lease/atlas path does not
    // track, so they must be freed explicitly or they leak the shared slot budget.
    release_resident_image_set(layer_id, bridge_state, service).await;

    if let Some(lease) = {
        let mut leases = bridge_state.layer_leases.lock().await;
        leases.remove(layer_id)
    } {
        lease.release_with_service(service, reason).await?;
        return Ok(());
    }

    {
        let mut layer_map = bridge_state.layer_to_atlas_map.lock().await;
        layer_map.remove(layer_id);
    }
    {
        let mut volume_map = bridge_state.layer_to_volume_map.lock().await;
        volume_map.remove(layer_id);
    }
    {
        let mut timepoint_map = bridge_state.layer_to_timepoint_map.lock().await;
        timepoint_map.remove(layer_id);
    }

    let removed_from_render_state =
        service
            .release_layer_resources(atlas_index)
            .map_err(|e| BridgeError::GpuError {
                code: 5080,
                details: format!(
                    "Failed to remove cached layer {} from render state: {:?}",
                    layer_id, e
                ),
            })?;

    if !removed_from_render_state {
        warn!(
            "Timepoint invalidation for layer '{}' found atlas index {} but no render-state entry",
            layer_id, atlas_index
        );
    }

    info!(
        "Invalidated cached GPU resources for layer {} (atlas layer {}, reason: {})",
        layer_id, atlas_index, reason
    );

    Ok(())
}

// Render output format options
#[derive(Debug, Clone, Copy, PartialEq)]
enum RenderFormat {
    Png,
    RawRgba,
}

impl RenderFormat {
    fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "png" => Some(RenderFormat::Png),
            "rgba" | "raw" => Some(RenderFormat::RawRgba),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenderViewDiagnostics {
    pub requested_view: Option<String>,
    pub format: String,
    pub parse_ms: f32,
    pub service_lock_ms: f32,
    pub target_setup_ms: f32,
    pub layer_processing_ms: f32,
    pub render_loop_ms: f32,
    pub encode_ms: f32,
    pub total_ms: f32,
    pub visible_layer_count: usize,
    pub output_bytes: usize,
    pub output_dimensions: [u32; 2],
    pub warnings: Vec<String>,
    pub frame: render_loop::view_state::FrameDiagnostics,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenderViewTestOutput {
    pub data: Vec<u8>,
    pub diagnostics: RenderViewDiagnostics,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenderViewsDiagnostics {
    pub format: String,
    pub requested_view_count: usize,
    pub parse_ms: f32,
    pub packet_encode_ms: f32,
    pub readback_ms: f32,
    pub total_ms: f32,
    pub output_bytes: usize,
    pub per_view: Vec<RenderViewDiagnostics>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenderViewsTestOutput {
    pub data: Vec<u8>,
    pub diagnostics: RenderViewsDiagnostics,
}

fn duration_ms(duration: std::time::Duration) -> f32 {
    duration.as_secs_f32() * 1000.0
}

#[derive(Deserialize, Debug, Clone)]
struct FrontendViewState {
    views: FrontendViews,
    crosshair: CrosshairState,
    layers: Vec<LayerState>,
    #[serde(rename = "requestedView")]
    requested_view: Option<RequestedView>,
    #[serde(rename = "requestedViews")]
    requested_views: Option<Vec<RequestedView>>,
    timepoint: Option<usize>,
}

#[derive(Deserialize, Debug, Clone)]
struct RequestedView {
    #[serde(rename = "type")]
    view_type: String,
    origin_mm: [f32; 4],
    u_mm: [f32; 4],
    v_mm: [f32; 4],
    width: u32,
    height: u32,
}

#[derive(Deserialize, Debug, Clone)]
struct FrontendViews {
    axial: ViewPlane,
    #[allow(dead_code)]
    sagittal: ViewPlane,
    #[allow(dead_code)]
    coronal: ViewPlane,
}

#[derive(Deserialize, Debug, Clone)]
struct ViewPlane {
    origin_mm: [f32; 3],
    u_mm: [f32; 3],
    v_mm: [f32; 3],
}

fn default_crosshair_rgba() -> [f32; 4] {
    [0.0, 1.0, 0.0, 0.8]
}

#[derive(Deserialize, Debug, Clone)]
struct CrosshairState {
    world_mm: [f32; 3],
    visible: bool,
    #[serde(default = "default_crosshair_rgba")]
    color: [f32; 4],
}

#[derive(Deserialize, Debug, Clone)]
struct LayerState {
    id: String,
    #[serde(rename = "volumeId")]
    volume_id: String,
    visible: bool,
    opacity: f32,
    colormap: String,
    /// Explicit GPU colormap slot id (e.g. a registered categorical/atlas palette).
    /// When present it overrides name-based resolution; used by label layers.
    #[serde(rename = "colormapId", default)]
    colormap_id: Option<u32>,
    intensity: [f32; 2],
    threshold: [f32; 2],
    #[serde(rename = "blendMode")]
    blend_mode: String,
    #[serde(default = "default_interpolation")]
    interpolation: String,
    #[serde(rename = "layerMode", default)]
    layer_mode: render_loop::render_state::LayerMode,
    #[serde(default)]
    outline: Option<LayerOutlineState>,
    #[serde(rename = "alphaMod", default)]
    alpha_mod: Option<AlphaModState>,
}

fn default_interpolation() -> String {
    "linear".to_string()
}

/// Frontend payload for intensity-modulated alpha ("transparent thresholding").
#[derive(Deserialize, Debug, Clone)]
struct AlphaModState {
    /// "off" | "linear" | "gamma".
    #[serde(default)]
    mode: String,
    #[serde(default = "default_alpha_gamma")]
    gamma: f32,
    #[serde(default)]
    center: f32,
}

fn default_alpha_gamma() -> f32 {
    1.0
}

#[derive(Deserialize, Debug, Clone)]
struct LayerOutlineState {
    #[serde(default)]
    enabled: bool,
    #[serde(rename = "selectedLabelId", default)]
    selected_label_id: u32,
    #[serde(default = "default_outline_rgba")]
    color: [f32; 4],
    #[serde(rename = "thicknessPx", default = "default_outline_thickness_px")]
    thickness_px: f32,
}

fn default_outline_rgba() -> [f32; 4] {
    [1.0, 1.0, 0.0, 1.0]
}

fn default_outline_thickness_px() -> f32 {
    1.0
}

#[derive(Debug, Clone)]
struct PreparedFrontendLayers {
    backend_layers: Vec<render_loop::view_state::LayerConfig>,
    processing_time: std::time::Duration,
}

async fn prepare_frontend_layers_for_render(
    frontend_state: &FrontendViewState,
    bridge_state: &BridgeState,
    service: &mut RenderLoopService,
) -> BridgeResult<PreparedFrontendLayers> {
    let mut backend_layers = Vec::new();
    {
        let layer_map = bridge_state.layer_to_atlas_map.lock().await;
        debug!("Current layer_to_atlas_map contents:");
        for (layer_id, atlas_idx) in layer_map.iter() {
            debug!("  Layer ID '{}' -> atlas index {}", layer_id, atlas_idx);
        }
    }

    let layer_processing_start = std::time::Instant::now();
    for layer in &frontend_state.layers {
        debug!("🔍 DEBUG: render_frontend_view_with_diagnostics - Processing layer:");
        debug!("  - Layer ID: '{}'", layer.id);
        debug!("  - Volume ID: '{}'", layer.volume_id);
        debug!("  - Visible: {}, Opacity: {}", layer.visible, layer.opacity);
        debug!("  - Layer ID hash: {:x}", {
            use std::collections::hash_map::DefaultHasher;
            use std::hash::{Hash, Hasher};
            let mut hasher = DefaultHasher::new();
            layer.id.hash(&mut hasher);
            hasher.finish()
        });

        if layer.visible && layer.opacity > 0.0 {
            debug!(
                "  Layer passes visibility check (visible={}, opacity={})",
                layer.visible, layer.opacity
            );
            let _atlas_idx = {
                let (requires_timepoint, requested_render_timepoint) =
                    resolve_requested_render_timepoint(
                        &layer.volume_id,
                        frontend_state.timepoint,
                        bridge_state,
                    )
                    .await?;
                let layer_map = bridge_state.layer_to_atlas_map.lock().await;

                debug!(
                    "  - Searching in layer_map with {} entries",
                    layer_map.len()
                );
                debug!("  - All keys in map:");
                for key in layer_map.keys() {
                    debug!("    Key: '{}'", key);
                }

                let found_idx =
                    find_layer_atlas_index_robust(&layer_map, &layer.id, &layer.volume_id);

                if let Some(idx) = found_idx {
                    drop(layer_map);

                    let cached_timepoint = {
                        let timepoint_map = bridge_state.layer_to_timepoint_map.lock().await;
                        timepoint_map.get(&layer.id).copied().flatten()
                    };
                    let requires_reupload = requires_timepoint
                        && (cached_timepoint != requested_render_timepoint
                            || cached_timepoint.is_none());

                    if requires_reupload {
                        // Flagship fast path: if the layer's members are held in a
                        // GPU-resident ring, changing member is a `texture_index`
                        // swap (and possibly one in-place upload on a miss) instead
                        // of invalidating + re-extracting + re-uploading to a fresh
                        // slot. Falls back to the legacy path on any non-4D / disabled
                        // / not-yet-seeded case.
                        let requested_member = requested_render_timepoint.unwrap_or(0);
                        match try_resident_swap(
                            &layer.id,
                            &layer.volume_id,
                            idx,
                            cached_timepoint,
                            requested_member,
                            bridge_state,
                            service,
                        )
                        .await?
                        {
                            Some(swapped_idx) => {
                                debug!(
                                    "Resident image-set swap: layer '{}' -> member {} at slot {} (no re-upload)",
                                    layer.id, requested_member, swapped_idx
                                );
                                swapped_idx
                            }
                            None => {
                                info!(
                                    "Re-uploading 4D layer '{}' because cached timepoint {:?} does not match requested {:?}",
                                    layer.id, cached_timepoint, requested_render_timepoint
                                );
                                invalidate_cached_layer_for_render(
                                    &layer.id,
                                    idx,
                                    bridge_state,
                                    service,
                                    "render_timepoint_changed",
                                )
                                .await?;

                                let gpu_alloc_start = std::time::Instant::now();
                                let gpu_info = allocate_gpu_resources_for_layer(
                                    &layer.id,
                                    &layer.volume_id,
                                    bridge_state,
                                    service,
                                    requested_render_timepoint,
                                )
                                .await?;
                                let gpu_alloc_time = gpu_alloc_start.elapsed();
                                debug!(
                                    "⏱️  GPU resource re-allocation after timepoint change took: {:?}",
                                    gpu_alloc_time
                                );

                                let allocated_idx = gpu_info.atlas_layer_index;
                                info!(
                                    "Layer {} re-allocated GPU resources at atlas index {} for timepoint {:?}",
                                    layer.id, allocated_idx, requested_render_timepoint
                                );
                                allocated_idx
                            }
                        }
                    } else {
                        debug!(
                            "✅ CACHE HIT: Layer {} already has GPU resources at atlas index {}",
                            layer.id, idx
                        );
                        idx
                    }
                } else {
                    debug!(
                        "❌ CACHE MISS: Layer '{}' not found in layer_map (tried keys: '{}' and '{}')",
                        layer.id, layer.id, layer.volume_id
                    );
                    debug!(
                        "❌ Current layer_map contains {} entries: {:?}",
                        layer_map.len(),
                        layer_map.keys().collect::<Vec<_>>()
                    );

                    drop(layer_map);

                    debug!(
                        "Allocating GPU resources on-demand for layer '{}', volume '{}'",
                        layer.id, layer.volume_id
                    );

                    let gpu_alloc_start = std::time::Instant::now();
                    let gpu_info = allocate_gpu_resources_for_layer(
                        &layer.id,
                        &layer.volume_id,
                        bridge_state,
                        service,
                        requested_render_timepoint,
                    )
                    .await?;
                    let gpu_alloc_time = gpu_alloc_start.elapsed();
                    debug!("⏱️  GPU resource allocation took: {:?}", gpu_alloc_time);

                    let allocated_idx = gpu_info.atlas_layer_index;
                    info!(
                        "Layer {} allocated GPU resources at atlas index {}",
                        layer.id, allocated_idx
                    );
                    allocated_idx
                }
            };

            if colormap_by_name(&layer.colormap).is_none() {
                warn!(
                    "Unknown colormap '{}', defaulting to grayscale",
                    layer.colormap
                );
            }

            let mut backend_layer =
                match render_bridge_adapter::frontend_layer_to_backend_layer(layer) {
                    Some(backend_layer) => backend_layer,
                    None => continue,
                };

            // Parcel data stays numeric until display preparation. Label geometry
            // is sampled nearest; missingness and numeric thresholds live in LUT alpha.
            if let Some(overlay) = bridge_state
                .volume_registry
                .lock()
                .await
                .parcel_overlays
                .get(&layer.volume_id)
            {
                let hidden = (layer.threshold != [0.0, 0.0]).then_some(layer.threshold);
                let rgba = overlay.lut(&layer.colormap, layer.intensity, hidden)?;
                backend_layer.colormap_id = service
                    .upsert_custom_colormap(format!("parcel:{}", layer.volume_id), &rgba)
                    .map_err(|e| parcel_overlay::input(e.to_string()))?;
                backend_layer.layer_mode = render_loop::render_state::LayerMode::Label;
                backend_layer.interpolation = render_loop::view_state::InterpolationMode::Nearest;
                backend_layer.threshold = None;
                backend_layer.alpha_mod = None;
            }

            info!(
                "Adding layer to backend ViewState: volume_id={}, opacity={}, colormap={}, intensity=[{}, {}], threshold=[{}, {}]",
                backend_layer.volume_id,
                backend_layer.opacity,
                backend_layer.colormap_id,
                backend_layer.intensity_window.0,
                backend_layer.intensity_window.1,
                layer.threshold[0],
                layer.threshold[1]
            );

            info!(
                "Layer {} using frontend intensity window: [{:.1}, {:.1}]",
                backend_layer.volume_id,
                backend_layer.intensity_window.0,
                backend_layer.intensity_window.1
            );

            backend_layers.push(backend_layer);
        } else {
            info!(
                "  Layer skipped: visible={}, opacity={} (requires visible=true and opacity>0)",
                layer.visible, layer.opacity
            );
        }
    }

    info!(
        "Created {} backend layers for rendering",
        backend_layers.len()
    );

    Ok(PreparedFrontendLayers {
        backend_layers,
        processing_time: layer_processing_start.elapsed(),
    })
}

// Diagnostics entry point threads many per-render inputs; not worth a params struct.
#[allow(clippy::too_many_arguments)]
async fn render_frontend_view_with_diagnostics(
    frontend_state: &FrontendViewState,
    bridge_state: &BridgeState,
    service: &mut RenderLoopService,
    format: RenderFormat,
    readback_mode: render_loop::view_state::FrameReadbackMode,
    parse_time: std::time::Duration,
    service_lock_time: std::time::Duration,
    prepared_layers: Option<&PreparedFrontendLayers>,
    render_view_id: &str,
) -> BridgeResult<RenderViewTestOutput> {
    let total_start = std::time::Instant::now();
    let target = render_bridge_adapter::select_view_target(frontend_state);
    let requested_view = target.requested_view.clone();
    let format_label = format.label().to_string();

    if readback_mode == render_loop::view_state::FrameReadbackMode::Skip
        && format != RenderFormat::RawRgba
    {
        return Err(BridgeError::Input {
            code: 4002,
            details: "skip readback is only supported with raw RGBA submission".to_string(),
        });
    }

    if let Some(req_view) = &frontend_state.requested_view {
        debug!(
            "Using requested view '{}' with dimensions {}x{}",
            req_view.view_type, req_view.width, req_view.height
        );
    } else {
        debug!("No specific view requested, using axial view with default dimensions");
    }
    let width = target.width;
    let height = target.height;

    debug!(
        "Creating render target for dimensions: {}x{}",
        width, height
    );
    let target_setup_start = std::time::Instant::now();
    service
        .create_offscreen_target(width, height)
        .map_err(|e| BridgeError::GpuError {
            code: 5021,
            details: format!(
                "Failed to create per-view render target ({}x{}): {}",
                width, height, e
            ),
        })?;
    let target_setup_time = target_setup_start.elapsed();

    let prepared_layers_owned;
    let prepared_layers = if let Some(prepared_layers) = prepared_layers {
        prepared_layers
    } else {
        prepared_layers_owned =
            prepare_frontend_layers_for_render(frontend_state, bridge_state, service).await?;
        &prepared_layers_owned
    };
    let backend_layers = prepared_layers.backend_layers.clone();
    let layer_processing_time = prepared_layers.processing_time;

    if backend_layers.is_empty() {
        warn!(
            "No backend layers created from {} frontend layers!",
            frontend_state.layers.len()
        );
        warn!("Frontend layer details:");
        for (idx, layer) in frontend_state.layers.iter().enumerate() {
            warn!(
                "  Layer {}: id='{}', volumeId='{}', visible={}, opacity={}",
                idx, layer.id, layer.volume_id, layer.visible, layer.opacity
            );
        }

        let mut warnings =
            vec!["No backend layers created; returned diagnostic error image".to_string()];

        let (data, encode_ms, output_bytes, format_label) =
            if readback_mode == render_loop::view_state::FrameReadbackMode::Skip {
                warnings[0] = "No backend layers created; submission skipped readback".to_string();
                (Vec::new(), 0.0, 0usize, format_label.clone())
            } else {
                let encode_start = std::time::Instant::now();
                let png_data = render_bridge_adapter::encode_error_png_frame(width, height)?;
                warn!("Returning error image (dark with red border) due to no layers");
                let output_bytes = png_data.len();
                (
                    png_data,
                    duration_ms(encode_start.elapsed()),
                    output_bytes,
                    "png".to_string(),
                )
            };

        let total_time = total_start.elapsed() + parse_time + service_lock_time;
        return Ok(RenderViewTestOutput {
            data,
            diagnostics: RenderViewDiagnostics {
                requested_view,
                format: format_label,
                parse_ms: duration_ms(parse_time),
                service_lock_ms: duration_ms(service_lock_time),
                target_setup_ms: duration_ms(target_setup_time),
                layer_processing_ms: duration_ms(layer_processing_time),
                render_loop_ms: 0.0,
                encode_ms,
                total_ms: duration_ms(total_time),
                visible_layer_count: 0,
                output_bytes,
                output_dimensions: [width as u32, height as u32],
                warnings,
                frame: render_loop::view_state::FrameDiagnostics {
                    readback_mode,
                    ..render_loop::view_state::FrameDiagnostics::default()
                },
            },
        });
    }

    let backend_view_state =
        render_bridge_adapter::build_backend_view_state(frontend_state, backend_layers, &target);

    info!(
        "Created backend ViewState with {} layers, crosshair at {:?}",
        backend_view_state.layers.len(),
        backend_view_state.crosshair_world
    );

    if let (Some(origin), Some(u_vec), Some(v_vec)) = (
        backend_view_state.camera.frame_origin,
        backend_view_state.camera.frame_u_vec,
        backend_view_state.camera.frame_v_vec,
    ) {
        info!("Frame parameters for rendering:");
        info!(
            "  Origin: [{:.1}, {:.1}, {:.1}, {:.1}]",
            origin[0], origin[1], origin[2], origin[3]
        );
        info!(
            "  U vec: [{:.1}, {:.1}, {:.1}, {:.1}]",
            u_vec[0], u_vec[1], u_vec[2], u_vec[3]
        );
        info!(
            "  V vec: [{:.1}, {:.1}, {:.1}, {:.1}]",
            v_vec[0], v_vec[1], v_vec[2], v_vec[3]
        );
        info!("  Viewport: {}x{}", width, height);
    }

    info!(
        "Frame parameters - origin: {:?}, u: {:?}, v: {:?}",
        target.frame_origin, target.frame_u_vec, target.frame_v_vec
    );

    info!("⏱️  Layer processing took: {:?}", layer_processing_time);

    let render_start = std::time::Instant::now();
    service.update_slice_feature_ubo(render_bridge_adapter::slice_features_from_frontend_layers(
        &frontend_state.layers,
    ));
    let frame_result = service
        .request_frame_with_options(
            render_loop::view_state::ViewId::new(render_view_id),
            backend_view_state,
            render_loop::view_state::FrameRequestOptions { readback_mode },
        )
        .await
        .map_err(|e| BridgeError::GpuError {
            code: 8011,
            details: format!("Failed to render frame: {:?}", e),
        })?;
    let render_time = render_start.elapsed();
    info!("⏱️  GPU render (request_frame) took: {:?}", render_time);

    info!(
        "Frame rendered successfully: {}x{}, {} bytes, {} layers rendered",
        frame_result.dimensions[0],
        frame_result.dimensions[1],
        frame_result.image_data.len(),
        frame_result.rendered_layers.len()
    );

    if !frame_result.warnings.is_empty() {
        info!("Render warnings: {:?}", frame_result.warnings);
    }

    if frame_result.image_data.len() >= 400 {
        let width = frame_result.dimensions[0] as usize;
        let height = frame_result.dimensions[1] as usize;
        let center_x = width / 2;
        let center_y = height / 2;
        let center_idx = (center_y * width + center_x) * 4;

        if center_idx + 3 < frame_result.image_data.len() {
            let center_pixel = &frame_result.image_data[center_idx..center_idx + 4];
            info!(
                "Center pixel RGBA: [{}, {}, {}, {}]",
                center_pixel[0], center_pixel[1], center_pixel[2], center_pixel[3]
            );
        }

        let mut non_black_count = 0;
        let mut max_value = 0u8;
        let sample_step = std::cmp::max(1, width / 10);

        for y in (0..height).step_by(sample_step) {
            for x in (0..width).step_by(sample_step) {
                let idx = (y * width + x) * 4;
                if idx + 3 < frame_result.image_data.len() {
                    let r = frame_result.image_data[idx];
                    let g = frame_result.image_data[idx + 1];
                    let b = frame_result.image_data[idx + 2];
                    max_value = max_value.max(r).max(g).max(b);
                    if r > 0 || g > 0 || b > 0 {
                        non_black_count += 1;
                    }
                }
            }
        }

        let total_samples = ((height / sample_step) + 1) * ((width / sample_step) + 1);
        let non_black_percentage = (non_black_count as f32 / total_samples as f32) * 100.0;

        info!(
            "Pixel sampling: {}/{} non-black pixels ({:.1}%), max value: {}",
            non_black_count, total_samples, non_black_percentage, max_value
        );

        if non_black_percentage < 5.0 {
            warn!("Rendered image appears to be mostly black! Check intensity window settings.");
        }
    }

    let width = frame_result.dimensions[0];
    let height = frame_result.dimensions[1];
    let visible_layer_count = frame_result.rendered_layers.len();
    let frame_diagnostics = frame_result.diagnostics.clone();
    let frame_warnings = frame_result.warnings.clone();
    let rgba_data = frame_result.image_data;

    let (result, encode_time) = if readback_mode == render_loop::view_state::FrameReadbackMode::Skip
    {
        (Vec::new(), std::time::Duration::ZERO)
    } else if format == RenderFormat::RawRgba {
        info!("🚀 RAW RGBA: Skipping PNG encoding, returning raw pixel data");
        let rgba_len = rgba_data.len();
        let raw_buffer = render_bridge_adapter::encode_raw_rgba_frame(width, height, rgba_data);

        info!(
            "🚀 RAW RGBA: Returning {} bytes (8 byte header + {} RGBA bytes)",
            raw_buffer.len(),
            rgba_len
        );

        (raw_buffer, std::time::Duration::ZERO)
    } else {
        let png_encode_start = std::time::Instant::now();
        let png_data = render_bridge_adapter::encode_png_frame(width, height, rgba_data)?;
        let png_encode_time = png_encode_start.elapsed();
        info!("⏱️  PNG encoding took: {:?}", png_encode_time);
        info!(
            "Backend: Encoded RGBA to PNG - {} bytes ({}x{})",
            png_data.len(),
            width,
            height
        );

        (png_data, png_encode_time)
    };

    let total_time = total_start.elapsed() + parse_time + service_lock_time;
    debug!(
        "⏱️  TOTAL render_frontend_view_with_diagnostics time: {:?}",
        total_time
    );
    debug!(
        "⏱️  Mode: {}, Total size: {} bytes",
        if format == RenderFormat::RawRgba {
            "RAW RGBA"
        } else {
            "PNG"
        },
        result.len()
    );
    let output_bytes = result.len();

    Ok(RenderViewTestOutput {
        data: result,
        diagnostics: RenderViewDiagnostics {
            requested_view,
            format: format_label,
            parse_ms: duration_ms(parse_time),
            service_lock_ms: duration_ms(service_lock_time),
            target_setup_ms: duration_ms(target_setup_time),
            layer_processing_ms: duration_ms(layer_processing_time),
            render_loop_ms: duration_ms(render_time),
            encode_ms: duration_ms(encode_time),
            total_ms: duration_ms(total_time),
            visible_layer_count,
            output_bytes,
            output_dimensions: [width, height],
            warnings: frame_warnings,
            frame: frame_diagnostics,
        },
    })
}

// Internal implementation that supports both PNG and raw RGBA output
async fn render_view_process(
    view_state_json: String,
    bridge_state: &BridgeState,
    format: RenderFormat,
) -> BridgeResult<Vec<u8>> {
    Ok(render_view_process_with_diagnostics(
        view_state_json,
        bridge_state,
        format,
        render_loop::view_state::FrameReadbackMode::Blocking,
    )
    .await?
    .data)
}

async fn render_view_process_with_diagnostics(
    view_state_json: String,
    bridge_state: &BridgeState,
    format: RenderFormat,
    readback_mode: render_loop::view_state::FrameReadbackMode,
) -> BridgeResult<RenderViewTestOutput> {
    let parse_start = std::time::Instant::now();
    let frontend_state: FrontendViewState =
        match render_bridge_adapter::parse_frontend_view_state(&view_state_json) {
            Ok(state) => {
                debug!(
                    "🎨 Successfully parsed ViewState with {} layers",
                    state.layers.len()
                );
                state
            }
            Err(e) => {
                error!("🎨 Failed to parse ViewState JSON: {}", e);
                error!(
                    "🎨 JSON content preview: {}",
                    view_state_json.chars().take(500).collect::<String>()
                );
                return Err(BridgeError::Internal {
                    code: 4001,
                    details: format!("ViewState JSON parsing failed: {}", e),
                });
            }
        };
    let parse_time = parse_start.elapsed();
    debug!("⏱️  JSON parsing took: {:?}", parse_time);
    debug!(
        "Parsed frontend ViewState with {} layers",
        frontend_state.layers.len()
    );

    let service_lock_start = std::time::Instant::now();
    let service_guard = bridge_state.render_loop_service.lock().await;
    let service_arc = service_guard
        .as_ref()
        .ok_or_else(|| BridgeError::ServiceNotInitialized {
            code: 5006,
            details:
                "GPU rendering service is not initialized. Please initialize the render loop first."
                    .to_string(),
        })?;
    let mut service = service_arc.lock().await;
    let service_lock_time = service_lock_start.elapsed();

    render_frontend_view_with_diagnostics(
        &frontend_state,
        bridge_state,
        &mut service,
        format,
        readback_mode,
        parse_time,
        service_lock_time,
        None,
        "frontend_view",
    )
    .await
}

#[doc(hidden)]
pub async fn render_view_for_testing(
    view_state_json: String,
    bridge_state: &BridgeState,
    format: Option<&str>,
) -> BridgeResult<Vec<u8>> {
    let render_format = format
        .and_then(RenderFormat::from_str)
        .unwrap_or(RenderFormat::RawRgba);
    render_view_process(view_state_json, bridge_state, render_format).await
}

#[doc(hidden)]
pub async fn render_view_with_diagnostics_for_testing(
    view_state_json: String,
    bridge_state: &BridgeState,
    format: Option<&str>,
) -> BridgeResult<RenderViewTestOutput> {
    let render_format = format
        .and_then(RenderFormat::from_str)
        .unwrap_or(RenderFormat::RawRgba);
    render_view_process_with_diagnostics(
        view_state_json,
        bridge_state,
        render_format,
        render_loop::view_state::FrameReadbackMode::Blocking,
    )
    .await
}

#[doc(hidden)]
pub async fn submit_view_with_diagnostics_for_testing(
    view_state_json: String,
    bridge_state: &BridgeState,
) -> BridgeResult<RenderViewDiagnostics> {
    Ok(render_view_process_with_diagnostics(
        view_state_json,
        bridge_state,
        RenderFormat::RawRgba,
        render_loop::view_state::FrameReadbackMode::Skip,
    )
    .await?
    .diagnostics)
}

async fn render_views_process(
    state_json: String,
    bridge_state: &BridgeState,
    format: RenderFormat,
) -> BridgeResult<Vec<u8>> {
    Ok(
        render_views_process_with_diagnostics(state_json, bridge_state, format)
            .await?
            .data,
    )
}

async fn render_views_process_with_diagnostics(
    state_json: String,
    bridge_state: &BridgeState,
    format: RenderFormat,
) -> BridgeResult<RenderViewsTestOutput> {
    let total_start = std::time::Instant::now();
    let parse_start = std::time::Instant::now();
    let frontend_state: FrontendViewState =
        render_bridge_adapter::parse_frontend_view_state(&state_json).map_err(|err| {
            BridgeError::Input {
                code: 4100,
                details: format!("Failed to parse view state JSON: {}", err),
            }
        })?;
    let parse_time = parse_start.elapsed();

    let requested_views = frontend_state
        .requested_views
        .clone()
        .filter(|requests| !requests.is_empty())
        .ok_or_else(|| BridgeError::Input {
            code: 4102,
            details: "render_views expects a non-empty 'requestedViews' array".to_string(),
        })?;

    let mut base_state = frontend_state;
    base_state.requested_views = None;
    base_state.requested_view = None;

    let service_lock_start = std::time::Instant::now();
    let service_arc = {
        let service_guard = bridge_state.render_loop_service.lock().await;
        service_guard
            .as_ref()
            .cloned()
            .ok_or_else(|| BridgeError::ServiceNotInitialized {
                code: 5006,
                details:
                    "GPU rendering service is not initialized. Please initialize the render loop first."
                        .to_string(),
            })?
    };
    let mut service = service_arc.lock().await;
    let service_lock_time = service_lock_start.elapsed();
    let prepared_layers =
        prepare_frontend_layers_for_render(&base_state, bridge_state, &mut service).await?;

    let mut entries: Vec<render_bridge_adapter::MultiViewPacketEntry> =
        Vec::with_capacity(requested_views.len());
    let mut per_view = Vec::with_capacity(requested_views.len());

    let mut readback_views = Vec::with_capacity(requested_views.len());
    let mut view_codes = Vec::with_capacity(requested_views.len());
    for (index, request) in requested_views.into_iter().enumerate() {
        let view_code = render_bridge_adapter::encode_view_type(&request.view_type)?;
        let mut state_for_view = base_state.clone();
        state_for_view.requested_view = Some(request);
        let view_id = format!("frontend_multi_{index}");
        let result = render_frontend_view_with_diagnostics(
            &state_for_view,
            bridge_state,
            &mut service,
            RenderFormat::RawRgba,
            render_loop::view_state::FrameReadbackMode::Skip,
            parse_time,
            service_lock_time,
            Some(&prepared_layers),
            &view_id,
        )
        .await?;
        readback_views.push((
            render_loop::view_state::ViewId::new(view_id),
            result.diagnostics.output_dimensions,
        ));
        view_codes.push(view_code);
        per_view.push(result.diagnostics);
    }
    let readback_start = std::time::Instant::now();
    let images = service
        .read_views_to_images_sized(&readback_views)
        .map_err(|error| BridgeError::GpuError {
            code: 5021,
            details: format!("Failed to read orthogonal views: {error}"),
        })?;
    let readback_ms = duration_ms(readback_start.elapsed());
    drop(service);
    for (index, rgba) in images.into_iter().enumerate() {
        let [width, height] = readback_views[index].1;
        let encode_start = std::time::Instant::now();
        let payload = if format == RenderFormat::RawRgba {
            rgba
        } else {
            render_bridge_adapter::encode_png_frame(width, height, rgba)?
        };
        per_view[index].format = format.label().to_string();
        per_view[index].encode_ms = duration_ms(encode_start.elapsed());
        per_view[index].output_bytes = payload.len();
        entries.push(render_bridge_adapter::MultiViewPacketEntry {
            view_code: view_codes[index],
            width,
            height,
            payload,
        });
    }

    let packet_start = std::time::Instant::now();
    let packet = render_bridge_adapter::encode_multi_view_packet(&entries)?;
    let packet_encode_ms = duration_ms(packet_start.elapsed());
    let total_ms = duration_ms(total_start.elapsed());
    let format_label = format.label().to_string();
    let output_bytes = packet.len();

    Ok(RenderViewsTestOutput {
        data: packet,
        diagnostics: RenderViewsDiagnostics {
            format: format_label,
            requested_view_count: per_view.len(),
            parse_ms: duration_ms(parse_time),
            packet_encode_ms,
            readback_ms,
            total_ms,
            output_bytes,
            per_view,
        },
    })
}

#[doc(hidden)]
pub async fn render_views_for_testing(
    view_state_json: String,
    bridge_state: &BridgeState,
    format: Option<&str>,
) -> BridgeResult<Vec<u8>> {
    let render_format = format
        .and_then(RenderFormat::from_str)
        .unwrap_or(RenderFormat::RawRgba);
    render_views_process(view_state_json, bridge_state, render_format).await
}

#[doc(hidden)]
pub async fn render_views_with_diagnostics_for_testing(
    view_state_json: String,
    bridge_state: &BridgeState,
    format: Option<&str>,
) -> BridgeResult<RenderViewsTestOutput> {
    let render_format = format
        .and_then(RenderFormat::from_str)
        .unwrap_or(RenderFormat::RawRgba);
    render_views_process_with_diagnostics(view_state_json, bridge_state, render_format).await
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.render_views")]
async fn render_views(
    state_json: String,
    format: Option<String>,
    state: State<'_, BridgeState>,
) -> Result<tauri::ipc::Response, BridgeError> {
    debug!("🎨 render_views called with format: {:?}", format);
    let render_format = format
        .as_ref()
        .and_then(|f| RenderFormat::from_str(f))
        .unwrap_or(RenderFormat::RawRgba);

    let start_time = std::time::Instant::now();
    let bridge_state: &BridgeState = state.inner();
    match render_views_process(state_json, bridge_state, render_format).await {
        Ok(result) => {
            debug!(
                "🎨 render_views completed in {}ms ({} bytes)",
                start_time.elapsed().as_millis(),
                result.len()
            );
            Ok(tauri::ipc::Response::new(result))
        }
        Err(err) => {
            error!(
                "🎨 render_views failed after {}ms: {:?}",
                start_time.elapsed().as_millis(),
                err
            );
            Err(err)
        }
    }
}

// New unified render command with format parameter
#[command]
#[tracing::instrument(skip_all, err, name = "api.render_view")]
async fn render_view(
    state_json: String,
    format: Option<String>,
    state: State<'_, BridgeState>,
) -> Result<tauri::ipc::Response, BridgeError> {
    debug!("🎨 render_view called with format: {:?}", format);
    debug!("🎨 state_json length: {} bytes", state_json.len());

    let render_format = format
        .as_ref()
        .and_then(|f| RenderFormat::from_str(f))
        .unwrap_or(RenderFormat::RawRgba);

    debug!("🎨 Using render format: {:?}", render_format);

    // Add timing and detailed error context
    let start_time = std::time::Instant::now();
    let bridge_state: &BridgeState = state.inner();
    match render_view_process(state_json, bridge_state, render_format).await {
        Ok(result) => {
            debug!(
                "🎨 render_view completed successfully in {}ms, result size: {} bytes",
                start_time.elapsed().as_millis(),
                result.len()
            );
            Ok(tauri::ipc::Response::new(result))
        }
        Err(e) => {
            error!(
                "🎨 render_view failed after {}ms: {:?}",
                start_time.elapsed().as_millis(),
                e
            );
            error!("🎨 Error details: {}", e);
            Err(e)
        }
    }
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.submit_view")]
async fn submit_view(
    state_json: String,
    state: State<'_, BridgeState>,
) -> BridgeResult<RenderViewDiagnostics> {
    debug!("🎯 submit_view called");

    let start_time = std::time::Instant::now();
    let bridge_state: &BridgeState = state.inner();
    let result = render_view_process_with_diagnostics(
        state_json,
        bridge_state,
        RenderFormat::RawRgba,
        render_loop::view_state::FrameReadbackMode::Skip,
    )
    .await?;

    debug!(
        "🎯 submit_view completed in {}ms ({:?}, {} warnings)",
        start_time.elapsed().as_millis(),
        result.diagnostics.output_dimensions,
        result.diagnostics.warnings.len()
    );

    Ok(result.diagnostics)
}

// Query metadata about slices along a specific axis
#[command]
#[tracing::instrument(skip_all, err, name = "api.query_slice_axis_meta")]
async fn query_slice_axis_meta(
    volume_id: String,
    axis: String, // "axial", "sagittal", or "coronal"
    state: State<'_, BridgeState>,
) -> BridgeResult<SliceAxisMeta> {
    info!(
        "Bridge: query_slice_axis_meta called for volume {} axis {}",
        volume_id, axis
    );

    // Get volume from registry
    let volume_registry = state.volume_registry.lock().await;
    let volume_data =
        volume_registry
            .get(&volume_id)
            .ok_or_else(|| BridgeError::VolumeNotFound {
                code: 5001,
                details: format!("Volume {} not found in registry", volume_id),
            })?;

    // Extract shape and spacing information based on volume type
    let (shape, spacing) = match volume_data {
        VolumeSendable::VolF32(vol, _) => {
            let space = vol.space();
            (space.dims(), space.spacing())
        }
        VolumeSendable::VolI16(vol, _) => {
            let space = vol.space();
            (space.dims(), space.spacing())
        }
        VolumeSendable::VolU8(vol, _) => {
            let space = vol.space();
            (space.dims(), space.spacing())
        }
        VolumeSendable::VolI8(vol, _) => {
            let space = vol.space();
            (space.dims(), space.spacing())
        }
        VolumeSendable::VolU16(vol, _) => {
            let space = vol.space();
            (space.dims(), space.spacing())
        }
        VolumeSendable::VolI32(vol, _) => {
            let space = vol.space();
            (space.dims(), space.spacing())
        }
        VolumeSendable::VolU32(vol, _) => {
            let space = vol.space();
            (space.dims(), space.spacing())
        }
        VolumeSendable::VolF64(vol, _) => {
            let space = vol.space();
            (space.dims(), space.spacing())
        }
        // 4D volumes - use first 3 dimensions
        VolumeSendable::Vec4DF32(vec) => {
            let space = &vec.space;
            // For 4D, return only the first 3 spatial dimensions
            let dims = &space.dim[0..3];
            let spacing = space.spacing[0..3].iter().map(|&s| s as f32).collect();
            (dims, spacing)
        }
        VolumeSendable::Vec4DI16(vec) => {
            let space = &vec.space;
            let dims = &space.dim[0..3];
            let spacing = space.spacing[0..3].iter().map(|&s| s as f32).collect();
            (dims, spacing)
        }
        VolumeSendable::Vec4DU8(vec) => {
            let space = &vec.space;
            let dims = &space.dim[0..3];
            let spacing = space.spacing[0..3].iter().map(|&s| s as f32).collect();
            (dims, spacing)
        }
        VolumeSendable::Vec4DI8(vec) => {
            let space = &vec.space;
            let dims = &space.dim[0..3];
            let spacing = space.spacing[0..3].iter().map(|&s| s as f32).collect();
            (dims, spacing)
        }
        VolumeSendable::Vec4DU16(vec) => {
            let space = &vec.space;
            let dims = &space.dim[0..3];
            let spacing = space.spacing[0..3].iter().map(|&s| s as f32).collect();
            (dims, spacing)
        }
        VolumeSendable::Vec4DI32(vec) => {
            let space = &vec.space;
            let dims = &space.dim[0..3];
            let spacing = space.spacing[0..3].iter().map(|&s| s as f32).collect();
            (dims, spacing)
        }
        VolumeSendable::Vec4DU32(vec) => {
            let space = &vec.space;
            let dims = &space.dim[0..3];
            let spacing = space.spacing[0..3].iter().map(|&s| s as f32).collect();
            (dims, spacing)
        }
        VolumeSendable::Vec4DF64(vec) => {
            let space = &vec.space;
            let dims = &space.dim[0..3];
            let spacing = space.spacing[0..3].iter().map(|&s| s as f32).collect();
            (dims, spacing)
        }
    };

    // Determine axis index and metadata based on orientation
    let (slice_count, slice_spacing, axis_length) = match axis.as_str() {
        "axial" => {
            // Axial slices along Z axis (index 2)
            let count = shape[2];
            let spacing_mm = spacing[2];
            let length = count as f32 * spacing_mm;
            (count as u32, spacing_mm, length)
        }
        "sagittal" => {
            // Sagittal slices along X axis (index 0)
            let count = shape[0];
            let spacing_mm = spacing[0];
            let length = count as f32 * spacing_mm;
            (count as u32, spacing_mm, length)
        }
        "coronal" => {
            // Coronal slices along Y axis (index 1)
            let count = shape[1];
            let spacing_mm = spacing[1];
            let length = count as f32 * spacing_mm;
            (count as u32, spacing_mm, length)
        }
        _ => {
            return Err(BridgeError::Input {
                code: 5002,
                details: format!(
                    "Invalid axis '{}'. Must be 'axial', 'sagittal', or 'coronal'",
                    axis
                ),
            });
        }
    };

    Ok(SliceAxisMeta {
        slice_count,
        slice_spacing,
        axis_length_mm: axis_length,
    })
}

fn validate_batch_viewport_sizes(
    view_states: &[render_loop::view_state::ViewState],
    width_per_slice: u32,
    height_per_slice: u32,
) -> BridgeResult<()> {
    let expected = [width_per_slice, height_per_slice];
    for (idx, view_state) in view_states.iter().enumerate() {
        if view_state.viewport_size != expected {
            return Err(BridgeError::Input {
                code: 7003,
                details: format!(
                    "Batch slice {idx} viewport_size {:?} does not match request dimensions {:?}",
                    view_state.viewport_size, expected
                ),
            });
        }
    }
    Ok(())
}

// Batch render multiple slices for MosaicView
#[command]
#[tracing::instrument(skip_all, err, name = "api.batch_render_slices")]
async fn batch_render_slices(
    batch_request: BatchRenderRequest,
    state: State<'_, BridgeState>,
) -> Result<tauri::ipc::Response, BridgeError> {
    info!("Bridge: batch_render_slices called");

    // Add detailed logging for debugging
    info!(
        "Batch render: Received JSON (first 1000 chars): {}",
        batch_request
            .view_states_json
            .chars()
            .take(1000)
            .collect::<String>()
    );

    // Parse view states from JSON string to ViewState structs
    let view_states: Vec<render_loop::view_state::ViewState> = match serde_json::from_str(
        &batch_request.view_states_json,
    ) {
        Ok(states) => states,
        Err(e) => {
            // First try to parse as generic JSON to get better error info
            match serde_json::from_str::<serde_json::Value>(&batch_request.view_states_json) {
                Ok(json_value) => {
                    // JSON is valid, problem is with deserialization to ViewState
                    error!("JSON parsed successfully but failed to deserialize to ViewState");
                    error!(
                        "Parsed JSON structure: {}",
                        serde_json::to_string_pretty(&json_value).unwrap_or_default()
                    );

                    // Try to identify the specific field that failed
                    if let Some(array) = json_value.as_array() {
                        for (idx, item) in array.iter().enumerate() {
                            // Check each ViewState for common issues
                            if let Some(obj) = item.as_object() {
                                // Check layers
                                if let Some(layers) = obj.get("layers").and_then(|l| l.as_array()) {
                                    for (layer_idx, layer) in layers.iter().enumerate() {
                                        if let Some(layer_obj) = layer.as_object() {
                                            // Check threshold field specifically
                                            if let Some(threshold) = layer_obj.get("threshold") {
                                                if !threshold.is_null() && !threshold.is_object() {
                                                    error!(
                                                        "ViewState[{}].layers[{}].threshold has invalid type: {:?}",
                                                        idx, layer_idx, threshold
                                                    );
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    return Err(BridgeError::Input {
                        code: 7001,
                        details: format!("JSON structure doesn't match ViewState schema: {}", e),
                    });
                }
                Err(json_err) => {
                    // JSON itself is invalid
                    let column = json_err.column();
                    let line = json_err.line();
                    let error_context = if column > 0
                        && column < batch_request.view_states_json.len()
                    {
                        let start = column.saturating_sub(100);
                        let end = std::cmp::min(column + 100, batch_request.view_states_json.len());
                        format!(
                            "\nError at line {} column {}. Context: ...{}...",
                            line,
                            column,
                            &batch_request.view_states_json[start..end]
                        )
                    } else {
                        String::new()
                    };

                    return Err(BridgeError::Input {
                        code: 7001,
                        details: format!("Invalid JSON: {}{}", json_err, error_context),
                    });
                }
            }
        }
    };

    // Validate batch size
    if view_states.is_empty() {
        return Err(BridgeError::Input {
            code: 7002,
            details: "Empty batch request - no view states provided".to_string(),
        });
    }

    if view_states.len() > 25 {
        return Err(BridgeError::Internal {
            code: 7010,
            details: format!(
                "Batch size {} exceeds GPU limits (max 25)",
                view_states.len()
            ),
        });
    }
    validate_batch_viewport_sizes(
        &view_states,
        batch_request.width_per_slice,
        batch_request.height_per_slice,
    )?;

    info!(
        "Batch render: {} slices at {}x{} each",
        view_states.len(),
        batch_request.width_per_slice,
        batch_request.height_per_slice
    );

    // Verify the render service is initialized and take a single Arc handle we hold
    // for the whole batch (one outer lock, not one re-acquire per slice).
    let service_arc = {
        let service_guard = state.render_loop_service.lock().await;
        service_guard
            .as_ref()
            .ok_or_else(|| BridgeError::ServiceNotInitialized {
                code: 5006,
                details:
                    "GPU rendering service is not initialized. Please initialize the render loop first."
                        .to_string(),
            })?
            .clone()
    };

    let render_start = std::time::Instant::now();

    // Calculate total buffer size
    let slice_count = view_states.len() as u32;
    let bytes_per_slice =
        (batch_request.width_per_slice * batch_request.height_per_slice * 4) as usize; // RGBA
    let total_buffer_size = 4 + 4 + 4 + (bytes_per_slice * slice_count as usize); // header + data
    let expected_size = bytes_per_slice;

    let mut result_buffer = Vec::with_capacity(total_buffer_size);

    // Write header: [width][height][slice_count]
    result_buffer.extend_from_slice(&batch_request.width_per_slice.to_le_bytes());
    result_buffer.extend_from_slice(&batch_request.height_per_slice.to_le_bytes());
    result_buffer.extend_from_slice(&slice_count.to_le_bytes());

    // Env kill-switch: BRAINFLOW_BATCH_READBACK=0 forces the legacy per-slice path
    // (one submit + one blocking `device.poll(Wait)` per slice). The default path
    // renders every slice with readback skipped, then collapses the N blocking GPU
    // syncs into a single batched readback (one encoder, one submit, one poll).
    let use_batched_readback = std::env::var("BRAINFLOW_BATCH_READBACK")
        .map(|v| v != "0")
        .unwrap_or(true);

    if use_batched_readback {
        // Hold the service lock once across the whole batch.
        let mut service = service_arc.lock().await;

        // Phase 1: render every view into its own view target with readback SKIPPED,
        // so no per-slice GPU stall happens. request_frame_with_options is the exact,
        // proven per-view path; batching only changes *when* results are read back.
        // (The former per-slice `create_offscreen_target` was dead weight — the
        // ViewState path renders into per-view targets via `ensure_view`.)
        let mut view_ids = Vec::with_capacity(view_states.len());
        for (idx, view_state) in view_states.iter().enumerate() {
            let view_id = render_loop::view_state::ViewId::new(format!("batch_slice_{}", idx));
            service
                .request_frame_with_options(
                    view_id.clone(),
                    view_state.clone(),
                    render_loop::view_state::FrameRequestOptions {
                        readback_mode: render_loop::view_state::FrameReadbackMode::Skip,
                    },
                )
                .await
                .map_err(|e| BridgeError::GpuError {
                    code: 8011,
                    details: format!("Failed to render slice {}: {:?}", idx, e),
                })?;
            view_ids.push(view_id);
        }

        // Phase 2: one encoder, one submit, one poll(Wait) for all N slices.
        let images = service
            .read_views_to_images(
                &view_ids,
                [
                    batch_request.width_per_slice,
                    batch_request.height_per_slice,
                ],
            )
            .map_err(|e| BridgeError::GpuError {
                code: 5021,
                details: format!("Failed to read back batch: {}", e),
            })?;
        drop(service);

        for (idx, rgba_data) in images.iter().enumerate() {
            if rgba_data.len() != expected_size {
                return Err(BridgeError::Internal {
                    code: 7013,
                    details: format!(
                        "Invalid render result for slice {}: expected {} bytes, got {}",
                        idx,
                        expected_size,
                        rgba_data.len()
                    ),
                });
            }
            result_buffer.extend_from_slice(rgba_data);
        }
    } else {
        // Legacy fallback (kill-switch): render + blocking readback per slice.
        for (idx, view_state) in view_states.iter().enumerate() {
            let mut service = service_arc.lock().await;
            let frame_result = service
                .request_frame(
                    render_loop::view_state::ViewId::new(format!("batch_slice_{}", idx)),
                    view_state.clone(),
                )
                .await
                .map_err(|e| BridgeError::GpuError {
                    code: 8011,
                    details: format!("Failed to render slice {}: {:?}", idx, e),
                })?;
            drop(service);

            let rgba_data = frame_result.image_data;
            if rgba_data.len() != expected_size {
                return Err(BridgeError::Internal {
                    code: 7013,
                    details: format!(
                        "Invalid render result for slice {}: expected {} bytes, got {}",
                        idx,
                        expected_size,
                        rgba_data.len()
                    ),
                });
            }
            result_buffer.extend_from_slice(&rgba_data);
        }
    }

    let render_duration = render_start.elapsed();

    info!(
        "Batch render completed in {:?} ({:.2} ms per slice, batched_readback={})",
        render_duration,
        render_duration.as_millis() as f64 / view_states.len() as f64,
        use_batched_readback
    );

    // Return the batch buffer as a binary response
    Ok(tauri::ipc::Response::new(result_buffer))
}

// --- Atlas Management Commands ---

fn spawn_atlas_progress_forwarder<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    mut progress_rx: tokio::sync::broadcast::Receiver<AtlasLoadProgress>,
) -> (
    tokio::sync::oneshot::Sender<()>,
    tokio::task::JoinHandle<()>,
) {
    let (stop_tx, mut stop_rx) = tokio::sync::oneshot::channel::<()>();
    let task = tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = &mut stop_rx => {
                    break;
                }
                update = progress_rx.recv() => {
                    match update {
                        Ok(progress) => {
                            if let Err(err) = app.emit("atlas-progress", &progress) {
                                debug!("Failed to emit atlas-progress event: {}", err);
                            }

                            if matches!(
                                progress.stage,
                                atlases::LoadingStage::Complete | atlases::LoadingStage::Error
                            ) {
                                break;
                            }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                            warn!("Atlas progress forwarder lagged by {} messages", skipped);
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                    }
                }
            }
        }
    });

    (stop_tx, task)
}

fn spawn_template_progress_forwarder<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    mut progress_rx: tokio::sync::broadcast::Receiver<templates::TemplateLoadProgress>,
) -> (
    tokio::sync::oneshot::Sender<()>,
    tokio::task::JoinHandle<()>,
) {
    let (stop_tx, mut stop_rx) = tokio::sync::oneshot::channel::<()>();
    let task = tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = &mut stop_rx => {
                    break;
                }
                update = progress_rx.recv() => {
                    match update {
                        Ok(progress) => {
                            if let Err(err) = app.emit("template-progress", &progress) {
                                debug!("Failed to emit template-progress event: {}", err);
                            }

                            if matches!(
                                progress.stage,
                                templates::LoadingStage::Complete | templates::LoadingStage::Error
                            ) {
                                break;
                            }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                            warn!("Template progress forwarder lagged by {} messages", skipped);
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                    }
                }
            }
        }
    });

    (stop_tx, task)
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.get_atlas_catalog")]
async fn get_atlas_catalog(state: State<'_, BridgeState>) -> BridgeResult<Vec<AtlasCatalogEntry>> {
    info!("Bridge: get_atlas_catalog called");

    let atlas_service = state.atlas_service.lock().await;
    let catalog = atlas_service
        .get_catalog()
        .await
        .map_err(|e| BridgeError::Internal {
            code: 6001,
            details: format!("Failed to get atlas catalog: {}", e),
        })?;

    Ok(catalog)
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.get_filtered_atlases")]
async fn get_filtered_atlases(
    filter: AtlasFilter,
    state: State<'_, BridgeState>,
) -> BridgeResult<Vec<AtlasCatalogEntry>> {
    info!("Bridge: get_filtered_atlases called");

    let atlas_service = state.atlas_service.lock().await;
    let atlases = atlas_service
        .get_filtered_atlases(&filter)
        .await
        .map_err(|e| BridgeError::Internal {
            code: 6002,
            details: format!("Failed to get filtered atlases: {}", e),
        })?;

    Ok(atlases)
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.get_atlas_entry")]
async fn get_atlas_entry(
    atlas_id: String,
    state: State<'_, BridgeState>,
) -> BridgeResult<Option<AtlasCatalogEntry>> {
    info!("Bridge: get_atlas_entry called for ID: {}", atlas_id);

    let atlas_service = state.atlas_service.lock().await;
    let entry = atlas_service
        .get_atlas_entry(&atlas_id)
        .await
        .map_err(|e| BridgeError::Internal {
            code: 6003,
            details: format!("Failed to get atlas entry: {}", e),
        })?;

    Ok(entry)
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.toggle_atlas_favorite")]
async fn toggle_atlas_favorite(
    atlas_id: String,
    state: State<'_, BridgeState>,
) -> BridgeResult<bool> {
    info!("Bridge: toggle_atlas_favorite called for ID: {}", atlas_id);

    let atlas_service = state.atlas_service.lock().await;
    let is_favorite = atlas_service
        .toggle_favorite(&atlas_id)
        .await
        .map_err(|e| BridgeError::Internal {
            code: 6004,
            details: format!("Failed to toggle favorite: {}", e),
        })?;

    Ok(is_favorite)
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.get_recent_atlases")]
async fn get_recent_atlases(state: State<'_, BridgeState>) -> BridgeResult<Vec<AtlasCatalogEntry>> {
    info!("Bridge: get_recent_atlases called");

    let atlas_service = state.atlas_service.lock().await;
    let recent = atlas_service
        .get_recent_atlases()
        .await
        .map_err(|e| BridgeError::Internal {
            code: 6005,
            details: format!("Failed to get recent atlases: {}", e),
        })?;

    Ok(recent)
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.get_favorite_atlases")]
async fn get_favorite_atlases(
    state: State<'_, BridgeState>,
) -> BridgeResult<Vec<AtlasCatalogEntry>> {
    info!("Bridge: get_favorite_atlases called");

    let atlas_service = state.atlas_service.lock().await;
    let favorites =
        atlas_service
            .get_favorite_atlases()
            .await
            .map_err(|e| BridgeError::Internal {
                code: 6006,
                details: format!("Failed to get favorite atlases: {}", e),
            })?;

    Ok(favorites)
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.validate_atlas_config")]
async fn validate_atlas_config(
    config: AtlasConfig,
    state: State<'_, BridgeState>,
) -> BridgeResult<bool> {
    info!(
        "Bridge: validate_atlas_config called for atlas: {}",
        config.atlas_id
    );

    let atlas_service = state.atlas_service.lock().await;
    atlas_service
        .validate_config(&config)
        .await
        .map_err(|e| BridgeError::Input {
            code: 6007,
            details: format!("Invalid atlas configuration: {}", e),
        })?;

    Ok(true)
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.load_atlas")]
async fn load_atlas<R: Runtime>(
    config: AtlasConfig,
    state: State<'_, BridgeState>,
    window: tauri::Window<R>,
) -> BridgeResult<AtlasLoadResult> {
    info!(
        "Bridge: load_atlas called for atlas: {} in space: {}",
        config.atlas_id, config.space
    );

    let config_for_volume = config.clone();

    // 1) Load atlas via AtlasService to get metadata/progress and ensure data is fetched.
    let atlas_service = state.atlas_service.lock().await;
    let progress_rx = atlas_service.subscribe_progress();
    let (stop_progress_tx, progress_task) =
        spawn_atlas_progress_forwarder(window.app_handle().clone(), progress_rx);

    let internal_result = atlas_service.load_atlas(config).await;
    drop(atlas_service);

    let _ = stop_progress_tx.send(());
    if let Err(join_err) = progress_task.await {
        debug!("Atlas progress forwarder task ended early: {}", join_err);
    }

    let internal_result = internal_result.map_err(|e| BridgeError::Internal {
        code: 6008,
        details: format!("Failed to load atlas: {}", e),
    })?;

    // 2) Locate the underlying neuroatlas NIfTI on disk.
    let nifti_path =
        get_neuroatlas_nifti_path(&config_for_volume).map_err(|details| BridgeError::Internal {
            code: 6009,
            details,
        })?;

    if !nifti_path.exists() {
        return Err(BridgeError::Internal {
            code: 6010,
            details: format!(
                "Atlas NIfTI file not found at expected path: {}",
                nifti_path.display()
            ),
        });
    }

    // 3) Load atlas volume using the standard NIfTI loader.
    let (volume_sendable, _affine) =
        nifti_loader::load_nifti_volume_auto(&nifti_path).map_err(|e| BridgeError::Internal {
            code: 6011,
            details: format!(
                "Failed to load atlas volume from {}: {}",
                nifti_path.display(),
                e
            ),
        })?;

    let loaded_data =
        nifti_loader::NiftiLoader::load(&nifti_path).map_err(|e| BridgeError::Internal {
            code: 6012,
            details: format!(
                "Failed to load atlas metadata from {}: {}",
                nifti_path.display(),
                e
            ),
        })?;

    let (dims, dtype) = match loaded_data {
        bridge_types::Loaded::Volume { dims, dtype, .. } => (dims, dtype),
        _ => {
            return Err(BridgeError::Internal {
                code: 6013,
                details: format!("Atlas file is not a volume: {}", nifti_path.display()),
            });
        }
    };

    // 4) Determine volume type/time-series metadata.
    let (volume_type, time_series_info) = match &volume_sendable {
        bridge_types::VolumeSendable::VolF32(vol, _) => {
            let vol_dims = vol.space().dims();
            if vol_dims.len() > 3 && vol_dims[3] > 1 {
                (
                    bridge_types::VolumeType::TimeSeries4D,
                    Some(bridge_types::TimeSeriesInfo {
                        num_timepoints: vol_dims[3],
                        tr: None,
                        temporal_unit: None,
                        acquisition_time: None,
                    }),
                )
            } else {
                (bridge_types::VolumeType::Volume3D, None)
            }
        }
        _ => (bridge_types::VolumeType::Volume3D, None),
    };

    // 5) Register the atlas volume in the VolumeRegistry.
    let handle_id = format!(
        "atlas_{}_{}",
        internal_result.atlas_metadata.id,
        uuid::Uuid::new_v4()
    );

    let metadata = VolumeMetadataInfo {
        name: internal_result.atlas_metadata.name.clone(),
        path: format!("atlas:{}", internal_result.atlas_metadata.id),
        dtype: dtype.clone(),
        volume_type: volume_type.clone(),
        time_series_info: time_series_info.clone(),
    };

    let mut registry = state.volume_registry.lock().await;
    registry.insert(handle_id.clone(), volume_sendable, metadata);
    if let Some(dictionary) = internal_result.parcel_dictionary {
        registry
            .parcel_dictionaries
            .insert(handle_id.clone(), dictionary);
    }
    drop(registry);

    // Mirror template path timing guard to avoid allocation races.
    tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;

    // 6) Build handle info expected by the frontend.
    let volume_handle_info = VolumeHandleInfo {
        id: handle_id.clone(),
        name: internal_result.atlas_metadata.name.clone(),
        dims: dims.iter().map(|&d| d as usize).collect(),
        dtype,
        volume_type,
        num_timepoints: time_series_info.as_ref().map(|ts| ts.num_timepoints),
        current_timepoint: None,
        time_series_info,
    };

    Ok(AtlasLoadResult {
        success: true,
        atlas_metadata: Some(internal_result.atlas_metadata),
        volume_handle: Some(handle_id),
        volume_handle_info: Some(volume_handle_info),
        error_message: None,
    })
}

/// Start monitoring atlas loading progress and emit events
/// Note: This will start a background task that monitors progress until the service is dropped
#[tauri::command]
async fn start_atlas_progress_monitoring(state: State<'_, BridgeState>) -> BridgeResult<()> {
    info!("Bridge: start_atlas_progress_monitoring called");

    let atlas_service = state.atlas_service.lock().await;
    let _subscription_count = atlas_service.active_subscription_count();
    info!(
        "Progress monitoring started, active subscriptions: {}",
        _subscription_count
    );

    // For now, just indicate that monitoring is available
    // The actual progress events will be sent when atlas operations occur
    // Frontend can listen for 'atlas-progress' events

    Ok(())
}

/// Get the current number of active progress subscriptions for debugging
#[tauri::command]
async fn get_atlas_subscription_count(state: State<'_, BridgeState>) -> BridgeResult<usize> {
    let atlas_service = state.atlas_service.lock().await;
    Ok(atlas_service.active_subscription_count())
}

/// Compute the discrete ROI palette (LUT + legend) for an atlas configuration.
///
/// Prefers native label colors; otherwise uses the `neuroatlas::colors` engine
/// (Schaefer -> NetworkHarmony, others -> MaximinView). An explicit `kind` forces
/// the engine. The returned shape matches the TS `AtlasPaletteResponse` contract.
#[command]
#[tracing::instrument(skip_all, err, name = "api.get_atlas_palette")]
async fn get_atlas_palette(
    config: AtlasConfig,
    kind: Option<atlases::AtlasPaletteKind>,
    seed: Option<u64>,
    state: State<'_, BridgeState>,
) -> BridgeResult<atlases::AtlasPaletteResponse> {
    let atlas_service = state.atlas_service.lock().await;
    atlas_service
        .compute_atlas_palette(&config, kind, seed)
        .await
        .map_err(|e| BridgeError::Internal {
            code: 6020,
            details: format!("Failed to compute atlas palette: {}", e),
        })
}

/// Register a discrete categorical colormap into the shared GPU LUT.
///
/// `lut_rgb` is `(max_label + 1) * 3` bytes; texel k = color of label k. We pack it
/// into a `COLORMAP_LUT_WIDTH`-wide RGBA row (alpha 0 for background id 0 and the
/// tail, 255 for foreground labels) so the label-mode shader can `textureLoad` by
/// id. Returns a stable colormap id for `key` (idempotent re-upload).
#[command]
#[tracing::instrument(skip_all, err, name = "api.register_categorical_colormap")]
async fn register_categorical_colormap(
    key: String,
    max_label: u32,
    lut_rgb: Vec<u8>,
    state: State<'_, BridgeState>,
) -> BridgeResult<u32> {
    let width = render_loop::texture_manager::COLORMAP_LUT_WIDTH as usize;
    if max_label as usize >= width {
        return Err(BridgeError::Input {
            code: 6021,
            details: format!(
                "Atlas max_label {} exceeds categorical colormap capacity {} (texel = label id)",
                max_label,
                width - 1
            ),
        });
    }
    let expected = (max_label as usize + 1) * 3;
    if lut_rgb.len() != expected {
        return Err(BridgeError::Input {
            code: 6022,
            details: format!(
                "lut_rgb length {} does not match (max_label + 1) * 3 = {}",
                lut_rgb.len(),
                expected
            ),
        });
    }

    let mut row = vec![0u8; width * 4];
    for k in 0..=(max_label as usize) {
        let a = if k == 0 { 0 } else { 255 };
        row[k * 4] = lut_rgb[k * 3];
        row[k * 4 + 1] = lut_rgb[k * 3 + 1];
        row[k * 4 + 2] = lut_rgb[k * 3 + 2];
        row[k * 4 + 3] = a;
    }

    let service_arc = {
        let guard = state.render_loop_service.lock().await;
        guard
            .as_ref()
            .ok_or_else(|| BridgeError::ServiceNotInitialized {
                code: 5002,
                details: "GPU rendering service is not initialized.".to_string(),
            })?
            .clone()
    };
    let mut service = service_arc.lock().await;
    service
        .upsert_custom_colormap(key, &row)
        .map_err(|e| BridgeError::Internal {
            code: 6023,
            details: format!("Failed to register categorical colormap: {}", e),
        })
}

/// Load a surface atlas (Glasser or Schaefer) returning per-vertex labels.
#[command]
async fn load_surface_atlas(
    config: AtlasConfig,
    state: State<'_, BridgeState>,
) -> BridgeResult<SurfaceAtlasLoadResult> {
    info!(
        "Bridge: load_surface_atlas called for atlas: {} in space: {}",
        config.atlas_id, config.space
    );

    let atlas_service = state.atlas_service.lock().await;
    let mut result = atlas_service
        .load_surface_atlas(config)
        .await
        .map_err(|e| BridgeError::Internal {
            code: 6020,
            details: format!("Failed to load surface atlas: {}", e),
        })?;

    drop(atlas_service);
    let dictionary = result
        .parcel_dictionary
        .take()
        .ok_or_else(|| parcel_overlay::input("Surface atlas has no parcel dictionary"))?;
    let id = parcel_overlay::dictionary_id(&dictionary)?;
    let mut dictionaries = state.surface_parcel_dictionaries.lock().await;
    dictionaries.retain(|(key, _)| key != &id);
    dictionaries.push_back((id.clone(), dictionary));
    while dictionaries.len() > 64 {
        dictionaries.pop_front();
    }
    result.parcel_dictionary_id = Some(id);
    Ok(result)
}

// --- Template Commands ---

/// Get the complete template catalog
#[command]
#[tracing::instrument(skip_all, err, name = "api.get_template_catalog")]
async fn get_template_catalog(
    state: State<'_, BridgeState>,
) -> BridgeResult<Vec<templates::TemplateCatalogEntry>> {
    info!("Bridge: get_template_catalog called");

    let template_service = state.template_service.lock().await;
    let catalog = template_service
        .get_catalog()
        .await
        .map_err(|e| BridgeError::Internal {
            code: 7001,
            details: format!("Failed to get template catalog: {}", e),
        })?;

    Ok(catalog)
}

/// Get filtered template entries
#[command]
#[tracing::instrument(skip_all, err, name = "api.get_filtered_templates")]
async fn get_filtered_templates(
    filter: templates::TemplateFilter,
    state: State<'_, BridgeState>,
) -> BridgeResult<Vec<templates::TemplateCatalogEntry>> {
    info!("Bridge: get_filtered_templates called");

    let template_service = state.template_service.lock().await;
    let entries = template_service
        .get_filtered_templates(&filter)
        .await
        .map_err(|e| BridgeError::Internal {
            code: 7002,
            details: format!("Failed to get filtered templates: {}", e),
        })?;

    Ok(entries)
}

/// Get a specific template entry by ID
#[command]
#[tracing::instrument(skip_all, err, name = "api.get_template_entry")]
async fn get_template_entry(
    template_id: String,
    state: State<'_, BridgeState>,
) -> BridgeResult<Option<templates::TemplateCatalogEntry>> {
    info!(
        "Bridge: get_template_entry called for template: {}",
        template_id
    );

    let template_service = state.template_service.lock().await;
    let entry = template_service
        .get_template_entry(&template_id)
        .await
        .map_err(|e| BridgeError::Internal {
            code: 7003,
            details: format!("Failed to get template entry: {}", e),
        })?;

    Ok(entry)
}

/// Validate a template configuration
#[command]
#[tracing::instrument(skip_all, err, name = "api.validate_template_config")]
async fn validate_template_config(
    config: templates::TemplateConfig,
    state: State<'_, BridgeState>,
) -> BridgeResult<bool> {
    info!(
        "Bridge: validate_template_config called for template: {}",
        config.id()
    );

    let template_service = state.template_service.lock().await;
    let is_valid = template_service
        .validate_config(&config)
        .await
        .map_err(|e| BridgeError::Internal {
            code: 7004,
            details: format!("Failed to validate template config: {}", e),
        })?;

    Ok(is_valid)
}

/// Load a template and return the template metadata with volume handle
#[command]
#[tracing::instrument(skip_all, err, name = "api.load_template")]
async fn load_template<R: Runtime>(
    config: templates::TemplateConfig,
    state: State<'_, BridgeState>,
    window: tauri::Window<R>,
) -> BridgeResult<templates::TemplateLoadResult> {
    info!("Bridge: load_template called for template: {}", config.id());

    let template_service = state.template_service.lock().await;
    let progress_rx = template_service.subscribe_progress();
    let (stop_progress_tx, progress_task) =
        spawn_template_progress_forwarder(window.app_handle().clone(), progress_rx);

    let result = template_service.load_template(config).await;
    drop(template_service);

    let _ = stop_progress_tx.send(());
    if let Err(join_err) = progress_task.await {
        debug!("Template progress forwarder task ended early: {}", join_err);
    }

    let result = result.map_err(|e| BridgeError::Internal {
        code: 7005,
        details: format!("Failed to load template: {}", e),
    })?;

    Ok(result)
}

/// Load a template by its menu ID (e.g., "MNI152NLin2009cAsym_T1w_1mm")
#[command]
#[tracing::instrument(skip_all, err, name = "api.load_template_by_id")]
async fn load_template_by_id<R: Runtime>(
    template_id: String,
    state: State<'_, BridgeState>,
    window: tauri::Window<R>,
) -> BridgeResult<templates::TemplateLoadResult> {
    info!(
        "Bridge: load_template_by_id called for template: {}",
        template_id
    );

    // Parse the template ID to create a TemplateConfig
    let config = parse_template_id(&template_id)?;

    // Load the template through the template service
    let template_service = state.template_service.lock().await;
    let progress_rx = template_service.subscribe_progress();
    let (stop_progress_tx, progress_task) =
        spawn_template_progress_forwarder(window.app_handle().clone(), progress_rx);

    let result = template_service.load_template(config).await;
    drop(template_service);

    let _ = stop_progress_tx.send(());
    if let Err(join_err) = progress_task.await {
        debug!(
            "Template-by-id progress forwarder task ended early: {}",
            join_err
        );
    }

    let result = result.map_err(|e| BridgeError::Internal {
        code: 7006,
        details: format!("Failed to load template by ID: {}", e),
    })?;

    // Get the cache path from the template service
    let template_service = state.template_service.lock().await;
    let cache_path =
        template_service
            .get_cache_path(&template_id)
            .map_err(|e| BridgeError::Internal {
                code: 7007,
                details: format!("Failed to get template cache path: {}", e),
            })?;
    drop(template_service);

    // Load the volume data for the registry (similar to load_file)
    let (volume_sendable, _affine) =
        nifti_loader::load_nifti_volume_auto(&cache_path).map_err(|e| BridgeError::Internal {
            code: 7008,
            details: format!("Failed to reload template volume for registry: {}", e),
        })?;

    // Create volume metadata for the registry
    let metadata = VolumeMetadataInfo {
        name: result.template_metadata.name.clone(),
        path: format!("template:{}", template_id),
        dtype: result.volume_handle_info.dtype.clone(),
        volume_type: result.volume_handle_info.volume_type.clone(),
        time_series_info: result.volume_handle_info.time_series_info.clone(),
    };

    // Register the volume in the volume registry
    let mut registry = state.volume_registry.lock().await;
    registry.insert(
        result.volume_handle_info.id.clone(),
        volume_sendable,
        metadata,
    );

    // Add explicit synchronization to ensure registry entry is fully committed
    // This prevents GPU allocation timing issues with template loading
    tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
    drop(registry);

    info!(
        "Bridge: Successfully loaded and registered template volume with handle: {} (with sync delay)",
        result.volume_handle_info.id
    );

    Ok(result)
}

/// Get template cache statistics
#[command]
#[tracing::instrument(skip_all, err, name = "api.get_template_cache_stats")]
async fn get_template_cache_stats(
    state: State<'_, BridgeState>,
) -> BridgeResult<templates::TemplateCacheStats> {
    info!("Bridge: get_template_cache_stats called");

    let template_service = state.template_service.lock().await;
    let stats = template_service
        .get_cache_stats()
        .await
        .map_err(|e| BridgeError::Internal {
            code: 7007,
            details: format!("Failed to get template cache stats: {}", e),
        })?;

    Ok(stats)
}

/// Clear the template cache
#[command]
#[tracing::instrument(skip_all, err, name = "api.clear_template_cache")]
async fn clear_template_cache(state: State<'_, BridgeState>) -> BridgeResult<()> {
    info!("Bridge: clear_template_cache called");

    let template_service = state.template_service.lock().await;
    template_service
        .clear_cache()
        .await
        .map_err(|e| BridgeError::Internal {
            code: 7008,
            details: format!("Failed to clear template cache: {}", e),
        })?;

    Ok(())
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.preview_set_studio_imports")]
async fn preview_set_studio_imports(
    request: StudioImportPreviewRequest,
    state: State<'_, BridgeState>,
) -> BridgeResult<Vec<StudioImportCandidate>> {
    preview_set_studio_imports_impl(request, Some(state.inner())).await
}

#[doc(hidden)]
pub async fn preview_set_studio_imports_for_testing(
    request: StudioImportPreviewRequest,
    state: Option<&BridgeState>,
) -> BridgeResult<Vec<StudioImportCandidate>> {
    preview_set_studio_imports_impl(request, state).await
}

async fn preview_set_studio_imports_impl(
    request: StudioImportPreviewRequest,
    state: Option<&BridgeState>,
) -> BridgeResult<Vec<StudioImportCandidate>> {
    if request.mode == bridge_types::StudioImportMode::Regex {
        if let Some(state) = state {
            if let Some(inventory) = remote_discovery_inventory_for_request(state, &request).await?
            {
                return Ok(
                    field_table::preview_import_candidates_with_discovery_inventory(
                        request,
                        Some(inventory),
                    ),
                );
            }
        }
    }

    Ok(field_table::preview_import_candidates(request))
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.preview_folder_ontology")]
async fn preview_folder_ontology(
    request: StudioFolderOntologyPreviewRequest,
    state: State<'_, BridgeState>,
) -> BridgeResult<StudioFolderOntologySummary> {
    preview_folder_ontology_impl(request, Some(state.inner())).await
}

#[doc(hidden)]
pub async fn preview_folder_ontology_for_testing(
    request: StudioFolderOntologyPreviewRequest,
    state: Option<&BridgeState>,
) -> BridgeResult<StudioFolderOntologySummary> {
    preview_folder_ontology_impl(request, state).await
}

async fn preview_folder_ontology_impl(
    request: StudioFolderOntologyPreviewRequest,
    state: Option<&BridgeState>,
) -> BridgeResult<StudioFolderOntologySummary> {
    if let Some(state) = state {
        if let Some(inventory) =
            remote_discovery_inventory_for_folder_ontology_request(state, &request).await?
        {
            return Ok(
                field_table::preview_folder_ontology_with_discovery_inventory(request, inventory),
            );
        }
    }

    Ok(field_table::preview_folder_ontology(request))
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.promote_discovery_to_neurotabs")]
async fn promote_discovery_to_neurotabs(
    request: StudioDiscoveryPromotionRequest,
) -> BridgeResult<StudioDiscoveryPromotionResult> {
    field_table::promote_discovery_to_neurotabs(request).map_err(|details| BridgeError::Internal {
        code: 9603,
        details,
    })
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.materialize_set_studio_compare_panes")]
async fn materialize_set_studio_compare_panes(
    request: bridge_types::StudioCompareMaterializeRequest,
) -> BridgeResult<Vec<bridge_types::StudioComparePaneSpec>> {
    Ok(field_table::materialize_compare_panes(request))
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.start_set_studio_compare_materialization")]
async fn start_set_studio_compare_materialization(
    request: bridge_types::StudioCompareMaterializeRequest,
    state: State<'_, BridgeState>,
) -> BridgeResult<String> {
    materialization::start_compare_materialization_job(
        Arc::clone(&state.set_studio_materialization_jobs),
        request,
    )
    .await
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.get_set_studio_materialization_status")]
async fn get_set_studio_materialization_status(
    job_id: String,
    state: State<'_, BridgeState>,
) -> BridgeResult<Option<bridge_types::StudioMaterializationJobStatus>> {
    let jobs = state.set_studio_materialization_jobs.lock().await;
    Ok(jobs.get_status(&job_id).await)
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.cancel_set_studio_materialization")]
async fn cancel_set_studio_materialization(
    job_id: String,
    state: State<'_, BridgeState>,
) -> BridgeResult<bool> {
    let mut jobs = state.set_studio_materialization_jobs.lock().await;
    Ok(jobs.cancel(&job_id).await)
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.check_bids_directory")]
async fn check_bids_directory(path: String) -> BridgeResult<bool> {
    let dir = std::path::PathBuf::from(&path);
    let has_description = dir.join("dataset_description.json").exists();
    let has_participants = dir.join("participants.tsv").exists();
    Ok(has_description && has_participants)
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.scan_bids_dataset")]
async fn scan_bids_dataset(
    dataset_path: String,
    state: State<'_, BridgeState>,
) -> BridgeResult<bridge_types::bids::BidsDatasetSummary> {
    use bids_rs::{BidsProject, ComplianceChecker};
    use bridge_types::bids::*;

    info!("Bridge: scan_bids_dataset called for {}", dataset_path);

    let dir = PathBuf::from(&dataset_path);

    // Materialize key files for remote mount support
    let desc_path = dir.join("dataset_description.json");
    let participants_path = dir.join("participants.tsv");
    materialize_remote_file_if_needed(state.inner(), &desc_path).await?;
    materialize_remote_file_if_needed(state.inner(), &participants_path).await?;

    // Load the BIDS project (blocking I/O on spawn_blocking)
    let dataset_path_clone = dataset_path.clone();
    let summary = tokio::task::spawn_blocking(move || -> BridgeResult<BidsDatasetSummary> {
        let project = BidsProject::with_options(
            &dataset_path_clone,
            bids_rs::DerivativesMode::Auto,
            false, // non-strict: allow missing participants.tsv
        )
        .map_err(|e| BridgeError::Input {
            code: 3001,
            details: format!("Failed to load BIDS dataset: {}", e),
        })?;

        // --- Summary counts ---
        let proj_summary = project.summary();
        let session_ids: Vec<String> = project
            .sessions()
            .into_iter()
            .map(|s| s.to_string())
            .collect();
        let task_ids: Vec<String> = project.tasks().to_vec();
        let modalities: Vec<String> = proj_summary.modalities.clone();

        // --- Dataset description fields ---
        let ds_name = project
            .description
            .get("Name")
            .and_then(|v| v.as_str())
            .unwrap_or(&project.name)
            .to_string();
        let bids_version = project
            .description
            .get("BIDSVersion")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();
        let license = project
            .description
            .get("License")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let authors: Vec<String> = project
            .description
            .get("Authors")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        // --- Coverage matrix ---
        let subjects: Vec<String> = project
            .participants()
            .into_iter()
            .map(|s| s.to_string())
            .collect();

        // Collect all files and build a lookup: (subject, session, suffix, task) -> Vec<BidsFile>
        let all_files = project
            .search_files()
            .strict(false)
            .collect()
            .unwrap_or_default();

        // Discover unique columns from the file set
        let mut col_set: Vec<BidsCoverageColumn> = Vec::new();
        let mut col_keys: HashSet<String> = HashSet::new();

        for f in &all_files {
            let sub = f.entities.get("sub");
            if sub.is_none() {
                continue; // skip non-subject files
            }
            let ses = f.entities.get("ses").cloned();
            let task = f.entities.get("task").cloned();
            let suffix = &f.suffix;
            let modality = f.kind.as_deref().unwrap_or("other");

            let key = format!(
                "{}|{}|{}|{}",
                ses.as_deref().unwrap_or(""),
                modality,
                suffix,
                task.as_deref().unwrap_or("")
            );
            if col_keys.insert(key) {
                let label = {
                    let mut parts = Vec::new();
                    if let Some(s) = &ses {
                        parts.push(format!("ses-{}", s));
                    }
                    parts.push(suffix.clone());
                    if let Some(t) = &task {
                        parts.push(format!("task-{}", t));
                    }
                    parts.join("_")
                };
                col_set.push(BidsCoverageColumn {
                    session: ses,
                    modality: modality.to_string(),
                    suffix: suffix.clone(),
                    task,
                    label,
                });
            }
        }
        col_set.sort_by(|a, b| a.label.cmp(&b.label));

        // Build cells: subjects (rows) x columns
        let mut cells: Vec<Vec<BidsCoverageCell>> = Vec::with_capacity(subjects.len());
        for sub in &subjects {
            let mut row: Vec<BidsCoverageCell> = Vec::with_capacity(col_set.len());
            for col in &col_set {
                // Find matching files for this subject + column
                let matching: Vec<&bids_rs::BidsFile> = all_files
                    .iter()
                    .filter(|f| {
                        f.entities.get("sub").map(|s| s.as_str()) == Some(sub.as_str())
                            && f.entities.get("ses").as_ref().map(|s| s.as_str())
                                == col.session.as_deref()
                            && f.suffix == col.suffix
                            && f.entities.get("task").as_ref().map(|s| s.as_str())
                                == col.task.as_deref()
                    })
                    .collect();

                let run_count = matching.len();
                let mut size_bytes = 0u64;
                let mut file_paths: Vec<String> = Vec::new();
                for mf in &matching {
                    size_bytes += std::fs::metadata(&mf.path).map(|m| m.len()).unwrap_or(0);
                    file_paths.push(mf.path.display().to_string());
                }

                row.push(BidsCoverageCell {
                    present: run_count > 0,
                    run_count,
                    size_bytes,
                    file_paths,
                });
            }
            cells.push(row);
        }

        let coverage = BidsCoverageMatrix {
            subjects: subjects.clone(),
            columns: col_set,
            cells,
        };

        // --- Participants ---
        let participant_columns: Vec<String> = {
            let mut cols: HashSet<String> = HashSet::new();
            for p in project.participants_full() {
                for k in p.metadata.keys() {
                    cols.insert(k.clone());
                }
            }
            let mut sorted: Vec<String> = cols.into_iter().collect();
            sorted.sort();
            sorted
        };

        let participants: Vec<BidsParticipantRow> = project
            .participants_full()
            .iter()
            .map(|p| BidsParticipantRow {
                participant_id: p.id.clone(),
                values: p.metadata.clone(),
            })
            .collect();

        // --- Task designs ---
        let task_designs: Vec<BidsTaskDesign> = {
            let all_events = project.read_all_events().unwrap_or_default();
            let mut by_task: HashMap<String, Vec<&bids_rs::EventData>> = HashMap::new();
            for ev in &all_events {
                if let Some(task) = &ev.task {
                    by_task.entry(task.clone()).or_default().push(ev);
                }
            }
            let mut designs: Vec<BidsTaskDesign> = Vec::new();
            for (task, events_list) in &by_task {
                let mut trial_type_set: HashSet<String> = HashSet::new();
                let mut events_per_type: HashMap<String, usize> = HashMap::new();
                let mut total_duration: f64 = 0.0;
                let mut total_events: usize = 0;

                for ev in events_list {
                    for tt in &ev.trial_type {
                        trial_type_set.insert(tt.clone());
                        *events_per_type.entry(tt.clone()).or_insert(0) += 1;
                    }
                    for d in &ev.duration {
                        total_duration += d;
                        total_events += 1;
                    }
                }

                let avg_duration_secs = if total_events > 0 {
                    total_duration / total_events as f64
                } else {
                    0.0
                };

                let mut trial_types: Vec<String> = trial_type_set.into_iter().collect();
                trial_types.sort();

                designs.push(BidsTaskDesign {
                    task: task.clone(),
                    trial_types,
                    avg_duration_secs,
                    total_runs: events_list.len(),
                    events_per_type,
                });
            }
            designs.sort_by(|a, b| a.task.cmp(&b.task));
            designs
        };

        // --- Validation ---
        let validation: BidsValidationResult = {
            let checker = ComplianceChecker::new();
            match checker.check_project(&project) {
                Ok(result) => {
                    let mut all_issues: Vec<BidsValidationIssue> = Vec::new();
                    let mut critical_count = 0usize;
                    let mut warning_count = 0usize;

                    for issue in &result.issues {
                        let sev = match issue.severity {
                            bids_rs::compliance::Severity::Critical => "critical",
                            bids_rs::compliance::Severity::High => "high",
                            bids_rs::compliance::Severity::Medium => "medium",
                            bids_rs::compliance::Severity::Low => "low",
                        };
                        if matches!(
                            issue.severity,
                            bids_rs::compliance::Severity::Critical
                                | bids_rs::compliance::Severity::High
                        ) {
                            critical_count += 1;
                        }
                        all_issues.push(BidsValidationIssue {
                            severity: sev.to_string(),
                            description: issue.description.clone(),
                            file: issue.file.as_ref().map(|p| p.display().to_string()),
                            rule: issue.rule.clone(),
                        });
                    }
                    for w in &result.warnings {
                        warning_count += 1;
                        let sev = match w.severity {
                            bids_rs::compliance::Severity::Critical => "critical",
                            bids_rs::compliance::Severity::High => "high",
                            bids_rs::compliance::Severity::Medium => "medium",
                            bids_rs::compliance::Severity::Low => "low",
                        };
                        all_issues.push(BidsValidationIssue {
                            severity: sev.to_string(),
                            description: w.description.clone(),
                            file: w.file.as_ref().map(|p| p.display().to_string()),
                            rule: w.rule.clone(),
                        });
                    }

                    BidsValidationResult {
                        passed: result.passed,
                        critical_count,
                        warning_count,
                        issues: all_issues,
                    }
                }
                Err(e) => {
                    warn!("BIDS validation failed: {}", e);
                    BidsValidationResult {
                        passed: false,
                        critical_count: 1,
                        warning_count: 0,
                        issues: vec![BidsValidationIssue {
                            severity: "critical".to_string(),
                            description: format!("Validation error: {}", e),
                            file: None,
                            rule: "validation_error".to_string(),
                        }],
                    }
                }
            }
        };

        // --- Storage by modality ---
        let mut storage_by_modality: HashMap<String, u64> = HashMap::new();
        for f in &all_files {
            let modality = f.kind.as_deref().unwrap_or("other").to_string();
            let size = std::fs::metadata(&f.path).map(|m| m.len()).unwrap_or(0);
            *storage_by_modality.entry(modality).or_insert(0) += size;
        }

        Ok(BidsDatasetSummary {
            path: dataset_path_clone,
            name: ds_name,
            bids_version,
            license,
            authors,
            subject_count: proj_summary.n_participants,
            session_ids,
            task_ids,
            modalities,
            total_file_count: proj_summary.n_files,
            total_size_bytes: proj_summary.total_size.unwrap_or(0),
            coverage,
            participants,
            participant_columns,
            task_designs,
            validation,
            storage_by_modality,
        })
    })
    .await
    .map_err(|e| BridgeError::Internal {
        code: 3002,
        details: format!("Task join error: {}", e),
    })??;

    info!(
        "scan_bids_dataset complete: {} subjects",
        summary.subject_count
    );
    Ok(summary)
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.get_bids_events")]
async fn get_bids_events(
    dataset_path: String,
    subject: String,
    task: String,
    session: Option<String>,
    run: Option<String>,
    state: State<'_, BridgeState>,
) -> BridgeResult<Vec<bridge_types::bids::BidsEventRow>> {
    use bids_rs::BidsProject;
    use bridge_types::bids::BidsEventRow;

    info!(
        "Bridge: get_bids_events called for sub-{} task-{} in {}",
        subject, task, dataset_path
    );

    let dir = PathBuf::from(&dataset_path);
    materialize_remote_file_if_needed(state.inner(), &dir.join("dataset_description.json")).await?;

    let rows = tokio::task::spawn_blocking(move || -> BridgeResult<Vec<BidsEventRow>> {
        let project =
            BidsProject::with_options(&dataset_path, bids_rs::DerivativesMode::None, false)
                .map_err(|e| BridgeError::Input {
                    code: 3001,
                    details: format!("Failed to load BIDS dataset: {}", e),
                })?;

        // Search for event files matching subject + task
        let mut search = project
            .search_files()
            .subject(&subject)
            .task(&task)
            .suffix("events")
            .extension("tsv");
        if let Some(ref ses) = session {
            search = search.session(ses);
        }
        if let Some(ref r) = run {
            search = search.run(r);
        }

        let event_files = search.collect().unwrap_or_default();
        if event_files.is_empty() {
            info!("No events found for sub-{} task-{}", subject, task);
            return Ok(Vec::new());
        }

        let reader = bids_rs::io::EventsReader::new();
        let mut rows: Vec<BidsEventRow> = Vec::new();

        for file in &event_files {
            match bids_rs::io::BidsReader::read(&reader, file) {
                Ok(event_data) => {
                    // Convert parallel vectors into individual rows
                    let len = event_data.onset.len();
                    for i in 0..len {
                        let mut additional: HashMap<String, String> = HashMap::new();
                        for (col_name, col_values) in &event_data.additional_columns {
                            if let Some(val) = col_values.get(i) {
                                additional.insert(col_name.clone(), val.clone());
                            }
                        }
                        rows.push(BidsEventRow {
                            onset: event_data.onset.get(i).copied().unwrap_or(0.0),
                            duration: event_data.duration.get(i).copied().unwrap_or(0.0),
                            trial_type: event_data.trial_type.get(i).cloned().unwrap_or_default(),
                            additional,
                        });
                    }
                }
                Err(e) => {
                    warn!("Failed to read event file {:?}: {}", file.path, e);
                }
            }
        }

        Ok(rows)
    })
    .await
    .map_err(|e| BridgeError::Internal {
        code: 3002,
        details: format!("Task join error: {}", e),
    })??;

    info!("get_bids_events returning {} rows", rows.len());
    Ok(rows)
}

// --- Surface Template Commands ---

/// Load a surface template from TemplateFlow
#[command]
#[tracing::instrument(skip_all, err, name = "api.load_surface_template")]
async fn load_surface_template(
    request: bridge_types::SurfaceTemplateRequest,
    state: State<'_, BridgeState>,
) -> BridgeResult<bridge_types::SurfaceTemplateResult> {
    use neuroatlas::core::types::Hemisphere as NeuroatlasHemisphere;
    use neuroatlas::surface::templates::SurfaceDensity;
    use neurosurf_rs::geometry::SurfaceType;

    info!(
        "Bridge: load_surface_template called for {:?} {:?} {:?}",
        request.space, request.geometry_type, request.hemisphere
    );

    // Convert bridge types to neuroatlas types
    let density = match request.space {
        bridge_types::SurfaceSpace::Fsaverage => SurfaceDensity::Standard,
        bridge_types::SurfaceSpace::Fsaverage5 => SurfaceDensity::Low,
        bridge_types::SurfaceSpace::Fsaverage6 => SurfaceDensity::Medium,
        bridge_types::SurfaceSpace::Fsaverage7 => SurfaceDensity::High,
        bridge_types::SurfaceSpace::FsLR32k | bridge_types::SurfaceSpace::FsLR164k => {
            return Err(BridgeError::Internal {
                code: 7030,
                details: "fsLR templates not yet supported via this API".to_string(),
            });
        }
    };

    let hemisphere = match request.hemisphere {
        bridge_types::SurfaceHemisphere::Left => NeuroatlasHemisphere::Left,
        bridge_types::SurfaceHemisphere::Right => NeuroatlasHemisphere::Right,
    };

    let surface_type = match request.geometry_type {
        bridge_types::SurfaceGeometryType::White => SurfaceType::White,
        bridge_types::SurfaceGeometryType::Pial => SurfaceType::Pial,
        bridge_types::SurfaceGeometryType::Inflated => SurfaceType::Inflated,
        bridge_types::SurfaceGeometryType::Sphere => SurfaceType::Spherical,
        bridge_types::SurfaceGeometryType::VeryInflated => {
            return Err(BridgeError::Internal {
                code: 7031,
                details: "VeryInflated surface type not available in templateflow".to_string(),
            });
        }
        bridge_types::SurfaceGeometryType::Midthickness => {
            return Err(BridgeError::Internal {
                code: 7032,
                details: "Midthickness surface type not available in templateflow".to_string(),
            });
        }
    };

    // Load the surface via the global manager. `get_surface_template` locks the
    // manager for the (cached) download, so concurrent left/right loads
    // serialize safely instead of aliasing the shared cache.
    let surface =
        neuroatlas::surface::templates::get_surface_template(density, hemisphere, surface_type)
            .await
            .map_err(|e| BridgeError::Internal {
                code: 7033,
                // Template surfaces are downloaded from TemplateFlow on first use and
                // cached locally (~/.cache/templateflow); they are not bundled. Make
                // the failure actionable rather than a bare backend error (vol2surf M7).
                details: format!(
                    "Failed to load surface template: {e}. Template surfaces are downloaded \
                 from TemplateFlow on first use (network required) and cached locally; \
                 if this is the first load, check your internet connection."
                ),
            })?;

    let vertex_count = surface.vertex_count();
    let face_count = surface.face_count();

    // Generate a unique handle ID
    let handle_id = format!(
        "surface_template_{}_{}_{}",
        request.space.template_name(),
        request.geometry_type.as_suffix(),
        request.hemisphere.as_str()
    );

    // Clone the surface data and register it
    let surface_clone = surface.clone();

    // Create metadata for the surface
    let metadata = SurfaceMetadataInfo {
        name: format!(
            "{} {} ({})",
            request.space.display_name(),
            request.geometry_type.display_name(),
            match request.hemisphere {
                bridge_types::SurfaceHemisphere::Left => "Left",
                bridge_types::SurfaceHemisphere::Right => "Right",
            }
        ),
        path: format!(
            "templateflow://{}_{}_{}",
            request.space.template_name(),
            request.geometry_type.as_suffix(),
            request.hemisphere.as_str()
        ),
        hemisphere: Some(match request.hemisphere {
            bridge_types::SurfaceHemisphere::Left => "left".to_string(),
            bridge_types::SurfaceHemisphere::Right => "right".to_string(),
        }),
        surface_type: Some(request.geometry_type.as_suffix().to_string()),
        vertex_count,
        face_count,
    };

    // Register in surface registry
    let mut surface_registry = state.surface_registry.lock().await;
    surface_registry.insert_surface(
        handle_id.clone(),
        surface_clone,
        Affine3::identity(),
        metadata,
    );
    drop(surface_registry);

    info!(
        "Bridge: Surface template loaded - handle: {}, vertices: {}, faces: {}",
        handle_id, vertex_count, face_count
    );

    Ok(bridge_types::SurfaceTemplateResult {
        success: true,
        surface_handle: Some(handle_id),
        vertex_count: Some(vertex_count),
        face_count: Some(face_count),
        space: request.space.display_name().to_string(),
        geometry_type: request.geometry_type.display_name().to_string(),
        hemisphere: match request.hemisphere {
            bridge_types::SurfaceHemisphere::Left => "Left".to_string(),
            bridge_types::SurfaceHemisphere::Right => "Right".to_string(),
        },
        error_message: None,
    })
}

/// Get available surface template catalog
#[command]
#[tracing::instrument(skip_all, err, name = "api.get_surface_template_catalog")]
async fn get_surface_template_catalog(
) -> BridgeResult<Vec<bridge_types::SurfaceTemplateCatalogEntry>> {
    info!("Bridge: get_surface_template_catalog called");

    let mut entries = Vec::new();

    let spaces = [
        bridge_types::SurfaceSpace::Fsaverage,
        bridge_types::SurfaceSpace::Fsaverage5,
        bridge_types::SurfaceSpace::Fsaverage6,
    ];

    let geometry_types = [
        bridge_types::SurfaceGeometryType::White,
        bridge_types::SurfaceGeometryType::Pial,
        bridge_types::SurfaceGeometryType::Inflated,
        bridge_types::SurfaceGeometryType::Sphere,
    ];

    let hemispheres = [
        bridge_types::SurfaceHemisphere::Left,
        bridge_types::SurfaceHemisphere::Right,
    ];

    for space in &spaces {
        for geometry_type in &geometry_types {
            for hemisphere in &hemispheres {
                let id = format!(
                    "{}_{}_{}",
                    space.template_name(),
                    geometry_type.as_suffix(),
                    hemisphere.as_str()
                );

                let display_name = format!(
                    "{} {} ({})",
                    space.display_name(),
                    geometry_type.display_name(),
                    match hemisphere {
                        bridge_types::SurfaceHemisphere::Left => "Left",
                        bridge_types::SurfaceHemisphere::Right => "Right",
                    }
                );

                entries.push(bridge_types::SurfaceTemplateCatalogEntry {
                    id,
                    display_name,
                    space: *space,
                    geometry_type: *geometry_type,
                    hemisphere: *hemisphere,
                    vertex_count: space.vertex_count(),
                });
            }
        }
    }

    Ok(entries)
}

/// Parse a template menu ID into a TemplateConfig
fn parse_template_id(template_id: &str) -> BridgeResult<templates::TemplateConfig> {
    // Parse ID format: "MNI152NLin2009cAsym_T1w_1mm"
    let parts: Vec<&str> = template_id.split('_').collect();
    if parts.len() != 3 {
        return Err(BridgeError::Internal {
            code: 7009,
            details: format!("Invalid template ID format: {}", template_id),
        });
    }

    let space_str = parts[0];
    let type_str = parts[1];
    let resolution_str = parts[2];

    // Parse space
    let space = match space_str {
        "MNI152NLin2009cAsym" => templates::TemplateSpace::MNI152NLin2009cAsym,
        "MNI152NLin6Asym" => templates::TemplateSpace::MNI152NLin6Asym,
        "MNIColin27" => templates::TemplateSpace::MNIColin27,
        "MNI305" => templates::TemplateSpace::MNI305,
        "fsaverage" => templates::TemplateSpace::FSAverage,
        "fsaverage5" => templates::TemplateSpace::FSAverage5,
        "fsaverage6" => templates::TemplateSpace::FSAverage6,
        _ => {
            return Err(BridgeError::Internal {
                code: 7010,
                details: format!("Unknown template space: {}", space_str),
            });
        }
    };

    // Parse template type
    let template_type = match type_str {
        "T1w" => templates::TemplateType::T1w,
        "T2w" => templates::TemplateType::T2w,
        "FLAIR" => templates::TemplateType::Flair,
        "GM" => templates::TemplateType::GrayMatter,
        "WM" => templates::TemplateType::WhiteMatter,
        "CSF" => templates::TemplateType::Csf,
        "mask" => templates::TemplateType::BrainMask,
        "brain" => templates::TemplateType::Brain,
        _ => {
            return Err(BridgeError::Internal {
                code: 7011,
                details: format!("Unknown template type: {}", type_str),
            });
        }
    };

    // Parse resolution
    let resolution = match resolution_str {
        "1mm" => templates::TemplateResolution::MM1,
        "2mm" => templates::TemplateResolution::MM2,
        "native" => templates::TemplateResolution::Native,
        _ => {
            return Err(BridgeError::Internal {
                code: 7012,
                details: format!("Unknown template resolution: {}", resolution_str),
            });
        }
    };

    Ok(templates::TemplateConfig::new(
        template_type,
        space,
        resolution,
    ))
}

// --- Temporal Metric Command ---

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TemporalMetricResult {
    pub width: u32,
    pub height: u32,
    pub data: Vec<f32>,
}

fn sample_voxel_timeseries_from_4d<F>(
    dims: (usize, usize, usize, usize),
    x: usize,
    y: usize,
    z: usize,
    mut sample_at: F,
) -> BridgeResult<Vec<f32>>
where
    F: FnMut(usize) -> f32,
{
    if x >= dims.0 || y >= dims.1 || z >= dims.2 {
        return Err(BridgeError::Input {
            code: 2023,
            details: format!(
                "Voxel ({}, {}, {}) is out of bounds for shape [{}, {}, {}]",
                x, y, z, dims.0, dims.1, dims.2
            ),
        });
    }

    Ok((0..dims.3).map(&mut sample_at).collect())
}

fn sample_voxel_timeseries_from_volume(
    volume: &VolumeSendable,
    x: usize,
    y: usize,
    z: usize,
) -> BridgeResult<Vec<f32>> {
    match volume {
        VolumeSendable::Vec4DF32(vec) => {
            sample_voxel_timeseries_from_4d(vec.data.dim(), x, y, z, |t| vec.data[[x, y, z, t]])
        }
        VolumeSendable::Vec4DI16(vec) => {
            sample_voxel_timeseries_from_4d(vec.data.dim(), x, y, z, |t| {
                vec.data[[x, y, z, t]] as f32
            })
        }
        VolumeSendable::Vec4DU8(vec) => {
            sample_voxel_timeseries_from_4d(vec.data.dim(), x, y, z, |t| {
                vec.data[[x, y, z, t]] as f32
            })
        }
        VolumeSendable::Vec4DI8(vec) => {
            sample_voxel_timeseries_from_4d(vec.data.dim(), x, y, z, |t| {
                vec.data[[x, y, z, t]] as f32
            })
        }
        VolumeSendable::Vec4DU16(vec) => {
            sample_voxel_timeseries_from_4d(vec.data.dim(), x, y, z, |t| {
                vec.data[[x, y, z, t]] as f32
            })
        }
        VolumeSendable::Vec4DI32(vec) => {
            sample_voxel_timeseries_from_4d(vec.data.dim(), x, y, z, |t| {
                vec.data[[x, y, z, t]] as f32
            })
        }
        VolumeSendable::Vec4DU32(vec) => {
            sample_voxel_timeseries_from_4d(vec.data.dim(), x, y, z, |t| {
                vec.data[[x, y, z, t]] as f32
            })
        }
        VolumeSendable::Vec4DF64(vec) => {
            sample_voxel_timeseries_from_4d(vec.data.dim(), x, y, z, |t| {
                vec.data[[x, y, z, t]] as f32
            })
        }
        _ => Err(BridgeError::Input {
            code: 2024,
            details: "sample_voxel_timeseries requires a 4D volume".to_string(),
        }),
    }
}

/// Number of values along the "stack" axis for a volume: number of timepoints
/// for 4D volumes, 1 for 3D volumes.
fn stack_length_for_volume(volume_data: &VolumeSendable) -> usize {
    match volume_data {
        VolumeSendable::Vec4DF32(vec) => vec.data.dim().3,
        VolumeSendable::Vec4DI16(vec) => vec.data.dim().3,
        VolumeSendable::Vec4DU8(vec) => vec.data.dim().3,
        VolumeSendable::Vec4DI8(vec) => vec.data.dim().3,
        VolumeSendable::Vec4DU16(vec) => vec.data.dim().3,
        VolumeSendable::Vec4DI32(vec) => vec.data.dim().3,
        VolumeSendable::Vec4DU32(vec) => vec.data.dim().3,
        VolumeSendable::Vec4DF64(vec) => vec.data.dim().3,
        // 3D volumes contribute a single stack value.
        _ => 1,
    }
}

/// Physical voxel spacing (mm) along the three spatial axes for a volume.
fn get_spacing_from_volume(volume_data: &VolumeSendable) -> [f32; 3] {
    let spacing: Vec<f64> = match volume_data {
        VolumeSendable::VolF32(vol, _) => vol.space().spacing.clone(),
        VolumeSendable::VolI16(vol, _) => vol.space().spacing.clone(),
        VolumeSendable::VolU8(vol, _) => vol.space().spacing.clone(),
        VolumeSendable::VolI8(vol, _) => vol.space().spacing.clone(),
        VolumeSendable::VolU16(vol, _) => vol.space().spacing.clone(),
        VolumeSendable::VolI32(vol, _) => vol.space().spacing.clone(),
        VolumeSendable::VolU32(vol, _) => vol.space().spacing.clone(),
        VolumeSendable::VolF64(vol, _) => vol.space().spacing.clone(),
        VolumeSendable::Vec4DF32(vec) => vec.space.spacing.clone(),
        VolumeSendable::Vec4DI16(vec) => vec.space.spacing.clone(),
        VolumeSendable::Vec4DU8(vec) => vec.space.spacing.clone(),
        VolumeSendable::Vec4DI8(vec) => vec.space.spacing.clone(),
        VolumeSendable::Vec4DU16(vec) => vec.space.spacing.clone(),
        VolumeSendable::Vec4DI32(vec) => vec.space.spacing.clone(),
        VolumeSendable::Vec4DU32(vec) => vec.space.spacing.clone(),
        VolumeSendable::Vec4DF64(vec) => vec.space.spacing.clone(),
    };

    let axis = |idx: usize| {
        let value = spacing.get(idx).copied().unwrap_or(1.0) as f32;
        // Guard against zero/non-finite spacing which would make the sphere
        // bounding-box computation degenerate.
        if value.is_finite() && value > 0.0 {
            value
        } else {
            1.0
        }
    };

    [axis(0), axis(1), axis(2)]
}

/// Read the full stack (all timepoints for 4D, a single value for 3D) at an
/// in-bounds voxel. Returns `None` if the voxel is out of bounds.
fn read_stack_at_voxel(
    volume_data: &VolumeSendable,
    x: usize,
    y: usize,
    z: usize,
) -> Option<Vec<f32>> {
    match volume_data {
        // 3D volumes -> single value per voxel.
        VolumeSendable::VolF32(vol, _) => vol.get_at_coords(&[x, y, z]).map(|v| vec![v]),
        VolumeSendable::VolF64(vol, _) => vol.get_at_coords(&[x, y, z]).map(|v| vec![v as f32]),
        VolumeSendable::VolI16(vol, _) => vol.get_at_coords(&[x, y, z]).map(|v| vec![v as f32]),
        VolumeSendable::VolI32(vol, _) => vol.get_at_coords(&[x, y, z]).map(|v| vec![v as f32]),
        VolumeSendable::VolU8(vol, _) => vol.get_at_coords(&[x, y, z]).map(|v| vec![v as f32]),
        VolumeSendable::VolU16(vol, _) => vol.get_at_coords(&[x, y, z]).map(|v| vec![v as f32]),
        VolumeSendable::VolI8(vol, _) => vol.get_at_coords(&[x, y, z]).map(|v| vec![v as f32]),
        VolumeSendable::VolU32(vol, _) => vol.get_at_coords(&[x, y, z]).map(|v| vec![v as f32]),
        // 4D volumes -> full timeseries via DenseNeuroVec::series.
        VolumeSendable::Vec4DF32(vec) => vec.series(x, y, z).map(|s| s.into_iter().collect()),
        VolumeSendable::Vec4DF64(vec) => vec
            .series(x, y, z)
            .map(|s| s.into_iter().map(|v| v as f32).collect()),
        VolumeSendable::Vec4DI16(vec) => vec
            .series(x, y, z)
            .map(|s| s.into_iter().map(|v| v as f32).collect()),
        VolumeSendable::Vec4DI32(vec) => vec
            .series(x, y, z)
            .map(|s| s.into_iter().map(|v| v as f32).collect()),
        VolumeSendable::Vec4DU8(vec) => vec
            .series(x, y, z)
            .map(|s| s.into_iter().map(|v| v as f32).collect()),
        VolumeSendable::Vec4DU16(vec) => vec
            .series(x, y, z)
            .map(|s| s.into_iter().map(|v| v as f32).collect()),
        VolumeSendable::Vec4DI8(vec) => vec
            .series(x, y, z)
            .map(|s| s.into_iter().map(|v| v as f32).collect()),
        VolumeSendable::Vec4DU32(vec) => vec
            .series(x, y, z)
            .map(|s| s.into_iter().map(|v| v as f32).collect()),
    }
}

/// Read one explicit frame without allocating the full temporal series.
fn read_member_frame_at_voxel(
    volume: &VolumeSendable,
    x: usize,
    y: usize,
    z: usize,
    frame: usize,
) -> Option<f32> {
    match volume {
        VolumeSendable::Vec4DF32(volume) => volume.data.get([x, y, z, frame]).copied(),
        VolumeSendable::Vec4DF64(volume) => {
            volume.data.get([x, y, z, frame]).map(|&value| value as f32)
        }
        VolumeSendable::Vec4DI16(volume) => {
            volume.data.get([x, y, z, frame]).map(|&value| value as f32)
        }
        VolumeSendable::Vec4DU16(volume) => {
            volume.data.get([x, y, z, frame]).map(|&value| value as f32)
        }
        VolumeSendable::Vec4DI32(volume) => {
            volume.data.get([x, y, z, frame]).map(|&value| value as f32)
        }
        VolumeSendable::Vec4DU32(volume) => {
            volume.data.get([x, y, z, frame]).map(|&value| value as f32)
        }
        VolumeSendable::Vec4DI8(volume) => {
            volume.data.get([x, y, z, frame]).map(|&value| value as f32)
        }
        VolumeSendable::Vec4DU8(volume) => {
            volume.data.get([x, y, z, frame]).map(|&value| value as f32)
        }
        _ if frame == 0 => read_stack_at_voxel(volume, x, y, z)?.first().copied(),
        _ => None,
    }
}

/// Collapse multiple values into one using the requested reduction operator.
/// Unrecognized operators fall back to "mean"; an empty slice yields 0.0.
fn reduce_values(vals: &[f32], op: &str) -> f32 {
    if vals.is_empty() {
        return 0.0;
    }
    match op {
        "sum" => vals.iter().map(|&value| value as f64).sum::<f64>() as f32,
        "min" => vals.iter().cloned().fold(f32::INFINITY, f32::min),
        "max" => vals.iter().cloned().fold(f32::NEG_INFINITY, f32::max),
        "median" => {
            let mut sorted = vals.to_vec();
            sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            let n = sorted.len();
            if n % 2 == 1 {
                sorted[n / 2]
            } else {
                ((sorted[n / 2 - 1] as f64 + sorted[n / 2] as f64) / 2.0) as f32
            }
        }
        // "mean" and any unrecognized operator.
        _ => (vals.iter().map(|&value| value as f64).sum::<f64>() / vals.len() as f64) as f32,
    }
}

/// Upper bound on the number of candidate voxels in the sphere bounding box
/// (the product of the per-axis `2*ceil(radius/spacing)+1` extents). A
/// programmatic caller passing a large radius against a fine-spacing volume
/// (e.g. 60 mm at 1 mm spacing, or 50 mm at 0.5 mm) could otherwise gather
/// ~10^5+ voxels and materialize a full timeseries per voxel, risking OOM.
/// 250_000 corresponds to roughly a 60 mm radius at 1 mm isotropic spacing.
const MAX_SPHERE_CANDIDATE_VOXELS: u64 = 250_000;

/// Gather the in-bounds voxel indices that make up the sampling locus around a
/// center voxel. For `radius_mm <= 0` this is the single rounded center voxel
/// (if in bounds). For `radius_mm > 0` it is every in-bounds voxel whose center
/// lies within `radius_mm` (physical distance, using `spacing`) of the requested
/// world point; the center voxel is always included when it is itself in bounds.
///
/// Returns `BridgeError::Input` when the sphere bounding box would exceed
/// [`MAX_SPHERE_CANDIDATE_VOXELS`] candidate voxels, rather than allocating.
fn gather_locus_voxels(
    center_voxel: [f32; 3],
    dims: &[usize],
    spacing: [f32; 3],
    radius_mm: f32,
) -> BridgeResult<Vec<(usize, usize, usize)>> {
    let dim_x = dims.first().copied().unwrap_or(0);
    let dim_y = dims.get(1).copied().unwrap_or(0);
    let dim_z = dims.get(2).copied().unwrap_or(0);

    let in_bounds = |x: f32, y: f32, z: f32| {
        x >= 0.0 && x < dim_x as f32 && y >= 0.0 && y < dim_y as f32 && z >= 0.0 && z < dim_z as f32
    };

    // Point sampling: nearest-neighbour center voxel only. Round FIRST, then
    // bounds-check the rounded index — checking the fractional coordinate would
    // accept e.g. `dim-0.4` (< dim) yet round to `dim` (out of range), silently
    // reading nothing. This matches the frontend resolveTimeseriesVoxel gate.
    if radius_mm <= 0.0 {
        let xi = center_voxel[0].round();
        let yi = center_voxel[1].round();
        let zi = center_voxel[2].round();
        if in_bounds(xi, yi, zi) {
            return Ok(vec![(xi as usize, yi as usize, zi as usize)]);
        }
        return Ok(Vec::new());
    }

    // Sphere sampling. Compute a voxel-index bounding box around the center
    // voxel with half-extent ceil(radius / spacing) per axis.
    let cx = center_voxel[0];
    let cy = center_voxel[1];
    let cz = center_voxel[2];

    let half_x = (radius_mm / spacing[0]).ceil() as i64;
    let half_y = (radius_mm / spacing[1]).ceil() as i64;
    let half_z = (radius_mm / spacing[2]).ceil() as i64;

    // Guard against pathological bounding boxes before allocating: the box has
    // (2*half+1) voxels per axis. Use saturating u64 math so huge radii cannot
    // overflow the count itself.
    let extent = |half: i64| (half.max(0) as u64).saturating_mul(2).saturating_add(1);
    let candidate_count = extent(half_x)
        .saturating_mul(extent(half_y))
        .saturating_mul(extent(half_z));
    if candidate_count > MAX_SPHERE_CANDIDATE_VOXELS {
        return Err(BridgeError::Input {
            code: 2018,
            details: format!(
                "radius_mm {} is too large for spacing {:?}: sphere bounding box would span {} candidate voxels (cap {}). Reduce radius_mm.",
                radius_mm, spacing, candidate_count, MAX_SPHERE_CANDIDATE_VOXELS
            ),
        });
    }

    let center_i = cx.round() as i64;
    let center_j = cy.round() as i64;
    let center_k = cz.round() as i64;

    let radius_sq = (radius_mm * radius_mm) as f64;
    let mut voxels = Vec::new();

    for i in (center_i - half_x)..=(center_i + half_x) {
        if i < 0 || i >= dim_x as i64 {
            continue;
        }
        for j in (center_j - half_y)..=(center_j + half_y) {
            if j < 0 || j >= dim_y as i64 {
                continue;
            }
            for k in (center_k - half_z)..=(center_k + half_z) {
                if k < 0 || k >= dim_z as i64 {
                    continue;
                }
                // Physical (world-space) squared distance from the requested
                // center, measured with the volume spacing.
                let dx = (i as f64 - cx as f64) * spacing[0] as f64;
                let dy = (j as f64 - cy as f64) * spacing[1] as f64;
                let dz = (k as f64 - cz as f64) * spacing[2] as f64;
                if dx * dx + dy * dy + dz * dz <= radius_sq {
                    voxels.push((i as usize, j as usize, k as usize));
                }
            }
        }
    }

    // Always include the center voxel when it is itself in bounds, even if the
    // sphere happened to gather none (e.g. extremely small radius).
    if voxels.is_empty() && in_bounds(cx, cy, cz) {
        voxels.push((
            center_i.max(0) as usize,
            center_j.max(0) as usize,
            center_k.max(0) as usize,
        ));
    }

    Ok(voxels)
}

/// Sample a spatial locus (point or sphere) for a UI layer and return a value
/// per "stack" index: one per timepoint for 4D volumes, a single value for 3D.
///
/// Generalizes `sample_voxel_timeseries`: multiple voxels inside the sphere are
/// collapsed per stack-index using `reduce` (mean/median/min/max/sum; mean is
/// the default for any unrecognized value).
async fn sample_stack_impl(
    layer_id: &str,
    world_mm: &[f32],
    radius_mm: f32,
    reduce: &str,
    state: &BridgeState,
) -> BridgeResult<Vec<f32>> {
    if world_mm.len() != 3 {
        return Err(BridgeError::Input {
            code: 2016,
            details: "world_mm must be [x, y, z] in mm".to_string(),
        });
    }

    // Resolve the UI layer id to its backing volume handle.
    let handle_id = {
        let map = state.layer_to_volume_map.lock().await;
        map.get(layer_id)
            .cloned()
            .ok_or_else(|| BridgeError::Input {
                code: 2017,
                details: format!(
                    "No volume handle mapped for layer '{}'. Ensure the layer is registered.",
                    layer_id
                ),
            })?
    };

    let registry = state.volume_registry.lock().await;
    let volume_data = registry
        .get(&handle_id)
        .ok_or_else(|| BridgeError::VolumeNotFound {
            code: 4001,
            details: format!("Volume handle {} not found", handle_id),
        })?;

    let stack_len = stack_length_for_volume(volume_data);

    // Transform the requested world point to (fractional) voxel coordinates.
    let world_to_voxel = get_affine_from_volume(volume_data)?.inverse();
    let world_point = nalgebra::Point3::new(world_mm[0], world_mm[1], world_mm[2]);
    let voxel_point = world_to_voxel.transform_point(&world_point);
    let center_voxel = [voxel_point.x, voxel_point.y, voxel_point.z];

    let dims = get_spatial_dims_from_volume(volume_data);
    let spacing = get_spacing_from_volume(volume_data);

    let voxels = gather_locus_voxels(center_voxel, &dims, spacing, radius_mm)?;

    // No in-bounds voxels -> zeros of the correct stack length.
    if voxels.is_empty() {
        return Ok(vec![0.0; stack_len]);
    }

    // Accumulate the stacks for every gathered voxel, then reduce per index.
    let mut stacks: Vec<Vec<f32>> = Vec::with_capacity(voxels.len());
    for (x, y, z) in voxels {
        if let Some(stack) = read_stack_at_voxel(volume_data, x, y, z) {
            stacks.push(stack);
        }
    }

    if stacks.is_empty() {
        return Ok(vec![0.0; stack_len]);
    }

    let mut result = Vec::with_capacity(stack_len);
    let mut scratch: Vec<f32> = Vec::with_capacity(stacks.len());
    for idx in 0..stack_len {
        scratch.clear();
        for stack in &stacks {
            if let Some(&v) = stack.get(idx) {
                scratch.push(v);
            }
        }
        result.push(reduce_values(&scratch, reduce));
    }

    Ok(result)
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.sample_stack")]
async fn sample_stack(
    layer_id: String,
    world_mm: Vec<f32>,
    radius_mm: f32,
    reduce: String,
    state: State<'_, BridgeState>,
) -> BridgeResult<Vec<f32>> {
    sample_stack_impl(&layer_id, &world_mm, radius_mm, &reduce, state.inner()).await
}

#[doc(hidden)]
pub async fn sample_stack_for_testing<C>(
    layer_id: &str,
    world_mm: &C,
    radius_mm: f32,
    reduce: &str,
    bridge_state: &BridgeState,
) -> BridgeResult<Vec<f32>>
where
    C: AsRef<[f32]> + ?Sized,
{
    sample_stack_impl(layer_id, world_mm.as_ref(), radius_mm, reduce, bridge_state).await
}

/// One row of region statistics: a reduced scalar value over all voxels that
/// fall inside a single atlas parcellation label.
///
/// Serde-only (typed inline on the frontend, like `TemporalMetricResult`); the
/// JSON shape is `{ labelId, value, voxelCount }`.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionStat {
    pub label_id: u32,
    pub value: f32,
    pub voxel_count: u32,
}

/// Resolve a UI layer id to its backing `VolumeSendable` handle, returning the
/// canonical input/not-found errors used elsewhere in this module.
async fn resolve_layer_handle(layer_id: &str, state: &BridgeState) -> BridgeResult<String> {
    let map = state.layer_to_volume_map.lock().await;
    map.get(layer_id)
        .cloned()
        .ok_or_else(|| BridgeError::Input {
            code: 2017,
            details: format!(
                "No volume handle mapped for layer '{}'. Ensure the layer is registered.",
                layer_id
            ),
        })
}

/// Compute, for each atlas parcellation label, a reduced statistic of the
/// scalar map over the region covered by that label.
///
/// The atlas and scalar volumes need NOT share a grid: the atlas voxel grid is
/// iterated, each non-background atlas voxel is mapped to a world position via
/// the atlas affine, and that world position is transformed into the scalar
/// volume's voxel index (nearest neighbour, bounds-checked) to read the scalar
/// value. Background (label 0) and negative/non-finite labels are skipped, as
/// are atlas voxels whose world position lands outside the scalar volume.
///
/// Returns one `RegionStat` per non-zero label, sorted by `label_id` ascending.
async fn compute_region_stats_impl(
    scalar_layer_id: &str,
    atlas_layer_id: &str,
    reduce: &str,
    state: &BridgeState,
) -> BridgeResult<Vec<RegionStat>> {
    // Resolve both layers -> backing volume handles before touching the
    // registry, so a missing mapping reports the more specific Input error.
    let scalar_handle = resolve_layer_handle(scalar_layer_id, state).await?;
    let atlas_handle = resolve_layer_handle(atlas_layer_id, state).await?;

    let registry = state.volume_registry.lock().await;

    let atlas_volume = registry
        .get(&atlas_handle)
        .ok_or_else(|| BridgeError::VolumeNotFound {
            code: 4001,
            details: format!("Volume handle {} not found", atlas_handle),
        })?;
    let scalar_volume =
        registry
            .get(&scalar_handle)
            .ok_or_else(|| BridgeError::VolumeNotFound {
                code: 4001,
                details: format!("Volume handle {} not found", scalar_handle),
            })?;

    let atlas_affine = get_affine_from_volume(atlas_volume)?;
    let scalar_affine = get_affine_from_volume(scalar_volume)?;
    let scalar_world_to_voxel = scalar_affine.inverse();

    let atlas_dims = get_spatial_dims_from_volume(atlas_volume);
    let scalar_dims = get_spatial_dims_from_volume(scalar_volume);

    let atlas_dim_x = atlas_dims.first().copied().unwrap_or(0);
    let atlas_dim_y = atlas_dims.get(1).copied().unwrap_or(0);
    let atlas_dim_z = atlas_dims.get(2).copied().unwrap_or(0);

    let scalar_dim_x = scalar_dims.first().copied().unwrap_or(0);
    let scalar_dim_y = scalar_dims.get(1).copied().unwrap_or(0);
    let scalar_dim_z = scalar_dims.get(2).copied().unwrap_or(0);

    // For 4D scalar volumes, sample the currently-selected timepoint (matching
    // `sample_world_coordinate_impl`); 3D volumes report a single-element stack.
    let timepoint = registry.get_timepoint(&scalar_handle).unwrap_or(0);

    // Accumulate scalar values and voxel tallies keyed by atlas label id.
    let mut values_by_label: HashMap<u32, Vec<f32>> = HashMap::new();
    let mut counts_by_label: HashMap<u32, u32> = HashMap::new();

    for i in 0..atlas_dim_x {
        for j in 0..atlas_dim_y {
            for k in 0..atlas_dim_z {
                // Read the atlas label at this voxel (single value for 3D, or
                // the first stack entry for an atlas stored as 4D).
                let label_stack = match read_stack_at_voxel(atlas_volume, i, j, k) {
                    Some(stack) if !stack.is_empty() => stack,
                    _ => continue,
                };
                let label_value = label_stack[0];
                // Skip non-finite and negative labels.
                if !label_value.is_finite() || label_value < 0.0 {
                    continue;
                }
                let label_id = label_value.round() as u32;
                // Skip background.
                if label_id == 0 {
                    continue;
                }

                // Atlas voxel -> world position -> scalar voxel index.
                let world = atlas_affine
                    .transform_point(&nalgebra::Point3::new(i as f32, j as f32, k as f32));
                let scalar_voxel = scalar_world_to_voxel.transform_point(&world);
                let sx = scalar_voxel.x.round();
                let sy = scalar_voxel.y.round();
                let sz = scalar_voxel.z.round();

                // Bounds-check against the scalar grid; skip (don't count) when
                // the atlas voxel maps outside the scalar volume.
                if sx < 0.0
                    || sy < 0.0
                    || sz < 0.0
                    || sx >= scalar_dim_x as f32
                    || sy >= scalar_dim_y as f32
                    || sz >= scalar_dim_z as f32
                {
                    continue;
                }

                let scalar_stack =
                    match read_stack_at_voxel(scalar_volume, sx as usize, sy as usize, sz as usize)
                    {
                        Some(stack) if !stack.is_empty() => stack,
                        _ => continue,
                    };
                // Relies on the `!stack.is_empty()` guard above: len >= 1, so
                // `len() - 1` cannot underflow. Load-bearing invariant.
                let idx = timepoint.min(scalar_stack.len() - 1);
                let scalar_value = scalar_stack[idx];

                // Skip non-finite (NaN/Inf) scalars: NaN-masked background is
                // common in stat maps. Counting them would poison mean/sum to
                // NaN while min/max silently ignore them (f32::min(NaN,x)==x),
                // a cross-reducer inconsistency. Excluded from both the
                // accumulated values and the per-label voxel_count.
                if !scalar_value.is_finite() {
                    continue;
                }

                values_by_label
                    .entry(label_id)
                    .or_default()
                    .push(scalar_value);
                *counts_by_label.entry(label_id).or_insert(0) += 1;
            }
        }
    }

    let mut stats: Vec<RegionStat> = values_by_label
        .into_iter()
        .map(|(label_id, vals)| RegionStat {
            label_id,
            value: reduce_values(&vals, reduce),
            voxel_count: counts_by_label.get(&label_id).copied().unwrap_or(0),
        })
        .collect();

    // Stable, deterministic ordering: ascending by label id.
    stats.sort_by_key(|s| s.label_id);

    Ok(stats)
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.compute_region_stats")]
async fn compute_region_stats(
    scalar_layer_id: String,
    atlas_layer_id: String,
    reduce: String,
    state: State<'_, BridgeState>,
) -> BridgeResult<Vec<RegionStat>> {
    compute_region_stats_impl(&scalar_layer_id, &atlas_layer_id, &reduce, state.inner()).await
}

#[doc(hidden)]
pub async fn compute_region_stats_for_testing(
    scalar_layer_id: &str,
    atlas_layer_id: &str,
    reduce: &str,
    bridge_state: &BridgeState,
) -> BridgeResult<Vec<RegionStat>> {
    compute_region_stats_impl(scalar_layer_id, atlas_layer_id, reduce, bridge_state).await
}

/// Reference to one Set-Studio cohort member: a stable id plus the on-disk
/// (or `template:`-prefixed) source path of its volume.
///
/// Serde-only (typed inline on the frontend, like `RegionStat`); the JSON shape
/// is `{ memberId, sourcePath, displayLabel?, designValues? }`.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetMemberRef {
    pub member_id: String,
    pub source_path: String,
    /// A 4D source requires an explicit zero-based stack member. This index is
    /// not a physical time coordinate; temporal units belong to the dataset.
    #[serde(default)]
    pub stack_index: Option<usize>,
    /// Frozen queries may require the exact snapshot digest observed earlier.
    #[serde(default)]
    pub expected_sha256: Option<String>,
    /// Optional ontology-aware display label, e.g. `sub-01 faces`.
    #[serde(default)]
    pub display_label: Option<String>,
    /// Optional ontology axes for this member, carried through to trace frames.
    #[serde(default)]
    pub design_values: Vec<StudioDiscoveryDesignValue>,
}

/// One reduced scalar sampled from a cohort member at the requested world locus.
/// `value` is `f32::NAN` for members that failed to load or sampled out of
/// bounds. Serde-only (typed inline on the frontend); JSON shape is
/// `{ memberId, value }`.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberSample {
    pub member_id: String,
    pub value: f32,
    pub count: u32,
    pub source_revision: Option<set_sample_cache::SampleSourceRevision>,
    pub error: Option<String>,
}

/// Gather the finite ROI voxel values of a single (already-loaded) member volume
/// at `world_mm`, WITHOUT reducing them.
///
/// Pure / disk-free seam: transforms the world point into the member's voxel
/// grid, gathers the sampling locus (point for `radius_mm <= 0`, sphere
/// otherwise), reads the explicitly selected stack entry at each voxel and keeps the finite ones. Returns an
/// empty vector when the affine is unrecoverable, the locus errors (e.g. an
/// oversized sphere), the point is out of bounds, or no finite samples exist —
/// callers treat "no values" as a non-finite / skipped member rather than
/// aborting the whole cohort sample.
fn gather_member_roi_values(
    volume_data: &VolumeSendable,
    world_mm: &[f32],
    radius_mm: f32,
    stack_index: usize,
) -> Vec<f32> {
    // Transform the requested world point into (fractional) voxel coordinates.
    let affine = match get_affine_from_volume(volume_data) {
        Ok(affine) => affine,
        Err(_) => return Vec::new(),
    };
    let world_to_voxel = affine.inverse();
    let world_point = nalgebra::Point3::new(world_mm[0], world_mm[1], world_mm[2]);
    let voxel_point = world_to_voxel.transform_point(&world_point);
    let center_voxel = [voxel_point.x, voxel_point.y, voxel_point.z];

    let dims = get_spatial_dims_from_volume(volume_data);
    let spacing = get_spacing_from_volume(volume_data);

    let voxels = match gather_locus_voxels(center_voxel, &dims, spacing, radius_mm) {
        Ok(voxels) => voxels,
        Err(_) => return Vec::new(),
    };
    if voxels.is_empty() {
        return Vec::new();
    }

    // The caller validates the explicit frame before gathering spatial values.
    let mut vals: Vec<f32> = Vec::with_capacity(voxels.len());
    for (x, y, z) in voxels {
        if let Some(value) = read_member_frame_at_voxel(volume_data, x, y, z, stack_index) {
            if value.is_finite() {
                vals.push(value);
            }
        }
    }
    vals
}

/// Reduce a single (already-loaded) member volume to one scalar at `world_mm`.
///
/// Reduces with `reduce` (mean/median/min/max/sum, mean default). Returns
/// `f32::NAN` when the locus yields no finite samples or when the requested
/// point is out of bounds. See [`gather_member_roi_values`].
#[cfg(test)]
fn sample_member_volume(
    volume_data: &VolumeSendable,
    world_mm: &[f32],
    radius_mm: f32,
    reduce: &str,
) -> f32 {
    let vals = gather_member_roi_values(volume_data, world_mm, radius_mm, 0);
    if vals.is_empty() {
        return f32::NAN;
    }
    reduce_values(&vals, reduce)
}

/// Linearly-interpolated sample quantile (`q` in `[0, 1]`) of `vals`, matching
/// the common "type 7" definition (R's default, NumPy's `linear`). `vals` need
/// not be sorted; it is copied and sorted here. Returns `NAN` for an empty slice
/// and the single value for a one-element slice.
fn quantile_type7(vals: &[f32], q: f32) -> f32 {
    if vals.is_empty() {
        return f32::NAN;
    }
    if vals.len() == 1 {
        return vals[0];
    }
    let mut sorted = vals.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let q = q.clamp(0.0, 1.0);
    let h = (sorted.len() - 1) as f32 * q;
    let lo = h.floor() as usize;
    let hi = h.ceil() as usize;
    let frac = h - lo as f32;
    (sorted[lo] as f64 + (sorted[hi] as f64 - sorted[lo] as f64) * frac as f64) as f32
}

/// One member's cross-set trace point: the ROI-reduced value plus a lower/upper
/// spread band summarizing the dispersion of the ROI voxel values, for CI/error
/// ribbons in the cross-set trace plot.
///
/// Serde-only (typed inline on the frontend, like [`MemberSample`]); the JSON
/// shape is `{ memberId, value, lower, upper, count }`. `value`/`lower`/`upper`
/// are `f32::NAN` for members that failed to load or sampled out of bounds.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberTrace {
    pub member_id: String,
    /// Optional ontology-aware display label for axis ticks.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_label: Option<String>,
    /// Optional ontology axes copied from the request's member metadata.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub design_values: Vec<StudioDiscoveryDesignValue>,
    /// ROI-reduced center value (mean unless `reduce` overrides it).
    pub value: f32,
    /// Lower edge of the spread band (see `band`).
    pub lower: f32,
    /// Upper edge of the spread band.
    pub upper: f32,
    /// Number of finite ROI voxels the summary was computed from.
    pub count: u32,
    pub source_revision: Option<set_sample_cache::SampleSourceRevision>,
    pub error: Option<String>,
}

/// Compute a lower/upper spread band around `center` from ROI voxel `vals`.
///
/// `band` selects the interval kind (all clamped so `lower <= upper`):
/// - `"sem95"` (default): `center ± 1.96 * SD / sqrt(n)` — 95% CI of the mean.
/// - `"sd"`: `center ± SD` (one standard deviation).
/// - `"ci95"`: the 2.5% / 97.5% sample quantiles.
/// - `"iqr"`: the 25% / 75% sample quantiles.
/// - `"none"`: a degenerate band (`lower == upper == center`).
///
/// With fewer than two finite values the band collapses to `center`.
fn roi_spread_band(vals: &[f32], center: f32, band: &str) -> (f32, f32) {
    let n = vals.len();
    if n < 2 || !center.is_finite() {
        return (center, center);
    }
    match band {
        "none" => (center, center),
        "ci95" => (quantile_type7(vals, 0.025), quantile_type7(vals, 0.975)),
        "iqr" => (quantile_type7(vals, 0.25), quantile_type7(vals, 0.75)),
        "sd" | "sem95" => {
            let mean = vals.iter().map(|&value| value as f64).sum::<f64>() / n as f64;
            let var = vals
                .iter()
                .map(|&value| (value as f64 - mean).powi(2))
                .sum::<f64>()
                / (n as f64 - 1.0);
            let sd = var.max(0.0).sqrt();
            let half = if band == "sd" {
                sd
            } else {
                // sem95: 95% normal-approx CI half-width of the mean.
                1.96 * sd / (n as f64).sqrt()
            };
            ((center as f64 - half) as f32, (center as f64 + half) as f32)
        }
        _ => roi_spread_band(vals, center, "sem95"),
    }
}

/// Resolve a member `source_path` to an on-disk `PathBuf`. A `template:`-prefixed
/// id is resolved (and downloaded if necessary) through the template service;
/// any other value is treated as a real path used as-is.
async fn resolve_member_source_path(
    source_path: &str,
    state: &BridgeState,
) -> BridgeResult<PathBuf> {
    if let Some(template_id) = source_path.strip_prefix("template:") {
        // Mirror the load_template_by_id call sequence: parse -> load (ensures
        // the file is downloaded to the cache) -> resolve the cache path.
        let config = parse_template_id(template_id)?;
        let template_service = state.template_service.lock().await;
        template_service
            .load_template(config.clone())
            .await
            .map_err(|e| BridgeError::Internal {
                code: 7006,
                details: format!("Failed to load template '{}': {}", template_id, e),
            })?;
        let cache_path =
            template_service
                .get_cache_path(&config.id())
                .map_err(|e| BridgeError::Internal {
                    code: 7007,
                    details: format!(
                        "Failed to get template cache path for '{}': {}",
                        template_id, e
                    ),
                })?;
        drop(template_service);
        Ok(cache_path)
    } else {
        Ok(PathBuf::from(source_path))
    }
}

/// Resolve and sample a single immutable decoded snapshot on a blocking worker.
async fn sample_member_source(
    member: &SetMemberRef,
    path: PathBuf,
    world_mm: &[f32],
    radius_mm: f32,
    state: &BridgeState,
    cancellation: &SampleCancellation,
) -> BridgeResult<(Vec<f32>, set_sample_cache::SampleSourceRevision)> {
    cancellation.check()?;
    let world = world_mm.to_vec();
    let stack_index = member.stack_index;
    let expected = member.expected_sha256.clone();
    state.set_sample_cache.with_volume_cancelable(path, cancellation.clone(), move |volume, revision| {
        if expected.as_ref().is_some_and(|hash| hash != &revision.sha256) {
            return Err(BridgeError::Input { code: 2025, details: "Population source revision changed; recompute or restore the frozen source.".into() });
        }
        let frames = stack_length_for_volume(volume);
        if frames > 1 && stack_index.is_none() {
            return Err(BridgeError::Input { code: 2025, details: "A 4D population source requires an explicit stackIndex; frame zero is not assumed.".into() });
        }
        let frame = stack_index.unwrap_or(0);
        if frame >= frames {
            return Err(BridgeError::Input { code: 2025, details: format!("stackIndex {frame} is outside the source's {frames} frames.") });
        }
        Ok((gather_member_roi_values(volume, &world, radius_mm, frame), revision.clone()))
    }).await
}

fn validate_set_sample_request(
    members: &[SetMemberRef],
    world_mm: &[f32],
    radius_mm: f32,
    reduce: &str,
) -> BridgeResult<()> {
    if world_mm.len() != 3
        || !world_mm.iter().all(|value| value.is_finite())
        || !radius_mm.is_finite()
        || radius_mm < 0.0
        || !matches!(reduce, "mean" | "median" | "min" | "max" | "sum")
    {
        return Err(BridgeError::Input { code: 2016, details: "Population sampling requires finite [x, y, z] mm, a nonnegative radius and a supported reducer.".into() });
    }
    let mut ids = HashSet::new();
    if members
        .iter()
        .any(|member| member.member_id.trim().is_empty() || !ids.insert(&member.member_id))
    {
        return Err(BridgeError::Input {
            code: 2016,
            details: "Population sampling requires unique, nonempty observation IDs.".into(),
        });
    }
    Ok(())
}

/// Sample every cohort member at one world locus, returning one reduced scalar
/// per member in input order. A member that fails to load OR samples
/// out-of-bounds yields `f32::NAN` (logged) rather than failing the whole call.
async fn sample_set_at_world_impl(
    members: &[SetMemberRef],
    world_mm: &[f32],
    radius_mm: f32,
    reduce: &str,
    state: &BridgeState,
    cancellation: &SampleCancellation,
) -> BridgeResult<Vec<MemberSample>> {
    let traces = sample_set_trace_at_world_impl(
        members,
        world_mm,
        radius_mm,
        reduce,
        "none",
        state,
        cancellation,
    )
    .await?;
    Ok(traces
        .into_iter()
        .map(|trace| MemberSample {
            member_id: trace.member_id,
            value: trace.value,
            count: trace.count,
            source_revision: trace.source_revision,
            error: trace.error,
        })
        .collect())
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.sample_set_at_world")]
async fn sample_set_at_world(
    members: Vec<SetMemberRef>,
    world_mm: Vec<f32>,
    radius_mm: f32,
    reduce: String,
    ticket: Option<SampleTicket>,
    state: State<'_, BridgeState>,
) -> BridgeResult<Vec<MemberSample>> {
    let cancellation = ticket
        .as_ref()
        .map(|ticket| state.population_sampling.begin(ticket))
        .transpose()?
        .unwrap_or_default();
    sample_set_at_world_impl(
        &members,
        &world_mm,
        radius_mm,
        &reduce,
        state.inner(),
        &cancellation,
    )
    .await
}

#[doc(hidden)]
pub async fn sample_set_at_world_for_testing(
    members: &[SetMemberRef],
    world_mm: &[f32],
    radius_mm: f32,
    reduce: &str,
    bridge_state: &BridgeState,
) -> BridgeResult<Vec<MemberSample>> {
    sample_set_at_world_impl(
        members,
        world_mm,
        radius_mm,
        reduce,
        bridge_state,
        &SampleCancellation::default(),
    )
    .await
}

/// Sample every cohort member at one world locus and return, per member, an
/// ROI-reduced value plus a dispersion band (for CI/error ribbons in the
/// cross-set trace plot). This is the trace counterpart of
/// [`sample_set_at_world_impl`]: same per-member load + locus gather, but it
/// keeps the ROI voxel distribution to summarize spread instead of collapsing to
/// a single scalar. A member that fails to load OR samples out-of-bounds yields
/// a `NaN` trace point with `count = 0` (logged) rather than failing the call.
async fn sample_set_trace_at_world_impl(
    members: &[SetMemberRef],
    world_mm: &[f32],
    radius_mm: f32,
    reduce: &str,
    band: &str,
    state: &BridgeState,
    cancellation: &SampleCancellation,
) -> BridgeResult<Vec<MemberTrace>> {
    validate_set_sample_request(members, world_mm, radius_mm, reduce)?;
    if !matches!(band, "none" | "sd" | "sem95" | "ci95" | "iqr") {
        return Err(BridgeError::Input {
            code: 2016,
            details: "Unknown spatial dispersion band.".into(),
        });
    }
    // Resolve sources first so a single query cannot mix observable revisions
    // changed during its member-by-member reduction. Missing sources still have
    // per-member status; a changing source invalidates the complete result.
    let mut paths = Vec::with_capacity(members.len());
    for member in members {
        cancellation.check()?;
        paths.push(
            resolve_member_source_path(&member.source_path, state)
                .await
                .map_err(|error| error.to_string()),
        );
    }
    let guard = set_sample_cache::QuerySourceGuard::capture(
        paths
            .iter()
            .filter_map(|path| path.as_ref().ok().cloned())
            .collect(),
        cancellation.clone(),
    )
    .await?;
    let mut traces = Vec::with_capacity(members.len());
    for (member, path) in members.iter().zip(paths) {
        cancellation.check()?;
        let result = match path {
            Ok(path) => {
                sample_member_source(member, path, world_mm, radius_mm, state, cancellation)
                    .await
                    .map_err(|error| error.to_string())
            }
            Err(error) => Err(error),
        };
        let (vals, source_revision, error) = match result {
            Ok((vals, revision)) => (vals, Some(revision), None),
            Err(error) => (Vec::new(), None, Some(error)),
        };
        cancellation.check()?;
        let error = error.or_else(|| {
            vals.is_empty()
                .then(|| "No finite measurements at this spatial probe.".to_string())
        });
        let value = if vals.is_empty() {
            f32::NAN
        } else {
            reduce_values(&vals, reduce)
        };
        let (lower, upper) = roi_spread_band(&vals, value, band);
        traces.push(MemberTrace {
            member_id: member.member_id.clone(),
            display_label: member.display_label.clone(),
            design_values: member.design_values.clone(),
            value,
            lower,
            upper,
            count: vals.len() as u32,
            source_revision,
            error,
        });
    }
    guard.validate(cancellation.clone()).await?;
    cancellation.check()?;
    Ok(traces)
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.sample_set_trace_at_world")]
async fn sample_set_trace_at_world(
    members: Vec<SetMemberRef>,
    world_mm: Vec<f32>,
    radius_mm: f32,
    reduce: String,
    band: String,
    ticket: Option<SampleTicket>,
    state: State<'_, BridgeState>,
) -> BridgeResult<Vec<MemberTrace>> {
    let cancellation = ticket
        .as_ref()
        .map(|ticket| state.population_sampling.begin(ticket))
        .transpose()?
        .unwrap_or_default();
    sample_set_trace_at_world_impl(
        &members,
        &world_mm,
        radius_mm,
        &reduce,
        &band,
        state.inner(),
        &cancellation,
    )
    .await
}

#[doc(hidden)]
pub async fn sample_set_trace_at_world_for_testing(
    members: &[SetMemberRef],
    world_mm: &[f32],
    radius_mm: f32,
    reduce: &str,
    band: &str,
    bridge_state: &BridgeState,
) -> BridgeResult<Vec<MemberTrace>> {
    sample_set_trace_at_world_impl(
        members,
        world_mm,
        radius_mm,
        reduce,
        band,
        bridge_state,
        &SampleCancellation::default(),
    )
    .await
}

/// Cancellation is idempotent and may arrive before its matching sample call.
#[command]
async fn cancel_population_sample(
    ticket: SampleTicket,
    state: State<'_, BridgeState>,
) -> BridgeResult<()> {
    state.population_sampling.cancel(&ticket)
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.sample_voxel_timeseries")]
async fn sample_voxel_timeseries(
    volume_id: String,
    voxel_x: u32,
    voxel_y: u32,
    voxel_z: u32,
    state: State<'_, BridgeState>,
) -> BridgeResult<Vec<f32>> {
    info!(
        "sample_voxel_timeseries: volume={}, voxel=({}, {}, {})",
        volume_id, voxel_x, voxel_y, voxel_z
    );

    let registry = state.volume_registry.lock().await;
    let entry = registry
        .get_entry(&volume_id)
        .ok_or_else(|| BridgeError::VolumeNotFound {
            code: 4041,
            details: format!("Volume {} not found", volume_id),
        })?;

    let x = voxel_x as usize;
    let y = voxel_y as usize;
    let z = voxel_z as usize;

    sample_voxel_timeseries_from_volume(&entry.data, x, y, z)
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.compute_temporal_metric")]
async fn compute_temporal_metric(
    volume_id: String,
    metric: String,
    axis: String,
    slice_index: u32,
    state: State<'_, BridgeState>,
) -> BridgeResult<TemporalMetricResult> {
    info!(
        "compute_temporal_metric: volume={}, metric={}, axis={}, slice={}",
        volume_id, metric, axis, slice_index
    );
    let registry = state.volume_registry.lock().await;
    let entry = registry
        .get_entry(&volume_id)
        .ok_or_else(|| BridgeError::VolumeNotFound {
            code: 4041,
            details: format!("Volume {} not found", volume_id),
        })?;
    if metric != "variance" && metric != "mean" {
        return Err(BridgeError::Input {
            code: 2010,
            details: format!("Unknown metric '{}'. Supported: variance, mean", metric),
        });
    }
    match entry.data.as_ref() {
        VolumeSendable::Vec4DF32(vec) => {
            let d = vec.data.dim();
            let flat: Vec<f32> = vec.data.iter().copied().collect();
            compute_metric_slice_inner(
                &flat,
                d.0,
                d.1,
                d.2,
                d.3,
                &axis,
                slice_index as usize,
                &metric,
            )
        }
        VolumeSendable::Vec4DI16(vec) => {
            let d = vec.data.dim();
            let flat: Vec<f32> = vec.data.iter().map(|&v| v as f32).collect();
            compute_metric_slice_inner(
                &flat,
                d.0,
                d.1,
                d.2,
                d.3,
                &axis,
                slice_index as usize,
                &metric,
            )
        }
        VolumeSendable::Vec4DU8(vec) => {
            let d = vec.data.dim();
            let flat: Vec<f32> = vec.data.iter().map(|&v| v as f32).collect();
            compute_metric_slice_inner(
                &flat,
                d.0,
                d.1,
                d.2,
                d.3,
                &axis,
                slice_index as usize,
                &metric,
            )
        }
        VolumeSendable::Vec4DI8(vec) => {
            let d = vec.data.dim();
            let flat: Vec<f32> = vec.data.iter().map(|&v| v as f32).collect();
            compute_metric_slice_inner(
                &flat,
                d.0,
                d.1,
                d.2,
                d.3,
                &axis,
                slice_index as usize,
                &metric,
            )
        }
        VolumeSendable::Vec4DU16(vec) => {
            let d = vec.data.dim();
            let flat: Vec<f32> = vec.data.iter().map(|&v| v as f32).collect();
            compute_metric_slice_inner(
                &flat,
                d.0,
                d.1,
                d.2,
                d.3,
                &axis,
                slice_index as usize,
                &metric,
            )
        }
        VolumeSendable::Vec4DI32(vec) => {
            let d = vec.data.dim();
            let flat: Vec<f32> = vec.data.iter().map(|&v| v as f32).collect();
            compute_metric_slice_inner(
                &flat,
                d.0,
                d.1,
                d.2,
                d.3,
                &axis,
                slice_index as usize,
                &metric,
            )
        }
        VolumeSendable::Vec4DU32(vec) => {
            let d = vec.data.dim();
            let flat: Vec<f32> = vec.data.iter().map(|&v| v as f32).collect();
            compute_metric_slice_inner(
                &flat,
                d.0,
                d.1,
                d.2,
                d.3,
                &axis,
                slice_index as usize,
                &metric,
            )
        }
        VolumeSendable::Vec4DF64(vec) => {
            let d = vec.data.dim();
            let flat: Vec<f32> = vec.data.iter().map(|&v| v as f32).collect();
            compute_metric_slice_inner(
                &flat,
                d.0,
                d.1,
                d.2,
                d.3,
                &axis,
                slice_index as usize,
                &metric,
            )
        }
        _ => Err(BridgeError::Input {
            code: 2011,
            details: "compute_temporal_metric requires a 4D volume".to_string(),
        }),
    }
}

// Numeric kernel taking volume dims + window params positionally; struct adds no clarity.
#[allow(clippy::too_many_arguments)]
fn compute_metric_slice_inner(
    data: &[f32],
    nx: usize,
    ny: usize,
    nz: usize,
    nt: usize,
    axis: &str,
    slice_index: usize,
    metric: &str,
) -> BridgeResult<TemporalMetricResult> {
    let (width, height) = match axis {
        "axial" | "z" => {
            if slice_index >= nz {
                return Err(BridgeError::Input {
                    code: 2012,
                    details: format!("slice_index {} >= nz {}", slice_index, nz),
                });
            }
            (nx as u32, ny as u32)
        }
        "coronal" | "y" => {
            if slice_index >= ny {
                return Err(BridgeError::Input {
                    code: 2012,
                    details: format!("slice_index {} >= ny {}", slice_index, ny),
                });
            }
            (nx as u32, nz as u32)
        }
        "sagittal" | "x" => {
            if slice_index >= nx {
                return Err(BridgeError::Input {
                    code: 2012,
                    details: format!("slice_index {} >= nx {}", slice_index, nx),
                });
            }
            (ny as u32, nz as u32)
        }
        _ => {
            return Err(BridgeError::Input {
                code: 2013,
                details: format!("Unknown axis '{}'", axis),
            })
        }
    };
    let total = (width * height) as usize;
    let mut result = vec![0.0f32; total];
    let idx =
        |x: usize, y: usize, z: usize, t: usize| x * (ny * nz * nt) + y * (nz * nt) + z * nt + t;
    let compute_val = |vals: &[f32]| -> f32 {
        let n = vals.len() as f32;
        let mean = vals.iter().sum::<f32>() / n;
        if metric == "mean" {
            mean
        } else {
            vals.iter()
                .map(|&v| {
                    let d = v - mean;
                    d * d
                })
                .sum::<f32>()
                / n
        }
    };
    match axis {
        "axial" | "z" => {
            let z = slice_index;
            for x in 0..nx {
                for y in 0..ny {
                    let vals: Vec<f32> = (0..nt).map(|t| data[idx(x, y, z, t)]).collect();
                    result[x * ny + y] = compute_val(&vals);
                }
            }
        }
        "coronal" | "y" => {
            let y = slice_index;
            for x in 0..nx {
                for z in 0..nz {
                    let vals: Vec<f32> = (0..nt).map(|t| data[idx(x, y, z, t)]).collect();
                    result[x * nz + z] = compute_val(&vals);
                }
            }
        }
        _ => {
            let x = slice_index;
            for y in 0..ny {
                for z in 0..nz {
                    let vals: Vec<f32> = (0..nt).map(|t| data[idx(x, y, z, t)]).collect();
                    result[y * nz + z] = compute_val(&vals);
                }
            }
        }
    }
    Ok(TemporalMetricResult {
        width,
        height,
        data: result,
    })
}

// --- Command registry ---
// Expands (at the crate root) to `pub const COMMANDS: &[&str]` and
// `pub fn invoke_handler`. The command list lives in a single file that is also
// parsed by `build.rs`; see `command_registry.rs`.
include!("command_list.rs");

// --- Plugin Creation ---
pub fn create_plugin<R: Runtime>() -> TauriPlugin<R> {
    plugin()
}

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    Builder::<R>::new("api-bridge")
        .invoke_handler(invoke_handler())
        .setup(|app, _| {
            // Plugin setup runs before desktop setup. It is the sole default
            // owner; callers may also supply a state through Builder::manage.
            if app.try_state::<BridgeState>().is_none() {
                let bridge_state = BridgeState::with_cache_dir(app.path().app_cache_dir()?)
                    .map_err(std::io::Error::other)?;
                app.manage(bridge_state);
            }
            app.state::<BridgeState>().start_layer_watchdog();
            Ok(())
        })
        .build()
}

// --- Unit Tests ---
#[cfg(test)]
mod tests {
    use super::*;
    use bridge_types::{Loaded, StudioFolderOntologyPreviewRequest, StudioImportMode};
    use nalgebra::Affine3;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};
    use volmath::{DenseNeuroVec, DenseVolume3, NeuroSpace, NeuroSpace3};

    fn get_test_data_path() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..") // Go up to core/
            .join("..") // Go up to workspace root
            .join("test-data")
            .join("unit")
    }

    fn field_table_fixture_path(relative: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("field_table")
            .join("fixtures")
            .join("neurotabs")
            .join(relative)
    }

    fn make_temp_dir(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("api-bridge-{}-{}", label, unique));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    fn touch_placeholder_image(path: PathBuf) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create parent dir");
        }
        fs::write(path, []).expect("write placeholder image");
    }

    #[tokio::test]
    async fn set_studio_preview_command_wraps_field_table_fixture() {
        let manifest_path = field_table_fixture_path("roi-only/nftab.yaml");
        let candidates = preview_set_studio_imports_for_testing(
            StudioImportPreviewRequest {
                mode: StudioImportMode::Manifest,
                manifest_path: Some(manifest_path.to_string_lossy().to_string()),
                discovery_root: None,
                file_pattern: None,
                table_source_label: None,
                table_headers: None,
                table_rows: None,
                table_file_path_column: None,
                table_subject_id_column: None,
                table_excluded_columns: None,
                discovery_max_depth: None,
                discovery_max_files: None,
                discovery_include_patterns: None,
                discovery_exclude_patterns: None,
                discovery_required_roles: None,
                discovery_role_patterns: None,
                discovery_dry_run: None,
                discovery_sample_headers: None,
            },
            None,
        )
        .await
        .expect("preview command");

        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].set.id, "roi-only");
        assert_eq!(candidates[0].set.member_count, 8);
    }

    #[tokio::test]
    async fn set_studio_remote_preview_reports_inactive_cache_mount() {
        let state = BridgeState::default().expect("bridge state");
        let root = remote_cache_root()
            .expect("remote cache root")
            .join("stale-mount")
            .join("derivatives");
        let root_string = root.to_string_lossy().to_string();

        let candidates = preview_set_studio_imports_for_testing(
            StudioImportPreviewRequest {
                mode: StudioImportMode::Regex,
                manifest_path: None,
                discovery_root: Some(root_string.clone()),
                file_pattern: Some(
                    r"(?P<subject>\d{4})/maps/(?P<role>beta|tstat)\.nii(\.gz)?$".to_string(),
                ),
                table_source_label: None,
                table_headers: None,
                table_rows: None,
                table_file_path_column: None,
                table_subject_id_column: None,
                table_excluded_columns: None,
                discovery_max_depth: Some(3),
                discovery_max_files: Some(20),
                discovery_include_patterns: None,
                discovery_exclude_patterns: None,
                discovery_required_roles: None,
                discovery_role_patterns: None,
                discovery_dry_run: Some(true),
                discovery_sample_headers: Some(false),
            },
            Some(&state),
        )
        .await
        .expect("preview command");

        let candidate = &candidates[0];
        assert_eq!(candidate.set.member_count, 0);
        assert_eq!(
            candidate.set.ingest_audit.join.severity,
            bridge_types::StudioAuditSeverity::Error
        );
        let message = candidate.set.ingest_audit.join.issue_details[0]
            .message
            .clone();
        assert!(message.contains(&root_string));
        assert!(message.contains("stale-mount"));
        assert!(message.contains("Reconnect"));
    }

    #[tokio::test]
    async fn folder_ontology_preview_command_infers_maps_roles() {
        let root = make_temp_dir("folder-ontology");
        for subject in ["sub-01", "sub-02"] {
            for role in ["auc", "tstat"] {
                touch_placeholder_image(
                    root.join(subject)
                        .join("maps")
                        .join(format!("{}.nii.gz", role)),
                );
            }
        }

        let summary = preview_folder_ontology_for_testing(
            StudioFolderOntologyPreviewRequest {
                root: root.to_string_lossy().to_string(),
                max_depth: Some(3),
                max_files: Some(20),
                include_patterns: Vec::new(),
                exclude_patterns: Vec::new(),
            },
            None,
        )
        .await
        .expect("ontology preview command");

        assert_eq!(summary.neuroimaging_files, 4);
        let maps = summary
            .candidates
            .iter()
            .find(|candidate| candidate.id == "maps-basename-roles")
            .expect("maps basename candidate");
        assert_eq!(
            maps.observed_roles,
            vec!["auc".to_string(), "tstat".to_string()]
        );
        assert_eq!(maps.groups.len(), 2);
        assert!(maps.file_pattern.contains("(?P<subject>"));

        fs::remove_dir_all(root).expect("cleanup");
    }

    #[tokio::test]
    async fn folder_ontology_remote_preview_reports_inactive_cache_mount() {
        let state = BridgeState::default().expect("bridge state");
        let root = remote_cache_root()
            .expect("remote cache root")
            .join("stale-ontology-mount")
            .join("derivatives");
        let root_string = root.to_string_lossy().to_string();

        let summary = preview_folder_ontology_for_testing(
            StudioFolderOntologyPreviewRequest::new(root_string.clone()),
            Some(&state),
        )
        .await
        .expect("ontology preview command");

        assert!(!summary.root_exists);
        assert!(summary
            .warnings
            .iter()
            .any(|warning| warning.message.contains(&root_string)
                && warning.message.contains("stale-ontology-mount")
                && warning.message.contains("Reconnect")));
    }

    #[tokio::test]
    async fn set_studio_materialize_command_wraps_compare_pane_builder() {
        let panes =
            materialize_set_studio_compare_panes(bridge_types::StudioCompareMaterializeRequest {
                support_label: "MNI152 fixture grid".to_string(),
                compare_ready: false,
                force_rematerialize: false,
                active_member_id: Some("sub-01".to_string()),
                active_member_source_path: None,
                cohort_member_source_paths: Vec::new(),
                compare_cohort_id: None,
                compare_cohort_label: None,
                compare_cohort_member_count: None,
                active_expression_label: Some("Z-score".to_string()),
                active_expression_recipe: Some("zscore(current, cohort:all-members)".to_string()),
                reducer_specs: None,
                active_member_role_bindings: None,
                cohort_member_role_bindings: None,
            })
            .await
            .expect("materialize command");

        assert_eq!(panes.len(), 4);
        assert_eq!(panes[0].id, "current");
        assert_eq!(
            panes[1].status,
            bridge_types::StudioComparePaneStatus::Blocked
        );
        assert_eq!(
            panes[1]
                .binding
                .as_ref()
                .map(|binding| binding.cache_status.clone()),
            Some(bridge_types::StudioCompareCacheStatus::Unavailable)
        );
    }

    #[test]
    fn test_build_surface_overlay_handle_is_unique_for_same_surface_and_file() {
        let file_path = PathBuf::from("/tmp/atlas.label.gii");

        let first = build_surface_overlay_handle("surface-1", &file_path);
        let second = build_surface_overlay_handle("surface-1", &file_path);

        assert_ne!(first, second);
        assert!(first.starts_with("overlay_surface-1_atlas.label_"));
        assert!(second.starts_with("overlay_surface-1_atlas.label_"));
    }

    #[test]
    fn test_remove_data_for_surface_removes_all_overlay_handles_for_surface() {
        let mut registry = SurfaceRegistry::new();
        let first = build_surface_overlay_handle("surface-1", &PathBuf::from("/tmp/a.func.gii"));
        let second = build_surface_overlay_handle("surface-1", &PathBuf::from("/tmp/a.func.gii"));
        let other = build_surface_overlay_handle("surface-2", &PathBuf::from("/tmp/a.func.gii"));

        registry.insert_data(first.clone(), vec![1.0]);
        registry.insert_data(second.clone(), vec![2.0]);
        registry.insert_data(other.clone(), vec![3.0]);

        let removed = registry.remove_data_for_surface("surface-1");

        assert_eq!(removed, 2);
        assert!(!registry.contains_data(&first));
        assert!(!registry.contains_data(&second));
        assert!(registry.contains_data(&other));
    }

    #[test]
    fn test_load_file_integration() {
        // Create test state
        let _state = BridgeState::default().expect("bridge state");
        let test_file = get_test_data_path().join("toy_t1w.nii.gz");

        // Mock the State wrapper - this is a bit tricky since State is from Tauri
        // For unit testing, we'd need to refactor to make the functions testable
        // without Tauri's State wrapper

        // For now, let's test the core functionality directly
        assert!(core_loaders::is_loadable(&test_file));

        // Test that we can load the file
        let loaded_data = nifti_loader::NiftiLoader::load(&test_file).unwrap();
        match loaded_data {
            Loaded::Volume { dims, dtype, .. } => {
                assert_eq!(dims, [10, 10, 10]);
                assert_eq!(dtype, "f32");
            }
            _ => panic!("Expected Volume variant"),
        }

        // Test loading the actual volume data
        let (volume_sendable, _affine) = nifti_loader::load_nifti_volume_auto(&test_file).unwrap();

        // Verify we got the right type
        match volume_sendable {
            VolumeSendable::VolF32(vol, _) => {
                let dims = vol.space().dims();
                assert_eq!(dims, &[10, 10, 10]);
            }
            _ => panic!("Expected VolF32 variant"),
        }
    }

    #[test]
    fn test_volume_registry() {
        let state = BridgeState::default().expect("bridge state");

        // Test that registry starts empty
        let registry = state.volume_registry.try_lock().unwrap();
        assert_eq!(registry.volumes.len(), 0);
    }

    #[test]
    fn test_slice_axis_default() {
        assert_eq!(SliceAxis::default(), SliceAxis::Axial);
    }

    #[test]
    fn test_slice_index_default() {
        assert_eq!(SliceIndex::default(), SliceIndex::Middle);
    }

    #[test]
    fn test_calculate_slice_index_middle() {
        let dims = vec![100, 120, 80];
        let axis = SliceAxis::Axial;
        let slice_spec = SliceIndex::Middle;

        // Create a dummy volume for testing
        let space_impl = <NeuroSpace as volmath::NeuroSpaceExt>::from_dims_spacing_origin(
            vec![100, 120, 80],  // dims
            vec![1.0, 1.0, 1.0], // spacing
            vec![0.0, 0.0, 0.0], // origin
        )
        .expect("Failed to create NeuroSpace");
        let space = NeuroSpace3::new(space_impl);
        let data = vec![0.0f32; 100 * 120 * 80];
        let volume = DenseVolume3::<f32>::from_data(space.0, data);
        let affine = Affine3::<f32>::identity();
        let volume_data = VolumeSendable::VolF32(volume, affine);

        let result = calculate_slice_index(&slice_spec, &dims, axis, &volume_data).unwrap();
        assert_eq!(result, 40); // Middle of 80
    }

    #[test]
    fn test_calculate_slice_index_fixed() {
        let dims = vec![100, 120, 80];
        let axis = SliceAxis::Sagittal;
        let slice_spec = SliceIndex::Fixed(25);

        // Create a dummy volume for testing
        let space_impl = <NeuroSpace as volmath::NeuroSpaceExt>::from_dims_spacing_origin(
            vec![100, 120, 80],  // dims
            vec![1.0, 1.0, 1.0], // spacing
            vec![0.0, 0.0, 0.0], // origin
        )
        .expect("Failed to create NeuroSpace");
        let space = NeuroSpace3::new(space_impl);
        let data = vec![0.0f32; 100 * 120 * 80];
        let volume = DenseVolume3::<f32>::from_data(space.0, data);
        let affine = Affine3::<f32>::identity();
        let volume_data = VolumeSendable::VolF32(volume, affine);

        let result = calculate_slice_index(&slice_spec, &dims, axis, &volume_data).unwrap();
        assert_eq!(result, 25);
    }

    #[test]
    fn test_calculate_slice_index_relative() {
        let dims = vec![100, 120, 80];
        let axis = SliceAxis::Coronal;
        let slice_spec = SliceIndex::Relative(0.25); // 25% along the axis

        // Create a dummy volume for testing
        let space_impl = <NeuroSpace as volmath::NeuroSpaceExt>::from_dims_spacing_origin(
            vec![100, 120, 80],  // dims
            vec![1.0, 1.0, 1.0], // spacing
            vec![0.0, 0.0, 0.0], // origin
        )
        .expect("Failed to create NeuroSpace");
        let space = NeuroSpace3::new(space_impl);
        let data = vec![0.0f32; 100 * 120 * 80];
        let volume = DenseVolume3::<f32>::from_data(space.0, data);
        let affine = Affine3::<f32>::identity();
        let volume_data = VolumeSendable::VolF32(volume, affine);

        let result = calculate_slice_index(&slice_spec, &dims, axis, &volume_data).unwrap();
        assert_eq!(result, 29); // (120-1) * 0.25 = 29.75 -> 29
    }

    #[test]
    fn test_calculate_slice_index_out_of_bounds() {
        let dims = vec![100, 120, 80];
        let axis = SliceAxis::Axial;
        let slice_spec = SliceIndex::Fixed(80); // Out of bounds

        // Create a dummy volume for testing
        let space_impl = <NeuroSpace as volmath::NeuroSpaceExt>::from_dims_spacing_origin(
            vec![100, 120, 80],  // dims
            vec![1.0, 1.0, 1.0], // spacing
            vec![0.0, 0.0, 0.0], // origin
        )
        .expect("Failed to create NeuroSpace");
        let space = NeuroSpace3::new(space_impl);
        let data = vec![0.0f32; 100 * 120 * 80];
        let volume = DenseVolume3::<f32>::from_data(space.0, data);
        let affine = Affine3::<f32>::identity();
        let volume_data = VolumeSendable::VolF32(volume, affine);

        let result = calculate_slice_index(&slice_spec, &dims, axis, &volume_data);
        assert!(result.is_err());
        match result {
            Err(BridgeError::Input { code, .. }) => assert_eq!(code, 2003),
            _ => panic!("Expected Input error with code 2003"),
        }
    }

    #[test]
    fn test_calculate_slice_index_invalid_relative() {
        let dims = vec![100, 120, 80];
        let axis = SliceAxis::Axial;
        let slice_spec = SliceIndex::Relative(1.5); // Invalid relative position

        // Create a dummy volume for testing
        let space_impl = <NeuroSpace as volmath::NeuroSpaceExt>::from_dims_spacing_origin(
            vec![100, 120, 80],  // dims
            vec![1.0, 1.0, 1.0], // spacing
            vec![0.0, 0.0, 0.0], // origin
        )
        .expect("Failed to create NeuroSpace");
        let space = NeuroSpace3::new(space_impl);
        let data = vec![0.0f32; 100 * 120 * 80];
        let volume = DenseVolume3::<f32>::from_data(space.0, data);
        let affine = Affine3::<f32>::identity();
        let volume_data = VolumeSendable::VolF32(volume, affine);

        let result = calculate_slice_index(&slice_spec, &dims, axis, &volume_data);
        assert!(result.is_err());
        match result {
            Err(BridgeError::Input { code, .. }) => assert_eq!(code, 2004),
            _ => panic!("Expected Input error with code 2004"),
        }
    }

    #[test]
    fn test_layer_to_atlas_map() {
        let state = BridgeState::default().expect("bridge state");

        // Test that map starts empty
        let layer_map = state.layer_to_atlas_map.try_lock().unwrap();
        assert_eq!(layer_map.len(), 0);
        let timepoint_map = state.layer_to_timepoint_map.try_lock().unwrap();
        assert_eq!(timepoint_map.len(), 0);
    }

    #[test]
    fn validate_batch_viewport_sizes_rejects_mixed_dimensions() {
        let make_view = |viewport_size| {
            render_loop::view_state::ViewState::from_basic_params(
                "vol".to_string(),
                [0.0, 0.0, 0.0],
                render_loop::view_state::SliceOrientation::Axial,
                64.0,
                viewport_size,
                (0.0, 1.0),
            )
        };
        let views = vec![make_view([128, 128]), make_view([96, 128])];

        let err = validate_batch_viewport_sizes(&views, 128, 128)
            .expect_err("mixed viewport sizes must be rejected");
        match err {
            BridgeError::Input { code, details } => {
                assert_eq!(code, 7003);
                assert!(details.contains("Batch slice 1"));
            }
            other => panic!("expected Input(7003), got {other:?}"),
        }

        validate_batch_viewport_sizes(&views[..1], 128, 128)
            .expect("matching viewport should pass");
    }

    fn make_4d_volume_sendable() -> VolumeSendable {
        let dims = vec![8usize, 8, 8, 4];
        let spacing = vec![2.0, 2.0, 2.0, 1.0];
        let origin = vec![-8.0, -8.0, -8.0, 0.0];
        let space = NeuroSpace::new(dims.clone(), Some(spacing), Some(origin), None, None).unwrap();
        let vec4d = DenseNeuroVec::zeros(space).unwrap();
        VolumeSendable::Vec4DF32(vec4d)
    }

    fn make_4d_volume_sendable_with_timeseries() -> VolumeSendable {
        let dims = vec![4usize, 4, 4, 4];
        let spacing = vec![1.0, 1.0, 1.0, 1.0];
        let origin = vec![0.0, 0.0, 0.0, 0.0];
        let space = NeuroSpace::new(dims, Some(spacing), Some(origin), None, None).unwrap();
        let mut vec4d = DenseNeuroVec::zeros(space).unwrap();
        vec4d.data[[1, 2, 3, 0]] = 1.5;
        vec4d.data[[1, 2, 3, 1]] = 2.5;
        vec4d.data[[1, 2, 3, 2]] = 3.5;
        vec4d.data[[1, 2, 3, 3]] = 4.5;
        VolumeSendable::Vec4DF32(vec4d)
    }

    #[tokio::test]
    async fn layer_lease_ownership_and_teardown_reclaim_resident_textures() {
        for route in ["manual", "watchdog", "drop", "invalidate", "fallback"] {
            let state = BridgeState::default().unwrap();
            state.ensure_render_loop().await.unwrap();
            state.volume_registry.lock().await.insert(
                "volume".into(),
                make_4d_volume_sendable_with_timeseries(),
                volume_metadata_for("volume", "f32", bridge_types::VolumeType::TimeSeries4D),
            );
            let initial = request_layer_gpu_resources_for_testing(
                LayerSpec::Volume(VolumeLayerSpec {
                    id: "layer".into(),
                    source_resource_id: "volume".into(),
                    colormap: "gray".into(),
                    slice_axis: None,
                    slice_index: None,
                }),
                None,
                &state,
            )
            .await
            .unwrap();
            let service = state
                .render_loop_service
                .lock()
                .await
                .as_ref()
                .unwrap()
                .clone();
            let slot = {
                let mut renderer = service.lock().await;
                try_resident_swap(
                    "layer",
                    "volume",
                    initial.atlas_layer_index,
                    Some(0),
                    1,
                    &state,
                    &mut renderer,
                )
                .await
                .unwrap()
                .expect("resident swap")
            };

            // This is precisely the watchdog's snapshot-and-drop pattern.
            let snapshot = state
                .layer_leases
                .lock()
                .await
                .get("layer")
                .unwrap()
                .clone();
            let observed = Arc::downgrade(&snapshot.inner);
            drop(snapshot);
            tokio::task::yield_now().await;
            assert!(!observed
                .upgrade()
                .unwrap()
                .is_released
                .load(Ordering::SeqCst));
            assert!(state.layer_to_atlas_map.lock().await.contains_key("layer"));
            assert!(
                service
                    .lock()
                    .await
                    .multi_texture_manager
                    .as_ref()
                    .unwrap()
                    .resident_slot_count()
                    > 1
            );

            match route {
                "manual" => {
                    assert!(
                        release_layer_gpu_resources_internal("layer".into(), &state)
                            .await
                            .unwrap()
                            .success
                    );
                }
                "watchdog" => {
                    let lease = state.layer_leases.lock().await.remove("layer").unwrap();
                    lease.release("watchdog").await.unwrap();
                }
                "drop" => {
                    let lease = state.layer_leases.lock().await.remove("layer").unwrap();
                    drop(lease);
                }
                "invalidate" => {
                    let mut renderer = service.lock().await;
                    invalidate_cached_layer_for_render(
                        "layer",
                        slot,
                        &state,
                        &mut renderer,
                        "test",
                    )
                    .await
                    .unwrap();
                }
                "fallback" => {
                    // Model pre-lease cache state without scheduling its Drop cleanup.
                    let lease = state.layer_leases.lock().await.remove("layer").unwrap();
                    lease.inner.is_released.store(true, Ordering::SeqCst);
                    assert!(
                        release_layer_gpu_resources_internal("layer".into(), &state)
                            .await
                            .unwrap()
                            .success
                    );
                }
                _ => unreachable!(),
            }
            tokio::time::timeout(Duration::from_secs(5), async {
                loop {
                    if service
                        .lock()
                        .await
                        .multi_texture_manager
                        .as_ref()
                        .unwrap()
                        .resident_slot_count()
                        == 0
                    {
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
            })
            .await
            .unwrap_or_else(|_| panic!("{route} left resident textures"));
            assert!(state.resident_image_sets.lock().await.is_empty(), "{route}");
            assert!(state.layer_to_atlas_map.lock().await.is_empty(), "{route}");
            assert!(state.layer_to_volume_map.lock().await.is_empty(), "{route}");
            assert!(
                state.layer_to_timepoint_map.lock().await.is_empty(),
                "{route}"
            );
            let renderer = service.lock().await;
            assert_eq!(renderer.active_layer_count(), 0, "{route}");
            assert_eq!(
                renderer
                    .multi_texture_manager
                    .as_ref()
                    .unwrap()
                    .resident_bytes(),
                0,
                "{route}"
            );
        }
    }

    #[tokio::test]
    async fn resident_swap_repoints_imperative_render_layer_state() {
        let state = BridgeState::default().expect("bridge state");
        let source = make_4d_volume_sendable_with_timeseries();
        let member0 = extract_3d_volume_at_timepoint(&source, 0).expect("extract t0");

        register_volume_and_layer(
            &state,
            "layerSwap",
            "vol4d_swap",
            source,
            volume_metadata_for("vol4d_swap", "f32", bridge_types::VolumeType::TimeSeries4D),
        )
        .await;

        let mut service = RenderLoopService::new().await.expect("render-loop service");
        let (slot0, _) = match member0 {
            VolumeSendable::VolF32(ref vol, _) => service.upload_volume_3d(vol).expect("upload t0"),
            other => panic!("expected extracted f32 volume, got {other:?}"),
        };
        let range0 = service.get_volume_data_range(slot0).unwrap_or((0.0, 1.0));
        service
            .register_volume_with_range("vol4d_swap".to_string(), slot0, range0)
            .expect("register initial slot");
        service
            .add_layer_3d(slot0, nalgebra::Matrix4::identity(), (4, 4, 4), 1.0, 0, 1)
            .expect("add imperative render layer");
        {
            let mut layer_map = state.layer_to_atlas_map.lock().await;
            layer_map.insert("layerSwap".to_string(), slot0);
        }
        {
            let mut timepoint_map = state.layer_to_timepoint_map.lock().await;
            timepoint_map.insert("layerSwap".to_string(), Some(0));
        }

        let slot1 = try_resident_swap(
            "layerSwap",
            "vol4d_swap",
            slot0,
            Some(0),
            1,
            &state,
            &mut service,
        )
        .await
        .expect("resident swap")
        .expect("swap should use resident path");

        assert_ne!(slot0, slot1);
        assert!(
            !service.has_render_layer_for_atlas(slot0),
            "old slot must not remain in imperative layer state"
        );
        assert!(
            service.has_render_layer_for_atlas(slot1),
            "new slot must become the imperative layer atlas index"
        );
        assert!(
            !service
                .remove_layer_by_atlas(slot0)
                .expect("remove old slot"),
            "release by the stale slot should not find a layer"
        );
        assert!(
            service
                .remove_layer_by_atlas(slot1)
                .expect("remove new slot"),
            "release by the swapped slot should remove the layer"
        );
    }

    /// 4D volume with a realistic, non-identity affine: anisotropic spacing per
    /// axis plus an asymmetric origin (world = origin + spacing .* voxel). Voxel
    /// (1, 2, 3) carries the distinctive series 1.5/2.5/3.5/4.5, so its world
    /// position is (-10+2*1, 7+3*2, -4+1.5*3) = (-8, 13, 0.5).
    fn make_4d_volume_sendable_anisotropic() -> VolumeSendable {
        let dims = vec![4usize, 5, 6, 4];
        let spacing = vec![2.0, 3.0, 1.5, 1.0];
        let origin = vec![-10.0, 7.0, -4.0, 0.0];
        let space = NeuroSpace::new(dims, Some(spacing), Some(origin), None, None).unwrap();
        let mut vec4d = DenseNeuroVec::zeros(space).unwrap();
        vec4d.data[[1, 2, 3, 0]] = 1.5;
        vec4d.data[[1, 2, 3, 1]] = 2.5;
        vec4d.data[[1, 2, 3, 2]] = 3.5;
        vec4d.data[[1, 2, 3, 3]] = 4.5;
        VolumeSendable::Vec4DF32(vec4d)
    }

    #[test]
    fn coord_to_grid_for_4d_volume_with_time() {
        let sendable = make_4d_volume_sendable();
        let coords = vec![vec![-2.0, -2.0, -2.0, 3.0]];
        let grid = coord_to_grid_for_volume(&sendable, &coords).expect("grid conversion");
        assert_eq!(grid[0], vec![3, 3, 3, 3]);
    }

    #[test]
    fn get_affine_from_volume_preserves_4d_origin() {
        // Direct regression guard for affine_from_neurospace_trans: a 4D
        // NeuroSpace stores a 5x5 transform with the spatial origin in the LAST
        // column, so the voxel->world affine must carry that origin. Anisotropic
        // spacing [2,3,1.5] + origin [-10,7,-4] => voxel (1,2,3) is at world
        // (-8, 13, 0.5).
        let sendable = make_4d_volume_sendable_anisotropic();
        let voxel_to_world = get_affine_from_volume(&sendable).expect("affine");
        let world = voxel_to_world.transform_point(&nalgebra::Point3::new(1.0, 2.0, 3.0));
        assert!((world.x - (-8.0)).abs() < 1e-4, "x world {}", world.x);
        assert!((world.y - 13.0).abs() < 1e-4, "y world {}", world.y);
        assert!((world.z - 0.5).abs() < 1e-4, "z world {}", world.z);
    }

    #[test]
    fn coord_to_grid_for_4d_volume_defaults_time_dimension() {
        let sendable = make_4d_volume_sendable();
        let coords = vec![vec![-8.0, -8.0, -8.0]];
        let grid = coord_to_grid_for_volume(&sendable, &coords).expect("grid conversion");
        assert_eq!(grid[0], vec![0, 0, 0, 0]);
    }

    #[test]
    fn coord_to_grid_for_4d_volume_rejects_short_coordinates() {
        let sendable = make_4d_volume_sendable();
        let coords = vec![vec![0.0, 0.0]];
        let err = coord_to_grid_for_volume(&sendable, &coords).unwrap_err();
        assert!(
            err.contains("Coordinates must have 4 dimensions"),
            "unexpected error message: {err}"
        );
    }

    #[test]
    fn sample_voxel_timeseries_extracts_expected_4d_trace() {
        let sendable = make_4d_volume_sendable_with_timeseries();
        let values =
            sample_voxel_timeseries_from_volume(&sendable, 1, 2, 3).expect("timeseries sample");

        assert_eq!(values, vec![1.5, 2.5, 3.5, 4.5]);
    }

    #[test]
    fn sample_voxel_timeseries_rejects_3d_volume() {
        let space_impl = <NeuroSpace as volmath::NeuroSpaceExt>::from_dims_spacing_origin(
            vec![4, 4, 4],
            vec![1.0, 1.0, 1.0],
            vec![0.0, 0.0, 0.0],
        )
        .expect("Failed to create NeuroSpace");
        let space = NeuroSpace3::new(space_impl);
        let volume = DenseVolume3::<f32>::from_data(space.0, vec![0.0f32; 4 * 4 * 4]);
        let sendable = VolumeSendable::VolF32(volume, Affine3::<f32>::identity());

        let err = sample_voxel_timeseries_from_volume(&sendable, 1, 1, 1).unwrap_err();
        match err {
            BridgeError::Input { code, details } => {
                assert_eq!(code, 2024);
                assert!(details.contains("requires a 4D volume"));
            }
            other => panic!("expected 4D-volume input error, got {other:?}"),
        }
    }

    fn volume_metadata_for(
        name: &str,
        dtype: &str,
        volume_type: bridge_types::VolumeType,
    ) -> VolumeMetadataInfo {
        VolumeMetadataInfo {
            name: name.to_string(),
            path: name.to_string(),
            dtype: dtype.to_string(),
            volume_type,
            time_series_info: None,
        }
    }

    /// Register `volume` under `volume_id` and map `layer_id` -> `volume_id`.
    async fn register_volume_and_layer(
        state: &BridgeState,
        layer_id: &str,
        volume_id: &str,
        volume: VolumeSendable,
        metadata: VolumeMetadataInfo,
    ) {
        {
            let mut registry = state.volume_registry.lock().await;
            registry.insert(volume_id.to_string(), volume, metadata);
        }
        {
            let mut map = state.layer_to_volume_map.lock().await;
            map.insert(layer_id.to_string(), volume_id.to_string());
        }
    }

    #[tokio::test]
    async fn sample_stack_radius_zero_matches_direct_voxel_read_4d() {
        // dims [4,4,4,4], spacing [1,1,1], origin [0,0,0] => world == voxel.
        // Voxel (1, 2, 3) holds the series 1.5/2.5/3.5/4.5.
        let sendable = make_4d_volume_sendable_with_timeseries();
        let state = BridgeState::default().expect("bridge state");
        register_volume_and_layer(
            &state,
            "layerA",
            "vol4d",
            sendable,
            volume_metadata_for("vol4d", "f32", bridge_types::VolumeType::TimeSeries4D),
        )
        .await;

        // Point sample (radius 0) at world (1, 2, 3) => voxel (1, 2, 3).
        let values = sample_stack_for_testing("layerA", &[1.0_f32, 2.0, 3.0], 0.0, "mean", &state)
            .await
            .expect("sample_stack point");

        assert_eq!(values, vec![1.5, 2.5, 3.5, 4.5]);
    }

    #[tokio::test]
    async fn sample_stack_radius_zero_matches_direct_voxel_read_4d_nonidentity_affine() {
        // Regression guard for the crosshair->time-series voxel mapping under a
        // realistic, non-identity affine. sample_stack and the GPU render path
        // both derive world_to_voxel from get_affine_from_volume on the original
        // 4D volume, so a point sample at a voxel's world center must return that
        // voxel's exact series. Anisotropic spacing catches any axis/spacing mixup.
        let sendable = make_4d_volume_sendable_anisotropic();
        let state = BridgeState::default().expect("bridge state");
        register_volume_and_layer(
            &state,
            "layerAniso",
            "vol4d_aniso",
            sendable,
            volume_metadata_for("vol4d_aniso", "f32", bridge_types::VolumeType::TimeSeries4D),
        )
        .await;

        // Voxel (1, 2, 3) sits at world (-8, 13, 0.5); radius 0 => point sample.
        let values =
            sample_stack_for_testing("layerAniso", &[-8.0_f32, 13.0, 0.5], 0.0, "mean", &state)
                .await
                .expect("sample_stack point");

        assert_eq!(values, vec![1.5, 2.5, 3.5, 4.5]);
    }

    #[tokio::test]
    async fn get_volume_for_projection_extracts_requested_timepoint_4d() {
        // dims [4,4,4,4]; voxel (1,2,3) holds the series 1.5/2.5/3.5/4.5 across t.
        // Projection must return the 3D volume for the requested timepoint
        // (vol2surf M3); the per-timepoint peak uniquely identifies the slice.
        let state = BridgeState::default().expect("bridge state");
        register_volume_and_layer(
            &state,
            "layer4d",
            "vol4d_proj",
            make_4d_volume_sendable_with_timeseries(),
            volume_metadata_for("vol4d_proj", "f32", bridge_types::VolumeType::TimeSeries4D),
        )
        .await;

        // Default timepoint (None) -> t=0, peak 1.5; spatial dims are 3D.
        let t0 = get_volume_for_projection_impl("vol4d_proj", None, &state)
            .await
            .expect("projection t0");
        assert_eq!(t0.dims, [4, 4, 4]);
        assert_eq!(t0.volume_data.len(), 64);
        assert!(
            (t0.data_range.max - 1.5).abs() < 1e-4,
            "t0 max {}",
            t0.data_range.max
        );

        // Explicit timepoints select the matching 3D volume.
        let t2 = get_volume_for_projection_impl("vol4d_proj", Some(2), &state)
            .await
            .expect("projection t2");
        assert_eq!(t2.timepoint, Some(2));
        assert!(
            (t2.data_range.max - 3.5).abs() < 1e-4,
            "t2 max {}",
            t2.data_range.max
        );

        let t3 = get_volume_for_projection_impl("vol4d_proj", Some(3), &state)
            .await
            .expect("projection t3");
        assert!(
            (t3.data_range.max - 4.5).abs() < 1e-4,
            "t3 max {}",
            t3.data_range.max
        );
        // The extracted peak is present in the returned buffer.
        assert!(t3.volume_data.iter().any(|&v| (v - 4.5).abs() < 1e-4));
    }

    #[test]
    fn detect_coordinate_space_combines_codes_and_filename() {
        // NIfTI code 4 explicitly declares MNI152, regardless of filename.
        assert_eq!(detect_coordinate_space(4, 1, "/x/foo.nii"), "MNI");
        assert_eq!(detect_coordinate_space(1, 4, "/x/foo.nii"), "MNI");
        // Genuine MNI templates often ship with code 1 (see the bundled
        // MNI152NLin2009cAsym fixture); the filename / space-entity hint catches them.
        assert_eq!(
            detect_coordinate_space(1, 1, "/d/tpl-MNI152NLin2009cAsym_T1w.nii"),
            "MNI"
        );
        assert_eq!(
            detect_coordinate_space(0, 0, "/d/sub-01_space-ICBM152_bold.nii"),
            "MNI"
        );
        // Without an MNI hint, fall back to the code meaning.
        assert_eq!(
            detect_coordinate_space(1, 1, "/d/sub-01_T1w.nii"),
            "scanner"
        );
        assert_eq!(
            detect_coordinate_space(2, 0, "/d/sub-01_T1w.nii"),
            "aligned"
        );
        assert_eq!(
            detect_coordinate_space(3, 0, "/d/sub-01_T1w.nii"),
            "talairach"
        );
        // No code and no hint -> unknown (no false MNI positive).
        assert_eq!(detect_coordinate_space(0, 0, "<memory>"), "unknown");
    }

    #[test]
    fn build_volume3d_from_projection_preserves_layout_and_coords() {
        // 2x3x4 volume, value(x,y,z) = x + 10y + 100z; 2mm spacing + (10,20,30)mm.
        let (nx, ny, nz) = (2usize, 3, 4);
        let mut data = Vec::new();
        for z in 0..nz {
            for y in 0..ny {
                for x in 0..nx {
                    data.push((x + 10 * y + 100 * z) as f32);
                }
            }
        }
        #[rustfmt::skip]
        let affine_matrix = vec![
            2.0, 0.0, 0.0, 0.0,    // col 0
            0.0, 2.0, 0.0, 0.0,    // col 1
            0.0, 0.0, 2.0, 0.0,    // col 2
            10.0, 20.0, 30.0, 1.0, // col 3 (translation)
        ];
        let vol = VolumeProjectionData {
            volume_id: "v".into(),
            dims: [nx as u32, ny as u32, nz as u32],
            volume_data: data,
            affine_matrix,
            data_range: DataRange { min: 0.0, max: 0.0 },
            timepoint: None,
        };

        let v3d = build_volume3d_from_projection(&vol).expect("volume3d");
        assert_eq!(v3d.dims(), [nx, ny, nz]);
        // x-fastest brainflow buffer must map to data[[i,j,k]].
        for k in 0..nz {
            for j in 0..ny {
                for i in 0..nx {
                    let expected = (i + 10 * j + 100 * k) as f64;
                    assert_eq!(v3d.data[[i, j, k]], expected, "voxel {i},{j},{k}");
                }
            }
        }
        // Signed-diagonal spacing + translation origin reproduce the affine.
        let c = v3d.index_to_coord(1, 2, 3);
        assert!((c.x - 12.0).abs() < 1e-9);
        assert!((c.y - 24.0).abs() < 1e-9);
        assert!((c.z - 36.0).abs() < 1e-9);
    }

    #[test]
    fn vol2surf_param_and_coverage_helpers() {
        use neurosurf_rs::analysis::{MappingFunction, SamplingMode};

        assert!(matches!(
            parse_mapping_function(Some("nearest_neighbor")),
            MappingFunction::NearestNeighbor
        ));
        assert!(matches!(
            parse_mapping_function(Some("mode")),
            MappingFunction::Mode
        ));
        assert!(matches!(
            parse_mapping_function(None),
            MappingFunction::Average
        ));
        assert!(matches!(
            parse_sampling_mode(Some("thickness")),
            SamplingMode::Thickness
        ));
        assert!(matches!(
            parse_sampling_mode(Some("normal_line")),
            SamplingMode::NormalLine
        ));
        assert!(matches!(parse_sampling_mode(None), SamplingMode::Midpoint));

        let p = parse_vol_to_surf_params(&serde_json::json!({
            "mapping_function": "mode", "knn": 4, "sigma": 3.5, "fill": -1.0,
            "sampling_mode": "thickness", "n_samples": 5, "depth_fractions": [0.25, 0.5, 0.75]
        }));
        assert!(matches!(p.mapping_function, MappingFunction::Mode));
        assert_eq!(p.knn, 4);
        assert!((p.sigma - 3.5).abs() < 1e-9);
        assert!((p.fill + 1.0).abs() < 1e-9);
        assert!(matches!(p.sampling, SamplingMode::Thickness));
        assert_eq!(p.n_samples, Some(5));
        assert_eq!(p.depth, Some(vec![0.25, 0.5, 0.75]));

        // nearest/mode: fill excluded; average: every finite value counts.
        let vals = vec![1.0, 0.0, 3.0, f64::NAN];
        let (valid_nn, range_nn) = coverage_and_range(&vals, MappingFunction::NearestNeighbor, 0.0);
        assert_eq!(valid_nn, 2);
        let r = range_nn.expect("range");
        assert!((r.min - 1.0).abs() < 1e-6 && (r.max - 3.0).abs() < 1e-6);
        let (valid_avg, _) = coverage_and_range(&vals, MappingFunction::Average, 0.0);
        assert_eq!(valid_avg, 3);
    }

    /// Register a 3x3x3 volume (value = x + 10y + 100z + 1, identity affine) and a
    /// 3-vertex surface whose vertices sit exactly on voxel centers (0,0,0),
    /// (1,1,1), (2,2,2). Nearest-neighbor projection should therefore recover the
    /// voxel values 1, 112, 223.
    async fn register_surface_and_volume_for_projection(state: &BridgeState) {
        use neurosurf_rs::geometry::{Hemisphere, SurfaceGeometry, SurfaceType};

        let mut data = Vec::new();
        for z in 0..3 {
            for y in 0..3 {
                for x in 0..3 {
                    data.push((x as f32) + 10.0 * (y as f32) + 100.0 * (z as f32) + 1.0);
                }
            }
        }
        let space_impl = <NeuroSpace as volmath::NeuroSpaceExt>::from_dims_spacing_origin(
            vec![3, 3, 3],
            vec![1.0, 1.0, 1.0],
            vec![0.0, 0.0, 0.0],
        )
        .expect("space");
        let space = NeuroSpace3::new(space_impl);
        let volume = DenseVolume3::<f32>::from_data(space.0, data);
        let sendable = VolumeSendable::VolF32(volume, Affine3::<f32>::identity());
        state.volume_registry.lock().await.insert(
            "proj_vol".into(),
            sendable,
            volume_metadata_for("proj_vol", "f32", bridge_types::VolumeType::Volume3D),
        );

        let vertices = ndarray::Array2::from_shape_vec(
            (3, 3),
            vec![0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 2.0, 2.0, 2.0],
        )
        .expect("verts");
        let faces = ndarray::Array2::from_shape_vec((1, 3), vec![0usize, 1, 2]).expect("faces");
        let geom = SurfaceGeometry::new(vertices, faces, Hemisphere::Both, SurfaceType::Pial)
            .expect("geom");
        let meta = SurfaceMetadataInfo {
            name: "surf".into(),
            path: "<memory>".into(),
            hemisphere: Some("both".into()),
            surface_type: Some("pial".into()),
            vertex_count: 3,
            face_count: 1,
        };
        state.surface_registry.lock().await.insert_surface(
            "proj_surf".into(),
            geom,
            Affine3::<f32>::identity(),
            meta,
        );
    }

    #[tokio::test]
    async fn project_volume_to_surface_nearest_samples_voxel_values() {
        let state = BridgeState::default().expect("state");
        register_surface_and_volume_for_projection(&state).await;

        let params = serde_json::json!({ "mapping_function": "nearest_neighbor" });
        let res = project_volume_to_surface_impl(
            "proj_vol".into(),
            "proj_surf".into(),
            None,
            Some(params),
            None,
            &state,
        )
        .await
        .expect("project");

        assert_eq!(res.total_vertex_count, 3);
        assert_eq!(res.valid_vertex_count, 3);
        assert!((res.coverage_percent - 100.0).abs() < 1e-3);

        let vals = {
            let reg = state.surface_registry.lock().await;
            reg.get_data(&res.data_handle)
                .expect("stored overlay")
                .clone()
        };
        // Nearest voxel at each vertex's exact center.
        assert!((vals[0] - 1.0).abs() < 1e-3, "v0={}", vals[0]);
        assert!((vals[1] - 112.0).abs() < 1e-3, "v1={}", vals[1]);
        assert!((vals[2] - 223.0).abs() < 1e-3, "v2={}", vals[2]);
    }

    #[tokio::test]
    async fn repeated_surface_unload_reclaims_overlays_and_samplers() {
        let state = BridgeState::default().expect("state");
        for _ in 0..25 {
            register_surface_and_volume_for_projection(&state).await;
            let info = create_surface_sampler_impl(
                "proj_surf".into(),
                None,
                "proj_vol".into(),
                None,
                &state,
            )
            .await
            .unwrap();
            let overlay = apply_sampler_impl(
                info.sampler_handle.clone(),
                "proj_vol".into(),
                None,
                None,
                None,
                None,
                &state,
            )
            .await
            .unwrap();
            assert_eq!(state.surface_samplers.lock().await.len(), 1);
            unload_surface_impl("proj_surf", &state).await.unwrap();
            assert!(state.surface_samplers.lock().await.is_empty());
            let registry = state.surface_registry.lock().await;
            assert!(registry.get_surface("proj_surf").is_none());
            assert!(registry.get_data(&overlay.data_handle).is_none());
        }
    }

    #[tokio::test]
    async fn surface_sampler_create_apply_release_roundtrip() {
        let state = BridgeState::default().expect("state");
        register_surface_and_volume_for_projection(&state).await;

        let info = create_surface_sampler_impl(
            "proj_surf".into(),
            None,
            "proj_vol".into(),
            Some(serde_json::json!({})),
            &state,
        )
        .await
        .expect("create sampler");
        assert!(info.valid);
        assert_eq!(info.vertex_count, 3);
        assert_eq!(info.volume_dims, [3, 3, 3]);
        assert!(state
            .surface_samplers
            .lock()
            .await
            .contains_key(&info.sampler_handle));

        let res = apply_sampler_impl(
            info.sampler_handle.clone(),
            "proj_vol".into(),
            None,
            Some("nearest_neighbor".into()),
            Some(8.0),
            Some(0.0),
            &state,
        )
        .await
        .expect("apply sampler");
        assert_eq!(res.total_vertex_count, 3);
        let vals = {
            let reg = state.surface_registry.lock().await;
            reg.get_data(&res.data_handle)
                .expect("stored overlay")
                .clone()
        };
        assert!((vals[2] - 223.0).abs() < 1e-3, "v2={}", vals[2]);

        // Release frees the precomputed sampler.
        release_sampler_impl(info.sampler_handle.clone(), &state).await;
        assert!(!state
            .surface_samplers
            .lock()
            .await
            .contains_key(&info.sampler_handle));
    }

    #[tokio::test]
    async fn sample_stack_sphere_means_multiple_voxels_per_timepoint() {
        // dims [4,4,4,2], spacing [1,1,1], origin [0,0,0].
        let dims = vec![4usize, 4, 4, 2];
        let spacing = vec![1.0, 1.0, 1.0, 1.0];
        let origin = vec![0.0, 0.0, 0.0, 0.0];
        let space = NeuroSpace::new(dims, Some(spacing), Some(origin), None, None).unwrap();
        let mut vec4d = DenseNeuroVec::zeros(space).unwrap();
        // Center voxel (1,1,1) and its +x neighbour (2,1,1). Both lie within a
        // radius of 1.0 mm of world point (1.5, 1, 1); no other in-bounds voxel
        // does (the next nearest centers are 1.5 mm away or more).
        vec4d.data[[1, 1, 1, 0]] = 10.0;
        vec4d.data[[1, 1, 1, 1]] = 20.0;
        vec4d.data[[2, 1, 1, 0]] = 30.0;
        vec4d.data[[2, 1, 1, 1]] = 40.0;
        let sendable = VolumeSendable::Vec4DF32(vec4d);

        let state = BridgeState::default().expect("bridge state");
        register_volume_and_layer(
            &state,
            "layerB",
            "vol4d_sphere",
            sendable,
            volume_metadata_for(
                "vol4d_sphere",
                "f32",
                bridge_types::VolumeType::TimeSeries4D,
            ),
        )
        .await;

        // Sample world (1.5, 1, 1) with radius 1.0 mm => voxels (1,1,1) & (2,1,1)
        // (each exactly 0.5 mm from the point); reduce="mean" per timepoint.
        let values = sample_stack_for_testing("layerB", &[1.5_f32, 1.0, 1.0], 1.0, "mean", &state)
            .await
            .expect("sample_stack sphere");

        // t0: mean(10, 30) = 20; t1: mean(20, 40) = 30.
        assert_eq!(values.len(), 2);
        assert!((values[0] - 20.0).abs() < 1e-5, "t0 = {}", values[0]);
        assert!((values[1] - 30.0).abs() < 1e-5, "t1 = {}", values[1]);
    }

    #[tokio::test]
    async fn sample_stack_3d_returns_single_value() {
        // 3D volume: spacing [1,1,1], origin [0,0,0] => world == voxel.
        let space_impl = <NeuroSpace as volmath::NeuroSpaceExt>::from_dims_spacing_origin(
            vec![4, 4, 4],
            vec![1.0, 1.0, 1.0],
            vec![0.0, 0.0, 0.0],
        )
        .expect("Failed to create NeuroSpace");
        let space = NeuroSpace3::new(space_impl);
        let mut data = vec![0.0f32; 4 * 4 * 4];
        // Column-major linear index for voxel (2, 1, 0): x + y*4 + z*16 = 2 + 4 = 6.
        data[6] = 7.0;
        let volume = DenseVolume3::<f32>::from_data(space.0, data);
        // For 3D variants get_affine_from_volume returns the stored affine
        // directly; identity gives world == voxel for this unit-spacing volume.
        let sendable = VolumeSendable::VolF32(volume, Affine3::<f32>::identity());

        let state = BridgeState::default().expect("bridge state");
        register_volume_and_layer(
            &state,
            "layerC",
            "vol3d",
            sendable,
            volume_metadata_for("vol3d", "f32", bridge_types::VolumeType::Volume3D),
        )
        .await;

        let values = sample_stack_for_testing("layerC", &[2.0_f32, 1.0, 0.0], 0.0, "mean", &state)
            .await
            .expect("sample_stack 3d");

        assert_eq!(values, vec![7.0]);
    }

    #[tokio::test]
    async fn sample_stack_rejects_oversized_sphere_but_allows_under_cap() {
        // Tiny 4D volume (single voxel, spacing 1mm) so the sphere bounding-box
        // cap is exercised independently of the volume's own extent.
        let dims = vec![1usize, 1, 1, 2];
        let spacing = vec![1.0, 1.0, 1.0, 1.0];
        let origin = vec![0.0, 0.0, 0.0, 0.0];
        let space = NeuroSpace::new(dims, Some(spacing), Some(origin), None, None).unwrap();
        let mut vec4d = DenseNeuroVec::zeros(space).unwrap();
        vec4d.data[[0, 0, 0, 0]] = 5.0;
        vec4d.data[[0, 0, 0, 1]] = 6.0;
        let sendable = VolumeSendable::Vec4DF32(vec4d);

        let state = BridgeState::default().expect("bridge state");
        register_volume_and_layer(
            &state,
            "layerCap",
            "vol4d_cap",
            sendable,
            volume_metadata_for("vol4d_cap", "f32", bridge_types::VolumeType::TimeSeries4D),
        )
        .await;

        // radius 60mm @ 1mm spacing => (2*60+1)^3 = 1_771_561 candidate voxels,
        // well over the 250_000 cap => Input error, no allocation.
        let err = sample_stack_for_testing("layerCap", &[0.0_f32, 0.0, 0.0], 60.0, "mean", &state)
            .await
            .expect_err("over-cap sphere should be rejected");
        match err {
            BridgeError::Input { code, details } => {
                assert_eq!(code, 2018);
                assert!(details.contains("candidate voxels"), "details: {details}");
            }
            other => panic!("expected Input error for over-cap sphere, got {other:?}"),
        }

        // radius 30mm @ 1mm spacing => (2*30+1)^3 = 226_981 candidate voxels,
        // just under the cap => succeeds (only the lone in-bounds voxel matters).
        let values =
            sample_stack_for_testing("layerCap", &[0.0_f32, 0.0, 0.0], 30.0, "mean", &state)
                .await
                .expect("under-cap sphere should succeed");
        assert_eq!(values, vec![5.0, 6.0]);
    }

    #[test]
    fn gather_locus_voxels_point_rounds_then_bounds_checks() {
        let dims = [4usize, 4, 4];
        let spacing = [1.0f32; 3];
        // dim-0.6 (3.4) rounds to 3 (in range) -> included.
        assert_eq!(
            gather_locus_voxels([3.4, 0.0, 0.0], &dims, spacing, 0.0).unwrap(),
            vec![(3, 0, 0)],
        );
        // dim-0.4 (3.6) rounds to 4 (== dim, out of range) -> excluded. This is
        // the off-by-one the fractional bounds check used to admit.
        assert!(gather_locus_voxels([3.6, 0.0, 0.0], &dims, spacing, 0.0)
            .unwrap()
            .is_empty());
        // -0.4 rounds to 0 (in range) -> included.
        assert_eq!(
            gather_locus_voxels([-0.4, 1.0, 2.0], &dims, spacing, 0.0).unwrap(),
            vec![(0, 1, 2)],
        );
        // -0.6 rounds to -1 (out of range) -> excluded.
        assert!(gather_locus_voxels([-0.6, 1.0, 2.0], &dims, spacing, 0.0)
            .unwrap()
            .is_empty());
    }

    /// Build a 3D `u8` atlas (column-major / Fortran order: x fastest) with
    /// identity affine and unit spacing (world == voxel).
    fn make_u8_atlas(dims: [usize; 3], data: Vec<u8>) -> VolumeSendable {
        let space_impl = <NeuroSpace as volmath::NeuroSpaceExt>::from_dims_spacing_origin(
            dims.to_vec(),
            vec![1.0, 1.0, 1.0],
            vec![0.0, 0.0, 0.0],
        )
        .expect("Failed to create atlas NeuroSpace");
        let space = NeuroSpace3::new(space_impl);
        let volume = DenseVolume3::<u8>::from_data(space.0, data);
        VolumeSendable::VolU8(volume, Affine3::<f32>::identity())
    }

    /// Build a 3D `f32` scalar map with identity affine, unit spacing.
    fn make_f32_scalar(dims: [usize; 3], data: Vec<f32>) -> VolumeSendable {
        let space_impl = <NeuroSpace as volmath::NeuroSpaceExt>::from_dims_spacing_origin(
            dims.to_vec(),
            vec![1.0, 1.0, 1.0],
            vec![0.0, 0.0, 0.0],
        )
        .expect("Failed to create scalar NeuroSpace");
        let space = NeuroSpace3::new(space_impl);
        let volume = DenseVolume3::<f32>::from_data(space.0, data);
        VolumeSendable::VolF32(volume, Affine3::<f32>::identity())
    }

    #[tokio::test]
    async fn compute_region_stats_same_grid_mean() {
        // 2x2x2 atlas and scalar share the grid. Column-major linear index:
        // idx = x + y*2 + z*4. Lay out labels and matching scalar values.
        //
        //   voxel (x,y,z)  idx  label  scalar
        //   (0,0,0)         0     0     99.0   (background, excluded)
        //   (1,0,0)         1     1      2.0
        //   (0,1,0)         2     1      4.0
        //   (1,1,0)         3     2     10.0
        //   (0,0,1)         4     2     20.0
        //   (1,0,1)         5     2     30.0
        //   (0,1,1)         6     0     -7.0   (background, excluded)
        //   (1,1,1)         7     1      6.0
        let atlas = make_u8_atlas([2, 2, 2], vec![0, 1, 1, 2, 2, 2, 0, 1]);
        let scalar = make_f32_scalar([2, 2, 2], vec![99.0, 2.0, 4.0, 10.0, 20.0, 30.0, -7.0, 6.0]);

        let state = BridgeState::default().expect("bridge state");
        register_volume_and_layer(
            &state,
            "scalarLayer",
            "scalarVol",
            scalar,
            volume_metadata_for("scalarVol", "f32", bridge_types::VolumeType::Volume3D),
        )
        .await;
        register_volume_and_layer(
            &state,
            "atlasLayer",
            "atlasVol",
            atlas,
            volume_metadata_for("atlasVol", "u8", bridge_types::VolumeType::Volume3D),
        )
        .await;

        let stats = compute_region_stats_for_testing("scalarLayer", "atlasLayer", "mean", &state)
            .await
            .expect("region stats");

        // Label 0 excluded; results sorted by label_id ascending.
        assert_eq!(stats.len(), 2);
        assert_eq!(stats[0].label_id, 1);
        assert_eq!(stats[1].label_id, 2);

        // Label 1: scalars {2, 4, 6}, mean = 4.0, voxel_count = 3.
        assert_eq!(stats[0].voxel_count, 3);
        assert!(
            (stats[0].value - 4.0).abs() < 1e-5,
            "label1 mean = {}",
            stats[0].value
        );

        // Label 2: scalars {10, 20, 30}, mean = 20.0, voxel_count = 3.
        assert_eq!(stats[1].voxel_count, 3);
        assert!(
            (stats[1].value - 20.0).abs() < 1e-5,
            "label2 mean = {}",
            stats[1].value
        );
    }

    #[tokio::test]
    async fn compute_region_stats_skips_non_finite_scalar_voxels() {
        // A region containing one NaN scalar voxel plus finite voxels must
        // reduce over only the finite voxels, and voxel_count excludes the NaN.
        //
        //   idx  label  scalar
        //   0     1      2.0
        //   1     1      NaN   (skipped: not counted, not accumulated)
        //   2     1      4.0
        //   3     0      0.0   (background)
        let atlas = make_u8_atlas([2, 2, 1], vec![1, 1, 1, 0]);
        let scalar = make_f32_scalar([2, 2, 1], vec![2.0, f32::NAN, 4.0, 0.0]);

        let state = BridgeState::default().expect("bridge state");
        register_volume_and_layer(
            &state,
            "scalarLayer",
            "scalarVol",
            scalar,
            volume_metadata_for("scalarVol", "f32", bridge_types::VolumeType::Volume3D),
        )
        .await;
        register_volume_and_layer(
            &state,
            "atlasLayer",
            "atlasVol",
            atlas,
            volume_metadata_for("atlasVol", "u8", bridge_types::VolumeType::Volume3D),
        )
        .await;

        let stats = compute_region_stats_for_testing("scalarLayer", "atlasLayer", "mean", &state)
            .await
            .expect("region stats");

        assert_eq!(stats.len(), 1);
        assert_eq!(stats[0].label_id, 1);
        // NaN voxel excluded from count: 2 finite voxels, not 3.
        assert_eq!(stats[0].voxel_count, 2);
        // mean over {2.0, 4.0} == 3.0 (finite, not NaN-poisoned).
        assert!(
            stats[0].value.is_finite() && (stats[0].value - 3.0).abs() < 1e-5,
            "label1 mean = {}",
            stats[0].value
        );
    }

    #[tokio::test]
    async fn compute_region_stats_constant_region_and_unknown_reduce_defaults_to_mean() {
        // Each region holds a single constant scalar value, so mean == that
        // value regardless of voxel count. An unrecognized reduce op must fall
        // back to mean (same as `reduce_values`).
        //
        //   idx  label  scalar
        //   0     1      5.0
        //   1     1      5.0
        //   2     2      8.0
        //   3     0      0.0  (background)
        let atlas = make_u8_atlas([2, 2, 1], vec![1, 1, 2, 0]);
        let scalar = make_f32_scalar([2, 2, 1], vec![5.0, 5.0, 8.0, 0.0]);

        let state = BridgeState::default().expect("bridge state");
        register_volume_and_layer(
            &state,
            "scalarLayer",
            "scalarVol",
            scalar,
            volume_metadata_for("scalarVol", "f32", bridge_types::VolumeType::Volume3D),
        )
        .await;
        register_volume_and_layer(
            &state,
            "atlasLayer",
            "atlasVol",
            atlas,
            volume_metadata_for("atlasVol", "u8", bridge_types::VolumeType::Volume3D),
        )
        .await;

        // Unknown reduce -> mean fallback.
        let stats = compute_region_stats_for_testing(
            "scalarLayer",
            "atlasLayer",
            "totally-unknown-op",
            &state,
        )
        .await
        .expect("region stats");

        assert_eq!(stats.len(), 2);
        assert_eq!(stats[0].label_id, 1);
        assert_eq!(stats[0].voxel_count, 2);
        assert!(
            (stats[0].value - 5.0).abs() < 1e-5,
            "label1 = {}",
            stats[0].value
        );
        assert_eq!(stats[1].label_id, 2);
        assert_eq!(stats[1].voxel_count, 1);
        assert!(
            (stats[1].value - 8.0).abs() < 1e-5,
            "label2 = {}",
            stats[1].value
        );

        // "max" over a single-valued-per-region map equals that value too.
        let stats_max =
            compute_region_stats_for_testing("scalarLayer", "atlasLayer", "max", &state)
                .await
                .expect("region stats max");
        assert!((stats_max[0].value - 5.0).abs() < 1e-5);
        assert!((stats_max[1].value - 8.0).abs() < 1e-5);
    }

    #[tokio::test]
    async fn compute_region_stats_differing_grid_maps_world_to_scalar_voxel() {
        // Atlas: 2x2x2 with 2mm spacing, origin 0 => atlas voxel (i,j,k) maps to
        // world (2i, 2j, 2k). Scalar: 4x4x4 with 1mm spacing, origin 0 => world
        // (w) maps to scalar voxel (w) directly. So atlas voxel (i,j,k) reads
        // scalar voxel (2i, 2j, 2k).
        let atlas_space_impl = <NeuroSpace as volmath::NeuroSpaceExt>::from_dims_spacing_origin(
            vec![2, 2, 2],
            vec![2.0, 2.0, 2.0],
            vec![0.0, 0.0, 0.0],
        )
        .expect("atlas space");
        let atlas_space = NeuroSpace3::new(atlas_space_impl);
        // Label only the origin atlas voxel (0,0,0) with label 1; rest 0.
        let atlas_vol = DenseVolume3::<u8>::from_data(atlas_space.0, vec![1, 0, 0, 0, 0, 0, 0, 0]);
        let atlas = VolumeSendable::VolU8(atlas_vol, Affine3::<f32>::identity());

        // Scalar: 4x4x4, value 42.0 at voxel (0,0,0) (idx 0), everything else 0.
        // Atlas voxel (0,0,0) -> world (0,0,0) -> scalar voxel (0,0,0) -> 42.0.
        let mut scalar_data = vec![0.0f32; 4 * 4 * 4];
        scalar_data[0] = 42.0;
        let scalar = make_f32_scalar([4, 4, 4], scalar_data);

        let state = BridgeState::default().expect("bridge state");
        register_volume_and_layer(
            &state,
            "scalarLayer",
            "scalarVol",
            scalar,
            volume_metadata_for("scalarVol", "f32", bridge_types::VolumeType::Volume3D),
        )
        .await;
        register_volume_and_layer(
            &state,
            "atlasLayer",
            "atlasVol",
            atlas,
            volume_metadata_for("atlasVol", "u8", bridge_types::VolumeType::Volume3D),
        )
        .await;

        let stats = compute_region_stats_for_testing("scalarLayer", "atlasLayer", "mean", &state)
            .await
            .expect("region stats differing grid");

        assert_eq!(stats.len(), 1);
        assert_eq!(stats[0].label_id, 1);
        assert_eq!(stats[0].voxel_count, 1);
        assert!(
            (stats[0].value - 42.0).abs() < 1e-5,
            "label1 picked scalar voxel value = {}",
            stats[0].value
        );
    }

    #[tokio::test]
    async fn compute_region_stats_rejects_unmapped_layer() {
        let state = BridgeState::default().expect("bridge state");
        let err = compute_region_stats_for_testing("missingScalar", "missingAtlas", "mean", &state)
            .await
            .expect_err("unmapped layer should error");
        match err {
            BridgeError::Input { code, .. } => assert_eq!(code, 2017),
            other => panic!("expected Input(2017) for unmapped layer, got {other:?}"),
        }
    }

    #[test]
    fn sample_member_volume_radius_zero_reads_exact_voxel() {
        // 2x2x2 f32 map, identity affine / unit spacing => world == voxel.
        // Column-major linear index idx = x + y*2 + z*4.
        //   (0,0,0)=0  (1,0,0)=11  (0,1,0)=22  (1,1,0)=33
        //   (0,0,1)=44 (1,0,1)=55  (0,1,1)=66  (1,1,1)=77
        let vol = make_f32_scalar(
            [2, 2, 2],
            vec![0.0, 11.0, 22.0, 33.0, 44.0, 55.0, 66.0, 77.0],
        );

        // Point sample (radius 0) at a few world points returns that exact voxel.
        assert_eq!(
            sample_member_volume(&vol, &[1.0, 0.0, 0.0], 0.0, "mean"),
            11.0
        );
        assert_eq!(
            sample_member_volume(&vol, &[0.0, 1.0, 1.0], 0.0, "mean"),
            66.0
        );
        assert_eq!(
            sample_member_volume(&vol, &[1.0, 1.0, 1.0], 0.0, "mean"),
            77.0
        );
    }

    #[test]
    fn sample_member_volume_sphere_means_neighbouring_voxels() {
        // 3x3x3 f32 map. Place known values at the center voxel (1,1,1) and its
        // +x neighbour (2,1,1); leave the rest 0. Sampling world (1.5,1,1) with
        // radius 1.0 mm picks exactly those two voxels (each 0.5 mm away).
        let dims = [3usize, 3, 3];
        let mut data = vec![0.0f32; dims[0] * dims[1] * dims[2]];
        let idx = |x: usize, y: usize, z: usize| x + y * dims[0] + z * dims[0] * dims[1];
        data[idx(1, 1, 1)] = 10.0;
        data[idx(2, 1, 1)] = 30.0;
        let vol = make_f32_scalar(dims, data);

        let mean = sample_member_volume(&vol, &[1.5, 1.0, 1.0], 1.0, "mean");
        assert!((mean - 20.0).abs() < 1e-5, "sphere mean = {mean}");
    }

    #[test]
    fn sample_member_volume_out_of_bounds_yields_nan() {
        let vol = make_f32_scalar([2, 2, 2], vec![1.0; 8]);
        // World point far outside the [0,2) voxel grid.
        let value = sample_member_volume(&vol, &[100.0, 100.0, 100.0], 0.0, "mean");
        assert!(value.is_nan(), "out-of-bounds should be NaN, got {value}");
    }

    #[test]
    fn sample_member_volume_nan_only_locus_yields_nan() {
        // A grid of all-NaN voxels: every gathered sample is dropped as
        // non-finite, so the reduction has nothing to operate on => NaN.
        let vol = make_f32_scalar([3, 3, 3], vec![f32::NAN; 27]);
        let value = sample_member_volume(&vol, &[1.0, 1.0, 1.0], 1.0, "mean");
        assert!(value.is_nan(), "all-NaN locus should be NaN, got {value}");
    }

    async fn sample_test_source(volume: VolumeSendable) -> set_sample_cache::TestSource {
        let dims = get_spatial_dims_from_volume(&volume);
        let data = volume_data_as_f32_for_projection(&volume).expect("fixture data");
        set_sample_cache::TestSource::new(&dims, &data)
    }

    fn set_member_ref(member_id: &str, source_path: &str) -> SetMemberRef {
        SetMemberRef {
            member_id: member_id.to_string(),
            source_path: source_path.to_string(),
            stack_index: None,
            expected_sha256: None,
            display_label: None,
            design_values: Vec::new(),
        }
    }

    #[tokio::test]
    async fn sample_set_at_world_returns_one_value_per_member_in_order() {
        let state = BridgeState::default().expect("bridge state");
        // Two same-grid members; voxel (1,0,0) holds distinct values.
        let source1 = sample_test_source(make_f32_scalar(
            [2, 2, 2],
            vec![0.0, 5.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
        ))
        .await;
        let source2 = sample_test_source(make_f32_scalar(
            [2, 2, 2],
            vec![0.0, 9.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
        ))
        .await;

        let members = vec![
            set_member_ref("m1", &source1.path.to_string_lossy()),
            set_member_ref("m2", &source2.path.to_string_lossy()),
        ];

        let samples =
            sample_set_at_world_for_testing(&members, &[1.0, 0.0, 0.0], 0.0, "mean", &state)
                .await
                .expect("cohort sample");

        assert_eq!(samples.len(), 2);
        assert_eq!(samples[0].member_id, "m1");
        assert_eq!(samples[0].value, 5.0);
        assert_eq!(samples[1].member_id, "m2");
        assert_eq!(samples[1].value, 9.0);
    }

    #[tokio::test]
    async fn sample_set_at_world_bad_member_yields_nan_without_aborting() {
        let state = BridgeState::default().expect("bridge state");
        let source = sample_test_source(make_f32_scalar(
            [2, 2, 2],
            vec![0.0, 7.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
        ))
        .await;

        let members = vec![
            // Not in cache and not a real file on disk => load fails => NaN.
            set_member_ref("missing", "/cohort/does-not-exist.nii.gz"),
            set_member_ref("good", &source.path.to_string_lossy()),
        ];

        let samples =
            sample_set_at_world_for_testing(&members, &[1.0, 0.0, 0.0], 0.0, "mean", &state)
                .await
                .expect("cohort sample tolerates a bad member");

        assert_eq!(samples.len(), 2);
        assert_eq!(samples[0].member_id, "missing");
        assert!(
            samples[0].value.is_nan(),
            "missing member should be NaN, got {}",
            samples[0].value
        );
        assert_eq!(samples[1].member_id, "good");
        assert_eq!(samples[1].value, 7.0);
    }

    #[tokio::test]
    async fn sample_set_requires_explicit_4d_frame_and_preserves_source_revision() {
        let state = BridgeState::default().expect("state");
        let source = set_sample_cache::TestSource::new(&[1, 1, 1, 3], &[4.0, 7.0, 11.0]);
        let mut member = set_member_ref("person", &source.path.to_string_lossy());
        let missing =
            sample_set_at_world_for_testing(&[member.clone()], &[0.0; 3], 0.0, "mean", &state)
                .await
                .unwrap();
        assert!(missing[0].value.is_nan());
        assert!(missing[0]
            .error
            .as_ref()
            .unwrap()
            .contains("explicit stackIndex"));
        member.stack_index = Some(2);
        let values =
            sample_set_at_world_for_testing(&[member.clone()], &[0.0; 3], 0.0, "mean", &state)
                .await
                .unwrap();
        assert_eq!(values[0].value, 11.0);
        assert_eq!(values[0].count, 1);
        assert!(values[0].error.is_none());
        let hash = values[0].source_revision.as_ref().unwrap().sha256.clone();
        member.expected_sha256 = Some(hash);
        source.write(&[1, 1, 1, 3], &[14.0, 17.0, 21.0]);
        let stale =
            sample_set_at_world_for_testing(&[member.clone()], &[0.0; 3], 0.0, "mean", &state)
                .await
                .unwrap();
        assert!(stale[0].value.is_nan());
        assert!(stale[0]
            .error
            .as_ref()
            .unwrap()
            .contains("revision changed"));
        member.expected_sha256 = None;
        member.stack_index = Some(3);
        let invalid = sample_set_at_world_for_testing(&[member], &[0.0; 3], 0.0, "mean", &state)
            .await
            .unwrap();
        assert!(invalid[0].error.as_ref().unwrap().contains("outside"));
    }

    #[tokio::test]
    async fn sample_set_rejects_ambiguous_identity_and_invalid_probe() {
        let state = BridgeState::default().expect("state");
        let member = set_member_ref("person", "/unused.nii");
        assert!(sample_set_at_world_for_testing(
            &[member.clone(), member],
            &[0.0; 3],
            0.0,
            "mean",
            &state
        )
        .await
        .is_err());
        for (world, radius, reduce) in [
            (vec![f32::NAN, 0.0, 0.0], 0.0, "mean"),
            (vec![0.0; 3], -1.0, "mean"),
            (vec![0.0; 3], 0.0, "typo"),
        ] {
            assert!(
                sample_set_at_world_for_testing(&[], &world, radius, reduce, &state)
                    .await
                    .is_err()
            );
        }
    }

    #[tokio::test]
    async fn sample_set_at_world_rejects_bad_world_len() {
        let state = BridgeState::default().expect("bridge state");
        let err = sample_set_at_world_for_testing(&[], &[1.0, 2.0], 0.0, "mean", &state)
            .await
            .expect_err("two-element world_mm should be rejected");
        match err {
            BridgeError::Input { code, .. } => assert_eq!(code, 2016),
            other => panic!("expected Input(2016) for bad world_mm, got {other:?}"),
        }
    }

    #[test]
    fn population_spatial_reductions_avoid_float32_intermediate_overflow() {
        let values = [1e38f32, 1e38f32, 1e38f32, 1e38f32];
        assert_eq!(reduce_values(&values, "mean"), 1e38);
        assert_eq!(reduce_values(&values, "median"), 1e38);
        assert_eq!(quantile_type7(&[-3e38, 3e38], 0.5), 0.0);
        assert_eq!(roi_spread_band(&values, 1e38, "sd"), (1e38, 1e38));
    }

    #[test]
    fn quantile_type7_matches_reference() {
        let vals = [10.0f32, 20.0, 30.0, 40.0, 50.0, 60.0, 70.0];
        // Type-7 (R default): h = (n-1)*q, linear interpolation.
        assert!((quantile_type7(&vals, 0.25) - 25.0).abs() < 1e-4);
        assert!((quantile_type7(&vals, 0.5) - 40.0).abs() < 1e-4);
        assert!((quantile_type7(&vals, 0.75) - 55.0).abs() < 1e-4);
        assert!((quantile_type7(&vals, 0.025) - 11.5).abs() < 1e-4);
        assert!((quantile_type7(&vals, 0.975) - 68.5).abs() < 1e-4);
        // Degenerate inputs.
        assert_eq!(quantile_type7(&[42.0], 0.9), 42.0);
        assert!(quantile_type7(&[], 0.5).is_nan());
    }

    #[test]
    fn roi_spread_band_variants() {
        let vals = [10.0f32, 20.0, 30.0, 40.0, 50.0, 60.0, 70.0];
        let center = 40.0f32; // mean

        // Degenerate band.
        assert_eq!(roi_spread_band(&vals, center, "none"), (40.0, 40.0));

        // Quantile bands.
        let (lo, hi) = roi_spread_band(&vals, center, "ci95");
        assert!((lo - 11.5).abs() < 1e-3 && (hi - 68.5).abs() < 1e-3);
        let (lo, hi) = roi_spread_band(&vals, center, "iqr");
        assert!((lo - 25.0).abs() < 1e-3 && (hi - 55.0).abs() < 1e-3);

        // SD band: sd = sqrt(2800/6) ≈ 21.6025.
        let (lo, hi) = roi_spread_band(&vals, center, "sd");
        assert!((lo - (40.0 - 21.6025)).abs() < 1e-2, "sd lower {lo}");
        assert!((hi - (40.0 + 21.6025)).abs() < 1e-2, "sd upper {hi}");

        // SEM95 (default): half = 1.96 * sd / sqrt(7) ≈ 16.003.
        let (lo, hi) = roi_spread_band(&vals, center, "sem95");
        assert!((lo - (40.0 - 16.003)).abs() < 1e-2, "sem lower {lo}");
        assert!((hi - (40.0 + 16.003)).abs() < 1e-2, "sem upper {hi}");
        // Unknown band string falls back to sem95.
        assert_eq!(roi_spread_band(&vals, center, "whatever"), (lo, hi));

        // Fewer than two values collapses to the center.
        assert_eq!(roi_spread_band(&[5.0], 5.0, "sem95"), (5.0, 5.0));
    }

    /// Build a 3x3x3 f32 volume whose radius-1 sphere ROI around voxel (1,1,1)
    /// (center + 6 face neighbours) holds the multiset {10,20,30,40,50,60,70}.
    fn make_roi_probe_volume() -> VolumeSendable {
        let idx = |x: usize, y: usize, z: usize| x + y * 3 + z * 9;
        let mut data = vec![0.0f32; 27];
        data[idx(1, 1, 1)] = 40.0;
        data[idx(0, 1, 1)] = 10.0;
        data[idx(2, 1, 1)] = 20.0;
        data[idx(1, 0, 1)] = 30.0;
        data[idx(1, 2, 1)] = 50.0;
        data[idx(1, 1, 0)] = 60.0;
        data[idx(1, 1, 2)] = 70.0;
        make_f32_scalar([3, 3, 3], data)
    }

    #[tokio::test]
    async fn sample_set_trace_reports_mean_and_ci_band() {
        let state = BridgeState::default().expect("bridge state");
        let source = sample_test_source(make_roi_probe_volume()).await;

        let members = vec![set_member_ref("m1", &source.path.to_string_lossy())];

        // Radius-1 sphere @ unit spacing captures center + 6 face neighbours = 7 voxels.
        let traces = sample_set_trace_at_world_for_testing(
            &members,
            &[1.0, 1.0, 1.0],
            1.0,
            "mean",
            "sem95",
            &state,
        )
        .await
        .expect("cohort trace");

        assert_eq!(traces.len(), 1);
        let t = &traces[0];
        assert_eq!(t.member_id, "m1");
        assert_eq!(t.count, 7, "radius-1 sphere should gather 7 voxels");
        assert!((t.value - 40.0).abs() < 1e-4, "mean {}", t.value);
        // sem95 half-width ≈ 16.003, symmetric about the mean.
        assert!(
            (t.lower - (40.0 - 16.003)).abs() < 1e-2,
            "lower {}",
            t.lower
        );
        assert!(
            (t.upper - (40.0 + 16.003)).abs() < 1e-2,
            "upper {}",
            t.upper
        );
        assert!(t.lower < t.value && t.value < t.upper);
    }

    #[tokio::test]
    async fn sample_set_trace_carries_member_labels_and_design_values() {
        let state = BridgeState::default().expect("bridge state");
        let source = sample_test_source(make_roi_probe_volume()).await;

        let members = vec![SetMemberRef {
            member_id: "m1".to_string(),
            source_path: source.path.to_string_lossy().into_owned(),
            stack_index: None,
            expected_sha256: None,
            display_label: Some("sub-01 faces".to_string()),
            design_values: vec![
                StudioDiscoveryDesignValue {
                    column: "subject".to_string(),
                    value: "sub-01".to_string(),
                },
                StudioDiscoveryDesignValue {
                    column: "condition".to_string(),
                    value: "faces".to_string(),
                },
            ],
        }];

        let traces = sample_set_trace_at_world_for_testing(
            &members,
            &[1.0, 1.0, 1.0],
            0.0,
            "mean",
            "none",
            &state,
        )
        .await
        .expect("cohort trace");

        let t = &traces[0];
        assert_eq!(t.member_id, "m1");
        assert_eq!(t.display_label.as_deref(), Some("sub-01 faces"));
        assert_eq!(t.design_values.len(), 2);
        assert_eq!(t.design_values[0].column, "subject");
        assert_eq!(t.design_values[0].value, "sub-01");
        assert_eq!(t.design_values[1].column, "condition");
        assert_eq!(t.design_values[1].value, "faces");
    }

    #[tokio::test]
    async fn sample_set_trace_bad_member_yields_nan_trace() {
        let state = BridgeState::default().expect("bridge state");
        let source = sample_test_source(make_roi_probe_volume()).await;

        let members = vec![
            set_member_ref("missing", "/cohort/nope.nii.gz"),
            set_member_ref("good", &source.path.to_string_lossy()),
        ];

        let traces = sample_set_trace_at_world_for_testing(
            &members,
            &[1.0, 1.0, 1.0],
            0.0,
            "mean",
            "sem95",
            &state,
        )
        .await
        .expect("trace tolerates a bad member");

        assert_eq!(traces.len(), 2);
        assert_eq!(traces[0].member_id, "missing");
        assert!(traces[0].value.is_nan() && traces[0].lower.is_nan() && traces[0].upper.is_nan());
        assert_eq!(traces[0].count, 0);
        // Point sample (radius 0) at the center voxel: value == 40, band collapses.
        assert_eq!(traces[1].member_id, "good");
        assert!((traces[1].value - 40.0).abs() < 1e-4);
        assert_eq!(traces[1].count, 1);
        assert_eq!(traces[1].lower, traces[1].value);
        assert_eq!(traces[1].upper, traces[1].value);
    }

    #[tokio::test]
    async fn sample_set_trace_rejects_bad_world_len() {
        let state = BridgeState::default().expect("bridge state");
        let err =
            sample_set_trace_at_world_for_testing(&[], &[1.0, 2.0], 0.0, "mean", "sem95", &state)
                .await
                .expect_err("two-element world_mm should be rejected");
        match err {
            BridgeError::Input { code, .. } => assert_eq!(code, 2016),
            other => panic!("expected Input(2016) for bad world_mm, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn test_volume_layer_spec_serialization() {
        let spec = VolumeLayerSpec {
            id: "layer1".to_string(),
            source_resource_id: "volume1".to_string(),
            colormap: "viridis".to_string(),
            slice_axis: Some(SliceAxis::Coronal),
            slice_index: Some(SliceIndex::Relative(0.75)),
        };

        // Test serialization
        let json = serde_json::to_string(&spec).unwrap();
        assert!(json.contains("\"slice_axis\":\"Coronal\""));
        assert!(json.contains("\"slice_index\":{\"Relative\":0.75}"));

        // Test deserialization
        let deserialized: VolumeLayerSpec = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.id, "layer1");
        assert_eq!(deserialized.slice_axis, Some(SliceAxis::Coronal));
        match deserialized.slice_index {
            Some(SliceIndex::Relative(val)) => assert_eq!(val, 0.75),
            _ => panic!("Expected Relative slice index"),
        }
    }

    #[test]
    fn remote_mount_profile_defaults_missing_new_fields() {
        let profile: RemoteMountProfile = serde_json::from_str(
            r#"{
                "id":"profile-1",
                "name":"Trillium",
                "host":"login.example.org",
                "port":22,
                "user":"alice",
                "remote_path":"/data",
                "auth_method":"password",
                "known_hosts_path":null
            }"#,
        )
        .expect("profile should deserialize with defaults");

        assert_eq!(profile.key_path, None);
        assert!(profile.verify_host_key);
        assert!(!profile.accept_unknown_host_keys);
        assert!(!profile.has_password);
        assert!(!profile.has_key_passphrase);
        assert_eq!(profile.updated_at_ms, 0);
    }

    #[test]
    fn key_passphrase_account_key_tracks_selected_key_file() {
        let explicit = key_passphrase_account_key(
            "login.example.org",
            22,
            "alice",
            Some(" ~/.ssh/id_ed25519 "),
        );
        let default_key = key_passphrase_account_key("login.example.org", 22, "alice", None);

        assert_eq!(
            explicit,
            "key-file:alice@login.example.org:22:~/.ssh/id_ed25519"
        );
        assert_eq!(
            default_key,
            "key-file:alice@login.example.org:22:__default__"
        );
    }

    #[test]
    fn remote_cache_metadata_compares_endpoint_and_remote_stat() {
        let metadata = RemoteFileCacheMetadata {
            version: 1,
            mount_id: "mount-1".to_string(),
            host: "login.example.org".to_string(),
            port: 22,
            user: "alice".to_string(),
            remote_path: "/data/brain.nii.gz".to_string(),
            remote_size: 1024,
            remote_modified_unix_secs: Some(123),
        };
        let remote_stat = remotely::fs::Metadata {
            file_type: remotely::fs::FileType::File,
            size: 1024,
            permissions: 0,
            uid: None,
            gid: None,
            accessed: None,
            modified: Some(UNIX_EPOCH + Duration::from_secs(123)),
        };

        assert!(remote_cache_metadata_matches(
            &metadata,
            "mount-1",
            "login.example.org",
            22,
            "alice",
            "/data/brain.nii.gz",
            &remote_stat,
        ));
        assert!(!remote_cache_metadata_matches(
            &metadata,
            "mount-1",
            "login.example.org",
            22,
            "alice",
            "/data/other.nii.gz",
            &remote_stat,
        ));
        let mut persisted = metadata.clone();
        persisted.version = 2;
        assert!(remote_cache_metadata_matches(
            &persisted,
            "new-session",
            "login.example.org",
            22,
            "alice",
            "/data/brain.nii.gz",
            &remote_stat
        ));
        let mut unknown_mtime = remote_stat.clone();
        unknown_mtime.modified = None;
        persisted.remote_modified_unix_secs = None;
        assert!(!remote_cache_metadata_matches(
            &persisted,
            "new-session",
            "login.example.org",
            22,
            "alice",
            "/data/brain.nii.gz",
            &unknown_mtime
        ));
    }
}

/// Inspect and validate a table against the dictionary retained by a loaded atlas.
#[command]
async fn preview_parcel_table(
    request: ParcelTableRequest,
    state: State<'_, BridgeState>,
) -> BridgeResult<ParcelTablePreview> {
    let dictionary = state
        .volume_registry
        .lock()
        .await
        .parcel_dictionaries
        .get(&request.source_volume_id)
        .cloned()
        .ok_or_else(|| parcel_overlay::input("Select an atlas loaded through the atlas catalog"))?;
    tokio::task::spawn_blocking(move || parcel_overlay::preview_dictionary(&dictionary, &request))
        .await
        .map_err(|e| parcel_overlay::input(e.to_string()))?
}

#[command]
async fn create_parcel_overlay(
    request: ParcelTableRequest,
    column: String,
    table_name: String,
    state: State<'_, BridgeState>,
) -> BridgeResult<ParcelOverlayInfo> {
    let (dictionary, source) = {
        let registry = state.volume_registry.lock().await;
        (
            registry
                .parcel_dictionaries
                .get(&request.source_volume_id)
                .cloned()
                .ok_or_else(|| parcel_overlay::input("The source atlas is no longer loaded"))?,
            registry
                .get_entry(&request.source_volume_id)
                .cloned()
                .ok_or_else(|| parcel_overlay::input("The source atlas is no longer loaded"))?,
        )
    };
    let source_id = request.source_volume_id.clone();
    let (entry, overlay) = tokio::task::spawn_blocking(move || {
        parcel_overlay::prepare(&dictionary, &source, &request, &column, table_name)
    })
    .await
    .map_err(|e| parcel_overlay::input(e.to_string()))??;
    let mut registry = state.volume_registry.lock().await;
    if !registry
        .get_arc(&source_id)
        .is_some_and(|data| Arc::ptr_eq(&data, &overlay.geometry))
    {
        return Err(parcel_overlay::input(
            "The source atlas changed or was removed during import",
        ));
    }
    let info = overlay.info.clone();
    registry.volumes.insert(info.volume_id.clone(), entry);
    registry
        .parcel_overlays
        .insert(info.volume_id.clone(), overlay);
    Ok(info)
}

#[command]
async fn select_parcel_column(
    volume_id: String,
    column: String,
    state: State<'_, BridgeState>,
) -> BridgeResult<ParcelOverlayInfo> {
    let mut overlay = state
        .volume_registry
        .lock()
        .await
        .parcel_overlays
        .get(&volume_id)
        .cloned()
        .ok_or_else(|| parcel_overlay::input("Parcel overlay is no longer loaded"))?;
    let revision = overlay.revision;
    let (overlay, scalar) = tokio::task::spawn_blocking(move || {
        overlay.select(&column)?;
        let scalar = Arc::new(overlay.scalar_snapshot()?);
        Ok::<_, BridgeError>((overlay, scalar))
    })
    .await
    .map_err(|e| parcel_overlay::input(e.to_string()))??;
    let mut registry = state.volume_registry.lock().await;
    if registry
        .parcel_overlays
        .get(&volume_id)
        .is_none_or(|current| current.revision != revision)
    {
        return Err(parcel_overlay::input(
            "The overlay changed while selecting a column; please select again",
        ));
    }
    registry
        .volumes
        .get_mut(&volume_id)
        .ok_or_else(|| parcel_overlay::input("Parcel overlay is no longer loaded"))?
        .data = scalar;
    let info = overlay.info.clone();
    registry.parcel_overlays.insert(volume_id, overlay);
    Ok(info)
}

async fn surface_parcel_dictionary(
    id: &str,
    state: &BridgeState,
) -> BridgeResult<atlases::parcel_dictionary::ParcelDictionary> {
    let mut cache = state.surface_parcel_dictionaries.lock().await;
    let index = cache.iter().position(|(key, _)| key == id).ok_or_else(|| {
        parcel_overlay::input("Surface atlas dictionary expired; reload the atlas")
    })?;
    let entry = cache.remove(index).unwrap();
    let dictionary = entry.1.clone();
    cache.push_back(entry);
    Ok(dictionary)
}

#[command]
async fn preview_surface_parcel_table(
    dictionary_id: String,
    request: ParcelTableRequest,
    state: State<'_, BridgeState>,
) -> BridgeResult<ParcelTablePreview> {
    let dictionary = surface_parcel_dictionary(&dictionary_id, &state).await?;
    tokio::task::spawn_blocking(move || parcel_overlay::preview_dictionary(&dictionary, &request))
        .await
        .map_err(|e| parcel_overlay::input(e.to_string()))?
}

#[command]
async fn bind_surface_parcel_table(
    dictionary_id: String,
    request: ParcelTableRequest,
    state: State<'_, BridgeState>,
) -> BridgeResult<parcel_overlay::SurfaceParcelTable> {
    let dictionary = surface_parcel_dictionary(&dictionary_id, &state).await?;
    tokio::task::spawn_blocking(move || parcel_overlay::bind_surface_table(&dictionary, &request))
        .await
        .map_err(|e| parcel_overlay::input(e.to_string()))?
}

#[command]
async fn get_atlas_roi_locations(
    volume_id: String,
    state: State<'_, BridgeState>,
) -> BridgeResult<Vec<AtlasRoiLocation>> {
    let (dictionary, volume) = {
        let registry = state.volume_registry.lock().await;
        let dictionary = registry
            .parcel_dictionaries
            .get(&volume_id)
            .cloned()
            .ok_or_else(|| {
                parcel_overlay::input(
                    "ROI search requires an atlas loaded through the atlas catalog",
                )
            })?;
        let entry = registry
            .get_entry(&volume_id)
            .ok_or_else(|| parcel_overlay::input("The source atlas is no longer loaded"))?;
        if entry.metadata.volume_type == bridge_types::VolumeType::TimeSeries4D {
            return Err(parcel_overlay::input(
                "ROI navigation requires a 3D label atlas",
            ));
        }
        (dictionary, entry.data.clone())
    };
    tokio::task::spawn_blocking(move || atlas_roi::locations(&dictionary, &volume))
        .await
        .map_err(|e| parcel_overlay::input(e.to_string()))?
}
