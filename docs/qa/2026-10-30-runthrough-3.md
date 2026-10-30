# Brainflow desktop: run-through 3 (2026-10-30)

> Not to be confused with [2026-10-30-runthrough.md](2026-10-30-runthrough.md), the cloud re-check at `c66551d`. That re-check predates the fixes in this build.

**Purpose.** This run has three parts:

1. **Verify** the fixes made after the 21:37 rerun (`2026-10-29-rerun-report.md`).
2. **Exercise what neither run covered.** That means stress, the command line, saved layouts, and native-only behaviour.
3. **Do realistic tasks as a user would.** Note where the app makes you hesitate, guess or backtrack.

**Time.** About 2.5–3 hours. Parts are independent. ★ marks the highest priority.

**Build under test.** Install the 2026-10-30 afternoon debug bundle (built from `0e53e6f6`), which contains every fix and design change so far, including the two PR #14 review fixes. Launch it from `/Applications` so computer use finds the right app:

```sh
rm -rf /Applications/Brainflow.app
ditto ~/code/brainflow2/target/debug/bundle/macos/Brainflow.app /Applications/Brainflow.app
/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister -f /Applications/Brainflow.app
open -n /Applications/Brainflow.app
```

Record the build time from `ls -la /Applications/Brainflow.app/Contents/MacOS/brainflow` at the top of your report. It must read 12:24 on 2026-10-30 or later; an 08:42 build is stale. HEAD is `0e53e6f6` on branch `qa/fix-wave-2026-10-30`.

**Reporting.** Use the same form as before:

- **Where:** the step number.
- **Did / expected / got.**
- **Evidence:** a screenshot, the exact Log line, and the file used.
- **How often:** always, sometimes or once.
- **Severity:** H, M or L.

Write the report to `docs/qa/2026-10-30-runthrough-report.md`. Keep the Log dock open (`p`, Log tab).

**Synthetic input.** Computer use sends synthetic mouse and keyboard events. Any check marked **(physical)** needs a person at the machine: wheel feel, Finder drags, or a physical key. If you can't do it, mark it "not run (physical)" rather than pass or fail.

**Fixtures.** These are the same as run 1 (`2026-10-29-tester-runthrough.md` §0):

- **MNI T1:** `test-data/unit/tpl-MNI152NLin2009cAsym_res-01_desc-brain_T1w.nii`.
- **Phase 4 fixtures:** `~/Documents/brainflow-p4-native/fixtures/`, with answers in `truth.json`.
- **Small exact-value fixtures:** `test-data/browser/`.
- **NeuroTabs:** `core/field_table/fixtures/neurotabs/fir3d/nftab.yaml`.

---

## Part A: verify the new fixes ★

### A1. Set studio Deck shows only the member
1. Open the MNI T1, then load the ASEG and Olsen MTL atlases.
2. Open Set studio and import the fir3d manifest. Go to **Deck**.
   - Expected: the card for `s01_faces_l2` draws that member's 4 mm beta map only. No T1 and no atlas colours.
3. Step through 3 members.
   - Each card shows its own map.
   - Nothing flashes from the main workspace between members.
4. Open **Compare** in Studio. Pane A shows only its member.
5. Leave Studio.
   - The main scene is unchanged: same layers and opacities, and no "Faces beta" layer.
   - The Plot dock no longer shows the Studio series.
6. Re-enter Studio quickly, within about a second of leaving, then go to Deck again.
   - The member still loads. It must not stay blank.
7. **Log:** member loads appear under the source **studio**, for example "Loaded member s01_faces_l2 from sub-01_…_beta.nii.gz (N ms)". They must not appear as "Loaded file (layer volume_…)".

### A2. Population display range
1. In the Population lens with fir3d, look at the Mean and at a member's pane.
   - Expected: the colour range follows the data. It must not be fixed at −1…1.
2. Step through several slices, including slices through the blobs.
   - Known limit: on a slice with no signal, the map is still mostly near-white, because the diverging colormap draws zero as white. Report what you see and whether it's usable. Don't file it as a regression.
3. Set a range by hand, then change the slice. Your range must be kept.

### A3. Files: sort by size
1. Mount `test-data`, expand `unit/`, then choose **Size ↓**.
   - Expected: the 34 MB T1 is near the top and the small files are at the bottom.
   - Folders stay first, A→Z.
2. Choose **Size ↑**, then sort by **Modified** both ways. Each order must be correct.
3. Do the same on a second mounted folder.

