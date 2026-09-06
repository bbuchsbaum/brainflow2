# Population slice evaluation contract

This implements the visible-support path in the [population exploration plan](neurotabs-population-exploration.md). It is a descriptive observed-field evaluation path; explicit participant grouping is supported as described below; model semantics and full-volume export remain separate acceptance work.

Before registering `evaluate_population_slice`, the implementation review fixes these boundaries:

- The request identifies the complete eligible source list, an explicit working subset, the focused observation, world crosshair, orientation, raster size and zoom. Focus and working membership are separate operands. Empty working selections are valid.
- Sources must have matching finite, invertible world affines and dimensions, and explicit frames for 4D inputs. Missing source files fail the evaluation; missing measurements remain unavailable with local contributor counts. Atlas/template names do not establish geometry.
- Evaluation gathers only native voxel locations needed by the visible plane. The first display sampler is explicitly nearest-neighbor. Reductions occur on the native support, before display sampling. No full derived volume or per-observation GPU texture is allocated.
- A bounded native cache retains one plane's observed samples and source revisions. Changing selection/focus reuses these observations; source stamps are revalidated. Canceled work and stale publication use the existing sampling-ticket protocol. Cache admission and teardown have explicit owners.
- Shared `FieldMoments` supplies mean, sample SD, mean absolute magnitude, cancellation and coverage. The focused output retains the observed sample values. These are not statistical tests or reconstructed people.
- The UI uses the existing slice viewport geometry and image surface. Services own numerical responses, cancellation and bitmap lifetimes; stores retain IDs and definitions. Both panes use the same plane and compatible effect scale. A previous frame retains its own geometry/query label while a new result is pending.

Verification must cover an analytic opposing population, missing versus zero, empty selection, support mismatch, view orientation/click geometry, selection/focus reuse, cancellation/teardown and native latency/memory. The first slice path does not establish the complete M1 gate or export equivalence.

## Delivered slice and acceptance limits

The first implementation registers evaluation and context-scoped plane release. Audited volume imports open the Population lens, which composes the existing shared viewport and image surface without registering full GPU volumes. It supports observed mean/focus, sample SD/mean absolute magnitude/cancellation/coverage, world-linked hover and pinning, held observation exclusion, adjustable fixed scales, source revisions and image lease cleanup. Sheared native grids require a separate resampling adapter. Non-finite measurements remain transparent; finite zero is data.

The CPU plane matrix cap covers retained sample/geometry payload; decoded sources, source metadata, transient moments, response arrays, JSON IPC and bitmap resources are additional allocations. Native timing and synthetic real-canvas UI evidence are separate. Full-shell native acceptance, explicit masks, full participant metadata/provenance, source-retention lifetime, native cutout acceptance and view/export equivalence remain required by the parent plan.

## Cutout extension contract

The optional cutout request adds a pinned world center, square physical width and bounded raster to the same evaluation query. Its requested observation IDs affect presentation only. Native gathering takes the union of the main plane and cutout voxel locations; one cached row per eligible observation supplies both. Changing the gallery page or focus reuses those rows. Main and cutout planes may pass through different locations, so navigation need not move a pinned probe.

The response returns at most 96 cutouts, each at most 64 × 64 samples, with IDs, geometry and valid-pixel counts. It uses nearest observed samples, not averaged or reconstructed people. The frontend applies the shared value scale and packs visible members into one sprite image, with one canvas composing the responsive grid and accessible DOM controls retaining identity/focus/selection. The gallery uses pages for larger contexts and labels which observations are shown. It never silently selects the most representative-looking people.


## Participant reduction contract

`aggregation` is optional on `evaluate_population_slice`. When present, its `within` operator is `single` or `mean`, and its groups contain a declared participant ID and observation IDs. Groups must partition the selected observations exactly once; identities are nonempty and unique, and `single` requires one row per participant. Empty selection accepts zero groups and yields unavailable summaries. Native validation runs before source work.

`FieldMoments::push_mean` averages finite selected observations within one participant at each native location and pushes the f64 result into between-participant moments without float32 intermediate rounding. Thus sample SD describes the observed participant means; it does not estimate a mixed model or measurement uncertainty. A person with no finite rows at a location is unavailable there. The result's `eligibleCount` remains the selected observation count; `unitCount` reports selected participants (or observations without aggregation), and `validCounts` uses that same analysis unit. Frontend validation rejects mismatched or impossible counts.

Grouping changes the reduction/query identity while retaining the same cached observation matrix. Focus and cutouts continue to return original observations. Whole-participant preview changes only the request's selected rows/groups; release restores the canonical selection. Probe summaries reuse the existing observation sample frame, with explicit spatial-then-participant reduction. Participant identities currently require complete keyed design-table previews or an explicit distinct-person declaration; full metadata access, saved recipes and export equivalence remain work under the parent plan.
