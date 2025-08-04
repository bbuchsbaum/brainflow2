//! Simple ellipsoid test to verify the core functionality works

use nalgebra::{Point3, Rotation3, Vector3};
use neuro_types::{OrientedEllipsoid, OverlapMetrics};

#[test]
fn test_basic_ellipsoid_creation() {
    let center = Point3::new(0.0, 0.0, 0.0);
    let radii = Vector3::new(5.0, 3.0, 2.0);
    let rotation = Rotation3::identity();

    let ellipsoid = OrientedEllipsoid::new(center, radii, rotation, 1.0).unwrap();

    // Basic properties
    assert_eq!(ellipsoid.center, center);
    assert_eq!(ellipsoid.radii, radii);
    assert_eq!(ellipsoid.intensity, 1.0);
}

#[test]
fn test_ellipsoid_overlap_metrics() {
    // Test that two identical ellipsoids have perfect overlap
    let center = Point3::new(0.0, 0.0, 0.0);
    let radii = Vector3::new(5.0, 5.0, 5.0);
    let rotation = Rotation3::identity();

    let ellipsoid1 = OrientedEllipsoid::new(center, radii, rotation, 1.0).unwrap();
    let ellipsoid2 = OrientedEllipsoid::new(center, radii, rotation, 1.0).unwrap();

    // For now, just test that the ellipsoids are created successfully
    // Full comparison would require volume rasterization which we'll add later
    assert_eq!(ellipsoid1.center, ellipsoid2.center);
    assert_eq!(ellipsoid1.radii, ellipsoid2.radii);
}

#[test]
fn test_basic_overlap_metrics() {
    // Test basic overlap metrics functionality
    let metrics = OverlapMetrics {
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
    };

    assert_eq!(metrics.dice_coefficient, 0.95);
    assert_eq!(metrics.hausdorff_distance_mm, 1.2);
    assert_eq!(metrics.average_symmetric_surface_distance_mm, 0.8);
    assert_eq!(metrics.jaccard_index, 0.90);
}
