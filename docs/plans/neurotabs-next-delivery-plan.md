# NeuroTabs: from inspection to fluid exploration

**Planning baseline:** Brainflow `a925842b`, 2026-09-06. This is a delivery plan, not a claim that all proposed interactions exist.

**Delivery update:** the first movie/montage implementation packet is implemented and covered by [local evidence](neurotabs-movie-evidence.md). Native desktop visual acceptance remains open; subsequent deliveries remain planned.

This document sequences the seven remaining areas in the [implementation ledger](neurotabs-implementation-status.md). It preserves the full M0–M5 and linked-plotting scope of the [population exploration plan](neurotabs-population-exploration.md), while replacing that document's original first-work-package instruction with a plan for the current foundation.

## The experience we are building

A population should feel like something the researcher can hold, unfold and examine. The anatomy stays in place. The people retain their identities. A summary remains a doorway to its contributors.

One continuous session should work like this:

> Notice a patch in the mean. Pin it. Scrub through the people who produced it. Spread their corresponding images into a montage. Brush a range of responses, or group by a factor. Compare the group means. Order the observations by spatial similarity and inspect an unusual person. Collapse A and B into their difference, inspect a defined test, then expand back to the contributing people. Open a grouped plot at the pinned region. Save the exploration and recover the same inputs, groups and views later.

The central design is **one population, several representations**. Browsing, montage and grouped views are arrangements of identified observations. Statistical operations create identified results. The interface makes the transition between those two kinds of action clear.

The existing implementation already supplies live summaries and focused originals, probe values, regional cutouts, participant reductions, masks, frozen exports, strict recalculation and interactive reopening. We will extend that path rather than introduce another application framework or another cohort store.

## The shape of the workspace

Use Brainflow's existing shell, [design system](../../resdesign/Design.md) and [Studio app-mode architecture](../../memory-bank/Set_Studio_App_Mode_Plan.md).

| Place | What belongs there |
|---|---|
| Study toolbar | Dataset identity, compact selected/available counts, open/save actions; a restrained breadcrumb for the current grouping or comparison |
| Left data sidebar | Observations, metadata filters and named sets; search affects the list, while eligibility filters are explicit |
| Center canvas | Population and focused original by default; an arrangement control for Inspect / Montage / Groups; stable anatomical framing |
| Population strip | Focus scrubber, playback, order label and compact all-observation values; remains available when a montage or comparison is open |
| Right Inspector | Settings for the explicitly inspected object: population, group, comparison, relationship or plot; advanced choices stay in disclosures |
| Bottom Plot dock | Full population distributions, relationships and grouped/time-course plots; pin several plots and enlarge one without losing the brain context |
| Status and Activity | Current query identity, progress, unavailable inputs and meaningful playback/cache status; diagnostic timings stay out of normal controls |

The small strip is a navigation and selection instrument. The Plot dock owns full charts and plot authoring. They share samples and selection state. This resolves the current tendency for the center's values panel to grow into a second plotting workspace.

An inspected object is presentation state, separate from population membership and individual focus. Hover never retargets the Inspector. Selecting a group title can inspect that group; clicking a person's image focuses the person without replacing the working selection.

A few visual rules apply throughout:

- Keep compatible effect maps on a shared scale and keep anatomy stationary during member changes. Evidence, spread, coverage and reconstruction displays have their own explicit identities and appropriate scales.
- Give each setting one editable home. The center owns arrangement/navigation; the Inspector owns analysis and display settings; a plot's compact mapping panel appears in the Plot dock.
- Reserve strong color for measurements and selection. Use existing typography, spacing, icons and flat controls. Remove placeholders for unavailable future features.
- Animate movement between known positions, not interpolation between people's measurements. Try 160–220 ms layout transitions, cancelable and interruptible; reduced-motion mode changes layout immediately.
- Keep names, selected count, focused ID and order visible during reorganization. Preserve focus and scroll position when virtualized items leave and re-enter the viewport.
- At narrow widths, stack the two images or enlarge one through an explicit action. Retain a readable identity for the other. Hidden sidebars must have an obvious way back; the work area must not become a nested three-column dashboard.

These are design targets. Review them in the actual docked application as well as in isolated browser compositions.

## The contract beneath the movement

Preserve the six analytical meanings already established: context, working selection, focus, reference, spatial probe and relationship definition. Add presentation and derivation records around them, without changing their meaning.

The names below describe proposed contracts, not new commands already registered in the bridge.

