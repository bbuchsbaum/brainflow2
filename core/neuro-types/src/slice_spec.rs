//! Slice specification types
//! 
//! Defines how to extract a 2D slice from a 3D volume with arbitrary orientation
//! All coordinates are in world space (millimeters).

use serde::{Deserialize, Serialize};

/// Specification for extracting a 2D slice from 3D volumes
/// 
/// The slice is defined by an origin point and two basis vectors (u, v) that
/// define the slice plane. Each vector specifies the world-space distance
/// per pixel in that direction, guaranteeing square pixels when |u| = |v|.
/// 
/// **Key Principle**: All coordinates are in world space (millimeters) for
/// consistency between CPU and GPU implementations.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SliceSpec {
    /// Upper-left corner of the slice in world space (mm)
    pub origin_mm: [f32; 3],
    
    /// Right vector - world units (mm) per pixel in the horizontal direction
    pub u_mm: [f32; 3],
    
    /// Down vector - world units (mm) per pixel in the vertical direction
    pub v_mm: [f32; 3],
    
    /// Output dimensions in pixels [width, height]
    pub dim_px: [u32; 2],
    
    /// Interpolation method for sampling
    pub interp: InterpolationMethod,
    
    /// How to handle samples outside the volume
    pub border_mode: BorderMode,
}

impl SliceSpec {
    /// Create an axial slice at the given center point
    /// Shows the full field of view centered around the origin (0,0) for X,Y with Z from center
    pub fn axial_at(center_mm: [f32; 3], extent_mm: [f32; 2], dim_px: [u32; 2]) -> Self {
        let pixel_size = [
            extent_mm[0] / dim_px[0] as f32,
            extent_mm[1] / dim_px[1] as f32,
        ];
        
        Self {
            // Top-left = anterior-right corner so the whole slice is visible
            origin_mm: [-extent_mm[0] / 2.0, extent_mm[1] / 2.0, center_mm[2]],
            u_mm: [pixel_size[0], 0.0, 0.0],       // +X → right
            v_mm: [0.0, -pixel_size[1], 0.0],      // -Y → down (anterior to posterior)
            dim_px,
            interp: InterpolationMethod::Linear,
            border_mode: BorderMode::Transparent,
        }
    }
    
    /// Create a sagittal slice at the given center point
    /// Note: extent_mm represents the full field of view, not centered on center_mm
    pub fn sagittal_at(center_mm: [f32; 3], extent_mm: [f32; 2], dim_px: [u32; 2]) -> Self {
        let pixel_size = [
            extent_mm[0] / dim_px[0] as f32,
            extent_mm[1] / dim_px[1] as f32,
        ];
        
        Self {
            // Left side = frontal lobe, top = superior
            origin_mm: [center_mm[0], extent_mm[0] / 2.0, extent_mm[1] / 2.0],
            u_mm: [0.0, -pixel_size[0], 0.0],      // -Y → rightwards (anterior to posterior)
            v_mm: [0.0, 0.0, -pixel_size[1]],      // -Z → down (superior to inferior)
            dim_px,
            interp: InterpolationMethod::Linear,
            border_mode: BorderMode::Transparent,
        }
    }
    
    /// Create a coronal slice at the given center point
    /// Note: extent_mm represents the full field of view, not centered on center_mm
    pub fn coronal_at(center_mm: [f32; 3], extent_mm: [f32; 2], dim_px: [u32; 2]) -> Self {
        let pixel_size = [
            extent_mm[0] / dim_px[0] as f32,
            extent_mm[1] / dim_px[1] as f32,
        ];
        
        Self {
            // Left side = patient right, top = superior
            origin_mm: [-extent_mm[0] / 2.0, center_mm[1], extent_mm[1] / 2.0],
            u_mm: [pixel_size[0], 0.0, 0.0],       // +X → right
            v_mm: [0.0, 0.0, -pixel_size[1]],      // -Z → down (superior to inferior)
            dim_px,
            interp: InterpolationMethod::Linear,
            border_mode: BorderMode::Transparent,
        }
    }
    
    /// Create an oblique slice with arbitrary orientation
    pub fn oblique(origin: [f32; 3], u: [f32; 3], v: [f32; 3], dim_px: [u32; 2]) -> Self {
        Self {
            origin_mm: origin,
            u_mm: u,
            v_mm: v,
            dim_px,
            interp: InterpolationMethod::Linear,
            border_mode: BorderMode::Transparent,
        }
    }
    
    /// Get the world coordinate for a pixel position
    pub fn pixel_to_world(&self, x: u32, y: u32) -> [f32; 3] {
        [
            self.origin_mm[0] + self.u_mm[0] * x as f32 + self.v_mm[0] * y as f32,
            self.origin_mm[1] + self.u_mm[1] * x as f32 + self.v_mm[1] * y as f32,
            self.origin_mm[2] + self.u_mm[2] * x as f32 + self.v_mm[2] * y as f32,
        ]
    }
    
    /// Check if pixels are square (within tolerance)
    pub fn has_square_pixels(&self, tolerance: f32) -> bool {
        let u_length = (self.u_mm[0].powi(2) + self.u_mm[1].powi(2) + self.u_mm[2].powi(2)).sqrt();
        let v_length = (self.v_mm[0].powi(2) + self.v_mm[1].powi(2) + self.v_mm[2].powi(2)).sqrt();
        (u_length - v_length).abs() < tolerance
    }
    
