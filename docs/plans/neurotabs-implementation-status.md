# NeuroTabs population exploration: implementation evidence

Objective: implement [the complete population exploration plan](neurotabs-population-exploration.md), including its linked plotting extension. This ledger records evidence and outstanding work; it does not replace or narrow that plan.

## Current delivery

The first backend increment supplies reusable, equally weighted descriptive reductions in [`field_table::population`](../../core/field_table/src/population.rs). `FieldMoments` accepts finite measurements with optional validity masks and exposes local eligible/valid counts, mean, sample SD, mean absolute magnitude, cancellation and sign counts. Empty selections produce unavailable values. Spatial blocks and disjoint observation-block merges share the kernel. Numerical arrays remain outside frontend state.

Existing [file materialization](../../core/field_table/src/materialize.rs) now uses centered f64 moments and local denominators. Mean-only streaming uses compact mean/count storage; role reductions use blocks of 16,384 locations for numerical scratch. The existing role-loader still retains decoded input arrays, and z-score export still holds full-grid moments. These are not certified memory-bounded live-evaluation paths.

The SD reducer now exports sample SD with `ddof=1`. Existing descriptive z-scores retain `ddof=0`, use cohort moments computed before rounding the exported mean, and become unavailable at zero dispersion. This is not a group t-test. Output manifests state the observation unit and numerical/missingness conventions; manifest version 2 invalidates earlier cached calculations. Volume reductions check affine compatibility in addition to dimensions. Matching grids do not prove anatomical alignment.

## Requirements ledger

The next frontend increment extends the existing Studio store with explicit working membership, fixed/complement reference semantics, pinned/hover probes, relationship-fit identity and bounded working-selection undo/redo. Eligibility is derived separately from list search, issue highlighting and sorting. Metadata filters now refuse incomplete or ambiguous keyed rows, and the strip reports the context issue. Search preserves the focused person even when hidden from the list; valid eligibility changes reconcile focus, including clearing it for an empty context. Bootstrap resets these definitions atomically and advances an import generation. This does not yet provide source-content revisions, a live summary/plot query identity or UI controls for the new selection/reference operations.

| Plan area | Current evidence | Remaining before acceptance |
|---|---|---|
| M0: state separation | Existing store extended with context resolution, explicit working membership, fixed/complement references, pinned/hover probes, relationship identity and selection undo/redo; search/focus/filter regressions covered | Live query identity, control wiring and complete cross-view transition checks; participant semantics and persisted history |
| M0: scientific input contracts | Volume export now checks dimensions and finite, nonsingular matching world affines | Audited participant identities, feature roles/units, immutable source revisions, declared support/mask adapters, strict duplicate/ambiguous input handling |
| M0: sampling/plot contracts | Existing `SampleFrame` and `PlotSpec` inspected | Versioned tidy samples with full observation/participant/source/probe identity, units, validity, axis semantics and explicit live/saved bindings |
| M0: baseline and fixtures | Analytic 80-observation numerical populations and independent batch oracle added | Importable audited 80-map fixture, spatial displacement/noise/repeated-measure cases, native app latency and memory baseline |
| M1: reductions | Finite/masked means, sample SD, cancellation, sign counts and coverage kernel; legacy export integration | Live renderer-native result handles; incremental selection updates/removals and rebuild policy; view/export equivalence |
| M1: population lens | Existing Studio shell and member display inspected | Simultaneous live mean/focused original, all-person plot, pinned probes, linked focus/brush, synchronized cutouts, regional ordering, preview-without participant |
| M2: fluid sets | Existing folder switching and resident-image-set primitives available; working-membership set algebra and bounded undo/redo added | Stable fitted order, cached scrubbing/movie, montage transitions, explicit similarity/factor groups, selection controls and reversible presentation history |
| M3: typed comparisons | Descriptive legacy z-score clearly separated from sample SD | One-sample/Welch/paired estimators, effect/SE/t/df/count outputs, valid pairing and input-role checks, exploratory provenance and frozen recipes |
| M4: relationship explanations | No new implementation | Context-fixed MDS/PCA, fit quality, regional refits, spatial distance attribution and explicit observed/reconstructed views |
| M5: breadth | Numerical kernel is independent of geometry | Audited parcel/surface adapters and identity, robust summaries, pivot views, validated model adapters and larger-set evidence |
| P: linked plot authoring | Existing grammar pipeline remains the integration boundary | Hover/pin workflow, multiple sets/probes, trajectories and real temporal axes, grouping/faceting/layers, defined bands, cached regrouping, saved recipes/export |
| Performance/resource contract | Kernel supports spatial blocks; accumulator reports owned heap bytes | End-to-end p50/p95/p99, exact visible-support evaluation, source/reduction/GPU budgets, teardown/cancellation, stale-publication checks, cold/remote/pressure tests |
| Scientific and interaction acceptance | Numeric shared/opposing/minority examples, masks, large offsets, scaling and partition checks | Complete plan fixture matrix, independent inference evidence, native walkthrough and interpretation evaluation |

