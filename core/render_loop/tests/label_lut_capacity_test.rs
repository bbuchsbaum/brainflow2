//! Categorical palettes cover every u16 label id. The LUT tiles ids row-major
//! (texel `(id % WIDTH, id / WIDTH)`) while continuous colormaps keep row 0.
//! These tests run on the GPU and never soft-skip.
use nalgebra::Matrix4;
use render_loop::texture_manager::{
    COLORMAP_LUT_ROWS, COLORMAP_LUT_WIDTH, COLORMAP_ROW_BYTES, LABEL_LUT_CAPACITY,
};
use render_loop::view_state::{
    InterpolationMode, LayerConfig, SliceOrientation, ViewId, ViewState,
};
use render_loop::{BlendMode, LayerMode, RenderLoopService, SliceFeatureUbo};
use volmath::{DenseVolume3, NeuroSpaceExt};

/// Eight 4-voxel-wide bands along x in a 32x32x4 identity-affine volume.
const BANDS: [f32; 8] = [
    1.0, 2047.0, 2048.0, 2049.0, 4097.0, 40000.0, 65534.0, 65535.0,
];
/// Palette colours per band; band 3 (id 2049) is deliberately absent.
const COLOURS: [Option<[u8; 3]>; 8] = [
    Some([255, 0, 0]),
    Some([0, 255, 0]),
    Some([0, 0, 255]),
    None,
    Some([255, 255, 0]),
    Some([255, 0, 255]),
    Some([0, 255, 255]),
    Some([255, 128, 0]),
];

fn volume(value_at: impl Fn(usize) -> f32) -> DenseVolume3<f32> {
    let dims = [32usize, 32, 4];
    let space = <volmath::NeuroSpace as NeuroSpaceExt>::from_affine_matrix4(
        dims.to_vec(),
        Matrix4::identity(),
    )
    .expect("test neurospace");
    let mut data = Vec::with_capacity(32 * 32 * 4);
    for _k in 0..4 {
        for _j in 0..32 {
            for i in 0..32 {
                data.push(value_at(i));
            }
        }
    }
    DenseVolume3::<f32>::from_data(space, data)
}

fn tiled_palette() -> Vec<u8> {
    let mut lut = vec![0u8; COLORMAP_ROW_BYTES * COLORMAP_LUT_ROWS as usize];
    for (id, colour) in BANDS.iter().zip(COLOURS) {
        if let Some([r, g, b]) = colour {
            let at = *id as usize * 4;
            lut[at..at + 4].copy_from_slice(&[r, g, b, 255]);
        }
    }
    lut
}

async fn service() -> RenderLoopService {
    let mut service = RenderLoopService::new()
        .await
        .expect("failed to initialize render service");
    service.load_shaders().expect("failed to load shaders");
    service
        .enable_world_space_rendering()
        .expect("failed to enable world-space rendering");
    service
        .initialize_colormap()
        .expect("failed to initialize colormap");
    service
}

/// Axial 128x128 view at 4 px per voxel; returns the middle row's pixels.
async fn render_row(
    service: &mut RenderLoopService,
    id: &str,
    colormap: u32,
    mode: LayerMode,
    window: (f32, f32),
) -> Vec<[u8; 4]> {
    service
        .create_world_space_bind_groups()
        .expect("failed to create world-space bind groups");
    render_row_with_current_bind_groups(service, id, colormap, mode, window).await
}

/// As `render_row`, without recreating bind groups (proves cached ones are current).
async fn render_row_with_current_bind_groups(
    service: &mut RenderLoopService,
    id: &str,
    colormap: u32,
    mode: LayerMode,
    window: (f32, f32),
) -> Vec<[u8; 4]> {
    service.update_slice_feature_ubo(SliceFeatureUbo::default());
    let layer = LayerConfig::new(id.to_string())
        .with_opacity(1.0)
        .with_colormap(colormap)
        .with_blend_mode(BlendMode::Normal)
        .with_intensity_window(window.0, window.1)
        .with_interpolation(InterpolationMode::Nearest)
        .with_layer_mode(mode);
    let state = ViewState::from_basic_params(
        id.to_string(),
        [16.0, 16.0, 2.0],
        SliceOrientation::Axial,
        32.0,
        [128, 128],
        window,
    )
    .with_layers(vec![layer])
    .with_crosshair(false);
    let image = service
        .request_frame(ViewId::new(id), state)
        .await
        .expect("failed to render")
        .image_data;
    image[64 * 128 * 4..65 * 128 * 4]
        .chunks_exact(4)
        .map(|px| [px[0], px[1], px[2], px[3]])
        .collect()
}

