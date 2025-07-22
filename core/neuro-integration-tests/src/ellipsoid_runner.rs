//! Ellipsoid test runner that integrates with the differential testing framework
//! 
//! This module provides functionality to run ellipsoid-based coordinate transformation
//! tests using the existing CPU/GPU comparison infrastructure.

use crate::{EllipsoidTestConfig, EllipsoidTestResult, EllipsoidTestResults, VolumeConfig, VisualDebugGenerator, VisualDebugConfig};
use neuro_types::{
    OrientedEllipsoid, VolumeRasterizer, Volume, VolumeStore, VolumeHandle,
    SliceSpec, LayerSpec, LayerVisual, CompositeRequest,
    VolumeComparison, ValidationTolerance, Result, Error,
};
use neuro_core::{TestVolume, TestVolumeStore};
use nalgebra::{Matrix4, Point3};
use std::sync::Arc;
use std::time::Instant;

/// Runner for ellipsoid-based tests
pub struct EllipsoidTestRunner {
    /// CPU slice provider
    cpu_provider: Box<dyn neuro_types::SliceProvider>,
    
    /// GPU slice provider (optional)
    gpu_provider: Option<Box<dyn neuro_types::SliceProvider>>,
    
    /// Volume store for test volumes
    volume_store: Arc<TestVolumeStore>,
}

impl EllipsoidTestRunner {
    /// Create a new test runner with CPU provider only
    pub fn new(cpu_provider: Box<dyn neuro_types::SliceProvider>) -> Self {
        Self {
            cpu_provider,
            gpu_provider: None,
            volume_store: Arc::new(TestVolumeStore::new()),
        }
    }
    
    /// Create a test runner with both CPU and GPU providers
    pub fn with_gpu(
        cpu_provider: Box<dyn neuro_types::SliceProvider>,
        gpu_provider: Box<dyn neuro_types::SliceProvider>,
    ) -> Self {
        Self {
            cpu_provider,
            gpu_provider: Some(gpu_provider),
            volume_store: Arc::new(TestVolumeStore::new()),
        }
    }
    
    /// Run a single ellipsoid test configuration
    pub fn run_ellipsoid_test(&mut self, config: &EllipsoidTestConfig) -> EllipsoidTestResults {
        let mut results = EllipsoidTestResults::new();
        
        println!("\nRunning ellipsoid test: {}", config.description);
        println!("Ellipsoid: center={:?}, radii={:?}", 
            config.ellipsoid.center, config.ellipsoid.radii);
        
        for volume_config in &config.volume_configs {
            println!("\n  Testing volume configuration: {}", volume_config.description);
            
            match self.run_single_volume_test(&config.ellipsoid, volume_config, &config.tolerance) {
                Ok(result) => {
                    println!("    Dice: {:.4}, Passed: {}", 
                        result.metrics.dice_coefficient, result.passed);
                    results.add_result(result);
                }
                Err(e) => {
                    eprintln!("    ERROR: {}", e);
                }
            }
        }
        
        results
    }
    
