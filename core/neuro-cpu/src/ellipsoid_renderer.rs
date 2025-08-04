//! CPU ellipsoid renderer for differential testing
//!
//! Provides a reference implementation that matches the GPU rendering approach

use crate::blending;
use colormap::{colormap_by_name, BuiltinColormap};
use nalgebra::{Matrix4, Point3};
use neuro_types::{OrientedEllipsoid, Result as NeuroResult, RgbaImage};

/// CPU-based ellipsoid renderer
pub struct CpuEllipsoidRenderer {
    /// Background color (RGBA)
    background: [u8; 4],
}

impl CpuEllipsoidRenderer {
    /// Create a new CPU ellipsoid renderer
    pub fn new() -> Self {
        Self {
            // Match GPU renderer's clear color: (0.2, 0.2, 0.2) in linear space
            // which is approximately (51, 51, 51) in sRGB
            background: [51, 51, 51, 255], // Gray background to match GPU
        }
    }

    /// Render an ellipsoid to an RGBA image
    ///
    /// # Parameters
    /// - `ellipsoid`: The ellipsoid to render
    /// - `width`: Image width in pixels
    /// - `height`: Image height in pixels
    /// - `slice_z_mm`: Z coordinate of the slice plane in mm
    /// - `pixel_spacing_mm`: Pixel spacing in mm
    /// - `color`: RGBA color for the ellipsoid
    pub fn render_slice(
        &self,
        ellipsoid: &OrientedEllipsoid,
        width: u32,
        height: u32,
        slice_z_mm: f32,
        pixel_spacing_mm: f32,
        color: [u8; 4],
    ) -> NeuroResult<RgbaImage> {
        let mut buffer = vec![0u8; (width * height * 4) as usize];

        // Initialize background
        for chunk in buffer.chunks_mut(4) {
            chunk[0] = self.background[0];
            chunk[1] = self.background[1];
            chunk[2] = self.background[2];
            chunk[3] = self.background[3];
        }

        // Calculate world bounds of the image
        let half_width_mm = (width as f32 * pixel_spacing_mm) / 2.0;
        let half_height_mm = (height as f32 * pixel_spacing_mm) / 2.0;

        // Get inverse transform for world-to-ellipsoid transformation
        let world_to_ellipsoid_f64 = ellipsoid.world_to_ellipsoid_matrix();

        // Convert to f32 for rendering
        let world_to_ellipsoid = Matrix4::new(
            world_to_ellipsoid_f64[(0, 0)] as f32,
            world_to_ellipsoid_f64[(0, 1)] as f32,
            world_to_ellipsoid_f64[(0, 2)] as f32,
            world_to_ellipsoid_f64[(0, 3)] as f32,
            world_to_ellipsoid_f64[(1, 0)] as f32,
            world_to_ellipsoid_f64[(1, 1)] as f32,
            world_to_ellipsoid_f64[(1, 2)] as f32,
            world_to_ellipsoid_f64[(1, 3)] as f32,
            world_to_ellipsoid_f64[(2, 0)] as f32,
            world_to_ellipsoid_f64[(2, 1)] as f32,
            world_to_ellipsoid_f64[(2, 2)] as f32,
            world_to_ellipsoid_f64[(2, 3)] as f32,
            world_to_ellipsoid_f64[(3, 0)] as f32,
            world_to_ellipsoid_f64[(3, 1)] as f32,
            world_to_ellipsoid_f64[(3, 2)] as f32,
            world_to_ellipsoid_f64[(3, 3)] as f32,
        );

        // Render each pixel
        for y in 0..height {
            for x in 0..width {
                // Calculate world position of this pixel
                let world_x = (x as f32 - width as f32 / 2.0) * pixel_spacing_mm;
                let world_y = (y as f32 - height as f32 / 2.0) * pixel_spacing_mm;
                let world_pos = Point3::new(world_x, world_y, slice_z_mm);

                // Transform to ellipsoid space
                let ellipsoid_pos = world_to_ellipsoid.transform_point(&world_pos);

                // Check if inside ellipsoid (normalized coordinates)
                let normalized_x = ellipsoid_pos.x / ellipsoid.radii.x as f32;
                let normalized_y = ellipsoid_pos.y / ellipsoid.radii.y as f32;
                let normalized_z = ellipsoid_pos.z / ellipsoid.radii.z as f32;

                let distance_squared = normalized_x * normalized_x
                    + normalized_y * normalized_y
                    + normalized_z * normalized_z;

                if distance_squared <= 1.0 {
                    // Inside ellipsoid - apply color with intensity based on distance
                    let intensity = ellipsoid.intensity * (1.0 - distance_squared.sqrt()).max(0.0);

                    let pixel_idx = ((y * width + x) * 4) as usize;

                    // Premultiply alpha
                    let alpha = (color[3] as f32 * intensity) as u8;
                    buffer[pixel_idx] = (color[0] as f32 * intensity * alpha as f32 / 255.0) as u8;
                    buffer[pixel_idx + 1] =
                        (color[1] as f32 * intensity * alpha as f32 / 255.0) as u8;
                    buffer[pixel_idx + 2] =
                        (color[2] as f32 * intensity * alpha as f32 / 255.0) as u8;
                    buffer[pixel_idx + 3] = alpha;
                }
            }
        }

        Ok(buffer)
    }

