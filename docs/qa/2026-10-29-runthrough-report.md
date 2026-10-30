# Brainflow desktop run-through — 2026-10-29 (evening)

**Build:** `/Applications/Brainflow.app` (reinstalled; launched 18:17 local). Repo HEAD at test time: `e3d7ce3e`. Not a fresh `cargo tauri build --debug` from that commit, so treat the "QA fix confirmed" lines as confirming whatever the installed bundle contains.
**Driven by:** Claude via computer use (synthetic mouse/keyboard; no physical trackpad/wheel), following `docs/qa/2026-10-29-tester-runthrough.md` and the open list in `docs/qa/2026-10-29-desktop-walkthrough.md`.
**Coverage:** §2 Files, §3 exact values, §4 navigation/keys, §5 layers, §6 templates/atlases, §7 surfaces, §8 Mosaic/Compare, §9 clusters (all truth values), §10 4D/series/FIR, §11 Set studio (partial), §13 export, §15 palette (partial), §16 View menu, §17 memory snapshot, §18 bad files. **Not run:** §1 CLI arguments, §12 plot modes in full, §14 most dialogs, §17 stress/endurance, §19 browser build, SSH with a real server, multi-run, p4 surfaces / Vertex 30226, project-volume-to-surface, layout save/restore.

Severity: **H** wrong result, crash or unusable; **M** feature doesn't work; **L** polish.

---

## 1. Top issues (fix first)

| # | Sev | Area | Issue |
|---|---|---|---|
| 1 | H | Atlases | **ASEG names/colours are wrong:** left putamen reads "RH Putamen"; right hemisphere is uncoloured ("label 51"). Label table keyed 1…17, volume holds FreeSurfer IDs. |
| 2 | H | Atlases | **Olsen MTL is drawn outside the brain** (e.g. "LH PRC" at (−80, 0, −36), lateral to the temporal lobe, where the T1 is 0). |
| 3 | H | Geometry | **Display frame comes from the first layer's voxel axes.** With an oblique/permuted first layer, the "Sagittal" pane shows a coronal plane, "Coronal" shows a sagittal plane, axial is rotated 90°, and later layers are cropped to the first layer's extent. |
| 4 | H | Files | **Drag-and-drop from Finder never loads** ("Unable to resolve dropped file path"); `dragDropEnabled: false` + no path on HTML5 `File`. |
| 5 | H | Files | **Tree search leaves ghost rows:** stale and duplicate rows painted over the tree after any search; the tree is unusable until remount. |
| 6 | H | Surfaces | **Auto-opened surface tab for fsaverage5 Pial is black** (the gizmo responds; nothing renders). Same surfaces render in Integrated. |
| 7 | H | Set studio | **Population lens shows no images after a NeuroTabs import** ("Focus window does not match its requested observations", "Mean · 0 observations"). |
| 8 | M | Layers | **No way to remove/unload a layer** (no menu item, no Delete key, no palette command). |
| 9 | M | Layers | **New layers always go on top at 100 % opacity**, so a newly opened T1/template/4D hides every existing overlay and atlas. |
| 10 | M | Panels | ⌘B and View › Panels add **duplicate** Files/Inspector panels; closing them leaves dead space. |

---

## 2. QA-fix verification (from the earlier walkthrough)

| Fix | Result |
|---|---|
| GIfTI `Version="1"` (fs_LR inflated) loads | ✅ Loads (32,492 vertices) and renders in its own tab |
| Real reason instead of "Unknown error" | ✅ Garbage `.surf.gii` shows geometry *and* fallback reasons |
| Skull-stripped Brain (2 mm) loads as an image, not a mask | ✅ "volume overlay", greyscale, 97×115×97 at 2 mm |
| New catalog entries (GM 2 mm) | ✅ GM 2 mm loads (3.4 s incl. download) |
| fsaverage camera presets give different poses | ✅ In Integrated: Lateral/Medial/Dorsal/Ventral differ, gizmo correct. ⚠ With both hemispheres, Medial shows the *other* hemisphere's lateral face. |
| fsaverage "Inflated" removed | ✅ Menu is White Matter / Pial / Sphere / Single Hemisphere › |
| Recents reopen their path | ✅ Recent and Pinned mount directly. ⚠ Retry after a moved-folder error is broken (see §2.5). |
| RAS after leaving Studio | ✅ |
| Log: rounded ms, full layer id | ✅ (but a 36-character UUID is now the only identifier; use the file name) |
| NeuroTabs manifest chooser uses the chosen file | ✅ |
| Import dialog footer visible | ✅ |
| Dock visible in Studio | ✅ |
| Subjects panel copy | ✅ |

