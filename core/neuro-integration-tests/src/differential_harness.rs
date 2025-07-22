//! Differential testing harness for CPU vs GPU comparison
//! 
//! This module provides the core infrastructure for running differential tests
//! between CPU and GPU ellipsoid rendering implementations.

use neuro_types::{OrientedEllipsoid, SliceSpec, Result as NeuroResult, RgbaImage};
use neuro_cpu::CpuEllipsoidRenderer;
use crate::ellipsoid_gpu_renderer::GpuEllipsoidRenderer;
use crate::orthogonal_renderer::{OrthogonalSlices, OrthogonalSliceConfig, create_orthogonal_slices, add_crosshairs_to_slices};
use crate::image_utils::ImageDimensions;
use nalgebra::{Point3, Vector3, Rotation3};

/// Comparison metrics between CPU and GPU outputs
#[derive(Debug, Clone)]
pub struct DifferentialMetrics {
    /// Dice coefficient (0.0 = no overlap, 1.0 = perfect overlap)
    pub dice_coefficient: f64,
    
    /// Jaccard index (alternative overlap metric, 0.0 = no overlap, 1.0 = perfect overlap)
    pub jaccard_index: f64,
    
    /// Hausdorff distance in pixels
    pub hausdorff_distance: f64,
    
    /// Average symmetric surface distance (ASSD) in pixels
    pub average_symmetric_surface_distance: f64,
    
    /// Root mean square error of pixel intensities
    pub rmse: f64,
    
    /// Peak signal-to-noise ratio
    pub psnr: f64,
    
    /// Structural similarity index (SSIM)
    pub ssim: f64,
    
    /// Maximum absolute difference between pixels
    pub max_absolute_difference: u8,
    
    /// Maximum absolute difference between pixels (floating point)
    pub max_absolute_error: f64,
    
    /// Number of differing pixels
    pub differing_pixels: usize,
    
    /// Total number of pixels
    pub total_pixels: usize,
    
    /// Percentage of differing pixels
    pub difference_percentage: f64,
}

/// Result of a differential test
#[derive(Debug, Clone)]
pub struct DifferentialTestResult {
    /// Test configuration
    pub test_name: String,
    pub ellipsoid: OrientedEllipsoid,
    pub slice_spec: SliceSpec,
    pub color: [u8; 4],
    
    /// Rendering outputs
    pub cpu_output: RgbaImage,
    pub gpu_output: RgbaImage,
    
    /// Comparison metrics
    pub metrics: DifferentialMetrics,
    
    /// Test verdict
    pub passed: bool,
    pub failure_reason: Option<String>,
}

/// Result of an orthogonal differential test
#[derive(Debug, Clone)]
pub struct OrthogonalTestResult {
    /// Test configuration
    pub test_name: String,
    pub ellipsoid: OrientedEllipsoid,
    pub world_coordinate: Point3<f64>,
    pub color: [u8; 4],
    
    /// CPU rendering outputs (with crosshairs)
    pub cpu_slices: OrthogonalSlices,
    
    /// GPU rendering outputs (with crosshairs)
    pub gpu_slices: OrthogonalSlices,
    
    /// Metrics for each plane
    pub axial_metrics: DifferentialMetrics,
    pub sagittal_metrics: DifferentialMetrics,
    pub coronal_metrics: DifferentialMetrics,
    
    /// Overall test verdict
    pub passed: bool,
    pub failure_reasons: Vec<String>,
}

/// Differential testing harness
pub struct DifferentialTestHarness {
    pub cpu_renderer: CpuEllipsoidRenderer,
    gpu_renderer: Option<GpuEllipsoidRenderer>,
    
    /// Tolerance thresholds for pass/fail criteria
    pub dice_threshold: f64,
    pub hausdorff_threshold: f64,
    pub rmse_threshold: f64,
    pub max_diff_threshold: u8,
    pub difference_percentage_threshold: f64,
}

