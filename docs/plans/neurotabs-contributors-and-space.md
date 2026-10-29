# NeuroTabs: contributors, neighbours and the Space arrangement

**Planning baseline:** Brainflow `6b2e0459` (main, after the merged UI
redesign), 2026-10-26. This is a draft delivery plan, not a claim that the
proposed interactions exist. A fresh-context review on 2026-10-26 re-checked
every reference against this commit; its corrections are incorporated below.
The goal is the population analyses; the shell and the `ui/bf` component
system are given. The [implementation ledger](neurotabs-implementation-status.md)
remains the status authority.

This packet closes open items in the
[next delivery plan](neurotabs-next-delivery-plan.md) and the
[population exploration plan](neurotabs-population-exploration.md). It
preserves the six analytical states (context, working selection, focus,
reference, spatial probe, relationship definition). Where it needs new state,
it says so and classifies it as presentation state.

**Origin:** a review of the neuroimjs volume-set prototype
(`~/code/jscode/neuroimjs`, commit `c4d23a4`), checked against both codebases.
We borrow interaction patterns and a small set of pure layout helpers. We do not
embed neuroimjs: its `neuroimjs/space` API is an unsandboxed iframe that copies
every array, requires a positive-diagonal axis-aligned grid (Brainflow accepts
rotated orthogonal grids), and would add a second renderer and state owner.

## Where this sits in NeuroTabs

| Workstream | NeuroTabs anchor | Kind of work |
| --- | --- | --- |
| W2 Unassigned observations in relationship fits | Exploration plan §6: zero-variance maps "reported as unavailable for this definition" (:202); observations without a usable distance preserved "as unassigned" (:208). Next delivery plan §4 (:128): "Report coverage loss and unusable maps" | Delivery C conformance debt: the fit currently refuses these cases |
| W1 Neighbours and maps nearest a summary | Next delivery plan §4 (:134); exploration plan §5 (:127); ledger next steps (:255) | Closes an open item |
| W3 Observation status display | State contract (exploration plan §3, :68–90) | Presentation, plus one lifted presentation state |
| W4 Open the focused observation in the viewer | Delivery A review path (next delivery plan :235) | New verified-load path |
| W5 Space arrangement | Exploration plan §6 (:210): "Expand the relationship panel to an MDS-like view with linked selection" | Exploratory; must earn acceptance |

Pairwise spatial attribution, component loadings and witnesses (Delivery F /
M4) already exist; W1 links to them rather than adding new explanation.

## Existing foundation

| Capability | Where |
| --- | --- |
| Shared focus, selection and probe across the strip, cutouts, focused original, MDS ring and Plot dock | `useSetStudioStore` via `PopulationProbeActions.ts` |
| Montage of observation cutouts (≤ 96 members, ≤ 64 px per request) | `PopulationCutoutGrid.tsx`, `evaluate_population_slice` (`population_slice.rs:24–25`) |
| Exact classical MDS on a common finite support, effect and pattern-shape distance, full n×n matrix, stress, average linkage, n ≤ 128 | `relationship.rs`, `relationship_math.rs`, `PopulationRelationshipService.ts`, `PopulationRelationshipPanel.tsx` |
| Pairwise "Where two maps differ", component and reconstruction fields | `PopulationExplanation.tsx`; re-runs the fit and refuses unless coordinates match the frozen fit (`PopulationRelationshipService.ts:487–491`) |
| Response witnesses and response order with `unavailableIds` | `populationWitnesses.ts:43–63` |
| Hold-to-preview exclusion | local state in `PopulationLens.tsx:106` |
| Export and restore of fits | the fit travels in the descriptive `context` blob (`PopulationExportService.ts:65–66`); Rust export/replay do not interpret it (`export.rs:18–19`). Verification is TypeScript only: `validRelationshipFit` and `sameRelationshipBindings` (`PopulationRestoreService.ts:200–210`) |

