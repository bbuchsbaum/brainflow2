// Differential test for the batched GPU readback path (P4).
//
// `read_views_to_images` collapses the per-slice `copy_texture_to_buffer` +
// blocking `device.poll(Wait)` (N GPU syncs) into a single encoder / submit /
// poll for the whole batch. Correctness gate: the i-th batched image must be
// byte-identical to what the proven per-view blocking readback (`request_frame`)
// produces for the same ViewState.

use render_loop::test_fixtures::create_test_pattern_volume;
use render_loop::view_state::{
    FrameReadbackMode, FrameRequestOptions, SliceOrientation, ViewId, ViewState,
};
use render_loop::RenderLoopService;

fn axial_view(center_z: f32) -> ViewState {
    // Volume is [64, 64, 25] with a plus-sign pattern only on the z=12 slice, so
    // different z centers render visibly distinct slices.
    ViewState::from_basic_params(
        "test-volume".to_string(),
        [32.0, 32.0, center_z],
        SliceOrientation::Axial,
        64.0,
        [256, 256],
        (0.0, 1.0),
    )
}

#[test]
fn batched_readback_matches_sequential_readback() {
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

        // Three distinct slices; z=12 carries the plus-sign, z=6/z=18 do not.
        let states = [axial_view(6.0), axial_view(12.0), axial_view(18.0)];

        // Reference: sequential per-view blocking readback (the legacy path).
        let mut sequential_images = Vec::new();
        for (idx, state) in states.iter().enumerate() {
            let result = service
                .request_frame(ViewId::new(format!("seq_{idx}")), state.clone())
                .await
                .expect("sequential frame render failed");
            assert_eq!(
                result.image_data.len(),
                256 * 256 * 4,
                "sequential slice {idx} wrong size"
            );
            sequential_images.push(result.image_data);
        }

        // Batch: render each view with readback SKIPPED, then one batched readback.
        let mut view_ids = Vec::new();
        for (idx, state) in states.iter().enumerate() {
            let view_id = ViewId::new(format!("batch_{idx}"));
            service
                .request_frame_with_options(
                    view_id.clone(),
                    state.clone(),
                    FrameRequestOptions {
                        readback_mode: FrameReadbackMode::Skip,
                    },
                )
                .await
                .expect("batch frame render (skip readback) failed");
            view_ids.push(view_id);
        }
        let batched_images = service
            .read_views_to_images(&view_ids, [256, 256])
            .expect("batched readback failed");

        assert_eq!(batched_images.len(), states.len());
        for (idx, (batched, sequential)) in batched_images
            .iter()
            .zip(sequential_images.iter())
            .enumerate()
        {
            assert_eq!(
                batched.len(),
                sequential.len(),
                "slice {idx}: batched size differs from sequential"
            );
            assert_eq!(
                batched, sequential,
                "slice {idx}: batched readback is not byte-identical to sequential readback"
            );
        }

        // Guard against a region-offset bug that would return the same texture data
        // for every view: the z=12 plus-sign slice must differ from the z=6 slice.
        assert_ne!(
            batched_images[0], batched_images[1],
            "distinct slices should not read back identical bytes (readback offset bug?)"
        );
    });
}

#[test]
fn read_views_to_images_empty_is_empty() {
    pollster::block_on(async {
        let service = RenderLoopService::new()
            .await
            .expect("Failed to create render service");
        let images = service
            .read_views_to_images(&[], [256, 256])
            .expect("empty batch readback should succeed");
        assert!(images.is_empty());
    });
}
