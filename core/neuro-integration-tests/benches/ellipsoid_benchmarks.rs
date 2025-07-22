//! Performance benchmarks for ellipsoid-based coordinate transformation tests

use criterion::{criterion_group, criterion_main, Criterion, BenchmarkId};
use neuro_integration_tests::{EllipsoidTestConfig, EllipsoidTestRunner};
use neuro_cpu::CpuSliceProvider;
use neuro_core::TestVolumeStore;
use neuro_types::{OrientedEllipsoid, VolumeRasterizer};
use nalgebra::{Point3, Vector3, Rotation3, Matrix4};
use std::sync::Arc;

// Simple volume for benchmarking
struct BenchVolume {
    dimensions: [usize; 3],
    data: Vec<f32>,
    voxel_to_world: Matrix4<f32>,
}

impl BenchVolume {
    fn new(dimensions: [usize; 3], spacing: [f32; 3]) -> Self {
        let size = dimensions[0] * dimensions[1] * dimensions[2];
        let voxel_to_world = Matrix4::new_nonuniform_scaling(&nalgebra::Vector3::from(spacing));
        
        Self {
            dimensions,
            data: vec![0.0; size],
            voxel_to_world,
        }
    }
}

impl VolumeRasterizer for BenchVolume {
    fn dimensions(&self) -> [usize; 3] {
        self.dimensions
    }
    
    fn voxel_to_world_matrix(&self) -> Matrix4<f32> {
        self.voxel_to_world
    }
    
    fn set_at_coords(&mut self, coords: [usize; 3], value: f32) -> neuro_types::Result<()> {
        let idx = coords[2] * self.dimensions[0] * self.dimensions[1]
                + coords[1] * self.dimensions[0]
                + coords[0];
        if idx < self.data.len() {
            self.data[idx] = value;
        }
        Ok(())
    }
}

fn bench_ellipsoid_rasterization(c: &mut Criterion) {
    let mut group = c.benchmark_group("ellipsoid_rasterization");
    
    // Test different volume sizes
    let sizes = vec![
        ([32, 32, 32], "32x32x32"),
        ([64, 64, 64], "64x64x64"),
        ([128, 128, 128], "128x128x128"),
    ];
    
    // Create test ellipsoid
    let ellipsoid = OrientedEllipsoid::new(
        Point3::new(0.0, 0.0, 0.0),
        Vector3::new(20.0, 15.0, 10.0),
        Rotation3::identity(),
        100.0,
    ).unwrap();
    
    for (dimensions, size_name) in sizes {
        // Basic rasterization
        group.bench_with_input(
            BenchmarkId::new("basic", size_name),
            &dimensions,
            |b, &dims| {
                b.iter(|| {
                    let mut volume = BenchVolume::new(dims, [1.0, 1.0, 1.0]);
                    ellipsoid.rasterize(&mut volume).unwrap();
                });
            },
        );
        
        // Scanline optimized rasterization
        group.bench_with_input(
            BenchmarkId::new("scanline", size_name),
            &dimensions,
            |b, &dims| {
                b.iter(|| {
                    let mut volume = BenchVolume::new(dims, [1.0, 1.0, 1.0]);
                    ellipsoid.rasterize_scanline(&mut volume).unwrap();
                });
            },
        );
        
        // Supersampled rasterization (2x2x2)
        group.bench_with_input(
            BenchmarkId::new("supersampled_2x", size_name),
            &dimensions,
            |b, &dims| {
                b.iter(|| {
                    let mut volume = BenchVolume::new(dims, [1.0, 1.0, 1.0]);
                    ellipsoid.rasterize_supersampled(&mut volume, 2).unwrap();
                });
            },
        );
    }
    
    group.finish();
}

fn bench_ellipsoid_containment(c: &mut Criterion) {
    let mut group = c.benchmark_group("ellipsoid_containment");
    
    let ellipsoid = OrientedEllipsoid::new(
        Point3::new(0.0, 0.0, 0.0),
        Vector3::new(20.0, 15.0, 10.0),
        Rotation3::from_euler_angles(0.1, 0.2, 0.3),
        100.0,
    ).unwrap();
    
    // Test different point counts
    let point_counts = vec![1000, 10000, 100000];
    
    for count in point_counts {
        // Generate test points
        let points: Vec<Point3<f64>> = (0..count)
            .map(|i| {
                let t = i as f64 / count as f64;
                Point3::new(
                    40.0 * (t * 6.28).cos(),
                    30.0 * (t * 6.28).sin(),
                    20.0 * (t * 12.56).cos(),
                )
            })
            .collect();
        
        group.bench_with_input(
            BenchmarkId::new("single_points", count),
            &points,
            |b, points| {
                b.iter(|| {
                    let mut inside_count = 0;
                    for point in points {
                        if ellipsoid.contains_point(point) {
                            inside_count += 1;
                        }
                    }
                    inside_count
                });
            },
        );
        
        group.bench_with_input(
            BenchmarkId::new("batch_points", count),
            &points,
            |b, points| {
                b.iter(|| {
                    let results = ellipsoid.contains_points_batch(points);
                    results.iter().filter(|&&x| x).count()
                });
            },
        );
    }
    
    group.finish();
}

