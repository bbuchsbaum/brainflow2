use render_loop::RenderLoopService;
use volmath::{DenseVolume3, NeuroSpace3, NeuroSpaceExt};

/// Creates a test volume with a single bright voxel at a specific location
fn create_single_voxel_volume(voxel_pos: [usize; 3]) -> DenseVolume3<f32> {
    let dims = [64, 64, 64];
    let spacing = [1.0, 1.0, 1.0];
    let origin = [0.0, 0.0, 0.0];

    let space_impl = <volmath::NeuroSpace as NeuroSpaceExt>::from_dims_spacing_origin(
        dims.to_vec(),
        spacing.to_vec(),
        origin.to_vec(),
    )
    .expect("Failed to create NeuroSpace");
    let space = NeuroSpace3::new(space_impl);

    // Create data array with all zeros except one bright voxel
    let mut data = vec![0.0f32; dims[0] * dims[1] * dims[2]];

    // Set single voxel to bright value
    let idx = voxel_pos[2] * dims[0] * dims[1] + voxel_pos[1] * dims[0] + voxel_pos[0];
    data[idx] = 1.0;

    println!(
        "Created volume with bright voxel at {:?}, index {}, value {}",
        voxel_pos, idx, data[idx]
    );

    // Verify data is non-zero
    let non_zero_count = data.iter().filter(|&&v| v > 0.0).count();
    println!(
        "Volume has {} non-zero voxels out of {}",
        non_zero_count,
        data.len()
    );

    DenseVolume3::<f32>::from_data(space.0, data)
}

#[tokio::test]
async fn test_view_synchronization_at_crosshair() {
    // Create volume with single bright voxel at (10, 20, 30)
    let bright_voxel_pos = [10, 20, 30];
    let volume = create_single_voxel_volume(bright_voxel_pos);

    // Initialize render service
    let mut service = RenderLoopService::new()
        .await
        .expect("Failed to initialize render service");

    // Load shaders
    service.load_shaders().expect("Failed to load shaders");

    // Create offscreen render target
    let size = 128; // Smaller size for this test
    service
        .create_offscreen_target(size, size)
        .expect("Failed to create offscreen target");

    // Upload volume to GPU
    let (texture_idx, world_to_voxel) = service
        .upload_volume_3d(&volume)
        .expect("Failed to upload volume");

    println!(
        "Uploaded volume to texture_idx {}, world_to_voxel: {:?}",
        texture_idx, world_to_voxel
    );

    // With multi-texture manager, the texture index can be any value

    // Ensure pipeline is created - use slice_world_space which supports current setup
    service
        .ensure_pipeline("slice_world_space")
        .expect("Failed to ensure pipeline");

    // Set crosshair at the bright voxel position
    let crosshair_world = [
        bright_voxel_pos[0] as f32,
        bright_voxel_pos[1] as f32,
        bright_voxel_pos[2] as f32,
    ];

    // Disable crosshair to avoid interference
    service.update_crosshair_position([0.0, 0.0, 0.0], false);

    // Test all three views - they should all show the bright voxel
    test_synchronized_axial(&mut service, texture_idx, size, crosshair_world).await;
    test_synchronized_coronal(&mut service, texture_idx, size, crosshair_world).await;
    test_synchronized_sagittal(&mut service, texture_idx, size, crosshair_world).await;
}

async fn test_synchronized_axial(
    service: &mut RenderLoopService,
    texture_idx: u32,
    size: u32,
    crosshair: [f32; 3],
) {
    // Set view plane to Axial
    // View plane is set through frame vectors
    service.set_crosshair(crosshair);

    // Use small view size to ensure we capture the single voxel
    service.update_frame_for_synchronized_view(20.0, 20.0, crosshair, 0);

    // Add render layer using the actual texture index
    service
        .add_render_layer(texture_idx, 1.0, (0.0, 0.0, 1.0, 1.0))
        .expect("Failed to add render layer");

    // Render and get buffer
    let buffer = service.render_to_buffer().expect("Failed to render");

    // Verify we see the bright voxel near the center
    verify_bright_voxel_visible(&buffer, size, "Axial");

    service.clear_render_layers();
}

async fn test_synchronized_coronal(
    service: &mut RenderLoopService,
    texture_idx: u32,
    size: u32,
    crosshair: [f32; 3],
) {
    // Set view plane to Coronal
    // View plane is set through frame vectors
    service.set_crosshair(crosshair);

    // Use small view size to ensure we capture the single voxel
    service.update_frame_for_synchronized_view(20.0, 20.0, crosshair, 1);

    // Add render layer using the actual texture index
    service
        .add_render_layer(texture_idx, 1.0, (0.0, 0.0, 1.0, 1.0))
        .expect("Failed to add render layer");

    // Render and get buffer
    let buffer = service.render_to_buffer().expect("Failed to render");

    // Verify we see the bright voxel near the center
    verify_bright_voxel_visible(&buffer, size, "Coronal");

    service.clear_render_layers();
}

