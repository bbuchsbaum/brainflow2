// core/bridge_types/src/lib.rs
// This crate will hold shared types and traits to break the cyclic dependency
// between api_bridge and loader crates.

use nalgebra::Affine3;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::path::Path;
use thiserror::Error;
use volmath::{DenseVolume3, VolumeMathError};

// --- Import for ts-rs ---
use ts_rs::TS;

pub mod bids;
pub use bids::*;

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
#[serde(rename_all = "camelCase")]
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
    pub key_path: Option<String>,
    #[serde(default = "default_remote_verify_host_key")]
    pub verify_host_key: bool,
    #[serde(default)]
    pub accept_unknown_host_keys: bool,
    pub known_hosts_path: Option<String>,
    #[serde(default)]
    pub has_password: bool,
    #[serde(default)]
    pub has_key_passphrase: bool,
    #[serde(default)]
    pub updated_at_ms: u64,
}

fn default_remote_verify_host_key() -> bool {
    true
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
    /// Statistic carried by the NIfTI header (intent code or an SPM-style
    /// description). Absent for non-statistical images and non-NIfTI sources.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub statistic: Option<StatisticInfo>,
    /// `true` when the NIfTI header declares a label map (`intent_code` 1002,
    /// `NIFTI_INTENT_LABEL`); absent otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub is_label_map: Option<bool>,
}

/// Statistic family declared by a NIfTI `intent_code`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum StatisticKind {
    /// No intent (`NIFTI_INTENT_NONE`).
    None,
    Z,
    T,
    F,
    Chi2,
    /// Correlation coefficient (`NIFTI_INTENT_CORREL`).
    Correlation,
    /// p-value.
    P,
    /// Natural-log p-value.
    LogP,
    /// log10 p-value.
    Log10P,
    /// Parameter estimate (`NIFTI_INTENT_ESTIMATE`) with an `intent_name`.
    Estimate,
    /// Label/parcellation index (`NIFTI_INTENT_LABEL`). Not a statistic.
    Label,
    /// Another statistical distribution (codes 7-21: beta, binomial, gamma,
    /// Poisson, normal, non-central F/chi2/t, logistic, Laplace, uniform,
    /// Weibull, chi, inverse Gaussian, extreme value).
    Other,
    /// A declared non-statistical intent: an unnamed estimate (1001), 1003-1011
    /// (neuroname, matrices, vectors, pointset, triangle, quaternion,
    /// dimensionless), 2001-2005 (time series, node index, RGB/RGBA, shape) or
    /// an unknown code. Not a statistic; `label` is empty.
    Data,
}

/// Statistic metadata decoded from a NIfTI header, for display units such as
/// "z" or "t(24)".
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StatisticInfo {
    pub kind: StatisticKind,
    /// Raw NIfTI `intent_code` (0 when the kind was inferred from `descrip`).
    pub intent_code: i16,
    /// Raw NIfTI `intent_p1..p3`.
    pub intent_params: [f32; 3],
    /// NIfTI `intent_name` (trimmed; may be empty).
    pub intent_name: String,
    /// Degrees of freedom for t/chi2/correlation (one value) and F (two
    /// values); empty when the kind has none or the header leaves them unset.
    pub dof: Vec<f32>,
    /// Short display label: "z", "t(24)", "F(2,30)", "χ²(3)", "r(18)", "p".
    pub label: String,
    /// True when the kind came from an SPM-style `descrip` such as
    /// `SPM{T_[24.0]}` because `intent_code` was unset.
    pub from_description: bool,
    /// Label to show instead of `label` when every finite value is >= 0, with
    /// a warning that the sign convention is assumed: "−log10(p)" for intent
    /// 24 and "−ln(p)" for intent 23. nifti1.h defines these intents as
    /// log(p) <= 0, but many pipelines store positive −log(p) under them.
    /// `null` for every other kind.
    pub positive_data_label: Option<String>,
}

