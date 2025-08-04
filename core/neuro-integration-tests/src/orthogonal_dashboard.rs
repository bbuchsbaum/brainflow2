//! Orthogonal slice differential testing dashboard
//!
//! Generates HTML dashboards showing CPU vs GPU orthogonal slice comparisons
//! with crosshair visualization at specified world coordinates.

use crate::{DifferentialMetrics, OrthogonalTestResult};
use neuro_types::Result as NeuroResult;
use std::fs;
use std::path::Path;

/// Dashboard generator for orthogonal differential tests
pub struct OrthogonalDashboard {
    output_dir: String,
}

impl OrthogonalDashboard {
    /// Create a new orthogonal dashboard generator
    pub fn new(output_dir: &str) -> Self {
        Self {
            output_dir: output_dir.to_string(),
        }
    }

    /// Generate a comprehensive dashboard from orthogonal test results
    pub async fn generate_dashboard(
        &self,
        test_results: &[OrthogonalTestResult],
    ) -> NeuroResult<String> {
        // Create output directory structure
        fs::create_dir_all(&self.output_dir)?;
        let images_dir = Path::new(&self.output_dir).join("images");
        fs::create_dir_all(&images_dir)?;

        // Generate HTML
        let html_content = self.generate_html(test_results)?;

        // Save images for each test
        for (idx, result) in test_results.iter().enumerate() {
            self.save_test_images(idx, result)?;
        }

        // Write HTML file
        let html_path = Path::new(&self.output_dir).join("orthogonal_dashboard.html");
        fs::write(&html_path, html_content)?;

        // Copy CSS
        self.generate_css()?;

        Ok(html_path.to_string_lossy().into_owned())
    }

    /// Save all images for a single test
    fn save_test_images(&self, test_idx: usize, result: &OrthogonalTestResult) -> NeuroResult<()> {
        let images_dir = Path::new(&self.output_dir).join("images");

        // Save CPU slices with proper dimensions
        crate::image_utils::save_rgba_image_with_dimensions(
            &result.cpu_slices.axial,
            result.cpu_slices.axial_dims.width,
            result.cpu_slices.axial_dims.height,
            &images_dir.join(format!("test_{}_cpu_axial.png", test_idx)),
        )?;
        crate::image_utils::save_rgba_image_with_dimensions(
            &result.cpu_slices.sagittal,
            result.cpu_slices.sagittal_dims.width,
            result.cpu_slices.sagittal_dims.height,
            &images_dir.join(format!("test_{}_cpu_sagittal.png", test_idx)),
        )?;
        crate::image_utils::save_rgba_image_with_dimensions(
            &result.cpu_slices.coronal,
            result.cpu_slices.coronal_dims.width,
            result.cpu_slices.coronal_dims.height,
            &images_dir.join(format!("test_{}_cpu_coronal.png", test_idx)),
        )?;

        // Save GPU slices with proper dimensions
        crate::image_utils::save_rgba_image_with_dimensions(
            &result.gpu_slices.axial,
            result.gpu_slices.axial_dims.width,
            result.gpu_slices.axial_dims.height,
            &images_dir.join(format!("test_{}_gpu_axial.png", test_idx)),
        )?;
        crate::image_utils::save_rgba_image_with_dimensions(
            &result.gpu_slices.sagittal,
            result.gpu_slices.sagittal_dims.width,
            result.gpu_slices.sagittal_dims.height,
            &images_dir.join(format!("test_{}_gpu_sagittal.png", test_idx)),
        )?;
        crate::image_utils::save_rgba_image_with_dimensions(
            &result.gpu_slices.coronal,
            result.gpu_slices.coronal_dims.width,
            result.gpu_slices.coronal_dims.height,
            &images_dir.join(format!("test_{}_gpu_coronal.png", test_idx)),
        )?;

        Ok(())
    }

    /// Generate the HTML content
    fn generate_html(&self, test_results: &[OrthogonalTestResult]) -> NeuroResult<String> {
        let mut html = String::from(
            r#"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Orthogonal Slice Differential Testing - CPU vs GPU</title>
    <link rel="stylesheet" href="orthogonal_dashboard.css">
</head>
<body>
    <div class="container">
        <header>
            <h1>🧠 Orthogonal Slice Differential Testing</h1>
            <p>CPU vs GPU Rendering Comparison - Axial, Sagittal, and Coronal Views</p>
        </header>
        
        <div class="summary-section">
            <h2>Test Summary</h2>
"#,
        );

        // Calculate summary statistics
        let total = test_results.len();
        let passed = test_results.iter().filter(|r| r.passed).count();
        let failed = total - passed;

        html.push_str(&format!(
            r#"
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
            </div>
        </div>
        
        <div class="tests-section">
            <h2>Orthogonal Test Results</h2>
"#,
            total, passed, failed
        ));

        // Generate test result sections
        for (idx, result) in test_results.iter().enumerate() {
            self.generate_test_section(&mut html, idx, result);
        }

        html.push_str(
            r#"
        </div>
        
        <footer>
            <p>Generated by Brainflow2 Orthogonal Differential Testing Framework</p>
            <p>Crosshairs indicate the world space coordinate location on each slice</p>
        </footer>
    </div>
</body>
</html>"#,
        );

        Ok(html)
    }