    /// Run test with a single volume configuration
    fn run_single_volume_test(
        &mut self,
        ellipsoid: &OrientedEllipsoid,
        volume_config: &VolumeConfig,
        tolerance: &ValidationTolerance,
    ) -> Result<EllipsoidTestResult> {
        // Create the test volume
        let mut test_volume = create_test_volume(volume_config);
        
        // Rasterize the ellipsoid into the volume (ground truth)
        let start = Instant::now();
        ellipsoid.rasterize_supersampled(&mut test_volume, 2)?;
        let rasterize_time = start.elapsed();
        println!("    Rasterization took {:.2} ms", rasterize_time.as_secs_f64() * 1000.0);
        
        // Store the volume
        let volume_handle = self.volume_store.add_volume(Arc::new(test_volume));
        
        // Create slice specifications to test
        let slice_specs = create_test_slices(volume_config);
        
        // Run tests on different slices
        let mut all_metrics = Vec::new();
        let mut total_cpu_time = 0.0;
        let mut total_gpu_time = 0.0;
        
        for (slice_name, slice_spec) in slice_specs {
            println!("    Testing slice: {}", slice_name);
            
            // Create composite request
            let request = create_composite_request(volume_handle, &slice_spec);
            
            // Extract slice using CPU
            let cpu_start = Instant::now();
            let cpu_slice = self.cpu_provider.composite_rgba(&request)?;
            let cpu_time = cpu_start.elapsed();
            total_cpu_time += cpu_time.as_secs_f64() * 1000.0;
            
            // Extract slice using GPU if available
            let gpu_slice = if let Some(gpu) = &self.gpu_provider {
                let gpu_start = Instant::now();
                let result = gpu.composite_rgba(&request)?;
                let gpu_time = gpu_start.elapsed();
                total_gpu_time += gpu_time.as_secs_f64() * 1000.0;
                Some(result)
            } else {
                None
            };
            
            // Convert slices to volumes for comparison
            let cpu_slice_vol = rgba_to_volume(&cpu_slice, &slice_spec);
            
            // Rasterize ellipsoid directly into slice space for comparison
            let mut ground_truth_slice = create_slice_volume(&slice_spec);
            rasterize_ellipsoid_to_slice(ellipsoid, &mut ground_truth_slice, &slice_spec)?;
            
            // Compute metrics
            let metrics = VolumeComparison::compute_metrics(
                &ground_truth_slice,
                &cpu_slice_vol,
                ellipsoid.intensity * 0.5,
                None,
            )?;
            
            all_metrics.push(metrics);
        }
        
        // Aggregate metrics
        let aggregated_metrics = aggregate_metrics(&all_metrics);
        let passed = aggregated_metrics.passes_tolerances(tolerance);
        
        // Clean up
        self.volume_store.remove_volume(&volume_handle);
        
        Ok(EllipsoidTestResult {
            test_name: config.description.clone(),
            volume_config: volume_config.description.clone(),
            metrics: aggregated_metrics,
            passed,
            cpu_time_ms: total_cpu_time,
            gpu_time_ms: if self.gpu_provider.is_some() { Some(total_gpu_time) } else { None },
        })
    }
    
    /// Run a suite of ellipsoid tests
    pub fn run_test_suite(&mut self, configs: Vec<EllipsoidTestConfig>) -> EllipsoidTestResults {
        let mut all_results = EllipsoidTestResults::new();
        
        for config in configs {
            let results = self.run_ellipsoid_test(&config);
            for result in results.results {
                all_results.add_result(result);
            }
        }
        
        all_results
    }
    
    /// Run test suite and generate visual debug report
    pub fn run_test_suite_with_visual_debug(
        &mut self, 
        configs: Vec<EllipsoidTestConfig>,
        debug_config: Option<VisualDebugConfig>
    ) -> Result<(EllipsoidTestResults, String)> {
        let results = self.run_test_suite(configs);
        
        let debug_config = debug_config.unwrap_or_default();
        let visual_debug = VisualDebugGenerator::new(debug_config);
        
        let report_path = visual_debug.generate_report(&results)?;
        
        println!("\nVisual debug report generated: {}", report_path);
        
        Ok((results, report_path))
    }
    
    /// Generate visual debug report for existing results
    pub fn generate_visual_debug_report(
        results: &EllipsoidTestResults,
        debug_config: Option<VisualDebugConfig>
    ) -> Result<String> {
        let debug_config = debug_config.unwrap_or_default();
        let visual_debug = VisualDebugGenerator::new(debug_config);
        
        let report_path = visual_debug.generate_report(results)?;
        
        println!("Visual debug report generated: {}", report_path);
        
        Ok(report_path)
    }
}

/// Volume wrapper for rasterization
struct RasterVolume {
    volume: TestVolume,
}

impl VolumeRasterizer for RasterVolume {
    fn dimensions(&self) -> [usize; 3] {
        self.volume.dimensions()
    }
    
    fn voxel_to_world_matrix(&self) -> Matrix4<f32> {
        self.volume.voxel_to_world_matrix()
    }
    
    fn set_at_coords(&mut self, coords: [usize; 3], value: f32) -> Result<()> {
        let idx = coords[2] * self.dimensions()[0] * self.dimensions()[1]
                + coords[1] * self.dimensions()[0]
                + coords[0];
        
        if idx >= self.volume.data_mut().len() {
            return Err(Error::InvalidSliceSpec(format!(
                "Coordinates {:?} out of bounds", coords
            )));
        }
        
        self.volume.data_mut()[idx] = value;
        Ok(())
    }
}

