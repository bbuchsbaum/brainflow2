# NeuroTabs: continuously inspectable populations

**Status:** Proposed product and implementation plan; features below are acceptance targets unless identified as existing.

**Date:** 2026-09-05

**Source baseline:** Brainflow `3382b5e8`; inspected Studio stores, services, field-table materialization, and existing design documents.

**Scope:** Extend NeuroTabs / Set Studio within Brainflow. This document sets the next development priorities; it does not mark the proposed experience implemented.

## 1. Product definition

Build an instrument for exploring populations of brain maps in which every summary remains connected to its observations. A researcher can inspect an average, see the distribution and actual people behind it, reorganize those people, compare groups, and examine sensitivity while retaining anatomical and population context.

Three questions organize the default experience:

1. Is this pattern shared?
2. Who contributes to it?
3. What changes when I inspect a region, a subgroup, or an individual?

The interaction model is **reversible aggregation**. A set can appear as a movie, strip, montage, collection of subgroups, or summary. Every derived result retains its contributing sets and operation. Expanding a result restores those contributors and their arrangement.

The target demonstration is:

> Open 80 subject contrast maps. Inspect their mean beside one person. Pin a broad patch and expand corresponding cutouts across everyone. Order the observations by similarity and scrub through them. Expand the movie into a montage, group related observations, then regroup by an experimental factor. Inspect both groups and their distributions side by side. Choose A−B and switch between the effect and its t-map. Expand the comparison back into its groups, or preview the result without one participant. Anatomy stays stationary throughout.

The product succeeds when this sequence improves understanding of the population, preserves the meaning of each operation, and remains responsive under sustained use.

## 2. Build on the current foundation

The [Set Studio PRD](../../memory-bank/Set_Studio_PRD.md) supplies cohorts, expressions, linked views, and provenance. The [app-mode plan](../../memory-bank/Set_Studio_App_Mode_Plan.md) supplies the shared shell. This proposal changes the expansion priority in the [V1 scope](../../memory-bank/Set_Studio_V1_Scope_Cut.md): the population lens and reversible grouping precede a large pivot matrix.

| Area | Verified foundation | Work this plan adds |
|---|---|---|
| Ingestion | NeuroTabs parsing, manifest/discovery audits, role bindings, support checks in `core/field_table` and Studio import services | Explicit participant unit, feature semantics, revisions, validity and readiness for each operation |
| Selection | `setStudioStore` distinguishes active member, scope cohort, and comparison cohort | Formal state transitions, arbitrary working selections, probe and relationship definitions, reversible history |
| Shell | `SetStudioWorkspace` has a thin center; mode, design and inspector services/components exist | Population summary, focus and population strip available together |
| Comparisons | `StudioCompareService` and `core/field_table/src/materialize.rs` create derived files; `StudioDisplayService` loads their paths into views/layers | Live result handles and slice/region evaluation during interaction; reuse file materialization for export |
| Sampling and plotting | `sample_set_at_world`, `sample_set_trace_at_world`, `SampleProvider`, and the `SampleFrame` → `PlotSpec` pipeline exist | Exact probe definitions, coverage, population distributions, coordinated selection and grouped plots across sets |
| Rendering | Shared viewports, batch readback and bounded resident-image-set primitives exist | Shared cutout composition, predictive caching, live derived slices and measured interaction budgets |
| Image sets | Folder sets display one member at a time; the GPU teardown fix reclaims retired textures | Promotion into audited NeuroTabs datasets and a common member-source interface; folder switching currently still decodes/uploads on demand |

Existing code and prior test results are a starting point. The interaction and performance targets here require new end-to-end evidence.

Existing set-trace bands describe spatial variation within a probe for each member. Population spread, uncertainty about a population mean, and uncertainty in an individual's estimate require separately defined outputs.

## 3. One default workspace

Use the existing Brainflow shell and visual tokens. Keep the main images large and the control positions stable.