## 3. Known-bug status (§20 of the run-through)

| Known bug | Status |
|---|---|
| H Colormap label stays "Hot" on a grey overlay | **Not reproduced** (correct in both orders) |
| H Raw 4D loads as one frame | **Fixed:** 30 frames, TR 2 s; frame 9 (16 s) = 120 ✓ |
| M Hover Info… does nothing | **Confirmed** |
| M Compare 1 mm vs 2 mm scale | **Confirmed, worse:** see §8.4 |
| M Integrated crops/colourbars overlap | Mosaic colourbar now in its own gutter ✓; Integrated not re-checked |
| M ↑/↓/PgUp don't move slices | **Confirmed**; wheel see §4.1 |
| M Set studio Deck shows main scene / counts disagree | **Not reproduced** with fir3d (counts 72/72/"3 of 72"; Deck shows the member) |
| M Surface loads tiny / weak zoom / stale error | Small on load: confirmed. Zoom works (20 notches fills the pane). |
| M Clusters Compute on non-statistic layers | **Confirmed** (§9.5) |
| L ⌘B duplicates Files | **Confirmed, worse** (§16) |
| L View › Show Crosshair no checkmark | **Confirmed** |
| L Images tab empty after mount | **Confirmed** (default tab is now Tree) |
| L New layers not auto-selected; Annotate stub; Advanced empty | Not re-checked |

---

## 4. Findings by section

Format: **Did → Expected → Got**, repro, severity. "Always" means reproduced every time I tried (≥ 2 times unless noted).

### §1 Launch
- **1.1 L.** Launch with no args → expected an empty Orthogonal view → got the last session's tab set restored with **Compare** in front. Log clean. The window size is not restored (opens small every launch).
- **1.1 L.** Compare empty state: the "Add a panel to compare" text sits across the A/B divider and breaks the dashed line.
- 1.2–1.4 (CLI arguments) not tested.

### §2 Files panel
- **2.1** ⌘O → folder picker → mount OK. The default tab is now **Tree** with the root collapsed; footer reads "local · 0 files" until you expand. The Images tab is empty until folders are expanded (known L). BIDS and Loaded empty states are fine.
- **2.2 M — Search only covers expanded folders.** Search "oblique" with the tree collapsed → expected `browser/oblique*.nii*` → got "No matching files". Always.
- **2.2 H — Ghost rows after search/sort.** Expand `browser/`, search "oblique" → results are drawn **on top of** the old rows (overlapping, garbled text); non-matches stay with stray "o" highlights. Clearing the search, sorting by Size/desc, or collapsing the root leaves orphan rows floating with no parent; switching tabs doesn't clear it. Always. (Screens: garbled rows in the Tree at 18:18–18:19.)
- **2.2 L.** macOS autocorrect bubble under the search field ("Oblique"); set `autocorrect`/`spellcheck` off. Same in ⌘K and Go-to.
- **2.2 L.** Type badges are inconsistent: `oblique4d.nii` shows NII but `.nii.gz` shows 4D; `octahedron.surf.gii.gz` is not listed at all; `.label.gii` shows "GII".
- **2.3** The file context menu (Open, Add as layer, Open in new tab, Open in comparison view) is present. "Open" loaded into the current Compare panel A.
- **2.4 ✅** Recent and Pinned reopen their path directly.
- **2.4 M — "Unmount selected" unmounts the wrong root.** Roots [refs, test-data] → click the refs row → ⋯ › Unmount selected → **test-data** was removed. Root-row clicks don't change the "selected" root. Reproduced once (cleanly).
- **2.5** Renamed `test-data/refs` on disk → clicked its recent → readable "Directory '…/refs' does not exist" + Retry; no hang ✓.
  - **M:** after restoring the folder, Retry → "Directory '' does not exist" (empty path).
  - **L:** the dead root can't be dismissed (Unmount is disabled); no Log line; no "Remove from recents".
