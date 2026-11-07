//! R5d: under the backend owner (`BRAINFLOW_BACKEND_RESIDENCY`), a 4D ring
//! draws its cached members from the global byte pool instead of a fixed
//! six-member cap (plan §3, R5d).
//!
//! - A ring grows by one member only while the bytes left free after it stay
//!   at or above the **headroom**: the larger of the largest demanded primary
//!   and 5% of the budget, so the next primary upload need not evict.
//! - Rings of layers a Front frame lists share the **slack** (free bytes plus
//!   what their cached members already hold, less the headroom) equally.
//! - A ring no Front frame lists does not grow, and is shrunk to its
//!   displayed member when demand moves it behind.
//!
//! A ring that may not grow reuses its own least recently used slot in place,
//! so a member change never releases a texture before the new member is
//! uploaded.

use std::collections::HashSet;

use super::demand::Priority;
use super::manager::current_service;
use crate::*;

/// The headroom floor, as a fraction of the budget: 1/20, 5%.
const HEADROOM_BUDGET_DIVISOR: u64 = 20;

/// What a ring may take from the pool, fixed for one swap.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RingGrowth {
    /// Bytes that must stay free after a new member is uploaded.
    pub headroom: u64,
    /// Bytes this ring's cached (not displayed) members may hold.
    pub share: u64,
    /// Bytes one member takes (the displayed member's texture).
    pub member_bytes: u64,
}

impl RingGrowth {
    /// Whether a ring holding `resident` members may upload one more, with
    /// `free` bytes left in the budget. After it, `resident` members are
    /// cached (all but the one displayed).
    pub fn allows(&self, resident: usize, free: u64) -> bool {
        free >= self.member_bytes.saturating_add(self.headroom)
            && (resident as u64).saturating_mul(self.member_bytes) <= self.share
    }
}

/// Demand as the pool sees it, read before the ring lock is taken.
pub(crate) struct PoolDemand {
    /// Layers whose rings stay small: see [`behind_layers`].
    behind: HashSet<String>,
    /// Texture bytes of the largest demanded primary.
    largest_primary: u64,
}

impl PoolDemand {
    fn in_front(&self, layer_id: &str) -> bool {
        !self.behind.contains(layer_id)
    }
}

/// Layers only Background frames demand, none of them pinned: their rings
/// keep the displayed member alone. A layer a Front frame lists, a pinned
/// layer (a studio pane is drawn though its frame is Background) and a layer
/// no frame lists yet (it was just added; demand follows) are not behind.
fn behind_layers(ledger: &super::demand::DemandLedger) -> HashSet<String> {
    let frames = ledger.frames();
    let kept: HashSet<&str> = frames
        .iter()
        .flat_map(|(_, demand)| {
            let front = demand.priority == Priority::Front;
            demand
                .layers
                .iter()
                .chain(&demand.held)
                .filter(move |layer| front || layer.pin.is_some())
        })
        .map(|layer| layer.layer_id.as_str())
        .collect();
    frames
        .iter()
        .flat_map(|(_, demand)| demand.layers.iter().chain(&demand.held))
        .map(|layer| layer.layer_id.as_str())
        .filter(|layer_id| !kept.contains(layer_id))
        .map(str::to_owned)
        .collect()
}

/// Read the demand the pool needs. The caller holds the render service and
/// no bridge map: this takes the residency state, then the layer map.
pub(crate) async fn pool_demand(
    state: &BridgeState,
    service: &mut RenderLoopService,
) -> PoolDemand {
    let (behind, demanded) = {
        let residency = state.residency.state.lock().await;
        let demanded: Vec<(String, String)> = residency
            .ledger
            .frames()
            .into_iter()
            .flat_map(|(_, demand)| demand.layers.iter().chain(&demand.held))
            .map(|layer| (layer.layer_id.clone(), layer.volume_id.clone()))
            .collect();
        (behind_layers(&residency.ledger), demanded)
    };
    let known = state.residency.known_texture_bytes();
    let layer_map = state.layer_slots.lock().await;
    // No shared borrow of the service may live across an await.
    let service: &RenderLoopService = service;
    let largest_primary = demanded
        .iter()
        .map(|(layer_id, volume_id)| {
            layer_map
                .current(layer_id, service)
                .map(|handle| slot_bytes(service, handle.index()))
                .or_else(|| known.get(volume_id).copied())
                .unwrap_or(0)
        })
        .max()
        .unwrap_or(0);
    PoolDemand {
        behind,
        largest_primary,
    }
}

