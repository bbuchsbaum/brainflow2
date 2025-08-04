//! Test volume registration helper methods

use nifti_loader::load_nifti_volume_auto;
use render_loop::RenderLoopService;
use std::path::Path;
use wgpu;

/// Test the register_volume_with_upload helper method
#[tokio::test]
async fn test_register_volume_with_upload() {
    println!("=== Testing Volume Registration Helper ===");

    // Path to test data
    let workspace_root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap() // core/
        .parent()
        .unwrap(); // brainflow2/

    let mni_path =
        workspace_root.join("test-data/unit/tpl-MNI152NLin2009cAsym_res-01_desc-brain_T1w.nii");

    if !mni_path.exists() {
        eprintln!("MNI file not found at {:?}", mni_path);
        eprintln!("Skipping test - MNI template file required");
        return;
    }

    // Load volume
    println!("Loading MNI brain template...");
    let (volume_sendable, _affine) =
        load_nifti_volume_auto(&mni_path).expect("Failed to load NIfTI file");

    let volume = match volume_sendable {
        bridge_types::VolumeSendable::VolF32(vol, _) => vol,
        _ => panic!("Expected f32 volume from MNI template"),
    };

    let data_range = volume.range().unwrap_or((0.0, 100.0));
    println!(
        "Volume data range: [{:.1}, {:.1}]",
        data_range.0, data_range.1
    );

    // Initialize GPU renderer
    let mut gpu_service = RenderLoopService::new()
        .await
        .expect("Failed to initialize GPU render service");

    gpu_service.load_shaders().expect("Failed to load shaders");

    gpu_service
        .enable_world_space_rendering()
        .expect("Failed to enable world space rendering");

    // Initialize colormap
    gpu_service
        .initialize_colormap()
        .expect("Failed to initialize colormap");
    gpu_service
        .create_world_space_bind_groups()
        .expect("Failed to create world space bind groups");

    println!("\n--- Testing register_volume_with_upload ---");

    // Use the helper method to upload and register in one step
    gpu_service
        .register_volume_with_upload(
            "mni_brain_auto".to_string(),
            &volume,
            wgpu::TextureFormat::R32Float,
        )
        .expect("Failed to register volume with upload");

    println!("✅ Volume registered successfully with ID: mni_brain_auto");

    // Verify we can use it with ViewState
    use render_loop::view_state::{CameraState, LayerConfig, SliceOrientation, ViewState};
    use render_loop::BlendMode;

    let view_state = ViewState {
        layout_version: ViewState::CURRENT_VERSION,
        camera: CameraState {
            world_center: [0.0, 0.0, 0.0],
            fov_mm: 200.0,
            orientation: SliceOrientation::Axial,
            frame_origin: None,
            frame_u_vec: None,
            frame_v_vec: None,
        },
        crosshair_world: [0.0, 0.0, 0.0],
        layers: vec![LayerConfig {
            volume_id: "mni_brain_auto".to_string(),
            opacity: 1.0,
            colormap_id: 0,
            blend_mode: BlendMode::Normal,
            intensity_window: data_range,
            threshold: None,
            visible: true,
        }],
        viewport_size: [256, 256],
        show_crosshair: true,
    };

    // This should work without errors
    gpu_service
        .set_view_state(&view_state)
        .expect("Failed to set view state with registered volume");

    println!("✅ Successfully used registered volume in ViewState!");

    // Test registering multiple volumes
    println!("\n--- Testing Multiple Volume Registration ---");

    // Register the same volume with different IDs (simulating multiple volumes)
    gpu_service
        .register_volume_with_upload(
            "brain_t1".to_string(),
            &volume,
            wgpu::TextureFormat::R32Float,
        )
        .expect("Failed to register first volume");

    gpu_service
        .register_volume_with_upload(
            "brain_mask".to_string(),
            &volume,
            wgpu::TextureFormat::R32Float,
        )
        .expect("Failed to register second volume");

    println!("✅ Multiple volumes registered successfully!");

    // Test using multiple registered volumes in layers
    let multi_volume_state = ViewState {
        layout_version: ViewState::CURRENT_VERSION,
        camera: view_state.camera.clone(),
        crosshair_world: view_state.crosshair_world,
        layers: vec![
            LayerConfig {
                volume_id: "brain_t1".to_string(),
                opacity: 0.7,
                colormap_id: 0,
                blend_mode: BlendMode::Normal,
                intensity_window: data_range,
                threshold: None,
                visible: true,
            },
            LayerConfig {
                volume_id: "brain_mask".to_string(),
                opacity: 0.3,
                colormap_id: 2,
                blend_mode: BlendMode::Additive,
                intensity_window: (data_range.0 * 0.5, data_range.1 * 0.8),
                threshold: None,
                visible: true,
            },
        ],
        viewport_size: [256, 256],
        show_crosshair: true,
    };

    gpu_service
        .set_view_state(&multi_volume_state)
        .expect("Failed to set view state with multiple volumes");

    println!("✅ Successfully used multiple registered volumes!");

    println!("\n✅ All volume registration tests passed!");
}

/// Test error handling for invalid volume IDs
#[tokio::test]
async fn test_invalid_volume_id() {
    println!("=== Testing Invalid Volume ID Handling ===");

    // Initialize GPU renderer
    let mut gpu_service = RenderLoopService::new()
        .await
        .expect("Failed to initialize GPU render service");

    gpu_service.load_shaders().expect("Failed to load shaders");

    // Try to use a non-existent volume
    use render_loop::view_state::{CameraState, LayerConfig, SliceOrientation, ViewState};
    use render_loop::BlendMode;

    let view_state = ViewState {
        layout_version: ViewState::CURRENT_VERSION,
        camera: CameraState {
            world_center: [0.0, 0.0, 0.0],
            fov_mm: 200.0,
            orientation: SliceOrientation::Axial,
            frame_origin: None,
            frame_u_vec: None,
            frame_v_vec: None,
        },
        crosshair_world: [0.0, 0.0, 0.0],
        layers: vec![LayerConfig {
            volume_id: "non_existent_volume".to_string(),
            opacity: 1.0,
            colormap_id: 0,
            blend_mode: BlendMode::Normal,
            intensity_window: (0.0, 1.0),
            threshold: None,
            visible: true,
        }],
        viewport_size: [256, 256],
        show_crosshair: true,
    };

    // This should fail with a proper error
    let result = gpu_service.set_view_state(&view_state);
    assert!(result.is_err(), "Expected error for non-existent volume");

    if let Err(e) = result {
        println!("✅ Got expected error: {:?}", e);
        assert!(
            format!("{:?}", e).contains("not registered"),
            "Error should mention volume not registered"
        );
    }

    println!("\n✅ Error handling test passed!");
}
