//! Test for enhanced visual dashboard with ellipsoid visualizations

use nalgebra::{Point3, Rotation3, Vector3};
use neuro_integration_tests::enhanced_visual_dashboard::VolumeConfig;
use neuro_integration_tests::simple_visual_dashboard::SimpleTestResult;
use neuro_integration_tests::{EnhancedTestResult, EnhancedVisualDashboard};
use neuro_types::{OrientedEllipsoid, OverlapMetrics};

#[test]
fn test_generate_enhanced_dashboard() {
    // Create test results with ellipsoid data
    let test_results = vec![
        // Perfect sphere
        EnhancedTestResult {
            base: SimpleTestResult {
                test_name: "Perfect Sphere".to_string(),
                metrics: OverlapMetrics {
                    dice_coefficient: 0.995,
                    jaccard_index: 0.990,
                    volume_difference_percent: 0.5,
                    volume_difference_mm3: 2.3,
                    hausdorff_distance_mm: 0.3,
                    hausdorff_95_percentile_mm: 0.2,
                    average_symmetric_surface_distance_mm: 0.1,
                    center_of_mass_distance_mm: 0.05,
                    max_absolute_difference: 0.02,
                    contains_nan: false,
                    contains_inf: false,
                },
                passed: true,
                execution_time_ms: 25,
            },
            ellipsoid: Some(
                OrientedEllipsoid::new(
                    Point3::new(50.0, 50.0, 50.0),
                    Vector3::new(20.0, 20.0, 20.0),
                    Rotation3::identity(),
                    1.0,
                )
                .unwrap(),
            ),
            volume_config: Some(VolumeConfig {
                dimensions: [100, 100, 100],
                spacing: [1.0, 1.0, 1.0],
                origin: [0.0, 0.0, 0.0],
            }),
        },
        // Elongated ellipsoid
        EnhancedTestResult {
            base: SimpleTestResult {
                test_name: "Elongated Ellipsoid".to_string(),
                metrics: OverlapMetrics {
                    dice_coefficient: 0.912,
                    jaccard_index: 0.839,
                    volume_difference_percent: 8.7,
                    volume_difference_mm3: 56.2,
                    hausdorff_distance_mm: 2.8,
                    hausdorff_95_percentile_mm: 2.1,
                    average_symmetric_surface_distance_mm: 1.4,
                    center_of_mass_distance_mm: 0.9,
                    max_absolute_difference: 0.15,
                    contains_nan: false,
                    contains_inf: false,
                },
                passed: true,
                execution_time_ms: 45,
            },
            ellipsoid: Some(
                OrientedEllipsoid::new(
                    Point3::new(50.0, 50.0, 50.0),
                    Vector3::new(35.0, 20.0, 10.0),
                    Rotation3::from_axis_angle(&Vector3::y_axis(), std::f64::consts::PI / 6.0),
                    1.0,
                )
                .unwrap(),
            ),
            volume_config: Some(VolumeConfig {
                dimensions: [100, 100, 100],
                spacing: [1.0, 1.0, 1.0],
                origin: [0.0, 0.0, 0.0],
            }),
        },
        // Rotated ellipsoid with lower accuracy
        EnhancedTestResult {
            base: SimpleTestResult {
                test_name: "Complex Rotation".to_string(),
                metrics: OverlapMetrics {
                    dice_coefficient: 0.823,
                    jaccard_index: 0.699,
                    volume_difference_percent: 17.3,
                    volume_difference_mm3: 112.5,
                    hausdorff_distance_mm: 4.5,
                    hausdorff_95_percentile_mm: 3.8,
                    average_symmetric_surface_distance_mm: 2.6,
                    center_of_mass_distance_mm: 1.8,
                    max_absolute_difference: 0.28,
                    contains_nan: false,
                    contains_inf: false,
                },
                passed: false,
                execution_time_ms: 67,
            },
            ellipsoid: Some(
                OrientedEllipsoid::new(
                    Point3::new(45.0, 55.0, 48.0),
                    Vector3::new(25.0, 18.0, 30.0),
                    Rotation3::from_euler_angles(0.3, 0.5, 0.7),
                    1.0,
                )
                .unwrap(),
            ),
            volume_config: Some(VolumeConfig {
                dimensions: [100, 100, 100],
                spacing: [1.0, 1.0, 1.0],
                origin: [0.0, 0.0, 0.0],
            }),
        },
        // Test without visualization (for comparison)
        EnhancedTestResult {
            base: SimpleTestResult {
                test_name: "No Visualization Test".to_string(),
                metrics: OverlapMetrics {
                    dice_coefficient: 0.950,
                    jaccard_index: 0.905,
                    volume_difference_percent: 5.0,
                    volume_difference_mm3: 25.0,
                    hausdorff_distance_mm: 1.0,
                    hausdorff_95_percentile_mm: 0.8,
                    average_symmetric_surface_distance_mm: 0.6,
                    center_of_mass_distance_mm: 0.3,
                    max_absolute_difference: 0.08,
                    contains_nan: false,
                    contains_inf: false,
                },
                passed: true,
                execution_time_ms: 30,
            },
            ellipsoid: None,
            volume_config: None,
        },
    ];

    // Create dashboard generator
    let dashboard = EnhancedVisualDashboard::new("enhanced_dashboard_output".to_string());

    // Generate the dashboard
    let html_path = dashboard
        .generate_dashboard_with_visuals(&test_results)
        .unwrap();

    // Verify files were created
    assert!(
        std::path::Path::new(&html_path).exists(),
        "HTML file should exist"
    );
    assert!(
        std::path::Path::new("enhanced_dashboard_output/enhanced_dashboard.css").exists(),
        "CSS file should exist"
    );
    assert!(
        std::path::Path::new("enhanced_dashboard_output/enhanced_dashboard.js").exists(),
        "JS file should exist"
    );

    // Verify some images were generated
    assert!(
        std::path::Path::new("enhanced_dashboard_output/images/test_0_axial.png").exists(),
        "First test axial image should exist"
    );
    assert!(
        std::path::Path::new("enhanced_dashboard_output/images/test_1_coronal.png").exists(),
        "Second test coronal image should exist"
    );

    println!("\n✅ Enhanced visual dashboard generated successfully!");
    println!("📊 Dashboard location: {}", html_path);
    println!(
        "🌐 Open {} in a web browser to view the results with ellipsoid visualizations",
        html_path
    );
}
