// Test the ViewState API for declarative rendering

use pollster;
use render_loop::render_state::{BlendMode, ThresholdMode};
use render_loop::test_fixtures::{create_test_pattern_volume, TestVolumeSet};
use render_loop::view_state::{LayerConfig, SliceOrientation, ViewId, ViewState};
use render_loop::RenderLoopService;

/// Test that we can create and render with the ViewState API
#[test]
fn test_viewstate_api_basic() {
    pollster::block_on(async {
        // Create test volume
        let volume = create_test_pattern_volume();

        // Initialize render service
        let mut service = RenderLoopService::new()
            .await
            .expect("Failed to create render service");

        // Load shaders
        service.load_shaders().expect("Failed to load shaders");

        // Register volume
        service
            .register_volume_with_upload(
                "test-volume".to_string(),
                &volume,
                wgpu::TextureFormat::R8Unorm,
            )
            .expect("Failed to register volume");

        // Create view state
        let view_id = ViewId::new("test-view");
        let state = ViewState::from_basic_params(
            "test-volume".to_string(),
            [32.0, 32.0, 12.0],
            SliceOrientation::Axial,
            64.0,
            [512, 512],
            (0.0, 1.0),
        );

        // Request frame
        let result = service
            .request_frame(view_id, state)
            .await
            .expect("Failed to request frame");

        // Validate result
        assert_eq!(result.dimensions, [512, 512]);
        assert_eq!(result.rendered_layers, vec!["test-volume"]);
        assert!(!result.used_cpu_fallback);

        // Image data should exist (even if placeholder for now)
        assert_eq!(result.image_data.len(), 512 * 512 * 4);
    });
}

/// Regression: threshold=None must not suppress the full intensity window.
#[test]
fn test_set_viewstate_without_threshold_keeps_layer_visible() {
    pollster::block_on(async {
        let volume = create_test_pattern_volume();

        let mut service = RenderLoopService::new()
            .await
            .expect("Failed to create render service");
        service.load_shaders().expect("Failed to load shaders");

        service
            .register_volume_with_upload(
                "test-volume".to_string(),
                &volume,
                wgpu::TextureFormat::R8Unorm,
            )
            .expect("Failed to register volume");

        let state = ViewState::from_basic_params(
            "test-volume".to_string(),
            [32.0, 32.0, 12.0],
            SliceOrientation::Axial,
            64.0,
            [256, 256],
            (0.0, 1.0),
        );
        assert!(state.layers[0].threshold.is_none());

        service
            .set_view_state(&state)
            .expect("Failed to prepare view state");

        let layer = service
            .layer_state_manager
            .get_layer(0)
            .expect("view state should create one active layer");
        assert_eq!(layer.intensity_range, (0.0, 1.0));
        assert_eq!(layer.threshold_mode, ThresholdMode::Range);
        assert_eq!(
            layer.threshold_range,
            (0.0, 0.0),
            "threshold=None should not hide the loaded intensity window"
        );
    });
}

/// Test multi-resolution layer support
#[test]
fn test_viewstate_multi_resolution() {
    pollster::block_on(async {
        // Create aligned test volumes
        let volumes = TestVolumeSet::create_aligned();

        let mut service = RenderLoopService::new()
            .await
            .expect("Failed to create render service");

        service.load_shaders().expect("Failed to load shaders");

        // Register all volumes
        service
            .register_volume_with_upload(
                "anatomical".to_string(),
                &volumes.anatomical,
                wgpu::TextureFormat::R8Unorm,
            )
            .expect("Failed to register anatomical");

        service
            .register_volume_with_upload(
                "functional".to_string(),
                &volumes.functional,
                wgpu::TextureFormat::R32Float,
            )
            .expect("Failed to register functional");

        service
            .register_volume_with_upload(
                "detail".to_string(),
                &volumes.detail_patch,
                wgpu::TextureFormat::R16Uint,
            )
            .expect("Failed to register detail");

        // Create view state with multiple layers
        let view_id = ViewId::new("multi-res-view");
        let state = ViewState::from_basic_params(
            "anatomical".to_string(),
            [0.0, 0.0, 0.0],
            SliceOrientation::Axial,
            200.0,
            [768, 768],
            (0.0, 1.0),
        )
        .with_layers(vec![
            // Base anatomical layer
            LayerConfig::new("anatomical".to_string()),
            // Functional overlay with transparency
            LayerConfig::new("functional".to_string())
                .with_opacity(0.7)
                .with_colormap(1)
                .with_blend_mode(BlendMode::Additive)
                .with_intensity_window(0.1, 0.8)
                .with_threshold(ThresholdMode::Above, 0.3, 1.0),
            // Detail patch (hidden by default)
            LayerConfig::new("detail".to_string()).with_visibility(false),
        ]);

        // Request frame
        let result = service
            .request_frame(view_id, state)
            .await
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
    state
        .layers
        .push(LayerConfig::new("test".to_string()).with_opacity(1.5));
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

        service
            .register_volume_with_upload(
                "test-vol".to_string(),
                &volume,
                wgpu::TextureFormat::R8Unorm,
            )
            .unwrap();

        // Test each orientation
        for orientation in &[
            SliceOrientation::Axial,
            SliceOrientation::Coronal,
            SliceOrientation::Sagittal,
        ] {
            let view_id = ViewId::new(format!("view-{:?}", orientation));
            let state = ViewState::from_basic_params(
                "test-vol".to_string(),
                [32.0, 32.0, 12.0],
                *orientation,
                64.0,
                [256, 256],
                (0.0, 1.0),
            );

            let result = service
                .request_frame(view_id, state)
                .await
                .expect(&format!("Failed for orientation {:?}", orientation));

            assert_eq!(result.dimensions, [256, 256]);
            assert!(result.render_time_ms >= 0.0);
        }
    });
}

/// Test camera parameter conversion
#[test]
fn test_camera_to_frame_params() {
    let state = ViewState::from_basic_params(
        "test".to_string(),
        [100.0, 100.0, 50.0],
        SliceOrientation::Axial,
        200.0,
        [512, 512],
        (0.0, 1.0),
    );

    let (origin, u, v) = state.camera_to_frame_params();

    // For axial view centered at (100,100,50) with 200mm FOV
    // Origin should be at bottom-left of view plane
    assert_eq!(origin, [0.0, 0.0, 50.0, 1.0]);
    assert_eq!(u, [200.0, 0.0, 0.0, 0.0]); // X direction, full FOV
    assert_eq!(v, [0.0, 200.0, 0.0, 0.0]); // Y direction, full FOV
}
