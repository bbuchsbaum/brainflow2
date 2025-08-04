use colormap::BuiltinColormap;
use render_loop::RenderLoopService;
use volmath::{DenseVolume3, NeuroSpace3};

/// Creates a gradient volume for testing colormaps
fn create_gradient_volume() -> DenseVolume3<f32> {
    let dims = [64, 64, 64];
    let spacing = [1.0, 1.0, 1.0];
    let origin = [0.0, 0.0, 0.0];

    let space_impl =
        volmath::space::NeuroSpaceImpl::from_dims_spacing_origin(dims, spacing, origin);
    let space = NeuroSpace3::new(space_impl);

    // Create linear gradient from 0 to 1 along X axis
    let mut data = Vec::with_capacity(dims[0] * dims[1] * dims[2]);

    for z in 0..dims[2] {
        for y in 0..dims[1] {
            for x in 0..dims[0] {
                // Create gradient that goes from 0.0 to 1.0 across X
                let value = x as f32 / (dims[0] - 1) as f32;
                data.push(value);
            }
        }
    }

    DenseVolume3::<f32>::from_data(space, data)
}

#[tokio::test]
#[ignore = "This test uses obsolete API methods that are incompatible with world-space rendering"]
async fn test_colormap_switching() {
    // Create gradient volume
    let volume = create_gradient_volume();

    // Initialize render service
    let mut service = RenderLoopService::new()
        .await
        .expect("Failed to initialize render service");

    // Note: This test uses methods that may not be fully compatible with world-space rendering
    // but should still work as the render service handles the compatibility

    // Load shaders
    service.load_shaders().expect("Failed to load shaders");

    // Create offscreen render target
    let size = 256;
    service
        .create_offscreen_target(size, size)
        .expect("Failed to create offscreen target");

    // Upload volume to GPU
    let (layer_idx, _) = service
        .upload_volume_3d(&volume)
        .expect("Failed to upload volume");

    assert_eq!(layer_idx, 0, "Volume should use layer index 0");

    // Let the service use its default pipeline

    // Test different colormaps
    test_grayscale_colormap(&mut service, size).await;
    test_jet_colormap(&mut service, size).await;
    test_viridis_colormap(&mut service, size).await;

    println!("✅ Colormap switching test passed!");
}

async fn test_grayscale_colormap(service: &mut RenderLoopService, size: u32) {
    println!("\nTesting grayscale colormap...");

    // Set up axial view to see the X gradient
    // View plane is set through update_frame_for_synchronized_view
    let crosshair = [32.0, 32.0, 32.0];
    service.set_crosshair(crosshair);
    service.update_frame_for_synchronized_view(64.0, 64.0, crosshair, 0);

    // Add render layer with grayscale colormap
    service
        .add_render_layer(0, 1.0, (0.0, 0.0, 1.0, 1.0))
        .expect("Failed to add render layer");

    // Set intensity range to full data range
    service
        .update_layer_intensity(0, 0.0, 1.0)
        .expect("Failed to update layer intensity");
    service
        .update_layer_threshold(0, 0.0, 1.0)
        .expect("Failed to update layer threshold");

    // Set grayscale colormap
    service
        .set_layer_colormap(0, BuiltinColormap::Grayscale as u32)
        .expect("Failed to set colormap");

    // Render
    let buffer = service.render_to_buffer().expect("Failed to render");

    // Verify grayscale output (R=G=B for all pixels)
    verify_grayscale(&buffer, size);

    service.clear_render_layers();
}

async fn test_jet_colormap(service: &mut RenderLoopService, size: u32) {
    println!("\nTesting jet colormap...");

    // Set up coronal view to see full gradient
    // View plane is set through update_frame_for_synchronized_view
    let crosshair = [32.0, 32.0, 32.0];
    service.set_crosshair(crosshair);
    service.update_frame_for_synchronized_view(64.0, 64.0, crosshair, 1);

    // Add render layer
    service
        .add_render_layer(0, 1.0, (0.0, 0.0, 1.0, 1.0))
        .expect("Failed to add render layer");

    service
        .update_layer_intensity(0, 0.0, 1.0)
        .expect("Failed to update layer intensity");
    service
        .update_layer_threshold(0, 0.0, 1.0)
        .expect("Failed to update layer threshold");

    // Set jet colormap
    service
        .set_layer_colormap(0, BuiltinColormap::Jet as u32)
        .expect("Failed to set colormap");

    // Render
    let buffer = service.render_to_buffer().expect("Failed to render");

    // Verify jet colormap characteristics
    verify_jet_colormap(&buffer, size);

    service.clear_render_layers();
}

