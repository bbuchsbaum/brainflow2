# R5 implementation plan: backend residency owner

**Status:** approved by the user with the §9 defaults (2026-11-06). R5a is pure code with no runtime wiring, so it proceeds while R4's open items (§0) close; R5b onward waits for them.

**Parent plan:** `docs/plans/gpu-residency-implementation-2026-11.md`, R5 (§2) and gates (§3).
**Design:** `docs/plans/gpu-residency-phase3-design-2026-11.md`, increments 1, 3, 4 and 5, applied to bytes.
**Base:** `main` at `75746af9` (R4 merge `6adbf659` plus the draw-admission fix `495de2e2`/`7a524d8e`). Line references are to that tree.

## 0. Precondition

R5 starts only after R4's open items close (parent plan, "R4 merged; native acceptance found a binding-capacity bug — 2026-11-06"): the native forced-pressure run, reopen-after-close, the UI gates and lavapipe evidence. Segmentation is an Experimental module (`core/api_bridge/src/modules/segmentation.rs:26`) that the tester enables in Settings › Modules; it was never exercised natively in R4, and the R5 exit depends on it.

## 1. Goal and non-goals

**Goal.** One backend owner decides admission and eviction from demand the UI declares, under two limits:

- **Bytes:** the global logical payload budget (`texture_store.rs:746,850`; default 512 MiB, `facade.rs:443`).
- **Bindings:** 13 distinct textures and 16 rows per draw (`lib.rs:6571,6588,6624`).

It ships behind `BRAINFLOW_BACKEND_RESIDENCY`, default off. The UI never names slots or bindings.

**Non-goals:** deleting the UI policy (R6); multipass drawing of more than 13 layers; staging uploads outside the service lock (design decision 5); a `Visible` priority (decision 2); carrying frame identity on render requests. `FrontendViewState` (`lib.rs:6392`) stays as it is, and demand is the only frame identity.

## 2. Where the code already differs from the design

1. **Done already:** the editable path (N34) and a lease for every allocation. `allocate_gpu_resources_for_layer` routes through `upload_layer_volume` with `editable_revision` (`gpu_upload.rs:1109-1205`). Leases, rings and the layer map hold generation-checked `SlotHandle`s, enforced by `tests/bare_index_identity_check.rs` (`residency/mod.rs:20-24`). Design §4's editable row and §6's generations need no R5 work.
2. **Half-built: the draw cap.** The render-time OverCap rule exists: `texture_admitted` (`lib.rs:6571`), the pre-check (`lib.rs:6636-6652`) and the backstop (`lib.rs:6897-6901`). The policy must copy it exactly. Layers sharing a texture count once, and a layer may draw through a volume-keyed residency (`lib.rs:6642,6683`).
3. **Mostly overtaken: "rings take any free slot, 6 per layer".** In byte mode, prefetch already draws from the global budget and stops at pressure (`gpu_upload.rs:925`). Both upload paths reclaim cached members after a typed retryable refusal (`gpu_upload.rs:228-238`, `1185-1199`). `RESIDENT_RING_BUDGET_BYTES` (512 MiB, `ring.rs:11`) equals the global default, so it bounds nothing. What remains is the 6-member cap (`ring.rs:8`), headroom, and trimming background rings, so R5d is small.
4. **Obsolete slot terms.** "Ring accounts hold slot counts", "1 slot of headroom" and the event's `freeSlots` become bytes. `free_slot_count` is 0 in byte mode (`texture_store.rs:776-782`).
5. **The "slots full" regex is a fallback path only.** Byte mode refuses with typed 6008 (`formatTauriError.ts:80`). `SLOTS_FULL` (`:123`) serves only the fixed-slot fallback and `frontWorkspaceResidency.ts:42`.
6. **Still needed: idempotent `ensure`.** Error 1006 still exists (`gpu_upload.rs:53-57`), and so does UI adoption (`LayerApiImpl.ts:184-190, 217-221`).
7. **The design deletes UI bookkeeping in increment 4; the plan defers it to R6.** Follow the plan: in R5 the UI paths are disabled under the flag, not removed.
8. **The UI's per-view check counts rows against 16, not textures against 13** (`LayerService.ts:199-213`, `drawLayerCap` at `LayerEvictionService.ts:177`). Tabs seeded with an inherited scene bypass the check entirely. Layers past 13 are dropped with only a warning log (`skips.rs:27`).
9. **Studio's retry listens for `gpu.slots.freed`** (`StudioDerivedPaneCanvas.tsx:154`). Keep emitting it until R6.

