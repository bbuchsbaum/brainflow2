// Test coordinate transform validation for multi-resolution volumes

use render_loop::test_fixtures::TestVolumeSet;
use nalgebra::{Matrix4, Point3, Vector3};

/// Test that world-to-voxel transforms are correct
#[test]
fn test_world_to_voxel_transforms() {
    let volumes = TestVolumeSet::create_aligned();
    let (anat_tfm, func_tfm, detail_tfm) = volumes.get_transforms();
    
    // Test world origin (0,0,0) maps to expected voxel centers
    let world_origin = Point3::new(0.0, 0.0, 0.0);
    
    // Anatomical: 256x256x256 at 1mm, centered at world origin
    // Expected voxel center: (128, 128, 128)
    let anat_voxel = anat_tfm.transform_point(&world_origin);
    assert_eq!(anat_voxel.x, 128.0, "Anatomical X transform incorrect");
    assert_eq!(anat_voxel.y, 128.0, "Anatomical Y transform incorrect");
    assert_eq!(anat_voxel.z, 128.0, "Anatomical Z transform incorrect");
    
    // Functional: 128x128x32 at 2x2x4mm, centered at world origin
    // Expected voxel center: (64, 64, 16)
    let func_voxel = func_tfm.transform_point(&world_origin);
    assert_eq!(func_voxel.x, 64.0, "Functional X transform incorrect");
    assert_eq!(func_voxel.y, 64.0, "Functional Y transform incorrect");
    assert_eq!(func_voxel.z, 16.0, "Functional Z transform incorrect");
    
    // Detail patch: 128x128x64 at 0.5mm, centered at world origin
    // Expected voxel center: (64, 64, 32)
    let detail_voxel = detail_tfm.transform_point(&world_origin);
    assert_eq!(detail_voxel.x, 64.0, "Detail X transform incorrect");
    assert_eq!(detail_voxel.y, 64.0, "Detail Y transform incorrect");
    assert_eq!(detail_voxel.z, 32.0, "Detail Z transform incorrect");
}

/// Test that voxel-to-world transforms are inverses
#[test]
fn test_voxel_to_world_inverse() {
    let volumes = TestVolumeSet::create_aligned();
    let (anat_tfm, func_tfm, detail_tfm) = volumes.get_transforms();
    
    // Get inverse transforms (voxel-to-world)
    let anat_v2w = anat_tfm.try_inverse().expect("Anatomical transform not invertible");
    let func_v2w = func_tfm.try_inverse().expect("Functional transform not invertible");
    let detail_v2w = detail_tfm.try_inverse().expect("Detail transform not invertible");
    
    // Test round-trip: world -> voxel -> world
    let test_point = Point3::new(10.0, -20.0, 30.0);
    
    // Anatomical round-trip
    let anat_voxel = anat_tfm.transform_point(&test_point);
    let anat_world = anat_v2w.transform_point(&anat_voxel);
    assert!((anat_world - test_point).norm() < 1e-6, "Anatomical round-trip failed");
    
    // Functional round-trip
    let func_voxel = func_tfm.transform_point(&test_point);
    let func_world = func_v2w.transform_point(&func_voxel);
    assert!((func_world - test_point).norm() < 1e-6, "Functional round-trip failed");
    
    // Detail round-trip
    let detail_voxel = detail_tfm.transform_point(&test_point);
    let detail_world = detail_v2w.transform_point(&detail_voxel);
    assert!((detail_world - test_point).norm() < 1e-6, "Detail round-trip failed");
}

/// Test edge cases for coordinate transforms
#[test]
fn test_transform_edge_cases() {
    let volumes = TestVolumeSet::create_aligned();
    let (anat_tfm, func_tfm, detail_tfm) = volumes.get_transforms();
    
    // Test volume corners in world space
    // Anatomical: -128 to +128mm in all axes
    let anat_corner_world = Point3::new(-128.0, -128.0, -128.0);
    let anat_corner_voxel = anat_tfm.transform_point(&anat_corner_world);
    assert_eq!(anat_corner_voxel, Point3::new(0.0, 0.0, 0.0));
    
    // Functional: -128 to +128mm in X/Y, -64 to +64mm in Z
    let func_corner_world = Point3::new(-128.0, -128.0, -64.0);
    let func_corner_voxel = func_tfm.transform_point(&func_corner_world);
    assert_eq!(func_corner_voxel, Point3::new(0.0, 0.0, 0.0));
    
    // Detail: -32 to +32mm in X/Y, -16 to +16mm in Z
    let detail_corner_world = Point3::new(-32.0, -32.0, -16.0);
    let detail_corner_voxel = detail_tfm.transform_point(&detail_corner_world);
    assert_eq!(detail_corner_voxel, Point3::new(0.0, 0.0, 0.0));
}