impl DifferentialTestHarness {
    /// Create a new differential test harness
    pub fn new() -> Self {
        Self {
            cpu_renderer: CpuEllipsoidRenderer::new(),
            gpu_renderer: None,
            
            // Default tolerances - can be adjusted based on requirements
            dice_threshold: 0.95,           // 95% overlap required
            hausdorff_threshold: 2.0,       // Max 2 pixel difference
            rmse_threshold: 10.0,           // RMSE < 10
            max_diff_threshold: 20,         // Max single pixel diff < 20
            difference_percentage_threshold: 5.0, // Max 5% differing pixels
        }
    }
    
    /// Initialize the GPU renderer
    pub async fn init_gpu(&mut self) -> NeuroResult<()> {
        let mut gpu_renderer = GpuEllipsoidRenderer::new().await?;
        gpu_renderer.init().await?;
        self.gpu_renderer = Some(gpu_renderer);
        Ok(())
    }
    
    /// Run a single differential test
    pub async fn run_test(
        &mut self,
        test_name: &str,
        ellipsoid: &OrientedEllipsoid,
        slice_spec: &SliceSpec,
        color: [u8; 4],
    ) -> NeuroResult<DifferentialTestResult> {
        println!("Running differential test: {}", test_name);
        
        // Render with CPU
        let cpu_output = self.cpu_renderer.render_volume_slice(ellipsoid, slice_spec, color)?;
        
        // Render with GPU
        let gpu_output = if let Some(ref mut gpu_renderer) = self.gpu_renderer {
            gpu_renderer.render_volume_slice(ellipsoid, slice_spec, color).await?
        } else {
            return Err(neuro_types::Error::TestError("GPU renderer not initialized".into()));
        };
        
        // Compute metrics
        let metrics = self.compute_metrics(&cpu_output, &gpu_output)?;
        
        // Determine pass/fail
        let (passed, failure_reason) = self.evaluate_metrics(&metrics);
        
        // Clean up GPU volumes after test
        if let Some(ref mut gpu_renderer) = self.gpu_renderer {
            gpu_renderer.cleanup_volumes()?;
        }
        
        Ok(DifferentialTestResult {
            test_name: test_name.to_string(),
            ellipsoid: ellipsoid.clone(),
            slice_spec: slice_spec.clone(),
            color,
            cpu_output,
            gpu_output,
            metrics,
            passed,
            failure_reason,
        })
    }
    
