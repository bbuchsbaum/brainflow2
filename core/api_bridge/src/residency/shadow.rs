//! Shadow comparison (R5b; plan §4): while the UI owns eviction, record what it
//! does under pressure and what the policy would have done, without acting.
//!
//! **Episodes.** A typed, retryable 6008 refusal of `request_layer_gpu_resources`
//! opens one for the requesting layer, and the policy plans
//! `Request::Layer` from a snapshot taken then. The UI's actions follow
//! (`reclaim_cached_image_slots`, `release_layer_gpu_resources` with
//! `for_upload`) until the layer's request succeeds, fails otherwise, or
//! [`EPISODE_TIMEOUT_MS`] pass. Closing logs one JSON line on tracing target
//! `residency.shadow`; `tools/residency_shadow_report.mjs` tabulates them.
//!
//! **Draw cap.** Each frame that a Front frame's demand matches is compared
//! with the render's OverCap skips ([`check_draw_cap`]).

use std::collections::{BTreeSet, HashMap, HashSet, VecDeque};

use serde::Serialize;

use super::demand::{FrameDemand, Millis, Priority};
use super::manager::{current_service, snapshot, BridgeTextureBackend};
use super::policy::{
    draw_set, eviction_candidates, plan, Plan, Refusal, Request, TextureBackend, Tier, Victim,
    VictimKind,
};
use crate::*;

/// An episode the UI has not resolved by then is closed as a timeout.
pub(crate) const EPISODE_TIMEOUT_MS: Millis = 5_000;
/// Closed episodes kept for inspection (tests, diagnostics).
const KEEP_CLOSED: usize = 64;
const TARGET: &str = "residency.shadow";

/// One eviction, as either side chose it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum ShadowVictim {
    /// A cached 4D member. The UI's reclaim does not say whose.
    Cached {
        #[serde(skip_serializing_if = "Option::is_none")]
        layer: Option<String>,
    },
    /// A whole residency.
    Layer {
        id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        tier: Option<u8>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Outcome {
    Admitted,
    Failed,
    Timeout,
}

/// A closed episode: the JSON line logged for it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct EpisodeRecord {
    pub ep: u64,
    pub requester: String,
    pub req_bytes: u64,
    pub free: u64,
    pub policy: Vec<ShadowVictim>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub policy_refusal: Option<String>,
    pub ui: Vec<ShadowVictim>,
    pub outcome: Outcome,
    pub verdict: String,
}

struct Episode {
    ep: u64,
    requester: String,
    req_bytes: u64,
    free: u64,
    opened: Millis,
    policy: Plan,
    /// Every victim the policy allowed when the episode opened.
    candidates: Vec<Victim>,
    /// Residency keys resident when it opened.
    residents: HashSet<String>,
    ui: Vec<ShadowVictim>,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(crate) struct DrawCapStats {
    pub compared: u64,
    pub mismatched: u64,
}

#[derive(Default)]
pub(crate) struct ShadowLedger {
    next_ep: u64,
    open: Vec<Episode>,
    pub(crate) closed: VecDeque<EpisodeRecord>,
    /// The last typed refusal per layer, for the report; cleared on admission.
    pub(crate) refusals: HashMap<String, Refusal>,
    /// The layer whose request was refused last: the UI makes room for one
    /// upload at a time (`retryBudgetUpload` is serialised), so its evictions
    /// belong to that layer's episode only.
    retrying: Option<String>,
    pub(crate) drawcap: DrawCapStats,
    /// The inputs of the last draw-cap comparison: the same frame drawn again
    /// with nothing changed is not compared (or logged) again.
    drawcap_key: Option<DrawCapKey>,
}

/// Store revision, bridge revision, the drawable layers and the OverCap skips.
type DrawCapKey = ((usize, u64), u64, Vec<String>, Vec<String>);

fn refusal_name(refusal: Refusal) -> &'static str {
    match refusal {
        Refusal::FrontExceedsBudget => "front_exceeds_budget",
        Refusal::HeldByPinned => "held_by_pinned",
        Refusal::DrawCap => "draw_cap",
        Refusal::VolumeMissing => "volume_missing",
        Refusal::UploadFailed => "upload_failed",
        Refusal::OversizedRequest => "oversized_request",
    }
}

