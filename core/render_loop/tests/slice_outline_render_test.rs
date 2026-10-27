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
        // Colormap 0 is grayscale; low label IDs are intentionally near black.
        // Use a categorical-visible palette so the baseline visibility check is meaningful.
        .with_colormap(1)
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
            // Field was renamed from a pad to a real `outline_mode`
            // (0 = outline the single selected_label_id).
            outline_mode: 0,
            outline_color: [0.0, 1.0, 0.0, 1.0],
            outline_thickness_px: 2.0,
            ..SliceFeatureUbo::default()
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

/// Axial view of the label box over the scalar ramp at 4 px/mm with the label
/// layer at `label_opacity`. The box covers voxels x 8..24, i.e. world
/// [7.5, 23.5), so pixel columns 30..=93 lie inside it (centre x = (col+0.5)/4).
fn lut_view_state(label_opacity: f32, include_scalar_underlay: bool) -> ViewState {
    let mut state = label_view_state(SliceOrientation::Axial, include_scalar_underlay);
    let label = state.layers.len() - 1;
    state.layers[label].opacity = label_opacity;
    state
}

const ROW: usize = 64;

fn px(image: &[u8], x: usize) -> [i32; 3] {
    let at = (ROW * 128 + x) * 4;
    [image[at] as i32, image[at + 1] as i32, image[at + 2] as i32]
}

fn assert_close(actual: [i32; 3], expected: [i32; 3], tolerance: i32, what: &str) {
    assert!(
        actual
            .iter()
            .zip(expected)
            .all(|(a, e)| (a - e).abs() <= tolerance),
        "{what}: got {actual:?}, expected {expected:?}"
    );
}

/// 60%-opaque black over `base`.
fn haloed(base: [i32; 3]) -> [i32; 3] {
    base.map(|c| (c as f32 * 0.4).round() as i32)
}

#[tokio::test]
async fn lut_coloured_outline_and_dark_halo_follow_region_boundaries() {
    let mut service = RenderLoopService::new()
        .await
        .expect("failed to initialize render service");
    service.load_shaders().expect("failed to load shaders");
    service
        .enable_world_space_rendering()
        .expect("failed to enable world-space rendering");
    for (id, volume) in [
        ("label-volume", create_label_box_volume()),
        ("scalar-underlay", create_scalar_underlay_volume()),
    ] {
        service
            .register_volume_with_upload(id.to_string(), &volume, wgpu::TextureFormat::R32Float)
            .expect("failed to register volume");
    }
    service
        .initialize_colormap()
        .expect("failed to initialize colormap");
    service
        .create_world_space_bind_groups()
        .expect("failed to create world-space bind groups");

    let mut frame = |id: &str, features: SliceFeatureUbo, state: ViewState| {
        service.update_slice_feature_ubo(features);
        let image = pollster::block_on(service.request_frame(ViewId::new(id), state))
            .expect("render failed")
            .image_data;
        image
    };

    // Region 2's LUT colour, from an opaque fill with no underlay.
    let region = px(
        &frame(
            "fill",
            SliceFeatureUbo::default(),
            lut_view_state(1.0, false),
        ),
        62,
    );
    // Translucent fill over the ramp, outline off: the comparison baseline.
    let baseline = frame(
        "baseline",
        SliceFeatureUbo::default(),
        lut_view_state(0.3, true),
    );
    let lut_features = |mode: u32| SliceFeatureUbo {
        outline_enabled: 1,
        outline_layer_index: 1,
        selected_label_id: if mode == 0 { 2 } else { 0 },
        outline_mode: mode,
        // Ignored in LUT mode except for its alpha.
        outline_color: [0.0, 1.0, 0.0, 1.0],
        outline_thickness_px: 2.0,
        outline_color_mode: 1,
        halo_thickness_px: 2.0,
        halo_color: [0.0, 0.0, 0.0, 0.6],
        ..SliceFeatureUbo::default()
    };
    assert_ne!(
        region,
        [0, 255, 0],
        "the LUT colour must differ from the uniform colour"
    );

    // Single label: outline is the region's inner 2 px band in its LUT colour,
    // the halo is the 2 px band just outside it, and pixels beyond are untouched.
    let single = frame("single", lut_features(0), lut_view_state(0.3, true));
    for x in [30, 31, 92, 93] {
        assert_close(
            px(&single, x),
            region,
            2,
            &format!("single outline at column {x}"),
        );
    }
    for x in [28, 29, 94, 95] {
        assert_close(
            px(&single, x),
            haloed(px(&baseline, x)),
            3,
            &format!("outer halo at column {x}"),
        );
    }
    for x in [27, 32, 62, 91, 96] {
        assert_eq!(
            px(&single, x),
            px(&baseline, x),
            "column {x} must be unchanged"
        );
    }

    // All boundaries: same outline band, halo as a second band inside the region.
    let all = frame("all", lut_features(1), lut_view_state(0.3, true));
    for x in [30, 31, 92, 93] {
        assert_close(
            px(&all, x),
            region,
            2,
            &format!("all-boundaries outline at column {x}"),
        );
    }
    for x in [32, 33, 90, 91] {
        assert_close(
            px(&all, x),
            haloed(px(&baseline, x)),
            3,
            &format!("inner halo at column {x}"),
        );
    }
    for x in [28, 29, 34, 62, 89, 94] {
        assert_eq!(
            px(&all, x),
            px(&baseline, x),
            "column {x} must be unchanged"
        );
    }

    // Zero outline and halo alpha (e.g. an "outline only" layer at opacity 0)
    // draws neither band.
    let hidden = frame(
        "hidden",
        SliceFeatureUbo {
            outline_color: [0.0, 1.0, 0.0, 0.0],
            halo_color: [0.0, 0.0, 0.0, 0.0],
            ..lut_features(0)
        },
        lut_view_state(0.3, true),
    );
    assert_eq!(
        hidden, baseline,
        "zero-alpha outline and halo must not draw"
    );
}
