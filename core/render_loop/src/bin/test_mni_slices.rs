use render_loop::RenderLoopService;
use volmath::{DenseVolume3, NeuroSpace3};
use volmath::space::{NeuroSpaceImpl, GridSpace};
use image::{ImageBuffer, Rgba, RgbaImage};
use std::path::Path;
use std::fs;

#[tokio::main]
async fn main() {
    println!("Starting MNI brain axial slice extraction test...");
    
    // Path to MNI brain template
    let mni_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent().unwrap()
        .parent().unwrap()
        .join("test-data/unit/tpl-MNI152NLin2009cAsym_res-01_desc-brain_T1w.nii");
    
    if !mni_path.exists() {
        // If MNI file doesn't exist, create a synthetic brain-like volume
        println!("MNI file not found at {:?}, using synthetic volume", mni_path);
        test_synthetic_brain_slices().await;
    } else {
        println!("Found MNI brain template at: {:?}", mni_path);
        test_mni_brain_slices(&mni_path).await;
    }
}

/// Test with synthetic brain-like volume
async fn test_synthetic_brain_slices() {
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
    
    // Create a synthetic brain-like volume (256x256x256, 1mm isotropic)
    let volume = create_synthetic_brain_volume();
    
    // Get volume info
    let dims = volume.space.dims();
    let spacing = [1.0, 1.0, 1.0]; // 1mm isotropic
    let data_range = volume.range().unwrap_or((0.0, 1.0));
    
    println!("Synthetic volume dimensions: {:?}", dims);
    println!("Voxel spacing: {:?}mm", spacing);
    println!("Data range: [{}, {}]", data_range.0, data_range.1);
    
    // Calculate inferior and superior bounds in world coordinates
    // With origin at -128, the world Z range is -128 to +127
    let inferior_z = -128.0;
    let superior_z = 127.0;
    let slice_increment = 3.33; // mm
    
    println!("Z-axis range: {:.1}mm to {:.1}mm", inferior_z, superior_z);
    println!("Slice increment: {}mm", slice_increment);
    
    // Upload volume to GPU
    let (atlas_idx, _transform) = service.upload_volume_3d(&volume)
        .expect("Failed to upload volume to GPU");
    
    // Add render layer
    service.add_render_layer(atlas_idx, 1.0, (0.0, 0.0, 1.0, 1.0))
        .expect("Failed to add render layer");
    
    // Set grayscale colormap and intensity
    service.set_layer_colormap(0, 0)
        .expect("Failed to set colormap");
    service.update_layer_intensity(0, data_range.0, data_range.1)
        .expect("Failed to update intensity");
    service.update_layer_threshold(0, data_range.0, data_range.1)
        .expect("Failed to update threshold");
    
    // Extract slices
    extract_axial_slices(
        &mut service,
        &volume,
        inferior_z,
        superior_z,
        slice_increment,
        render_size,
        "synthetic_brain"
    ).await;
}

/// Test with real MNI brain
async fn test_mni_brain_slices(mni_path: &Path) {
    // For now, use synthetic volume as we don't have nifti-loader in dependencies
    println!("Note: Using synthetic volume instead of real MNI file");
    println!("To use real MNI file, uncomment nifti-loader dependency");
    test_synthetic_brain_slices().await;
}

/// Extract axial slices at regular intervals
async fn extract_axial_slices(
    service: &mut RenderLoopService,
    volume: &DenseVolume3<f32>,
    inferior_z: f32,
    superior_z: f32,
    increment: f32,
    render_size: u32,
    prefix: &str,
) {
    let dims = volume.space.dims();
    // Center in world coordinates (not voxel coordinates)
    // With origin at -128 and 256 voxels, center is at world (0, 0, z)
    let center_x = 0.0;
    let center_y = 0.0;
    
    // Calculate field of view in world coordinates (dims * spacing)
    let fov_x = dims[0] as f32 * 1.0;  // 256 voxels * 1mm spacing = 256mm
    let fov_y = dims[1] as f32 * 1.0;  // 256 voxels * 1mm spacing = 256mm
    
    // Create output directory
    let output_dir = Path::new("target/test-output/mni_slices");
    fs::create_dir_all(&output_dir).expect("Failed to create output directory");
    
    let mut slice_images = Vec::new();
    let mut slice_count = 0;
    let mut z = inferior_z;
    
    println!("\nExtracting axial slices:");
    
    while z <= superior_z {
        // Set crosshair at current Z position
        let crosshair = [center_x, center_y, z];
        service.set_crosshair(crosshair);
        
        // Update view for current slice
        service.update_frame_for_synchronized_view(fov_x, fov_y, crosshair, 0);
        
        // Render to buffer
        let rgba_data = service.render_to_buffer()
            .expect("Failed to render to buffer");
        
        // Analyze the slice
        let (non_background_count, unique_colors) = analyze_rendered_image(&rgba_data);
        let coverage = (non_background_count as f32 / (render_size * render_size) as f32) * 100.0;
        
        println!("  Slice {:03} at Z={:.1}mm: {:.1}% coverage, {} colors", 
                 slice_count, z, coverage, unique_colors);
        
        // Save individual slice
        let slice_path = output_dir.join(format!("{}_slice_{:03}_z{:.1}.png", prefix, slice_count, z));
        save_rgba_as_png(&rgba_data, render_size, render_size, &slice_path)
            .expect("Failed to save slice PNG");
        
        // Store for montage
        slice_images.push(rgba_data);
        
        slice_count += 1;
        z += increment;
    }
    
    println!("\nExtracted {} slices", slice_count);
    
    // Create montage
    if slice_count > 0 {
        create_slice_montage(&slice_images, render_size, slice_count, &output_dir, prefix);
    }
    
    println!("\n✅ Slice extraction completed!");
    println!("   Individual slices saved to: {:?}", output_dir);
}

