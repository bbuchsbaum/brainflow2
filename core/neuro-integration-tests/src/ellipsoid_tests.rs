//! Ellipsoid-based tests for coordinate transformation validation
//! 
//! This module uses oriented ellipsoids as ground truth to validate
//! coordinate transformations across various volume configurations.

use nalgebra::{Point3, Vector3, Rotation3, Unit, UnitQuaternion, Quaternion};
use neuro_types::{OrientedEllipsoid, ValidationTolerance, VolumeComparison, Result};
use rand::{Rng, SeedableRng};
use rand::rngs::StdRng;
use std::f64::consts::PI;

/// Configuration for an ellipsoid test
#[derive(Debug, Clone)]
pub struct EllipsoidTestConfig {
    /// The ellipsoid to test
    pub ellipsoid: OrientedEllipsoid,
    
    /// Different volume configurations to test
    pub volume_configs: Vec<VolumeConfig>,
    
    /// Validation tolerance settings
    pub tolerance: ValidationTolerance,
    
    /// Test description
    pub description: String,
}

/// Volume configuration for testing
#[derive(Debug, Clone)]
pub struct VolumeConfig {
    /// Volume dimensions [x, y, z]
    pub dimensions: [usize; 3],
    
    /// Voxel spacing in mm [dx, dy, dz]
    pub spacing_mm: [f64; 3],
    
    /// Origin offset in mm [x, y, z]
    pub origin_mm: [f64; 3],
    
    /// Optional rotation/reorientation matrix
    pub orientation: Option<nalgebra::Matrix4<f64>>,
    
    /// Description for test output
    pub description: String,
}

