// Basic test to ensure volumes render without black screens

use render_loop::test_fixtures::create_test_pattern_volume;
use volmath::{DenseVolume3, space::GridSpace, NeuroSpaceExt};
use nalgebra::Matrix4;

/// Test that we can create and validate test volumes
#[test]
fn test_create_test_volume() {
    let volume = create_test_pattern_volume();
    
    // Verify volume properties
    assert_eq!(volume.space.0.dims(), &[64, 64, 25]);
    
    // Check that we have non-zero data
    let data = volume.values();
    let non_zero_count = data.iter().filter(|&&v| v > 0).count();
    assert!(non_zero_count > 100, "Volume should have substantial non-zero data");
    
    // Verify center voxel
    let center_value = volume.get_at_coords(&[32, 32, 12]).unwrap();
    assert_eq!(center_value, 255, "Center voxel should be bright");
}

/// Test multi-resolution volume creation
#[test]
fn test_multi_resolution_volumes() {
    use render_loop::test_fixtures::TestVolumeSet;
    
    let volumes = TestVolumeSet::create_aligned();
    
    // Verify all volumes created successfully
    assert_eq!(volumes.anatomical.space.0.dims(), &[256, 256, 256]);
    assert_eq!(volumes.functional.space.0.dims(), &[128, 128, 32]);
    assert_eq!(volumes.detail_patch.space.0.dims(), &[128, 128, 64]);
    
    // Verify transforms align at world origin
    let (anat_tfm, func_tfm, detail_tfm) = volumes.get_transforms();
    
    // World origin should map to expected voxel locations
    let world_origin = nalgebra::Point3::new(0.0, 0.0, 0.0);
    
    let anat_voxel = anat_tfm.transform_point(&world_origin);
    assert_eq!(anat_voxel.coords, nalgebra::Vector3::new(128.0, 128.0, 128.0));
    
    let func_voxel = func_tfm.transform_point(&world_origin);
    assert_eq!(func_voxel.coords, nalgebra::Vector3::new(64.0, 64.0, 16.0));
}

/// Test that binary masks have correct intensity patterns
#[test]
fn test_binary_mask_pattern() {
    let volume = create_test_pattern_volume();
    
    // Check plus sign pattern in center slice
    let z = 12;
    
    // Check horizontal line (except center which is brighter)
    for x in 0..64 {
        if x != 32 {
            let value = volume.get_at_coords(&[x, 32, z]).unwrap();
            assert_eq!(value, 100, "Horizontal line at x={} should be visible", x);
        }
    }
    
    // Check vertical line (except center which is brighter)
    for y in 0..64 {
        if y != 32 {
            let value = volume.get_at_coords(&[32, y, z]).unwrap();
            assert_eq!(value, 100, "Vertical line at y={} should be visible", y);
        }
    }
    
    // Check center is brightest
    let center = volume.get_at_coords(&[32, 32, z]).unwrap();
    assert_eq!(center, 255, "Center should be brightest point");
}

/// Helper to create a simple anatomical volume
fn create_simple_anatomical() -> DenseVolume3<u8> {
    let dims = [128, 128, 128];
    let mut data = vec![0u8; 128 * 128 * 128];
    
    // Create a sphere in the center
    let center = 64.0;
    let radius = 40.0;
    
    for z in 0..128 {
        for y in 0..128 {
            for x in 0..128 {
                let dx = x as f32 - center;
                let dy = y as f32 - center;
                let dz = z as f32 - center;
                let dist_sq = dx * dx + dy * dy + dz * dz;
                
                if dist_sq < radius * radius {
                    data[z * 128 * 128 + y * 128 + x] = 200;
                }
            }
        }
    }
    
    use volmath::space::{NeuroSpace3, NeuroSpaceImpl};
    let space_impl = NeuroSpaceExt::from_affine_matrix4(dims, Matrix4::identity());
    let space = NeuroSpace3::new(space_impl);
    DenseVolume3::from_data(space.0, data)
}

/// Test that anatomical volumes have expected properties
#[test]
fn test_anatomical_volume_properties() {
    let volume = create_simple_anatomical();
    
    // Check dimensions
    assert_eq!(volume.space.0.dims(), &[128, 128, 128]);
    
    // Check center voxel is inside the sphere
    let center_value = volume.get_at_coords(&[64, 64, 64]).unwrap();
    assert_eq!(center_value, 200, "Center should be inside sphere");
    
    // Check corner is outside
    let corner_value = volume.get_at_coords(&[0, 0, 0]).unwrap();
    assert_eq!(corner_value, 0, "Corner should be outside sphere");
    
    // Verify we have substantial brain tissue
    let tissue_voxels = volume.values().iter().filter(|&&v| v == 200).count();
    assert!(tissue_voxels > 100000, "Should have substantial tissue volume");
}

/// Test world-to-voxel transforms
#[test]
fn test_world_to_voxel_transforms() {
    use render_loop::test_fixtures::TestVolumeSet;
    
    let volumes = TestVolumeSet::create_aligned();
    let (anat_tfm, func_tfm, _) = volumes.get_transforms();
    
    // Test anatomical transform (1mm isotropic)
    let world_point = nalgebra::Point3::new(0.0, 0.0, 0.0);
    let voxel = anat_tfm.transform_point(&world_point);
    assert_eq!(voxel.coords, nalgebra::Vector3::new(128.0, 128.0, 128.0));
    
    // Test functional transform (2x2x4mm)
    let voxel = func_tfm.transform_point(&world_point);
    assert_eq!(voxel.coords, nalgebra::Vector3::new(64.0, 64.0, 16.0));
    
    // Test inverse transform
    let anat_voxel = nalgebra::Point3::new(128.0, 128.0, 128.0);
    let world_back = anat_tfm.try_inverse().unwrap().transform_point(&anat_voxel);
    assert!((world_back.x).abs() < 0.001);
    assert!((world_back.y).abs() < 0.001);
    assert!((world_back.z).abs() < 0.001);
}