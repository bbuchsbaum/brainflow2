# Brainflow Design System

This document translates the latest Brainflow mockup direction into implementation-ready layout rules, visual tokens, typography, and component contracts.

The target direction is **mockup 7 / Integrated workspace**: a dense, researcher-facing neuroimaging workbench with remote/BIDS data workflow on the left, orthogonal slices plus 3D surface in the center, selected-layer-driven inspector on the right, and a first-class bottom analysis dock with Activity, Plot, and Log.

---

## 1. Product Design Principles

### 1.1 Medical accuracy first

Brain anatomy and quantitative readouts must visually dominate the interface. Chrome should feel precise and quiet.

- MRI/fMRI views get the highest contrast and largest available area.
- Coordinates, voxel indices, intensities, frame number, TR, and scalar names are always auditable.
- Canvas rendering should never be visually distorted by layout chrome, CSS scaling mistakes, or accidental aspect-ratio changes.

### 1.2 Layers are the source of visual truth

The layer list should tell users what is visible and how it is rendered without forcing them into the inspector.

Each layer row should show:

- Visibility state
- Thumbnail / modality icon
- Name
- Type: Volume, Surface, Atlas, Overlay
- 4D badge when applicable
- Colormap strip when applicable
- Threshold cue when active
- Opacity mini control
- Overflow menu

### 1.3 Inspector follows selection

The right panel always answers: **“What am I editing?”**

The top-level modes should be:

```text
INSPECTOR | ANNOTATE
```

Do not use top-level inspector tabs such as `Surface | Volume | Atlas | Annotate`. Those mix layer types with tool modes and create ambiguity.

Inside `INSPECTOR`, controls are contextual based on selected layer type:

- Selected volume layer → Volume display, intensity, threshold, slices, summary stats
- Selected surface layer → Surface mesh, hemisphere, curvature, overlay, lighting, threshold
- Selected atlas layer → Atlas labels, borders, lookup table, opacity, selection behavior
- Selected annotation layer/object → Annotation properties

### 1.4 One editable home per control

Avoid duplicated controls. A setting should be editable in only one place.

| Control | Canonical location |
|---|---|
| Opacity | Right Inspector; mini opacity in layer row is allowed if it writes the same state immediately |
| Intensity range | Right Inspector |
| Threshold | Right Inspector; layer row may show `thr` badge only |
| Time/frame scrubber | Pinned center time row |
| Histogram chart | Bottom Plot dock |
| Stats summary | Inspector, collapsed / compact only |
| Mosaic layout | Center display toolbar or Inspector Slices section, not both |

### 1.5 Plot is first-class, not inspector-only

The bottom dock owns analytical plots.

Supported initial plot modes:

- Crosshair voxel fMRI time-series
- Selected-layer histogram
- ROI time-series
- Event-aligned response
- QC traces

Inspector `STATS` should remain summary-only. Full charts live in `Plot`.

### 1.6 Integrated view is a display mode

The integrated orthogonal + surface layout is a workspace option, not the universal default.

Display mode selector:

```text
Orthogonal | Surface | Integrated | Mosaic | Compare
```

`Integrated` is selected in the current mockup.

---

## 2. App Shell Layout

### 2.1 Overall frame

Target desktop baseline: **1600 × 1000 px** and larger.

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ Top App Bar                                                                │ 40
├───────────────┬────────────────────────────────────────────┬───────────────┤
│ Left Data Rail│ Center Workspace                           │ Right Inspector│
│ 320 px        │ fluid                                      │ 360-380 px     │
│               │                                            │               │
│               │ Orthogonal Slice Row                       │               │
│               │ Time Row                                   │               │
│               │ 3D Surface / Main View                     │               │
│               │ Bottom Dock: Activity | Plot | Log         │               │
├───────────────┴────────────────────────────────────────────┴───────────────┤
│ Status Bar                                                                 │ 44
└────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Recommended dimensions

```ts
export const layout = {
  topBarHeight: 40,
  statusBarHeight: 44,
  leftRailWidth: 320,
  leftRailMinWidth: 280,
  leftRailMaxWidth: 420,
  inspectorWidth: 376,
  inspectorMinWidth: 340,
  inspectorMaxWidth: 460,
  bottomDockHeight: 220,
  bottomDockMinHeight: 160,
  bottomDockMaxHeight: 340,
  timeRowHeight: 48,
  sliceRowMinHeight: 260,
  surfaceMinHeight: 280,
  panelGap: 6,
  panelRadius: 6,
};
```

### 2.3 Center workspace in Integrated mode

```text
Center Workspace
├─ View Header: title, crosshair state, display mode controls
├─ Ortho Row: Axial | Sagittal | Coronal
├─ Time Row: canonical 4D frame scrubber
├─ Surface View: 3D brain, tool rail, legend
└─ Bottom Dock: Activity | Plot | Log
```

For `Integrated` mode, default relative vertical split:

```text
Slice Row      33%
Time Row       fixed 48 px
Surface View   42%
Bottom Dock    25%, fixed starting height around 220 px
```

---

## 3. Color Tokens

The UI uses dark blue-black chrome, muted borders, blue interaction accents, and anatomy-specific orientation colors.

### 3.1 CSS variables

