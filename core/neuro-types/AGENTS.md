<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-10 -->

# neuro-types

## Purpose
Canonical type definitions for neuroimaging slice extraction and rendering. Provides core contracts that both CPU and GPU implementations must satisfy for unified differential testing and API consistency. Defines SliceSpec (orientation, FOV, pixel size), ViewRect (pixel-space geometry), LayerSpec (rendering parameters), and volume handle types.

## Key Files
| File | Description |
|------|-------------|
| `src/lib.rs` | Module exports, VolumeHandle, Error, Result types |
| `src/slice_spec.rs` | SliceSpec with orientation and pixel size logic |
| `src/view_rect.rs` | ViewRectMm and pixel-space geometry calculations |
| `src/layer_spec.rs` | LayerSpec with colormap, opacity, blend mode |
| `src/provider.rs` | SliceProvider trait and composite rendering types |
| `src/shapes.rs` | Shape definitions (ellipsoids, ROIs) |
| `src/metrics.rs` | Rendering metrics and performance tracking |
| `src/volume.rs` | Volume trait and handle types |
| `src/testing.rs` | Test utilities and mock implementations |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| N/A | Flat module structure |

## For AI Agents

### Working In This Directory
These are CANONICAL definitions - changes affect ALL implementations (CPU, GPU, tests). SliceSpec defines slice plane via orientation vectors (right, down) derived from axis or normal. ViewRectMm ensures SQUARE PIXELS (critical for medical imaging) by using max(width/px_w, height/px_h) for pixel_size. LayerSpec wraps VolumeHandle with rendering params. Handle-based references avoid data duplication. Coordinate systems: world space (LPI), pixel space (image convention). See CLAUDE.md for Y-axis handling details.

### Testing Requirements
Run `cargo test -p neuro-types`. Tests verify mathematical invariants (square pixels, orthogonal orientations). Use `approx` for float comparisons. No implementation logic here - just type definitions and simple calculations. Property tests verify coordinate transform consistency.

### Common Patterns
- Handle-based volume references (VolumeHandle wraps usize)
- Enum-based configuration (BlendMode, ThresholdMode, Axis)
- Builder-style construction with validation
- f32 for performance, f64 for precision where needed
- Serde support for all public types

## Dependencies

### Internal
None - this is a foundational type definition crate

### External
- `nalgebra` (workspace) - Vector and matrix types for geometry
- `serde` (workspace) - Serialization with derive macros
- `thiserror` - Error type derivation

<!-- MANUAL: -->
