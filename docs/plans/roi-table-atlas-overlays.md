# ROI table overlays with validated atlas bindings

Status: volume-atlas UI implemented locally, 2026-09-05. The shared Rust
neuroatlas contract is pinned to `f0103ed`. The broader identity, persistence,
surface-binding and linked-selection design below remains a proposal where
it goes beyond the implemented slice described here.

## Implemented volume workflow

Select a known, loaded **volume atlas** in the Layers panel, then choose
**Add parcel values…** in its Inspector. Load or paste CSV/TSV, choose the key
column and exact matching convention, inspect coverage, and select a numeric
column before choosing **Create overlay**. The result is an independent layer
with a retained table, column selector, continuous colormap, numeric color limits,
thresholds and opacity. Column changes reset limits and thresholds; signed columns
start with symmetric limits around zero. Visibility/order/removal use the normal
layer stack.

- The concrete atlas loader retains its original dictionary and source labels.
  Matching delegates to neuroatlas's strict keyed resolver; row order is never
  used as atlas identity. ID, exact label, full source label and hemisphere/network
  composite keys are available. Unknowns, duplicates and ambiguities block import.
- Complete coverage is the default. Partial coverage is explicit. Blank, `NA`,
  and `null` cells are missing and transparent; zero and negative values remain
  numeric. Mixed/non-finite/out-of-f32-range numeric columns cannot be selected.
  Keys are not trimmed or case-folded. Files are limited to 5 MiB, 100,000 rows
  and 256 unique nonempty headers. CSV quoting is parsed by Rust's `csv` crate.
- The immutable dictionary and exact table bytes have SHA-256 receipts. The
  dictionary encoding is versioned locally and includes the dictionary name,
  labels and full labels in canonical atlas order. This is an in-app identity
  receipt, not a published atlas-release certification or portable interchange
  standard. A bare CSV still does not prove where its statistics originated.
- Each overlay owns a distinct volume handle and GPU lease. The atlas geometry
  remains shared by `Arc`; its GPU representation retains exact label codes.
  Numeric values, color limits and thresholds produce an RGBA lookup row, with
  missing values encoded in alpha. Changing columns does not re-upload geometry.
- CPU readers get an affine-preserving f32 snapshot of the selected column,
  including NaN for missing/background voxels. This snapshot is rebuilt on column
  changes so hover, histogram and other scalar consumers never see parcel IDs.
  Parsing and snapshot construction run on blocking workers; publication rechecks
  source identity or overlay revision. The overlay survives removal of its source.
- Custom lookup rows are cached and recycled when overlays unload. Preview replies
  are tied to all input fields, and failed/abandoned imports release provisional
  volume handles and frontend metadata.

This first slice requires discrete 3D atlas codes in 1–2047 (zero is background),
checks the image codes against the retained dictionary, and rejects probabilistic
atlases. Direct surface-atlas table binding, saved-session table persistence,
parcel-data JSON/identity sidecars, exportable templates, a standalone table panel
and linked row/parcel selection are still pending. Tables are retained in the
running session; importing starts from the atlas Inspector.

UI fixture: `pnpm --filter temp-ui dev`, then `/parcel-overlay-harness.html`.
It renders the real controls with mocked IPC and is excluded from the production
bundle. It is visual UI evidence, not an in-app Tauri import-to-hover test.

Local checks for this slice: 138 API-bridge library tests passed with GPU access;
18 focused UI/import/inspector tests passed; the new pixel-level parcel test
passed on the GPU, including 80 lookup-slot reuse cycles; four render-golden
checks and three shader-contract checks passed. The frontend production build
and strict command/permission check passed. The Playwright fixture rendered
without page errors and switched columns successfully. Full desktop
import-to-hover verification remains pending; none of these receipts imply a
packaged application or hosted CI has been tested.


## Broader target workflow

