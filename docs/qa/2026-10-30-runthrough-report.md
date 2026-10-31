# Brainflow desktop: run-through 3 report (2026-10-30)

**Binary under test:** `/Applications/Brainflow.app/Contents/MacOS/brainflow`, modified **2026-10-30 12:24 PM**, 225.3 MB (the plan requires 12:24 or later, so this is the right build). The repo is at `d321d2a1`, a docs-only commit on top of `0e53e6f6`. First launch was at 19:28 ("19:28:19 LayerService ready").

**How it was run:**
- Computer use (synthetic mouse and keyboard) on the MacBook display, 1372×887 logical pixels.
- Parts were run in the requested order: **A → D → B → C**. Where Part D disagrees with an older A/B step, D was applied.
- The Log dock was kept open wherever the app has one. Surface tabs and the BIDS tab have no bottom dock (F31), so the Log couldn't be open while those were in front.
- Checks that need a person are marked **not run (physical)**: wheel feel, Finder drags, real key repeat and `?`.
- The Known open items were confirmed only, not re-filed (§6).
- Severity: **H** = blocks or loses work · **M** = wrong or misleading, with a workaround · **L** = polish.

---

## 1. Scorecard

| Part | Step | Result | Notes / finding |
|---|---|---|---|
| A1 | Deck shows only the member | ✅ | The `s01_faces_l2…l5` cards each draw their own 4 mm beta map, with no T1 or atlas. |
| A1.3 | Step 3 members, no flash | ✅ | But every step logs an error: **F10** |
| A1.4 | Studio Compare pane A member-only | ✅ | Panes B–D draw no image: **F8** |
| A1.5 | Leave Studio: scene unchanged | ✅ | Scene is T1 / ASEG / Olsen with no "Faces beta". |
| A1.5 | …Plot dock cleared | ❌ | **F11** |
| A1.6 | Quick re-enter → Deck loads | ✅ | The member loads twice (L, F44). |
| A1.7 | Log under source `studio` | ✅ | |
| A2.1 | Population range follows data | ✅ | −0.496 to 0.496, drawn over MNI anatomy. |
| A2.2 | Slices with and without signal | ✅ | An empty slice shows clean anatomy, not a white wash (better than the known limit). |
| A2.3 | Manual range kept | ⛔ not runnable | There is no range control: **F12** |
| A3.1–3 | Size ↓/↑, Modified ↓/↑, second mount | ✅ | Checked against `ls -lS` / `ls -lt`. |
| A4 | Tabs after relaunch (×2) | ✅ (per D1.8) | Pill and view agreed every time, in both runs. Tabs get renamed: **F27** |
| A5.1–2 | Region from the same layer | ✅ | |
| A5.3 | "Removed <file>" | ✅ | Atlases are logged by internal id (L, F40). |
| A5.4 | Error names the file once | ✅ | |
| A6.1 | No autocorrect (⌘K, Go-to, Files search) | ✅ | |
| A6.2 | Fuzzy ⌘K hdr/xhair/rst | ✅ | The matcher is very loose (L, F41). |
| A6.3 | Show Crosshair ✓ follows state | ✅ | Works from both the menu and the Crosshair settings. |
| A6.4 | Reset Layout keeps the Ventral surface tab | ✅ | But Reset logs WebGL context loss: **F14** |
| A6.5 | Hover Info… | ✅ resolved | Removed; replaced by "Toggle Pointer Readout". |
| D1.1–2 | Pills / ⌘1–⌘4 change the tab in place | ✅ | |
| D1.3 | ⌘1 keeps the Orthogonal Panels variant | ❌ | **F13** |
| D1.4 | ⌘T new view in current layout | ✅ | |
| D1.5 | ⌘5/⌘6 single tool tabs; pills disabled | ✅ | |
| D1.6 | Close studio, ⌘5 → fresh tab | ✅ | |
| D1.7 | Close every tab → default view | ✅ via tab ×, ❌ via stack × | **F1 (H)** |
| D1.8 | Relaunch restores only tabs left open | ✅ for view and tool tabs | Surface tabs are dropped: **F15** |
| D1.9 | ⌘1/⌘T inert under ⌘K and Go-to | ✅ | |
| D1.10 | `-w mosaic` | ⛔ not runnable | There is no shell on the Mac; see §5. |
| D2.1 | T1 < BOLD < z < ASEG | ✅ | BOLD opens opaque and white: **F16** |
| D2.2 | Second anatomy on top at 50 % | ✅ | |
| D2.3 | Atlas over stat map at 60 % | ✅ | Shown as an outline. |
| D2.4 | Binary non-"mask" file shows as labels at 60 % | ❌ partial | **F17** |
| D2.5 | Manual order kept | not run (physical) | Synthetic drag can't reorder (F39). |
| D2.6 | Export legend at z = 48 empty / basal ganglia only visible | ❌ | z = 48 is the Known open item; truncation at 8 entries is new: **F18** |
| D3.1 | Crosshair / Pointer groups | ✅ | |
| D3.2 | ijk names grid; status = cluster table | ✅ | Both read 28, 56, 64. |
| D3.3 | Pointer greys out, never stale | ❌ | **F5** |
| D3.4 | 4D scrub, pointer value per frame | ✅ | Matches truth: 100.02 → 100.37 → 120. |
| D3.5 | Hide pointer readout persists | ✅ | |
| D3.6 | Settings ⌘, and unfinished-features gate | ✅ | |
| D3.7 | Go-to voxel names the grid and jumps correctly | ✅ | |
| D4.1 | Maps over MNI anatomy; open on blobs | ✅ | The Coverage summary is a solid yellow box: **F19** |
| D4.2 | Mean/Median diverging, others sequential | ⚠ unconfirmed | **F20** |
| D4.3 | Opens on the participant-mean peak | ✅ | Opens at z = 48 with both blobs. |
| D4.4 | Slice kept on reopen | ✅ | |
| D4.5 | Offline, cold cache | not run | Would require turning Wi-Fi off, which is a system setting. |
| B1.1–3 | 20 load/remove cycles, memory | ⚠ | The Rust side returns to baseline; the WebView keeps +150 MB: **F9** |
| B1.4 | Held Delete removes one | ✅ | Synthetic hold. |
| B1.5 | Remove while loading | ⚠ | A loading layer has no row, so Delete hits another layer (F35). |
| B1.6 | Fast visibility toggles on 4D, then remove | ✅ | |
| B2.1–4 | Oblique planes, steps, grow/shrink/grow | ✅ | |
| B2.5 | Zoom/pan kept | ⛔ | No zoom or pan control can be found: **F21** |
| B2.6 | Crosshair moves inside remaining image | ❌ | **F6** |
| B2.7 | Neurological ↔ Radiological | ⛔ | No control exists: **F22** |
| B2.8 | Compare panes share one scale | ❌ | **F7** |
| B3.1 | ↑/↓ in tree / Scene / Log don't move slices | ❌ (Log) | **F23** |
| B3.2 | Space after toolbar click | not run | |
| B3.3 | `?` | not run (physical) | |
| B3.4 | ⌘A | ✅ | |
| B3.5 | ⌘1 locked Orthogonal | ✅ | This conflicts with D1.3; D wins. |
| B3.6 | Wheel | not run (physical) | |
| B4.* | Drag and drop | not run (physical / synthetic drag unsupported) | |
| B5 | Command line | not run | Blocked; see §5. |
| B6 | Saved layouts | ❌ | **F2 (H)** |
| B7.1–3 | Surfaces: both hemispheres, per-tab camera | ✅ | |
| B7.4 | No surface warnings | ⚠ | Clean during the B7 session; layout rebuilds log context loss (F14). |
| B7.5 | Medial with both hemispheres | Known | Confirmed. |
| C1–C7 | Usability tasks | see §4 | 4 of 7 finished as specified. |

