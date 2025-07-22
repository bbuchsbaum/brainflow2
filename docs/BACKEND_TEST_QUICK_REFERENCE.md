# Backend Test Strategy - Quick Reference

## Core Principles

1. **Single-pass interpolation** - No double resampling
2. **Square pixels guaranteed** - Via SliceBuilder
3. **No global state** - VolumeStore trait
4. **Premultiplied alpha** - Everywhere
5. **Back-to-front compositing** - Canonical order
6. **Test-first development** - Write tests before code

## Key Design Decisions - AS IMPLEMENTED

### Canonical Types (neuro-types)
```rust
pub struct SliceSpec {
    pub origin_mm: [f32; 3],      // Upper-left in world space
    pub u_mm: [f32; 3],           // Right vector (mm/pixel)
    pub v_mm: [f32; 3],           // Down vector (mm/pixel)
    pub dim_px: [u32; 2],         // Output dimensions
    pub interp: InterpolationMethod,
    pub border_mode: BorderMode,
}

pub struct LayerSpec {
    pub volume_id: VolumeHandle,
    pub world_from_voxel: Matrix4<f32>,
    pub visual: LayerVisual,
}

// Unified interface
pub trait SliceProvider {
    fn composite_rgba(&self, request: &CompositeRequest) -> Result<RgbaImage>;
}
```

### CPU Implementation (neuro-cpu)
```rust
// High-precision reference implementation
pub struct CpuSlicer {
    volume_store: Arc<dyn VolumeStore>,
}

// Single-pass world-space sampling with f64 precision
```

### GPU Adapter Pattern
```rust
// Thin adapter - no GPU re-architecture
pub struct GpuSliceAdapter {
    render_service: Rc<RefCell<RenderLoopService>>,
}

// Maps SliceSpec → ViewState for existing GPU
```

## Testing Tolerances

| Metric | Tolerance | Rationale |
|--------|-----------|-----------|
| Per-pixel max | ≤ 2 gray levels | GPU float precision |
| Mean error | < 0.25 | Perceptual threshold |
| Edge similarity | > 95% | Geometry preservation |
| NaN/Inf | Zero tolerance | Clamp all inputs |

## Performance Targets

| Operation | Target | Actual |
|-----------|--------|--------|
| 256×256 single | < 10ms | ~1ms CPU |
| 512×512 single | < 20ms | ~4ms CPU |
| 1024×1024 single | < 40ms | ~16ms CPU |
| GPU speedup | 10-50x | TBD |

## Common Patterns

### Creating Test Volumes
```rust
// Using neuro-core TestVolume
let volume = TestVolume::new([64, 64, 64], [1.0, 1.0, 1.0], [0.0, 0.0, 0.0]);
let gradient = TestVolume::with_gradient([128, 128, 128]);
```

### Running Differential Tests
```rust
use neuro_types::testing::{DifferentialTester, DiffTestConfig};

#[test]
fn test_cpu_gpu_match() {
    let tester = DifferentialTester::new();
    let result = tester.compare_providers(&cpu, &gpu, &request, "test_name")?;
    assert!(result.passed);
}
```

### Integration Test Harness
```rust
use neuro_integration_tests::{ComparisonHarness, HarnessBuilder};

let harness = HarnessBuilder::new()
    .with_cpu_provider(cpu_provider)
    .with_gpu_provider(gpu_provider)
    .with_tolerance(2, 0.02)
    .build()?;

let results = harness.run_test_suite(tests);
```

## Debugging Tips

### Failed Differential Test
1. Enable debug output: `NEURO_DEBUG_DIFF=1`
2. Save debug images: `NEURO_SAVE_DEBUG_IMAGES=1`
3. Check statistics in test output
4. Review `debug_images/` directory

### Performance Issues
```bash
# Run benchmarks
cargo bench --package neuro-integration-tests

# Profile specific operation
cargo bench --package neuro-integration-tests -- axial_slices
```

### Test Failures
```bash
# Run with detailed output
cargo test --package neuro-integration-tests -- --nocapture

# Run specific test
cargo test --package neuro-integration-tests test_oblique_slices
```

## CI/CD Workflows

### PR Testing
```yaml
# .github/workflows/differential-testing.yml
- Runs on every PR
- Basic test suite
- Performance regression check
```

### Nightly Testing
```yaml
# .github/workflows/nightly-differential.yml
- Extensive test matrix
- Performance profiling
- Stress testing
```

## Quick Commands

```bash
# Run all differential tests
./scripts/run-differential-tests.sh

# Run with filter
./scripts/run-differential-tests.sh -f oblique

# Run with benchmarks
./scripts/run-differential-tests.sh -b

# Run specific crate tests
cargo test --package neuro-types
cargo test --package neuro-cpu
cargo test --package neuro-integration-tests

# Run benchmarks
cargo bench --package neuro-integration-tests

# Check compilation
cargo check --workspace
```

## Architecture Diagram - AS BUILT

```
┌─────────────────────┐     ┌─────────────────────┐
│   Application Code  │     │  Integration Tests  │
└──────────┬──────────┘     └──────────┬──────────┘
           │                           │
           ▼                           ▼
    ┌──────────────────────────────────────┐
    │          neuro-types                 │
    │  ┌─────────────┐  ┌───────────────┐ │
    │  │  SliceSpec  │  │   LayerSpec   │ │
    │  └─────────────┘  └───────────────┘ │
    │  ┌─────────────────────────────────┐ │
    │  │      SliceProvider trait        │ │
    │  └─────────────────────────────────┘ │
    └────────┬─────────────────┬───────────┘
             │                 │
    ┌────────▼──────┐   ┌──────▼──────────┐
    │   neuro-cpu   │   │ render_loop +    │
    │  (Reference)  │   │ GpuSliceAdapter  │
    └───────────────┘   └──────────────────┘
             │                 │
             └────────┬────────┘
                      ▼
            ┌─────────────────────┐
            │ Differential Tests  │
            │ Integration Tests   │
            └─────────────────────┘
```

## Key Files & Locations

- **Canonical Types**: `core/neuro-types/`
- **CPU Implementation**: `core/neuro-cpu/`
- **Integration Tests**: `core/neuro-integration-tests/`
- **GPU Adapter**: `core/render_loop/src/slice_adapter.rs`
- **CI Workflows**: `.github/workflows/differential-testing.yml`
- **Test Script**: `scripts/run-differential-tests.sh`
- **Documentation**: `core/DIFFERENTIAL_TESTING_DESIGN.md`

## Contact & Resources

- Implementation Status: `docs/BACKEND_TEST_TICKETS.md`
- Design Document: `core/DIFFERENTIAL_TESTING_DESIGN.md`
- Integration Tests: `core/neuro-integration-tests/README.md`