```css
:root {
  color-scheme: dark;

  /* App backgrounds */
  --bf-bg-app: #05080c;
  --bf-bg-shell: #07101a;
  --bf-bg-panel: #0b1521;
  --bf-bg-panel-raised: #101c2a;
  --bf-bg-panel-sunken: #050b12;
  --bf-bg-canvas: #020508;
  --bf-bg-input: #08111c;
  --bf-bg-hover: #122235;
  --bf-bg-active: #16345d;
  --bf-bg-selected: #123a72;

  /* Borders and dividers */
  --bf-border-subtle: rgba(148, 163, 184, 0.14);
  --bf-border: rgba(148, 163, 184, 0.24);
  --bf-border-strong: rgba(148, 163, 184, 0.38);
  --bf-border-focus: #3b82f6;
  --bf-divider: rgba(148, 163, 184, 0.16);

  /* Text */
  --bf-text-primary: #e6edf7;
  --bf-text-secondary: #b7c4d4;
  --bf-text-muted: #7f8fa3;
  --bf-text-faint: #566579;
  --bf-text-inverse: #020617;

  /* Brand and interaction */
  --bf-brand: #7c3aed;
  --bf-accent: #2f80ff;
  --bf-accent-hover: #4c93ff;
  --bf-accent-active: #1f6feb;
  --bf-accent-soft: rgba(47, 128, 255, 0.16);

  /* Semantic */
  --bf-success: #35d36b;
  --bf-success-soft: rgba(53, 211, 107, 0.14);
  --bf-warning: #f59e0b;
  --bf-warning-soft: rgba(245, 158, 11, 0.14);
  --bf-danger: #ef4444;
  --bf-danger-soft: rgba(239, 68, 68, 0.14);
  --bf-info: #38bdf8;

  /* Anatomical orientation colors */
  --bf-axial: #2f80ff;
  --bf-sagittal: #40c463;
  --bf-coronal: #ff9900;
  --bf-crosshair: #58d957;

  /* Plot colors */
  --bf-plot-line: #38a3ff;
  --bf-plot-grid: rgba(148, 163, 184, 0.18);
  --bf-plot-axis: rgba(226, 232, 240, 0.55);

  /* Shadows */
  --bf-shadow-panel: 0 10px 32px rgba(0, 0, 0, 0.32);
  --bf-shadow-inset: inset 0 1px 0 rgba(255, 255, 255, 0.04);

  /* Radii */
  --bf-radius-xs: 3px;
  --bf-radius-sm: 4px;
  --bf-radius-md: 6px;
  --bf-radius-lg: 8px;
  --bf-radius-pill: 999px;

  /* Spacing */
  --bf-space-1: 4px;
  --bf-space-2: 8px;
  --bf-space-3: 12px;
  --bf-space-4: 16px;
  --bf-space-5: 20px;
  --bf-space-6: 24px;

  /* Sizes */
  --bf-topbar-h: 40px;
  --bf-statusbar-h: 44px;
  --bf-time-row-h: 48px;
  --bf-control-h: 28px;
  --bf-control-sm-h: 24px;
  --bf-icon-button: 28px;
  --bf-panel-header-h: 34px;
}
```

### 3.2 Recommended colormap strips

Do not hard-code scientific colormaps only as CSS gradients in the renderer. Use real colormap data for quantitative rendering. CSS gradients are acceptable for layer-row preview strips and legends.

```css
.bf-cmap-rdylbu {
  background: linear-gradient(
    90deg,
    #313695 0%,
    #4575b4 18%,
    #74add1 34%,
    #f7f7f7 50%,
    #fdae61 66%,
    #f46d43 82%,
    #a50026 100%
  );
}

.bf-cmap-gray {
  background: linear-gradient(90deg, #080808 0%, #777 50%, #f5f5f5 100%);
}

.bf-cmap-atlas {
  background: linear-gradient(
    90deg,
    #ef4444 0%,
    #f59e0b 20%,
    #22c55e 40%,
    #06b6d4 60%,
    #6366f1 80%,
    #a855f7 100%
  );
}
```

---

## 4. Typography

### 4.1 Font stack

Use a modern UI sans font with a tabular numeric fallback.

```css
:root {
  --bf-font-sans: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
    "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --bf-font-mono: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
}
```

Do not bundle or share font files unless the project has explicit licensing approval. System fallbacks are acceptable.

### 4.2 Type scale

```css
.bf-type-app-title {
  font-size: 18px;
  line-height: 24px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.bf-type-panel-title {
  font-size: 12px;
  line-height: 16px;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.bf-type-section-title {
  font-size: 11px;
  line-height: 16px;
  font-weight: 650;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.bf-type-body {
  font-size: 12px;
  line-height: 18px;
  font-weight: 450;
}

.bf-type-small {
  font-size: 11px;
  line-height: 16px;
  font-weight: 450;
}

.bf-type-micro {
  font-size: 10px;
  line-height: 14px;
  font-weight: 500;
}

.bf-type-number {
  font-family: var(--bf-font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  line-height: 16px;
}
```

### 4.3 Numeric readouts

Use tabular numbers everywhere values need to align:

- World coordinates
- Voxel indices
- Intensity values
- Frame numbers
- TR
- Progress percentages
- Min/max ranges
- Plot axes

```css
.bf-number,
.bf-coord,
.bf-value,
.bf-axis-label {
  font-family: var(--bf-font-mono);
  font-variant-numeric: tabular-nums;
}
```

---

## 5. Base Styles

### 5.1 Reset and root

```css
* {
  box-sizing: border-box;
}

html,
body,
#root {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
  background: var(--bf-bg-app);
  color: var(--bf-text-primary);
  font-family: var(--bf-font-sans);
  font-size: 12px;
  -webkit-font-smoothing: antialiased;
  text-rendering: geometricPrecision;
}

button,
input,
select,
textarea {
  font: inherit;
}

button {
  color: inherit;
}
```

### 5.2 App frame

