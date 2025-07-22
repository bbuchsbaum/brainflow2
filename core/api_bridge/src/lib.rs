use tauri::command;
// Import necessary volmath types directly
use volmath::NeuroSpaceExt; // Import NeuroSpaceExt trait
use volmath::DenseVolumeExt; // Import DenseVolumeExt trait
// use wgpu; // No longer needed directly
use std::collections::HashMap;
use std::sync::Arc;
use std::path::Path;
use tauri::State; // Need State for accessing registry
// Import types from bridge_types
use bridge_types::{self, VolumeSendable, BridgeError, BridgeResult, VolumeLayerGpuInfo, GpuTextureFormat, FlatNode, TreePayload, icons, Loaded, Loader, SliceInfo, TextureCoordinates, LayerPatch, DataRange};
use colormap::colormap_by_name;
// Import NiftiLoader for registration
// use nifti_loader::NiftiLoader;
use render_loop::{RenderLoopService}; // Remove unused RenderLoopError
// Import async_trait attribute
// use async_trait::async_trait;
use log::{info, error, warn}; // Added error and warn
use serde::{Serialize, Deserialize}; // Need Serialize/Deserialize for new types
use serde_json; // For JSON parsing
use ts_rs::TS; // Add TS trait
// Use futures::executor::block_on when needed (now removed)
// use futures;
// Added imports for plugin creation
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Runtime, generate_handler, Manager};
// Re-add tokio::sync::Mutex
use tokio::sync::Mutex;
use nalgebra::Matrix4; // Removed unused Vector4
use tracing; // Add tracing facade import
use neuro_types::{ViewRectMm, ViewOrientation, VolumeMetadata}; // For get_initial_views

// Imports for fs_list_directory
use std::path::PathBuf;
use walkdir::WalkDir;
// Assuming core_loaders is the crate name for the new module
use brainflow_loaders as core_loaders;

// Import error helpers
mod error_helpers;
mod error_context;
mod user_errors;
use error_helpers::*;
use error_context::*;

// --- Add Correlation ID Macro ---
#[macro_export]
macro_rules! new_request_span {
    ($name:literal) => {
        // Use tracing::info_span! which includes target/file/line info by default
        tracing::info_span!($name, request_id = %uuid::Uuid::new_v4())
    };
}
// --- End Correlation ID Macro ---

// --- Define Serializable API Handle Info ---
#[derive(Debug, Clone, Serialize, Deserialize, TS)] // Add derives
#[ts(export)]
pub struct VolumeHandleInfo {
    pub id: String,
    pub name: String,
    pub dims: [usize; 3], // Example field
    pub dtype: String, // Example field
}

// Event payload for volume-loaded event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VolumeLoadedEvent {
    pub volume_id: String,
    pub name: String,
    pub dims: [usize; 3],
    pub dtype: String,
    pub path: String,
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
    Fixed(usize),        // Specific slice index
    Middle,              // Middle slice (default)
    Relative(f32),       // Relative position (0.0 = first, 1.0 = last)
    WorldCoordinate(f32), // Slice at specific world coordinate
}

impl Default for SliceIndex {
    fn default() -> Self {
        SliceIndex::Middle
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)] // Add derives
#[ts(export)]
pub struct VolumeLayerSpec { // Example struct for Volume variant
    pub id: String, // ID of the layer itself
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

// Helper alias for Result
// type BridgeResult<T> = Result<T, BridgeError>; // Now defined in bridge_types

// --- Helper Functions ---

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
        },
        SliceIndex::Middle => max_index / 2,
        SliceIndex::Relative(position) => {
            if *position < 0.0 || *position > 1.0 {
                return Err(BridgeError::Input { 
                    code: 2004, 
                    details: format!("Relative slice position {} is invalid. Please provide a value between 0.0 (first slice) and 1.0 (last slice).", position) 
                });
            }
            ((max_index - 1) as f32 * position) as usize
        },
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
        },
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
    let affine = match volume_data {
        VolumeSendable::VolF32(_, affine) |
        VolumeSendable::VolI16(_, affine) |
        VolumeSendable::VolU8(_, affine) |
        VolumeSendable::VolI8(_, affine) |
        VolumeSendable::VolU16(_, affine) |
        VolumeSendable::VolI32(_, affine) |
        VolumeSendable::VolU32(_, affine) |
        VolumeSendable::VolF64(_, affine) => affine,
    };
    
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

// --- Define App State to hold the registry ---
// This might conflict/need merging with AppState in src-tauri/lib.rs later
pub struct BridgeState {
   // Removed: pub loader_registry: Arc<Mutex<LoaderRegistry>>,
   pub volume_registry: Arc<Mutex<HashMap<String, VolumeSendable>>>, 
   pub render_loop_service: Arc<Mutex<Option<Arc<Mutex<RenderLoopService>>>>>, 
   // NEW: Map UI layer ID to GPU texture atlas layer index
   pub layer_to_atlas_map: Arc<Mutex<HashMap<String, u32>>>, 
}

impl BridgeState {
    pub fn new(
        // Removed loader_registry parameter
        volume_registry: Arc<Mutex<HashMap<String, VolumeSendable>>>,
        render_loop_service: Arc<Mutex<Option<Arc<Mutex<RenderLoopService>>>>>,
        layer_to_atlas_map: Arc<Mutex<HashMap<String, u32>>>
    ) -> Self {
        Self { /* Removed loader_registry field */ volume_registry, render_loop_service, layer_to_atlas_map }
    }
    
