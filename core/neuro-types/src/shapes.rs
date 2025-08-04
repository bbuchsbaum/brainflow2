//! Geometric shapes for testing coordinate transformations
//!
//! This module provides oriented ellipsoids and other shapes that can be used
//! as ground truth for validating coordinate transformations and resampling.

use crate::{coordinates, Error, Result, Volume};
use nalgebra::{Matrix3, Matrix4, Point3, Rotation3, Unit, Vector3, Vector4};

/// An oriented ellipsoid in world space coordinates
///
/// This structure represents an ellipsoid with arbitrary position, size, and orientation
/// in 3D space. It's primarily used for testing coordinate transformations by providing
/// a known geometric shape that can be rasterized into different volume spaces.
#[repr(C)] // For potential GPU interoperability
#[derive(Debug, Clone)]
pub struct OrientedEllipsoid {
    /// Center in world coordinates (mm)
    pub center: Point3<f64>,

    /// Semi-axes lengths (mm)
    pub radii: Vector3<f64>,

    /// Rotation defining orientation
    pub rotation: Rotation3<f64>,

    /// Precomputed inverse transform matrix for efficiency
    /// This combines rotation^(-1) and scaling by 1/radii
    inverse_transform: Matrix3<f64>,

    /// Intensity value for filled voxels
    pub intensity: f32,
}

impl OrientedEllipsoid {
    /// Create a new oriented ellipsoid
    ///
    /// # Arguments
    /// * `center` - Center position in world coordinates (mm)
    /// * `radii` - Semi-axes lengths in mm, must all be positive
    /// * `rotation` - Rotation matrix defining orientation
    /// * `intensity` - Voxel intensity value
    ///
    /// # Errors
    /// Returns an error if any radius is non-positive
    pub fn new(
        center: Point3<f64>,
        radii: Vector3<f64>,
        rotation: Rotation3<f64>,
        intensity: f32,
    ) -> Result<Self> {
        // Validate that all radii are positive
        if radii.iter().any(|&r| r <= 0.0) {
            return Err(Error::InvalidSliceSpec(
                "Ellipsoid radii must be positive".to_string(),
            ));
        }

        // Check for degenerate radii that might cause numerical issues
        if radii.iter().any(|&r| r < 1e-6) {
            return Err(Error::InvalidSliceSpec(
                "Ellipsoid radii too small, may cause numerical instability".to_string(),
            ));
        }

        // Precompute the inverse transform matrix for efficiency
        // This combines rotation^(-1) and scaling by 1/radii
        let scale_inv =
            Matrix3::from_diagonal(&Vector3::new(1.0 / radii.x, 1.0 / radii.y, 1.0 / radii.z));
        let inverse_transform = scale_inv * rotation.inverse().matrix();

        Ok(Self {
            center,
            radii,
            rotation,
            inverse_transform,
            intensity,
        })
    }

    /// Create a sphere (special case of ellipsoid)
    pub fn sphere(center: Point3<f64>, radius: f64, intensity: f32) -> Result<Self> {
        Self::new(
            center,
            Vector3::new(radius, radius, radius),
            Rotation3::identity(),
            intensity,
        )
    }

    /// Check if a world coordinate is inside the ellipsoid
    ///
    /// Uses the standard ellipsoid equation: (x/a)² + (y/b)² + (z/c)² ≤ 1
    /// after transforming the point to the ellipsoid's local coordinate system
    pub fn contains_point(&self, point_mm: &Point3<f64>) -> bool {
        // Translate to ellipsoid-centered coordinates
        let translated = point_mm - self.center;

        // Apply the precomputed inverse transform
        // This rotates to align with axes and scales by 1/radii
        let local = self.inverse_transform * translated;

        // Check if within unit sphere
        local.norm_squared() <= 1.0
    }

    /// Check if a point is inside with a tolerance
    ///
    /// Useful for handling floating-point precision issues at boundaries
    pub fn contains_point_with_tolerance(&self, point_mm: &Point3<f64>, tolerance: f64) -> bool {
        let translated = point_mm - self.center;
        let local = self.inverse_transform * translated;
        local.norm_squared() <= (1.0 + tolerance)
    }

