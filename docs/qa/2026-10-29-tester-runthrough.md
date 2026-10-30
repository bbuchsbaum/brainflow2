# Brainflow desktop: stress-test run-through for a human tester

**Purpose.** Exercise every window, panel, menu item and interaction, and push the
app hard enough to expose bugs. Where a fixture has a known answer, the expected
value is given; report any difference.

**Time.** About 4–5 hours in full. Sections are independent, so they can be split
across sessions. Sections marked ★ are the highest priority.

**Build under test.** Use a fresh debug bundle of current `main`, not
`/Applications/Brainflow.app`, which may be stale:

```sh
cd ~/code/brainflow2 && git pull && pnpm install
pnpm --filter temp-ui build:browser   # once: generates the browser-host WASM the bundle imports
cargo tauri build --debug
open -n target/debug/bundle/macos/Brainflow.app
```

Record the commit (`git rev-parse --short HEAD`) at the top of your report.

---

## 0. Before you start

1. **Logs.** Keep the bottom dock open (press `p`) on the **Log** tab, and the
   status bar **Diagnostics** button within reach. Copy any error line exactly.
2. **Report each problem** in this form:
   - **Where:** section and step number (e.g. 7.3).
   - **Did / expected / got:** what you did, what you expected, what happened.
   - **Evidence:** a screenshot (⌘⇧4), the exact log line, and the file used.
   - **Reproducible:** always, sometimes or once.
   - **Severity:** H = wrong result or crash, M = feature doesn't work,
     L = polish.
3. **Known open bugs** are listed in §20. Confirm whether they still occur; you
   don't need to write them up again.
4. **Fixtures.** All paths below are absolute.
   - **Underlay:** `~/code/brainflow2/test-data/unit/tpl-MNI152NLin2009cAsym_res-01_desc-brain_T1w.nii`
     (written **MNI T1** below).
   - **Phase 4 fixtures with answers:** `~/Documents/brainflow-p4-native/fixtures/`
     (answers in `truth.json` there).
   - **Alpha phantom:** `~/code/brainflow2/dist/alpha/0.1.0-alpha.1/fixtures/`
     (answers in `docs/alpha-acceptance.md`).
   - **Small exact-value fixtures:** `~/code/brainflow2/test-data/browser/`
     (formulas in its `README.md`).
   - **NeuroTabs manifests:** `~/code/brainflow2/core/field_table/fixtures/neurotabs/`.

---

## 1. Launch and command line

1. Launch with no arguments. The app opens with an empty Orthogonal view and the
   Files panel saying "No directory mounted". The Log shows no errors.
2. Quit, then launch with arguments:
   ```sh
   open -n target/debug/bundle/macos/Brainflow.app --args -o <MNI T1> -w mosaic
   ```
   Expected: the MNI T1 opens in a Mosaic view.
3. **Launch arguments**, one launch per variant:
   - `-t MNI152NLin2009cAsym_T1w_2mm` loads a template.
   - `-m ~/code/brainflow2/test-data` mounts a directory.
   - Positional files: two NIfTI files, which should open as two layers.
   - Error cases, which should give a readable message rather than a hang: an
     unknown `-w foo`, an unknown `-t nope`, and a missing file path.
4. Run `-h` and `-V` in a terminal. Both print and exit.

## 2. Files panel and mounting ★

1. **Mount Directory… (⌘O):** mount `~/code/brainflow2/test-data`.
   - Check the breadcrumb and the four view tabs: Tree (T), BIDS (B), Images (I),
     Loaded (L).
   - **Images tab:** is it empty after mounting? That is a known L bug.
2. **Filter bar:** search for `oblique`; sort by Name, Modified, Size and Type,
   ascending and descending.
   - Clearing the search restores the full tree.
   - Does the breadcrumb shift rows?
3. **File-row context menu** (right-click):
   - On a file: Open, Add as layer, Open in new tab, Open in comparison view.
   - On a folder: Open in Set studio…, Open as switchable layer…, Expand, Open as
     BIDS dataset.
   - Use each item once and confirm it does what it says.