    /// Generate HTML for a single test section
    fn generate_test_section(&self, html: &mut String, idx: usize, result: &OrthogonalTestResult) {
        let status_class = if result.passed { "passed" } else { "failed" };
        let status_icon = if result.passed { "✅" } else { "❌" };

        html.push_str(&format!(r#"
            <div class="test-section {}">
                <div class="test-header">
                    <h3>{} {} - World Coordinate: ({:.1}, {:.1}, {:.1}) mm</h3>
                    <div class="test-status">{}</div>
                </div>
                
                <div class="coordinate-info">
                    <p><strong>Test Point:</strong> ({:.1}, {:.1}, {:.1}) mm in LPI world space</p>
                    <p><strong>Ellipsoid:</strong> Center at ({:.1}, {:.1}, {:.1}), Radii: ({:.1}, {:.1}, {:.1})</p>
                </div>
                
                <div class="orthogonal-grid">
                    <div class="grid-header"></div>
                    <div class="grid-header">Axial (Z={:.1})</div>
                    <div class="grid-header">Sagittal (X={:.1})</div>
                    <div class="grid-header">Coronal (Y={:.1})</div>
                    
                    <div class="grid-label">CPU</div>
                    <div class="slice-image">
                        <img src="images/test_{}_cpu_axial.png" alt="CPU Axial">
                    </div>
                    <div class="slice-image">
                        <img src="images/test_{}_cpu_sagittal.png" alt="CPU Sagittal">
                    </div>
                    <div class="slice-image">
                        <img src="images/test_{}_cpu_coronal.png" alt="CPU Coronal">
                    </div>
                    
                    <div class="grid-label">GPU</div>
                    <div class="slice-image">
                        <img src="images/test_{}_gpu_axial.png" alt="GPU Axial">
                    </div>
                    <div class="slice-image">
                        <img src="images/test_{}_gpu_sagittal.png" alt="GPU Sagittal">
                    </div>
                    <div class="slice-image">
                        <img src="images/test_{}_gpu_coronal.png" alt="GPU Coronal">
                    </div>
                </div>
                
                <div class="metrics-section">
                    <h4>Comparison Metrics</h4>
                    <div class="metrics-grid">
                        {}
                        {}
                        {}
                    </div>
                </div>
"#,
            status_class,
            status_icon,
            result.test_name,
            result.world_coordinate.x,
            result.world_coordinate.y,
            result.world_coordinate.z,
            if result.passed { "PASS" } else { "FAIL" },
            result.world_coordinate.x,
            result.world_coordinate.y,
            result.world_coordinate.z,
            result.ellipsoid.center.x,
            result.ellipsoid.center.y,
            result.ellipsoid.center.z,
            result.ellipsoid.radii.x,
            result.ellipsoid.radii.y,
            result.ellipsoid.radii.z,
            result.world_coordinate.z,
            result.world_coordinate.x,
            result.world_coordinate.y,
            idx, idx, idx,
            idx, idx, idx,
            self.format_metrics("Axial", &result.axial_metrics),
            self.format_metrics("Sagittal", &result.sagittal_metrics),
            self.format_metrics("Coronal", &result.coronal_metrics),
        ));

        // Add failure reasons if any
        if !result.failure_reasons.is_empty() {
            html.push_str(
                r#"
                <div class="failure-section">
                    <h4>Failure Analysis</h4>
                    <ul>"#,
            );

            for reason in &result.failure_reasons {
                html.push_str(&format!("<li>{}</li>", reason));
            }

            html.push_str("</ul></div>");
        }

        html.push_str("</div>");
    }

    /// Format metrics for a single plane
    fn format_metrics(&self, plane_name: &str, metrics: &DifferentialMetrics) -> String {
        format!(
            r#"
            <div class="metric-card">
                <div class="metric-title">{} Plane</div>
                <div class="metric-row">
                    <span>Dice:</span>
                    <span class="metric-value">{:.3}</span>
                </div>
                <div class="metric-row">
                    <span>SSIM:</span>
                    <span class="metric-value">{:.3}</span>
                </div>
                <div class="metric-row">
                    <span>RMSE:</span>
                    <span class="metric-value">{:.1}</span>
                </div>
                <div class="metric-row">
                    <span>Max Diff:</span>
                    <span class="metric-value">{}</span>
                </div>
            </div>
        "#,
            plane_name,
            metrics.dice_coefficient,
            metrics.ssim,
            metrics.rmse,
            metrics.max_absolute_difference
        )
    }

