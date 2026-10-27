//! Interpolation methods for volume sampling
//!
//! Provides nearest neighbor and trilinear interpolation for sampling
//! volumes at continuous voxel coordinates.

use neuro_core::Volume;

/// Sample a volume using nearest neighbor interpolation
pub fn sample_nearest(volume: &dyn Volume, voxel: [f32; 3]) -> Option<f32> {
    let dims = volume.dimensions();

    if voxel.iter().any(|v| !v.is_finite()) {
        return None;
    }

    // Voxel i covers [i - 0.5, i + 0.5); floor(v + 0.5) matches the GPU nearest
    // sampler and the bridge picker exactly at half-voxel boundaries.
    let x = (voxel[0] + 0.5).floor() as i32;
    let y = (voxel[1] + 0.5).floor() as i32;
    let z = (voxel[2] + 0.5).floor() as i32;

    // Check bounds
    if x < 0 || x >= dims[0] as i32 || y < 0 || y >= dims[1] as i32 || z < 0 || z >= dims[2] as i32
    {
        return None;
    }

    volume.get_at_coords([x as usize, y as usize, z as usize])
}

/// Sample a volume using trilinear interpolation
pub fn sample_trilinear(volume: &dyn Volume, voxel: [f32; 3]) -> Option<f32> {
    sample_trilinear_with(volume.dimensions(), voxel, |coords| {
        volume.get_at_coords(coords)
    })
}

/// Sample in the voxel-centre domain [-0.5, dimension - 0.5), matching the GPU
/// sampler and `sample_nearest`: voxel i covers [i - 0.5, i + 0.5). Corners are
/// clamped into [0, dimension - 1] (edge replication); outside and non-finite
/// coordinates have no value.
pub(crate) fn sample_trilinear_with(
    dims: [usize; 3],
    voxel: [f32; 3],
    get: impl Fn([usize; 3]) -> Option<f32>,
) -> Option<f32> {
    if (0..3).any(|i| {
        dims[i] == 0 || !voxel[i].is_finite() || voxel[i] < -0.5 || voxel[i] >= dims[i] as f32 - 0.5
    }) {
        return None;
    }
    // floor(v) may be -1 in the low half voxel; clamp before casting to usize.
    let corner = |i: usize, offset: f32| -> usize {
        (voxel[i].floor() + offset).clamp(0.0, (dims[i] - 1) as f32) as usize
    };
    let [x0, y0, z0] = [corner(0, 0.0), corner(1, 0.0), corner(2, 0.0)];
    let [x1, y1, z1] = [corner(0, 1.0), corner(1, 1.0), corner(2, 1.0)];
    let [fx, fy, fz] = voxel.map(|v| v - v.floor());
    let v000 = get([x0, y0, z0])?;
    let v001 = get([x0, y0, z1])?;
    let v010 = get([x0, y1, z0])?;
    let v011 = get([x0, y1, z1])?;
    let v100 = get([x1, y0, z0])?;
    let v101 = get([x1, y0, z1])?;
    let v110 = get([x1, y1, z0])?;
    let v111 = get([x1, y1, z1])?;

    // Trilinear interpolation
    let v00 = v000 * (1.0 - fx) + v100 * fx;
    let v01 = v001 * (1.0 - fx) + v101 * fx;
    let v10 = v010 * (1.0 - fx) + v110 * fx;
    let v11 = v011 * (1.0 - fx) + v111 * fx;

    let v0 = v00 * (1.0 - fy) + v10 * fy;
    let v1 = v01 * (1.0 - fy) + v11 * fy;

    let v = v0 * (1.0 - fz) + v1 * fz;

    Some(v)
}

