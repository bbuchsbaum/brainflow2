# Browser portability through desktop modularization

Preparation and delivery notes: 2026-10-26, checkout based on `69f1e7b7` with
substantial existing uncommitted work. Completed slices cover transport ownership,
native/WASM numerical qualification, published reader APIs and a portable loading
lifecycle. The 2026-10-27 browser milestone below adds a working scalar-volume
viewer and offline PWA shell; desktop feature parity remains a later milestone.

## Outcome and boundaries

Keep one UI and one scientific implementation usable by desktop and browser
hosts. Each preparatory change should improve desktop correctness, testability,
or resource ownership. Preserve affine geometry, numerical semantics, command
payloads, resource reclamation and stale-result rejection.

The first browser milestone should load a user-selected NIfTI, display linked
orthogonal slices, change window/level, add an overlay, and unload everything.
Surface support can then reuse the existing SurfView integration. Full filesystem,
remote-mount and external analysis-process parity is outside that milestone.

## Findings in the current implementation

| Boundary | Current evidence | Useful improvement |
| --- | --- | --- |
| UI to backend | `ui2/src/services/transport.ts` defines `BackendTransport`; `packages/api/src/renderClient.ts` accepts a transport | Keep backend selection at application setup; injected services must retain that backend |
| API composition | `ApiService` used injected transport for rendering but global getters for four domain delegates; its constructor changed the global package helper invoker | Fixed in this slice: own delegates per instance; configure legacy helpers when selecting the application default |
| Domain host calls | Atlas, palette, template and histogram services route through `invokeBackend`; temporal-map services own an injected transport | Browser capability failures propagate without a native fallback; further desktop-only services remain |
| Portable contracts | `render_contracts` depends on serde, ts-rs and `neuro-types` | Preserve this small dependency boundary; its WASM library check passes |
| Numerical core | `volmath` has a cdylib target and wasm-bindgen, but unconditional neuroim and Rayon dependencies | Explicit `web` feature now builds; selected numerical fixtures execute under Node WASM, with broader API qualification still needed |
| Loader input | `bridge_types::Loader::load` accepts `&Path`; NIfTI loader invokes neuroim path readers | Separate source acquisition from decoding; preserve streaming/random-access opportunities rather than requiring a full-file copy |
| Application/host coupling | `api_bridge` depends on Tauri, rendering, loaders, Tokio process support, keyring, remotely and native directories | Extract one tested application operation at a time; native credentials, processes, paths and events stay in adapters |
| GPU scheduling | Owned async submissions are integrated in `abcda9ea`; native polling runs off the caller and browser callbacks complete without blocking | Synchronous adapters remain native-only; direct canvas presentation and broader readback performance are separate work |
| Presentation | UI decodes packets into ImageBitmap; surface runtime already uses SurfView | Separate rendered-frame presentation from readback/export; evaluate direct canvas presentation after correctness is established |

`bridge_types` is not currently a lightweight wire-only crate: it includes decoded
volume variants and loader traits as well as DTOs. Extracting another crate named
"core" without removing these dependency edges would not establish portability.

## Implemented first slice: backend ownership

`ApiService(transport)` now constructs `FilesystemService`, `VolumeApiService`,
`LayerGpuService` and `BatchRenderService` with that same transport. They are
stateless command clients, so this does not duplicate backend volume/GPU resources.
RenderClient already used the instance transport and continues to do so.

`setTransport` selects the application default and configures the legacy
`@brainflow/api` helpers. Lazy native initialization uses the same path. Constructing
an isolated ApiService no longer changes those helpers. Existing service instances
retain their original backend when the default changes; this is not a live backend
switch protocol. The existing global service getters remain compatible for direct
callers, and still need setup before their first use.

This isolates command routing, not all application state: render flags, stores and
diagnostics are still shared. Nor does it eliminate every Tauri import from the UI.
No new WASM adapter, browser file abstraction or capability flags were added before
there is an actual consumer to validate them.

## Preparation slices, in order

1. **Dependency qualification (initial slice implemented below).** Keep a WASM compile gate for the small contracts.
   Audit the pinned neuroim dependency's default features and the need for random
   generation, filesystem codecs and parallelism on the volume-math path. The
   observed failure chain is `volmath -> neuroim -> rand -> rand_core -> getrandom
   0.2.16`, whose browser backend is not enabled. Decide whether to exclude unused
   functionality or configure browser support in its authoritative package. Test
   a deterministic math operation on native and WASM with the same fixture. A
   successful compile alone does not establish thread or numerical behavior.
