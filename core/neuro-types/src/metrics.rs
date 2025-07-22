//! Validation metrics for comparing volumes and slices
//! 
//! This module provides comprehensive metrics for validating coordinate transformations
//! and comparing volumes, including Dice coefficient, Hausdorff distance, and more.

use nalgebra::Point3;
use crate::{Result, Error, Volume};
use std::collections::HashSet;

/// Comprehensive overlap and distance metrics for volume comparison
#[derive(Debug, Clone)]
pub struct OverlapMetrics {
    /// Dice coefficient (2 * |A ∩ B| / (|A| + |B|))
    pub dice_coefficient: f64,
    
    /// Jaccard index (|A ∩ B| / |A ∪ B|)
    pub jaccard_index: f64,
    
    /// Volume difference as percentage of first volume
    pub volume_difference_percent: f64,
    
    /// Absolute volume difference in mm³
    pub volume_difference_mm3: f64,
    
    /// Maximum Hausdorff distance in mm
    pub hausdorff_distance_mm: f64,
    
    /// 95th percentile Hausdorff distance in mm
    pub hausdorff_95_percentile_mm: f64,
    
    /// Average symmetric surface distance in mm
    pub average_symmetric_surface_distance_mm: f64,
    
    /// Distance between centers of mass in mm
    pub center_of_mass_distance_mm: f64,
    
    /// Maximum absolute difference between voxel values
    pub max_absolute_difference: f32,
    
    /// Whether any NaN values were found
    pub contains_nan: bool,
    
    /// Whether any infinite values were found
    pub contains_inf: bool,
}

impl OverlapMetrics {
    /// Check if metrics pass given tolerances
    pub fn passes_tolerances(&self, tolerances: &ValidationTolerance) -> bool {
        self.dice_coefficient >= tolerances.dice_threshold
            && self.volume_difference_percent <= tolerances.volume_diff_percent
            && self.hausdorff_95_percentile_mm <= tolerances.hausdorff_95_mm
            && !self.contains_nan
            && !self.contains_inf
    }
}

/// Tolerance thresholds for validation
#[derive(Debug, Clone)]
pub struct ValidationTolerance {
    /// Minimum acceptable Dice coefficient
    pub dice_threshold: f64,
    
    /// Maximum acceptable volume difference percentage
    pub volume_diff_percent: f64,
    
    /// Maximum acceptable 95th percentile Hausdorff distance in mm
    pub hausdorff_95_mm: f64,
    
    /// Whether to use volume-weighted metrics
    pub use_volume_weighted: bool,
}

impl Default for ValidationTolerance {
    fn default() -> Self {
        Self {
            dice_threshold: 0.95,
            volume_diff_percent: 5.0,
            hausdorff_95_mm: 2.0,
            use_volume_weighted: false,
        }
    }
}

/// Volume comparison utilities
pub struct VolumeComparison;

