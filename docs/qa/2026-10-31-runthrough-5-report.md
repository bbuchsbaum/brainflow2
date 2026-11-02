# Brainflow desktop: run-through 5 report (2026-10-31 plan, run 2026-11-01)

**Binary under test:** `/Applications/Brainflow.app/Contents/MacOS/brainflow`, modified **2026-10-31 12:42** (Finder: "Yesterday, 12:42 PM"), 229.1 MB. This meets the plan's "12:42 or later" requirement.

> **Build note.** `target/debug/bundle/macos/Brainflow.app` in the repo now holds a **newer** binary (Oct 31 **16:42**) that was not installed. Repo HEAD is `f6fc1f3d` on `qa/fix-wave-3`, not the `6e38a55f` the plan names. Per the instructions, I tested the installed 12:42 build. If the 16:42 build has fixes, some findings below may already be stale.

**Run:** 2026-11-01, 12:55–13:29. The app was already open with an empty Orthogonal tab.

**How it was run:**
- I used computer use (synthetic mouse and keyboard) on the MacBook display. The window was maximised to 1372×887 logical.
- **Order:** Part A → Part E → Part B → Part C. Part D items were confirmed only (§4).
- The Log dock was kept at about 150 px. I enlarged it once, briefly, to read the cluster table in A6.
- Every **(physical)** step is marked *not run (physical)*.
- Synthetic ⌥-scroll steps the slice instead of zooming, so checks that need zoom are also physical.
- **Severity:** **H** = blocks or loses work · **M** = wrong or misleading, with a workaround · **L** = polish.
- **Finding ids:** **N1–N17** are run-4 findings being re-checked. **N18 onward** are new in this run.
- **Interruption:** a macOS SecurityAgent password prompt came up at 13:10. I paused until it was dismissed and did not touch it.
- **Overlay:** an invisible ChatGPT overlay window covered part of the Inspector at the start. I was granted access only to get clicks past it, and did nothing else in that app.

---

## 1. Scorecard

### Part A: high and medium fixes

| Step | Re-checks | Result | Note |
|---|---|---|---|
| A1 | N1 | ✅ | File menu has **Close Tab ⌘W** and **Close Window ⇧⌘W**. ⌘W closes only the front tab. ⌘W on the last tab gives a default Orthogonal tab. ⇧⌘W closes the window and the process exits: **N27** (L). |
| A2 | N2 | ✅ / ❌ | 8 load. The 9th gives one Log line and one toast: "GPU texture slots full (all 8 in use). Hide or remove a layer, then load again." No raw `Internal {…}`. With one layer hidden, the load succeeds ✓. **But** re-showing the released layer while full gives no refusal, and every view goes black: **N18 (H)**. |
| A3 | N3 | ✅ | Integrated → Orthogonal: the dock stays. The relaunched surface-placeholder part was not run (no surface session). |
| A4 | N4 | ✅ | After closing every tab and the app exiting, the relaunch shows MNI anatomy, crosshair at (0, 0, 0) and the "Drop a map here" hint. A normal-quit relaunch is different: **N21**. |
| A5 | N5 | ✅ | `qa-run5`: no autocorrect bubble. The default name isn't selected, so typing appends: **N26** (L). |
| A6 | N6 | ✅ | Two fields, "z < −3.1 or z > 3.93". Negative cluster #4 is 26 vox, peak −4.75 at −3.1 extent. Clearing a field keeps both fields and focus. Band [0, 3.93] searches "z > 3.93, one-tailed (positive)", 4 clusters. Inspector peak 6.41 at (−40, −20, 50), not whole-brain. |
| A7 | N7 | ✅ | Toast plus Log: "Did not remove p4_zmap.nii: an image is still opening. Use Remove layer in the row menu." Nothing removed. (The row name was left text-highlighted, cosmetic.) |
| A8 | N8 | not run (physical) | |
| A9 | N9 | ✅ | ↑ ↑ over the Population Mean: map slice 48 → 50 mm. The main crosshair stayed at (42, 38, 2) when I left the Studio. |
| A10 | N10 | ✅ / ◐ | B–D over MNI anatomy, each with a colourbar. B mean is sequential (hot, 0–0.5). C residual and D z are diverging. **Pane A has two colourbars, one over the data**: see N16. |
| A11 | N11 | ✅ | `lesion.nii` over the T1: Fill at 35 %. Over the z map: Outline at 25 %. `p4_brain_mask.nii` opens as a label overlay. |
| A12 | N12 | ✅ | Mean ↔ Coverage ×5: anatomy every time, never an opaque box. |
| A13 | N14 | ✅ | Menu and ⌘K toggles both keep the crosshair at (42, 38, 0). Letters flip R/L. Fast typing right after ⌘K was captured in full ("radio"). |
| A14 | N15 | ✅ | Export preview at z = 2, ASEG only, with colourbar: legend lists all 10 drawn regions, including RH Pallidum and RH Hippocampus, with no "+N more". I checked the preview but did not save the file. |

