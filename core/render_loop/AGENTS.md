<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-10 -->

# render_loop

## Purpose
High-performance WebGPU rendering service for neuroimaging visualization. Implements offscreen GPU rendering with multi-layer volume compositing, world-space slice extraction, and real-time interactivity. THE most complex crate in the project with 21 source files, 50+ tests, runtime WGSL shader loading, and comprehensive texture/pipeline management. Handles up to 13 simultaneous 3D volume textures (`MAX_TEXTURES` in `multi_texture_manager.rs`) with various blend modes.

## Key Files
| File | Description |
|------|-------------|
| `src/lib.rs` | RenderLoopService orchestrator - GPU device, queue, pipeline management |
| `src/facade.rs` | Reusable `WgpuSliceRenderer` facade with neutral config/lifecycle API over the runtime WGPU path |
| `src/pipeline.rs` | PipelineManager for render pipeline creation and caching |
| `src/shaders.rs` | ShaderManager for runtime WGSL loading and validation |
| `src/multi_texture_manager.rs` | 3D texture management for world-space rendering |
| `src/smart_texture_manager.rs` | Automatic format selection and memory optimization |
| `src/texture_manager.rs` | 2D texture atlas (legacy approach) |
| `src/layer_storage.rs` | LayerStorageManager using storage buffers for dynamic layer count |
| `src/layer_uniforms.rs` | LayerUniformManager traditional uniform buffer approach |
| `src/layer_uniforms_optimized.rs` | Optimized layer uniforms implementation |
| `src/ubo.rs` | std140-compliant uniform buffer structures |
| `src/render_state.rs` | RenderState tracking current configuration |
| `src/view_state.rs` | WGPU view resources plus compatibility re-exports for `render_contracts` view-state types |
| `src/optimized_renderer.rs` | Optimized rendering path |
| `src/slice_variant.rs` | Slice orientation variants |
| `src/slice_adapter.rs` | Adapter between neuro-types and render_loop |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `shaders/` | WGSL shader source files (slice_world_space_optimized.wgsl, etc.) |
| `tests/` | 50+ integration tests for rendering, coordinates, performance |
| `src/bin/` | Test binaries (test_render.rs, test_nifti_e2e.rs, test_mni_slices.rs) |

## For AI Agents

### Working In This Directory
This is the RENDERING CORE - extreme care required. Shaders are runtime-loaded WGSL (not build-time compiled by default). Y-flip happens ONLY at buffer readback boundary in render_to_buffer() - GPU uses OpenGL convention (Y=0 bottom), CPU uses image convention (Y=0 top). World-space rendering via slice_world_space_optimized.wgsl shader. Storage buffers enable dynamic layer count. Multi-texture approach supports 15+ volumes. Test extensively - run ALL tests in tests/ directory after changes. See core/CLAUDE.md for architecture details.

### Testing Requirements
Run `cargo test -p render_loop` (50+ tests). Critical tests: world_space_rendering_test, coordinate_inversion_test, multi_volume_overlay_test. Visual outputs in test_output/ for manual inspection. Benchmarks with `cargo bench -p render_loop_benches`. Verify CPU/GPU parity with neuro-integration-tests. Tests require headless GPU (uses offscreen rendering). Use pollster for async operations in sync tests.

### Common Patterns
- `WgpuSliceRenderer` is the reusable facade for external apps; keep new public lifecycle features there before exposing raw `RenderLoopService` internals
- Runtime masked WGSL defaults to 13 volume slots; smaller facade requests retain that desktop layout. `RendererCapacityPolicy::FitAdapter` opts into 1–13 slots resolved against the adapter and optional sampled-texture ceiling. Shared WGSL composition, layout builders and texture manager must use the same resolved capacity. Requests above 13 are rejected; smart texture management requires the fixed desktop layout. Gate: `adaptive_capacity_test` plus `shader_contract_test`.
- Offscreen rendering (avoids Tauri window handle complexity)
- Storage buffers for dynamic layer count
- 3D texture arrays for direct volume sampling
- World-space to voxel-space transforms per layer
- Frame UBO + Layer storage buffer bind groups
- Y-flip isolated to buffer readback only
- Shader hot-reload in development (shader_watcher)
- Pipeline caching to avoid recreation

## Dependencies

### Internal
- `volmath` - Volume mathematics and DenseVolume3
- `colormap` - Color mapping for visualization
- `neuro-types` - Canonical slice extraction types (SliceSpec, ViewRectMm)
- `render_contracts` - Transport-neutral view, layer, frame request/result, and diagnostics contracts