impl VolumeComparison {
    /// Compute comprehensive overlap metrics between two volumes
    pub fn compute_metrics(
        volume1: &dyn Volume,
        volume2: &dyn Volume,
        threshold: f32,
        voxel_volume_mm3: Option<f64>,
    ) -> Result<OverlapMetrics> {
        // Ensure volumes have same dimensions
        let dims1 = volume1.dimensions();
        let dims2 = volume2.dimensions();
        
        if dims1 != dims2 {
            return Err(Error::InvalidSliceSpec(format!(
                "Volume dimensions mismatch: {:?} vs {:?}",
                dims1, dims2
            )));
        }
        
        // Compute voxel volume if not provided
        let voxel_vol = if let Some(v) = voxel_volume_mm3 {
            v
        } else {
            let spacing = volume1.spacing();
            (spacing[0] * spacing[1] * spacing[2]) as f64
        };
        
        // Collect statistics
        let mut intersection_count = 0usize;
        let mut volume1_count = 0usize;
        let mut volume2_count = 0usize;
        let mut union_count = 0usize;
        let mut max_diff = 0.0f32;
        let mut has_nan = false;
        let mut has_inf = false;
        
        let mut volume1_coords = Vec::new();
        let mut volume2_coords = Vec::new();
        
        let mut sum1 = Point3::new(0.0f64, 0.0, 0.0);
        let mut sum2 = Point3::new(0.0f64, 0.0, 0.0);
        
        // Iterate through all voxels
        for k in 0..dims1[2] {
            for j in 0..dims1[1] {
                for i in 0..dims1[0] {
                    let coords = [i, j, k];
                    
                    let val1 = volume1.get_at_coords(coords).unwrap_or(0.0);
                    let val2 = volume2.get_at_coords(coords).unwrap_or(0.0);
                    
                    // Check for NaN/Inf
                    if val1.is_nan() || val2.is_nan() {
                        has_nan = true;
                    }
                    if val1.is_infinite() || val2.is_infinite() {
                        has_inf = true;
                    }
                    
                    // Update max difference
                    max_diff = max_diff.max((val1 - val2).abs());
                    
                    // Binary classification based on threshold
                    let binary1 = val1 > threshold;
                    let binary2 = val2 > threshold;
                    
                    if binary1 && binary2 {
                        intersection_count += 1;
                    }
                    
                    if binary1 {
                        volume1_count += 1;
                        volume1_coords.push([i, j, k]);
                        sum1.x += i as f64;
                        sum1.y += j as f64;
                        sum1.z += k as f64;
                    }
                    
                    if binary2 {
                        volume2_count += 1;
                        volume2_coords.push([i, j, k]);
                        sum2.x += i as f64;
                        sum2.y += j as f64;
                        sum2.z += k as f64;
                    }
                    
                    if binary1 || binary2 {
                        union_count += 1;
                    }
                }
            }
        }
        
        // Compute basic metrics
        let dice = if volume1_count + volume2_count > 0 {
            2.0 * intersection_count as f64 / (volume1_count + volume2_count) as f64
        } else {
            0.0
        };
        
        let jaccard = if union_count > 0 {
            intersection_count as f64 / union_count as f64
        } else {
            0.0
        };
        
        let volume_diff_percent = if volume1_count > 0 {
            ((volume1_count as f64 - volume2_count as f64).abs() / volume1_count as f64) * 100.0
        } else {
            0.0
        };
        
        let volume_diff_mm3 = (volume1_count as f64 - volume2_count as f64).abs() * voxel_vol;
        
        // Compute centers of mass
        let com1 = if volume1_count > 0 {
            Point3::new(
                sum1.x / volume1_count as f64,
                sum1.y / volume1_count as f64,
                sum1.z / volume1_count as f64,
            )
        } else {
            Point3::origin()
        };
        
        let com2 = if volume2_count > 0 {
            Point3::new(
                sum2.x / volume2_count as f64,
                sum2.y / volume2_count as f64,
                sum2.z / volume2_count as f64,
            )
        } else {
            Point3::origin()
        };
        
        // Convert to world coordinates
        let voxel_to_world = volume1.voxel_to_world_matrix();
        let com1_world = crate::coordinates::voxel_to_world(
            Point3::new(com1.x as f32, com1.y as f32, com1.z as f32),
            &voxel_to_world
        );
        let com2_world = crate::coordinates::voxel_to_world(
            Point3::new(com2.x as f32, com2.y as f32, com2.z as f32),
            &voxel_to_world
        );
        
        let com_distance = (com1_world - com2_world).norm() as f64;
        
        // Compute surface distances
        let (hausdorff, hausdorff_95, assd) = if !volume1_coords.is_empty() && !volume2_coords.is_empty() {
            compute_surface_distances(
                &volume1_coords,
                &volume2_coords,
                &voxel_to_world,
            )?
        } else {
            (0.0, 0.0, 0.0)
        };
        
        Ok(OverlapMetrics {
            dice_coefficient: dice,
            jaccard_index: jaccard,
            volume_difference_percent: volume_diff_percent,
            volume_difference_mm3: volume_diff_mm3,
            hausdorff_distance_mm: hausdorff,
            hausdorff_95_percentile_mm: hausdorff_95,
            average_symmetric_surface_distance_mm: assd,
            center_of_mass_distance_mm: com_distance,
            max_absolute_difference: max_diff,
            contains_nan: has_nan,
            contains_inf: has_inf,
        })
    }
}

