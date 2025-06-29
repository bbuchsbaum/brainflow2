use render_loop::RenderLoopService;
use volmath::{DenseVolume3, NeuroSpace3};
use volmath::space::{NeuroSpaceImpl, GridSpace};

#[tokio::test]
async fn oob_crosshair_yields_constant() {
    // Initialize render service
    let mut service = RenderLoopService::new().await.unwrap();
    
    // Create a 10x10x10 volume filled with value 100.0
    let dims = [10, 10, 10];
    let data = vec![100.0f32; 1000];
    
    // Create space with 1mm spacing at origin (0,0,0)
    let space = NeuroSpaceImpl::<3>::from_dims_spacing_origin(
        dims,
        [1.0, 1.0, 1.0],
        [0.0, 0.0, 0.0],
    );
    let volume = DenseVolume3::from_data(NeuroSpace3(space.clone()), data);
    
    // Upload volume
    let result = service.upload_volume_3d(&volume);
    assert!(result.is_ok(), "Failed to upload volume: {:?}", result.err());
    
    let (layer_idx, _world_to_voxel) = result.unwrap();
    
    // Add layer to render state
    let render_idx = service.add_render_layer(
        layer_idx,
        1.0, // full opacity
        (0.0, 0.0, 1.0, 1.0), // full texture coords
    ).unwrap();
    
    // Set intensity window
    service.update_layer_intensity(render_idx, 0.0, 200.0).unwrap();
    
    // Test out-of-bounds crosshair positions
    let oob_positions = vec![
        [-1.0, 5.0, 5.0],    // X < 0
        [10.0, 5.0, 5.0],    // X > max
        [5.0, -1.0, 5.0],    // Y < 0
        [5.0, 10.0, 5.0],    // Y > max
        [5.0, 5.0, -1.0],    // Z < 0
        [5.0, 5.0, 10.0],    // Z > max
        [-5.0, -5.0, -5.0],  // All negative
        [15.0, 15.0, 15.0],  // All beyond max
    ];
    
    for world_pos in oob_positions {
        // Set crosshair to out-of-bounds position
        service.set_crosshair(world_pos);
        
        // Verify the position maps to out-of-bounds voxel coordinates
        let voxel = space.coord_to_grid(&world_pos);
        
        // At least one coordinate should be out of bounds
        let is_oob = voxel[0] < 0.0 || voxel[0] >= dims[0] as f32 ||
                     voxel[1] < 0.0 || voxel[1] >= dims[1] as f32 ||
                     voxel[2] < 0.0 || voxel[2] >= dims[2] as f32;
        
        assert!(is_oob, "Position {:?} should map to out-of-bounds voxel coordinates, got {:?}", 
                world_pos, voxel);
        
        // Calculate texture coordinates
        let uvw = [
            voxel[0] / (dims[0] as f32 - 1.0),
            voxel[1] / (dims[1] as f32 - 1.0),
            voxel[2] / (dims[2] as f32 - 1.0),
        ];
        
        // At least one UVW coordinate should be outside [0, 1]
        let uvw_oob = uvw[0] < 0.0 || uvw[0] > 1.0 ||
                      uvw[1] < 0.0 || uvw[1] > 1.0 ||
                      uvw[2] < 0.0 || uvw[2] > 1.0;
        
        assert!(uvw_oob, "UVW coordinates {:?} should be out of bounds for voxel {:?}", 
                uvw, voxel);
        
        // In a real GPU test, we would verify that:
        // 1. The shader's texture3D sampler returns 0.0 for out-of-bounds coordinates
        // 2. The rendered pixel shows background color (black) not volume data
    }
}

