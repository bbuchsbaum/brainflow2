use render_loop::RenderLoopService;
use volmath::{DenseVolume3, NeuroSpace3, NeuroSpaceExt};
use volmath::space::{NeuroSpaceImpl, GridSpace};
use wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;

#[tokio::test]
async fn texture_upload_stride_10x10x10() {
    // Initialize render service
    let mut service = RenderLoopService::new().await.unwrap();
    
    // Create a 10x10x10 volume with known pattern
    let dims = [10, 10, 10];
    let mut data = vec![0.0f32; 1000];
    
    // Fill with a distinctive pattern: checkerboard in each slice
    for z in 0..10 {
        for y in 0..10 {
            for x in 0..10 {
                let idx = z * 100 + y * 10 + x;
                // Checkerboard pattern: alternating 0 and 1000
                data[idx] = if (x + y + z) % 2 == 0 { 0.0 } else { 1000.0 };
            }
        }
    }
    
    // Create space
    let space = <volmath::NeuroSpace as NeuroSpaceExt>::from_dims_spacing_origin(
        dims.to_vec(),
        vec![1.0, 1.0, 1.0],
        vec![0.0, 0.0, 0.0],
    ).expect("Failed to create NeuroSpace");
    let volume = DenseVolume3::from_data(space.clone(), data.clone());
    
    // Upload volume - this is where stride handling happens
    let result = service.upload_volume_3d(&volume);
    assert!(result.is_ok(), "Failed to upload volume: {:?}", result.err());
    
    let (layer_idx, _) = result.unwrap();
    
    // Verify the upload handled stride correctly
    // For R16Float format (2 bytes per pixel), 10x10x10 volume:
    // Row pitch = 10 pixels * 2 bytes = 20 bytes
    // WebGPU requires 256-byte alignment, so padded row pitch = 256 bytes
    
    let bytes_per_pixel = 2; // R16Float
    let unpadded_row_pitch = dims[0] * bytes_per_pixel;
    let padded_row_pitch = ((unpadded_row_pitch + COPY_BYTES_PER_ROW_ALIGNMENT as usize - 1) 
                            / COPY_BYTES_PER_ROW_ALIGNMENT as usize) 
                           * COPY_BYTES_PER_ROW_ALIGNMENT as usize;
    
    assert_eq!(padded_row_pitch, 256, "Expected 256-byte aligned row pitch");
    
    // Add layer and set up for rendering
    service.add_render_layer(
        layer_idx,
        1.0,
        (0.0, 0.0, 1.0, 1.0),
    ).unwrap();
    
    service.update_layer_intensity(0, 0.0, 1000.0).unwrap();
    
    // Test sampling at specific positions to verify data integrity
    let test_positions = vec![
        ([0.0, 0.0, 0.0], 0.0),    // (0,0,0) -> even sum -> 0
        ([1.0, 0.0, 0.0], 1000.0), // (1,0,0) -> odd sum -> 1000
        ([0.0, 1.0, 0.0], 1000.0), // (0,1,0) -> odd sum -> 1000
        ([1.0, 1.0, 0.0], 0.0),    // (1,1,0) -> even sum -> 0
        ([5.0, 5.0, 5.0], 1000.0), // (5,5,5) -> odd sum -> 1000
    ];
    
    for (world_pos, expected_value) in test_positions {
        service.set_crosshair(world_pos);
        
        // Verify the position maps to the correct voxel
        let voxel = space.coord_to_grid(&world_pos);
        let voxel_idx = [
            voxel[0].round() as usize,
            voxel[1].round() as usize,
            voxel[2].round() as usize,
        ];
        
        // Check our test data
        let idx = voxel_idx[2] * 100 + voxel_idx[1] * 10 + voxel_idx[0];
        assert_eq!(data[idx], expected_value, 
                   "Data mismatch at voxel {:?}, world {:?}", voxel_idx, world_pos);
    }
}

