//! Backend bookkeeping for GPU texture residency: layer leases, the stale-lease
//! watchdog, render-skip marks, resident 4D ring accounting and the release
//! path. Moved out of `lib.rs` (R1 of
//! `docs/plans/gpu-residency-implementation-2026-11.md`). `demand` and `policy`
//! hold the R5 backend policy (pure). `manager` records the UI's demand and
//! reports residency; `admit` executes the policy: the backend owns admission
//! and eviction.
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
//! `BridgeState::residency` (R5b) comes after 3 and is held alone: nothing is
//! acquired while it is held, so it may be taken under the service or with no
//! other lock. Every change of slot ownership holds the `RenderLoopService`
//! lock.
//!
//! Identity (R2): outside this module and `gpu_upload`, nothing names a texture
//! by its bare index. The layer map ([`LayerSlotMap`]), leases, rings and
//! provisional uploads hold generation-checked `SlotHandle`s; indices flow on
//! only as binding positions, taken from a current handle at the renderer call.
//! `tests/bare_index_identity_check.rs` enforces this in CI.

mod admit;
mod config;
mod demand;
mod layer_slots;
mod lease;
mod manager;
mod policy;
mod release;
mod ring;
mod ring_pool;
mod skips;
mod watchdog;

pub(crate) use admit::{admit, capacity_shortfall, AdmitTarget};
pub(crate) use config::application_residency_config;
#[cfg(test)]
pub(crate) use demand::{FrameId, LedgerOutcome};
pub(crate) use layer_slots::drawn_render_layer;
pub use layer_slots::LayerSlotMap;
pub(crate) use lease::{release_superseded_lease, LayerLease};
#[cfg(test)]
pub(crate) use manager::residency_tick;
pub(crate) use manager::{
    clear_residency_demand_with, residency_state_report, set_residency_demand_with, Residency,
};
pub use manager::{
    ResidencyDemandResult, ResidencyDemandedLayer, ResidencyFrameDemand, ResidencyLayerReport,
    ResidencyLayerState, ResidencyPin, ResidencyPriority, ResidencyRefusal, ResidencyReport,
};
pub(crate) use release::{release_layer_gpu_resources_held, release_layer_gpu_resources_internal};
pub(crate) use ring::{
    cached_image_member_count, reclaim_cached_image_members, reclaim_cached_image_slot,
    release_resident_image_set, release_resident_image_set_allocations, resident_image_set_enabled,
    RESIDENT_RING_BUDGET_BYTES, RESIDENT_RING_MAX_SLOTS, RESIDENT_RING_PREFETCH_RADIUS,
};
pub(crate) use ring_pool::{pool_demand, ring_growth, trim_front_rings, RingGrowth};
pub(crate) use skips::{clear_allocation_failed_skips, note_render_skip, RenderSkip};
#[cfg(test)]
pub(crate) use watchdog::layer_watchdog_sweep;
