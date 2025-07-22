//! Performance benchmarks comparing CPU and GPU slice extraction

use criterion::{black_box, criterion_group, criterion_main, Criterion};
use neuro_integration_tests::{
    TestSliceGenerator, TestLayerGenerator, TestRequestGenerator,
    IntegrationVolumeStore,
};
use neuro_cpu::CpuSlicer;
use nalgebra::Matrix4;
use std::sync::Arc;

fn benchmark_axial_slices(c: &mut Criterion) {
    // Setup volume store
    let volume_store = Arc::new(IntegrationVolumeStore::with_standard_volumes()
        .expect("Failed to create test volumes"));
    
    let cpu_slicer = CpuSlicer::new(volume_store.clone());
    
    // Create test requests
    let slice_256 = TestSliceGenerator::axial_slice(0.0, [256.0, 256.0], [256, 256]);
    let slice_512 = TestSliceGenerator::axial_slice(0.0, [256.0, 256.0], [512, 512]);
    let slice_1024 = TestSliceGenerator::axial_slice(0.0, [256.0, 256.0], [1024, 1024]);
    
    let layer = TestLayerGenerator::simple_layer(0, Matrix4::identity());
    
    let request_256 = TestRequestGenerator::single_layer(slice_256, layer.clone());
    let request_512 = TestRequestGenerator::single_layer(slice_512, layer.clone());
    let request_1024 = TestRequestGenerator::single_layer(slice_1024, layer.clone());
    
    let mut group = c.benchmark_group("axial_slices");
    
    group.bench_function("cpu_256x256", |b| {
        b.iter(|| {
            let result = cpu_slicer.composite_rgba(black_box(&request_256));
            black_box(result);
        });
    });
    
    group.bench_function("cpu_512x512", |b| {
        b.iter(|| {
            let result = cpu_slicer.composite_rgba(black_box(&request_512));
            black_box(result);
        });
    });
    
    group.bench_function("cpu_1024x1024", |b| {
        b.iter(|| {
            let result = cpu_slicer.composite_rgba(black_box(&request_1024));
            black_box(result);
        });
    });
    
    group.finish();
}

fn benchmark_oblique_slices(c: &mut Criterion) {
    let volume_store = Arc::new(IntegrationVolumeStore::with_standard_volumes()
        .expect("Failed to create test volumes"));
    
    let cpu_slicer = CpuSlicer::new(volume_store.clone());
    
    use std::f32::consts::PI;
    
    // Create oblique slices with different complexities
    let simple_oblique = TestSliceGenerator::oblique_slice(
        [0.0, 0.0, 0.0], PI/4.0, 0.0, [256.0, 256.0], [256, 256]
    );
    
    let complex_oblique = TestSliceGenerator::oblique_slice(
        [10.0, -5.0, 15.0], PI/6.0, PI/3.0, [256.0, 256.0], [256, 256]
    );
    
    let layer = TestLayerGenerator::simple_layer(1, Matrix4::identity());
    
    let request_simple = TestRequestGenerator::single_layer(simple_oblique, layer.clone());
    let request_complex = TestRequestGenerator::single_layer(complex_oblique, layer.clone());
    
    let mut group = c.benchmark_group("oblique_slices");
    
    group.bench_function("cpu_simple_oblique", |b| {
        b.iter(|| {
            let result = cpu_slicer.composite_rgba(black_box(&request_simple));
            black_box(result);
        });
    });
    
    group.bench_function("cpu_complex_oblique", |b| {
        b.iter(|| {
            let result = cpu_slicer.composite_rgba(black_box(&request_complex));
            black_box(result);
        });
    });
    
    group.finish();
}

fn benchmark_multi_layer_compositing(c: &mut Criterion) {
    let volume_store = Arc::new(IntegrationVolumeStore::with_standard_volumes()
        .expect("Failed to create test volumes"));
    
    let cpu_slicer = CpuSlicer::new(volume_store.clone());
    
    let slice = TestSliceGenerator::axial_slice(0.0, [256.0, 256.0], [256, 256]);
    
    // Single layer
    let single_layer = TestLayerGenerator::simple_layer(0, Matrix4::identity());
    let request_single = TestRequestGenerator::single_layer(slice.clone(), single_layer);
    
    // Two layers
    let anat_layer = TestLayerGenerator::windowed_layer(
        0, Matrix4::identity(), 0.0, 1000.0
    );
    let overlay_layer = TestLayerGenerator::overlay_layer(
        2, Matrix4::identity(), 400.0, 800.0, neuro_types::Colormap::Hot
    );
    let request_double = TestRequestGenerator::multi_layer(
        slice.clone(), 
        vec![anat_layer.clone(), overlay_layer.clone()]
    );
    
    // Four layers
    let layer3 = TestLayerGenerator::colormap_layer(
        1, Matrix4::identity(), neuro_types::Colormap::Cool, 0.5
    );
    let layer4 = TestLayerGenerator::colormap_layer(
        3, Matrix4::identity(), neuro_types::Colormap::Viridis, 0.3
    );
    let request_quad = TestRequestGenerator::multi_layer(
        slice.clone(),
        vec![anat_layer, overlay_layer, layer3, layer4]
    );
    
    let mut group = c.benchmark_group("multi_layer");
    
    group.bench_function("cpu_1_layer", |b| {
        b.iter(|| {
            let result = cpu_slicer.composite_rgba(black_box(&request_single));
            black_box(result);
        });
    });
    
    group.bench_function("cpu_2_layers", |b| {
        b.iter(|| {
            let result = cpu_slicer.composite_rgba(black_box(&request_double));
            black_box(result);
        });
    });
    
    group.bench_function("cpu_4_layers", |b| {
        b.iter(|| {
            let result = cpu_slicer.composite_rgba(black_box(&request_quad));
            black_box(result);
        });
    });
    
    group.finish();
}

fn benchmark_interpolation_methods(c: &mut Criterion) {
    let volume_store = Arc::new(IntegrationVolumeStore::with_standard_volumes()
        .expect("Failed to create test volumes"));
    
    let cpu_slicer = CpuSlicer::new(volume_store.clone());
    
    // Use an oblique slice to make interpolation differences more apparent
    let mut slice_nearest = TestSliceGenerator::oblique_slice(
        [5.5, -10.3, 20.7], 0.3, 0.6, [256.0, 256.0], [256, 256]
    );
    slice_nearest.interp = neuro_types::InterpolationMethod::Nearest;
    
    let mut slice_linear = slice_nearest.clone();
    slice_linear.interp = neuro_types::InterpolationMethod::Linear;
    
    let layer = TestLayerGenerator::simple_layer(3, Matrix4::identity());
    
    let request_nearest = TestRequestGenerator::single_layer(slice_nearest, layer.clone());
    let request_linear = TestRequestGenerator::single_layer(slice_linear, layer.clone());
    
    let mut group = c.benchmark_group("interpolation");
    
    group.bench_function("cpu_nearest", |b| {
        b.iter(|| {
            let result = cpu_slicer.composite_rgba(black_box(&request_nearest));
            black_box(result);
        });
    });
    
    group.bench_function("cpu_linear", |b| {
        b.iter(|| {
            let result = cpu_slicer.composite_rgba(black_box(&request_linear));
            black_box(result);
        });
    });
    
    group.finish();
}

criterion_group!(
    benches,
    benchmark_axial_slices,
    benchmark_oblique_slices,
    benchmark_multi_layer_compositing,
    benchmark_interpolation_methods
);
criterion_main!(benches);