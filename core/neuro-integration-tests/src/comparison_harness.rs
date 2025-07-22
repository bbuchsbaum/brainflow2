//! Comparison harness for CPU/GPU differential testing

use neuro_types::{SliceProvider, CompositeRequest, testing::{DifferentialTester, DiffTestConfig}};
use std::sync::Arc;
use tokio::runtime::Runtime;
use anyhow::{Result, Context};

/// Main integration test harness for CPU/GPU comparison
pub struct ComparisonHarness {
    cpu_provider: Box<dyn SliceProvider>,
    gpu_provider: Box<dyn SliceProvider>,
    tester: DifferentialTester,
    runtime: Runtime,
}

impl ComparisonHarness {
    /// Create a new comparison harness with default configuration
    pub fn new(
        cpu_provider: Box<dyn SliceProvider>,
        gpu_provider: Box<dyn SliceProvider>,
    ) -> Result<Self> {
        let runtime = Runtime::new().context("Failed to create tokio runtime")?;
        
        Ok(Self {
            cpu_provider,
            gpu_provider,
            tester: DifferentialTester::default(),
            runtime,
        })
    }
    
    /// Create a harness with custom differential testing configuration
    pub fn with_config(
        cpu_provider: Box<dyn SliceProvider>,
        gpu_provider: Box<dyn SliceProvider>,
        config: DiffTestConfig,
    ) -> Result<Self> {
        let runtime = Runtime::new().context("Failed to create tokio runtime")?;
        
        Ok(Self {
            cpu_provider,
            gpu_provider,
            tester: DifferentialTester::with_config(config),
            runtime,
        })
    }
    
    /// Run a single differential test
    pub fn run_test(
        &self,
        request: &CompositeRequest,
        test_name: &str,
    ) -> Result<TestResult> {
        println!("Running differential test: {}", test_name);
        
        // Time the CPU execution
        let cpu_start = std::time::Instant::now();
        let cpu_result = self.cpu_provider.composite_rgba(request)
            .context("CPU provider failed")?;
        let cpu_duration = cpu_start.elapsed();
        
        // Time the GPU execution
        let gpu_start = std::time::Instant::now();
        let gpu_result = self.gpu_provider.composite_rgba(request)
            .context("GPU provider failed")?;
        let gpu_duration = gpu_start.elapsed();
        
        // Compare outputs
        let diff_result = self.tester.compare_outputs(&cpu_result, &gpu_result, test_name)
            .context("Differential comparison failed")?;
        
        Ok(TestResult {
            test_name: test_name.to_string(),
            passed: diff_result.passed,
            cpu_duration,
            gpu_duration,
            speedup: cpu_duration.as_secs_f64() / gpu_duration.as_secs_f64(),
            diff_result,
            cpu_output_size: cpu_result.len(),
            gpu_output_size: gpu_result.len(),
        })
    }
    
    /// Run a suite of tests
    pub fn run_test_suite(
        &self,
        tests: Vec<(&str, CompositeRequest)>,
    ) -> TestSuiteResult {
        let mut results = Vec::new();
        let mut passed = 0;
        let mut failed = 0;
        
        for (test_name, request) in tests {
            match self.run_test(&request, test_name) {
                Ok(result) => {
                    if result.passed {
                        passed += 1;
                        println!("✓ {} - PASSED (speedup: {:.2}x)", test_name, result.speedup);
                    } else {
                        failed += 1;
                        println!("✗ {} - FAILED", test_name);
                        println!("  Max abs diff: {}", result.diff_result.max_abs_diff);
                        println!("  Failed pixels: {} / {}", 
                                result.diff_result.failed_pixels,
                                result.diff_result.total_pixels);
                    }
                    results.push(result);
                }
                Err(e) => {
                    failed += 1;
                    println!("✗ {} - ERROR: {}", test_name, e);
                    results.push(TestResult::error(test_name, e.to_string()));
                }
            }
        }
        
        let total_tests = passed + failed;
        let pass_rate = if total_tests > 0 {
            100.0 * passed as f64 / total_tests as f64
        } else {
            0.0
        };
        
        // Calculate average speedup for passed tests
        let avg_speedup = results.iter()
            .filter(|r| r.passed)
            .map(|r| r.speedup)
            .fold(0.0, |acc, s| acc + s) / passed.max(1) as f64;
        
        TestSuiteResult {
            total_tests,
            passed,
            failed,
            pass_rate,
            avg_speedup,
            results,
        }
    }
}

/// Result of a single differential test
#[derive(Debug, Clone)]
pub struct TestResult {
    pub test_name: String,
    pub passed: bool,
    pub cpu_duration: std::time::Duration,
    pub gpu_duration: std::time::Duration,
    pub speedup: f64,
    pub diff_result: neuro_types::testing::DiffTestResult,
    pub cpu_output_size: usize,
    pub gpu_output_size: usize,
}

