# BIDS browser design (2026-11)

## Status

Agreed design, not yet built. It replaces the v1 BIDS Explorer layout, which
had a summary strip, a coverage matrix and Events/Validation tabs
(`ui2/src/components/bids/`). The v1 bridge commands stay; the design adds to
them (see "Backend work").

The design came out of three review rounds with four simulated critics:
Edward Tufte, Steve Jobs, a Linear product designer and Russ Poldrack. Each
round was published as a private claude.ai artifact, built on a synthetic
40-participant example dataset whose brain images come from the MNI152
template in `test-data/unit`:

| Round | Artifact | Result |
| --- | --- | --- |
| 1 | Three directions: Matrix, Dossier, Query | Matrix ranked first or second by all four critics |
| 2 | One converged design | All four approved with fixes |
| 3 | Fixes plus the unseen states | All four approved with notes. No blocking objections. |

| Critic | R1 | R2 | R3 |
| --- | --- | --- | --- |
| Tufte | 7 | 8 | 8.5 |
| Jobs | 8 | 8.5 | 9 |
| Linear designer | 7 | 8 | 8.5 |
| Poldrack | 6.5 | 8 | 9 |

Mockup sources, build tools and the approved screenshots are in
[bids-browser-mockups/](bids-browser-mockups/README.md). Start with
`screenshots/r3-coverage.png`.

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
session. 9 second sessions used a different protocol… 4 participants have runs
over mean FD **0.25 mm**. Since 28 Oct: 3 new participants, not yet processed by
fMRIPrep."

- Clicking a claim sets the lens (see below).
- The FD threshold is edited inline, in the sentence. No settings live in the
  view toolbars.
- "Copy summary" puts the paragraph, ready for a data descriptor, on the
  clipboard.

### Coverage (default view)

- **Rows** are participants, grouped by a participants.tsv variable (group by
  default), with sex and age in the gutter. Rows are 16 px.
- **Columns** are session, then series, then run, with one column per run.
  The current matrix aggregates runs into `run_count`, so this is a backend
  change.
- **Cell encoding.** Normal is the faintest ink and anomalies are the
  strongest. Each meaning has exactly one mark:

  | Meaning | Mark |
  | --- | --- |
  | Present bold run | Sparkline of that run's FD per volume, faint, on a shared 0–1.4 mm scale stated in the header |
  | Run mean FD over threshold | The same sparkline in the strongest neutral ink |
  | Present non-bold | Faint hairline |
  | Acquisition variant | Grey hairline outline, quieter than any finding |
  | Content problem | Orange fill. The only use of orange. |
  | Validation error | Red fill with a cross, so it does not rely on hue alone |
  | Missing | Short faint dash |
  | Selected | Filled cell, plus the amber 2 px row edge (`--bf-accent`). Never an outline. |
  | Lens highlight | Faint band behind the affected cells |
  | New since last scan | "new" tag beside the participant id |

- **Margins:**
  - Derivative status per participant (fMRIPrep, MRIQC, FreeSurfer). Blank
    means present and current; only missing, partial and stale states are
    drawn.
  - Mean FD for each session, computed as the mean of that session's runs,
    with labelled ticks and the threshold dashed. Dots are hollow for
    acquisition groups whose FD is not directly comparable (different
    TR/multiband, unfiltered).
- **Column totals** sit under a rule, labelled "runs present, of N".

### Images (contact sheet)

- Shows the same slice, window and series for every subject-session: mean
  EPI, T1w, b0 or tSNR map.
- Sort by matrix order, tSNR or FD.
- A white outline marks a quality outlier and a grey hairline marks an
  acquisition variant. Selection is a filled tile with an inverted label.
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
  group analysis = not excluded, FD ≤ 0.25, fMRIPrep current".
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
3. **FD trace over the carpet plot**, on one time axis.
   - The source is named: "FD (Power) · fmriprep 24.1.1 confounds".
   - The mean shown is the mean of the drawn trace.
   - Also shown: the count of frames over the 0.5 mm censoring line, and an
     "unfiltered" caveat where it applies.
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
   - Timeline with a legend.
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
- Excluded runs show as struck cells, and every count updates from the same
  model. This needs a test.

### Scale and scanning

- **At hundreds of participants:**
  - Rows compress to 2–3 px, with a 16 px focus band (graduated) around the
    selection. Sparklines appear only in the band.
  - Present runs stay near-background, so the faint-for-normal rule holds at
    density.
  - Errors keep a shape that survives at 3 px, not just a hue.
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
3. The default exclusion criterion is mean FD > 0.25 mm (Parkes et al. 2018,
   stringent) and can be edited. 0.5 mm is described only as a per-frame
   censoring line.
   - Offer a censoring-fraction criterion alongside it (frames over 0.2 or
     0.5 mm).
   - State whether excluded runs count toward session means.
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

## Implementation notes from round 3 (non-blocking)

- Stop scroll containers from showing half rows at the bottom; snap to whole
  rows or fade.
- Wrap the TSV and JSON previews in the exclude dialog.
- Make variant outlines one step lighter than shown in round 3.
- Use one family (sans or mono) for count labels in panel headers.
- Export a saved lens as a participant/run list (TSV or a BIDS filter file)
  for fMRIPrep and FitLins.
