<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-10 -->

# neuro-core

## Purpose
Core contracts and types for neuroimaging slice extraction. Defines foundational traits (SliceProvider, VolumeStore) and types (SliceSpec, LayerSpec, BlendMode) for extracting 2D slices from 3D volumes with arbitrary orientations, multi-layer compositing, and guaranteed square pixels. Provides architecture-agnostic interface implemented by both CPU and GPU renderers.

## Key Files
| File | Description |
|------|-------------|
| `src/lib.rs` | Module exports and SliceProvider trait definition |
| `src/error.rs` | Error types for slice extraction operations |
| `src/layer.rs` | LayerSpec, BlendMode, LayerVisual types |
| `src/slice_builder.rs` | SliceBuilder for constructing slice specifications |
| `src/slice_spec.rs` | SliceSpec with orientation, FOV, interpolation |
| `src/volume_store.rs` | VolumeStore trait and test implementations |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| N/A | Flat module structure |

## For AI Agents

### Working In This Directory
This defines the CONTRACT for slice extraction - keep it implementation-agnostic. SliceProvider trait is implemented by both neuro-cpu and render_loop. SliceSpec defines orientation via normal vector or axis, FOV via bounding box, and pixel size for square pixels. LayerSpec combines volume reference with visual parameters (opacity, colormap, blend mode). VolumeStore trait abstracts volume access. Changes here affect ALL implementations.

### Testing Requirements
Run `cargo test -p neuro-core`. Tests focus on type invariants and builder patterns. Use `approx` for float comparisons. Property tests with `proptest` verify mathematical invariants (e.g., square pixels). Mock implementations (TestVolume, TestVolumeStore) support testing without file I/O.

### Common Patterns
- Builder pattern for complex types (SliceBuilder)
- Trait-based abstraction (SliceProvider, VolumeStore)
- Handle-based volume references (VolumeHandle)
- Enum-based configuration (BlendMode, InterpolationMethod, BorderMode)
- Result type with custom Error enum

## Dependencies

### Internal
None - this is a foundational contract crate

### External
- `nalgebra` - Linear algebra for orientations and transforms
- `thiserror` - Error type derivation
- `anyhow` - Error handling convenience
- `serde` - Serialization with derive macros

<!-- MANUAL: -->
