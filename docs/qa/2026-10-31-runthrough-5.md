# Brainflow desktop: run-through 5 (2026-10-31)

**Purpose.**
- Verify the fixes for run-through 4 (`2026-10-31-runthrough-report.md`, N1–N17).
- Check the three design changes:
  - N13: Studio layout.
  - N16: colourbar placement.
  - N17: smooth atlas outlines.
- Re-check the run-4 features the fixes touched.

**Time.** About 1.5 hours. ★ marks the highest priority.

**Build under test.** Install the debug bundle built on 2026-10-31 at 12:42 from branch `qa/fix-wave-3` at `6e38a55f`. This includes the main merge (#18 modules), the Studio plane toggle and HiDPI rendering:

```sh
rm -rf /Applications/Brainflow.app
ditto ~/code/brainflow2/target/debug/bundle/macos/Brainflow.app /Applications/Brainflow.app
/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister -f /Applications/Brainflow.app
ls -la /Applications/Brainflow.app/Contents/MacOS/brainflow
open -n /Applications/Brainflow.app
```

Record the binary timestamp at the top of the report. It must read Oct 31 12:42 or later.

**Reporting.**
- Use the same form as run 4: **Where / Did-expected-got / Evidence / How often / Severity (H/M/L)**.
- Give a scorecard that cites the N- or F-number for each step.
- Write the report to `docs/qa/2026-10-31-runthrough-5-report.md`.
- Keep the Log dock open, but at a modest height (about 150 px).
- Mark checks that need a person as "not run (physical)".

**Typing tip.** In ⌘K, type at normal speed. N14's cause was keys reaching the app before the palette field had focus, and that is now fixed. Please type quickly once on purpose to confirm it.

---

## Part A: high and medium fixes ★

1. **N1:** File › Close Tab (⌘W) closes only the front tab, and the app keeps running. ⇧⌘W closes the window. Close the last tab with ⌘W: the default view returns.
2. **N2:** Load visible volumes until the app refuses one.
   - About 8 load; with some hidden, a hidden one is released and the load succeeds.
   - With all visible, you get one toast and one Log line: "GPU texture slots full (all N in use)…". No raw "Internal { code … }" text.
3. **N3:** Visit the Integrated tab, then go back to Orthogonal. The dock is still there. A relaunched surface placeholder tab has the dock.
4. **N4:** Close every tab, then quit and relaunch. MNI anatomy appears, the crosshair is at the origin, and the "Drop a map here" hint shows.
5. **N5:** Save Layout: typing `qa-run5` shows no autocorrect bubble.
6. **N6:** Drag only the upper threshold handle of `p4_zmap` to 3.93, then press Compute.
   - The panel shows two fields, "z < −3.1 or z > 3.93", and the negative cluster keeps its −3.1 extent.
   - Clear one field and type: the fields don't collapse and focus stays.
   - Drag the lower handle to 0 (band [0, 3.93]). The search is "z > 3.93" only, and the Inspector peak isn't a whole-brain cluster.
7. **N7:** Start loading the 32 MB T1, select another row and press Delete. You get a refusal toast, and nothing is removed.
8. **N8 (physical keypress):** With a mosaic focused, ⇧⌘C, then paste into Preview: the composite appears. Repeat on a slice view.
9. **N9:** In Studio › Population, hover the Mean map and press ↑ ↑. The map's slice steps 2 mm, and the main crosshair doesn't move.
10. **N10:** Studio › Compare.
    - B–D show maps over MNI anatomy, each with a colourbar.
    - The signed maps (residual, z) are diverging. A non-negative mean is sequential.
11. **N11:** Open `lesion.nii` over the T1: a 35 % label fill, not a solid slab. Open it over the z map: an outline at about 25 %. `p4_brain_mask.nii` opens as a label, not greyscale.
12. **N12:** Switch the Population summary to Coverage and back, five times. The anatomy stays every time, and there is never an opaque box.
13. **N14:** Toggle View › Radiological Convention (menu and ⌘K). The crosshair doesn't move, and the orientation letters stay.
14. **N15:** Export an axial slice at z = 2 with ASEG only, and with a colourbar. The legend lists every drawn region, including RH Pallidum and RH Hippocampus, with no "+N more".

## Part B: design changes ★

### B1. N13, Set studio layout (1372×887, Log dock about 150 px)
1. Header and toolbar:
   - The header is one line.
   - Each lens has one toolbar row, with rarely used controls under "⋯ More".
   - Widening Subjects doesn't wrap the toolbar.
2. Population maps fill the column, each at least about 240 px. Deck views are at least 240 px. Compare panes are readable.
3. The column scrolls from its gutter or margins. The wheel over a map still steps the slice.
4. Report the map heights you see, and anything that still feels cramped.

### B2. N16, colourbar placement
1. In Orthogonal Panels with the z map over the T1, the colourbar sits in a margin beside the image, not over the brain.
2. Zoom in (⌥-scroll) until the image fills the pane. The bar moves to the corner with the least data, on a faint backing, and its labels are readable.
3. Move the crosshair into the bar. It jumps to another corner.
4. Narrow a pane below about 160 px. A compact bar (min and max only) remains.
5. Compare panes follow the same rules.

### B3. N17, atlas outlines
1. Atlases › Cortical › Glasser 2016, set to Outline.
   - You get a neutral 1 px mesh, not rainbow colours.
   - Zoomed in, diagonals are straight and curves round, with no stair steps.
   - Shared borders are single lines.
2. ASEG in Outline keeps its region colours with a thin dark halo at normal zoom.
3. On `oblique.nii.gz` (or `labels.nii.gz` on an oblique view), the outlines follow the fill, with no gaps.
4. Hide one ASEG region (if the UI allows). Its neighbour's border is still drawn.
5. Frame rate: drag the crosshair quickly with ASEG outlines on. Note any stutter. (physical)

## Part E: added after the main merge ★

### E1. HiDPI rendering (Retina)
1. At rest, slices are sharp: compare against a screenshot from run 4 if you have one. The crosshair is still a thin, crisp line.
2. While you drag a splitter, resize the window, pan, ⌥-scroll zoom or right-drag window/level, the slices may soften. They are sharp again about 200 ms after you stop.
3. One wheel-zoom notch doesn't flash the other two views.
4. ⌘-Tab away during a window/level drag, then come back. The views aren't stuck soft.
5. Clicks land exactly where you point, normally, zoomed, and with Radiological on. Compare panes, Mosaic tiles and the temporal heatmap are sharp and aligned.
6. If a second display is available **(physical)**, move the window between Retina and 1× displays. The views re-render at the new sharpness.

### E2. Set studio plane toggle and dock
1. In the Deck, one large view shows with an Axial | Coronal | Sagittal toggle in the toolbar.
   - Switch planes. Clicks and the crosshair work on each plane, including with Radiological on.
2. In Compare, all four panes follow the same toggle, and pane A is a single view. At 1372×887 all four are visible without scrolling.
3. Switch the plane and click a B–D pane immediately. The crosshair doesn't jump to a wrong point.
4. A new study (import) resets the plane to axial.
5. The Studio dock opens about 120 px tall. Resizing it in Studio doesn't change the Orthogonal tab's dock height, and the reverse.

### E3. Modules (from main, #18)
1. Settings › Modules: turn Analysis on.
2. View › Workspace lists Analysis after BIDS. Opening it shows its tab with the bottom dock.
3. Turn Analysis off and relaunch. Its tab is parked, not lost, and the first screen does not run.
4. Close Tab (⌘W) and Close Window (⇧⌘W) still work.
5. F (Fit) and L (orientation labels) still work after you visit and leave the Studio.

## Part C: lows and regressions
- Clusters:
  - Right-clicking a cluster row gives Go to peak / Use cluster as region / Copy row, with no WebKit menu.
  - In a 3D-only session, "Use as region" is disabled with a reason.
- **Region readout:** with Glasser and ASEG loaded and the z map selected, Region shows the ASEG label where Glasser has none.
- **Mosaic:** ↑ steps the mosaic's own axis.
- **Status bar** values never use scientific notation.
- **Opening the same file twice** warns "already open; opened another copy".
- **Files search** with no hits shows a notice under the search field.
- **Compare panes:**
  - Pane names stay readable; hover controls replace the slice position, not the name.
  - ⌘4 with only a T1 fills pane A.
- **Context menu:** right-click with an atlas selected offers "Hide colorbar".
- **Shortcuts dialog:** shows "O (letter)".
- **Surface tabs:**
  - The tab order is kept after a relaunch.
  - A reloaded surface takes its placeholder's slot.
  - Reopening one hemisphere by hand leaves an lh+rh placeholder in place.
- **After closing every tab,** the side panels keep their width.
- **The status bar** over a surface tab doesn't say "Studio".
- **Studio:**
  - After leaving the Studio, the main crosshair is unchanged.
  - "Open … in Deck" with the distance sort targets the top row.
  - Deck colourbars share both ends.
- **Memory:** repeat the 20-cycle measurement if time allows.

## Part D: known open items (confirm, don't re-file)

| Sev | Item |
|---|---|
| L | Copy view (⇧⌘C) pressed mid-interaction copies a 1× frame |
| M | WebView memory still grows about 6 MB per load/remove cycle (F9) |
| M | Medial view with both hemispheres shows the contralateral hemisphere (surfview) |
| L | Deck cards and Compare pane A have no anatomy underneath (F32) |
| L | Coverage anatomy loss is mitigated by reuse and retry; the backend read failure is not root-caused |
| L | Outline ring search may cost frame time at about 2 px/voxel with a halo |
| L | Last centre tab can't be dragged out of the centre |
| L | Studio dock height is shared with other tabs (pending decision) |
| L | "base volume" label on the bottom non-atlas row is by design |