4. **Recents** (a QA fix, so re-verify): unmount, then click the recent location.
   - It must **reopen that path directly**, not open a generic folder picker.
   - Pin it, then click it under Pinned. Unpin it. Use "Clear recent locations".
5. **Moved path:** rename the mounted folder in Finder, then click its recent
   entry. You should get a clear error that it moved, not a hang.
6. **Remote (SSH) dialog:** Mount remote (SSH)… Without a real server, try:
   - an empty host (Connect must be blocked or explained);
   - a bad host (a readable error);
   - each Auth method in turn (the fields change correctly);
   - Cancel at each step.
   - With a server: host-key Reject, then Trust & Continue; the "Remember in
     keychain" switches; a saved profile reused.
7. **Drag and drop** a `.nii.gz` onto a view, three ways:
   - plain: adds a layer;
   - with Shift: opens Comparison;
   - with Alt: opens a new tab.

   Then drag a `.txt` or `.png`: it must be refused gracefully.
8. **File › Open File… (⇧⌘O)**, then each of the **Open File As ›** items with a
   NIfTI file and with a GIfTI file.
9. **Note:** ⌘O mounts and ⇧⌘O opens, which is the reverse of the usual macOS
   pairing. This is known (§20); just confirm the menu matches its labels.

## 3. Volumes and exact values ★

Use the status bar (Crosshair, ijk, Value) and the Inspector Data section.

1. **Alpha phantom:** open `sub-alpha_asymmetric_T1w.nii.gz`.
   - Go to world (−36, 0, 0) with `g`. Value = **900**.
   - Go to (36, 0, 0). Value = **600**.
   - Image › Image Header… (⌘I): 65×65×49 voxels at 2×2×3 mm.
   - Arrow-key steps move 2, 2 or 3 mm depending on the view.
2. **Oblique formula:** open `test-data/browser/oblique.nii.gz`.
   - Value = i + 10j + 100k. Check at least 5 voxels, including the corners
     (0,0,0) = 0 and (4,6,8) = 864.
   - The header shows an oblique transform. Display must not be mirrored.
     Check the orientation letters.
3. **Voxel edges:** open `p4 fixtures/edge/edge_border.nii` over the MNI T1.
   - The border ring has value 3 and is 10 mm wide.
   - At x = −29 the ijk shows **i = 1**.
   - Nothing should be visible or clickable beyond |x| > 40, and the volume must
     reach x = −40 to +40. A previous build stopped at ±35, so recheck this.
   - The ring must be the same width on both sides.
4. **Datatypes:** open `test-data/unit/scaled_i16.nii`, `scaled_u16.nii`,
   `unscaled_i16.nii` and `unscaled_u8.nii`.
   - Values are plausible and scaled data shows non-integer values.
   - The header's datatype, slope and intercept match.
5. **Label map:** open `test-data/browser/labels.nii.gz`. The IDs **17, 1024 and
   2047** read back exactly, and region names appear if a table is attached.
6. **Precision:** check that the Value slot, the Inspector and Go to max/min agree
   to the shown precision, and that negative numbers use a true minus sign.

## 4. Navigation, keyboard and mouse ★

Use the MNI T1 in Orthogonal (Locked).

1. **Slices:**
   - Left-click in each pane: the crosshair moves and the other panes follow.
     Clicks outside the image are ignored.
   - ←/→ step one slice; with Shift they step 10.
   - The wheel steps one slice per notch, 10 with Shift. Count 10 notches on a
     real mouse **and** on a trackpad.
   - **Known bug:** ↑/↓ and PageUp/PageDown do nothing (§20).
2. **Keys:**
   - `g` opens Go to coordinate. Try both World (mm) and Voxel, with valid,
     out-of-bounds and non-numeric input (e.g. "−37.5" pasted).
   - `o` goes to (0, 0, 0); `c` goes to the image centre.
   - `l` toggles orientation labels.
   - `1`–`9` toggle layer N; `0` shows all layers.
   - `p` toggles the dock; `?` opens the shortcuts dialog.
   - ⌘K opens the palette (§15); ⌘I opens the header; ⌘⇧C copies the view to the
     clipboard (paste it into Preview).