### A4. Workspace tabs after relaunch ★
1. Create several views: Orthogonal, Integrated twice, Compare and Mosaic. Quit with ⌘Q and relaunch.
   - Expected: at most one restored view per mode, plus any tool workspaces (Set studio, BIDS).
   - "Integrated 2/3" must not come back.
2. Click each layout pill in turn.
   - The highlighted pill and the view on screen must always agree.
   - Try this straight after relaunch, before clicking any tab.
3. Click a tab directly, then a pill. They must still agree.
4. Run this twice, because the earlier failure happened only once.

### A5. Status bar and Log
1. Load ASEG and Olsen together. Select the Olsen layer and hover or click inside the putamen.
   - Region must come from the same layer as Layer and Value. It must not read "Layer Olsen · Value 0 · Region RH Putamen".
2. Select the ASEG layer and repeat. Region now reads the ASEG label.
3. Remove a layer. The Log shows "Removed <file name>".
4. Open a missing or corrupt file (§18 of run 1).
   - The message names the file once.
   - There must be no doubled "Failed to load … : Failed to load file …".

### A6. Re-check the items the rerun carried over
The rerun report listed these as still open, but they may not have been re-tested. Check each one explicitly:

1. **Autocorrect:** type a misspelled word ("obliqe") into the Files search, ⌘K and Go-to (`g`). No macOS autocorrect bubble should appear. If one does, record which field.
2. **Fuzzy ⌘K:** "hdr" finds Image Header…, "xhair" finds crosshair commands, and "rst" finds Reset Layout.
3. **Show Crosshair checkmark:** View › Show Crosshair shows a ✓ that follows the crosshair state. Toggle it from the menu and with the in-app control.
4. **Reset Layout:** View › Panels › Reset Layout, and from ⌘K. Open a surface tab first and set its camera preset to Ventral. After the reset, that tab must still show Ventral.
5. **Hover Info…:** is it still a no-op? This one is known and wasn't fixed.

---

## Part B: what neither run covered

### B1. Stress: load and remove ★
Layers can now be removed, so this is possible for the first time.

1. Open Activity Monitor and note Brainflow's memory.
2. Repeat 20 times: open the MNI T1 and three overlays (`p4 zmap`, `labels.nii.gz`, `oblique.nii.gz`), then remove all four.
   - Use the layer context menu, Delete/Backspace and Files › Loaded › Unload, each at least once.
3. After all 20 cycles, note the memory. Record whether it returns near the starting value.
4. Hold Delete with the layer list focused. Only one layer is removed per press, never the whole stack.
5. Remove a layer while it is still loading: start a large load and press Delete immediately.
   - No error and no ghost layer.
   - The Log stays clean apart from the removal.
6. Toggle visibility fast, about 10 times, on a 4D volume. Then remove it.
   - It is fully gone, and the panes refit.

### B2. View frame and geometry ★
1. Open `oblique.nii.gz` alone.
   - Axial, coronal and sagittal show world planes.
   - The orientation letters are correct.
   - Arrow-key steps along each axis are even. On this volume the step is 2, 3 or 4 mm depending on the axis.
2. Add the MNI T1. The panes grow to cover both images.
3. Hide the T1. The panes shrink back.
4. Show the T1 again. They grow again. The rerun didn't check this path.
5. Zoom and pan, then add a small overlay inside the current frame. Your zoom and pan must be kept.
6. Put the crosshair outside the oblique image, inside the T1, then remove the T1.
   - The crosshair moves inside the remaining image.
   - The panes must not show an empty slice.
7. Switch Neurological ↔ Radiological. Only left and right swap.
8. Check Mosaic and Compare (2 and 4 panes) with the same pair of images. Compare panes share one scale.

### B3. Keyboard and mouse
1. ↑/↓ step slices only when the pointer or focus is on a view.
   - Click into the file tree and press ↑/↓: the tree selection moves and the slice does not.
   - Do the same in the Scene stack and the Log.
2. Space plays and pauses a 4D volume, even right after clicking a toolbar button.
3. `?` opens the shortcuts dialog. **(physical)** Use a real keyboard if you can.
4. ⌘A outside a text field must not select the whole window's text. Inside a text field it selects that field's text.
5. ⌘1 opens or focuses a **locked** Orthogonal view even when a flexible one exists.
6. **(physical) Wheel:**
   - One notch steps one slice, and wheel up moves superior in axial. This direction changed in this build.
   - On a trackpad, scrolling should feel controlled, not racing.
   - Shift+wheel steps sideways.

