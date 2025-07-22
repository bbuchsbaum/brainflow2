//! Differential Testing Visual Dashboard
//! 
//! Comprehensive dashboard showing CPU vs GPU rendering comparisons with visual difference maps,
//! enhanced metrics, and detailed analysis for differential testing validation.

use crate::differential_harness::{DifferentialTestHarness, DifferentialTestResult};
use neuro_types::{RgbaImage, OrientedEllipsoid, SliceSpec};
use std::fs;
use std::path::Path;
use anyhow::Result;
use image::{ImageBuffer, Rgba, RgbaImage as ImageRgbaImage};

/// Differential testing dashboard with CPU vs GPU visualization
pub struct DifferentialDashboard {
    output_dir: String,
}

impl DifferentialDashboard {
    pub fn new(output_dir: String) -> Self {
        Self { output_dir }
    }
    
    /// Generate comprehensive differential testing dashboard
    pub async fn generate_dashboard(
        &self,
        test_results: &[DifferentialTestResult],
    ) -> Result<String> {
        // Create output directory structure
        fs::create_dir_all(&self.output_dir)?;
        fs::create_dir_all(&format!("{}/images", self.output_dir))?;
        fs::create_dir_all(&format!("{}/difference_maps", self.output_dir))?;
        
        // Generate difference maps for each test
        let mut image_paths = Vec::new();
        for (i, result) in test_results.iter().enumerate() {
            let paths = self.generate_comparison_images(result, i).await?;
            image_paths.push(paths);
        }
        
        // Generate HTML dashboard
        let html = self.generate_html(test_results, &image_paths)?;
        let html_path = format!("{}/differential_dashboard.html", self.output_dir);
        fs::write(&html_path, html)?;
        
        // Generate assets
        self.generate_assets()?;
        
        Ok(html_path)
    }
    
    /// Generate comparison images: CPU, GPU, and difference map
    async fn generate_comparison_images(
        &self,
        result: &DifferentialTestResult,
        test_index: usize,
    ) -> Result<ComparisonImagePaths> {
        let base_name = format!("test_{}", test_index);
        
        // Save CPU image
        let cpu_path = format!("{}/images/{}_cpu.png", self.output_dir, base_name);
        self.save_rgba_as_png(&result.cpu_output, &cpu_path)?;
        
        // Save GPU image
        let gpu_path = format!("{}/images/{}_gpu.png", self.output_dir, base_name);
        self.save_rgba_as_png(&result.gpu_output, &gpu_path)?;
        
        // Generate difference map
        let diff_path = format!("{}/difference_maps/{}_diff.png", self.output_dir, base_name);
        self.generate_difference_map(&result.cpu_output, &result.gpu_output, &diff_path)?;
        
        // Generate combined comparison image
        let combined_path = format!("{}/images/{}_combined.png", self.output_dir, base_name);
        self.generate_combined_image(&cpu_path, &gpu_path, &diff_path, &combined_path)?;
        
        Ok(ComparisonImagePaths {
            cpu_image: cpu_path,
            gpu_image: gpu_path,
            difference_map: diff_path,
            combined_image: combined_path,
        })
    }
    