3. **Key conflicts.** For each key, record what actually happens:

   | Keys | Native menu says | App says |
   |---|---|---|
   | bare `C` | Show Crosshair | go to image centre |
   | ⌘L | Layer Manager | toggle layout mode |
   | ⌘A | Atlas Browser | Select All in text fields |
   | ⌘P | Plot Panel | |
   | ⌘1–⌘6 | new workspaces (⌘6 = Integrated) | presets (⌘6 = BIDS) |

   Then type each letter into a text field (search, Go to). It must type the
   letter, not trigger the shortcut.
4. **Right-drag** on a slice adjusts window/level. It must not also open the
   context menu.
5. **Time mode** (needs 4D, see §10): `t` switches the wheel and arrows to
   frames; Space plays and pauses.

## 5. Layers and Inspector ★

1. **Load sheet** (Inspector, "+ Load"): Load volume…, Load surface…, Load
   atlas… and Project volume to surface…. Open each once and cancel each once.
2. **Layer stack.** Load 4 or more layers: MNI T1, a z-map (`p4/zmap/p4_zmap.nii`),
   a mask and an atlas.
   - Drag to reorder: the render order follows.
   - Toggle visibility, remove a layer and re-add it.
   - Is a new layer auto-selected? Known L bug: it isn't.
3. **Render section, on every layer kind.** Try each item:
   - every colormap: Grayscale, Viridis, Hot, Cool, Plasma, Inferno, Magma,
     Turbo, PET Hot Metal, fMRI Red-Blue, Jet, Parula, HSV, Phase;
   - Intensity and Threshold, by dragging the slider and by typing values,
     including invalid ones such as "12 mm" or a minimum above the maximum;
   - Opacity 0 and 1;
   - Interpolation Nearest and Linear;
   - Blend mode;
   - "Colorbar on view".
4. **Known H bug.** Select a Hot base layer, then a grayscale overlay. Does the
   colormap label still read "Hot"? Try both orders.
5. **Statistic map.** Select the z-map.
   - The Data section shows a "Statistic" row.
   - Threshold wording names the statistic (e.g. "|z| ≤ 3.1 hidden").
   - Go to max and Go to min jump to the extremes.
6. **Atlas layer:** label display Fill, Outline and Both; outline colour and
   thickness; the "Regions" legend.
   - Clicking in the brain shows the region in the status bar.
7. **View behavior rows** (Orientation markers, Hover sampling, Slice border).
   They look like settings but are read-only. Note any you expect to be editable.
8. The **Annotate** tab is a stub ("not yet enabled"); confirm that's all it does.

## 6. Templates and atlases menus ★

1. **Templates.** Use every item: MNI152 2009c (T1 1/2mm, T2 1/2mm, Tissue
   Probability GM/WM/CSF 1/2mm, Brain Masks, Skull-stripped Brain 1/2mm), Colin27
   (T1w, Brain Mask) and MNI305 (T1w, T2w, Brain Mask).
   - Each loads, or gives a **readable** error. "undefined" or "Unknown error" is
     a bug.
   - The skull-stripped brain must load as an image, **not as a mask** (a QA
     fix).
   - First load downloads. Disconnect from the network, try a template you
     haven't loaded, and expect a clear offline error.
2. **Atlases.** Use every item:
   - Schaefer 7 and 17 networks × {100, 200, 400, 600, 1000};
   - Glasser 1mm and 2mm;
   - ASEG 1mm and 2mm;
   - Olsen MTL;
   - the Surface Atlases.
   - Each loads with sensible colours and region names under the cursor.
   - For 1000 parcels, note the load time and responsiveness.
   - The Log line must show a rounded time and the full layer id (QA fix).
3. **Phase 4 atlas:** load `p4/zmap/atlas3_dseg.nii` with its `.tsv`. Each region
   outlines in its own colour with a dark halo. Single colour, selection,
   thickness and Fill all work.

