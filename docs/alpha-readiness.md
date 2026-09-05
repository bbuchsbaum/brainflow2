# Alpha readiness — 2026-09-04

Brainflow has a working native loading/rendering path and a substantial automated
safety net. This hardening pass fixes concrete coordinate and scheduling defects;
it does not certify an alpha release. The first pass was committed and pushed as
`1d49e0018a7750cccdf5df846d24c330404ffeab`. The startup fix was committed as
`20b68685`; pre-existing working-tree edits remain preserved.

## Changes implemented

- **Montage:** sample from the reference volume's voxel-center bounds and slice
  count, including both endpoints. A 64-slice, 3 mm volume now samples 0, 3, …,
  189 mm. Overlay bounds affect framing only. Each workspace owns its scheduler;
  requests capture its state, stale metadata is discarded, and stale bitmaps
  are closed. Pure geometry lives in `ui2/src/services/mosaic/sliceGeometry.ts`.
- **Coordinates:** preserve the backend affine world frame; remove the extra
  surface X reflection. Orthogonal edge labels follow the signed view basis.
  The [coordinate specification](COORDINATE_SYSTEM_SPEC.md) explains the contract.
- **Surface correspondence:** use anatomical pial/white vertices directly.
  Inflated/spherical views require a matching anatomical surface and identical
  topology. Volume-to-surface navigation finds a vertex in anatomical space;
  surface picking maps the displayed triangle back using barycentric weights.
  The integrated view explains when the anatomical reference is missing.
- **Local hemispheres:** pair explicit lh/rh and BIDS hemi-L/hemi-R filenames
  within the same directory and remaining identity. Distinct subjects, spaces,
  densities and geometries remain distinct scenes.
- **Projection and overlays:** reject CPU projection affines that cannot be
  represented instead of silently discarding rotation/shear. Reject explicit
  overlay filename hemisphere, subject and space mismatches before allocation,
  in addition to the existing vertex-count check.
- **Build:** pin the published `surfview@2.2.0` dependency, make the pnpm lockfile
  trackable, include E2E dependencies in the workspace, and declare its missing
  PNG decoder dependency. CI uses Node 22, builds shared packages first, uses
  frozen installs, and checks active masked shaders instead of the quarantined
  typed-shader feature. E2E reads the dev URL from Tauri configuration.

## Evidence

Validation used an isolated copy under `/private/tmp/brainflow-alpha-validation`
so generated JavaScript and dependencies did not restore the user's deleted
build outputs. Rust checks used the current source checkout. The JS runtime here
was Node 26.7.0; Vitest used `NODE_OPTIONS=--no-experimental-webstorage` for jsdom.
CI is configured for Node 22; no hosted CI run is claimed.

| Check | Result |
| --- | --- |
| Full UI Vitest suite | 206 files passed, 1 skipped; 1,292 tests passed, 3 skipped, 1 todo |
| API and visualization TypeScript builds; UI project build | Passed |
| UI production Vite build against published surfview | Passed; large-chunk warnings remain |
| `cargo test -p api-bridge --lib` | 115 passed |
| `cargo test -p neuro-types --lib` | 50 passed during assessment |
| Shader contract, render golden and batch readback tests | 9 passed during assessment; golden exercised Metal, not a soft skip |
| Strict command/permission check | 103 commands aligned |
| Native fixture startup | NIfTI and GIfTI loaded; all three volume planes rendered on Apple M3 Max Metal |
| Native montage fixture | Ten slices at z = -31, -29, …, -13 mm rendered through the real bridge |
| Playwright test discovery | 67 tests in 10 files; execution not run |
| Frozen pnpm installation | Passed without dependency resolution |

Local receipts: `/tmp/brainflow-alpha-ui-full.log`,
`/tmp/brainflow-alpha-ui-project-build.log`, `/tmp/brainflow-alpha-ui-build.log`,
`/tmp/brainflow-alpha-bridge-tests.log`, `/tmp/brainflow-alpha-native-load.log`,
`/tmp/brainflow-alpha-native-montage.log`, and
`/tmp/brainflow-alpha-frozen-install.log`. These temporary logs are session
receipts, not durable CI artifacts. Validation app and preview server were stopped;
the final browser lifecycle audit found no automated top-level browsers.

## Second pass: shared renderer ownership

The native startup's duplicate initialization came from two `BridgeState`
instances: plugin setup registered a default, while desktop setup initialized a
second state whose registration was ignored. Desktop warmup therefore initialized
an unused GPU service and its watchdog watched the wrong layer registries.

The plugin now owns the canonical state and watchdog, using the application cache
directory. Desktop warmup and frontend init both use `ensure_render_loop`.
`render_lifecycle.rs` holds the slot lock across creation and shader loading;
only a fully ready renderer is published, and failures leave the slot retryable.
Default state construction now shares the same constructor as app startup.

Validation: all **117 bridge unit tests passed**, including concurrent creation
and failure/retry checks. The GPU-dependent test required execution with Metal
access after a sandbox run failed with `AdapterRequestFailed`. Native fixture
startup recorded **one GPU initialization, one shader completion, one frontend
init call, twelve rendered volume frames, and one loaded surface**. Strict
command/permission checks still align all 103 commands. Receipts are
`/tmp/brainflow-alpha-pass2-bridge-metal.log` and
`/tmp/brainflow-alpha-pass2-native.log`.