/// NIfTI-1 intent codes used by [`StatisticInfo::from_intent`].
mod nifti_intent {
    pub const NONE: i16 = 0;
    pub const CORREL: i16 = 2;
    pub const TTEST: i16 = 3;
    pub const FTEST: i16 = 4;
    pub const ZSCORE: i16 = 5;
    pub const CHISQ: i16 = 6;
    pub const PVAL: i16 = 22;
    pub const LOGPVAL: i16 = 23;
    pub const LOG10PVAL: i16 = 24;
    pub const ESTIMATE: i16 = 1001;
    pub const LABEL: i16 = 1002;
    /// Codes 7-21 are further distributions (beta ... extreme value).
    pub const FIRST_DISTRIBUTION: i16 = 7;
    pub const LAST_DISTRIBUTION: i16 = 21;
    pub const DISTRIBUTION_NAMES: [&str; 15] = [
        "beta",
        "binomial",
        "gamma",
        "Poisson",
        "normal",
        "noncentral F",
        "noncentral χ²",
        "logistic",
        "Laplace",
        "uniform",
        "noncentral t",
        "Weibull",
        "χ",
        "inverse Gaussian",
        "extreme value",
    ];
}

fn format_dof(df: f32) -> String {
    if (df - df.round()).abs() < 1e-3 {
        format!("{}", df.round() as i64)
    } else {
        let text = format!("{df:.2}");
        text.trim_end_matches('0').trim_end_matches('.').to_string()
    }
}

fn valid_dof(df: f32) -> Option<f32> {
    (df.is_finite() && df > 0.0).then_some(df)
}

impl StatisticInfo {
    /// Decode a NIfTI intent. When `intent_code` is 0, an SPM-style
    /// `descrip` (`SPM{T_[24.0]}`, `SPM{F_[2.0,30.0]}`, `SPM{Z}`) is used.
    pub fn from_intent(
        intent_code: i16,
        intent_params: [f32; 3],
        intent_name: &str,
        description: &str,
    ) -> Self {
        use nifti_intent as code;
        let intent_name = intent_name.trim().to_string();
        let [p1, p2, _] = intent_params;
        let one = |df: f32| valid_dof(df).into_iter().collect::<Vec<_>>();
        let (kind, dof) = match intent_code {
            code::NONE => {
                if let Some((kind, dof)) = parse_spm_description(description) {
                    let mut info = Self::labelled(kind, dof, intent_params, intent_name, 0);
                    info.from_description = true;
                    return info;
                }
                (StatisticKind::None, vec![])
            }
            code::CORREL => (StatisticKind::Correlation, one(p1)),
            code::TTEST => (StatisticKind::T, one(p1)),
            code::FTEST => match (valid_dof(p1), valid_dof(p2)) {
                (Some(a), Some(b)) => (StatisticKind::F, vec![a, b]),
                _ => (StatisticKind::F, vec![]),
            },
            code::ZSCORE => (StatisticKind::Z, vec![]),
            code::CHISQ => (StatisticKind::Chi2, one(p1)),
            code::PVAL => (StatisticKind::P, vec![]),
            code::LOGPVAL => (StatisticKind::LogP, vec![]),
            code::LOG10PVAL => (StatisticKind::Log10P, vec![]),
            code::ESTIMATE if !intent_name.is_empty() => (StatisticKind::Estimate, vec![]),
            code::LABEL => (StatisticKind::Label, vec![]),
            code::FIRST_DISTRIBUTION..=code::LAST_DISTRIBUTION => (StatisticKind::Other, vec![]),
            _ => (StatisticKind::Data, vec![]),
        };
        Self::labelled(kind, dof, intent_params, intent_name, intent_code)
    }