## 3. Sub-increments (one PR each)

### R5a — pure `ResidencyPolicy` and fake backend (about 1 day)

No runtime wiring. Shadow logging needs demand, so it moves to R5b.

**New `core/api_bridge/src/residency/demand.rs`:**

- Types: `FrameId`, `Epoch(u64)`, `Priority { Front, Background }`, and `PinReason { StudioPane, SegmentationSession, EditableDocument }`.
- `DemandedLayer { layer_id, volume_id, pin }` in stack order, bottom first, matching `lib.rs:6603`.
- `FrameDemand { epoch, priority, layers, last_front_at }`.
- `DemandLedger` with `set` and `clear`. Each returns `Applied` or `Stale`, with a monotonic epoch per frame.

**New `core/api_bridge/src/residency/policy.rs`:**

- `trait TextureBackend { fn facts(&self) -> ResidencyFacts; }`.
- `ResidencyFacts` holds:
  - capacity: bytes or slots, each with its used amount;
  - the binding and row capacities;
  - for each resident layer: its residency key, bytes, `last_drawn`, whether an upload is in flight, and its ring (displayed member bytes and cached members with their bytes and last use);
  - a byte estimate per layer.
- `plan(facts, ledger, now, request) -> Plan { admit, evict: Vec<Victim{kind, tier}>, refuse }`.
- Refusals use the design's names: `FrontExceedsBudget`, `HeldByPinned`, `DrawCap`, `VolumeMissing` and `UploadFailed`. `OversizedRequest` is added, mirroring `retryable_budget_pressure` (`gpu_upload.rs:1104`).
- A `#[cfg(test)]` fake backend with a fake clock.

**Eviction order:**

1. Cached ring members, LRU.
2. Undemanded layers, LRU by `last_drawn`.
3. Layers demanded only by Background frames, oldest `last_front_at` first. A frame in front within the last 3 s ranks last.

Ties break by layer id.

**Never evicted:**

- layers in the first `binding_capacity` distinct residency keys (and first 16 rows) of any Front frame;
- pinned layers;
- displayed ring members;
- uploads in flight.

Over-cap Front layers are refused with `DrawCap` and never cause an eviction.

**Tests:**

- `admits_into_free_bytes_without_eviction`
- `cached_ring_members_go_before_any_layer`
- `undemanded_layers_go_lru_before_background_demanded`
- `background_frames_go_by_oldest_front_time`
- `recently_front_frame_ranks_last_among_background`
- `never_evicts_front_pinned_displayed_member_or_in_flight`
- `pins_survive_demand_clear`
- `front_over_binding_capacity_admits_bottom_up_and_refuses_rest_with_draw_cap`
- `refused_over_cap_layers_never_cause_eviction`
- `shared_texture_counts_once_toward_binding_capacity`
- `inherited_tab_with_15_visible_protects_only_first_13`
- `one_views_demand_never_evicts_another_views_drawn_layers`, covering a front tab, a Studio pane and segmentation
- `front_exceeding_budget_admits_bottom_up_then_refuses`
- `oversized_layer_refused_without_eviction`
- `held_by_pinned_when_only_pinned_bytes_remain`
- `stale_epoch_is_ignored`
- `older_clear_cannot_remove_newer_demand`
- `slots_capacity_uses_unit_cost`
- `seeded_random_scenarios_never_violate_protection`: 500 scenarios driven by an in-crate LCG, with no new dependency

**Exit:**

- the tests and gates pass;
- the reviewer confirms the rules match `texture_admitted` and the `LayerEvictionService` tiers (`LayerEvictionService.ts:464-527`).

### R5b — demand commands, event, UI publisher, shadow ledger (about 1.5 days)

**Rust:**

- `residency/manager.rs` holds `ResidencyState { ledger, shadow, seq }` in a new `BridgeState::residency`.
- **Lock order:** after the `RenderLoopService` lock, before `resident_image_sets`. Update the lock-order doc at `residency/mod.rs:6-18`.
- `BridgeTextureBackend` builds `ResidencyFacts` as a snapshot of the service, `layer_slots`, `layer_leases`, rings and `layer_last_drawn`. It is not a mirror, so it cannot drift.
- **Commands** (registered in `command_list.rs`): `set_residency_demand`, `clear_residency_demand` and `get_residency_state`.
- **`ResidencyReport`** (`#[ts(export)]`, with no index or generation fields):
  - `seq`;
  - `owner`: `ui` or `backend`;
  - `budget_bytes`, `used_bytes`, `binding_capacity` and `undemanded_bytes`;
  - for each layer: its state (Resident, Uploading, Refused, Evicted or Undemanded), bytes, frames and refusal.
