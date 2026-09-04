# Alpha readiness — 2026-09-04

Brainflow has a working native loading/rendering path and a substantial automated
safety net. This hardening pass fixes concrete coordinate and scheduling defects;
it does not certify an alpha release. Changes are uncommitted on top of
`1a8ca2e9`, with pre-existing working-tree edits preserved.

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

## Remaining alpha gates

1. **Native visual and interaction acceptance.** The computer-control service
   failed to start twice. Native loading/render logs do not prove the displayed
   image, crosshair placement, mouse picking, wheel navigation, resize, or panel
   teardown. Exercise orthogonal, montage and integrated views with asymmetric
   landmarks, two simultaneous workspaces, and paired anatomical/inflated meshes.
2. **End-to-end harness and release build.** Playwright's browser page still
   does not acquire Tauri IPC merely by opening the dev URL. A real native
   harness or explicit browser bridge fixture is needed; test discovery is not
   end-to-end execution. Run the supported platform matrix and packaged app
   smoke checks before release. Hosted CI and signed installers are unverified.
3. **Spatial compatibility.** Linking assumes an already shared anatomical
   world frame; it does not register a subject surface to a template volume.
   Filename checks reject contradictory evidence but do not establish overlay
   compatibility when metadata is absent or files are renamed. Full metadata
   validation and oblique CPU projection remain separate work.
4. **Efficiency and lifecycle.** No interaction-latency, memory-growth or startup
   benchmark was run. The production build still warns about large main and
   surface chunks. Dependency installation reports React 19 peer-range warnings
   in surfview, visx and Allotment's resize helper. The native startup log also
   shows two render-loop initializations; review ownership before release.

The next acceptance pass should record screenshots and bidirectional landmark
coordinates, repeated load/unload memory behavior, and frame latency on a fixed
fixture and machine. Broad bridge/renderer decomposition can then proceed behind
these checks without obscuring correctness changes.
