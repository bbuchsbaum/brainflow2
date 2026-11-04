//! Byte-for-byte witnesses against the pre-R3 identity binding path. The
//! shader, layer order and scene are fixed; only texture binding positions vary.
use crate::view_state::{FrameRequestOptions, LayerConfig, SliceOrientation, ViewId, ViewState};
use crate::{BlendMode, LayerMode, RenderLoopService, SliceFeatureUbo, WgpuSliceRendererConfig};
use volmath::{DenseVolume3, NeuroSpace, NeuroSpaceExt};

fn volume(labels: bool, phase: usize) -> DenseVolume3<f32> {
    let space = NeuroSpace::from_dims_spacing_origin(vec![8; 3], vec![1.; 3], vec![0.; 3]).unwrap();
    let data = (0..512)
        .map(|i| {
            let x = i % 8;
            let y = i / 8 % 8;
            let z = i / 64;
            if labels {
                if (2..6).contains(&x) && (1..7).contains(&y) && (1..7).contains(&z) {
                    2.
                } else {
                    0.
                }
            } else {
                ((x + 2 * y + 3 * z + phase) % 16) as f32 / 15.
            }
        })
        .collect();
    DenseVolume3::from_data(space, data)
}

async fn setup() -> RenderLoopService {
    let mut config = WgpuSliceRendererConfig::default();
    config.atlas.dimensions = [1, 1, 1];
    let mut s = RenderLoopService::new_with_config(config)
        .await
        .expect("real GPU required");
    s.load_shaders().unwrap();
    for index in 0..13 {
        s.register_volume_with_upload(
            format!("v{index}"),
            &volume(index == 12, index),
            wgpu::TextureFormat::R32Float,
        )
        .unwrap();
        assert_eq!(s.volumes[&format!("v{index}")].atlas_index, index as u32);
    }
    s.multi_texture_manager
        .as_mut()
        .unwrap()
        .set_binding_capacity_for_test(4);
    s
}

fn state(orientation: SliceOrientation, dims: [u32; 2]) -> ViewState {
    ViewState::from_basic_params(
        "v11".into(),
        [3.5, 3.5, 3.5],
        orientation,
        8.,
        dims,
        (0., 1.),
    )
    .with_crosshair(false)
    .with_layers(vec![
        LayerConfig::new("v11".into()).with_intensity_window(0., 1.),
        LayerConfig::new("v12".into())
            .with_intensity_window(0., 2.)
            .with_colormap(1)
            .with_layer_mode(LayerMode::Label)
            .with_opacity(0.35),
        LayerConfig::new("v12".into())
            .with_intensity_window(0., 2.)
            .with_colormap(2)
            .with_layer_mode(LayerMode::Label)
            .with_opacity(0.15)
            .with_blend_mode(BlendMode::Normal),
    ])
}

async fn pair(s: &mut RenderLoopService, state: ViewState) -> Vec<u8> {
    s.multi_texture_manager
        .as_mut()
        .unwrap()
        .binding_planner
        .identity = false;
    let actual = s
        .request_frame(ViewId::new("compact"), state.clone())
        .await
        .unwrap()
        .image_data;
    s.multi_texture_manager
        .as_mut()
        .unwrap()
        .binding_planner
        .identity = true;
    let expected = s
        .request_frame(ViewId::new("reference"), state)
        .await
        .unwrap()
        .image_data;
    assert!(
        actual
            .chunks_exact(4)
            .any(|p| p[0] > 0 || p[1] > 0 || p[2] > 0),
        "nonblank oracle"
    );
    assert_eq!(actual, expected, "compact map changes scene pixels");
    actual
}

#[test]
fn r3_label_outline_member_swap_and_multiview_pixels_match_identity() {
    pollster::block_on(async {
        let mut s = setup().await;
        // Features remain keyed by composited layer, including duplicate sources.
        s.update_slice_features(&[
            SliceFeatureUbo {
                outline_enabled: 1,
                outline_layer_index: 1,
                selected_label_id: 2,
                outline_color: [0., 1., 0., 1.],
                outline_thickness_px: 2.,
                ..Default::default()
            },
            SliceFeatureUbo {
                outline_enabled: 1,
                outline_layer_index: 2,
                selected_label_id: 2,
                outline_color: [1., 0., 0., 0.5],
                outline_thickness_px: 1.,
                halo_thickness_px: 1.,
                ..Default::default()
            },
        ]);
        let orientations = [
            SliceOrientation::Axial,
            SliceOrientation::Coronal,
            SliceOrientation::Sagittal,
        ];
        for orientation in orientations {
            for dims in [[32, 32], [47, 31], [16, 16]] {
                // Compare panes and Mosaic-sized cells
                let first = pair(&mut s, state(orientation, dims)).await;
                let mut reordered = state(orientation, dims);
                reordered.layers.swap(1, 2);
                pair(&mut s, reordered).await;
                if orientation == SliceOrientation::Axial && dims == [32, 32] {
                    s.update_slice_features(&[]);
                    let no_outline = pair(&mut s, state(orientation, dims)).await;
                    assert_ne!(first, no_outline, "outline witness must affect pixels");
                    s.update_slice_features(&[SliceFeatureUbo {
                        outline_enabled: 1,
                        outline_layer_index: 1,
                        selected_label_id: 2,
                        outline_color: [0., 1., 0., 1.],
                        outline_thickness_px: 2.,
                        ..Default::default()
                    }]);
                }
            }
        }
        let before = pair(&mut s, state(SliceOrientation::Axial, [32, 32])).await;
        // Same resident allocation, different member bytes: a 4D ring's update path.
        s.update_volume_3d_at(11, &volume(false, 7)).unwrap();
        let after = pair(&mut s, state(SliceOrientation::Axial, [32, 32])).await;
        assert_ne!(before, after, "member swap must change visible pixels");
    });
}

