use image::{ImageBuffer, Rgba};
use nifti_loader::load_nifti_volume_auto;
use render_loop::{BlendMode, LayerInfo, RenderLoopService, ThresholdMode};
use std::fs;
use std::path::Path;
use volmath::{DenseVolume3, NeuroSpace3, NeuroSpaceExt};

/// End-to-end test that loads a NIfTI file, renders it through the GPU pipeline,
/// and saves the output as a PNG file for inspection.
#[tokio::test]
async fn test_nifti_render_to_png() {
    // Initialize render service
    let mut service = RenderLoopService::new()
        .await
        .expect("Failed to initialize render service");

    // Load shaders
    service.load_shaders().expect("Failed to load shaders");

    // Create offscreen render target (256x256 for test)
    let render_size = 256;
    service
        .create_offscreen_target(render_size, render_size)
        .expect("Failed to create offscreen target");

    // Load the NIfTI test file
    let nifti_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("test-data/unit/toy_t1w.nii.gz");

    println!("Loading NIFTI file from: {:?}", nifti_path);
    assert!(
        nifti_path.exists(),
        "Test NIFTI file not found at {:?}",
        nifti_path
    );

    // Load the NIfTI file using the loader
    let (volume_sendable, _affine) =
        load_nifti_volume_auto(&nifti_path).expect("Failed to load NIfTI file");

    // Extract the DenseVolume3<f32>
    let volume = match volume_sendable {
        bridge_types::VolumeSendable::VolF32(vol, _) => vol,
        _ => panic!("Expected f32 volume from test NIfTI file"),
    };

    // Get volume info
    let dims = volume.dims();
    let data_range = volume.range().unwrap_or((0.0, 1.0));
    println!("Loaded volume dimensions: {:?}", dims);
    println!("Data range: [{}, {}]", data_range.0, data_range.1);

    // Upload volume to GPU
    let (atlas_idx, _transform) = service
        .upload_volume_3d(&volume)
        .expect("Failed to upload volume to GPU");

    println!("Volume uploaded to atlas layer {}", atlas_idx);

    // Set up crosshair at center of volume
    let center_voxel = [dims[0] / 2, dims[1] / 2, dims[2] / 2];
    let center_world = volume
        .space
        .0
        .voxel_to_world()
        .transform_point(&nalgebra::Point3::new(
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

    // Add render layer
    let layer_info = LayerInfo {
        atlas_index: atlas_idx,
        opacity: 1.0,
        blend_mode: BlendMode::Normal,
        colormap_id: 0, // Grayscale
        intensity_range: data_range,
        threshold_range: (data_range.0, data_range.1),
        threshold_mode: ThresholdMode::Range,
        texture_coords: (0.0, 0.0, 1.0, 1.0),
        is_mask: false,
    };

    // Add the layer to the render state
    service.layer_state_manager.add_layer(layer_info);

    // Render to buffer
    println!("Rendering to buffer...");
    let rgba_data = service
        .render_to_buffer()
        .expect("Failed to render to buffer");

    // Validate the rendered data
    let pixel_count = (render_size * render_size) as usize;
    assert_eq!(rgba_data.len(), pixel_count * 4, "Unexpected buffer size");

    // Check for non-black pixels
    let non_black_count = count_non_black_pixels(&rgba_data);
    let coverage = (non_black_count as f32 / pixel_count as f32) * 100.0;

    println!("Rendered image statistics:");
    println!("  Total pixels: {}", pixel_count);
    println!(
        "  Non-black pixels: {} ({:.1}% coverage)",
        non_black_count, coverage
    );

    // Assert we have reasonable coverage (at least 5% non-black)
    assert!(
        coverage > 5.0,
        "Rendered image should have at least 5% non-black pixels, got {:.1}%",
        coverage
    );

    // Save as PNG
    let output_dir = Path::new("target/test-output");
    fs::create_dir_all(&output_dir).expect("Failed to create output directory");

    let output_path = output_dir.join("nifti_axial_e2e.png");
    save_rgba_as_png(&rgba_data, render_size, render_size, &output_path)
        .expect("Failed to save PNG");

    println!("✅ Test passed! Rendered image saved to: {:?}", output_path);
    println!("   You can inspect the PNG to verify the axial slice rendering");
}

/* Commented out due to missing dependency
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
        _ => Err("Expected F32 volume from toy_t1w.nii.gz".into()),
    }
}
*/

/// Count non-black pixels in RGBA buffer
fn count_non_black_pixels(rgba_data: &[u8]) -> usize {
    let mut count = 0;
    for i in (0..rgba_data.len()).step_by(4) {
        let r = rgba_data[i];
        let g = rgba_data[i + 1];
        let b = rgba_data[i + 2];
        // Alpha channel is ignored for this check

        if r > 0 || g > 0 || b > 0 {
            count += 1;
        }
    }
    count
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

/// Alternative test that creates a synthetic volume for testing without NIfTI dependencies
#[tokio::test]
async fn test_synthetic_volume_render_to_png() {
    // Initialize render service
    let mut service = RenderLoopService::new()
        .await
        .expect("Failed to initialize render service");

    // Load shaders
    service.load_shaders().expect("Failed to load shaders");

    // Create offscreen render target
    let render_size = 256;
    service
        .create_offscreen_target(render_size, render_size)
        .expect("Failed to create offscreen target");

    // Create a synthetic test volume with a sphere pattern
    let volume = create_sphere_test_volume();

    // Get volume info
    let dims = volume.space.dims();
    let data_range = volume.range().unwrap_or((0.0, 1.0));
    println!("Created synthetic volume dimensions: {:?}", dims);
    println!("Data range: [{}, {}]", data_range.0, data_range.1);

    // Upload volume to GPU
    let (atlas_idx, _transform) = service
        .upload_volume_3d(&volume)
        .expect("Failed to upload volume to GPU");

    // Set up crosshair at center
    let center = [
        dims[0] as f32 / 2.0,
        dims[1] as f32 / 2.0,
        dims[2] as f32 / 2.0,
    ];
    service.set_crosshair(center);

    // Set up axial view
    service.update_frame_for_synchronized_view(64.0, 64.0, center, 0);

    // Add render layer
    let layer_info = LayerInfo {
        atlas_index: atlas_idx,
        opacity: 1.0,
        blend_mode: BlendMode::Normal,
        colormap_id: 1, // Hot colormap for better visibility
        intensity_range: (0.0, 1000.0),
        threshold_range: (-f32::INFINITY, f32::INFINITY),
        threshold_mode: ThresholdMode::Range,
        texture_coords: (0.0, 0.0, 1.0, 1.0),
        is_mask: false,
    };

    service.layer_state_manager.add_layer(layer_info);

    // Render to buffer
    let rgba_data = service
        .render_to_buffer()
        .expect("Failed to render to buffer");

    // Save as PNG
    let output_dir = Path::new("target/test-output");
    fs::create_dir_all(&output_dir).expect("Failed to create output directory");

    let output_path = output_dir.join("synthetic_sphere_axial.png");
    save_rgba_as_png(&rgba_data, render_size, render_size, &output_path)
        .expect("Failed to save PNG");

    println!(
        "✅ Synthetic volume test passed! Image saved to: {:?}",
        output_path
    );
}

/// Create a test volume with a sphere pattern
fn create_sphere_test_volume() -> DenseVolume3<f32> {
    let dims = vec![64, 64, 64];
    let spacing = vec![1.0, 1.0, 1.0];
    let origin = vec![0.0, 0.0, 0.0];

    let neuro_space = neuroim::NeuroSpace::from_dims_spacing_origin(dims.clone(), spacing, origin)
        .expect("Failed to create NeuroSpace");

    let mut data = vec![0.0f32; dims[0] * dims[1] * dims[2]];

    let center = [
        dims[0] as f32 / 2.0,
        dims[1] as f32 / 2.0,
        dims[2] as f32 / 2.0,
    ];
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

    // Create a DenseNeuroVol from neuroim
    let data_ndarray = ndarray::Array3::from_shape_vec((dims[0], dims[1], dims[2]), data)
        .expect("Failed to create ndarray");
    let dense_vol = neuroim::DenseNeuroVol::new(data_ndarray, neuro_space)
        .expect("Failed to create DenseNeuroVol");

    // Wrap in CompatibleVolume (aka DenseVolume3)
    DenseVolume3::new(dense_vol)
}
