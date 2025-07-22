// Test to validate that volumes display correctly (no black screen)

use render_loop::{RenderLoopService, RenderLoopError, FrameUbo, LayerUboStd140};
use render_loop::render_state::{LayerInfo, BlendMode, ThresholdMode};
use render_loop::test_fixtures::create_test_pattern_volume;
use volmath::{DenseVolume3, NeuroSpaceExt};
use nalgebra::{Matrix4, Vector3, Point3};
use pollster;
use wgpu::TextureFormat;

/// Core test: Ensure a simple volume renders without black screen
#[test]
fn test_volume_renders_not_black() {
    pollster::block_on(async {
        // Create test volume with known pattern
        let volume = create_test_pattern_volume();
        
        // Initialize render service
        let mut service = RenderLoopService::new().await
            .expect("Failed to create render service");
        
        // Create render target
        let width = 512;
        let height = 512;
        service.create_offscreen_target(width, height)
            .expect("Failed to create render target");
        
        // Upload volume
        let (layer_index, _transform) = service.upload_volume_3d(&volume)
            .expect("Failed to upload volume");
        
        // Set up view for axial slice through center
        let world_center = Vector3::new(0.0, 0.0, 0.0);
        let frame_ubo = create_axial_frame_ubo(world_center, width, height);
        
        // Set up layer info
        let layer_info = LayerInfo {
            atlas_index: layer_index,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            colormap_id: 0, // Grayscale
            intensity_range: (0.0, 1.0), // For U8 normalized data
            threshold_range: (0.0, 1.0),
            threshold_mode: ThresholdMode::Range,
            texture_coords: (0.0, 0.0, 1.0, 1.0),
            is_mask: false,
        };
        
        // Configure world-to-voxel transform
        // For 64x64x25 volume, center at (32, 32, 12.5)
        let world_to_voxel = Matrix4::new(
            1.0, 0.0, 0.0, 32.0,
            0.0, 1.0, 0.0, 32.0,
            0.0, 0.0, 1.0, 12.5,
            0.0, 0.0, 0.0, 1.0,
        );
        
        // Update render state
        service.update_frame_ubo(frame_ubo.origin_mm, frame_ubo.u_mm, frame_ubo.v_mm);
        service.update_layer_uniforms_direct(
            &[layer_info],
            &[(64, 64, 25)],
            &[world_to_voxel],
        );
        
        // Enable crosshair at center
        service.update_crosshair_position(world_center.into(), true);
        
        // Render frame
        let image_data = service.render_to_buffer()
            .expect("Failed to render");
        
        // Validate render output
        assert_eq!(image_data.len(), (width * height * 4) as usize);
        
        // Check center pixel is not black
        assert_center_pixel_visible(&image_data, width, height);
        
        // Check we can see the test pattern
        assert_test_pattern_visible(&image_data, width, height);
        
        // Save image for manual inspection if needed
        #[cfg(feature = "save_test_images")]
        save_test_image(&image_data, width, height, "volume_display_test.png");
    });
}

/// Test that binary masks render correctly
#[test]
fn test_binary_mask_renders_correctly() {
    pollster::block_on(async {
        // Create binary mask
        let mask = create_binary_mask();
        
        let mut service = RenderLoopService::new().await
            .expect("Failed to create render service");
        
        service.create_offscreen_target(512, 512)
            .expect("Failed to create render target");
        
        // Upload as U8 (will be normalized to 0-1 by R8Unorm)
        let (layer_index, _transform) = service.upload_volume_3d(&mask)
            .expect("Failed to upload mask");
        
        // Configure as mask
        let layer_info = LayerInfo {
            atlas_index: layer_index,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            colormap_id: 0,
            intensity_range: (0.0, 1.0), // R8Unorm normalizes to this
            threshold_range: (0.0, 1.0),
            threshold_mode: ThresholdMode::Range,
            texture_coords: (0.0, 0.0, 1.0, 1.0),
            is_mask: false,
        };
        
        let world_to_voxel = Matrix4::new(
            1.0, 0.0, 0.0, 32.0,
            0.0, 1.0, 0.0, 32.0,
            0.0, 0.0, 1.0, 12.0,
            0.0, 0.0, 0.0, 1.0,
        );
        
        let frame_ubo = create_axial_frame_ubo(Vector3::zeros(), 512, 512);
        service.update_frame_ubo(frame_ubo.origin_mm, frame_ubo.u_mm, frame_ubo.v_mm);
        service.update_layer_uniforms_direct(
            &[layer_info],
            &[(64, 64, 25)],
            &[world_to_voxel],
        );
        
        let image_data = service.render_to_buffer()
            .expect("Failed to render mask");
        
        // Binary mask should show clear on/off regions
        assert_binary_pattern_visible(&image_data, 512, 512);
    });
}

