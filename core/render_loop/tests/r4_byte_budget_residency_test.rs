//! GPU proof that byte-budget residency is independent from the 13-source
//! masked draw layout.

use render_loop::view_state::{LayerConfig, SliceOrientation, ViewId, ViewState};
use render_loop::{
    RenderLoopError, RendererResidencyConfig, RendererVolumeFormat, WgpuSliceRenderer,
    WgpuSliceRendererConfig,
};
use volmath::{DenseVolume3, NeuroSpace, NeuroSpaceExt};

fn tiny_volume(phase: usize) -> DenseVolume3<f32> {
    let space =
        NeuroSpace::from_dims_spacing_origin(vec![8, 8, 8], vec![1.; 3], vec![0.; 3]).unwrap();
    let data = (0..8 * 8 * 8)
        .map(|index| {
            let x = index % 8;
            let y = index / 8 % 8;
            let z = index / 64;
            ((x + 2 * y + 3 * z + phase) % 16) as f32 / 15.
        })
        .collect();
    DenseVolume3::from_data(space, data)
}

fn state(volume_id: &str, orientation: SliceOrientation, dimensions: [u32; 2]) -> ViewState {
    ViewState::from_basic_params(
        volume_id.into(),
        [3.5, 3.5, 3.5],
        orientation,
        8.,
        dimensions,
        (0., 1.),
    )
    .with_crosshair(false)
}

#[test]
fn byte_budget_residents_beyond_draw_cap_render_like_low_id_reference() {
    pollster::block_on(async {
        let config = WgpuSliceRendererConfig {
            atlas: render_loop::RendererAtlasConfig {
                dimensions: [8, 8, 8],
                ..Default::default()
            },
            residency: RendererResidencyConfig::ByteBudget {
                budget_bytes: 1024 * 1024,
            },
            ..Default::default()
        };
        let mut renderer = WgpuSliceRenderer::configure(config)
            .await
            .expect("real GPU required");
        let mut high_handle = None;
        for index in 0..30 {
            let volume = tiny_volume(index);
            let handle = renderer
                .register_volume(
                    format!("resident-{index}"),
                    &volume,
                    RendererVolumeFormat::R8Unorm,
                )
                .expect("byte-budget resident admission");
            assert_eq!(
                handle.texture_index(),
                index as u32,
                "resident IDs remain stable"
            );
            if index == 29 {
                high_handle = Some(handle);
            }
        }
        let high_handle = high_handle.expect("captured high resident handle");
        let metrics = renderer.legacy_service().residency_metrics();
        assert_eq!(metrics.resident_count, 30);
        assert_eq!(metrics.resident_limit, None);
        assert!(metrics.used_bytes > 0 && metrics.used_bytes <= 1024 * 1024);

        let mut reference_config = WgpuSliceRendererConfig::default();
        reference_config.atlas.dimensions = [8, 8, 8];
        let mut reference = WgpuSliceRenderer::configure(reference_config)
            .await
            .expect("real GPU reference renderer required");
        reference
            .register_volume("reference", &tiny_volume(29), RendererVolumeFormat::R8Unorm)
            .expect("fresh low-ID reference");

        for (orientation, dimensions) in [
            (SliceOrientation::Axial, [32, 32]),
            (SliceOrientation::Coronal, [47, 31]),
            (SliceOrientation::Sagittal, [16, 40]),
        ] {
            let low = reference
                .request_frame(
                    ViewId::new(format!("low-{orientation:?}-{dimensions:?}")),
                    state("reference", orientation, dimensions),
                )
                .await
                .expect("low-ID readback")
                .image_data;
            let high = renderer
                .request_frame(
                    ViewId::new(format!("high-{orientation:?}-{dimensions:?}")),
                    state("resident-29", orientation, dimensions),
                )
                .await
                .expect("high-ID readback")
                .image_data;
            assert!(
                high.chunks_exact(4)
                    .any(|pixel| pixel[0] > 0 || pixel[1] > 0 || pixel[2] > 0),
                "high resident image is nonblank"
            );
            assert_eq!(high, low, "high resident ID changes no pixels");

            let zero = renderer
                .request_frame(
                    ViewId::new(format!("zero-{orientation:?}-{dimensions:?}")),
                    state("resident-0", orientation, dimensions),
                )
                .await
                .expect("low resident readback")
                .image_data;
            assert_ne!(zero, high, "distinct resident payloads must not alias");
            let high_again = renderer
                .request_frame(
                    ViewId::new(format!("high-again-{orientation:?}-{dimensions:?}")),
                    state("resident-29", orientation, dimensions),
                )
                .await
                .expect("high resident switch-back")
                .image_data;
            assert_eq!(
                high_again, high,
                "29 -> 0 -> 29 keeps the high resident binding"
            );
        }

        renderer
            .release_volume(&high_handle)
            .expect("release high resident");
        let reloaded = renderer
            .register_volume(
                "resident-29-reloaded",
                &tiny_volume(47),
                RendererVolumeFormat::R8Unorm,
            )
            .expect("reload released high resident");
        assert_eq!(reloaded.texture_index(), 29, "released ID is reused");
        reference
            .register_volume(
                "reference-reloaded",
                &tiny_volume(47),
                RendererVolumeFormat::R8Unorm,
            )
            .expect("fresh reloaded reference");
        let reloaded_high = renderer
            .request_frame(
                ViewId::new("high-reloaded"),
                state("resident-29-reloaded", SliceOrientation::Axial, [32, 32]),
            )
            .await
            .expect("reloaded high readback")
            .image_data;
        let reloaded_reference = reference
            .request_frame(
                ViewId::new("reference-reloaded"),
                state("reference-reloaded", SliceOrientation::Axial, [32, 32]),
            )
            .await
            .expect("reloaded reference readback")
            .image_data;
        assert_eq!(
            reloaded_high, reloaded_reference,
            "reused high ID binds fresh bytes"
        );

        // Sixteen layer rows are valid when they name only thirteen unique
        // sources; three duplicate rows do not consume more draw bindings.
        let mut thirteen_sources = state("resident-0", SliceOrientation::Axial, [32, 32]);
        thirteen_sources.layers = (0..16)
            .map(|row| LayerConfig::new(format!("resident-{}", row.min(12))))
            .collect();
        renderer
            .request_frame(ViewId::new("thirteen-distinct"), thirteen_sources)
            .await
            .expect("13 distinct sources in 16 rows fit the draw layout");

        let mut fourteen_sources = state("resident-0", SliceOrientation::Axial, [32, 32]);
        fourteen_sources.layers = (0..14)
            .map(|index| LayerConfig::new(format!("resident-{index}")))
            .collect();
        assert!(matches!(
            renderer
                .request_frame(ViewId::new("fourteen-distinct"), fourteen_sources)
                .await,
            Err(RenderLoopError::Internal { code: 6021, .. })
        ));
    });
}