    /// Save RGBA data as PNG image
    /// 
    /// This function attempts to determine dimensions from known patterns
    /// The MNI brain template with 256x256 max dimensions produces:
    /// - Axial: 216x256 pixels (55296 pixels, 221184 bytes)
    /// - Sagittal: 256x216 pixels (55296 pixels, 221184 bytes)  
    /// - Coronal: 256x256 pixels (65536 pixels, 262144 bytes)
    fn save_rgba_as_png(&self, rgba_data: &RgbaImage, path: &str) -> Result<()> {
        let total_pixels = rgba_data.len() / 4;
        
        // Determine dimensions based on known MNI volume patterns
        let (width, height) = match total_pixels {
            55296 => {
                // Could be 216x256 (axial) or 256x216 (sagittal)
                // Use filename hint to determine orientation
                if path.contains("axial") {
                    (216, 256)
                } else if path.contains("sagittal") {
                    (256, 216)
                } else {
                    // Default to square approximation if unsure
                    let size = ((total_pixels as f64).sqrt() as u32);
                    (size, size)
                }
            },
            65536 => (256, 256), // Coronal is square
            _ => {
                // For other sizes, try common aspect ratios
                // First check if it's a perfect square
                let sqrt_size = (total_pixels as f64).sqrt();
                if sqrt_size.fract() < 0.0001 {
                    let size = sqrt_size as u32;
                    (size, size)
                } else {
                    // Try to find dimensions that multiply to total_pixels
                    // This is a fallback - ideally dimensions should be passed explicitly
                    for width in 1..=512 {
                        if total_pixels % width == 0 {
                            let height = total_pixels / width;
                            if height <= 512 {
                                return self.save_with_dimensions(rgba_data, width as u32, height as u32, path);
                            }
                        }
                    }
                    // Last resort: use square approximation
                    let size = ((total_pixels as f64).sqrt() as u32);
                    (size, size)
                }
            }
        };
        
        self.save_with_dimensions(rgba_data, width, height, path)
    }
    
    /// Save RGBA data with explicit dimensions
    fn save_with_dimensions(&self, rgba_data: &RgbaImage, width: u32, height: u32, path: &str) -> Result<()> {
        let expected_len = (width * height * 4) as usize;
        if rgba_data.len() != expected_len {
            return Err(anyhow::anyhow!(
                "Image data length {} doesn't match dimensions {}x{} (expected {} bytes)", 
                rgba_data.len(), width, height, expected_len
            ));
        }
        
        let img: ImageRgbaImage = ImageBuffer::from_raw(width, height, rgba_data.clone())
            .ok_or_else(|| anyhow::anyhow!("Failed to create image from raw data"))?;
        
        img.save(path)?;
        Ok(())
    }
    
    /// Generate visual difference map highlighting discrepancies
    fn generate_difference_map(
        &self,
        cpu_data: &RgbaImage,
        gpu_data: &RgbaImage,
        output_path: &str,
    ) -> Result<()> {
        if cpu_data.len() != gpu_data.len() {
            return Err(anyhow::anyhow!("CPU and GPU images have different sizes"));
        }
        
        let total_pixels = cpu_data.len() / 4;
        
        // Determine dimensions using the same logic as save_rgba_as_png
        let (width, height) = match total_pixels {
            55296 => {
                // Could be 216x256 (axial) or 256x216 (sagittal)
                // Use filename hint to determine orientation
                if output_path.contains("axial") {
                    (216, 256)
                } else if output_path.contains("sagittal") {
                    (256, 216)
                } else {
                    // Default to square approximation if unsure
                    let size = ((total_pixels as f64).sqrt() as u32);
                    (size, size)
                }
            },
            65536 => (256, 256), // Coronal is square
            _ => {
                // For other sizes, assume square
                let size = ((total_pixels as f64).sqrt() as u32);
                (size, size)
            }
        };
        
        let mut diff_data = Vec::with_capacity(cpu_data.len());
        
        // Create difference map with enhanced visualization
        for i in (0..cpu_data.len()).step_by(4) {
            let cpu_pixel = [cpu_data[i], cpu_data[i+1], cpu_data[i+2], cpu_data[i+3]];
            let gpu_pixel = [gpu_data[i], gpu_data[i+1], gpu_data[i+2], gpu_data[i+3]];
            
            // Calculate per-channel differences
            let r_diff = (cpu_pixel[0] as i16 - gpu_pixel[0] as i16).abs() as u8;
            let g_diff = (cpu_pixel[1] as i16 - gpu_pixel[1] as i16).abs() as u8;
            let b_diff = (cpu_pixel[2] as i16 - gpu_pixel[2] as i16).abs() as u8;
            let a_diff = (cpu_pixel[3] as i16 - gpu_pixel[3] as i16).abs() as u8;
            
            // Calculate magnitude of difference
            let magnitude = ((r_diff as f64).powi(2) + (g_diff as f64).powi(2) + 
                           (b_diff as f64).powi(2) + (a_diff as f64).powi(2)).sqrt();
            
            if magnitude > 1.0 {
                // Significant difference - highlight in red/yellow gradient
                let intensity = (magnitude / 255.0 * 255.0) as u8;
                diff_data.extend_from_slice(&[255, intensity, 0, 255]); // Red-yellow based on magnitude
            } else {
                // No significant difference - show as grayscale average
                let avg = ((cpu_pixel[0] as u16 + gpu_pixel[0] as u16) / 2) as u8;
                diff_data.extend_from_slice(&[avg, avg, avg, 128]); // Semi-transparent grayscale
            }
        }
        
        let diff_img: ImageRgbaImage = ImageBuffer::from_raw(width, height, diff_data)
            .ok_or_else(|| anyhow::anyhow!("Failed to create difference image"))?;
        
        diff_img.save(output_path)?;
        Ok(())
    }
    