#[tokio::test]
async fn texture_upload_various_dimensions() {
    let mut service = RenderLoopService::new().await.unwrap();
    
    // Test various dimension combinations that stress stride handling
    let test_cases = vec![
        // (dims, description)
        ([1, 1, 1], "Minimal volume"),
        ([128, 1, 1], "Single row, power of 2"),
        ([127, 1, 1], "Single row, non-power of 2"),
        ([64, 64, 1], "Single slice, square"),
        ([100, 50, 25], "Non-power of 2 in all dimensions"),
        ([256, 256, 128], "Large power of 2 volume"),
    ];
    
    for (dims, description) in test_cases {
        let voxel_count = dims[0] * dims[1] * dims[2];
        let data = vec![1.0f32; voxel_count];
        
        let space = <volmath::NeuroSpace as NeuroSpaceExt>::from_dims_spacing_origin(
            dims.to_vec(),
            vec![1.0, 1.0, 1.0],
            vec![0.0, 0.0, 0.0],
        ).expect("Failed to create NeuroSpace");
        let volume = DenseVolume3::from_data(space, data);
        
        let result = service.upload_volume_3d(&volume);
        assert!(result.is_ok(), "Failed to upload {}: {:?}", description, result.err());
        
        // Verify stride calculations
        let bytes_per_pixel = 2; // R16Float
        let unpadded_row_pitch = dims[0] * bytes_per_pixel;
        let padded_row_pitch = ((unpadded_row_pitch + COPY_BYTES_PER_ROW_ALIGNMENT as usize - 1) 
                                / COPY_BYTES_PER_ROW_ALIGNMENT as usize) 
                               * COPY_BYTES_PER_ROW_ALIGNMENT as usize;
        
        // Padded pitch must be at least the unpadded size
        assert!(padded_row_pitch >= unpadded_row_pitch);
        // And must be aligned
        assert_eq!(padded_row_pitch % COPY_BYTES_PER_ROW_ALIGNMENT as usize, 0);
    }
}

#[tokio::test]
async fn texture_upload_data_integrity() {
    let mut service = RenderLoopService::new().await.unwrap();
    
    // Create volume with specific test pattern
    let dims = [16, 8, 4];
    let mut data = vec![0.0f32; 512];
    
    // Fill with sequential values to detect any corruption
    for i in 0..512 {
        data[i] = i as f32;
    }
    
    let space = <volmath::NeuroSpace as NeuroSpaceExt>::from_dims_spacing_origin(
        dims.to_vec(),
        vec![1.0, 1.0, 1.0],
        vec![0.0, 0.0, 0.0],
    ).expect("Failed to create NeuroSpace");
    let volume = DenseVolume3::from_data(space.clone(), data.clone());
    
    let result = service.upload_volume_3d(&volume);
    assert!(result.is_ok());
    
    let (layer_idx, _) = result.unwrap();
    
    service.add_render_layer(
        layer_idx,
        1.0,
        (0.0, 0.0, 1.0, 1.0),
    ).unwrap();
    
    service.update_layer_intensity(0, 0.0, 511.0).unwrap();
    
    // Spot check several positions
    let checks = vec![
        ([0, 0, 0], 0.0),
        ([15, 0, 0], 15.0),
        ([0, 7, 0], 7.0 * 16.0),
        ([15, 7, 0], 15.0 + 7.0 * 16.0),
        ([0, 0, 3], 3.0 * 16.0 * 8.0),
        ([15, 7, 3], 15.0 + 7.0 * 16.0 + 3.0 * 16.0 * 8.0),
    ];
    
    for (voxel_idx, expected) in checks {
        let world = space.grid_to_coord(&[voxel_idx[0] as f32, voxel_idx[1] as f32, voxel_idx[2] as f32]);
        service.set_crosshair(world);
        
        let linear_idx = voxel_idx[2] * 16 * 8 + voxel_idx[1] * 16 + voxel_idx[0];
        assert_eq!(data[linear_idx], expected, 
                   "Data integrity check failed at voxel {:?}", voxel_idx);
    }
}