use render_loop::{RenderLoopService, FrameUbo};
use pollster;
use nalgebra::Matrix4;

#[test]
#[ignore = "Test needs rewrite - uses obsolete API methods"]
fn test_debug_shader_world_coordinate_variation() {
    // Initialize the render loop service
    let mut service = pollster::block_on(RenderLoopService::new()).expect("Failed to create RenderLoopService");
    
    // Create offscreen render target
    let width = 256;
    let height = 256;
    service.create_offscreen_target(width, height).expect("Failed to create offscreen target");
    
    // Set up frame parameters for an axial slice at Z=32
    let frame_ubo = FrameUbo {
        origin_mm: [0.0, 0.0, 32.0, 1.0], // Center at Z=32
        u_mm: [64.0, 0.0, 0.0, 0.0],     // X axis spans 64mm
        v_mm: [0.0, 64.0, 0.0, 0.0],     // Y axis spans 64mm
        atlas_dim: [256, 256, 256],       // Default atlas dimensions
        _padding_frame: 0,
        target_dim: [256, 256],           // Match our render target size
        _padding_target: [0, 0],
    };
    
    // Crosshair and view plane info are now embedded in frame vectors
    // View plane is determined by the orientation of u_mm and v_mm vectors
    
    service.update_frame_ubo(frame_ubo.origin_mm, frame_ubo.u_mm, frame_ubo.v_mm);
    // Crosshair position is now handled differently
    service.update_crosshair_position([0.0, 0.0, 0.0].into(), true);
    
    // Create a simple volume
    use volmath::{DenseVolume3, space::{NeuroSpace3, NeuroSpaceImpl}};
    let dims = [64, 64, 64];
    let mut data = vec![0.0f32; dims[0] * dims[1] * dims[2]];
    
    // Fill with gradient data
    for z in 0..dims[2] {
        for y in 0..dims[1] {
            for x in 0..dims[0] {
                let idx = z * dims[0] * dims[1] + y * dims[0] + x;
                let value = x as f32 + y as f32 * 2.0 + z as f32 * 3.0;
                data[idx] = value;
            }
        }
    }
    
    // Create volume with identity transform
    let transform = Matrix4::identity();
    let space_impl = NeuroSpaceImpl::from_affine_matrix4(dims, transform);
    let space = NeuroSpace3(space_impl);
    let volume = DenseVolume3::from_data(space, data);
    
    // Upload volume
    let (layer_idx, world_to_voxel) = service.upload_volume_3d(&volume)
        .expect("Failed to upload volume");
    
    // Create layer state
    use render_loop::render_state::{LayerInfo, BlendMode, ThresholdMode};
    let layer_info = LayerInfo {
        atlas_index: layer_idx,
        opacity: 1.0,
        blend_mode: BlendMode::Normal,
        colormap_id: 1,
        intensity_range: (0.0, 1000.0),
        threshold_range: (0.0, 1000.0),
        threshold_mode: ThresholdMode::Range,
        texture_coords: (0.0, 0.0, 1.0, 1.0),
    };
    
    // Use proper API to set layer info
    service.update_layer_uniforms_direct(
        &[layer_info],
        &[(64, 64, 64)],
        &[Matrix4::identity()],
    );
    
    // Switch to debug shader
    service.set_shader("slice_debug").expect("Failed to switch to debug shader");
    
    // Render with debug shader
    let debug_image = service.render_to_buffer().expect("Failed to render");
    
    println!("Debug shader render complete. Image size: {} bytes", debug_image.len());
    
    // Analyze the debug output
    // The debug shader outputs world coordinates as RGB:
    // R = world X / 64, G = world Y / 64, B = world Z / 64
    // For an axial slice at Z=32, we expect:
    // - Red gradient from left to right (X varies 0-64)
    // - Green gradient from bottom to top (Y varies 0-64)
    // - Blue constant at ~0.5 (Z=32/64)
    
    // Sample a few pixels to verify coordinate variation
    let get_pixel = |x: usize, y: usize| -> (u8, u8, u8, u8) {
        let idx = (y * width as usize + x) * 4;
        (debug_image[idx], debug_image[idx+1], debug_image[idx+2], debug_image[idx+3])
    };
    
    // Check corners
    let top_left = get_pixel(0, 0);
    let top_right = get_pixel(width as usize - 1, 0);
    let bottom_left = get_pixel(0, height as usize - 1);
    let bottom_right = get_pixel(width as usize - 1, height as usize - 1);
    let center = get_pixel(width as usize / 2, height as usize / 2);
    
    println!("Debug shader pixel values:");
    println!("  Top-left (0,0): {:?}", top_left);
    println!("  Top-right (255,0): {:?}", top_right);
    println!("  Bottom-left (0,255): {:?}", bottom_left);
    println!("  Bottom-right (255,255): {:?}", bottom_right);
    println!("  Center (128,128): {:?}", center);
    
    // Verify that coordinates are varying
    // Red should increase from left to right
    assert!(top_right.0 > top_left.0, "X coordinate not varying horizontally");
    assert!(bottom_right.0 > bottom_left.0, "X coordinate not varying horizontally");
    
    // Green should increase from bottom to top (but in screen space, top is 0)
    // So green should be higher at bottom pixels
    assert!(bottom_left.1 > top_left.1, "Y coordinate not varying vertically");
    assert!(bottom_right.1 > top_right.1, "Y coordinate not varying vertically");
    
    // Blue should be roughly constant at ~128 (0.5 * 255) for Z=32/64
    let expected_blue = (32.0 / 64.0 * 255.0) as u8;
    assert!((top_left.2 as i32 - expected_blue as i32).abs() < 10, "Z coordinate not at expected value");
    assert!((center.2 as i32 - expected_blue as i32).abs() < 10, "Z coordinate not at expected value");
    
    // If all pixels are the same, we have a problem
    if top_left == top_right && top_right == bottom_left && bottom_left == bottom_right {
        panic!("All corners have the same color - coordinates are not varying!");
    }
}

