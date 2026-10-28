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

## Sixth slice: adapter-sized GPU layouts (2026-10-27)

The browser host now opts into `RendererCapacityPolicy::FitAdapter`. A single
resolved capacity drives the texture manager, binding layouts, device request
and both authoritative masked WGSL shaders. Shared composition generates only
resource declarations and explicit texture sampling switches; geometry,
thresholding, compositing, physical scalar units and the readback Y-flip stay
in the existing kernels. Native callers keep the fixed 13-slot default and
smaller-request padding. The alternate smart texture manager rejects a reduced
layout before changing state.

A 16-sampled-texture device uses seven volume/mask pairs and the shared colormap.
The browser reports actual device/layout capabilities and limits resident files
to the lesser of four or its slot count. Missing adapters, inadequate texture
budgets and absent R32Float filtering fail at startup with recovery guidance.
There is no reduced-precision fallback or WGPU dependency upgrade.

Local receipts are in `cruft/gpu-compatibility/` (Mote
`bd-01M5ZTT333ZBK61E557RN8EKW3`):

- Both shaders validate and reflect the same Rust struct/binding contracts at
  1, 4, 7 and 13 slots. The full native renderer suite passes 246 tests, with
  19 ignored and no explicit GPU-skip lines. Its constrained 16-texture device
  matches desktop pixels in both interpolation modes and for last-slot legacy
  alpha masks, then checks exhaustion, slot reuse and staging teardown.
- Two real native browser-host tests cover independent oblique geometry/pixels,
  input/upload failure cleanup, unload and actual one-slot residency/reuse.
- WASM release/static PWA build and TypeScript compilation pass. Six actual
  Chromium 156/Metal tests cover default/adaptive pixels, constrained-device
  cancellation/unload, insufficient texture and missing-f32 startup rejection,
  linked controls, offline reload and installability. Native/all-target Clippy,
  WASM Clippy and scoped UI lint pass; WASM Clippy retains existing shared
  `Arc` warnings and ts-rs attribute warnings.
- Firefox 157 exposes WebGPU but returns no adapter on this Mac. Its actual
  viewer startup failure and recovery message pass. The installed frozen
  Playwright WebKit build for macOS 14 crashes before page creation. Neither
  result qualifies rendering on those engines; another supported machine/adapter
  is required for that evidence.

The mask check uses the legacy alpha-mask API: declarative `ViewState` does not
carry mask ownership. That pre-existing API boundary is unchanged. Broader
desktop features, additional working browser/adapter combinations and optional
direct canvas presentation remain future slices. No deployment or hosted CI
run was performed.

## Seventh slice: shared 4D frames and browser time navigation (2026-10-28)

Existing spatial-frame extraction, frame bounds and affine/dimension helpers move
from `api_bridge` into the concrete `volume_service::frames` module. Desktop
queries and browser loading call those same helpers. This removes the desktop
implementation copy without introducing new traits or a service registry.

The browser accepts scalar 3D/4D NIfTI, including gzip. Existing decoded-voxel
budgets now count every frame. One decoded series and one resident GPU slot belong
to each loaded image; selecting a frame replaces that slot through the renderer
facade. A 3D f32 source remains borrowed during upload. The display window uses
the series range and stays fixed while stepping.

The browser session reuses its existing active/latest render loop. Each snapshot
selects the required host frames before rendering all three slices; obsolete
results are discarded. The host alone tracks the uploaded frame and ignores
repeat selections. Playback uses one timer after completed presentation, with a
250 ms pause; reset, unload, closure and render failures stop it. No prefetch
cache or additional scheduler is introduced. Frame indices do not imply
acquisition-timed playback.

The public oblique 4D fixture uses values `i + 10*j + 100*k + 1000*t` on the same
rotated anisotropic grid as the 3D fixture. Native checks select 0, 2, 1, 0 using
an actual one-slot GPU device, verify independent pixel values and unchanged
geometry, reject out-of-range requests before changing output, and reclaim the
volume. Browser checks compare the same frames with native packets and exercise
stepping/play/pause/unload. Session tests cover rapid scrub coalescing and reset
during an in-flight frame change. Receipts live in `cruft/browser-4d/` under Mote
`bd-01M61F0JDHNR6DJQVQQEM6DC1E`.

Final local checks: shared service 7 passed, desktop volume queries 14 passed,
native browser host 3 passed, renderer 246 passed/19 ignored, browser session
3 passed, and real Chromium/Metal browser 8 passed. WASM/PWA/TypeScript builds,
scoped UI lint, native/WASM Clippy and formatting checks pass with existing
ts-rs and shared WASM Arc warnings. Browser rendering qualification remains
Chromium/Metal on this machine; no hosted CI or deployment was performed.


## Eighth slice: categorical labels (2026-10-28)