/// Create a test volume from configuration
fn create_test_volume(config: &VolumeConfig) -> RasterVolume {
    let spacing = [
        config.spacing_mm[0] as f32,
        config.spacing_mm[1] as f32,
        config.spacing_mm[2] as f32,
    ];
    
    let origin = [
        config.origin_mm[0] as f32,
        config.origin_mm[1] as f32,
        config.origin_mm[2] as f32,
    ];
    
    let volume = if let Some(orientation) = &config.orientation {
        // Create custom transformation matrix
        let mut voxel_to_world = Matrix4::new_translation(&nalgebra::Vector3::from(origin))
            * Matrix4::new_nonuniform_scaling(&nalgebra::Vector3::from(spacing));
        
        // Apply orientation
        let orientation_f32 = Matrix4::new(
            orientation[(0, 0)] as f32, orientation[(0, 1)] as f32, 
            orientation[(0, 2)] as f32, orientation[(0, 3)] as f32,
            orientation[(1, 0)] as f32, orientation[(1, 1)] as f32,
            orientation[(1, 2)] as f32, orientation[(1, 3)] as f32,
            orientation[(2, 0)] as f32, orientation[(2, 1)] as f32,
            orientation[(2, 2)] as f32, orientation[(2, 3)] as f32,
            orientation[(3, 0)] as f32, orientation[(3, 1)] as f32,
            orientation[(3, 2)] as f32, orientation[(3, 3)] as f32,
        );
        
        voxel_to_world = orientation_f32 * voxel_to_world;
        TestVolume::with_transform(config.dimensions, voxel_to_world)
    } else {
        TestVolume::new(config.dimensions, spacing, origin)
    };
    
    RasterVolume { volume }
}

/// Create test slice specifications
fn create_test_slices(volume_config: &VolumeConfig) -> Vec<(&'static str, SliceSpec)> {
    let center_world = [
        volume_config.origin_mm[0] as f32 + 
            (volume_config.dimensions[0] as f32 * volume_config.spacing_mm[0] as f32) / 2.0,
        volume_config.origin_mm[1] as f32 + 
            (volume_config.dimensions[1] as f32 * volume_config.spacing_mm[1] as f32) / 2.0,
        volume_config.origin_mm[2] as f32 + 
            (volume_config.dimensions[2] as f32 * volume_config.spacing_mm[2] as f32) / 2.0,
    ];
    
    vec![
        // Axial slice at center
        ("Axial", SliceSpec {
            origin_mm: [
                volume_config.origin_mm[0] as f32,
                volume_config.origin_mm[1] as f32,
                center_world[2],
            ],
            u_mm: [volume_config.spacing_mm[0] as f32, 0.0, 0.0],
            v_mm: [0.0, volume_config.spacing_mm[1] as f32, 0.0],
            dim_px: [volume_config.dimensions[0] as u32, volume_config.dimensions[1] as u32],
            interp: neuro_types::InterpolationMethod::Linear,
            border_mode: neuro_types::BorderMode::Transparent,
        }),
        
        // Coronal slice at center
        ("Coronal", SliceSpec {
            origin_mm: [
                volume_config.origin_mm[0] as f32,
                center_world[1],
                volume_config.origin_mm[2] as f32,
            ],
            u_mm: [volume_config.spacing_mm[0] as f32, 0.0, 0.0],
            v_mm: [0.0, 0.0, volume_config.spacing_mm[2] as f32],
            dim_px: [volume_config.dimensions[0] as u32, volume_config.dimensions[2] as u32],
            interp: neuro_types::InterpolationMethod::Linear,
            border_mode: neuro_types::BorderMode::Transparent,
        }),
        
        // Sagittal slice at center
        ("Sagittal", SliceSpec {
            origin_mm: [
                center_world[0],
                volume_config.origin_mm[1] as f32,
                volume_config.origin_mm[2] as f32,
            ],
            u_mm: [0.0, volume_config.spacing_mm[1] as f32, 0.0],
            v_mm: [0.0, 0.0, volume_config.spacing_mm[2] as f32],
            dim_px: [volume_config.dimensions[1] as u32, volume_config.dimensions[2] as u32],
            interp: neuro_types::InterpolationMethod::Linear,
            border_mode: neuro_types::BorderMode::Transparent,
        }),
    ]
}