Two facts shape the design:

- **Fits are indexed by position.** `coordinates`, `distances`, `merges`,
  `finiteCounts`, `order()`, `relationshipPartition` and `explainRelationship`
  all index by position in `fit.request.members`, and restore requires
  `request.members` to equal the context (`PopulationRelationshipService.ts:56,
  104–147, 190–216, 365–378, 473–476`).
- **Relationship types are hand-written TypeScript**
  (`PopulationRelationshipService.ts:15–40`); the Rust types have no ts-rs
  export, so the binding generator does not cover them.

## Gaps

1. The relationship fit refuses rather than reports. Five sites refuse on
   unusable members: no finite values (`relationship.rs:273`), constant pattern
   (`relationship.rs:305–313`, again in `relationship_math.rs:55–56` and in
   `explain` at `:192`), candidate support < 2 (`relationship.rs:218`) and
   common support < 2 (`relationship_math.rs:36–39`). A low-coverage map
   shrinks the common support for everyone, reported only as a percentage.
2. No distance-ranked neighbour list or maps nearest a summary, and no measure
   of how faithfully the 2D layout preserves neighbours.
3. Observations outside the context are absent from the values table; their
   exclusion and its reason are invisible.
4. No route from the Population lens to the focused observation in the viewer
   and back. Deck is the only route; it is disabled for saved calculations
   because legacy materialization lacks frozen-input and frame semantics
   (ledger :240). `StudioDisplayService.ensureSourcePathDisplayed` takes no
   digest, frame or generation token.
5. No arrangement that shows actual anatomy at the fitted positions.

## Principles

- **Placement is not appearance.** A relationship definition is pinned to its
  context, support and source revision. Slice, threshold and display changes
  redraw pictures; only an explicit request refits, and a refit is a new result
  revision.
- **Stale is visible.** When sources change after a fit (`observeSources` sets
  `stale`), the layout stays frozen, a stale badge shows, and ranking-based
  actions (neighbours, nearest summary, Compare) are disabled until refit.
- **Exclusion is visible.** An observation outside the context, or unassigned
  in a fit, remains listed with its reason.
- **Distortion travels with the picture.** Any picture moved for legibility
  carries a marker to its fitted position; neighbour preservation is reported
  for fitted and drawn positions.
- **Focus, membership and preview differ in form**: focus ring, selected-row
  edge, transient preview treatment.
- **No population types by appearance.** Similarity groups keep their fit
  origin and are never labelled as established subpopulations.
- **One owner per computation.** Fits, eligibility and fields stay in Rust;
  ranking, diagnostics and layout geometry are pure TypeScript.

## Scope decision (user, 2026-10-29)

Start with **scatter + tables** (W1 UI, W2 list UI, W3), the **linked
montage** (W6) and **Facet** (W7). Space (W5) is parked; its specimen and
artboards are kept for reference. W4 (open in viewer) stays, because the
scatter peek's pin wants it.

**Scatter hover peek** (part of W1 UI):

- Hover previews and click focuses. After about 150 ms over a point, a
  floating peek shows that observation's slice. Hover never changes focus or
  the Inspector (NeuroTabs state contract). Moving away dismisses the peek.
  Arrow keys move between points and show the peek; Enter focuses.
- The peek has its own slice, initialised from the shared one. The wheel over
  the peek scrolls slices, while the wheel over the plot keeps the plot's
  behaviour. It shows the slice position and the value under the pointer, and
  can switch plane (A/C/S).
- Pinning keeps it open while scrolling or stepping between neighbours, and
  offers "Open in viewer" (W4).
- It reuses the focused-original raster path, with a small cache of recently
  hovered maps. Responses are dropped once the pointer has moved on, per the
  async-ownership rule. It uses the shared threshold and colour range, and the
  shared crop once W6 lands.
