# Brainflow desktop: run-through 4 (2026-10-31)

**Purpose.** Verify the fixes for run-through 3 and the new features in Part F (plan: `docs/plans/qa-features-2026-10-31.md`). For the fixes, (`2026-10-30-runthrough-report.md`, F1–F50) in the native app. Then repeat the parts of run 3 that touch the same code. Part E is optional.

**Time.** About 2.5 hours. ★ marks the highest priority.

**Build under test.** This is the debug bundle built on 2026-10-30 at 22:58 from branch `qa/fix-wave-3` (commit a547c38c plus the uncommitted feature work). Install it and launch it from `/Applications`:

```sh
rm -rf /Applications/Brainflow.app
ditto ~/code/brainflow2/target/debug/bundle/macos/Brainflow.app /Applications/Brainflow.app
/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister -f /Applications/Brainflow.app
ls -la /Applications/Brainflow.app/Contents/MacOS/brainflow
open -n /Applications/Brainflow.app
```

Record the binary's timestamp at the top of the report. It must read 22:58 on 2026-10-30 or later; earlier builds lack the Part F features.

**Reporting.** Use the same form as run 3: **Where / Did-expected-got / Evidence / How often / Severity (H/M/L)**.
- Write the report to `docs/qa/2026-10-31-runthrough-report.md`.
- Give each step a ✅/❌ line in a scorecard, citing the run-3 finding it re-checks.
- Keep the Log dock open. It now exists in surface, BIDS and Analysis tabs too.
- Mark checks that need a person at the machine as "not run (physical)".

**Fixtures.** These are the same as run 3. The scratch copies in `~/Downloads/brainflow-qa-scratch/` (`lesion.nii`, `b1/`) and the saved layout `qa-run3` can be reused.

---

## Part A: the two high-severity bugs ★

### A1. Closing tabs (F1)
1. Open four tabs: Orthogonal, Mosaic, Set studio and a surface. Check that the centre tab strip has **no** stack-level × at its top right, while each tab keeps its own ×.
2. Close every tab with its own ×, one at a time. After the last one:
   - a default Orthogonal view appears;
   - the Log dock is still there;
   - the pills are enabled;
   - ⌘1 to ⌘4 and ⌘T work.
3. Open Set studio, then close it while it is in front. The pills must not stay on "In Studio".

### A2. Saved layouts (F2) ★
1. Arrange things: Orthogonal Panels in the front tab, the Plot dock tab selected, and a side panel resized. Save the layout as `qa-run4` (Workspace › Save Current Layout…).
2. Change everything: Mosaic, the Log tab, and the side panel resized back.
3. Workspace › `qa-run4`. The front tab returns to Orthogonal Panels, the dock to Plot, and the panel to its saved size. No error appears.
4. Restore the old `qa-run3` layout, saved by the previous build. It must load too.
5. After a restore, press ⌘W (File › Close Tab). The front tab closes; no orphan tab is left.
6. Do Reset Layout with three tabs open and the **middle** one in front. The middle tab stays in front, and its pill and status bar agree.
7. Optional: drag a surface tab to a side stack, save, and restore. It comes back **once**, in the centre.

---

## Part B: re-check the run-3 findings ★

### B1. Navigation and tabs
1. **F13:** View › Layout › Orthogonal Panels, then ⌘2 → ⌘1 and ⌘3 → ⌘1. Both return to **Panels**.
2. **F27:** with several tabs open, change the front tab's layout. No *other* tab's title changes.
3. **F47:** View › Layout shows a ✓ on the current layout and follows ⌘1 to ⌘4. A disabled pill (with Set studio in front) shows no hover highlight.
4. **F14:** run Reset Layout and switch layouts with a surface tab open. The Log shows **no** "WebGL context lost" lines, and the surface redraws.
5. **F31:** with a surface tab and the BIDS tab in front, ⌘P / View › Panels › Plot Panel shows the dock.

### B2. Pointer, crosshair and Compare
1. **F5:** hold the pointer still over the axial view and press ↑ three times, then ⌘-scroll. The Pointer group updates with each step (new z, new value). It must never keep the old value.
2. **F6:** put the crosshair inside the T1 and outside `oblique.nii.gz`, then remove the T1. The crosshair moves inside the oblique on **all three** axes, and no pane is black.
3. **F7:** ⌘4 Compare with `oblique.nii.gz` and the MNI T1. Both panes are at the same scale, and the oblique is a small patch in both.
4. **F23:** click a Log line, then press ↓↑. The slice does **not** move. Then click a layout pill or a Compare segmented control and press ↑. The slice **does** move (this was a regression in review).
5. **F24:** in Set studio › Population, click the lens control, move the pointer over the map and press ↑. The slice steps and the lens does not change.
6. **F42:** Go to coordinate › Voxel. The fields are i/j/k. Type junk in World mode, switch to Voxel, and the junk is cleared with a note.
7. **F49:** select the stat map. The Region readout names the atlas it came from, for example "LH Pallidum · aseg".