## 7. Surfaces ★

1. **Surface Templates.** For each of fsaverage, fsaverage5 and fsaverage6, load
   White Matter, Pial and Sphere for both hemispheres, then for Left and Right
   only. That's 27 menu items. Each must load; Inflated was removed on purpose.
2. **Camera presets** (QA fix): Lateral, Medial and Dorsal must show **different
   poses**, on a single hemisphere and on both.
3. **Workbench mesh** (QA fix): open
   `test-data/surfaces/fslr32k/fs_LR.32k.L.inflated.surf.gii`.
   - It loads.
   - If it fails, the message must state the real reason, not "Unknown error".
4. **Overlays:**
   - Add `gaussian_splat_demo.func.gii` and `SensorimotorAssociation_Axis_LH.fslr32k.func.gii`.
   - Threshold, colormap, opacity.
   - Turn the Folding underlay on.
5. **Phase 4 surfaces:** `p4/surf/sub-p4_hemi-L_white.surf.gii`, then R, with
   their `_sulc` and `desc-saaxis` overlays.
   - Go to (−33, 19, 31). The **Vertex** slot shows **30226**.
   - Known: the Vertex slot fills only for pial or white meshes, and hover may
     not update it.
   - The right overlay must load. A previous fixture was mistagged CortexLeft; is
     it fixed?
6. **Project volume to surface…** with the z-map onto a pial surface.
7. **Size and zoom:** does the surface load tiny? Does scroll-zoom change it?
   After a successful load, is a previous surface error still showing in the
   status bar? Both are known M bugs.
8. **Surface export:** Export View as Image…, then "Surface lateral + medial". Both
   hemispheres must appear if both are loaded.

## 8. Workspaces and layouts ★

1. **Every way in:**
   - top-bar pills: Orthogonal, Integrated, Mosaic, Compare;
   - the Workspace dropdown: Read, Explore, Analyze, Compare, Set studio, BIDS;
   - View › Workspace menu: ⌘1–⌘6;
   - palette commands: Open Analysis Workbench and Open Set studio.

   Record which tab each one opens or creates. Repeats create "Mosaic 2" and so
   on; note whether that's wanted.
2. **Orthogonal Panels:** resize the panes and drag tabs.
3. **Mosaic:**
   - grids 2×2 to 5×5 and all three planes;
   - "Crosshair slice";
   - scroll through the slices.
   - Colorbars in the last column must not overlap images (known M bug).
4. **Compare:**
   - Load MNI T1 1mm and a 2mm template. Do the panes draw at the same scale?
     Known M bug: they don't.
   - With the Link controls (all, none, threshold, window), do the crosshairs
     stay linked?
5. **Integrated:**
   - Volume plus fsaverage pial/inflated: picking on the volume moves the surface
     cursor, and back again.
   - Is anatomy cropped in the top row? Do colorbars overlap the brain? Both are
     known M bugs.
6. **Layouts:**
   - Workspace › Save Current Layout…, then Rename, Delete (confirm the
     prompt) and Load.
   - Save two layouts with the same name.
   - Quit and relaunch: do saved layouts survive? GoldenLayout tree state is not
     persisted by design.
7. **Stress:**
   - Switch workspaces as fast as you can 30 times while a 4D file plays.
   - Close tabs while a file is still loading.
   - The app must not crash, show blank panes, or leave layers orphaned.

## 9. Clusters ★ (phase 4 truth)

Open the MNI T1 plus `p4/zmap/p4_zmap.nii`, then open the dock's **Clusters** tab.

1. Threshold |z| > 3.1, Sign Both, Connectivity 26, then Compute. The result:
   - **3 clusters**, with peaks **6.41, 4.90 and −4.75**;
   - **2 sub-peaks**, 5.36 and 4.60;
   - cluster 1 has **165 voxels** with its peak at **(−40, −20, 50)**.