- Cost: the 6–9 ms warm figure on the 80-map fixture holds only at the lens's
  displayed slice and plane, where the native plane cache is reused. An
  off-slice or off-plane peek rebuilds a full plane for every member and
  replaces the lens's cached plane; unmeasured, estimated at tens to hundreds
  of milliseconds in debug builds. Wheel bursts are coalesced to at most two
  evaluations.
- Follow-up: a two-slot native plane cache or a single-member read. Either
  needs a Rust change and a timing receipt on the 80-map fixture.

**Visual hill climb** when the implementation is close: critics for
aesthetics, for function and usability, and for scientific insight
(honesty about distortion, exclusion and provenance), scored against fixed
specimens, as in the redesign campaigns.

## Sequence

W2 → W1 → W3, with W4 in parallel. W5 depends on W1 and W2; its
Enter-to-viewer action stays behind a flag until W4 lands. W2 comes first
because it fixes the fit's data shape that W1, W3 and W5 consume.

## Workstreams

### W2. Unassigned observations in relationship fits (Rust + TypeScript)

**Request.** Add `eligibility` to the relationship request with
`#[serde(default)]` (the request uses `deny_unknown_fields`, `relationship.rs:17`):

- `None` (default when absent): exact v1 behaviour — the existing refusals and
  the `classical-mds-common-support-v1` label, so restored v1 fits re-explain
  unchanged.
- `{ lowCoverageTau }`: the new behaviour with label `-v2`. New fits from the
  UI send τ = 0.9 (user decision). The strict mode is therefore the v1 path,
  not an extra option.

**Algorithm (v2), in order:**

1. Read each member's finite values on the candidate support.
2. `AllMissing`: no finite value.
3. `LowCoverage { fraction }`: finite count below τ × the median finite count
   of members not already `AllMissing`. Judged on the pre-exclusion candidate
   support.
4. Intersect the remaining members' finite voxels into the common support.
5. Pattern-shape only: `ZeroVarianceOnSupport` for members constant on that
   support; if any are excluded, recompute the common support over the rest.
   One pass; state it.
6. Refuse if fewer than two members remain, or if the common support has fewer
   than two voxels (still a refusal, now reported with each excluded member's
   effect on support).
7. Fit, link and hash the support over fitted members only.

**Result shape.** Keep `request.members` equal to the full context (restore
depends on it). Add:

- `fittedMemberIds: string[]` — geometry (`coordinates`, `distances`,
  `merges`, component scores) is defined over this list, in this order.
- `unassigned: { memberId, reason, finiteCount, supportLossVoxels }[]` —
  `supportLossVoxels` reports how many common voxels the member would have
  removed, which exposes partial-coverage maps (for example one hemisphere)
  that a relative count rule misses.
- `finiteCounts` stays per request member; `commonVoxels` refers to fitted
  members.

**Consumers rewritten against `fittedMemberIds`:** `validRelationshipFit`
(drop `finiteCounts[i] ≥ commonVoxels` for unassigned members), `order()`,
`relationshipPartition`, `PopulationExplanation`, `explainRelationship`, and
Rust `explain` (refuse a field that names an unassigned member).

**Order, partition and lasso.**

- Similarity order uses the response-order convention: `orderedIds` = fitted
  members in axis order, `unavailableIds` = unassigned (`order()` currently
  hard-codes `[]`, :379). Relax the restore check that requires
  `unavailable.length === 0` (`PopulationRestoreService.ts:180–226`).
- Similarity partitions get one extra group with a distinct id, label
  ("Unassigned") and origin, excluded from the group count, from the
  `count ≤ n` validation and from "similarity group" semantics in downstream
  comparisons.
- Lasso Replace over the scatter drops unassigned members, since they have no
  position; the UI says so.

**UI.** An "Unassigned (n)" list beneath the relationship view, each entry
with its reason and support loss, focusable (these members are in the
context).

**Checks.**

