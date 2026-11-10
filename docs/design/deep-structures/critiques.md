# Deep-structure view: design hill climb

A visual hill climb on the hybrid cortical-surface and deep-structure view,
run 2026-11-10 with the kit in `tools/design/hillclimb`. Three critics scored
screenshots each round: Tufte (data-ink and encoding), Bostock (representation
and interaction) and a neuroimaging specialist. The reference screens are in
[`reference/`](reference/README.md); the working captures and full critiques
are in the ignored `cruft/hillclimb/deep-structures/`.

These are design mocks. The brain images and numbers come from public data
(HCP group z map for working memory 2-back minus 0-back, MNI152NLin6Asym,
Harvard-Oxford subcortical labels, fsLR 32k surfaces, HippUnfold surfaces)
rendered offline by `tools/design/deep_structures`. Nothing was rendered by
Brainflow's WGPU or three.js code, and nothing is interactive.

## The design that came out

One screen, the "Deep" layout:

- **The object.** Cortex and white matter are cut by a plane the user moves.
  The selected structure and its neighbours are not cut: they stay whole and
  come through the face, coloured by their own sampled values. A green ring
  marks where the plane crosses the selected structure. The long axis is drawn
  through the object with stop ticks and a handle.
- **One section language.** Wherever a plane meets the brain, cortex is the
  midthickness contour coloured by surface values, deep structures are
  nearest-neighbour map voxels inside atlas outlines, and other tissue carries
  only thin signed threshold contours. The face of the 3D object, the flat
  face, the zooms and the crops are all drawn this way.
- **The face and its zooms.** The cut face is shown flat with named
  structures, and enlarged left and right (or one bilateral zoom for a pair
  that meets at the midline) at a stated enlargement.
- **The dock.** With template surfaces (hippocampus): per hemisphere, the
  unfolded sheet with atlas subfield lines, the trace of the cut and of the
  other stops across it, a brushed interval, a subfield dot plot, and the
  sheet's own column mean beneath on the same axis. Without them (thalamus,
  native data): a long-axis section and a mask-mean profile on one millimetre
  axis.
- **The table.** Every labelled structure with a profile along its own axis,
  the share beyond threshold, and left and right means.

The cut plane for the hippocampus is perpendicular to a common hippocampal
long axis (38 degrees from coronal in this template), so one position serves
both hemispheres and indexes the sheet.

## Score history

`overall` per critic; half points allowed; 8 means ship with small fixes.

| Round | What was judged | Tufte | Bostock | Neuro |
| --- | --- | --- | --- | --- |
| 0 | Three directions: Cut / Sheet / Sections | 5.5 / 4.5 / 6.5 | 5.5 / 4.5 / 7 | 5.5 / 4.5 / 6.5 |
| 1 | Hybrid: cut object, section language, sheet with marginals | 7 | 7.5 | 7.5 |
| 2 | Cortex cut, structures whole; thalamus state added | 7.5 | 8 | 8 |
| 3 | Cleanup of the round-2 punch list | 8.5 | 8.5 | 8.5 |

Round 3 by state: hippocampus 8.5 from all three; thalamus 8.5 (Tufte), 8
(Bostock), 8 (Neuro). After round 3 every critic set
`more_static_rounds_useful` to false. A final targeted pass followed and was
not re-scored.

## What each round decided

- **Round 0.** All three critics ranked Sections first, Cut second, Sheet
  third, and proposed the same fusion: keep the cut object, draw its face in
  the Sections language, and move the unfolded sheet off the brain into the
  dock above its profile. Placing nuclei on the inflated medial wall was
  rejected as implying false positions.
- **Round 1.** The hybrid beat every round-0 direction. The critics' shared
  push was "cut the cortex, not the structure", plus one long-axis unit and a
  camera that shows surface running into the rim.
- **Round 2.** Structures whole through the face; graticule of cut positions
  on the sheet; crops tied to it; sparkline table; thalamus as the
  no-template case. Two critics called static work done.
- **Round 3.** One statement of grids and counts, a rectangular brush shared
  by sheet and profile, one bilateral zoom for midline pairs, the camera
  framed on the deep structures, leaders that cross nothing.

