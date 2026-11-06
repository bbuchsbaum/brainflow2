//! The backend residency policy: from declared demand and a snapshot of what is
//! resident, decide what to admit, what to evict and what to refuse. R5a of
//! `docs/plans/gpu-residency-r5-plan-2026-11.md`. Pure: it reads a
//! [`ResidencyFacts`] snapshot and returns a [`Plan`]; executing the plan (R5c)
//! is someone else's job.
//!
//! Two limits apply:
//! - **Capacity** is global: the logical byte budget, or the slot count in the
//!   fixed-slot fallback (each texture then costs one unit).
//! - **Bindings** are per frame: a draw binds at most `binding_capacity`
//!   distinct textures in at most `row_capacity` rows. [`draw_set`] copies the
//!   render-time rule (`texture_admitted` and the row cap in
//!   `prepare_frontend_layers_for_render`), so only the layers a frame can
//!   actually draw are admitted or protected on its behalf.
//!
//! Eviction order, ties broken by residency key (then member index):
//! 1. cached (prefetched, not displayed) 4D ring members, least recently used;
//! 2. undemanded residents, least recently drawn;
//! 3. residents demanded only by Background frames, oldest `last_front_at`
//!    first; a frame in front within [`RECENT_FRONT_MS`] ranks last.
//!
//! Never evicted: textures a Front frame draws, pinned layers, a ring's
//! displayed member (only cached members are tier 1), and uploads in flight.

use std::collections::{HashMap, HashSet};

use super::demand::{DemandLedger, DemandedLayer, FrameDemand, FrameId, Millis, Priority};

/// A Background frame that was in front this recently ranks last in tier 3,
/// so a quick tab flip does not evict what the user just looked at.
pub(crate) const RECENT_FRONT_MS: Millis = 3_000;

/// The global capacity, with the amount in use.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Capacity {
    /// Logical payload byte budget.
    Bytes { budget: u64, used: u64 },
    /// Fixed-slot fallback: every texture, ring members included, costs 1.
    Slots { total: u64, used: u64 },
}

impl Capacity {
    fn limit(self) -> u64 {
        match self {
            Self::Bytes { budget, .. } => budget,
            Self::Slots { total, .. } => total,
        }
    }

    fn used(self) -> u64 {
        match self {
            Self::Bytes { used, .. } | Self::Slots { used, .. } => used,
        }
    }

    /// What a texture of `bytes` costs in this capacity's unit.
    fn cost(self, bytes: u64) -> u64 {
        match self {
            Self::Bytes { .. } => bytes,
            Self::Slots { .. } => 1,
        }
    }
}

/// A prefetched 4D member that its ring holds but does not display.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CachedMember {
    pub member: usize,
    pub bytes: u64,
    pub last_used: Millis,
}

/// One resident texture, keyed as `layer_slots` keys it: by layer id, or by
/// volume id for a layer that is keyed by its volume.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResidentFacts {
    pub key: String,
    /// Bytes of the texture drawn (a ring's displayed member).
    pub bytes: u64,
    pub last_drawn: Millis,
    pub upload_in_flight: bool,
    /// Cached members of the key's 4D ring; empty without a ring.
    pub cached: Vec<CachedMember>,
}

/// A snapshot of the backend, taken under its locks.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResidencyFacts {
    pub capacity: Capacity,
    pub binding_capacity: usize,
    pub row_capacity: usize,
    pub residents: Vec<ResidentFacts>,
    /// Payload bytes of one texture of each loaded volume.
    pub volume_bytes: HashMap<String, u64>,
    /// Volumes with a time axis: their layers draw only their own residency.
    pub time_series_volumes: HashSet<String>,
}

/// Where a plan's facts come from: the bridge in R5b, a fake in tests.
pub(crate) trait TextureBackend {
    fn facts(&self) -> ResidencyFacts;
}

/// What to plan for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Request {
    /// Make a frame's drawable layers resident.
    Frame(FrameId),
    /// Make one layer resident (an upload the UI asked for).
    Layer { layer_id: String, volume_id: String },
}

