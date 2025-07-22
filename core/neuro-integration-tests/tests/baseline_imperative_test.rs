//! Baseline test using imperative API to establish expected outputs
//! This will be compared against the declarative API implementation

use nifti_loader::load_nifti_volume_auto;
use render_loop::{RenderLoopService, BlendMode};
use std::path::Path;
use std::fs;

/// Baseline test for single volume rendering with imperative API
#[tokio::test]
async fn test_baseline_single_volume_imperative() {
    println!("=== Baseline Test: Single Volume Imperative API ===");
    
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
    
    // Test configuration
    let crosshair_world = [0.0f32, 0.0, 0.0]; // Brain center
    let viewport_size = [256, 256];
    
    // Create output directory for baseline images
    let output_dir = workspace_root.join("core/neuro-integration-tests/test_output/baseline_imperative");
    fs::create_dir_all(&output_dir).expect("Failed to create output directory");
    
    // Test all three orientations
    for (orientation, name) in [
        ("axial", "axial"), 
        ("coronal", "coronal"), 
        ("sagittal", "sagittal")
    ] {
        println!("\n--- Testing {} View ---", name);
        
        // Resize offscreen target
        gpu_service.create_offscreen_target(viewport_size[0], viewport_size[1])
            .expect("Failed to create offscreen target");
        
        // Set frame parameters based on orientation
        let (origin, u_vec, v_vec) = match orientation {
            "axial" => {
                ([crosshair_world[0] - 100.0, crosshair_world[1] - 100.0, crosshair_world[2], 1.0],
                 [200.0, 0.0, 0.0, 0.0],
                 [0.0, 200.0, 0.0, 0.0])
            },
            "coronal" => {
                ([crosshair_world[0] - 100.0, crosshair_world[1], crosshair_world[2] - 100.0, 1.0],
                 [200.0, 0.0, 0.0, 0.0],
                 [0.0, 0.0, 200.0, 0.0])
            },
            "sagittal" => {
                ([crosshair_world[0], crosshair_world[1] + 100.0, crosshair_world[2] - 100.0, 1.0],
                 [0.0, -200.0, 0.0, 0.0],
                 [0.0, 0.0, 200.0, 0.0])
            },
            _ => panic!("Unknown orientation"),
        };
        
        // Update frame UBO
        gpu_service.update_frame_ubo(origin, u_vec, v_vec);
        
        // Set crosshair
        gpu_service.set_crosshair(crosshair_world);
        
        // Clear existing layers
        gpu_service.clear_render_layers();
        
        // Add the volume as a layer
        gpu_service.add_render_layer(atlas_idx, 1.0, (0.0, 0.0, 1.0, 1.0))
            .expect("Failed to add render layer");
        
        // Set colormap and intensity
        gpu_service.set_layer_colormap(0, 0)
            .expect("Failed to set colormap");
        gpu_service.update_layer_intensity(0, data_range.0, data_range.1)
            .expect("Failed to update intensity");
        gpu_service.update_layer_threshold(0, data_range.0, data_range.1)
            .expect("Failed to update threshold");
        
        // Render to buffer
        let image_data = gpu_service.render_to_buffer()
            .expect("Failed to render to buffer");
        
        // Save baseline image
        let output_path = output_dir.join(format!("baseline_{}_imperative.png", name));
        let img = image::RgbaImage::from_raw(
            viewport_size[0], 
            viewport_size[1], 
            image_data.clone()
        ).expect("Failed to create image");
        
        img.save(&output_path).expect("Failed to save image");
        println!("Saved baseline image to: {:?}", output_path);
        
        // Also save raw data for exact comparison
        let raw_path = output_dir.join(format!("baseline_{}_imperative.raw", name));
        fs::write(&raw_path, &image_data).expect("Failed to save raw data");
    }
    
    println!("\n✅ Baseline imperative API test completed!");
}

/// Baseline test for multi-layer rendering with imperative API
#[tokio::test]
async fn test_baseline_multi_layer_imperative() {
    println!("=== Baseline Test: Multi-Layer Imperative API ===");
    
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
    
    // Initialize GPU renderer
    let mut gpu_service = RenderLoopService::new().await
        .expect("Failed to initialize GPU render service");
    
    gpu_service.load_shaders()
        .expect("Failed to load shaders");
    
    gpu_service.enable_world_space_rendering()
        .expect("Failed to enable world space rendering");
    
    // Upload volume twice (simulating two different volumes)
    let (atlas_idx1, _) = gpu_service.upload_volume_3d(&volume)
        .expect("Failed to upload volume 1");
    let (atlas_idx2, _) = gpu_service.upload_volume_3d(&volume)
        .expect("Failed to upload volume 2");
    
    gpu_service.initialize_colormap()
        .expect("Failed to initialize colormap");
    gpu_service.create_world_space_bind_groups()
        .expect("Failed to create world space bind groups");
    
    // Test configuration
    let crosshair_world = [0.0f32, 0.0, 0.0];
    let viewport_size = [256, 256];
    
    // Create output directory
    let output_dir = workspace_root.join("core/neuro-integration-tests/test_output/baseline_imperative");
    fs::create_dir_all(&output_dir).expect("Failed to create output directory");
    
    println!("\n--- Testing Multi-Layer Axial View ---");
    
    // Resize offscreen target
    gpu_service.create_offscreen_target(viewport_size[0], viewport_size[1])
        .expect("Failed to create offscreen target");
    
    // Set frame parameters for axial view
    let origin = [crosshair_world[0] - 100.0, crosshair_world[1] - 100.0, crosshair_world[2], 1.0];
    let u_vec = [200.0, 0.0, 0.0, 0.0];
    let v_vec = [0.0, 200.0, 0.0, 0.0];
    
    gpu_service.update_frame_ubo(origin, u_vec, v_vec);
    gpu_service.set_crosshair(crosshair_world);
    
    // Clear and add layers
    gpu_service.clear_render_layers();
    
    // Layer 1: Base layer
    gpu_service.add_render_layer(atlas_idx1, 0.7, (0.0, 0.0, 1.0, 1.0))
        .expect("Failed to add layer 1");
    gpu_service.set_layer_colormap(0, 0)
        .expect("Failed to set colormap");
    gpu_service.update_layer_intensity(0, data_range.0, data_range.1)
        .expect("Failed to update intensity");
    
    // Layer 2: Overlay with different colormap
    gpu_service.add_render_layer(atlas_idx2, 0.3, (0.0, 0.0, 1.0, 1.0))
        .expect("Failed to add layer 2");
    gpu_service.set_layer_colormap(1, 2)  // Use hot colormap
        .expect("Failed to set colormap");
    gpu_service.update_layer_intensity(1, data_range.0 * 0.5, data_range.1 * 0.8)
        .expect("Failed to update intensity");
    
    // Render
    let image_data = gpu_service.render_to_buffer()
        .expect("Failed to render to buffer");
    
    // Save baseline
    let output_path = output_dir.join("baseline_multi_layer_imperative.png");
    let img = image::RgbaImage::from_raw(viewport_size[0], viewport_size[1], image_data.clone())
        .expect("Failed to create image");
    img.save(&output_path).expect("Failed to save image");
    println!("Saved multi-layer baseline to: {:?}", output_path);
    
    let raw_path = output_dir.join("baseline_multi_layer_imperative.raw");
    fs::write(&raw_path, &image_data).expect("Failed to save raw data");
    
    println!("\n✅ Multi-layer baseline test completed!");
}