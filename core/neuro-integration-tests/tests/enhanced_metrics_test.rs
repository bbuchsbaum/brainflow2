//! Test suite for enhanced differential metrics
//! 
//! This test validates that all enhanced metrics (SSIM, Jaccard Index, Max Absolute Error)
//! are properly computed and produce expected values for various test scenarios.

use neuro_integration_tests::DifferentialTestHarness;

#[test]
fn test_enhanced_metrics_identical_images() {
    println!("=== Testing Enhanced Metrics - Identical Images ===");
    
    let harness = DifferentialTestHarness::new();
    
    // Create identical 64x64 RGBA images (gray background)
    let size = 64 * 64 * 4;
    let image1 = vec![128u8; size];
    let image2 = vec![128u8; size];
    
    let metrics = harness.compute_metrics(&image1, &image2)
        .expect("Failed to compute metrics");
    
    println!("Identical images metrics:");
    println!("  Dice coefficient: {:.6}", metrics.dice_coefficient);
    println!("  Jaccard index: {:.6}", metrics.jaccard_index);
    println!("  RMSE: {:.6}", metrics.rmse);
    println!("  PSNR: {:.6}", metrics.psnr);
    println!("  SSIM: {:.6}", metrics.ssim);
    println!("  Max absolute difference: {}", metrics.max_absolute_difference);
    println!("  Max absolute error: {:.6}", metrics.max_absolute_error);
    println!("  Differing pixels: {}", metrics.differing_pixels);
    
    // Perfect match expectations
    assert_eq!(metrics.rmse, 0.0, "RMSE should be 0 for identical images");
    assert_eq!(metrics.max_absolute_difference, 0, "Max difference should be 0");
    assert_eq!(metrics.max_absolute_error, 0.0, "Max error should be 0");
    assert_eq!(metrics.differing_pixels, 0, "No pixels should differ");
    assert_eq!(metrics.difference_percentage, 0.0, "Difference percentage should be 0");
    assert!(metrics.psnr.is_infinite(), "PSNR should be infinity for perfect match");
    assert!((metrics.ssim - 1.0).abs() < 1e-10, "SSIM should be ~1.0 for identical images");
    
    // For identical uniform images, Dice and Jaccard should be 1.0 (both are empty or both are full)
    assert!((metrics.dice_coefficient - 1.0).abs() < 1e-10, "Dice should be 1.0 for identical images");
    assert!((metrics.jaccard_index - 1.0).abs() < 1e-10, "Jaccard should be 1.0 for identical images");
}

#[test]
fn test_enhanced_metrics_different_images() {
    println!("=== Testing Enhanced Metrics - Different Images ===");
    
    let harness = DifferentialTestHarness::new();
    
    // Create 16x16 RGBA images for simpler testing
    let size = 16 * 16 * 4;
    let mut image1 = vec![0u8; size]; // Black background
    let mut image2 = vec![0u8; size]; // Black background
    
    // Add some foreground in both images (partial overlap)
    // Image 1: square in top-left quadrant
    for y in 4..8 {
        for x in 4..8 {
            let idx = (y * 16 + x) * 4;
            image1[idx] = 255;     // R
            image1[idx + 1] = 0;   // G
            image1[idx + 2] = 0;   // B
            image1[idx + 3] = 255; // A (foreground)
        }
    }
    
    // Image 2: square in overlapping area + additional area
    for y in 6..10 {
        for x in 6..10 {
            let idx = (y * 16 + x) * 4;
            image2[idx] = 0;       // R
            image2[idx + 1] = 255; // G
            image2[idx + 2] = 0;   // B
            image2[idx + 3] = 255; // A (foreground)
        }
    }
    
    let metrics = harness.compute_metrics(&image1, &image2)
        .expect("Failed to compute metrics");
    
    println!("Different images metrics:");
    println!("  Dice coefficient: {:.6}", metrics.dice_coefficient);
    println!("  Jaccard index: {:.6}", metrics.jaccard_index);
    println!("  RMSE: {:.6}", metrics.rmse);
    println!("  PSNR: {:.6}", metrics.psnr);
    println!("  SSIM: {:.6}", metrics.ssim);
    println!("  Max absolute difference: {}", metrics.max_absolute_difference);
    println!("  Max absolute error: {:.6}", metrics.max_absolute_error);
    println!("  Differing pixels: {}", metrics.differing_pixels);
    println!("  Difference percentage: {:.2}%", metrics.difference_percentage);
    
    // Non-zero differences expected
    assert!(metrics.rmse > 0.0, "RMSE should be > 0 for different images");
    assert!(metrics.max_absolute_difference > 0, "Max difference should be > 0");
    assert!(metrics.max_absolute_error > 0.0, "Max error should be > 0");
    assert!(metrics.differing_pixels > 0, "Some pixels should differ");
    assert!(metrics.difference_percentage > 0.0, "Difference percentage should be > 0");
    assert!(metrics.psnr.is_finite() && metrics.psnr > 0.0, "PSNR should be finite and positive");
    
    // SSIM should be < 1 for different images
    assert!(metrics.ssim < 1.0, "SSIM should be < 1.0 for different images");
    assert!(metrics.ssim >= -1.0, "SSIM should be >= -1.0");
    
    // Dice and Jaccard should be between 0 and 1, with Jaccard <= Dice
    assert!(metrics.dice_coefficient >= 0.0 && metrics.dice_coefficient <= 1.0, 
        "Dice coefficient should be in [0,1]");
    assert!(metrics.jaccard_index >= 0.0 && metrics.jaccard_index <= 1.0, 
        "Jaccard index should be in [0,1]");
    assert!(metrics.jaccard_index <= metrics.dice_coefficient, 
        "Jaccard index should be <= Dice coefficient");
    
    // The two squares have partial overlap, so both Dice and Jaccard should be > 0
    assert!(metrics.dice_coefficient > 0.0, "Dice should be > 0 for overlapping shapes");
    assert!(metrics.jaccard_index > 0.0, "Jaccard should be > 0 for overlapping shapes");
}

