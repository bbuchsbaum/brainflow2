/*!
 * Type definitions for the Atlas system
 */

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use ts_rs::TS;

/// Source of an atlas
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum AtlasSource {
    /// Built into neuroatlas-rs
    BuiltIn,
    /// From TemplateFlow
    TemplateFlow,
    /// User-provided custom atlas
    Custom,
}

/// Type of atlas data
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum AtlasDataType {
    /// Volumetric (NIfTI)
    Volume,
    /// Surface (GIFTI)
    Surface,
    /// Both volume and surface available
    Both,
}

/// Atlas category for organization
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum AtlasCategory {
    /// Cortical parcellations
    Cortical,
    /// Subcortical structures
    Subcortical,
    /// Whole-brain parcellations
    WholeBrain,
    /// Specialized regions (e.g., MTL)
    Specialized,
    /// Template brain images
    Template,
}

/// Atlas type enumeration for type-safe atlas identification
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum AtlasType {
    /// Schaefer 2018 cortical parcellation
    #[serde(rename = "schaefer2018")]
    Schaefer2018,
    /// Glasser 2016 HCP-MMP1.0 parcellation
    #[serde(rename = "glasser2016")]
    Glasser2016,
    /// FreeSurfer ASEG subcortical segmentation
    #[serde(rename = "freesurfer_aseg")]
    FreeSurferAseg,
    /// Olsen MTL high-resolution parcellation
    #[serde(rename = "olsen_mtl")]
    OlsenMtl,
}

impl AtlasType {
    /// Get the string identifier for this atlas type
    pub fn as_str(&self) -> &'static str {
        match self {
            AtlasType::Schaefer2018 => "schaefer2018",
            AtlasType::Glasser2016 => "glasser2016",
            AtlasType::FreeSurferAseg => "freesurfer_aseg",
            AtlasType::OlsenMtl => "olsen_mtl",
        }
    }

    /// Parse from string (for backward compatibility)
    pub fn from_str(s: &str) -> Result<Self, AtlasError> {
        match s {
            "schaefer2018" => Ok(AtlasType::Schaefer2018),
            "glasser2016" => Ok(AtlasType::Glasser2016),
            "freesurfer_aseg" => Ok(AtlasType::FreeSurferAseg),
            "olsen_mtl" => Ok(AtlasType::OlsenMtl),
            _ => Err(AtlasError::UnknownAtlas(s.to_string())),
        }
    }
}

impl std::fmt::Display for AtlasType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Space/template information
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SpaceInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub data_type: AtlasDataType,
}

/// Resolution option
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ResolutionInfo {
    pub value: String, // "1mm", "2mm", etc.
    pub description: String,
}

// Note: TemplateSpace and TemplateResolution enums were removed in favor of
// using neuroatlas::core::types::{Space, Resolution} directly. The atlases
// crate re-exports these from neuroatlas via lib.rs.

/// Configuration parameters for loading an atlas
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AtlasConfig {
    // Keep old fields for now to maintain compatibility - will be migrated in phases
    pub atlas_id: String,
    pub space: String,
    pub resolution: String,
    /// For Schaefer: number of networks (7 or 17)
    pub networks: Option<u8>,
    /// For Schaefer: number of parcels (100-1000)
    pub parcels: Option<u32>,
    /// Additional parameters for TemplateFlow
    pub template_params: Option<HashMap<String, String>>,
    /// Data type hint: "volume" or "surface"
    pub data_type: Option<String>,
    /// Surface type for surface atlases: "pial", "white", "inflated", etc.
    pub surf_type: Option<String>,
}

impl AtlasConfig {
    /// Parse atlas type from string (validates it's a known atlas)
    pub fn parse_atlas_type(&self) -> Result<AtlasType, AtlasError> {
        AtlasType::from_str(&self.atlas_id)
    }

    /// Parse space using neuroatlas Space::from_string(), rejecting unknown/custom spaces
    pub fn parse_space(&self) -> Result<neuroatlas::core::types::Space, AtlasError> {
        let space = neuroatlas::core::types::Space::from_string(&self.space);
        match space {
            neuroatlas::core::types::Space::Custom(_) => {
                Err(AtlasError::UnsupportedSpace(self.space.clone()))
            }
            s => Ok(s),
        }
    }

    /// Parse resolution using neuroatlas Resolution enum
    pub fn parse_resolution(&self) -> Result<neuroatlas::core::types::Resolution, AtlasError> {
        match self.resolution.as_str() {
            "1mm" => Ok(neuroatlas::core::types::Resolution::MM1),
            "2mm" => Ok(neuroatlas::core::types::Resolution::MM2),
            _ => Err(AtlasError::UnsupportedResolution(self.resolution.clone())),
        }
    }
}

