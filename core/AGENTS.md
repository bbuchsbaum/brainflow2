<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-10 -->

# Core Rust Backend

## Purpose
The core directory contains the Rust backend workspace for Brainflow, implementing all performance-critical neuroimaging operations including file loading, volume mathematics, GPU rendering, and the Tauri API bridge. This workspace follows a modular architecture where each crate has a focused responsibility, enabling independent testing and reuse across the application.

## Key Files
| File | Description |
|------|-------------|
| `CLAUDE.md` | Core-specific documentation for brain template management and rendering architecture |
| `DIFFERENTIAL_TESTING_DESIGN.md` | Design document for CPU vs GPU rendering validation testing |
| `../Cargo.toml` | Workspace manifest defining all core crates and shared dependencies (pinned versions for stability) |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `api_bridge/` | Tauri command implementations, permission system, and frontend-backend bridge (see `api_bridge/AGENTS.md`) |
| `atlases/` | Brain atlas support and atlas-based region queries |
| `bridge_types/` | Shared Rust types with TypeScript bindings generation via ts-rs |
| `colormap/` | Color mapping functionality for volume and surface visualization |
| `filesystem/` | File system operations, BIDS dataset scanning, and path management |
| `loaders/` | File format loaders: `nifti/` (NIfTI volumes), `gifti/` (GIfTI surfaces) |
| `neuro-core/` | Core neuroimaging utilities and shared logic |
| `neuro-cpu/` | CPU-based volume rendering fallback for systems without WebGPU |
| `neuro-integration-tests/` | Cross-component integration tests validating CPU/GPU consistency |
| `neuro-types/` | Core neuroimaging types (slice specs, view rects, coordinate systems) |
| `render_loop/` | WebGPU rendering service with runtime-loaded WGSL shaders |
| `render_loop_benches/` | Performance benchmarks for texture upload and rendering operations |
| `templates/` | Template service for standard brain spaces (MNI152, fsaverage, etc.) |
| `volmath/` | Volume mathematics, spatial transformations, and coordinate utilities |

## For AI Agents

### Working In This Directory
When working in the core Rust workspace:
1. **Run tests across all crates**: `cargo test --workspace` from project root
2. **Build specific crate**: `cargo build -p <crate_name>` (e.g., `cargo build -p render_loop`)
3. **Check compilation**: `cargo check --workspace` for fast feedback
4. **Format code**: `cargo fmt --all` before committing
5. **Lint**: `cargo clippy --workspace --all-targets` to catch common issues
6. **Update TypeScript bindings**: Run `cargo xtask ts-bindings` after changing types in `bridge_types/`

### Testing Requirements
- All new functionality must have unit tests in the respective crate
- Integration tests go in `neuro-integration-tests/`
- CPU vs GPU rendering parity tests validate consistency (see `DIFFERENTIAL_TESTING_DESIGN.md`)
- Run benchmarks with `cargo bench -p render_loop_benches` when changing performance-critical code
- Test data located in `/test-data/` at project root

### Common Patterns
- **Error handling**: Use `anyhow::Result` for application errors, `thiserror` for library errors
- **Async operations**: Use `tokio` runtime (pinned version for stability)
- **Type exports**: Add `#[derive(Serialize, Deserialize, TS)]` to types that cross the Rust-TypeScript boundary
- **GPU dependencies**: WGPU stack pinned to 0.20.x for stability (see workspace dependencies)
- **Coordinate systems**: World space uses LPI (Left-Posterior-Inferior) convention
- **Y-axis handling**: GPU (Y=0 bottom) vs CPU (Y=0 top) flip happens at buffer readback boundary only

## Dependencies

### Internal
All crates within this workspace depend on shared workspace dependencies defined in `../Cargo.toml`:
- `bridge_types` - Used by most crates for shared types
- `neuro-types` - Core neuroimaging types used throughout
- `volmath` - Spatial math operations
- External path dependencies: `neuroatlas`, `neurosurf-rs`, `gifti` (local development paths)

### External
Key external dependencies (all pinned for reproducible builds):
- `wgpu` 0.20.1 - WebGPU implementation
- `nalgebra` 0.32.6 - Linear algebra
- `tauri` 2.2.x - Desktop application framework
- `tokio` 1.40.0 - Async runtime
- `serde` 1.0.215 - Serialization
- `ts-rs` 10.1.0 - TypeScript bindings generation
- `anyhow` 1.0.93 - Error handling
- `tracing` 0.1 - Structured logging

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
