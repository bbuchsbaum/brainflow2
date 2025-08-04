// Test actual rendering with world-space multi-texture pipeline

use pollster;
use render_loop::test_fixtures::TestVolumeSet;
use render_loop::{BlendMode, LayerInfo, RenderLoopService, ThresholdMode};

#[test]
fn test_world_space_rendering_produces_output() {
    pollster::block_on(async {
        // Create render loop service
        let mut service = RenderLoopService::new()
            .await
            .expect("Failed to create RenderLoopService");

        // Load shaders
        service.load_shaders().expect("Failed to load shaders");

        // Enable world-space rendering
        service
            .enable_world_space_rendering()
            .expect("Failed to enable world-space rendering");

        // Create test volumes
        let volumes = TestVolumeSet::create_aligned();

        // Upload volumes
        let (anat_idx, anat_tfm) = service
            .upload_volume_multi_texture(&volumes.anatomical, wgpu::TextureFormat::R8Unorm)
            .expect("Failed to upload anatomical");

        let (func_idx, func_tfm) = service
            .upload_volume_multi_texture(&volumes.functional, wgpu::TextureFormat::R16Float)
            .expect("Failed to upload functional");

        // Initialize colormap
        service
            .initialize_colormap()
            .expect("Failed to initialize colormap");

        // Create bind groups
        service
            .create_world_space_bind_groups()
            .expect("Failed to create bind groups");

        // Configure layers
        let layers = vec![
            LayerInfo {
                atlas_index: anat_idx,
                opacity: 1.0,
                blend_mode: BlendMode::Normal,
                colormap_id: 0,
                intensity_range: (0.0, 255.0),
                threshold_range: (0.0, 255.0),
                threshold_mode: ThresholdMode::Range,
                texture_coords: (0.0, 0.0, 1.0, 1.0),
            },
            LayerInfo {
                atlas_index: func_idx,
                opacity: 0.7,
                blend_mode: BlendMode::Additive,
                colormap_id: 1,
                intensity_range: (0.0, 1.0),
                threshold_range: (0.1, 1.0),
                threshold_mode: ThresholdMode::Above,
                texture_coords: (0.0, 0.0, 1.0, 1.0),
            },
        ];

        // Update layer storage
        if let Some(layer_storage) = service.layer_storage_manager.as_mut() {
            let dims = vec![
                (256, 256, 256), // Anatomical
                (128, 128, 32),  // Functional
            ];
            let transforms = vec![anat_tfm, func_tfm];

            layer_storage.update_layers(
                &service.device,
                &service.queue,
                service.layer_bind_group_layout.as_ref().unwrap(),
                &layers,
                &dims,
                &transforms,
            );
        }

        // Set up frame parameters for axial slice at center
        let world_center = [0.0, 0.0, 0.0, 1.0];
        let u_mm = [256.0, 0.0, 0.0, 0.0]; // X-axis spans 256mm
        let v_mm = [0.0, 256.0, 0.0, 0.0]; // Y-axis spans 256mm
        service.update_frame_ubo(world_center, u_mm, v_mm);

        // Create offscreen render target
        service
            .create_offscreen_target(512, 512)
            .expect("Failed to create offscreen target");

        // Render
        let image_data = service.render_to_buffer().expect("Failed to render");

        // Verify we got image data
        assert_eq!(image_data.len(), 512 * 512 * 4); // RGBA

        // Verify the image is not all black
        let non_zero_pixels = image_data
            .chunks(4)
            .filter(|pixel| pixel[0] != 0 || pixel[1] != 0 || pixel[2] != 0)
            .count();

        println!(
            "Rendered {} non-zero pixels out of {}",
            non_zero_pixels,
            512 * 512
        );
        assert!(
            non_zero_pixels > 1000,
            "Expected at least 1000 non-zero pixels, got {}",
            non_zero_pixels
        );

        // Check that we have some variation in the image
        let unique_colors: std::collections::HashSet<[u8; 4]> = image_data
            .chunks(4)
            .map(|chunk| [chunk[0], chunk[1], chunk[2], chunk[3]])
            .collect();

        println!(
            "Found {} unique colors in rendered image",
            unique_colors.len()
        );
        assert!(
            unique_colors.len() >= 3,
            "Expected at least 3 unique colors, got {}",
            unique_colors.len()
        );
    });
}