#[test]
#[ignore = "Test needs rewrite - uses obsolete API methods"]
fn test_debug2_shader_voxel_bounds() {
    // Initialize the render loop
    let mut render_loop = pollster::block_on(RenderLoopService::new()).expect("Failed to create RenderLoopService");
    
    // Load all shaders
    render_loop.load_shaders().expect("Failed to load shaders");
    
    // Create offscreen render target
    let width = 256;
    let height = 256;
    render_loop.create_offscreen_target(width, height).expect("Failed to create offscreen target");
    
    // Set up frame parameters for an axial slice at Z=32
    let frame_ubo = FrameUbo {
        origin_mm: [32.0, 32.0, 32.0, 1.0], // Center of 64x64x64 volume
        u_mm: [64.0, 0.0, 0.0, 0.0],       // X axis spans 64mm
        v_mm: [0.0, 64.0, 0.0, 0.0],       // Y axis spans 64mm
        atlas_dim: [256, 256, 256],         // Default atlas dimensions
        _padding_frame: 0,
        target_dim: [256, 256],             // Match our render target size
        _padding_target: [0, 0],
    };
    
    // Crosshair and view plane info are now embedded in frame vectors
    // View plane is determined by the orientation of u_mm and v_mm vectors
    
    render_loop.update_frame_ubo(frame_ubo.origin_mm, frame_ubo.u_mm, frame_ubo.v_mm);
    render_loop.update_crosshair_position([0.0, 0.0, 0.0].into(), true);
    
    // TODO: This test needs complete rewrite - these methods no longer exist:
    // - upload_volume() -> use upload_volume_3d() with DenseVolume3
    // - create_volume_layer() -> use update_layer_uniforms_direct()
    // - store_volume_metadata() -> metadata is part of DenseVolume3
    
    // For now, comment out the obsolete code
    /*
    let volume_data = vec![128u8; 64 * 64 * 64];
    let volume_handle = render_loop.upload_volume(volume_data, 64, 64, 64)
        .expect("Failed to upload volume");
    
    render_loop.create_volume_layer(
        0, volume_handle, 1, 1.0, 0.0, 1000.0, 0, 0.0, 1000.0, 0,
    ).expect("Failed to create layer");
    
    render_loop.store_volume_metadata(
        volume_handle,
        (64, 64, 64),
        Matrix4::identity(),
    );
    */
    
    // Switch to debug2 shader
    render_loop.set_shader("slice_debug2").expect("Failed to switch to debug2 shader");
    
    // Render with debug2 shader
    let debug_image = render_loop.render_to_buffer().expect("Failed to render");
    
    println!("Debug2 shader render complete. Image size: {} bytes", debug_image.len());
    
    // The debug2 shader shows:
    // - Yellow (255,255,0) if no active layers
    // - Blue (0,0,255) if W <= 0
    // - Red/Green/Blue for X/Y/Z out of bounds
    // - Normalized voxel coords as RGB if in bounds
    
    // Sample center pixel - should be in bounds
    let center_x = width as usize / 2;
    let center_y = height as usize / 2;
    let idx = (center_y * width as usize + center_x) * 4;
    let center_color = (debug_image[idx], debug_image[idx+1], debug_image[idx+2], debug_image[idx+3]);
    
    println!("Center pixel color: {:?}", center_color);
    
    // Center should show normalized voxel coords (~0.5, ~0.5, ~0.5) = (~128, ~128, ~128)
    if center_color == (255, 255, 0, 255) {
        panic!("No active layers detected!");
    } else if center_color == (0, 0, 255, 255) {
        panic!("W coordinate issue in transformation!");
    } else if center_color.0 == 255 || center_color.1 == 255 || center_color.2 == 255 {
        panic!("Center pixel is out of bounds!");
    }
    
    // Check that we're getting reasonable voxel coordinates
    let expected = 128; // 0.5 * 255
    assert!((center_color.0 as i32 - expected).abs() < 20, "Unexpected X voxel coordinate");
    assert!((center_color.1 as i32 - expected).abs() < 20, "Unexpected Y voxel coordinate");
    assert!((center_color.2 as i32 - expected).abs() < 20, "Unexpected Z voxel coordinate");
}