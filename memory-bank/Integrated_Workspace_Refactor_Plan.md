# Integrated Workspace Refactor Plan

Date: 2026-05-01
Status: Planning
Primary mockup target: `resdesign/mockup7.png`

## Goal

Add a selectable integrated display mode that combines orthogonal volume slices, an optional surface view, and a resizable bottom workbench dock without replacing the current volume-only and surface-only workflows.

The integrated layout is a display/workspace option, not the universal default. Plain volume workflows should continue to open cleanly in the orthogonal workspace, and surface-only workflows should continue to work in the surface workspace.

## Product Contract

Brainflow should expose these display modes:

- `Orthogonal`: volume-focused orthogonal slice display.
- `Surface`: surface-focused display.
- `Integrated`: orthogonal slices plus surface context and bottom dock.
- `Mosaic`: tiled slice display.
- `Compare`: comparison-oriented display.

`Integrated` should contain:

- Left rail: data browser, remote/BIDS context, layers, active-layer summary.
- Top center: orthogonal slice row.
- Time row: pinned 4D navigation when the active layer is 4D; hidden or compact-disabled for 3D.
- Middle center: surface view, with a clear empty/select-surface state when no compatible surface is loaded.
- Bottom row: resizable Option A dock with `Plot`, `Activity`, and `Log` panels visible at the same time.
- Right rail: selected-layer-driven `Inspector` plus `Annotate` mode. No top-level `Surface | Volume | Atlas` tabs.

## Bottom Dock Contract

Use Option A: independently visible, resizable panels.

Default allocation:

- `Plot`: 50%
- `Activity`: 30%
- `Log`: 20%

Required behavior:

- Plot can expand to occupy the full bottom dock.
- Activity can remain compact when idle.
- Log can collapse to a narrow affordance or drawer.
- The dock should use splitters, not hard-coded thirds.
- Do not duplicate `Activity | Plot | Log` tabs inside an already split bottom row.

## Plot Panel Contract

Refactor `PlotPanel` from a histogram-specific component into a generic plot host.

Initial plot modes:

- `Crosshair Time-Series`: active 4D layer sampled at current crosshair voxel.
- `Histogram`: selected-layer value distribution.

Future plot modes:

- ROI mean time series.
- Event-aligned response.
- Spectrum / frequency-domain plot.
- Design matrix or nuisance regressor plot.

Current implementation notes:

- `ui2/src/components/panels/PlotPanel.tsx` is currently histogram-specific.
- `core/api_bridge/src/lib.rs` already exposes `sample_voxel_timeseries`.
- `ui2/src/services/hoverProviders/sparklineProvider.ts` already proves the frontend can request voxel time-series data.
- `HistogramService` and `HistogramChart` should be retained, but moved behind a plot-mode boundary.

Target shape:

- `PlotPanel`: host shell, plot selector, sizing, empty states, plot toolbar.
- `HistogramPlot`: histogram-specific data loading and rendering.
- `CrosshairTimeSeriesPlot`: time-series-specific data loading and rendering.
- Shared plot primitives: axes, grid, cursor marker, loading/error states where practical.

## Inspector Contract

The right rail should answer: "What am I editing?"

Rules:

- Inspector content follows the selected layer.
- `Annotate` is a task mode, not a data-type tab.
- Volume, surface, atlas, and derived-data controls appear contextually.
- Full charts do not live in the inspector.
- `STATS (summary)` is scalar-only: min, max, mean, std, P2, P98.
- Inspector stats may include `Open in Plot` affordances.

Avoid:

- Duplicate histogram controls.
- Duplicate time scrubbers.
- Duplicate intensity/range controls split across left summary, inspector, and plot.
- Ambiguous `Surface | Volume | Atlas | Annotate` top-level tabs.

## Surface Association Contract

Integrated mode must not assume every volume has a surface.

Behavior:

- If a compatible/selected surface exists, show it in the surface region.
- If no surface exists, show a useful empty state with actions to load/select a surface.
- If a surface is loaded but not linked to the active volume space, show the surface but avoid implying exact correspondence.
- Volume-on-surface projection should remain explicit until registration/template compatibility is known.

## Theme Contract

The mockup theme is the target visual direction: dark clinical workbench, restrained cyan/blue active controls, crisp borders, semantic green/orange status signals, and image-first contrast.

Do not create a parallel visual system. Extend the existing token stack:

- `ui2/src/styles/theme.css`
- `ui2/src/index.css`
- `ui2/tailwind.config.js`

Existing tokens already cover:

- Base surfaces: `--background`, `--card`, `--secondary`, `--muted`
- App surfaces: `--app-bg-*`
- Borders: `--app-border-*`
- Text: `--app-text-*`
- Accent/status: `--app-accent`, `--app-success`, `--app-warning`, `--app-error`
- Role typography: `--app-role-*`
- Sizing/radius/focus: `--app-control-*`, `--app-radius-*`, `--app-focus-*`

