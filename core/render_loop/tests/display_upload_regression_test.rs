use render_loop::view_state::{
    InterpolationMode, LayerConfig, SliceOrientation, ViewId, ViewState,
};
use render_loop::{RenderLoopService, WgpuSliceRendererConfig};
use std::collections::BTreeSet;
use volmath::{DenseVolume3, NeuroSpace, NeuroSpaceExt};

fn space() -> NeuroSpace {
    NeuroSpace::from_dims_spacing_origin(vec![8; 3], vec![1.; 3], vec![0.; 3]).unwrap()
}

fn view(id: &str, high: f32) -> ViewState {
    // The 8-voxel grid spans [-0.5, 7.5) in x/y; centre the 8 mm field on it.
    ViewState::from_basic_params(
        id.into(),
        [3.5, 3.5, 4.],
        SliceOrientation::Axial,
        8.,
        [16, 16],
        (0., high),
    )
    .with_crosshair(false)
    .with_layers(vec![LayerConfig::new(id.into())
        .with_intensity_window(0., high)
        .with_interpolation(InterpolationMode::Nearest)])
}

async fn frame(service: &mut RenderLoopService, id: &str, high: f32) -> Vec<u8> {
    service
        .request_frame(ViewId::new(id), view(id, high))
        .await
        .unwrap()
        .image_data
}

fn levels(image: &[u8]) -> BTreeSet<u8> {
    image.chunks_exact(4).map(|p| p[0]).collect()
}

#[test]
fn native_u8_upload_should_preserve_the_same_display_as_float_input() {
    pollster::block_on(async {
        let mut service = RenderLoopService::new().await.unwrap();
        println!("adapter={:?}", service.adapter.get_info());
        service.load_shaders().unwrap();
        let values: Vec<u8> = (0..512)
            .map(|i| [0, 32, 64, 96, 128, 160, 192, 255][i % 8])
            .collect();
        let native = DenseVolume3::from_data(space(), values.clone());
        let reference =
            DenseVolume3::from_data(space(), values.into_iter().map(f32::from).collect());
        let (native_slot, _) = service.upload_volume_3d(&native).unwrap();
        service
            .register_volume_with_range("native".into(), native_slot, (0., 255.))
            .unwrap();
        let (reference_slot, _) = service.upload_volume_3d(&reference).unwrap();
        service
            .register_volume_with_range("reference".into(), reference_slot, (0., 255.))
            .unwrap();
        let actual = frame(&mut service, "native", 255.).await;
        let expected = frame(&mut service, "reference", 255.).await;
        println!(
            "u8 native red levels={:?}; f32 red levels={:?}",
            levels(&actual),
            levels(&expected)
        );
        assert!(
            actual == expected,
            "native u8 gradient differs from equivalent f32 volume"
        );
    });
}

#[test]
fn finite_large_scalar_should_remain_visible_after_default_upload() {
    pollster::block_on(async {
        let mut service = RenderLoopService::new().await.unwrap();
        service.load_shaders().unwrap();
        let volume = DenseVolume3::from_data(space(), vec![70_000f32; 512]);
        let (slot, _) = service.upload_volume_3d(&volume).unwrap();
        service
            .register_volume_with_range("default".into(), slot, (0., 100_000.))
            .unwrap();
        let actual = frame(&mut service, "default", 100_000.).await;
        // Independently force the low-level upload format for the pixel oracle.
        let manager = service.multi_texture_manager.as_mut().unwrap();
        manager.release_volume(slot).unwrap();
        let (reused_slot, _) = manager
            .upload_volume(
                &service.device,
                &service.queue,
                &volume,
                wgpu::TextureFormat::R32Float,
            )
            .unwrap();
        assert_eq!(reused_slot, slot);
        service.create_world_space_bind_groups().unwrap();
        let expected = frame(&mut service, "default", 100_000.).await;
        println!(
            "large scalar: default red levels={:?}; R32Float red levels={:?}",
            levels(&actual),
            levels(&expected)
        );
        assert!(
            levels(&expected).iter().any(|v| *v > 100),
            "oracle must draw the finite scalar"
        );
        assert!(
            actual == expected,
            "finite values must match a forced R32Float reference"
        );
    });
}

