<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-10 -->

# api_bridge

## Purpose
Tauri plugin providing command bridge between TypeScript frontend and Rust backend. Implements all IPC commands for volume loading, rendering, surface geometry, atlas/template access, and file operations. Includes permission system, TypeScript binding generation, and comprehensive error handling with user-friendly error contexts.

## Key Files
| File | Description |
|------|-------------|
| `src/lib.rs` | Main plugin module with all Tauri command implementations (4000+ lines) |
| `src/set_sample_cache.rs` | Bounded CPU population-source cache, private decoded snapshots and source digests |
| `src/render_lifecycle.rs` | Serialized initialization and atomic publication of a fully ready shared renderer |
| `src/render_bridge_adapter.rs` | Brainflow-to-renderer adapter helpers for frontend view-state conversion and render response packet encoding |
| `src/error_context.rs` | User-friendly error message generation and context enrichment |
| `src/error_helpers.rs` | Error conversion utilities and helper functions |
| `src/user_errors.rs` | User-facing error types with actionable messages |
| `src/analysis.rs` | Volume analysis and statistical computation commands |
| `src/bin/export_types.rs` | Binary for generating TypeScript type bindings |
| `build.rs` | Build script for Tauri plugin setup and command registration |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `permissions/` | Tauri permission definitions (default.toml, schemas) |
| `docs/` | Documentation including ADDING_COMMANDS.md guide |
| `bindings/` | Generated TypeScript type definitions |
| `tests/` | Integration tests for pipeline and command validation |

## For AI Agents

### Working In This Directory
The command inventory is single-sourced in `src/command_list.rs`. Define the `#[command]` function, list its bare name there, grant `allow-*` in `permissions/default.toml` or a window capability, then regenerate with `cargo xtask ts-bindings` (or `cargo run -p xtask -- ts-bindings` when the alias is unavailable). Rebuild `packages/api` for frontend transport discovery and run `node tools/check_api_bridge_permissions.mjs --strict` from the repository root. See `ADDING_COMMANDS.md`; do not hand-maintain transport or handler lists. Commands return `BridgeResult<T>`; Tauri translates JS camelCase arguments to Rust snake_case.

### Testing Requirements
Run `cargo test -p api-bridge` for unit tests. Integration tests in `tests/pipeline_integration_test.rs` validate end-to-end workflows. Test both success and error paths. Verify TypeScript bindings with `cargo run --bin export_api_bridge_types` and check `bindings/` output matches frontend expectations.

### Common Patterns
- `population_slice.rs` evaluates the native voxels required by a visible plane, using the shared `FieldMoments` kernel and nearest display sampling. Its one-plane observation cache is capped at 128 MiB of sample/geometry payload and serialized by an admission permit. It does not register full derived volumes or member GPU textures. Selection/focus/summary changes reuse observations; geometry/context/source changes rebuild. `evaluate_population_slice` accepts the existing cancellation tickets; `release_population_slice(contextKey)` releases only the matching mounted-view cache. Source stamps are checked before and after evaluation. Explicit 4D frames and matching orthogonal native grids are required; sheared grids are refused pending a resampling adapter. Decoded source cache, scratch and IPC buffers have separate ownership and accounting.
- `src/population_sampling.rs` owns a bounded registry (8192 tickets, at most two-minute lifetime) for optional sampling tickets. `cancel_population_sample` retains cancellation-before-start tombstones until expiry; duplicate or expired tickets cannot run again. Scalar/trace sampling checks cancellation between members and source copy chunks, while waiting for cache admission, and before/after decode and sampling. Decoder calls are not forcibly interrupted; the blocking worker retains its permit until it exits. Ordinary clients without a ticket retain the existing call shape.
- Population sampling uses `SetSampleCache::with_volume`: canonical file identity is revalidated on a cache hit; a miss hashes and decodes the same private single-file NIfTI snapshot. Cache ownership belongs to `BridgeState`, with explicit `clear` and drop cleanup. `BRAINFLOW_SET_SAMPLE_CACHE_BYTES` defaults to 512 MiB of decoded payload; 0 disables retention. One admitted blocking worker owns snapshot/decode/sample work even if its async caller is canceled. Decoder scratch and returned samples are outside resident-byte accounting. Dataset-scoped cache reclamation remains separate work; panel/query cancellation now reaches this worker boundary.
- Set sampling requires unique observation IDs, valid probe/reducer parameters and an explicit `stackIndex` for multi-frame sources. `expectedSha256` rejects a changed frozen source. Responses carry source digest/byte count, valid count and error reason; frame indices do not establish physical time. Filesystem stamps are the warm freshness shortcut (Unix includes inode/change time); they are not a guarantee against changes invisible to filesystem metadata. The whole-query guard captures resolved source stamps before sampling and revalidates before publication, including unavailable-to-available transitions. Immutable saved-query source retention remains separate from this optimistic consistency check.
- Commands use `State<Arc<Mutex<T>>>` for shared state access
- Error handling: wrap errors with context using `map_err(|e| BridgeError::custom(...))`
- Volume handles: use `VolumeHandleInfo` for tracking loaded volumes
- Startup ownership: plugin setup registers the canonical `BridgeState` using the app cache directory (or preserves a caller-provided state) and starts its watchdog. Both frontend init and desktop warmup call `ensure_render_loop`; failed device/shader setup leaves the slot empty for retry.
- GPU operations: keep Brainflow-specific registry lookup, layer leases, Tauri command contracts, event emission, and error mapping in this crate; pure frontend view-state conversion and raw/PNG packet encoding live in `render_bridge_adapter.rs`; renderer internals stay in `render_loop`
- File loading: use `LoaderRegistry` pattern for extensible format support

## Dependencies

### Internal
- `bridge_types` - Shared types and traits (BridgeError, VolumeSendable, Loader)
- `render_loop` - WebGPU rendering service
- `volmath` - Volume mathematics and spatial utilities
- `nifti_loader`, `gifti_loader` - File format loaders
- `colormap` - Color mapping system
- `atlases`, `templates` - Brain atlas and template services
- `neuro-types` - Core neuroimaging types (ViewRectMm, SliceSpec)

### External
- `tauri` (workspace) - Framework for IPC commands
- `wgpu` (workspace) - WebGPU types for rendering
- `serde`, `serde_json` - Serialization
- `ts-rs` (workspace) - TypeScript binding generation
- `anyhow`, `thiserror` - Error handling
- `uuid` - Unique ID generation
- `tokio` - Async runtime and synchronization

<!-- MANUAL: -->
