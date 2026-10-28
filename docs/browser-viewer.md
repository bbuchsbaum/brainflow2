# Browser viewer

Brainflow now has a standalone browser entry point using the shared Rust NIfTI
decoder, loading lifecycle and WGPU shaders. A dedicated worker owns the WASM
heap, volume registry and GPU resources. The existing `RenderClient`, RGBA packet
format, slice viewport, controls and theme are reused.

## Run locally

Use the repository's Node/pnpm setup and at least 20 GB free build space.
Install `wasm32-unknown-unknown` with rustup and a `wasm-bindgen` CLI matching
the lockfile (currently 0.2.100). `WASM_BINDGEN` can name an existing executable.
No development server or build cache needs to remain running between sessions.

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.100 --locked
pnpm --filter temp-ui build:browser
pnpm --filter temp-ui exec vite preview --config vite.browser.config.ts
```

Open the printed server URL followed by `/browser.html`. The generated static
bundle is `ui2/dist-browser`; opening its HTML through `file://` does not provide
the secure context/fetch behavior required by WebGPU and service workers.
`localhost` works for development; hosting elsewhere requires HTTPS. A deployment
was not performed as part of this implementation.

For UI development after generating the WASM bindings:

```sh
pnpm --filter temp-ui dev:browser
```

Vite caches its worker transformation during development. Restart your owned
server after changing the worker's static imports. Production builds use hashed
worker/WASM assets. Generated bindings and build output are ignored by Git.

## Supported workflow

Open an uncompressed or gzip-compressed, single-file 3D or 4D NIfTI-1 scalar image.
The viewer displays linked axial, coronal and sagittal slices in RAS world mm.
Click a slice or edit crosshair coordinates, change window/level, add a scalar
overlay and adjust its opacity. For a 4D image, select a zero-based frame or play
the series. Playback advances after the preceding slices finish, with a 250 ms
pause; it is a viewing control, not acquisition-timed playback. The display window
stays fixed across frames. Clear the workspace or unload individual images.
Native source scaling and affine selection come from neuroim, not a JS decoder.

This first browser host allows up to four volumes (fewer if the adapter has fewer
resident slots), 32 million voxels per image (including all 4D frames) and
64 million resident voxels in total. Compressed and expanded inputs are each
bounded to 256 MiB. Decoder storage is f32; GPU upload uses physical-value
R32Float, without range-normalizing the scientific data. These are input/resident
budgets, not a claim that total browser/GPU memory is bounded to the same number.

The browser host sizes the shared shader layout to the actual adapter: each
volume needs two sampled textures (data and alpha mask), plus one shared
colormap texture. A device with 16 sampled textures per stage gets seven slots;
the layout supports 1–13 slots, also bounded by binding limits. Two samplers and
R32Float filtering are required. Native callers retain the fixed 13-slot default
unless they opt into `RendererCapacityPolicy::FitAdapter`.

Startup checks these capabilities before accepting files and reports recovery
options on failure. There is no silent scalar-precision reduction or CPU/mock
rendering fallback. Rendering qualification so far is Chromium/Metal on this
Mac, including a real requested device limit of 16 sampled textures. Firefox
157 exposes WebGPU here but returns no adapter; the viewer's startup error and
desktop recovery route were verified. The installed Playwright WebKit build for
macOS 14 crashes before opening a page, so WebKit rendering remains unqualified.
Other browsers/devices need their own acceptance run.

Surface overlays, atlas/template catalogs, remote mounts,
native paths, filesystem watching and external process plugins remain unavailable
in this viewer. The capability description and command errors say so explicitly.
This is a working volume-viewing milestone, not complete desktop feature parity.
Five previously direct Tauri domain clients now route through the selected
transport, and temporal-map services can retain an explicitly injected transport.

## Ownership and offline behavior

Browser `File` objects are cloned to the worker; only that worker reads them into
bytes. Input acquisition/decoding is memory-backed and records a browser-file
identity, never a pretend native absolute path. RGBA output buffers transfer back
to the main thread. Native paths and dialogs stay out of this host.

Requests have IDs and cancellation messages. A cancelled load retains worker
ownership until cleanup, including a reply already in transit. Closing/resetting
the UI rejects stale publication, and closing the session terminates only its
worker. UI render requests coalesce; obsolete bitmaps are closed. The shared
Rust service and renderer own publication and GPU staging. GPU validation errors
are surfaced as failures instead of accepted blank output.

The production service worker precaches the exact hashed application assets,
including WASM and local fonts. It does not runtime-cache datasets or selected
files. After one successful online installation, reload and local file viewing
work offline. Reloading loses the in-memory workspace; the files must be selected
again. Updates wait until every old viewer window is closed, so a new version
cannot replace a running workspace. Browser/OS installation itself is user-driven.

## Qualification

The public synthetic fixture and independent voxel/world formulas are documented
in `test-data/browser/README.md`. Generate the native GPU packet before comparing
it with the browser worker:

```sh
BROWSER_NATIVE_WITNESS_DIR="$PWD/cruft/browser-portability" cargo test -p browser_host --test host
cargo test -p render_loop
pnpm --filter temp-ui build:browser
pnpm --dir e2e exec playwright test --config playwright.browser.config.ts
```

The E2E suite starts/stops its own development and production-preview servers.
It needs a working real WebGPU adapter; no GPU test is soft-skipped. Set
`BROWSER_QA_BROWSER` when the pinned Playwright browser is unavailable and a
project automation Chromium is already installed. Follow `AGENTS.md`'s browser
ownership audit before and after automation; never use a personal Chrome profile.
`BROWSER_QA_OUTPUT` redirects browser artifacts, and `BROWSER_NATIVE_WITNESS`
selects a freshly generated native witness JSON when using another receipt directory.

