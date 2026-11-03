# Plan: GPU texture residency (fixes N31, N32, N34, N37, BIDS run-switch "slots full")

**Status:** approved by the user on 2026-11-02, Phases 1–3. Implementation waits for the shared checkout. Once the branch exists this moves to `docs/plans/gpu-residency-2026-11.md`.

## Diagnosis

Line numbers refer to origin/main `07b494d9`.

- **Two limits are merged into one.**
  - The resident-texture budget is **13**, global, set by Metal's limit of about 30 sampled textures per stage (`multi_texture_manager.rs:29`).
  - The draw cap is **8 layers per frame** (`render_loop/src/lib.rs:64`).
  - The UI takes `min(13, 8)` (`LayerEvictionService.ts:96`) and enforces 8 as a *global residency* budget across all tabs and Studio panes. Users therefore run out at 8 resident layers, when the real limit is 8 *drawn in one view*.
- **4D ring members are invisible to the UI.**
  - Each 4D layer can hold up to 6 extra slots (`RESIDENT_RING_MAX_SLOTS`, `api_bridge/src/lib.rs:7517`).
  - The UI counts layers, not slots, so two 4D layers already use about 12 of the 13 slots. That is the BIDS run-switch failure.
- **Eviction is too narrow.** `evictOneIf` only evicts layers hidden in *every* workspace. A layer shown only in a background tab, or a cached ring member, is never given up, even though nothing on screen needs it.
- **Studio panes never retry.**
  - `StudioDerivedMapService` throws `GpuSlotsFullError` once and the pane stays in that state.
  - Nothing re-requests the map when slots free up (N32).
- **Editable labels lose their claim.**
  - A label volume re-uploaded by the lazy render path (`allocate_gpu_resources_for_layer`, `lib.rs:7731`) or the label-aware upload never re-runs `claim_editable`.
  - `editable_handle_for_volume` then returns None, giving "Editable texture slot N is no longer resident" (`editable_labels.rs:168`).
  - Retry repeats the same lookup, so it never recovers (N34).
- **Refusals are not toasts.** They are `ui.notification` events that this build routes to a middle-truncated status-bar item (N31).
- **A layer leaks on discard.** Discarding a session leaves its "Segmentation labels" layer in the scene, still holding a slot (N37).

### Additions from brainflow2-d1's independent investigation

- **The 8-layer cap is largely vestigial.**
  - The runtime shader reads layers from a storage buffer (`slice_world_space_masked.wgsl:113`), and the per-frame list is rebuilt every frame.
  - Every *upload* still calls `add_layer_3d` (`api_bridge/src/lib.rs:4713`), so uploads count against 8.
  - Fix: stop counting at upload, and raise the per-frame cap to 16, matching `MAX_OUTLINE_LAYERS`.
  - Above about 15 *resident* textures we would need shared mask bindings, a `binding_array` or an atlas. That is out of scope.
- **Why N34's Retry fails.** Retry calls `ensureModuleLabelLayer`, and `request_layer_gpu_resources` refuses with "already owns GPU resources" (`:3926`). Retry has to release first, then re-request.
- **Why N32's backend never retries.** `render_skipped_layers` marks `AllocationFailed` and never retries (`lib.rs:8603-8615`). A release clears only its own entry, so it must clear every `AllocationFailed` entry. On the UI side, `StudioDerivedPaneCanvas.tsx:70-92`'s effect depends only on `[sourcePath, studioActive]`.
- **A wasted Studio slot.** The template underlay loads a fresh MNI volume handle (`StudioDerivedMapService.ts:222`) instead of reusing the workspace's MNI layer.
- **Where N37 comes from.** `forgetSegmentationSession` (`segmentation/session.ts:223`) removes the frame volumes but not `labelVolumeId`. Keep the `isLiveDocument` guard.
- **N31 is a design gap.** No floating toast exists; `NotificationToast` lives inside the `StatusBar`.

**Conflict note:** d1's branch edits `session.ts` (sliceIndex seeding and frame display), and N37 also touches `session.ts`. Branch after d1's branch merges.

## Approach