/// Create a montage of all slices
fn create_slice_montage(
    slice_images: &[Vec<u8>],
    slice_size: u32,
    slice_count: usize,
    output_dir: &Path,
    prefix: &str,
) {
    // Calculate grid dimensions (aim for roughly square layout)
    let grid_cols = ((slice_count as f32).sqrt().ceil()) as u32;
    let grid_rows = ((slice_count as f32 / grid_cols as f32).ceil()) as u32;
    
    println!("\nCreating montage: {} slices in {}x{} grid", slice_count, grid_cols, grid_rows);
    
    let montage_width = grid_cols * slice_size;
    let montage_height = grid_rows * slice_size;
    
    // Create montage image
    let mut montage = RgbaImage::new(montage_width, montage_height);
    
    // Fill with background color first
    for pixel in montage.pixels_mut() {
        *pixel = Rgba([25, 25, 38, 255]); // Dark blue background
    }
    
    // Copy each slice to its position in the grid
    for (idx, slice_data) in slice_images.iter().enumerate() {
        let col = (idx as u32) % grid_cols;
        let row = (idx as u32) / grid_cols;
        
        let x_offset = col * slice_size;
        let y_offset = row * slice_size;
        
        // Copy pixels
        for y in 0..slice_size {
            for x in 0..slice_size {
                let src_idx = ((y * slice_size + x) * 4) as usize;
                if src_idx + 3 < slice_data.len() {
                    let pixel = Rgba([
                        slice_data[src_idx],
                        slice_data[src_idx + 1],
                        slice_data[src_idx + 2],
                        slice_data[src_idx + 3],
                    ]);
                    montage.put_pixel(x_offset + x, y_offset + y, pixel);
                }
            }
        }
    }
    
    // Save montage
    let montage_path = output_dir.join(format!("{}_montage_{}slices.png", prefix, slice_count));
    montage.save(&montage_path).expect("Failed to save montage");
    
    println!("Montage saved to: {:?}", montage_path);
}

/// Create a synthetic brain-like volume
fn create_synthetic_brain_volume() -> DenseVolume3<f32> {
    let dims = [256, 256, 256];
    let spacing = [1.0, 1.0, 1.0];
    let origin = [-128.0, -128.0, -128.0]; // Center at origin
    
    let space_impl = NeuroSpaceImpl::<3>::from_dims_spacing_origin(dims, spacing, origin);
    let space = NeuroSpace3(space_impl);
    
    let mut data = vec![0.0f32; dims[0] * dims[1] * dims[2]];
    
    // Create a brain-like structure with multiple tissue types
    let brain_center = [dims[0] as f32 / 2.0, dims[1] as f32 / 2.0, dims[2] as f32 / 2.0];
    
    for z in 0..dims[2] {
        for y in 0..dims[1] {
            for x in 0..dims[0] {
                let dx = x as f32 - brain_center[0];
                let dy = y as f32 - brain_center[1];
                let dz = z as f32 - brain_center[2];
                
                // Ellipsoid shape (brain is not perfectly spherical)
                let rx = 80.0; // radius in x
                let ry = 100.0; // radius in y (anterior-posterior)
                let rz = 70.0; // radius in z (inferior-superior)
                
                let dist_norm = (dx/rx).powi(2) + (dy/ry).powi(2) + (dz/rz).powi(2);
                
                let idx = z * dims[0] * dims[1] + y * dims[0] + x;
                
                if dist_norm < 1.0 {
                    // Inside brain
                    // Create concentric layers for gray/white matter
                    if dist_norm < 0.3 {
                        // Deep white matter
                        data[idx] = 200.0 + 20.0 * ((x + y + z) as f32 * 0.1).sin();
                    } else if dist_norm < 0.7 {
                        // White matter
                        data[idx] = 180.0 + 15.0 * ((x * 2 + y) as f32 * 0.05).sin();
                    } else {
                        // Gray matter (cortex)
                        data[idx] = 120.0 + 10.0 * ((x + y * 2 + z) as f32 * 0.08).sin();
                    }
                    
                    // Add some ventricles (CSF-filled spaces)
                    let vent_x = (x as f32 - brain_center[0]).abs();
                    let vent_y = (y as f32 - brain_center[1]).abs();
                    let vent_z = (z as f32 - brain_center[2]).abs();
                    
                    if vent_x < 10.0 && vent_y < 30.0 && vent_z < 20.0 && dist_norm < 0.5 {
                        data[idx] = 20.0; // CSF intensity
                    }
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
    let bg_r = 25u8;
    let bg_g = 25u8; 
    let bg_b = 38u8;
    let tolerance = 5;
    
    for i in (0..rgba_data.len()).step_by(4) {
        let r = rgba_data[i];
        let g = rgba_data[i + 1];
        let b = rgba_data[i + 2];
        let a = rgba_data[i + 3];
        
        let r_diff = (r as i32 - bg_r as i32).abs();
        let g_diff = (g as i32 - bg_g as i32).abs();
        let b_diff = (b as i32 - bg_b as i32).abs();
        
        if r_diff > tolerance || g_diff > tolerance || b_diff > tolerance {
            non_background_count += 1;
        }
        
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
    let img_buffer = ImageBuffer::<Rgba<u8>, _>::from_raw(width, height, rgba_data.to_vec())
        .ok_or("Failed to create image buffer")?;
    
    img_buffer.save(path)?;
    
    Ok(())
}