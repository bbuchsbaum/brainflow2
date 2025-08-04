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
pub mod differential_dashboard;
pub mod differential_harness;
pub mod ellipsoid_gpu_renderer;
pub mod ellipsoid_visualizer;
pub mod enhanced_visual_dashboard;
pub mod image_utils;
pub mod lib_simple;
pub mod orthogonal_dashboard;
pub mod orthogonal_renderer;
pub mod roi_overlay_dashboard;
pub mod simple_visual_dashboard;

// TODO: Re-enable these exports when modules are fixed
// pub use test_utils::*;
// pub use volume_fixtures::*;
// pub use comparison_harness::*;
// pub use ellipsoid_tests::*;
// pub use ellipsoid_runner::*;
// pub use visual_debug::*;

pub use differential_dashboard::{
    run_differential_testing_with_dashboard, ComparisonImagePaths, DifferentialDashboard,
};
pub use differential_harness::{
    DifferentialMetrics, DifferentialTestHarness, DifferentialTestResult, OrthogonalTestResult,
};
pub use ellipsoid_gpu_renderer::GpuEllipsoidRenderer;
pub use ellipsoid_visualizer::EllipsoidVisualizer;
pub use enhanced_visual_dashboard::{EnhancedTestResult, EnhancedVisualDashboard};
pub use image_utils::{save_rgba_image_with_dimensions, ImageDimensions, RgbaImageWithDimensions};
pub use lib_simple::*;
pub use orthogonal_dashboard::{run_orthogonal_testing_with_dashboard, OrthogonalDashboard};
pub use orthogonal_renderer::{
    add_crosshairs_to_slices, create_orthogonal_slices, draw_crosshairs, OrthogonalSliceConfig,
    OrthogonalSlices,
};
pub use roi_overlay_dashboard::RoiOverlayDashboard;
pub use simple_visual_dashboard::SimpleVisualDashboard;
