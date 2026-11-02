# fMRI analysis module: UI design (hill climb, 2026-11-01)

Status: design only. Nothing here is implemented. The module system it targets
is planned in [module-architecture.md](../../plans/module-architecture.md).

The prototype is `ui-hillclimb.html` in this folder. It is self-contained: open
it in a browser and click stages, contrast cells, HRF bases and filters. A
private claude.ai artifact mirrors it for review. It uses synthetic data (an
n-back study with 28 participants) and synthetic statistical maps drawn on the
MNI152NLin2009cAsym template from `test-data/unit`.

## Scope

The module takes a preprocessed BIDS derivative (fMRIPrep, MNI space for now) to
single-subject and group contrasts. The engine is a planned idiomatic Rust port
of the R packages fmrihrf, fmridesign and fmrireg (`bf_fmri`).

## Method

There were five rounds. Four simulated critics scored each round from 0 to 10:
Steve Jobs (focus), Edward Tufte (data-ink, integrity), Russ Poldrack
(scientific validity, reproducibility) and a Linear designer (speed, keyboard,
consistency). The personas apply each person's published lens. Their scores and
remarks are model judgements, not those people's views.

Disagreements were settled by majority, with Claude breaking ties.

Stopping rule: stop when the mean gain for a round is below 1 point and no
outstanding proposal wins 3 of 4 critics.

| Round | Theme | Mean |
| --- | --- | --- |
| 1 | Conventional wizard (baseline) | 3.38 |
| 2 | Show the data: facets, run matrix, design matrix | 5.50 |
| 3 | Contrasts by meaning: factor grid, readback, spine | 7.00 |
| 4 | Diagnostics and keyboard: VIF, efficiency, recipe, ⌘K, contributors | 8.13 |
| 5 | Equilibrium: one Checks list, quieter chrome, reference vs preview | 8.85 |
| 5′ | Round 5 re-scored after the owner's notes (below) | 6.58 |
| 6 | Integration and the whole model: viewer modes, HRF studio, full design, confounds | 8.00 |
| 7 | Within and between: contrasts as questions, scope-driven second level, test matrix | 8.85 |
| 8 | Consistency and ecosystem: one view header, stale maps, Brainflow contributions | 9.15 |
| 8′ | Round 8 scored by the three new reviewers (Bostock 7.4, Albers 6.8, Bauhaus 7.6) | — |
| 9 | Colour, motion, grid and neighbours (seven reviewers, 4 of 7 to adopt) | 9.11 |

### Round 9: new reviewers (2026-11-01)

The owner added Mike Bostock, Josef Albers and a Bauhaus panel (Herbert Bayer,
László Moholy-Nagy, Marcel Breuer) to review function, aesthetics and flow, and
asked that the design stay aware of how the module works alongside NeuroTabs.
Adopted:

- **Colour roles (7 of 7).** Warm and cool mean only positive and negative
  statistics. Stimulus categories use their own hues (violet and teal, with
  lightness for load). Contrast sides are told apart by form: solid versus
  hatched. The selection frame is a neutral light edge, not amber, when it sits
  next to map colour.
- **Motion (5 of 7).** Data changes only, at most 200 ms, and off under reduced
  motion. Changed values tween and are marked once.
- **One column grid (5 of 7).** The side columns are 248 px and 304 px, with a
  flexible centre, and there is one less level of nested containers.
- **Peak labels on group slices (4 of 7).** A toggle; labels show cluster number
  and t, not anatomical names.
- **Linked selection.** A subject selected in Group is highlighted in Data and
  Subject maps.
- **Next-step bar.** Each stage ends with one forward action.
- **NeuroTabs, both ways (7 of 7).** Send subject maps as an image collection,
  and use a NeuroTabs cohort as a data facet, with a circularity check.

Not adopted (3 of 7): full linked brushing across every view. Design ↔
timeline brushing heads the backlog.

### Owner notes after round 5 (2026-11-01)

The owner asked for:

- integration with the main Viewer, for slices and surfaces;
- feedback on HRF shape and on how it changes the design;
- the full design including nuisance regressors;
- auto-detected fMRIPrep confounds;
- single-subject, one-group and multi-group analyses;
- excellent within-subject contrasts, with no R function names in the interface.

Round 5 was re-scored against these requirements, and the climb ran three more
rounds.

### Recorded decisions

- **Design matrix stays (3 of 4).** It is a strip that shares the time axis with
  the event timeline. It is never the main control.
- **The recipe is visible on demand (3 of 4).** It is a BIDS Stats Model side
  panel (⌘/), kept in sync in both directions and closed by default.
- **Per-run estimates are progressive (3 of 4).** One summary is shown in the
  lens, and small multiples open when it is expanded.
- **Rejected:** choosing the HRF automatically by fit, since that is a researcher
  degree of freedom; a formula editor as the main input; glass-brain views in
  place of slices.
- **Deferred (2–2, tiebreak):** an optional "Lock analysis" before group
  results. It goes in the v2 backlog, with its timestamp shown in provenance.
- **Confound families (3 of 4).** Each family shows a count, a sparkline and its
  task correlation, and expands to its columns. The alternative was showing all
  312 columns.
- **Custom weights (2–2, tiebreak).** Allowed only from the recipe pane. They are
  flagged in Checks and shown with their picture.
- **Deferred:** residual maps as a plot mode, and power estimates from pilot
  effect sizes. **Rejected:** vim keys, and hiding the recipe button.

