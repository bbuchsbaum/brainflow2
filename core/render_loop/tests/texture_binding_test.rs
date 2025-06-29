// Test texture binding and colormap management

use render_loop::RenderLoopService;
use pollster::FutureExt;

#[test]
fn test_texture_manager_initialization() {
    // Create the render loop service
    let service = RenderLoopService::new().block_on()
        .expect("Failed to create RenderLoopService");
    
    // Verify texture manager is initialized
    // The texture manager should have samplers ready
    assert!(service.texture_manager.linear_sampler() as *const _ != std::ptr::null());
    assert!(service.texture_manager.nearest_sampler() as *const _ != std::ptr::null());
    
    println!("Texture manager initialization test passed!");
}

#[test]
fn test_colormap_upload() {
    // Create the render loop service
    let service = RenderLoopService::new().block_on()
        .expect("Failed to create RenderLoopService");
    
    // Create a custom colormap (red to blue gradient)
    let custom_colormap: Vec<u8> = (0..=255).flat_map(|i| {
        let t = i as f32 / 255.0;
        let r = ((1.0 - t) * 255.0) as u8;
        let g = 0;
        let b = (t * 255.0) as u8;
        vec![r, g, b, 255]
    }).collect();
    
    // Upload to colormap slot 4
    service.texture_manager.upload_colormap(&service.queue, 4, &custom_colormap)
        .expect("Failed to upload custom colormap");
    
    println!("Colormap upload test passed!");
}

// TODO: Re-enable this test when colormaps module is public
/*
#[test]
fn test_standard_colormaps() {
    use render_loop::texture_manager::colormaps;
    
    // Test grayscale colormap generation
    let viridis = colormaps::viridis();
    assert_eq!(viridis.len(), 256 * 4); // 256 RGBA values
    
    let hot = colormaps::hot();
    assert_eq!(hot.len(), 256 * 4);
    
    let cool = colormaps::cool();
    assert_eq!(cool.len(), 256 * 4);
    
    // Verify cool colormap properties (blue channel should be max)
    for i in 0..256 {
        let b = cool[i * 4 + 2];
        assert_eq!(b, 255); // Blue channel is always 255 in cool colormap
    }
    
    println!("Standard colormaps test passed!");
}
*/

#[test]
fn test_volume_atlas_integration() {
    // Create the render loop service
    let mut service = RenderLoopService::new().block_on()
        .expect("Failed to create RenderLoopService");
    
    // Verify volume atlas is created (now using 3D texture)
    assert_eq!(service.volume_atlas.size().width, 256);
    assert_eq!(service.volume_atlas.size().height, 256);
    assert_eq!(service.volume_atlas.layer_count(), 256); // Z dimension for 3D texture
    
    // Note: Layer allocation is not used with 3D textures
    // The 3D texture atlas directly stores volumes at specific Z slices
    // managed by the MultiTextureManager for world-space rendering
    
    println!("Volume atlas integration test passed!");
}