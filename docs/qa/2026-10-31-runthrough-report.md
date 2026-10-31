# Brainflow desktop: run-through 4 report (2026-10-31)

**Binary under test:** `/Applications/Brainflow.app`, modified **2026-10-30 22:58**, 226.3 MB (Finder: "Yesterday, 10:58 PM"). This meets the plan's 22:58-or-later requirement, and the new View › Radiological Convention item confirms the Part F build.

**Run:** 2026-10-31, 08:17–08:48. The app was already open; it restored Orthogonal + BIDS Explorer.

**How it was run:**
- I used computer use (synthetic mouse and keyboard) on the MacBook display (1372×887 logical).
- Order: **Part A → Part F → Part B**, with B and F interleaved where they shared setup. Part E (optional) was **not run**: time ran out.
- **Part C** and every **(physical)** step: *not run (physical)*.
- Part D items were confirmed only (§5).
- The Log dock stayed open except where the app removed it (see **N3**).
- Severity: **H** = blocks or loses work · **M** = wrong or misleading, with a workaround · **L** = polish.
- Finding ids: **F##** cites the run-3 finding being re-checked. **N#** is a new finding in this run. **Feature F#** in the scorecard refers to Part F of the plan.

---

## 1. Scorecard

| Step | Re-checks | Result | Note |
|---|---|---|---|
| A1.1 | F1 | ✅ | No stack-level ×; each tab has its own. |
| A1.2 | F1 | ✅ | Closing all tabs gives the default Orthogonal tab; the dock stays; the pills, ⌘1–⌘4 and ⌘T work. |
| A1.3 | F1 | ✅ | Closing Studio while in front leaves the pills enabled. |
| A2.1–3 | F2 | ✅ | `qa-run4` restores Orthogonal Panels, the Plot tab and the side-panel width, with no error. The name field shows an autocorrect bubble: **N5**. |
| A2.4 | F2 | ✅ | `qa-run3` (saved by the old build) loads. |
| A2.5 | F2 / F1 | ❌ | **⌘W quits the window: N1 (H).** |
| A2.6 | F27 | ✅ | Middle tab stays in front; pill and status bar agree. |
| A2.7 | — | not run (physical) | Needs a tab drag. |
| B1.1 | F13 | ✅ | ⌘2→⌘1 returns to Panels. |
| B1.2 | F27 | ✅ | Only the front tab is renamed. |
| B1.3 | F47 | ✅ | View › Layout ✓ follows the layout; disabled pills show a tooltip, not a highlight. |
| B1.4 | F14 | ✅ | Reset Layout and layout switches with a surface open log no "WebGL context lost". |
| B1.5 | F31 | ◐ | The dock works in surface and Studio tabs, but **disappears after the Integrated tab: N3**. |
| B2.1 | F5 | ✅ | The Pointer readout updates on ↑ and ⌘-scroll. |
| B2.2 | F6 | ✅ | Crosshair moves to (−2, 5, 33) inside the oblique; no black pane. |
| B2.3 | F7 | ✅ | Same scale; the oblique is a small patch over anatomy. |
| B2.4 | F23 | ✅ | ↓↑ in the Log doesn't move the slice; after clicking a pill, ↑ does. |
| B2.5 | F24 | ❌ partial | The lens holds, but the Population slice doesn't step; the main crosshair moves instead: **N9**. |
| B2.6 | F42 | ✅ | Fields are i/j/k; junk is cleared with a note. |
| B2.7 | F49 | ✅ / ◐ | "LH Pallidum · FreeSurfer ASEG"; but with a 2nd atlas loaded it shows "–": **N16**. |
| B3.1 | F16 | ✅ | BOLD opens at 50 %, window 0–200, and the T1 shows through. |
| B3.2 | F17 | ◐ | Opens as a label layer, but at 100 % Fill (opaque green slab): **N11**. |
| B3.3 | F17 (neg.) | ✅ | `overlap_count.nii` (values 1–3) opens as values. |
| B3.4 | F38 | ✅ | T1 goes under the oblique at 100 %. |
| B3.5 | F34 | ✅ | Status bar frame and Inspector frame agree (1/30). |
| B4.1 | F8 | ◐ | B–D draw maps with no paths, but **no colourbars**, and the B mean is greyscale: **N10**. |
| B4.2 | F8 | ✅ | No derived rows in the Scene after leaving. |
| B4.3 | F10 | ✅ | No "error: undefined". |
| B4.4 | F11 | ✅ | The Plot dock shows the histogram after leaving Studio. |
| B4.5 | F19 / F20 / F12 | ✅ / ◐ | Mean/Median are blue–white–red with colourbars ✓. Coverage was once an opaque box with no anatomy: **N12** (1/2). |
| B4.6 | F45 | ✅ | Maps sit directly under Summary. Studio is still cramped (user note): **N13**. |
| B4.7 | F44 | ✅ | Median kept; no extra member load on re-entry; doubled crosshair gone (no crosshair at all). |
| B4.8 | F33 | ◐ | Upper bound shared (1.4); lower differs (0.43 vs 0.63). |
| B4.9 | — | not run | |
| B5.1 | F25 | ✅ | `.nii.gz` selectable; Shift-select of 3 files loads all into the front tab. |
| B5.2 | F18 | ✅ / ◐ | z=48 legend empty ✓; ASEG+Olsen grouped and complete ✓; single-atlas export still capped at 8 with "+2 more": **N15**. |
| B5.3 | F26 | ✅ | Export from Mosaic defaults to the mosaic (see Feature F3). |
| B5.4 | F40 | ✅ | "Loaded FreeSurfer ASEG", "Loaded MNI152 T1w (1mm)", "Restored p4_zmap.nii". |
| B5.5 | F41 | ✅ | ⌘K listed once; O = world origin; ⌘T in the Workspace menu. |
| B5.6 | F30 | ✅ | atlas/aseg/kb/rm/nsynth all right; Toggle Crosshair works. |
| B5.7 | F46 | ◐ | Header and folders OK; **no "no matches" message**. |
| B5.8 | F35 | ❌ | Delete during a load **removed the selected layer**, with no refusal toast: **N7**. |
| B6 | F9 | ◐ | WebView +125 MB over 20 cycles (~6 MB/cycle, was ~7–8). See §3. |
| Feature F1 (zoom/pan) | F21 | not run (physical) | Synthetic ⌥/⌃-scroll steps slices; Fit View exists in ⌘K and the context menu. |
| Feature F2.1–2 (radiological) | F22 | ✅ | Mirror and "R \| L" badge ✓; click on screen-left gives x = +47 ✓. Toggling recentred the crosshair to (0,0,0) and hid the orientation letters: **N14**. |
| Feature F2.3 | F22 | ✅ | Compare, Mosaic, Deck, Studio Compare B and Population follow it. |
| Feature F2.4 | F22 | ◐ | Export matches the screen ✓; **⇧⌘C failed**: **N8**. |
| Feature F2.5 | F22 | ✅ | Persists across relaunch; context menu in sync. |
| Feature F3.1 | C4 / F26 | ✅ | Mosaic export with tiles, colourbar, R\|L marker (per-atlas legend not exercised). |
| Feature F3.2 | C4 | ❌ | ⇧⌘C copy fails (N8), so nothing to paste into Preview. |
| Feature F4.1–2 | F28 | ✅ | Opacity, visibility and threshold undo/redo in one step (colormap and reorder not tried). |
| Feature F4.3 | F28 | ✅ | "Removed … Undo" toast; restored in the same slot with the same opacity and threshold. |
| Feature F4.4 | F28 | ✅ | ⌘Z in a text field undoes typing only. |
| Feature F4.5 | F28 | ✅ | Unlinked Compare edit reverts (the "Editing panel A" label is confusing, L). |
| Feature F5.1–3 | C1 | ✅ / ◐ | Peak shown and clusters listed on load; peak click jumps; compute after a drag works. An asymmetric threshold gives a mismatched table: **N6**. |
| Feature F5.4 | C1 | ❌ | "Use clusters as regions" not found anywhere. |
| Feature F6.1–4 | C5 | ✅ | Status names 72 members / 80,360 voxels; descending; Deck follows distance order; filter recomputes; <1 s. |
| Feature F7.1–2 | C3 | ✅ | ⌘4 opens 2 panes, maps first; 2/3/4 switch; picker keeps anatomy and scale. |
| Feature F7.3 | C3 | ❌ | Names truncate to "Free…", and hover replaces the name with controls; no tooltip seen. |
| Feature F8.1 | — | ❌ | Following the documented path never reaches the first screen: **N4**. |
| Feature F8.2–3 | — | not run | |
| Feature F8.4 | — | ✅ | No T1 added on a restored relaunch. |
| Feature F9.1 | F15 | ✅ | Surface tabs come back as placeholders with Reload/Close; Reload works. |
| Feature F9.2 | F15 | not run | |
| Feature F10.1 | — | ◐ | With 2 layers hidden the next load succeeds; no visible eviction. |
| Feature F10.2 | — | ❌ | Raw "Maximum layer count exceeded" error, 3 lines per file: **N2**. |
| Part C | — | not run (physical) | |
| Part E | — | not run | Time. |