    /// Get the field of view in world units
    pub fn fov_mm(&self) -> [f32; 2] {
        let u_length = (self.u_mm[0].powi(2) + self.u_mm[1].powi(2) + self.u_mm[2].powi(2)).sqrt();
        let v_length = (self.v_mm[0].powi(2) + self.v_mm[1].powi(2) + self.v_mm[2].powi(2)).sqrt();
        [
            u_length * self.dim_px[0] as f32,
            v_length * self.dim_px[1] as f32,
        ]
    }
}

/// Interpolation method for sampling voxel values
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum InterpolationMethod {
    /// Nearest neighbor - fastest, blocky
    Nearest,
    /// Trilinear interpolation - smooth, standard
    Linear,
    /// Cubic interpolation - smoothest, slowest
    Cubic,
}

impl Default for InterpolationMethod {
    fn default() -> Self {
        Self::Linear
    }
}

/// How to handle sampling outside the volume bounds
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BorderMode {
    /// Return transparent (alpha=0) outside bounds
    Transparent,
    /// Clamp coordinates to volume edge
    Clamp,
    /// Return a constant value
    Constant(u8),
}

impl Default for BorderMode {
    fn default() -> Self {
        Self::Transparent
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_slice_spec_creation() {
        let spec = SliceSpec::axial_at([0.0, 0.0, 0.0], [200.0, 200.0], [512, 512]);
        assert_eq!(spec.dim_px, [512, 512]);
        assert!((spec.origin_mm[2] - 0.0).abs() < 1e-6);
    }
    
    #[test]
    fn test_square_pixels() {
        let spec = SliceSpec::axial_at([0.0, 0.0, 0.0], [200.0, 200.0], [512, 512]);
        assert!(spec.has_square_pixels(1e-6));
        
        // Non-square pixels
        let spec2 = SliceSpec::oblique(
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 2.0, 0.0],  // Different length
            [100, 100]
        );
        assert!(!spec2.has_square_pixels(1e-6));
    }
    
    #[test]
    fn test_pixel_to_world() {
        let spec = SliceSpec::axial_at([0.0, 0.0, 10.0], [100.0, 100.0], [100, 100]);
        
        // Center pixel
        let world = spec.pixel_to_world(50, 50);
        assert!((world[0] - 0.0).abs() < 1e-6);
        assert!((world[1] - 0.0).abs() < 1e-6);
        assert!((world[2] - 10.0).abs() < 1e-6);
        
        // Corner pixel (0,0) = top-left = anterior-right corner
        let corner = spec.pixel_to_world(0, 0);
        assert!((corner[0] - (-50.0)).abs() < 1e-6);
        assert!((corner[1] - 50.0).abs() < 1e-6);  // Now at +50 Y (anterior)
    }
    
    #[test]
    fn test_fov_calculation() {
        let spec = SliceSpec::axial_at([0.0, 0.0, 0.0], [200.0, 200.0], [512, 512]);
        let fov = spec.fov_mm();
        assert!((fov[0] - 200.0).abs() < 1e-6);
        assert!((fov[1] - 200.0).abs() < 1e-6);
    }
    
    #[test]
    fn test_slice_full_extent() {
        // Test that slices show full extent with only slice coordinate from center
        let center = [10.0, 20.0, 30.0];
        let extent = [200.0, 200.0];
        let dims = [256, 256];
        
        // Test axial slice - should show full XY extent at Z=center[2]
        let axial = SliceSpec::axial_at(center, extent, dims);
        let axial_center = axial.pixel_to_world(dims[0] / 2, dims[1] / 2);
        assert!((axial_center[0] - 0.0).abs() < 1e-6, "Axial X should be at origin");
        assert!((axial_center[1] - 0.0).abs() < 1e-6, "Axial Y should be at origin");
        assert!((axial_center[2] - center[2]).abs() < 1e-6, "Axial Z should match center");
        
        // Test sagittal slice - should show full YZ extent at X=center[0]
        let sagittal = SliceSpec::sagittal_at(center, extent, dims);
        let sagittal_center = sagittal.pixel_to_world(dims[0] / 2, dims[1] / 2);
        assert!((sagittal_center[0] - center[0]).abs() < 1e-6, "Sagittal X should match center");
        assert!((sagittal_center[1] - 0.0).abs() < 1e-6, "Sagittal Y should be at origin");
        assert!((sagittal_center[2] - 0.0).abs() < 1e-6, "Sagittal Z should be at origin");
        
        // Test coronal slice - should show full XZ extent at Y=center[1]
        let coronal = SliceSpec::coronal_at(center, extent, dims);
        let coronal_center = coronal.pixel_to_world(dims[0] / 2, dims[1] / 2);
        assert!((coronal_center[0] - 0.0).abs() < 1e-6, "Coronal X should be at origin");
        assert!((coronal_center[1] - center[1]).abs() < 1e-6, "Coronal Y should match center");
        assert!((coronal_center[2] - 0.0).abs() < 1e-6, "Coronal Z should be at origin");
    }
}