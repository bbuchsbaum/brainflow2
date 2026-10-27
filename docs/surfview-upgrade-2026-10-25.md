# SurfView 3.1 integration

Brainflow now pins `neurosurface` to `npm:surfview@3.1.0` in both `ui2` and
`@brainflow/visualization`, with Three.js `0.185.1`. The lockfile resolves one
matching runtime pair. This uses the published release, not the additional
unreleased fixes on upstream `main`. The Rust `neurosurf-rs` dependency is unchanged.

## Adaptation

[`surfaceRuntime.ts`](../packages/visualization/src/surface/surfaceRuntime.ts)
centralizes layer construction/updates and the library-specific appearance
translation formerly embedded in the canvas:

- Surface color uses `updateConfig({ color })` to change the base layer. Direct
  mesh-material tinting is removed so quantitative overlay colors stay intact.
- Lighting reuses the viewer's owned ambient/key/fill lights. Explicit
  `headlight: false` preserves Brainflow's world-space position control; no
  extra fill light is created, and zero fill remains zero. Lighting also applies
  after deferred canvas initialization.
- Volume layers explicitly request linear interpolation on creation and update.
  This preserves smooth GPU projection across SurfView's sampling-default change
  and makes its CPU fallback use the same requested interpolation.
- `gray`, `grey` and `grays` normalize to `greys` for both scalar and volume
  layers. SurfView's scalar palette resolver accepts the aliases, but its volume
  texture generator otherwise falls back to another palette. The adapter avoids
  that mismatch without patching the dependency.
- Material-only updates no longer trigger an extra normal recomputation.

The upgrade accepts SurfView's corrected sRGB handling and rendering behavior;
it does not attempt to reproduce every 2.2 screenshot. No visual baseline was
regenerated, and no new product controls were added.

## Verification

- `pnpm install --frozen-lockfile --ignore-scripts`: passed.
- `pnpm --filter @brainflow/visualization build`: passed.
- `pnpm --filter temp-ui build`: passed, including TypeScript and production Vite.
- Surface-related Vitest suite: **31 files, 168 tests passed**. After the final
  grayscale adaptation, the two focused runtime tests passed again. These include
  an analytic volume-ramp interpolation oracle and grayscale texture assertions.
- Scoped ESLint for the new unit test and browser harness: passed.
- Playwright: **4 tests passed** against the real canvas with synthetic data.
  Checks cover opaque overlay color independence, scalar/threshold/opacity/RGBA
  updates, picking, resize, PNG export, unload/remount, owned-light count,
  world-light position and zero fill. GPU volume pixels match an independent
  fractional scalar reference for both viridis and gray and differ from the
  near-zero reference. Requested and effective linear texture filters are checked.
- Scoped diff whitespace check passed. Browser ownership audits before and after
  the final run reported no automated top-level browser processes.

Run the browser suite with
`pnpm --dir e2e exec playwright test --config playwright.surfview.config.ts`.
It owns a Vite server on port 5339 and closes its browser/server afterward.
`SURFVIEW_QA_BROWSER` can select an installed automation Chromium executable;
the default is Playwright's installed browser. This run used cached Chromium
headless shell 1248 with SwiftShader. The harness is excluded from production
entry points.

Logs, screenshots and a source-hash receipt are in
`/private/tmp/brainflow-surfview-update/`. The first unit attempt executed no
tests because Node 26 Web Storage conflicted with the existing test setup;
passing runs used `NODE_OPTIONS=--no-experimental-webstorage`. Initial browser
fixture mistakes (a masked scalar and an unframed plane) were corrected before
the final assertions; those attempts do not establish renderer defects.

## Qualification limits

This is synthetic software-WebGL evidence, not native Tauri, real-anatomy visual
acceptance, cross-platform qualification or a performance comparison. Devices
without float-linear texture support may use SurfView's documented nearest
fallback. Upstream still declares optional React 18 peers while Brainflow uses
React 19; that existing warning remains. We use the core renderer through our
own React wrapper, not SurfView's optional React adapters. Existing large-bundle
warnings remain in the production build.