fn policy_victim(victim: &Victim) -> ShadowVictim {
    match &victim.kind {
        VictimKind::CachedMember { key, .. } => ShadowVictim::Cached {
            layer: Some(key.clone()),
        },
        VictimKind::Layer { key } => ShadowVictim::Layer {
            id: key.clone(),
            tier: Some(victim.tier as u8),
        },
    }
}

/// Classify an episode (plan §4). The UI's releases of layers that were not
/// resident are no-ops and ignored.
fn verdict(episode: &Episode, outcome: Outcome) -> String {
    let allowed: HashMap<&str, Tier> = episode
        .candidates
        .iter()
        .filter_map(|victim| match &victim.kind {
            VictimKind::Layer { key } => Some((key.as_str(), victim.tier)),
            VictimKind::CachedMember { .. } => None,
        })
        .collect();
    let ui_layers: Vec<&str> = episode
        .ui
        .iter()
        .filter_map(|victim| match victim {
            ShadowVictim::Layer { id, .. } if episode.residents.contains(id) => Some(id.as_str()),
            _ => None,
        })
        .collect();
    if ui_layers.iter().any(|id| !allowed.contains_key(id)) {
        return "unsafe".into();
    }
    let policy_refused = !episode.policy.refuse.is_empty();
    if policy_refused == (outcome == Outcome::Admitted) {
        return "capacity_mismatch".into();
    }
    if policy_refused {
        return "agree".into();
    }
    let ui_cached = episode
        .ui
        .iter()
        .filter(|victim| matches!(victim, ShadowVictim::Cached { .. }))
        .count();
    let mut policy_layers: Vec<&str> = Vec::new();
    let mut policy_tiers: Vec<u8> = Vec::new();
    for victim in &episode.policy.evict {
        policy_tiers.push(victim.tier as u8);
        if let VictimKind::Layer { key } = &victim.kind {
            policy_layers.push(key);
        }
    }
    let policy_cached = policy_tiers
        .iter()
        .filter(|&&tier| tier == Tier::CachedMember as u8)
        .count();
    let same = |a: &[&str], b: &[&str]| {
        a.iter().collect::<BTreeSet<_>>() == b.iter().collect::<BTreeSet<_>>()
    };
    if ui_cached == policy_cached && same(&policy_layers, &ui_layers) {
        return "agree".into();
    }
    let mut ui_tiers: Vec<u8> = std::iter::repeat_n(Tier::CachedMember as u8, ui_cached)
        .chain(ui_layers.iter().map(|id| allowed[id] as u8))
        .collect();
    ui_tiers.sort_unstable();
    policy_tiers.sort_unstable();
    if ui_tiers == policy_tiers {
        return "benign_lru".into();
    }
    "unexplained".into()
}

impl ShadowLedger {
    fn is_open(&self, layer_id: &str) -> bool {
        self.open
            .iter()
            .any(|episode| episode.requester == layer_id)
    }

    /// Record a UI eviction in the episode of the layer the UI is making room
    /// for; an eviction with no such episode open belongs to none.
    pub(crate) fn note_ui_victim(&mut self, victim: ShadowVictim) {
        let Some(retrying) = &self.retrying else {
            return;
        };
        if let Some(episode) = self.open.iter_mut().find(|e| &e.requester == retrying) {
            episode.ui.push(victim);
        }
    }

    fn close(&mut self, layer_id: &str, outcome: Outcome) {
        let Some(position) = self.open.iter().position(|e| e.requester == layer_id) else {
            return;
        };
        let episode = self.open.remove(position);
        if self.retrying.as_deref() == Some(layer_id) {
            self.retrying = None;
        }
        self.finish(episode, outcome);
    }

