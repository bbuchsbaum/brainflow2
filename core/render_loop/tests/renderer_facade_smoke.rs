use pollster::block_on;
use render_loop::test_fixtures::create_test_pattern_volume;
use render_loop::view_state::{
    FrameReadbackMode, FrameRequestOptions, SliceOrientation, ViewId, ViewState,
};
use render_loop::{
    RenderLoopError, RendererAtlasConfig, RendererFrameRequest, RendererVolumeFormat,
    WgpuSliceRenderer, WgpuSliceRendererConfig,
};

async fn renderer_or_skip(config: WgpuSliceRendererConfig) -> Option<WgpuSliceRenderer> {
    match WgpuSliceRenderer::configure(config).await {
        Ok(renderer) => Some(renderer),
        Err(RenderLoopError::AdapterRequestFailed | RenderLoopError::AdapterNotFound) => {
            eprintln!("Skipping renderer_facade_smoke: no WGPU adapter available");
            None
        }
        Err(error) => panic!("initialize facade renderer: {error:?}"),
    }
}

#[test]
fn facade_registers_renders_batches_and_releases_synthetic_volume() {
    block_on(async {
        let config = WgpuSliceRendererConfig {
            atlas: RendererAtlasConfig {
                dimensions: [128, 128, 64],
                max_textures: 4,
                initial_layer_capacity: 8,
                ..RendererAtlasConfig::default()
            },
            ..WgpuSliceRendererConfig::default()
        };
        let Some(mut renderer) = renderer_or_skip(config).await else {
            return;
        };

        let volume = create_test_pattern_volume();
        let handle = renderer
            .register_volume("facade-volume", &volume, RendererVolumeFormat::R8Unorm)
            .expect("register facade volume");

        assert_eq!(handle.volume_id(), "facade-volume");
        assert!(renderer.atlas_metrics().total_layers > 0);

        let state = ViewState::from_basic_params(
            handle.volume_id().to_string(),
            [32.0, 32.0, 12.0],
            SliceOrientation::Axial,
            64.0,
            [128, 128],
            (0.0, 1.0),
        )
        .with_crosshair(false);

        let frame = renderer
            .request_frame(ViewId::new("facade-view"), state.clone())
            .await
            .expect("render facade frame");

        assert_eq!(frame.dimensions, [128, 128]);
        assert_eq!(frame.rendered_layers, vec!["facade-volume".to_string()]);
        assert_eq!(frame.image_data.len(), 128 * 128 * 4);
        assert!(!frame.used_cpu_fallback);

        let batched = renderer
            .request_frames([
                RendererFrameRequest::new(ViewId::new("facade-view-skip"), state).with_options(
                    FrameRequestOptions {
                        readback_mode: FrameReadbackMode::Skip,
                    },
                ),
            ])
            .await
            .expect("render facade frame batch");

        assert_eq!(batched.len(), 1);
        assert_eq!(batched[0].dimensions, [128, 128]);
        assert!(batched[0].image_data.is_empty());
        assert_eq!(
            batched[0].diagnostics.readback_mode,
            FrameReadbackMode::Skip
        );

        renderer
            .release_volume(&handle)
            .expect("release facade volume");
        assert!(renderer.release_volume_by_id(handle.volume_id()).is_err());
    });
}