Load a CSV/TSV containing one row per ROI and one or more statistic columns.
Choose **Map to atlas**, select a loaded atlas, select the ROI key column(s),
and choose a numeric column. Show a validation preview before creating an
independent layer named, for example, `Results / beta · Schaefer 400 / 17`.
Changing the value column, color scale, or threshold keeps the validated binding.
Table row selection and parcel selection work in both directions.

Offer **Export ROI table template** from every known atlas. The template contains
the exact keys, full labels, hemisphere/network metadata, and an identity sidecar.
The user fills new value columns without having to guess an atlas naming scheme.
Plain CSV/TSV remains supported through an explicit mapping dialog.

## Three distinct contracts

| Contract | What must be established | What it does not establish |
| --- | --- | --- |
| Parcel identity | Atlas family, variant, release, labeling convention, canonical parcel dictionary | How arbitrary imported numbers were computed |
| Table binding | Each selected input row maps to exactly one canonical parcel; coverage and value validity are known | Spatial registration or anatomical equivalence of different atlases |
| Spatial realization | Voxel/vertex label codes resolve to canonical parcels on the selected image/mesh | That all realizations of the same atlas have identical boundaries |

Numeric IDs are scoped to a dictionary and labeling convention. An atlas family
and parcel count are insufficient. CBIG explicitly documents Schaefer versions
with the same parcels but different names and orderings; a release update also
changed indices. A 400-row table with IDs 1–400 can therefore pass a naive join
while producing an incorrect map.