```css
.bf-app {
  width: 100vw;
  height: 100vh;
  display: grid;
  grid-template-rows: var(--bf-topbar-h) 1fr var(--bf-statusbar-h);
  background:
    radial-gradient(circle at 20% 0%, rgba(47, 128, 255, 0.08), transparent 28%),
    linear-gradient(180deg, #08111c 0%, #05080c 100%);
}

.bf-main {
  min-height: 0;
  display: grid;
  grid-template-columns: 320px minmax(640px, 1fr) 376px;
  gap: 6px;
  padding: 0 8px 6px;
}
```

For resizable panes, wire these columns into Golden Layout or Allotment, but preserve the same minimums.

### 5.3 Generic panel chrome

```css
.bf-panel {
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--bf-border-subtle);
  border-radius: var(--bf-radius-md);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.025), transparent 28%),
    var(--bf-bg-panel);
  box-shadow: var(--bf-shadow-inset);
}

.bf-panel-header {
  height: var(--bf-panel-header-h);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--bf-space-2);
  padding: 0 var(--bf-space-3);
  border-bottom: 1px solid var(--bf-divider);
  background: rgba(255, 255, 255, 0.015);
}

.bf-panel-title {
  color: var(--bf-text-secondary);
  font-size: 12px;
  line-height: 16px;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.bf-panel-body {
  min-height: 0;
  height: 100%;
  overflow: auto;
  padding: var(--bf-space-2);
}
```

---

## 6. Top App Bar

### 6.1 Structure

```text
Brand | Menu | Display Mode Selector | Workspace Dropdown | Utility Icons | User
```

### 6.2 Display mode selector

Use segmented control styling. `Integrated` is active in this mockup.

```css
.bf-display-mode {
  height: 30px;
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--bf-border-subtle);
  border-radius: var(--bf-radius-md);
  background: var(--bf-bg-input);
  overflow: hidden;
}

.bf-display-mode button {
  height: 100%;
  padding: 0 14px;
  border: 0;
  border-right: 1px solid var(--bf-divider);
  background: transparent;
  color: var(--bf-text-secondary);
  cursor: pointer;
}

.bf-display-mode button:last-child {
  border-right: 0;
}

.bf-display-mode button[aria-pressed="true"] {
  color: var(--bf-text-primary);
  background: linear-gradient(180deg, rgba(47, 128, 255, 0.28), rgba(47, 128, 255, 0.12));
  box-shadow: inset 0 -2px 0 var(--bf-accent);
}
```

---

## 7. Left Data Rail

The left rail combines remote/data workflow, BIDS tree, layer stack, and selected layer summary.

### 7.1 Layout

```text
Left Rail
├─ Data / Remote top tabs
├─ Connections
├─ BIDS / Pipeline sub-tabs
├─ Dataset tree
├─ Layers
└─ Layer Summary
```

### 7.2 Connections card

Connection rows should be compact and status-driven.

```text
[icon] Lab HPC (SFTP)       Mounted
       sftp://hpc.lab.edu
```

Status colors:

- Mounted: `--bf-success`
- Connecting: `--bf-warning`
- Error: `--bf-danger`
- Offline: `--bf-text-muted`

### 7.3 BIDS tree rules

- Use folder/file icons, but keep them low contrast.
- Active file gets selected blue row.
- Loaded file may get a small green dot or check.
- Invalid BIDS item gets subtle warning icon, not a loud alert unless user opens validation.

```css
.bf-tree-row {
  height: 24px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  border-radius: var(--bf-radius-sm);
  color: var(--bf-text-secondary);
}

.bf-tree-row:hover {
  background: var(--bf-bg-hover);
}

.bf-tree-row[data-selected="true"] {
  color: var(--bf-text-primary);
  background: linear-gradient(90deg, rgba(47, 128, 255, 0.35), rgba(47, 128, 255, 0.14));
}
```

### 7.4 Layer row

Layer rows are visually dense but must be readable.

```text
[eye] [thumbnail] sub-01_task-rest_bold.nii.gz   [t] [4D] [⋮]
                  Volume (BOLD)
                  -4.0 [colormap strip] 4.0  [thr] [opacity]
```

```css
.bf-layer-row {
  display: grid;
  grid-template-columns: 20px 36px 1fr auto;
  gap: 8px;
  min-height: 62px;
  padding: 8px;
  border: 1px solid transparent;
  border-radius: var(--bf-radius-md);
  background: transparent;
}

.bf-layer-row:hover {
  background: var(--bf-bg-hover);
}

.bf-layer-row[data-selected="true"] {
  border-color: rgba(47, 128, 255, 0.72);
  background: linear-gradient(90deg, rgba(47, 128, 255, 0.20), rgba(47, 128, 255, 0.08));
}

.bf-layer-thumb {
  width: 36px;
  height: 36px;
  border-radius: var(--bf-radius-sm);
  border: 1px solid var(--bf-border);
  background: var(--bf-bg-canvas);
  overflow: hidden;
}

.bf-layer-name {
  color: var(--bf-text-primary);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bf-layer-meta {
  color: var(--bf-text-muted);
  font-size: 11px;
}

.bf-layer-strip {
  width: 84px;
  height: 7px;
  border-radius: var(--bf-radius-pill);
  border: 1px solid rgba(255, 255, 255, 0.18);
}

.bf-pill {
  height: 18px;
  display: inline-flex;
  align-items: center;
  padding: 0 6px;
  border-radius: var(--bf-radius-pill);
  border: 1px solid var(--bf-border-subtle);
  background: rgba(255, 255, 255, 0.04);
  color: var(--bf-text-secondary);
  font-size: 10px;
  font-weight: 650;
}

.bf-pill-threshold {
  color: #d9e7ff;
  border-color: rgba(47, 128, 255, 0.45);
  background: rgba(47, 128, 255, 0.16);
}
```

### 7.5 Layer Summary