impl EllipsoidTestConfig {
    /// Create standard test suite with comprehensive coverage
    pub fn standard_test_suite() -> Vec<Self> {
        vec![
            // Test 1: Basic isotropic voxels
            Self {
                ellipsoid: OrientedEllipsoid::new(
                    Point3::new(0.0, 0.0, 0.0),
                    Vector3::new(20.0, 15.0, 10.0),
                    Rotation3::identity(),
                    100.0,
                ).expect("Failed to create ellipsoid"),
                volume_configs: vec![
                    VolumeConfig {
                        dimensions: [64, 64, 64],
                        spacing_mm: [2.0, 2.0, 2.0],
                        origin_mm: [-64.0, -64.0, -64.0],
                        orientation: None,
                        description: "Isotropic 2mm".to_string(),
                    },
                    VolumeConfig {
                        dimensions: [128, 128, 128],
                        spacing_mm: [1.0, 1.0, 1.0],
                        origin_mm: [-64.0, -64.0, -64.0],
                        orientation: None,
                        description: "Isotropic 1mm".to_string(),
                    },
                ],
                tolerance: ValidationTolerance::default(),
                description: "Basic isotropic test".to_string(),
            },
            
            // Test 2: Anisotropic voxels
            Self {
                ellipsoid: OrientedEllipsoid::new(
                    Point3::new(10.0, -5.0, 15.0),
                    Vector3::new(25.0, 20.0, 15.0),
                    Rotation3::from_euler_angles(PI/6.0, PI/4.0, PI/3.0),
                    200.0,
                ).expect("Failed to create ellipsoid"),
                volume_configs: vec![
                    VolumeConfig {
                        dimensions: [128, 96, 48],
                        spacing_mm: [1.0, 1.5, 3.0],
                        origin_mm: [-64.0, -72.0, -72.0],
                        orientation: None,
                        description: "Anisotropic 1x1.5x3mm".to_string(),
                    },
                    VolumeConfig {
                        dimensions: [64, 64, 32],
                        spacing_mm: [2.0, 2.0, 4.0],
                        origin_mm: [-64.0, -64.0, -64.0],
                        orientation: None,
                        description: "Anisotropic 2x2x4mm".to_string(),
                    },
                ],
                tolerance: ValidationTolerance {
                    dice_threshold: 0.93, // Slightly relaxed for anisotropic
                    ..ValidationTolerance::default()
                },
                description: "Anisotropic voxel test".to_string(),
            },
            
            // Test 3: Extreme aspect ratio (O3's suggestion)
            Self {
                ellipsoid: OrientedEllipsoid::new(
                    Point3::new(0.0, 0.0, 0.0),
                    Vector3::new(30.0, 30.0, 3.0), // Pancake shape
                    Rotation3::from_axis_angle(&Unit::new_normalize(Vector3::new(1.0, 1.0, 0.0)), PI/4.0),
                    150.0,
                ).expect("Failed to create ellipsoid"),
                volume_configs: vec![
                    VolumeConfig {
                        dimensions: [128, 128, 32],
                        spacing_mm: [0.5, 0.5, 2.0],
                        origin_mm: [-32.0, -32.0, -32.0],
                        orientation: None,
                        description: "High-res XY, low-res Z".to_string(),
                    },
                ],
                tolerance: ValidationTolerance {
                    dice_threshold: 0.90, // More relaxed for extreme shapes
                    volume_diff_percent: 10.0,
                    ..ValidationTolerance::default()
                },
                description: "Extreme aspect ratio test".to_string(),
            },
            
            // Test 4: Rotated coordinate system
            Self {
                ellipsoid: OrientedEllipsoid::new(
                    Point3::new(0.0, 0.0, 0.0),
                    Vector3::new(30.0, 20.0, 10.0),
                    Rotation3::from_euler_angles(0.0, PI/4.0, 0.0),
                    150.0,
                ).expect("Failed to create ellipsoid"),
                volume_configs: vec![
                    VolumeConfig {
                        dimensions: [80, 80, 80],
                        spacing_mm: [2.0, 2.0, 2.0],
                        origin_mm: [-80.0, -80.0, -80.0],
                        orientation: Some(create_rotation_matrix(PI/8.0, PI/6.0, 0.0)),
                        description: "Rotated coordinate system".to_string(),
                    },
                ],
                tolerance: ValidationTolerance::default(),
                description: "Rotated volume space test".to_string(),
            },
            
            // Test 5: Partial FOV (O3's suggestion)
            Self {
                ellipsoid: OrientedEllipsoid::new(
                    Point3::new(50.0, 50.0, 50.0), // Near edge of typical FOV
                    Vector3::new(30.0, 30.0, 30.0),
                    Rotation3::identity(),
                    175.0,
                ).expect("Failed to create ellipsoid"),
                volume_configs: vec![
                    VolumeConfig {
                        dimensions: [64, 64, 64],
                        spacing_mm: [2.0, 2.0, 2.0],
                        origin_mm: [0.0, 0.0, 0.0],
                        orientation: None,
                        description: "Partial FOV clipping".to_string(),
                    },
                ],
                tolerance: ValidationTolerance {
                    dice_threshold: 0.85, // More forgiving for clipped volumes
                    volume_diff_percent: 15.0,
                    hausdorff_95_mm: 5.0,
                    ..ValidationTolerance::default()
                },
                description: "Partial FOV test".to_string(),
            },
            
            // Test 6: Small ellipsoid (near voxel size)
            Self {
                ellipsoid: OrientedEllipsoid::new(
                    Point3::new(0.0, 0.0, 0.0),
                    Vector3::new(2.5, 2.0, 1.5), // Very small
                    Rotation3::identity(),
                    250.0,
                ).expect("Failed to create ellipsoid"),
                volume_configs: vec![
                    VolumeConfig {
                        dimensions: [32, 32, 32],
                        spacing_mm: [1.0, 1.0, 1.0],
                        origin_mm: [-16.0, -16.0, -16.0],
                        orientation: None,
                        description: "Near voxel-size ellipsoid".to_string(),
                    },
                ],
                tolerance: ValidationTolerance {
                    dice_threshold: 0.80, // Very relaxed for tiny objects
                    volume_diff_percent: 20.0,
                    ..ValidationTolerance::default()
                },
                description: "Small ellipsoid test".to_string(),
            },
        ]
    }
    
