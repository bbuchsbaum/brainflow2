# Investigation Report: `row` arrangement renders all-black slice panes

**Symptom:** In `OrthogonalPanelsWorkspace.tsx`, the new `orthoArrangement` setting works for `grid` and `column`, but `row` renders three all-black panes (no brains). The only source-level difference between the working `column` and the broken `row` is the `vertical` prop on `<Allotment>`.

**Verdict:** This is a **layout-initialization bug inside the `allotment@1.20.4` library, triggered by the `row` call-site omitting `defaultSizes`** — combined with the fact that the three panes have a combined `minSize` (3 × 200 = 600 px) that *exceeds the available main-axis size* of the orthogonal region in the Integrated workspace. The horizontal split therefore initializes every pane's main-axis (width) inline style to a degenerate value and never recovers, so each `FlexibleSlicePanel` container ends up width≈0 and the centered canvas paints onto a 0-px-wide box → black. The `column` case "works" only because the vertical region is tall enough to satisfy 3 × 200 px; **`column` has the same latent bug** and will also go black if the region is ever shorter than ~600 px.

---

## 1. The render chain is NOT the cause (ruled out)

I traced the full data path and it is robust against small/degenerate sizes:

- `FlexibleSlicePanel.tsx:97-130` measures its container with a `ResizeObserver` and via `getBoundingClientRect()`, then calls `clampDimensions(width, height)` before doing anything.
- `clampDimensions` → `clampDimension` (`ui2/src/utils/dimensions.ts:18-23`) **forces every dimension to `Math.max(50, …)` and returns `512` for any value `<= 0`.** So the panel can *never* push a 0 (or sub-50) width/height into the store.
- `viewStateStore.updateDimensionsAndPreserveScale` (`ui2/src/stores/viewStateStore.ts:498-504`) additionally bails on `newWidth <= 0 || newHeight <= 0`. With the clamp upstream, this guard never fires.
- The canvas itself (`SliceRenderer.tsx:193-199`) is `<canvas width={width} height={height} className="block" />` centered inside `flex items-center justify-center`. It uses **intrinsic attribute sizing (≥50)**, not `w-full/h-full`. So even inside a collapsed container the canvas element is ~50 px and would show a *tiny* image, not a full black pane.

**Conclusion:** A fully-black pane is a *container collapse* — the `FlexibleSlicePanel` outer `h-full w-full` box (`FlexibleSlicePanel.tsx:141`) is being given a 0-px main-axis size by the Allotment pane wrapper, so the canvas' centering box collapses and the backend render (still produced at ≥50 px) is invisible. The bug lives in how `allotment` sizes its panes for the `row` configuration.

## 2. How `allotment@1.20.4` initializes pane sizes (the mechanism)

Resolved package: `node_modules/.pnpm/allotment@1.20.4_react-dom@19.1.0_react@19.1.0/node_modules/allotment/dist/module.js`. Key facts from the minified source:

**(a) `proportionalLayout` already defaults to `true`** (`module.js:1050`: `this.proportionalLayout = t.proportionalLayout != null ? t.proportionalLayout : !0`). So a missing `proportionalLayout` prop is **not** the differentiator — adding it alone changes nothing.

**(b) Mount effect builds a `descriptor` only when `defaultSizes` is present** (`module.js:1503-1516`). With `defaultSizes` (`p`) provided, the `SplitView` is constructed with `descriptor.views` already sized to the `defaultSizes` values and `descriptor.size = sum(defaultSizes)`. **With `defaultSizes` omitted (the `row`/`column` path), no descriptor is created → the `SplitView` starts with zero `viewItems`.** Panes are then added later by the children-diffing effect.

**(c) The children-diffing effect only runs after the "ready" flag `Y` flips true** (`module.js:1556`: `C(() => { if (Y) { … addView(…, ce.Distribute, …) … } }, [R, Y, c, l, v])`).

**(d) `Y` flips true ONLY inside the ResizeObserver `onResize`, and only when BOTH width and height are truthy** (`module.js:1648`):
```js
onResize: ({ width: e, height: t }) => {
  e && t && (T.current.layout(b ? t : e), H.current.setSize(b ? t : e), B(!0));
}
```
Note `b ? t : e`: a **vertical** split lays out using **height** (`t`); a **horizontal** split lays out using **width** (`e`).

**(e) Per-view DOM sizing (`module.js:1020-1028`):**
- Horizontal pane (`class de`): `layoutContainer(e)` sets `style.left` and `style.width = this.size + "px"` — it sets **width** inline; height comes from CSS.
- Vertical pane (`class pe`): sets `style.top` and `style.height = this.size + "px"` — it sets **height** inline; width comes from CSS.
- CSS (`allotment/dist/style.css:37-43`): `.horizontal > … > .splitViewView { height: 100% }`, `.vertical > … > .splitViewView { width: 100% }`. So the **cross-axis** dimension is pure CSS (always 100%), and the **main-axis** dimension is the inline `this.size` value produced by the layout pass.

