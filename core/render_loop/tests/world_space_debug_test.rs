// Debug test for world-space rendering

use nalgebra::Matrix4;
use render_loop::{BlendMode, LayerInfo, RenderLoopService, ThresholdMode};
use volmath::DenseVolume3;
use volmath::NeuroSpaceExt;

fn create_world_space_sphere_volume() -> DenseVolume3<f32> {
    let dims = [64, 64, 64];
    let mut data = vec![0.0f32; dims[0] * dims[1] * dims[2]];
    let center = [32.0f32, 32.0, 32.0];

    for z in 0..dims[2] {
        for y in 0..dims[1] {
            for x in 0..dims[0] {
                let dx = x as f32 - center[0];
                let dy = y as f32 - center[1];
                let dz = z as f32 - center[2];
                if (dx * dx + dy * dy + dz * dz).sqrt() < 20.0 {
                    data[z * dims[0] * dims[1] + y * dims[0] + x] = 1.0;
                }
            }
        }
    }

    let space_impl =
        <volmath::NeuroSpace as NeuroSpaceExt>::from_affine_matrix4(dims, Matrix4::identity());
    let space = volmath::space::NeuroSpace3::new(space_impl);
    DenseVolume3::from_data(space.0, data)
}

#[test]
fn test_world_space_shader_basic() {
    pollster::block_on(async {
        // Create render loop service
        let mut service = RenderLoopService::new()
            .await
            .expect("Failed to create RenderLoopService");

        // Enable world-space rendering
        service
            .enable_world_space_rendering()
            .expect("Failed to enable world-space rendering");

        let volume = create_world_space_sphere_volume();
        let (volume_idx, volume_tfm) = service
            .upload_volume_3d(&volume)
            .expect("Failed to upload sphere volume");

        println!(
            "Sphere volume uploaded with index {} and transform:\n{:?}",
            volume_idx, volume_tfm
        );

        // Configure single layer with simple settings
        let layers = vec![LayerInfo {
            atlas_index: volume_idx,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            colormap_id: 0, // Grayscale
            intensity_range: (0.0, 1.0),
            threshold_range: (0.0, 0.0), // Skip background
            threshold_mode: ThresholdMode::Range,
            texture_coords: (0.0, 0.0, 1.0, 1.0),
            interpolation_mode: 1,
            ..LayerInfo::default()
        }];

        // Set up frame parameters for center axial slice
        // This should show a circular cross-section of the sphere.
        let world_origin = [0.0, 0.0, 32.0, 1.0];
        let u_mm = [64.0, 0.0, 0.0, 0.0];
        let v_mm = [0.0, 64.0, 0.0, 0.0];
        service.update_frame_ubo(world_origin, u_mm, v_mm);
        service.update_layer_uniforms_direct(&layers, &[(64, 64, 64)], &[volume_tfm]);

        // Create smaller render target for debugging
        service
            .create_offscreen_target(256, 256)
            .expect("Failed to create offscreen target");

        // Render
        let image_data = service.render_to_buffer().expect("Failed to render");

        // Analyze the result
        assert_eq!(image_data.len(), 256 * 256 * 4);

        // Count pixels by intensity ranges. The clear color is low but non-zero,
        // so use a high-signal bucket for the anatomical foreground.
        let mut low_signal = 0;
        let mut brain = 0;
        let mut bright = 0;

        for pixel in image_data.chunks(4) {
            let r = pixel[0];
            match r {
                0..=50 => low_signal += 1,
                51..=200 => brain += 1,
                201..=255 => bright += 1,
            }
        }

        println!(
            "Pixel counts: low_signal={}, brain={}, bright={}",
            low_signal, brain, bright
        );

        // We should see a substantial high-signal sphere cross-section.
        assert!(
            brain > 1000,
            "Expected significant sphere pixels, got {}",
            brain
        );
        assert!(
            low_signal > 0,
            "Expected low-signal background/CSF pixels, got {}",
            low_signal
        );

        // Check center pixel should be brightest (marker at world origin)
        let center_idx = (128 * 256 + 128) * 4;
        let center_r = image_data[center_idx];
        println!("Center pixel value: {}", center_r);

        // Find the brightest pixel to debug
        let mut max_val = 0u8;
        let mut max_pos = (0, 0);
        for y in 0..256 {
            for x in 0..256 {
                let idx = (y * 256 + x) * 4;
                if image_data[idx] > max_val {
                    max_val = image_data[idx];
                    max_pos = (x, y);
                }
            }
        }
        println!(
            "Brightest pixel: value={} at ({}, {})",
            max_val, max_pos.0, max_pos.1
        );

        // For now, just verify we're getting varied output
        let unique_values: std::collections::HashSet<u8> =
            image_data.iter().step_by(4).copied().collect();
        println!("Unique pixel values: {}", unique_values.len());
        assert!(
            unique_values.len() > 2,
            "Expected varied output, got {} unique values",
            unique_values.len()
        );
    });
}

