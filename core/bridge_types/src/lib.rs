// core/bridge_types/src/lib.rs
// This crate will hold shared types and traits to break the cyclic dependency
// between api_bridge and loader crates.

use serde::{Serialize, Deserialize};
use thiserror::Error;
use volmath::{DenseVolume3, VolumeMathError};
use render_loop::RenderLoopError;
use nalgebra::Affine3;
use std::path::Path;

// --- Import for ts-rs ---
use ts_rs::TS;

// --- Moved from nifti_loader --- 
#[derive(Debug, Clone, PartialEq, Serialize)]
pub enum VolumeSendable {
    VolF32(DenseVolume3<f32>, Affine3<f32>),
    VolI16(DenseVolume3<i16>, Affine3<f32>),
    VolU8(DenseVolume3<u8>, Affine3<f32>),
    VolI8(DenseVolume3<i8>, Affine3<f32>),
    VolU16(DenseVolume3<u16>, Affine3<f32>),
    VolI32(DenseVolume3<i32>, Affine3<f32>),
    VolU32(DenseVolume3<u32>, Affine3<f32>),
    VolF64(DenseVolume3<f64>, Affine3<f32>),
}

// --- Moved/Defined Shared API Types --- 

// --- BridgeError (Replaced with BF-TB-01 / Plan v1.2 definition) ---
#[derive(Debug, Error, Serialize, Clone, TS)]
#[ts(export)]
pub enum BridgeError {
    #[error("I/O Error: {details}")]
    Io { code: u16, details: String },

    #[error("Loading Error: {details}")]
    Loader { code: u16, details: String },

    #[error("Permission Denied: {path}")]
    Scope { code: u16, path: String },

    #[error("Invalid Input: {details}")]
    Input { code: u16, details: String },

    #[error("Internal Error: {details}")]
    Internal { code: u16, details: String },

    // Adding back placeholders for existing error sources, to be mapped into above categories
    // TODO: Implement From traits or mapping logic to convert external errors
    #[error("Volume operation failed: {details}")]
    VolumeError { code: u16, details: String }, // Map VolumeMathError here

    #[error("GPU operation failed: {details}")]
    GpuError { code: u16, details: String }, // Map GpuUploadError, WgpuInitError, RenderLoopError here

    #[error("Volume not found in registry: {details}")]
    VolumeNotFound { code: u16, details: String },

    #[error("Service not initialized: {details}")]
    ServiceNotInitialized { code: u16, details: String },
}

// --- From Implementations for BridgeError ---

// Example for mapping NiftiError (already present in nifti_loader)
// impl From<NiftiError> for BridgeError { ... }

// Add From<RenderLoopError>
impl From<RenderLoopError> for BridgeError {
    fn from(err: RenderLoopError) -> Self {
        // Map RenderLoopError variants to appropriate BridgeError::GpuError variants
        // Add codes as needed
        BridgeError::GpuError { code: 6001, details: err.to_string() }
    }
}

// Add From<GpuUploadError>
impl From<GpuUploadError> for BridgeError {
    fn from(err: GpuUploadError) -> Self {
         // Map GpuUploadError variants to appropriate BridgeError::GpuError variants
         // Add codes as needed
         BridgeError::GpuError { code: 6002, details: err.to_string() }
    }
}

// Add From<std::io::Error>
impl From<std::io::Error> for BridgeError {
    fn from(err: std::io::Error) -> Self {
        BridgeError::Io { 
            code: 1001, 
            details: err.to_string() 
        }
    }
}

// Add From<VolumeMathError>
impl From<VolumeMathError> for BridgeError {
    fn from(err: VolumeMathError) -> Self {
        BridgeError::VolumeError { 
            code: 5001, 
            details: err.to_string() 
        }
    }
}

// --- End From Implementations ---

// Helper alias for Result
pub type BridgeResult<T> = Result<T, BridgeError>;

// --- Loaded Enum (New from BF-TB-01 / Plan v1.2) ---
#[derive(Debug, Serialize, Clone, TS)]
#[ts(export)]
#[serde(tag = "type", content = "data")] // Use type/data for clarity
pub enum Loaded {
    Volume { dims: [u16; 3], dtype: String, path: String },
    Table { rows: usize, cols: usize, path: String },
    Image2D { width: u32, height: u32, path: String },
    Metadata { path: String, loader_type: String },
}

