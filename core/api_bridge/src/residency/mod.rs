//! Backend bookkeeping for GPU texture residency: layer leases, the stale-lease
//! watchdog, render-skip marks, resident 4D ring accounting and the release
//! path. Moved out of `lib.rs` (R1 of
//! `docs/plans/gpu-residency-implementation-2026-11.md`); no policy lives here yet.
//!
//! Lock order (outermost first); a path may skip levels but never go back up:
//! 1. `BridgeState::volume_operations`
//! 2. the outer `BridgeState::render_loop_service` slot (cloned out, then dropped)
//! 3. the `RenderLoopService` itself
//! 4. `resident_image_sets`
//! 5. `volume_registry`
//! 6. leaf maps: `layer_leases`, `layer_to_atlas_map`, `layer_to_volume_map`,
//!    `layer_to_timepoint_map`, `render_skipped_layers`, `layer_last_drawn`
//!
//! The Phase 3 design inserts a `residency` lock between 3 and 4. Every change
//! of slot ownership holds the `RenderLoopService` lock.

mod lease;
mod release;
mod ring;
mod skips;
mod watchdog;

pub(crate) use lease::{release_superseded_lease, LayerLease};
pub(crate) use release::{
    release_layer_gpu_resources_held, release_layer_gpu_resources_internal,
    release_layer_gpu_resources_with,
};
pub(crate) use ring::{
    cached_image_member_count, reclaim_cached_image_slot, reclaim_cached_image_slots_internal,
    release_resident_image_set, release_resident_image_set_allocations, resident_image_set_enabled,
    RESIDENT_RING_BUDGET_BYTES, RESIDENT_RING_MAX_SLOTS, RESIDENT_RING_PREFETCH_RADIUS,
};
pub(crate) use skips::{clear_allocation_failed_skips, note_render_skip, RenderSkip};
#[cfg(test)]
pub(crate) use watchdog::layer_watchdog_sweep;
