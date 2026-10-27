# Phase 4: rendering correctness, figures, clusters and series exploration

Status: APPROVED by the user 2026-10-27 (C2 opt-in with user FWHM; series E1-E6, FIR plugin deferred; region-colour outlines with dark halo). Follows phase 3 (PR #3).
Scope from the user: shader edge sampling; per-region label outline colours and halo; the
image-export payload; and the critics' backlog: surface figures, cluster sub-peaks and
cluster-level p values, and time courses. Time courses are reframed by the user as **series
exploration of derived results**. Examples: FIR estimates by condition and lag, averaged across
subjects with error bars, for a dynamically selected ROI, parcel or cluster. Raw 4D is just one
source. This is the time-series side of NeuroTabs.

Evidence:
- investigations (surface viewer, series architecture, shaders/export/clusters);
- `.hillclimb/p4/review/shader-repairs.md`.

## Step 0: adopt the earlier shader/display repairs (user decision: review, test, commit)

An earlier session left finished but uncommitted repairs in `core/render_loop/**`,
`core/neuro-cpu/**`, `core/render_contracts`, `image_set.rs`, parts of `lib.rs` and generated
`ThresholdMode`. Their documentation is `docs/shader-display-fixes-2026-10-25.md`, which covers
8 findings. There may also be a separate ui2 transport/apiService refactor.
- Commit them as their own commit(s), split as the review recommends, after GPU tests pass
  without regenerating goldens.
- This is the base for A1. Note that its finding 4 moved the CPU renderer to `[0, n)`;
  A1 changes both GPU and CPU to the voxel-centre convention.

## A. Rendering correctness

### A1. Voxel-centre edge sampling (mote bd-01M5WG08…)
- Today the texture mapping is already `(v+0.5)/n`. Only the inside tests are `[0, n)`. There
  are 4 of them: label and value samplers in both masked shaders.
- Change them to `-0.5 ≤ v < n−0.5`. Align the CPU reference renderer (`neuro-cpu`),
  `transform_validator::distance_to_bounds`, the test-local predicates, and
  `COORDINATE_SYSTEM_SPEC.md` (half-open `[-0.5, dim-0.5)`).
- Result: GPU pixels, the CPU renderer and the CPU picker/readout agree at the edges. Today the
  image is shifted half a voxel at the borders.
- The render goldens are regenerated deliberately, and the change goes in the commit message.
  Frozen-pixel exception: edge voxels only.

### A2. Label outlines: per-region colour and dark halo (mote bd-01M5WQ6D…)
- In `sampleSelectedLabelOutline`, colour mode "LUT" reads the label's LUT texel (alpha × LUT
  alpha, so hidden labels stay hidden).
- Halo: single-label mode gets an outer dark band; all-boundaries mode gets a second inner band.
- `SliceFeatureUbo` grows from 48 to 64 bytes (colour mode, halo thickness, halo colour), with
  the contract test, bridge `LayerOutlineState`, adapter and `labelDisplay.ts` updated.
- New defaults: LUT colours with halo `[0,0,0,0.6]`.
- Tests: `slice_outline_render_test` checks the LUT colour and the halo ring on the GPU.

## B. Export payload and compute hygiene (mote bd-01M5X75W…)

- **B1.** `save_image_bytes` and `export_population_plot` take raw IPC bodies
  (`tauri::ipc::Request`, `InvokeBody::Raw`) with the name in a header. Today the payload is
  JSON number arrays at about 4× size.
- **B2.** The transport gains `InvokeOptions`, and the mock and harness accept `Uint8Array`.
  This depends on Step 0's transport decision.
- **B3.** `compute_clusters`:
  - a cancellation generation counter, so superseded requests stop;
  - borrow F32 frames instead of copying them;
  - cap `maxClusters`.

## C. Clusters: sub-peaks and cluster-level p

- **C1. Sub-peaks** (SPM convention): local maxima within each cluster under the chosen
  connectivity, greedy with at least 8 mm separation, up to 3 per cluster including the main
  peak. Both values are parameters.
  - `ClusterSummary.subPeaks`; the table gets a disclosure row per cluster, and the CSV lists
    sub-peaks with regions.
  - Tests: two merged blobs at less than and more than 8 mm apart, plus plateaus.
- **C2. Cluster-extent p values (opt-in).** Gaussian random field theory using a
  **user-supplied FWHM (mm)**, or later one read from a sidecar or smoothness file. Stat type
  and df come from `StatisticInfo`, with t→z conversion as needed.
  - Formulas: expected cluster size and Euler characteristic, as in Friston 1994 and Worsley.
  - Reports corrected cluster p and the expected number of clusters. Every result is labelled
    "assumes stationary smoothness X mm".
  - Off by default. Validated against reference values from SPM or nilearn on synthetic fields.
