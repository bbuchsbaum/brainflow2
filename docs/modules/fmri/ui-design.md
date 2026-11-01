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

## Design at equilibrium

1. **One workspace, six stages.** A spine shows Data, Design, Noise, Contrasts,
   Subject maps and Group, each with a live summary. One Checks list collects
   all warnings, with severity shown by shape and colour.
2. **Select data by query.** Facets cover BIDS entities, sidecars,
   participants.tsv and fMRIPrep confounds. A subjects × runs matrix gives the
   reason for every exclusion: motion, missing events, TR mismatch, or too few
   runs. Space is a facet, so native and surface spaces can reuse the flow.
3. **Model in terms.** Factors are crossed from events.tsv, modulators show their
   centring, and the HRF comes from a gallery of fmrihrf bases. Design health
   (VIF, correlations, per-contrast efficiency) is shown before fitting.
4. **Noise with consequences.** The drift cutoff is compared with task power,
   confound presets show their df cost, and the AR order shows residual ACF
   before and after.
5. **Contrasts on the factor grid.** Each template maps to one fmridesign
   function: `pair_contrast`, `oneway_contrast`, `interaction_contrast`,
   `poly_contrast` or `column_contrast`. Brainflow normalises and run-balances
   the weights and reads them back as a sentence. It flags implicit-baseline
   tests, duplicates (a linear trend over 0/1/2 equals 2 vs 0), inestimable
   contrasts and circular ROI tests. Raw weight vectors are derived and never
   the stored source of truth.
6. **A lens at the crosshair.** It shows observed against fitted signal and an
   interaction plot of condition estimates, with per-run small multiples on
   expand.
7. **Group.** The model sentence is built from participant facets, and the
   default is meta-analytic (`fmri_meta`, REML) using subject SEs. Contributors
   and leave-one-out show at the crosshair. An exclusion is previewed against a
   reference result that is kept.
8. **Provenance.** The recipe round-trips to BIDS Stats Models with
   `x-brainflow` extensions for noise, exclusions and fmrihrf version,
   normalisation and span.

## Module mapping (proposal)

| Contribution | Proposal |
| --- | --- |
| Workspace | `fmri.analysis` tool tab with the spine; maps open into view tabs |
| Layer kind | `fmri.statmap` (base volume): stat type, df, contrast, threshold provenance |
| Dock tabs | `fmri.design` (timeline + strip), `fmri.lens` |
| File formats | events.tsv, desc-confounds_timeseries.tsv, BIDS Stats Model JSON |
| Rust | `core/modules/fmri` crate `bf_fmri`; fits run as provider-style jobs emitting `fmri:fit-progress` |
| Ownership | Fits capture workspace identity and the analysis hash; results from an older spec are marked stale |

## Open questions for the owner

- Should BIDS Stats Models be the native on-disk spec, or an export from a
  `bf_fmri` spec?
- Should the group stage default to `fmri_meta` (REML) rather than OLS on effects?
- Which inference methods are in scope for v1 (cluster FWE by permutation, FDR,
  TFCE), and at what compute cost?
