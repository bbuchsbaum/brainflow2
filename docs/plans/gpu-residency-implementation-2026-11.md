# Implementation plan: GPU residency separation, done safely and modularly

**Status:** approved by the user 2026-11-02.

**Inputs:**
- `docs/plans/gpu-residency-2026-11.md` (Phases 0–2).
- `docs/plans/gpu-residency-phase3-design-2026-11.md`, including the 2026-11-02 revision that separates residency from draw bindings.

**Goal:** remove the global 13-volume residency cap without changing what users see, and leave the code with clear module boundaries.

## 0. Principles

1. **One concern per increment.** Mapping, policy and ownership never change in the same increment. If pixels change, we know which layer of the system is at fault.
2. **Prove equivalence before changing behaviour.** Each refactor lands first with today's limits and identical output. New capability is enabled afterwards, in its own increment.
3. **Behaviour changes go behind a switch, briefly.**
   - Backend residency ownership (increment R5) ships behind `BRAINFLOW_BACKEND_RESIDENCY`.
   - The byte budget (R4) has a hard fallback to the 13-slot cap.
   - Every switch has a deletion date: the end of this plan.
4. **One PR per increment, reviewed independently.**
   - Each PR gets a fresh-context review of its diff before it merges, followed by a fix round.
   - No increment starts on an unmerged predecessor, except for stacked PRs that I say are stacked.
5. **Renderer details stop at the renderer boundary.** Workspace, segmentation, Studio and BIDS code never see slot or binding indices. They name volumes and layers. This is the modularity test for every PR.
6. **Shared checkout etiquette with brainflow2-d1:**
   - hand-offs happen only at clean commit boundaries;
   - stage files by explicit path;
   - never touch another session's work.

## 1. Target module boundaries

| Module | Owns | Exposes | Must not know about |
|---|---|---|---|
| `render_loop::residency::ResidentTextureStore` (new, split out of `MultiTextureManager`) | GPU textures and masks, byte accounting, per-allocation generations, editable claims | `upload(...) -> ResidentHandle{id, generation}`, `release(handle)`, `bytes_used/budget`, `get(handle)` | binding positions, layers, workspaces |
| `render_loop::binding::BindingPlanner` (new) | Mapping the handles one draw needs onto binding positions; a bind-group cache | `plan(&[ResidentHandle]) -> BindingPlan{group, slot_of(handle)}`; invalidation on replace or release | residency policy, eviction |
| `render_loop` draw path | Using a `BindingPlan` to fill `texture_index` in `LayerStorageManager` | – | how handles became resident |
| `api_bridge::residency` (new module; most of it moves out of `lib.rs`) | Leases, rings' slot accounts, demand, pins, the admission and eviction policy, the watchdog sweep | Commands: `set_residency_demand`, `clear_residency_demand`, `get_residency_state`; the `residency-changed` event | shader layout, binding indices |
| `api_bridge::gpu_upload` (new module, moved out of `lib.rs`) | The single upload function per volume kind: plain, 4D member and editable labels (`upload_for`) | `upload_for(entry) -> ResidentHandle` | policy |
| UI: `residencyStore` and `ResidencyDemandPublisher` | Mirroring backend state and declaring demand per frame | store selectors and badges | slots, eviction order, reservations |

**Removed at the end:**
- the UI eviction policy: `LayerEvictionService`'s room queue, reservations, eviction and pins;
- `frontWorkspaceResidency`;
- the adoption code in `LayerApiImpl`;
- `AtlasPressureMonitor` eviction;
- the "slots full" regex in `formatTauriError`.

## 2. Increments

Each increment lists its scope, the safety net it lands with, and its exit criteria.

### R0. Ship what exists (Phases 0–2 on `fix/gpu-residency`)

- **Scope:** the current branch, which is 17+ commits, plus the in-flight N50 and Phase 2 work. Rebase onto main after #41 merges.
- **Safety net:**
  - an independent review of the Phase 2 diff, with a fix round;
  - the full Rust and UI suites;
  - a native computer-use check on a debug `.app`:
    - the run-6 sequence: 8 layers plus Studio Compare, where B–D must render;
    - a BIDS run switch with another 4D layer open;
    - a segmentation session with surfaces and other tabs, ⌥-scroll, Retry, then Discard;
    - N50, the "Open as BIDS anyway" flow.
- **Exit:** the PR is merged.
- Later increments branch from main. This shrinks the blast radius before any structural refactor.

### R1. Extract modules, with no behaviour change

