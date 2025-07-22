//! CPU volume renderer for differential testing
//! 
//! Provides a reference implementation for volume slice extraction
//! that matches the GPU rendering approach

use neuro_types::{SliceSpec, RgbaImage, Result as NeuroResult};
use volmath::{CompatibleVolume, NeuroVol};
use nalgebra::{Matrix4, Point3};
use colormap::BuiltinColormap;

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
                let voxel_coord_h = world_to_voxel * nalgebra::Vector4::new(
                    world_point.x,
                    world_point.y,
                    world_point.z,
                    1.0
                );
                
                if voxel_coord_h.w <= 0.0 {
                    continue;
                }
                
                let voxel_coord = nalgebra::Vector3::new(
                    voxel_coord_h.x / voxel_coord_h.w,
                    voxel_coord_h.y / voxel_coord_h.w,
                    voxel_coord_h.z / voxel_coord_h.w,
                );
                
                // Check bounds
                let dims = volume.space.dims();
                if voxel_coord.x < 0.0 || voxel_coord.x >= dims[0] as f32 - 1.0 ||
                   voxel_coord.y < 0.0 || voxel_coord.y >= dims[1] as f32 - 1.0 ||
                   voxel_coord.z < 0.0 || voxel_coord.z >= dims[2] as f32 - 1.0 {
                    continue;
                }
                
                // Sample volume using trilinear interpolation
                let value = self.sample_trilinear(volume, voxel_coord);
                
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
    
    /// Sample volume using trilinear interpolation
    fn sample_trilinear(&self, volume: &CompatibleVolume<f32>, coord: nalgebra::Vector3<f32>) -> f32 {
        let dims = volume.space.dims();
        
        // Get integer and fractional parts
        let x0 = coord.x.floor() as usize;
        let y0 = coord.y.floor() as usize;
        let z0 = coord.z.floor() as usize;
        
        let fx = coord.x - x0 as f32;
        let fy = coord.y - y0 as f32;
        let fz = coord.z - z0 as f32;
        
        // Clamp to valid range
        let x1 = (x0 + 1).min(dims[0] - 1);
        let y1 = (y0 + 1).min(dims[1] - 1);
        let z1 = (z0 + 1).min(dims[2] - 1);
        
        // Sample 8 corners using get_at from NeuroVol trait
        let v000 = volume.inner().get_at(x0, y0, z0).unwrap_or(0.0);
        let v001 = volume.inner().get_at(x0, y0, z1).unwrap_or(0.0);
        let v010 = volume.inner().get_at(x0, y1, z0).unwrap_or(0.0);
        let v011 = volume.inner().get_at(x0, y1, z1).unwrap_or(0.0);
        let v100 = volume.inner().get_at(x1, y0, z0).unwrap_or(0.0);
        let v101 = volume.inner().get_at(x1, y0, z1).unwrap_or(0.0);
        let v110 = volume.inner().get_at(x1, y1, z0).unwrap_or(0.0);
        let v111 = volume.inner().get_at(x1, y1, z1).unwrap_or(0.0);
        
        // Trilinear interpolation
        let v00 = v000 * (1.0 - fx) + v100 * fx;
        let v01 = v001 * (1.0 - fx) + v101 * fx;
        let v10 = v010 * (1.0 - fx) + v110 * fx;
        let v11 = v011 * (1.0 - fx) + v111 * fx;
        
        let v0 = v00 * (1.0 - fy) + v10 * fy;
        let v1 = v01 * (1.0 - fy) + v11 * fy;
        
        v0 * (1.0 - fz) + v1 * fz
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
    use nalgebra::Vector3;
    
    #[test]
    fn test_cpu_volume_renderer() {
        let renderer = CpuVolumeRenderer::new();
        
        // Create a simple test volume
        let space = NeuroSpace::from_dims_spacing_origin(
            vec![10, 10, 10], 
            vec![1.0, 1.0, 1.0],
            vec![0.0, 0.0, 0.0]
        ).unwrap();
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