## 3. Why `row` specifically collapses — the `minSize` overflow

When the panes are added via `addView(…, ce.Distribute)` (`module.js:1556+`), the `Distribute` path runs `distributeViewSizes()` (`module.js:1114`, `1183-1191`):
```js
distributeViewSizes() {
  … i = Math.floor(t / e.length);            // equal share of current content
  for (view of e) view.size = clamp(i, view.minimumSize, view.maximumSize);
  this.relayout(...);
}
```
and `layout(size)` distributes the container size across views, **clamping each view to `[minimumSize, maximumSize]`** (`module.js:1135-1153`, `resize()` at `1271-1289` uses `g(...)` = clamp).

The three row panes are declared `minSize={200}` (`OrthogonalPanelsWorkspace.tsx:112-114`). That is **600 px of minimum width**. In the Integrated workspace the orthogonal region is the *left half* of a horizontal split (`IntegratedVolumeSurfaceWorkspace.tsx:86-94`, default `split = "horizontal"`), so its available width is roughly `(windowWidth − leftRail − inspector) / 2`, frequently **well under 600 px**. When the container's main-axis size is smaller than `Σ minSize`, allotment's clamp/relayout cannot satisfy all three minimums; the distribution math drives the trailing pane(s)' computed `size` toward 0 (and, depending on resolve order during the initial `Distribute`, can drive *all three* toward their floor while the container can't grow them). The result: one or more horizontal panes get an inline `style.width` of `0px` (or a few px). Because horizontal width is the *inline* main-axis value (step 2e), a 0-width pane means the `FlexibleSlicePanel` `h-full w-full` box is 0-wide → the centered canvas box collapses → **black**.

`column` escapes this in practice only because the vertical region is taller than 600 px in the default layout, so `Σ minSize` (600) fits and each pane gets a healthy inline `style.height`. **The bug is identical in `column`; it just isn't being tripped because the height budget happens to be large enough.**

`grid` never trips it because its inner horizontal split has only **2** panes (`minSize 200 × 2 = 400`) **and** supplies `defaultSizes={horizontalSizes}` (`[50,50]`, `OrthogonalPanelsWorkspace.tsx:128`). The descriptor (step 2b) gives both panes explicit non-zero sizes at construction time, before any ResizeObserver pass, so they are never momentarily 0 and the 400 px minimum comfortably fits.

## 4. Why the working call-sites differ

- **Grid inner horizontal** (`OrthogonalPanelsWorkspace.tsx:126-133`): passes `defaultSizes={horizontalSizes}` → descriptor with explicit sizes. Works.
- **`IntegratedVolumeSurfaceWorkspace.tsx:73, 86`**: passes `proportionalLayout` but, more importantly, uses **2-pane** splits whose minSizes fit. (`proportionalLayout` there is redundant — it already defaults to `true`; it is not what makes them work.)
- **`row` / `column`** (`OrthogonalPanelsWorkspace.tsx:107-115`): omit `defaultSizes` AND pack **3 × minSize 200**. Only the orientation with the larger axis budget survives.

So the file header comment ("Omit defaultSizes (Allotment distributes evenly) so we never feed a 2-element ratio into 3 panes", lines 105-106) is the proximate mistake: omitting `defaultSizes` removes the construction-time descriptor that the grid path relies on, and exposes the empty-`viewItems` → `Distribute` → clamp-to-floor initialization path under a tight width budget.

---

## 5. Concrete fix

Give the `row`/`column` Allotment an explicit, evenly-split `defaultSizes` for THREE panes (not two), so a construction-time descriptor with non-zero sizes exists immediately. Also drop the per-pane `minSize` to a value whose ×3 sum comfortably fits any realistic region (e.g. 120), so the layout can never be forced below the container size.

### Edit `ui2/src/components/views/OrthogonalPanelsWorkspace.tsx`, lines 104-116

Replace:
```tsx
  if (arrangement === "row" || arrangement === "column") {
    // A single split of three even panes. Omit defaultSizes (Allotment
    // distributes evenly) so we never feed a 2-element ratio into 3 panes.
    tree = (
      <Allotment
        vertical={arrangement === "column"}
        onChange={handleDragDetection}
      >
        <Allotment.Pane minSize={200}>{axial}</Allotment.Pane>
        <Allotment.Pane minSize={200}>{sagittal}</Allotment.Pane>
        <Allotment.Pane minSize={200}>{coronal}</Allotment.Pane>
      </Allotment>
    );
  } else {
```

