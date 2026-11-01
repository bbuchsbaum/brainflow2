# BIDS browser design (2026-11)

## Status

Agreed design, not yet built. It replaces the v1 BIDS Explorer layout, which
had a summary strip, a coverage matrix and Events/Validation tabs
(`ui2/src/components/bids/`). The v1 bridge commands stay; the design adds to
them (see "Backend work").

The design came out of four review rounds with six simulated critics:
Edward Tufte, Steve Jobs, a Linear product designer and Russ Poldrack, then
Josef Albers with a Bauhaus panel and Mike Bostock (d3.js) reviewing round 3
independently. Each round was published as a private claude.ai artifact, built on a synthetic
40-participant example dataset whose brain images come from the MNI152
template in `test-data/unit`:

| Round | Artifact | Result |
| --- | --- | --- |
| 1 | Three directions: Matrix, Dossier, Query | Matrix ranked first or second by all four critics |
| 2 | One converged design | All four approved with fixes |
| 3 | Fixes plus the unseen states | All four approved with notes. Albers panel and Bostock: approve with fixes, five blocking items. |
| 4, 4.1 | Honest per-run FD, colour corrections, filled focus band, then the shared notes | All six approve with notes. No blocking objections. |

| Critic | R1 | R2 | R3 | R4 |
| --- | --- | --- | --- | --- |
| Tufte | 7 | 8 | 8.5 | approve with notes |
| Jobs | 8 | 8.5 | 9 | approve with notes |
| Linear designer | 7 | 8 | 8.5 | approve with notes |
| Poldrack | 6.5 | 8 | 9 | approve with notes |
| Albers and Bauhaus panel | | | 6.5 | 8 |
| Bostock | | | 7 | 8.5 |

Mockup sources, build tools and the approved screenshots are in
[bids-browser-mockups/](bids-browser-mockups/README.md). Start with
`screenshots/r4-coverage.png`; round 4 (`src/r4.html`) is the approved design.

## The one job

When a researcher opens a BIDS folder, they should know within seconds:

1. what exists;
2. what is missing;
3. what differs;
4. what looks wrong;
5. which runs to keep.

From there, opening any run in the viewer takes one key.

## Layout

The browser is one `bids-explorer` workspace inside the existing shell.

```
┌ Files | Findings ┐┌ Summary sentence (claims are links) ──────────┐┌ Inspector ┐
│ (one GL stack)   ││ Coverage | Images        [lens chip]          ││ run detail│
│                  ││ matrix or contact sheet                       ││           │
│                  ││ ───────── bottom dock: runs in lens ──────────││           │
│                  ││ key hints                                     ││           │
└──────────────────┘└───────────────────────────────────────────────┘└───────────┘
 status: BIDS version · counts · Findings N · Excluded N · validator · read X of Y
```

### Summary

A generated paragraph sits at the top of the workspace, and every claim in it is
a link. Example: "40 participants (25 control, 15 patient…). 5 have no second
session. 9 second sessions used a different protocol… 5 participants have runs
failing the motion rule (mean FD > **0.25 mm**, Parkes stringent). Since 28 Oct:
3 new participants, not yet processed by fMRIPrep."

- Clicking a claim sets the lens (see below).
- The motion-rule threshold is edited inline, in the sentence. No settings live in the
  view toolbars.
- "Copy summary" puts the paragraph, ready for a data descriptor, on the
  clipboard.

### Coverage (default view)

- **Rows** are participants, grouped by a participants.tsv variable (group by
  default), with sex and age in the gutter. Rows are 16 px.
- **Columns** are session, then series, then run, with one column per run.
  The runs of one task sit together; tasks are separated by a 6 px gap and
  sessions by 20 px. The current matrix aggregates runs into `run_count`, so
  this is a backend change.
- **Cell encoding.** Normal is the faintest ink and anomalies are the
  strongest. Each meaning has exactly one mark:

  | Meaning | Mark |
  | --- | --- |
  | Present bold run that passes the motion rule | That run's own FD trace as a min–max band per pixel column (M4-style, so no spike is lost), on a shared 0–1 mm scale, at the faintest ink (about 32%). Values over 1 mm are clamped and get a mid-grey tick, so a spike is never hidden. |
  | Run that fails the motion rule | The same band in full neutral ink, with white clip ticks. Ink weight follows the rule; data, scale and method do not change. |
  | Present non-bold | Faint hairline |
  | Acquisition variant | Grey hairline outline, quieter than any finding |
  | Content problem | Orange fill. The only use of orange. |
  | Validation error | Red fill with a cross, so it does not rely on hue alone |
  | Missing | Short faint dash |
  | Excluded | Neutral `#45474d` cell, struck through; a 1.5 px orange or red edge if a problem remains |
  | Hover | Faint fill plus a readout: full-resolution trace, mean, max and frames over 0.5 mm; the same participant's session dot is ringed in the margin |
  | Selected | Filled cell, plus the amber 2 px row edge (`--bf-accent`). Never an outline. |
  | Lens highlight | Faint band behind the affected cells |
  | New since last scan | "new" tag beside the participant id |