    /// Render an ellipsoid volume slice matching GPU approach
    /// This version matches the GPU's volume sampling approach
    pub fn render_volume_slice(
        &self,
        ellipsoid: &OrientedEllipsoid,
        slice_spec: &neuro_types::SliceSpec,
        color: [u8; 4],
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

        // Get inverse transform
        let world_to_ellipsoid_f64 = ellipsoid.world_to_ellipsoid_matrix();

        // Convert to f32 for rendering
        let world_to_ellipsoid = Matrix4::new(
            world_to_ellipsoid_f64[(0, 0)] as f32,
            world_to_ellipsoid_f64[(0, 1)] as f32,
            world_to_ellipsoid_f64[(0, 2)] as f32,
            world_to_ellipsoid_f64[(0, 3)] as f32,
            world_to_ellipsoid_f64[(1, 0)] as f32,
            world_to_ellipsoid_f64[(1, 1)] as f32,
            world_to_ellipsoid_f64[(1, 2)] as f32,
            world_to_ellipsoid_f64[(1, 3)] as f32,
            world_to_ellipsoid_f64[(2, 0)] as f32,
            world_to_ellipsoid_f64[(2, 1)] as f32,
            world_to_ellipsoid_f64[(2, 2)] as f32,
            world_to_ellipsoid_f64[(2, 3)] as f32,
            world_to_ellipsoid_f64[(3, 0)] as f32,
            world_to_ellipsoid_f64[(3, 1)] as f32,
            world_to_ellipsoid_f64[(3, 2)] as f32,
            world_to_ellipsoid_f64[(3, 3)] as f32,
        );

        // Calculate volume bounds (matching GPU logic)
        let padding = 10.0; // mm, same as GPU
        let max_radius = ellipsoid
            .radii
            .x
            .max(ellipsoid.radii.y)
            .max(ellipsoid.radii.z) as f32
            + padding;
        let volume_min = [
            ellipsoid.center.x as f32 - max_radius,
            ellipsoid.center.y as f32 - max_radius,
            ellipsoid.center.z as f32 - max_radius,
        ];
        let volume_max = [
            ellipsoid.center.x as f32 + max_radius,
            ellipsoid.center.y as f32 + max_radius,
            ellipsoid.center.z as f32 + max_radius,
        ];

        // Sample each pixel
        for y in 0..height {
            for x in 0..width {
                // Calculate world position using slice spec
                let world_pos = slice_spec.pixel_to_world(x, y);
                let world_point = Point3::new(world_pos[0], world_pos[1], world_pos[2]);

                // Check if inside volume bounds
                let inside_volume = world_pos[0] >= volume_min[0]
                    && world_pos[0] <= volume_max[0]
                    && world_pos[1] >= volume_min[1]
                    && world_pos[1] <= volume_max[1]
                    && world_pos[2] >= volume_min[2]
                    && world_pos[2] <= volume_max[2];

                if !inside_volume {
                    // Outside volume bounds - keep background
                    continue;
                }

                // Transform to ellipsoid space
                let ellipsoid_pos = world_to_ellipsoid.transform_point(&world_point);

                // Check if inside ellipsoid
                // Note: world_to_ellipsoid matrix already includes scaling by 1/radii
                let normalized_x = ellipsoid_pos.x;
                let normalized_y = ellipsoid_pos.y;
                let normalized_z = ellipsoid_pos.z;

                let distance_squared = normalized_x * normalized_x
                    + normalized_y * normalized_y
                    + normalized_z * normalized_z;

                if distance_squared <= 1.0 {
                    // Calculate intensity with smooth falloff
                    let distance = distance_squared.sqrt();
                    let intensity_norm = (1.0 - distance).max(0.0);

                    let pixel_idx = ((y * width + x) * 4) as usize;

                    // Select colormap based on input color (matching GPU logic)
                    let (r_in, g_in, b_in) = (color[0] as f32, color[1] as f32, color[2] as f32);
                    let colormap_data = if r_in > 200.0 && g_in < 100.0 && b_in < 100.0 {
                        // Red -> Hot colormap
                        BuiltinColormap::Hot.data()
                    } else if b_in > r_in && b_in > g_in && b_in > 128.0 {
                        // Blue-dominant -> Cool colormap
                        BuiltinColormap::Cool.data()
                    } else if r_in > 128.0 && b_in > 128.0 && g_in < 100.0 {
                        // Purple (high red + high blue) -> Cool colormap
                        BuiltinColormap::Cool.data()
                    } else if g_in > r_in && g_in > b_in && g_in > 128.0 {
                        // Green-dominant -> Viridis
                        BuiltinColormap::Viridis.data()
                    } else {
                        // Default -> Grayscale
                        BuiltinColormap::Grayscale.data()
                    };

                    // Sample the colormap using normalized intensity
                    let cmap_index = ((intensity_norm * 255.0) as usize).min(255);
                    let [r_out, g_out, b_out, _] = colormap_data[cmap_index];

                    // Use colormap RGB directly without additional intensity scaling (matching GPU)
                    buffer[pixel_idx] = r_out;
                    buffer[pixel_idx + 1] = g_out;
                    buffer[pixel_idx + 2] = b_out;

                    // Alpha is just the opacity (matching GPU's behavior)
                    buffer[pixel_idx + 3] = color[3];
                } else {
                    // Outside ellipsoid but inside volume bounds - render zeros
                    // This creates the cyan box when zeros are mapped through colormap
                    let pixel_idx = ((y * width + x) * 4) as usize;

                    // Select same colormap as above
                    let (r_in, g_in, b_in) = (color[0] as f32, color[1] as f32, color[2] as f32);
                    let colormap_data = if r_in > 200.0 && g_in < 100.0 && b_in < 100.0 {
                        BuiltinColormap::Hot.data()
                    } else if b_in > r_in && b_in > g_in && b_in > 128.0 {
                        BuiltinColormap::Cool.data()
                    } else if r_in > 128.0 && b_in > 128.0 && g_in < 100.0 {
                        BuiltinColormap::Cool.data()
                    } else if g_in > r_in && g_in > b_in && g_in > 128.0 {
                        BuiltinColormap::Viridis.data()
                    } else {
                        BuiltinColormap::Grayscale.data()
                    };

                    // Zero intensity maps to first colormap entry (black for hot/grayscale)
                    let [r_out, g_out, b_out, _] = colormap_data[0];
                    buffer[pixel_idx] = r_out;
                    buffer[pixel_idx + 1] = g_out;
                    buffer[pixel_idx + 2] = b_out;
                    buffer[pixel_idx + 3] = 255; // Opaque to match GPU behavior
                }
            }
        }

        Ok(buffer)
    }