/// Test crosshair renders at correct position
#[test]
fn test_crosshair_position() {
    pollster::block_on(async {
        let volume = create_test_pattern_volume();
        let mut service = RenderLoopService::new().await
            .expect("Failed to create render service");
        
        service.create_offscreen_target(512, 512)
            .expect("Failed to create render target");
        
        let (layer_index, _transform) = service.upload_volume_3d(&volume)
            .expect("Failed to upload");
        
        // Place crosshair at known world position
        let crosshair_world = Vector3::new(10.0, 10.0, 0.0);
        
        let layer_info = LayerInfo {
            atlas_index: layer_index,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            colormap_id: 0,
            intensity_range: (0.0, 1.0),
            threshold_range: (0.0, 1.0),
            threshold_mode: ThresholdMode::Range,
            texture_coords: (0.0, 0.0, 1.0, 1.0),
            is_mask: false,
        };
        
        let world_to_voxel = Matrix4::new(
            1.0, 0.0, 0.0, 32.0,
            0.0, 1.0, 0.0, 32.0,
            0.0, 0.0, 1.0, 12.5,
            0.0, 0.0, 0.0, 1.0,
        );
        
        let frame_ubo = create_axial_frame_ubo(Vector3::zeros(), 512, 512);
        service.update_frame_ubo(frame_ubo.origin_mm, frame_ubo.u_mm, frame_ubo.v_mm);
        service.update_layer_uniforms_direct(
            &[layer_info],
            &[(64, 64, 25)],
            &[world_to_voxel],
        );
        service.update_crosshair_position(crosshair_world.into(), true);
        
        let image_data = service.render_to_buffer()
            .expect("Failed to render");
        
        // TODO: Verify crosshair is visible at expected position
        assert_crosshair_visible(&image_data, 512, 512);
    });
}

// Helper functions

fn create_axial_frame_ubo(center: Vector3<f32>, width: u32, height: u32) -> FrameUbo {
    // Axial view: looking down Z axis
    // X maps to screen X, Y maps to screen Y
    let fov = 128.0; // 128mm field of view
    
    FrameUbo {
        origin_mm: [
            center.x - fov / 2.0,
            center.y - fov / 2.0,
            center.z,
            1.0
        ],
        u_mm: [fov, 0.0, 0.0, 0.0], // X direction
        v_mm: [0.0, fov, 0.0, 0.0], // Y direction
        atlas_dim: [256, 256, 256], // Typical atlas size
        _padding_frame: 0,
        target_dim: [width, height],
        _padding_target: [0, 0],
    }
}

fn create_binary_mask() -> DenseVolume3<u8> {
    let dims = [64, 64, 25];
    let mut data = vec![0u8; 64 * 64 * 25];
    
    // Create a circular mask in middle slices
    for z in 10..15 {
        for y in 0..64 {
            for x in 0..64 {
                let dx = x as f32 - 32.0;
                let dy = y as f32 - 32.0;
                if dx * dx + dy * dy < 400.0 { // radius 20
                    data[z * 64 * 64 + y * 64 + x] = 255;
                }
            }
        }
    }
    
    use volmath::space::{NeuroSpace3, NeuroSpaceImpl};
    let space_impl = <volmath::NeuroSpace as NeuroSpaceExt>::from_affine_matrix4(dims, Matrix4::identity()).expect("Failed to create NeuroSpace");
    let space = NeuroSpace3::new(space_impl);
    DenseVolume3::from_data(space.0, data)
}

