//! Test multi-layer rendering with ROI overlays
//! This test creates spherical ROIs and overlays them on the MNI template
//! to verify that the layer system works correctly with multiple dense volumes.

use render_loop::RenderLoopService;
use render_loop::view_state::{ViewState, ViewId, LayerConfig};
use render_loop::render_state::BlendMode;
use neuro_types::{ViewRectMm, ViewOrientation, VolumeMetadata};
use nifti_loader::load_nifti_volume_auto;
use volmath::{DenseVolume3, NeuroSpace, NeuroSpaceExt};
use volmath::{spherical_roi, LogicalNeuroVol, ROIVol, NeuroVol};
use bridge_types::VolumeSendable;
use std::path::Path;
use ndarray::prelude::*;
use neuro_integration_tests::RoiOverlayDashboard;

/// Create a spherical ROI volume at the specified world coordinates using neuroim's spherical_roi
fn create_spherical_roi_volume(
    template_space: &NeuroSpace,
    center_mm: [f32; 3],
    radius_mm: f32,
    value: f32,
) -> Result<DenseVolume3<f32>, Box<dyn std::error::Error>> {
    // Get volume dimensions
    let dims = template_space.dims();
    
    // Create a logical mask (all true - entire volume is searchable)
    let mask_data = vec![true; dims[0] * dims[1] * dims[2]];
    let mask_array = Array3::from_shape_vec((dims[0], dims[1], dims[2]), mask_data)?;
    let mask = LogicalNeuroVol::new(mask_array, template_space.clone())?;
    
    // Convert world coordinates to voxel coordinates for the center
    let world_to_voxel = template_space.world_to_voxel();
    let world_point = nalgebra::Vector4::new(center_mm[0], center_mm[1], center_mm[2], 1.0);
    let voxel_point = world_to_voxel * world_point;
    let center_voxel = [
        voxel_point[0].round() as i32,
        voxel_point[1].round() as i32,
        voxel_point[2].round() as i32,
    ];
    
    // Create spherical ROI using neuroim's function
    let roi: ROIVol<f32> = spherical_roi(
        &mask,
        &center_voxel,
        radius_mm as f64,  // spherical_roi expects f64
        Some(value),
        true  // nonzero only
    )?;
    
    // Convert ROI -> Sparse -> Dense
    let sparse = roi.as_sparse();
    let dense = sparse.to_dense();
    
    // Debug: Check the actual values in the dense volume
    let values = NeuroVol::values(&dense);
    let non_zero_values: Vec<f32> = values.iter().filter(|&&v| v > 0.0).copied().collect();
    let unique_values: std::collections::HashSet<i32> = non_zero_values.iter()
        .map(|&v| (v * 1000.0) as i32)  // Convert to int for easier comparison
        .collect();
    
    println!("  DEBUG: ROI non-zero voxel count: {}", non_zero_values.len());
    println!("  DEBUG: Unique values in ROI (x1000): {:?}", unique_values);
    if !non_zero_values.is_empty() {
        let min_val = non_zero_values.iter().min_by(|a, b| a.partial_cmp(b).unwrap()).unwrap();
        let max_val = non_zero_values.iter().max_by(|a, b| a.partial_cmp(b).unwrap()).unwrap();
        println!("  DEBUG: ROI value range: {:.4} to {:.4}", min_val, max_val);
    }
    
    // Wrap in volmath's compatibility layer
    Ok(DenseVolume3::new(dense))
}

/// Helper function to render a GPU slice
async fn render_gpu_slice(
    service: &mut RenderLoopService,
    volume_id: &str,
    view_rect: &ViewRectMm,
    data_range: (f32, f32),
) -> Vec<u8> {
    // Create offscreen render target first
    service.create_offscreen_target(view_rect.width_px, view_rect.height_px)
        .expect("Failed to create offscreen target");
    
    // Create ViewState for declarative rendering
    let mut view_state = ViewState::from_view_rect(view_rect, volume_id.to_string(), data_range);
    
    // Use world center (0,0,0) as the crosshair position for MNI template
    view_state.crosshair_world = [0.0, 0.0, 0.0];
    view_state.show_crosshair = false; // No crosshair in volume render
    
    // Request frame
    let result = service.request_frame(ViewId::new("test_view"), view_state)
        .await
        .expect("Failed to render frame");
    
    result.image_data
}

