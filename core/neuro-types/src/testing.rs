//! Differential testing framework for CPU ↔ GPU slice extraction
//! 
//! Provides utilities to compare outputs from different SliceProvider implementations
//! to ensure they produce consistent results within tolerance.

use crate::{SliceProvider, CompositeRequest, RgbaImage, Result};

/// Configuration for differential testing
#[derive(Debug, Clone)]
pub struct DiffTestConfig {
    /// Maximum allowed absolute difference per channel (0-255)
    pub max_abs_diff: u8,
    /// Maximum allowed relative difference (0.0-1.0)
    pub max_rel_diff: f32,
    /// Minimum number of non-zero pixels required for relative comparison
    pub min_nonzero_pixels: usize,
    /// Whether to save debug images on failure
    pub save_debug_images: bool,
}

impl Default for DiffTestConfig {
    fn default() -> Self {
        Self {
            max_abs_diff: 2,        // Allow up to 2 units difference per channel
            max_rel_diff: 0.02,     // Allow up to 2% relative difference
            min_nonzero_pixels: 10, // Need at least 10 non-zero pixels for relative tests
            save_debug_images: false,
        }
    }
}

/// Result of a differential test
#[derive(Debug, Clone)]
pub struct DiffTestResult {
    /// Whether the test passed
    pub passed: bool,
    /// Maximum absolute difference found (per channel)
    pub max_abs_diff: u8,
    /// Maximum relative difference found
    pub max_rel_diff: f32,
    /// Number of pixels that exceeded tolerance
    pub failed_pixels: usize,
    /// Total number of pixels compared
    pub total_pixels: usize,
    /// Statistical summary
    pub stats: DiffStats,
}

/// Statistical summary of differences
#[derive(Debug, Clone)]
pub struct DiffStats {
    /// Mean absolute difference (per channel)
    pub mean_abs_diff: f32,
    /// Standard deviation of absolute differences
    pub std_abs_diff: f32,
    /// 95th percentile absolute difference
    pub p95_abs_diff: u8,
    /// Number of pixels with zero difference
    pub exact_matches: usize,
}

/// Differential testing framework
pub struct DifferentialTester {
    config: DiffTestConfig,
}

impl DifferentialTester {
    /// Create a new differential tester with default configuration
    pub fn new() -> Self {
        Self {
            config: DiffTestConfig::default(),
        }
    }
    
    /// Create a new differential tester with custom configuration
    pub fn with_config(config: DiffTestConfig) -> Self {
        Self { config }
    }
    
    /// Compare two SliceProvider implementations on the same request
    pub fn compare_providers<P1, P2>(
        &self,
        provider1: &P1,
        provider2: &P2,
        request: &CompositeRequest,
        test_name: &str,
    ) -> Result<DiffTestResult>
    where
        P1: SliceProvider,
        P2: SliceProvider,
    {
        // Get outputs from both providers
        let output1 = provider1.composite_rgba(request)?;
        let output2 = provider2.composite_rgba(request)?;
        
        // Compare the outputs
        self.compare_outputs(&output1, &output2, test_name)
    }
    
