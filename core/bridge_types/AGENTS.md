<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-10 -->

# bridge_types

## Purpose
Shared type definitions and traits to break cyclic dependencies between api_bridge and loader crates. Defines core types for volume data (VolumeSendable), surface geometry, errors (BridgeError), and the Loader trait interface. Provides TypeScript binding export for frontend type safety.

## Key Files
| File | Description |
|------|-------------|
| `src/lib.rs` | Core type definitions (VolumeSendable, BridgeError, surface types) |
| `src/bin/export_types.rs` | Binary for generating TypeScript bindings to `bindings/` |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `bindings/` | Generated TypeScript type definitions (*.ts files) |

## For AI Agents

### Working In This Directory
This crate breaks cyclic dependencies - keep it lightweight with only shared types/traits. DO NOT add business logic here. VolumeSendable supports both 3D (DenseVolume3) and 4D (neuroim::DenseNeuroVec) variants for time series. BridgeError provides From implementations for RenderLoopError and VolumeMathError. All public types should derive TS trait for TypeScript export. Run `export_types` binary after adding new types.

### Testing Requirements
Run `cargo test -p bridge_types`. Types should be tested indirectly through dependent crates. Focus on serde round-trip tests for serializable types. Verify TypeScript bindings generate correctly with `cargo run --bin export_bridge_types`.

### Common Patterns
- Enum-based type variants (VolumeSendable, surface handles)
- Tuple structs wrapping volume data + affine transform
- `#[derive(TS)]` on all frontend-visible types
- Error conversion via `From` trait implementations
- `async_trait` for Loader trait (async load method)

## Dependencies

### Internal
- `volmath` - DenseVolume3 and spatial types
- `render_loop` - RenderLoopError for error conversion

### External
- `serde`, `serde_json` - Serialization with derive macros
- `thiserror` - Error type derivation
- `async-trait` - Async trait support for Loader
- `nalgebra` - Affine3 transforms with serde
- `ts-rs` (workspace) - TypeScript binding generation
- `neuroim` - 4D volume support (DenseNeuroVec)

<!-- MANUAL: -->