## Verification receipts

- Before implementation, three reducer regressions failed: valid values were lost to global missingness, SD used the wrong denominator, and finite float32 inputs overflowed accumulation. Local receipt: `/private/tmp/neurotabs-population-red.log`.
- [`population_moments.rs`](../../core/field_table/tests/population_moments.rs) compares streaming/block results against closed-form examples and an independent two-pass centered calculation. It checks missing versus zero, sample counts, inclusive near-zero endpoints, translation at large offsets, signed scaling, order changes, atomic rejection and bounded spatial scratch.
- Materialization regressions in [`lib.rs`](../../core/field_table/src/lib.rs) exercise actual NIfTI outputs, stale calculation-cache invalidation, undefined standardized values, and rejection of equal-size grids with different world affines.
- Final focused suite: `cargo test -p field_table` passed 55 tests (47 unit, 8 integration), with no ignored tests. Receipt: `/private/tmp/neurotabs-population-tests.log`.
- Native workspace unit/integration run: 786 passed, 27 ignored, including GPU lifecycle tests, render goldens and shader contracts. The sandboxed attempt could not obtain an adapter. The native run's final rustdoc phase encountered crate-metadata resolution errors after overlapping Cargo builds; a subsequent serial `cargo test --workspace --doc` completed successfully (18 doc-test suites, zero examples). These are separate receipts, not one clean invocation: `/private/tmp/neurotabs-workspace-tests-native.log` and `/private/tmp/neurotabs-workspace-doctests.log`. The final focused suite additionally covers the affine-validation test and lint cleanup added during this run.
- `cargo clippy --workspace --all-targets` completed with warnings. After fixing both warnings introduced in this increment, `cargo clippy -p field_table --all-targets --no-deps -- -D warnings` passed. Receipts: `/private/tmp/neurotabs-clippy.log` and `/private/tmp/neurotabs-population-clippy.log`.
- `cargo fmt --all -- --check` passed; scoped diff whitespace and local documentation links also passed. Kernel and export results do not establish UI or end-to-end performance acceptance.
- Population-state increment: 93 tests passed across 10 Studio import/store/service/component suites, including 23 focused state/coordination/strip tests. Receipt: `/private/tmp/neurotabs-state-regression.log`. Ran the installed Vitest binary from `ui2` with `NODE_OPTIONS=--no-experimental-webstorage` (the shell lacked `pnpm`, and the Node experimental storage global interfered with jsdom in the initial invocation).
- `ui2/node_modules/.bin/tsc -p ui2/tsconfig.app.json --pretty false` and ESLint over the 11 changed TypeScript source/test paths passed. Receipts: `/private/tmp/neurotabs-state-typecheck.log` and `/private/tmp/neurotabs-state-lint.log`. No native visual or linked-plot acceptance is claimed for this state increment.

## Next implementation path

Complete source/probe query identity over the new Studio state boundary. Replace unbounded path-only sampling caches with bounded revision-aware source ownership; make temporal extraction explicit. Add live field evaluation over the shared reductions, then wire the M1 mean/focus/probe/value-plot path. Preserve the complete M0–M5 and P scope while delivering and verifying these increments.