2. Turn on "Cluster p (RFT)" with FWHM 8:
   - Two-tailed p(FWE) = **0.005452 / 0.9593 / 0.9891**.
   - With Sign +: **0.00273 / 0.798**.
3. **Pre-thresholded map:** `p4_zmap_thr31.nii`. p is withheld until
   `p4_brain_mask.nii` is chosen as the search mask.
   - Only the **binary** mask is offered; `p4_brain_mask_prob.nii` must not be
     offered.
   - Capture the exact "pre-thresholded" wording in a screenshot.
4. **Table interactions:**
   - Click a row, press Enter, use the arrow keys: each goes to the peak.
   - Expand the ↳ sub-peaks.
   - Copy CSV and paste it.
   - "Series for cluster N" (needs 4D, §10).
   - Change the threshold: the table marks itself **Stale**.
   - Compute takes under 2 s.
5. **Known M bug:** with a non-statistic layer or an atlas selected, Compute
   looks enabled but does nothing. Is there a "needs a statistical layer" note?
6. **Edge cases:** Min voxels larger than any cluster; threshold above the max
   (zero clusters, with a clear message); a negative-only map with Sign +.

## 10. 4D, time and series ★

1. **Raw 4D:** open `p4/raw4d/raw4d_bold.nii`.
   - It must load as **4D: 30 frames, TR 2 s**, not as one 3D frame with "No time
     axis". This was the blocker in the last native check.
   - At (−40, −20, 48), the peak is at **frame 8 (16 s), value 120**.
2. **Time controls:**
   - the status-bar TimeSlider;
   - `t` mode;
   - Space play and pause, while also scrubbing and changing layers.
3. **Series plot** (dock › Plot › Series):
   - Locus Voxel; then Sphere with Radius 0, 5 and 20 mm; then Region (pick an
     atlas region); then Cluster.
   - Copy CSV and Export image.
4. **Multi-run:** open `p4/multirun/sub-01_task-faces_run-{1,2,3}_bold.nii`.
   - Runs: "Runs of this acquisition"; layout Concatenated, Faceted, Overlaid.
   - The readout shows "**run 2 · frame 13/24**" with value **122**.
   - Open `concat/…desc-concat_bold.nii` with its `_runs.json` and confirm the
     same values.
5. **FIR:** in Set studio (§11), the fir3d and fir4d packages.
   - Faces peak at **2 TR**, houses at **4 TR**.
   - Faces − houses at lag 4 = **[−1.029, −0.678]**.
6. **Series plot export** through Export image: check the file. This wasn't run
   last time.

## 11. Set studio ★

1. **Empty state:** Open Set studio (⌘5 or the Workspace menu).
   - **Try an example.** Do the member counts agree everywhere (Matched, visible
     members, the Deck "n of m")?
   - Does the Deck card show the member's own image, not the main scene? Both
     are known M bugs.
   - **Open NeuroTabs manifest…** (a fix): a file chooser opens. Choose
     `core/field_table/fixtures/neurotabs/fir3d/nftab.yaml` and confirm the
     preview uses **that** file. Cancelling does nothing.
   - **Import table…:** load `test-data/unit/schaefer400_7networks_polynomial_metrics.tsv`
     and step through Map columns and Validate & Preview. Also try pasting text
     and an empty table.
   - **Choose a folder…:** use `p4/fir/fir_bids` (72 files) and review the
     proposed organisation.
2. **Manifest error paths.** Import each of the 12 manifests in
   `neurotabs/invalid/` (malformed YAML and JSON, duplicate keys, missing source
   file, shape mismatch, and so on).
   - Each gives a specific, readable error.
   - None crashes the app or leaves a half-imported set.
   - `faces-demo/nftab.yaml` references a missing `maps/group_stats.nii.gz`. Its
     image features must fail cleanly.
3. **Import dialog at the default window size** (a fix): the Cancel/Import footer
   must be visible. Shrink the window as far as it goes and check again.
4. **Lens switcher:** Population, Deck and Compare. Switch back and forth while
   things load.
