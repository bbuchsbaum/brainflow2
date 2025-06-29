Okay, the clarifications address the open points effectively. The plan to manage `@brainflow/api` internally first, bootstrap `ts-rs` incrementally, and handle `supports_webgpu()` via a blocking startup check are all sound implementation details. The refined task breakdown for `volmath` and the addition of the `Dockview` setup ticket are good improvements.

Here is the updated Sprint 0 / Sprint 1 backlog, formatted as a single Markdown document, incorporating all the latest adjustments.

NOTE:: see @CODE-conversion.md for rust implementaitons for some key neuroimaging data structure sreferred to below.

see GUIDE-ui-layout-phase-1.md for a guide to the UI layout for phase 1.


---

# `docs/PLAN-sprint-backlog-0-1.md`

**Version:** 1.2
**Status:** Approved for Implementation Start
**Date:** [Current Date]
**Context:** This document details the specific, actionable tasks (tickets) for the initial development sprints (Sprint 0 & Sprint 1) of Brainflow Phase 1 (WebGPU v2). It aligns with the finalized architecture, migration plan, and API specifications (`@brainflow/api@0.1.1`).

**Feedback Integration Note (Post Sprint 0 Completion):**
This version incorporates feedback assessing the initial project state. Key focus remains on the render path (slice extraction, upload, shader, orthogonal view) and addressing identified technical debt (async/locking patterns, type centralization).

---

## 🌟 Sprint 0 / "Foundation & Core Types" (~5 days budget)

**Goal:** Land the minimal repository structure, Core API definition package, `ts-rs` pipeline, essential `volmath` types (Axis, Space), adapter test harness, CI basics, and the initial UI shell with GoldenLayout integrating real Svelte components. Unblocks parallel Rust/UI development in Sprint 1.

### Tasks / Tickets:

- [x] **BF-001: Setup `@brainflow/api@0.1.1` package w/ interfaces** (Owner: api-lead | Labels: typescript M1 api | Est: 0.5 d)
    - **Notes:** Use `workspace:*` in dependent `package.json` files. Populate interfaces from spec (`memory-bank/ADR-001-architecture.md`). Add `build` script (`tsc`). Consider adding `pnpm publish --dry-run` to CI check later.
    - **Feasibility:** Completed. Interfaces defined.
    - **Sub-Checks:**
        - [x] Verify `memory-bank/ADR-001-architecture.md` exists.
        - [x] Check/Add `build` script in `packages/api/package.json`.
        - [x] Check if `.github/workflows/ci.yml` exists for later modification.

- [x] **BF-00D: Setup UI: GoldenLayout Shell, Persistence, Svelte Component Registration & ResizeBus** (Owner: ui-lead | Labels: svelte layout M1 ui | Est: 0.75 d) *(Estimate increased)*
    - **Notes:** Integrate `GoldenLayout` in `+layout.svelte`. Implement according to `GUIDE-ui-layout-phase1.md` patterns.
    - **Sub-Tasks / Requirements:**
        - [x] Create default layout config (`$lib/layout/defaultLayout.ts`).
        - [x] Implement layout loading (from Core API stub / `defaultLayout`).
        - [x] Implement layout saving (to Core API stub, debounced) on `stateChanged`.
        - [x] Create `glRegister` helper for Svelte components (handling creation/destruction).
        - [x] Register at least one real placeholder Svelte component (e.g., `PlaceholderPanel.svelte`) using `glRegister`.
        - [x] Use `setContext` to provide the GoldenLayout instance.
        - [x] Create dedicated `resizeBus` store (`$lib/stores/resizeBus.ts`).
        - [x] Connect `ResizeObserver` to update `resizeBus`.
        - [x] Remove redundant `onDestroy` cleanup from previous attempt.
    - **Acceptance Criteria:**
        - App shows layout from `defaultLayout.ts`.
        - Resizing updates `resizeBus` store & GL tabs smoothly.
        - Layout state changes are persisted (via Core API stubs).
        - At least one Svelte component renders in a GL tab and is destroyed correctly on tab close.

