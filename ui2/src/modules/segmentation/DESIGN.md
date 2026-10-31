<!-- Parent: ./AGENTS.md -->

# Segmentation design summary (direction H)

This is the design the visual hill climb settled on (rounds 0 to 4, October
2026), written for the implementation. The research and the six contracts
are in `docs/plans/segmentation-module-research.md`; the mocks are
`components/directions/h/DirectionH.tsx` and `components/shared/`. The mock
imagery is the 1 mm MNI152 template; the native 0.40 × 0.40 / 2.0 mm oblique
T2 geometry, the labels, rater B and every count are simulated.

## Layout

One Trace layout inside the existing shell (top bar, mode switcher, status
bar), from left to right:

- **Tool rail** (44 px). The step's tools first (navigate, brush, eraser,
  contour, fill between slices), then the others dimmed (allowed and
  logged), later-phase tools disabled. Review shows navigate only.
- **Primary view**: the native oblique coronal slice, square pixels,
  nearest-neighbour voxels. Header line 1: status chip (Tracing, Blocked,
  Proposal, Review · read only), geometry title, zoom, the Contrasts toggle,
  full-bleed. Header line 2: the constraint strip (brush controls) and a
  tiny inline legend (`── neighbour k 10 · ○ island`).
- **Slice ruler** (80 px) on the primary's right edge, in native slices k,
  anterior at the top, body-slab limits as hairlines, short horizontal
  captions beside each open run.
- **Orthogonal column** (240 px; 220 px at 1366 and below): axial over
  sagittal world-frame reslices, each with a gutter.
- **Inspector** (336 px; 304 px at 1366 and below), Segment mode.
- **Contrast strip** (multi-contrast layout only, 264 px): T1w, the unsharp
  lens and the pack example, at the primary's slice, centre and zoom.

### States

| State | What is on screen |
| --- | --- |
| Empty | Dimmed T2w and the start card: reference grid, label table, "New segmentation on T2w". Inspector lists the loaded images. |
| Tracing | Brush mid-stroke with its exact footprint; constraint strip; Inspector step card, checks, example, labels, slice matrix. |
| Multi-contrast | Tracing plus the contrast strip; the example moves from the Inspector to the strip. |
| Blocked | The refused footprint hatched in the warning colour; one card in the corner nearest the cursor that clears the structure ("Nothing painted: DG is locked", "Edit DG here", re-locks after the stroke); a Blocked chip. |
| Proposal | Fill between slices: added voxels hatched in CA1's colour with a thin solid outline; locked voxels skipped are crossed; a bar with per-slice review progress, "Accept CA1 here ↵", Discard, proposal undo and a subordinate "Confirm all 9…". |
| Review | Read only. Rater A once, rater B where it departs, disagreement textures; Inspector reconciles flagged regions, then the decision, then agreement. |
| Zoom | 6× with the voxel grid (dimmed to 7% while the neighbour line shows) and the size popover open. |

## Visual encoding rules

### Labels

- A label layer is an exclusive partition. Fills, when on, use one constant
  alpha (0.22, never above 0.25).
- Every label strokes the **inner edge of its own voxels**, so both sides of
  a shared edge show, each in its own colour.
- Emphasis while drawing:
  - **Active**: 1.5 px full colour between two dark halo rims, plus a faint
    fill (0.10) inset by one voxel. "Outline only" drops the inset fill; F
    (held) shows every fill.
  - **Inactive**: 1 px in the label's own **muted tint**, with the outer
    halo only.
  - **Quiet** (complete or locked): 1 px in a lighter tint still, outer halo
    only.
- **Muting is a tint, never alpha.** An alpha-blended line takes the colour
  of the tissue under it (in round 3, DG gold and SRLM orange both turned
  tan on mid-grey). The tint moves the label's CIELAB lightness toward 86
  (inactive 30%, quiet 40%) and scales its chroma (×0.70, ×0.60), keeping
  the hue (`components/shared/colour.ts`). Every pair of muted label
  colours differs by ΔE*ab ≥ 15 (tested; the closest pair is subiculum and
  ERC at 16.7).
- The palette avoids saturated green (the crosshair). SRLM moved to teal in
  round 4, the free hue between the crosshair green and CA2/3 blue (ΔE*ab 30
  from the crosshair, 74 from DG).
- Swatches, matrix bars and strokes use the same function
  (`mockData.labelTint`), so a muted label looks the same everywhere.
- Unlabelled voxels enclosed by labels get a neutral dot (a gap).
- **Islands** of the active label (pieces beyond its largest connected
  component on the slice) get a neutral 1 px ring with a halo, keyed inline
  as "island". The dot (gap) and the ring (island) differ in form.
- A **pack example** is drawn so it cannot be taken for the user's work:
  every boundary one neutral hairline over a light halo, the step's label a
  flat fill (0.40), no coloured strokes, no dashes, keyed "example".

