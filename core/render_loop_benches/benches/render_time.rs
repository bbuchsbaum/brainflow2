use criterion::{criterion_group, criterion_main, Criterion};
use pollster::block_on;
use render_loop::render_state::BlendMode;
use render_loop::test_fixtures::create_test_pattern_volume;
use render_loop::view_state::{LayerConfig, SliceOrientation, ViewId, ViewState};
use render_loop::RenderLoopService;

fn setup_service() -> RenderLoopService {
    block_on(async {
        let mut svc = RenderLoopService::new().await.expect("init render loop");
        svc.load_shaders().expect("load shaders");

        // Register a small test volume (u8 pattern)
        let vol = create_test_pattern_volume();
        svc.register_volume_with_upload(
            "bench-vol".to_string(),
            &vol,
            wgpu::TextureFormat::R8Unorm,
        )
        .expect("register volume");

        svc
    })
}

fn bench_render_time(c: &mut Criterion) {
    let mut svc = setup_service();

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
    svc.create_offscreen_target(512, 512)
        .expect("offscreen target");

    let mut group = c.benchmark_group("RenderFrame");
    group.bench_function("request_frame_512_rgba", |b| {
        b.iter(|| {
            let _ = block_on(svc.request_frame(view_id.clone(), state.clone())).expect("frame");
        });
    });
    group.finish();
}

criterion_group!(render_benches, bench_render_time);
criterion_main!(render_benches);