    /// Batch containment check for multiple points
    ///
    /// Optimized for checking many points at once, useful for SIMD operations
    pub fn contains_points_batch(&self, points: &[Point3<f64>]) -> Vec<bool> {
        points.iter().map(|p| self.contains_point(p)).collect()
    }

    /// Get the world-to-ellipsoid transformation matrix
    ///
    /// This matrix transforms world coordinates to ellipsoid-local coordinates
    /// where the ellipsoid is centered at origin and axis-aligned
    pub fn world_to_ellipsoid_matrix(&self) -> Matrix4<f64> {
        // Create translation to move world origin to ellipsoid center
        let translation = Matrix4::new_translation(&(-self.center.coords));

        // Create rotation to align with ellipsoid axes
        let rotation = self.rotation.inverse().to_homogeneous();

        // Create scaling to normalize by radii
        let scale = Matrix4::from_diagonal(&Vector4::new(
            1.0 / self.radii.x,
            1.0 / self.radii.y,
            1.0 / self.radii.z,
            1.0,
        ));

        // Combine: scale * rotate * translate
        scale * rotation * translation
    }

    /// Get the axis-aligned bounding box in world coordinates
    ///
    /// Returns (min_corner, max_corner) that fully contains the ellipsoid
    pub fn bounding_box(&self) -> (Point3<f64>, Point3<f64>) {
        // The maximum extent along each world axis is found by computing
        // the norm of each column of the rotation matrix scaled by radii
        let transform = self.rotation.matrix() * Matrix3::from_diagonal(&self.radii);

        let mut extents = Vector3::zeros();
        for i in 0..3 {
            let column = transform.column(i);
            extents[i] = column.norm();
        }

        let min_corner = self.center - extents;
        let max_corner = self.center + extents;

        (min_corner, max_corner)
    }

    /// Compute the volume of the ellipsoid in mm³
    pub fn volume_mm3(&self) -> f64 {
        // Volume = (4/3) * π * a * b * c
        (4.0 / 3.0) * std::f64::consts::PI * self.radii.x * self.radii.y * self.radii.z
    }

    /// Get the surface area in mm²
    ///
    /// Uses Knud Thomsen's approximation formula which is accurate to within 1.061%
    pub fn surface_area_mm2(&self) -> f64 {
        let a = self.radii.x;
        let b = self.radii.y;
        let c = self.radii.z;

        let p = 1.6075; // Optimal value for the approximation
        let term1 = (a.powf(p) * b.powf(p) + a.powf(p) * c.powf(p) + b.powf(p) * c.powf(p)) / 3.0;

        4.0 * std::f64::consts::PI * term1.powf(1.0 / p)
    }

    /// Create an ellipsoid from Euler angles
    pub fn from_euler_angles(
        center: Point3<f64>,
        radii: Vector3<f64>,
        roll: f64,
        pitch: f64,
        yaw: f64,
        intensity: f32,
    ) -> Result<Self> {
        let rotation = Rotation3::from_euler_angles(roll, pitch, yaw);
        Self::new(center, radii, rotation, intensity)
    }

    /// Create an ellipsoid from an axis and angle
    pub fn from_axis_angle(
        center: Point3<f64>,
        radii: Vector3<f64>,
        axis: Unit<Vector3<f64>>,
        angle: f64,
        intensity: f32,
    ) -> Result<Self> {
        let rotation = Rotation3::from_axis_angle(&axis, angle);
        Self::new(center, radii, rotation, intensity)
    }
}