- **Population view:** working-selection mean by default; compact access to spread, cancellation and coverage.
- **Focused observation:** an actual individual's map at the same anatomical position, orientation and zoom. An explicit control switches to a residual or other derived representation.
- **Population strip:** an all-observation value plot plus a labeled sample of actual image previews. It expands into corresponding regional cutouts or a full montage. A linked plot can expand in the existing plot area while keeping the brain views available.
- **Sidebars:** metadata/filtering on the left; compact result identity and expandable provenance on the right. Relationships expand within the center when requested.

On narrow windows, switching or temporarily enlarging a view preserves all state. A large collection of mutually exclusive analytical modes should not become the primary navigation.

Example context header:

> 20 selected / 80 available · 20 participants · Focus: S037 · Reference: remaining 60

The reference control identifies whether it is a fixed cohort or the live complement of the working selection. A complement must state the context against which it is computed. Dataset changes that invalidate a pinned reference require an explicit resolution.

### State contract

Extend the current store and coordination service with these distinct meanings. The UI teaches ordinary actions; the software enforces the distinctions.

| State | Meaning | What changes it |
|---|---|---|
| Context | Eligible observations after dataset/feature filtering | Explicit dataset-level filtering |
| Working selection | Observations and weights being summarized | Brushing, cohort choice, set operations |
| Focus | One observation being inspected | Click, keyboard navigation, scrub or playback |
| Reference | Population used for a comparison | Explicit reference choice or an identified complement rule |
| Spatial probe | Pinned voxel, region, parcel or spatial weighting | Pin, resize, draw or select a region |
| Relationship definition | Context, support, transformation, distance and fitted relationship result | Explicit relationship calculation or refit |

Feature role, camera, color mapping, ordering and presentation are also explicit state, separate from cohort membership. They reference stable IDs and definitions rather than numerical arrays.

Required invariants:

- Focusing a person leaves selection and reference unchanged.
- Pointer movement updates a transient probe preview; clicking pins it. Neither action changes cohort membership or ordering.
- Choosing a region updates regional values. **Compare maps within this region** explicitly requests a new relationship result.
- Filtering preserves focus if eligible; otherwise the replacement focus is identified. Hidden focused observations remain explicitly identified during purely presentational filtering.
- Compatible effect maps share a scale. A t-map has its own labeled scale. Autoscaling is an explicit action and its setting persists through navigation.
- Each visible result identifies its query revision, contributor count, coverage and computation state.

## 4. A small grammar for fluid interaction

| Action | Visible result | Semantic effect |
|---|---|---|
| Order | Reordered strip, movie or montage | Changes presentation order only; rule, fit context and tie handling are recorded |
| Scrub / play | Focus moves through the ordered observations | Changes focus only |
| Expand / collapse | Stack ↔ strip ↔ montage ↔ summary | Changes presentation; retains members, camera and derivation |
| Group | Observations gather under factor or similarity labels | Creates a partition with an explicit rule |
| Select / combine | A highlighted or named subset | Creates a selection, union, intersection or difference of sets |
| Compare | Groups side by side; effect and statistical outputs | Creates a typed comparison retaining both operands |
| Preview without | Temporary alternate summary and its change | Creates a reversible preview; leaves the dataset and saved selection intact |
| Inspect contributors | Members behind a summary reappear | Restores contributor context and arrangement |

Groups should behave as objects with a member list, definition and several representations. Similarity clustering is a requested operation with parameters; a suggestive arrangement alone does not create a subgroup.

Maintain an immutable derivation graph for selections, partitions, summaries and comparisons, plus a lightweight presentation history. Undo restores definitions and presentation. Transient hover and every playback frame do not create durable history entries. Record a gesture at completion; a saved analysis recipe captures exact IDs as well as its generating rule and source revisions.

