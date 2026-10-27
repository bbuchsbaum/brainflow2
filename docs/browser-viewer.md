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

Open an uncompressed or gzip-compressed, single-file 3D NIfTI-1 scalar image.
The viewer displays linked axial, coronal and sagittal slices in RAS world mm.
Click a slice or edit crosshair coordinates, change window/level, add a scalar
overlay and adjust its opacity. Clear the workspace or unload individual images.
Native source scaling and affine selection come from neuroim, not a JS decoder.

This first browser host allows four volumes, 32 million voxels per image and
64 million resident voxels in total. Compressed and expanded inputs are each
bounded to 256 MiB. Decoder storage is f32; GPU upload uses physical-value
R32Float, without range-normalizing the scientific data. These are input/resident
budgets, not a claim that total browser/GPU memory is bounded to the same number.

The current shader layout requires at least 27 sampled textures per stage and
R32Float filtering support for this host. WebGPU availability alone is
insufficient. Qualification so far is Chromium with the Metal backend on this
Mac; other browsers/devices need their own acceptance run. There is no silent
CPU or mock rendering fallback.

Labels, multi-frame time series, surfaces, atlas/template catalogs, remote mounts,
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

The browser/native comparison allows at most one byte per RGBA channel for
backend UNORM rounding. Native analytic checks independently constrain affine,
voxel order and scalar intensity. Browser tests also exercise linked controls,
overlays, cancellation, unload, offline reload, app-only cache contents and
Chromium installability checks. They do not establish all-format, all-device,
all-browser or native desktop UI acceptance.

The workspace remains on WGPU 0.20. A private-worker compatibility adapter
replaces its removed `maxInterStageShaderComponents` request with the current
inter-stage variable limit; unrelated limits remain validated. Both authoritative
masked shaders use explicit LOD 0 for their single-level colormap LUT, avoiding
implicit derivative use in nonuniform control flow without disabling validation.