- [x] **BF-002: Setup `schemas/0.1.1/` & JSON-Schema lint CI job (ajv)** (Owner: api-lead | Labels: infra M1 schema | Depends: BF-001 | Est: 0.5 d)
    - **Notes:** Copy finalized schemas; add `ajv-cli` check to `ci.yml`.
    - **Sub-Tasks / Requirements:**
        - [x] Create schema files based on SPEC-json-schemas-v0.1.1.md
        - [x] Add schema validation CI job to .github/workflows/ci.yml
        - [x] Verify schemas are valid with ajv-cli

- [x] **BF-003: Scaffold `tools/plugin-verify` CLI (parse manifest, check schema)** (Owner: tools | Labels: node M1 tools infra | Depends: BF-002 | Est: 0.5 d)
    - **Notes:** Basic CLI structure, reads JSON, validates against schema.
    - **Sub-Tasks / Requirements:**
        - [x] Set up package.json and TypeScript configuration
        - [x] Create CLI entry point and command structure
        - [x] Implement plugin manifest validation against schema
        - [x] Add support for validating a directory of plugins
        - [x] Create example plugin manifests for testing

- [x] **BF-004: Setup `ts-rs` generation pipeline & CI step (`xtask ts-bindings`)** (Owner: rust-infra | Labels: rust typescript M1 ci infra | Depends: BF-001 | Est: 0.5 d)
    - **Notes:** Generates types for *existing* Rust code (initially minimal, e.g., errors).
    - **Sub-Tasks / Requirements:**
        - [x] Create xtask crate for build tasks
        - [x] Implement ts-bindings command in xtask
        - [x] Set up ts-rs in volmath crate
        - [x] Add TS bindings generation to CI workflow
        - [x] Create export path in packages/api/src/generated

- [x] **BF-006a: Port `core/volmath::axis` (AxisName, NamedAxis + tests)** (Owner: rust-core | Labels: rust M2 volmath | Depends: BF-004 | Est: 0.5 d)
    - **Notes:** Implement based on refined spec; add Rust unit tests.
    - **Sub-Tasks / Requirements:**
        - [x] Implement AxisName enum with correct values
        - [x] Implement NamedAxis struct with direction vector
        - [x] Implement AxisSet trait and AxisSet3D struct
        - [x] Add comprehensive unit tests
        - [x] Export types with ts-rs

- [x] **BF-006b: Port minimal `core/volmath::space` (dim, affine, grid↔coord)** (Owner: rust-core | Labels: rust M2 volmath | Depends: BF-006a | Est: 1 d)
    - **Notes:** Implement core `NeuroSpace` methods; add Rust unit tests.
    - **Sub-Tasks / Requirements:**
        - [x] Implement NeuroSpace with nalgebra matrices
        - [x] Add grid-to-world and world-to-grid transformations
        - [x] Implement index conversion methods
        - [x] Add comprehensive unit tests
        - [x] Export types with ts-rs

- [x] **BF-005: Stub `core/api_bridge` Tauri commands matching `CoreApi` (`unimplemented!`)** (Owner: rust-core | Labels: rust tauri M2 api | Depends: BF-004 | Est: 0.5 d)
    - **Notes:** Create command functions; ensure `ts-rs` picks them up if needed.

- [x] **BF-008: Implement `supports_webgpu()` check (Rust cmd + UI modal/disable)** (Owner: rust-core/ui | Labels: rust tauri svelte M2 ux | Depends: BF-005 | Est: 0.5 d)
    - **Notes:** Blocking check on startup; UI shows modal & disables relevant features.

- [x] **BF-009: Configure CI Matrix (macOS-Intel/ARM, Win, Linux) & Base Tests** (Owner: infra | Labels: ci M2 infra | Depends: BF-006c | Est: 0.5 d)
    - **Notes:** Run `cargo test`, `pnpm test:unit`. (`wasm-pack test` omitted per BF-006c decision).

