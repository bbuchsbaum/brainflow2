//! Unified view rectangle specification for CPU and GPU renderers
//!
//! This module provides a renderer-agnostic description of a 2D viewing rectangle
//! in world space, ensuring both CPU and GPU renderers show exactly the same region.

use crate::{BorderMode, InterpolationMethod, SliceSpec};
use serde::{Deserialize, Serialize};

/// Axis in 3D space
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Axis {
    X,
    Y,
    Z,
}

impl Axis {
    /// Get unit vector for this axis
    pub fn unit(&self) -> [f32; 3] {
        match self {
            Axis::X => [1.0, 0.0, 0.0],
            Axis::Y => [0.0, 1.0, 0.0],
            Axis::Z => [0.0, 0.0, 1.0],
        }
    }
}

/// Display convention for neuroimaging
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Handedness {
    /// Neurological convention: patient-right on screen-right (anterior on left for sagittal)
    Neurological,
    /// Radiological convention: patient-right on screen-left (anterior on right for sagittal)
    Radiological,
}

/// A complete, orientation-agnostic description of one 2D slice
#[derive(Debug, Clone, PartialEq)]
pub struct SliceGeometry {
    /// World-space anchor (pixel 0,0)
    pub origin_mm: [f32; 3],
    /// World-space step for one pixel to the right
    pub u_mm: [f32; 3],
    /// World-space step for one pixel down
    pub v_mm: [f32; 3],
    /// Width × height of the raster
    pub dim_px: [u32; 2],
}

impl SliceGeometry {
    /// Build an orthogonal slice that **really** goes through `cross_mm`
    /// and covers the whole FoV of `meta` while preserving square pixels.
    ///
    /// This implementation derives orientation from the voxel_to_world matrix
    /// to handle any volume orientation robustly.
    pub fn full_extent(
        orient: ViewOrientation,
        cross_mm: [f32; 3],
        meta: &VolumeMetadata,
        screen_px_max: [u32; 2],
        handedness: Handedness,
    ) -> Self {
        // 1. Extract orthonormal unit vectors from voxel_to_world matrix
        let (e_x, e_y, e_z) = extract_orthonormal_vectors(&meta.voxel_to_world, handedness);

        // 2. Choose right and down vectors based on orientation
        // For neurological convention with LPI coordinates:
        // - Axial: looking from superior, anterior at top, so down = -Y (posterior)
        // - Coronal: looking from anterior, superior at top, so down = -Z (inferior)
        // - Sagittal: looking from left, superior at top, anterior at left
        let (right_mm, down_mm) = match orient {
            ViewOrientation::Axial => (e_x, negate_vec3(e_y)), // X right, -Y down (anterior->posterior)
            ViewOrientation::Coronal => (e_x, negate_vec3(e_z)), // X right, -Z down (superior->inferior)
            ViewOrientation::Sagittal => (negate_vec3(e_y), negate_vec3(e_z)), // -Y right (anterior->posterior), -Z down
        };

        // 3. Project all volume corners into the active in-plane basis (right/down),
        // relative to crosshair. This is robust for oblique and flipped affines.
        let corners = meta.volume_corners_world();
        let r_dot_r = vec3_dot(right_mm, right_mm);
        let d_dot_d = vec3_dot(down_mm, down_mm);
        let r_dot_d = vec3_dot(right_mm, down_mm);
        let det = r_dot_r * d_dot_d - r_dot_d * r_dot_d;

        // Degenerate basis should never happen for valid orthogonal views, but guard anyway.
        let det = if det.abs() < 1e-8 { 1.0 } else { det };

        let mut u_min = f32::INFINITY;
        let mut u_max = f32::NEG_INFINITY;
        let mut v_min = f32::INFINITY;
        let mut v_max = f32::NEG_INFINITY;

        for corner in &corners {
            let delta = vec3_sub(*corner, cross_mm);
            let r_dot_delta = vec3_dot(right_mm, delta);
            let d_dot_delta = vec3_dot(down_mm, delta);

            // Least-squares coefficients in possibly non-orthogonal basis:
            // delta ≈ u*right + v*down
            let u = (r_dot_delta * d_dot_d - d_dot_delta * r_dot_d) / det;
            let v = (d_dot_delta * r_dot_r - r_dot_delta * r_dot_d) / det;

            u_min = u_min.min(u);
            u_max = u_max.max(u);
            v_min = v_min.min(v);
            v_max = v_max.max(v);
        }

        // 4. Compute in-plane extents (mm)
        let width_mm = (u_max - u_min).max(0.0);
        let height_mm = (v_max - v_min).max(0.0);

        // 5. Choose isotropic pixel size (square pixels)
        let req_w = screen_px_max[0].max(1) as f32;
        let req_h = screen_px_max[1].max(1) as f32;
        let pixel_size = (width_mm / req_w).max(height_mm / req_h).max(1e-6);

        let dim_px = [
            (width_mm / pixel_size).ceil().max(1.0) as u32,
            (height_mm / pixel_size).ceil().max(1.0) as u32,
        ];

        // 6. Top-left origin in world coordinates (u_min, v_min in the slice basis).
        let origin_mm = vec3_add(
            cross_mm,
            vec3_add(vec3_scale(right_mm, u_min), vec3_scale(down_mm, v_min)),
        );

        SliceGeometry {
            origin_mm,
            u_mm: vec3_scale(right_mm, pixel_size),
            v_mm: vec3_scale(down_mm, pixel_size),
            dim_px,
        }
    }
}

