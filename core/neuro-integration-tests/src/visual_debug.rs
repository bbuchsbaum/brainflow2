//! Visual debugging output for ellipsoid coordinate transformation tests
//! 
//! Generates HTML reports with side-by-side comparisons of CPU/GPU rendering,
//! slice views, difference maps, and interactive navigation.

use crate::{EllipsoidTestResults, EllipsoidTestResult};
use neuro_types::{OrientedEllipsoid, Volume, VolumeRasterizer};
use nalgebra::{Point3, Vector3, Matrix4};
use std::fs;
use std::path::Path;
use anyhow::Result;

/// Configuration for visual debug output
#[derive(Debug, Clone)]
pub struct VisualDebugConfig {
    /// Output directory for generated files
    pub output_dir: String,
    /// Generate slice images for these orientations
    pub slice_orientations: Vec<SliceOrientation>,
    /// Number of slices to generate per orientation
    pub slices_per_orientation: usize,
    /// Image dimensions (width, height)
    pub image_size: (usize, usize),
    /// Whether to generate difference maps
    pub generate_difference_maps: bool,
    /// Color schemes for different data types
    pub color_schemes: ColorSchemes,
}

#[derive(Debug, Clone)]
pub enum SliceOrientation {
    Axial,    // Z slices (XY plane)
    Coronal,  // Y slices (XZ plane) 
    Sagittal, // X slices (YZ plane)
}

#[derive(Debug, Clone)]
pub struct ColorSchemes {
    pub ground_truth: ColorScheme,
    pub cpu_result: ColorScheme,
    pub gpu_result: ColorScheme,
    pub difference: ColorScheme,
}

#[derive(Debug, Clone)]
pub enum ColorScheme {
    Grayscale,
    Viridis,
    Plasma,
    Hot,
    Jet,
}

impl Default for VisualDebugConfig {
    fn default() -> Self {
        Self {
            output_dir: "debug_output".to_string(),
            slice_orientations: vec![
                SliceOrientation::Axial,
                SliceOrientation::Coronal,
                SliceOrientation::Sagittal,
            ],
            slices_per_orientation: 5,
            image_size: (256, 256),
            generate_difference_maps: true,
            color_schemes: ColorSchemes {
                ground_truth: ColorScheme::Grayscale,
                cpu_result: ColorScheme::Viridis,
                gpu_result: ColorScheme::Plasma,
                difference: ColorScheme::Hot,
            },
        }
    }
}

/// Generates visual debugging output for ellipsoid test results
pub struct VisualDebugGenerator {
    config: VisualDebugConfig,
}

impl VisualDebugGenerator {
    pub fn new(config: VisualDebugConfig) -> Self {
        Self { config }
    }

    /// Generate complete visual debug report for test results
    pub fn generate_report(&self, results: &EllipsoidTestResults) -> Result<String> {
        // Create output directory
        fs::create_dir_all(&self.config.output_dir)?;
        
        // Generate images for each test result
        let mut test_data = Vec::new();
        for (i, result) in results.results.iter().enumerate() {
            let test_images = self.generate_test_images(result, i)?;
            test_data.push(test_images);
        }
        
        // Generate HTML report
        let html_path = format!("{}/ellipsoid_debug_report.html", self.config.output_dir);
        self.generate_html_report(&html_path, results, &test_data)?;
        
        // Copy static assets (CSS, JS)
        self.copy_static_assets()?;
        
        Ok(html_path)
    }

