// Test rendering with actual volume data through the current world-space path.

use nalgebra::Vector4;
use render_loop::render_state::{BlendMode, LayerInfo, ThresholdMode};
use render_loop::RenderLoopService;
use volmath::space::NeuroSpaceImpl;
use volmath::NeuroSpaceExt;
use volmath::{DenseVolume3, NeuroSpace3};

const DIMS: [usize; 3] = [64, 64, 32];
const SPACING: [f32; 3] = [1.0, 1.0, 1.5];

fn create_test_volume() -> DenseVolume3<f32> {
    let origin = [0.0, 0.0, 0.0];
    let space = NeuroSpace3::new(NeuroSpaceImpl::from_dims_spacing_origin(
        DIMS, SPACING, origin,
    ));

    let mut data = Vec::with_capacity(DIMS[0] * DIMS[1] * DIMS[2]);
    for z in 0..DIMS[2] {
        for y in 0..DIMS[1] {
            for x in 0..DIMS[0] {
                let value = (x as f32 / DIMS[0] as f32
                    + y as f32 / DIMS[1] as f32
                    + z as f32 / DIMS[2] as f32)
                    / 3.0;
                data.push(value);
            }
        }
    }

    DenseVolume3::from_data(space.0, data)
}

fn scalar_layer(texture_index: u32) -> LayerInfo {
    LayerInfo {
        atlas_index: texture_index,
        opacity: 1.0,
        blend_mode: BlendMode::Normal,
        colormap_id: 0,
        intensity_range: (0.0, 1.0),
        threshold_range: (0.0, 0.0),
        threshold_mode: ThresholdMode::Range,
        texture_coords: (0.0, 0.0, 1.0, 1.0),
        is_mask: false,
        interpolation_mode: 1,
        ..LayerInfo::default()
    }
}

fn configure_center_axial_view(
    service: &mut RenderLoopService,
    texture_index: u32,
    world_to_voxel: nalgebra::Matrix4<f32>,
) {
    let center_z = DIMS[2] as f32 * SPACING[2] / 2.0;
    service.update_frame_ubo(
        [0.0, 0.0, center_z, 1.0],
        [DIMS[0] as f32 * SPACING[0], 0.0, 0.0, 0.0],
        [0.0, DIMS[1] as f32 * SPACING[1], 0.0, 0.0],
    );
    service.update_layer_uniforms_direct(
        &[scalar_layer(texture_index)],
        &[(DIMS[0] as u32, DIMS[1] as u32, DIMS[2] as u32)],
        &[world_to_voxel],
    );
}

fn visible_pixel_count(image_data: &[u8]) -> usize {
    image_data
        .chunks_exact(4)
        .filter(|rgba| rgba[0].max(rgba[1]).max(rgba[2]) > 60)
        .count()
}

#[test]
fn test_upload_and_render_volume() {
    pollster::block_on(async {
        let mut service = RenderLoopService::new()
            .await
            .expect("Failed to create RenderLoopService");
        service
            .create_offscreen_target(128, 128)
            .expect("Failed to create render target");

        let volume = create_test_volume();
        let (texture_index, world_to_voxel) = service
            .upload_volume_3d(&volume)
            .expect("Failed to upload volume");

        configure_center_axial_view(&mut service, texture_index, world_to_voxel);

        let image_data = service.render_to_buffer().expect("Failed to render");
        assert_eq!(image_data.len(), 128 * 128 * 4);

        let visible = visible_pixel_count(&image_data);
        assert!(
            visible > 1_000,
            "Expected visible scalar volume signal, found {visible} pixels"
        );
    });
}

#[test]
fn test_volume_transform_and_layer_tracking() {
    pollster::block_on(async {
        let mut service = RenderLoopService::new()
            .await
            .expect("Failed to create RenderLoopService");

        let volume = create_test_volume();
        let (texture_index, world_to_voxel) = service
            .upload_volume_3d(&volume)
            .expect("Failed to upload volume");

        let voxel_to_world = volume.space.0.voxel_to_world();
        let center_voxel = Vector4::new(32.0, 32.0, 16.0, 1.0);
        let center_world = voxel_to_world * center_voxel;
        let roundtrip = world_to_voxel * center_world;

        assert!((roundtrip.x / roundtrip.w - center_voxel.x).abs() < 1e-4);
        assert!((roundtrip.y / roundtrip.w - center_voxel.y).abs() < 1e-4);
        assert!((roundtrip.z / roundtrip.w - center_voxel.z).abs() < 1e-4);

        let layer_idx = service
            .add_render_layer(texture_index, 1.0, (0.0, 0.0, 1.0, 1.0))
            .expect("Failed to add render layer");
        assert_eq!(service.active_layer_count(), 1);

        service
            .update_layer(layer_idx, 0.5, 2)
            .expect("Failed to update layer");

        let removed_texture = service.remove_render_layer(layer_idx);
        assert_eq!(removed_texture, Some(texture_index));
        assert_eq!(service.active_layer_count(), 0);
    });
}

#[test]
fn test_texture_allocation_and_release() {
    pollster::block_on(async {
        let mut service = RenderLoopService::new()
            .await
            .expect("Failed to create RenderLoopService");

        let mut allocated_textures = Vec::new();
        for _ in 0..3 {
            let volume = create_test_volume();
            let (texture_index, _) = service
                .upload_volume_3d(&volume)
                .expect("Failed to upload volume");
            assert!(
                !allocated_textures.contains(&texture_index),
                "Texture index {texture_index} was allocated twice while still live"
            );
            allocated_textures.push(texture_index);
        }

        for texture_index in allocated_textures {
            service
                .release_volume(texture_index)
                .expect("Failed to release volume");
        }

        let volume = create_test_volume();
        service
            .upload_volume_3d(&volume)
            .expect("Failed to upload after releasing previous textures");
    });
}
