# GPU-Resident Image-Set Stack (+ Cross-Set Trace, GPU Batch Present)

Status: in progress (2026-07-03)
Tracks beads: `bd-01KWKXYT` (p1 flagship), `bd-01KWKXZB` (p2 feature), `bd-01KWKXZX` (p2 perf).
Local task ids: #6 (flagship), #7 (trace), #8 (batch).

## Thesis

The "4th axis" of a stack is a generic **set-member index** — a timepoint, a subject,
a contrast/beta estimate, or a condition. Today a member change costs a full CPU slab
copy + a fresh GPU texture allocation + a full `write_texture`, with **no caching** of
previously-seen members (stepping back repeats the whole cost). The flagship turns a
member change into a **`texture_index` swap** against a **bounded, VRAM-budgeted resident
ring** of already-uploaded 3D textures, with **prefetch** of neighbours. Everything is
designed against an abstract `ImageSet`; raw-4D is just one adapter. The trace feature
reads member values out of the resident ring; the perf feature makes multi-slice present
a real GPU-side batch. Sequencing: flagship first (both p2 items depend on it).

## Verified current architecture (evidence)

Resident textures & the swap lever
- `MultiTextureManager` (`core/render_loop/src/multi_texture_manager.rs:29`) holds up to
  `MAX_TEXTURES = 13` independent 3D textures (`upload_volume` :158 allocates/reuses a slot;
  `update_volume` :700 rewrites a slot in place; `release_volume` :822 frees a slot). All 13
  are bound at bind group 2 every frame; the masked WGSL selects with a `switch(texture_index)`.
- `LayerUboStd140.texture_index` (`core/render_loop/src/ubo.rs:136`, offset 104) is the per-layer
  selector. `LayerStorageManager::update_layer` (`core/render_loop/src/layer_storage.rs:389`) does a
  targeted `queue.write_buffer` of one 176-byte record. **No service method mutates `texture_index`
  in place today** — `RenderLoopService::update_layer` (`lib.rs:3296`) only touches opacity/colormap.
- No VRAM/byte budget on the active path. `SmartTextureManager`
  (`core/render_loop/src/smart_texture_manager.rs:59`) is the byte-accounting reference
  (`calculate_memory_size` :117, `memory_limit`, pooling) but is off the active path.

The member-change hot path (what we replace)
- `set_volume_timepoint` (`core/api_bridge/src/lib.rs:3351`) only mutates registry metadata; it does
  no GPU work. The render-authoritative member is `FrontendViewState.timepoint`.
- `prepare_frontend_layers_for_render` (`lib.rs:8748`) computes
  `requires_reupload = requires_timepoint && (cached_timepoint != requested || cached.is_none())`
  (`lib.rs:8810`). On a change it calls `invalidate_cached_layer_for_render` (`lib.rs:8508`) then
  `allocate_gpu_resources_for_layer` (`lib.rs:8159`), which runs
  `extract_3d_volume_at_timepoint` (`lib.rs:762` → neuroim `data.slice(...).to_owned()`, full copy)
  → `upload_volume_3d` (`render_loop/src/lib.rs:1509`), allocating a fresh slot each time.
- Per-layer maps on `BridgeState`: `layer_to_atlas_map: HashMap<String,u32>` (`lib.rs:1371`),
  `layer_to_volume_map` (`:1373`), `layer_to_timepoint_map: HashMap<String,Option<usize>>` (`:1375`),
  `layer_leases` (`:1377`). `VolumeLayerGpuInfo.atlas_layer_index` (`bridge_types/src/lib.rs:272`) ==
  the `MultiTextureManager` texture index.
- Gotcha: `LayerLease`/watchdog free the `TextureAtlas` bookkeeping shim, never `release_volume`, so
  the ring must reclaim real `MultiTextureManager` slots explicitly. `get_atlas_stats` 3D metrics
  collapse to 0/1 and do NOT reflect the 13-slot occupancy.

Batch present (perf target)
- `batch_render_slices` (`core/api_bridge/src/lib.rs:9784`, loop :9929) is "batch" only in the IPC
  envelope: N renders, 2N submits, N blocking `device.poll(Wait)` stalls, N fresh render-texture
  allocations, N mutex re-acquires; the per-slice `create_offscreen_target` is dead weight. Readback
  Y-flip is isolated in `unpack_gpu_buffer_to_image` (`render_loop/src/lib.rs:3742`).