The browser/native comparison allows at most one byte per RGBA channel for
backend UNORM rounding. Native analytic checks independently constrain affine,
voxel order and scalar intensity. Browser tests also exercise linked controls,
overlays, cancellation and unload on default/adaptive devices, rejection of
insufficient texture limits or missing R32Float filtering, offline reload, app-only cache contents and
Chromium installability checks. They do not establish all-format, all-device,
all-browser or native desktop UI acceptance.

`adaptive_capacity_test` compares the final resident slot on an actual
16-texture native device with the default desktop renderer, in both interpolation
modes and through the legacy alpha-mask API, then checks exhaustion and reuse.
Declarative `ViewState` does not carry alpha-mask ownership; this slice does not
extend that API. `shader_contract_test` validates both composed shaders at
1, 4, 7 and 13 slots. The host test also exercises an actual one-slot device.

The workspace remains on WGPU 0.20. A private-worker compatibility adapter
replaces its removed `maxInterStageShaderComponents` request with the current
inter-stage variable limit; unrelated limits remain validated. Both authoritative
masked shaders use explicit LOD 0 for their single-level colormap LUT, avoiding
implicit derivative use in nonuniform control flow without disabling validation.

## Time-series ownership

The decoded series stays in the worker under the existing input and resident
budgets. Frame changes extract one spatial f32 frame and update the existing
R32Float GPU slot. There is no per-frame GPU cache. Spatial frame extraction and
bounds/affine helpers live in `volume_service` and are reused by desktop queries.
The UI keeps one active render and the latest requested state; obsolete frames
are never published. Pause, unload, workspace reset and session close retire
playback timers. This slice supports frame indices; it does not infer acquisition
timing from the NIfTI time axis.

## Categorical labels

Choose **Open labels** and select one 3D NIfTI (`.nii` or `.nii.gz`) and, optionally,
one label table together. The shared desktop parser accepts BIDS-style TSV
(`index`, `name`, optional `color` as `#rrggbb`) and FreeSurfer LUT text. A table
is limited to 1 MiB. Missing names/colors use the desktop's deterministic fallback.
NIfTI label intent (1002) also selects label loading through the ordinary chooser.

Labels require identity scaling and integer IDs 0–2047, the current shared LUT
capacity. Native-type decoding validates before conversion: fractional, negative,
nonfinite and larger IDs fail instead of rounding or disappearing. Label 0 is
transparent. Rendering always samples labels with nearest neighbour, regardless
of the request's interpolation setting. Opacity and linked crosshair controls
are shared with scalar viewing; the inspector shows the region name and ID at
the crosshair. This slice supports filled labels; outlines and label editing
remain unavailable in the browser.

The renderer facade exposes the existing label upload and custom palette
operations. Palettes use volume IDs as ownership keys, with no second browser
registry. Failed palette setup, cancellation and unload reclaim the same volume
and its palette. Label lookup runs in the existing coalesced render loop and
cannot publish after workspace closure or a newer selection.

`labels.nii` uses sparse IDs 0, 17, 1024 and 2047 on the synthetic oblique grid.
Native tests check analytic colors at off-center sample positions, label-zero
transparency over anatomy, opacity, exact lookup and repeated palette reuse.
The real WASM/Chromium test compares the native RGBA packet exactly and exercises
sidecar names, fallback colors, cancellation and cleanup. This shares the same
Chromium/Metal qualification boundary described above.

## Surface geometry

Choose **Open surface** for a self-contained `.surf.gii`, `.gii` or `.gii.gz`.
One surface can be open alongside the volume layers. Drag to rotate, scroll to
zoom, reset the camera, or click the mesh to inspect a triangle point in world
coordinates and the nearest vertex ID. **Show slices** / **Show surface** switch
the workspace view; **Unload surface** and **Clear workspace** release the mesh.
The shared `NeuroSurfaceCanvas` supplies the same camera, picking and disposal
used on desktop. Its code loads only when the surface view is opened.

`gifti-loader::geometry` takes a `Read` source without paths or Tauri. It reuses
the GIfTI binary decoder and preserves POINTSET transforms and row/column order.
The desktop file adapter now uses this same validation/decoding path. Browser
admission caps compressed input and expanded XML at 64 MiB, vertices at one
million, and triangles at two million. Desktop uses separate admission limits.
Array decompression is bounded by the declared, checked shape before decoding.
Invalid/nonfinite coordinates, fractional/out-of-range indices, degenerate
triangles, singular/non-affine or ambiguous transforms are rejected. External
binary data files are unsupported; use a self-contained GIfTI.

The worker transfers typed coordinate/index arrays and immediately frees its
WASM result. It retains no surface registry or duplicate mesh. The existing
browser session owns cancellation and rejects stale loads; the shared canvas
owns WebGL resources. Switching away unmounts that canvas and frees GPU objects,
while the session retains the one mesh for returning to its view. Unloading or
closing the workspace drops those arrays too. This slice does not add surface
overlays, catalogs, editing, or surface-to-volume projection.

Surface tests cover independent transformed geometry across four encodings,
desktop/portable agreement, input failure and bounded decompression, worker
cancellation, triangle-point picking, camera interaction, and WebGL object
creation/deletion or context loss on unload and reset. Qualification is Chromium/Metal here;
other browser/GPU combinations still need their own acceptance runs.