    fn labelled(
        kind: StatisticKind,
        dof: Vec<f32>,
        intent_params: [f32; 3],
        intent_name: String,
        intent_code: i16,
    ) -> Self {
        let with_dof = |base: &str| {
            if dof.is_empty() {
                base.to_string()
            } else {
                let parts: Vec<String> = dof.iter().map(|d| format_dof(*d)).collect();
                format!("{base}({})", parts.join(","))
            }
        };
        let label = match kind {
            StatisticKind::None => String::new(),
            StatisticKind::Z => "z".into(),
            StatisticKind::T => with_dof("t"),
            StatisticKind::F => with_dof("F"),
            StatisticKind::Chi2 => with_dof("χ²"),
            StatisticKind::Correlation => with_dof("r"),
            StatisticKind::P => "p".into(),
            StatisticKind::LogP => "ln(p)".into(),
            StatisticKind::Log10P => "log10(p)".into(),
            StatisticKind::Estimate => intent_name.clone(),
            StatisticKind::Label => "label".into(),
            StatisticKind::Other if !intent_name.is_empty() => intent_name.clone(),
            StatisticKind::Other => usize::try_from(intent_code - nifti_intent::FIRST_DISTRIBUTION)
                .ok()
                .and_then(|i| nifti_intent::DISTRIBUTION_NAMES.get(i))
                .map_or_else(|| format!("intent {intent_code}"), |name| name.to_string()),
            StatisticKind::Data => String::new(),
        };
        let positive_data_label = match kind {
            StatisticKind::LogP => Some("−ln(p)".to_string()),
            StatisticKind::Log10P => Some("−log10(p)".to_string()),
            _ => None,
        };
        Self {
            kind,
            intent_code,
            intent_params,
            intent_name,
            dof,
            label,
            from_description: false,
            positive_data_label,
        }
    }

    /// True for statistical kinds worth labelling as units in the UI. Label
    /// maps and declared non-statistical intents are excluded.
    pub fn is_statistic(&self) -> bool {
        !matches!(
            self.kind,
            StatisticKind::None | StatisticKind::Label | StatisticKind::Data
        )
    }

    /// True when the header declares a label map (`NIFTI_INTENT_LABEL`).
    pub fn is_label_map(&self) -> bool {
        self.kind == StatisticKind::Label
    }
}

/// Parse SPM's `SPM{T_[24.0]}` / `SPM{F_[2.0,30.0]}` / `SPM{Z}` description.
fn parse_spm_description(description: &str) -> Option<(StatisticKind, Vec<f32>)> {
    let start = description.find("SPM{")? + 4;
    let rest = &description[start..];
    let end = rest.find('}')?;
    let body = &rest[..end];
    let (letter, params) = match body.split_once("_[") {
        Some((letter, params)) => (letter, params.trim_end_matches(']')),
        None => (body, ""),
    };
    let dof: Vec<f32> = params
        .split(',')
        .filter_map(|p| p.trim().parse::<f32>().ok())
        .filter_map(valid_dof)
        .collect();
    match (letter.trim(), dof.len()) {
        ("T", 0 | 1) => Some((StatisticKind::T, dof)),
        ("F", 0) => Some((StatisticKind::F, dof)),
        ("F", 2) => Some((StatisticKind::F, dof)),
        ("Z", _) => Some((StatisticKind::Z, vec![])),
        ("X", 0 | 1) => Some((StatisticKind::Chi2, dof)),
        _ => None,
    }
}

/// Surface geometry data for frontend
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SurfaceGeometryData {
    pub vertices: Vec<f32>,
    pub faces: Vec<u32>,
}

