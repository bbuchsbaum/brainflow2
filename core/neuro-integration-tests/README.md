# CPU/GPU Differential Testing Framework

This crate provides a comprehensive framework for validating that CPU and GPU implementations of neuroimaging slice extraction produce consistent results.

## Overview

The differential testing framework ensures that:
- CPU and GPU implementations produce pixel-perfect (or near-perfect) matches
- Performance characteristics are tracked and regressions are detected
- Edge cases and complex scenarios are thoroughly tested
- Results are reproducible across different platforms

## Architecture

### Core Components

1. **`neuro-types`** - Canonical type definitions
   - `SliceSpec` - World-space slice specifications
   - `LayerSpec` - Volume layer with visual parameters
   - `SliceProvider` trait - Unified interface for CPU/GPU

2. **`neuro-cpu`** - Reference CPU implementation
   - Single-pass world-space sampling
   - High-precision coordinate transforms
   - Premultiplied alpha compositing

3. **`neuro-integration-tests`** - Testing framework
   - `ComparisonHarness` - Main test orchestrator
   - Test generators for common scenarios
   - Statistical analysis and reporting

## Running Tests

### Quick Start

```bash
# Run all differential tests
cargo test --package neuro-integration-tests

# Run specific test suite
cargo test --package neuro-integration-tests test_axial_slices

# Run with verbose output
NEURO_DEBUG_DIFF=1 cargo test --package neuro-integration-tests

# Save debug images on failure
NEURO_SAVE_DEBUG_IMAGES=1 cargo test --package neuro-integration-tests
```

### Using the Test Script

```bash
# Run all tests
./scripts/run-differential-tests.sh

# Run with filter
./scripts/run-differential-tests.sh -f oblique

# Run with benchmarks
./scripts/run-differential-tests.sh -b

# Save debug images
./scripts/run-differential-tests.sh -i
```

## Test Suites

### Basic Slice Tests
- **Axial slices** - Standard XY plane extraction at various Z coordinates
- **Coronal slices** - Standard XZ plane extraction at various Y coordinates  
- **Sagittal slices** - Standard YZ plane extraction at various X coordinates

### Advanced Tests
- **Oblique slices** - Arbitrary slice orientations with rotations
- **Multi-layer compositing** - Multiple volumes with different blend modes
- **Edge cases** - Boundary conditions, out-of-bounds sampling
- **Interpolation methods** - Nearest, Linear, Cubic (when available)

### Performance Tests
- **Resolution scaling** - 128x128 to 2048x2048 slices
- **Layer count scaling** - 1 to 8 layers
- **Interpolation overhead** - Cost of different methods
- **Memory bandwidth** - Upload/download throughput

## Tolerance Configuration

The framework supports configurable tolerances for comparing outputs:

```rust
let config = DiffTestConfig {
    max_abs_diff: 2,        // Max absolute difference per channel (0-255)
    max_rel_diff: 0.02,     // Max relative difference (2%)
    min_nonzero_pixels: 10, // Min pixels for relative comparison
    save_debug_images: true,
};
```

### Recommended Tolerances

| Scenario | max_abs_diff | max_rel_diff | Notes |
|----------|--------------|--------------|-------|
| CPU vs CPU | 0 | 0.0 | Should be identical |
| Nearest interpolation | 1 | 0.01 | Minimal differences |
| Linear interpolation | 2 | 0.02 | Small interpolation differences |
| Oblique slices | 3 | 0.03 | Complex transforms |
| Multi-layer | 2 | 0.02 | Compositing differences |

## CI Integration

### GitHub Actions Workflows

1. **`differential-testing.yml`** - Runs on every PR
   - Basic test suite
   - Performance regression check
   - Cross-platform validation

2. **`nightly-differential.yml`** - Extensive nightly tests
   - Full test matrix
   - Performance profiling
   - Stress testing

### Performance Tracking

