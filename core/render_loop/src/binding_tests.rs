//! GPU-backed regression coverage for per-draw texture binding plans.
//!
//! These deliberately create a real `RenderLoopService`: a planner test that
//! only exercises CPU bookkeeping would not catch an invalid bind group.

use crate::view_state::{InterpolationMode, LayerConfig, SliceOrientation, ViewId, ViewState};
use crate::{render_state::LayerInfo, RenderLoopError, RenderLoopService};
use volmath::{DenseVolume3, NeuroSpace, NeuroSpaceExt};

const DIMS: u32 = 8;

fn volume(value: f32) -> DenseVolume3<f32> {
    let space =
        NeuroSpace::from_dims_spacing_origin(vec![DIMS as usize; 3], vec![1.0; 3], vec![0.0; 3])
            .expect("test space");
    // The spatial variation makes a wrong resident-to-binding map observable
    // in the readback; constant fields would make several permutations equal.
    let data = (0..(DIMS * DIMS * DIMS))
        .map(|index| value * (0.2 + (index % DIMS) as f32 / DIMS as f32))
        .collect();
    DenseVolume3::from_data(space, data)
}

/// Allocate every desktop resident slot.  The deliberately sparse draw below
/// then proves that capacity is a draw binding budget, not a residency budget.
fn resident_service() -> (RenderLoopService, Vec<u32>) {
    let mut service = pollster::block_on(RenderLoopService::new()).expect("real GPU service");
    service.load_shaders().expect("runtime shaders");
    let mut slots = Vec::new();
    for value in 0..13 {
        let (slot, _) = service
            .upload_volume_3d(&volume((value + 1) as f32 / 13.0))
            .expect("resident upload");
        slots.push(slot);
    }
    assert_eq!(slots, (0..13).collect::<Vec<_>>());
    (service, slots)
}

fn sparse_layers(slots: &[u32]) -> Vec<LayerInfo> {
    [slots[12], slots[9], slots[5], slots[1]]
        .into_iter()
        .map(|atlas_index| LayerInfo {
            atlas_index,
            opacity: 0.25,
            intensity_range: (0.0, 1.0),
            threshold_range: (0.0, 0.0),
            ..LayerInfo::default()
        })
        .collect()
}

fn declarative_view(id: &str) -> ViewState {
    ViewState::from_basic_params(
        id.into(),
        [3.5, 3.5, 3.5],
        SliceOrientation::Axial,
        DIMS as f32,
        [16, 16],
        (0.0, 1.0),
    )
    .with_crosshair(false)
    .with_layers(vec![LayerConfig::new(id.into())
        .with_intensity_window(0.0, 1.0)
        .with_interpolation(InterpolationMode::Nearest)])
}

#[test]
fn r3_sparse_residents_fit_a_four_position_draw_plan() {
    let (mut service, slots) = resident_service();
    let manager = service
        .multi_texture_manager
        .as_mut()
        .expect("texture manager");
    manager.set_binding_capacity_for_test(4);

    let plan = manager
        .binding_planner
        .plan(manager, &[slots[12], slots[9], slots[5], slots[1]])
        .expect("four sparse residents fit");
    assert_eq!(
        plan.handles
            .iter()
            .map(|handle| handle.index())
            .collect::<Vec<_>>(),
        [1, 5, 9, 12]
    );
    assert_eq!(plan.position(slots[12]), Some(3));
    assert_eq!(plan.position(slots[1]), Some(0));
}

#[test]
fn r3_fifth_distinct_resident_is_rejected_but_duplicates_share_a_slot() {
    let (mut service, slots) = resident_service();
    let manager = service
        .multi_texture_manager
        .as_mut()
        .expect("texture manager");
    manager.set_binding_capacity_for_test(4);

    let duplicate_plan = manager
        .binding_planner
        .plan(
            manager,
            &[slots[12], slots[9], slots[12], slots[5], slots[1], slots[9]],
        )
        .expect("duplicates do not consume binding positions");
    assert_eq!(duplicate_plan.handles.len(), 4);

    let error = manager
        .binding_planner
        .plan(
            manager,
            &[slots[12], slots[9], slots[5], slots[1], slots[0]],
        )
        .expect_err("five distinct residents exceed the test capacity");
    assert!(matches!(
        error,
        RenderLoopError::Internal { code: 6021, .. }
    ));
}