/// Lightweight, header-only metadata for the Files-panel preview.
///
/// Returned by the `peek_volume_metadata` command without ever
/// loading the volume data into the GPU. Fields are camelCase in the
/// generated TypeScript bindings.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PeekVolumeMetadata {
    /// Path that was probed.
    pub path: String,
    /// Discriminator: "nifti" | "gifti".
    pub kind: String,
    /// Spatial (and optional time) dimensions.
    pub dims: Vec<usize>,
    /// Voxel size in mm. Empty for surface meshes.
    pub voxel_size: Vec<f32>,
    /// Data type string (e.g. "f32", "i16", "u8") if known.
    pub dtype: Option<String>,
    /// True when the probe identifies the volume as 4D.
    pub is_four_d: bool,
    /// Number of time points if applicable.
    pub num_timepoints: Option<usize>,
    /// Repetition time in seconds if applicable.
    pub tr: Option<f32>,
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
    /// Best-effort coordinate-space tag: "MNI", "talairach", "aligned",
    /// "scanner", or "unknown". Derived from the sform/qform codes plus a
    /// filename hint; heuristic, since codes alone are unreliable (many MNI
    /// files ship with code 1). Not authoritative — auto-mount features should
    /// treat a non-"MNI" result as "ask the user".
    pub coordinate_space: String,
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
    /// Decoded NIfTI intent (code, parameters, name and display label).
    /// Present whenever the source header could be re-read; `kind` is "none"
    /// for non-statistical images.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub statistic: Option<StatisticInfo>,
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

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum StudioImportMode {
    Manifest,
    Regex,
    Table,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum StudioSupportKind {
    Volume,
    Surface,
    Mixed,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[ts(export)]
#[serde(rename_all = "kebab-case")]
pub enum StudioAlignmentClass {
    SameGrid,
    SameSpace,
    SameTopology,
    Mixed,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum StudioExpressionKind {
    Member,
    Reducer,
    Comparison,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum StudioComparePaneStatus {
    Live,
    Pending,
    Blocked,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum StudioCompareBindingKind {
    MemberSource,
    DerivedField,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum StudioCompareCacheStatus {
    Source,
    Hit,
    Miss,
    Stale,
    Forced,
    Synthetic,
    Unavailable,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum StudioAuditSeverity {
    Ok,
    Warning,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum StudioValueRole {
    Effect,
    StandardError,
    Variance,
    T,
    Z,
    Label,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StudioFeatureSummary {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub value_role: Option<StudioValueRole>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub units: Option<String>,
    pub id: String,
    pub label: String,
    pub kind: StudioSupportKind,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum StudioCohortOriginKind {
    Imported,
    SavedSnapshot,
    IssueFocus,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StudioCohortSummary {
    pub id: String,
    pub label: String,
    pub member_count: usize,
    pub description: String,
    pub member_ids: Vec<String>,
    pub origin_kind: StudioCohortOriginKind,
    pub origin_label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StudioFieldExpressionSummary {
    pub id: String,
    pub label: String,
    pub kind: StudioExpressionKind,
    pub recipe: String,
    pub cohort_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StudioJoinIssueDetail {
    pub message: String,
    pub member_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StudioJoinAuditSummary {
    pub matched_rows: usize,
    pub unmatched_rows: usize,
    pub duplicate_keys: usize,
    pub severity: StudioAuditSeverity,
    pub issue_details: Vec<StudioJoinIssueDetail>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StudioSupportAuditSummary {
    pub support_label: String,
    pub alignment_class: StudioAlignmentClass,
    pub ready_for_compare: bool,
    pub severity: StudioAuditSeverity,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StudioIngestAuditSummary {
    pub source_label: String,
    pub join: StudioJoinAuditSummary,
    pub support: StudioSupportAuditSummary,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum StudioImportReadiness {
    CompareReady,
    ReviewRequired,
    InspectOnly,
    Blocked,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum StudioImportProvenanceKind {
    Manifest,
    RegexDiscovery,
    Table,
    Demo,
    BackendError,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum StudioImportCapability {
    Import,
    Deck,
    Compare,
    MaterializeCompare,
    ExportNeurotabs,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StudioImportContract {
    pub readiness: StudioImportReadiness,
    pub provenance_kind: StudioImportProvenanceKind,
    pub provenance_label: String,
    pub can_import: bool,
    pub capabilities: Vec<StudioImportCapability>,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StudioDiscoveryRolePattern {
    pub role: String,
    pub patterns: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StudioDiscoveryDesignValue {
    pub column: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StudioDiscoveryRoleBinding {
    pub role: String,
    pub source_path: String,
    pub relative_path: String,
    pub confidence: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StudioDiscoveryMemberGroup {
    pub member_id: String,
    pub design_values: Vec<StudioDiscoveryDesignValue>,
    pub bindings: Vec<StudioDiscoveryRoleBinding>,
    pub missing_roles: Vec<String>,
    pub duplicate_roles: Vec<String>,
    pub confidence: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StudioDiscoveryPreviewSummary {
    pub root: String,
    pub file_pattern: String,
    pub include_patterns: Vec<String>,
    pub exclude_patterns: Vec<String>,
    pub role_patterns: Vec<StudioDiscoveryRolePattern>,
    pub max_depth: Option<usize>,
    pub max_files: usize,
    pub dry_run: bool,
    pub sample_headers: bool,
    pub capture_names: Vec<String>,
    pub inferred_design_columns: Vec<String>,
    pub observed_roles: Vec<String>,
    pub required_roles: Vec<String>,
    pub matched_files: usize,
    pub unmatched_files: usize,
    pub duplicate_keys: usize,
    pub truncated: bool,
    pub groups: Vec<StudioDiscoveryMemberGroup>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StudioFolderOntologyPreviewRequest {
    pub root: String,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub max_depth: Option<usize>,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub max_files: Option<usize>,
    #[serde(default)]
    pub include_patterns: Vec<String>,
    #[serde(default)]
    pub exclude_patterns: Vec<String>,
}

impl StudioFolderOntologyPreviewRequest {
    pub fn new(root: impl Into<String>) -> Self {
        Self {
            root: root.into(),
            max_depth: None,
            max_files: None,
            include_patterns: Vec::new(),
            exclude_patterns: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StudioFolderOntologySummary {
    pub root: String,
    pub root_exists: bool,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub source_label: Option<String>,
    pub scanned_files: usize,
    pub neuroimaging_files: usize,
    pub truncated: bool,
    pub candidates: Vec<StudioFolderOntologyCandidate>,
    pub warnings: Vec<StudioFolderOntologyWarning>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StudioFolderOntologyCandidate {
    pub id: String,
    pub label: String,
    pub description: String,
    pub strategy: String,
    pub score: f32,
    pub coverage: f32,
    pub completeness: f32,
    pub matched_files: usize,
    pub unmatched_files: usize,
    pub duplicate_keys: usize,
    pub missing_role_bindings: usize,
    pub file_pattern: String,
    pub design_columns: Vec<String>,
    pub observed_roles: Vec<String>,
    pub required_roles: Vec<String>,
    pub role_patterns: Vec<StudioDiscoveryRolePattern>,
    pub factors: Vec<StudioFolderOntologyFactor>,
    pub roles: Vec<StudioFolderOntologyRoleGuess>,
    pub groups: Vec<StudioDiscoveryMemberGroup>,
    pub reasons: Vec<String>,
    pub warnings: Vec<StudioFolderOntologyWarning>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StudioFolderOntologyFactor {
    pub name: String,
    pub source: String,
    pub values: Vec<String>,
    pub confidence: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StudioFolderOntologyRoleGuess {
    pub role: String,
    pub source: String,
    pub examples: Vec<String>,
    pub confidence: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StudioFolderOntologyWarning {
    pub code: String,
    pub message: String,
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum StudioFieldBindingAvailability {
    Available,
    Missing,
    Invalid,
    Unavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StudioFieldBindingSummary {
    pub role: String,
    pub feature_id: Option<String>,
    pub source_locator: Option<String>,
    pub source_path: Option<String>,
    pub relative_path: Option<String>,
    pub selector: Option<String>,
    pub support_kind: StudioSupportKind,
    pub support_label: Option<String>,
    pub availability: StudioFieldBindingAvailability,
    pub is_primary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StudioMemberSummary {
    pub id: String,
    /// Complete imported metadata for this observation, independent of the UI preview.
    /// None denotes a legacy record without a complete metadata snapshot.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub design_values: Option<std::collections::BTreeMap<String, String>>,
    pub source_path: Option<String>,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub bindings: Option<Vec<StudioFieldBindingSummary>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StudioDesignRowPreview {
    pub id: String,
    pub cells: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StudioDesignTablePreview {
    pub columns: Vec<String>,
    pub rows: Vec<StudioDesignRowPreview>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SpatialFieldSetSummary {
    pub id: String,
    pub name: String,
    pub member_count: usize,
    pub primary_feature_id: Option<String>,
    pub support_kind: StudioSupportKind,
    pub support_label: String,
    pub alignment_class: StudioAlignmentClass,
    pub design_columns: Vec<String>,
    pub design_table_preview: Option<StudioDesignTablePreview>,
    pub member_summaries: Vec<StudioMemberSummary>,
    pub member_ids: Vec<String>,
    pub saved_cohort_ids: Vec<String>,
    pub ingest_audit: StudioIngestAuditSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StudioMaterializationStatus {
    pub warm: usize,
    pub preview: usize,
    pub pending: usize,
    pub failed: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StudioImportCandidate {
    pub id: String,
    pub label: String,
    pub description: String,
    pub mode: StudioImportMode,
    pub source_hint: String,
    pub contract: StudioImportContract,
    pub set: SpatialFieldSetSummary,
    pub features: Vec<StudioFeatureSummary>,
    pub cohorts: Vec<StudioCohortSummary>,
    pub expressions: Vec<StudioFieldExpressionSummary>,
    pub materialization: Option<StudioMaterializationStatus>,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub discovery: Option<StudioDiscoveryPreviewSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StudioImportPreviewRequest {
    pub mode: StudioImportMode,
    pub manifest_path: Option<String>,
    pub discovery_root: Option<String>,
    pub file_pattern: Option<String>,
    pub table_source_label: Option<String>,
    pub table_headers: Option<Vec<String>>,
    pub table_rows: Option<Vec<Vec<String>>>,
    pub table_file_path_column: Option<String>,
    pub table_subject_id_column: Option<String>,
    pub table_excluded_columns: Option<Vec<String>>,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub discovery_max_depth: Option<usize>,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub discovery_max_files: Option<usize>,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub discovery_include_patterns: Option<Vec<String>>,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub discovery_exclude_patterns: Option<Vec<String>>,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub discovery_required_roles: Option<Vec<String>>,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub discovery_role_patterns: Option<Vec<StudioDiscoveryRolePattern>>,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub discovery_dry_run: Option<bool>,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub discovery_sample_headers: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StudioGeneratedNeuroTabsFile {
    pub relative_path: String,
    pub contents: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StudioDiscoveryPromotionRequest {
    pub candidate: StudioImportCandidate,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub output_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StudioDiscoveryPromotionResult {
    pub dataset_id: String,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub manifest_path: Option<String>,
    pub files: Vec<StudioGeneratedNeuroTabsFile>,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub preview: Option<StudioImportCandidate>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StudioComparePaneSpec {
    pub id: String,
    pub title: String,
    pub subtitle: String,
    pub status: StudioComparePaneStatus,
    pub reason: String,
    pub recipe: Option<String>,
    pub binding: Option<StudioComparePaneBinding>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StudioComparePaneBinding {
    pub kind: StudioCompareBindingKind,
    pub ready: bool,
    pub source_path: Option<String>,
    pub materialization_key: Option<String>,
    pub materialized_at_ms: Option<u64>,
    pub cache_status: StudioCompareCacheStatus,
    pub cache_message: Option<String>,
    pub provenance_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum StudioReducerKind {
    Mean,
    Sd,
    LeaveOneOutMean,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StudioReducerSpec {
    pub id: String,
    pub label: String,
    pub kind: StudioReducerKind,
    pub role: String,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub cohort_id: Option<String>,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub excluded_member_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StudioRoleBindingInput {
    pub member_id: String,
    pub role: String,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub feature_id: Option<String>,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub source_path: Option<String>,
    pub support_kind: StudioSupportKind,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub support_label: Option<String>,
    pub availability: StudioFieldBindingAvailability,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StudioCompareMaterializeRequest {
    pub support_label: String,
    pub compare_ready: bool,
    pub force_rematerialize: bool,
    pub active_member_id: Option<String>,
    pub active_member_source_path: Option<String>,
    pub cohort_member_source_paths: Vec<String>,
    pub compare_cohort_id: Option<String>,
    pub compare_cohort_label: Option<String>,
    pub compare_cohort_member_count: Option<usize>,
    pub active_expression_label: Option<String>,
    pub active_expression_recipe: Option<String>,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub reducer_specs: Option<Vec<StudioReducerSpec>>,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub active_member_role_bindings: Option<Vec<StudioRoleBindingInput>>,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub cohort_member_role_bindings: Option<Vec<StudioRoleBindingInput>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum StudioMaterializationJobState {
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StudioMaterializationJobStatus {
    pub job_id: String,
    pub state: StudioMaterializationJobState,
    pub started_at_ms: Option<u64>,
    pub finished_at_ms: Option<u64>,
    pub progress: Option<f32>,
    pub message: Option<String>,
    pub result: Option<Vec<StudioComparePaneSpec>>,
    pub error: Option<String>,
}

/// Kinds of inputs an analysis can accept.
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum AnalysisInputKind {
    Volume,
    Surface,
    SurfaceData,
    Roi,
    File,
}

/// Declared kinds of artifacts an analysis may produce.
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum AnalysisArtifactKind {
    Volume,
    Surface,
    SurfaceData,
    Table,
    File,
    Image2d,
    Metadata,
}

/// Execution backend for an analysis.
/// Runner-specific configuration lives in the host and is not part of the UI contract.
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[ts(export)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AnalysisRunnerKind {
    Builtin,
    Sidecar,
}

/// Concrete input instance passed to an analysis run.
/// The host may resolve handles to file paths before dispatch.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AnalysisInput {
    /// Kind of input.
    pub kind: AnalysisInputKind,
    /// Optional registry handle (e.g., volume/surface id).
    pub handle: Option<String>,
    /// Optional resolved on-disk path for sidecar runners.
    pub path: Option<String>,
    /// Optional human-friendly name for UI display.
    pub name: Option<String>,
    /// Arbitrary extra metadata (space, units, etc).
    #[ts(type = "any")]
    pub metadata: JsonValue,
}

/// Declarative description of an analysis module.
/// This is what the UI uses to render a parameter form and validate inputs.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AnalysisDescriptor {
    pub id: String,
    pub name: String,
    pub version: String,
    /// API version for compatibility with host/SDK.
    pub api_version: String,
    pub description: Option<String>,
    pub inputs: Vec<AnalysisInputKind>,
    /// JSON-Schema-ish parameter description. Unknown/additive fields are allowed.
    #[ts(type = "any")]
    pub params_schema: JsonValue,
    pub outputs: Vec<AnalysisArtifactKind>,
    pub runner: AnalysisRunnerKind,
}

/// Concrete artifact produced by an analysis job.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AnalysisArtifact {
    pub kind: AnalysisArtifactKind,
    /// Human-friendly name for display/layer titles.
    pub name: Option<String>,
    /// Path to artifact. For sidecars this is relative to the job output dir.
    pub path: String,
    /// Optional metadata describing the artifact (space, intent, etc).
    #[ts(type = "any")]
    pub metadata: JsonValue,
}

/// Request payload to start an analysis job.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AnalysisStartRequest {
    pub analysis_id: String,
    pub inputs: Vec<AnalysisInput>,
    #[ts(type = "any")]
    pub params: JsonValue,
}

/// Lifecycle state of an analysis job.
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum AnalysisJobState {
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
}

/// Snapshot status for an analysis job.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AnalysisJobStatus {
    pub job_id: String,
    pub analysis_id: String,
    pub state: AnalysisJobState,
    /// Epoch milliseconds.
    pub started_at_ms: Option<u64>,
    pub finished_at_ms: Option<u64>,
    pub progress: Option<f32>,
    pub message: Option<String>,
    pub artifacts: Option<Vec<AnalysisArtifact>>,
    pub error: Option<String>,
}

#[cfg(test)]
mod statistic_info_tests {
    use super::*;

    fn info(code: i16, p: [f32; 3]) -> StatisticInfo {
        StatisticInfo::from_intent(code, p, "", "")
    }

    #[test]
    fn maps_intent_codes_to_kinds_and_labels() {
        let z = info(5, [0.0; 3]);
        assert_eq!((z.kind, z.label.as_str()), (StatisticKind::Z, "z"));
        let t = info(3, [24.0, 0.0, 0.0]);
        assert_eq!((t.kind, t.label.as_str()), (StatisticKind::T, "t(24)"));
        assert_eq!(t.dof, vec![24.0]);
        let welch = info(3, [23.456, 0.0, 0.0]);
        assert_eq!(welch.label, "t(23.46)");
        let f = info(4, [2.0, 30.0, 0.0]);
        assert_eq!((f.kind, f.label.as_str()), (StatisticKind::F, "F(2,30)"));
        assert_eq!(info(6, [3.0, 0.0, 0.0]).label, "χ²(3)");
        assert_eq!(info(2, [18.0, 0.0, 0.0]).label, "r(18)");
        assert_eq!(info(22, [0.0; 3]).kind, StatisticKind::P);
        assert_eq!(info(24, [0.0; 3]).kind, StatisticKind::Log10P);
        let label = info(1002, [0.0; 3]);
        assert_eq!(label.kind, StatisticKind::Label);
        assert!(!label.is_statistic() && label.is_label_map());
        let none = info(0, [0.0; 3]);
        assert_eq!(none.kind, StatisticKind::None);
        assert!(!none.is_statistic());
        assert_eq!(none.label, "");
    }

    #[test]
    fn unset_or_invalid_dof_leaves_bare_label() {
        assert_eq!(info(3, [0.0; 3]).label, "t");
        assert_eq!(info(3, [f32::NAN, 0.0, 0.0]).label, "t");
        // F needs both dofs; one missing is reported without dof.
        let f = info(4, [2.0, 0.0, 0.0]);
        assert_eq!((f.label.as_str(), f.dof.len()), ("F", 0));
    }

    #[test]
    fn other_intents_use_name_or_code() {
        let named = StatisticInfo::from_intent(11, [0.0; 3], " normal ", "");
        assert_eq!(
            (named.kind, named.label.as_str()),
            (StatisticKind::Other, "normal")
        );
        assert_eq!(info(11, [0.0; 3]).label, "normal");
        assert_eq!(info(21, [0.0; 3]).label, "extreme value");
        assert!(info(7, [0.0; 3]).is_statistic());
        let beta = StatisticInfo::from_intent(1001, [0.0; 3], "beta", "");
        assert_eq!(
            (beta.kind, beta.label.as_str()),
            (StatisticKind::Estimate, "beta")
        );
        assert!(beta.is_statistic());
    }

    #[test]
    fn non_statistical_intents_are_data_not_statistics() {
        // Unnamed estimate, neuroname..dimless, time series..shape, unknown codes.
        for code in [1001, 1003, 1007, 1011, 2001, 2003, 2005, 25, 3000, -1] {
            let data = info(code, [0.0; 3]);
            assert_eq!(data.kind, StatisticKind::Data, "intent {code}");
            assert!(
                !data.is_statistic() && !data.is_label_map(),
                "intent {code}"
            );
            assert_eq!(data.label, "", "intent {code} must not be labelled");
        }
    }

    #[test]
    fn log_p_intents_offer_positive_data_label() {
        let log10 = info(24, [0.0; 3]);
        assert_eq!(log10.label, "log10(p)");
        assert_eq!(log10.positive_data_label.as_deref(), Some("−log10(p)"));
        assert_eq!(
            info(23, [0.0; 3]).positive_data_label.as_deref(),
            Some("−ln(p)")
        );
        assert_eq!(info(5, [0.0; 3]).positive_data_label, None);
        assert_eq!(info(22, [0.0; 3]).positive_data_label, None);
        assert_eq!(
            serde_json::to_value(log10).unwrap()["positiveDataLabel"],
            "−log10(p)"
        );
    }

    #[test]
    fn spm_description_fills_in_when_intent_unset() {
        let t = StatisticInfo::from_intent(0, [0.0; 3], "", "SPM{T_[24.0]} - contrast 1: faces");
        assert_eq!((t.kind, t.label.as_str()), (StatisticKind::T, "t(24)"));
        assert!(t.from_description);
        assert_eq!(t.intent_code, 0);
        let f = StatisticInfo::from_intent(0, [0.0; 3], "", "SPM{F_[2.0,30.0]}");
        assert_eq!(f.label, "F(2,30)");
        let z = StatisticInfo::from_intent(0, [0.0; 3], "", "SPM{Z} map");
        assert_eq!(z.kind, StatisticKind::Z);
        // An explicit intent wins over the description.
        let explicit = StatisticInfo::from_intent(5, [0.0; 3], "", "SPM{T_[10.0]}");
        assert_eq!(
            (explicit.kind, explicit.from_description),
            (StatisticKind::Z, false)
        );
        assert_eq!(
            StatisticInfo::from_intent(0, [0.0; 3], "", "anatomical T1").kind,
            StatisticKind::None
        );
    }

    #[test]
    fn serializes_kind_lowercase_and_fields_camel_case() {
        let json = serde_json::to_value(info(3, [24.0, 0.0, 0.0])).unwrap();
        assert_eq!(json["kind"], "t");
        assert_eq!(json["intentCode"], 3);
        assert_eq!(json["fromDescription"], false);
        assert_eq!(
            serde_json::to_value(info(6, [1.0, 0.0, 0.0])).unwrap()["kind"],
            "chi2"
        );
    }
}