    /// Run an orthogonal differential test at a specific world coordinate
    pub async fn run_orthogonal_test(
        &mut self,
        test_name: &str,
        ellipsoid: &OrientedEllipsoid,
        world_coordinate: Point3<f64>,
        color: [u8; 4],
        config: Option<OrthogonalSliceConfig>,
    ) -> NeuroResult<OrthogonalTestResult> {
        let config = config.unwrap_or_default();
        
        // Create orthogonal slice specifications
        let (axial_spec, sagittal_spec, coronal_spec) = create_orthogonal_slices(world_coordinate, &config);
        
        // Render CPU slices
        let cpu_axial = self.cpu_renderer.render_volume_slice(ellipsoid, &axial_spec, color)?;
        let cpu_sagittal = self.cpu_renderer.render_volume_slice(ellipsoid, &sagittal_spec, color)?;
        let cpu_coronal = self.cpu_renderer.render_volume_slice(ellipsoid, &coronal_spec, color)?;
        
        // Create CPU orthogonal slices structure with dimensions
        let mut cpu_slices = OrthogonalSlices {
            world_coordinate,
            axial: cpu_axial,
            sagittal: cpu_sagittal,
            coronal: cpu_coronal,
            axial_dims: ImageDimensions::new(axial_spec.dim_px[0], axial_spec.dim_px[1]),
            sagittal_dims: ImageDimensions::new(sagittal_spec.dim_px[0], sagittal_spec.dim_px[1]),
            coronal_dims: ImageDimensions::new(coronal_spec.dim_px[0], coronal_spec.dim_px[1]),
        };
        
        // Add crosshairs to CPU slices
        add_crosshairs_to_slices(&mut cpu_slices, &axial_spec, &sagittal_spec, &coronal_spec);
        
        // Render GPU slices
        let (gpu_axial, gpu_sagittal, gpu_coronal) = if let Some(ref mut gpu_renderer) = self.gpu_renderer {
            let axial = gpu_renderer.render_volume_slice(ellipsoid, &axial_spec, color).await?;
            let sagittal = gpu_renderer.render_volume_slice(ellipsoid, &sagittal_spec, color).await?;
            let coronal = gpu_renderer.render_volume_slice(ellipsoid, &coronal_spec, color).await?;
            (axial, sagittal, coronal)
        } else {
            return Err(neuro_types::Error::TestError("GPU renderer not initialized".into()));
        };
        
        // Create GPU orthogonal slices structure with dimensions
        let mut gpu_slices = OrthogonalSlices {
            world_coordinate,
            axial: gpu_axial,
            sagittal: gpu_sagittal,
            coronal: gpu_coronal,
            axial_dims: ImageDimensions::new(axial_spec.dim_px[0], axial_spec.dim_px[1]),
            sagittal_dims: ImageDimensions::new(sagittal_spec.dim_px[0], sagittal_spec.dim_px[1]),
            coronal_dims: ImageDimensions::new(coronal_spec.dim_px[0], coronal_spec.dim_px[1]),
        };
        
        // Add crosshairs to GPU slices
        add_crosshairs_to_slices(&mut gpu_slices, &axial_spec, &sagittal_spec, &coronal_spec);
        
        // Compute metrics for each plane
        let axial_metrics = self.compute_metrics(&cpu_slices.axial, &gpu_slices.axial)?;
        let sagittal_metrics = self.compute_metrics(&cpu_slices.sagittal, &gpu_slices.sagittal)?;
        let coronal_metrics = self.compute_metrics(&cpu_slices.coronal, &gpu_slices.coronal)?;
        
        // Evaluate each plane
        let mut failure_reasons = Vec::new();
        let (axial_passed, axial_reason) = self.evaluate_metrics(&axial_metrics);
        if !axial_passed {
            failure_reasons.push(format!("Axial: {}", axial_reason.unwrap_or_default()));
        }
        
        let (sagittal_passed, sagittal_reason) = self.evaluate_metrics(&sagittal_metrics);
        if !sagittal_passed {
            failure_reasons.push(format!("Sagittal: {}", sagittal_reason.unwrap_or_default()));
        }
        
        let (coronal_passed, coronal_reason) = self.evaluate_metrics(&coronal_metrics);
        if !coronal_passed {
            failure_reasons.push(format!("Coronal: {}", coronal_reason.unwrap_or_default()));
        }
        
        let passed = failure_reasons.is_empty();
        
        // Clean up GPU volumes after test
        if let Some(ref mut gpu_renderer) = self.gpu_renderer {
            gpu_renderer.cleanup_volumes()?;
        }
        
        Ok(OrthogonalTestResult {
            test_name: test_name.to_string(),
            ellipsoid: ellipsoid.clone(),
            world_coordinate,
            color,
            cpu_slices,
            gpu_slices,
            axial_metrics,
            sagittal_metrics,
            coronal_metrics,
            passed,
            failure_reasons,
        })
    }
    