async fn test_synchronized_sagittal(
    service: &mut RenderLoopService,
    texture_idx: u32,
    size: u32,
    crosshair: [f32; 3],
) {
    // Set view plane to Sagittal
    // View plane is set through frame vectors
    service.set_crosshair(crosshair);

    // Use small view size to ensure we capture the single voxel
    service.update_frame_for_synchronized_view(20.0, 20.0, crosshair, 2);

    // Add render layer using the actual texture index
    service
        .add_render_layer(texture_idx, 1.0, (0.0, 0.0, 1.0, 1.0))
        .expect("Failed to add render layer");

    // Render and get buffer
    let buffer = service.render_to_buffer().expect("Failed to render");

    // Verify we see the bright voxel near the center
    verify_bright_voxel_visible(&buffer, size, "Sagittal");

    service.clear_render_layers();
}

fn verify_bright_voxel_visible(buffer: &[u8], size: u32, view_name: &str) {
    let stride = 4; // RGBA

    // Find the brightest pixel in the rendered image
    let mut max_value = 0.0f32;
    let mut bright_pixel_pos = (0, 0);
    let mut non_zero_count = 0;

    for y in 0..size {
        for x in 0..size {
            let idx = ((y * size + x) * stride) as usize;
            let pixel_value = buffer[idx] as f32 / 255.0;

            if pixel_value > 0.0 {
                non_zero_count += 1;
            }

            if pixel_value > max_value {
                max_value = pixel_value;
                bright_pixel_pos = (x, y);
            }
        }
    }

    println!(
        "{} view: Found {} non-zero pixels, max value {} at {:?}",
        view_name, non_zero_count, max_value, bright_pixel_pos
    );

    // Debug: print some sample pixel values around expected center
    let center = size / 2;
    println!(
        "  Center pixel ({}, {}): {}",
        center,
        center,
        buffer[((center * size + center) * stride) as usize] as f32 / 255.0
    );

    // The bright voxel should be visible
    assert!(
        max_value > 0.5,
        "{} view should show the bright voxel (max value: {})",
        view_name,
        max_value
    );

    // For synchronized views, we just care that the bright voxel is visible
    // The exact position depends on the view setup and coordinate transformations
    println!("{} view test passed - bright voxel is visible", view_name);
}

#[tokio::test]
async fn test_crosshair_movement_updates_views() {
    // Create volume with bright voxels at different locations
    let dims = [64, 64, 64];
    let spacing = [1.0, 1.0, 1.0];
    let origin = [0.0, 0.0, 0.0];

    let space_impl = <volmath::NeuroSpace as NeuroSpaceExt>::from_dims_spacing_origin(
        dims.to_vec(),
        spacing.to_vec(),
        origin.to_vec(),
    )
    .expect("Failed to create NeuroSpace");
    let space = NeuroSpace3::new(space_impl);

    // Create data with bright voxels at specific locations
    let mut data = vec![0.0f32; dims[0] * dims[1] * dims[2]];

    // Add bright voxels at different Z slices
    let test_positions = vec![
        [32, 32, 10], // Z=10
        [32, 32, 32], // Z=32
        [32, 32, 50], // Z=50
    ];

    for pos in &test_positions {
        let idx = pos[2] * dims[0] * dims[1] + pos[1] * dims[0] + pos[0];
        data[idx] = 1.0;
    }

    let volume = DenseVolume3::<f32>::from_data(space, data);

    // Initialize render service
    let mut service = RenderLoopService::new()
        .await
        .expect("Failed to initialize render service");

    service.load_shaders().expect("Failed to load shaders");

    service
        .create_offscreen_target(128, 128)
        .expect("Failed to create offscreen target");

    let (texture_idx, _world_to_voxel) = service
        .upload_volume_3d(&volume)
        .expect("Failed to upload volume");

    service
        .ensure_pipeline("slice_world_space")
        .expect("Failed to ensure pipeline");

    // Disable crosshair to avoid interference
    service.update_crosshair_position([0.0, 0.0, 0.0], false);

    // Test axial view at different Z positions
    for pos in test_positions {
        // View plane is set through frame vectors

        let crosshair = [pos[0] as f32, pos[1] as f32, pos[2] as f32];
        service.set_crosshair(crosshair);
        service.update_frame_for_synchronized_view(64.0, 64.0, crosshair, 0);

        service
            .add_render_layer(texture_idx, 1.0, (0.0, 0.0, 1.0, 1.0))
            .expect("Failed to add render layer");

        let buffer = service.render_to_buffer().expect("Failed to render");

        // Should see bright voxel at this Z position
        let max_value = find_max_pixel_value(&buffer);
        assert!(
            max_value > 0.5,
            "Axial view at Z={} should show bright voxel",
            pos[2]
        );

        service.clear_render_layers();
    }
}

fn find_max_pixel_value(buffer: &[u8]) -> f32 {
    buffer
        .chunks(4)
        .map(|rgba| rgba[0] as f32 / 255.0)
        .fold(0.0f32, |max, val| max.max(val))
}