The browser now opens 3D categorical NIfTI, with an optional local TSV/FreeSurfer
LUT, through the existing loading lifecycle. Label intent is recognized; the
explicit Open labels action handles files without that intent. IDs are restricted
to 0–2047 and identity scaling. Native-type readers validate values before any
f32 conversion; the general neuroim reader intentionally converts through f32
and is unsuitable for validating exact source labels.

Reuse and simplification:

- `WgpuSliceRenderer` exposes the existing label-aware upload and palette
  operations; shaders and upload encoders are unchanged.
- The worker reuses desktop `parseLabelTable`, `buildLabelPalette` and fallback
  colors. Only IDs actually present receive opacity; zero and holes stay clear.
- The volume ID owns its palette, avoiding a second host registry or lease type.
  Registration failures share one rollback path. Unload/cancel retires both.
- Lookup uses the existing coalesced rendering loop and stale-revision check;
  no new query cache, scheduler, or global state. Existing opacity/crosshair
  controls remain shared; scalar windowing is hidden for labels.

Acceptance: sparse IDs, analytic/native/browser pixels, off-center nearest
sampling, anatomical transparency, opacity, named lookup, cancellation, failed
validation and repeated palette-slot reuse. Local receipts are in
`cruft/browser-labels/`. Browser support remains qualified only on Chromium/Metal.
Browser outlines, editing, 4D label images and IDs beyond the shared LUT capacity
are outside this slice. Surfaces and broader desktop host parity remain future
work; no deployment is part of this change.


## Ninth slice: portable surface geometry (2026-10-28)

The existing GIfTI loader now separates a filesystem-free geometry reader from
its desktop adapter. A default `desktop` feature retains the existing public
loader API; the browser builds only the portable module. Removed unused direct
volmath/anyhow/serde_json dependencies. Both hosts use the same shape, index,
coordinate and transform validation. Browser admission is bounded separately
from desktop capacity. The existing gifti binary decoder remains authoritative;
compressed payloads are bounded before it runs. POINTSET transforms and
column-major order are retained rather than discarded by the simplified upstream
GIfTI object model. No upstream pin changes are needed.

Browser geometry is decoded in the existing worker and transferred directly to
the session as typed arrays. The temporary WASM result is freed immediately;
there is no Rust surface registry or second persistent copy. The existing load
cancellation/generation checks handle reset/closure and replacement. A late GPU
error from an old surface cannot clear a newer mesh. `NeuroSurfaceCanvas` is
shared with desktop and lazy-loaded; it owns camera interaction, triangle-point
picking and GPU disposal. Open/rotate/zoom/pick/unload is the complete slice.

Fixtures: transformed octahedron, ASCII, column-major big-endian binary,
zlib arrays and outer gzip. Acceptance checks the independent world coordinates,
indices, analytic picked-point equation, decoder errors and decompression bounds,
latest-load ownership, failed GPU initialization and zero live WebGL objects
after unload/reset. Receipts are in `cruft/browser-surfaces/` under Mote
`bd-01M61R2TMR1S1VDTBPEB5948CW`.

Limits: one browser surface, one million vertices/two million triangles, 64 MiB
compressed/expanded XML. No external binary sidecars, surface overlays/catalogs,
editing or projection. Chromium/Metal is the only qualified runtime here.

Final local checks: GIfTI/loader tests 8 passed (1 existing ignored), native host
4 passed, session tests 7 passed, and real Chromium/Metal browser suite 14 passed.
WASM/PWA/TypeScript build, native/WASM Clippy, scoped ESLint/formatting and diff
checks pass. Desktop and narrow screenshots were inspected. Existing ts-rs and
WASM Arc warnings remain; Vite flags the lazy surface vendor chunk's size. This
is not native desktop UI or other-browser qualification, and no deployment was
performed.


## Scalar surface overlay slice (2026-10-28)

One dense scalar GIfTI map now follows geometry into the browser's existing
surface canvas. The shared reader reuses geometry's bounded XML/binary decoding;
the desktop scalar command uses that reader through its file adapter. No new
renderer, cache, worker registry, or service was introduced. Session ownership
binds each pending map to its mesh and request order; replacement, unload and
reset cannot publish an obsolete attachment. The scope deliberately excludes
categorical maps, multiple-map files, sparse maps, catalogs and projection.
See `docs/browser-viewer.md` for supported inputs and scientific interpretation.

Verification: 12 loader tests passed (one existing ignored), 14 session tests
passed, and 15 actual Chromium 156 headless/Metal browser tests passed, including
offline maps, scalar picking, grayscale pixels and GPU cleanup. WASM/PWA build,
scoped lint and loader Clippy passed. Existing ts-rs and bundle-size warnings
remain. Desktop/narrow screenshots were inspected; native desktop UI was not
exercised. The initial full Chrome run reported `in-incognito` at the existing
PWA installability check; the headless-shell run passed that check unchanged.
Evidence: `cruft/browser-scalar-surfaces/`.
