// Test shader compilation with wgpu 0.20

use pollster::FutureExt;
use render_loop::shaders::{sources, ShaderManager};

#[test]
fn test_shader_compilation() {
    // Create wgpu instance and adapter
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
        backends: wgpu::Backends::all(),
        ..Default::default()
    });

    let adapter = instance
        .request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::default(),
            compatible_surface: None,
            force_fallback_adapter: false,
        })
        .block_on()
        .expect("Failed to find adapter");

    let (device, _queue) = adapter
        .request_device(
            &wgpu::DeviceDescriptor {
                label: Some("Test Device"),
                required_features: wgpu::Features::empty(),
                required_limits: wgpu::Limits::default(),
            },
            None,
        )
        .block_on()
        .expect("Failed to create device");

    let mut shader_manager = ShaderManager::new();

    // Test basic shader compilation
    let _basic_shader = shader_manager
        .load_shader(&device, "basic", sources::BASIC)
        .expect("Failed to compile basic shader");

    // Test slice shader compilation
    let _slice_shader = shader_manager
        .load_shader(&device, "slice_simplified", sources::SLICE_SIMPLIFIED)
        .expect("Failed to compile slice shader");

    // Test test shader compilation
    let _test_shader = shader_manager
        .load_shader(&device, "test", sources::TEST)
        .expect("Failed to compile test shader");

    // Verify shaders are cached
    assert!(shader_manager.get_shader("basic").is_some());
    assert!(shader_manager.get_shader("slice_simplified").is_some());
    assert!(shader_manager.get_shader("test").is_some());
}

#[test]
fn test_shader_layouts() {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
        backends: wgpu::Backends::all(),
        ..Default::default()
    });

    let adapter = instance
        .request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::default(),
            compatible_surface: None,
            force_fallback_adapter: false,
        })
        .block_on()
        .expect("Failed to find adapter");

    let (device, _queue) = adapter
        .request_device(
            &wgpu::DeviceDescriptor {
                label: Some("Test Device"),
                required_features: wgpu::Features::empty(),
                required_limits: wgpu::Limits::default(),
            },
            None,
        )
        .block_on()
        .expect("Failed to create device");

    // Test bind group layout creation
    let _frame_layout = render_loop::shaders::layouts::create_frame_layout(&device);

    let _layer_layout = render_loop::shaders::layouts::create_layer_layout(&device);

    let _texture_layout = render_loop::shaders::layouts::create_texture_layout(&device);

    // If we got here without panicking, the layouts were created successfully
}