#[test]
fn public_slice_adapter_should_preserve_requested_display_options() {
    use neuro_types::{CompositeRequest, LayerSpec, LayerVisual, SliceSpec, VolumeHandle};
    let mut slice = SliceSpec::oblique([0.; 3], [1., 0., 0.], [0., 1., 0.], [4, 4]);
    slice.interp = neuro_types::InterpolationMethod::Nearest;
    let visual = LayerVisual {
        threshold_range: (0.2, 0.8),
        display_range: Some((0.1, 0.9)),
        ..Default::default()
    };
    let request = CompositeRequest::new(
        slice,
        vec![LayerSpec {
            volume_id: VolumeHandle::new(0),
            world_from_voxel: nalgebra::Matrix4::identity(),
            visual,
        }],
    );
    let mapped = render_loop::slice_adapter::SliceSpecMapper::to_view_state(&request).unwrap();
    println!(
        "adapter requested nearest/window=(0.1,0.9)/threshold=(0.2,0.8); mapped={:?}",
        mapped.layers[0]
    );
    assert_eq!(mapped.layers[0].interpolation, InterpolationMode::Nearest);
    assert_eq!(mapped.layers[0].intensity_window, (0.1, 0.9));
    assert!(mapped.layers[0].threshold.is_some());
}

#[test]
fn unsupported_capacity_is_rejected_before_gpu_initialization() {
    pollster::block_on(async {
        let mut config = WgpuSliceRendererConfig::default();
        config.atlas.max_textures = 14;
        let result = RenderLoopService::new_with_config(config).await;
        assert!(matches!(
            result,
            Err(render_loop::RenderLoopError::Internal { code: 1703, .. })
        ));
    });
}

#[test]
fn requested_float32_texture_format_should_be_honored() {
    pollster::block_on(async {
        let mut service = RenderLoopService::new().await.unwrap();
        let volume = DenseVolume3::from_data(space(), vec![70_000f32; 512]);
        service
            .register_volume_with_upload("float32".into(), &volume, wgpu::TextureFormat::R32Float)
            .unwrap();
        let manager = service.multi_texture_manager.as_ref().unwrap();
        let slot = manager.resident_indices()[0];
        let actual_format = manager.get_texture_info(slot).unwrap().format;
        println!("requested R32Float; allocated {actual_format:?}");
        assert_eq!(actual_format, wgpu::TextureFormat::R32Float);
    });
}

#[test]
fn optimized_shader_should_cover_the_same_full_viewport_as_standard() {
    pollster::block_on(async {
        let mut service = RenderLoopService::new().await.unwrap();
        service.load_shaders().unwrap();
        let volume = DenseVolume3::from_data(space(), vec![0.5f32; 512]);
        let (slot, _) = service.upload_volume_3d(&volume).unwrap();
        service
            .register_volume_with_range("v".into(), slot, (0., 1.))
            .unwrap();
        frame(&mut service, "v", 1.).await;
        service.create_offscreen_target(16, 16).unwrap();
        service.set_shader("slice_world_space").unwrap();
        let standard = service.render_to_buffer().unwrap();
        service.set_shader("slice_world_space_optimized").unwrap();
        let optimized = service.render_to_buffer().unwrap();
        let changed = standard
            .chunks_exact(4)
            .zip(optimized.chunks_exact(4))
            .filter(|(a, b)| a != b)
            .count();
        println!("standard/optimized constant-view changed pixels={changed}/256; standard={:?}, optimized={:?}",
            levels(&standard), levels(&optimized));
        assert_eq!(changed, 0, "shader variant changes fullscreen coverage");
    });
}

#[test]
fn half_overflow_is_rejected_without_consuming_a_texture_slot() {
    pollster::block_on(async {
        let mut service = RenderLoopService::new().await.unwrap();
        let volume = DenseVolume3::from_data(space(), vec![70_000f32; 512]);
        let before = service
            .multi_texture_manager
            .as_ref()
            .unwrap()
            .free_slot_count();
        assert!(service
            .register_volume_with_upload("bad".into(), &volume, wgpu::TextureFormat::R16Float)
            .is_err());
        assert_eq!(
            service
                .multi_texture_manager
                .as_ref()
                .unwrap()
                .free_slot_count(),
            before
        );
    });
}

#[test]
fn released_view_cannot_be_read_until_recreated() {
    pollster::block_on(async {
        let mut service = RenderLoopService::new().await.unwrap();
        service.load_shaders().unwrap();
        let volume = DenseVolume3::from_data(space(), vec![0.5f32; 512]);
        service
            .register_volume_with_upload("v".into(), &volume, wgpu::TextureFormat::R16Float)
            .unwrap();
        let expected = frame(&mut service, "v", 1.).await;
        let id = ViewId::new("v");
        assert!(service.release_view(&id));
        assert!(!service.release_view(&id));
        assert!(service.read_views_to_images(&[id], [16, 16]).is_err());
        assert_eq!(frame(&mut service, "v", 1.).await, expected);
        service.clear_views();
        assert!(!service.release_view(&ViewId::new("v")));
    });
}

