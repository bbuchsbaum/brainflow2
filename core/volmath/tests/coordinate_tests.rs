// Tests for coordinate system transformations
// Ensures correct handling of LPI convention and multi-volume alignment

use volmath::space::{NeuroSpaceImpl, GridSpace};
use nalgebra::Matrix4;
use approx::assert_relative_eq;

/// Test that world coordinates follow LPI convention
/// X: Right (-) to Left (+)
/// Y: Anterior (-) to Posterior (+)  
/// Z: Inferior (-) to Superior (+)
#[test]
fn test_lpi_world_coordinates() {
    // Create a volume with standard LPI orientation
    let dim = [91, 109, 91];
    let spacing = [2.0, 2.0, 2.0];
    let origin = [-90.0, -126.0, -72.0]; // MNI origin
    
    let space = NeuroSpaceImpl::<3>::from_dims_spacing_origin(dim, spacing, origin);
    
    // Test voxel at center of volume
    let center_voxel = [45.0, 54.0, 45.0];
    let world_coords = space.grid_to_coord(&center_voxel);
    
    // In LPI, center should be near [0, 0, 0] for MNI-aligned volume
    assert_relative_eq!(world_coords[0], 0.0, epsilon = 1e-3);
    assert_relative_eq!(world_coords[1], -18.0, epsilon = 1e-3); // Slightly posterior
    assert_relative_eq!(world_coords[2], 18.0, epsilon = 1e-3); // Slightly superior
    
    // Test that moving in positive voxel directions follows LPI
    // Moving from voxel 44 to 45 in X should increase world X (right to left)
    let left_voxel = space.grid_to_coord(&[44.0, 54.0, 45.0]);
    let right_voxel = space.grid_to_coord(&[45.0, 54.0, 45.0]);
    assert!(right_voxel[0] > left_voxel[0], "Positive X voxel should map to more Left in world");
    
    // Moving from voxel 53 to 54 in Y should increase world Y (anterior to posterior)
    let anterior_voxel = space.grid_to_coord(&[45.0, 53.0, 45.0]);
    let posterior_voxel = space.grid_to_coord(&[45.0, 54.0, 45.0]);
    assert!(posterior_voxel[1] > anterior_voxel[1], "Positive Y voxel should map to more Posterior in world");
    
    // Moving from voxel 44 to 45 in Z should increase world Z (inferior to superior)
    let inferior_voxel = space.grid_to_coord(&[45.0, 54.0, 44.0]);
    let superior_voxel = space.grid_to_coord(&[45.0, 54.0, 45.0]);
    assert!(superior_voxel[2] > inferior_voxel[2], "Positive Z voxel should map to more Superior in world");
}

/// Test RPI to LPI transformation
/// RPI: Right-Posterior-Inferior orientation needs to be displayed in LPI
#[test]
fn test_rpi_to_lpi_transform() {
    // Create an RPI volume - note the flipped X axis in the affine
    let dim = [87, 79, 87];
    let rpi_affine = Matrix4::new(
        -2.0,  0.0,  0.0,  86.0,  // X axis flipped (negative)
         0.0,  2.0,  0.0, -114.0,  // Y axis same
         0.0,  0.0,  2.0,  -70.0,  // Z axis same
         0.0,  0.0,  0.0,   1.0
    );
    
    let space = NeuroSpaceImpl::<3>::from_affine_matrix4(dim, rpi_affine);
    
    // Test that voxel [0,0,0] maps to RPI origin (right-most point)
    let origin_world = space.grid_to_coord(&[0.0, 0.0, 0.0]);
    assert_relative_eq!(origin_world[0], 86.0, epsilon = 1e-3); // Right side in LPI
    
    // Test that moving in positive voxel X actually moves LEFT in world space
    let voxel_10 = space.grid_to_coord(&[10.0, 0.0, 0.0]);
    assert!(voxel_10[0] < origin_world[0], "RPI positive voxel X should decrease world X");
    assert_relative_eq!(voxel_10[0], 86.0 - 20.0, epsilon = 1e-3);
    
    // Known anatomical landmark: anterior commissure approximately at world [0, -24, -5]
    let ac_world = [0.0, -24.0, -5.0];
    let ac_voxel_f = space.coord_to_grid(&ac_world);
    let ac_voxel = [
        ac_voxel_f[0].round() as usize,
        ac_voxel_f[1].round() as usize, 
        ac_voxel_f[2].round() as usize
    ];
    
    // Verify the voxel is within bounds
    assert!(ac_voxel[0] < dim[0], "AC voxel X should be in bounds");
    assert!(ac_voxel[1] < dim[1], "AC voxel Y should be in bounds");
    assert!(ac_voxel[2] < dim[2], "AC voxel Z should be in bounds");
    
    // For RPI volume, AC should be around voxel [43, 45, 32]
    assert!((ac_voxel[0] as i32 - 43).abs() < 3, "AC X voxel should be near 43");
    assert!((ac_voxel[1] as i32 - 45).abs() < 3, "AC Y voxel should be near 45");
    assert!((ac_voxel[2] as i32 - 32).abs() < 3, "AC Z voxel should be near 32");
}

