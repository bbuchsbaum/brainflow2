//! Layer specification types
//!
//! Defines how to render and composite multiple volumetric layers
//! All coordinates and transforms are in world space for GPU/CPU consistency.

use crate::VolumeHandle;
use nalgebra::Matrix4;
use serde::{Deserialize, Serialize};

/// Specification for a single layer in a multi-layer composite
#[derive(Debug, Clone)]
pub struct LayerSpec {
    /// Handle to the volume data
    pub volume_id: VolumeHandle,

    /// Transform from voxel indices to world coordinates (mm)
    /// This is typically from the NIfTI header's sform or qform
    pub world_from_voxel: Matrix4<f32>,

    /// Visual parameters for rendering this layer
    pub visual: LayerVisual,
}

/// Visual parameters for layer rendering
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LayerVisual {
    /// Opacity of this layer (0.0 = transparent, 1.0 = opaque)
    pub opacity: f32,

    /// Colormap to apply (index into colormap array)
    pub colormap_id: u32,

    /// Intensity range for windowing (min, max)
    pub intensity_range: (f32, f32),

    /// Optional override for display range
    pub display_range: Option<(f32, f32)>,

    /// Threshold range - values outside are transparent
    pub threshold_range: (f32, f32),

    /// How to blend this layer with those below
    pub blend_mode: BlendMode,

    /// Whether alpha is premultiplied
    pub premultiplied: bool,

    /// Whether this is a binary mask
    pub is_mask: bool,
}

impl Default for LayerVisual {
    fn default() -> Self {
        Self {
            opacity: 1.0,
            colormap_id: 0, // Grayscale
            intensity_range: (0.0, 1.0),
            display_range: None,
            threshold_range: (f32::NEG_INFINITY, f32::INFINITY),
            blend_mode: BlendMode::Normal,
            premultiplied: true,
            is_mask: false,
        }
    }
}

impl LayerVisual {
    /// Create visual parameters for a binary mask
    pub fn mask(colormap_id: u32, opacity: f32) -> Self {
        Self {
            opacity,
            colormap_id,
            is_mask: true,
            threshold_range: (0.5, f32::INFINITY), // Binary threshold
            ..Default::default()
        }
    }

    /// Create visual parameters for an overlay (e.g., fMRI activation)
    pub fn overlay(colormap_id: u32, opacity: f32, threshold: f32) -> Self {
        Self {
            opacity,
            colormap_id,
            blend_mode: BlendMode::Additive,
            threshold_range: (threshold, f32::INFINITY),
            ..Default::default()
        }
    }

    /// Get the effective display range (considering override)
    pub fn get_display_range(&self) -> (f32, f32) {
        self.display_range.unwrap_or(self.intensity_range)
    }
}

/// Blend mode for layer compositing
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BlendMode {
    /// Standard alpha blending (back-to-front)
    /// result = dst + src * (1 - dst.alpha)
    Normal,

    /// Additive blending for overlays
    /// result = clamp(dst + src)
    Additive,

    /// Multiply blending for masks
    /// result = dst * src
    Multiply,
}

impl Default for BlendMode {
    fn default() -> Self {
        Self::Normal
    }
}

/// Composite request containing slice specification and layers
#[derive(Debug, Clone)]
pub struct CompositeRequest {
    /// Slice specification in world coordinates
    pub slice: crate::SliceSpec,

    /// Layers to composite, in back-to-front order
    pub layers: Vec<LayerSpec>,
}

impl CompositeRequest {
    /// Create a new composite request
    pub fn new(slice: crate::SliceSpec, layers: Vec<LayerSpec>) -> Self {
        Self { slice, layers }
    }

    /// Create a single-layer request
    pub fn single_layer(slice: crate::SliceSpec, layer: LayerSpec) -> Self {
        Self::new(slice, vec![layer])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nalgebra::Matrix4;

    #[test]
    fn test_layer_spec_transform() {
        let layer = LayerSpec {
            volume_id: VolumeHandle::new(0),
            world_from_voxel: Matrix4::identity(),
            visual: LayerVisual::default(),
        };

        // Check that transform is invertible (required for world->voxel)
        assert!(layer.world_from_voxel.try_inverse().is_some());
    }

    #[test]
    fn test_layer_visual_defaults() {
        let visual = LayerVisual::default();
        assert_eq!(visual.opacity, 1.0);
        assert_eq!(visual.colormap_id, 0);
        assert_eq!(visual.blend_mode, BlendMode::Normal);
        assert!(visual.premultiplied);
        assert!(!visual.is_mask);
    }

    #[test]
    fn test_mask_visual() {
        let mask = LayerVisual::mask(5, 0.5);
        assert!(mask.is_mask);
        assert_eq!(mask.colormap_id, 5);
        assert_eq!(mask.opacity, 0.5);
        assert_eq!(mask.threshold_range.0, 0.5);
    }

    #[test]
    fn test_overlay_visual() {
        let overlay = LayerVisual::overlay(10, 0.7, 2.5);
        assert_eq!(overlay.blend_mode, BlendMode::Additive);
        assert_eq!(overlay.threshold_range.0, 2.5);
        assert_eq!(overlay.opacity, 0.7);
    }

    #[test]
    fn test_display_range_override() {
        let mut visual = LayerVisual::default();
        visual.intensity_range = (0.0, 100.0);
        assert_eq!(visual.get_display_range(), (0.0, 100.0));

        visual.display_range = Some((10.0, 90.0));
        assert_eq!(visual.get_display_range(), (10.0, 90.0));
    }

    #[test]
    fn test_composite_request() {
        let slice = crate::SliceSpec::axial_at([0.0, 0.0, 0.0], [100.0, 100.0], [256, 256]);
        let layer = LayerSpec {
            volume_id: VolumeHandle::new(0),
            world_from_voxel: Matrix4::identity(),
            visual: LayerVisual::default(),
        };

        let request = CompositeRequest::single_layer(slice, layer);
        assert_eq!(request.layers.len(), 1);
        assert_eq!(request.slice.dim_px, [256, 256]);
    }
}
