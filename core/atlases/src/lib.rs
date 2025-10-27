/*!
 * Atlas and Template Service for Brainflow
 *
 * Provides organized access to brain atlases and templates without requiring file browser navigation.
 * Integrates with neuroatlas-rs for standardized atlas loading and management.
 */

pub mod catalog;
pub mod service;
pub mod types;

#[cfg(test)]
pub mod test_atlas_loading;

pub use catalog::AtlasCatalog;
pub use service::AtlasService;
pub use types::*;

// Re-export commonly used neuroatlas types for convenience
pub use neuroatlas::{
    atlas::{ASEGAtlas, Atlas, GlasserAtlas, OlsenMTLAtlas, SchaeferAtlas},
    core::types::{Hemisphere, Network, Resolution, Space},
    templateflow::TemplateFlowAtlas,
};