The backend's slot accounting becomes the single source of truth. The UI stops modelling GPU capacity and asks the backend instead. Work is in phases; each phase lands, and is verified, on its own.

### Phase 1: correct budget, wider eviction, and retry (UI plus small bridge changes)

0. **Raise the draw cap.**
   - Stop counting uploads against the draw cap (`add_layer_3d` at upload).
   - Raise `MAX_RENDER_LAYERS` to 16, after checking the remaining fixed-size UBO paths.
   - Clear every `AllocationFailed` entry on any release.
   - Have the Studio template underlay reuse the workspace's MNI handle.
1. **Split the budgets.**
   - Residency uses `volumeTextureSlots` (13) and the backend's *free* slot count. `AtlasStats` already exposes `free_slot_count` and `resident_slot_count`, so ring members are counted.
   - The 8-layer draw cap is enforced only per view, when a 9th layer becomes visible *in the same workspace*. The message then reads "Only 8 layers can be drawn in one view."
2. **Widen eviction, in this order:**
   1. cached ring members, via a new bridge call (`reclaim_cached_image_slots(n)`) that wraps the existing `reclaim_cached_image_slot`;
   2. layers hidden in every workspace;
   3. layers visible only in *off-screen* workspaces, by least recently used.
   - **Pinned, never evicted:** the front workspace's visible layers, mounted Studio panes, and open segmentation label and reference layers.
   - Re-upload on show, or on tab switch, through the existing `ensureGpuResidentForLayer`.
3. **Retry Studio panes.**
   - `StudioDerivedMapService` subscribes to a "slots freed" event (emitted on release and eviction) and re-requests failed panes.
   - A tab switch also retries.
4. **Show refusals as a toast.** Use one sentence with the cause and one action. Refusals stay in the Log. The status bar shows the *message*, not a middle-truncated one.
5. **Fix the N37 leak.** On discard, remove the session's label layer (and the frame layer, already removed) and release its lease.

### Phase 2: editable-label residency (N34)

6. Route every VolU16 label upload through **one shared upload function**, so the lazy `allocate_gpu_resources_for_layer` (`:7817`) uses the editable path that `request_layer_gpu_resources` (`:4095`) already uses. That closes the silent `bind_editable_volume_id` no-op. As a backstop, every upload path that serves a layer with an open editable document also re-claims the slot at the current revision. Route it through `synchronize_locked`'s full-upload branch, so a re-upload never yields an unclaimed slot.
7. Pin the session's label and reference layers while the session is open, so Phase 1 eviction never selects them.
8. Make *Retry session* re-resolve the slot: release, re-upload and re-claim. Today it only repeats the failing lookup.

### Phase 3: backend-owned residency manager (approved by the user 2026-11-02)

Move the residency policy into a single backend owner in `api_bridge`:
- residency demand = the union of the mounted frames;
- LRU eviction runs under `volume_operations`;
- the UI keys on layer id only.

This removes the UI's `roomQueue` and reservation logic, but it is a larger change with higher risk. Phases 1–2 should remove the user-visible failures without it.

## Verification

- **Unit tests:**
  - `LayerEvictionService`: budget split, eviction order, and pins (front workspace, Studio, segmentation).
  - `StudioDerivedMapService`: retry on slots-freed.
  - The toast path.
- **Rust tests:**
  - `reclaim_cached_image_slots`.
  - Editable re-claim after release and re-upload; extend the `editable_labels` tests.
  - Run with `cargo test -p api_bridge` and `cargo test -p render_loop`.
- **Native (computer use, on a debug `.app`):**
  - The run-6 sequence: 8 layers plus Studio Compare (B–D render).
  - A BIDS run switch with another 4D layer open.
  - A segmentation session with surfaces loaded and other tabs open; ⌥-scroll must not blank it.
  - Discard leaves no leftover layer.
- **Review:** an independent review pass on the diff before the PR.

## Coordination

- brainflow2-d1 owns segmentation UX and geometry (N30, N38, N41, N44, N48) on `fix/run6-segmentation`.
- This work branches from main *after* that merges, because Phase 2 touches `core/api_bridge/src/modules/segmentation.rs` and the segmentation slot handling.
- The shared checkout is held read-only until d1 signals it is free.