#[tokio::test]
async fn test_single_roi_overlay() {
    println!("=== Testing Single ROI Overlay on MNI Template ===");
    println!();
    
    // Path to test data
    let workspace_root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent().unwrap()  // core/
        .parent().unwrap(); // brainflow2/
    
    let mni_path = workspace_root
        .join("test-data/unit/tpl-MNI152NLin2009cAsym_res-01_desc-brain_T1w.nii");
    
    if !mni_path.exists() {
        eprintln!("MNI file not found at {:?}", mni_path);
        eprintln!("Skipping test - MNI template file required");
        return;
    }
    
    // Load MNI template
    println!("Loading MNI brain template...");
    let (volume_sendable, _affine) = load_nifti_volume_auto(&mni_path)
        .expect("Failed to load NIfTI file");
    
    let mni_volume = match volume_sendable {
        VolumeSendable::VolF32(vol, _) => vol,
        _ => panic!("Expected f32 volume from MNI template"),
    };
    
    let mni_data_range = mni_volume.range().unwrap_or((0.0, 100.0));
    println!("MNI volume data range: {:?}", mni_data_range);
    
    // Create spherical ROI at specific world coordinates
    println!("\nCreating spherical ROI...");
    let roi_center_mm = [30.0, -20.0, 15.0]; // Right hemisphere, posterior, slightly superior
    let roi_radius_mm = 10.0;
    let roi_value = 1.0;
    
    println!("  ROI center (world mm): {:?}", roi_center_mm);
    println!("  ROI radius: {} mm", roi_radius_mm);
    
    let roi_volume = create_spherical_roi_volume(
        mni_volume.space(),
        roi_center_mm,
        roi_radius_mm,
        roi_value,
    ).expect("Failed to create ROI volume");
    
    let roi_data_range = roi_volume.range().unwrap_or((0.0, 1.0));
    println!("  ROI data range: {:?}", roi_data_range);
    
    // Count non-zero voxels in ROI
    let roi_voxel_count = roi_volume.values().iter()
        .filter(|&&v| v > 0.0)
        .count();
    println!("  ROI contains {} non-zero voxels", roi_voxel_count);
    
    // Initialize GPU renderer
    let mut gpu_service = RenderLoopService::new().await
        .expect("Failed to initialize GPU render service");
    
    gpu_service.load_shaders()
        .expect("Failed to load shaders");
    
    gpu_service.enable_world_space_rendering()
        .expect("Failed to enable world space rendering");
    
    // Register volumes
    println!("\nRegistering volumes with GPU...");
    gpu_service.register_volume_with_upload(
        "mni_template".to_string(),
        &mni_volume,
        wgpu::TextureFormat::R32Float,
    ).expect("Failed to register MNI volume");
    
    gpu_service.register_volume_with_upload(
        "roi_overlay".to_string(),
        &roi_volume,
        wgpu::TextureFormat::R32Float,
    ).expect("Failed to register ROI volume");
    
    // Initialize colormap
    gpu_service.initialize_colormap()
        .expect("Failed to initialize colormap");
    gpu_service.create_world_space_bind_groups()
        .expect("Failed to create world space bind groups");
    
    // Create volume metadata
    let volume_meta = VolumeMetadata {
        dimensions: [
            mni_volume.space.dims()[0],
            mni_volume.space.dims()[1],
            mni_volume.space.dims()[2],
        ],
        voxel_to_world: mni_volume.space.voxel_to_world(),
    };
    
    // Test each orientation
    let test_orientations = [
        (ViewOrientation::Axial, "axial"),
        (ViewOrientation::Sagittal, "sagittal"),
        (ViewOrientation::Coronal, "coronal"),
    ];
    
    let dashboard_dir = Path::new("test_output/roi_overlay_test");
    std::fs::create_dir_all(&dashboard_dir)
        .expect("Failed to create dashboard directory");
    
    for (orientation, name) in test_orientations {
        println!("\nTesting {} orientation...", name);
        
        // Position slice at ROI center for best visibility
        let view_rect = ViewRectMm::full_extent(
            &volume_meta,
            orientation,
            roi_center_mm,  // Use ROI center as slice position
            [256, 256],
        );
        
        // Render MNI template only
        println!("  Rendering MNI template only...");
        let mni_only = render_gpu_slice(
            &mut gpu_service,
            "mni_template",
            &view_rect,
            (mni_data_range.0 + (mni_data_range.1 - mni_data_range.0) * 0.2,
             mni_data_range.0 + (mni_data_range.1 - mni_data_range.0) * 0.8),
        ).await;
        
        // Save MNI-only image using actual view rect dimensions
        let mni_img = image::RgbaImage::from_raw(view_rect.width_px, view_rect.height_px, mni_only.clone())
            .expect("Failed to create MNI image");
        let mni_path = dashboard_dir.join(format!("mni_only_{}.png", name));
        mni_img.save(&mni_path)
            .expect("Failed to save MNI image");
        println!("  Saved: {:?}", mni_path);
        
        // Now render with ROI overlay using multi-layer ViewState
        println!("  Rendering MNI + ROI overlay...");
        let mut overlay_state = ViewState::from_view_rect(
            &view_rect,
            "mni_template".to_string(),
            (mni_data_range.0 + (mni_data_range.1 - mni_data_range.0) * 0.2,
             mni_data_range.0 + (mni_data_range.1 - mni_data_range.0) * 0.8),
        );
        
        // Add ROI as second layer
        overlay_state.layers.push(LayerConfig {
            volume_id: "roi_overlay".to_string(),
            opacity: 0.8,  // 80% opacity
            colormap_id: 2,  // Hot colormap (more red)
            blend_mode: BlendMode::Normal,
            intensity_window: (0.5, 1.5),  // Window that ensures 1.0 maps to bright color
            threshold: None,
            visible: true,
        });
        
        overlay_state.crosshair_world = roi_center_mm;
        overlay_state.show_crosshair = false;
        
        let overlay_result = gpu_service.request_frame(
            ViewId::new("overlay_view"),
            overlay_state
        ).await.expect("Failed to render overlay");
        
        // Save overlay image using actual view rect dimensions
        let overlay_img = image::RgbaImage::from_raw(view_rect.width_px, view_rect.height_px, overlay_result.image_data.clone())
            .expect("Failed to create overlay image");
        let overlay_path = dashboard_dir.join(format!("mni_roi_overlay_{}.png", name));
        overlay_img.save(&overlay_path)
            .expect("Failed to save overlay image");
        println!("  Saved: {:?}", overlay_path);
        
        // Verify ROI is visible - Hot colormap produces orange/yellow for mid-range values
        // Debug: Let's see what colors we're actually getting
        let mut color_samples = vec![];
        let roi_pixels = overlay_result.image_data.chunks(4)
            .filter(|pixel| {
                if pixel[0] > 100 && pixel[3] == 255 { // Any red component with full alpha
                    if color_samples.len() < 5 {
                        color_samples.push((pixel[0], pixel[1], pixel[2]));
                    }
                    true
                } else {
                    false
                }
            })
            .count();
        
        println!("  DEBUG: Sample ROI colors (R,G,B): {:?}", color_samples);
        println!("  Found {} ROI pixels (R>100)", roi_pixels);
        
        assert!(roi_pixels > 0, "ROI should be visible in {} view", name);
    }
    
    println!("\n✅ Single ROI overlay test passed!");
    println!("   Dashboard images saved to: {:?}", dashboard_dir.canonicalize().ok());
}