impl Loaded {
   // Helper to get the kind easily if needed, though serde tag handles it
   pub fn kind(&self) -> &'static str {
       match self {
           Loaded::Volume { .. } => "Volume",
           Loaded::Table { .. } => "Table",
           Loaded::Image2D { .. } => "Image2D",
           Loaded::Metadata { .. } => "Metadata",
       }
   }
}

// --- Loader Trait (Replaced with BF-TB-01 / Plan v1.2 definition) ---

// Sealed trait pattern
pub mod private { pub trait Sealed {} } // Make module public for impl in other crates

pub trait Loader: private::Sealed + Send + Sync + 'static {
    /// Returns true if the loader can handle the file at the given path.
    /// Checks extensions, magic bytes, etc. Should be fast.
    fn can_load(path: &Path) -> bool where Self: Sized;

    /// Loads the file, returning structured metadata.
    fn load(path: &Path) -> BridgeResult<Loaded> where Self: Sized;

    // Optional: Add methods for file type ID, supported extensions etc.
    // const TYPE_ID: u8;
    // fn supported_extensions() -> &'static [&'static str];
}

// --- GPU Upload Error Enum (matches ADR-002) ---
#[derive(Debug, Error, Serialize, TS)]
#[ts(export)]
#[serde(tag = "code", content = "detail")] // For structured serialization to TS
pub enum GpuUploadError {
    #[error("GPU Out of Memory: Needed {needed_mb:.1} MB, Limit ~{limit_mb:.1} MB")]
    OutOfMemory { needed_mb: f32, limit_mb: f32 },
    #[error("Texture dimensions exceed limits: Dim {dim:?}, Max Size {max_dim}")]
    TextureTooLarge { dim: [u32; 3], max_dim: u32 },
    #[error("Unsupported source volume format/dtype: {dtype}")]
    UnsupportedFormat { dtype: String }, // Based on Volume<D>::Scalar
    #[error("Volume not found in registry: {volume_id}")]
    VolumeNotFound { volume_id: String }, // volume_id likely comes from VolumeHandle
    #[error("Volume data is not stored densely and cannot be directly uploaded to GPU: {volume_id}")]
    NotDense { volume_id: String }, // When as_bytes() returns None
    #[error("WGPU Error: {message}")]
    WgpuError { message: String },
}

// --- Structures for API Communication --- 

/// GPU texture format strings (matching ADR-002)
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub enum GpuTextureFormat {
    R8Unorm,
    R16Float,
    R32Float,
    RGBA8Unorm,
}

/// Information about GPU resources allocated for a volume layer (matches VolumeLayerGPU in ADR-002)
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct VolumeLayerGpuInfo {
    /// Opaque handle/ID for the layer (used by UI)
    pub layer_id: String,
    /// Matrix: LPI World (x,y,z,1) -> Atlas Texture (u,v,slice_idx,w)
    /// Stored as a flat array (row-major)
    pub world_to_voxel: [f32; 16],
    /// Native voxel dimensions [nx, ny, nz]
    pub dim: [u32; 3],
    /// Number of slices packed along the atlas page dimension (often 1 for 2D array texture)
    pub pad_slices: u32,
    /// Actual GPU texture format used
    pub tex_format: GpuTextureFormat,
    
    // --- Enhanced metadata fields ---
    
    /// GPU atlas layer index (which layer in the texture array)
    pub atlas_layer_index: u32,
    
    /// Slice information
    pub slice_info: SliceInfo,
    
    /// Texture coordinates within the atlas layer
    pub texture_coords: TextureCoordinates,
    
    /// Voxel to world transformation matrix (row-major)
    pub voxel_to_world: [f32; 16],
    
    /// Volume origin in world coordinates
    pub origin: [f32; 3],
    
    /// World-space centre of the volume (handy for initial cross-hair)
    pub center_world: [f32; 3],
    
    /// Voxel spacing in mm
    pub spacing: [f32; 3],
    
    /// Data range (min, max values in the slice)
    pub data_range: Option<DataRange>,
    
    /// Source volume ID that this layer was created from
    pub source_volume_id: String,
    
    /// Timestamp when this GPU resource was allocated
    pub allocated_at: u64,

    /// Indicates if the volume looks like a binary mask (values 0/1)
    pub is_binary_like: bool,
}

