// Debug test to verify colormap indices

use render_loop::{RenderLoopService, LayerInfo, BlendMode, ThresholdMode};
use volmath::{DenseVolume3, NeuroSpaceExt};
use volmath::space::{NeuroSpace3, NeuroSpaceImpl};
use nalgebra::{Matrix4, Vector3};

#[test] 
fn test_colormap_indices() {
    pollster::block_on(async {
        let mut service = RenderLoopService::new().await
            .expect("Failed to create RenderLoopService");
        
        service.load_shaders().expect("Failed to load shaders");
        service.initialize_colormap().expect("Failed to initialize colormap");
        service.enable_world_space_rendering().expect("Failed to enable world-space");
        service.create_offscreen_target(32, 32).expect("Failed to create offscreen target");
        
        // Create simple test volume with constant value 0.5
        let dims = [4, 4, 4];
        let data = vec![0.5f32; 64];
        let transform = Matrix4::new_translation(&Vector3::new(-2.0, -2.0, -2.0));
        let space = NeuroSpace3::new(<volmath::NeuroSpace as NeuroSpaceExt>::from_affine_matrix4(dims.to_vec(), transform).expect("Failed to create NeuroSpace"));
        let volume = DenseVolume3::from_data(space.0, data);
        
        let (handle, tfm) = service.upload_volume_3d(&volume)
            .expect("Failed to upload volume");
        
        service.create_world_space_bind_groups()
            .expect("Failed to create bind groups");
        
        // Test colormap ID 0 (should be grayscale)
        println!("\n--- Testing colormap ID 0 (Grayscale) ---");
        
        let layer = LayerInfo {
            atlas_index: handle,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            colormap_id: 0,
            intensity_range: (0.0, 1.0),
            threshold_range: (-f32::INFINITY, f32::INFINITY),
            threshold_mode: ThresholdMode::Range,
            texture_coords: (0.0, 0.0, 1.0, 1.0),
            is_mask: false,
        };
        
        println!("Layer info: colormap_id = {}, atlas_index = {}", layer.colormap_id, layer.atlas_index);
        
        if let Some(layer_storage) = service.layer_storage_manager.as_mut() {
            let dims_u32 = vec![(4u32, 4u32, 4u32)];
            let transforms = vec![tfm];
            
            layer_storage.update_layers(
                &service.device,
                &service.queue,
                service.layer_bind_group_layout.as_ref().unwrap(),
                &[layer],
                &dims_u32,
                &transforms,
            );
        }
        
        service.update_frame_ubo(
            [-2.0, -2.0, 0.0, 1.0],
            [4.0, 0.0, 0.0, 0.0],
            [0.0, 4.0, 0.0, 0.0]
        );
        
        // Disable crosshair to avoid interference
        service.update_crosshair_position([0.0, 0.0, 0.0], false);
        
        let rendered = service.render_to_buffer()
            .expect("Failed to render");
        
        // Check center pixel (should be mid-gray ~127)
        let center_idx = (16 * 32 + 16) * 4;
        let pixel = &rendered[center_idx..center_idx+4];
        println!("Center pixel: [{}, {}, {}, {}]", pixel[0], pixel[1], pixel[2], pixel[3]);
        
        // For grayscale at 0.5 intensity in sRGB space, we expect R=G=B≈188
        // Linear 0.5 (128/255) converts to sRGB ~0.735 (187/255)
        assert!(
            pixel[0] == pixel[1] && pixel[1] == pixel[2],
            "Expected grayscale (R=G=B) but got [{}, {}, {}]", 
            pixel[0], pixel[1], pixel[2]
        );
        
        assert!(
            pixel[0] > 180 && pixel[0] < 195,
            "Expected sRGB mid-gray value ~188 but got {}",
            pixel[0]
        );
        
        println!("✓ Colormap 0 is correctly grayscale");
    });
}