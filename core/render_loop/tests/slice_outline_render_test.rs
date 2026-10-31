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

    // Single label: the box edge lies between columns 29|30 and 93|94 (world
    // x 7.5 and 23.5). The outline is a 2 px line centred on it in the region's
    // LUT colour, the halo the 2 px band just outside it, and pixels beyond
    // are untouched.
    let single = frame("single", lut_features(0), lut_view_state(0.3, true));
    for x in [29, 30, 93, 94] {
        assert_close(
            px(&single, x),
            region,
            2,
            &format!("single outline at column {x}"),
        );
    }
    for x in [27, 28, 95, 96] {
        assert_close(
            px(&single, x),
            haloed(px(&baseline, x)),
            3,
            &format!("outer halo at column {x}"),
        );
    }
    for x in [26, 31, 32, 62, 92, 97] {
        assert_eq!(
            px(&single, x),
            px(&baseline, x),
            "column {x} must be unchanged"
        );
    }

    // All boundaries: the same centred line, with a 2 px halo on both sides.
    let all = frame("all", lut_features(1), lut_view_state(0.3, true));
    for x in [29, 30, 93, 94] {
        assert_close(
            px(&all, x),
            region,
            2,
            &format!("all-boundaries outline at column {x}"),
        );
    }
    for x in [27, 28, 31, 32, 91, 92, 95, 96] {
        assert_close(
            px(&all, x),
            haloed(px(&baseline, x)),
            3,
            &format!("halo at column {x}"),
        );
    }
    for x in [26, 33, 62, 90, 97] {
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

/// Label volume with voxel-to-world `affine` and `label_at(i, j, k)` per voxel.
fn create_label_volume(
    dims: [usize; 3],
    affine: Matrix4<f32>,
    label_at: impl Fn(usize, usize, usize) -> f32,
) -> DenseVolume3<f32> {
    let space = <volmath::NeuroSpace as NeuroSpaceExt>::from_affine_matrix4(dims.to_vec(), affine)
        .expect("failed to create test neurospace");
    let mut data = Vec::with_capacity(dims[0] * dims[1] * dims[2]);
    for k in 0..dims[2] {
        for j in 0..dims[1] {
            for i in 0..dims[0] {
                data.push(label_at(i, j, k));
            }
        }
    }
    DenseVolume3::<f32>::from_data(space, data)
}

/// 32x32x4 label volume (identity affine) with `label_at(x, y)` in every slice.
fn create_two_label_volume(label_at: impl Fn(usize, usize) -> f32) -> DenseVolume3<f32> {
    create_label_volume([32, 32, 4], Matrix4::identity(), |x, y, _| label_at(x, y))
}

/// All-boundaries outline features: uniform `color`, no halo.
fn boundary_features(thickness_px: f32, color: [f32; 4]) -> SliceFeatureUbo {
    SliceFeatureUbo {
        outline_enabled: 1,
        outline_layer_index: 0,
        selected_label_id: 0,
        outline_mode: 1,
        outline_color: color,
        outline_thickness_px: thickness_px,
        outline_color_mode: 0,
        halo_thickness_px: 0.0,
        ..SliceFeatureUbo::default()
    }
}

/// Axial 128x128 view of `volume` centred at `center` with a `fov_mm` field of
/// view, outline `features` on the label layer, and the label colours from
/// `lut` (a full RGBA LUT row) when given. The fill is drawn at the "outline
/// only" opacity over black, so the image shows the outline alone (the
/// target's alpha channel is opaque). Returns RGBA rows.
async fn render_outline(
    volume: DenseVolume3<f32>,
    center: [f32; 3],
    fov_mm: f32,
    features: SliceFeatureUbo,
    lut: Option<Vec<u8>>,
) -> Vec<Vec<[u8; 4]>> {
    let mut service = RenderLoopService::new()
        .await
        .expect("failed to initialize render service");
    service.load_shaders().expect("failed to load shaders");
    service
        .enable_world_space_rendering()
        .expect("failed to enable world-space rendering");
    service
        .register_volume_with_upload(
            "two-label".to_string(),
            &volume,
            wgpu::TextureFormat::R32Float,
        )
        .expect("failed to register label volume");
    service
        .initialize_colormap()
        .expect("failed to initialize colormap");
    let colormap = match lut {
        Some(row) => service
            .upsert_custom_colormap("test-labels".to_string(), &row)
            .expect("failed to upload label LUT"),
        None => 1,
    };
    service
        .create_world_space_bind_groups()
        .expect("failed to create world-space bind groups");
    service.update_slice_feature_ubo(features);

    let layer = LayerConfig::new("two-label".to_string())
        .with_opacity(1e-3)
        .with_colormap(colormap)
        .with_blend_mode(BlendMode::Normal)
        .with_intensity_window(0.0, 2.0)
        .with_interpolation(InterpolationMode::Nearest)
        .with_layer_mode(LayerMode::Label);
    let state = ViewState::from_basic_params(
        "two-label".to_string(),
        center,
        SliceOrientation::Axial,
        fov_mm,
        [128, 128],
        (0.0, 2.0),
    )
    .with_layers(vec![layer])
    .with_crosshair(false);

    let image = service
        .request_frame(ViewId::new("two-label"), state)
        .await
        .expect("failed to render outline")
        .image_data;
    image
        .chunks_exact(128 * 4)
        .map(|row| {
            row.chunks_exact(4)
                .map(|px| [px[0], px[1], px[2], px[3]])
                .collect()
        })
        .collect()
}

/// Renders an all-boundaries outline (uniform white, no halo) of a two-label
/// 32x32 volume at 4 px per voxel and returns 128x128 rows of outline
/// coverage (white over black, so the red channel).
async fn outline_alpha(volume: DenseVolume3<f32>, thickness_px: f32) -> Vec<Vec<u8>> {
    render_outline(
        volume,
        [16.0, 16.0, 2.0],
        32.0,
        boundary_features(thickness_px, [1.0, 1.0, 1.0, 1.0]),
        None,
    )
    .await
    .into_iter()
    .map(|row| row.into_iter().map(|px| px[0]).collect())
    .collect()
}

/// Columns 8..120 only: the volume's own edge (label vs. outside) is also a
/// boundary and is drawn at the image border.
const INNER: std::ops::Range<usize> = 8..120;

/// Runs of consecutive non-zero alpha within `INNER`, as (start, end) columns.
fn runs(row: &[u8]) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    let mut start = None;
    for x in INNER {
        match (row[x] > 0, start) {
            (true, None) => start = Some(x),
            (false, Some(s)) => {
                out.push((s, x));
                start = None;
            }
            _ => {}
        }
    }
    if let Some(s) = start {
        out.push((s, INNER.end));
    }
    out
}