    /// Generate combined side-by-side comparison image
    fn generate_combined_image(
        &self,
        cpu_path: &str,
        gpu_path: &str,
        diff_path: &str,
        output_path: &str,
    ) -> Result<()> {
        use image::io::Reader as ImageReader;
        
        let cpu_img = ImageReader::open(cpu_path)?.decode()?.to_rgba8();
        let gpu_img = ImageReader::open(gpu_path)?.decode()?.to_rgba8();
        let diff_img = ImageReader::open(diff_path)?.decode()?.to_rgba8();
        
        let (width, height) = cpu_img.dimensions();
        let combined_width = width * 3 + 40; // 3 images + spacing
        let combined_height = height + 60; // Extra space for labels
        
        let mut combined = ImageRgbaImage::new(combined_width, combined_height);
        
        // Fill background
        for pixel in combined.pixels_mut() {
            *pixel = Rgba([240, 240, 240, 255]);
        }
        
        // Copy images side by side
        image::imageops::overlay(&mut combined, &cpu_img, 10, 30);
        image::imageops::overlay(&mut combined, &gpu_img, width as i64 + 20, 30);
        image::imageops::overlay(&mut combined, &diff_img, (width * 2) as i64 + 30, 30);
        
        combined.save(output_path)?;
        Ok(())
    }
    