- **Scope:** pure moves and splits, with no logic edits.
  1. Move upload code out of `api_bridge/src/lib.rs` into `gpu_upload.rs`:
     - `request_layer_gpu_resources_locked`;
     - `allocate_gpu_resources_for_layer`;
     - the VolU16 editable routing;
     - the 4D member upload.
  2. Move the lease, watchdog, `render_skipped_layers` bookkeeping and ring accounting into `residency/` (types and functions only, no new policy). `lib.rs` is 16,499 lines.
  3. Split `MultiTextureManager` (1,874 lines) into `ResidentTextureStore`, which holds the textures, masks, generations and editable claims, and the existing bind-group building, which is kept as-is for now.
  4. Delete code that the build proves is dead, each deletion its own commit:
     - the legacy `SmartTextureManager` path, if the opt-in at `lib.rs:5377` is unused;
     - `LayerUniformManager` and the `slice_debug*` and `slice_simplified` shaders, only if no runtime or test path selects them. Anything still used stays.
- **Safety net:**
  - `git diff --stat` shows mostly moves;
  - an independent reviewer checks that the extraction is behaviour-preserving;
  - all tests are unchanged and green, including the shader contract test and GPU tests on a real adapter.
- **Exit:** merged. `lib.rs` loses its upload and residency code, and nothing else changes.

### R2. Ownership hardening, finished

- **Scope:** whatever of Phase 2 / increment 2 R0 did not complete:
  - generation-checked `ResidentHandle` everywhere: leases, rings and `ProvisionalUpload`;
  - a lease for every allocation;
  - one upload function per kind.
- **Safety net:** the stale-handle no-op release test, and a test that a reused index never frees the new owner.
- **Exit:** no code outside `ResidentTextureStore` holds a bare `u32` texture index as an identity. CI enforces this with a grep check for `atlas_index` used as a key in `api_bridge`, with an allowlist for the derived maps.

### R3. Per-draw binding map, with the 13-slot residency cap kept

- **Scope:**
  - `BindingPlanner` maps the handles each draw requests onto binding positions 0..capacity at `submit_frame_with_options` (`core/render_loop/src/lib.rs:4945`).
  - `LayerStorageManager` writes the planned position.
  - Bind groups are cached by handle-set, and invalidated on replace, release, mask change or LUT change.
  - Shaders, masks, formats and blending are unchanged.
- **Safety net:**
  - **Pixel-equivalence harness.** It renders a fixed scene matrix with the old binding scheme and the new planner, and compares them byte for byte:
    - scalar, label, mask and atlas outlines;
    - 4D member swaps;
    - Mosaic, Compare and the legacy path.
  - **CI configurations:** the binding capacity is forced low (for example 4) so mapping bugs surface.
  - **Native check:** the app's visual baselines are unchanged.
  - **Measurement:** bind-group creation per frame and cache hit rate, logged in the diagnostics view.
- **Exit:** byte-identical renders, and no added per-frame cost beyond noise.

### R4. Residency beyond 13 under a byte budget

- **Scope:**
  - `ResidentTextureStore` gets a byte budget. Each draw's binding capacity stays at the layout limit of 13.
  - **Default budget:** a conservative fraction of the adapter's reported limits and recommended working set. It leaves headroom for CPU copies, masks, rings, render targets and temporary allocations. It is exposed in Settings › Diagnostics, and there is a hard fallback to the 13-slot cap.
  - **Interim policy:** the existing UI eviction (Phase 1) keeps working. Its budget becomes the backend's free bytes plus the per-view binding capacity, instead of slots.
  - **Refusals** distinguish the two limits, "out of GPU memory budget" and "too many layers in one view", using the typed refusal codes.
- **Safety net:**
  - forced-pressure tests with a tiny budget: failed uploads, no stale release, no wrong-volume render, no leak;
  - the acceptance matrix from the design revision: more than 13 resident volumes across views, rapid tab switches, concurrent readbacks, 4D swaps, label edit and undo, unload and reload;
  - a native Metal run, and a lavapipe run in CI.
- **Exit:** a user can have, for example, 30 volumes open across tabs and Studio with no "slots full" error, as long as each view draws 13 or fewer layers.

### R5. Backend residency owner (design §§2–6, counting bytes)

- **Scope:** the design's increments 1, 3, 4 and 5, applied to the byte budget:
  - the pure `ResidencyPolicy` with a fake backend, run in shadow mode first;
  - demand commands and the `residency-changed` event;
  - the backend owning admission and eviction behind `BRAINFLOW_BACKEND_RESIDENCY`;
  - rings drawing from the global pool.