### B3. New-layer defaults
1. **F16:** open `raw4d_bold.nii` over the T1. It opens at 50 % with a mid-grey brain, not a white slab, and the T1 shows through.
2. **F17:** open `~/Downloads/brainflow-qa-scratch/lesion.nii` (binary 0/1). It opens as a **label** layer with a colour and a legend entry, not as grey.
3. **F17, negative case:** copy any small-integer count map, or `edge_border.nii` (values 1–3), to a file named `overlap_count.nii` and open it. It is drawn as **values**, not random label colours.
4. **F38:** open `oblique.nii.gz` first, then the MNI T1. The T1 goes **under** the oblique at full opacity.
5. **F34:** load `raw4d_bold.nii` fresh. The status-bar frame matches the Inspector, at frame 1.

### B4. Set studio
1. **F8:** Compare with "Current vs All members". Panes B, C and D draw maps (mean, residual, z-score), each with a colourbar. None shows a file path.
2. Leave the Studio for another tab and come back. Panes B to D redraw. The Scene shows **no** rows for the derived maps.
3. **F10:** step through three Deck members. The Log has **no** "error: undefined" lines.
4. **F11:** leave the Studio. The Plot dock no longer shows the Studio series.
5. **F19 / F20 / F12:**
   - Population › Coverage is translucent amber over anatomy, not an opaque box.
   - Mean and Median are blue–white–red.
   - Every pane has a colourbar.
6. **F45:** with the Log open, the maps sit directly under the Summary row, and the analysis panels are below them.
7. **F44:**
   - Change Summary to Median, close the lens and reopen it. It stays on Median.
   - Re-enter the Studio. Check in the Log that the member loads only once.
   - Check whether the doubled vertical crosshair lines are still visible, and attach a zoomed screenshot.
8. **F33:** step through Deck members. The colourbars keep the same range.
9. Drag a member's intensity slider while Compare is open. The main views stay smooth.

### B5. Files, export, Log and ⌘K
1. **F25:** File › Open. `.nii.gz` files are selectable, and Shift-click selects several. Open three; all three load into the tab you started from.
2. **F18:**
   - Export an axial slice at z = 2 with ASEG. The legend lists **every** region drawn, including RH Pallidum and RH Hippocampus, and nothing absent.
   - At z = 48, the legend lists only what is there.
   - With ASEG and Olsen both on, the legend is grouped under each atlas's name.
3. **F26:** Export View from a Mosaic tab defaults to the mosaic, not Sagittal.
4. **F40:** load and remove an atlas and a template. The Log uses display names, for example "Loaded FreeSurfer ASEG", with no `atlas:` or `template:` ids.
5. **F41:**
   - The Shortcuts dialog lists ⌘K once.
   - "Go to world origin" is on the letter O.
   - The Workspace menu shows ⌘T.
6. **F30:**
   - ⌘K "atlas" offers the Load Atlas commands, not Orthogonal Panels; "aseg" offers ASEG, not Crosshair Settings.
   - "kb", "rm" and "nsynth" still find their commands.
   - "Toggle Crosshair" works.
7. **F46:**
   - A Files search with no hits says so.
   - Clearing the search keeps your open folders.
   - The Files header names the root you mounted last.
8. **F35:** start loading a large file, select another row and press Delete. You get a toast explaining the refusal, and nothing is removed.

### B6. Memory (F9)
Repeat run 3's B1 measurement: 20 cycles of load and remove with 4 files, recording Activity Monitor before and after (Brainflow and the `tauri://localhost` WebView). Only part of this leak was fixed, so report the numbers either way.

---

## Part F: new features ★

### F1. Zoom, pan and Fit (F21)
1. ⌥-scroll over the axial view zooms around the pointer. Plain scroll and ⌘-scroll still step slices.
2. **(physical)** Pinch on the trackpad zooms.
3. Pan with Space-drag or middle-drag. Panning never moves the crosshair. Tapping Space over a view still toggles Play/pause, on release.
4. While zoomed, step slices and add a layer. The zoom is kept.
5. Use the Fit button (bottom right, shown only while zoomed), the **F** key and right-click › Fit to view. Each returns the view to its fitted frame.
6. Open a second orthogonal tab, go back to the first, and zoom there. It works, so zoom is not captured by the hidden tab.
7. Hold Space, ⌘-Tab away and back, then click. The click sets the crosshair; it does not pan.

### F2. Radiological convention (F22)
1. Turn on View › Radiological Convention. Axial and coronal mirror, R moves to the left, and an "R | L" badge appears. Sagittal is unchanged.
2. Click on the left hemisphere. The crosshair lands where you clicked, and the readout's x is positive (patient right).
3. Check Compare panes, Mosaic, the Studio Deck, Compare B–D and the Population panes all follow it.
4. Export and ⇧⌘C both match the screen, with the marker.
5. The setting survives a relaunch, and the menu ✓ stays in step with the context-menu toggle.

