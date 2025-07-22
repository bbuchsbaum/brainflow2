# CPU/GPU Differential Testing - Technical Design

## Executive Summary

This document describes the design and implementation of the CPU/GPU differential testing framework for Brainflow's neuroimaging slice extraction. The framework ensures pixel-perfect (or near-perfect) consistency between CPU and GPU implementations while maintaining the architectural independence of each implementation.

## Design Principles

### 1. Converge on Contract, Not Implementation

The CPU and GPU paths share a common contract (`SliceSpec`, `LayerSpec`) but maintain completely independent implementations:

- **CPU**: Single-pass world-space sampling with high precision
- **GPU**: Tile-based rendering with hardware acceleration

This allows each implementation to be optimal for its platform while ensuring consistent results.

### 2. World-Space as Canonical Coordinate System

All specifications use world-space (millimeter) coordinates:
- No voxel-space in the public API
- Transforms happen internally within each implementation
- Reduces coordinate system confusion
- Natural for clinical/research use cases

### 3. Thin Adapter Pattern

Instead of modifying existing implementations, thin adapters bridge the gaps:
- `GpuSliceAdapter` wraps the GPU render loop
- `SliceSpecMapper` converts between coordinate systems
- Minimal changes to battle-tested code
- Easy to remove/modify adapters

## Architecture Overview

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
    │               │   │ GpuSliceAdapter  │
    └───────────────┘   └──────────────────┘
```

## Component Details

### neuro-types: Canonical Contracts

Defines the shared types that both CPU and GPU must support:

```rust
pub struct SliceSpec {
    pub origin_mm: [f32; 3],      // World-space origin
    pub u_mm: [f32; 3],           // World-space U vector
    pub v_mm: [f32; 3],           // World-space V vector  
    pub dim_px: [u32; 2],         // Output dimensions
    pub interp: InterpolationMethod,
    pub border_mode: BorderMode,
}

pub struct LayerSpec {
    pub volume_id: VolumeHandle,
    pub world_from_voxel: Matrix4<f32>,
    pub visual: LayerVisual,
}
```

Key design decisions:
- All coordinates in millimeters (world-space)
- Vectors define slice plane orientation
- Visual parameters separate from geometry
- Simple, clinical-friendly API

### neuro-cpu: Reference Implementation

The CPU implementation serves as the reference:

```rust
impl SliceProvider for CpuSlicer {
    fn composite_rgba(&self, request: &CompositeRequest) -> Result<RgbaImage> {
        // Single-pass algorithm:
        // 1. For each output pixel
        // 2. Calculate world position
        // 3. For each layer (back-to-front)
        // 4. Transform world→voxel
        // 5. Sample with interpolation
        // 6. Apply visual parameters
        // 7. Composite with blend mode
    }
}
```

Design features:
- **High precision**: f64 internal calculations
- **Single pass**: Cache-friendly access pattern
- **Direct sampling**: No intermediate buffers
- **Accurate blending**: Premultiplied alpha

### GPU Adapter: Bridging the Gap

The GPU adapter translates between coordinate systems:

```rust
impl SliceSpecMapper {
    fn to_view_state(request: &CompositeRequest) -> ViewState {
        // Convert SliceSpec → ViewState
        // 1. Calculate view bounds from slice plane
        // 2. Create orthographic projection
        // 3. Map LayerSpec → LayerInfo
        // 4. Preserve visual parameters
    }
}
```

Key conversions:
- Slice plane → View frustum
- World vectors → View matrix
- Layer parameters → GPU uniforms

## Differential Testing Framework

### Test Harness

The `ComparisonHarness` orchestrates testing:

```rust
pub struct ComparisonHarness {
    cpu_provider: Box<dyn SliceProvider>,
    gpu_provider: Box<dyn SliceProvider>,
    tester: DifferentialTester,
}
```

Features:
- Provider abstraction for easy mocking
- Configurable tolerance levels
- Performance tracking
- Detailed error reporting

### Tolerance System

Different scenarios require different tolerances:

```rust
pub struct DiffTestConfig {
    pub max_abs_diff: u8,      // Absolute difference (0-255)
    pub max_rel_diff: f32,     // Relative difference (0.0-1.0)
    pub min_nonzero_pixels: usize,
    pub save_debug_images: bool,
}
```

Tolerance guidelines:
- **Exact match** (CPU vs CPU): 0 absolute, 0.0 relative
- **Nearest neighbor**: 1 absolute, 0.01 relative
- **Linear interpolation**: 2 absolute, 0.02 relative
- **Complex transforms**: 3 absolute, 0.03 relative

### Statistical Analysis

Each comparison produces detailed statistics:

```rust
pub struct DiffTestResult {
    pub passed: bool,
    pub max_abs_diff: u8,
    pub max_rel_diff: f32,
    pub failed_pixels: usize,
    pub stats: DiffStats,
}