    fn finish(&mut self, episode: Episode, outcome: Outcome) {
        let record = EpisodeRecord {
            ep: episode.ep,
            requester: episode.requester.clone(),
            req_bytes: episode.req_bytes,
            free: episode.free,
            policy: episode.policy.evict.iter().map(policy_victim).collect(),
            policy_refusal: episode
                .policy
                .refuse
                .first()
                .map(|refused| refusal_name(refused.reason).to_owned()),
            ui: episode.ui.clone(),
            outcome,
            verdict: verdict(&episode, outcome),
        };
        match serde_json::to_string(&record) {
            Ok(line) if record.verdict == "agree" || record.verdict == "benign_lru" => {
                info!(target: TARGET, "{line}")
            }
            Ok(line) => warn!(target: TARGET, "{line}"),
            Err(err) => warn!(target: TARGET, "could not serialize episode: {err}"),
        }
        if self.closed.len() == KEEP_CLOSED {
            self.closed.pop_front();
        }
        self.closed.push_back(record);
    }

    /// Close every episode open for [`EPISODE_TIMEOUT_MS`] or longer.
    pub(crate) fn expire(&mut self, now: Millis) {
        let (stale, open): (Vec<_>, Vec<_>) = std::mem::take(&mut self.open)
            .into_iter()
            .partition(|e| now.saturating_sub(e.opened) >= EPISODE_TIMEOUT_MS);
        self.open = open;
        for episode in stale {
            self.finish(episode, Outcome::Timeout);
        }
    }
}

/// After `request_layer_gpu_resources` for `layer_id`: a typed retryable
/// refusal opens its episode (unless one is open: the UI is still making
/// room); success or any other failure closes it.
pub(crate) async fn note_request(
    state: &BridgeState,
    layer_id: &str,
    volume_id: &str,
    result: &BridgeResult<VolumeLayerGpuInfo>,
) {
    let now = state.residency.now();
    let (requested_bytes, used_bytes, budget_bytes) = match result {
        // 1006: a frame uploaded the layer on its own after the UI made room
        // (the refusal let frames retry it). It is resident either way.
        Ok(_) | Err(BridgeError::Input { code: 1006, .. }) => {
            let mut residency = state.residency.state.lock().await;
            if residency.shadow.refusals.remove(layer_id).is_some() {
                residency.changed();
            }
            residency.shadow.close(layer_id, Outcome::Admitted);
            return;
        }
        Err(BridgeError::GpuBudgetExceeded {
            requested_bytes,
            used_bytes,
            budget_bytes,
            ..
        }) => (*requested_bytes, *used_bytes, *budget_bytes),
        Err(_) => {
            state
                .residency
                .state
                .lock()
                .await
                .shadow
                .close(layer_id, Outcome::Failed);
            return;
        }
    };
    {
        let mut residency = state.residency.state.lock().await;
        let oversized = requested_bytes > budget_bytes;
        let refusal = if oversized {
            Refusal::OversizedRequest
        } else {
            Refusal::FrontExceedsBudget
        };
        if residency
            .shadow
            .refusals
            .insert(layer_id.to_owned(), refusal)
            != Some(refusal)
        {
            residency.changed();
        }
        if oversized {
            // Not retryable: the UI gives up at once.
            residency.shadow.close(layer_id, Outcome::Failed);
            return;
        }
        if residency.shadow.is_open(layer_id) {
            residency.shadow.retrying = Some(layer_id.to_owned());
            return;
        }
    }

    let Some(service_arc) = current_service(state).await else {
        return;
    };
    let snap = {
        let mut service = service_arc.lock().await;
        snapshot(state, &state.residency, &mut service).await
    };
    let mut facts = BridgeTextureBackend(snap.facts).facts();
    // The renderer's own figure for the texture beats the estimate.
    facts
        .volume_bytes
        .insert(volume_id.to_owned(), requested_bytes);

    let mut residency = state.residency.state.lock().await;
    if residency.shadow.is_open(layer_id) {
        residency.shadow.retrying = Some(layer_id.to_owned());
        return;
    }
    let request = Request::Layer {
        layer_id: layer_id.to_owned(),
        volume_id: volume_id.to_owned(),
    };
    let policy = plan(&facts, &residency.ledger, now, &request);
    let candidates = eviction_candidates(&facts, &residency.ledger, now);
    let shadow = &mut residency.shadow;
    shadow.next_ep += 1;
    let episode = Episode {
        ep: shadow.next_ep,
        requester: layer_id.to_owned(),
        req_bytes: requested_bytes,
        free: budget_bytes.saturating_sub(used_bytes),
        opened: now,
        policy,
        candidates,
        residents: facts.residents.iter().map(|r| r.key.clone()).collect(),
        ui: Vec::new(),
    };
    shadow.open.push(episode);
    shadow.retrying = Some(layer_id.to_owned());
}

