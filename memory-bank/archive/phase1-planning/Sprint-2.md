# Brainflow • Sprint 2 Backlog (WebGPU v2 – Milestone M4 Kick-off)

**Version:** 1.1 (Incorporates Review Feedback)
**Sprint window:** [Start Date] → [End Date] (10 d budget)
**Context:** Sprint 1 delivered the first dense slice through the fully-wired Tauri ↔ WebGPU pipeline. Sprint 2 finishes the orthogonal triple-view UX, brings in the first GIfTI surface, and introduces per-layer UI controls so real neuro datasets become explorable.

**Developer Note:** The canonical `VolumeView` component is located at `ui/src/lib/components/views/VolumeView.svelte`. Please ensure all relevant modifications target this file.

---

## 🎯 Sprint 2 Goal (Definition of Done)

*   App starts in 3-panel orthogonal layout (Ax/Cor/Sag) and shows:
    *   A loaded T1w volume (template or user file) in all three planes.
    *   A second overlay volume composited with user-controlled **opacity & window/level**. (*Thresholds/blend modes are stretch*).
*   **[Critical]** Cross-hair click in any plane updates the other two instantly (≤ 16 ms frame time).
*   A GIfTI surface mesh (e.g., `fsaverage` lh.pial from `DATA-fixtures`) can be loaded and toggled on/off in a 3-D viewport tab (rotation ≥ 60 fps target hardware).
*   Playwright smoke test `e2e/orthogonal-multi-layer.spec.ts` (covering multi-layer load, basic controls, and crosshair interaction) passes on CI.
*   Criterion benchmark `bench_texture_upload` meets platform-specific gates (>2 GB/s discrete GPU, >1 GB/s Apple M1/Unified) on CI runners.
*   No `await` holds a lock (`cargo deny check bans` clean).

---

## 📑 Task list

