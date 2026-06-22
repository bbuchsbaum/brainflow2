# Plot Integration Plan — Context-Dependent Plots in a Shared Bottom Dock

_Status: Phases 1–5 done. Dock enabled on ALL imaging workspaces (Orthogonal
locked+flexible, Mosaic, Comparison). Two regressions fixed: (1) slice
left-anchoring on dock resize (viewStateStore fallback → bbox dim_px); (2)
mosaic cells not reflowing + click-to-crosshair breaking (CenterWithPlotDock
rewritten to give the view pane a definite-height box via absolute insets, not
flex). Live-verified (2026-06-22): orthogonal centered; mosaic cells reflow +
crosshair click works; comparison panel sized correctly — all with the dock
open + histogram rendering. Owner: bbuchsbaum._

## Progress (2026-06-22)

- **Phase 1 — done.** `PlotDock` + `CenterWithPlotDock` created;
  `layoutSettingsStore` gained `plotDockOpen` / `plotDockHeight`;
  `WorkspaceRouter` wraps the four imaging modes. Dock defaults collapsed
  (inert until opted in).
- **Phase 2 — done.** "Open in dock" button wired (`onClick` selects the
  layer + opens the dock). Added a `p` keyboard shortcut to toggle the dock.
  Native View-menu item deferred (needs Rust menu + permission + event wiring).
- **Phase 3 — already built, verified.** `usePlotModeSelection` +
  `getDefaultPlotModeForLayer` already implement the auto (3D→histogram,
  4D→time-series) vs. user-override policy. Region/atlas mode still deferred.
- **Phase 4 — done.** `InlineHistogramPreview` sparkline in the DATA section
  (cheap 48-bin SVG from the cached `histogramService`; renders nothing on
  load/error/empty). DATA section's open logic DRY'd into a shared
  `useOpenLayerInDock` hook used by both the preview and the link.
- **Phase 5 — done (automated + live).** Affected + adjacent suites all green:
  plots+layout 72, inspector+stores 132 (1 skipped), plus the dedicated new
  tests (`PlotDock`/`CenterWithPlotDock`, `DataSection` open-in-dock,
  `InlineHistogramPreview`, `layoutSettingsStore`, keyboard shortcuts). eslint
  clean; new/edited files type-clean (repo has pre-existing unrelated `tsc -b`
  errors). **Live GUI verified** in a built `Brainflow.app` (Orthogonal
  workspace, MNI 3D): bottom PLOT dock renders under the slice views with the
  full histogram (HISTOGRAM | TIME SERIES tabs); inline sparkline shows in the
  DATA section; ✕ collapses the dock (views reclaim height) and "Open in dock →"
  reopens it.
  - Verification note: `cargo tauri dev` runs a bare binary with no `.app`
    identity, and the `com.brainflow.dev` LaunchServices record pointed at a
    dead unmounted-DMG path, so computer-use couldn't attach. Fixed by building
    a debug `.app` (`cargo tauri build --debug --bundles app` with a one-off
    `-c` override of `beforeBuildCommand` → `vite build` to skip the
    pre-existing `tsc` errors) and `lsregister -f`-ing it.

## Goal

Make click-driven, context-dependent plots a first-class, accessible feature of the
standard imaging workspaces (Orthogonal / Mosaic / Compare), not just the
feature-flagged Integrated workspace.

- **Default plot is data-type dependent**: histogram for a 3D volume, voxel
  time-series for a 4D volume, region readout for an atlas/label volume.
- **Screen real estate**: a **shared, collapsible bottom dock** scoped to the
  center workspace region (the slice views sit on top; Files and Inspector
  columns stay full height). RStudio's Console/Plot row, adapted. Default
  collapsed so medical images keep maximum area until the user opts in.
- **Triggers**: an always-on mini-preview in the Inspector `DATA` section, the
  (currently dead) "Open in dock" button, a keyboard shortcut, and a View-menu
  toggle.

## Key finding from investigation