**Totals:**
- **2 H** findings, both new: F1 and F2.
- **~25 M** findings.
- The fixes from the 21:37 rerun mostly hold. Every Part A item except A1.5b passes. The Deck/Studio isolation fix and the Population display-range fix both work.

---

## 2. Findings (new or regressed)

Each finding is in this form:

- **Where**
- **Did / expected / got**
- **Evidence**
- **How often**
- **Severity**

### High

**F1 — Closing the tab stack deletes the whole centre of the window**
- **Where:** D1.7.
- **Did:** With 8 tabs open (Set studio in front), clicked the stack-level × at the top right of the tab strip.
- **Expected:** a default view, as when the last tab is closed.
- **Got:**
  - All tabs **and the bottom Log dock vanished**. Files and Inspector stretched across the window. No default view appeared.
  - Pills stayed "In Studio" (disabled) and the status bar showed "Coordinate system Studio".
  - ⌘1 did nothing. ⌘T lit the Orthogonal pill but still drew no view.
  - Only ⌘K › Reset Layout recovered.
- **Evidence:** screenshot at 19:48. Recovery: Reset Layout gave "Set studio" + "Orthogonal" (Panels variant).
- **How often:** once (1/1).
- **Severity:** **H**. The window becomes unusable and the user can't recover without knowing about Reset Layout.