- [x] **BF-010: Update `README.md` & `projectbrief.md`** (Owner: maintainers | Labels: docs M1 | Est: 0.5 d)
    - **Notes:** Reflect current status, commands, tests after Sprint 0/1 progress.

- [x] **BF-026: Implement `$lib/layout/glUtils.ts` helper & `getGlContainer()`** *(NEW)*
    - Provide container context utilities as described in UI Guide.
    - Exports `glRegister` and `getGlContainer` for components.
    - Adds type declarations to resolve linter errors.

- [x] **BF-027: Create `$lib/api` TypeScript façade mirroring CoreApi** *(NEW)*
    - Re-export generated `ts-rs` bindings plus thin wrappers.
    - Fixes import error in `VolumeView.svelte`.
    - **Est:** 0.25 d

**Sprint 0 - Definition of Done:** Branch `sprint-0` merged to main; CI pipeline (BF-009) setup deferred; `@brainflow/api@0.1.1` is internally usable via `workspace:*`; Basic UI shell with GoldenLayout runs using registered Svelte components; `volmath` core types exist with passing unit tests (adapter tests deferred); WebGPU support check functions; Plugin verifier parses manifests.

---

## 🚀 Sprint 1 / "M3 Kickoff - First Slice on Screen" (~11 days budget + 1d Contingency)

**Goal:** Load a NIfTI volume via the Rust loader, manage GPU resources via the Rust RenderLoopService, and display the first interactive axial slice using WebGPU in the Svelte VolumeView component. Establish the core rendering pipeline and performance benchmarks.

