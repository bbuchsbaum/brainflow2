# UI redesign phase 3: science features and design completion

Follows `docs/plans/ui-redesign-phase2.md`; Phase 2 is committed on `ui/redesign-p2`
(`a7bd82c9`, `2f82bc6c`, `ac149404`, `ae87ff65`). Scope comes from the Phase 2
critics: the target-user critic's ranked feature list, the visual critic's design
items, and the small leftovers. The user decided (2026-10-26) that all of them go
into one phase of design, implementation and hill climb, after the native check.

Tracked in mote under the tag `redesign-p3` (umbrella bead: "UI redesign phase 3").

## Gate 0: native check

Before any Phase 3 work, the debug `.app` must pass the visual check in
`.hillclimb/native-check/PROMPT.md` (one crosshair with the GPU tick off, slice
header, rail scrubber, colorbar, placement on resize, other workspaces). The
report lands in `.hillclimb/native-check/REPORT.md`. Failures are fixed on
`ui/redesign-p2` first.

## Constraints

- Phase 1–2 contracts stay: HYBRID.md, V5.md, `AGENTS.md` visual style, the lint
  ratchet (no new allowlist entries without a data-colour reason) and the
  screenshot gate (baselines updated only for intended changes, in the same commit).
- Frozen unless a work item says otherwise: slice pixels and colormaps, click-to-world
  mapping, square pixels. Item 2 deliberately changes crosshair placement (snapping);
  it ships behind the existing `snapToVoxel` setting and updates parity tests explicitly.
- New Tauri commands follow `core/api_bridge/ADDING_COMMANDS.md` (command list,
  permission, ts-bindings, `pnpm check:permissions:strict`).
- Another session has uncommitted work in `core/` (shaders) and the surfview upgrade.
  Backend items touch `core/api_bridge` and `core/loaders`; stage only our hunks and
  coordinate before regenerating bindings.
- No git worktrees. Agents run sequentially or on disjoint paths in the main checkout.
- Branch: `ui/redesign-p3` from `ui/redesign-p2`; one commit per accepted item or round.

## Work items

Survey of existing support: three things are broken today, not just missing
(export cannot save; JPG export writes raw RGBA; the cluster panel calls commands
that do not exist).

### Wave 1: foundations

1. **Export repair** (S, bug). Add the missing `save_image_bytes` command (save dialog
   + write); fix JPG (encode on the backend or re-encode on the frontend). Files:
   `ExportImageDialog.tsx:80`, `ViewExportService.ts:162`, `RenderFormat::from_str`
   (`api_bridge/src/lib.rs` ~8516).
2. **Voxel-exact navigation** (S, medium risk). `snapWorldToVoxelCentre(world, layer)`
   applied in `viewStateStore.setCrosshair` when `crosshairSettingsStore.snapToVoxel`
   (already defined, default on, never read); a toggle in Crosshair settings; an `ijk`
   status-bar slot; voxel-centred default placement (`get_volume_bounds` centre uses
   `(dims-1)*0.5`); fix `sample_world_coordinate_impl` rejecting v in [-0.5, 0).
   Updates crosshair parity and mosaic tests deliberately.
3. **Statistic type and units** (S-M). Read NIfTI `intent_code`, `intent_p1..p3`,
   `intent_name`, `descrip` in the loader; carry them through `NiftiHeaderInfo` /
   `VolumeInfo` to `LayerInfo.statKind` and `units`; show "z" / "t(df)" in the colorbar
   (`useOverlayColorbar.ts` hard-codes `units: null`), the status Value tooltip, the
   Inspector data section and the header dialog (description is always empty today).
   Optional BIDS sidecar merge.
4. **Atlas region at the crosshair** (S-M). Continues the existing mote bead "Atlas M2"
   (crosshair-driven region slot already wired through `atlasRegionLookup.ts`). Why it
   shows "—": only catalogue atlases get `atlasPaletteLegend`. Diagnose the catalogue
   path; build legends for user-loaded label volumes (LUT/TSV sidecar via the parcel
   table parser, or an "assign atlas" action).

### Wave 2: features on the foundations

5. **Cluster/peak table** (M backend, S-M UI). Depends on 2–4. New command
   (`compute_clusters`, or implement `compute_alpha_mask`/`clear_alpha_mask` that
   `ClusterService.ts` already calls): layer, |threshold| with sign
   (both/positive/negative), 6/26 connectivity, min voxels, timepoint; returns
   clusters with size, peak value, peak mm, centre-of-mass mm, region. neuroim
   `conn_comp_3d` labels `v > threshold` only and reports mean, not peak, so run per
   sign and compute peaks. UI: rebuild `ClusterPanel` on `ui/bf`, place it in the dock
   (it is unreachable today), click row → crosshair, "go to max/min" for the active
   layer, region column, export CSV.
