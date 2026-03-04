<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-10 -->

# atlases

## Purpose
Provides organized access to brain atlases (parcellations and region definitions) without requiring manual file browser navigation. Integrates with neuroatlas-rs library for standardized atlas loading, caching, and management. Supports popular atlases including ASEG, Glasser, Schaefer, and custom atlases.

## Key Files
| File | Description |
|------|-------------|
| `src/lib.rs` | Module exports and neuroatlas re-exports |
| `src/catalog.rs` | Atlas catalog management and registry |
| `src/service.rs` | Atlas loading service with caching |
| `src/types.rs` | Atlas type definitions and metadata structures |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| N/A | Flat module structure |

## For AI Agents

### Working In This Directory
This crate wraps neuroatlas-rs for integration with Brainflow. When adding new atlas types, update the catalog in `catalog.rs` and ensure metadata is properly structured. The service layer handles async loading and caching. All atlas files are cached locally per neuroatlas conventions. Re-export commonly used neuroatlas types in `lib.rs` for frontend convenience.

### Testing Requirements
Run `cargo test -p atlases`. Use `tempfile` for temporary directories in tests. Tests should verify atlas discovery, loading, and caching behavior. Mock filesystem interactions where appropriate using `tracing-test` for log validation.

### Common Patterns
- Async loading with tokio runtime
- Caching using neuroatlas cache directory structure
- Error handling with `anyhow::Result` and custom error types
- Metadata stored with timestamp for freshness tracking
- Surface feature gated behind `surface` feature flag (default enabled)

## Dependencies

### Internal
None - this is a leaf crate wrapping external library

### External
- `neuroatlas` (workspace) - Core atlas library with optional surface support
- `serde`, `serde_json` (workspace) - Serialization
- `tokio` (workspace) - Async runtime
- `anyhow`, `thiserror` (workspace) - Error handling
- `tracing` (workspace) - Logging and instrumentation
- `ts-rs` (workspace) - TypeScript type generation
- `futures` (workspace) - Async utilities
- `chrono` - Timestamp tracking with serde support

<!-- MANUAL: -->
