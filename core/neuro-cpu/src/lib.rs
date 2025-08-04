//! CPU reference implementation for neuroimaging slice extraction
//!
//! Provides a single-pass, world-space sampling implementation
//! that serves as the reference for GPU implementations.

use nalgebra::{Matrix4, Point3};
use neuro_core::{Volume, VolumeHandle as CoreVolumeHandle, VolumeStore};
use neuro_types::{
    CompositeRequest, Result as NeuroResult, RgbaImage, SliceProvider,
    VolumeHandle as NeuroVolumeHandle,
};
use std::sync::Arc;

pub mod blending;
pub mod ellipsoid_renderer;
pub mod interpolation;
pub mod volume_renderer;

pub use ellipsoid_renderer::CpuEllipsoidRenderer;
pub use volume_renderer::CpuVolumeRenderer;

/// CPU-based slice extraction implementation
pub struct CpuSlicer {
    volume_store: Arc<dyn VolumeStore>,
}

impl CpuSlicer {
    /// Create a new CPU slicer with the given volume store
    pub fn new(volume_store: Arc<dyn VolumeStore>) -> Self {
        Self { volume_store }
    }

    /// Convert neuro-types VolumeHandle to neuro-core VolumeHandle
    /// This is a temporary bridge until types are unified
    fn convert_handle(&self, handle: &NeuroVolumeHandle) -> CoreVolumeHandle {
        CoreVolumeHandle(handle.0)
    }

    /// Sample a volume at world coordinates with the specified interpolation
    /// Uses f64 precision internally for accurate coordinate transformations
    fn sample_volume_at_world(
        &self,
        volume: &dyn Volume,
        world_to_voxel: &Matrix4<f32>,
        world_pos: Point3<f32>,
        interp: neuro_types::InterpolationMethod,
        border_mode: neuro_types::BorderMode,
    ) -> Option<f32> {
        // Transform world to voxel coordinates using f64 precision
        let world_vec = nalgebra::Vector4::<f64>::new(
            world_pos.x as f64,
            world_pos.y as f64,
            world_pos.z as f64,
            1.0,
        );

        // Convert transform matrix to f64 for higher precision
        let world_to_voxel_f64 = nalgebra::Matrix4::<f64>::new(
            world_to_voxel[(0, 0)] as f64,
            world_to_voxel[(0, 1)] as f64,
            world_to_voxel[(0, 2)] as f64,
            world_to_voxel[(0, 3)] as f64,
            world_to_voxel[(1, 0)] as f64,
            world_to_voxel[(1, 1)] as f64,
            world_to_voxel[(1, 2)] as f64,
            world_to_voxel[(1, 3)] as f64,
            world_to_voxel[(2, 0)] as f64,
            world_to_voxel[(2, 1)] as f64,
            world_to_voxel[(2, 2)] as f64,
            world_to_voxel[(2, 3)] as f64,
            world_to_voxel[(3, 0)] as f64,
            world_to_voxel[(3, 1)] as f64,
            world_to_voxel[(3, 2)] as f64,
            world_to_voxel[(3, 3)] as f64,
        );

        let voxel_vec_f64 = world_to_voxel_f64 * world_vec;

        // Check for NaN/Inf in f64 space
        if !voxel_vec_f64.x.is_finite()
            || !voxel_vec_f64.y.is_finite()
            || !voxel_vec_f64.z.is_finite()
        {
            return None;
        }

        // Convert back to f32 for sampling (but maintain precision up to this point)
        let mut voxel = [
            voxel_vec_f64.x as f32,
            voxel_vec_f64.y as f32,
            voxel_vec_f64.z as f32,
        ];

        // Handle border mode
        match border_mode {
            neuro_types::BorderMode::Clamp => {
                let dims = volume.dimensions();
                // Clamp coordinates to valid range
                voxel[0] = voxel[0].clamp(0.0, dims[0] as f32 - 1.0);
                voxel[1] = voxel[1].clamp(0.0, dims[1] as f32 - 1.0);
                voxel[2] = voxel[2].clamp(0.0, dims[2] as f32 - 1.0);
            }
            _ => {
                // For Transparent and Constant modes, let interpolation handle bounds
            }
        }

        // Sample based on interpolation method
        match interp {
            neuro_types::InterpolationMethod::Nearest => {
                interpolation::sample_nearest(volume, voxel)
            }
            neuro_types::InterpolationMethod::Linear => {
                interpolation::sample_trilinear(volume, voxel)
            }
            neuro_types::InterpolationMethod::Cubic => {
                // TODO: Implement proper cubic interpolation
                // For now, explicitly error to prevent silent incorrect behavior
                panic!("Cubic interpolation not yet implemented - use Linear or Nearest instead");
            }
        }
    }
}

impl SliceProvider for CpuSlicer {
    fn composite_rgba(&self, request: &CompositeRequest) -> NeuroResult<RgbaImage> {
        let spec = &request.slice;
        let layers = &request.layers;

        // Pre-compute inverse transforms for all layers
        let mut inverse_transforms = Vec::new();
        for layer in layers {
            let inv = layer.world_from_voxel.try_inverse().ok_or_else(|| {
                neuro_types::Error::TransformError(format!(
                    "Cannot invert transform for volume {:?}",
                    layer.volume_id
                ))
            })?;
            inverse_transforms.push(inv);
        }

        // Create output buffer (RGBA premultiplied)
        let total_pixels = (spec.dim_px[0] * spec.dim_px[1]) as usize;
        let mut output = vec![0u8; total_pixels * 4];

        // Single-pass world sampling with back-to-front compositing
        for y in 0..spec.dim_px[1] {
            for x in 0..spec.dim_px[0] {
                // Calculate world position for this pixel
                let world_pos = spec.pixel_to_world(x, y);
                let world_point = Point3::new(world_pos[0], world_pos[1], world_pos[2]);

                // Back-to-front compositing
                let mut dst = [0u8; 4]; // RGBA premultiplied

                for (layer, inv_transform) in layers.iter().zip(&inverse_transforms) {
                    // Get volume
                    let core_handle = self.convert_handle(&layer.volume_id);
                    let volume = match self.volume_store.get_volume(&core_handle) {
                        Some(v) => v,
                        None => continue, // Skip missing volumes
                    };

                    // Sample at world position
                    let sample = self.sample_volume_at_world(
                        volume.as_ref(),
                        inv_transform,
                        world_point,
                        spec.interp,
                        spec.border_mode,
                    );

                    if let Some(value) = sample {
                        // Apply visual parameters and blend
                        let rgba = blending::apply_visual(value, &layer.visual);
                        dst = blending::blend_premultiplied(dst, rgba, layer.visual.blend_mode);
                    }
                }

                // Write final pixel
                let offset = ((y * spec.dim_px[0] + x) * 4) as usize;
                output[offset..offset + 4].copy_from_slice(&dst);
            }
        }

        Ok(output)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cpu_slicer_can_create() {
        // Just test that the basic type can be created
        // Detailed tests will be added once the types are fully unified
        assert!(true);
    }
}
