use render_loop::{
    view_state::{
        InterpolationMode, LayerConfig, SliceOrientation, ThresholdMode, ViewId, ViewState,
    },
    RenderLoopService,
};
use volmath::{DenseVolume3, NeuroSpace, NeuroSpaceExt};

#[tokio::test]
async fn missing_scalar_samples_leave_the_underlying_volume_visible() {
    let mut service = RenderLoopService::new()
        .await
        .expect("GPU adapter required");
    service.load_shaders().unwrap();
    service.enable_world_space_rendering().unwrap();
    let space = NeuroSpace::from_dims_spacing_origin(vec![8; 3], vec![1.; 3], vec![0.; 3]).unwrap();
    let base = DenseVolume3::from_data(space.clone(), vec![0.3f32; 512]);
    service
        .register_volume_with_upload("base".into(), &base, wgpu::TextureFormat::R16Float)
        .unwrap();
    for (id, missing) in [
        ("missing", f32::NAN),
        ("positive-inf", f32::INFINITY),
        ("negative-inf", f32::NEG_INFINITY),
        ("reference", 0.),
    ] {
        let values = (0..512)
            .map(|i| if i % 8 < 4 { missing } else { 0.8 })
            .collect();
        let overlay = DenseVolume3::from_data(space.clone(), values);
        service
            .register_volume_with_upload(id.into(), &overlay, wgpu::TextureFormat::R16Float)
            .unwrap();
    }
    service.initialize_colormap().unwrap();
    service.create_world_space_bind_groups().unwrap();
    let layer = |id: &str| {
        LayerConfig::new(id.into())
            .with_intensity_window(0., 1.)
            .with_interpolation(InterpolationMode::Nearest)
            .with_threshold(ThresholdMode::Range, 0., 0.)
    };
    let view = ViewState::from_basic_params(
        "base".into(),
        [4., 4., 4.],
        SliceOrientation::Axial,
        8.,
        [16, 16],
        (0., 1.),
    )
    .with_crosshair(false);
    let reference = service
        .request_frame(
            ViewId::new("reference"),
            view.clone()
                .with_layers(vec![layer("base"), layer("reference")]),
        )
        .await
        .unwrap();
    let missing = service
        .request_frame(
            ViewId::new("missing"),
            view.clone()
                .with_layers(vec![layer("base"), layer("missing")]),
        )
        .await
        .unwrap();
    let base_only = service
        .request_frame(
            ViewId::new("base-only"),
            view.with_layers(vec![layer("base")]),
        )
        .await
        .unwrap();
    assert_ne!(
        reference.image_data, base_only.image_data,
        "finite overlay values must be drawn"
    );
    assert!(
        missing.image_data == reference.image_data,
        "NaN samples must be transparent, like the explicitly masked reference"
    );
    for id in ["positive-inf", "negative-inf"] {
        let state = ViewState::from_basic_params(
            "base".into(),
            [4., 4., 4.],
            SliceOrientation::Axial,
            8.,
            [16, 16],
            (0., 1.),
        )
        .with_crosshair(false)
        .with_layers(vec![layer("base"), layer(id)]);
        let frame = service.request_frame(ViewId::new(id), state).await.unwrap();
        assert!(
            frame.image_data == reference.image_data,
            "{id} must also be transparent"
        );
    }
}