    /// Generate images for a single test result
    fn generate_test_images(&self, result: &EllipsoidTestResult, test_index: usize) -> Result<TestImageSet> {
        let mut image_set = TestImageSet {
            test_index,
            description: result.volume_config.clone(),
            ground_truth_images: Vec::new(),
            cpu_images: Vec::new(),
            gpu_images: Vec::new(),
            difference_images: Vec::new(),
            metrics_summary: format_metrics(&result.metrics),
        };

        // TODO: Visual debugging needs to be updated for current test structure
        // Generate ground truth volume - this requires access to original ellipsoid and volume config
        // let ground_truth_volume = self.create_ground_truth_volume(&result.config.ellipsoid, &result.config.volume_configs[0])?;
        
        // For each orientation, generate slice images
        for orientation in &self.config.slice_orientations {
            let orientation_name = format!("{:?}", orientation).to_lowercase();
            
            // Generate evenly spaced slice indices
            // TODO: Temporarily disabled until visual debugging is restructured
            // let slice_indices = self.calculate_slice_indices(&ground_truth_volume, orientation);
            let slice_indices = vec![0, 1, 2]; // Temporary placeholder
            
            for (slice_idx, slice_index) in slice_indices.iter().enumerate() {
                // TODO: Extract slices from volumes when visual debugging is restructured
                // let gt_slice = self.extract_slice(&ground_truth_volume, orientation, *slice_index)?;
                
                // Generate image filenames
                let gt_filename = format!("test_{}_gt_{}_{}.png", test_index, orientation_name, slice_idx);
                let cpu_filename = format!("test_{}_cpu_{}_{}.png", test_index, orientation_name, slice_idx);
                let gpu_filename = format!("test_{}_gpu_{}_{}.png", test_index, orientation_name, slice_idx);
                let diff_filename = format!("test_{}_diff_{}_{}.png", test_index, orientation_name, slice_idx);
                
                // TODO: Save ground truth image when available
                // let gt_path = format!("{}/{}", self.config.output_dir, gt_filename);
                // self.save_slice_image(&gt_slice, &gt_path, &self.config.color_schemes.ground_truth)?;
                
                image_set.ground_truth_images.push(SliceImage {
                    filename: gt_filename,
                    orientation: orientation.clone(),
                    slice_index: *slice_index,
                    description: format!("{:?} slice {}", orientation, slice_index),
                });

                // TODO: Add CPU and GPU slice extraction when available
                // For now, create placeholder entries
                image_set.cpu_images.push(SliceImage {
                    filename: cpu_filename,
                    orientation: orientation.clone(),
                    slice_index: *slice_index,
                    description: format!("CPU {:?} slice {}", orientation, slice_index),
                });

                if self.config.generate_difference_maps {
                    image_set.difference_images.push(SliceImage {
                        filename: diff_filename,
                        orientation: orientation.clone(),
                        slice_index: *slice_index,
                        description: format!("Difference {:?} slice {}", orientation, slice_index),
                    });
                }
            }
        }

        Ok(image_set)
    }

    /// Create ground truth volume by rasterizing ellipsoid
    fn create_ground_truth_volume(&self, ellipsoid: &OrientedEllipsoid, volume_config: &crate::VolumeConfig) -> Result<SimpleVolume> {
        let mut volume = SimpleVolume::new(
            volume_config.dimensions,
            [volume_config.spacing_mm[0] as f32, volume_config.spacing_mm[1] as f32, volume_config.spacing_mm[2] as f32],
            [volume_config.origin_mm[0] as f32, volume_config.origin_mm[1] as f32, volume_config.origin_mm[2] as f32],
        );
        
        ellipsoid.rasterize_supersampled(&mut volume, 2)?;
        Ok(volume)
    }

    /// Calculate evenly distributed slice indices for an orientation
    fn calculate_slice_indices(&self, volume: &SimpleVolume, orientation: &SliceOrientation) -> Vec<usize> {
        let max_index = match orientation {
            SliceOrientation::Axial => volume.dimensions[2],
            SliceOrientation::Coronal => volume.dimensions[1], 
            SliceOrientation::Sagittal => volume.dimensions[0],
        };
        
        let step = max_index / (self.config.slices_per_orientation + 1);
        (1..=self.config.slices_per_orientation)
            .map(|i| i * step)
            .filter(|&i| i < max_index)
            .collect()
    }