impl TestResult {
    /// Create an error result
    fn error(test_name: &str, error: String) -> Self {
        Self {
            test_name: test_name.to_string(),
            passed: false,
            cpu_duration: std::time::Duration::ZERO,
            gpu_duration: std::time::Duration::ZERO,
            speedup: 0.0,
            diff_result: neuro_types::testing::DiffTestResult {
                passed: false,
                max_abs_diff: 255,
                max_rel_diff: 1.0,
                failed_pixels: 0,
                total_pixels: 0,
                stats: neuro_types::testing::DiffStats {
                    mean_abs_diff: 0.0,
                    std_abs_diff: 0.0,
                    p95_abs_diff: 0,
                    exact_matches: 0,
                },
            },
            cpu_output_size: 0,
            gpu_output_size: 0,
        }
    }
}

/// Result of a test suite run
#[derive(Debug)]
pub struct TestSuiteResult {
    pub total_tests: usize,
    pub passed: usize,
    pub failed: usize,
    pub pass_rate: f64,
    pub avg_speedup: f64,
    pub results: Vec<TestResult>,
}

impl TestSuiteResult {
    /// Print a summary of the test suite results
    pub fn print_summary(&self) {
        println!("\n=== Test Suite Summary ===");
        println!("Total Tests: {}", self.total_tests);
        println!("Passed: {} ({:.1}%)", self.passed, self.pass_rate);
        println!("Failed: {}", self.failed);
        println!("Average GPU Speedup: {:.2}x", self.avg_speedup);
        
        if self.failed > 0 {
            println!("\nFailed Tests:");
            for result in &self.results {
                if !result.passed {
                    println!("  - {}", result.test_name);
                }
            }
        }
        
        println!("\nPerformance Summary:");
        for result in &self.results {
            if result.passed {
                println!("  {} - CPU: {:?}, GPU: {:?} (speedup: {:.2}x)",
                        result.test_name,
                        result.cpu_duration,
                        result.gpu_duration,
                        result.speedup);
            }
        }
    }
    
    /// Export results to JSON
    pub fn to_json(&self) -> Result<String> {
        // For now, just create a simple JSON representation
        // In a real implementation, we'd use serde
        let json = format!(r#"{{
    "total_tests": {},
    "passed": {},
    "failed": {},
    "pass_rate": {:.2},
    "avg_speedup": {:.2},
    "results": [{}]
}}"#,
            self.total_tests,
            self.passed,
            self.failed,
            self.pass_rate,
            self.avg_speedup,
            self.results.iter()
                .map(|r| format!(r#"{{
        "test_name": "{}",
        "passed": {},
        "cpu_duration_ms": {:.2},
        "gpu_duration_ms": {:.2},
        "speedup": {:.2},
        "max_abs_diff": {},
        "failed_pixels": {}
    }}"#,
                    r.test_name,
                    r.passed,
                    r.cpu_duration.as_secs_f64() * 1000.0,
                    r.gpu_duration.as_secs_f64() * 1000.0,
                    r.speedup,
                    r.diff_result.max_abs_diff,
                    r.diff_result.failed_pixels
                ))
                .collect::<Vec<_>>()
                .join(",\n        ")
        );
        
        Ok(json)
    }
}

/// Builder for creating test harnesses with standard configurations
pub struct HarnessBuilder {
    cpu_provider: Option<Box<dyn SliceProvider>>,
    gpu_provider: Option<Box<dyn SliceProvider>>,
    config: DiffTestConfig,
}

impl HarnessBuilder {
    pub fn new() -> Self {
        Self {
            cpu_provider: None,
            gpu_provider: None,
            config: DiffTestConfig::default(),
        }
    }
    
    pub fn with_cpu_provider(mut self, provider: Box<dyn SliceProvider>) -> Self {
        self.cpu_provider = Some(provider);
        self
    }
    
    pub fn with_gpu_provider(mut self, provider: Box<dyn SliceProvider>) -> Self {
        self.gpu_provider = Some(provider);
        self
    }
    
    pub fn with_tolerance(mut self, max_abs_diff: u8, max_rel_diff: f32) -> Self {
        self.config.max_abs_diff = max_abs_diff;
        self.config.max_rel_diff = max_rel_diff;
        self
    }
    
    pub fn with_debug_images(mut self, enabled: bool) -> Self {
        self.config.save_debug_images = enabled;
        self
    }
    
    pub fn build(self) -> Result<ComparisonHarness> {
        let cpu = self.cpu_provider.context("CPU provider not set")?;
        let gpu = self.gpu_provider.context("GPU provider not set")?;
        
        ComparisonHarness::with_config(cpu, gpu, self.config)
    }
}