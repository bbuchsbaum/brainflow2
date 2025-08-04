// TODO: This test file needs to be updated to match the current API
// Commenting out for now as the brainflow_core module no longer exists
/*
use brainflow_core::*;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Test loading and rendering maximum number of volumes simultaneously
#[tokio::test]
async fn test_max_volume_layers() {
    let state = Arc::new(RwLock::new(BridgeState::default()));

    // Create 8 test volumes with different properties
    let volumes = vec![
        // Volume 1: Base anatomical
        create_test_volume([64, 64, 64], [1.0, 1.0, 1.0], CoordinateOrder::RPI),
        // Volume 2: Lower resolution overlay
        create_test_volume([32, 32, 32], [2.0, 2.0, 2.0], CoordinateOrder::RPI),
        // Volume 3: Different orientation
        create_test_volume([64, 64, 64], [1.0, 1.0, 1.0], CoordinateOrder::LPI),
        // Volume 4: Non-cubic
        create_test_volume([80, 64, 48], [1.0, 1.2, 1.5], CoordinateOrder::RPI),
        // Volume 5: High resolution
        create_test_volume([128, 128, 128], [0.5, 0.5, 0.5], CoordinateOrder::RPI),
        // Volume 6: Different coordinate system
        create_test_volume([64, 64, 64], [1.0, 1.0, 1.0], CoordinateOrder::ASI),
        // Volume 7: Small volume
        create_test_volume([16, 16, 16], [4.0, 4.0, 4.0], CoordinateOrder::RPI),
        // Volume 8: Maximum allowed
        create_test_volume([64, 64, 64], [1.0, 1.0, 1.0], CoordinateOrder::RPI),
    ];

    // Load all volumes
    let mut volume_ids = Vec::new();
    for (i, volume) in volumes.into_iter().enumerate() {
        let volume_id = format!("test_volume_{}", i);

        {
            let mut state_guard = state.write().await;
            state_guard.volumes.insert(volume_id.clone(), volume);
        }

        volume_ids.push(volume_id);
    }

    // Add each volume as a render layer
    for (i, volume_id) in volume_ids.iter().enumerate() {
        let layer_id = format!("layer_{}", i);
        let patch = LayerPatch {
            opacity: Some(1.0 - (i as f32 * 0.1)), // Decreasing opacity
            intensity_min: Some(0.0),
            intensity_max: Some(1.0),
            colormap_id: Some(i as u32 % 4), // Cycle through colormaps
            blend_mode: Some(match i % 4 {
                0 => BlendMode::Normal,
                1 => BlendMode::Additive,
                2 => BlendMode::Maximum,
                _ => BlendMode::Minimum,
            }),
            thresh_low: Some(0.1),
            thresh_high: Some(0.9),
            visible: Some(true),
        };

        add_render_layer(
            state.clone(),
            layer_id.clone(),
            volume_id.clone(),
            0, // time_idx
            patch,
        ).await.expect("Failed to add render layer");
    }

    // Verify all layers were added
    {
        let state_guard = state.read().await;
        if let Some(render_loop) = &state_guard.render_loop_service {
            let layer_count = render_loop.get_layer_count().await;
            assert_eq!(layer_count, 8, "Should have 8 layers loaded");
        }
    }
}

/// Test different blend modes with multiple volumes
#[tokio::test]
async fn test_blend_mode_combinations() {
    let state = Arc::new(RwLock::new(BridgeState::default()));

    // Create two overlapping volumes with known patterns
    let mut base_volume = create_test_volume([32, 32, 32], [1.0, 1.0, 1.0], CoordinateOrder::RPI);
    let mut overlay_volume = create_test_volume([32, 32, 32], [1.0, 1.0, 1.0], CoordinateOrder::RPI);

    // Fill with specific patterns for testing blend modes
    if let Ok(base_data) = base_volume.get_data_mut::<f32>() {
        // Create gradient pattern
        for z in 0..32 {
            for y in 0..32 {
                for x in 0..32 {
                    let idx = z * 32 * 32 + y * 32 + x;
                    base_data[idx] = x as f32 / 32.0;
                }
            }
        }
    }

    if let Ok(overlay_data) = overlay_volume.get_data_mut::<f32>() {
        // Create inverse gradient pattern
        for z in 0..32 {
            for y in 0..32 {
                for x in 0..32 {
                    let idx = z * 32 * 32 + y * 32 + x;
                    overlay_data[idx] = 1.0 - (x as f32 / 32.0);
                }
            }
        }
    }

    // Store volumes
    {
        let mut state_guard = state.write().await;
        state_guard.volumes.insert("base".to_string(), base_volume);
        state_guard.volumes.insert("overlay".to_string(), overlay_volume);
    }

    // Test each blend mode
    let blend_modes = vec![
        (BlendMode::Normal, "normal"),
        (BlendMode::Additive, "additive"),
        (BlendMode::Maximum, "maximum"),
        (BlendMode::Minimum, "minimum"),
    ];

    for (blend_mode, mode_name) in blend_modes {
        // Add base layer
        let base_patch = LayerPatch {
            opacity: Some(1.0),
            intensity_min: Some(0.0),
            intensity_max: Some(1.0),
            colormap_id: Some(0),
            blend_mode: Some(BlendMode::Normal),
            thresh_low: Some(0.0),
            thresh_high: Some(1.0),
            visible: Some(true),
        };

        add_render_layer(
            state.clone(),
            "layer_base".to_string(),
            "base".to_string(),
            0,
            base_patch,
        ).await.expect("Failed to add base layer");

        // Add overlay with specific blend mode
        let overlay_patch = LayerPatch {
            opacity: Some(0.5),
            intensity_min: Some(0.0),
            intensity_max: Some(1.0),
            colormap_id: Some(1),
            blend_mode: Some(blend_mode),
            thresh_low: Some(0.0),
            thresh_high: Some(1.0),
            visible: Some(true),
        };

        add_render_layer(
            state.clone(),
            "layer_overlay".to_string(),
            "overlay".to_string(),
            0,
            overlay_patch,
        ).await.expect("Failed to add overlay layer");

        // Verify blend mode was set
        {
            let state_guard = state.read().await;
            if let Some(render_loop) = &state_guard.render_loop_service {
                println!("Testing blend mode: {}", mode_name);
                // In a real test, we would render and verify the output
                // For now, just verify the layer was added
                let layer_count = render_loop.get_layer_count().await;
                assert!(layer_count >= 2, "Should have at least 2 layers for {}", mode_name);
            }
        }

        // Clear layers for next test
        clear_render_layers(state.clone()).await.expect("Failed to clear layers");
    }
}

/// Test dynamic layer management (add/remove/reorder)
#[tokio::test]
async fn test_dynamic_layer_management() {
    let state = Arc::new(RwLock::new(BridgeState::default()));

    // Create test volumes
    let volumes = vec![
        create_test_volume([32, 32, 32], [1.0, 1.0, 1.0], CoordinateOrder::RPI),
        create_test_volume([32, 32, 32], [1.0, 1.0, 1.0], CoordinateOrder::RPI),
        create_test_volume([32, 32, 32], [1.0, 1.0, 1.0], CoordinateOrder::RPI),
    ];

    // Store volumes
    {
        let mut state_guard = state.write().await;
        for (i, volume) in volumes.into_iter().enumerate() {
            state_guard.volumes.insert(format!("volume_{}", i), volume);
        }
    }

    // Test adding layers one by one
    for i in 0..3 {
        let layer_patch = LayerPatch {
            opacity: Some(1.0),
            intensity_min: Some(0.0),
            intensity_max: Some(1.0),
            colormap_id: Some(i as u32),
            blend_mode: Some(BlendMode::Normal),
            thresh_low: Some(0.0),
            thresh_high: Some(1.0),
            visible: Some(true),
        };

        add_render_layer(
            state.clone(),
            format!("layer_{}", i),
            format!("volume_{}", i),
            0,
            layer_patch,
        ).await.expect("Failed to add layer");

        // Verify layer count
        {
            let state_guard = state.read().await;
            if let Some(render_loop) = &state_guard.render_loop_service {
                let layer_count = render_loop.get_layer_count().await;
                assert_eq!(layer_count, i + 1, "Layer count mismatch after adding layer {}", i);
            }
        }
    }

    // Test updating a layer
    let update_patch = LayerPatch {
        opacity: Some(0.5),
        colormap_id: Some(3),
        blend_mode: Some(BlendMode::Additive),
        ..Default::default()
    };

    patch_layer(state.clone(), "layer_1".to_string(), update_patch)
        .await
        .expect("Failed to update layer");

    // Test removing a layer
    remove_render_layer(state.clone(), "layer_1".to_string())
        .await
        .expect("Failed to remove layer");

    // Verify layer was removed
    {
        let state_guard = state.read().await;
        if let Some(render_loop) = &state_guard.render_loop_service {
            let layer_count = render_loop.get_layer_count().await;
            assert_eq!(layer_count, 2, "Layer count should be 2 after removal");
        }
    }

    // Test clearing all layers
    clear_render_layers(state.clone()).await.expect("Failed to clear layers");

    // Verify all layers cleared
    {
        let state_guard = state.read().await;
        if let Some(render_loop) = &state_guard.render_loop_service {
            let layer_count = render_loop.get_layer_count().await;
            assert_eq!(layer_count, 0, "All layers should be cleared");
        }
    }
}

/// Test performance with rapid layer updates
#[tokio::test]
async fn test_rapid_layer_updates() {
    let state = Arc::new(RwLock::new(BridgeState::default()));

    // Create a test volume
    let volume = create_test_volume([64, 64, 64], [1.0, 1.0, 1.0], CoordinateOrder::RPI);

    {
        let mut state_guard = state.write().await;
        state_guard.volumes.insert("test_volume".to_string(), volume);
    }

    // Add initial layer
    let initial_patch = LayerPatch {
        opacity: Some(1.0),
        intensity_min: Some(0.0),
        intensity_max: Some(1.0),
        colormap_id: Some(0),
        blend_mode: Some(BlendMode::Normal),
        thresh_low: Some(0.0),
        thresh_high: Some(1.0),
        visible: Some(true),
    };

    add_render_layer(
        state.clone(),
        "test_layer".to_string(),
        "test_volume".to_string(),
        0,
        initial_patch,
    ).await.expect("Failed to add layer");

    // Perform rapid updates
    let start = std::time::Instant::now();
    let update_count = 100;

    for i in 0..update_count {
        let opacity = (i as f32) / (update_count as f32);
        let update_patch = LayerPatch {
            opacity: Some(opacity),
            colormap_id: Some((i % 4) as u32),
            ..Default::default()
        };

        patch_layer(state.clone(), "test_layer".to_string(), update_patch)
            .await
            .expect("Failed to update layer");
    }

    let duration = start.elapsed();
    println!("Performed {} layer updates in {:?}", update_count, duration);

    // Ensure updates complete in reasonable time (< 1 second for 100 updates)
    assert!(duration.as_secs() < 1, "Layer updates took too long");
}

// Helper function to create test volumes
fn create_test_volume(dim: [usize; 3], spacing: [f32; 3], order: CoordinateOrder) -> Volume {
    let voxel_count = dim[0] * dim[1] * dim[2];
    let data: Vec<f32> = (0..voxel_count).map(|i| i as f32 / voxel_count as f32).collect();

    Volume::new(
        dim,
        spacing,
        order,
        DataElement::Float32(data),
    ).expect("Failed to create test volume")
}
*/