**F2 — Saved layouts never restore**
- **Where:** B6.
- **Did:**
  1. Workspace › Save Current Layout… (prefilled "Layout 10/30/2026, 8:26:16 PM"); named it `qa-run3` and saved. It appears under Layouts.
  2. Switched to Mosaic and the Plot dock tab.
  3. Workspace › qa-run3.
- **Expected:** the saved layout comes back.
- **Got:**
  - Modal: *"Layout 'qa-run3' could not be restored. Recovered with default layout."*
  - After OK, nothing changed: still Mosaic and Plot. So it neither restored nor reset, despite the message.
  - Nothing in the Log.
- **Evidence:** modal text above, at 20:26.
- **How often:** always (2/2).
- **Severity:** **H**. The feature does not work, and the message is false.

### Medium

**F5 — The Pointer readout goes stale**
- **Where:** D3.3, seen in B2.1 and A2.
- **Expected:** the Pointer group greys out or updates; it never shows a stale value.
- **Got:**
  - **Main view:** with the pointer held still, ↑ moved the axial slice from 21 to 25 to 29 while Pointer kept reading "(3.8, −0.1, 21.0) 432". ⌘-scroll from z 29 to 33 behaved the same way: "(−2.3, −5.9, 29.0) 6983".
  - **Studio Population:** Pointer stuck at "(23.0, 11.0, 47.0) 0" while the pointer moved over the other pane and onto the toolbar. It read value 0 even inside a visibly coloured blob, and never greyed.
  - Moving off the image in the main view does grey it correctly ("Pointer — —").
- **How often:** always (5/5).
- **Severity:** M.

**F6 — Removing the larger image leaves the crosshair outside the remaining one**
- **Where:** B2.6.
- **Did:** Crosshair at (−46, 44, 33), inside the T1 and outside `oblique.nii.gz`. Removed the T1.
- **Expected:** the crosshair moves inside the remaining image and no pane shows an empty slice.
- **Got:**
  - The crosshair moved to (−3.0, 6.5, 33.0). x and y were clamped but z was not.
  - Status bar: "ijk – (oblique) –".
  - The sagittal and coronal panes are black apart from the crosshair lines.
- **How often:** 1/1.
- **Severity:** M.

**F7 — Compare panes don't share a scale**
- **Where:** B2.8, also seen in C3.
- **Did:** Compare (⌘4) with `oblique.nii.gz` and the MNI T1, in both Row and Grid.
- **Expected:** the panes share one world scale.
- **Got:** pane A (oblique) is magnified to fill its pane, while pane B (T1) shows the whole brain with the oblique as a small patch.
- **How often:** always.
- **Severity:** M. This regresses the rerun's "share one world scale" fix for the small-image case.

**F8 — Studio Compare panes B–D show a cache path instead of a map**
- **Where:** A1.4 / A2.
- **Did:** Studio Compare with "Current vs All members (n=72)".
- **Expected:** All members, Residual and Z-score maps.
- **Got:**
  - The panes are marked **Ready** but their body is text, for example *"Derived cohort mean cache hit at /var/folders/9h/…/T/brainflow_set_studio_cache/cohort-mean:2e0ba322f905e089.nii.gz."*
  - Panes C and D say the same for residual and z-score. No image appears, even after waiting.