/// Why a layer was not admitted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Refusal {
    /// The texture does not fit even after every allowed eviction.
    FrontExceedsBudget,
    /// It would fit only by evicting pinned layers.
    HeldByPinned,
    /// The frame's draw already binds its capacity of textures (or rows).
    DrawCap,
    /// No volume is loaded for the layer.
    VolumeMissing,
    /// The upload itself failed; reported by the executor (R5c), not by [`plan`].
    #[allow(dead_code)]
    UploadFailed,
    /// The texture alone exceeds the whole capacity.
    OversizedRequest,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Refused {
    pub layer_id: String,
    pub reason: Refusal,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Admission {
    pub layer_id: String,
    pub key: String,
    /// In the capacity's unit.
    pub cost: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Tier {
    CachedMember = 1,
    Undemanded = 2,
    BackgroundOnly = 3,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) enum VictimKind {
    /// One cached member of `key`'s ring.
    CachedMember { key: String, member: usize },
    /// The whole residency of `key`, with what remains of its ring.
    Layer { key: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Victim {
    pub kind: VictimKind,
    pub tier: Tier,
    /// In the capacity's unit.
    pub freed: u64,
}

/// Evictions run in order, then uploads in order (bottom of the stack first).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct Plan {
    pub admit: Vec<Admission>,
    pub evict: Vec<Victim>,
    pub refuse: Vec<Refused>,
}

/// A frame's layers as drawn with what is resident now: the protective view
/// used to decide who holds a texture.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct DrawSet {
    /// `(index into the frame's layers, residency key)`, bottom first.
    pub drawn: Vec<(usize, String)>,
    /// Resident layers past the binding or row capacity.
    pub over_cap: Vec<usize>,
    /// Layers with nothing resident, with whether a new texture would still
    /// fit the draw at their position. They take no row or binding here: the
    /// renderer skips a layer whose upload fails, so counting them could only
    /// leave a resident layer unprotected.
    pub pending: Vec<(usize, bool)>,
}

impl DrawSet {
    fn keys(&self) -> impl Iterator<Item = &str> {
        self.drawn.iter().map(|(_, key)| key.as_str())
    }
}

/// The residency a layer draws: its own, else (outside a time series) the one
/// recorded under its volume id, else the one it would upload under its own id.
/// The same lookup as `prepare_frontend_layers_for_render`. `planned` holds keys
/// uploaded earlier in the same frame, which the renderer sees as resident.
pub(crate) fn residency_key(
    layer: &DemandedLayer,
    facts: &ResidencyFacts,
    planned: &[String],
) -> String {
    let resident = |key: &str| {
        planned.iter().any(|k| k == key) || facts.residents.iter().any(|r| r.key == key)
    };
    if !resident(&layer.layer_id)
        && layer.volume_id != layer.layer_id
        && !facts.time_series_volumes.contains(&layer.volume_id)
        && resident(&layer.volume_id)
    {
        return layer.volume_id.clone();
    }
    layer.layer_id.clone()
}

fn is_resident(facts: &ResidencyFacts, key: &str) -> bool {
    facts.residents.iter().any(|r| r.key == key)
}

/// Which of a frame's resident layers fit one draw: rows up to `row_capacity`,
/// and a new texture only while fewer than `binding_capacity` are bound. Layers
/// sharing a texture count once. Layers with nothing resident are `pending`.
pub(crate) fn draw_set(demand: &FrameDemand, facts: &ResidencyFacts) -> DrawSet {
    let mut set = DrawSet::default();
    let mut bound: Vec<String> = Vec::new();
    for (index, layer) in demand.layers.iter().enumerate() {
        let key = residency_key(layer, facts, &[]);
        let rows_full = set.drawn.len() >= facts.row_capacity;
        let bindings_full = !bound.contains(&key) && bound.len() >= facts.binding_capacity;
        if !is_resident(facts, &key) {
            set.pending.push((index, !rows_full && !bindings_full));
            continue;
        }
        if rows_full || bindings_full {
            set.over_cap.push(index);
            continue;
        }
        if !bound.contains(&key) {
            bound.push(key.clone());
        }
        set.drawn.push((index, key));
    }
    set
}

/// Who holds each key, derived from the ledger.
#[derive(Debug, Default)]
struct Holders {
    /// Drawn by a Front frame.
    front: HashSet<String>,
    /// Held by a pinned layer of any frame.
    pinned: HashSet<String>,
    /// Drawn by a Background frame: the newest `last_front_at` among them.
    background: HashMap<String, Millis>,
    /// Layer ids that cannot draw in some frame that lists them.
    blocked: HashSet<String>,
    /// Layer ids that draw, or could, in some frame that lists them.
    fits: HashSet<String>,
    /// Keys some frame draws.
    drawn: HashSet<String>,
}

fn holders(ledger: &DemandLedger, facts: &ResidencyFacts) -> Holders {
    let mut holders = Holders::default();
    for (_, demand) in ledger.frames() {
        let set = draw_set(demand, facts);
        for key in set.keys() {
            holders.drawn.insert(key.to_owned());
            match demand.priority {
                Priority::Front => {
                    holders.front.insert(key.to_owned());
                }
                Priority::Background => {
                    let at = holders.background.entry(key.to_owned()).or_insert(0);
                    *at = (*at).max(demand.last_front_at);
                }
            }
        }
        for &index in &set.over_cap {
            holders
                .blocked
                .insert(demand.layers[index].layer_id.clone());
        }
        for &(index, fits) in &set.pending {
            let id = demand.layers[index].layer_id.clone();
            if fits {
                holders.fits.insert(id);
            } else {
                holders.blocked.insert(id);
            }
        }
        for &(index, _) in &set.drawn {
            holders.fits.insert(demand.layers[index].layer_id.clone());
        }
        let pinned = demand.layers.iter().filter(|layer| layer.pin.is_some());
        for layer in pinned.chain(&demand.held) {
            holders.pinned.insert(residency_key(layer, facts, &[]));
        }
    }
    holders
}

/// The plan's running view of the backend as it picks victims.
struct Simulation<'a> {
    facts: &'a ResidencyFacts,
    holders: Holders,
    used: u64,
    /// Keys the plan has admitted or must keep: never victims.
    keep: HashSet<String>,
    evicted: HashSet<String>,
    taken_members: HashSet<(String, usize)>,
    now: Millis,
}

impl Simulation<'_> {
    fn cost(&self, bytes: u64) -> u64 {
        self.facts.capacity.cost(bytes)
    }

    /// Never a victim: drawn by a Front frame, pinned, uploading, or kept.
    fn protected(&self, resident: &ResidentFacts) -> bool {
        resident.upload_in_flight
            || self.holders.front.contains(&resident.key)
            || self.holders.pinned.contains(&resident.key)
            || self.keep.contains(&resident.key)
    }

    fn live(&self) -> impl Iterator<Item = &ResidentFacts> {
        self.facts
            .residents
            .iter()
            .filter(|resident| !self.evicted.contains(&resident.key))
    }

    /// What evicting `resident` whole frees now: its texture and the members
    /// of its ring not already taken.
    fn layer_freed(&self, resident: &ResidentFacts) -> u64 {
        let members: u64 = resident
            .cached
            .iter()
            .filter(|member| {
                !self
                    .taken_members
                    .contains(&(resident.key.clone(), member.member))
            })
            .map(|member| self.cost(member.bytes))
            .sum();
        self.cost(resident.bytes) + members
    }

    /// Every allowed victim, in eviction order.
    fn candidates(&self) -> Vec<Victim> {
        let mut members: Vec<(Millis, &str, usize, u64)> = self
            .live()
            .filter(|resident| !resident.upload_in_flight)
            .flat_map(|resident| {
                resident
                    .cached
                    .iter()
                    .filter(|member| {
                        !self
                            .taken_members
                            .contains(&(resident.key.clone(), member.member))
                    })
                    .map(move |member| {
                        (
                            member.last_used,
                            resident.key.as_str(),
                            member.member,
                            member.bytes,
                        )
                    })
            })
            .collect();
        members.sort();

        let mut undemanded: Vec<(Millis, &ResidentFacts)> = Vec::new();
        let mut background: Vec<((bool, Millis), &ResidentFacts)> = Vec::new();
        for resident in self.live().filter(|resident| !self.protected(resident)) {
            if let Some(&at) = self.holders.background.get(&resident.key) {
                let recent = self.now.saturating_sub(at) < RECENT_FRONT_MS;
                background.push(((recent, at), resident));
            } else if !self.holders.drawn.contains(&resident.key) {
                undemanded.push((resident.last_drawn, resident));
            }
        }
        undemanded.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.key.cmp(&b.1.key)));
        background.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.key.cmp(&b.1.key)));

        let mut victims: Vec<Victim> = members
            .into_iter()
            .map(|(_, key, member, bytes)| Victim {
                kind: VictimKind::CachedMember {
                    key: key.to_owned(),
                    member,
                },
                tier: Tier::CachedMember,
                freed: self.cost(bytes),
            })
            .collect();
        let layer = |resident: &ResidentFacts, tier| Victim {
            kind: VictimKind::Layer {
                key: resident.key.clone(),
            },
            tier,
            freed: self.layer_freed(resident),
        };
        victims.extend(undemanded.iter().map(|(_, r)| layer(r, Tier::Undemanded)));
        victims.extend(
            background
                .iter()
                .map(|(_, r)| layer(r, Tier::BackgroundOnly)),
        );
        victims
    }

    /// Victims, in order, that together free at least `needed`; None when every
    /// allowed victim is not enough.
    fn victims_for(&self, needed: u64) -> Option<Vec<Victim>> {
        let mut chosen: Vec<Victim> = Vec::new();
        let mut freed = 0;
        for victim in self.ordered_victims() {
            if freed >= needed {
                break;
            }
            freed += victim.freed;
            chosen.push(victim);
        }
        (freed >= needed).then_some(chosen)
    }

    /// What every allowed victim frees together.
    fn evictable(&self) -> u64 {
        self.ordered_victims()
            .iter()
            .map(|victim| victim.freed)
            .sum()
    }

    /// [`Self::candidates`] with each layer victim's freed amount excluding the
    /// ring members an earlier entry already takes, so amounts add up.
    fn ordered_victims(&self) -> Vec<Victim> {
        let mut members: HashSet<(String, usize)> = HashSet::new();
        let mut victims = self.candidates();
        for victim in &mut victims {
            match &victim.kind {
                VictimKind::CachedMember { key, member } => {
                    members.insert((key.clone(), *member));
                }
                VictimKind::Layer { key } => {
                    let resident = self
                        .facts
                        .residents
                        .iter()
                        .find(|resident| &resident.key == key)
                        .expect("a candidate is resident");
                    let already: u64 = resident
                        .cached
                        .iter()
                        .filter(|m| members.contains(&(key.clone(), m.member)))
                        .map(|m| self.cost(m.bytes))
                        .sum();
                    victim.freed -= already;
                }
            }
        }
        victims
    }

    /// What pinned residents not drawn in front would add if they could go (their
    /// cached members are already tier-1 victims).
    fn pinned_reserve(&self) -> u64 {
        self.live()
            .filter(|resident| {
                !resident.upload_in_flight
                    && self.holders.pinned.contains(&resident.key)
                    && !self.holders.front.contains(&resident.key)
                    && !self.keep.contains(&resident.key)
            })
            .map(|resident| self.cost(resident.bytes))
            .sum()
    }

    fn commit(&mut self, victims: &[Victim]) {
        for victim in victims {
            match &victim.kind {
                VictimKind::CachedMember { key, member } => {
                    self.taken_members.insert((key.clone(), *member));
                }
                VictimKind::Layer { key } => {
                    self.evicted.insert(key.clone());
                }
            }
            self.used = self.used.saturating_sub(victim.freed);
        }
    }
}

