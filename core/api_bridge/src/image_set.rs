//! GPU-resident image-set stack.
//!
//! The "4th axis" of a displayed stack is a generic **set-member index** — a
//! timepoint, a subject, a contrast/beta estimate, or a condition. This module
//! provides the abstraction ([`ImageSet`]) plus the bounded, VRAM-budgeted
//! **resident ring** ([`ResidentRing`]) that keeps several co-registered members
//! uploaded at once, so switching the visible member is a `texture_index` swap
//! (see [`render_loop::RenderLoopService::set_layer_texture_index`]) instead of a
//! CPU extract + full GPU re-upload.
//!
//! The ring is split into a **pure policy** ([`ResidentRing`]) and an **executor**
//! seam ([`RingExecutor`]). The policy owns the member↔slot map, LRU recency, and
//! the byte budget, and decides what to admit/evict; the executor performs the GPU
//! upload/overwrite. Keeping the two apart makes the eviction and budget logic
//! testable without a GPU (see the tests at the bottom of this file).
//!
//! Raw 4-D volumes are just one adapter ([`Raw4DImageSet`]); a set-studio adapter
//! (subjects/contrasts/conditions with ontology labels) plugs in behind the same
//! trait for the cross-set trace feature.

use std::collections::HashMap;

use bridge_types::{BridgeError, BridgeResult, VolumeSendable};

use crate::extract_3d_volume_at_timepoint;

/// A label for one member of an image set, carrying enough to drive an axis tick
/// or a legend entry. For raw 4-D this is just the timepoint index; ontology-aware
/// adapters fill `design_values` with `(column, value)` pairs (subject/condition/…).
#[derive(Debug, Clone, PartialEq)]
pub struct ImageSetMemberLabel {
    /// Zero-based member index within the set.
    pub index: usize,
    /// Human-facing short label (e.g. `"t=12"`, `"sub-03"`, `"faces>houses"`).
    pub display: String,
    /// Optional ontology axes for this member (`(column, value)`), empty for raw 4-D.
    pub design_values: Vec<(String, String)>,
}

/// A bounded, ordered set of co-registered 3-D members addressed by a generic
/// index. Members share a spatial grid and dtype; only the voxel data differs.
pub trait ImageSet: Send {
    /// Number of members in the set.
    fn len(&self) -> usize;

    /// Whether the set is empty.
    fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Spatial dimensions `[x, y, z]` shared by every member.
    fn spatial_dims(&self) -> [usize; 3];

    /// GPU byte footprint of a single member (used for the VRAM budget).
    fn bytes_per_member(&self) -> u64;

    /// Ontology-aware label for member `index`.
    fn member_label(&self, index: usize) -> ImageSetMemberLabel;

    /// Materialize member `index` as a 3-D volume ready for GPU upload. This is
    /// the CPU cost the resident ring pays once per admission and never again
    /// while the member stays resident.
    fn materialize(&self, index: usize) -> BridgeResult<VolumeSendable>;
}

/// GPU bytes one voxel occupies once uploaded, matching the uploader's format
/// choice: `U8` scalar data becomes `R8Unorm` (1 byte); everything else (and any
/// label/atlas volume) becomes `R16Float` (2 bytes). See
/// `render_loop::RenderLoopService::upload_volume_3d_labelaware`.
pub fn gpu_bytes_per_voxel(volume: &VolumeSendable, preserve_integer_labels: bool) -> u64 {
    match volume {
        VolumeSendable::VolU8(_, _) | VolumeSendable::Vec4DU8(_) if !preserve_integer_labels => 1,
        _ => 2,
    }
}

/// Number of members exposed by a `VolumeSendable`: the 4th-axis extent for 4-D
/// volumes, or 1 for a plain 3-D volume.
pub fn volume_member_count(volume: &VolumeSendable) -> usize {
    match volume {
        VolumeSendable::Vec4DF32(v) => v.space.dim.get(3).copied().unwrap_or(1).max(1),
        VolumeSendable::Vec4DI16(v) => v.space.dim.get(3).copied().unwrap_or(1).max(1),
        VolumeSendable::Vec4DU8(v) => v.space.dim.get(3).copied().unwrap_or(1).max(1),
        VolumeSendable::Vec4DI8(v) => v.space.dim.get(3).copied().unwrap_or(1).max(1),
        VolumeSendable::Vec4DU16(v) => v.space.dim.get(3).copied().unwrap_or(1).max(1),
        VolumeSendable::Vec4DI32(v) => v.space.dim.get(3).copied().unwrap_or(1).max(1),
        VolumeSendable::Vec4DU32(v) => v.space.dim.get(3).copied().unwrap_or(1).max(1),
        VolumeSendable::Vec4DF64(v) => v.space.dim.get(3).copied().unwrap_or(1).max(1),
        _ => 1,
    }
}

