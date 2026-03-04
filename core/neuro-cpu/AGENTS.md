<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-10 -->

# neuro-cpu

## Purpose
CPU reference implementation for neuroimaging slice extraction providing software rendering fallback when WebGPU unavailable. Single-pass world-space sampling implementation serves as ground truth for GPU differential testing. Includes volume renderer, ellipsoid renderer, and multi-threaded processing with rayon for performance.

## Key Files
| File | Description |
|------|-------------|
| `src/lib.rs` | CpuSlicer main implementation and SliceProvider trait |
| `src/volume_renderer.rs` | CPU volume rendering with world-space sampling |
| `src/ellipsoid_renderer.rs` | Ellipsoid/ROI shape rendering on CPU |
| `src/interpolation.rs` | Nearest, linear, cubic interpolation implementations |
| `src/blending.rs` | Multi-layer compositing with blend modes |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| N/A | Flat module structure |

## For AI Agents

### Working In This Directory
This is the CPU REFERENCE implementation - correctness over speed, though rayon provides parallelism. Uses image convention internally (Y=0 at top, Y increases downward). NO Y-flip in renderer - that's GPU-only concern. World-to-pixel transforms must match GPU exactly for differential testing. When modifying, run integration tests in neuro-integration-tests to verify CPU/GPU parity. All rendering goes through world-space sampling for consistency.

### Testing Requirements
Run `cargo test -p neuro-cpu`. Critical: run differential tests in `neuro-integration-tests` comparing CPU vs GPU output. Use `approx` for float comparisons with appropriate epsilon. Benchmark with criterion for performance regression detection. Visual output comparison for qualitative validation.

### Common Patterns
- World-space to voxel-space coordinate transforms (f64 precision)
- Parallel iteration with rayon for pixel loops
- Interpolation method dispatch (nearest/linear/cubic)
- Layer compositing with blend mode enum
- Reference to neuro-core traits and types

## Dependencies

### Internal
- `neuro-types` - Core types (SliceSpec, ViewRectMm, etc.)
- `neuro-core` - Traits (SliceProvider, VolumeStore)
- `colormap` - Color mapping for visualization
- `volmath` - Volume mathematics and spatial utilities

### External
- `nalgebra` (workspace) - Matrix operations and transforms
- `rayon` - Data parallelism for pixel processing
- `anyhow` - Error handling

<!-- MANUAL: -->
