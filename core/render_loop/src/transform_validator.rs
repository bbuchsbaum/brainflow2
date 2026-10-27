// Transform validation utilities for multi-resolution rendering

use crate::RenderLoopError;
use nalgebra::{Matrix4, Point3, Vector3};

/// Validates coordinate transforms for rendering
pub struct TransformValidator;

impl TransformValidator {
    /// Validate a world-to-voxel transform matrix
    pub fn validate_transform(
        transform: &Matrix4<f32>,
        volume_dims: [u32; 3],
        expected_voxel_size_mm: Option<Vector3<f32>>,
    ) -> Result<TransformInfo, ValidationError> {
        // Check matrix is invertible
        let inverse = transform
            .try_inverse()
            .ok_or(ValidationError::NonInvertible)?;

        // Extract scale factors (voxel size in mm⁻¹)
        let scale_x = transform.column(0).xyz().norm();
        let scale_y = transform.column(1).xyz().norm();
        let scale_z = transform.column(2).xyz().norm();

        // Voxel sizes in mm
        let voxel_size = Vector3::new(1.0 / scale_x, 1.0 / scale_y, 1.0 / scale_z);

        // Validate against expected if provided
        if let Some(expected) = expected_voxel_size_mm {
            let diff = (voxel_size - expected).norm();
            if diff > 0.001 {
                return Err(ValidationError::UnexpectedVoxelSize {
                    expected,
                    actual: voxel_size,
                });
            }
        }

        // World bounds of the voxel-centre domain [-0.5, dim - 0.5) per axis.
        let [lo, hx, hy, hz] = [
            -0.5,
            volume_dims[0] as f32 - 0.5,
            volume_dims[1] as f32 - 0.5,
            volume_dims[2] as f32 - 0.5,
        ];
        let corners = [
            Point3::new(lo, lo, lo),
            Point3::new(hx, lo, lo),
            Point3::new(lo, hy, lo),
            Point3::new(lo, lo, hz),
            Point3::new(hx, hy, lo),
            Point3::new(hx, lo, hz),
            Point3::new(lo, hy, hz),
            Point3::new(hx, hy, hz),
        ];

        let mut min_world = Point3::new(f32::INFINITY, f32::INFINITY, f32::INFINITY);
        let mut max_world = Point3::new(f32::NEG_INFINITY, f32::NEG_INFINITY, f32::NEG_INFINITY);

        for corner in &corners {
            let world_pt = inverse.transform_point(corner);
            min_world.x = min_world.x.min(world_pt.x);
            min_world.y = min_world.y.min(world_pt.y);
            min_world.z = min_world.z.min(world_pt.z);
            max_world.x = max_world.x.max(world_pt.x);
            max_world.y = max_world.y.max(world_pt.y);
            max_world.z = max_world.z.max(world_pt.z);
        }

        Ok(TransformInfo {
            voxel_size_mm: voxel_size,
            world_bounds: (min_world, max_world),
            is_axis_aligned: Self::is_axis_aligned(transform),
            determinant: transform.determinant(),
        })
    }

    /// Check if transform is axis-aligned (no rotation)
    fn is_axis_aligned(transform: &Matrix4<f32>) -> bool {
        // Check off-diagonal elements in rotation part
        let threshold = 1e-6;
        transform[(0, 1)].abs() < threshold
            && transform[(0, 2)].abs() < threshold
            && transform[(1, 0)].abs() < threshold
            && transform[(1, 2)].abs() < threshold
            && transform[(2, 0)].abs() < threshold
            && transform[(2, 1)].abs() < threshold
    }

