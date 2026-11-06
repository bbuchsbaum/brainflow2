//! Resident 4D image-set rings: slot accounting and reclaiming cached members.

use crate::*;

/// Resident image-set ring: maximum co-registered members kept uploaded per layer.
/// Bounded well below the shared texture-slot cap (`MAX_TEXTURES`) so overlay
/// layers keep slots available.
pub(crate) const RESIDENT_RING_MAX_SLOTS: usize = 6;
/// Resident image-set ring: per-layer VRAM byte budget. The effective residency is
/// `min(max_slots, budget / bytes_per_member)`, always at least the shown member.
pub(crate) const RESIDENT_RING_BUDGET_BYTES: u64 = 512 * 1024 * 1024;
/// Resident image-set ring: neighbours prefetched around the shown member.
pub(crate) const RESIDENT_RING_PREFETCH_RADIUS: usize = 2;

/// Whether the GPU-resident image-set fast path is enabled. On by default; set
/// `BRAINFLOW_RESIDENT_IMAGE_SET=0` (or `false`/`off`) to force the legacy
/// extract + re-upload path.
pub(crate) fn resident_image_set_enabled() -> bool {
    !matches!(
        std::env::var("BRAINFLOW_RESIDENT_IMAGE_SET")
            .ok()
            .as_deref()
            .map(str::trim),
        Some("0") | Some("false") | Some("off")
    )
}

/// Reclaim one prefetched 4D member when an actual upload has no free slot.
/// The render-service lock and resident-set lock must both be held, in that
/// order, until the caller starts its upload. The currently displayed member of
/// every ring is protected, including layers in other workspaces.
pub(crate) fn reclaim_cached_image_slot(
    sets: &mut HashMap<String, image_set::ResidentImageSet>,
    service: &mut RenderLoopService,
) -> bool {
    while service.residency_metrics().resident_limit.is_some()
        && service.free_volume_slot_count() == 0
    {
        if reclaim_cached_image_members(sets, service, 1) == 0 {
            return false;
        }
    }
    true
}

/// Free up to `max` cached (prefetched, not displayed) 4D members across every
/// resident ring and return how many texture slots were freed. The displayed
/// member of each ring is never taken. Same lock order as
/// [`reclaim_cached_image_slot`]: render service, then resident sets.
pub(crate) fn reclaim_cached_image_members(
    sets: &mut HashMap<String, image_set::ResidentImageSet>,
    service: &mut RenderLoopService,
    max: usize,
) -> usize {
    let mut reclaimed = 0;
    while reclaimed < max {
        let victim = sets.iter_mut().find_map(|(layer_id, resident)| {
            resident
                .release_cached_lru(service)
                .map(|slot| (layer_id.clone(), slot))
        });
        let Some((layer_id, slot)) = victim else {
            break;
        };
        debug!("Reclaimed cached image slot {slot} from layer '{layer_id}'");
        reclaimed += 1;
    }
    reclaimed
}

/// Cached (reclaimable) 4D members held across every resident ring: resident
/// members other than the one each layer displays.
pub(crate) fn cached_image_member_count(
    sets: &HashMap<String, image_set::ResidentImageSet>,
) -> usize {
    sets.values()
        .map(|resident| resident.ring.cached_len(resident.current_member))
        .sum()
}

pub(crate) async fn reclaim_cached_image_slots_internal(
    count: u32,
    bridge_state: &BridgeState,
) -> BridgeResult<ReclaimCachedSlotsResult> {
    let _operation = bridge_state.volume_operations.lock().await;
    let service_arc = {
        let guard = bridge_state.render_loop_service.lock().await;
        guard
            .as_ref()
            .ok_or_else(|| BridgeError::ServiceNotInitialized {
                code: 5006,
                details: "GPU rendering service is not initialized. Cannot reclaim texture slots."
                    .to_string(),
            })?
            .clone()
    };
    let mut service = service_arc.lock().await;
    let reclaimed = {
        let mut sets = bridge_state.resident_image_sets.lock().await;
        reclaim_cached_image_members(&mut sets, &mut service, count as usize)
    };
    let free_texture_slots = service.free_volume_slot_count() as u32;
    drop(service);
    super::note_reclaim(bridge_state, reclaimed as u32).await;
    // The UI reclaims only to make room for an upload it requests next: the
    // starved layers' skip marks are cleared when that upload completes, so
    // a frame cannot hand the freed slot to one of them first.
    Ok(ReclaimCachedSlotsResult {
        reclaimed: reclaimed as u32,
        free_texture_slots,
    })
}

/// Drop a layer's resident image-set ring (if any) and free every texture slot it
/// still holds. Safe to call for layers that never had a ring. Errors from freeing
/// an already-free slot are swallowed — teardown is best-effort.
pub(crate) async fn release_resident_image_set(
    layer_id: &str,
    bridge_state: &BridgeState,
    service: &mut RenderLoopService,
) -> usize {
    release_resident_image_set_allocations(
        layer_id,
        None,
        &bridge_state.resident_image_sets,
        service,
    )
    .await
}

/// Tear down `layer_id`'s ring and free the slots it still owns. With `owner`,
/// only a ring that holds that residency goes: a late release of an old lease
/// must not take the ring of the layer's newer allocation. Returns how many
/// slots it freed.
pub(crate) async fn release_resident_image_set_allocations(
    layer_id: &str,
    owner: Option<SlotHandle>,
    resident_image_sets: &Mutex<HashMap<String, image_set::ResidentImageSet>>,
    service: &mut RenderLoopService,
) -> usize {
    let resident = {
        let mut sets = resident_image_sets.lock().await;
        let owned = sets
            .get(layer_id)
            .is_some_and(|resident| owner.is_none_or(|slot| resident.owns(slot)));
        if owned {
            sets.remove(layer_id)
        } else {
            None
        }
    };
    resident.map_or(0, |mut resident| resident.release_all(service))
}
