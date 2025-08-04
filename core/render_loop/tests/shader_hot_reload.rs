// Test shader hot-reload functionality

use pollster::FutureExt;
use render_loop::RenderLoopService;
use std::fs;
use std::path::Path;
use std::thread;
use std::time::Duration;

#[test]
fn test_shader_hot_reload() {
    // Skip test if not running from workspace root
    let shader_path = Path::new("core/render_loop/shaders/test.wgsl");
    if !shader_path.exists() {
        println!("Skipping hot-reload test - must run from workspace root");
        return;
    }

    // Create the render loop service
    let mut service = RenderLoopService::new()
        .block_on()
        .expect("Failed to create RenderLoopService");

    // Load initial shaders
    service.load_shaders().expect("Failed to load shaders");

    // Enable hot-reload
    service
        .enable_shader_hot_reload()
        .expect("Failed to enable shader hot-reload");

    // Read the original test shader content
    let original_content = fs::read_to_string(shader_path).expect("Failed to read test shader");

    // Modify the shader file (just add a comment)
    let modified_content = format!("// Modified at test time\n{}", original_content);
    fs::write(shader_path, &modified_content).expect("Failed to write modified shader");

    // Give the watcher time to detect the change
    thread::sleep(Duration::from_millis(1000));

    // Check for updates
    let updated = service
        .check_shader_updates()
        .expect("Failed to check shader updates");

    // The test shader isn't used by the pipeline, so updated should be false
    assert!(!updated, "Test shader shouldn't trigger pipeline update");

    // But the shader should be reloaded in the manager
    assert!(service.shader_manager.get_shader("test").is_some());

    // Restore original content
    fs::write(shader_path, &original_content).expect("Failed to restore shader");

    println!("Shader hot-reload test passed!");
}

#[test]
fn test_pipeline_recreation_on_slice_shader_change() {
    // Skip test if not running from workspace root
    let shader_path = Path::new("core/render_loop/shaders/slice.wgsl");
    if !shader_path.exists() {
        println!("Skipping pipeline recreation test - must run from workspace root");
        return;
    }

    // Create the render loop service
    let mut service = RenderLoopService::new()
        .block_on()
        .expect("Failed to create RenderLoopService");

    // Load initial shaders
    service.load_shaders().expect("Failed to load shaders");

    // Create initial pipeline
    service.surface_config = Some(wgpu::SurfaceConfiguration {
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
        format: wgpu::TextureFormat::Bgra8UnormSrgb,
        width: 800,
        height: 600,
        present_mode: wgpu::PresentMode::Fifo,
        desired_maximum_frame_latency: 2,
        alpha_mode: wgpu::CompositeAlphaMode::Auto,
        view_formats: vec![],
    });

    service
        ._create_render_pipeline()
        .expect("Failed to create initial pipeline");

    // Enable hot-reload
    service
        .enable_shader_hot_reload()
        .expect("Failed to enable shader hot-reload");

    // Read the original slice shader
    let original_content = fs::read_to_string(shader_path).expect("Failed to read slice shader");

    // Modify the shader (just add a comment)
    let modified_content = format!("// Pipeline recreation test\n{}", original_content);
    fs::write(shader_path, &modified_content).expect("Failed to write modified shader");

    // Give the watcher time to detect the change
    thread::sleep(Duration::from_millis(1000));

    // Check for updates
    let updated = service
        .check_shader_updates()
        .expect("Failed to check shader updates");

    // The slice shader is used by the pipeline, so it should be recreated
    assert!(
        updated,
        "Slice shader change should trigger pipeline update"
    );

    // Verify pipeline can still be retrieved (it will be recreated on demand)
    let _pipeline = service
        .get_pipeline("slice")
        .expect("Failed to get slice pipeline after hot reload");

    // Restore original content
    fs::write(shader_path, &original_content).expect("Failed to restore shader");

    println!("Pipeline recreation test passed!");
}
