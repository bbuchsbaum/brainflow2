use tauri::command;
// Import necessary volmath types directly
use volmath::DenseVolume3;
use volmath::DenseVolumeExt; // Import DenseVolumeExt trait
use volmath::NeuroSpaceExt; // Import NeuroSpaceExt trait
use volmath::NeuroVecTrait; // Import NeuroVecTrait for volume() method // Import DenseVolume3 type
                            // Import neuroim types through volmath re-exports
                            // use wgpu; // No longer needed directly
use std::collections::{HashMap, HashSet};
use std::convert::TryInto;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::State; // Need State for accessing registry
                  // Import types from bridge_types
use bridge_types::{
    self, icons, BatchRenderRequest, BridgeError, BridgeResult, DataRange, FlatNode,
    GpuTextureFormat, LayerPatch, Loaded, Loader, NiftiHeaderInfo, RemoteAuthChallenge,
    RemoteAuthPrompt, RemoteHostKeyChallenge, RemoteMountConnectRequest, RemoteMountConnectResult,
    RemoteMountInfo, RemoteMountOrigin, RemoteMountProfile, SliceAxisMeta, SliceInfo,
    TextureCoordinates, TreePayload, VolumeHandleInfo, VolumeLayerGpuInfo, VolumeSendable,
};
use colormap::colormap_by_name;
// Import NiftiLoader for registration
// use nifti_loader::NiftiLoader;
use render_loop::RenderLoopService; // Remove unused RenderLoopError
                                    // Import async_trait attribute
                                    // use async_trait::async_trait;
use log::{debug, error, info, warn}; // Added error, warn, and debug
use serde::{Deserialize, Serialize}; // Need Serialize/Deserialize for new types
use serde_json::{self, Value as JsonValue}; // For JSON parsing
use ts_rs::TS;
use uuid; // For generating unique IDs // Add TS trait
          // Use futures::executor::block_on when needed (now removed)
          // use futures;
          // Added imports for plugin creation
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{generate_handler, Manager, Runtime};
// Re-add tokio::sync::Mutex
use directories::ProjectDirs;
use keyring::Entry as KeyringEntry;
use nalgebra::{Affine3, Matrix4}; // Removed unused Vector4
use neuro_types::{ViewOrientation, ViewRectMm, VolumeMetadata};
use remotely::ssh::{
    AuthMethod as RemoteAuthMethod, ConnectConfig as RemoteConnectConfig,
    ConnectOutcome as RemoteConnectOutcome, HostKeyDisposition,
};
use remotely::RemoteClient;
use tokio::runtime::Handle;
use tokio::sync::Mutex;
use tokio::time::{interval, MissedTickBehavior};
use tracing; // Add tracing facade import // For get_initial_views

// Imports for fs_list_directory
// Assuming core_loaders is the crate name for the new module
use brainflow_loaders as core_loaders;
// GIFTI support
use gifti_loader;

// Import error helpers
mod error_context;
mod error_helpers;
mod user_errors;
use error_context::*;
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
pub enum SliceAxis {
    Sagittal = 0, // X axis (YZ plane)
    Coronal = 1,  // Y axis (XZ plane)
    Axial = 2,    // Z axis (XY plane)
}

impl Default for SliceAxis {
    fn default() -> Self {
        SliceAxis::Axial
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)] // Add derives
#[ts(export)]
pub enum SliceIndex {
    Fixed(usize),         // Specific slice index
    Middle,               // Middle slice (default)
    Relative(f32),        // Relative position (0.0 = first, 1.0 = last)
    WorldCoordinate(f32), // Slice at specific world coordinate
}

impl Default for SliceIndex {
    fn default() -> Self {
        SliceIndex::Middle
    }
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
    render_state_entry_removed: bool,
}

#[derive(Clone)]
struct LayerLease {
    inner: Arc<LayerLeaseInner>,
}

struct LayerLeaseInner {
    layer_id: String,
    atlas_index: u32,
    render_loop_service: Arc<Mutex<Option<Arc<Mutex<RenderLoopService>>>>>,
    layer_to_atlas_map: Arc<Mutex<HashMap<String, u32>>>,
    layer_to_volume_map: Arc<Mutex<HashMap<String, String>>>,
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
    ) -> Self {
        Self {
            inner: Arc::new(LayerLeaseInner {
                layer_id,
                atlas_index,
                render_loop_service,
                layer_to_atlas_map,
                layer_to_volume_map,
                is_released: AtomicBool::new(false),
                created_at: Instant::now(),
            }),
        }
    }

    fn atlas_index(&self) -> u32 {
        self.inner.atlas_index
    }

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
}