#[test]
fn r3_sparse_alpha_mask_moves_with_its_volume_and_matches_identity() {
    pollster::block_on(async {
        let mut s = setup().await;
        s.create_offscreen_target(32, 32).unwrap();
        s.clear_render_layers();
        s.add_layer_3d(11, nalgebra::Matrix4::identity(), (8, 8, 8), 1., 0, 0)
            .unwrap();
        s.update_frame_ubo([0., 0., 3.5, 1.], [8., 0., 0., 0.], [0., 8., 0., 0.]);
        let masks = [
            vec![255u8; 512],
            (0..512).map(|i| if i % 8 < 4 { 255 } else { 0 }).collect(),
        ];
        let mut images = Vec::new();
        for mask in masks {
            s.upload_alpha_mask(11, [8, 8, 8], &mask).unwrap();
            s.multi_texture_manager
                .as_mut()
                .unwrap()
                .binding_planner
                .identity = false;
            let actual = s.render_to_buffer().unwrap();
            s.multi_texture_manager
                .as_mut()
                .unwrap()
                .binding_planner
                .identity = true;
            let expected = s.render_to_buffer().unwrap();
            assert_eq!(
                actual, expected,
                "mask must bind beside its high-index volume"
            );
            images.push(actual);
        }
        assert_ne!(images[0], images[1], "mask witness must affect pixels");
        s.clear_alpha_mask(11).unwrap();
        s.multi_texture_manager
            .as_mut()
            .unwrap()
            .binding_planner
            .identity = false;
        assert_eq!(
            s.render_to_buffer().unwrap(),
            images[0],
            "clearing mask restores unmasked image"
        );
    });
}

#[test]
fn r3_pending_snapshots_survive_plan_changes_and_cache_invalidation() {
    pollster::block_on(async {
        let mut s = setup().await;
        let a = state(SliceOrientation::Axial, [47, 31]);
        let mut b = state(SliceOrientation::Sagittal, [32, 32]);
        b.layers[0].volume_id = "v5".into();
        let expected_a = pair(&mut s, a.clone()).await;
        let expected_b = pair(&mut s, b.clone()).await;
        s.multi_texture_manager
            .as_mut()
            .unwrap()
            .binding_planner
            .identity = false;
        let first = s
            .submit_frame_with_options(ViewId::new("shared"), a, FrameRequestOptions::default())
            .unwrap()
            .into_snapshot();
        let second = s
            .submit_frame_with_options(ViewId::new("shared"), b, FrameRequestOptions::default())
            .unwrap()
            .into_snapshot();
        // All cached groups are dropped and a source is released before readback.
        s.release_volume(11).unwrap();
        s.initialize_colormap().unwrap();
        assert_eq!(first.complete().await.unwrap().image_data, expected_a);
        assert_eq!(second.complete().await.unwrap().image_data, expected_b);
    });
}

#[test]
fn r3_frame_diagnostics_report_creation_and_hits() {
    pollster::block_on(async {
        let mut s = setup().await;
        let view = state(SliceOrientation::Axial, [32, 32]);
        let first = s
            .request_frame(ViewId::new("diagnostics"), view.clone())
            .await
            .unwrap();
        assert_eq!(first.diagnostics.texture_bind_groups_created, 1);
        assert!(!first.diagnostics.texture_binding_cache_hit);
        let second = s
            .request_frame(ViewId::new("diagnostics"), view.clone())
            .await
            .unwrap();
        assert_eq!(second.diagnostics.texture_bind_groups_created, 0);
        assert!(second.diagnostics.texture_binding_cache_hit);
        let mut patched = view;
        patched.layers[1].opacity = 0.6;
        let third = s
            .request_frame(ViewId::new("diagnostics"), patched)
            .await
            .unwrap();
        assert_eq!(third.diagnostics.texture_bind_groups_created, 0);
        assert!(third.diagnostics.texture_binding_cache_hit);
        assert_eq!(third.diagnostics.updated_layer_slots, 1);
    });
}