5. **Population lens.** Use fir3d, or the example.
   - **Summary:** every kind (Mean, Median, MAD, SD, Cancellation, Mean absolute
     magnitude, Coverage); every plane.
   - **Arrangement:** Inspect, Montage, Groups.
   - **Navigation:** previous/next, Play/Pause, Forward/Reverse, speeds. Play
     for 2 minutes and watch for memory growth (Activity Monitor).
   - **Cutouts:**
     - Show individual cutouts.
     - Hover a cutout: its value appears.
     - Whole plane versus pinned region.
     - Change the cutout width.
   - **Brush:** Brush montage with Replace, Add, Intersect and Remove.
     - Known bug (§20): a drag over two cutouts may select **nothing**.
     - Lasso; range selection; Esc cancels.
   - **Hold to preview without…:** hold it on an observation, a participant,
     a group and a set.
     - The values table marks those rows "Previewing without".
     - Releasing restores everything.
     - Holding while switching lens must not leave it stuck.
   - **Values table:** the collapsed "**Outside the context (n)**" group appears
     once a scope or filter excludes observations. Each row has a reason; the
     rows are not focusable.
   - **Mask:** Choose mask…, then Change, then None.
   - **Participants:** Analysis unit, all three options; "Declare each
     observation a distinct participant".
6. **Spatial relationships** (new work, test carefully).
   - **Fit:** "Fit on current support" with Effect, then with Pattern shape. The
     fit line shows stress and "**nearest 3 kept: N%**".
   - **Scatter hover peek:**
     - Hover a point: after a moment a peek appears with that observation's
       slice. Hovering must **not** change the focus or the Inspector.
     - Click to focus. Arrow keys move between points; Enter focuses.
     - `p` pins; `a`/`c`/`s` switch plane.
     - The wheel or PageUp/PageDown over the peek scroll **only the peek's**
       slice.
     - Esc closes the peek.
     - Scroll fast for 10 seconds: does it stay responsive? Is the main view
       slow afterwards?
   - **Nearest table:** rank, distance, rank on screen.
     - **Compare** opens "Where two maps differ" for that pair.
     - Refit afterwards: the explanation must not reopen by itself.
   - **Nearest the selection centroid:** change the selection and watch the list
     update. Switch the summary to Median; the list should be disabled with a
     reason.
   - **Unassigned (n):** maps left out of the fit show a reason. If no fixture
     produces one, note that we need one.
   - **Out of date:** change the mask after fitting. You should see an "Out of
     date" badge, distances hidden and Compare disabled; refit clears it.
7. **Statistical question:** each method (One-sample, Welch, Paired, OLS) with
   valid settings and with deliberately invalid ones (wrong role, missing
   pairs). Errors must be specific. Use "Return to descriptive view".
8. **Groups and A/B:**
   - Group by factor, second factor, Reference B, Show A − B, Expand A and B,
     Show contributors.
   - Save a selection as a set; rename and delete it.
9. **Save and reopen:**
   - Save calculation, then Export summary….
   - Quit and relaunch, then Open saved population… for the same calculation.
     Focus, selection and probe are restored.
   - Rename the data folder, then use **Sources moved?** → Locate directory and
     open….
   - Edit a source file afterwards. You must get a hash-changed error and the
     current population must be left intact.
10. **Deck** (Inspect, Open source) and **Compare** (Reducer, Norm, Support,
    Threshold, Recompute).
11. **Leaving Studio** (a fix): the status bar must read **RAS**.
12. **Plot dock › Population:** Baseline, Difference A − B, Window; Create time
    courses from 4D images; Save plot + samples; Export PNG.

## 12. Dock tabs and plot modes

1. **Activity:** watch it during template downloads and long loads. Is progress
   shown? Can operations be cancelled?
2. **Plot modes:** Histogram, Series, Regions, Cohort, Trace and Population, each
   with no layer, a 3D layer, a 4D layer and an atlas.
   - An empty or incompatible state must say why, not show a blank panel.