/// Rasterization methods for OrientedEllipsoid
impl OrientedEllipsoid {
    /// Basic rasterization into a volume
    ///
    /// This checks the center of each voxel and fills it if inside the ellipsoid.
    /// For ground truth generation, use `rasterize_supersampled` instead.
    pub fn rasterize<V: VolumeRasterizer>(&self, volume: &mut V) -> Result<()> {
        let dims = volume.dimensions();
        let voxel_to_world = volume.voxel_to_world_matrix();

        // Get bounding box in world space
        let (bbox_min, bbox_max) = self.bounding_box();

        // Convert to voxel space to limit iteration
        let world_to_voxel = voxel_to_world
            .try_inverse()
            .ok_or_else(|| Error::TransformError("Singular voxel-to-world matrix".to_string()))?;

        let bbox_min_voxel = coordinates::world_to_voxel(
            Point3::new(bbox_min.x as f32, bbox_min.y as f32, bbox_min.z as f32),
            &world_to_voxel,
        );
        let bbox_max_voxel = coordinates::world_to_voxel(
            Point3::new(bbox_max.x as f32, bbox_max.y as f32, bbox_max.z as f32),
            &world_to_voxel,
        );

        // Clamp to volume bounds
        let min_i = (bbox_min_voxel.x.floor() as isize).max(0) as usize;
        let min_j = (bbox_min_voxel.y.floor() as isize).max(0) as usize;
        let min_k = (bbox_min_voxel.z.floor() as isize).max(0) as usize;

        let max_i = ((bbox_max_voxel.x.ceil() as isize).min(dims[0] as isize - 1) as usize + 1)
            .min(dims[0]);
        let max_j = ((bbox_max_voxel.y.ceil() as isize).min(dims[1] as isize - 1) as usize + 1)
            .min(dims[1]);
        let max_k = ((bbox_max_voxel.z.ceil() as isize).min(dims[2] as isize - 1) as usize + 1)
            .min(dims[2]);

        // Rasterize within bounding box
        for k in min_k..max_k {
            for j in min_j..max_j {
                for i in min_i..max_i {
                    // Get world coordinates of voxel center
                    let voxel_pos = Point3::new(i as f32, j as f32, k as f32);
                    let world_pos = coordinates::voxel_to_world(voxel_pos, &voxel_to_world);
                    let world_pos_f64 =
                        Point3::new(world_pos.x as f64, world_pos.y as f64, world_pos.z as f64);

                    if self.contains_point(&world_pos_f64) {
                        volume.set_at_coords([i, j, k], self.intensity)?;
                    }
                }
            }
        }

        Ok(())
    }

    /// Scanline-optimized rasterization
    ///
    /// Uses incremental computation along scanlines for better performance
    pub fn rasterize_scanline<V: VolumeRasterizer>(&self, volume: &mut V) -> Result<()> {
        let dims = volume.dimensions();
        let voxel_to_world = volume.voxel_to_world_matrix();
        let voxel_to_world_f64 = coordinates::matrix_f32_to_f64(&voxel_to_world);

        // Get bounding box
        let (bbox_min, bbox_max) = self.bounding_box();
        let world_to_voxel = voxel_to_world
            .try_inverse()
            .ok_or_else(|| Error::TransformError("Singular voxel-to-world matrix".to_string()))?;

        let bbox_min_voxel = coordinates::world_to_voxel(
            Point3::new(bbox_min.x as f32, bbox_min.y as f32, bbox_min.z as f32),
            &world_to_voxel,
        );
        let bbox_max_voxel = coordinates::world_to_voxel(
            Point3::new(bbox_max.x as f32, bbox_max.y as f32, bbox_max.z as f32),
            &world_to_voxel,
        );

        // Clamp to volume bounds
        let min_i = (bbox_min_voxel.x.floor() as isize).max(0) as usize;
        let min_j = (bbox_min_voxel.y.floor() as isize).max(0) as usize;
        let min_k = (bbox_min_voxel.z.floor() as isize).max(0) as usize;

        let max_i = ((bbox_max_voxel.x.ceil() as isize).min(dims[0] as isize - 1) as usize + 1)
            .min(dims[0]);
        let max_j = ((bbox_max_voxel.y.ceil() as isize).min(dims[1] as isize - 1) as usize + 1)
            .min(dims[1]);
        let max_k = ((bbox_max_voxel.z.ceil() as isize).min(dims[2] as isize - 1) as usize + 1)
            .min(dims[2]);

        // Extract the x-direction step in world space
        let x_step_world = Vector3::new(
            voxel_to_world_f64[(0, 0)],
            voxel_to_world_f64[(1, 0)],
            voxel_to_world_f64[(2, 0)],
        );

        // Rasterize with scanline optimization
        for k in min_k..max_k {
            for j in min_j..max_j {
                // Compute starting world position for this scanline
                let voxel_start = nalgebra::Vector4::new(min_i as f64, j as f64, k as f64, 1.0);
                let world_start_vec = voxel_to_world_f64 * voxel_start;
                let mut world_pos =
                    Point3::new(world_start_vec.x, world_start_vec.y, world_start_vec.z);

                // Scan along the line
                for i in min_i..max_i {
                    if self.contains_point(&world_pos) {
                        volume.set_at_coords([i, j, k], self.intensity)?;
                    }

                    // Increment position
                    world_pos += x_step_world;
                }
            }
        }

        Ok(())
    }

