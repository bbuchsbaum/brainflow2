// Test shader loading integration with RenderLoopService

use render_loop::RenderLoopService;
use pollster::FutureExt;

#[test]
fn test_shader_loading_in_service() {
    // Create the render loop service
    let mut service = RenderLoopService::new().block_on()
        .expect("Failed to create RenderLoopService");
    
    // Load shaders
    service.load_shaders()
        .expect("Failed to load shaders");
    
    // Verify shaders are loaded
    assert!(service.shader_manager.get_shader("slice_world_space").is_some());
    assert!(service.shader_manager.get_shader("slice_simplified").is_some());
    
    println!("Shader loading test passed!");
}

#[test]
fn test_pipeline_creation() {
    // Create the render loop service
    let mut service = RenderLoopService::new().block_on()
        .expect("Failed to create RenderLoopService");
    
    // Load shaders first
    service.load_shaders()
        .expect("Failed to load shaders");
    
    // Create an offscreen render target to set up the surface format
    service.create_offscreen_target(800, 600)
        .expect("Failed to create offscreen render target");
    
    // Set up a dummy surface config for the offscreen format
    service.surface_config = Some(wgpu::SurfaceConfiguration {
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
        format: wgpu::TextureFormat::Rgba8UnormSrgb, // Match offscreen format
        width: 800,
        height: 600,
        present_mode: wgpu::PresentMode::Fifo,
        desired_maximum_frame_latency: 2,
        alpha_mode: wgpu::CompositeAlphaMode::Auto,
        view_formats: vec![],
    });
    
    // Ensure the pipeline is created
    service.ensure_pipeline("slice_world_space")
        .expect("Failed to ensure slice_world_space pipeline");
    
    // Verify pipeline was created by trying to get it
    let _pipeline = service.get_pipeline("slice_world_space")
        .expect("Failed to get slice_world_space pipeline");
    
    println!("Pipeline creation test passed!");
}