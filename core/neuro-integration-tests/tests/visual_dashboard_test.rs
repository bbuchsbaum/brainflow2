//! Test for visual dashboard generation

use neuro_integration_tests::{SimpleVisualDashboard, SimpleTestRunner};
use neuro_integration_tests::simple_visual_dashboard::SimpleTestResult;
use neuro_types::OverlapMetrics;

#[test]
fn test_generate_visual_dashboard() {
    // Run some basic tests to get results
    let test_result = SimpleTestRunner::run_basic_test().unwrap();
    
    // Create some example test results with varying metrics
    let test_results = vec![
        // Perfect result
        SimpleTestResult {
            test_name: "Isotropic Sphere".to_string(),
            metrics: OverlapMetrics {
                dice_coefficient: 0.985,
                jaccard_index: 0.971,
                volume_difference_percent: 1.5,
                volume_difference_mm3: 12.3,
                hausdorff_distance_mm: 0.8,
                hausdorff_95_percentile_mm: 0.6,
                average_symmetric_surface_distance_mm: 0.4,
                center_of_mass_distance_mm: 0.2,
                max_absolute_difference: 0.05,
                contains_nan: false,
                contains_inf: false,
            },
            passed: true,
            execution_time_ms: 45,
        },
        // Good result
        SimpleTestResult {
            test_name: "Anisotropic Ellipsoid".to_string(),
            metrics: OverlapMetrics {
                dice_coefficient: 0.923,
                jaccard_index: 0.856,
                volume_difference_percent: 7.8,
                volume_difference_mm3: 45.6,
                hausdorff_distance_mm: 2.3,
                hausdorff_95_percentile_mm: 1.8,
                average_symmetric_surface_distance_mm: 1.1,
                center_of_mass_distance_mm: 0.7,
                max_absolute_difference: 0.12,
                contains_nan: false,
                contains_inf: false,
            },
            passed: true,
            execution_time_ms: 62,
        },
        // Marginal result  
        SimpleTestResult {
            test_name: "Extreme Aspect Ratio".to_string(),
            metrics: OverlapMetrics {
                dice_coefficient: 0.867,
                jaccard_index: 0.765,
                volume_difference_percent: 13.2,
                volume_difference_mm3: 78.9,
                hausdorff_distance_mm: 3.5,
                hausdorff_95_percentile_mm: 2.8,
                average_symmetric_surface_distance_mm: 1.9,
                center_of_mass_distance_mm: 1.2,
                max_absolute_difference: 0.18,
                contains_nan: false,
                contains_inf: false,
            },
            passed: true,
            execution_time_ms: 89,
        },
        // Failed result
        SimpleTestResult {
            test_name: "Small Object Test".to_string(),
            metrics: OverlapMetrics {
                dice_coefficient: 0.742,
                jaccard_index: 0.590,
                volume_difference_percent: 25.8,
                volume_difference_mm3: 123.4,
                hausdorff_distance_mm: 5.2,
                hausdorff_95_percentile_mm: 4.3,
                average_symmetric_surface_distance_mm: 3.1,
                center_of_mass_distance_mm: 2.1,
                max_absolute_difference: 0.35,
                contains_nan: false,
                contains_inf: false,
            },
            passed: false,
            execution_time_ms: 112,
        },
        // The actual test result we ran - convert from lib_simple type
        SimpleTestResult {
            test_name: test_result.test_name,
            metrics: test_result.metrics,
            passed: test_result.passed,
            execution_time_ms: test_result.execution_time_ms,
        },
    ];
    
    // Create dashboard generator
    let dashboard = SimpleVisualDashboard::new("test_dashboard_output".to_string());
    
    // Generate the dashboard
    let html_path = dashboard.generate_dashboard(&test_results).unwrap();
    
    // Verify files were created
    assert!(std::path::Path::new(&html_path).exists(), "HTML file should exist");
    assert!(std::path::Path::new("test_dashboard_output/dashboard.css").exists(), "CSS file should exist");
    assert!(std::path::Path::new("test_dashboard_output/dashboard.js").exists(), "JS file should exist");
    
    println!("\n✅ Visual dashboard generated successfully!");
    println!("📊 Dashboard location: {}", html_path);
    println!("🌐 Open {} in a web browser to view the results", html_path);
}

#[test]
#[ignore] // Run with --ignored to generate dashboard in custom location
fn test_generate_dashboard_with_custom_output() {
    // This test allows specifying a custom output directory via environment variable
    let output_dir = std::env::var("DASHBOARD_OUTPUT")
        .unwrap_or_else(|_| "custom_dashboard_output".to_string());
    
    // Create test results
    let test_results = vec![
        SimpleTestResult {
            test_name: "Custom Test 1".to_string(),
            metrics: OverlapMetrics {
                dice_coefficient: 0.95,
                jaccard_index: 0.90,
                volume_difference_percent: 5.0,
                volume_difference_mm3: 10.5,
                hausdorff_distance_mm: 1.2,
                hausdorff_95_percentile_mm: 1.0,
                average_symmetric_surface_distance_mm: 0.8,
                center_of_mass_distance_mm: 0.5,
                max_absolute_difference: 0.1,
                contains_nan: false,
                contains_inf: false,
            },
            passed: true,
            execution_time_ms: 50,
        },
    ];
    
    let dashboard = SimpleVisualDashboard::new(output_dir.clone());
    let html_path = dashboard.generate_dashboard(&test_results).unwrap();
    
    println!("\n📊 Custom dashboard generated at: {}", html_path);
}