//! Test for ellipsoid visualization

use neuro_integration_tests::{EllipsoidVisualizer};
use neuro_types::{OrientedEllipsoid};
use nalgebra::{Point3, Vector3, Rotation3};
use std::fs;

#[test]
fn test_generate_ellipsoid_images() {
    let output_dir = "test_ellipsoid_visualizations";
    fs::create_dir_all(output_dir).unwrap();
    
    let visualizer = EllipsoidVisualizer::new(output_dir.to_string());
    
    // Test 1: Simple sphere
    let sphere = OrientedEllipsoid::new(
        Point3::new(50.0, 50.0, 50.0),
        Vector3::new(20.0, 20.0, 20.0),
        Rotation3::identity(),
        1.0,
    ).unwrap();
    
    let paths = visualizer.generate_ellipsoid_slices(
        &sphere,
        "sphere",
        [100, 100, 100],
        [1.0, 1.0, 1.0],
    ).unwrap();
    
    assert!(std::path::Path::new(&paths.axial).exists());
    assert!(std::path::Path::new(&paths.coronal).exists());
    assert!(std::path::Path::new(&paths.sagittal).exists());
    
    // Test 2: Elongated ellipsoid
    let ellipsoid = OrientedEllipsoid::new(
        Point3::new(50.0, 50.0, 50.0),
        Vector3::new(30.0, 15.0, 10.0),
        Rotation3::from_axis_angle(&Vector3::z_axis(), std::f64::consts::PI / 4.0),
        1.0,
    ).unwrap();
    
    let paths = visualizer.generate_ellipsoid_slices(
        &ellipsoid,
        "ellipsoid_rotated",
        [100, 100, 100],
        [1.0, 1.0, 1.0],
    ).unwrap();
    
    assert!(std::path::Path::new(&paths.axial).exists());
    
    // Test 3: Generate overlay
    let ellipsoid2 = OrientedEllipsoid::new(
        Point3::new(55.0, 50.0, 50.0),
        Vector3::new(25.0, 20.0, 15.0),
        Rotation3::identity(),
        1.0,
    ).unwrap();
    
    let overlay_path = visualizer.generate_overlay_image(
        &ellipsoid,
        &ellipsoid2,
        "ellipsoid_overlay",
        [100, 100, 100],
        [1.0, 1.0, 1.0],
    ).unwrap();
    
    assert!(std::path::Path::new(&overlay_path).exists());
    
    println!("\n✅ Ellipsoid visualizations generated successfully!");
    println!("📊 Images saved to: {}/", output_dir);
}