/// Plan the admissions, evictions and refusals for `request`.
///
/// Background demand never uploads: a Background frame's request plans
/// nothing. A [`Request::Layer`] is the UI's own upload request (shadow mode,
/// and the fixed-slot fallback) and is planned whatever demands the layer. A layer over its frame's draw capacity is refused with
/// [`Refusal::DrawCap`] and causes no eviction. A texture that cannot fit even
/// after every allowed eviction causes none either; later (higher) layers are
/// still tried, since a smaller one may fit.
pub(crate) fn plan(
    facts: &ResidencyFacts,
    ledger: &DemandLedger,
    now: Millis,
    request: &Request,
) -> Plan {
    let mut plan = Plan::default();
    let holders = holders(ledger, facts);
    let mut sim = Simulation {
        facts,
        holders,
        used: facts.capacity.used(),
        keep: HashSet::new(),
        evicted: HashSet::new(),
        taken_members: HashSet::new(),
        now,
    };
    match request {
        Request::Frame(frame) => {
            let Some(demand) = ledger.get(frame) else {
                return plan;
            };
            if demand.priority == Priority::Background {
                return plan;
            }
            // Walk the frame as the renderer draws it, uploading as it goes: a
            // texture uploaded for one layer serves later layers keyed by its
            // volume, and a layer whose upload is refused takes no row or binding.
            let mut bound: Vec<String> = Vec::new();
            let mut planned: Vec<String> = Vec::new();
            let mut rows = 0;
            for layer in &demand.layers {
                let key = residency_key(layer, facts, &planned);
                if rows >= facts.row_capacity
                    || (!bound.contains(&key) && bound.len() >= facts.binding_capacity)
                {
                    plan.refuse.push(Refused {
                        layer_id: layer.layer_id.clone(),
                        reason: Refusal::DrawCap,
                    });
                    continue;
                }
                if !is_resident(facts, &key) && !planned.contains(&key) {
                    if !admit(&mut sim, &mut plan, layer, &key) {
                        continue;
                    }
                    planned.push(key.clone());
                }
                if !bound.contains(&key) {
                    bound.push(key);
                }
                rows += 1;
            }
        }
        Request::Layer {
            layer_id,
            volume_id,
        } => {
            let layer = DemandedLayer::new(layer_id.clone(), volume_id.clone());
            let key = residency_key(&layer, facts, &[]);
            if is_resident(facts, &key) {
                return plan;
            }
            if sim.holders.blocked.contains(layer_id) && !sim.holders.fits.contains(layer_id) {
                plan.refuse.push(Refused {
                    layer_id: layer_id.clone(),
                    reason: Refusal::DrawCap,
                });
                return plan;
            }
            admit(&mut sim, &mut plan, &layer, &key);
        }
    }
    plan
}

/// Admit one texture, evicting what it needs; on refusal nothing is evicted.
fn admit(sim: &mut Simulation<'_>, plan: &mut Plan, layer: &DemandedLayer, key: &str) -> bool {
    let mut refuse = |reason| {
        plan.refuse.push(Refused {
            layer_id: layer.layer_id.clone(),
            reason,
        });
        false
    };
    let Some(&bytes) = sim.facts.volume_bytes.get(&layer.volume_id) else {
        return refuse(Refusal::VolumeMissing);
    };
    let cost = sim.cost(bytes);
    let limit = sim.facts.capacity.limit();
    if cost > limit {
        return refuse(Refusal::OversizedRequest);
    }
    // What must go so the texture fits; more than its cost when the backend is
    // already over a budget that shrank.
    let needed = (sim.used + cost).saturating_sub(limit);
    if needed > 0 {
        let Some(victims) = sim.victims_for(needed) else {
            let reason = if sim.evictable() + sim.pinned_reserve() >= needed {
                Refusal::HeldByPinned
            } else {
                Refusal::FrontExceedsBudget
            };
            return refuse(reason);
        };
        sim.commit(&victims);
        plan.evict.extend(victims);
    }
    sim.used += cost;
    sim.keep.insert(key.to_owned());
    plan.admit.push(Admission {
        layer_id: layer.layer_id.clone(),
        key: key.to_owned(),
        cost,
    });
    true
}

#[cfg(test)]
mod tests {
    use super::super::demand::{Epoch, PinReason};
    use super::*;

    const KIB: u64 = 1024;

    /// The fake backend: a facts snapshot the tests edit directly.
    struct FakeBackend {
        facts: ResidencyFacts,
    }

    impl TextureBackend for FakeBackend {
        fn facts(&self) -> ResidencyFacts {
            self.facts.clone()
        }
    }

    /// A fake clock in milliseconds.
    struct FakeClock(Millis);

    impl FakeClock {
        fn now(&self) -> Millis {
            self.0
        }
        fn advance(&mut self, ms: Millis) {
            self.0 += ms;
        }
    }

    struct World {
        backend: FakeBackend,
        ledger: DemandLedger,
        epoch: u64,
        clock: FakeClock,
    }

    impl World {
        fn bytes(budget: u64) -> Self {
            Self::with(Capacity::Bytes { budget, used: 0 })
        }

