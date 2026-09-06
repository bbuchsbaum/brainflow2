# NeuroTabs spatial similarity delivery

2026-09-06, built on `c8ae7cd7` (group comparison delivery). This implements the core delivery C path in [the delivery plan](neurotabs-next-delivery-plan.md). The full population and linked-plotting roadmap remains open.

## Available workflow

Open **Spatial relationships** in the Population lens. Choose effect distance or pattern-shape distance, then explicitly fit the current context. An optional common binary mask constrains support; **Compare maps in pinned region** requests a separate fit within a positive-radius sphere. Moving the probe or changing focus/selection never refits the geometry.

Click or keyboard-focus a point to inspect that original observation. Shift-click/Shift-Enter changes membership. A completed lasso submits exact observation IDs through the existing selection algebra; Escape cancels. Coincident points can represent several observations, so the movie and observation list remain available to inspect each original.

**Order movie by MDS axis 1** freezes the resolved IDs for the existing scrub/play/montage controls. The label identifies its fit; a subsequent refit retains the old order with an “earlier fit” label. Ordering is refused when there is no variation or the leading axes are tied. **Create similarity groups** cuts an average-linkage tree at the requested group count and uses the existing group cards, A/B comparison and contributor montage. Grouping and lasso selections retain their map-derived origin and fit identity; they are exploratory selections, not evidence for independent group tests.

The panel reports support coverage, retained variation in two dimensions and normalized distance stress. A failed fit keeps the previous result explicitly labeled. Changed source revisions prevent new ordering/grouping and prevent exporting that obsolete fit with current data.

## Numerical and resource contract

- Effect distance is the root mean squared voxel difference in original map units. Shape distance spatially centers each map and divides by its Euclidean norm on the common support, then measures Euclidean chord distance. Magnitude is removed only in the latter calculation. A constant map has undefined shape distance and is refused by observation ID.
- All observations use one intersection of finite voxels within the declared mask/region. Missing values are never replaced with zero and support is never chosen separately for each pair. At least two common voxels are required. Without a mask, finite background values participate.
- Grid dimensions and world affines must agree; existing population geometry validation applies. Multi-frame files require an explicit frame. Source/mask snapshot hashes and whole-query file guards accompany the fit. Matching grids do not establish anatomical alignment.
- The exact path admits 2–128 original observations, at most two million candidate voxels, and at most 128 MiB of float32 observation-matrix payload. The source grid is limited to 64 million voxels. A mask/region reduces candidate support before matrix admission. Source-cache residency, support indices, mask bits and numerical scratch have separate ownership; 128 MiB is not a process-RSS guarantee.
- One cancellation-aware native admission permit remains held through active workers. Gram products use 4096-voxel f64 blocks, centered across observations before multiplication. Scaling the Gram matrix before symmetric eigendecomposition protects small/large signal scales. This is classical MDS with deterministic axis sign anchoring; near-tied leading axes refuse first-axis ordering. Exact merge-distance ties use source/node order.
- Average linkage uses the original pairwise distances, not distances read from the 2D plot. Its cut records complete exact-ID groups. Fit quality describes the projection and does not validate a scientific grouping.
- The frontend service owns numerical arrays outside Zustand, retaining at most the current plot fit and the fit used by the movie order. Store state contains identities and definitions. Refit/scope changes cancel pending work; obsolete completions cannot publish into a new context. No observation GPU layers are allocated.

## Persistence

The existing calculation context retains frozen requests, coordinates, distances, eigenvalues, linkage merges and fit/support digests. The fit identity hashes algorithm tag `classical-mds-common-support-v1`, frozen request, grid and support digest. When the movie uses an earlier fit, its numerical result is retained separately. Opening validates both fit structures and source/frame/mask bindings before restoring their coordinates and exact order; incompatible saved orders receive a visible restoration notice. Current and earlier-fit labels remain distinct after reopening.

Native opening verifies source and artifact integrity through the existing bundle reader. It does **not** recompute MDS or prove a descriptive context was numerically unmodified. Explicit refit computes new geometry; strict summary replay continues to verify the executable volume calculation separately. Source images remain external, with hashes; this delivery does not implement retained-input bundles or relocation.

## Verification

- `cargo test --workspace`: **837 passed, 29 ignored**, including the existing rendering/GPU gates. Eight new similarity tests cover independent direct-distance references, analytic line/square geometry, shape scale/offset invariance, opposite patterns, ties, permutation invariance, scales from 1e-30 to 1e30, common support, explicit 4D frames, masks, source mismatch and cancellation. The focused tests passed again after final code cleanup.
- An opt-in native test read the audited 80-map NIfTI fixture with expected input hashes: **32,768 candidate / 9,800 common voxels**, **386.21 ms** fit time, **0.010260** normalized stress and **0.998162** retained variation. Observation-matrix payload was **10,485,760 bytes**. This is one local debug-build fit measurement, not an end-to-end latency distribution or a large-data performance certification.
- Focused Vitest: **169 passed in 26 suites**. New checks cover fixed fits during focus/selection/probe changes, canceled/late completion refusal, stale sources, malformed geometry/linkage, tied-axis ordering refusal, exact-ID lasso commit/cancel, and separate retention of a movie-order fit after refitting.
- Playwright: **9 passed**. The added path covers fit → original focus → selection → frozen movie order → explicit regional refit → groups → export/reopen with both fits → pointer lasso → constant-map shape refusal. Existing mask, replay, movie, montage and A/B paths remain green. Desktop and 480 px screenshots were inspected for clear labels and overflow.
- The browser harness runs real React components, stores and rendering composition with simulated numerical IPC, dialogs and exports. It is interaction/layout evidence, separate from the native numerical fixture and still-needed Tauri desktop acceptance.
- TypeScript, scoped ESLint, formatting and strict command/permission checks pass. The bridge inventory now has **117 commands**, including `fit_population_relationship`; generated API transport bindings were rebuilt. Workspace Clippy completes with existing warnings outside this change.

Local receipts: `/private/tmp/neurotabs-similarity-{workspace,native-final,fixture,ui,playwright,types,lint,clippy,permissions}.log`. Screenshots live under `/private/tmp/neurotabs-similarity-playwright/`; the final full-panel narrow capture and focused repeat are under `/private/tmp/neurotabs-similarity-playwright-final/`. Owned test browsers were closed and the final process audit was clean. Generate the real fixture with `tools/create_population_movie_fixture.py`; see [movie evidence](neurotabs-movie-evidence.md) for its audited inputs and generation instructions. Run its fit gate with `BRAINFLOW_POPULATION_FIXTURE=/path/to/fixture cargo test -p api-bridge relationship_real_fixture_acceptance -- --ignored --nocapture`.

## Remaining work

Native desktop visual acceptance and input-to-visible-image p50/p95/p99 remain open, including sustained browsing, cold/remote reads and resource pressure. The next sequential delivery is D: typed participant-effect inputs, one-sample/Welch/paired results and frozen exploratory provenance. Linked grouped/faceted/time-course plot authoring remains delivery E. Spatial distance attribution, PCA/components and observed-versus-reconstructed views, retained/relocated studies, parcel/surface population adapters and larger-set paths remain delivery F. This delivery does not add inferential testing or silently approximate original observations.
