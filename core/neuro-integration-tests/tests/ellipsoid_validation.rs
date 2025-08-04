//! Integration tests using ellipsoid ground truth for coordinate transformation validation
//!
//! NOTE: This test file is temporarily disabled while the integration test framework
//! is updated to work with the current API

// TODO: Re-enable when modules are updated for current API - all content commented out
/*
use neuro_integration_tests::{
    EllipsoidTestConfig, EllipsoidTestRunner, EllipsoidTestResults,
    VisualDebugConfig, SliceOrientation,
};
use neuro_cpu::CpuSliceProvider;
use neuro_core::TestVolumeStore;
use std::sync::Arc;

#[test]
fn test_ellipsoid_isotropic_volumes() {
    // Create CPU provider
    let volume_store = Arc::new(TestVolumeStore::new());
    let cpu_provider = Box::new(CpuSliceProvider::new(volume_store.clone()));

    // Create test runner
    let mut runner = EllipsoidTestRunner::new(cpu_provider);

    // Get standard test suite
    let test_configs = EllipsoidTestConfig::standard_test_suite();

    // Run only the isotropic test
    let isotropic_config = &test_configs[0];
    let results = runner.run_ellipsoid_test(isotropic_config);

    // Check results
    let summary = results.summary();
    assert!(summary.passed > 0, "At least one test should pass");
    assert!(summary.average_dice > 0.95,
        "Average Dice coefficient should be > 0.95 for isotropic volumes, got {}",
        summary.average_dice);

    results.print_detailed();
}

#[test]
fn test_ellipsoid_anisotropic_volumes() {
    // Create CPU provider
    let volume_store = Arc::new(TestVolumeStore::new());
    let cpu_provider = Box::new(CpuSliceProvider::new(volume_store.clone()));

    // Create test runner
    let mut runner = EllipsoidTestRunner::new(cpu_provider);

    // Get standard test suite
    let test_configs = EllipsoidTestConfig::standard_test_suite();

    // Run the anisotropic test
    let anisotropic_config = &test_configs[1];
    let results = runner.run_ellipsoid_test(anisotropic_config);

    // Check results - slightly relaxed tolerance for anisotropic
    let summary = results.summary();
    assert!(summary.passed > 0, "At least one test should pass");
    assert!(summary.average_dice > 0.90,
        "Average Dice coefficient should be > 0.90 for anisotropic volumes, got {}",
        summary.average_dice);

    results.print_detailed();
}

#[test]
fn test_ellipsoid_extreme_aspect_ratios() {
    // Create CPU provider
    let volume_store = Arc::new(TestVolumeStore::new());
    let cpu_provider = Box::new(CpuSliceProvider::new(volume_store.clone()));

    // Create test runner
    let mut runner = EllipsoidTestRunner::new(cpu_provider);

    // Get standard test suite
    let test_configs = EllipsoidTestConfig::standard_test_suite();

    // Run the extreme aspect ratio test
    let extreme_config = &test_configs[2];
    let results = runner.run_ellipsoid_test(extreme_config);

    // Check results - more relaxed for extreme shapes
    let summary = results.summary();
    assert!(summary.average_dice > 0.85,
        "Average Dice coefficient should be > 0.85 for extreme aspect ratios, got {}",
        summary.average_dice);
}

#[test]
fn test_ellipsoid_small_objects() {
    // Create CPU provider
    let volume_store = Arc::new(TestVolumeStore::new());
    let cpu_provider = Box::new(CpuSliceProvider::new(volume_store.clone()));

    // Create test runner
    let mut runner = EllipsoidTestRunner::new(cpu_provider);

    // Get standard test suite
    let test_configs = EllipsoidTestConfig::standard_test_suite();

    // Run the small ellipsoid test
    let small_config = &test_configs[5];
    let results = runner.run_ellipsoid_test(small_config);

    // Check results - very relaxed for tiny objects
    let summary = results.summary();
    assert!(summary.average_dice > 0.70,
        "Average Dice coefficient should be > 0.70 for small objects, got {}",
        summary.average_dice);
}

#[test]
#[ignore] // This test is expensive, run with --ignored flag
fn test_ellipsoid_random_configurations() {
    // Create CPU provider
    let volume_store = Arc::new(TestVolumeStore::new());
    let cpu_provider = Box::new(CpuSliceProvider::new(volume_store.clone()));

    // Create test runner
    let mut runner = EllipsoidTestRunner::new(cpu_provider);

    // Generate random tests
    let random_configs = EllipsoidTestConfig::generate_random_tests(42, 20);

    // Run all random tests
    let results = runner.run_test_suite(random_configs);

    // Check overall results
    let summary = results.summary();
    println!("\nRandom test summary:");
    println!("  Total: {}", summary.total_tests);
    println!("  Passed: {}", summary.passed);
    println!("  Failed: {}", summary.failed);
    println!("  Average Dice: {:.4}", summary.average_dice);

    // At least 80% should pass with reasonable tolerances
    let pass_rate = summary.passed as f64 / summary.total_tests as f64;
    assert!(pass_rate > 0.80,
        "At least 80% of random tests should pass, got {:.1}%",
        pass_rate * 100.0);
}

#[test]
fn test_ellipsoid_edge_cases() {
    // Create CPU provider
    let volume_store = Arc::new(TestVolumeStore::new());
    let cpu_provider = Box::new(CpuSliceProvider::new(volume_store.clone()));

    // Create test runner
    let mut runner = EllipsoidTestRunner::new(cpu_provider);

    // Get edge case tests
    let edge_configs = EllipsoidTestConfig::edge_case_tests();

    // Run all edge cases
    let results = runner.run_test_suite(edge_configs);

    // Print results
    results.print_detailed();

    // Check that we handle edge cases gracefully
    let summary = results.summary();
    assert!(summary.total_tests > 0, "Should have run edge case tests");
}

// GPU comparison test - only runs if GPU provider is available
#[cfg(feature = "gpu")]
#[test]
fn test_ellipsoid_cpu_gpu_consistency() {
    use render_loop::GpuSliceAdapter;

    // Create providers
    let volume_store = Arc::new(TestVolumeStore::new());
    let cpu_provider = Box::new(CpuSliceProvider::new(volume_store.clone()));

    // Create GPU provider (this would need proper initialization)
    // For now, this is a placeholder showing the intended usage
    let gpu_provider = create_gpu_provider(volume_store.clone());

    // Create test runner with GPU
    let mut runner = EllipsoidTestRunner::with_gpu(cpu_provider, gpu_provider);

    // Run a subset of tests
    let test_configs = vec![
        EllipsoidTestConfig::standard_test_suite()[0].clone(), // Isotropic
        EllipsoidTestConfig::standard_test_suite()[1].clone(), // Anisotropic
    ];

    let results = runner.run_test_suite(test_configs);

    // Check CPU/GPU consistency
    for result in &results.results {
        if let Some(gpu_time) = result.gpu_time_ms {
            println!("CPU: {:.2} ms, GPU: {:.2} ms, Speedup: {:.2}x",
                result.cpu_time_ms, gpu_time, result.cpu_time_ms / gpu_time);
        }
    }

    // All tests should pass with tight tolerances
    let summary = results.summary();
    assert_eq!(summary.failed, 0, "All CPU/GPU comparisons should pass");
}

#[cfg(feature = "gpu")]
fn create_gpu_provider(volume_store: Arc<TestVolumeStore>) -> Box<dyn neuro_types::SliceProvider> {
    // This would need proper GPU initialization
    // Placeholder for now
    todo!("GPU provider initialization")
}

#[test]
#[ignore] // Run manually to generate visual debug reports
fn test_ellipsoid_visual_debug_generation() {
    // Create CPU provider
    let volume_store = Arc::new(TestVolumeStore::new());
    let cpu_provider = Box::new(CpuSliceProvider::new(volume_store.clone()));

    // Create test runner
    let mut runner = EllipsoidTestRunner::new(cpu_provider);

    // Get a subset of test configurations for visual debugging
    let test_configs = vec![
        EllipsoidTestConfig::standard_test_suite()[0].clone(), // Isotropic
        EllipsoidTestConfig::standard_test_suite()[1].clone(), // Anisotropic
        EllipsoidTestConfig::standard_test_suite()[2].clone(), // Extreme aspect ratio
    ];

    // Configure visual debug output
    let debug_config = VisualDebugConfig {
        output_dir: "ellipsoid_debug_report".to_string(),
        slice_orientations: vec![
            SliceOrientation::Axial,
            SliceOrientation::Coronal,
            SliceOrientation::Sagittal,
        ],
        slices_per_orientation: 3, // Generate fewer slices for faster testing
        image_size: (256, 256),
        generate_difference_maps: true,
        ..Default::default()
    };

    // Run tests with visual debug generation
    match runner.run_test_suite_with_visual_debug(test_configs, Some(debug_config)) {
        Ok((results, report_path)) => {
            println!("\n=== Visual Debug Report Generated ===");
            println!("Report path: {}", report_path);
            println!("Open {} in a web browser to view the interactive report", report_path);

            let summary = results.summary();
            println!("\nTest Summary:");
            println!("  Total: {}", summary.total_tests);
            println!("  Passed: {}", summary.passed);
            println!("  Failed: {}", summary.failed);
            println!("  Average Dice: {:.4}", summary.average_dice);

            // Verify the report was generated
            assert!(std::path::Path::new(&report_path).exists(),
                "HTML report should be generated");

            // Verify supporting files exist
            let output_dir = std::path::Path::new(&report_path).parent().unwrap();
            assert!(output_dir.join("debug_report.css").exists(),
                "CSS file should be generated");
            assert!(output_dir.join("debug_report.js").exists(),
                "JavaScript file should be generated");
        }
        Err(e) => {
            panic!("Failed to generate visual debug report: {}", e);
        }
    }
}

#[test]
fn test_visual_debug_config_validation() {
    // Test that visual debug configuration works correctly
    let config = VisualDebugConfig {
        output_dir: "test_output".to_string(),
        slice_orientations: vec![SliceOrientation::Axial],
        slices_per_orientation: 5,
        image_size: (128, 128),
        generate_difference_maps: false,
        ..Default::default()
    };

    // Verify configuration values
    assert_eq!(config.output_dir, "test_output");
    assert_eq!(config.slice_orientations.len(), 1);
    assert_eq!(config.slices_per_orientation, 5);
    assert_eq!(config.image_size, (128, 128));
    assert!(!config.generate_difference_maps);
}*/
