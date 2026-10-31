<!-- Parent: ./AGENTS.md -->

# Segmentation design summary (direction H)

This is the design the visual hill climb settled on (rounds 0 to 4, October
2026), written for the implementation, with the round-5 workflow states (AI
assist, lesions, contrast aids, history, save, resume, setup) after the
review section. The research and the six contracts
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

## Workflow states (round 5)

Round 5 extends H past tracing: eight states on the same shell (rail,
primary with two header lines and the slice ruler, orthogonal column,
Inspector, status bar), in `components/directions/h/workflow/`, rendered by
`DIRECTIONS.h.workflow` (`WORKFLOW_STATES`, direction H only). Captures are
in `cruft/hillclimb/segmentation/round-5/h/` with a manifest (decisions and
what is mocked per state). The rules are pure functions in
`components/shared/workflowRules.ts`, tested in `__tests__/round5.test.tsx`.

Rules every round-5 state follows, beyond the encoding rules above:

- **Sheets never cover the primary.** A sheet (AI licence, save, setup)
  takes the place of the orthogonal column and the Inspector (576 px; 524
  at 1366 and below) and the primary keeps its exact view. A notice about the
  whole session (resume) is a banner above the image that pushes it down.
- **Prompts and marks are neutral and told apart by form**, like the brush:
  no colour, no dash. Colour stays data.
- **Every proposal uses the one proposal grammar** (target label's colour,
  hatch, thin solid outline, crossed voxels for what it would not take),
  whatever made it: fill between slices or AI.
- **A view-only aid is announced by the view, not by the data.** Filters
  carry a badge derived from the image; lenses have a neutral rim; neither
  changes a label stroke, fill or hatch.
- **Outlines that point at voxels without changing them** (a hovered
  history step, the last edit) use the brush footprint's neutral outline.

### AI assist (`ai-prompt`)

Layout: the AI tool (shown only when a provider is configured) at the end of
the rail opens a 36 px **prompt sub-rail**: point +, point −, scribble, box,
lasso (keys 1–5; Alt makes a scribble or lasso negative). Header line 2 is
the prompt strip: target label, channel (the model takes one), crop in
voxels, "add only" (refining an existing label is opt-in), and an inline key
(include · exclude · kept). Below the image an AI bar like the proposal bar.
The Inspector adds an **AI assist** section (prompts placed, each removable,
channel, the model and licence line) above Labels; the slice matrix shows the
pending slices as hollow CA1 bars.

Rules:

- Prompts on the image: include is a filled neutral disc with a dark +,
  exclude a hollow ring with −, a scribble a solid neutral line with a start
  dot, all over a dark halo. Prompts on other slices are listed, not drawn.
- The answer is a proposal (hatch plus thin solid outline in CA1's colour)
  on the primary and in the orthogonal views, limited to the slices it spans.
- `gateProposal`: a proposal adds **empty voxels only**. Voxels another label
  holds (locked or not) are never taken; they are crossed in the image and
  counted by label in the bar ("8 vx kept in SRLM 6, Subiculum 2").
- "Confirm CA1 ↵" writes every slice of the answer; slices not yet looked at
  stay hollow "AI" bars on the ruler and in the matrix and are logged "AI,
  not reviewed" in provenance. The bar counts "3 of 9 slices seen".
- Prompt undo (⌥Z, "prompt undo · 4") re-asks the model; document undo (⌘Z)
  is separate and untouched. Discard drops the answer, keeps the prompts.
- Provider, version, "local" and latency sit in mono at the bar's right
  ("nnInteractive v2.5.0 · local · 0.84 s"); never a badge in the image.

Open questions: should Confirm be per slice (like fill between) when the
answer spans many unseen slices; how to show an answer still computing (3.5 s
worst case) without a spinner over the anatomy; whether the box prompt needs
a 3D extent; how a negative scribble reads without a dash or colour.

### AI licence gate (`ai-consent`)

Layout: a side sheet, "AI assist · before first use": 1 Server, 2 Model
weights licence, 3 What AI assist does, 4 Recorded in provenance; footer
"Use nnInteractive" (disabled until acknowledged), "Not now".

Rules:

- The local server (127.0.0.1) is the default and says "Nothing leaves this
  computer". The remote option always carries its warning (warning hairline
  and icon), naming what leaves (the crop around the target, the prompts) and
  what does not (labels, other images, file names, header text).
