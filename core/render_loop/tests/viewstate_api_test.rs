// Test the ViewState API for declarative rendering

use render_loop::{RenderLoopService, RenderLoopError};
use render_loop::view_state::{ViewId, ViewState, LayerConfig, SliceOrientation};
use render_loop::test_fixtures::{create_test_pattern_volume, TestVolumeSet};
use render_loop::render_state::BlendMode;
use pollster;

/// Test that we can create and render with the ViewState API
#[test]
fn test_viewstate_api_basic() {
    pollster::block_on(async {
        // Create test volume
        let volume = create_test_pattern_volume();
        
        // Initialize render service
        let mut service = RenderLoopService::new().await
            .expect("Failed to create render service");
        
        // Load shaders
        service.load_shaders()
            .expect("Failed to load shaders");
        
        // Register volume
        service.register_volume_with_upload(
            "test-volume".to_string(),
            &volume,
            wgpu::TextureFormat::R8Unorm
        ).expect("Failed to register volume");
        
        // Create view state
        let view_id = ViewId::new("test-view");
        let state = ViewState {
            layout_version: ViewState::CURRENT_VERSION,
            camera: render_loop::view_state::CameraState {
                world_center: [32.0, 32.0, 12.0],
                fov_mm: 64.0,
                orientation: SliceOrientation::Axial,
            },
            crosshair_world: [32.0, 32.0, 12.0],
            layers: vec![LayerConfig {
                volume_id: "test-volume".to_string(),
                opacity: 1.0,
                colormap_id: 0,
                blend_mode: BlendMode::Normal,
                intensity_window: (0.0, 1.0),
                threshold: None,
                visible: true,
            }],
            viewport_size: [512, 512],
            show_crosshair: true,
        };
        
        // Request frame
        let result = service.request_frame(view_id, state).await
            .expect("Failed to request frame");
        
        // Validate result
        assert_eq!(result.dimensions, [512, 512]);
        assert_eq!(result.rendered_layers, vec!["test-volume"]);
        assert!(!result.used_cpu_fallback);
        
        // Image data should exist (even if placeholder for now)
        assert_eq!(result.image_data.len(), 512 * 512 * 4);
    });
}

/// Test multi-resolution layer support
#[test]
fn test_viewstate_multi_resolution() {
    pollster::block_on(async {
        // Create aligned test volumes
        let volumes = TestVolumeSet::create_aligned();
        
        let mut service = RenderLoopService::new().await
            .expect("Failed to create render service");
        
        service.load_shaders()
            .expect("Failed to load shaders");
        
        // Register all volumes
        service.register_volume_with_upload(
            "anatomical".to_string(),
            &volumes.anatomical,
            wgpu::TextureFormat::R8Unorm
        ).expect("Failed to register anatomical");
        
        service.register_volume_with_upload(
            "functional".to_string(),
            &volumes.functional,
            wgpu::TextureFormat::R32Float
        ).expect("Failed to register functional");
        
        service.register_volume_with_upload(
            "detail".to_string(),
            &volumes.detail_patch,
            wgpu::TextureFormat::R16Uint
        ).expect("Failed to register detail");
        
        // Create view state with multiple layers
        let view_id = ViewId::new("multi-res-view");
        let state = ViewState {
            layout_version: ViewState::CURRENT_VERSION,
            camera: render_loop::view_state::CameraState {
                world_center: [0.0, 0.0, 0.0], // World origin
                fov_mm: 200.0,
                orientation: SliceOrientation::Axial,
            },
            crosshair_world: [0.0, 0.0, 0.0],
            layers: vec![
                // Base anatomical layer
                LayerConfig {
                    volume_id: "anatomical".to_string(),
                    opacity: 1.0,
                    colormap_id: 0,
                    blend_mode: BlendMode::Normal,
                    intensity_window: (0.0, 1.0),
                    threshold: None,
                    visible: true,
                },
                // Functional overlay with transparency
                LayerConfig {
                    volume_id: "functional".to_string(),
                    opacity: 0.7,
                    colormap_id: 1, // Hot colormap
                    blend_mode: BlendMode::Additive,
                    intensity_window: (0.1, 0.8),
                    threshold: Some(render_loop::view_state::ThresholdConfig {
                        mode: render_loop::render_state::ThresholdMode::Above,
                        range: (0.3, 1.0),
                    }),
                    visible: true,
                },
                // Detail patch (hidden by default)
                LayerConfig {
                    volume_id: "detail".to_string(),
                    opacity: 1.0,
                    colormap_id: 0,
                    blend_mode: BlendMode::Normal,
                    intensity_window: (0.0, 1.0),
                    threshold: None,
                    visible: false,
                },
            ],
            viewport_size: [768, 768],
            show_crosshair: true,
        };
        
        // Request frame
        let result = service.request_frame(view_id, state).await
            .expect("Failed to request multi-res frame");
        
        // Validate result
        assert_eq!(result.dimensions, [768, 768]);
        assert_eq!(result.rendered_layers.len(), 2); // Only visible layers
        assert!(result.rendered_layers.contains(&"anatomical".to_string()));
        assert!(result.rendered_layers.contains(&"functional".to_string()));
        assert!(!result.rendered_layers.contains(&"detail".to_string())); // Hidden
    });
}

