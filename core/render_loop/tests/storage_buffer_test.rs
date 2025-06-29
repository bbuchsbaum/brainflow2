// Test the storage buffer version of the shader

use render_loop::{RenderLoopService, RenderLoopError};
use render_loop::view_state::{ViewId, ViewState, LayerConfig, SliceOrientation};
use render_loop::test_fixtures::{create_test_pattern_volume, TestVolumeSet};
use render_loop::render_state::BlendMode;
use pollster;

/// Test that storage buffer version can handle many layers
#[test]
fn test_storage_buffer_many_layers() {
    pollster::block_on(async {
        // Create test volumes - let's create many to exceed the 8-layer UBO limit
        let mut service = RenderLoopService::new().await
            .expect("Failed to create render service");
        
        // Enable storage buffer mode (we'll need to add this feature)
        // service.enable_storage_buffers();
        
        // Load shaders
        service.load_shaders()
            .expect("Failed to load shaders");
        
        // Register 12 volumes to exceed the 8-layer UBO limit
        let base_volume = create_test_pattern_volume();
        
        for i in 0..12 {
            service.register_volume_with_upload(
                format!("volume-{}", i),
                &base_volume,
                wgpu::TextureFormat::R8Unorm
            ).expect(&format!("Failed to register volume {}", i));
        }
        
        // Create view state with all 12 layers
        let view_id = ViewId::new("multi-layer-view");
        let mut layers = Vec::new();
        
        for i in 0..12 {
            layers.push(LayerConfig {
                volume_id: format!("volume-{}", i),
                opacity: 0.8,
                colormap_id: (i % 4) as u32, // Cycle through colormaps
                blend_mode: BlendMode::Normal,
                intensity_window: (0.0, 1.0),
                threshold: None,
                visible: true,
            });
        }
        
        let state = ViewState {
            layout_version: ViewState::CURRENT_VERSION,
            camera: render_loop::view_state::CameraState {
                world_center: [32.0, 32.0, 12.0],
                fov_mm: 64.0,
                orientation: SliceOrientation::Axial,
            },
            crosshair_world: [32.0, 32.0, 12.0],
            layers,
            viewport_size: [512, 512],
            show_crosshair: true,
        };
        
        // With storage buffers, all 12 layers should work
        let result = service.request_frame(view_id, state).await;
        
        // We now use storage buffers which support more than 8 layers
        match result {
            Ok(frame_result) => {
                println!("Successfully rendered {} layers", frame_result.rendered_layers.len());
                assert_eq!(frame_result.rendered_layers.len(), 12, "Should render all 12 layers with storage buffers");
            }
            Err(e) => {
                panic!("Failed to render 12 layers: {:?}", e);
            }
        }
    });
}

/// Test dynamic resize of storage buffer
#[test]
fn test_storage_buffer_dynamic_resize() {
    use render_loop::layer_storage::LayerStorageManager;
    use render_loop::render_state::{LayerInfo, ThresholdMode};
    use nalgebra::Matrix4;
    
    pollster::block_on(async {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::default());
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions::default())
            .await
            .expect("Failed to get adapter");
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor::default(), None)
            .await
            .expect("Failed to get device");
        
        // Create storage manager with small initial capacity
        let mut manager = LayerStorageManager::new(&device, 2);
        let layout = LayerStorageManager::create_bind_group_layout(&device);
        manager.create_bind_group(&device, &layout);
        
        // Test adding layers beyond initial capacity
        for batch_size in [3, 5, 10, 20] {
            let layers: Vec<LayerInfo> = (0..batch_size).map(|i| LayerInfo {
                atlas_index: i as u32,
                opacity: 1.0,
                blend_mode: BlendMode::Normal,
                colormap_id: 0,
                intensity_range: (0.0, 1.0),
                threshold_range: (0.0, 1.0),
                threshold_mode: ThresholdMode::Range,
                texture_coords: (0.0, 0.0, 1.0, 1.0),
            }).collect();
            
            let dims = vec![(256, 256, 128); batch_size];
            let transforms = vec![Matrix4::identity(); batch_size];
            
            manager.update_layers(&device, &queue, &layout, &layers, &dims, &transforms);
            
            assert_eq!(manager.active_count(), batch_size as u32);
            assert!(manager.capacity() >= batch_size);
            println!("Successfully handled {} layers, capacity: {}", batch_size, manager.capacity());
        }
    });
}

/// Test storage buffer shader compilation
#[test]
fn test_storage_shader_compilation() {
    use render_loop::shaders::{ShaderManager, sources};
    
    pollster::block_on(async {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::default());
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions::default())
            .await
            .expect("Failed to get adapter");
        let (device, _queue) = adapter
            .request_device(&wgpu::DeviceDescriptor::default(), None)
            .await
            .expect("Failed to get device");
        
        let mut shader_manager = ShaderManager::new();
        
        // Validate the world-space shader which uses storage buffers
        let validation = ShaderManager::validate_shader(sources::SLICE_WORLD_SPACE, "slice_world_space");
        assert!(validation.valid, "World-space shader validation failed: {:?}", validation.errors);
        
        // Load the shader
        let result = shader_manager.load_shader_validated(
            &device,
            "slice_world_space",
            sources::SLICE_WORLD_SPACE
        );
        
        assert!(result.is_ok(), "Failed to load world-space shader: {:?}", result.err());
        
        let (_module, validation) = result.unwrap();
        if !validation.warnings.is_empty() {
            println!("World-space shader warnings: {:?}", validation.warnings);
        }
    });
}