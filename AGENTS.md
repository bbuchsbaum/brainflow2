# Brainflow Agent Quick Reference

## Mission & Tech Stack
- **Goal**: cross-platform neuroimaging desktop app (load/render NIfTI/GIfTI, manage atlases, interactive slices & surfaces).
- **Core stack**: Tauri 2 (Rust 2021) + WGPU 0.20 for GPU rendering; React 19 + Vite + Tailwind for the UI (`ui2`).
- **Data flow**: React UI issues Tauri commands -> `api_bridge` orchestrates loaders/registries -> `render_loop` handles GPU resources; shared types live in `bridge_types`, exported to TS through `ts-rs`.

## Workspace Anchors
- `src-tauri/`: Tauri entry point (`main.rs`) wiring menus, plugins, template loading, and exposing commands. Depends on workspace crates for heavy lifting.
- `core/`: Rust workspace crates.
  - `render_loop/`: WebGPU pipelines, texture managers, view state, benchmarks.
  - `api_bridge/`: Tauri command handlers, state registries, atlas/template integration; generates TS bindings via `ts-rs`.
  - `bridge_types/`: Shared request/response types (`BridgeError`, `VolumeSendable`, surface handles, etc.).
  - `loaders/`: Format loaders (`nifti`, `gifti`); registers volumes/surfaces.
  - `filesystem/`: File system utilities (mounting, scanning).
  - `atlases/`, `templates/`: Atlas catalog and brain template services exposed to menus.
  - `volmath/` + `neuro-*`: Math/linear algebra helpers and canonical neuroimaging interfaces shared across CPU/GPU implementations.
  - `colormap/`: Color map definitions and helpers.
- `ui2/`: Current React app (GoldenLayout-based workspace, Zustand stores, Radix UI). Entry `src/main.tsx` mounts `App.tsx`; services/hooks coordinate with backend events. Tailwind configured via `tailwind.config.js`.
- `packages/`: Shared TS packages.
  - `api/`: Published API client; consumes generated bindings under `src/generated`.
  - `plugin-sdk/`, `legacy-ts/`: SDK scaffolding and older TS assets.
- `e2e/`: Playwright harness (`run-e2e.sh`, `tests/`, `utils/`) targeting the UI bundle.
- `tools/`: Dev/test scripts (render diffing, bridge testing, `generate_colormaps.py`).
- `memory-bank/`: Project documentation hub (architecture, plans, sprint notes). Good first stop for historical context.
- Data fixtures: `test-data/`, `testfiles/`, `global_mask2.nii`, `create_toy_nifti.py` for synthetic volumes.

## Development Loops
- Install deps: `pnpm install` (root) + `cargo fetch`. UI uses pnpm workspace; legacy npm lock in `ui2` exists for compatibility.
- Common commands:
  - `pnpm dev` or `cargo tauri dev`: run desktop app with hot reload.
  - `pnpm -r build` + `cargo tauri build`: production build.
  - `cargo xtask ts-bindings`: regenerate TypeScript bindings (drops files into `packages/api/src/generated`).
- Testing:
  - Rust: `cargo test --workspace`.
  - UI unit tests: `pnpm --filter ui2 test` (vitest) or `pnpm --filter ui test:unit` if legacy packages required.
  - E2E: `pnpm --filter ui test:e2e` (runs Playwright in `e2e/`).
  - GPU/regression scripts: `tools/test-render-pipeline.sh`, `tools/test-bridge.js`, `scripts/run-differential-tests.sh`.
  - Benches (Criterion):
    - Upload (runtime): `CRITERION_DEBUG=1 cargo bench -p render_loop_benches --bench upload`
    - Upload (typed): `CRITERION_DEBUG=1 cargo bench -p render_loop_benches --bench upload --features render_loop/typed-shaders`
    - Render (runtime): `CRITERION_DEBUG=1 cargo bench -p render_loop_benches --bench render_time`
    - Render (typed): `CRITERION_DEBUG=1 cargo bench -p render_loop_benches --bench render_time --features render_loop/typed-shaders`

