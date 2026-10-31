# QA design decisions (2026-10-30)

The QA runs on 2026-10-29 raised five questions that are design decisions rather than bugs. All five recommendations below were approved by the project owner on 2026-10-30. Evidence: `docs/qa/2026-10-29-runthrough-report.md` and `docs/qa/2026-10-29-rerun-report.md` §4.

## 1. Navigation: layout buttons, tabs and tools

- **Layout buttons** (Orthogonal / Integrated / Mosaic / Compare) always change the **current tab's** layout, in place.
  - They never jump to, or create, another tab.
  - This replaces the 2026-10-30 behaviour, which jumped to an existing tab in that mode.
- **Tabs** are views the user created. Ways to create one:
  - New view (⌘T);
  - "Open in new tab";
  - opening a tool.
- **Tools** are Set studio, BIDS and Analysis.
  - Each opens its own tab.
  - Opening a tool again focuses the existing tab.
- **⌘1–⌘4** set the current tab's layout, like the buttons. **⌘5 / ⌘6** open tools.
- **Workspace menu:** keep it for tools and for New view.
  - Read / Explore / Analyze are layout presets. Either drop them, or make each one apply its layout to the current tab.
- **Relaunch restores the tabs the user created**, plus tool tabs, with their layouts. Nothing else is created on launch.

**Implemented 2026-10-30** (`ui2/src/services/workspaceNavigation.ts` is the single entry point for the pills, the shortcuts, the native menu and the `--workspace` startup flag):

- **⌘1–⌘4** are Orthogonal, Integrated, Mosaic and Compare, in pill order. The keys are fixed: ⌘2 does nothing while Integrated's feature flag is off.
- **Orthogonal variants.** ⌘1 and the Orthogonal pill keep the tab's current orthogonal variant. From another layout they return to the variant the tab last used (Panels, ⌘2, ⌘1 gives Panels; QA 2026-10-30 F13), or the locked grid (the mode's default) for a tab that was never orthogonal. View › Layout › Orthogonal Panels (also in the command palette) switches the tab to separate panels. The locked grid's own lock button still links its slices.
- **Tool and surface tabs have no slice layout.** While one is in front the pills are disabled, a "In <tool>" pill says why, and ⌘1–⌘4 do nothing. Only when no tab is open at all does a layout request create the first view.
- **New view** opens in the current view's layout, or in the default layout (Orthogonal panels) when a tool is in front.
- **Menus.** The native View menu has a **Layout** submenu (⌘1–⌘4, Orthogonal Panels) and a **Workspace** submenu (New View ⌘T, Set Studio ⌘5, BIDS ⌘6, Analysis). The in-app Workspace dropdown has New view, the tools, and saved layouts. **Read / Explore / Analyze / Compare were dropped**, not re-pointed: each one duplicated a pill under a different name, and Read and Explore differed only in the orthogonal variant. Their command-palette entries became "Layout: …" commands.
- **Shortcuts are registered once.** In the desktop shell the native menu owns ⌘T and ⌘1–⌘6, so the in-app registrations are skipped there. Otherwise one key press could open two new views.
- **Tab names are stable.** A tab keeps its label while its layout stays the same; a tab that joins a layout another tab already shows takes the next free number ("Orthogonal 2"). One tab's change never renames another (QA 2026-10-30 F27).
- **The centre stack has no stack-level ×.** Tabs close one at a time; closing the last one brings back a default view (QA 2026-10-30 F1).
- **The bottom dock is in every centre tab**, tools and surface tabs included, so ⌘P and the Log work whichever tab is in front (QA 2026-10-30 F31).
- **Saved layouts** restore the panel arrangement, the front tab's layout (applied to the current tab, like a pill) and the bottom dock (QA 2026-10-30 F2).
- **Restore** (`workspaceRestorePolicy.ts`, persist v3) keeps every view tab, one tab per tool, and the active tab. v2 payloads, which still hold the empty duplicate tabs the old pills created, get the old one-view-per-layout prune once during migration, and their retired view presets are cleared. With nothing saved, the layout root creates one default view; it does the same if the user closes the last tab.

## 2. Stacking and opacity for new layers

- **Bands, bottom to top:**
  1. Anatomy.
  2. Other continuous images (functional, mean, 4D).
  3. Statistic maps.
  4. Labels and atlases.

  The band is assigned at load. Within a band, the newest layer goes on top.
- **What goes in which band, by data as well as name:**
  - A true {0, 1} image is a mask and is drawn as labels (band 4), whatever its name (`lesion.nii`).
  - A small-integer image (ids 1–64) is a label map (band 4) only when its name says so (`roi_3`, `_dseg`, `aseg`, an atlas name). Otherwise it is treated as a count or ordinal map (`lesion_overlap_n20`, subject counts): band 3, drawn as values.
- **Field of view within an image band (bands 1–2):** a new image goes *underneath* the image below it when its box has at least 4× that image's volume and contains its centre. Example: a whole-head T1 opened after a small oblique slab. It then is not "on" that image and opens at full opacity. The rule never passes a layer the user moved or a layer of another band. It needs a box with volume, so a single-slice image never triggers it.
- **Sorting happens only at load.** A layer the user has moved by hand is never re-sorted.
- **Opacity:**
  - A continuous image (band 1 or 2) that lands on a visible continuous image in the same band opens at 50 %.
  - A band-2 image (a BOLD run or mean EPI) that lands on visible band-1 anatomy also opens at 50 %. An opaque EPI hides the anatomy it is registered to.
  - A label, atlas or mask layer opens at 25 % over a visible statistic map (as an outline), at 35 % fill over visible images or other labels, and at 100 % alone. An outline-only label's alpha never drops below 70 %, whatever the layer opacity.
  - All other layers keep their current defaults.

## 3. Coordinates and the status bar

- **World coordinates in mm** are the main coordinates everywhere.
- **Voxel ijk always names its grid.** It defaults to the selected layer, for example "ijk 23, 41, 30 (zstat1)". The cluster table and the status bar must agree for the same layer.
- **The status bar has two labelled groups:**
  - **Crosshair:** mm, ijk, value and region, all for the selected layer.
  - **Pointer:** mm, value and region. It is greyed or blank when the pointer is not over an image, and never shows a stale value.

## 4. Unfinished UI

- Annotate and the empty Advanced section are hidden behind a **Settings › Experimental features** switch, off by default. The code is kept.
- **Hover Info…** toggles the status bar's Pointer group.

## 5. Population summaries

- Summaries are drawn over an anatomy image, with near-zero values transparent, like a stat overlay.
  - NeuroTabs manifests have no reference-image field, so the anatomy is the TemplateFlow template for the support's declared space.
  - The template is used only when the declared space matches a known template. For unknown, native or mismatched spaces, the background is dark, never white and never a mismatched template.
- The view opens on the slice with the most signal.
- Summaries that cannot be negative use a sequential colormap: coverage, count, MAD, SD, mean absolute magnitude and cancellation.
  - Cancellation is max(0, mean|x| − |mean|) (`core/field_table/src/population.rs`), so it is never negative.
- Signed summaries (mean, median) keep the diverging colormap with a symmetric range.