/// Information about which slice was uploaded
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct SliceInfo {
    /// Axis along which the slice was taken (0=X/Sagittal, 1=Y/Coronal, 2=Z/Axial)
    pub axis: u8,
    /// Index of the slice along the axis
    pub index: u32,
    /// Human-readable axis name
    pub axis_name: String,
    /// Slice dimensions [width, height]
    pub dimensions: [u32; 2],
}

/// Metadata about slices along a specific axis
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SliceAxisMeta {
    /// Total number of slices along this axis
    pub slice_count: u32,
    /// Spacing between slices in mm
    pub slice_spacing: f32,
    /// Total length of the axis in mm
    pub axis_length_mm: f32,
}

/// Request for batch rendering multiple slices
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BatchRenderRequest {
    /// List of view states to render (JSON serialized ViewState array)
    pub view_states_json: String,  // Will be ViewState[] from frontend
    /// Width of each slice in pixels
    pub width_per_slice: u32,
    /// Height of each slice in pixels
    pub height_per_slice: u32,
}

/// Texture coordinates within the atlas
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct TextureCoordinates {
    /// Minimum U coordinate (0.0 to 1.0)
    pub u_min: f32,
    /// Minimum V coordinate (0.0 to 1.0)
    pub v_min: f32,
    /// Maximum U coordinate (0.0 to 1.0)
    pub u_max: f32,
    /// Maximum V coordinate (0.0 to 1.0)
    pub v_max: f32,
}

/// Data range in the slice
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct DataRange {
    /// Minimum value in the slice
    pub min: f32,
    /// Maximum value in the slice
    pub max: f32,
}

/// Patch for updating layer properties
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct LayerPatch {
    pub opacity: Option<f32>,
    pub colormap: Option<String>,
    pub window_center: Option<f32>,
    pub window_width: Option<f32>,
    pub intensity_min: Option<f32>,
    pub intensity_max: Option<f32>,
    pub threshold_low: Option<f32>,
    pub threshold_high: Option<f32>,
    pub threshold_mode: Option<String>, // "range" or "absolute"
    pub blend_mode: Option<String>,
}

// --- Tree Browser Payload Types (New for BF-TB-02 / Plan v1.2) ---

/// Represents a node in the file tree, optimized for flat list transfer
#[derive(Debug, Serialize, Clone, TS)]
#[ts(export)]
pub struct FlatNode {
    pub id: String,           // Full path (unique identifier)
    pub name: String,         // File/Dir name
    pub parent_idx: Option<usize>, // Index of the parent in the flat list, None for roots
    pub icon_id: u8,          // Numeric ID for icon type (mapped in Rust)
    pub is_dir: bool,
    // Add other minimal metadata needed for display (e.g., file size, modified date)
    // pub size: Option<u64>,
}

/// The payload returned by the fs_list_directory command
#[derive(Debug, Serialize, Clone, Default, TS)]
#[ts(export)]
pub struct TreePayload {
    pub nodes: Vec<FlatNode>,
    // Optional: Can include icon mapping here if needed by TS
    // pub icon_map: std::collections::HashMap<u8, String>,
}

/// Icon ID mapping constants
pub mod icons {
    // NOTE: These constants need corresponding frontend logic (e.g., CSS classes, icon components)
    // to map the numeric ID to a visual representation.
    pub const FOLDER: u8 = 0;
    pub const FILE: u8 = 1;
    pub const NIFTI: u8 = 2;
    pub const GIFTI: u8 = 3;
    // Add more...
    pub const TABLE: u8 = 4; // Example
    pub const IMAGE: u8 = 5; // Example
}

// TODO: Move VolumeHandleInfo and other placeholder types here if needed by loaders. 