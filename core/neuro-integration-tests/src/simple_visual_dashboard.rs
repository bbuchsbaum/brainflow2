//! Simple visual dashboard for ellipsoid tests
//!
//! This provides a basic HTML dashboard to visualize ellipsoid test results

use anyhow::Result;
use nalgebra::{Point3, Rotation3, Vector3};
use neuro_types::{OrientedEllipsoid, OverlapMetrics};
use std::fs;
use std::path::Path;

/// Simple visual dashboard generator
pub struct SimpleVisualDashboard {
    output_dir: String,
}

impl SimpleVisualDashboard {
    pub fn new(output_dir: String) -> Self {
        Self { output_dir }
    }

    /// Generate a simple HTML dashboard showing test results
    pub fn generate_dashboard(&self, test_results: &[SimpleTestResult]) -> Result<String> {
        // Create output directory
        fs::create_dir_all(&self.output_dir)?;

        // Generate HTML
        let html = self.generate_html(test_results)?;
        let html_path = format!("{}/dashboard.html", self.output_dir);
        fs::write(&html_path, html)?;

        // Generate CSS
        let css = self.generate_css();
        let css_path = format!("{}/dashboard.css", self.output_dir);
        fs::write(&css_path, css)?;

        // Generate JavaScript
        let js = self.generate_javascript();
        let js_path = format!("{}/dashboard.js", self.output_dir);
        fs::write(&js_path, js)?;

        Ok(html_path)
    }

    fn generate_html(&self, test_results: &[SimpleTestResult]) -> Result<String> {
        let mut html = String::new();
        html.push_str(
            r#"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Ellipsoid Test Dashboard</title>
    <link rel="stylesheet" href="dashboard.css">
</head>
<body>
    <div class="container">
        <header>
            <h1>🎯 Ellipsoid Coordinate Transformation Tests</h1>
            <p>Visual dashboard for differential testing validation</p>
        </header>
        
        <div class="summary-section">
            <h2>Test Summary</h2>
            <div class="summary-stats">
"#,
        );

        // Calculate summary statistics
        let total = test_results.len();
        let passed = test_results.iter().filter(|r| r.passed).count();
        let failed = total - passed;
        let avg_dice = if total > 0 {
            test_results
                .iter()
                .map(|r| r.metrics.dice_coefficient)
                .sum::<f64>()
                / total as f64
        } else {
            0.0
        };

        html.push_str(&format!(
            r#"
                <div class="stat-card">
                    <div class="stat-value">{}</div>
                    <div class="stat-label">Total Tests</div>
                </div>
                <div class="stat-card success">
                    <div class="stat-value">{}</div>
                    <div class="stat-label">Passed</div>
                </div>
                <div class="stat-card failure">
                    <div class="stat-value">{}</div>
                    <div class="stat-label">Failed</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">{:.3}</div>
                    <div class="stat-label">Avg Dice</div>
                </div>
            </div>
        </div>
        
        <div class="results-section">
            <h2>Test Results</h2>
            <div class="results-grid">
"#,
            total, passed, failed, avg_dice
        ));

        // Generate result cards
        for (i, result) in test_results.iter().enumerate() {
            let status_class = if result.passed { "passed" } else { "failed" };
            html.push_str(&format!(
                r#"
                <div class="result-card {}" data-test-index="{}">
                    <h3>{}</h3>
                    <div class="metrics">
                        <div class="metric">
                            <span class="metric-label">Dice:</span>
                            <span class="metric-value">{:.3}</span>
                        </div>
                        <div class="metric">
                            <span class="metric-label">Hausdorff:</span>
                            <span class="metric-value">{:.2} mm</span>
                        </div>
                        <div class="metric">
                            <span class="metric-label">ASSD:</span>
                            <span class="metric-value">{:.2} mm</span>
                        </div>
                        <div class="metric">
                            <span class="metric-label">Volume Diff:</span>
                            <span class="metric-value">{:.1}%</span>
                        </div>
                    </div>
                    <div class="execution-time">
                        <span class="time-icon">⏱</span> {} ms
                    </div>
                </div>
"#,
                status_class,
                i,
                result.test_name,
                result.metrics.dice_coefficient,
                result.metrics.hausdorff_distance_mm,
                result.metrics.average_symmetric_surface_distance_mm,
                result.metrics.volume_difference_percent,
                result.execution_time_ms
            ));
        }

        html.push_str(
            r#"
            </div>
        </div>
        
        <div class="details-section" id="details" style="display: none;">
            <h2>Test Details</h2>
            <div id="details-content"></div>
        </div>
        
        <footer>
            <p>Generated with neuro-integration-tests</p>
        </footer>
    </div>
    
    <script src="dashboard.js"></script>
</body>
</html>"#,
        );

        Ok(html)
    }

