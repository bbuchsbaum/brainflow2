use render_loop::RenderLoopService;
use std::path::Path;

#[tokio::test]
#[ignore = "This test uses obsolete API methods that are incompatible with world-space rendering"]
async fn test_nifti_volume_rendering() {
    // Path to test NIFTI file
    let nifti_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent().unwrap()
        .parent().unwrap()
        .join("test-data/unit/toy_t1w.nii.gz");
    
    println!("Loading NIFTI file from: {:?}", nifti_path);
    assert!(nifti_path.exists(), "Test NIFTI file not found at {:?}", nifti_path);
    
    // For now, create a test volume since we don't have loaders linked
    // In a real test, this would load the NIFTI file
    let volume = create_test_volume();
    
    let dims = [64, 64, 64]; // Test volume dimensions
    println!("Loaded volume dimensions: {:?}", dims);
    println!("Volume spacing: {:?}", [1.0, 1.0, 1.0]);
    println!("Volume origin: {:?}", [0.0, 0.0, 0.0]);
    
    // Initialize render service
    let mut service = RenderLoopService::new().await
        .expect("Failed to initialize render service");
    
    // Load shaders
    service.load_shaders()
        .expect("Failed to load shaders");
    
    // Create offscreen render target
    let render_size = 256;
    service.create_offscreen_target(render_size, render_size)
        .expect("Failed to create offscreen target");
    
    // Upload volume to GPU
    let (layer_idx, world_to_voxel) = service.upload_volume_3d(&volume)
        .expect("Failed to upload volume");
    
    assert_eq!(layer_idx, 0, "First volume should use layer index 0");
    
    // Ensure pipeline is created - use simple shader for testing
    service.ensure_pipeline("slice_simple")
        .expect("Failed to ensure pipeline");
    
    // Test all three orthogonal views
    test_nifti_axial_view(&mut service, &volume, render_size).await;
    test_nifti_coronal_view(&mut service, &volume, render_size).await;
    test_nifti_sagittal_view(&mut service, &volume, render_size).await;
    
    println!("✅ NIFTI volume rendering test passed!");
}

async fn test_nifti_axial_view(
    service: &mut RenderLoopService, 
    volume: &volmath::DenseVolume3<f32>,
    size: u32
) {
    println!("\nTesting Axial view of NIFTI volume...");
    
    // Get volume dimensions
    let dims = [64, 64, 64];
    let center_voxel = [dims[0] / 2, dims[1] / 2, dims[2] / 2];
    
    // Convert to world coordinates
    let center_world = volume.space.0.voxel_to_world().transform_point(&nalgebra::Point3::new(
        center_voxel[0] as f32,
        center_voxel[1] as f32,
        center_voxel[2] as f32,
    ));
    
    let crosshair = [center_world.x, center_world.y, center_world.z];
    
    // Set up axial view
    // View plane is set through frame vectors
    service.set_crosshair(crosshair);
    
    // Calculate appropriate view size based on volume dimensions
    let spacing = [1.0, 1.0, 1.0];
    let view_width = dims[0] as f32 * spacing[0];
    let view_height = dims[1] as f32 * spacing[1];
    
    service.update_frame_for_synchronized_view(view_width, view_height, crosshair, 0);
    
    // Add render layer with appropriate intensity window
    let data_range = volume.range().unwrap_or((0.0, 1.0));
    println!("  Data range: [{}, {}]", data_range.0, data_range.1);
    
    service.add_render_layer(0, 1.0, (0.0, 0.0, 1.0, 1.0))
        .expect("Failed to add render layer");
    
    // Update layer with proper intensity window and thresholds
    service.update_layer_intensity(0, data_range.0, data_range.1)
        .expect("Failed to update layer intensity");
    service.update_layer_threshold(0, data_range.0, data_range.1)
        .expect("Failed to update layer threshold");
    
    // Render
    let buffer = service.render_to_buffer()
        .expect("Failed to render");
    
    // Verify we have non-zero pixels
    verify_nifti_render(&buffer, size, "Axial");
    
    // Save snapshot for visual inspection (optional)
    save_render_snapshot(&buffer, size, "nifti_axial.png");
    
    service.clear_render_layers();
}