The lower-left layer summary is **read-only**. It should not duplicate editable inspector controls.

Allowed content:

- Layer name
- Type badges
- Dimensions
- Datatype
- Space
- TR / voxel size
- Loaded via Rust zero-copy
- `Open in Inspector →`

Do not include editable sliders, min/max fields, histograms, or threshold editors here.

---

## 8. Center Viewer

### 8.1 View header

```text
SLICE VIEW             Crosshair Locked  3/3 locked        Orthogonal | Mosaic | …
```

Rules:

- Global crosshair lock uses text plus lock icon.
- Per-view locks remain icon-only.
- Use `3/3 locked` to clarify global vs view locks.

### 8.2 Orthogonal slice cards

Each card contains:

- Orientation title: Axial (Z), Sagittal (X), Coronal (Y)
- Lock icon
- Canvas
- Crosshair
- R/L, A/P, S/I labels
- Passive ruler
- Single active slice slider
- mm readout and slice index
- Compact stat legend if overlay is active

```css
.bf-ortho-grid {
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}

.bf-slice-card {
  position: relative;
  min-width: 0;
  min-height: 240px;
  overflow: hidden;
  border: 1px solid var(--bf-border-subtle);
  border-radius: var(--bf-radius-md);
  background: var(--bf-bg-canvas);
}

.bf-slice-title {
  position: absolute;
  top: 8px;
  left: 10px;
  z-index: 2;
  font-weight: 700;
  font-size: 12px;
  text-shadow: 0 1px 2px #000;
}

.bf-slice-title[data-plane="axial"] { color: var(--bf-axial); }
.bf-slice-title[data-plane="sagittal"] { color: var(--bf-sagittal); }
.bf-slice-title[data-plane="coronal"] { color: var(--bf-coronal); }

.bf-slice-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  background: #000;
}

.bf-slice-footer {
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 8px;
  z-index: 2;
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 10px;
  align-items: center;
}
```

### 8.3 Slice canvas accuracy

Canvas components should own their device-pixel-ratio scaling.

Implementation requirements:

- CSS width/height define layout size.
- Canvas backing store is `cssSize * devicePixelRatio`.
- Renderer receives physical pixel size and viewport transform.
- Do not stretch rendered image via CSS after rendering.
- Do not use flexbox inside canvas overlay layers where absolute positioning is required for medical alignment.

---

## 9. Canonical Time Row

The pinned time row is visible whenever selected/active data is 4D.

```text
TIME (4D)  [jump start] [previous] [play/pause] [next] [loop]  ━ frame ruler ━  Frame 120 / 240  TR = 2.0 s
```

```css
.bf-time-row {
  height: var(--bf-time-row-h);
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 6px 10px;
  border: 1px solid var(--bf-border-subtle);
  border-radius: var(--bf-radius-md);
  background: var(--bf-bg-panel);
}

.bf-time-controls {
  display: inline-flex;
  gap: 6px;
  align-items: center;
}

.bf-time-label {
  color: var(--bf-accent-hover);
  font-family: var(--bf-font-mono);
  font-variant-numeric: tabular-nums;
}
```

Do not add a second primary time scrubber in the inspector. The inspector can show advanced timing metadata only.

---

## 10. 3D Surface View

### 10.1 Layout

```text
┌─────────────────────────────────────────────────────┐
│ Tool rail       3D brain canvas              compass│
│                                                     │
│                                                     │
│ Bottom camera/view strip                 t-value bar│
└─────────────────────────────────────────────────────┘
```

### 10.2 Tool rail

Use grouped labels from mockup 7.

Groups:

- Navigate: Orbit, Pan, Zoom, Reset View
- Select: Cursor, Brush, Lasso
- Measure: Distance, Angle, Label
- Capture: Screenshot, Record

```css
.bf-tool-rail {
  position: absolute;
  left: 10px;
  top: 10px;
  z-index: 3;
  width: 118px;
  padding: 8px;
  border: 1px solid var(--bf-border-subtle);
  border-radius: var(--bf-radius-md);
  background: rgba(8, 17, 28, 0.88);
  backdrop-filter: blur(8px);
}

.bf-tool-group + .bf-tool-group {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--bf-divider);
}

.bf-tool-group-title {
  margin-bottom: 4px;
  color: var(--bf-text-muted);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.bf-tool-button {
  width: 100%;
  height: 24px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 6px;
  border: 0;
  border-radius: var(--bf-radius-sm);
  background: transparent;
  color: var(--bf-text-secondary);
  cursor: pointer;
}

.bf-tool-button:hover {
  background: var(--bf-bg-hover);
  color: var(--bf-text-primary);
}

.bf-tool-button[aria-pressed="true"] {
  background: var(--bf-bg-selected);
  color: var(--bf-text-primary);
}
```

### 10.3 3D legend

Always show scalar name and numeric min/max when an overlay is active.

```text
t-value
-4.0  -2.0   0   2.0   4.0
```

Keep this legend in the 3D viewport; do not rely only on inspector fields.

---

## 11. Bottom Dock

### 11.1 Single dock, three tabs

The bottom analysis area should be one dock with tabs:

```text
Activity | Plot | Log
```

Avoid showing both a `LOG` tab and a separate always-visible standalone `LOG` panel unless the user explicitly splits the dock.

Default mockup state: `Plot` selected or visible alongside Activity depending on workspace preset. For clarity in implementation, start with a single tabbed dock.

### 11.2 Dock behavior

- `Activity`: jobs, loads, network, errors
- `Plot`: selected plot host
- `Log`: detailed chronological event log

