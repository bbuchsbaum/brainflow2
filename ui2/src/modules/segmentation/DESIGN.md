<!-- Parent: ./AGENTS.md -->

# Segmentation design summary (direction H)

This is the design the visual hill climb settled on (rounds 0 to 4, October
2026), written for the implementation, with the round-5 workflow states (AI
assist, lesions, contrast aids, history, save, resume, setup) after the
review section, as fixed in round 6 (one session model, per-slice AI
accept, plain-language sheets, quiet save, the lesion workflow raters use). The research and the six contracts
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

## Workflow states (rounds 5 and 6)

Round 5 extends H past tracing: eight states on the same shell (rail,
primary with two header lines and the slice ruler, orthogonal column,
Inspector, status bar), in `components/directions/h/workflow/`, rendered by
`DIRECTIONS.h.workflow` (`WORKFLOW_STATES`, direction H only); round 6 fixes
them and adds the `lesion-overview` variant. Captures are in
`cruft/hillclimb/segmentation/round-6/h/` (round 5 in `round-5/h/`) with a
manifest (decisions, what is mocked, and round 6's changes by critic issue).
The rules are pure functions in `components/shared/workflowRules.ts` and the
session model in `components/shared/session.ts`, tested in
`__tests__/round5.test.tsx` and `__tests__/round6.test.tsx`.

Rules every workflow state follows, beyond the encoding rules above:

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
  history step, the last edit, AI over-reach) use the brush footprint's
  neutral outline.
- **One session model** (round 6, `components/shared/session.ts`): the
  journal (steps, the kept branch, the last save), how every CA1 slice got
  its voxels (manual, interpolated or AI, reviewed or not), the ruler's
  marks, the matrix's hollow bars, the provenance code table, the history
  list and the recovered-step count all derive from it, as volumes derive
  from `LABEL_VOLUMES`. A state may show the session at an earlier step
  (`asOf`): the AI licence gate is the moment before AI was first used, so
  it carries no AI mark. Today: 17 steps since the 14:02 save (steps
  22–38), AI k 9 and interpolated k 12–13 confirmed without a look.
- **Plain language first**: a sheet says in one sentence what is recorded;
  the record itself is behind "Show record". Unselected options are one
  line; a section the user rarely changes is one summary line.