### External
- `wgpu` (workspace `=0.20.1`) - WebGPU API (inherited from workspace)
- `nalgebra` (workspace) - Matrix operations and transforms
- `bytemuck` - Zero-copy UBO struct casting with derive
- `thiserror`, `anyhow` (workspace) - Error handling
- `pollster` - Async buffer mapping in sync context
- `futures-intrusive` - Async channel for map_async callbacks
- `half` - R16Float texture format support
- `image` - Saving rendered images (dev/test)
- `tokio` - Async runtime (macros, rt-multi-thread)
- `flume` - Async channel communication
- `log` - Logging
- `encase` - Optional typed shader bindings (typed-shaders feature)

<!-- MANUAL: This is the most complex crate - consult core/CLAUDE.md for architecture details before major changes. -->

## Display upload and view ownership

- `upload_volume_3d_with_format` honors explicit storage requests; default uploads
  preserve physical scalar units, including native U8. R16Float is used only if
  it retains finite nonzero values; otherwise use R32Float. Label-aware uploads
  also require exact categorical IDs and reject IDs that R32Float cannot preserve.
  Explicit R8Unorm is range-normalized display storage with windows in `[0, 1]`.
- Upload and in-place update share encoding and tightly packed `Queue::write_texture`.
  Keep 256-byte row alignment for encoder buffer copies/readback, not queue writes.
- Both active masked shaders include `fullscreen_vertex.wgsl` through
  `shaders::compose_shader_source`; reflection must validate the composed source.
  `ThresholdMode::Inside = 4` retains inclusive ranges for the reusable slice
  adapter; `Range = 0` retains its existing hide-inside semantics.
- Slice sampling uses the voxel-centre domain `[-0.5, dim-0.5)` (texture coordinate
  `(v+0.5)/dim`), shared with `neuro-cpu` and the bridge picker; see
  `docs/COORDINATE_SYSTEM_SPEC.md`. `neuro-integration-tests/tests/edge_domain_agreement_test.rs`
  checks GPU/CPU edge coverage.
- Label outlines (`SliceFeatureUbo`, 64 bytes): `outline_color_mode` 1 draws each
  region in its LUT colour (alpha = outline alpha x LUT alpha); `halo_thickness_px`
  adds a `halo_color` band outside a selected region, or a second inner band in
  all-boundaries mode. Screen-pixel widths use the frame UBO `target_dim`, which
  declarative frames set to the view size. Gate: `slice_outline_render_test`.
- Declarative rendering owns targets through `ensure_view`; do not also allocate
  a legacy offscreen target. Facade consumers release closed views with
  `release_view`/`clear_views`; final volume teardown also clears cached views.
- Regression gate: `cargo test -p render_loop --test display_upload_regression_test`
  plus the shader-contract, render-golden, batched-readback, and resource-lifecycle
  tests. The focused regression requires an actual GPU and never soft-skips.

- Automatic resident slots can promote from R16F to R32F on member replacement;
  promotion keeps the slot ID, replaces its binding, and refreshes registry
  metadata. R32 slots stay R32 to avoid churn. Explicit-format slots reject
  unsafe replacements. `get_volume_texture_format` reports actual storage.

## Owned readback

- `submit_frame_with_options`, `submit_views_readback` and the legacy
  `render_to_buffer` path return owners (`FrameSubmission`/`PendingReadback`) that
  complete without borrowing the service, so hosts can release the renderer lock
  before awaiting. A dedicated `brainflow-readback` thread polls the device; no
  executor thread blocks in `poll(Wait)`.
- Each view carries a `ViewEpoch`. A newer submission, resize, `release_view` or
  service teardown makes older completions fail with code 8010. Hosts that reuse
  cache-target IDs for independent requests call `into_snapshot()` and validate
  their own request identity instead.
- Staging is bounded (16 buffers, `max_buffer_size` bytes; code 8013). A dropped
  owner leaves the buffer with the mapping callback until mapping completes;
  `ReadbackMonitor` exposes outstanding buffers/bytes for tests.
- The Y-flip remains in `unpack_gpu_buffer_to_image` at readback. Gate:
  `cargo test -p render_loop --test async_readback_test --test batch_readback_test`
  plus `cargo test -p render_loop --lib readback` (all require a GPU).