#[test]
fn the_tiled_lut_has_a_texel_for_every_u16_id() {
    assert!(LABEL_LUT_CAPACITY > u32::from(u16::MAX));
    assert_eq!(COLORMAP_ROW_BYTES, COLORMAP_LUT_WIDTH as usize * 4);
}

#[tokio::test]
async fn label_ids_across_the_u16_range_render_their_own_palette_colour() {
    let mut service = service().await;
    service
        .register_volume_with_upload(
            "u16-labels".to_string(),
            &volume(|i| BANDS[i / 4]),
            wgpu::TextureFormat::R32Float,
        )
        .expect("failed to register label volume");
    let palette = service
        .upsert_custom_colormap("u16-labels".to_string(), &tiled_palette())
        .expect("a 32-row palette is accepted");
    let row = render_row(
        &mut service,
        "u16-labels",
        palette,
        LayerMode::Label,
        (0.0, 65535.0),
    )
    .await;
    for (band, colour) in COLOURS.iter().enumerate() {
        let px = row[16 * band + 8];
        let expected = colour.unwrap_or([0, 0, 0]);
        assert_eq!(
            px[..3],
            expected,
            "label {} (band {band}) renders {:?}",
            BANDS[band],
            px
        );
    }
}

#[tokio::test]
async fn shorter_palettes_clear_old_rows_and_continuous_colormaps_keep_row_zero() {
    let mut service = service().await;
    service
        .register_volume_with_upload(
            "u16-labels".to_string(),
            &volume(|i| BANDS[i / 4]),
            wgpu::TextureFormat::R32Float,
        )
        .expect("failed to register label volume");
    let first = service
        .upsert_custom_colormap("shared-slot".to_string(), &tiled_palette())
        .unwrap();
    // The same slot now holds one row: pure red for every continuous value
    // and for label ids 0..2047. Every tiled row above it must be cleared.
    let red: Vec<u8> = (0..COLORMAP_LUT_WIDTH)
        .flat_map(|_| [255, 0, 0, 255])
        .collect();
    let second = service
        .upsert_custom_colormap("shared-slot".to_string(), &red)
        .unwrap();
    assert_eq!(first, second);
    let labels = render_row(
        &mut service,
        "u16-labels",
        second,
        LayerMode::Label,
        (0.0, 65535.0),
    )
    .await;
    assert_eq!(labels[8][..3], [255, 0, 0], "label 1 is in row 0");
    assert_eq!(labels[16 + 8][..3], [255, 0, 0], "label 2047 is in row 0");
    for band in [2, 4, 5, 6, 7] {
        assert_eq!(
            labels[16 * band + 8][..3],
            [0, 0, 0],
            "label {} must not keep the previous palette's colour",
            BANDS[band]
        );
    }

    service
        .register_volume_with_upload(
            "ramp".to_string(),
            &volume(|i| i as f32),
            wgpu::TextureFormat::R32Float,
        )
        .expect("failed to register scalar volume");
    let scalar = render_row(&mut service, "ramp", second, LayerMode::Scalar, (0.0, 31.0)).await;
    for x in [8, 64, 120] {
        assert_eq!(
            scalar[x][..3],
            [255, 0, 0],
            "column {x}: continuous lookup samples row 0, not a cleared row"
        );
    }
}

#[tokio::test]
async fn malformed_palette_lengths_are_rejected() {
    let mut service = service().await;
    for bytes in [
        0,
        COLORMAP_ROW_BYTES - 4,
        COLORMAP_ROW_BYTES + 4,
        COLORMAP_ROW_BYTES * (COLORMAP_LUT_ROWS as usize + 1),
    ] {
        assert!(
            service
                .upsert_custom_colormap("bad".to_string(), &vec![0; bytes])
                .is_err(),
            "{bytes} bytes"
        );
    }
}