```css
.bf-bottom-dock {
  min-height: 0;
  display: grid;
  grid-template-rows: 34px 1fr;
  border: 1px solid var(--bf-border-subtle);
  border-radius: var(--bf-radius-md);
  background: var(--bf-bg-panel);
  overflow: hidden;
}

.bf-dock-tabs {
  height: 34px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  border-bottom: 1px solid var(--bf-divider);
}

.bf-dock-tab {
  height: 28px;
  padding: 0 12px;
  border: 0;
  border-radius: var(--bf-radius-sm) var(--bf-radius-sm) 0 0;
  background: transparent;
  color: var(--bf-text-secondary);
  cursor: pointer;
}

.bf-dock-tab[aria-selected="true"] {
  color: var(--bf-accent-hover);
  box-shadow: inset 0 -2px 0 var(--bf-accent);
}
```

### 11.3 Plot host

The plot panel is generic. It is not just a histogram.

```ts
export type PlotMode =
  | "crosshair-time-series"
  | "selected-layer-histogram"
  | "roi-time-series"
  | "event-aligned-response"
  | "qc-trace";
```

Plot header should include:

- Plot mode dropdown
- Source label
- Context readouts
- Overflow menu

For crosshair time-series:

```text
Crosshair Time-Series
Voxel (i,j,k): 30, 44, 36     World (mm): -2.0, 12.0, 18.0     TR = 2.0 s
```

For histogram:

```text
Selected-Layer Histogram
Layer: sub-01_task-rest_bold.nii.gz     Frame: 120 / 240     Range: -4.0 … 4.0
```

Do not put editable range controls inside the histogram plot by default. The plot can visualize the selected range, but editing belongs in the inspector.

---

## 12. Right Inspector

### 12.1 Top-level modes

```text
INSPECTOR | ANNOTATE
```

```css
.bf-inspector-tabs {
  height: 36px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  border-bottom: 1px solid var(--bf-divider);
}

.bf-inspector-tab {
  border: 0;
  background: transparent;
  color: var(--bf-text-secondary);
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.bf-inspector-tab[aria-selected="true"] {
  color: var(--bf-text-primary);
  box-shadow: inset 0 -2px 0 var(--bf-accent);
}
```

### 12.2 Active layer banner

The inspector starts with an active layer banner.

Required information:

- Thumbnail/icon
- Layer name
- Type badges: `t`, `4D`, `Atlas`, etc.
- Loaded/valid status
- Dimensions
- Datatype
- Space
- Voxel size
- TR if 4D
- Colormap chip when relevant

```css
.bf-active-layer-banner {
  display: grid;
  grid-template-columns: 40px 1fr auto;
  gap: 10px;
  padding: 12px;
  border-bottom: 1px solid var(--bf-divider);
  background: linear-gradient(180deg, rgba(47, 128, 255, 0.05), transparent);
}
```

### 12.3 Inspector sections

Use collapsible sections.

Volume inspector default sections:

```text
Active Layer
Display
Threshold
Slices
Stats (summary)
Info
```

Surface inspector default sections:

```text
Active Layer
Surface
Overlay
Lighting
Threshold
Stats (summary)
Info
```

Atlas inspector default sections:

```text
Active Layer
Atlas Display
Labels
Lookup Table
Selection
Stats (summary)
Info
```

### 12.4 Summary-only Stats

`STATS` is compact and may be collapsed by default.

Allowed:

- Min
- Max
- Mean
- Std
- P2
- P98
- Valid voxel count

Not allowed by default:

- Full histogram chart
- Editable histogram handles
- Duplicate intensity sliders

Add a link or button if needed:

```text
Open histogram in Plot →
```

---

## 13. Status Bar

### 13.1 Structure

```text
Ready | World (MNI): X -2.0 Y 12.0 Z 18.0 mm | Voxel (i,j,k): 30 44 36 | Intensity: 2.34 t-value | Crosshair Locked 3/3 | RAS | Settings
```

Separate coordinate group from app-state group with vertical dividers.

```css
.bf-statusbar {
  height: var(--bf-statusbar-h);
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 0 12px;
  border-top: 1px solid var(--bf-border-subtle);
  background: rgba(7, 16, 26, 0.96);
}

.bf-status-group {
  display: inline-flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}

.bf-status-divider {
  width: 1px;
  height: 22px;
  background: var(--bf-divider);
}

.bf-status-value-emphasis {
  color: var(--bf-warning);
  font-weight: 700;
  font-family: var(--bf-font-mono);
  font-variant-numeric: tabular-nums;
}
```

---

## 14. Controls

### 14.1 Buttons

```css
.bf-button {
  height: var(--bf-control-h);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 10px;
  border: 1px solid var(--bf-border-subtle);
  border-radius: var(--bf-radius-sm);
  background: var(--bf-bg-input);
  color: var(--bf-text-secondary);
  cursor: pointer;
}

.bf-button:hover {
  border-color: var(--bf-border);
  background: var(--bf-bg-hover);
  color: var(--bf-text-primary);
}

.bf-button-primary {
  border-color: rgba(47, 128, 255, 0.62);
  background: linear-gradient(180deg, #2f80ff, #1f6feb);
  color: white;
}
```

### 14.2 Inputs/selects

```css
.bf-input,
.bf-select {
  height: var(--bf-control-h);
  width: 100%;
  padding: 0 9px;
  border: 1px solid var(--bf-border-subtle);
  border-radius: var(--bf-radius-sm);
  background: var(--bf-bg-input);
  color: var(--bf-text-primary);
  outline: none;
}

.bf-input:focus,
.bf-select:focus {
  border-color: var(--bf-border-focus);
  box-shadow: 0 0 0 2px rgba(47, 128, 255, 0.20);
}
```

### 14.3 Sliders

