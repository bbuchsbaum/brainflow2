//! Slice builder for guaranteed square pixels
//!
//! Provides a convenient API for creating SliceSpec instances with proper
//! aspect ratio handling and square physical pixels.

use crate::{BorderMode, InterpolationMethod, SliceSpec, Volume};
use nalgebra::{Unit, Vector3};

/// Builder for creating slice specifications with guaranteed square pixels
#[derive(Debug, Clone)]
pub struct SliceBuilder {
    // Required parameters
    center_mm: Vector3<f32>,
    normal: Vector3<f32>,
    up_hint: Vector3<f32>,

    // Optional parameters with defaults
    extent_mm: [f32; 2],
    max_px: u32,
    interp: InterpolationMethod,
    pixel_strategy: PixelStrategy,
}

/// Strategy for determining pixel size
#[derive(Debug, Clone, Copy)]
pub enum PixelStrategy {
    /// Use the smallest voxel spacing among all volumes (highest quality)
    MinLayerVox,
    /// Use the largest voxel spacing among all volumes (best performance)
    MaxLayerVox,
    /// Optimize for screen display
    ScreenOptimal,
    /// Explicitly set the pixel size in mm
    Explicit(f32),
}

impl Default for PixelStrategy {
    fn default() -> Self {
        Self::ScreenOptimal
    }
}

impl SliceBuilder {
    /// Create a new slice builder with the given center, normal, and up direction
    pub fn new(center_mm: [f32; 3], normal: [f32; 3], up_hint: [f32; 3]) -> Self {
        Self {
            center_mm: center_mm.into(),
            normal: normal.into(),
            up_hint: up_hint.into(),
            extent_mm: [200.0, 200.0],
            max_px: 512,
            interp: InterpolationMethod::Linear,
            pixel_strategy: PixelStrategy::ScreenOptimal,
        }
    }

    /// Create a builder for an axial slice (Z plane)
    pub fn axial(center: [f32; 3]) -> Self {
        Self::new(center, [0.0, 0.0, 1.0], [0.0, 1.0, 0.0])
    }

    /// Create a builder for a sagittal slice (X plane)
    pub fn sagittal(center: [f32; 3]) -> Self {
        Self::new(center, [1.0, 0.0, 0.0], [0.0, 0.0, 1.0])
    }

    /// Create a builder for a coronal slice (Y plane)
    pub fn coronal(center: [f32; 3]) -> Self {
        Self::new(center, [0.0, 1.0, 0.0], [0.0, 0.0, 1.0])
    }

    /// Set the physical extent of the slice in mm
    pub fn extent_mm(mut self, width: f32, height: f32) -> Self {
        self.extent_mm = [width, height];
        self
    }

    /// Set the maximum pixel dimension
    pub fn max_px(mut self, max_px: u32) -> Self {
        self.max_px = max_px;
        self
    }

    /// Set the interpolation method
    pub fn interp(mut self, interp: InterpolationMethod) -> Self {
        self.interp = interp;
        self
    }

    /// Set the pixel size strategy
    pub fn pixel_strategy(mut self, strategy: PixelStrategy) -> Self {
        self.pixel_strategy = strategy;
        self
    }

    /// Build the slice specification
    pub fn build(self) -> SliceSpec {
        self.build_with_volumes(&[])
    }

    /// Build the slice specification considering volume properties
    pub fn build_with_volumes(self, volumes: &[&dyn Volume]) -> SliceSpec {
        // Calculate pixel size based on strategy
        let pix_size_mm = match self.pixel_strategy {
            PixelStrategy::MinLayerVox => volumes
                .iter()
                .map(|v| {
                    let spacing = v.spacing();
                    spacing[0].min(spacing[1]).min(spacing[2])
                })
                .fold(f32::INFINITY, f32::min)
                .min(self.calculate_screen_optimal_size()),
            PixelStrategy::MaxLayerVox => volumes
                .iter()
                .map(|v| {
                    let spacing = v.spacing();
                    spacing[0].max(spacing[1]).max(spacing[2])
                })
                .fold(0.0, f32::max)
                .max(self.calculate_screen_optimal_size()),
            PixelStrategy::ScreenOptimal => self.calculate_screen_optimal_size(),
            PixelStrategy::Explicit(size) => size,
        };

        // Build orthonormal basis (u, v, n)
        let n = Unit::new_normalize(self.normal);

        // Ensure up_hint is not collinear with normal
        let up = if self.up_hint.dot(&n).abs() > 0.99 {
            // up_hint is nearly parallel to normal, choose arbitrary perpendicular
            if n.x.abs() < 0.9 {
                Vector3::x()
            } else {
                Vector3::y()
            }
        } else {
            self.up_hint
        };

        // Create orthonormal basis
        let u = Unit::new_normalize(n.cross(&up));
        let v = Unit::new_normalize(n.cross(&u));

        // Calculate dimensions ensuring square pixels
        let dim_px = [
            (self.extent_mm[0] / pix_size_mm).round() as u32,
            (self.extent_mm[1] / pix_size_mm).round() as u32,
        ];

        // Calculate origin at upper-left corner
        let origin = self.center_mm
            - u.as_ref() * (self.extent_mm[0] * 0.5)
            - v.as_ref() * (self.extent_mm[1] * 0.5);

        SliceSpec {
            origin_mm: origin.into(),
            u_mm: (u.as_ref() * pix_size_mm).into(),
            v_mm: (v.as_ref() * pix_size_mm).into(),
            dim_px,
            interp: self.interp,
            border_mode: BorderMode::Transparent,
        }
    }

    /// Calculate screen-optimal pixel size
    fn calculate_screen_optimal_size(&self) -> f32 {
        // Choose pixel size such that the longest dimension fits within max_px
        f32::max(
            self.extent_mm[0] / self.max_px as f32,
            self.extent_mm[1] / self.max_px as f32,
        )
    }
}