async fn test_viridis_colormap(service: &mut RenderLoopService, size: u32) {
    println!("\nTesting viridis colormap...");

    // Set up axial view
    // View plane is set through update_frame_for_synchronized_view
    let crosshair = [32.0, 32.0, 32.0];
    service.set_crosshair(crosshair);
    service.update_frame_for_synchronized_view(64.0, 64.0, crosshair, 0);

    // Add render layer
    service
        .add_render_layer(0, 1.0, (0.0, 0.0, 1.0, 1.0))
        .expect("Failed to add render layer");

    service
        .update_layer_intensity(0, 0.0, 1.0)
        .expect("Failed to update layer intensity");
    service
        .update_layer_threshold(0, 0.0, 1.0)
        .expect("Failed to update layer threshold");

    // Set viridis colormap
    service
        .set_layer_colormap(0, BuiltinColormap::Viridis as u32)
        .expect("Failed to set colormap");

    // Render
    let buffer = service.render_to_buffer().expect("Failed to render");

    // Verify viridis colormap characteristics
    verify_viridis_colormap(&buffer, size);

    service.clear_render_layers();
}

fn verify_grayscale(buffer: &[u8], size: u32) {
    let stride = 4;
    let mut grayscale_count = 0;
    let mut total_pixels = 0;
    let mut non_black_pixels = 0;

    // Check all pixels first to see if anything is rendered
    for i in 0..size * size {
        let idx = (i * stride) as usize;
        let r = buffer[idx];
        let g = buffer[idx + 1];
        let b = buffer[idx + 2];

        if r > 0 || g > 0 || b > 0 {
            non_black_pixels += 1;
        }
    }

    println!(
        "  Total non-black pixels in image: {}/{}",
        non_black_pixels,
        size * size
    );

    // Sample pixels across the image
    for y in (size / 4..3 * size / 4).step_by(16) {
        for x in (size / 4..3 * size / 4).step_by(16) {
            let idx = ((y * size + x) * stride) as usize;
            let r = buffer[idx];
            let g = buffer[idx + 1];
            let b = buffer[idx + 2];

            if r > 0 || g > 0 || b > 0 {
                total_pixels += 1;
                // For grayscale, R should equal G and B
                if r == g && g == b {
                    grayscale_count += 1;
                }
            }
        }
    }

    assert!(non_black_pixels > 0, "No pixels were rendered!");

    let grayscale_ratio = grayscale_count as f32 / total_pixels.max(1) as f32;
    println!(
        "  Grayscale pixels: {}/{} ({:.1}%)",
        grayscale_count,
        total_pixels,
        grayscale_ratio * 100.0
    );

    assert!(
        grayscale_ratio > 0.95,
        "Grayscale colormap should produce R=G=B for all pixels"
    );
}

fn verify_jet_colormap(buffer: &[u8], size: u32) {
    let stride = 4;

    // Sample colors at different positions (jet goes blue->cyan->green->yellow->red)
    let y = size / 2;

    // Sample at 1/5 position (should be bluish)
    let x1 = size / 5;
    let idx1 = ((y * size + x1) * stride) as usize;
    let (r1, g1, b1) = (buffer[idx1], buffer[idx1 + 1], buffer[idx1 + 2]);

    // Sample at center (should be greenish)
    let x2 = size / 2;
    let idx2 = ((y * size + x2) * stride) as usize;
    let (r2, g2, b2) = (buffer[idx2], buffer[idx2 + 1], buffer[idx2 + 2]);

    // Sample at 4/5 position (should be reddish)
    let x3 = 4 * size / 5;
    let idx3 = ((y * size + x3) * stride) as usize;
    let (r3, g3, b3) = (buffer[idx3], buffer[idx3 + 1], buffer[idx3 + 2]);

    println!("  Jet colormap samples:");
    println!("    1/5 position: RGB({}, {}, {})", r1, g1, b1);
    println!("    Center: RGB({}, {}, {})", r2, g2, b2);
    println!("    4/5 position: RGB({}, {}, {})", r3, g3, b3);

    // Verify jet colormap progression
    assert!(b1 > r1, "Early jet values should be more blue than red");
    assert!(g2 > 100, "Middle jet values should have significant green");
    assert!(r3 > b3, "Late jet values should be more red than blue");
}