/// Catalog entry for an atlas
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AtlasCatalogEntry {
    /// Unique identifier
    pub id: String,
    /// Display name
    pub name: String,
    /// Short description
    pub description: String,
    /// Source of the atlas
    pub source: AtlasSource,
    /// Category for organization
    pub category: AtlasCategory,
    /// Compatible spaces
    pub allowed_spaces: Vec<SpaceInfo>,
    /// Available resolutions
    pub resolutions: Vec<ResolutionInfo>,
    /// For Schaefer atlases: available network counts
    pub network_options: Option<Vec<u8>>,
    /// For Schaefer atlases: available parcel counts
    pub parcel_options: Option<Vec<u32>>,
    /// Whether this is marked as favorite
    pub is_favorite: bool,
    /// When it was last used (ISO string)
    pub last_used: Option<String>,
    /// Reference/citation information
    pub citation: Option<String>,
    /// Whether atlas data is cached locally
    pub is_cached: bool,
    /// Size estimate for download
    pub download_size_mb: Option<f64>,
}

/// Progress information for atlas loading
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AtlasLoadProgress {
    pub atlas_id: String,
    pub stage: LoadingStage,
    pub progress: f32, // 0.0 to 1.0
    pub message: String,
}

/// Stages of atlas loading
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum LoadingStage {
    /// Checking cache
    CheckingCache,
    /// Downloading from remote
    Downloading,
    /// Loading/parsing file
    Loading,
    /// Processing data
    Processing,
    /// Complete
    Complete,
    /// Error occurred
    Error,
}

impl std::fmt::Display for LoadingStage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LoadingStage::CheckingCache => write!(f, "Checking Cache"),
            LoadingStage::Downloading => write!(f, "Downloading"),
            LoadingStage::Loading => write!(f, "Loading"),
            LoadingStage::Processing => write!(f, "Processing"),
            LoadingStage::Complete => write!(f, "Complete"),
            LoadingStage::Error => write!(f, "Error"),
        }
    }
}

/// Metadata about a loaded atlas
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AtlasMetadata {
    pub id: String,
    pub name: String,
    pub description: String,
    pub n_regions: usize,
    pub space: String,
    pub resolution: String,
    pub citation: Option<String>,
    /// Bounding box in world coordinates
    pub bounds_mm: Option<[[f32; 3]; 2]>, // [min, max]
    /// Data range for intensity values
    pub data_range: Option<[f32; 2]>,
}

/// Error types for atlas operations
#[derive(Debug, thiserror::Error, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "type", content = "data")]
pub enum AtlasError {
    #[error("Unknown atlas: {0}")]
    UnknownAtlas(String),
    #[error("Unsupported space: {0}")]
    UnsupportedSpace(String),
    #[error("Unsupported resolution: {0}")]
    UnsupportedResolution(String),
    #[error("Configuration validation failed: {0}")]
    ValidationFailed(String),
    #[error("Failed to load atlas data: {0}")]
    LoadFailed(String),
    #[error("Atlas not found in catalog: {0}")]
    AtlasNotFound(String),
    #[error("Invalid parameter: {field} = {value}")]
    InvalidParameter { field: String, value: String },
    #[error("IO error: {0}")]
    IoError(String),
    #[error("Path security violation: {0}")]
    PathSecurityViolation(String),
}

/// Result of successful atlas loading operation
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AtlasLoadResult {
    pub atlas_metadata: AtlasMetadata,
    pub volume_handle: String, // Handle for loaded volume
}

/// Label information for a surface atlas region
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SurfaceAtlasLabelInfo {
    /// Numeric label ID
    pub id: u32,
    /// Human-readable region name
    pub name: String,
    /// RGB color for visualization
    pub color: Option<[u8; 3]>,
    /// Hemisphere: "Left", "Right", or "Bilateral"
    pub hemisphere: Option<String>,
    /// Network assignment name (for Schaefer)
    pub network: Option<String>,
}

/// Result of loading a surface atlas
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SurfaceAtlasLoadResult {
    /// Atlas metadata
    pub atlas_metadata: AtlasMetadata,
    /// Per-vertex label IDs for the left hemisphere
    pub labels_lh: Vec<u32>,
    /// Per-vertex label IDs for the right hemisphere
    pub labels_rh: Vec<u32>,
    /// Label definitions with names, colors, networks
    pub label_info: Vec<SurfaceAtlasLabelInfo>,
    /// Coordinate space (e.g. "fsaverage")
    pub space: String,
    /// Number of vertices in left hemisphere
    pub n_vertices_lh: usize,
    /// Number of vertices in right hemisphere
    pub n_vertices_rh: usize,
}

/// Filter options for atlas catalog
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AtlasFilter {
    pub search_query: Option<String>,
    pub category: Option<AtlasCategory>,
    pub source: Option<AtlasSource>,
    pub space: Option<String>,
    pub data_type: Option<AtlasDataType>,
    pub show_favorites_only: bool,
    pub show_cached_only: bool,
}

/// Cache statistics information
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CacheStats {
    /// Total size of all cached files in bytes
    pub total_size_bytes: u64,
    /// Number of files in cache
    pub file_count: usize,
    /// List of cached atlas identifiers
    pub cached_atlases: Vec<String>,
}
