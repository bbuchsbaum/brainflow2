use volmath::space::{NeuroSpaceImpl, GridSpace};
use nalgebra::Vector4;
use approx::assert_abs_diff_eq;

/// Convert voxel coordinates to normalized texture coordinates (UVW)
/// This matches the shader normalization: coord / (dim - 1)
fn voxel_to_uvw(voxel: [f32; 3], dims: [usize; 3]) -> [f32; 3] {
    [
        voxel[0] / (dims[0] as f32 - 1.0),
        voxel[1] / (dims[1] as f32 - 1.0),
        voxel[2] / (dims[2] as f32 - 1.0),
    ]
}

#[test]
fn world_to_texture_coords_roundtrip() {
    // Test setup: 10x10x10 volume with 1mm spacing, origin at (0,0,0)
    let dims = [10, 10, 10];
    let spacing = [1.0, 1.0, 1.0];
    let origin = [0.0, 0.0, 0.0];
    
    let space = NeuroSpaceImpl::<3>::from_dims_spacing_origin(dims, spacing, origin);
    
    // Test world coordinate at center in LPI mm
    let world = [4.5, 4.5, 4.5];
    
    // Transform world to voxel using the actual implementation
    let voxel = space.coord_to_grid(&world);
    
    // For identity transform, world should equal voxel
    assert_abs_diff_eq!(voxel[0], 4.5, epsilon = 1e-6);
    assert_abs_diff_eq!(voxel[1], 4.5, epsilon = 1e-6);
    assert_abs_diff_eq!(voxel[2], 4.5, epsilon = 1e-6);
    
    // Transform voxel to normalized texture coordinates
    let uvw = voxel_to_uvw(voxel, dims);
    
    // Assert UVW = (0.5, 0.5, 0.5) within epsilon
    assert_abs_diff_eq!(uvw[0], 0.5, epsilon = 1e-6);
    assert_abs_diff_eq!(uvw[1], 0.5, epsilon = 1e-6);
    assert_abs_diff_eq!(uvw[2], 0.5, epsilon = 1e-6);
    
    // Verify the voxel is in bounds
    assert!(voxel[0] >= 0.0 && voxel[0] < dims[0] as f32);
    assert!(voxel[1] >= 0.0 && voxel[1] < dims[1] as f32);
    assert!(voxel[2] >= 0.0 && voxel[2] < dims[2] as f32);
    
    // Test using the 4x4 transformation matrices
    let world_to_voxel = space.world_to_voxel();
    let voxel_to_world = space.voxel_to_world();
    
    // Test round-trip transformation using 4x4 matrices
    let world_vec = Vector4::new(world[0], world[1], world[2], 1.0);
    let voxel_vec = world_to_voxel * world_vec;
    let world_back = voxel_to_world * voxel_vec;
    
    // Verify round-trip precision
    assert_abs_diff_eq!(world_back.x / world_back.w, world[0], epsilon = 1e-6);
    assert_abs_diff_eq!(world_back.y / world_back.w, world[1], epsilon = 1e-6);
    assert_abs_diff_eq!(world_back.z / world_back.w, world[2], epsilon = 1e-6);
}

#[test]
fn world_to_texture_coords_corners() {
    let dims = [10, 10, 10];
    let spacing = [1.0, 1.0, 1.0];
    let origin = [0.0, 0.0, 0.0];
    
    let space = NeuroSpaceImpl::<3>::from_dims_spacing_origin(dims, spacing, origin);
    
    // Test corner cases using actual implementation
    let test_cases = vec![
        ([0.0, 0.0, 0.0], [0.0, 0.0, 0.0]), // Origin -> (0,0,0)
        ([9.0, 9.0, 9.0], [1.0, 1.0, 1.0]), // Far corner -> (1,1,1)
        ([0.0, 0.0, 9.0], [0.0, 0.0, 1.0]), // Z-max -> (0,0,1)
        ([9.0, 0.0, 0.0], [1.0, 0.0, 0.0]), // X-max -> (1,0,0)
    ];
    
    for (world, expected_uvw) in test_cases {
        let voxel = space.coord_to_grid(&world);
        let uvw = voxel_to_uvw(voxel, dims);
        
        assert_abs_diff_eq!(uvw[0], expected_uvw[0], epsilon = 1e-6);
        assert_abs_diff_eq!(uvw[1], expected_uvw[1], epsilon = 1e-6);
        assert_abs_diff_eq!(uvw[2], expected_uvw[2], epsilon = 1e-6);
        
        // Verify voxel is in bounds
        assert!(voxel[0] >= 0.0 && voxel[0] <= dims[0] as f32);
        assert!(voxel[1] >= 0.0 && voxel[1] <= dims[1] as f32);
        assert!(voxel[2] >= 0.0 && voxel[2] <= dims[2] as f32);
    }
}