#[test]
fn r3_binding_cache_hits_for_reordered_and_alternating_views() {
    let (mut service, slots) = resident_service();
    let layout = service
        .texture_bind_group_layout
        .as_ref()
        .expect("texture layout");
    let lut = service.texture_manager.colormap_view().expect("LUT view");
    let manager = service
        .multi_texture_manager
        .as_mut()
        .expect("texture manager");
    manager.set_binding_capacity_for_test(4);
    manager.binding_planner.identity = false;
    // Uploading residents maintains the legacy identity group.  Count only
    // per-draw compact groups created by this test.
    let initial_groups_created = manager.binding_cache_stats().groups_created;

    for indices in [
        vec![slots[12], slots[9], slots[5], slots[1]],
        vec![slots[1], slots[5], slots[9], slots[12]],
        vec![slots[12], slots[9], slots[5], slots[0]],
        vec![slots[12], slots[9], slots[5], slots[1]],
    ] {
        manager
            .prepare_draw(
                &indices,
                &[],
                &service.device,
                layout,
                service.texture_manager.linear_sampler(),
                service.texture_manager.nearest_sampler(),
                lut,
            )
            .expect("valid GPU bind group");
    }

    let stats = manager.binding_cache_stats();
    assert_eq!(stats.groups_created, initial_groups_created + 2);
    assert_eq!(stats.misses, 2);
    assert_eq!(stats.hits, 2);
    assert_eq!(stats.cached_groups, 2);
}

#[test]
fn r3_binding_cache_is_bounded_and_rebuilds_the_lru_eviction() {
    let (mut service, slots) = resident_service();
    let layout = service
        .texture_bind_group_layout
        .as_ref()
        .expect("texture layout");
    let lut = service.texture_manager.colormap_view().expect("LUT view");
    let manager = service
        .multi_texture_manager
        .as_mut()
        .expect("texture manager");
    manager.set_binding_capacity_for_test(2);
    manager.binding_planner.identity = false;

    let mut plans = Vec::new();
    for left in 0..slots.len() {
        for right in left + 1..slots.len() {
            plans.push(vec![slots[left], slots[right]]);
        }
    }
    assert!(plans.len() > 32);
    for indices in plans.iter().take(33) {
        manager
            .prepare_draw(
                indices,
                &[],
                &service.device,
                layout,
                service.texture_manager.linear_sampler(),
                service.texture_manager.nearest_sampler(),
                lut,
            )
            .expect("compact group");
    }
    let after_fill = manager.binding_cache_stats();
    assert_eq!(after_fill.cached_groups, 32);
    manager
        .prepare_draw(
            &plans[0],
            &[],
            &service.device,
            layout,
            service.texture_manager.linear_sampler(),
            service.texture_manager.nearest_sampler(),
            lut,
        )
        .expect("evicted plan can rebuild");
    let after_rebuild = manager.binding_cache_stats();
    assert_eq!(after_rebuild.cached_groups, 32);
    assert_eq!(after_rebuild.misses, after_fill.misses + 1);
    assert_eq!(after_rebuild.groups_created, after_fill.groups_created + 1);
}

#[test]
fn r3_lut_growth_and_reinitialization_clear_all_compact_groups_but_row_writes_do_not() {
    use crate::texture_manager::COLORMAP_ROW_BYTES;

    let (mut service, slots) = resident_service();
    service
        .create_offscreen_target(16, 16)
        .expect("offscreen target");
    let rows = sparse_layers(&slots);
    service.update_layer_uniforms_direct(
        &rows,
        &vec![(DIMS, DIMS, DIMS); rows.len()],
        &vec![nalgebra::Matrix4::identity(); rows.len()],
    );
    service.render_to_buffer().expect("populate compact cache");
    let cached = service
        .multi_texture_manager
        .as_ref()
        .expect("texture manager")
        .binding_cache_stats()
        .cached_groups;
    assert!(cached > 0);

    let one_row = vec![7u8; COLORMAP_ROW_BYTES];
    service
        .upsert_custom_colormap("same-texture".into(), &one_row)
        .expect("same-texture LUT write");
    assert_eq!(
        service
            .multi_texture_manager
            .as_ref()
            .expect("texture manager")
            .binding_cache_stats()
            .cached_groups,
        cached,
        "a row write does not replace the LUT view"
    );

    let two_rows = vec![9u8; COLORMAP_ROW_BYTES * 2];
    service
        .upsert_custom_colormap("requires-growth".into(), &two_rows)
        .expect("grow LUT texture");
    assert_eq!(
        service
            .multi_texture_manager
            .as_ref()
            .expect("texture manager")
            .binding_cache_stats()
            .cached_groups,
        0,
        "replacing the LUT view invalidates every compact group"
    );

    service
        .render_to_buffer()
        .expect("repopulate after LUT growth");
    assert!(
        service
            .multi_texture_manager
            .as_ref()
            .expect("texture manager")
            .binding_cache_stats()
            .cached_groups
            > 0
    );
    service.initialize_colormap().expect("reinitialize LUT");
    assert_eq!(
        service
            .multi_texture_manager
            .as_ref()
            .expect("texture manager")
            .binding_cache_stats()
            .cached_groups,
        0,
        "LUT reinitialization invalidates every compact group"
    );
}