impl LayerLeaseInner {
    async fn release(&self, reason: &'static str) -> BridgeResult<Option<ReleaseOutcome>> {
        if self.is_released.swap(true, Ordering::SeqCst) {
            return Ok(None);
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
        let removed_from_render_state = match render_service.remove_layer_by_atlas(atlas_index) {
            Ok(removed) => removed,
            Err(err) => {
                warn!(
                    "LayerLease({}) failed to remove render state entry for atlas index {}: {:?}",
                    self.layer_id, atlas_index, err
                );
                false
            }
        };

        render_service.volume_atlas.free_layer(atlas_index);
        info!(
            "LayerLease({}) released atlas index {} (reason: {})",
            self.layer_id, atlas_index, reason
        );

        Ok(Some(ReleaseOutcome {
            atlas_index,
            render_state_entry_removed: removed_from_render_state,
        }))
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
        let m = Matrix4::new(
            trans[(0, 0)] as f32,
            trans[(0, 1)] as f32,
            trans[(0, 2)] as f32,
            trans[(0, 3)] as f32,
            trans[(1, 0)] as f32,
            trans[(1, 1)] as f32,
            trans[(1, 2)] as f32,
            trans[(1, 3)] as f32,
            trans[(2, 0)] as f32,
            trans[(2, 1)] as f32,
            trans[(2, 2)] as f32,
            trans[(2, 3)] as f32,
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
        | VolumeSendable::VolF64(_, affine) => Ok(affine.clone()),
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
        VolumeSendable::Vec4DF32(vec) => {
            vec.space.dim.iter().take(3).map(|&d| d as usize).collect()
        }
        VolumeSendable::Vec4DI16(vec) => {
            vec.space.dim.iter().take(3).map(|&d| d as usize).collect()
        }
        VolumeSendable::Vec4DU8(vec) => vec.space.dim.iter().take(3).map(|&d| d as usize).collect(),
        VolumeSendable::Vec4DI8(vec) => vec.space.dim.iter().take(3).map(|&d| d as usize).collect(),
        VolumeSendable::Vec4DU16(vec) => {
            vec.space.dim.iter().take(3).map(|&d| d as usize).collect()
        }
        VolumeSendable::Vec4DI32(vec) => {
            vec.space.dim.iter().take(3).map(|&d| d as usize).collect()
        }
        VolumeSendable::Vec4DU32(vec) => {
            vec.space.dim.iter().take(3).map(|&d| d as usize).collect()
        }
        VolumeSendable::Vec4DF64(vec) => {
            vec.space.dim.iter().take(3).map(|&d| d as usize).collect()
        }
    }
}

/// Convert world coordinates to grid coordinates
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
                    ))
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
fn extract_3d_volume_at_timepoint(
    volume_4d: &VolumeSendable,
    timepoint: usize,
) -> BridgeResult<VolumeSendable> {
    match volume_4d {
        // For 3D volumes, just return as-is (ignore timepoint)
        VolumeSendable::VolF32(vol, affine) => {
            Ok(VolumeSendable::VolF32(vol.clone(), affine.clone()))
        }
        VolumeSendable::VolI16(vol, affine) => {
            Ok(VolumeSendable::VolI16(vol.clone(), affine.clone()))
        }
        VolumeSendable::VolU8(vol, affine) => {
            Ok(VolumeSendable::VolU8(vol.clone(), affine.clone()))
        }
        VolumeSendable::VolI8(vol, affine) => {
            Ok(VolumeSendable::VolI8(vol.clone(), affine.clone()))
        }
        VolumeSendable::VolU16(vol, affine) => {
            Ok(VolumeSendable::VolU16(vol.clone(), affine.clone()))
        }
        VolumeSendable::VolI32(vol, affine) => {
            Ok(VolumeSendable::VolI32(vol.clone(), affine.clone()))
        }
        VolumeSendable::VolU32(vol, affine) => {
            Ok(VolumeSendable::VolU32(vol.clone(), affine.clone()))
        }
        VolumeSendable::VolF64(vol, affine) => {
            Ok(VolumeSendable::VolF64(vol.clone(), affine.clone()))
        }

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
            details: format!("Volume has zero size along {} axis. The volume may be corrupted or improperly loaded.",
                match axis {
                    SliceAxis::Axial => "Z (axial)",
                    SliceAxis::Coronal => "Y (coronal)",
                    SliceAxis::Sagittal => "X (sagittal)",
                })
        });
    }

    let slice_idx = match slice_spec {
        SliceIndex::Fixed(idx) => {
            if *idx >= max_index {
                return Err(BridgeError::Input {
                    code: 2003,
                    details: format!("Slice index {} is out of bounds for {} axis. Valid range is 0-{} for this volume.",
                        idx,
                        match axis {
                            SliceAxis::Axial => "axial",
                            SliceAxis::Coronal => "coronal",
                            SliceAxis::Sagittal => "sagittal",
                        },
                        max_index - 1
                    )
                });
            }
            *idx
        }
        SliceIndex::Middle => max_index / 2,
        SliceIndex::Relative(position) => {
            if *position < 0.0 || *position > 1.0 {
                return Err(BridgeError::Input {
                    code: 2004,
                    details: format!("Relative slice position {} is invalid. Please provide a value between 0.0 (first slice) and 1.0 (last slice).", position)
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
                    details: format!("World coordinate {} mm is outside the volume bounds for {} axis. The coordinate maps to voxel index {}, but valid range is 0-{}.",
                        world_coord,
                        match axis {
                            SliceAxis::Axial => "axial",
                            SliceAxis::Coronal => "coronal",
                            SliceAxis::Sagittal => "sagittal",
                        },
                        voxel_coord,
                        max_index - 1
                    )
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
#[derive(Debug)]
pub struct VolumeEntry {
    /// The actual volume data (3D or 4D)
    pub data: VolumeSendable,
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
}

impl VolumeRegistry {
    pub fn new() -> Self {
        Self {
            volumes: HashMap::new(),
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
                data,
                current_timepoint,
                metadata,
            },
        );
    }

    /// Get a volume by ID (returns the current timepoint for 4D)
    pub fn get(&self, id: &str) -> Option<&VolumeSendable> {
        self.volumes.get(id).map(|entry| &entry.data)
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
        let keys: Vec<String> = self
            .surface_data
            .keys()
            .filter(|key| key.starts_with(&prefix))
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
}

// --- Define App State to hold the registry ---
// This might conflict/need merging with AppState in src-tauri/lib.rs later
pub struct BridgeState {
    // Removed: pub loader_registry: Arc<Mutex<LoaderRegistry>>,
    pub volume_registry: Arc<Mutex<VolumeRegistry>>,
    pub surface_registry: Arc<Mutex<SurfaceRegistry>>,
    pub render_loop_service: Arc<Mutex<Option<Arc<Mutex<RenderLoopService>>>>>,
    // NEW: Map UI layer ID to GPU texture atlas layer index
    pub layer_to_atlas_map: Arc<Mutex<HashMap<String, u32>>>,
    // Map UI layer ID to volume handle
    pub layer_to_volume_map: Arc<Mutex<HashMap<String, String>>>,
    // Active leases guarding atlas allocations
    pub layer_leases: Arc<Mutex<HashMap<String, LayerLease>>>,
    // Atlas service for brain atlas management
    pub atlas_service: Arc<Mutex<AtlasService>>,
    // Template service for brain template management
    pub template_service: Arc<Mutex<templates::TemplateService>>,
    // Active remote mounts keyed by mount_id.
    pub remote_mounts: Arc<Mutex<HashMap<String, RemoteMountEntry>>>,
    // Pending host-key prompt context keyed by challenge UUID.
    pub pending_remote_host_key: Arc<Mutex<HashMap<uuid::Uuid, PendingRemoteMountContext>>>,
    // Pending keyboard-interactive context keyed by conversation UUID.
    pub pending_remote_auth: Arc<Mutex<HashMap<uuid::Uuid, PendingRemoteMountContext>>>,
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
            /* Removed loader_registry field */ volume_registry,
            surface_registry,
            render_loop_service,
            layer_to_atlas_map,
            layer_to_volume_map,
            layer_leases: Arc::new(Mutex::new(HashMap::new())),
            atlas_service,
            template_service,
            remote_mounts: Arc::new(Mutex::new(HashMap::new())),
            pending_remote_host_key: Arc::new(Mutex::new(HashMap::new())),
            pending_remote_auth: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn default() -> Result<Self, String> {
        // Create cache directory for atlas data
        let cache_dir = std::env::temp_dir().join("brainflow_atlas_cache");

        Ok(Self {
            // Removed loader_registry initialization
            volume_registry: Arc::new(Mutex::new(VolumeRegistry::new())),
            surface_registry: Arc::new(Mutex::new(SurfaceRegistry::new())),
            render_loop_service: Arc::new(Mutex::new(None)),
            layer_to_atlas_map: Arc::new(Mutex::new(HashMap::new())),
            layer_to_volume_map: Arc::new(Mutex::new(HashMap::new())),
            layer_leases: Arc::new(Mutex::new(HashMap::new())),
            atlas_service: Arc::new(Mutex::new(
                AtlasService::new(cache_dir.clone())
                    .map_err(|e| format!("Failed to initialize atlas service: {}", e))?,
            )),
            template_service: Arc::new(Mutex::new(
                templates::TemplateService::new(cache_dir)
                    .map_err(|e| format!("Failed to initialize template service: {}", e))?,
            )),
            remote_mounts: Arc::new(Mutex::new(HashMap::new())),
            pending_remote_host_key: Arc::new(Mutex::new(HashMap::new())),
            pending_remote_auth: Arc::new(Mutex::new(HashMap::new())),
        })
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

                let leases_snapshot: Vec<(String, LayerLease)> = {
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

fn credential_account_key(host: &str, port: u16, user: &str) -> String {
    format!("{user}@{host}:{port}")
}

fn read_cached_password(host: &str, port: u16, user: &str) -> Option<String> {
    let account = credential_account_key(host, port, user);
    let entry = KeyringEntry::new(REMOTE_KEYRING_SERVICE, &account).ok()?;
    entry.get_password().ok()
}

fn write_cached_password(host: &str, port: u16, user: &str, password: &str) -> BridgeResult<()> {
    let account = credential_account_key(host, port, user);
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
    let account = credential_account_key(host, port, user);
    if let Ok(entry) = KeyringEntry::new(REMOTE_KEYRING_SERVICE, &account) {
        let _ = entry.delete_password();
    }
}

fn map_remotely_error(err: remotely::Error, code: u16) -> BridgeError {
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

fn normalize_remote_mount_request(
    request: RemoteMountConnectRequest,
) -> BridgeResult<NormalizedRemoteMountRequest> {
    let host = request.host.trim().to_string();
    let user = request.user.trim().to_string();
    let remote_path = sanitize_remote_path(&request.remote_path);

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
        key_path: request.key_path,
        key_passphrase: request.key_passphrase,
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
            if let Some(key_path) = request.key_path.as_ref() {
                Ok(RemoteAuthMethod::KeyFile {
                    source: remotely::ssh::KeySource::File(PathBuf::from(key_path)),
                    passphrase: request.key_passphrase.clone(),
                })
            } else {
                Ok(RemoteAuthMethod::KeyFile {
                    source: remotely::ssh::KeySource::DefaultLocations,
                    passphrase: request.key_passphrase.clone(),
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
        verify_host_key: request.verify_host_key,
        accept_unknown_host_keys: request.accept_unknown_host_keys,
        known_hosts_path: request
            .known_hosts_path
            .as_ref()
            .map(|path| path.to_string_lossy().to_string()),
        has_password,
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

    let client = Arc::clone(&mount.client);
    let remote_path_for_list = remote_path.clone();
    let entries = tokio::task::spawn_blocking(move || {
        futures::executor::block_on(async move {
            client.fs().list(Path::new(&remote_path_for_list)).await
        })
    })
    .await
    .map_err(|e| BridgeError::Internal {
        code: 8216,
        details: format!("Remote directory listing task failed: {e}"),
    })?
    .map_err(|e| map_remotely_error(e, 8216))?;

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
    if path.exists() {
        return Ok(());
    }

    let Some((mount, remote_path)) = resolve_remote_mount_for_local_path(state, path).await else {
        return Ok(());
    };

    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| BridgeError::Io {
                code: 8217,
                details: format!("Failed to prepare cache path {}: {e}", parent.display()),
            })?;
    }

    let client = Arc::clone(&mount.client);
    let remote_path_for_download = remote_path.clone();
    let local_path = path.to_path_buf();
    tokio::task::spawn_blocking(move || {
        futures::executor::block_on(async move {
            client
                .fs()
                .download_to_path(
                    Path::new(&remote_path_for_download),
                    &local_path,
                    remotely::DownloadOptions::default(),
                )
                .await
        })
    })
    .await
    .map_err(|e| BridgeError::Internal {
        code: 8218,
        details: format!("Remote file download task failed: {e}"),
    })?
    .map_err(|e| map_remotely_error(e, 8218))?;

    Ok(())
}

async fn finalize_remote_mount(
    state: &BridgeState,
    request: NormalizedRemoteMountRequest,
    client: RemoteClient,
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

    let local_root = cache_root.join(&mount_id);
    tokio::fs::create_dir_all(&local_root)
        .await
        .map_err(|e| BridgeError::Io {
            code: 8220,
            details: format!(
                "Failed to create mount cache directory {}: {e}",
                local_root.display()
            ),
        })?;

    if request.remember_password {
        if let Some(password) = request.password.as_ref() {
            write_cached_password(&request.host, request.port, &request.user, password)?;
        }
    } else if request.auth_method == "password" {
        delete_cached_password(&request.host, request.port, &request.user);
    }

    if request.save_profile {
        upsert_remote_profile(&request, request.remember_password).await?;
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

    let mount_entry = RemoteMountEntry {
        mount_id: mount_id.clone(),
        local_root: local_root.clone(),
        remote_root: request.remote_path.clone(),
        display_name: display_name.clone(),
        origin_label: origin_label.clone(),
        host: request.host.clone(),
        port: request.port,
        user: request.user.clone(),
        client: Arc::new(client),
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

async fn handle_remote_connect_outcome(
    state: &BridgeState,
    context: PendingRemoteMountContext,
    outcome: RemoteConnectOutcome,
) -> BridgeResult<RemoteMountConnectResult> {
    match outcome {
        RemoteConnectOutcome::Connected(client) => {
            finalize_remote_mount(state, context.request, client).await
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

    // Load the volume data
    let (volume_sendable, _affine) =
        nifti_loader::load_nifti_volume_auto(&file_path).map_err(|e| BridgeError::Loader {
            code: 1003,
            details: format!("Failed to load file {}: {}", path, e),
        })?;

    // Extract metadata from the loaded volume
    let loaded_data =
        nifti_loader::NiftiLoader::load(&file_path).map_err(|e| BridgeError::Loader {
            code: 1004,
            details: format!("Failed to load metadata for {}: {}", path, e),
        })?;

    let (dims, dtype) = match loaded_data {
        bridge_types::Loaded::Volume { dims, dtype, .. } => (dims, dtype),
        _ => {
            return Err(BridgeError::Input {
                code: 1005,
                details: "Only volume files are supported by load_file.".to_string(),
            });
        }
    };

    // Determine if this is a 4D volume by checking the VolumeSendable
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
        // For other types, assume 3D for now
        _ => (bridge_types::VolumeType::Volume3D, None),
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
        "Bridge: Successfully loaded volume with handle: {}",
        handle_id
    );

    // Return the handle
    Ok(VolumeHandleInfo {
        id: handle_id,
        name: file_name.to_string(),
        dims: dims.iter().map(|&d| d as usize).collect(),
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
    let loaded = gifti_loader::GiftiLoader::load(&file_path)?;

    match loaded {
        bridge_types::Loaded::Surface {
            handle,
            vertex_count,
            face_count,
            path: loaded_path,
        } => {
            // Load the actual surface geometry
            let geometry = gifti_loader::load_gifti_surface(&file_path)?;

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
            path: loaded_path,
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

    // Extract vertices and faces
    // vertices() returns Result<Array2<f64>> where each row is [x, y, z]
    let vertices_array = surface_entry
        .geometry
        .vertices()
        .map_err(|e| BridgeError::Internal {
            code: 2002,
            details: format!("Failed to get vertices: {}", e),
        })?;
    let mut vertices = Vec::with_capacity(vertices_array.nrows() * 3);
    for row in vertices_array.rows() {
        vertices.push(row[0] as f32);
        vertices.push(row[1] as f32);
        vertices.push(row[2] as f32);
    }

    // faces() returns Result<Array2<usize>> where each row is [v0, v1, v2]
    let faces_array = surface_entry
        .geometry
        .faces()
        .map_err(|e| BridgeError::Internal {
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

#[command]
#[tracing::instrument(skip_all, err, name = "api.unload_surface")]
async fn unload_surface(
    handle: String,
    state: State<'_, BridgeState>,
) -> BridgeResult<ReleaseResult> {
    info!("Bridge: unload_surface called for handle: {}", handle);

    let mut registry = state.surface_registry.lock().await;
    registry
        .remove_surface(&handle)
        .ok_or_else(|| BridgeError::Input {
            code: 2013,
            details: format!("Surface not found: {}", handle),
        })?;
    let removed_overlay_count = registry.remove_data_for_surface(&handle);
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
    let handle = format!(
        "overlay_{}_{}",
        target_surface_id,
        file_path
            .file_stem()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
    );

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
        sform_code: 0,
        qform_code: 0,
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
            })
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

            // --- 1. Get RenderLoopService (only if not metadata_only) ---
            // We need to keep the service guard alive if we're going to use it
            let service_guard = if !metadata_only_flag {
                Some(state.render_loop_service.lock().await)
            } else {
                None
            };

            let mut render_loop_service = if let Some(ref guard) = service_guard {
                let service_arc = guard.as_ref()
                    .ok_or_else(|| {
                        error!("RenderLoopService is not available.");
                        BridgeError::ServiceNotInitialized {
                            code: 5002,
                            details: "GPU rendering service is not initialized. Please ensure the application has started correctly.".to_string()
                        }
                    })?;
                Some(service_arc.lock().await)
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
                    details: format!("Volume {} not ready in registry. This may indicate a timing issue between template loading and GPU allocation.", source_volume_id),
                });
            }

            let volume_data = volume_registry_guard
                .get(&source_volume_id)
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
                debug!("About to upload volume to GPU");
                let render_service = render_loop_service
                    .as_mut()
                    .expect("RenderLoopService should be available when not in metadata_only mode");
                match volume_data {
                    VolumeSendable::VolF32(vol, _) => {
                        debug!("Uploading F32 volume with {} voxels", vol.data().len());
                        render_service
                            .upload_volume_3d(vol)
                            .map_err(|e| gpu_allocation_error(&ui_layer_id, &e.to_string()))?
                    }
                    VolumeSendable::VolI16(vol, _) => render_service
                        .upload_volume_3d(vol)
                        .map_err(|e| gpu_allocation_error(&ui_layer_id, &e.to_string()))?,
                    VolumeSendable::VolU8(vol, _) => render_service
                        .upload_volume_3d(vol)
                        .map_err(|e| gpu_allocation_error(&ui_layer_id, &e.to_string()))?,
                    VolumeSendable::VolI8(vol, _) => render_service
                        .upload_volume_3d(vol)
                        .map_err(|e| gpu_allocation_error(&ui_layer_id, &e.to_string()))?,
                    VolumeSendable::VolU16(vol, _) => render_service
                        .upload_volume_3d(vol)
                        .map_err(|e| gpu_allocation_error(&ui_layer_id, &e.to_string()))?,
                    VolumeSendable::VolI32(vol, _) => render_service
                        .upload_volume_3d(vol)
                        .map_err(|e| gpu_allocation_error(&ui_layer_id, &e.to_string()))?,
                    VolumeSendable::VolU32(vol, _) => render_service
                        .upload_volume_3d(vol)
                        .map_err(|e| gpu_allocation_error(&ui_layer_id, &e.to_string()))?,
                    VolumeSendable::VolF64(vol, _) => render_service
                        .upload_volume_3d(vol)
                        .map_err(|e| gpu_allocation_error(&ui_layer_id, &e.to_string()))?,
                    // 4D volumes - extract current timepoint
                    VolumeSendable::Vec4DF32(_vec) => {
                        // Get the current timepoint from the registry
                        let timepoint = volume_registry_guard
                            .get_timepoint(&source_volume_id)
                            .unwrap_or(0);
                        info!("Extracting timepoint {} from 4D F32 volume", timepoint);

                        // Extract 3D volume at the specified timepoint
                        let extracted = extract_3d_volume_at_timepoint(volume_data, timepoint)?;

                        // Upload the extracted 3D volume
                        match extracted {
                            VolumeSendable::VolF32(vol, _) => render_service
                                .upload_volume_3d(&vol)
                                .map_err(|e| gpu_allocation_error(&ui_layer_id, &e.to_string()))?,
                            _ => {
                                return Err(BridgeError::Internal {
                                    code: 5014,
                                    details: "Unexpected volume type after 4D extraction"
                                        .to_string(),
                                })
                            }
                        }
                    }
                    VolumeSendable::Vec4DI16(_vec) => {
                        let timepoint = volume_registry_guard
                            .get_timepoint(&source_volume_id)
                            .unwrap_or(0);
                        info!("Extracting timepoint {} from 4D I16 volume", timepoint);
                        let extracted = extract_3d_volume_at_timepoint(volume_data, timepoint)?;
                        match extracted {
                            VolumeSendable::VolI16(vol, _) => render_service
                                .upload_volume_3d(&vol)
                                .map_err(|e| gpu_allocation_error(&ui_layer_id, &e.to_string()))?,
                            _ => {
                                return Err(BridgeError::Internal {
                                    code: 5014,
                                    details: "Unexpected volume type after 4D extraction"
                                        .to_string(),
                                })
                            }
                        }
                    }
                    VolumeSendable::Vec4DU8(_vec) => {
                        let timepoint = volume_registry_guard
                            .get_timepoint(&source_volume_id)
                            .unwrap_or(0);
                        info!("Extracting timepoint {} from 4D U8 volume", timepoint);
                        let extracted = extract_3d_volume_at_timepoint(volume_data, timepoint)?;
                        match extracted {
                            VolumeSendable::VolU8(vol, _) => render_service
                                .upload_volume_3d(&vol)
                                .map_err(|e| gpu_allocation_error(&ui_layer_id, &e.to_string()))?,
                            _ => {
                                return Err(BridgeError::Internal {
                                    code: 5014,
                                    details: "Unexpected volume type after 4D extraction"
                                        .to_string(),
                                })
                            }
                        }
                    }
                    VolumeSendable::Vec4DI8(_vec) => {
                        let timepoint = volume_registry_guard
                            .get_timepoint(&source_volume_id)
                            .unwrap_or(0);
                        info!("Extracting timepoint {} from 4D I8 volume", timepoint);
                        let extracted = extract_3d_volume_at_timepoint(volume_data, timepoint)?;
                        match extracted {
                            VolumeSendable::VolI8(vol, _) => render_service
                                .upload_volume_3d(&vol)
                                .map_err(|e| gpu_allocation_error(&ui_layer_id, &e.to_string()))?,
                            _ => {
                                return Err(BridgeError::Internal {
                                    code: 5014,
                                    details: "Unexpected volume type after 4D extraction"
                                        .to_string(),
                                })
                            }
                        }
                    }
                    VolumeSendable::Vec4DU16(_vec) => {
                        let timepoint = volume_registry_guard
                            .get_timepoint(&source_volume_id)
                            .unwrap_or(0);
                        info!("Extracting timepoint {} from 4D U16 volume", timepoint);
                        let extracted = extract_3d_volume_at_timepoint(volume_data, timepoint)?;
                        match extracted {
                            VolumeSendable::VolU16(vol, _) => render_service
                                .upload_volume_3d(&vol)
                                .map_err(|e| gpu_allocation_error(&ui_layer_id, &e.to_string()))?,
                            _ => {
                                return Err(BridgeError::Internal {
                                    code: 5014,
                                    details: "Unexpected volume type after 4D extraction"
                                        .to_string(),
                                })
                            }
                        }
                    }
                    VolumeSendable::Vec4DI32(_vec) => {
                        let timepoint = volume_registry_guard
                            .get_timepoint(&source_volume_id)
                            .unwrap_or(0);
                        info!("Extracting timepoint {} from 4D I32 volume", timepoint);
                        let extracted = extract_3d_volume_at_timepoint(volume_data, timepoint)?;
                        match extracted {
                            VolumeSendable::VolI32(vol, _) => render_service
                                .upload_volume_3d(&vol)
                                .map_err(|e| gpu_allocation_error(&ui_layer_id, &e.to_string()))?,
                            _ => {
                                return Err(BridgeError::Internal {
                                    code: 5014,
                                    details: "Unexpected volume type after 4D extraction"
                                        .to_string(),
                                })
                            }
                        }
                    }
                    VolumeSendable::Vec4DU32(_vec) => {
                        let timepoint = volume_registry_guard
                            .get_timepoint(&source_volume_id)
                            .unwrap_or(0);
                        info!("Extracting timepoint {} from 4D U32 volume", timepoint);
                        let extracted = extract_3d_volume_at_timepoint(volume_data, timepoint)?;
                        match extracted {
                            VolumeSendable::VolU32(vol, _) => render_service
                                .upload_volume_3d(&vol)
                                .map_err(|e| gpu_allocation_error(&ui_layer_id, &e.to_string()))?,
                            _ => {
                                return Err(BridgeError::Internal {
                                    code: 5014,
                                    details: "Unexpected volume type after 4D extraction"
                                        .to_string(),
                                })
                            }
                        }
                    }
                    VolumeSendable::Vec4DF64(_vec) => {
                        let timepoint = volume_registry_guard
                            .get_timepoint(&source_volume_id)
                            .unwrap_or(0);
                        info!("Extracting timepoint {} from 4D F64 volume", timepoint);
                        let extracted = extract_3d_volume_at_timepoint(volume_data, timepoint)?;
                        match extracted {
                            VolumeSendable::VolF64(vol, _) => render_service
                                .upload_volume_3d(&vol)
                                .map_err(|e| gpu_allocation_error(&ui_layer_id, &e.to_string()))?,
                            _ => {
                                return Err(BridgeError::Internal {
                                    code: 5014,
                                    details: "Unexpected volume type after 4D extraction"
                                        .to_string(),
                                })
                            }
                        }
                    }
                }
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

            // Store the mapping from UI layer ID to atlas layer index (only if GPU was allocated)
            if !metadata_only_flag {
                {
                    let mut layer_map = state.layer_to_atlas_map.lock().await;

                    // Debug logging for layer ID storage
                    info!("🔍 DEBUG: request_layer_gpu_resources - Storing layer mapping:");
                    info!("  - UI Layer ID: '{}'", ui_layer_id);
                    info!("  - Atlas Index: {}", atlas_layer_idx);
                    info!("  - UI Layer ID hash: {:x}", {
                        use std::collections::hash_map::DefaultHasher;
                        use std::hash::{Hash, Hasher};
                        let mut hasher = DefaultHasher::new();
                        ui_layer_id.hash(&mut hasher);
                        hasher.finish()
                    });

                    layer_map.insert(ui_layer_id.clone(), atlas_layer_idx);

                    info!("  - Map size after insert: {}", layer_map.len());
                    info!("  - All entries in layer_to_atlas_map:");
                    for (key, value) in layer_map.iter() {
                        info!("    '{}' -> {}", key, value);
                    }
                }

                {
                    // Also store the volume handle mapping
                    let mut volume_map = state.layer_to_volume_map.lock().await;
                    let LayerSpec::Volume(vol_spec) = &layer_spec;
                    volume_map.insert(ui_layer_id.clone(), vol_spec.source_resource_id.clone());
                }

                let lease = LayerLease::new(
                    ui_layer_id.clone(),
                    atlas_layer_idx,
                    Arc::clone(&state.render_loop_service),
                    Arc::clone(&state.layer_to_atlas_map),
                    Arc::clone(&state.layer_to_volume_map),
                );

                {
                    let mut lease_map = state.layer_leases.lock().await;
                    lease_map.insert(ui_layer_id.clone(), lease);
                }
            }

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

            info!("Volume center calculation: voxel [{:.1}, {:.1}, {:.1}] -> world [{:.1}, {:.1}, {:.1}]",
                  center_voxel.x, center_voxel.y, center_voxel.z,
                  center_world_coords[0], center_world_coords[1], center_world_coords[2]);

            // Debug the transform matrices - log in column-major format for nalgebra
            info!("Voxel Dims: {:?}", vol_dims);
            info!(
                "Center Voxel Input: [{:.1}, {:.1}, {:.1}, {:.1}]",
                center_voxel.x, center_voxel.y, center_voxel.z, center_voxel.w
            );
            info!("Voxel-to-world transform matrix (column-major):");
            for i in 0..4 {
                info!(
                    "  [{:.3}, {:.3}, {:.3}, {:.3}]",
                    voxel_to_world[(i, 0)],
                    voxel_to_world[(i, 1)],
                    voxel_to_world[(i, 2)],
                    voxel_to_world[(i, 3)]
                );
            }
            info!("World-to-voxel transform matrix (column-major):");
            for i in 0..4 {
                info!(
                    "  [{:.3}, {:.3}, {:.3}, {:.3}]",
                    world_to_voxel[(i, 0)],
                    world_to_voxel[(i, 1)],
                    world_to_voxel[(i, 2)],
                    world_to_voxel[(i, 3)]
                );
            }

            // Also log the affine directly
            info!("Original affine from NIfTI:");
            let affine_matrix = affine.to_homogeneous();
            for i in 0..4 {
                info!(
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

            info!("Successfully uploaded volume to GPU - layer_id: {}, atlas_layer: {}, dims: {:?}, format: {:?}",
                  ui_layer_id, atlas_layer_idx, vol_dims, gpu_format);
            info!(
                "Texture coordinates - u: [{:.4}, {:.4}], v: [{:.4}, {:.4}]",
                u_min, u_max, v_min, v_max
            );

            // --- Compute data range and binary-like flag ---
            let (min_val, max_val) = match volume_data {
                VolumeSendable::VolF32(vol, _) => {
                    let mut min = f32::MAX;
                    let mut max = f32::MIN;
                    for v in vol.data().iter() {
                        min = min.min(*v);
                        max = max.max(*v);
                    }
                    (min, max)
                }
                VolumeSendable::VolI16(vol, _) => {
                    let mut min = i16::MAX as f32;
                    let mut max = i16::MIN as f32;
                    for v in vol.data().iter() {
                        let val = *v as f32;
                        min = min.min(val);
                        max = max.max(val);
                    }
                    (min, max)
                }
                VolumeSendable::VolU8(vol, _) => {
                    let mut min = 255.0f32;
                    let mut max = 0.0f32;
                    for v in vol.data().iter() {
                        let val = *v as f32;
                        min = min.min(val);
                        max = max.max(val);
                    }
                    (min, max)
                }
                VolumeSendable::VolI8(vol, _) => {
                    let mut min = i8::MAX as f32;
                    let mut max = i8::MIN as f32;
                    for v in vol.data().iter() {
                        let val = *v as f32;
                        min = min.min(val);
                        max = max.max(val);
                    }
                    (min, max)
                }
                VolumeSendable::VolU16(vol, _) => {
                    let mut min = u16::MAX as f32;
                    let mut max = 0.0f32;
                    for v in vol.data().iter() {
                        let val = *v as f32;
                        min = min.min(val);
                        max = max.max(val);
                    }
                    (min, max)
                }
                VolumeSendable::VolI32(vol, _) => {
                    let mut min = i32::MAX as f32;
                    let mut max = i32::MIN as f32;
                    for v in vol.data().iter() {
                        let val = *v as f32;
                        min = min.min(val);
                        max = max.max(val);
                    }
                    (min, max)
                }
                VolumeSendable::VolU32(vol, _) => {
                    let mut min = u32::MAX as f32;
                    let mut max = 0.0f32;
                    for v in vol.data().iter() {
                        let val = *v as f32;
                        min = min.min(val);
                        max = max.max(val);
                    }
                    (min, max)
                }
                VolumeSendable::VolF64(vol, _) => {
                    let mut min = f32::MAX;
                    let mut max = f32::MIN;
                    for v in vol.data().iter() {
                        let val = *v as f32;
                        min = min.min(val);
                        max = max.max(val);
                    }
                    (min, max)
                }
                // 4D volumes - compute global min/max across all timepoints
                VolumeSendable::Vec4DF32(vec) => {
                    let mut min = f32::MAX;
                    let mut max = f32::MIN;
                    for &val in vec.data.iter() {
                        if !val.is_nan() {
                            min = min.min(val);
                            max = max.max(val);
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
                    for &val in vec.data.iter() {
                        let v = val as f32;
                        min = min.min(v);
                        max = max.max(v);
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
                    for &val in vec.data.iter() {
                        let v = val as f32;
                        min = min.min(v);
                        max = max.max(v);
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
                    for &val in vec.data.iter() {
                        let v = val as f32;
                        min = min.min(v);
                        max = max.max(v);
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
                    for &val in vec.data.iter() {
                        let v = val as f32;
                        min = min.min(v);
                        max = max.max(v);
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
                    for &val in vec.data.iter() {
                        let v = val as f32;
                        min = min.min(v);
                        max = max.max(v);
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
                    for &val in vec.data.iter() {
                        let v = val as f32;
                        min = min.min(v);
                        max = max.max(v);
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
                    for &val in vec.data.iter() {
                        let v = val as f32;
                        if !v.is_nan() {
                            min = min.min(v);
                            max = max.max(v);
                        }
                    }
                    if min > max {
                        (0.0, 1.0)
                    } else {
                        (min, max)
                    }
                }
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
                    info!("Successfully registered volume '{}' with atlas index {} for declarative API with data range ({}, {})",
                        source_volume_id, atlas_layer_idx, min_val, max_val);
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
                        volume_world_to_voxel.clone(),
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
                let (display_min, display_max) = if is_u8 {
                    (0.0, 1.0)
                } else if is_binary_like && max_val <= 1.0 {
                    (0.0, 1.0)
                } else {
                    (min_val, max_val)
                };

                info!("Added render layer {} with colormap {} (id {}) and intensity range ({}, {}) -> display range ({}, {})",
                      layer_index, vol_spec.colormap, colormap_id, min_val, max_val, display_min, display_max);
            }
            if is_binary_like {
                info!("Detected binary mask - using 0-1 display range");
            }

            // Store the mapping between UI layer ID and atlas index (only if GPU was allocated)
            if !metadata_only_flag {
                {
                    let mut layer_map = state.layer_to_atlas_map.lock().await;
                    info!(
                        "📌 STORING layer mapping: UI layer '{}' -> atlas index {}",
                        ui_layer_id, atlas_layer_idx
                    );
                    layer_map.insert(ui_layer_id.clone(), atlas_layer_idx);
                    info!(
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

                let lease = LayerLease::new(
                    ui_layer_id.clone(),
                    atlas_layer_idx,
                    Arc::clone(&state.render_loop_service),
                    Arc::clone(&state.layer_to_atlas_map),
                    Arc::clone(&state.layer_to_volume_map),
                );

                {
                    let mut lease_map = state.layer_leases.lock().await;
                    lease_map.insert(ui_layer_id.clone(), lease);
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
        match lease.release("manual").await? {
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

    // Release the atlas layer
    let removed_from_render_state = render_loop_service
        .remove_layer_by_atlas(atlas_layer_idx)
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

    render_loop_service.volume_atlas.free_layer(atlas_layer_idx);

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
async fn remote_mount_connect(
    request: RemoteMountConnectRequest,
    state: State<'_, BridgeState>,
) -> BridgeResult<RemoteMountConnectResult> {
    let normalized = normalize_remote_mount_request(request)?;
    let auth = select_remote_auth(&normalized)?;

    let connect_config = RemoteConnectConfig {
        host: normalized.host.clone(),
        port: normalized.port,
        user: normalized.user.clone(),
        auth,
        verify_host_key: normalized.verify_host_key,
        accept_unknown_host_keys: normalized.accept_unknown_host_keys,
        known_hosts_path: normalized.known_hosts_path.clone(),
        ..Default::default()
    };

    let context = PendingRemoteMountContext {
        request: normalized,
    };

    let outcome = RemoteClient::connect_interactive(connect_config)
        .await
        .map_err(|e| map_remotely_error(e, 8221))?;

    handle_remote_connect_outcome(state.inner(), context, outcome).await
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.remote_mount_respond_host_key")]
async fn remote_mount_respond_host_key(
    challenge_id: String,
    trust: bool,
    state: State<'_, BridgeState>,
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

    let outcome = remotely::respond_host_key(challenge_uuid, trust)
        .await
        .map_err(|e| map_remotely_error(e, 8224))?;

    handle_remote_connect_outcome(state.inner(), context, outcome).await
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.remote_mount_respond_auth")]
async fn remote_mount_respond_auth(
    conversation_id: String,
    responses: Vec<String>,
    state: State<'_, BridgeState>,
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

    let outcome = remotely::respond_auth(conversation_uuid, responses)
        .await
        .map_err(|e| map_remotely_error(e, 8227))?;

    handle_remote_connect_outcome(state.inner(), context, outcome).await
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
    }

    Ok(ReleaseResult {
        success: true,
        message: format!("Unmounted remote folder '{}'", mount.display_name),
    })
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

    // Check if already initialized
    {
        let service_lock = state.render_loop_service.lock().await;
        if service_lock.is_some() {
            info!("RenderLoopService already initialized");
            return Ok(());
        }
    }

    // Initialize the service
    let mut service = RenderLoopService::new()
        .await
        .context_bridge("initializing render loop service", 5005)?;

    // Load shaders
    service
        .load_shaders()
        .context_bridge("loading GPU shaders", 5011)?;

    // We're using offscreen rendering approach:
    // The render loop is initialized without a window surface
    // Rendering happens to an offscreen texture that gets read back
    // and sent to the frontend as image data

    info!("RenderLoopService initialized and shaders loaded successfully");

    // Store in state
    {
        let mut service_lock = state.render_loop_service.lock().await;
        *service_lock = Some(Arc::new(Mutex::new(service)));
    }

    Ok(())
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

// ViewPlaneUbo has been removed - view plane info is now encoded in frame vectors
// #[command]
// #[tracing::instrument(skip_all, err, name = "api.set_view_plane")]
// async fn set_view_plane(
//     plane_id: u32,
//     state: State<'_, BridgeState>
// ) -> BridgeResult<()> {
//     info!("Bridge: set_view_plane called with plane_id: {}", plane_id);
//
//     // Get render loop service
//     let service_guard = state.render_loop_service.lock().await;
//     let service_arc = service_guard.as_ref()
//         .map_err(|| BridgeError::ServiceNotInitialized {
//             code: 5006,
//             details: "GPU rendering service is not initialized. Please initialize the render loop first.".to_string()
//         })?;
//     let service = service_arc.lock().await;
//
//     // Update the view plane UBO
//     service.set_view_plane(plane_id);
//
//     Ok(())
// }

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

    // Get the volume from the registry
    let volume = {
        let registry = state.volume_registry.lock().await;
        match registry.get(&volume_handle) {
            Some(vol) => vol.clone(),
            None => {
                return Err(BridgeError::VolumeNotFound {
                    code: 4045,
                    details: format!("Volume {} not found in registry", volume_handle),
                });
            }
        }
    };

    // Compute histogram - extract data based on volume type
    let mut values: Vec<f32> = Vec::new();

    match &volume {
        VolumeSendable::VolF32(vol, _) => {
            for &val in vol.data().iter() {
                if !val.is_nan() && (!exclude_zeros || val != 0.0) {
                    values.push(val);
                }
            }
        }
        VolumeSendable::VolF64(vol, _) => {
            for &val in vol.data().iter() {
                let val_f32 = val as f32;
                if !val_f32.is_nan() && (!exclude_zeros || val_f32 != 0.0) {
                    values.push(val_f32);
                }
            }
        }
        VolumeSendable::VolI16(vol, _) => {
            for &val in vol.data().iter() {
                let val_f32 = val as f32;
                if !exclude_zeros || val != 0 {
                    values.push(val_f32);
                }
            }
        }
        VolumeSendable::VolI32(vol, _) => {
            for &val in vol.data().iter() {
                let val_f32 = val as f32;
                if !exclude_zeros || val != 0 {
                    values.push(val_f32);
                }
            }
        }
        VolumeSendable::VolU8(vol, _) => {
            for &val in vol.data().iter() {
                let val_f32 = val as f32;
                if !exclude_zeros || val != 0 {
                    values.push(val_f32);
                }
            }
        }
        VolumeSendable::VolU16(vol, _) => {
            for &val in vol.data().iter() {
                let val_f32 = val as f32;
                if !exclude_zeros || val != 0 {
                    values.push(val_f32);
                }
            }
        }
        VolumeSendable::VolU32(vol, _) => {
            for &val in vol.data().iter() {
                let val_f32 = val as f32;
                if !exclude_zeros || val != 0 {
                    values.push(val_f32);
                }
            }
        }
        VolumeSendable::VolI8(vol, _) => {
            for &val in vol.data().iter() {
                let val_f32 = val as f32;
                if !exclude_zeros || val != 0 {
                    values.push(val_f32);
                }
            }
        }
        // 4D volumes - compute histogram from current timepoint
        VolumeSendable::Vec4DF32(vec) => {
            // Get the current timepoint from the registry
            let timepoint = {
                let registry = state.volume_registry.lock().await;
                let volume_handle = {
                    let layer_map = state.layer_to_volume_map.lock().await;
                    layer_map.get(&layer_id).cloned().unwrap_or_default()
                };
                registry.get_timepoint(&volume_handle).unwrap_or(0)
            };

            info!(
                "Computing histogram for 4D F32 volume at timepoint {}",
                timepoint
            );

            // Extract the 3D volume at current timepoint
            let vol_3d = vec.volume(timepoint).map_err(|e| BridgeError::Internal {
                code: 5014,
                details: format!(
                    "Failed to extract timepoint {} for histogram: {}",
                    timepoint, e
                ),
            })?;

            // Compute histogram from the 3D volume
            for &val in vol_3d.data().iter() {
                if !val.is_nan() && (!exclude_zeros || val != 0.0) {
                    values.push(val);
                }
            }
        }
        VolumeSendable::Vec4DI16(vec) => {
            // Get the current timepoint from the registry
            let timepoint = {
                let registry = state.volume_registry.lock().await;
                let volume_handle = {
                    let layer_map = state.layer_to_volume_map.lock().await;
                    layer_map.get(&layer_id).cloned().unwrap_or_default()
                };
                registry.get_timepoint(&volume_handle).unwrap_or(0)
            };

            info!(
                "Computing histogram for 4D I16 volume at timepoint {}",
                timepoint
            );

            // Extract the 3D volume at current timepoint
            let vol_3d = vec.volume(timepoint).map_err(|e| BridgeError::Internal {
                code: 5014,
                details: format!(
                    "Failed to extract timepoint {} for histogram: {}",
                    timepoint, e
                ),
            })?;

            // Compute histogram from the 3D volume
            for &val in vol_3d.data().iter() {
                let val_f32 = val as f32;
                if !exclude_zeros || val != 0 {
                    values.push(val_f32);
                }
            }
        }
        VolumeSendable::Vec4DU8(vec) => {
            // Get the current timepoint from the registry
            let timepoint = {
                let registry = state.volume_registry.lock().await;
                let volume_handle = {
                    let layer_map = state.layer_to_volume_map.lock().await;
                    layer_map.get(&layer_id).cloned().unwrap_or_default()
                };
                registry.get_timepoint(&volume_handle).unwrap_or(0)
            };

            info!(
                "Computing histogram for 4D U8 volume at timepoint {}",
                timepoint
            );

            // Extract the 3D volume at current timepoint
            let vol_3d = vec.volume(timepoint).map_err(|e| BridgeError::Internal {
                code: 5014,
                details: format!(
                    "Failed to extract timepoint {} for histogram: {}",
                    timepoint, e
                ),
            })?;

            // Compute histogram from the 3D volume
            for &val in vol_3d.data().iter() {
                let val_f32 = val as f32;
                if !exclude_zeros || val != 0 {
                    values.push(val_f32);
                }
            }
        }
        VolumeSendable::Vec4DI8(vec) => {
            let timepoint = {
                let registry = state.volume_registry.lock().await;
                let volume_handle = {
                    let layer_map = state.layer_to_volume_map.lock().await;
                    layer_map.get(&layer_id).cloned().unwrap_or_default()
                };
                registry.get_timepoint(&volume_handle).unwrap_or(0)
            };
            let vol_3d = vec.volume(timepoint).map_err(|e| BridgeError::Internal {
                code: 5014,
                details: format!(
                    "Failed to extract timepoint {} for histogram: {}",
                    timepoint, e
                ),
            })?;
            for &val in vol_3d.data().iter() {
                let val_f32 = val as f32;
                if !exclude_zeros || val != 0 {
                    values.push(val_f32);
                }
            }
        }
        VolumeSendable::Vec4DU16(vec) => {
            let timepoint = {
                let registry = state.volume_registry.lock().await;
                let volume_handle = {
                    let layer_map = state.layer_to_volume_map.lock().await;
                    layer_map.get(&layer_id).cloned().unwrap_or_default()
                };
                registry.get_timepoint(&volume_handle).unwrap_or(0)
            };
            let vol_3d = vec.volume(timepoint).map_err(|e| BridgeError::Internal {
                code: 5014,
                details: format!(
                    "Failed to extract timepoint {} for histogram: {}",
                    timepoint, e
                ),
            })?;
            for &val in vol_3d.data().iter() {
                let val_f32 = val as f32;
                if !exclude_zeros || val != 0 {
                    values.push(val_f32);
                }
            }
        }
        VolumeSendable::Vec4DI32(vec) => {
            let timepoint = {
                let registry = state.volume_registry.lock().await;
                let volume_handle = {
                    let layer_map = state.layer_to_volume_map.lock().await;
                    layer_map.get(&layer_id).cloned().unwrap_or_default()
                };
                registry.get_timepoint(&volume_handle).unwrap_or(0)
            };
            let vol_3d = vec.volume(timepoint).map_err(|e| BridgeError::Internal {
                code: 5014,
                details: format!(
                    "Failed to extract timepoint {} for histogram: {}",
                    timepoint, e
                ),
            })?;
            for &val in vol_3d.data().iter() {
                let val_f32 = val as f32;
                if !exclude_zeros || val != 0 {
                    values.push(val_f32);
                }
            }
        }
        VolumeSendable::Vec4DU32(vec) => {
            let timepoint = {
                let registry = state.volume_registry.lock().await;
                let volume_handle = {
                    let layer_map = state.layer_to_volume_map.lock().await;
                    layer_map.get(&layer_id).cloned().unwrap_or_default()
                };
                registry.get_timepoint(&volume_handle).unwrap_or(0)
            };
            let vol_3d = vec.volume(timepoint).map_err(|e| BridgeError::Internal {
                code: 5014,
                details: format!(
                    "Failed to extract timepoint {} for histogram: {}",
                    timepoint, e
                ),
            })?;
            for &val in vol_3d.data().iter() {
                let val_f32 = val as f32;
                if !exclude_zeros || val != 0 {
                    values.push(val_f32);
                }
            }
        }
        VolumeSendable::Vec4DF64(vec) => {
            let timepoint = {
                let registry = state.volume_registry.lock().await;
                let volume_handle = {
                    let layer_map = state.layer_to_volume_map.lock().await;
                    layer_map.get(&layer_id).cloned().unwrap_or_default()
                };
                registry.get_timepoint(&volume_handle).unwrap_or(0)
            };
            let vol_3d = vec.volume(timepoint).map_err(|e| BridgeError::Internal {
                code: 5014,
                details: format!(
                    "Failed to extract timepoint {} for histogram: {}",
                    timepoint, e
                ),
            })?;
            for &val in vol_3d.data().iter() {
                let val_f32 = val as f32;
                if !exclude_zeros || val != 0.0 {
                    values.push(val_f32);
                }
            }
        }
    }

    if values.is_empty() {
        return Ok(HistogramResult {
            bins: vec![],
            total_count: 0,
            min_value: 0.0,
            max_value: 0.0,
            mean: 0.0,
            std: 0.0,
            bin_count: 0,
        });
    }

    // Calculate statistics
    let min_value = values.iter().cloned().fold(f32::INFINITY, f32::min);
    let max_value = values.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
    let total_count = values.len() as u64;
    let mean = values.iter().sum::<f32>() / values.len() as f32;

    info!(
        "Histogram data stats: total_values={}, min={}, max={}, mean={}",
        total_count, min_value, max_value, mean
    );

    // Calculate standard deviation
    let variance = values.iter().map(|&v| (v - mean).powi(2)).sum::<f32>() / values.len() as f32;
    let std = variance.sqrt();

    // Determine range for binning
    let (hist_min, hist_max) = if let Some(r) = range {
        if r.len() >= 2 {
            (r[0], r[1])
        } else {
            (min_value, max_value)
        }
    } else {
        (min_value, max_value)
    };

    // Create bins
    let bin_width = (hist_max - hist_min) / bin_count as f32;
    let mut bins = vec![0u64; bin_count as usize];

    // Fill bins
    for &val in values.iter() {
        if val >= hist_min && val <= hist_max {
            let bin_idx = ((val - hist_min) / bin_width) as usize;
            let bin_idx = bin_idx.min(bin_count as usize - 1); // Clamp to last bin
            bins[bin_idx] += 1;
        }
    }

    // Log bin distribution
    let non_zero_bins = bins.iter().filter(|&&count| count > 0).count();
    let max_bin_count = bins.iter().max().copied().unwrap_or(0);
    info!("Histogram binning: hist_range=[{}, {}], bin_width={}, non_zero_bins={}/{}, max_bin_count={}",
          hist_min, hist_max, bin_width, non_zero_bins, bin_count, max_bin_count);

    // Convert to result format
    let histogram_bins: Vec<HistogramBin> = bins
        .iter()
        .enumerate()
        .map(|(i, &count)| HistogramBin {
            x0: hist_min + (i as f32 * bin_width),
            x1: hist_min + ((i + 1) as f32 * bin_width),
            count,
        })
        .collect();

    Ok(HistogramResult {
        bins: histogram_bins,
        total_count,
        min_value,
        max_value,
        mean,
        std,
        bin_count,
    })
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.sample_world_coordinate")]
async fn sample_world_coordinate(
    handle_id: String,
    world_coords: Vec<f32>, // 3 elements for world position
    state: State<'_, BridgeState>,
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
        .get(&handle_id)
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
    let timepoint = registry.get_timepoint(&handle_id).unwrap_or(0);

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
#[command]
#[tracing::instrument(skip_all, err, name = "api.sample_layer_value_at_world")]
async fn sample_layer_value_at_world(
    layer_id: String,
    world_coords: Vec<f32>,
    state: State<'_, BridgeState>,
) -> BridgeResult<f32> {
    if world_coords.len() != 3 {
        return Err(BridgeError::Input {
            code: 2016,
            details: "world_coords must be [x, y, z] in mm".to_string(),
        });
    }

    let handle_id = {
        let map = state.layer_to_volume_map.lock().await;
        map.get(&layer_id)
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
    sample_world_coordinate(handle_id, world_coords, state).await
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
    let volume_data =
        volume_registry_guard
            .get(volume_id)
            .ok_or_else(|| BridgeError::VolumeNotFound {
                code: 4042,
                details: format!(
                    "Volume '{}' not found. Please load the volume first.",
                    volume_id
                ),
            })?;

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

    // Calculate min/max values and upload to GPU
    let (atlas_idx, world_to_voxel, min_val, max_val) = match volume_to_upload.as_ref() {
        VolumeSendable::VolF32(vol, _) => {
            let (idx, w2v) = render_service
                .upload_volume_3d(vol)
                .map_err(|e| gpu_allocation_error(layer_id, &e.to_string()))?;
            let mut min = f32::MAX;
            let mut max = f32::MIN;
            for v in vol.data().iter() {
                if v.is_finite() {
                    min = min.min(*v);
                    max = max.max(*v);
                }
            }
            (idx, w2v, min, max)
        }
        VolumeSendable::VolI16(vol, _) => {
            let (idx, w2v) = render_service
                .upload_volume_3d(vol)
                .map_err(|e| gpu_allocation_error(layer_id, &e.to_string()))?;
            let mut min = i16::MAX as f32;
            let mut max = i16::MIN as f32;
            for v in vol.data().iter() {
                let val = *v as f32;
                min = min.min(val);
                max = max.max(val);
            }
            (idx, w2v, min, max)
        }
        VolumeSendable::VolU8(vol, _) => {
            let (idx, w2v) = render_service
                .upload_volume_3d(vol)
                .map_err(|e| gpu_allocation_error(layer_id, &e.to_string()))?;
            let mut min = 255.0f32;
            let mut max = 0.0f32;
            for v in vol.data().iter() {
                let val = *v as f32;
                min = min.min(val);
                max = max.max(val);
            }
            (idx, w2v, min, max)
        }
        VolumeSendable::VolI8(vol, _) => {
            let (idx, w2v) = render_service
                .upload_volume_3d(vol)
                .map_err(|e| gpu_allocation_error(layer_id, &e.to_string()))?;
            let mut min = i8::MAX as f32;
            let mut max = i8::MIN as f32;
            for v in vol.data().iter() {
                let val = *v as f32;
                min = min.min(val);
                max = max.max(val);
            }
            (idx, w2v, min, max)
        }
        VolumeSendable::VolU16(vol, _) => {
            let (idx, w2v) = render_service
                .upload_volume_3d(vol)
                .map_err(|e| gpu_allocation_error(layer_id, &e.to_string()))?;
            let mut min = u16::MAX as f32;
            let mut max = 0.0f32;
            for v in vol.data().iter() {
                let val = *v as f32;
                min = min.min(val);
                max = max.max(val);
            }
            (idx, w2v, min, max)
        }
        VolumeSendable::VolI32(vol, _) => {
            let (idx, w2v) = render_service
                .upload_volume_3d(vol)
                .map_err(|e| gpu_allocation_error(layer_id, &e.to_string()))?;
            let mut min = i32::MAX as f32;
            let mut max = i32::MIN as f32;
            for v in vol.data().iter() {
                let val = *v as f32;
                min = min.min(val);
                max = max.max(val);
            }
            (idx, w2v, min, max)
        }
        VolumeSendable::VolU32(vol, _) => {
            let (idx, w2v) = render_service
                .upload_volume_3d(vol)
                .map_err(|e| gpu_allocation_error(layer_id, &e.to_string()))?;
            let mut min = u32::MAX as f32;
            let mut max = 0.0f32;
            for v in vol.data().iter() {
                let val = *v as f32;
                min = min.min(val);
                max = max.max(val);
            }
            (idx, w2v, min, max)
        }
        VolumeSendable::VolF64(vol, _) => {
            let (idx, w2v) = render_service
                .upload_volume_3d(vol)
                .map_err(|e| gpu_allocation_error(layer_id, &e.to_string()))?;
            let mut min = f32::MAX;
            let mut max = f32::MIN;
            for v in vol.data().iter() {
                let val = *v as f32;
                min = min.min(val);
                max = max.max(val);
            }
            (idx, w2v, min, max)
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

    info!(
        "On-demand allocation computed data range: ({}, {})",
        min_val, max_val
    );

    // Store the mapping
    {
        let mut layer_map = state.layer_to_atlas_map.lock().await;
        info!(
            "📌 STORING in allocate_gpu_resources_for_layer: layer '{}' -> atlas index {}",
            layer_id, atlas_idx
        );
        layer_map.insert(layer_id.to_string(), atlas_idx);
        info!(
            "📌 Layer map now contains {} entries: {:?}",
            layer_map.len(),
            layer_map.keys().collect::<Vec<_>>()
        );

        // Also store the volume handle mapping
        let mut volume_map = state.layer_to_volume_map.lock().await;
        volume_map.insert(layer_id.to_string(), volume_id.to_string());
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
            warn!("🔍 Found layer via case-insensitive volume_id match: '{}' -> {} (actual key: '{}')",
                  volume_id, idx, key);
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

// Internal implementation that supports both PNG and raw RGBA output
async fn render_view_process(
    view_state_json: String,
    bridge_state: &BridgeState,
    format: RenderFormat,
) -> BridgeResult<Vec<u8>> {
    let state = bridge_state;
    // Note: This function is called both directly (JSON path) and from apply_and_render_view_state_binary
    // Check the caller to log appropriately

    let total_start = std::time::Instant::now();

    // Parse the frontend ViewState JSON
    let parse_start = std::time::Instant::now();
    #[derive(Deserialize, Debug)]
    struct FrontendViewState {
        views: FrontendViews,
        crosshair: CrosshairState,
        layers: Vec<LayerState>,
        #[serde(rename = "requestedView")]
        requested_view: Option<RequestedView>,
        // Current timepoint for 4D volumes
        timepoint: Option<usize>,
    }

    #[derive(Deserialize, Debug)]
    struct RequestedView {
        #[serde(rename = "type")]
        view_type: String,
        origin_mm: [f32; 4],
        u_mm: [f32; 4],
        v_mm: [f32; 4],
        width: u32,
        height: u32,
    }

    #[derive(Deserialize, Debug)]
    struct FrontendViews {
        axial: ViewPlane,
        sagittal: ViewPlane,
        coronal: ViewPlane,
    }

    #[derive(Deserialize, Debug)]
    struct ViewPlane {
        origin_mm: [f32; 3],
        u_mm: [f32; 3],
        v_mm: [f32; 3],
    }

    #[derive(Deserialize, Debug)]
    struct CrosshairState {
        world_mm: [f32; 3],
        visible: bool,
    }

    #[derive(Deserialize, Debug)]
    struct LayerState {
        id: String,
        #[serde(rename = "volumeId")]
        volume_id: String,
        visible: bool,
        opacity: f32,
        colormap: String,
        intensity: [f32; 2],
        threshold: [f32; 2],
        #[serde(rename = "blendMode")]
        blend_mode: String,
        #[serde(default = "default_interpolation")]
        interpolation: String,
    }

    fn default_interpolation() -> String {
        "linear".to_string()
    }

    // Log the first 500 chars of the JSON for debugging
    info!(
        "Received ViewState JSON (first 500 chars): {}",
        &view_state_json.chars().take(500).collect::<String>()
    );

    let frontend_state: FrontendViewState =
        match serde_json::from_str::<FrontendViewState>(&view_state_json) {
            Ok(state) => {
                info!(
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

    info!("⏱️  JSON parsing took: {:?}", parse_time);
    info!(
        "Parsed frontend ViewState with {} layers",
        frontend_state.layers.len()
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

    // Extract dimensions from requestedView if provided, otherwise use defaults
    // This supports per-view render targets instead of global render targets
    let (view_plane, width, height) = if let Some(req_view) = &frontend_state.requested_view {
        info!(
            "Using requested view '{}' with dimensions {}x{}",
            req_view.view_type, req_view.width, req_view.height
        );
        // The requested view already has the complete frame parameters, so we'll use them directly
        // For now, we still need a view_plane reference for compatibility
        match req_view.view_type.as_str() {
            "sagittal" => (
                &frontend_state.views.sagittal,
                req_view.width,
                req_view.height,
            ),
            "coronal" => (
                &frontend_state.views.coronal,
                req_view.width,
                req_view.height,
            ),
            _ => (&frontend_state.views.axial, req_view.width, req_view.height),
        }
    } else {
        info!("No specific view requested, using axial view with default dimensions");
        (&frontend_state.views.axial, 512u32, 512u32)
    };

    // Create render target with the specific dimensions for this view
    // This replaces the global render target approach with per-view render targets
    info!(
        "Creating render target for dimensions: {}x{}",
        width, height
    );
    service
        .create_offscreen_target(width, height)
        .map_err(|e| BridgeError::GpuError {
            code: 5021,
            details: format!(
                "Failed to create per-view render target ({}x{}): {}",
                width, height, e
            ),
        })?;

    // Convert frontend ViewState to backend ViewState format
    // Build layers for backend ViewState
    let mut backend_layers = Vec::new();

    // Debug: log the contents of layer_map
    {
        let layer_map = bridge_state.layer_to_atlas_map.lock().await;
        info!("Current layer_to_atlas_map contents:");
        for (layer_id, atlas_idx) in layer_map.iter() {
            info!("  Layer ID '{}' -> atlas index {}", layer_id, atlas_idx);
        }
    }

    let layer_processing_start = std::time::Instant::now();
    for layer in &frontend_state.layers {
        info!("🔍 DEBUG: apply_and_render_view_state_internal - Processing layer:");
        info!("  - Layer ID: '{}'", layer.id);
        info!("  - Volume ID: '{}'", layer.volume_id);
        info!("  - Visible: {}, Opacity: {}", layer.visible, layer.opacity);
        info!("  - Layer ID hash: {:x}", {
            use std::collections::hash_map::DefaultHasher;
            use std::hash::{Hash, Hasher};
            let mut hasher = DefaultHasher::new();
            layer.id.hash(&mut hasher);
            hasher.finish()
        });

        // Check both layer.id and layer.volume_id to ensure we find the layer
        if layer.visible && layer.opacity > 0.0 {
            info!(
                "  Layer passes visibility check (visible={}, opacity={})",
                layer.visible, layer.opacity
            );
            // Check if this layer has GPU resources allocated
            let _atlas_idx = {
                let layer_map = bridge_state.layer_to_atlas_map.lock().await;

                info!(
                    "  - Searching in layer_map with {} entries",
                    layer_map.len()
                );
                info!("  - All keys in map:");
                for key in layer_map.keys() {
                    info!("    Key: '{}'", key);
                }

                // Try multiple strategies to find the layer
                let found_idx =
                    find_layer_atlas_index_robust(&layer_map, &layer.id, &layer.volume_id);

                if let Some(idx) = found_idx {
                    info!(
                        "✅ CACHE HIT: Layer {} already has GPU resources at atlas index {}",
                        layer.id, idx
                    );
                    idx
                } else {
                    info!("❌ CACHE MISS: Layer '{}' not found in layer_map (tried keys: '{}' and '{}')",
                          layer.id, layer.id, layer.volume_id);
                    info!(
                        "❌ Current layer_map contains {} entries: {:?}",
                        layer_map.len(),
                        layer_map.keys().collect::<Vec<_>>()
                    );

                    drop(layer_map); // Release the lock before allocating

                    // Allocate GPU resources on-demand
                    info!(
                        "Allocating GPU resources on-demand for layer '{}', volume '{}'",
                        layer.id, layer.volume_id
                    );

                    let gpu_alloc_start = std::time::Instant::now();
                    // Allocate GPU resources for this layer
                    let gpu_info = allocate_gpu_resources_for_layer(
                        &layer.id,
                        &layer.volume_id,
                        bridge_state,
                        &mut service,
                        frontend_state.timepoint,
                    )
                    .await?;
                    let gpu_alloc_time = gpu_alloc_start.elapsed();
                    info!("⏱️  GPU resource allocation took: {:?}", gpu_alloc_time);

                    let allocated_idx = gpu_info.atlas_layer_index;
                    info!(
                        "Layer {} allocated GPU resources at atlas index {}",
                        layer.id, allocated_idx
                    );
                    allocated_idx
                }
            };

            // Volume should already be registered by allocate_gpu_resources_for_layer
            // with the correct data range, so we don't need to register it again

            // Map colormap name to ID using the centralized colormap system
            let colormap_id = match colormap_by_name(&layer.colormap) {
                Some(id) => id.id() as u32,
                None => {
                    warn!(
                        "Unknown colormap '{}', defaulting to grayscale",
                        layer.colormap
                    );
                    0 // Default to grayscale
                }
            };

            // Map blend mode
            let blend_mode = match layer.blend_mode.as_str() {
                "alpha" => render_loop::render_state::BlendMode::Normal,
                "additive" => render_loop::render_state::BlendMode::Additive,
                "maximum" => render_loop::render_state::BlendMode::Maximum,
                "minimum" => render_loop::render_state::BlendMode::Normal, // Minimum not implemented, use Normal
                _ => render_loop::render_state::BlendMode::Normal,
            };

            // Parse interpolation mode
            let interpolation = match layer.interpolation.as_str() {
                "nearest" => render_loop::view_state::InterpolationMode::Nearest,
                "cubic" => render_loop::view_state::InterpolationMode::Cubic,
                _ => render_loop::view_state::InterpolationMode::Linear, // Default to linear
            };

            // Create backend layer config
            let mut backend_layer = render_loop::view_state::LayerConfig {
                volume_id: layer.volume_id.clone(),
                opacity: layer.opacity,
                colormap_id,
                blend_mode,
                intensity_window: (layer.intensity[0], layer.intensity[1]),
                threshold: if layer.threshold[0] != 0.0 || layer.threshold[1] != 100.0 {
                    Some(render_loop::view_state::ThresholdConfig {
                        mode: render_loop::render_state::ThresholdMode::Range,
                        range: (layer.threshold[0], layer.threshold[1]),
                    })
                } else {
                    None
                },
                visible: layer.visible,
                interpolation,
            };

            info!("Adding layer to backend ViewState: volume_id={}, opacity={}, colormap={}, intensity=[{}, {}], threshold=[{}, {}]",
                backend_layer.volume_id, backend_layer.opacity, backend_layer.colormap_id,
                backend_layer.intensity_window.0, backend_layer.intensity_window.1,
                layer.threshold[0], layer.threshold[1]);

            // Use intensity values directly from frontend - frontend is the single source of truth
            // No validation or modification needed - trust the user's input
            backend_layer.intensity_window = (layer.intensity[0], layer.intensity[1]);

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

    // CRITICAL: Check if we have any layers before proceeding
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

        // Return a dark image instead of erroring
        let width = width as usize;
        let height = height as usize;
        let mut dark_image = vec![30u8; width * height * 4]; // Dark gray RGBA

        // Add a red border to indicate error state
        for y in 0..height {
            for x in 0..width {
                if x < 2 || x >= width - 2 || y < 2 || y >= height - 2 {
                    let idx = (y * width + x) * 4;
                    dark_image[idx] = 128; // R
                    dark_image[idx + 1] = 0; // G
                    dark_image[idx + 2] = 0; // B
                    dark_image[idx + 3] = 255; // A
                }
            }
        }

        // Convert to PNG
        use image::codecs::png::PngEncoder;
        use image::{ImageBuffer, ImageEncoder, Rgba};
        use std::io::Cursor;

        let img_buffer: ImageBuffer<Rgba<u8>, Vec<u8>> =
            ImageBuffer::from_raw(width as u32, height as u32, dark_image).ok_or_else(|| {
                BridgeError::Internal {
                    code: 5024,
                    details: "Failed to create error image buffer".to_string(),
                }
            })?;

        let mut png_data = Vec::new();
        let encoder = PngEncoder::new(Cursor::new(&mut png_data));
        encoder
            .write_image(
                img_buffer.as_raw(),
                width as u32,
                height as u32,
                image::ExtendedColorType::Rgba8,
            )
            .map_err(|e| BridgeError::Internal {
                code: 5025,
                details: format!("Failed to encode error PNG: {}", e),
            })?;

        warn!("Returning error image (dark with red border) due to no layers");
        return Ok(png_data);
    }

    // Create backend ViewState with exact frame parameters
    let backend_view_state = render_loop::view_state::ViewState {
        layout_version: render_loop::view_state::ViewState::CURRENT_VERSION,
        camera: render_loop::view_state::CameraState {
            world_center: frontend_state.crosshair.world_mm,
            fov_mm: 256.0, // Default FOV
            orientation: if let Some(req_view) = &frontend_state.requested_view {
                match req_view.view_type.as_str() {
                    "sagittal" => render_loop::view_state::SliceOrientation::Sagittal,
                    "coronal" => render_loop::view_state::SliceOrientation::Coronal,
                    _ => render_loop::view_state::SliceOrientation::Axial,
                }
            } else {
                render_loop::view_state::SliceOrientation::Axial
            },
            // Use exact frame parameters - from requestedView if available, otherwise from view_plane
            frame_origin: if let Some(req_view) = &frontend_state.requested_view {
                Some(req_view.origin_mm)
            } else {
                Some([
                    view_plane.origin_mm[0],
                    view_plane.origin_mm[1],
                    view_plane.origin_mm[2],
                    1.0,
                ])
            },
            frame_u_vec: if let Some(req_view) = &frontend_state.requested_view {
                Some(req_view.u_mm)
            } else {
                Some([
                    view_plane.u_mm[0],
                    view_plane.u_mm[1],
                    view_plane.u_mm[2],
                    0.0,
                ])
            },
            frame_v_vec: if let Some(req_view) = &frontend_state.requested_view {
                Some(req_view.v_mm)
            } else {
                Some([
                    view_plane.v_mm[0],
                    view_plane.v_mm[1],
                    view_plane.v_mm[2],
                    0.0,
                ])
            },
        },
        crosshair_world: frontend_state.crosshair.world_mm,
        layers: backend_layers,
        viewport_size: [width, height],
        show_crosshair: false, // Disabled per architecture decision - crosshairs should be UI-only
        timepoint: frontend_state.timepoint,
    };

    info!(
        "Created backend ViewState with {} layers, crosshair at {:?}",
        backend_view_state.layers.len(),
        backend_view_state.crosshair_world
    );

    // Debug: Log the exact frame parameters being used
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

    // Log frame parameters
    info!(
        "Frame parameters - origin: {:?}, u: {:?}, v: {:?}",
        view_plane.origin_mm, view_plane.u_mm, view_plane.v_mm
    );

    // Stop layer processing timer
    let layer_processing_time = layer_processing_start.elapsed();
    info!("⏱️  Layer processing took: {:?}", layer_processing_time);

    // Apply frame parameters from ViewState if available
    if let (Some(origin), Some(u_vec), Some(v_vec)) = (
        backend_view_state.camera.frame_origin,
        backend_view_state.camera.frame_u_vec,
        backend_view_state.camera.frame_v_vec,
    ) {
        info!("Applying frame parameters before rendering");
        service.update_frame_ubo(origin, u_vec, v_vec);
    }

    // Use request_frame API to render with the declarative ViewState
    let render_start = std::time::Instant::now();
    let frame_result = service
        .request_frame(
            render_loop::view_state::ViewId::new("frontend_view"),
            backend_view_state,
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

    // Debug: Sample pixels to detect black images
    if frame_result.image_data.len() >= 400 {
        let width = frame_result.dimensions[0] as usize;
        let height = frame_result.dimensions[1] as usize;

        // Sample center pixel
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

        // Count non-black pixels in a 10x10 grid
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

    // Get dimensions from frame result
    let width = frame_result.dimensions[0];
    let height = frame_result.dimensions[1];
    let rgba_data = frame_result.image_data;

    // Choose output format based on flag
    let result = if format == RenderFormat::RawRgba {
        // Raw RGBA path - no PNG encoding
        info!("🚀 RAW RGBA: Skipping PNG encoding, returning raw pixel data");

        // Create a buffer with format: [width: u32][height: u32][rgba_data...]
        let mut raw_buffer = Vec::with_capacity(8 + rgba_data.len());

        // Write dimensions as little-endian u32
        raw_buffer.extend_from_slice(&width.to_le_bytes());
        raw_buffer.extend_from_slice(&height.to_le_bytes());

        // Append RGBA data
        raw_buffer.extend_from_slice(&rgba_data);

        info!(
            "🚀 RAW RGBA: Returning {} bytes (8 byte header + {} RGBA bytes)",
            raw_buffer.len(),
            rgba_data.len()
        );

        raw_buffer
    } else {
        // PNG encoding path
        let png_encode_start = std::time::Instant::now();
        use image::codecs::png::PngEncoder;
        use image::{ImageBuffer, ImageEncoder, Rgba};
        use std::io::Cursor;

        // Create an image buffer from the RGBA data
        let img_buffer: ImageBuffer<Rgba<u8>, Vec<u8>> =
            ImageBuffer::from_raw(width, height, rgba_data).ok_or_else(|| {
                BridgeError::Internal {
                    code: 5022,
                    details: format!(
                        "Failed to create image buffer from RGBA data. Width: {}, Height: {}",
                        width, height
                    ),
                }
            })?;

        // Encode to PNG with fast compression settings
        let mut png_data = Vec::new();
        let encoder = PngEncoder::new_with_quality(
            Cursor::new(&mut png_data),
            image::codecs::png::CompressionType::Fast,
            image::codecs::png::FilterType::NoFilter,
        );
        encoder
            .write_image(
                img_buffer.as_raw(),
                width,
                height,
                image::ExtendedColorType::Rgba8,
            )
            .map_err(|e| BridgeError::Internal {
                code: 5023,
                details: format!("Failed to encode PNG: {}", e),
            })?;

        let png_encode_time = png_encode_start.elapsed();
        info!("⏱️  PNG encoding took: {:?}", png_encode_time);
        info!(
            "Backend: Encoded RGBA to PNG - {} bytes ({}x{})",
            png_data.len(),
            width,
            height
        );

        png_data
    };

    let total_time = total_start.elapsed();
    info!(
        "⏱️  TOTAL apply_and_render_view_state_internal time: {:?}",
        total_time
    );
    info!(
        "⏱️  Mode: {}, Total size: {} bytes",
        if format == RenderFormat::RawRgba {
            "RAW RGBA"
        } else {
            "PNG"
        },
        result.len()
    );

    Ok(result)
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

struct MultiViewPacketEntry {
    view_code: u8,
    width: u32,
    height: u32,
    payload: Vec<u8>,
}

fn encode_view_type(view_type: &str) -> BridgeResult<u8> {
    match view_type.to_lowercase().as_str() {
        "axial" => Ok(0),
        "sagittal" => Ok(1),
        "coronal" => Ok(2),
        other => Err(BridgeError::Input {
            code: 4101,
            details: format!("Unsupported view type '{}'", other),
        }),
    }
}

async fn render_views_process(
    state_json: String,
    bridge_state: &BridgeState,
    format: RenderFormat,
) -> BridgeResult<Vec<u8>> {
    let parsed_state: JsonValue =
        serde_json::from_str(&state_json).map_err(|err| BridgeError::Input {
            code: 4100,
            details: format!("Failed to parse view state JSON: {}", err),
        })?;

    let requested_views = match parsed_state.get("requestedViews") {
        Some(JsonValue::Array(requests)) if !requests.is_empty() => requests.clone(),
        _ => {
            return Err(BridgeError::Input {
                code: 4102,
                details: "render_views expects a non-empty 'requestedViews' array".to_string(),
            })
        }
    };

    // Base state without requestedView(s) so we can inject per request
    let mut base_state = parsed_state.clone();
    if let Some(obj) = base_state.as_object_mut() {
        obj.remove("requestedViews");
        obj.remove("requestedView");
    }

    let mut entries: Vec<MultiViewPacketEntry> = Vec::with_capacity(requested_views.len());

    for request in requested_views {
        let view_type = request
            .get("type")
            .and_then(|v| v.as_str())
            .ok_or_else(|| BridgeError::Input {
                code: 4103,
                details: "Each requested view must include a 'type' string".to_string(),
            })?;
        let view_code = encode_view_type(view_type)?;

        let width = request
            .get("width")
            .and_then(|v| v.as_u64())
            .ok_or_else(|| BridgeError::Input {
                code: 4104,
                details: format!("Requested view '{}' missing numeric 'width'", view_type),
            })? as u32;

        let height = request
            .get("height")
            .and_then(|v| v.as_u64())
            .ok_or_else(|| BridgeError::Input {
                code: 4105,
                details: format!("Requested view '{}' missing numeric 'height'", view_type),
            })? as u32;

        let mut state_for_view = base_state.clone();
        if let Some(obj) = state_for_view.as_object_mut() {
            obj.insert("requestedView".to_string(), request.clone());
        }

        let state_payload =
            serde_json::to_string(&state_for_view).map_err(|err| BridgeError::Internal {
                code: 5101,
                details: format!("Failed to serialize view state: {}", err),
            })?;

        let render_bytes = render_view_process(state_payload, bridge_state, format).await?;

        if format == RenderFormat::RawRgba {
            if render_bytes.len() < 8 {
                return Err(BridgeError::Internal {
                    code: 5102,
                    details: format!(
                        "render_view returned insufficient data for view '{}'",
                        view_type
                    ),
                });
            }

            let w_bytes: [u8; 4] = render_bytes[0..4].try_into().unwrap();
            let h_bytes: [u8; 4] = render_bytes[4..8].try_into().unwrap();
            let actual_width = u32::from_le_bytes(w_bytes);
            let actual_height = u32::from_le_bytes(h_bytes);
            let payload = render_bytes[8..].to_vec();

            entries.push(MultiViewPacketEntry {
                view_code,
                width: actual_width,
                height: actual_height,
                payload,
            });
        } else {
            entries.push(MultiViewPacketEntry {
                view_code,
                width,
                height,
                payload: render_bytes,
            });
        }
    }

    let mut packet = Vec::new();
    packet.extend_from_slice(&(entries.len() as u32).to_le_bytes());

    for entry in &entries {
        packet.push(entry.view_code);
        packet.extend_from_slice(&entry.width.to_le_bytes());
        packet.extend_from_slice(&entry.height.to_le_bytes());
        let len_u32: u32 = entry
            .payload
            .len()
            .try_into()
            .map_err(|_| BridgeError::Internal {
                code: 5103,
                details: "Payload too large to encode in response".to_string(),
            })?;
        packet.extend_from_slice(&len_u32.to_le_bytes());
    }

    for entry in entries {
        packet.extend_from_slice(&entry.payload);
    }

    Ok(packet)
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

#[command]
#[tracing::instrument(skip_all, err, name = "api.render_views")]
async fn render_views(
    state_json: String,
    format: Option<String>,
    state: State<'_, BridgeState>,
) -> Result<tauri::ipc::Response, BridgeError> {
    info!("🎨 render_views called with format: {:?}", format);
    let render_format = format
        .as_ref()
        .and_then(|f| RenderFormat::from_str(f))
        .unwrap_or(RenderFormat::RawRgba);

    let start_time = std::time::Instant::now();
    let bridge_state: &BridgeState = state.inner();
    match render_views_process(state_json, bridge_state, render_format).await {
        Ok(result) => {
            info!(
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
    info!("🎨 render_view called with format: {:?}", format);
    info!("🎨 state_json length: {} bytes", state_json.len());

    // Log first 200 chars of JSON for debugging
    let preview = if state_json.len() > 200 {
        format!("{}...", &state_json[..200])
    } else {
        state_json.clone()
    };
    info!("🎨 state_json preview: {}", preview);

    let render_format = format
        .as_ref()
        .and_then(|f| RenderFormat::from_str(f))
        .unwrap_or(RenderFormat::RawRgba);

    info!("🎨 Using render format: {:?}", render_format);

    // Add timing and detailed error context
    let start_time = std::time::Instant::now();
    let bridge_state: &BridgeState = state.inner();
    match render_view_process(state_json, bridge_state, render_format).await {
        Ok(result) => {
            info!(
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

// DEPRECATED: Use render_view instead
// Public command for PNG output (default, legacy path)
// This method returns PNG data but serializes it as JSON, which is very inefficient
#[command]
#[tracing::instrument(skip_all, err, name = "api.apply_and_render_view_state")]
async fn apply_and_render_view_state(
    view_state_json: String,
    state: State<'_, BridgeState>,
) -> BridgeResult<Vec<u8>> {
    info!("📊 LEGACY: apply_and_render_view_state called (PNG with JSON serialization)");
    // Delegate to new internal implementation
    render_view_process(view_state_json, state.inner(), RenderFormat::Png).await
}

// DEPRECATED: Use render_view with format="png" instead
// Binary-optimized version that returns PNG with binary IPC
// Better than apply_and_render_view_state but still encodes to PNG
#[command]
#[tracing::instrument(skip_all, err, name = "api.apply_and_render_view_state_binary")]
async fn apply_and_render_view_state_binary(
    view_state_json: String,
    state: State<'_, BridgeState>,
) -> Result<tauri::ipc::Response, BridgeError> {
    info!("🚀 LEGACY: apply_and_render_view_state_binary called (PNG with binary IPC)");
    // Delegate to render_view with PNG format
    render_view(view_state_json, Some("png".to_string()), state).await
}

// DEPRECATED: Use render_view with format="rgba" instead
// Raw RGBA version - no PNG encoding, just raw pixel data
// This is the most efficient of the legacy methods
#[command]
#[tracing::instrument(skip_all, err, name = "api.apply_and_render_view_state_raw")]
async fn apply_and_render_view_state_raw(
    view_state_json: String,
    state: State<'_, BridgeState>,
) -> Result<tauri::ipc::Response, BridgeError> {
    info!("🚀 LEGACY: apply_and_render_view_state_raw called");
    // Delegate to render_view with RGBA format
    render_view(view_state_json, Some("rgba".to_string()), state).await
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
            })
        }
    };

    Ok(SliceAxisMeta {
        slice_count,
        slice_spacing,
        axis_length_mm: axis_length,
    })
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
                                                    error!("ViewState[{}].layers[{}].threshold has invalid type: {:?}",
                                                           idx, layer_idx, threshold);
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

    info!(
        "Batch render: {} slices at {}x{} each",
        view_states.len(),
        batch_request.width_per_slice,
        batch_request.height_per_slice
    );

    // Verify render service is initialized (but we don't need to lock it here)
    let service_guard = state.render_loop_service.lock().await;
    if service_guard.is_none() {
        return Err(BridgeError::ServiceNotInitialized {
            code: 5006,
            details:
                "GPU rendering service is not initialized. Please initialize the render loop first."
                    .to_string(),
        });
    }
    drop(service_guard); // Release the lock early

    let render_start = std::time::Instant::now();

    // Calculate total buffer size
    let slice_count = view_states.len() as u32;
    let bytes_per_slice =
        (batch_request.width_per_slice * batch_request.height_per_slice * 4) as usize; // RGBA
    let total_buffer_size = 4 + 4 + 4 + (bytes_per_slice * slice_count as usize); // header + data

    let mut result_buffer = Vec::with_capacity(total_buffer_size);

    // Write header: [width][height][slice_count]
    result_buffer.extend_from_slice(&batch_request.width_per_slice.to_le_bytes());
    result_buffer.extend_from_slice(&batch_request.height_per_slice.to_le_bytes());
    result_buffer.extend_from_slice(&slice_count.to_le_bytes());

    // Render each slice directly using the render_loop service
    for (idx, view_state) in view_states.iter().enumerate() {
        info!(
            "Rendering slice {} of {} with ViewState",
            idx + 1,
            view_states.len()
        );

        // Get render loop service
        let service_guard = state.render_loop_service.lock().await;
        let service_arc =
            service_guard
                .as_ref()
                .ok_or_else(|| BridgeError::ServiceNotInitialized {
                    code: 5006,
                    details: "GPU rendering service is not initialized".to_string(),
                })?;
        let mut service = service_arc.lock().await;

        // Create render target for this slice
        service
            .create_offscreen_target(
                batch_request.width_per_slice,
                batch_request.height_per_slice,
            )
            .map_err(|e| BridgeError::GpuError {
                code: 5021,
                details: format!("Failed to create render target: {}", e),
            })?;

        // Apply frame parameters if available
        if let (Some(origin), Some(u_vec), Some(v_vec)) = (
            view_state.camera.frame_origin,
            view_state.camera.frame_u_vec,
            view_state.camera.frame_v_vec,
        ) {
            service.update_frame_ubo(origin, u_vec, v_vec);
        }

        // Render using the ViewState directly
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
        drop(service_guard);

        // Get the raw RGBA data
        let rgba_data = frame_result.image_data;

        // Validate the data size
        let expected_size =
            (batch_request.width_per_slice * batch_request.height_per_slice * 4) as usize;
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

        // Append the raw RGBA data directly (no header)
        result_buffer.extend_from_slice(&rgba_data);
    }

    let render_duration = render_start.elapsed();

    info!(
        "Batch render completed in {:?} ({:.2} ms per slice)",
        render_duration,
        render_duration.as_millis() as f64 / view_states.len() as f64
    );

    // Return the batch buffer as a binary response
    Ok(tauri::ipc::Response::new(result_buffer))
}

// --- Atlas Management Commands ---

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
async fn load_atlas(
    config: AtlasConfig,
    state: State<'_, BridgeState>,
) -> BridgeResult<AtlasLoadResult> {
    info!(
        "Bridge: load_atlas called for atlas: {} in space: {}",
        config.atlas_id, config.space
    );

    let config_for_volume = config.clone();

    // 1) Load atlas via AtlasService to get metadata/progress and ensure data is fetched.
    let atlas_service = state.atlas_service.lock().await;
    let internal_result =
        atlas_service
            .load_atlas(config)
            .await
            .map_err(|e| BridgeError::Internal {
                code: 6008,
                details: format!("Failed to load atlas: {}", e),
            })?;
    drop(atlas_service);

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
    let result = atlas_service
        .load_surface_atlas(config)
        .await
        .map_err(|e| BridgeError::Internal {
            code: 6020,
            details: format!("Failed to load surface atlas: {}", e),
        })?;

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
async fn load_template(
    config: templates::TemplateConfig,
    state: State<'_, BridgeState>,
) -> BridgeResult<templates::TemplateLoadResult> {
    info!("Bridge: load_template called for template: {}", config.id());

    let template_service = state.template_service.lock().await;
    let result =
        template_service
            .load_template(config)
            .await
            .map_err(|e| BridgeError::Internal {
                code: 7005,
                details: format!("Failed to load template: {}", e),
            })?;

    Ok(result)
}

/// Load a template by its menu ID (e.g., "MNI152NLin2009cAsym_T1w_1mm")
#[command]
#[tracing::instrument(skip_all, err, name = "api.load_template_by_id")]
async fn load_template_by_id(
    template_id: String,
    state: State<'_, BridgeState>,
) -> BridgeResult<templates::TemplateLoadResult> {
    info!(
        "Bridge: load_template_by_id called for template: {}",
        template_id
    );

    // Parse the template ID to create a TemplateConfig
    let config = parse_template_id(&template_id)?;

    // Load the template through the template service
    let template_service = state.template_service.lock().await;
    let result =
        template_service
            .load_template(config)
            .await
            .map_err(|e| BridgeError::Internal {
                code: 7006,
                details: format!("Failed to load template by ID: {}", e),
            })?;

    // Get the cache path from the template service
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

    info!("Bridge: Successfully loaded and registered template volume with handle: {} (with sync delay)", result.volume_handle_info.id);

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

    // Use the global surface template manager to load the surface
    let manager = neuroatlas::surface::templates::global_surface_manager();

    let surface = manager
        .get_surface(density, hemisphere, surface_type)
        .await
        .map_err(|e| BridgeError::Internal {
            code: 7033,
            details: format!("Failed to load surface template: {}", e),
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
            })
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
            })
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
            })
        }
    };

    Ok(templates::TemplateConfig::new(
        template_type,
        space,
        resolution,
    ))
}

// --- Plugin Creation ---
pub fn create_plugin<R: Runtime>() -> TauriPlugin<R> {
    plugin()
}

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    Builder::<R>::new("api-bridge")
        .invoke_handler(generate_handler![
            load_file,
            load_surface,
            unload_surface,
            load_surface_overlay,
            get_surface_overlay_data,
            unload_surface_overlay,
            get_surface_geometry,
            get_volume_bounds,
            unload_volume,
            // world_to_voxel, // REMOVED - Unused coordinate transformation
            set_volume_timepoint,
            get_volume_timepoint,
            get_volume_info,
            get_nifti_header_info,
            // get_timeseries_matrix, // REMOVED - Returns unimplemented
            get_initial_views,
            recalculate_view_for_dimensions,
            recalculate_all_views,
            request_layer_gpu_resources,
            release_layer_gpu_resources,
            get_atlas_stats,
            fs_list_directory,
            remote_mount_connect,
            remote_mount_respond_host_key,
            remote_mount_respond_auth,
            remote_mount_unmount,
            list_remote_mount_profiles,
            remove_remote_mount_profile,
            init_render_loop,
            create_offscreen_render_target,
            resize_canvas,
            update_frame_ubo,
            update_frame_for_synchronized_view,
            set_crosshair,
            // set_view_plane, // Removed - view plane info now encoded in frame vectors
            clear_render_layers,
            update_layer_opacity,
            update_layer_colormap,
            update_layer_intensity,
            update_layer_threshold,
            set_layer_mask,
            set_layer_border,
            sample_layer_value_at_world,
            request_frame,
            // render_frame, // REMOVED - Redundant with apply_and_render_view_state
            add_render_layer,
            patch_layer,
            compute_layer_histogram,
            sample_world_coordinate,
            // render_to_image, // REMOVED - Redundant with apply_and_render_view_state
            // render_to_image_binary, // REMOVED - Redundant with apply_and_render_view_state
            render_view, // New unified render method
            render_views,
            apply_and_render_view_state,
            apply_and_render_view_state_binary,
            apply_and_render_view_state_raw,
            query_slice_axis_meta,
            batch_render_slices,
            // Atlas management commands
            get_atlas_catalog,
            get_filtered_atlases,
            get_atlas_entry,
            toggle_atlas_favorite,
            get_recent_atlases,
            get_favorite_atlases,
            validate_atlas_config,
            load_atlas,
            load_surface_atlas,
            start_atlas_progress_monitoring,
            get_atlas_subscription_count,
            // Surface template commands
            load_surface_template,
            get_surface_template_catalog,
            // Template management commands
            get_template_catalog,
            get_filtered_templates,
            get_template_entry,
            validate_template_config,
            load_template,
            load_template_by_id,
            get_template_cache_stats,
            clear_template_cache,
        ])
        .setup(|app, _| {
            // Initialize the bridge state
            let bridge_state = BridgeState::default()
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
            app.manage(bridge_state);
            Ok(())
        })
        .build()
}

// --- Unit Tests ---
#[cfg(test)]
mod tests {
    use super::*;
    use log::{debug, info, warn};
    use nalgebra::Affine3;
    use std::path::PathBuf;
    use volmath::{DenseNeuroVec, DenseVolume3, NeuroSpace, NeuroSpace3};

    fn get_test_data_path() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..") // Go up to core/
            .join("..") // Go up to workspace root
            .join("test-data")
            .join("unit")
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
    }

    fn make_4d_volume_sendable() -> VolumeSendable {
        let dims = vec![8usize, 8, 8, 4];
        let spacing = vec![2.0, 2.0, 2.0, 1.0];
        let origin = vec![-8.0, -8.0, -8.0, 0.0];
        let space = NeuroSpace::new(dims.clone(), Some(spacing), Some(origin), None, None).unwrap();
        let vec4d = DenseNeuroVec::zeros(space).unwrap();
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
}
