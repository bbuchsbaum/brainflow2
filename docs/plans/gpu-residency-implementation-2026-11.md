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
- **Exit:** byte-identical renders, and performance within the explicitly approved
  qualification tolerance in the production-profile protocol below. This replaces
  the original unquantified "no added per-frame cost beyond noise" wording.

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
  R3 runtime changes are `3603cef0` and `f0a4bc20`; subsequent local commits
  record qualification evidence and test-only measurement tooling.
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


### Production-profile qualification protocol — approved 2026-11-04

The user explicitly accepted a bounded tolerance before this campaign: the upper
confidence bound for added mean time must be below 5% of R2 and below 0.1 ms per
view, separately for host submission and completed RGBA readback in steady,
property-change and alternating-source workloads. This makes the earlier
"beyond noise" wording measurable; it is not inferred from the observed timings.

- Build the identical `core/render_loop/examples/r3_frame_qualification.rs`
  against R2 and R3 via `cargo build --release -p render_loop --example
  r3_frame_qualification`, preserving opt-z, LTO and panic-abort. Record hashes.
- Each process warms each workload for 100 frames and measures 1,000 frames;
  13 residents, sparse four-source draw, 512-square image, serial queue drain.
  Host timing excludes the following GPU drain; completed timing includes the
  public request's readback completion. Neither measures UI latency or throughput.
- Primary endpoints are block mean-time differences and relative differences;
  frame samples are not independent replication units. Retain p50/p95 as secondary
  evidence and image checksums for matching output.
- Run four A/A ABBA/BAAB blocks first, then at most eight R2/R3 ABBA/BAAB blocks.
  A block comprises four separate runs per mode. Modes alternate execution order.
  A/A two-sided 90% intervals (equivalent to directional one-sided 95% bounds)
  must fit within +/-5% and +/-0.1 ms for all six endpoints. Otherwise stop and
  classify the measurement environment as inadequate, without widening tolerance.
- R2/R3 passes only when every one-sided 95% upper bound fits both approved limits,
  with no unexplained adverse tail/order effect. Report intervals across blocks,
  raw data, machine/context, and separate first-use versus warmed behavior.
- A test-only batched `prepare_draw_bindings` witness diagnoses local overhead;
  it does not replace the full-call comparison or cover residency-signature cost.
- One fixed campaign; no extra repeats to chase acceptance. If sensitivity fails,
  change the measurement environment before attempting qualification again.


Production-control result: **this four-block A/A assay did not establish adequate
host-submission repeatability at the approved tolerance; candidate comparison
was not run**. Hardware: Apple M3 Max, Mac15,11, 14 CPU cores, macOS 27.2.
No thermal/performance warning was reported. Before measurement, background
media analysis, Dropbox, WindowServer and capture-service activity were present;
this is context, not proof that any one process caused the variance. Our builds,
GPU tests and QA app were stopped before the control. User was asked to provide
an idle window before any new control campaign. Independent review recomputed
all 32 logs, 96 raw sample arrays and 12 primary upper bounds and confirmed the
negative sensitivity interpretation; no material measurement defect was found.
The runner now refuses to overwrite a campaign or start candidate qualification
without a passing saved control from the same baseline executable.

The four A/A blocks compare the same R2 binary, not R2 against R3. Directional
95% interval bounds on relative mean differences:

| Endpoint | Lower | Upper | Fits +/-5% |
| --- | ---: | ---: | --- |
| Host, steady | -16.66% | +9.44% | No |
| Host, properties | -11.67% | +16.31% | No |
| Host, source switches | -35.38% | +36.67% | No |
| Completed, steady | -1.56% | +3.62% | Yes |
| Completed, properties | -2.96% | +1.61% | Yes |
| Completed, source switches | -1.22% | +1.19% | Yes |

All absolute intervals fit +/-0.1 ms. Completed-image checksums matched within
all control blocks. This control does not establish candidate performance or
candidate image equivalence; it prevents an unreliable R3 comparison from being
accepted. Raw samples, binary hashes, frozen protocol, and computed verdict are
in `cruft/r3-20261104/production-control-*` in the original checkout.

The corrected local binding witness passed with actual Metal access and no
additional bind groups for warmed repeated source sets. It uses 16 batches of
256 calls, opaque service references, and explicit empty queue submission plus
GPU drain outside every timed batch. Observed batch medians: unchanged preparation
about 2 ns/call, property refresh plus preparation 8.666 us/call, source-row refresh
plus preparation 12.308 us/call. These are test-profile diagnostic measurements,
not incremental R3-versus-R2 overhead or production-frame qualification. The earlier
single unflushed batch was superseded and must not support a timing claim.