### Line meanings

- **A dash means rater B and nothing else.** Neighbour slices, proposals,
  ruler marks and examples never dash (tested in every state).
- **Neighbour slice**: 1 px neutral at 35%, no halo, drawn only where it
  departs from the current slice by more than one voxel.
- **Proposal**: the target label's colour, thin solid outline plus a hatch.
  The hatch means "proposed" and is never used for disagreement.
- **Brush footprint**: the exact voxel set the brush writes (voxel centre
  inside the disc), a 0.16 preview fill in the label's colour, a 1 px
  neutral outline over a halo, and a centre tick. No circle.
- **Refused stroke**: the footprint hatched in the warning colour.

### Hatching and textures

- Colour hatch: a proposal (label colour) or a refused stroke (warning).
- Achromatic textures, review only, told apart by form: A only = dots, B
  only = dense hatch, relabelled = crossed.
- A label rater B never traced is outlined only (no "A only" texture), with
  a direct "ERC · B: none" tag in the image and "B: none" in the table.

### Crosshair

- Green (`--bf-crosshair`) solid hairline with a light dark halo,
  independent of the accent.
- While a paint tool is active it opens a gap of at least three brush radii.
- In direction H it stays out of the edited structure's extent in every
  state (a clear box), leaving margin segments outside it.
- Small tiles (the contrast strip) show it as edge ticks only.

### Geometry headers

- The primary is named by native slice: "Oblique coronal k 11/20 T2w native
  ⊥ long axis · 0.40×0.40 / 2.0 mm"; the world centre is in the tooltip.
- Orthogonal views say they are world-frame reslices and give the slab
  angle ("world frame · slab ∠12°"; "world · ∠12°" at 1366 and below).
- The brush readout states what it writes natively: "⌀ 3.0 mm = 7 native vx
  (3 drawn)".
- Label volumes show mm³ on a 1 mm grid, and vx plus mm³ otherwise; every
  volume comes from one source (`LABEL_VOLUMES`).

### Orthogonal views

- Only the **active label** is drawn (constant fill plus its outline), so
  its continuity across k reads at a glance.
- The hippocampus fills 80% of the panel; a 56 px whole-slice locator in the
  corner shows where the view is in the brain.
- The primary's native slice is a band (14%) within 9 mm of the crosshair,
  plus short tilted ticks where its plane meets the frame, so the tilt is
  visible outside the anatomy.
- A gutter (bottom in sagittal, right in axial) carries one tick per native
  slice (the current one longer), the head | body | tail limits as full
  ticks, and the zone names between them. No label sits over anatomy.

### Slice ruler

- Tracing and proposal: a solid bar is done, a thin hollow bar needs review,
  a hairline is empty; "key" marks keyframes.
- Review: a solid ▲ is a flagged slice whose regions are decided, a hollow
  △ is still to decide.

## Inspector

Top to bottom, while tracing:

1. **Session header**: file, grid and save state, rater.
2. **Step card** (collapsed): the step name with its label swatch, "step
   6/9" and a progress bar; the rule for the next open check wraps under it
   (two lines, never an ellipsis); every rule is behind the chevron.
3. **Step next**: the k-matched pack example (112 px, click to enlarge),
   all three checks (done ones ticked, no fraction), and "Mark CA1
   complete" (disabled until the checks are done).
4. **Labels**: one row per label with swatch, id, name, volume, a single
   status glyph, and a lock only where it departs from the status
   (otherwise on hover). Actions: Outline only, Neighbour, New label.
