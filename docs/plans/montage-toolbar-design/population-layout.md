# Population lens layout: where everything below the images goes

Status: design proposal, 2026-11-11. Boards in this folder are static and **unrendered**; nothing here has been built or checked in the app.

Recommended: architecture C, revised as **C′** in §10 (boards `Layout-D-1` to `Layout-D-5`, plus `Layout-D-2b-Busy`); the original C boards are `Layout-C-1` to `Layout-C-5`. Runner-up: architecture B, boards `Layout-B-1` and `Layout-B-2`. The earlier designer's architecture A boards (`Layout-A-1` to `Layout-A-5`) are superseded by C, which keeps A's best decisions; they remain in the folder (removal was not permitted from this session) and are not on the canvas.

## 1. What the code says (facts the design depends on)

| Fact | Source |
|---|---|
| Below the Population images today: Statistical question, Spatial relationships, Playback, Select a range, Region (Montage), Summary scale row, Show individual cutouts (Summary), Coverage and source revisions, the explanatory paragraph. | `PopulationLens.tsx` lines ~1495–1782, `PopulationInferenceControls.tsx`, `PopulationRelationshipPanel.tsx`, `PopulationNavigation.tsx`, `PopulationSelectionRange.tsx` |
| **Also below the images, and missing from the brief's list:** the whole "Population values" panel (probe locus, radius, pin, value strip, sign share, near-zero limit, All/None/Focused only/Undo, observation table, pivot, outside-the-context list). | `StudioCenterPane.tsx` renders `<PopulationProbePanel>` after `LensCanvas` |
| The Set studio dock is **open by default at 120 px** (29 px tab bar, so about 91 px of body), minimum 120, maximum 340; open state and height persist per tool. | `bottomWorkbenchDock.constants.ts`: `DOCK_HEIGHT_DEFAULTS['set-studio'] = 120`, `DOCK_OPEN_DEFAULTS` |
| The dock is in the **same React root** as the Set studio centre and already accepts workspace tabs (`extraTabs`). BIDS uses this. A minimised dock is its tab bar; tabs carry no unread badge. `openDockTab()` can reveal a tab. | `WorkspaceRouter.tsx` (`CenterWithBottomDock heightKey="set-studio"`), `BottomWorkbenchDock.tsx`, `openDockTab.ts` |
| The Inspector (`StudioInspectorPanel` → `PopulationInspector`) and the Subjects panel (`DesignPane`) are **separate GoldenLayout roots**. | `StudioInspectorPanel.tsx`, `DesignPane.tsx` |
| There is no "collapse the Inspector to a rail" feature; only a command that focuses it. | `App.tsx` `panel.inspector` |
| State that is component-local today and would have to move to cross a root: probe controller instance (created in `StudioCenterPane`, passed by prop), probe radius / follow hover / near-zero limit / expanded; relationship distance and group count; every Statistical question field (method, covariates, coefficient, units, role, null, independence); playback playing/speed/direction; lens summary/orientation/zoom/cutout width; subject view. | the components above |
| Already shared through singletons or the store: `populationRelationshipService`, `populationProbeActions`, `useSetStudioStore` (selection, partition, reference, pinned probe, presentation). | same |

## 2. Inventory

Frequency is for the flagship workflow in `docs/plans/neurotabs-population-exploration.md` §1. Type: INPUT (sets state), OUTPUT (read), TRANSPORT (moves focus), ACTION (one-shot command). "C home" is the single home in the recommended architecture; **Delete** and **Automate** carry their reason. Duplicates are marked **DUP n** with the row they duplicate.

### 2.1 Toolbar and centre

