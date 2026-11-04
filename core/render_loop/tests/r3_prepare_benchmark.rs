//! Actual before/after timing witness. Copy this unchanged test to the R2
//! baseline checkout to compare the entire preparation path, not just mapping.
//! Run alone with --nocapture --test-threads=1, outside other GPU work.
use render_loop::view_state::{
    FrameReadbackMode, FrameRequestOptions, SliceOrientation, ViewId, ViewState,
};
use render_loop::{RenderLoopService, WgpuSliceRendererConfig};

#[test]
fn r3_sparse_frame_preparation_measurement() {
    pollster::block_on(async {
        let mut config = WgpuSliceRendererConfig::default();
        config.atlas.dimensions = [1, 1, 1];
        let mut service = RenderLoopService::new_with_config(config)
            .await
            .expect("real GPU required");
        service.load_shaders().unwrap();
        let volume = render_loop::test_fixtures::create_test_pattern_volume();
        for index in 0..13 {
            service
                .register_volume_with_upload(
                    format!("v{index}"),
                    &volume,
                    wgpu::TextureFormat::R32Float,
                )
                .unwrap();
        }
        let mut state = ViewState::from_basic_params(
            "v12".into(),
            [32., 32., 12.],
            SliceOrientation::Axial,
            64.,
            [512, 512],
            (0., 255.),
        )
        .with_crosshair(false);
        for index in [9, 5, 1] {
            let mut layer = state.layers[0].clone();
            layer.volume_id = format!("v{index}");
            layer.opacity = 0.25;
            state.layers.push(layer);
        }
        let options = FrameRequestOptions {
            readback_mode: FrameReadbackMode::Skip,
        };
        for _ in 0..50 {
            service
                .request_frame_with_options(ViewId::new("timing"), state.clone(), options)
                .await
                .unwrap();
            service.device.poll(wgpu::Maintain::Wait);
        }
        for workload in ["steady", "property_patch", "alternating_views"] {
            let mut samples = Vec::<f32>::new();
            for index in 0..500 {
                match workload {
                    "property_patch" => {
                        state.layers[1].opacity = if index % 2 == 0 { 0.25 } else { 0.5 }
                    }
                    "alternating_views" => {
                        state.layers[0].volume_id =
                            format!("v{}", if index % 2 == 0 { 12 } else { 10 })
                    }
                    _ => (),
                }
                let result = service
                    .request_frame_with_options(ViewId::new("timing"), state.clone(), options)
                    .await
                    .unwrap();
                samples.push(result.diagnostics.prepare_ms);
                service.device.poll(wgpu::Maintain::Wait);
            }
            samples.sort_by(f32::total_cmp);
            println!(
                "R3_TIMING workload={workload} samples=500 p50_ms={:.6} p90_ms={:.6}",
                samples[250], samples[450]
            );
        }
    });
}
