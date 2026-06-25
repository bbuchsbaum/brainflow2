# Scenario 01 — MNI volume + surface in Integrated view, linked cursor

## Goal / user story

A neuroscientist with an MNI-space map opens the MNI152 template, loads a cortical
surface, and works in the **Integrated** view (ortho slices + surface side by side).
When they click a voxel in the volume, they expect the corresponding cortical location to
be indicated on the surface — the two views are spatially linked. *Integrated view assumes
a link between volume and surface.*

## Preconditions

- Brainflow running (debug `.app`, see [README](README.md)).
- No directory mount required.

## Steps

1. **Load MNI volume template** — `Templates` menu → MNI152 T1w (1mm). (In this run it was
   already loaded from a restored session; SCENE → VOLUME VIEW = "MNI152 T1w (1mm)".)
2. **Switch to Integrated view** — top center tab `INTEGRATED` (or `View → Integrated`).
3. **Load surface MNI template** — `Surface Templates` menu → `fsaverage6 (41k)` →
   `Left Hemisphere` → `Pial (Left)`. (fsaverage is the standard surface that co-registers
   with MNI space.)
4. **Click a cortical voxel** in the axial slice (left-hemisphere side = right of the image,
   under the "L" label).
5. **Observe the surface pane** for a mirrored cursor/marker at the corresponding location.

## Expected behavior / acceptance

- A.1 Integrated view shows ortho slices (left) + the surface (right) together. ✅
- A.2 Clicking a voxel moves the volume crosshair and re-centers the three slices. ✅
- **A.3 Clicking a voxel renders a marker on the surface at the spatially-corresponding
  vertex (the linked cursor).** ❌ — this is the scenario's reason for existing.
- A.4 (stretch) Clicking the surface moves the volume crosshair (reverse link). ❌

## Findings — run 2026-06-25

### F1 — No volume→surface linked cursor (severity: **blocker** for A.3)

Clicking voxels across four very different crosshair positions
(`(-44.7,15.1,18.0)` → `(-44.7,31.6,18.0)` → `(-88.2,-6.7,18.0)`) moved the crosshair and
re-centered the slices correctly, but the surface pane **never changed** — no marker, no
highlight, no camera move. The surface is visually decoupled from the crosshair.

Root cause (code investigation):
- `ui2/src/stores/viewStateStore.ts` holds `crosshair.world_mm` and `setCrosshair()`
  updates it + re-centers the slice planes' `origin_mm`. This works.
- `ui2/src/components/views/SurfaceViewCanvas.tsx` / `SurfaceViewPanel.tsx` never read
  `crosshair.world_mm`. The surface renderer has **no marker / highlighted-vertex / cursor
  primitive** and no `onWorldPositionChange` input.
- No backend `nearest_vertex` / `world_to_vertex` command exists in `core/api_bridge`.
- Reverse direction (surface click → volume crosshair): surface canvas has no click/pick
  handler either.

→ **Fix:** add a surface marker that tracks `crosshair.world_mm` (nearest vertex). See
"Fix" section below.

### F2 — Loading a surface template spawns an extra standalone tab (severity: **minor**)

`Surface Templates → … → Pial (Left)` both populated the Integrated view's surface pane
(good) **and** minted a new top-level tab `FSAVERAGE6_PIAL_LEFT` showing only the surface,
switching focus to it. The user had to click back to `INTEGRATED`. This is the
"tab proliferation" pattern flagged in `memory-bank/vol2surf_handoff.md`: template/surface
load should reconfigure the active view in place, not mint a new tab.

### F3 — Some axial clicks don't navigate (severity: **likely benign**)

Clicks near the lateral edge of the axial pane (beyond the brain, in the skull/air margin)
did not move the crosshair, while clicks inside the brain registered reliably and
consistently across two sessions. This correlates with the volume's in-plane extent, so it
is most likely the expected "click outside the volume is a no-op" behavior, not the
drag-threshold bug first suspected. Low priority; confirm the out-of-bounds boundary feels
right (a click just inside the brain edge should still navigate).

## Fix (A.3 — linked cursor) — DONE + verified 2026-06-25

Branch: `feat/integrated-linked-cursor`. The surface view now renders a marker sphere that
tracks the crosshair, snapped to the nearest surface vertex so it sits on the cortex.

Implementation:
- `packages/visualization/src/surface/types.ts` — added `markerWorldPosition`,
  `markerSnapToSurface`, `markerMaxSnapDistanceMm`, `markerColor`, `markerRadiusMm` to
  `NeuroSurfaceCanvasProps`.
- `packages/visualization/src/surface/NeuroSurfaceCanvas.tsx` — `findNearestSurfacePoint()`
  (pure-TS scan of `geometry.vertices`, sub-ms even at 164k verts) + a `useEffect` that adds/
  removes a `THREE.Mesh` sphere at the (snapped) marker position. Material uses
  `depthTest:false`/`depthWrite:false` so the cursor stays visible even when the point is on
  the far/medial side of the mesh.
- `ui2/src/components/views/SurfaceViewCanvas.tsx` — subscribes to
  `viewState.crosshair.world_mm` and passes the marker position, snap on,
  `markerMaxSnapDistanceMm={20}`.

**Coordinate transform (the crux).** The app's `world_mm` is **LAS** (+X = Left); template/
GIfTI surface vertices are **RAS** (+X = Right). Verified directly against the fsaverage6
pial-L file (`~/Library/Caches/templateflow/tpl-fsaverage/...hemi-L_den-41k_pial.surf.gii`):
its X range is **−68.8 … +1.3** (left hemisphere is negative X). The frames differ only on the
L/R axis, so the adapter negates X before snapping: `surface = [-x, y, z]`. Confirmed
empirically on all three axes (left-lateral click → lateral surface; anterior click Y→+ →
marker anterior; inferior click Z→− → marker inferior; right-hemisphere click → correctly
hidden because the only-loaded left surface is out of range).

Hardened after a fresh-context code review: the marker effect now keys on a
geometry-aware key (so it re-snaps when a surface's vertices load/swap under an unchanged
handle, not only on crosshair moves), reuses a single mesh across updates (repositions /
toggles visibility instead of re-allocating geometry+material each crosshair move), skips
hidden surfaces when snapping, and disposes the mesh on unmount only.

**Limitations / follow-ups:**
- The negate-X assumes the loaded surface is RAS (true for FreeSurfer/templateflow/most GIfTI).
  A surface already in the volume's LAS frame would be mirrored. Long-term: track each
  surface's coordinate space instead of assuming.
- fsaverage is not exactly MNI152 (mm-level differences); nearest-vertex snapping absorbs this
  for a visual cursor, but it is not a precise registration.
- The 20mm snap gate hides the marker when the crosshair is deep (white matter / ventricles /
  off the loaded hemisphere) — intended, but tune if it feels too eager.
- `depthTest:false` means a far-side marker draws over the near surface (depth-ambiguous on a
  full brain). Acceptable for one hemisphere; revisit for whole-brain.
- Reverse link (surface click → volume crosshair, A.4) is still not implemented.
