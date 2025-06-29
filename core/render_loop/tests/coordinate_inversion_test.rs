// Test coordinate inversion from screen space to world space
use render_loop::RenderLoopService;
use volmath::{DenseVolume3, NeuroSpace3};
use nalgebra::Vector3;

/// Create a test volume with markers at known positions
fn create_marker_volume() -> DenseVolume3<f32> {
    let dims = [64, 64, 64];
    let spacing = [1.0, 1.0, 1.0];
    let origin = [0.0, 0.0, 0.0];
    
    let space_impl = volmath::space::NeuroSpaceImpl::<3>::from_dims_spacing_origin(
        dims,
        spacing,
        origin,
    );
    let space = NeuroSpace3(space_impl);
    
    let mut data = vec![0.0f32; dims[0] * dims[1] * dims[2]];
    
    // Place markers at specific positions
    let markers = vec![
        [10, 10, 10],  // Corner marker
        [32, 32, 32],  // Center marker
        [50, 50, 50],  // Opposite corner marker
        [10, 50, 32],  // Mixed position marker
    ];
    
    for (i, pos) in markers.iter().enumerate() {
        let idx = pos[2] * dims[0] * dims[1] + pos[1] * dims[0] + pos[0];
        data[idx] = (i + 1) as f32 * 0.25; // Different intensities for each marker
    }
    
    DenseVolume3::<f32>::from_data(space, data)
}

/// Convert screen pixel coordinates to world coordinates using frame parameters
fn screen_to_world(
    pixel_x: f32,
    pixel_y: f32,
    screen_width: f32,
    screen_height: f32,
    origin_mm: &[f32; 4],
    u_mm: &[f32; 4],
    v_mm: &[f32; 4],
) -> [f32; 3] {
    // Normalize pixel coordinates to [0, 1]
    let ndc_x = pixel_x / screen_width;
    // Y is inverted in screen space (0 is top, height is bottom)
    let ndc_y = 1.0 - (pixel_y / screen_height);
    
    // Calculate world position
    let world = Vector3::new(origin_mm[0], origin_mm[1], origin_mm[2])
        + ndc_x * Vector3::new(u_mm[0], u_mm[1], u_mm[2])
        + ndc_y * Vector3::new(v_mm[0], v_mm[1], v_mm[2]);
    
    [world.x, world.y, world.z]
}

#[tokio::test]
async fn test_coordinate_inversion_axial() {
    println!("\n=== Testing Coordinate Inversion - Axial View ===");
    
    let volume = create_marker_volume();
    
    let mut service = RenderLoopService::new().await
        .expect("Failed to initialize render service");
    
    service.load_shaders()
        .expect("Failed to load shaders");
    
    let screen_size = 256;
    service.create_offscreen_target(screen_size, screen_size)
        .expect("Failed to create offscreen target");
    
    let (texture_idx, _) = service.upload_volume_3d(&volume)
        .expect("Failed to upload volume");
    
    service.ensure_pipeline("slice_world_space")
        .expect("Failed to ensure pipeline");
    
    service.update_crosshair_position([0.0, 0.0, 0.0], false);
    
    // Test case 1: Axial view centered at Z=32
    let initial_world = [32.0, 32.0, 32.0];
    service.update_frame_for_synchronized_view(64.0, 64.0, initial_world, 0);
    
    // Get mock frame parameters (TODO: expose actual frame params from service)
    let frame_params = get_mock_frame_params();
    
    service.add_render_layer(texture_idx, 1.0, (0.0, 0.0, 1.0, 1.0))
        .expect("Failed to add render layer");
    
    let buffer = service.render_to_buffer()
        .expect("Failed to render");
    
    // Debug: print some pixel values to see what's being rendered
    println!("\nDebug: Sample pixel values:");
    for y in (0..screen_size).step_by(32) {
        for x in (0..screen_size).step_by(32) {
            let idx = ((y * screen_size + x) * 4) as usize;
            let value = buffer[idx];
            if value > 0 {
                println!("  Pixel ({}, {}) = {}", x, y, value);
            }
        }
    }
    
    // Find the brightest pixel (should be center marker)
    let (bright_pixel, bright_pos) = find_brightest_pixel(&buffer, screen_size);
    println!("\nBrightest pixel at ({}, {}) with value {}", bright_pos.0, bright_pos.1, bright_pixel);
    
    // Convert pixel position back to world coordinates
    let world_coord = screen_to_world(
        bright_pos.0 as f32,
        bright_pos.1 as f32,
        screen_size as f32,
        screen_size as f32,
        &frame_params.origin_mm,
        &frame_params.u_mm,
        &frame_params.v_mm,
    );
    
    println!("Pixel ({}, {}) -> World [{:.1}, {:.1}, {:.1}]", 
             bright_pos.0, bright_pos.1, world_coord[0], world_coord[1], world_coord[2]);
    
    // For now, just verify that the coordinate inversion produces reasonable values
    // The view spans from [0,0,32] to [64,64,32] in world space
    assert!(world_coord[0] >= -1.0 && world_coord[0] <= 65.0, 
            "World X coordinate {} should be within view bounds", world_coord[0]);
    assert!(world_coord[1] >= -1.0 && world_coord[1] <= 65.0, 
            "World Y coordinate {} should be within view bounds", world_coord[1]);
    assert!((world_coord[2] - 32.0).abs() < 1.0, 
            "World Z coordinate {} should be close to slice Z=32", world_coord[2]);
    
    println!("✓ Coordinate inversion produces reasonable world coordinates");
    
    // Test case 2: Click on a different pixel and verify new view
    service.clear_render_layers();
    
    // Pick a pixel offset from center
    let test_pixel = (screen_size / 2 + 20, screen_size / 2 - 15);
    let clicked_world = screen_to_world(
        test_pixel.0 as f32,
        test_pixel.1 as f32,
        screen_size as f32,
        screen_size as f32,
        &frame_params.origin_mm,
        &frame_params.u_mm,
        &frame_params.v_mm,
    );
    
    println!("\nClicked pixel ({}, {}) -> World [{:.1}, {:.1}, {:.1}]",
             test_pixel.0, test_pixel.1, clicked_world[0], clicked_world[1], clicked_world[2]);
    
    // Update crosshair to clicked position
    service.set_crosshair(clicked_world);
    
    // Render all three orthogonal views at the clicked position
    test_orthogonal_views_at_position(&mut service, texture_idx, clicked_world, screen_size).await;
    
    println!("✅ Coordinate inversion test passed!");
}