    /// Run a comprehensive test suite with various ellipsoid configurations
    pub async fn run_comprehensive_suite(&mut self) -> NeuroResult<Vec<DifferentialTestResult>> {
        let mut results = Vec::new();
        
        // Test 1: Simple sphere at origin
        let sphere = OrientedEllipsoid::sphere(
            Point3::new(0.0, 0.0, 0.0),
            25.0,
            1.0,
        )?;
        let slice = SliceSpec::axial_at([0.0, 0.0, 0.0], [100.0, 100.0], [256, 256]);
        results.push(self.run_test("simple_sphere", &sphere, &slice, [255, 0, 0, 255]).await?);
        
        // Test 2: Elongated ellipsoid
        let ellipsoid = OrientedEllipsoid::new(
            Point3::new(10.0, -5.0, 2.0),
            Vector3::new(40.0, 15.0, 8.0),
            Rotation3::identity(),
            0.8,
        )?;
        results.push(self.run_test("elongated_ellipsoid", &ellipsoid, &slice, [0, 255, 0, 200]).await?);
        
        // Test 3: Rotated ellipsoid
        let rotated = OrientedEllipsoid::from_euler_angles(
            Point3::new(-10.0, 10.0, -5.0),
            Vector3::new(30.0, 20.0, 10.0),
            0.0, 0.0, std::f64::consts::PI / 4.0, // 45 degree rotation
            1.2,
        )?;
        results.push(self.run_test("rotated_ellipsoid", &rotated, &slice, [0, 0, 255, 180]).await?);
        
        // Test 4: Small ellipsoid (edge case)
        let small = OrientedEllipsoid::new(
            Point3::new(0.0, 0.0, 0.0),
            Vector3::new(3.0, 2.0, 1.5),
            Rotation3::identity(),
            0.5,
        )?;
        results.push(self.run_test("small_ellipsoid", &small, &slice, [255, 255, 0, 128]).await?);
        
        // Test 5: Large ellipsoid (edge case)
        let large = OrientedEllipsoid::new(
            Point3::new(0.0, 0.0, 0.0),
            Vector3::new(80.0, 60.0, 40.0),
            Rotation3::identity(),
            1.5,
        )?;
        results.push(self.run_test("large_ellipsoid", &large, &slice, [255, 0, 255, 255]).await?);
        
        // Test 6: Off-center slice
        let off_center_slice = SliceSpec::axial_at([0.0, 0.0, 15.0], [100.0, 100.0], [256, 256]);
        results.push(self.run_test("off_center_slice", &sphere, &off_center_slice, [128, 128, 128, 255]).await?);
        
        Ok(results)
    }
    
    /// Run a comprehensive orthogonal test suite with various world coordinates
    pub async fn run_orthogonal_suite(&mut self) -> NeuroResult<Vec<OrthogonalTestResult>> {
        let mut results = Vec::new();
        
        // Define test ellipsoids
        let sphere = OrientedEllipsoid::sphere(
            Point3::new(0.0, 0.0, 0.0),
            25.0,
            1.0,
        )?;
        
        let elongated = OrientedEllipsoid::new(
            Point3::new(0.0, 0.0, 0.0),
            Vector3::new(40.0, 20.0, 10.0),
            Rotation3::identity(),
            0.8,
        )?;
        
        let rotated = OrientedEllipsoid::from_euler_angles(
            Point3::new(0.0, 0.0, 0.0),
            Vector3::new(30.0, 20.0, 15.0),
            0.0, 0.0, std::f64::consts::PI / 4.0,
            1.2,
        )?;
        
        // Test 1: Sphere at center
        results.push(self.run_orthogonal_test(
            "sphere_center",
            &sphere,
            Point3::new(0.0, 0.0, 0.0),
            [255, 0, 0, 255],
            None,
        ).await?);
        
        // Test 2: Sphere at edge points
        results.push(self.run_orthogonal_test(
            "sphere_edge_x",
            &sphere,
            Point3::new(20.0, 0.0, 0.0),
            [255, 128, 0, 255],
            None,
        ).await?);
        
        // Test 3: Elongated ellipsoid at various points
        results.push(self.run_orthogonal_test(
            "elongated_center",
            &elongated,
            Point3::new(0.0, 0.0, 0.0),
            [0, 255, 0, 255],
            None,
        ).await?);
        
        results.push(self.run_orthogonal_test(
            "elongated_x_axis",
            &elongated,
            Point3::new(30.0, 0.0, 0.0),
            [0, 255, 128, 255],
            None,
        ).await?);
        
        // Test 4: Rotated ellipsoid
        results.push(self.run_orthogonal_test(
            "rotated_center",
            &rotated,
            Point3::new(0.0, 0.0, 0.0),
            [0, 0, 255, 255],
            None,
        ).await?);
        
        results.push(self.run_orthogonal_test(
            "rotated_off_center",
            &rotated,
            Point3::new(10.0, 10.0, 5.0),
            [128, 0, 255, 255],
            None,
        ).await?);
        
        Ok(results)
    }
    
