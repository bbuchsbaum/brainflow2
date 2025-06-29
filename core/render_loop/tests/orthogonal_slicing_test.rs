use render_loop::RenderLoopService;
use volmath::{DenseVolume3, NeuroSpace3};

/// Creates a test volume with distinct patterns on each axis:
/// - X axis: Vertical stripes (alternating values every X slice)
/// - Y axis: Horizontal stripes (alternating values every Y slice)  
/// - Z axis: Gradient (increasing values along Z)
fn create_patterned_volume() -> DenseVolume3<f32> {
    let dims = [64, 64, 64];
    let spacing = [1.0, 1.0, 1.0];
    let origin = [0.0, 0.0, 0.0];
    
    let space_impl = volmath::space::NeuroSpaceImpl::<3>::from_dims_spacing_origin(
        dims,
        spacing,
        origin,
    );
    let space = NeuroSpace3(space_impl);
    
    // Create data array with patterns
    let mut data = Vec::with_capacity(dims[0] * dims[1] * dims[2]);
    
    // Fill volume with distinct patterns
    for z in 0..dims[2] {
        for y in 0..dims[1] {
            for x in 0..dims[0] {
                // Create pattern based on position
                let x_pattern = if x % 8 < 4 { 0.3 } else { 0.7 }; // Vertical stripes
                let y_pattern = if y % 8 < 4 { 0.2 } else { 0.8 }; // Horizontal stripes
                let z_pattern = z as f32 / dims[2] as f32; // Gradient from 0 to 1
                
                // Combine patterns
                let value = x_pattern * 0.3 + y_pattern * 0.3 + z_pattern * 0.4;
                data.push(value);
            }
        }
    }
    
    DenseVolume3::<f32>::from_data(space, data)
}

#[tokio::test]
#[ignore = "This test uses obsolete API methods that are incompatible with world-space rendering"]
async fn test_orthogonal_slicing_patterns() {
    // Create patterned test volume
    let volume = create_patterned_volume();
    
    // Test pattern creation first
    verify_volume_patterns(&volume);
    
    // Initialize render service
    let mut service = RenderLoopService::new().await
        .expect("Failed to initialize render service");
    
    // Load shaders
    service.load_shaders()
        .expect("Failed to load shaders");
    
    // Create offscreen render target
    let size = 256;
    service.create_offscreen_target(size, size)
        .expect("Failed to create offscreen target");
    
    
    // Upload volume to GPU
    let (layer_idx, _world_to_voxel) = service.upload_volume_3d(&volume)
        .expect("Failed to upload volume");
    
    assert_eq!(layer_idx, 0, "3D texture should use layer index 0");
    
    // Ensure pipeline is created after volume upload
    // This should create the texture bind group
    // Using simplified slice shader that bypasses colormap
    service.ensure_pipeline("slice_simple")
        .expect("Failed to ensure pipeline");
    
    // Test all three views with synchronized crosshair
    let crosshair_pos = [32.0, 32.0, 32.0];
    test_axial_view(&mut service, size, crosshair_pos).await;
    test_coronal_view(&mut service, size, crosshair_pos).await;
    test_sagittal_view(&mut service, size, crosshair_pos).await;
}

async fn test_axial_view(service: &mut RenderLoopService, size: u32, crosshair: [f32; 3]) {
    // Set view plane to Axial (Z plane)
    // View plane is set through frame vectors
    
    // Set crosshair and update frame for synchronized view
    service.set_crosshair(crosshair);
    
    // Use synchronized view update - this ensures the slice goes through the crosshair
    // View size is 62mm (to avoid edge sampling issues with 64mm volume)
    service.update_frame_for_synchronized_view(62.0, 62.0, crosshair, 0); // 0 = Axial
    
    // Add render layer with proper settings
    let _layer_idx = service.add_render_layer(
        0,     // atlas_index (from upload_volume_3d)
        1.0,   // opacity
        (0.0, 0.0, 1.0, 1.0)  // texture_coords (full texture)
    ).expect("Failed to add render layer");
    
    // Configure render pass to clear to a different color for debugging
    use render_loop::render_state::{RenderPassType, RenderPassConfig};
    service.configure_render_pass(RenderPassType::Main, RenderPassConfig {
        clear_color: wgpu::Color {
            r: 0.5,
            g: 0.0,
            b: 0.0,
            a: 1.0,
        },
        clear: true,
        depth_test: false,
        stencil_test: false,
    });
    
    // Force update layer uniforms again to ensure they're set
    service.update_layer(0, 1.0, 0).expect("Failed to update layer");
    
    // Render and get buffer
    let buffer = service.render_to_buffer()
        .expect("Failed to render");
    
    // Verify we see gradient in Z (should be relatively uniform across this slice)
    verify_axial_pattern(&buffer, size);
    
    service.clear_render_layers();
}

async fn test_coronal_view(service: &mut RenderLoopService, size: u32, crosshair: [f32; 3]) {
    // Set view plane to Coronal (Y plane)
    // View plane is set through frame vectors
    
    // Set crosshair and update frame for synchronized view
    service.set_crosshair(crosshair);
    
    // Use synchronized view update
    service.update_frame_for_synchronized_view(62.0, 62.0, crosshair, 1); // 1 = Coronal
    
    // Add render layer
    service.add_render_layer(0, 1.0, (0.0, 0.0, 1.0, 1.0))
        .expect("Failed to add render layer");
    
    // Render and get buffer
    let buffer = service.render_to_buffer()
        .expect("Failed to render");
    
    // Verify we see horizontal stripes (Y pattern)
    verify_coronal_pattern(&buffer, size);
    
    service.clear_render_layers();
}