- **Safety net:**
  - policy unit tests on the fake backend: eviction order, pins, front over capacity, ring allowance, hysteresis, stale epochs;
  - shadow-mode logs compared with the UI policy during the native run;
  - integration tests covering two workspaces, a Studio pane and a segmentation session;
  - vitest for the publisher and the thin UI.
- **Exit:** with the flag on, native checks for rapid tab switches, 15 layers in one view, segmentation with ⌥-scroll, and discard.

### R6. Delete the old paths

- **Scope:**
  - remove the flag, the UI eviction policy, `frontWorkspaceResidency`, `LayerApiImpl` adoption, `AtlasPressureMonitor` eviction, the old events and the error regex;
  - update `docs/architecture-agent-reference.md`, `core/CLAUDE.md` and the AGENTS contract lines.
- **Safety net:** the full suites and the native run again; the reviewer checks that no UI code mentions slots or bindings.
- **Exit:** the module table in §1 holds.

## 3. Cross-cutting quality gates (every PR)

- `cargo test -p render_loop`, `cargo test -p api-bridge`, the shader contract test, clippy on both crates, and `cargo fmt --check`. GPU tests must run on a real adapter; a skipped test counts as a failure.
- `pnpm check:permissions:strict` whenever the command surface changes; bindings regenerated per `ADDING_COMMANDS.md`.
- `tsc`, the full UI vitest suite, and eslint on touched files.
- No test weakened. Any changed expectation is justified in the commit message.
- An independent fresh-context review of the diff, then a fix round, before the PR is opened.
- A native check on a debug `.app` for R0, R3, R4, R5 and R6, run with the Brainflow QA prep: quit ChatGPT and clear system prompts first.

## 4. Risks and how each is contained

| Risk | Containment |
|---|---|
| Mapping bugs draw the wrong volume | R3 is separate from R4, uses a byte-identical harness, and runs with a low forced capacity |
| Memory overcommit on Metal | A conservative byte budget, the 13-slot fallback, forced-pressure tests, and the budget surfaced in Diagnostics |
| Lock-order regressions | One documented lock order (design §1), the `residency` lock as a leaf, and a reviewer checklist item |
| Bind-group churn costs frame time | Cache by handle-set; measure in R3; exit criteria include no added per-frame cost |
| Two policies coexisting (R5) | Shadow mode first; a time-boxed flag; R6 deletes the old path |
| Conflicts with brainflow2-d1's branches | Small PRs from main; clean-boundary hand-offs; module extraction (R1) early, so later diffs are local |
| Large diff review fatigue | One concern per PR; R1 is pure moves, reviewed as such |

## 5. Order and rough size

| Increment | Size |
|---|---|
| R0 | in progress; the review and native check take about half a day |
| R1 | about 1 day |
| R2 | small, if R0 covered most of it |
| R3 | 1–2 days, including the harness |
| R4 | 1–2 days |
| R5 | 3–4 days |
| R6 | about half a day |

Each increment ends with something shippable. The plan can stop after R4 with the user-visible problem solved and the code already cleaner. R5 and R6 are the structural payoff.


## Execution checkpoint — 2026-11-04, R3 qualification pending

- Refreshed origin: R0–R2 are merged; `origin/main` remains `85194998`.
  R3 is local at `f0a4bc20`, preceded by implementation commit `3603cef0`.
  Worktree: `/private/tmp/brainflow2-r3`, branch `refactor/r3-draw-bindings`.
  The original shared checkout and its unrelated changes are preserved.
- Implemented: compact per-draw mapping, bounded handle-set bind-group cache,
  store-identity/view-revision invalidation, per-layer captured source ownership,
  generation-aware prepared state, and a shortcut for unchanged rows/resources.
  Residency remains capped at 13. No shader or blending changes.
- Review fixes include direct-upload prepared-state invalidation, incremental
  layer shadow/metadata appends, cache eviction on failed preparation, duplicate
  rows retaining distinct generations, and source alignment after layer removal.
  Fresh-context review approved both code commits without remaining blockers,
  conditional on native and performance qualification.
- Diagnostics: frame fields report created texture groups and cache hits.
  Native testing revealed that normal image rendering does not use submitViewState.
  The existing atlas-stat polling now carries cumulative successful declarative
  submission counters into the Diagnostics popover, including normal image renders.
  Upload groups outside submissions and legacy direct-path renders are excluded.
  Focused StatusBar tests (8), service/bridge-to-store UI tests (10), and the core
  cumulative-counter regression passed. Final native display/update check passed.
- Focused Metal run: 22 R3 tests passed, none ignored. Covers sparse residents
  with four binding positions, overflow, cache bounds, scalar/label/mask/outline
  pixel equivalence, member swaps, snapshots, resource replacement, stale captures,
  duplicate removal, and per-frame diagnostic counters.
