<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-10 -->

# api_bridge

## Purpose
Tauri plugin providing command bridge between TypeScript frontend and Rust backend. Implements all IPC commands for volume loading, rendering, surface geometry, atlas/template access, and file operations. Includes permission system, TypeScript binding generation, and comprehensive error handling with user-friendly error contexts.

## Key Files
| File | Description |
|------|-------------|
| `src/lib.rs` | Main plugin module with all Tauri command implementations (4000+ lines) |
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
This is the central IPC bridge. When adding new commands, you MUST update FOUR places: (1) define command function with `#[command]` attribute, (2) add to COMMANDS array in `build.rs`, (3) add to `generate_handler!` macro in `lib.rs`, (4) add to `apiBridgeCommands` in `/ui2/src/services/transport.ts`. See `docs/ADDING_COMMANDS.md` for detailed steps. Use camelCase in TypeScript, snake_case in Rust - Tauri auto-converts. All commands should return `BridgeResult<T>` for consistent error handling.

### Testing Requirements
Run `cargo test -p api-bridge` for unit tests. Integration tests in `tests/pipeline_integration_test.rs` validate end-to-end workflows. Test both success and error paths. Verify TypeScript bindings with `cargo run --bin export_api_bridge_types` and check `bindings/` output matches frontend expectations.

### Common Patterns
- Commands use `State<Arc<Mutex<T>>>` for shared state access
- Error handling: wrap errors with context using `map_err(|e| BridgeError::custom(...))`
- Volume handles: use `VolumeHandleInfo` for tracking loaded volumes
- GPU operations: delegate to `RenderLoopService` for all rendering
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
