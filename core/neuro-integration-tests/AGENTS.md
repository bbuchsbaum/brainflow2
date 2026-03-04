<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-10 -->

# neuro-integration-tests

## Purpose
Cross-component integration tests with visual dashboards for CPU/GPU differential testing. Validates rendering consistency between CPU reference implementation and GPU accelerated path. Provides test harnesses, metrics collection, visual debugging outputs, and performance benchmarking for slice extraction and rendering pipelines.

## Key Files
| File | Description |
|------|-------------|
| `src/lib.rs` | Module exports and working module list |
| `src/differential_harness.rs` | CPU/GPU comparison test harness with metrics |
| `src/differential_dashboard.rs` | Visual dashboard for test results |
| `src/enhanced_visual_dashboard.rs` | Enhanced dashboard with detailed metrics |
| `src/simple_visual_dashboard.rs` | Simplified dashboard for quick checks |
| `src/ellipsoid_visualizer.rs` | Ellipsoid/ROI rendering test utilities |
| `src/orthogonal_renderer.rs` | Orthogonal slice rendering test harness |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `src/` | Test utilities and harness implementations |
| `tests/` | Integration test files (test_declarative_api.rs, etc.) |
| `test_output/` | Generated visual outputs (PNG images for comparison) |

## For AI Agents

### Working In This Directory
This crate validates CPU/GPU rendering parity - CRITICAL for correctness. Differential tests compute per-pixel differences with metrics (max error, mean error, RMSE). Visual dashboards save comparison images to test_output/. When GPU shader changes occur, run these tests to ensure no regression. Acceptable thresholds documented in test assertions. Image outputs enable manual visual inspection. Some modules disabled (TODO comments) pending API updates.

### Testing Requirements
Run `cargo test -p neuro-integration-tests` for integration tests. Benchmarks with `cargo bench -p neuro-integration-tests`. Check test_output/ directory for visual diff images. Tests require both CPU and GPU implementations working. Use pollster for async GPU operations in synchronous tests. Verify baseline images exist for regression testing.

### Common Patterns
- DifferentialTestHarness for CPU/GPU comparison
- Metrics collection (max/mean/RMSE pixel differences)
- Visual dashboard with side-by-side comparison images
- Fixture generation with synthetic volumes
- OrthogonalTestResult for multi-view validation
- Image saving with `image` crate for visual inspection

## Dependencies

### Internal
- `neuro-types` - Core types for slice specifications
- `neuro-cpu` - CPU reference implementation
- `neuro-core` - Core contracts and traits
- `render_loop` - GPU WebGPU implementation
- `api-bridge` - Command implementations to test
- `volmath` - Volume mathematics
- `bridge_types` - Shared types
- `nifti-loader` - NIfTI file loading for test data
- `colormap` - Color mapping

### External
- `tokio` (workspace) - Async runtime for GPU operations
- `wgpu` (workspace) - GPU types
- `nalgebra` (workspace) - Linear algebra
- `approx` - Float comparison assertions
- `rand` - Random test data generation
- `image` - PNG/JPEG output for visual debugging
- `ndarray` - Array operations for test data

<!-- MANUAL: -->