### Part E: added after the main merge

| Step | Re-checks | Result | Note |
|---|---|---|---|
| E1.1 | HiDPI | ◐ | At rest, slices and the crosshair look crisp at screenshot resolution. Screenshots are 1× logical, so true 2× sharpness can't be confirmed. No run-4 screenshot was available to compare. |
| E1.2 | HiDPI | ◐ | Mid-splitter-drag, the capture looked slightly softer. It was sharp 0.5 s after release. Hard to judge at 1× capture. |
| E1.3 | HiDPI | not run (physical) | Synthetic ⌥-scroll steps the slice (z 2 → 3) instead of zooming. |
| E1.4 | HiDPI | not run (physical) | ⌘-Tab during a W/L drag. |
| E1.5 | HiDPI | ✅ | Clicks land where I point: Deck axial, coronal and sagittal, and Deck with Radiological on (−39, −19, 40 on the blob). Mosaic tiles are aligned. Zoomed case not run (physical). |
| E1.6 | HiDPI | not run (physical) | |
| E2.1 | plane toggle | ✅ | Deck shows one large view with an Axial \| Coronal \| Sagittal toggle. Clicks and the crosshair work on each plane, including with Radiological on. |
| E2.2 | plane toggle | ✅ | All four Compare panes follow the toggle. A is a single view. All four fit at 1372×887 without scrolling, also with the dock at ~180 px. |
| E2.3 | plane toggle | ✅ | Coronal, then an immediate click on B: (−2, −19, 6), y kept. Sagittal plus an immediate click: correct point. |
| E2.4 | plane toggle | ✅ | A fresh import (after relaunch) opened on Axial; the previous study was on Coronal. |
| E2.5 | Studio dock | ◐ | The Studio dock opens at about **100 px** (plan: ~120). Height is independent both ways ✓. Visibility is shared: closing it in the Studio closed it in Orthogonal: **N24** (L). |
| E3.1 | Modules | ✅ | Settings › Modules › Analysis on. |
| E3.2 | Modules | ◐ | View › Workspace lists Analysis after BIDS ✓, and its tab opens ✓. The dock was missing until shown via View › Panels (because of N24). |
| E3.3 | Modules | ✅ | Off, then relaunch: no Analysis tab, and its first screen doesn't run. On again: the tab returns in its slot (parked, not lost). I set it back to off. |
| E3.4 | Modules | ✅ | ⌘W and ⇧⌘W work (see A1 and N27). |
| E3.5 | Modules | ✅ / ◐ | After the Studio, L toggles the orientation labels off and on ✓. F runs, but the view was already fitted, so there was no visible change. |

### Part B: design changes

