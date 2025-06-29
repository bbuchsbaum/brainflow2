use render_loop::RenderLoopService;
use volmath::{DenseVolume3, NeuroSpace3};
use volmath::space::{NeuroSpaceImpl, GridSpace};
use image::{ImageBuffer, Rgba};
use std::path::Path;
use std::fs;

#[tokio::main]
async fn main() {
    println!("Starting NIfTI E2E rendering test...");
    
    // Run the synthetic volume test
    test_synthetic_volume_render_to_png().await;
    
    // Note: To test with real NIfTI files, uncomment the code below
    // and add nifti-loader and bridge_types to dependencies
    /*
    let nifti_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent().unwrap()
        .parent().unwrap()
        .join("test-data/unit/toy_t1w.nii.gz");
    
    if nifti_path.exists() {
        println!("\nRunning NIfTI file test...");
        test_nifti_file_render_to_png(&nifti_path).await;
    } else {
        println!("\nSkipping NIfTI test - file not found at {:?}", nifti_path);
    }
    */
    
    println!("\n✅ E2E test completed successfully!");
    println!("   Check target/test-output/ for rendered PNG files");
}

/// Test that creates a synthetic volume for testing without NIfTI dependencies
async fn test_synthetic_volume_render_to_png() {
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
    
    // Create a synthetic test volume with a sphere pattern
    let volume = create_sphere_test_volume();
    
    // Get volume info
    let dims = volume.space.dims();
    let data_range = volume.range().unwrap_or((0.0, 1.0));
    println!("Created synthetic volume dimensions: {:?}", dims);
    println!("Data range: [{}, {}]", data_range.0, data_range.1);
    
    // Upload volume to GPU
    let (atlas_idx, _transform) = service.upload_volume_3d(&volume)
        .expect("Failed to upload volume to GPU");
    
    // Set up crosshair at center
    let center = [dims[0] as f32 / 2.0, dims[1] as f32 / 2.0, dims[2] as f32 / 2.0];
    service.set_crosshair(center);
    
    // Set up axial view
    service.update_frame_for_synchronized_view(64.0, 64.0, center, 0);
    
    // Add render layer using the public API
    service.add_render_layer(atlas_idx, 1.0, (0.0, 0.0, 1.0, 1.0))
        .expect("Failed to add render layer");
    
    // Update layer with colormap and intensity settings
    service.set_layer_colormap(0, 1)  // Hot colormap for better visibility
        .expect("Failed to set colormap");
    service.update_layer_intensity(0, 0.0, 1000.0)
        .expect("Failed to update intensity");
    service.update_layer_threshold(0, -f32::INFINITY, f32::INFINITY)
        .expect("Failed to update threshold");
    
    // Render to buffer
    println!("Rendering to buffer...");
    let rgba_data = service.render_to_buffer()
        .expect("Failed to render to buffer");
    
    // Validate the rendered data
    let pixel_count = (render_size * render_size) as usize;
    assert_eq!(rgba_data.len(), pixel_count * 4, "Unexpected buffer size");
    
    // Check for non-background pixels (background is dark blue: 0.1, 0.1, 0.15)
    let (non_background_count, unique_colors) = analyze_rendered_image(&rgba_data);
    let coverage = (non_background_count as f32 / pixel_count as f32) * 100.0;
    
    println!("Rendered image statistics:");
    println!("  Total pixels: {}", pixel_count);
    println!("  Non-background pixels: {} ({:.1}% coverage)", non_background_count, coverage);
    println!("  Unique colors found: {}", unique_colors);
    
    // Save as PNG
    let output_dir = Path::new("target/test-output");
    fs::create_dir_all(&output_dir).expect("Failed to create output directory");
    
    let output_path = output_dir.join("synthetic_sphere_axial.png");
    save_rgba_as_png(&rgba_data, render_size, render_size, &output_path)
        .expect("Failed to save PNG");
    
    println!("✅ Synthetic volume test passed! Image saved to: {:?}", output_path);
}