    /// Supersampled rasterization for high-quality ground truth
    ///
    /// Samples multiple points within each voxel and averages the result.
    /// This provides anti-aliased edges and accurate partial volume effects.
    pub fn rasterize_supersampled<V: VolumeRasterizer>(
        &self,
        volume: &mut V,
        samples_per_dim: u32,
    ) -> Result<()> {
        if samples_per_dim == 0 {
            return Err(Error::InvalidSliceSpec(
                "Samples per dimension must be positive".to_string(),
            ));
        }

        let dims = volume.dimensions();
        let voxel_to_world = volume.voxel_to_world_matrix();
        let voxel_to_world_f64 = coordinates::matrix_f32_to_f64(&voxel_to_world);

        // Get bounding box
        let (bbox_min, bbox_max) = self.bounding_box();
        let world_to_voxel = voxel_to_world
            .try_inverse()
            .ok_or_else(|| Error::TransformError("Singular voxel-to-world matrix".to_string()))?;

        let bbox_min_voxel = coordinates::world_to_voxel(
            Point3::new(bbox_min.x as f32, bbox_min.y as f32, bbox_min.z as f32),
            &world_to_voxel,
        );
        let bbox_max_voxel = coordinates::world_to_voxel(
            Point3::new(bbox_max.x as f32, bbox_max.y as f32, bbox_max.z as f32),
            &world_to_voxel,
        );

        // Clamp to volume bounds with margin for supersampling
        let min_i = (bbox_min_voxel.x.floor() as isize - 1).max(0) as usize;
        let min_j = (bbox_min_voxel.y.floor() as isize - 1).max(0) as usize;
        let min_k = (bbox_min_voxel.z.floor() as isize - 1).max(0) as usize;

        let max_i = ((bbox_max_voxel.x.ceil() as isize + 1).min(dims[0] as isize - 1) as usize + 1)
            .min(dims[0]);
        let max_j = ((bbox_max_voxel.y.ceil() as isize + 1).min(dims[1] as isize - 1) as usize + 1)
            .min(dims[1]);
        let max_k = ((bbox_max_voxel.z.ceil() as isize + 1).min(dims[2] as isize - 1) as usize + 1)
            .min(dims[2]);

        let step = 1.0 / samples_per_dim as f64;
        let total_samples = (samples_per_dim * samples_per_dim * samples_per_dim) as f32;

        // Rasterize with supersampling
        for k in min_k..max_k {
            for j in min_j..max_j {
                for i in min_i..max_i {
                    let mut count = 0u32;

                    // Sample within the voxel
                    for sk in 0..samples_per_dim {
                        for sj in 0..samples_per_dim {
                            for si in 0..samples_per_dim {
                                // Compute sub-voxel position
                                let sub_voxel = nalgebra::Vector4::new(
                                    i as f64 + (si as f64 + 0.5) * step,
                                    j as f64 + (sj as f64 + 0.5) * step,
                                    k as f64 + (sk as f64 + 0.5) * step,
                                    1.0,
                                );

                                let world_vec = voxel_to_world_f64 * sub_voxel;
                                let world_pos = Point3::new(world_vec.x, world_vec.y, world_vec.z);

                                if self.contains_point(&world_pos) {
                                    count += 1;
                                }
                            }
                        }
                    }

                    // Set partial volume value
                    if count > 0 {
                        let fraction = count as f32 / total_samples;
                        volume.set_at_coords([i, j, k], self.intensity * fraction)?;
                    }
                }
            }
        }

        Ok(())
    }
}

