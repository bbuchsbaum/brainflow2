# Brainflow run-through re-check — 2026-10-30

A re-run of the 2026-10-29 evening run-through (`/Applications/Brainflow.app`,
repo `e3d7ce3e`) and of the open list in
[2026-10-29-desktop-walkthrough.md](2026-10-29-desktop-walkthrough.md).

**Commit:** `c66551df` (`main` = `origin/main`).

**Driven from:** a Linux cloud container. Desktop control of the Mac was not
available in this session, so **no native macOS pass was possible**. What ran:

| Tag | Evidence |
| --- | --- |
| **[B]** | The real app (`ui2/workspace.html`) through the browser host. This is the WASM worker plus shared services, built with `pnpm --filter temp-ui build:browser`, driven with Playwright in headless Chromium 1243 on a **software** WebGPU adapter (SwiftShader Vulkan: f32 filtering, 16 sampled textures). The UI, stores and services are shared with desktop; the transport, decoder host and file access are not. |
| **[N]** | Native Rust tests on SwiftShader Vulkan (`VK_ICD_FILENAMES` → Chromium's ICD). Real wgpu, software GPU. |
| **[D]** | A data probe: a scratch crate that loads atlases with `neuroatlas` and Brainflow's own `nifti_loader::load_nifti_volume_auto`. |
| **[S]** | Static source reading at `c66551d`. |
| **[U]** | Vitest unit tests. |

None of this replaces a native check. Rows marked *native re-check* need the
installed app.

Severity: **H** wrong result, crash or unusable; **M** feature doesn't work; **L** polish.

---

## 0. Bottom line

- **Little has changed since the last run.**
  - 12 commits and 11 files have landed since `e3d7ce3`. Two open items were touched, both partially: new layers on top (`332a80e`) and export crop/letters (`8083761`).
  - **None of yesterday's top 10 is fixed in source.**
  - If fixes exist locally or on an unpushed branch, this pass did not see them. No remote branch has commits newer than `main`'s.
- **332a80e is inert on the main load path.** The T1-under-z-map reorder never runs for File › Open, the Files panel, drag-drop or BIDS (§3.1).
- **New H: the NIfTI reader ignores `vox_offset`** when the extension flag is 0. Data is read from byte 352, so every voxel is shifted. This is the real cause of the Olsen MTL misplacement, and it affects any such file, not just atlases (§3.2).
- **Root causes for the other atlas bug and the geometry bug:**
  - ASEG is a `neuroatlas` label-id bug. Brainflow's id-based mapping is correct.
  - The oblique display frame comes from `extract_orthonormal_vectors`, which keeps voxel axis order, plus first-layer-only initial geometry (§1, #3).
- **Browser host (§19 of the run-through, first time run):**
  - Both E2E suites pass except one environment-specific test each.
  - The shared workspace in the browser lacks surfaces, label colours/sidecars, NIfTI intents, the 4D time row and Mosaic (§4).

---

## 1. Yesterday's top issues

| # | Sev | Issue | Status at `c66551d` | Evidence and cause |
|---|---|---|---|---|
| 1 | H | ASEG names/colours wrong (left putamen reads "RH Putamen"; right side uncoloured, "label 51") | **Open** | See "#1 ASEG" below. |
| 2 | H | Olsen MTL drawn outside the brain | **Open; new cause** | Not a label or affine bug. See §3.2. |
| 3 | H | Display frame from the first layer's voxel axes | **Open; reproduced [B]** | See "#3 Geometry" below. |
| 4 | H | Finder drag-and-drop never loads | **Open [S]** | See "#4 Drag-and-drop" below. |
| 5 | H | Tree search ghost rows | **Open [S], medium confidence** | `fileBrowserStore.ts:615-626`: `searchInTree` pushes a matching folder *and* its matching descendants, giving duplicate path ids. `FileBrowserPanel.tsx:621`: the Tree key `tree-v2-${entries.length}` doesn't change across search/clear, so react-arborist keeps stale rows. Can't run in the browser (no mounts). *Native re-check.* |
| 6 | H | Auto-opened fsaverage5 Pial surface tab renders black | **Not located [S]** | The clear colour is black (`NeuroSurfaceCanvas.tsx:514`), so a failed draw looks like an empty scene. Untestable in the browser workspace (`load_surface` unsupported there). *Native re-check.* |
| 7 | H | Population lens empty after NeuroTabs import ("Focus window does not match…") | **Open [S], medium** | `PopulationSliceService.ts:810-821` checks `values.length === request.dimPx[0]*dimPx[1]`. The backend (`population_slice.rs:564-608`) returns pixels over `SliceGeometry::full_extent`, whose `dim_px` is shrunk to the volume's aspect. `validateData` (:376) correctly uses `data.plane.dim_px`. So the check fails whenever the requested and volume aspects differ. |
| 8 | M | No way to remove/unload a layer | **Open [B][S]** | See "#8 Layer removal" below. |
| 9 | M | New layers land on top at 100 % | **Partially addressed, but inert on the main path** | See §3.1. |
| 10 | M | ⌘B / View › Panels add duplicate panels | **Open [S]** | `GoldenLayoutRoot.tsx:558` and `layoutService.ts:449`: golden-layout 2.6's `newItem()` inserts immediately and is called *before* the "focus existing Inspector" check. Files is always added via `rightColumn.addChild` (:587). Ctrl+B does nothing in the browser (it's a native accelerator). *Native re-check.* |

### #1 ASEG

**[D] ran:**
- The file is a 1 mm grid, 193×229×193. Its voxels hold FreeSurfer ids: 12 = Left-Putamen (x −36…−13) and 51 = Right-Putamen (x 13…36).
- (−30, 0, 0) samples 12, which `neuroatlas` labels "RH Putamen".
- (+28, 0, 0) samples 51, which has no label, so it is transparent and reads "label 51".
- Only values 10–13, 16 and 17 get a colour, and all six get a wrong name.

**Cause:** `neuroatlas-rs/src/atlas/aseg.rs:106-129` numbers its 17 labels 1–17.

**Brainflow's mapping is correct [S].** The LUT and the region lookup are keyed by label id (`palette.rs:111,167-171`, `atlasRegionLookup.ts:71`, shader LUT at the raw value). `core/atlases/labels/README.md` already documents the upstream bug, and the browser catalog's `aseg.tsv` has the right ids.

**Fix:** upstream, or remap via that TSV on desktop.

**Also:** "ASEG (2 mm)" loads the 1 mm file, because `service.rs:721-722` ignores the requested resolution.

### #3 Geometry

**[B] reproduced:**
- **`oblique.nii.gz` alone:**
  - The "Sagittal x 4.0 mm" pane has u = +x, v = −z, i.e. a coronal plane with L/R letters.
  - "Coronal y −1.0 mm" has u = +y, i.e. a sagittal plane with P/A letters.
  - Axial has u = +y, v = +x: L at the top, A on the right.
- **`labels.nii` then the MNI T1:** all three panes are framed to the labels grid's box, x −3…11, y −8.5…6.5, z 3…39 mm. The T1 is cropped to it.
- **MNI then oblique:** canonical frames.

**Causes [S]:**
- `core/neuro-types/src/view_rect.rs:288-307` (`extract_orthonormal_vectors`, used at :101-105) takes voxel column *i* as display axis *i*, with no permutation to the nearest world axis.
- `ui2/src/services/LayerApiImpl.ts:172-175` applies `initialGeometry` only when the workspace has no layers, so later layers never widen the field of view (no union of bounds).

### #4 Drag-and-drop

**[S]:**
- `src-tauri/tauri.conf.json:30` still has `dragDropEnabled: false`.
- `DisplayLifecycleOrchestrator.ts:286` accepts only Electron-style `file.path`.

**[B]:** a file dropped on the view *does* load in the browser host, which registers the `File` with the worker.

**Fix:** enable Tauri drag-drop, subscribe to `getCurrentWebview().onDragDropEvent` (whose drop payload has `paths[]`), route to `loadFile({ingress:'drag-drop'})`, and keep the browser path.

**Also:** `OrthogonalViewContainer.tsx` accepts only `.nii`, `.nii.gz` and `.gii`, so `.gii.gz` drops are silently ignored.

### #8 Layer removal

**[B]:**
- Delete and Backspace on a selected Scene row do nothing.
- Right-clicking a Scene row opens no menu.
- The command palette has nothing for "remove", "unload" or "close layer".

**[S]:**
- The bridge already has `unload_volume` (`command_list.rs:29`), and `LayerService.removeLayer` works (the browser E2E calls it).
- The only "Remove layer" UI is `ui/LayerTable.tsx:246-293`, which is mounted only in tests and stories.
- The desktop "Reload" item is probably the WebView's native context menu, since the rows have no `onContextMenu`.

---

## 2. Other open items

| Sev | Item | Status | Evidence and cause |
|---|---|---|---|
| M | Opacity lost on hide/show | **Open [B]** | 48 % → Visible off → on gives 100 %. Hiding sets `opacity: 0`. `LayerService.ts:171` and `LayerApiImpl.ts:687` set `opacity = visible ? 1 : 0` instead of restoring the previous value [S]. |
| M | View context menu › Hover Info… does nothing | **Open [B]** | The item is present; clicking it opens nothing. `useViewContextMenu.ts:61-64` sets `hoverSettingsPopoverStore`, which nothing renders since `ac149404` [S]. |
| M | Compare fits each pane to its own bounds | **Open [B]** | See "Compare" below. |
| M | Integrated: colourbar over the anatomy; heads touch the pane edge | **Open [B]** | The axial colourbar sits on the right side of the head. |
| M | ↑/↓/PageUp/PageDown in a slice view | **Open [B]** | No crosshair change. ←/→ step 1 mm, Shift+→ steps 10, `o` goes to the origin ✓. `useKeyboardShortcuts.ts:58-150` registers only ←/→ [S]. |
| M? | Wheel | **Mixed [B]** | Wheel-up still moves **inferior**. A burst of 10 notches moved 10 slices in Chromium; the Mac showed 1. *Native re-check with a real wheel/trackpad.* |
| M? | `?` shortcuts dialog | **Works in Chromium [B]** | Shift+/ opens "Keyboard shortcuts". *Native re-check* (WKWebView). |
| L | Bare `c` doesn't toggle the crosshair | **Open [B]** | `crosshair.visible` is unchanged. |
| M | ⌘A / Ctrl+A selects all page text | **Open [B]** | 927 characters selected. Desktop also has an accelerator clash between Edit › Select All (`main.rs:544`) and the Atlas Browser's `CmdOrCtrl+A` (:588) [S]. |
| M | Space doesn't play/pause 4D | **Untestable [B]** | The browser workspace shows no time row for 4D (§4). The wiring exists (`useKeyboardShortcuts.ts:168` → `PlaybackService.ts:54`); the `SPACE_OWNERS` focus filter (`KeyboardShortcutService.ts:55-61`) is the suspect [S]. *Native re-check.* |
| M | Clusters Compute enabled on non-statistic layers | **Not reproduced for file layers [B]** | Compute is disabled with a T1 selected and with a label-file layer selected. The original case (an *atlas* layer) isn't reachable in the browser workspace. Not located [S]. *Native re-check with ASEG.* |
| M | "[object Object]" under ROI ID on ASEG | **Open [S]** | `ParcelTableImport.tsx:22-25` (`parcelError`) reads a top-level `details`, but `BridgeError` serialises externally tagged (`{"Input":{code,details}}`). The trigger is `get_atlas_roi_locations` failing for ASEG. |
| M | Load atlas… dialog stays open, shows the handle, allows duplicates | **Open [S]** | `AtlasConfigModal.tsx:137-146` never calls `onClose`, and `InspectorLoadDialogs.tsx:36` passes no `onLoad`. |
| M | Image Header shows `f32` for int16 and has no scl rows | **Open [S]** | `api_bridge/src/lib.rs:3487` reports the in-memory dtype, and `NiftiHeaderInfo` has no `scl_slope`/`scl_inter`. In the browser, Ctrl+I opened nothing. |
| M | "Unmount selected" unmounts the wrong root | **Open [S]** | `FileBrowserPanel.tsx:72-81` takes the first root whose path prefixes `selectedPath`, and root-row clicks don't update `selectedPath`. |
| M | Retry after a moved folder says "Directory '' does not exist" | **Open [S]** | `FileBrowserPanel.tsx:552` calls `refreshDirectory(currentPath)` while `currentPath` is `""`. The toolbar refresh uses `currentPath \|\| rootPath`. |
| M | Export legend lists regions absent from the image | **Open [S]** | `compositeCapture.ts:507-511` uses the full `atlasPaletteLegend`, unfiltered. |
| L | Export: "Crop to brain" flat tops; R/L letters collide between Figure-row panes | **Partial [S]** | `8083761` adds a letter band around cropped panes and a blob-based crop for a lone statistic map; its unit tests pass [U]. Neighbouring panes are still separated only by `paneGap` (4–6 px), and uncropped exports get no band. *Native visual re-check.* |
| M | Error text for bad files | **Open [B][S]** | See "Error messages" below. |
| L | View › Show Crosshair has no checkmark | **Open [S]** | It's a plain `MenuItemBuilder` (`main.rs:551`). |
| L | Midthickness template surfaces give error 7032 | **Open [S]** | Hard-rejected at `api_bridge/src/lib.rs:11118-11123`. |
| L | Command palette | **Open [B]** | "hdr" and "xhair" match nothing (no fuzzy matching). The input has no `autocorrect`/`spellcheck`/`autocapitalize` attributes, so expect the macOS autocorrect bubble. |
| L | New layers aren't auto-selected | **Open [B]** | After opening a z map second, the selection stays on the first layer. |
| L | Copy | **Open [B]** | The plot still reads "Histogram · binCenter × count". For a label layer, the dock's "Histogram" view shows a regions bar chart. A near-zero z value displays as "−4.5e−11" (readout and colourbar marker). The status-bar ijk is the reference grid ("96 114 96 · ref 1 mm"). |

### Compare

**[B]:**
- The MNI T1 plus `scaled_i16.nii` (2×2×2 voxels): pane B zooms to the 2 mm extent, magnifying the T1 behind it, while pane A shows the whole brain.
- A 1 mm and a 2 mm volume with the *same* extent do render at the same scale.
- Pane headers now show the letter and layer name (they read only "Value …" yesterday).
- Colourbars in panes B and C are drawn over the anatomy.

**[S]:** `ComparisonRenderService.ts:168-228` fits each pane to its own primary layer's bounds. One pane is created per visible layer, and the default layout is a single row.

### Error messages

| File | Browser path [B] | Desktop path [S] |
|---|---|---|
| `truncated.nii` | Clear: "buffer length (99648) and header dimensions (34120084 elements) are incompatible". | `core/loaders/nifti/src/lib.rs:584-606` discards each typed attempt's error and returns a generic `ScalingError`. |
| Empty file | Raw `Io(Error { kind: UnexpectedEof, message: "failed to fill whole buffer" })`. | Same raw text: nifti 0.17's `Io` variant has no `display()`. |
| Non-NIfTI file | Same raw text. | Same raw text. |

### Commits since the last run that do work

| Commit | Change | Result |
|---|---|---|
| `8083761` | The 4D Temporal selector has a backing; panes narrower than 480 px keep its caption for screen readers only. | Seen working [B]. |
| `332a80e` | Run-group colourbar. | Unit tests pass [U]; not exercised (no run group in the fixtures). |

---

## 3. New findings this pass

### 3.1 M — `332a80e` "keep stat maps over anatomy" never runs for file opens

**[B] repro:**
1. Open `zstat1.nii.gz` (recognised as z from its name).
2. Open the MNI T1 with Open file….

The T1 lands on top. `LayerService.reorderLayers` was instrumented and is **never called**. Calling `anatomyUnderStatisticOrder()` by hand on the same store state returns the correct order, `[T1, z]`.

**Cause:**
- `VolumeLoadingService.ts:350` guards the reorder with `if (!config.replacement)`.
- `DisplayLifecycleOrchestrator.loadFile` (:386) always passes `replacement: { isCurrent }` (its stale-load guard).
- Every user file path goes through `loadFile`: File › Open, the Files panel, drop, BIDS and the browser transport. Only `TemplateService` loads can take the new branch.
- The unit test covers only the pure function.

**Fix idea:** key the reorder on a real replacement (`replaceLayerId`), not on the presence of the `replacement` object.

**Coverage gaps even when it runs [S]:**
- A T1 opened over an atlas-only base.
- 4D series.
- Mask or tissue templates.
- Opacity stays 1.0.

### 3.2 H — the NIfTI reader ignores `vox_offset` (cause of the Olsen MTL bug)

**Data [D]:**
- The Olsen MTL header has `vox_offset = 2752` and extension flag 0. The 2400 bytes between 352 and 2752 are zero.
- `nifti` 0.17 seeks to `vox_offset` only when an extension is present (`object.rs:491`, `extension.rs:152`). So data is read from byte 352: a 600-voxel shift (54 mm in x, 3 mm in y, wrapping at row ends).
- Left labels land at x ≈ −91…−64. "LH PRC" (id 7) has its centroid at (−80.9, 0.8, −32.5), matching yesterday's report.
- Right labels land in the left medial temporal lobe, so only the left side shows, part of it with "RH" names.
- 12,943 of 26,570 atlas voxels fall where the T1 is 0.
- Reading from `vox_offset` instead gives symmetric, anatomically correct regions.

**Independent repro [B]:**
- Copy `test-data/browser/oblique.nii` with `vox_offset` set to 2752 and zero padding. This is a valid NIfTI-1 file.
- The original samples 432 at (4, −1, 21) and 864 at the far corner.
- The padded copy samples **0 everywhere**.

**Scope:**
- The browser decoder and desktop's `nifti_loader` (via neuroim) use the same crate path.
- **Any** image written with a padded data offset loads shifted. This affects user data, not just this atlas.
- `neuroatlas`'s own ROI operations on Olsen are shifted the same way.

**Minor:** the Olsen file is on the FSL MNI152NLin6Asym grid, while the menu labels it MNI152NLin2009cAsym (a few mm at most).

---

## 4. Browser host (§19) — first run

### Automated suites [B]

| Suite | Result | Note |
|---|---|---|
| `playwright.workspace-browser.config.ts` (the shared app) | **7/8** | "the actual App loads, inspects, navigates and unloads" fails only on its `errors == []` assertion. One console error, "Failed to load resource: 404", appears on the suite's fresh dev server, on two runs. The same steps on a warm server log no 404. Probably Vite re-optimising a dependency on a cold start; the URL was not identified. |
| `playwright.browser.config.ts` (`browser.html`) | **33/34** | Includes native-witness pixel comparisons, labels, surfaces, 4D, catalog atlases (`freesurfer_aseg`, `olsen_mtl` keep their real label ids), session restore and device loss. The failure, "production PWA reloads offline", gets installability error `in-incognito`: Playwright contexts are incognito in this Chromium build. Environment, not app. |

### Shared-workspace parity gaps [B]

These hold in `workspace.html`, though the standalone viewer handles some of them:

- **Surfaces:** `load_surface` is unsupported, so opening a `.surf.gii` fails. The Files drop hint still says "NIfTI or GIfTI".
- **Label files:**
  - The `labels.tsv` sidecar isn't read (`plugin:fs|read_text_file` unsupported).
  - `register_categorical_colormap` is unsupported.
  - Result: `labels.nii` shows no colours, and regions are named "Label 17" instead of "Region seventeen".
- **NIfTI intent is dropped:** `core/browser_host/src/source.rs:174` hardcodes `statistic: None`. An intent-5 z map loads as a plain image. Only name inference (`zstat1`) works.
- **4D:** loads as `TimeSeries4D`, but there's no time row and the status bar says "No time axis".
- **Mosaic:** fails (`query_slice_axis_meta` unsupported).
- **Rendering:** every render logs a `render_views` fallback warning.
- **Image Header (Ctrl+I):** no dialog.

---

## 5. Checks run

| Check | Result |
|---|---|
| `pnpm --filter temp-ui build:browser`: `cargo build --release -p browser_host --target wasm32`, `tsc -b`, `vite build` | Pass |
| `pnpm --filter temp-ui exec vitest run` on the five test files for code changed since `e3d7ce3`, plus `surfaceStore.geometry` | 5 files, 38 tests pass |
| `cargo test -p browser_host --test host` (SwiftShader Vulkan) | 4/4 pass |
| `cargo test -p gifti-loader -p templates -p atlases -p render_loop -p nifti-loader` (SwiftShader Vulkan) | 321 passed, 0 failed, 22 ignored. The 22 are perf/debug tests marked `#[ignore]` in source. No GPU test printed SKIP. The render goldens pass within tolerance but are not byte-identical to the committed (Metal) baselines. |
| Browser E2E | See §4 |

**Not run:**
- `cargo test -p brainflow` and `api-bridge`: they need Tauri's system libraries (webkit2gtk), which this container lacks.
- Clippy and fmt.
- Any native macOS behaviour: menus, Finder, WKWebView keys and wheel, Metal, SSH, Set studio, template downloads, memory.

---

## 6. Still needs the native app

- Top issues 4–7 and 10 (drag-drop, ghost rows, black surface tab, population lens, duplicate panels).
- ⌘A, `?`, Space and the wheel on a real device.
- The ASEG Clusters case.
- Export visuals after `8083761`.
- Files panel: unmount and retry.
- Load atlas dialog, Image Header, Show Crosshair menu state.
- §1 CLI, §12 plots, §14 dialogs, §17 memory/endurance (still blocked by the lack of unload).

## 7. Housekeeping

- The repo is unchanged apart from this file.
  - `test-data/unit/{tpl-…_T1w,unscaled_i16,unscaled_u8}.nii` show as modified but are byte-identical to `HEAD`. `.gitattributes` marks them as LFS while the commits hold raw blobs, so touching them makes the clean filter report a change.
  - Test runs rewrote `core/render_loop/debug_*.png`, and `pnpm install` rewrote tracked `node_modules/.bin` shims. Both were restored. Tests that write into tracked paths are worth moving to `target/` or `cruft/`.
- Read access was added to this session for the private git dependencies Cargo needs: `bids-rs`, `neuroim-rs`, `neurosurf-rs`, `gifti-rs`, `remotely`, `templateflow-rs` and `neuroatlas-rs`. They were cloned beside the repo in the container only.
- Fixtures were synthetic, generated from the public MNI template: a z map, a 2 mm head, truncated/empty/non-NIfTI files and the padded `vox_offset` copy. Screenshots and fixtures stayed in the session scratchpad; none were committed.
