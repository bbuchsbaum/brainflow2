// core/bridge_types/src/lib.rs
// This crate will hold shared types and traits to break the cyclic dependency
// between api_bridge and loader crates.

use nalgebra::Affine3;
use render_loop::RenderLoopError;
use serde::{Deserialize, Serialize};
use std::path::Path;
use thiserror::Error;
use volmath::{DenseVolume3, VolumeMathError};

// --- Import for ts-rs ---
use ts_rs::TS;

// --- Moved from nifti_loader ---
#[derive(Debug, Clone, PartialEq, Serialize)]
pub enum VolumeSendable {
    // 3D volume variants
    VolF32(DenseVolume3<f32>, Affine3<f32>),
    VolI16(DenseVolume3<i16>, Affine3<f32>),
    VolU8(DenseVolume3<u8>, Affine3<f32>),
    VolI8(DenseVolume3<i8>, Affine3<f32>),
    VolU16(DenseVolume3<u16>, Affine3<f32>),
    VolI32(DenseVolume3<i32>, Affine3<f32>),
    VolU32(DenseVolume3<u32>, Affine3<f32>),
    VolF64(DenseVolume3<f64>, Affine3<f32>),

    // 4D time series variants (storing full neuroim DenseNeuroVec)
    Vec4DF32(neuroim::DenseNeuroVec<f32>),
    Vec4DI16(neuroim::DenseNeuroVec<i16>),
    Vec4DU8(neuroim::DenseNeuroVec<u8>),
    Vec4DI8(neuroim::DenseNeuroVec<i8>),
    Vec4DU16(neuroim::DenseNeuroVec<u16>),
    Vec4DI32(neuroim::DenseNeuroVec<i32>),
    Vec4DU32(neuroim::DenseNeuroVec<u32>),
    Vec4DF64(neuroim::DenseNeuroVec<f64>),
}

// --- Surface types for GIFTI support ---
/// Handle for referencing a surface geometry in the registry
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SurfaceHandle(pub String);

/// Handle for referencing surface data in the registry
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SurfaceDataHandle(pub String);

/// Content loaded from a GIFTI file
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "type")]
pub enum LoadedContent {
    /// Volume data (NIfTI, etc.)
    Volume {
        handle: String,
        dimensions: [u32; 3],
        voxel_size: [f32; 3],
    },
    /// Surface geometry (GIFTI mesh)
    Surface {
        handle: String,
        vertex_count: usize,
        face_count: usize,
        hemisphere: Option<String>,
        surface_type: Option<String>,
    },
    /// Surface data (activation maps, etc.)
    SurfaceData {
        handle: String,
        data_count: usize,
        intent: String,
    },
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

    #[error("Loader error: {0}")]
    LoaderError(String),
}

// --- From Implementations for BridgeError ---

// Example for mapping NiftiError (already present in nifti_loader)
// impl From<NiftiError> for BridgeError { ... }

// Add From<RenderLoopError>
impl From<RenderLoopError> for BridgeError {
    fn from(err: RenderLoopError) -> Self {
        // Map RenderLoopError variants to appropriate BridgeError::GpuError variants
        // Add codes as needed
        BridgeError::GpuError {
            code: 6001,
            details: err.to_string(),
        }
    }
}

// Add From<GpuUploadError>
impl From<GpuUploadError> for BridgeError {
    fn from(err: GpuUploadError) -> Self {
        // Map GpuUploadError variants to appropriate BridgeError::GpuError variants
        // Add codes as needed
        BridgeError::GpuError {
            code: 6002,
            details: err.to_string(),
        }
    }
}

// Add From<std::io::Error>
impl From<std::io::Error> for BridgeError {
    fn from(err: std::io::Error) -> Self {
        BridgeError::Io {
            code: 1001,
            details: err.to_string(),
        }
    }
}

