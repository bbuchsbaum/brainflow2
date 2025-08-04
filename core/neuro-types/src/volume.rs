//! Volume storage and access traits
//!
//! Provides unified interfaces for volume data storage and retrieval

use crate::VolumeHandle;
use nalgebra::Matrix4;
use std::sync::Arc;

/// Trait representing a 3D volume
pub trait Volume: Send + Sync {
    /// Get the dimensions of the volume [x, y, z]
    fn dimensions(&self) -> [usize; 3];

    /// Get the voxel spacing in mm [dx, dy, dz]
    fn spacing(&self) -> [f32; 3];

    /// Get the origin in world coordinates [x, y, z]
    fn origin(&self) -> [f32; 3];

    /// Sample a value at the given voxel coordinates
    fn get_at_coords(&self, coords: [usize; 3]) -> Option<f32>;

    /// Get the voxel-to-world affine transform matrix
    /// This is the full 4x4 matrix that transforms voxel indices to world coordinates
    fn voxel_to_world_matrix(&self) -> Matrix4<f32>;

    /// Get the data type name for debugging
    fn dtype_name(&self) -> &str;
}

/// Trait for storing and retrieving volumes
///
/// Implementations should be thread-safe and avoid global state.
pub trait VolumeStore: Send + Sync {
    /// Retrieve a volume by its handle
    fn get_volume(&self, handle: &VolumeHandle) -> Option<Arc<dyn Volume>>;

    /// Add a volume to the store and return its handle
    fn add_volume(&mut self, volume: Arc<dyn Volume>) -> VolumeHandle;

    /// Remove a volume from the store
    fn remove_volume(&mut self, handle: &VolumeHandle) -> Option<Arc<dyn Volume>>;

    /// Get the number of volumes in the store
    fn len(&self) -> usize;

    /// Check if the store is empty
    fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// Coordinate conversion utilities
pub mod coordinates {
    use nalgebra::{Matrix4, Point3, Vector4};

    /// Convert world coordinates to voxel coordinates using affine transform
    pub fn world_to_voxel(world_pos: Point3<f32>, world_to_voxel: &Matrix4<f32>) -> Point3<f32> {
        let world_vec = Vector4::new(world_pos.x, world_pos.y, world_pos.z, 1.0);
        let voxel_vec = world_to_voxel * world_vec;
        Point3::new(voxel_vec.x, voxel_vec.y, voxel_vec.z)
    }

    /// Convert voxel coordinates to world coordinates using affine transform
    pub fn voxel_to_world(voxel_pos: Point3<f32>, voxel_to_world: &Matrix4<f32>) -> Point3<f32> {
        let voxel_vec = Vector4::new(voxel_pos.x, voxel_pos.y, voxel_pos.z, 1.0);
        let world_vec = voxel_to_world * voxel_vec;
        Point3::new(world_vec.x, world_vec.y, world_vec.z)
    }

    /// High-precision coordinate conversion using f64 arithmetic
    pub fn world_to_voxel_f64(
        world_pos: Point3<f64>,
        world_to_voxel: &Matrix4<f64>,
    ) -> Point3<f64> {
        let world_vec = nalgebra::Vector4::new(world_pos.x, world_pos.y, world_pos.z, 1.0);
        let voxel_vec = world_to_voxel * world_vec;
        Point3::new(voxel_vec.x, voxel_vec.y, voxel_vec.z)
    }

    /// Convert f32 matrix to f64 for higher precision calculations
    pub fn matrix_f32_to_f64(matrix: &Matrix4<f32>) -> Matrix4<f64> {
        Matrix4::new(
            matrix[(0, 0)] as f64,
            matrix[(0, 1)] as f64,
            matrix[(0, 2)] as f64,
            matrix[(0, 3)] as f64,
            matrix[(1, 0)] as f64,
            matrix[(1, 1)] as f64,
            matrix[(1, 2)] as f64,
            matrix[(1, 3)] as f64,
            matrix[(2, 0)] as f64,
            matrix[(2, 1)] as f64,
            matrix[(2, 2)] as f64,
            matrix[(2, 3)] as f64,
            matrix[(3, 0)] as f64,
            matrix[(3, 1)] as f64,
            matrix[(3, 2)] as f64,
            matrix[(3, 3)] as f64,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nalgebra::{Matrix4, Point3};

    #[test]
    fn test_coordinate_conversion() {
        // Identity transform
        let identity = Matrix4::identity();
        let world_pos = Point3::new(1.0, 2.0, 3.0);

        let voxel_pos = coordinates::world_to_voxel(world_pos, &identity);
        assert_eq!(voxel_pos, world_pos);

        let world_back = coordinates::voxel_to_world(voxel_pos, &identity);
        assert!((world_back - world_pos).norm() < 1e-6);
    }

    #[test]
    fn test_matrix_precision_conversion() {
        let matrix_f32 = Matrix4::new(
            1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0, 13.0, 14.0, 15.0, 16.0,
        );

        let matrix_f64 = coordinates::matrix_f32_to_f64(&matrix_f32);

        for i in 0..4 {
            for j in 0..4 {
                assert!((matrix_f64[(i, j)] - matrix_f32[(i, j)] as f64).abs() < 1e-15);
            }
        }
    }

    #[test]
    fn test_high_precision_conversion() {
        let world_pos = Point3::new(3.14159265359, 2.71828182846, 1.41421356237);
        let transform = coordinates::matrix_f32_to_f64(&Matrix4::identity());

        let voxel_pos = coordinates::world_to_voxel_f64(world_pos, &transform);
        assert!((voxel_pos - world_pos).norm() < 1e-15);
    }
}
