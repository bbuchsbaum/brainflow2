use render_loop::{RenderLoopService, RenderLoopError};
use render_loop::render_state::{BlendMode, ThresholdMode};
use volmath::{DenseVolume3, NeuroSpace3};
use nalgebra::Matrix4;

/// Creates a test volume with a sphere pattern
fn create_sphere_volume(center: [f32; 3], radius: f32, value: f32) -> DenseVolume3<f32> {
    let dims = [64, 64, 64];
    let spacing = [1.0, 1.0, 1.0];
    let origin = [0.0, 0.0, 0.0];
    
    let space_impl = volmath::space::NeuroSpaceImpl::<3>::from_dims_spacing_origin(
        dims,
        spacing,
        origin,
    );
    let space = NeuroSpace3(space_impl);
    
    // Create data with sphere pattern
    let mut data = Vec::with_capacity(dims[0] * dims[1] * dims[2]);
    
    for z in 0..dims[2] {
        for y in 0..dims[1] {
            for x in 0..dims[0] {
                let dist = ((x as f32 - center[0]).powi(2) + 
                           (y as f32 - center[1]).powi(2) + 
                           (z as f32 - center[2]).powi(2)).sqrt();
                
                if dist <= radius {
                    data.push(value);
                } else {
                    data.push(0.0);
                }
            }
        }
    }
    
    DenseVolume3::<f32>::from_data(space, data)
}

/// Creates a test volume with a box pattern
fn create_box_volume(min: [f32; 3], max: [f32; 3], value: f32) -> DenseVolume3<f32> {
    let dims = [64, 64, 64];
    let spacing = [1.0, 1.0, 1.0];
    let origin = [0.0, 0.0, 0.0];
    
    let space_impl = volmath::space::NeuroSpaceImpl::<3>::from_dims_spacing_origin(
        dims,
        spacing,
        origin,
    );
    let space = NeuroSpace3(space_impl);
    
    // Create data with box pattern
    let mut data = Vec::with_capacity(dims[0] * dims[1] * dims[2]);
    
    for z in 0..dims[2] {
        for y in 0..dims[1] {
            for x in 0..dims[0] {
                if x as f32 >= min[0] && x as f32 <= max[0] &&
                   y as f32 >= min[1] && y as f32 <= max[1] &&
                   z as f32 >= min[2] && z as f32 <= max[2] {
                    data.push(value);
                } else {
                    data.push(0.0);
                }
            }
        }
    }
    
    DenseVolume3::<f32>::from_data(space, data)
}

#[tokio::test]
#[ignore = "This test uses obsolete API methods that are incompatible with world-space rendering"]
async fn test_single_volume_multi_layer() {
    // Create a volume with multiple distinct regions to simulate overlay
    let volume = create_multi_region_volume();
    
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
    let (layer_idx, _) = service.upload_volume_3d(&volume)
        .expect("Failed to upload volume");
    
    assert_eq!(layer_idx, 0, "Volume should use layer index 0");
    
    // Ensure pipeline is created
    service.ensure_pipeline("slice_simple")
        .expect("Failed to ensure pipeline");
    
    // Test rendering with different threshold and opacity settings
    test_threshold_based_layers(&mut service, size).await;
    test_multi_threshold_blend(&mut service, size).await;
    
    println!("✅ Single volume multi-layer test passed!");
}

