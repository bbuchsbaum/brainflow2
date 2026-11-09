//! The residency executor (R5c; plan §11): the backend owns admission and
//! eviction. One pass holds `volume_operations` throughout and plans from a
//! fresh snapshot; the residency lock is held only while planning.
//!
//! **Lazy eviction.** The plan sizes textures not yet uploaded by an upper
//! bound (an f32 volume often fits R16Float), so its eviction list can be
//! longer than needed. The executor follows the plan's order but evicts only
//! when an upload is actually refused: it tries the upload, and on a capacity
//! refusal (bytes, or a texture slot in the fixed-slot fallback) evicts the
//! next victim (the plan's, then the other allowed candidates) and tries
//! again. The renderer's capacity check decides.

use std::collections::{HashMap, VecDeque};

use super::demand::Priority;
use super::manager::{current_service, snapshot, BridgeTextureBackend};
use super::policy::{
    eviction_candidates, plan, Plan, Refusal, Request, ResidencyFacts, TextureBackend, Victim,
    VictimKind,
};
use crate::*;

/// What one admission is for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum AdmitTarget {
    /// Every Front frame's drawable layers: evict for them and upload them.
    Fronts,
    /// Room for one layer the UI is requesting, refused short of `needed`
    /// (in the capacity's units: bytes, or slots in the fixed-slot
    /// fallback): evict the policy's next victim for it, at most one, and
    /// none unless the allowed victims together could free that much. The
    /// caller's request uploads the layer and asks again while it is still
    /// refused.
    RoomFor {
        layer_id: String,
        volume_id: String,
        needed: u64,
    },
}

/// What an admission did.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub(crate) struct AdmitOutcome {
    pub evicted: usize,
    pub uploaded: usize,
    /// Layers the policy or the upload refused, with why.
    pub refused: Vec<(String, Refusal)>,
}

/// Run one admission. Takes `volume_operations`.
pub(crate) async fn admit(state: &BridgeState, target: AdmitTarget) -> AdmitOutcome {
    let outcome = {
        let _operation = state.volume_operations.lock().await;
        admit_held(state, &target).await
    };
    // Residency changed: frames may draw what they skipped before. Not for
    // `RoomFor`: the room is for the caller's upload, which clears the marks
    // when it ends (`request_layer_gpu_resources_with_upload_hook`).
    if matches!(target, AdmitTarget::Fronts) && (outcome.evicted > 0 || outcome.uploaded > 0) {
        clear_allocation_failed_skips(state, None).await;
    }
    outcome
}

/// The requests a target stands for, with each demanded layer's volume.
async fn requests_for(
    state: &BridgeState,
    target: &AdmitTarget,
) -> (Vec<Request>, HashMap<String, String>) {
    let mut volumes = HashMap::new();
    let requests = match target {
        AdmitTarget::Fronts => {
            let mut residency = state.residency.state.lock().await;
            // A refusal belongs to a layer a front tab still lists; one whose
            // tab went behind or closed would show an old reason later.
            let listed: std::collections::HashSet<String> = residency
                .ledger
                .frames()
                .into_iter()
                .filter(|(_, demand)| demand.priority == Priority::Front)
                .flat_map(|(_, demand)| demand.layers.iter().map(|layer| layer.layer_id.clone()))
                .collect();
            let before = residency.refusals.len();
            residency
                .refusals
                .retain(|layer_id, _| listed.contains(layer_id));
            if residency.refusals.len() != before {
                residency.changed();
            }
            residency
                .ledger
                .frames()
                .into_iter()
                .filter(|(_, demand)| demand.priority == Priority::Front)
                .map(|(frame, demand)| {
                    for layer in demand.layers.iter().chain(&demand.held) {
                        volumes.insert(layer.layer_id.clone(), layer.volume_id.clone());
                    }
                    Request::Frame(frame.clone())
                })
                .collect()
        }
        AdmitTarget::RoomFor {
            layer_id,
            volume_id,
            ..
        } => {
            volumes.insert(layer_id.clone(), volume_id.clone());
            vec![Request::Layer {
                layer_id: layer_id.clone(),
                volume_id: volume_id.clone(),
            }]
        }
    };
    (requests, volumes)
}