- **Captions on the image are halo text**, never chips (L tags, "last
  edit", the lens caption).
- **The island ring keeps its inline key** ("○ island", header line 2)
  wherever it is drawn; no other mark on the image is a circle (the lens is
  a square).

### AI assist (`ai-prompt`)

Layout: the AI tool (shown only when a provider is configured) at the end of
the rail opens a 36 px **prompt sub-rail**: point +, point −, scribble, box,
lasso (keys 1–5; Alt makes a scribble or lasso negative). Header line 2 is
the prompt strip: target label, channel (the model takes one), crop in
voxels, "add only" (refining an existing label is opt-in), and an inline key
(include · exclude · kept · check · island). Below the image an AI bar like
the proposal bar. The Inspector adds one line above Labels ("4 prompts ·
k 11 (3) · k 9 (1) · Reset"); the slice matrix shows the pending slices as
hollow CA1 bars.

Rules:

- Prompts on the image: include is a filled neutral disc with a dark +,
  exclude a hollow ring with −, a scribble a solid neutral line with a start
  dot, all over a dark halo. Prompts on other slices are listed, not drawn.
- The answer is a proposal (hatch plus thin solid outline in CA1's colour)
  on the primary and in the orthogonal views, limited to the slices it spans.
- `gateProposal`: a proposal adds **empty voxels only**. Voxels another label
  holds (locked or not) are never taken; they are crossed in the image and
  counted by label in the bar ("8 vx kept in SRLM 6, Subiculum 2").
- **Per-slice accept is the default** (decided round 6: AI is the less
  trustworthy source on subfields, so it must not get a looser gate than
  fill between), exactly as fill between:
  "Accept CA1 here ↵" writes the slice under review and steps to the next
  unseen slice of the answer, in order outward from the prompted slice
  ("then k 9"). "Confirm all 11…" is a quiet secondary that asks once more;
  slices it writes unseen are "AI, not reviewed": hollow "AI" bars on the
  ruler and hollow bars in the matrix, warned at save, and they block "Mark
  CA1 complete". The bar counts "3 of 11 slices seen". Pending slices on
  the ruler are "review", like any proposal; "AI" marks only confirmed,
  unreviewed AI slices.
- **Provenance codes** distinguish AI reviewed (4) and AI not reviewed (5),
  as interpolation does (2, 3); manual is 1.
- **Over-reach** (`workflowRules.overreach`): add-only protects labelled
  voxels only, so a proposal voxel that borders (8-neighbour) a label not yet
  complete, sits where the pack's k-matched prior puts such a label, or lies
  outside the target's expected k-range gets a separate review mark: the
  neutral voxel outline ("check" in the inline key) and "check 3 vx at
  Subiculum" in the bar. It never refuses; the rater decides.
- **AI said once**: the provider line sits only in the bar; the Inspector
  shows "4 prompts · k 11 (3) · k 9 (1) · Reset" (the marks are on the
  slice); the channel is a header-line-2 control only; the sub-rail has no
  heading; the status bar shows review progress, not the provider.
- The orthogonal views hatch the answer where it reaches past the traced
  extent (k 3–13), so its 3D reach shows.
- Prompt undo (⌥Z, "prompt undo · 4") re-asks the model; document undo (⌘Z)
  is separate and untouched. Discard drops the answer, keeps the prompts.
- Provider, version, "local" and latency sit in mono at the bar's right
  ("nnInteractive v2.5.0 · local · 0.84 s"); never a badge in the image.

Open questions: how to show an answer still computing (3.5 s worst case)
without a spinner over the anatomy; whether the box prompt needs a 3D
extent; how a negative scribble reads without a dash or colour.

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
  sidecar with every accepted slice. The sheet says so in one sentence; the
  record is behind "Show record".
- The unselected remote option is one line with its warning icon ("Leaves
  this computer: the crop and your prompts"); selecting it opens the URL,
  key and the full list of what leaves and what does not.
- The gate is shown at the session's moment before AI was first used
  (`session.BEFORE_AI`): no AI marks on the ruler.
- **Decided (round 6)**: a lab policy may pre-acknowledge for every rater on
  a shared install; each record then says "via lab policy (admin, date)",
  because the licence duty is the lab's and provenance must still name who
  used the weights. A licence change on the server blocks new prompts,
  keeps confirmed work and reopens the gate, because the old
  acknowledgement no longer covers the new terms but past work was made
  under the old ones.

### White-matter lesions on FLAIR (`lesion`)

Layout: the same shell on an axial, isotropic grid. Primary: axial FLAIR
(mock), "Axial k 96/193 z 18.0 FLAIR (mock) · 1.0 mm iso", with a "Fit (Z) |
L1 · 3.7×" zoom control. Header line 2: "WMH · over background · range
FLAIR 168–255 · 2D · ⌀ 5.2 mm · > 50% inside" and the inline key for the
left-out mark. Ruler in axial k. Below the primary a strip (200 px; 168 at
1366 and below): T1w and T2w at the same slice, centre and scale with the
lesion outlines, and the whole slice with every L tag and the primary's
window. Orthogonal column: coronal and sagittal cuts through the current
lesion on the same grid ("through L1 · grid", no reslice, no slab angle)
with the axial slice as a band and edge ticks. Inspector: session header,
a collapsed protocol line ("Review each lesion", 2 of 6 reviewed, the rule,
"26-connected"), **Range on FLAIR** (histogram with the range, "limits
writing, not display", what the brush writes now), the **seed** line
("LST-AI v1.1 · 4 of 6 to review", Import…), the **lesion list** in place of
the label list, and **Fazekas** (periventricular, deep; 0–3 each). The
`lesion-overview` variant is the same state at fit: the whole slice in the
primary with every tag, no brush and no range section.

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
- **WMH is outline only by default** (round 6): no inset fill over the
  hyperintensity being judged ("Outline only" shows as on; F held shows
  fills, at most the 0.10 inset). The brush preview is the only fill.
- **The rater edits a seed**: an automated mask (LST, BIANCA, SAMSEG) is
  imported and each of its components lands as an unreviewed row; the rows
  stay derived from the edited mask.
- **Each lesion has a type** (STRIVE: WMH, lacune, infarct, PVS, exclude),
  set in the open row with T1w and T2w in view; "exclude" keeps the row out
  of the totals.
- **Rows compare as graphics**: a span bar on the ruler's axial-k axis
  (k 113 left, as the ruler reads top down) with the current slice marked
  through every row, and a mm³ bar on one scale (its maximum printed once).
- **Fazekas** periventricular and deep are rated per subject beside the list.
- Row: L-number, where (side and part), location class (PV
  periventricular, deep, JC juxtacortical), mm³, slice span, reviewed. The
  current row opens "Mark L1 reviewed ↵" and Remove; N / ⇧N step lesions.
- In the image the current lesion is the active label (1.5 px, inset fill),
  reviewed lesions quiet, the rest inactive, with an "L1" tag beside each
  (outside the lesion).
- Ruler: solid where every lesion on the slice is reviewed, hollow where
  one is not, hairline where there is none; the current lesion's span is
  bracketed "L1".

Decided (round 6, the operator's answers):

- **Connectivity**: 26 on 1 mm isotropic FLAIR (FSL `cluster` and BIANCA
  count that way, so totals match the tools raters compare against); 18 on
  thick-slice 2D FLAIR (3 mm or more, or 2.5× the in-plane spacing), where 26
  merges diagonal neighbours across slices. A pack setting
  (`defaultConnectivity`), shown in the protocol line and recorded in
  provenance.
- **Location class** is computed (contiguity with the ventricles, the 10 mm
  periventricular rule, juxtacortical when it touches the cortical ribbon);
  the rater may override and the override is logged, because the computed
  class is reproducible and the rater still knows better at the margins.
- **Lesions smaller than the brush**: a one-voxel click toggles a voxel;
  components under 3 voxels (`SMALL_LESION_VX`) are flagged "check: noise or
  PVS?".

Open question: a contour tool with the same > 50% rule for large confluent
lesions.

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
- The lens is a 136 px **square** window (round 6: never read as the island
  ring) at the same scale and position under the brush tip showing T1w,
  with a 1 px neutral rim over a halo and the caption "T1w · 1:1" as halo
  text below the rim; the active label's outline and the footprint continue
  through it.
- Hold-to-flicker swaps in place and returns on release: V raw, T T1w
  (Space stays pan, as in most viewers), ⌥ lens.
- Strokes drawn with a filter on are recorded so in provenance.
- **Decided (round 6)**: the lens follows the brush while ⌥ is held and a
  pin keeps it where it is (following keeps the eye on the border; the pin
  serves a long look). A pack may turn a filter on for a step only with the
  badge reading "set by pack", so a filter is never on without its source
  being visible.

Open question: lens size against brush size.

### History (`history`)

Layout: a bottom-dock tab under the primary and the orthogonal column
(History | Label statistics), 8 rows (178 px, about a quarter of the primary
at 1440 × 900), resizable from its top edge and collapsible to its tab row;
label and k filters in its header. Left: the step list; then **Undo per
label** and **Autosave** columns. The Inspector is unchanged.

Rules:

- Steps newest first, from the session model: #, time, tool glyph,
  operation (with "n not reviewed" for a confirm-all), label swatch and
  name, signed voxels with a small signed bar on one scale, slices, seconds.
- A graph gutter draws the active line and the current step as a filled
  dot; steps undone and then replaced are a **kept branch**, one dimmed row
  ("32′–33′ Kept branch: AI, confirm all · 6 not reviewed") joining the line
  at its branch point; a branch is never discarded. **Restore… is a full
  switch** (decided round 6: a merge of two edit histories has no single
  meaning per voxel), and it warns that it brings back the branch's
  unreviewed AI slices.
- Hovering a step outlines its voxels in the primary with the neutral
  footprint outline and names it on header line 2.
- Undo per label (`undoForLabel`) reverts the label's latest step only on
  voxels no later step changed, and says what it keeps ("#30 · 15 vx · keeps
  3").
- Autosave states the journal's age and step, its size against the byte
  budget and minimum depth, the last save and steps since.

Open questions: how far back a hover preview can reach cheaply; whether
per-label undo belongs in the label row's context menu instead.

### Save and export (`save`)

**⌘S saves silently** (round 6) to the remembered path: the label volume,
dseg.tsv, the sidecar and the provenance volume, through a temporary file
and a rename; the session header then says "✓ Saved 14:33" until the next
edit (shown in the contrast-aids state, the moment after resume's "Keep
recovered work" and ⌘S). No sheet.

Layout: a side sheet, "Save as / export…" (⇧⌘S), for another place, other
dialects or a look: a draft warning when there is unfinished work, then
Label volume, Label table and Provenance as one summary line each (chevron
to open), one sentence of what is recorded with "Show record", and
Destination with the files; footer Save, Cancel, "4 files · status draft ·
replaces nothing".

Rules:

- The label volume is always written: NIfTI-1, gzip, the smallest unsigned
  type that holds every id (`labelVolumeHeader`), intent 1002
  (NIFTI_INTENT_LABEL), on the reference grid voxel for voxel with its sform
  and qform kept.
- **dseg.tsv is the only default table**; ITK-SNAP and FreeSurfer LUT are
  opt-in. The parent column carries the hierarchy.
- Provenance: the sidecar (rater, protocol pack version, status, a
  SpatialReference to the T2w, source hash, time on task split into
  navigation, drawing and correction, history, the provenance code table,
  AI) and the per-voxel provenance volume, whose codes (manual,
  interpolated reviewed / not, AI reviewed / not) come from the session
  model and sum to the labelled voxels.
- BIDS derivatives: `ses-` and a rater desc (`desc-subfieldsRaterA`) so two
  raters never collide; no `space-` entity (the grid is the T2w's own, named
  by the sidecar's SpatialReference); the provenance volume has its own
  suffix (`_provenance.nii.gz`) so `*_dseg.nii.gz` globs never pick it up.
- **Decided (round 6)**: accepted-unreviewed voxels **warn and save**
  ("Saved as a draft: CA1 incomplete · 3 slices not reviewed", status
  draft); they block only "Mark complete" and status complete
  (`saveCheck`), because losing work to a gate is worse than a draft that
  says what is unfinished.
- **Decided (round 6)**: the FreeSurfer LUT maps names to
  FreeSurferColorLUT ids (CA1 206, subiculum 205, fimbria 212, …) and never
  reuses a colliding id silently, so files open with the right names in
  FreeSurfer tools.

Open question: `.seg.nrrd` and DICOM SEG placement in this sheet.

### Resume (`resume`)

Layout: tracing as it was, with a banner between the header and the image.

Rules:

- Everything that defines "where was I" is restored exactly (slice, label,
  brush, zoom, contrast window, protocol step, tool) and listed in one mono
  line under the recovery sentence.
- The banner names what was recovered and when ("Recovered 17 steps from the
  journal. Brainflow closed unexpectedly at 14:31:52; the last save was
  14:02 (step 21).") and offers Keep recovered work (primary), Open the 14:02
  save, Show changes. The count is the session model's steps since the last
  save, the same number history and save show.
- The last edit is outlined with the neutral footprint outline, tagged
  "last edit · 14:31" as halo text beside the structure, and marked "last"
  on the ruler.
- A normal reopen (no crash) uses the same restoration with a one-line
  neutral banner and no choice.

Decided (round 6): after the first stroke the banner collapses to one line,
and "Show changes" stays until the next save, because the choice is made by
carrying on but the way back to the review should not vanish; "Show
changes" steps through the recovered steps with the history hover outlines.

### Session setup (`setup`)

Layout: the image at fit beside a side sheet, "New segmentation": 1
Subject and rater (subject, session, hemisphere, rater, and "Blind: hide
other raters' labels of this subject until I submit"), 2 Reference grid (two
choices beside a small sagittal T2w with the 20-slice slab drawn, k 20 and
k 1 at its ends), 3 T1w on the T2w grid (the rigid transform's file, a
checkerboard of T1w and T2w at the hippocampus, Checkerboard | T1w edges |
Flicker, and "Aligned at the hippocampus"), 4 Label table (the pack's
labels, "+ Add label" collapsed); footer Start tracing, Cancel.

Rules:

- The reference grid is a choice with its consequence stated (labels are
  stored on it voxel for voxel; other images reslice for display).
- The label table comes from a protocol pack (its labels and parents
  previewed), an imported ITK-SNAP / FreeSurfer / dseg.tsv table, or empty.
- A new label has a name, the next free id, a parent (hierarchy) and a
  colour from a fixed palette. `colourCandidates` refuses any colour whose
  full colour or muted tints come within ΔE*ab 15 of an existing label's, or
  within ΔE*ab 25 of the crosshair or the warning colour. The picker shows
  only the offered colours; the refused ones (dimmed, crossed, reason in the
  tooltip) are behind one line ("13 hidden: too close to existing labels,
  the crosshair or the warning colour"). A stroke preview shows the label
  active, inactive and quiet.
- Subject, session, hemisphere and rater name the files; the registration of
  the secondary contrast is confirmed before tracing starts.

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

Round 5 (the eight workflow states, direction H): Tufte 8, Jobs 7.8,
Operator 7 (the core states had been 8–8.5). Round 6 is the fix pass on
those states (captures in `cruft/hillclimb/segmentation/round-6/h/`, with a
manifest listing each change by critic and rank, the conflicts and what was
not done).

### Round 6 conflicts, decided

- History dock: Jobs and Tufte asked for about 6 rows; the operator asked
  for an overlay. Decided: a docked 8-row default (about a quarter of the
  primary), resizable and collapsible, because an overlay would cover the
  hovered step's outline in the primary, which is the point of the dock.
- Island key vs the lens: Jobs offered "hide the ring while the lens is
  held" or "key it". Decided: keep the ring and its key, and make the lens a
  square, so the two never share a form (Tufte also asked for the key).
- Over-reach marking: the operator asked to "count and outline"; Jobs asked
  to say less about AI. Decided: one neutral outline (the existing
  "points at voxels" grammar) and one count in the bar; no new colour, tag
  or badge.
- AI ruler marks before first use (Jobs, Tufte) vs showing the state "as
  it is now": the gate is shown at the session's own earlier moment
  (`asOf`), not with marks hidden, so the screen is still true to one model.

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
  into the primary, T to flicker T1w (Space stays pan; all tooltips only).
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
