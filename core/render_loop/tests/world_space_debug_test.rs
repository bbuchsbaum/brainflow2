// Debug test for world-space rendering

use render_loop::{RenderLoopService, LayerInfo, BlendMode, ThresholdMode};
use render_loop::test_fixtures::TestVolumeSet;
use pollster;

#[test]
fn test_world_space_shader_basic() {
    pollster::block_on(async {
        // Create render loop service
        let mut service = RenderLoopService::new()
            .await
            .expect("Failed to create RenderLoopService");
        
        // Enable world-space rendering
        service.enable_world_space_rendering()
            .expect("Failed to enable world-space rendering");
        
        // Create test volumes
        let volumes = TestVolumeSet::create_aligned();
        
        // Upload just the anatomical volume
        let (anat_idx, anat_tfm) = service.upload_volume_multi_texture(
            &volumes.anatomical,
            wgpu::TextureFormat::R8Unorm,
        ).expect("Failed to upload anatomical");
        
        println!("Anatomical volume uploaded with index {} and transform:\n{:?}", anat_idx, anat_tfm);
        
        // Initialize colormap
        service.initialize_colormap()
            .expect("Failed to initialize colormap");
        
        // Create bind groups
        service.create_world_space_bind_groups()
            .expect("Failed to create bind groups");
        
        // Configure single layer with simple settings
        let layers = vec![
            LayerInfo {
                atlas_index: anat_idx,
                opacity: 1.0,
                blend_mode: BlendMode::Normal,
                colormap_id: 0, // Grayscale
                intensity_range: (0.0, 255.0),
                threshold_range: (1.0, 255.0), // Skip background
                threshold_mode: ThresholdMode::Range,
                texture_coords: (0.0, 0.0, 1.0, 1.0),
            },
        ];
        
        // Update layer storage
        if let Some(layer_storage) = service.layer_storage_manager.as_mut() {
            let dims = vec![(256, 256, 256)];
            let transforms = vec![anat_tfm];
            
            layer_storage.update_layers(
                &service.device,
                &service.queue,
                service.layer_bind_group_layout.as_ref().unwrap(),
                &layers,
                &dims,
                &transforms,
            );
            
            println!("Layer storage updated with {} layer", layer_storage.active_count());
        }
        
        // Set up frame parameters for center axial slice  
        // This should show a circular brain structure
        let world_center = [0.0, 0.0, 0.0, 1.0];
        let u_mm = [256.0, 0.0, 0.0, 0.0];  // X-axis spans 256mm
        let v_mm = [0.0, 256.0, 0.0, 0.0];  // Y-axis spans 256mm
        service.update_frame_ubo(world_center, u_mm, v_mm);
        
        // Create smaller render target for debugging
        service.create_offscreen_target(256, 256)
            .expect("Failed to create offscreen target");
        
        // Render
        let image_data = service.render_to_buffer()
            .expect("Failed to render");
        
        // Analyze the result
        assert_eq!(image_data.len(), 256 * 256 * 4);
        
        // Count pixels by intensity ranges
        let mut background = 0;
        let mut csf = 0;
        let mut brain = 0;
        let mut bright = 0;
        
        for pixel in image_data.chunks(4) {
            let r = pixel[0];
            match r {
                0 => background += 1,
                1..=50 => csf += 1,
                51..=200 => brain += 1,
                201..=255 => bright += 1,
            }
        }
        
        println!("Pixel counts: background={}, csf={}, brain={}, bright={}", 
                 background, csf, brain, bright);
        
        // We should see mostly brain tissue with some CSF
        assert!(brain > 10000, "Expected significant brain tissue pixels, got {}", brain);
        assert!(csf > 0, "Expected some CSF pixels, got {}", csf);
        
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
        println!("Brightest pixel: value={} at ({}, {})", max_val, max_pos.0, max_pos.1);
        
        // For now, just verify we're getting varied output
        let unique_values: std::collections::HashSet<u8> = image_data.iter()
            .step_by(4)
            .copied()
            .collect();
        println!("Unique pixel values: {}", unique_values.len());
        assert!(unique_values.len() > 2, "Expected varied output, got {} unique values", unique_values.len());
    });
}

#[test] 
fn test_world_space_coordinate_mapping() {
    pollster::block_on(async {
        let mut service = RenderLoopService::new()
            .await
            .expect("Failed to create RenderLoopService");
        
        service.enable_world_space_rendering()
            .expect("Failed to enable world-space rendering");
        
        // Create a simple test volume with known values
        let dims = [10, 10, 10];
        let mut data = vec![0u8; 10 * 10 * 10];
        
        // Put a marker at voxel (5,5,5)
        data[5 * 100 + 5 * 10 + 5] = 255;
        
        // Create volume with identity transform (1mm voxels)
        use volmath::space::{NeuroSpace3, NeuroSpaceImpl};
        use nalgebra::Matrix4;
        let space_impl = NeuroSpaceImpl::from_affine_matrix4(dims, Matrix4::identity());
        let space = NeuroSpace3(space_impl);
        let test_volume = volmath::DenseVolume3::from_data(space, data);
        
        // Upload volume
        let (idx, tfm) = service.upload_volume_multi_texture(
            &test_volume,
            wgpu::TextureFormat::R8Unorm,
        ).expect("Failed to upload test volume");
        
        println!("Test volume transform:\n{:?}", tfm);
        
        service.initialize_colormap()
            .expect("Failed to initialize colormap");
        
        service.create_world_space_bind_groups()
            .expect("Failed to create bind groups");
        
        // Configure layer
        let layers = vec![
            LayerInfo {
                atlas_index: idx,
                opacity: 1.0,
                blend_mode: BlendMode::Normal,
                colormap_id: 0,
                intensity_range: (0.0, 255.0),
                threshold_range: (0.0, 255.0),
                threshold_mode: ThresholdMode::Range,
                texture_coords: (0.0, 0.0, 1.0, 1.0),
            },
        ];
        
        if let Some(layer_storage) = service.layer_storage_manager.as_mut() {
            let dims = vec![(10, 10, 10)];
            let transforms = vec![tfm];
            
            layer_storage.update_layers(
                &service.device,
                &service.queue,
                service.layer_bind_group_layout.as_ref().unwrap(),
                &layers,
                &dims,
                &transforms,
            );
        }
        
        // Render a slice at z=5 (should show the marker)
        let world_center = [5.0, 5.0, 5.0, 1.0];
        let u_mm = [10.0, 0.0, 0.0, 0.0];
        let v_mm = [0.0, 10.0, 0.0, 0.0];
        service.update_frame_ubo(world_center, u_mm, v_mm);
        
        service.create_offscreen_target(10, 10)
            .expect("Failed to create offscreen target");
        
        let image_data = service.render_to_buffer()
            .expect("Failed to render");
        
        // The center pixel should be bright
        let center_idx = (5 * 10 + 5) * 4;
        let center_value = image_data[center_idx];
        
        println!("Rendered 10x10 slice, center pixel value: {}", center_value);
        assert!(center_value > 250, "Expected bright center pixel at marker location");
    });
}