- **C3. Design (user, 2026-10-27).** The inference maths live in a pure library crate,
  `core/neuro-inference`, with no Tauri or bridge dependencies, so it can later move into its own
  library. Its abstractions:
  - `StatField` and `Smoothness` (user-supplied now; an estimator trait can come later);
  - a `ClusterInference` trait with `RftClusterExtent` (the SPM `spm_P_RF` port) as the first
    method;
  - a method registry keyed by a stable id (`rft-extent`), so requests are
    `{method, params}` and permutation, TFCE or cluster-mass methods plug in without changing
    the command;
  - optionally a `VoxelThreshold` trait (Bonferroni, FDR).

  `api_bridge` is only an adapter.
- **Not shipped:**
  - FWHM estimated from the statistic map itself (biased);
  - permutation p values (need subject-level data). These belong in a future analysis plugin.

## D. Surface figures

- **D1. Vertex value in the status bar** for the active surface pane: vertex index and value,
  via `useSurfaceValueAtCrosshair`. Shows "—" without an anatomical mesh.
- **D2. Curvature underlay.**
  - Sulcal depth or curvature computed client-side from the matching white/pial mesh (surfview
    `computeSulcalDepth`/`computeMeanCurvature`), or loaded from `*.sulc`/`*.curv`/
    `*.shape.gii` when present.
  - Grey shading shows through below-threshold vertices.
  - A display toggle, persisted with the surface view settings.
- **D3. Multi-pose capture.** On the existing viewer: pause controls, hide the other
  hemisphere, set the anatomical view, export the PNG, restore. Poses include
  lateral+medial per hemisphere and both hemispheres.
- **D4. Surface export through the composer.** New targets "Surface" and "Surface lateral +
  medial". Panes come from D3 at print size, with a frame header and the composer's colorbar
  (threshold band and interior ticks). No scale bar or letters; an orientation glyph instead.
- **D5. Orientation gizmo.** SVG overlay in SurfaceFrame that projects RAS axes from the
  camera. The same glyph is drawn in exports.
- **Fixtures.** Add a right-hemisphere surface and a sulc file, synthetic or fsLR template, so
  the harness can capture right-hemisphere and lateral+medial specimens.

## E. Series exploration (time courses for derived results)

Principle: one **Series** abstraction:

> source × axis (time / lag / index) × factors (condition, …) × members (subjects) ×
> locus (point / sphere / parcel / label region / cluster) → two-stage reduction
> (spatial, then within-subject, then population with a band) → one series plot.

Raw 4D is one source among several. Most building blocks exist in Set Studio: population
reduction with sd/sem95 bands, 4D member expansion, line+ribbon marks, pinned plots, and
plot↔image linking.

- **E1. Typed series axis.**
  - `SeriesAxis {kind: time|lag|index, start, step, unit, alignment}` generalizes
    `PopulationTimeAxis` and replaces the ad-hoc `__traceTime`/`__traceFrame` columns.
  - NeuroTabs manifest convention: an observation column with `semantic_role: lag|time`, or a
    feature with `logical.axes` containing `lag`/`time` (unit and step from `axis_domains`).
  - Ontology inference proposes the mapping (for example a `lag-*` token or a lag column).
- **E2. Region loci.**
  - Extend `Locus.set` and `PopulationProbe` with `region {labelSource (layer|path),
    labelIds[]}`.
  - Backend: generalize `gather_member_roi_values` to prepared label/weight masks with
    cross-grid mapping (reusing the `compute_region_stats` logic), and add a stack index to
    region sampling.
  - Dynamic selection drives the probe: an atlas parcel (AtlasRoiPicker/Regions legend), a
    label-map region, a cluster row, or a sphere at the crosshair.
- **E3. Clusters as ROIs.** `compute_clusters` can emit a cluster-id label volume,
  registered as a hidden label layer, so a cluster row becomes a region locus. This also
  enables "time course of this cluster".
- **E4. Reductions.**
  - Add t-based ci95 and a median/IQR option at the population stage.
  - Declared collapse transforms before the population stage: mean over a lag/time window,
    condition difference (A − B per subject), and baseline subtraction.
- **E5. One series plot mode.** It reuses the encoder (lines per condition with ribbons;
  x = time/lag; facets optional) and works:
  - in Set Studio, on NeuroTabs/population series;
  - outside it, on a raw 4D layer (subsuming `CrosshairTimeSeriesPlot`), on an image-set
    axis, or on an FIR-style member set.

  Linking: hover or crosshair drives the locus. Clicking a point focuses that member/frame
  (`TimeNavigationService` for raw 4D). Exported through the existing plot export path.
- **E6. Fixtures and harness.** A synthetic FIR study with known answers: subjects ×
  conditions × lags, as 3D members with design columns *and* as 4D members, two conditions
  with different peak latencies, and a parcel atlas. Specimens: an FIR series for a parcel
  with sem95 ribbons, a cluster-ROI series, a condition-difference collapse, and raw-4D
  crosshair series. The fidelity critic recomputes means and bands independently.
- **Out of scope:** an FIR estimation analysis plugin, which would produce such tables
  (separate follow-up), and temporal alignment across runs with different TRs.

## Sequencing (no git worktrees; one implementation agent at a time per area)

1. Step 0, then A1 and A2 together (shader/render_loop owner), with B3 and C1/C2 in parallel
   (`api_bridge` clusters; disjoint files).