fn volume_spatial_dims(volume: &VolumeSendable) -> [usize; 3] {
    let dims = crate::get_spatial_dims_from_volume(volume);
    [
        dims.first().copied().unwrap_or(0),
        dims.get(1).copied().unwrap_or(0),
        dims.get(2).copied().unwrap_or(0),
    ]
}

/// [`ImageSet`] adapter over a raw 4-D `VolumeSendable`. Member `i` is timepoint
/// `i`; `materialize` delegates to the existing `extract_3d_volume_at_timepoint`.
pub struct Raw4DImageSet {
    volume: std::sync::Arc<VolumeSendable>,
    len: usize,
    spatial_dims: [usize; 3],
    bytes_per_member: u64,
    /// Optional TR (seconds) for time-based labels; `None` renders bare indices.
    tr_seconds: Option<f32>,
}

impl Raw4DImageSet {
    /// Wrap a 4-D volume (as held by the registry, shared via `Arc`). Returns
    /// `None` for a volume that has no member axis (a plain 3-D volume).
    pub fn new(volume: std::sync::Arc<VolumeSendable>, tr_seconds: Option<f32>) -> Option<Self> {
        let len = volume_member_count(&volume);
        if len <= 1 {
            return None;
        }
        let spatial_dims = volume_spatial_dims(&volume);
        let voxels = (spatial_dims[0] as u64) * (spatial_dims[1] as u64) * (spatial_dims[2] as u64);
        let bytes_per_member = voxels * gpu_bytes_per_voxel(&volume, false);
        Some(Self {
            volume,
            len,
            spatial_dims,
            bytes_per_member,
            tr_seconds,
        })
    }
}

impl ImageSet for Raw4DImageSet {
    fn len(&self) -> usize {
        self.len
    }

    fn spatial_dims(&self) -> [usize; 3] {
        self.spatial_dims
    }

    fn bytes_per_member(&self) -> u64 {
        self.bytes_per_member
    }

    fn member_label(&self, index: usize) -> ImageSetMemberLabel {
        let display = match self.tr_seconds {
            Some(tr) if tr > 0.0 => format!("{:.1}s", index as f32 * tr),
            _ => format!("t={index}"),
        };
        ImageSetMemberLabel {
            index,
            display,
            design_values: Vec::new(),
        }
    }

    fn materialize(&self, index: usize) -> BridgeResult<VolumeSendable> {
        if index >= self.len {
            return Err(BridgeError::Input {
                code: 2008,
                details: format!("Image-set member {index} out of range (len {})", self.len),
            });
        }
        extract_3d_volume_at_timepoint(&self.volume, index)
    }
}

/// Executes the GPU side of a ring admission. The pure [`ResidentRing`] decides
/// *what* to do; the executor uploads a member into a fresh slot or overwrites an
/// existing slot in place.
pub trait RingExecutor {
    /// Whether the executor can allocate a fresh texture slot without evicting
    /// some unrelated resident texture. Policy falls back to reusing its own LRU
    /// slot when this is false.
    fn can_admit_new(&self) -> bool {
        true
    }

    /// Upload `member` into a brand-new texture slot; return its texture index.
    fn admit_new(&mut self, member: usize) -> BridgeResult<u32>;

    /// Overwrite the texture at `slot` with `member`'s data in place (same grid,
    /// so no reallocation). Reuses the slot the ring is evicting.
    fn admit_reuse(&mut self, slot: u32, member: usize) -> BridgeResult<()>;
}

/// Outcome of [`ResidentRing::ensure_resident`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SwapOutcome {
    /// The texture slot now holding the requested member.
    pub texture_index: u32,
    /// `true` if this call paid an upload (admit); `false` on a resident hit.
    pub admitted: bool,
}

/// Configuration for a resident ring.
#[derive(Debug, Clone, Copy)]
pub struct RingConfig {
    /// Hard ceiling on resident slots for this ring (headroom below the shared
    /// texture-slot cap so other layers keep slots).
    pub max_slots: usize,
    /// VRAM byte budget for this ring.
    pub budget_bytes: u64,
    /// GPU bytes one member occupies.
    pub bytes_per_member: u64,
}

impl RingConfig {
    /// Effective resident capacity: bounded by both the slot cap and the byte
    /// budget, but always at least 1 (the currently-shown member must be resident).
    pub fn capacity(&self) -> usize {
        let by_budget = if self.bytes_per_member == 0 {
            self.max_slots
        } else {
            (self.budget_bytes / self.bytes_per_member) as usize
        };
        by_budget.min(self.max_slots).max(1)
    }
}