    fn generate_css(&self) -> &'static str {
        r#"
* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #f5f5f5;
    color: #333;
    line-height: 1.6;
}

.container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 20px;
}

header {
    text-align: center;
    margin-bottom: 40px;
    padding: 30px;
    background: white;
    border-radius: 10px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
}

header h1 {
    font-size: 2.5em;
    margin-bottom: 10px;
    color: #2c3e50;
}

header p {
    color: #7f8c8d;
}

.summary-section {
    background: white;
    padding: 30px;
    border-radius: 10px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    margin-bottom: 30px;
}

.summary-section h2 {
    margin-bottom: 20px;
    color: #2c3e50;
}

.summary-stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 20px;
}

.stat-card {
    background: #f8f9fa;
    padding: 20px;
    border-radius: 8px;
    text-align: center;
    border: 2px solid #e9ecef;
}

.stat-card.success {
    background: #d4edda;
    border-color: #c3e6cb;
}

.stat-card.failure {
    background: #f8d7da;
    border-color: #f5c6cb;
}

.stat-value {
    font-size: 2em;
    font-weight: bold;
    color: #2c3e50;
}

.stat-label {
    color: #7f8c8d;
    margin-top: 5px;
}

.results-section {
    background: white;
    padding: 30px;
    border-radius: 10px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    margin-bottom: 30px;
}

.results-section h2 {
    margin-bottom: 20px;
    color: #2c3e50;
}

.results-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 20px;
}

.result-card {
    background: #f8f9fa;
    border: 2px solid #e9ecef;
    border-radius: 8px;
    padding: 20px;
    cursor: pointer;
    transition: all 0.3s ease;
}

.result-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 20px rgba(0,0,0,0.1);
}

.result-card.passed {
    border-color: #28a745;
}

.result-card.failed {
    border-color: #dc3545;
}

.result-card h3 {
    margin-bottom: 15px;
    color: #2c3e50;
}

.metrics {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-bottom: 15px;
}

.metric {
    display: flex;
    justify-content: space-between;
    padding: 5px 0;
}

.metric-label {
    color: #7f8c8d;
    font-size: 0.9em;
}

.metric-value {
    font-weight: bold;
    color: #2c3e50;
}

.execution-time {
    text-align: center;
    color: #7f8c8d;
    font-size: 0.9em;
    padding-top: 10px;
    border-top: 1px solid #e9ecef;
}

.details-section {
    background: white;
    padding: 30px;
    border-radius: 10px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    margin-bottom: 30px;
}

footer {
    text-align: center;
    padding: 20px;
    color: #7f8c8d;
}
"#
    }

    fn generate_javascript(&self) -> &'static str {
        r#"
// Add click handlers to result cards
document.querySelectorAll('.result-card').forEach(card => {
    card.addEventListener('click', function() {
        const testIndex = this.getAttribute('data-test-index');
        showTestDetails(testIndex);
    });
});

function showTestDetails(testIndex) {
    const detailsSection = document.getElementById('details');
    const detailsContent = document.getElementById('details-content');
    
    // In a real implementation, this would load detailed test data
    detailsContent.innerHTML = `
        <h3>Test ${testIndex} Details</h3>
        <p>Detailed information about this test would appear here.</p>
        <p>This could include:</p>
        <ul>
            <li>Ellipsoid parameters (center, radii, orientation)</li>
            <li>Volume configuration</li>
            <li>Slice images (if generated)</li>
            <li>Difference maps</li>
            <li>Performance metrics</li>
        </ul>
    `;
    
    detailsSection.style.display = 'block';
    detailsSection.scrollIntoView({ behavior: 'smooth' });
}
"#
    }
}

/// Simple test result for dashboard
#[derive(Debug, Clone)]
pub struct SimpleTestResult {
    pub test_name: String,
    pub metrics: OverlapMetrics,
    pub passed: bool,
    pub execution_time_ms: u64,
}