- The readback→ImageBitmap tax: `createImageBitmap(ImageData)` at
  `ui2/src/services/MosaicRenderService.ts:367`; present-type choke points
  `renderStateStore.ts:42`, `useRenderCanvas.ts:46`. Flags: `mosaicBatchRender`, `multiViewBatch`
  (both default false), `renderFlags.useRawRGBA`.

Trace (feature target)
- Cross-set primitive already exists: `sample_set_at_world` → `Vec<MemberSample>`
  (`core/api_bridge/src/lib.rs:12428`; `SetMemberRef`/`MemberSample` at :12243/:12254). It loads member
  volumes CPU-side per call (no GPU-resident buffer yet).
- Grammar-of-graphics plot subsystem: `ui2/src/plotting/` + `ui2/src/components/plots/` on `@visx`.
  `Locus` already has a `set` case (`ui2/src/plotting/types.ts:85`); `Mark` union already lists
  `line|area|heatmap` (:136). `SampleProvider` (`ui2/src/services/SampleProvider.ts`) is the single
  sampling seam. `compute_region_stats` + `reduce_values` (`lib.rs:12081`/:11791) is the ROI-averaging
  engine. Set ontology + member labels: `SpatialFieldSetSummary.designColumns` +
  per-member `StudioDiscoveryDesignValue{column,value}` (`bridge_types/src/lib.rs:1260`/:1052).
- No carpet/grayplot component and no CI/error-band backend exist yet.

## Design

### Abstraction: `ImageSet` (api_bridge)

```rust
/// A bounded, ordered set of co-registered 3D members addressed by a generic index.
trait ImageSet {
    fn len(&self) -> usize;
    fn spatial_dims(&self) -> [usize; 3];
    fn dtype(&self) -> NumericType;            // members share dtype+grid
    fn member_label(&self, i: usize) -> ImageSetMemberLabel; // ontology-aware
    fn materialize(&self, i: usize) -> BridgeResult<VolumeSendable>; // 3D Vol* for member i
    fn byte_size_per_member(&self) -> u64;     // for the VRAM budget
}
```

Adapters:
- `Raw4DImageSet` — wraps a 4D `VolumeSendable` (the registry entry). `materialize(i)` delegates to
  the existing `extract_3d_volume_at_timepoint`; `member_label(i)` = timepoint index (+ TR-derived
  time when known). This is the only adapter needed to light up the flagship end-to-end.
- (Later, feature-driven) `SetStudioImageSet` — members are the paths in a `SpatialFieldSetSummary`;
  `member_label(i)` pulls `designColumns`/`designValues`. Powers the cross-set trace headline case.

### Resident ring (render_loop primitives + api_bridge policy)

render_loop primitives (low risk, unit-testable, additive):
1. Byte accounting on `MultiTextureManager`: track per-slot bytes (dims × bytes/format) and expose
   `resident_bytes()` / `slot_bytes(index)`; reuse `SmartTextureManager::calculate_memory_size` logic.
2. `RenderLoopService::set_layer_texture_index(layer_index, new_texture_index)` — the uniform swap:
   mutate `LayerInfo.atlas_index` in the layer-state manager and call
   `LayerStorageManager::update_layer` so only offset-104 changes. No bind-group rebuild (target must
   already be resident, which the ring guarantees).

api_bridge policy — `ResidentImageSet` (one per resident layer, owned in `BridgeState`):
- Owns a ring of ≤K GPU texture slots (K bounded by both a slot cap and a VRAM byte budget).
- `member_to_slot: HashMap<usize, u32>` + LRU recency; `budget_bytes`, `bytes_per_member`.
- `ensure_resident(member) -> texture_index`: hit → touch LRU, return slot; miss → pick a victim
  (LRU, never the currently-shown member) or a free slot, `materialize(member)` →
  `upload_volume`/`update_volume` into that slot, return it.
- `prefetch(center)`: admit `center±radius` up to budget, oldest-evicted first. Runs off the render
  reactor (spawn_blocking) so it never stalls a frame.

### Wiring the hot path

In `prepare_frontend_layers_for_render`, the `requires_reupload` branch now tries the ring first
(`try_resident_swap`): if a `ResidentImageSet` exists (or can be built for a 4-D volume),
`ring.ensure_resident(requested)` returns the resident slot, and the swap is applied by repointing
the volume→slot binding the ViewState renderer resolves, then prefetching neighbours; otherwise it
falls back to the legacy invalidate + reallocate path unchanged.