/// Compute surface distances between two sets of voxel coordinates
fn compute_surface_distances(
    coords1: &[[usize; 3]],
    coords2: &[[usize; 3]],
    voxel_to_world: &nalgebra::Matrix4<f32>,
) -> Result<(f64, f64, f64)> {
    // Find surface voxels (those with at least one empty neighbor)
    let surface1 = find_surface_voxels(coords1);
    let surface2 = find_surface_voxels(coords2);
    
    if surface1.is_empty() || surface2.is_empty() {
        return Ok((0.0, 0.0, 0.0));
    }
    
    // Convert to world coordinates
    let surface1_world: Vec<Point3<f32>> = surface1.iter()
        .map(|&[i, j, k]| {
            crate::coordinates::voxel_to_world(
                Point3::new(i as f32, j as f32, k as f32),
                voxel_to_world
            )
        })
        .collect();
    
    let surface2_world: Vec<Point3<f32>> = surface2.iter()
        .map(|&[i, j, k]| {
            crate::coordinates::voxel_to_world(
                Point3::new(i as f32, j as f32, k as f32),
                voxel_to_world
            )
        })
        .collect();
    
    // Compute distances from surface1 to surface2
    let mut distances_1_to_2 = Vec::with_capacity(surface1_world.len());
    for p1 in &surface1_world {
        let min_dist = surface2_world.iter()
            .map(|p2| (p1 - p2).norm())
            .fold(f32::INFINITY, f32::min);
        distances_1_to_2.push(min_dist as f64);
    }
    
    // Compute distances from surface2 to surface1
    let mut distances_2_to_1 = Vec::with_capacity(surface2_world.len());
    for p2 in &surface2_world {
        let min_dist = surface1_world.iter()
            .map(|p1| (p2 - p1).norm())
            .fold(f32::INFINITY, f32::min);
        distances_2_to_1.push(min_dist as f64);
    }
    
    // Compute Hausdorff distance (maximum of all minimum distances)
    let max_1_to_2 = distances_1_to_2.iter().cloned().fold(0.0f64, f64::max);
    let max_2_to_1 = distances_2_to_1.iter().cloned().fold(0.0f64, f64::max);
    let hausdorff = max_1_to_2.max(max_2_to_1);
    
    // Compute 95th percentile Hausdorff
    let mut all_distances = distances_1_to_2.clone();
    all_distances.extend(&distances_2_to_1);
    all_distances.sort_by(|a, b| a.partial_cmp(b).unwrap());
    
    let percentile_95_idx = ((all_distances.len() as f64 * 0.95) as usize).min(all_distances.len() - 1);
    let hausdorff_95 = all_distances[percentile_95_idx];
    
    // Compute average symmetric surface distance
    let sum_1_to_2: f64 = distances_1_to_2.iter().sum();
    let sum_2_to_1: f64 = distances_2_to_1.iter().sum();
    let assd = (sum_1_to_2 + sum_2_to_1) / (distances_1_to_2.len() + distances_2_to_1.len()) as f64;
    
    Ok((hausdorff, hausdorff_95, assd))
}

/// Find surface voxels (those with at least one empty neighbor)
fn find_surface_voxels(coords: &[[usize; 3]]) -> Vec<[usize; 3]> {
    let coord_set: HashSet<[usize; 3]> = coords.iter().cloned().collect();
    let mut surface = Vec::new();
    
    for &[i, j, k] in coords {
        // Check 6-connected neighbors
        let neighbors = [
            [i.wrapping_sub(1), j, k],
            [i + 1, j, k],
            [i, j.wrapping_sub(1), k],
            [i, j + 1, k],
            [i, j, k.wrapping_sub(1)],
            [i, j, k + 1],
        ];
        
        // If any neighbor is not in the set, this is a surface voxel
        let is_surface = neighbors.iter().any(|n| !coord_set.contains(n));
        
        if is_surface {
            surface.push([i, j, k]);
        }
    }
    
    surface
}

#[cfg(test)]
mod tests {
    use super::*;
    
    // Mock volume for testing
    struct TestVolume {
        dimensions: [usize; 3],
        data: Vec<f32>,
        spacing: [f32; 3],
    }
    
    impl TestVolume {
        fn new(dimensions: [usize; 3], spacing: [f32; 3]) -> Self {
            let size = dimensions[0] * dimensions[1] * dimensions[2];
            Self {
                dimensions,
                data: vec![0.0; size],
                spacing,
            }
        }
        