/// Extract orthonormal unit vectors from voxel_to_world matrix
///
/// This function extracts the orientation of each axis from the affine transformation
/// and applies display conventions (neurological vs radiological).
fn extract_orthonormal_vectors(
    voxel_to_world: &nalgebra::Matrix4<f32>,
    handedness: Handedness,
) -> ([f32; 3], [f32; 3], [f32; 3]) {
    // Extract the 3x3 rotation/scaling part of the matrix
    let mat = voxel_to_world.fixed_view::<3, 3>(0, 0);

    // Extract and normalize the column vectors
    let col_x = mat.column(0);
    let col_y = mat.column(1);
    let col_z = mat.column(2);

    let norm_x = col_x.norm();
    let norm_y = col_y.norm();
    let norm_z = col_z.norm();

    // Create normalized unit vectors
    let mut e_x = [col_x[0] / norm_x, col_x[1] / norm_x, col_x[2] / norm_x];
    let e_y = [col_y[0] / norm_y, col_y[1] / norm_y, col_y[2] / norm_y];
    let e_z = [col_z[0] / norm_z, col_z[1] / norm_z, col_z[2] / norm_z];

    // Apply display conventions
    match handedness {
        Handedness::Neurological => {
            // Neurological: left=left, superior=up, anterior=front
            // Standard RAS orientation: +X=right, +Y=anterior, +Z=superior
            // For display: right=right, down=inferior, anterior=left (for sagittal)
            // Don't apply global Z negation - handle per-orientation instead
        }
        Handedness::Radiological => {
            // Radiological: left=right, superior=up, anterior=front
            // Flip X for "patient left on image right" convention
            e_x = negate_vec3(e_x);
            // Don't apply global Z negation - handle per-orientation instead
        }
    }

    (e_x, e_y, e_z)
}