| Contract | Minimum information and ownership |
|---|---|
| Observation source | Observation/participant identities, feature role and units, source revision, explicit frame/axis selection, support identity and validity policy |
| Order definition | Complete ordered observation IDs, unavailable IDs, rule, source/probe or fit revision, tie rule and direction; independent of the working selection |
| Partition definition | Named groups with exact member IDs, generating factor or clustering rule, missing/unassigned members and provenance; distinguish disjoint partitions from overlapping named sets |
| Field expression | Observed field, population reduction, contrast or reconstruction; typed operands, operation order and source revisions; the same expression serves the view and export |
| Presentation state | Arrangement, focus, camera/scale references, expanded groups, active result channel and dock state; contains no numerical arrays |
| Plot recipe | Sampling binding, row grain, axis semantics, mappings, layers, participant reduction, band definition and contributor lineage |
| Exploration record | Versioned references to the above, plus derivation and presentation history; separates live definitions from frozen resolved operands |

State transitions are explicit. A scrub changes focus. A brush changes working membership. A group operation changes the partition. A comparison creates a result with A and B as operands. Changing the probe updates sampled values; it never silently refits a relationship or reorders people.

Working membership and derivation history record completed gestures. Hover and every playback frame do not create undo entries. Releasing a temporary exclusion restores the original query; a separate action commits a changed selection. Cancel and keyboard alternatives accompany gestures.

## 1. Movie, montage and grouped arrangements

**User outcome:** move through actual maps quickly, then spread the same people into a montage without losing place.

Deliver this in two passes. First, support source order, explicit metadata order and the existing frozen regional-response order. Then add similarity orders from work area 4 through the same order contract. This produces a useful first release without waiting for an embedding.

The strip provides previous/next, a scrubber, play/pause, direction and a compact speed control. Space toggles playback when the strip owns keyboard focus; arrow keys advance observations. It never steals shortcuts from text inputs or ordinary imaging navigation. Leaving the workspace, changing datasets or closing it stops playback. Scrubbing interrupts playback immediately.

Warm playback shows discrete original observations. Start with 5 and 10 observations per second and an explicit “show every observation” policy: slow down on a miss and report buffering. A later real-time policy may skip observations, but must identify that policy and report skips. An ordered set of contrast maps is not labeled as acquisition time.

Expanding to Montage preserves order, focused ID, working membership, anatomy and scale. The focused tile stays visible. Regional cutouts use the pinned probe; whole-field previews use the shared current plane. Virtualize the montage and reuse a bounded tile/sprite cache. Returning to Inspect brings back the same focused observation and camera.

**Engineering:** separate focus presentation from population recomputation. Reuse the current native plane matrix for all observations on a fixed plane; cache the focused raster and a bounded neighborhood in the active order. Avoid repeatedly sending an unchanged population bitmap while scrubbing. Cache keys include source/frame/support, camera/sampling and display mapping. Direction-aware prefetch yields to direct focus requests and is canceled on order/geometry changes. Use resident GPU image-set primitives where the rendering path supports them; do not allocate a volume layer or permanent 3D texture per tile.

**Exit demonstration:** scrub → play → reverse → montage → focus a tile → return to Inspect. Exact IDs, working membership, pinned probe and compatible scales survive every transition. A ten-minute warm playback run stays within the declared cache budgets and records input-to-image latency and misses.

## 2. Selection, groups and reversible comparisons

**User outcome:** form a group in the brain, plot or table and examine it against a clearly identified reference.

Add range brushing to the strip and plot, rectangle selection in the montage, and lasso where a 2D relationship plot exists. All produce observation IDs through one selection service. Modifier keys and visible Replace / Add / Intersect / Remove actions share the same semantics. Focus is independent; Escape cancels an unfinished gesture.

A compact reference control offers a named set or the remaining observations in the current context. Show both observation and participant counts where they differ. Pinning a reference freezes membership; a live complement is visibly tied to its current context. Overlap remains legal for descriptive displays and visible in their counts; inferential operators apply their own eligibility rules.

Grouping by a factor creates labeled group cards on the canvas. Each card offers a summary and “Show contributors.” Missing factor values occupy an explicit group until the researcher chooses exclusion. Factor grouping and similarity grouping are distinguished by their origin. For many groups, virtualize and page; do not shrink anatomy to illegible thumbnails.

A and B can be assigned through visible controls or drag previews. The first comparison is the descriptive A−B effect. Collapsing A/B into the difference retains the two operands and their prior arrangement. Expanding restores their contributors. Preview without can target the focused observation, its participant, a selected subset or a named group; the preview labels exactly which units are omitted.