/// Create composite request for slice extraction
fn create_composite_request(volume_handle: VolumeHandle, slice_spec: &SliceSpec) -> CompositeRequest {
    CompositeRequest {
        slice_spec: slice_spec.clone(),
        layers: vec![
            LayerSpec {
                volume_id: volume_handle,
                world_from_voxel: Matrix4::identity(), // Already in world space
                visual: LayerVisual {
                    opacity: 1.0,
                    colormap: neuro_types::Colormap::Grayscale,
                    intensity_range: [0.0, 255.0],
                    threshold: None,
                },
            },
        ],
    }
}

/// Convert RGBA image to volume for comparison
fn rgba_to_volume(rgba: &neuro_types::RgbaImage, slice_spec: &SliceSpec) -> SliceVolume {
    SliceVolume {
        data: rgba.clone(),
        slice_spec: slice_spec.clone(),
    }
}

/// Simple slice volume for metrics computation
struct SliceVolume {
    data: neuro_types::RgbaImage,
    slice_spec: SliceSpec,
}

impl Volume for SliceVolume {
    fn dimensions(&self) -> [usize; 3] {
        [self.slice_spec.dim_px[0] as usize, self.slice_spec.dim_px[1] as usize, 1]
    }
    
    fn spacing(&self) -> [f32; 3] {
        let u_spacing = (self.slice_spec.u_mm[0].powi(2) + 
                        self.slice_spec.u_mm[1].powi(2) + 
                        self.slice_spec.u_mm[2].powi(2)).sqrt();
        let v_spacing = (self.slice_spec.v_mm[0].powi(2) + 
                        self.slice_spec.v_mm[1].powi(2) + 
                        self.slice_spec.v_mm[2].powi(2)).sqrt();
        [u_spacing, v_spacing, 1.0]
    }
    
    fn origin(&self) -> [f32; 3] {
        self.slice_spec.origin_mm
    }
    
    fn get_at_coords(&self, coords: [usize; 3]) -> Option<f32> {
        if coords[2] != 0 || 
           coords[0] >= self.slice_spec.dim_px[0] as usize ||
           coords[1] >= self.slice_spec.dim_px[1] as usize {
            return None;
        }
        
        let idx = (coords[1] * self.slice_spec.dim_px[0] as usize + coords[0]) * 4;
        // Use red channel as intensity
        Some(self.data[idx] as f32)
    }
    
    fn voxel_to_world_matrix(&self) -> Matrix4<f32> {
        // Build matrix from slice spec
        let mut matrix = Matrix4::identity();
        
        // Set columns from u, v vectors
        matrix[(0, 0)] = self.slice_spec.u_mm[0];
        matrix[(1, 0)] = self.slice_spec.u_mm[1];
        matrix[(2, 0)] = self.slice_spec.u_mm[2];
        
        matrix[(0, 1)] = self.slice_spec.v_mm[0];
        matrix[(1, 1)] = self.slice_spec.v_mm[1];
        matrix[(2, 1)] = self.slice_spec.v_mm[2];
        
        // Translation
        matrix[(0, 3)] = self.slice_spec.origin_mm[0];
        matrix[(1, 3)] = self.slice_spec.origin_mm[1];
        matrix[(2, 3)] = self.slice_spec.origin_mm[2];
        
        matrix
    }
    
    fn dtype_name(&self) -> &str {
        "u8"
    }
}

/// Create a slice volume for ground truth
fn create_slice_volume(slice_spec: &SliceSpec) -> SliceVolume {
    let size = (slice_spec.dim_px[0] * slice_spec.dim_px[1] * 4) as usize;
    SliceVolume {
        data: neuro_types::RgbaImage {
            data: vec![0; size],
            width: slice_spec.dim_px[0],
            height: slice_spec.dim_px[1],
        },
        slice_spec: slice_spec.clone(),
    }
}

