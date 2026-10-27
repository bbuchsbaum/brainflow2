use render_loop::view_state::{
    FrameReadbackMode, FrameRequestOptions, SliceOrientation, ViewId, ViewState,
};
use render_loop::{
    RenderLoopError, RendererVolumeFormat, WgpuSliceRenderer, WgpuSliceRendererConfig,
};
use std::time::Duration;

async fn renderer() -> WgpuSliceRenderer {
    let mut renderer = WgpuSliceRenderer::configure(WgpuSliceRendererConfig::default())
        .await
        .expect("real GPU required");
    let volume = render_loop::test_fixtures::create_test_pattern_volume();
    renderer
        .register_volume("v", &volume, RendererVolumeFormat::R32Float)
        .unwrap();
    renderer
}

fn state(size: [u32; 2]) -> ViewState {
    ViewState::from_basic_params(
        "v".into(),
        [32., 32., 12.],
        SliceOrientation::Axial,
        64.,
        size,
        (0., 255.),
    )
    .with_crosshair(false)
}

fn stale(error: RenderLoopError) {
    assert!(matches!(
        error,
        RenderLoopError::Internal { code: 8010, .. }
    ));
}

async fn drained(monitor: &render_loop::ReadbackMonitor) {
    tokio::time::timeout(Duration::from_secs(3), async {
        while monitor.snapshot().buffers != 0 {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(monitor.snapshot().bytes, 0);
}

#[tokio::test]
async fn latest_submission_wins_and_closed_or_resized_views_cannot_publish() {
    let mut renderer = renderer().await;
    let id = ViewId::new("owned");
    let first = renderer
        .submit_frame_with_options(id.clone(), state([65, 47]), FrameRequestOptions::default())
        .unwrap();
    let latest = renderer
        .submit_frame_with_options(id.clone(), state([65, 47]), FrameRequestOptions::default())
        .unwrap();
    stale(first.complete().await.unwrap_err());
    assert_eq!(
        latest.complete().await.unwrap().image_data.len(),
        65 * 47 * 4
    );
    for size in [[65, 47], [67, 49]] {
        let pending = renderer
            .submit_frame_with_options(id.clone(), state(size), FrameRequestOptions::default())
            .unwrap();
        renderer.release_view(&id);
        stale(pending.complete().await.unwrap_err());
    }
    let old = renderer
        .submit_frame_with_options(id.clone(), state([65, 47]), FrameRequestOptions::default())
        .unwrap();
    let resized = renderer
        .submit_frame_with_options(id, state([67, 49]), FrameRequestOptions::default())
        .unwrap();
    stale(old.complete().await.unwrap_err());
    resized.complete().await.unwrap();
    drained(&renderer.readback_monitor()).await;
}

#[tokio::test]
async fn request_snapshots_survive_reuse_of_native_cache_target_ids() {
    let mut renderer = renderer().await;
    let id = ViewId::new("shared_native_cache");
    let expected = renderer
        .request_frame(id.clone(), state([65, 47]))
        .await
        .unwrap()
        .image_data;
    assert!(expected.iter().any(|&byte| byte != 0));
    let first = renderer
        .submit_frame_with_options(id.clone(), state([65, 47]), FrameRequestOptions::default())
        .unwrap()
        .into_snapshot();
    let mut other_state = state([65, 47]);
    other_state.layers[0].opacity = 0.;
    let other = renderer
        .submit_frame_with_options(id.clone(), other_state, FrameRequestOptions::default())
        .unwrap()
        .into_snapshot();
    renderer.release_view(&id);
    assert_eq!(first.complete().await.unwrap().image_data, expected);
    assert_ne!(other.complete().await.unwrap().image_data, expected);
    drained(&renderer.readback_monitor()).await;
}

#[tokio::test]
async fn mixed_size_batch_matches_completed_frames_and_preserves_order() {
    let mut renderer = renderer().await;
    let specs = [(ViewId::new("a"), [63, 47]), (ViewId::new("b"), [65, 49])];
    let mut expected = Vec::new();
    for (id, size) in &specs {
        expected.push(
            renderer
                .request_frame(id.clone(), state(*size))
                .await
                .unwrap()
                .image_data,
        );
    }
    let pending = renderer.submit_views_readback(&specs).unwrap();
    assert_eq!(pending.complete().await.unwrap(), expected);
    drained(&renderer.readback_monitor()).await;
}

#[tokio::test]
async fn dropped_submissions_are_bounded_and_do_not_exhaust_future_reads() {
    let mut renderer = renderer().await;
    let monitor = renderer.readback_monitor();
    let mut pending = Vec::new();
    for n in 0..16 {
        pending.push(
            renderer
                .submit_frame_with_options(
                    ViewId::new(format!("view{n}")),
                    state([65, 47]),
                    FrameRequestOptions::default(),
                )
                .unwrap(),
        );
    }
    // A seventeenth frame degrades gracefully: no staging buffer, a grey
    // placeholder frame and a warning, instead of an error.
    let overflow = renderer
        .submit_frame_with_options(
            ViewId::new("overflow"),
            state([65, 47]),
            FrameRequestOptions::default(),
        )
        .unwrap();
    assert_eq!(monitor.snapshot().buffers, 16);
    let placeholder = overflow.complete().await.unwrap();
    assert!(placeholder
        .warnings
        .iter()
        .any(|w| w.contains("staging budget exhausted")));
    assert_eq!(placeholder.image_data.len(), 65 * 47 * 4);
    assert!(placeholder
        .image_data
        .chunks_exact(4)
        .all(|px| px == [128, 128, 128, 255]));
    drop(pending);
    drained(&monitor).await;
    for _ in 0..40 {
        let pending = renderer
            .submit_frame_with_options(
                ViewId::new("repeat"),
                state([65, 47]),
                FrameRequestOptions::default(),
            )
            .unwrap();
        drop(pending);
        drained(&monitor).await;
    }
    renderer
        .request_frame(ViewId::new("after"), state([65, 47]))
        .await
        .unwrap();
    drained(&monitor).await;
}

#[tokio::test]
async fn teardown_invalidates_pending_frames_but_gpu_ownership_completes() {
    let mut renderer = renderer().await;
    let monitor = renderer.readback_monitor();
    let pending = renderer
        .submit_frame_with_options(
            ViewId::new("closed"),
            state([65, 47]),
            FrameRequestOptions::default(),
        )
        .unwrap();
    drop(renderer);
    stale(pending.complete().await.unwrap_err());
    drained(&monitor).await;
}

#[tokio::test]
async fn skipped_readback_allocates_no_staging_buffer() {
    let mut renderer = renderer().await;
    let pending = renderer
        .submit_frame_with_options(
            ViewId::new("skip"),
            state([65, 47]),
            FrameRequestOptions {
                readback_mode: FrameReadbackMode::Skip,
            },
        )
        .unwrap();
    assert_eq!(renderer.readback_monitor().snapshot().buffers, 0);
    assert!(pending.complete().await.unwrap().image_data.is_empty());
}
