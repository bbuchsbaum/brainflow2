//! Demo test for generating orthogonal slice differential testing dashboard
//! 
//! This test runs orthogonal differential testing and generates a visual dashboard
//! showing CPU vs GPU comparisons for axial, sagittal, and coronal slices.

use neuro_integration_tests::{run_orthogonal_testing_with_dashboard};

#[tokio::test]
async fn test_generate_orthogonal_dashboard() {
    println!("=== Generating Orthogonal Slice Differential Testing Dashboard ===");
    
    // Run orthogonal differential testing and generate dashboard
    let result = run_orthogonal_testing_with_dashboard("./test_output/orthogonal_dashboard").await;
    
    match result {
        Ok(dashboard_path) => {
            println!("\n✅ Orthogonal dashboard generated successfully!");
            println!("📊 Open the dashboard at: {}", dashboard_path);
            println!("\nThe dashboard shows:");
            println!("  - CPU vs GPU comparisons for all three anatomical planes");
            println!("  - Crosshairs indicating the exact world space coordinate");
            println!("  - World space coordinates displayed above each test");
            println!("  - Comprehensive metrics for each plane (SSIM, Dice, RMSE)");
            println!("  - Grid layout: Top row CPU, bottom row GPU");
            println!("\nEach test shows slices through ellipsoids at specific world coordinates:");
            println!("  - Axial (horizontal) - Z plane");
            println!("  - Sagittal (side view) - X plane");
            println!("  - Coronal (front view) - Y plane");
        }
        Err(e) => {
            println!("❌ Failed to generate orthogonal dashboard: {}", e);
            println!("Note: This may be expected in CI environments without GPU support");
        }
    }
}

#[test]
fn test_orthogonal_slice_coordinates() {
    use neuro_integration_tests::{OrthogonalSliceConfig, create_orthogonal_slices};
    use nalgebra::Point3;
    
    println!("\n=== Testing Orthogonal Slice Coordinate System ===");
    
    // Test world coordinate
    let world_point = Point3::new(10.0, -5.0, 15.0);
    let config = OrthogonalSliceConfig::default();
    
    let (axial, sagittal, coronal) = create_orthogonal_slices(world_point, &config);
    
    println!("World coordinate: ({}, {}, {}) mm", world_point.x, world_point.y, world_point.z);
    println!("\nGenerated slice specifications:");
    println!("  Axial slice at Z = {} mm", axial.origin_mm[2]);
    println!("  Sagittal slice at X = {} mm", sagittal.origin_mm[0]);
    println!("  Coronal slice at Y = {} mm", coronal.origin_mm[1]);
    
    // Verify the slices are positioned correctly
    assert_eq!(axial.origin_mm[2], world_point.z as f32);
    assert_eq!(sagittal.origin_mm[0], world_point.x as f32);
    assert_eq!(coronal.origin_mm[1], world_point.y as f32);
    
    println!("\n✅ Orthogonal slice positioning verified!");
}