**Totals:**
- **1 H** finding (N1).
- About **15 M** findings.
- Both run-3 H bugs are **fixed**: F1 (stack ×) and F2 (saved layouts).
- **Fixed run-3 M findings:** F5, F6, F7, F8 (partly), F10, F11, F13, F14, F16, F23, F25, F26, F27, F30, F34, F38, F40, F41, F42.
- **New features that work:** undo, clusters-on-load, distance-to-mean, radiological, surface placeholders and mosaic export.

---

## 2. Findings

### High

**N1: ⌘W closes the whole window, and the app exits**
- **Where:** A2.5.
- **Did:** After restoring `qa-run4`, pressed ⌘W to close the front tab.
- **Expected:** the front tab closes and no orphan tab is left.
- **Got:**
  - The window closed and Brainflow quit; Finder came to the front.
  - On relaunch the scene was empty: the session's T1 and surfaces were gone.
  - The File menu has only "Close Window ⌘W"; there is **no Close Tab** command.
- **Evidence:** File menu screenshot at 08:20. The relaunch shows 0 scene items.
- **How often:** always (1/1). This is how the menu is defined.
- **Severity:** **H.** One habitual keystroke throws away the whole session. Bind ⌘W to Close Tab, and move Close Window to ⇧⌘W.

### Medium