#[test]
fn test_enhanced_metrics_no_overlap() {
    println!("=== Testing Enhanced Metrics - No Overlap ===");
    
    let harness = DifferentialTestHarness::new();
    
    // Create 16x16 RGBA images with no overlap
    let size = 16 * 16 * 4;
    let mut image1 = vec![0u8; size]; // Black background
    let mut image2 = vec![0u8; size]; // Black background
    
    // Image 1: square in top-left
    for y in 2..6 {
        for x in 2..6 {
            let idx = (y * 16 + x) * 4;
            image1[idx + 3] = 255; // Alpha only (foreground)
        }
    }
    
    // Image 2: square in bottom-right (no overlap)
    for y in 10..14 {
        for x in 10..14 {
            let idx = (y * 16 + x) * 4;
            image2[idx + 3] = 255; // Alpha only (foreground)
        }
    }
    
    let metrics = harness.compute_metrics(&image1, &image2)
        .expect("Failed to compute metrics");
    
    println!("No overlap images metrics:");
    println!("  Dice coefficient: {:.6}", metrics.dice_coefficient);
    println!("  Jaccard index: {:.6}", metrics.jaccard_index);
    
    // No overlap should result in 0 Dice and Jaccard
    assert_eq!(metrics.dice_coefficient, 0.0, "Dice should be 0 for no overlap");
    assert_eq!(metrics.jaccard_index, 0.0, "Jaccard should be 0 for no overlap");
}

#[test]
fn test_enhanced_metrics_mathematical_relationships() {
    println!("=== Testing Enhanced Metrics - Mathematical Relationships ===");
    
    let harness = DifferentialTestHarness::new();
    
    // Create various test scenarios
    let mut test_cases = Vec::new();
    
    // Identical images
    test_cases.push(("identical", vec![100u8; 64], vec![100u8; 64]));
    
    // Slightly different images  
    let mut img1 = vec![100u8; 64];
    let mut img2 = vec![100u8; 64];
    img2[0] = 105; // Small difference
    test_cases.push(("slight_diff", img1, img2));
    
    // Very different images
    test_cases.push(("large_diff", vec![0u8; 64], vec![255u8; 64]));
    
    for (name, image1, image2) in test_cases {
        let metrics = harness.compute_metrics(&image1, &image2)
            .expect(&format!("Failed to compute metrics for {}", name));
        
        println!("Test case '{}': Max err = {:.1}, Max diff = {}", 
            name, metrics.max_absolute_error, metrics.max_absolute_difference);
        
        // Max absolute error should equal max absolute difference (converted to float)
        assert_eq!(metrics.max_absolute_error, metrics.max_absolute_difference as f64,
            "Max absolute error should equal max absolute difference for {}", name);
        
        // Jaccard <= Dice (mathematical relationship)
        assert!(metrics.jaccard_index <= metrics.dice_coefficient + 1e-10,
            "Jaccard ({:.6}) should be <= Dice ({:.6}) for {}", 
            metrics.jaccard_index, metrics.dice_coefficient, name);
        
        // SSIM should be in valid range [-1, 1]
        assert!(metrics.ssim >= -1.0 && metrics.ssim <= 1.0,
            "SSIM ({:.6}) should be in [-1, 1] for {}", metrics.ssim, name);
    }
}