2. **Source acquisition versus decoding (implemented upstream and published; see third/fourth slices).** First inspect neuroim's reader APIs.
   Introduce a byte/reader decode entry point there if needed, with path loading as
   an adapter using the same decoder. Verify compressed/uncompressed NIfTI, native
   data type, scaling, affine selection, 4D frames, malformed input and cancellation.
   Avoid parsing twice or turning every source into a large JS-to-WASM copy. Use
   explicit source identity/provenance; browser file handles must not masquerade as
   native absolute paths.
3. **One Tauri-independent operation (implemented in fourth slice below).** Extract load/register/unload orchestration
   behind injected source access and resource ownership. Keep Tauri `State`, app
   handles, event emission and command macros in `api_bridge`. Exercise failure
   after decode/upload and stale completion after workspace closure, proving no
   provisional resources survive. Expand the boundary only after this slice works.
4. **Asynchronous renderer completion.** Separate submission, readback and
   presentation with native behavior preserved. Cover cancellation, superseded
   frames, release while work is pending and device loss. Reuse existing Mote work
   `bd-01KWKXZX8CCS38DZFDSBR2VXE7` (readback/ImageBitmap tax) rather than creating a
   competing renderer rewrite. Preserve WGSL/Rust contracts and GPU readback Y-flip.
5. **Browser vertical slice.** Connect an actual worker/WASM transport to the
   existing UI. Establish worker initialization, transferable buffer ownership,
   error/cancel semantics and teardown. Provide explicit unsupported capabilities
   for native-only operations, not mock successes. Validate the NIfTI viewing
   milestone above against native output and independently specified coordinates.

Keep native dialogs, filesystem watchers, SSH mounts, credential storage and process
plugins behind host services. Offline caching and installable-PWA packaging follow
the working browser slice; they do not substitute for these boundaries.

## Verification for the first slice

- Four transport-isolation regression tests fail against the original two source
  files and pass with this change. They cover independent instances, changing the
  default, legacy helpers, routing across all four delegates plus rendering, and
  propagation of an unavailable-source error without a fallback backend.
- Eight focused Vitest suites pass: **41 tests**. Invocation uses
  `NODE_OPTIONS=--no-experimental-webstorage` with Node 26.7.0 because the default
  experimental storage implementation causes the existing jsdom setup to fail
  during import before tests execute.
- `pnpm --filter temp-ui build` passes (TypeScript and Vite); Vite reports large
  bundle chunks. This is a UI build, not a native desktop or browser acceptance run.
- `CARGO_TARGET_DIR=/tmp/brainflow-web-prep-target cargo check --locked --offline
  --target wasm32-unknown-unknown -p render_contracts --lib` passes, with ts-rs
  serde-attribute warnings. The same command for `volmath` fails in getrandom as
  described above. Neither command executes WASM in a browser.
- Scoped ESLint reports 21 errors and five warnings in `apiService.ts` and
  `transport.ts`. A before/after JSON diagnostic comparison confirms the same
  file/rule/severity/message counts; the new regression suite has no diagnostics.

Local logs: `/tmp/brainflow-web-prep-{tests,build,wasm,volmath,lint}.log` and
`/tmp/brainflow-web-prep-regression-before.log`. Mote issue:
`bd-01M5X4GWZPQ4PCS22Q0TTFV0Y5`. No scientific algorithm or renderer changes, no
native/GPU visual acceptance claim, and no publication in this slice.

## Second slice: executable volume-math qualification

`volmath` now exposes an explicit `web` build feature for JavaScript-hosted WASM.
It enables the existing getrandom 0.2 dependency's JS backend only for
`wasm32-unknown-unknown`. This is Brainflow's host choice; the pinned neuroim
library is unchanged. Native default features and dependency versions are
unchanged. The lockfile adds only volmath's direct getrandom dependency edge.

The pinned neuroim manifest unconditionally includes rand, Rayon, memory mapping
and file I/O, and enables image support by default. Disabling default features
alone therefore does not isolate the numerical core. Its inspected volume-reader
entry points accept paths; a reader-based decoder remains upstream work. Although
the complete volmath library now compiles, this does not make mmap or filesystem
operations usable in a browser.

`core/volmath/tests/portability.rs` runs identical analytic fixtures as native Rust
tests and wasm-bindgen tests under Node:

- Non-cubic x-fastest voxel layout, borrowed contiguous data and out-of-bounds
  lookup.
- Rotated, anisotropically scaled and translated affine coordinates, checked
  against separately specified voxel/world pairs.