        fn set_sphere(&mut self, center: [f32; 3], radius: f32, value: f32) {
            for k in 0..self.dimensions[2] {
                for j in 0..self.dimensions[1] {
                    for i in 0..self.dimensions[0] {
                        let x = i as f32 - center[0];
                        let y = j as f32 - center[1];
                        let z = k as f32 - center[2];
                        
                        let dist_sq = x * x + y * y + z * z;
                        if dist_sq <= radius * radius {
                            let idx = k * self.dimensions[0] * self.dimensions[1]
                                    + j * self.dimensions[0]
                                    + i;
                            self.data[idx] = value;
                        }
                    }
                }
            }
        }
    }
    
    impl Volume for TestVolume {
        fn dimensions(&self) -> [usize; 3] {
            self.dimensions
        }
        
        fn spacing(&self) -> [f32; 3] {
            self.spacing
        }
        
        fn origin(&self) -> [f32; 3] {
            [0.0, 0.0, 0.0]
        }
        
        fn get_at_coords(&self, coords: [usize; 3]) -> Option<f32> {
            if coords[0] >= self.dimensions[0]
                || coords[1] >= self.dimensions[1]
                || coords[2] >= self.dimensions[2]
            {
                return None;
            }
            
            let idx = coords[2] * self.dimensions[0] * self.dimensions[1]
                    + coords[1] * self.dimensions[0]
                    + coords[0];
            Some(self.data[idx])
        }
        
        fn voxel_to_world_matrix(&self) -> nalgebra::Matrix4<f32> {
            nalgebra::Matrix4::new_nonuniform_scaling(&nalgebra::Vector3::from(self.spacing))
        }
        
        fn dtype_name(&self) -> &str {
            "f32"
        }
    }
    
    #[test]
    fn test_identical_volumes() {
        let mut volume1 = TestVolume::new([20, 20, 20], [1.0, 1.0, 1.0]);
        let mut volume2 = TestVolume::new([20, 20, 20], [1.0, 1.0, 1.0]);
        
        // Create identical spheres
        volume1.set_sphere([10.0, 10.0, 10.0], 5.0, 100.0);
        volume2.set_sphere([10.0, 10.0, 10.0], 5.0, 100.0);
        
        let metrics = VolumeComparison::compute_metrics(&volume1, &volume2, 50.0, None).unwrap();
        
        assert!((metrics.dice_coefficient - 1.0).abs() < 1e-10);
        assert!((metrics.jaccard_index - 1.0).abs() < 1e-10);
        assert!(metrics.volume_difference_percent < 1e-10);
        assert!(metrics.center_of_mass_distance_mm < 1e-10);
        assert!(metrics.max_absolute_difference < 1e-10);
    }
    
    #[test]
    fn test_overlapping_spheres() {
        let mut volume1 = TestVolume::new([30, 30, 30], [1.0, 1.0, 1.0]);
        let mut volume2 = TestVolume::new([30, 30, 30], [1.0, 1.0, 1.0]);
        
        // Create slightly offset spheres
        volume1.set_sphere([15.0, 15.0, 15.0], 5.0, 100.0);
        volume2.set_sphere([17.0, 15.0, 15.0], 5.0, 100.0);
        
        let metrics = VolumeComparison::compute_metrics(&volume1, &volume2, 50.0, None).unwrap();
        
        // Should have high but not perfect overlap
        assert!(metrics.dice_coefficient > 0.7);
        assert!(metrics.dice_coefficient < 0.95);
        assert!(metrics.center_of_mass_distance_mm > 1.5);
        assert!(metrics.center_of_mass_distance_mm < 2.5);
    }
    
    #[test]
    fn test_tolerance_checking() {
        let tolerance = ValidationTolerance {
            dice_threshold: 0.95,
            volume_diff_percent: 5.0,
            hausdorff_95_mm: 2.0,
            use_volume_weighted: false,
        };
        
        let good_metrics = OverlapMetrics {
            dice_coefficient: 0.96,
            jaccard_index: 0.92,
            volume_difference_percent: 3.0,
            volume_difference_mm3: 100.0,
            hausdorff_distance_mm: 3.0,
            hausdorff_95_percentile_mm: 1.5,
            average_symmetric_surface_distance_mm: 0.8,
            center_of_mass_distance_mm: 0.5,
            max_absolute_difference: 0.1,
            contains_nan: false,
            contains_inf: false,
        };
        
        assert!(good_metrics.passes_tolerances(&tolerance));
        
        let bad_metrics = OverlapMetrics {
            dice_coefficient: 0.90, // Below threshold
            ..good_metrics.clone()
        };
        
        assert!(!bad_metrics.passes_tolerances(&tolerance));
    }
}