    /// Generate random test configurations for property-based testing
    pub fn generate_random_tests(seed: u64, count: usize) -> Vec<Self> {
        let mut rng = StdRng::seed_from_u64(seed);
        
        (0..count).map(|i| {
            // Random ellipsoid parameters
            let center = Point3::new(
                rng.gen_range(-30.0..30.0),
                rng.gen_range(-30.0..30.0),
                rng.gen_range(-30.0..30.0),
            );
            
            let radii = Vector3::new(
                rng.gen_range(5.0..25.0),
                rng.gen_range(5.0..25.0),
                rng.gen_range(5.0..25.0),
            );
            
            // Random orientation using quaternion to avoid gimbal lock
            let rotation = Rotation3::from_quaternion(
                UnitQuaternion::from_quaternion(
                    Quaternion::new(
                        rng.gen_range(-1.0..1.0),
                        rng.gen_range(-1.0..1.0),
                        rng.gen_range(-1.0..1.0),
                        rng.gen_range(-1.0..1.0),
                    ).normalize()
                )
            );
            
            let intensity = rng.gen_range(50.0..250.0);
            
            // Random volume configuration
            let volume_config = VolumeConfig {
                dimensions: [
                    rng.gen_range(32..128),
                    rng.gen_range(32..128),
                    rng.gen_range(32..128),
                ],
                spacing_mm: [
                    rng.gen_range(0.5..3.0),
                    rng.gen_range(0.5..3.0),
                    rng.gen_range(0.5..3.0),
                ],
                origin_mm: [
                    rng.gen_range(-50.0..0.0),
                    rng.gen_range(-50.0..0.0),
                    rng.gen_range(-50.0..0.0),
                ],
                orientation: if rng.gen_bool(0.3) {
                    // 30% chance of rotated volume
                    Some(create_rotation_matrix(
                        rng.gen_range(-PI/4.0..PI/4.0),
                        rng.gen_range(-PI/4.0..PI/4.0),
                        rng.gen_range(-PI/4.0..PI/4.0),
                    ))
                } else {
                    None
                },
                description: format!("Random config #{}", i),
            };
            
            Self {
                ellipsoid: OrientedEllipsoid::new(center, radii, rotation, intensity)
                    .expect("Failed to create random ellipsoid"),
                volume_configs: vec![volume_config],
                tolerance: ValidationTolerance {
                    dice_threshold: 0.90, // Reasonable threshold for random tests
                    volume_diff_percent: 10.0,
                    hausdorff_95_mm: 3.0,
                    use_volume_weighted: false,
                },
                description: format!("Random test #{}", i),
            }
        }).collect()
    }
    
    /// Create edge case tests
    pub fn edge_case_tests() -> Vec<Self> {
        vec![
            // Degenerate orientations (O3's suggestion)
            Self {
                ellipsoid: OrientedEllipsoid::new(
                    Point3::new(0.0, 0.0, 0.0),
                    Vector3::new(20.0, 20.0, 20.0),
                    Rotation3::from_euler_angles(0.0, 0.0, 0.0), // Identity
                    100.0,
                ).expect("Failed to create ellipsoid"),
                volume_configs: vec![
                    VolumeConfig {
                        dimensions: [64, 64, 64],
                        spacing_mm: [2.0, 2.0, 2.0],
                        origin_mm: [-64.0, -64.0, -64.0],
                        orientation: Some(nalgebra::Matrix4::identity()),
                        description: "Identity orientation".to_string(),
                    },
                ],
                tolerance: ValidationTolerance::default(),
                description: "Degenerate orientation test".to_string(),
            },
            
            // 90 degree rotations
            Self {
                ellipsoid: OrientedEllipsoid::new(
                    Point3::new(0.0, 0.0, 0.0),
                    Vector3::new(30.0, 10.0, 10.0),
                    Rotation3::from_euler_angles(PI/2.0, 0.0, 0.0),
                    150.0,
                ).expect("Failed to create ellipsoid"),
                volume_configs: vec![
                    VolumeConfig {
                        dimensions: [64, 64, 64],
                        spacing_mm: [2.0, 2.0, 2.0],
                        origin_mm: [-64.0, -64.0, -64.0],
                        orientation: None,
                        description: "90-degree rotation".to_string(),
                    },
                ],
                tolerance: ValidationTolerance::default(),
                description: "90-degree rotation test".to_string(),
            },
            
            // Very large ellipsoid (stress test)
            Self {
                ellipsoid: OrientedEllipsoid::new(
                    Point3::new(0.0, 0.0, 0.0),
                    Vector3::new(100.0, 80.0, 60.0),
                    Rotation3::identity(),
                    50.0,
                ).expect("Failed to create ellipsoid"),
                volume_configs: vec![
                    VolumeConfig {
                        dimensions: [256, 256, 256],
                        spacing_mm: [1.0, 1.0, 1.0],
                        origin_mm: [-128.0, -128.0, -128.0],
                        orientation: None,
                        description: "Large volume test".to_string(),
                    },
                ],
                tolerance: ValidationTolerance::default(),
                description: "Large ellipsoid stress test".to_string(),
            },
        ]
    }
}

/// Create a rotation matrix from Euler angles
fn create_rotation_matrix(roll: f64, pitch: f64, yaw: f64) -> nalgebra::Matrix4<f64> {
    let rotation = Rotation3::from_euler_angles(roll, pitch, yaw);
    let mut matrix = nalgebra::Matrix4::identity();
    matrix.fixed_slice_mut::<3, 3>(0, 0).copy_from(&rotation.matrix());
    matrix
}