Sources: [CBIG atlas versions](https://github.com/ThomasYeoLab/CBIG/blob/master/stable_projects/brain_parcellation/Schaefer2018_LocalGlobal/README.md)
and [CBIG naming/index update](https://github.com/ThomasYeoLab/CBIG/blob/master/stable_projects/brain_parcellation/Schaefer2018_LocalGlobal/Parcellations/Updates/Update_20190916_README.md).

## Atlas identity and dictionary

Introduce a versioned descriptor in neuroatlas-rs, exposed through Brainflow's
atlas service. Keep parcel identity separate from its spatial realization:

- `AtlasIdentity`: family, model/release, parcel count, network variant, label
  convention/source namespace, and a dictionary digest.
- `ParcelDefinition`: stable canonical parcel key, source label code(s), full
  source label, display name, hemisphere, network, and documented aliases.
- `AtlasRealization`: volume/surface, source artifact digest, template/subject
  space, grid and affine or hemisphere/mesh correspondence, and the explicit
  realization-code-to-parcel mapping.

Hash a specified, versioned canonical encoding sorted by canonical parcel key.
Exclude display colors and row order from the dictionary digest. Record label
convention/version independently; retain artifact hashes separately. A digest
establishes content identity with a trusted reference, not scientific authenticity.

For surfaces, validate hemisphere, template/density, vertex ordering and topology
correspondence. Equal vertex counts alone are insufficient. Pial and inflated
meshes can share the same parcel binding when their vertex correspondence is
known. For volumes, keep the actual atlas grid and affine; display on a different
anatomical background requires a known spatial relationship. Do not infer it from
the generic string `MNI` or silently resample/register on table import.

Different representations may have different integer codes for the same parcel.
Their reuse requires an explicit versioned dictionary crosswalk. A genuinely
different parcellation requires a separate, named aggregation/projection operation.
Limit the first version to discrete atlases. Probabilistic memberships need an
explicit weighting and normalization estimand.

## Binding and validation

The authoritative resolver runs in Rust and returns a structured report. React
must not implement a second matching algorithm or parse error strings to obtain
row diagnostics. Adapt errors at the shared-library boundary as the report API
is introduced.

Allow explicit joins by:

1. canonical parcel key;
2. numeric ID within the declared label convention;
3. exact full source label;
4. a unique composite such as `(label, hemisphere, network)`.

Use only registry-provided aliases with a recorded rule/version. Normalizations
such as hemisphere spelling or whitespace must be visible and collision-checked.
Do not silently strip prefixes, switch between zero- and one-based IDs, cast
fractional IDs to integers, or fuzzy-match parcels. Row order is never an import
key. Atlas suggestions may use recognizable labels; row count and numeric ranges
are hints only. If multiple loaded atlases fit, require a target selection.

The report includes the selected atlas/realization, source-key-to-parcel mapping,
matched rows, duplicate keys, ambiguous keys, unknown rows, missing target
parcels, contradictory metadata, and value validity for each numeric column.
Return offending row numbers and example keys, not only aggregate percentages.
Separate key coverage from finite-value coverage; 400 matched keys with 20 null
values has full key coverage and incomplete value coverage.

| Condition | Policy |
| --- | --- |
| Unknown input keys, ambiguous matches, duplicate keys | Block binding; no last-row-wins or implicit averaging |
| Supplied ID/name/hemisphere/network disagree | Block binding |
| Missing target parcels | Block by default; explicit partial-coverage mode retains them as missing |
| Missing numeric cell | Preserve missingness; report separately from missing keys |
| Non-finite or invalid numeric token | Report as invalid; never coerce silently to zero or null |
| Numeric zero or negative estimate | Preserve as valid data |
| Background or medial-wall code | Treat using explicit realization metadata; never as a statistic-bearing ROI by accident |
| Repeated ROI across subjects/contrasts | Require an explicit selection/grouping before binding |

Use a real CSV/TSV parser with quoted-field handling, duplicate-header detection,
bounded file/row sizes, and strict selected-column parsing. Preserve key strings
until a mapping rule explicitly chooses numeric IDs. Keep raw source cells and
file digest for reproducibility. Begin with CSV/TSV and parcel-data JSON; add
spreadsheet and richer NeuroTabs adapters after they can use the same resolver.

For a bare table, the user declares the atlas and sees **Keys validated against
selected atlas**. An exported package can also verify its recorded dictionary
digest. Never claim to have verified the computation that generated imported
numbers. A high matching percentage cannot substitute for this distinction.

## Bound overlay and rendering

Create an immutable `ValidatedParcelBinding` referencing a table snapshot, atlas
identity/dictionary digest, selected realization and its mapping, key specification,
coverage policy, and per-row resolution. A separate `ParcelStatisticLayer` selects
a value column and display settings. These are proposed types, not existing APIs.

Keep source atlas labels and raw numeric values intact. The color for a voxel or
vertex follows `realization code -> canonical parcel -> selected value -> scale`.
Store missingness separately; default missing regions to transparent with an
optional explicit no-data style. The legend describes the statistic scale and
missingness. Hover shows atlas, canonical parcel/name, selected column, value or
missing status, and source row. Clicking the brain selects the source table row.

Reuse the existing discrete label lookup path for volume display: compute a
per-label RGBA lookup from the selected numeric values and continuous color scale.
Changing columns or ranges then updates a small lookup rather than uploading a
new scalar volume. Extend the registration command to support per-label alpha;
its current RGB API makes every foreground entry opaque. Keep statistic
thresholds in value space, not the atlas label-ID threshold path. Use a distinct
lookup key per overlay so two columns can coexist without recoloring each other.

The current lookup capacity is 2048 entries and directly indexes label IDs.
Validate the maximum realization code; never clamp sparse/high IDs into the same
slot. A dense private code remap is a later option if all sampling and picking
paths retain the inverse mapping. Share the atlas texture only with explicit
resource ownership; unloading the source must invalidate or safely retain its
dependent layers. Do not let a derived layer bypass LayerLease/watchdog teardown.

For surfaces, the existing per-vertex label and RGBA overlay path can expand the
same bound values after mesh correspondence has passed. Match the volume scale,
threshold, missingness, and hover semantics. Numeric values remain available for
sampling and export even when display uses precomputed colors.

Exporting a scalar NIfTI is a separate explicit materialization into the chosen
atlas grid, with missing/background policy and provenance recorded. Avoid creating
such volumes merely to change a displayed statistic column.

Bind asynchronous results to the captured workspace, table revision, atlas
instance/digests, and request generation. Sorting the visible table preserves row
identity. Reloading files, replacing atlases, or changing keys invalidates the
binding; a late validation/render result must not revive it. Keep cross-panel
selection and bindings in shared stores/services because GoldenLayout roots do
not share React Context.

## Existing implementation and remaining work

Source review on 2026-09-05 found:

- R neuroatlas `R/plot_brain.R` delegates `data`, `value`, `by`, and
  `allow_partial` to the strict resolver in `R/parcel_data.R`. Its parcel-data
  test file passes locally. This is a useful semantic reference.
- The original Brainflow pin, `6384c6b`, has `ParcelData` and
  `ParcelAtlasIdentity` but permissive row joining. This work advances the pin to
  upstream commit `f0103ed74c05da4f7a1a42a7f21082208f9e510b`, which addresses duplicate/unknown/ambiguous keys, explicit partial
  coverage, exact composite/source-label keys, and stored identity/metadata checks.
  It does not yet provide authoritative release/dictionary fingerprints or the
  structured preview report proposed here.
- `core/field_table/src/preview/table.rs` currently expects file-path and subject
  columns for image-set import. ROI rows need a distinct import mode. The existing
  NeuroTabs `ParcelSupport` shape provides a future adapter, not a working overlay.
- `core/atlases/src/service.rs` now retains a `ParcelDictionary` alongside the
  loaded volume. It is captured from the concrete atlas, independently of palettes.
- `ui2/src/services/AtlasService.ts` contains parcellation-reference calls and TS
  types, but their command names are absent from the active Rust command list.
  Do not treat those client methods or old generated files as an implemented backend.
- The active masked shader supports exact label-indexed RGBA lookup. The existing
  registration command and surface overlay helper offer rendering reuse, subject
  to the missingness, value-threshold, capacity, and geometry requirements above.

## Delivery sequence and acceptance

1. Harden neuroatlas-rs and document stricter behavior; advance Brainflow's pin.
   Upstream `f0103ed` is committed and pushed, with local/tracking/live SHAs equal.
   Its 245 library tests and 17 binding tests pass (five existing network/cache
   tests ignored), as do Clippy with warnings denied and the example compile check.
   The R parcel-data tests also pass. These are local checks, not hosted CI proof.
   Brainflow's `cargo check --locked -p atlases -p api-bridge` passes with the
   updated pin (existing ts-rs serde-attribute warnings). The check used
   `CARGO_NET_GIT_FETCH_WITH_CLI=true` to honor the configured SSH host alias.
2. Add authoritative dictionary/realization descriptors, stable digests, and
   fixtures for Schaefer variants and Glasser conventions. Keep raw source labels
   and explicit crosswalks. Expose exportable key templates.
3. Implement the Rust preview/bind report and thin Tauri commands using the
   single-sourced command list, generated bindings, and permission checks.
4. Add table import/mapping preview and one independent statistic layer using
   the existing volume/surface renderer paths. Add persistence and linked picking.

Acceptance requires small analytical fixtures plus representative pinned atlas
dictionaries: shuffled rows give identical maps; IDs with gaps never become row
indices; left/right and network ambiguities fail; same-size wrong atlas variants
fail when declarations/digests conflict; missing, zero, negative, and invalid
values stay distinct. Test complete and partial coverage, JSON/CSV roundtrips,
cross-representation code mappings, stale responses and unloads, and two overlays
using different columns of one table.

Rendering evidence must check specific interior voxel/vertex values, the RGBA
lookup, transparency and statistic thresholds, followed by the render-golden and
shader-contract gates when those paths change. Include an in-app import-to-hover
check; pure key-resolution tests are not evidence that the UI feature works.