- Linear resampling of `f(x,y,z) = x + 10*y + 100*z` at a known half-voxel point.
  This executes neuroim's Rayon iterator path. The pinned Rayon core supports a
  current-thread fallback when threads are unavailable; this is correctness
  evidence for that operation, not parallel execution or performance evidence.
- A WASM-only host entropy availability check; no random-quality claim.

Verification on 2026-10-26:

- Native volmath: **16 tests passed, one existing performance test ignored**.
- Node 26.7.0 WASM integration fixture: **four tests passed**, using
  wasm-bindgen-test-runner **0.2.100**, matching Cargo.lock.
- WASM volmath library build with `--features web`: passed.
- Native `cargo clippy -p volmath --all-targets`: passed.
- New fixture rustfmt check, scoped Git whitespace check, CI YAML parsing: passed.
- Initial native run in the shared target directory failed because a referenced
  itoa artifact was missing. The successful rerun used an isolated target directory;
  no shared Cargo cache was cleaned or repaired.

The existing CI WASM build now selects `--features web --lib --locked`, and a
render-contract WASM check precedes it. Hosted CI has not run. The Node runtime
fixture is reproducible locally but is not yet installed as a hosted CI step.

Reproduce from the repository root (set the runner to an installed executable
matching Cargo.lock; these commands do not install tools):

```sh
cargo test --locked -p volmath
cargo check --locked -p render_contracts --lib --target wasm32-unknown-unknown
cargo build --locked -p volmath --lib --features web --target wasm32-unknown-unknown
CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUNNER=/path/to/wasm-bindgen-test-runner \
  cargo test --locked -p volmath --features web \
  --target wasm32-unknown-unknown --test portability
```

Use `CARGO_TARGET_DIR` for an isolated build and `--offline` when dependencies are
already cached. Local receipts: `/tmp/brainflow-web-volmath-{native-isolated,node,
build,clippy}.log`. Mote: `bd-01M5X5EN3GJG2ZA6EWRZ7R9Y5T`.

This is Node-hosted WASM evidence, not browser, worker, GPU, file-loading or full
API qualification. Next: inspect and separate neuroim source acquisition from
decoding, preserving native format/scaling/affine semantics, before adding a
browser file adapter.

## Third slice: shared NIfTI decoder, native paths and portable readers

Implemented in the authoritative `../rust/neuroim-rs` checkout, based on the
same `78d4e61f3e7dc7e759f38d02b85f9da41ee70d8a` revision Brainflow pins. The new
public functions in `neuroim::io` are:

- `read_vol_from_reader_as`: 3D volume or one selected 4D frame, with the existing
  f32-based conversion and standard memory layout.
- `read_vol_from_reader_as_column_major`: 3D converted volume retaining x-fastest
  storage.
- `read_vol_from_reader_native_as`: strict 3D native-dtype decode, preserving the
  existing refusal of nontrivial scaling or a mismatched requested type.
- `read_vec_from_reader_as`: complete 4D series with the existing conversion.

Each accepts `impl Read` and shares a private object-to-volume decoder with its
existing path counterpart. No numerical conversion, geometry selection or data
ordering logic was duplicated. Path acquisition still uses `ReaderOptions`, so
gzip detection and paired `.hdr`/`.img` resolution remain available. Single-stream
readers accept decompressed `.nii`, reject paired inputs and do not seek. A
`Cursor<&[u8]>` avoids an extra owned input copy; `GzDecoder<Read>` composes gzip
decompression without requiring a fully decompressed input buffer first. The
NIfTI object and output volume are still materialized in memory.

`Read` errors propagate, including a source error partway through the voxel
payload. This permits a source-controlled abort, not async cancellation or a
complete browser worker lifecycle. Browser file acquisition, resource limits,
registration/upload and workspace stale-result handling remain later boundaries.

The upstream `tests/test_io_readers.rs` uses hand-built NIfTI bytes, independently
specified values and affines, and no production writer as its oracle. It covers
little/big endian, extensions, scaling (including slope zero), dtype refusal,
sform precedence/qform fallback, non-cubic layout, 4D frame bounds, gzip, truncated
and aborted sources, recovery after an error, and native path/reader parity.
`tests/wasm/Cargo.toml` is a separate unpublished host harness for the same tests;
it supplies JS entropy support without changing neuroim's library defaults.

Verification receipts are under `/tmp/brainflow-reader-slice/`:

- `native-full.log`: upstream native suite, 402 passed and 10 ignored, including
  five new reader tests and six doctests.
- `wasm-readers.log`: four reader tests executed as WASM under Node; filesystem
  parity runs only natively. See upstream `tests/wasm/README.md` for commands.