**The entire plot stack already exists and works — it is simply not mounted or
wired in the standard workspaces.** This is a wiring + UX task, not a build.

| Layer | Artifact | State |
| --- | --- | --- |
| Backend | `compute_layer_histogram` (Rust, CPU, 256 bins, 3D + 4D-at-timepoint) | ✅ implemented, registered, in transport |
| Backend | `sample_voxel_timeseries` (full time-series at a voxel) | ✅ implemented |
| Backend | `sample_layer_value_at_world` | ✅ implemented |
| Service | `HistogramService` (cached, dedup'd, invalidates on layer/render change) | ✅ |
| Chart | `HistogramChart` (Visx: colormap bars, intensity window, thresholds, stats) | ✅ |
| Chart | `CrosshairTimeSeriesPlot` | ✅ |
| Host | `PlotHost` (pluggable mode selector) + `histogram` & `crosshairTimeSeries` modes | ✅ |
| Wiring | `PlotPanel` (binds active layer + crosshair into `PlotHost`) | ✅ |
| State | `plotModeStore` (tracks active mode + user-vs-auto selection) | ✅ |
| Dock | `BottomWorkbenchDock` (Plot/Activity/Log, resizable, persisted sizes) | ✅ but mounted ONLY in Integrated workspace |

**Why it's unreachable today (Orthogonal view in the screenshot):**

1. `BottomWorkbenchDock` is mounted only inside `IntegratedVolumeSurfaceWorkspace`
   (`ui2/src/components/views/IntegratedVolumeSurfaceWorkspace.tsx`), gated by the
   `integratedWorkspaceV1` feature flag. Orthogonal/Mosaic/Compare have no plot
   surface at all.
2. Adding `PlotPanel` to GoldenLayout at runtime is explicitly disabled
   (`GoldenLayoutRoot.tsx:587` — "PlotPanel add ignored").
3. The new `ImagingInspector` replaced the old tabbed `VolumeLayerPanel` (which
   had a "Plots" tab), so the old sidebar plot tab is gone from the live layout.
4. The **"Open in dock"** button (`ui2/src/components/inspector/imaging/sections/DataSection.tsx:100`,
   `OpenInDockLink`) is a placeholder: no `onClick`, and nowhere to open into.

**Context-dependence is already feasible**: click → `setCrosshair` (viewStateStore);
layer type is known via `layer.volumeType` (`Volume3D` | `TimeSeries4D`) and atlas
via `atlasMetadata` / `type === 'label'`. `PlotHost.supports()` already gates modes
per context.

## Architecture decision

- **Reuse** `PlotPanel` / `PlotHost` / `plotModeStore` / `HistogramService` as-is.
- **Single insertion point** for the dock surface: wrap the imaging-mode returns in
  `WorkspaceRouter.tsx` in a shared vertical split. This gives all imaging
  workspaces the dock at once and scopes it to the center region (matching the
  approved mockup). Mirror the proven Allotment pattern from
  `IntegratedVolumeSurfaceWorkspace` (`<Allotment vertical>` with a `snap` bottom
  pane sized `preferredSize`/`minSize`).
- The dock lives **outside** GoldenLayout's panel system (it is a nested Allotment
  inside the center workspace tab), so we do not reopen the disabled
  "PlotPanel-as-GL-panel" path.
- Leave `IntegratedVolumeSurfaceWorkspace` as-is (it already has its own dock).

## Regression + fix (2026-06-22, post-merge)

Wrapping the standard imaging workspaces in the dock split initially **broke
orthogonal slice centering**: with the dock open the panes become wide-and-short
and the slice image left-anchored instead of centering. (Briefly reverted/parked
while diagnosing; now fixed and re-enabled.)