// Non-256-aligned row lengths with several rows AND depth planes exercise both
// upload and in-place update through Queue::write_texture. Comparing against an
// independent fresh allocation checks update stride, format, and layer selection.
#[test]
fn tightly_packed_upload_and_update_match_in_all_formats() {
    pollster::block_on(async {
        let mut service = RenderLoopService::new().await.unwrap();
        service.load_shaders().unwrap();
        for format in [
            wgpu::TextureFormat::R8Unorm,
            wgpu::TextureFormat::R16Float,
            wgpu::TextureFormat::R32Float,
        ] {
            let space =
                NeuroSpace::from_dims_spacing_origin(vec![7, 5, 3], vec![1.; 3], vec![0.; 3])
                    .unwrap();
            let volume = DenseVolume3::from_data(space.clone(), vec![0f32; 105]);
            let replacement =
                DenseVolume3::from_data(space, (0..105).map(|i| i as f32 / 104.).collect());
            let (updated, _) = service
                .upload_volume_3d_with_format(&volume, format)
                .unwrap();
            service
                .register_volume_with_range("updated".into(), updated, (0., 1.))
                .unwrap();
            service.update_volume_3d_at(updated, &replacement).unwrap();
            let (fresh, _) = service
                .upload_volume_3d_with_format(&replacement, format)
                .unwrap();
            service
                .register_volume_with_range("fresh".into(), fresh, (0., 1.))
                .unwrap();
            for z in [0., 1., 2.] {
                let state = |id: &str| {
                    let mut state = view(id, 1.);
                    state.camera.frame_origin = Some([-0.25, -0.25, z, 1.]);
                    state.camera.frame_u_vec = Some([7., 0., 0., 0.]);
                    state.camera.frame_v_vec = Some([0., 5., 0., 0.]);
                    state.viewport_size = [7, 5];
                    state.layers[0].threshold = Some(render_loop::view_state::ThresholdConfig {
                        mode: render_loop::ThresholdMode::Inside,
                        range: (0., 1.),
                    });
                    state
                };
                let a = service
                    .request_frame(ViewId::new("updated"), state("updated"))
                    .await
                    .unwrap()
                    .image_data;
                let b = service
                    .request_frame(ViewId::new("fresh"), state("fresh"))
                    .await
                    .unwrap()
                    .image_data;
                assert_eq!(a, b, "format={format:?} plane={z}");
                assert!(levels(&b).len() > 2, "oracle must render a varying field");
                // Independent analytic oracle: every voxel carries its linear
                // index. Pixel centers avoid nearest-neighbour half ties.
                for (pixel, rgba) in b.chunks_exact(4).enumerate() {
                    let expected = ((z as usize * 35 + pixel) as f32 / 104. * 255.).round() as i16;
                    assert!(
                        (rgba[0] as i16 - expected).abs() <= 1,
                        "format={format:?} plane={z} pixel={pixel}: {rgba:?}, expected {expected}"
                    );
                }
            }
            service.release_volume(updated).unwrap();
            service.release_volume(fresh).unwrap();
        }
    });
}

#[test]
fn composite_adapter_renders_nearest_window_and_inclusive_thresholds() {
    use neuro_types::{
        CompositeRequest, InterpolationMethod, LayerSpec, LayerVisual, SliceSpec, VolumeHandle,
    };
    pollster::block_on(async {
        let mut service = RenderLoopService::new().await.unwrap();
        service.load_shaders().unwrap();
        let volume = DenseVolume3::from_data(space(), (0..512).map(|i| (i % 8) as f32).collect());
        service
            .register_volume_with_upload("volume_0".into(), &volume, wgpu::TextureFormat::R32Float)
            .unwrap();
        // Pixel centers at x=0.25,1.25,... differentiate nearest from linear.
        let mut slice = SliceSpec::oblique([-0.25, 2., 3.], [1., 0., 0.], [0., 1., 0.], [8, 1]);
        slice.interp = InterpolationMethod::Nearest;
        let visual = LayerVisual {
            display_range: Some((0., 7.)),
            threshold_range: (2., 5.),
            ..Default::default()
        };
        let mut request = CompositeRequest::new(
            slice,
            vec![LayerSpec {
                volume_id: VolumeHandle::new(0),
                world_from_voxel: nalgebra::Matrix4::identity(),
                visual,
            }],
        );
        let actual = service.composite_rgba(&request).unwrap();
        let red: Vec<_> = actual.chunks_exact(4).map(|p| p[0]).collect();
        println!("nearest bounded threshold ramp: {red:?}");
        // Hidden samples leave the renderer's clear color. Included boundary
        // values must remain visible, and analytic grayscale allows LUT rounding.
        for x in 0..8 {
            if (2..=5).contains(&x) {
                let expected = (x as f32 / 7. * 255.).round() as i16;
                assert!((red[x] as i16 - expected).abs() <= 1, "pixel {x}: {red:?}");
            } else {
                assert_eq!(red[x], 26, "hidden pixel {x}");
            }
        }
        service.set_shader("slice_world_space_optimized").unwrap();
        assert_eq!(
            actual,
            service.composite_rgba(&request).unwrap(),
            "inclusive thresholds must agree across shader variants"
        );
        service.set_shader("slice_world_space").unwrap();
        request.slice.interp = InterpolationMethod::Linear;
        let linear = service.composite_rgba(&request).unwrap();
        assert_ne!(
            actual, linear,
            "nearest and linear must not silently share a mode"
        );
    });
}

