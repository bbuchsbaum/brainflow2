use render_loop::view_state::{InterpolationMode, SliceOrientation, ViewId, ViewState};
use render_loop::{
    RendererCapacityPolicy, RendererVolumeFormat, WgpuSliceRenderer, WgpuSliceRendererConfig,
};

fn config(adaptive: bool) -> WgpuSliceRendererConfig {
    let mut c = WgpuSliceRendererConfig::default();
    c.atlas.dimensions = [1, 1, 1];
    if adaptive {
        c.atlas.capacity_policy = RendererCapacityPolicy::FitAdapter;
        c.device.limits.max_sampled_textures_per_shader_stage = Some(16);
    }
    c
}

fn state(mode: InterpolationMode) -> ViewState {
    let mut s = ViewState::from_basic_params(
        "last".into(),
        [32., 32., 12.],
        SliceOrientation::Axial,
        64.,
        [65, 47],
        (0., 255.),
    )
    .with_crosshair(false);
    s.layers[0].interpolation = mode;
    s
}

#[tokio::test]
async fn actual_sixteen_texture_device_matches_desktop_and_reclaims_slots() {
    let mut desktop = WgpuSliceRenderer::configure(config(false))
        .await
        .expect("Real GPU required");
    let mut limited = WgpuSliceRenderer::configure(config(true))
        .await
        .expect("Real constrained GPU required");
    assert_eq!(desktop.capabilities().volume_slots, 13);
    assert_eq!(limited.capabilities().volume_slots, 7);
    assert_eq!(limited.capabilities().sampled_texture_limit, 16);
    let pattern = render_loop::test_fixtures::create_test_pattern_volume();
    let zeros = volmath::DenseVolume3::from_data(pattern.space.clone(), vec![0u8; 64 * 64 * 25]);
    for i in 0..6 {
        limited
            .register_volume(format!("empty-{i}"), &zeros, RendererVolumeFormat::R32Float)
            .unwrap();
    }
    let last = limited
        .register_volume("last", &pattern, RendererVolumeFormat::R32Float)
        .unwrap();
    assert_eq!(last.texture_index(), 6);
    let reference = desktop
        .register_volume("last", &pattern, RendererVolumeFormat::R32Float)
        .unwrap();
    assert!(limited
        .register_volume("overflow", &pattern, RendererVolumeFormat::R32Float)
        .is_err());
    // The alternate legacy manager has a different fixed layout. Reject before
    // mutating this adaptive renderer so normal rendering remains usable.
    assert!(limited
        .legacy_service_mut()
        .enable_smart_texture_management(64)
        .is_err());
    for mode in [InterpolationMode::Nearest, InterpolationMode::Linear] {
        let a = desktop
            .request_frame(ViewId::new("reference"), state(mode))
            .await
            .unwrap();
        let b = limited
            .request_frame(ViewId::new("limited"), state(mode))
            .await
            .unwrap();
        assert!(a.image_data.chunks_exact(4).any(|p| p[0] > 0));
        assert!(a.image_data == b.image_data, "adaptive pixels differ");
    }
    // Alpha masks belong to the legacy layer API; a declarative frame rebuilds
    // LayerInfo without mask flags. Exercise the mask switch through that API.
    desktop
        .legacy_service_mut()
        .create_offscreen_target(65, 47)
        .unwrap();
    limited
        .legacy_service_mut()
        .create_offscreen_target(65, 47)
        .unwrap();
    // Build a single legacy layer before its baseline. Registration and
    // declarative frames also maintain separate compatibility layer state.
    for (renderer, index) in [
        (&mut desktop, reference.texture_index()),
        (&mut limited, last.texture_index()),
    ] {
        let service = renderer.legacy_service_mut();
        service.configure_render_pass(
            render_loop::render_state::RenderPassType::Main,
            render_loop::render_state::RenderPassConfig {
                clear_color: wgpu::Color::BLACK,
                ..Default::default()
            },
        );
        service.clear_render_layers();
        let layer = service
            .add_layer_3d(index, nalgebra::Matrix4::identity(), (64, 64, 25), 1., 0, 1)
            .unwrap();
        service.update_layer_intensity(layer, 0., 255.).unwrap();
    }
    let unmasked = limited
        .legacy_service_mut()
        .render_to_buffer_async()
        .await
        .unwrap();
    let mask: Vec<u8> = (0..64 * 64 * 25)
        .map(|i| if i % 64 < 32 { 255 } else { 0 })
        .collect();
    desktop
        .legacy_service_mut()
        .upload_alpha_mask(reference.texture_index(), [64, 64, 25], &mask)
        .unwrap();
    limited
        .legacy_service_mut()
        .upload_alpha_mask(last.texture_index(), [64, 64, 25], &mask)
        .unwrap();
    let a = desktop
        .legacy_service_mut()
        .render_to_buffer_async()
        .await
        .unwrap();
    let b = limited
        .legacy_service_mut()
        .render_to_buffer_async()
        .await
        .unwrap();
    assert!(a == b, "adaptive mask pixels differ");
    assert!(b != unmasked, "uploaded mask did not affect RGB");
    assert!(b.chunks_exact(4).any(|p| p[0] > 0));
    // Half-volume masking must remove some visible pattern while retaining
    // some, independently of camera handedness or background alpha.
    let visible = |pixels: &[u8]| pixels.chunks_exact(4).filter(|p| p[0] > 0).count();
    assert!(
        visible(&b) < visible(&unmasked),
        "masked={}, unmasked={}",
        visible(&b),
        visible(&unmasked)
    );
    limited.release_volume(&last).unwrap();
    let reused = limited
        .register_volume("last", &pattern, RendererVolumeFormat::R32Float)
        .unwrap();
    assert_eq!(reused.texture_index(), 6);
    limited
        .request_frame(ViewId::new("limited"), state(InterpolationMode::Linear))
        .await
        .unwrap();
    limited.clear_views();
    limited.release_volume(&reused).unwrap();
    for i in 0..6 {
        limited.release_volume_by_id(&format!("empty-{i}")).unwrap();
    }
    assert_eq!(limited.readback_monitor().snapshot().buffers, 0);
    assert_eq!(limited.readback_monitor().snapshot().bytes, 0);
}
