//! Core contracts and types for neuroimaging slice extraction
//!
//! This crate provides the foundational types and traits for extracting
//! 2D slices from 3D neuroimaging volumes with support for:
//! - Arbitrary slice orientations
//! - Multi-layer compositing
//! - Different FOVs and resolutions
//! - Guaranteed square pixels

pub mod error;
pub mod layer;
pub mod slice_builder;
pub mod slice_spec;
pub mod volume_store;

// Re-export key types
pub use error::{Error, Result};
pub use layer::{BlendMode, LayerSpec, LayerVisual};
pub use slice_builder::{PixelStrategy, SliceBuilder};
pub use slice_spec::{BorderMode, InterpolationMethod, SliceSpec};
pub use volume_store::{TestVolume, TestVolumeStore, Volume, VolumeHandle, VolumeStore};

/// Trait for slice extraction implementations
pub trait SliceProvider {
    /// Extract a single-layer slice
    fn extract_slice(&self, volume: &VolumeHandle, spec: &SliceSpec) -> Result<SliceData>;

    /// Extract a multi-layer composite slice
    fn extract_multi_layer_slice(
        &self,
        layers: &[LayerSpec],
        spec: &SliceSpec,
    ) -> Result<CompositeSliceData>;
}

/// Raw slice data
#[derive(Debug, Clone)]
pub struct SliceData {
    pub data: Vec<f32>,
    pub dimensions: [u32; 2],
}

/// Composite RGBA slice data
#[derive(Debug, Clone)]
pub struct CompositeSliceData {
    pub data: Vec<u8>, // RGBA premultiplied
    pub dimensions: [u32; 2],
}
