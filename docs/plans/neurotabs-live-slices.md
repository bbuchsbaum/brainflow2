# Population slice evaluation contract

This implements the visible-support path in the [population exploration plan](neurotabs-population-exploration.md). It is a descriptive observed-field evaluation path; participant/model semantics and full-volume export remain separate acceptance work.

Before registering `evaluate_population_slice`, the implementation review fixes these boundaries:

- The request identifies the complete eligible source list, an explicit working subset, the focused observation, world crosshair, orientation, raster size and zoom. Focus and working membership are separate operands. Empty working selections are valid.
- Sources must have matching finite, invertible world affines and dimensions, and explicit frames for 4D inputs. Missing source files fail the evaluation; missing measurements remain unavailable with local contributor counts. Atlas/template names do not establish geometry.
- Evaluation gathers only native voxel locations needed by the visible plane. The first display sampler is explicitly nearest-neighbor. Reductions occur on the native support, before display sampling. No full derived volume or per-observation GPU texture is allocated.
- A bounded native cache retains one plane's observed samples and source revisions. Changing selection/focus reuses these observations; source stamps are revalidated. Canceled work and stale publication use the existing sampling-ticket protocol. Cache admission and teardown have explicit owners.
- Shared `FieldMoments` supplies mean, sample SD, cancellation and coverage. The focused output retains the observed sample values. These are not statistical tests or reconstructed people.
- The UI uses the existing slice viewport geometry and image surface. Services own numerical responses, cancellation and bitmap lifetimes; stores retain IDs and definitions. Both panes use the same plane and compatible effect scale. A previous frame retains its own geometry/query label while a new result is pending.

Verification must cover an analytic opposing population, missing versus zero, empty selection, support mismatch, view orientation/click geometry, selection/focus reuse, cancellation/teardown and native latency/memory. The first slice path does not establish the complete M1 gate or export equivalence.

## Delivered slice and acceptance limits

The first implementation registers evaluation and context-scoped plane release. Audited volume imports open the Population lens, which composes the existing shared viewport and image surface without registering full GPU volumes. It supports observed mean/focus, sample SD/cancellation/coverage, world-linked hover and pinning, held observation exclusion, adjustable fixed scales, source revisions and image lease cleanup. Sheared native grids require a separate resampling adapter. Non-finite measurements remain transparent; finite zero is data.

The CPU plane matrix cap covers retained sample/geometry payload; decoded sources, source metadata, transient moments, response arrays, JSON IPC and bitmap resources are additional allocations. Native timing and synthetic real-canvas UI evidence are separate. Full-shell native acceptance, explicit masks, participant-level exclusions, source-retention lifetime, cutout galleries and view/export equivalence remain required by the parent plan.
