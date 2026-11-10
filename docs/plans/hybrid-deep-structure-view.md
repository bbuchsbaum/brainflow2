# Hybrid cortical surface and deep-structure view

Status: design proposal, 2026-11-09. Nothing here is implemented. Capability
claims about existing code were checked by reading the repository; claims marked
**to verify** were not.

## Goal

Show a volumetric map on the cortical surface and inside deep structures
(hippocampus first; amygdala, thalamus, striatum by the same mechanism) in one
workspace, so that a researcher can locate a deep effect anatomically, read its
distribution along the structure, and compare it with the cortical pattern
without changing layouts.

The starting proposal (cortical overview, enlarged hippocampal panes with a
movable section, a local "Reveal" cutaway, optional unfolded maps, an exploded
presentation mode) names the right three problems: occlusion, scale and interior
values. This plan keeps its layout principle and its trust rules, and changes how
each problem is solved so that it fits what Brainflow already has.

## What changes from the starting proposal

| Starting proposal | This plan | Why |
| --- | --- | --- |
| Hippocampus-specific panes | Panes generated from any label in an atlas or segmentation layer | `freesurfer_aseg` and `olsen_mtl` are already registered atlases. A structure is a label mask, so thalamus and striatum cost nothing extra, and a subject's own segmentation works in native space. |
| 3D envelope with a section plane as the main detail view | Oblique slice panes from the existing slice renderer, with the label outline as the envelope | The renderer already draws arbitrary oblique planes and label outlines. Values are read on a section in any case; a mesh is not needed to ship the first version. |
| One movable section, montage later | Long-axis strip of sections plus a long-axis profile plot, from the start | Anterior-posterior distribution is one of the three acceptance tasks. A profile answers it directly and gives a quantitative, exportable summary. |
| "Reveal": a cutaway window through opaque cortex | The medial wall is the window: drop the medial-wall triangles in the medial view and draw the deep structures in place | The surface renderer has no clipping planes and no per-mesh opacity. The medial wall carries no cortical data, so removing it hides nothing and needs no cutaway rendering. |
| Unfolded hippocampal sheet as a later option | Hippocampal surfaces as an ordinary surface family (folded and unfolded), sampled with the existing ribbon projection | Brainflow already morphs between corresponding geometries of one family and projects volumes through a thickness ribbon. |
| Exploded "separated brain" presentation mode | Dropped | It alters spatial relationships and scale, still needs sections for interior values, and needs per-mesh transforms the renderer lacks. The export layout below covers presentation. |
| Shared colour scale stated as a rule | Shared display recipe made a prerequisite | Today a surface projection copies the colormap once at creation and then drifts from its source volume. |

## Design

### 1. Workspace layout

A fixed arrangement, in one workspace:

- **Cortex** (dominant): the existing surface view. On wide displays, lateral
  and medial views of each hemisphere; otherwise one rotatable view.
- **Structure dock** (stable position, below or beside): one card per selected
  structure, left and right at the same millimetre-per-pixel scale, each
  labelled with orientation. Left and right are not mirrored by default; a
  mirror toggle labels itself when on.

The dock never rearranges when the map, threshold or time point changes.

### 2. Structure cards: label-driven oblique sections

A structure is defined by `(label layer, label id)`. From the mask Brainflow
computes, once, and caches:

- the world bounding box, padded by a margin so adjacent tissue stays visible;
- the long axis, as the first principal axis of the voxel-centre coordinates;
- the extent along that axis, normalised to 0 (anterior end) to 1 (posterior).

Each card shows:

- **Long-axis view**: an oblique plane containing the long axis, with a tick
  marking the current section position.
- **Cross-section**: the plane perpendicular to the long axis at the current
  position, drawn large.
- **Section strip**: evenly spaced cross-sections as small multiples.
- **Long-axis profile**: mean value inside the mask at each position, with the
  count of valid voxels drawn underneath. Left and right share one axis.
  Clicking the profile moves the section.

The anatomical underlay and the label outline come from the label layer, so
raising the statistical threshold never changes the apparent shape of the
structure. A "voxels" toggle switches the map layer to nearest-neighbour
sampling so coarse functional resolution stays visible under a fine anatomical
outline.

A straight long axis is the first version. A curved centreline is a later
refinement and needs its own reslicing contract.

### 3. The medial wall is the window

In the medial preset the other hemisphere is already hidden. The medial wall of
a cortical surface is a closing patch with no cortical data, and the
hippocampus, amygdala and thalamus lie immediately behind it. So:

- remove the medial-wall triangles from the displayed mesh in that view (an
  index-buffer filter; the vertices and all data layers are untouched);
- draw the deep-structure meshes at their anatomical position and scale in the
  opening, coloured with the same map;
- draw a thin neutral rim at the cut edge so the opening reads as deliberate.

Nothing cortical is hidden, no colours blend through transparency, and the
connection between detail and anatomy is permanent, not a mode. Selecting a
point in a card places the usual snapped crosshair marker in this view. A
"locate" action briefly emphasises the structure and then settles.