    /// Validate that a world point will map to valid voxel coordinates
    pub fn validate_world_point(
        world_point: &Point3<f32>,
        transform: &Matrix4<f32>,
        volume_dims: [u32; 3],
    ) -> PointValidation {
        let voxel = transform.transform_point(world_point);

        // Voxel-centre domain, shared with the GPU samplers and CPU renderer.
        let in_bounds =
            (0..3).all(|axis| voxel[axis] >= -0.5 && voxel[axis] < volume_dims[axis] as f32 - 0.5);

        PointValidation {
            voxel_coords: voxel,
            in_bounds,
            distance_to_bounds: if in_bounds {
                0.0
            } else {
                Self::distance_to_bounds(&voxel, volume_dims)
            },
        }
    }

    /// Distance (in voxels) from a point to the voxel-centre domain
    /// [-0.5, dim - 0.5) on each axis.
    fn distance_to_bounds(voxel: &Point3<f32>, dims: [u32; 3]) -> f32 {
        (0..3)
            .map(|axis| {
                let low = -0.5;
                let high = dims[axis] as f32 - 0.5;
                let d = if voxel[axis] < low {
                    low - voxel[axis]
                } else if voxel[axis] >= high {
                    voxel[axis] - high
                } else {
                    0.0
                };
                d * d
            })
            .sum::<f32>()
            .sqrt()
    }

    /// Validate multiple transforms for alignment in world space
    pub fn validate_multi_volume_alignment(
        transforms: &[(Matrix4<f32>, [u32; 3])], // (transform, dims) pairs
    ) -> Result<AlignmentInfo, ValidationError> {
        if transforms.is_empty() {
            return Err(ValidationError::NoTransforms);
        }

        let mut world_bounds = Vec::new();
        let mut all_axis_aligned = true;

        for (transform, dims) in transforms {
            let info = Self::validate_transform(transform, *dims, None)?;
            world_bounds.push(info.world_bounds);
            all_axis_aligned = all_axis_aligned && info.is_axis_aligned;
        }

        // Find overall world bounds
        let mut global_min = world_bounds[0].0;
        let mut global_max = world_bounds[0].1;

        for (min, max) in &world_bounds[1..] {
            global_min.x = global_min.x.min(min.x);
            global_min.y = global_min.y.min(min.y);
            global_min.z = global_min.z.min(min.z);
            global_max.x = global_max.x.max(max.x);
            global_max.y = global_max.y.max(max.y);
            global_max.z = global_max.z.max(max.z);
        }

        Ok(AlignmentInfo {
            global_world_bounds: (global_min, global_max),
            all_axis_aligned,
            volume_count: transforms.len(),
        })
    }
}

/// Information about a validated transform
#[derive(Debug, Clone)]
pub struct TransformInfo {
    pub voxel_size_mm: Vector3<f32>,
    pub world_bounds: (Point3<f32>, Point3<f32>),
    pub is_axis_aligned: bool,
    pub determinant: f32,
}

/// Validation result for a world point
#[derive(Debug, Clone)]
pub struct PointValidation {
    pub voxel_coords: Point3<f32>,
    pub in_bounds: bool,
    pub distance_to_bounds: f32,
}

/// Information about multi-volume alignment
#[derive(Debug, Clone)]
pub struct AlignmentInfo {
    pub global_world_bounds: (Point3<f32>, Point3<f32>),
    pub all_axis_aligned: bool,
    pub volume_count: usize,
}

/// Transform validation errors
#[derive(Debug, Clone, thiserror::Error)]
pub enum ValidationError {
    #[error("Transform matrix is not invertible")]
    NonInvertible,

    #[error("Unexpected voxel size: expected {expected:?}mm, got {actual:?}mm")]
    UnexpectedVoxelSize {
        expected: Vector3<f32>,
        actual: Vector3<f32>,
    },

    #[error("No transforms provided")]
    NoTransforms,
}

