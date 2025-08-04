// Test complete world-space rendering workflow

use pollster;
use render_loop::test_fixtures::TestVolumeSet;
use render_loop::{BlendMode, LayerInfo, RenderLoopService, ThresholdMode};

#[test]
fn test_world_space_rendering_workflow() {
    pollster::block_on(async {
        // Create render loop service
        let mut service = RenderLoopService::new()
            .await
            .expect("Failed to create RenderLoopService");

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

        let (detail_idx, detail_tfm) = service
            .upload_volume_multi_texture(&volumes.detail_patch, wgpu::TextureFormat::R16Float)
            .expect("Failed to upload detail");

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
            LayerInfo {
                atlas_index: detail_idx,
                opacity: 1.0,
                blend_mode: BlendMode::Normal,
                colormap_id: 0,
                intensity_range: (0.0, 1.0),
                threshold_range: (0.1, 1.0),
                threshold_mode: ThresholdMode::Range,
                texture_coords: (0.0, 0.0, 1.0, 1.0),
            },
        ];

        // Update layer storage
        if let Some(layer_storage) = service.layer_storage_manager.as_mut() {
            let dims = vec![
                (256, 256, 256), // Anatomical
                (128, 128, 32),  // Functional
                (128, 128, 64),  // Detail
            ];
            let transforms = vec![anat_tfm, func_tfm, detail_tfm];

            layer_storage.update_layers(
                &service.device,
                &service.queue,
                service.layer_bind_group_layout.as_ref().unwrap(),
                &layers,
                &dims,
                &transforms,
            );

            assert_eq!(layer_storage.active_count(), 3);
            println!(
                "Successfully configured {} layers for world-space rendering",
                layer_storage.active_count()
            );
        }

        // Verify multi-texture bind group is created
        assert!(service
            .multi_texture_manager
            .as_ref()
            .unwrap()
            .bind_group()
            .is_some());
        println!("Multi-texture bind group created successfully");

        // Verify layer storage bind group is created
        assert!(service
            .layer_storage_manager
            .as_ref()
            .unwrap()
            .bind_group()
            .is_some());
        println!("Layer storage bind group created successfully");
    });
}

#[test]
fn test_texture_format_compatibility() {
    pollster::block_on(async {
        let mut service = RenderLoopService::new()
            .await
            .expect("Failed to create RenderLoopService");

        service
            .enable_world_space_rendering()
            .expect("Failed to enable world-space rendering");

        // Test different texture formats
        let test_volume = TestVolumeSet::create_aligned().anatomical;

        // R8Unorm should work
        let result =
            service.upload_volume_multi_texture(&test_volume, wgpu::TextureFormat::R8Unorm);
        assert!(result.is_ok());

        // R16Float should work
        let result =
            service.upload_volume_multi_texture(&test_volume, wgpu::TextureFormat::R16Float);
        assert!(result.is_ok());

        // R32Float should work
        let result =
            service.upload_volume_multi_texture(&test_volume, wgpu::TextureFormat::R32Float);
        assert!(result.is_ok());
    });
}