- **How often:** always (2/2).
- **Severity:** M.

**F9 — WebView memory not released after layers are removed**
- **Where:** B1.1–3.
- **Did:** 20 cycles of loading MNI T1, `p4_zmap.nii`, `labels.nii.gz` and `oblique.nii.gz`, then removing all four. Removal used the context menu, Delete, BackSpace and Loaded › Unload.
- **Got (Activity Monitor):**

  | Process | Before | After +10 s | After +40 s |
  |---|---|---|---|
  | Brainflow | 114.8 MB | 115.1 MB | 116.0 MB |
  | `tauri://localhost` (WebView) | 171.7 MB | 337.6 MB | 320.2 MB |

- The Rust side is flat. The WebView keeps about 7–8 MB per cycle.
- The Log was clean: no error lines after all cycles.
- **How often:** measured once.
- **Severity:** M (likely a leak of textures or typed arrays in the UI).

**F10 — Every Studio member step logs an "undefined" error**
- **Where:** A1.3.
- **Did:** Stepped through Deck members.
- **Got:**
  - "19:32:14 error layer Layer volume_c error: undefined"
  - 19:32:17 `volume_f`, 19:32:20 `volume_a`
  - Each comes right after "Loaded member …". Nothing visibly breaks.
- **How often:** always (3/3).
- **Severity:** M (log noise, an undefined error, and a hidden bug underneath).

**F11 — The Plot dock keeps the Studio series after leaving Studio**
- **Where:** A1.5.
- **Did:** Left Set studio for the Orthogonal tab.
- **Expected:** the Plot dock no longer shows the Studio series.
- **Got:** Plot still shows Series · Population/Participants · Band 95 % CI(t) · faces/houses · Lag (TR) 0–5.
- **How often:** 1/1.
- **Severity:** M.

**F12 — Population lens has no manual range and no colourbar**
- **Where:** A2.3.
- **Got:**
  - The range is only shown as a label ("−0.496 to 0.496"). Clicking it does nothing.
  - Right-clicking the map gives only WebKit's "Reload / Inspect Element".
  - The Inspector has no display controls.
- **Severity:** M. A2.3 can't be run.

**F13 — ⌘1 forgets the Orthogonal Panels variant**
- **Where:** D1.3.
- **Did:** View › Layout › Orthogonal Panels, then ⌘2 → ⌘1 (and ⌘3 → ⌘1).
- **Expected:** ⌘1 returns to the Panels variant.
- **Got:** ⌘1 returns to the tiled layout.
- **How often:** always (2/2).
- **Severity:** M.

**F14 — Layout rebuilds log WebGL context loss**
- **Where:** A6.4 / D1.3 / B7.4.
- **Got, verbatim:**
  - Reset Layout: "19:45:18 warn surface surface-view: WebGL context lost; the surface view stops drawing until it is restored" ×3, then "19:45:18 warn surface 5jYIE5B3ZewSbYFxrqEn3: WebGL context lost; the surface view stops drawing until it is restored".
  - The same message at 19:46:30 (Orthogonal Panels) and 19:46:55 (⌘2), and several more at 19:47.
- The surface tab redrew correctly afterwards.
- **How often:** always, on layout rebuilds.
- **Severity:** M. The plan asks for these lines to be copied exactly. Contexts are probably being leaked or recreated per rebuild.

**F15 — Surface tabs don't survive relaunch**
- **Where:** D1.8.
- **Did:** Quit with fsaverage5 Pial and White tabs open.
- **Got:** relaunch restored Mosaic and BIDS only.
- **How often:** 1/1.
- **Severity:** M.

**F16 — 4D BOLD opens opaque and saturated**
- **Where:** D2.1.
- **Did:** Opened `raw4d_bold.nii`.
- **Got:**
  - It opens at 100 % opacity with a grayscale window of 0–100.07 (in-brain values are about 100).
  - Result: a flat white slab that hides the T1. Over anatomy only the z blobs and ASEG outlines show; alone it is a white blob.
- **How often:** always.
- **Severity:** M.

