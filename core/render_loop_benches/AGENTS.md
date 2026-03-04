<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-10 -->

# render_loop_benches

## Purpose
Criterion-based performance benchmarks for render_loop GPU rendering operations. Measures texture upload throughput and frame rendering times to detect performance regressions. Provides HTML reports with statistical analysis of benchmark results across multiple runs.

## Key Files
| File | Description |
|------|-------------|
| `benches/upload.rs` | Texture upload benchmark measuring GPU transfer throughput |
| `benches/render_time.rs` | Frame rendering benchmark measuring end-to-end render time |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| N/A | Benchmarks in benches/ directory |

## For AI Agents

### Working In This Directory
Benchmarks measure performance-critical paths. Run with `cargo bench -p render_loop_benches` - generates HTML reports in target/criterion/. Use pollster for async GPU operations in sync benchmark context. Vary volume sizes (64³, 128³, 256³) for scaling analysis. Benchmark both upload (CPU→GPU transfer) and render (full pipeline) independently. Check for regressions when modifying render_loop texture or pipeline code.

### Testing Requirements
Not a test crate - this IS the benchmark suite. Run benchmarks before/after changes to render_loop. Compare criterion HTML reports for statistical significance. Benchmark on representative hardware (M1/M2 Mac, modern GPU). Use `--baseline` flag for comparing against previous runs. Warm up GPU before measurements.

### Common Patterns
- Criterion benchmark groups
- Random volume data generation with `rand`
- Pollster for blocking on async GPU operations
- Volume size parameterization (small/medium/large)
- Bytemuck for safe data casting
- HTML report generation (default criterion feature)

## Dependencies

### Internal
- `render_loop` - The crate being benchmarked

### External
- `criterion` - Benchmark framework with HTML reports (no default features, html_reports enabled)
- `pollster` - Block on async GPU operations
- `rand` - Random test data generation
- `wgpu` (workspace) - GPU types
- `bytemuck` - Safe type casting for test data

<!-- MANUAL: -->