| ID      | Title                                                                                 | Owner        | Labels                       | Depends On    | Est.  | Notes                                                                                          |
| :------ | :------------------------------------------------------------------------------------ | :----------- | :--------------------------- | :------------ | :---- | :--------------------------------------------------------------------------------------------- |
| [x] **BF-011**  | **Implement `core/loaders/nifti` (incl. gzip), returns `VolumeSendable`**             | rust-core    | rust io M3 loader            | BF-006b       | 1 d   | Use `nifti` crate; handle scaling; return structure matching API (with SAB handle placeholder). |
| [ ] **BF-011-VERIFY**: Verify `core/loaders/nifti` unit tests pass (`test_load_real_file_toy_t1w`) by adding `toy_t1w.nii.gz` fixture under `test-data/unit/` and confirming returned `DenseVolume3` dims. | rust-core | testing loader | BF-011 | 0.5 d |
| [x] **BF-012**  | **Integrate NIfTI loader into `LoaderRegistry`; expose via `load_file` command**        | rust-core    | rust tauri M3 api            | BF-011, BF-005| 0.5 d | Update `api_bridge` command implementation.                                                     |
| [x] **BF-013**  | **Setup `core/render_loop` (wgpu device, queue, swapchain mgmt)**                     | rust-core    | rust wgpu M3 render        | BF-008        | 1 d   | Basic WGPU initialization linked to Tauri window handle.                                     |
| [x] **BF-021**  | **Implement basic Device Loss & Resize handling in `RenderLoopService`**               | rust-core    | rust wgpu M3 render        | BF-013        | 0.5 d | Log events, attempt re-initialization (robust handling later).                               |
| [x] **BF-014**  | **Setup WGSL shader build script (`wgsl_to_wgpu`) + dev hot-reload hook**             | rust-infra   | rust wgsl M3 build         | BF-013        | 0.5 d | Integrate into `build.rs`; setup Tauri dev server hook if possible.                             |
| [x] **BF-015**  | **Implement GPU Texture Atlas Allocator & Slice Packer prototype (Rust)**              | rust-core    | rust wgpu M3 render        | BF-013        | 1 d   | Manages `wgpu::Texture` (2D Array/3D); packs slices (e.g., 4/8 per page).                  |
| [x] **BF-020**  | **Implement `volmath::dense_slice` helper for RenderLoop texture upload**              | rust-core    | rust M3 volmath            | BF-006b       | 1 d   | Extracts/formats data from `DenseVolume` for `wgpu::Queue::write_texture`.                     |
| [x] **BF-016**  | **Implement `request_layer_gpu_resources` -> Uploads 1 axial slice**                  | rust-core    | rust tauri M3 api render | BF-015, BF-020| 1 d   | Takes `VolumeSendable` handle, uses `dense_slice`, uploads via `RenderLoopService`. Returns `VolumeLayerGPU`. |
| [x] **BF-017**  | **Scaffold `VolumeView.svelte`, handle GPU context, pan/zoom input**                  | ui           | svelte webgpu M3 ui        | BF-00D        | 1.5 d | Gets `wgpu` surface from Rust; handles basic mouse/wheel events for pan/zoom.                |
| [x] BF-018  | **Wire UI Load Path: Drop -> `load_file` -> `request_layer_gpu_resources` -> Render**  | ui           | svelte tauri M3 ui api     | BF-012, BF-016, BF-017 | 1 d   | Connect `TreeBrowser` drop to API calls; update Zustand; trigger render. Notes: Refactored `VolumeView` to use `layerStore`. Remaining: Update store w/ GPU info, implement render logic.                    |
| [x] BF-019  | **Add Playwright smoke test: Load NIfTI, assert non-blank canvas**                    | qa           | e2e M3 testing             | BF-018        | 0.5 d |
|         |   **Sub-Tasks:**                                                                       |              |                             |               |       |
|         |   1. Add `data-testid` attributes to Svelte components (see details below)<sup>†</sup> | ui           | testing                     | BF-018        |       |
|         |   2. Verify `test-data/unit/toy_t1w.nii.gz` exists (Git LFS)<sup>††</sup>               | qa           | testing data                |               |       |
|         |   3. Extend `ui/playwright.config.ts` (webServer, timeout) (see details below)<sup>‡</sup>| qa/infra     | testing config              |               |       |
|         |   4. Write spec `ui/e2e/load-nifti.spec.ts` (using `test-data/unit/...`) (see details below)<sup>§</sup> | qa           | testing                     | Sub-task 1, 2 |       |
|         |   5. Add `test:e2e` job to `ci.yml` (see details below)<sup>¶</sup>                    | infra        | ci testing                  | Sub-task 4    |       |
|         |   *Notes:* Pixel probe assertion preferred over screenshot for initial CI stability. Visual regression tests are a future enhancement. |              |                             |               |       |
| [x] BF-022  | **Add `criterion` benchmark for texture upload throughput (> 2 GB/s target)**         | rust-infra   | benchmark M3 infra         | BF-016        | 0.5 d | Benchmark the Rust path from `Vec<T>` to `wgpu::Queue::write_texture`. Target: `render_loop` crate. |
|         |   **Sub-Tasks:**                                                                       |              |                             |               |       |
|         |   1. Add dev-deps (`criterion`, `pollster`, `rand`) to `core/render_loop/Cargo.toml`<sup>★</sup> | rust-infra   | dependencies bench          | BF-016        |       |
|         |   2. Create `core/render_loop/benches/upload.rs` with skeleton code<sup>★★</sup>       | rust-infra   | bench code                  | Sub-task 1    |       |
|         |   3. Add `[[bench]]` config to `core/render_loop/Cargo.toml`                         | rust-infra   | config bench                | Sub-task 1    |       |
|         |   4. Implement benchmark logic using `TextureAtlas` or `queue.write_texture`          | rust-infra   | bench code                  | Sub-task 2    |       |
|         |   5. Add `b.throughput()` reporting to bench function                                | rust-infra   | bench code reporting        | Sub-task 4    |       |
|         |   6. Add `cargo bench` job to `ci.yml` with throughput gate (> 2 GB/s)<sup>★★★</sup>  | infra        | ci bench testing            | Sub-task 5    |       |
| [*]Contingency* | *(Buffer for WebGPU/Driver/Integration Issues)*                                   | team         |                              |               | *1 d* |                                                                                                |

