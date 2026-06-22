# Plot grammar: sample → tidy frame → encoding

Status: **step 1 landed** (2026-06-22). Steps 2–4 outlined below.

## The unifying primitive

Stop thinking "histogram vs time-series" and think in three layers. Every plot the
app needs — histogram, voxel time-series, by-factor boxplot, covariate scatter, ROI
bar — is the **same** extraction producing a tidy frame whose columns differ only in
their _roles_, rendered by a mark whose default encoding is inferred from those roles.

```
sample (a spatial locus over a dataset)
   → SampleFrame  (a tidy / long-form table whose columns carry roles)
   → PlotSpec     (a mark + an encoding that binds columns to channels)
```

### 1. Dataset descriptor — a stack of maps + axis semantics

A dataset is `n` maps along an extra axis, plus axis semantics (`scalar` / `temporal`
/ `categorical` / `index`) and an optional table aligned to the maps:

- 3D scalar = `n:1`. fMRI = `temporal` + `tr`. Subject set = `categorical/index` + a table.

This already exists in the codebase as **NeuroTabs** (`core/field_table/` →
`NeuroTabsManifest`: `observation_table` + `observation_axes` +
`observation_columns` with `semantic_role`/`levels`), surfaced to the UI as
`SpatialFieldSetSummary` / `StudioDesignTablePreview` (generated bindings) and
`useSetStudioStore`. **Step 3 joins against this rather than inventing a new table.**

### 2. SampleProvider → a tidy frame

Sampling at a spatial locus returns rows, one per axis index, with any table joined:

- Whole-volume of a 3D map → one quantitative column (intensity) → the histogram is a
  view of this.
- Point/sphere of a temporal stack → `(t: temporal, value: quantitative)`.
- Point/sphere of a subject stack ⋈ table → `(value: quantitative, group: nominal, age: quantitative, …)`.

### 3. Plot = mark + encoding over the frame

A `PlotSpec` binds columns to channels. Defaults are inferred from column roles
(the "data-dependent" behaviour); the user can rebind any channel or switch marks
(the parameterization):

| Frame (from context)                          | Inferred default                | User can rebind to         |
| --------------------------------------------- | ------------------------------- | -------------------------- |
| one quantitative (whole-volume)               | `hist(x=intensity)`             | density, logY              |
| temporal × quantitative                       | `line(x=t, y=value)`            | bands, normalize %Δ/z      |
| quantitative ⋈ nominal (subjects/groups)      | `box(x=group, y=value)`         | violin, strip, color=group |
| quantitative × quantitative (covariate)       | `point(x=age, y=value)` + lm    | facet=session, color=group |
| region(nominal) × stat(quantitative) (atlas)  | `bar(x=region, y=mean)`         | sort, errorbars            |

## How it maps onto the existing PlotHost

The current `PlotHost` + opaque `PlotMode` boundary stays. Under it:

- `PlotModeContext` → a dataset+locus+selection descriptor; `supports(ctx)` checks the
  _frame shape_ a mode can produce, not a hard-coded "is4D".
- A `PlotMode` becomes a chart preset: a `PlotSpec` template + role-based default-encoding
  inference + `supports`. "Histogram" and "time-series" are two presets; "by-factor box",
  "covariate scatter", "ROI bar" are more, registered the same way.
- A generic encoding/params panel in the host renders channel→column dropdowns, a mark
  switch, the sampling locus, and transforms — persisted in `plotSpecStore`.
- `SampleProvider` resolves locus → frame (point/sphere/ROI/whole; joins the table).

## Build order

1. **SampleFrame + SampleProvider (point/sphere) + spherical locus.** Reframe a mode
   onto frames; no visible regression. ✅ **done — see below.**
2. **Generic encoding/params panel + `plotSpecStore`** (persisted). A real spec UI;
   migrate the histogram renderer onto the spec. ✅ **done — see below.**
3. **Table join + `roi` locus.** The join primitive + atlas-region sampling.
   ✅ **done (with one scoped gap) — see below.**
4. **Role-based default-encoding inference + new presets** (by-factor box, covariate scatter,
   transforms) **+ the set-sampling fan-out** that makes them live. ✅ **done — see below.**

## Step 1 — what landed