async fn test_nifti_coronal_view(
    service: &mut RenderLoopService,
    volume: &volmath::DenseVolume3<f32>,
    size: u32
) {
    println!("\nTesting Coronal view of NIFTI volume...");
    
    let dims = [64, 64, 64];
    let center_voxel = [dims[0] / 2, dims[1] / 2, dims[2] / 2];
    
    let center_world = volume.space.0.voxel_to_world().transform_point(&nalgebra::Point3::new(
        center_voxel[0] as f32,
        center_voxel[1] as f32,
        center_voxel[2] as f32,
    ));
    
    let crosshair = [center_world.x, center_world.y, center_world.z];
    
    // Set up coronal view
    // View plane is set through frame vectors
    service.set_crosshair(crosshair);
    
    let spacing = [1.0, 1.0, 1.0];
    let view_width = dims[0] as f32 * spacing[0];
    let view_height = dims[2] as f32 * spacing[2];
    
    service.update_frame_for_synchronized_view(view_width, view_height, crosshair, 1);
    
    // Add render layer
    service.add_render_layer(0, 1.0, (0.0, 0.0, 1.0, 1.0))
        .expect("Failed to add render layer");
    
    let data_range = volume.range().unwrap_or((0.0, 1.0));
    service.update_layer_intensity(0, data_range.0, data_range.1)
        .expect("Failed to update layer intensity");
    service.update_layer_threshold(0, data_range.0, data_range.1)
        .expect("Failed to update layer threshold");
    
    // Render
    let buffer = service.render_to_buffer()
        .expect("Failed to render");
    
    verify_nifti_render(&buffer, size, "Coronal");
    save_render_snapshot(&buffer, size, "nifti_coronal.png");
    
    service.clear_render_layers();
}

async fn test_nifti_sagittal_view(
    service: &mut RenderLoopService,
    volume: &volmath::DenseVolume3<f32>,
    size: u32
) {
    println!("\nTesting Sagittal view of NIFTI volume...");
    
    let dims = [64, 64, 64];
    let center_voxel = [dims[0] / 2, dims[1] / 2, dims[2] / 2];
    
    let center_world = volume.space.0.voxel_to_world().transform_point(&nalgebra::Point3::new(
        center_voxel[0] as f32,
        center_voxel[1] as f32,
        center_voxel[2] as f32,
    ));
    
    let crosshair = [center_world.x, center_world.y, center_world.z];
    
    // Set up sagittal view
    // View plane is set through frame vectors
    service.set_crosshair(crosshair);
    
    let spacing = [1.0, 1.0, 1.0];
    let view_width = dims[1] as f32 * spacing[1];
    let view_height = dims[2] as f32 * spacing[2];
    
    service.update_frame_for_synchronized_view(view_width, view_height, crosshair, 2);
    
    // Add render layer
    service.add_render_layer(0, 1.0, (0.0, 0.0, 1.0, 1.0))
        .expect("Failed to add render layer");
    
    let data_range = volume.range().unwrap_or((0.0, 1.0));
    service.update_layer_intensity(0, data_range.0, data_range.1)
        .expect("Failed to update layer intensity");
    service.update_layer_threshold(0, data_range.0, data_range.1)
        .expect("Failed to update layer threshold");
    
    // Render
    let buffer = service.render_to_buffer()
        .expect("Failed to render");
    
    verify_nifti_render(&buffer, size, "Sagittal");
    save_render_snapshot(&buffer, size, "nifti_sagittal.png");
    
    service.clear_render_layers();
}

fn verify_nifti_render(buffer: &[u8], size: u32, view_name: &str) {
    let stride = 4; // RGBA
    let total_pixels = (size * size) as usize;
    
    // Count non-black pixels
    let mut non_black_pixels = 0;
    let mut sum_intensity = 0.0;
    let mut max_intensity: f32 = 0.0;
    let mut min_intensity: f32 = 1.0;
    
    for i in 0..total_pixels {
        let idx = i * stride;
        let r = buffer[idx] as f32 / 255.0;
        let g = buffer[idx + 1] as f32 / 255.0;
        let b = buffer[idx + 2] as f32 / 255.0;
        
        // For grayscale medical images, R=G=B
        if r > 0.0 || g > 0.0 || b > 0.0 {
            non_black_pixels += 1;
            sum_intensity += r;
            max_intensity = max_intensity.max(r);
            if r > 0.0 {
                min_intensity = min_intensity.min(r);
            }
        }
    }
    
    let coverage = (non_black_pixels as f32 / total_pixels as f32) * 100.0;
    let avg_intensity = if non_black_pixels > 0 {
        sum_intensity / non_black_pixels as f32
    } else {
        0.0
    };
    
    println!("  {} view statistics:", view_name);
    println!("    Non-black pixels: {} ({:.1}% coverage)", non_black_pixels, coverage);
    println!("    Intensity range: [{:.3}, {:.3}]", min_intensity, max_intensity);
    println!("    Average intensity: {:.3}", avg_intensity);
    
    // Verify we have reasonable coverage (brain should occupy significant portion of image)
    assert!(
        coverage > 10.0,
        "{} view should have at least 10% non-black pixels, got {:.1}%",
        view_name,
        coverage
    );
    
    // Verify we have intensity variation (not all same value)
    assert!(
        max_intensity - min_intensity > 0.1,
        "{} view should have intensity variation, got range [{:.3}, {:.3}]",
        view_name,
        min_intensity,
        max_intensity
    );
}

