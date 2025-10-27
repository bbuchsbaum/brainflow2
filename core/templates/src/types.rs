/*!
 * Type definitions for the Template system
 */

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use ts_rs::TS;

/// Types of brain templates available
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum TemplateType {
    /// T1-weighted anatomical image
    #[serde(rename = "T1w")]
    T1w,
    /// T2-weighted anatomical image  
    #[serde(rename = "T2w")]
    T2w,
    /// FLAIR (Fluid Attenuated Inversion Recovery)
    #[serde(rename = "FLAIR")]
    Flair,
    /// Gray matter probability map
    #[serde(rename = "GM")]
    GrayMatter,
    /// White matter probability map
    #[serde(rename = "WM")]
    WhiteMatter,
    /// CSF (Cerebrospinal Fluid) probability map
    #[serde(rename = "CSF")]
    Csf,
    /// Brain mask
    #[serde(rename = "mask")]
    BrainMask,
    /// Skull-stripped brain
    #[serde(rename = "brain")]
    Brain,
}

impl TemplateType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::T1w => "T1w",
            Self::T2w => "T2w",
            Self::Flair => "FLAIR",
            Self::GrayMatter => "GM",
            Self::WhiteMatter => "WM",
            Self::Csf => "CSF",
            Self::BrainMask => "mask",
            Self::Brain => "brain",
        }
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            Self::T1w => "T1-weighted",
            Self::T2w => "T2-weighted",
            Self::Flair => "FLAIR",
            Self::GrayMatter => "Gray Matter",
            Self::WhiteMatter => "White Matter",
            Self::Csf => "CSF",
            Self::BrainMask => "Brain Mask",
            Self::Brain => "Brain",
        }
    }
}

impl std::fmt::Display for TemplateType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.display_name())
    }
}

/// Template coordinate spaces
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum TemplateSpace {
    #[serde(rename = "MNI152NLin2009cAsym")]
    MNI152NLin2009cAsym,
    #[serde(rename = "MNI152NLin6Asym")]
    MNI152NLin6Asym,
    #[serde(rename = "MNIColin27")]
    MNIColin27,
    #[serde(rename = "MNI305")]
    MNI305,
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
            Self::MNI152NLin2009cAsym => "MNI152NLin2009cAsym",
            Self::MNI152NLin6Asym => "MNI152NLin6Asym",
            Self::MNIColin27 => "MNIColin27",
            Self::MNI305 => "MNI305",
            Self::FSAverage => "fsaverage",
            Self::FSAverage5 => "fsaverage5",
            Self::FSAverage6 => "fsaverage6",
        }
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            Self::MNI152NLin2009cAsym => "MNI152 2009c Asymmetric",
            Self::MNI152NLin6Asym => "MNI152 6th Gen Asymmetric",
            Self::MNIColin27 => "MNI Colin27",
            Self::MNI305 => "MNI305",
            Self::FSAverage => "FreeSurfer Average",
            Self::FSAverage5 => "FreeSurfer Average (5k vertices)",
            Self::FSAverage6 => "FreeSurfer Average (41k vertices)",
        }
    }

    pub fn is_volume_space(&self) -> bool {
        matches!(
            self,
            Self::MNI152NLin2009cAsym | Self::MNI152NLin6Asym | Self::MNIColin27 | Self::MNI305
        )
    }

    pub fn is_surface_space(&self) -> bool {
        matches!(self, Self::FSAverage | Self::FSAverage5 | Self::FSAverage6)
    }
}

impl std::fmt::Display for TemplateSpace {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.display_name())
    }
}

/// Template resolutions
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum TemplateResolution {
    #[serde(rename = "1mm")]
    MM1,
    #[serde(rename = "2mm")]
    MM2,
    #[serde(rename = "native")]
    Native,
}

impl TemplateResolution {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::MM1 => "1mm",
            Self::MM2 => "2mm",
            Self::Native => "native",
        }
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            Self::MM1 => "1mm",
            Self::MM2 => "2mm",
            Self::Native => "Native",
        }
    }
}

impl std::fmt::Display for TemplateResolution {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.display_name())
    }
}

