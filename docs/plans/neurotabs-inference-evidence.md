# NeuroTabs one-sample inference: delivery D1

2026-09-06, built on `29289548`. This implements the first complete statistical workflow in [delivery D](neurotabs-next-delivery-plan.md): a one-sample question about declared participant effects. Welch and paired comparisons remain the next increment; D and the full roadmap are not complete.

## Using it

In **Analysis unit**, declare participant identity and choose one selected row per person or an explicit mean of selected rows within each person. In **Statistical question**, declare that the feature contains comparable effect estimates, give their units and a null value, and declare participant independence. These are researcher assertions; Brainflow cannot establish them from filenames or voxel grids. Unknown, t/z, uncertainty and label roles remain descriptively viewable but are refused for this test.

**Apply one-sample test** opens the existing Inspect arrangement with the effect relative to the null beside the focused original. The normal Summary control becomes a Channel control, synchronized with the question disclosure. Effect, standard error, t, degrees of freedom and valid participant count belong to one result family. Focus remains independent of selection. Selection and temporary exclusion change the tested population; local participant counts remain explicit. Factor/group and A/B arrangements stay descriptive and visibly pause this one-sample question.

**Save calculation → Freeze discovery…** saves every test channel, the selected channel, null, declared role/units, participant partition, source/frame/mask identities and exploratory origin. Inputs remain external and hash-verified; the bundle does not contain original source images. Reopening restores the executable question and channel. A freeze records an exploration; it does not make a map-derived selection independent confirmation.

## Statistical contract

For locally valid participant effects, the outputs are:

| Channel | Definition | Unavailable cases |
|---|---|---|
| Effect | Participant mean minus declared null | No valid participants |
| Standard error | Sample SD divided by square root of local count | Fewer than two valid participants |
| t | Effect divided by SE | Fewer than two valid participants, zero SE, or non-finite result |
| df | Local count minus one | Fewer than two valid participants |
| Count | Locally valid participants | Outside spatial support |

The formula follows [NIST's one-sample test](https://www.itl.nist.gov/div898/handbook/eda/section3/eda352.htm). Student-t calibration has distributional and independence assumptions; no p-values, thresholds or multiple-comparison correction are supplied here. Observed zero remains valid. An all-missing voxel inside support has count zero; mask-excluded voxels are unavailable. Mean-within-person reduction uses that person's locally finite rows before equal weighting of people. This does not estimate a mixed-effects model or separate measurement error from population variation.

`field_table::population_inference` consumes the existing f64 centered moments. Float32 output channels become unavailable when not representable as finite float32. A constant sample retains its effect, zero SE and df, while t is unavailable. At least two declared participants are required for the overall operation, even though local coverage can be smaller.

## Shared computation, persistence and lifecycle

`PopulationSliceRequest.inference` is an optional executable specification. Native readiness checks reject non-effect roles, missing units, non-finite nulls, undeclared independence, absent/invalid participant groups and incompatible descriptive A/B/group requests. Existing exact membership, source/frame, grid, mask and cancellation checks still apply. No new bridge command or GPU layer is introduced.

The native slice result retains all five channels outside interface state. `PopulationSliceService` can switch a completed channel without native resampling within the existing one-second source-freshness lease. Expiration returns to native validation. Changed selection, null, grouping, support or source bindings invalidate reuse. The selected raster must equal its corresponding companion array. Effect uses compatible effect units/scales; t has its own diverging scale (initial limit 5), while SE/df/count have independent nonnegative scales.

Live and full-grid export call the same estimator. V3 bundles contain `summary.nii.gz` (the selected channel), `coverage.nii.gz`, and `effect.nii.gz`, `standard-error.nii.gz`, `t.nii.gz`, `df.nii.gz`, `count.nii.gz`, plus provenance. Seven float32 output vectors share the existing 128 MiB export admission budget; block scratch admission accounts for the extra channels. Decoded sources, masks, IPC/bitmap objects and writer scratch have separate owners/budgets. This is not a whole-process RSS bound.

V1/V2 descriptive bundles remain supported. Opening validates frozen sources and every artifact; strict replay additionally recomputes and checks all seven artifact hashes before publication. Ordinary opening does not recalculate the statistical maps. Executable inference provenance takes precedence over descriptive context when restoring selection origin. Role/unit declarations currently belong to the question; general imported feature-role metadata is future work.

## Evidence

- Pure estimator checks cover analytic means/SE/t/df, an independent batch oracle, reversed observation order, signal scales from 1e-20 to 1e20, large offsets with a shifted null, missingness, zero variance, insufficient local counts, invalid roles/units/independence and duplicate participants.
- The vendored [NIST ZARR13 observations](../../core/field_table/fixtures/population/ZARR13.DAT), obtained from [NIST's dataset](https://www.itl.nist.gov/div898/handbook/datasets/ZARR13.DAT), provide an offline reference (line endings and trailing whitespace normalized; all observation text retained). On float32 inputs, a separate Python `statistics` batch calculation gives t = 2611.283864062065 against null 5; the published reference rounds to 2611.284. Using only the page's rounded mean/SD initially failed; the test now uses all 195 raw observations rather than loosening its tolerance.
- A native NIfTI test compares live and full-grid channels, checks zero/one/three valid-participant locations and zero variance, verifies equal participant weighting after repeated-row means, replays the seven-artifact bundle and refuses a changed t sibling while summary/coverage are untouched.
- UI tests cover readiness, focus/selection separation, map-derived origin, channel-family consistency, cached switching/freshness expiry and restoring executable settings ahead of cosmetic context.
- Playwright exercises declaration refusals → participant configuration → test → channel/focus switching → freeze → reopen → descriptive view. All prior population export, mask, movie, montage, A/B and similarity paths are included. Desktop and 480 px screenshots were visually inspected. The harness uses real components/stores with explicitly simulated IPC/dialogs; native numerical and browser evidence are separate.

The final UI pass has **173 passing tests in 27 suites**, with existing timeout-sensitive interactions run serially and unchanged assertions/timeouts. Playwright has **10 passing workflows** plus a final focused repeat. TypeScript, scoped ESLint, formatting and the unchanged **117-command** permission inventory pass. Browser ownership audits were clean after QA; the session-owned browser installation was removed. The full native workspace run passes **842 tests, zero failures, 29 ignored**, including GPU tests with adapter access. The initial sandbox-only run could not acquire a GPU adapter; the authorized full rerun passed. Workspace Clippy passes with existing warnings in `api_bridge/lib.rs`, `parcel_overlay.rs` tests and ts-rs attribute parsing; no new inference warnings were reported. Local receipts use `/private/tmp/neurotabs-inference-*.log`; browser artifacts are under `/private/tmp/neurotabs-inference-playwright-final/`.

## What follows

Complete delivery D with disjoint-participant Welch comparisons and explicit paired A/B participant differences, each with independent numerical/persistence evidence. General feature-role/units import contracts, native desktop acceptance and end-to-end latency distributions remain open. Delivery E retains grouped/faceted/time-course plotting; delivery F retains attribution/components, retained/relocated inputs and parcel/surface population support. Nothing in D1 treats a pair of group-average images as participant-level evidence.