/// One request's plan, with the victims to evict in order (the plan's, then
/// every other victim the policy allows) and the snapshot they came from.
struct Planned {
    plan: Plan,
    victims: VecDeque<Victim>,
    facts: ResidencyFacts,
}

/// Plan `request` from a fresh snapshot. None without a render service.
async fn plan_now(state: &BridgeState, request: &Request) -> Option<Planned> {
    let service_arc = current_service(state).await?;
    let snap = {
        let mut service = service_arc.lock().await;
        snapshot(state, &state.residency, &mut service).await
    };
    let facts = BridgeTextureBackend(snap.facts).facts();
    let now = state.residency.now();
    let residency = state.residency.state.lock().await;
    let plan = plan(&facts, &residency.ledger, now, request);
    let mut victims: VecDeque<Victim> = plan.evict.iter().cloned().collect();
    for victim in eviction_candidates(&facts, &residency.ledger, now) {
        if !victims.iter().any(|planned| planned.kind == victim.kind) {
            victims.push_back(victim);
        }
    }
    Some(Planned {
        plan,
        victims,
        facts,
    })
}

/// Record refusals for the report, and clear them for admitted layers.
async fn record(state: &BridgeState, refused: &[(String, Refusal)], admitted: &[String]) {
    if refused.is_empty() && admitted.is_empty() {
        return;
    }
    let mut residency = state.residency.state.lock().await;
    let mut changed = false;
    for (layer_id, reason) in refused {
        changed |= residency.refusals.insert(layer_id.clone(), *reason) != Some(*reason);
    }
    for layer_id in admitted {
        changed |= residency.refusals.remove(layer_id).is_some();
    }
    if changed {
        residency.changed();
    }
}

/// Evict one victim. True when it freed something.
async fn evict(state: &BridgeState, victim: &VictimKind) -> bool {
    match victim {
        VictimKind::Layer { key } => {
            match release_layer_gpu_resources_held(key.clone(), state).await {
                Ok(result) => result.freed,
                Err(error) => {
                    warn!("Residency: could not evict '{key}': {error:?}");
                    false
                }
            }
        }
        VictimKind::CachedMember { key, member } => {
            let Some(service_arc) = current_service(state).await else {
                return false;
            };
            // Service, then resident sets (the order `ring` documents).
            let mut service = service_arc.lock().await;
            let mut sets = state.resident_image_sets.lock().await;
            sets.get_mut(key)
                .and_then(|ring| ring.release_cached_member(*member, &mut service))
                .is_some()
        }
    }
}

/// What an upload refused for capacity still needs freed, in the units the
/// policy plans in (see `snapshot`): the bytes a `GpuBudgetExceeded` refusal
/// lacks, or one texture slot when the fixed-slot fallback is full. None for
/// any other failure, which no eviction can fix.
pub(crate) fn capacity_shortfall(error: &BridgeError) -> Option<u64> {
    match error {
        BridgeError::GpuBudgetExceeded {
            requested_bytes,
            used_bytes,
            budget_bytes,
            ..
        } => Some(requested_bytes.saturating_sub(budget_bytes.saturating_sub(*used_bytes))),
        error if is_gpu_slots_full(error) => Some(1),
        _ => None,
    }
}

/// Evict the next victim toward freeing `needed`. Every victim is checked
/// against the demand as it is now, since an upload can take long and demand
/// moves under it (a tab switched back, a pin added): one the policy would
/// protect now is dropped. Nothing is evicted unless the victims left could
/// free `needed` together: a refusal that no room can fix must not empty the
/// background first. False when nothing was evicted.
async fn evict_next(state: &BridgeState, planned: &mut Planned, needed: u64) -> bool {
    {
        let now = state.residency.now();
        let residency = state.residency.state.lock().await;
        let allowed = eviction_candidates(&planned.facts, &residency.ledger, now);
        planned
            .victims
            .retain(|victim| allowed.iter().any(|now| now.kind == victim.kind));
    }
    let available: u64 = planned.victims.iter().map(|victim| victim.freed).sum();
    if available < needed {
        return false;
    }
    while let Some(victim) = planned.victims.pop_front() {
        if evict(state, &victim.kind).await {
            return true;
        }
    }
    false
}