Benchmarks are automatically run and tracked:
- Baseline saved for main branch
- PRs checked for >10% regression
- Results posted as PR comments
- Historical data preserved

## Debugging Failed Tests

### Debug Output

When tests fail, enable debug output:
```bash
NEURO_DEBUG_DIFF=1 cargo test -- --nocapture
```

This provides:
- Detailed pixel difference statistics
- Per-channel analysis
- Histogram of differences
- Exact pixel locations of failures

### Debug Images

Save images for visual inspection:
```bash
NEURO_SAVE_DEBUG_IMAGES=1 cargo test
```

Creates in `debug_images/`:
- `{test_name}_cpu.png` - CPU output
- `{test_name}_gpu.png` - GPU output  
- `{test_name}_diff.png` - Difference map
- `{test_name}_stats.json` - Detailed statistics

### Common Issues

1. **Interpolation differences**
   - GPU may use hardware interpolation
   - Slight differences at boundaries expected
   - Solution: Increase tolerance for interpolated tests

2. **Floating-point precision**
   - CPU uses f64 internally, GPU uses f32
   - Accumulation of small errors
   - Solution: Use relative tolerance

3. **Coordinate edge cases**
   - Different rounding behavior
   - Boundary pixel handling
   - Solution: Test with border modes

## Performance Benchmarking

### Running Benchmarks

```bash
# Run all benchmarks
cargo bench --package neuro-integration-tests

# Run specific benchmark
cargo bench --package neuro-integration-tests axial_slices

# Compare with baseline
cargo bench --package neuro-integration-tests -- --baseline main
```

### Benchmark Suites

1. **Resolution scaling** - How performance scales with output size
2. **Layer compositing** - Cost of additional layers
3. **Interpolation methods** - Performance impact of quality
4. **Oblique transforms** - Cost of complex orientations

### Expected Performance

Typical performance targets (on modern hardware):
- 256x256 axial slice: <1ms CPU, <0.1ms GPU
- 512x512 axial slice: <4ms CPU, <0.2ms GPU
- 1024x1024 axial slice: <16ms CPU, <0.5ms GPU
- GPU speedup: 10-50x depending on complexity

## Extending the Framework

### Adding New Tests

1. Create test in `tests/` directory:
```rust
#[test]
fn test_my_scenario() {
    let harness = create_test_harness();
    let request = create_my_request();
    let result = harness.run_test(&request, "my_test");
    assert!(result.passed);
}
```

2. Add to test generator if common:
```rust
impl TestSliceGenerator {
    pub fn my_special_slice() -> SliceSpec {
        // Create specialized slice
    }
}
```

### Adding New Metrics

Extend `DiffTestResult` with new statistics:
```rust
pub struct DiffTestResult {
    // ... existing fields ...
    pub my_metric: f32,
}
```

### Custom Tolerances

Implement custom comparison logic:
```rust
impl DifferentialTester {
    pub fn compare_with_custom_logic(
        &self,
        output1: &RgbaImage,
        output2: &RgbaImage,
    ) -> Result<CustomResult> {
        // Custom comparison
    }
}
```

## Troubleshooting

### Build Issues

```bash
# Clean build
cargo clean
cargo build --package neuro-integration-tests

# Update dependencies
cargo update
```

### Test Failures

1. Check error messages for specific pixel coordinates
2. Enable debug output for detailed analysis
3. Save debug images for visual inspection
4. Verify test data is generated correctly
5. Check for platform-specific issues

### Performance Issues

1. Ensure release builds: `--release`
2. Check CPU frequency scaling
3. Verify GPU drivers are loaded
4. Monitor memory bandwidth
5. Profile with flamegraph

## Future Enhancements

- [ ] WebGPU backend testing
- [ ] Distributed testing across multiple GPUs
- [ ] Automatic tolerance tuning
- [ ] Visual regression testing
- [ ] Integration with neuroimaging test datasets