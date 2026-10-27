# UI redesign phase 2: viewport frame and shared primitives

Follows `docs/plans/ui-redesign-2026-10.md`. Phase 1 is complete at v5b; critic
means went from 4.6–5.5 at baseline to 7.75–8.0. Phase 1 settled the colour,
state and type systems. Two critiques remain. The viewports lack a sense of
being an instrument: they are bare black rectangles, the slider bars are 32px
grey, and there is no scale on the image. And the components that implement
the rules are still duplicated, so the rules can drift. This phase addresses
both, in this order.

## Constraints

- Frozen, per `.hillclimb/redesign/FROZEN.md`:
  - slice pixels and colormaps;
  - crosshair positions, click-to-world mapping and readouts;
  - square pixels and the shell structure.
  - Image area may grow when chrome shrinks, but the existing geometry code
    must still compute the placement.
- The direction rules in HYBRID.md and V5.md still apply.
- Workflow: branch `ui/redesign-p0`, then `ui/redesign-p2`; one commit per
  accepted round; a fresh-context code review before merge.

## A. ViewportFrame

This is one wrapper around `SliceViewport` for the orthogonal, compare, Studio
and mosaic views.

1. **Header overlay:** plane, slice position in mm and the active layer name.
   - It is drawn as an overlay inside the canvas margin. It does not take
     layout height, so slice placement is untouched.
   - It is hidden when the view is smaller than about 140px.
2. **Rail scrubber:**
   - A 4–6px rail with a hover-expanding thumb replaces the 32px
     `SliceSlider` bar.
   - It keeps the accessible name and value text added in v5.
   - It has keyboard step, page step, Home and End.
   - The image gains the freed height through the existing fit logic.
3. **On-image colorbar:**
   - Optional, and on by default when an overlay layer is selected.
   - Built from the layer's colormap, window and threshold, with tick labels,
     units when known, and the threshold cut-out marked.
   - Threshold wording reads "|value| < 2.3 hidden".
   - It shares the formatting helpers with the Inspector strip.
4. **Mosaic:**
   - a z-mm label per tile;
   - no inner box;
   - optionally, tiles cropped to the reference brain bounding box. This goes
     through `mosaic/sliceGeometry.ts`, so slice spacing is preserved.
5. **Crosshair carry-over:**
   - letter knockouts in Compare and the Studio lens views;
   - an optional centre dot;
   - export (`ViewExportService`) draws the same canvas crosshair instead of
     the GPU tick.

## B. Shared primitives

New primitives live in `ui2/src/components/ui/bf/`. None needs a React context
provider (GoldenLayout panels each have their own React root). Each one renders
on a `primitives-harness.html` gallery that shows every state.

| Primitive | Replaces |
| --- | --- |
| `Tabs` (flat) | 4 implementations (GoldenLayout-styled, Files view, dock, BIDS) |
| `SegmentedControl` (joined; hidden when there is only one option) | top bar, Studio lens, plot modes, Go-to, crosshair styles |
| `Slider` (single + range, named, value text) | 8 implementations |
| `Section` (collapsible) | 7 implementations |
| `FieldRow` / `KeyValue` | 7 implementations |
| `SelectableRow` (selection edge + focus ring contract) | tree, scene stack, cards |
| `StatusPill` (generalised from `JobStatusPill`) | status chips |
| `Chip` | ad-hoc chips |

`Button`, `IconButton` and `Link` already exist and are kept.

Migration goes one area at a time: Inspector, then dialogs, then plots, then
Studio, then BIDS and analysis, then Files. Each old implementation is deleted
once it has no callers.

## C. Ratchet

ESLint `no-restricted-syntax` errors in migrated areas on:
- raw Tailwind palette classes;
- `text-[Npx]`, `uppercase`, `tracking-[`;
- hex values in JSX styles;
- raw `--bf-accent` outside the primitives;
- raw `<input type=range>` and hand-rolled `role=tablist`.

An allowlist that only shrinks covers the areas not yet migrated.

## D. Harness and gate

New scenarios:
- `compare`;
- `overlay-colorbar` (colorbar visible);
- `keyboard-focus` (a focused tree row, a focused segmented control);
- the primitives gallery.

Then add a Playwright `toHaveScreenshot` project over the harness specimens, as
a regression gate for future changes.

## Hill climb

- New series. Baseline is v5b plus the new scenarios. Budget is the baseline
  plus 3 rounds for each of A and B.
- Same critics, same rubric, plus a check on primitive consistency.
- The monitoring artifact continues on the same page.

## Order

1. A1, A2, A3 and D (new scenarios), then a round.
2. A4 and A5, then a round.
3. B (gallery first, then migrations), then rounds.
4. C, then the D gate.

## Native check

Before merging, do one native `.app` session (see the memory note on verifying
the dev app through the `.app` bundle):
- confirm the renderer change (`crosshair.visible=false`);
- look at the frame, scrubber and colorbar on real GPU output.