- **Event `residency-changed`:** coalesced to 50 ms. It is triggered by an additive `ResidentTextureStore::residency_revision()` counter, bumped on upload, release and mask change.
- `layer-gpu-released` (`watchdog.rs:157`) stays.

**UI:**

- **`ui2/src/stores/residencyStore.ts`:** applies events in `seq` order and refetches on a gap.
- **`ui2/src/services/ResidencyDemandPublisher.ts`.** Its inputs:
  - `viewStateStore`;
  - `workspaceStore`: a tool tab publishes no Front (A12, `LayerEvictionService.ts:551-588`);
  - Studio pins (`StudioDerivedMapService.ts:226`);
  - segmentation protections (`workspaceDocuments.ts:76`, `segmentation.editable-label`).

  It keeps one epoch per frame, clears demand when a tab closes, and starts in `useServicesInit.ts` beside `:124`.
- **Dev harness:** commands in `ui2/src/devHarness/app/backend.ts` and `transport.ts`.

**Shadow mode** runs whenever the flag is off (§4).

**Tests:**

- Rust:
  - `demand_epochs_monotonic_per_frame`
  - `report_serializes_without_binding_or_slot_fields`
  - GPU: `residency_changed_emits_after_upload_and_release`
  - GPU: `shadow_episode_records_ui_victims_and_policy_plan`
  - GPU: `draw_cap_shadow_matches_render_over_cap_skips`
- Vitest:
  - `publishes_front_for_active_view_tab_background_for_others`
  - `tool_tab_in_front_publishes_no_front`
  - `seeded_tab_publishes_all_visible_in_stack_order`
  - `closing_tab_clears_demand`
  - `studio_mount_publishes_pane_frame_with_pins`
  - `segmentation_pins_reference_and_editable_layers`
  - `publisher_never_sends_slot_fields`
  - `store_drops_older_seq_and_refetches_on_gap`

**Exit:** no behaviour change (the UI eviction logs are unchanged), and the shadow pass bar is met.

### R5c — backend-owned admission and eviction behind the flag (about 1.5–2 days)

**Rust:**

- **Flag:** `config.rs::backend_residency_enabled()` reads the flag once at startup, accepts `1`, `true` or `on`, and reports it as `owner`.
- **Executor:** under the flag, `manager::admit(frame)` is the single executor. It takes `volume_operations`, then the service, then `residency`.
- **Eviction** goes through `release_layer_gpu_resources_held` (`release.rs:46`).
- **Upload** goes through an idempotent `manager::ensure`: `request_layer_gpu_resources_locked` (`gpu_upload.rs:26`) returning the live info instead of 1006.
- **Refusal retry:** a bounded loop evicts the next victim and retries. This is the UI loop at `LayerEvictionService.ts:358-424`, moved.
- **Render path:** it never evicts. On pressure it notes `AllocationFailed` (`lib.rs:6870-6879`) and notifies the manager, which runs admission, clears the marks (`skips.rs:35`) and emits the event.
- **Watchdog:** becomes a manager sweep under `volume_operations`. It releases only layers that are undemanded, unpinned and stale.

**UI when `owner === 'backend'`:**

- `LayerGpuService.ts:76-83` skips `retryBudgetUpload`;
- `makeRoomForUpload` returns true;
- `startFrontWorkspaceResidency` is not started;
- adoption is unreachable but kept;
- `AtlasPressureMonitor` eviction (`:181-191`) is off;
- refusals raise one alert per frame epoch and a badge on the layer row.

**Tests:**

- GPU:
  - `front_demand_evicts_background_then_uploads`
  - `studio_pin_survives_front_switch`
  - `editable_layer_never_evicted_and_reclaimed_on_reupload`
  - `render_pressure_defers_to_manager_and_clears_skip`
  - `request_is_idempotent_for_live_layer`
  - `cancelled_ticket_installs_as_undemanded`
  - `fifteen_layer_front_draws_13_reports_two_draw_cap`
  - `flag_off_manager_never_releases`
  - `render_and_demand_race_never_releases_a_drawn_texture`: concurrent tasks; every drawn handle must still be current at submit
  - `watchdog_under_flag_skips_demanded_and_pinned`