Desktop control still failed to start, so visual and mouse acceptance remains
open. The validation app/server were stopped and the browser audit was clean.

## Third pass: navigation and resource cleanup

- Crosshair changes and asynchronous resize responses stay with their originating
  workspace. Newer requests supersede older ones; returned planes align with the
  current cursor instead of reverting a more recent navigation. Reset invalidates
  outstanding requests. Plane alignment is a shared pure geometry helper.
- Slice stepping uses voxel-center bounds divided by the interval count. Inputs
  are finite-checked, clamped and ignored when unchanged. Mosaic cells read their
  own workspace, including crosshairs and click navigation.
- Crosshair moves and visibility changes redraw the overlay even when its bitmap
  is unchanged. Removing an image clears the canvas. Failed canvas draws have a
  bounded retry timer that is cancelled on replacement or teardown.
- Deferred surface-viewer initialization cancels its animation frame on teardown;
  a failed fallback viewer is disposed. Backend surface unload also releases
  projection overlays and cached samplers. Late projection/sampler publication
  checks that the target surface still exists.

Validation on Apple M3 Max: **1,301 UI tests passed** across 207 files (3 skipped,
1 todo, 1 skipped file), **118 bridge unit tests passed**, shared visualization
and UI TypeScript builds passed, and the production frontend built successfully.
A subsequent request-map/reset cleanup passed all 24 navigation tests and another
UI typecheck/build. The GPU lifecycle test uploaded and released 200 alternating
64-cubed/96-cubed volumes; resident texture slots and bytes returned to zero on
every cycle. Another test completed 25 surface/sampler/projected-overlay teardown
cycles without retained registry entries.

RSS at GPU cycles 5, 25, 50, 100 and 200 was respectively 61,632, 129,904, 145,552,
87,200 and 160,096 KiB. Queue work was submitted and drained before measurement.
These fluctuating observations do not establish a long-session memory plateau;
driver caches and frontend image lifetimes need a longer native workload.

Receipts: `/tmp/brainflow-alpha-pass3-ui-final.log`,
`/tmp/brainflow-alpha-pass3-navigation-final.log`,
`/tmp/brainflow-alpha-pass3-bridge.log`, and
`/tmp/brainflow-alpha-pass3-resources-drained.log`.
The [alpha acceptance checklist](alpha-acceptance.md) separates automated evidence
from outstanding manual interaction checks.

## Local packaged alpha

The Apple Silicon macOS `0.1.0-alpha.1` app was built with the normal optimized
release profile from application source `5511421c555af35fc0d8628a183033746dad1b21`.
It embeds the verified production frontend; no development server was used in
packaged smoke tests. The app identifier is `com.brainflow.alpha`, separate from
the development app. The delivery lives under `dist/alpha/0.1.0-alpha.1/`, with
known-coordinate fixtures, receipt logs, configuration and hashes.

The bundler's initial linker-only signature failed complete resource verification.
The local bundle was ad-hoc signed with `codesign --force --deep --sign -
--identifier com.brainflow.alpha` and passed strict/deep verification. This is
not a Developer ID-signed or notarized public release.

Packaged startup loaded the 65 × 65 × 49 phantom volume and both pial meshes,
then rendered six frames across all three volume planes. The signed bundle's
montage launch loaded all four pial/inflated meshes and rendered 22 frames,
including 16 montage planes at z = -24, -21, …, 21 mm. Each launch recorded one
GPU initialization, one shader initialization, one frontend init call, and no
error or panic lines. Empty phantom slices (including the sagittal x = 0 gap)
produce expected black-image diagnostics. Both owned app processes were stopped.

These are loading/backend-render receipts, not visual or mouse acceptance.
The DMG checksum, read-only mount, packaged signature, executable hash, fixtures
and Applications link passed verification; the volume was detached afterward.
Its SHA256 is `36ec8b3ecc2282203e9a7dd19dce42a74eabab76d7d9721689666bbd8dfd2ea8`.
The final browser lifecycle audit reported no automated top-level browsers.
Consult the delivery's manifest and README for the complete receipts.

## Remaining alpha gates

1. **Native visual and interaction acceptance.** Desktop control fails during
   service startup. Logs do not prove displayed images, crosshair placement,
   picking, wheel navigation, resize, or panel teardown. The acceptance fixture
   provides explicit landmarks for those checks.
2. **Native end-to-end and platform matrix.** Playwright test discovery does not
   execute Tauri IPC. A native harness remains necessary. Hosted CI, Windows,
   Linux, Intel macOS and signed/notarized distribution are unverified.
3. **Spatial compatibility.** Linking assumes an already shared anatomical world
   frame; it does not register surfaces to volumes. Filename checks reject
   contradictions but cannot establish identity after renaming or without
   metadata. Full metadata validation and oblique CPU projection remain separate.
4. **Efficiency.** Resource accounting is tested, but long-session process memory,
   interaction latency and startup benchmarks remain open. Production chunks are
   large; React 19 peer-range warnings remain in several visualization packages.
