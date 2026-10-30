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
- **Orthogonal variants.** ⌘1 and the Orthogonal pill keep the tab's current orthogonal variant, and otherwise open the locked grid (the mode's default). View › Layout › Orthogonal Panels (also in the command palette) switches the tab to separate panels. The locked grid's own lock button still links its slices.
- **Tool and surface tabs have no slice layout.** While one is in front the pills are disabled, a "In <tool>" pill says why, and ⌘1–⌘4 do nothing. Only when no tab is open at all does a layout request create the first view.
- **New view** opens in the current view's layout, or in the default layout (Orthogonal panels) when a tool is in front.
- **Menus.** The native View menu has a **Layout** submenu (⌘1–⌘4, Orthogonal Panels) and a **Workspace** submenu (New View ⌘T, Set Studio ⌘5, BIDS ⌘6, Analysis). The in-app Workspace dropdown has New view, the tools, and saved layouts. **Read / Explore / Analyze / Compare were dropped**, not re-pointed: each one duplicated a pill under a different name, and Read and Explore differed only in the orthogonal variant. Their command-palette entries became "Layout: …" commands.
- **Shortcuts are registered once.** In the desktop shell the native menu owns ⌘T and ⌘1–⌘6, so the in-app registrations are skipped there. Otherwise one key press could open two new views.
- **Restore** (`workspaceRestorePolicy.ts`, persist v3) keeps every view tab, one tab per tool, and the active tab. v2 payloads, which still hold the empty duplicate tabs the old pills created, get the old one-view-per-layout prune once during migration, and their retired view presets are cleared. With nothing saved, the layout root creates one default view; it does the same if the user closes the last tab.

## 2. Stacking and opacity for new layers

- **Bands, bottom to top:**
  1. Anatomy.
  2. Other continuous images (functional, mean, 4D).
  3. Statistic maps.
  4. Labels and atlases.

  The band is assigned at load. Within a band, the newest layer goes on top.
- **Sorting happens only at load.** A layer the user has moved by hand is never re-sorted.
- **Opacity:** a continuous image (band 1 or 2) that lands on a visible continuous image in the same band opens at 50 %. All other layers keep their current defaults.

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