    /// Compute comparison metrics between CPU and GPU outputs
    pub fn compute_metrics(&self, cpu_output: &RgbaImage, gpu_output: &RgbaImage) -> NeuroResult<DifferentialMetrics> {
        if cpu_output.len() != gpu_output.len() {
            return Err(neuro_types::Error::InvalidSliceSpec(
                "CPU and GPU outputs have different sizes".into()
            ));
        }
        
        let total_pixels = cpu_output.len() / 4;
        let mut differing_pixels = 0;
        let mut max_absolute_difference = 0u8;
        let mut sum_squared_error = 0.0;
        
        // Per-pixel comparison
        for i in (0..cpu_output.len()).step_by(4) {
            let cpu_pixel = [cpu_output[i], cpu_output[i+1], cpu_output[i+2], cpu_output[i+3]];
            let gpu_pixel = [gpu_output[i], gpu_output[i+1], gpu_output[i+2], gpu_output[i+3]];
            
            let mut pixel_differs = false;
            for j in 0..4 {
                let diff = (cpu_pixel[j] as i16 - gpu_pixel[j] as i16).abs() as u8;
                max_absolute_difference = max_absolute_difference.max(diff);
                
                if diff > 1 { // Allow for minor rounding differences
                    pixel_differs = true;
                }
                
                sum_squared_error += (diff as f64).powi(2);
            }
            
            if pixel_differs {
                differing_pixels += 1;
            }
        }
        
        let difference_percentage = (differing_pixels as f64 / total_pixels as f64) * 100.0;
        let rmse = (sum_squared_error / (total_pixels as f64 * 4.0)).sqrt();
        
        // Calculate PSNR (Peak Signal-to-Noise Ratio)
        let max_possible_value = 255.0;
        let psnr = if rmse > 0.0 {
            20.0 * (max_possible_value / rmse).log10()
        } else {
            f64::INFINITY // Perfect match
        };
        
        // Placeholder values for complex metrics that require more sophisticated computation
        let dice_coefficient = self.compute_dice_coefficient(cpu_output, gpu_output);
        let jaccard_index = self.compute_jaccard_index(cpu_output, gpu_output);
        let hausdorff_distance = self.compute_hausdorff_distance(cpu_output, gpu_output);
        let assd = self.compute_assd(cpu_output, gpu_output);
        let ssim = self.compute_ssim(cpu_output, gpu_output);
        let max_absolute_error = max_absolute_difference as f64;
        
        Ok(DifferentialMetrics {
            dice_coefficient,
            jaccard_index,
            hausdorff_distance,
            average_symmetric_surface_distance: assd,
            rmse,
            psnr,
            ssim,
            max_absolute_difference,
            max_absolute_error,
            differing_pixels,
            total_pixels,
            difference_percentage,
        })
    }
    
