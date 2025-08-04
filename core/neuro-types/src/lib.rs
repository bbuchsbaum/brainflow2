//! Canonical type definitions for neuroimaging slice extraction and rendering
//!
//! This crate provides the core contracts that both CPU and GPU implementations
//! must satisfy for unified differential testing and API consistency.

pub mod layer_spec;
pub mod metrics;
pub mod provider;
pub mod shapes;
pub mod slice_spec;
pub mod testing;
pub mod view_rect;
pub mod volume;

pub use layer_spec::*;
pub use metrics::*;
pub use provider::*;
pub use shapes::*;
pub use slice_spec::*;
pub use view_rect::*;
pub use volume::*;

/// Handle to reference a volume in storage
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct VolumeHandle(pub usize);

impl VolumeHandle {
    /// Create a new handle with the given ID
    pub fn new(id: usize) -> Self {
        Self(id)
    }
}

/// Result type for neuroimaging operations
pub type Result<T> = std::result::Result<T, Error>;

/// Error types for neuroimaging operations
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Volume not found: {0:?}")]
    VolumeNotFound(VolumeHandle),

    #[error("Transform error: {0}")]
    TransformError(String),

    #[error("Invalid slice specification: {0}")]
    InvalidSliceSpec(String),

    #[error("GPU error: {0}")]
    GpuError(String),

    #[error("Test error: {0}")]
    TestError(String),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
}
