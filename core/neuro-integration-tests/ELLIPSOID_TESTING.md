# Ellipsoid-Based Coordinate Transformation Testing

This document describes the ellipsoid-based testing framework for validating coordinate transformations and volume rendering in the brainflow2 project.

## Overview

The ellipsoid testing framework uses oriented ellipsoids as ground truth for validating coordinate transformations. This approach provides several advantages:

- **Known Ground Truth**: Ellipsoids have well-defined mathematical properties
- **Comprehensive Testing**: Can test isotropic/anisotropic voxels, rotations, translations
- **Quantitative Metrics**: Uses Dice coefficient, Hausdorff distance, and other measures
- **Edge Case Coverage**: Handles extreme aspect ratios, partial FOV, tiny objects

## Architecture

### Core Components

1. **OrientedEllipsoid** (`neuro-types/src/shapes.rs`)
   - Represents ellipsoids in world coordinates
   - Efficient containment checking with precomputed transforms
   - Multiple rasterization methods (basic, scanline, supersampled)

2. **Validation Metrics** (`neuro-types/src/metrics.rs`)
   - Comprehensive overlap metrics (Dice, Jaccard, Hausdorff)
   - Surface distance calculations
   - Volume difference measurements

3. **Test Configurations** (`neuro-integration-tests/src/ellipsoid_tests.rs`)
   - Standard test suite with various scenarios
   - Property-based random testing
   - Edge case configurations

4. **Test Runner** (`neuro-integration-tests/src/ellipsoid_runner.rs`)
   - Integrates with existing differential testing framework
   - CPU/GPU comparison support
   - Performance tracking

## Test Categories

### Standard Test Suite

1. **Isotropic Volumes**
   - Equal voxel spacing in all dimensions
   - Validates basic coordinate transformations
   - Expected Dice > 0.95

2. **Anisotropic Volumes**
   - Different voxel spacing (e.g., 1×1.5×3mm)
   - Tests handling of non-uniform sampling
   - Expected Dice > 0.93

3. **Extreme Aspect Ratios**
   - Pancake-shaped ellipsoids (30×30×3mm)
   - Stresses transformation accuracy
   - Expected Dice > 0.90

4. **Rotated Coordinate Systems**
   - Volume with rotated orientation matrix
   - Tests complex transformations
   - Expected Dice > 0.95

5. **Partial Field of View**
   - Ellipsoids extending beyond volume bounds
   - Tests boundary handling
   - Expected Dice > 0.85

6. **Small Objects**
   - Near voxel-size ellipsoids
   - Tests discretization effects
   - Expected Dice > 0.80

### Edge Cases

- Identity transformations
- 90-degree rotations
- Very large volumes (stress testing)
- Degenerate orientations

### Property-Based Testing

- Random ellipsoid parameters
- Random volume configurations
- Statistical validation across many cases
- Expected 80%+ pass rate

## Usage

### Running Tests

```bash
# Run all ellipsoid tests
cargo test ellipsoid_validation

# Run specific test categories
cargo test test_ellipsoid_isotropic_volumes
cargo test test_ellipsoid_anisotropic_volumes

# Run expensive property-based tests
cargo test test_ellipsoid_random_configurations --ignored

# Run benchmarks
cargo bench ellipsoid_benchmarks
```

### CI Integration

The ellipsoid tests are integrated into the CI pipeline:

- **Pull Request Tests**: Basic validation on all PRs
- **Nightly Tests**: Full test suite including random configurations
- **Performance Tracking**: Benchmarks on main branch
- **Stress Tests**: Large volume handling

### Adding New Tests

```rust
use neuro_integration_tests::{EllipsoidTestConfig, EllipsoidTestRunner};

// Create custom ellipsoid
let ellipsoid = OrientedEllipsoid::new(
    Point3::new(0.0, 0.0, 0.0),
    Vector3::new(20.0, 15.0, 10.0),
    Rotation3::identity(),
    100.0,
).unwrap();

// Create volume configuration
let volume_config = VolumeConfig {
    dimensions: [64, 64, 64],
    spacing_mm: [2.0, 2.0, 2.0],
    origin_mm: [-64.0, -64.0, -64.0],
    orientation: None,
    description: "My test volume".to_string(),
};

// Create test configuration
let test_config = EllipsoidTestConfig {
    ellipsoid,
    volume_configs: vec![volume_config],
    tolerance: ValidationTolerance::default(),
    description: "My custom test".to_string(),
};

// Run test
let mut runner = EllipsoidTestRunner::new(cpu_provider);
let results = runner.run_ellipsoid_test(&test_config);
```

## Validation Metrics

### Dice Coefficient
- **Formula**: 2 × |A ∩ B| / (|A| + |B|)
- **Range**: 0.0 to 1.0 (higher is better)
- **Usage**: Primary overlap metric

### Hausdorff Distance
- **Definition**: Maximum distance from any point in A to nearest point in B
- **Units**: Millimeters
- **Usage**: Boundary accuracy assessment

### Volume Difference
- **Definition**: |(Vol_A - Vol_B)| / Vol_A × 100%
- **Units**: Percentage
- **Usage**: Size preservation check

### Center of Mass Distance
- **Definition**: Distance between volume centroids
- **Units**: Millimeters
- **Usage**: Position accuracy

## Performance Characteristics

### Rasterization Performance

| Method | 64³ Volume | 128³ Volume | Notes |
|--------|------------|-------------|--------|
| Basic | ~1ms | ~8ms | Simple voxel iteration |
| Scanline | ~0.8ms | ~6ms | Optimized incremental updates |
| Supersampled | ~4ms | ~32ms | 2×2×2 subsampling |

### Memory Usage

- **Efficient**: Only processes voxels within ellipsoid bounding box
- **Scalable**: Linear memory usage with volume size
- **Streaming**: No intermediate buffer allocation

## Troubleshooting

### Low Dice Coefficients

1. **Check voxel spacing**: Ensure correct units (mm)
2. **Verify orientation**: Check transformation matrices
3. **Adjust tolerance**: May need relaxed thresholds for edge cases
4. **Increase supersampling**: Use higher sample rates for ground truth

### Performance Issues

1. **Use scanline optimization**: For large volumes
2. **Reduce supersampling**: Balance quality vs. speed
3. **Optimize bounding box**: Ensure proper clipping

### Test Failures

1. **Check dependencies**: Ensure all crates compile
2. **Verify test data**: Confirm ellipsoid parameters are valid
3. **Review logs**: Check detailed test output for specifics

## Future Enhancements

### Planned Features

1. **GPU Acceleration**: CUDA/OpenCL rasterization kernels
2. **More Shapes**: Cylinders, boxes, arbitrary meshes
3. **Analytical Solutions**: Exact voxel-shape intersection
4. **Parallel Testing**: Multi-threaded test execution
5. **Visual Debugging**: Image output for failed tests

### Research Directions

1. **Adaptive Supersampling**: Quality-driven sample rates
2. **Statistical Modeling**: Error prediction and correction
3. **Machine Learning**: Automated tolerance tuning
4. **Real Data Validation**: Integration with actual brain volumes

## References

1. Dice, L.R. (1945). "Measures of the Amount of Ecologic Association Between Species"
2. Hausdorff, F. (1914). "Grundzüge der Mengenlehre"
3. Jaccard, P. (1912). "The Distribution of the Flora in the Alpine Zone"
4. Taha, A.A. & Hanbury, A. (2015). "Metrics for evaluating 3D medical image segmentation"