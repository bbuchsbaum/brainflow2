# Brainflow desktop re-run — 2026-10-29 (21:37)

**Build:** `target/debug/bundle/macos/Brainflow.app` built 21:23. HEAD was `c66551df` plus a large uncommitted diff (343 files). I launched this bundle directly, not `/Applications`.
**Scope:**
- Re-checked every H/M issue in `2026-10-29-runthrough-report.md`.
- Spot-checked areas that passed before.
- Added design impressions (§4).

Every check used the same fixtures and steps as the previous report.

## 1. Scorecard

| # | Previous issue | Sev | Now |
|---|---|---|---|
| 1 | ASEG names/colours wrong | H | ✅ **Fixed.** The legend uses FreeSurfer IDs (10 LH Thalamus … 49 RH Thalamus). (−26,4,2) reads 12 "LH Putamen" and (26,4,2) reads 51 "RH Putamen". Both hemispheres are coloured. |
| 2 | Olsen MTL outside the brain | H | ✅ **Fixed.** Regions are bilateral and inside the medial temporal lobe; (−28,−22,−14) reads "LH Hippocampus". |
| 3 | Oblique first layer → panes follow voxel axes, later layers cropped | H | ✅ **Fixed.** All three panes are world planes (axial A up, sagittal A/P, coronal L/R), confirmed by clicks. The field of view is now the union of the layers. The ijk readout names its reference grid. |
| 4 | Drag-and-drop from Finder | H | ✅ **Fixed.** `oblique.nii.gz` dropped onto the view loads in 87 ms. |
| 5 | Files search ghost rows | H | ✅ **Fixed.** Search finds files inside collapsed folders and shows a clean filtered tree. Clearing, searching and sorting leave no stale rows. |
| 6 | Black surface tab | H | ✅ **Fixed.** The fsaverage5 Pial tab renders at a good size with a linked cursor dot and a Vertex readout. |
| 7 | Population lens empty after import | H | ✅ **Fixed.** No error banner; "Mean · 72 observations" and the actual observation both render. *But* see §3: the display window makes them a flat white square. |
| 8 | No way to remove a layer | M | ✅ **Fixed.** Layer context menu now has "Hide layer / Remove layer". |
| 9 | New layers on top at 100% | M | ◐ **Improved.** A 4D volume opened after atlases is inserted *below* them, so labels stay visible. A second volume still covers the anatomy at 100%. |
| — | Opacity lost on hide/show | M | ✅ **Fixed** (49% survives). |
| — | Load atlas dialog stays open | M | ✅ **Fixed** (closes; atlases load at 60%). |
| — | "[object Object]" on ROI field | M | ✅ **Fixed.** |
| — | Space doesn't play | M | ✅ **Fixed.** |
| — | ↑/↓/PageUp don't move slices | M | ✅ **Fixed** (↑ moves +1 mm, PageUp +10). Wheel-up now moves superior. |
| — | ⌘B / Layer Manager add duplicate panels | M | ✅ **Fixed.** |
| — | Compare: scale mismatch, no pane identity, new tab each time | M | ✅ **Mostly fixed.** The existing tab is reused, panes are lettered A–D and share one world scale. Pane headers still lack layer names. |
| — | Clusters on an atlas looks usable | M | ✅ **Fixed.** Shows "Load a statistical map to find clusters" and greys out the controls (L: Compute still looks enabled). |
| — | Image Header shows f32, no slope | M | ✅ **Fixed.** Shows int16, 16 bits, "Loaded as f32", slope 0.1, intercept 0. |
| — | Truncated / empty file messages | M/L | ✅ **Fixed.** Truncated: "the header declares 34120436 bytes … but the file has 100000". Empty: "not a NIfTI file: the file is empty". |
| — | Unmount selected removes the wrong root | M | ✅ **Fixed.** |
| — | Retry after a moved folder ("Directory ''") | M | ✅ **Fixed.** |
| — | Studio Deck adds a layer to the workspace | M | ✅ **Fixed** (scene stays at 5 items). |
| — | Export legend lists absent regions | M | ✗ **Still open.** At z=50 the legend lists six Olsen regions with none in the slice. |
| — | Medial view with both hemispheres | L | ✗ **Still open, and worse.** It shows the right hemisphere's lateral face, and the left-hemisphere cursor dot is drawn on top of it (the marker ignores occlusion). |

Result: all 7 H issues and 15 of 16 M issues are fixed or improved.

## 2. New or regressed issues

| Sev | Issue | Repro |
|---|---|---|
| M | **Set studio Deck shows the main workspace scene.** The Deck card for `s01_faces_l2` is titled "Faces beta (sub-01)" but draws the MNI T1 with ASEG/Olsen colours, not the member's 4 mm beta map. This known bug didn't reproduce last time, when the workspace held no atlases; the Deck viewer appears to share the workspace render scene. | Load T1 + ASEG + Olsen → Set studio → open NeuroTabs fir3d → Deck. Always. |
| M | **Sort by Size ignores size.** Size ↓ lists the `unit/` folder in reverse alphabetical order (`unscaled_u8` first; the 34 MB T1 in the middle). Folders are also reverse alphabetical. | Files › Tree › Size › ↓. Always. |
| M | **The workspace pill and the stage disagree after relaunch.** Clicking the Orthogonal pill highlighted it but kept showing "Integrated 3", and the front tab "Integrated 4" disappeared. Clicking the Orthogonal *tab* was needed. | Relaunch with many restored tabs → click a pill. Once. |
| L | **Tab sprawl persists across launches:** Integrated, Integrated 2, Integrated 3, plus old Compare and surface tabs, all restored. | Relaunch. |
| L | Removing a layer writes nothing to the Log. Studio member loads are logged as ordinary "Loaded file (layer volume_…)" lines even though they aren't in the scene. | — |
| L | With two atlases loaded, the status bar's Region slot can come from a different atlas than the Layer/Value slots ("Layer Olsen MTL · Value 0 · Region RH Putamen"). | — |
| L | The first click on a surface camera preset was sometimes ignored. | Dorsal needed two clicks. |
| L | Population panes are a flat white square: the window is fixed at −1…1 while the phantom's in-head baseline is about 1.1. | fir3d → Population. |

