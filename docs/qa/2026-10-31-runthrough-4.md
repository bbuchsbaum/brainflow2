# Brainflow desktop: run-through 4 (2026-10-31)

**Purpose.** Verify the fixes for run-through 3 (`2026-10-30-runthrough-report.md`, F1–F50) in the native app. Then repeat the parts of run 3 that touch the same code. This run is shorter than run 3. Part E is optional.

**Time.** About 1.5 hours. ★ marks the highest priority.

**Build under test.** This is the debug bundle built on 2026-10-30 at 21:48 from branch `qa/fix-wave-3`, with uncommitted changes. Install it and launch it from `/Applications`:

```sh
rm -rf /Applications/Brainflow.app
ditto ~/code/brainflow2/target/debug/bundle/macos/Brainflow.app /Applications/Brainflow.app
/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister -f /Applications/Brainflow.app
ls -la /Applications/Brainflow.app/Contents/MacOS/brainflow
open -n /Applications/Brainflow.app
```

Record the binary's timestamp at the top of the report. It must read 21:48 on 2026-10-30 or later; the 12:24 and 21:40 builds are stale.

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
| M | F15: surface tabs don't come back on relaunch (design decision pending) |
| M | F9: only part of the WebView memory growth is fixed |
| M | New features pending a decision: zoom/pan (F21), neurological/radiological switch (F22), mosaic composite export (C4), undo (F28), distance-to-mean ranking (C5), Compare pane picker (C3) |
| L | Scene list: arrow keys move focus but not the selection (by design today) |
| L | First −1 mm click in Studio sometimes eaten (F44, not investigated) |
| L | `.surf.gii.gz` not listed in Files |
| L | F50: fir3d faces lag-2 and houses lag-4 maps are identical by fixture design ("distance 0" is correct) |

## Part E: optional, repeat run 3's usability tasks

Repeat run 3's tasks C1 to C3 and C6 (Part C) and note what changed. Tasks C4, C5 and C7 depend on the pending features and will still fail.