fn verify_viridis_colormap(buffer: &[u8], size: u32) {
    let stride = 4;

    // Sample colors at different positions
    let y = size / 2;

    // Viridis goes from dark purple/blue to bright yellow/green
    let x1 = size / 4;
    let idx1 = ((y * size + x1) * stride) as usize;
    let (r1, g1, b1) = (buffer[idx1], buffer[idx1 + 1], buffer[idx1 + 2]);

    let x2 = 3 * size / 4;
    let idx2 = ((y * size + x2) * stride) as usize;
    let (r2, g2, b2) = (buffer[idx2], buffer[idx2 + 1], buffer[idx2 + 2]);

    println!("  Viridis colormap samples:");
    println!("    1/4 position: RGB({}, {}, {})", r1, g1, b1);
    println!("    3/4 position: RGB({}, {}, {})", r2, g2, b2);

    // Verify viridis progression (dark to bright)
    let brightness1 = (r1 as u32 + g1 as u32 + b1 as u32) / 3;
    let brightness2 = (r2 as u32 + g2 as u32 + b2 as u32) / 3;

    assert!(
        brightness2 > brightness1,
        "Viridis should progress from dark to bright"
    );

    // Viridis has characteristic green component throughout
    assert!(
        g1 > 0 && g2 > 0,
        "Viridis should have green component throughout"
    );
}

#[tokio::test]
#[ignore = "This test uses obsolete API methods that are incompatible with world-space rendering"]
async fn test_colormap_with_thresholds() {
    // Create volume with specific value ranges
    let volume = create_multi_level_volume();

    // Initialize render service
    let mut service = RenderLoopService::new()
        .await
        .expect("Failed to initialize render service");

    // Note: This test uses the old API

    service.load_shaders().expect("Failed to load shaders");

    service
        .create_offscreen_target(256, 256)
        .expect("Failed to create offscreen target");

    service
        .upload_volume_3d(&volume)
        .expect("Failed to upload volume");

    // Use default pipeline

    // Set up view
    // View plane is set through update_frame_for_synchronized_view
    let crosshair = [32.0, 32.0, 32.0];
    service.set_crosshair(crosshair);
    service.update_frame_for_synchronized_view(64.0, 64.0, crosshair, 0);

    // Test colormap with threshold window
    service
        .add_render_layer(0, 1.0, (0.0, 0.0, 1.0, 1.0))
        .expect("Failed to add render layer");

    // Set narrow intensity window to enhance contrast
    service
        .update_layer_intensity(0, 0.3, 0.7)
        .expect("Failed to update intensity");

    // Set threshold to exclude low values
    service
        .update_layer_threshold(0, 0.2, 1.0)
        .expect("Failed to update threshold");

    // Use hot colormap for clear visualization
    service
        .set_layer_colormap(0, BuiltinColormap::Hot as u32)
        .expect("Failed to set colormap");

    let buffer = service.render_to_buffer().expect("Failed to render");

    verify_threshold_colormap(&buffer, 256);

    println!("✅ Colormap with thresholds test passed!");
}

fn create_multi_level_volume() -> DenseVolume3<f32> {
    let dims = [64, 64, 64];
    let spacing = [1.0, 1.0, 1.0];
    let origin = [0.0, 0.0, 0.0];

    let space_impl =
        volmath::space::NeuroSpaceImpl::from_dims_spacing_origin(dims, spacing, origin);
    let space = NeuroSpace3::new(space_impl);

    // Create concentric squares with different values
    let mut data = Vec::with_capacity(dims[0] * dims[1] * dims[2]);

    for z in 0..dims[2] {
        for y in 0..dims[1] {
            for x in 0..dims[0] {
                let dx = (x as i32 - 32).abs();
                let dy = (y as i32 - 32).abs();
                let dz = (z as i32 - 32).abs();
                let max_dist = dx.max(dy).max(dz);

                let value = match max_dist {
                    0..=8 => 0.9,   // Inner cube
                    9..=16 => 0.5,  // Middle shell
                    17..=24 => 0.3, // Outer shell
                    _ => 0.1,       // Background
                };

                data.push(value);
            }
        }
    }

    DenseVolume3::<f32>::from_data(space, data)
}

fn verify_threshold_colormap(buffer: &[u8], size: u32) {
    let stride = 4;
    let center = size / 2;

    // Check that low values (< 0.2) are not rendered
    let background_x = size / 8;
    let background_y = size / 8;
    let bg_idx = ((background_y * size + background_x) * stride) as usize;
    let bg_value = buffer[bg_idx] as u32 + buffer[bg_idx + 1] as u32 + buffer[bg_idx + 2] as u32;

    assert_eq!(bg_value, 0, "Background (below threshold) should be black");

    // Check that values within threshold are rendered with colormap
    let center_idx = ((center * size + center) * stride) as usize;
    let center_r = buffer[center_idx];
    let center_g = buffer[center_idx + 1];
    let center_b = buffer[center_idx + 2];

    println!(
        "  Threshold colormap - Center RGB({}, {}, {})",
        center_r, center_g, center_b
    );

    assert!(
        center_r > 0 || center_g > 0 || center_b > 0,
        "Center (above threshold) should be visible"
    );
}