    /// Extract a 2D slice from a 3D volume
    fn extract_slice(&self, volume: &SimpleVolume, orientation: &SliceOrientation, slice_index: usize) -> Result<Vec<f32>> {
        let (width, height) = match orientation {
            SliceOrientation::Axial => (volume.dimensions[0], volume.dimensions[1]),
            SliceOrientation::Coronal => (volume.dimensions[0], volume.dimensions[2]),
            SliceOrientation::Sagittal => (volume.dimensions[1], volume.dimensions[2]),
        };
        
        let mut slice_data = vec![0.0; width * height];
        
        for y in 0..height {
            for x in 0..width {
                let coords = match orientation {
                    SliceOrientation::Axial => [x, y, slice_index],
                    SliceOrientation::Coronal => [x, slice_index, y],
                    SliceOrientation::Sagittal => [slice_index, x, y],
                };
                
                if let Some(value) = volume.get_at_coords(coords) {
                    slice_data[y * width + x] = value;
                }
            }
        }
        
        Ok(slice_data)
    }

    /// Save a 2D slice as a PNG image with specified colormap
    fn save_slice_image(&self, slice_data: &[f32], path: &str, color_scheme: &ColorScheme) -> Result<()> {
        use image::{ImageBuffer, Rgb};
        
        let (width, height) = self.config.image_size;
        let mut img = ImageBuffer::new(width as u32, height as u32);
        
        // Find data range for normalization
        let min_val = slice_data.iter().fold(f32::INFINITY, |a, &b| a.min(b));
        let max_val = slice_data.iter().fold(f32::NEG_INFINITY, |a, &b| a.max(b));
        let range = max_val - min_val;
        
        // Resize slice data to image dimensions if needed
        let resized_data = if slice_data.len() == width * height {
            slice_data.to_vec()
        } else {
            // Simple nearest neighbor resampling
            self.resize_slice_data(slice_data, width, height)?
        };
        
        for (x, y, pixel) in img.enumerate_pixels_mut() {
            let idx = (y as usize * width + x as usize).min(resized_data.len() - 1);
            let normalized = if range > 0.0 {
                (resized_data[idx] - min_val) / range
            } else {
                0.0
            }.clamp(0.0, 1.0);
            
            let color = self.apply_colormap(normalized, color_scheme);
            *pixel = Rgb([color.0, color.1, color.2]);
        }
        
        img.save(path)?;
        Ok(())
    }

    /// Resize slice data using nearest neighbor interpolation
    fn resize_slice_data(&self, data: &[f32], target_width: usize, target_height: usize) -> Result<Vec<f32>> {
        // Assume square input for simplicity
        let input_size = (data.len() as f32).sqrt() as usize;
        let mut resized = vec![0.0; target_width * target_height];
        
        for y in 0..target_height {
            for x in 0..target_width {
                let src_x = (x * input_size / target_width).min(input_size - 1);
                let src_y = (y * input_size / target_height).min(input_size - 1);
                let src_idx = src_y * input_size + src_x;
                
                if src_idx < data.len() {
                    resized[y * target_width + x] = data[src_idx];
                }
            }
        }
        
        Ok(resized)
    }

