# Segmentation implementation brief (2026-10-31)

An ordered brief for implementing the segmentation module from its
finished design. It is written for a coding agent working from the git repo
alone. Read first, in this order:

1. Root `AGENTS.md`, then `ui2/src/modules/AGENTS.md` and
   `ui2/src/modules/segmentation/AGENTS.md`.
2. `ui2/src/modules/segmentation/DESIGN.md`: the design. It covers the layout,
   every state, the encoding rules, the decisions and the open questions.
3. `docs/design/segmentation/reference/README.md`: the 19 target screens,
   with what each shows and what is mocked.
4. `docs/design/segmentation/critiques.md`: what the critics left open,
   as checklists for the prototype.
5. `docs/plans/module-architecture.md` (phases A.2, B, C, D and the R track)
   and `docs/plans/segmentation-module-research.md` ("Recommended design",
   "Phased roadmap").

## The rule for UI work

**Promote the design components in
`ui2/src/modules/segmentation/components/directions/h/` and
`components/shared/` to production by replacing mock scene data with live
session state. Do not redraw from screenshots.**

The design components are working React components. They already follow
every encoding rule, under test. What is mock is the data they read:

| Mock source | Replace with |
| --- | --- |
| `__design__/designData.ts`, `__design__/lesionData.ts` (template slices, mock labels, rater B, FLAIR) | Images rendered by the bridge for the session's views; label voxels from the session's label store (R1) |
| `components/shared/mockData.ts` (`LABEL_DEFS`, `LABEL_VOLUMES`, `PROTOCOL`, `NATIVE`, `areaByNativeSlice`) | The session's label table, volumes and per-slice areas, the protocol pack, and the reference grid's geometry |
| `components/shared/session.ts` (journal, provenance, kept branch, `asOf`) | The session journal and provenance plane from `core/segmentation`, with the same API shape (`sliceProvenance`, `sessionSliceStatus`, `unreviewedSlices`, `provenanceTable`, `RECOVERY`) |
| `components/shared/scenes.ts`, `views.ts`, `directions/h/hViews.ts` (per-state overlays and panel props) | Selectors that build the same `PanelProps` and `Overlay[]` from live state |
| `directions/h/workflow/workflowData.ts` (AI answer, lesion scene, history rows, save bundle) | The proposal, history, save and lesion services |