#[derive(Debug, Clone, Copy)]
struct RingSlot {
    texture_index: u32,
    member: usize,
    last_used: u64,
}

/// Bounded, VRAM-budgeted resident set of members for a single layer. Pure policy:
/// it never touches the GPU directly — admissions go through a [`RingExecutor`].
pub struct ResidentRing {
    config: RingConfig,
    slots: Vec<RingSlot>,
    /// member index -> position in `slots`.
    member_pos: HashMap<usize, usize>,
    tick: u64,
}

impl ResidentRing {
    /// Create a ring seeded with an already-resident member (the layer's initial
    /// upload). `member` is shown at texture slot `texture_index`.
    pub fn seeded(config: RingConfig, member: usize, texture_index: u32) -> Self {
        let mut ring = Self {
            config,
            slots: Vec::new(),
            member_pos: HashMap::new(),
            tick: 1,
        };
        ring.slots.push(RingSlot {
            texture_index,
            member,
            last_used: ring.tick,
        });
        ring.member_pos.insert(member, 0);
        ring
    }

    /// Resident capacity (members that can stay uploaded simultaneously).
    pub fn capacity(&self) -> usize {
        self.config.capacity()
    }

    /// Number of members currently resident.
    pub fn resident_len(&self) -> usize {
        self.slots.len()
    }

    /// Texture slot holding `member`, if resident.
    pub fn slot_of(&self, member: usize) -> Option<u32> {
        self.member_pos
            .get(&member)
            .map(|&pos| self.slots[pos].texture_index)
    }

    /// Whether `member` is currently resident.
    pub fn is_resident(&self, member: usize) -> bool {
        self.member_pos.contains_key(&member)
    }

    /// Make `member` resident and return the slot showing it. A resident hit is
    /// free; a miss admits into free capacity, or evicts the least-recently-used
    /// member (never one just touched this call) by overwriting its slot in place.
    pub fn ensure_resident(
        &mut self,
        member: usize,
        exec: &mut dyn RingExecutor,
    ) -> BridgeResult<SwapOutcome> {
        self.tick += 1;
        if let Some(&pos) = self.member_pos.get(&member) {
            self.slots[pos].last_used = self.tick;
            return Ok(SwapOutcome {
                texture_index: self.slots[pos].texture_index,
                admitted: false,
            });
        }

        if self.slots.len() < self.capacity() && exec.can_admit_new() {
            let texture_index = exec.admit_new(member)?;
            let pos = self.slots.len();
            self.slots.push(RingSlot {
                texture_index,
                member,
                last_used: self.tick,
            });
            self.member_pos.insert(member, pos);
            return Ok(SwapOutcome {
                texture_index,
                admitted: true,
            });
        }

        // At local capacity, or under global texture-slot pressure: reuse the
        // least-recently-used ring slot in place.
        let victim_pos = self.lru_pos();
        let victim = self.slots[victim_pos];
        exec.admit_reuse(victim.texture_index, member)?;
        self.member_pos.remove(&victim.member);
        self.slots[victim_pos].member = member;
        self.slots[victim_pos].last_used = self.tick;
        self.member_pos.insert(member, victim_pos);
        Ok(SwapOutcome {
            texture_index: victim.texture_index,
            admitted: true,
        })
    }

    /// Best-effort prefetch of members around `center` (inclusive radius). Admits
    /// only into free capacity — it never evicts, so it can never disturb the
    /// currently-shown member or other recently-used members. Returns how many
    /// members it admitted. Callers should run this off the render reactor.
    pub fn prefetch(
        &mut self,
        center: usize,
        radius: usize,
        member_count: usize,
        exec: &mut dyn RingExecutor,
    ) -> BridgeResult<usize> {
        let mut admitted = 0;
        // Interleave outward: center-1, center+1, center-2, center+2, ...
        for step in 1..=radius {
            for cand in [center.checked_sub(step), Some(center + step)]
                .into_iter()
                .flatten()
            {
                if cand >= member_count || self.member_pos.contains_key(&cand) {
                    continue;
                }
                if self.slots.len() >= self.capacity() || !exec.can_admit_new() {
                    return Ok(admitted); // no free capacity left; stop.
                }
                let texture_index = exec.admit_new(cand)?;
                self.tick += 1;
                let pos = self.slots.len();
                self.slots.push(RingSlot {
                    texture_index,
                    member: cand,
                    last_used: self.tick,
                });
                self.member_pos.insert(cand, pos);
                admitted += 1;
            }
        }
        Ok(admitted)
    }

    /// Texture indices of every resident slot (for teardown / reclaiming slots).
    pub fn resident_texture_indices(&self) -> Vec<u32> {
        self.slots.iter().map(|s| s.texture_index).collect()
    }