#[tokio::test]
async fn shared_border_draws_one_centred_band() {
    // Labels 1 | 2 meet at world x = 15.5, between columns 61 and 62. A 2 px
    // outline is one 2 px band there, not a 2 px band inside each region.
    let alpha = outline_alpha(
        create_two_label_volume(|x, _| if x < 16 { 1.0 } else { 2.0 }),
        2.0,
    )
    .await;
    for (y, row) in alpha.iter().enumerate().take(112).skip(16) {
        assert_eq!(
            runs(row),
            vec![(61, 63)],
            "row {y}: one band at columns 61..63"
        );
        assert!(
            row[61] > 250 && row[62] > 250,
            "row {y}: the band is fully covered, got {:?}",
            &row[59..65]
        );
    }
}

#[tokio::test]
async fn diagonal_staircase_renders_as_a_straight_antialiased_line() {
    // A 45 degree voxel staircase: label 1 where x + y < 31, else label 2.
    let alpha = outline_alpha(
        create_two_label_volume(|x, y| if x + y < 31 { 1.0 } else { 2.0 }),
        1.0,
    )
    .await;

    let mut rows = Vec::new();
    let mut centroids = Vec::new();
    let mut partial = 0usize;
    for (y, row) in alpha.iter().enumerate().take(112).skip(16) {
        let found = runs(row);
        assert_eq!(found.len(), 1, "row {y}: expected one band, got {found:?}");
        let (start, end) = found[0];
        assert!(
            end - start <= 4,
            "row {y}: a 1 px 45 degree line spans at most 4 columns, got {:?}",
            &row[start..end]
        );
        partial += row[start..end]
            .iter()
            .filter(|&&a| (30..=225).contains(&a))
            .count();
        let weight: f64 = row[start..end].iter().map(|&a| a as f64).sum();
        let centroid: f64 = (start..end).map(|x| x as f64 * row[x] as f64).sum::<f64>() / weight;
        rows.push(y as f64);
        centroids.push(centroid);
    }

    // Anti-aliased: most rows carry intermediate coverage, not a binary step.
    assert!(
        partial >= rows.len(),
        "expected intermediate alpha along the edge, got {partial} partial pixels in {} rows",
        rows.len()
    );

    // Straight: the band centre follows a 45 degree line. A 4 px voxel
    // staircase would leave residuals of about 1.5 px.
    let n = rows.len() as f64;
    let (mean_y, mean_x) = (
        rows.iter().sum::<f64>() / n,
        centroids.iter().sum::<f64>() / n,
    );
    let slope = rows
        .iter()
        .zip(&centroids)
        .map(|(y, x)| (y - mean_y) * (x - mean_x))
        .sum::<f64>()
        / rows.iter().map(|y| (y - mean_y).powi(2)).sum::<f64>();
    assert!(
        (slope.abs() - 1.0).abs() < 0.05,
        "the outline should run at 45 degrees, slope {slope}"
    );
    let worst = rows
        .iter()
        .zip(&centroids)
        .map(|(y, x)| (x - (mean_x + slope * (y - mean_y))).abs())
        .fold(0.0f64, f64::max);
    eprintln!(
        "diagonal outline: slope {slope:.3}, worst deviation {worst:.2} px, {partial} partial pixels in {} rows",
        rows.len()
    );
    assert!(
        worst <= 0.75,
        "the outline should be straight, worst deviation {worst:.2} px"
    );
}

