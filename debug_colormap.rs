use pollster;
use render_loop::{RenderLoopService, LayerInfo, BlendMode, ThresholdMode};
use volmath::DenseVolume3;
use volmath::space::NeuroSpace3;
use nalgebra::{Matrix4, Vector3};

fn main() {
    pollster::block_on(async {
        // Create service
        let mut service = RenderLoopService::new()
            .await
            .expect("Failed to create RenderLoopService");
        
        // Load shaders and initialize colormap
        service.load_shaders().expect("Failed to load shaders");
        service.initialize_colormap().expect("Failed to initialize colormap");
        service.enable_world_space_rendering().expect("Failed to enable world-space");
        
        // Create a simple test volume with constant value
        let dims = [8, 8, 8];
        let mut data = vec![0.5f32; dims[0] * dims[1] * dims[2]];
        
        // Add a brighter spot in the center
        let center_idx = 4 + 4 * 8 + 4 * 64;
        data[center_idx] = 1.0;
        
        let space = NeuroSpace3::new(
            dims,
            Matrix4::new_translation(&Vector3::new(-4.0, -4.0, -4.0)),
        ).expect("Failed to create space");
        
        let volume = DenseVolume3::new(space, data).expect("Failed to create volume");
        
        // Upload volume
        let (idx, _) = service.upload_volume_multi_texture(
            &volume,
            wgpu::TextureFormat::R32Float,
        ).expect("Failed to upload volume");
        
        // Create bind groups
        service.create_world_space_bind_groups()
            .expect("Failed to create bind groups");
        
        // Configure layer
        let layers = vec![LayerInfo {
            atlas_index: idx,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            colormap_id: 0, // Grayscale
            intensity_range: (0.0, 1.0),
            threshold_range: (0.0, 1.0),
            threshold_mode: ThresholdMode::Range,
            texture_coords: (0.0, 0.0, 1.0, 1.0),
        }];
        
        // Update layer storage with proper world-to-voxel transform
        if let Some(layer_storage) = service.layer_storage_manager.as_mut() {
            let dims_u32 = vec![(8u32, 8u32, 8u32)];
            let transforms = vec![volume.space().0.world_to_voxel()];
            
            layer_storage.update_layers(
                &service.device,
                &service.queue,
                service.layer_bind_group_layout.as_ref().unwrap(),
                &layers,
                &dims_u32,
                &transforms,
            );
        }
        
        // Set up view to look at center slice
        let origin = [-4.0, -4.0, 0.0, 1.0];
        let u = [8.0, 0.0, 0.0, 0.0];
        let v = [0.0, 8.0, 0.0, 0.0];
        service.update_frame_ubo(origin, u, v);
        
        // Create offscreen target
        service.create_offscreen_target(32, 32)
            .expect("Failed to create offscreen target");
        
        // Render
        let image_data = service.render_to_buffer()
            .expect("Failed to render");
        
        // Check pixels
        println!("Image dimensions: 32x32, {} bytes", image_data.len());
        
        // Check a few pixels
        for y in 0..4 {
            for x in 0..4 {
                let idx = (y * 32 + x) * 4;
                let pixel = &image_data[idx..idx+4];
                println!("Pixel ({}, {}): [{}, {}, {}, {}]", x, y, pixel[0], pixel[1], pixel[2], pixel[3]);
            }
        }
        
        // Check center pixel (should be brighter)
        let center_idx = (16 * 32 + 16) * 4;
        let center = &image_data[center_idx..center_idx+4];
        println!("\nCenter pixel (16, 16): [{}, {}, {}, {}]", center[0], center[1], center[2], center[3]);
    });
}