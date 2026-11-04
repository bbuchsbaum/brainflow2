//! R2/R3 comparison witness built with the ordinary production release profile.
//! Copy unchanged to R2; build with `cargo build --release -p render_loop
//! --example r3_frame_qualification`. No timing threshold is embedded here.
use render_loop::view_state::{
    FrameReadbackMode, FrameRequestOptions, SliceOrientation, ViewId, ViewState,
};
use render_loop::{RenderLoopService, WgpuSliceRendererConfig};
use std::{
    io::{self, BufRead, Write},
    time::Instant,
};

const MAX_BATCH_CALLS: usize = 4096;

struct BatchResult {
    samples_ns: Vec<u64>,
    checksum: u64,
}

fn initial_state() -> ViewState {
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
    state
}

fn update_workload(state: &mut ViewState, workload: &str, iteration: usize) {
    match workload {
        "steady" => (),
        "property_patch" => {
            state.layers[1].opacity = if iteration.is_multiple_of(2) {
                0.25
            } else {
                0.5
            }
        }
        "alternating_views" => {
            state.layers[0].volume_id =
                format!("v{}", if iteration.is_multiple_of(2) { 12 } else { 10 });
        }
        _ => unreachable!("validated workload"),
    }
}

fn image_checksum(image: &[u8]) -> u64 {
    image.iter().fold(0xcbf29ce484222325_u64, |hash, &byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3)
    })
}

async fn setup_service() -> RenderLoopService {
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
    service.queue.submit(std::iter::empty());
    service.device.poll(wgpu::Maintain::Wait);
    service
}

async fn run_batch(
    service: &mut RenderLoopService,
    mode: &str,
    workload: &str,
    count: usize,
    warmup: usize,
) -> BatchResult {
    let readback_mode = match mode {
        "host" => FrameReadbackMode::Skip,
        "completed" => FrameReadbackMode::Blocking,
        _ => unreachable!("validated mode"),
    };
    let options = FrameRequestOptions { readback_mode };
    let mut state = initial_state();
    let view_id = ViewId::new("qualification");
    for iteration in 0..warmup {
        update_workload(&mut state, workload, iteration);
        service
            .request_frame_with_options(view_id.clone(), state.clone(), options)
            .await
            .unwrap();
        service.device.poll(wgpu::Maintain::Wait);
    }
    let mut samples_ns = Vec::with_capacity(count);
    let mut checksum = 0;
    for iteration in 0..count {
        update_workload(&mut state, workload, warmup + iteration);
        let start = Instant::now();
        let result = service
            .request_frame_with_options(view_id.clone(), state.clone(), options)
            .await
            .unwrap();
        samples_ns.push(start.elapsed().as_nanos() as u64);
        // Readback/submission completion is outside the host timer. This is a
        // serial-latency assay, not a sustained-throughput measurement.
        service.device.poll(wgpu::Maintain::Wait);
        if iteration + 1 == count && mode == "completed" {
            assert_eq!(result.image_data.len(), 512 * 512 * 4);
            assert!(
                result
                    .image_data
                    .chunks_exact(4)
                    .any(|p| p[0] > 0 && p[0] < 255),
                "nonblank scalar image required"
            );
            checksum = image_checksum(&result.image_data);
        }
    }
    service.queue.submit(std::iter::empty());
    service.device.poll(wgpu::Maintain::Wait);
    BatchResult {
        samples_ns,
        checksum,
    }
}

fn print_batch(mode: &str, workload: &str, result: BatchResult, serve_protocol: bool) {
    let mut sorted = result.samples_ns.clone();
    sorted.sort_unstable();
    let mean_ns =
        result.samples_ns.iter().map(|&ns| ns as f64).sum::<f64>() / result.samples_ns.len() as f64;
    let prefix = if serve_protocol {
        "R3_BATCH"
    } else {
        "R3_PRODUCTION"
    };
    println!("{prefix} mode={mode} workload={workload} count={} mean_ns={mean_ns:.3} p50_ns={} p95_ns={} checksum={:016x}", result.samples_ns.len(), sorted[sorted.len() / 2], sorted[sorted.len() * 95 / 100], result.checksum);
    println!(
        "R3_SAMPLES mode={mode} workload={workload} ns={:?}",
        result.samples_ns
    );
    if serve_protocol {
        println!("DONE");
    }
    io::stdout().flush().unwrap();
}

fn serve(mut service: RenderLoopService) {
    println!("READY");
    io::stdout().flush().unwrap();
    for line in io::stdin().lock().lines() {
        let line = line.expect("stdin line");
        let fields: Vec<_> = line.split_ascii_whitespace().collect();
        match fields.as_slice() {
            ["quit"] => break,
            ["batch", mode, workload, count, warmup] => {
                let count = count.parse::<usize>().expect("batch count must be an integer");
                let warmup = warmup.parse::<usize>().expect("warmup must be an integer");
                assert!((1..=MAX_BATCH_CALLS).contains(&count), "count must be 1..={MAX_BATCH_CALLS}");
                assert!(warmup <= MAX_BATCH_CALLS, "warmup must be <= {MAX_BATCH_CALLS}");
                assert!(matches!(*mode, "host" | "completed"), "mode must be host or completed");
                assert!(matches!(*workload, "steady" | "property_patch" | "alternating_views"), "unknown workload");
                let result = pollster::block_on(run_batch(&mut service, mode, workload, count, warmup));
                print_batch(mode, workload, result, true);
            }
            _ => panic!("expected: batch <host|completed> <steady|property_patch|alternating_views> <count> <warmup>, or quit"),
        }
    }
}

fn main() {
    assert!(!cfg!(debug_assertions), "use the release profile");
    assert!(
        cfg!(panic = "abort"),
        "use the unmodified production panic strategy"
    );
    let mode = std::env::args().nth(1).expect("host, completed, or serve");
    let mut service = pollster::block_on(setup_service());
    if mode == "serve" {
        return serve(service);
    }
    assert!(
        matches!(mode.as_str(), "host" | "completed"),
        "expected host, completed, or serve"
    );
    for workload in ["steady", "property_patch", "alternating_views"] {
        let result = pollster::block_on(run_batch(&mut service, &mode, workload, 1000, 100));
        print_batch(&mode, workload, result, false);
    }
}