/// Test that transforms handle resolution correctly
#[test]
fn test_transform_resolution() {
    let volumes = TestVolumeSet::create_aligned();
    let (anat_tfm, func_tfm, detail_tfm) = volumes.get_transforms();
    
    // Test that 1mm step in world space produces correct voxel steps
    let origin = Point3::new(0.0, 0.0, 0.0);
    let x_step = Point3::new(1.0, 0.0, 0.0);
    let y_step = Point3::new(0.0, 1.0, 0.0);
    let z_step = Point3::new(0.0, 0.0, 1.0);
    
    // Anatomical (1mm voxels): 1mm world = 1 voxel
    let anat_origin = anat_tfm.transform_point(&origin);
    let anat_x = anat_tfm.transform_point(&x_step);
    let anat_y = anat_tfm.transform_point(&y_step);
    let anat_z = anat_tfm.transform_point(&z_step);
    
    assert_eq!((anat_x - anat_origin).x, 1.0, "Anatomical X resolution incorrect");
    assert_eq!((anat_y - anat_origin).y, 1.0, "Anatomical Y resolution incorrect");
    assert_eq!((anat_z - anat_origin).z, 1.0, "Anatomical Z resolution incorrect");
    
    // Functional (2x2x4mm voxels): 1mm world = 0.5, 0.5, 0.25 voxels
    let func_origin = func_tfm.transform_point(&origin);
    let func_x = func_tfm.transform_point(&x_step);
    let func_y = func_tfm.transform_point(&y_step);
    let func_z = func_tfm.transform_point(&z_step);
    
    assert_eq!((func_x - func_origin).x, 0.5, "Functional X resolution incorrect");
    assert_eq!((func_y - func_origin).y, 0.5, "Functional Y resolution incorrect");
    assert_eq!((func_z - func_origin).z, 0.25, "Functional Z resolution incorrect");
    
    // Detail (0.5mm voxels): 1mm world = 2 voxels
    let detail_origin = detail_tfm.transform_point(&origin);
    let detail_x = detail_tfm.transform_point(&x_step);
    let detail_y = detail_tfm.transform_point(&y_step);
    let detail_z = detail_tfm.transform_point(&z_step);
    
    assert_eq!((detail_x - detail_origin).x, 2.0, "Detail X resolution incorrect");
    assert_eq!((detail_y - detail_origin).y, 2.0, "Detail Y resolution incorrect");
    assert_eq!((detail_z - detail_origin).z, 2.0, "Detail Z resolution incorrect");
}

/// Test transform matrix structure and properties
#[test]
fn test_transform_matrix_properties() {
    let volumes = TestVolumeSet::create_aligned();
    let (anat_tfm, func_tfm, detail_tfm) = volumes.get_transforms();
    
    println!("Anatomical transform matrix:");
    println!("{}", anat_tfm);
    
    println!("\nFunctional transform matrix:");
    println!("{}", func_tfm);
    
    println!("\nDetail transform matrix:");
    println!("{}", detail_tfm);
    
    // Verify matrix structure: scaling on diagonal, translation in last column
    // Anatomical: 1mm voxels, translation (128, 128, 128)
    assert_eq!(anat_tfm[(0, 0)], 1.0, "Anatomical X scale");
    assert_eq!(anat_tfm[(1, 1)], 1.0, "Anatomical Y scale");
    assert_eq!(anat_tfm[(2, 2)], 1.0, "Anatomical Z scale");
    assert_eq!(anat_tfm[(0, 3)], 128.0, "Anatomical X translation");
    assert_eq!(anat_tfm[(1, 3)], 128.0, "Anatomical Y translation");
    assert_eq!(anat_tfm[(2, 3)], 128.0, "Anatomical Z translation");
    
    // Functional: 2x2x4mm voxels, translation (64, 64, 16)
    assert_eq!(func_tfm[(0, 0)], 0.5, "Functional X scale");
    assert_eq!(func_tfm[(1, 1)], 0.5, "Functional Y scale");
    assert_eq!(func_tfm[(2, 2)], 0.25, "Functional Z scale");
    assert_eq!(func_tfm[(0, 3)], 64.0, "Functional X translation");
    assert_eq!(func_tfm[(1, 3)], 64.0, "Functional Y translation");
    assert_eq!(func_tfm[(2, 3)], 16.0, "Functional Z translation");
}