#[tokio::test]
async fn the_lut_stays_one_row_until_a_palette_needs_more_and_grows_by_powers_of_two() {
    let mut service = service().await;
    assert_eq!(
        service.texture_manager.colormap_rows(),
        1,
        "default LUT is one row"
    );
    let one_row: Vec<u8> = (0..COLORMAP_LUT_WIDTH)
        .flat_map(|_| [9, 9, 9, 255])
        .collect();
    let small = service
        .upsert_custom_colormap("small".to_string(), &one_row)
        .unwrap();
    assert_eq!(service.texture_manager.colormap_rows(), 1);
    service
        .register_volume_with_upload(
            "u16-labels".to_string(),
            &volume(|i| BANDS[i / 4]),
            wgpu::TextureFormat::R32Float,
        )
        .expect("failed to register label volume");
    let before = render_row(
        &mut service,
        "u16-labels",
        small,
        LayerMode::Label,
        (0.0, 65535.0),
    )
    .await;
    assert_eq!(before[8][..3], [9, 9, 9]);
    // Label 4097 needs three rows: the LUT grows to four, keeping earlier slots.
    let mut three_rows = vec![0u8; COLORMAP_ROW_BYTES * 3];
    three_rows[4097 * 4..4097 * 4 + 4].copy_from_slice(&[0, 0, 255, 255]);
    service
        .upsert_custom_colormap("medium".to_string(), &three_rows)
        .unwrap();
    assert_eq!(service.texture_manager.colormap_rows(), 4);
    service
        .upsert_custom_colormap("large".to_string(), &tiled_palette())
        .unwrap();
    assert_eq!(service.texture_manager.colormap_rows(), COLORMAP_LUT_ROWS);

    // The bind groups made before growth were rebuilt on the new view: the
    // large palette renders through them, and "small" kept its colours.
    let large = service
        .upsert_custom_colormap("large".to_string(), &tiled_palette())
        .unwrap();
    let row = render_row_with_current_bind_groups(
        &mut service,
        "u16-labels",
        large,
        LayerMode::Label,
        (0.0, 65535.0),
    )
    .await;
    assert_eq!(
        row[16 * 7 + 8][..3],
        [255, 128, 0],
        "label 65535 through rebuilt bind groups"
    );
    let row = render_row_with_current_bind_groups(
        &mut service,
        "u16-labels",
        small,
        LayerMode::Label,
        (0.0, 65535.0),
    )
    .await;
    assert_eq!(
        row[8][..3],
        [9, 9, 9],
        "a slot uploaded before growth keeps its colour"
    );
    assert_eq!(
        row[16 * 4 + 8][..3],
        [0, 0, 0],
        "id 4097 is beyond the one-row palette"
    );
}

#[tokio::test]
async fn continuous_lookups_sample_row_zero_exactly_beside_a_contrasting_row() {
    let mut service = service().await;
    // Row 0 is a red ramp; row 1 is solid blue. Linear filtering that leaked
    // across rows would add blue or lose red.
    let mut lut = vec![0u8; COLORMAP_ROW_BYTES * 2];
    for x in 0..COLORMAP_LUT_WIDTH as usize {
        lut[x * 4..x * 4 + 4].copy_from_slice(&[(x / 8) as u8, 0, 0, 255]);
        let at = COLORMAP_ROW_BYTES + x * 4;
        lut[at..at + 4].copy_from_slice(&[0, 0, 255, 255]);
    }
    let two_rows = service
        .upsert_custom_colormap("two-rows".to_string(), &lut)
        .unwrap();
    assert_eq!(service.texture_manager.colormap_rows(), 2);
    let red: Vec<u8> = (0..COLORMAP_LUT_WIDTH)
        .flat_map(|x| [(x / 8) as u8, 0, 0, 255])
        .collect();
    let one_row = service
        .upsert_custom_colormap("one-row".to_string(), &red)
        .unwrap();
    service
        .register_volume_with_upload(
            "ramp".to_string(),
            &volume(|i| i as f32),
            wgpu::TextureFormat::R32Float,
        )
        .expect("failed to register scalar volume");
    let tall = render_row(
        &mut service,
        "ramp",
        two_rows,
        LayerMode::Scalar,
        (0.0, 31.0),
    )
    .await;
    let flat = render_row(
        &mut service,
        "ramp",
        one_row,
        LayerMode::Scalar,
        (0.0, 31.0),
    )
    .await;
    for x in (4..128).step_by(8) {
        assert_eq!(tall[x][2], 0, "column {x}: no blue from row 1");
        assert_eq!(
            tall[x][..3],
            flat[x][..3],
            "column {x}: identical to a padded one-row palette"
        );
    }
    assert!(tall[124][0] > 200, "the ramp reaches the top of row 0");
}
