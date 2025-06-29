use volmath::space::{NeuroSpaceImpl, GridSpace};
use nalgebra::{Matrix4, Vector3};
use approx::assert_relative_eq;

#[test]
fn test_identity_transform() {
    // Create a 10x10x10 volume with identity transform
    let space = NeuroSpaceImpl::<3>::from_dims_spacing_origin(
        [10, 10, 10],
        [1.0, 1.0, 1.0],
        [0.0, 0.0, 0.0],
    );
    
    // Test voxel to world for center voxel
    let center_voxel = [4.5, 4.5, 4.5];
    let world_coords = space.grid_to_coord(&center_voxel);
    
    // For identity transform, voxel should equal world
    assert_relative_eq!(world_coords[0], 4.5, epsilon = 1e-6);
    assert_relative_eq!(world_coords[1], 4.5, epsilon = 1e-6);
    assert_relative_eq!(world_coords[2], 4.5, epsilon = 1e-6);
    
    // Test world to voxel (inverse)
    let voxel_coords = space.coord_to_grid(&world_coords);
    assert_relative_eq!(voxel_coords[0], center_voxel[0], epsilon = 1e-6);
    assert_relative_eq!(voxel_coords[1], center_voxel[1], epsilon = 1e-6);
    assert_relative_eq!(voxel_coords[2], center_voxel[2], epsilon = 1e-6);
}

#[test]
fn test_flipped_transform() {
    // Create a transform with X-axis flip (RPI to LPI)
    let mut linear = Matrix4::<f32>::identity();
    linear[(0, 0)] = -1.0; // Flip X axis
    linear[(0, 3)] = 9.0;  // Translate to keep volume in positive space
    
    let space = NeuroSpaceImpl::<3>::from_affine_matrix4(
        [10, 10, 10],
        linear,
    );
    
    // Test center voxel
    let center_voxel = [4.5, 4.5, 4.5];
    let world_coords = space.grid_to_coord(&center_voxel);
    
    // X should be flipped and translated: -4.5 + 9 = 4.5
    assert_relative_eq!(world_coords[0], 4.5, epsilon = 1e-6);
    assert_relative_eq!(world_coords[1], 4.5, epsilon = 1e-6);
    assert_relative_eq!(world_coords[2], 4.5, epsilon = 1e-6);
    
    // Test world to voxel
    let voxel_coords = space.coord_to_grid(&world_coords);
    assert_relative_eq!(voxel_coords[0], center_voxel[0], epsilon = 1e-6);
    assert_relative_eq!(voxel_coords[1], center_voxel[1], epsilon = 1e-6);
    assert_relative_eq!(voxel_coords[2], center_voxel[2], epsilon = 1e-6);
    
    // Test that world [0,0,0] maps to voxel [9,0,0]
    let origin_world = [0.0, 0.0, 0.0];
    let origin_voxel = space.coord_to_grid(&origin_world);
    assert_relative_eq!(origin_voxel[0], 9.0, epsilon = 1e-6);
    assert_relative_eq!(origin_voxel[1], 0.0, epsilon = 1e-6);
    assert_relative_eq!(origin_voxel[2], 0.0, epsilon = 1e-6);
}

#[test]
fn test_scaled_and_translated_transform() {
    // Create a volume with non-unit spacing and non-zero origin
    let space = NeuroSpaceImpl::<3>::from_dims_spacing_origin(
        [64, 64, 25],
        [3.5, 3.5, 3.5],
        [-111.5, -111.5, -43.75],
    );
    
    // Center voxel should be at [31.5, 31.5, 12]
    let center_voxel = [31.5, 31.5, 12.0];
    let world_coords = space.grid_to_coord(&center_voxel);
    
    // World coords = voxel * spacing + origin
    let expected_world = [
        31.5 * 3.5 - 111.5,  // 110.25 - 111.5 = -1.25
        31.5 * 3.5 - 111.5,  // 110.25 - 111.5 = -1.25
        12.0 * 3.5 - 43.75,  // 42 - 43.75 = -1.75
    ];
    
    assert_relative_eq!(world_coords[0], expected_world[0], epsilon = 1e-6);
    assert_relative_eq!(world_coords[1], expected_world[1], epsilon = 1e-6);
    assert_relative_eq!(world_coords[2], expected_world[2], epsilon = 1e-6);
    
    // Test inverse
    let voxel_coords = space.coord_to_grid(&world_coords);
    assert_relative_eq!(voxel_coords[0], center_voxel[0], epsilon = 1e-6);
    assert_relative_eq!(voxel_coords[1], center_voxel[1], epsilon = 1e-6);
    assert_relative_eq!(voxel_coords[2], center_voxel[2], epsilon = 1e-6);
}

#[test]
fn test_bounds_checking() {
    let space = NeuroSpaceImpl::<3>::from_dims_spacing_origin(
        [10, 10, 10],
        [1.0, 1.0, 1.0],
        [0.0, 0.0, 0.0],
    );
    
    // Test in-bounds coordinates
    let in_bounds_voxel = [5.0, 5.0, 5.0];
    let index = space.coord_to_index(&in_bounds_voxel);
    assert!(index.is_some());
    
    // Test out-of-bounds coordinates
    let out_of_bounds_voxel = [-1.0, 5.0, 5.0];
    let index = space.coord_to_index(&out_of_bounds_voxel);
    assert!(index.is_none());
    
    let out_of_bounds_voxel = [5.0, 5.0, 10.0];
    let index = space.coord_to_index(&out_of_bounds_voxel);
    assert!(index.is_none());
}

#[test]
fn test_matrix_inverse_consistency() {
    // Test that world_to_voxel is actually the inverse of voxel_to_world
    let space = NeuroSpaceImpl::<3>::from_dims_spacing_origin(
        [20, 30, 40],
        [2.0, 3.0, 4.0],
        [-10.0, -20.0, -30.0],
    );
    
    let voxel_to_world = space.voxel_to_world();
    let world_to_voxel = space.world_to_voxel();
    
    // Multiply them together should give identity
    let should_be_identity = world_to_voxel * voxel_to_world;
    
    // Check diagonal elements are 1
    for i in 0..4 {
        assert_relative_eq!(should_be_identity[(i, i)], 1.0, epsilon = 1e-6);
    }
    
    // Check off-diagonal elements are 0
    for i in 0..4 {
        for j in 0..4 {
            if i != j {
                assert_relative_eq!(should_be_identity[(i, j)], 0.0, epsilon = 1e-6);
            }
        }
    }
}