**Engineering:** add partition and comparison expression records to the existing Studio state/services. Keep exact membership snapshots with their rules. Use shared field reductions for side-by-side group results; add stable incremental updates for mean, spread, cancellation and coverage with periodic rebuilds. Nonlinear or model operations keep separate evaluation paths. Restore references and partition/history records in the next version of the exploration format.

**Exit demonstration:** brush → save a set → group by factor → choose A/B → inspect A−B → expand contributors → preview without a subset → release → undo grouping. An independent state trace proves that selection, reference, focus and anatomy change only through their declared actions.

## 3. Statistical comparisons with explicit meaning

**User outcome:** choose a question about identified participant effects and inspect both its effect and evidence without losing the inputs.

Add operation-specific readiness before exposing test actions. Imported features declare effect estimate, standard error/variance, t, z, label or other role, plus units and relevant design metadata. Unknown roles remain inspectable descriptively; the app requests the missing declaration when an operation requires it. Same grid is a computational support check, not proof of registration quality.

| Operator | Required declaration | Result channels |
|---|---|---|
| One-sample | One effect per independent participant after any declared within-person reduction; stated null value | Effect relative to the null, SE, t, df, local count |
| Independent groups | Disjoint participant groups, comparable effects and units; Welch estimator | A−B effect, SE, t, df, counts for A/B |
| Paired | Explicit participant pairing and A/B order; valid within-person differences | Mean paired difference, SE, t, df, valid-pair count |

Select a result channel in place; effect remains the default. Keep the contrast definition visible. Group A's one-sample test, group B's one-sample test and the A−B test remain separate results. Collapsing two groups never substitutes a test of their two average images for a participant-level analysis.

Specify local missingness, insufficient counts, zero standard errors and invalid pairings before implementation. Unsupported tests explain which declaration or input is missing while preserving available descriptive views. If pointwise p-values are exposed, identify them as uncorrected; correction requires an explicit family/support and validated method.

Selections made from response values, clustering or components carry their exploratory derivation into comparisons and exports. “Freeze discovery” records the rule, resolved people, support, metric and proposed comparison; it does not manufacture independent validation. More complex repeated-measures, adjusted or mixed-effects analyses enter through named model adapters with their own input and verification contracts.

**Engineering:** put pure estimators and readiness validation in `core/field_table`, using the same expression/result-channel interface for visible support and export. Retain effect/SE/t/df/count siblings under one result identity. Test against independently implemented batch formulas and published statistical references before enabling each operator; imported fitted-model outputs retain their original estimator identity.

**Exit demonstration:** correctly recover one-sample, Welch and paired results on deterministic fixtures, including incomplete pairs and repeated observations. The UI explains what each map tests and refuses role/unit/independence mismatches. A saved comparison reopens with the same inputs and output meaning.

## 4. Similarity, relationships and decomposition

**User outcome:** navigate spatial variation, then ask what in the brain explains the arrangement.

Begin with two named choices: effect distance in compatible original units, and pattern-shape distance after explicit centering/normalization. Fit on a declared common valid support. Report coverage loss and unusable maps; do not fill missing measurements with zero or silently use different pairwise supports.

The first fit supplies classical MDS coordinates and a movie order along its first coordinate. Pin the fit to a context/source/support revision. Selection, focus and hover do not move points. Sorting direction and tie handling are deterministic within that fit. Report representation quality; if leading axes are degenerate or poorly determined, avoid implying a unique ordering. Any refit is a visible new geometry.

Expose average-linkage grouping with an explicit group count/cut and deterministic ties. Keep unassigned observations visible. Inspecting an ROI changes regional readouts immediately; “Compare maps in this region” explicitly requests a new relationship fit. A lasso stores IDs, so it survives a new embedding.

The second pass closes the explanatory loop. Selecting two observations displays the spatial contributions to their declared squared distance. A component selection shows its loading map, score distribution and actual low/middle/high-score examples. Observed-map browsing and a reconstruction slider remain separate, labeled representations. Add largest-deviation witnesses and actual maps nearest a summary using the same declared distance.

**Engineering:** implement blockwise projections and weighted Gram calculations behind a bounded relationship job. Account for the n×n matrix before admission. Cache regional sufficient quantities where valid; combine raw quantities before centering/normalization. For larger contexts, offer explicitly identified approximate fits only after an exact reference path exists. Spatial attribution must sum to the reported distance under the same transformation and support.