| Step | Re-checks | Result | Note |
|---|---|---|---|
| B1.1 | N13 | ✅ | Header is one line. Each lens has one toolbar row, with extras under "⋯ More" (zoom, refresh, preview exclusion). Widening Subjects 305 → 420 px doesn't wrap the toolbar (the Support badge truncates). |
| B1.2 | N13 | ✅ | Population maps ~450×570 px each. Deck view ~1030×600. Compare panes ~455×255 (~165 tall with a 180 px dock), readable. |
| B1.3 | N13 | ◐ | No column scroll was needed at this size. A synthetic wheel over the Population map didn't step the slice (↑ does). Wheel feel is physical, so re-check by hand. |
| B1.4 | N13 | — | Heights as above. What still feels cramped: Compare pane A's legend area (two bars, see N16). |
| B2.1 | N16 | ❌ | Orthogonal: the bar sits only under the axial brain, centred over the "P" label. Once panes get shorter or narrower (taller dock, wider side panel), it is drawn **over the brain** on a dark backing. |
| B2.2 | N16 | not run (physical) | Needs zoom. |
| B2.3 | N16 | not run (physical) | At default zoom the bar sits outside the volume bounds, and clicks there don't move the crosshair. |
| B2.4 | N16 | ❌ | Narrowing axial to ~140 px leaves **no** bar in that pane. The full bar jumps to the sagittal pane instead of a compact min/max bar. |
| B2.5 | N16 | ❌ / ✅ | Main Compare (⌘4): pane A's bar is in the top-right margin ✓. Studio Compare pane A: **two** bars, and the full one covers the member's only blob ❌. Integrated: the bar covers the axial brain ❌. |
| B3.1 | N17 | ✅ / not run (physical) | Glasser loads as a neutral 1 px single-colour mesh (25 %), not rainbow. Shared borders look single. It is faint over white matter. Zoomed smoothness needs physical zoom. |
| B3.2 | N17 | ✅ / ❌ | ASEG Outline keeps region colours, 2 px, with a dark edge ✓, **but only when Glasser is hidden.** With Glasser visible, ASEG outlines aren't drawn at all: **N20**. |
| B3.3 | N17 | not run | No time for the oblique fixture. |
| B3.4 | N17 | n/a | The UI has no per-region hide. Right-clicking a region row gives the raw WebKit menu: **N25**. |
| B3.5 | N17 | not run (physical) | |

### Part C: lows and regressions

| Item | Result | Note |
|---|---|---|
| Cluster row right-click | ✅ | Go to peak / Use cluster as region / Copy row; app menu, no WebKit. |
| "Use as region" in a 3D-only session | not run | No surface-only session. |
| Region readout (Glasser + ASEG, z selected) | ✅ | "RH Thalamus · FreeSurfer ASEG" at (14, −33, 2), where Glasser has none. |
| Mosaic ↑ | ✅ | Steps the mosaic's axial axis, z 2 → 3. The highlighted tile follows. |
| Status bar notation | ✅ | z 0.0367, −0.0278, 0.25; no scientific notation seen. |
| Same file twice | ✅ | Log warn: "p4_zmap.nii is already open; opened another copy". |
| Files search, no hits | ✅ | "No matching files / No neuroimaging files match this search." plus Clear search. |
| Compare pane names / hover | ✅ / ◐ | Names readable in main and Studio Compare. Hover replacement not checked. |
| ⌘4 with only a T1 | not run | |
| Context menu "Hide colorbar" (atlas selected) | ✅ | Present, along with Fit to view, Use neurological convention and others. |
| Shortcuts "O (letter)" | ✅ | "O (letter) — Go to world origin". |
| Surface tabs (order, slot, lh+rh) | not run | No surface session. |
| Close every tab → side panels keep width | ✅ | The left panel kept ~410 px. |
| Surface-tab status bar ≠ "Studio" | not run | |
| Studio: main crosshair unchanged after leaving | ✅ | (42, 38, 2) before and after. |
| Studio: "Open … in Deck" with distance sort | not run | |
| Studio: Deck colourbars share both ends | not run | |
| Memory 20-cycle | not run | Time. |

**Totals:**
- **1 new H:** N18.
- **N16 re-opened (M):** you flagged it during the run as well.
- **New M:** N20, N21, N22, N23.
- **New L:** N24–N29.
- Run-4 fixes verified: **N1, N2, N3, N4, N5, N6, N7, N9, N10, N11, N12, N13, N14, N15**. N8 needs a physical check. **N16 not fixed.** N17 partly works (blocked by N20).

---

## 2. Findings

### High

**N18: Re-showing a released layer while all 8 GPU slots are full blanks every view**
- **Where:** A2 (N2 follow-up).
- **Did:**
  1. Loaded 8 visible volumes. The 9th was refused ✓.
  2. Hid `toy_t1w`. The 9th (`oblique.nii.gz`) loaded ✓.
  3. Turned `toy_t1w` back to Visible (9 visible, 8 slots).
  4. Switched Integrated → Orthogonal.
