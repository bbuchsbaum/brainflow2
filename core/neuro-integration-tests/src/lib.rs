//! Integration test harness for CPU/GPU differential testing
//! 
//! This module provides utilities for comparing CPU and GPU slice extraction
//! implementations to ensure they produce consistent results.

// TODO: Re-enable these modules when they're updated for current API
// pub mod test_utils;
// pub mod volume_fixtures;
// pub mod comparison_harness;
// pub mod ellipsoid_tests;
// pub mod ellipsoid_runner;
// pub mod visual_debug;

// Simplified working modules
pub mod lib_simple;
pub mod simple_visual_dashboard;
pub mod ellipsoid_visualizer;
pub mod enhanced_visual_dashboard;
pub mod ellipsoid_gpu_renderer;
pub mod differential_harness;
pub mod differential_dashboard;
pub mod orthogonal_renderer;
pub mod orthogonal_dashboard;
pub mod image_utils;
pub mod roi_overlay_dashboard;

// TODO: Re-enable these exports when modules are fixed
// pub use test_utils::*;
// pub use volume_fixtures::*;
// pub use comparison_harness::*;
// pub use ellipsoid_tests::*;
// pub use ellipsoid_runner::*;
// pub use visual_debug::*;

pub use lib_simple::*;
pub use simple_visual_dashboard::{SimpleVisualDashboard};
pub use ellipsoid_visualizer::{EllipsoidVisualizer};
pub use enhanced_visual_dashboard::{EnhancedVisualDashboard, EnhancedTestResult};
pub use ellipsoid_gpu_renderer::GpuEllipsoidRenderer;
pub use differential_harness::{DifferentialTestHarness, DifferentialTestResult, DifferentialMetrics, OrthogonalTestResult};
pub use differential_dashboard::{DifferentialDashboard, ComparisonImagePaths, run_differential_testing_with_dashboard};
pub use orthogonal_renderer::{OrthogonalSlices, OrthogonalSliceConfig, create_orthogonal_slices, add_crosshairs_to_slices, draw_crosshairs};
pub use orthogonal_dashboard::{OrthogonalDashboard, run_orthogonal_testing_with_dashboard};
pub use image_utils::{save_rgba_image_with_dimensions, ImageDimensions, RgbaImageWithDimensions};
pub use roi_overlay_dashboard::RoiOverlayDashboard;