    /// Apply colormap to normalized value (0.0 to 1.0)
    fn apply_colormap(&self, value: f32, scheme: &ColorScheme) -> (u8, u8, u8) {
        match scheme {
            ColorScheme::Grayscale => {
                let intensity = (value * 255.0) as u8;
                (intensity, intensity, intensity)
            },
            ColorScheme::Viridis => {
                // Simplified viridis approximation
                let r = (value * 0.3 * 255.0) as u8;
                let g = (value * 0.9 * 255.0) as u8;
                let b = ((1.0 - value) * 0.8 * 255.0) as u8;
                (r, g, b)
            },
            ColorScheme::Plasma => {
                // Simplified plasma approximation
                let r = (value * 255.0) as u8;
                let g = (value * 0.6 * 255.0) as u8;
                let b = ((1.0 - value) * 255.0) as u8;
                (r, g, b)
            },
            ColorScheme::Hot => {
                // Hot colormap for differences
                if value < 0.33 {
                    ((value * 3.0 * 255.0) as u8, 0, 0)
                } else if value < 0.66 {
                    (255, ((value - 0.33) * 3.0 * 255.0) as u8, 0)
                } else {
                    (255, 255, ((value - 0.66) * 3.0 * 255.0) as u8)
                }
            },
            ColorScheme::Jet => {
                // Classic jet colormap
                let scaled = value * 4.0;
                if scaled < 1.0 {
                    (0, 0, (128.0 + scaled * 127.0) as u8)
                } else if scaled < 2.0 {
                    (0, ((scaled - 1.0) * 255.0) as u8, 255)
                } else if scaled < 3.0 {
                    (((scaled - 2.0) * 255.0) as u8, 255, (255.0 - (scaled - 2.0) * 255.0) as u8)
                } else {
                    (255, (255.0 - (scaled - 3.0) * 255.0) as u8, 0)
                }
            },
        }
    }

    /// Generate the main HTML report
    fn generate_html_report(&self, path: &str, results: &EllipsoidTestResults, test_data: &[TestImageSet]) -> Result<()> {
        let html_content = self.create_html_template(results, test_data)?;
        fs::write(path, html_content)?;
        Ok(())
    }

    /// Copy static CSS and JavaScript files
    fn copy_static_assets(&self) -> Result<()> {
        // Read CSS and JS from static directory
        let static_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("static");
        
        let css_path = static_dir.join("debug_report.css");
        let js_path = static_dir.join("debug_report.js");
        
        if css_path.exists() && js_path.exists() {
            let css_content = fs::read_to_string(&css_path)?;
            let js_content = fs::read_to_string(&js_path)?;
            
            fs::write(format!("{}/debug_report.css", self.config.output_dir), css_content)?;
            fs::write(format!("{}/debug_report.js", self.config.output_dir), js_content)?;
        } else {
            // Fallback: embed minimal CSS/JS inline
            self.write_embedded_assets()?;
        }
        
        Ok(())
    }