### Quiet-window control and interleaved revision — 2026-11-04

The user-authorized quiet-window retry used the same production binaries and
criteria. Its A/A host intervals again failed (steady -9.12% to +43.72%, properties
-35.60% to +31.15%, source switches -34.65% to +4.29%); all completed intervals
passed. No candidate run occurred. Identical-baseline steady run means ranged
from 55.56 to 132.13 us. This does not identify a cause, but makes another identical
whole-process campaign uninformative. Evidence is retained separately under
`cruft/r3-20261104/quiet-control-1/` in the original checkout.

Before collecting new results, independent review approved a changed assay that
reduces A/B time separation, with the same six primary endpoints and tolerances:

- Four independent process-pair sessions for A/A, then eight for R2/R3 only if
  control passes. Both renderer contexts persist within each session, but work
  strictly sequentially. Alternate process launch order AB/BA between sessions.
- Rotate the six endpoints deterministically by session index. For each endpoint,
  warm each process with 100 calls, then perform four quartets ABBA/BAAB/ABBA/BAAB.
  Each batch has eight fixed untimed priming calls followed by 32 timed calls.
- Keep the public-call timers, per-frame queue-drain placement, production profile,
  fixture and image checks unchanged. A batch acknowledges only after its final
  drain. IPC, logging and checksums are outside timers.
- Aggregate into one A and B mean per endpoint per independent process-pair
  session. Within-session frames/quartets do not increase inferential sample size.
  Retain raw samples, timestamps, process IDs, launch/order data and binary hashes.
- Same directional 95% bounds and strict 5% plus 0.1 ms limits. One fixed campaign;
  no additional sessions, discarded slow batches or post-result tolerance changes.
- Two simultaneously resident GPU contexts differ from a single-renderer app;
  sequential work and A/A controls address comparability, not universal hardware
  behavior. Priming defines warmed serial calls, excluding cold-start and sustained
  throughput claims. A failed control remains a valid possible outcome.


Interleaved control completed all four process-pair sessions. **Sensitivity still
failed; candidate comparison was not run.** Session-level directional 95% bounds:

| Endpoint | Relative interval | Absolute interval (us) | Pass |
| --- | ---: | ---: | --- |
| Host, steady | [-33.267%, +8.906%] | [-65.951, +22.073] | No |
| Host, properties | [+0.024%, +15.722%] | [+2.035, +31.429] | No |
| Host, source switches | [-8.051%, +8.108%] | [-22.724, +20.268] | No |
| Completed, steady | [-5.107%, +3.078%] | [-103.898, +62.285] | No |
| Completed, properties | [+0.968%, +2.994%] | [+17.991, +54.828] | Yes |
| Completed, source switches | [-4.225%, -1.464%] | [-86.018, -30.977] | Yes |

Independent implementation review found no blocking protocol defect: timers cover
the full public calls, drains precede acknowledgments, both contexts execute
sequentially, and four/eight sessions determine inferential sample size. These
results compare R2 with itself and establish neither an R3 regression nor its
absence. No additional sessions or retries were added after seeing the results.
The approved margins are unchanged.

Reproducible serve protocol is in `r3_frame_qualification.rs`: launch with `serve`,
wait for `READY`, then send `batch <host|completed> <workload> <count> <warmup>`;
read `R3_BATCH`, `R3_SAMPLES`, and `DONE`. `quit` exits. The normal production
build is required. The portable orchestrator is `tools/qualify_r3_performance.py`. Set
`BF_R3_QUALIFICATION_DIR` to a fresh directory containing the identically built
executables named `production-baseline` and `production-candidate`, then run it
with `control`, followed by `comparison` only when control passes.
The original executed orchestrator and raw evidence are preserved under
`cruft/r3-20261104/interleaved-control-1/` in the original checkout. Its comparison
guard requires a passing control using the same baseline executable.

The earlier recommendation to require a quieter machine is superseded by the
measurement diagnosis below. Failed four-session controls establish uncertainty
at the approved margins; they do not establish that this machine is unsuitable.
R3 remains unqualified and unmerged; R4–R6 remain untouched.

### Measurement diagnosis after low-CPU report — 2026-11-04

