//! Core contracts and types for neuroimaging slice extraction
//! 
//! This crate provides the foundational types and traits for extracting
//! 2D slices from 3D neuroimaging volumes with support for:
//! - Arbitrary slice orientations
//! - Multi-layer compositing
//! - Different FOVs and resolutions
//! - Guaranteed square pixels

pub mod slice_spec;
pub mod layer;
pub mod volume_store;
pub mod slice_builder;
pub mod error;

// Re-export key types
pub use slice_spec::{SliceSpec, InterpolationMethod, BorderMode};
pub use layer::{LayerSpec, LayerVisual, BlendMode};
pub use volume_store::{VolumeStore, VolumeHandle, Volume, TestVolumeStore, TestVolume};
pub use slice_builder::{SliceBuilder, PixelStrategy};
pub use error::{Result, Error};

/// Trait for slice extraction implementations
pub trait SliceProvider {
    /// Extract a single-layer slice
    fn extract_slice(&self, volume: &VolumeHandle, spec: &SliceSpec) -> Result<SliceData>;
    
    /// Extract a multi-layer composite slice
    fn extract_multi_layer_slice(&self, layers: &[LayerSpec], spec: &SliceSpec) -> Result<CompositeSliceData>;
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
    pub data: Vec<u8>,  // RGBA premultiplied
    pub dimensions: [u32; 2],
}