/// Test ASI (Anterior-Superior-Inferior) to LPI transformation
#[test]
fn test_asi_to_lpi_transform() {
    // Create an ASI volume with rotated axes
    let dim = [64, 64, 32];
    let asi_affine = Matrix4::new(
         0.0,  3.0,  0.0, -96.0,  // X maps to Y (anterior)
         0.0,  0.0,  3.0, -48.0,  // Y maps to Z (superior)
         3.0,  0.0,  0.0, -96.0,  // Z maps to X (inferior direction but positive)
         0.0,  0.0,  0.0,   1.0
    );
    
    let space = NeuroSpaceImpl::<3>::from_affine_matrix4(dim, asi_affine);
    
    // Test coordinate mapping
    let test_voxel = [10.0, 20.0, 30.0];
    let world = space.grid_to_coord(&test_voxel);
    
    // Debug print to understand the mapping
    println!("ASI test_voxel: {:?}", test_voxel);
    println!("ASI world coords: {:?}", world);
    
    // In ASI affine matrix:
    // Row 0: [0, 3, 0, -96] means world X = 3*voxel_Y - 96  
    // Row 1: [0, 0, 3, -48] means world Y = 3*voxel_Z - 48
    // Row 2: [3, 0, 0, -96] means world Z = 3*voxel_X - 96
    assert_relative_eq!(world[0], 3.0 * test_voxel[1] - 96.0, epsilon = 1e-3); // voxel Y -> world X
    assert_relative_eq!(world[1], 3.0 * test_voxel[2] - 48.0, epsilon = 1e-3); // voxel Z -> world Y  
    assert_relative_eq!(world[2], 3.0 * test_voxel[0] - 96.0, epsilon = 1e-3); // voxel X -> world Z
    
    // Verify round-trip
    let voxel_back = space.coord_to_grid(&world);
    assert_relative_eq!(voxel_back[0], test_voxel[0], epsilon = 1e-3);
    assert_relative_eq!(voxel_back[1], test_voxel[1], epsilon = 1e-3);
    assert_relative_eq!(voxel_back[2], test_voxel[2], epsilon = 1e-3);
}

/// Test multi-volume overlay with different orientations and resolutions
#[test]
fn test_multi_volume_overlay_alignment() {
    // Volume A: Standard LPI T1, 1mm isotropic, 256x256x256
    let vol_a_dim = [256, 256, 256];
    let vol_a = NeuroSpaceImpl::<3>::from_dims_spacing_origin(
        vol_a_dim,
        [1.0, 1.0, 1.0],
        [-128.0, -128.0, -128.0]
    );
    
    // Volume B: RPI T2, 2mm isotropic, 91x109x91
    let vol_b_dim = [91, 109, 91];
    let vol_b_affine = Matrix4::new(
        -2.0,  0.0,  0.0,  90.0,
         0.0,  2.0,  0.0, -126.0,
         0.0,  0.0,  2.0,  -72.0,
         0.0,  0.0,  0.0,   1.0
    );
    let vol_b = NeuroSpaceImpl::<3>::from_affine_matrix4(vol_b_dim, vol_b_affine);
    
    // Volume C: Oblique EPI, 3x3x4mm, 64x64x32  
    let vol_c_dim = [64, 64, 32];
    let vol_c_affine = Matrix4::new(
         2.8,  0.4,  0.0, -90.0,
        -0.4,  2.8,  0.5, -90.0,
         0.0, -0.6,  3.9, -60.0,
         0.0,  0.0,  0.0,   1.0
    );
    let vol_c = NeuroSpaceImpl::<3>::from_affine_matrix4(vol_c_dim, vol_c_affine);
    
    // Test that same world coordinate maps to anatomically equivalent voxels
    let test_points = [
        [0.0, 0.0, 0.0],       // Center
        [0.0, -24.0, -5.0],    // Anterior commissure
        [0.0, 0.0, 20.0],      // Superior point
        [-40.0, 0.0, 0.0],     // Right hemisphere
        [40.0, 0.0, 0.0],      // Left hemisphere
    ];
    
    for world_point in &test_points {
        // Get voxel coordinates in each volume
        let voxel_a = vol_a.coord_to_grid(world_point);
        let voxel_b = vol_b.coord_to_grid(world_point);
        let voxel_c = vol_c.coord_to_grid(world_point);
        
        // Convert back to world to verify accuracy
        let world_a = vol_a.grid_to_coord(&voxel_a);
        let world_b = vol_b.grid_to_coord(&voxel_b);
        let world_c = vol_c.grid_to_coord(&voxel_c);
        
        // All should map back to approximately the same world coordinate
        for i in 0..3 {
            assert_relative_eq!(world_a[i], world_point[i], epsilon = 0.5);
            assert_relative_eq!(world_b[i], world_point[i], epsilon = 0.5);
            assert_relative_eq!(world_c[i], world_point[i], epsilon = 0.5);
        }
        
        // Verify voxels are within bounds (if the point is within the FOV)
        let in_bounds_a = voxel_a.iter().zip(vol_a_dim.iter())
            .all(|(v, d)| *v >= 0.0 && *v < *d as f32);
        let in_bounds_b = voxel_b.iter().zip(vol_b_dim.iter())
            .all(|(v, d)| *v >= 0.0 && *v < *d as f32);
        let in_bounds_c = voxel_c.iter().zip(vol_c_dim.iter())
            .all(|(v, d)| *v >= 0.0 && *v < *d as f32);
            
        // At least one volume should contain each test point
        assert!(in_bounds_a || in_bounds_b || in_bounds_c, 
                "At least one volume should contain point {:?}", world_point);
    }
}