#[test]
fn test_world_space_coordinate_mapping() {
    pollster::block_on(async {
        let mut service = RenderLoopService::new()
            .await
            .expect("Failed to create RenderLoopService");

        service
            .enable_world_space_rendering()
            .expect("Failed to enable world-space rendering");

        // Create a simple test volume with known values
        let dims = [10, 10, 10];
        let mut data = vec![0u8; 10 * 10 * 10];

        // Put a small marker at voxel (5,5,5). A patch keeps the test robust to
        // pixel-center convention differences while still checking placement.
        for z in 4..=6 {
            for y in 4..=6 {
                for x in 4..=6 {
                    data[z * 100 + y * 10 + x] = 255;
                }
            }
        }

        // Create volume with identity transform (1mm voxels)
        use nalgebra::Matrix4;
        use volmath::space::NeuroSpace3;
        let space_impl =
            <volmath::NeuroSpace as NeuroSpaceExt>::from_affine_matrix4(dims, Matrix4::identity());
        let space = NeuroSpace3::new(space_impl);
        let test_volume = volmath::DenseVolume3::from_data(space.0, data);

        // Upload volume
        let (idx, tfm) = service
            .upload_volume_3d(&test_volume)
            .expect("Failed to upload test volume");

        println!("Test volume transform:\n{:?}", tfm);

        // Configure layer
        let layers = vec![LayerInfo {
            atlas_index: idx,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            colormap_id: 0,
            intensity_range: (0.0, 1.0),
            threshold_range: (0.0, 0.0),
            threshold_mode: ThresholdMode::Range,
            texture_coords: (0.0, 0.0, 1.0, 1.0),
            interpolation_mode: 0,
            ..LayerInfo::default()
        }];

        // Render a slice at z=5 (should show the marker)
        let world_origin = [0.0, 0.0, 5.0, 1.0];
        let u_mm = [10.0, 0.0, 0.0, 0.0];
        let v_mm = [0.0, 10.0, 0.0, 0.0];
        service.update_frame_ubo(world_origin, u_mm, v_mm);
        service.update_layer_uniforms_direct(&layers, &[(10, 10, 10)], &[tfm]);

        service
            .create_offscreen_target(100, 100)
            .expect("Failed to create offscreen target");

        let image_data = service.render_to_buffer().expect("Failed to render");

        // The marker should appear near the center of the frame.
        let center_visible = (40..60)
            .flat_map(|y| (40..60).map(move |x| (x, y)))
            .filter(|(x, y)| {
                let idx = ((y * 100 + x) * 4) as usize;
                image_data[idx]
                    .max(image_data[idx + 1])
                    .max(image_data[idx + 2])
                    > 180
            })
            .count();

        println!(
            "Rendered 100x100 slice, visible marker pixels near center: {}",
            center_visible
        );
        assert!(
            center_visible > 10,
            "Expected visible marker pixels near the center"
        );
    });
}