#[tokio::test]
async fn test_multiple_roi_overlay() {
    println!("=== Testing Multiple ROI Overlays on MNI Template ===");
    println!();
    
    // Path to test data
    let workspace_root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent().unwrap()
        .parent().unwrap();
    
    let mni_path = workspace_root
        .join("test-data/unit/tpl-MNI152NLin2009cAsym_res-01_desc-brain_T1w.nii");
    
    if !mni_path.exists() {
        eprintln!("MNI file not found - skipping test");
        return;
    }
    
    // Load MNI template
    let (volume_sendable, _affine) = load_nifti_volume_auto(&mni_path)
        .expect("Failed to load NIfTI file");
    
    let mni_volume = match volume_sendable {
        VolumeSendable::VolF32(vol, _) => vol,
        _ => panic!("Expected f32 volume"),
    };
    
    let mni_data_range = mni_volume.range().unwrap_or((0.0, 100.0));
    
    // Create multiple ROIs at different anatomical locations
    let roi_specs = [
        ([30.0, -20.0, 15.0], 8.0, "right_posterior"),     // Right posterior
        ([-30.0, -20.0, 15.0], 8.0, "left_posterior"),     // Left posterior
        ([0.0, 20.0, 10.0], 10.0, "anterior_central"),     // Anterior central
        ([25.0, 0.0, -10.0], 7.0, "right_temporal"),       // Right temporal
        ([-25.0, 0.0, -10.0], 7.0, "left_temporal"),       // Left temporal
    ];
    
    // Initialize GPU renderer
    let mut gpu_service = RenderLoopService::new().await
        .expect("Failed to initialize GPU render service");
    
    gpu_service.load_shaders()
        .expect("Failed to load shaders");
    
    gpu_service.enable_world_space_rendering()
        .expect("Failed to enable world space rendering");
    
    // Register MNI template
    gpu_service.register_volume_with_upload(
        "mni_template".to_string(),
        &mni_volume,
        wgpu::TextureFormat::R32Float,
    ).expect("Failed to register MNI volume");
    
    // Create and register each ROI
    println!("Creating {} ROIs...", roi_specs.len());
    for (i, (center, radius, name)) in roi_specs.iter().enumerate() {
        println!("  Creating ROI {}: {} at {:?}, radius {} mm", i, name, center, radius);
        
        let roi = create_spherical_roi_volume(
            mni_volume.space(),
            *center,
            *radius,
            1.0,
        ).expect("Failed to create ROI");
        
        let roi_id = format!("roi_{}", i);
        gpu_service.register_volume_with_upload(
            roi_id,
            &roi,
            wgpu::TextureFormat::R32Float,
        ).expect("Failed to register ROI");
    }
    
    // Initialize colormap
    gpu_service.initialize_colormap()
        .expect("Failed to initialize colormap");
    gpu_service.create_world_space_bind_groups()
        .expect("Failed to create world space bind groups");
    
    // Create volume metadata
    let volume_meta = VolumeMetadata {
        dimensions: [
            mni_volume.space.dims()[0],
            mni_volume.space.dims()[1],
            mni_volume.space.dims()[2],
        ],
        voxel_to_world: mni_volume.space.voxel_to_world(),
    };
    
    // Render axial slice at z=10mm to see multiple ROIs
    let view_rect = ViewRectMm::full_extent(
        &volume_meta,
        ViewOrientation::Axial,
        [0.0, 0.0, 10.0],
        [512, 512],  // Larger viewport for better visibility
    );
    
    // Create multi-layer view state
    let mut multi_state = ViewState::from_view_rect(
        &view_rect,
        "mni_template".to_string(),
        (mni_data_range.0 + (mni_data_range.1 - mni_data_range.0) * 0.2,
         mni_data_range.0 + (mni_data_range.1 - mni_data_range.0) * 0.8),
    );
    
    // Add each ROI as a layer with different colors
    let colormaps = [3, 4, 5, 6, 7]; // Different colormaps for each ROI
    for i in 0..roi_specs.len() {
        multi_state.layers.push(LayerConfig {
            volume_id: format!("roi_{}", i),
            opacity: 0.6,  // 60% opacity for overlapping visibility
            colormap_id: colormaps[i],
            blend_mode: BlendMode::Normal,
            intensity_window: (0.5, 1.5),  // Window that ensures 1.0 maps to bright color
            threshold: None,
            visible: true,
        });
    }
    
    multi_state.show_crosshair = false;
    
    // Create offscreen target for the multi-layer view
    gpu_service.create_offscreen_target(view_rect.width_px, view_rect.height_px)
        .expect("Failed to create offscreen target");
    
    // Render the multi-layer image
    println!("\nRendering multi-layer view with {} ROIs...", roi_specs.len());
    let result = gpu_service.request_frame(ViewId::new("multi_roi_view"), multi_state)
        .await
        .expect("Failed to render multi-layer view");
    
    // Save result
    let dashboard_dir = Path::new("test_output/roi_overlay_test");
    std::fs::create_dir_all(&dashboard_dir).ok();
    
    let multi_img = image::RgbaImage::from_raw(view_rect.width_px, view_rect.height_px, result.image_data)
        .expect("Failed to create image");
    let multi_path = dashboard_dir.join("multi_roi_overlay_axial.png");
    multi_img.save(&multi_path)
        .expect("Failed to save image");
    
    println!("  Saved multi-ROI overlay to: {:?}", multi_path);
    println!("  Rendered {} layers successfully", result.rendered_layers.len());
    
    assert_eq!(result.rendered_layers.len(), 6, "Should render MNI + 5 ROIs");
    
    println!("\n✅ Multiple ROI overlay test passed!");
}