#[test]
fn r3_compact_binding_is_pixel_equivalent_to_legacy_sparse_positions() {
    let (mut service, slots) = resident_service();
    service
        .create_offscreen_target(32, 32)
        .expect("offscreen target");
    let layers = sparse_layers(&slots);
    let dimensions = vec![(DIMS, DIMS, DIMS); layers.len()];
    let transforms = vec![nalgebra::Matrix4::identity(); layers.len()];
    service.update_frame_ubo(
        [0.0, 0.0, (DIMS as f32 - 1.0) / 2.0, 1.0],
        [DIMS as f32, 0.0, 0.0, 0.0],
        [0.0, DIMS as f32, 0.0, 0.0],
    );
    service.update_layer_uniforms_direct(&layers, &dimensions, &transforms);
    service
        .multi_texture_manager
        .as_mut()
        .expect("texture manager")
        .set_binding_capacity_for_test(4);
    service
        .multi_texture_manager
        .as_mut()
        .expect("texture manager")
        .binding_planner
        .identity = false;

    let compact = service.render_to_buffer().expect("compact GPU frame");
    assert!(
        compact.chunks_exact(4).any(|pixel| pixel[3] != 0),
        "oracle frame is visible"
    );

    let manager = service
        .multi_texture_manager
        .as_mut()
        .expect("texture manager");
    manager.binding_planner.identity = true;
    manager.set_binding_capacity_for_test(4);
    let legacy = service
        .render_to_buffer()
        .expect("legacy-position GPU frame");

    assert_eq!(
        compact, legacy,
        "compact slots changed sparse resident pixels"
    );
}

#[test]
fn r3_reused_slot_rejects_stale_rows_until_a_fresh_upload_resets_identity() {
    let mut service = pollster::block_on(RenderLoopService::new()).expect("real GPU service");
    service.load_shaders().expect("runtime shaders");
    service
        .create_offscreen_target(16, 16)
        .expect("offscreen target");
    let (slot, transform) = service.upload_volume_3d(&volume(0.25)).expect("upload");
    let layers = vec![LayerInfo {
        atlas_index: slot,
        intensity_range: (0.0, 1.0),
        threshold_range: (0.0, 0.0),
        ..LayerInfo::default()
    }];
    let dims = vec![(DIMS, DIMS, DIMS)];
    let transforms = vec![transform];
    service.update_frame_ubo(
        [0.0, 0.0, (DIMS as f32 - 1.0) / 2.0, 1.0],
        [DIMS as f32, 0.0, 0.0, 0.0],
        [0.0, DIMS as f32, 0.0, 0.0],
    );
    service.update_layer_uniforms_direct(&layers, &dims, &transforms);
    service
        .multi_texture_manager
        .as_mut()
        .expect("texture manager")
        .binding_planner
        .identity = false;
    service
        .render_to_buffer()
        .expect("initial frame captures slot handle");

    service
        .multi_texture_manager
        .as_mut()
        .expect("texture manager")
        .release_volume(slot)
        .expect("release original residency");
    let (reused, replacement_transform) =
        service.upload_volume_3d(&volume(0.75)).expect("reuse slot");
    assert_eq!(
        reused, slot,
        "the regression needs a recycled resident index"
    );

    assert!(matches!(
        service.render_to_buffer(),
        Err(RenderLoopError::Internal { code: 6023, .. })
    ));

    // An explicit new layer upload is a fresh selection and must capture the
    // generation for the replacement allocation rather than retaining stale rows.
    service.update_layer_uniforms_direct(&layers, &dims, &[replacement_transform]);
    service
        .render_to_buffer()
        .expect("fresh rows accept replacement residency");
}

