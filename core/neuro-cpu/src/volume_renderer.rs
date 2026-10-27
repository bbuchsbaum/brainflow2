//! CPU volume renderer for differential testing
//!
//! Provides a reference implementation for volume slice extraction
//! that matches the GPU rendering approach

use colormap::BuiltinColormap;
use nalgebra::{Matrix4, Point3};
use neuro_types::{Result as NeuroResult, RgbaImage, SliceSpec};
use volmath::{CompatibleVolume, NeuroVol};

/// CPU-based volume slice renderer
pub struct CpuVolumeRenderer {
    /// Background color (RGBA)
    background: [u8; 4],
}

impl CpuVolumeRenderer {
    /// Create a new CPU volume renderer
    pub fn new() -> Self {
        Self {
            // Match GPU renderer's clear color: (0.2, 0.2, 0.2) in linear space
            // which is approximately (51, 51, 51) in sRGB
            background: [51, 51, 51, 255], // Gray background to match GPU
        }
    }

    /// Render a volume slice matching GPU approach
    pub fn render_volume_slice(
        &self,
        volume: &CompatibleVolume<f32>,
        slice_spec: &SliceSpec,
        intensity_min: f32,
        intensity_max: f32,
        colormap: BuiltinColormap,
        opacity: f32,
    ) -> NeuroResult<RgbaImage> {
        let width = slice_spec.dim_px[0];
        let height = slice_spec.dim_px[1];
        let mut buffer = vec![0u8; (width * height * 4) as usize];

        // Initialize background
        for chunk in buffer.chunks_mut(4) {
            chunk[0] = self.background[0];
            chunk[1] = self.background[1];
            chunk[2] = self.background[2];
            chunk[3] = self.background[3];
        }

        // Get world-to-voxel transform
        let world_to_voxel = self.compute_world_to_voxel_transform(volume);

        // Get colormap data
        let colormap_data = colormap.data();

        // Sample each pixel
        for y in 0..height {
            for x in 0..width {
                // Calculate world position using slice spec
                let world_pos = slice_spec.pixel_to_world(x, y);
                let world_point = Point3::new(world_pos[0], world_pos[1], world_pos[2]);

                // Transform to voxel coordinates
                let voxel_coord_h = world_to_voxel
                    * nalgebra::Vector4::new(world_point.x, world_point.y, world_point.z, 1.0);

                if voxel_coord_h.w <= 0.0 {
                    continue;
                }

                let voxel_coord = nalgebra::Vector3::new(
                    voxel_coord_h.x / voxel_coord_h.w,
                    voxel_coord_h.y / voxel_coord_h.w,
                    voxel_coord_h.z / voxel_coord_h.w,
                );

                let Some(value) = crate::interpolation::sample_trilinear_with(
                    [
                        volume.space.dims()[0],
                        volume.space.dims()[1],
                        volume.space.dims()[2],
                    ],
                    [voxel_coord.x, voxel_coord.y, voxel_coord.z],
                    |[x, y, z]| volume.inner().get_at(x, y, z),
                ) else {
                    continue;
                };

                // Normalize intensity
                let intensity_delta = (intensity_max - intensity_min).max(1e-9);
                let intensity_norm = ((value - intensity_min) / intensity_delta).clamp(0.0, 1.0);

                // Sample the colormap
                let cmap_index = ((intensity_norm * 255.0) as usize).min(255);
                let [r, g, b, _] = colormap_data[cmap_index];

                // Apply opacity
                let alpha = (opacity * 255.0) as u8;

                // Write pixel - no Y-flip needed, coordinate system is already correct
                let pixel_idx = ((y * width + x) * 4) as usize;
                buffer[pixel_idx] = r;
                buffer[pixel_idx + 1] = g;
                buffer[pixel_idx + 2] = b;
                buffer[pixel_idx + 3] = alpha;
            }
        }

        Ok(buffer)
    }

    /// Compute world-to-voxel transformation matrix
    fn compute_world_to_voxel_transform(&self, volume: &CompatibleVolume<f32>) -> Matrix4<f32> {
        // Get the world-to-voxel transform from the volume's space wrapper
        volume.space.world_to_voxel()
    }
}

impl Default for CpuVolumeRenderer {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use volmath::{NeuroSpace, NeuroSpaceExt};

    #[test]
    fn renders_final_plane_and_singleton_axis_and_rejects_outside() {
        let space = NeuroSpace::from_dims_spacing_origin(vec![2, 2, 1], vec![1.0; 3], vec![0.0; 3])
            .unwrap();
        let volume = CompatibleVolume::from_data(space, vec![1.0f32; 4]);
        let renderer = CpuVolumeRenderer::new();
        let mut slice = SliceSpec::axial_at([0.0; 3], [1.0; 2], [1, 1]);
        slice.origin_mm = [1.0, 1.0, 0.0];
        slice.u_mm = [0.0; 3];
        slice.v_mm = [0.0; 3];
        let render = |slice: &SliceSpec| {
            renderer
                .render_volume_slice(&volume, slice, 0.0, 1.0, BuiltinColormap::Grayscale, 1.0)
                .unwrap()
        };
        assert_ne!(render(&slice), vec![51, 51, 51, 255]);
        slice.origin_mm[2] = 1.0;
        assert_eq!(render(&slice), vec![51, 51, 51, 255]);
    }

    #[test]
    fn test_cpu_volume_renderer() {
        let renderer = CpuVolumeRenderer::new();

        // Create a simple test volume
        let space = NeuroSpace::from_dims_spacing_origin(
            vec![10, 10, 10],
            vec![1.0, 1.0, 1.0],
            vec![0.0, 0.0, 0.0],
        )
        .unwrap();
        let data = vec![0.5f32; 10 * 10 * 10];
        let volume = CompatibleVolume::from_data(space, data);

        // Create a slice spec
        let slice = SliceSpec::axial_at([5.0, 5.0, 5.0], [10.0, 10.0], [10, 10]);

        // Render
        let result = renderer.render_volume_slice(
            &volume,
            &slice,
            0.0,
            1.0,
            BuiltinColormap::Grayscale,
            1.0,
        );

        assert!(result.is_ok());
        let buffer = result.unwrap();
        assert_eq!(buffer.len(), 10 * 10 * 4);
    }
}