- Workspace regular tests: 1,482 passed, 33 ignored. The combined command then
  failed during API bridge rustdoc with missing-crate errors while Cargo profiles
  shared a target directory; isolated workspace doc tests subsequently passed.
  Final affected renderer/bridge suites: 872 passed, 27 ignored. These preceded
  the additive cumulative telemetry, which has focused regression coverage above.
  Final workspace Clippy, Rust format check, UI production build, WASM build,
  generated TS/API build, strict bridge permissions, and native debug bundle passed.
- Full UI suite: 4,325 passed, one BIDS palette timing assertion failed under
  concurrent build load, three skipped and one todo. The unchanged timing test
  file subsequently passed alone (7 tests). Earlier snapshot: 4,326 passed.
  UI lint has the same 537 findings on baseline and R3 (466 errors, 71 warnings;
  no added or removed normalized findings). Skipped tests are not qualification.
- Native image checks on `3603cef0`: public MNI template in orthogonal and Mosaic
  views (including page navigation); synthetic oblique4d at fixture voxel (2,3,4)
  showed 432 then 2432 after frame selection; Compare displayed distinct volume
  members; synthetic label 17 and sagittal outlines rendered correctly. No observed
  wrong source, blank panel, or crash. `f0a4bc20` only adds cumulative diagnostics.
  Its rebuilt QA bundle is at
  `/Users/bbuchsbaum/code/brainflow2/target/debug/bundle/macos/Brainflow R3 QA.app`.
  Final native diagnostics inspection passed at 14:39 local: 0.17 groups/frame
  (6 frames), 83% hits (5/6); after axial-to-sagittal navigation, 0.14 (7 frames),
  86% hits (6/7), GPU Ready, with a visibly rendered sagittal image.
  Earlier capture failures were ScreenCaptureKit -3811. Investigation found
  `TCC Allow` plus failed window-to-display lookup; the helper really restarted,
  then later recovered in the same process without permission/configuration changes.
  Finder selection followed by a new QA selection succeeded; exact cause of recovery
  is not established. Local diagnostic report: `cruft/r3-20261104/computer-use-diagnosis.md`
  in the original checkout. Native qualification is complete; capture reliability
  remains a tooling issue, separate from the renderer.
- Performance: identical sparse four-source benchmark on R2 and final R3, 8
  alternating AB/BA pairs, 500 frames per workload, isolated release executables.
  Outer submission timing includes the diagnostic counter updates omitted from
  internal preparation timing. Both builds use `CARGO_PROFILE_RELEASE_PANIC=unwind`
  to avoid the baseline volmath rlib/cdylib test-profile collision; manifests unchanged.
  Mean paired outer p50 changes are -3.81 us steady, -2.29 us property changes,
  and -3.46 us alternating sources. Run-order effects remain too large to establish
  the no-added-cost gate; do not infer equivalence from a nonsignificant difference.
  One predeclared follow-up ran eight ABBA/BAAB four-run blocks with the same
  executables. Outer run-p50 mean block changes (95% t intervals across blocks):
  steady -8.79 us [-21.33, 3.75], property changes -5.94 us [-37.39, 25.52],
  alternating sources -6.27 us [-16.45, 3.90]. Tail uncertainty remains larger.
  This is inconclusive, not an observed consistent regression or proof of
  negligible cost. The fixed follow-up is complete; no further repeats to chase
  significance. Host submission timing excludes the following GPU completion
  wait and does not qualify GPU execution, sustained throughput, or native latency.
  Standard Criterion render benchmark ran successfully: estimated 1.8053 ms with
  readback and 76.906 us without (10 samples, 1 s warmup, 2 s measurement).
- Baseline hosted CI is mixed: differential, coordinate and shader-contract runs
  passed. Other runs fail on Linux GLib/private-dependency setup or unchanged
  dependency advisories; this branch has not been published or checked by hosted CI.
- Raw logs and actual exit metadata are archived in the original checkout's ignored
  `cruft/r3-20261104/`; source logs remain `/private/tmp/brainflow2-r3-*.log*`.
  Timing data: `timing-comparison-release.json`, `timing-comparison-balanced.json`,
  and `timing-balanced-protocol.json` in that evidence directory.
  Mote issue `bd-01M6KVR5VR61NBMHV0TFFAC58Q`, actor `codex-residency`.
  Dashboard lane `codex-5a25e2ce` in the original checkout's `.dashboard/`.
- Next: settle the performance evidence, then publish and qualify R3 before merging. R3 is not yet qualified or landed.
  R4–R6 have not started and must wait for R3's exit criteria.