    /// Members currently resident (unordered).
    pub fn resident_members(&self) -> Vec<usize> {
        self.slots.iter().map(|s| s.member).collect()
    }

    fn lru_pos(&self) -> usize {
        let mut best = 0usize;
        let mut best_tick = u64::MAX;
        for (i, slot) in self.slots.iter().enumerate() {
            if slot.last_used < best_tick {
                best_tick = slot.last_used;
                best = i;
            }
        }
        best
    }
}

/// Everything the bridge keeps for one resident-image-set-backed layer: the
/// member source, the ring policy, and which member the layer currently shows.
/// Keyed by `layer_id` in `BridgeState::resident_image_sets`.
pub struct ResidentImageSet {
    /// Source of members (raw 4-D today; set-studio adapters later).
    pub set: Box<dyn ImageSet>,
    /// Bounded residency policy (LRU + VRAM budget).
    pub ring: ResidentRing,
    /// Member the layer's `LayerUboStd140.texture_index` currently points at.
    pub current_member: usize,
    /// Whether integer labels must be preserved on GPU upload (atlas volumes).
    pub preserve_labels: bool,
}

impl ResidentImageSet {
    /// Build a resident set for a layer whose initial member (`seed_member`) is
    /// already uploaded at `seed_slot`. `max_slots`/`budget_bytes` bound residency.
    pub fn new(
        set: Box<dyn ImageSet>,
        seed_member: usize,
        seed_slot: u32,
        max_slots: usize,
        budget_bytes: u64,
        preserve_labels: bool,
    ) -> Self {
        let config = RingConfig {
            max_slots,
            budget_bytes,
            bytes_per_member: set.bytes_per_member(),
        };
        let ring = ResidentRing::seeded(config, seed_member, seed_slot);
        Self {
            set,
            ring,
            current_member: seed_member,
            preserve_labels,
        }
    }

    /// Number of members in the backing set.
    pub fn member_count(&self) -> usize {
        self.set.len()
    }

    /// Make `member` resident (uploading it if needed) and return the slot the
    /// layer should point its `texture_index` at. A resident member is free.
    pub fn ensure_member(
        &mut self,
        member: usize,
        service: &mut render_loop::RenderLoopService,
    ) -> BridgeResult<SwapOutcome> {
        let mut exec = RenderServiceExecutor {
            service,
            set: &*self.set,
            preserve_labels: self.preserve_labels,
        };
        self.ring.ensure_resident(member, &mut exec)
    }

    /// Best-effort prefetch of members around `center` into free ring capacity.
    /// Never evicts, so it cannot disturb the currently-shown member.
    pub fn prefetch_around(
        &mut self,
        center: usize,
        radius: usize,
        service: &mut render_loop::RenderLoopService,
    ) -> BridgeResult<usize> {
        let member_count = self.set.len();
        let mut exec = RenderServiceExecutor {
            service,
            set: &*self.set,
            preserve_labels: self.preserve_labels,
        };
        self.ring.prefetch(center, radius, member_count, &mut exec)
    }

    /// Read-only snapshot of residency state, for telemetry and tests.
    pub fn snapshot(&self) -> ResidentImageSetSnapshot {
        let mut resident_members = self.ring.resident_members();
        resident_members.sort_unstable();
        ResidentImageSetSnapshot {
            member_count: self.set.len(),
            resident_len: self.ring.resident_len(),
            capacity: self.ring.capacity(),
            current_member: self.current_member,
            resident_members,
        }
    }
}

/// Read-only view of a resident set's occupancy (telemetry / tests).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResidentImageSetSnapshot {
    /// Total members in the backing set.
    pub member_count: usize,
    /// Members currently uploaded/resident.
    pub resident_len: usize,
    /// Maximum simultaneous residency under the current budget.
    pub capacity: usize,
    /// Member the layer currently displays.
    pub current_member: usize,
    /// Sorted list of resident member indices.
    pub resident_members: Vec<usize>,
}

/// GPU executor for the ring: materializes a member via the [`ImageSet`] and
/// uploads it (fresh slot) or overwrites a reused slot in place, dispatching the
/// `VolumeSendable` dtype to the render service's typed upload paths.
pub struct RenderServiceExecutor<'a> {
    pub service: &'a mut render_loop::RenderLoopService,
    pub set: &'a dyn ImageSet,
    pub preserve_labels: bool,
}

impl RingExecutor for RenderServiceExecutor<'_> {
    fn can_admit_new(&self) -> bool {
        self.service.free_volume_slot_count() > 0
    }

    fn admit_new(&mut self, member: usize) -> BridgeResult<u32> {
        let volume = self.set.materialize(member)?;
        upload_sendable_3d(self.service, &volume, self.preserve_labels)
    }

    fn admit_reuse(&mut self, slot: u32, member: usize) -> BridgeResult<()> {
        let volume = self.set.materialize(member)?;
        update_sendable_3d_at(self.service, slot, &volume)
    }
}