## Decisions worth keeping

- The sheet's long axis is the HippUnfold intrinsic coordinate. Projecting
  vertices onto the straight axis folds the sheet over itself at the head, so
  millimetres along the straight axis appear as curves across the sheet and as
  an uneven tick row, not as the sheet's scale. The sheet is in unfolded
  template units and says so.
- The cut is perpendicular to the hippocampal long axis by default when the
  hippocampus is selected, and coronal for the thalamus.
- One thresholded colour scale everywhere, including the sheet; sub-threshold
  marginal values are greyed.
- Structure meshes are sampled 2 mm inside the mask boundary and drawn nearly
  unlit, because the scale orders magnitude by lightness.
- Counts are volumes on the label grid with approximate map voxels beside
  them; the map is 2 mm, the labels 1 mm.

## Data checks made during the climb

Critics twice flagged pairs of values as suspiciously equal. Both were real:

- Thalamus and putamen left and right mask means agree to two decimals
  (1.328 and 1.334; 1.828 and 1.834). The group map is near-symmetric there.
- CA2 and CA3 ribbon means agree to one decimal (left -5.40 and -5.38; right
  -4.45 and -4.42). They are now printed to two.

The hippocampal mask mean (-4.86, -3.94) and ribbon mean (-4.31, -3.39)
differ by 0.55 on both sides. They are computed by different code over
different supports (Harvard-Oxford mask voxels against HippUnfold ribbon
vertices), so a difference is expected; the equal gap was not investigated
further.

## Open static items

Small fixes to fold into the prototype build:

- The position label on the object still collides with a structure name in
  the thalamus state.
- The 8 mm and -2 mm stops have crops but no labelled curve where the sheet
  folds at the head.
- A hard-edged sub-threshold hole at the lower left of both sheets is not
  explained as sub-threshold or missing ribbon.
- The share bar pools hemispheres; lateral stop ticks are unlabelled; the
  brush is not drawn on the crops, the object or the laterals.
- The embedded part of a structure and the part standing out of the face look
  the same; non-selected structures have no plane-crossing line.
- Some neighbouring atlas outlines in zooms and sections are unnamed.

## Prototype checklist

What stills could not settle, from the critics' interactive and real-data
issues and the neuroimaging specialist's priorities:

1. Drag the cut along the axis: ring, sheet trace, crop highlight, lateral
   trace and status readout move together with no frame of disagreement.
2. Scale truth on the sheet: tissue distance from the folded mesh against the
   millimetre ticks and the brush summary, including the head where the trace
   is multi-valued.
3. One subject in native space with subject HippUnfold surfaces: ribbon mean
   against voxel values at the fissure and temporal horn, coverage per
   vertex, and whether subfield means survive at 2 mm.
4. Sampling modes: nearest-voxel faces, flat per-vertex colour on meshes and
   sheet, inward-offset sampling; the same location gives the same value in
   every view and the status bar.
5. Caudate and putamen: curved centreline axis, section perpendicular to it,
   profile along arc length.
6. Volume-only data and inflated cortex: the view degrades to face plus
   structures with a stated reason.
7. Brush linked to every view, with its summary in map voxels.
8. The selected structure stays visible and at least about 120 px across for
   every structure and cut position.
9. Fold-to-unfold morph with vertex identity kept, if the sheet and the mesh
   are to be read as one object.

## Feasibility notes for implementation

Checked against the code during planning, not built:

- The surface view is three.js through SurfView. It has no clipping-plane
  option today; three.js materials support clipping planes, so the cut needs
  an adapter change in `packages/visualization/src/surface`, not a new
  renderer.
- The slice renderer already draws arbitrary oblique planes and label
  outlines; the cut face is a slice at the plane's frame.
- Drawing surface values as a contour on a slice needs a mesh-plane
  intersection and a line overlay on the shared `SliceViewport`.
- No mask-to-mesh code exists; the nuclei need one.
- Volume-to-surface projection with thickness sampling exists and covers the
  hippocampal ribbon.
