<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-10 -->

# render_loop

## Purpose
High-performance WebGPU rendering service for neuroimaging visualization. Implements offscreen GPU rendering with multi-layer volume compositing, world-space slice extraction, and real-time interactivity. THE most complex crate in the project with 21 source files, 50+ tests, runtime WGSL shader loading, and comprehensive texture/pipeline management. Handles up to 15 simultaneous 3D volume textures with various blend modes.

## Key Files
| File | Description |
|------|-------------|
| `src/lib.rs` | RenderLoopService orchestrator - GPU device, queue, pipeline management |
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
| `src/view_state.rs` | Per-view state management for multi-view rendering |
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

### External
- `wgpu` (workspace 0.25.0) - WebGPU API (inherited from workspace)
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