    /// Generate CSS file
    fn generate_css(&self) -> NeuroResult<()> {
        let css_content = r#"
/* Orthogonal Dashboard Styles */
body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    margin: 0;
    padding: 0;
    background-color: #f5f5f5;
    color: #333;
}

.container {
    max-width: 1600px;
    margin: 0 auto;
    padding: 20px;
}

header {
    text-align: center;
    margin-bottom: 40px;
}

header h1 {
    font-size: 2.5em;
    margin-bottom: 10px;
    color: #2c3e50;
}

header p {
    font-size: 1.2em;
    color: #7f8c8d;
}

/* Summary Section */
.summary-section {
    background: white;
    border-radius: 10px;
    padding: 30px;
    margin-bottom: 40px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
}

.summary-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 20px;
    margin-top: 20px;
}

.summary-card {
    text-align: center;
    padding: 20px;
    border-radius: 8px;
    background: #f8f9fa;
}

.summary-card.passed {
    background: #d4edda;
    color: #155724;
}

.summary-card.failed {
    background: #f8d7da;
    color: #721c24;
}

.metric-value {
    font-size: 2.5em;
    font-weight: bold;
    margin-bottom: 5px;
}

.metric-label {
    font-size: 1.1em;
    color: #666;
}

/* Test Sections */
.test-section {
    background: white;
    border-radius: 10px;
    padding: 30px;
    margin-bottom: 30px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
}

.test-section.failed {
    border-left: 5px solid #dc3545;
}

.test-section.passed {
    border-left: 5px solid #28a745;
}

.test-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
}

.test-header h3 {
    margin: 0;
    color: #2c3e50;
}

.test-status {
    font-size: 1.2em;
    font-weight: bold;
    padding: 5px 15px;
    border-radius: 5px;
    background: #f8f9fa;
}

.coordinate-info {
    background: #f8f9fa;
    padding: 15px;
    border-radius: 5px;
    margin-bottom: 20px;
}

.coordinate-info p {
    margin: 5px 0;
}

/* Orthogonal Grid */
.orthogonal-grid {
    display: grid;
    grid-template-columns: 100px repeat(3, 1fr);
    gap: 15px;
    margin-bottom: 30px;
    align-items: center;
}

.grid-header {
    text-align: center;
    font-weight: bold;
    color: #495057;
    padding: 10px;
    background: #f8f9fa;
    border-radius: 5px;
}

.grid-label {
    text-align: center;
    font-weight: bold;
    padding: 10px;
    background: #e9ecef;
    border-radius: 5px;
}

.slice-image {
    display: flex;
    align-items: center;
    justify-content: center;
    background: #f8f9fa;
    padding: 10px;
    border-radius: 5px;
    aspect-ratio: 1;
}

.slice-image img {
    object-fit: contain;
    max-width: 100%;
    max-height: 100%;
    border: 1px solid #dee2e6;
    border-radius: 3px;
}

/* Metrics Section */
.metrics-section {
    margin-top: 30px;
}

.metrics-section h4 {
    margin-bottom: 15px;
    color: #495057;
}

.metrics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 20px;
}

.metric-card {
    background: #f8f9fa;
    padding: 20px;
    border-radius: 8px;
}

.metric-title {
    font-weight: bold;
    margin-bottom: 10px;
    color: #495057;
    border-bottom: 2px solid #dee2e6;
    padding-bottom: 5px;
}

.metric-row {
    display: flex;
    justify-content: space-between;
    margin: 8px 0;
}

.metric-row span:first-child {
    color: #6c757d;
}

.metric-row .metric-value {
    font-weight: bold;
    color: #212529;
    font-size: 1em;
}

/* Failure Section */
.failure-section {
    background: #f8d7da;
    border: 1px solid #f5c6cb;
    border-radius: 5px;
    padding: 20px;
    margin-top: 20px;
}

.failure-section h4 {
    color: #721c24;
    margin-bottom: 10px;
}

.failure-section ul {
    margin: 0;
    padding-left: 20px;
}

.failure-section li {
    color: #721c24;
    margin: 5px 0;
}

/* Footer */
footer {
    text-align: center;
    margin-top: 40px;
    color: #6c757d;
    font-size: 0.9em;
}

footer p {
    margin: 5px 0;
}

/* Responsive */
@media (max-width: 768px) {
    .orthogonal-grid {
        grid-template-columns: 1fr;
    }
    
    .grid-header:first-child {
        display: none;
    }
    
    .grid-label {
        grid-column: 1 / -1;
        margin-top: 20px;
    }
}
"#;

        let css_path = Path::new(&self.output_dir).join("orthogonal_dashboard.css");
        fs::write(css_path, css_content)?;

        Ok(())
    }
}

/// Run orthogonal differential testing and generate dashboard
pub async fn run_orthogonal_testing_with_dashboard(output_dir: &str) -> NeuroResult<String> {
    use crate::DifferentialTestHarness;

    let mut harness = DifferentialTestHarness::new();

    // Initialize GPU
    harness.init_gpu().await?;

    // Run orthogonal test suite
    let test_results = harness.run_orthogonal_suite().await?;

    // Generate dashboard
    let dashboard = OrthogonalDashboard::new(output_dir);
    dashboard.generate_dashboard(&test_results).await
}
