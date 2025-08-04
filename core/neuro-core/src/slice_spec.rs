//! Slice specification types
//!
//! Defines how to extract a 2D slice from a 3D volume with arbitrary orientation

use serde::{Deserialize, Serialize};

/// Specification for extracting a 2D slice from 3D volumes
///
/// The slice is defined by an origin point and two basis vectors (u, v) that
/// define the slice plane. Each vector specifies the world-space distance
/// per pixel in that direction, guaranteeing square pixels when |u| = |v|.
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
    /// Create an axial slice at the given Z coordinate
    pub fn axial_at(z: f32, extent_mm: [f32; 2], dim_px: [u32; 2]) -> Self {
        let pixel_size = [
            extent_mm[0] / dim_px[0] as f32,
            extent_mm[1] / dim_px[1] as f32,
        ];

        Self {
            origin_mm: [-extent_mm[0] / 2.0, -extent_mm[1] / 2.0, z],
            u_mm: [pixel_size[0], 0.0, 0.0],
            v_mm: [0.0, pixel_size[1], 0.0],
            dim_px,
            interp: InterpolationMethod::Linear,
            border_mode: BorderMode::Transparent,
        }
    }

    /// Create a sagittal slice at the given X coordinate
    pub fn sagittal_at(x: f32, extent_mm: [f32; 2], dim_px: [u32; 2]) -> Self {
        let pixel_size = [
            extent_mm[0] / dim_px[0] as f32,
            extent_mm[1] / dim_px[1] as f32,
        ];

        Self {
            origin_mm: [x, -extent_mm[0] / 2.0, -extent_mm[1] / 2.0],
            u_mm: [0.0, pixel_size[0], 0.0],
            v_mm: [0.0, 0.0, pixel_size[1]],
            dim_px,
            interp: InterpolationMethod::Linear,
            border_mode: BorderMode::Transparent,
        }
    }

    /// Create a coronal slice at the given Y coordinate
    pub fn coronal_at(y: f32, extent_mm: [f32; 2], dim_px: [u32; 2]) -> Self {
        let pixel_size = [
            extent_mm[0] / dim_px[0] as f32,
            extent_mm[1] / dim_px[1] as f32,
        ];

        Self {
            origin_mm: [-extent_mm[0] / 2.0, y, -extent_mm[1] / 2.0],
            u_mm: [pixel_size[0], 0.0, 0.0],
            v_mm: [0.0, 0.0, pixel_size[1]],
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
    use approx::assert_relative_eq;

    #[test]
    fn test_slice_spec_creation() {
        let spec = SliceSpec::axial_at(0.0, [200.0, 200.0], [512, 512]);
        assert_eq!(spec.dim_px, [512, 512]);
        assert_relative_eq!(spec.origin_mm[2], 0.0);
    }

    #[test]
    fn test_square_pixels() {
        let spec = SliceSpec::axial_at(0.0, [200.0, 200.0], [512, 512]);
        assert!(spec.has_square_pixels(1e-6));

        // Non-square pixels
        let spec2 = SliceSpec::oblique(
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 2.0, 0.0], // Different length
            [100, 100],
        );
        assert!(!spec2.has_square_pixels(1e-6));
    }

    #[test]
    fn test_pixel_to_world() {
        let spec = SliceSpec::axial_at(10.0, [100.0, 100.0], [100, 100]);

        // Center pixel
        let world = spec.pixel_to_world(50, 50);
        assert_relative_eq!(world[0], 0.0, epsilon = 1e-6);
        assert_relative_eq!(world[1], 0.0, epsilon = 1e-6);
        assert_relative_eq!(world[2], 10.0, epsilon = 1e-6);

        // Corner pixel
        let corner = spec.pixel_to_world(0, 0);
        assert_relative_eq!(corner[0], -50.0, epsilon = 1e-6);
        assert_relative_eq!(corner[1], -50.0, epsilon = 1e-6);
    }

    #[test]
    fn test_all_orientations() {
        let extent = [200.0, 200.0];
        let dims = [256, 256];

        let axial = SliceSpec::axial_at(0.0, extent, dims);
        assert!(axial.has_square_pixels(1e-6));

        let sagittal = SliceSpec::sagittal_at(0.0, extent, dims);
        assert!(sagittal.has_square_pixels(1e-6));

        let coronal = SliceSpec::coronal_at(0.0, extent, dims);
        assert!(coronal.has_square_pixels(1e-6));
    }
}