/// Configuration for loading a template
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TemplateConfig {
    pub template_type: TemplateType,
    pub space: TemplateSpace,
    pub resolution: TemplateResolution,
    /// Additional parameters for template variants
    pub params: Option<HashMap<String, String>>,
}

impl TemplateConfig {
    pub fn new(
        template_type: TemplateType,
        space: TemplateSpace,
        resolution: TemplateResolution,
    ) -> Self {
        Self {
            template_type,
            space,
            resolution,
            params: None,
        }
    }

    /// Generate a unique identifier for this template configuration
    pub fn id(&self) -> String {
        format!(
            "{}_{}_{}",
            self.space.as_str(),
            self.template_type.as_str(),
            self.resolution.as_str()
        )
    }

    /// Generate a human-readable name for this template
    pub fn display_name(&self) -> String {
        format!(
            "{} {} ({})",
            self.template_type.display_name(),
            self.space.display_name(),
            self.resolution.display_name()
        )
    }
}

/// Catalog entry for a template
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TemplateCatalogEntry {
    pub id: String,
    pub config: TemplateConfig,
    pub name: String,
    pub description: String,
    pub download_url: Option<String>,
    pub file_size_mb: Option<f64>,
    pub checksum: Option<String>,
    pub is_cached: bool,
    pub last_accessed: Option<String>,
}

/// Progress information for template loading
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TemplateLoadProgress {
    pub template_id: String,
    pub stage: LoadingStage,
    pub progress: f32, // 0.0 to 1.0
    pub message: String,
}

/// Stages of template loading
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum LoadingStage {
    /// Checking local cache
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
            Self::CheckingCache => write!(f, "Checking Cache"),
            Self::Downloading => write!(f, "Downloading"),
            Self::Loading => write!(f, "Loading"),
            Self::Processing => write!(f, "Processing"),
            Self::Complete => write!(f, "Complete"),
            Self::Error => write!(f, "Error"),
        }
    }
}

/// Metadata about a loaded template
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TemplateMetadata {
    pub id: String,
    pub name: String,
    pub description: String,
    pub space: String,
    pub resolution: String,
    pub template_type: String,
    /// Bounding box in world coordinates
    pub bounds_mm: Option<[[f32; 3]; 2]>, // [min, max]
    /// Data range for intensity values
    pub data_range: Option<[f32; 2]>,
}

/// Result of successful template loading
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TemplateLoadResult {
    pub template_metadata: TemplateMetadata,
    pub volume_handle_info: bridge_types::VolumeHandleInfo, // Complete volume handle information
}

/// Error types for template operations  
#[derive(Debug, thiserror::Error, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "type", content = "data")]
pub enum TemplateError {
    #[error("Template not found: {0}")]
    TemplateNotFound(String),
    #[error("Unsupported space: {0}")]
    UnsupportedSpace(String),
    #[error("Unsupported resolution: {0}")]
    UnsupportedResolution(String),
    #[error("Unsupported template type: {0}")]
    UnsupportedTemplateType(String),
    #[error("Configuration validation failed: {0}")]
    ValidationFailed(String),
    #[error("Failed to load template data: {0}")]
    LoadFailed(String),
    #[error("Download failed: {0}")]
    DownloadFailed(String),
    #[error("Invalid parameter: {field} = {value}")]
    InvalidParameter { field: String, value: String },
    #[error("IO error: {0}")]
    IoError(String),
    #[error("Path security violation: {0}")]
    PathSecurityViolation(String),
    #[error("Cache error: {0}")]
    CacheError(String),
}

/// Filter options for template catalog
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TemplateFilter {
    pub template_type: Option<TemplateType>,
    pub space: Option<TemplateSpace>,
    pub resolution: Option<TemplateResolution>,
    pub show_cached_only: bool,
}

/// Cache statistics information
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TemplateCacheStats {
    /// Total size of all cached files in bytes
    pub total_size_bytes: u64,
    /// Number of files in cache
    pub file_count: usize,
    /// List of cached template identifiers
    pub cached_templates: Vec<String>,
}