    /// Compare two RGBA images
    pub fn compare_outputs(
        &self,
        output1: &RgbaImage,
        output2: &RgbaImage,
        test_name: &str,
    ) -> Result<DiffTestResult> {
        if output1.len() != output2.len() {
            return Err(crate::Error::TestError(format!(
                "Output lengths differ: {} vs {}", 
                output1.len(), 
                output2.len()
            )));
        }
        
        if output1.len() % 4 != 0 {
            return Err(crate::Error::TestError(format!(
                "Invalid RGBA data length: {}", 
                output1.len()
            )));
        }
        
        let num_pixels = output1.len() / 4;
        let mut max_abs_diff = 0u8;
        let mut max_rel_diff = 0.0f32;
        let mut failed_pixels = 0;
        let mut abs_diffs = Vec::new();
        let mut exact_matches = 0;
        
        // Compare pixel by pixel
        for i in 0..num_pixels {
            let offset = i * 4;
            let pixel1 = &output1[offset..offset + 4];
            let pixel2 = &output2[offset..offset + 4];
            
            let mut pixel_failed = false;
            let mut pixel_max_abs = 0u8;
            let mut pixel_max_rel = 0.0f32;
            
            // Compare each channel (RGBA)
            for c in 0..4 {
                let v1 = pixel1[c];
                let v2 = pixel2[c];
                
                let abs_diff = (v1 as i16 - v2 as i16).abs() as u8;
                abs_diffs.push(abs_diff as f32);
                pixel_max_abs = pixel_max_abs.max(abs_diff);
                
                // Calculate relative difference for non-zero values
                let (rel_diff, max_val) = if v1 > 0 || v2 > 0 {
                    let max_val = v1.max(v2) as f32;
                    (abs_diff as f32 / max_val, max_val)
                } else {
                    (0.0, 0.0)
                };
                pixel_max_rel = pixel_max_rel.max(rel_diff);
                
                // Check tolerances
                if abs_diff > self.config.max_abs_diff {
                    pixel_failed = true;
                }
                
                if rel_diff > self.config.max_rel_diff && max_val > 10.0 {
                    pixel_failed = true;
                }
            }
            
            max_abs_diff = max_abs_diff.max(pixel_max_abs);
            max_rel_diff = max_rel_diff.max(pixel_max_rel);
            
            if pixel_failed {
                failed_pixels += 1;
            }
            
            if pixel_max_abs == 0 {
                exact_matches += 1;
            }
        }
        
        // Calculate statistics
        let mean_abs_diff = abs_diffs.iter().sum::<f32>() / abs_diffs.len() as f32;
        let variance = abs_diffs.iter()
            .map(|&x| (x - mean_abs_diff).powi(2))
            .sum::<f32>() / abs_diffs.len() as f32;
        let std_abs_diff = variance.sqrt();
        
        // Calculate 95th percentile
        let mut sorted_diffs = abs_diffs.clone();
        sorted_diffs.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let p95_index = (sorted_diffs.len() as f32 * 0.95) as usize;
        let p95_abs_diff = sorted_diffs.get(p95_index).unwrap_or(&0.0).round() as u8;
        
        let stats = DiffStats {
            mean_abs_diff,
            std_abs_diff,
            p95_abs_diff,
            exact_matches,
        };
        
        let passed = failed_pixels == 0;
        
        let result = DiffTestResult {
            passed,
            max_abs_diff,
            max_rel_diff,
            failed_pixels,
            total_pixels: num_pixels,
            stats,
        };
        
        // Optional debug output
        if !passed || std::env::var("NEURO_DEBUG_DIFF").is_ok() {
            self.print_diff_summary(test_name, &result);
        }
        
        // Optional debug image saving
        if !passed && self.config.save_debug_images {
            // Note: save_debug_images requires a CompositeRequest which is not available in compare_outputs
            // This could be implemented by modifying the signature or by saving images in compare_providers instead
            println!("Debug images would be saved for test: {}", test_name);
        }
        
        Ok(result)
    }
    
    /// Print a summary of the differential test results
    fn print_diff_summary(&self, test_name: &str, result: &DiffTestResult) {
        println!("=== Differential Test: {} ===", test_name);
        println!("Status: {}", if result.passed { "PASS" } else { "FAIL" });
        println!("Max Absolute Diff: {} (threshold: {})", result.max_abs_diff, self.config.max_abs_diff);
        println!("Max Relative Diff: {:.4} (threshold: {:.4})", result.max_rel_diff, self.config.max_rel_diff);
        println!("Failed Pixels: {} / {} ({:.2}%)", 
                result.failed_pixels, 
                result.total_pixels,
                100.0 * result.failed_pixels as f32 / result.total_pixels as f32);
        println!("Exact Matches: {} ({:.2}%)", 
                result.stats.exact_matches,
                100.0 * result.stats.exact_matches as f32 / result.total_pixels as f32);
        println!("Mean Abs Diff: {:.2}", result.stats.mean_abs_diff);
        println!("Std Abs Diff: {:.2}", result.stats.std_abs_diff);
        println!("95th Percentile: {}", result.stats.p95_abs_diff);
        println!("===============================");
    }
    
    /// Save debug images when tests fail
    fn save_debug_images(
        &self,
        test_name: &str,
        output1: &RgbaImage,
        output2: &RgbaImage,
        request: &CompositeRequest,
    ) -> Result<()> {
        // This would save debug images to disk for manual inspection
        // Implementation depends on available image libraries
        let _ = (test_name, output1, output2, request);
        println!("Debug image saving not implemented yet");
        Ok(())
    }
}

impl Default for DifferentialTester {
    fn default() -> Self {
        Self::new()
    }
}

/// Convenience macro for differential testing
#[macro_export]
macro_rules! assert_providers_match {
    ($provider1:expr, $provider2:expr, $request:expr) => {
        assert_providers_match!($provider1, $provider2, $request, "test")
    };
    ($provider1:expr, $provider2:expr, $request:expr, $test_name:expr) => {
        {
            let tester = $crate::testing::DifferentialTester::new();
            let result = tester.compare_providers($provider1, $provider2, $request, $test_name)
                .expect("Failed to run differential test");
            
            if !result.passed {
                panic!("Differential test '{}' failed: {} / {} pixels exceeded tolerance", 
                       $test_name, result.failed_pixels, result.total_pixels);
            }
        }
    };
}

