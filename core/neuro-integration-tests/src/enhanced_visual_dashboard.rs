//! Enhanced visual dashboard with ellipsoid visualization integration

use crate::simple_visual_dashboard::SimpleTestResult;
use crate::ellipsoid_visualizer::EllipsoidVisualizer;
use neuro_types::{OrientedEllipsoid, OverlapMetrics};
use nalgebra::{Point3, Vector3, Rotation3};
use std::fs;
use std::path::Path;
use anyhow::Result;

/// Enhanced dashboard with ellipsoid visualizations
pub struct EnhancedVisualDashboard {
    output_dir: String,
    visualizer: EllipsoidVisualizer,
}

impl EnhancedVisualDashboard {
    pub fn new(output_dir: String) -> Self {
        let images_dir = format!("{}/images", output_dir);
        fs::create_dir_all(&images_dir).unwrap();
        
        Self { 
            output_dir: output_dir.clone(),
            visualizer: EllipsoidVisualizer::new(images_dir),
        }
    }
    
    /// Generate dashboard with ellipsoid visualizations
    pub fn generate_dashboard_with_visuals(
        &self, 
        test_results: &[EnhancedTestResult]
    ) -> Result<String> {
        // Create output directory
        fs::create_dir_all(&self.output_dir)?;
        
        // Generate ellipsoid images for each test
        let mut image_paths = Vec::new();
        for (i, result) in test_results.iter().enumerate() {
            if let Some(ref ellipsoid) = result.ellipsoid {
                let paths = self.visualizer.generate_ellipsoid_slices(
                    ellipsoid,
                    &format!("test_{}", i),
                    [100, 100, 100],
                    [1.0, 1.0, 1.0],
                )?;
                image_paths.push(Some(paths));
            } else {
                image_paths.push(None);
            }
        }
        
        // Generate HTML with embedded images
        let html = self.generate_html_with_images(test_results, &image_paths)?;
        let html_path = format!("{}/enhanced_dashboard.html", self.output_dir);
        fs::write(&html_path, html)?;
        
        // Copy CSS and JS
        self.generate_assets()?;
        
        Ok(html_path)
    }
    