## 3. Still open from earlier (L)
- The status-bar ijk uses the reference grid; the cluster table uses the layer grid.
- Error text repeats its prefix ("Failed to load X: Failed to load file /path: …").
- Autocorrect bubbles in the search and palette fields.
- No fuzzy matching in ⌘K.
- Hover Info… is a no-op.
- Show Crosshair has no checkmark.
- Not re-checked this run: the Files Images tab, the Annotate stub, and the Mosaic tile step.

---

## 4. Impressions and design suggestions

**Overall.** This build feels like a different app from this morning. The geometry, atlas and loading fixes remove the "can I trust what I see?" doubt. The cluster/RFT, 4D series, FIR and error-message work is now at a standard a methods paper could cite. The remaining friction is mostly **information architecture**, not correctness.

### What's working well
- **Precise, explanatory text.** The cluster footer, the RFT assumptions, the truncated-file message and the "Load a statistical map to find clusters" empty state all say exactly what happened and why. Make this the house style everywhere.
- **Context-aware shortcuts**, such as "Use selected folder: unit" in Set studio, and the Region series hint with a Load atlas… button. More of these.
- **Surfaces now feel first-class.** They open large, show a linked cursor and fill in the Vertex readout.
- **Sensible defaults** where they exist: atlases at 60%, stat maps auto fMRI Red-Blue at ±3.1 with "|z| ≤ 3.1 hidden" wording.

### Where the design fights the user

1. **Too many ways to say "workspace."**
   - There are three layers of navigation: pills (Orthogonal/Integrated/Mosaic/Compare), tabs (which multiply as "Integrated 2/3"), and a Workspace menu (Read/Explore/Analyze/Compare/Set studio/BIDS).
   - The pill and the visible tab can disagree.
   - *Suggestion:* make pills switch the **layout of the current tab**. Keep tabs only for genuinely separate scenes, created on purpose (⌘T, "Open in new tab"). Never create "… 2" implicitly. Don't restore more than the last tab set without asking.

2. **One shared scene, three views of it.**
   - Orthogonal, Compare and Integrated share a scene. Studio Deck borrows it (now wrongly), and Compare decides its pane composition opaquely: atlas panes include the T1, the BOLD pane doesn't.
   - *Suggestion:* make the scene explicit. Show a small "Scene: 5 layers" chip on each view. In Compare, give each pane a header like **"A · raw4d_bold"** and a one-click "choose layer" control. Studio should never render the workspace scene.

3. **Layer-stacking rules aren't legible.** It's now partly smart (atlases stay on top), but a second anatomical volume still blankets everything.
   - *Suggestion:* stack by **role**: anatomy → functional/stat → labels → masks. A new anatomy loads below, at 100%; functional loads at about 70%. Show a one-line toast ("Added under the atlases; drag to reorder"). Reordering should accept fast drags.

4. **Two coordinate grids in one window.** The status bar's ijk is the reference grid, while the cluster table and Image Header use the layer grid.
   - *Suggestion:* the status bar shows `ijk (layer) 28 56 64`, and the reference grid goes in a tooltip. The Go-to dialog's Voxel tab should label its fields i/j/k and say which layer they refer to.

5. **The readout model is ambiguous.** The status bar mixes pointer (Mouse) and crosshair (Value/Region), and Region can come from any atlas.
   - *Suggestion:* give the status bar two clearly labelled groups, **At crosshair** and **Under pointer**. Show one Region per loaded atlas, or pick the selected atlas and name it ("ASEG: RH Putamen").

6. **Logs are written for developers.** Layer UUIDs and two different load durations (Log vs Activity) don't help users.
   - *Suggestion:* "Loaded raw4d_bold.nii (30 frames, 69 ms)". Log removals, template downloads (with size) and Studio loads under their own source.

7. **Inspector density and unfinished panels.** Annotate stub, empty Advanced, read-only "View behavior" rows that look like settings.
   - *Suggestion:* hide unfinished panels behind a "Labs" setting. Render read-only facts as text, not controls.

8. **Population display window.** Auto-window the summary and observation panes from data percentiles. Give them a shared, visible colourbar. Show a brain outline (template edge) for orientation when the maps are cropped tight.

9. **Export legend.** List only labels present in the exported slices, and only for visible atlases. Offer "All regions" as an option.

10. **Small things that add up:**
    - Turn off autocorrect in every search/text field.
    - Add fuzzy matching to ⌘K.
    - Add a checkmark to View › Show Crosshair.
    - Make Compute look disabled when it is.
    - Make Medial with both hemispheres hide or offset the contralateral one, and occlude the cursor marker.
    - Offer a "Reset layout" item.
    - Restore the window size on relaunch.

## 5. Not covered this run
- CLI arguments.
- Stress/endurance (now possible since layers can be removed; recommended next).
- Browser build.
- SSH with a real server.
- Multi-run data.
- Phase-4 surfaces / Vertex 30226.
- Project-volume-to-surface.
- Layout save/restore.
- Mosaic re-check.