    /// Generate HTML dashboard
    fn generate_html(
        &self,
        test_results: &[DifferentialTestResult],
        image_paths: &[ComparisonImagePaths],
    ) -> Result<String> {
        let mut html = String::new();
        html.push_str(r#"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Differential Testing Dashboard - CPU vs GPU</title>
    <link rel="stylesheet" href="differential_dashboard.css">
</head>
<body>
    <div class="container">
        <header>
            <h1>🔬 Differential Testing Dashboard</h1>
            <p>CPU vs GPU Rendering Comparison Analysis</p>
        </header>
        
        <div class="summary-section">
            <h2>Test Summary</h2>
"#);
        
        // Calculate summary statistics
        let total = test_results.len();
        let passed = test_results.iter().filter(|r| r.passed).count();
        let failed = total - passed;
        let avg_dice = if total > 0 {
            test_results.iter().map(|r| r.metrics.dice_coefficient).sum::<f64>() / total as f64
        } else { 0.0 };
        let avg_ssim = if total > 0 {
            test_results.iter().map(|r| r.metrics.ssim).sum::<f64>() / total as f64
        } else { 0.0 };
        let avg_jaccard = if total > 0 {
            test_results.iter().map(|r| r.metrics.jaccard_index).sum::<f64>() / total as f64
        } else { 0.0 };
        
        html.push_str(&format!(r#"
            <div class="summary-grid">
                <div class="summary-card">
                    <div class="metric-value">{}</div>
                    <div class="metric-label">Total Tests</div>
                </div>
                <div class="summary-card passed">
                    <div class="metric-value">{}</div>
                    <div class="metric-label">Passed</div>
                </div>
                <div class="summary-card failed">
                    <div class="metric-value">{}</div>
                    <div class="metric-label">Failed</div>
                </div>
                <div class="summary-card">
                    <div class="metric-value">{:.3}</div>
                    <div class="metric-label">Avg Dice</div>
                </div>
                <div class="summary-card">
                    <div class="metric-value">{:.3}</div>
                    <div class="metric-label">Avg SSIM</div>
                </div>
                <div class="summary-card">
                    <div class="metric-value">{:.3}</div>
                    <div class="metric-label">Avg Jaccard</div>
                </div>
            </div>
        </div>
        
        <div class="tests-section">
            <h2>Differential Test Results</h2>
"#, total, passed, failed, avg_dice, avg_ssim, avg_jaccard));
        
        // Generate test result cards
        for (i, (result, paths)) in test_results.iter().zip(image_paths.iter()).enumerate() {
            let status_class = if result.passed { "passed" } else { "failed" };
            let status_icon = if result.passed { "✅" } else { "❌" };
            
            html.push_str(&format!(r#"
            <div class="test-card {}" data-test-index="{}">
                <div class="test-header">
                    <h3>{} {}</h3>
                    <div class="test-status">{}</div>
                </div>
                
                <div class="comparison-section">
                    <div class="image-comparison">
                        <div class="image-group">
                            <h4>CPU Reference</h4>
                            <img src="{}" alt="CPU rendering" class="comparison-image cpu-image">
                        </div>
                        <div class="image-group">
                            <h4>GPU Implementation</h4>
                            <img src="{}" alt="GPU rendering" class="comparison-image gpu-image">
                        </div>
                        <div class="image-group">
                            <h4>Difference Map</h4>
                            <img src="{}" alt="Difference map" class="comparison-image diff-image">
                        </div>
                    </div>
                </div>
                
                <div class="metrics-section">
                    <div class="metrics-grid">
                        <div class="metric-card">
                            <div class="metric-title">Overlap Metrics</div>
                            <div class="metric-row">
                                <span>Dice Coefficient:</span>
                                <span class="metric-value">{:.6}</span>
                            </div>
                            <div class="metric-row">
                                <span>Jaccard Index:</span>
                                <span class="metric-value">{:.6}</span>
                            </div>
                        </div>
                        
                        <div class="metric-card">
                            <div class="metric-title">Image Quality</div>
                            <div class="metric-row">
                                <span>SSIM:</span>
                                <span class="metric-value">{:.6}</span>
                            </div>
                            <div class="metric-row">
                                <span>PSNR:</span>
                                <span class="metric-value">{:.2} dB</span>
                            </div>
                        </div>
                        
                        <div class="metric-card">
                            <div class="metric-title">Pixel Differences</div>
                            <div class="metric-row">
                                <span>RMSE:</span>
                                <span class="metric-value">{:.3}</span>
                            </div>
                            <div class="metric-row">
                                <span>Max Error:</span>
                                <span class="metric-value">{:.1}</span>
                            </div>
                            <div class="metric-row">
                                <span>Diff Pixels:</span>
                                <span class="metric-value">{:.1}%</span>
                            </div>
                        </div>
                    </div>
                </div>
"#, 
                status_class, i, status_icon, result.test_name, 
                if result.passed { "PASS" } else { "FAIL" },
                paths.cpu_image.replace(&self.output_dir, "."),
                paths.gpu_image.replace(&self.output_dir, "."),
                paths.difference_map.replace(&self.output_dir, "."),
                result.metrics.dice_coefficient,
                result.metrics.jaccard_index,
                result.metrics.ssim,
                if result.metrics.psnr.is_infinite() { 999.0 } else { result.metrics.psnr },
                result.metrics.rmse,
                result.metrics.max_absolute_error,
                result.metrics.difference_percentage
            ));
            
            // Add failure reason if test failed
            if !result.passed {
                if let Some(ref reason) = result.failure_reason {
                    html.push_str(&format!(r#"
                <div class="failure-section">
                    <h4>Failure Analysis</h4>
                    <p class="failure-reason">{}</p>
                </div>
"#, reason));
                }
            }
            
            html.push_str("            </div>\n");
        }
        
        html.push_str(r#"
        </div>
        
        <footer>
            <p>Generated by Brainflow2 Differential Testing Framework</p>
        </footer>
    </div>
    
    <script src="differential_dashboard.js"></script>
</body>
</html>"#);
        
        Ok(html)
    }
    
    /// Generate CSS and JavaScript assets
    fn generate_assets(&self) -> Result<()> {
        let css = r#"
/* Differential Testing Dashboard Styles */

* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: #333;
    line-height: 1.6;
    min-height: 100vh;
}

.container {
    max-width: 1400px;
    margin: 0 auto;
    padding: 20px;
}

/* Header */
header {
    text-align: center;
    margin-bottom: 40px;
    padding: 40px;
    background: rgba(255, 255, 255, 0.95);
    border-radius: 15px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.2);
    backdrop-filter: blur(10px);
}

header h1 {
    font-size: 3em;
    margin-bottom: 10px;
    background: linear-gradient(45deg, #667eea, #764ba2);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
}

header p {
    color: #666;
    font-size: 1.1em;
}

/* Summary Section */
.summary-section {
    background: rgba(255, 255, 255, 0.95);
    padding: 30px;
    border-radius: 15px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.1);
    margin-bottom: 40px;
    backdrop-filter: blur(10px);
}

.summary-section h2 {
    margin-bottom: 25px;
    color: #2c3e50;
    font-size: 1.8em;
}

.summary-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 20px;
}

.summary-card {
    background: #f8f9fa;
    padding: 25px;
    border-radius: 12px;
    text-align: center;
    border: 2px solid #e9ecef;
    transition: all 0.3s ease;
}

.summary-card:hover {
    transform: translateY(-3px);
    box-shadow: 0 8px 20px rgba(0,0,0,0.1);
}

.summary-card.passed {
    background: linear-gradient(135deg, #d4edda 0%, #c3e6cb 100%);
    border-color: #28a745;
}

.summary-card.failed {
    background: linear-gradient(135deg, #f8d7da 0%, #f5c6cb 100%);
    border-color: #dc3545;
}

.metric-value {
    font-size: 2.5em;
    font-weight: bold;
    color: #2c3e50;
    margin-bottom: 5px;
}

.metric-label {
    color: #666;
    font-size: 0.9em;
    text-transform: uppercase;
    letter-spacing: 1px;
}

/* Tests Section */
.tests-section {
    background: rgba(255, 255, 255, 0.95);
    padding: 30px;
    border-radius: 15px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.1);
    margin-bottom: 40px;
    backdrop-filter: blur(10px);
}

.tests-section h2 {
    margin-bottom: 30px;
    color: #2c3e50;
    font-size: 1.8em;
}

/* Test Cards */
.test-card {
    background: #fff;
    border-radius: 15px;
    padding: 30px;
    margin-bottom: 30px;
    box-shadow: 0 5px 20px rgba(0,0,0,0.1);
    border-left: 6px solid #e9ecef;
    transition: all 0.3s ease;
}

.test-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 10px 30px rgba(0,0,0,0.15);
}

.test-card.passed {
    border-left-color: #28a745;
}

.test-card.failed {
    border-left-color: #dc3545;
}

.test-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 25px;
    padding-bottom: 15px;
    border-bottom: 2px solid #f8f9fa;
}

.test-header h3 {
    color: #2c3e50;
    font-size: 1.4em;
}

.test-status {
    font-weight: bold;
    padding: 8px 16px;
    border-radius: 20px;
    font-size: 0.9em;
}

.test-card.passed .test-status {
    background: #d4edda;
    color: #155724;
}

.test-card.failed .test-status {
    background: #f8d7da;
    color: #721c24;
}

/* Comparison Section */
.comparison-section {
    margin-bottom: 30px;
}

.image-comparison {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 20px;
    margin-bottom: 20px;
}

.image-group {
    text-align: center;
}

.image-group h4 {
    margin-bottom: 10px;
    color: #495057;
    font-size: 1em;
    text-transform: uppercase;
    letter-spacing: 1px;
}

.comparison-image {
    width: 100%;
    max-width: 300px;
    height: auto;
    border: 3px solid #e9ecef;
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.3s ease;
    background: #f8f9fa;
}

.comparison-image:hover {
    border-color: #667eea;
    transform: scale(1.02);
    box-shadow: 0 5px 15px rgba(0,0,0,0.2);
}

.cpu-image:hover {
    border-color: #28a745;
}

.gpu-image:hover {
    border-color: #007bff;
}

.diff-image:hover {
    border-color: #ffc107;
}

/* Metrics Section */
.metrics-section {
    background: #f8f9fa;
    padding: 25px;
    border-radius: 12px;
}

.metrics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 20px;
}

.metric-card {
    background: #fff;
    padding: 20px;
    border-radius: 10px;
    border: 1px solid #e9ecef;
}

.metric-title {
    font-weight: bold;
    margin-bottom: 15px;
    color: #495057;
    font-size: 1.1em;
    border-bottom: 2px solid #e9ecef;
    padding-bottom: 8px;
}

.metric-row {
    display: flex;
    justify-content: space-between;
    padding: 8px 0;
    border-bottom: 1px solid #f8f9fa;
}

.metric-row:last-child {
    border-bottom: none;
}

.metric-row span:first-child {
    color: #666;
    font-size: 0.9em;
}

.metric-row .metric-value {
    font-weight: bold;
    color: #2c3e50;
}

/* Failure Section */
.failure-section {
    background: #f8d7da;
    padding: 20px;
    border-radius: 10px;
    margin-top: 20px;
    border-left: 4px solid #dc3545;
}

.failure-section h4 {
    color: #721c24;
    margin-bottom: 10px;
}

.failure-reason {
    color: #721c24;
    font-style: italic;
}

/* Footer */
footer {
    text-align: center;
    padding: 30px;
    color: rgba(255, 255, 255, 0.8);
    font-size: 0.9em;
}

/* Image Modal */
.image-modal {
    display: none;
    position: fixed;
    z-index: 1000;
    left: 0;
    top: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0,0,0,0.9);
    align-items: center;
    justify-content: center;
}

.image-modal.active {
    display: flex;
}

.modal-content {
    position: relative;
    max-width: 90%;
    max-height: 90%;
    animation: modalFadeIn 0.3s ease;
}

@keyframes modalFadeIn {
    from { opacity: 0; transform: scale(0.8); }
    to { opacity: 1; transform: scale(1); }
}

.modal-content img {
    width: 100%;
    height: auto;
    border-radius: 10px;
}

.modal-close {
    position: absolute;
    top: -50px;
    right: 0;
    color: white;
    font-size: 40px;
    font-weight: bold;
    cursor: pointer;
    transition: color 0.3s ease;
}

.modal-close:hover {
    color: #ccc;
}

/* Responsive Design */
@media (max-width: 768px) {
    .container {
        padding: 10px;
    }
    
    header h1 {
        font-size: 2em;
    }
    
    .image-comparison {
        grid-template-columns: 1fr;
    }
    
    .metrics-grid {
        grid-template-columns: 1fr;
    }
    
    .summary-grid {
        grid-template-columns: repeat(2, 1fr);
    }
    
    .test-header {
        flex-direction: column;
        align-items: flex-start;
        gap: 10px;
    }
}
"#;
        
        let js = r#"
// Differential Testing Dashboard JavaScript

document.addEventListener('DOMContentLoaded', function() {
    initializeDashboard();
});

function initializeDashboard() {
    // Initialize image modal functionality
    initializeImageModal();
    
    // Initialize test card interactions
    initializeTestCards();
    
    // Initialize metric highlighting
    initializeMetricHighlighting();
    
    console.log('Differential Testing Dashboard initialized');
}

// Image Modal Functionality
function initializeImageModal() {
    // Create modal element
    const modal = document.createElement('div');
    modal.className = 'image-modal';
    modal.innerHTML = `
        <div class="modal-content">
            <span class="modal-close">&times;</span>
            <img src="" alt="Full size image">
        </div>
    `;
    document.body.appendChild(modal);
    
    const modalImg = modal.querySelector('img');
    const closeBtn = modal.querySelector('.modal-close');
    
    // Add click handlers to all comparison images
    document.querySelectorAll('.comparison-image').forEach(img => {
        img.addEventListener('click', function() {
            modalImg.src = this.src;
            modalImg.alt = this.alt;
            modal.classList.add('active');
            document.body.style.overflow = 'hidden';
        });
    });
    
    // Close modal functionality
    function closeModal() {
        modal.classList.remove('active');
        document.body.style.overflow = 'auto';
    }
    
    closeBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            closeModal();
        }
    });
    
    // Close on escape key
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && modal.classList.contains('active')) {
            closeModal();
        }
    });
}

