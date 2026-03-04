<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-10 -->

# volmath

## Purpose
Compatibility layer wrapping neuroim-rs library to maintain existing APIs during migration to comprehensive neuroim-rs implementation. Provides volume mathematics, spatial utilities, coordinate transforms, linear algebra helpers, and core volume types. Re-exports neuroim with compatibility type aliases (DenseVolume3, NeuroSpace3) for backward compatibility.

## Key Files
| File | Description |
|------|-------------|
| `src/lib.rs` | Compatibility layer with type aliases and neuroim re-exports |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| N/A | Thin wrapper around neuroim-rs |

## For AI Agents

### Working In This Directory
This is a COMPATIBILITY WRAPPER around neuroim-rs - most functionality comes from neuroim. Type aliases maintain old API: DenseVolume3<T> = CompatibleVolume<T>, NeuroSpace3 = NeuroSpaceWrapper. When code migrates to pure neuroim, these aliases can be removed. DO NOT add new volume logic here - contribute to neuroim-rs instead. This crate enables gradual migration without breaking existing code. NeuroSpaceWrapper provides old API surface that render_loop expects.

### Testing Requirements
Run `cargo test -p volmath`. Tests verify compatibility layer works correctly. Most testing happens in neuroim-rs. Verify type aliases resolve correctly and old code compiles. Use `approx` for float comparisons. WASM support via wasm-bindgen for potential web deployment.

### Common Patterns
- Type alias compatibility (DenseVolume3, NeuroSpace3)
- Wrapper types preserving old API (NeuroSpaceWrapper)
- Re-export modules from neuroim
- Serde support for all volume types
- Bytemuck for safe type casting
- Optional rayon parallelism

## Dependencies

### Internal
None - this wraps external neuroim-rs

### External
- `neuroim` - Core neuroimaging library (local path dependency)
- `ts-rs` (workspace) - TypeScript type generation with serde-compat
- `serde` - Serialization with derive macros
- `nalgebra` - Linear algebra with serde support
- `ndarray` - N-dimensional arrays
- `bytemuck` - Zero-copy type casting
- `num-traits` - Numeric trait abstractions
- `thiserror` - Error type derivation
- `once_cell` - Lazy static initialization
- `rayon` - Data parallelism
- `approx` - Float comparison utilities
- `wasm-bindgen` - WebAssembly bindings
- `half` - Half-precision float support with serde and bytemuck

<!-- MANUAL: This is a compatibility layer - prefer contributing to neuroim-rs over adding logic here. -->
