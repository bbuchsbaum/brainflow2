/*!
 * Template System - Fast access to brain templates
 * 
 * Provides hierarchical menu access to commonly used brain templates
 * including T1w, T2w, and tissue segmentation volumes in various spaces
 * and resolutions.
 */

pub mod types;
pub mod catalog;
pub mod service;

pub use types::*;
pub use catalog::TemplateCatalog;
pub use service::TemplateService;

// Re-export commonly used types
pub use types::{
    TemplateType, TemplateSpace, TemplateResolution, TemplateConfig,
    TemplateCatalogEntry, TemplateLoadResult, TemplateError
};