fn ring_upload_error(kind: &str, e: impl std::fmt::Display) -> BridgeError {
    BridgeError::Internal {
        code: 5015,
        details: format!("Resident image-set {kind} failed: {e}"),
    }
}

/// Upload a materialized 3-D `VolumeSendable` into a fresh slot, returning it.
fn upload_sendable_3d(
    service: &mut render_loop::RenderLoopService,
    volume: &VolumeSendable,
    preserve_labels: bool,
) -> BridgeResult<u32> {
    macro_rules! upload {
        ($vol:expr) => {
            service
                .upload_volume_3d_labelaware($vol, preserve_labels)
                .map(|(idx, _)| idx)
                .map_err(|e| ring_upload_error("upload", e))
        };
    }
    match volume {
        VolumeSendable::VolF32(v, _) => upload!(v),
        VolumeSendable::VolI16(v, _) => upload!(v),
        VolumeSendable::VolU8(v, _) => upload!(v),
        VolumeSendable::VolI8(v, _) => upload!(v),
        VolumeSendable::VolU16(v, _) => upload!(v),
        VolumeSendable::VolI32(v, _) => upload!(v),
        VolumeSendable::VolU32(v, _) => upload!(v),
        VolumeSendable::VolF64(v, _) => upload!(v),
        _ => Err(ring_upload_error(
            "upload",
            "materialized member is not a 3-D volume",
        )),
    }
}

/// Overwrite an existing slot with a materialized 3-D `VolumeSendable` in place.
fn update_sendable_3d_at(
    service: &mut render_loop::RenderLoopService,
    slot: u32,
    volume: &VolumeSendable,
) -> BridgeResult<()> {
    macro_rules! update {
        ($vol:expr) => {
            service
                .update_volume_3d_at(slot, $vol)
                .map_err(|e| ring_upload_error("in-place update", e))
        };
    }
    match volume {
        VolumeSendable::VolF32(v, _) => update!(v),
        VolumeSendable::VolI16(v, _) => update!(v),
        VolumeSendable::VolU8(v, _) => update!(v),
        VolumeSendable::VolI8(v, _) => update!(v),
        VolumeSendable::VolU16(v, _) => update!(v),
        VolumeSendable::VolI32(v, _) => update!(v),
        VolumeSendable::VolU32(v, _) => update!(v),
        VolumeSendable::VolF64(v, _) => update!(v),
        _ => Err(ring_upload_error(
            "in-place update",
            "materialized member is not a 3-D volume",
        )),
    }
}

/// One member of a [`SetStudioImageSet`]: a stable id, an already-loaded 3-D
/// volume (shared via `Arc`), and its ontology `(column, value)` design pairs.
pub struct SetStudioMember {
    /// Stable member id (matches `SpatialFieldSetSummary::member_ids`).
    pub member_id: String,
    /// Pre-loaded 3-D volume for this member.
    pub volume: std::sync::Arc<VolumeSendable>,
    /// Ontology axes for this member (`(column, value)`), e.g. `[("subject","03"),("cond","faces")]`.
    pub design_values: Vec<(String, String)>,
}

/// Build per-member ontology design values from a Set-Studio design-table
/// preview, keyed by member id. Each row's `cells` align to the preview
/// `columns` (extra cells beyond the column count are ignored); a member with no
/// preview row gets an empty vector. Pure — no volumes required, so the label
/// mapping is unit-testable on its own.
pub fn design_values_from_table_preview(
    preview: &bridge_types::StudioDesignTablePreview,
) -> HashMap<String, Vec<(String, String)>> {
    let mut out: HashMap<String, Vec<(String, String)>> = HashMap::new();
    for row in &preview.rows {
        let pairs: Vec<(String, String)> = preview
            .columns
            .iter()
            .cloned()
            .zip(row.cells.iter().cloned())
            .collect();
        out.insert(row.id.clone(), pairs);
    }
    out
}

/// Per-member ontology design values from a `SpatialFieldSetSummary`, keyed by
/// member id. Thin wrapper over [`design_values_from_table_preview`]; returns an
/// empty map when the summary carries no design-table preview.
pub fn design_values_from_summary(
    summary: &bridge_types::SpatialFieldSetSummary,
) -> HashMap<String, Vec<(String, String)>> {
    summary
        .design_table_preview
        .as_ref()
        .map(design_values_from_table_preview)
        .unwrap_or_default()
}

