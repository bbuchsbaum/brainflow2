// Simple test to verify basic rendering works

use render_loop::{RenderLoopService, LayerInfo, BlendMode, ThresholdMode};
use volmath::dense_vol::DenseVol;
use nalgebra::{Vector3, Matrix4};

fn main() {
    println!("Testing basic render pipeline...");
    
    // Create test volume
    let volume = DenseVol::new_with_transform(
        Vector3::new(8, 8, 8),
        Matrix4::new_translation(&Vector3::new(-4.0, -4.0, -4.0)),
        |x, y, z| {
            // Simple gradient
            (x + y + z) as f32 / 21.0 * 1000.0
        }
    );
    
    // Run async code
    pollster::block_on(async {
        // Create render service
        let mut service = RenderLoopService::new().await
            .expect("Failed to create RenderLoopService");
        
        println!("RenderLoopService created successfully!");
        
        // Upload volume
        let (texture_index, transform) = service.upload_volume_3d(&volume)
            .expect("Failed to upload volume");
        
        println!("Volume uploaded: texture_index = {}, transform = {:?}", texture_index, transform);
        
        // Create layer info
        let layer = LayerInfo {
            atlas_index: texture_index,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            colormap_id: 0,
            intensity_range: (0.0, 1000.0),
            threshold_range: (-f32::INFINITY, f32::INFINITY),
            threshold_mode: ThresholdMode::Range,
            texture_coords: (0.0, 0.0, 1.0, 1.0),
        };
        
        // Update layer uniforms
        service.update_layer_uniforms_direct(
            &[layer],
            &[(8, 8, 8)],
            &[transform],
        );
        
        println!("Layer uniforms updated");
        
        // Update frame UBO (slice parameters)
        service.update_frame_ubo(
            [0.0, 0.0, 0.0, 1.0], // origin
            [8.0, 0.0, 0.0, 0.0], // u vector
            [0.0, 8.0, 0.0, 0.0], // v vector
        );
        
        println!("Frame UBO updated");
        
        // Try to render
        match service.render_to_buffer() {
            Ok(data) => {
                println!("Render successful! Buffer size: {} bytes", data.len());
                
                // Check if we got expected size (256x256x4)
                let expected_size = 256 * 256 * 4;
                if data.len() == expected_size {
                    println!("✓ Buffer size matches expected (256x256 RGBA)");
                } else {
                    println!("⚠ Buffer size mismatch: expected {}, got {}", expected_size, data.len());
                }
                
                // Check if buffer has non-zero data
                let non_zero_count = data.iter().filter(|&&b| b != 0).count();
                println!("Non-zero bytes: {} ({:.1}%)", non_zero_count, 
                         non_zero_count as f32 / data.len() as f32 * 100.0);
                
                // Save as image
                if let Ok(img) = image::ImageBuffer::<image::Rgba<u8>, _>::from_raw(256, 256, data) {
                    img.save("test_render_output.png").ok();
                    println!("✓ Saved test image to test_render_output.png");
                }
            }
            Err(e) => {
                println!("❌ Render failed: {:?}", e);
            }
        }
    });
}