        fn slots(total: u64) -> Self {
            Self::with(Capacity::Slots { total, used: 0 })
        }

        fn with(capacity: Capacity) -> Self {
            Self {
                backend: FakeBackend {
                    facts: ResidencyFacts {
                        capacity,
                        binding_capacity: 13,
                        row_capacity: 16,
                        residents: Vec::new(),
                        volume_bytes: HashMap::new(),
                        time_series_volumes: HashSet::new(),
                    },
                },
                ledger: DemandLedger::new(),
                epoch: 0,
                clock: FakeClock(100_000),
            }
        }

        fn facts(&mut self) -> &mut ResidencyFacts {
            &mut self.backend.facts
        }

        /// A loaded volume, and a resident texture keyed by it when `drawn_at`.
        fn volume(&mut self, id: &str, bytes: u64, drawn_at: Option<Millis>) -> &mut Self {
            self.facts().volume_bytes.insert(id.into(), bytes);
            if let Some(last_drawn) = drawn_at {
                self.facts().residents.push(ResidentFacts {
                    key: id.into(),
                    bytes,
                    last_drawn,
                    upload_in_flight: false,
                    cached: Vec::new(),
                });
            }
            self.sync_used();
            self
        }

        fn resident_mut(&mut self, key: &str) -> &mut ResidentFacts {
            self.facts()
                .residents
                .iter_mut()
                .find(|r| r.key == key)
                .expect("resident")
        }

        fn cached(&mut self, key: &str, member: usize, bytes: u64, last_used: Millis) {
            self.resident_mut(key).cached.push(CachedMember {
                member,
                bytes,
                last_used,
            });
            self.sync_used();
        }

        fn sync_used(&mut self) {
            let facts = self.facts();
            let used: u64 = facts
                .residents
                .iter()
                .map(|r| {
                    facts.capacity.cost(r.bytes)
                        + r.cached
                            .iter()
                            .map(|m| facts.capacity.cost(m.bytes))
                            .sum::<u64>()
                })
                .sum();
            match &mut facts.capacity {
                Capacity::Bytes { used: u, .. } | Capacity::Slots { used: u, .. } => *u = used,
            }
        }

        fn frame(
            &mut self,
            id: &str,
            priority: Priority,
            last_front_at: Millis,
            layers: &[DemandedLayer],
        ) {
            self.epoch += 1;
            let applied = self.ledger.set(
                FrameId::new(id),
                FrameDemand {
                    epoch: Epoch(self.epoch),
                    priority,
                    layers: layers.to_vec(),
                    held: Vec::new(),
                    last_front_at,
                },
            );
            assert_eq!(applied, super::super::demand::LedgerOutcome::Applied);
        }

        fn front(&mut self, id: &str, layers: &[&str]) {
            let now = self.clock.now();
            self.frame(id, Priority::Front, now, &own(layers));
        }

        fn background(&mut self, id: &str, last_front_at: Millis, layers: &[&str]) {
            self.frame(id, Priority::Background, last_front_at, &own(layers));
        }

        fn clear(&mut self, id: &str) {
            self.epoch += 1;
            self.ledger.clear(&FrameId::new(id), Epoch(self.epoch));
        }

        fn plan(&self, request: Request) -> Plan {
            plan(
                &self.backend.facts(),
                &self.ledger,
                self.clock.now(),
                &request,
            )
        }

        fn plan_frame(&self, id: &str) -> Plan {
            self.plan(Request::Frame(FrameId::new(id)))
        }

        fn plan_layer(&self, id: &str) -> Plan {
            self.plan(Request::Layer {
                layer_id: id.into(),
                volume_id: id.into(),
            })
        }
    }

    /// Layers keyed by their own volume (layer id = volume id).
    fn own(ids: &[&str]) -> Vec<DemandedLayer> {
        ids.iter().map(|id| DemandedLayer::new(*id, *id)).collect()
    }

    fn evicted_keys(plan: &Plan) -> Vec<String> {
        plan.evict
            .iter()
            .filter_map(|victim| match &victim.kind {
                VictimKind::Layer { key } => Some(key.clone()),
                VictimKind::CachedMember { .. } => None,
            })
            .collect()
    }

    fn admitted(plan: &Plan) -> Vec<String> {
        plan.admit.iter().map(|a| a.layer_id.clone()).collect()
    }

    fn refused(plan: &Plan, reason: Refusal) -> Vec<String> {
        plan.refuse
            .iter()
            .filter(|r| r.reason == reason)
            .map(|r| r.layer_id.clone())
            .collect()
    }

    fn names(prefix: &str, count: usize) -> Vec<String> {
        (0..count).map(|i| format!("{prefix}{i:02}")).collect()
    }

    fn refs(names: &[String]) -> Vec<&str> {
        names.iter().map(String::as_str).collect()
    }

    #[test]
    fn admits_into_free_bytes_without_eviction() {
        let mut world = World::bytes(10 * KIB);
        world
            .volume("old", 4 * KIB, Some(1))
            .volume("new", 4 * KIB, None);
        world.front("tab", &["new"]);
        let plan = world.plan_frame("tab");
        assert_eq!(admitted(&plan), ["new"]);
        assert!(plan.evict.is_empty());
        assert!(plan.refuse.is_empty());
        assert_eq!(plan.admit[0].cost, 4 * KIB);
    }

    #[test]
    fn cached_ring_members_go_before_any_layer() {
        let mut world = World::bytes(10 * KIB);
        world
            .volume("idle", 4 * KIB, Some(1))
            .volume("movie", 2 * KIB, Some(50));
        world.cached("movie", 3, 2 * KIB, 60);
        world.cached("movie", 4, 2 * KIB, 40);
        world.volume("new", 4 * KIB, None);
        world.front("tab", &["new"]);
        // used 10 KiB of 10: needs 4 KiB, two cached members free exactly that.
        let plan = world.plan_frame("tab");
        assert_eq!(admitted(&plan), ["new"]);
        assert_eq!(
            plan.evict
                .iter()
                .map(|v| v.kind.clone())
                .collect::<Vec<_>>(),
            [
                VictimKind::CachedMember {
                    key: "movie".into(),
                    member: 4
                },
                VictimKind::CachedMember {
                    key: "movie".into(),
                    member: 3
                },
            ]
        );
        assert!(plan.evict.iter().all(|v| v.tier == Tier::CachedMember));
    }

    #[test]
    fn undemanded_layers_go_lru_before_background_demanded() {
        let mut world = World::bytes(12 * KIB);
        world
            .volume("bg", 4 * KIB, Some(1))
            .volume("idle-new", 4 * KIB, Some(30))
            .volume("idle-old", 4 * KIB, Some(20))
            .volume("new", 4 * KIB, None);
        world.background("tab-2", 10, &["bg"]);
        world.front("tab-1", &["new"]);
        let plan = world.plan_frame("tab-1");
        assert_eq!(evicted_keys(&plan), ["idle-old"]);
        assert_eq!(plan.evict[0].tier, Tier::Undemanded);

        // Needing two textures' room takes both undemanded ones first.
        world.volume("big", 8 * KIB, None);
        world.front("tab-1", &["big"]);
        let plan = world.plan_frame("tab-1");
        assert_eq!(evicted_keys(&plan), ["idle-old", "idle-new"]);
    }