/// Sample a volume using cubic interpolation (placeholder for now)
pub fn sample_cubic(volume: &dyn Volume, voxel: [f32; 3]) -> Option<f32> {
    // TODO: Implement proper tricubic interpolation
    // For now, explicitly error to prevent silent incorrect behavior
    let _ = (volume, voxel); // Silence unused parameter warnings
    panic!(
        "Cubic interpolation not yet implemented - use sample_trilinear or sample_nearest instead"
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_relative_eq;
    use neuro_core::TestVolume;

    #[test]
    fn test_nearest_neighbor() {
        let mut volume = TestVolume::new([3, 3, 3], [1.0, 1.0, 1.0], [0.0, 0.0, 0.0]);

        // Set some test values
        for z in 0..3 {
            for y in 0..3 {
                for x in 0..3 {
                    let idx = z * 9 + y * 3 + x;
                    volume.data_mut()[idx] = idx as f32;
                }
            }
        }

        // Test exact voxel centers
        assert_eq!(sample_nearest(&volume, [0.0, 0.0, 0.0]), Some(0.0));
        assert_eq!(sample_nearest(&volume, [1.0, 1.0, 1.0]), Some(13.0));
        assert_eq!(sample_nearest(&volume, [2.0, 2.0, 2.0]), Some(26.0));

        // Test rounding
        assert_eq!(sample_nearest(&volume, [0.4, 0.4, 0.4]), Some(0.0));
        assert_eq!(sample_nearest(&volume, [0.6, 0.6, 0.6]), Some(13.0));

        // Test out of bounds
        assert_eq!(sample_nearest(&volume, [-1.0, 0.0, 0.0]), None);
        assert_eq!(sample_nearest(&volume, [3.0, 0.0, 0.0]), None);

        // Half-open voxel-centre domain [-0.5, 2.5).
        assert_eq!(sample_nearest(&volume, [-0.5, 0.0, 0.0]), Some(0.0));
        assert_eq!(sample_nearest(&volume, [2.49, 0.0, 0.0]), Some(2.0));
        assert_eq!(sample_nearest(&volume, [2.5, 0.0, 0.0]), None);
    }

    #[test]
    fn trilinear_edge_replication_and_singleton_axes() {
        let mut volume = TestVolume::new([2, 2, 1], [1.0; 3], [0.0; 3]);
        volume.data_mut().copy_from_slice(&[0.0, 1.0, 2.0, 3.0]);
        assert_eq!(sample_trilinear(&volume, [1.0, 0.5, 0.0]), Some(2.0));
        assert_eq!(sample_trilinear(&volume, [0.5, 1.0, 0.0]), Some(2.5));
        assert_eq!(sample_trilinear(&volume, [1.0, 1.0, 0.0]), Some(3.0));
        assert_eq!(sample_trilinear(&volume, [1.25, 1.25, 0.25]), Some(3.0));
        // The low half voxel replicates voxel 0, matching nearest sampling.
        assert_eq!(sample_trilinear(&volume, [-0.4, -0.5, -0.5]), Some(0.0));
        assert_eq!(
            sample_trilinear(&volume, [-0.4, 0.0, 0.0]),
            sample_nearest(&volume, [-0.4, 0.0, 0.0])
        );
        for voxel in [
            [-0.51, 0.0, 0.0],
            [1.5, 0.0, 0.0],
            [1.75, 1.75, 0.0],
            [0.0, 0.0, 0.5],
            [f32::NAN, 0.0, 0.0],
            [f32::INFINITY, 0.0, 0.0],
        ] {
            assert_eq!(sample_trilinear(&volume, voxel), None);
        }
        assert_eq!(sample_nearest(&volume, [f32::NAN, 0.0, 0.0]), None);
        assert_eq!(
            sample_trilinear_with([0, 2, 1], [0.0; 3], |_| Some(1.0)),
            None
        );
    }

    #[test]
    fn test_trilinear_exact() {
        let mut volume = TestVolume::new([3, 3, 3], [1.0, 1.0, 1.0], [0.0, 0.0, 0.0]);

        // Set some test values
        for z in 0..3 {
            for y in 0..3 {
                for x in 0..3 {
                    let idx = z * 9 + y * 3 + x;
                    volume.data_mut()[idx] = idx as f32;
                }
            }
        }

        // Test exact voxel centers (should match values exactly)
        assert_eq!(sample_trilinear(&volume, [0.0, 0.0, 0.0]), Some(0.0));
        assert_eq!(sample_trilinear(&volume, [1.0, 1.0, 1.0]), Some(13.0));

        // Test midpoint interpolation
        // Between voxels [0,0,0]=0 and [1,0,0]=1
        assert_relative_eq!(
            sample_trilinear(&volume, [0.5, 0.0, 0.0]).unwrap(),
            0.5,
            epsilon = 1e-6
        );
    }

    #[test]
    fn test_trilinear_cube() {
        let mut volume = TestVolume::new([2, 2, 2], [1.0, 1.0, 1.0], [0.0, 0.0, 0.0]);

        // Set up a simple gradient cube
        volume.data_mut()[0] = 0.0; // [0,0,0]
        volume.data_mut()[1] = 1.0; // [1,0,0]
        volume.data_mut()[2] = 2.0; // [0,1,0]
        volume.data_mut()[3] = 3.0; // [1,1,0]
        volume.data_mut()[4] = 4.0; // [0,0,1]
        volume.data_mut()[5] = 5.0; // [1,0,1]
        volume.data_mut()[6] = 6.0; // [0,1,1]
        volume.data_mut()[7] = 7.0; // [1,1,1]

        // Test center of cube
        let result = sample_trilinear(&volume, [0.5, 0.5, 0.5]);
        match result {
            Some(value) => assert_relative_eq!(value, 3.5, epsilon = 1e-6),
            None => panic!("Expected Some value but got None for center of cube"),
        }

        // Test face centers (within bounds)
        let face_z0 = sample_trilinear(&volume, [0.5, 0.5, 0.0]);
        assert!(face_z0.is_some(), "Expected Some for face center at z=0");
        assert_relative_eq!(face_z0.unwrap(), 1.5, epsilon = 1e-6);

        // The final voxel plane is included.
        let face_z1 = sample_trilinear(&volume, [0.5, 0.5, 1.0]);
        assert!(face_z1.is_some(), "Expected Some for face center near z=1");
        // Bilinear interpolation on the final plane.
        assert_relative_eq!(face_z1.unwrap(), 5.5, epsilon = 1e-6);
    }
}