fn bench_validation_metrics(c: &mut Criterion) {
    use neuro_types::{VolumeComparison, Volume};
    
    let mut group = c.benchmark_group("validation_metrics");
    
    // Mock volume for testing
    struct MockVolume {
        dimensions: [usize; 3],
        data: Vec<f32>,
    }
    
    impl Volume for MockVolume {
        fn dimensions(&self) -> [usize; 3] {
            self.dimensions
        }
        
        fn spacing(&self) -> [f32; 3] {
            [1.0, 1.0, 1.0]
        }
        
        fn origin(&self) -> [f32; 3] {
            [0.0, 0.0, 0.0]
        }
        
        fn get_at_coords(&self, coords: [usize; 3]) -> Option<f32> {
            let idx = coords[2] * self.dimensions[0] * self.dimensions[1]
                    + coords[1] * self.dimensions[0]
                    + coords[0];
            self.data.get(idx).copied()
        }
        
        fn voxel_to_world_matrix(&self) -> Matrix4<f32> {
            Matrix4::identity()
        }
        
        fn dtype_name(&self) -> &str {
            "f32"
        }
    }
    
    let sizes = vec![
        ([32, 32, 32], "32x32x32"),
        ([64, 64, 64], "64x64x64"),
        ([128, 128, 128], "128x128x128"),
    ];
    
    for (dimensions, size_name) in sizes {
        let size = dimensions[0] * dimensions[1] * dimensions[2];
        
        // Create two volumes with some overlap
        let mut data1 = vec![0.0; size];
        let mut data2 = vec![0.0; size];
        
        // Fill central region differently
        let center = [dimensions[0] / 2, dimensions[1] / 2, dimensions[2] / 2];
        let radius_sq = 100.0f32;
        
        for k in 0..dimensions[2] {
            for j in 0..dimensions[1] {
                for i in 0..dimensions[0] {
                    let dx = i as f32 - center[0] as f32;
                    let dy = j as f32 - center[1] as f32;
                    let dz = k as f32 - center[2] as f32;
                    
                    let dist_sq = dx * dx + dy * dy + dz * dz;
                    let idx = k * dimensions[0] * dimensions[1] + j * dimensions[0] + i;
                    
                    if dist_sq < radius_sq {
                        data1[idx] = 100.0;
                        if dist_sq < radius_sq * 0.8 {
                            data2[idx] = 100.0;
                        }
                    }
                }
            }
        }
        
        let volume1 = MockVolume { dimensions, data: data1 };
        let volume2 = MockVolume { dimensions, data: data2 };
        
        group.bench_with_input(
            BenchmarkId::new("metrics_computation", size_name),
            &(volume1, volume2),
            |b, (vol1, vol2)| {
                b.iter(|| {
                    VolumeComparison::compute_metrics(vol1, vol2, 50.0, None).unwrap()
                });
            },
        );
    }
    
    group.finish();
}

fn bench_integration_tests(c: &mut Criterion) {
    let mut group = c.benchmark_group("integration_tests");
    group.sample_size(10); // Reduce sample size for expensive tests
    
    // Create test runner
    let volume_store = Arc::new(TestVolumeStore::new());
    let cpu_provider = Box::new(CpuSliceProvider::new(volume_store));
    let mut runner = EllipsoidTestRunner::new(cpu_provider);
    
    // Get test configurations
    let configs = EllipsoidTestConfig::standard_test_suite();
    
    for (i, config) in configs.iter().take(3).enumerate() { // Only test first 3 configs
        group.bench_with_input(
            BenchmarkId::new("full_test", format!("config_{}", i)),
            config,
            |b, config| {
                b.iter(|| {
                    runner.run_ellipsoid_test(config)
                });
            },
        );
    }
    
    group.finish();
}

criterion_group!(
    benches,
    bench_ellipsoid_rasterization,
    bench_ellipsoid_containment,
    bench_validation_metrics,
    bench_integration_tests
);
criterion_main!(benches);