    #[test]
    fn background_frames_go_by_oldest_front_time() {
        let mut world = World::bytes(8 * KIB);
        world
            .volume("a", 4 * KIB, Some(90))
            .volume("b", 4 * KIB, Some(10))
            .volume("new", 4 * KIB, None);
        world.background("tab-a", 1_000, &["a"]);
        world.background("tab-b", 5_000, &["b"]);
        world.front("tab-new", &["new"]);
        let plan = world.plan_frame("tab-new");
        // tab-a was in front longer ago, whatever the draw times say.
        assert_eq!(evicted_keys(&plan), ["a"]);
        assert_eq!(plan.evict[0].tier, Tier::BackgroundOnly);
    }

    #[test]
    fn recently_front_frame_ranks_last_among_background() {
        let mut world = World::bytes(8 * KIB);
        let now = world.clock.now();
        world
            .volume("just-left", 4 * KIB, Some(1))
            .volume("old", 4 * KIB, Some(1))
            .volume("new", 4 * KIB, None);
        world.background("tab-recent", now - 1_000, &["just-left"]);
        world.background("tab-old", now - 10_000, &["old"]);
        world.front("tab", &["new"]);
        assert_eq!(evicted_keys(&world.plan_frame("tab")), ["old"]);

        // Recency is a rank, not a shield: when both frames were in front
        // within the window, the older one goes first.
        world.clock.advance(RECENT_FRONT_MS);
        let now = world.clock.now();
        world.background("tab-recent", now - 2_999, &["just-left"]);
        world.background("tab-old", now - 2_000, &["old"]);
        assert_eq!(evicted_keys(&world.plan_frame("tab")), ["just-left"]);

        // Only recent frames left to take from: they are still taken.
        world.background("tab-old", now - 100, &["old"]);
        world.clear("tab-recent");
        world.background("tab-recent", now - 50, &["just-left"]);
        assert_eq!(evicted_keys(&world.plan_frame("tab")), ["old"]);
    }

    #[test]
    fn never_evicts_front_pinned_displayed_member_or_in_flight() {
        let mut world = World::bytes(20 * KIB);
        world
            .volume("front", 4 * KIB, Some(1))
            .volume("pinned", 4 * KIB, Some(1))
            .volume("movie", 4 * KIB, Some(1))
            .volume("uploading", 4 * KIB, Some(1))
            .volume("new", 8 * KIB, None);
        world.resident_mut("uploading").upload_in_flight = true;
        world.cached("movie", 1, 4 * KIB, 1);
        world.front("tab", &["front", "movie"]);
        world.frame(
            "studio",
            Priority::Background,
            0,
            &[DemandedLayer::new("pinned", "pinned").pinned(PinReason::StudioPane)],
        );
        world.front("tab-new", &["new"]);
        let plan = world.plan_frame("tab-new");
        // Only movie's cached member may go (4 KiB); 8 KiB are needed.
        assert!(admitted(&plan).is_empty());
        assert!(plan.evict.is_empty());
        assert_eq!(refused(&plan, Refusal::HeldByPinned), ["new"]);

        // With room for 4 KiB more, the cached member suffices; the displayed
        // texture of the ring stays.
        world.facts().capacity = Capacity::Bytes {
            budget: 24 * KIB,
            used: 20 * KIB,
        };
        let plan = world.plan_frame("tab-new");
        assert_eq!(admitted(&plan), ["new"]);
        assert_eq!(
            plan.evict
                .iter()
                .map(|v| v.kind.clone())
                .collect::<Vec<_>>(),
            [VictimKind::CachedMember {
                key: "movie".into(),
                member: 1
            }]
        );
    }

    #[test]
    fn pins_survive_demand_clear() {
        let mut world = World::bytes(8 * KIB);
        world
            .volume("shared", 4 * KIB, Some(1))
            .volume("other", 4 * KIB, Some(5))
            .volume("new", 4 * KIB, None);
        world.background("tab", 0, &["shared"]);
        world.frame(
            "seg",
            Priority::Background,
            0,
            &[DemandedLayer::new("shared", "shared").pinned(PinReason::SegmentationSession)],
        );
        world.clear("tab");
        world.front("tab-new", &["new"]);
        let plan = world.plan_frame("tab-new");
        assert_eq!(evicted_keys(&plan), ["other"]);
        assert_eq!(admitted(&plan), ["new"]);
    }

    #[test]
    fn front_over_binding_capacity_admits_bottom_up_and_refuses_rest_with_draw_cap() {
        let mut world = World::bytes(1024 * KIB);
        let layers = names("v", 15);
        for id in &layers {
            world.volume(id, KIB, None);
        }
        world.front("tab", &refs(&layers));
        let plan = world.plan_frame("tab");
        assert_eq!(admitted(&plan), layers[..13]);
        assert_eq!(refused(&plan, Refusal::DrawCap), layers[13..]);
    }

    #[test]
    fn refused_over_cap_layers_never_cause_eviction() {
        let mut world = World::bytes(14 * KIB);
        let layers = names("v", 14);
        for id in &layers[..13] {
            world.volume(id, KIB, Some(1));
        }
        world.volume("idle", KIB, Some(0));
        world.volume(&layers[13], KIB, None);
        world.front("tab", &refs(&layers));
        // The 14th layer cannot draw: it is refused, and nothing is evicted
        // to make room for it, though the idle texture could go.
        let plan = world.plan_frame("tab");
        assert!(plan.admit.is_empty());
        assert!(plan.evict.is_empty());
        assert_eq!(refused(&plan, Refusal::DrawCap), [layers[13].clone()]);
        // The same layer asked for alone is still over its frame's cap.
        let plan = world.plan_layer(&layers[13]);
        assert!(plan.evict.is_empty());
        assert_eq!(refused(&plan, Refusal::DrawCap), [layers[13].clone()]);
    }

    #[test]
    fn shared_texture_counts_once_toward_binding_capacity() {
        let mut world = World::bytes(1024 * KIB);
        let volumes = names("v", 13);
        for id in &volumes {
            world.volume(id, KIB, Some(1));
        }
        // 13 volume-keyed layers plus 3 more layers over the first 3 volumes,
        // with their own ids: 16 rows, 13 textures. All draw.
        let mut layers = own(&refs(&volumes));
        for (i, volume) in volumes.iter().take(3).enumerate() {
            layers.push(DemandedLayer::new(format!("copy{i}"), volume.clone()));
        }
        let now = world.clock.now();
        world.frame("tab", Priority::Front, now, &layers);
        let demand = world.ledger.get(&FrameId::new("tab")).unwrap().clone();
        let set = draw_set(&demand, &world.backend.facts());
        assert_eq!(set.drawn.len(), 16);
        assert!(set.over_cap.is_empty());
        let plan = world.plan_frame("tab");
        assert_eq!(plan, Plan::default());

        // A 17th row is over the row capacity even though it shares a texture.
        layers.push(DemandedLayer::new("copy3", volumes[3].clone()));
        world.frame("tab", Priority::Front, now, &layers);
        assert_eq!(
            refused(&world.plan_frame("tab"), Refusal::DrawCap),
            ["copy3"]
        );

        // A time-series volume's layers draw only their own residency.
        world.facts().time_series_volumes.insert(volumes[0].clone());
        // copy0 now needs a 14th texture and is refused; copy1 still shares v01
        // and draws, which leaves room for copy3's row.
        world.volume("copy0", KIB, None);
        let plan = world.plan_frame("tab");
        assert_eq!(refused(&plan, Refusal::DrawCap), ["copy0"]);
        assert!(plan.admit.is_empty());
    }

