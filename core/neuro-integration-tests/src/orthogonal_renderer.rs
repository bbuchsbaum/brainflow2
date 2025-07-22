//! Orthogonal slice renderer with crosshair visualization
//!
//! This module provides functionality to render orthogonal slices (axial, sagittal, coronal)
//! through 3D volumes at specific world space coordinates, with crosshair overlays.

use neuro_types::{SliceSpec, RgbaImage, Result as NeuroResult};
use nalgebra::Point3;
use crate::image_utils::{RgbaImageWithDimensions, ImageDimensions};

/// Represents orthogonal slices at a specific world coordinate
#[derive(Debug, Clone)]
pub struct OrthogonalSlices {
    /// World space coordinate where slices intersect
    pub world_coordinate: Point3<f64>,
    
    /// Axial slice (horizontal, Z plane)
    pub axial: RgbaImage,
    
    /// Sagittal slice (side view, X plane)
    pub sagittal: RgbaImage,
    
    /// Coronal slice (front view, Y plane)
    pub coronal: RgbaImage,
    
    /// Dimensions of each slice (for proper image saving)
    pub axial_dims: ImageDimensions,
    pub sagittal_dims: ImageDimensions,
    pub coronal_dims: ImageDimensions,
}

/// Configuration for orthogonal slice extraction
#[derive(Debug, Clone)]
pub struct OrthogonalSliceConfig {
    /// Field of view in mm for each slice [width, height]
    pub fov_mm: [f32; 2],
    
    /// Output dimensions in pixels [width, height]
    pub dim_px: [u32; 2],
}

impl Default for OrthogonalSliceConfig {
    fn default() -> Self {
        Self {
            fov_mm: [150.0, 150.0], // 150mm x 150mm field of view
            dim_px: [256, 256],      // 256x256 pixel output
        }
    }
}

/// Create orthogonal slice specifications at a world space point
pub fn create_orthogonal_slices(
    world_point: Point3<f64>,
    config: &OrthogonalSliceConfig,
) -> (SliceSpec, SliceSpec, SliceSpec) {
    // Convert Point3<f64> to [f32; 3]
    let center_mm = [
        world_point.x as f32,
        world_point.y as f32,
        world_point.z as f32,
    ];
    
    // Pass the full center_mm array to each constructor
    let axial = SliceSpec::axial_at(center_mm, config.fov_mm, config.dim_px);
    let sagittal = SliceSpec::sagittal_at(center_mm, config.fov_mm, config.dim_px);
    let coronal = SliceSpec::coronal_at(center_mm, config.fov_mm, config.dim_px);
    
    (axial, sagittal, coronal)
}

/// Draw crosshairs on an RGBA image at the specified pixel coordinates
pub fn draw_crosshairs(
    image: &mut RgbaImage,
    center_x: i32,
    center_y: i32,
    width: u32,
    height: u32,
) {
    // Crosshair colors
    const CROSSHAIR_COLOR: [u8; 4] = [255, 0, 0, 255];     // Red lines
    const CENTER_COLOR: [u8; 4] = [255, 255, 0, 255];      // Yellow center
    
    // Draw horizontal line
    if center_y >= 0 && center_y < height as i32 {
        for x in 0..width {
            let idx = ((center_y as u32 * width + x) * 4) as usize;
            if idx + 3 < image.len() {
                image[idx..idx + 4].copy_from_slice(&CROSSHAIR_COLOR);
            }
        }
    }
    
    // Draw vertical line
    if center_x >= 0 && center_x < width as i32 {
        for y in 0..height {
            let idx = ((y * width + center_x as u32) * 4) as usize;
            if idx + 3 < image.len() {
                image[idx..idx + 4].copy_from_slice(&CROSSHAIR_COLOR);
            }
        }
    }
    
    // Draw center dot (3x3 pixels)
    for dy in -1..=1 {
        for dx in -1..=1 {
            let px = center_x + dx;
            let py = center_y + dy;
            
            if px >= 0 && px < width as i32 && py >= 0 && py < height as i32 {
                let idx = ((py as u32 * width + px as u32) * 4) as usize;
                if idx + 3 < image.len() {
                    image[idx..idx + 4].copy_from_slice(&CENTER_COLOR);
                }
            }
        }
    }
}

