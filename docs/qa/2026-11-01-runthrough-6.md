# Brainflow desktop: run-through 6 (2026-11-01)

**Purpose.** Verify the fixes for run-through 5 (`2026-10-31-runthrough-5-report.md`, N16 and N18–N29), finish the run-5 checks that need a person at the trackpad, and give the new work on main its first native run: the surface Medial fix (#38), remote mounts after the SSH and keychain upgrades (#34), and the experimental segmentation module (#32, #36).

**Time.** About 2 hours: 1 hour for Parts A–D, 1 hour for Parts E–F. ★ marks the highest priority.

**Build under test.** The debug bundle built on 2026-11-02 from `main` at `3e4eb829` (binary Nov 2 17:20 local). That includes the run-5 fixes (#23), the BIDS browser (#24, #33), the dependency and SSH upgrades (#31, #34), segmentation (#32, #36) and the Medial fix (#38):

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
13. **Surface Medial (#38).** Load fsaverage lh and rh in one surface view.
    - Make lh active and press Medial: you see the left medial wall (corpus callosum cut, cingulate), anterior to the right. rh is hidden, and the header reads "Surface · left · inflated".
    - Make rh active: Medial flips to the right medial wall, anterior to the left, and the header says "right".
    - Put the crosshair in lh: the green marker sits on the visible wall. Move it into rh (x > about +5): the marker disappears and never shows through the lh mesh. Clicking the visible mesh still moves the crosshair.
    - Press Lateral: both hemispheres come back, the header says "both", and the camera faces the active hemisphere's lateral side.
    - Under Medial, orbit, then toggle rh's visibility off and on: rh stays hidden and the camera doesn't jump.
    - Export "Surface lateral + medial": four panes, both hemispheres. Afterwards the live view still hides rh.

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

## Part E: remote mounts after the SSH library upgrade (new, #34)

The SSH layer moved from russh 0.55 to 0.65, and saved credentials moved to keyring 3. The automated tests use an in-process server only, so these checks need a real host. Use any SSH server you can reach (a lab server or `localhost` with Remote Login on). Don't use a production cluster you can't afford to lock out.

1. **Password, saved.** In Files, open the remote mount dialog. Set Auth method to Password, tick "Remember password in OS keychain" and "Save connection profile", then connect. The mount lists files. Quit with ⌘Q, relaunch, choose the profile under "Saved profile" and connect: no password prompt. In Keychain Access, search for `brainflow.remote_mount`: there is an item for `user@host:port`. (This checks that keyring 3 writes to the real keychain, not to memory.)
2. **Forget.** Choose the profile and press Remove. The keychain item is gone, and the next connect asks for the password again. Connecting once with the Remember box unticked also removes it.
3. **Encrypted key file.** Auth method "SSH key file", a key with a passphrase in "Key Passphrase (optional)", and "Remember key passphrase in OS keychain" ticked. It connects. After relaunch it connects without asking.
4. **ssh-agent.** Load the key into ssh-agent (`ssh-add -l` lists it) and use Auth method "SSH Agent". It connects. If your agent also holds a certificate, it still connects; on 0.55 a certificate made the whole agent listing fail.
5. **Host keys.** Connect to a host that isn't in `~/.ssh/known_hosts`. You get a host-key challenge, and after you accept it the next connect doesn't ask. Then make a known_hosts entry no longer match (edit the key on that host's line) and connect: the app refuses with a host-key message, not a generic "Failed to connect". If your server uses MFA, also try "Keyboard interactive".
6. **Transfer.** Open a remote NIfTI (several MB). It loads, and cancelling a second large load mid-transfer leaves the app responsive. Leave a mount idle for 10 minutes, then browse it: it still works or reconnects cleanly.

## Part F: segmentation (new, #32 and #36)

Segmentation is experimental and off by default. Turn it on in Settings › Modules first. A 3D T1 is enough for steps 1–14; steps 15–22 need a 4D NIfTI (any BOLD run). Tools: V navigate, B brush, E eraser, C contour.

**Setup and tracing (M1–M2)**
1. Load a T1, open a view tab and switch it to Segment ("Open Segment in a view tab"). Fill in Subject, Session and Rater, keep the default label table, and press Create segmentation. The native slice view and the world-frame context views appear.
2. Paint with the brush (B) on a few slices; change Radius. Erase part of it (E). Draw a closed contour (C): it fills when closed.
3. Lock a label and try to paint over it: locked voxels don't change. Try the paint constraints ("Background only", "Unlocked labels").
4. ⌘Z and ⇧⌘Z step through strokes; the History panel follows. Zoom and pan mid-session; strokes stay exactly where they were drawn.
5. Use the ruler on the native slice and check the per-label counts move as you paint.
6. **Paint latency (physical).** Drag the brush quickly across a slice with the trackpad and, if you have one, a pen. Note any lag between pointer and paint, the way run 5 noted frame rate.
7. Switch the module off in Settings › Modules, then on again: the session is still there ("Resume retained session"). Park the tab and come back: same.
8. Close the workspace with unsaved strokes: "Discard session?" offers Cancel and Discard session. Cancel keeps everything; Discard removes it. ⌘Q with an open session asks the same.

**Save (#36)**
9. Paint, then Inspector › Session › "Save labels as NIfTI…". The dialog suggests `sub-…_ses-…_desc-…_dseg.nii.gz`; painting is blocked while it's open.
10. Save to a new folder. The status reads "Saved revision N to …nii.gz with its label table …tsv" and the state reads "saved"; both files exist. Open the `.nii.gz` over the T1 (in Brainflow, or FSL): it lines up voxel for voxel. The `.tsv` lists every label with a `#rrggbb` colour.
11. Paint again: the state reads "changed since the last save". Save over the same file and confirm the replace prompt: both files are replaced.
12. Type a new name without an extension that matches an existing `.nii.gz`: an error, and nothing changes. Cancel the dialog: nothing changes, no error.
13. **Save to the WD Passport (exFAT).** Save under a new name on the Passport: it succeeds. (The fix for "Operation not supported" on exFAT/SMB is tested on a disk image, not on real hardware.)
14. **High label ids.** At setup, use a label table JSON with ids 1, 2048, 40000 and 65535 in distinct colours. Paint each: each draws in its own colour, in fill and outline. The saved file is uint16. An atlas overlay and the grayscale and colormap layers look unchanged.

**4D source (#36)**
15. Load a 4D NIfTI, set the time slider to t = 4, and open Segment setup. "Reference frame" reads 4 and the preview header says "frame t = 4".
16. Change the frame to 2: the preview updates. Clear the field: Create is refused.
17. Create with frame 2. The Inspector and footer show "reference frame t = 2", and the layer list gains a hidden "Segmentation reference · frame 2" layer with the 4D layer's window.
18. Move the main time slider: the image under the brush doesn't change.
19. Try to remove the 4D layer or the frame layer: both are refused while the session is open.
20. Save: the header is 3D (dim[0] = 3, no TR), `descrip` contains "ref frame 2 (0-based)", and it overlays the 4D volume's grid, including a non-zero origin.
21. Close and choose Discard: the frame layer disappears, and memory and GPU use drop.
22. Repeat with a 3D reference and a 4D secondary: a "Secondary frame" field appears, "Show secondary" shows that frame, and `descrip` contains "sec frame".

## Part D: known open items (confirm, don't re-file)

| Sev | Item |
|---|---|
| M | Layers and the Studio study are not restored across relaunch (never implemented; decision pending) |
| L | Copy view (⇧⌘C) pressed mid-interaction copies a 1× frame |
| L | Under Medial, the surface cursor marker can vanish near the midline when its nearest vertex is on the hidden hemisphere; surfview's own pick "+" isn't hidden with its mesh |
| M | Segmentation sessions are in memory only: no autosave or resume after quitting (milestone M5) |
| M | WebView memory grows about 6 MB per load/remove cycle (F9) |
| L | Deck cards and Compare pane A have no anatomy underneath (F32) |
| L | Last centre tab can't be dragged out of the centre |
| L | GoldenLayout popout windows still show the WebKit context menu |