/// Test that negative voxel coordinates are handled correctly
#[test]
fn test_negative_voxel_handling() {
    let volumes = TestVolumeSet::create_aligned();
    let (anat_tfm, func_tfm, detail_tfm) = volumes.get_transforms();
    
    // Test points outside volume bounds
    let far_point = Point3::new(-200.0, -200.0, -200.0);
    
    let anat_voxel = anat_tfm.transform_point(&far_point);
    println!("Far point {} -> anatomical voxel {}", far_point, anat_voxel);
    assert!(anat_voxel.x < 0.0, "Should produce negative X voxel");
    assert!(anat_voxel.y < 0.0, "Should produce negative Y voxel");
    assert!(anat_voxel.z < 0.0, "Should produce negative Z voxel");
    
    // Test boundary conditions
    let boundary_tests = vec![
        (Point3::new(-128.0, 0.0, 0.0), "X minimum boundary"),
        (Point3::new(128.0, 0.0, 0.0), "X maximum boundary"),
        (Point3::new(0.0, -128.0, 0.0), "Y minimum boundary"),
        (Point3::new(0.0, 128.0, 0.0), "Y maximum boundary"),
        (Point3::new(0.0, 0.0, -128.0), "Z minimum boundary"),
        (Point3::new(0.0, 0.0, 128.0), "Z maximum boundary"),
    ];
    
    for (world_point, desc) in boundary_tests {
        let voxel = anat_tfm.transform_point(&world_point);
        println!("{}: world {} -> voxel {}", desc, world_point, voxel);
        
        // Check that boundary points map to volume edges
        assert!(voxel.x >= 0.0 && voxel.x <= 256.0, "{}: X out of bounds", desc);
        assert!(voxel.y >= 0.0 && voxel.y <= 256.0, "{}: Y out of bounds", desc);
        assert!(voxel.z >= 0.0 && voxel.z <= 256.0, "{}: Z out of bounds", desc);
    }
}

/// Helper to create a transform matrix from components
fn create_transform(scale: Vector3<f32>, translation: Vector3<f32>) -> Matrix4<f32> {
    Matrix4::new(
        scale.x, 0.0, 0.0, translation.x,
        0.0, scale.y, 0.0, translation.y,
        0.0, 0.0, scale.z, translation.z,
        0.0, 0.0, 0.0, 1.0,
    )
}

/// Test manual transform creation matches test fixtures
#[test]
fn test_manual_transform_creation() {
    // Create transforms manually
    let anat_manual = create_transform(
        Vector3::new(1.0, 1.0, 1.0),      // 1mm voxels
        Vector3::new(128.0, 128.0, 128.0) // Center at voxel 128
    );
    
    let func_manual = create_transform(
        Vector3::new(0.5, 0.5, 0.25),    // 2x2x4mm voxels
        Vector3::new(64.0, 64.0, 16.0)   // Center at voxel 64,64,16
    );
    
    let detail_manual = create_transform(
        Vector3::new(2.0, 2.0, 2.0),     // 0.5mm voxels
        Vector3::new(64.0, 64.0, 32.0)   // Center at voxel 64,64,32
    );
    
    // Get transforms from test fixtures
    let volumes = TestVolumeSet::create_aligned();
    let (anat_tfm, func_tfm, detail_tfm) = volumes.get_transforms();
    
    // Compare
    assert_eq!(anat_manual, anat_tfm, "Anatomical transform mismatch");
    assert_eq!(func_manual, func_tfm, "Functional transform mismatch");
    assert_eq!(detail_manual, detail_tfm, "Detail transform mismatch");
}