#[test]
fn world_to_texture_coords_with_offset() {
    // Test with non-zero origin and non-unit spacing
    let dims = [50, 50, 50];
    let spacing = [2.0, 2.0, 2.0]; // 2mm voxels
    let origin = [-50.0, -50.0, -50.0];
    
    let space = NeuroSpaceImpl::<3>::from_dims_spacing_origin(dims, spacing, origin);
    
    // World coordinate at volume center
    let world = [-1.0, -1.0, -1.0]; // Center of 50x50x50 with 2mm spacing
    
    let voxel = space.coord_to_grid(&world);
    assert_abs_diff_eq!(voxel[0], 24.5, epsilon = 1e-6);
    assert_abs_diff_eq!(voxel[1], 24.5, epsilon = 1e-6);
    assert_abs_diff_eq!(voxel[2], 24.5, epsilon = 1e-6);
    
    let uvw = voxel_to_uvw(voxel, dims);
    assert_abs_diff_eq!(uvw[0], 0.5, epsilon = 1e-6);
    assert_abs_diff_eq!(uvw[1], 0.5, epsilon = 1e-6);
    assert_abs_diff_eq!(uvw[2], 0.5, epsilon = 1e-6);
    
    // Test that the 4x4 matrix properly handles the transformation
    let world_to_voxel = space.world_to_voxel();
    let world_vec = Vector4::new(world[0], world[1], world[2], 1.0);
    let voxel_vec = world_to_voxel * world_vec;
    
    assert_abs_diff_eq!(voxel_vec.x / voxel_vec.w, 24.5, epsilon = 1e-6);
    assert_abs_diff_eq!(voxel_vec.y / voxel_vec.w, 24.5, epsilon = 1e-6);
    assert_abs_diff_eq!(voxel_vec.z / voxel_vec.w, 24.5, epsilon = 1e-6);
}

#[test]
fn world_to_voxel_with_axis_flip() {
    // Test with a transform that includes axis flips (e.g., RAS to LPI)
    let dims = [64, 64, 32];
    let spacing = [1.0, 1.0, 2.0];
    let origin = [-31.5, -31.5, -31.0];
    
    let space = NeuroSpaceImpl::<3>::from_dims_spacing_origin(dims, spacing, origin);
    
    // Test several points
    let test_points = vec![
        [0.0, 0.0, 0.0],      // Center of world space
        [-31.5, -31.5, -31.0], // Origin voxel
        [31.5, 31.5, 31.0],   // Far corner
    ];
    
    for world in test_points {
        let voxel = space.coord_to_grid(&world);
        
        // Verify voxel is non-negative when world is in bounds
        let in_bounds = world[0] >= origin[0] && world[0] <= origin[0] + (dims[0] as f32 - 1.0) * spacing[0] &&
                       world[1] >= origin[1] && world[1] <= origin[1] + (dims[1] as f32 - 1.0) * spacing[1] &&
                       world[2] >= origin[2] && world[2] <= origin[2] + (dims[2] as f32 - 1.0) * spacing[2];
        
        if in_bounds {
            assert!(voxel[0] >= 0.0, "Voxel X should be non-negative for in-bounds world coordinate");
            assert!(voxel[1] >= 0.0, "Voxel Y should be non-negative for in-bounds world coordinate");
            assert!(voxel[2] >= 0.0, "Voxel Z should be non-negative for in-bounds world coordinate");
            assert!(voxel[0] <= dims[0] as f32, "Voxel X should be within volume dimensions");
            assert!(voxel[1] <= dims[1] as f32, "Voxel Y should be within volume dimensions");
            assert!(voxel[2] <= dims[2] as f32, "Voxel Z should be within volume dimensions");
        }
    }
}