| # | Control or readout | What it does | Frequency | Type | Depends on | Home today | Flag | C home |
|---|---|---|---|---|---|---|---|---|
| 1 | Lens: Population / Deck / Compare | Switch lens | every session | INPUT | — | Toolbar row 1 | | Toolbar row 1 |
| 2 | View: Summary / Montage / Groups | Switch arrangement | every session | INPUT | partition for Groups | Toolbar row 1 | Groups = Summary with a factor group | Toolbar row 1 as Summary / Montage / Map; Groups becomes Summary with Group set (#18) |
| 3 | Background | Anatomy under the maps | set up once | INPUT | — | Toolbar row 1 | | Toolbar row 1 |
| 4 | About this dataset, Review…, open another saved calculation | Rare set-level commands | rarely | ACTION | — | ⋯ menu | | ⋯ menu |
| 5 | Save calculation: export summary / freeze discovery, recalculate saved summary, cancel, size estimate | Write a calculation record | sometimes, end of session | ACTION | result current | ⋯ menu (details) | | ⋯ menu, "Save calculation…" dialog |
| 6 | Zoom | Magnify the Summary panes | sometimes | INPUT | Summary | ⋯ menu | | Summary toolbar row 2 |
| 7 | −1 mm / +1 mm | Step the slice | every session | ACTION | result | ⋯ menu | DUP 20 | Delete: the slice stepper (#20) does this |
| 8 | Center brain | Move the slice to the volume centre | rarely | ACTION | result | ⋯ menu | | ⋯ menu |
| 9 | Refresh images | Re-request the images | rarely | ACTION | query | ⋯ menu | DUP 75 | ⋯ menu, one "Refresh images" for images and values |
| 10 | Preview exclusion unit | Which unit "preview without" drops (observation, participant, group, set) | sometimes | INPUT | focus, partition, saved sets | ⋯ menu | | Inspector, focused block, select beside #11 |
| 11 | Hold to preview without | Temporary summary without the unit | sometimes | ACTION (held) | focus | ⋯ menu | | Inspector, focused block |
| 12 | Order observations by pinned response | Order by value at the pin | sometimes | ACTION | pin | ⋯ menu | DUP 16 | Delete: Sort "Value at crosshair" |
| 13 | Restore source order | Clear an order | sometimes | ACTION | an order | ⋯ menu | DUP 16 | Delete: Sort "Source order" |
| 14 | Summary statistic / test channel | What the summary pane shows | every session | INPUT | test, comparison | Summary row 2 | DUP 49 | Summary row 2 "Show": statistic; test channels when a test is set; "A and B", "A − B" when B is set |
| 15 | Plane (Summary) | Slice orientation | every session | INPUT | — | Summary row 2 | same state as #20 | Row 2 "Slice", same control in every view |
| 16 | Sort (source, similarity, distance from mean, value at crosshair, design columns) | Order the tiles and the movie | every session | INPUT | fit, pin | Montage row 2 | overlaps #102, #62 | Montage row 2 |
| 17 | Reverse order | Reverse the order | sometimes | INPUT | — | Montage row 2 | | Montage row 2 |
| 18 | Group (none, similarity, factor) | Partition the subjects | every session | INPUT | fit, design | Montage row 2 | DUP 92, 63 | Row 2 "Group", same control in Summary, Montage and Map |
| 19 | Similarity group count | Number of similarity groups | sometimes | INPUT | fit | Montage row 2 | DUP 63 | Row 2, beside Group |
| 20 | Slice plane and position stepper | Choose and step the slice | every session | INPUT / ACTION | result | Montage row 2 | | Row 2 "Slice" |
| 21 | Tile size | Columns in the grid | sometimes | INPUT | — | Montage row 2 | | Montage row 2; under ⋯ when the row has no room |
| 22 | Tile click / ⌘-click / Shift-click / drag | Focus, toggle, range, marquee select | every session | INPUT | — | Grid | | Grid |
| 23 | Group header: Select group, Show group mean, Show all N | Act on one group | sometimes | ACTION | partition | Grid | | Grid (Show group mean opens Summary with that Group) |
| 24 | Selection bar: count, Save as group, Compare with the rest, Open in Deck, Clear | Act on the selection | sometimes | ACTION | selection | Floating over grid | Open in Deck DUP 88; Save DUP 95; Compare DUP 98 | Floating bar: count, Compare with the rest, Save as group… (names inline), Clear. Open in Deck: Delete here, Inspector owns it |
| 25 | Montage footer: description, error + "Use amplitude instead", busy + Cancel, page | Status of the grid | every session | OUTPUT / ACTION | — | Footer | | Footer |
| 26 | Value scale limit(s), Fit | Shared colour scale; summary maximum when it differs | sometimes | INPUT | result | Montage footer; Summary below the panes | two homes by view | Footer, every view; a second limit appears when the summary uses its own scale |
| 27 | Summary status line (orientation, point, previous, updating, anatomy) | What is shown | every session | OUTPUT | result | Below Summary panes | | Footer status |
| 28 | ‹ › around the subject ID in the Summary pane | Step the focused subject | every session | TRANSPORT | — | Summary pane title | DUP 36 | Delete: footer transport |
| 29 | Subject view: Map / Difference from mean | Second Summary pane content | sometimes | INPUT | mean or median | Summary pane title | | Summary pane title; gains "Where it differs from [subject]" (#64) |
| 30 | Colour bars, L/R/A/P labels | Scale and orientation on the image | every session | OUTPUT | result | In the image | | In the image |
| 31 | Comparison caption (A, B, overlap; descriptive) and Show A − B / Expand A and B | Describe and toggle the comparison | sometimes | OUTPUT / INPUT | B | Above the panes | toggle DUP 14 | Toggle: Delete, Show (#14) offers "A and B" / "A − B". Caption: pane titles + footer status |
| 32 | Previous / next groups pager | Page factor-group means | rarely | ACTION | partition | Centre | | Footer pager |
| 33 | Unassigned note | Subjects the fit could not place | rarely | OUTPUT | fit | Centre | | Montage "Not placed" row (exists) + Coverage and sources |
| 34 | "Temporary preview without …" | Preview status | sometimes | OUTPUT | #11 | Centre | | Footer status |
| 35 | "Click either image to pin…" paragraph | Instructions | — | OUTPUT | — | Below Summary | | Delete: say it once in the empty Values tab and as tooltips |

### 2.2 Collapsed sections below the images

| # | Control or readout | What it does | Frequency | Type | Depends on | Home today | Flag | C home |
|---|---|---|---|---|---|---|---|---|
| 36 | Playback: ←, Play/Pause, →, "id · i / N", scrubber | Move the focus through the order | every session (Play sometimes) | TRANSPORT | order | "Playback" section (Montage); inline (Summary) | | Footer transport, every view; scrubber in Summary only (the grid and the map are their own scrubbers) |
| 37 | Playback direction | Forward / reverse | rarely | INPUT | — | Playback | DUP 17 | Delete: playback follows the order on screen; Reverse order (#17) reverses it |
| 38 | Playback speed | 5 or 10 per second | rarely | INPUT | — | Playback | | ⋯ menu "Playback speed" |
| 39 | Order label, buffering | Which order plays; frames not ready | every session | OUTPUT | — | Playback | | Footer status |
| 40 | Select a range: from, to, operation, Apply | Select by position | rarely | INPUT / ACTION | order | "Select a range" details | | Delete: Shift-click a range in the grid or the Subjects list; drag adds with Shift, removes with Alt. Intersect is dropped (owner decision 5) |
| 41 | Region: Tiles show (whole slice / pinned region) | Whole-slice tiles or cutouts | sometimes | INPUT | pin | "Region" section | | Montage row 2 "Tiles" |
| 42 | Region width | Cutout width | sometimes | INPUT | #41 | "Region" section | | Inside the Tiles menu ("Pinned region · [w] mm") |
| 43 | Pin region at crosshair | Pin before showing cutouts | sometimes | ACTION | — | "Region" section | DUP 73 | Automate: choosing Tiles "Pinned region" with nothing pinned pins at the crosshair |
| 44 | Summary individual cutouts: show/hide, width, centre on crosshair, pager, grid, captions | Cutouts under the Summary | sometimes | mixed | pin | Below Summary | DUP 41–43 | Delete: Montage with Tiles "Pinned region" is the cutout view (owner decision 5) |
| 45 | Order by pinned response, Use source order (cutouts) | Order cutouts | sometimes | ACTION | pin | Below Summary | DUP 16 | Delete: Sort |
| 46 | Show 12 response witnesses / Show all observations | Sample tiles across the value range | rarely | ACTION | pin | Below Summary | | Montage Sort option "Value at crosshair, 12 across the range" |
| 47 | Test method | One-sample, Welch, paired, linear model | sometimes | INPUT | A, B | "Statistical question" | | Inspector "Compare and test", Test select |
| 48 | Linear model: covariates, coefficient, coefficient units | Model design | rarely | INPUT | design columns | "Statistical question" | | Inspector "Compare and test", fields under Test when it is a model |
| 49 | Test result channel | Effect, t, p … | sometimes | INPUT | test | "Statistical question" | DUP 14 | Delete: Show (#14) |
| 50 | Feature value role | Effect, SE, t, z … | set up once | INPUT | feature | "Statistical question" | | Inspector "Analysis setup", About the values |
| 51 | Units | Value units | set up once | INPUT | feature | "Statistical question" | | Inspector "Analysis setup", About the values |
| 52 | Null effect | Tested value | set up once | INPUT | — | "Statistical question" | | Inspector "Analysis setup", About the values |
| 53 | "I declare … independent participants" | Required declaration | set up once | INPUT | — | "Statistical question" | | Inspector "Analysis setup", About the values |
| 54 | Apply test | Run the test | sometimes | ACTION | 47, 50–53 | "Statistical question" | | Automate: choosing a test applies it once its declarations are complete; the Test select says what is missing and links to Analysis setup |
| 55 | Return to descriptive view | Drop the test | sometimes | ACTION | test | "Statistical question" | | Delete: Test "Difference of means (descriptive)" |
| 56 | Method description, operands, limitations text | Explain the test | sometimes | OUTPUT | test | "Statistical question" | | Inspector "Compare and test": one line under Test; full text as its help |
| 57 | Relationship summary: placed count, out of date | Fit state | sometimes | OUTPUT | fit | "Spatial relationships" | | Footer status (Map view) and Coverage and sources |
| 58 | Distance: effect / pattern shape | Similarity measure | set up once | INPUT | — | "Spatial relationships" | DUP: measure also in Sort and Group options | Inspector "Analysis setup", Similarity (owner decision 4); Sort and Group just say "Similarity" |
| 59 | Fit on current support | Compute the fit | sometimes | ACTION | — | "Spatial relationships" | | Automate: Sort, Group or Map by similarity requests the fit |
| 60 | Compare maps in pinned region | Fit within the pin | rarely | ACTION | pin | "Spatial relationships" | | Inspector "Analysis setup", Similarity within: whole brain / mask / pinned region |
| 61 | Cancel fit | Stop the fit | sometimes | ACTION | fit running | "Spatial relationships" | DUP 25 | Footer busy line, Cancel |
| 62 | Order movie by MDS axis 1 | Order by the fit | sometimes | ACTION | fit | "Spatial relationships" | DUP 16 | Delete: Sort "Similarity" |
| 63 | Groups + Create similarity groups | Cut the tree | sometimes | INPUT / ACTION | fit | "Spatial relationships" | DUP 18, 19 | Delete: Group "Similarity" + count |
| 64 | Explain in the brain: pair difference, reconstruction, components, orientation, slice | Where two maps differ | rarely | mixed | fit | "Spatial relationships" | own slice controls DUP 20 | Summary second pane, "Where it differs from [subject]" / "Reconstruction"; uses row 2 Slice. Reached from #66 |
| 65 | Fit line: fit ID, common voxels, coverage loss, 2D variation kept, stress, neighbours kept | Fit quality | sometimes | OUTPUT | fit | "Spatial relationships" | | Footer status in Map view: placed count, variation kept, neighbours kept. The rest: Coverage and sources |
| 66 | Stale notice and refit | Inputs changed since the fit | sometimes | OUTPUT / ACTION | fit | "Spatial relationships" | | Footer status with a "Refit" action |
| 67 | MDS scatter, lasso, legend, hover preview, arrow keys | See and select by similarity | sometimes | OUTPUT / INPUT | fit | "Spatial relationships" | | Map view (centre), square, one scale on both axes |
| 68 | Nearest to the focused subject, with pair "Compare" | Neighbours of the focused subject | sometimes | OUTPUT / ACTION | focus, fit | "Spatial relationships" | "Compare" collides with the lens and the comparison | Inspector focused block "Nearest subjects"; the action is renamed "Where they differ" (#64) |
| 69 | Nearest the selection centre | Who typifies the selection | sometimes | OUTPUT | selection, fit | "Spatial relationships" | | Inspector selection block |
| 70 | Unassigned table | Why subjects were not placed | rarely | OUTPUT | fit | "Spatial relationships" | | Inspector "Coverage and sources" |
| 71 | Method footnotes | Linkage, exploratory status | — | OUTPUT | fit | "Spatial relationships" | | Delete: help text on the Map view legend |
| 72 | Coverage and source revisions: counts + SHA-256 table | Provenance | rarely | OUTPUT | result | details below | | Inspector "Coverage and sources" |

### 2.3 Population values panel (also below the images)

| # | Control or readout | What it does | Frequency | Type | Depends on | Home today | Flag | C home |
|---|---|---|---|---|---|---|---|---|
| 73 | Pin crosshair / Pin preview | Freeze the probe | sometimes | ACTION | — | Values panel | | Click the image in Summary; in Montage and Map, "Pin crosshair" in the Values tab (its empty state) |
| 74 | Unpin | Release the probe | sometimes | ACTION | pin | Values panel | | Values tab header |
| 75 | Refresh | Re-sample | rarely | ACTION | — | Values panel | DUP 9 | Delete: ⋯ "Refresh images" |
| 76 | Probe status ("(x, y, z) mm · sphere · pinned") | Where values come from | sometimes | OUTPUT | probe | Values panel | DUP 99 | Values tab header |
| 77 | Probe locus: point / region / cluster | Kind of probe | sometimes | INPUT | atlas, clusters | Values panel | | Values tab header "At" |
| 78 | Radius | Sphere radius | sometimes | INPUT | point | Values panel | | Values tab header |
| 79 | Region select, Load atlas, Open Clusters (locus issue) | Recover a missing locus | rarely | INPUT / ACTION | — | Values panel | | Values tab header, inline when needed |
| 80 | Preview hover | Probe follows the pointer | sometimes | INPUT | — | Values panel | | Values tab header "Follow hover" |
| 81 | Show / Hide values | Collapse the panel | sometimes | INPUT | — | Values panel | | Delete: minimise the dock |
| 82 | "N selected / M observations" | Counts | — | OUTPUT | — | Values panel | DUP 87 | Delete: Inspector |
| 83 | Arrangement note ("order fitted at an earlier probe") | Order provenance | sometimes | OUTPUT | order | Values panel | | Footer status |
| 84 | Compose in Plot | Send to the Plot tab | sometimes | ACTION | values | Values panel | | Values tab header |
| 85 | Value strip: click to focus, Shift to select, brush | Every subject's value at the probe | sometimes | OUTPUT / INPUT | probe | Values panel | | Values dock tab, Strip |
| 86 | Selected mean, finite and unavailable counts | Summary of the strip | sometimes | OUTPUT | probe | Values panel | | Values tab, beside the strip |
| 87 | All / None / Focused only / Undo selection | Selection commands | sometimes | ACTION | — | Values panel | All DUP 24 (Clear) | All: selection bar Clear. None: Delete (an empty selection means everyone in the montage already). Focused only: Delete (⌘-click the focused tile). Undo: Edit › Undo selection, ⌘Z |
| 88 | Sign share, near-zero limit, mean absolute response, cancellation | Distribution at the probe | sometimes | OUTPUT / INPUT | probe | Values panel | | Values tab, beside the strip; near-zero limit is the one input there |
| 89 | Participant-mode, sphere and hint notes | Explain the numbers | — | OUTPUT | — | Values panel | | Delete: prose; the same text becomes tooltips on the numbers |
| 90 | Observation values and source status table | Every value, select boxes, focus links | rarely | OUTPUT / INPUT | probe | Values panel | | Values tab, Table (the non-visual equivalent of the strip) |
| 91 | Group matrix (pivot) | Means by two factors | rarely | OUTPUT | two-factor partition | Values panel | | Values tab, Table, when grouped by two factors |
| 92 | Outside the context table | Excluded subjects and why | rarely | OUTPUT | — | Values panel | | Inspector "Coverage and sources" |

### 2.4 Inspector (Population) and Subjects panel

| # | Control or readout | What it does | Frequency | Type | Depends on | Home today | Flag | C home |
|---|---|---|---|---|---|---|---|---|
| 93 | "N selected / M available" | Selection size | every session | OUTPUT | — | Inspector | | Inspector: block title (focused or selection) |
| 94 | Focused observation, frame | Who is focused | every session | OUTPUT | focus | Inspector | | Inspector focused block, with Open in Deck (moved from #24) |
| 95 | Participant identity | Which rows are one person | set up once | INPUT | design | Inspector | | Inspector "Analysis setup" |
| 96 | Analysis unit | Observations or participants | set up once | INPUT | #95 | Inspector | | Inspector "Analysis setup" |
| 97 | Mask: choose, change, clear | Restrict voxels | set up once | INPUT | — | Inspector | | Inspector "Analysis setup" |
| 98 | Group context by factor, Split each group by, Show factor groups | Factor partition | sometimes | INPUT / ACTION | design | Inspector | DUP 18 | Delete here: row 2 Group; its menu ends with "Two factors…" for the split; choosing applies (Automate) |
| 99 | Spatial probe readout | Where the pin is | sometimes | OUTPUT | pin | Inspector | DUP 76 | Delete: Values tab header |
| 100 | Choose comparison groups (A, B from groups) | Operands from a partition | sometimes | INPUT | partition | Inspector | | Inspector "Compare and test": A and B selects list groups, saved groups, the selection, the rest |
| 101 | Undo grouping | Restore the previous partition | rarely | ACTION | history | Inspector | | Edit › Undo, ⌘Z (same history) |
| 102 | Name the working selection, Save selection as set | Freeze the selection | sometimes | INPUT / ACTION | selection | Inspector | DUP 24 | Delete here: selection bar "Save as group…" |
| 103 | Reference B and its counts / overlap | Second operand | sometimes | INPUT / OUTPUT | — | Inspector | | Inspector "Compare and test", B |
| 104 | Pin reference membership | Freeze a live complement | rarely | ACTION | B = rest | Inspector | | Inspector "Compare and test", "Freeze B" |
| 105 | Compare A and B | Show the comparison | sometimes | ACTION | A, B | Inspector | DUP 24 | Delete here: Summary Show "A and B" (#14) is the display control; the selection bar keeps its shortcut (rule 2) |
| 106 | Saved calculation, verified inputs | Provenance of an opened record | rarely | OUTPUT | saved | Inspector | | Inspector "Coverage and sources" |
| 107 | Footnote paragraph | Explains selection vs focus | — | OUTPUT | — | Inspector | | Delete: repeats rule 4; say it in the empty selection state |
| 108 | Subjects Sort, direction, distance-to-mean status, Open in Deck | Order the Subjects list | sometimes | INPUT | — | Subjects panel | second order state, DUP 16; Open in Deck DUP 94 | In the Population lens the list follows #16 and its Sort is hidden (owner decision 3); elsewhere unchanged |
| 109 | Subjects › Groups: Compare, Scope, Rename, Delete | Manage saved groups | sometimes | ACTION | — | Subjects panel | Compare writes the same B as #103 | Subjects panel; "Compare" is renamed "Use as B" and is a point-of-use command (rule 2) |
| 110 | Search, filters | Set the context | sometimes | INPUT | — | Subjects panel | | Subjects panel |

## 3. Placement rules

1. **Images own the centre.** Below the images there is one footer line (transport, status, scale) and nothing else; a readout that is itself a picture of the subjects becomes a view of the centre, not a panel beside or below it.
2. **One editable home per input.** A command may also sit at its point of use only when it writes the same state and the canonical home visibly shows the result.
3. **A readout takes the shape of its data.** One value per subject is wide and short, so it goes in the dock; a 2D embedding needs a square with one scale on both axes, so it gets the centre; facts about one subject or one selection go in the Inspector.
4. **The Inspector answers "what am I looking at":** the focused subject, or the selection when there is one, then the comparison being defined; settings made once per dataset sit in one collapsed Analysis setup.
5. **Rare commands go in the one ⋯ menu,** and nothing used every session hides there.
6. **Automate a step the user's choice already implies:** choosing Sort or Group by similarity fits; choosing a test applies it; choosing pinned-region tiles pins at the crosshair.
7. **No result appears only in a hidden place:** an explicit action that produces a result reveals where it appeared, and the footer names it.

## 4. Three architectures

Rows not listed in a placement table are identical in all three: toolbar rows 1–2 (#1–#3, #6, #14–#21), grid and group headers (#22, #23), footer transport and scale (#25–#28, #36, #39), ⋯ menu (#4, #5, #8, #9, #38).

### A. Results in the dock (the earlier designer's recommendation, as drawn)

| Control | A home |
|---|---|
| Similarity scatter, fit line, nearest lists, Explain (#57–#71) | New dock tab "Similarity" |
| Values strip, probe definition, sign share (#73–#91) | New dock tab "Values" |
| Focused subject, Open in Deck, Hold to preview (#10, #11, #94) | Inspector |
| Comparison operands and test (#47–#49, #100–#105) | Inspector "Compare" |
| Unit, participant identity, mask (#95–#97) | Inspector "Analysis setup" |
| Coverage, provenance (#70, #72, #92, #106) | Inspector "Coverage and sources" |

Moments. Opened: nothing below the images but footer and dock tab bar. Similarity: Sort and Group by similarity in the toolbar; the scatter and neighbours in the Similarity tab. Selection: floating bar, Inspector shows the selection and Compare. Costs: one tab click to see the fit; the dock must be dragged from 120 to about 250 px to show the scatter, costing about 1.5 tile rows on a 900 px screen; six dock tabs plus module tabs; implementation in the centre's own React root (cheap), but the probe controller must still become a service.

### B. Inspector holds the results (runner-up, boards B-1, B-2)

| Control | B home |
|---|---|
| Similarity scatter, fit line, nearest lists (#57–#71) | Inspector section "Similarity map" |
| Values strip and probe (#73–#91) | Inspector section "Values at the pinned point" |
| Focused subject, Compare, Analysis setup, Coverage | Inspector sections, as in A |
| Dock | Unchanged: Plot, Clusters, Activity, Log |

Moments. Opened: centre is images, toolbar, footer only; Inspector shows the focused subject and six collapsed sections. Similarity: open the Similarity map section; scatter at about 326 px wide. Selection: the Compare section. Costs: zero vertical cost; one section click per result; every result crosses a GoldenLayout root, so the probe controller, scatter hover preview (`sliceService` prop), relationship form state and inference draft all move into stores or services; the Inspector becomes a long scroll.

### C. Each readout in the shape of its data (recommended, boards C-1 to C-5)

The C home column of §2 is the full placement. In short:

| Where | What |
|---|---|
| Toolbar row 1 | Lens, view Summary / Montage / **Map**, Background, ⋯ |
| Toolbar row 2 | Summary: Show, Group, Slice, Zoom. Montage: Sort, Reverse, Group (+ count), Slice, **Tiles**, tile size. Map: Group (+ count), Slice |
| Centre | Summary panes, Montage grid, or the **Map view** (square similarity map, lasso, hover preview) |
| Floating | Selection bar: Compare with the rest, Save as group…, Clear |
| Footer (one line) | Transport, position, scrubber (Summary), status incl. fit quality and busy/cancel, scale |
| Dock | New tab **Values** (probe header, strip or table, sign share); starts minimised; an explicit pin opens it |
| Inspector | Focused subject (facts, Open in Deck, Hold to preview, nearest subjects) or selection (members, mean at crosshair, nearest the centre); **Compare and test**; **Analysis setup** (unit, identity, mask, about the values, similarity measure and region); **Coverage and sources** |
| ⋯ menu | Save calculation…, open another, centre the brain, refresh images, playback speed, about this dataset, review |

Moments. **Just opened (C-1):** toolbar, grid, one footer line, a minimised dock tab bar; the Inspector shows the focused subject; nothing below the images. **Similarity (C-2):** Sort or Group "Similarity" fits automatically and reorders or groups the grid; Map shows the same subjects as a square, with fit quality in the footer and the focused subject's nearest neighbours in the Inspector, each with "Where they differ". **Selection made (C-3):** drag in the grid or lasso on the map; the bar offers Compare with the rest; the Inspector shows the selection, who sits at its centre, and Compare and test with A, B and the test choice. **Summary with a pin (C-4):** clicking the image pins; the dock opens to Values at its default 120 px. **13-inch with Files open (C-5):** centre 508 px, labels drop from row 2, Tiles and tile size overflow to ⋯, three tiles per group row.

Costs. Clicks: similarity result 1 (Sort or Group) or 2 with the map (plus Map); compare 2 (select, Compare with the rest); test 1 more (Test select). Discoverability: Map is a visible segment; Values announces itself on the first pin. Width: none added. Implementation: Map lives in `LensCanvas` (same tree as the montage); Values is an `extraTabs` entry in the same root; Inspector additions read existing singletons (`populationRelationshipService`) and need inference draft and similarity definition in the store.

## 5. Adversarial critique

### 5.1 Testing A's premise (the dock is there and tall enough when needed)

- Is the dock open by default in the Set studio? **Yes, at 120 px** (about 91 px of body). A-2 and A-3 draw it at 248 px; a user must drag it to that height, and its height then persists for the whole tool, taking about 1.5 rows of tiles in every Set studio session.
- A 2D MDS map in a 300 × 148 box (A-2) is drawn at an unequal aspect, so horizontal distances look about twice vertical ones. MDS distances are Euclidean in both axes; squashing them misrepresents which subjects are close. This is an accuracy problem, not a style one. At 91 px the map is unusable.
- When the dock is minimised (or closed) and the fit finishes, nothing says so: dock tabs have no badge, and the A boards add none. When the Similarity tab is not the selected tab, the same holds. A violates rule 7 unless it opens the tab, which steals height on every fit.
- Six dock tabs plus module tabs, two of them Population-only, in a dock shared with Plot: "Values" beside "Plot" invites the question of which plot is which.

### 5.2 Testing B's premise (the Inspector can hold it all at about 340 px)

Rough heights in B-2: header 36, focused block about 230, Similarity map section about 360 (head, controls, 220 px scatter, fit line, three neighbours), Values section about 200 when open, Compare about 180 when open, two collapsed rows 64. With two sections open that is about 1,000–1,100 px in an 864 px column at 900 px screen height, so it scrolls, and opening Values pushes the scatter or the focused facts out of view. The Inspector also stops following selection: most of it is about the population, not the focused subject or the selection. The value strip is one-dimensional and wants width; at 326 px its 35 dots overlap.

### 5.3 Four seats

| Seat | A | B | C |
|---|---|---|---|
| Scientist, 13-inch, Files open, flagship workflow | Centre 508 px wide; the dock at 250 px leaves about 300 px for tiles: two rows. Ordering then reading the map means dragging the dock up and down. | Centre keeps its height; the Inspector scrolls; the scatter is the right shape but competes with Compare for the same column. | Centre keeps its height; the map takes the whole centre when wanted and gives it back on one click; Values costs 88 px only after a pin. Weak point: at 508 px the Montage row overflows Tiles and tile size into ⋯. |
| Keyboard and screen reader | Dock tabs are reachable, but a result arriving in an unselected tab is silent; needs a live region. | Everything in one tab stop order; long; sections need landmarks. | View switch and Values tab are ordinary controls; the scatter keeps its arrow-key traversal; the Values Table and the Inspector nearest lists are the non-visual equivalents. The footer status is a live region, so fit completion and "values in the dock" are announced. |
| First-time user | "Similarity" and "Values" tabs are visible but empty until something is computed. | Collapsed sections with summaries ("not computed") are visible but feel like settings. | "Map" is a visible, named view; the first pin opens Values once. Risk: a third view to learn (objection 1). |
| Engineer, one source of truth across roots | Results stay in the centre's root; Inspector only needs the inference draft. Lowest cost. | Highest cost: probe controller, scatter preview, relationship form state, inference draft all cross into the Inspector root. | Medium: Map and Values stay in the centre's root; the Inspector reads existing singletons and two new store slices (inference draft, similarity definition). |

### 5.4 Board audit (all seven earlier boards)

| Issue | Boards | Fix |
|---|---|---|
| Invented number "z −8.5 mm" | all seven | `z [value] mm` |
| Invented point "(−42, −58, −8) mm" and radius "4 mm" | A-4 | `([x], [y], [z]) mm`, `[r] mm` (C-4) |
| Two homes: "Compare with the rest" (selection bar) and a "Compare" button (Inspector) | A-3 | Inspector button removed; Summary Show "A and B" is the display control (C-3) |
| Two homes: "Open in Deck" in the selection bar and the Inspector | A-3, A-5 | Bar copy removed (C-3, C-5) |
| "Compare" on neighbour rows collides with the Compare lens and the comparison | A-2, B-2 | "Where they differ" (C-2, B-2) |
| Two homes: Playback section in the Inspector and the footer transport | B-1, B-2 | Inspector section removed |
| A capability the app does not have: Inspector collapsed to a 36 px rail | A-5 | C-5 draws the real Inspector at full width |
| Similarity map not square | A-2 (300 × 148), A-3, A-5, B-2 (326 × 220) | C-2: 560 × 560, one scale on both axes |
| Dock drawn at 248 px; app default is 120 px | A-2, A-3, A-4, A-5 | C: minimised until a pin, Values fits 88 px of body |
| Capabilities with no home: Region tiles, test channel and value declarations, playback speed, two-factor grouping, Values table, near-zero limit, follow hover, unassigned list | A boards | All placed (§2) and drawn where they show (C-2, C-4) |
| ⋯ menu promised "select a range" (deleted capability) | A, B boards | Label lists the real menu |
| Selection bar radius 4 px | A-3, A-5 | 2 px |
| Colour | all | Only the colour-scale gradient uses raw hex; it is data. Amber appears only as 2 px selected edges and the selected-tab underline. No title case found. |

## 6. Recommendation: C

1. It is the only one of the three that leaves nothing below the images and adds no vertical cost before the user asks for a result.
2. It gives each result the shape its data needs: a square for the similarity map (A distorts it), a wide strip for values (B crowds it).
3. The Inspector keeps answering one question (this subject, this selection, this comparison) instead of becoming the population's scrolling report.
4. It deletes 27 items (23 inventory rows outright, four more inside rows 24, 31 and 87; four of the 27 are explanatory prose) and automates four steps: the similarity fit, applying a test, pinning for pinned-region tiles, and applying a factor grouping.
5. It is cheaper across React roots than B: the two big result views stay in the centre's root.

Two strongest remaining objections:

1. **A third view.** The flagship plan warns against many mutually exclusive modes, and lassoing on the Map then seeing those tiles needs a switch back to Montage. Selection survives the switch and the hover preview shows each map, but on a laptop the map and the tiles are never side by side. A split (Montage beside Map) is possible later on a wide centre (about 1,300 px and up), not now.
2. **Values depends on the dock.** At 120 px it holds the strip and six numbers; the table, the pivot and a dense strip need the dock dragged taller or Compose in Plot. Opening the dock on the first pin shifts the images up by 88 px, a layout jump the user did not request in so many words.

## 7. Owner decisions (with defaults)

1. **Map as a third Population view** instead of a similarity panel in the dock or the Inspector. Default: yes.
2. **Set studio dock starts minimised;** an explicit pin opens the Values tab at the default height, once per session. Default: yes.
3. **One subject order:** in the Population lens the Subjects list follows the lens order and hides its own Sort. Default: yes.
4. **Similarity measure and region live once, in Analysis setup;** Sort and Group offer just "Similarity". Default: yes. (This conflicts with the measure-in-the-menu work in progress; agree it before both land.)
5. **Delete** the Summary individual cutouts and the "Select a range" form (Montage with pinned-region tiles and Shift-click ranges replace them; Intersect is dropped). Default: yes.

## 8. Implementation outline

Order of work (each step independently shippable and testable):

1. **Delete duplicates (no new UI).** ⋯: ±1 mm, Order by pinned response, Restore source order. Inspector: Group context by factor / Split / Show factor groups, Name the working selection / Save selection as set, Compare A and B, Spatial probe, footnote. Relationships: Order movie by MDS axis 1, Groups + Create similarity groups. Statistical question: Channel. Values: Show/Hide, Refresh, counts. Selection bar: Open in Deck. Playback: direction. Summary pane ‹ ›. Update tests that query these labels.
2. **State moves.** The probe controller becomes a service singleton (it is created in `StudioCenterPane` today) so the dock tab and the lens share it. New store slices: `population.inferenceDraft` (method, covariates, coefficient, units, role, null, independence) and `population.similarity` (measure, region), read by `useMontageArrangement`, `populationRelationshipService` and the Inspector. Playback (playing, speed) to a small service shared by the footer, the ⋯ speed item and keyboard. Subject view (map / difference / pair) to presentation state, so the Inspector's "Where they differ" can set it.
3. **One footer for every view.** `MontageFooter` becomes the Population footer: `PopulationNavigation` transport, Summary status and scale rows move into it; busy, cancel, refit and fit quality are its status.
4. **Map view.** `presentation.arrangement = 'map'`; reuse `PopulationRelationshipScatter`, `PopulationBrush` (lasso) and `PopulationScatterPeek` full size with an equal-aspect viewport; legend at the side.
5. **Values dock tab.** Pass `extraTabs` for `set-studio` in `WorkspaceRouter`; split `PopulationProbePanel` into header, strip, table (with pivot and outside-context moved per §2); `openDockTab` on an explicit pin; set-studio dock default minimised.
6. **Inspector.** Rebuild `PopulationInspector`: focused or selection block (reuse `RelationshipNeighbourTable`, `RelationshipCentroidList`), Compare and test (reference part of `PopulationGroupControls` + inference fields), Analysis setup (`PopulationUnitControls`, `PopulationMaskControls`, about the values, similarity), Coverage and sources (coverage table, saved calculation, unassigned, outside the context, fit details).
7. **Toolbar.** Tiles control, Group "Two factors…", Show offering test channels and A / B; drop the Groups segment; Map segment.

Can be deleted after step 7: `PopulationSelectionRange`, `PopulationCutoutGrid` (if no other user), the `PopulationRelationshipPanel` and `PopulationInferenceControls` containers (their parts are reused), the Playback and Region `Section`s and the coverage `<details>` in `PopulationLens`.

## 9. Mechanical check

A script parsed the four tables of §2 and checked that row numbers run 1–110 without gaps, that every row has nine cells, that every C home cell is non-empty, and that every Delete or Automate entry carries a reason after a colon.

Result: 110 of 110 rows pass. The first run found two Delete entries without a reason (#89, #107); both now have one. Three rows (#24, #31, #87) bundle several controls; each control in them is named once, with one home or a Delete. 23 rows are Delete and 3 are Automate outright; #98 deletes the Inspector copy and automates "Show factor groups".

Whether any control still has two editable homes is a judgement, not something the script can see. By reading every C home against rule 2: no input has two editable homes. Two commands deliberately keep a point-of-use copy under rule 2: "Compare with the rest" in the selection bar (canonical display: Summary Show "A and B") and "Use as B" in the Subjects panel's saved groups (canonical input: Compare and test, B). Responsive overflow (Tiles and tile size moving under ⋯ when row 2 has no room, as the lens already does for the view switch) moves one control; it does not add a second one.

## 10. Revision C′ (after independent critique)

Status: design revision, 2026-11-11. Boards `Layout-D-1` to `Layout-D-5` (plus `Layout-D-2b-Busy`) on the canvas row titled "Population layout: revised recommendation (C′)". They are static and **unrendered**; nothing here was run or checked in the app. C′ keeps C's structure (each readout in the shape of its data, one footer, Inspector answers "what am I looking at") and applies the nine changes the critique asked for and the lead accepted. Where C′ differs from §2–§9, this section wins.

### 10.1 The nine changes and why

1. **No third view; a similarity strip beside the montage.** Population views stay Summary | Montage. When Sort or Group is a similarity option, a strip opens to the right of the grid, inside the centre pane (the `LensCanvas` React root): width min(320 px, 40 % of the centre); a square MDS map with one scale on both axes (a scale bar marks one `[value]` unit, valid on either axis); a legend whose classes are the group headers' classes, drawn with the same achromatic shapes (circle, square, triangle; hollow diamond for **Outliers**, the singletons that Ward linkage leaves unjoined); a fit-quality line (silhouette, stress, variation kept, all `[value]`); "Suggested: [value] groups · showing 3", where 3 is the group-count stepper's current value; lasso selects the tiles; hovering a point outlines its tile and hovering a tile rings its point; a collapse control turns the strip into a 24 px rail that re-opens it. Below about 720 px of centre width the strip is a sheet over the grid's right edge (the grid keeps its columns; nothing reflows). Busy ("Computing similarity for 35 subjects…", Cancel, map dimmed) and refused ("Correlation is undefined for a constant map", "Use amplitude instead") are drawn in D-2b. Nearest subjects and "Where they differ" stay in the Inspector. *Why:* C's objection 1 (map and tiles never side by side on a laptop; a third mode to learn) is removed, and the square stays square.
2. **The similarity measure stays in the montage toolbar.** Sort and Group menus offer "Similarity · correlation" and "Similarity · amplitude"; the closed select reads "Similarity · corr" or "Similarity · amp" (full name in the tooltip and accessible name). The group-count stepper sits beside Group. Analysis setup shows the measure **read-only** beside the region choice ("Compare within: whole volume / mask / pinned region"), which is edited there. **One source of truth:** the montage's single `measure` state (today in `useMontageArrangement`, which already fits once and reuses that fit for both Sort and Group) moves to the store; Sort, Group and the read-only Inspector row all read it, and picking a measure in either menu changes it for both. *Why:* this is built and approved; C's owner decision 4 is withdrawn.
3. **No automatic tests.** Compare and test keeps an explicit **Run**; choosing a test does not run it. A selection that came from the map lasso or a similarity group is labelled **Exploratory selection** wherever A is named (the A row in Compare and test, the footer status, Summary pane titles and Show when A is displayed, saved calculations), with the hover reason "Chosen from the data; p-values are not valid for confirming it." *Why:* testing a group the data chose is circular; an automatic run would print a p-value nobody asked for.
4. **The dock stays open at 120 px** (its Set studio default), with **Values** as its first tab and an in-place empty state: "Pin a point on a map to see every subject's value there", plus "Pin crosshair". Drawn at 120 px: 29 px tab bar, 91 px body. *Why:* no minimised dock means no layout jump on the first pin (C's objection 2) and no hidden result.
5. **Summary keeps the per-subject cutouts,** one strip below the panes with the **group mean as the first tile**, in the lens order, paged. A "Cutouts" toggle in Summary row 2 shows or hides it. The range-selection form is dropped (Intersect is lost; accepted). Pane titles: left "Group mean · 35 subjects"; right the subject ID in mono with ‹ › and a "Map | Difference from mean" toggle. *Why:* the cutouts answer "who contributes" at a glance, beside the summary they explain.
6. **No deletion of undo or selection commands without a replacement.** Select all, Focused only, Clear and Undo selection live in **one home: the Inspector's selection section**, which is always present (a one-line "Selection · none · Select all" row when nothing is selected, the full block when something is). The floating bar keeps its Clear (close) button as a rule-2 point-of-use copy; the Inspector shows the result. Undo grouping becomes "Restore previous grouping" at the end of the Group menu. Nothing maps to Edit › Undo: **Studio has no undo yet**, and these two commands use the existing local histories. *Why:* C deleted commands whose replacements did not exist.
7. **Board fixes.** "pattern shape" → "correlation" everywhere; C-5's adjacent selects carry an in-control prefix ("Sort", "Group") when their outside labels drop; the selected tab uses the neutral treatment from `ui/bf/states.ts` (`--bf-bg-active` fill, 2 px `--bf-text-muted` bottom edge), and amber appears only as a selected-row edge or a focus ring; no tab-bar badge text (C's "Values: nothing pinned yet" is gone); busy, refused and outlier states are drawn.
8. **No silent pin.** The Tiles "Pinned region" option and the Summary "Cutouts" toggle are disabled, with the reason "Pin a point first", until a point is pinned (D-1 draws the open Tiles menu). "Compare within: pinned region" follows the same rule.
9. **Subjects list order.** It follows the lens order by default, with "Order: Montage | ID" in its header so a subject can be found by name.

### 10.2 Placement rows that changed

Every row not listed keeps its "C home" from §2.

| # | Control | C′ home |
|---|---|---|
| 2 | View | Toolbar row 1, Summary / Montage; Groups becomes Summary with Group set (#18) |
| 16 | Sort | Montage row 2; similarity options "Similarity · correlation" / "Similarity · amplitude" write the one shared measure (#58) |
| 18 | Group | Row 2 "Group" in Summary and Montage; same similarity options as Sort; menu ends with "Two factors…" and "Restore previous grouping" (#101) |
| 19 | Similarity group count | Row 2, stepper beside Group; the strip shows "Suggested: [value] groups · showing n" |
| 24 | Selection bar | Floating bar: count, Compare with the rest, Save as group…, Clear (rule-2 copy of #87 Clear). Open in Deck: Delete here, Inspector owns it |
| 25 | Montage footer | Footer: description, page, image loading. Similarity busy, Cancel and the correlation refusal with "Use amplitude instead" move to the similarity strip |
| 28 | ‹ › around the Summary subject ID | Summary right pane title, a rule-2 copy of the footer transport (#36) |
| 29 | Subject view | Summary right pane title, "Map / Difference from mean"; gains "Where it differs from [subject]" (#64) |
| 35 | Instructions paragraph | Delete: the Values tab's empty state says it |
| 36 | Playback transport | Footer transport, every view; scrubber in Summary only (the grid is its own scrubber) |
| 40 | Select a range | Delete: Shift-click ranges in the grid or the Subjects list; lasso on the map. Intersect is dropped (accepted) |
| 41 | Tiles show | Montage row 2 "Tiles"; "Pinned region" disabled with "Pin a point first" until a pin exists |
| 42 | Region (cutout) width | Values tab header, "Cutout [w] mm"; read by pinned-region tiles and Summary cutouts |
| 43 | Pin region at crosshair | Delete: "Pin crosshair" in the Values tab (#73) does this; nothing pins silently |
| 44 | Summary individual cutouts | Summary, below the panes: group mean first, lens order, pager, IDs as captions; shown by the row 2 "Cutouts" toggle (disabled until a pin); width from #42; "centre on crosshair" is re-pinning (#73) |
| 47 | Test method | Inspector "Compare and test", Test select; choosing does not run |
| 54 | Apply test | Inspector "Compare and test", explicit Run; the Test select says what is missing and links to Analysis setup |
| 57 | Relationship summary | Similarity strip (placed count in the legend, out-of-date in its header); details in Coverage and sources |
| 58 | Similarity measure | Toolbar Sort and Group similarity options (the one editable home); Inspector Analysis setup shows it read-only |
| 59 | Fit on current support | Automate: choosing Sort or Group by similarity requests the fit |
| 60 | Compare maps in pinned region | Inspector "Analysis setup", Compare within: whole volume / mask / pinned region (pinned region needs a pin) |
| 61 | Cancel fit | Similarity strip, busy state, Cancel |
| 65 | Fit line | Similarity strip fit-quality line: silhouette, stress, variation kept; the rest in Coverage and sources |
| 66 | Stale notice and refit | Similarity strip header, "Out of date" with Refit |
| 67 | MDS scatter, lasso, legend, hover, arrow keys | Similarity strip right of the grid: square, one scale, legend = group headers with Outliers; hover links point and tile; collapses to a 24 px rail; a sheet below about 720 px of centre |
| 71 | Method footnotes | Delete: the strip's info button says it (Ward linkage, outliers, exploratory) |
| 73 | Pin crosshair / Pin preview | Click any image in Summary; elsewhere "Pin crosshair" in the Values tab empty state |
| 81 | Show / Hide values | Delete: the dock's own minimise button (the dock still starts open) |
| 87 | All / None / Focused only / Undo selection | Inspector selection section: Select all, Focused only, Clear (= None), Undo selection (local history; Studio has no Edit › Undo yet) |
| 100 | Choose comparison groups | Inspector "Compare and test", A and B; A carries "Exploratory selection" when it came from the lasso or a similarity group |
| 101 | Undo grouping | Group menu, "Restore previous grouping" (existing local history) |
| 108 | Subjects list sort | Subjects panel header, "Order: Montage / ID" (Montage by default); its own Sort is hidden in the Population lens |

New controls with no inventory row (they are additions, not moves): strip collapse and rail, "Order: Montage / ID", Run, the "Cutouts" toggle, the "Exploratory selection" label, the group-count stepper's +/− (it replaces the count select).

### 10.3 Flagship workflow, clicks

The workflow in `neurotabs-population-exploration.md` §1, from the Population lens in Montage. Choosing from a select counts 2 (open, choose); a drag counts 1; scrolling is not counted. "Today" is read from the inventory (§2), not measured in the app.

| Step | C′ | C | B | Today |
|---|---|---|---|---|
| 1. Mean beside one subject | 1 (Summary) | 1 | 1 | 1 |
| 2. Pin a patch, cutouts across everyone | 2 (click image, Cutouts) | 4 (pin, Montage, Tiles) | 4 | 2 (pin, show cutouts) |
| 3. Order by similarity and scrub | 4 (Montage, Sort, drag) | 3 (already in Montage) | 3 | 5 (Montage, Sort, open Playback, drag) |
| 4. Group related subjects, read the map | 2 (Group; strip opens) | 3 (Group, Map) | 3 (Group, open section) | 3 (Group, open Spatial relationships) |
| 5. Regroup by a factor | 2 | 3 (Montage, Group) | 2 | 2 |
| 6. Both groups side by side, with distributions | 2 (Select group, Compare with the rest) | 2 | 3 (+ open Values section) | 2 |
| 7. Test, then show A − B or the test channel | 6 (expand, Test, Run, Show) | 5 (no Run) | 5 | 6 (expand, method, Apply, channel) |
| **Total** | **19** | **21** | **21** | **21**, plus about four scrolls below the images |

C′ saves clicks mainly because the strip and the cutouts no longer need a view switch; it spends one on Run, deliberately.

### 10.4 Owner decisions remaining

1. **Cutout width lives in the Values tab header** ("Cutout [w] mm", next to Radius), shared by pinned-region tiles and Summary cutouts, rather than once in the Tiles menu and again above the cutouts. Default: yes.
2. **An exploratory selection may still Run** a test; the result keeps the "Exploratory selection" label in Show, the pane titles and any saved calculation, rather than Run being disabled. Default: yes.
3. **The strip's thresholds:** width min(320 px, 40 % of the centre), sheet below 720 px of centre, collapsed state remembered per dataset. Default: yes, revisited after the first native check at 1100 and 1440 px.

### 10.5 Implementation order

Each step ships and tests on its own.

1. **Copy and tokens.** "correlation" for every user-visible "pattern shape" (the backend error text matched by `correlationRefusal` stays); neutral selected-tab edge where amber is used for selection.
2. **Delete duplicates** as in §8 step 1, except: keep the Summary ‹ ›, the Summary cutouts, All / Focused only / Undo selection and Undo grouping.
3. **State.** The probe controller becomes a service; store slices `population.inferenceDraft` and `population.similarity` (measure, region, strip collapsed); the montage's `measure` moves there so the Inspector can read it; selection history stays local to the store and gains no Edit-menu binding.
4. **One footer** for both views (§8 step 3), without similarity busy and refusal, which go to the strip.
5. **Similarity strip** in `LensCanvas` beside the grid: reuse `PopulationRelationshipScatter` and `PopulationBrush` with an equal-aspect viewport; legend from the partition; point-to-tile hover both ways; collapse rail; a `ResizeObserver` switches inline to sheet at 720 px. Backend: Ward linkage, a silhouette-suggested count and singletons reported as outliers (`SIMILARITY_GROUPING_METHOD` is still "average-linkage clustering"; that change is a dependency, not part of this UI work).
6. **Values dock tab** first in `extraTabs` for `set-studio`; the dock defaults stay as they are (open, 120 px); empty state with "Pin crosshair"; cutout width in its header.
7. **Summary:** pane titles, cutout strip with the group mean first, "Cutouts" toggle with the pin guard.
8. **Inspector:** selection section (always present) with its four commands; Compare and test with Run and the exploratory label; Analysis setup with the read-only measure and "Compare within".
9. **Toolbar and Subjects:** drop the Groups segment; Tiles pin guard; count stepper; "Restore previous grouping"; "Order: Montage / ID".

### 10.6 Mechanical check (C′)

The same script as §9, extended: it parses the four §2 tables (C home) and the §10.2 table, replaces each listed row's home with its C′ home, and checks that row numbers run 1–110, every row has nine cells, every C′ home is non-empty, every Delete or Automate entry carries a reason after a colon, and no C′ home still names a removed mechanism (the Map view, Edit › Undo, "pattern shape", a minimised-dock start, a silent pin, an automatic test).

Result: 110 of 110 rows pass, with 32 rows replaced by §10.2 and no problems reported. As a control, the same check run without §10.2 (that is, on C) fails on 12 rows that still name the Map view, a silent pin or an automatic test, so the check does catch them. C′ deletes 22 rows outright (three of them only the Inspector copy: #98, #102, #105) and automates one (#59, the similarity fit); #98 still applies a factor grouping when it is chosen. C deleted 23 and automated 3: C′ restores the Summary ‹ › (#28) and the Summary cutouts (#44), turns the silent pin (#43) into a delete that points to "Pin crosshair", and gives the test back its Run (#54).

Two editable homes remain a judgement the script cannot make. Read against rule 2: the measure has one editable home (the Sort and Group options, which write one state; the Inspector row is read-only); cutout width has one (the Values header); selection commands have one (the Inspector selection section). Three commands keep a deliberate point-of-use copy under rule 2: "Compare with the rest" and Clear in the selection bar, the Summary ‹ › beside the footer transport, and "Use as B" in the Subjects panel.
