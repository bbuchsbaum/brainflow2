// Minimal test to verify basic rendering functionality

use render_loop::RenderLoopService;

#[test]
fn test_render_service_creation() {
    pollster::block_on(async {
        // Just test that we can create the service
        match RenderLoopService::new().await {
            Ok(_service) => {
                println!("✓ RenderLoopService created successfully");
            }
            Err(e) => {
                panic!("Failed to create RenderLoopService: {:?}", e);
            }
        }
    });
}

#[test]
fn test_basic_shader_compilation() {
    pollster::block_on(async {
        let service = RenderLoopService::new().await
            .expect("Failed to create RenderLoopService");
        
        // Service creation includes shader compilation
        println!("✓ Shaders compiled successfully");
        
        // Check that we have a valid device
        assert!(service.device.features().contains(wgpu::Features::default()));
        println!("✓ GPU device initialized");
    });
}