Add or formalize tokens for mockup 7-specific UI before broad component work:

- `--app-surface-canvas`
- `--app-surface-panel-raised`
- `--app-border-active`
- `--app-axis-axial`
- `--app-axis-sagittal`
- `--app-axis-coronal`
- `--app-plot-line`
- `--app-plot-grid`
- `--app-plot-cursor`
- `--app-plot-zero`
- `--app-layer-colormap-strip-height`
- `--app-dock-min-height`
- `--app-dock-default-height`

Theme constraints:

- Keep panels flat/crisp; avoid glow-heavy styling.
- Use color plus structure for selected state.
- Ensure secondary text remains readable on real displays.
- Preserve current role typography; do not scale fonts with viewport width.
- Keep radius restrained and consistent.

## Implementation Phases

### Phase 1: Planning and Feature Flag

- Add an `integrated-workspace-v1` feature flag.
- Add display-mode metadata for `Orthogonal`, `Surface`, `Integrated`, `Mosaic`, `Compare`.
- Do not change default workspace behavior.

### Phase 2: Theme Tokens

- Add missing semantic tokens in `theme.css`.
- Add Tailwind mappings only where repeated use is expected.
- Update shared panel/dock primitives to consume tokens.
- Avoid visual churn in unrelated panels.

### Phase 3: Bottom Workbench Dock

- Build a reusable `BottomWorkbenchDock`.
- Use resizable panes.
- Implement Plot/Activity/Log panel slots with default sizing.
- Add plot maximize and log collapse behavior.

### Phase 4: Generic Plot Host

- Split `PlotPanel` into host plus plot implementations.
- Preserve histogram behavior as `HistogramPlot`.
- Add `CrosshairTimeSeriesPlot` using `sample_voxel_timeseries`.
- Add loading, error, unsupported-layer, and no-crosshair empty states.

### Phase 5: Integrated Workspace Composition

- Create `IntegratedVolumeSurfaceWorkspace`.
- Compose existing orthogonal and surface primitives.
- Add pinned time row.
- Add bottom dock.
- Add missing-surface empty state.
- Keep rendering services untouched unless composition exposes a real integration issue.

### Phase 6: Inspector Simplification

- Introduce selected-layer-driven `Inspector | Annotate` shell.
- Move data-type controls into contextual sections.
- Keep chart-heavy stats out of inspector.
- Add scalar `STATS (summary)` section.

### Phase 7: Workspace Selector

- Add display-mode selector UI.
- Wire mode selection to workspace creation/activation.
- Preserve existing workspace presets and layout persistence behavior.

### Phase 8: Stabilization

- Run focused UI and service tests.
- Verify existing orthogonal and surface workflows are unchanged.
- Verify integrated workspace empty-surface behavior.
- Verify plot modes for 3D and 4D layers.
- Verify resize/collapse/maximize behavior.

## Test Plan

Unit/component tests:

- Display-mode selector creates or activates the correct workspace.
- Bottom dock default sizing and collapse/maximize state.
- Plot host selects plot modes and renders unsupported states.
- `CrosshairTimeSeriesPlot` only requests data for 4D layers with a valid voxel.
- `HistogramPlot` preserves existing histogram behavior.
- Inspector routes selected volume/surface/atlas layers to contextual controls.

Service/backend tests:

- Existing `sample_voxel_timeseries` tests remain passing.
- Transport command routing remains namespaced correctly.
- Histogram service caching remains valid after plot refactor.

Regression checks:

- Orthogonal volume workspace still loads and renders volumes.
- Surface workspace still loads and renders surfaces.
- Mosaic and comparison workspaces still open.
- Existing remote/BIDS/file browser flows still load files.

Manual QA:

- Load 3D volume only: integrated surface region shows empty/select-surface state.
- Load 4D volume: pinned time row and crosshair time-series plot work.
- Load surface only: surface workspace remains appropriate.
- Load volume plus surface: integrated mode shows both without forcing projection assumptions.
- Resize bottom dock so Plot gets most real estate.

## Risks

- GoldenLayout state and workspace persistence may conflict with a composite integrated workspace.
- Plot and inspector controls can drift into duplicate ownership if boundaries are not enforced.
- Crosshair time-series can become expensive if sampled too aggressively.
- Surface-volume linkage can overpromise registration accuracy.
- Theming can fragment if mockup-specific colors are hardcoded instead of tokenized.

## Guardrails

- Keep `OrthogonalViewContainer` and `SurfaceViewPanel` independent.
- Compose first; refactor rendering services only when necessary.
- Keep plot ownership in the bottom dock.
- Keep scalar summaries in the inspector.
- Keep integrated mode opt-in until stable.
- Preserve existing UI stability rules: stable Zustand selectors, guarded effects, and no render-phase store writes.