**Root cause (confirmed + fixed):** the slice render is sized to
`viewState.views[vt].dim_px`, and `SliceViewerImageSurface`/`drawScaledImage`
letterbox-**centers** that image inside the (measured) canvas. The backend
success path (`ViewRectMm::full_extent`) returns `dim_px` = the **volume
bounding box**, so the rendered image is tight and gets centered. But the
frontend **resize fallback** in `viewStateStore.updateDimensionsAndPreserveScale`
(the `catch` after `recalculate_all_views` throws) set `dim_px = measured` with a
corner origin → the backend renders an oversized image with the volume flush at
one edge → the canvas draws it 1:1 → **left-anchored**. Initial load uses the
success path (centered); the dock-open resize tripped the fallback (left).

**Fix:** in that fallback, size the frame to the volume bbox like `full_extent`
— `dim_px = [ceil(widthMm/pixelSize), ceil(heightMm/pixelSize)]` instead of the
measured `dimensions` (`viewStateStore.ts`). The renderer then letterbox-centers
the tight image. Both the success and fallback paths now center identically.

**Dock enabled on all imaging workspaces:** `WorkspaceRouter` wraps
`orthogonal-locked`, `orthogonal-flexible`, `mosaic`, and `comparison` in
`CenterWithPlotDock`; the "Open in dock" button, the `p` shortcut, and the
inline sparkline's click-to-open are restored.

**Second regression (Mosaic), fixed.** When `CenterWithPlotDock` used a flexbox
column, wrapping Mosaic broke it two ways: the cell grid didn't reflow, and
click→world (crosshair) went stale. Cause: the view pane's height was
flex-computed, not definite, so the views' `height:100%` + `ResizeObserver`
sizing did not resolve/fire cleanly — Mosaic (`.mosaic-container` height:100% →
`gridRef` ResizeObserver → cellSize) failed to reflow, and `MosaicCell`'s
click placement (captured at render) stayed stale. Orthogonal tolerated it;
Mosaic did not.

Fix: `CenterWithPlotDock` now lays out with **absolute insets** instead of
flex — the view pane is `position:absolute; top/left/right:0; bottom = dock
height`, giving it a *definite* pixel height (the same contract a GoldenLayout
panel gives its content). All three views' `height:100%`/ResizeObserver sizing
then resolves and reflows cleanly. No Mosaic/Comparison-internal changes were
needed. Live-verified: Mosaic cells reflow to fit above the dock and a cell
click moves the crosshair (readout changed (0,-18,18) → (71.7,-53.3,18));
Comparison panel is sized correctly; Orthogonal stays centered.

**Regression tests:**
- `viewStateStore.test` "sizes the fallback frame to the volume bbox (centered),
  not the measured canvas" — forces the fallback (recalc throws) and asserts
  `dim_px === [350, 480]` (volume aspect) and `!== [640, 480]` (the buggy
  measured/canvas aspect). This is the direct guard for the centering bug.
- `WorkspaceRouter.test` asserts the imaging routes ARE wrapped in
  `center-with-plot-dock` and the non-imaging ones are not.
- `DataSection.test` asserts "Open in dock" opens the dock + selects the layer.
- `InlineHistogramPreview.test` covers both the button (with `onOpen`) and the
  readout (no `onOpen`) paths.

**Verified live** (rebuilt `Brainflow.app`, MNI loaded, Orthogonal): dock open →
axial centered with equal margins (was left-anchored); sagittal/coronal centered;
histogram renders in the dock; full broad sweep 357 tests pass / 1 skipped.

## Phases

### Phase 1 — App-wide plot dock surface (the screen real estate)

- New `ui2/src/components/layout/PlotDock.tsx`: a collapsible + resizable bottom
  pane hosting `<PlotPanel />`. Header: drag handle, "PLOT" label, mode tabs
  (already provided by `PlotHost`), collapse chevron, maximize. Snap-collapsible.
- Extend `layoutSettingsStore` with `plotDockOpen: boolean` (default `false`) and
  `plotDockHeight` (reuse/rename existing `bottomDockSizes` where sensible);
  persist to localStorage like the existing dock fields.
- New shared wrapper `CenterWithPlotDock` (small component): `<Allotment vertical>`
  with the workspace view on top and `<PlotDock />` as a `snap` bottom pane.