fn assert_center_pixel_visible(image_data: &[u8], width: u32, height: u32) {
    let cx = width / 2;
    let cy = height / 2;
    let idx = ((cy * width + cx) * 4) as usize;
    
    let r = image_data[idx];
    let g = image_data[idx + 1];
    let b = image_data[idx + 2];
    let a = image_data[idx + 3];
    
    println!("Center pixel RGBA: ({}, {}, {}, {})", r, g, b, a);
    
    assert!(r > 0 || g > 0 || b > 0, 
            "Center pixel is black! This indicates rendering failed.");
}

fn assert_test_pattern_visible(image_data: &[u8], width: u32, height: u32) {
    // Check for the plus sign pattern in the center
    let mut bright_pixels = 0;
    let mut dark_pixels = 0;
    
    for y in (height / 2 - 50)..(height / 2 + 50) {
        for x in (width / 2 - 50)..(width / 2 + 50) {
            let idx = ((y * width + x) * 4) as usize;
            let brightness = image_data[idx] as u32 + 
                           image_data[idx + 1] as u32 + 
                           image_data[idx + 2] as u32;
            
            if brightness > 300 {
                bright_pixels += 1;
            } else if brightness < 100 {
                dark_pixels += 1;
            }
        }
    }
    
    println!("Bright pixels: {}, Dark pixels: {}", bright_pixels, dark_pixels);
    assert!(bright_pixels > 100, "Not enough bright pixels - pattern not visible");
    assert!(dark_pixels > 100, "Not enough dark pixels - no contrast");
}

fn assert_binary_pattern_visible(image_data: &[u8], width: u32, height: u32) {
    // For binary mask, should see clear on/off regions
    let mut on_pixels = 0;
    let mut off_pixels = 0;
    
    for i in (0..image_data.len()).step_by(4) {
        let brightness = image_data[i] as u32;
        if brightness > 200 {
            on_pixels += 1;
        } else if brightness < 50 {
            off_pixels += 1;
        }
    }
    
    let total_pixels = (width * height) as usize;
    println!("Binary mask - On: {}, Off: {}, Total: {}", on_pixels, off_pixels, total_pixels);
    
    assert!(on_pixels > 1000, "Not enough 'on' pixels in binary mask");
    assert!(off_pixels > 1000, "Not enough 'off' pixels in binary mask");
}

fn assert_crosshair_visible(image_data: &[u8], width: u32, height: u32) {
    // Look for green pixels (crosshair is typically green)
    let mut green_pixels = 0;
    
    for i in (0..image_data.len()).step_by(4) {
        let r = image_data[i];
        let g = image_data[i + 1];
        let b = image_data[i + 2];
        
        // Green crosshair
        if g > 200 && r < 100 && b < 100 {
            green_pixels += 1;
        }
    }
    
    println!("Found {} green pixels (crosshair)", green_pixels);
    assert!(green_pixels > 10, "Crosshair not visible");
}

#[cfg(feature = "save_test_images")]
fn save_test_image(image_data: &[u8], width: u32, height: u32, filename: &str) {
    use image::{ImageBuffer, Rgba};
    use std::path::Path;
    
    let img = ImageBuffer::<Rgba<u8>, _>::from_raw(width, height, image_data.to_vec())
        .expect("Failed to create image buffer");
    
    let output_dir = Path::new("test_output");
    std::fs::create_dir_all(output_dir).ok();
    
    let output_path = output_dir.join(filename);
    img.save(&output_path).expect("Failed to save test image");
    
    println!("Test image saved to: {:?}", output_path);
}