/// After a UI release made for an upload.
pub(crate) async fn note_release_for_upload(state: &BridgeState, layer_id: &str) {
    state
        .residency
        .state
        .lock()
        .await
        .shadow
        .note_ui_victim(ShadowVictim::Layer {
            id: layer_id.to_owned(),
            tier: None,
        });
}

/// After a UI reclaim of `reclaimed` cached 4D members.
pub(crate) async fn note_reclaim(state: &BridgeState, reclaimed: u32) {
    if reclaimed == 0 {
        return;
    }
    let mut residency = state.residency.state.lock().await;
    for _ in 0..reclaimed {
        residency
            .shadow
            .note_ui_victim(ShadowVictim::Cached { layer: None });
    }
}

#[derive(Serialize)]
struct DrawCapMismatch<'a> {
    drawcap: &'a str,
    policy: &'a BTreeSet<String>,
    render: &'a BTreeSet<String>,
    verdict: &'static str,
}

/// Compare a frame's OverCap skips with the policy's draw cap for the Front
/// frame whose demand lists exactly the frame's drawable layers (`visible`,
/// in draw order). Frames no Front demand matches (a Studio pane, a stale
/// demand) are not compared. Cheap when nothing can be capped, and when
/// nothing changed since the last comparison (each view of a frame, every
/// redraw while a slider moves).
pub(crate) async fn check_draw_cap(
    state: &BridgeState,
    service: &mut RenderLoopService,
    visible: &[String],
    over_cap: &[String],
) {
    let cap = service
        .runtime_texture_capacity()
        .min(service.render_layer_capacity()) as usize;
    if over_cap.is_empty() && visible.len() <= cap {
        return;
    }
    let store_revision = service
        .multi_texture_manager
        .as_ref()
        .map_or((0, 0), |manager| manager.residency_revision());
    let matching: Option<(String, FrameDemand)> = {
        let mut residency = state.residency.state.lock().await;
        let key: DrawCapKey = (
            store_revision,
            residency.revision(),
            visible.to_vec(),
            over_cap.to_vec(),
        );
        if residency.shadow.drawcap_key.as_ref() == Some(&key) {
            return;
        }
        residency.shadow.drawcap_key = Some(key);
        residency
            .ledger
            .frames()
            .into_iter()
            .find(|(_, demand)| {
                demand.priority == Priority::Front
                    && demand.layers.len() == visible.len()
                    && demand
                        .layers
                        .iter()
                        .zip(visible)
                        .all(|(layer, id)| &layer.layer_id == id)
            })
            .map(|(frame, demand)| (frame.0.clone(), demand.clone()))
    };
    let Some((frame, demand)) = matching else {
        return;
    };
    let snap = snapshot(state, &state.residency, service).await;
    let set = draw_set(&demand, &snap.facts);
    let unfit = set
        .pending
        .iter()
        .filter(|(_, fits)| !fits)
        .map(|&(i, _)| i);
    let policy: BTreeSet<String> = set
        .over_cap
        .iter()
        .copied()
        .chain(unfit)
        .map(|index| demand.layers[index].layer_id.clone())
        .collect();
    let render: BTreeSet<String> = over_cap.iter().cloned().collect();

    let mut residency = state.residency.state.lock().await;
    residency.shadow.drawcap.compared += 1;
    if policy != render {
        residency.shadow.drawcap.mismatched += 1;
        let line = DrawCapMismatch {
            drawcap: &frame,
            policy: &policy,
            render: &render,
            verdict: "drawcap_mismatch",
        };
        if let Ok(line) = serde_json::to_string(&line) {
            warn!(target: TARGET, "{line}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::residency::policy::Refused;

    fn layer_victim(key: &str, tier: Tier) -> Victim {
        Victim {
            kind: VictimKind::Layer { key: key.into() },
            tier,
            freed: 1,
        }
    }

    fn episode(policy_evict: Vec<Victim>, candidates: Vec<Victim>, ui: Vec<&str>) -> Episode {
        Episode {
            ep: 1,
            requester: "req".into(),
            req_bytes: 1,
            free: 0,
            opened: 0,
            policy: Plan {
                admit: Vec::new(),
                evict: policy_evict,
                refuse: Vec::new(),
            },
            candidates,
            residents: ["a", "b", "front"].iter().map(|s| s.to_string()).collect(),
            ui: ui
                .into_iter()
                .map(|id| ShadowVictim::Layer {
                    id: id.into(),
                    tier: None,
                })
                .collect(),
        }
    }

    #[test]
    fn verdicts_follow_the_plan_rules() {
        let a = layer_victim("a", Tier::Undemanded);
        let b = layer_victim("b", Tier::Undemanded);
        let candidates = vec![a.clone(), b.clone()];
        let agree = episode(vec![a.clone()], candidates.clone(), vec!["a"]);
        assert_eq!(verdict(&agree, Outcome::Admitted), "agree");
        let lru = episode(vec![a.clone()], candidates.clone(), vec!["b"]);
        assert_eq!(verdict(&lru, Outcome::Admitted), "benign_lru");
        let unsafe_pick = episode(vec![a.clone()], candidates.clone(), vec!["front"]);
        assert_eq!(verdict(&unsafe_pick, Outcome::Admitted), "unsafe");
        let failed = episode(vec![a.clone()], candidates.clone(), vec!["a"]);
        assert_eq!(verdict(&failed, Outcome::Timeout), "capacity_mismatch");
        let mut refused = episode(Vec::new(), candidates.clone(), Vec::new());
        refused.policy.refuse.push(Refused {
            layer_id: "req".into(),
            reason: Refusal::FrontExceedsBudget,
        });
        assert_eq!(verdict(&refused, Outcome::Failed), "agree");
        assert_eq!(verdict(&refused, Outcome::Admitted), "capacity_mismatch");
        let more = episode(vec![a.clone()], candidates, vec!["a", "b"]);
        assert_eq!(verdict(&more, Outcome::Admitted), "unexplained");
        // A release of something not resident was a no-op.
        let noop = episode(vec![a], vec![b], vec!["ghost"]);
        assert_eq!(verdict(&noop, Outcome::Admitted), "unexplained");
    }

    #[test]
    fn ui_victims_go_only_to_the_episode_being_retried() {
        let mut shadow = ShadowLedger::default();
        for requester in ["a", "b"] {
            let mut open = episode(Vec::new(), Vec::new(), Vec::new());
            open.requester = requester.into();
            shadow.open.push(open);
        }
        let victim = |id: &str| ShadowVictim::Layer {
            id: id.into(),
            tier: None,
        };
        shadow.note_ui_victim(victim("nobody-asked"));
        shadow.retrying = Some("a".into());
        shadow.note_ui_victim(victim("x"));
        shadow.note_ui_victim(ShadowVictim::Cached { layer: None });
        let ui = |shadow: &ShadowLedger, requester: &str| {
            shadow
                .open
                .iter()
                .find(|e| e.requester == requester)
                .map(|e| e.ui.len())
        };
        assert_eq!(ui(&shadow, "a"), Some(2));
        assert_eq!(ui(&shadow, "b"), Some(0));
        shadow.close("a", Outcome::Admitted);
        assert_eq!(shadow.retrying, None);
        shadow.note_ui_victim(victim("y"));
        assert_eq!(ui(&shadow, "b"), Some(0), "b has not been refused again yet");
    }

    #[test]
    fn episodes_expire_and_records_are_bounded() {
        let mut shadow = ShadowLedger::default();
        for n in 0..(KEEP_CLOSED as u64 + 3) {
            let mut open = episode(Vec::new(), Vec::new(), Vec::new());
            open.ep = n;
            open.opened = n;
            shadow.open.push(open);
            shadow.expire(n + EPISODE_TIMEOUT_MS);
        }
        assert!(shadow.open.is_empty());
        assert_eq!(shadow.closed.len(), KEEP_CLOSED);
        assert_eq!(shadow.closed.back().unwrap().outcome, Outcome::Timeout);
    }
}
