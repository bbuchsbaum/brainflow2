use pollster::block_on;
use render_loop::test_fixtures::create_test_pattern_volume;
use render_loop::view_state::{
    FrameReadbackMode, FrameRequestOptions, LayerConfig, SliceOrientation, ViewId, ViewState,
};
use render_loop::{RenderLoopError, RenderLoopService};

async fn new_render_service_or_skip() -> Option<RenderLoopService> {
    match RenderLoopService::new().await {
        Ok(service) => Some(service),
        Err(RenderLoopError::AdapterRequestFailed | RenderLoopError::AdapterNotFound) => {
            eprintln!("Skipping live_render_diagnostics_test: no WGPU adapter available");
            None
        }
        Err(error) => panic!("initialize render loop: {error:?}"),
    }
}

#[test]
fn request_frame_reports_stage_diagnostics_and_visible_image() {
    block_on(async {
        let volume = create_test_pattern_volume();
        let Some(mut service) = new_render_service_or_skip().await else {
            return;
        };
        service.load_shaders().expect("load shaders");

        service
            .register_volume_with_upload(
                "diag-volume".to_string(),
                &volume,
                wgpu::TextureFormat::R8Unorm,
            )
            .expect("register test volume");

        let state = ViewState::from_basic_params(
            "diag-volume".to_string(),
            [32.0, 32.0, 12.0],
            SliceOrientation::Axial,
            64.0,
            [128, 128],
            (0.0, 1.0),
        )
        .with_crosshair(false);

        let result = service
            .request_frame(ViewId::new("diag-view"), state)
            .await
            .expect("request_frame");

        assert_eq!(result.dimensions, [128, 128]);
        assert_eq!(result.diagnostics.visible_layers, 1);
        assert_eq!(result.diagnostics.updated_layer_slots, 1);
        assert!(!result.diagnostics.reused_layer_state);
        assert_eq!(
            result.diagnostics.readback_mode,
            FrameReadbackMode::Blocking
        );
        assert!(result.diagnostics.prepare_ms >= 0.0);
        assert!(result.diagnostics.render_ms >= 0.0);
        assert!(result.diagnostics.readback_ms >= 0.0);
        assert!(
            (result.render_time_ms - result.diagnostics.total_ms).abs() < 0.5,
            "frame diagnostics total should track render_time_ms closely"
        );
        assert!(
            result.diagnostics.total_ms
                >= result.diagnostics.prepare_ms + result.diagnostics.readback_ms,
            "total time should include at least prepare + readback"
        );
        assert_eq!(result.image_data.len(), 128 * 128 * 4);
    });
}

#[test]
fn request_frame_can_skip_readback_without_breaking_follow_up_render() {
    block_on(async {
        let volume = create_test_pattern_volume();
        let Some(mut service) = new_render_service_or_skip().await else {
            return;
        };
        service.load_shaders().expect("load shaders");

        service
            .register_volume_with_upload(
                "diag-volume-skip".to_string(),
                &volume,
                wgpu::TextureFormat::R8Unorm,
            )
            .expect("register test volume");

        let state = ViewState::from_basic_params(
            "diag-volume-skip".to_string(),
            [32.0, 32.0, 12.0],
            SliceOrientation::Axial,
            64.0,
            [96, 96],
            (0.0, 1.0),
        )
        .with_crosshair(false);

        let skipped = service
            .request_frame_with_options(
                ViewId::new("diag-view-skip"),
                state.clone(),
                FrameRequestOptions {
                    readback_mode: FrameReadbackMode::Skip,
                },
            )
            .await
            .expect("request_frame_with_options");

        assert_eq!(skipped.dimensions, [96, 96]);
        assert!(skipped.image_data.is_empty());
        assert_eq!(skipped.diagnostics.visible_layers, 1);
        assert_eq!(skipped.diagnostics.updated_layer_slots, 1);
        assert!(!skipped.diagnostics.reused_layer_state);
        assert_eq!(skipped.diagnostics.readback_mode, FrameReadbackMode::Skip);
        assert_eq!(skipped.diagnostics.readback_ms, 0.0);

        let blocking = service
            .request_frame(ViewId::new("diag-view-blocking"), state)
            .await
            .expect("request_frame");

        assert_eq!(
            blocking.diagnostics.readback_mode,
            FrameReadbackMode::Blocking
        );
        assert_eq!(blocking.diagnostics.updated_layer_slots, 0);
        assert!(blocking.diagnostics.reused_layer_state);
        assert_eq!(blocking.image_data.len(), 96 * 96 * 4);
    });
}

#[test]
fn request_frame_patches_only_changed_layer_slots() {
    block_on(async {
        let volume = create_test_pattern_volume();
        let Some(mut service) = new_render_service_or_skip().await else {
            return;
        };
        service.load_shaders().expect("load shaders");

        service
            .register_volume_with_upload(
                "diag-volume-patch-a".to_string(),
                &volume,
                wgpu::TextureFormat::R8Unorm,
            )
            .expect("register first test volume");
        service
            .register_volume_with_upload(
                "diag-volume-patch-b".to_string(),
                &volume,
                wgpu::TextureFormat::R8Unorm,
            )
            .expect("register second test volume");

        let base_state = ViewState::from_basic_params(
            "diag-volume-patch-a".to_string(),
            [32.0, 32.0, 12.0],
            SliceOrientation::Axial,
            64.0,
            [96, 96],
            (0.0, 1.0),
        )
        .with_crosshair(false)
        .with_layer(
            LayerConfig::new("diag-volume-patch-b".to_string())
                .with_opacity(0.4)
                .with_colormap(1),
        );

        let first = service
            .request_frame(ViewId::new("diag-view-patch-1"), base_state.clone())
            .await
            .expect("first request_frame");

        assert_eq!(first.diagnostics.visible_layers, 2);
        assert_eq!(first.diagnostics.updated_layer_slots, 2);
        assert!(!first.diagnostics.reused_layer_state);

        let mut patched_state = base_state;
        patched_state.layers[1].opacity = 0.7;

        let second = service
            .request_frame(ViewId::new("diag-view-patch-2"), patched_state)
            .await
            .expect("second request_frame");

        assert_eq!(second.diagnostics.visible_layers, 2);
        assert_eq!(second.diagnostics.updated_layer_slots, 1);
        assert!(!second.diagnostics.reused_layer_state);
        assert_eq!(second.image_data.len(), 96 * 96 * 4);
    });
}