- Vitest:
  - `backend_owner_disables_ui_eviction_and_front_restore`
  - `draw_cap_refusal_alerts_once_per_epoch`

**Exit:** the native script (§8) passes with the flag on.

### R5d — rings from the global pool (about 0.5 day)

Under the flag:

- remove `RESIDENT_RING_MAX_SLOTS` (`ring.rs:8`);
- prefetch admits a member only if `free_bytes − member_bytes ≥ headroom`, where headroom is the larger of the largest demanded primary and 5% of the budget;
- Front rings share the slack;
- a frame that goes Background shrinks to its displayed member;
- a timepoint re-upload allocates the new member before releasing the old.

**Tests:**

- `prefetch_stops_at_headroom`
- `background_ring_shrinks_to_displayed_member`
- `front_rings_share_slack`
- `displayed_member_never_reclaimed`
- `member_swap_allocates_before_release`

**Total:** about 4.5–5 days, slightly above the parent plan's 3–4-day estimate, because R5b now carries the shadow ledger and the UI publisher.

## 4. Shadow comparison (flag off)

**Episodes.**

- **What opens one:** a typed 6008 refusal from `request_layer_gpu_resources`. At that moment the policy computes `plan(Admit{requester})`.
- **What it records:** the UI's actual actions until the request succeeds, fails, or 5 s pass. Those are `reclaim_cached_image_slots` and `release_layer_gpu_resources(forUpload)`.
- **Draw-cap check:** separately, each Front frame's policy `DrawCap` set is compared with that frame's render OverCap skips.

**Log format.** One JSON line per episode, on tracing target `residency.shadow`:

```json
{"ep":17,"requester":"L","req_bytes":2048,"free":512,"policy":[{"kind":"cached","layer":"T"},{"kind":"layer","id":"A","tier":2}],"ui":[{"kind":"cached"},{"kind":"layer","id":"A"}],"verdict":"agree"}
```

`tools/residency_shadow_report.mjs` tabulates the verdicts.

**Verdicts:**

- `agree`: the same victim set.
- `benign_lru`: the same tier but a different pick. The UI's clock is `lastRenderTime`, touched for every front-visible layer (`LayerEvictionService.ts:98`); the backend uses the real `layer_last_drawn` (`lib.rs:6977`).
- `expected:<rule>`: a difference the rules account for, such as hysteresis, or the UI skipping cached members after a stats failure.
- `capacity_mismatch`: one side found room and the other refused.
- `unsafe`: either side picks a layer the other protects.
- `drawcap_mismatch`: the policy's draw cap disagrees with the render's skips.

**Pass bar:**

- at least 30 native minutes, flag off, forced budget, running the §8 scenarios;
- at least 50 episodes;
- 0 `unsafe`, 0 `drawcap_mismatch` and 0 unexplained `capacity_mismatch`;
- every benign or expected class explained, with `benign_lru` at 20% or less.

An `unsafe` verdict blocks R5c until it is triaged, even when the UI is at fault.

## 5. The two limits and the OverCap skip

- **Bytes** are global and checked only at admission. Background demand never triggers an upload.
- **Bindings** are per frame. Only a frame's first 13 distinct residency keys (16 rows) are admitted or protected on that frame's behalf.
- **An inherited tab with 15 visible layers** draws 13. The other two get `DrawCap` in the report, which makes visible what is silent today, and are neither uploaded nor protected by that frame.
- **Studio panes and segmentation views** are separate pinned frames, each with its own 13. So a Front frame's demand can evict only tier 1–3 victims, never a texture another on-screen view draws.
- **The render OverCap skip** (`lib.rs:6636`, `6897`) remains the guard. R5b proves the policy matches it exactly.

## 6. Closed tabs: keep lazy eviction

`clear_residency_demand` moves a tab's layers to tier 2 (undemanded), and pressure evicts them. Reasons:

- Layer ids are app-wide and shared across tabs (`LayerEvictionService.ts:566-588`), so release-on-clear would need the same "demanded nowhere" test anyway.
- Reopening a tab, or undoing a close, reuses the residency without a re-upload.
- Eviction stays in one place.

The R4 observation that the count does not fall after a close becomes explained in Diagnostics through `undemanded_bytes`. Explicit layer removal and segmentation discard still release at once.

## 7. Risks and containment