The user reports approximately 7% CPU utilization. Aggregate utilization does not
identify the cause of submillisecond timing variation, and no lower-utilization
requirement is justified by the evidence collected so far.

A single exploratory R2-only production run added optional stage attribution via
`BF_R3_STAGE_DIAGNOSTICS`. It completed all three host workloads with 1,000 timed
calls each, exit 0. Existing public-call timers remain unchanged. The reported
`prepare` stage includes command encoding; `submit` measures encoder finishing
and queue submission, not GPU execution. External drain measures the following
poll/wait, outside the host timer. These stages are diagnostic, not acceptance
endpoints. The new output is disabled unless explicitly requested.

For steady frames, 700 calls below 100 us averaged 75.16 us (59.71 us preparation,
14.56 us submission). The 92 calls above 200 us averaged 331.67 us (280.33 us
preparation, 47.81 us submission). Other workloads showed the same broad pattern.
Most additional elapsed time lies in preparation/encoding, with submission also
slower. This does not distinguish scheduling waits, active CPU work, driver
behavior, or frequency changes. It does not establish an R3 regression: only R2
ran. Raw trace and derived attribution are retained under
`cruft/r3-20261104/stage-diagnosis/` in the original checkout.

Independent examination of the previous interleaved control also found sustained
batch shifts, not solely isolated stalls. Removing the largest 1% diagnostically
still leaves one steady-session contrast near -29.46%; no samples are removed
from qualification. The relative session-contrast standard deviations were
17.92 percentage points (steady), 6.67 (properties), and 6.87 (source switches).
Four independent sessions therefore provide weak precision at a 5% margin.
Planning with that uncertain variance suggests about 111 comparison sessions
for 90% power at zero true overhead for the noisiest endpoint, under independent,
approximately normal session contrasts. This is not a guarantee for all endpoints
or a claim that the observed process is stationary.

The next proposed direction is one fixed larger randomized R2/R3 comparison with
interspersed R2/R2 diagnostics, preserving the approved one-sided 95% upper bounds
below both 5% and 100 us for every primary endpoint. Replacing the preliminary
hard A/A pass requirement requires explicit agreement before execution. No larger
candidate campaign has been started, and the existing runner still enforces the
original gate. The native diagnostics display check is already complete.

Proposed fixed campaign (independently reviewed; not yet authorized or run):

- 24 chronological groups, each containing five fresh R2/R3 pairs and one fresh
  R2/R2 pair: 120 comparisons and 24 controls. Randomize order using a recorded
  seed; balance executable-to-process assignment, launch order and quartet start.
- Preserve six endpoints, wall timers, fixture, warm-up, and both approved limits.
  Aggregate comparison contrasts first per process pair, then across the five
  comparison pairs in each chronological group. Infer from 24 group contrasts.
- Freeze ordinary standard error and serial-dependence estimates at lags one and
  two before collecting data; require the largest resulting one-sided 95% upper
  bound to pass both limits for every endpoint. Retain all valid observations.
- Replace preliminary A/A equivalence with an interspersed falsification check:
  predeclare a global false-effect test controlling familywise error at 1% across
  six endpoints, including dependence handling. A detected control effect makes
  qualification inconclusive; a wide control interval alone does not. Never
  subtract measured control offsets from candidate results. Exact estimator and
  critical-value implementation must be reviewed before execution.
- Fixed sample size, no result-driven extensions, trimming, or margin changes.
  Save raw data, temporal diagnostics, hashes and randomized schedule. An aborted
  or invalid run is not a pass. Estimated duration is 25–35 minutes at the pilot
  rate, with no guarantee of decisive precision or qualification.

Diagnostic change checks: normal release baseline build and real-Metal host trace
passed; candidate example Clippy and rustfmt passed; git diff --check passed.
Clippy retained existing ts-rs serde-attribute parsing warnings. Product runtime
code is unchanged by this diagnostic addition.

### Fixed-campaign authorization and frozen analysis — 2026-11-04

The user explicitly approved execution of the revised 120-comparison / 24-control
campaign. The original preliminary A/A equivalence gate is superseded for this
campaign only. No approved performance allowance is relaxed.