fn slot_bytes(service: &RenderLoopService, index: u32) -> u64 {
    service
        .multi_texture_manager
        .as_ref()
        .map_or(0, |manager| manager.slot_bytes(index))
}

/// What `layer_id`'s ring may take from the pool now. `None` without a byte
/// budget (slot mode keeps the fixed cap).
pub(crate) fn ring_growth(
    layer_id: &str,
    demand: &PoolDemand,
    sets: &HashMap<String, image_set::ResidentImageSet>,
    service: &RenderLoopService,
) -> Option<RingGrowth> {
    let metrics = service.residency_metrics();
    let budget = metrics.budget_bytes?;
    let resident = sets.get(layer_id)?;
    let member_bytes = resident
        .displayed_bytes(service)
        .filter(|&bytes| bytes > 0)
        .unwrap_or_else(|| resident.set.bytes_per_member());
    let headroom = demand.largest_primary.max(budget / HEADROOM_BUDGET_DIVISOR);
    if !demand.in_front(layer_id) {
        return Some(RingGrowth {
            headroom,
            share: 0,
            member_bytes,
        });
    }
    let (rings, cached) = sets
        .iter()
        .filter(|(id, _)| demand.in_front(id))
        .fold((0u64, 0u64), |(rings, cached), (_, ring)| {
            (rings + 1, cached + ring.cached_bytes(service))
        });
    let free = metrics.free_bytes.unwrap_or(0);
    let share = (free + cached).saturating_sub(headroom) / rings.max(1);
    Some(RingGrowth {
        headroom,
        share,
        member_bytes,
    })
}

/// Give back what the other front rings hold past `share`, the equal share
/// the swapping ring was just given: the first ring to prefetch must not keep
/// the slack while the others cannot grow. Each keeps its displayed member.
pub(crate) fn trim_front_rings(
    except: &str,
    demand: &PoolDemand,
    share: u64,
    sets: &mut HashMap<String, image_set::ResidentImageSet>,
    service: &mut RenderLoopService,
) -> usize {
    sets.iter_mut()
        .filter(|(id, _)| id.as_str() != except && demand.in_front(id))
        .map(|(_, ring)| ring.trim_cached_to(share, service))
        .sum()
}

/// Free the cached members of every ring only Background frames demand
/// (see [`behind_layers`]), keeping each displayed member. Backend owner
/// only. Returns how many members it freed.
pub(crate) async fn shrink_background_rings(state: &BridgeState) -> usize {
    if !state.residency.backend_owner() {
        return 0;
    }
    let behind = behind_layers(&state.residency.state.lock().await.ledger);
    if behind.is_empty() {
        return 0;
    }
    let _operation = state.volume_operations.lock().await;
    let Some(service_arc) = current_service(state).await else {
        return 0;
    };
    // Service, then resident sets (the order `ring` documents).
    let mut service = service_arc.lock().await;
    let mut sets = state.resident_image_sets.lock().await;
    let mut freed = 0;
    for (layer_id, resident) in sets.iter_mut() {
        if behind.contains(layer_id) {
            freed += resident.trim_cached_to(0, &mut service);
        }
    }
    if freed > 0 {
        debug!("Residency: shrank background rings by {freed} cached member(s)");
    }
    freed
}

#[cfg(test)]
mod tests {
    use super::RingGrowth;

    #[test]
    fn growth_keeps_headroom_and_the_share() {
        let growth = RingGrowth {
            headroom: 100,
            share: 256,
            member_bytes: 128,
        };
        // One displayed member; the next makes one cached: 128 ≤ 256.
        assert!(growth.allows(1, 228));
        // Free after the upload would fall below the headroom.
        assert!(!growth.allows(1, 227));
        // Two cached already fill the share; a third would pass it.
        assert!(growth.allows(2, 10_000));
        assert!(!growth.allows(3, 10_000));
    }
}