// Test Card Interactions
function initializeTestCards() {
    document.querySelectorAll('.test-card').forEach(card => {
        // Add hover effects for better UX
        card.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-5px)';
        });
        
        card.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(-2px)';
        });
    });
}

// Metric Highlighting
function initializeMetricHighlighting() {
    document.querySelectorAll('.metric-value').forEach(metric => {
        const value = parseFloat(metric.textContent);
        const label = metric.parentElement.querySelector('span:first-child').textContent.toLowerCase();
        
        // Color-code metrics based on typical thresholds
        if (label.includes('dice') || label.includes('jaccard')) {
            if (value >= 0.95) {
                metric.style.color = '#28a745'; // Excellent
            } else if (value >= 0.8) {
                metric.style.color = '#ffc107'; // Good
            } else {
                metric.style.color = '#dc3545'; // Poor
            }
        } else if (label.includes('ssim')) {
            if (value >= 0.9) {
                metric.style.color = '#28a745'; // Excellent
            } else if (value >= 0.7) {
                metric.style.color = '#ffc107'; // Good
            } else {
                metric.style.color = '#dc3545'; // Poor
            }
        } else if (label.includes('rmse') || label.includes('error')) {
            if (value <= 5.0) {
                metric.style.color = '#28a745'; // Excellent
            } else if (value <= 20.0) {
                metric.style.color = '#ffc107'; // Good
            } else {
                metric.style.color = '#dc3545'; // Poor
            }
        } else if (label.includes('diff pixels')) {
            if (value <= 1.0) {
                metric.style.color = '#28a745'; // Excellent
            } else if (value <= 5.0) {
                metric.style.color = '#ffc107'; // Good
            } else {
                metric.style.color = '#dc3545'; // Poor
            }
        }
    });
}
"#;
        
        fs::write(format!("{}/differential_dashboard.css", self.output_dir), css)?;
        fs::write(format!("{}/differential_dashboard.js", self.output_dir), js)?;
        
        Ok(())
    }
}

/// Paths to comparison images for a single test
#[derive(Debug, Clone)]
pub struct ComparisonImagePaths {
    pub cpu_image: String,
    pub gpu_image: String,
    pub difference_map: String,
    pub combined_image: String,
}

/// Run differential testing and generate dashboard
pub async fn run_differential_testing_with_dashboard(
    output_dir: &str,
) -> Result<String> {
    let mut harness = DifferentialTestHarness::new();
    
    // Try to initialize GPU (will fail gracefully if not available)
    if let Err(e) = harness.init_gpu().await {
        println!("GPU initialization failed: {}. Running CPU-only tests.", e);
    }
    
    // Run comprehensive test suite
    let results = match harness.run_comprehensive_suite().await {
        Ok(results) => results,
        Err(e) => {
            println!("Test suite failed: {}. Generating dashboard with available data.", e);
            Vec::new()
        }
    };
    
    // Generate dashboard
    let dashboard = DifferentialDashboard::new(output_dir.to_string());
    let dashboard_path = dashboard.generate_dashboard(&results).await?;
    
    println!("Generated differential testing dashboard: {}", dashboard_path);
    Ok(dashboard_path)
}