- Rust: each reason, mixed reasons, the τ boundary, median over non-missing
  members, support recomputation after zero-variance exclusion, < 2 eligible,
  < 2 common voxels, partial-coverage support loss, support-hash stability,
  and the existing disjoint and constant tests (`relationship.rs:503–541`)
  under both `None` and v2.
- TypeScript: restore and re-explain of a saved v1 fixture (the real
  compatibility path; Rust replay never sees fits); v2 restore with
  unassigned members; order and partition restore; export context size at
  n = 128 against the 1 MiB budget (`export.rs:83–88`).

### W1. Neighbours and maps nearest a summary (TypeScript only)

**Pure module** `ui2/src/services/studio/relationshipNeighbours.ts`, over
`fittedMemberIds`:

- `rankNeighbours(fit, memberId)`: tie-inclusive ranks using one tie rule:
  a and b tie when |a² − b²| ≤ ε₂ × max d² (ε₂ = 1e-12) or
  |a − b| ≤ ε₁ × max d (ε₁ = 1e-7). The squared term absorbs Rust's
  arithmetic: it computes d = √max(0, gᵢᵢ + gⱼⱼ − 2gᵢⱼ) from a Gram matrix,
  so its rounding error is in d² and a coincident pair comes out at
  d ≈ 1e-8 × max d, not 0. The linear term reflects the input's resolution:
  map values are stored as f32 (relative precision ≈ 6e-8), so distance
  differences below about 1e-7 of the largest distance are not resolvable;
  this ties affine copies of one map when ranked from a third map. Rank by
  d², display d. The rule (`distancesTie`, `tieTolerance`) is shared with
  `neighbourPreservation`, the centroid ranking and W5's `coincidentGroups`.
  Deterministic tie-break by fit order.
- `neighbourPreservation(distances, coords, k = 3)`: per member and overall,
  tie-inclusive, following neuroimjs `src/volumeset/nmds.ts:897`. Returns
  "not informative" when n − 1 ≤ k (n ≤ 4 at k = 3), as neuroimjs does.
- `distanceToCentroid(distances, weights)`: both declared distances are plain
  Euclidean (effect: rows / √p; pattern shape: centred rows at unit norm, so
  d = √(2 − 2r); no voxel weights). For weights w summing to 1,
  `‖xᵢ − x̄_w‖² = Σⱼ wⱼ dᵢⱼ² − ½ Σⱼₖ wⱼ wₖ dⱼₖ²`. This holds for any member i
  and any subset in the same fit. Clamp at 0.

**What "nearest the summary" means.** It is the centroid on the fit's common
support, not the displayed mean map, which uses local per-voxel denominators.

- Label it "Nearest the centroid on the fit's common support (n voxels)".
- Weights are the working selection's active weights. When participants are
  averaged (`reduction: 'mean'`), weights are per participant, divided among
  their observations.
- Disabled when the working summary is not a mean (median, MAD and the other
  `SummaryKind`s).
- Restricted to fitted members; selected-but-unassigned members are reported
  beside the list.
- Disabled when the fit is stale or out of scope, as `order()` and `group()`
  are (:360, :389).
- During hold-to-preview, computed for the previewed selection and shown in
  the preview treatment.
- For pattern shape, ranking by the centroid equals ranking by its normalized
  direction (`‖zᵢ − z̄‖² = 1 + ‖z̄‖² − 2 zᵢ·z̄`), so the label need not
  distinguish them.

**UI.** In the relationship section, for the focused observation: rank, ID,
distance with its declared definition, rank in the 2D layout, and **Compare**.
Compare needs `PopulationExplanation` to accept a requested pair. Today the
pair is internal state (`PopulationExplanation.tsx:21–24`), so lift it to a
prop or to store presentation state. Note when the nearest point on screen is
not a true neighbour. Show overall k = 3 preservation beside stress.