#[test]
fn r3_bulk_property_refresh_cannot_refresh_a_stale_sibling_residency() {
    let (mut service, slots) = resident_service();
    service
        .create_offscreen_target(16, 16)
        .expect("offscreen target");
    for slot in [slots[12], slots[9]] {
        service
            .add_layer_3d(
                slot,
                nalgebra::Matrix4::identity(),
                (DIMS, DIMS, DIMS),
                0.5,
                0,
                0,
            )
            .expect("legacy layer");
    }
    service.update_frame_ubo(
        [0.0, 0.0, 3.5, 1.0],
        [DIMS as f32, 0.0, 0.0, 0.0],
        [0.0, DIMS as f32, 0.0, 0.0],
    );
    service.render_to_buffer().expect("captures A and B");
    let a = slots[12];
    service
        .multi_texture_manager
        .as_mut()
        .expect("texture manager")
        .release_volume(a)
        .expect("release A");
    assert_eq!(
        service
            .upload_volume_3d(&volume(0.9))
            .expect("reuse A slot")
            .0,
        a
    );
    service.set_layer_colormap(1, 1).expect("patch B colormap");
    service
        .set_layer_border(1, true, 1.0)
        .expect("patch B border");
    assert!(matches!(
        service.render_to_buffer(),
        Err(RenderLoopError::Internal { code: 6023, .. })
    ));
}

#[test]
fn r3_explicit_rows_capture_before_their_first_draw() {
    let mut service = pollster::block_on(RenderLoopService::new()).expect("real GPU service");
    service.load_shaders().expect("runtime shaders");
    service
        .create_offscreen_target(16, 16)
        .expect("offscreen target");
    let (slot, transform) = service.upload_volume_3d(&volume(0.25)).expect("upload");
    let rows = [LayerInfo {
        atlas_index: slot,
        intensity_range: (0.0, 1.0),
        threshold_range: (0.0, 0.0),
        ..LayerInfo::default()
    }];
    service.update_layer_uniforms_direct(&rows, &[(DIMS, DIMS, DIMS)], &[transform]);
    service
        .multi_texture_manager
        .as_mut()
        .expect("texture manager")
        .release_volume(slot)
        .expect("release before first draw");
    assert_eq!(
        service
            .upload_volume_3d(&volume(0.75))
            .expect("reuse slot")
            .0,
        slot
    );
    assert!(matches!(
        service.render_to_buffer(),
        Err(RenderLoopError::Internal { code: 6023, .. })
    ));
}

#[test]
fn r3_deref_mut_release_rejection_evicts_compact_cache() {
    let (mut service, slots) = resident_service();
    service
        .create_offscreen_target(16, 16)
        .expect("offscreen target");
    let rows = sparse_layers(&slots);
    service.update_frame_ubo(
        [0.0, 0.0, 3.5, 1.0],
        [DIMS as f32, 0.0, 0.0, 0.0],
        [0.0, DIMS as f32, 0.0, 0.0],
    );
    service.update_layer_uniforms_direct(
        &rows,
        &vec![(DIMS, DIMS, DIMS); rows.len()],
        &vec![nalgebra::Matrix4::identity(); rows.len()],
    );
    let manager = service
        .multi_texture_manager
        .as_mut()
        .expect("texture manager");
    manager.set_binding_capacity_for_test(4);
    manager.binding_planner.identity = false;
    service.render_to_buffer().expect("populate compact cache");
    assert!(
        service
            .multi_texture_manager
            .as_ref()
            .expect("texture manager")
            .binding_cache_stats()
            .cached_groups
            > 0
    );
    let manager = service
        .multi_texture_manager
        .as_mut()
        .expect("texture manager");
    crate::residency::ResidentTextureStore::release_volume(&mut *manager, slots[12])
        .expect("DerefMut release");
    assert!(matches!(
        service.render_to_buffer(),
        Err(RenderLoopError::Internal { .. })
    ));
    assert_eq!(
        service
            .multi_texture_manager
            .as_ref()
            .expect("texture manager")
            .binding_cache_stats()
            .cached_groups,
        0
    );
}

