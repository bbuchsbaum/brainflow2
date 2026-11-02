//! Actual GPU acceptance: no unavailable-adapter skip and no mocked queue.
use render_loop::view_state::{
    InterpolationMode, LayerConfig, SliceOrientation, ViewId, ViewState,
};
use render_loop::{EditableTextureHandle, LabelRegionUpdate, RenderLoopService};
use volmath::{DenseVolume3, NeuroSpace, NeuroSpaceExt};

fn volume(values: Vec<u16>) -> DenseVolume3<u16> {
    let space = NeuroSpace::from_dims_spacing_origin(
        vec![9, 7, 5],
        vec![0.4, 0.7, 2.0],
        vec![-2.0, 3.0, -5.0],
    )
    .unwrap();
    DenseVolume3::from_data(space, values)
}
async fn frames(service: &mut RenderLoopService, id: &str) -> Vec<Vec<u8>> {
    let mut frames = Vec::new();
    for z in 0..5 {
        let view = ViewState::from_basic_params(
            id.into(),
            [-0.4, 5.1, -5.0 + z as f32 * 2.0],
            SliceOrientation::Axial,
            3.6,
            [36, 49],
            (0.0, 65535.0),
        )
        .with_crosshair(false)
        .with_layers(vec![LayerConfig::new(id.into())
            .with_intensity_window(0.0, 65535.0)
            .with_interpolation(InterpolationMode::Nearest)]);
        frames.push(
            service
                .request_frame(ViewId::new(id), view)
                .await
                .unwrap()
                .image_data,
        );
    }
    frames
}
fn apply(
    service: &mut RenderLoopService,
    handle: EditableTextureHandle,
    old: u64,
    new: u64,
    origin: [u32; 3],
    dimensions: [u32; 3],
    labels: &[u16],
) -> Result<(), render_loop::RenderLoopError> {
    service.update_volume_region(
        handle,
        &LabelRegionUpdate {
            expected_revision: old,
            revision: new,
            origin,
            dimensions,
            labels,
            data_range: (0, 65535),
        },
    )
}

#[test]
fn partial_label_updates_match_full_upload_and_reject_stale_residencies() {
    pollster::block_on(async {
        let mut service = RenderLoopService::new()
            .await
            .expect("GPU required for label region acceptance");
        println!("adapter={:?}", service.adapter.get_info());
        service
            .device
            .push_error_scope(wgpu::ErrorFilter::Validation);
        service.load_shaders().unwrap();
        let before: Vec<u16> = (0..9 * 7 * 5).map(|i| (i * 137) as u16).collect();
        let handle = service
            .upload_editable_labels(&volume(before.clone()), 0)
            .unwrap();
        service
            .register_volume("edited".into(), handle.texture_index())
            .unwrap();
        let original = frames(&mut service, "edited").await;
        let patch = [
            7, 301, 65535, 30000, 0, 12345, 4000, 5000, 6000, 7000, 8000, 9000,
        ];
        let mut after = before.clone();
        let mut i = 0;
        for z in 1..3 {
            for y in 2..4 {
                for x in 3..6 {
                    after[x + 9 * (y + 7 * z)] = patch[i];
                    i += 1;
                }
            }
        }
        apply(&mut service, handle, 0, 1, [3, 2, 1], [3, 2, 2], &patch).unwrap();
        assert_eq!(
            service
                .multi_texture_manager
                .as_ref()
                .unwrap()
                .editable_revision(handle)
                .unwrap(),
            1
        );
        let (reference, _) = service
            .upload_volume_3d_with_format(&volume(after), wgpu::TextureFormat::R32Float)
            .unwrap();
        service
            .register_volume("reference".into(), reference)
            .unwrap();
        let updated = frames(&mut service, "edited").await;
        assert_eq!(
            updated,
            frames(&mut service, "reference").await,
            "sub-region update must equal an independent complete upload at every slice"
        );
        assert_ne!(
            updated, original,
            "the patch must visibly change the rendered volume"
        );
        assert_eq!(updated[0], original[0]);
        assert_eq!(updated[4], original[4]);
        assert!(apply(&mut service, handle, 0, 1, [3, 2, 1], [3, 2, 2], &patch).is_err());
        assert!(apply(&mut service, handle, 1, 3, [3, 2, 1], [3, 2, 2], &patch).is_err());
        assert!(apply(
            &mut service,
            handle,
            1,
            2,
            [u32::MAX, 2, 1],
            [3, 2, 2],
            &patch
        )
        .is_err());
        assert!(apply(&mut service, handle, 1, 2, [8, 2, 1], [3, 2, 2], &patch).is_err());
        assert!(apply(
            &mut service,
            handle,
            1,
            2,
            [3, 2, 1],
            [3, 2, 2],
            &patch[..11]
        )
        .is_err());
        assert_eq!(
            frames(&mut service, "edited").await,
            updated,
            "rejected writes must leave the GPU unchanged"
        );
        // Revert just the patch; untouched regions must remain byte-identical.
        let mut undo = Vec::new();
        for z in 1..3 {
            for y in 2..4 {
                for x in 3..6 {
                    undo.push(before[x + 9 * (y + 7 * z)]);
                }
            }
        }
        apply(&mut service, handle, 1, 2, [3, 2, 1], [3, 2, 2], &undo).unwrap();
        assert_eq!(frames(&mut service, "edited").await, original);
        // A complete resync can catch up after missed CPU revisions.
        apply(&mut service, handle, 2, 9, [0; 3], [9, 7, 5], &before).unwrap();
        service.release_volume(handle.texture_index()).unwrap();
        let replacement = service.upload_editable_labels(&volume(before), 0).unwrap();
        assert_eq!(replacement.texture_index(), handle.texture_index());
        assert_ne!(replacement, handle);
        assert!(
            apply(&mut service, handle, 9, 10, [3, 2, 1], [3, 2, 2], &patch).is_err(),
            "old residency must not write into a reused slot"
        );
        assert_eq!(
            service
                .multi_texture_manager
                .as_ref()
                .unwrap()
                .editable_revision(replacement)
                .unwrap(),
            0
        );
        let mut other = RenderLoopService::new().await.unwrap();
        let other_handle = other
            .upload_editable_labels(&volume(vec![0; 9 * 7 * 5]), 0)
            .unwrap();
        assert_eq!(other_handle.texture_index(), replacement.texture_index());
        assert_ne!(other_handle, replacement);
        assert!(
            apply(&mut other, replacement, 0, 1, [3, 2, 1], [3, 2, 2], &patch).is_err(),
            "handles must not cross renderer lifetimes"
        );
        service.device.poll(wgpu::Maintain::Wait);
        assert!(
            service.device.pop_error_scope().await.is_none(),
            "GPU validation must remain clean"
        );
    });
}

