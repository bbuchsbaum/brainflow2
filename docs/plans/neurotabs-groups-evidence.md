# NeuroTabs group comparison delivery

2026-09-06, built on `490ee757` (movie/montage delivery). This implements the core delivery B path in [the delivery plan](neurotabs-next-delivery-plan.md). It does not complete the overall population/plotting roadmap.

## Available workflow

1. Use a numeric observation range, a horizontal response-plot brush or a rectangular montage brush. Replace, Add, Intersect and Remove submit exact observation IDs once on release/Apply. Escape cancels a pending gesture. Focus remains independent.
2. Name and save the working selection in the Population Inspector. Select a metadata factor to create group mean cards. Blank factor values form an explicit missing-value group; literal `NA` remains a distinct literal level. Four groups are requested per page.
3. Assign a group to A or B. B may also be a named set or the live context complement; pinning the complement freezes its membership. Counts expose observation overlap and participant overlap when identities are declared.
4. Compare A and B at the same world plane and compatible effect scale. Collapse to descriptive mean(A)−mean(B), then expand. This operation is not a t-test. Each operand retains its own local finite counts; neither is an effective contrast sample size.
5. Open a group's contributors as a montage. Browsing its original observations changes focus, preserving A and B. Hold to preview without the focused observation/participant, a named subset or a factor group; release restores the original view and membership. Named subset/group exclusions omit their listed observations, as labeled. Participant exclusion removes all relevant rows for the focused person.
6. Undo factor grouping independently of working-selection history. Export/reopen preserves executable A/B operands, named sets, complete available keyed metadata, partition and bounded partition undo history.

## Implementation and scientific boundaries

The native evaluator reuses its existing bounded all-context sampled plane for A, B and up to four group means. It allocates no observation GPU layers. Each operand independently applies the declared within-participant reduction and then equally weights participants. One observation must identify the same participant across every operand. Difference subtraction uses f64 means before a single float32 output rounding. A location unavailable in either operand is unavailable in A−B. Overlap is permitted descriptively and is never treated as independent evidence.

The UI owns only definitions/IDs and result handles. Group/reference bitmaps share the existing explicit retain/release lifecycle and focus cache. A displayed group retains labels and membership from its completed query while a newer partition loads; an older mean is not relabeled as a pending difference. The result becomes interactive only when it matches the current query.

Comparison bundles use schema `brainflow.population-export.v2`, with `summary.nii.gz`, `coverage.nii.gz`, `reference.nii.gz` and `reference-coverage.nii.gz`. Summary is A's mean or A−B according to the executable operation; coverage is A's local count. Reference artifacts contain B's mean and count. Export/replay retain existing bounds, admission, cancellation, staging and source guards. Replay verifies all four recomputed artifact bytes. Existing v1 summary bundles remain supported. Opening verifies source/artifact integrity; strict replay separately verifies recalculation.

The saved executable reference takes precedence over descriptive cohort metadata. Restored participant metadata must agree with executable A/B identities. Malformed/incomplete partitions are refused rather than silently shrinking membership. Inputs remain external and hash-verified; bundles do not contain source copies.

## Verification

- Native `cargo test --workspace`: **829 passed, 28 ignored**, including four new analytic comparison/export tests and existing rendering/GPU lifecycle gates. Receipt: `/private/tmp/neurotabs-groups-workspace.log`.
- Numeric regressions cover unequal finite coverage, legal overlap, an unavailable B, repeated rows and equal participant weighting, inconsistent participant identity, the four-group admission bound, and subtraction before float32 rounding. A real NIfTI comparison bundle is replayed byte-for-byte across all four artifacts; altered reference bytes are refused without partial publication.
- Focused Vitest: **163 passed in 25 suites**, covering keyed partitions, state independence, subset preview, brush commit/cancel, A/B restoration and bitmap ownership, alongside existing population behavior. Receipt: `/private/tmp/neurotabs-groups-unit.log`.
- Playwright: **8 passed**, including numeric range → saved set → factor groups → A/B → A−B → export/reopen → contributors → subset preview/release → undo grouping, plus actual montage pointer brushing. Existing export/mask/replay/movie checks remain green. Receipt: `/private/tmp/neurotabs-groups-playwright-final.log`.
- Desktop and 480 px screenshots were visually inspected. Artifacts: `/private/tmp/neurotabs-groups-playwright-final/`. The dev harness uses real React components/stores/encoder with simulated numerical IPC, file chooser and export. This is browser interaction/layout evidence, not native Tauri acceptance or real-data visual proof.
- TypeScript and scoped ESLint pass. Workspace Clippy completes with existing api-bridge warnings outside this change. Formatting and the strict command/permission inventory pass (116 commands; no new commands). Receipts: `/private/tmp/neurotabs-groups-{types,lint,clippy,permissions}.log`.

## Remaining work

Native desktop visual acceptance and cold/warm end-to-end latency measurements remain open. Cached plane reuse is implemented; incremental add/remove accumulators with periodic rebuilds are still planned. Visible A/B controls are implemented; drag previews, generalized presentation history and relationship lasso await later deliveries. Similarity/MDS, typed statistical tests, grouped/faceted/time-course plot authoring, input retention/relocation and population surface/parcel support remain in the full roadmap. No new test or inferential claim is attached to data-derived selections.