With:
```tsx
  if (arrangement === "row" || arrangement === "column") {
    // A single split of three even panes. Provide an explicit 3-element
    // defaultSizes so Allotment builds a construction-time descriptor with
    // non-zero pane sizes (the grid path relies on the same mechanism). Without
    // it, allotment mounts with zero viewItems and only sizes panes after the
    // first ResizeObserver pass via a Distribute path that clamps panes to their
    // minSize floor — and when 3 x minSize exceeds the region's main-axis size
    // (e.g. the row split inside the half-width Integrated orthogonal region),
    // panes collapse to ~0 px on the main axis and the slice canvas paints
    // black. minSize is also lowered so 3 panes always fit.
    tree = (
      <Allotment
        vertical={arrangement === "column"}
        proportionalLayout
        defaultSizes={[1, 1, 1]}
        onChange={handleDragDetection}
      >
        <Allotment.Pane minSize={120}>{axial}</Allotment.Pane>
        <Allotment.Pane minSize={120}>{sagittal}</Allotment.Pane>
        <Allotment.Pane minSize={120}>{coronal}</Allotment.Pane>
      </Allotment>
    );
  } else {
```

### Why this addresses the root cause

1. **`defaultSizes={[1, 1, 1]}`** makes `allotment`'s mount effect build a `descriptor` (`module.js:1505-1515`) with three views whose initial sizes are `[1,1,1]`. The absolute values are irrelevant because `proportionalLayout` is on — they are immediately re-proportioned to thirds on the first `layout(size)` from the ResizeObserver (`module.js:1140-1145` + `saveProportions` at `1341`). The panes therefore start with **non-zero main-axis sizes at construction**, bypassing the empty-`viewItems` → `Distribute` → clamp-to-floor path that produced the 0-width state. This is exactly the mechanism the working `grid` inner split uses.
2. **`minSize={120}`** guarantees `3 × 120 = 360 px <` the realistic main-axis budget of both the standalone and Integrated (half-width) orthogonal regions, so the clamp in `layout()`/`resize()` can never be forced to drive a pane to 0 even on a narrow window. (100 also works; keep ≥ ~96 so slice + slider stay usable.)
3. It fixes the **latent `column` bug** at the same time: a short vertical region (e.g. Integrated split `vertical` with a short orthogonal half) would otherwise hit the identical collapse.
4. `proportionalLayout` is added for clarity/robustness but is technically a no-op default (already `true`); the load-bearing changes are `defaultSizes` + lower `minSize`.

### Note on the existing test
`ui2/src/components/views/__tests__/OrthogonalPanelsWorkspace.test.tsx:13-36` fully mocks `allotment` and only asserts orientation + pane count, so it neither catches this bug nor breaks under the fix. For regression coverage, extend the mock to surface `defaultSizes` (e.g. `data-default-sizes`) and assert the row/column Allotment receives a 3-element array. A true regression test would need a real jsdom render inside a constrained-width container, which the current mock-based test deliberately avoids.

---

## Key files & line references

- `ui2/src/components/views/OrthogonalPanelsWorkspace.tsx:104-116` — the `row`/`column` Allotment (no `defaultSizes`, `minSize=200`); the fix site.
- `ui2/src/components/views/OrthogonalPanelsWorkspace.tsx:126-133` — working grid inner horizontal split (`defaultSizes` present, 2 panes).
- `ui2/src/components/views/FlexibleSlicePanel.tsx:97-130, 141` — ResizeObserver/clamp; outer `h-full w-full` box that collapses when the pane main-axis is 0.
- `ui2/src/utils/dimensions.ts:18-23` — `clampDimension` forces ≥50 / 512, proving the data path never emits a 0 dimension (rules out the store path).
- `ui2/src/stores/viewStateStore.ts:498-504` — `<= 0` guard (never fires due to clamp).
- `ui2/src/components/views/SliceRenderer.tsx:193-199` — canvas uses intrinsic attribute sizing + centering (so collapse → black, not a tiny image filling the pane).
- `ui2/src/components/views/IntegratedVolumeSurfaceWorkspace.tsx:73, 86-94` — orthogonal region is the half-width pane of a (default) horizontal split → tight width budget that trips the row collapse.
- `node_modules/.pnpm/allotment@1.20.4_.../allotment/dist/module.js:1050` (proportionalLayout default), `:1503-1516` (descriptor only when `defaultSizes`), `:1556` (children-add effect gated on `Y`), `:1648` (`onResize` flips `Y` and lays out `b ? height : width`), `:1020-1028` (per-orientation inline main-axis sizing), `:1183-1191`/`:1135-1153`/`:1271-1289` (`distributeViewSizes`/`layout`/`resize` clamp to `minSize`).
- `node_modules/.pnpm/allotment@1.20.4_.../allotment/dist/style.css:37-43` — cross-axis is CSS `100%`, main-axis is the inline `this.size`.