- **2.6 SSH (no server).**
  - Empty host → "Host, user, and remote path are required." ✓
  - Bad host → readable DNS error in ~3 s ✓
  - All four auth methods switch fields correctly ✓; Esc closes ✓
  - **L:** "Save connection profile" defaults **on** with the existing profile's name while you type a different host, so a typo host would overwrite the saved trillium profile.
  - **L:** the error row pushes the fields down about 12 px while you type.
- **2.7 H — Drag-and-drop doesn't load.**
  - Did: dragged `test-data/browser/oblique.nii.gz` from Finder onto the empty view.
  - Got: a "Drop neuroimaging files…" overlay, then the status error "Unable to resolve dropped file path for oblique.nii.gz". Nothing loads and nothing is written to the Log. Always.
  - Cause: `src-tauri/tauri.conf.json` sets `"dragDropEnabled": false`, and `DisplayLifecycleOrchestrator.extractDroppedFilePath` only accepts Electron-style `file.path`.
  - The Shift/Alt drop variants and non-image refusal are untestable until this is fixed.

### §3 Volumes and exact values
- **3.1 ✅ Alpha phantom.**
  - (−36, 0, 0) = 900 and (36, 0, 0) = 600.
  - ⌘I: 65×65×49 voxels at 2×2×3 mm, RAS.
  - Arrow keys step 2/3 mm per view.
- **3.2 Oblique** (`oblique.nii.gz`, alone, fresh launch):
  - **Values ✅:** (0,0,0)=0; (4,6,8)=864; (1,2,3)=321; centre (2,3,4)=432 at (4,−1,21), matching `i+10j+100k` and the sform.
  - **H — Panes are not world planes.**
    - Expected: axial with A up; sagittal at constant x; coronal at constant y.
    - Axial got: L at top, R at bottom, P left, A right.
    - Pane labelled "Sagittal x 6.0 mm" got: a plane where clicking left/right changes x (−2 → +8) at fixed y, i.e. a coronal plane, with L/R letters.
    - Pane labelled "Coronal" got: a sagittal plane.
    - Letters are self-consistent, so the image isn't mirrored, but the planes follow voxel axes.
    - Always.
  - **H — Same root cause with mixed layers.** Open `labels.nii` first, then the MNI T1. The T1 is shown rotated and **cropped to the 5×7×9 labels extent**, and headers say "labels". Colin27 loaded later is also cut off at the top and bottom. The field of view is the first layer's bounds, not the union.
- **3.3 ✅ Edge fixture** over MNI (Nearest).
  - Values: x=−39 → 3, −31 → 3, −29 → 2, +39 → 3, ±41 → nothing; ring widths look equal.
  - **L:** the status-bar ijk is the *reference* grid ("67 137 83 · ref 1 mm"), so "i = 1 at x = −29" can't be read anywhere. Show the active layer's ijk too.
  - **L:** the overlay defaults to Linear, which smears the 10 mm checkerboard.
  - **L:** the histogram for 1/2/3 data draws 1-px bars; the largest bar (value 3) sits on the frame and is almost invisible.
- **3.4 Datatypes.** `scaled_i16.nii`: (0,0,0) reads 12.3 (raw 123 × 0.1) ✓; range 0.5–100 ✓.
  - **M — Image Header shows "Data type f32"** for an int16 file and has **no slope/intercept rows**, so §3.4's header check can't pass. Show the stored datatype, bitpix, scl_slope/inter, cal_min/max and intent.
  - **L:** a 2×2×2 mm volume is invisible at default zoom; there's no "zoom to layer".
- **3.5 ✅ Labels** (`labels.nii`): 17 "Region seventeen", 1024 "Region thousand", 2047 "Last region", 0 "—"; pixels square for the 2×3 mm grid.

### §4 Navigation and keys
- **4.1 ✅** ←/→ step one slice of the *hovered* pane; Shift steps 10. Clicks snap to voxel centres; clicks outside the image are ignored.
- **4.1 M (known)** ↑/↓/PageUp do nothing.
- **4.1 M?** Wheel:
  - A single notch moves one slice, but a burst of 10 synthetic notches still moves only **one** slice.
  - Wheel-up moves **inferior** (z decreases).
  - Please re-check with a real mouse and trackpad.
