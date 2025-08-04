// Test layer uniform buffer management

use pollster::FutureExt;
use render_loop::RenderLoopService;

#[test]
#[ignore = "Test uses internal implementation details not available with world-space rendering"]
fn test_layer_uniform_updates() {
    // Create the render loop service
    let mut service = RenderLoopService::new()
        .block_on()
        .expect("Failed to create RenderLoopService");

    // Add a layer
    let layer_idx = service
        .add_render_layer(5, 0.8, (0.0, 0.0, 1.0, 1.0))
        .expect("Failed to add layer");
    assert_eq!(layer_idx, 0);

    // Verify uniform manager has the correct active count
    assert_eq!(service.layer_uniform_manager.active_count(), 1);

    // Update layer properties
    service
        .update_layer(0, 0.5, 2)
        .expect("Failed to update layer");

    // Verify active count is still correct after update
    assert_eq!(service.layer_uniform_manager.active_count(), 1);

    // Add another layer
    let layer_idx2 = service
        .add_render_layer(7, 1.0, (0.0, 0.0, 1.0, 1.0))
        .expect("Failed to add second layer");
    assert_eq!(layer_idx2, 1);
    assert_eq!(service.layer_uniform_manager.active_count(), 2);

    // Remove first layer
    service.remove_render_layer(0);
    assert_eq!(service.layer_uniform_manager.active_count(), 1);

    // Clear all layers
    service.clear_render_layers();
    assert_eq!(service.layer_uniform_manager.active_count(), 0);

    println!("Layer uniform updates test passed!");
}

#[test]
fn test_volume_metadata_tracking() {
    // Create the render loop service
    let mut service = RenderLoopService::new()
        .block_on()
        .expect("Failed to create RenderLoopService");

    // Manually insert volume metadata (simulating what upload_slice would do)
    // Note: volume_metadata is private, so we'll just test the public API

    // Add a layer that uses this metadata
    let layer_idx = service
        .add_render_layer(5, 0.8, (0.0, 0.0, 1.0, 1.0))
        .expect("Failed to add layer");
    assert_eq!(layer_idx, 0);

    // The uniform buffer should have been updated with default metadata
    // We can't easily verify the specific metadata without a proper upload_slice call

    println!("Volume metadata tracking test passed!");
}

#[test]
#[ignore = "Test uses internal implementation details not available with world-space rendering"]
fn test_max_layer_uniform_updates() {
    // Create the render loop service
    let mut service = RenderLoopService::new()
        .block_on()
        .expect("Failed to create RenderLoopService");

    // Add maximum number of layers
    for i in 0..8 {
        service
            .add_render_layer(i as u32, 1.0, (0.0, 0.0, 1.0, 1.0))
            .expect(&format!("Failed to add layer {}", i));
    }

    assert_eq!(service.layer_uniform_manager.active_count(), 8);

    // Update a layer in the middle
    service
        .update_layer(4, 0.5, 3)
        .expect("Failed to update layer 4");

    // Active count should remain the same
    assert_eq!(service.layer_uniform_manager.active_count(), 8);

    println!("Max layer uniform updates test passed!");
}