Keep the pure rule functions as they are and call them from services:
`geometry.ts` (brush footprint, constraint gate, partition edges, review
encoding, crosshair gap, Approve gate) and `workflowRules.ts`
(`gateProposal`, `overreach`, `slicesOutside`, `nextUnseen`,
`rangeFootprint`, `components26`, `undoForLabel`, `saveCheck`,
`colourCandidates`, `labelVolumeHeader` and the table writers). Where Rust
must be authoritative (the brush rasterizer and the writers), port the rule
to `core/segmentation` and keep the TypeScript copy as the preview, with a
shared known-answer test so the two cannot drift (research plan: "One
rasterizer").

Move each component out of `directions/h/` into the module's own
`components/` as it goes live. Keep `directions/{a,b,c}` and
`__design__/` as design history: the shipping tab must not import
`__design__`, and the harness keeps rendering the mock states so the design
can still be compared.

## Prerequisites (outside the module)

Do these first, in order. Each is specified in
`docs/plans/module-architecture.md` with its exit evidence.

1. **Module architecture (PR #18).** Merged on `main` (16066276) but not on
   `claude/segmentation-design`: merge `main` into the working branch and
   resolve conflicts before anything else.
2. **Phase A.2: view modes and viewport tools.** `contributes.viewModes`
   (Segment mode changes the current view tab's layout in place),
   one active viewport tool per viewport with pointer arbitration and
   coalesced pointer events in `packages/visualization/src/slice`, overlays
   through `SliceViewport`, and `ctx.state.workspace`.
3. **Phase B2: layer kinds and render capabilities.** A label layer kind
   with its Inspector section; `get_render_capabilities` so the module can
   require the R features below.
4. **R1: editable label store.** Sparse u16 bricks, undo deltas, a revision
   counter, and a label NIfTI writer that keeps qform and sform, intent 1002,
   the smallest unsigned type, gzip, temp file and rename.
5. **R2: sub-region upload.** `update_volume_region` with revision-keyed
   re-upload, and a partial-versus-full GPU test that never soft-skips.
6. **R3: zoom and pan, native and oblique planes.** Zoom and pan through the
   view transform, a native view type from a volume's affine columns (the
   0.40 × 0.40 / 2.0 mm oblique coronal T2), and the long-axis plane.
7. **R4: multiple outline layers.** At least two outline layers per frame,
   each with its own style (needed for neighbour line, proposals and rater B).
8. **R5: compute tier.** Per-slice WGSL compute passes for view-only filters
   (unsharp, CLAHE, local z-score) and CPU derived volumes.
9. **Phase D: provider session runner.** Provider manifest v2, the session
   runner with request ids, cancellation and heartbeats, consent and licence
   records. Needed only for milestone 8.

Segmentation can enter at stage experimental after 1–6 (the architecture's
"First new module" gate); 7 and 8 are needed by milestones 2 and 3, 9 by
milestone 8.

## Module milestones

Each milestone lists the reference states it unlocks, the files it touches,
and its acceptance. "Contract tests" means
`ui2/src/modules/segmentation/__tests__/designContract.test.tsx`, run
against the promoted components (see "Acceptance" below). "Parity" means the
design-parity capture against `docs/design/segmentation/reference/`.

### M1. Bridge section, session and setup

- **Unlocks:** `empty.png`, `setup.png`.
- **Ships:** the bridge section `segmentation` (same id, stage and version
  as `module.ts`); `core/segmentation` (session on a chosen reference grid,
  label table, provenance plane); `core/api_bridge/src/segmentation.rs` with
  commands single-sourced in `command_list.rs` (read
  `core/api_bridge/ADDING_COMMANDS.md`); the Segment view mode; the start
  card; the setup sheet (identity, blinding, reference grid with the slab
  locator, the registration check in the primary, label table from a pack or
  an imported table, colour candidates).
- **Files:** `core/segmentation/`, `core/api_bridge/src/segmentation.rs`,
  `command_list.rs`, `packages/api` (regenerate bindings:
  `cargo run -p xtask -- ts-bindings`, then
  `pnpm --filter @brainflow/api build`), `src-tauri/capabilities/`,
  `ui2/src/modules/segmentation/{module.ts,activate.ts}`, a service and store
  under the module folder, `devHarness/app/backend.ts` handlers.
- **Acceptance:** `pnpm check:permissions:strict`; `firstParty.test.ts`;
  NIfTI round trip (affine, intent, dtype); contract tests for colour
  candidates, setup identity and the registration gate; parity for `empty`
  and `setup`; native check that "Aligned" records the confirmer.

### M2. Manual tracing

- **Unlocks:** `tracing.png`, `tracing@1280x800.png`, `zoom.png`,
  `blocked.png`.
- **Ships:** brush, eraser and contour on the native plane with wet ink
  (exact footprint on an overlay during the stroke; Rust rasterizes on
  pointer-up); the constraint gate and the refused-stroke card; locks and
  status; the partition renderer (inner-edge strokes, emphasis levels, tint
  muting, islands, gaps); the crosshair clear box; the slice ruler; the
  slice matrix; the step card with checks; the neighbour line; per-stroke
  undo.
- **Files:** `core/segmentation/{raster,history}.rs`, the module's
  `components/` (promoted `SliceView`, `LabelList`, `ConstraintStrip`,
  `Sparkline`, H's rail, ruler, step card and Inspector), the module store.
- **Acceptance:** known-answer rasterization on synthetic oblique and
  anisotropic grids; byte-equal undo/redo; contract tests (brush footprint,
  gate, partition strokes, tint ΔE, islands, crosshair gap, dash
  discipline, single-source volumes, matrix flags); parity for the four
  states; native check of pen and trackpad input, ⌘Z and paint latency
  (measure it).

### M3. Multi-contrast and contrast aids

- **Unlocks:** `multi-contrast.png`, `multi-contrast@1280x800.png`,
  `contrast-aids.png`.
- **Ships:** the orthogonal column (world-frame reslices, 80% fit, locator,
  gutter, tilted band); the contrast strip (T1w, filtered T2w, pack example)
  at the primary's slice, centre and scale; view-only filters with the badge
  derived from the image; the square lens; hold-to-flicker (V, T, ⌥).
- **Files:** `ComparisonRenderService.ts`, `comparisonStore.ts`,
  `core/render_loop/src/compute/` (R5), shader and `shader_contract.rs` if a
  display mode is added.
- **Acceptance:** `shader_contract_test`, `slice_outline_render_test`;
  contract tests (filter badge, filters never change labels, small multiples
  share the primary's scale); parity for the three states; GPU check of
  filter output and lens latency at 4–6× zoom.

### M4. Proposals: fill between slices

- **Unlocks:** `proposal.png`.
- **Ships:** interpolation as a proposal (hatch, thin outline, crossed
  skipped voxels), per-slice accept with Enter stepping to the next unseen
  slice, Confirm all as a quiet secondary that logs unseen slices, proposal
  undo separate from document undo, provenance codes 2 and 3.
- **Files:** `core/segmentation/interpolate.rs`, a proposal texture (one
  slot, essential), the proposal bar.
- **Acceptance:** contract tests (`gateProposal`, `nextUnseen`, proposal
  grammar, per-slice accept); parity for `proposal`; stale-proposal
  rejection after a workspace switch.

### M5. History, autosave, save and resume

- **Unlocks:** `history.png`, `save.png`, `resume.png`.
- **Ships:** the journal (byte budget, minimum depth, written every few
  strokes), the history dock with the kept branch and Restore, per-label
  undo, ⌘S quiet save of the four files (label volume, dseg.tsv, sidecar,
  provenance volume), "Save as / export…", crash recovery with the banner.
- **Files:** `core/segmentation/{journal,save}.rs`, the history dock and
  sheets, `session.ts` replaced by the live journal API.
- **Acceptance:** contract tests (one session model: counts agree across
  history, resume and save; `undoForLabel`; `saveCheck`; the writers);
  parity for the three states; native check of the save dialog, a forced
  crash and resume, and `bids-validator` on the output.

### M6. Review and reconciliation

- **Unlocks:** `review.png`.
- **Ships:** two raters in one layer pair, rater A once, rater B where it
  departs, disagreement textures, flagged regions with Keep A / Take B /
  Edit, the Approve gate, agreement metrics (Dice, HD95).
- **Files:** `core/segmentation/qc/`, the review Inspector.
- **Acceptance:** known-answer metric tests; contract tests (review
  encoding, flag rule, Approve gate, "B: none"); parity for `review`.

### M7. White-matter lesions

- **Unlocks:** `lesion.png`, `lesion@1280x800.png`, `lesion-overview.png`.
- **Ships:** the axial isotropic layout; the range brush with the > 50%
  partial-volume rule; 26-connected lesion rows (18 on thick slices) from the
  live mask; seed import (LST-AI, BIANCA, SAMSEG) as unreviewed rows;
  STRIVE types; span and mm³ bars; Fazekas; T1w/T2w at the primary's scale
  while a type is set; the fit overview.
- **Acceptance:** contract tests (`rangeFootprint`, `components26`,
  `defaultConnectivity`, outline-only lesions, small multiples); parity for
  the three states; real-data checks from `critiques.md` (confluent WMH).

### M8. AI assist

- **Unlocks:** `ai-consent.png`, `ai-prompt.png`.
- **Needs:** Phase D.
- **Ships:** the licence gate (recorded per provider and licence version),
  the prompt sub-rail, an nnInteractive client through the session runner
  (local server by default), the answer as a proposal accepted slice by
  slice, over-reach checks (`overreach`, `slicesOutside`), provenance codes
  4 and 5.
- **Files:** `plugins/segmentation/<provider>/`, the provider interface in
  `core/bridge_types`, the AI states' components.
- **Acceptance:** mock-server tests (stale responses, cancellation, crash,
  teardown); contract tests (gate, over-reach, per-slice accept, AI said
  once, no AI marks before first use); parity for both states; GPU-class
  latency.

## Acceptance, for every milestone

1. **Contract tests.**
   `pnpm --filter temp-ui exec vitest run src/modules/segmentation`. The
   rules are tested as pure functions, and the renderers are tested through
   the components' DOM. When a component is promoted, point its contract
   test at the promoted component, fed by a fixture session. Do not delete
   a rule test because the mock went away.
2. **Design parity.** Make the harness render the promoted component for
   the state, fed by a fixture session that reproduces the mock's numbers.
   Then run the parity capture (`ui2/src/modules/segmentation/AGENTS.md`,
   "Design parity"). The parity mode is advisory: a difference is a question
   for review, not an automatic failure. When the design changes on purpose,
   update the reference in the same commit and say why in DESIGN.md.
3. **Native and GPU checks.** A skipped GPU test is not a pass. Report
   separately which checks were unit tests, mocked UI checks, native app
   behaviour and GPU or visual evidence (root AGENTS.md).
4. **Visual review.** Rerun the critic loop (`tools/design/hillclimb/`) on
   screenshots of the real app at each milestone that changes a screen.

## Data policy

- Use synthetic data or explicitly approved fixtures only (root AGENTS.md).
  The design mocks use the MNI152NLin2009cAsym template (TemplateFlow) and
  synthetic lesions. Test fixtures go in `test-data/`, and generators in
  `tools/`.
- Keep subject data, file paths of real studies and credentials out of
  logs, prompts, screenshots and commits. The critic loop sends screenshots
  to a model, so do not use screenshots of real participant data unless
  that use is approved.
- The real-data prototype tests in `critiques.md` (0.4 mm hippocampal T2,
  FLAIR with confluent WMH) need data the owner approves. Do not fetch or
  commit it.
- nnInteractive weights are CC BY-NC-SA 4.0. Brainflow never bundles or
  downloads them; the user's server supplies them.

## What needs a GPU or native run

- R2 partial-versus-full upload, R4 outlines, R5 compute passes, and
  `shader_contract_test` and `slice_outline_render_test` goldens.
- Paint latency (render, readback and canvas round trip) on real volumes,
  and lens, flicker and filter latency at 4–6× zoom.
- Pen and trackpad input, coalesced events, ⌘Z and ⌘S in the native app,
  the Rust save dialog, crash recovery, and the native menus.
- The AI session runner against a real local nnInteractive server
  (GPU-class latency).
- Everything else here (contract tests, parity capture, harness) runs
  headless in the browser harness, with no GPU.