**N2: Layer limit gives a raw internal error, three times per file**
- **Where:** Feature F10.2.
- **Did:** Opened the 5 zmap files plus 6 browser fixtures in one go.
- **Expected:** "GPU texture slots full (all N in use)…", or eviction of a hidden layer.
- **Got:**
  - After 8 volumes, every further file logs three lines, for example:
    - `Layer oblique4d.nii error: Failed to add layer to render state: Internal { code: 1885, details: "Failed to add layer: Maximum layer count exceeded" }`
    - `Failed to load file: …`
    - `Failed to load oblique4d.nii: …`
  - The toast reads "Fail…d" }".
  - With 2 layers hidden, one more load succeeded (9 volumes). With all visible, `lesion.nii` failed the same way.
- **Evidence:** Log 08:44:47 and 08:45:14.
- **How often:** always.
- **Severity:** M. This also brings back run-3's doubled-error text, on this code path.

**N3: The bottom dock disappears after visiting the Integrated tab**
- **Where:** B1.5.
- **Did:** Switched to the Integrated tab.
- **Got:**
  - The Activity/Plot/Clusters/Log dock vanished. Integrated's lower half is the surface placeholder.
  - It stayed gone in Orthogonal until I pressed **p**.
  - The relaunched surface placeholder tab also had no dock.
- **How often:** 1/1.
- **Severity:** M. The Log can't be kept open "throughout".

**N4: The first screen (MNI anatomy at start) is unreachable by the documented path**
- **Where:** Feature F8.1.
- **Did:**
  1. Reset Layout.
  2. Closed all 7 tabs (the default Orthogonal tab reappeared).
  3. Brainflow › Quit.
  4. Relaunched at 08:47.