- The licence is the one the server reports (`session.license`), here CC
  BY-NC-SA 4.0; Brainflow never bundles or downloads weights.
- The gate is asked once per provider and licence version, and the
  acknowledgement (who, when, server, licence) goes into the provenance
  sidecar with every confirmed proposal; the record is shown as written.

Open questions: whether a lab administrator can pre-acknowledge for a
shared install; how a licence change on the server re-opens the gate
mid-session.

### White-matter lesions on FLAIR (`lesion`)

Layout: the same shell on an axial, isotropic grid. Primary: axial FLAIR
(mock), "Axial k 96/193 z 18.0 FLAIR (mock) · 1.0 mm iso". Header line 2:
"WMH · over background · range FLAIR 168–255 · 2D · ⌀ 5.2 mm · > 50% inside"
and the inline key for the left-out mark. Ruler in axial k. Orthogonal
column: coronal and sagittal cuts through the current lesion on the same
grid ("through L1 · grid", no reslice, no slab angle) with the axial slice as
a band. Inspector: session header, a collapsed protocol line ("Review each
lesion", 2 of 6 reviewed, the rule), **Range on FLAIR** (histogram with the
range, "limits writing, not display", what the brush writes now), and the
**lesion list** in place of the label list.

Rules:

- The intensity range is a constraint of the gate (like "over unlocked"),
  so it limits every tool, never the display window.
- The partial-volume rule replaces "centre inside" for lesion protocols: a
  voxel is written when it is in range **and more than half of it is inside**
  the disc (`rangeFootprint`, `PARTIAL_VOLUME_RULE`). The brush preview is
  exactly that set; in-range voxels the disc covers by half or less get a
  small hollow square ("in range, ≤ 50% inside: left out").
- One label (WMH) for all lesions; each connected lesion is a row. Rows come
  from the 3D mask's **26-connected components** (`components26`), so the
  list cannot disagree with the image; joining or splitting renumbers.
- Row: L-number, where (side and part), location class (PV
  periventricular, deep, JC juxtacortical), mm³, slice span, reviewed. The
  current row opens "Mark L1 reviewed ↵" and Remove; N / ⇧N step lesions.
- In the image the current lesion is the active label (1.5 px, inset fill),
  reviewed lesions quiet, the rest inactive, with an "L1" tag beside each
  (outside the lesion).
- Ruler: solid where every lesion on the slice is reviewed, hollow where
  one is not, hairline where there is none; the current lesion's span is
  bracketed "L1".

Open questions: 26- or 18-connectivity (protocols differ); whether the
location class should be computed (distance to the ventricles) or set by the
rater; a contour tool with the same > 50% rule for large confluent lesions;
how to review lesions smaller than the brush.

### Contrast aids (`contrast-aids`)

Layout: tracing, with the primary showing T2w through a view-only unsharp
mask; the badge after the geometry title (which still names the data,
T2w); flicker keys (V raw, Space T1w, ⌥ lens) at the right of header line 2;
the lens at the brush; a **View aids** section in the Inspector (filter with
its recipe, lens content, a note that edits map through the raw grid).

Rules:

- `filterBadge(image)`: the badge is derived from the image shown, so a
  filtered view always has it and an unfiltered one never does. It is a
  neutral outlined chip with an aperture glyph: "unsharp · view only"; the
  recipe (σ in mm, world-anchored, window) is in its tooltip and the
  Inspector. The status bar says "View T2w · unsharp, view only".
- Filters change image pixels only: label strokes, fills and hatches are
  unchanged, so a filter cannot be mistaken for an edit.
- The lens is a 136 px round window at the same scale and position under
  the brush tip showing T1w, with a neutral rim over a dark halo and the
  caption "T1w · 1:1" outside the rim; the active label's outline and the
  footprint continue through it.
- Hold-to-flicker swaps in place and returns on release.

Open questions: whether the lens should follow the brush or stay where it
was summoned; lens size against brush size; whether a protocol pack may turn
a filter on by default for a step (and how the badge then reads).

