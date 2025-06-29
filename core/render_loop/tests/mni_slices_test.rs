use render_loop::RenderLoopService;
use nifti_loader::load_nifti_volume;
use volmath::{Volume, space::GridSpace};
use image::{ImageBuffer, Rgba, RgbaImage, imageops};
use std::path::Path;
use std::fs;

#[tokio::test]
async fn test_mni_brain_slices() {
    println!("Starting MNI brain axial slice extraction test...");
    
    // Path to MNI brain template - go up to workspace root then to test-data
    let workspace_root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent().unwrap()  // core/
        .parent().unwrap(); // brainflow2/
    
    let mni_path = workspace_root
        .join("test-data/unit/tpl-MNI152NLin2009cAsym_res-01_desc-brain_T1w.nii");
    
    println!("Looking for MNI file at: {:?}", mni_path);
    
    if !mni_path.exists() {
        eprintln!("MNI file not found at {:?}", mni_path);
        eprintln!("Current directory: {:?}", std::env::current_dir());
        eprintln!("CARGO_MANIFEST_DIR: {}", env!("CARGO_MANIFEST_DIR"));
        
        // Try alternative path
        let alt_path = Path::new("../../test-data/unit/tpl-MNI152NLin2009cAsym_res-01_desc-brain_T1w.nii");
        if alt_path.exists() {
            eprintln!("Found at alternative path: {:?}", alt_path);
        }
        
        eprintln!("Skipping test - MNI file not found");
        return;
    }
    
    println!("Loading MNI brain template from: {:?}", mni_path);
    
    // Load the NIfTI file using the existing loader
    let file = std::fs::File::open(&mni_path).expect("Failed to open file");
    let reader = std::io::BufReader::new(file);
    
    let (volume_sendable, affine) = load_nifti_volume(reader)
        .expect("Failed to load NIfTI file");
    
    // Extract the DenseVolume3<f32>
    let volume = match volume_sendable {
        bridge_types::VolumeSendable::VolF32(vol, _) => vol,
        _ => panic!("Expected f32 volume from MNI template"),
    };
    
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
    
    // Get volume info
    let dims = volume.space.dims();
    let data_range = volume.range().unwrap_or((0.0, 1.0));
    
    println!("MNI volume dimensions: {:?}", dims);
    println!("Data range: [{}, {}]", data_range.0, data_range.1);
    
    // Get world bounds from the volume's space
    let origin = volume.space.0.origin();
    let spacing = volume.space.0.spacing();
    let world_min = origin;
    let world_max = [
        origin[0] + (dims[0] as f32 - 1.0) * spacing[0],
        origin[1] + (dims[1] as f32 - 1.0) * spacing[1],
        origin[2] + (dims[2] as f32 - 1.0) * spacing[2],
    ];
    
    println!("World bounds: [{:.1}, {:.1}, {:.1}] to [{:.1}, {:.1}, {:.1}]",
             world_min[0], world_min[1], world_min[2],
             world_max[0], world_max[1], world_max[2]);
    
    // Calculate center in world coordinates
    let center_x = (world_min[0] + world_max[0]) / 2.0;
    let center_y = (world_min[1] + world_max[1]) / 2.0;
    
    // Set up slice parameters
    let inferior_z = world_min[2];
    let superior_z = world_max[2];
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
    
    // Calculate field of view in world coordinates
    let fov_x = (world_max[0] - world_min[0]) * 1.2; // Add 20% padding
    let fov_y = (world_max[1] - world_min[1]) * 1.2; // Add 20% padding
    
    // Create output directory
    let output_dir = Path::new("target/test-output/mni_real");
    fs::create_dir_all(&output_dir).expect("Failed to create output directory");
    
    // Extract axial slices
    println!("\nExtracting axial slices:");
    let mut slice_count = 0;
    let mut z = inferior_z;
    
    while z <= superior_z && slice_count < 5 {
        let crosshair = [center_x, center_y, z];
        service.set_crosshair(crosshair);
        service.update_frame_for_synchronized_view(fov_x, fov_y, crosshair, 0); // 0 = axial
        
        let rgba_data = service.render_to_buffer()
            .expect("Failed to render to buffer");
        
        let slice_path = output_dir.join(format!("mni_axial_{:03}_z{:.1}.png", slice_count, z));
        save_rgba_as_png(&rgba_data, render_size, render_size, &slice_path, false) // No flip for axial
            .expect("Failed to save slice PNG");
        
        println!("  Saved axial slice {} at Z={:.1}mm", slice_count, z);
        slice_count += 1;
        z += slice_increment * 10.0;
    }
    
    // Extract coronal slices (plane_id = 1, shows XZ plane, changes along Y)
    println!("\nExtracting coronal slices:");
    slice_count = 0;
    let mut y = world_min[1];
    let y_increment = 10.0; // mm
    
    // Calculate FOV for coronal view (X-Z plane)
    let fov_x_cor = (world_max[0] - world_min[0]) * 1.2;
    let fov_z_cor = (world_max[2] - world_min[2]) * 1.2;
    
    while y <= world_max[1] && slice_count < 5 {
        let crosshair = [center_x, y, (inferior_z + superior_z) / 2.0];
        service.set_crosshair(crosshair);
        // For coronal, the view center should follow the Y coordinate
        let view_center = [center_x, y, (inferior_z + superior_z) / 2.0];
        service.update_frame_for_synchronized_view(fov_x_cor, fov_z_cor, view_center, 1); // 1 = coronal
        
        let rgba_data = service.render_to_buffer()
            .expect("Failed to render to buffer");
        
        let slice_path = output_dir.join(format!("mni_coronal_{:03}_y{:.1}.png", slice_count, y));
        save_rgba_as_png(&rgba_data, render_size, render_size, &slice_path, true) // Flip vertical for coronal
            .expect("Failed to save slice PNG");
        
        println!("  Saved coronal slice {} at Y={:.1}mm", slice_count, y);
        slice_count += 1;
        y += y_increment * 5.0;
    }
    
    // Extract sagittal slices (plane_id = 2, shows YZ plane, changes along X)
    println!("\nExtracting sagittal slices:");
    slice_count = 0;
    let mut x = world_min[0];
    let x_increment = 10.0; // mm
    
    // Calculate FOV for sagittal view (Y-Z plane)
    let fov_y_sag = (world_max[1] - world_min[1]) * 1.2;
    let fov_z_sag = (world_max[2] - world_min[2]) * 1.2;
    
    while x <= world_max[0] && slice_count < 5 {
        let crosshair = [x, center_y, (inferior_z + superior_z) / 2.0];
        service.set_crosshair(crosshair);
        // For sagittal, the view center should follow the X coordinate
        let view_center = [x, center_y, (inferior_z + superior_z) / 2.0];
        service.update_frame_for_synchronized_view(fov_y_sag, fov_z_sag, view_center, 2); // 2 = sagittal
        
        let rgba_data = service.render_to_buffer()
            .expect("Failed to render to buffer");
        
        let slice_path = output_dir.join(format!("mni_sagittal_{:03}_x{:.1}.png", slice_count, x));
        save_rgba_as_png(&rgba_data, render_size, render_size, &slice_path, true) // Flip vertical for sagittal
            .expect("Failed to save slice PNG");
        
        println!("  Saved sagittal slice {} at X={:.1}mm", slice_count, x);
        slice_count += 1;
        x += x_increment * 5.0;
    }
    
    println!("\n✅ MNI test completed! Check {:?}", output_dir);
    println!("   Generated axial, sagittal, and coronal slices");
}

fn save_rgba_as_png(
    rgba_data: &[u8],
    width: u32,
    height: u32,
    path: &Path,
    flip_vertical: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut img_buffer = ImageBuffer::<Rgba<u8>, _>::from_raw(width, height, rgba_data.to_vec())
        .ok_or("Failed to create image buffer")?;
    
    if flip_vertical {
        // Flip the image vertically to correct orientation
        img_buffer = imageops::flip_vertical(&img_buffer);
    }
    
    img_buffer.save(path)?;
    
    Ok(())
}