/// Convenience macro for differential testing with custom config
#[macro_export]
macro_rules! assert_providers_match_with_config {
    ($provider1:expr, $provider2:expr, $request:expr, $config:expr, $test_name:expr) => {
        {
            let tester = $crate::testing::DifferentialTester::with_config($config);
            let result = tester.compare_providers($provider1, $provider2, $request, $test_name)
                .expect("Failed to run differential test");
            
            if !result.passed {
                panic!("Differential test '{}' failed: {} / {} pixels exceeded tolerance", 
                       $test_name, result.failed_pixels, result.total_pixels);
            }
        }
    };
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{SliceSpec, LayerSpec, LayerVisual, VolumeHandle};
    use nalgebra::Matrix4;
    
    // Mock provider for testing
    struct MockProvider {
        rgba_data: RgbaImage,
    }
    
    impl SliceProvider for MockProvider {
        fn composite_rgba(&self, _request: &CompositeRequest) -> Result<RgbaImage> {
            Ok(self.rgba_data.clone())
        }
    }
    
    #[test]
    fn test_identical_outputs() {
        let rgba_data = vec![255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 128, 128, 128, 255];
        
        let provider1 = MockProvider { rgba_data: rgba_data.clone() };
        let provider2 = MockProvider { rgba_data };
        
        let slice = SliceSpec::axial_at([0.0, 0.0, 0.0], [10.0, 10.0], [2, 2]);
        let layer = LayerSpec {
            volume_id: VolumeHandle::new(0),
            world_from_voxel: Matrix4::identity(),
            visual: LayerVisual::default(),
        };
        let request = CompositeRequest::new(slice, vec![layer]);
        
        let tester = DifferentialTester::new();
        let result = tester.compare_providers(&provider1, &provider2, &request, "identical")
            .expect("Test should succeed");
        
        assert!(result.passed);
        assert_eq!(result.max_abs_diff, 0);
        assert_eq!(result.failed_pixels, 0);
        assert_eq!(result.stats.exact_matches, 4); // 4 pixels
    }
    
    #[test]
    fn test_small_differences() {
        let rgba1 = vec![255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 128, 128, 128, 255];
        let rgba2 = vec![254, 1, 0, 255, 0, 254, 1, 255, 1, 0, 254, 255, 127, 129, 128, 255];
        
        let provider1 = MockProvider { rgba_data: rgba1 };
        let provider2 = MockProvider { rgba_data: rgba2 };
        
        let slice = SliceSpec::axial_at([0.0, 0.0, 0.0], [10.0, 10.0], [2, 2]);
        let layer = LayerSpec {
            volume_id: VolumeHandle::new(0),
            world_from_voxel: Matrix4::identity(),
            visual: LayerVisual::default(),
        };
        let request = CompositeRequest::new(slice, vec![layer]);
        
        let tester = DifferentialTester::new();
        let result = tester.compare_providers(&provider1, &provider2, &request, "small_diff")
            .expect("Test should succeed");
        
        assert!(result.passed); // Should pass with default tolerance (max_abs_diff: 2)
        assert_eq!(result.max_abs_diff, 1);
        assert_eq!(result.failed_pixels, 0);
    }
    
    #[test]
    fn test_large_differences() {
        let rgba1 = vec![255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 128, 128, 128, 255];
        let rgba2 = vec![200, 50, 0, 255, 0, 200, 50, 255, 50, 0, 200, 255, 100, 150, 128, 255];
        
        let provider1 = MockProvider { rgba_data: rgba1 };
        let provider2 = MockProvider { rgba_data: rgba2 };
        
        let slice = SliceSpec::axial_at([0.0, 0.0, 0.0], [10.0, 10.0], [2, 2]);
        let layer = LayerSpec {
            volume_id: VolumeHandle::new(0),
            world_from_voxel: Matrix4::identity(),
            visual: LayerVisual::default(),
        };
        let request = CompositeRequest::new(slice, vec![layer]);
        
        let tester = DifferentialTester::new();
        let result = tester.compare_providers(&provider1, &provider2, &request, "large_diff")
            .expect("Test should succeed");
        
        assert!(!result.passed); // Should fail with default tolerance
        assert!(result.max_abs_diff > 2);
        assert!(result.failed_pixels > 0);
    }
    
    #[test]
    fn test_macro_usage() {
        let mut rgba_data = Vec::new();
        for _ in 0..16 { // 4x4 gray pixels
            rgba_data.extend_from_slice(&[100, 100, 100, 255]);
        }
        
        let provider1 = MockProvider { rgba_data: rgba_data.clone() };
        let provider2 = MockProvider { rgba_data };
        
        let slice = SliceSpec::axial_at([0.0, 0.0, 0.0], [10.0, 10.0], [4, 4]);
        let layer = LayerSpec {
            volume_id: VolumeHandle::new(0),
            world_from_voxel: Matrix4::identity(),
            visual: LayerVisual::default(),
        };
        let request = CompositeRequest::new(slice, vec![layer]);
        
        // Should not panic
        assert_providers_match!(&provider1, &provider2, &request, "macro_test");
    }
}