// Add From<VolumeMathError>
impl From<VolumeMathError> for BridgeError {
    fn from(err: VolumeMathError) -> Self {
        BridgeError::VolumeError {
            code: 5001,
            details: err.to_string(),
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
    Volume {
        dims: [u16; 3],
        dtype: String,
        path: String,
    },
    Table {
        rows: usize,
        cols: usize,
        path: String,
    },
    Image2D {
        width: u32,
        height: u32,
        path: String,
    },
    Metadata {
        path: String,
        loader_type: String,
    },
    Surface {
        handle: SurfaceHandle,
        vertex_count: usize,
        face_count: usize,
        path: String,
    },
    SurfaceData {
        handle: SurfaceDataHandle,
        data_count: usize,
        path: String,
    },
}

impl Loaded {
    // Helper to get the kind easily if needed, though serde tag handles it
    pub fn kind(&self) -> &'static str {
        match self {
            Loaded::Volume { .. } => "Volume",
            Loaded::Table { .. } => "Table",
            Loaded::Image2D { .. } => "Image2D",
            Loaded::Metadata { .. } => "Metadata",
            Loaded::Surface { .. } => "Surface",
            Loaded::SurfaceData { .. } => "SurfaceData",
        }
    }
}

// --- Loader Trait (Replaced with BF-TB-01 / Plan v1.2 definition) ---

// Sealed trait pattern
pub mod private {
    pub trait Sealed {}
} // Make module public for impl in other crates

pub trait Loader: private::Sealed + Send + Sync + 'static {
    /// Returns true if the loader can handle the file at the given path.
    /// Checks extensions, magic bytes, etc. Should be fast.
    fn can_load(path: &Path) -> bool
    where
        Self: Sized;

    /// Loads the file, returning structured metadata.
    fn load(path: &Path) -> BridgeResult<Loaded>
    where
        Self: Sized;

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
    #[error(
        "Volume data is not stored densely and cannot be directly uploaded to GPU: {volume_id}"
    )]
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
    pub view_states_json: String, // Will be ViewState[] from frontend
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
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
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
    pub id: String,                // Full path (unique identifier)
    pub name: String,              // File/Dir name
    pub parent_idx: Option<usize>, // Index of the parent in the flat list, None for roots
    pub icon_id: u8,               // Numeric ID for icon type (mapped in Rust)
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

// --- Remote Mount / SSH Types ---

/// Information about the remote origin backing a mounted folder.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RemoteMountOrigin {
    pub mount_id: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub remote_path: String,
    pub label: String,
}

/// Mounted remote folder metadata returned after a successful SSH mount.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RemoteMountInfo {
    pub mount_id: String,
    pub local_path: String,
    pub display_name: String,
    pub origin: RemoteMountOrigin,
}

/// Input payload for starting a remote SSH mount flow.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RemoteMountConnectRequest {
    pub host: String,
    pub port: Option<u16>,
    pub user: String,
    pub remote_path: String,
    pub auth_method: Option<String>,
    pub password: Option<String>,
    pub key_path: Option<String>,
    pub key_passphrase: Option<String>,
    pub verify_host_key: Option<bool>,
    pub accept_unknown_host_keys: Option<bool>,
    pub known_hosts_path: Option<String>,
    pub remember_password: Option<bool>,
    pub save_profile: Option<bool>,
    pub profile_name: Option<String>,
}

/// Host-key confirmation challenge details from interactive SSH connection flow.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RemoteHostKeyChallenge {
    pub challenge_id: String,
    pub host: String,
    pub port: u16,
    pub algorithm: String,
    pub sha256_fingerprint: String,
    /// "unknown" or "mismatch"
    pub disposition: String,
}

/// Single auth prompt in keyboard-interactive flow.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RemoteAuthPrompt {
    pub prompt: String,
    pub echo: bool,
}

/// Keyboard-interactive auth challenge details.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RemoteAuthChallenge {
    pub conversation_id: String,
    pub name: String,
    pub instructions: String,
    pub prompts: Vec<RemoteAuthPrompt>,
}

