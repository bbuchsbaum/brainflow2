# R5 implementation plan: backend residency owner

**Status:** approved by the user with the §9 defaults (2026-11-06). R5a merged. R4 qualified 2026-11-06 (§0 closed). R5b implemented on `feat/r5b-residency-demand` (§10); its §4 native shadow run met the pass bar on 2026-11-07.

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

**Carried from the R5a review (2026-11-06):**

- **Hidden pins.** The publisher lists hidden pinned layers, such as a segmentation editable label, in `FrameDemand::held`. The UI never evicts `segmentation.editable-label` layers, visible or not (`LayerEvictionService.ts:51,476`), and `held` keeps that rule.
- **Render pre-check.** The pre-check (`lib.rs:6642-6648`) falls back to the volume residency without the `!requires_timepoint` exclusion that the main lookup (`lib.rs:6683`) applies. At capacity, a 4D layer whose volume texture is bound allocates its own texture, and only the backstop skips it. Fix this before the draw-cap shadow comparison, or `drawcap_mismatch` reports it.
- **Pending uploads.** `BridgeTextureBackend` either counts an upload in flight in `used` or lists it as a resident with `upload_in_flight`. `ResidencyFacts` has nowhere else to hold it.
- **Ledger entries.** Cleared frames keep their epoch for life. That is fine at tab counts; prune them if frame ids ever churn.

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

## 10. R5b record — 2026-11-06

Branch `feat/r5b-residency-demand`, from `main` at `a772fa8f`.

**Rust (`core/api_bridge`).**
- `residency/manager.rs`:
  - `Residency` holds the ledger, a revision, `seq` and the shadow ledger. It is held alone: nothing is acquired under it (lock-order doc in `residency/mod.rs`).
  - `snapshot()` builds `ResidencyFacts` from the service, `resident_image_sets`, the registry and the leaf maps, never from a mirror. Per-resident bytes include the slot's mask.
  - An upload in flight counts in `used` (its texture is in the store before `layer_slots` has it).
  - The report and the wire types are `#[ts(export)]`, with no slot, index or generation fields. `owner` is `ui`.
- **Commands** in `lib.rs`: `set_residency_demand`, `clear_residency_demand` and `get_residency_state`. They are registered, granted in `default.toml`, and exported to `@brainflow/api`.
- **`residency-changed`:** a 50 ms task that `try_lock`s the service. It reports when the store's new `residency_revision()` or the bridge revision (demand or refusal changes) moved. It keeps rebuilding for 10 ticks after a change, because a layer mapping lands after its upload's store bump, and it sends only reports whose body changed. A report is numbered while the service is still held.
- **`residency/shadow.rs`, episodes:**
  - A typed retryable 6008 from `request_layer_gpu_resources` opens one, with the policy's `plan(Request::Layer)` and its allowed candidates.
  - UI `release(forUpload)` and reclaims are credited to the episode of the layer refused last; the UI makes room for one upload at a time.
  - The episode closes on admission (1006 "already owns" counts), on another failure, or after 5 s.
  - Verdicts: `agree`, `benign_lru`, `unsafe` (the UI evicted what the policy protects), `capacity_mismatch` and `unexplained`. Each is one JSON line on target `residency.shadow`.
- **`residency/shadow.rs`, draw cap:** after each frame, the render's OverCap skips are compared with `draw_set` for the Front demand that lists exactly the frame's drawable layers. The comparison is memoised on (store revision, bridge revision, layers, skips): one comparison per change, not per view or redraw.
- **Render pre-check fix (R5a review):** the binding pre-check no longer lets a time-series layer fall back to its volume's residency. It reads the registry without failing, so a skipped layer whose volume is gone does not fail the frame.
- **Tests:**
  - `demand_epochs_monotonic_per_frame`, `report_serializes_without_binding_or_slot_fields`, report draw-cap marking, Background `last_front_at`, wire parsing, verdict rules, episode expiry and attribution.
  - GPU: `residency_changed_emits_after_upload_and_release`, `shadow_episode_records_ui_victims_and_policy_plan`, `shadow_flags_a_ui_eviction_of_a_front_layer_unsafe`, `draw_cap_shadow_matches_render_over_cap_skips` (15 layers, memo, missing volume) and `time_series_layer_at_binding_capacity_neither_borrows_nor_allocates`. The last fails without the pre-check fix.