- **4.2** `o` goes to the origin ✓. `l` toggles letters ✓. `1` hides layer 1 ✓ (L: a grey footprint rectangle stays). `0` shows all ✓. `p` toggles the dock ✓.
- **4.2** ⌘⇧C copies the hovered slice ✓ (pasted into Preview).
- **4.2 M?** `?` didn't open the shortcuts dialog (Shift+/ and a typed "?"); re-check with a physical keyboard.
- **4.2 L** The Mouse slot keeps the last in-image position after the pointer leaves the image.
- **4.3 Key conflicts — what actually happened:**

  | Keys | Result |
  |---|---|
  | bare `c` | App handled it (crosshair *not* hidden) |
  | ⌘L | Nothing visible |
  | ⌘A | **Selects all text in the whole window** (every panel highlighted); clicking a view doesn't clear it. M |
  | ⌘P | Dock switches to Plot |
  | ⌘1 | Creates a new "Orthogonal 2" tab |
  | ⌘6 | Creates "Integrated 2" (not BIDS) |
  | Letters typed into a text field | Typed normally ✓ |

### §5 Layers and Inspector
- **5.2 M — No remove/unload.** The layer context menu and Files › Loaded both offer only "Reload". Delete/Backspace do nothing, and ⌘K has nothing for "remove"/"unload". Load/unload stress (§17.1) is impossible.
- **5.2 M — New layers land on top at full opacity.** The list order is bottom → top (the first row is drawn first). A "base volume" T1 opened after an atlas hides it. The skull-stripped template, Colin27, the 4D BOLD and the Studio's "Faces beta" all covered every overlay. Always.
- **5.2 L** Reordering needs a slow drag; a quick drag is ignored.
- **5.3 M — Opacity is lost on hide/show:** 48 % → toggle Visible off/on → 100 %.
- **5.4 ✅** Colormap label follows the selected layer (Hot ↔ Greyscale, both orders).
- **5.1 L/M — Load atlas… dialog doesn't close on success.** It shows a green "Atlas Loaded Successfully · Volume Handle: atlas_olsen_mtl_5dadc55c-…" panel with Load still enabled, so a second click loads a duplicate. It also exposes an internal handle.
- **5.6 M — "[object Object]"** is shown in red under the ROI ID field on the ASEG layer.

### §6 Templates and atlases
- **6.1** Skull-stripped Brain 2 mm ✅, GM 2 mm ✅, Colin27 T1w ✅.
  - **L:** Colin27's first download took about 81 s with no size or ETA. Progress sat at 100 % for about 30 s.
  - **L:** Activity (80.9 s) and Log (8148 ms) disagree on the duration; every load shows the same mismatch (two clocks).
  - **L:** Skull-stripped Brain is filed under "Brain Masks".
- **6.2 H — ASEG mis-labelled.**
  - Did: Atlases › Subcortical › ASEG (2 mm) over the MNI T1; clicked the magenta structure at x = −30 (left).
  - Expected: "LH Putamen".
  - Got: **"RH Putamen"**. The mirror point x = +28 is uncoloured and reports "label 51" (Inspector) / "—" (status bar).
  - Diagnosis: the Regions legend is keyed 1…17 (1 LH Thalamus, 2 LH Caudate, 3 LH Putamen … 10 RH Thalamus), but voxels hold FreeSurfer LUT ids (12 = Left-Putamen, 51 = Right-Putamen). Lookup by row index gives wrong names and colours on one side and nothing on the other.
  - **Likely downstream:** `ASEGAtlas` comes from `neuroatlas` (`core/atlases/src/service.rs:722`).
  - Always.
- **6.2 H — Olsen MTL misplaced.** A lavender region is drawn outside the left temporal lobe and reports "LH PRC" at (−80, 0, −36) where the T1 is 0; only the left side appears. Wrong affine or scale (1 mm MNI2009cAsym chosen). **Likely downstream (`neuroatlas`)**, same as ASEG.
- **6.2 L** The Atlases menu loads ASEG directly, while + Load › Load atlas… opens a config dialog. The two entry paths differ.
- **6.2 L** Hover updates only the Mouse slot. Value/Region and the Inspector ("At pointer · ijk …") refresh only on click.