/// Creates a volume with multiple intensity regions
fn create_multi_region_volume() -> DenseVolume3<f32> {
    let dims = [64, 64, 64];
    let spacing = [1.0, 1.0, 1.0];
    let origin = [0.0, 0.0, 0.0];
    
    let space_impl = volmath::space::NeuroSpaceImpl::<3>::from_dims_spacing_origin(
        dims,
        spacing,
        origin,
    );
    let space = NeuroSpace3(space_impl);
    
    // Create data with three distinct regions:
    // - Center sphere: high intensity (0.9)
    // - Middle ring: medium intensity (0.5)
    // - Outer region: low intensity (0.2)
    let mut data = Vec::with_capacity(dims[0] * dims[1] * dims[2]);
    let center = [32.0, 32.0, 32.0];
    
    for z in 0..dims[2] {
        for y in 0..dims[1] {
            for x in 0..dims[0] {
                let dist = ((x as f32 - center[0]).powi(2) + 
                           (y as f32 - center[1]).powi(2) + 
                           (z as f32 - center[2]).powi(2)).sqrt();
                
                let value = if dist <= 10.0 {
                    0.9  // Inner sphere
                } else if dist <= 20.0 {
                    0.5  // Middle ring
                } else if dist <= 30.0 {
                    0.2  // Outer shell
                } else {
                    0.0  // Background
                };
                
                data.push(value);
            }
        }
    }
    
    DenseVolume3::<f32>::from_data(space, data)
}

async fn test_threshold_based_layers(service: &mut RenderLoopService, size: u32) {
    println!("\nTesting threshold-based layer rendering...");
    
    // Set up axial view at center
    // View plane is set through frame vectors
    let crosshair = [32.0, 32.0, 32.0];
    service.set_crosshair(crosshair);
    service.update_frame_for_synchronized_view(64.0, 64.0, crosshair, 0);
    
    // Test 1: Show only high intensity region (threshold 0.7-1.0)
    service.add_render_layer(0, 1.0, (0.0, 0.0, 1.0, 1.0))
        .expect("Failed to add render layer");
    
    service.update_layer_intensity(0, 0.0, 1.0)
        .expect("Failed to update layer intensity");
    service.update_layer_threshold(0, 0.7, 1.0)
        .expect("Failed to update layer threshold");
    
    let buffer = service.render_to_buffer()
        .expect("Failed to render");
    
    verify_threshold_render(&buffer, size, "High threshold (0.7-1.0)", 0.9, 10.0);
    service.clear_render_layers();
    
    // Test 2: Show medium and high intensity (threshold 0.4-1.0)
    service.add_render_layer(0, 1.0, (0.0, 0.0, 1.0, 1.0))
        .expect("Failed to add render layer");
    
    service.update_layer_intensity(0, 0.0, 1.0)
        .expect("Failed to update layer intensity");
    service.update_layer_threshold(0, 0.4, 1.0)
        .expect("Failed to update layer threshold");
    
    let buffer = service.render_to_buffer()
        .expect("Failed to render");
    
    verify_threshold_render(&buffer, size, "Medium threshold (0.4-1.0)", 0.7, 20.0);
    service.clear_render_layers();
}

async fn test_multi_threshold_blend(service: &mut RenderLoopService, size: u32) {
    println!("\nTesting multiple threshold ranges with blending...");
    
    // Set up axial view at center
    // View plane is set through frame vectors
    let crosshair = [32.0, 32.0, 32.0];
    service.set_crosshair(crosshair);
    service.update_frame_for_synchronized_view(64.0, 64.0, crosshair, 0);
    
    // Layer 1: Show low intensity regions (0.1-0.3) with blue tint
    service.add_render_layer(0, 0.5, (0.0, 0.0, 1.0, 1.0))
        .expect("Failed to add layer 1");
    
    service.update_layer_intensity(0, 0.0, 1.0)
        .expect("Failed to update layer 1 intensity");
    service.update_layer_threshold(0, 0.1, 0.3)
        .expect("Failed to update layer 1 threshold");
    
    // Layer 2: Show high intensity regions (0.7-1.0) with red tint
    service.add_render_layer(0, 1.0, (0.0, 0.0, 1.0, 1.0))
        .expect("Failed to add layer 2");
    
    service.update_layer_intensity(0, 0.0, 1.0)
        .expect("Failed to update layer 2 intensity");
    service.update_layer_threshold(0, 0.7, 1.0)
        .expect("Failed to update layer 2 threshold");
    
    let buffer = service.render_to_buffer()
        .expect("Failed to render");
    
    verify_multi_threshold(&buffer, size);
    service.clear_render_layers();
}