### B4. Drag and drop (physical where noted)
1. **(physical)** Drag one NIfTI, then three at once, from Finder onto each target: Orthogonal, Mosaic, a Compare pane and the "new panel" zone.
   - All files load, in order.
   - Each lands where you dropped it, on a Retina display.
2. **(physical)** Drag a folder from Finder. It mounts in Files.
3. **(physical)** Drag a `.txt` file from Finder. You get a polite refusal.
4. Drag tree rows and Loaded rows onto views. They load where you drop them.
5. Drag a row and release it outside any view. Nothing happens.
6. Reorder layers in the Scene stack, quickly and slowly. Drop outside the list: the move is cancelled.
7. Drag GoldenLayout tabs between stacks. This must still work.
8. **(physical)** Press ⌘-Tab in the middle of a drag, then come back and click. The click must not drop the file.
9. Try dragging selected text into a text field. Report whether it works; it may be blocked now.
10. **(physical)** Drag a NIfTI from Finder with Shift held, then with ⌥ held, keeping Brainflow frontmost (the modifier is read from Brainflow's own key events). Shift/⌥ must give the same result as the same modifier on an internal row drag. If Finder is frontmost when you release, a plain drop is the known limit; note it, don't file it.

### B5. Command line
Repeat run 1 §1.2–1.4, which no run has covered yet:

- `-o <file> -w mosaic`
- `-t <template>`
- `-m <dir>`
- two positional files
- bad `-w`, bad `-t`, and a missing file
- `-h` and `-V`

Launch with `open -n /Applications/Brainflow.app --args …`.

### B6. Saved layouts
Save a layout and change it, then restore the saved layout. Relaunch and restore it again. Report anything lost: panel sizes, dock state or surface tabs.

### B7. Surfaces
1. Open fsaverage5 Pial (both hemispheres) from the Templates menu.
   - Both hemispheres draw and fill the pane.
   - The header reads "Surface · both · pial".
   - Lateral is selected.
2. Press Ventral, then open fsaverage White.
   - The new tab opens in Lateral.
   - The first tab stays in Ventral.
3. In tab A, press its selected preset again. Tab B's camera must not move.
4. **Log:** there should be no "surface" warnings. If you see "nothing to draw", "Pinned scene group" or "WebGL context lost", copy the line exactly.
5. Known and still open: Medial with both hemispheres shows the other hemisphere. Confirm only.

---

## Part D: design changes in this build ★

These implement `docs/plans/qa-design-decisions-2026-10-30.md`. Some Part A and B steps describe the older behaviour. Where a step here disagrees with Part A or B, this section wins.

### D1. Navigation
1. Click each layout pill (Orthogonal, Integrated, Mosaic, Compare). The **current tab** changes layout in place. No tab is created and none is jumped to.
2. Press ⌘1–⌘4. Each does the same as the matching pill.
   - ⌘2 is greyed out in View › Layout when the Integrated feature is off.
3. View › Layout › Orthogonal Panels switches the tab to separate panels. ⌘1 then keeps that variant.
4. Press ⌘T. A new view opens in the current layout.
5. Press ⌘5 (Set studio) and ⌘6 (BIDS). Each opens once; pressing again focuses the same tab.
   - While a tool tab or a surface tab is in front, the pills are disabled with an "In <tool>" note, and ⌘1–⌘4 do nothing.
   - Click a side panel (Subjects) or open a dock panel while a surface tab is in front. The pills must stay disabled.
6. Close Set studio with the tab's ×, then press ⌘5. A fresh studio tab opens in front.
7. Close every tab. A default view appears.
8. Close a few tabs and quit. On relaunch, only the tabs you left open come back, plus tools that were open.
   - Read / Explore / Analyze no longer exist in the Workspace menu.
9. Open ⌘K or Go-to (`g`) and press ⌘1 or ⌘T. Nothing changes behind the dialog.
10. Launch with `--args -w mosaic`. Exactly one tab opens, in Mosaic.

### D2. Stacking and opacity
1. Open in any order: the MNI T1, a 4D BOLD (`p4 raw4d`), the z map, and ASEG. The stack must end up T1 < BOLD < z < ASEG.
2. A second anatomy (for example Colin27 after the MNI T1) opens on top of the first at **50 %**.
3. An atlas or label layer over a stat map opens at **60 %**.
4. A binary file whose name doesn't say "mask" opens with the labels at 60 %, above the stat map. If you have no such file, copy `p4 edge_border.nii` to `lesion.nii` in a scratch folder and use that.
5. Drag the atlas below the z map, then open another image. The atlas stays where you put it.
6. Export an axial slice at z = 48 with ASEG loaded. The legend is empty and there's no side column.
   - Export a slice through the basal ganglia. The legend lists only the regions you can see.

### D3. Coordinates and status bar
1. The status bar has two labelled groups.
   - **Crosshair:** mm, ijk, value and region.
   - **Pointer:** mm, value and region.
2. ijk names its grid, for example "ijk 23, 41, 30 (zstat1)".
   - Load the 2 mm z map over the 1 mm T1 and select the z map. The status bar's ijk and the cluster table's "Peak ijk (…)" agree at a cluster peak.
3. Move the pointer off the image. The Pointer group greys out.
   - Over anatomy outside a small stat map, the group stays live and only the value shows "—".
   - It must never show a stale value.
4. Scrub time on a 4D volume with the pointer still. The value updates with the frame and never shows the previous frame's value.
5. Right-click a view and choose Hide/Show pointer readout. The setting persists across relaunch.
6. Open Settings with ⌘, (and from ⌘K). It shows Pointer readout and Show unfinished features.
   - With unfinished features off, there's no Annotate tab and no Advanced section.
   - Turn it on: both appear.
7. Go-to in voxel mode says which grid it uses, and jumps correctly on the z map's grid.

### D4. Population view
The fir3d manifest declares `MNI152NLin2009cAsym`, so anatomy is expected under its maps.

1. Import fir3d and open Population.
   - The maps are drawn over MNI anatomy, with values near zero transparent.
   - It opens on a slice that shows the blobs.
   - **A dark pane or a white square is a bug.**
2. Colormaps:
   - Mean and Median are diverging and symmetric.
   - Coverage, MAD, SD, Mean absolute magnitude and Cancellation are single-direction (sequential).
3. With fir3d, the opening slice should hold the strongest *participant-mean* signal, not the single loudest voxel run. If it opens on an empty or edge slice, file it.
4. Step to another slice, then reopen the lens. Your slice is kept and the view doesn't jump back to the peak.
5. The first visit can download the template. With Wi-Fi off and a cold cache, the maps must still respond. You get a short status hint instead of anatomy.

---

## Part C: usability tasks ★

Do each task as a new user would. Use only what the interface offers: menus, ⌘K and visible controls. Don't use these instructions or keyboard knowledge beyond the shortcuts dialog. For each task, record:

- **Time to finish,** and whether you finished.
- **Each hesitation:** where you paused, guessed, or used the wrong control first.
- **Anything you couldn't find** that you expected to be there.
- **One sentence on what would have made the task obvious.**

1. **First look at a stat map.**
   - Starting from a fresh launch, show `p4 zmap` over the MNI T1.
   - Threshold it at |z| > 3.1 with a hot/cold colormap.
   - Find the peak of the largest cluster.
2. **Read a region.**
   - Work out which ASEG structure lies at (−22, −4, −2).
   - Then work out which Olsen MTL region is nearest to (−28, −22, −14).
3. **Compare two images.**
   - Put the T1 and the oblique image side by side, then four panes.
   - Give each pane a different image.
   - Tell which pane shows which image without hovering.
4. **Make a figure.**
   - Export an axial mosaic of the z map over the T1, with a colourbar and legend.
   - Check that the legend lists only regions visible in the exported slices. This is known to be still open; confirm only.
5. **Explore a set.**
   - Import the fir3d manifest.
   - Find the member whose map looks least like the group mean.
   - Open it in Deck.
6. **Tidy up.**
   - Remove everything you loaded.
   - Close extra panels and get back to a clean default layout.
   - Quit, relaunch, and confirm the app opens clean.
7. **Recover from a mistake.**
   - Open the wrong file, hide the wrong layer and change opacity by accident.
   - Get back to where you were. Is there an undo?

Finish with **5–10 lines of overall impressions**: what felt solid, what felt fragile, and the single change that would most improve a first session.

---

## Known open items (confirm, don't re-file)

| Sev | Item |
|---|---|
| M | Medial view with both hemispheres shows the contralateral hemisphere (surfview) |
| M | Export legend lists regions not present in the exported slices |
| L | Shift/⌥ on a Finder drop is lost when Finder is frontmost at release |
| L | Visual baselines for the new status bar and Inspector not yet regenerated (test-side only) |
| — | `.surf.gii.gz` not listed in Files (loader doesn't accept it yet) |