## Design at equilibrium (round 9)

1. **One workspace, six stages.** A spine shows each stage with a live summary
   and carries an analysis scope selector: single subject, one group, or
   several groups. One Checks list collects warnings, with severity shown by
   shape and colour.
2. **Select data by query.** Facets cover BIDS entities, sidecars,
   participants.tsv and fMRIPrep confounds. The run matrix gives the reason for
   every exclusion. Space is a facet.
3. **The whole model, visible.** Terms are crossed from events.tsv. The HRF
   studio overlays the new basis on the old one and shows the effect on a real
   regressor, on the number of columns, on residual df and on each contrast's
   efficiency. The full design shows every column, including per-run nuisance
   blocks, on one time axis with motion and FD traces and hover values.
4. **Confounds detected, not typed.** `desc-confounds_timeseries.tsv` is found
   for every run and grouped into families. Presets include 6P, 24P, 36P,
   aCompCor and spike regressors. Each family shows its df cost, a sparkline and
   its task correlation. fMRIPrep cosines that duplicate the drift model are
   left out, and non-steady-state volumes are modelled automatically.
5. **Contrasts are questions.** The question types are: compare two levels,
   trend, any difference, difference of differences, slope, and against
   baseline.
   - Each reads as a sentence whose tokens are factor levels.
   - The sentence stays in sync with the cell grid, where rows and columns are
     clickable, and with a typed shortcut ("load 2 > 0").
   - A picture draws the comparison on the cell estimates. An overlap matrix
     exposes duplicates.
   - Weights are a derived readout you can open. No function names appear in the
     interface; the engine maps each question to an fmridesign contrast
     internally.
6. **One scene, two rooms.** The inline viewer shows the same layers and
   crosshair as the main Viewer.
   - **Expand** fills the analysis tab and collapses the spine.
   - **Open in Viewer** moves the maps there as `fmri.statmap` layers, with an
     "fMRI contrast" Inspector section and an "fMRI fit" Plot-dock mode.
   - **Slices / Surface** shows maps projected onto fsLR, labelled as a
     projection.
   - Maps from an older spec are marked stale everywhere, with a refit action.
7. **Scope drives the second level.** A single subject combines runs with fixed
   effects. One group and several groups use a meta-analytic model built from
   participants.tsv. A test matrix crosses within-subject contrasts with
   between-subject tests (group means, patient − control, age). Contributors
   and leave-one-out show at the crosshair, and exclusions are previewed against
   the kept reference.
8. **Provenance.** The recipe round-trips to BIDS Stats Models with Brainflow
   extensions. Outputs are written as a BIDS derivative.

## Across modules: neighbours, not dependencies

The module must work alone. Where its work overlaps with another module, the two
cooperate through typed values that core owns, never by importing each other,
which the module system forbids. A handoff appears only when a module that can
take it is enabled, and it carries value role, units, space and provenance.

| Exchange type | Use |
| --- | --- |
| ImageCollection | fMRI → NeuroTabs: subject effect maps with SE and a participant table, opened as a population. A live link marks the NeuroTabs view stale on refit. |
| Cohort | NeuroTabs → fMRI: a working selection becomes a data facet. The module checks for circular selection (a cohort chosen using the same contrast). |
| Region | NeuroTabs or segmentation → fMRI: an ROI for ROI-level fitting and the lens, with the circularity check. |
| Layer | fMRI → Viewer: statmap layers with provenance and stale state. |

The manifest would declare `contributes.exchange: { produces: ['ImageCollection', 'Layer'], consumes: ['Cohort', 'Region'] }`.
Core lists matching modules, and handoff actions use one vocabulary: "Send to …"
and "Use … from …". This needs a core `ctx.exchange` capability, which is not
yet in the module architecture plan.

## Module mapping (proposal)

| Contribution | Proposal |
| --- | --- |
| Workspace | `fmri.analysis` tool tab with the spine; inline viewer shares layers and crosshair with the Viewer |
| Files | “New fMRI analysis” on a BIDS dataset; outputs in `derivatives/brainflow-fmri/` reappear in the tree |
| Layer kind | `fmri.statmap` (base volume): stat type, df, contrast, threshold, spec hash, stale state |
| Inspector | “fMRI contrast” section for statmap layers (question, model, test, n, fitted spec, Open in analysis, Refit) |
| Plot dock | “fMRI fit at crosshair” (the lens) and “Event-related average” plot modes |
| Surfaces | Surface/Integrated display modes show volume maps projected to fsLR/fsaverage, labelled as projection |
| Population | Group contributors open in the NeuroTabs population view with the same subjects and region |
| Atlases, ROIs | Atlas layers label the crosshair; segmentation-module ROIs become ROI analyses with the circularity check |
| File formats | events.tsv, desc-confounds_timeseries.tsv, BIDS Stats Model JSON |
| Rust | `core/modules/fmri` crate `bf_fmri`; fits run as provider-style jobs emitting `fmri:fit-progress` |
| Ownership | Fits capture workspace identity and the analysis hash; results from an older spec are marked stale |

## Open questions for the owner

- Should BIDS Stats Models be the native on-disk spec, or an export from a
  `bf_fmri` spec?
- Should the group stage default to `fmri_meta` (REML) rather than OLS on effects?
- Which inference methods are in scope for v1 (cluster FWE by permutation, FDR,
  TFCE), and at what compute cost?