- **Expected:** MNI anatomy, the crosshair at the origin, and a "Drop a map here" hint.
- **Got:** an empty Orthogonal tab with "No volume loaded", even though Settings › Start › "MNI anatomy at start" is **on** ("With nothing restored…").
- **Why:** the default tab that replaces the last closed tab is persisted, so the launch always counts as "restored".
- **How often:** 1/1.
- **Severity:** M.

**N5: macOS autocorrect is back in the Save Layout field**
- **Where:** A2.1.
- **Got:** typing `qa-run4` showed a capitalisation bubble "Qa-run4" under the field. Return could accept it; I dismissed it with →.
- **How often:** 1/1.
- **Severity:** M. This is a regression of the run-3 autocorrect fix in a new field.

**N6: An asymmetric threshold gives a cluster table that disagrees with the map**
- **Where:** Feature F5.3.
- **Did:** Dragged only the upper threshold handle (3.1 → 3.93), then pressed Compute.
- **Got:**
  - Map: "−3.1 ≤ z ≤ 3.93 hidden".
  - Table: "|z| > 3.92923, two-tailed", 5 clusters. The negative cluster is thresholded at −3.93 while the map shows everything below −3.1.
  - The field shows the unrounded value "3.92923".
- **How often:** 1/1.
- **Severity:** M.

**N7: Delete during a load removes the selected layer**
- **Where:** B5.8 / F35.
- **Did:** Double-clicked the 32 MB T1, selected `labels.nii` in the Scene, and pressed Delete while the status bar showed "Loading volume: tpl-…".
- **Expected:** a refusal toast, and nothing removed.
- **Got:** `labels.nii` was removed ("Remov…s.nii +1 Undo").
- **How often:** 1/1.
- **Severity:** M (Undo mitigates it).

**N8: ⇧⌘C copy fails**
- **Where:** Feature F2.4 / F3.2.
- **Did:** Mosaic focused, pressed ⇧⌘C.
- **Got:** Log `08:37:05 error ui The request is not allowed by the user agent or the platform in the current context, possibly because the user denied permission.` Nothing reached the clipboard.
- **Likely cause:** WebKit refused a clipboard write that wasn't triggered by a real user gesture. **Re-check with a physical keypress.** Either way, the raw WebKit text shouldn't reach the user.
- **How often:** 1/1.
- **Severity:** M (pending a physical re-check).

**N9: ↑ over a Population map steps the main workspace, not the map**
- **Where:** B2.5 / F24.
- **Did:** Clicked the Population lens, hovered the Mean map, pressed ↑ ↑.
- **Got:**
  - The lens stayed on Population ✓.
  - The Population slice didn't change.
  - The status-bar crosshair x went 1 → 3, so the main workspace moved instead.
- **How often:** 1/1.
- **Severity:** M.

**N10: Studio Compare B–D have no colourbars, and the B mean is greyscale**
- **Where:** B4.1 / F8.
- **Got:**
  - All members, Residual and Z-score render maps and no paths ✓.
  - There is no colourbar in any of A–D.
  - B (Mean) is white/grey, not diverging.
  - There is no anatomy under any pane.
- **How often:** always.
- **Severity:** M.

**N11: A binary label layer opens as an opaque slab**
- **Where:** B3.2 / F17.
- **Did:** Opened `lesion.nii`, a brain-sized 0/1 mask.
- **Got:** it is correctly a label layer ("Label 1", green), but at **100 % Fill**, a solid green brain that hides the T1.
  - Related: `p4_brain_mask.nii` still opens as greyscale at 60 % on top of the stack.
- **How often:** always.
- **Severity:** M.

**N12: Population Coverage sometimes loses its anatomy and goes opaque**
- **Where:** B4.5 / F19.
- **Got:**
  - The first switch to Coverage showed an opaque amber box with **no anatomy in either pane**; the observation pane became a white dot.
  - The second time it rendered correctly (translucent amber over anatomy).
- **How often:** sometimes (1/2).
- **Severity:** M.

