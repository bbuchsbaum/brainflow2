//! Backend bookkeeping for GPU texture residency: layer leases, the stale-lease
//! watchdog, render-skip marks, resident 4D ring accounting and the release
//! path. Moved out of `lib.rs` (R1 of
//! `docs/plans/gpu-residency-implementation-2026-11.md`). `demand` and `policy`
//! hold the R5 backend policy (pure; wired in from R5b).
//!
//! Lock order (outermost first); a path may skip levels but never go back up:
//! 1. `BridgeState::volume_operations`
//! 2. the outer `BridgeState::render_loop_service` slot (either cloned out and
//!    dropped, or held across 3+ as `release_layer_gpu_resources_held` does; never
//!    acquired while holding 3 or deeper)
//! 3. the `RenderLoopService` itself
//! 4. `resident_image_sets`
//! 5. `volume_registry`
//! 6. leaf maps: `layer_leases`, `layer_slots`, `layer_to_volume_map`,
//!    `layer_to_timepoint_map`, `render_skipped_layers`, `layer_last_drawn`
//!
//! The Phase 3 design inserts a `residency` lock between 3 and 4. Every change
//! of slot ownership holds the `RenderLoopService` lock.
//!
//! Identity (R2): outside this module and `gpu_upload`, nothing names a texture
//! by its bare index. The layer map ([`LayerSlotMap`]), leases, rings and
//! provisional uploads hold generation-checked `SlotHandle`s; indices flow on
//! only as binding positions, taken from a current handle at the renderer call.
//! `tests/bare_index_identity_check.rs` enforces this in CI.

mod config;
// R5a: the policy is pure and not wired in until R5b.
#[cfg_attr(not(test), allow(dead_code))]
mod demand;
mod layer_slots;
mod lease;
#[cfg_attr(not(test), allow(dead_code))]
mod policy;
mod release;
mod ring;
mod skips;
mod watchdog;

pub(crate) use config::application_residency_config;
pub(crate) use layer_slots::drawn_render_layer;
pub use layer_slots::LayerSlotMap;
pub(crate) use lease::{release_superseded_lease, LayerLease};
pub(crate) use release::{
    release_layer_gpu_resources_held, release_layer_gpu_resources_internal,
    release_layer_gpu_resources_with,
};
pub(crate) use ring::{
    cached_image_member_count, reclaim_cached_image_members, reclaim_cached_image_slot,
    reclaim_cached_image_slots_internal, release_resident_image_set,
    release_resident_image_set_allocations, resident_image_set_enabled, RESIDENT_RING_BUDGET_BYTES,
    RESIDENT_RING_MAX_SLOTS, RESIDENT_RING_PREFETCH_RADIUS,
};
pub(crate) use skips::{clear_allocation_failed_skips, note_render_skip, RenderSkip};
#[cfg(test)]
pub(crate) use watchdog::layer_watchdog_sweep;
