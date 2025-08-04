// Test resource management and memory cleanup
use render_loop::RenderLoopService;
use volmath::{DenseVolume3, NeuroSpace3, NeuroSpaceExt};

/// Create a small test volume
fn create_test_volume(size: usize, value: f32) -> DenseVolume3<f32> {
    let dims = [size, size, size];
    let spacing = [1.0, 1.0, 1.0];
    let origin = [0.0, 0.0, 0.0];

    let space_impl = <volmath::NeuroSpace as NeuroSpaceExt>::from_dims_spacing_origin(
        dims.to_vec(),
        spacing.to_vec(),
        origin.to_vec(),
    )
    .expect("Failed to create NeuroSpace");
    let space = NeuroSpace3::new(space_impl);

    // Create data with a gradient pattern for better visibility
    let mut data = Vec::with_capacity(dims[0] * dims[1] * dims[2]);
    for z in 0..dims[2] {
        for y in 0..dims[1] {
            for x in 0..dims[0] {
                // Create a gradient from 0 to value
                let t = (x + y + z) as f32 / (3.0 * size as f32);
                data.push(t * value);
            }
        }
    }

    DenseVolume3::<f32>::from_data(space.0, data)
}

#[tokio::test]
async fn test_volume_upload_release_cycle() {
    println!("\n=== Testing Volume Upload/Release Cycle ===");

    let mut service = RenderLoopService::new()
        .await
        .expect("Failed to initialize render service");

    service.load_shaders().expect("Failed to load shaders");

    service
        .create_offscreen_target(128, 128)
        .expect("Failed to create offscreen target");

    // Track texture indices to ensure they're being reused
    let mut texture_indices = Vec::new();

    // Upload and release volumes multiple times
    for i in 0..10 {
        let volume = create_test_volume(32, 100.0 + i as f32 * 50.0);

        let (texture_idx, _) = service
            .upload_volume_3d(&volume)
            .expect("Failed to upload volume");

        texture_indices.push(texture_idx);
        println!(
            "Iteration {}: Uploaded volume with texture_idx {}",
            i, texture_idx
        );

        // Render to verify it works
        service
            .ensure_pipeline("slice_world_space")
            .expect("Failed to ensure pipeline");

        service.update_frame_for_synchronized_view(32.0, 32.0, [16.0, 16.0, 16.0], 0);
        service
            .add_render_layer(texture_idx, 1.0, (0.0, 0.0, 1.0, 1.0))
            .expect("Failed to add render layer");

        let buffer = service.render_to_buffer().expect("Failed to render");

        // Verify rendering worked
        let non_zero = buffer.chunks(4).filter(|rgba| rgba[0] > 0).count();
        assert!(non_zero > 0, "Volume should be visible");

        service.clear_render_layers();

        // Release the volume to free resources
        service
            .release_volume(texture_idx)
            .expect("Failed to release volume");
    }

    // Check texture index pattern
    println!("\nTexture indices used: {:?}", texture_indices);

    // With proper release and reuse, we should see some indices repeated
    let unique_indices: std::collections::HashSet<_> = texture_indices.iter().collect();
    println!("Unique texture indices: {}", unique_indices.len());

    // Assert that indices are being reused
    assert!(
        unique_indices.len() < 10,
        "Texture indices should be reused, but found {} unique indices",
        unique_indices.len()
    );

    println!("✅ Resource management test passed - textures are properly released and reused!");
}

