use render_loop::{RenderLoopService, LayerInfo, BlendMode, ThresholdMode};
use volmath::DenseVolume3;
use volmath::space::NeuroSpace3;
use nalgebra::{Matrix4, Vector3};
use pollster;

fn main() {
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
        let space = NeuroSpace3::new(dims, transform).expect("Failed to create space");
        let volume = DenseVolume3::new(space, data).expect("Failed to create volume");
        
        let (handle, tfm) = service.upload_volume_3d(&volume)
            .expect("Failed to upload volume");
        
        service.create_world_space_bind_groups()
            .expect("Failed to create bind groups");
        
        // Test different colormap IDs
        for colormap_id in 0..5 {
            println!("\n--- Testing colormap ID {} ---", colormap_id);
            
            let layer = LayerInfo {
                atlas_index: handle,
                opacity: 1.0,
                blend_mode: BlendMode::Normal,
                colormap_id,
                intensity_range: (0.0, 1.0),
                threshold_range: (-f32::INFINITY, f32::INFINITY),
                threshold_mode: ThresholdMode::Range,
                texture_coords: (0.0, 0.0, 1.0, 1.0),
            };
            
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
            
            let rendered = service.render_to_buffer()
                .expect("Failed to render");
            
            // Check center pixel
            let center_idx = (16 * 32 + 16) * 4;
            let pixel = &rendered[center_idx..center_idx+4];
            println!("  Center pixel: [{}, {}, {}, {}]", pixel[0], pixel[1], pixel[2], pixel[3]);
            
            // Analyze if grayscale
            if pixel[0] == pixel[1] && pixel[1] == pixel[2] {
                println!("  -> GRAYSCALE (R=G=B)");
            } else {
                println!("  -> NOT grayscale");
                if pixel[1] > pixel[0] && pixel[1] > pixel[2] {
                    println!("  -> Green-dominant (likely Viridis)");
                }
            }
        }
    });
}