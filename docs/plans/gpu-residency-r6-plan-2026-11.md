# GPU residency R6 — make the backend the only owner (plan, 2026-11-09)

## Context

R5 (merged) moved GPU texture admission and eviction into the Rust backend behind
`BRAINFLOW_BACKEND_RESIDENCY`; the UI policy is gated off under it but still runs when the
flag is unset (the default). The flag-on native recheck passed (2026-11-07; stall fixed in
#53; dialogs checked 2026-11-08). Plan decision 8: R6 removes the flag and the UI policy
within two weeks of R5c's native pass (≈ 2026-11-21). Outcome: one policy (backend), about
1,050 production and 1,200 test lines of UI policy gone, no shadow ledger, no flag.

Two read-only inventories (UI and Rust, 2026-11-09, at main + #57/#58) found four things
that cannot just be deleted:
1. **Budget 0 (fixed slots) has no layer eviction under the backend.** `admit` evicts only on
   `GpuBudgetExceeded` (6008; `admit.rs:288-305`); fixed-slot exhaustion surfaces as
   `renderer_gpu_error` (`gpu_upload.rs:1215-1231`) → `UploadFailed` (`admit.rs:310-313`).
   Today only the UI evicts in that mode.
2. **Studio's retry trigger** `gpu.slots.freed` (`StudioDerivedPaneCanvas.tsx:154`) is emitted
   only by UI releases (`LayerGpuService.ts:104,160`), never by backend evictions.
3. **Browser host and dev harness** never report a backend owner (browser transport has no
   residency report; harness `devHarness/app/backend.ts:771` says `owner: 'ui'`); they run the
   UI slot policy today.
4. **Show-check / draw cap**: `LayerService.ts:199-213` counts visible rows against
   `drawLayerCap()`, which stays at the fallback 16 under the owner; the backend already
   refuses with `draw_cap` and badges the row.
   Also unverified: whether anything redraws after a backend upload (`syncLayers` emits no
   `layer.gpu.ready`).

## Approach: three PRs, each green on its own

### R6a — backend always owns (behaviour = today's flag-on)
- `core/api_bridge/src/residency/config.rs`: delete `backend_residency_enabled` (`:41-57`) and its
  test; `manager.rs`: `backend_owner` field/getter/`set_backend_owner` (`:184-185,222,227-256`)
  go; every flag branch keeps its flag-on side (table: `gpu_upload.rs:16-69,917-959`,
  `manager.rs:455-467,640-667,765-767`, `ring_pool.rs:191`, `watchdog.rs:83-95`,
  `skips.rs:30-32`).
- **Budget 0 fix**: `admit` treats fixed-slot exhaustion like 6008 — make the slot-exhaustion
  error typed (not the generic `renderer_gpu_error`) and route it through the same
  evict-then-retry in `admit.rs`/`gpu_upload.rs`, planning in slot units (`manager.rs:397-404`).
  Keep `RESIDENT_RING_MAX_SLOTS` (the ring pool needs a byte budget). New test: flag-free,
  `FixedSlots`, N+1 layers → oldest background evicted, front kept.
- Report `owner` stays, pinned to `Backend` in this PR (UI then gates its own policy off —
  the same state the native check passed). Removed in R6c.
- Delete the shadow ledger: `residency/shadow.rs` (892 lines, 7 tests), re-export `mod.rs:71`,
  caller `lib.rs:7035`, `shadow.expire` (`manager.rs:758-762`), `tools/residency_shadow_report.mjs`.
  Move `ShadowLedger.refusals` (used by `admit.rs:82-88,158-161`, `gpu_upload.rs:60`,
  `manager.rs:720`) onto `ResidencyState`.
- Tests: delete flag-off/shadow tests (~13, e.g. `flag_off_manager_never_releases`,
  `shadow_*`, `draw_cap_shadow_matches_*`); drop `set_backend_owner(true)` from the 15 owner
  tests (helpers `owned_two_texture_state`, `owned_series_state`); rework
  `render_pressure_defers_to_manager_and_clears_skip` (it flips the flag off to stage a skip)
  and `residency_changed_emits_after_upload_and_release` (asserts `Owner::Ui`). Every other
  bridge/integration test now runs owned: re-run all, expect ring tests around
  `lib.rs:12133-13018` and `tests/render_view_smoke_test.rs` to need attention.

### R6b — delete the UI policy (UI only)
- Delete: `LayerEvictionService.ts` (keep nothing but what the show-check decision needs),
  `frontWorkspaceResidency.ts` + its start in `useServicesInit.ts:123-125`,
  `AtlasPressureMonitor` eviction (`:183-195,211-293,308-339`; keep warnings/polling),
  `LayerGpuService` retry/`forUpload`/`reclaimCachedImageSlots` (`:74-100,150-162`),
  `LayerApiImpl` reconcile/adoption/room-making (`:107-153,187-222,251,421`),
  `StudioDerivedMapService` `makeRoom` + `GpuSlotsFullError` regex branch, slots-full helpers in
  `formatTauriError.ts:116-188`, `LayerService.ts:249-261`, `DisplayLifecycleOrchestrator.ts:475`,
  `layerStore.lastRenderTime`.
- **Show-check**: delete `LayerService.ts:199-213` and `drawLayerCap`/`drawCapMessage`; the
  backend's `draw_cap` refusal and row badge (`useSceneStack.ts`) are the single source.
- **Studio retry**: replace `gpu.slots.freed` with the residency report — retry when
  `residency-changed` shows used bytes/slots fell or the pane's layer's refusal cleared
  (`residencyStore`); then delete `gpu.slots.freed` and `layer.gpu.evicted` from `EventBus.ts`.
- **Redraw after backend upload**: check in the QA app; if missing, have
  `residencyStore.syncLayers` emit `layer.gpu.ready` when a layer becomes resident.
- **Browser host / dev harness**: no UI slot policy; harness mock reports `owner: 'backend'`
  with plain stats; browser transport keeps no residency report (its renderer refuses on its
  own). `transport.ts:374-399` drops `reclaim_cached_image_slots`.
- `residencyStore`: `backendOwnsResidency()` and the `owner === 'backend'` check (`:131`)
  become unconditional; `useSceneStack.ts:37` drops the owner check; fix the
  `ResidencyDemandPublisher.ts:19` comment.
- Tests: delete ~1,200 lines (`LayerEvictionService*.test.ts`, `frontWorkspaceResidency.test.ts`,
  slots-full blocks listed in the inventory); repoint `StudioDerivedPaneCanvas.test.tsx:196-222`
  at the new trigger; keep `ResidencyDemandPublisher.test.ts`, the `draw_cap_refusal_alerts_once_per_tab` test.

### R6c — remove what only the UI path used (Rust + generated TS)
- `reclaim_cached_image_slots` command (`lib.rs:6214-6235`, `ring.rs:81-110`,
  `command_list.rs:46`, `permissions/default.toml:68`, autogenerated permission, schemas,
  `bindings/ReclaimCachedSlotsResult.ts`, `ui2/src/types/atlas.ts:227`).
- `for_upload` arg (`lib.rs:3678-3681`) and `release_layer_gpu_resources_with` (`release.rs:18-37`).
- `ResidencyOwner` + `ResidencyReport.owner` (`manager.rs:92-98,159`), regenerated TS in
  `packages/api/src/generated/`, and the UI's last `owner` reads.
- Keep: `release_layer_gpu_resources` (layer removal), `request_layer_gpu_resources`, demand and
  report commands, the legacy release-then-re-upload ring path (needed for ring off, 3-D,
  repoint failure — none flag-related).
- Stale comments: `manager.rs:102`, `release.rs:12-17`, `ring.rs:105-107`, `lib.rs:314,3684`, `admit.rs:1`.
- Docs: R6 record in `docs/plans/gpu-residency-r5-plan-2026-11.md`; this plan saved as
  `docs/plans/gpu-residency-r6-plan-2026-11.md` before starting.

## Verification
- Per PR: `cargo test -p api-bridge -p render_loop -p brainflow`, clippy `-D warnings`, fmt;
  `vitest` (full ui2), `tsc -p tsconfig.app.json`; `e2e/harness/workspace-browser.spec.ts`.
- R6a extra: the new fixed-slot eviction test; mutation-check it (remove the slot-exhaustion
  route → test fails).
- Native check after R6b and again after R6c (debug QA app, flag unset, 24 KiB budget for
  pressure and budget 0 separately): §8 steps — five tabs/31 layers with tab switches, one alert
  per over-cap tab, 4D series stepping via the ring (no "Re-uploading 4D"), segmentation paint/
  undo/switch, Studio pane retry after pressure, redraw after a backend upload; log free of
  6001/6008/6021 errors and panics.
- Fresh-context review of each PR before merge.

## Open item before starting
- ⌥-scroll zoom in the segmentation view still needs one manual check (not R6 work).

## Native check after R6c — 2026-11-13 (branch `refactor/r6c-residency-cleanup` at `ee42fb2a`)

Debug `.app` built from the branch, fixtures `cruft/r4-native/fixtures-v2`, full-screen control. ChatGPT's invisible window was open and blocked clicks in the middle of the screen, so some clicks went through the window-local tools instead.

**Byte budget (`BRAINFLOW_GPU_RESIDENCY_BUDGET_BYTES=24576`): passed**
- **Load:** groups 1–3 and the 6-frame series, 31 layers over five tabs (layers are shared across tabs).
- **Over the draw cap:** a view past 13 layers raised one "not drawn" alert per tab ("r4-3-07.nii and 7 more…"), and the extra rows were badged.
- **Tab switches:** 12 rapid switches with crosshair moves. Every view rendered.
- **Pressure:** 11 releases under pressure.
- **4D:** stepped 1→6→3 through the ring, with no "Re-uploading 4D".
- **Close a tab:** the other views kept rendering.
- **Segmentation on r4-1-01:**
  - setup preview rendered (no stall);
  - paint 22 mm³, undo 0, redo 22;
  - label intact after switching through every tab;
  - discard asked first, then removed the label layer, whose texture was released.
- **Log:** no 6001/6008/6021, no ERROR lines, no panics. The only warnings were draw-cap skips.

**Fixed slots (`…BUDGET_BYTES=0`, 13 slots): passed, with one transient warning**
- **All 13 slots front-drawn:** with every slot holding a layer drawn in the front view, a 14th load is refused with "GPU texture slots full (all 13 in use). Hide or remove a layer, then load again." Nothing could be evicted, so this is the correct answer.
- **Eviction:** in a tab where two layers were background, adding two layers evicted those two (R6a's fixed-slot eviction).
- **Switching back:** returning to the tab that draws them evicted the other two and drew all 13.
- **Transient warning:** one frame logged a single `6024 Maximum texture limit 13 reached` skip for a returning layer before admission caught up. The layer was re-added and drawn within a second, which is the starved-layer retry covered by `an_admission_eviction_keeps_starved_layers_waiting_until_the_upload_ends`.
- **Log:** no ERROR lines, no panics.

**Not checked:** ⌥-scroll zoom in the segmentation view. Computer-use scroll does not carry modifier keys, so this still needs a manual check. Logs are at the session scratchpad (`r6-native-bytes.log`, `r6-native-slots.log`); they are local and not committed.
