//! Test to verify the declarative API produces identical output to the imperative API
//! This ensures we can safely migrate to the declarative API

use neuro_integration_tests::DifferentialTestHarness;
use neuro_types::{ViewRectMm, ViewOrientation, VolumeMetadata};
use nifti_loader::load_nifti_volume_auto;
use render_loop::{RenderLoopService, BlendMode};
use render_loop::view_state::{ViewState, ViewId, CameraState, SliceOrientation, LayerConfig};
use std::path::Path;

/// Test that declarative and imperative APIs produce identical output
#[tokio::test]
async fn test_declarative_vs_imperative_api() {
    println!("=== Testing Declarative vs Imperative API ===");
    
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
    
    // Load volume
    println!("Loading MNI brain template...");
    let (volume_sendable, _affine) = load_nifti_volume_auto(&mni_path)
        .expect("Failed to load NIfTI file");
    
    let volume = match volume_sendable {
        bridge_types::VolumeSendable::VolF32(vol, _) => vol,
        _ => panic!("Expected f32 volume from MNI template"),
    };
    
    let data_range = volume.range().unwrap_or((0.0, 100.0));
    println!("Volume data range: [{:.1}, {:.1}]", data_range.0, data_range.1);
    
    // Initialize GPU renderer
    let mut gpu_service = RenderLoopService::new().await
        .expect("Failed to initialize GPU render service");
    
    gpu_service.load_shaders()
        .expect("Failed to load shaders");
    
    gpu_service.enable_world_space_rendering()
        .expect("Failed to enable world space rendering");
    
    // Upload volume to GPU
    let (atlas_idx, _transform) = gpu_service.upload_volume_3d(&volume)
        .expect("Failed to upload volume to GPU");
    
    gpu_service.initialize_colormap()
        .expect("Failed to initialize colormap");
    gpu_service.create_world_space_bind_groups()
        .expect("Failed to create world space bind groups");
    
    // Register volume with logical ID for declarative API
    gpu_service.register_volume("mni_brain".to_string(), atlas_idx)
        .expect("Failed to register volume");
    
    // Create volume metadata for ViewRectMm
    let volume_meta = VolumeMetadata {
        dimensions: [
            volume.space.dims()[0],
            volume.space.dims()[1],
            volume.space.dims()[2],
        ],
        voxel_to_world: volume.space.voxel_to_world(),
    };
    
    // Test configuration
    let crosshair_world = [0.0f32, 0.0, 0.0]; // Brain center
    let viewport_size = [256, 256];
    
    // Create view rectangle for axial slice
    let axial_view = ViewRectMm::full_extent(
        &volume_meta,
        ViewOrientation::Axial,
        crosshair_world,
        viewport_size,
    );
    
    println!("\n--- Testing Axial View ---");
    println!("View dimensions: {}x{}", axial_view.width_px, axial_view.height_px);
    
    // Render using IMPERATIVE API
    println!("\nRendering with imperative API...");
    let imperative_result = render_imperative(
        &mut gpu_service,
        atlas_idx,
        &axial_view,
        data_range,
        crosshair_world,
    ).await;
    
    // Render using DECLARATIVE API
    println!("\nRendering with declarative API...");
    let declarative_result = render_declarative(
        &mut gpu_service,
        "mni_brain",
        &axial_view,
        data_range,
        crosshair_world,
    ).await;
    
    // Compare results
    println!("\nComparing outputs...");
    assert_eq!(imperative_result.len(), declarative_result.len(), 
        "Output sizes differ: imperative={}, declarative={}", 
        imperative_result.len(), declarative_result.len());
    
    // Use differential test harness for detailed comparison
    let harness = DifferentialTestHarness::new();
    let metrics = harness.compute_metrics(&imperative_result, &declarative_result)
        .expect("Failed to compute metrics");
    
    println!("Comparison metrics:");
    println!("  SSIM: {:.4}", metrics.ssim);
    println!("  Dice: {:.4}", metrics.dice_coefficient);
    println!("  RMSE: {:.2}", metrics.rmse);
    println!("  Max difference: {}", metrics.max_absolute_difference);
    
    // Assert outputs are identical (allowing for minimal floating point differences)
    assert!(metrics.ssim > 0.999, "SSIM too low: {}", metrics.ssim);
    assert!(metrics.max_absolute_difference <= 1, "Max difference too high: {}", metrics.max_absolute_difference);
    
    println!("\n✅ Declarative and imperative APIs produce identical output!");
    
    // Test other orientations briefly
    for (orient, name) in [(ViewOrientation::Sagittal, "Sagittal"), (ViewOrientation::Coronal, "Coronal")] {
        println!("\n--- Testing {} View ---", name);
        
        let view = ViewRectMm::full_extent(&volume_meta, orient, crosshair_world, viewport_size);
        
        let imp_result = render_imperative(&mut gpu_service, atlas_idx, &view, data_range, crosshair_world).await;
        let dec_result = render_declarative(&mut gpu_service, "volume_test_brain", &view, data_range, crosshair_world).await;
        
        let metrics = harness.compute_metrics(&imp_result, &dec_result)
            .expect("Failed to compute metrics");
        
        println!("  SSIM: {:.4}", metrics.ssim);
        assert!(metrics.ssim > 0.999, "{} SSIM too low: {}", name, metrics.ssim);
    }
    
    println!("\n✅ All orientations produce identical output with both APIs!");
}

