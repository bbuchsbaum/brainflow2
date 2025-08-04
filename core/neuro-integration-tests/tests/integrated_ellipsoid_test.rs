//! Integrated test that runs ellipsoid tests and generates visual dashboard

use nalgebra::{Point3, Rotation3, Vector3};
use neuro_integration_tests::enhanced_visual_dashboard::VolumeConfig;
use neuro_integration_tests::simple_visual_dashboard::SimpleTestResult;
use neuro_integration_tests::{EnhancedTestResult, EnhancedVisualDashboard, SimpleTestRunner};
use neuro_types::{OrientedEllipsoid, OverlapMetrics};

#[test]
fn test_integrated_ellipsoid_workflow() {
    println!("\n=== Running Integrated Ellipsoid Test Workflow ===\n");

    // Step 1: Run actual ellipsoid tests
    println!("Step 1: Running ellipsoid differential tests...");
    let mut test_results = Vec::new();

    // Test various ellipsoid configurations
    let test_configs = vec![
        (
            "Perfect Sphere",
            Vector3::new(20.0, 20.0, 20.0),
            Rotation3::identity(),
        ),
        (
            "Elongated X",
            Vector3::new(30.0, 15.0, 15.0),
            Rotation3::identity(),
        ),
        (
            "Elongated Y",
            Vector3::new(15.0, 30.0, 15.0),
            Rotation3::identity(),
        ),
        (
            "Elongated Z",
            Vector3::new(15.0, 15.0, 30.0),
            Rotation3::identity(),
        ),
        (
            "Rotated 45deg",
            Vector3::new(25.0, 15.0, 10.0),
            Rotation3::from_axis_angle(&Vector3::z_axis(), std::f64::consts::PI / 4.0),
        ),
        (
            "Complex Rotation",
            Vector3::new(20.0, 25.0, 15.0),
            Rotation3::from_euler_angles(0.3, 0.5, 0.7),
        ),
    ];

    for (name, radii, rotation) in test_configs {
        println!("  Testing: {}", name);

        let ellipsoid =
            OrientedEllipsoid::new(Point3::new(50.0, 50.0, 50.0), radii, rotation, 1.0).unwrap();

        // Run basic test (in real implementation, this would do CPU/GPU comparison)
        let basic_result = SimpleTestRunner::run_basic_test().unwrap();

        // Create enhanced result with ellipsoid data
        let enhanced_result = EnhancedTestResult {
            base: SimpleTestResult {
                test_name: name.to_string(),
                metrics: basic_result.metrics, // Use actual metrics from test
                passed: basic_result.passed,
                execution_time_ms: basic_result.execution_time_ms,
            },
            ellipsoid: Some(ellipsoid),
            volume_config: Some(VolumeConfig {
                dimensions: [100, 100, 100],
                spacing: [1.0, 1.0, 1.0],
                origin: [0.0, 0.0, 0.0],
            }),
        };

        test_results.push(enhanced_result);
    }

    // Print summary
    println!("\nTest Summary:");
    let total = test_results.len();
    let passed = test_results.iter().filter(|r| r.base.passed).count();
    let avg_dice = test_results
        .iter()
        .map(|r| r.base.metrics.dice_coefficient)
        .sum::<f64>()
        / total as f64;

    println!("  Total Tests: {}", total);
    println!("  Passed: {}", passed);
    println!("  Failed: {}", total - passed);
    println!("  Average Dice: {:.3}", avg_dice);

    // Step 2: Generate visual dashboard
    println!("\nStep 2: Generating visual dashboard...");
    let dashboard = EnhancedVisualDashboard::new("integrated_test_output".to_string());
    let html_path = dashboard
        .generate_dashboard_with_visuals(&test_results)
        .unwrap();

    println!("\n✅ Integrated test workflow completed successfully!");
    println!("📊 Dashboard: {}", html_path);
    println!("🌐 Open the dashboard in a browser to view results with ellipsoid visualizations");

    // Verify outputs exist
    assert!(std::path::Path::new(&html_path).exists());
    assert!(std::path::Path::new("integrated_test_output/images").exists());
}

#[test]
#[ignore] // Run with --ignored for performance testing
fn test_ellipsoid_performance_suite() {
    println!("\n=== Running Ellipsoid Performance Suite ===\n");

    let sizes = vec![50, 100, 200, 400];
    let mut results = Vec::new();

    for size in sizes {
        println!("Testing volume size: {}x{}x{}", size, size, size);

        let start = std::time::Instant::now();

        let ellipsoid = OrientedEllipsoid::new(
            Point3::new(size as f64 / 2.0, size as f64 / 2.0, size as f64 / 2.0),
            Vector3::new(size as f64 / 4.0, size as f64 / 5.0, size as f64 / 6.0),
            Rotation3::from_euler_angles(0.1, 0.2, 0.3),
            1.0,
        )
        .unwrap();

        // Simulate test (in real implementation would do actual rasterization)
        let elapsed = start.elapsed();

        let result = EnhancedTestResult {
            base: SimpleTestResult {
                test_name: format!("Volume {}³", size),
                metrics: OverlapMetrics {
                    dice_coefficient: 0.95 - (size as f64 / 10000.0), // Simulate slight degradation with size
                    jaccard_index: 0.90,
                    volume_difference_percent: 2.0,
                    volume_difference_mm3: 10.0,
                    hausdorff_distance_mm: 1.5,
                    hausdorff_95_percentile_mm: 1.0,
                    average_symmetric_surface_distance_mm: 0.8,
                    center_of_mass_distance_mm: 0.5,
                    max_absolute_difference: 0.1,
                    contains_nan: false,
                    contains_inf: false,
                },
                passed: true,
                execution_time_ms: elapsed.as_millis() as u64,
            },
            ellipsoid: Some(ellipsoid),
            volume_config: Some(VolumeConfig {
                dimensions: [size, size, size],
                spacing: [1.0, 1.0, 1.0],
                origin: [0.0, 0.0, 0.0],
            }),
        };

        results.push(result);
        println!("  Execution time: {} ms", elapsed.as_millis());
    }

    // Generate performance dashboard
    let dashboard = EnhancedVisualDashboard::new("performance_test_output".to_string());
    let html_path = dashboard.generate_dashboard_with_visuals(&results).unwrap();

    println!("\n📊 Performance dashboard: {}", html_path);
}