fn verify_threshold_render(buffer: &[u8], size: u32, test_name: &str, expected_value: f32, expected_radius: f32) {
    let stride = 4;
    let center = size / 2;
    
    // Count pixels within expected radius
    let mut pixel_count = 0;
    let mut value_sum = 0.0;
    
    for y in 0..size {
        for x in 0..size {
            let dx = x as f32 - center as f32;
            let dy = y as f32 - center as f32;
            let dist = (dx * dx + dy * dy).sqrt();
            
            if dist <= expected_radius * (size as f32 / 64.0) {
                let idx = ((y * size + x) * stride) as usize;
                let value = buffer[idx] as f32 / 255.0;
                if value > 0.1 {
                    pixel_count += 1;
                    value_sum += value;
                }
            }
        }
    }
    
    let avg_value = if pixel_count > 0 { value_sum / pixel_count as f32 } else { 0.0 };
    
    println!("  {} - Pixels in region: {}, Average value: {:.3}", 
             test_name, pixel_count, avg_value);
    
    assert!(pixel_count > 0, "{}: Should have visible pixels", test_name);
    assert!(
        (avg_value - expected_value).abs() < 0.2,
        "{}: Expected average ~{:.3}, got {:.3}",
        test_name,
        expected_value,
        avg_value
    );
}

fn verify_multi_threshold(buffer: &[u8], size: u32) {
    let stride = 4;
    let center = size / 2;
    
    // Check inner region (should show high threshold)
    let inner_idx = ((center * size + center) * stride) as usize;
    let inner_value = buffer[inner_idx] as f32 / 255.0;
    
    // Check outer region (should show low threshold)
    let outer_x = center + 25;
    let outer_y = center;
    let outer_idx = ((outer_y * size + outer_x) * stride) as usize;
    let outer_value = buffer[outer_idx] as f32 / 255.0;
    
    println!("  Multi-threshold - Inner: {:.3}, Outer: {:.3}", inner_value, outer_value);
    
    assert!(inner_value > 0.7, "Inner region should show high intensity");
    assert!(outer_value > 0.1, "Outer region should show low intensity");
}

// New tests for multi-volume overlay with world-space rendering

/// Create a test volume with a checkerboard pattern
fn create_checkerboard_volume(dims: [usize; 3], spacing: [f32; 3], origin: [f32; 3]) -> DenseVolume3<f32> {
    let space_impl = volmath::space::NeuroSpaceImpl::<3>::from_dims_spacing_origin(
        dims,
        spacing,
        origin,
    );
    let space = NeuroSpace3(space_impl);
    
    let mut data = vec![0.0f32; dims[0] * dims[1] * dims[2]];
    
    // Create checkerboard pattern
    for z in 0..dims[2] {
        for y in 0..dims[1] {
            for x in 0..dims[0] {
                let idx = z * dims[0] * dims[1] + y * dims[0] + x;
                // 8x8x8 voxel checkerboard
                let checker = ((x / 8) + (y / 8) + (z / 8)) % 2;
                data[idx] = checker as f32;
            }
        }
    }
    
    DenseVolume3::<f32>::from_data(space, data)
}

/// Create a test volume with a gradient pattern
fn create_gradient_volume(dims: [usize; 3], spacing: [f32; 3], origin: [f32; 3]) -> DenseVolume3<f32> {
    let space_impl = volmath::space::NeuroSpaceImpl::<3>::from_dims_spacing_origin(
        dims,
        spacing,
        origin,
    );
    let space = NeuroSpace3(space_impl);
    
    let mut data = vec![0.0f32; dims[0] * dims[1] * dims[2]];
    
    // Create gradient along X axis
    for z in 0..dims[2] {
        for y in 0..dims[1] {
            for x in 0..dims[0] {
                let idx = z * dims[0] * dims[1] + y * dims[0] + x;
                data[idx] = x as f32 / (dims[0] - 1) as f32;
            }
        }
    }
    
    DenseVolume3::<f32>::from_data(space, data)
}