    /// Write embedded CSS and JS when static files are not available
    fn write_embedded_assets(&self) -> Result<()> {
        let minimal_css = r#"
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
        .report-header { background: #333; color: white; padding: 20px; margin: -20px -20px 20px -20px; }
        .test-section { background: white; margin: 20px 0; padding: 20px; border-radius: 8px; }
        .slice-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; }
        .slice-image { width: 100%; height: auto; border: 2px solid #ddd; }
        .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }
        .metric { background: #f9f9f9; padding: 10px; border-radius: 4px; }
        "#;
        
        let minimal_js = r#"
        document.addEventListener('DOMContentLoaded', function() {
            console.log('Debug report loaded');
            // Add basic image click handlers
            document.querySelectorAll('.slice-image').forEach(img => {
                img.addEventListener('click', function() {
                    window.open(this.src, '_blank');
                });
            });
        });
        "#;
        
        fs::write(format!("{}/debug_report.css", self.config.output_dir), minimal_css)?;
        fs::write(format!("{}/debug_report.js", self.config.output_dir), minimal_js)?;
        
        Ok(())
    }

    /// Create the HTML template with embedded data
    fn create_html_template(&self, results: &EllipsoidTestResults, test_data: &[TestImageSet]) -> Result<String> {
        let summary = results.summary();
        
        let mut html = String::new();
        html.push_str(&format!(r#"
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Ellipsoid Coordinate Transformation Debug Report</title>
    <link rel="stylesheet" href="debug_report.css">
</head>
<body>
    <header class="report-header">
        <h1>Ellipsoid Coordinate Transformation Debug Report</h1>
        <div class="summary-stats">
            <div class="stat">
                <span class="label">Total Tests:</span>
                <span class="value">{}</span>
            </div>
            <div class="stat">
                <span class="label">Passed:</span>
                <span class="value passed">{}</span>
            </div>
            <div class="stat">
                <span class="label">Failed:</span>
                <span class="value failed">{}</span>
            </div>
            <div class="stat">
                <span class="label">Avg Dice:</span>
                <span class="value">{:.4}</span>
            </div>
        </div>
    </header>

    <nav class="test-navigation">
        <h3>Test Cases</h3>
        <ul class="test-list">
"#, summary.total_tests, summary.passed, summary.failed, summary.average_dice));

        // Add navigation for each test case
        for (i, test) in test_data.iter().enumerate() {
            html.push_str(&format!(
                r#"            <li><a href="#test-{}" class="test-link" data-test="{}">{}</a></li>"#,
                i, i, test.description
            ));
        }

        html.push_str(r#"
        </ul>
    </nav>

    <main class="test-results">
"#);

        // Add detailed results for each test
        for (i, test) in test_data.iter().enumerate() {
            html.push_str(&self.create_test_section(test, i)?);
        }

        html.push_str(r#"
    </main>

    <script src="debug_report.js"></script>
</body>
</html>
"#);

        Ok(html)
    }

    /// Create HTML section for a single test
    fn create_test_section(&self, test: &TestImageSet, index: usize) -> Result<String> {
        let mut section = format!(r#"
        <section id="test-{}" class="test-section">
            <h2>Test {}: {}</h2>
            
            <div class="metrics-dashboard">
                <h3>Validation Metrics</h3>
                <div class="metrics-grid">
                    {}
                </div>
            </div>

            <div class="slice-viewer">
                <h3>Slice Comparisons</h3>
                <div class="orientation-tabs">
                    <button class="tab-button active" data-orientation="axial">Axial</button>
                    <button class="tab-button" data-orientation="coronal">Coronal</button>
                    <button class="tab-button" data-orientation="sagittal">Sagittal</button>
                </div>
"#, index, test.description, test.metrics_summary);

        // Add slice grids for each orientation
        for orientation in &["axial", "coronal", "sagittal"] {
            section.push_str(&format!(r#"
                <div class="slice-grid" data-orientation="{}">
                    <div class="comparison-row">
                        <div class="slice-column">
                            <h4>Ground Truth</h4>
                            <div class="slice-images">
"#, orientation));

            // Add ground truth images for this orientation
            for img in test.ground_truth_images.iter().filter(|img| 
                format!("{:?}", img.orientation).to_lowercase() == *orientation
            ) {
                section.push_str(&format!(
                    r#"                                <img src="{}" alt="{}" class="slice-image" data-slice="{}">"#,
                    img.filename, img.description, img.slice_index
                ));
            }

            section.push_str(r#"
                            </div>
                        </div>
                        <div class="slice-column">
                            <h4>CPU Result</h4>
                            <div class="slice-images">
                                <p class="placeholder">CPU images will be generated when slice extraction is implemented</p>
                            </div>
                        </div>
                        <div class="slice-column">
                            <h4>GPU Result</h4>
                            <div class="slice-images">
                                <p class="placeholder">GPU images will be generated when slice extraction is implemented</p>
                            </div>
                        </div>
                        <div class="slice-column">
                            <h4>Difference</h4>
                            <div class="slice-images">
                                <p class="placeholder">Difference maps will be generated when comparison data is available</p>
                            </div>
                        </div>
                    </div>
                </div>
"#);
        }

        section.push_str(r#"
            </div>
        </section>
"#);

        Ok(section)
    }
}

// Supporting data structures

#[derive(Debug, Clone)]
pub struct TestImageSet {
    pub test_index: usize,
    pub description: String,
    pub ground_truth_images: Vec<SliceImage>,
    pub cpu_images: Vec<SliceImage>,
    pub gpu_images: Vec<SliceImage>,
    pub difference_images: Vec<SliceImage>,
    pub metrics_summary: String,
}

#[derive(Debug, Clone)]
pub struct SliceImage {
    pub filename: String,
    pub orientation: SliceOrientation,
    pub slice_index: usize,
    pub description: String,
}

/// Simple volume implementation for ground truth generation
pub struct SimpleVolume {
    pub dimensions: [usize; 3],
    pub spacing: [f32; 3],
    pub origin: [f32; 3],
    pub data: Vec<f32>,
    voxel_to_world: Matrix4<f32>,
}

impl SimpleVolume {
    pub fn new(dimensions: [usize; 3], spacing: [f32; 3], origin: [f32; 3]) -> Self {
        let size = dimensions[0] * dimensions[1] * dimensions[2];
        let data = vec![0.0; size];
        
        // Create voxel-to-world transformation matrix
        let voxel_to_world = Matrix4::new(
            spacing[0], 0.0, 0.0, origin[0],
            0.0, spacing[1], 0.0, origin[1],
            0.0, 0.0, spacing[2], origin[2],
            0.0, 0.0, 0.0, 1.0,
        );
        
        Self {
            dimensions,
            spacing,
            origin,
            data,
            voxel_to_world,
        }
    }
}

impl VolumeRasterizer for SimpleVolume {
    fn dimensions(&self) -> [usize; 3] {
        self.dimensions
    }
    
    fn voxel_to_world_matrix(&self) -> Matrix4<f32> {
        self.voxel_to_world
    }
    
    fn set_at_coords(&mut self, coords: [usize; 3], value: f32) -> neuro_types::Result<()> {
        let idx = coords[2] * self.dimensions[0] * self.dimensions[1]
                + coords[1] * self.dimensions[0]
                + coords[0];
        if idx < self.data.len() {
            self.data[idx] = value;
        }
        Ok(())
    }
}

impl Volume for SimpleVolume {
    fn dimensions(&self) -> [usize; 3] {
        self.dimensions
    }
    
    fn spacing(&self) -> [f32; 3] {
        self.spacing
    }
    
    fn origin(&self) -> [f32; 3] {
        self.origin
    }
    
    fn get_at_coords(&self, coords: [usize; 3]) -> Option<f32> {
        let idx = coords[2] * self.dimensions[0] * self.dimensions[1]
                + coords[1] * self.dimensions[0]
                + coords[0];
        self.data.get(idx).copied()
    }
    
    fn voxel_to_world_matrix(&self) -> Matrix4<f32> {
        self.voxel_to_world
    }
    
    fn dtype_name(&self) -> &str {
        "f32"
    }
}

/// Format validation metrics for HTML display
fn format_metrics(metrics: &neuro_types::OverlapMetrics) -> String {
    format!(r#"
        <div class="metric">
            <span class="metric-label">Dice Coefficient:</span>
            <span class="metric-value dice-{}">{:.4}</span>
        </div>
        <div class="metric">
            <span class="metric-label">Jaccard Index:</span>
            <span class="metric-value">{:.4}</span>
        </div>
        <div class="metric">
            <span class="metric-label">Hausdorff Distance:</span>
            <span class="metric-value">{:.2} mm</span>
        </div>
        <div class="metric">
            <span class="metric-label">ASSD:</span>
            <span class="metric-value">{:.2} mm</span>
        </div>
        <div class="metric">
            <span class="metric-label">Volume Difference:</span>
            <span class="metric-value">{:.1}%</span>
        </div>
    "#, 
        if metrics.dice_coefficient > 0.95 { "excellent" } 
        else if metrics.dice_coefficient > 0.90 { "good" }
        else if metrics.dice_coefficient > 0.80 { "fair" }
        else { "poor" },
        metrics.dice_coefficient,
        metrics.jaccard_index,
        metrics.hausdorff_distance_mm,
        metrics.average_symmetric_surface_distance_mm,
        metrics.volume_difference_percent
    )
}