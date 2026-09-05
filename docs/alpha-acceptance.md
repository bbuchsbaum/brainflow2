# First alpha acceptance

This is a release-candidate checklist. Unchecked items are not verified.
Automated results and remaining engineering gates are in
[alpha-readiness.md](alpha-readiness.md).

## Build and evidence

The local macOS candidate is `0.1.0-alpha.1`, Apple Silicon only. Its delivery
folder is `dist/alpha/0.1.0-alpha.1/`. Consult the accompanying `manifest.json`
for the exact source revision, configuration and file hashes, and `README.md`
for package smoke results. This is a local test build, not a signed/notarized
public release. No Windows, Linux or Intel macOS package is certified.

Desktop-control service startup failed in this session. The native smoke checks
prove loading and backend rendering, but the visual/mouse checks below remain
open. Record screenshots, observed world coordinates and deviations when running
these checks; do not infer success from absence of errors in logs.

## Fixture and coordinate oracle

The delivery includes deterministic geometric phantoms under `fixtures/` and a
Python standard-library generator. These shapes are intentionally simple and are
not clinical or anatomical brain data.

| Fixture | Known properties |
| --- | --- |
| `sub-alpha_asymmetric_T1w.nii.gz` | 65 × 65 × 49 voxels, spacing 2 × 2 × 3 mm, RAS affine, voxel-center bounds x/y -64…64 and z -72…72 mm |
| Left bright landmark | (-36, 0, 0) mm, center intensity 900 |
| Right bright landmark | (36, 0, 0) mm, center intensity 600 |
| Paired pial meshes | Centers x = ±20; radii 16, 24, 28 mm; lateral vertices coincide with the two landmarks |
| Paired inflated meshes | Same 482 vertices and 960 triangles per hemisphere; centers x = ±50 and radii 24, 32, 36 mm |
| Inflated landmark correspondence | Anatomical x = -36/+36 maps to displayed x = -74/+74 while the canonical world cursor remains -36/+36 |

## Manual pass

1. [ ] Open the volume in an orthogonal workspace. Verify all three planes show
   the asymmetric shapes, square pixels and correct R/A/S edge labels. Locate
   each landmark using the world-coordinate readout; check all crosshairs meet
   at the same world point. Axial stepping should advance 3 mm and x/y stepping
   2 mm. At the boundaries it should stop without a jump or empty stale frame.
2. [ ] Open a montage workspace. With all reference slices selected, verify 49
   axial planes span -72…72 mm in 3 mm steps. Click a landmark and confirm the
   selected world coordinate. Use two workspaces with different cursors; rapid
   clicks or switching tabs while resizing must not move the other workspace.
3. [ ] Load both pial meshes and choose the Integrated display mode. Verify the
   hemisphere pair appears once, with no extra reflection. Move the volume
   cursor to each landmark; the surface marker should meet its lateral vertex.
   Pick that vertex on the surface and confirm the volume cursor returns to the
   corresponding world landmark. Test intermediate triangle picks as well.
4. [ ] Load corresponding inflated meshes while retaining the pial references.
   Confirm linking uses anatomical coordinates, including the landmark mapping
   in the table. Remove the required anatomical reference and confirm the
   missing-reference indication; it must not silently use inflated coordinates.
5. [ ] Resize panes, change integrated arrangement, toggle crosshairs, zoom/pan,
   scroll rapidly and switch display modes. The cursor must remain consistent,
   overlays must move/hide immediately, and no stale bitmap should remain after
   removing its layer. Reopen a closed workspace and repeat.
6. [ ] Repeat volume and surface load/unload at least 25 times, including a
   projected overlay. After removing all layers, verify the view is empty and
   reload succeeds. Record process RSS after warmup and during a longer session;
   inspect growth alongside live resources rather than treating driver caches
   as an immediate leak. Record interaction latency on this fixed fixture.

## Automated checks completed

- [x] Navigation request ordering, origin-workspace preservation and resize/cursor
  race regressions; finite/clamped navigation and exact slice spacing.
- [x] Crosshair movement/visibility redraw with an unchanged bitmap; image clear;
  bounded draw retries and timer cleanup.
- [x] Surface coordinate/correspondence and integrated-layout unit coverage.
- [x] 25 surface/sampler/projected-overlay unload cycles with empty registries.
- [x] 200 real-GPU upload/release cycles with zero resident slots/bytes after each.
- [x] Full UI tests, bridge tests, TypeScript/production UI builds and strict
  command/permission alignment. Counts and limitations are in the readiness note.

Packaged-app launch evidence does not check off any manual item above.