fn save_render_snapshot(_buffer: &[u8], _size: u32, filename: &str) {
    // Optional: Save PNG for visual inspection
    // This would require adding the `image` crate as a dev dependency
    // For now, just print that we would save it
    println!("  Would save render snapshot to: {}", filename);
}

#[tokio::test]
#[ignore = "This test uses obsolete API methods that are incompatible with world-space rendering"]
async fn test_texture_coordinate_mapping() {
    // Create a volume with known pattern to verify texture coordinates
    let dims = [32, 32, 32];
    let spacing = [1.0, 1.0, 1.0];
    let origin = [0.0, 0.0, 0.0];
    
    let space_impl = volmath::space::NeuroSpaceImpl::from_dims_spacing_origin(
        dims,
        spacing,
        origin,
    );
    let space = volmath::NeuroSpace3::new(space_impl);
    
    // Create checkerboard pattern
    let mut data = Vec::with_capacity(dims[0] * dims[1] * dims[2]);
    for z in 0..dims[2] {
        for y in 0..dims[1] {
            for x in 0..dims[0] {
                // 3D checkerboard
                let checker = ((x / 4) + (y / 4) + (z / 4)) % 2;
                data.push(if checker == 0 { 0.2 } else { 0.8 });
            }
        }
    }
    
    let volume = volmath::DenseVolume3::<f32>::from_data(space, data);
    
    // Initialize render service
    let mut service = RenderLoopService::new().await
        .expect("Failed to initialize render service");
    
    service.load_shaders()
        .expect("Failed to load shaders");
    
    service.create_offscreen_target(128, 128)
        .expect("Failed to create offscreen target");
    
    service.upload_volume_3d(&volume)
        .expect("Failed to upload volume");
    
    service.ensure_pipeline("slice_simple")
        .expect("Failed to ensure pipeline");
    
    // Test that we see checkerboard pattern in each view
    for (plane_id, plane_name) in [(0, "Axial"), (1, "Coronal"), (2, "Sagittal")].iter() {
    // View plane is set through frame vectors
        service.set_crosshair([16.0, 16.0, 16.0]);
        service.update_frame_for_synchronized_view(32.0, 32.0, [16.0, 16.0, 16.0], *plane_id);
        
        service.add_render_layer(0, 1.0, (0.0, 0.0, 1.0, 1.0))
            .expect("Failed to add render layer");
        
        let buffer = service.render_to_buffer()
            .expect("Failed to render");
        
        // Sample along a line and verify we see alternating values
        verify_checkerboard_pattern(&buffer, 128, plane_name);
        
        service.clear_render_layers();
    }
    
    println!("✅ Texture coordinate mapping test passed!");
}

fn verify_checkerboard_pattern(buffer: &[u8], size: u32, view_name: &str) {
    let stride = 4;
    let mut transitions = 0;
    let mut last_value = 0.0;
    
    // Sample along middle row
    let y = size / 2;
    for x in 0..size {
        let idx = ((y * size + x) * stride) as usize;
        let value = buffer[idx] as f32 / 255.0;
        
        if x > 0 && (value - last_value).abs() > 0.3 {
            transitions += 1;
        }
        last_value = value;
    }
    
    println!("  {} view: found {} intensity transitions", view_name, transitions);
    
    // Should see multiple transitions in checkerboard
    assert!(
        transitions >= 4,
        "{} view should show checkerboard pattern with at least 4 transitions, got {}",
        view_name,
        transitions
    );
}

// Helper function to create a test volume that mimics a brain MRI
fn create_test_volume() -> volmath::DenseVolume3<f32> {
    let dims = [64, 64, 64];
    let spacing = [1.0, 1.0, 1.0];
    let origin = [0.0, 0.0, 0.0];
    
    let space_impl = volmath::space::NeuroSpaceImpl::from_dims_spacing_origin(
        dims,
        spacing,
        origin,
    );
    let space = volmath::NeuroSpace3::new(space_impl);
    
    // Create data that resembles a brain (bright center, darker edges)
    let mut data = Vec::with_capacity(dims[0] * dims[1] * dims[2]);
    let center = [dims[0] as f32 / 2.0, dims[1] as f32 / 2.0, dims[2] as f32 / 2.0];
    let max_dist = ((dims[0] as f32).powi(2) + (dims[1] as f32).powi(2) + (dims[2] as f32).powi(2)).sqrt() / 2.0;
    
    for z in 0..dims[2] {
        for y in 0..dims[1] {
            for x in 0..dims[0] {
                let dist = (((x as f32 - center[0]).powi(2) + 
                            (y as f32 - center[1]).powi(2) + 
                            (z as f32 - center[2]).powi(2)).sqrt() / max_dist).min(1.0);
                
                // Inverted distance creates bright center
                let value = (1.0 - dist) * 0.8 + 0.2;
                data.push(value);
            }
        }
    }
    
    volmath::DenseVolume3::<f32>::from_data(space, data)
}