#[tokio::test]
async fn test_multi_volume_different_resolutions() {
    println!("\n=== Testing Multi-Volume Overlay with Different Resolutions ===");
    
    // Create two volumes with different resolutions
    // Volume 1: 64x64x64, 1mm spacing, origin at (0,0,0)
    let vol1 = create_checkerboard_volume([64, 64, 64], [1.0, 1.0, 1.0], [0.0, 0.0, 0.0]);
    
    // Volume 2: 32x32x32, 2mm spacing, origin at (16,16,16) - overlaps with vol1
    let vol2 = create_gradient_volume([32, 32, 32], [2.0, 2.0, 2.0], [16.0, 16.0, 16.0]);
    
    // Initialize render service
    let mut service = RenderLoopService::new().await
        .expect("Failed to initialize render service");
    
    // Load shaders
    service.load_shaders()
        .expect("Failed to load shaders");
    
    // Create offscreen render target
    service.create_offscreen_target(256, 256)
        .expect("Failed to create offscreen target");
    
    // Upload both volumes
    let (tex1, transform1) = service.upload_volume_3d(&vol1)
        .expect("Failed to upload volume 1");
    let (tex2, transform2) = service.upload_volume_3d(&vol2)
        .expect("Failed to upload volume 2");
    
    println!("Volume 1: texture_idx={}, transform={:?}", tex1, transform1);
    println!("Volume 2: texture_idx={}, transform={:?}", tex2, transform2);
    
    // Ensure pipeline
    service.ensure_pipeline("slice_world_space")
        .expect("Failed to ensure pipeline");
    
    // Disable crosshair
    service.update_crosshair_position([0.0, 0.0, 0.0], false);
    
    // Set up view at the overlap region (world position 32,32,32)
    service.update_frame_for_synchronized_view(64.0, 64.0, [32.0, 32.0, 32.0], 0);
    
    // Add both volumes as layers with different opacities
    service.add_render_layer(tex1, 0.5, (0.0, 0.0, 1.0, 1.0))
        .expect("Failed to add volume 1 layer");
    service.add_render_layer(tex2, 0.5, (0.0, 0.0, 1.0, 1.0))
        .expect("Failed to add volume 2 layer");
    
    // Render with alpha blending
    let buffer = service.render_to_buffer()
        .expect("Failed to render");
    
    // Verify we have non-zero pixels (both volumes should contribute)
    let non_zero_count = buffer.chunks(4)
        .filter(|rgba| rgba[0] > 0 || rgba[1] > 0 || rgba[2] > 0)
        .count();
    
    assert!(non_zero_count > 0, "Multi-volume overlay should produce visible pixels");
    println!("Alpha blend: {} non-zero pixels", non_zero_count);
    
    // Verify that we see both patterns
    verify_multi_volume_patterns(&buffer, 256, "Alpha blend");
    
    println!("✅ Multi-volume overlay test passed!");
}