**N13 (design; user note 08:33): The Set studio main panel is cramped**
- **Where:** Set studio, at 1372×887 with the Log dock open.
- **Got:**
  - The Deck card's axial view is about 100 px tall. The l4/l5 members render as an empty strip with no anatomy.
  - Compare pane A shrinks to thumbnails, and C/D are below the fold.
  - About 40 % of the column is header rows: study banner, chips, Lens, Save calculation, Summary/Plane/Zoom, Preview exclusion, Inspect/Montage.
  - Widening Subjects wraps the toolbar.
  - Scrolling over a map steps the slice, so the column can only be scrolled from its margins.
- **Suggestion:**
  - Collapse the banner and chips into one line, and the lens rows into one toolbar.
  - Let the maps take the remaining height, with a minimum of about 240 px.
  - Auto-hide the dock in Studio, or let it overlay the panel.
  - Give Deck one large view with a plane toggle.
- **Severity:** M (design).

**N14: Toggling Radiological Convention moves the crosshair and hides orientation letters**
- **Where:** Feature F2.1.
- **Got:**
  - Turning it on moved the crosshair from (−40,−20,53) to (0,0,0).
  - The A/P/L/R letters disappeared and stayed hidden after turning it off.
  - The context menu then offered "Show orientation labels".
- **How often:** 1/1.
- **Severity:** M.

**N15: The single-atlas export legend is still capped at 8**
- **Where:** B5.2 / F18.
- **Did:** Exported an axial slice at z = 2 with ASEG only.
- **Got:** the legend lists 8 regions and then "+2 more". RH Pallidum and RH Hippocampus are drawn but not named.
  - With ASEG + Olsen the grouped legend is complete (19 entries), so the cap applies only in the ungrouped layout.