#[tokio::test]
async fn default_halo_renders_at_two_pixels_per_voxel() {
    // A 1 mm atlas in a ~400 px pane is about 2 px per voxel. The default
    // 2 px line plus 1 px halo is wider than one voxel there and must still
    // render: labels 1 | 2 meet at world x = 31.5, between columns 62 and 63.
    let volume = create_label_volume([64, 64, 4], Matrix4::identity(), |x, _, _| {
        if x < 32 {
            1.0
        } else {
            2.0
        }
    });
    let features = SliceFeatureUbo {
        halo_thickness_px: 1.0,
        halo_color: [0.0, 0.0, 1.0, 1.0],
        ..boundary_features(2.0, [1.0, 0.0, 0.0, 1.0])
    };
    let image = render_outline(volume, [32.0, 32.0, 2.0], 64.0, features, None).await;
    for (y, row) in image.iter().enumerate().take(112).skip(16) {
        let red = |x: usize| row[x][0] > 250 && row[x][2] < 5;
        let blue = |x: usize| row[x][2] > 250 && row[x][0] < 5;
        let black = |x: usize| row[x][..3].iter().all(|&c| c < 5);
        assert!(
            red(62) && red(63),
            "row {y}: 2 px line, got {:?}",
            &row[59..67]
        );
        assert!(
            blue(61) && blue(64),
            "row {y}: 1 px halo each side, got {:?}",
            &row[59..67]
        );
        assert!(
            black(60) && black(65),
            "row {y}: nothing beyond, got {:?}",
            &row[59..67]
        );
    }
}