Dragging group A onto group B can reveal an A−B preview and the currently selected operator. Releasing commits that defined comparison. Provide the same actions through visible controls and keyboard commands. Gestures remain convenient shortcuts, with reduced-motion support and an unambiguous cancel action.

Animate the positions of identified observations during reorganization. Movie playback uses discrete, labeled observed frames; interpolated participant maps are not part of this browsing mode. Report cache misses and skipped playback frames in performance receipts.

For a two-condition repeated-measures contrast, the comparison retains matched subject pairs. Collapsing to one visible map preserves its inputs and sibling outputs. It never changes the analysis unit into two already-averaged images.

## 5. The first complete experience: the population lens

### Spatial zoom reveals population detail

At whole-brain scale, show the population and focused observation with a few actual examples. At regional scale, expand anatomically synchronized cutouts across observations. At a point, emphasize the all-person distribution. Spatial zoom changes how much population detail can be displayed; it does not implicitly change selection or the pinned probe.

For an 80-person regional lens, an 8 × 10 cutout grid is a useful reference design. Keep person IDs, selection marks, focus and missing-coverage indicators visible. Share orientation, cutout extent and comparable scales. Hover updates readouts without reordering the grid. Clicking a cutout changes focus.

### Show actual examples alongside the complete distribution

The strip always represents every eligible observation in its value plot, including counts of unavailable values. Image previews may use quantiles of regional response, representatives under the current distance, or largest deviations. State the sampling rule and count, for example: **12 of 80 maps, sampled across regional-response quantiles**. Expanding reveals all observations.

Offer **Show actual maps nearest this summary**, including their distances. Keep quantile fields and reconstructed fields labeled as derived maps; they are not individual observations.

### Initial summaries

| View | Question answered | Required companion information |
|---|---|---|
| Mean | What is the average observed effect? | Distribution, contributors and coverage |
| Observed spread | How much do the observations vary? | Sample SD, valid count and stated unit of observation |
| Cancellation | Where do opposite signed effects disappear through averaging? | Mean absolute magnitude and sign distribution |
| Sign share | How many observations point each way? | Positive / near-zero / negative counts and explicit near-zero interval |
| Coverage | Where do contributors have valid measurements? | Valid count and eligible count; missing differs from zero |

For complete, equally weighted data, cancellation is

\[
C(v)=\frac{1}{n}\sum_i |x_i(v)|-|\mu(v)|.
\]

Use the same valid observations and nonnegative weighting in both terms. Cancellation is descriptive; its sign or magnitude does not establish biological subgroups. Median comparisons and robust spread are subsequent additions with their own exact algorithms and cost profiles.

### Sensitivity as a reversible preview

**Preview without** temporarily displays the alternate mean and/or the change in the mean. The reference summary remains available and releasing/canceling restores it. Support a focused observation, selected subset and participant-level removal across repeated rows. Commit-to-selection is a separate, explicit operation.

For a complete unweighted mean with \(n>1\):

\[
\mu(v)-\mu_{-i}(v)=\frac{x_i(v)-\mu(v)}{n-1}.
\]

With missingness use local valid counts and contributions; omitting an observation that is missing at a location leaves that location unchanged. Empty remaining populations yield unavailable values. Model-specific influence requires the appropriate model calculation or refit. Rank unusual observations separately from observations that most influence the current summary.

### Linked plotting across sets

Reserve a full plotting path from the same population lens. The interaction is **hover to preview → pin to keep → group and summarize → inspect contributors**. For example, hover over a location to see each participant's response over time, pin it, color by treatment, facet by condition, and overlay group means and explicitly defined bands on the individual trajectories. Clicking a plotted observation focuses its map in the brain view; a temporal sample also identifies its timepoint. Brushing creates a working selection through the existing selection contract.

Treat this as a grammar of graphics, in the spirit of ggplot2. The user chooses data, axis mappings, visual grouping, facets, layers and statistical summaries. Useful presets include individual time courses with group summaries, condition profiles, distributions by factor, covariate scatterplots and set heatmaps. The focused observation remains identifiable across them. Full plot authoring is a later deliverable; M1's all-person value plot uses the same underlying contracts.

