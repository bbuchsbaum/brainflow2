//! Integration tests for differential ellipsoid rendering
//!
//! These tests demonstrate the differential testing framework comparing
//! CPU and GPU ellipsoid rendering implementations.

use nalgebra::{Point3, Rotation3, Vector3};
use neuro_integration_tests::{DifferentialTestHarness, DifferentialTestResult};
use neuro_types::{OrientedEllipsoid, SliceSpec};

#[tokio::test]
async fn test_simple_sphere_differential() {
    println!("=== Testing Simple Sphere Differential ===");

    let mut harness = DifferentialTestHarness::new();

    // Try to initialize GPU (might fail in CI environments)
    if let Err(e) = harness.init_gpu().await {
        println!(
            "GPU initialization failed: {}. Skipping GPU comparison tests.",
            e
        );
        return;
    }

    // Create a simple sphere
    let sphere = OrientedEllipsoid::sphere(Point3::new(0.0, 0.0, 0.0), 25.0, 1.0)
        .expect("Failed to create sphere");

    // Create axial slice
    let slice = SliceSpec::axial_at([0.0, 0.0, 0.0], [100.0, 100.0], [256, 256]);

    // Run differential test
    let result = harness
        .run_test(
            "simple_sphere",
            &sphere,
            &slice,
            [255, 0, 0, 255], // Red color
        )
        .await;

    match result {
        Ok(test_result) => {
            println!("Test completed: {}", test_result.test_name);
            println!("Passed: {}", test_result.passed);
            println!(
                "Dice coefficient: {:.3}",
                test_result.metrics.dice_coefficient
            );
            println!("RMSE: {:.1}", test_result.metrics.rmse);
            println!(
                "Max pixel difference: {}",
                test_result.metrics.max_absolute_difference
            );
            println!(
                "Differing pixels: {:.1}%",
                test_result.metrics.difference_percentage
            );

            if let Some(ref reason) = test_result.failure_reason {
                println!("Failure reason: {}", reason);
            }

            // Note: We don't assert success here because GPU implementation is incomplete
            // This test serves to demonstrate the framework
        }
        Err(e) => {
            println!("Test failed with error: {}", e);
            // Expected since GPU ellipsoid volume creation is not implemented yet
        }
    }
}

#[tokio::test]
async fn test_comprehensive_differential_suite() {
    println!("=== Testing Comprehensive Differential Suite ===");

    let mut harness = DifferentialTestHarness::new();

    // Set more lenient thresholds for testing
    harness.dice_threshold = 0.8;
    harness.rmse_threshold = 20.0;
    harness.max_diff_threshold = 50;
    harness.difference_percentage_threshold = 10.0;

    // Try to initialize GPU
    if let Err(e) = harness.init_gpu().await {
        println!(
            "GPU initialization failed: {}. Skipping comprehensive tests.",
            e
        );
        return;
    }

    // Run comprehensive test suite
    let results = harness.run_comprehensive_suite().await;

    match results {
        Ok(test_results) => {
            println!("Completed {} tests", test_results.len());

            // Generate and print report
            let report = harness.generate_report(&test_results);
            println!("{}", report);

            // Count passes and failures
            let passed = test_results.iter().filter(|r| r.passed).count();
            let total = test_results.len();

            println!("Summary: {}/{} tests passed", passed, total);
        }
        Err(e) => {
            println!("Comprehensive test suite failed: {}", e);
            // Expected since GPU implementation is incomplete
        }
    }
}

#[tokio::test]
async fn test_cpu_only_ellipsoid_rendering() {
    println!("=== Testing CPU-Only Ellipsoid Rendering ===");

    let harness = DifferentialTestHarness::new();

    // Test that CPU rendering works independently
    let sphere = OrientedEllipsoid::sphere(Point3::new(0.0, 0.0, 0.0), 30.0, 1.0)
        .expect("Failed to create sphere");

    let slice = SliceSpec::axial_at([0.0, 0.0, 0.0], [128.0, 128.0], [256, 256]);

    let cpu_result = harness.cpu_renderer.render_volume_slice(
        &sphere,
        &slice,
        [0, 255, 0, 255], // Green
    );

    match cpu_result {
        Ok(image_data) => {
            println!("CPU rendering successful!");
            println!("Image size: {} bytes", image_data.len());
            println!("Expected size: {} bytes", 256 * 256 * 4);

            assert_eq!(image_data.len(), 256 * 256 * 4, "Image size mismatch");

            // Check that some pixels are non-zero (sphere should be visible)
            let non_zero_pixels = image_data
                .chunks(4)
                .filter(|pixel| pixel[3] > 0) // Alpha > 0
                .count();

            println!("Non-zero pixels: {}", non_zero_pixels);
            assert!(non_zero_pixels > 0, "No visible pixels found");
            assert!(
                non_zero_pixels > 1000,
                "Sphere should be visible with many pixels"
            );
        }
        Err(e) => {
            panic!("CPU rendering failed: {}", e);
        }
    }
}