#[test]
fn r3_incremental_add_layer_3d_keeps_sparse_resident_identities() {
    let (mut service, slots) = resident_service();
    service
        .create_offscreen_target(32, 32)
        .expect("offscreen target");
    for slot in [slots[12], slots[9], slots[5], slots[1]] {
        service
            .add_layer_3d(
                slot,
                nalgebra::Matrix4::identity(),
                (DIMS, DIMS, DIMS),
                0.25,
                0,
                0,
            )
            .expect("incremental layer row");
    }
    service.update_frame_ubo(
        [0.0, 0.0, (DIMS as f32 - 1.0) / 2.0, 1.0],
        [DIMS as f32, 0.0, 0.0, 0.0],
        [0.0, DIMS as f32, 0.0, 0.0],
    );
    let manager = service
        .multi_texture_manager
        .as_mut()
        .expect("texture manager");
    manager.set_binding_capacity_for_test(4);
    manager.binding_planner.identity = false;

    let image = service.render_to_buffer().expect("incremental GPU frame");
    assert!(image.chunks_exact(4).any(|pixel| pixel[3] != 0));
    assert_eq!(
        service
            .layer_storage_manager
            .as_ref()
            .expect("layer storage")
            .resident_indices(),
        &[slots[12], slots[9], slots[5], slots[1]],
        "incremental append must retain resident, rather than compact, identities"
    );
}

#[test]
fn r3_property_patch_after_compaction_reuses_the_compact_binding_group() {
    let (mut service, slots) = resident_service();
    service
        .create_offscreen_target(32, 32)
        .expect("offscreen target");
    for slot in [slots[12], slots[9], slots[5], slots[1]] {
        service
            .add_layer_3d(
                slot,
                nalgebra::Matrix4::identity(),
                (DIMS, DIMS, DIMS),
                0.25,
                0,
                0,
            )
            .expect("layer");
    }
    service.update_frame_ubo(
        [0.0, 0.0, (DIMS as f32 - 1.0) / 2.0, 1.0],
        [DIMS as f32, 0.0, 0.0, 0.0],
        [0.0, DIMS as f32, 0.0, 0.0],
    );
    let manager = service
        .multi_texture_manager
        .as_mut()
        .expect("texture manager");
    manager.set_binding_capacity_for_test(4);
    manager.binding_planner.identity = false;
    let before = service.render_to_buffer().expect("initial compact frame");
    let groups = service
        .multi_texture_manager
        .as_ref()
        .expect("texture manager")
        .binding_cache_stats()
        .groups_created;

    service.update_layer(0, 0.75, 0).expect("property patch");
    let after = service.render_to_buffer().expect("patched compact frame");
    let stats = service
        .multi_texture_manager
        .as_ref()
        .expect("texture manager")
        .binding_cache_stats();
    assert_ne!(before, after, "opacity patch must reach the GPU rows");
    assert_eq!(
        stats.groups_created, groups,
        "same resident set must reuse group"
    );
    assert!(
        stats.hits >= 1,
        "patched rows must look up the compact plan"
    );
}

#[test]
fn r3_mask_replace_and_clear_invalidate_bindings_without_staling_the_residency() {
    let mut service = pollster::block_on(RenderLoopService::new()).expect("real GPU service");
    service.load_shaders().expect("runtime shaders");
    service
        .create_offscreen_target(16, 16)
        .expect("offscreen target");
    let (slot, transform) = service.upload_volume_3d(&volume(0.5)).expect("upload");
    service
        .add_layer_3d(slot, transform, (DIMS, DIMS, DIMS), 1.0, 0, 0)
        .expect("maskable layer");
    service.update_frame_ubo(
        [0.0, 0.0, (DIMS as f32 - 1.0) / 2.0, 1.0],
        [DIMS as f32, 0.0, 0.0, 0.0],
        [0.0, DIMS as f32, 0.0, 0.0],
    );
    service.render_to_buffer().expect("unmasked frame");

    service
        .upload_alpha_mask(
            slot,
            [DIMS, DIMS, DIMS],
            &vec![255; (DIMS * DIMS * DIMS) as usize],
        )
        .expect("replace mask binding");
    service.render_to_buffer().expect("masked frame");
    service.clear_alpha_mask(slot).expect("clear mask binding");
    service.render_to_buffer().expect("cleared-mask frame");
}

