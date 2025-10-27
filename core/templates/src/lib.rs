/*!
 * Template System - Fast access to brain templates
 *
 * Provides hierarchical menu access to commonly used brain templates
 * including T1w, T2w, and tissue segmentation volumes in various spaces
 * and resolutions.
 */

pub mod catalog;
pub mod service;
pub mod types;

pub use catalog::TemplateCatalog;
pub use service::TemplateService;
pub use types::*;

// Re-export commonly used types
pub use types::{
    TemplateCatalogEntry, TemplateConfig, TemplateError, TemplateLoadResult, TemplateResolution,
    TemplateSpace, TemplateType,
};