- `brainflow-loader.log`: Brainflow's existing NIfTI-loader suite using a temporary
  Cargo path override for the modified upstream library; 18 passed, one ignored.
- `clippy.log`: upstream library and new test lint check; existing crate-wide
  warnings remain. Scoped formatting and whitespace checks pass.

At this slice's completion the changes were local in neuroim-rs and Brainflow's
lockfile was restored after qualification. The fourth slice below publishes them
and updates Brainflow's pin. No persistent path override or vendored fork was
added. Mote issues:
`bd-01M5X6M5A8D6J4FCQXW7BHBDK4` (upstream) and
`bd-01M5X6FHWWATXPVNX3MWK59A26` (Brainflow).

## Fourth slice: publish the reader API and extract the loading lifecycle

Neuroim reader changes are committed and pushed as
`0fbedb93b4bb4e7aec663c7466c39a0eb6760417`. Before publication, `origin/main`
and local HEAD had no divergence, and all six artifact hashes matched the tested
third-slice receipt. After push, `git ls-remote origin refs/heads/main` matched
the commit. Brainflow's workspace dependency and lockfile now select this
revision. Neuroatlas's existing transitive neuroim dependency retains its older
pin; it was not silently overridden. There is no local path patch in the normal
dependency graph.

`core/volume_service` owns the load/acquire/publish/unload sequence and publication
scope. Its normal dependency graph contains no Tauri, WGPU or Tokio. Hosts inject
`VolumeSource` and `VolumeRepository`; the service passes concrete decoded-volume,
metadata and handle types. A `PreparedVolume` retains data until publication.
`LoadScope` can permanently revoke publication; its final synchronous commit is
serialized with closure. Dropping a pending load revokes that request's scope.
The repository contract requires awaited preparation before the final insertion,
with no await or fallible work afterward.

The explicit `web` feature forwards through `bridge_types` to `volmath/web`, so
the normal WASM library graph selects JavaScript host entropy. Native defaults
are unchanged. A service-only WASM library check passes, and the same check is
now in CI. This compile gate does not execute a browser backend.

The desktop adapter is `core/api_bridge/src/volume_loading.rs`. It owns remote
materialization, path checks, blocking decode and header metadata reads. The
existing `load_file` and `unload_volume` commands delegate to the new service;
their arguments and response shapes remain the same. Metadata completes before
registry insertion, eliminating the old await after publication. The native
decoder still finishes an admitted blocking call if its async caller disappears;
its result is then dropped without registry publication.

GPU resources remain a later, separate desktop operation. A provisional upload
guard is created inside the blocking worker immediately after allocation. It owns
rollback through awaited bookkeeping and transfers ownership to the existing
`LayerLease` only when that lease exists. A failed continuation or dropped waiter
retains cleanup ownership. Cleanup removes only maps matching its allocation.
A desktop operation gate serializes GPU preparation, explicit release and CPU
unload; duplicate active allocations for the same layer are refused. No GPU
readback scheduling was changed.

Unloading continues to refuse active layer mappings. Once those are released, it
removes CPU volume/parcel state and custom colormap state. Surface sampler entries
now record their template volume ID; unload removes matching samplers, and sampler
publication rechecks that its template is still loaded.

Workspace identity still belongs to the UI in the desktop workflow. The existing
UI checks for destination closure after asynchronous preparation and GPU loading,
then releases the provisional GPU layer and unloads the CPU volume. New focused
tests exercise those paths. `LoadScope` provides the corresponding explicit
publication right for native/other hosts; this slice adds no backend workspace
registry or new invoke command. Source-returned read errors can abort a decode,
but ordinary native decode is not forcibly interrupted.

Verification receipts live under `/tmp/brainflow-lifecycle/`:

- `service-tests.log`: six lifecycle tests cover successful registration/removal,
  source and publication errors, dropped callers, scope closure during acquisition
  and publication waits, and active-layer refusal.
- `native-tests.log`: five desktop tests, including real GPU upload rollback,
  cancellation while the blocking worker retains an allocation, normal GPU release
  then CPU unload, native file loading, and publication closure while waiting.
- `api-lib-tests.log`: 245 passed, three ignored, including the template-sampler
  unload test and existing GPU/lease/resource tests.
- `ui-tests.log`: 17 passed across the API isolation, layer and provisional-volume
  suites. The UI checks use simulated backend responses and complement the native
  GPU tests above.
- `ui-loading-regressions.log`: 16 additional existing volume-loading and display
  lifecycle tests passed.
- `ui-build.log`: TypeScript/Vite production build passed; existing large-chunk
  warnings remain.