**Backend** (`core/api_bridge/`): new `sample_stack(layer_id, world_mm, radius_mm, reduce)
-> Vec<f32>` command, generalizing `sample_voxel_timeseries`. `radius_mm == 0`
reproduces single nearest-voxel sampling exactly; `radius_mm > 0` gathers voxels within
the physical sphere (using volume spacing) and reduces (`mean`/`median`/`min`/`max`/`sum`)
per stack-index — per timepoint for 4D, length-1 for 3D. A bounding-box guard
(`MAX_SPHERE_CANDIDATE_VOXELS = 250_000`, ~60 mm at 1 mm spacing) rejects pathological
radii with an `Input` error before allocating, so the public command can't be made to
OOM. Wired into `COMMANDS`, `generate_handler!`, and `default.toml`
(`allow-sample-stack`); 4 Rust unit tests.

**Grammar** (`ui2/src/plotting/`): pure types + frame helpers — `SampleFrame`,
`ColumnRole`, `FrameColumn`, `Locus` (`point | sphere | roi | wholeVolume`), `ReduceOp`,
`SampleRequest`, and stubbed `PlotSpec`/`Encoding`/`Transform` for steps 2/4. Import from
`@/plotting`.

**Service** (`ui2/src/services/SampleProvider.ts`): singleton resolving a request to a
frame — `point`/`sphere` → series (4D, `(t, value)`; seconds when TR known) or scalar (3D)
via `sample_stack`; `wholeVolume` → binned histogram frame via the existing histogram
path. `roi` reserved for step 3.

**Store** (`ui2/src/stores/plotSpecStore.ts`): minimal persisted, cross-root singleton
holding the sphere radius (mm) per mode. The seed for step 2's full `PlotSpec`
persistence.

**Reframe**: the crosshair time-series mode now samples through `SampleProvider`, gaining a
sphere-radius control in the PlotHost toolbar slot (`Voxel / 2–10 mm sphere`). Radius
defaults to 0 → byte-for-byte the prior behaviour, so the change is additive.

### Deliberately deferred (not done in step 1)

- **Histogram UI migration.** `SampleProvider` already produces the whole-volume frame
  (tested), but the visx `HistogramChart` keeps consuming `HistogramData` directly. It
  migrates onto the spec in step 2 when the generic encoder drives visx — avoids
  destabilizing a working, well-tested component for no user-visible gain.
- **The `roi` locus / design-table join** (steps 3).
- **The generic encoding panel / mark switch** (step 2).

### Post-review hardening (fresh-context review pass)

- **Stale-data resurrection fixed**: the time-series effect now bumps the inflight token
  when the target goes invalid and on teardown, so a late-resolving request can't overwrite
  the cleared state (regression test added).
- **Sphere dedupe key**: keys on the rounded voxel for points (radius 0) but on the
  quantized world position for spheres, since sphere membership depends on the fractional
  crosshair — sub-voxel moves now refetch.
- **Frame shape from the backend's return length**, not layer metadata: stale metadata can
  no longer truncate a real timeseries or fabricate one; metadata only labels the temporal
  axis (seconds when TR is known).

### Verification

- `cargo test -p api-bridge --lib sample_stack` → 4 passed (incl. the over-cap guard).
- `vitest` plots + stores suites → green (reframed time-series 18, new frame 8, new
  SampleProvider 5).
- `tsc -b` clean for all new/edited files; `eslint` clean for the changeset.
  (The repo's `tsc -b` has unrelated pre-existing errors from the in-flight rendering
  refactor.)

## Step 2 — what landed

The histogram migration deferred in step 1 is done, and rendering is now fully spec-driven.