- **How often:** 1/1.
- **Severity:** M (reduced from run 3: it's now honest).

**N16 (design; user note 08:22): The colourbar sits on the brain in narrow panes**
- **Where:** Orthogonal Panels and Compare panes.
- **Got:**
  - The z-map colourbar is drawn inside the axial pane, over the occipital lobe, crossed by the crosshair.
  - Its tick labels (6.41 / 3.93 / 0) are pale grey on white matter and unreadable.
  - The "0.25" marker and the "−3.1 ≤ z ≤ 3.93 hidden" line overlap tissue.
  - The same happens in every Compare pane.
  - Only the axial pane has a colourbar.
- **Cause:** it is anchored at a fixed fraction of the pane rather than outside the image bounds.
- **How often:** always.
- **Severity:** M.

**N17 (design; user note 08:26): Glasser outlines look noisy**
- **Where:** Atlases › Cortical › Glasser 2016 (360 regions).
- **Got:**
  - 1 mm staircase borders at 2 px, in 360 categorical hues ("rainbow confetti").
  - Shared borders are drawn twice.
  - The default Outline over a stat map buries the blobs.
- **Suggestion:**
  - Smoothed or single shared borders in one neutral colour.
  - Low-opacity fill for cortical atlases with many parcels.
  - Thinner lines as the parcel count rises.
- **Severity:** M (design).

**Region readout with two atlases** *(B2.7; referenced as N16 in the scorecard)*: with Glasser + ASEG loaded and the z map selected, the Region slot shows "–" (it picks Glasser), although ASEG has a label there. L.

### Low

- **Feature F5.4:** "Use clusters as regions" is not in ⌘K, the Clusters toolbar or the row menu. Right-click on a row is WebKit's "Reload / Inspect Element".
- **Feature F7.3:** Compare pane names truncate to 4 characters, and hovering the header replaces the name with Add layer / Axial / × controls. Pane A in an oblique/T1 Compare drew no crosshair.
- **F33:** Deck colourbar lower bounds still differ per member. Deck cards still have no anatomy (F32).
- **F46:** Files search with no hits shows a blank tree, with no message.
- **F44:** Studio's crosshair leaks into the main workspace (main crosshair became z −72 after Studio).
- **Feature F6:** "Open <id> in Deck" names the focused member, not the farthest, until a row is clicked. The distance column is truncated unless the panel is widened.
- **A1.2:** after closing every tab, Files and Inspector widened to about 2× and stayed that way until Reset Layout.
- **A1.1:** with a surface tab in front, the status bar still read "Coordinate system Studio · Set studio". Surfaces stay in the Scene after their tab is closed.
- **Feature F9:**
  - A reloaded surface tab jumps to another strip position.
  - The restored tab order is shuffled (surfaces first).
  - The pills were enabled while a surface placeholder tab was in front.
- **Feature F10:** the newly loaded layer appeared as the top row labelled "base volume".
- **Same file loaded repeatedly:** the same file can be loaded 3× with no warning.
- **B2.6:** the Go-to note says "X was not a number" although the field is labelled i.
- **Value formatting:** the status bar switches to scientific notation ("9.2e-3").
- **Mosaic:** ↑ in a Mosaic tab stepped x (sagittal), not the axial mosaic.
- **Context menu:** "Hide colorbar" is missing when an atlas is selected.
- **Compare:** ⌘4 with no stat map opens two empty "Choose a layer…" panes.
- **Atlas defaults:** atlases loaded from ⌘K arrive as opaque Fill; from the menu over a stat map, as Outline.
- **Shortcut glyphs:** "0" (show all layers) and "O" (world origin) look identical in the shortcut dialog's monospace font.

---

## 3. Memory (B6, F9)

The run used 20 cycles. Each cycle loaded the 32 MB MNI T1, `p4_zmap.nii`, `labels.nii.gz` and `oblique.nii.gz` from the Files tree, then removed all four with Delete. Four fsaverage5 surfaces stayed loaded throughout.

| Process (Activity Monitor › Memory) | Before (08:38) | +10 s after | +40 s after |
|---|---|---|---|
| `tauri://localhost` (WebView) | 863.7 MB | 989.9 MB | 989.1 MB |
| Brainflow | 227.5 MB | 194.5 MB | 195.4 MB |
| Brainflow Graphics and Media | 114.6 MB | 114.3 MB | 100.3 MB |

- The WebView grew by 125 MB, about 6 MB per cycle (run 3: 7–8 MB per cycle). It didn't come back down.
- The Rust process shrank.
- The WebView was already at 864 MB at the start, after about 25 minutes of use.
- The Log was clean.
- This matches the Part D note that only part of the leak was fixed.

## 4. Not run

- **Part C, all physical:** drag and drop, wheel/trackpad, `?`, the CLI, offline.
- **Feature F1** (zoom/pan): synthetic ⌥/⌃-scroll carries no modifier.
- **A2.7:** tab drag.
- **B4.9.**
- **Feature F8.2–3** and **Feature F9.2.**
- **Part E:** time.
- **⌘Q** is now refused by the computer-use harness as a system shortcut, so I quit through the Brainflow menu instead.

## 5. Part D (confirm, not re-filed)

| Item | This run |
|---|---|
| Medial view with both hemispheres shows the other hemisphere | Not re-checked. |
| F9: WebView growth only partly fixed | **Confirmed**, with numbers in §3. |
| Crosshair/heatmap jitter during a zoom gesture | Not checkable (zoom is physical). |
| Compare picker offers only visible layers | Consistent with what I saw; not tested directly. |
| MNI T1 not bundled; first launch downloads it | Not reached (see N4). |
| Undo doesn't cover atlas/parcel/image-set removal | Consistent: undo was exercised on files only. |
| Scene list arrow keys move focus, not selection | **Confirmed** (↓ on a Scene row left the selection in place). |
| First −1 mm click in Studio sometimes eaten | Not re-checked. |
| `.surf.gii.gz` not listed in Files | Not re-checked in Files. Note: File › Open now lists `octahedron.surf.gii.gz` as selectable. |
| F50: fir3d faces-l2 = houses-l4 by design | **Confirmed** (equal distances: 11.03 and 6.92 pairs). |

## 6. Housekeeping

Left on the Mac:
- The saved layouts `qa-run3` and `qa-run4`.
- `~/Downloads/brainflow-qa-scratch/`: `lesion.nii`, `lesion_edge.nii`, the new `overlap_count.nii`, and `b1/`.
- `~/Downloads/brainflow-qa-bad/`.

Radiological Convention is back off. The pointer readout is on and unfinished features are off.