- In `WorkspaceRouter.tsx`, wrap the imaging-mode returns
  (`orthogonal-locked`, `orthogonal-flexible`, `mosaic`, `comparison`) with
  `CenterWithPlotDock`. Leave `integrated`, `set-studio`, `bids-explorer`,
  `analysis-workbench` unchanged.
- Respect AGENTS.md caveats: use Allotment with explicit sizes (no nested
  `flex-1` for the dock); defer any open-on-mount store writes via rAF to satisfy
  StrictMode render-phase rules.

### Phase 2 — Wire the triggers (make it accessible)

- `DataSection.tsx` `OpenInDockLink`: add `onClick` →
  `plotModeStore.setActivePlotMode(defaultModeFor(layer))` +
  `layoutSettingsStore.setPlotDockOpen(true)`. Thread the selected layer/kind in.
- Add a View-menu item + keyboard shortcut (e.g. `Cmd/Ctrl+\``) and a status-bar
  affordance to toggle the dock — so it is discoverable without the Inspector.
- Clicking in an image view while the dock is open already keeps it in sync via
  crosshair + selected-layer state; no extra wiring needed.

### Phase 3 — Context-dependent default plot

- Add a single helper `defaultPlotModeForLayer(layer)`:
  `Volume3D → 'histogram'`, `TimeSeries4D → 'crosshairTimeSeries'`,
  `label/atlas → 'region'` (region mode is Phase 3 stretch; fall back to
  histogram until built).
- In `usePlotModeSelection` / `PlotPanel`: when the selected layer changes and the
  user has NOT manually overridden the mode (`plotModeStore` already distinguishes
  auto vs user-selected), switch to the layer's default mode.
- Tighten `supports()` gates: `crosshairTimeSeries` only for 4D; `histogram` for
  any scalar; `region` only for label/atlas.
- _(Stretch)_ New `region` plot mode: atlas region readout / per-region summary
  when a label layer is active and the crosshair sits on a region (reuses
  `resolveAtlasRegionAtWorld`).

### Phase 4 — Inline mini-preview in the Inspector DATA section

- A small sparkline thumbnail (histogram for 3D, time-series for 4D) rendered from
  cached `HistogramService` / time-series data — cheap minimal SVG, no new fetch.
- Clicking it opens the dock (same action as "Open in dock").
- Honors Design.md §1.5: Inspector stays summary-only; the full chart lives in the
  dock.

### Phase 5 — Tests + verification

- Unit: `PlotDock` open/collapse/persist; Open-in-dock handler sets mode + opens
  dock; `defaultPlotModeForLayer` dispatch by type; `WorkspaceRouter` wraps imaging
  modes only (not studio/bids/analysis).
- Keep green: `BottomWorkbenchDock.test`, `LayerInspectorStats` handshake,
  `IntegratedVolumeSurfaceWorkspace.test`.
- Manual (`cargo tauri dev`): MNI 3D → histogram; a 4D series → time-series;
  an atlas → region/fallback. Verify collapse state + height persist across reload
  and across Orthogonal/Mosaic/Compare.
- `pnpm --filter ui2 test`, `pnpm lint`, `pnpm format`.

## Risks / caveats

- **Nested Allotment inside a GoldenLayout center tab** — use explicit sizes;
  validate resize + persistence interplay with GoldenLayout tab switching.
- **Render-phase store writes forbidden** — defer dock-open via rAF (StrictMode).
- **Do not** reintroduce the disabled `PlotPanel`-as-GL-panel runtime path.
- **Image area** — dock steals vertical height; default collapsed keeps slice
  images large until the user opts in ("activatable").
- **Mosaic/Compare** vertical room is already tight — confirm the dock's `minSize`
  + snap behavior leaves the grids usable.

## Out of scope (for now)

- Surface-based plots (curvature/overlay distributions).
- Multi-layer overlaid histograms / ROI time-series panels.
- Detaching the plot into its own OS window.