### F3. Export what I see (C4)
1. From a Mosaic tab, Export View defaults to the mosaic tiles, with colourbar and per-atlas legend. Click the tiles first, then export again.
2. With the mosaic focused, ⇧⌘C copies the composite. Paste it into Preview to check.

### F4. Undo (F28, C7)
1. Change opacity with one slider drag. ⌘Z undoes it in one step; ⇧⌘Z redoes it.
2. Undo a colormap change, a threshold change, a visibility toggle and a reorder.
3. Remove a layer. A toast "Removed <file>" with Undo appears. Undo reloads the layer with the same settings and in the same stack slot.
4. In a text field, ⌘Z undoes typing, not the scene.
5. In unlinked Compare, make an edit to one pane, then press ⌘Z. That pane's edit reverts.

### F5. Clusters on load (C1)
1. Open `p4_zmap.nii`. Without pressing Compute, the Inspector shows "Peak z 6.41 at (−40, −20, 50)" and Clusters lists 3.
2. Click the peak. The crosshair moves to that voxel.
3. Drag the threshold, then press Compute within half a second. Your table appears, with no error.
4. Show a table, then drag the threshold. "Use clusters as regions" still works.

### F6. Distance to the group mean (C5)
1. Import fir3d, then choose Subjects › Sort › Distance to group mean. The status line names 72 members and the shared voxels. The list reorders farthest first, showing distances and correlation distance in brackets.
2. "Open <id> in Deck" opens that member. The Deck pager follows the distance order.
3. Change a filter. The distances recompute for the new group.
4. Note the time it takes (expected under a second).

### F7. Compare panes (C3)
1. ⌘4 with 3–4 layers opens **2** panes, maps first. Switch Panes between 2, 3 and 4.
2. Each pane header has a layer picker. Swapping keeps the anatomy underneath and the shared scale.
3. Narrow a pane. The name stays visible, and the tooltip shows it in full.

### F8. First screen
1. Quit, clear the saved session (Workspace › Reset Layout, then close all tabs, then quit), and relaunch.
   - With the T1 cached, MNI anatomy appears at once with the crosshair at the origin and a "Drop a map here" hint.
   - With nothing cached, it downloads in the background and appears when done.
2. Drop a map. The hint disappears.
3. Settings › Start › "MNI anatomy at start" off, then relaunch fresh. You get the empty view.
4. Relaunch with tabs restored. No T1 is added.

### F9. Surface placeholder (F15)
1. Open fsaverage5 Pial and White and quit. On relaunch each surface tab is a placeholder with Reload and Close, and nothing loads.
2. Reload brings the surfaces back into one tab. A placeholder whose file was deleted says the source is gone.

### F10. GPU texture slots
1. Load layers until the GPU is full (about 13), keeping a few hidden. The next load evicts a hidden layer and succeeds.
2. With every layer visible, a further load says "GPU texture slots full (all N in use)…".

## Part C: physical checks (a person at the machine)

These were not run in run 3:
- **B4 drag and drop:**
  - Drag one NIfTI, then three, from Finder onto Orthogonal, Mosaic and a Compare pane.
  - Drag a folder.
  - Drag a `.txt` file.
  - Press ⌘-Tab mid-drag.
  - Hold Shift or ⌥ during the drop.
- **Wheel and trackpad feel.**
- **`?`:** opens the Shortcuts dialog.
- **CLI:** `open -n /Applications/Brainflow.app --args -w mosaic` opens in Mosaic.
- **D4.5, offline:** turn Wi-Fi off and clear the template cache. Population still responds, with a short hint.

## Part D: known open items (confirm, don't re-file)

| Sev | Item |
|---|---|
| M | Medial view with both hemispheres shows the contralateral hemisphere (surfview) |
| M | F9: only part of the WebView memory growth is fixed |
| L | Crosshair and heatmap may jitter for a frame during a zoom gesture (each bitmap is not yet tagged with its plane) |
| L | Compare picker offers only visible layers; a hidden layer must be shown first |
| L | The MNI T1 for the first screen is not bundled; first launch downloads the 2 mm T1 |
| L | Undo covers files and templates, not atlas, parcel table or image-set removals |
| L | Scene list: arrow keys move focus but not the selection (by design today) |
| L | First −1 mm click in Studio sometimes eaten (F44, not investigated) |
| L | `.surf.gii.gz` not listed in Files |
| L | F50: fir3d faces lag-2 and houses lag-4 maps are identical by fixture design ("distance 0" is correct) |

## Part E: optional, repeat run 3's usability tasks

Repeat run 3's tasks C1 to C7 (Part C) and note what changed. C4 (mosaic export), C5 (outlier member) and C7 (undo) should now be possible.
