// Test render state management functionality

use pollster::FutureExt;
use render_loop::{
    render_state::{RenderPassConfig, RenderPassType},
    RenderLoopService,
};

#[test]
fn test_layer_management() {
    // Create the render loop service
    let mut service = RenderLoopService::new()
        .block_on()
        .expect("Failed to create RenderLoopService");

    // Initially no layers
    assert_eq!(service.active_layer_count(), 0);

    // Add a layer
    let layer_idx = service
        .add_render_layer(5, 0.8, (0.0, 0.0, 1.0, 1.0))
        .expect("Failed to add layer");
    assert_eq!(layer_idx, 0);
    assert_eq!(service.active_layer_count(), 1);

    // Add another layer
    let layer_idx2 = service
        .add_render_layer(7, 1.0, (0.0, 0.0, 1.0, 1.0))
        .expect("Failed to add second layer");
    assert_eq!(layer_idx2, 1);
    assert_eq!(service.active_layer_count(), 2);

    // Update layer properties
    service
        .update_layer(0, 0.5, 2)
        .expect("Failed to update layer");

    // Remove first layer
    let removed_atlas_idx = service.remove_render_layer(0);
    assert_eq!(removed_atlas_idx, Some(5));
    assert_eq!(service.active_layer_count(), 1);

    // Clear all layers
    service.clear_render_layers();
    assert_eq!(service.active_layer_count(), 0);

    println!("Layer management test passed!");
}

#[test]
fn test_render_pass_configuration() {
    // Create the render loop service
    let mut service = RenderLoopService::new()
        .block_on()
        .expect("Failed to create RenderLoopService");

    // Configure overlay pass
    let overlay_config = RenderPassConfig {
        clear_color: wgpu::Color {
            r: 0.0,
            g: 0.0,
            b: 0.0,
            a: 0.0,
        },
        clear: false,
        depth_test: false,
        stencil_test: false,
    };

    service.configure_render_pass(RenderPassType::Overlay, overlay_config);

    // Configure debug pass
    let debug_config = RenderPassConfig {
        clear_color: wgpu::Color {
            r: 1.0,
            g: 0.0,
            b: 1.0,
            a: 0.5,
        },
        clear: true,
        depth_test: false,
        stencil_test: false,
    };

    service.configure_render_pass(RenderPassType::Debug, debug_config);

    println!("Render pass configuration test passed!");
}

#[test]
fn test_frame_statistics() {
    // Create the render loop service
    let service = RenderLoopService::new()
        .block_on()
        .expect("Failed to create RenderLoopService");

    // Get initial stats
    let stats = service.get_frame_stats();
    assert_eq!(stats.frame_number, 0);
    assert_eq!(stats.draw_calls, 0);
    assert_eq!(stats.pipeline_switches, 0);
    assert_eq!(stats.bind_group_changes, 0);

    // Note: We can't easily test frame stats updates without actually rendering
    // That would require a surface and full render setup

    println!("Frame statistics test passed!");
}

#[test]
fn test_max_layer_limit() {
    // Create the render loop service
    let mut service = RenderLoopService::new()
        .block_on()
        .expect("Failed to create RenderLoopService");

    // Add maximum number of layers (8)
    for i in 0..8 {
        service
            .add_render_layer(i as u32, 1.0, (0.0, 0.0, 1.0, 1.0))
            .expect(&format!("Failed to add layer {}", i));
    }

    assert_eq!(service.active_layer_count(), 8);

    // Try to add one more - should fail
    let result = service.add_render_layer(9, 1.0, (0.0, 0.0, 1.0, 1.0));
    assert!(result.is_err());
    assert_eq!(service.active_layer_count(), 8);

    println!("Max layer limit test passed!");
}