/// Test result for a single ellipsoid configuration
#[derive(Debug)]
pub struct EllipsoidTestResult {
    /// Test configuration name
    pub test_name: String,
    
    /// Volume configuration description
    pub volume_config: String,
    
    /// Computed metrics
    pub metrics: neuro_types::OverlapMetrics,
    
    /// Whether the test passed tolerance checks
    pub passed: bool,
    
    /// CPU computation time in milliseconds
    pub cpu_time_ms: f64,
    
    /// GPU computation time in milliseconds (if available)
    pub gpu_time_ms: Option<f64>,
}

/// Collection of test results
#[derive(Debug, Default)]
pub struct EllipsoidTestResults {
    pub results: Vec<EllipsoidTestResult>,
}

impl EllipsoidTestResults {
    /// Create new empty results
    pub fn new() -> Self {
        Self::default()
    }
    
    /// Add a test result
    pub fn add_result(&mut self, result: EllipsoidTestResult) {
        self.results.push(result);
    }
    
    /// Get summary statistics
    pub fn summary(&self) -> TestSummary {
        let total = self.results.len();
        let passed = self.results.iter().filter(|r| r.passed).count();
        let failed = total - passed;
        
        let avg_dice = if total > 0 {
            self.results.iter()
                .map(|r| r.metrics.dice_coefficient)
                .sum::<f64>() / total as f64
        } else {
            0.0
        };
        
        let avg_cpu_time = if total > 0 {
            self.results.iter()
                .map(|r| r.cpu_time_ms)
                .sum::<f64>() / total as f64
        } else {
            0.0
        };
        
        TestSummary {
            total_tests: total,
            passed,
            failed,
            average_dice: avg_dice,
            average_cpu_time_ms: avg_cpu_time,
        }
    }
    
    /// Print detailed results
    pub fn print_detailed(&self) {
        println!("\n=== Ellipsoid Test Results ===\n");
        
        for result in &self.results {
            println!("Test: {} - {}", result.test_name, result.volume_config);
            println!("  Status: {}", if result.passed { "PASSED" } else { "FAILED" });
            println!("  Dice coefficient: {:.4}", result.metrics.dice_coefficient);
            println!("  Volume difference: {:.2}%", result.metrics.volume_difference_percent);
            println!("  Hausdorff 95%: {:.2} mm", result.metrics.hausdorff_95_percentile_mm);
            println!("  COM distance: {:.2} mm", result.metrics.center_of_mass_distance_mm);
            println!("  CPU time: {:.2} ms", result.cpu_time_ms);
            if let Some(gpu_time) = result.gpu_time_ms {
                println!("  GPU time: {:.2} ms", gpu_time);
                println!("  Speedup: {:.2}x", result.cpu_time_ms / gpu_time);
            }
            println!();
        }
        
        let summary = self.summary();
        println!("=== Summary ===");
        println!("Total tests: {}", summary.total_tests);
        println!("Passed: {} ({:.1}%)", summary.passed, 
            100.0 * summary.passed as f64 / summary.total_tests as f64);
        println!("Failed: {}", summary.failed);
        println!("Average Dice: {:.4}", summary.average_dice);
        println!("Average CPU time: {:.2} ms", summary.average_cpu_time_ms);
    }
}

/// Summary statistics for test results
#[derive(Debug)]
pub struct TestSummary {
    pub total_tests: usize,
    pub passed: usize,
    pub failed: usize,
    pub average_dice: f64,
    pub average_cpu_time_ms: f64,
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_standard_suite_creation() {
        let suite = EllipsoidTestConfig::standard_test_suite();
        assert!(!suite.is_empty());
        
        // Verify all ellipsoids are valid
        for config in &suite {
            assert!(config.ellipsoid.volume_mm3() > 0.0);
            assert!(!config.volume_configs.is_empty());
        }
    }
    
    #[test]
    fn test_random_generation() {
        let random_tests = EllipsoidTestConfig::generate_random_tests(42, 10);
        assert_eq!(random_tests.len(), 10);
        
        // Verify all generated tests are valid
        for config in &random_tests {
            assert!(config.ellipsoid.volume_mm3() > 0.0);
            assert_eq!(config.volume_configs.len(), 1);
        }
    }
    
    #[test]
    fn test_edge_cases() {
        let edge_cases = EllipsoidTestConfig::edge_case_tests();
        assert!(!edge_cases.is_empty());
        
        // Verify edge cases are valid
        for config in &edge_cases {
            assert!(config.ellipsoid.volume_mm3() > 0.0);
        }
    }
}