3. **Log:** errors are readable, numbers are rounded, ids aren't cut off.
4. **Dock gestures:** resize, minimize, restore, close (`p`) and reopen it from
   View › Panels › Plot Panel (a fix).
   - **Do this inside Set studio too:** the dock must reappear there.

## 13. Export

Use View › Export View as Image… (⌘⇧E).

1. **Every target:** Axial, Sagittal, Coronal, Orthogonal layout, Figure row,
   Mosaic (From/To/Every, Columns), Surface, Surface lateral + medial.
2. **Every option:**
   - Preset: As shown, Figure.
   - Size: Screen with scale; Print at 89 or 183 mm and DPI 300/600.
   - Include: colorbar, slice position, letters, scale bar, crosshair.
   - Background: Black, White, Transparent (the preview shows a checkerboard).
   - Format: PNG, JPG.
   - "Embed provenance".
3. **Open each file.** Check that:
   - the pixel size matches the requested DPI and mm;
   - transparency really is transparent;
   - letters sit on the correct sides;
   - the colorbar doesn't cover the brain;
   - a lone stat map with no anatomy is framed on its blobs.
4. **⌘⇧C:** copy to the clipboard and paste it.
5. **Bad file names:** empty, very long, `/`, or an existing file (overwrite
   prompt?).

## 14. Dialogs

1. **Image Header (⌘I)** on 3D, 4D, oblique, statistic and label images. The
   Temporal and Statistic sections are correct.
2. **Crosshair Settings:**
   - every control: colour, presets, opacity, thickness, style, centre gap,
     mirror, snap to voxel;
   - Show crosshairs off, then View › Show Crosshair. Does a checkmark or label
     update? Known L bug: it doesn't.
3. **Go to coordinate:** see §4.2.
4. **Keyboard shortcuts (`?`):** every shortcut it lists actually works.
5. **Atlas information (AtlasConfigModal):** opens and closes.
6. **Open folder as image set:** Set name, Filter images….
7. **Every modal:** Esc closes it. Clicking outside behaves consistently. Focus
   returns to where it was.

## 15. Command palette (⌘K)

Run **every** command at least once:

- Mount Directory…, Open File…
- Crosshair Settings…, Toggle Snap to Voxel
- Copy Values at Crosshair (paste the result), Toggle Neurosynth Lookup (needs
  the network)
- Show Clusters, Go to Max, Go to Min
- Image Header…, Export View as Image…
- Open Set studio, Set studio: Import Table / Import NeuroTabs Manifest / Discover
  Files
- Open Analysis Workbench
- Show Files Panel / Subjects Panel / Inspector
- Go To Coordinate…, Show Keyboard Shortcuts
- Switch Preset: …, Load Layout: …

Also try: a fuzzy search ("hdr", "xhair"), arrow-key navigation, Esc, and ⌘K
while typing in a text field.

## 16. Native menus: every item

Tick off each item.

- **File:**
  - Open File…; Open File As › Add As Layer, Open In New Tab, Open In Comparison
    View;
  - Mount Directory…; Export View as Image…; Close Window.
- **Templates and Atlases:** see §6. **Surface Templates:** see §7.
- **Edit:** Undo/Redo/Cut/Copy/Paste/Select All, in a text field and in a view.
- **View:**
  - Enter Full Screen.
  - Show Crosshair.
  - Crosshair Settings….
  - Image Header….
  - **Panels ›** File Browser (⌘B), Layer Manager (⌘L), Atlas Browser (⌘A), Plot
    Panel (⌘P), Clusters. **Press ⌘B three times:** does it add duplicate "Files"
    panels? It probably does.
  - **Workspace ›** ⌘1–⌘6.
- **Window:** Minimize, Maximize.
- **Context menu on a view:**
  - **Hover Info…** is a known no-op (§20); confirm.
  - Orientation Labels, colorbar, Image Header…, Export View as Image….

## 17. Stress and endurance ★

Watch memory (RSS) in Activity Monitor throughout and note it before and after
each test.

1. **Load and unload 25×:** load and remove the MNI T1 plus the z-map 25 times.
   RSS should plateau, not climb.