```css
.bf-slider {
  width: 100%;
  accent-color: var(--bf-accent);
}

.bf-slider-row {
  display: grid;
  grid-template-columns: 80px 1fr 56px;
  gap: 10px;
  align-items: center;
  min-height: 32px;
}
```

### 14.4 Toggles

```css
.bf-toggle {
  width: 34px;
  height: 18px;
  border-radius: var(--bf-radius-pill);
  border: 1px solid var(--bf-border-subtle);
  background: #1f2937;
  position: relative;
}

.bf-toggle::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--bf-text-secondary);
  transition: transform 120ms ease, background 120ms ease;
}

.bf-toggle[aria-checked="true"] {
  background: var(--bf-accent);
}

.bf-toggle[aria-checked="true"]::after {
  transform: translateX(16px);
  background: white;
}
```

---

## 15. React Component Skeleton

```tsx
export function BrainflowApp() {
  return (
    <div className="bf-app">
      <TopAppBar />

      <main className="bf-main">
        <LeftDataRail />
        <IntegratedWorkspace />
        <RightInspector />
      </main>

      <StatusBar />
    </div>
  );
}

function TopAppBar() {
  return (
    <header className="bf-topbar">
      <Brand />
      <MainMenu />
      <DisplayModeSelector
        modes={["Orthogonal", "Surface", "Integrated", "Mosaic", "Compare"]}
        selected="Integrated"
      />
      <WorkspaceMenu />
      <UtilityActions />
      <UserMenu />
    </header>
  );
}

function IntegratedWorkspace() {
  return (
    <section className="bf-workspace bf-workspace-integrated">
      <ViewHeader />
      <OrthogonalSliceRow />
      <TimeScrubber />
      <SurfaceViewport />
      <BottomDock />
    </section>
  );
}

function RightInspector() {
  const selectedLayer = useLayerStore((s) => s.selectedLayer);
  const mode = useUiStore((s) => s.rightMode); // "inspector" | "annotate"

  return (
    <aside className="bf-panel bf-inspector">
      <InspectorModeTabs selected={mode} />
      {mode === "annotate" ? (
        <AnnotatePanel />
      ) : (
        <SelectedLayerInspector layer={selectedLayer} />
      )}
    </aside>
  );
}

function SelectedLayerInspector({ layer }: { layer: Layer | null }) {
  if (!layer) return <EmptyInspector />;

  return (
    <>
      <ActiveLayerBanner layer={layer} />
      {layer.kind === "volume" && <VolumeInspector layer={layer} />}
      {layer.kind === "surface" && <SurfaceInspector layer={layer} />}
      {layer.kind === "atlas" && <AtlasInspector layer={layer} />}
    </>
  );
}
```

---

## 16. State Contracts

Because Golden Layout panels may be isolated React roots, shared state should live in Zustand stores or an equivalent external store.

### 16.1 Core stores

```ts
export type DisplayMode = "orthogonal" | "surface" | "integrated" | "mosaic" | "compare";
export type RightMode = "inspector" | "annotate";
export type LayerKind = "volume" | "surface" | "atlas" | "annotation";

export interface CrosshairState {
  worldMm: [number, number, number];
  voxelIjk: [number, number, number];
  lockedViews: number;
  totalViews: number;
  isLocked: boolean;
}

export interface TimeState {
  frame: number;
  frameCount: number;
  trSeconds?: number;
  isPlaying: boolean;
  loop: boolean;
}

export interface LayerVisualState {
  visible: boolean;
  opacity: number;
  colormap?: string;
  thresholdEnabled?: boolean;
  thresholdMin?: number;
  thresholdMax?: number;
  intensityMin?: number;
  intensityMax?: number;
}
```

### 16.2 UI ownership rules

- `LayerStore` owns selected layer and layer visual settings.
- `CrosshairStore` owns world/voxel coordinates and lock state.
- `TimeStore` owns frame playback for active 4D layer.
- `PlotStore` owns plot mode and selected plot source.
- `WorkspaceStore` owns display mode and dock layout.

---

## 17. PlotPanel Contract

The plot panel should be a generic host with multiple renderers.

```tsx
export interface PlotPanelProps {
  mode: PlotMode;
  sourceLayerId?: string;
  crosshair?: CrosshairState;
  frame?: number;
}

export interface PlotContextLabel {
  label: string;
  value: string;
}
```

Recommended plot host layout:

```text
┌──────────────────────────────────────────────────────┐
│ [Crosshair Time-Series ▾]                 [⋮]        │
│ Voxel: 30,44,36 | World: -2,12,18 | TR 2.0s          │
│                                                      │
│ chart canvas / SVG                                   │
└──────────────────────────────────────────────────────┘
```

Rendering options:

- Canvas for high-density traces
- SVG for simple overlays and axes
- WebGPU not required for first implementation

---

## 18. Accessibility and Interaction

### 18.1 Keyboard

Minimum keyboard support:

| Action | Shortcut |
|---|---|
| Next frame | Right Arrow or `]` |
| Previous frame | Left Arrow or `[` |
| Play/pause 4D | Space, when time row focused |
| Toggle selected layer visibility | `V` |
| Focus layer list | `L` |
| Focus inspector | `I` |
| Focus plot dock | `P` |
| Reset 3D view | `R`, when surface viewport focused |
| Toggle crosshair lock | `K` |

### 18.2 Focus states

Every interactive element must have visible focus.

```css
:focus-visible {
  outline: 2px solid var(--bf-border-focus);
  outline-offset: 2px;
}
```

### 18.3 Motion

Use subtle motion only.

```css
:root {
  --bf-motion-fast: 100ms;
  --bf-motion-normal: 160ms;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 1ms !important;
    transition-duration: 1ms !important;
    scroll-behavior: auto !important;
  }
}
```