/// Result of a remote mount connection step.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum RemoteMountConnectResult {
    Connected { mount: RemoteMountInfo },
    NeedHostKey { challenge: RemoteHostKeyChallenge },
    NeedAuth { challenge: RemoteAuthChallenge },
}

/// Saved remote connection profile metadata.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RemoteMountProfile {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub remote_path: String,
    pub auth_method: String,
    pub verify_host_key: bool,
    pub accept_unknown_host_keys: bool,
    pub known_hosts_path: Option<String>,
    pub has_password: bool,
    pub updated_at_ms: u64,
}

// --- Volume Type Definitions ---

/// Enum to distinguish between 3D volumes and 4D time series
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[ts(export)]
pub enum VolumeType {
    Volume3D,
    TimeSeries4D,
}

/// Metadata for 4D time series
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TimeSeriesInfo {
    /// Number of time points in the series
    pub num_timepoints: usize,
    /// Repetition time in seconds (if available)
    pub tr: Option<f32>,
    /// Time unit (e.g., "seconds", "milliseconds")
    pub temporal_unit: Option<String>,
    /// Total acquisition time in seconds
    pub acquisition_time: Option<f32>,
}

/// Information about a loaded volume (supports both 3D and 4D)
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct VolumeHandleInfo {
    pub id: String,
    pub name: String,
    /// Variable dimensions to support both 3D [x,y,z] and 4D [x,y,z,t]
    pub dims: Vec<usize>,
    pub dtype: String,
    pub volume_type: VolumeType,
    /// For 4D volumes: number of timepoints
    pub num_timepoints: Option<usize>,
    /// For 4D volumes: current timepoint being displayed
    pub current_timepoint: Option<usize>,
    /// Additional time series metadata (if applicable)
    pub time_series_info: Option<TimeSeriesInfo>,
}

/// Surface geometry data for frontend
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SurfaceGeometryData {
    pub vertices: Vec<f32>,
    pub faces: Vec<u32>,
}

/// Detailed NIfTI header metadata for display in the UI
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NiftiHeaderInfo {
    /// File path/name of the NIfTI file
    pub filename: String,
    /// Spatial dimensions [x, y, z] (and optionally time)
    pub dimensions: Vec<usize>,
    /// Voxel size in mm [x, y, z]
    pub voxel_spacing: [f32; 3],
    /// Data type string (e.g. "f32", "i16", "u8")
    pub data_type: String,
    /// 4x4 voxel-to-world affine matrix in row-major order
    pub voxel_to_world: [f32; 16],
    /// Minimum world-space bounding box corner [x, y, z]
    pub world_bounds_min: [f32; 3],
    /// Maximum world-space bounding box corner [x, y, z]
    pub world_bounds_max: [f32; 3],
    /// NIfTI sform code (0 = unknown)
    pub sform_code: u8,
    /// NIfTI qform code (0 = unknown)
    pub qform_code: u8,
    /// Orientation string derived from the affine (e.g. "RAS", "LPI")
    pub orientation_string: String,
    /// Spatial units string (e.g. "mm", "m", "micron")
    pub spatial_units: String,
    /// Temporal units string if applicable
    pub temporal_units: Option<String>,
    /// Repetition time in seconds (for 4D fMRI)
    pub tr_seconds: Option<f32>,
    /// Number of time points (for 4D)
    pub num_timepoints: Option<usize>,
    /// Description string from NIfTI header
    pub description: String,
    /// Min/max data range of the volume
    pub data_range: Option<DataRange>,
}

// --- Surface Template Types ---

/// Surface coordinate space / template
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum SurfaceSpace {
    /// fsaverage (164k vertices, standard FreeSurfer)
    Fsaverage,
    /// fsaverage5 (10k vertices, low resolution)
    Fsaverage5,
    /// fsaverage6 (41k vertices, medium resolution)
    Fsaverage6,
    /// fsaverage7 (164k vertices, same as fsaverage)
    Fsaverage7,
    /// fsLR 32k (HCP standard)
    FsLR32k,
    /// fsLR 164k (HCP high resolution)
    FsLR164k,
}