/// [`ImageSet`] adapter over a Set-Studio cohort: members are co-registered
/// subjects/contrasts/conditions rather than timepoints. `member_label` carries
/// the ontology `design_values` (from `designColumns`) so the cross-set trace
/// axis can render subject/condition ticks instead of bare indices.
///
/// Members are held as already-loaded `Arc<VolumeSendable>` so the adapter (and
/// its label mapping) is testable without disk; `materialize` clones the member
/// volume, matching the cost model of [`Raw4DImageSet`] (whose `materialize`
/// also allocates a fresh 3-D volume).
pub struct SetStudioImageSet {
    members: Vec<SetStudioMember>,
    spatial_dims: [usize; 3],
    bytes_per_member: u64,
}

impl SetStudioImageSet {
    /// Wrap a non-empty list of pre-loaded cohort members. `spatial_dims` and the
    /// per-member byte footprint are taken from the first member (members are
    /// assumed co-registered — the studio import enforces a shared grid). Returns
    /// `None` for an empty cohort.
    pub fn new(members: Vec<SetStudioMember>, preserve_labels: bool) -> Option<Self> {
        let first = members.first()?;
        let spatial_dims = volume_spatial_dims(&first.volume);
        let voxels = (spatial_dims[0] as u64) * (spatial_dims[1] as u64) * (spatial_dims[2] as u64);
        let bytes_per_member = voxels * gpu_bytes_per_voxel(&first.volume, preserve_labels);
        Some(Self {
            members,
            spatial_dims,
            bytes_per_member,
        })
    }
}

impl ImageSet for SetStudioImageSet {
    fn len(&self) -> usize {
        self.members.len()
    }

    fn spatial_dims(&self) -> [usize; 3] {
        self.spatial_dims
    }

    fn bytes_per_member(&self) -> u64 {
        self.bytes_per_member
    }

    fn member_label(&self, index: usize) -> ImageSetMemberLabel {
        let member = &self.members[index];
        // Compose a short display from the ontology pairs (e.g. "sub-03 · faces"),
        // falling back to the member id when there are no design values.
        let display = if member.design_values.is_empty() {
            member.member_id.clone()
        } else {
            member
                .design_values
                .iter()
                .map(|(_, value)| value.clone())
                .collect::<Vec<_>>()
                .join(" · ")
        };
        ImageSetMemberLabel {
            index,
            display,
            design_values: member.design_values.clone(),
        }
    }