/// Render using the imperative API (current approach)
async fn render_imperative(
    service: &mut RenderLoopService,
    atlas_idx: u32,
    view_rect: &ViewRectMm,
    data_range: (f32, f32),
    crosshair_world: [f32; 3],
) -> Vec<u8> {
    // Resize offscreen target
    service.create_offscreen_target(view_rect.width_px, view_rect.height_px)
        .expect("Failed to create offscreen target");
    
    // Get GPU frame parameters
    let (origin, u_vec, v_vec) = view_rect.to_gpu_frame_params();
    
    // Update frame UBO
    service.update_frame_ubo(origin, u_vec, v_vec);
    
    // Set crosshair
    service.set_crosshair(crosshair_world);
    
    // Clear existing layers
    service.clear_render_layers();
    
    // Add the volume as a layer
    service.add_render_layer(atlas_idx, 1.0, (0.0, 0.0, 1.0, 1.0))
        .expect("Failed to add render layer");
    
    // Set colormap and intensity
    service.set_layer_colormap(0, 0)
        .expect("Failed to set colormap");
    service.update_layer_intensity(0, data_range.0, data_range.1)
        .expect("Failed to update intensity");
    service.update_layer_threshold(0, data_range.0, data_range.1)
        .expect("Failed to update threshold");
    
    // Render to buffer
    service.render_to_buffer()
        .expect("Failed to render to buffer")
}

/// Render using the declarative API (new approach)
async fn render_declarative(
    service: &mut RenderLoopService,
    volume_id: &str,
    view_rect: &ViewRectMm,
    data_range: (f32, f32),
    crosshair_world: [f32; 3],
) -> Vec<u8> {
    // Determine orientation from view rect by checking which axis is normal to the plane
    // The normal is perpendicular to both u_mm and v_mm vectors
    let orientation = if view_rect.u_mm[0] != 0.0 && view_rect.v_mm[1] != 0.0 {
        // X-right, Y-down -> Z normal -> Axial view
        SliceOrientation::Axial
    } else if view_rect.u_mm[0] != 0.0 && view_rect.v_mm[2] != 0.0 {
        // X-right, Z-down -> Y normal -> Coronal view
        SliceOrientation::Coronal
    } else if view_rect.u_mm[1] != 0.0 && view_rect.v_mm[2] != 0.0 {
        // Y-right, Z-down -> X normal -> Sagittal view
        SliceOrientation::Sagittal
    } else {
        panic!("Unable to determine orientation from view rect: u_mm={:?}, v_mm={:?}", 
               view_rect.u_mm, view_rect.v_mm)
    };
    
    // For now, we'll use the imperative API inside request_frame by setting up the state
    // The proper way would be to extend ViewState to support non-square views and exact frame params
    
    // First resize the offscreen target
    service.create_offscreen_target(view_rect.width_px, view_rect.height_px)
        .expect("Failed to create offscreen target");
    
    // Get GPU frame parameters from ViewRectMm
    let (origin, u_vec, v_vec) = view_rect.to_gpu_frame_params();
    
    // Update frame UBO directly
    service.update_frame_ubo(origin, u_vec, v_vec);
    
    // Set crosshair
    service.set_crosshair(crosshair_world);
    
    // Clear existing layers
    service.clear_render_layers();
    
    // Build ViewState - this will add layers via the declarative API
    let view_state = ViewState {
        layout_version: ViewState::CURRENT_VERSION,
        camera: CameraState {
            world_center: crosshair_world,
            fov_mm: view_rect.width_px as f32, // This won't be used since we set frame UBO directly
            orientation,
            frame_origin: None,
            frame_u_vec: None,
            frame_v_vec: None,
        },
        crosshair_world,
        layers: vec![LayerConfig {
            volume_id: volume_id.to_string(),
            opacity: 1.0,
            colormap_id: 0,
            blend_mode: BlendMode::Normal,
            intensity_window: data_range,
            threshold: None,
            visible: true,
        }],
        viewport_size: [view_rect.width_px, view_rect.height_px],
        show_crosshair: true,
    };
    
    // Use set_view_state to configure layers
    service.set_view_state(&view_state)
        .expect("Failed to set view state");
    
    // Render to buffer
    service.render_to_buffer()
        .expect("Failed to render to buffer")
}