| Status | ID          | Title                                                                                              | Owner        | Labels                         | Depends On    | Est.   | Notes / Acceptance Criteria (AC)                                                                                                                                                                                                                                                                                                                                                                                         |
| :----- | :---------- | :------------------------------------------------------------------------------------------------- | :----------- | :----------------------------- | :------------ | :----- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[~]`  | **BF-040**  | **[Critical] Slice sync UBO**: expose `set_crosshair(world)`; shader reads UBO                    | rust-core    | rust wgpu M3 render            | BF-016        | 0.75 d | **AC**: **[x]** 1. Define UBOs (`Crosshair`,`ViewPlane`). **[x]** 2. Define `FrameUbo`. **[x]** 3. Vertex Shader (`FrameUbo`->`world_mm`). **[x]** 4. Frag Shader (`slice_index` helper). **[x]** 5. Bind Group 0 layout/bind (`Frame`,`Crosshair`,`ViewPlane`). **[x]** 6. `set_crosshair` lock-safe (`Arc<Queue>`). **[x]** 7. UBO write test (`map_async`). **[x]** 8. Shader compile test. **Checkpoints:** C1: [x] Buf/Cmd/Test. C2: **[~]** Shader compiles (Test added). C3: **[ ]** Click updates views (Needs BF-041). |
| `[~]`  | **BF-041**  | **VolumeView**: subscribe to crosshair store; emit **debounced**(8ms) update on click              | ui           | svelte state M3 ui             | BF-017, BF-040, BF-040b | 0.5 d  | **AC**: Central crosshair store exists. Click updates store. Store change triggers **debounced**(8ms, >0.01mm) call to `set_crosshair`. Plane change calls `set_view_plane` (BF-040b). *(UI Integration Started)*            |
| `[x]`  | **BF-040b** | **Backend `set_view_plane` command**                                                             | rust-core    | rust tauri M3 api            | BF-040        | 0.1 d  | **AC**: Simple Tauri command taking `plane_id: u32`, writes to a small (4B) uniform buffer managed by `RenderLoopService`, used for `@group(0) @binding(2)`.                                |
| `[ ]`  | **BF-042a** | **Layer controls panel scaffold**: Basic controls render & update `layerStore`                   | ui           | svelte ux M7 ui                | BF-018        | 0.75 d | AC: Panel shows controls for opacity, colormap, window/level, threshold. Controls read from `layerStore`. Changes update `layerStore` via `patch(id, delta)`. Basic layout, no polish.           |
| `[ ]`  | **BF-042b** | **Layer controls panel polish**: Styling, tooltips, keyboard shortcuts                           | ui           | svelte ux M7 ui polish         | BF-042a       | 0.5 d  | *(Stretch/Lower Priority)* AC: Controls match design spec (`shadcn`). Tooltips explain fields. Basic keyboard nav works.                                                                     |
| `[ ]`  | **BF-043a** | **Shader v0**: implement opacity, window/level, basic alpha compositing                          | rust-core    | wgsl M3 render                 | BF-016, BF-042a| 0.75 d | AC: Fragment shader applies opacity + window/level mapping. Basic `blend: OVER` logic works for 2 layers.                                                                                 |
| `[ ]`  | **BF-043b** | **Shader v1**: implement thresholds & remaining blend modes                                        | rust-core    | wgsl M3 render                 | BF-043a       | 0.5 d  | *(Stretch/Lower Priority)* AC: Thresholding logic added. `ADD`, `MAX`, `MIN` blend modes implemented as per ADR-002.                                                                      |
| `[ ]`  | **BF-044**  | **[Critical] Multi-layer rendering**: iterate UBO array; composite layers based on store order | rust-core+ui | rust wgpu M3 render state    | BF-043a       | 0.75 d | AC: `RenderLoopService` draws layers based on `layerStore` order. Visually correct composite with 2 test overlays.                                                                      |
| `[ ]`  | **BF-045**  | **KD-tree build** in `volmath::accel`; expose `world_to_surface_vertex` stub                     | rust-core    | rust M6 volmath              | BF-006b       | 0.75 d | AC: Uses `kiddo`. Builds tree on surface load. Stub API for future picking exists.                                                                                                       |
| `[ ]`  | **BF-046**  | **GIfTI loader** (`core/loaders/gifti`) returns `SurfaceSendable`                                | rust-core    | rust io M4 loader              | BF-045        | 0.75 d | AC: Parses vertices, normals, faces via `gifti` crate. Returns data via `ArrayBuffer`s. **Sub-task**: Spike FreeSurfer ASCII load (`lh.pial.asc`) viability/ergonomics.                  |
| `[ ]`  | **BF-047**  | **`SurfaceView.svelte` tab + Three.js renderer** (basic Phong, OrbitControls)                  | ui           | svelte threejs M4 ui         | BF-046        | 1 d    | AC: Loads geometry from SABs. Basic scene renders. Controls work. **Windows:** Verify no flicker (use `alpha:true`, `premultipliedAlpha:false` in renderer).                                  |
| `[ ]`  | **BF-048**  | **Loader registry/UI update for `.gii`**; default layer type "Surface"                         | rust-core+ui | rust tauri M4 api svelte     | BF-046        | 0.25 d | AC: Detects `.gii`, returns `SurfaceHandleInfo`. Update `TreeBrowser`/`layerStore` logic.                   |
| `[ ]`  | **BF-049**  | **Logging**: add `tracing::instrument` spans; propagate request-id                             | infra        | rust logging tracing         | ---           | 0.5 d  | AC: Key backend functions/commands wrapped in spans. Request ID passed from UI if feasible.                        |
| `[ ]`  | **BF-050**  | **Playwright smoke test**: load T1w + overlay; click crosshair; check other view updates       | qa           | e2e M3 testing               | BF-041, BF-044| 0.5 d  | **AC**: Test loads two layers. Simulates click in one view (e.g., Sagittal). Waits for render. Samples center pixel in another view (e.g., Axial), asserts pixel `rgba !== (0,0,0,0)` or hash change. |
| `[ ]`  | **BF-051**  | **CI matrix**: enable Win-GPU runners; fix validation warnings                                 | infra        | ci M3 infra wgpu stretch     | BF-013        | 0.5 d  | *(Stretch Goal)* AC: Attempt to enable GPU runners. Fix `wgpu` validation issues found. **Fallback**: Skip GPU tests on CI, run manually if provisioning fails.                               |
| `[ ]`  | **BF-052**  | **Docs**: update ADR-002 (slice sync) & GUIDE-ui-layout-phase1.md (LayerPanel)                 | docs         | docs M3 M7 documentation     | BF-040, BF-042a| 0.25 d | AC: ADR-002 reflects crosshair UBO & view plane uniform. GUIDE updated with LayerPanel details from BF-042a/b (interactions, keyboard shortcuts if added).                                     |
| `[ ]`  | **BF-053a** | **Tech-debt**: Refactor `LoaderRegistry` -> `RwLock`                                           | rust-core    | refactor rust concurrency      | BF-046        | 0.5 d  | AC: Replace `Mutex` with `RwLock` for read-heavy access. Tests pass.                                                                                                                            |
| `[ ]`  | **BF-053b** | **Tech-debt**: Refactor `RenderLoopService` internal state -> `RwLock` (if needed)             | rust-core    | refactor rust concurrency      | BF-016        | 0.5 d  | AC: Identify & refactor read-heavy `Mutex` usage (if applicable beyond `Arc<Queue>` pattern). Tests pass. `set_crosshair` safety meets goal.                                                 |
| `[ ]`  | **BF-037**  | **Verify/Update `DATA-fixtures` for Surface Data**                                           | qa/infra     | data M4 testing data       | ---           | 0.25 d | AC: `datasets.yaml` includes `fsaverage` GIfTI. `toy_surface.gii` exists in LFS. `fetch:refs` works.                                                                              |
| `[ ]`  | **BF-054**  | **Setup `ts-rs` for Rust->TS Type Generation**                                               | infra/core   | codegen M8 infra types     | ---           | 1 d    | **AC:** Configure `ts-rs` build step. Add derives to Rust types (`VolumeHandleInfo`, `BridgeError`, etc.). Import generated types in UI (`$lib/api.ts`, stores). Typed errors handled. Enums generated/used. |
| `[ ]`  | **BF-055**  | **Refactor UI File Structure (`ipc`, `math`, `colormaps`)**                                  | ui           | refactor M8 ui structure     | ---           | 0.5 d  | **AC:** `api.ts` moved to `lib/ipc/`. Helpers/constants moved to `lib/math/`, `lib/colormaps/` etc. Imports updated.                                                                        |
| `[ ]`  | **BF-056**  | **Use Typed Array for `get_timeseries_matrix` Payload**                                      | rust-core+ui | perf M6 api types binary   | BF-054        | 0.5 d  | **AC:** Rust returns binary payload. TS API uses `Float32Array`. `TimeSeriesResult` type updated (Rust+TS). Test verifies binary transfer.                                                      |

### 🌲 Tree Browser Implementation
*(See full details in [`memory-bank/treebrowser_plan.md`](./treebrowser_plan.md))* 

| Status | ID          | Title                                                               | Owner        | Labels                         | Depends On | Est.   | Notes / Acceptance Criteria (AC)                                                                                                                                                                                                                                                             |
| :----- | :---------- | :------------------------------------------------------------------ | :----------- | :----------------------------- | :--------- | :----- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[ ]`  | **BF-TB-01**| **Define Core Types**: `Loader` trait, `Loaded` enum, `BridgeError`   | rust-core    | rust types M8 refactor         | ---        | 0.25 d | **AC:** Types defined in `bridge_types`. `NiftiLoader` adapted to new `Loader` trait (`Sealed`, `can_load`, `load` -> `todo!()`). **Note:** Requires coordination with `core/loaders/mod.rs` (BF-TB-01.Registry) & temporary commenting of `From<NiftiError>` in `nifti_loader`.                 |
| `[ ]`  | **BF-TB-01.Registry**| **Update Loader Registry**: `core/loaders/mod.rs`                     | rust-core    | rust types M8 refactor         | BF-TB-01   | 0.1 d  | **AC:** `static CAN_LOAD_FNS` array & `is_loadable` func updated to use new `Loader::can_load` signature. **Note:** Must be done simultaneously with BF-TB-01.                                                                                                                                  |
| `[ ]`  | **BF-TB-02**| **Define Payload Types**: `FlatNode`, `TreePayload`, `IconId` enum    | rust-core    | rust types M8 api            | BF-TB-01   | 0.1 d  | **AC:** Structs/enums defined in `bridge_types` for flat list representation (`parent_idx`, `icon_id`).                                                                                                                                                                                   |
| `[ ]`  | **BF-TB-03**| **Implement `fs_list_directory`** command stub                  | rust-core    | rust tauri M8 api            | BF-TB-01.Registry, BF-TB-02   | 0.5 d  | **AC:** Command exists, uses `spawn_blocking`, canonicalizes path, returns `BridgeResult<TreePayload>`, maps internal errors to new `BridgeError`. Scope check stubbed. Walk logic `todo!()`. Registered. **Note:** Assumes `is_loadable` works; `load` callers would need changes here.              |
| `[ ]`  | **BF-TB-04**| **Implement Tree Walk Logic & Nifti Load**: Populate `TreePayload` | rust-core    | rust M8 api walkdir loader     | BF-TB-03   | 1.0 d  | **AC:** Fills `TreePayload.nodes`. Handles macOS bundles. **Implement `NiftiLoader::load` body**: Calls `load_nifti_volume`, maps output to `Loaded::Volume`, maps `NiftiError` -> `BridgeError` (reimplement `From` trait).                                                                    |
| `[ ]`  | **BF-TB-05**| **Integrate TS API**: Define types, wrap `fs_list_directory`        | ts-api       | ts types M8 api codegen      | BF-TB-02, BF-TB-03 | 0.25 d | **AC:** Interfaces (`FlatNode`, `TreePayload`, `BridgeError`) & `IconId` enum exist. `coreApi` wrapper invokes `fs_list_directory`. **Handles new `BridgeResult<T, BridgeError>`**.                                                                                                               |
| `[ ]`  | **BF-TB-06**| **Implement `TreeBrowser.svelte`**: Fetch, Store, Virtual list      | ui           | svelte M8 ui virtualization    | BF-TB-05   | 0.75 d | **AC:** Component exists (`browser/TreeBrowser.svelte`). Fetches data. Uses stores. **Renders nodes using `svelte-virtual-list`**. Displays loading/error states based on **new** `BridgeError`. Basic styling.                                                                               |
| `[ ]`  | **BF-TB-07**| **Implement Node Click**: Dispatch `load-file` event              | ui           | svelte M8 ui interaction       | BF-TB-06   | 0.1 d  | **AC:** Clicking a non-directory node dispatches `load-file` event with `FlatNode` data.                                                                                                                                                                                                    |
| `[ ]`  | **BF-TB-08**| **Define FS Capabilities**: Add scopes for `$DOWNLOAD`            | infra        | tauri M8 security capabilities | BF-TB-03   | 0.1 d  | **AC:** `capabilities/*.json` updated with `fs:scope-*` perms. `ipc:allow-invoke:fs-list-directory` added.                                                                                                                                                                   |
| `[ ]`  | **BF-TB-09**| **Add Basic Tests**: Loader `can_load`, `fs_list_directory` tests | rust-core    | rust M8 testing unit         | BF-TB-04, BF-TB-08 | 0.5 d  | **AC:** Unit test for `NiftiLoader::can_load`. Integration test for `fs_list_directory` using `assert_fs`/`tempfile` verifies output structure & error mapping. **Note:** Update/uncomment tests affected by signature changes in BF-TB-01/03.                                                     |