- **Expected:** a refusal ("GPU texture slots full…") when re-showing, or eviction of another hidden layer.
- **Got:**
  - No toast and no Log line on re-show.
  - The views kept their last frame until the next full redraw. After the layout switch, **all three Orthogonal views were black**: no image, no crosshair, no colourbar.
  - Clicks didn't move the crosshair.
  - Turning `toy_t1w` Visible off restored everything at once.
- **Evidence:** `run5/n18-all-views-black.jpg`; Log shows no error between 13:03:53 and 13:04.
- **How often:** 1/1. Recovery confirmed.
- **Severity:** **H.** The whole viewer silently goes blank with no explanation. A user would think the data or the app is broken.

### Medium

**N16 (re-opened): The colourbar still lands over the data, or in the wrong pane**
- **Where:** B2.1, B2.4, B2.5, plus A10. You also flagged this during the run ("Color bar is still in a weird place").
- **Got:**
  - **Orthogonal, default:** the bar sits only in the axial pane, centred under the brain, crowding the "P" label. Sagittal and coronal have none. (`run5/n16-orthogonal-bar-under-axial.jpg`)
  - **Orthogonal, shorter or narrower panes:** after the side panel widened to ~410 px, the bar and its dark backing were drawn over the left-posterior quadrant of the axial brain, hiding cortex and the ASEG hippocampus outline. There was ~200 px of empty black above and below. Same at 13:07 with a taller dock. (`run5/n16-orthogonal-bar-over-brain.jpg`)
  - **Integrated:** the bar plus backing covers the axial brain's lower-right quadrant and the "P" label. (`run5/n16-integrated-bar-over-brain.jpg`)
  - **Narrow pane (B2.4):** at ~140 px, the axial pane gets no compact bar. The full bar moves to the sagittal pane. (`run5/n16-narrow-pane-bar-moves.jpg`)
  - **Studio Compare pane A:** two bars, a compact 0.4–1.1 bar top-right and a full "Faces beta (sub-01)" bar. The full bar is drawn over the member's only blob, in coronal and in axial after widening Subjects. (`run5/n16-studio-compare-paneA-bar-over-data.jpg`)
  - **Main Compare (⌘4) pane A and Mosaic:** the bar is in the right margin ✓. So the margin logic exists but isn't used in Orthogonal, Integrated or Studio pane A.
- **How often:** every time in Integrated and Studio pane A. In Orthogonal it depends on pane size.
- **Severity:** M. Data is hidden under the legend, which is what N16 set out to fix.

**N20: Only one atlas's outline is drawn at a time**
- **Where:** B3.2.
- **Did:** Glasser (Outline, 1 px) and ASEG (Outline, 2 px) loaded together, at z = 2.
- **Got:**
  - No ASEG outlines at all.
  - ASEG Fill draws ✓. ASEG "Both" looks identical to Fill (no outline).
  - Hiding Glasser makes the ASEG outlines appear at once.
  - Showing Glasser again made them vanish again.
- **Evidence:** `run5/n20-aseg-outline-missing-with-glasser.jpg` vs `run5/n20-aseg-outline-glasser-hidden.jpg`.
- **How often:** 2/2.
- **Severity:** M. A common setup (cortical plus subcortical atlas) silently loses one outline.

**N21: Relaunch after Brainflow › Quit restores the tabs but nothing in them**
- **Where:** E3.3.
- **Did:** Scene: MNI T1 + ASEG, a Studio study (fir3d), Radiological on. Brainflow › Quit, then relaunch.
- **Got:**
  - Orthogonal and Set studio tabs came back.
  - Orthogonal: "No volume loaded". No restored layers, and no MNI fallback, even though "MNI anatomy at start" is on.
  - Set studio: "No study loaded".
  - The Log shows only "LayerService ready"; no restore attempt, no error.
  - Run 4 restored layers ("Restored p4_zmap.nii").
- **Evidence:** `run5/n21-relaunch-empty.jpg`; Log 13:20:41.
- **How often:** 1/1.
- **Severity:** M. The session's work is lost on a normal quit.

