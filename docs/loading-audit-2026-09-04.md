# Loading, UI and display-efficiency audit — 2026-09-04

Audited application source `fe494805465ad2cd83c35ebb1edee04d1e5000c8`.
No production code was changed in this audit. The user's unrelated working-tree
changes were preserved. Desktop visual acceptance remains separate; this pass
used source tracing, controlled async/failure probes, existing tests, and local
release-library CPU/Metal measurements. No live SSH server was contacted.

## Fix first: loading as a complete, workspace-owned operation

Five intended behavior checks fail against the current implementation:

1. **A delayed volume load writes view geometry into the newly active workspace.**
   `VolumeLoadingService.initializeViews` awaits its prefetched views and then
   calls the active store's `updateView` without an origin-workspace identity.
   A controlled A → B switch produces writes to B. `DisplayLifecycleOrchestrator`
   captures some intent context, but does not pass a destination workspace through
   the complete load/publication path. The previous navigation fix does not cover
   this independent loading lifecycle.
2. **A geometry failure can be reported as a successful load with invented world
   bounds.** `VolumeLoadingService.getVolumeBounds` catches a backend failure and
   uses `[0,0,0]..dimensions` as millimeters. For the 65 × 65 × 49 fixture this
   means `[0,0,0]..[65,65,49]`, instead of its affine bounds
   `[-64,-64,-72]..[64,64,72]`. The probe expecting the load to fail instead resolves
   successfully. Fail visibly or derive bounds from a verified affine.
3. **Failed layer creation does not release its decoded backend volume.** The
   load command has already registered a fresh volume. When `addLayer` fails,
   the frontend clears its handle/metadata but never calls `unloadVolume`;
   the outer orchestrator only records the error. The controlled GPU-allocation
   failure records zero unload calls. Surface loading has an analogous partial
   publication path: it adds the surface before fetching geometry, then catches
   failure without removing that surface or unloading its backend handle.
4. **Late histogram refinement overwrites user display changes.**
   `LayerApiImpl.refineIntensityFromHistogram` checks only whether the layer still
   exists. A probe edits intensity to `[31,47]` while the histogram is pending;
   completion replaces it with `[2,98]`. Add a display revision/default-value
   check and preserve workspace identity for the refinement.
5. **An old directory response can replace a newer refresh.**
   `fileBrowserStore.loadDirectory` has no per-path request ordering. A newer
   listing containing `new.nii` is replaced by a delayed older listing containing
   `a.nii.gz`. Apply the same request-generation discipline used for slice resize.

Relevant source: `ui2/src/services/VolumeLoadingService.ts` (load, cleanup and
view initialization), `DisplayLifecycleOrchestrator.ts` (intent and publication),
`LayerApiImpl.ts` (background histogram), `SurfaceLoadingService.ts` (load catch),
and `ui2/src/stores/fileBrowserStore.ts` (directory response application).

Recommended contract: capture destination and intent once; admit a bounded
number of loads; acquire decode/GPU resources provisionally; publish only while
that request is still valid; otherwise release every acquired resource. Errors
must leave no half-loaded layer. Completion should distinguish allocation from
the first displayed frame. Preserve explicit user edits against late defaults.

## Remote loading: timeout ownership and cache lifecycle

**The 30-second transfer deadline is unsuitable for large images.**
`REMOTE_FS_OPERATION_TIMEOUT` is reused for stat, listing and the entire download
in `materialize_remote_file_if_needed`. A healthy 1 GiB transfer at 20 MiB/s needs
about 51 seconds, before decoding. Transfer deadlines should distinguish no
progress from total elapsed time and surface actual byte progress.

**Timing out does not cancel the transfer.** The pinned `remotely` revision
`ea3732a` implements `download_to_path_blocking` using `spawn_blocking` plus an
inner runtime `block_on`. The bridge times out while awaiting that worker. Its
semaphore permit is released although the worker can continue. A standalone
Tokio probe confirms this exact timeout/worker-lifetime mechanism: the timeout
returns, then the worker performs its side effect. This is not a live SFTP test.
Retry, unmount and cache purge therefore need explicit cancellation/drain
ownership, not just a timeout around the await.

**The cache has no durable reuse/budget policy.** Each successful connection uses
a new UUID for its local cache root; ordinary Files-panel unmount passes
`purgeCache: false`. Reconnecting creates another cache directory. There is no
remote-cache disk budget/eviction path in this implementation. Use a stable
endpoint/root cache identity, separate from the live session, and expose usage
and clearing. Cache hits currently check local existence and remote sidecar
metadata, but not local length/integrity. Missing remote mtimes also reduce the
freshness check to identity plus remote size.

There are useful foundations: streamed downloads, unique temporary filenames,
finalized files, endpoint/path/size/mtime metadata, host-key/auth challenges,
per-mount operation limits, and retry/recovery events. `remotely` already exposes
a byte-progress callback; Brainflow's download options do not attach one. Keep
these capabilities and fix their ownership and product integration.

Relevant source: `core/api_bridge/src/lib.rs:1295`, `:2342`, `:2436`, `:5270`,
`ui2/src/components/panels/FileBrowserPanel.tsx:261`, and the pinned dependency's
`src/fs/mod.rs:644` and `:690`. The `remote_mount_` test filter currently runs only
one profile-default test; the broader `remote` filter runs four metadata/preview
tests. Neither exercises a live interrupted or slow transfer.

