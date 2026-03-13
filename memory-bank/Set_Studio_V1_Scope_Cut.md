# Set Studio V1 Scope Cut

**Status:** Implemented in code; manual smoke pass pending  
**Date:** 2026-03-09  
**Depends on:** [Set_Studio_PRD.md](/Users/bbuchsbaum/code/brainflow2/memory-bank/Set_Studio_PRD.md), [Set_Studio_Implementation_Plan.md](/Users/bbuchsbaum/code/brainflow2/memory-bank/Set_Studio_Implementation_Plan.md)

## Goal

Prove one killer workflow:

`import aligned volume set + design table -> audit join/alignment -> filter/sort -> save cohort -> compare current vs cohort mean/z-score -> drill to contributing members -> inspect provenance`

If this loop feels clearly better than the current viewer + spreadsheet + stats-tool split workflow, Set Studio earns the right to expand.

## Must Ship

- Import an aligned volume-backed field set plus design table.
- Show a trust-first ingest audit:
  - matched rows
  - unmatched rows
  - duplicate keys
  - alignment/support status
- Open Set Studio as a first-class Brainflow workspace.
- Browse members in a Deck workflow with sorting and filtering.
- Save and reuse simple cohorts.
- Compare current member against a saved cohort with:
  - cohort mean
  - current-minus-cohort residual
  - current-vs-cohort z-score
- Drill any cohort summary back to the contributing members.
- Show provenance in the workspace for every visible comparison result.

## Must Not Ship

- Pivot Matrix
- Atlas Lens
- Surface-backed datasets
- Matched cohorts
- Region-driven hotspot explanation
- Statistical summarizers beyond the basic compare workflow
- Full exportable recipe system
- Broad plugin or operator marketplace work

These remain valid design targets, but they are not part of the first shipped proof.

## Later

- Pivot Matrix as the first major expansion after the proof loop
- Atlas-linked summaries
- Surface-backed field sets
- Matched-cohort workflows
- Statistical summarizers such as t-tests and beta/SE meta-analysis
- Explain This Hotspot
- Exportable portable recipes

## Product Rule For V1

The model may support more than the UI exposes.

That means:
- the domain model should stay compatible with future lenses and summarizers
- the shipped UI should teach only a small number of concepts
- V1 should optimize clarity, trust, and speed over breadth

## Success Metrics

- Time to first valid ingest audit: under 60 seconds for a prepared manifest or design join.
- Time to define and save a cohort: under 2 minutes for a new user with a prepared table.
- Member-switch latency in Deck for same-grid sets: target under 100 ms perceived switching.
- Compare latency for current vs cohort mean/z-score on a warm cohort: target under 1.5 s.
- Drill-through latency from visible compare result to contributing members: target under 500 ms.
- Provenance visibility: user can answer “what am I looking at?” without leaving the workspace.

## V1 Acceptance Test

1. A user imports a study manifest and design table.
2. The app shows join and alignment audit results clearly.
3. The user filters to a subgroup and saves it as a cohort.
4. The user selects a member and opens Compare.
5. The user reads mean, residual, and z-score views against the saved cohort.
6. The user drills from the cohort summary back to the underlying members.
7. The user inspects provenance for the visible result.

If that flow is reliable, fast, and legible, V1 succeeds.

## Implementation Status

As of 2026-03-10, the narrowed V1 workflow is implemented in the app shell and Set Studio workspace:

- Set Studio opens as a first-class workspace in the current GoldenLayout shell.
- NFTab manifest and regex/glob discovery preview flow into a trust-first ingest audit.
- Deck supports image-first member browsing with search, filtering, and table-driven sorting.
- The current visible subset can be saved directly as a cohort or used immediately in Compare.
- Compare materializes and reopens `cohort mean`, `residual`, and `z-score` outputs through the existing file/layer path.
- Cohort summaries drill back to Deck-scoped member browsing.
- Provenance, saved recipes, recent artifacts, and derived-output freshness are visible in the Inspector.

Verification completed in code:

- `pnpm --filter temp-ui exec tsc --noEmit --pretty false`
- `pnpm --filter temp-ui test -- --run src/components/studio/__tests__/DesignPane.test.tsx`
- `cargo test -p field_table`

Remaining close-out step:

- Run a brief manual desktop smoke pass through the full V1 acceptance flow in the live Tauri app.
