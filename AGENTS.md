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
  - Analysis workbench lives under `ui2/src/components/analysis/` + `ui2/src/stores/analysisStore.ts`; it is a singleton workspace for discovery, job launch, polling, cancellation, and artifact handoff.
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
  - `cargo tauri dev`: run the full desktop app with hot reload; prefer this when backend/Tauri behavior matters.
  - `pnpm dev`: run the UI dev loop only; many app features require the Tauri backend.
  - `pnpm -r build` + `cargo tauri build`: production build.
  - `make local:deploy` or `make local-deploy`: build the macOS app bundle and install a `~/bin/brainflow` launcher that points at the repo-local bundle.
  - `make local:install` or `make local-install`: install the `~/bin/brainflow` launcher; the macOS release bundle can be built later.
  - `cargo xtask ts-bindings`: regenerate TypeScript bindings (drops files into `packages/api/src/generated`).
- Quality checks:
  - Rust formatting/linting: `cargo fmt --all`, `cargo clippy --workspace --all-targets`.
  - TypeScript formatting/linting: `pnpm format`, `pnpm lint`.
- Testing:
  - Rust: `cargo test --workspace`.
  - UI unit tests: `pnpm --filter ui2 test` (vitest) or `pnpm --filter ui test:unit` if legacy packages required.
  - E2E: `pnpm --filter ui test:e2e` (runs Playwright in `e2e/`).
  - Remote mount slice of the matrix: `cargo test -p api-bridge remote_mount_`, `pnpm --filter temp-ui exec vitest run src/services/__tests__/RemoteMountService.test.ts src/components/panels/__tests__/RemoteMountDialog.test.tsx src/components/panels/__tests__/FileBrowserPanel.remoteOrigin.test.tsx src/components/panels/__tests__/FileBrowserPanel.unmount.test.tsx`, then `cargo xtask ts-bindings`.
  - GPU/regression scripts: `tools/test-render-pipeline.sh`, `tools/test-bridge.js`, `scripts/run-differential-tests.sh`.
  - Render-golden harness (gate for rendering-data-affecting perf work): `cargo test -p render_loop --test render_golden_test`. Renders a fixed view of a deterministic volume and compares against the committed baseline in `core/render_loop/tests/goldens/` (exact FNV fast path, f16-tolerant fallback) plus a 1-voxel sensitivity check. Regenerate after an intended visual change with `UPDATE_RENDER_GOLDEN=1 cargo test -p render_loop --test render_golden_test`. GPU-bound: soft-skips with a `SKIP` line when no WGPU adapter is present.
  - Benches (Criterion):
    - Upload (runtime): `CRITERION_DEBUG=1 cargo bench -p render_loop_benches --bench upload`
    - Upload (typed): `CRITERION_DEBUG=1 cargo bench -p render_loop_benches --bench upload --features render_loop/typed-shaders`
    - Render (runtime): `CRITERION_DEBUG=1 cargo bench -p render_loop_benches --bench render_time`
    - Render (typed): `CRITERION_DEBUG=1 cargo bench -p render_loop_benches --bench render_time --features render_loop/typed-shaders`

