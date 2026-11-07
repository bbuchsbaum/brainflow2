//! R5b of `docs/plans/gpu-residency-r5-plan-2026-11.md`: the demand the UI
//! declares for each frame, a snapshot of the bridge as [`ResidencyFacts`], and
//! the residency report with its `residency-changed` event.
//!
//! The UI still owns admission and eviction (the report's `owner` is `ui`).
//! The ledger only records demand; [`super::shadow`] compares the UI's choices
//! with what the policy would have done.
//!
//! Locking: `BridgeState::residency` sits after the `RenderLoopService` and
//! nothing else is acquired while it is held, so it can be taken under the
//! service (the render path) or with no other lock. A snapshot takes its own
//! locks first and drops them before the residency lock is taken.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::demand::{
    DemandLedger, DemandedLayer, Epoch, FrameDemand, FrameId, LedgerOutcome, Millis, PinReason,
    Priority,
};
use super::policy::{
    draw_set, residency_key, CachedMember, Capacity, Refusal, ResidencyFacts, ResidentFacts,
    TextureBackend,
};
use super::admit::{admit, AdmitTarget};
use super::config::backend_residency_enabled;
use super::shadow::ShadowLedger;
use crate::*;

/// How often the report is checked for changes: events are coalesced to this.
pub(crate) const RESIDENCY_EVENT_INTERVAL: Duration = Duration::from_millis(50);

// --- Wire types (generated into `@brainflow/api`; no slots, indices or
// generations: the UI never names a texture) ---

/// Whether a frame is on screen.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ResidencyPriority {
    Front,
    Background,
}

/// Why a layer must stay resident whatever its frame's priority.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ResidencyPin {
    StudioPane,
    SegmentationSession,
    EditableDocument,
}

/// One layer of a frame's demand.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ResidencyDemandedLayer {
    pub layer_id: String,
    pub volume_id: String,
    #[serde(default)]
    pub pin: Option<ResidencyPin>,
}

/// A frame's whole demand, as the UI publishes it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ResidencyFrameDemand {
    /// Per-frame revision; must increase with every message for the frame.
    #[ts(type = "number")]
    pub epoch: u64,
    pub priority: ResidencyPriority,
    /// Layers the frame draws, bottom of the stack first.
    pub layers: Vec<ResidencyDemandedLayer>,
    /// Hidden pinned layers kept resident without drawing.
    #[serde(default)]
    pub held: Vec<ResidencyDemandedLayer>,
}

/// Whether a demand update took effect (`false`: its epoch was stale).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ResidencyDemandResult {
    pub applied: bool,
}