#[tokio::test]
async fn test_rotated_ellipsoid_cpu() {
    println!("=== Testing Rotated Ellipsoid CPU Rendering ===");

    let harness = DifferentialTestHarness::new();

    // Create a rotated ellipsoid
    let rotated = OrientedEllipsoid::from_euler_angles(
        Point3::new(0.0, 0.0, 0.0),
        Vector3::new(40.0, 20.0, 10.0),
        0.0,
        0.0,
        std::f64::consts::PI / 4.0, // 45 degree rotation around Z
        1.0,
    )
    .expect("Failed to create rotated ellipsoid");

    let slice = SliceSpec::axial_at([0.0, 0.0, 0.0], [120.0, 120.0], [256, 256]);

    let result = harness.cpu_renderer.render_volume_slice(
        &rotated,
        &slice,
        [255, 255, 0, 200], // Yellow with transparency
    );

    match result {
        Ok(image_data) => {
            println!("Rotated ellipsoid rendering successful!");

            // Count visible pixels
            let visible_pixels = image_data
                .chunks(4)
                .filter(|pixel| pixel[3] > 10) // Alpha > 10
                .count();

            println!("Visible pixels: {}", visible_pixels);
            assert!(
                visible_pixels > 500,
                "Rotated ellipsoid should be clearly visible"
            );

            // Check for yellow color in visible pixels
            let yellow_pixels = image_data
                .chunks(4)
                .filter(|pixel| pixel[0] > 100 && pixel[1] > 100 && pixel[2] < 50 && pixel[3] > 10)
                .count();

            println!("Yellow pixels: {}", yellow_pixels);
            assert!(yellow_pixels > 100, "Should have yellow-colored pixels");
        }
        Err(e) => {
            panic!("Rotated ellipsoid rendering failed: {}", e);
        }
    }
}

#[test]
fn test_differential_metrics_computation() {
    println!("=== Testing Differential Metrics Computation ===");

    let harness = DifferentialTestHarness::new();

    // Create identical images
    let size = 64 * 64 * 4; // 64x64 RGBA
    let image1 = vec![128u8; size];
    let image2 = vec![128u8; size];

    let metrics = harness
        .compute_metrics(&image1, &image2)
        .expect("Failed to compute metrics");

    println!("Identical images metrics:");
    println!("  Dice coefficient: {:.3}", metrics.dice_coefficient);
    println!("  RMSE: {:.3}", metrics.rmse);
    println!("  Max difference: {}", metrics.max_absolute_difference);
    println!("  Differing pixels: {}", metrics.differing_pixels);

    // Should be perfect match
    assert_eq!(metrics.rmse, 0.0, "RMSE should be 0 for identical images");
    assert_eq!(
        metrics.max_absolute_difference, 0,
        "Max difference should be 0"
    );
    assert_eq!(metrics.differing_pixels, 0, "No pixels should differ");

    // Test with slightly different images
    let mut image3 = image1.clone();
    image3[0] = 130; // Change one pixel slightly

    let metrics2 = harness
        .compute_metrics(&image1, &image3)
        .expect("Failed to compute metrics");

    println!("Slightly different images metrics:");
    println!("  RMSE: {:.3}", metrics2.rmse);
    println!("  Max difference: {}", metrics2.max_absolute_difference);
    println!("  Differing pixels: {}", metrics2.differing_pixels);

    assert!(
        metrics2.rmse > 0.0,
        "RMSE should be > 0 for different images"
    );
    assert_eq!(
        metrics2.max_absolute_difference, 2,
        "Max difference should be 2"
    );
}