### §7 Surfaces
- **7.1 H — Black surface tab.**
  - Did: Surface Templates › fsaverage5 › Pial (both), with about 8 volume layers loaded.
  - Got: a new "fsaverage5_pial_left" tab ("In Surface" mode) that renders **nothing**. The gizmo rotates on drag; presets, scroll and tab switches don't help; the dock disappears.
  - The same meshes render in Integrated. A later fs_LR tab rendered fine.
  - Reproduced once; worth a focused repro.
- **7.1 M** After this, the tab strip misbehaved:
  - Clicking "Orthogonal" didn't leave the surface tab.
  - The Integrated pill created "Integrated 3" and reshuffled the tabs.
- **7.2 ✅** Presets differ (see §2 table). **L:** a new surface tab inherits the last preset (opened in Ventral). **L:** the header says "Surface · left" while both hemispheres show.
- **7.3 ✅** fs_LR Workbench mesh loads.
- **7.4 ✅** Overlay `SensorimotorAssociation_Axis_LH…func.gii` attaches via File › Open with the mesh selected; threshold and Turbo colormap work.
  - **L:** the surface Inspector has no "Add overlay…" control, so that path is undiscoverable.
  - **L:** colormap names are truncated ("PET Hot M…").

### §8 Workspaces
- **8.3 Mosaic ✅.**
  - Grid options and paging work, and the colourbar is now in its own gutter.
  - **L:** tiles step 1 mm while the top layer is 4 mm, so four identical tiles appear in a row.
  - **L:** a 5×5 grid leaves about 40 % of the pane empty.
- **8.4 Compare M.**
  - The pill created **"Compare 2"** with **7 panes in one row** (one per visible volume), each about 120 px wide.
  - **M:** pane headers show only "Value …", with no A/B/C letter or layer name, so panes can't be identified. Most show the same Hot T1.
  - **M (known, worse):** the `scaled_i16` pane is zoomed so its 2 mm extent fills the pane, while neighbours show whole brains. Each pane fits its own bounds instead of a shared world FOV.
- **8 L** Workspace pills and ⌘1–⌘6 keep creating "… 2"/"… 3" tabs instead of focusing existing ones.

### §9 Clusters ✅ (all truth values match)
- **9.1** |z| > 3.1, both signs, 26-connectivity:
  - 3 clusters with peaks 6.41 / 4.90 / −4.75.
  - Cluster 1 has 165 voxels with its peak at (−40, −20, 50).
  - Sub-peaks 5.36 and 4.60.
  - Under 2 s.
- **9.2** RFT, FWHM 8:
  - p(FWE) both signs 0.005 / 0.959 / 0.989.
  - Sign +: 0.003 / 0.798 (CSV 0.00273 / 0.7982).
  - The Stale banner works.
- **9.4** A row click goes to its peak ✓. Copy CSV includes a full provenance header ✓.
  - **L:** arrow keys didn't move the selection after a click.
  - **L:** the table ijk (layer grid) differs from the status-bar ijk (reference grid).
  - **L:** "4.9" in the status bar vs "4.90" in the table.
- **9.5 M (known)** With the ASEG atlas selected, the header becomes "FreeSurfer ASEG |value| >", the threshold box is red, and Compute looks enabled but does nothing. Its tooltip is clipped at the dock edge. The helpful line "Table for p4_zmap. Select p4_zmap to change its parameters." is there, but the controls should be disabled for label layers.
- 9.3 (pre-thresholded map + mask) and 9.6 edge cases not run.

### §10 4D, series, FIR
- **10.1 ✅** `raw4d_bold.nii` loads as 30 frames at TR 2 s; at (−40, −20, 48), frame 9 (0:16) = 120.
- **10.2 M — Space doesn't play/pause.** The ▶ button plays in real time and pauses ✓; `t` + → steps a frame ✓.
- **10.3 ✅** Series works:
  - Voxel and Sphere 6 mm (19 voxels) both peak at 120 / 16 s.
  - Cluster mode works.
  - Region mode gives a clear "No atlas or label region at the crosshair… Load atlas…".
  - **L:** the plot defaulted to "Regions" (a bar chart of Olsen regions) rather than Series after the 4D load.