#[test]
fn r3_precision_promotion_invalidates_binding_but_keeps_the_slot_handle_current() {
    let mut service = pollster::block_on(RenderLoopService::new()).expect("real GPU service");
    service.load_shaders().expect("runtime shaders");
    service
        .create_offscreen_target(16, 16)
        .expect("offscreen target");
    let (slot, transform) = service.upload_volume_3d(&volume(0.5)).expect("upload");
    let layer = LayerInfo {
        atlas_index: slot,
        intensity_range: (0.0, 100_000.0),
        threshold_range: (0.0, 0.0),
        ..LayerInfo::default()
    };
    service.update_frame_ubo(
        [0.0, 0.0, (DIMS as f32 - 1.0) / 2.0, 1.0],
        [DIMS as f32, 0.0, 0.0, 0.0],
        [0.0, DIMS as f32, 0.0, 0.0],
    );
    service.update_layer_uniforms_direct(
        std::slice::from_ref(&layer),
        &[(DIMS, DIMS, DIMS)],
        &[transform],
    );
    service
        .multi_texture_manager
        .as_mut()
        .expect("texture manager")
        .binding_planner
        .identity = false;
    service
        .render_to_buffer()
        .expect("initial frame captures handle");
    let groups = service
        .multi_texture_manager
        .as_ref()
        .expect("texture manager")
        .binding_cache_stats()
        .groups_created;
    let handle_before = service.slot_handle(slot).expect("initial slot handle");

    // The update eagerly refreshes the compatibility all-residents identity
    // group because the underlying texture view is replaced.
    service
        .update_volume_3d_at(slot, &volume(70_000.0))
        .expect("automatic promotion update");
    assert_eq!(service.slot_handle(slot), Some(handle_before));
    assert_eq!(
        service
            .multi_texture_manager
            .as_ref()
            .expect("texture manager")
            .binding_cache_stats()
            .groups_created,
        groups + 1,
        "promotion eagerly rebuilds exactly one compatibility identity group"
    );
    assert_eq!(
        service
            .multi_texture_manager
            .as_ref()
            .expect("texture manager")
            .get_texture_info(slot)
            .expect("resident slot")
            .format,
        wgpu::TextureFormat::R32Float
    );
    service
        .render_to_buffer()
        .expect("captured handle remains valid after promotion");
    // The next compact draw cannot reuse the old view's group, and rebuilds
    // one compact group for the same still-current slot handle.
    assert_eq!(
        service
            .multi_texture_manager
            .as_ref()
            .expect("texture manager")
            .binding_cache_stats()
            .groups_created,
        groups + 2,
        "draw rebuilds exactly one compact group after the eager identity refresh"
    );
}

#[test]
fn r3_declarative_direct_declarative_interleave_restores_registered_selection() {
    pollster::block_on(async {
        let mut service = RenderLoopService::new().await.expect("real GPU service");
        service.load_shaders().expect("runtime shaders");
        let (a, _) = service.upload_volume_3d(&volume(0.25)).expect("A upload");
        let (b, b_transform) = service.upload_volume_3d(&volume(0.75)).expect("B upload");
        service
            .register_volume_with_range("A".into(), a, (0.0, 1.0))
            .expect("register A");
        service
            .register_volume_with_range("B".into(), b, (0.0, 1.0))
            .expect("register B");
        service
            .create_offscreen_target(16, 16)
            .expect("offscreen target");

        let a_state = declarative_view("A");
        let a_before = service
            .request_frame(ViewId::new("A"), a_state.clone())
            .await
            .expect("declarative A")
            .image_data;
        service.update_frame_ubo(
            [0.0, 0.0, (DIMS as f32 - 1.0) / 2.0, 1.0],
            [DIMS as f32, 0.0, 0.0, 0.0],
            [0.0, DIMS as f32, 0.0, 0.0],
        );
        service.update_layer_uniforms_direct(
            &[LayerInfo {
                atlas_index: b,
                intensity_range: (0.0, 1.0),
                threshold_range: (0.0, 0.0),
                ..LayerInfo::default()
            }],
            &[(DIMS, DIMS, DIMS)],
            &[b_transform],
        );
        let direct_b = service.render_to_buffer().expect("direct B");
        let a_after = service
            .request_frame(ViewId::new("A"), a_state)
            .await
            .expect("restored declarative A")
            .image_data;

        assert!(direct_b.chunks_exact(4).any(|pixel| pixel[3] != 0));
        assert_eq!(
            a_before, a_after,
            "stale direct rows leaked into declarative A"
        );
    });
}