Each plot has an explicit binding to the context, working selection, reference or named sets, and to either the transient hover probe or a pinned probe. Pinning freezes the spatial definition; following a live selection versus retaining a saved membership snapshot is a separate, visible choice. Several pinned plots can compare locations without moving each other's probes. Several sets retain source and membership identity; overlapping membership must not masquerade as additional independent observations.

The plot contract separates three things:

| Part | Required meaning |
|---|---|
| Sampling query | Dataset/source revisions, resolved set members, feature and units, spatial probe/support, spatial reduction, and any temporal axis/alignment |
| Tidy sample frame | Stable observation and participant IDs, source/set membership, feature/probe identity, axis values and units, design factors, sampled value, validity and spatial coverage |
| Declarative plot recipe | Live/saved binding, filters, x/y/color/group/detail/facet mappings, layered marks, ordered summary operations, band definition and display settings |

The frame declares its row grain: one sampled value per observation, axis sample, feature and probe. Metadata joins preserve that grain, and membership in several sets does not multiply a participant's contribution to a combined summary.

Preserve the distinction between a genuine time course and an ordered collection of maps. Time requires acquisition times or an explicitly identified sampling interval and units; frame indices remain indices when that information is unavailable. Condition, participant, contrast and similarity order are categorical or declared ordered axes. A folder of 3D contrast maps does not acquire a temporal axis simply because it can play as a movie. Connecting categorical observations into a profile is explicit, and trajectories never connect different participants by accident. Time alignment, interpolation and event-relative summaries are declared operations; missing samples remain gaps unless an explicit method supplies them.

Keep the calculation order visible: reduce the spatial probe within each observation/timepoint, apply any stated within-participant reduction or alignment, then summarize across participants within chosen groups. Drawing a line group is separate from defining the statistical aggregation group. Users can layer original trajectories with means, spread or uncertainty, but each band states its estimand, method, analysis unit and contributing count. Existing per-member spatial bands cannot serve as uncertainty about a population mean. Repeated observations, unequal sampling and overlapping sets follow the participant and comparison rules in section 7.

Extend the existing [plot grammar](plot-grammar-sample-frame.md), `SampleProvider`, `SampleFrame`, `PlotSpec` and `plotSpecStore`. Current types already provide column roles, encodings and some transforms; multiple source bindings, layered specifications, grouped temporal sampling and explicit uncertainty contracts need extension and validation. Retain source IDs through transforms so any summary can reveal its contributing observations. Save the sampling query and plot recipe with provenance, and support export of the tidy sampled data and plot.

Coalesce hover requests and cache sampled frames by their full query identity. Recoloring, faceting or regrouping an unchanged frame should not reload volumes or resample the probe. Temporal sampling across members must use bounded backend work, cancellation and revision checks; stale hover completions cannot overwrite a pinned plot. Changes of probe, feature, membership or temporal alignment invalidate the relevant results. Warm plot updates get the same end-to-end latency and memory measurements as the brain views.

## 6. Similarity movies, groups and decompositions

Provide two initial relationship definitions:

- **Effect distance:** weighted Euclidean distance in comparable original units over a fixed spatial support; cache its squared form for computation.
- **Pattern-shape distance:** explicitly center and normalize the maps on that support, then compare their spatial patterns. Zero-variance maps are reported as unavailable for this definition.

Fit relationships for an identified context. Selection and focus do not refit coordinates or change order. An explicit refit creates a new result revision; saved lassos preserve observation IDs. Show fit quality for a 2D embedding, so proximity in the display can be interpreted against the underlying distances.

Start with classical MDS of the declared Euclidean distances. For a stable movie, order along its fitted first principal coordinate, with a fixed axis orientation and deterministic ties. Label the order and explained variation. This is an exploration order; timestamps remain a distinct semantic axis. Scrubbing and playback preserve anatomical coordinates and compatible scales. Expanding the movie into a montage keeps that same order and focused identity.

