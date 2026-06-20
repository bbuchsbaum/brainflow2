use nalgebra::Matrix4;
use render_loop::view_state::{
    InterpolationMode, LayerConfig, SliceOrientation, ViewId, ViewState,
};
use render_loop::{BlendMode, LayerMode, RenderLoopService, SliceFeatureUbo};
use volmath::{DenseVolume3, NeuroSpaceExt};

fn create_label_box_volume() -> DenseVolume3<f32> {
    let dims = [32, 32, 16];
    let space = <volmath::NeuroSpace as NeuroSpaceExt>::from_affine_matrix4(
        dims.to_vec(),
        Matrix4::identity(),
    )
    .expect("failed to create test neurospace");

    let mut data = Vec::with_capacity(dims[0] * dims[1] * dims[2]);
    for z in 0..dims[2] {
        for y in 0..dims[1] {
            for x in 0..dims[0] {
                let value = if (8..24).contains(&x) && (7..25).contains(&y) && (4..12).contains(&z)
                {
                    2.0
                } else {
                    0.0
                };
                data.push(value);
            }
        }
    }

    DenseVolume3::<f32>::from_data(space, data)
}

fn create_scalar_underlay_volume() -> DenseVolume3<f32> {
    let dims = [32, 32, 16];
    let space = <volmath::NeuroSpace as NeuroSpaceExt>::from_affine_matrix4(
        dims.to_vec(),
        Matrix4::identity(),
    )
    .expect("failed to create test neurospace");

    let mut data = Vec::with_capacity(dims[0] * dims[1] * dims[2]);
    for z in 0..dims[2] {
        for y in 0..dims[1] {
            for x in 0..dims[0] {
                let x_norm = x as f32 / (dims[0] - 1) as f32;
                let y_norm = y as f32 / (dims[1] - 1) as f32;
                let z_norm = z as f32 / (dims[2] - 1) as f32;
                data.push(0.15 + 0.65 * x_norm + 0.15 * y_norm + 0.05 * z_norm);
            }
        }
    }

    DenseVolume3::<f32>::from_data(space, data)
}

fn label_view_state(orientation: SliceOrientation, include_scalar_underlay: bool) -> ViewState {
    let scalar_layer = LayerConfig::new("scalar-underlay".to_string())
        .with_opacity(1.0)
        .with_colormap(0)
        .with_blend_mode(BlendMode::Normal)
        .with_intensity_window(0.0, 1.0);

    let label_layer = LayerConfig::new("label-volume".to_string())
        .with_opacity(1.0)
        .with_colormap(0)
        .with_blend_mode(BlendMode::Normal)
        .with_intensity_window(0.0, 2.0)
        .with_interpolation(InterpolationMode::Linear)
        .with_layer_mode(LayerMode::Label);

    let layers = if include_scalar_underlay {
        vec![scalar_layer, label_layer]
    } else {
        vec![label_layer]
    };

    ViewState::from_basic_params(
        layers[0].volume_id.clone(),
        [16.0, 16.0, 8.0],
        orientation,
        32.0,
        [128, 128],
        (0.0, 1.0),
    )
    .with_layers(layers)
    .with_crosshair(false)
}

fn count_nontransparent_pixels(image: &[u8]) -> usize {
    image.chunks_exact(4).filter(|px| px[3] > 0).count()
}

fn count_nonblack_pixels(image: &[u8]) -> usize {
    image
        .chunks_exact(4)
        .filter(|px| px[0] > 0 || px[1] > 0 || px[2] > 0)
        .count()
}

fn count_green_outline_pixels(image: &[u8]) -> usize {
    image
        .chunks_exact(4)
        .filter(|px| px[1] > 220 && px[0] < 40 && px[2] < 40 && px[3] > 220)
        .count()
}

#[tokio::test]
async fn selected_label_outline_renders_without_black_frame() {
    let label_volume = create_label_box_volume();
    let scalar_underlay = create_scalar_underlay_volume();
    let mut service = RenderLoopService::new()
        .await
        .expect("failed to initialize render service");

    service.load_shaders().expect("failed to load shaders");
    service
        .enable_world_space_rendering()
        .expect("failed to enable world-space rendering");
    service
        .register_volume_with_upload(
            "label-volume".to_string(),
            &label_volume,
            wgpu::TextureFormat::R32Float,
        )
        .expect("failed to register label volume");
    service
        .register_volume_with_upload(
            "scalar-underlay".to_string(),
            &scalar_underlay,
            wgpu::TextureFormat::R32Float,
        )
        .expect("failed to register scalar underlay");
    service
        .initialize_colormap()
        .expect("failed to initialize colormap");
    service
        .create_world_space_bind_groups()
        .expect("failed to create world-space bind groups");

    for orientation in [
        SliceOrientation::Axial,
        SliceOrientation::Coronal,
        SliceOrientation::Sagittal,
    ] {
        service.update_slice_feature_ubo(SliceFeatureUbo::default());
        let label_only = service
            .request_frame(
                ViewId::new(format!("label-only-{orientation:?}")),
                label_view_state(orientation, false),
            )
            .await
            .expect("failed to render label baseline");

        assert!(
            count_nontransparent_pixels(&label_only.image_data) > 0,
            "{orientation:?} label slice should render visible pixels"
        );
        assert!(
            count_nonblack_pixels(&label_only.image_data) > 0,
            "{orientation:?} label slice should not black-frame"
        );
        assert_eq!(
            count_green_outline_pixels(&label_only.image_data),
            0,
            "{orientation:?} baseline should not contain outline pixels"
        );

        let scalar_baseline = service
            .request_frame(
                ViewId::new(format!("scalar-plus-label-baseline-{orientation:?}")),
                label_view_state(orientation, true),
            )
            .await
            .expect("failed to render scalar underlay plus label baseline");
        let scalar_baseline_nonblack = count_nonblack_pixels(&scalar_baseline.image_data);
        assert!(
            scalar_baseline_nonblack > count_nonblack_pixels(&label_only.image_data),
            "{orientation:?} scalar underlay should remain visible outside the label"
        );

        service.update_slice_feature_ubo(SliceFeatureUbo {
            outline_enabled: 1,
            outline_layer_index: 1,
            selected_label_id: 2,
            _pad0: 0,
            outline_color: [0.0, 1.0, 0.0, 1.0],
            outline_thickness_px: 2.0,
            _pad1: [0.0; 3],
        });

        let outlined = service
            .request_frame(
                ViewId::new(format!("scalar-plus-label-outlined-{orientation:?}")),
                label_view_state(orientation, true),
            )
            .await
            .expect("failed to render selected label outline");

        let outline_pixels = count_green_outline_pixels(&outlined.image_data);
        assert!(
            outline_pixels > 0,
            "{orientation:?} selected label outline should produce distinct green edge pixels"
        );
        assert!(
            count_nonblack_pixels(&outlined.image_data) >= scalar_baseline_nonblack,
            "{orientation:?} enabling outline should not black-frame or erase the scalar underlay"
        );
    }
}