**N22: The NeuroTabs import dialog is drawn underneath the panels**
- **Where:** A9 / E2.4 (Studio › Open NeuroTabs manifest).
- **Got:**
  - The import sheet's left edge is clipped by the centre tab strip ("f eview source", "/ euroTabs").
  - Its right side and footer are covered by the Inspector and the dock.
  - The **Import** button is hidden, and Return doesn't import.
  - I had to close the Inspector **and** the dock to reach Import.
- **Evidence:** `run5/n22-import-dialog-under-panels.jpg`.
- **How often:** 2/2.
- **Severity:** M. Importing a study is blocked unless you know to close two panels.

**N23: Main Compare panes are drawn at different scales**
- **Where:** B2.5 (⌘4 with `p4_zmap` in A and the T1 in B).
- **Got:** pane A's brain is noticeably smaller than pane B's at the same slice (z = 18). Run 4 F7 had checked "same scale".
- **Evidence:** `run5/n23-compare-different-scale.jpg`.
- **How often:** 1/1.
- **Severity:** M. A side-by-side comparison at different scales is misleading.

### Low

**N24: Dock visibility is shared across tabs, though its height isn't**
- Closing the dock in the Studio also closed it in Orthogonal.
- The Analysis tab then opened without a dock (E3.2).
- Height is independent ✓, which supersedes Part D's "dock height shared".

**N25: The raw WebKit context menu appears on Inspector › Regions rows**
- Right-clicking "LH Putamen" gives Look Up / Translate / Search with Google / Inspect Element.

**N26: The Save Layout default name isn't preselected**
- Typing appended to "Layout 11/1/2026, 1:05:07 PM", giving "…PMqa-run5". ⌘A was needed.

**N27: ⇧⌘W closes the window and the process exits**
- The relaunch was a fresh process with a new Log.
- Acceptable for a single-window app, but on macOS ⇧⌘W usually leaves the app running.

**N28: In the Studio Deck and Compare pane A, the horizontal crosshair is clipped**
- The line is drawn only across the volume's bounding box.
- With no anatomy underneath (F32), it reads as a truncated line.

**N29: Returning to the Studio shows Compare B–D without anatomy for ~3 s**
- The maps show over black, then the MNI anatomy fills in.

**Minor notes, not filed:**
- The N2 toast is truncated in the status bar ("Failed t…, then load again.") and stacks with "+4/+5".
- At 25 %, Glasser outlines are faint over white matter.
- The NeuroTabs importer log line reads well: "Loaded member s01_faces_l2 from …".

---

## 3. Fixed since run 4 (verified)

- **N1:** Close Tab ⌘W / Close Window ⇧⌘W.
- **N2:** clean refusal text, and hidden-layer release.
- **N3:** dock survives Integrated.
- **N4:** first screen reachable.
- **N5:** no autocorrect bubble.
- **N6:** asymmetric thresholds work.
- **N7:** Delete during a load is refused.
- **N9:** Population ↑ steps the map.
- **N10:** B–D colourbars and colormaps.
- **N11:** lesion and mask defaults.
- **N12:** Coverage 5/5.
- **N13:** Studio layout.
- **N14:** radiological toggle keeps the crosshair and letters.
- **N15:** full legend.

## 4. Part D: known open items (confirmed, not re-filed)

| Sev | Item | This run |
|---|---|---|
| L | ⇧⌘C mid-interaction copies a 1× frame | not run (physical) |
| M | WebView memory growth (F9) | not measured |
| M | Medial view shows the contralateral hemisphere | not run (no surfaces) |
| L | Deck cards and Compare pane A have no anatomy (F32) | confirmed: grey map on black in Deck and pane A |
| L | Coverage anatomy loss mitigated | confirmed: 5/5 kept anatomy |
| L | Outline ring search frame cost | not run (physical) |
| L | Last centre tab can't be dragged out | not run (physical) |
| L | Studio dock height shared with other tabs | **now independent** (E2.5); visibility is still shared (N24) |
| L | "base volume" label on the bottom row | confirmed: "T1w (brain) · base volume" |

## 5. State left behind

- Radiological is set back to neurological.
- Settings › Analysis module is back to off.
- Layout `qa-run5` was saved.
- Scene: MNI T1, `p4_zmap`, Glasser, ASEG. `test-data` is mounted.
- The Inspector moved into the left panel during the run (View › Panels toggling).
