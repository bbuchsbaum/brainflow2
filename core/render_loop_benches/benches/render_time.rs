use criterion::{criterion_group, criterion_main, Criterion};
use pollster::block_on;
use render_loop::render_state::BlendMode;
use render_loop::test_fixtures::create_test_pattern_volume;
use render_loop::view_state::{
    FrameReadbackMode, FrameRequestOptions, LayerConfig, SliceOrientation, ViewId, ViewState,
};
use render_loop::RenderLoopService;

fn setup_service() -> Result<RenderLoopService, String> {
    block_on(async {
        let mut svc = RenderLoopService::new()
            .await
            .map_err(|err| format!("init render loop: {err}"))?;
        svc.load_shaders()
            .map_err(|err| format!("load shaders: {err}"))?;

        // Register a small test volume (u8 pattern)
        let vol = create_test_pattern_volume();
        svc.register_volume_with_upload(
            "bench-vol".to_string(),
            &vol,
            wgpu::TextureFormat::R8Unorm,
        )
        .map_err(|err| format!("register volume: {err}"))?;

        Ok(svc)
    })
}

fn bench_render_time(c: &mut Criterion) {
    let mut svc = match setup_service() {
        Ok(service) => service,
        Err(err) => {
            eprintln!("Skipping RenderFrame benchmark: {err}");
            return;
        }
    };

    // Fixed view id + state
    let view_id = ViewId::new("bench-view");
    let state = ViewState::from_basic_params(
        "bench-vol".to_string(),
        [32.0, 32.0, 12.0],
        SliceOrientation::Axial,
        64.0,
        [512, 512],
        (0.0, 1.0),
    );

    // Use offscreen render target so pipeline creation doesn't require a surface
    if let Err(err) = svc.create_offscreen_target(512, 512) {
        eprintln!("Skipping RenderFrame benchmark: offscreen target setup failed: {err}");
        return;
    }

    let mut group = c.benchmark_group("RenderFrame");
    group.bench_function("request_frame_512_rgba", |b| {
        b.iter(|| {
            let _ = block_on(svc.request_frame(view_id.clone(), state.clone())).expect("frame");
        });
    });
    group.bench_function("request_frame_512_skip_readback", |b| {
        b.iter(|| {
            let _ = block_on(svc.request_frame_with_options(
                view_id.clone(),
                state.clone(),
                FrameRequestOptions {
                    readback_mode: FrameReadbackMode::Skip,
                },
            ))
            .expect("frame");
        });
    });
    group.finish();
}

criterion_group!(render_benches, bench_render_time);
criterion_main!(render_benches);