impl SurfaceSpace {
    /// Convert to templateflow template name
    pub fn template_name(&self) -> &'static str {
        match self {
            Self::Fsaverage => "fsaverage",
            Self::Fsaverage5 => "fsaverage5",
            Self::Fsaverage6 => "fsaverage6",
            Self::Fsaverage7 => "fsaverage7",
            Self::FsLR32k => "fsLR",
            Self::FsLR164k => "fsLR",
        }
    }

    /// Get density string for fsLR templates
    pub fn density(&self) -> Option<&'static str> {
        match self {
            Self::FsLR32k => Some("32k"),
            Self::FsLR164k => Some("164k"),
            _ => None,
        }
    }

    /// Human-readable display name
    pub fn display_name(&self) -> &'static str {
        match self {
            Self::Fsaverage => "fsaverage",
            Self::Fsaverage5 => "fsaverage5",
            Self::Fsaverage6 => "fsaverage6",
            Self::Fsaverage7 => "fsaverage7",
            Self::FsLR32k => "fsLR 32k",
            Self::FsLR164k => "fsLR 164k",
        }
    }

    /// Approximate vertex count per hemisphere
    pub fn vertex_count(&self) -> usize {
        match self {
            Self::Fsaverage => 163842,
            Self::Fsaverage5 => 10242,
            Self::Fsaverage6 => 40962,
            Self::Fsaverage7 => 163842,
            Self::FsLR32k => 32492,
            Self::FsLR164k => 163842,
        }
    }
}

/// Surface geometry type
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum SurfaceGeometryType {
    /// White matter surface
    White,
    /// Pial (gray matter) surface
    Pial,
    /// Inflated surface for visualization
    Inflated,
    /// Spherical surface for registration
    Sphere,
    /// Very inflated surface
    VeryInflated,
    /// Midthickness (halfway between white and pial)
    Midthickness,
}

impl SurfaceGeometryType {
    /// Convert to templateflow suffix
    pub fn as_suffix(&self) -> &'static str {
        match self {
            Self::White => "white",
            Self::Pial => "pial",
            Self::Inflated => "inflated",
            Self::Sphere => "sphere",
            Self::VeryInflated => "veryinflated",
            Self::Midthickness => "midthickness",
        }
    }

    /// Human-readable display name
    pub fn display_name(&self) -> &'static str {
        match self {
            Self::White => "White Matter",
            Self::Pial => "Pial (Gray Matter)",
            Self::Inflated => "Inflated",
            Self::Sphere => "Sphere",
            Self::VeryInflated => "Very Inflated",
            Self::Midthickness => "Midthickness",
        }
    }
}

/// Surface hemisphere
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum SurfaceHemisphere {
    Left,
    Right,
}

impl SurfaceHemisphere {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Left => "L",
            Self::Right => "R",
        }
    }
}

/// Request to load a surface template
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SurfaceTemplateRequest {
    /// Surface space/template
    pub space: SurfaceSpace,
    /// Geometry type (white, pial, inflated, sphere)
    pub geometry_type: SurfaceGeometryType,
    /// Hemisphere
    pub hemisphere: SurfaceHemisphere,
}

/// Result of loading a surface template
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SurfaceTemplateResult {
    pub success: bool,
    pub surface_handle: Option<String>,
    pub vertex_count: Option<usize>,
    pub face_count: Option<usize>,
    pub space: String,
    pub geometry_type: String,
    pub hemisphere: String,
    pub error_message: Option<String>,
}

/// Entry in the surface template catalog
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SurfaceTemplateCatalogEntry {
    pub id: String,
    pub display_name: String,
    pub space: SurfaceSpace,
    pub geometry_type: SurfaceGeometryType,
    pub hemisphere: SurfaceHemisphere,
    pub vertex_count: usize,
}