#[test]
fn full_precision_without_filtering_support_falls_back_to_r16_for_automatic_uploads() {
    pollster::block_on(async {
        let mut config = WgpuSliceRendererConfig::default();
        config.device.float32_filterable = render_loop::RendererFeaturePolicy::Disable;
        let mut service = RenderLoopService::new_with_config(config).await.unwrap();
        let volume = DenseVolume3::from_data(space(), vec![70_000f32; 512]);
        // An explicit R32Float request still fails and allocates nothing.
        assert!(service
            .upload_volume_3d_with_format(&volume, wgpu::TextureFormat::R32Float)
            .is_err());
        let manager = service.multi_texture_manager.as_ref().unwrap();
        assert_eq!(manager.resident_slot_count(), 0);
        // An automatic upload that would promote to R32Float falls back to
        // R16Float (70000 clamps to 65504) instead of failing.
        let (slot, _) = service.upload_volume_3d(&volume).unwrap();
        let manager = service.multi_texture_manager.as_ref().unwrap();
        assert_eq!(manager.resident_slot_count(), 1);
        assert_eq!(
            manager.get_texture_info(slot).unwrap().format,
            wgpu::TextureFormat::R16Float
        );
    });
}

#[test]
fn automatic_member_updates_promote_in_place_and_keep_registration_current() {
    pollster::block_on(async {
        let mut service = RenderLoopService::new().await.unwrap();
        service.load_shaders().unwrap();
        let initial = DenseVolume3::from_data(space(), vec![0.5f32; 512]);
        let large = DenseVolume3::from_data(space(), vec![70_000f32; 512]);
        let (slot, _) = service.upload_volume_3d(&initial).unwrap();
        service
            .register_volume_with_range("v".into(), slot, (0., 1.))
            .unwrap();
        frame(&mut service, "v", 1.).await;
        service.update_volume_3d_at(slot, &large).unwrap();
        let manager = service.multi_texture_manager.as_ref().unwrap();
        assert_eq!(manager.resident_slot_count(), 1);
        assert_eq!(
            manager.get_texture_info(slot).unwrap().format,
            wgpu::TextureFormat::R32Float
        );
        assert_eq!(manager.resident_bytes(), 512 * 4);
        assert_eq!(
            service.get_volume_texture_format(slot),
            Some(wgpu::TextureFormat::R32Float)
        );
        assert_eq!(
            service.get_volume_data_range(slot),
            Some((70_000., 70_000.))
        );
        assert_eq!(
            levels(&frame(&mut service, "v", 100_000.).await),
            BTreeSet::from([179])
        );
        service.update_volume_3d_at(slot, &initial).unwrap();
        assert_eq!(
            service
                .multi_texture_manager
                .as_ref()
                .unwrap()
                .get_texture_info(slot)
                .unwrap()
                .format,
            wgpu::TextureFormat::R32Float
        );
        assert_eq!(
            levels(&frame(&mut service, "v", 1.).await),
            BTreeSet::from([128])
        );
    });
}

#[test]
fn integer_texture_request_is_rejected_without_allocating() {
    pollster::block_on(async {
        // The active pipeline samples filterable float textures only; an
        // R16Uint request must fail rather than allocate an unbindable slot.
        let mut service = RenderLoopService::new().await.unwrap();
        let volume = DenseVolume3::from_data(space(), vec![7f32; 512]);
        assert!(matches!(
            service.register_volume_with_upload(
                "u16".into(),
                &volume,
                wgpu::TextureFormat::R16Uint
            ),
            Err(render_loop::RenderLoopError::UnsupportedVolumeFormat(_))
        ));
        assert_eq!(
            service
                .multi_texture_manager
                .as_ref()
                .unwrap()
                .resident_slot_count(),
            0
        );

        let mut renderer =
            render_loop::WgpuSliceRenderer::configure(WgpuSliceRendererConfig::default())
                .await
                .unwrap();
        assert!(renderer
            .register_volume("u16", &volume, render_loop::RendererVolumeFormat::R16Uint)
            .is_err());
    });
}