**Sprint 1 - Definition of Done:** An axial slice from `ds000114`'s T1w renders correctly via WebGPU in the `VolumeView`; Basic pan/zoom interaction works; Playwright smoke test passes (BF-019); Texture upload benchmark meets target (> 2 GB/s) (BF-022). CI remains green.

---

## Notes & Details for BF-019 Sub-Tasks

<sup>†</sup> **data-testid Attributes:**
```html
<!-- TreeBrowser.svelte -->
<input ... data-testid="tree-file-input" ... />
<div ... data-testid="tree-drop-zone" ...> Drop Files Here </div>

<!-- VolumeView.svelte -->
<canvas ... data-testid="volume-canvas" ... ></canvas>
<div class="debug-overlay">
  ...
  GPU:&nbsp;<span data-testid="gpu-ready">{layerEntry?.gpu ? 'ready' : (layerEntry?.isLoadingGpu ? 'loading' : 'wait')}</span>
  ...
</div>
```

<sup>††</sup> **Test Fixture:**
*   The test should use the existing small NIfTI file located at `test-data/unit/toy_t1w.nii.gz`.
*   This file should be tracked via Git LFS as per `DATA-fixtures.md`.
*   Ensure Git LFS is installed locally and in CI for the file to be available.

<sup>‡</sup> **playwright.config.ts Example:**
```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000, // Increased timeout
  use: {
    baseURL: process.env.PW_BASE_URL ?? 'http://localhost:5173',
    headless: true,
  },
  webServer: {
    command: 'pnpm --filter ui dev', // Command to start dev server
    port: 5173,
    reuseExistingServer: !process.env.CI,
  },
});
```

<sup>§</sup> **load-nifti.spec.ts (Simplified - Updated Path):**
```typescript
import { test, expect } from '@playwright/test';
import path from 'node:path';

// Use path relative to the monorepo root or configure Playwright to resolve it
// Assuming test runs from ui/ folder, navigate up to root
const fixture = path.resolve(__dirname, '../../test-data/unit/toy_t1w.nii.gz');

test('load NIfTI and render first slice', async ({ page }) => {
  await page.goto('/');

  // 1. Feed the file via input
  const input = page.getByTestId('tree-file-input');
  // Ensure the path is correct and accessible during the test run
  await input.setInputFiles(fixture);

  // 2. Wait for GPU ready flag in debug overlay
  await page.getByTestId('gpu-ready').filter({ hasText: 'ready' }).waitFor({ timeout: 30000 }); // Wait up to 30s

  // 3. Assert canvas is potentially rendered (pixel check)
  const canvas = page.getByTestId('volume-canvas');
  await expect(canvas).toBeVisible(); // Basic check

  // Pixel check (more robust smoke test)
  const pixels = await canvas.evaluate(async (c) => {
    // Wait a frame for rendering to stabilize after state change
    await new Promise(requestAnimationFrame);
    const ctx = c.getContext('2d', { willReadFrequently: true }); // Or 'webgpu' if needed
    if (!ctx) return -1; // Context creation failed
    try {
      const { data } = ctx.getImageData(0, 0, c.width, c.height);
      let opaquePixels = 0;
      // Check alpha channel for non-transparent pixels
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 0) { opaquePixels++; break; } // Exit early if found
      }
      return opaquePixels;
    } catch (e) {
      console.error("Error reading canvas pixels:", e);
      return -2; // Error during pixel read
    }
  });
  expect(pixels, 'Canvas should contain non-transparent pixels after load').toBeGreaterThan(0);
});
```

<sup>¶</sup> **ci.yml Job Excerpt:**
```