#[tokio::test]
async fn hidden_region_keeps_its_visible_neighbours_border() {
    // LUT colours: label 1 hidden (alpha 0), label 2 opaque red. The shared
    // border would tie to the lower (hidden) id; it must draw in label 2's
    // colour instead of vanishing.
    let width = render_loop::texture_manager::COLORMAP_LUT_WIDTH as usize;
    let mut lut = vec![0u8; width * 4];
    lut[4..8].copy_from_slice(&[0, 255, 0, 0]);
    lut[8..12].copy_from_slice(&[255, 0, 0, 255]);
    let features = SliceFeatureUbo {
        outline_color_mode: 1,
        ..boundary_features(2.0, [1.0, 1.0, 1.0, 1.0])
    };
    let image = render_outline(
        create_two_label_volume(|x, _| if x < 16 { 1.0 } else { 2.0 }),
        [16.0, 16.0, 2.0],
        32.0,
        features,
        Some(lut),
    )
    .await;
    for (y, row) in image.iter().enumerate().take(112).skip(16) {
        for x in [61, 62] {
            assert!(
                row[x][0] > 250 && row[x][1] < 5 && row[x][2] < 5,
                "row {y}, column {x}: the border takes the visible region's red, got {:?}",
                row[x]
            );
        }
        assert!(
            row[59][..3].iter().all(|&c| c < 5) && row[64][..3].iter().all(|&c| c < 5),
            "row {y}: one 2 px band"
        );
    }
}

#[tokio::test]
async fn oblique_volume_keeps_boundaries_near_parallel_to_the_slice() {
    // A label volume tilted 30 degrees about x, cut by a world-axial slice.
    // Its labels change only along voxel k (1 below k = 32, 2 above), so the
    // boundary plane is 30 degrees off the slice and every in-plane cell sees
    // it only through the normal-axis voxel each corner crosses. The slice
    // crosses it along one line parallel to world x.
    let (s, c) = 30f32.to_radians().sin_cos();
    let rotation = Matrix4::new(
        1.0, 0.0, 0.0, 0.0, //
        0.0, c, -s, 0.0, //
        0.0, s, c, 0.0, //
        0.0, 0.0, 0.0, 1.0,
    );
    // Voxel (32, 32, 32) sits at the view centre, world (16, 16, 8).
    let centre = rotation.transform_point(&nalgebra::Point3::new(32.0, 32.0, 32.0));
    let mut affine = rotation;
    affine[(0, 3)] = 16.0 - centre.x;
    affine[(1, 3)] = 16.0 - centre.y;
    affine[(2, 3)] = 8.0 - centre.z;
    let volume = create_label_volume(
        [64, 64, 64],
        affine,
        |_, _, k| if k < 32 { 1.0 } else { 2.0 },
    );

    let image = render_outline(
        volume,
        [16.0, 16.0, 8.0],
        32.0,
        boundary_features(2.0, [1.0, 1.0, 1.0, 1.0]),
        None,
    )
    .await;
    let mut band_rows = Vec::new();
    for x in INNER {
        let column: Vec<u8> = image.iter().map(|row| row[x][0]).collect();
        let found = runs(&column);
        assert_eq!(
            found.len(),
            1,
            "column {x}: expected one boundary, got {found:?}"
        );
        let (start, end) = found[0];
        assert!(
            column[start..end].iter().any(|&a| a > 250),
            "column {x}: the boundary is fully drawn somewhere, got {:?}",
            &column[start..end]
        );
        band_rows.push((start, end));
    }
    let first = band_rows[0];
    assert!(
        band_rows
            .iter()
            .all(|&(s, e)| s.abs_diff(first.0) <= 1 && e.abs_diff(first.1) <= 1),
        "the boundary should run straight along world x, got {band_rows:?}"
    );
}