For similarity grouping, start with agglomerative average linkage over the declared distance, deterministic tie handling and an explicit cut/group count. Preserve observations that lack a usable distance as unassigned. Reordering into groups and regrouping by a factor use the same observation identities. A source factor can have missing values; they form an explicit group or an explicit exclusion.

Expand the relationship panel to an MDS-like view with linked selection. Later add:

- Exact spatial attribution for a pair under squared-Euclidean distance: \(q_{ij}(v)=w_v[x_i(v)-x_j(v)]^2\), summing to the reported squared distance. Transformed metrics attribute differences in that transformed space.
- PCA loadings, score distributions and actual maps at low/middle/high scores.
- Explicitly labeled reconstructions and residuals alongside original observations.
- Regional relationship fits requested from the population lens.

Avoid presenting a similarity group or a component axis as an established population type. Their origin and fit context travel into any downstream comparison.

## 7. Comparisons with explicit statistical meaning

The default comparison is an effect, \(\bar{x}_A-\bar{x}_B\). Its result object can hold effect, standard error, t statistic, degrees of freedom, valid counts and, when requested, pointwise p-values. A one-sample test for each group and a between-group test are different operations.

Initial test operators are narrowly specified:

| Operator | Required inputs | Rules |
|---|---|---|
| One-sample t | One comparable effect per independent participant | Tests a stated reference value, initially zero |
| Welch two-sample t | Disjoint independent participant groups and comparable effects | Separate group variances; local counts and degrees of freedom |
| Paired t | Explicit one-to-one participant pairing for two conditions | Compute within-participant differences, then a one-sample test |

The first release uses equal participant weights after any explicitly defined within-participant reduction. General observation weights remain part of the expression contract; frequency weights, precision weights and other schemes require their own estimator and uncertainty definitions before being exposed as analysis options.