impl From<ValidationError> for RenderLoopError {
    fn from(err: ValidationError) -> Self {
        RenderLoopError::Internal {
            code: 5001,
            details: err.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_fixtures::TestVolumeSet;

    #[test]
    fn test_transform_validation() {
        let volumes = TestVolumeSet::create_aligned();
        let (anat_tfm, func_tfm, detail_tfm) = volumes.get_transforms();

        // Validate anatomical transform
        let anat_info = TransformValidator::validate_transform(
            &anat_tfm,
            [256, 256, 256],
            Some(Vector3::new(1.0, 1.0, 1.0)),
        )
        .unwrap();

        assert_eq!(anat_info.voxel_size_mm, Vector3::new(1.0, 1.0, 1.0));
        assert!(anat_info.is_axis_aligned);
        assert!((anat_info.determinant - 1.0).abs() < 1e-6);

        // Validate functional transform
        let func_info = TransformValidator::validate_transform(
            &func_tfm,
            [128, 128, 32],
            Some(Vector3::new(2.0, 2.0, 4.0)),
        )
        .unwrap();

        assert_eq!(func_info.voxel_size_mm, Vector3::new(2.0, 2.0, 4.0));
        assert!(func_info.is_axis_aligned);

        // Validate detail transform
        let detail_info = TransformValidator::validate_transform(
            &detail_tfm,
            [128, 128, 64],
            Some(Vector3::new(0.5, 0.5, 0.5)),
        )
        .unwrap();

        assert_eq!(detail_info.voxel_size_mm, Vector3::new(0.5, 0.5, 0.5));
        assert!(detail_info.is_axis_aligned);
    }

    #[test]
    fn test_point_validation() {
        let volumes = TestVolumeSet::create_aligned();
        let (anat_tfm, _, _) = volumes.get_transforms();

        // Test in-bounds point
        let world_origin = Point3::new(0.0, 0.0, 0.0);
        let validation =
            TransformValidator::validate_world_point(&world_origin, &anat_tfm, [256, 256, 256]);

        assert!(validation.in_bounds);
        assert_eq!(validation.voxel_coords, Point3::new(128.0, 128.0, 128.0));
        assert_eq!(validation.distance_to_bounds, 0.0);

        // Test out-of-bounds point
        let far_point = Point3::new(-200.0, 0.0, 0.0);
        let validation =
            TransformValidator::validate_world_point(&far_point, &anat_tfm, [256, 256, 256]);

        assert!(!validation.in_bounds);
        assert!(validation.distance_to_bounds > 0.0);
    }

    #[test]
    fn point_validation_uses_voxel_centre_domain() {
        let identity = Matrix4::identity();
        let check = |x: f32| {
            TransformValidator::validate_world_point(
                &Point3::new(x, 0.0, 0.0),
                &identity,
                [4, 4, 4],
            )
        };
        assert!(check(-0.5).in_bounds);
        assert!(check(3.49).in_bounds);
        assert!(!check(3.5).in_bounds);
        let below = check(-1.5);
        assert!(!below.in_bounds);
        assert!((below.distance_to_bounds - 1.0).abs() < 1e-6);
        assert!((check(4.5).distance_to_bounds - 1.0).abs() < 1e-6);
    }

    #[test]
    fn test_multi_volume_alignment() {
        let volumes = TestVolumeSet::create_aligned();
        let (anat_tfm, func_tfm, detail_tfm) = volumes.get_transforms();

        let transforms = vec![
            (anat_tfm, [256, 256, 256]),
            (func_tfm, [128, 128, 32]),
            (detail_tfm, [128, 128, 64]),
        ];

        let alignment = TransformValidator::validate_multi_volume_alignment(&transforms).unwrap();

        assert_eq!(alignment.volume_count, 3);
        assert!(alignment.all_axis_aligned);

        // Global bounds span the anatomical voxel-centre domain: 256 1 mm voxels
        // centred from -128 to 127 cover [-128.5, 127.5).
        let (min, max) = alignment.global_world_bounds;
        assert!(min.x <= -128.5 && max.x >= 127.5);
        assert!(min.y <= -128.5 && max.y >= 127.5);
        assert!(min.z <= -128.5 && max.z >= 127.5);
    }
}
