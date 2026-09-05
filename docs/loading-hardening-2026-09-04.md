# Alpha loading and display hardening — 2026-09-04

This pass implements the four follow-ups from
[the loading audit](loading-audit-2026-09-04.md). It is local implementation and
verification evidence, not a claim of completed manual acceptance or a published
release.

## Loading ownership and recovery

Volume file, template and atlas requests retain their destination workspace across
backend awaits. GPU allocation completes before a layer and its initial geometry
are published into that workspace. A closed destination fails with rollback;
loading into an existing workspace preserves its cursor and framing. Missing world
bounds fail explicitly instead of interpreting voxel dimensions as millimetres.
Failed allocation releases provisional GPU resources, and failed volume loads
unload decoded backend data. Surface geometry is retrieved before store publication;
a failed retrieval unloads its provisional surface.

A shared two-slot FIFO limits concurrent file decoding and GPU admission. Late
histograms refine only unchanged display properties. Directory listings carry
request identities so old responses cannot replace refreshes, reopen collapsed
folders, or repopulate unmounted roots. Unloading a volume removes its view-layer
references from every workspace. Directory rows no longer invent random file sizes.

## Working Inspector actions

Load volume and Load surface open the canonical file dialog. Load atlas opens the
catalog and configuration dialog, then creates the displayed atlas layer through
the shared loading service. The catalog currently offers volume-compatible spaces;
surface-atlas workflows remain in their existing routes. Project volume to surface
asks for both loaded inputs and uses the existing projection service. The Load menu
supports arrow keys, Home/End, Escape, outside click, and focus restoration.

Activity shows actual remote transfer bytes and exposes cancellation while a
transfer is active. Local reads and display preparation use named, indeterminate
stages instead of arbitrary percentages. Existing error history and retry paths
remain available.

## Remote transfer and cache policy

Remote filesystem futures remain inside runtime-safe blocking adapters. Their
operation permits belong to the worker, and cancellation/deadlines are applied to
the actual inner future. Downloads use private UUID staging directories whose
cleanup completes before the worker releases its permit. Unmount cancels active
writers, waits for cache admission and operation drain, then closes the session
and optionally purges the cache.

Downloads allow 90 seconds without byte progress and a one-hour total duration.
Metadata/list operations retain a 30-second bound inside their owned workers.
Progress notifications are throttled to ten per second plus completion.

Cache identities derive from the SSH endpoint, user and remote root rather than
session UUIDs, allowing reconnect reuse. Cache hits require the expected local file
length and matching remote size and known modification time. The remote file is
checked again after download. Unknown modification time forces a fresh download;
size/mtime validation is not cryptographic content validation.

The default disk budget is 4 GiB; `BRAINFLOW_REMOTE_CACHE_BYTES` overrides it.
Admission accounts for the incoming staged copy, serializes downloads to avoid
overbooking, and evicts inactive mount roots by last use. Active mounts remain
pinned to avoid racing decoders. If pinned content leaves insufficient space,
loading fails with instructions to unmount unused folders or raise the budget.
Directory browsing remains independently bounded per mount.

## Efficiency and numerical contracts

Surface geometry is retained from a single decode on a blocking worker. Histogram
calculation makes two passes without a retained voxel vector, uses f64 moments,
rejects invalid bin allocations/ranges, excludes non-finite samples, and preserves
the contract that an explicit range restricts bins but not summary statistics.

Orthogonal views render into distinct targets, then read all panes through one
aligned GPU buffer and one blocking readback, including panes with different sizes.
The montage wrapper retains its existing API. All image-coordinate conversion stays
at the established GPU readback boundary. Shared readback time is reported as
`RenderViewsDiagnostics.readback_ms`; individual submit stages report `Skip`.

Fixed local workload measurements (release builds, Metal, one MNI volume, three
512 × 512 RGBA views; 21 warm frames per process):

| Measurement | Before | After |
|---|---:|---:|
| Warm three-view median, run 1 | 5.717 ms | 2.797 ms |
| Warm three-view p95, run 1 | 7.227 ms | 3.804 ms |
| Warm three-view median, reversed order | 5.791 ms | 3.356 ms |
| Warm three-view p95, reversed order | 6.752 ms | 4.800 ms |
| Histogram median, 8 million f32 voxels, 256 bins, 11 repetitions | 50.982 ms | 26.511 ms |
| Histogram retained voxel scratch | 31,968,000 bytes | 0 bytes |

The new histogram uses 2,048 bytes of count scratch plus its output bins. Benchmark
bin counts match the previous implementation. Warm render medians improve by
42–51% in these runs. First-use timings vary with device/pipeline caches and are
retained in the receipts without treating them as a stable speedup. These are
backend timings; Tauri transport, bitmap presentation and mouse-to-screen latency
are not included.

## Verification and remaining release gates

- Full UI suite: 1,311 passed, 3 skipped, 1 todo; focused checks also cover final
  review corrections and workspace-close/scoped-publication cases.
- Broader `api-bridge` and `render_loop` pass: 374 passed, 19 ignored across 82
  reported suites. The ignored tests remain explicit limitations.
- Metal gates: four render goldens, three shader contracts and three batch-readback
  tests pass; unequal, non-row-aligned panes match sequential bytes exactly.
- Eleven native bridge rendering integration tests pass, including mixed-size
  output, 4D member changes and GPU resource release.
- Remote suite: ten checks pass, including a real disposable localhost SSH/SFTP
  server proving a 1 MiB download, mid-transfer cancellation, idle failure, removal
  of partial files, release of capacity, and successful retry.
- TypeScript compilation, production UI build, optimized Rust bridge build, binding
  regeneration and the strict 104-command permission check pass.

Receipts and benchmark sources are under the ignored local folder
`dist/alpha/loading-hardening-2026-09-04/`. Existing user edits and 520 tracked
working-tree deletions were preserved.

Manual native visual acceptance remains deferred at the user's request. The live
SFTP fixture does not certify every SSH server/authentication method or real WAN
failure mode. Windows/Linux packaging, hosted CI and notarized distribution are
separate release gates. This pass does not certify the app as bug-free.