/// Trait for volume types that can be rasterized into
pub trait VolumeRasterizer {
    /// Get the dimensions of the volume
    fn dimensions(&self) -> [usize; 3];

    /// Get the voxel-to-world transformation matrix
    fn voxel_to_world_matrix(&self) -> Matrix4<f32>;

    /// Set a value at the given voxel coordinates
    fn set_at_coords(&mut self, coords: [usize; 3], value: f32) -> Result<()>;
}

/// Simple test volume for ellipsoid rasterization
#[cfg(test)]
pub struct TestRasterVolume {
    dimensions: [usize; 3],
    voxel_to_world: Matrix4<f32>,
    data: Vec<f32>,
}

#[cfg(test)]
impl TestRasterVolume {
    pub fn new(dimensions: [usize; 3], spacing: [f32; 3], origin: [f32; 3]) -> Self {
        let size = dimensions[0] * dimensions[1] * dimensions[2];

        // Build voxel-to-world matrix
        let voxel_to_world = Matrix4::new_translation(&nalgebra::Vector3::from(origin))
            * Matrix4::new_nonuniform_scaling(&nalgebra::Vector3::from(spacing));

        Self {
            dimensions,
            voxel_to_world,
            data: vec![0.0; size],
        }
    }

    pub fn get_at_coords(&self, coords: [usize; 3]) -> Option<f32> {
        if coords[0] >= self.dimensions[0]
            || coords[1] >= self.dimensions[1]
            || coords[2] >= self.dimensions[2]
        {
            return None;
        }

        let idx = coords[2] * self.dimensions[0] * self.dimensions[1]
            + coords[1] * self.dimensions[0]
            + coords[0];

        Some(self.data[idx])
    }

    pub fn count_nonzero(&self) -> usize {
        self.data.iter().filter(|&&v| v > 0.0).count()
    }
}

#[cfg(test)]
impl VolumeRasterizer for TestRasterVolume {
    fn dimensions(&self) -> [usize; 3] {
        self.dimensions
    }

    fn voxel_to_world_matrix(&self) -> Matrix4<f32> {
        self.voxel_to_world
    }