**UI (`ui2`).**
- **`services/ResidencyDemandPublisher.ts` frames:**
  - every view tab, keyed by workspace id: Front when active, Background otherwise;
  - the active tool tab only while a render-layer scope is set (the Studio's current member). A tool tab draws nothing otherwise (A12);
  - `studio-panes`, the held Studio maps: Front while a tool tab is in front.
- **Publisher layers and pins:** layers are drawable only (visible, opacity above 0), bottom first. Pins come from `segmentation.editable-label`, document-protected volumes and borrowed Studio underlays; hidden pinned layers go in `held`.
- **Publisher sending:**
  - A frame is sent only when its body changed, and closed tabs are cleared.
  - Epochs start at `Date.now() × 1000`, so a reload never sends a stale epoch. On start, frames the backend holds that this session does not publish are cleared.
  - The browser host is skipped.
- **`stores/residencyStore.ts`:** applies reports in `seq` order and refetches once on a gap. A fetched report never refetches.
- **Other changes:** change notices in `StudioDerivedMapService` (`subscribe`, `heldMaps`) and `workspaceDocuments` (`subscribeWorkspaceDocuments`). The three commands are added to the dev harness and the mock transport.
- **Tests:** the eight in §3 plus epoch ordering, per-session epochs and leftover-frame clearing (`services/__tests__/ResidencyDemandPublisher.test.ts`).
- **`tools/residency_shadow_report.mjs`:** tabulates the verdicts against the §4 pass bar. `unexplained` fails it.

**Gates (before the review fixes):**
- `cargo test -p api-bridge -p render_loop`: 939 passed, 0 failed (Metal).
- vitest: 4,359 passed. Two files failed under load or setup and pass alone: a missing `packages/visualization/node_modules` link in this worktree, and the BIDS palette timing test.
- Strict permission check OK. eslint shows only the 5 existing errors in `useServicesInit.ts`.
- A typecheck against this worktree's `@brainflow/api` is clean; ui2's `node_modules` link resolves the main checkout's package, so a plain `tsc -b` here would not see the new types.

**Gates after the review fixes:**
- `cargo test -p api-bridge -p render_loop`: 940 passed, 0 failed.
- vitest: 544 files, 4,363 passed.

**Review (fresh context):** no blocking issues. Fixed:
- stale reports;
- the per-frame draw-cap cost;
- episode cross-attribution;
- epochs after a reload;
- mask bytes;
- the hoisted fallible timepoint lookup;
- `seq` ordering;
- 1006 counted as admitted;
- `unexplained` failing the pass bar;
- mock-transport defaults.

Not fixed, for the shadow run to show or R5c to handle:
- a 4D ring swap refused under pressure is still counted as bound by `draw_set` (rare: more than 13 layers under pressure);
- only the UI side of `unsafe` is checked (a policy pick the UI protects is not flagged);
- UI releases not made for an upload (pressure monitor, front restore) are not recorded;
- `refusals` are not pruned when a layer is removed.

### §4 shadow run — 2026-11-07 (exit met)

**Setup.** Debug `.app` (`Brainflow R5 QA`) at `182af4bb`, flag off, `BRAINFLOW_GPU_RESIDENCY_BUDGET_BYTES=24576`, fixtures `fixtures-v2` (8×8×8; textures are 1 KiB or 2 KiB). One uninterrupted run, 15:47:13–16:17:13 UTC (30 min), §8 steps 3–7: 31 layers in three tabs (one file was added twice), rapid switches with slice changes, 16 visible in tab 1 (3 past the draw cap), tab 3 closed and a new view opened, the 4D load, then switching to the end.

**Result: pass bar met.** 648 episodes:

| verdict | n | share |
|---|---|---|
| `expected:undemanded` | 256 | 40% |
| `expected:tie` | 145 | 22% |
| `expected:draw_cap` | 91 | 14% |
| `benign_lru` | 88 | 13.6% |
| `agree` | 57 | 9% |
| `expected:demand_lag` | 11 | 2% |
| `unsafe`, `capacity_mismatch`, `unexplained`, `drawcap_mismatch` | 0 | |

No 6001/6021 and no error lines in the log. `benign_lru` comes mostly from the 16-layer phase: layers past tab 1's cap are never drawn while it is in front, so the policy's real `last_drawn` puts them first, while the UI's `lastRenderTime` is touched for every visible layer (the clock difference §4 names).

**Fixes the earlier runs forced** (`281080e5`, `0f06fc1d`, `182af4bb`):
- Policy: one Background frame's layers go least recently drawn first.
- Publisher: demand is sent at most 16 ms after the first change. The debounce restarted on every store change, so during an upload storm the UI evicted for the new front tab while the backend still held the old demand (7 `unsafe` in one run).
- Verdicts: `expected:demand_lag` (a UI pick allowed by the demand current at close), `expected:draw_cap` (any frame's cap; a UI upload the policy refuses with DrawCap), `expected:undemanded` (residents no frame lists, §6). `benign_lru` compares the deepest tier reached and `expected:tie` the set of ordering classes: textures differ in size, so equal decisions can differ in count.
- Unit tests for each rule, including the lag recheck and Background-frame caps.

**Findings for R5c.**
- **Untracked residents (UI, predates R5b).** The render path allocates textures on demand for drawable layers (`lib.rs` ~6892); the UI marks a layer resident only after its own upload (`LayerApiImpl.ts:147`). A texture the render path re-uploads after the UI evicted it stays resident unknown to the UI. Once its tab closes, nothing evicts it: in the run the closed tab's layers stayed resident (256 `expected:undemanded`), and opening `r4-time-series-6-frames.nii` failed with "GPU residency budget exceeded" while the UI found no victim (§8 step 7 could not be completed under this budget). Confirmed from the code and the logs, not reproduced on a `main` build. R5c's backend owner fixes this by construction; `cancelled_ticket_installs_as_undemanded` and an undemanded-first test should cover it.
- **Size-aware tie-break.** Within one ordering class the policy breaks ties by key; preferring the larger texture would often need one eviction where it now needs two.
- **QA note.** With Stage Manager on, background clicks cannot reach the app once it is a side tile; the run used full-screen control. Under Node 26, vitest needs `NODE_OPTIONS=--no-experimental-webstorage`.

**Gates at `182af4bb`:** `cargo test -p api-bridge -p render_loop` 947 passed, 0 failed (Metal); vitest 544 files, 4,364 passed; clippy on `api-bridge` shows only the existing ts-rs serde-attribute warnings.

## 11. R5c design notes — 2026-11-07

Branch `feat/r5c-backend-residency`, stacked on R5b (#48). Everything here is behind `BRAINFLOW_BACKEND_RESIDENCY`. With the flag off, behaviour is R5b's.

**Flag.** `config::backend_residency_enabled()` reads `BRAINFLOW_BACKEND_RESIDENCY` once (`1`, `true` or `on`, any case). The report's `owner` is `backend` under it.

**One executor: `manager::admit`.**
- It holds `volume_operations` for the whole pass. The upload and release it calls are `_held` variants: `request_layer_gpu_resources_locked` is split into the lock plus `request_layer_gpu_resources_held`, as release already is.
- For each Front frame, and then for the requesting layer (`Request::Layer`), it plans from a fresh snapshot. The residency lock is held only while planning, never across an await on the service.
- It runs the evictions in order:
  - a layer through `release_layer_gpu_resources_held`;
  - a cached 4D member through a new `ResidentImageSet::release_cached_member`.
- Then it runs the uploads in order through `ensure`. A live residency counts as success, not 1006.
- If an upload is still refused (6008), because the estimate was off, it re-plans and retries, bounded by the number of residents.
- Refusals are recorded with their reason, so the report shows them; admission clears them. The executor then marks residency changed.

**Triggers.**
- `set_residency_demand` (or `clear`) applied under the flag runs `admit` before returning. The publisher sends within 16 ms of a tab switch, so the new front tab's layers upload without a UI front-restore pass.
- `request_layer_gpu_resources` refused with 6008 under the flag runs `admit` for that layer, then retries once. The UI no longer retries.
- The render path's `AllocationFailed` skip under the flag sets `admission_wanted`. The residency tick runs `admit` when that is set and no admission is running. The render path never evicts.

**Watchdog.** Under the flag it releases only layers that are stale and also undemanded and unpinned in the ledger.

**UI, when the report's `owner` is `backend`.**
- `LayerGpuService` does not call `retryBudgetUpload`; a 6008 is final, since the backend has already tried.
- `makeRoomForUpload` returns true, `startFrontWorkspaceResidency` is skipped, and `AtlasPressureMonitor` does not evict.
- `residencyStore` syncs each layer's `gpuResident` from the report: resident is true, evicted or refused is false. This closes the untracked-residents gap from §10, because the UI no longer decides evictions from its own metadata.
- A refusal raises one alert per frame epoch and puts a badge on the layer row.

**Tests:** §3's list, plus `closed_tab_layers_go_first_and_free_room_for_a_new_upload`, covering the §10 finding.

### R5c record — 2026-11-07

Commits: `b73c2921` (these notes) through `b24739d2`, on `feat/r5c-backend-residency`, stacked on R5b (#48).

**What changed from the design above.**
- **Lazy eviction** (`residency/admit.rs`). The policy sizes a texture not yet uploaded by an upper bound: an f32 volume often fits R16Float, and the fixtures show 1 KiB and 2 KiB textures for the same payload. Following the plan's eviction list as written therefore evicted, and refused, too much. The executor instead:
  - tries each upload, including layers the policy refused for size alone (FrontExceedsBudget, HeldByPinned);
  - on a budget refusal, evicts the next victim (the plan's, then the other allowed candidates) and tries again;
  - evicts nothing unless the victims left could free the refusal's own shortfall;
  - re-checks each victim against the demand current when it evicts.
  
  A UI request refused for budget is handled the same way, one victim at a time.
- **Remembered sizes.** Snapshots remember each uploaded volume's real texture size and use it after eviction. This applies under the owner only.
- **Owner per bridge.** The switch lives on `Residency`, read from the flag and settable in tests. `get_residency_state` answers before the renderer starts, with the owner and no layers.
- **Refusals.** They are dropped once no front tab lists the layer, and cleared when the layer's own request succeeds.
- **UI** (when the owner is `backend`):
  - no UI eviction, room-making, front restore or pressure eviction;
  - a budget refusal is final;
  - `gpuResident` follows the report;
  - one alert per tab and reason, naming the layers;
  - rows show "not drawn: <reason>".

**Review (fresh context).** Fixed: mass eviction for an upload no room can fix, stale victims during a long admission, the startup window before the first report, stale refusal reasons, and flag-off drift from remembered sizes. Not fixed, all low:
- a report snapshot taken before an upload's mapping lands can flip `gpuResident` false for one tick;
- the watchdog skips any layer whose volume a frame demands;
- a size-refused layer that does upload is tried after the plan's admissions, so it can push a later one past the draw cap.

**Gates.**
- `cargo test -p api-bridge -p render_loop`: 960 passed, 0 failed (Metal).
- Workspace clippy `-D warnings` and fmt are clean.
- vitest: 545 files, 4,369 passed.
- eslint on the touched files shows only the existing errors.
- GPU tests: front demand evicts background then uploads; a studio pin survives a front switch; closed-tab layers go first and free room for a new request; a front tab over budget is refused without evicting the front; an upload no room can fix evicts nothing (it fails without the guard); 15 layers draw 13 and report two draw-cap refusals; with the flag off nothing is released; render pressure defers to the next tick and clears the skip; the watchdog skips demanded layers; a refusal is dropped once no front tab lists the layer; the owner is reported before the renderer starts.

**Native check, flag on** (`BRAINFLOW_BACKEND_RESIDENCY=1`, 24 KiB budget, at `8cd8d2ea`):
- **Step 3:** 30 layers in three tabs, no error. 14 evictions, all by the backend.
- **Step 4:** rapid switches with slice changes. Every tab renders its own layers. The log has 244 backend evictions by the end and no 6001, 6021 or error lines.
- **Step 5:** 16 layers in one tab draw 13. Layers past the cap show "not drawn: too many layers". The alert then repeated per layer and per return to the tab; this was fixed in `b24739d2`, which has unit tests but has not been rechecked natively.
- **Step 6:** closing a tab leaves the other tabs rendering.
- **Step 7:** the 6-frame series loads (it failed with "GPU residency budget exceeded" in the R5b run), steps 1→6→1, and keeps frame 3 across a tab switch.
- **Step 8:** segmentation on r4-1-01: paint, undo, redo and slice stepping work, and the label survives tab switches. ⌥-scroll was not tested (the tools could not send the modifier). The editable label sits past tab 1's cap in that tab's own views, so it is alerted as not drawn there; the segment views draw it.
- **Step 9:** discard removes the label layer and releases the session's textures; the other tab renders.
- **Open:** a segmentation started on the 4D series stayed at "Preparing the loaded reference…" with no bridge activity. This is not yet checked against R5b, so it may predate R5c.

**Next.** R5d (rings from the global pool), then R6. Before R6 deletes the UI path, the flag-on native check should be repeated once at the merged state.

### R5d record — 2026-11-07

Commits `b711b2e2`, `5bbfa56a` and `7e294ca7`, on `feat/r5d-ring-pool`, stacked on R5c.

**What it does.** Under the owner with a byte budget (`residency/ring_pool.rs`):
- **No fixed cap.** A 4D ring has no six-member cap and no per-ring budget.
- **Growth.** A ring takes one more texture, for the requested member or a prefetch, only while both of these hold:
  - the free bytes after it stay at or above the headroom: the larger of the largest demanded primary and 5% of the budget;
  - its cached members stay within its share.
- **Share.** The share is the Front rings' slack (free bytes plus what their cached members hold, less the headroom), divided equally among them.
- **Rebalancing.** Each swap trims the other Front rings back to the share. The swapping ring is trimmed too, once its new member is shown.
- **Shrink.** Rings that only unpinned Background frames demand are shrunk to their displayed member whenever demand changes.

**Design changes.**
- **What counts as front.** A pinned layer (a studio pane, drawn though its frame is Background) and a layer no frame lists yet count as front. "Front" therefore means "not behind" rather than "listed by a Front frame".
- **Trim order.** Trimming frees the cached member farthest from the displayed one. LRU would take the member just shown, because prefetched neighbours are touched after it.
- **Allocate before release.** No release happens on a member change. A miss either uploads the new member into a fresh texture, with the old one still resident, or, with no room to grow, overwrites the ring's own least recently used texture in place.
- **Unchanged paths.** The legacy release-then-re-upload path stays only for the fallback cases: the ring disabled, a 3-D volume, or a repoint failure.
- **Closing a tab.** It asks for an admission on the next tick.

**Review (fresh context).** It found no lock-order problem, no flag-off change and no path that frees a displayed member. Its findings:
- Fixed: rings did not really share the slack (a ring gave back its excess only on its own swap); pinned and unlisted layers were treated as behind; the trim freed the member just shown; closing a tab did not admit.
- Not fixed, test-only: a ring keeps the mode it was created in if the owner flips at runtime. The flag is read once.

**Gates.**
- `cargo test -p api-bridge -p render_loop`: 966 passed, 0 failed.
- Clippy `-D warnings` and fmt are clean.
- The UI is unchanged.
- New tests: `prefetch_stops_at_headroom`, `front_rings_share_slack` (static: `a` never swaps again), `background_ring_shrinks_to_displayed_member` (with a pinned studio pane that keeps its ring), `displayed_member_never_reclaimed`, `member_swap_allocates_before_release` (both branches), and `growth_keeps_headroom_and_the_share`.
- Each R5d test except `displayed_member_never_reclaimed` was mutation-checked: removing the growth gate, the shrink, the cross-ring trim or the pin rule makes it fail.

**Native check, flag on** (24 KiB budget, at `7e294ca7`):
- Step 7: the 6-frame series loads and steps 1→6→1, ten timepoint changes in all.
- Frame 1 reads the same value at the crosshair as at load.
- The log has no warnings or errors and no "Re-uploading 4D" line. Its only extraction is the initial load, so every step was a ring swap.
- **Not checked:** the switch away and back (opening a second tab needs full-screen control, which timed out); the Diagnostics byte count (a pop-up the background tools cannot open). Both should be part of the repeat native check before R6.

**Next.** R6. First repeat the flag-on native check (§8) at the merged state, including the tab switch with a 4D tab and the R5c alert fix.

### Pre-R6 native recheck — 2026-11-07 (main at `e7e16d18`)

QA app built from main. `BRAINFLOW_BACKEND_RESIDENCY=1`, 24 KiB budget, unless stated otherwise. Full-screen control was used. ChatGPT's invisible window was gone by the time it mattered.

**Passed**
- **Load and pressure (steps 3–4).**
  - Five tabs, 31 layers (groups 1–3 and the 6-frame series), no errors.
  - Ten rapid tab switches before the pressure and eight after it.
  - 11 releases under pressure. No 6001, 6008, 6021, error lines or panics.
  - The only warnings were the expected draw-cap skips.
- **Alert fix from R5c (`b24739d2`).**
  - Two tabs went past 13 layers. Each raised exactly one alert. The second named "r4-2-05.nii and 6 more".
  - Neither alert came back across 18 switches that returned to both tabs.
- **4D under pressure (step 7).**
  - The series opened in its own tab and stepped to frame 3.
  - Switching to the group-1 tab and back kept frame 3 and the same crosshair value.
  - No "Re-uploading 4D" line: every member change went through the ring.
- **Segmentation on r4-1-01 (step 8, simple setup).**
  - Setup preview rendered.
  - Paint gave 20 mm³. Undo gave 0, redo gave 20.
  - The label was intact after switching away and back.
  - Plain scroll steps slices.

**Not checked**
- **⌥-scroll.** The computer-use scroll action does not deliver modifiers to wheel events: ctrl-scroll also stepped a slice, and the code zooms on either key (`SegmentViewport.tsx:230`). This needs a manual check.
- **Diagnostics byte count.** The pop-up shows MiB to one decimal, so a 24 KiB budget always reads 0.0. The pop-up has no owner row.
- **Discard (step 9).** Not rechecked. It passed in R5c.

**Open: segmentation setup stall on a 4D reference.** "Open segmentation" in the crowded session picked the 4D series (frame 3) as reference and stayed at "Preparing the loaded reference…".
- The header read "slice 4 / 8", so `get_volume_info` had resolved.
- The bridge logged nothing after it.
- It did not reproduce in either simple setup (only the 4D loaded, flag on or off).

A code trace of the UI found no wait that the R5c owner gates leave pending. Every gate returns at once under the owner. That leaves two candidates:
- **(A) A silent exit when the view changes mid-request.** `RegistrationPreview.tsx` returns without setting state or an error when `lease.isCurrent()` turns false, and nothing re-runs the effect. This is not specific to the flag.
- **(B) A backend call that never returns.** Neither `get_volume_native_plane` nor `request_layer_gpu_resources` logs before taking its lock, so a call stuck behind `volume_operations` or the service lock leaves no trace.

Next steps:
- Run the crowded setup with the flag off to tell A from B.
- Make the preview retry or report a stale lease instead of returning silently.
- Log entry and exit around those two commands.

**Before R6:** settle the stall (A or B), and check ⌥-scroll by hand.

**Stall resolved** (`fix/segmentation-preview-stall`). It was neither A nor B, and not residency.
- **Cause.** The web inspector showed the preview's error in the DOM: "The comparison image is not attached to this workspace".
  - The setup took the tab-shared layer selection as its reference. That was the 4D series, last selected in another tab and not held by this view.
  - The preview drew the error at its bottom edge, under the bottom dock, so only "Preparing…" was visible.
- **Fix.**
  - The reference is the selection only when this view holds it; otherwise the view's visible image.
  - Secondary choices are limited to this view's images.
  - Errors show in place of the image.
  - The preview also retries a request dropped by a view change, and reports a reference not shown within 15 s.
  - The bridge warns about lock waits of 250 ms or more.
- **Verification.** The same crowded flag-on scenario now picks this view's base image (r4-1-10) and renders, with a clean log. The segmentation tests pass: 211, including new mutation-checked regressions.