**Important mechanism note (verified during implementation):** the ViewState render resolves a
layer's texture from `RenderLoopService::volumes[volume_id].atlas_index`
(`render_loop/src/lib.rs:5085`), rebuilding `LayerInfo`s each frame — it does **not** read a
persistent per-layer `texture_index`. So the operative member swap is
`register_volume_with_range(volume_id, resident_slot, range)` (a metadata repoint, no upload), not
`set_layer_texture_index`. The latter is still added as a correct, tested lower-level primitive for
the direct `render()` path, but the bridge/ViewState path swaps via the volume→slot binding.

Guarded by an env kill-switch (`BRAINFLOW_RESIDENT_IMAGE_SET=0` forces the legacy path); enabled by
default. Constants: `RESIDENT_RING_MAX_SLOTS=6`, `RESIDENT_RING_BUDGET_BYTES=512 MiB`,
`RESIDENT_RING_PREFETCH_RADIUS=2` (all in `api_bridge/src/lib.rs`). Ring slots are reclaimed on layer
teardown via `release_resident_image_set` (hooked into `invalidate_cached_layer_for_render` and the
layer-release path).

## Phases

- [x] **P1 — render_loop primitives.** Byte accounting on `MultiTextureManager`
  (`resident_bytes`/`slot_bytes`/`free_slot_count`/`resident_indices` + `format_bytes_per_pixel`);
  `set_layer_texture_index` swap and `update_volume_3d_at` (in-place slot overwrite) on
  `RenderLoopService`; `LayerStateManager::set_layer_atlas_index`. Tests: swap changes only the
  slot / guards non-resident + unreferenced; byte accounting tracks admit/evict/reuse. Green:
  `cargo test -p render_loop` (34 tests).
- [x] **P2 — ImageSet + ResidentImageSet ring (api_bridge).** New `image_set` module: `ImageSet`
  trait + `Raw4DImageSet` adapter; pure `ResidentRing` policy (LRU + byte budget) behind a
  `RingExecutor` seam; `RenderServiceExecutor` (dtype-dispatched upload/in-place update);
  `ResidentImageSet` holder + `snapshot()` telemetry. 6 GPU-free ring tests
  (capacity/hit/step-back/eviction/protection/prefetch).
- [x] **P3 — wire the hot path.** `try_resident_swap` fast-path in `prepare_frontend_layers_for_render`
  (env-gated, legacy fallback); `resident_image_sets` registry on `BridgeState`;
  `release_resident_image_set` teardown on invalidate + layer release. Integration test
  `resident_image_set_keeps_members_resident_across_member_changes` asserts members stay resident
  across changes and stepping back is a hit. Green: `cargo test -p api-bridge` (99 lib + integration),
  clippy clean, existing `render_view_reuploads_4d_layer_when_timepoint_changes` still passes.
- [~] **P4 — perf: real GPU batch + zero-copy present** (`bd-01KWKXZX`).
  - [x] **Backend batched readback (landed, verified headless).** `RenderLoopService::read_views_to_images`
    packs all N view targets into one staging buffer with a single encoder / `queue.submit` / `poll(Wait)`,
    collapsing the old **2N submits + N blocking `device.poll(Wait)` syncs** into **N render submits + 1
    readback submit + 1 sync**. `batch_render_slices` now locks the render service once for the whole batch,
    renders every slice via `request_frame_with_options(FrameReadbackMode::Skip)` (the exact proven per-view
    path — no rendering behaviour change), then does the single batched readback. The former per-slice
    `create_offscreen_target` was dead weight (the ViewState path renders into per-view targets via
    `ensure_view`) and is dropped. Env kill-switch `BRAINFLOW_BATCH_READBACK=0` forces the legacy
    per-slice render+readback path. **Output envelope is unchanged** (`[width][height][slice_count]` header
    + RGBA slabs); the existing frontend `decodeBatchRenderBuffer` consumes it with zero changes, so the
    perf win is realized end-to-end today. Gate: `batch_readback_test.rs` asserts each batched slice is
    **byte-identical** to the sequential blocking readback (stronger than the golden harness for the batch
    specifically), plus a distinct-slices guard against a region-offset bug. Green: `cargo test -p render_loop`
    (201 tests incl. render-golden regression), `cargo test -p api-bridge` (99+), clippy clean.
  - [ ] **Frontend zero-copy present (deferred — visual-only, unverifiable headless).** Optional micro-opt:
    skip `createImageBitmap(ImageData)` at `MosaicRenderService.ts:367` and present the decoded `ImageData`
    directly via an offscreen `putImageData` + scaled `drawImage` (the `TemporalHeatmapOverlay` idiom) behind
    a new default-off flag. Intentionally NOT landed blind: it rewrites the documented-brittle `ImageBitmap`
    lifecycle path (`renderStateStore.lastImage` / `useRenderCanvas`), the repo's own UI2 CLAUDE.md warns
    against redesigning that path, and its value is marginal on top of the already-realized backend win.
    Land it with `cargo tauri dev` running for visual verification (Y-flip / color / aspect-scaling parity).