These are basic sample-level analyses. Typed effect, SE/variance, t and z roles remain distinct; imported adjusted or mixed-effects estimates retain their model identity. The distinction between independent and paired designs is supported by the [FSL GLM design guide](https://fsl.fmrib.ox.ac.uk/fsl/docs/statistics/glm.html). Higher-level estimation uses appropriately defined inputs; the [FEAT guide](https://fsl.fmrib.ox.ac.uk/fsl/docs/task_fmri/feat/user_guide.html) describes the roles of contrast estimates and variance information.

Overlapping groups, unmatched pairs, repeated observations, rank-deficient designs, insufficient local counts and degenerate standard errors have explicit outcomes. A comparison can remain available descriptively when its requested test is unavailable. Arbitrary repeated-measures models, covariate adjustment and meta-analysis require later validated model adapters.

Display effect and evidence separately. Pointwise p-values are labeled uncorrected; a corrected analysis must specify its test family, spatial support and correction method. No automatic significance interpretation accompanies repeated exploratory gestures.

Map-derived selections carry an **exploratory selection** designation. Preserve the selection, probe, metric and model in **Freeze discovery**, then specify independent validation data or an appropriate selection-aware analysis. Freezing records the discovery; independence still has to be established. Selection on the same noisy measurements can invalidate ordinary subsequent inference, as demonstrated by [Kriegeskorte et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC2841687/).

## 8. Computational and integration plan

### Shared kernels

For complete data \(X\in\mathbb R^{n\times p}\), observation weights \(a\), and spatial weights \(b\):

\[
m=X^\top a,\qquad s=Xb,\qquad a^\top Xb=b^\top X^\top a.
\]

These are the two directions of the population lens: observations to a field, and a spatial probe to per-observation values. Signed contrasts combine separately normalized group/region reductions; do not normalize a signed contrast by its total weight, which may be zero.

Counts, stable mean/variance accumulators, absolute sums and thresholded sign counts support the first summaries. Use f64 accumulation, block merges, and controlled rebuilds after repeated additions/removals. Compare incremental results with direct batch calculations under high offsets, missingness and long edit sequences. [Pébay and colleagues](https://www.sandia.gov/research/publications/details/formulas-for-robust-parallel-computation-of-arbitrary-order-arbitrary-varia-2015-02-01/) provide the numerical basis for stable parallel moment calculations. Medians, model fits and decompositions retain separate operators and costs.

For a fixed common valid support and nonnegative spatial weights:

\[
G_w=X\operatorname{diag}(w)X^\top,\quad
d_{ij}^2=G_{ii}+G_{jj}-2G_{ij}.
\]

Disjoint parcel contributions add before normalization. Weighted spatial centering uses \(s_w=Xw\), \(m_w=\sum_v w_v\), and \(G_w^c=G_w-s_ws_w^\top/m_w\); normalize the diagonal only afterward for correlation. Use voxel-volume or vertex-area weights when that is the declared measure. Never substitute an average of parcel correlations for the combined-support correlation.

Missingness is explicit throughout. Group means have location-specific denominators; paired tests use valid pairs. Relationship fitting initially uses a declared common valid support. Pairwise deletion and imputation require separately specified methods; the simple Gram identities do not automatically provide a coherent shared geometry under arbitrary pairwise masks.

### Boundaries and ownership

| Existing boundary | Responsibility in the extension |
|---|---|
| `setStudioStore`, `StudioCoordinationService`, Studio components | IDs, state transitions, view arrangements, history and query definitions |
| `core/field_table` | NeuroTabs semantics, operation validation, cohort expressions and reusable pure numerical logic |
| Studio services and `core/api_bridge` | Versioned evaluation requests, job cancellation, source access and result-handle lifetime |
| `SampleProvider`, plotting types/encoder and `plotSpecStore` | Tidy sampled frames, source/probe bindings, declarative plot recipes and linked focus/selection; extend without a second cohort store |
| `core/render_loop`, shared viewports and visualization package | Batched presentation, geometry, GPU ownership and predictable slot use |
| Existing materialization/export services | Complete outputs, manifests and portable frozen recipes |

Introduce a common source/evaluation interface for observed, derived and reconstructed fields. Preserve their distinct identities. Slice/region requests and full-volume export evaluate the same expression. Start with existing crate boundaries; extract a pure numerical crate only if dependencies warrant it. Proposed interfaces and commands receive a separate implementation review before registration.

A result key includes dataset and source revisions, resolved members/weights, participant handling, feature role, support and mask, transformation, reducer/model and parameters. Rendering additionally keys camera, sampling and display settings. Freeze the resolved inputs at submission; a later file change must not silently join an in-flight result. Every asynchronous completion is checked against workspace and query revision.

A pending query leaves the previous result usable with its previous-query identity visible. Cancellation removes obsolete work; latest-result checks independently prevent stale publication. CPU data caches, reduction caches, cutout caches, relationship matrices and GPU residency each have byte budgets and teardown owners.

### Performance contract

Eighty maps × 200,000 float32 values occupy 64 MB for the compact numerical matrix alone. Full-volume grids, validity masks, anatomy and caches can be much larger. Support bounded blocks as well as resident matrices; loading a set never requires all members in VRAM.

During interaction evaluate visible slices/cutouts first. Respect the expression's declared operation order: anatomical resampling, nonlinear summaries and neighborhood operations cannot be reordered merely to accelerate a preview. Compute native-support derived samples needed for the view, then apply the specified display sampling. Export uses identical semantics over the complete support.

Reuse cached numerical blocks and batch cutouts. A population grid shares geometry, anatomy and presentation infrastructure; it does not allocate one full viewer and permanent 3D texture per person. Prefetch nearby observations in the current order. The current 13-texture binding limit remains an explicit residency constraint, covered by the [GPU lifecycle regression](../gpu-texture-lifecycle-2026-09-05.md). Capacity reporting must describe actual texture occupancy, including prefetched members.

Initial warm end-to-end p95 targets on a declared reference Mac and fixture:

| Interaction | Target |
|---|---:|
| Selection/hover feedback | One 60 Hz frame, about 16.7 ms |
| Cached focused observation to visible image | Under 50 ms |
| Visible selection-summary slice to visible image | Under 100 ms |
| Larger exact relationship/model job | Nonblocking, cancelable and visibly versioned |

These are targets to establish experimentally. Record p50/p95/p99, cold-load latency, playback misses and memory use. Test both a compact mask and realistic full grids, local and remote cache states, and memory pressure. GPU compute follows profiling. Any approximate preview is labeled; original observations always remain available at their original fidelity.

## 9. Delivery sequence

Each milestone is a complete user path with an exit gate. Do not start with a general analytics framework or a broad set of disconnected lenses.

| Milestone | Deliverable | Exit gate |
|---|---|---|
| **M0 — Contracts and baseline** | Resolve six-state mapping, typed input/participant/support contracts, result identity, and plot sampling/binding/axis semantics; instrument the current path and create deterministic fixtures | Ambiguous operations rejected with reasons; focus/selection/reference transitions specified; tidy samples retain IDs, units and validity; baseline latency and memory receipt recorded |
| **M1 — Population lens** | Mean + actual focused map + all-person values through the shared sample-frame pipeline, pinned probe, synchronized cutout grid, sample SD/cancellation/coverage, regional ordering and preview-without; live slice evaluation | User can distinguish shared, opposing, minority-driven and displaced patterns without losing context; plot-to-focus preserves selection; exact numerical and warm-latency gates pass |
| **M2 — Fluid sets** | Cached movie/scrub, stable exact similarity order and initial 2D coordinates, montage expansion, requested similarity grouping, factor grouping, reversible collapse and set operations | Movie → montage → groups → summaries → contributors preserves IDs, selection, geometry, scale and undo; sustained playback stays within budgets |
| **M3 — Typed comparisons** | Group A/B views, A−B effect, one-sample/Welch/paired tests, sibling result switching, provenance and frozen discovery recipes | Results match independent numerical references; invalid pairings/overlap/units fail clearly; exploratory origins survive export; no file-writing step on the warm browsing path |
| **M4 — Explain relationships** | Regional refits, spatial distance attribution, PCA loadings/scores, actual examples and explicit reconstructions | Pairwise contributions reconstruct the declared distance; observed/reconstructed identity and stable fit behavior remain clear |
| **M5 — Broaden support and analysis** | Audited parcel and surface datasets, robust summaries, pivot views, validated model adapters and larger datasets | The same interaction/state contracts pass for each supported geometry and model; each addition has scientific and performance evidence |
| **P — Linked plot authoring (after M1)** | Hover/pinned plots across named sets, individual temporal/condition profiles, flexible grouping/faceting, layered summaries and defined bands, saved recipes and tidy-data export | Grouped summaries match independent references; real time and categorical axes remain distinct; plot/brain links preserve state; missingness, repeated measures, source overlap and stale hover results are handled correctly |

The first product review is M1. The first release spanning the full movie/group/contrast loop is M3. M4 deepens explanation; M5 expands breadth. Advanced modeling and arbitrary cross-space registration do not block the first population experience.

P is a follow-on track whose data and interaction contracts are reserved in M0 and exercised by M1. It can be scheduled after M1 without waiting for M5, and full plot authoring does not gate the movie/group/contrast loop. It consumes the same named sets and grouping definitions as M2; test/model outputs use M3's typed operators when those become available.

Volume data on an audited common support ships first. Define support adapters at M0 for volumes, surface vertices and atlas parcels so later support does not require different selection semantics. Surface support requires hemisphere, topology, coordinates and area-weighting provenance. Parcel support requires atlas version, parcel dictionary and unambiguous IDs/composite keys; never infer correspondence from row order or names alone. Projection/resampling between supports is an explicit derived operation.

## 10. Acceptance evidence and next work package

Use deterministic datasets with known explanations:

| Fixture | Expected finding |
|---|---|
| Everyone +1 | Mean +1, no spread or cancellation |
| Forty +3 and forty −1 | Mean +1, cancellation 1, split sign distribution |
| Eight +10 and seventy-two zero | Mean +1, minority contribution apparent; no signed cancellation |
| Shifted focal responses | Diffuse average resolves into spatially displaced individual patches |
| Missing coverage | Missing values stay distinct from measured zero; local denominators are visible |
| Large offsets with tiny variation | Stable SD and t computations; incremental and batch results agree |
| Repeated measures and unequal groups | Correct participant counts, pairing, weighting and local degrees of freedom |
| Grouped trajectories with unequal time grids and missing samples | Original paths retain participant identity; declared alignment and participant summaries are correct; gaps and changing counts remain visible |
| Pure noise with exploratory clustering | Interface retains discovery provenance and does not imply independently established groups |

Add meaningful state, numerical, integration and visual checks. Include rapid selection while loading, closed workspaces, focus during filtering, undo, partial/canceled downloads, changing sources, zero variance, empty selections, invalid keys and support mismatches. Run real GPU allocation/render/release cycles under memory pressure and evaluate end-to-end input-to-pixel latency. Preserve a native app walkthrough separately from mocked browser coverage.

For linked plots, cover hover → pin while requests are in flight, multiple pinned locations, live versus saved set bindings, overlapping membership, and focus/brush round trips. Verify that regrouping cached samples matches a fresh grouped calculation without new spatial sampling, and that bands distinguish spatial dispersion, between-participant spread and uncertainty about a summary.

Human evaluation asks users to identify what produces the same mean in different populations, find influential observations, recover contributors to a comparison, and explain what a displayed t-map tests. Record interpretation errors and false subgroup conclusions alongside task time. A pleasant animation or attractive embedding is insufficient acceptance evidence.

**Next implementation work package:** M0 plus one M1 vertical slice: import an audited 80-map fixture; show its live mean and a focused original; pin a location; display all values; focus from that plot without changing selection; preview the mean without that participant; release to restore. Add the cutout grid and remaining summaries only after that path is correct and meets its measured budget.

## References and navigation

- [Set Studio PRD](../../memory-bank/Set_Studio_PRD.md), [implementation plan](../../memory-bank/Set_Studio_Implementation_Plan.md), [V1 scope](../../memory-bank/Set_Studio_V1_Scope_Cut.md), [app-mode plan](../../memory-bank/Set_Studio_App_Mode_Plan.md).
- [NeuroTabs compatibility](../../memory-bank/NeuroTabs_Compatibility.md), [folder image sets](../folder-image-sets.md), [resident image-set design](gpu-resident-image-set-stack.md). The resident design includes historical status; current source and lifecycle tests take precedence.
- [Plot grammar and sampling plan](plot-grammar-sample-frame.md), [plotting contracts](../../ui2/src/plotting/types.ts), [sample provider](../../ui2/src/services/SampleProvider.ts), [plot encoder](../../ui2/src/components/plots/encoder/PlotEncoder.tsx), [plot specification store](../../ui2/src/stores/plotSpecStore.ts).
- Source entry points: [store](../../ui2/src/stores/setStudioStore.ts), [coordination](../../ui2/src/services/studio/StudioCoordinationService.ts), [comparison](../../ui2/src/services/studio/StudioCompareService.ts), [display](../../ui2/src/services/studio/StudioDisplayService.ts), [materialization](../../core/field_table/src/materialize.rs), [sampling and bridge](../../core/api_bridge/src/lib.rs), [renderer](../../core/render_loop/src/lib.rs).
