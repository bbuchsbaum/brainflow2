# Segmentation foundation acceptance

Status: experimental, disabled by default. This implements the selected module
foundation work and segmentation M1–M2; it does not complete the entire module
architecture plan or qualify segmentation for preview/stable use.

## Implemented scope

- A.2: in-place view modes and their Inspectors, declared viewport tools with
  shared pointer arbitration, versioned workspace state and scoped shortcuts.
- B2: layer-kind descriptors, affirmative host/render capability requirements
  and unavailable reasons in Settings. Render modes remain core-owned.
- R1–R3: sparse u16 labels and provenance, revisioned stroke history, atomic
  NIfTI export preserving source spatial headers, revision/generation/owner
  checked partial GPU uploads, native and oblique planes. Existing zoom/pan and
  simultaneous label outlines are reused and tested.
- M1–M2: loaded-volume setup, registration review, label-table validation,
  retained in-memory native sessions, manual brush/eraser/closed contour,
  locks and paint constraints, exact preview/commit rasterization, undo/redo,
  affine-projected shared H overlays, native-slice ruler and label matrix.
- Core document ownership survives module disable and parking. Workspace close
  and application quit freeze edits and offer Cancel/Discard. Disposal rejects
  late commands; ordinary layers can retain the accepted label snapshot. Required
  reference/secondary images stay retained and cannot be removed or evicted while
  their document remains open, including while the module is disabled.

- 4D reference/secondary inputs traced on one explicit frame (see limits below).
- Save labels as NIfTI (Inspector, Session section): `segmentation_save_labels`
  copies the accepted revision the tab displays (a stale owner or revision is
  refused and the tab adopts the current document), then opens the native save
  dialog with a BIDS-style name (`sub-…_ses-…_desc-<rater>_dseg.nii.gz`). It
  writes the label volume (NIfTI-1, intent 1002, u8 or u16, source sform/qform
  kept, `descrip` records the revision) and its `dseg.tsv` (index, name,
  abbreviation, colour, parent index). Both are staged to temporary siblings and
  synced before either is renamed into place, label volume first; if the table
  rename fails, the previous files are restored (or new ones removed) and the
  error says what, if anything, is left. A name without a NIfTI suffix gets
  `.nii.gz` appended and never replaces an existing file; only a file the dialog
  confirmed is replaced, others are created without clobbering, and a table is
  never replaced without its label volume. The save sends the revision the tab
  displays and refuses a newer accepted reply not yet displayed. Painting waits
  while the dialog is open; a closing (frozen) workspace refuses the save; a GPU
  display failure does not block saving the accepted CPU labels.
  The Inspector reports the saved files and whether the labels changed since.

Later architecture work includes settings schemas, typed module events,
startup aliases, BIDS/Studio migration, loader/provider registries and scaffolding.
Segmentation M3–M8, saved-session recovery, proposals and AI remain later work.
M5 save features are not implemented: ⌘S quiet save to a remembered path, the
provenance JSON sidecar and provenance volume, "Save as / export…" dialects,
autosave and resume. Saving does not mark the in-memory document clean, so
closing or quitting still asks before discarding the session.

## Evidence

The source includes behavior tests for stale async replies, disable/re-enable,
close routes, lost acknowledgements, text-field/native Edit routing, lock and
history semantics, allocation failure and GPU-slot reuse. Deferred-render tests
cover registration navigation and zoom during a held stroke; pending planes stay
hidden and cannot commit mixed-frame samples. Independent synthetic
anisotropic/oblique voxel answers and byte-equal history checks cover the Rust
rasterizer. GPU tests execute Metal uploads, partial/full render parity, reslices
and simultaneous label outlines; adapter acquisition tests reject a replaced
source between header and data reads.

The task's retained raw logs and command exit receipts live in
`cruft/segmentation-foundation/` in the primary checkout. They distinguish:

- Unit and integration tests, including the module import boundary check and a
  production import-graph check excluding design fixtures.
- Actual Metal GPU tests and native application startup with a synthetic oblique
  NIfTI, world/voxel mapping and rendered views.
- Headless browser parity for the existing H design fixtures: empty, setup,
  tracing, blocked, zoom and the 1280×800 tracing layout. This verifies those
  fixtures; it does not establish parity of the live native workflow.

## Qualification still required

The computer-control service was unavailable during this run. Live native setup
and tracing, physical pen/trackpad input, native undo interaction and measured
paint latency have not been qualified. The M1/M2 native interaction acceptance
gates remain open. Keep the module experimental and off by default.

Sessions are in memory and have no recovery after process exit. Reference and
secondary inputs are single 3D volumes or one explicit frame of a 4D series,
chosen at setup (zero based, defaulting to the layer's current t). The grid and
affine come from the 4D NeuroSpace's spatial part (origin from the transform's
last column); the chosen frame is copied (on a blocking thread) into a
session-owned 3D volume, so the shared time cursor never changes the traced
image. The viewport attaches the copy as a hidden ordinary layer with the
source layer's window; the open document protects it from removal, and
discarding the document removes that layer, which unloads the copy (an
undisplayed copy is released natively). The 4D source stays pinned like any
source. A 4D header, including a single-frame series, is reduced to 3D for
export (temporal dim, pixdim, units, toffset and slice timing cleared). The session
snapshot, Inspector and footer show the frames, and the saved header's
`descrip` records them (`ref frame t`, `sec frame t`, 0-based) with the export
reduced to 3D. The setup preview renders one frame for both images; when a 4D
reference and a 4D secondary use different frames it says which it shows.

Label storage, export and segmentation display cover every u16 label id
(1–65535): categorical palettes tile id k at texel (k mod 2048, k / 2048), and
continuous colormaps stay on row 0. The shared LUT array starts one row tall
(about 0.65 MB, as before) and grows to the next power of two rows only when a
palette needs them, up to 32 rows (about 21 MB) for ids near 65535; it does not
shrink. The segmentation palette is built once per session and the renderer
skips unchanged uploads. A 1024² label-plus-outline frame showed no measurable
time change. Other categorical paths still cap label ids at 2047:
`register_categorical_colormap` in `core/api_bridge/src/lib.rs` (atlases) and
the browser host's palettes and label ids. Per-label slice-count
metadata is bounded to two million entries. Source acquisition uses an optimistic
file-identity/metadata stamp; it does not provide a filesystem snapshot against
changes invisible to that stamp. A GPU failure retains accepted CPU edits and
freezes painting until the display is synchronized.