2. **Many layers:** stack 8 or more layers, including two atlases with 1000
   parcels, then scrub slices quickly. Is it responsive? Is the FPS slot sane?
3. **Large data:** the biggest NIfTI you have, at 1 GB or more. Load time, and
   whether the UI stays responsive during the load. Cancel during the load.
4. **Window extremes:**
   - Resize to the minimum and to full screen.
   - Drag the window between displays with different DPI.
   - Text, colorbars and click-to-crosshair stay correct, and pixels stay square.
5. **Rapid input:**
   - Hold an arrow key for 10 s.
   - Spin the wheel hard.
   - Click quickly across panes.
   - Drag thresholds back and forth.
   - Hover the Studio scatter quickly.
6. **Interrupted work:** start a template download, a cluster compute and a
   relationship fit, then switch workspace, close the tab or quit mid-way.
   Relaunch: there must be no corrupted state.
7. **Sleep and wake** the Mac with the app open on a 4D movie, and on a remote
   mount if you have one.
8. **Two windows:** open a second app instance (`open -n …`). Do the instances
   interfere through shared settings or caches?

## 18. Error paths

1. **Bad files:**
   - a truncated `.nii` (`head -c 1000 x.nii > broken.nii`);
   - a `.gii` with garbage XML;
   - a zero-byte file;
   - a file renamed to the wrong extension.

   Each gives a readable error, and the app keeps working.
2. **Disappearing files:** delete a loaded file from disk, then interact with its
   layer. Unmount a folder while files from it are open.
3. **No network:** templates and atlases not yet downloaded; Neurosynth lookup.
4. **Permissions:** a read-only folder as the export target.

## 19. Browser build (optional)

1. Build and serve it:
   ```sh
   pnpm --filter temp-ui build:browser
   pnpm --filter temp-ui exec vite preview --config vite.browser.config.ts
   ```
   Then open `/browser.html` and `/workspace.html` in Chrome on localhost.
2. **Supported features:** open `oblique.nii.gz`, `oblique4d.nii.gz` and
   `labels.nii.gz` from disk.
   - Values match §3.
   - Playback works.
   - The octahedron surfaces and labels load.
   - Export works.
   - Reload while offline (PWA) and re-select the files.
3. **Limits:** more than 4 volumes, or a file over 256 MiB, gives a clear message.
4. **Unsupported features** (clusters, header, timeseries, mosaic batch) must say
   so, not fail silently.
5. Note what happens in Safari and in Firefox, which are unqualified.

## 20. Known open bugs (confirm; don't re-file)

| Sev | Bug |
|---|---|
| H | Colormap label stays "Hot" after selecting a grayscale overlay |
| H | (re-check) Raw 4D files loading as one 3D frame |
| M | Hover Info… context-menu item does nothing |
| M | Compare: 1mm and 2mm images drawn at different scales |
| M | Integrated crops anatomy; colorbars overlap images (Integrated, Mosaic, Compare) |
| M | ↑/↓/PageUp/PageDown don't move slices; the wheel may step too little |
| M | Set studio example: Deck card shows the main scene; counts disagree |
| M | Surface loads tiny; weak zoom; stale surface error in the status bar |
| M | Clusters Compute looks enabled on non-statistic layers |
| M | Montage brush: dragging across two cutouts selects nothing |
| L | ⌘O / ⇧⌘O reversed; bare `C` and other accelerator conflicts (§4.3) |
| L | View › Show Crosshair has no checkmark |
| L | ⌘B may add duplicate Files panels |
| L | Files › Images tab empty after mount; breadcrumb shifts rows |
| L | New layers not auto-selected; Annotate is a stub; Advanced section empty |
| L | Midthickness template surfaces unavailable; template checksums not verified |

**Fixed in source but not yet confirmed in the app** (please confirm): the
GIfTI `Version="1"` mesh, Skull-stripped Brain, the fsaverage camera presets,
Recents reopening, RAS after Studio, the manifest chooser, the import dialog
footer, and View › Panels › Plot Panel in Studio.