    /// Composite multiple ellipsoids with blending
    pub fn render_composite(
        &self,
        ellipsoids: &[(OrientedEllipsoid, [u8; 4], neuro_types::BlendMode)],
        slice_spec: &neuro_types::SliceSpec,
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

        // Render each ellipsoid and blend
        for (ellipsoid, color, blend_mode) in ellipsoids {
            let ellipsoid_buffer = self.render_volume_slice(ellipsoid, slice_spec, *color)?;

            // Blend into main buffer
            for i in (0..buffer.len()).step_by(4) {
                let src = [
                    ellipsoid_buffer[i],
                    ellipsoid_buffer[i + 1],
                    ellipsoid_buffer[i + 2],
                    ellipsoid_buffer[i + 3],
                ];

                let dst = [buffer[i], buffer[i + 1], buffer[i + 2], buffer[i + 3]];

                let blended = blending::blend_premultiplied(dst, src, *blend_mode);
                buffer[i..i + 4].copy_from_slice(&blended);
            }
        }

        Ok(buffer)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nalgebra::{Rotation3, Vector3};

    #[test]
    fn test_cpu_ellipsoid_renderer() {
        let renderer = CpuEllipsoidRenderer::new();

        let ellipsoid = OrientedEllipsoid::new(
            Point3::new(128.0, 128.0, 0.0),
            Vector3::new(50.0, 30.0, 20.0),
            Rotation3::identity(),
            1.0,
        )
        .unwrap();

        let result = renderer.render_slice(
            &ellipsoid,
            256,
            256,
            0.0,              // Slice at z=0
            1.0,              // 1mm pixel spacing
            [255, 0, 0, 255], // Red
        );

        assert!(result.is_ok());
        let buffer = result.unwrap();
        assert_eq!(buffer.len(), 256 * 256 * 4);

        // Check that center pixel is red
        let center_idx = (128 * 256 + 128) * 4;
        assert!(buffer[center_idx] > 200); // Red channel should be high
    }

    #[test]
    fn test_volume_slice_rendering() {
        let renderer = CpuEllipsoidRenderer::new();

        let ellipsoid = OrientedEllipsoid::new(
            Point3::new(0.0, 0.0, 0.0),
            Vector3::new(30.0, 20.0, 10.0),
            Rotation3::identity(),
            1.0,
        )
        .unwrap();

        let slice = neuro_types::SliceSpec::axial_at([0.0, 0.0, 0.0], [100.0, 100.0], [256, 256]);

        let result = renderer.render_volume_slice(
            &ellipsoid,
            &slice,
            [0, 255, 0, 255], // Green
        );

        assert!(result.is_ok());
    }
}