This applies to anatomical geometry only. On inflated or spherical geometry the
opening is not shown; the cards remain and a small anatomical locator replaces
the in-place view.

**To verify:** that a medial-wall mask is available for each supported surface
template, and how much of the hippocampus is visible through the opening from a
straight medial camera. If the view is poor, an inferior-medial preset is the
fallback before considering any cutaway.

### 4. Hippocampal sheet as a surface family

The `khanlab/hippunfold-templateflow` repository (MIT licence per its sidebar)
provides, for eight MNI152 variants including NLin2009cAsym and NLin6Asym,
hippocampal inner, midthickness and outer surfaces and a dentate midthickness
surface at three densities, with corresponding vertices, plus subfield
segmentations. In Brainflow these load as GIfTI and become:

- the in-place meshes of section 3, when the volume's template matches;
- a surface family whose second geometry is the unfolded sheet, so the existing
  geometry switch morphs folded to unfolded;
- a projection target for the existing `thickness` sampling between inner and
  outer surfaces.

Unfolded maps sit in the dock as a card variant. A point picked on the unfolded
map resolves through the shared vertex to the folded position and world
coordinate.

Subfield boundaries drawn from these assets are labelled as atlas boundaries.

**To verify:** the repository's README does not state whether unfolded-space
geometry is included. If not, the standard HippUnfold unfolded mesh at matching
density has to be bundled separately. Structures without template surfaces need
a mesh from the label mask; no isosurface code exists in the repository today.

### 5. Trust rules

These are requirements, not polish:

- **One display recipe.** Colormap, limits, threshold and time point are owned
  by the source volume layer. Surface projections and structure cards read it
  live. No per-panel automatic scaling.
- **Exact template identity.** Template assets are offered only when the volume
  declares a matching template (for example `MNI152NLin2009cAsym`). The current
  coarse "MNI" tag is not sufficient; the user confirms the variant once per
  volume when it cannot be read from metadata. Without a match, cards still
  work from a label layer in the volume's own space.
- **Missing differs from sub-threshold.** Non-finite samples and voxels outside
  the source mask get a neutral hatch in the cards; below-threshold voxels show
  the underlay. The slice shaders currently render both as transparent.
- **Sampling is named.** Each card and projection carries a short label:
  "section", "ribbon mean", "mean in mask per position". Exposing per-vertex
  sampling footprints is a later step; the projection commands return only
  counts and coverage today.
- **Linked selection, independent cameras.** World crosshair, map and time
  point are always shared. Rotation and zoom are per view.

### 6. Export

One figure layout: cortical lateral and medial views above, matched left and
right section strips and the long-axis profile below, one colour bar, and a
caption block listing template, label source, sampling labels and threshold.
The existing composite export has slice and surface grids but no combined
layout.

## Fit with existing code

Already present:

- Oblique plane rendering (`ObliquePlanes` capability; `renderModulePlane`,
  `fitPlaneToWorldBox`, `resizeZoomedPlane` in `ui2/src/modules/api/rendering.ts`).
- Label layers and outlines; `freesurfer_aseg` and `olsen_mtl` atlases.
- Multiple meshes per surface scene, vertex picking, geometry families,
  crosshair linking in both directions.
- Volume-to-surface projection with `thickness` sampling.
- Module system with workspace contributions; mosaic and plot components.

To build:

| Piece | Where |
| --- | --- |
| Structure frame from a label mask (box, principal axis, profile bins) | new Rust command in `core/api_bridge`, numerics in `core/volmath` |
| Long-axis profile (mean and valid count per bin) | same command family |
| Deep-structure module: workspace, dock, cards | `ui2/src/modules/deep-structures/` |
| Live display recipe for projections | `VolumeSurfaceProjectionService`, `surfaceStore` |
| Medial-wall triangle filter and rim | `packages/visualization/src/surface/` |
| Hippocampal template assets and exact-template gate | `core/templates`, `SurfaceLoadingService` |
| Missing-data hatch | masked slice WGSL plus `shader_contract.rs` |
| Combined export layout | `ui2/src/services/export/` |

## Delivery order

1. **Cards from labels.** Structure frame command, dock with long-axis view,
   cross-section, strip and profile, shared crosshair. Works in any space with
   a label layer. This alone solves scale and interior values.
2. **One display recipe** and the missing-data hatch.
3. **Medial-wall window** with template hippocampal meshes and the template
   gate. This solves occlusion and the anatomical link.
4. **Hippocampal surface family** with ribbon projection and unfolded cards.
5. **Combined export.**

Judge each step on the three tasks: locate a deep effect anatomically, compare
its anterior-posterior distribution between hemispheres, and compare cortical
and deep patterns across maps.

## Decisions (2026-11-10)

- **Structures.** The dock is label-driven from the first release, with a
  structure picker over the label table. Hippocampus is the default and gets
  the most design attention; thalamus, caudate and putamen are presets in the
  same release.
- **Template assets** are fetched on first use and cached, like other
  TemplateFlow surfaces. Bundling is revisited later.
