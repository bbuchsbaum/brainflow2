// A probability-like overlay (value 0.998, window 0..1) with the Jet colormap.
//
// Scalar mode draws Jet's top end (dark red). Mask mode is a flat white fill of
// every voxel above 0.1 that ignores the colormap and the window: the UI must
// therefore send `LayerMode::Mask` only for a true {0, 1} image (it used to send
// it for any file named like a mask, so `p4_brain_mask_prob.nii` drew solid
// white under a Jet colorbar).

use colormap::BuiltinColormap;
use nalgebra::{Matrix4, Vector3};
use render_loop::{BlendMode, LayerInfo, LayerMode, RenderLoopService, ThresholdMode};
use volmath::space::NeuroSpace3;
use volmath::{DenseVolume3, NeuroSpaceExt};

#[test]
fn jet_layer_is_dark_red_in_scalar_mode_and_flat_white_in_mask_mode() {
    // The LUT itself ends in dark red, never white.
    let jet = colormap::colormap_data(BuiltinColormap::Jet);
    let [r, g, b, _] = jet[255];
    assert!(
        r > 100 && g < 40 && b < 40,
        "Jet must end dark red: {:?}",
        jet[255]
    );

    pollster::block_on(async {
        let mut service = RenderLoopService::new()
            .await
            .expect("a GPU adapter is required: this test does not skip");
        service.load_shaders().expect("load shaders");
        service.initialize_colormap().expect("initialize colormap");
        service
            .enable_world_space_rendering()
            .expect("enable world-space rendering");
        service
            .create_offscreen_target(32, 32)
            .expect("create offscreen target");

        let dims = [4, 4, 4];
        let transform = Matrix4::new_translation(&Vector3::new(-2.0, -2.0, -2.0));
        let space = NeuroSpace3::new(
            <volmath::NeuroSpace as NeuroSpaceExt>::from_affine_matrix4(dims.to_vec(), transform)
                .expect("space"),
        );
        let volume = DenseVolume3::from_data(space.0, vec![0.998f32; 64]);
        let (handle, tfm) = service.upload_volume_3d(&volume).expect("upload volume");
        service
            .create_world_space_bind_groups()
            .expect("create bind groups");

        let mut center_pixel = |layer_mode: LayerMode| -> [u8; 4] {
            let layer = LayerInfo {
                atlas_index: handle,
                opacity: 1.0,
                blend_mode: BlendMode::Normal,
                colormap_id: BuiltinColormap::Jet.id() as u32,
                intensity_range: (1.2e-4, 1.0),
                threshold_range: (0.0, 0.0),
                threshold_mode: ThresholdMode::Range,
                texture_coords: (0.0, 0.0, 1.0, 1.0),
                is_mask: false,
                has_alpha_mask: false,
                layer_mode,
                interpolation_mode: 1,
                ..Default::default()
            };
            let layer_storage = service
                .layer_storage_manager
                .as_mut()
                .expect("layer storage");
            layer_storage.update_layers(
                &service.device,
                &service.queue,
                service.layer_bind_group_layout.as_ref().unwrap(),
                &[layer],
                &[(4u32, 4u32, 4u32)],
                &[tfm],
            );
            service.update_frame_ubo(
                [-2.0, -2.0, 0.0, 1.0],
                [4.0, 0.0, 0.0, 0.0],
                [0.0, 4.0, 0.0, 0.0],
            );
            service.update_crosshair_position([0.0, 0.0, 0.0], false);
            let rendered = service.render_to_buffer().expect("render");
            let i = (16 * 32 + 16) * 4;
            [
                rendered[i],
                rendered[i + 1],
                rendered[i + 2],
                rendered[i + 3],
            ]
        };

        let scalar = center_pixel(LayerMode::Scalar);
        assert!(
            scalar[0] > 100 && scalar[1] < 60 && scalar[2] < 60,
            "scalar Jet at 0.998 must be dark red, got {scalar:?}"
        );

        let mask = center_pixel(LayerMode::Mask);
        assert!(
            mask[0] > 250 && mask[1] > 250 && mask[2] > 250,
            "mask mode is a flat white fill whatever the colormap, got {mask:?}"
        );
    });
}