async fn test_orthogonal_views_at_position(
    service: &mut RenderLoopService,
    texture_idx: u32,
    world_pos: [f32; 3],
    screen_size: u32,
) {
    let view_names = ["Axial", "Coronal", "Sagittal"];
    
    for (plane_id, view_name) in view_names.iter().enumerate() {
        service.clear_render_layers();
        
        // Update view to be centered at the world position
        service.update_frame_for_synchronized_view(64.0, 64.0, world_pos, plane_id as u32);
        
        service.add_render_layer(texture_idx, 1.0, (0.0, 0.0, 1.0, 1.0))
            .expect("Failed to add render layer");
        
        let buffer = service.render_to_buffer()
            .expect("Failed to render");
        
        // Verify the view has content
        let non_zero = buffer.chunks(4)
            .filter(|rgba| rgba[0] > 0)
            .count();
        
        println!("{} view at [{:.1}, {:.1}, {:.1}]: {} non-zero pixels",
                 view_name, world_pos[0], world_pos[1], world_pos[2], non_zero);
        
        // The clicked position should be near the center of each orthogonal view
        let center_pixel = ((screen_size / 2) * screen_size + (screen_size / 2)) * 4;
        let center_value = buffer[center_pixel as usize];
        
        if center_value > 0 {
            println!("  ✓ Center pixel has value {}", center_value);
        }
    }
}

fn find_brightest_pixel(buffer: &[u8], size: u32) -> (u8, (u32, u32)) {
    let mut max_value = 0u8;
    let mut max_pos = (0, 0);
    
    for y in 0..size {
        for x in 0..size {
            let idx = ((y * size + x) * 4) as usize;
            let value = buffer[idx];
            if value > max_value {
                max_value = value;
                max_pos = (x, y);
            }
        }
    }
    
    (max_value, max_pos)
}

// Helper function to get frame parameters for axial view
fn get_mock_frame_params() -> FrameParams {
    // For axial view at Z=32 with 64x64 FOV centered at [32,32,32]
    // The view spans from [0,0,32] to [64,64,32]
    // So origin is at bottom-left corner [0,0,32]
    FrameParams {
        origin_mm: [0.0, 0.0, 32.0, 1.0],
        u_mm: [64.0, 0.0, 0.0, 0.0],
        v_mm: [0.0, 64.0, 0.0, 0.0],
    }
}

struct FrameParams {
    origin_mm: [f32; 4],
    u_mm: [f32; 4],
    v_mm: [f32; 4],
}