For group g, average the five comparison pairs' contrasts D=B-A, R=B/A-1, and
Q=B-1.05*A. For each 24-element chronological series, center values and calculate
lag covariances gamma_l=sum(z_i*z_(i-l))/24. Ordinary variance of the mean is
gamma_0/23. Bartlett HAC variance at L=1,2 is
(gamma_0 + 2*sum((1-l/(L+1))*gamma_l))/23. Use the largest of these three variances
and Student-t(23) one-sided 95% critical value. Every endpoint must satisfy
upper(D)<100000 ns, upper(R)<0.05, AND upper(Q)<0.

The original mean per-pair ratio R is retained as an additional requirement.
It can have denominator bias even with exchangeable identical timings. The added
linear Q requirement tests the intended ratio of mean times directly; it makes
the conjunction stricter. No previous result is reclassified using this method.

Controls use antisymmetric contrasts D=B-A and S=2*(B-A)/(A+B), one per group.
Use the same maximum variance rule and t(23) critical probability
1-0.01/(2*12). A nonzero effect in any of these 12 two-sided Bonferroni tests
makes the result inconclusive. No control-offset subtraction is allowed.
The t/HAC coverage and error levels are nominal approximations under dependence,
not protection against arbitrary long-range dependence. Raw chronological data
and temporal diagnostics remain part of interpretation.

Implementation: tools/qualify_r3_fixed_campaign.py (execution),
tools/r3_performance_statistics.py (frozen analysis), and independent numerical
checks in tools/test_r3_performance_statistics.py. A frozen schedule, formulas,
critical values, source hashes and binary hashes precede all GPU measurements.

### Fixed-campaign result — 2026-11-04

The authorized campaign completed all 144 process pairs in 1,332.990 seconds
(22.2 minutes), exit 0: 120 R2/R3 comparisons and 24 R2/R2 controls, arranged in
24 chronological groups. All 13,824 timed batches / 442,368 timed frames were
retained. The independent audit reproduced role-mapped means, the matrix-form
HAC estimates, every bound and the verdict, and verified frozen input hashes,
schedule completeness, raw-log agreement, completed-image checksums and recorded
batch ordering. All owned benchmark processes exited. No additional campaign
or post-result extension was run.

**R3 does not qualify under the frozen conjunction.** All completed-rendering
endpoints pass. All absolute upper bounds are below 100 us. Host steady and
property changes fail only the retained mean-pair-ratio bound; their direct
mean-time relative-margin tests pass. Source switching fails both relative
requirements. The baseline controls detected no false effect at the predeclared
familywise threshold; their wide intervals do not establish equivalence.

| Endpoint | Mean added time (us) | Added-time upper95 (us) | Mean-pair-ratio upper95 | Q upper95 (us; must be <0) | Pass |
| --- | ---: | ---: | ---: | ---: | --- |
| Host, steady | +1.521 | +6.604 | +6.633% | -2.354 | No |
| Host, properties | +2.418 | +6.568 | +6.944% | -2.300 | No |
| Host, source switches | +11.330 | +14.979 | +10.196% | +5.463 | No |
| Completed, steady | -8.703 | +1.357 | +0.115% | -87.749 | Yes |
| Completed, properties | +0.359 | +10.725 | +0.701% | -76.954 | Yes |
| Completed, source switches | +4.137 | +10.226 | +0.591% | -79.905 | Yes |

Source-switch host means were 190.937 us (R2) and 202.267 us (R3), an observed
ratio-of-grand-means increase of 5.934%. Added host time was positive in 21/24
groups, with a nominal one-sided 95% lower bound of +7.682 us. This is a concrete
added-cost signal, not merely failure of a small A/A assay. However, Q's lower
bound is -1.896 us: the direct mean-time test does not establish that the true
increase exceeds 5%, nor does its upper bound establish compliance. Preserve
that distinction. The biased mean-pair-ratio gate remains binding for this run;
no favorable retrospective criterion was substituted.

Next work is to profile and reduce source-switch preparation cost in R3, checking
row refresh, residency-signature construction and draw-binding lookup against R2
before selecting an optimization. Do not infer a precise cause from this timing
comparison alone, request a still-quieter machine, or repeat this campaign
unchanged. After an actual code improvement, repeat the frozen qualification
protocol without widening the limits. R3 remains unqualified and unmerged;
R4–R6 remain untouched. Native diagnostics verification remains complete.

Execution and analysis tooling passed nine focused tests, Ruff, and the reviewed
statistical implementation checks. The optional stage diagnostics example passed
normal release build, targeted Clippy and rustfmt. No product runtime code changed
in this measurement-tooling slice. Evidence is retained under
`cruft/r3-20261104/fixed-campaign-1/` in the original checkout, with the frozen
source/binaries, protocol, raw logs/samples, independent audit and result report.

