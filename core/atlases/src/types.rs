/*!
 * Type definitions for the Atlas system
 */

use serde::{Deserialize, Serialize};
use ts_rs::TS;
use std::collections::HashMap;

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

/// Supported template spaces
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum TemplateSpace {
    #[serde(rename = "MNI152NLin2009cAsym")]
    MNI152NLin2009cAsym,
    #[serde(rename = "MNI152NLin6Asym")]
    MNI152NLin6Asym,
    #[serde(rename = "fsaverage")]
    FSAverage,
    #[serde(rename = "fsaverage5")]
    FSAverage5,
    #[serde(rename = "fsaverage6")]
    FSAverage6,
}

impl TemplateSpace {
    pub fn as_str(&self) -> &'static str {
        match self {
            TemplateSpace::MNI152NLin2009cAsym => "MNI152NLin2009cAsym",
            TemplateSpace::MNI152NLin6Asym => "MNI152NLin6Asym",
            TemplateSpace::FSAverage => "fsaverage",
            TemplateSpace::FSAverage5 => "fsaverage5",
            TemplateSpace::FSAverage6 => "fsaverage6",
        }
    }
    
    pub fn from_str(s: &str) -> Result<Self, AtlasError> {
        match s {
            "MNI152NLin2009cAsym" => Ok(TemplateSpace::MNI152NLin2009cAsym),
            "MNI152NLin6Asym" => Ok(TemplateSpace::MNI152NLin6Asym),
            "fsaverage" => Ok(TemplateSpace::FSAverage),
            "fsaverage5" => Ok(TemplateSpace::FSAverage5),
            "fsaverage6" => Ok(TemplateSpace::FSAverage6),
            _ => Err(AtlasError::UnsupportedSpace(s.to_string())),
        }
    }
}

impl std::fmt::Display for TemplateSpace {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Supported resolutions
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum TemplateResolution {
    #[serde(rename = "1mm")]
    MM1,
    #[serde(rename = "2mm")]
    MM2,
}

impl TemplateResolution {
    pub fn as_str(&self) -> &'static str {
        match self {
            TemplateResolution::MM1 => "1mm",
            TemplateResolution::MM2 => "2mm",
        }
    }
    
    pub fn from_str(s: &str) -> Result<Self, AtlasError> {
        match s {
            "1mm" => Ok(TemplateResolution::MM1),
            "2mm" => Ok(TemplateResolution::MM2),
            _ => Err(AtlasError::UnsupportedResolution(s.to_string())),
        }
    }
}

impl std::fmt::Display for TemplateResolution {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

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
}

impl AtlasConfig {
    /// Parse atlas type from string (validates it's a known atlas)
    pub fn parse_atlas_type(&self) -> Result<AtlasType, AtlasError> {
        AtlasType::from_str(&self.atlas_id)
    }
    
    /// Parse space from string (validates it's a known space)
    pub fn parse_space(&self) -> Result<TemplateSpace, AtlasError> {
        TemplateSpace::from_str(&self.space)
    }
    
    /// Parse resolution from string (validates it's a known resolution)
    pub fn parse_resolution(&self) -> Result<TemplateResolution, AtlasError> {
        TemplateResolution::from_str(&self.resolution)
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