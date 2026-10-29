# Desktop walkthrough — 2026-10-29

Hands-on pass through the reinstalled `/Applications/Brainflow.app` (macOS),
driving every menu, the Files/Inspector/dock panels, all four layouts, Set
studio, templates, atlases, surfaces, 4D and clustering. Data: `test-data/`
(MNI 1mm brain, `oblique4d.nii.gz`, `fs_LR.32k.L.inflated.surf.gii`), the
TemplateFlow menus and the Schaefer atlas. "Fixed" items are source edits made
in this pass; they are **not yet compiled or tested** (see "Verify").

## Log lines reported by Brad

| Log line | Cause | Owner | Status |
| --- | --- | --- | --- |
| `Failed to load surface fs_LR.32k.L.inflated.surf.gii: Unknown error` | `core/loaders/gifti/src/geometry.rs::read_document` required `Version == "1.0"`; Connectome Workbench/Caret write `Version="1"`. The UI then printed "Unknown error" because bridge rejections are plain objects, and `surface_loading::decode` discarded the geometry error in favour of the data-array fallback's error. | Brainflow | Fixed (3 places) |
| `Failed to load template MNI152NLin2009cAsym_brain_2mm: undefined` | `catalog.json` had no `brain_*` entries although the Templates menu and the Set studio demo (`setStudioStore.ts`) use them. Message was `undefined` because `TemplateService` read `.message` off a non-Error. | Brainflow | Fixed |
| `Loaded atlas (layer atlas_sc, 113.00000000005821 ms)` | `LogService` printed the raw float and truncated the layer id to 8 chars. | Brainflow | Fixed |
| `Template 'fsaverage' does not provide 'inflated' surfaces; loading 'pial' instead` | Menu offered Inflated for fsaverage/5/6 although `SurfaceLoadingService.normalizeTemplateRequest` always substitutes pial. | Brainflow | Fixed (menu items removed) |

None of these were downstream bugs.

## Fixed in source (this pass)

1. **GIfTI `Version="1"` rejected** — `core/loaders/gifti/src/geometry.rs`: accept any version that parses to 1.0; error now states the declared version/array count. Tests added in `core/loaders/gifti/tests/geometry.rs` (Workbench spelling, unknown version still rejected, real HCP fs_LR file decodes).
2. **Surface error swallowed** — `core/api_bridge/src/surface_loading.rs`: when both geometry and data decode fail, return a `Loader` error carrying both messages (and log it).
3. **"Unknown error" / "undefined" in the UI** — `SurfaceLoadingService.ts`, `TemplateService.ts` use `toError()` so bridge `{ Loader: { details } }` payloads keep their text. Surface notification now includes the reason.
4. **Templates menu items with no catalog entry** — `core/templates/catalog.json`: added `MNI152NLin2009cAsym_brain_{1,2}mm` (`desc-brain_T1w`) and `MNI152NLin2009cAsym_{GM,WM,CSF}_2mm` (`res-02 label-*_probseg`). `checksum`/`file_size_mb` are `null` because I could not download from TemplateFlow here; fill them in (the browser catalog builder skips entries without a checksum). New test `menu_builder::tests::every_template_menu_id_exists_in_catalog` scans `main.rs` so this cannot drift again; catalog test counts updated (21 entries, 7 types).
5. **Skull-stripped brain template treated as a mask** — `TemplateService.inferLayerType` mapped any type containing "brain" to `mask`.
6. **Surface camera presets all identical** — `surfaceStore.setSurfaceGeometry` replaced the geometry object, dropping `hemisphere`/`surfaceType`. The viewer then saw hemisphere `both`, `both_medial` etc. do not exist, and surfview fell back to `unknown_lateral` for every button. Now merges. Test: `stores/__tests__/surfaceStore.geometry.test.ts`.
7. **fsaverage "Inflated" menu items** removed from `src-tauri/src/menu_builder.rs`.
8. **Recents/Pinned ignore the remembered path** — clicking a local recent opened the generic folder picker. `RecentLocationsList` → `FilesStartPanel` → `FileBrowserPanel.mountKnownLocation(path)` now reopens it directly, with an error if it moved.
9. **Log formatting** — rounded ms, full layer id.
10. **Status bar coordinate system** — leaving Set studio restored `LPI` (and the legacy `StatusProvider` seed was `LPI`) while everything else uses RAS.
11. **Subjects panel copy** said "Use the actions above…" with the header hidden; now points to Set studio.

## Bugs still open

Severity: **H** wrong/broken result, **M** feature doesn't work, **L** polish.