| `[ ]`  | *Contingency* | *(Buffer: Prioritize BF-047 first surface render)*                                         | team         | buffer                       | ---           | **1 d**  |                                                                                                                                                                                     |

*(Total planned ≈ 9.85 d + 1 d contingency → fits 10 day budget)*

---

## 🛠 Key technical changes

*(Same as previous version: Shared crosshair UBO, Layer property UBO patch, GPU composite order, Surface mesh path)*

---

## 🚩 Risks & mitigations

*(Updated based on feedback)*

| Risk                                                 | Mitigation                                                                                             |
| :--------------------------------------------------- | :----------------------------------------------------------------------------------------------------- |
| WGPU texture format/validation errors on CI runners | BF-051 attempts enabling early; Keep R32F fallback; Address warnings.                                |
| KD-tree build time > 1s                             | BF-045 uses `rayon`; build happens once on load.                                                     |
| UI prop drilling for layer/crosshair settings      | Central stores (`layerStore`, `uiSlice`/`crosshairStore`) avoid this.                                |
| Mutex → async deadlocks                              | BF-053a/b refactor + `cargo deny check bans` for `await-holding-lock`.                               |
| Complex shader logic bugs (BF-043a/b)                | Split implementation (v0/v1); Focus on v0 first.                                                     |
| Three.js / WebGL integration issues (BF-047)         | Note Windows renderer settings; Allocate contingency time; Early spike if needed.                       |
| CI GPU runner provisioning fails (BF-051)            | Defined fallback (skip GPU tests/benchmarks on CI, require manual runs).                            |

---

## 📈 Success metrics

*   **UX latency:** Crosshair update latency < 16 ms (visual check + browser perf tools).
*   **FPS:** Rotate `fsaverage` surface ≥ 60 fps (target hardware).
*   **E2E pass-rate:** BF-050 test green on all 3 OS in CI.
*   **Perf regression:** BF-022 benchmark meets platform-specific gates (>2 GB/s discrete, >1 GB/s unified).

---
