# HiDPI slice rendering (2026-10-31)

Slice views are rendered and drawn at CSS pixels, so on a Retina display
every frame is upscaled 2× and looks soft. This note records how they are
rendered at device pixels without changing any geometry. It was approved by
the user. The implementation follows it.

## Rules

- **Effective ratio** `r = 2` when `devicePixelRatio >= 1.5`, else 1
  (`utils/renderPixelRatio.ts`). Only integer ratios are used, so the grid
  is exact: a 125 % display renders at 1× and a 150 % display at 2×.
  - The ratio is 1 during an interaction: a pane resize (FlexibleSlicePanel's
    ResizeObserver, which covers splitters, GoldenLayout and the window), a
    pan drag, a zoom step, or a window/level drag.
  - It returns to `r` 200 ms after the last one ends.
  - On window blur every interaction is ended (a safety net for missed end
    events). useWindowLevel also ends a drag on blur, on a hidden tab and on
    pointercancel.
  - Re-renders are upgrade-only. Each view remembers the ratio it was drawn
    at. A view below the effective ratio is redrawn, but only if it is on
    screen. A drop to 1× never forces a redraw: views render at 1× only when
    they change anyway.
- **Geometry stays in mm and in CSS pixels.** View planes in the view state
  (`origin_mm`, `u_mm`, `v_mm`, `dim_px`) are unchanged: one plane pixel is
  one CSS pixel. Only the render request gets a finer grid, through
  `hidpiPlane(plane, r)`. The origin is the same, `u/r` and `v/r` are used,
  and `dim_px = ceil(dim_px · r)`. The scale is uniform, so pixels stay
  square, and image pixel `(bx, by)` of the bitmap is plane pixel
  `(bx / r, by / r)` exactly. The ceiling adds less than one device pixel at
  the right and bottom edges, which the placement covers. `refitToPx` in
  `buildRequestedViewPayload` is then the identity.
- **The bitmap carries its ratio** (`tagBitmapRatio` / `bitmapPixelRatio`, a
  WeakMap). `drawScaledImage` returns the placement in **logical image
  pixels**: `imageWidth = bitmap.width / r`. Every image ↔ plane mapping
  (`sliceImagePointToWorld`, `worldToSliceImagePoint`,
  `CoordinateTransform`) then stays in plane pixels, whatever the bitmap's
  resolution.
- **The canvas backing store** is `round(css · cr)`, where `cr` is the
  canvas ratio (`r` at rest, kept during interaction). Its CSS size is
  unchanged. The ratio is recorded on the element (`data-pixel-ratio`).
  Placement `x/y/width/height` are in backing pixels, as they are today in
  canvas pixels. Every client → canvas mapping already scales by
  `canvas.width / rect.width`.
- **Overlays are drawn in CSS units.** ui2's `ReusableSliceViewport` runs the
  custom render, the border and the crosshair under
  `ctx.setTransform(cr, 0, 0, cr, 0, 0)` with the placement divided by `cr`.
  Line widths, dashes, halo, centre gap and pixel snapping are therefore the
  same in CSS pixels at every ratio, and lines stay crisp because a CSS
  half-pixel is an integer device pixel at 2×.
- **Opt-in per surface.** `SliceViewport` / `SliceRenderer` take `pixelRatio`
  (default 1).
  - These pass it: the orthogonal views (SliceViewCanvas), Compare panes and
    Mosaic tiles.
  - Studio panes rendered through StudioRenderAdapter (the Deck and Compare
    pane A, via FlexibleSlicePanel → SliceViewCanvas) are therefore HiDPI too.
  - Only `StudioDerivedPaneCanvas` (Compare B–D) and the Population surfaces
    stay at 1× until fw3-studio opts them in.
  - A Mosaic page renders at `r` while its tiles stay within 8 Mpx at that
    ratio, else at 1× (`mosaicRenderRatio`).
- **Export** keeps its own resolution logic and render calls, so it is
  unchanged. Copy view copies the last bitmap and so gets the finer one.
- **Backend:** no change. Render targets are checked against the device's
  `max_texture_dimension_2d` (`render_loop/src/lib.rs:4619`, 8192–16384),
  and 2 × a pane is far below that. Targets are pooled per size, 16 entries
  (`lib.rs:3941`), so the 1× and 2× sizes of three views fit. Readback is 4×
  the bytes at rest and 1× during interaction. `ui2/src/utils/dimensions.ts`
  `MAX_DIMENSION = 8192` clamps the pane's CSS size, not the render size.