#[test]
fn r3_lowered_capacity_revalidates_an_unchanged_warm_draw() {
    let (mut service, slots) = resident_service();
    let mut rows = sparse_layers(&slots);
    rows.push(LayerInfo {
        atlas_index: slots[0],
        ..rows[0].clone()
    });
    service.update_layer_uniforms_direct(
        &rows,
        &vec![(DIMS, DIMS, DIMS); rows.len()],
        &vec![nalgebra::Matrix4::identity(); rows.len()],
    );
    service
        .prepare_draw_bindings()
        .expect("five positions initially fit");
    service.prepare_draw_bindings().expect("warm draw");
    service
        .multi_texture_manager
        .as_mut()
        .unwrap()
        .set_binding_capacity_for_test(4);
    assert!(matches!(
        service.prepare_draw_bindings(),
        Err(RenderLoopError::Internal { code: 6021, .. })
    ));
}

#[test]
fn r3_store_replacement_with_equal_revision_rejects_old_captured_rows() {
    use crate::residency::ResidentTextureStore;
    let (mut service, slots) = resident_service();
    let rows = sparse_layers(&slots);
    service.update_layer_uniforms_direct(
        &rows,
        &vec![(DIMS, DIMS, DIMS); rows.len()],
        &vec![nalgebra::Matrix4::identity(); rows.len()],
    );
    service
        .prepare_draw_bindings()
        .expect("initial compact plan");
    service.prepare_draw_bindings().expect("warm draw");
    let mut replacement = ResidentTextureStore::new(13);
    for index in 0..13 {
        replacement
            .upload_volume(
                &service.device,
                &service.queue,
                &volume(index as f32 / 13.0),
                wgpu::TextureFormat::R32Float,
            )
            .unwrap();
    }
    let manager = service.multi_texture_manager.as_mut().unwrap();
    let original = manager.binding_token();
    assert_eq!(
        original.1,
        replacement.binding_token().1,
        "must collide on the store-local revision"
    );
    assert_ne!(original.0, replacement.binding_token().0);
    **manager = replacement;
    assert!(
        manager.bind_group().is_none(),
        "old group belongs to the old store"
    );
    assert!(matches!(
        service.prepare_draw_bindings(),
        Err(RenderLoopError::Internal { code: 6023, .. })
    ));
    assert_eq!(
        service
            .multi_texture_manager
            .as_ref()
            .unwrap()
            .binding_cache_stats()
            .cached_groups,
        0
    );
}

#[test]
fn r3_duplicate_rows_keep_distinct_generations_through_refresh_and_removal() {
    for remove_stale in [true, false] {
        let mut service = pollster::block_on(RenderLoopService::new()).unwrap();
        service.load_shaders().unwrap();
        let (slot, transform) = service.upload_volume_3d(&volume(0.25)).unwrap();
        service
            .add_layer_3d(slot, transform, (DIMS, DIMS, DIMS), 1., 0, 0)
            .unwrap();
        service.prepare_draw_bindings().unwrap();
        service.release_volume(slot).unwrap();
        let (reused, transform) = service.upload_volume_3d(&volume(0.75)).unwrap();
        assert_eq!(reused, slot);
        service
            .add_layer_3d(slot, transform, (DIMS, DIMS, DIMS), 0.5, 0, 0)
            .unwrap();
        service.set_layer_colormap(1, 1).unwrap();
        assert!(matches!(
            service.prepare_draw_bindings(),
            Err(RenderLoopError::Internal { code: 6023, .. })
        ));
        // Removing the stale row keeps the fresh sibling valid; removing the
        // fresh row must not silently recapture the stale survivor.
        let removed = if remove_stale { 0 } else { 1 };
        assert_eq!(service.remove_render_layer(removed), Some(slot));
        if remove_stale {
            service
                .prepare_draw_bindings()
                .expect("remaining fresh sibling is valid");
            assert_eq!(
                service
                    .layer_storage_manager
                    .as_ref()
                    .unwrap()
                    .captured_handles(),
                &[service.slot_handle(slot)]
            );
        } else {
            assert!(matches!(
                service.prepare_draw_bindings(),
                Err(RenderLoopError::Internal { code: 6023, .. })
            ));
        }
        assert_eq!(
            service.volume_metadata[&slot].dimensions,
            (DIMS, DIMS, DIMS)
        );
    }
}
