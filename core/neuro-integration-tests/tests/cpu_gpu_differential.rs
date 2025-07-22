/* //! CPU/GPU differential tests
//! 
//! These tests verify that the CPU and GPU implementations produce
//! consistent results across various slice extraction scenarios.

use neuro_integration_tests::{
    ComparisonHarness, HarnessBuilder, TestSliceGenerator, 
    TestLayerGenerator, TestRequestGenerator, IntegrationVolumeStore,
};
use neuro_cpu::CpuSlicer;
use neuro_types::testing::DiffTestConfig;
use nalgebra::Matrix4;
use std::sync::Arc;

#[test]
fn test_basic_axial_slices() {
    // Create test volume store with standard volumes
    let volume_store = Arc::new(IntegrationVolumeStore::with_standard_volumes()
        .expect("Failed to create test volumes"));
    
    // Create CPU provider
    let cpu_provider = Box::new(CpuSlicer::new(volume_store.clone()));
    
    // TODO: Create GPU provider when available
    // For now, use a second CPU provider to test the framework
    let gpu_provider = Box::new(CpuSlicer::new(volume_store.clone()));
    
    // Create harness with reasonable tolerances
    let harness = HarnessBuilder::new()
        .with_cpu_provider(cpu_provider)
        .with_gpu_provider(gpu_provider)
        .with_tolerance(0, 0.0) // Expect exact match for CPU vs CPU
        .build()
        .expect("Failed to create harness");
    
    // Test basic axial slices
    let test_slices = vec![
        ("axial_center", TestSliceGenerator::axial_slice(0.0, [128.0, 128.0], [128, 128])),
        ("axial_top", TestSliceGenerator::axial_slice(50.0, [128.0, 128.0], [128, 128])),
        ("axial_bottom", TestSliceGenerator::axial_slice(-50.0, [128.0, 128.0], [128, 128])),
    ];
    
    let mut tests = Vec::new();
    for (name, slice) in test_slices {
        let layer = TestLayerGenerator::simple_layer(0, Matrix4::identity());
        let request = TestRequestGenerator::single_layer(slice, layer);
        tests.push((name, request));
    }
    
    let results = harness.run_test_suite(tests);
    results.print_summary();
    
    assert_eq!(results.failed, 0, "Some tests failed");
}

#[test]
fn test_oblique_slices() {
    let volume_store = Arc::new(IntegrationVolumeStore::with_standard_volumes()
        .expect("Failed to create test volumes"));
    
    let cpu_provider = Box::new(CpuSlicer::new(volume_store.clone()));
    let gpu_provider = Box::new(CpuSlicer::new(volume_store.clone()));
    
    let harness = HarnessBuilder::new()
        .with_cpu_provider(cpu_provider)
        .with_gpu_provider(gpu_provider)
        .with_tolerance(2, 0.02) // Allow small differences for interpolation
        .build()
        .expect("Failed to create harness");
    
    use std::f32::consts::PI;
    let test_slices = vec![
        ("oblique_45deg", TestSliceGenerator::oblique_slice(
            [0.0, 0.0, 0.0], PI/4.0, 0.0, [128.0, 128.0], [128, 128]
        )),
        ("oblique_complex", TestSliceGenerator::oblique_slice(
            [10.0, -5.0, 15.0], PI/6.0, PI/3.0, [100.0, 100.0], [100, 100]
        )),
    ];
    
    let mut tests = Vec::new();
    for (name, slice) in test_slices {
        let layer = TestLayerGenerator::simple_layer(1, Matrix4::identity());
        let request = TestRequestGenerator::single_layer(slice, layer);
        tests.push((name, request));
    }
    
    let results = harness.run_test_suite(tests);
    results.print_summary();
    
    assert_eq!(results.failed, 0, "Some oblique slice tests failed");
}

#[test]
fn test_multi_layer_compositing() {
    let volume_store = Arc::new(IntegrationVolumeStore::with_standard_volumes()
        .expect("Failed to create test volumes"));
    
    let cpu_provider = Box::new(CpuSlicer::new(volume_store.clone()));
    let gpu_provider = Box::new(CpuSlicer::new(volume_store.clone()));
    
    let harness = HarnessBuilder::new()
        .with_cpu_provider(cpu_provider)
        .with_gpu_provider(gpu_provider)
        .with_tolerance(1, 0.01)
        .build()
        .expect("Failed to create harness");
    
    // Test multi-layer compositing
    let slice = TestSliceGenerator::axial_slice(0.0, [128.0, 128.0], [128, 128]);
    
    // Create anatomical + overlay
    let anat_layer = TestLayerGenerator::windowed_layer(
        0, Matrix4::identity(), 0.0, 1000.0
    );
    let overlay_layer = TestLayerGenerator::overlay_layer(
        2, Matrix4::identity(), 400.0, 800.0, neuro_types::Colormap::Hot
    );
    
    let request = TestRequestGenerator::multi_layer(slice, vec![anat_layer, overlay_layer]);
    
    let result = harness.run_test(&request, "multi_layer_composite")
        .expect("Test failed to run");
    
    assert!(result.passed, "Multi-layer compositing test failed");
}

#[test]
fn test_different_interpolation_methods() {
    let volume_store = Arc::new(IntegrationVolumeStore::with_standard_volumes()
        .expect("Failed to create test volumes"));
    
    let cpu_provider = Box::new(CpuSlicer::new(volume_store.clone()));
    let gpu_provider = Box::new(CpuSlicer::new(volume_store.clone()));
    
    let harness = HarnessBuilder::new()
        .with_cpu_provider(cpu_provider)
        .with_gpu_provider(gpu_provider)
        .with_tolerance(5, 0.05) // Allow more tolerance for different interpolation
        .build()
        .expect("Failed to create harness");
    
    let interpolation_methods = vec![
        ("nearest", neuro_types::InterpolationMethod::Nearest),
        ("linear", neuro_types::InterpolationMethod::Linear),
        // ("cubic", neuro_types::InterpolationMethod::Cubic), // Not implemented yet
    ];
    
    let mut tests = Vec::new();
    for (name, interp) in interpolation_methods {
        let mut slice = TestSliceGenerator::oblique_slice(
            [5.0, -10.0, 20.0], 0.3, 0.6, [128.0, 128.0], [128, 128]
        );
        slice.interp = interp;
        
        let layer = TestLayerGenerator::simple_layer(3, Matrix4::identity());
        let request = TestRequestGenerator::single_layer(slice, layer);
        tests.push((name, request));
    }
    
    let results = harness.run_test_suite(tests);
    results.print_summary();
    
    assert_eq!(results.failed, 0, "Some interpolation tests failed");
}*/