/// Test view state validation
#[test]
fn test_viewstate_validation() {
    // Test invalid version
    let mut state = ViewState::default_for_volume("test".to_string(), [64, 64, 25]);
    state.layout_version = 999;
    assert!(state.validate().is_err());
    
    // Test zero viewport
    state.layout_version = ViewState::CURRENT_VERSION;
    state.viewport_size = [0, 512];
    assert!(state.validate().is_err());
    
    // Test no layers
    state.viewport_size = [512, 512];
    state.layers.clear();
    assert!(state.validate().is_err());
    
    // Test invalid opacity
    state.layers.push(LayerConfig {
        volume_id: "test".to_string(),
        opacity: 1.5, // Invalid
        colormap_id: 0,
        blend_mode: BlendMode::Normal,
        intensity_window: (0.0, 1.0),
        threshold: None,
        visible: true,
    });
    assert!(state.validate().is_err());
    
    // Fix and validate
    state.layers[0].opacity = 1.0;
    assert!(state.validate().is_ok());
}

/// Test different slice orientations
#[test]
fn test_viewstate_orientations() {
    pollster::block_on(async {
        let volume = create_test_pattern_volume();
        let mut service = RenderLoopService::new().await.unwrap();
        service.load_shaders().unwrap();
        
        service.register_volume_with_upload(
            "test-vol".to_string(),
            &volume,
            wgpu::TextureFormat::R8Unorm
        ).unwrap();
        
        // Test each orientation
        for orientation in &[SliceOrientation::Axial, SliceOrientation::Coronal, SliceOrientation::Sagittal] {
            let view_id = ViewId::new(format!("view-{:?}", orientation));
            let state = ViewState {
                layout_version: ViewState::CURRENT_VERSION,
                camera: render_loop::view_state::CameraState {
                    world_center: [32.0, 32.0, 12.0],
                    fov_mm: 64.0,
                    orientation: *orientation,
                },
                crosshair_world: [32.0, 32.0, 12.0],
                layers: vec![LayerConfig {
                    volume_id: "test-vol".to_string(),
                    opacity: 1.0,
                    colormap_id: 0,
                    blend_mode: BlendMode::Normal,
                    intensity_window: (0.0, 1.0),
                    threshold: None,
                    visible: true,
                }],
                viewport_size: [256, 256],
                show_crosshair: true,
            };
            
            let result = service.request_frame(view_id, state).await
                .expect(&format!("Failed for orientation {:?}", orientation));
            
            assert_eq!(result.dimensions, [256, 256]);
            assert!(result.render_time_ms >= 0.0);
        }
    });
}

/// Test camera parameter conversion
#[test]
fn test_camera_to_frame_params() {
    let state = ViewState {
        layout_version: ViewState::CURRENT_VERSION,
        camera: render_loop::view_state::CameraState {
            world_center: [100.0, 100.0, 50.0],
            fov_mm: 200.0,
            orientation: SliceOrientation::Axial,
        },
        crosshair_world: [100.0, 100.0, 50.0],
        layers: vec![],
        viewport_size: [512, 512],
        show_crosshair: true,
    };
    
    let (origin, u, v) = state.camera_to_frame_params();
    
    // For axial view centered at (100,100,50) with 200mm FOV
    // Origin should be at bottom-left of view plane
    assert_eq!(origin, [0.0, 0.0, 50.0, 1.0]);
    assert_eq!(u, [200.0, 0.0, 0.0, 0.0]); // X direction, full FOV
    assert_eq!(v, [0.0, 200.0, 0.0, 0.0]); // Y direction, full FOV
}