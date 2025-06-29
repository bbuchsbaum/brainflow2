use render_loop::RenderLoopService;
use volmath::{DenseVolume3, NeuroSpace3};
use volmath::space::NeuroSpaceImpl;

/// Test that 3D texture coordinates are properly handled
#[tokio::test]
async fn test_3d_texture_volume_upload() {
    let mut service = RenderLoopService::new().await.unwrap();
    
    // Create 10x10x10 volume
    let dims = [10, 10, 10];
    let data = vec![1.0f32; 1000];
    let space = NeuroSpaceImpl::<3>::from_dims_spacing_origin(
        dims,
        [1.0, 1.0, 1.0],
        [0.0, 0.0, 0.0],
    );
    let volume = DenseVolume3::from_data(NeuroSpace3(space), data);
    
    // Upload volume
    let result = service.upload_volume_3d(&volume);
    assert!(result.is_ok());
    
    let (layer_idx, _world_to_voxel) = result.unwrap();
    assert_eq!(layer_idx, 0); // 3D textures always use layer 0
    
    // Add layer to render state
    service.add_render_layer(
        layer_idx,
        1.0,
        (0.0, 0.0, 1.0, 1.0), // Full volume coords
    ).unwrap();
    
    // Test rendering at various positions
    let test_positions = vec![
        [0.0, 0.0, 5.0],    // Center Z
        [9.0, 0.0, 5.0],    // Edge X
        [0.0, 9.0, 5.0],    // Edge Y
        [9.0, 9.0, 5.0],    // Corner
        [4.5, 4.5, 4.5],    // True center
    ];
    
    for pos in test_positions {
        service.set_crosshair(pos);
        service.update_frame_for_synchronized_view(
            15.0, 15.0, pos, 2
        );
    }
}

/// Test normalization with non-cubic volumes
#[tokio::test]
async fn test_non_cubic_volume_normalization() {
    let mut service = RenderLoopService::new().await.unwrap();
    
    // Create rectangular volume 64x32x16
    let dims = [64, 32, 16];
    let data = vec![1.0f32; 64 * 32 * 16];
    let space = NeuroSpaceImpl::<3>::from_dims_spacing_origin(
        dims,
        [1.0, 1.0, 1.0],
        [0.0, 0.0, 0.0],
    );
    let volume = DenseVolume3::from_data(NeuroSpace3(space), data);
    
    // Upload volume
    let result = service.upload_volume_3d(&volume);
    assert!(result.is_ok());
    
    let (layer_idx, world_to_voxel) = result.unwrap();
    
    // Add render layer
    service.add_render_layer(
        layer_idx,
        1.0,
        (0.0, 0.0, 1.0, 1.0),
    ).unwrap();
    
    // Test that world-to-voxel transform handles non-cubic dimensions
    let test_world = nalgebra::Vector4::new(31.5, 15.5, 7.5, 1.0);
    let voxel = world_to_voxel * test_world;
    
    // For identity transform, should map to center voxel
    assert!((voxel.x / voxel.w - 31.5).abs() < 0.01);
    assert!((voxel.y / voxel.w - 15.5).abs() < 0.01);
    assert!((voxel.z / voxel.w - 7.5).abs() < 0.01);
}

/// Test edge cases in volume dimensions
#[tokio::test]
async fn test_edge_case_dimensions() {
    let mut service = RenderLoopService::new().await.unwrap();
    
    // Test 1x1x1 volume (degenerate case)
    let dims = [1, 1, 1];
    let data = vec![1.0f32; 1];
    let space = NeuroSpaceImpl::<3>::from_dims_spacing_origin(
        dims,
        [1.0, 1.0, 1.0],
        [0.0, 0.0, 0.0],
    );
    let volume = DenseVolume3::from_data(NeuroSpace3(space), data);
    
    let result = service.upload_volume_3d(&volume);
    assert!(result.is_ok());
    
    // Test 2x2x2 volume (minimal non-degenerate)
    let dims = [2, 2, 2];
    let data = vec![1.0f32; 8];
    let space = NeuroSpaceImpl::<3>::from_dims_spacing_origin(
        dims,
        [1.0, 1.0, 1.0],
        [0.0, 0.0, 0.0],
    );
    let volume = DenseVolume3::from_data(NeuroSpace3(space), data);
    
    let result = service.upload_volume_3d(&volume);
    assert!(result.is_ok());
    
    let (layer_idx, _) = result.unwrap();
    
    service.add_render_layer(
        layer_idx,
        1.0,
        (0.0, 0.0, 1.0, 1.0),
    ).unwrap();
    
    // Test corners map correctly
    let corners = vec![
        [0.0, 0.0, 0.0],
        [1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
        [1.0, 1.0, 0.0],
    ];
    
    for corner in corners {
        service.set_crosshair(corner);
    }
}

/// Test intensity window normalization
#[tokio::test]
async fn test_intensity_window_normalization() {
    let mut service = RenderLoopService::new().await.unwrap();
    
    // Create volume with specific test pattern
    let dims = [8, 8, 8];
    let mut data = vec![0.0f32; 512];
    
    // Create gradient along X axis
    for z in 0..8 {
        for y in 0..8 {
            for x in 0..8 {
                let idx = z * 64 + y * 8 + x;
                data[idx] = x as f32 * 10.0; // 0, 10, 20, ..., 70
            }
        }
    }
    
    let space = NeuroSpaceImpl::<3>::from_dims_spacing_origin(
        dims,
        [1.0, 1.0, 1.0],
        [0.0, 0.0, 0.0],
    );
    let volume = DenseVolume3::from_data(NeuroSpace3(space), data);
    
    let result = service.upload_volume_3d(&volume);
    assert!(result.is_ok());
    
    let (layer_idx, _) = result.unwrap();
    
    service.add_render_layer(
        layer_idx,
        1.0,
        (0.0, 0.0, 1.0, 1.0),
    ).unwrap();
    
    // Update intensity window to match data range
    service.update_layer_intensity(0, 0.0, 70.0).unwrap();
    
    // Set view to show gradient
    service.update_frame_for_synchronized_view(
        10.0,
        10.0,
        [4.0, 4.0, 4.0],
        2,
    );
}

/// Test WebGPU texture alignment requirements
#[tokio::test]
async fn test_texture_upload_alignment() {
    let mut service = RenderLoopService::new().await.unwrap();
    
    // Create volumes with dimensions that test alignment
    let test_dims = vec![
        [127, 64, 32],  // Odd width requires padding
        [256, 128, 64], // Powers of 2, no padding needed
        [100, 100, 50], // Non-power-of-2 dimensions
    ];
    
    for dims in test_dims {
        let voxel_count = dims[0] * dims[1] * dims[2];
        let data = vec![1.0f32; voxel_count];
        let space = NeuroSpaceImpl::<3>::from_dims_spacing_origin(
            dims,
            [1.0, 1.0, 1.0],
            [0.0, 0.0, 0.0],
        );
        let volume = DenseVolume3::from_data(NeuroSpace3(space), data);
        
        let result = service.upload_volume_3d(&volume);
        assert!(result.is_ok(), "Failed to upload volume with dims {:?}", dims);
    }
}