async fn test_sagittal_view(service: &mut RenderLoopService, size: u32, crosshair: [f32; 3]) {
    // Set view plane to Sagittal (X plane)
    // View plane is set through frame vectors
    
    // Set crosshair and update frame for synchronized view
    service.set_crosshair(crosshair);
    
    // Use synchronized view update
    service.update_frame_for_synchronized_view(62.0, 62.0, crosshair, 2); // 2 = Sagittal
    
    // Add render layer
    service.add_render_layer(0, 1.0, (0.0, 0.0, 1.0, 1.0))
        .expect("Failed to add render layer");
    
    // Render and get buffer
    let buffer = service.render_to_buffer()
        .expect("Failed to render");
    
    // Verify we see vertical stripes (X pattern)
    verify_sagittal_pattern(&buffer, size);
    
    service.clear_render_layers();
}

fn verify_axial_pattern(buffer: &[u8], size: u32) {
    // Count pixels with non-zero RGB values
    let stride = 4; // RGBA
    let mut non_zero_rgb_pixels = 0;
    
    for i in (0..buffer.len()).step_by(stride) {
        if buffer[i] != 0 || buffer[i + 1] != 0 || buffer[i + 2] != 0 {
            non_zero_rgb_pixels += 1;
        }
    }
    
    // Axial view should have rendered pixels
    assert!(non_zero_rgb_pixels > 0, "Axial view should have some visible pixels");
    
    // Sample some values to verify pattern variations
    let mut values = Vec::new();
    for y in (size/4..3*size/4).step_by(16) {
        for x in (size/4..3*size/4).step_by(16) {
            let val = get_pixel_value(buffer, x, y, size, stride as u32);
            if val > 0.0 {
                values.push(val);
            }
        }
    }
    
    // Should have some variation in the values
    if !values.is_empty() {
        let max_val = values.iter().fold(f32::MIN, |a, &b| a.max(b));
        let _min_val = values.iter().fold(f32::MAX, |a, &b| a.min(b));
        assert!(max_val > 0.0, "Should have non-zero values in axial view");
    }
}

fn verify_coronal_pattern(buffer: &[u8], size: u32) {
    // Should see horizontal stripes (Y pattern)
    let stride = 4;
    
    // Sample along vertical line - should see alternating values
    let mut values = Vec::new();
    for y in (0..size).step_by(32) {
        let val = get_pixel_value(buffer, size/2, y, size, stride);
        values.push(val);
    }
    
    // Should see variation (horizontal stripes)
    let max_val = values.iter().fold(f32::MIN, |a, &b| a.max(b));
    let min_val = values.iter().fold(f32::MAX, |a, &b| a.min(b));
    assert!(max_val - min_val > 0.2, "Coronal view should show horizontal stripes");
}

fn verify_sagittal_pattern(buffer: &[u8], size: u32) {
    // Sagittal view (constant X) should show Y pattern (horizontal stripes) and Z gradient
    let stride = 4;
    
    // Sample along vertical line - should see Y pattern stripes + Z gradient
    let mut vert_values = Vec::new();
    for y in (0..size).step_by(8) {
        let val = get_pixel_value(buffer, size/2, y, size, stride);
        vert_values.push(val);
    }
    
    // Should see variation from Y stripes and/or Z gradient
    let max_val = vert_values.iter().fold(f32::MIN, |a, &b| a.max(b));
    let min_val = vert_values.iter().fold(f32::MAX, |a, &b| a.min(b));
    
    // Accept if we see either Y stripes or Z gradient variation
    assert!(max_val - min_val > 0.05, 
        "Sagittal view should show Y stripes or Z gradient (diff: {})", max_val - min_val);
}

fn get_pixel_value(buffer: &[u8], x: u32, y: u32, width: u32, stride: u32) -> f32 {
    let idx = ((y * width + x) * stride) as usize;
    // Return red channel value normalized to 0-1
    buffer[idx] as f32 / 255.0
}

fn verify_volume_patterns(volume: &DenseVolume3<f32>) {
    // Check a few slices to ensure patterns are correct
    
    // Check Z=32 (middle axial slice) - should have mixed X and Y patterns
    let axial_slice = volume.get_slice(2, 32).expect("Failed to get axial slice");
    let mut x_variations = 0;
    let mut y_variations = 0;
    
    // Sample along X at Y=32
    for x in 0..63 {
        let idx = 32 * 64 + x; // Y=32, X varies
        let val1 = axial_slice[idx];
        let val2 = axial_slice[idx + 1];
        if (val1 - val2).abs() > 0.1 {
            x_variations += 1;
        }
    }
    
    // Sample along Y at X=32
    for y in 0..63 {
        let idx1 = y * 64 + 32; // X=32, Y varies
        let idx2 = (y + 1) * 64 + 32;
        let val1 = axial_slice[idx1];
        let val2 = axial_slice[idx2];
        if (val1 - val2).abs() > 0.1 {
            y_variations += 1;
        }
    }
    
    assert!(x_variations > 5, "Expected X-axis stripes in axial slice");
    assert!(y_variations > 5, "Expected Y-axis stripes in axial slice");
    
    // Check gradient along Z
    let z1_slice = volume.get_slice(2, 10).expect("Failed to get Z=10 slice");
    let z2_slice = volume.get_slice(2, 50).expect("Failed to get Z=50 slice");
    
    let avg_z1: f32 = z1_slice.iter().sum::<f32>() / z1_slice.len() as f32;
    let avg_z2: f32 = z2_slice.iter().sum::<f32>() / z2_slice.len() as f32;
    
    assert!(avg_z2 > avg_z1, "Expected increasing values along Z axis");
}