    #[test]
    fn upload_for_a_volume_layer_serves_later_layers_of_that_volume() {
        let mut world = World::bytes(1024 * KIB);
        let volumes = names("v", 13);
        for id in &volumes {
            world.volume(id, KIB, None);
        }
        // Nothing resident: v00's upload is keyed v00, so `copy` draws it.
        let mut layers = own(&refs(&volumes));
        layers.push(DemandedLayer::new("copy", "v00"));
        let now = world.clock.now();
        world.frame("tab", Priority::Front, now, &layers);
        let plan = world.plan_frame("tab");
        assert_eq!(admitted(&plan), volumes);
        assert!(plan.refuse.is_empty());

        // One upload, not two, for a volume shown twice.
        world.frame(
            "tab",
            Priority::Front,
            now,
            &[
                DemandedLayer::new("v05", "v05"),
                DemandedLayer::new("copy", "v05"),
            ],
        );
        assert_eq!(admitted(&world.plan_frame("tab")), ["v05"]);
    }

    #[test]
    fn layer_refused_for_bytes_takes_no_binding() {
        let mut world = World::bytes(64 * KIB);
        let layers = names("v", 14);
        for id in &layers {
            world.volume(id, KIB, None);
        }
        world.volume(&layers[3], 65 * KIB, None);
        world.front("tab", &refs(&layers));
        // v03 cannot upload, so it takes no binding and v13 draws in its place.
        let plan = world.plan_frame("tab");
        assert_eq!(refused(&plan, Refusal::OversizedRequest), ["v03"]);
        assert!(refused(&plan, Refusal::DrawCap).is_empty());
        assert_eq!(plan.admit.len(), 13);
        assert_eq!(plan.admit[12].layer_id, "v13");
    }

    #[test]
    fn hidden_pinned_layer_held_by_its_frame_is_never_evicted() {
        let mut world = World::bytes(8 * KIB);
        world
            .volume("label", 4 * KIB, Some(1))
            .volume("idle", 4 * KIB, Some(2))
            .volume("new", 4 * KIB, None);
        // The editable label is hidden: not drawn, but its session holds it.
        world.epoch += 1;
        world.ledger.set(
            FrameId::new("segmentation:doc-1"),
            FrameDemand {
                epoch: Epoch(world.epoch),
                priority: Priority::Background,
                layers: Vec::new(),
                held: vec![DemandedLayer::new("label", "label").pinned(PinReason::EditableDocument)],
                last_front_at: 0,
            },
        );
        world.front("tab", &["new"]);
        let plan = world.plan_frame("tab");
        assert_eq!(evicted_keys(&plan), ["idle"]);
        assert_eq!(admitted(&plan), ["new"]);
    }

    #[test]
    fn front_and_pin_each_protect_on_their_own() {
        let mut world = World::bytes(8 * KIB);
        world
            .volume("studio-layer", 4 * KIB, Some(1))
            .volume("seg-label", 4 * KIB, Some(1))
            .volume("new", 4 * KIB, None);
        // An unpinned Front pane, and a pinned layer of a Background session.
        world.front("studio:pane-1", &["studio-layer"]);
        world.frame(
            "segmentation:doc-1",
            Priority::Background,
            0,
            &[DemandedLayer::new("seg-label", "seg-label").pinned(PinReason::SegmentationSession)],
        );
        world.front("tab", &["new"]);
        let plan = world.plan_frame("tab");
        assert!(plan.evict.is_empty());
        assert_eq!(refused(&plan, Refusal::HeldByPinned), ["new"]);
    }

    #[test]
    fn inherited_tab_with_15_visible_protects_only_first_13() {
        let mut world = World::bytes(15 * KIB);
        let layers = names("v", 15);
        for (i, id) in layers.iter().enumerate() {
            world.volume(id, KIB, Some(i as Millis));
        }
        world.volume("new", 2 * KIB, None);
        world.front("inherited", &refs(&layers));
        world.front("tab-new", &["new"]);
        // v13 and v14 cannot draw in their tab, so they are undemanded.
        let plan = world.plan_frame("tab-new");
        assert_eq!(evicted_keys(&plan), ["v13", "v14"]);
        assert!(plan.evict.iter().all(|v| v.tier == Tier::Undemanded));
    }

    #[test]
    fn one_views_demand_never_evicts_another_views_drawn_layers() {
        let mut world = World::bytes(10 * KIB);
        world
            .volume("tab-layer", 2 * KIB, Some(1))
            .volume("studio-layer", 2 * KIB, Some(1))
            .volume("seg-ref", 2 * KIB, Some(1))
            .volume("seg-label", 2 * KIB, Some(1))
            .volume("idle", 2 * KIB, Some(50))
            .volume("new", 4 * KIB, None);
        world.front("tab", &["tab-layer"]);
        world.frame(
            "studio:pane-1",
            Priority::Front,
            world.clock.now(),
            &[DemandedLayer::new("studio-layer", "studio-layer").pinned(PinReason::StudioPane)],
        );
        world.frame(
            "segmentation:doc-1",
            Priority::Front,
            world.clock.now(),
            &[
                DemandedLayer::new("seg-ref", "seg-ref").pinned(PinReason::SegmentationSession),
                DemandedLayer::new("seg-label", "seg-label").pinned(PinReason::EditableDocument),
            ],
        );
        world.front("tab-new", &["new"]);
        let plan = world.plan_frame("tab-new");
        // 10 KiB used, 4 needed: only `idle` may go, and it frees 2.
        assert!(plan.evict.is_empty());
        assert_eq!(refused(&plan, Refusal::FrontExceedsBudget), ["new"]);
        world.volume("small", 2 * KIB, None);
        world.front("tab-new", &["small"]);
        let plan = world.plan_frame("tab-new");
        assert_eq!(evicted_keys(&plan), ["idle"]);
        assert_eq!(admitted(&plan), ["small"]);
    }

    #[test]
    fn front_exceeding_budget_admits_bottom_up_then_refuses() {
        let mut world = World::bytes(10 * KIB);
        world
            .volume("a", 4 * KIB, None)
            .volume("b", 4 * KIB, None)
            .volume("c", 4 * KIB, None)
            .volume("d", 2 * KIB, None);
        world.front("tab", &["a", "b", "c", "d"]);
        let plan = world.plan_frame("tab");
        // a and b fit; c does not and nothing can be evicted for it; d still fits.
        assert_eq!(admitted(&plan), ["a", "b", "d"]);
        assert_eq!(refused(&plan, Refusal::FrontExceedsBudget), ["c"]);
        assert!(plan.evict.is_empty());
    }