5. **Area by native slice** (the slice matrix):
   - One row of bars per label on one shared k axis, anterior (k 20) on the
     left as the ruler reads top to bottom, k 11 marked through every row.
   - **One common scale**, its maximum printed once in the caption ("one
     scale · max 123 vx").
   - Shown: the active row and every row with a flagged problem. The rest
     sit behind "Show all labels (n more)".
   - Behind each row a faint band is the pack's expected k-range.
   - Warning ticks above a slice flag a **gap** (empty between traced
     slices), a **jump** (adjacent slices differ by more than 40% of the
     larger, both at least 5 vx), a slice **outside** the expected range,
     and, for complete labels, a slice **missing** inside it. The row's end
     names them ("out · jump ×3").
   - A small ring under a bar marks a slice where the active label has an
     island.
   - A pending proposal shows in the active row as hollow bars, filled as
     each slice is reviewed.
   - Every slice is a button: hover highlights it, a readout line names it,
     click goes there.

In review the Inspector is ordered for the decision: flagged regions, then
the note and Return/Approve, then agreement (Label · Dice · Δ B−A) with A
mm³, HD95 in-plane and through-plane, disagreement by slice and the texture
legend behind one disclosure.

## Review and reconciliation

- Disagreement regions are flagged when they touch a protocol landmark or
  are at least 15 vx (`FLAG_MIN_VX`); flagged first, then by size.
- Flagged disagreements are grouped into **regions**: one label at one
  landmark ("SRLM · medial end", k 9–11, 14), or one label's large
  departures ("CA1 · ≥ 15 vx").
- Each region is decided once: **Keep A** (1), **Take B** (2) or **Edit**
  (E), applied across the region's slices and logged. The region being
  reconciled is open, showing its slices (visited ones ticked, the one under
  the cursor bold) and the three actions; decided regions show "Kept A",
  "Took B" or "Edited".
- **Return to rater B** is the default (primary). **Approve** stays
  disabled until every flagged region is decided; the only progress count
  sits beside it ("1 of 3 regions decided"). The ruler's triangles fill as
  regions are decided.
- In the image: rater A once (solid, label colour), rater B only where it
  departs (mid-grey dash), disagreement textures, a comment pin, and the
  crosshair kept out of the region under review.

## Niceties adopted

From the backlog in the research plan ("Tracing niceties backlog"):

- Neighbour outline (item 1), as a faint neutral line where it departs,
  not a dash.
- Area by slice per label (2), as the slice matrix with expected ranges and
  flags; clicking a slice jumps there.
- Slice ruler with status (3) and keys to the next gap or unreviewed slice.
- Crosshair that yields (9), plus the clear box.
- Review interpolation as you go (12): per-slice accept, Enter steps on.
- Alt-click picks a label (15), named in the constraint strip's tooltip.
- Consistency hints as quiet marks (16): islands, gaps, area jumps and
  out-of-range slices, never blocking dialogs.
- Geometry in every panel header and a native brush readout (17).
- Also: the constraint gate explains a refused stroke once, at the cursor,
  with a temporary unlock; proposal undo separate from document undo; the
  k-matched pack example; a step card with checks.

## Score history

Overall score per critic and round (R0: best of the three directions; R1
onward: direction H).

| Critic | R0 | R1 | R2 | R3 |
| --- | --- | --- | --- | --- |
| Tufte (data-ink, encoding) | 7 (A) | 8 | 8 | 8 (high) |
| Jobs (focus, simplicity) | 7.5 (C) | 7.5 | 8 | 8.5 |
| Operator (tracer efficiency) | 7.5 (A) | 8 | 8 | 8 |

Round 0 scores for all directions: Tufte A 7, B 6, C 6; Jobs A 6.5, B 6.5,
C 7.5; Operator A 7.5, B 5, C 7. After round 3 all three critics judged
further static rounds of marginal value; round 4 was one targeted static
pass on their "static" items (captures in
`cruft/hillclimb/segmentation/round-4/h/`), not scored.

## Open questions for an interactive prototype on real 0.4 mm data

These cannot be settled from stills or on 1 mm template imagery. Build a
clickable prototype on a real native T2 hippocampal subfield dataset and run
a timed tracing session.

**Legibility on real data**

- Do the 1 px / 1.5 px stroke hierarchy, the halos, the 0.10 inset fill and
  the 35% neighbour line hold on low-contrast 0.4 mm T2 (Tufte r3 #6)?
- Do shared edges still read as bundles of parallel lines; if so, drop the
  inner rim on the active label too (Jobs r3 #3)?
- Do the muted tints stay separable on real tissue, and is a 1 px tinted
  line visible enough for complete labels?
- Do the orthogonals hold on anisotropic oblique data: the stair-stepping
  of 2 mm slices, whether the 80% fit and the locator give enough place
  (Jobs r3 #4, Operator r3 #2)? Should the second view be resliced along the
  long axis so each k is a column (not mocked)?
- How should a real pack's example look (Tufte r3 #5)? The hairline-plus-
  fill style is mocked with the template's own labels.

**Interaction and flow**

- Brush and push feel, snap to shared edges, edge-aware brush and latency
  at 0.4 mm (Operator r3 #6; backlog items 4, 6, 7, 11).
- Held-key behaviours: F for fills, "," for k 12, X to flicker the example
  into the primary, Space to flicker T1w (all tooltips only).
- Does the blocked card fade, and when (Jobs r3 #6)?
- Do checks tick themselves when the rule is satisfied, and does "Mark CA1
  complete" open the full matrix for a last look?
- Does Approve become primary after the last region is decided; how fast is
  stepping through flagged regions with N and 1/2/E; should B's departure
  draw at full colour while a region row is hovered (Operator r3 #4)?
- Clicking a matrix slice or a ruler mark to jump, and keys U (next
  unreviewed) and ⌥↓ (next gap).
- Step-aware contrasts: turning T1w on for steps whose rule cites it
  (Operator r2 #6).
- Whether the islands of other labels should be marked too, and how
  islands that are real anatomy are dismissed.
