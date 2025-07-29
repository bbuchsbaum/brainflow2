use render_loop::{RenderLoopService, LayerInfo, BlendMode, ThresholdMode, FrameUbo};
use volmath::DenseVolume3;
use volmath::traits::Volume;
use nalgebra::{Vector3, Matrix4};

#[tokio::main]
async fn main() {
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
    let background = [26u8, 26, 38, 255];
    let mut background_count = 0;
    let mut visible_count = 0;
    
    println!("Pixel values:");
    for y in 0..10 {
        for x in 0..10 {
            let idx = (y * 10 + x) * 4;
            let pixel = &rendered[idx..idx+4];
            
            if pixel[0] == background[0] && pixel[1] == background[1] && pixel[2] == background[2] {
                background_count += 1;
                print!("B ");
            } else {
                visible_count += 1;
                print!("V ");
            }
        }
        println!();
    }
    
    println!("\nBackground pixels: {}", background_count);
    println!("Visible pixels: {}", visible_count);
    println!("Expected roughly 50% of each");
}