/// Convert world coordinates to pixel coordinates for a given slice
/// Returns (x, y) pixel coordinates
pub fn world_to_slice_pixel(
    world_point: Point3<f64>,
    slice_spec: &SliceSpec,
) -> (i32, i32) {
    // Calculate the position relative to the slice origin
    let rel_x = world_point.x as f32 - slice_spec.origin_mm[0];
    let rel_y = world_point.y as f32 - slice_spec.origin_mm[1];
    let rel_z = world_point.z as f32 - slice_spec.origin_mm[2];
    
    // Project onto the slice plane using dot products with u and v vectors
    // This accounts for the slice orientation
    let u_proj = rel_x * slice_spec.u_mm[0] + rel_y * slice_spec.u_mm[1] + rel_z * slice_spec.u_mm[2];
    let v_proj = rel_x * slice_spec.v_mm[0] + rel_y * slice_spec.v_mm[1] + rel_z * slice_spec.v_mm[2];
    
    // Convert to pixel coordinates
    // To find the pixel coordinates, we need to find the coefficients in the equation:
    // rel = pixel_x * u_mm + pixel_y * v_mm
    // For axis-aligned slices, this simplifies to dividing by the magnitude squared
    // Formula: pixel = (rel · u_mm) / |u_mm|²
    let u_mag_sq = slice_spec.u_mm[0].powi(2) + slice_spec.u_mm[1].powi(2) + slice_spec.u_mm[2].powi(2);
    let v_mag_sq = slice_spec.v_mm[0].powi(2) + slice_spec.v_mm[1].powi(2) + slice_spec.v_mm[2].powi(2);
    
    // Avoid division by zero if vectors are zero-length (invalid spec)
    let pixel_x = if u_mag_sq > 1e-9 {
        (u_proj / u_mag_sq).round() as i32
    } else {
        0
    };
    
    let pixel_y = if v_mag_sq > 1e-9 {
        (v_proj / v_mag_sq).round() as i32
    } else {
        0
    };
    
    (pixel_x, pixel_y)
}

/// Add crosshairs to orthogonal slices at the world coordinate
pub fn add_crosshairs_to_slices(
    slices: &mut OrthogonalSlices,
    axial_spec: &SliceSpec,
    sagittal_spec: &SliceSpec,
    coronal_spec: &SliceSpec,
) {
    // Convert world coordinate to pixel coordinates for each slice
    let (ax_x, ax_y) = world_to_slice_pixel(slices.world_coordinate, axial_spec);
    let (sag_x, sag_y) = world_to_slice_pixel(slices.world_coordinate, sagittal_spec);
    let (cor_x, cor_y) = world_to_slice_pixel(slices.world_coordinate, coronal_spec);
    
    // Draw crosshairs on each slice using their respective dimensions
    draw_crosshairs(&mut slices.axial, ax_x, ax_y, axial_spec.dim_px[0], axial_spec.dim_px[1]);
    draw_crosshairs(&mut slices.sagittal, sag_x, sag_y, sagittal_spec.dim_px[0], sagittal_spec.dim_px[1]);
    draw_crosshairs(&mut slices.coronal, cor_x, cor_y, coronal_spec.dim_px[0], coronal_spec.dim_px[1]);
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_create_orthogonal_slices() {
        let world_point = Point3::new(10.0, -5.0, 15.0);
        let config = OrthogonalSliceConfig::default();
        
        let (axial, sagittal, coronal) = create_orthogonal_slices(world_point, &config);
        
        // Verify slice positions
        assert_eq!(axial.origin_mm[2], 15.0); // Z coordinate
        assert_eq!(sagittal.origin_mm[0], 10.0); // X coordinate
        assert_eq!(coronal.origin_mm[1], -5.0); // Y coordinate
    }
    
    #[test]
    fn test_world_to_slice_pixel() {
        let world_point = Point3::new(0.0, 0.0, 0.0);
        let config = OrthogonalSliceConfig::default();
        
        // Create an axial slice at z=0
        let axial = SliceSpec::axial_at([0.0, 0.0, 0.0], config.fov_mm, config.dim_px);
        
        // World origin should map to center of the slice
        let (px, py) = world_to_slice_pixel(world_point, &axial);
        
        // Since the slice is centered at origin with 150mm FOV and 256px dimension,
        // the center should be at (128, 128)
        assert_eq!(px, 128);
        assert_eq!(py, 128);
    }
}