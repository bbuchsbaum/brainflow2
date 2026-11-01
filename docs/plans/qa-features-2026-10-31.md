# Features from run-through 3 (2026-10-31)

These features were asked for in `docs/qa/2026-10-30-runthrough-report.md`. The project owner approved the recommendations below on 2026-10-31. Each one ships with tests, and each still needs a native check in run-through 5.

| # | Feature | From | Owner |
|---|---|---|---|
| 1 | Zoom and pan, plus Fit | F21, B2.5 | viewer |
| 2 | Neurological / radiological display | F22, B2.7 | viewer |
| 3 | Export what I see, including the mosaic | F26, C4 | export |
| 4 | Undo for scene edits | F28, C7 | scene |
| 5 | Distance to the group mean in Set studio | C5 | studio |
| 6 | Compare: pane count and a layer picker per pane | C3 | export |
| 7 | First screen: MNI anatomy and a drop hint | §7 | layout |
| 8 | Clusters on load for statistic maps | C1 | scene |
| 9 | Surface tabs on relaunch: a placeholder tab | F15 | layout |
| 10 | GPU texture budget taken from the backend | review W1 | layout |

## Decisions

1. **Zoom and pan.**
   - Zoom with a trackpad pinch, or ⌥-scroll about the pointer. Plain scroll and ⌘-scroll keep stepping slices.
   - Pan with Space-drag or a middle-button drag.
   - A Fit control in the view toolbar and the context menu, and a shortcut if a free key exists, resets zoom and pan.
   - Zoom and pan belong to each view. They survive slice steps and layer changes. Removing layers refits only when the image would leave the view.
   - The Shortcuts dialog lists all of these.
2. **Radiological convention.**
   - View › Radiological Convention is a persisted setting, off by default.
   - It flips the horizontal display of axial and coronal views only. The orientation labels swap with it, and each pane shows a small "R | L" badge when the setting is on.
   - It is a display transform in the shared `SliceViewport`, so clicks, crosshair and readouts stay correct. Geometry, affines and stored coordinates never change (AGENTS.md coordinate contract).
3. **Export what I see.**
   - Export View defaults to the current tab's layout. From a Mosaic tab it exports the mosaic tiles as shown, with the colourbar and the per-atlas legend.
   - Orthogonal and single-slice exports behave as today.
4. **Undo.**
   - ⌘Z and ⇧⌘Z, plus Edit › Undo/Redo (text fields keep their native undo), cover opacity, visibility, colormap, intensity and threshold, blend/outline mode, layer order and layer removal.
   - A removed layer is restored by reloading its source with its display settings and its position in the stack.
   - Slider drags coalesce into one step.
   - Removing a layer shows a toast "Removed <name> — Undo".
   - History is per workspace, capped at 50 steps, and cleared when the workspace closes.
   - Loads, Studio actions and layout changes are not undoable.
5. **Distance to the group mean.**
   - The Set studio subjects list gains a "Distance to group mean" sort. The distance is the Euclidean distance over the support, with correlation distance shown alongside.
   - The list shows the distance and has an "Open in Deck" action.
   - It is computed in the backend from the members and the cohort mean.
6. **Compare picker.**
   - Compare opens with **2** panes, not one per layer. A pane-count control offers 2, 3 or 4.
   - Each pane header has a layer picker. The anatomy is drawn under every pane.
   - Pane names stay visible at any width: they truncate with a tooltip and never disappear.
7. **First screen.**
   - With no restored session, the default view shows the MNI152NLin2009cAsym T1, with the crosshair at the origin and a quiet "Drop a map here" hint that goes away after the first load.
   - The template comes from the cache or the bundled copy. A first launch with neither starts the download in the background with a status hint, and the hint never blocks.
   - Settings has an off switch.
8. **Clusters on load.**
   - A statistic-band layer computes its clusters at the current threshold when it loads. They recompute, debounced, when the threshold changes.
   - The Inspector shows "Peak z 6.41 at (−40, −20, 50)", and clicking it moves the crosshair there.
   - The manual Compute button stays for other settings.
9. **Surface placeholder.**
   - On relaunch, a surface tab comes back as a placeholder: the surface name, its source and a Reload button.
   - Nothing loads at launch.
   - If the source is gone, the placeholder says so and offers Close.
10. **GPU budget.**
    - The eviction service uses the backend's runtime texture capacity (`resolve_runtime_capacity`), not a hard-coded 16, and counts the Set studio derived maps against it.
    - When the slots run out, a clear message names the cause.