    #[test]
    fn oversized_layer_refused_without_eviction() {
        let mut world = World::bytes(8 * KIB);
        world
            .volume("idle", 4 * KIB, Some(1))
            .volume("huge", 9 * KIB, None);
        world.front("tab", &["huge"]);
        let plan = world.plan_frame("tab");
        assert!(plan.evict.is_empty());
        assert_eq!(refused(&plan, Refusal::OversizedRequest), ["huge"]);
        let plan = world.plan_layer("huge");
        assert_eq!(refused(&plan, Refusal::OversizedRequest), ["huge"]);
    }

    #[test]
    fn held_by_pinned_when_only_pinned_bytes_remain() {
        let mut world = World::bytes(8 * KIB);
        world
            .volume("pinned", 4 * KIB, Some(1))
            .volume("idle", 4 * KIB, Some(1))
            .volume("new", 8 * KIB, None);
        world.frame(
            "studio",
            Priority::Background,
            0,
            &[DemandedLayer::new("pinned", "pinned").pinned(PinReason::StudioPane)],
        );
        world.front("tab", &["new"]);
        let plan = world.plan_frame("tab");
        // Evicting `idle` frees 4 of the 8 needed; the rest is pinned.
        assert!(plan.evict.is_empty());
        assert_eq!(refused(&plan, Refusal::HeldByPinned), ["new"]);
    }

    #[test]
    fn missing_volume_is_refused() {
        let mut world = World::bytes(8 * KIB);
        world.front("tab", &["gone"]);
        assert_eq!(
            refused(&world.plan_frame("tab"), Refusal::VolumeMissing),
            ["gone"]
        );
    }

    #[test]
    fn background_demand_never_uploads() {
        let mut world = World::bytes(8 * KIB);
        world.volume("a", 4 * KIB, None);
        world.background("tab", 0, &["a"]);
        assert_eq!(world.plan_frame("tab"), Plan::default());
    }

    #[test]
    fn layer_request_evicts_for_an_undemanded_requester() {
        let mut world = World::bytes(4 * KIB);
        world
            .volume("old", 4 * KIB, Some(1))
            .volume("asked", 4 * KIB, None);
        let plan = world.plan_layer("asked");
        assert_eq!(evicted_keys(&plan), ["old"]);
        assert_eq!(admitted(&plan), ["asked"]);
    }

    #[test]
    fn slots_capacity_uses_unit_cost() {
        let mut world = World::slots(3);
        world
            .volume("a", 900 * KIB, Some(1))
            .volume("b", KIB, Some(2))
            .volume("new", 4096 * KIB, None);
        world.cached("b", 1, KIB, 5);
        world.front("tab", &["new"]);
        // 3 of 3 slots used: one cached member frees one slot, whatever its bytes.
        let plan = world.plan_frame("tab");
        assert_eq!(admitted(&plan), ["new"]);
        assert_eq!(plan.admit[0].cost, 1);
        assert_eq!(plan.evict.len(), 1);
        assert_eq!(plan.evict[0].freed, 1);
    }

    #[test]
    fn slots_layer_victim_frees_its_slot_and_remaining_members() {
        let mut world = World::slots(4);
        world
            .volume("movie", KIB, Some(1))
            .volume("keep", KIB, Some(9));
        world.cached("movie", 1, KIB, 5);
        world.cached("movie", 2, KIB, 6);
        world
            .volume("a", KIB, None)
            .volume("b", KIB, None)
            .volume("c", KIB, None);
        world.front("tab", &["keep", "a", "b", "c"]);
        // 4 of 4 used; 3 needed: both cached members (1 each), then movie's
        // own slot (1, its members already taken).
        let plan = world.plan_frame("tab");
        assert_eq!(admitted(&plan), ["a", "b", "c"]);
        let freed: Vec<_> = plan.evict.iter().map(|v| (v.tier, v.freed)).collect();
        assert_eq!(
            freed,
            [
                (Tier::CachedMember, 1),
                (Tier::CachedMember, 1),
                (Tier::Undemanded, 1)
            ]
        );
    }

    #[test]
    fn layer_victim_freed_excludes_members_already_taken() {
        let mut world = World::bytes(12 * KIB);
        world.volume("movie", 4 * KIB, Some(1));
        world.cached("movie", 1, 4 * KIB, 1);
        world.volume("other", 4 * KIB, Some(2));
        world.volume("new", 12 * KIB, None);
        world.front("tab", &["new"]);
        let plan = world.plan_frame("tab");
        assert_eq!(admitted(&plan), ["new"]);
        let freed: u64 = plan.evict.iter().map(|v| v.freed).sum();
        assert_eq!(freed, 12 * KIB);
        assert_eq!(
            plan.evict[1].kind,
            VictimKind::Layer {
                key: "movie".into()
            }
        );
        assert_eq!(plan.evict[1].freed, 4 * KIB);
    }

    /// A small deterministic LCG (Numerical Recipes constants); no dependency.
    struct Lcg(u64);

    impl Lcg {
        fn next(&mut self) -> u64 {
            self.0 = self
                .0
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            self.0 >> 33
        }
        fn below(&mut self, n: u64) -> u64 {
            self.next() % n.max(1)
        }
        fn chance(&mut self, percent: u64) -> bool {
            self.below(100) < percent
        }
    }