- **Existing adaptive path:** `hooks/useAdaptiveResolution.ts` reduces only
  the registered `RenderContext.dimensions` (`useSliceViewModel.ts:142-159`),
  which no render path reads. Live renders take `view.dim_px`
  (`OptimizedRenderService.ts:248`). The ratio store replaces it for this
  purpose, and it is left in place.

## Consumers of `dim_px` and canvas pixels

| Consumer | File:line | Change |
|---|---|---|
| Orthogonal live renders | `services/OptimizedRenderService.ts:221,248` | View state scaled by `hidpiViewState(…, r)` for the request; bitmaps tagged with `r`; a change of `r` re-renders every view. |
| Compare pane render | `services/ComparisonRenderService.ts:410` | Plane scaled by `hidpiPlane`; bitmap tagged. The stored panel plane stays logical. |
| Mosaic tiles (single and batch) | `services/MosaicRenderService.ts:238,454` | Cell plane and per-slice size scaled; bitmaps tagged. `cellViewPlanes` stay logical. |
| Studio panes | `components/studio/StudioRenderAdapter.tsx` (HiDPI through SliceViewCanvas); `StudioDerivedPaneCanvas` / `StudioPaneRenderService.ts:145` and the Population surfaces | The adapter panes get HiDPI; the derived and Population panes stay at 1×, for fw3-studio to opt in. |
| Bitmap → canvas placement | `utils/canvasUtils.ts:70` (`drawScaledImage`), `hooks/useRenderCanvas.ts:102` | `imageWidth/Height` in logical pixels. |
| Canvas backing store | `components/views/SliceRenderer.tsx:201` | `width/height = css · pixelRatio`, CSS size set by style, `data-pixel-ratio`. |
| Crosshair, border, knock-outs | `components/views/sliceViewer/ReusableSliceViewport.tsx:107,119,124` | Drawn under the `cr` transform with a CSS placement; knock-outs divided by `cr`. |
| Mosaic crosshair and click | `components/views/MosaicCell.tsx:139,189` | Its custom render gets the CSS placement (drawn under the transform); click maps client px → CSS canvas px against it. |
| Click (shared viewer) | `packages/visualization/src/slice/useSliceViewerController.ts` | Unchanged: client → backing px (`canvas.width / rect.width`), backing placement, logical image px, plane. |
| Hover | `utils/slicePointer.ts`, `SliceViewCanvas.tsx:280` | Unchanged, same path as the click. |
| Frame geometry (colourbar image rect, crosshair point) | `SliceViewCanvas.tsx:439` | Unchanged: backing placement × `k = rect.width / canvas.width`. |
| Colourbar data rect | `SliceViewCanvas.tsx:480`, `ComparisonPanel.tsx:482` | Unchanged: `k` = CSS image width / backing placement width. |
| Compare image rect | `ComparisonPanel.tsx:466-468` | Unchanged (`rect.width / canvas.width`). |
| Zoom / pan anchor | `services/ViewZoomService.ts:62,84,147,172` | Works in **CSS (logical) pixels**: canvas size `round(canvas.width / cr)` (whole pixels for the backend's u32), anchor `clientToCanvas / cr`. A zoomed plane's `dim_px` is the CSS canvas size. |
| Zoomed plane resize | `ViewZoomService.syncZoomedViewSize` | Unchanged (CSS size). |
| Temporal heatmap | `components/views/TemporalHeatmapOverlay.tsx:93,130` | Backing store `css · cr` (CSS size by style); the transform maps to the backing placement as before. |
| Fit / resize / reframe | `utils/worldFrame.ts`, `stores/viewStateStore.ts` | Unchanged: they work in CSS pane pixels. |
| Export / copy | `services/export/*`, `services/ViewExportService.ts` | Unchanged. |

## Native checks

- Retina: slices sharp at rest; softer while dragging a splitter, panning or
  zooming, then sharp again.
- Crosshair 1 CSS px, still crisp.
- Clicks land where you click.
- A window dragged between a Retina and a 1× display re-renders at the new
  ratio.