#[tokio::test]
async fn test_multiple_simultaneous_volumes() {
    println!("\n=== Testing Multiple Simultaneous Volumes ===");

    let mut service = RenderLoopService::new()
        .await
        .expect("Failed to initialize render service");

    service.load_shaders().expect("Failed to load shaders");

    service
        .create_offscreen_target(256, 256)
        .expect("Failed to create offscreen target");

    // Upload multiple volumes
    let mut volumes = Vec::new();
    let max_volumes = 5;

    for i in 0..max_volumes {
        let volume = create_test_volume(32 + i * 8, 100.0 + i as f32 * 50.0);
        let (texture_idx, _) = service
            .upload_volume_3d(&volume)
            .expect(&format!("Failed to upload volume {}", i));

        volumes.push((texture_idx, volume));
        println!("Uploaded volume {} with texture_idx {}", i, texture_idx);
    }

    // Render with all volumes as layers
    service
        .ensure_pipeline("slice_world_space")
        .expect("Failed to ensure pipeline");

    service.update_crosshair_position([0.0, 0.0, 0.0], false);
    service.update_frame_for_synchronized_view(64.0, 64.0, [32.0, 32.0, 32.0], 0);

    // Add all volumes as layers with decreasing opacity
    for (i, (texture_idx, _)) in volumes.iter().enumerate() {
        let opacity = 1.0 / (i + 1) as f32;
        service
            .add_render_layer(*texture_idx, opacity, (0.0, 0.0, 1.0, 1.0))
            .expect(&format!("Failed to add layer {}", i));
    }

    // Render composite
    let buffer = service
        .render_to_buffer()
        .expect("Failed to render multi-volume composite");

    // Verify we see contributions from multiple volumes
    let intensity_histogram = compute_intensity_histogram(&buffer);
    let unique_intensities = intensity_histogram.keys().count();

    println!(
        "Composite render produced {} unique intensity values",
        unique_intensities
    );
    assert!(
        unique_intensities > 2,
        "Should see multiple intensity levels from volume composite"
    );

    println!("✅ Multiple simultaneous volumes test passed!");
}

#[tokio::test]
async fn test_large_volume_handling() {
    println!("\n=== Testing Large Volume Handling ===");

    let mut service = RenderLoopService::new()
        .await
        .expect("Failed to initialize render service");

    service.load_shaders().expect("Failed to load shaders");

    service
        .create_offscreen_target(512, 512)
        .expect("Failed to create offscreen target");

    // Test progressively larger volumes
    let sizes = vec![64, 128, 256];

    for size in sizes {
        println!("\nTesting {}x{}x{} volume...", size, size, size);

        let volume = create_test_volume(size, 200.0);
        let voxel_count = size * size * size;
        let memory_estimate = voxel_count * 4; // f32 per voxel

        println!(
            "  Volume contains {} voxels (~{} MB)",
            voxel_count,
            memory_estimate / (1024 * 1024)
        );

        match service.upload_volume_3d(&volume) {
            Ok((texture_idx, _)) => {
                println!("  ✓ Successfully uploaded with texture_idx {}", texture_idx);

                // Try to render
                service
                    .ensure_pipeline("slice_world_space")
                    .expect("Failed to ensure pipeline");

                service.update_frame_for_synchronized_view(
                    size as f32,
                    size as f32,
                    [size as f32 / 2.0; 3],
                    0,
                );

                service.clear_render_layers();
                service
                    .add_render_layer(texture_idx, 1.0, (0.0, 0.0, 1.0, 1.0))
                    .expect("Failed to add render layer");

                let buffer = service.render_to_buffer().expect("Failed to render");

                let non_zero = buffer.chunks(4).filter(|rgba| rgba[0] > 0).count();
                println!(
                    "  ✓ Rendered successfully with {} non-zero pixels",
                    non_zero
                );
            }
            Err(e) => {
                println!("  ✗ Failed to upload: {:?}", e);
                // This is expected for very large volumes
                if size > 256 {
                    println!("  (This is expected for very large volumes)");
                } else {
                    panic!(
                        "Should be able to handle {}x{}x{} volumes",
                        size, size, size
                    );
                }
            }
        }
    }

    println!("\n✅ Large volume handling test completed!");
}

fn compute_intensity_histogram(buffer: &[u8]) -> std::collections::HashMap<u8, usize> {
    let mut histogram = std::collections::HashMap::new();

    for chunk in buffer.chunks(4) {
        let intensity = chunk[0]; // R channel
        *histogram.entry(intensity).or_insert(0) += 1;
    }

    histogram
}