/// Test edge cases and boundary conditions
#[test]
fn test_coordinate_edge_cases() {
    let dim = [10, 10, 10];
    let space = NeuroSpaceImpl::<3>::from_dims_spacing_origin(
        dim,
        [1.0, 1.0, 1.0],
        [0.0, 0.0, 0.0]
    );
    
    // Test voxel boundaries
    let corner_voxels = [
        [0.0, 0.0, 0.0],
        [9.0, 0.0, 0.0],
        [0.0, 9.0, 0.0],
        [0.0, 0.0, 9.0],
        [9.0, 9.0, 9.0],
    ];
    
    for voxel in &corner_voxels {
        let world = space.grid_to_coord(voxel);
        let voxel_back = space.coord_to_grid(&world);
        
        for i in 0..3 {
            assert_relative_eq!(voxel_back[i], voxel[i], epsilon = 1e-6);
        }
    }
    
    // Test out-of-bounds coordinates
    let oob_world = [-10.0, -10.0, -10.0];
    let oob_voxel = space.coord_to_grid(&oob_world);
    assert!(oob_voxel[0] < 0.0);
    assert!(oob_voxel[1] < 0.0);
    assert!(oob_voxel[2] < 0.0);
    
    // Test half-voxel shift (voxel centers vs corners)
    let voxel_center = [0.5, 0.5, 0.5];
    let world_center = space.grid_to_coord(&voxel_center);
    assert_relative_eq!(world_center[0], 0.5, epsilon = 1e-6);
    assert_relative_eq!(world_center[1], 0.5, epsilon = 1e-6);
    assert_relative_eq!(world_center[2], 0.5, epsilon = 1e-6);
}

/// Test identity and near-identity affines
#[test]
fn test_identity_affine() {
    // Pure identity case
    let dim = [64, 64, 64];
    let identity_space = NeuroSpaceImpl::<3>::from_dims_spacing_origin(
        dim,
        [1.0, 1.0, 1.0],
        [0.0, 0.0, 0.0]
    );
    
    // Grid coordinates should equal world coordinates
    let test_coord = [10.0, 20.0, 30.0];
    let world = identity_space.grid_to_coord(&test_coord);
    assert_relative_eq!(world[0], test_coord[0], epsilon = 1e-9);
    assert_relative_eq!(world[1], test_coord[1], epsilon = 1e-9);
    assert_relative_eq!(world[2], test_coord[2], epsilon = 1e-9);
    
    // Test with small rotation
    let small_rotation = Matrix4::new(
         0.999,  0.01, 0.0, 10.0,
        -0.01,  0.999, 0.0, 20.0,
         0.0,   0.0,  1.0, 30.0,
         0.0,   0.0,  0.0,  1.0
    );
    
    let rotated_space = NeuroSpaceImpl::<3>::from_affine_matrix4(dim, small_rotation);
    
    // Should handle small rotations without numerical issues
    let grid_point = [32.0, 32.0, 32.0];
    let world_rot = rotated_space.grid_to_coord(&grid_point);
    let grid_back = rotated_space.coord_to_grid(&world_rot);
    
    for i in 0..3 {
        assert_relative_eq!(grid_back[i], grid_point[i], epsilon = 1e-6);
    }
}