**Exit demonstration:** two people far apart in the plot reveal their differing brain locations; a stable order drives the existing movie/montage; a selected component leads to original people. Numerical tests cover known configurations, constant maps, missing support, tied axes and distance attribution. Refit, cancel and stale-result tests preserve live selection.

## 5. Plotting across sets

**User outcome:** pin a brain location and build a clear grouped plot, with every mark still connected to its observations.

Deliver plot authoring after the selection/group contract is available; it need not wait for decomposition, surfaces or model adapters. Reserve the typed sample and recipe fields in the first implementation packet.

Start with editable presets: distributions by factor, covariate scatterplots, condition profiles, participant time courses with group summaries, and observation-by-axis heatmaps. Each opens in the existing Plot dock. A compact mapping panel controls data binding, x/y, participant/line identity, color, facets and summary layers. Advanced choices appear only when used.

Hover is a temporary preview. Pin fixes a spatial probe. Following a live selection versus retaining a membership snapshot is a separate choice. Several plots can pin different probes or named sets. Clicking a sample focuses its observation and, when applicable, its real frame; brushing selects IDs. Brain navigation never silently retargets a pinned chart.

Use a canonical row grain of observation × axis sample × feature × probe. Participant identity and validity are explicit. Named-set membership is a relation to those observations, not permission for a join to multiply contributions. If the same participant belongs to several displayed sets, identify the overlap and apply the chosen statistical rule.

Time requires measured times or a declared interval and units. Index, condition and similarity order remain distinct axes. Irregular samples, missing timepoints, alignment and interpolation are explicit; trajectories never join different participants accidentally. The analysis order is spatial reduction, any declared temporal/within-person operation, then population aggregation.

Separate spatial dispersion, observed participant spread and uncertainty about a summary. Each band records its estimand, method, unit and local contributing count. Recoloring, faceting and regrouping a cached frame must not reload images. Save the recipe and tidy samples, and export a standalone SVG/PNG alongside data and provenance.

**Engineering:** extend `SampleProvider`, `SampleFrame`, `PlotSpec`, the shared encoder and `plotSpecStore`; avoid a parallel plotting engine or independent selection store. Preserve contributor IDs through grouped transforms. Bound temporal sampling separately from rendering and key caches by source/support/axis/alignment. A delayed hover response cannot replace a pinned result.

**Exit demonstration:** pin ROI → individual trajectories → color by treatment → facet by condition → add a defined group band → click a timepoint to inspect its map → brush a subset → save/reopen plot. Grouped results match independent references, overlap does not inflate effective counts, and changing appearance requires no new spatial reads.

## 6. Persistence, support and analytical breadth

**User outcome:** a saved exploration is recoverable, and supported parcel/surface datasets behave like first-class data rather than special cases.

Persistence accompanies the interaction work. The current calculation record continues to open; a versioned exploration manifest adds full-context metadata/participant identity, exact selections/references, partitions, fitted orders, probe definitions, field expressions and plot recipes. Persist completed presentation history, not every hover or frame. Preserve the source/context distinction and derive capability/readiness from what a legacy record actually contains.

Offer two explicit save policies: **linked inputs**, with hashes and recorded locations, and **include inputs**, with verified immutable copies in a content-addressed bundle. Report storage size before copying. Hash and copy the same bytes, stage atomically, cancel cleanly and deduplicate by content. Source relocation must locate the expected content, not accept a similarly named file. Moving a source does not change the scientific identity; changing its contents does.

Saved fits include their numerical coordinates/order and algorithm provenance. If an implementation cannot reproduce or consume a stored fit, preserve its viewable result and identify the limitation rather than silently refitting. Schema migration must not invent units, participant identities, reference membership or temporal semantics.

Broaden the support interface in measured steps:

| Extension | Admission and release requirement |
|---|---|
| Parcel populations | Atlas family/version/resolution and explicit parcel/hemisphere keys; strict joins and missingness; select in map/table/plot with the same identities |
| Surface populations | Mesh/topology, hemisphere, vertex correspondence and anatomical coordinate provenance; area weights when declared; separate visual unfolding from registration |
| Robust summaries | Median and median absolute deviation, with any scaling named explicitly; exact reference values, missingness rules and realistic cost profiles |
| Pivot views | First, two-factor grids of mean/SD/count expressions; cells expand to their contributors and share plotting/selection semantics |
| Model adapters | First, an ordinary least-squares group GLM with one row per participant, explicit design/contrasts, rank and missingness checks, and independently verified outputs; fitted and descriptive means remain distinct |