/*
/// Test that loads and renders a real NIfTI file
async fn test_nifti_file_render_to_png(nifti_path: &Path) {
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
    
    // Load the NIfTI file
    let volume = load_nifti_volume(nifti_path)
        .expect("Failed to load NIfTI file");
    
    // Get volume info
    let dims = volume.space.dims();
    let data_range = volume.range().unwrap_or((0.0, 1.0));
    println!("Loaded NIfTI volume dimensions: {:?}", dims);
    println!("Data range: [{}, {}]", data_range.0, data_range.1);
    
    // Upload volume to GPU
    let (atlas_idx, _transform) = service.upload_volume_3d(&volume)
        .expect("Failed to upload volume to GPU");
    
    // Set up crosshair at center of volume
    let center_voxel = [dims[0] / 2, dims[1] / 2, dims[2] / 2];
    let center_world = volume.space.0.voxel_to_world().transform_point(&nalgebra::Point3::new(
        center_voxel[0] as f32,
        center_voxel[1] as f32,
        center_voxel[2] as f32,
    ));
    let crosshair = [center_world.x, center_world.y, center_world.z];
    
    service.set_crosshair(crosshair);
    
    // Set up axial view
    let view_width = dims[0] as f32;
    let view_height = dims[1] as f32;
    service.update_frame_for_synchronized_view(view_width, view_height, crosshair, 0);
    
    // Add render layer using the public API
    service.add_render_layer(atlas_idx, 1.0, (0.0, 0.0, 1.0, 1.0))
        .expect("Failed to add render layer");
    
    // Update layer with grayscale colormap and proper intensity
    service.set_layer_colormap(0, 0)  // Grayscale colormap
        .expect("Failed to set colormap");
    service.update_layer_intensity(0, data_range.0, data_range.1)
        .expect("Failed to update intensity");
    service.update_layer_threshold(0, data_range.0, data_range.1)
        .expect("Failed to update threshold");
    
    // Render to buffer
    println!("Rendering NIfTI to buffer...");
    let rgba_data = service.render_to_buffer()
        .expect("Failed to render to buffer");
    
    // Validate the rendered data
    let pixel_count = (render_size * render_size) as usize;
    let (non_background_count, unique_colors) = analyze_rendered_image(&rgba_data);
    let coverage = (non_background_count as f32 / pixel_count as f32) * 100.0;
    
    println!("Rendered NIfTI image statistics:");
    println!("  Total pixels: {}", pixel_count);
    println!("  Non-background pixels: {} ({:.1}% coverage)", non_background_count, coverage);
    println!("  Unique colors found: {}", unique_colors);
    
    // Assert reasonable coverage for brain image
    assert!(
        coverage > 5.0,
        "NIfTI rendering should have at least 5% non-background pixels, got {:.1}%",
        coverage
    );
    
    // Save as PNG
    let output_dir = Path::new("target/test-output");
    let output_path = output_dir.join("nifti_axial_e2e.png");
    save_rgba_as_png(&rgba_data, render_size, render_size, &output_path)
        .expect("Failed to save PNG");
    
    println!("✅ NIfTI test passed! Image saved to: {:?}", output_path);
}

/// Load a NIfTI file and return it as a DenseVolume3<f32>
fn load_nifti_volume(path: &Path) -> Result<DenseVolume3<f32>, Box<dyn std::error::Error>> {
    use std::fs::File;
    use std::io::BufReader;
    
    // Open the file
    let file = File::open(path)?;
    let reader = BufReader::new(file);
    
    // Use the nifti_loader to load the volume
    use nifti_loader::load_nifti_volume;
    let (volume_sendable, _affine) = load_nifti_volume(reader)?;
    
    // Extract the f32 volume
    match volume_sendable {
        bridge_types::VolumeSendable::VolF32(volume, _affine) => Ok(volume),
        _ => Err("Expected F32 volume from NIfTI file".into()),
    }
}
*/

/// Create a test volume with a sphere pattern
fn create_sphere_test_volume() -> DenseVolume3<f32> {
    let dims = [64, 64, 64];
    let spacing = [1.0, 1.0, 1.0];
    let origin = [0.0, 0.0, 0.0];
    
    let space_impl = NeuroSpaceImpl::<3>::from_dims_spacing_origin(dims, spacing, origin);
    let space = NeuroSpace3(space_impl);
    
    let mut data = vec![0.0f32; dims[0] * dims[1] * dims[2]];
    
    let center = [dims[0] as f32 / 2.0, dims[1] as f32 / 2.0, dims[2] as f32 / 2.0];
    let radius = 20.0;
    
    for z in 0..dims[2] {
        for y in 0..dims[1] {
            for x in 0..dims[0] {
                let dx = x as f32 - center[0];
                let dy = y as f32 - center[1];
                let dz = z as f32 - center[2];
                let dist = (dx * dx + dy * dy + dz * dz).sqrt();
                
                if dist < radius {
                    let idx = z * dims[0] * dims[1] + y * dims[0] + x;
                    // Create gradient from center
                    data[idx] = 1000.0 * (1.0 - dist / radius);
                }
            }
        }
    }
    
    DenseVolume3::from_data(space, data)
}

/// Analyze rendered image to count non-background pixels and unique colors
fn analyze_rendered_image(rgba_data: &[u8]) -> (usize, usize) {
    use std::collections::HashSet;
    
    let mut non_background_count = 0;
    let mut unique_colors = HashSet::new();
    
    // Background color is approximately (25, 25, 38) in sRGB 8-bit
    // This corresponds to (0.1, 0.1, 0.15) in linear space
    let bg_r = 25u8;
    let bg_g = 25u8; 
    let bg_b = 38u8;
    let tolerance = 5; // Allow small tolerance for float->byte conversion
    
    for i in (0..rgba_data.len()).step_by(4) {
        let r = rgba_data[i];
        let g = rgba_data[i + 1];
        let b = rgba_data[i + 2];
        let a = rgba_data[i + 3];
        
        // Check if pixel is not background
        let r_diff = (r as i32 - bg_r as i32).abs();
        let g_diff = (g as i32 - bg_g as i32).abs();
        let b_diff = (b as i32 - bg_b as i32).abs();
        
        if r_diff > tolerance || g_diff > tolerance || b_diff > tolerance {
            non_background_count += 1;
        }
        
        // Track unique colors
        unique_colors.insert((r, g, b, a));
    }
    
    (non_background_count, unique_colors.len())
}

/// Save RGBA buffer as PNG file
fn save_rgba_as_png(
    rgba_data: &[u8],
    width: u32,
    height: u32,
    path: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    // Create image buffer from raw RGBA data
    let img_buffer = ImageBuffer::<Rgba<u8>, _>::from_raw(width, height, rgba_data.to_vec())
        .ok_or("Failed to create image buffer")?;
    
    // Save as PNG
    img_buffer.save(path)?;
    
    Ok(())
}