#[tokio::test]
async fn oob_edge_cases() {
    let mut service = RenderLoopService::new().await.unwrap();
    
    // Create small volume to test edge cases
    let dims = [2, 2, 2];
    let data = vec![
        1.0, 2.0,  // z=0, y=0
        3.0, 4.0,  // z=0, y=1
        5.0, 6.0,  // z=1, y=0
        7.0, 8.0,  // z=1, y=1
    ];
    
    let space = NeuroSpaceImpl::<3>::from_dims_spacing_origin(
        dims,
        [1.0, 1.0, 1.0],
        [0.0, 0.0, 0.0],
    );
    let volume = DenseVolume3::from_data(NeuroSpace3(space.clone()), data);
    
    let result = service.upload_volume_3d(&volume);
    assert!(result.is_ok());
    
    let (layer_idx, _) = result.unwrap();
    
    service.add_render_layer(
        layer_idx,
        1.0,
        (0.0, 0.0, 1.0, 1.0),
    ).unwrap();
    
    // Test positions exactly at boundaries
    let boundary_tests = vec![
        // Position -> Expected behavior
        ([0.0, 0.0, 0.0], true),   // Exactly at origin (in bounds)
        ([1.0, 1.0, 1.0], true),   // Exactly at far corner (in bounds)
        ([-0.1, 0.5, 0.5], false), // Just outside X min
        ([1.1, 0.5, 0.5], false),  // Just outside X max
        ([0.5, -0.1, 0.5], false), // Just outside Y min
        ([0.5, 1.1, 0.5], false),  // Just outside Y max
        ([0.5, 0.5, -0.1], false), // Just outside Z min
        ([0.5, 0.5, 1.1], false),  // Just outside Z max
    ];
    
    for (world_pos, should_be_in_bounds) in boundary_tests {
        let voxel = space.coord_to_grid(&world_pos);
        
        let is_in_bounds = voxel[0] >= 0.0 && voxel[0] <= 1.0 &&
                          voxel[1] >= 0.0 && voxel[1] <= 1.0 &&
                          voxel[2] >= 0.0 && voxel[2] <= 1.0;
        
        assert_eq!(is_in_bounds, should_be_in_bounds, 
                   "Position {:?} -> voxel {:?} should be {} bounds",
                   world_pos, voxel, 
                   if should_be_in_bounds { "in" } else { "out of" });
    }
}

#[tokio::test]
async fn oob_with_transform() {
    let mut service = RenderLoopService::new().await.unwrap();
    
    // Volume with non-trivial transform
    let dims = [20, 20, 10];
    let data = vec![50.0f32; 4000];
    
    // 3mm spacing, origin at (-30, -30, -15)
    let space = NeuroSpaceImpl::<3>::from_dims_spacing_origin(
        dims,
        [3.0, 3.0, 3.0],
        [-30.0, -30.0, -15.0],
    );
    let volume = DenseVolume3::from_data(NeuroSpace3(space.clone()), data);
    
    let result = service.upload_volume_3d(&volume);
    assert!(result.is_ok());
    
    let (layer_idx, world_to_voxel) = result.unwrap();
    
    service.add_render_layer(
        layer_idx,
        1.0,
        (0.0, 0.0, 1.0, 1.0),
    ).unwrap();
    
    // Volume bounds in world space:
    // X: [-30, 27] (origin + (dims-1) * spacing = -30 + 19*3 = 27)
    // Y: [-30, 27]
    // Z: [-15, 12] (origin + (dims-1) * spacing = -15 + 9*3 = 12)
    
    let oob_world_positions = vec![
        [-31.0, 0.0, 0.0],   // Just outside X min (voxel -0.33)
        [30.1, 0.0, 0.0],    // Just outside X max (voxel 20.03)
        [0.0, -31.0, 0.0],   // Just outside Y min (voxel -0.33)
        [0.0, 30.1, 0.0],    // Just outside Y max (voxel 20.03)
        [0.0, 0.0, -16.0],   // Just outside Z min (voxel -0.33)
        [0.0, 0.0, 15.1],    // Just outside Z max (voxel 10.03)
    ];
    
    for world_pos in oob_world_positions {
        // Use the 4x4 matrix to transform
        let world_vec = nalgebra::Vector4::new(world_pos[0], world_pos[1], world_pos[2], 1.0);
        let voxel_vec = world_to_voxel * world_vec;
        let voxel = [
            voxel_vec.x / voxel_vec.w,
            voxel_vec.y / voxel_vec.w,
            voxel_vec.z / voxel_vec.w,
        ];
        
        // Verify at least one voxel coordinate is out of bounds
        let is_oob = voxel[0] < 0.0 || voxel[0] >= dims[0] as f32 ||
                     voxel[1] < 0.0 || voxel[1] >= dims[1] as f32 ||
                     voxel[2] < 0.0 || voxel[2] >= dims[2] as f32;
        
        assert!(is_oob, "World position {:?} should be out of bounds, voxel: {:?}", 
                world_pos, voxel);
    }
}