/// Helper function to get suggested pixel size for a set of volumes
pub fn suggested_pixel_size(volumes: &[&dyn Volume], strategy: PixelStrategy) -> f32 {
    match strategy {
        PixelStrategy::MinLayerVox => volumes
            .iter()
            .map(|v| {
                let spacing = v.spacing();
                spacing[0].min(spacing[1]).min(spacing[2])
            })
            .fold(f32::INFINITY, f32::min),
        PixelStrategy::MaxLayerVox => volumes
            .iter()
            .map(|v| {
                let spacing = v.spacing();
                spacing[0].max(spacing[1]).max(spacing[2])
            })
            .fold(0.0, f32::max),
        PixelStrategy::ScreenOptimal => {
            // Default to 0.5mm for screen display
            0.5
        }
        PixelStrategy::Explicit(size) => size,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::TestVolume;
    use approx::assert_relative_eq;

    #[test]
    fn test_slice_builder_square_pixels() {
        let spec = SliceBuilder::axial([0.0, 0.0, 0.0])
            .extent_mm(180.0, 220.0) // Non-square physical area
            .max_px(512)
            .build();

        // Check that pixels are square
        let u_len = (spec.u_mm[0].powi(2) + spec.u_mm[1].powi(2) + spec.u_mm[2].powi(2)).sqrt();
        let v_len = (spec.v_mm[0].powi(2) + spec.v_mm[1].powi(2) + spec.v_mm[2].powi(2)).sqrt();

        assert_relative_eq!(u_len, v_len, epsilon = 1e-6);
    }

    #[test]
    fn test_standard_orientations() {
        let center = [10.0, 20.0, 30.0];

        // Axial
        let axial = SliceBuilder::axial(center).build();
        assert_relative_eq!(axial.origin_mm[2], center[2], epsilon = 1e-6);

        // Sagittal
        let sagittal = SliceBuilder::sagittal(center).build();
        assert_relative_eq!(sagittal.origin_mm[0], center[0], epsilon = 1e-6);

        // Coronal
        let coronal = SliceBuilder::coronal(center).build();
        assert_relative_eq!(coronal.origin_mm[1], center[1], epsilon = 1e-6);
    }

    #[test]
    fn test_pixel_strategies() {
        let vol1 = TestVolume::new([10, 10, 10], [1.0, 1.0, 1.0], [0.0, 0.0, 0.0]);
        let vol2 = TestVolume::new([20, 20, 20], [2.0, 2.0, 2.0], [0.0, 0.0, 0.0]);
        let volumes: Vec<&dyn Volume> = vec![&vol1, &vol2];

        // MinLayerVox should use 1.0mm
        let spec_min = SliceBuilder::axial([0.0, 0.0, 0.0])
            .pixel_strategy(PixelStrategy::MinLayerVox)
            .extent_mm(100.0, 100.0)
            .build_with_volumes(&volumes);

        let pixel_size_min =
            (spec_min.u_mm[0].powi(2) + spec_min.u_mm[1].powi(2) + spec_min.u_mm[2].powi(2)).sqrt();
        assert!(pixel_size_min <= 1.0 + 1e-6);

        // MaxLayerVox should use 2.0mm
        let spec_max = SliceBuilder::axial([0.0, 0.0, 0.0])
            .pixel_strategy(PixelStrategy::MaxLayerVox)
            .extent_mm(100.0, 100.0)
            .build_with_volumes(&volumes);

        let pixel_size_max =
            (spec_max.u_mm[0].powi(2) + spec_max.u_mm[1].powi(2) + spec_max.u_mm[2].powi(2)).sqrt();
        assert!(pixel_size_max >= 2.0 - 1e-6);
    }

    #[test]
    fn test_explicit_pixel_size() {
        let spec = SliceBuilder::axial([0.0, 0.0, 0.0])
            .pixel_strategy(PixelStrategy::Explicit(0.75))
            .extent_mm(150.0, 150.0)
            .build();

        let pixel_size =
            (spec.u_mm[0].powi(2) + spec.u_mm[1].powi(2) + spec.u_mm[2].powi(2)).sqrt();
        assert_relative_eq!(pixel_size, 0.75, epsilon = 1e-6);

        // Check dimensions
        assert_eq!(spec.dim_px[0], 200); // 150 / 0.75
        assert_eq!(spec.dim_px[1], 200);
    }

    #[test]
    fn test_oblique_slice() {
        // 45-degree oblique slice
        let normal = [1.0 / 2.0f32.sqrt(), 0.0, 1.0 / 2.0f32.sqrt()];
        let up = [0.0, 1.0, 0.0];

        let spec = SliceBuilder::new([0.0, 0.0, 0.0], normal, up)
            .extent_mm(100.0, 100.0)
            .build();

        // Should still have square pixels
        let u_len = (spec.u_mm[0].powi(2) + spec.u_mm[1].powi(2) + spec.u_mm[2].powi(2)).sqrt();
        let v_len = (spec.v_mm[0].powi(2) + spec.v_mm[1].powi(2) + spec.v_mm[2].powi(2)).sqrt();

        assert_relative_eq!(u_len, v_len, epsilon = 1e-6);
    }

    #[test]
    fn test_collinear_up_hint() {
        // When up_hint is parallel to normal, should still work
        let spec = SliceBuilder::new(
            [0.0, 0.0, 0.0],
            [0.0, 0.0, 1.0], // normal
            [0.0, 0.0, 1.0], // up_hint parallel to normal
        )
        .build();

        // Should create valid orthonormal basis
        assert!(spec.has_square_pixels(1e-6));
    }
}
