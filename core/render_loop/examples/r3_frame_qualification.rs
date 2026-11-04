//! R2/R3 comparison witness built with the ordinary production release profile.
//! Copy unchanged to R2; build with `cargo build --release -p render_loop
//! --example r3_frame_qualification`. No timing threshold is embedded here.
use render_loop::view_state::{
    FrameReadbackMode, FrameRequestOptions, SliceOrientation, ViewId, ViewState,
};
use render_loop::{RenderLoopService, WgpuSliceRendererConfig};
use std::time::Instant;

fn main() {
    assert!(!cfg!(debug_assertions), "use the release profile");
    assert!(
        cfg!(panic = "abort"),
        "use the unmodified production panic strategy"
    );
    let mode = std::env::args().nth(1).expect("host or completed");
    let readback_mode = match mode.as_str() {
        "host" => FrameReadbackMode::Skip,
        "completed" => FrameReadbackMode::Blocking,
        _ => panic!("expected host or completed"),
    };
    pollster::block_on(async {
        let mut config = WgpuSliceRendererConfig::default();
        config.atlas.dimensions = [1, 1, 1];
        let mut service = RenderLoopService::new_with_config(config)
            .await
            .expect("a real GPU adapter is required");
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
        let initial = ViewState::from_basic_params(
            "v12".into(),
            [32., 32., 12.],
            SliceOrientation::Axial,
            64.,
            [512, 512],
            (0., 255.),
        )
        .with_crosshair(false);
        let options = FrameRequestOptions { readback_mode };
        for workload in ["steady", "property_patch", "alternating_views"] {
            let mut state = initial.clone();
            for index in [9, 5, 1] {
                let mut layer = state.layers[0].clone();
                layer.volume_id = format!("v{index}");
                layer.opacity = 0.25;
                state.layers.push(layer);
            }
            let mut samples_ns = Vec::with_capacity(1000);
            let mut checksum = 0_u64;
            for index in 0..1100 {
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
                let start = Instant::now();
                let result = service
                    .request_frame_with_options(
                        ViewId::new("qualification"),
                        state.clone(),
                        options,
                    )
                    .await
                    .unwrap();
                let elapsed = start.elapsed().as_nanos() as u64;
                if index >= 100 {
                    samples_ns.push(elapsed);
                }
                // Bound the queue outside the host timer. Completed mode already
                // includes readback completion; both modes remain serial-latency
                // measurements, not sustained-throughput measurements.
                service.device.poll(wgpu::Maintain::Wait);
                if index == 1099 && mode == "completed" {
                    assert_eq!(result.image_data.len(), 512 * 512 * 4);
                    assert!(
                        result
                            .image_data
                            .chunks_exact(4)
                            .any(|p| p[0] > 0 && p[0] < 255),
                        "nonblank scalar image required"
                    );
                    checksum = result
                        .image_data
                        .iter()
                        .fold(0xcbf29ce484222325_u64, |h, &byte| {
                            (h ^ u64::from(byte)).wrapping_mul(0x100000001b3)
                        });
                }
            }
            let mut sorted = samples_ns.clone();
            sorted.sort_unstable();
            let mean_ns =
                samples_ns.iter().map(|&n| n as f64).sum::<f64>() / samples_ns.len() as f64;
            println!("R3_PRODUCTION mode={mode} workload={workload} count={} mean_ns={mean_ns:.3} p50_ns={} p95_ns={} checksum={checksum:016x}", samples_ns.len(), sorted[500], sorted[950]);
            println!("R3_SAMPLES mode={mode} workload={workload} ns={samples_ns:?}");
        }
    });
}