    /// Simplified Dice coefficient computation
    fn compute_dice_coefficient(&self, cpu_output: &RgbaImage, gpu_output: &RgbaImage) -> f64 {
        let mut cpu_foreground = 0;
        let mut gpu_foreground = 0;
        let mut intersection = 0;
        
        for i in (0..cpu_output.len()).step_by(4) {
            let cpu_alpha = cpu_output[i + 3];
            let gpu_alpha = gpu_output[i + 3];
            
            let cpu_fg = cpu_alpha > 10; // Threshold for foreground
            let gpu_fg = gpu_alpha > 10;
            
            if cpu_fg { cpu_foreground += 1; }
            if gpu_fg { gpu_foreground += 1; }
            if cpu_fg && gpu_fg { intersection += 1; }
        }
        
        if cpu_foreground + gpu_foreground == 0 {
            1.0 // Both images empty = perfect match
        } else {
            (2.0 * intersection as f64) / (cpu_foreground + gpu_foreground) as f64
        }
    }
    
    /// Compute Jaccard Index (Intersection over Union) for binary masks
    fn compute_jaccard_index(&self, cpu_output: &RgbaImage, gpu_output: &RgbaImage) -> f64 {
        let mut cpu_foreground = 0;
        let mut gpu_foreground = 0;
        let mut intersection = 0;
        
        for i in (0..cpu_output.len()).step_by(4) {
            let cpu_alpha = cpu_output[i + 3];
            let gpu_alpha = gpu_output[i + 3];
            
            let cpu_fg = cpu_alpha > 10; // Threshold for foreground
            let gpu_fg = gpu_alpha > 10;
            
            if cpu_fg { cpu_foreground += 1; }
            if gpu_fg { gpu_foreground += 1; }
            if cpu_fg && gpu_fg { intersection += 1; }
        }
        
        let union = cpu_foreground + gpu_foreground - intersection;
        
        if union == 0 {
            1.0 // Both images empty = perfect match
        } else {
            intersection as f64 / union as f64
        }
    }
    
    /// Simplified Hausdorff distance computation (placeholder)
    fn compute_hausdorff_distance(&self, _cpu_output: &RgbaImage, _gpu_output: &RgbaImage) -> f64 {
        // TODO: Implement proper Hausdorff distance
        // For now, return a placeholder value
        0.0
    }
    
    /// Simplified ASSD computation (placeholder)
    fn compute_assd(&self, _cpu_output: &RgbaImage, _gpu_output: &RgbaImage) -> f64 {
        // TODO: Implement proper Average Symmetric Surface Distance
        0.0
    }
    
    /// Compute Structural Similarity Index (SSIM) for image comparison
    fn compute_ssim(&self, cpu_output: &RgbaImage, gpu_output: &RgbaImage) -> f64 {
        let width = (cpu_output.len() / 4) as f64;
        let height = 1.0; // Treating as 1D for simplicity, could be enhanced for 2D
        
        // Convert RGBA to grayscale for SSIM calculation
        let cpu_gray: Vec<f64> = cpu_output.chunks(4)
            .map(|pixel| {
                // Standard RGB to grayscale conversion
                0.299 * pixel[0] as f64 + 0.587 * pixel[1] as f64 + 0.114 * pixel[2] as f64
            })
            .collect();
            
        let gpu_gray: Vec<f64> = gpu_output.chunks(4)
            .map(|pixel| {
                0.299 * pixel[0] as f64 + 0.587 * pixel[1] as f64 + 0.114 * pixel[2] as f64
            })
            .collect();
        
        // SSIM constants
        let k1 = 0.01_f64;
        let k2 = 0.03_f64;
        let l = 255.0_f64; // Dynamic range for 8-bit images
        let c1 = (k1 * l).powi(2);
        let c2 = (k2 * l).powi(2);
        
        // Compute means
        let mu1 = cpu_gray.iter().sum::<f64>() / width;
        let mu2 = gpu_gray.iter().sum::<f64>() / width;
        
        // Compute variances and covariance
        let sigma1_sq = cpu_gray.iter().map(|&x| (x - mu1).powi(2)).sum::<f64>() / (width - 1.0);
        let sigma2_sq = gpu_gray.iter().map(|&x| (x - mu2).powi(2)).sum::<f64>() / (width - 1.0);
        let sigma12 = cpu_gray.iter().zip(&gpu_gray)
            .map(|(&x1, &x2)| (x1 - mu1) * (x2 - mu2))
            .sum::<f64>() / (width - 1.0);
        
        // SSIM formula
        let numerator = (2.0 * mu1 * mu2 + c1) * (2.0 * sigma12 + c2);
        let denominator = (mu1.powi(2) + mu2.powi(2) + c1) * (sigma1_sq + sigma2_sq + c2);
        
        numerator / denominator
    }
    