Mixed-effects, arbitrary repeated-measures and meta-analysis adapters need separate estimator-specific plans; the initial breadth gate is the declared group GLM. Reuse the Rust atlas library and tighten its identity contract where the adapter requires it. Parcels and surfaces need their own conformance evidence; a generic scalar array is not sufficient proof of compatible support. Preserve existing image/parcel overlay workflows when promoting them into populations.

**Engineering:** keep the numerical reduction core independent of geometry. Geometry-specific source adapters supply validated support and samples to the same field/probe interfaces. Give decoded sources, live tiles, relationship results and saved bundles separate owners and budgets. Dataset close must release its leases without evicting another workspace's active data; retained bundles are not an opportunistic cache.

**Exit demonstration:** move a saved bundle, reopen it offline when inputs were included, restore groups/reference/plots, and reproduce the same operands. Refuse a changed source offered as a relocation. Run the shared population interaction tests on validated volume, parcel and surface fixtures. Each robust operator and model adapter has its own numerical and performance gate.

## 7. Native acceptance, performance and visual quality

This is a continuous release gate, beginning before new animation is added. Unit tests and a synthetic Playwright composition establish different evidence from native IPC, GPU behavior and real docking.

Build an importable, audited fixture family: shared response, opposite signs, minority-driven mean, spatial displacement, pure noise, missing coverage, repeated participants and known paired/group effects. Include a compact masked dataset and realistic full-grid files, plus 4D, parcel and surface variants as those adapters arrive. Keep deterministic expected values and source hashes with the fixtures.

| Evidence | What it must demonstrate |
|---|---|
| Numerical | Independent batch references, algebraic invariants, missingness, participant units and view/export agreement |
| State/lifecycle | Focus/selection/reference separation; stale completion refusal; abort/unmount; workspace switching; bounded resource ownership |
| Playwright | Real controls and linked views, keyboard/touch alternatives, reduced motion, narrow Inspector, large/small viewport layouts and sustained interaction |
| Native application | Import, local/remote source handling, native dialogs, GoldenLayout/sidebar/Plot integration, navigation, save/reopen and GPU/resource behavior |
| Human task review | Researchers can explain who contributes, identify what a test compares, and recover contributors without mistaking an embedding for a discovered population type |

Record input-to-visible-image p50/p95/p99 on a named reference machine and fixture. Initial warm p95 targets remain one 60 Hz frame for immediate selection feedback, under 50 ms for a cached focused image, and under 100 ms for a visible selection-summary update. These are acceptance targets, not current claims. Measure cold reads, sustained playback, remote cache hits/misses, export during browsing and memory pressure separately.

Adapt work to fit budgets: visible support first; direct interactions before prefetch; cancel obsolete fits; retain previous results with their query identity. Use revision keys that separate scientific results from camera and color mapping. Approximation, if introduced, is explicit. Large sets receive a bounded admission decision or a declared preview mode; they do not silently become downsampled populations.

Visual reviews use the real app at a reference desktop size, a constrained laptop size, and narrow dock widths. Check label truncation, focus visibility, stable controls, square anatomical pixels, common scales, keyboard routes and reopening after a panel closes. Run browser ownership audits before/after automated sessions and close owned tools. If native automation is unavailable, record the specific gap and perform a manual acceptance run when possible; do not replace that release gate with another mocked test.

**Exit demonstration:** a researcher completes the full storyboard in one native Brainflow workspace with a reproducible performance receipt. The original imaging, remote loading and atlas-overlay workflows still pass their relevant regression checks. Every completed work area has numerical, interaction and resource evidence appropriate to its scope.

## Delivery order and review points

The seven areas are responsibilities, not seven isolated releases. Implement in the following order; persistence and acceptance travel with every delivery.

| Delivery | Shippable user path | Work areas | Gate before moving on |
|---|---|---|---|
| A. Move through people | Response/source ordering → cached scrub/play → montage → same focused person | 1; minimal contracts from 5/6; 7 | IDs, geometry and membership invariant; bounded sustained playback; desktop layout baseline |
| B. Work with groups | Brush → named set → factor groups → A/B means → descriptive difference → contributors | 2; references/history from 6; 7 | Exact memberships and overlap visible; reversible comparison; reference/partition restoration |
| C. Navigate similarity | Explicit spatial distance → stable MDS order → same movie/montage → requested clusters | Initial 4 integrated into 1/2; 6/7 | Fixed fit during selection; declared support; deterministic saved order; fit-quality display |
| D. Ask a statistical question | Typed participant effects → one-sample/Welch/paired result → channel switching → frozen discovery | 3; 6/7 | Independent numerical results; role/pairing refusals; saved estimand and exploratory origin |
| E. Compose linked plots | Pinned samples → grouped/faceted layers → temporal profiles → export/reopen | 5; 6/7 | Declared row grain and bands; cached regrouping; click/brush round trip |
| F. Explain and broaden | Spatial distance attribution and components; retained/relocated studies; parcel/surface populations; robust/pivot/model extensions | Remaining 4/6; 7 | Conformance suite for each operator/support; complete native storyboard and budgets |