- [~] **P5 — feature: cross-set trace** (`bd-01KWKXZB`).
  - [x] **Backend trace + CI engine (landed, verified headless).** `sample_set_trace_at_world` command
    (registered in `command_list.rs`, granted `allow-sample-set-trace-at-world`, TS binding regenerated):
    one ROI-reduced value per cohort member at a world locus **plus a dispersion band** (`{ memberId, value,
    lower, upper, count }`). `gather_member_roi_values` factors the ROI voxel gather out of
    `sample_member_volume` (behaviour-preserving); `roi_spread_band` computes the band — `sem95` (95% CI of
    the mean, default), `sd`, `ci95`/`iqr` (type-7 sample quantiles via `quantile_type7`), or `none`. A
    failed/out-of-bounds member yields a `NaN` trace point with `count = 0` (never aborts the cohort).
    `SetStudioImageSet` adapter implements `ImageSet` over already-loaded cohort members with ontology
    labels (`member_label` display + `design_values`) built from a `SpatialFieldSetSummary`'s design-table
    preview (`design_values_from_summary`/`design_values_from_table_preview`), and trace requests can carry
    optional `displayLabel` + `designValues` through to the returned `MemberTrace`. Tests: `quantile_type7`,
    `roi_spread_band` variants, full trace path (mean + sem95 band over a known 7-voxel ROI), NaN-tolerance,
    bad-world-len, label round-trip, plus the adapter/label mapping — 14 new tests. Green: `cargo test -p api-bridge` (108 lib
    + integration, incl. `command_list` ↔ `COMMANDS` sync), `pnpm check:permissions:strict` (103 commands),
    clippy clean.
  - [x] **Frontend data seam (landed, verified headless).** `SampleRequest.band?: TraceBand` routes a `set`
    locus through `sample_set_trace_at_world`; `SampleProvider.sampleSet` emits a trace frame
    (`member, value, lower, upper, count` columns + `suggested: { mark: 'line', band: {lower, upper} }`)
    when a band is requested, adding `memberLabel` and one nominal column per ontology design axis when
    labels are present; the plain `(member, value)` frame otherwise stays backward compatible. 5 new
    vitest cases (trace shape, band forwarding, ontology-label columns, NaN passthrough, plain-path guard).
    Green: `pnpm --filter temp-ui exec vitest run src/services/__tests__/SampleProvider.test.ts` (14),
    clean `tsc`.
  - [ ] **Visual plot mode (deferred — unverifiable headless).** Render the line + shaded `area` CI band and
    the carpet/grayplot `heatmap` mark (both already in the `Mark` union), a new plot mode reusing
    `plotSpecStore`/`plotModeStore`, and an ontology-labelled member axis. Land with `cargo tauri dev`
    running for visual verification. The data half (frame + band + ontology labels) is done above, so this
    is @visx rendering + mode wiring only.

## Test & verify gates

- `cargo test -p render_loop` (incl. `shader_contract_test` — only relevant if the 13-slot cap moves; it
  does not in this plan) and `cargo test -p api-bridge` (incl. the `command_list` ↔ `COMMANDS` sync test).
- `cargo clippy --workspace --all-targets`, `cargo fmt --all`.
- If any Tauri command or `#[ts(export)]` type is added: `cargo xtask ts-bindings`,
  `pnpm --filter @brainflow/api build`, `pnpm check:permissions:strict`.
- Render-golden harness unaffected (member swap is bit-identical to a re-upload of the same member);
  run `cargo test -p render_loop --test render_golden_test` after P3 as a regression check.
