# Set studio: calm hill-climb plan (2026-11-12)

Goal: calm and functional together, so the user gets the information without feeling overwhelmed.
Scope: the Population lens (Montage and Summary), the similarity strip, the Values dock tab and the
Inspector. The rest of the app is out of scope.

## What the 2026-11-12 screenshots show

Counted on one screen (Montage, grouped by similarity, a pin set, dock open): about 70 interactive
controls and five rows of chrome above the first brain. The brains get about 30 % of the panel area.

### Defects (not matters of taste; fix in round 0)

1. **The measures disagree.** The montage groups by correlation ("Similarity (r)", and the footer
   says "correlation distance"), but the strip's title reads "Similarity · amplitude". The title
   comes from `fit.request.distance` (`SimilarityStrip.tsx:119`), so the plot shows a different
   fit (RMS/MDS) from the one that made the groups. The Inspector's "Nearest" list also ranks by
   RMS. Fix: one fit per view. The strip, the groups and the nearest list all use the montage's
   measure, or the strip states its own measure plainly.
2. **A stale "No region" error** shows in the Values tab while At = Point/sphere. The locus issue
   left over from Region mode is never cleared (`PopulationProbePanel.tsx:170`).
3. **The strip plot's y-axis labels are clipped**: ".005" is shown where the value is −0.005.
4. **The Inspector's rank ("7th", "4th") is drawn in amber.** Amber is reserved for the focus ring
   and the selected-row edge, so this breaks the rule in `AGENTS.md`.
5. **The "2" beside Group is an unlabelled number field.** It is the group count.
6. **Labels are truncated:**
   - "Value at crossh…" in Sort;
   - "…correlation distance · whol…" in the footer;
   - the role path in the Inspector;
   - the Distance header, which wraps to four lines.
7. **There is an empty band of about 40 px** between the toolbar and the first tile row.
8. **The heading for the first group scrolls away**, so the tiles at the top have no label.

### Redundancy (the main source of "overwhelm")

- **The focused subject appears in four places:** the tile ring, the footer, the strip label and
  the Inspector heading.
- **The value at the point appears in three places:** the Inspector, the Values tab and the status bar.
- **Three statements of the measure:** the Group menu, the strip title and the footer.
- **Status and identity are spread across rows:**
  - the dataset row (Ready to compare, 35 images, grid chip);
  - the lens row (lenses and views, background, info, More).
- **Many repeated prose sentences:**
  - "Where they differ" ×5;
  - "Summaries describe the selection…";
  - "By distance, not by the plot";
  - the tooltip text in the Values tab.

### Encoding (Tufte and Bostock territory)

- **Tiles.** Each tile is a black square with a frame and a boxed label; the brain fills about half
  of it. Ink goes to frames rather than data, and this is the "scrunched" look.
- **The MDS scatter does not show the groups.** All dots are the same grey, so the plot can't
  confirm the grouping it sits beside. "MDS axis 1/2" and the axis cross carry no information,
  because MDS axes have no units.
- **The Values strip uses 35 dots and four lines of sentences for one distribution.** A compact
  dot strip with a zero line and a sign tally would say the same.

## Method

This uses the `visual-hill-climb` skill: fixed specimens, independent critics, scored rounds and
regression checks.

**Specimens.** Four fixed states, captured natively on enc_rep_rsa (Trillium mount) at 1440×900
and 1100×800:

- **S1:** Montage, opened fresh.
- **S2:** Montage grouped by similarity, strip open.
- **S3:** a selection made, Compare and test open.
- **S4:** Summary with a pin, dock on Values.

**Critics.** Three run in parallel with fresh context each round, and none sees the others' scores:

- **Tufte:** data-ink, redundancy, small multiples, labelling, integrity of the encoding.
- **Bostock:** linked views, the scatter's encoding, interaction cost, what each mark answers.
- **A Linear-calibre product designer:** hierarchy, rhythm, progressive disclosure, control
  density, calm.

**Rubric.** Each critic scores 1 to 5 on six measures:

| Measure | Target |
| --- | --- |
| Brain area share | ≥ 50 % of the panel |
| Chrome rows above the brains | ≤ 2 |
| Controls visible by default | ≤ 25 |
| Each fact stated once | Yes |
| Every encoding answers a question | Yes |
| Core tasks need no extra clicks | Sort, group, select, compare, read a value |

Core tasks also act as a regression floor. The rubric's numbers are measured, not scored by eye.

**Round loop.**

1. The critics review the specimens.
2. I synthesise one change list ranked by gain and risk, and resolve their conflicts.
3. Mock the riskier changes on the existing design canvas first.
4. Implement.
5. Rebuild and recapture the specimens natively.
6. Re-score, and check that every core task still works.

A change that lowers the function score is reverted even if calm improves.

## Round 1 starting hypotheses (the critics may overturn any of these)

**Chrome**

- One header row: the dataset name with a single status word (shown only when something is wrong),
  then lens, view and background. The chips move into the dataset card.
- Remove the empty band.

**Toolbar**

- The group count moves into the Group menu as "Groups: auto (2)".
- Tiles (Whole slice / Brain) and the size slider merge into one "View" popover.
- Sort gets enough width for its longest label.

**Tiles**

- No frames and 2 px gutters.
- Each tile is cropped to the brain's bounding box by default.
- The ID is a small mono overlay inside the image.
- Group headers are sticky, with "Select group" and "Show group mean" appearing on hover.

**Strip**

- Dots are coded by group (neutral shades, or a shape when there are more than four groups), with
  a light hull per group.
- Drop the axes and the axis names; add one caption, "closer = more alike (r)".
- Lasso by dragging on empty space; the Lasso button goes.
- A narrower column of about 280 px.

**Footer**

- Transport, scale and Fit only.
- The measure is stated once, in the strip caption.

**Values tab**

- One control row.
- Show the region or cluster error only in that mode.
- The four summary sentences become a two-column key–value list.

**Inspector**

- The nearest list keeps two columns, ID and distance; the unit goes in the header's tooltip.
- "Where they differ" becomes a hover action on the row.
- Explanatory prose moves behind ⓘ.

## Rounds and stopping rule

- **Round 0:** fix defects 1–8 and capture the baseline specimens.
- **Rounds 1 and 2:** critique, change, capture, score.
- **Round 3:** only if round 2's mean gain is at least 0.5 rubric points or a critic flags a
  blocker. Otherwise stop.
- Each round ends with before/after specimens for the user. The user approves before the next round.

## Constraints

- Keep the `--bf-*` tokens and the achromatic chrome. Group colour must not reuse amber.
- No new information may be lost. Anything removed from view stays reachable within one interaction.
- Native capture on Trillium follows the production-host rules: no repeated failed sign-ins.
- Background computer use only; screenshots are taken while the user is not driving.

## Round 1 — critic scores (baseline, 2026-11-12 screenshots)

| | Calm | Function | Brain prominence | Other |
| --- | --- | --- | --- | --- |
| Tufte | 2 | 4 | 2 | redundancy 2, encoding integrity 2 |
| Bostock | 2 | 3 | 2 | linked views 2, interaction cost 3 |
| Linear | 2 | 4 | 1.5 | hierarchy 2, consistency 2 |

Unanimous: per-tile crops break small multiples (use ONE shared crop); 2 px gutters too tight;
neutral grey shades cannot encode groups; one measure everywhere; drop the "On screen" amber rank;
group headers sticky; Values error only in its mode.

## Round 1 — synthesised change list (conflicts resolved)

R1-A Header + toolbar + footer (StudioCenterPane/StudioToolbar/PopulationLens/MontageToolbar/MontageFooter/PopulationColorbar)
- Two rows above the brains. Row 1: dataset name · lens segmented · Summary/Montage (lighter text tabs) · background · ⓘ · ⋯.
  The "Ready" pill and "35 images · grid" chips go into the ⓘ/dataset card; a status word appears only on a problem.
  Grid provenance ("matched, not declared") stays in that card.