// Helper functions for vector operations
fn vec3_dot(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn vec3_sub(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn vec3_add(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

fn vec3_scale(v: [f32; 3], s: f32) -> [f32; 3] {
    [v[0] * s, v[1] * s, v[2] * s]
}

fn negate_vec3(v: [f32; 3]) -> [f32; 3] {
    [-v[0], -v[1], -v[2]]
}

#[cfg(test)]
fn vec3_distance(a: [f32; 3], b: [f32; 3]) -> f32 {
    let diff = vec3_sub(a, b);
    (diff[0] * diff[0] + diff[1] * diff[1] + diff[2] * diff[2]).sqrt()
}

/// A renderer-agnostic description of a 2D viewing rectangle in world space
///
/// This type ensures both CPU and GPU renderers show exactly the same region
/// by providing a single source of truth for view calculations.
///
/// # Coordinate System Contract
///
/// This struct defines the critical contract between backend view calculations and frontend rendering:
///
/// - `origin_mm`: World coordinates of the top-left pixel center
/// - `u_mm`: Per-pixel world displacement vector for moving right (X direction)
/// - `v_mm`: Per-pixel world displacement vector for moving down (Y direction)  
/// - `width_px`/`height_px`: Actual pixel dimensions (may differ from requested)
///
/// # Important Notes for Frontend Integration
///
/// - The u_mm and v_mm vectors are already scaled to pixel size by `vec3_scale(direction, pixel_size)`
/// - Frontend should use these vectors directly without further scaling
/// - Dimensions may differ from requested to preserve square pixels and aspect ratios
/// - This dimension adjustment is intentional behavior, not an error condition
/// - Square pixels are essential in medical imaging to preserve anatomical proportions
///
/// # Dimension Preservation Strategy
///
/// The `full_extent` method prioritizes anatomical accuracy over exact dimension matching:
/// 1. Calculate required pixel size for square pixels: `max(width_mm/req_width, height_mm/req_height)`
/// 2. Use this pixel size to determine actual dimensions that fit the anatomical extent
/// 3. The resulting dimensions ensure square pixels and complete anatomical coverage
///
/// For a typical MNI brain (193×229×193 voxels):
/// - Anatomical extent might be ~193mm × ~229mm  
/// - Requested 512×512 would create different pixel sizes for X/Y
/// - Actual 432×512 ensures square pixels and complete brain coverage
///
/// This is medical imaging best practice - square pixels preserve anatomical proportions.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ViewRectMm {
    /// Upper-left pixel center in world coordinates (mm)
    pub origin_mm: [f32; 3],

    /// World-space vector for one pixel to the right (mm)
    /// NOTE: Already scaled by pixel_size - do not scale further in frontend
    pub u_mm: [f32; 3],

    /// World-space vector for one pixel downward (mm)
    /// NOTE: Already scaled by pixel_size - do not scale further in frontend
    pub v_mm: [f32; 3],

    /// Width in pixels (may differ from requested for square pixel preservation)
    pub width_px: u32,

    /// Height in pixels (may differ from requested for square pixel preservation)
    pub height_px: u32,
}

/// Orientation of the viewing plane
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ViewOrientation {
    /// Axial (XY plane, looking down Z axis)
    Axial,
    /// Coronal (XZ plane, looking down Y axis)
    Coronal,
    /// Sagittal (YZ plane, looking down X axis)
    Sagittal,
}

/// Metadata about a volume needed for view calculations
pub struct VolumeMetadata {
    /// Volume dimensions in voxels
    pub dimensions: [usize; 3],
    /// Voxel-to-world transformation matrix
    pub voxel_to_world: nalgebra::Matrix4<f32>,
}

impl VolumeMetadata {
    /// Get all 8 corners of the volume in world coordinates
    pub fn volume_corners_world(&self) -> [[f32; 3]; 8] {
        // Define the 8 corners in voxel space
        let corners_voxel = [
            [0.0, 0.0, 0.0],
            [self.dimensions[0] as f32 - 1.0, 0.0, 0.0],
            [0.0, self.dimensions[1] as f32 - 1.0, 0.0],
            [
                self.dimensions[0] as f32 - 1.0,
                self.dimensions[1] as f32 - 1.0,
                0.0,
            ],
            [0.0, 0.0, self.dimensions[2] as f32 - 1.0],
            [
                self.dimensions[0] as f32 - 1.0,
                0.0,
                self.dimensions[2] as f32 - 1.0,
            ],
            [
                0.0,
                self.dimensions[1] as f32 - 1.0,
                self.dimensions[2] as f32 - 1.0,
            ],
            [
                self.dimensions[0] as f32 - 1.0,
                self.dimensions[1] as f32 - 1.0,
                self.dimensions[2] as f32 - 1.0,
            ],
        ];

        // Transform each corner to world space
        let mut corners_world = [[0.0; 3]; 8];
        for (i, voxel_corner) in corners_voxel.iter().enumerate() {
            let voxel_point =
                nalgebra::Point4::new(voxel_corner[0], voxel_corner[1], voxel_corner[2], 1.0);
            let world_point = self.voxel_to_world * voxel_point;
            corners_world[i] = [
                world_point[0] / world_point[3],
                world_point[1] / world_point[3],
                world_point[2] / world_point[3],
            ];
        }

        corners_world
    }
}

impl ViewRectMm {
    /// Create a view that shows the full extent of a volume for a given orientation
    ///
    /// Uses SliceGeometry for consistent plane calculation that ensures all views
    /// properly intersect at the crosshair position.
    ///
    /// # Dimension Preservation Strategy
    ///
    /// This function prioritizes anatomical accuracy over exact dimension matching:
    /// 1. Calculate required pixel size for square pixels: `max(width_mm/req_width, height_mm/req_height)`
    /// 2. Use this pixel size to determine actual dimensions that fit the anatomical extent
    /// 3. The resulting dimensions ensure square pixels and complete anatomical coverage
    ///
    /// # Why Dimensions May Differ
    ///
    /// For a typical MNI brain volume (193×229×193 voxels):
    /// - Anatomical extent might be ~193mm × ~229mm  
    /// - Requested 512×512 would create different pixel sizes for X/Y (non-square pixels)
    /// - Actual 432×512 ensures square pixels and complete brain coverage
    ///
    /// This is medical imaging best practice - square pixels preserve anatomical proportions.
    ///
    /// # Frontend Integration Contract
    ///
    /// The returned `ViewRectMm` contains per-pixel displacement vectors that should be used
    /// directly by the frontend without scaling. Any attempt to scale these vectors will
    /// corrupt the carefully calculated geometric relationships.
    pub fn full_extent(
        volume_meta: &VolumeMetadata,
        orientation: ViewOrientation,
        crosshair_world: [f32; 3],
        screen_px_max: [u32; 2],
    ) -> Self {
        // Use SliceGeometry to compute the view with proper plane algebra
        let geom = SliceGeometry::full_extent(
            orientation,
            crosshair_world,
            volume_meta,
            screen_px_max,
            Handedness::Neurological, // Default to neurological convention
        );

        // Convert SliceGeometry to ViewRectMm
        ViewRectMm::from(&geom)
    }

    /// Convert to GPU frame parameters (origin + u/v vectors in homogeneous coordinates)
    pub fn to_gpu_frame_params(&self) -> ([f32; 4], [f32; 4], [f32; 4]) {
        let origin = [self.origin_mm[0], self.origin_mm[1], self.origin_mm[2], 1.0];
        let u_vec = [
            self.u_mm[0] * self.width_px as f32,
            self.u_mm[1] * self.width_px as f32,
            self.u_mm[2] * self.width_px as f32,
            0.0,
        ];
        let v_vec = [
            self.v_mm[0] * self.height_px as f32,
            self.v_mm[1] * self.height_px as f32,
            self.v_mm[2] * self.height_px as f32,
            0.0,
        ];
        (origin, u_vec, v_vec)
    }
}

impl From<&ViewRectMm> for SliceSpec {
    fn from(view_rect: &ViewRectMm) -> Self {
        Self {
            origin_mm: view_rect.origin_mm,
            u_mm: view_rect.u_mm,
            v_mm: view_rect.v_mm,
            dim_px: [view_rect.width_px, view_rect.height_px],
            interp: InterpolationMethod::Linear,
            border_mode: BorderMode::Transparent,
        }
    }
}

impl From<&SliceGeometry> for ViewRectMm {
    fn from(geom: &SliceGeometry) -> Self {
        Self {
            origin_mm: geom.origin_mm,
            u_mm: geom.u_mm,
            v_mm: geom.v_mm,
            width_px: geom.dim_px[0],
            height_px: geom.dim_px[1],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nalgebra::Matrix4;

    #[test]
    fn test_crosshair_consistency() {
        // Test that all views properly intersect at the crosshair position
        let meta = VolumeMetadata {
            dimensions: [193, 229, 193], // MNI brain dimensions
            voxel_to_world: Matrix4::identity(),
        };

        let crosshair = [96.5, 114.5, 96.5]; // Center of volume
        let screen_max = [256, 256];

        // Create all three views
        let axial = ViewRectMm::full_extent(&meta, ViewOrientation::Axial, crosshair, screen_max);
        let sagittal =
            ViewRectMm::full_extent(&meta, ViewOrientation::Sagittal, crosshair, screen_max);
        let coronal =
            ViewRectMm::full_extent(&meta, ViewOrientation::Coronal, crosshair, screen_max);

        // Test that each view passes through the crosshair at its center
        let axial_center = [
            axial.origin_mm[0]
                + axial.u_mm[0] * (axial.width_px as f32 / 2.0)
                + axial.v_mm[0] * (axial.height_px as f32 / 2.0),
            axial.origin_mm[1]
                + axial.u_mm[1] * (axial.width_px as f32 / 2.0)
                + axial.v_mm[1] * (axial.height_px as f32 / 2.0),
            axial.origin_mm[2]
                + axial.u_mm[2] * (axial.width_px as f32 / 2.0)
                + axial.v_mm[2] * (axial.height_px as f32 / 2.0),
        ];

        let sagittal_center = [
            sagittal.origin_mm[0]
                + sagittal.u_mm[0] * (sagittal.width_px as f32 / 2.0)
                + sagittal.v_mm[0] * (sagittal.height_px as f32 / 2.0),
            sagittal.origin_mm[1]
                + sagittal.u_mm[1] * (sagittal.width_px as f32 / 2.0)
                + sagittal.v_mm[1] * (sagittal.height_px as f32 / 2.0),
            sagittal.origin_mm[2]
                + sagittal.u_mm[2] * (sagittal.width_px as f32 / 2.0)
                + sagittal.v_mm[2] * (sagittal.height_px as f32 / 2.0),
        ];

        let coronal_center = [
            coronal.origin_mm[0]
                + coronal.u_mm[0] * (coronal.width_px as f32 / 2.0)
                + coronal.v_mm[0] * (coronal.height_px as f32 / 2.0),
            coronal.origin_mm[1]
                + coronal.u_mm[1] * (coronal.width_px as f32 / 2.0)
                + coronal.v_mm[1] * (coronal.height_px as f32 / 2.0),
            coronal.origin_mm[2]
                + coronal.u_mm[2] * (coronal.width_px as f32 / 2.0)
                + coronal.v_mm[2] * (coronal.height_px as f32 / 2.0),
        ];

        // Check that axial slice is at correct Z
        assert!(
            (axial_center[2] - crosshair[2]).abs() < 0.1,
            "Axial Z mismatch: {} vs {}",
            axial_center[2],
            crosshair[2]
        );

        // Check that sagittal slice is at correct X
        assert!(
            (sagittal_center[0] - crosshair[0]).abs() < 0.1,
            "Sagittal X mismatch: {} vs {}",
            sagittal_center[0],
            crosshair[0]
        );

        // Check that coronal slice is at correct Y
        assert!(
            (coronal_center[1] - crosshair[1]).abs() < 0.1,
            "Coronal Y mismatch: {} vs {}",
            coronal_center[1],
            crosshair[1]
        );
    }

    #[test]
    fn test_handedness_conventions() {
        // Test both neurological and radiological conventions
        let meta = VolumeMetadata {
            dimensions: [100, 100, 100],
            voxel_to_world: Matrix4::identity(),
        };

        let crosshair = [50.0, 50.0, 50.0];
        let screen_max = [256, 256];

        // Test neurological convention (default)
        let neuro_axial = SliceGeometry::full_extent(
            ViewOrientation::Axial,
            crosshair,
            &meta,
            screen_max,
            Handedness::Neurological,
        );

        let neuro_sagittal = SliceGeometry::full_extent(
            ViewOrientation::Sagittal,
            crosshair,
            &meta,
            screen_max,
            Handedness::Neurological,
        );

        // For neurological convention:
        // - Axial: patient right on screen right (positive X)
        // - Sagittal: anterior on screen left (negative Y for u_mm)
        assert!(
            neuro_axial.u_mm[0] > 0.0,
            "Neurological axial should have positive X"
        );
        assert!(
            neuro_sagittal.u_mm[1] < 0.0,
            "Neurological sagittal should have negative Y (anterior left)"
        );

        // Test radiological convention
        let radio_axial = SliceGeometry::full_extent(
            ViewOrientation::Axial,
            crosshair,
            &meta,
            screen_max,
            Handedness::Radiological,
        );

        let radio_sagittal = SliceGeometry::full_extent(
            ViewOrientation::Sagittal,
            crosshair,
            &meta,
            screen_max,
            Handedness::Radiological,
        );

        // For radiological convention:
        // - Axial: patient right on screen left (negative X)
        // - Sagittal: anterior on screen right (positive Y for u_mm)
        assert!(
            radio_axial.u_mm[0] < 0.0,
            "Radiological axial should have negative X"
        );
        assert!(
            radio_sagittal.u_mm[1] > 0.0,
            "Radiological sagittal should have positive Y (anterior right)"
        );
    }

    #[test]
    fn test_non_square_dimensions() {
        // Test with MNI brain dimensions which are non-square
        let meta = VolumeMetadata {
            dimensions: [193, 229, 193],
            voxel_to_world: Matrix4::identity(),
        };

        let view = ViewRectMm::full_extent(
            &meta,
            ViewOrientation::Axial,
            [96.0, 114.0, 96.0],
            [256, 256],
        );

        // Verify dimensions are calculated correctly
        // The view should show the full extent of the volume
        assert!(view.width_px > 0 && view.width_px <= 256);
        assert!(view.height_px > 0 && view.height_px <= 256);

        // For axial view showing XY plane:
        // Width should be ~193 pixels (X dimension)
        // Height should be ~229 pixels (Y dimension)
        // But scaled to fit within 256x256
        let aspect_ratio = view.width_px as f32 / view.height_px as f32;
        let expected_ratio = 193.0 / 229.0;
        assert!(
            (aspect_ratio - expected_ratio).abs() < 0.01,
            "Aspect ratio mismatch: {} vs {}",
            aspect_ratio,
            expected_ratio
        );
    }

    #[test]
    fn test_view_orientation_axes() {
        // Test that each orientation uses the correct axes
        let meta = VolumeMetadata {
            dimensions: [100, 100, 100],
            voxel_to_world: Matrix4::identity(),
        };

        let crosshair = [50.0, 50.0, 50.0];
        let screen_max = [256, 256];

        // Axial view (XY plane)
        let axial = ViewRectMm::full_extent(&meta, ViewOrientation::Axial, crosshair, screen_max);
        assert!(
            axial.u_mm[0] != 0.0 && axial.u_mm[1] == 0.0 && axial.u_mm[2] == 0.0,
            "Axial u should be along X"
        );
        assert!(
            axial.v_mm[0] == 0.0 && axial.v_mm[1] != 0.0 && axial.v_mm[2] == 0.0,
            "Axial v should be along Y"
        );

        // Sagittal view (YZ plane)
        let sagittal =
            ViewRectMm::full_extent(&meta, ViewOrientation::Sagittal, crosshair, screen_max);
        assert!(
            sagittal.u_mm[0] == 0.0 && sagittal.u_mm[1] != 0.0 && sagittal.u_mm[2] == 0.0,
            "Sagittal u should be along Y"
        );
        assert!(
            sagittal.v_mm[0] == 0.0 && sagittal.v_mm[1] == 0.0 && sagittal.v_mm[2] != 0.0,
            "Sagittal v should be along Z"
        );

        // Coronal view (XZ plane)
        let coronal =
            ViewRectMm::full_extent(&meta, ViewOrientation::Coronal, crosshair, screen_max);
        assert!(
            coronal.u_mm[0] != 0.0 && coronal.u_mm[1] == 0.0 && coronal.u_mm[2] == 0.0,
            "Coronal u should be along X"
        );
        assert!(
            coronal.v_mm[0] == 0.0 && coronal.v_mm[1] == 0.0 && coronal.v_mm[2] != 0.0,
            "Coronal v should be along Z"
        );
    }

    #[test]
    fn test_sagittal_flip_handedness() {
        // Test that sagittal handedness affects anterior-posterior direction
        let meta = VolumeMetadata {
            dimensions: [100, 100, 100],
            voxel_to_world: Matrix4::identity(),
        };

        let crosshair = [50.0, 50.0, 50.0];
        let screen_max = [256, 256];

        // Neurological: anterior should be on the left (negative Y direction)
        let neuro_sagittal = SliceGeometry::full_extent(
            ViewOrientation::Sagittal,
            crosshair,
            &meta,
            screen_max,
            Handedness::Neurological,
        );

        // Radiological: anterior should be on the right (positive Y direction)
        let radio_sagittal = SliceGeometry::full_extent(
            ViewOrientation::Sagittal,
            crosshair,
            &meta,
            screen_max,
            Handedness::Radiological,
        );

        // Check that the Y components of u_mm have opposite signs
        assert!(
            neuro_sagittal.u_mm[1] * radio_sagittal.u_mm[1] < 0.0,
            "Neurological and radiological sagittal should have opposite Y directions"
        );

        // Specifically check the expected signs for standard RAS coordinates
        assert!(
            neuro_sagittal.u_mm[1] < 0.0,
            "Neurological sagittal should have negative Y (anterior left)"
        );
        assert!(
            radio_sagittal.u_mm[1] > 0.0,
            "Radiological sagittal should have positive Y (anterior right)"
        );
    }

    #[test]
    fn test_crosshair_consistency_robust() {
        // Test that the three slices intersect at the same world coordinate
        // This is a one-line assert when using proper orthonormal vectors
        let meta = VolumeMetadata {
            dimensions: [193, 229, 193], // MNI brain dimensions
            voxel_to_world: Matrix4::identity(),
        };

        let crosshair = [96.0, 114.0, 96.0];
        let screen_max = [256, 256];

        // Create slice geometries for all three orientations
        let axial_geom = SliceGeometry::full_extent(
            ViewOrientation::Axial,
            crosshair,
            &meta,
            screen_max,
            Handedness::Neurological,
        );

        let sagittal_geom = SliceGeometry::full_extent(
            ViewOrientation::Sagittal,
            crosshair,
            &meta,
            screen_max,
            Handedness::Neurological,
        );

        let coronal_geom = SliceGeometry::full_extent(
            ViewOrientation::Coronal,
            crosshair,
            &meta,
            screen_max,
            Handedness::Neurological,
        );

        // Calculate center pixel world coordinates for each slice
        let axial_center = vec3_add(
            vec3_add(
                axial_geom.origin_mm,
                vec3_scale(axial_geom.u_mm, axial_geom.dim_px[0] as f32 / 2.0),
            ),
            vec3_scale(axial_geom.v_mm, axial_geom.dim_px[1] as f32 / 2.0),
        );

        let sagittal_center = vec3_add(
            vec3_add(
                sagittal_geom.origin_mm,
                vec3_scale(sagittal_geom.u_mm, sagittal_geom.dim_px[0] as f32 / 2.0),
            ),
            vec3_scale(sagittal_geom.v_mm, sagittal_geom.dim_px[1] as f32 / 2.0),
        );

        let coronal_center = vec3_add(
            vec3_add(
                coronal_geom.origin_mm,
                vec3_scale(coronal_geom.u_mm, coronal_geom.dim_px[0] as f32 / 2.0),
            ),
            vec3_scale(coronal_geom.v_mm, coronal_geom.dim_px[1] as f32 / 2.0),
        );

        // One-line assert: all three slices should intersect at the crosshair
        let tolerance = 0.01;
        assert!(
            vec3_distance(axial_center, crosshair) < tolerance &&
            vec3_distance(sagittal_center, crosshair) < tolerance &&
            vec3_distance(coronal_center, crosshair) < tolerance,
            "All three slices should intersect at crosshair {:?}. Found: axial={:?}, sagittal={:?}, coronal={:?}",
            crosshair, axial_center, sagittal_center, coronal_center
        );
    }

    #[test]
    fn test_axial_extent_with_negative_x_affine() {
        // Regression for Schaefer-like affines where X axis is flipped.
        // With voxel_to_world = diag(-1, +1, +1) + [90, -126, -72], the axial
        // X world range should stay around [+90 .. -91], not drift to -270 range.
        let voxel_to_world = Matrix4::new(
            -1.0, 0.0, 0.0, 90.0, //
            0.0, 1.0, 0.0, -126.0, //
            0.0, 0.0, 1.0, -72.0, //
            0.0, 0.0, 0.0, 1.0,
        );

        let meta = VolumeMetadata {
            dimensions: [182, 218, 182],
            voxel_to_world,
        };

        let crosshair = [-0.5, 44.9, 34.6];
        let screen_max = [512, 512];
        let axial = SliceGeometry::full_extent(
            ViewOrientation::Axial,
            crosshair,
            &meta,
            screen_max,
            Handedness::Neurological,
        );

        // Sample world X at left and right image edges.
        let left_x = axial.origin_mm[0];
        let right_x = axial.origin_mm[0] + axial.u_mm[0] * axial.dim_px[0] as f32;

        let min_x = left_x.min(right_x);
        let max_x = left_x.max(right_x);

        // Expected Schaefer X bounds are approximately [-91, +90].
        assert!(
            min_x >= -92.5 && max_x <= 91.5,
            "Unexpected axial X extent for negative-X affine: left_x={}, right_x={}, range=[{}, {}]",
            left_x,
            right_x,
            min_x,
            max_x
        );
    }

    #[test]
    fn test_coronal_extent_with_negative_x_affine() {
        // Same regression as axial, but for coronal slices.
        // Coronal uses X/Z display axes; the X range must remain [-91, +90].
        let voxel_to_world = Matrix4::new(
            -1.0, 0.0, 0.0, 90.0, //
            0.0, 1.0, 0.0, -126.0, //
            0.0, 0.0, 1.0, -72.0, //
            0.0, 0.0, 0.0, 1.0,
        );

        let meta = VolumeMetadata {
            dimensions: [182, 218, 182],
            voxel_to_world,
        };

        let crosshair = [-0.5, 44.9, 34.6];
        let screen_max = [512, 512];
        let coronal = SliceGeometry::full_extent(
            ViewOrientation::Coronal,
            crosshair,
            &meta,
            screen_max,
            Handedness::Neurological,
        );

        let left_x = coronal.origin_mm[0];
        let right_x = coronal.origin_mm[0] + coronal.u_mm[0] * coronal.dim_px[0] as f32;
        let min_x = left_x.min(right_x);
        let max_x = left_x.max(right_x);

        assert!(
            min_x >= -92.5 && max_x <= 91.5,
            "Unexpected coronal X extent for negative-X affine: left_x={}, right_x={}, range=[{}, {}]",
            left_x,
            right_x,
            min_x,
            max_x
        );
    }

    #[test]
    fn test_oblique_affine_extent_contains_projected_corners() {
        // Rotation-only oblique affine (common in oblique acquisitions).
        let theta_z = 20.0_f32.to_radians();
        let theta_x = -15.0_f32.to_radians();

        let rz = Matrix4::new(
            theta_z.cos(),
            -theta_z.sin(),
            0.0,
            0.0,
            theta_z.sin(),
            theta_z.cos(),
            0.0,
            0.0,
            0.0,
            0.0,
            1.0,
            0.0,
            0.0,
            0.0,
            0.0,
            1.0,
        );

        let rx = Matrix4::new(
            1.0,
            0.0,
            0.0,
            0.0,
            0.0,
            theta_x.cos(),
            -theta_x.sin(),
            0.0,
            0.0,
            theta_x.sin(),
            theta_x.cos(),
            0.0,
            0.0,
            0.0,
            0.0,
            1.0,
        );

        let mut affine = rz * rx;
        affine[(0, 3)] = -90.0;
        affine[(1, 3)] = -126.0;
        affine[(2, 3)] = -72.0;

        let meta = VolumeMetadata {
            dimensions: [96, 112, 88],
            voxel_to_world: affine,
        };

        // Use world-space center as crosshair.
        let center_voxel = [
            (meta.dimensions[0] as f32 - 1.0) / 2.0,
            (meta.dimensions[1] as f32 - 1.0) / 2.0,
            (meta.dimensions[2] as f32 - 1.0) / 2.0,
        ];
        let center_world = meta.voxel_to_world
            * nalgebra::Point4::new(center_voxel[0], center_voxel[1], center_voxel[2], 1.0);
        let crosshair = [center_world[0], center_world[1], center_world[2]];

        let screen = [512, 512];
        let views = [
            SliceGeometry::full_extent(
                ViewOrientation::Axial,
                crosshair,
                &meta,
                screen,
                Handedness::Neurological,
            ),
            SliceGeometry::full_extent(
                ViewOrientation::Sagittal,
                crosshair,
                &meta,
                screen,
                Handedness::Neurological,
            ),
            SliceGeometry::full_extent(
                ViewOrientation::Coronal,
                crosshair,
                &meta,
                screen,
                Handedness::Neurological,
            ),
        ];

        let corners = meta.volume_corners_world();
        let eps = 1e-3;

        for view in views {
            let u = view.u_mm;
            let v = view.v_mm;
            let uu = vec3_dot(u, u);
            let vv = vec3_dot(v, v);
            let uv = vec3_dot(u, v);
            let det = uu * vv - uv * uv;
            assert!(
                det.abs() > 1e-10,
                "Degenerate in-plane basis for oblique test: u={:?} v={:?}",
                u,
                v
            );

            for corner in &corners {
                let delta = vec3_sub(*corner, view.origin_mm);
                let du = vec3_dot(u, delta);
                let dv = vec3_dot(v, delta);
                let x = (du * vv - dv * uv) / det;
                let y = (dv * uu - du * uv) / det;

                assert!(
                    x >= -eps && x <= view.dim_px[0] as f32 + eps,
                    "Projected corner outside X extent: x={} width={} corner={:?} origin={:?}",
                    x,
                    view.dim_px[0],
                    corner,
                    view.origin_mm
                );
                assert!(
                    y >= -eps && y <= view.dim_px[1] as f32 + eps,
                    "Projected corner outside Y extent: y={} height={} corner={:?} origin={:?}",
                    y,
                    view.dim_px[1],
                    corner,
                    view.origin_mm
                );
            }
        }
    }
}