### Source-switch upload optimization — 2026-11-04

Code diagnosis found a deterministic redundant upload: a declarative source patch
writes its row using the old binding plan (falling back to the resident index for
an absent source), then applies the new compact map and writes the complete layer
buffer again. This is demonstrated extra work, not attribution of the entire
measured 11.330 us to this operation.

Declarative patches now stage CPU rows and defer the GPU write until the validated
binding plan is applied. A pending flag forces a single upload even when mapped
positions remain unchanged. Public/direct row updates remain eager. Clear and
full refresh reset pending state; generation validation, masks and ordering still
use the existing paths. The implementation uploads all active rows when flushing;
declarative rendering permits 16 rows (13 limits distinct resident textures).
Property-only patches therefore trade a single-row transfer for one full active
row transfer. The fixed performance gate must measure this tradeoff.

A real-Metal regression asserts one layer-buffer write per source switch, including
another row changing compact position, compares pixels to forced full rebuilds,
checks property changes reach the GPU with unchanged positions, and checks no row
uploads on an unchanged frame. Focused binding suite: 19 passed, one manual timing
witness ignored. Independent review approved the bounded change; Clippy and normal
production build passed. Full renderer checks and updated qualification results
will be recorded below when complete. No qualification claim is made by this fix.

### Optimized fixed-campaign result — 2026-11-04

Runtime commit e2db1b30 removes the demonstrated duplicate upload. The renderer
suite passed 287 tests, failed zero, with 18 ignored; the focused binding suite
passed 19 with one manual timing witness ignored. All-target Clippy and the final
production example build passed. Pre-existing serde parsing and manual modulo
Clippy warnings remain. No unrelated shared-checkout changes were included.

The same fixed schedule, runner, analysis and limits were executed against the
new binary in a fresh campaign. All 144 sessions completed in 1,282.752 seconds
(21.4 minutes), retaining 13,824 timed batches / 442,368 timed frames. There were
no execution/checksum failures and no control false-effect flags. All owned
benchmark processes exited.

| Endpoint | Mean added time (us) | Added-time upper95 (us) | Mean-pair-ratio upper95 | Q upper95 (us; must be <0) | Pass |
| --- | ---: | ---: | ---: | ---: | --- |
| Host, steady | +5.139 | +9.682 | +7.464% | +2.317 | No |
| Host, properties | -2.583 | +2.635 | +3.768% | -5.931 | Yes |
| Host, source switches | +2.100 | +6.338 | +4.827% | -2.602 | Yes |
| Completed, steady | -10.221 | +4.774 | +0.465% | -80.274 | Yes |
| Completed, properties | -6.480 | +2.460 | +0.235% | -81.692 | Yes |
| Completed, source switches | -6.993 | +5.863 | +0.388% | -79.460 | Yes |

Source-switch host means were R2 188.487 us and R3 190.587 us, an observed ratio
of grand means of +1.114%. Its added mean time is 2.100 us in this campaign,
compared with 11.330 us in the earlier campaign. This is encouraging comparative
evidence from two campaigns, not a separate randomized estimate of the fix's
causal speedup. Property-change submission also passes all requirements.

R3 remains unqualified solely on steady host submission. Its observed ratio of
grand means is +3.289% (156.227 us R2; 161.366 us R3), below the 5% target, but
both relative upper bounds fail to establish compliance. The direct Q interval
is [-7.662,+2.317] us, so exceeding the 5% true mean-time margin is not established
either. All absolute upper bounds remain far below 100 us. Keep the exact failed
conjunction; do not retrospectively drop a criterion or extend the sample size.

No further unchanged campaign was run. Next work must identify a concrete steady
path cost before another runtime optimization, or obtain an explicit engineering
budget decision. Native diagnostics passed before this optimization; the new
change has real-GPU pixel-equivalence evidence rather than a fresh native UI run.
No push or merge occurred, and R4–R6 remain untouched.

Evidence: original checkout `cruft/r3-20261104/fixed-campaign-2/` and
`cruft/r3-20261104/deferred-upload-checks/`; execution directory
`/private/tmp/brainflow2-r3-fixed-20261104-2`. Independent raw-data validation of
the revised protocol is recorded with the archived campaign artifacts.