## UI design: make every action real and status truthful

- **The Inspector's Load menu is a dead end.** Its four handlers (volume,
  surface, atlas and projection) only call `console.info`. The router is the
  registered right-rail Inspector, including legacy panel aliases; this is an
  exposed control, not merely an unused example. Route it through the canonical
  file/template/surface services, or remove unavailable actions from the alpha.
- Replace hard-coded progress jumps (volume 10 → 50 → complete; surface
  10 → 30 → 80 → complete) with useful stages: connecting, downloading bytes,
  decoding, preparing display, displayed. Use indeterminate status when the
  work cannot be measured. Do not claim a percentage of total work from arbitrary
  milestones.
- Reuse the existing progress service's retry support. The Activity panel itself
  is read-only, and load tasks are not wired to a working transfer cancellation
  path. Make recovery available where the error is shown, after implementing
  cancellation ownership; do not add a cosmetic Cancel button.
- Keep the existing Files-panel foundations: virtualized tree, keyboard handling,
  selected-file summary, remote origin badges, and Tree/BIDS/Images/Loaded modes.
  Consolidate their open actions and error behavior before more layout redesign.

Sources: `ui2/src/components/inspector/InspectorRouter.tsx:99`,
`ui2/src/components/inspector/imaging/LoadSheet.tsx`, `ActivityPanel.tsx`,
`ui2/src/services/ProgressService.ts`, and the two loading services.
These are code/interaction-contract observations, not screenshot-based styling
judgments.

## Efficiency measurements and opportunities

Local Apple M3 Max, arm64 release libraries from the alpha build; separate
optimized probe drivers. Decode runs warm the input once and collect 11 repeats;
the table reports a second run's median, not cold-disk or user-perceived latency.
The NIfTI is the repository's 34,120,436-byte MNI T1 fixture; its gzip comparison
was generated with Python gzip level 6. The surface has 32,492 vertices.

| Operation | Median |
| --- | ---: |
| MNI NIfTI, uncompressed decode | 62.7 ms |
| Same data, gzip decode | 110.4 ms |
| GIfTI, one geometry decode | 15.0 ms |
| GIfTI, content detection followed by geometry decode | 34.4 ms |

The first run's respective medians were 53.7, 131.2, 18.2 and 53.4 ms. These
small samples show variability and avoid supporting a precise speedup promise.
The redundant surface parse itself is source-confirmed: the detector calls
`read_surface`, and `load_surface` then reads geometry again. Both run directly
inside an async bridge command, unlike the NIfTI decoder's blocking-worker path.
Decode a surface once and return metadata and geometry together from a worker.

The real backend rendered three 512 × 512 slices into one RGBA response:
first request **695 ms**, then **82 ms** in a second fresh process; warmed
21-request medians **5.94 ms** and **5.22 ms**, p95 **8.42 ms** and **6.47 ms**.
GPU initialization and volume decoding were measured/executed separately. Each
response contains **3,145,771 bytes**. The large first-use difference merits
profiling of preparation/caching; it is not an end-to-end startup benchmark.
The probe does not measure Tauri transport, bitmap creation, canvas presentation,
mouse-to-screen latency, multiple layers, large surface scenes or 4D navigation.

Further concrete work:

- `render_views_process_with_diagnostics` holds one service lock but still uses
  **Blocking readback once per orthogonal view**. The montage path already has a
  batched readback implementation. Extend that strategy to orthogonal views and
  compare output bytes/goldens before claiming an improvement.
- Histogram calculation takes an Arc to the volume, but then allocates a new
  f32 vector of retained values and makes multiple passes through it on an async
  worker. Use bounded-memory passes off the async runtime; preserve finite-value,
  zero-exclusion and statistical behavior with independent fixtures.
- The loading store records a queue, but callers immediately start each job.
  It is not a bounded scheduler for local decode or GPU upload. A many-file open
  can create simultaneous full-volume allocations. Add backpressure and per-path
  shared work before considering mmap, parallel gzip or a decoded-data cache.
- Raw RGBA and resident-image-set/batched-montage work are already present. Avoid
  reintroducing PNG or full-volume cloning; measure remaining transport and bitmap
  costs rather than assuming the renderer itself is slow.

## Evidence and next implementation order

Existing checks: **41 UI tests passed** in seven targeted files; **4 remote bridge
unit tests passed**; **16 loader tests passed, 2 ignored**. Isolated reproductions:
**5 expected safety assertions failed**, with eight existing/control tests passing.
These failing probes characterize current defects; they are not checked into the
normal suite as passing coverage. The timeout mechanism probe passed. No live
SSH, hosted CI, native UI automation or visual acceptance is claimed.

Receipts, probe source, fixture hashes and build details are retained under the
ignored local folder `dist/alpha/loading-audit-2026-09-04/`.

1. Make load publication/rollback workspace-safe; protect user contrast changes;
   reject invalid geometry; order directory responses.
2. Wire the Inspector Load actions and expose reliable stage/error/retry feedback.
3. Own remote transfer cancellation, timeout policy, progress and cache budget;
   add a disposable SFTP integration fixture for slow/interrupted/retried loads.
4. Remove duplicate surface decode, then profile first-use preparation, histogram
   allocation and orthogonal batched readback with fixed workloads.
