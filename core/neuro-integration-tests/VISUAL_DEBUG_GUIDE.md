# Visual Debug System for Ellipsoid Coordinate Tests

## Overview

The visual debugging system generates interactive HTML reports that show ellipsoid coordinate transformation test results in a graphical format. This makes it easy to spot issues with CPU/GPU alignment, coordinate transformations, and rendering accuracy at a glance.

## Features

### 📊 Interactive Web Dashboard
- **Test Navigation**: Click between different test configurations
- **Slice Orientations**: View axial, coronal, and sagittal slices
- **Side-by-Side Comparisons**: Ground truth vs CPU vs GPU results
- **Difference Maps**: Highlight discrepancies between implementations
- **Metrics Dashboard**: Color-coded validation metrics (Dice, Hausdorff, etc.)

### 🎮 Interactive Controls
- **Keyboard Shortcuts**:
  - `←/→` : Navigate between slices
  - `Ctrl + ←/→` : Navigate between test cases
  - `1/2/3` : Switch slice orientations (Axial/Coronal/Sagittal)
  - `ESC` : Close modal dialogs
- **Mouse Interactions**:
  - Click images to enlarge them
  - Hover for detailed information
  - Tab navigation between orientations

### 🎨 Visual Elements
- **Color-coded metrics** based on performance thresholds
- **Responsive design** that works on different screen sizes
- **Image zoom and modal views** for detailed inspection
- **Professional styling** with gradients and animations

## Usage

### Basic Usage

```rust
use neuro_integration_tests::{
    EllipsoidTestRunner, EllipsoidTestConfig, VisualDebugConfig
};

// Create test runner
let mut runner = EllipsoidTestRunner::new(cpu_provider);

// Get test configurations
let test_configs = EllipsoidTestConfig::standard_test_suite();

// Run tests with visual debug output
let (results, report_path) = runner.run_test_suite_with_visual_debug(
    test_configs, 
    None // Use default config
)?;

println!("Open {} in your browser", report_path);
```

### Custom Configuration

```rust
use neuro_integration_tests::{VisualDebugConfig, SliceOrientation, ColorScheme};

let debug_config = VisualDebugConfig {
    output_dir: "my_debug_report".to_string(),
    slice_orientations: vec![
        SliceOrientation::Axial,
        SliceOrientation::Coronal,
        SliceOrientation::Sagittal,
    ],
    slices_per_orientation: 5,
    image_size: (512, 512), // Higher resolution
    generate_difference_maps: true,
    color_schemes: ColorSchemes {
        ground_truth: ColorScheme::Grayscale,
        cpu_result: ColorScheme::Viridis,
        gpu_result: ColorScheme::Plasma,
        difference: ColorScheme::Hot,
    },
};

let (results, report_path) = runner.run_test_suite_with_visual_debug(
    test_configs, 
    Some(debug_config)
)?;
```

### Generate Report from Existing Results

```rust
// If you already have test results, generate visual debug separately
let report_path = EllipsoidTestRunner::generate_visual_debug_report(
    &existing_results,
    Some(debug_config)
)?;
```

## Running the Visual Debug Test

```bash
# Generate a visual debug report (run manually)
cargo test test_ellipsoid_visual_debug_generation --ignored -- --nocapture

# The report will be generated in ./ellipsoid_debug_report/
# Open ellipsoid_debug_report.html in your browser
```

## Report Structure

The generated report includes:

```
ellipsoid_debug_report/
├── ellipsoid_debug_report.html    # Main interactive report
├── debug_report.css               # Styling
├── debug_report.js                # Interactive functionality
├── test_0_gt_axial_0.png         # Ground truth axial slice 0
├── test_0_cpu_axial_0.png        # CPU result axial slice 0
├── test_0_gpu_axial_0.png        # GPU result axial slice 0
├── test_0_diff_axial_0.png       # Difference map
└── ... (more slice images)
```

## Webpage Layout

### Header Section
- **Project title** and summary statistics
- **Pass/fail counts** and average Dice coefficient
- **Color-coded status indicators**

### Navigation Panel
- **Test case list** with clickable links
- **Quick navigation** between different ellipsoid configurations
- **Sticky positioning** for easy access

### Test Details
For each test case:

1. **Test Configuration**
   - Ellipsoid parameters (center, radii, rotation)
   - Volume configuration (dimensions, spacing, orientation)
   - Description and test purpose

2. **Metrics Dashboard**
   - Dice coefficient (color-coded: excellent/good/fair/poor)
   - Jaccard index
   - Hausdorff distance
   - Average symmetric surface distance
   - Volume difference percentage

3. **Slice Viewer**
   - **Orientation tabs**: Axial, Coronal, Sagittal
   - **Four-column layout**:
     - Ground Truth (ellipsoid rasterization)
     - CPU Result (when available)
     - GPU Result (when available)  
     - Difference Maps (highlighting discrepancies)

4. **Interactive Controls**
   - Slice navigation arrows
   - Current slice indicator
   - Image enlargement on click

## Color Coding

### Dice Coefficient Thresholds
- 🟢 **Excellent** (≥0.95): Green
- 🟡 **Good** (≥0.90): Orange  
- 🔴 **Fair** (≥0.80): Red
- ⚫ **Poor** (<0.80): Dark red

### Image Color Schemes
- **Ground Truth**: Grayscale (neutral reference)
- **CPU Results**: Viridis (purple-blue-green)
- **GPU Results**: Plasma (purple-pink-yellow)
- **Difference Maps**: Hot (black-red-yellow-white)

## Troubleshooting

### Report Not Generated
- Check that the output directory is writable
- Verify all dependencies are installed (`image` crate)
- Check console output for error messages

### Images Not Displaying
- Ensure PNG files are generated in the output directory
- Check browser console for loading errors
- Verify image file permissions

### Poor Visual Quality
- Increase `image_size` in configuration
- Use `rasterize_supersampled` with higher sample rates
- Check ellipsoid parameters for numerical issues

### Performance Issues
- Reduce `slices_per_orientation` for faster generation
- Use smaller `image_size` for quicker testing
- Disable `generate_difference_maps` if not needed

## Future Enhancements

### Planned Features
1. **Real-time CPU/GPU comparison** when slice extraction is implemented
2. **3D ellipsoid visualization** using WebGL
3. **Animated slice navigation** showing ellipsoid cross-sections
4. **Statistical analysis plots** showing metrics distributions
5. **Export functionality** for individual images and data
6. **Batch report generation** for multiple test runs
7. **Performance timeline** showing optimization progress

### Integration Points
- **CI/CD pipelines**: Automatic report generation on test failures
- **Development workflow**: Visual debugging during feature development
- **Documentation**: Embedded examples in project documentation
- **Research**: Visual validation for algorithm papers and presentations

## Best Practices

1. **Regular Generation**: Create visual reports for each major change
2. **Baseline Comparison**: Keep reference reports for regression testing
3. **Collaborative Review**: Share reports with team members for visual inspection
4. **Issue Documentation**: Include report screenshots in bug reports
5. **Performance Tracking**: Monitor Dice coefficients over time using reports

This visual debugging system transforms abstract numerical test results into intuitive visual feedback, making coordinate transformation validation much more accessible and effective.