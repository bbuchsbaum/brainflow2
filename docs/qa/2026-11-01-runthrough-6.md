# Brainflow desktop: run-through 6 (2026-11-01)

**Purpose.** Verify the fixes for run-through 5 (`2026-10-31-runthrough-5-report.md`, N16 and N18–N29), and finish the run-5 checks that need a person at the trackpad.

**Time.** About 1 hour. ★ marks the highest priority.

**Build under test.** The debug bundle built late on 2026-11-01 from `main` at `2428c14a`. That includes the run-5 fixes (#23), the CI fixes (#25, #26) and the BIDS browser (#24):

```sh
rm -rf /Applications/Brainflow.app
ditto ~/code/brainflow2/target/debug/bundle/macos/Brainflow.app /Applications/Brainflow.app
/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister -f /Applications/Brainflow.app
ls -la /Applications/Brainflow.app/Contents/MacOS/brainflow
open -n /Applications/Brainflow.app
```

Record the binary timestamp at the top of the report. Use local time (EST); run 5's "16:42" was the same build shown in UTC.

**Reporting.** Same form as run 5: **Where / Did-expected-got / Evidence / How often / Severity (H/M/L)**, a scorecard citing N-numbers, and the report in `docs/qa/2026-11-01-runthrough-6-report.md`. Mark checks that need a person as "not run (physical)".

---

## Part A: run-5 fixes ★

1. **N18 (H): re-show while slots are full.**
   - Load 8 visible volumes; the 9th is refused. Hide one; the 9th loads.
   - Turn the hidden one Visible again, **from the layer row and from the Inspector's Visible switch**. Expected: one toast and one Log line "Cannot show X: GPU texture slots full…", and the layer goes back to hidden. No view goes black, even after switching Integrated ↔ Orthogonal.
   - ⌘Z right after the refusal does not spend a step on the refused show.
   - Press 0 (show all) with several hidden layers and the slots full: the ones that fit show; one toast per refused layer at most.
   - The status bar reads "GPU slots full"; the full text is in its tooltip.
2. **N16: colourbar placement.** `p4_zmap` over the T1.
   - Orthogonal at default size: the bar sits in a margin beside the image, clear of the orientation letters and the R | L badge.
   - Widen the side panel to ~410 px and make the dock taller: the bar stays in a margin, never over the brain.
   - Narrow the axial pane to ~140 px: a compact (min/max) bar stays visible somewhere sensible and doesn't jump back and forth as you drag.
   - Integrated: the bar is off the brain.
   - Studio Compare pane A: exactly one bar, off the member's blob, in axial and coronal. Deck bars still show.
   - Mosaic and ⌘4 Compare: bar in the right margin as before.
3. **N20: two atlas outlines.** Glasser (Outline) and ASEG (Outline) together at z = 2: both outlines draw. ASEG "Both" shows fill plus outline. Hide and show Glasser: ASEG's outline stays.
4. **N23: Compare scale.** ⌘4 with `p4_zmap` in A and the T1 in B: same brain size at z = 18. Resize panes and switch between 2, 3 and 4 panes: still the same size. Change B's layer: A still matches.
5. **N21: relaunch.**
   - Scene with layers, then Brainflow › Quit and relaunch: the tabs come back, and the front volume tab shows MNI anatomy (layers themselves are not restored; that's a known gap, see Part D).
   - If the front tab at launch is a tool tab (Studio, BIDS), MNI does not appear later when you first switch to Orthogonal after loading something.
6. **N22: NeuroTabs import dialog.** Studio › Open NeuroTabs manifest: the dialog is above every panel, its footer and Import button are visible with the Inspector and dock open. Type a path and press Return: it refreshes the preview; Return again imports.
7. **N24: dock per tab.** Close the dock in the Studio: Orthogonal's dock stays open. Analysis opens with its dock.
8. **N25: region row menu.** Right-click an Inspector › Regions row: app menu (Go to region, Use as series region, Copy name), no WebKit menu. Right-click blank chrome: no WebKit menu. Text fields still get Cut/Copy/Paste.
9. **N26:** Save Layout opens with the default name selected; typing replaces it.
10. **N27: Close Window.** ⇧⌘W hides the window and the app keeps running (Dock dot stays). Click the Dock icon: it comes back as it was. Red close button: same. With the window hidden, choose File › Open (or ⌘, for Settings) from the menu bar: the window comes back. ⌘Q quits.
11. **N28:** the Studio Deck and Compare pane A crosshair spans the whole pane.
12. **N29:** Orthogonal → Studio: Compare B–D show with anatomy straight away, not maps over black.

## Part B: physical checks carried over from run 5

1. **Zoom (⌥-scroll or pinch).** With `p4_zmap` over the T1, zoom until the image fills the pane: the colourbar moves to the corner with the least data on a faint backing, labels readable; move the crosshair under it and it moves away (B2.2–2.3).
2. **HiDPI (E1.2–E1.4).** One wheel-zoom notch doesn't flash the other views. Views soften while zooming or dragging window/level and are sharp ~200 ms after you stop. ⌘-Tab away mid window/level drag and come back: not stuck soft. Clicks land where you point while zoomed.
3. **Outlines zoomed (B3.1).** Glasser and ASEG outlines zoomed in: diagonals straight, curves round, shared borders single.
4. **N8:** with a mosaic focused, ⇧⌘C then paste into Preview: the composite appears. Repeat on a slice view.
5. **Frame rate:** drag the crosshair quickly with both atlas outlines on; note any stutter.
6. If time allows: the oblique outline check (B3.3), ⌘4 with only a T1, Deck distance-sort "Open in Deck", and the memory measurement.

## Part C: BIDS browser smoke (new on main, #24)

The BIDS browser has never been run natively since #24 was merged with main. Keep this short; it is a smoke test, not a full review.

1. Mount `ds000114` (or another local BIDS dataset) in Files. The coverage view, summary and runs dock fill in; Findings is reachable.
2. Exclude a run, undo, then exclude and revert. The counts move together. `derivatives/brainflow/` is the only thing written.
3. Open a run in the viewer: it opens on its own tab with event bands. Then go back to Orthogonal: the run-5 fixes in Part A still hold (colourbar placement, dock per tab).
4. After Reopen, check whether Files still says "No directory mounted". This is a known limit; confirm it, don't re-file.

## Part D: known open items (confirm, don't re-file)

| Sev | Item |
|---|---|
| M | Layers and the Studio study are not restored across relaunch (never implemented; decision pending) |
| L | Copy view (⇧⌘C) pressed mid-interaction copies a 1× frame |
| M | WebView memory grows about 6 MB per load/remove cycle (F9) |
| M | Medial view with both hemispheres shows the contralateral hemisphere (surfview) |
| L | Deck cards and Compare pane A have no anatomy underneath (F32) |
| L | Last centre tab can't be dragged out of the centre |
| L | GoldenLayout popout windows still show the WebKit context menu |
