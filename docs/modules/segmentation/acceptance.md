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
  late commands; ordinary layers can retain the accepted label snapshot.

Later architecture work includes settings schemas, typed module events,
startup aliases, BIDS/Studio migration, loader/provider registries and scaffolding.
Segmentation M3–M8, saved-session recovery, proposals and AI remain later work.
The NIfTI writer is a core prerequisite; this milestone has no Save workflow.

## Evidence

The source includes behavior tests for stale async replies, disable/re-enable,
close routes, lost acknowledgements, text-field/native Edit routing, lock and
history semantics, allocation failure and GPU-slot reuse. Independent synthetic
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
secondary inputs must be single 3D volumes. Label storage/export supports u16;
the current categorical renderer accepts label ids 1–2047. Per-label slice-count
metadata is bounded to two million entries. Source acquisition uses an optimistic
file-identity/metadata stamp; it does not provide a filesystem snapshot against
changes invisible to that stamp. A GPU failure retains accepted CPU edits and
freezes painting until the display is synchronized.