/// Upload a layer, or keep the live residency it has.
async fn ensure(state: &BridgeState, layer_id: &str, volume_id: &str) -> BridgeResult<()> {
    let spec = LayerSpec::Volume(VolumeLayerSpec {
        id: layer_id.to_owned(),
        source_resource_id: volume_id.to_owned(),
        colormap: "gray".to_owned(),
        slice_axis: None,
        slice_index: None,
    });
    match request_layer_gpu_resources_held(spec, Some(false), state, || Ok(())).await {
        Ok(_) | Err(BridgeError::Input { code: 1006, .. }) => Ok(()),
        Err(error) => Err(error),
    }
}

/// Refusals the policy made from byte figures: a texture not yet uploaded is
/// sized by an upper bound, so the upload itself may still fit.
fn sized_by_estimate(reason: Refusal) -> bool {
    matches!(reason, Refusal::FrontExceedsBudget | Refusal::HeldByPinned)
}

/// [`admit`] for a caller that holds `volume_operations`.
pub(crate) async fn admit_held(state: &BridgeState, target: &AdmitTarget) -> AdmitOutcome {
    let mut outcome = AdmitOutcome::default();
    let (requests, volumes) = requests_for(state, target).await;
    for request in &requests {
        let Some(mut planned) = plan_now(state, request).await else {
            return outcome;
        };

        if let AdmitTarget::RoomFor { needed, .. } = target {
            // A refusal the policy is sure of (draw cap, a missing volume)
            // gains nothing from room.
            let size_only = planned
                .plan
                .refuse
                .iter()
                .all(|refused| sized_by_estimate(refused.reason));
            if size_only && evict_next(state, &mut planned, *needed).await {
                outcome.evicted += 1;
            }
            continue;
        }
        let plan = planned.plan.clone();

        // Refusals the plan is sure of. One for size alone was made with an
        // estimate: that layer is tried with the rest, keeping the plan's
        // reason should it still not fit.
        let mut uploads: Vec<(String, Refusal)> = plan
            .admit
            .iter()
            .map(|admission| (admission.layer_id.clone(), Refusal::FrontExceedsBudget))
            .collect();
        let mut refused = Vec::new();
        for refusal in &plan.refuse {
            if sized_by_estimate(refusal.reason) {
                uploads.push((refusal.layer_id.clone(), refusal.reason));
            } else {
                refused.push((refusal.layer_id.clone(), refusal.reason));
            }
        }

        let mut admitted = Vec::new();
        for (layer_id, if_full) in uploads {
            let Some(volume_id) = volumes.get(&layer_id) else {
                continue;
            };
            loop {
                match ensure(state, &layer_id, volume_id).await {
                    Ok(()) => {
                        admitted.push(layer_id);
                        break;
                    }
                    Err(error) => match capacity_shortfall(&error) {
                        // Out of room (bytes, or the fixed-slot fallback's
                        // slots): evict the next victim and try again.
                        Some(needed) => {
                            if evict_next(state, &mut planned, needed).await {
                                outcome.evicted += 1;
                                continue;
                            }
                            refused.push((layer_id, if_full));
                            break;
                        }
                        None => {
                            warn!("Residency: upload of '{layer_id}' failed: {error:?}");
                            refused.push((layer_id, Refusal::UploadFailed));
                            break;
                        }
                    },
                }
            }
        }
        outcome.uploaded += admitted.len();
        record(state, &refused, &admitted).await;
        outcome.refused.extend(refused);
    }
    outcome
}