- **10.5 ✅ FIR (fir3d):** faces peak at lag 2, houses at lag 4 (95 % CI, df = 5).

### §11 Set studio
- **11.1 ✅** The manifest chooser previews the chosen `fir3d/nftab.yaml` (72 matched); the import footer is visible.
- **11.5 H — Population lens empty.** After import: red "Focus window does not match its requested observations."; "Mean · 0 observations", "Actual observation · none", both panes "No population image". This is despite "72 selected / 72 available" in the Inspector. "Refresh images" doesn't help. Always.
- **11.10 ✅** Deck shows the member's own image; counts agree.
- **11.11 ✅** RAS after leaving.
- **11 M — Studio leaks into the workspace.** After using Deck, the main scene gained a "Faces beta (sub-01)" overlay drawn opaque over everything, and the Plot dock kept the Studio series.

### §13 Export (⌘⇧E)
- **13 ✅**
  - Saved Figure row, 2×, Transparent as a 3090×1123 RGBA PNG.
  - The corner pixel is fully transparent; pHYs is 144 dpi, which matches the 2× footer.
  - The preview checkerboard is correct.
- **13 M — Legend lists regions not in the image.** All the ASEG rows (LH Thalamus … RH Putamen) appear in the legend for slices at z = 48 where no ASEG label is present.
- **13 L**
  - "Crop to brain" cuts the coronal and sagittal heads flat at the top.
  - Letters of adjacent Figure-row panes collide ("R L").
  - The save dialog opens in the last folder used anywhere (here a repo fixture folder).

### §15 Command palette
- **L/M** No fuzzy matching: "hdr" and "xhair" → "No commands match". Autocorrect bubbles appear under the input. Shortcuts are shown as "Cmd/Ctrl+O" text.

### §16 Native menus
- **M** View › Panels › Layer Manager adds a **second Inspector** tab.
- **M** ⌘B ×3 adds **three more Files panels** (known L, now worse). Closing them leaves the Inspector about 90 px tall with about 550 px of dead space. A "Reset layout" is needed.
- **L (known)** Show Crosshair has no checkmark.
- **M (known)** Hover Info… is a no-op.
- ✅ Atlas Browser no longer claims ⌘A.

### §17 Memory (snapshot only)
At the end of the session (15 scene items, 4 surfaces, 8+ tabs):

| Process | Memory |
|---|---|
| WebView | 795 MB |
| Rust | 391 MB |
| GPU process | 115 MB |
| Open/Save panel service (still resident) | 95 MB |
| **Total** | **≈ 1.4 GB** |

Load/unload cycling isn't possible (no unload).

### §18 Error paths
No crashes; the app kept working after each one.

| File | Message | Verdict |
|---|---|---|
| `truncated.nii` (first 100 kB of MNI T1) | "ScalingError: Could not load file with any supported data type" | **M**, misleading: should say truncated / size mismatch |
| `empty.nii` and `wrongext.nii` (a TSV) | Raw Rust Debug text "Io(Error { kind: UnexpectedEof, message: "failed to fill whole buffer" })" | **L**: should say "not a NIfTI file" |
| `garbage.surf.gii` | Geometry reason + fallback reason | ✅ QA fix (L: logged twice, as "surface" and "ui") |

**L** Messages repeat their prefix ("Failed to load X: Failed to load file /path: …").

---

## 5. Downstream candidates
- **neuroatlas:** ASEG label-table keys (§6.2); Olsen MTL affine (§6.2). Confirm by loading the same atlases in another viewer; if they're right there, the bug is in how Brainflow maps `neuroatlas` labels.
- **surfview 3.1.0:** Medial with both hemispheres shows the contralateral hemisphere (§7.2), from the earlier note on per-hemisphere viewpoints.

## 6. Housekeeping
The test left these files in `~/Downloads`; delete them when convenient:
- `brainflow-qa-copy-view-test.jpg`
- `Faces_beta_sub-01_row_x-40.0_y-20.0_z48.0mm.png`
- `brainflow-qa-bad/`

The `test-data/refs` folder was renamed and restored (git clean). The saved SSH profile was not modified ("Save connection profile" was turned off before testing).