/// Rasterize ellipsoid into a slice
fn rasterize_ellipsoid_to_slice(
    ellipsoid: &OrientedEllipsoid,
    slice_volume: &mut SliceVolume,
    slice_spec: &SliceSpec,
) -> Result<()> {
    let width = slice_spec.dim_px[0] as usize;
    let height = slice_spec.dim_px[1] as usize;
    
    // Sample with 2x2 supersampling
    for y in 0..height {
        for x in 0..width {
            let mut count = 0u32;
            
            // Supersample within pixel
            for sy in 0..2 {
                for sx in 0..2 {
                    // Compute world position
                    let u = (x as f32 + sx as f32 * 0.5 + 0.25) * slice_spec.u_mm[0] +
                            (y as f32 + sy as f32 * 0.5 + 0.25) * slice_spec.v_mm[0] +
                            slice_spec.origin_mm[0];
                    let v = (x as f32 + sx as f32 * 0.5 + 0.25) * slice_spec.u_mm[1] +
                            (y as f32 + sy as f32 * 0.5 + 0.25) * slice_spec.v_mm[1] +
                            slice_spec.origin_mm[1];
                    let w = (x as f32 + sx as f32 * 0.5 + 0.25) * slice_spec.u_mm[2] +
                            (y as f32 + sy as f32 * 0.5 + 0.25) * slice_spec.v_mm[2] +
                            slice_spec.origin_mm[2];
                    
                    let world_pos = Point3::new(u as f64, v as f64, w as f64);
                    
                    if ellipsoid.contains_point(&world_pos) {
                        count += 1;
                    }
                }
            }
            
            // Set pixel value based on coverage
            if count > 0 {
                let value = (ellipsoid.intensity * count as f32 / 4.0) as u8;
                let idx = (y * width + x) * 4;
                slice_volume.data[idx] = value;
                slice_volume.data[idx + 1] = value;
                slice_volume.data[idx + 2] = value;
                slice_volume.data[idx + 3] = 255;
            }
        }
    }
    
    Ok(())
}

/// Aggregate multiple metrics into a single result
fn aggregate_metrics(metrics: &[neuro_types::OverlapMetrics]) -> neuro_types::OverlapMetrics {
    if metrics.is_empty() {
        return neuro_types::OverlapMetrics {
            dice_coefficient: 0.0,
            jaccard_index: 0.0,
            volume_difference_percent: 0.0,
            volume_difference_mm3: 0.0,
            hausdorff_distance_mm: 0.0,
            hausdorff_95_percentile_mm: 0.0,
            average_symmetric_surface_distance_mm: 0.0,
            center_of_mass_distance_mm: 0.0,
            max_absolute_difference: 0.0,
            contains_nan: false,
            contains_inf: false,
        };
    }
    
    let n = metrics.len() as f64;
    
    neuro_types::OverlapMetrics {
        dice_coefficient: metrics.iter().map(|m| m.dice_coefficient).sum::<f64>() / n,
        jaccard_index: metrics.iter().map(|m| m.jaccard_index).sum::<f64>() / n,
        volume_difference_percent: metrics.iter().map(|m| m.volume_difference_percent).sum::<f64>() / n,
        volume_difference_mm3: metrics.iter().map(|m| m.volume_difference_mm3).sum::<f64>() / n,
        hausdorff_distance_mm: metrics.iter().map(|m| m.hausdorff_distance_mm).fold(0.0f64, f64::max),
        hausdorff_95_percentile_mm: metrics.iter().map(|m| m.hausdorff_95_percentile_mm).fold(0.0f64, f64::max),
        average_symmetric_surface_distance_mm: metrics.iter().map(|m| m.average_symmetric_surface_distance_mm).sum::<f64>() / n,
        center_of_mass_distance_mm: metrics.iter().map(|m| m.center_of_mass_distance_mm).sum::<f64>() / n,
        max_absolute_difference: metrics.iter().map(|m| m.max_absolute_difference).fold(0.0f32, f32::max),
        contains_nan: metrics.iter().any(|m| m.contains_nan),
        contains_inf: metrics.iter().any(|m| m.contains_inf),
    }
}