- `service-dependencies.log`: normal service dependency tree; no Tauri/WGPU/Tokio.
- `service-wasm-check.log`: WASM library check passed with `--features web`.
  The initial test-dependency feature selection was insufficient under Cargo's
  resolver; explicit normal dependency feature forwarding fixes that boundary.
- `workspace-tests.log`: 952 passed, 29 ignored across 146 test suites, including
  doctests. No explicit skip messages were present in the captured output.
- `clippy.log`: workspace Clippy with all targets passed, with existing warnings
  outside the new lifecycle code. The new UI ownership suite has no ESLint
  diagnostics; the extended layer test retains its nine original diagnostics.
- `permissions.log`: strict command/permission inventory passed (122 commands);
  no command surface was added. Scoped Rust formatting, whitespace and CI YAML
  parsing also pass. Hosted CI has not run for these local Brainflow changes.

Evidence is recorded in Mote issue `bd-01M5XEH3YP1QQV4M86ZB6E1T3P`. The wider
workspace build was initially stopped when free space fell below 20 GiB; only
inactive artifacts created by this task were reclaimed before resuming checks.
After final feature/duplicate-allocation assertions, the six service and five
desktop ownership tests are rerun with a fresh non-incremental task target.
The upstream publication is complete;
Brainflow changes remain local in its existing dirty checkout. Browser runtime,
native UI walkthrough, GPU performance and async readback qualification remain
separate work.


## Fifth slice: working browser host and offline viewer (2026-10-27)

Implemented from checkout `851d57f9`, preserving its unrelated dirty work. The
preceding loading extraction (`13d5b7c`) and async readback (`abcda9ea`) are already
integrated. The latter's original completion was performed by another session;
this run independently reruns the renderer regressions on the new sources.

- `render_loop/web` forwards portable entropy configuration. Tokio's multithread
  runtime, the filesystem shader watcher and the synchronous GPU trait adapter
  are native-only. Production timers/counters use web-time, which reexports std
  clocks natively and uses browser clocks on WASM. The complete renderer builds
  for `wasm32-unknown-unknown`.
- The active shaders use individual texture bindings, so unused native binding
  array/nonuniform-indexing device features are no longer requested. Their
  single-level colormap LUT uses explicit LOD 0. Browser Tint rejected the prior
  implicit-derivative call inside nonuniform per-pixel branches; the initial
  failing pixel receipts are retained rather than accepted as blank output.
- `core/browser_host` composes the published neuroim reader, `volume_service` and
  the WGPU facade. It bounds compressed/expanded input and resident voxels,
  preserves source affine/scaling, and rolls back CPU publication on failed GPU
  upload. Shader/upload/render validation scopes surface browser GPU failures.
- A dedicated worker owns file reads, WASM data and GPU resources. Browser `File`
  objects are cloned in, frame buffers transfer out, and IDs/cancellation/late
  reply cleanup retain ownership. `RenderClient` and the existing RGBA envelope
  are reused. The minimal browser shell reuses the shared slice viewport,
  controls/theme, linked crosshair state, window/level, scalar overlay opacity,
  unload and teardown. It is a separate entry in the same UI package, not a
  replacement for the desktop workspace.
- Five previously direct desktop domain clients now use the selected transport.
  Native-only browser capabilities fail explicitly. The worker also isolates a
  WGPU 0.20/current-WebGPU descriptor compatibility translation; native APIs and
  dependency pins stay unchanged.
- `tools/build-browser.mjs` builds Rust and shared JS sources, creates WASM
  bindings and a static production bundle, then precaches its exact application
  assets. User-selected files are not persisted in the service-worker cache.
  Updates wait for all old viewer windows to close. See
  [Browser viewer](../browser-viewer.md) for build/run commands, requirements,
  bounds, ownership and independent-fixture qualification.

Qualification receipts are local in `cruft/browser-portability/`. Native analytic
geometry/pixel tests, actual Chromium/Metal WASM pixel comparisons and browser UI
interaction tests are separate from the production offline/installability gate.
The full UI suite records 2,517 passed, three skipped and one todo. The renderer
suite records 242 passed and 19 ignored, with no explicit GPU skip lines. This is
not qualification of every format, browser, adapter or native desktop UI. Hosted
CI was not executed in this session; its WASM library compile gate is extended to
`browser_host`.

Remaining product work is broader desktop parity (labels, time series, surfaces,
atlas/template catalogs and native services), more browsers/adapters, lower-limit
WebGPU devices, and optional direct canvas presentation. These are outside the
first volume-viewing milestone and must not be inferred from these checks.