Plot authoring E may start after B once its sample/axis contracts are ready; it does not depend on C/D or F. Simple grouped distributions should arrive before complete temporal alignment and uncertainty layers. Similarly, linked-input restoration is part of A/B, and include-inputs/relocation should ship as soon as its bounded storage path is verified. F is a set of individually accepted extensions, not a reason to defer usable recovery or plotting.

Delivery B is the first review of fluid set manipulation. Delivery D completes the movie/group/contrast story with basic inference. C and the first E slice make spatial and plotted relationships navigable. F closes the remaining breadth commitments in the original plan. Do not mark the overall M0–M5/P issue complete because one delivery passes.

## The next executable packet

Start with delivery A as one coherent implementation increment:

1. Introduce an immutable order definition using existing source and regional-response orders; preserve the current six analytical states.
2. Add focus-first scheduling and a byte-bounded plane/tile prefetch cache to the current population path. Establish the cold/warm native baseline before optimization.
3. Wire the pinned population strip to scrub/play and a reversible Inspect/Montage arrangement, using existing viewports and cutout composition.
4. Persist the order rule/resolved IDs, focused member and arrangement with the saved calculation's frozen source bindings. Open old records with truthful defaults.
5. Add the audited 80-observation fixture, numerical/state regression checks and Playwright movie/montage coverage; complete the native run and retain its latency/resource receipt.

At review, demonstrate the same person moving from strip to large image to montage and back, with the mean, selected people, probe and scale unchanged. That is the smallest next step that makes the product feel fluid while strengthening the architecture needed by all seven areas.

## Implementation anchors

| Existing location | Planned responsibility |
|---|---|
| [`setStudioStore`](../../ui2/src/stores/setStudioStore.ts), [`population state`](../../ui2/src/types/population.ts), [`StudioCoordinationService`](../../ui2/src/services/studio/StudioCoordinationService.ts) | IDs, selection/reference, order/partition definitions, presentation history and coordination across dock roots |
| [`PopulationSliceService`](../../ui2/src/services/studio/PopulationSliceService.ts), [`native plane engine`](../../core/api_bridge/src/population_slice.rs), [`image sets`](../../core/api_bridge/src/image_set.rs) | Focus-first scheduling, cached visible support, resident adapters, cancellation and ownership |
| [`PopulationLens`](../../ui2/src/components/studio/PopulationLens.tsx), [`PopulationInspector`](../../ui2/src/components/studio/PopulationInspector.tsx), [`shared viewport`](../../ui2/src/components/views/SliceViewport.tsx) | Canvas arrangements, contextual controls, preserved anatomical geometry |
| [`field_table`](../../core/field_table/src/lib.rs), [`population kernel`](../../core/field_table/src/population.rs) | Typed operations, independent numerical implementation, shared view/export semantics |
| [`SampleProvider`](../../ui2/src/services/SampleProvider.ts), [`plot contracts`](../../ui2/src/plotting/types.ts), [`PlotPanel`](../../ui2/src/components/panels/PlotPanel.tsx) | Sample/query identity, row grain, declarative recipes and linked plots |
| [`PopulationRestoreService`](../../ui2/src/services/studio/PopulationRestoreService.ts), [`export`](../../core/api_bridge/src/population_slice/export.rs), [`replay/open`](../../core/api_bridge/src/population_slice/replay.rs) | Versioned exploration records, source retention/relocation, strict validation and recovery |
| [`Playwright population tests`](../../e2e/harness/population-export.spec.ts), [implementation ledger](neurotabs-implementation-status.md) | Reusable interaction evidence, native acceptance receipts and current delivery status |

Keep new commands in the existing single-source bridge inventory, regenerate bindings/permissions, and apply the relevant numerical/rendering gates. Extract new modules only when these responsibilities outgrow their existing boundary. The product should become more capable while its visible structure stays simple.