    fn set_at_coords(&mut self, coords: [usize; 3], value: f32) -> Result<()> {
        if coords[0] >= self.dimensions[0]
            || coords[1] >= self.dimensions[1]
            || coords[2] >= self.dimensions[2]
        {
            return Err(Error::InvalidSliceSpec(format!(
                "Coordinates {:?} out of bounds for dimensions {:?}",
                coords, self.dimensions
            )));
        }

        let idx = coords[2] * self.dimensions[0] * self.dimensions[1]
            + coords[1] * self.dimensions[0]
            + coords[0];

        self.data[idx] = value;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_relative_eq;

    #[test]
    fn test_sphere_contains_point() {
        let sphere = OrientedEllipsoid::sphere(Point3::new(0.0, 0.0, 0.0), 10.0, 100.0).unwrap();

        // Center should be inside
        assert!(sphere.contains_point(&Point3::new(0.0, 0.0, 0.0)));

        // Points on axes at radius should be on boundary (approximately)
        assert!(sphere.contains_point(&Point3::new(9.99, 0.0, 0.0)));
        assert!(!sphere.contains_point(&Point3::new(10.01, 0.0, 0.0)));

        // Diagonal point inside
        assert!(sphere.contains_point(&Point3::new(5.0, 5.0, 5.0)));
    }

    #[test]
    fn test_ellipsoid_contains_point() {
        let ellipsoid = OrientedEllipsoid::new(
            Point3::new(10.0, 20.0, 30.0),
            Vector3::new(5.0, 10.0, 15.0),
            Rotation3::identity(),
            100.0,
        )
        .unwrap();

        // Center should be inside
        assert!(ellipsoid.contains_point(&Point3::new(10.0, 20.0, 30.0)));

        // Test points along each semi-axis
        assert!(ellipsoid.contains_point(&Point3::new(14.9, 20.0, 30.0)));
        assert!(!ellipsoid.contains_point(&Point3::new(15.1, 20.0, 30.0)));

        assert!(ellipsoid.contains_point(&Point3::new(10.0, 29.9, 30.0)));
        assert!(!ellipsoid.contains_point(&Point3::new(10.0, 30.1, 30.0)));
    }

    #[test]
    fn test_rotated_ellipsoid() {
        use std::f64::consts::PI;

        // Create an ellipsoid rotated 45 degrees around Z axis
        let ellipsoid = OrientedEllipsoid::from_euler_angles(
            Point3::new(0.0, 0.0, 0.0),
            Vector3::new(10.0, 5.0, 5.0),
            0.0,
            0.0,
            PI / 4.0,
            100.0,
        )
        .unwrap();

        // A point that would be outside an axis-aligned ellipsoid
        // but inside when rotated
        let test_point = Point3::new(5.0, 5.0, 0.0);
        assert!(ellipsoid.contains_point(&test_point));
    }

    #[test]
    fn test_bounding_box() {
        let sphere = OrientedEllipsoid::sphere(Point3::new(10.0, 20.0, 30.0), 5.0, 100.0).unwrap();

        let (min_corner, max_corner) = sphere.bounding_box();

        assert_relative_eq!(min_corner.x, 5.0, epsilon = 1e-10);
        assert_relative_eq!(min_corner.y, 15.0, epsilon = 1e-10);
        assert_relative_eq!(min_corner.z, 25.0, epsilon = 1e-10);

        assert_relative_eq!(max_corner.x, 15.0, epsilon = 1e-10);
        assert_relative_eq!(max_corner.y, 25.0, epsilon = 1e-10);
        assert_relative_eq!(max_corner.z, 35.0, epsilon = 1e-10);
    }

    #[test]
    fn test_volume_calculation() {
        let sphere = OrientedEllipsoid::sphere(Point3::origin(), 10.0, 100.0).unwrap();

        let expected_volume = (4.0 / 3.0) * std::f64::consts::PI * 1000.0;
        assert_relative_eq!(sphere.volume_mm3(), expected_volume, epsilon = 1e-10);
    }

    #[test]
    fn test_degenerate_radii_rejected() {
        let result = OrientedEllipsoid::new(
            Point3::origin(),
            Vector3::new(10.0, 0.0, 10.0),
            Rotation3::identity(),
            100.0,
        );

        assert!(result.is_err());
    }

    #[test]
    fn test_basic_rasterization() {
        // Create a small sphere at origin
        let sphere = OrientedEllipsoid::sphere(Point3::new(5.0, 5.0, 5.0), 3.0, 100.0).unwrap();

        // Create volume with 1mm spacing
        let mut volume = TestRasterVolume::new([10, 10, 10], [1.0, 1.0, 1.0], [0.0, 0.0, 0.0]);

        // Rasterize
        sphere.rasterize(&mut volume).unwrap();

        // Check that center is filled
        assert_eq!(volume.get_at_coords([5, 5, 5]), Some(100.0));

        // Check that corners are empty
        assert_eq!(volume.get_at_coords([0, 0, 0]), Some(0.0));
        assert_eq!(volume.get_at_coords([9, 9, 9]), Some(0.0));

        // Check that we have reasonable number of filled voxels
        let filled = volume.count_nonzero();
        assert!(filled > 50 && filled < 200, "Filled voxels: {}", filled);
    }

    #[test]
    fn test_scanline_rasterization() {
        let ellipsoid = OrientedEllipsoid::new(
            Point3::new(10.0, 10.0, 10.0),
            Vector3::new(4.0, 3.0, 2.0),
            Rotation3::identity(),
            50.0,
        )
        .unwrap();

        let mut volume1 = TestRasterVolume::new([20, 20, 20], [1.0, 1.0, 1.0], [0.0, 0.0, 0.0]);

        let mut volume2 = TestRasterVolume::new([20, 20, 20], [1.0, 1.0, 1.0], [0.0, 0.0, 0.0]);

        // Rasterize with both methods
        ellipsoid.rasterize(&mut volume1).unwrap();
        ellipsoid.rasterize_scanline(&mut volume2).unwrap();

        // Should produce identical results
        let count1 = volume1.count_nonzero();
        let count2 = volume2.count_nonzero();

        assert_eq!(
            count1, count2,
            "Basic and scanline methods should produce same result"
        );
    }

    #[test]
    fn test_supersampled_rasterization() {
        let sphere = OrientedEllipsoid::sphere(Point3::new(5.0, 5.0, 5.0), 2.5, 100.0).unwrap();

        let mut volume = TestRasterVolume::new([10, 10, 10], [1.0, 1.0, 1.0], [0.0, 0.0, 0.0]);

        // Rasterize with 2x2x2 supersampling
        sphere.rasterize_supersampled(&mut volume, 2).unwrap();

        // Check center is fully inside
        assert_eq!(volume.get_at_coords([5, 5, 5]), Some(100.0));

        // Check for partial volume effects at edges
        // Should have some voxels with values between 0 and 100
        let mut has_partial = false;
        for k in 0..10 {
            for j in 0..10 {
                for i in 0..10 {
                    if let Some(val) = volume.get_at_coords([i, j, k]) {
                        if val > 0.0 && val < 100.0 {
                            has_partial = true;
                            break;
                        }
                    }
                }
            }
        }
        assert!(
            has_partial,
            "Supersampling should produce partial volume effects"
        );
    }

    #[test]
    fn test_anisotropic_voxels() {
        let ellipsoid = OrientedEllipsoid::new(
            Point3::new(0.0, 0.0, 0.0),
            Vector3::new(10.0, 10.0, 10.0),
            Rotation3::identity(),
            100.0,
        )
        .unwrap();

        // Create volume with anisotropic spacing
        let mut volume = TestRasterVolume::new(
            [20, 20, 10],
            [1.0, 1.0, 2.0], // Z spacing is double
            [-10.0, -10.0, -10.0],
        );

        ellipsoid.rasterize(&mut volume).unwrap();

        // Check that it's filled appropriately
        assert_eq!(volume.get_at_coords([10, 10, 5]), Some(100.0)); // Center

        // The shape should be compressed in Z due to larger voxel spacing
        let filled = volume.count_nonzero();
        assert!(filled > 0, "Should have filled voxels");
    }

    #[test]
    fn test_rotated_ellipsoid_rasterization() {
        use std::f64::consts::PI;

        // Create an elongated ellipsoid rotated 45 degrees
        let ellipsoid = OrientedEllipsoid::from_euler_angles(
            Point3::new(15.0, 15.0, 15.0),
            Vector3::new(10.0, 3.0, 3.0),
            0.0,
            0.0,
            PI / 4.0,
            100.0,
        )
        .unwrap();

        let mut volume = TestRasterVolume::new([30, 30, 30], [1.0, 1.0, 1.0], [0.0, 0.0, 0.0]);

        ellipsoid.rasterize_supersampled(&mut volume, 2).unwrap();

        // Should have filled voxels
        let filled = volume.count_nonzero();
        assert!(
            filled > 100,
            "Rotated ellipsoid should fill many voxels: {}",
            filled
        );

        // Center should be filled
        assert_eq!(volume.get_at_coords([15, 15, 15]), Some(100.0));
    }
}
