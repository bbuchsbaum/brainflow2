use render_loop::{RenderLoopService, LayerInfo, BlendMode, ThresholdMode, FrameUbo};
use volmath::DenseVolume3;
use volmath::traits::Volume;
use nalgebra::{Vector3, Matrix4};

#[test]
fn test_threshold_simple() {
    pollster::block_on(async {
        let mut service = RenderLoopService::new().await
            .expect("Failed to create RenderLoopService");
        
        // Load shaders
        service.load_shaders()
            .expect("Failed to load shaders");
        
        // Initialize colormap
        service.initialize_colormap()
            .expect("Failed to initialize colormap");
        
        // Enable world-space rendering
        service.enable_world_space_rendering()
            .expect("Failed to enable world-space rendering");
        
        // Create offscreen render target
        service.create_offscreen_target(10, 10)
            .expect("Failed to create offscreen target");
        
        // Create a simple test volume with values 0-700
        use volmath::space::{NeuroSpace3, NeuroSpaceImpl};
        let dims = [8, 8, 8];
        let mut data = vec![0.0f32; 512];
        
        // Create a gradient: 0 at corner, 700 at opposite corner
        for z in 0..8 {
            for y in 0..8 {
                for x in 0..8 {
                    let idx = z * 64 + y * 8 + x;
                    data[idx] = (x + y + z) as f32 * 100.0; // 0 to 2100
                }
            }
        }
        
        let transform = Matrix4::new_translation(&Vector3::new(-4.0, -4.0, -4.0));
        let space_impl = NeuroSpaceImpl::from_affine_matrix4(dims, transform);
        let space = volmath::space::NeuroSpace3(space_impl);
        let volume = DenseVolume3::from_data(space, data);
        
        let (handle, transform) = service.upload_volume_3d(&volume)
            .expect("Failed to upload volume");
        
        // Create bind groups
        service.create_world_space_bind_groups()
            .expect("Failed to create world-space bind groups");
        
        // Test with threshold that should filter out half the pixels
        let layer = LayerInfo {
            atlas_index: handle,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            colormap_id: 0,
            intensity_range: (0.0, 2100.0),
            threshold_range: (1000.0, f32::INFINITY), // Filter out values < 1000
            threshold_mode: ThresholdMode::Range,
            texture_coords: (0.0, 0.0, 1.0, 1.0),
        };
        
        // Set up layer storage
        if let Some(layer_storage) = service.layer_storage_manager.as_mut() {
            let dims = vec![(8u32, 8u32, 8u32)];
            let transforms = vec![transform];
            
            layer_storage.update_layers(
                &service.device,
                &service.queue,
                service.layer_bind_group_layout.as_ref().unwrap(),
                &[layer],
                &dims,
                &transforms,
            );
        }
        
        // Render at z=0
        let frame_ubo = FrameUbo {
            origin_mm: [-4.0, -4.0, 0.0, 1.0],
            u_mm: [8.0, 0.0, 0.0, 0.0],
            v_mm: [0.0, 8.0, 0.0, 0.0],
            atlas_dim: [256, 256, 256],
            _padding_frame: 0,
            target_dim: [10, 10],
            _padding_target: [0, 0],
        };
        service.update_frame_ubo(frame_ubo.origin_mm, frame_ubo.u_mm, frame_ubo.v_mm);
        service.update_crosshair_position([0.0, 0.0, 0.0], false);
        
        let rendered = service.render_to_buffer()
            .expect("Failed to render");
        
        // Count background vs visible pixels
        // Note: The clear color (0.1, 0.1, 0.15, 1.0) in sRGB space is approximately [89, 89, 108, 255]
        // NOT [26, 26, 38, 255] which would be linear RGB
        let background = [89u8, 89, 108, 255];
        let mut background_count = 0;
        let mut visible_count = 0;
        let mut red_count = 0;
        
        println!("Pixel values (detailed):");
        for y in 0..10 {
            for x in 0..10 {
                let idx = (y * 10 + x) * 4;
                let pixel = &rendered[idx..idx+4];
                
                if pixel[0] == 255 && pixel[1] == 0 && pixel[2] == 0 {
                    red_count += 1;
                    print!("R ");
                } else if pixel[0] == background[0] && pixel[1] == background[1] && pixel[2] == background[2] {
                    background_count += 1;
                    print!("B ");
                } else {
                    visible_count += 1;
                    print!("V ");
                }
            }
            println!();
        }
        
        // Print a few actual pixel values
        println!("\nSample pixel RGBA values:");
        for i in 0..5 {
            let idx = i * 40; // Sample every 10th pixel
            println!("  Pixel {}: [{}, {}, {}, {}]", i, 
                     rendered[idx], rendered[idx+1], rendered[idx+2], rendered[idx+3]);
        }
        
        println!("\nBackground pixels: {}", background_count);
        println!("Visible pixels: {}", visible_count);
        println!("Red (debug) pixels: {}", red_count);
        println!("Expected roughly 50% background/visible");
        
        // We should have some background pixels where values were filtered out
        assert!(background_count > 0 || red_count > 0, 
                "Expected some background or red pixels from thresholding, but got {} background and {} red", 
                background_count, red_count);
        assert!(visible_count > 0, "Expected some visible pixels");
    });
}