    fn generate_html_with_images(
        &self,
        test_results: &[EnhancedTestResult],
        image_paths: &[Option<crate::ellipsoid_visualizer::SliceImagePaths>],
    ) -> Result<String> {
        let mut html = String::new();
        html.push_str(r#"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Enhanced Ellipsoid Test Dashboard</title>
    <link rel="stylesheet" href="enhanced_dashboard.css">
</head>
<body>
    <div class="container">
        <header>
            <h1>🎯 Enhanced Ellipsoid Test Dashboard</h1>
            <p>Visual dashboard with ellipsoid slice visualizations</p>
        </header>
        
        <div class="results-grid">
"#);
        
        // Generate enhanced result cards
        for (i, (result, paths)) in test_results.iter().zip(image_paths.iter()).enumerate() {
            let status = if result.base.passed { "passed" } else { "failed" };
            
            html.push_str(&format!(r#"
            <div class="result-card-enhanced {}" data-test-index="{}">
                <h3>{}</h3>
                
                <div class="visualization-section">
"#, status, i, result.base.test_name));
            
            // Add slice images if available
            if let Some(ref img_paths) = paths {
                // Make paths relative to dashboard location
                let axial_rel = img_paths.axial.replace(&self.output_dir, ".");
                let coronal_rel = img_paths.coronal.replace(&self.output_dir, ".");
                let sagittal_rel = img_paths.sagittal.replace(&self.output_dir, ".");
                
                html.push_str(&format!(r#"
                    <div class="slice-grid">
                        <div class="slice-item">
                            <img src="{}" alt="Axial slice" class="slice-image">
                            <p class="slice-label">Axial</p>
                        </div>
                        <div class="slice-item">
                            <img src="{}" alt="Coronal slice" class="slice-image">
                            <p class="slice-label">Coronal</p>
                        </div>
                        <div class="slice-item">
                            <img src="{}" alt="Sagittal slice" class="slice-image">
                            <p class="slice-label">Sagittal</p>
                        </div>
                    </div>
"#, axial_rel, coronal_rel, sagittal_rel));
            } else {
                html.push_str(r#"
                    <div class="no-visualization">
                        <p>No visualization available</p>
                    </div>
"#);
            }
            
            html.push_str(&format!(r#"
                </div>
                
                <div class="metrics-section">
                    <div class="metric-row">
                        <span class="metric-label">Dice:</span>
                        <span class="metric-value">{:.3}</span>
                    </div>
                    <div class="metric-row">
                        <span class="metric-label">Hausdorff:</span>
                        <span class="metric-value">{:.2} mm</span>
                    </div>
                    <div class="metric-row">
                        <span class="metric-label">Volume Diff:</span>
                        <span class="metric-value">{:.1}%</span>
                    </div>
                </div>
                
                <div class="ellipsoid-params">
                    <h4>Ellipsoid Parameters</h4>
"#, 
                result.base.metrics.dice_coefficient,
                result.base.metrics.hausdorff_distance_mm,
                result.base.metrics.volume_difference_percent
            ));
            
            if let Some(ref ellipsoid) = result.ellipsoid {
                html.push_str(&format!(r#"
                    <p>Center: ({:.1}, {:.1}, {:.1})</p>
                    <p>Radii: ({:.1}, {:.1}, {:.1})</p>
"#, 
                    ellipsoid.center.x, ellipsoid.center.y, ellipsoid.center.z,
                    ellipsoid.radii.x, ellipsoid.radii.y, ellipsoid.radii.z
                ));
            }
            
            html.push_str(r#"
                </div>
            </div>
"#);
        }
        
        html.push_str(r#"
        </div>
    </div>
    
    <script src="enhanced_dashboard.js"></script>
</body>
</html>"#);
        
        Ok(html)
    }
    
    fn generate_assets(&self) -> Result<()> {
        // Enhanced CSS
        let css = r#"
* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #f0f2f5;
    color: #333;
    line-height: 1.6;
}

.container {
    max-width: 1400px;
    margin: 0 auto;
    padding: 20px;
}

header {
    text-align: center;
    margin-bottom: 40px;
    padding: 40px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border-radius: 15px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.2);
}

header h1 {
    font-size: 3em;
    margin-bottom: 10px;
}

.results-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
    gap: 30px;
}

.result-card-enhanced {
    background: white;
    border-radius: 12px;
    padding: 25px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.1);
    transition: all 0.3s ease;
}

.result-card-enhanced:hover {
    transform: translateY(-5px);
    box-shadow: 0 8px 30px rgba(0,0,0,0.15);
}

.result-card-enhanced.passed {
    border-left: 5px solid #10b981;
}

.result-card-enhanced.failed {
    border-left: 5px solid #ef4444;
}

.visualization-section {
    margin: 20px 0;
}

.slice-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
}

.slice-item {
    text-align: center;
}

.slice-image {
    width: 100%;
    height: auto;
    border: 2px solid #e5e7eb;
    border-radius: 8px;
    background: #f9fafb;
}

.slice-label {
    margin-top: 5px;
    font-size: 0.9em;
    color: #6b7280;
}

.metrics-section {
    background: #f9fafb;
    padding: 15px;
    border-radius: 8px;
    margin: 20px 0;
}

.metric-row {
    display: flex;
    justify-content: space-between;
    padding: 5px 0;
}

.metric-label {
    color: #6b7280;
    font-weight: 500;
}

.metric-value {
    font-weight: bold;
    color: #1f2937;
}

.ellipsoid-params {
    background: #f3f4f6;
    padding: 15px;
    border-radius: 8px;
}

.ellipsoid-params h4 {
    margin-bottom: 10px;
    color: #4b5563;
}

.ellipsoid-params p {
    font-size: 0.9em;
    color: #6b7280;
    margin: 5px 0;
}

.no-visualization {
    padding: 40px;
    text-align: center;
    background: #f9fafb;
    border: 2px dashed #e5e7eb;
    border-radius: 8px;
    color: #9ca3af;
}
"#;
        
        let js = r#"
// Enhanced dashboard interactivity
document.addEventListener('DOMContentLoaded', function() {
    // Add click handlers for slice images
    document.querySelectorAll('.slice-image').forEach(img => {
        img.addEventListener('click', function() {
            // Create modal to show full-size image
            const modal = document.createElement('div');
            modal.className = 'image-modal';
            modal.innerHTML = `
                <div class="modal-content">
                    <span class="close">&times;</span>
                    <img src="${this.src}" alt="Full size image">
                </div>
            `;
            document.body.appendChild(modal);
            
            modal.querySelector('.close').addEventListener('click', () => {
                modal.remove();
            });
            
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.remove();
                }
            });
        });
    });
});

// Add modal styles dynamically
const style = document.createElement('style');
style.textContent = `
.image-modal {
    display: flex;
    position: fixed;
    z-index: 1000;
    left: 0;
    top: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0,0,0,0.8);
    align-items: center;
    justify-content: center;
}

.modal-content {
    position: relative;
    max-width: 90%;
    max-height: 90%;
}

.modal-content img {
    width: 100%;
    height: auto;
}

.close {
    position: absolute;
    top: -40px;
    right: 0;
    color: white;
    font-size: 35px;
    font-weight: bold;
    cursor: pointer;
}

.close:hover {
    color: #ddd;
}
`;
document.head.appendChild(style);
"#;
        
        fs::write(format!("{}/enhanced_dashboard.css", self.output_dir), css)?;
        fs::write(format!("{}/enhanced_dashboard.js", self.output_dir), js)?;
        
        Ok(())
    }
}

/// Enhanced test result with ellipsoid information
#[derive(Debug, Clone)]
pub struct EnhancedTestResult {
    pub base: SimpleTestResult,
    pub ellipsoid: Option<OrientedEllipsoid>,
    pub volume_config: Option<VolumeConfig>,
}

#[derive(Debug, Clone)]
pub struct VolumeConfig {
    pub dimensions: [usize; 3],
    pub spacing: [f64; 3],
    pub origin: [f64; 3],
}