| Risk | Containment |
|---|---|
| Lock order | `residency` is taken after the service and never held across an upload `.await`. The `spawn_blocking` upload uses `blocking_lock` on the service (`gpu_upload.rs:207`). Only the manager evicts, under `volume_operations`. This is a reviewer checklist item. |
| Duplicate upload (a lazy render allocation races `ensure`) | `ensure` installs only when no current mapping exists; otherwise it releases its own provisional upload. Test: `request_is_idempotent_for_live_layer`. |
| Stale epochs and events | One epoch per frame, captured before I/O. Events carry `seq`, and the store refetches on a gap. Demand is republished after the renderer re-initialises. |
| 4D rings | The displayed member is always protected, and it counts as Front for a Front layer. Swaps stay on the service lock with a registry re-check (decision 4), and the lease is repointed (`gpu_upload.rs:935-945`). |
| Two policies at once | Only the backend reports `owner`; the UI never reads the environment. Test: `flag_off_manager_never_releases`. R6 deletes the flag. |
| Blank frame after a tab switch | Restore runs after the switch, as today (`frontWorkspaceResidency.ts:81-99`). Add the design's 150 ms pre-switch wait only if the native run shows blank frames. |

## 8. Native check (debug `.app`; Brainflow QA prep first: quit ChatGPT)

Fixtures are in `~/code/brainflow2/cruft/r4-native/fixtures-v2/`: 8×8×8 float32 volumes, 2,048 B of payload each.

1. **Calibrate.** Launch with defaults. Open `group-1/r4-1-01.nii` in a new tab and add `group-1/additional/*` as layers. Record Diagnostics bytes before (B0) and after (B1). Set `b = (B1 − B0) / 10`.
2. **Relaunch with the flag and a forced budget.**
   ```
   open -n --env BRAINFLOW_BACKEND_RESIDENCY=1 --env BRAINFLOW_GPU_RESIDENCY_BUDGET_BYTES=$((B0+22*b)) "<QA app>"
   ```
   Diagnostics must show owner `backend`.
3. **Three tabs.** Load groups 1–3 as in step 1: 30 layers, no error.
4. **Rapid switches.** Cycle the tabs at least 10 times, changing slices. Every tab renders, and each tab's bright spot matches `manifest.json`. Background layers are evicted and re-uploaded, never refused. The log shows no 6021, no 6001 and no render failures.
5. **15 in one view.** In group 1's tab, add `group-2/additional/r4-2-02…06`.
   - Exactly one alert appears, and layers 14–15 show a "not drawn" badge.
   - The other tabs still render.
   - A new tab opened from this one, which inherits its scene, shows the same 13/2 split with no black views.
6. **Close and reopen.**
   - Close group 3's tab. Its layers show as undemanded, and the byte count doesn't drop.
   - Under pressure, those layers go first.
   - Reopen group 3: it renders.
7. **4D.** Open `r4-time-series-6-frames.nii` in a new tab and step 1→6→1. Switch away and back; the current frame is kept.
8. **Segmentation.** Enable Settings › Modules › Segmentation, then run ⌘K "Open segmentation" on group 1.
   - Paint, undo and redo.
   - ⌥-scroll zooms and plain scroll steps slices (`SegmentViewport.tsx:230`), with no blank view.
   - Switch through every tab and back: the label is intact and is not re-uploaded unclaimed.
9. **Discard.** Discard the session. The label layer disappears, Diagnostics bytes fall by its size, and the other tabs render.
10. **Flag off.** Repeat steps 4–5 with the flag off. Behaviour should equal R4. Collect the shadow log for §4.

## 9. Decisions for the user (recommended default first)

1. **Closed tabs:** lazy eviction, rather than releasing on clear or below a low watermark. *Default: lazy.*
2. **150 ms pre-switch Front wait:** *Default: no, unless step 4 shows blank frames.*
3. **Who evicts:** *Default: the manager only; the render path never evicts.*
4. **Flag in the fixed-slot fallback (budget 0):** *Default: yes; the policy supports slot units.*
5. **Refusal UX:** *Default: one alert per frame epoch plus a row badge.*
6. **UI show-check counting 13 distinct textures instead of 16 rows:** *Default: a separate small PR after R5b.*
7. **Shadow pass bar:** *Default: 30 minutes, 50 episodes, 0 unsafe.*
8. **Flag deletion:** *Default: R6 merges within two weeks of R5c's native pass; the flag is removed in R6.*