**Spec layer** (`ui2/src/plotting/spec.ts`): `inferDefaultSpec(frame)` (role-based, honouring
a producer's `meta.suggested` hint first) and `resolveSpec(frame, override)` — the inferred
default overlaid with the user's partial override, dropping any channel bound to a column the
*current* frame lacks (stale-override safe across dataset switches).

**Encoder** (`ui2/src/components/plots/encoder/`): `PlotEncoder` dispatches on `spec.mark` to
a mark-renderer registry. Cartesian marks (`line`/`area`/`point`/`bar`) are visx; the `hist`
mark wraps the existing interactive `HistogramChart` (intensity/threshold drag, colormap,
log-scale, tooltips preserved — the rich payload rides on `frame.meta.histogram`). Adding a
plot type = a mark renderer + an inference rule, never a bespoke chart wired into a mode.

**Store v2** (`ui2/src/stores/plotSpecStore.ts`): adds `specByMode` (partial spec override) and
`reduceByMode` alongside step-1's `sphereRadiusMmByMode`, with a persist migration (v1→v2).
Mark/channel edits re-render; locus edits (radius/reducer) re-sample.

**Panel** (`PlotEncodingPanel` + `EncodedPlotView`): a generic, plot-type-agnostic params strip
(mark switch + channel→column dropdowns + sphere-radius/reducer for spatial loci), rendered
above the chart by the shared `EncodedPlotView`. Both modes are now thin: the body samples a
frame; `EncodedPlotView` owns the spec, the panel, and the rendering. The step-1 sphere-radius
toolbar was folded into this panel (`crosshairTimeSeriesPlot.toolbar.tsx` retired).

### Deliberately deferred

- **Panel sizing** reserves a fixed 30 px strip (no ResizeObserver); fine for dock plots, can
  be made elastic later. The histogram's panel is intentionally generic even though its
  encoding is near-fixed — uniformity over special-casing.
- **`box`/`violin`/`heatmap` marks and transforms (bin/aggregate/normalize/lm)** are step 4.

### Post-review hardening (fresh-context review pass)

- **Role-aware channel dropdowns + required X/Y**: continuous marks (line/area/point) only
  offer numeric columns for X; Y is always numeric; Color appears only when categorical
  columns exist — so a user can't bind an axis to a column that silently renders nothing.
- **Measured encoder area**: `EncodedPlotView` measures the chart region (ResizeObserver,
  with a live estimate fallback for jsdom / first paint) instead of assuming a fixed 30 px
  panel — a wrapped panel no longer clips the chart.
- **Histogram padding fidelity**: body padding is subtracted on both sides (was 1×), so the
  chart no longer overflows its padded box.
- **`frameToHistogramData`** falls back to a bin-index range (not `[0,0]`) when reconstructing
  a hand-built frame lacking bin edges.

### Verification (step 2)

- `vitest` plots + plotting + stores → 93 passed (new `spec` 9, `plotSpecStore` 6,
  `PlotEncoder` 3, `PlotEncodingPanel` 6, `SampleProvider` 5; migrated histogram 9 +
  time-series 18 still green).
- `tsc -b` and `eslint` clean for the whole step-2 changeset.

## Step 3 — what landed (and the one scoped gap)

Two scoping investigations preceded this step. The verdict shaped the scope:
- **`roi`/region sampling is cleanly achievable, live.** Atlas + scalar volumes share one
  registry; the atlas→world→scalar per-voxel transform reuses the `sample_stack` helpers.
- **The design-table join has NO live per-member value source today** — there is no
  `sample_set` command, no member→volume registry, and the design table the UI holds is a
  truncated *preview*. So the join is delivered as a tested *primitive*, not a live plot.

**Backend** (`core/api_bridge/`): `compute_region_stats(scalar_layer_id, atlas_layer_id,
reduce) -> Vec<RegionStat{label_id, value, voxel_count}>` (serde-only, typed inline on the
frontend — no ts-bindings regen). Iterates the atlas volume's voxels, maps each to world then
to the scalar volume's own voxel grid (no same-grid assumption), buckets by label, reduces
(`reduce_values`), excludes background label 0, returns sorted by label id. Wired (COMMANDS,
`generate_handler!`, `allow-compute-region-stats`); 4 Rust unit tests (same-grid, differing-
grid, default-reduce, unmapped-layer error).

**Provider** (`SampleProvider.ts`): `regions` locus → `(region nominal ⋈ value quantitative ⋈
voxelCount)` frame (region names mapped client-side from the atlas layer's `atlasPaletteLegend`,
falling back to `Region {id}`), `meta.suggested = bar(region, value)`; `roi{labelId}` → that
region's stat as a scalar frame.

**Mode**: a new **Region Stats** plot mode (`regionStatsPlot`), registered in
`DEFAULT_PLOT_MODES`. Supported when the active layer is a scalar map AND an atlas (label)
layer is loaded; samples the `regions` locus and renders the region × stat **bar** via the
existing encoder (no new mark needed). A reducer control (mean/median/min/max/sum) is exposed
through the panel (`showReduce`).

**Join primitive** (`@/plotting/join.ts`): `joinDesignTable(base, keyColumn, table, opts)` —
pure, source-agnostic (takes the Set-Studio preview shape `{columns, rows:{id,cells}[]}`),
joins covariates by member id, infers per-column roles (numeric → quantitative, else nominal),
keeps/drops unmatched rows. Fully unit-tested. This is what step 4's by-factor box / covariate
scatter will consume.

### Deliberately deferred (the scoped gap) — live subject-stack sampling

`joinDesignTable` has no live values to join yet. Wiring box/scatter-by-factor to real data
needs a **set-sampling fan-out** that does not exist. Two viable designs (see investigation):
1. **Backend `sample_set_at_world(sourcePaths[], worldMm, radius, reduce)`** — CPU-loads each
   member NIfTI (the `field_table` crate already loads NIfTIs) and point/sphere-samples,
   returning per-member values. Cleanest (no GPU registry pollution); works for sets with real
   file paths.
2. **UI fan-out** reusing `StudioDisplayService.ensureLayerLoaded` + `sample_stack` per member
   — works today for demo/table sets but loads every member into the GPU registry.
Also: the full design table (not the truncated preview) likely needs a backend accessor. This
is the natural first task of a step 3b / step 4.

### Post-review hardening (fresh-context review pass)

- **`joinDesignTable` column collision**: a design column whose name collides with a base
  column is now dropped (base wins) instead of clobbering the base cell + emitting a duplicate
  schema entry. (regression test added)
- **Region stats NaN-consistency**: `compute_region_stats` skips non-finite scalar voxels at
  accumulation (NaN-masked background is common in stat maps), so `mean`/`sum` are no longer
  poisoned to NaN while `min`/`max` silently ignore them; such voxels are excluded from
  `voxelCount` too. (Rust test added) Plus a load-bearing-invariant comment on the 4D
  timepoint clamp.

### Verification (step 3)

- `cargo test -p api-bridge --lib compute_region_stats` → 5 passed.
- `vitest` plots + plotting + stores → 107 passed (new `join` 6, region loci 3, `regionStats`
  mode 5; all prior suites still green).
- `tsc -b` clean for all step-3 files; `eslint` clean for the step-3 changeset (the pre-existing
  `transport.ts` lint debt — `any` types, a `const`-in-case — is unrelated and untouched).

## Step 4 + the set-sampling fan-out — what landed

Step 4's presets plus the previously-deferred fan-out, so by-factor box / covariate scatter
are now **live** (not just primitives).

**Transforms + stats** (`@/plotting/transforms.ts`, pure + tested): `boxStats` (quartiles,
1.5·IQR whiskers, outliers), `linearFit` (OLS slope/intercept/R²), and `applyTransforms`
(currently `normalize`: z-score / percent-change of a quantitative column in place; `bin` is
server-side, `lmFit` is a render overlay, `aggregate` reserved). The encoder applies
`applyTransforms` before dispatching to a mark.

**Inference** (`inferDefaultSpec`): nominal × quantitative now resolves to `box` when a level
repeats (a distribution) and `bar` when one value per level (region means) — a cardinality
heuristic on top of the role rules.

**New marks** (`cartesianMarks.tsx`, registered): `box` (per-group box-and-whisker, hand-rolled
on visx primitives) and an `lmFit` overlay on the `point` (scatter) mark drawn when the spec
carries an `lmFit` transform. `SUPPORTED_MARKS` now offers line/area/point/bar/box/hist.

**Panel**: a **Normalize** control (None / z-score / %Δ) for continuous marks — **live on the
time-series today** (no fan-out needed). The store gained `PlotSpecOverride.transforms` +
`setNormalize`.

**The fan-out (Design A, the resolved gap).** Investigation chose a CPU-side backend over a UI
fan-out (no GPU/atlas pollution for N-member cohorts):
- **Backend `sample_set_at_world(members:[{memberId, sourcePath}], world_mm, radius_mm, reduce)
  -> [{memberId, value}]`** (7 Rust tests): CPU-loads each member NIfTI (path-keyed
  `set_sample_cache` on `BridgeState` so crosshair moves don't reload), resolves `template:`
  ids via `TemplateService`, samples at the locus reusing the `sample_stack` helpers, and is
  per-member NaN-tolerant (one bad member never fails the call). Serde-only result, typed
  inline.
- **Provider `set` locus** → a `(member, value)` base frame.
- **Cohort plot mode** (`cohortPlot`, registered): reads the active Set-Studio set, samples it
  at the crosshair, joins the design table via `joinDesignTable`, defaults to a **box grouped by
  the first design factor** (else a per-member bar), and renders via `EncodedPlotView` with the
  sphere-radius / reducer panel controls.

### Remaining limitation (honest)

The frontend only has the **truncated design-table preview** (~a few rows), so covariates join
for preview members; others get null factors. Full-cohort by-factor plots need a backend
accessor for the complete observation table — a focused follow-up, independent of this work.

### Post-review hardening (fresh-context review pass)

- **Cohort default factor pick fixed.** The naive "first nominal column" picked the per-subject
  *identifier* (one single-point box per member). Replaced with `pickGroupingColumn` (`@/plotting`):
  the lowest-cardinality design column that actually *groups* members (distinct < rows), role-
  agnostic so numeric-coded factors (`"1"/"2"`) also qualify. When a factor is chosen, members
  with no factor value (outside the truncated preview) are dropped so they don't form a spurious
  `"null"` box group. (unit + body tests added)

### Verification (step 4 + fan-out)

- `cargo test -p api-bridge --lib sample_set_at_world` → 7 passed (+ `sample_member_volume`).
- `vitest` plots + plotting + stores → 130 passed (new `transforms` 9, `pickGroupingColumn`,
  `box`/`lmFit` encoder, inference box/bar, `setNormalize`, Normalize panel, provider `set`
  locus, `cohort` mode).
- `tsc -b` clean for all step-4 + fan-out files; `eslint` clean for the changeset (the
  pre-existing `transport.ts` lint debt is unrelated/untouched).

## Codex council review — fixes (all 6 closed; mote tag `council`)

A Codex adversarial review (3 oppose / 1 mixed) surfaced six issues the green tests + prior reviews missed. All fixed with regression tests:

1. **Point-sampling off-by-one** (`gather_locus_voxels`, `core/api_bridge/src/lib.rs`): the point case bounds-checked the *fractional* center then rounded, so `dim-0.4` rounded to `dim` (out of range) → silent 0. Now rounds-then-checks (matches the frontend gate). Rust test added.
2. **Histogram stale-result race**: `HistogramPlot`'s async fetch now uses a cancel guard so an out-of-order layer promise can't overwrite the current frame. Regression test (spies the provider; resolves the stale layer last).
3. **Cohort backpressure**: `CohortPlot` debounces sampling (200 ms) so dragging the crosshair fires one full-cohort `sample_set_at_world` after it settles. Debounce regression test. (Backend per-path miss coalescing remains a lower-priority follow-up.)
4. **NaN-over-IPC contract**: `serde_json` serializes `f32::NAN` as JSON `null`, so `sampleSet` now types the wire value as `number | null`; `numericColumn` coerces it to NaN downstream. Null-member test.
5. **`supports()` reactivity**: `PlotModeContext` gained reactive `atlasLayerId`/`hasCohort` (populated by `PlotPanel` via `useAtlasLayerId`/`useActiveCohort`, threaded through `PlotHost`); Region/Cohort `supports()` prefer them (store fallback). Tabs now enable as soon as an atlas/cohort loads. Tests assert ctx overrides the store.
6. **BarMark missing x-axis**: passed the band `xScale` to the shared axis frame so region/cohort bars render category labels. Encoder test asserts the labels.

**Verification:** `cargo test -p api-bridge --lib gather_locus_voxels` → passes (sample_stack/set/member suites green); `vitest` plots + plotting + stores → 136 passed; `tsc -b` + `eslint` clean for the changeset.