#[test]
fn native_oblique_grid_renders_the_same_voxel_slice_as_an_axis_aligned_reference() {
    pollster::block_on(async {
        use nalgebra::Matrix4;
        use neuro_types::{native_slice_geometry, VolumeMetadata};
        let mut service = RenderLoopService::new()
            .await
            .expect("GPU required for native-plane acceptance");
        service.load_shaders().unwrap();
        let affine = Matrix4::new(
            0.4, 0.0, 0.0, 10.0, 0.0, 1.6, -0.24, -20.0, 0.0, 1.2, 0.32, 5.0, 0.0, 0.0, 0.0, 1.0,
        );
        let space = NeuroSpace::new(
            vec![5, 3, 7],
            None,
            None,
            None,
            Some(nalgebra::DMatrix::from_fn(4, 4, |r, c| {
                f64::from(affine[(r, c)])
            })),
        )
        .unwrap();
        let labels: Vec<u16> = (0..105).map(|i| (i * 500) as u16).collect();
        let native = DenseVolume3::from_data(space, labels.clone());
        let reference = DenseVolume3::from_data(
            NeuroSpace::from_dims_spacing_origin(vec![5, 3, 7], vec![0.4, 2.0, 0.4], vec![0.0; 3])
                .unwrap(),
            labels,
        );
        for (id, data) in [("native", &native), ("axis", &reference)] {
            let (slot, _) = service
                .upload_volume_3d_with_format(data, wgpu::TextureFormat::R32Float)
                .unwrap();
            service.register_volume(id.into(), slot).unwrap();
        }
        let plane = native_slice_geometry(
            &VolumeMetadata {
                dimensions: [5, 3, 7],
                voxel_to_world: affine,
            },
            1,
            1,
            [5, 7],
            [false; 2],
        )
        .unwrap();
        let mut view = ViewState::from_basic_params(
            "native".into(),
            [10.8, -19.12, 7.16],
            SliceOrientation::Coronal,
            2.8,
            [5, 7],
            (0.0, 65535.0),
        )
        .with_crosshair(false)
        .with_layers(vec![LayerConfig::new("native".into())
            .with_intensity_window(0.0, 65535.0)
            .with_interpolation(InterpolationMode::Nearest)]);
        let (origin, u, v) = plane.to_gpu_frame_params();
        view.camera.frame_origin = Some(origin);
        view.camera.frame_u_vec = Some(u);
        view.camera.frame_v_vec = Some(v);
        let actual = service
            .request_frame(ViewId::new("native"), view.clone())
            .await
            .unwrap()
            .image_data;
        // Independent axis-aligned plane through native y=1, outer voxel edges.
        view.camera.frame_origin = Some([-0.2, 2.0, -0.2, 1.0]);
        view.camera.frame_u_vec = Some([2.0, 0.0, 0.0, 0.0]);
        view.camera.frame_v_vec = Some([0.0, 0.0, 2.8, 0.0]);
        view.layers[0].volume_id = "axis".into();
        let expected = service
            .request_frame(ViewId::new("axis"), view)
            .await
            .unwrap()
            .image_data;
        assert_eq!(actual, expected);
        assert!(expected.chunks_exact(4).map(|p| p[0]).max().unwrap() > 100);
    });
}