**Checks.** Brute-force ranking and weighted-centroid tests on known
configurations, including ties within tolerance, n = 2 to 5, coincident and
near-coincident maps, numerical cancellation near zero, participant weights,
stale and non-mean disabling; a component test for the list and the Compare
hand-off.

### W3. Observation status display

- `resolvePopulationContext` gains per-member exclusion reasons, naming the
  scope or filter (`populationContext.ts:23–62`). A whole-context issue
  (`context.issue`) is shown once as an issue, not as every member being
  "outside the context".
- A pure resolver returns **facets**, not one label, because they co-occur:
  `inContext` (with reason when false), `selected`, `previewedOut`,
  `unavailableAtProbe`, `unassigned` (with reason). Every view reads it.
- Preview-without currently lives in `PopulationLens` local state (:106). The
  values table can render in a different React root, so lift the preview
  target into the store as **presentation state**. It is not a seventh
  analytical state: it changes no membership, summary or export. The target
  may be one observation, a participant, a saved set or a group; the resolver
  expands it to member IDs.
- The values table gains a collapsed "Outside the context (n)" group with
  reasons. These rows are not focusable (user decision) and never enter
  summaries, selection algebra or exports.
- **Checks:** resolver tests for facet combinations and the whole-context
  issue; store tests proving aggregates and exports are unchanged by the
  lifted preview target; a harness case for the preview treatment across
  panels.

### W4. Open the focused observation in the viewer

`ensureSourcePathDisplayed` cannot meet this workstream's requirements. It
takes no digest or frame, drops concurrent requests for the same path, adopts
any existing layer with the same path, and toggles other managed layers
(`StudioDisplayService.ts:40–56, 148–173`). W4 is therefore a new
verified-load path.

- **Rust/loader:** load by (path, `expected_sha256`, `stack_index`), refusing
  on digest mismatch. Return a layer ID owned by the caller.
- **Service:** an inspected-observation slot that owns exactly the layers it
  created. It cancels by generation token, never adopts or reclaims a layer
  the user loaded, and keys 4D members by (path, frame). Live members are
  verified against the population's current source revision so the viewer
  matches the cutout. Saved members are verified against the frozen digest
  and frame.
- **Lens:** do not switch the Studio lens. The coordinator auto-runs
  `ensureMemberDisplayed` for every non-population lens
  (`StudioCoordinationService.ts:201`), which is the unverified legacy path.
  If a lens switch is ever needed, suppress that call while the slot is
  active.
- **Return:** a **Back to population** breadcrumb restores focus, probe and
  crosshair. Population state survives lens changes (`setStudioStore.ts:446–472`).
- The docked focused-original pane remains the peek; there is no floating
  peek window.
- **Decision first:** which workspace receives the inspected layer (Decision
  5) must be settled before writing tests.
- **Checks:** loader tests for digest mismatch and frame selection; service
  tests for generation cancellation, no adoption of user layers, 4D frame
  collision, stale-switch rejection and return state; native acceptance in
  the `.app` bundle.

### W5. Space arrangement

An arrangement of the same observations inside the Population lens, alongside
Inspect / Montage / Groups: actual cutouts placed at the fitted 2D
coordinates. It is not a new top-level mode (exploration plan :60).

- **No fit, no layout.** The arrangement offers the existing explicit fit
  action rather than fitting automatically. Stale fits follow the stale
  principle.
- **Pictures.** Cutouts come from `evaluate_population_slice`, which caps a
  request at 96 members and 64 px. For n up to 128, issue two requests that
  share one source-revision check, with an explicit partial-failure state; or
  raise the cap with memory and latency evidence. Choose one at design time.
  Enlarge-on-hover uses a separate full-resolution request or the
  focused-original pane, never an upsampled cutout.
- **Legibility.** The next delivery plan (:94) asks to virtualize and page
  rather than shrink anatomy. Space cannot page without breaking the layout,
  so at small sizes it either draws points or limits how many pictures are
  drawn at once (the focused observation and its neighbours always drawn).
  Decide this on the canvas (Decision 7).