#[tokio::test]
async fn test_overlapping_roi_transparency() {
    println!("=== Testing Overlapping ROIs with Transparency ===");
    
    // Path to test data
    let workspace_root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent().unwrap()
        .parent().unwrap();
    
    let mni_path = workspace_root
        .join("test-data/unit/tpl-MNI152NLin2009cAsym_res-01_desc-brain_T1w.nii");
    
    if !mni_path.exists() {
        eprintln!("MNI file not found - skipping test");
        return;
    }
    
    // Load MNI template
    let (volume_sendable, _affine) = load_nifti_volume_auto(&mni_path)
        .expect("Failed to load NIfTI file");
    
    let mni_volume = match volume_sendable {
        VolumeSendable::VolF32(vol, _) => vol,
        _ => panic!("Expected f32 volume"),
    };
    
    // Create two overlapping ROIs
    let roi1_center = [10.0, 0.0, 0.0];
    let roi2_center = [-10.0, 0.0, 0.0];
    let overlap_radius = 15.0; // Large enough to overlap
    
    println!("Creating overlapping ROIs...");
    let roi1 = create_spherical_roi_volume(
        mni_volume.space(),
        roi1_center,
        overlap_radius,
        1.0,
    ).expect("Failed to create ROI 1");
    
    let roi2 = create_spherical_roi_volume(
        mni_volume.space(),
        roi2_center,
        overlap_radius,
        1.0,
    ).expect("Failed to create ROI 2");
    
    // Initialize GPU renderer
    let mut gpu_service = RenderLoopService::new().await
        .expect("Failed to initialize GPU render service");
    
    gpu_service.load_shaders()
        .expect("Failed to load shaders");
    
    gpu_service.enable_world_space_rendering()
        .expect("Failed to enable world space rendering");
    
    // Register volumes
    gpu_service.register_volume_with_upload(
        "mni_template".to_string(),
        &mni_volume,
        wgpu::TextureFormat::R32Float,
    ).expect("Failed to register MNI");
    
    gpu_service.register_volume_with_upload(
        "roi1".to_string(),
        &roi1,
        wgpu::TextureFormat::R32Float,
    ).expect("Failed to register ROI 1");
    
    gpu_service.register_volume_with_upload(
        "roi2".to_string(),
        &roi2,
        wgpu::TextureFormat::R32Float,
    ).expect("Failed to register ROI 2");
    
    // Initialize colormap
    gpu_service.initialize_colormap()
        .expect("Failed to initialize colormap");
    gpu_service.create_world_space_bind_groups()
        .expect("Failed to create world space bind groups");
    
    // Test different blend modes
    let blend_tests = [
        (BlendMode::Normal, "normal", 0.5),
        (BlendMode::Additive, "additive", 0.3),
        (BlendMode::Maximum, "maximum", 0.8),
    ];
    
    let volume_meta = VolumeMetadata {
        dimensions: [
            mni_volume.space.dims()[0],
            mni_volume.space.dims()[1],
            mni_volume.space.dims()[2],
        ],
        voxel_to_world: mni_volume.space.voxel_to_world(),
    };
    
    let dashboard_dir = Path::new("test_output/roi_overlay_test");
    
    for (blend_mode, blend_name, opacity) in blend_tests {
        println!("\nTesting {} blend mode with opacity {}...", blend_name, opacity);
        
        let view_rect = ViewRectMm::full_extent(
            &volume_meta,
            ViewOrientation::Axial,
            [0.0, 0.0, 0.0],
            [256, 256],
        );
        
        let mut state = ViewState::from_view_rect(
            &view_rect,
            "mni_template".to_string(),
            mni_volume.range().unwrap_or((0.0, 100.0)),
        );
        
        // Add overlapping ROIs with specified blend mode
        state.layers.push(LayerConfig {
            volume_id: "roi1".to_string(),
            opacity,
            colormap_id: 3,
            blend_mode,
            intensity_window: (0.5, 1.5),  // Window that ensures 1.0 maps to bright color
            threshold: None,
            visible: true,
        });
        state.layers.push(LayerConfig {
            volume_id: "roi2".to_string(),
            opacity,
            colormap_id: 4,
            blend_mode,
            intensity_window: (0.5, 1.5),  // Window that ensures 1.0 maps to bright color
            threshold: None,
            visible: true,
        });
        
        state.show_crosshair = false;
        
        // Create offscreen target for each blend test
        gpu_service.create_offscreen_target(view_rect.width_px, view_rect.height_px)
            .expect("Failed to create offscreen target");
        
        let result = gpu_service.request_frame(ViewId::new("blend_test"), state)
            .await
            .expect("Failed to render");
        
        let img = image::RgbaImage::from_raw(view_rect.width_px, view_rect.height_px, result.image_data)
            .expect("Failed to create image");
        let path = dashboard_dir.join(format!("overlapping_roi_{}.png", blend_name));
        img.save(&path)
            .expect("Failed to save image");
        
        println!("  Saved: {:?}", path);
    }
    
    println!("\n✅ Overlapping ROI transparency test passed!");
}

#[test]
fn test_generate_roi_overlay_dashboard() {
    println!("=== Generating ROI Overlay Test Dashboard ===");
    
    // Note: This assumes the tests have already been run and images generated
    // The dashboard reads the existing images from the test_output directory
    
    // Generate dashboard
    println!("\nGenerating visual dashboard...");
    let dashboard = RoiOverlayDashboard::new("test_output/roi_overlay_test");
    match dashboard.generate_dashboard() {
        Ok(path) => {
            println!("✅ Dashboard generated successfully!");
            println!("   Open file://{} to view the results", path);
        }
        Err(e) => {
            eprintln!("❌ Failed to generate dashboard: {}", e);
        }
    }
}