#[test]
fn test_multi_resolution_overlay() {
    pollster::block_on(async {
        let mut service = RenderLoopService::new()
            .await
            .expect("Failed to create RenderLoopService");

        // Load shaders
        service.load_shaders().expect("Failed to load shaders");

        // World-space rendering is now the default

        // Create volumes with different resolutions
        let volumes = TestVolumeSet::create_aligned();

        // Upload all three volumes using upload_volume_3d
        let (anat_idx, anat_tfm) = service
            .upload_volume_3d(&volumes.anatomical)
            .expect("Failed to upload anatomical");

        let (func_idx, func_tfm) = service
            .upload_volume_3d(&volumes.functional)
            .expect("Failed to upload functional");

        let (detail_idx, detail_tfm) = service
            .upload_volume_3d(&volumes.detail_patch)
            .expect("Failed to upload detail");

        // Initialize colormap
        service
            .initialize_colormap()
            .expect("Failed to initialize colormap");

        // Create bind groups for world-space rendering
        service
            .create_world_space_bind_groups()
            .expect("Failed to create bind groups");

        // Configure all three layers
        let layers = vec![
            LayerInfo {
                atlas_index: anat_idx,
                opacity: 1.0,
                blend_mode: BlendMode::Normal,
                colormap_id: 0,
                intensity_range: (0.0, 255.0),
                threshold_range: (0.0, 255.0),
                threshold_mode: ThresholdMode::Range,
                texture_coords: (0.0, 0.0, 1.0, 1.0),
            },
            LayerInfo {
                atlas_index: func_idx,
                opacity: 0.5,
                blend_mode: BlendMode::Additive,
                colormap_id: 3, // Hot colormap
                intensity_range: (0.0, 1.0),
                threshold_range: (0.2, 1.0),
                threshold_mode: ThresholdMode::Above,
                texture_coords: (0.0, 0.0, 1.0, 1.0),
            },
            LayerInfo {
                atlas_index: detail_idx,
                opacity: 0.8,
                blend_mode: BlendMode::Normal,
                colormap_id: 4, // Cool colormap
                intensity_range: (0.0, 1.0),
                threshold_range: (0.3, 1.0),
                threshold_mode: ThresholdMode::Above,
                texture_coords: (0.0, 0.0, 1.0, 1.0),
            },
        ];

        // Update layers using the proper public API
        let dims = vec![
            (256, 256, 256), // Anatomical
            (128, 128, 32),  // Functional
            (128, 128, 64),  // Detail
        ];
        let transforms = vec![anat_tfm, func_tfm, detail_tfm];

        service.update_layer_uniforms_direct(&layers, &dims, &transforms);

        // Render multiple slices to verify multi-resolution works
        service
            .create_offscreen_target(512, 512)
            .expect("Failed to create offscreen target");

        for z_offset in [-50.0, 0.0, 50.0].iter() {
            let world_center = [0.0, 0.0, *z_offset, 1.0];
            let u_mm = [256.0, 0.0, 0.0, 0.0];
            let v_mm = [0.0, 256.0, 0.0, 0.0];
            service.update_frame_ubo(world_center, u_mm, v_mm);

            let image_data = service.render_to_buffer().expect("Failed to render");

            // Verify each slice has content
            let non_zero_pixels = image_data
                .chunks(4)
                .filter(|pixel| pixel[0] != 0 || pixel[1] != 0 || pixel[2] != 0)
                .count();

            println!(
                "Slice at z={}: {} non-zero pixels",
                z_offset, non_zero_pixels
            );
            assert!(
                non_zero_pixels > 100,
                "Slice at z={} has too few non-zero pixels",
                z_offset
            );
        }
    });
}