/// Who decides admission and eviction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ResidencyOwner {
    Ui,
    Backend,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ResidencyLayerState {
    Resident,
    /// Reserved for the backend owner (R5c); not reported in R5b.
    Uploading,
    Refused,
    /// Demanded but not resident.
    Evicted,
    /// Resident but demanded by no frame.
    Undemanded,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ResidencyRefusal {
    FrontExceedsBudget,
    HeldByPinned,
    DrawCap,
    VolumeMissing,
    UploadFailed,
    OversizedRequest,
}

impl From<Refusal> for ResidencyRefusal {
    fn from(refusal: Refusal) -> Self {
        match refusal {
            Refusal::FrontExceedsBudget => Self::FrontExceedsBudget,
            Refusal::HeldByPinned => Self::HeldByPinned,
            Refusal::DrawCap => Self::DrawCap,
            Refusal::VolumeMissing => Self::VolumeMissing,
            Refusal::UploadFailed => Self::UploadFailed,
            Refusal::OversizedRequest => Self::OversizedRequest,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ResidencyLayerReport {
    pub layer_id: String,
    pub state: ResidencyLayerState,
    /// Logical payload bytes (with cached 4D members for an undemanded layer).
    #[ts(type = "number")]
    pub bytes: u64,
    /// Frames that demand the layer, in frame-id order.
    pub frames: Vec<String>,
    pub refusal: Option<ResidencyRefusal>,
}

/// The backend's view of residency, sent as `residency-changed` and returned
/// by `get_residency_state`. Every report takes the next `seq`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ResidencyReport {
    #[ts(type = "number")]
    pub seq: u64,
    pub owner: ResidencyOwner,
    /// `None` in the fixed-slot fallback.
    #[ts(type = "number | null")]
    pub budget_bytes: Option<u64>,
    #[ts(type = "number")]
    pub used_bytes: u64,
    /// Distinct textures one draw binds.
    pub binding_capacity: u32,
    /// Resident bytes no frame demands; pressure evicts these first.
    #[ts(type = "number")]
    pub undemanded_bytes: u64,
    /// By layer id.
    pub layers: Vec<ResidencyLayerReport>,
}

// --- State ---

/// The residency owner's state: one per bridge.
pub(crate) struct Residency {
    origin: Instant,
    pub(crate) state: Mutex<ResidencyState>,
    /// A frame failed to allocate a layer's texture: the backend owner (R5c)
    /// runs an admission on its next tick.
    admission_wanted: std::sync::atomic::AtomicBool,
    /// Whether the backend owns admission and eviction (R5c): the
    /// `BRAINFLOW_BACKEND_RESIDENCY` flag, per bridge so tests can set it.
    backend_owner: std::sync::atomic::AtomicBool,
}

pub(crate) struct ResidencyState {
    pub(crate) ledger: DemandLedger,
    /// Bumped by every applied demand change and every change of a recorded
    /// refusal: what the report shows beyond the texture store.
    revision: u64,
    /// The last report's sequence number.
    seq: u64,
    /// The store and bridge revisions the last report reflected.
    reported: Option<((usize, u64), u64)>,
    /// Ticks left during which reports are still rebuilt after a change.
    settle: u8,
    /// The last report sent, numbered 0, so an unchanged rebuild sends nothing.
    last_body: Option<ResidencyReport>,
    pub(crate) shadow: ShadowLedger,
}

impl Residency {
    pub(crate) fn new() -> Self {
        Self {
            origin: Instant::now(),
            state: Mutex::new(ResidencyState {
                ledger: DemandLedger::new(),
                revision: 0,
                seq: 0,
                reported: None,
                settle: 0,
                last_body: None,
                shadow: ShadowLedger::default(),
            }),
            admission_wanted: std::sync::atomic::AtomicBool::new(false),
            backend_owner: std::sync::atomic::AtomicBool::new(backend_residency_enabled()),
        }
    }

    /// Whether the backend owns admission and eviction (R5c).
    pub(crate) fn backend_owner(&self) -> bool {
        self.backend_owner
            .load(std::sync::atomic::Ordering::Acquire)
    }

    /// Make the backend the owner, or not: tests, which cannot set the flag
    /// per bridge through the environment.
    #[cfg(test)]
    pub(crate) fn set_backend_owner(&self, owner: bool) {
        self.backend_owner
            .store(owner, std::sync::atomic::Ordering::Release);
    }

    /// Who owns eviction, for the report.
    pub(crate) fn owner(&self) -> ResidencyOwner {
        if self.backend_owner() {
            ResidencyOwner::Backend
        } else {
            ResidencyOwner::Ui
        }
    }

    /// Ask for an admission on the next residency tick (R5c).
    pub(crate) fn want_admission(&self) {
        self.admission_wanted
            .store(true, std::sync::atomic::Ordering::Release);
    }

    /// Take the request made by [`Self::want_admission`], if any.
    fn take_admission_request(&self) -> bool {
        self.admission_wanted
            .swap(false, std::sync::atomic::Ordering::AcqRel)
    }

    /// Milliseconds since the bridge started: the policy's clock.
    pub(crate) fn now(&self) -> Millis {
        self.millis(Instant::now())
    }

    fn millis(&self, at: Instant) -> Millis {
        at.saturating_duration_since(self.origin).as_millis() as Millis
    }
}

fn pin_reason(pin: ResidencyPin) -> PinReason {
    match pin {
        ResidencyPin::StudioPane => PinReason::StudioPane,
        ResidencyPin::SegmentationSession => PinReason::SegmentationSession,
        ResidencyPin::EditableDocument => PinReason::EditableDocument,
    }
}

fn demanded_layer(layer: ResidencyDemandedLayer) -> DemandedLayer {
    DemandedLayer {
        layer_id: layer.layer_id,
        volume_id: layer.volume_id,
        pin: layer.pin.map(pin_reason),
    }
}

impl ResidencyState {
    /// Something the report shows changed outside the texture store.
    pub(crate) fn changed(&mut self) {
        self.revision += 1;
    }

    pub(crate) fn revision(&self) -> u64 {
        self.revision
    }

    /// Record a frame's demand. A Front frame is in front now; a Background
    /// frame keeps the time it was last in front.
    pub(crate) fn set_demand(
        &mut self,
        frame: FrameId,
        demand: ResidencyFrameDemand,
        now: Millis,
    ) -> LedgerOutcome {
        let priority = match demand.priority {
            ResidencyPriority::Front => Priority::Front,
            ResidencyPriority::Background => Priority::Background,
        };
        let last_front_at = match priority {
            Priority::Front => now,
            Priority::Background => {
                self.ledger
                    .get(&frame)
                    .map_or(0, |previous| match previous.priority {
                        Priority::Front => now,
                        Priority::Background => previous.last_front_at,
                    })
            }
        };
        let outcome = self.ledger.set(
            frame,
            FrameDemand {
                epoch: Epoch(demand.epoch),
                priority,
                layers: demand.layers.into_iter().map(demanded_layer).collect(),
                held: demand.held.into_iter().map(demanded_layer).collect(),
                last_front_at,
            },
        );
        if outcome == LedgerOutcome::Applied {
            self.changed();
        }
        outcome
    }

    pub(crate) fn clear_demand(&mut self, frame: &FrameId, epoch: u64) -> LedgerOutcome {
        let outcome = self.ledger.clear(frame, Epoch(epoch));
        if outcome == LedgerOutcome::Applied {
            self.changed();
        }
        outcome
    }
}

// --- Snapshot ---

/// [`ResidencyFacts`] plus the byte figures the report shows.
pub(crate) struct Snapshot {
    pub facts: ResidencyFacts,
    pub budget_bytes: Option<u64>,
    pub used_bytes: u64,
}

/// A snapshot taken earlier: the policy's [`TextureBackend`] for the bridge.
/// The facts are read from the service and the bridge maps each time, never
/// mirrored, so they cannot drift.
pub(crate) struct BridgeTextureBackend(pub ResidencyFacts);

impl TextureBackend for BridgeTextureBackend {
    fn facts(&self) -> ResidencyFacts {
        self.0.clone()
    }
}

/// Read what is resident now. Takes `resident_image_sets`, `volume_registry`
/// and the leaf maps in lock order, with `service` held by the caller (taken
/// as `&mut` only so the future stays `Send`: the service is read, not
/// changed). An upload still in flight is not yet in `layer_slots`, but its
/// texture is in the store, so it counts in `used`.
pub(crate) async fn snapshot(
    state: &BridgeState,
    residency: &Residency,
    service: &mut RenderLoopService,
) -> Snapshot {
    // Every lock first: no shared borrow of the service may live across an await.
    let sets = state.resident_image_sets.lock().await;
    let registry = state.volume_registry.lock().await;
    let layer_map = state.layer_slots.lock().await;
    let layer_volumes = state.layer_to_volume_map.lock().await;
    let last_drawn = state.layer_last_drawn.lock().await;
    let service: &RenderLoopService = service;

    let metrics = service.residency_metrics();
    let capacity = match metrics.budget_bytes {
        Some(budget) => Capacity::Bytes {
            budget,
            used: metrics.used_bytes,
        },
        None => Capacity::Slots {
            total: metrics
                .resident_limit
                .map(u64::from)
                .unwrap_or_else(|| u64::from(service.runtime_texture_capacity())),
            used: metrics.resident_count as u64,
        },
    };
    let slot_bytes = |index: u32| {
        service
            .multi_texture_manager
            .as_ref()
            .map_or(0, |manager| manager.slot_bytes(index))
    };

    // Cached 4D members by layer id (rings are keyed by layer id).
    let cached: HashMap<String, Vec<CachedMember>> = sets
        .iter()
        .map(|(layer_id, resident)| {
            let members = resident
                .ring
                .resident_members()
                .into_iter()
                .filter(|&member| member != resident.current_member)
                .filter_map(|member| {
                    let index = resident.ring.slot_of(member)?;
                    let handle = resident.handle_of(index)?;
                    service.is_slot_current(handle).then(|| CachedMember {
                        member,
                        bytes: slot_bytes(index),
                        last_used: resident.ring.last_used_of(member).unwrap_or(0),
                    })
                })
                .collect();
            (layer_id.clone(), members)
        })
        .collect();

    let mut volume_bytes = HashMap::new();
    let mut time_series_volumes = HashSet::new();
    for (volume_id, entry) in &registry.volumes {
        let time_series = volume_sendable_uses_timepoint(&entry.data);
        if time_series {
            time_series_volumes.insert(volume_id.clone());
        }
        let voxels: u64 = get_spatial_dims_from_volume(&entry.data)
            .iter()
            .take(3)
            .map(|&d| d as u64)
            .product();
        let labels = !time_series && entry.metadata.path.starts_with("atlas:");
        volume_bytes.insert(
            volume_id.clone(),
            voxels * image_set::gpu_bytes_per_voxel(&entry.data, labels),
        );
    }

    let mut residents = Vec::new();
    for (key, handle) in layer_map.iter() {
        if !service.is_slot_current(handle) {
            continue;
        }
        // A slot's mask is released with it, so evicting it frees both.
        let bytes = slot_bytes(handle.index())
            + service
                .multi_texture_manager
                .as_ref()
                .map_or(0, |manager| manager.mask_bytes(handle.index()));
        // The real size beats the estimate for a volume that is resident.
        if let Some(volume_id) = layer_volumes.get(key) {
            if !time_series_volumes.contains(volume_id) {
                volume_bytes.insert(volume_id.clone(), bytes);
            }
        }
        residents.push(ResidentFacts {
            key: key.to_owned(),
            bytes,
            last_drawn: last_drawn.get(key).map_or(0, |&at| residency.millis(at)),
            upload_in_flight: false,
            cached: cached.get(key).cloned().unwrap_or_default(),
        });
    }
    residents.sort_by(|a, b| a.key.cmp(&b.key));

    Snapshot {
        facts: ResidencyFacts {
            capacity,
            binding_capacity: service.runtime_texture_capacity() as usize,
            row_capacity: service.render_layer_capacity() as usize,
            residents,
            volume_bytes,
            time_series_volumes,
        },
        budget_bytes: metrics.budget_bytes,
        used_bytes: metrics.used_bytes,
    }
}

// --- Report ---

/// Build the report from a snapshot and the ledger. `refusals` are the last
/// typed refusals per layer (cleared when the layer is admitted).
pub(crate) fn build_report(
    seq: u64,
    owner: ResidencyOwner,
    snapshot: &Snapshot,
    ledger: &DemandLedger,
    refusals: &HashMap<String, Refusal>,
) -> ResidencyReport {
    let facts = &snapshot.facts;
    let resident = |key: &str| facts.residents.iter().find(|r| r.key == key);

    let mut layers: BTreeMap<String, ResidencyLayerReport> = BTreeMap::new();
    let mut demanded_keys: HashSet<String> = HashSet::new();
    let mut drawn: HashSet<String> = HashSet::new();
    let mut capped: HashSet<String> = HashSet::new();
    for (frame, demand) in ledger.frames() {
        if demand.priority == Priority::Front {
            let set = draw_set(demand, facts);
            for &(index, _) in &set.drawn {
                drawn.insert(demand.layers[index].layer_id.clone());
            }
            let over = set.over_cap.iter().copied();
            let unfit = set
                .pending
                .iter()
                .filter(|(_, fits)| !fits)
                .map(|&(i, _)| i);
            for index in over.chain(unfit) {
                capped.insert(demand.layers[index].layer_id.clone());
            }
        }
        for layer in demand.layers.iter().chain(&demand.held) {
            let key = residency_key(layer, facts, &[]);
            let found = resident(&key);
            demanded_keys.insert(key);
            let entry =
                layers
                    .entry(layer.layer_id.clone())
                    .or_insert_with(|| ResidencyLayerReport {
                        layer_id: layer.layer_id.clone(),
                        state: ResidencyLayerState::Evicted,
                        bytes: 0,
                        frames: Vec::new(),
                        refusal: None,
                    });
            if !entry.frames.contains(&frame.0) {
                entry.frames.push(frame.0.clone());
            }
            match found {
                Some(found) => {
                    entry.state = ResidencyLayerState::Resident;
                    entry.bytes = found.bytes;
                }
                None if entry.state == ResidencyLayerState::Evicted => {
                    entry.bytes = facts
                        .volume_bytes
                        .get(&layer.volume_id)
                        .copied()
                        .unwrap_or(0);
                }
                None => {}
            }
        }
    }
    for entry in layers.values_mut() {
        if capped.contains(&entry.layer_id) && !drawn.contains(&entry.layer_id) {
            entry.state = ResidencyLayerState::Refused;
            entry.refusal = Some(ResidencyRefusal::DrawCap);
        } else if entry.state == ResidencyLayerState::Evicted {
            if let Some(&refusal) = refusals.get(&entry.layer_id) {
                entry.state = ResidencyLayerState::Refused;
                entry.refusal = Some(refusal.into());
            }
        }
    }

    let mut undemanded_bytes = 0;
    for resident in &facts.residents {
        if demanded_keys.contains(&resident.key) {
            continue;
        }
        let bytes = resident.bytes + resident.cached.iter().map(|m| m.bytes).sum::<u64>();
        undemanded_bytes += bytes;
        layers
            .entry(resident.key.clone())
            .or_insert_with(|| ResidencyLayerReport {
                layer_id: resident.key.clone(),
                state: ResidencyLayerState::Undemanded,
                bytes,
                frames: Vec::new(),
                refusal: None,
            });
    }

    ResidencyReport {
        seq,
        owner,
        budget_bytes: snapshot.budget_bytes,
        used_bytes: snapshot.used_bytes,
        binding_capacity: facts.binding_capacity as u32,
        undemanded_bytes,
        layers: layers.into_values().collect(),
    }
}

/// `set_residency_demand`: record a frame's demand.
pub(crate) async fn set_residency_demand_with(
    state: &BridgeState,
    frame_id: String,
    demand: ResidencyFrameDemand,
) -> ResidencyDemandResult {
    let now = state.residency.now();
    let outcome =
        state
            .residency
            .state
            .lock()
            .await
            .set_demand(FrameId::new(frame_id), demand, now);
    let applied = outcome == LedgerOutcome::Applied;
    // The backend owner (R5c) admits for the new demand before answering, so
    // a tab switch uploads the new front tab's layers without a UI pass.
    if applied && state.residency.backend_owner() {
        admit(state, AdmitTarget::Fronts).await;
    }
    ResidencyDemandResult { applied }
}

/// `clear_residency_demand`: the frame is gone (its tab closed). Its layers
/// become undemanded and stay resident until pressure evicts them (plan §6).
pub(crate) async fn clear_residency_demand_with(
    state: &BridgeState,
    frame_id: String,
    epoch: u64,
) -> ResidencyDemandResult {
    let outcome = state
        .residency
        .state
        .lock()
        .await
        .clear_demand(&FrameId::new(frame_id), epoch);
    ResidencyDemandResult {
        applied: outcome == LedgerOutcome::Applied,
    }
}

/// The current service, cloned out of its slot.
pub(crate) async fn current_service(state: &BridgeState) -> Option<Arc<Mutex<RenderLoopService>>> {
    state.render_loop_service.lock().await.clone()
}

/// Ticks after a change during which the report is still rebuilt and
/// compared: an upload bumps the store revision before its layer mapping
/// lands, and a refusal is recorded only after its request returns.
const SETTLE_TICKS: u8 = 10;

/// A fresh report, taking the next `seq`. `wait`: block on the service lock
/// (a command); otherwise skip when a frame holds it (the event tick).
/// `only_if_changed` (the event tick): nothing when the report is the same as
/// the last one sent, and no rebuild at all once a change has settled.
async fn report(state: &BridgeState, wait: bool, only_if_changed: bool) -> Option<ResidencyReport> {
    let service_arc = current_service(state).await?;
    let mut service = if wait {
        service_arc.lock().await
    } else {
        service_arc.try_lock().ok()?
    };
    let store_revision = service
        .multi_texture_manager
        .as_ref()
        .map_or((0, 0), |manager| manager.residency_revision());
    let key = {
        let mut residency = state.residency.state.lock().await;
        let key = (store_revision, residency.revision);
        if only_if_changed {
            if residency.reported != Some(key) {
                residency.settle = SETTLE_TICKS;
            } else if residency.settle == 0 {
                return None;
            } else {
                residency.settle -= 1;
            }
        }
        key
    };
    let snap = snapshot(state, &state.residency, &mut service).await;
    // Numbered while the service is still held, so a later snapshot always
    // gets the higher `seq`.
    let mut residency = state.residency.state.lock().await;
    residency.reported = Some(key);
    let mut report = build_report(
        0,
        state.residency.owner(),
        &snap,
        &residency.ledger,
        &residency.shadow.refusals,
    );
    if only_if_changed && residency.last_body.as_ref() == Some(&report) {
        return None;
    }
    residency.last_body = Some(report.clone());
    residency.seq += 1;
    report.seq = residency.seq;
    drop(residency);
    drop(service);
    Some(report)
}

/// The report for `get_residency_state`.
pub(crate) async fn residency_state_report(state: &BridgeState) -> BridgeResult<ResidencyReport> {
    report(state, true, false)
        .await
        .ok_or_else(|| BridgeError::ServiceNotInitialized {
            code: 5008,
            details: "GPU rendering service is not initialized. Cannot report residency."
                .to_string(),
        })
}

/// One tick of the `residency-changed` emitter: a report when residency or
/// demand changed since the last one, and open shadow episodes that ran out
/// of time are closed.
pub(crate) async fn residency_tick(state: &BridgeState) -> Option<ResidencyReport> {
    let now = state.residency.now();
    {
        let mut residency = state.residency.state.lock().await;
        let residency = &mut *residency;
        residency.shadow.expire(&residency.ledger, now);
    }
    // A frame could not allocate a layer's texture: make room for the front
    // tabs (R5c). The render path never evicts; this is where it is decided.
    if state.residency.backend_owner() && state.residency.take_admission_request() {
        admit(state, AdmitTarget::Fronts).await;
    }
    report(state, false, true).await
}

impl BridgeState {
    /// Announce residency changes to the UI as `residency-changed`, at most
    /// once per [`RESIDENCY_EVENT_INTERVAL`].
    pub fn start_residency_events_notifying<R: Runtime>(app: tauri::AppHandle<R>) {
        tauri::async_runtime::spawn(async move {
            let mut interval = tokio::time::interval(RESIDENCY_EVENT_INTERVAL);
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                interval.tick().await;
                let state = app.state::<BridgeState>();
                if let Some(report) = residency_tick(state.inner()).await {
                    if let Err(err) = app.emit("residency-changed", &report) {
                        warn!("Could not announce a residency change: {err:?}");
                    }
                }
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::residency::policy::ResidentFacts;

    fn layer(id: &str) -> ResidencyDemandedLayer {
        ResidencyDemandedLayer {
            layer_id: id.into(),
            volume_id: id.into(),
            pin: None,
        }
    }

    fn frame(epoch: u64, priority: ResidencyPriority, ids: &[&str]) -> ResidencyFrameDemand {
        ResidencyFrameDemand {
            epoch,
            priority,
            layers: ids.iter().map(|id| layer(id)).collect(),
            held: Vec::new(),
        }
    }

    fn snapshot_of(residents: &[(&str, u64)], binding_capacity: usize) -> Snapshot {
        Snapshot {
            facts: ResidencyFacts {
                capacity: Capacity::Bytes {
                    budget: 100,
                    used: residents.iter().map(|r| r.1).sum(),
                },
                binding_capacity,
                row_capacity: 16,
                residents: residents
                    .iter()
                    .map(|&(key, bytes)| ResidentFacts {
                        key: key.into(),
                        bytes,
                        last_drawn: 0,
                        upload_in_flight: false,
                        cached: Vec::new(),
                    })
                    .collect(),
                volume_bytes: HashMap::new(),
                time_series_volumes: HashSet::new(),
            },
            budget_bytes: Some(100),
            used_bytes: residents.iter().map(|r| r.1).sum(),
        }
    }

    fn state_of(report: &ResidencyReport, id: &str) -> ResidencyLayerState {
        report
            .layers
            .iter()
            .find(|l| l.layer_id == id)
            .unwrap_or_else(|| panic!("{id} reported"))
            .state
    }

    #[test]
    fn demand_epochs_monotonic_per_frame() {
        let residency = Residency::new();
        let mut state = residency.state.try_lock().unwrap();
        let tab = FrameId::new("tab-1");
        let front = ResidencyPriority::Front;
        assert_eq!(
            state.set_demand(tab.clone(), frame(2, front, &["a"]), 10),
            LedgerOutcome::Applied
        );
        assert_eq!(
            state.set_demand(tab.clone(), frame(2, front, &["b"]), 11),
            LedgerOutcome::Stale
        );
        assert_eq!(state.clear_demand(&tab, 1), LedgerOutcome::Stale);
        assert_eq!(
            state.set_demand(FrameId::new("tab-2"), frame(1, front, &["c"]), 12),
            LedgerOutcome::Applied,
            "epochs are per frame"
        );
        assert_eq!(state.clear_demand(&tab, 3), LedgerOutcome::Applied);
        assert_eq!(state.revision, 3, "only applied changes count");
    }

    #[test]
    fn background_frame_keeps_the_time_it_was_last_in_front() {
        let residency = Residency::new();
        let mut state = residency.state.try_lock().unwrap();
        let tab = FrameId::new("tab");
        state.set_demand(tab.clone(), frame(1, ResidencyPriority::Front, &["a"]), 100);
        state.set_demand(
            tab.clone(),
            frame(2, ResidencyPriority::Background, &["a"]),
            400,
        );
        assert_eq!(state.ledger.get(&tab).unwrap().last_front_at, 400);
        state.set_demand(
            tab.clone(),
            frame(3, ResidencyPriority::Background, &["a"]),
            900,
        );
        assert_eq!(state.ledger.get(&tab).unwrap().last_front_at, 400);
        let other = FrameId::new("never-front");
        state.set_demand(
            other.clone(),
            frame(1, ResidencyPriority::Background, &["b"]),
            900,
        );
        assert_eq!(state.ledger.get(&other).unwrap().last_front_at, 0);
    }

    #[test]
    fn report_serializes_without_binding_or_slot_fields() {
        let mut ledger = DemandLedger::new();
        ledger.set(
            FrameId::new("tab"),
            FrameDemand {
                epoch: Epoch(1),
                priority: Priority::Front,
                layers: vec![
                    DemandedLayer::new("a", "a"),
                    DemandedLayer::new("gone", "gone"),
                ],
                held: Vec::new(),
                last_front_at: 0,
            },
        );
        let snap = snapshot_of(&[("a", 10), ("stray", 7)], 13);
        let mut refusals = HashMap::new();
        refusals.insert("gone".to_string(), Refusal::FrontExceedsBudget);
        let report = build_report(4, ResidencyOwner::Ui, &snap, &ledger, &refusals);
        let json = serde_json::to_value(&report).unwrap();

        fn keys(value: &serde_json::Value, out: &mut Vec<String>) {
            match value {
                serde_json::Value::Object(map) => {
                    for (key, child) in map {
                        out.push(key.clone());
                        keys(child, out);
                    }
                }
                serde_json::Value::Array(items) => items.iter().for_each(|item| keys(item, out)),
                _ => {}
            }
        }
        let mut all = Vec::new();
        keys(&json, &mut all);
        for key in &all {
            for banned in ["slot", "index", "generation", "texture", "handle"] {
                assert!(!key.contains(banned), "report field {key} names a texture");
            }
        }
        assert_eq!(json["owner"], "ui");
        assert_eq!(json["seq"], 4);
        assert_eq!(report.undemanded_bytes, 7);
        assert_eq!(state_of(&report, "a"), ResidencyLayerState::Resident);
        assert_eq!(state_of(&report, "stray"), ResidencyLayerState::Undemanded);
        let gone = report.layers.iter().find(|l| l.layer_id == "gone").unwrap();
        assert_eq!(gone.state, ResidencyLayerState::Refused);
        assert_eq!(gone.refusal, Some(ResidencyRefusal::FrontExceedsBudget));
        assert_eq!(gone.frames, ["tab"]);
    }

    #[test]
    fn report_marks_layers_past_the_binding_capacity_draw_cap() {
        let mut ledger = DemandLedger::new();
        ledger.set(
            FrameId::new("tab"),
            FrameDemand {
                epoch: Epoch(1),
                priority: Priority::Front,
                layers: ["a", "b", "c"]
                    .iter()
                    .map(|id| DemandedLayer::new(*id, *id))
                    .collect(),
                held: Vec::new(),
                last_front_at: 0,
            },
        );
        // Two bindings: `c` is resident but over the cap.
        let snap = snapshot_of(&[("a", 1), ("b", 1), ("c", 1)], 2);
        let report = build_report(1, ResidencyOwner::Ui, &snap, &ledger, &HashMap::new());
        assert_eq!(state_of(&report, "a"), ResidencyLayerState::Resident);
        let c = report.layers.iter().find(|l| l.layer_id == "c").unwrap();
        assert_eq!(c.state, ResidencyLayerState::Refused);
        assert_eq!(c.refusal, Some(ResidencyRefusal::DrawCap));
    }

    #[test]
    fn wire_demand_parses_without_optional_fields() {
        let demand: ResidencyFrameDemand = serde_json::from_str(
            r#"{"epoch":3,"priority":"front","layers":[{"layer_id":"a","volume_id":"v"}]}"#,
        )
        .unwrap();
        assert_eq!(demand.priority, ResidencyPriority::Front);
        assert!(demand.held.is_empty());
        assert_eq!(demand.layers[0].pin, None);
        let pinned: ResidencyDemandedLayer =
            serde_json::from_str(r#"{"layer_id":"a","volume_id":"v","pin":"editable_document"}"#)
                .unwrap();
        assert_eq!(pinned.pin, Some(ResidencyPin::EditableDocument));
    }
}