**F17 — A binary file is not treated as labels**
- **Where:** D2.4.
- **Did:** `p4_brain_mask.nii` (uint8, values 0/1) copied to `~/Downloads/brainflow-qa-scratch/lesion.nii`.
  - `edge_border.nii` is not binary (values 1/2/3 on an 8³ grid), so it doesn't fit the step.
- **Expected:** labels at 60 %, above the stat map.
- **Got:** a grayscale **volume overlay** at 60 %, at the top of the stack, whitewashing the head.
- **How often:** 1/1.
- **Severity:** M.

**F18 — The export legend is capped at 8 entries**
- **Where:** D2.6.
- **Did:** Exported an axial slice at z = 2 through the basal ganglia.
- **Got:**
  - The legend lists exactly 8 regions: LH Thal, Caud, Put, Pall, Hipp; RH Thal, Caud, Put.
  - RH Pallidum and RH Hippocampus are drawn but missing.
  - At z = 48 it also lists exactly 8 regions that are absent. That is the Known open item, confirmed only.
- **How often:** 2/2 exports.
- **Severity:** M.

**F19 — The Coverage summary is an opaque box**
- **Where:** D4.1.
- **Got:** "Coverage · 0 to 72.0" draws a solid yellow rectangle over the whole 4 mm support box and hides the anatomy. This is the "white square" class of bug in another colour.
- **How often:** always.
- **Severity:** M.

**F20 — Mean and Median don't look diverging**
- **Where:** D4.2.
- **Got:**
  - Mean and Median have a symmetric range (−0.496…0.496) but render in the same yellow/orange palette as SD and Cancellation.
  - The member pane uses red/blue.
  - With no colourbar (F12), I can't confirm a diverging map.
- **Severity:** M (unconfirmed).

**F21 — No discoverable zoom or pan**
- **Where:** B2.5.
- **Got:** the Shortcuts dialog lists none, ⌘-scroll steps slices like a plain scroll, and there's no toolbar control.
- **Severity:** M. B2.5 can't be run without a trackpad.

**F22 — No Neurological/Radiological switch**
- **Where:** B2.7.
- **Searched:** ⌘K ("radio" → no match), the View menu, the view's right-click menu, Crosshair settings, Inspector › View behavior, and the status bar's "RAS".
- **Severity:** M.