## Integration Notes
- Startup ownership: the `api_bridge` plugin registers the single `BridgeState` and starts its layer watchdog. Desktop setup must use that state, not construct a second one. Background warmup and `init_render_loop` both call `BridgeState::ensure_render_loop`; the shared slot is published only after device and shaders are ready, and failed initialization remains retryable.
- Backend state: `api_bridge` maintains `VolumeRegistry`, surface registries, and menu-driven template loading. Commands emit events (`volume-loaded`, `mount-directory-event`) consumed by UI hooks (`useMountListener`, etc.).
- Analysis backend: `core/api_bridge/src/analysis.rs` now plugs into `BridgeState` and exposes `list_analyses`, `start_analysis`, `cancel_analysis`, and `get_analysis_job_status`. Discovery scans bundled plugins under `plugins/analyses/*` plus the user plugin dir, and the first workbench slice currently supports runnable single-volume analyses.
- Remote mounts: `RemoteMountDialog` and `RemoteMountService` drive `remote_mount_connect` / challenge-response commands, while `api_bridge` keeps the `RemoteMountRegistry`, saved-profile metadata, and staged cache. SSH/session behavior stays in `remotely`; Brainflow owns command translation, keychain-backed credential policy, cache freshness metadata, and the handoff back into the existing local `load_file` path via `materialize_remote_file_if_needed()`.
- Recovery behavior is split deliberately: `remotely` retries retryable SFTP list/stat/download operations once and exposes recovery hooks; `api_bridge` converts those hooks into `remote-mount-recovery` app events and tracing warnings, and `useMountListener` turns them into warning notifications for the UI.
- SFTP transport hardening (in `remotely`): all filesystem ops on a mount share a single multiplexed SFTP channel per SSH session (the `*_blocking` adapters clone the persistent `RemoteFs` instead of opening a fresh channel per call), so concurrent list/stat/download no longer exhaust the session and surface as "Channel send error". On top of the one-shot SFTP retry, `Session::ensure_connected` transparently re-establishes a dropped SSH session before each op — but only when auth can be replayed without a human (key file / agent / stored password; never keyboard-interactive), with a short cooldown to avoid reconnect storms against a down host.
- Templates & atlases: `TemplateService` and `AtlasService` feed menu builders in `src-tauri/main.rs`; ensure new resources register there and in TS bindings.
- Shared enums/structs annotated with `#[ts(export)]` for TS binding generation. Keep them ASCII-friendly and update `packages/api` after changes.
- Frontend bootstraps services via hooks (`useServicesInit`, `useStatusBarInit`, `useMountListener`); global state lives in Zustand stores under `ui2/src/stores` with coalescing middleware to prevent render loops.
- GoldenLayout creates isolated React roots per docked panel. Any state that must update across panels must live in a global store/service such as Zustand, not React Context.
- Files-panel remote provenance is intentionally root-only: mounted remote roots carry the SSH origin badge/tooltip, while child rows should render with the same affordances as local entries.
- GPU slice rendering: orchestrated in `render_loop`; front-end requests GPU handles via bridge commands and receives metadata (`VolumeLayerGpuInfo`, view states) for WebGPU canvas components.
- Slice rendering feature uniforms: optional cross-layer slice features use the sidecar `SliceFeatureUbo` at bind group 3. Keep `LayerUboStd140` for per-layer display state; selected-label outlines and similar orthogonal features should flow through the sidecar rather than expanding every layer record.
- Slice display sharing: `SliceRenderer` is the low-level bitmap canvas primitive, while `ui2/src/components/views/SliceViewport.tsx` is the shared mid-level viewport used by orthogonal `SliceViewCanvas`, `ComparisonPanel`, and `MosaicCell`. Keep render scheduling workspace-specific (`ComparisonRenderService`, `MosaicRenderService`, orthogonal view services), but route context registration, placement bookkeeping, click-to-world mapping, and standard crosshair overlays through the shared viewport/hooks unless a workspace has a documented special case (for example mosaic mirror-crosshair styling).
- GPU atlas allocations are guarded by `LayerLease`; releases (manual or drop) clean up `layer_to_*` maps and free atlas slots. A watchdog (`BridgeState::start_layer_watchdog`) reclaims stale leases, and atlas capacity updates surface through `atlas.metrics`/`atlas.pressure`/`atlas.eviction` events.
- GPU-resident image-set stack (the generalized "4th axis": timepoint/subject/contrast/condition). `core/api_bridge/src/image_set.rs` defines the `ImageSet` trait (`Raw4DImageSet` adapter today), the pure `ResidentRing` policy (LRU + VRAM byte budget) behind a `RingExecutor` seam, and the `ResidentImageSet` holder kept per-layer in `BridgeState::resident_image_sets`. On a member change, `try_resident_swap` (in `lib.rs`, called from `prepare_frontend_layers_for_render`'s `requires_reupload` branch) keeps several co-registered members uploaded and makes the switch a **volume→slot repoint** (`register_volume_with_range`) plus prefetch — no CPU extract + full re-upload. The ViewState renderer resolves a layer's texture via `RenderLoopService::volumes[volume_id].atlas_index` (`render_loop/src/lib.rs:5085`), so that binding — not a persistent per-layer `texture_index` — is the swap lever; `set_layer_texture_index`/`update_volume_3d_at`/`MultiTextureManager::{resident_bytes,update_volume}` are the render_loop primitives. Env kill-switch `BRAINFLOW_RESIDENT_IMAGE_SET=0` forces the legacy path; ring slots are reclaimed via `release_resident_image_set` on layer teardown. Design/rollout: `docs/plans/gpu-resident-image-set-stack.md`.
- Batched slice readback (P4): `batch_render_slices` (`api_bridge/src/lib.rs`) locks the render service once, renders every slice via `request_frame_with_options(FrameReadbackMode::Skip)`, then calls `RenderLoopService::read_views_to_images` (one encoder / one `queue.submit` / one `poll(Wait)` for the whole batch) — collapsing the old 2N submits + N blocking syncs into N+1 submits + 1 sync. Output envelope is byte-identical (`[width][height][slice_count]` header + RGBA slabs) so the frontend `decodeBatchRenderBuffer` path is unchanged; `batch_readback_test.rs` gates batched vs sequential byte-equality. Env kill-switch `BRAINFLOW_BATCH_READBACK=0` forces the legacy per-slice render+readback. The frontend zero-copy present (putImageData/bitmaprenderer) is intentionally deferred (visual-only; see the plan doc P4).
- Cross-set trace (P5): `sample_set_trace_at_world` command returns, per cohort member, an ROI-reduced value plus a dispersion band (`{ memberId, value, lower, upper, count }`) — band kinds `sem95`/`sd`/`ci95`/`iqr`/`none` via `roi_spread_band` + `quantile_type7` (`api_bridge/src/lib.rs`). `SetStudioImageSet` (`image_set.rs`) is the `ImageSet` adapter over cohort members with ontology labels from a `SpatialFieldSetSummary` design-table preview. Frontend: `SampleRequest.band` routes a `set` locus through the trace command in `SampleProvider.sampleSet`, yielding a `member/value/lower/upper/count` frame. The visual plot mode is the `setTracePlot` mode (`ui2/src/components/plots/SetTracePlot.tsx` + `.mode`/`.toolbar`/`.helpers`, registered in `PlotPanel`): it renders a line + shaded CI ribbon over an ontology-labelled categorical member axis, switchable to a carpet/grayplot `heatmap`. Two encoder-level changes power it — the continuous marks (`line`/`area`/`point`) now place a nominal/ordinal x on a `scalePoint` axis (so a categorical member axis draws instead of being dropped), and the band flows as a sidecar `meta.suggested.band = { lower, upper }` resolved onto `ResolvedPlotSpec.band` (kept only when both columns exist; the line/area marks draw it with visx `Area` `y0`/`y1` behind the line, widening the y-domain to include the bounds). Band kind is a toolbar select backed by `plotSpecStore.bandByMode` (persist v3, default `sem95`). Marks are plain SVG, so geometry is regression-tested deterministically in jsdom (`traceMarks.test.tsx`); a dev-only Vite harness (`ui2/src/devHarness/plotHarness.tsx` + `plot-harness.html`, served by `pnpm dev`, excluded from the production build) drives the real `PlotEncoder` with mocked frames for visual/screenshot checks without `cargo tauri dev`. The only remaining app-only check is the in-app click path (click a `set` locus → `sample_set_trace_at_world` → this panel).
- Atlas pressure monitoring: `AtlasPressureMonitor` (started from `useServicesInit`) polls `get_atlas_stats`, emits `atlas.metrics`/`atlas.pressure`, raises toast notifications when free layers ≤2 or atlas exhaustion events occur, and auto-evicts the oldest hidden/non-essential layer after repeated atlas exhaustion with a 15s backoff; evictions also emit `atlas.eviction` and the status bar now shows live atlas capacity/severity.
- Shader bindings: the runtime masked WGSL path is authoritative for current slice rendering. Active sources are `core/render_loop/shaders/slice_world_space_masked.wgsl` and `core/render_loop/shaders/slice_world_space_optimized_masked.wgsl`. `core/render_loop/src/shader_contract.rs` is the single source of truth for group/binding indices, and `cargo test -p render_loop --test shader_contract_test` is the structural gate: it reflects both shaders with `naga` and fails if any UBO struct offset/size or bind-group binding drifts from the Rust structs and layout builders.
- Typed-shaders are quarantined while the alpha-mask/runtime masked pipeline is active. The `render_loop/typed-shaders` feature intentionally fails fast with a `compile_error!`; do not use it to validate outline or layer-mode work until `memory-bank/SHADER_BINDINGS_PLAN.md` is updated and generation is retargeted to the active masked shaders.
- 4D time series support: `coord_to_grid_for_volume` now handles `DenseNeuroVec` coordinates (fourth axis optional in inputs) and associated unit tests pin the behaviour.
- Time navigation: `TimeNavigationService`/`useTimeNavigation` drive `set_volume_timepoint` via `ApiService`; layer metadata `currentTimepoint` stays in sync so render + histogram paths pull the correct 3D volume.

## Tauri Command Bridge
- Parameter naming crosses conventions automatically: JavaScript calls use camelCase (`originMm`, `layerId`), while Rust command args use snake_case (`origin_mm`, `layer_id`).
- The command list is **single-sourced** in `core/api_bridge/src/command_list.rs` (the `bridge_commands!` invocation). That one file drives the runtime invoke handler (`api_bridge::invoke_handler`), `api_bridge::COMMANDS`, the plugin permission autogeneration (`build.rs` parses the same file), and the generated frontend transport list (`packages/api/src/generated/apiBridgeCommands.ts`). `ui2/src/services/transport.ts` imports that generated array — do not hand-maintain a command list there.
- Adding a new Tauri command:
  1. Define the Rust command function with `#[command]` (in `lib.rs`, or `analysis.rs` for analysis commands — submodule commands are imported into crate scope in `lib.rs`).
  2. Add its bare identifier to `bridge_commands! { … }` in `command_list.rs`.
  3. Grant it: add an `allow-*` entry to `core/api_bridge/permissions/default.toml` (or, for sensitive commands, grant it via `src-tauri/capabilities/*.json` and leave it out of `default.toml`).
  4. Regenerate: `cargo xtask ts-bindings` (emits `apiBridgeCommands.ts`), `pnpm --filter @brainflow/api build` (the UI consumes the built `dist/`), and `cargo build -p api-bridge` (regenerates `permissions/autogenerated/`; delete any now-stale `commands/<cmd>.toml`).
- Verify with `pnpm check:permissions:strict` (gate: `tools/check_api_bridge_permissions.mjs`) and `cargo test -p api-bridge` (includes the `command_list.rs` ↔ `COMMANDS` sync test).
- Frontend invocation uses the plugin namespace, for example `invoke('plugin:api-bridge|update_frame_ubo', { originMm, uMm, vMm })`.
- See `core/api_bridge/ADDING_COMMANDS.md` before changing command surfaces.

## Rendering & Coordinates
- Preserve the volume affine world frame (NIfTI qform/sform uses +R, +A, +S). Surface payloads already contain `vertices_world` with the GIfTI transform applied; do not add a frontend X reflection. Axis labels derive from the signed view basis. GPU/WebGPU internals use Y=0 at bottom; CPU/image buffers use Y=0 at top.
- Linked surface cursors use `surfaceLink.ts` and the visualization canvas's `cursorAnatomy` correspondence: pial/white world vertices directly, inflated/sphere only through a matching anatomical mesh with identical topology. This is coordinate linking, not registration of unrelated spaces.
- Montage rendering uses one `MosaicRenderService` instance per workspace. Reference-volume voxel-center bounds and slice count determine sampling via `mosaic/sliceGeometry.ts`; overlays can enlarge framing but cannot change reference slice spacing. Keep metadata results and render completions guarded against stale workspace state.
- The neurosurf CPU projection adapter (`core/api_bridge/src/projection_geometry.rs`) accepts signed diagonal affines and rejects rotation/shear explicitly; full oblique CPU projection remains unsupported. The frontend GPU projection retains the full affine.
- Keep Y-flips isolated to GPU buffer readback (`render_to_buffer()`); do not add compensating flips to geometry, slice specs, or CPU renderer paths.
- CPU rendering (`neuro-cpu`) uses image convention internally and should match GPU output after readback.
- Preserve square pixels for medical imaging. When fitting an extent into a viewport, use a uniform pixel size: `max(extentX / dimX, extentY / dimY)`.
- Backend reference for aspect-ratio preservation: `core/neuro-types/src/view_rect.rs` (`SliceGeometry::full_extent`).

## Alpha Navigation and Teardown Contracts
- Async cursor and resize operations capture a workspace identity and request order. Apply results only to that workspace; re-align returned slice planes to its current crosshair with `ui2/src/stores/viewStateGeometry.ts`. Reset invalidates outstanding requests.
- A bitmap can stay unchanged while a crosshair moves or hides. Shared slice overlay callbacks must invalidate canvas drawing when overlay inputs change; clearing an image must clear its canvas.
- Surface unload owns projected overlays and cached samplers as well as the mesh. Publication after asynchronous projection must recheck surface registration, using registry-before-sampler lock ordering.
- `cargo test -p render_loop --test alpha_resource_lifecycle_test -- --nocapture` exercises 200 upload/release cycles and requires a GPU. Zero resident texture accounting is asserted; process RSS is observational, not a long-session leak certification.
- Alpha evidence and manual checks live in `docs/alpha-readiness.md` and `docs/alpha-acceptance.md`.

## UI Layout Caveats
- In GoldenLayout panels, React Context is panel-local because each panel has its own React root; use Zustand or services for cross-panel state.
- In Allotment panes, avoid relying on nested `flex`/`flex-1` layouts for critical content such as bottom slice sliders. Use absolute positioning or explicit dimensions inside the pane.

## Useful References
- High-level architecture & plans: `memory-bank/ARCHITECTURE.md`, `memory-bank/Implementation_Roadmap.md`.
- Analysis plugin protocol: `docs/analysis_plugins.md`, bundled example at `plugins/analyses/example/`.
- Remote mount architecture + runbook: `memory-bank/REMOTE_MOUNTS.md`.
- UI layout & component catalogs: `ui2/ui_architecture.md`, `ui2/docs/`.
- Backend deep dives: `core/api_bridge/docs/`, `core/render_loop/benchmarks.rs` for performance context.
- Operational logs: `dev_log.txt`, `tauri_dev_log.txt`, `tools/dev-watch.sh` monitors bridge changes.

## Long‑Term Direction (at a glance)
- Typed shader bindings trial (feature `typed-shaders`) using `wgsl_to_wgpu`; currently quarantined, while runtime WGSL remains default and authoritative. Details: `memory-bank/SHADER_BINDINGS_PLAN.md`.
- Three‑view sync + multi‑view batch rendering guarded by UI feature flags; legacy per‑view render is the safe fallback.
- GPU resource safety: `LayerLease` RAII + watchdog; atlas pressure monitoring (`AtlasPressureMonitor`) surfaces telemetry and auto‑eviction with backoff.
- 4D/time navigation path is wired end‑to‑end; ensure new features keep timepoint metadata in sync.
- Benchmarks live under `core/render_loop_benches`; use to compare typed vs runtime paths before flipping defaults.
- Sprint roadmap: `memory-bank/sprints/Sprint_Foundations_Upgrade_1.md` and `memory-bank/Implementation_Roadmap.md`.

Keep AGENTS.md current when touching core architecture, commands, or directory structure so future agents can ramp quickly.

## Known Caveats
- Typed-shaders (wgsl_to_wgpu) are not part of the current rendering contract. The old generated path targeted unmasked slice shaders and had a colormap layout mismatch; keep the feature quarantined until generation targets the active masked shaders and the smoke test is restored. See memory-bank/SHADER_BINDINGS_PLAN.md.

## Core UI Stability Rules
- **Selectors must be stable.** When reading Zustand stores from React, selectors may only return primitive values or references that already live in the store. Never build objects/arrays inline; instead memoise derived shapes in the component. Provide an explicit equality fn when comparing nested data.
- **Guard effect-driven state updates.** Any effect that writes back into a store or component state must bail out when there is no actual value change. Always compare with the current value (e.g., `Object.is`) before calling setters.
- **Sanitise external callbacks.** Service hooks (`LayerService`, `SliceNavigationService`, etc.) should normalise inputs (swap thresholds, clamp ranges) and no-op if the resulting values match the existing state to prevent feedback loops.
- **Await and wrap listener teardown.** Tauri event cleanups return `Promise<void>`. Always invoke them through `safeUnlisten` (or equivalent) and `await` the promise inside a `try/catch` block when tearing down listeners. Never call the raw `listen` API directly.
- **Respect render-phase invariants.** Store writes are forbidden during render. If a change must mirror render-time data (e.g., view registration), schedule it via `requestAnimationFrame`/`setTimeout` so StrictMode does not explode.
- **Sync sliders & transient UI from canonical state.** Slider components keep local state for responsiveness, but they must snap back to store values when props update, guarded by equality checks to avoid oscillation. Emit final values on drag end to keep stores authoritative.

## Alpha Loading Lifecycle (2026-09-04)

- Volume requests capture `activeWorkspaceKey` before backend I/O (files, templates,
  atlases). `LayerLoadContext` carries that destination and initial geometry into
  `LayerApiImpl`; `setViewState(updater, workspaceId)` publishes into that exact
  workspace. Closed destinations fail with rollback. Background histogram results
  must still match the original display properties before refining contrast.
- `LoadScheduler` provides two FIFO admission slots shared by volume and surface
  file loads. Surface geometry is fetched before store publication. Failed volume
  loads unload provisional decoded data; failed GPU allocations release their lease.
- `api_bridge::histogram` scans twice with O(bin_count) scratch space and f64
  moments on a blocking worker. Reject invalid bin counts/ranges and ignore
  non-finite values; requested ranges restrict bins, not summary statistics.
- `api_bridge::surface_loading` retains geometry from its first decode; commands
  run decoding off async workers. Orthogonal `render_views` uses distinct per-pane
  targets and `read_views_to_images_sized` for one readback across unequal panes.
  `RenderViewsDiagnostics.readback_ms` measures the shared readback; per-view frame
  diagnostics correctly report `Skip` for their submit-only stage.
- Remote I/O ownership lives in `remote_transfer`: non-Send `remotely` futures run
  inside owned blocking runtime adapters, and timeouts/cancellation happen inside
  those adapters. Writers retain operation permits through private staging cleanup.
  `cancel_remote_file_load(path)` requests cancellation; `remote-file-progress`
  carries real byte counts to Activity. Unmount cancels writers and drains permits
  before cache purge. Downloads use a 90s idle deadline and 1h total ceiling.
- `remote_cache` uses SHA-256 endpoint/root identities across reconnects, validates
  local length and known remote size/mtime, and evicts inactive mount roots before
  exceeding a 4 GiB default budget (`BRAINFLOW_REMOTE_CACHE_BYTES` overrides it).
  Active mounts are pinned; downloads serialize cache admission to avoid exceeding
  the disk budget. Directory browsing remains independently bounded per mount.
- Regression evidence and limitations: `docs/loading-hardening-2026-09-04.md`.

## Parcel table overlays (2026-09-05)

- Known volume atlases retain their canonical dictionary in `VolumeRegistry` at
  load time (`core/atlases/src/parcel_dictionary.rs`). The atlas Inspector opens
  `ParcelTableImport`; `ParcelOverlayService` creates an independent layer and
  serializes column changes. The **active** route is `InspectorRouter` →
  `ImagingInspector` → `SectionRouter` → `ParcelValuesSection`. Do not wire new
  controls only into the legacy `LayerInspectorContent` / `ParcelOverlayInspector`.
  Recognize atlas configuration even when the atlas is a `volume-base` scene item.
- `preview_parcel_table`, `create_parcel_overlay`, and `select_parcel_column`
  delegate to `api_bridge::parcel_overlay`. Strict matching uses neuroatlas;
  blocking workers parse CSV/TSV and build scalar snapshots, with identity/revision
  checks before publication. Missing values are NaN on CPU and transparent in LUTs.
- An overlay's normal registry `data` is its current numeric snapshot. Only GPU
  upload calls `get_render_arc`, which returns the shared label geometry. Render
  preparation converts values/limits/thresholds to an owned RGBA row; column changes
  update the LUT, not the GPU geometry. Keep both upload paths on `get_render_arc`.
  Unload releases the row via `remove_custom_colormap`; slots are cached/reused.
- Schaefer surface annotations have hemisphere-local IDs. Neuroatlas `b7ec84e`
  maps full annotation names to the canonical volume LUT before Brainflow receives
  them, rejecting unknown/duplicate/wrong-hemisphere names. Its LUT parser treats
  RGB/A fields as metadata rather than appending them to parcel names.
- Surface atlas loads return an opaque `parcel_dictionary_id` from the concrete
  neuroatlas dictionary. `preview_surface_parcel_table` and `bind_surface_parcel_table`
  share the strict volume-table parser. The bridge keeps up to 64 content-addressed
  dictionaries (LRU); expired imports request an atlas reload. Completed surface
  overlays retain the compact validated table themselves, independent of that cache.
  `SurfaceParcelOverlayService` scatters by the labels already attached to each
  mesh, checks dictionary codes and unchanged source geometry before atomic publication,
  and groups loaded hemispheres for column changes. Missing/background values are
  NaN; clear surface thresholds with `[0, 0]`, not `undefined` (the renderer treats
  undefined as no update). Mesh/layer removal owns these arrays; no GPU volume is created.
- `get_atlas_roi_locations` scans the loaded atlas on a blocking worker and returns
  a real voxel nearest each parcel's world-space centroid. `AtlasRoiPicker` offers
  name/ID search and previous/next navigation; `AtlasRoiService` moves the crosshair
  through the canonical workspace navigation path. Never jump to an unverified centroid.
- Current scope: discrete atlas IDs 1–2047, volume and native surface bindings,
  session-local tables. Saved-session persistence remains pending. See
  `docs/plans/roi-table-atlas-overlays.md`; dev UI fixture is
  `/parcel-overlay-harness.html` (mocked IPC, excluded from the production build).

## Folder Image Sets

- Files offers **Open folder as image set…** for direct NIfTI children. The global
  `OpenImageSetDialog` is mounted once in `App`; `ImageSetService` and
  `imageSetStore` coordinate discovery, membership, pending selection and
  per-member display preferences across panel roots.
- One member occupies one volume layer. `LayerLoadContext.replaceLayerId`
  prepares the new GPU resource before replacing the old scene/view entries;
  request guards prevent stale publication. Replacement preserves all referencing
  workspaces' geometry and layer order, updates Inspector/Compare references,
  then retires the previous allocation and volume.
- A collection's `imageSetId` is stable; its active volume/layer ID changes.
  Members need not share a grid. Remote members use the existing disk cache;
  this browsing workflow does not preallocate the whole collection or assume the
  co-registered `ImageSet` GPU ring contract. See `docs/folder-image-sets.md` and
  the dev-only `/image-set-harness.html` for the workflow and UI check.