---

## 19. Implementation Notes for Tauri + React

### 19.1 Rendering panes

- Slice canvases should be independent components that subscribe to crosshair/layer/time stores.
- Avoid passing large volume data through React props.
- React should pass handles, transforms, and display parameters only.
- Rust/backend owns volume memory and returns handles or frame buffers as needed.
- Keep zero-copy provenance visible in Info/Summary, but do not over-advertise it in every panel.

### 19.2 Golden Layout / Allotment

Use Golden Layout for workspace docking, but keep the visual rhythm consistent:

- All panels use the same border radius and header height.
- Pane gaps are 6 px.
- Isolated roots must receive stores via external subscriptions, not React Context.
- Persist workspace layouts per display mode.

### 19.3 Suggested component folders

```text
src/
  app/
    BrainflowApp.tsx
    TopAppBar.tsx
    StatusBar.tsx
  design/
    tokens.css
    components.css
  workspace/
    DisplayModeSelector.tsx
    IntegratedVolumeSurfaceWorkspace.tsx
    OrthogonalWorkspace.tsx
    SurfaceWorkspace.tsx
    MosaicWorkspace.tsx
    CompareWorkspace.tsx
  panels/
    LeftDataRail/
    Inspector/
    BottomDock/
    PlotPanel/
    ActivityPanel/
    LogPanel/
  viewers/
    SliceViewCanvas/
    SurfaceViewport/
  stores/
    layerStore.ts
    crosshairStore.ts
    timeStore.ts
    plotStore.ts
    workspaceStore.ts
```

---

## 20. Acceptance Checklist for Mockup Reproduction

A build matches the intended design direction when:

- The app has a three-column shell with center-dominant viewing.
- Top bar includes `Orthogonal | Surface | Integrated | Mosaic | Compare` and `Integrated` can be selected.
- Right panel has only `INSPECTOR | ANNOTATE` as top-level modes.
- Inspector content changes based on selected layer type.
- Active layer banner appears at top of inspector.
- Layer rows show colormap strips, opacity, type badges, and threshold cue.
- Bottom dock uses `Activity | Plot | Log` without duplicating a standalone log panel.
- Plot panel can show a crosshair voxel time-series and selected-layer histogram.
- Inspector `STATS` is summary-only and does not show a full histogram by default.
- A 4D layer shows one canonical pinned time row in the center workspace.
- Status bar shows world coordinates, voxel indices, intensity, scalar name, crosshair lock state, and orientation system.
- No editable control appears in two unrelated places.

---

## 21. Recommended First Implementation Slice

Build in this order:

1. Add tokens and base panel chrome.
2. Implement the app shell with left rail, center workspace, inspector, and status bar.
3. Add display mode selector with `Integrated` selected.
4. Implement selected-layer-driven inspector with active layer banner.
5. Implement canonical time row for 4D layers.
6. Implement bottom dock with `Activity | Plot | Log` tabs.
7. Implement `PlotPanel` as generic plot host.
8. Add crosshair time-series plot.
9. Move histogram out of inspector into Plot mode.
10. Add richer surface controls only inside selected-layer inspector or surface-specific workspace.

---

## 22. Design Decisions to Preserve

- Dark, quiet, research-grade chrome.
- High-density UI without looking playful or consumer-oriented.
- Strong neuroimaging numerics everywhere users expect them.
- No duplicate control surfaces.
- Plot is a first-class analysis dock.
- Integrated view is a selectable display mode.
- Layers remain central.
- Inspector is contextual and selection-driven.
- Annotation is a real mode, not another layer-type tab.

---

## 23. Addendum (gaps closed after v1 review)

This section folds in the contracts that were missing from §1–§22. See `resdesign/DESIGN_REVIEW.md` for the full vetting; what follows is the binding spec.

### 23.1 Z-index scale

Stacking order is a token, not a magic number. Add to `:root` in `theme.css`:

```css
--bf-z-base: 0;
--bf-z-panel: 1;
--bf-z-overlay: 10;       /* canvas overlays, R/L labels, rulers */
--bf-z-tool-rail: 20;
--bf-z-popover: 100;      /* Radix Popover, DropdownMenu */
--bf-z-tooltip: 200;
--bf-z-modal: 1000;
--bf-z-toast: 2000;
--bf-z-drag: 3000;        /* DnD-kit drag overlay */
```

Never use literal `z-index: 9999`. Pick the layer.

### 23.2 Component contracts

| Component | Spec | Implementation note |
|---|---|---|
| Dialog / Modal | `--bf-z-modal`, padding `--bf-space-4`, header height `--bf-panel-header-h`, max-width 560px for forms / 800px for content. Close on ESC. Backdrop is `rgba(0,0,0,0.55)`. | Radix Dialog wrapped as `ui/Modal.tsx`. |
| Tooltip | Use for icon-only buttons, units, and shortcuts. Delay 300ms. Body text only — no interactive content. | Radix Tooltip via `ui/Tooltip.tsx`. |
| Popover | Use for editable content (color, opacity slider, layer overflow menu). No delay. May contain interactive content. | Radix Popover. |
| Toast / Notification | Top-right, `--bf-z-toast`. Auto-dismiss after 5s for info, 10s for warning, never for danger. Stack max 4. | `ui/NotificationToast.tsx`. |
| Tabs (general) | Reuse `bf-dock-tabs` styling for any horizontal tab surface. Selected indicator is the same `inset 0 -2px 0 var(--bf-accent)`. | n/a |
| Table / list | 28px row height, divider `--bf-divider`, hover `--bf-bg-hover`. Numeric columns right-aligned with tabular-nums. | n/a |
| Loading / skeleton | Skeleton blocks use `--bf-bg-panel-raised` with a 1.5s pulse to `--bf-bg-hover`. Spinner only inside buttons or `<32px` regions. Progress bar for known-bound work. | `ui/InlineProgress.tsx`, `ui/ProgressDrawer.tsx`. |
| Empty state | Icon at 32px with `--bf-text-muted`, one-line title in `bf-type-section-title`, one-line hint in `bf-type-small`, optional primary button. | n/a |