    #[test]
    fn seeded_random_scenarios_never_violate_protection() {
        let mut rng = Lcg(0x5eed_0005_0a00);
        for scenario in 0..500 {
            let slots = rng.chance(20);
            let mut world = if slots {
                World::slots(4 + rng.below(16))
            } else {
                World::bytes((8 + rng.below(56)) * KIB)
            };
            world.facts().binding_capacity = 2 + rng.below(12) as usize;
            world.facts().row_capacity = world.facts().binding_capacity + rng.below(4) as usize;
            let pool = names("v", 24);
            for id in &pool {
                let bytes = (1 + rng.below(8)) * KIB;
                let drawn = rng.chance(50).then(|| rng.below(100_000));
                world.volume(id, bytes, drawn);
            }
            let resident_keys: Vec<String> = world
                .facts()
                .residents
                .iter()
                .map(|r| r.key.clone())
                .collect();
            for key in &resident_keys {
                if rng.chance(10) {
                    world.resident_mut(key).upload_in_flight = true;
                }
                if rng.chance(15) {
                    for member in 0..1 + rng.below(3) as usize {
                        let bytes = (1 + rng.below(4)) * KIB;
                        let used = rng.below(100_000);
                        world.cached(key, member + 1, bytes, used);
                    }
                }
            }
            // Over budget is possible after the fact (a smaller budget now).
            let frames = 1 + rng.below(4);
            for f in 0..frames {
                let count = 1 + rng.below(18) as usize;
                // Layer ids are app-wide, each over one volume, and a frame
                // lists a layer at most once.
                let mut layers: Vec<DemandedLayer> = Vec::new();
                for _ in 0..count {
                    let volume = &pool[rng.below(pool.len() as u64) as usize];
                    let layer_id = if rng.chance(20) {
                        format!("copy-{volume}")
                    } else {
                        volume.clone()
                    };
                    if layers.iter().any(|l| l.layer_id == layer_id) {
                        continue;
                    }
                    let layer = DemandedLayer::new(layer_id, volume.clone());
                    layers.push(if rng.chance(10) {
                        layer.pinned(PinReason::StudioPane)
                    } else {
                        layer
                    });
                }
                let priority = if rng.chance(40) {
                    Priority::Front
                } else {
                    Priority::Background
                };
                let at = world.clock.now().saturating_sub(rng.below(10_000));
                world.frame(&format!("f{f}"), priority, at, &layers);
            }
            let request = if rng.chance(70) {
                Request::Frame(FrameId::new(format!("f{}", rng.below(frames))))
            } else {
                let id = &pool[rng.below(pool.len() as u64) as usize];
                Request::Layer {
                    layer_id: id.clone(),
                    volume_id: id.clone(),
                }
            };
            let facts = world.backend.facts();
            let plan = world.plan(request.clone());
            check_invariants(scenario, &facts, &world.ledger, &request, &plan);
        }
    }

    /// The renderer's walk, written out apart from [`draw_set`] and [`plan`]:
    /// the layer ids that draw and those skipped for capacity, with `resident`
    /// the textures present. A layer with nothing resident is over capacity
    /// when the bindings are full, else skipped as a failed upload. Returns `(drawn, over_cap, bound keys)`.
    fn render(
        demand: &FrameDemand,
        facts: &ResidencyFacts,
        resident: &HashSet<String>,
    ) -> (Vec<String>, Vec<String>, HashSet<String>) {
        let (mut drawn, mut over, mut bound) = (Vec::new(), Vec::new(), Vec::<String>::new());
        for layer in &demand.layers {
            if drawn.len() >= facts.row_capacity {
                over.push(layer.layer_id.clone());
                continue;
            }
            let Some(key) = render_key(layer, facts, resident) else {
                // A full draw skips it before any upload; otherwise it would
                // upload, and in this after-the-plan world that failed.
                if bound.len() >= facts.binding_capacity {
                    over.push(layer.layer_id.clone());
                }
                continue;
            };
            if !bound.contains(&key) {
                if bound.len() >= facts.binding_capacity {
                    over.push(layer.layer_id.clone());
                    continue;
                }
                bound.push(key);
            }
            drawn.push(layer.layer_id.clone());
        }
        (drawn, over, bound.into_iter().collect())
    }

    fn render_key(
        layer: &DemandedLayer,
        facts: &ResidencyFacts,
        resident: &HashSet<String>,
    ) -> Option<String> {
        if resident.contains(&layer.layer_id) {
            Some(layer.layer_id.clone())
        } else if layer.volume_id != layer.layer_id
            && !facts.time_series_volumes.contains(&layer.volume_id)
            && resident.contains(&layer.volume_id)
        {
            Some(layer.volume_id.clone())
        } else {
            None
        }
    }

    fn check_invariants(
        scenario: usize,
        facts: &ResidencyFacts,
        ledger: &DemandLedger,
        request: &Request,
        plan: &Plan,
    ) {
        let context = || format!("scenario {scenario}: {request:?} -> {plan:?}");
        let before: HashSet<String> = facts.residents.iter().map(|r| r.key.clone()).collect();
        // Protection, from the renderer's walk over what is resident now.
        let mut protected: HashSet<String> = facts
            .residents
            .iter()
            .filter(|r| r.upload_in_flight)
            .map(|r| r.key.clone())
            .collect();
        for (_, demand) in ledger.frames() {
            let pinned = demand.layers.iter().filter(|l| l.pin.is_some());
            for layer in pinned.chain(&demand.held) {
                protected.extend(render_key(layer, facts, &before));
            }
            if demand.priority == Priority::Front {
                protected.extend(render(demand, facts, &before).2);
            }
        }
        let mut seen = HashSet::new();
        let mut freed = 0;
        let mut after = before.clone();
        for victim in &plan.evict {
            assert!(
                seen.insert(victim.kind.clone()),
                "duplicate victim; {}",
                context()
            );
            freed += victim.freed;
            match &victim.kind {
                VictimKind::Layer { key } => {
                    assert!(
                        !protected.contains(key),
                        "evicted protected {key}; {}",
                        context()
                    );
                    assert!(
                        after.remove(key),
                        "evicted a missing texture; {}",
                        context()
                    );
                }
                VictimKind::CachedMember { key, member } => {
                    let resident = facts
                        .residents
                        .iter()
                        .find(|r| &r.key == key)
                        .expect("resident");
                    assert!(!resident.upload_in_flight, "{}", context());
                    assert!(
                        resident.cached.iter().any(|m| m.member == *member),
                        "displayed member taken; {}",
                        context()
                    );
                }
            }
        }
        let cost: u64 = plan.admit.iter().map(|a| a.cost).sum();
        if plan.admit.is_empty() {
            assert!(
                plan.evict.is_empty(),
                "eviction without admission; {}",
                context()
            );
        } else {
            assert!(
                facts.capacity.used().saturating_sub(freed) + cost <= facts.capacity.limit(),
                "over capacity; {}",
                context()
            );
        }
        for admission in &plan.admit {
            assert!(
                after.insert(admission.key.clone()),
                "admitted twice or resident; {}",
                context()
            );
            assert!(
                plan.refuse.iter().all(|r| r.layer_id != admission.layer_id),
                "admitted and refused; {}",
                context()
            );
        }
        if let Request::Frame(frame) = request {
            let demand = ledger.get(frame).expect("frame");
            if demand.priority == Priority::Background {
                assert_eq!(plan, &Plan::default(), "{}", context());
                return;
            }
            // After the plan, the renderer draws every admitted texture, skips
            // for capacity exactly the layers refused with DrawCap, and every
            // layer either draws or is refused.
            let (drawn, over, bound) = render(demand, facts, &after);
            for admission in &plan.admit {
                assert!(
                    bound.contains(&admission.key),
                    "uploaded but not drawn; {}",
                    context()
                );
            }
            let draw_cap: Vec<String> = plan
                .refuse
                .iter()
                .filter(|r| r.reason == Refusal::DrawCap)
                .map(|r| r.layer_id.clone())
                .collect();
            assert_eq!(
                draw_cap,
                over,
                "draw-cap refusals differ from the render; {}",
                context()
            );
            for layer in &demand.layers {
                assert!(
                    drawn.contains(&layer.layer_id)
                        || plan.refuse.iter().any(|r| r.layer_id == layer.layer_id),
                    "{} neither drawn nor refused; {}",
                    layer.layer_id,
                    context()
                );
            }
        }
    }
}