- **Native-space data** (recommendation): see below.

## Meshes for the medial window, and native space

HippUnfold surfaces cover the hippocampus only, and only in matching MNI
templates. Thalamus, caudate and putamen therefore need a mesh built from the
label mask even in template space, so that path is required for the first
release that includes the medial window, and native space gets it for free.

- **One mesh path for every structure:** a surface extracted from the label
  mask (surface nets or marching cubes on the binary mask, light
  volume-preserving smoothing), computed in Rust, cached per
  `(label layer, label id)`, and coloured by sampling the map at its vertices.
  It is labelled as a mask boundary, not an anatomical surface.
- **Hippocampus upgrade:** when the volume's template matches, the HippUnfold
  surfaces replace the mask mesh and add ribbon sampling and the unfolded card.
- **Native space:** cards always work, because they need only a label layer.
  The medial window is offered when the subject's own cortical surfaces are
  loaded with a medial-wall mask; the mask mesh is drawn in it. Without those
  surfaces, a locator (small orthogonal thumbnails with the structure outlined)
  replaces the in-place view. Template meshes are never drawn in native space.

Not all four structures are visible through the medial opening at once. The
thalamus and caudate lie medially; the putamen sits lateral to them and the
hippocampus is inferior. The renderer has no per-mesh opacity, so the rule is:
the selected structure is drawn in full, structures that would occlude it are
hidden, and the rest stay as neutral context. An inferior-medial preset is
provided for the hippocampus.

This moves mask-mesh extraction into delivery step 3, ahead of the HippUnfold
assets, which become part of step 4.

## Mock-up and what real data showed (2026-11-10)

A design canvas ("Deep structure view", private to the owner) mocks the feature
in the app shell with panels rendered offline from real data: the HCP group map
for working memory (2-back minus 0-back, z), the MNI152NLin6Asym T1w,
Harvard-Oxford subcortical labels, fsLR 32k midthickness surfaces and the
HippUnfold surfaces. The panels were drawn by a throwaway script, not by
Brainflow's renderers, so they are evidence for the design and not for the
implementation.

**Activation and integration.**

- A fifth layout, "Deep structures", beside Orthogonal, Integrated, Mosaic and
  Compare in the top-bar switcher and in View > Layout. It applies to the
  current tab like the other layouts.
- It needs a map and a label layer. Without a label layer the layout shows an
  empty state offering to load the Harvard-Oxford subcortical atlas or to use a
  loaded segmentation, and asks the user to confirm the exact template.
- The dock has one tab per structure plus "All"; "Add structure" opens a
  picker over the label table with left and right labels paired by name.
- The Inspector gains a "Deep structures" section (label source, template
  status, sampling, the structure list with mean values). Display settings stay
  on the map layer and apply everywhere.
- The status bar adds the structure and relative position of the crosshair.

**Section 3 is corrected by the renders.**

- Removing the medial wall exposes the thalamus and caudate well. The putamen
  is behind them, as expected.
- The hippocampus is **not** visible through the medial-wall opening from a
  medial, inferior-medial or superior-medial camera: medial temporal cortex
  lies in front of it.
- A local reveal does expose it: cortical triangles within 2 mm of the
  structure's screen outline and in front of it are removed. This is still an
  index-buffer filter, so it needs no clipping planes. It hides real
  parahippocampal data, so it is an explicit, pinnable toggle that is off by
  default. The cortex-view control therefore has three states: closed, medial
  window, window and reveal.
- Even revealed, the hippocampus is small on screen. The dock, not the in-place
  view, is where it is read.

**Confirmed available.** HippUnfold folded surfaces for MNI152NLin6Asym load as
plain GIfTI (2,004 vertices at 1 mm density), and the matching unfolded template
mesh is in the `khanlab/hippunfold` repository
(`resources/unfold_template_hipp/`), so the unfolded card needs no new geometry.

## Hill climb outcome (2026-11-10, later)

A visual hill climb with Tufte, Bostock and neuroimaging-specialist critics
replaced the dock-of-cards layout above. The record, score history, open items
and prototype checklist are in
[docs/design/deep-structures/critiques.md](../design/deep-structures/critiques.md),
with reference screens beside it. In short:

- The view is one "Deep" layout built around a single object: cortex cut by a
  plane the user moves, with the deep structures left whole and coming through
  the cut face.
- Every plane that meets the brain is drawn in one section language: cortex as
  the surface contour coloured by surface values, deep structures as map
  voxels inside atlas outlines.
- The unfolded hippocampal sheet sits in the Plot dock above its own column
  mean, with the cut positions drawn across it. Structures without template
  surfaces get a long-axis section and a mask-mean profile on one millimetre
  axis.
- The medial-wall window and the local reveal described above are superseded
  by the cut. The trust rules in section 5 and the label-driven structure
  frame in section 2 still hold.

The delivery order changes accordingly: the structure frame and profiles
first; then the cut face in the section language on the existing slice
renderer; then the cut and whole structures in the surface view; then the
sheet.
