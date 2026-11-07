//! The residency executor (R5c; plan §11): under `BRAINFLOW_BACKEND_RESIDENCY`
//! the backend owns admission and eviction. One pass holds `volume_operations`
//! throughout, plans from a fresh snapshot, evicts what the plan picks and
//! uploads what it admits. The residency lock is held only while planning.

use std::collections::HashMap;

use super::demand::Priority;
use super::manager::{current_service, snapshot, BridgeTextureBackend};
use super::policy::{plan, Plan, Refusal, Request, TextureBackend, VictimKind};
use crate::*;

/// Re-plans after an upload the plan expected to fit is still refused (its
/// size was an estimate). Each pass evicts at least one more texture or ends.
const MAX_PASSES: usize = 4;

/// What one admission is for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum AdmitTarget {
    /// Every Front frame's drawable layers: evict for them and upload them.
    Fronts,
    /// Room for one layer the UI is requesting. Only evicts: the caller's
    /// own request uploads the layer.
    RoomFor { layer_id: String, volume_id: String },
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
            let residency = state.residency.state.lock().await;
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

/// Plan `request` from a fresh snapshot. None without a render service.
async fn plan_now(state: &BridgeState, request: &Request) -> Option<Plan> {
    let service_arc = current_service(state).await?;
    let snap = {
        let mut service = service_arc.lock().await;
        snapshot(state, &state.residency, &mut service).await
    };
    let facts = BridgeTextureBackend(snap.facts).facts();
    let now = state.residency.now();
    let residency = state.residency.state.lock().await;
    Some(plan(&facts, &residency.ledger, now, request))
}

/// Record refusals for the report, and clear them for admitted layers.
async fn record(state: &BridgeState, refused: &[(String, Refusal)], admitted: &[String]) {
    if refused.is_empty() && admitted.is_empty() {
        return;
    }
    let mut residency = state.residency.state.lock().await;
    let mut changed = false;
    for (layer_id, reason) in refused {
        changed |= residency.shadow.refusals.insert(layer_id.clone(), *reason) != Some(*reason);
    }
    for layer_id in admitted {
        changed |= residency.shadow.refusals.remove(layer_id).is_some();
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

/// [`admit`] for a caller that holds `volume_operations`.
pub(crate) async fn admit_held(state: &BridgeState, target: &AdmitTarget) -> AdmitOutcome {
    let mut outcome = AdmitOutcome::default();
    let (requests, volumes) = requests_for(state, target).await;
    let uploads = matches!(target, AdmitTarget::Fronts);
    for request in &requests {
        for _ in 0..MAX_PASSES {
            let Some(plan) = plan_now(state, request).await else {
                return outcome;
            };
            let refused: Vec<(String, Refusal)> = plan
                .refuse
                .iter()
                .map(|refused| (refused.layer_id.clone(), refused.reason))
                .collect();
            record(state, &refused, &[]).await;
            outcome.refused.extend(refused);

            let mut freed = 0;
            for victim in &plan.evict {
                if evict(state, &victim.kind).await {
                    freed += 1;
                }
            }
            outcome.evicted += freed;
            if !uploads {
                break;
            }

            let mut admitted = Vec::new();
            let mut pressed = false;
            for admission in &plan.admit {
                let Some(volume_id) = volumes.get(&admission.layer_id) else {
                    continue;
                };
                match ensure(state, &admission.layer_id, volume_id).await {
                    Ok(()) => admitted.push(admission.layer_id.clone()),
                    Err(BridgeError::GpuBudgetExceeded { .. }) => {
                        // The estimate was off: plan again from what is resident now.
                        pressed = true;
                        break;
                    }
                    Err(error) => {
                        warn!(
                            "Residency: upload of '{}' failed: {error:?}",
                            admission.layer_id
                        );
                        let failed = (admission.layer_id.clone(), Refusal::UploadFailed);
                        record(state, std::slice::from_ref(&failed), &[]).await;
                        outcome.refused.push(failed);
                    }
                }
            }
            outcome.uploaded += admitted.len();
            record(state, &[], &admitted).await;
            // Nothing more to do, or nothing freed that a new plan could use.
            if !pressed || (freed == 0 && admitted.is_empty()) {
                break;
            }
        }
    }
    outcome
}