## Integration Notes
- Backend state: `api_bridge` maintains `VolumeRegistry`, surface registries, and menu-driven template loading. Commands emit events (`volume-loaded`, `mount-directory-event`) consumed by UI hooks (`useMountListener`, etc.).
- Templates & atlases: `TemplateService` and `AtlasService` feed menu builders in `src-tauri/main.rs`; ensure new resources register there and in TS bindings.
- Shared enums/structs annotated with `#[ts(export)]` for TS binding generation. Keep them ASCII-friendly and update `packages/api` after changes.
- Frontend bootstraps services via hooks (`useServicesInit`, `useStatusBarInit`, `useMountListener`); global state lives in Zustand stores under `ui2/src/stores` with coalescing middleware to prevent render loops.
- GPU slice rendering: orchestrated in `render_loop`; front-end requests GPU handles via bridge commands and receives metadata (`VolumeLayerGpuInfo`, view states) for WebGPU canvas components.
- GPU atlas allocations are guarded by `LayerLease`; releases (manual or drop) clean up `layer_to_*` maps and free atlas slots. A watchdog (`BridgeState::start_layer_watchdog`) reclaims stale leases, and atlas capacity updates surface through `atlas.metrics`/`atlas.pressure`/`atlas.eviction` events.
- Atlas pressure monitoring: `AtlasPressureMonitor` (started from `useServicesInit`) polls `get_atlas_stats`, emits `atlas.metrics`/`atlas.pressure`, raises toast notifications when free layers ≤2 or atlas exhaustion events occur, and auto-evicts the oldest hidden/non-essential layer after repeated atlas exhaustion with a 15s backoff; evictions also emit `atlas.eviction` and the status bar now shows live atlas capacity/severity.
- Shader bindings: the default path still loads WGSL at runtime; enabling the `render_loop` feature flag `typed-shaders` runs the build-script through `wgsl_to_wgpu` 0.8.x and registers strongly-typed slice shaders (pipeline wiring in progress).
- Typed-shader smoke test: `cargo test -p render_loop --features typed-shaders --test typed_shaders_smoke` exercises the slice shader pipeline behind the flag.
- 4D time series support: `coord_to_grid_for_volume` now handles `DenseNeuroVec` coordinates (fourth axis optional in inputs) and associated unit tests pin the behaviour.
- Time navigation: `TimeNavigationService`/`useTimeNavigation` drive `set_volume_timepoint` via `ApiService`; layer metadata `currentTimepoint` stays in sync so render + histogram paths pull the correct 3D volume.

## Useful References
- High-level architecture & plans: `memory-bank/ARCHITECTURE.md`, `memory-bank/Implementation_Roadmap.md`.
- UI layout & component catalogs: `ui2/ui_architecture.md`, `ui2/docs/`.
- Backend deep dives: `core/api_bridge/docs/`, `core/render_loop/benchmarks.rs` for performance context.
- Operational logs: `dev_log.txt`, `tauri_dev_log.txt`, `tools/dev-watch.sh` monitors bridge changes.

## Long‑Term Direction (at a glance)
- Typed shader bindings trial (feature `typed-shaders`) using `wgsl_to_wgpu`; runtime WGSL remains default. CI check exists (`.github/workflows/typed-shader-check.yml`). Details: `memory-bank/SHADER_BINDINGS_PLAN.md`.
- Three‑view sync + multi‑view batch rendering guarded by UI feature flags; legacy per‑view render is the safe fallback.
- GPU resource safety: `LayerLease` RAII + watchdog; atlas pressure monitoring (`AtlasPressureMonitor`) surfaces telemetry and auto‑eviction with backoff.
- 4D/time navigation path is wired end‑to‑end; ensure new features keep timepoint metadata in sync.
- Benchmarks live under `core/render_loop_benches`; use to compare typed vs runtime paths before flipping defaults.
- Sprint roadmap: `memory-bank/sprints/Sprint_Foundations_Upgrade_1.md` and `memory-bank/Implementation_Roadmap.md`.

Keep AGENTS.md current when touching core architecture, commands, or directory structure so future agents can ramp quickly.

## Known Caveats
- Typed-shaders (wgsl_to_wgpu) colormap layout: the generated layout for the slice shader sets binding 16 (colormap LUT) to view_dimension D2, while the WGSL uses `texture_2d_array<f32>`. We currently bypass the generated group-2 bindings and build a manual wgpu bind group with D2Array to match the shader. Track upstream fix; keep the manual path until resolved. See memory-bank/SHADER_BINDINGS_PLAN.md.

## Core UI Stability Rules
- **Selectors must be stable.** When reading Zustand stores from React, selectors may only return primitive values or references that already live in the store. Never build objects/arrays inline; instead memoise derived shapes in the component. Provide an explicit equality fn when comparing nested data.
- **Guard effect-driven state updates.** Any effect that writes back into a store or component state must bail out when there is no actual value change. Always compare with the current value (e.g., `Object.is`) before calling setters.
- **Sanitise external callbacks.** Service hooks (`LayerService`, `SliceNavigationService`, etc.) should normalise inputs (swap thresholds, clamp ranges) and no-op if the resulting values match the existing state to prevent feedback loops.
- **Await and wrap listener teardown.** Tauri event cleanups return `Promise<void>`. Always invoke them through `safeUnlisten` (or equivalent) and `await` the promise inside a `try/catch` block when tearing down listeners. Never call the raw `listen` API directly.
- **Respect render-phase invariants.** Store writes are forbidden during render. If a change must mirror render-time data (e.g., view registration), schedule it via `requestAnimationFrame`/`setTimeout` so StrictMode does not explode.
- **Sync sliders & transient UI from canonical state.** Slider components keep local state for responsiveness, but they must snap back to store values when props update, guarded by equality checks to avoid oscillation. Emit final values on drag end to keep stores authoritative.