### 23.3 Button variants and sizes

`Button.tsx` is the canonical `bf-button`. Variants:

- `default` (secondary) — current `.bf-button`.
- `primary` — current `.bf-button-primary`.
- `ghost` — no border, no background; hover applies `--bf-bg-hover`.
- `destructive` — `--bf-danger` accent, used for irreversible actions.
- `icon` — square, no padding, used inside toolbars.

Sizes (matching control tokens):

- `xs` → `--bf-control-sm-h` (24px)
- `sm` → `--bf-control-h` (28px) — default
- `md` → 32px (one-off; defined as `--bf-control-md-h: 32px` if needed)

### 23.4 Form validation styling

```css
.bf-input[aria-invalid="true"],
.bf-select[aria-invalid="true"] {
  border-color: var(--bf-danger);
  box-shadow: 0 0 0 2px var(--bf-danger-soft);
}

.bf-form-error {
  font-size: 11px;
  color: var(--bf-danger);
  line-height: 16px;
}

.bf-form-help {
  font-size: 11px;
  color: var(--bf-text-muted);
  line-height: 16px;
}

.bf-input[disabled] {
  color: var(--bf-text-faint);
  cursor: not-allowed;
}
```

### 23.5 Plot palette (multi-series)

Multi-series plots (ROI time-series, event-aligned response, QC traces) need a categorical palette that survives on `--bf-bg-canvas` and is colorblind-safe. Brainflow uses the Wong palette, the same set already in use for BIDS event types:

```css
--bf-plot-cat-1: #2f80ff;   /* blue (anatomical axial) */
--bf-plot-cat-2: #40c463;   /* green (anatomical sagittal) */
--bf-plot-cat-3: #ff9900;   /* orange (anatomical coronal) */
--bf-plot-cat-4: #e69f00;   /* warm orange */
--bf-plot-cat-5: #56b4e9;   /* sky blue */
--bf-plot-cat-6: #cc79a7;   /* reddish purple */
--bf-plot-cat-7: #f0e442;   /* yellow */
--bf-plot-cat-8: #d55e00;   /* vermillion */
```

The first three intentionally match the anatomical orientation tokens.

### 23.6 Iconography

- Source: `lucide-react`. Do not introduce a second icon library.
- Stroke-width: 1.5px (1.75 for pictogram-style icons).
- Sizes: 14px inside `--bf-control-sm-h`, 16px inside `--bf-control-h`, 20px inside panel headers, 32px inside empty states.
- Color: inherits via `currentColor`. Never hardcode an icon color in JSX — set `text-bf-*` on the surrounding element.

### 23.7 Cursor states

| Tool | Cursor |
|---|---|
| Idle viewport | `default` |
| Hover canvas while tool not active | `crosshair` |
| Pan / drag in 3D viewport | `grab` / `grabbing` |
| Brush / lasso / measure | `crosshair` |
| Resizing splitter | inherited from GoldenLayout / Allotment |
| Disabled control | `not-allowed` |

### 23.8 Accessibility & contrast

All text tokens must meet WCAG AA on the background they appear over:

| Token | On `--bf-bg-app` | On `--bf-bg-panel` | Verdict |
|---|---|---|---|
| `--bf-text-primary` | ~14.6:1 | ~12.4:1 | AAA |
| `--bf-text-secondary` | ~10.4:1 | ~9.5:1 | AAA |
| `--bf-text-muted` | ~5.4:1 | ~5.0:1 | AA |
| `--bf-text-faint` | ~3.6:1 | ~3.4:1 | **fails AA** |

**Rule:** `--bf-text-faint` is decorative only — divider labels, watermark coordinates that duplicate other readouts, etc. Never use it for content the user must read to act.

### 23.9 Density / responsive baseline

- Design baseline: 1600 × 1000.
- Minimum supported: 1280 × 800.
- At < 1280 wide, the **left rail collapses to a drawer** (not into the workspace), and the **bottom dock shrinks to its 160 px minimum**.
- The right inspector never collapses. If the screen is too narrow for both rails + 640px center, the left rail wins and the inspector becomes a drawer.

### 23.10 Print / screenshot rule

Anything exported through the `Capture` tool group (§10.2):

- Renders with all overlays (crosshair, ruler, R/L labels, legend) enabled by default.
- Exported PNG/SVG uses `--bf-bg-canvas` as background, never panel chrome.
- Numeric annotations use the canonical `--bf-font-mono` and tabular-nums.
- The user can toggle individual overlays before export, but defaults are always "show what the user can see."

---

## 24. Decision Log

Newest first. Format: `YYYY-MM-DD — area — decision — rationale`.

- **2026-05-02 — addendum** — Added §23 (z-index, component contracts, button variants, validation, plot palette, iconography, cursors, contrast, density, print) and §24 (this log). Rationale: closed the gaps surfaced by the v1 review (`resdesign/DESIGN_REVIEW.md`) so Design.md is self-sufficient.
- **2026-05-02 — review** — `resdesign/DESIGN_REVIEW.md` records the vet of §1–§22; the binding amendments live here in §23.
- **2026-05-02 — contract** — Authored `docs/design-system/ui-contract.md` as the enforcement layer; `Design.md` remains the intent layer.