- **Helpers.** Vendor the pure helpers from neuroimjs
  `examples/volume-set/space.ts` into `ui2/src/services/studio/spaceLayout.ts`
  with a provenance header naming commit `c4d23a4`, and port
  `tests/VolumeSetSpace.test.ts`: `spaceTransform`/`zoomAbout`/`panBy`,
  `thumbSize`, `declutter`, `placeLabels`, `positionMarkers`,
  `directionalNeighbor`, `screenRanks`, `coincidentGroups`. Changes:
  - `coincidentGroups` uses the shared relative tolerance; tolerance
    union-find chains transitively, so declare that or use complete linkage
    within the tolerance.
  - Every displaced picture gets a visible marker; neuroimjs omits markers
    under max(4 px, 0.2 × width) and inside the picture's own bounds.
- **Performance.** Cache declutter per (result revision, thumbnail size,
  canvas size, quantized zoom). Move the decluttered set rigidly during pan
  and zoom and re-declutter on gesture end.
- **Selection.** The existing lasso hit-tests DOM `[data-datum-id]` centres
  (`PopulationBrush.tsx:142–157`), which a canvas lacks. Add a
  coordinate-based selection API or hidden DOM anchors. Lasso uses
  **fitted** positions, and that rule is in the frozen list.
- **Interaction.** Click focuses; arrows move by `directionalNeighbor`; Enter
  opens in the viewer once W4 lands; labels and IDs are hit targets (avoiding
  the neuroimjs strip-label defect, mote `bd-01M5WC0DCQGP6KYJ1GFQ2A25N7`).
- **Trust line.** k = 3 neighbour preservation for fitted and drawn positions
  (W1) and the W2 unassigned list.
- **Style.** Chrome achromatic, chroma only in images, neutral markers and
  leader lines, focus as the amber ring, selection as the row edge.
- **Acceptance.**
  - Automated: fit-origin labels present on every similarity grouping, no
    type or subgroup wording, provenance carried into partitions, and the
    pure-noise fixture showing no structure claims.
  - User task: a fixture with planted influential and outlying maps (for
    example 80 observations with 4 planted). At least 6 participants each do
    the same tasks with Space and with the existing scatter plus montage, in
    counterbalanced order. Space ships if accuracy in finding the planted
    maps is no worse and time is no worse by more than 20%. False subgroup
    claims on the noise fixture are recorded and must not exceed those made
    with the scatter.
- **Checks.** Ported helper tests; deterministic visual-harness specimens at
  n = 12, 80 and 128 with coincident and displaced maps; Playwright cases for
  keyboard navigation, label clicks, coordinate-based lasso and refit only on
  request; native acceptance with pan and zoom timing at n = 128.

### W6 and W7 (candidates, under discussion). Linked montage and Facet

Both come from the neuroimjs volume-set browser (Montage, Facet) and were
added while planning; they are candidates to weigh against Space, not yet
commitments.

- **W6 Linked montage.**
  - One anatomical crop is shared by every montage cell and by Space's
    pictures: ⌘ + wheel zooms about the pointer, Shift + drag zooms to a box,
    drag pans, 0 fits.
  - Cells render at the crop's resolution rather than upscaling the 64 px
    cutouts. That needs the cutout cap raised or tiled, with memory and
    latency evidence (`population_slice.rs:24-25`).
  - The montage gains a seriated order and r to the mean on each cell.
- **W7 Facet.** An observation × feature grid (contrasts, runs, lags or
  metadata levels), with a mean column, sharing the crop, slice, threshold,
  cursor and focus.
- **Why they matter.** Neither needs a relationship fit or distorts
  distances, so they serve every set; Space serves fitted sets.

## Design and visual quality

Each user-facing surface (W2 unassigned list, W1 neighbour list, W3 status
rows, W4 breadcrumb, W5) goes through the same sequence:

1. **Design pass before code**, on a Claude Design artifact canvas: one
   artboard per surface and state (empty, loading, populated, unassigned,
   stale, preview, narrow), built with the artifact design skills, using the
   [Brainflow design system](https://claude.ai/artifact/J4cm3oJbcvw4D54z7fxE4H)
   (private; derived 2026-10-26 from `ui2/src/styles/theme.css` and the HYBRID
   rules; re-sync it if `theme.css` changes). First-round artboards for W1 and
   W2 (fitted, unassigned focus, stale, empty, narrow):
   [Population contributors and Space](https://claude.ai/artifact/9P3B8TcySXrf8mSozLCPh8)
   (private, draft). `impeccable` may be used for
   critique and polish; its output is checked against the tokens, the
   visual-style contract and the frozen list before anything is adopted.
2. **Build to the functional checks.** Visual work does not start on a
   surface whose numbers or state transitions are unverified.
3. **Visual hill climb** in `.hillclimb/neurotabs-space/`, following the
   redesign campaigns (`FROZEN.md`, `RUBRIC.md`, fixed specimens, independent
   critics, regression checks).
4. **User-task acceptance** (W5). A higher critic score does not substitute
   for it.

**Frozen for the hill climb** (in addition to `.hillclimb/redesign/FROZEN.md`):
fitted coordinates, distances, neighbour ranks and preservation values;
unassigned membership, reasons and support loss; displacement markers on
every moved picture; lasso on fitted positions; refit only on request; stale
behaviour; the six-state semantics; image pixels and colormaps inside cutouts.
Critics may change how truth is shown, never what is shown.

**Specimens**, from deterministic fixtures through the visual harness:
n = 12, 80 and 128; coincident and near-coincident maps; heavy displacement
after declutter; several unassigned observations with mixed reasons; a stale
fit; the pure-noise fixture; an active hold-to-preview; the small-size
threshold; desktop and narrow layouts.

**Rubric dimensions:** anatomy legible at the intended size; distortion
apparent without reading the caption; focus, selection and preview
distinguishable at a glance; unassigned and outside-context observations
findable; primary route obvious with advanced controls disclosed; token and
type-scale compliance; no chroma in chrome.

## Not in scope

Bootstrap stability ellipses (neuroimjs warm-starts its refits, which
understates spread), density contours, noise-corrected similarity (assumes
calibrated, spatially independent noise), NMDS/UMAP, fits beyond n = 128, and
the neuroimjs iframe. The exploration plan keeps alternative embeddings as
research ideas; each needs its own qualification.

## Decisions

Settled (user, 2026-10-26):

1. W2 low coverage: new fits exclude members whose finite count is below
   0.9 × the median, as a declared part of the relationship definition.
   Restored v1 fits keep v1 behaviour, so the strict (refusing) path remains
   by construction.
2. Focus stays within the context, as the state contract says. Observations
   outside the context are listed with reasons (W3) and are not focusable.
3. The design system gains the `ui/bf` component bundle before artboard work.

Open:

4. W2: whether the UI also offers the strict path for new fits.
5. W4: which workspace receives the inspected layer. Settle before W4 tests.
6. W5: arrangement name ("Space" or "Similarity"), and whether the scatter
   remains beside it or becomes a mode of the same canvas.
7. W5: points versus a limited number of pictures at small sizes; and two
   cutout requests versus a raised cap for n > 96.
8. Whether to also rank by the normalized arithmetic-mean map for pattern
   shape. This needs only the per-member centred norms (already computed at
   `relationship_math.rs:58`) returned in the geometry, not a voxelwise field.

## Delivery and records

One commit per workstream, each with its checks; persistence and acceptance
travel with each, as in the next delivery plan. Record evidence in the ledger
as each workstream lands. Do not mark the overall M0–M5/P issue complete
because this packet passes.