- Row 2 (toolbar): Sort (min width fits longest label) · reverse · Group ("Similarity · 2 groups ▾", count inside the menu) · Slice · z · tile-size slider. Tiles extent moves to ⋯.
- Footer: transport + "26 / 35" only. Colour scale becomes a compact scale (≈140×6 bar, ticks at −max/0/+max, threshold notch, unit) whose click opens limits/Fit/threshold in a popover.

R1-B Tiles + group headers (MontageTiles/MontageGroupRows/montageTileSupport/studio.css)
- Frameless; area outside the brain painted panel background, not black. One shared crop: union bounding box of brain/background-nonzero pixels across all tiles (+2 px), same for every tile.
- Gutters 6 px horizontal / 4 px vertical; 20 px between groups.
- Label below the image, 10–11 px mono, muted, no box; strip a prefix common to all IDs ("sub-") and state it once in the group header.
- Focus = 1 px --primary outline; selection = amber edge (existing rule).
- Group header sticky, 20 px, "Group 2 · 6" + group glyph (see R1-C) + quiet "Select" always visible; "Mean" kept (difference tile deferred to round 2).
- Default overlay colormap for the population montage: dark-centred diverging (luminance rises with |v|), only if such a map already exists in the app; user choice preserved. (Tufte #1 — flagged risk M.)

R1-C Similarity strip + Inspector (SimilarityStrip/PopulationRelationshipScatter/PopulationRelationshipLists/PopulationInspector)
- Scatter: 1:1 aspect, no axes/axis titles/inner panel; groups by mark (filled / open / ringed for k≤3, shapes beyond), direct centroid labels "G1 · 29"; same glyph in the montage group header.
- Caption once: "Correlation distance (1−r) · 2-D keeps NN% of variance" (from MDS eigenvalues). Measure appears nowhere else.
- When a subject is focused: faint spokes to its 5 true nearest neighbours, numbered to match the Nearest list (replaces the floating "1","3").
- Direct lasso: drag on empty space; shift adds; click focuses; Esc clears. Remove the Lasso button.
- Two-way hover: tile ↔ point ↔ Values dot ring each other.
- Strip column ~300 px, collapsible (existing), shown when grouping/sorting by similarity.
- Inspector focus block: heading + value at pin + "Open in Deck"; drop the duplicate "member" row; role path in title. "Hold to preview without ▾".
- Nearest: columns #, ID, distance with unit in the header ("1−r"); drop "On screen"; "Where they differ" as a row hover action; row hover outlines the tile.
- Selection empty state: one muted line; action buttons only once a selection exists (Select all stays).

R1-D Values dock (PopulationProbePanel/PopulationBrush/PopulationValuesTab)
- One control row: At · Radius (hidden for a point with radius 0) · Cutout · Follow hover · Pin toggle · Strip/Table · ⋯ (Compose in Plot, Brush).
- Dot plot keeps its ranked form: neutral dots, hairline zero rule, 3 unclipped ticks, focus dot ringed, direct labels for min/max/focus, caption "35 subjects, ranked". Delete the blue/red sign-share bar.
- Summary as a 2-column key–value list (mean, mean |v|, cancellation, sign "25 − / 10 +"); hide "Near zero" while its tolerance is 0.

Deferred to round 2: G1−G2 difference tile (Bostock #7); typicality order within groups (#6);
per-view number exponent (Tufte #4); auto-collapse the Files panel when the studio has focus (out of scope; ask).

## Round 1 — re-score (native captures cruft/calm-r1/S1–S4, 2026-11-12)

| | Calm | Function | Brain prominence | Other |
| --- | --- | --- | --- | --- |
| Tufte | 2 → 3.5 | 4 → 3 | 2 → 3 | redundancy 2 → 3.5, integrity 2 → 2.5 |
| Bostock | 2 → 3.5 | 3 → 3 | 2 → 3.5 | linked views 2 → 2.5, interaction 3 → 3 |
| Linear | 2 → 3 | 4 → 3 | 1.5 → 3 | hierarchy 2 → 3, consistency 2 → 2.5; ~85 visible controls (was ~110) |

Function dropped because of one regression (all three critics, #1): grouped Montage shows 3 tiles per
group plus an "N more" card, so 29 of 35 brains are hidden.

Whole-UI pass (captures X1–X8): data-learner walkthrough and a product (Jobs) review added.

## Round 2 — tier A (regressions, correctness, legibility; no product decisions)

A1 Grouped montage shows every member, wrapped; delete "N more" cards; one shared tile size chosen so the set fits.
A2 Scatter: robust extent (5–95 %) with outliers clamped to the edge as marks (true position in tooltip);
   collision-avoiding labels, centroid labels outside the group, the 5 most extreme points labelled;
   low fidelity said in words ("2-D keeps 21 % — distances approximate").
A3 One subset rule everywhere: when a selection exists, unselected tiles/points/dots dim to ~35 %;
   Values stats titled "Selection · 8 of 35" or "All · 35"; caption "8 of 35 selected, ranked".
A4 Values plot identifies itself: title "<map> at (x, y, z) mm — N subjects ranked by value"; y-axis label with
   units; bold zero line + dashed mean line; legend for selected/others/current; labels kept inside the frame;
   "Mean |v|" → "Average size", "Cancellation" explained or behind ⓘ.
A5 Map identity: the header names the map shown (e.g. "same_item") with a selector when the set has several maps;
   Inspector "roles" shows the list (bug: the basename fix kept only the last path); dataset ⓘ lists maps and value range.
A6 Tiles and Summary cards: out-of-head pixels in the panel colour (current clearing misses them); Summary cards use
   the shared crop, no letterbox; per-card actions in a ⋯; drop the meaningless 1/35 transport in Montage/grouped Summary.
A7 Selection actions inline in the montage header row (no floating bar over tiles).
A8 Dock: when nothing is pinned, one 28 px line ("Nothing pinned · Pin crosshair") instead of a full empty state.
A9 Inspector: one Nearest table with Focused / Selection toggle; method prose behind ⓘ; distances not underlined;
   a reference ("median pair distance 0.80"); focused subject shows "rank 18/35 · z −0.1" at the pin;
   "Hold to preview without ▾" → "Group mean without sub-1002 (hold)".
A10 Compare and test: never A = B by default; "Compare with the rest" fills A/B; Run disabled when A = B.
A11 Pin is shared across lenses (Deck/Compare show "Nothing pinned" beside "Unpin").
A12 Small fixes: ⋯ and colour popovers close on outside click and anchor correctly; colour bar gains a 0 tick and
   unit; group headers never truncate; the stripped "sub-" prefix stated once (ungrouped too).

## Round 2 — tier B (need the user's decision)

B1 Colour: dark-centred diverging ramp + opacity rising with |v| so anatomy shows where values are small
   (all three critics). Recolours every population map; Deck/Compare use fmri red-blue today.
B2 Group effect: an always-present "All 35" Summary card with Mean / t / % positive, and a G1 − G2 difference card.
B3 Live "sort by what's here" (Jobs): Follow hover on by default; montage reorders by value at the pointer/pin with a
   short reflow; strip dots aligned to tiles; brushing the strip selects.
B4 Distance-matrix view (Bostock): 35×35 matrix reordered by the Ward tree, as a toggle beside the 2-D map.
B5 Simplify the model (Jobs): fold Deck into "open subject"; rename Compare lens "Subject vs mean";
   move provenance/recipe plumbing into one Provenance sheet; split ⋯ into View and Data.
B6 Real tests in Compare and test (Welch / permutation, FDR) — a statistics feature, likely its own plan.

## Round 2 — re-score (native captures cruft/calm-r2/R1–R8, 2026-11-12)

| | Calm | Function | Brain prominence | Other |
| --- | --- | --- | --- | --- |
| Tufte | 3.5 → 3.5 | 3 → 4 | 3 → 3 | redundancy 3.5 → 3, integrity 2.5 → 3 |
| Bostock | 3.5 → 4 | 3 → 4 | 3.5 → 4 | linked views 2.5 → 3, interaction 3 → 3.5 |
| Linear | 3 → 3 | 3 → 3.5 | 3 → 2.5 | hierarchy 3 → 3, consistency 2.5 → 2.5; ~59 controls in R3 (was ~85) |

Mean gain ≈ +0.3 (below 0.5), but two blockers were flagged, so round 3 runs (stopping rule):
the colour scale clips at ±0.0145 while values reach −0.045 (Tufte), and the scatter clamp pins most
of G2 to the edge (Bostock). All three critics: one narrow round 3, then stop.

## Round 3 — change list (narrow; then stop)

C1 Colour scale from the data: symmetric limits at the 98th percentile of |v| across the set (manual limits kept),
   clipped ends marked on the bar; t and G1 − G2 get their own limits; one bar per distinct scale (drop the in-panel
   vertical bars and the header range text); "mean ±0.0145" → "colour ±0.0145"; Subject lens uses the population scale.
C2 Grouped Summary on one screen: G1 − G2 first, then G1, G2 (All as a toggle or fitted in the same row), titles
   "G1 − G2 · 29 vs 6", "G1 · 29"; the Mean / t / % positive switch lives in the labelled toolbar Show select
   (replacing the disabled one); Summary toolbar labelled like Montage (Show, Group, Slice); hide disabled Cutouts.
C3 Values dock: auto-height (28 px line when empty, ~168 px when filled); one control row (Radius, near-zero band in ⋯);
   one never-truncated title with the map name, not the file path, and pin/pointer named; delete the "Showing…" line
   and the repeated caption; unit on the axis when known; collision-free labels; mean line in the legend;
   Cancellation behind ⓘ. When grouped: dots carry group marks and the stats show All / G1 / G2 columns.
   Location contract: the Inspector's value says "at the pin" or "at the pointer" and follows what Values shows.
C4 Scatter honesty: clamp only true outliers (> ~3 robust SD from the median) and never most of a group; one
   "N off-scale" note instead of per-point arrows with IDs; remove the stray glyph; spokes and numerals only on focus.
C5 Header and toolbar widths: dataset name never truncates (template select truncates first or moves into ⋯);
   Group reads "r · 2 groups"; the "IDs sub-…" note moves into the group header; gap between reverse and Sort;
   Group menu hides disabled items and renames "member" / "roles" ("Each subject" hidden, "By map").
C6 Inspector wording: one phrase ("Group mean without …"), the hold control as one split button; Subject inspector
   hides the cache path.

Deferred (product decisions): inference in Values (CI, t / p, sign test, Welch G1 − G2), typicality ranking and
silhouette display, grouping by participants.tsv factors, distance-matrix view.

## Round 3 — final scores (native captures cruft/calm-r3/T1–T6, 2026-11-12)

| | Calm | Function | Brain prominence | Other |
| --- | --- | --- | --- | --- |
| Tufte | 3.5 → 4 | 4 → 4 | 3 → 3.5 | redundancy 3 → 3.5, integrity 3 → 3.5 |
| Bostock | 4 → 4 | 4 → 4 | 4 → 4 | linked views 3 → 3.5, interaction 3.5 → 3.5 |
| Linear | 3 → 3.5 | 3.5 → 3.5 | 2.5 → 3.5 | hierarchy 3 → 3.5, consistency 2.5 → 3 |

Baseline (all critics) was calm 2, brain prominence 1.5–2. Mean gain this round ≈ +0.35: converged.
Remaining for one fix batch (no scored round 4):
- Scatter extent now follows G2's spread, so the 29-member G1 is a ~40 px knot. Offer "Fit core / Fit all" (core default,
  off-scale note) — the honest-but-readable compromise.
- Subject lens: population scale only once Population has drawn; in-panel bar; opaque overlay; path in header.
- Values dock still clips its stats (Sign row) at ~171 px; "Average size" wraps.
- Polish: one name for the measure; group count visible in the Group menu; Summary card ⋯ placement; "IDs sub-…"
  truncation; "valid pixels" tooltip; the "Studio strip" row under Summary cards; pointer value precision/coords.