- **H — Colormap label disagrees with the layer.** Select a Hot base layer, then select a grayscale overlay: label reads "Hot", strip and render are grayscale. Label, strip and picker all derive from `value` in `ColormapPicker.tsx`, so the stale value is upstream (RenderSection `own("colormap") ?? viewLayer.colormap`?). Needs a React DevTools repro.
- **M — "Hover Info…" (view context menu) does nothing.** Commit `ac149404` removed the popover component; `hoverSettingsPopoverStore` and the menu item remain. Restore the component or drop the item.
- **M — Compare layout panels use different scales.** With a 1mm and 2mm volume, panel B is drawn at roughly half size, so crosshairs line up in world space but not visually, even with Link = All.
- **M — Integrated layout crops anatomy** in the short top row (axial/sagittal/coronal heads clipped) and the overlay colorbar sits on top of the brain.
- **M — Colorbars overlap images** in Integrated, Mosaic (last column) and Compare panel B. Needs a reserved gutter or auto-placement outside the anatomy bbox.
- **M — Keyboard slice navigation**: Up/Down/PageUp in a focused slice view do nothing; wheel moved 1 slice per 5–10 ticks (may be synthetic-wheel-specific; check on a real trackpad).
- **M — Set studio demo** shows the main workspace scene (MNI + Schaefer + crosshair) inside the member Deck card rather than the member's own image; counts disagree ("Matched 42", "4 visible members", deck "3 of 6").
- **M — Surface view** loads tiny (not fit-to-view); scroll zoom barely changes it. Status bar keeps showing the previous surface error after a successful load.
- **M — Clusters**: Compute button looks enabled and does nothing when the layer is not a statistic; with an atlas selected the threshold box is just outlined red instead of the "needs a statistical layer" note.
- **L — Midthickness template surfaces**: `load_surface_template` returns error 7032 for Midthickness although `core/atlases` maps it to `neuroatlas::SurfaceType::Midthickness` and TemplateFlow ships it. Probably a one-line enable; would also be the right default instead of the removed "Inflated".
- **L — Template checksums are never verified** on desktop (`TemplateService` downloads without checking `checksum`); only the browser catalog builder checks.
- **L — Navigation has three vocabularies**: segmented control (Orthogonal/Integrated/Mosaic/Compare), tabs (which it sometimes replaces and sometimes duplicates as "Mosaic 2"/"Orthogonal 2"), and Workspace menu (Read/Explore/Analyze/Compare).
- **L — Inspector**: new layers aren't auto-selected; View behavior rows (Orientation markers/Hover sampling/Slice border) look like settings but are read-only text; Advanced shows "No advanced settings yet"; Annotate tab says "Annotate mode is not yet enabled in this Inspector shell". Hide unfinished surfaces.
- **L — View › Show Crosshair** toggles but never changes label or shows a checkmark; shortcut is bare `C`.
- **L — Shortcuts**: ⌘O mounts a directory and ⇧⌘O opens a file (inverse of macOS convention); in-app hints use "Cmd+0" text next to menu glyphs.
- **L — Atlas names**: plot/status show "LH Temp 1" (network dropped) while ROI search shows `7Networks_LH_Default_Temp_1`.
- **L — Status bar semantics**: Value/Region are at the crosshair while Mouse is at the pointer, with no labelling of which point each refers to; in Set studio the slots keep their "Coordinate system/Crosshair" labels but show "Studio"/"Study A".
- **L — Files**: after mounting, the default tab is Images, which is empty until folders are expanded in Tree ("0 files"); root is collapsed; selecting a folder inserts a breadcrumb that shifts rows under the pointer (my double-click landed on the wrong row); Load-surface dialog enables `.nii` but greys out `.nii.gz`.
- **L — Copy/format**: plot axis "Histogram · binCenter × count"; plot dock's "Histogram" tab shows a region bar chart for atlases; Activity and Log report different durations for the same load (2.9 s vs 41 ms for the template); Intensity readouts mix precision (3250.29 / 9125.8); colormap names truncated in picker ("PET Hot M…"); Atlases menu nests four levels deep; Diagnostics shows "3D atlas occupied".

## Downstream notes

- **surfview 3.1.0** (`setViewpoint`): only `unknown_lateral` exists for an unknown/`both` hemisphere, so any other preset silently falls back to it. Brainflow fix (6) avoids the trigger, but surfview should define `unknown_*`/`both_*` poses or infer the hemisphere from the mesh centroid.

## Browser host gaps (from source, for the browser-parity goal)

`WorkspaceBrowserTransport` handles ~20 bridge commands; the UI calls ~80 and the rest throw `UnsupportedBrowserCapability`. Notably:

- `browserCapabilities` advertises `surfaces`, `surfaceScalarOverlays`, `labels`, `surfaceLabels` = true, but the workspace transport routes none of `load_surface`, `load_surface_template`, `get_surface_geometry`, `load_surface_overlay`, `create_surface_sampler`.
- The worker implements `label_at_world`, but the transport never routes it (atlas region readout).
- Template/atlas catalog (`get_template_catalog`, `load_template_by_id`, atlas stats/ROI) not routed, though the `browser.html` harness already downloads them.
- No browser path for `compute_clusters`, `volume_extremum`, `volume_nonzero_bbox`, `get_nifti_header_info`, `sample_voxel_timeseries`, `batch_render_slices` (Mosaic).
- File picker accepts only `.nii,.nii.gz`; drop hint advertises GIfTI.
- Desktop-only controls (mount, SSH, BIDS, analyses) should be hidden/disabled from `capabilities`, not throw on click.

## Verify

```
cargo test -p gifti-loader
cargo test -p templates
cargo test -p brainflow menu_builder            # every_template_menu_id_exists_in_catalog
cargo check -p api-bridge
pnpm --filter temp-ui exec vitest run src/stores/__tests__/surfaceStore.geometry.test.ts
pnpm --filter temp-ui exec tsc -b
```
Then rebuild the app and re-check: open `test-data/surfaces/fslr32k/fs_LR.32k.L.inflated.surf.gii`; Templates › MNI152 › Brain Masks › Skull-stripped Brain (2mm); Set studio › Try an example; fsaverage Pial › Lateral/Medial/Dorsal; click a Recent.