**F23 — Arrow keys in the Log move slices**
- **Where:** B3.1.
- **Did:** Clicked a Log line, then pressed ↓ ↑ ↑.
- **Got:** the crosshair moved from (−3, 6.5, 33) to (−4, 8, 37).
  - The tree behaves correctly (selection moves, slice doesn't).
  - The Scene list doesn't move its selection either (L).
- **How often:** 1/1.
- **Severity:** M.

**F24 — ↑ over a Population map changes the lens**
- **Where:** A2 / B3.1.
- **Did:** Clicked the Population lens button, then pressed ↑ with the pointer over the map.
- **Got:** the lens switched to Compare instead of the slice moving. Arrow keys go to the focused segmented control.
- **Severity:** M.

**F25 — File › Open greys out `.nii.gz`, and is single-select**
- **Where:** B1 / C3.
- **Got:**
  - `labels.nii.gz` and `oblique.nii.gz` are greyed and can't be clicked.
  - Typing the path with ⇧⌘G *does* open them, so this is a file-type or UTI filter bug, not an unsupported format.
  - Shift-↓ doesn't extend the selection.
- **How often:** always.
- **Severity:** M.

**F26 — Export can't produce a mosaic**
- **Where:** C4.
- **Got:**
  - Export View's options are Axial / Sagittal / Coronal / Orthogonal layout / Figure row.
  - From a Mosaic tab it defaults to *Sagittal x = −28*.
  - The legend in that preview listed only Olsen while ASEG outlines were drawn.
- **Severity:** M. Task C4 can't be done.

**F27 — Untouched tabs are renamed**
- **Where:** A4 / D1.1.
- **Got:**
  - Pills auto-number the front tab ("Integrated 3", "Mosaic 2", "Compare 2").
  - Switching the front tab to Orthogonal **renamed a different tab** from "Orthogonal" to "Orthogonal 2"; switching away renamed it back.
- **How often:** always.
- **Severity:** M (confusing identity).

**F28 — No undo for scene edits**
- **Where:** C7.
- **Got:** changed opacity, then ⌘Z: nothing. Edit › Undo exists but only works in text fields. A removed layer must be reloaded.
- **Severity:** M (design).

**F29 — Fast successive opens are dropped**
- **Where:** B1.
- **Got:** double-clicking several tree files without a pause while the T1 is still loading loads only the first two. The rest vanish with no Log line.
- **How often:** 2/2 fast attempts.
- **Severity:** M.

**F30 — ⌘K has no atlas or template commands**
- **Where:** A5.
- **Got:** "atlas" matches "Show Inspector" and "Layout: Orthogonal Panels"; "aseg" matches "Crosshair Settings…".
- **Severity:** M (discoverability). The fuzzy matcher is also too loose (F41).

**F31 — No dock in surface or BIDS tabs**
- **Where:** global.
- **Got:** ⌘P and View › Panels › Plot Panel do nothing while one of these is in front. The Log can't stay open "throughout".
- **Severity:** L–M.

### Low

- **F32:** The Population/Deck/Compare-A panes disagree about anatomy: Population draws over MNI; Deck and Compare A are member-only blobs with no outline.
- **F33:** The Deck colourbar auto-windows per member (0.7 / 0.24 / 0.1), so cards can't be compared, and there's no shared-scale option.
- **F34:** The status bar's frame readout disagreed with the layer: "9/30 · 0:16" (left over from an earlier session) versus Inspector "frame 1/30" after loading raw4d. Once.
- **F35:** A loading layer has no Scene row, so you can't cancel a load, and Delete during a load removes whatever row is selected.
- **F36:** The window size isn't restored on relaunch (every relaunch). Mounted roots aren't restored either.
- **F37:** Layer defaults are context-dependent and invisible:
  - ASEG over plain T1: 100 % Fill.
  - ASEG over a stat map: 60 % Outline.
  - Olsen over ASEG: 60 % Fill.
  - The rule should be visible ("Added as outline over the stat map").
- **F38:** A full-head T1 opened after a small oblique goes **on top** at 50 % because the oblique became "base".
- **F39:** Scene rows have no Move up/down. Dragging over rows selects their text (`user-select` isn't disabled). A ⠿ handle appears on hover.
- **F40:** The Log uses internal ids: "Loaded atlas:freesurfer_aseg", "Removed atlas:olsen_mtl", "Loaded template:MNIColin27_T1w_native", "5jYIE5B3…: WebGL context lost". Truncated-file errors are logged under source "ui".
- **F41:** Shortcuts and command naming:
  - Key **0** is bound twice: "Show all layers" and "Go to image origin".
  - The Mac shortcuts dialog lists both "Cmd+K" and "Ctrl+K".
  - The Workspace menu shows "Cmd/Ctrl+T".
  - There's no "Show Crosshair" in ⌘K.
  - ⌘K has no frame or time commands.
- **F42:** The Go-to Voxel fields are labelled X/Y/Z with "vox" units rather than i/j/k. Invalid text carries over from World mode.
- **F43:** Synthetic file-dialog clicks sometimes fall through to the view and move the crosshair (to (78, −18, −21)). A person should re-check this with a real mouse.
- **F44:** Studio details:
  - Re-entering Studio loads the member twice.
  - The Summary dropdown resets from Median to Mean when the lens is reopened.
  - The first click on −1 mm after another control is sometimes eaten (8 clicks moved 7 mm).
  - Population panes draw two parallel vertical crosshair lines.
  - The pane-A colourbar chip overlaps the lock button.
- **F45:** Studio maps get about 100 px of height with the Log open. You must scroll past Summary, Statistical question, Spatial relationships and the Play bar to see them.
- **F46:** Files UI:
  - Search shows no "no matches" message.
  - Clearing the search collapses all expanded folders.
  - Size-sort ties aren't broken by name.
  - The Files header lags behind the mounted roots.
- **F47:** Small UI inconsistencies:
  - View › Layout has no ✓ on the current layout.
  - Context-menu capitalisation is mixed ("Hide pointer readout" / "Hide Orientation Labels").
  - The Settings label is truncated ("Show unfinishe…").
  - Disabled pills still show a hover highlight.
- **F48:** Mosaic "Auto (2×5)" showed 9 tiles. The surface tab is titled "fsaverage5_pial_left" when both hemispheres are loaded.
- **F49:** Region falls back to an unnamed atlas when the stat map is selected ("■ LH Pallidum"); it should name the atlas.
- **F50:** C5 data oddity: "Nearest to s01_faces_l2 → s01_houses_l4, distance 0". A faces map identical to a houses map? Check the fixture.

---

## 3. Part D notes (design changes)

D is mostly delivered:
- Navigation is far saner: pills change the tab in place, tools are single-instance, relaunch restores what you left.
- The status bar redesign is right.
- Stacking by role works for the common cases.

The misses are:
- The **stack ×** (F1).
- **⌘1 forgetting Panels** (F13).
- **Binary-as-labels** (F17).
- **Legend truncation** (F18).
- The **stale pointer** (F5).

---

## 4. Part C — usability tasks

Times come from the menu-bar clock. "Finished" means done as specified using only the UI.

| # | Task | Time | Finished | Hesitations | Couldn't find | One sentence to make it obvious |
|---|---|---|---|---|---|---|
| 1 | Stat map over T1, \|z\| > 3.1 hot/cold, peak of largest cluster | ~1.5 min | ✅ | Clusters needs a manual **Compute**; nothing on the map says clusters exist. File › Open greys `.nii.gz`. | — | Compute clusters on load and show "Peak z 6.41 at (−40, −20, 50)" in the Inspector. |
| 2 | ASEG at (−22,−4,−2); Olsen nearest (−28,−22,−14) | ~1 min | ✅ | Must know `g`. There's no "nearest region" when outside every label. | Nearest-region readout | Answers: **LH Pallidum**; Olsen **LH CA3 DG** (inside it). The Scene "At crosshair" column, which shows each atlas's label at once, is the best thing in the app. |
| 3 | Side by side, then four panes, each a different image, identify without hovering | ~1.5 min | ◐ | ⌘4 auto-built **five** panes, one per layer. In Row mode the headers truncate and names disappear. Pane B is at another scale. | How to choose 2 or 4 panes; how to set each pane's layer | Make Compare "[layer ▾] vs [layer ▾]" with a pane-count stepper, and keep names visible at any width. |
| 4 | Axial mosaic of z over T1 with colourbar and legend | ~1.5 min | ❌ | Export opened on *Sagittal* from a Mosaic tab. Right-click on the mosaic gives "Reload / Inspect Element". | Mosaic export | Export what's on screen by default. (Legend Known open item: confirmed in D2.6.) |
| 5 | Import fir3d, find the member least like the mean, open in Deck | ~1.5 min | ❌ | Spatial relationships › Fit gives a 2-D map and a "nearest to" list, but the mean isn't on the map and nothing ranks by distance to mean. | Outlier or "distance to mean" ranking | Add a "Distance to group mean" sort to the Subjects list with "Open in Deck". |
| 6 | Remove everything, clean default layout, relaunch clean | ~1 min | ✅ (mostly) | Reset Layout doesn't close tool tabs; I closed Set studio and BIDS by hand. After relaunch BIDS was back, possibly because my × click missed. | "Start fresh" | One "New session" command that empties the scene and closes tools. |
| 7 | Recover from mistakes; is there undo? | ~0.5 min | ❌ | ⌘Z and Edit › Undo do nothing for opacity, visibility or removal. | Undo | Make every scene edit undoable, and show "Removed lesion.nii — Undo" as a toast. |

**Overall impressions**
1. **Solid:**
   - Correctness: cluster and peak values match `truth.json` exactly.
   - 4D values track the frame precisely.
   - Region readouts are right and come from the selected layer.
   - Errors name the file once.
2. **Solid:** the per-layer "At crosshair" column and the new Crosshair/Pointer status bar make reading coordinates trustworthy.
3. **Solid:** navigation is no longer a maze. Pills change the tab, tools open once, and relaunch restores what you left.
4. **Fragile:** layout persistence. Saved layouts never restore (F2). The stack × wipes the window (F1). Reset Layout and layout switches leak WebGL contexts (F14).
5. **Fragile:** Studio still shows developer plumbing: cache paths in panes (F8), "undefined" errors (F10), and no colourbar or range control (F12).
6. **Fragile:** defaults for new layers decide whether the first screen is readable. A white BOLD slab, a grey "lesion" and a yellow coverage box all hide the anatomy.
7. **Single change that would most improve a first session:** make the first screen tell the truth with no setup. Pick auto-windows and roles for every new layer, and give every map a visible colourbar. Then a newcomer never sees a white square and has to guess why.

---

## 5. Not run, and why

- **Physical:** B3.3, B3.6, B4.1–4.3, B4.8, B4.10 and D2.5. Synthetic drags in the WebView never start an HTML5 drag, so B4.4–4.7 and B4.9 weren't run either.
- **B5 (CLI) and D1.10 (`-w mosaic`):**
  - The analysis VM can't see `/Applications` or run `open`.
  - Computer use is click-only in Terminal, so it can't type commands.
  - These need a person, or a Mac-side shell.
- **D4.5:** needs Wi-Fi turned off, which is a system setting.
- **B3.2:** not run (no 4D was loaded at that point).
- **B6 relaunch-restore:** moot, because restore never works.

## 6. Known open items — confirmed, not re-filed

| Item | Status this run |
|---|---|
| Medial view with both hemispheres shows the other hemisphere | **Confirmed** (fsaverage5 White, Medial shows the right lateral surface with the cursor dot on top). |
| Export legend lists absent regions | **Confirmed** (z = 48, 8 ASEG regions listed, none present). Truncation at 8 is filed separately as F18. |
| Shift/⌥ lost on a Finder drop | Not checkable (physical). |
| Visual baselines not regenerated | Test-side; not checkable here. |
| `.surf.gii.gz` not listed in Files | **Confirmed**: `test-data/browser/octahedron.surf.gii.gz` exists and is not shown in the tree. |

---

## 7. Product notes ("as if you're Steve Jobs")

These are blunt design opinions, not measurements. No quotes are attributed to anyone.

- **The first ten seconds are the product.** Today they are a black pane, two buttons and a Log full of internal ids. A neuroimaging viewer should open with an MNI brain already on screen, the crosshair at the origin, and one sentence: *"Drop a map here."* Make the empty state beautiful and useful.
- **Every pixel of the image area must earn its place.** Studio puts Summary, Statistical question, Spatial relationships and a Play bar *above* the maps. The maps get about 100 px. Invert it: maps first, controls on demand.
- **Defaults are the design.** A white BOLD slab, a grey "lesion" and a yellow coverage box all fail before the user has done anything. The app knows what each file is (anatomy, 4D, stat, label, binary), so it should pick the window, colour map, opacity and position, and say what it did in one line.
- **Never show the plumbing.** Cache paths, `volume_c error: undefined`, `atlas:olsen_mtl`, `5jYIE5B3…: WebGL context lost`, and WebKit's "Reload / Inspect Element" menu should all be gone from the user's world.
- **One way to do each thing.** Tabs still rename themselves ("Integrated 4", "Orthogonal 2"). ⌘1 has two meanings. Key 0 has two meanings. ←/→ silently switch between slice and time. Each control should mean one thing and look the same everywhere.
- **Trust is binary.** A readout that is stale once (F5) is a readout nobody believes. The numbers here are excellent and match the truth exactly. Protect that reputation ruthlessly.
- **Delight is cheap once the basics are right.** Undo with a toast, an "At crosshair" column for every atlas, and a one-click "Export what I see" would make this feel like a tool people recommend, not just tolerate.

---

## 8. Housekeeping

These items are left on the Mac:

- `~/Downloads/brainflow-qa-scratch/` contains `lesion.nii`, `lesion_edge.nii`, and `b1/`, about 38 MB of fixture copies including gunzipped `.nii`.
- `~/Downloads/brainflow-qa-bad/`, from the earlier run.
- An app saved layout named `qa-run3`.

Settings were returned to their defaults: Pointer readout on, unfinished features off.
