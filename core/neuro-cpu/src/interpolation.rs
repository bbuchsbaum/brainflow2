//! Interpolation methods for volume sampling
//!
//! Provides nearest neighbor and trilinear interpolation for sampling
//! volumes at continuous voxel coordinates.

use neuro_core::Volume;

/// Sample a volume using nearest neighbor interpolation
pub fn sample_nearest(volume: &dyn Volume, voxel: [f32; 3]) -> Option<f32> {
    let dims = volume.dimensions();

    // Round to nearest integer coordinates
    let x = voxel[0].round() as i32;
    let y = voxel[1].round() as i32;
    let z = voxel[2].round() as i32;

    // Check bounds
    if x < 0 || x >= dims[0] as i32 || y < 0 || y >= dims[1] as i32 || z < 0 || z >= dims[2] as i32
    {
        return None;
    }

    volume.get_at_coords([x as usize, y as usize, z as usize])
}

/// Sample a volume using trilinear interpolation
pub fn sample_trilinear(volume: &dyn Volume, voxel: [f32; 3]) -> Option<f32> {
    let dims = volume.dimensions();

    // Get the integer coordinates of the corner voxels
    let x0 = voxel[0].floor() as i32;
    let y0 = voxel[1].floor() as i32;
    let z0 = voxel[2].floor() as i32;

    let x1 = x0 + 1;
    let y1 = y0 + 1;
    let z1 = z0 + 1;

    // Check if coordinates are within bounds
    if x0 < 0
        || x0 >= dims[0] as i32
        || y0 < 0
        || y0 >= dims[1] as i32
        || z0 < 0
        || z0 >= dims[2] as i32
    {
        return None;
    }

    // Clamp upper corners to stay within bounds (edge replication)
    let x1 = x1.min(dims[0] as i32 - 1);
    let y1 = y1.min(dims[1] as i32 - 1);
    let z1 = z1.min(dims[2] as i32 - 1);

    // Get fractional parts
    let fx = voxel[0] - x0 as f32;
    let fy = voxel[1] - y0 as f32;
    let fz = voxel[2] - z0 as f32;

    // Get values at the 8 corners
    let v000 = volume.get_at_coords([x0 as usize, y0 as usize, z0 as usize])?;
    let v001 = volume.get_at_coords([x0 as usize, y0 as usize, z1 as usize])?;
    let v010 = volume.get_at_coords([x0 as usize, y1 as usize, z0 as usize])?;
    let v011 = volume.get_at_coords([x0 as usize, y1 as usize, z1 as usize])?;
    let v100 = volume.get_at_coords([x1 as usize, y0 as usize, z0 as usize])?;
    let v101 = volume.get_at_coords([x1 as usize, y0 as usize, z1 as usize])?;
    let v110 = volume.get_at_coords([x1 as usize, y1 as usize, z0 as usize])?;
    let v111 = volume.get_at_coords([x1 as usize, y1 as usize, z1 as usize])?;

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

        // For a 2x2x2 volume, max valid position is [1,1,1] exclusive, so use 0.99
        let face_z1 = sample_trilinear(&volume, [0.5, 0.5, 0.99]);
        assert!(face_z1.is_some(), "Expected Some for face center near z=1");
        // This will be very close to 5.5 since we're sampling near z=1
        assert_relative_eq!(face_z1.unwrap(), 5.5, epsilon = 0.1);
    }
}