6. **Multi-layer hover readout** (S-M). Values for every visible layer under the
   cursor (and at the crosshair), formatted with item 3's units; feeds the dead
   "Mouse" status slot. Respects the "hover is distracting" decision recorded on Atlas
   M2: a quiet readout, not a floating tooltip by default.
7. **Labelled mosaic** (S labels and colorbar, M crop). z-mm label per tile from
   `MosaicCell`'s slice position; one shared `ViewportColorbar`; crop to the
   reference brain's non-zero bounding box plus slice step/range, through
   `mosaic/sliceGeometry.ts` so spacing is preserved.

### Wave 3: output and comparison

8. **Composited export** (M). Depends on 1, 3, 7. Render at a scale factor; composite
   image + canvas crosshair + header + colorbar (+ orientation letters) on a 2D canvas;
   options to include/exclude each; a mosaic exporter that stitches cells (it throws
   "No exporter registered" today).
9. **Linked Compare** (M, highest UX risk). Optional per-panel `renderOverrides`
   (window, threshold, colormap) merged in `ComparisonRenderService.buildPanelViewState`,
   plus a "link window/threshold" toggle that propagates edits; the Inspector must make
   clear which panel's values it edits.

### Wave 4: design completion

10. **Viewport frame on every pane**: the surface view gets the frame (header,
    info card restyled as the frame's metadata), mosaic tiles use the frame's
    label style.
11. **Secondary and empty workspaces**: designed empty states (no volume loaded,
    empty Compare, empty mosaic, empty plot dock) with the next action.
12. **Data-first plot dock**: less chrome, larger plot area, toolbar collapsed into
    the plot frame.
13. **Leftovers**: Files tree at 1280 px; workspace switcher active segment in tool
    workspaces; harness specimen for Go-to in voxel mode.

## Hill climb

- New series `.hillclimb/p3`. Baseline v0 is `ae87ff65` plus the new specimens.
- New harness scenarios (fixtures in `ui2/src/devHarness/fixtures/app/`): stat
  overlay with intent metadata (z and t(df)); cluster table open with a selected row;
  region visible at the crosshair; ijk slot; multi-layer readout; labelled and cropped
  mosaic; composited export preview; linked Compare; each empty workspace; data-first
  plot dock; Go-to voxel mode.
- Same three critics and rubric as phase 2 (visual /80, function, target user), plus a
  scientific-fidelity check on items 2, 3, 5 and 8: cluster sizes/peaks against a known
  synthetic fixture, ijk against the affine, units against the header.
- One round after each wave; budget baseline + 4 rounds + 1 closing round.
- The screenshot gate stays green between rounds; intended visual changes update
  baselines in the same commit.
- Monitor page continues at https://claude.ai/artifact/7cYzCeb16gRjvzbdGXg7Ga.

## Verification per item

- Rust: `cargo test -p api-bridge` (plus `-p loaders-nifti` for item 3) with new
  tests for each command, including a synthetic cluster fixture with known answers.
- UI: tsc, vitest, lint ratchet, the screenshot gate.
- Native: items 1, 2, 5 and 8 need a native `.app` check (save dialog, GPU mask,
  snapping on real data), recorded in `.hillclimb/native-check/`.

## Finish

Fresh-context code review of the phase branch, then merge prep for
`ui/redesign-p2` + `ui/redesign-p3` into `main` on the user's go-ahead.

## Outcome (2026-10-27)

All thirteen items shipped on `ui/redesign-p3` except the follow-ups listed below.

- Hill climb `.hillclimb/p3`, rounds v0-v5 plus a v6 confirmation capture, four critics.
  Visual 52 -> 62 (of 80), function/accessibility 6.0 -> 7.9, target user 6.9 -> 7.9,
  scientific fidelity 4 -> 8. Every displayed number was recomputed independently against the
  synthetic fixtures: clusters, peaks, ijk, centroids, regions, mosaic positions, export geometry
  and dpi.
- Fresh-context code reviews of the backend and frontend; their defects are fixed (save-dialog
  overwrite, header reads under the registry lock, slice stepping with snapping, label colormap
  slot leak, label-map detection).
- Native .app checks (`.hillclimb/native-check/p3/`): the first run passed the core features and
  exposed defaults the harness never exercised (statistic first-paint window, export matte and
  crop, mosaic loading race, a window/level drag under the macOS context menu). All are fixed;
  the re-check passed 8 of 8 items, item 5 read as "outside the volume".
- Ships with surfview 3.1.0 (user decision).

Follow-ups (mote, tag redesign-p3 and related):
- shader: per-region label outline colour and halo; edge-voxel sampling convention;
- export IPC payload and cancellable cluster compute;
- side-by-side lateral/medial surfaces, surface export through the composer, orientation gizmo,
  status-bar vertex value (these need the surface viewer package);
- cluster sub-peaks and cluster-level p; plot time course (needs a 4D fixture);
- offline Neurosynth lookup ported from neurotide.
