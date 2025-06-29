use render_loop::RenderLoopService;
use nifti_loader::load_nifti_volume;
use volmath::{Volume, space::GridSpace};
use image::{ImageBuffer, Rgba, RgbaImage, imageops};
use std::path::Path;
use std::fs;

#[tokio::test]
async fn test_mni_brain_slices_fixed_orientation() {
    println!("Starting MNI brain slice extraction with fixed orientation...");
    
    // Path to MNI brain template
    let workspace_root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent().unwrap()
        .parent().unwrap();
    
    let mni_path = workspace_root
        .join("test-data/unit/tpl-MNI152NLin2009cAsym_res-01_desc-brain_T1w.nii");
    
    if !mni_path.exists() {
        eprintln!("MNI file not found at {:?}", mni_path);
        return;
    }
    
    println!("Loading MNI brain template from: {:?}", mni_path);
    
    // Load the NIfTI file
    let file = std::fs::File::open(&mni_path).expect("Failed to open file");
    let reader = std::io::BufReader::new(file);
    
    let (volume_sendable, _affine) = load_nifti_volume(reader)
        .expect("Failed to load NIfTI file");
    
    let volume = match volume_sendable {
        bridge_types::VolumeSendable::VolF32(vol, _) => vol,
        _ => panic!("Expected f32 volume from MNI template"),
    };
    
    // Initialize render service
    let mut service = RenderLoopService::new().await
        .expect("Failed to initialize render service");
    
    service.load_shaders()
        .expect("Failed to load shaders");
    
    let render_size = 256;
    service.create_offscreen_target(render_size, render_size)
        .expect("Failed to create offscreen target");
    
    // Get volume info
    let dims = volume.space.dims();
    let data_range = volume.range().unwrap_or((0.0, 1.0));
    
    // Get world bounds
    let origin = volume.space.0.origin();
    let spacing = volume.space.0.spacing();
    let world_min = origin;
    let world_max = [
        origin[0] + (dims[0] as f32 - 1.0) * spacing[0],
        origin[1] + (dims[1] as f32 - 1.0) * spacing[1],
        origin[2] + (dims[2] as f32 - 1.0) * spacing[2],
    ];
    
    let center_x = (world_min[0] + world_max[0]) / 2.0;
    let center_y = (world_min[1] + world_max[1]) / 2.0;
    
    // Upload volume to GPU
    let (atlas_idx, _transform) = service.upload_volume_3d(&volume)
        .expect("Failed to upload volume to GPU");
    
    service.add_render_layer(atlas_idx, 1.0, (0.0, 0.0, 1.0, 1.0))
        .expect("Failed to add render layer");
    
    service.set_layer_colormap(0, 0)
        .expect("Failed to set colormap");
    service.update_layer_intensity(0, data_range.0, data_range.1)
        .expect("Failed to update intensity");
    service.update_layer_threshold(0, data_range.0, data_range.1)
        .expect("Failed to update threshold");
    
    // Create output directory
    let output_dir = Path::new("target/test-output/mni_fixed");
    fs::create_dir_all(&output_dir).expect("Failed to create output directory");
    
    // Extract one slice from each orientation
    println!("\nExtracting test slices with orientation fixes:");
    
    // Axial slice (should be correct already)
    let z = (world_min[2] + world_max[2]) / 2.0;
    service.set_crosshair([center_x, center_y, z]);
    let fov_x = (world_max[0] - world_min[0]) * 1.2;
    let fov_y = (world_max[1] - world_min[1]) * 1.2;
    service.update_frame_for_synchronized_view(fov_x, fov_y, [center_x, center_y, z], 0);
    
    let rgba_data = service.render_to_buffer()
        .expect("Failed to render axial");
    save_rgba_as_png(&rgba_data, render_size, render_size, 
                     &output_dir.join("axial_original.png"), false)
        .expect("Failed to save axial");
    println!("  Saved axial slice (no flip needed)");
    
    // Coronal slice - needs vertical flip
    let y = center_y;
    service.set_crosshair([center_x, y, (world_min[2] + world_max[2]) / 2.0]);
    let fov_x_cor = (world_max[0] - world_min[0]) * 1.2;
    let fov_z_cor = (world_max[2] - world_min[2]) * 1.2;
    let view_center = [center_x, center_y, (world_min[2] + world_max[2]) / 2.0];
    service.update_frame_for_synchronized_view(fov_x_cor, fov_z_cor, view_center, 1);
    
    let rgba_data = service.render_to_buffer()
        .expect("Failed to render coronal");
    save_rgba_as_png(&rgba_data, render_size, render_size,
                     &output_dir.join("coronal_flipped.png"), true)
        .expect("Failed to save coronal");
    println!("  Saved coronal slice (with vertical flip)");
    
    // Sagittal slice - needs vertical flip
    let x = center_x;
    service.set_crosshair([x, center_y, (world_min[2] + world_max[2]) / 2.0]);
    let fov_y_sag = (world_max[1] - world_min[1]) * 1.2;
    let fov_z_sag = (world_max[2] - world_min[2]) * 1.2;
    service.update_frame_for_synchronized_view(fov_y_sag, fov_z_sag, view_center, 2);
    
    let rgba_data = service.render_to_buffer()
        .expect("Failed to render sagittal");
    save_rgba_as_png(&rgba_data, render_size, render_size,
                     &output_dir.join("sagittal_flipped.png"), true)
        .expect("Failed to save sagittal");
    println!("  Saved sagittal slice (with vertical flip)");
    
    println!("\n✅ Test completed! Check {:?}", output_dir);
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
        // Flip the image vertically
        img_buffer = imageops::flip_vertical(&img_buffer);
    }
    
    img_buffer.save(path)?;
    Ok(())
}