pub struct DiffStats {
    pub mean_abs_diff: f32,
    pub std_abs_diff: f32,
    pub p95_abs_diff: u8,
    pub exact_matches: usize,
}
```

This enables:
- Identifying systematic vs random differences
- Tracking accuracy over time
- Tuning tolerance thresholds
- Debugging specific issues

## Test Scenarios

### Standard Test Suite

1. **Axial/Coronal/Sagittal** - Cardinal plane extraction
2. **Oblique slices** - Arbitrary orientations
3. **Multi-layer compositing** - Blend modes, opacity
4. **Edge cases** - Boundaries, out-of-bounds
5. **Performance scaling** - Various resolutions

### Synthetic Test Volumes

Test volumes with known properties:
- **Sphere** - Smooth gradients, symmetry
- **Gradient** - Linear progression
- **Checkerboard** - Sharp edges, patterns
- **Sinusoid** - Frequency content

These volumes help identify:
- Interpolation artifacts
- Precision issues
- Boundary handling
- Frequency response

## Performance Considerations

### Benchmarking Framework

Comprehensive performance tracking:
```rust
// Resolution scaling
benchmark_axial_slices(); // 256x256 to 2048x2048

// Layer compositing  
benchmark_multi_layer();  // 1 to 8 layers

// Interpolation methods
benchmark_interpolation(); // Nearest vs Linear
```

### Expected Performance

Typical CPU vs GPU speedups:
- Simple axial slice: 10-20x
- Complex oblique: 20-40x  
- Multi-layer: 30-50x
- High resolution: 40-80x

Factors affecting speedup:
- Output resolution (GPU scales better)
- Number of layers (GPU parallel)
- Interpolation quality (GPU hardware)
- Memory bandwidth (GPU advantage)

## CI/CD Integration

### Automated Testing

Two-tier testing strategy:

1. **PR Tests** (`differential-testing.yml`)
   - Basic test suite (5 min)
   - Performance regression check
   - Cross-platform validation

2. **Nightly Tests** (`nightly-differential.yml`)
   - Extensive test matrix (1 hour)
   - Stress testing
   - Performance profiling
   - Automatic issue creation

### Performance Tracking

Continuous performance monitoring:
- Benchmarks on every PR
- Baseline comparison
- Regression detection (>10%)
- Historical trending

## Future Enhancements

### Near Term
- [ ] WebGPU backend support
- [ ] SIMD optimizations for CPU
- [ ] Automatic tolerance tuning
- [ ] Visual regression testing

### Long Term
- [ ] Multi-GPU testing
- [ ] Distributed test execution
- [ ] Hardware-specific optimizations
- [ ] Integration with clinical datasets

## Conclusion

The differential testing framework provides a robust foundation for ensuring CPU/GPU consistency while maintaining architectural flexibility. The thin adapter pattern allows gradual migration and easy experimentation without disrupting existing code. The comprehensive test suite and CI integration ensure long-term reliability and performance.