### History (`history`)

Layout: a bottom-dock tab under the primary and the orthogonal column
(History | Label statistics), 292 px. Left: the step list; right (300 px):
**Undo per label** and **Autosave**. The Inspector is unchanged.

Rules:

- Steps newest first: #, time, tool glyph, operation, label swatch and
  name, signed voxels, slices, seconds.
- A graph gutter draws the active line, the current step as a filled dot,
  and steps undone and then replaced as a **kept branch** (dimmed, hollow
  dots, "32′ 33′"), joining the line at its branch point; a branch is never
  discarded and can be restored.
- Hovering a step outlines its voxels in the primary with the neutral
  footprint outline and names it on header line 2.
- Undo per label (`undoForLabel`) reverts the label's latest step only on
  voxels no later step changed, and says what it keeps ("#30 · 15 vx · keeps
  3").
- Autosave states the journal's age and step, its size against the byte
  budget and minimum depth, the last save and steps since.

Open questions: how far back a hover preview can reach cheaply; whether
branch restore should be a full switch or a merge; whether per-label undo
belongs in the label row's context menu instead.

### Save and export (`save`)

Layout: a side sheet, "Save segmentation": 1 Label volume, 2 Label table, 3
Provenance, 4 Destination; footer Save (⌘S), Cancel, "5 files · replaces
nothing".

Rules:

- The label volume is always written: NIfTI-1, gzip, the smallest unsigned
  type that holds every id (`labelVolumeHeader`), intent 1002
  (NIFTI_INTENT_LABEL), on the reference grid voxel for voxel with its sform
  and qform kept.
- Label tables are opt-in per dialect (BIDS dseg.tsv, ITK-SNAP, FreeSurfer
  LUT) with a preview from the real writers; the parent column carries the
  hierarchy.
- Provenance: the sidecar (rater, protocol pack version, source hash, time
  on task split into navigation, drawing and correction, history, AI) and
  the per-voxel provenance volume, whose code table sums to the labelled
  voxels.
- The destination shows the BIDS derivatives layout and every file name
  that will be written; each is written through a temporary file and a
  rename.

Open questions: FreeSurfer ids that collide with FreeSurferColorLUT; whether
"accepted unreviewed" voxels should block or only warn at save; `.seg.nrrd`
and DICOM SEG placement in this sheet.

### Resume (`resume`)

Layout: tracing as it was, with a banner between the header and the image.

Rules:

- Everything that defines "where was I" is restored exactly (slice, label,
  brush, zoom, contrast window, protocol step, tool) and listed in one mono
  line under the recovery sentence.
- The banner names what was recovered and when ("Recovered 12 steps from the
  journal. Brainflow closed unexpectedly at 14:31:52; the last save was
  14:02.") and offers Keep recovered work (primary), Open the 14:02 save,
  Show changes.
- The last edit is outlined with the neutral footprint outline, tagged
  "last edit · 14:31" beside the structure, and marked "last" on the ruler.
- A normal reopen (no crash) uses the same restoration with a one-line
  neutral banner and no choice.

Open questions: whether the banner should dismiss itself after the first
stroke; how "Show changes" steps through recovered work (history hover?).

### Session setup (`setup`)

Layout: the image at fit beside a side sheet, "New segmentation": 1
Reference grid, 2 Label table, 3 New label; footer Start tracing, Cancel.

Rules:

- The reference grid is a choice with its consequence stated (labels are
  stored on it voxel for voxel; other images reslice for display).
- The label table comes from a protocol pack (its labels and parents
  previewed), an imported ITK-SNAP / FreeSurfer / dseg.tsv table, or empty.
- A new label has a name, the next free id, a parent (hierarchy) and a
  colour from a fixed palette. `colourCandidates` refuses any colour whose
  full colour or muted tints come within ΔE*ab 15 of an existing label's, or
  within ΔE*ab 25 of the crosshair or the warning colour; refused swatches
  are dimmed and crossed with the reason in the tooltip. A stroke preview
  shows the label active, inactive and quiet.

Open questions: whether ids should be editable at all (pack ids are fixed);
a colour-blind check for the palette; where hierarchy shows in the label
list (indent or a parent row).

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