2. B1/B2 (after the transport decision).
3. D1–D5 (ui2 + packages/visualization), in parallel with E1–E3 backend (`field_table`,
   `api_bridge` sampling).
4. E4–E6 (ui2), then a hill climb: series and surface specimens, four critics, two rounds plus
   a closing round.
5. Fresh-context code review, native `.app` check (GPU edges, outlines, surface figures,
   series on real data), then a PR.

## Checks

- `cargo test` for render_loop (shader contract, render golden, outline), neuro-cpu,
  api-bridge and field_table;
- `pnpm check:permissions:strict`;
- ui2 `tsc` and vitest, the ESLint ratchet, the screenshot gate;
- the surfview spec;
- native re-check.

## Decisions requested

1. **Cluster p values:** ship C2 (opt-in RFT with a user-supplied FWHM, clearly labelled), or
   sub-peaks only for now?
2. **Series scope for this phase:** E1–E6 as above (typed axis, region/cluster loci, collapse
   transforms, one series mode, FIR fixtures), with the FIR estimation plugin deferred?
3. **Default label outline:** per-region LUT colour with a dark halo whenever a label layer
   sits above a statistic. Fill stays the default when it is alone.

## E7. Coefficients → series: the interface Brainflow offers (user, 2026-10-27; plan only)

**Ownership (user decision).** Bases and model fitting belong to the separate fMRI analysis module
(FIR/TENT, B-splines, SPM canonical HRF with derivatives, Fourier, informed bases). Brainflow owns
ingestion and visualization. Brainflow therefore **does not define or evaluate bases**. It offers
one clean, estimator-neutral interface through which the analysis module (or SPM, FSL, AFNI,
nilearn output) can hand over coefficients plus the means to project them, and Brainflow handles
everything downstream. Nothing here is built in phase 4; the phase 4 series code must just not
preclude it.

**Why a projection stage, not pre-projected files.** y(t) = Σ_k B_k(t) β_k is linear. It
commutes with the spatial mean and the within-participant mean, so Brainflow can project **per
participant line, after spatial reduction**: cheap, exact, and with no projected volumes on disk.
Population bands are then computed on the projected per-participant values, which are the correct
between-subject bands. A population mean is never projected.

**The interface (three tiers, simplest first).**
1. **Declared, sampled basis (the default contract).** The producer writes the basis already
   evaluated on an output grid. This covers every linear basis without Brainflow knowing any of
   them.
   - Where it goes: a NeuroTabs `axis_domains.basis` entry with `basis_matrix: <tsv>`. The TSV's
     rows are grid positions and its columns are coefficients; the grid gives `start`, `step`,
     `count` and unit.
   - Descriptive fields that Brainflow only displays: `basis_id` (e.g. `spm-hrf+td`,
     `bspline(3, 8)`) and a `description` for captions and methods text.
   - Coefficient layout: either a feature axis `basis` (4D coefficient members) or an observation
     column with `semantic_role: basis` (one 3D map per coefficient).
   - Brainflow's only computation is the matrix product with the sampled coefficients.
2. **Projection provider (on the fly, any grid).** When the grid should be chosen at view time,
   or the projection is not a fixed matrix, the producer names a provider instead of a matrix.
   - The provider is an analysis plugin (`docs/analysis_plugins.md`, sidecar protocol) that
     declares a `project_series` capability.
   - Brainflow sends `{basis_id, params, coefficients[participant × K], grid}` and receives
     `{values[participant × len(grid)], describe}`.
   - Brainflow caches results by (basis, params, grid, coefficient digest).
   - The analysis module stays the single source of truth for basis definitions (DRY), and
     Brainflow never links its code.
3. **Pre-projected series (already supported).** Lag/time members or 4D series (E1, `05857c47`)
   remain valid for producers that prefer to write projected maps.

**What Brainflow implements later, and where.**
- bridge_types: a `SeriesAxisSource` variant `basis_projection {coefficients: feature | column,
  basis: {id, description, matrix_ref | provider_ref, params}, grid}`.
- field_table: the manifest validation itself. The coefficient count equals the matrix columns,
  the grid is finite with a declared unit, and the matrix file is checksum-pinned for frozen
  queries.
- The series binding gets a **projection stage** as the first per-participant stage, before the
  declared transforms (baseline, difference, window). It records the basis id, description, grid
  and provider/matrix digest in provenance, and the caption names the basis
  ("projected from spm-hrf+td, 3 coefficients").
- The participants view can toggle between coefficients and the projected course; export carries
  both.
- Later, the same contract can drive a virtual projected 4D layer (B·β voxelwise on demand), so a
  projected map at time t renders like a 4D frame. If a producer ships within-subject coefficient
  covariance, it can be carried too; until then the caption says bands are between-subject only.

**Phase 4 constraints that keep this open (check in review).**
- Series binding resolves the axis through one function (`resolveSetSeriesBinding`).
- The per-participant stage list in `populationPlot` is ordered and typed.
- Provenance lives in `frame.meta`.

A projection stage slots in front of the transforms without changing the population stage. Do
not add basis evaluation code to Brainflow; coordinate the `project_series` request/response
schema with the analysis module before building.
