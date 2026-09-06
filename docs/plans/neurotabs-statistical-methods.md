# NeuroTabs statistical methods

Delivery D2, 2026-09-06, built on `b38f66f2`.

## What this increment delivers

A researcher chooses a statistical method in the existing Population **Statistical question** disclosure. One-sample and Welch share participant/feature declarations, linked channel selection, the original focused observation, and Freeze discovery. Welch uses the working selection as A and the current reference as B. A/B descriptive arrangements remain available and pause the statistical question. Applying a question returns to Inspect. Focusing an observation changes neither operand.

The framework now describes methods and their output families explicitly. Welch is the first independent-group estimator, not the organizing principle for future statistical work. Paired effects, fitted models, robust estimators and resampling require their own statistical contracts.

## One shared catalog, typed execution

[`methods.json`](../../core/field_table/src/population_inference/methods.json) is consumed directly by Rust and the frontend. Each built-in entry declares an ID/version, input design, accepted feature roles, minimum participant count, explanation/estimand, default channel, and channel descriptors. Each channel has a stable ID, label, scale behavior and fixed export filename; optional scale hints name a population count or an initial display limit.

There is no universal five-map result. One-sample produces effect/SE/t/df/count; Welch produces effect/SE/t/df/countA/countB. Native result channels form a keyed family. The UI validates the exact declared family and checks that the displayed raster equals its selected channel. Channel labels, color-scale behavior, initial limits and export artifact lists come from the catalog. Warm channel changes reuse the completed family within the existing one-second source-validation lease. Arrays remain outside Zustand and do not allocate GPU volume layers.

The catalog describes capabilities; it does not run arbitrary code. Rust `Method` dispatches to typed estimator payloads. Current adapters consume participant-reduced local moments. `Inputs` is exhaustive: adding another design forces native readiness handling. Unknown methods, unsupported channels and changed saved method contracts fail explicitly.

To add a method:

1. Define its input design and estimand. Reuse marginal moments only if they contain the information the estimator needs. A paired method must form per-person differences on jointly valid support; regression needs a validated design matrix, outcomes and rank/missingness policy; resampling needs its exchangeability and randomness contract.
2. Add a typed specification/adapter and estimator, with independent numerical evidence. Method-specific parameters belong in a validated typed variant, not an unrestricted JSON parameter bag. The present shared null/role/units fields describe the two implemented mean questions; they do not promise to express every future model.
3. Declare its channels and presentation metadata in the shared catalog, and extend the compile-time method/channel IDs. A result need not have a t statistic, SE, p-value or a single df map. Add any genuinely new input controls; the channel picker, renderer and artifact pipeline remain shared.
4. Pin the method contract/version in saved records, and add input/refusal, live/export/replay and UI acceptance tests. Retain an old evaluator or explicitly refuse an unsupported saved version; never silently reinterpret it as the newest implementation.

This is a built-in extension mechanism, not an external statistical-plugin API. It retains the current Brainflow stores, service ownership and native source/render contracts.

## Welch contract

Both groups require declared comparable effect estimates, units, an explicit null difference, participant identities and declared independence. Each group must contain at least two participants overall. Repeated rows require the existing explicit within-person mean or single-row rule. A participant ID may occur in only one operand, even when their observation IDs differ. Descriptive overlap remains allowed outside inference.

At each location, finite within-person means are equally weighted. Effect is `mean(A) − mean(B) − null`. SE combines the two sample variances divided by their respective local counts; df uses Welch–Satterthwaite. [NIST documents this unequal-variance formulation](https://www.itl.nist.gov/div898/handbook/eda/section3/eda353.htm).

The implementation combines standard errors with `hypot` and computes df from normalized variance contributions, avoiding raw fourth powers of signal units. A group with one local value still contributes its mean to the descriptive effect difference, but SE/t/df are unavailable. One constant group is allowed when the other has positive variance. If both are constant, SE is zero and t/df are unavailable. Missing values never become measured zeros. Count A and count B remain separate; their sum is not presented as a contrast sample size. Outside support both count channels are unavailable; an all-missing group inside support has count zero.

Independence, comparable effect meanings and adequate alignment remain researcher assertions. These calculations supply no p-values, multiplicity correction, mixed-effects fitting or automatic participant exclusions. Map-derived groups remain exploratory; freezing does not make their construction independent of the displayed test.

## Persistence and resource bounds

Welch writes a v4 record with the exact method descriptor/version, executable A/B membership, participant partitions, null/role/units/channel and frozen source/frame/mask identities. Its ten NIfTI artifacts are summary, A coverage, six declared method channels, B mean and B coverage. These ten float32 output vectors share the existing 128 MiB output admission limit. Block scratch and source caches remain separately bounded. This is not a whole-process memory guarantee.

Opening verifies all artifacts and refuses a mismatched method contract. Strict replay recalculates all ten. Existing v1/v2 descriptive and v3 one-sample records remain supported; legacy v3 records without a descriptor retain their original known method interpretation. Source images remain external and hash-verified.

## Evidence and remaining work

- Analytic unequal-variance example, an independent R `stats::t.test` reference, A/B reversal with null reversal, scales from 1e-20 to 1e20, and translated data with a tolerance propagated from f64 mean rounding through SE.
- Local missingness, one/both constant groups, insufficient counts, unsupported method/channel refusal and catalog consistency.
- Native NIfTI live/export/replay verification, separate A/B count maps, changed sibling rejection, changed contract/version rejection, and overlap refusal for different observations of the same person.
- UI readiness, paused descriptive comparisons, channel-family validation, focus preservation, freeze/reopen and narrow-screen visual QA.

Verification: **7 kernel tests** and **33 native population slice/export tests** pass (2 existing ignored native tests); **176 UI tests** are covered across the 27-suite run and focused repeats. The broad UI run had one 5-second crosshair timeout under host load; that entire 6-test component suite passed unchanged in the focused rerun, together with the affected services. The new restore case also passes. **11 Playwright workflows** pass in one final run, with desktop and 480 px screenshots inspected. The browser fixture was corrected to serialize unavailable values as native `null` and to reopen its exported receipt instead of an unrelated default fixture; production validation was not loosened.

Workspace Clippy, TypeScript, scoped ESLint, formatting and the unchanged 117-command permission inventory pass. Clippy reports existing api-bridge/parcel-overlay and ts-rs warnings. The full native workspace test was attempted but interrupted after incremental dependency-graph file errors; two attempts to authorize its non-incremental GPU-enabled rerun timed out in automatic permission review. Full-workspace GPU verification is therefore **not established for D2**. The final focused native run and workspace Clippy use two build jobs and disabled incremental compilation. No GPU/render code was changed.

Receipts: `/private/tmp/neurotabs-welch-{kernel-final,native-final,ui,ui-final-focused,restore-final,clippy,types-final,lint-final,permissions}.log`; visual artifacts and its complete log are under `/private/tmp/neurotabs-welch-playwright-final-pass/` and `/private/tmp/neurotabs-welch-playwright-final-pass.log`. The final browser ownership audit was clear and the session-owned browser installation was removed. Native desktop acceptance and end-to-end latency distributions remain separate from the synthetic browser harness. Next statistical work is a paired-input adapter, followed by broader typed design/feature metadata. Grouped/faceted/time-course plotting remains delivery E.