- **Margins:**
  - Derivative status per participant (fMRIPrep, MRIQC, FreeSurfer). Blank
    means present and current; only missing, partial and stale states are
    drawn.
  - Mean FD for each session, computed as the mean of that session's
    included runs (excluded runs are left out), on 0–0.8 mm with ticks at
    0, 0.25 and 0.50, a marked domain end, a cap for values past it, and the
    threshold dashed. Dots are hollow for
    acquisition groups whose FD is not directly comparable (different
    TR/multiband, unfiltered).
- **Column totals** sit in the header, under the run numbers, labelled "runs
  present, of N".

### Colour

The rules in `AGENTS.md` hold: chrome is achromatic, and chroma is data or
status. Round 4 fixes three collisions measured on the rendered pixels:

- **Error vs warning.** `--bf-danger #f5868f` and `--bf-warning #f28a5a` have the
  same lightness (contrast 1.015:1) and differ only by hue, which fails at small
  sizes. The design uses `#e5484d` for errors (1.6:1 against orange), plus a
  cross or a full-width shape. **This is a proposed change to the app-wide
  `--bf-danger` token in `ui2/src/styles/theme.css` and needs an owner
  decision** before the browser is built.
- **Event categories** use one categorical set for every task: teal `#7fb8b0`,
  violet `#b39ddb` and grey `#5d6067`. No event colour may reuse a status hue,
  the amber accent hue or info blue.
- **Neutral traces.** The FD trace is `#bdbfc4`. Info blue is not used in the BIDS
  views; "new" is a fact and is set in secondary text.

Orange means only "content problem". Red means only "validation error". White
full ink means only "over a quality threshold". Amber is only the selection edge
and the focus ring. The time crosshair uses the viewer's `--bf-crosshair`.

### Images (contact sheet)

- Shows the same slice, window and series for every subject-session: mean
  EPI, T1w, b0 or tSNR map.
- Sort by matrix order, tSNR or FD.
- A white frame marks a quality outlier. An acquisition variant is a letter
  tag under the tile, not a second kind of frame. Selection is a filled tile
  with an inverted label. The label key is printed on the sheet
  (`14·1` = sub-14 ses-01, number = tSNR).
- In the Inspector, the selected run sits beside the dataset median image at
  the same slice and window.

### Lens

There is one filter object, shared by every view. It reconciles "no filter bar"
(Jobs) with "filters are objects, saved views, ⌘K" (Linear).

- You set it by clicking a summary claim, clicking a Findings item or choosing a
  ⌘K result. There is never a permanent query bar.
- It shows as one chip with four actions: **highlight**, **only**, **save** and
  **clear**.
- Saved lenses appear at the top of Findings and in ⌘K. Example: "Ready for
  group analysis = not excluded, passes the motion rule, fMRIPrep current".
- The runs in the lens are listed in the bottom dock, sorted and keyboard
  navigable. There is no separate Runs view.
- Group counts always show their denominator, e.g. "18 of 44 variant B runs ·
  task nback".

### Findings (left stack, beside Files)

- One list and one count, shared by the summary, Findings and the status bar.
- Groups:
  - Saved lenses
  - Errors (validator)
  - Content problems (Brainflow checks)
  - Acquisition variants (CuBIDS-style)
  - Quality (per run, with denominators)
  - Notes
  - Excluded
- Titles wrap instead of truncating.
- Each excluded item has Review and Revert.
- The Files panel (BIDS mode) follows the selection and reveals the selected
  run. BIDS filenames are truncated in the middle so the `run-` entity stays
  visible.

### Inspector (run)

In order:

1. Entity, group, age and sex, plus a variant chip and a quality chip.
2. Mean EPI and T1w thumbnails.
3. **FD trace, carpet plot and events on one time axis.**
   - One x-scale for all three, one crosshair (the viewer's crosshair colour)
     through all three, and a readout: volume, seconds, FD, current event.
   - The FD trace has a y-axis at 0, 0.5 and 1 mm, a min–max band per pixel
     column, clip ticks, and the 0.5 mm censoring line drawn on top.
   - The carpet comes from the BOLD data (the fMRIPrep grey-matter voxel ×
     time matrix), not from FD; its agreement with FD is something to check.
   - The source is named: "FD (Power) · fmriprep 24.1.1 confounds", and every
     number (mean, max, frames over 0.5 mm and their percentage) is computed
     from the drawn trace. An "unfiltered" caveat appears where it applies.
4. **Effective metadata vs modal.**
   - Changed values are bright neutral and modal values faint.
   - The source column names the file in the inheritance chain that supplied
     each value: the run sidecar, a dataset-level sidecar, or the NIfTI
     header.
   - Array-valued keys (SliceTiming) are compared as vectors.
   - NIfTI `pixdim[4]` is checked against RepetitionTime.
5. **Field map**:
   - `B0FieldSource` on the run, linked to its `B0FieldIdentifier` field map.
     IntendedFor is the fallback.
   - Checks: PE directions are opposed, TotalReadoutTime matches, same grid
     and session.
   - Runs with no field map are flagged.
6. **Events**:
   - Timeline with a legend; blocks are tinted and each trial onset is a tick.
   - Checks: required onset and duration present, n/a handling, trial_type
     levels match events.json, events ending after the scan, and the
     response_time missing rate.
7. **Derivatives**: GeneratedBy name and version, and the SourceDatasets version
   compared against the raw dataset version, so stale outputs are visible.
8. Actions:
   - **Open in viewer ↵**, which lands on the most informative timepoint
     (the FD peak) with events loaded as a track.
   - Compare with modal (C).
   - Exclude (X).

### Exclusions

- X opens a dialog with three parts:
  - **Scope:** this run, the session's runs, or the participant.
  - **Rule:** Parkes et al. 2018 stringent by default: mean FD > 0.25 mm, or
    more than 20% of frames over 0.2 mm, or any frame over 5 mm. Each value is
    editable; an edited rule is named as custom.
  - **Reason:** prefilled from the triggering criterion.
  - **Preview:** the exact TSV row to be written.
- The record is written to `derivatives/brainflow/exclusions.tsv` with entity,
  reason, criterion, value, author, date and source. An `exclusions.json` beside
  it describes the columns, including the FD definition, its source and version,
  and the threshold.
- The first write creates `derivatives/brainflow/dataset_description.json`:
  - `DatasetType: derivative` and `GeneratedBy`.
  - `SourceDatasets`, preferring a DOI or a `bids::`/relative URI.
- The raw dataset is never modified. An undo toast (⌘Z) appears above the dock,
  and Findings › Excluded offers Revert.
- Excluded runs show as struck neutral cells, and every count, including the
  status bar and session means, updates from the same model. This needs a test.

### Scale and scanning

- **At hundreds of participants:**
  - A discrete piecewise y-scale: 2 px rows, 10 px for the two neighbours on
    each side of the selection, 16 px for the selected row. It is exact and
    invertible for hit-testing. The selected row shows real cells and its runs'
    own sparklines.
  - Present runs stay near-background, so the faint-for-normal rule holds at
    density.
  - Marks differ by shape as well as colour:
    - errors are full-width red;
    - content problems are half-width orange;
    - QC outliers are a narrow white tick, so they never outweigh an error;
    - variants are a lighter grey.
  - Column headers are short horizontal codes (T1, N1, R2…) with a key below,
    never rotated.
  - The FD margins stay, as a compressed dot strip.
  - Column headers are stacked horizontally, never rotated.
- **Streaming:**
  - The scan streams, and rows fill as participants are read.
  - The summary, Findings and status bar say "so far" until the scan
    completes. Unread rows are empty, never estimated.
  - Opening a run never waits for the scan.
  - Rescans are incremental, and "since last scan" is computed from the stored
    index.
  - Remote mounts read only sidecars and headers during the scan.

### Keyboard (all views)

| Key | Action |
| --- | --- |
| `J` `K` `H` `L` | Move |
| `Space` | Quick look |
| `↵` | Open in viewer, everywhere. In ⌘K too; ⌘K selects with `⇥` or on click. |
| `C` | Compare with modal |
| `X` | Exclude |
| `⌘K` | Go to: runs, participants, findings, saved lenses, commands |
| `1` / `2` | Coverage / Images |
| `⌘Z` | Undo the last exclusion |

## Scientific rules

1. Every count comes from one derived model in the store. Views never compute
   their own totals.
2. QC metrics are per run. Session and participant values are summaries of runs
   and are labelled that way.
3. The default exclusion rule is Parkes et al. 2018 stringent: mean FD >
   0.25 mm, or more than 20% of frames over 0.2 mm, or any frame over 5 mm.
   - Every threshold is editable and recorded in `exclusions.json`.
   - The same rule decides full ink in the matrix, the Quality findings, the
     summary claim and the default exclusion reason. A run with a low mean but
     many spiky frames therefore still shows at full ink.
   - An edited rule is called custom, never "Parkes".
   - 0.5 mm is described only as a per-frame censoring line.
   - Session means leave out excluded runs.
4. FD is not compared across acquisition groups with different TR or multiband
   without a caveat or filtered FD.
5. Every QC number names its source and version (MRIQC or fMRIPrep), and the
   FD definition.
6. Acquisition variants are differences in *effective* metadata (after
   inheritance), grouped CuBIDS-style. They are not errors, and their notes
   state consequences, not guesses.
7. Validator findings and Brainflow content checks are tagged separately.

## Backend work (beyond v1 `scan_bids_dataset`)

| Need | Source |
| --- | --- |
| Coverage per run (one column per run entity) | bids-rs file index |
| Effective sidecar per run with provenance (which file supplied each key) | bids-rs inheritance resolution |
| NIfTI header summary per run (dims, pixdim, qform) | `core/loaders` header read only |
| Variant groups (hash of effective acquisition keys per series) | new, in api_bridge |
| MRIQC IQMs per run | `derivatives/mriqc/group_*.tsv` |
| FD per volume per run | fMRIPrep `*_desc-confounds_timeseries.tsv` (lazy, on select) |
| Derivative coverage and staleness | each derivative's `dataset_description.json` (GeneratedBy, SourceDatasets) |
| Field map graph | B0FieldIdentifier/B0FieldSource, IntendedFor fallback |
| Events checks | events.tsv and events.json |
| Contact-sheet slices | Downsampled slice per run, rendered on demand and cached |
| Exclusions read/write | new command writing only under `derivatives/brainflow/` |
| Scan streaming and incremental index | progress events plus a stored index per dataset |

New commands go through `core/api_bridge/src/command_list.rs` and
[ADDING_COMMANDS.md](../../core/api_bridge/ADDING_COMMANDS.md). The
exclusion writer is the only command that writes, and it writes only below
`derivatives/brainflow/`.

## Interaction (linked views)

- **Hover** on a matrix cell shows the readout and rings the participant's
  session dot in the margin. Hovering a margin dot does the reverse and
  highlights the dock row.
- **Brushing:** a 1D `d3-brush` on a margin dot strip sets the lens to an FD
  range. The matrix, contact sheet and dock follow. Rows outside the brush
  fade but keep their order.
- **Re-sorting** animates rows with a keyed transition of about 250 ms, so each
  row stays the same object. Respect `prefers-reduced-motion`.
- **Selection** centres the row in the focus band and drives the Inspector.
  The Inspector crosshair scrubs FD, carpet and events together.

## Rendering

- SVG for the 40-row matrix (about 700 marks), margins, the Inspector trace
  and the focus band.
- Canvas for the compressed rows of large datasets and for the carpet:
  - one `fillRect` per cell;
  - hit-testing by inverting the piecewise row scale;
  - streaming rows drawn in `requestAnimationFrame` batches into an offscreen
    canvas and never redrawn.
- Virtualise only the dock list.
- `d3-scale` and `d3-array` (`bin`, `max`, `rollup`) and the existing Visx axes
  cover this; no new dependencies.
- One trace store per run feeds the matrix, the focus band, hover and the
  Inspector, so one run looks the same everywhere.

## Implementation notes from round 3 (non-blocking)

- Stop scroll containers from showing half rows at the bottom; snap to whole
  rows or fade.
- Wrap the TSV and JSON previews in the exclude dialog.
- Make variant outlines one step lighter than shown in round 3.
- Use one family (sans or mono) for count labels in panel headers.
- Export a saved lens as a participant/run list (TSV or a BIDS filter file)
  for fMRIPrep and FitLins.

## Implementation notes from round 4 (non-blocking)

- Bayer (Albers panel) prefers a 16 px gap between sessions; the mockup uses
  20 px.
- Moholy-Nagy accepts solid white QC fills; Albers and Bayer prefer the
  narrow tick used here.
- In the mockup, the carpet is derived from FD and the 400-row view is SVG
  with synthetic focus-band traces. The app must use BOLD data for the carpet,
  canvas for the compressed rows, and the shared trace store for the band.
- The mockup's synthetic FD is scaled to a realistic level for TR 0.8 s
  multiband in round 4 (low-motion runs near 0.1 mm). Under the stringent rule,
  5 of 40 participants fail, including one with a low mean and a spiky run.