    fn materialize(&self, index: usize) -> BridgeResult<VolumeSendable> {
        let member = self.members.get(index).ok_or_else(|| BridgeError::Input {
            code: 2008,
            details: format!(
                "Set-studio member {index} out of range (len {})",
                self.members.len()
            ),
        })?;
        Ok((*member.volume).clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Records executor calls and hands out increasing fake texture indices, so
    /// the pure ring policy can be tested without a GPU.
    struct FakeExecutor {
        next_index: u32,
        can_admit_new: bool,
        admit_new: Vec<usize>,
        admit_reuse: Vec<(u32, usize)>,
    }

    impl Default for FakeExecutor {
        fn default() -> Self {
            Self {
                next_index: 0,
                can_admit_new: true,
                admit_new: Vec::new(),
                admit_reuse: Vec::new(),
            }
        }
    }

    impl RingExecutor for FakeExecutor {
        fn can_admit_new(&self) -> bool {
            self.can_admit_new
        }

        fn admit_new(&mut self, member: usize) -> BridgeResult<u32> {
            let idx = self.next_index;
            self.next_index += 1;
            self.admit_new.push(member);
            Ok(idx)
        }
        fn admit_reuse(&mut self, slot: u32, member: usize) -> BridgeResult<()> {
            self.admit_reuse.push((slot, member));
            Ok(())
        }
    }

    fn new_ring(capacity_slots: usize) -> ResidentRing {
        // Seed member 0 at slot 0; budget generous so capacity == max_slots.
        let config = RingConfig {
            max_slots: capacity_slots,
            budget_bytes: u64::MAX,
            bytes_per_member: 1,
        };
        ResidentRing::seeded(config, 0, 0)
    }

    #[test]
    fn capacity_is_bounded_by_budget_and_slots() {
        // 3 members fit in the byte budget, but max_slots caps it at 2.
        let cfg = RingConfig {
            max_slots: 2,
            budget_bytes: 300,
            bytes_per_member: 100,
        };
        assert_eq!(cfg.capacity(), 2);
        // Budget is the tighter bound here.
        let cfg = RingConfig {
            max_slots: 8,
            budget_bytes: 250,
            bytes_per_member: 100,
        };
        assert_eq!(cfg.capacity(), 2);
        // Always at least one member resident, even with a tiny budget.
        let cfg = RingConfig {
            max_slots: 8,
            budget_bytes: 10,
            bytes_per_member: 100,
        };
        assert_eq!(cfg.capacity(), 1);
    }

    #[test]
    fn revisiting_a_member_is_a_free_hit() {
        let mut ring = new_ring(4);
        let mut exec = FakeExecutor {
            next_index: 1,
            ..Default::default()
        };

        // Seeded member 0 is already resident.
        let hit = ring.ensure_resident(0, &mut exec).unwrap();
        assert_eq!(
            hit,
            SwapOutcome {
                texture_index: 0,
                admitted: false
            }
        );

        // First visit to member 1 admits (upload); second visit is a hit.
        let first = ring.ensure_resident(1, &mut exec).unwrap();
        assert!(first.admitted);
        let again = ring.ensure_resident(1, &mut exec).unwrap();
        assert_eq!(
            again,
            SwapOutcome {
                texture_index: first.texture_index,
                admitted: false
            }
        );

        // Only one upload happened for member 1.
        assert_eq!(exec.admit_new, vec![1]);
        assert!(exec.admit_reuse.is_empty());
    }

    #[test]
    fn stepping_back_to_a_resident_member_never_re_uploads() {
        // Capacity 4: stepping 0->1->2->3 keeps all resident, so stepping back is
        // all hits — the core win over the re-upload path.
        let mut ring = new_ring(4);
        let mut exec = FakeExecutor {
            next_index: 1,
            ..Default::default()
        };
        for m in 1..=3 {
            assert!(ring.ensure_resident(m, &mut exec).unwrap().admitted);
        }
        assert_eq!(ring.resident_len(), 4);
        // Walk back down: every one is a resident hit.
        for m in (0..=3).rev() {
            assert!(!ring.ensure_resident(m, &mut exec).unwrap().admitted);
        }
        assert_eq!(exec.admit_new, vec![1, 2, 3]);
        assert!(exec.admit_reuse.is_empty());
    }

    #[test]
    fn eviction_reuses_lru_slot_in_place() {
        // Capacity 2: only two members resident at once.
        let mut ring = new_ring(2);
        let mut exec = FakeExecutor {
            next_index: 1,
            ..Default::default()
        };

        // Resident: {0@slot0}. Admit 1 into the second (free) slot.
        let s1 = ring.ensure_resident(1, &mut exec).unwrap();
        assert!(s1.admitted);
        assert_eq!(ring.resident_len(), 2);

        // Admit 2 -> at capacity, evict LRU (member 0, slot 0) by overwriting it.
        let s2 = ring.ensure_resident(2, &mut exec).unwrap();
        assert!(s2.admitted);
        assert_eq!(s2.texture_index, 0, "LRU slot 0 reused for member 2");
        assert_eq!(exec.admit_reuse, vec![(0, 2)]);
        assert!(!ring.is_resident(0), "member 0 evicted");
        assert!(ring.is_resident(1));
        assert!(ring.is_resident(2));

        // Member 0 now costs a re-admit (evicting the new LRU, which is member 1).
        let s0 = ring.ensure_resident(0, &mut exec).unwrap();
        assert!(s0.admitted);
        assert_eq!(exec.admit_reuse, vec![(0, 2), (s1.texture_index, 0)]);
    }

    #[test]
    fn global_slot_pressure_reuses_ring_lru_even_below_local_capacity() {
        // Capacity 4, but the executor reports no globally-free texture slots.
        // A miss must reuse the ring's own LRU slot instead of propagating a
        // fresh-upload failure from the texture manager.
        let mut ring = new_ring(4);
        let mut exec = FakeExecutor {
            next_index: 1,
            can_admit_new: false,
            ..Default::default()
        };

        let swap = ring.ensure_resident(1, &mut exec).unwrap();

        assert_eq!(swap.texture_index, 0, "seed slot reused under pressure");
        assert!(swap.admitted);
        assert!(exec.admit_new.is_empty());
        assert_eq!(exec.admit_reuse, vec![(0, 1)]);
        assert_eq!(ring.resident_len(), 1);
        assert!(!ring.is_resident(0));
        assert!(ring.is_resident(1));
    }

    #[test]
    fn ensuring_current_member_protects_it_from_eviction() {
        // Touch the current member, then admit past capacity: the touched member
        // must survive (LRU picks something older).
        let mut ring = new_ring(2);
        let mut exec = FakeExecutor {
            next_index: 1,
            ..Default::default()
        };
        ring.ensure_resident(1, &mut exec).unwrap(); // resident {0,1}
        ring.ensure_resident(0, &mut exec).unwrap(); // touch 0 -> MRU
        ring.ensure_resident(2, &mut exec).unwrap(); // evict LRU == member 1
        assert!(ring.is_resident(0), "recently-used member 0 kept");
        assert!(!ring.is_resident(1), "older member 1 evicted");
        assert!(ring.is_resident(2));
    }

    #[test]
    fn prefetch_fills_free_capacity_without_evicting() {
        let mut ring = new_ring(5);
        let mut exec = FakeExecutor {
            next_index: 1,
            ..Default::default()
        };
        // Center on member 0, radius 2, 10 members total. Neighbors 1,2 admitted
        // (there is no member -1/-2). Free capacity is 4, so all fit.
        let n = ring.prefetch(0, 2, 10, &mut exec).unwrap();
        assert_eq!(n, 2);
        assert!(ring.is_resident(1));
        assert!(ring.is_resident(2));
        assert!(exec.admit_reuse.is_empty(), "prefetch never evicts");

        // Prefetch stops at capacity and does not evict.
        let mut small = new_ring(2);
        let mut exec2 = FakeExecutor {
            next_index: 1,
            ..Default::default()
        };
        let n = small.prefetch(0, 3, 10, &mut exec2).unwrap();
        assert_eq!(n, 1, "only one free slot beyond the seeded member");
        assert!(exec2.admit_reuse.is_empty());
    }

    fn tiny_f32_volume() -> std::sync::Arc<VolumeSendable> {
        use volmath::{DenseVolume3, NeuroSpace, NeuroSpace3, NeuroSpaceExt};
        let space_impl =
            NeuroSpace::from_dims_spacing_origin(vec![2, 2, 2], vec![1.0; 3], vec![0.0; 3])
                .expect("neurospace");
        let space = NeuroSpace3::new(space_impl);
        let vol = DenseVolume3::<f32>::from_data(space.0, vec![1.0f32; 8]);
        std::sync::Arc::new(VolumeSendable::VolF32(
            vol,
            nalgebra::Affine3::<f32>::identity(),
        ))
    }

    fn member(id: &str, design: &[(&str, &str)]) -> SetStudioMember {
        SetStudioMember {
            member_id: id.to_string(),
            volume: tiny_f32_volume(),
            design_values: design
                .iter()
                .map(|(c, v)| (c.to_string(), v.to_string()))
                .collect(),
        }
    }

    #[test]
    fn set_studio_labels_use_design_values_and_dims() {
        let set = SetStudioImageSet::new(
            vec![
                member("m1", &[("subject", "01"), ("cond", "faces")]),
                member("m2", &[("subject", "02"), ("cond", "houses")]),
            ],
            false,
        )
        .expect("non-empty cohort");

        assert_eq!(set.len(), 2);
        assert_eq!(set.spatial_dims(), [2, 2, 2]);
        // 8 voxels * 2 bytes/voxel (f32 -> R16Float).
        assert_eq!(set.bytes_per_member(), 16);

        let label = set.member_label(0);
        assert_eq!(label.index, 0);
        assert_eq!(label.display, "01 · faces");
        assert_eq!(
            label.design_values,
            vec![
                ("subject".to_string(), "01".to_string()),
                ("cond".to_string(), "faces".to_string())
            ]
        );

        // materialize returns a clone of the member volume; out of range errors.
        assert!(set.materialize(1).is_ok());
        assert!(set.materialize(9).is_err());
    }

    #[test]
    fn set_studio_falls_back_to_member_id_without_design() {
        let set = SetStudioImageSet::new(vec![member("sub-07", &[])], false).unwrap();
        assert_eq!(set.member_label(0).display, "sub-07");
        assert!(set.member_label(0).design_values.is_empty());
    }

    #[test]
    fn set_studio_empty_cohort_is_none() {
        assert!(SetStudioImageSet::new(Vec::new(), false).is_none());
    }

    #[test]
    fn design_values_zip_columns_and_tolerate_short_rows() {
        use bridge_types::{StudioDesignRowPreview, StudioDesignTablePreview};
        let preview = StudioDesignTablePreview {
            columns: vec!["subject".to_string(), "cond".to_string()],
            rows: vec![
                StudioDesignRowPreview {
                    id: "m1".to_string(),
                    cells: vec!["01".to_string(), "faces".to_string()],
                },
                // Short row: fewer cells than columns -> zip stops at the shorter.
                StudioDesignRowPreview {
                    id: "m2".to_string(),
                    cells: vec!["02".to_string()],
                },
            ],
        };
        let map = design_values_from_table_preview(&preview);
        assert_eq!(
            map.get("m1").unwrap(),
            &vec![
                ("subject".to_string(), "01".to_string()),
                ("cond".to_string(), "faces".to_string())
            ]
        );
        assert_eq!(
            map.get("m2").unwrap(),
            &vec![("subject".to_string(), "02".to_string())]
        );
    }
}