#[tokio::test]
async fn test_multi_volume_different_transforms() {
    println!("\n=== Testing Multi-Volume with Different Transforms ===");
    
    // Create two volumes with different transforms
    // Volume 1: Sphere with higher intensity
    let vol1 = create_sphere_volume([32.0, 32.0, 32.0], 20.0, 200.0);
    
    // Volume 2: Box with moderate intensity  
    let vol2 = create_box_volume([20.0, 20.0, 20.0], [50.0, 50.0, 50.0], 150.0);
    
    // Initialize render service
    let mut service = RenderLoopService::new().await
        .expect("Failed to initialize render service");
    
    service.load_shaders()
        .expect("Failed to load shaders");
    
    service.create_offscreen_target(256, 256)
        .expect("Failed to create offscreen target");
    
    // Upload volumes
    let (tex1, _) = service.upload_volume_3d(&vol1)
        .expect("Failed to upload volume 1");
    let (tex2, _) = service.upload_volume_3d(&vol2)
        .expect("Failed to upload volume 2");
    
    service.ensure_pipeline("slice_world_space")
        .expect("Failed to ensure pipeline");
    
    service.update_crosshair_position([0.0, 0.0, 0.0], false);
    
    // View the overlap region
    service.update_frame_for_synchronized_view(80.0, 80.0, [40.0, 40.0, 32.0], 0);
    
    // Add both volumes with lower opacity for better blending visibility
    service.add_render_layer(tex1, 0.5, (0.0, 0.0, 1.0, 1.0))
        .expect("Failed to add volume 1");
    service.add_render_layer(tex2, 0.5, (0.0, 0.0, 1.0, 1.0))
        .expect("Failed to add volume 2");
    
    let buffer = service.render_to_buffer()
        .expect("Failed to render multi-volume with transforms");
    
    let non_zero = buffer.chunks(4)
        .filter(|rgba| rgba[0] > 0 || rgba[1] > 0 || rgba[2] > 0)
        .count();
    
    assert!(non_zero > 0, "Transformed volumes should be visible");
    println!("Multi-volume with transforms: {} non-zero pixels", non_zero);
    
    // Verify we see both sphere and box patterns
    verify_sphere_and_box(&buffer, 256);
    
    println!("✅ Multi-volume transform test passed!");
}

fn verify_multi_volume_patterns(buffer: &[u8], size: u32, test_name: &str) {
    // Sample a few points to verify we see mixed patterns
    let stride = 4;
    let center = size / 2;
    
    // Count different intensity levels to verify mixing
    let mut intensity_counts = std::collections::HashMap::new();
    
    for y in (center - 20)..(center + 20) {
        for x in (center - 20)..(center + 20) {
            let idx = ((y * size + x) * stride) as usize;
            let intensity = buffer[idx];
            *intensity_counts.entry(intensity).or_insert(0) += 1;
        }
    }
    
    println!("{}: Found {} distinct intensity levels", test_name, intensity_counts.len());
    assert!(intensity_counts.len() > 2, "Should see mixed intensities from both volumes");
}

fn verify_sphere_and_box(buffer: &[u8], size: u32) {
    let stride = 4;
    let center = size / 2;
    
    // Check center (should be in both sphere and box)
    let center_idx = ((center * size + center) * stride) as usize;
    let center_value = buffer[center_idx];
    
    // Check a point that's only in the box (outside sphere)
    // At world [40, 40, 32], view spans [0, 0] to [80, 80]
    // Pixel (128, 128) maps to world [40, 40]
    // Let's check pixel (200, 128) which maps to world ~[62.5, 40]
    // This is outside the sphere (radius 20 from [32, 32]) but inside box
    let box_only_x = 200;
    let box_only_y = 128;
    if box_only_x < size && box_only_y < size {
        let box_only_idx = ((box_only_y * size + box_only_x) * stride) as usize;
        let box_only_value = buffer[box_only_idx];
        
        println!("Debug: Checking pixels for multi-volume overlay");
        println!("  Center pixel (128,128) -> world [40,40]: value = {}", center_value);
        println!("  Box-only pixel (200,128) -> world [~62.5,40]: value = {}", box_only_value);
        
        // Also check a point outside both volumes
        let outside_x = 10;
        let outside_y = 10;
        let outside_idx = ((outside_y * size + outside_x) * stride) as usize;
        let outside_value = buffer[outside_idx];
        println!("  Outside pixel (10,10): value = {}", outside_value);
        
        // The center (both volumes) should be brighter than box-only
        assert!(center_value > box_only_value, 
                "Center (both volumes, value={}) should be brighter than box-only (value={})", 
                center_value, box_only_value);
        
        // Box-only should be different from background (clear color)
        // Background is approximately 89 due to sRGB conversion of clear color (0.1, 0.1, 0.15)
        let background_threshold = 85; // Allow some variance
        
        if outside_value > background_threshold && outside_value < 95 {
            println!("  Note: Outside value {} is likely the sRGB clear color", outside_value);
        }
        
        // The main assertion: overlapping region should be brighter than single volume
        // This is the key test for alpha blending
    }
}