    pub fn default() -> Self {
        Self {
            // Removed loader_registry initialization
            volume_registry: Arc::new(Mutex::new(HashMap::new())),
            render_loop_service: Arc::new(Mutex::new(None)), 
            layer_to_atlas_map: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

// --- Tauri Command Stubs ---

#[command]
#[tracing::instrument(skip_all, err, name = "api.load_file")]
#[allow(dead_code)] // Allow unused for now
async fn load_file(path: String, state: State<'_, BridgeState>) -> BridgeResult<VolumeHandleInfo> { // Return VolumeHandleInfo
    println!("Bridge: load_file called with path: {}", path);
    let path_buf = Path::new(&path);
    
    // Check if file exists first
    if !path_buf.exists() {
        return Err(file_not_found_error(&path));
    }
    
    // Check if we can load this file type
    if core_loaders::is_loadable(path_buf) {
        // For now, we'll use spawn_blocking since NiftiLoader::load is sync
        let path_clone = path_buf.to_path_buf();
        let loaded_data = tokio::task::spawn_blocking(move || {
            nifti_loader::NiftiLoader::load(&path_clone)
        }).await
        .map_err(|e| BridgeError::Internal { code: 5003, details: format!("Task join error: {}", e) })?
        .map_err(|e| volume_load_error(&path, &e.to_string()))?;

        match loaded_data {
            Loaded::Volume { dims, dtype, path: loaded_path } => {
                // Now we need to load the actual volume data
                // Since load_nifti_volume is not exposed publicly, we need to read the file again
                // This is inefficient but maintains the current architecture
                let path_buf2 = path_buf.to_path_buf();
                let volume_result = tokio::task::spawn_blocking(move || {
                    // File operations handled by loaders
                    
                    nifti_loader::load_nifti_volume_auto(&path_buf2)
                        .context_bridge(
                            format!("parsing NIFTI volume from '{}'", path_buf2.display()), 
                            5003
                        )
                }).await
                .map_err(|e| BridgeError::Internal { code: 5004, details: format!("Task join error: {}", e) })??;

                let (volume_sendable, _affine) = volume_result;
                
                // Generate a unique ID for this volume
                let volume_id = uuid::Uuid::new_v4().to_string();
                
                // Store the volume in the registry
                {
                    let mut registry = state.volume_registry.lock().await;
                    registry.insert(volume_id.clone(), volume_sendable);
                }
                
                let handle_info = VolumeHandleInfo {
                    id: volume_id,
                    name: Path::new(&loaded_path).file_name().unwrap_or_default().to_string_lossy().to_string(),
                    dims: [dims[0] as usize, dims[1] as usize, dims[2] as usize],
                    dtype,
                };
                
                info!("Successfully loaded and stored volume with ID: {}", handle_info.id);
                Ok(handle_info)
            }
            _ => Err(BridgeError::Internal { code: 500, details: "Loader returned unexpected data type".to_string() })
        }
    } else {
        Err(unsupported_format_error(&path))
    }
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.get_volume_bounds")]
#[allow(dead_code)] // Allow unused for now
async fn get_volume_bounds(volume_id: String, state: State<'_, BridgeState>) -> BridgeResult<VolumeBounds> {
    println!("Bridge: get_volume_bounds called for {}", volume_id);
    
    let volume_registry = state.volume_registry.lock().await;
    let volume_data = volume_registry.get(&volume_id)
        .ok_or_else(|| BridgeError::VolumeNotFound { code: 4041, details: volume_id.clone() })?;
    
    // Calculate world bounds from volume dimensions and affine transform
    let (dims, voxel_to_world) = match volume_data {
        VolumeSendable::VolF32(vol, affine) => (vol.space().dims(), affine.to_homogeneous()),
        VolumeSendable::VolI16(vol, affine) => (vol.space().dims(), affine.to_homogeneous()),
        VolumeSendable::VolU8(vol, affine) => (vol.space().dims(), affine.to_homogeneous()),
        VolumeSendable::VolI8(vol, affine) => (vol.space().dims(), affine.to_homogeneous()),
        VolumeSendable::VolU16(vol, affine) => (vol.space().dims(), affine.to_homogeneous()),
        VolumeSendable::VolI32(vol, affine) => (vol.space().dims(), affine.to_homogeneous()),
        VolumeSendable::VolU32(vol, affine) => (vol.space().dims(), affine.to_homogeneous()),
        VolumeSendable::VolF64(vol, affine) => (vol.space().dims(), affine.to_homogeneous()),
    };
    
    // Calculate the 8 corners of the volume in voxel space
    let corners_voxel = vec![
        nalgebra::Vector4::new(0.0, 0.0, 0.0, 1.0),
        nalgebra::Vector4::new((dims[0] - 1) as f32, 0.0, 0.0, 1.0),
        nalgebra::Vector4::new(0.0, (dims[1] - 1) as f32, 0.0, 1.0),
        nalgebra::Vector4::new((dims[0] - 1) as f32, (dims[1] - 1) as f32, 0.0, 1.0),
        nalgebra::Vector4::new(0.0, 0.0, (dims[2] - 1) as f32, 1.0),
        nalgebra::Vector4::new((dims[0] - 1) as f32, 0.0, (dims[2] - 1) as f32, 1.0),
        nalgebra::Vector4::new(0.0, (dims[1] - 1) as f32, (dims[2] - 1) as f32, 1.0),
        nalgebra::Vector4::new((dims[0] - 1) as f32, (dims[1] - 1) as f32, (dims[2] - 1) as f32, 1.0),
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
        1.0
    );
    let center_world = voxel_to_world * center_voxel;
    
    Ok(VolumeBounds {
        min: min_bounds,
        max: max_bounds,
        center: [center_world[0], center_world[1], center_world[2]],
        dims: [dims[0] as u32, dims[1] as u32, dims[2] as u32],
    })
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.world_to_voxel")]
#[allow(dead_code)] // Allow unused for now
async fn world_to_voxel(volume_id: String, world_coord: [f32; 3], state: State<'_, BridgeState>) -> BridgeResult<Option<[usize; 3]>> { // Add state
    println!("Bridge: world_to_voxel called for {} at {:?}", volume_id, world_coord);

    // 1. Get necessary volume info - Lock only to clone needed data
    let (dims_vec, grid_coords_f32) = {
        let volume_registry = state.volume_registry.lock().await; // Lock successful or panicked
        let volume_data = volume_registry.get(&volume_id)
            .ok_or_else(|| BridgeError::VolumeNotFound { code: 4041, details: volume_id.clone() })?;

        // Calculate grid coords and clone dims while lock is held
        let dims_vec = match volume_data {
            VolumeSendable::VolF32(vol, _) => vol.space().dims().to_vec(),
            VolumeSendable::VolI16(vol, _) => vol.space().dims().to_vec(),
            VolumeSendable::VolU8(vol, _) => vol.space().dims().to_vec(),
            VolumeSendable::VolI8(vol, _) => vol.space().dims().to_vec(),
            VolumeSendable::VolU16(vol, _) => vol.space().dims().to_vec(),
            VolumeSendable::VolI32(vol, _) => vol.space().dims().to_vec(),
            VolumeSendable::VolU32(vol, _) => vol.space().dims().to_vec(),
            VolumeSendable::VolF64(vol, _) => vol.space().dims().to_vec(),
        };

        let grid_coords_f32 = {
            // Convert [f32; 3] to Vec<Vec<f64>> format expected by coord_to_grid
            let coords_vec = vec![vec![world_coord[0] as f64, world_coord[1] as f64, world_coord[2] as f64]];
            match volume_data { // Calculate using original volume_data
                VolumeSendable::VolF32(vol, _) => vol.space().coord_to_grid(&coords_vec),
                VolumeSendable::VolI16(vol, _) => vol.space().coord_to_grid(&coords_vec),
                VolumeSendable::VolU8(vol, _) => vol.space().coord_to_grid(&coords_vec),
                VolumeSendable::VolI8(vol, _) => vol.space().coord_to_grid(&coords_vec),
                VolumeSendable::VolU16(vol, _) => vol.space().coord_to_grid(&coords_vec),
                VolumeSendable::VolI32(vol, _) => vol.space().coord_to_grid(&coords_vec),
                VolumeSendable::VolU32(vol, _) => vol.space().coord_to_grid(&coords_vec),
                VolumeSendable::VolF64(vol, _) => vol.space().coord_to_grid(&coords_vec),
            }
        };

        (dims_vec, grid_coords_f32)
    }; // Lock dropped here

    // 3. Extract grid coordinates from Result and convert to usize
    let grid_coords_result = grid_coords_f32.map_err(|e| BridgeError::Internal {
        code: 5011,
        details: format!("Failed to convert world coordinates to grid coordinates: {:?}", e),
    })?;
    
    let mut grid_coords_usize = [0usize; 3];
    let dims = &dims_vec;

    // grid_coords_result is Vec<Vec<i32>>, we want the first point's coordinates
    let grid_coords_i32 = &grid_coords_result[0];
    
    for i in 0..3 {
        let coord_floor = grid_coords_i32[i] as f32;
        // Check for negative coordinates and NaNs
        if coord_floor < 0.0 || coord_floor.is_nan() {
            return Ok(None); // Coordinate is outside the grid
        }
        let coord_usize = coord_floor as usize;
        // Check upper bounds
        if coord_usize >= dims[i] {
            return Ok(None); // Coordinate is outside the grid
        }
        grid_coords_usize[i] = coord_usize;
    }

    Ok(Some(grid_coords_usize))
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.get_timeseries")]
#[allow(dead_code)] // Allow unused for now
async fn get_timeseries_matrix(volume_id: String, coords: Vec<[f32; 3]>, _state: State<'_, BridgeState>) -> BridgeResult<TimeSeriesResult> { // Add state
    println!("Bridge: get_timeseries_matrix called for {} with {} coords", volume_id, coords.len());
    // Placeholder implementation - requires actual volmath integration
    Err(BridgeError::Internal { code: 5001, details: "get_timeseries_matrix not implemented".to_string() })
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.get_initial_views")]
async fn get_initial_views(
    volume_id: String,
    max_px: Vec<u32>, // [width, height]
    state: State<'_, BridgeState>,
) -> BridgeResult<HashMap<String, ViewRectMm>> {
    println!("Bridge: get_initial_views called for {} with max_px: {:?}", volume_id, max_px);
    
    // Validate max_px input
    if max_px.len() != 2 {
        return Err(BridgeError::Input { 
            code: 4001, 
            details: "max_px must have exactly 2 elements [width, height]".to_string() 
        });
    }
    let screen_px_max = [max_px[0], max_px[1]];
    
    // Get volume from registry
    let volume_registry = state.volume_registry.lock().await;
    let volume_data = volume_registry.get(&volume_id)
        .ok_or_else(|| BridgeError::VolumeNotFound { 
            code: 4041, 
            details: format!("Volume '{}' not found", volume_id) 
        })?;
    
    // Extract dimensions and voxel_to_world transform
    let (dims, voxel_to_world) = match volume_data {
        VolumeSendable::VolF32(vol, affine) => (vol.space().dims(), affine.to_homogeneous()),
        VolumeSendable::VolI16(vol, affine) => (vol.space().dims(), affine.to_homogeneous()),
        VolumeSendable::VolU8(vol, affine) => (vol.space().dims(), affine.to_homogeneous()),
        VolumeSendable::VolI8(vol, affine) => (vol.space().dims(), affine.to_homogeneous()),
        VolumeSendable::VolU16(vol, affine) => (vol.space().dims(), affine.to_homogeneous()),
        VolumeSendable::VolI32(vol, affine) => (vol.space().dims(), affine.to_homogeneous()),
        VolumeSendable::VolU32(vol, affine) => (vol.space().dims(), affine.to_homogeneous()),
        VolumeSendable::VolF64(vol, affine) => (vol.space().dims(), affine.to_homogeneous()),
    };
    
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
    let center_world_point = voxel_to_world * nalgebra::Point4::new(
        center_voxel[0], 
        center_voxel[1], 
        center_voxel[2], 
        1.0
    );
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
#[tracing::instrument(skip_all, err, name = "api.request_gpu")]
#[allow(dead_code)] // Allow unused for now
async fn request_layer_gpu_resources(layer_spec: LayerSpec, state: State<'_, BridgeState>) -> BridgeResult<VolumeLayerGpuInfo> { // Update return type
    println!("Bridge: request_layer_gpu_resources called with spec: {:?}", layer_spec);
    info!("Bridge: request_layer_gpu_resources called");
    // error!("request_layer_gpu_resources is not implemented yet!"); // Remove error log

    match layer_spec {
        LayerSpec::Volume(vol_spec) => {
            let source_volume_id = vol_spec.source_resource_id.clone();
            let ui_layer_id = vol_spec.id.clone();
            info!("Requesting GPU resources for UI layer '{}' (source volume '{}')", ui_layer_id, source_volume_id);

            // --- 1. Get RenderLoopService ---
            let service_guard = state.render_loop_service.lock().await;
            let service_arc = service_guard.as_ref()
                .ok_or_else(|| {
                    error!("RenderLoopService is not available.");
                    BridgeError::ServiceNotInitialized { 
                        code: 5002, 
                        details: "GPU rendering service is not initialized. Please ensure the application has started correctly.".to_string() 
                    }
                })?;
            let mut render_loop_service = service_arc.lock().await;
            // Keep the service locked for atlas allocation and upload

            // --- 2. Get VolumeSendable ---
            let volume_registry_guard = state.volume_registry.lock().await;
            let volume_data = volume_registry_guard.get(&source_volume_id)
                .ok_or_else(|| {
                    error!("Volume not found in registry: {}", source_volume_id);
                    BridgeError::VolumeNotFound { 
                        code: 4042, 
                        details: format!("Volume '{}' not found. Please load the volume first using load_file.", source_volume_id) 
                    }
                })?;
            
            // --- 3. Extract slice parameters from layer spec ---
            let slice_axis = vol_spec.slice_axis.unwrap_or_default();
            let slice_index_spec = vol_spec.slice_index.clone().unwrap_or_default();
            
            // Get volume dimensions to calculate actual slice index
            let vol_dims_temp = match volume_data {
                VolumeSendable::VolF32(vol, _) => vol.space().dims(),
                VolumeSendable::VolI16(vol, _) => vol.space().dims(),
                VolumeSendable::VolU8(vol, _) => vol.space().dims(),
                VolumeSendable::VolI8(vol, _) => vol.space().dims(),
                VolumeSendable::VolU16(vol, _) => vol.space().dims(),
                VolumeSendable::VolI32(vol, _) => vol.space().dims(),
                VolumeSendable::VolU32(vol, _) => vol.space().dims(),
                VolumeSendable::VolF64(vol, _) => vol.space().dims(),
            };
            
            // Calculate the actual slice index based on the specification
            let _slice_idx = calculate_slice_index(&slice_index_spec, &vol_dims_temp, slice_axis, volume_data)?;
            
            // Upload the entire volume as a 3D texture and get the world-to-voxel transform
            println!("DEBUG: About to upload volume to GPU");
            let (atlas_layer_idx, volume_world_to_voxel) = match volume_data {
                VolumeSendable::VolF32(vol, _) => {
                    println!("DEBUG: Uploading F32 volume with {} voxels", vol.data().len());
                    render_loop_service.upload_volume_3d(vol)
                        .map_err(|e| gpu_allocation_error(&ui_layer_id, &e.to_string()))?
                },
                VolumeSendable::VolI16(vol, _) => {
                    render_loop_service.upload_volume_3d(vol)
                        .map_err(|e| gpu_allocation_error(&ui_layer_id, &e.to_string()))?
                },
                VolumeSendable::VolU8(vol, _) => {
                    render_loop_service.upload_volume_3d(vol)
                        .map_err(|e| gpu_allocation_error(&ui_layer_id, &e.to_string()))?
                },
                VolumeSendable::VolI8(vol, _) => {
                    render_loop_service.upload_volume_3d(vol)
                        .map_err(|e| gpu_allocation_error(&ui_layer_id, &e.to_string()))?
                },
                VolumeSendable::VolU16(vol, _) => {
                    render_loop_service.upload_volume_3d(vol)
                        .map_err(|e| gpu_allocation_error(&ui_layer_id, &e.to_string()))?
                },
                VolumeSendable::VolI32(vol, _) => {
                    render_loop_service.upload_volume_3d(vol)
                        .map_err(|e| gpu_allocation_error(&ui_layer_id, &e.to_string()))?
                },
                VolumeSendable::VolU32(vol, _) => {
                    render_loop_service.upload_volume_3d(vol)
                        .map_err(|e| gpu_allocation_error(&ui_layer_id, &e.to_string()))?
                },
                VolumeSendable::VolF64(vol, _) => {
                    render_loop_service.upload_volume_3d(vol)
                        .map_err(|e| gpu_allocation_error(&ui_layer_id, &e.to_string()))?
                },
            };
            
            // For 3D textures, texture coordinates are always the full texture
            let (u_min, v_min, u_max, v_max) = (0.0, 0.0, 1.0, 1.0);
            
            // Get volume dimensions and format for the response
            let (vol_dims, gpu_format) = match volume_data {
                VolumeSendable::VolF32(vol, _) => {
                    let dims = vol.space().dims();
                    ([dims[0] as u32, dims[1] as u32, dims[2] as u32], GpuTextureFormat::R32Float)
                },
                VolumeSendable::VolI16(vol, _) => {
                    let dims = vol.space().dims();
                    ([dims[0] as u32, dims[1] as u32, dims[2] as u32], GpuTextureFormat::R16Float)
                },
                VolumeSendable::VolU8(vol, _) => {
                    let dims = vol.space().dims();
                    ([dims[0] as u32, dims[1] as u32, dims[2] as u32], GpuTextureFormat::R8Unorm)
                },
                VolumeSendable::VolI8(vol, _) => {
                    let dims = vol.space().dims();
                    ([dims[0] as u32, dims[1] as u32, dims[2] as u32], GpuTextureFormat::R8Unorm)
                },
                VolumeSendable::VolU16(vol, _) => {
                    let dims = vol.space().dims();
                    ([dims[0] as u32, dims[1] as u32, dims[2] as u32], GpuTextureFormat::R16Float)
                },
                VolumeSendable::VolI32(vol, _) => {
                    let dims = vol.space().dims();
                    ([dims[0] as u32, dims[1] as u32, dims[2] as u32], GpuTextureFormat::R32Float)
                },
                VolumeSendable::VolU32(vol, _) => {
                    let dims = vol.space().dims();
                    ([dims[0] as u32, dims[1] as u32, dims[2] as u32], GpuTextureFormat::R32Float)
                },
                VolumeSendable::VolF64(vol, _) => {
                    let dims = vol.space().dims();
                    ([dims[0] as u32, dims[1] as u32, dims[2] as u32], GpuTextureFormat::R32Float)
                },
            };
            
            // Store the mapping from UI layer ID to atlas layer index
            {
                let mut layer_map = state.layer_to_atlas_map.lock().await;
                layer_map.insert(ui_layer_id.clone(), atlas_layer_idx);
            }
            
            // Get the affine transform (voxel to world) and extract space info - clone before dropping the guard
            let (affine, origin, spacing) = match volume_data {
                VolumeSendable::VolF32(vol, affine) => {
                    let space = vol.space();
                    (affine.clone(), space.origin().to_vec(), space.spacing().to_vec())
                },
                VolumeSendable::VolI16(vol, affine) => {
                    let space = vol.space();
                    (affine.clone(), space.origin().to_vec(), space.spacing().to_vec())
                },
                VolumeSendable::VolU8(vol, affine) => {
                    let space = vol.space();
                    (affine.clone(), space.origin().to_vec(), space.spacing().to_vec())
                },
                VolumeSendable::VolI8(vol, affine) => {
                    let space = vol.space();
                    (affine.clone(), space.origin().to_vec(), space.spacing().to_vec())
                },
                VolumeSendable::VolU16(vol, affine) => {
                    let space = vol.space();
                    (affine.clone(), space.origin().to_vec(), space.spacing().to_vec())
                },
                VolumeSendable::VolI32(vol, affine) => {
                    let space = vol.space();
                    (affine.clone(), space.origin().to_vec(), space.spacing().to_vec())
                },
                VolumeSendable::VolU32(vol, affine) => {
                    let space = vol.space();
                    (affine.clone(), space.origin().to_vec(), space.spacing().to_vec())
                },
                VolumeSendable::VolF64(vol, affine) => {
                    let space = vol.space();
                    (affine.clone(), space.origin().to_vec(), space.spacing().to_vec())
                },
            };
            
            // Get world_to_voxel matrix (inverse of voxel_to_world affine)
            let voxel_to_world = affine.to_homogeneous();
            let world_to_voxel = voxel_to_world.try_inverse()
                .unwrap_or_else(Matrix4::identity);
            
            // CRITICAL FIX: Convert to column-major order for WGSL
            // WGSL expects mat4x4<f32> in column-major order
            // nalgebra uses column-major internally, but we need to flatten correctly
            let world_to_voxel_flat: [f32; 16] = [
                world_to_voxel[(0, 0)], world_to_voxel[(1, 0)], world_to_voxel[(2, 0)], world_to_voxel[(3, 0)], // Column 0
                world_to_voxel[(0, 1)], world_to_voxel[(1, 1)], world_to_voxel[(2, 1)], world_to_voxel[(3, 1)], // Column 1
                world_to_voxel[(0, 2)], world_to_voxel[(1, 2)], world_to_voxel[(2, 2)], world_to_voxel[(3, 2)], // Column 2
                world_to_voxel[(0, 3)], world_to_voxel[(1, 3)], world_to_voxel[(2, 3)], world_to_voxel[(3, 3)], // Column 3
            ];
            
            // Convert voxel_to_world matrix to flat array (column-major for WGSL)
            let voxel_to_world_flat: [f32; 16] = [
                voxel_to_world[(0, 0)], voxel_to_world[(1, 0)], voxel_to_world[(2, 0)], voxel_to_world[(3, 0)], // Column 0
                voxel_to_world[(0, 1)], voxel_to_world[(1, 1)], voxel_to_world[(2, 1)], voxel_to_world[(3, 1)], // Column 1
                voxel_to_world[(0, 2)], voxel_to_world[(1, 2)], voxel_to_world[(2, 2)], voxel_to_world[(3, 2)], // Column 2
                voxel_to_world[(0, 3)], voxel_to_world[(1, 3)], voxel_to_world[(2, 3)], voxel_to_world[(3, 3)], // Column 3
            ];
            
            // Calculate center world coordinates
            let center_voxel = nalgebra::Vector4::new(
                (vol_dims[0] as f32 - 1.0) * 0.5,
                (vol_dims[1] as f32 - 1.0) * 0.5,
                (vol_dims[2] as f32 - 1.0) * 0.5,
                1.0
            );
            let center_world = voxel_to_world * center_voxel;
            let center_world_coords = [center_world.x, center_world.y, center_world.z];
            
            info!("Volume center calculation: voxel [{:.1}, {:.1}, {:.1}] -> world [{:.1}, {:.1}, {:.1}]",
                  center_voxel.x, center_voxel.y, center_voxel.z,
                  center_world_coords[0], center_world_coords[1], center_world_coords[2]);
            
            // Debug the transform matrices - log in column-major format for nalgebra
            info!("Voxel Dims: {:?}", vol_dims);
            info!("Center Voxel Input: [{:.1}, {:.1}, {:.1}, {:.1}]", 
                  center_voxel.x, center_voxel.y, center_voxel.z, center_voxel.w);
            info!("Voxel-to-world transform matrix (column-major):");
            for i in 0..4 {
                info!("  [{:.3}, {:.3}, {:.3}, {:.3}]", 
                      voxel_to_world[(i,0)], voxel_to_world[(i,1)], 
                      voxel_to_world[(i,2)], voxel_to_world[(i,3)]);
            }
            info!("World-to-voxel transform matrix (column-major):");
            for i in 0..4 {
                info!("  [{:.3}, {:.3}, {:.3}, {:.3}]", 
                      world_to_voxel[(i,0)], world_to_voxel[(i,1)], 
                      world_to_voxel[(i,2)], world_to_voxel[(i,3)]);
            }
            
            // Also log the affine directly
            info!("Original affine from NIfTI:");
            let affine_matrix = affine.to_homogeneous();
            for i in 0..4 {
                info!("  [{:.3}, {:.3}, {:.3}, {:.3}]", 
                      affine_matrix[(i,0)], affine_matrix[(i,1)], 
                      affine_matrix[(i,2)], affine_matrix[(i,3)]);
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
            info!("Texture coordinates - u: [{:.4}, {:.4}], v: [{:.4}, {:.4}]", u_min, u_max, v_min, v_max);
            
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
                },
                VolumeSendable::VolI16(vol, _) => {
                    let mut min = i16::MAX as f32;
                    let mut max = i16::MIN as f32;
                    for v in vol.data().iter() {
                        let val = *v as f32;
                        min = min.min(val);
                        max = max.max(val);
                    }
                    (min, max)
                },
                VolumeSendable::VolU8(vol, _) => {
                    let mut min = 255.0f32;
                    let mut max = 0.0f32;
                    for v in vol.data().iter() {
                        let val = *v as f32;
                        min = min.min(val);
                        max = max.max(val);
                    }
                    (min, max)
                },
                VolumeSendable::VolI8(vol, _) => {
                    let mut min = i8::MAX as f32;
                    let mut max = i8::MIN as f32;
                    for v in vol.data().iter() {
                        let val = *v as f32;
                        min = min.min(val);
                        max = max.max(val);
                    }
                    (min, max)
                },
                VolumeSendable::VolU16(vol, _) => {
                    let mut min = u16::MAX as f32;
                    let mut max = 0.0f32;
                    for v in vol.data().iter() {
                        let val = *v as f32;
                        min = min.min(val);
                        max = max.max(val);
                    }
                    (min, max)
                },
                VolumeSendable::VolI32(vol, _) => {
                    let mut min = i32::MAX as f32;
                    let mut max = i32::MIN as f32;
                    for v in vol.data().iter() {
                        let val = *v as f32;
                        min = min.min(val);
                        max = max.max(val);
                    }
                    (min, max)
                },
                VolumeSendable::VolU32(vol, _) => {
                    let mut min = u32::MAX as f32;
                    let mut max = 0.0f32;
                    for v in vol.data().iter() {
                        let val = *v as f32;
                        min = min.min(val);
                        max = max.max(val);
                    }
                    (min, max)
                },
                VolumeSendable::VolF64(vol, _) => {
                    let mut min = f32::MAX;
                    let mut max = f32::MIN;
                    for v in vol.data().iter() {
                        let val = *v as f32;
                        min = min.min(val);
                        max = max.max(val);
                    }
                    (min, max)
                },
            };
            let is_binary_like = (min_val >= 0.0 && max_val <= 1.0) && ((max_val - min_val) <= 1.0);
            let data_range = Some(DataRange { min: min_val, max: max_val });

            // Get colormap ID first
            let colormap_id = match colormap_by_name(&vol_spec.colormap) {
                Some(id) => id.id() as u32,
                None => {
                    error!("Unknown colormap '{}', defaulting to grayscale", vol_spec.colormap);
                    0 // Default to grayscale
                }
            };
            
            // Register the volume for the declarative API using the source volume ID
            // This enables request_frame to access this volume with correct data range
            if let Err(e) = render_loop_service.register_volume_with_range(
                source_volume_id.clone(), 
                atlas_layer_idx,
                (min_val, max_val)
            ) {
                warn!("Failed to register volume {} with atlas index {}: {:?}", source_volume_id, atlas_layer_idx, e);
                // Continue anyway - the volume is uploaded and can be used imperatively
            } else {
                info!("Successfully registered volume '{}' with atlas index {} for declarative API with data range ({}, {})", 
                    source_volume_id, atlas_layer_idx, min_val, max_val);
            }
            
            // Add the layer to the render state using world-space rendering
            info!("Adding layer to render state: texture_index={}, dims={:?}", atlas_layer_idx, vol_dims);
            let layer_index = render_loop_service.add_layer_3d(
                atlas_layer_idx,
                volume_world_to_voxel.clone(),
                (vol_dims[0], vol_dims[1], vol_dims[2]),
                1.0, // Initial opacity
                colormap_id
            )
            .map_err(|e| BridgeError::GpuError {
                code: 5012,
                details: format!("Failed to add layer to render state: {:?}", e),
            })?;
            info!("Successfully added layer at index: {}", layer_index);
            
            // Update intensity range - for binary masks, force 0-1 range
            // IMPORTANT: For U8 volumes using R8Unorm texture format, the GPU automatically
            // normalizes 0-255 to 0.0-1.0 when sampling. So we must use 0-1 range in shaders!
            let is_u8 = matches!(&volume_data, VolumeSendable::VolU8(_, _));
            let (display_min, display_max) = if is_u8 {
                // For U8 data, always use 0-1 range because R8Unorm normalizes to this range
                (0.0, 1.0)
            } else if is_binary_like && max_val <= 1.0 {
                // For float data that's already 0-1
                (0.0, 1.0)
            } else {
                (min_val, max_val)
            };
            
            render_loop_service.update_layer_intensity(layer_index, display_min, display_max)
                .map_err(|e| BridgeError::GpuError {
                    code: 5014,
                    details: format!("Failed to set layer intensity range: {:?}", e),
                })?;
            
            info!("Added render layer {} with colormap {} (id {}) and intensity range ({}, {}) -> display range ({}, {})", 
                  layer_index, vol_spec.colormap, colormap_id, min_val, max_val, display_min, display_max);
            if is_binary_like {
                info!("Detected binary mask - using 0-1 display range");
            }

            // Store the mapping between UI layer ID and atlas index
            {
                let mut layer_map = state.layer_to_atlas_map.lock().await;
                info!("📌 STORING layer mapping: UI layer '{}' -> atlas index {}", ui_layer_id, atlas_layer_idx);
                layer_map.insert(ui_layer_id.clone(), atlas_layer_idx);
                info!("📌 Layer map now contains {} entries: {:?}", 
                      layer_map.len(), layer_map.keys().collect::<Vec<_>>());
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
        }
        // Other layer types would go here
    }
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.release_gpu")]
#[allow(dead_code)] // Allow unused for now
async fn release_layer_gpu_resources(layer_id: String, state: State<'_, BridgeState>) -> BridgeResult<ReleaseResult> {
    println!("Bridge: release_layer_gpu_resources called for layer {}", layer_id);
    
    // Look up the atlas layer index for this UI layer
    let atlas_layer_idx = {
        let layer_map = state.layer_to_atlas_map.lock().await;
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
    let service_guard = state.render_loop_service.lock().await;
    let service_arc = service_guard.as_ref()
        .ok_or_else(|| BridgeError::ServiceNotInitialized { 
            code: 5008, 
            details: "GPU rendering service is not initialized. Cannot release GPU resources.".to_string() 
        })?;
    let mut render_loop_service = service_arc.lock().await;
    
    // Release the atlas layer
    render_loop_service.volume_atlas.free_layer(atlas_layer_idx);
    
    // Remove from our tracking map
    {
        let mut layer_map = state.layer_to_atlas_map.lock().await;
        layer_map.remove(&layer_id);
    }
    
    info!("Released GPU resources for layer {} (atlas layer {})", layer_id, atlas_layer_idx);
    
    Ok(ReleaseResult {
        success: true,
        message: format!("Released GPU resources for layer {} (atlas layer {})", layer_id, atlas_layer_idx),
    })
}

// --- Directory Listing Command ---
#[command]
#[tracing::instrument(skip_all, err, name = "api.fs_list_directory")]
#[allow(dead_code)] // Allow unused for now
async fn fs_list_directory(
    path: String,
    _state: State<'_, BridgeState>, // Add state param even if unused
) -> BridgeResult<TreePayload> {
    println!("Bridge: fs_list_directory called for path: {}", path);
    
    let root_path = PathBuf::from(&path);
    if !root_path.exists() {
        return Err(BridgeError::Io { 
            code: 1002, 
            details: format!("Directory '{}' does not exist. Please check the path and try again.", path) 
        });
    }
    
    if !root_path.is_dir() {
        return Err(BridgeError::Input { 
            code: 2001, 
            details: format!("'{}' is not a directory. Please provide a valid directory path.", path) 
        });
    }
    
    let mut nodes = Vec::new();
    let mut parent_map: HashMap<PathBuf, usize> = HashMap::new();
    
    // Use walkdir to traverse directory
    for entry in WalkDir::new(&root_path)
        .max_depth(3) // Limit depth for performance
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue, // Skip files we can't read
        };
        
        // Determine icon based on file type/extension
        let icon_id = if metadata.is_dir() {
            icons::FOLDER
        } else {
            match path.extension().and_then(|ext| ext.to_str()) {
                Some("nii") | Some("gz") => icons::NIFTI,
                Some("gii") => icons::GIFTI,
                Some("csv") | Some("tsv") => icons::TABLE,
                Some("png") | Some("jpg") | Some("jpeg") => icons::IMAGE,
                _ => icons::FILE,
            }
        };
        
        // Determine parent index
        let parent_idx = if path == root_path {
            None
        } else {
            path.parent()
                .and_then(|parent| parent_map.get(parent))
                .copied()
        };
        
        let node = FlatNode {
            id: path.to_string_lossy().to_string(),
            name: path.file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string(),
            parent_idx,
            icon_id,
            is_dir: metadata.is_dir(),
        };
        
        let idx = nodes.len();
        parent_map.insert(path.to_path_buf(), idx);
        nodes.push(node);
    }
    
    Ok(TreePayload { nodes })
}

// --- GPU Service Commands ---
#[command]
#[tracing::instrument(skip_all, err, name = "api.init_render_loop")]
async fn init_render_loop(
    state: State<'_, BridgeState>
) -> BridgeResult<()> {
    
    println!("Bridge: init_render_loop called");
    
    // Check if already initialized
    {
        let service_lock = state.render_loop_service.lock().await;
        if service_lock.is_some() {
            info!("RenderLoopService already initialized");
            return Ok(());
        }
    }
    
    // Initialize the service
    let mut service = RenderLoopService::new().await
        .context_bridge("initializing render loop service", 5005)?;
    
    // Load shaders
    service.load_shaders()
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
    println!("Bridge: resize_canvas called with {}x{}", width, height);
    
    let service_guard = state.render_loop_service.lock().await;
    let service_arc = service_guard.as_ref()
        .ok_or_else(|| BridgeError::ServiceNotInitialized { 
            code: 5006, 
            details: "GPU rendering service is not initialized. Please initialize the render loop first.".to_string() 
        })?;
    
    let mut service = service_arc.lock().await;
    service.resize(width, height);
    
    Ok(())
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.update_frame_ubo")]
async fn update_frame_ubo(
    origin_mm: Vec<f32>, // 4 elements - plane center in world mm
    u_mm: Vec<f32>, // 4 elements - world vector for clip space +X
    v_mm: Vec<f32>, // 4 elements - world vector for clip space +Y
    state: State<'_, BridgeState>
) -> BridgeResult<()> {
    info!("Bridge: update_frame_ubo called with:");
    info!("  origin_mm: {:?}", origin_mm);
    info!("  u_mm: {:?}", u_mm);
    info!("  v_mm: {:?}", v_mm);
    
    // Validate input arrays
    if origin_mm.len() != 4 {
        return Err(BridgeError::Input {
            code: 2010,
            details: "origin_mm must be a 4-element array".to_string()
        });
    }
    if u_mm.len() != 4 {
        return Err(BridgeError::Input {
            code: 2011,
            details: "u_mm must be a 4-element array".to_string()
        });
    }
    if v_mm.len() != 4 {
        return Err(BridgeError::Input {
            code: 2012,
            details: "v_mm must be a 4-element array".to_string()
        });
    }
    
    // Get render loop service
    let service_guard = state.render_loop_service.lock().await;
    let service_arc = service_guard.as_ref()
        .ok_or_else(|| BridgeError::ServiceNotInitialized { 
            code: 5006, 
            details: "GPU rendering service is not initialized. Please initialize the render loop first.".to_string() 
        })?;
    let service = service_arc.lock().await;
    
    // Convert Vec<f32> to fixed arrays
    let origin_mm_arr: [f32; 4] = origin_mm.try_into()
        .map_err(|_| BridgeError::Internal { 
            code: 5008, 
            details: "Failed to convert origin_mm to array".to_string() 
        })?;
    let u_mm_arr: [f32; 4] = u_mm.try_into()
        .map_err(|_| BridgeError::Internal { 
            code: 5009, 
            details: "Failed to convert u_mm to array".to_string() 
        })?;
    let v_mm_arr: [f32; 4] = v_mm.try_into()
        .map_err(|_| BridgeError::Internal { 
            code: 5010, 
            details: "Failed to convert v_mm to array".to_string() 
        })?;
    
    // Update the frame UBO
    service.update_frame_ubo(
        origin_mm_arr,
        u_mm_arr,
        v_mm_arr
    );
    
    Ok(())
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.set_crosshair")]
async fn set_crosshair(
    world_coords: Vec<f32>, // 3 elements for world position
    state: State<'_, BridgeState>
) -> BridgeResult<()> {
    info!("Bridge: set_crosshair called with coords: {:?}", world_coords);
    
    // Validate input
    if world_coords.len() != 3 {
        return Err(BridgeError::Input {
            code: 2014,
            details: "world_coords must be a 3-element array for [x, y, z] position".to_string()
        });
    }
    
    // Get render loop service
    let service_guard = state.render_loop_service.lock().await;
    let service_arc = service_guard.as_ref()
        .ok_or_else(|| BridgeError::ServiceNotInitialized { 
            code: 5006, 
            details: "GPU rendering service is not initialized. Please initialize the render loop first.".to_string() 
        })?;
    let service = service_arc.lock().await;
    
    // Convert Vec<f32> to fixed array
    let world_coords_arr: [f32; 3] = world_coords.try_into()
        .map_err(|_| BridgeError::Internal { 
            code: 5010, 
            details: "Failed to convert world_coords to array".to_string() 
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
    state: State<'_, BridgeState>
) -> BridgeResult<()> {
    info!("Bridge: update_frame_for_synchronized_view called - view: {}x{}mm, plane: {}", 
        view_width_mm, view_height_mm, plane_id);
    println!("API_BRIDGE: Received view dimensions: {}x{}mm", view_width_mm, view_height_mm);
    
    // Validate crosshair coordinates
    if crosshair_world.len() != 3 {
        return Err(BridgeError::Input {
            code: 2015,
            details: "crosshair_world must be a 3-element array for [x, y, z] position".to_string()
        });
    }
    
    // Get render loop service
    let service_guard = state.render_loop_service.lock().await;
    let service_arc = service_guard.as_ref()
        .ok_or_else(|| BridgeError::ServiceNotInitialized { 
            code: 5006, 
            details: "GPU rendering service is not initialized. Please initialize the render loop first.".to_string() 
        })?;
    let service = service_arc.lock().await;
    
    // Convert Vec<f32> to fixed array
    let crosshair_arr: [f32; 3] = crosshair_world.try_into()
        .map_err(|_| BridgeError::Internal { 
            code: 5011, 
            details: "Failed to convert crosshair_world to array".to_string() 
        })?;
    
    // Update the frame for synchronized view
    service.update_frame_for_synchronized_view(
        view_width_mm,
        view_height_mm,
        crosshair_arr,
        plane_id
    );
    
    Ok(())
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.create_offscreen_render_target")]
async fn create_offscreen_render_target(
    width: u32,
    height: u32,
    state: State<'_, BridgeState>
) -> BridgeResult<()> {
    info!("Bridge: create_offscreen_render_target called with {}x{}", width, height);
    
    // Get render loop service
    let service_guard = state.render_loop_service.lock().await;
    let service_arc = service_guard.as_ref()
        .ok_or_else(|| BridgeError::ServiceNotInitialized { 
            code: 5006, 
            details: "GPU rendering service is not initialized. Please initialize the render loop first.".to_string() 
        })?;
    let mut service = service_arc.lock().await;
    
    // Create the offscreen render target
    service.create_offscreen_target(width, height)
        .map_err(|e| BridgeError::Internal {
            code: 5013,
            details: format!("Failed to create offscreen render target: {}", e),
        })?;
    
    info!("Offscreen render target created successfully: {}x{}", width, height);
    
    Ok(())
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.render_frame")]
async fn render_frame(state: State<'_, BridgeState>) -> BridgeResult<()> {
    info!("Bridge: render_frame called");
    
    // Get render loop service
    let service_guard = state.render_loop_service.lock().await;
    let service_arc = service_guard.as_ref()
        .ok_or_else(|| BridgeError::ServiceNotInitialized { 
            code: 5006, 
            details: "GPU rendering service is not initialized. Please initialize the render loop first.".to_string() 
        })?;
    let mut service = service_arc.lock().await;
    
    // Render the frame
    service.render()
        .map_err(|e| BridgeError::GpuError { 
            code: 5012, 
            details: format!("Failed to render frame: {}", e) 
        })?;
    
    info!("Frame rendered successfully");
    Ok(())
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.add_render_layer")]
async fn add_render_layer(
    atlas_index: u32,
    opacity: f32,
    texture_coords: Vec<f32>, // 4 elements: u_min, v_min, u_max, v_max
    state: State<'_, BridgeState>
) -> BridgeResult<usize> {
    info!("Bridge: add_render_layer called with atlas_index: {}, opacity: {}", atlas_index, opacity);
    
    // Validate texture_coords
    if texture_coords.len() != 4 {
        return Err(BridgeError::Input {
            code: 2015,
            details: "texture_coords must be a 4-element array [u_min, v_min, u_max, v_max]".to_string()
        });
    }
    
    // Get render loop service
    let service_guard = state.render_loop_service.lock().await;
    let service_arc = service_guard.as_ref()
        .ok_or_else(|| BridgeError::ServiceNotInitialized { 
            code: 5006, 
            details: "GPU rendering service is not initialized. Please initialize the render loop first.".to_string() 
        })?;
    let mut service = service_arc.lock().await;
    
    // Convert Vec to tuple
    let texture_coords_tuple = (
        texture_coords[0],
        texture_coords[1],
        texture_coords[2],
        texture_coords[3]
    );
    
    // Add the layer to render state
    let layer_index = service.add_render_layer(atlas_index, opacity, texture_coords_tuple)
        .map_err(|e| BridgeError::Internal {
            code: 5015,
            details: format!("Failed to add render layer: {}", e),
        })?;
    
    info!("Added render layer {} with atlas index {}", layer_index, atlas_index);
    
    Ok(layer_index)
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.patch_layer")]
async fn patch_layer(
    layer_id: String,
    patch: LayerPatch,
    state: State<'_, BridgeState>
) -> BridgeResult<()> {
    info!("Bridge: patch_layer called for layer {} with patch: {:?}", layer_id, patch);
    
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
    let service_arc = service_guard.as_ref()
        .ok_or_else(|| BridgeError::ServiceNotInitialized { 
            code: 5006, 
            details: "GPU rendering service is not initialized. Please initialize the render loop first.".to_string() 
        })?;
    let mut service = service_arc.lock().await;
    
    // Update opacity if provided
    if let Some(opacity) = patch.opacity {
        // For now, we'll use colormap 0 (grayscale) as default
        // In a full implementation, we'd track the current colormap
        service.update_layer(atlas_layer_idx as usize, opacity, 0)
            .map_err(|e| BridgeError::GpuError {
                code: 5007,
                details: format!("Failed to update layer opacity: {:?}", e),
            })?;
        info!("Updated layer {} (atlas {}) opacity to {}", layer_id, atlas_layer_idx, opacity);
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
        service.set_layer_colormap(atlas_layer_idx as usize, colormap_id)
            .map_err(|e| BridgeError::GpuError {
                code: 5008,
                details: format!("Failed to update layer colormap: {:?}", e),
            })?;
        info!("Updated layer {} colormap to {} (id {})", layer_id, colormap, colormap_id);
    }
    
    // Update intensity window - prefer direct min/max over center/width
    let intensity_update = match (patch.intensity_min, patch.intensity_max) {
        (Some(min), Some(max)) => Some((min, max)),
        _ => {
            // Fall back to window_center/window_width if provided
            match (patch.window_center, patch.window_width) {
                (Some(center), Some(width)) => Some((center - width / 2.0, center + width / 2.0)),
                _ => None
            }
        }
    };
    
    if let Some((intensity_min, intensity_max)) = intensity_update {
        service.update_layer_intensity(atlas_layer_idx as usize, intensity_min, intensity_max)
            .map_err(|e| BridgeError::GpuError {
                code: 5009,
                details: format!("Failed to update layer intensity window: {:?}", e),
            })?;
        info!("Updated layer {} intensity window: min={}, max={}", 
            layer_id, intensity_min, intensity_max);
    }
    
    // Update threshold range if provided
    if let (Some(low), Some(high)) = (patch.threshold_low, patch.threshold_high) {
        service.update_layer_threshold(atlas_layer_idx as usize, low, high)
            .map_err(|e| BridgeError::GpuError {
                code: 5010,
                details: format!("Failed to update layer threshold: {:?}", e),
            })?;
        info!("Updated layer {} threshold: low={}, high={}", layer_id, low, high);
    }
    
    Ok(())
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.sample_world_coordinate")]
async fn sample_world_coordinate(
    handle_id: String,
    world_coords: Vec<f32>, // 3 elements for world position
    state: State<'_, BridgeState>
) -> BridgeResult<f32> {
    info!("Bridge: sample_world_coordinate called for handle {} at {:?}", handle_id, world_coords);
    
    // Validate input
    if world_coords.len() != 3 {
        return Err(BridgeError::Input {
            code: 2016,
            details: "world_coords must be a 3-element array for [x, y, z] position".to_string()
        });
    }
    
    // Get the volume handle
    let registry = state.volume_registry.lock().await;
    let volume_data = registry.get(&handle_id)
        .ok_or_else(|| BridgeError::VolumeNotFound { 
            code: 4001, 
            details: format!("Volume handle {} not found", handle_id) 
        })?;
    
    // Convert world coordinates to voxel coordinates
    let world_to_voxel = match volume_data {
        VolumeSendable::VolF32(_vol, affine) => affine.inverse(),
        VolumeSendable::VolF64(_vol, affine) => affine.inverse(),
        VolumeSendable::VolI16(_vol, affine) => affine.inverse(),
        VolumeSendable::VolI32(_vol, affine) => affine.inverse(),
        VolumeSendable::VolU8(_vol, affine) => affine.inverse(),
        VolumeSendable::VolU16(_vol, affine) => affine.inverse(),
        VolumeSendable::VolI8(_vol, affine) => affine.inverse(),
        VolumeSendable::VolU32(_vol, affine) => affine.inverse(),
    };
    
    // Transform world to voxel
    let world_point = nalgebra::Point3::new(world_coords[0], world_coords[1], world_coords[2]);
    let voxel_point = world_to_voxel.transform_point(&world_point);
    let voxel_coords = [
        voxel_point.x,
        voxel_point.y,
        voxel_point.z
    ];
    
    info!("Transformed world {:?} to voxel {:?}", world_coords, voxel_coords);
    
    // Check bounds and sample
    let value = match volume_data {
        VolumeSendable::VolF32(vol, _) => {
            let dims = vol.space().dims();
            if voxel_coords[0] >= 0.0 && voxel_coords[0] < dims[0] as f32 &&
               voxel_coords[1] >= 0.0 && voxel_coords[1] < dims[1] as f32 &&
               voxel_coords[2] >= 0.0 && voxel_coords[2] < dims[2] as f32 {
                // Use nearest neighbor interpolation
                let x = voxel_coords[0].round() as usize;
                let y = voxel_coords[1].round() as usize;
                let z = voxel_coords[2].round() as usize;
                vol.get_at_coords(&[x, y, z]).unwrap_or(0.0)
            } else {
                0.0 // Out of bounds
            }
        },
        VolumeSendable::VolF64(vol, _) => {
            let dims = vol.space().dims();
            if voxel_coords[0] >= 0.0 && voxel_coords[0] < dims[0] as f32 &&
               voxel_coords[1] >= 0.0 && voxel_coords[1] < dims[1] as f32 &&
               voxel_coords[2] >= 0.0 && voxel_coords[2] < dims[2] as f32 {
                let x = voxel_coords[0].round() as usize;
                let y = voxel_coords[1].round() as usize;
                let z = voxel_coords[2].round() as usize;
                vol.get_at_coords(&[x, y, z]).map(|v| v as f32).unwrap_or(0.0)
            } else {
                0.0
            }
        },
        VolumeSendable::VolI16(vol, _) => {
            let dims = vol.space().dims();
            if voxel_coords[0] >= 0.0 && voxel_coords[0] < dims[0] as f32 &&
               voxel_coords[1] >= 0.0 && voxel_coords[1] < dims[1] as f32 &&
               voxel_coords[2] >= 0.0 && voxel_coords[2] < dims[2] as f32 {
                let x = voxel_coords[0].round() as usize;
                let y = voxel_coords[1].round() as usize;
                let z = voxel_coords[2].round() as usize;
                vol.get_at_coords(&[x, y, z]).map(|v| v as f32).unwrap_or(0.0)
            } else {
                0.0
            }
        },
        VolumeSendable::VolI32(vol, _) => {
            let dims = vol.space().dims();
            if voxel_coords[0] >= 0.0 && voxel_coords[0] < dims[0] as f32 &&
               voxel_coords[1] >= 0.0 && voxel_coords[1] < dims[1] as f32 &&
               voxel_coords[2] >= 0.0 && voxel_coords[2] < dims[2] as f32 {
                let x = voxel_coords[0].round() as usize;
                let y = voxel_coords[1].round() as usize;
                let z = voxel_coords[2].round() as usize;
                vol.get_at_coords(&[x, y, z]).map(|v| v as f32).unwrap_or(0.0)
            } else {
                0.0
            }
        },
        VolumeSendable::VolU8(vol, _) => {
            let dims = vol.space().dims();
            if voxel_coords[0] >= 0.0 && voxel_coords[0] < dims[0] as f32 &&
               voxel_coords[1] >= 0.0 && voxel_coords[1] < dims[1] as f32 &&
               voxel_coords[2] >= 0.0 && voxel_coords[2] < dims[2] as f32 {
                let x = voxel_coords[0].round() as usize;
                let y = voxel_coords[1].round() as usize;
                let z = voxel_coords[2].round() as usize;
                vol.get_at_coords(&[x, y, z]).map(|v| v as f32).unwrap_or(0.0)
            } else {
                0.0
            }
        },
        VolumeSendable::VolU16(vol, _) => {
            let dims = vol.space().dims();
            if voxel_coords[0] >= 0.0 && voxel_coords[0] < dims[0] as f32 &&
               voxel_coords[1] >= 0.0 && voxel_coords[1] < dims[1] as f32 &&
               voxel_coords[2] >= 0.0 && voxel_coords[2] < dims[2] as f32 {
                let x = voxel_coords[0].round() as usize;
                let y = voxel_coords[1].round() as usize;
                let z = voxel_coords[2].round() as usize;
                vol.get_at_coords(&[x, y, z]).map(|v| v as f32).unwrap_or(0.0)
            } else {
                0.0
            }
        },
        VolumeSendable::VolI8(vol, _) => {
            let dims = vol.space().dims();
            if voxel_coords[0] >= 0.0 && voxel_coords[0] < dims[0] as f32 &&
               voxel_coords[1] >= 0.0 && voxel_coords[1] < dims[1] as f32 &&
               voxel_coords[2] >= 0.0 && voxel_coords[2] < dims[2] as f32 {
                let x = voxel_coords[0].round() as usize;
                let y = voxel_coords[1].round() as usize;
                let z = voxel_coords[2].round() as usize;
                vol.get_at_coords(&[x, y, z]).map(|v| v as f32).unwrap_or(0.0)
            } else {
                0.0
            }
        },
        VolumeSendable::VolU32(vol, _) => {
            let dims = vol.space().dims();
            if voxel_coords[0] >= 0.0 && voxel_coords[0] < dims[0] as f32 &&
               voxel_coords[1] >= 0.0 && voxel_coords[1] < dims[1] as f32 &&
               voxel_coords[2] >= 0.0 && voxel_coords[2] < dims[2] as f32 {
                let x = voxel_coords[0].round() as usize;
                let y = voxel_coords[1].round() as usize;
                let z = voxel_coords[2].round() as usize;
                vol.get_at_coords(&[x, y, z]).map(|v| v as f32).unwrap_or(0.0)
            } else {
                0.0
            }
        },
    };
    
    info!("Sampled value: {} at voxel coords {:?}", value, voxel_coords);
    
    Ok(value)
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.clear_render_layers")]
async fn clear_render_layers(state: State<'_, BridgeState>) -> BridgeResult<()> {
    info!("Bridge: clear_render_layers called");
    
    // Get render loop service
    let service_guard = state.render_loop_service.lock().await;
    let service_arc = service_guard.as_ref()
        .ok_or_else(|| BridgeError::ServiceNotInitialized { 
            code: 5006, 
            details: "GPU rendering service is not initialized. Please initialize the render loop first.".to_string() 
        })?;
    let mut service = service_arc.lock().await;
    
    // Clear all layers
    service.clear_render_layers();
    
    info!("Cleared all render layers");
    Ok(())
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.update_layer_opacity")]
async fn update_layer_opacity(
    layer_index: usize,
    opacity: f32,
    state: State<'_, BridgeState>
) -> BridgeResult<()> {
    info!("Bridge: update_layer_opacity called for layer {} with opacity {}", layer_index, opacity);
    
    // Get render loop service
    let service_guard = state.render_loop_service.lock().await;
    let service_arc = service_guard.as_ref()
        .ok_or_else(|| BridgeError::ServiceNotInitialized { 
            code: 5006, 
            details: "GPU rendering service is not initialized. Please initialize the render loop first.".to_string() 
        })?;
    let mut service = service_arc.lock().await;
    
    // Get current colormap ID to preserve it
    let current_colormap = service.layer_state_manager.get_layer(layer_index)
        .ok_or_else(|| BridgeError::GpuError {
            code: 5016,
            details: format!("Layer {} not found", layer_index),
        })?
        .colormap_id;
    
    // Update opacity while preserving colormap
    service.update_layer(layer_index, opacity, current_colormap)
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
    state: State<'_, BridgeState>
) -> BridgeResult<()> {
    info!("Bridge: update_layer_colormap called for layer {} with colormap {}", layer_index, colormap_id);
    
    // Get render loop service
    let service_guard = state.render_loop_service.lock().await;
    let service_arc = service_guard.as_ref()
        .ok_or_else(|| BridgeError::ServiceNotInitialized { 
            code: 5006, 
            details: "GPU rendering service is not initialized. Please initialize the render loop first.".to_string() 
        })?;
    let mut service = service_arc.lock().await;
    
    // Update colormap
    service.set_layer_colormap(layer_index, colormap_id)
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
    state: State<'_, BridgeState>
) -> BridgeResult<()> {
    info!("Bridge: update_layer_intensity called for layer {} with range [{}, {}]", 
          layer_index, intensity_min, intensity_max);
    
    // Get render loop service
    let service_guard = state.render_loop_service.lock().await;
    let service_arc = service_guard.as_ref()
        .ok_or_else(|| BridgeError::ServiceNotInitialized { 
            code: 5006, 
            details: "GPU rendering service is not initialized. Please initialize the render loop first.".to_string() 
        })?;
    let mut service = service_arc.lock().await;
    
    // Update intensity range
    service.update_layer_intensity(layer_index, intensity_min, intensity_max)
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
    state: State<'_, BridgeState>
) -> BridgeResult<()> {
    info!("Bridge: update_layer_threshold called for layer {} with range [{}, {}]", 
          layer_index, threshold_low, threshold_high);
    
    // Get render loop service
    let service_guard = state.render_loop_service.lock().await;
    let service_arc = service_guard.as_ref()
        .ok_or_else(|| BridgeError::ServiceNotInitialized { 
            code: 5006, 
            details: "GPU rendering service is not initialized. Please initialize the render loop first.".to_string() 
        })?;
    let mut service = service_arc.lock().await;
    
    // Update threshold range
    service.update_layer_threshold(layer_index, threshold_low, threshold_high)
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
    state: State<'_, BridgeState>
) -> BridgeResult<()> {
    info!("Bridge: set_layer_mask called for layer {} with is_mask={}", layer_index, is_mask);
    
    // Get render loop service
    let service_guard = state.render_loop_service.lock().await;
    let service_arc = service_guard.as_ref()
        .ok_or_else(|| BridgeError::ServiceNotInitialized { 
            code: 5006, 
            details: "GPU rendering service is not initialized. Please initialize the render loop first.".to_string() 
        })?;
    let mut service = service_arc.lock().await;
    
    // Set mask flag
    service.set_layer_mask(layer_index, is_mask)
        .map_err(|e| BridgeError::GpuError {
            code: 5020,
            details: format!("Failed to set layer mask flag: {:?}", e),
        })?;
    
    Ok(())
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.request_frame")]
async fn request_frame(
    origin_mm: Vec<f32>,    // 3 elements - view origin in world mm
    u_dir: Vec<f32>,        // 3 elements - unit vector for screen X
    v_dir: Vec<f32>,        // 3 elements - unit vector for screen Y
    pixels_per_mm: f32,     // Scale factor
    viewport_width: u32,    // Viewport width in pixels
    viewport_height: u32,   // Viewport height in pixels
    state: State<'_, BridgeState>
) -> BridgeResult<()> {
    info!("Bridge: request_frame called - viewport {}x{}, scale {}", 
          viewport_width, viewport_height, pixels_per_mm);
    
    // Validate inputs
    if origin_mm.len() != 3 {
        return Err(BridgeError::Input {
            code: 2020,
            details: "origin_mm must be a 3-element array".to_string()
        });
    }
    if u_dir.len() != 3 {
        return Err(BridgeError::Input {
            code: 2021,
            details: "u_dir must be a 3-element array".to_string()
        });
    }
    if v_dir.len() != 3 {
        return Err(BridgeError::Input {
            code: 2022,
            details: "v_dir must be a 3-element array".to_string()
        });
    }
    
    // Get render loop service
    let service_guard = state.render_loop_service.lock().await;
    let service_arc = service_guard.as_ref()
        .ok_or_else(|| BridgeError::ServiceNotInitialized { 
            code: 5006, 
            details: "GPU rendering service is not initialized. Please initialize the render loop first.".to_string() 
        })?;
    let service = service_arc.lock().await;
    
    // Calculate frame parameters
    // The u and v vectors need to be scaled by viewport size and pixels_per_mm
    let u_mm = vec3::scale(
        Vec3 { x: u_dir[0], y: u_dir[1], z: u_dir[2] },
        viewport_width as f32 / pixels_per_mm
    );
    let v_mm = vec3::scale(
        Vec3 { x: v_dir[0], y: v_dir[1], z: v_dir[2] },
        viewport_height as f32 / pixels_per_mm
    );
    
    // Update frame UBO
    service.update_frame_ubo(
        [origin_mm[0], origin_mm[1], origin_mm[2], 1.0],
        [u_mm.x, u_mm.y, u_mm.z, 0.0],
        [v_mm.x, v_mm.y, v_mm.z, 0.0]
    );
    
    Ok(())
}

// Helper module for vector math
mod vec3 {
    use super::Vec3;
    
    pub fn scale(v: Vec3, s: f32) -> Vec3 {
        Vec3 { x: v.x * s, y: v.y * s, z: v.z * s }
    }
}

// Simple Vec3 type for internal use
#[derive(Debug, Clone, Copy)]
struct Vec3 {
    x: f32,
    y: f32,
    z: f32,
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.render_to_image")]
async fn render_to_image(state: State<'_, BridgeState>) -> BridgeResult<String> {
    info!("Bridge: render_to_image called");
    
    // Get render loop service
    let service_guard = state.render_loop_service.lock().await;
    let service_arc = service_guard.as_ref()
        .ok_or_else(|| BridgeError::ServiceNotInitialized { 
            code: 5006, 
            details: "GPU rendering service is not initialized. Please initialize the render loop first.".to_string() 
        })?;
    let mut service = service_arc.lock().await;
    
    // Render to buffer and get raw RGBA data
    let image_data = service.render_to_buffer()
        .map_err(|e| BridgeError::GpuError { 
            code: 5014, 
            details: format!("Failed to render to image buffer: {}", e) 
        })?;
    
    // Convert RGBA to base64 data URL
    // Format: data:image/png;base64,<base64-encoded-png>
    // For now, we'll return raw RGBA as base64 (frontend can handle conversion)
    use base64::{Engine as _, engine::general_purpose};
    let base64_data = general_purpose::STANDARD.encode(&image_data);
    let data_url = format!("data:image/raw-rgba;base64,{}", base64_data);
    
    info!("Rendered image to buffer, size: {} bytes", image_data.len());
    
    // Log first few pixels for debugging - check if all zeros
    if image_data.len() >= 16 {
        info!("First 4 pixels (RGBA): {:?}, {:?}, {:?}, {:?}",
            &image_data[0..4], &image_data[4..8], &image_data[8..12], &image_data[12..16]);
        
        // Check if all pixels are black
        let all_black = image_data.iter().all(|&x| x == 0);
        if all_black {
            log::warn!("WARNING: All pixels are black (0,0,0,0)!");
        }
        
        // Log some non-zero pixels if they exist
        let non_zero_count = image_data.iter().filter(|&&x| x != 0).count();
        info!("Non-zero pixel values: {} out of {}", non_zero_count, image_data.len());
    }
    
    Ok(data_url)
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.render_to_image_binary")]
async fn render_to_image_binary(state: State<'_, BridgeState>) -> BridgeResult<Vec<u8>> {
    info!("Bridge: render_to_image_binary called");
    
    // Get render loop service
    let service_guard = state.render_loop_service.lock().await;
    let service_arc = service_guard.as_ref()
        .ok_or_else(|| BridgeError::ServiceNotInitialized { 
            code: 5006, 
            details: "GPU rendering service is not initialized. Please initialize the render loop first.".to_string() 
        })?;
    let mut service = service_arc.lock().await;
    
    // Get render target dimensions
    let (width, height) = service.get_render_target_size()
        .ok_or_else(|| BridgeError::Internal {
            code: 5021,
            details: "No render target created. Call create_offscreen_render_target first.".to_string()
        })?;
    
    // Render to buffer and get raw RGBA data
    let rgba_data = service.render_to_buffer()
        .map_err(|e| BridgeError::GpuError { 
            code: 5014, 
            details: format!("Failed to render to image buffer: {}", e) 
        })?;
    
    // Convert RGBA to PNG using the image crate
    use image::{ImageBuffer, Rgba, ImageEncoder};
    use image::codecs::png::PngEncoder;
    use std::io::Cursor;
    
    // Create an image buffer from the RGBA data
    let img_buffer: ImageBuffer<Rgba<u8>, Vec<u8>> = 
        ImageBuffer::from_raw(width, height, rgba_data)
            .ok_or_else(|| BridgeError::Internal {
                code: 5022,
                details: format!("Failed to create image buffer from RGBA data. Width: {}, Height: {}", width, height)
            })?;
    
    info!("Created image buffer successfully");
    
    // Encode to PNG with fast compression settings
    let mut png_data = Vec::new();
    let mut encoder = PngEncoder::new_with_quality(
        Cursor::new(&mut png_data),
        image::codecs::png::CompressionType::Fast,
        image::codecs::png::FilterType::NoFilter
    );
    encoder.write_image(
        img_buffer.as_raw(),
        width,
        height,
        image::ExtendedColorType::Rgba8
    ).map_err(|e| BridgeError::Internal {
        code: 5023,
        details: format!("Failed to encode PNG: {}", e)
    })?;
    
    info!("Encoded image to PNG, size: {} bytes ({}x{})", png_data.len(), width, height);
    
    Ok(png_data)
}

// Helper function to allocate GPU resources for a layer on-demand
async fn allocate_gpu_resources_for_layer(
    layer_id: &str,
    volume_id: &str,
    state: &BridgeState,
    render_service: &mut RenderLoopService,
) -> BridgeResult<VolumeLayerGpuInfo> {
    info!("Allocating GPU resources on-demand for layer '{}' (volume '{}')", layer_id, volume_id);
    
    // Get the volume data from registry
    let volume_registry_guard = state.volume_registry.lock().await;
    let volume_data = volume_registry_guard.get(volume_id)
        .ok_or_else(|| BridgeError::VolumeNotFound {
            code: 4042,
            details: format!("Volume '{}' not found. Please load the volume first.", volume_id)
        })?;
    
    // Calculate min/max values and upload to GPU
    let (atlas_idx, world_to_voxel, min_val, max_val) = match volume_data {
        VolumeSendable::VolF32(vol, _) => {
            let (idx, w2v) = render_service.upload_volume_3d(vol)
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
        },
        VolumeSendable::VolI16(vol, _) => {
            let (idx, w2v) = render_service.upload_volume_3d(vol)
                .map_err(|e| gpu_allocation_error(layer_id, &e.to_string()))?;
            let mut min = i16::MAX as f32;
            let mut max = i16::MIN as f32;
            for v in vol.data().iter() {
                let val = *v as f32;
                min = min.min(val);
                max = max.max(val);
            }
            (idx, w2v, min, max)
        },
        VolumeSendable::VolU8(vol, _) => {
            let (idx, w2v) = render_service.upload_volume_3d(vol)
                .map_err(|e| gpu_allocation_error(layer_id, &e.to_string()))?;
            let mut min = 255.0f32;
            let mut max = 0.0f32;
            for v in vol.data().iter() {
                let val = *v as f32;
                min = min.min(val);
                max = max.max(val);
            }
            (idx, w2v, min, max)
        },
        VolumeSendable::VolI8(vol, _) => {
            let (idx, w2v) = render_service.upload_volume_3d(vol)
                .map_err(|e| gpu_allocation_error(layer_id, &e.to_string()))?;
            let mut min = i8::MAX as f32;
            let mut max = i8::MIN as f32;
            for v in vol.data().iter() {
                let val = *v as f32;
                min = min.min(val);
                max = max.max(val);
            }
            (idx, w2v, min, max)
        },
        VolumeSendable::VolU16(vol, _) => {
            let (idx, w2v) = render_service.upload_volume_3d(vol)
                .map_err(|e| gpu_allocation_error(layer_id, &e.to_string()))?;
            let mut min = u16::MAX as f32;
            let mut max = 0.0f32;
            for v in vol.data().iter() {
                let val = *v as f32;
                min = min.min(val);
                max = max.max(val);
            }
            (idx, w2v, min, max)
        },
        VolumeSendable::VolI32(vol, _) => {
            let (idx, w2v) = render_service.upload_volume_3d(vol)
                .map_err(|e| gpu_allocation_error(layer_id, &e.to_string()))?;
            let mut min = i32::MAX as f32;
            let mut max = i32::MIN as f32;
            for v in vol.data().iter() {
                let val = *v as f32;
                min = min.min(val);
                max = max.max(val);
            }
            (idx, w2v, min, max)
        },
        VolumeSendable::VolU32(vol, _) => {
            let (idx, w2v) = render_service.upload_volume_3d(vol)
                .map_err(|e| gpu_allocation_error(layer_id, &e.to_string()))?;
            let mut min = u32::MAX as f32;
            let mut max = 0.0f32;
            for v in vol.data().iter() {
                let val = *v as f32;
                min = min.min(val);
                max = max.max(val);
            }
            (idx, w2v, min, max)
        },
        VolumeSendable::VolF64(vol, _) => {
            let (idx, w2v) = render_service.upload_volume_3d(vol)
                .map_err(|e| gpu_allocation_error(layer_id, &e.to_string()))?;
            let mut min = f32::MAX;
            let mut max = f32::MIN;
            for v in vol.data().iter() {
                let val = *v as f32;
                min = min.min(val);
                max = max.max(val);
            }
            (idx, w2v, min, max)
        },
    };
    
    info!("On-demand allocation computed data range: ({}, {})", min_val, max_val);
    
    // Store the mapping
    {
        let mut layer_map = state.layer_to_atlas_map.lock().await;
        info!("📌 STORING in allocate_gpu_resources_for_layer: layer '{}' -> atlas index {}", layer_id, atlas_idx);
        layer_map.insert(layer_id.to_string(), atlas_idx);
        info!("📌 Layer map now contains {} entries: {:?}", 
              layer_map.len(), layer_map.keys().collect::<Vec<_>>());
    }
    
    // Register the volume with the correct data range
    if let Err(e) = render_service.register_volume_with_range(
        volume_id.to_string(), 
        atlas_idx,
        (min_val, max_val)
    ) {
        warn!("Failed to register volume {} with atlas index {} and range ({}, {}): {:?}", 
              volume_id, atlas_idx, min_val, max_val, e);
    } else {
        info!("Successfully registered volume '{}' with atlas index {} and data range ({}, {})", 
              volume_id, atlas_idx, min_val, max_val);
    }
    
    // Return minimal GPU info - we only need the atlas index for rendering
    Ok(VolumeLayerGpuInfo {
        layer_id: layer_id.to_string(),
        world_to_voxel: [0.0; 16], // Not needed for on-demand allocation
        dim: [1, 1, 1], // Not needed
        pad_slices: 0,
        tex_format: GpuTextureFormat::R32Float,
        atlas_layer_index: atlas_idx,
        slice_info: SliceInfo { // Dummy slice info
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
        data_range: Some(DataRange { min: min_val, max: max_val }),
        source_volume_id: volume_id.to_string(),
        allocated_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs(),
        is_binary_like: (min_val >= 0.0 && max_val <= 1.0) && ((max_val - min_val) <= 1.0),
    })
}

// Internal implementation that supports both PNG and raw RGBA output
async fn apply_and_render_view_state_internal(
    view_state_json: String,
    state: State<'_, BridgeState>,
    return_raw_rgba: bool
) -> BridgeResult<Vec<u8>> {
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
    }
    
    // Log the first 500 chars of the JSON for debugging
    info!("Received ViewState JSON (first 500 chars): {}", 
          &view_state_json.chars().take(500).collect::<String>());
    
    let frontend_state: FrontendViewState = serde_json::from_str(&view_state_json)
        .map_err(|e| {
            error!("Failed to parse ViewState JSON: {}", e);
            error!("JSON that failed to parse: {}", view_state_json);
            BridgeError::Input {
                code: 2016,
                details: format!("Failed to parse view state JSON: {}", e)
            }
        })?;
    let parse_time = parse_start.elapsed();
    
    info!("⏱️  JSON parsing took: {:?}", parse_time);
    info!("Parsed frontend ViewState with {} layers", frontend_state.layers.len());
    
    // Get render loop service
    let service_guard = state.render_loop_service.lock().await;
    let service_arc = service_guard.as_ref()
        .ok_or_else(|| BridgeError::ServiceNotInitialized { 
            code: 5006, 
            details: "GPU rendering service is not initialized. Please initialize the render loop first.".to_string() 
        })?;
    let mut service = service_arc.lock().await;
    
    // Get render target dimensions
    let (width, height) = service.get_render_target_size()
        .ok_or_else(|| BridgeError::Internal {
            code: 5021,
            details: "No render target created. Call create_offscreen_render_target first.".to_string()
        })?;
    
    // Use the requested view if provided, otherwise default to axial
    let (view_plane, width, height) = if let Some(req_view) = &frontend_state.requested_view {
        info!("Using requested view '{}' with dimensions {}x{}", req_view.view_type, req_view.width, req_view.height);
        // The requested view already has the complete frame parameters, so we'll use them directly
        // For now, we still need a view_plane reference for compatibility
        match req_view.view_type.as_str() {
            "sagittal" => (&frontend_state.views.sagittal, req_view.width, req_view.height),
            "coronal" => (&frontend_state.views.coronal, req_view.width, req_view.height),
            _ => (&frontend_state.views.axial, req_view.width, req_view.height),
        }
    } else {
        info!("No specific view requested, using axial view with default dimensions");
        (&frontend_state.views.axial, 512u32, 512u32)
    };
    
    // Convert frontend ViewState to backend ViewState format
    // Build layers for backend ViewState
    let mut backend_layers = Vec::new();
    
    // Debug: log the contents of layer_map
    {
        let layer_map = state.layer_to_atlas_map.lock().await;
        info!("Current layer_to_atlas_map contents:");
        for (layer_id, atlas_idx) in layer_map.iter() {
            info!("  Layer ID '{}' -> atlas index {}", layer_id, atlas_idx);
        }
    }
    
    let layer_processing_start = std::time::Instant::now();
    for layer in &frontend_state.layers {
        info!("Processing layer: id='{}', volumeId='{}', visible={}, opacity={}", 
              layer.id, layer.volume_id, layer.visible, layer.opacity);
        
        // Check both layer.id and layer.volume_id to ensure we find the layer
        if layer.visible && layer.opacity > 0.0 {
            info!("  Layer passes visibility check (visible={}, opacity={})", layer.visible, layer.opacity);
            // Check if this layer has GPU resources allocated
            let atlas_idx = {
                let layer_map = state.layer_to_atlas_map.lock().await;
                
                // Try both layer.id and layer.volume_id as keys
                let found_idx = layer_map.get(&layer.id)
                    .or_else(|| layer_map.get(&layer.volume_id));
                
                if let Some(&idx) = found_idx {
                    info!("✅ CACHE HIT: Layer {} already has GPU resources at atlas index {}", layer.id, idx);
                    idx
                } else {
                    info!("❌ CACHE MISS: Layer '{}' not found in layer_map (tried keys: '{}' and '{}')", 
                          layer.id, layer.id, layer.volume_id);
                    info!("❌ Current layer_map contains {} entries: {:?}", 
                          layer_map.len(), layer_map.keys().collect::<Vec<_>>());
                    
                    drop(layer_map); // Release the lock before allocating
                    
                    // Allocate GPU resources on-demand
                    info!("Allocating GPU resources on-demand for layer '{}', volume '{}'", 
                          layer.id, layer.volume_id);
                    
                    let gpu_alloc_start = std::time::Instant::now();
                    // Allocate GPU resources for this layer
                    let gpu_info = allocate_gpu_resources_for_layer(
                        &layer.id,
                        &layer.volume_id,
                        &state,
                        &mut service
                    ).await?;
                    let gpu_alloc_time = gpu_alloc_start.elapsed();
                    info!("⏱️  GPU resource allocation took: {:?}", gpu_alloc_time);
                    
                    let allocated_idx = gpu_info.atlas_layer_index;
                    info!("Layer {} allocated GPU resources at atlas index {}", layer.id, allocated_idx);
                    allocated_idx
                }
            };
            
            // Volume should already be registered by allocate_gpu_resources_for_layer
            // with the correct data range, so we don't need to register it again
            
            // Map colormap name to ID
            let colormap_id = match layer.colormap.as_str() {
                "gray" => 0,
                "hot" => 1,
                "cool" => 2,
                "red-yellow" => 3,
                "blue-lightblue" => 4,
                "red" => 5,
                "green" => 6,
                "blue" => 7,
                "yellow" => 8,
                "cyan" => 9,
                "magenta" => 10,
                "warm" => 11,
                "cool-warm" => 12,
                "spectral" => 13,
                "turbo" => 14,
                _ => 0, // Default to grayscale
            };
            
            // Map blend mode
            let blend_mode = match layer.blend_mode.as_str() {
                "alpha" => render_loop::render_state::BlendMode::Normal,
                "additive" => render_loop::render_state::BlendMode::Additive,
                "maximum" => render_loop::render_state::BlendMode::Maximum,
                "minimum" => render_loop::render_state::BlendMode::Normal, // Minimum not implemented, use Normal
                _ => render_loop::render_state::BlendMode::Normal,
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
            };
            
            info!("Adding layer to backend ViewState: volume_id={}, opacity={}, colormap={}, intensity=[{}, {}], threshold=[{}, {}]",
                backend_layer.volume_id, backend_layer.opacity, backend_layer.colormap_id,
                backend_layer.intensity_window.0, backend_layer.intensity_window.1,
                layer.threshold[0], layer.threshold[1]);
            
            // Use intensity values directly from frontend - frontend is the single source of truth
            // No validation or modification needed - trust the user's input
            backend_layer.intensity_window = (layer.intensity[0], layer.intensity[1]);
            
            info!("Layer {} using frontend intensity window: [{:.1}, {:.1}]", 
                  backend_layer.volume_id, backend_layer.intensity_window.0, backend_layer.intensity_window.1);
            
            backend_layers.push(backend_layer);
        } else {
            info!("  Layer skipped: visible={}, opacity={} (requires visible=true and opacity>0)", 
                  layer.visible, layer.opacity);
        }
    }
    
    info!("Created {} backend layers for rendering", backend_layers.len());
    
    // CRITICAL: Check if we have any layers before proceeding
    if backend_layers.is_empty() {
        warn!("No backend layers created from {} frontend layers!", frontend_state.layers.len());
        warn!("Frontend layer details:");
        for (idx, layer) in frontend_state.layers.iter().enumerate() {
            warn!("  Layer {}: id='{}', volumeId='{}', visible={}, opacity={}", 
                  idx, layer.id, layer.volume_id, layer.visible, layer.opacity);
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
                    dark_image[idx] = 128;     // R
                    dark_image[idx + 1] = 0;   // G
                    dark_image[idx + 2] = 0;   // B
                    dark_image[idx + 3] = 255; // A
                }
            }
        }
        
        // Convert to PNG
        use image::{ImageBuffer, Rgba, ImageEncoder};
        use image::codecs::png::PngEncoder;
        use std::io::Cursor;
        
        let img_buffer: ImageBuffer<Rgba<u8>, Vec<u8>> = 
            ImageBuffer::from_raw(width as u32, height as u32, dark_image)
                .ok_or_else(|| BridgeError::Internal {
                    code: 5024,
                    details: "Failed to create error image buffer".to_string()
                })?;
        
        let mut png_data = Vec::new();
        let encoder = PngEncoder::new(Cursor::new(&mut png_data));
        encoder.write_image(
            img_buffer.as_raw(),
            width as u32,
            height as u32,
            image::ExtendedColorType::Rgba8
        ).map_err(|e| BridgeError::Internal {
            code: 5025,
            details: format!("Failed to encode error PNG: {}", e)
        })?;
        
        warn!("Returning error image (dark with red border) due to no layers");
        return Ok(png_data);
    }
    
    // Create backend ViewState with exact frame parameters
    let mut backend_view_state = render_loop::view_state::ViewState {
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
                Some([view_plane.origin_mm[0], view_plane.origin_mm[1], view_plane.origin_mm[2], 1.0])
            },
            frame_u_vec: if let Some(req_view) = &frontend_state.requested_view {
                Some(req_view.u_mm)
            } else {
                Some([view_plane.u_mm[0], view_plane.u_mm[1], view_plane.u_mm[2], 0.0])
            },
            frame_v_vec: if let Some(req_view) = &frontend_state.requested_view {
                Some(req_view.v_mm)
            } else {
                Some([view_plane.v_mm[0], view_plane.v_mm[1], view_plane.v_mm[2], 0.0])
            },
        },
        crosshair_world: frontend_state.crosshair.world_mm,
        layers: backend_layers,
        viewport_size: [width, height],
        show_crosshair: frontend_state.crosshair.visible,
    };
    
    info!("Created backend ViewState with {} layers, crosshair at {:?}", 
        backend_view_state.layers.len(), backend_view_state.crosshair_world);
    
    // Debug: Log the exact frame parameters being used
    if let (Some(origin), Some(u_vec), Some(v_vec)) = (
        backend_view_state.camera.frame_origin,
        backend_view_state.camera.frame_u_vec,
        backend_view_state.camera.frame_v_vec,
    ) {
        info!("Frame parameters for rendering:");
        info!("  Origin: [{:.1}, {:.1}, {:.1}, {:.1}]", origin[0], origin[1], origin[2], origin[3]);
        info!("  U vec: [{:.1}, {:.1}, {:.1}, {:.1}]", u_vec[0], u_vec[1], u_vec[2], u_vec[3]);
        info!("  V vec: [{:.1}, {:.1}, {:.1}, {:.1}]", v_vec[0], v_vec[1], v_vec[2], v_vec[3]);
        info!("  Viewport: {}x{}", width, height);
    }
    
    // Log frame parameters
    info!("Frame parameters - origin: {:?}, u: {:?}, v: {:?}", 
        view_plane.origin_mm, view_plane.u_mm, view_plane.v_mm);
    
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
    let frame_result = service.request_frame(
        render_loop::view_state::ViewId::new("frontend_view"),
        backend_view_state
    ).await.map_err(|e| BridgeError::GpuError {
        code: 8011,
        details: format!("Failed to render frame: {:?}", e),
    })?;
    let render_time = render_start.elapsed();
    info!("⏱️  GPU render (request_frame) took: {:?}", render_time);
    
    info!("Frame rendered successfully: {}x{}, {} bytes, {} layers rendered",
        frame_result.dimensions[0], frame_result.dimensions[1], 
        frame_result.image_data.len(), frame_result.rendered_layers.len());
    
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
            let center_pixel = &frame_result.image_data[center_idx..center_idx+4];
            info!("Center pixel RGBA: [{}, {}, {}, {}]", 
                center_pixel[0], center_pixel[1], center_pixel[2], center_pixel[3]);
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
        
        info!("Pixel sampling: {}/{} non-black pixels ({:.1}%), max value: {}", 
            non_black_count, total_samples, non_black_percentage, max_value);
        
        if non_black_percentage < 5.0 {
            warn!("Rendered image appears to be mostly black! Check intensity window settings.");
        }
    }
    
    // Get dimensions from frame result
    let width = frame_result.dimensions[0];
    let height = frame_result.dimensions[1];
    let rgba_data = frame_result.image_data;
    
    // Choose output format based on flag
    let result = if return_raw_rgba {
        // Raw RGBA path - no PNG encoding
        info!("🚀 RAW RGBA: Skipping PNG encoding, returning raw pixel data");
        
        // Create a buffer with format: [width: u32][height: u32][rgba_data...]
        let mut raw_buffer = Vec::with_capacity(8 + rgba_data.len());
        
        // Write dimensions as little-endian u32
        raw_buffer.extend_from_slice(&width.to_le_bytes());
        raw_buffer.extend_from_slice(&height.to_le_bytes());
        
        // Append RGBA data
        raw_buffer.extend_from_slice(&rgba_data);
        
        info!("🚀 RAW RGBA: Returning {} bytes (8 byte header + {} RGBA bytes)", 
              raw_buffer.len(), rgba_data.len());
        
        raw_buffer
    } else {
        // PNG encoding path
        let png_encode_start = std::time::Instant::now();
        use image::{ImageBuffer, Rgba, ImageEncoder};
        use image::codecs::png::PngEncoder;
        use std::io::Cursor;
        
        // Create an image buffer from the RGBA data
        let img_buffer: ImageBuffer<Rgba<u8>, Vec<u8>> = 
            ImageBuffer::from_raw(width, height, rgba_data)
                .ok_or_else(|| BridgeError::Internal {
                    code: 5022,
                    details: format!("Failed to create image buffer from RGBA data. Width: {}, Height: {}", width, height)
                })?;
        
        // Encode to PNG with fast compression settings
        let mut png_data = Vec::new();
        let mut encoder = PngEncoder::new_with_quality(
            Cursor::new(&mut png_data),
            image::codecs::png::CompressionType::Fast,
            image::codecs::png::FilterType::NoFilter
        );
        encoder.write_image(
            img_buffer.as_raw(),
            width,
            height,
            image::ExtendedColorType::Rgba8
        ).map_err(|e| BridgeError::Internal {
            code: 5023,
            details: format!("Failed to encode PNG: {}", e)
        })?;
        
        let png_encode_time = png_encode_start.elapsed();
        info!("⏱️  PNG encoding took: {:?}", png_encode_time);
        info!("Backend: Encoded RGBA to PNG - {} bytes ({}x{})", png_data.len(), width, height);
        
        png_data
    };
    
    let total_time = total_start.elapsed();
    info!("⏱️  TOTAL apply_and_render_view_state_internal time: {:?}", total_time);
    info!("⏱️  Mode: {}, Total size: {} bytes", 
          if return_raw_rgba { "RAW RGBA" } else { "PNG" }, 
          result.len());
    
    Ok(result)
}

// Public command for PNG output (default, legacy path)
#[command]
#[tracing::instrument(skip_all, err, name = "api.apply_and_render_view_state")]
async fn apply_and_render_view_state(
    view_state_json: String,
    state: State<'_, BridgeState>
) -> BridgeResult<Vec<u8>> {
    info!("📊 PNG PATH: apply_and_render_view_state called (JSON serialization)");
    apply_and_render_view_state_internal(view_state_json, state, false).await
}

// Binary-optimized version that returns PNG with binary IPC
#[command]
#[tracing::instrument(skip_all, err, name = "api.apply_and_render_view_state_binary")]
async fn apply_and_render_view_state_binary(
    view_state_json: String,
    state: State<'_, BridgeState>
) -> Result<tauri::ipc::Response, BridgeError> {
    info!("🚀 BINARY IPC PATH: apply_and_render_view_state_binary called");
    info!("🚀 This uses Tauri's raw binary transfer for PNG data");
    
    // Call internal implementation with PNG output
    let png_data = apply_and_render_view_state_internal(view_state_json, state, false).await?;
    
    info!("🚀 BINARY IPC: PNG data size: {} bytes", png_data.len());
    info!("🚀 BINARY IPC: Wrapping in tauri::ipc::Response for zero-copy transfer");
    
    // Wrap in Response to signal raw binary transfer (no JSON serialization)
    Ok(tauri::ipc::Response::new(png_data))
}

// Raw RGBA version - no PNG encoding, just raw pixel data
#[command]
#[tracing::instrument(skip_all, err, name = "api.apply_and_render_view_state_raw")]
async fn apply_and_render_view_state_raw(
    view_state_json: String,
    state: State<'_, BridgeState>
) -> Result<tauri::ipc::Response, BridgeError> {
    info!("🚀 RAW RGBA PATH: apply_and_render_view_state_raw called");
    info!("🚀 This returns raw RGBA data without PNG encoding");
    
    // Call internal implementation with raw RGBA output
    let raw_data = apply_and_render_view_state_internal(view_state_json, state, true).await?;
    
    info!("🚀 RAW RGBA: Returning {} bytes of raw pixel data", raw_data.len());
    
    Ok(tauri::ipc::Response::new(raw_data))
}

// --- Plugin Creation ---
pub fn create_plugin<R: Runtime>() -> TauriPlugin<R> {
    plugin()
}

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("api-bridge")
        .invoke_handler(generate_handler![
            load_file,
            get_volume_bounds,
            world_to_voxel,
            get_timeseries_matrix,
            get_initial_views,
            request_layer_gpu_resources,
            release_layer_gpu_resources,
            fs_list_directory,
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
            request_frame,
            render_frame,
            render_to_image,
            render_to_image_binary,
            apply_and_render_view_state,
            apply_and_render_view_state_binary,
            apply_and_render_view_state_raw,
            add_render_layer,
            patch_layer,
            sample_world_coordinate,
        ])
        .setup(|app, _| {
            // Initialize the bridge state
            let bridge_state = BridgeState::default();
            app.manage(bridge_state);
            Ok(())
        })
        .build()
}

// --- Unit Tests ---
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use volmath::{DenseVolume3, NeuroSpace3};
    use nalgebra::Affine3;

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
        let _state = BridgeState::default();
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
        use std::fs::File;
        use flate2::read::GzDecoder;
        let file = File::open(&test_file).unwrap();
        let reader = GzDecoder::new(file);
        let (volume_sendable, _affine) = nifti_loader::load_nifti_volume(reader).unwrap();
        
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
        let state = BridgeState::default();
        
        // Test that registry starts empty
        let registry = state.volume_registry.try_lock().unwrap();
        assert_eq!(registry.len(), 0);
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
        let space_impl = volmath::NeuroSpaceExt::from_dims_spacing_origin(
            vec![100, 120, 80],       // dims
            vec![1.0, 1.0, 1.0],      // spacing
            vec![0.0, 0.0, 0.0],      // origin
        ).expect("Failed to create NeuroSpace");
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
        let space_impl = volmath::NeuroSpaceExt::from_dims_spacing_origin(
            vec![100, 120, 80],       // dims
            vec![1.0, 1.0, 1.0],      // spacing
            vec![0.0, 0.0, 0.0],      // origin
        ).expect("Failed to create NeuroSpace");
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
        let space_impl = volmath::NeuroSpaceExt::from_dims_spacing_origin(
            vec![100, 120, 80],       // dims
            vec![1.0, 1.0, 1.0],      // spacing
            vec![0.0, 0.0, 0.0],      // origin
        ).expect("Failed to create NeuroSpace");
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
        let space_impl = volmath::NeuroSpaceExt::from_dims_spacing_origin(
            vec![100, 120, 80],       // dims
            vec![1.0, 1.0, 1.0],      // spacing
            vec![0.0, 0.0, 0.0],      // origin
        ).expect("Failed to create NeuroSpace");
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
        let space_impl = volmath::NeuroSpaceExt::from_dims_spacing_origin(
            vec![100, 120, 80],       // dims
            vec![1.0, 1.0, 1.0],      // spacing
            vec![0.0, 0.0, 0.0],      // origin
        ).expect("Failed to create NeuroSpace");
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
        let state = BridgeState::default();
        
        // Test that map starts empty
        let layer_map = state.layer_to_atlas_map.try_lock().unwrap();
        assert_eq!(layer_map.len(), 0);
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