    /// Evaluate metrics against thresholds to determine pass/fail
    fn evaluate_metrics(&self, metrics: &DifferentialMetrics) -> (bool, Option<String>) {
        let mut failures = Vec::new();
        
        if metrics.dice_coefficient < self.dice_threshold {
            failures.push(format!("Dice coefficient {:.3} < {:.3}", metrics.dice_coefficient, self.dice_threshold));
        }
        
        if metrics.hausdorff_distance > self.hausdorff_threshold {
            failures.push(format!("Hausdorff distance {:.1} > {:.1}", metrics.hausdorff_distance, self.hausdorff_threshold));
        }
        
        if metrics.rmse > self.rmse_threshold {
            failures.push(format!("RMSE {:.1} > {:.1}", metrics.rmse, self.rmse_threshold));
        }
        
        if metrics.max_absolute_difference > self.max_diff_threshold {
            failures.push(format!("Max pixel difference {} > {}", metrics.max_absolute_difference, self.max_diff_threshold));
        }
        
        if metrics.difference_percentage > self.difference_percentage_threshold {
            failures.push(format!("Difference percentage {:.1}% > {:.1}%", metrics.difference_percentage, self.difference_percentage_threshold));
        }
        
        if failures.is_empty() {
            (true, None)
        } else {
            (false, Some(failures.join("; ")))
        }
    }
    
    /// Generate a summary report of test results
    pub fn generate_report(&self, results: &[DifferentialTestResult]) -> String {
        let total_tests = results.len();
        let passed_tests = results.iter().filter(|r| r.passed).count();
        let failed_tests = total_tests - passed_tests;
        
        let mut report = String::new();
        report.push_str(&format!("=== Differential Testing Report ===\n"));
        report.push_str(&format!("Total tests: {}\n", total_tests));
        report.push_str(&format!("Passed: {} ({:.1}%)\n", passed_tests, (passed_tests as f64 / total_tests as f64) * 100.0));
        report.push_str(&format!("Failed: {} ({:.1}%)\n", failed_tests, (failed_tests as f64 / total_tests as f64) * 100.0));
        report.push_str("\n");
        
        for result in results {
            let status = if result.passed { "PASS" } else { "FAIL" };
            report.push_str(&format!("[{}] {}\n", status, result.test_name));
            
            if !result.passed {
                if let Some(ref reason) = result.failure_reason {
                    report.push_str(&format!("  Failure: {}\n", reason));
                }
            }
            
            report.push_str(&format!("  Dice: {:.3}, Jaccard: {:.3}, RMSE: {:.1}, SSIM: {:.3}\n",
                result.metrics.dice_coefficient,
                result.metrics.jaccard_index,
                result.metrics.rmse,
                result.metrics.ssim
            ));
            report.push_str(&format!("  Max diff: {}, Max err: {:.1}, Diff pixels: {:.1}%\n",
                result.metrics.max_absolute_difference,
                result.metrics.max_absolute_error,
                result.metrics.difference_percentage
            ));
            report.push_str("\n");
        }
        
        report
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_differential_harness_creation() {
        let harness = DifferentialTestHarness::new();
        assert!(harness.dice_threshold > 0.0);
        assert!(harness.rmse_threshold > 0.0);
    }
    
    #[tokio::test]
    async fn test_differential_harness_init() {
        let mut harness = DifferentialTestHarness::new();
        // GPU init might fail in CI/headless environments, so we just test it doesn't panic
        let _ = harness.init_gpu().await;
    }
}