//! Test ViewState helper methods and builder pattern

use render_loop::view_state::{LayerConfig, SliceOrientation, ViewState};
use render_loop::{BlendMode, ThresholdMode};

#[test]
fn test_viewstate_builder_pattern() {
    println!("=== Testing ViewState Builder Pattern ===");

    // Test default_for_volume with builder methods
    let view_state = ViewState::default_for_volume("test_volume".to_string(), [256, 256, 128])
        .with_orientation(SliceOrientation::Coronal)
        .with_fov(150.0)
        .with_viewport(512, 512)
        .with_crosshair(false);

    assert_eq!(view_state.camera.orientation, SliceOrientation::Coronal);
    assert_eq!(view_state.camera.fov_mm, 150.0);
    assert_eq!(view_state.viewport_size, [512, 512]);
    assert!(!view_state.show_crosshair);

    // Validate the view state
    assert!(view_state.validate().is_ok());

    println!("✅ Builder pattern test passed!");
}

#[test]
fn test_viewstate_from_basic_params() {
    println!("=== Testing ViewState from_basic_params ===");

    let view_state = ViewState::from_basic_params(
        "mni_brain".to_string(),
        [10.0, 20.0, 30.0],
        SliceOrientation::Sagittal,
        200.0,
        [256, 256],
        (100.0, 500.0),
    );

    assert_eq!(view_state.camera.world_center, [10.0, 20.0, 30.0]);
    assert_eq!(view_state.crosshair_world, [10.0, 20.0, 30.0]);
    assert_eq!(view_state.camera.orientation, SliceOrientation::Sagittal);
    assert_eq!(view_state.camera.fov_mm, 200.0);
    assert_eq!(view_state.viewport_size, [256, 256]);
    assert_eq!(view_state.layers[0].intensity_window, (100.0, 500.0));

    println!("✅ from_basic_params test passed!");
}

#[test]
fn test_layer_config_builder() {
    println!("=== Testing LayerConfig Builder Pattern ===");

    let layer = LayerConfig::new("volume1".to_string())
        .with_opacity(0.7)
        .with_colormap(2)
        .with_blend_mode(BlendMode::Additive)
        .with_intensity_window(50.0, 300.0)
        .with_threshold(ThresholdMode::Above, 100.0, 300.0)
        .with_visibility(false);

    assert_eq!(layer.volume_id, "volume1");
    assert_eq!(layer.opacity, 0.7);
    assert_eq!(layer.colormap_id, 2);
    assert_eq!(layer.blend_mode, BlendMode::Additive);
    assert_eq!(layer.intensity_window, (50.0, 300.0));
    assert!(layer.threshold.is_some());

    let threshold = layer.threshold.unwrap();
    assert_eq!(threshold.mode, ThresholdMode::Above);
    assert_eq!(threshold.range, (100.0, 300.0));
    assert!(!layer.visible);

    println!("✅ LayerConfig builder test passed!");
}

#[test]
fn test_multi_layer_viewstate() {
    println!("=== Testing Multi-Layer ViewState Construction ===");

    // Create base layer
    let base_layer = LayerConfig::new("anatomical".to_string()).with_intensity_window(0.0, 255.0);

    // Create overlay layer
    let overlay_layer = LayerConfig::new("functional".to_string())
        .with_opacity(0.5)
        .with_colormap(1)
        .with_blend_mode(BlendMode::Additive)
        .with_intensity_window(0.0, 1.0)
        .with_threshold(ThresholdMode::Above, 0.3, 1.0);

    // Create view state with multiple layers
    let view_state = ViewState::default_for_volume("dummy".to_string(), [256, 256, 128])
        .with_layers(vec![base_layer, overlay_layer])
        .with_center([128.0, 128.0, 64.0])
        .with_orientation(SliceOrientation::Axial);

    assert_eq!(view_state.layers.len(), 2);
    assert_eq!(view_state.layers[0].volume_id, "anatomical");
    assert_eq!(view_state.layers[1].volume_id, "functional");
    assert_eq!(view_state.layers[1].opacity, 0.5);

    // Validate multi-layer state
    assert!(view_state.validate().is_ok());

    println!("✅ Multi-layer ViewState test passed!");
}

#[test]
fn test_viewstate_with_layer_method() {
    println!("=== Testing ViewState with_layer Method ===");

    // Start with empty layers
    let mut view_state = ViewState::from_basic_params(
        "unused".to_string(),
        [0.0, 0.0, 0.0],
        SliceOrientation::Axial,
        256.0,
        [512, 512],
        (0.0, 1.0),
    );

    // Clear default layer and add new ones
    view_state.layers.clear();

    // Add layers one by one
    view_state = view_state
        .with_layer(LayerConfig::new("layer1".to_string()))
        .with_layer(LayerConfig::new("layer2".to_string()).with_opacity(0.5))
        .with_layer(LayerConfig::new("layer3".to_string()).with_colormap(2));

    assert_eq!(view_state.layers.len(), 3);
    assert_eq!(view_state.layers[0].volume_id, "layer1");
    assert_eq!(view_state.layers[1].volume_id, "layer2");
    assert_eq!(view_state.layers[1].opacity, 0.5);
    assert_eq!(view_state.layers[2].colormap_id, 2);

    println!("✅ with_layer method test passed!");
}

#[test]
fn test_viewstate_validation() {
    println!("=== Testing ViewState Validation ===");

    // Test invalid viewport size
    let mut view_state =
        ViewState::default_for_volume("test".to_string(), [256, 256, 128]).with_viewport(0, 512);

    let result = view_state.validate();
    assert!(result.is_err());
    assert!(result
        .unwrap_err()
        .contains("Viewport dimensions must be non-zero"));

    // Test invalid layer opacity
    view_state =
        ViewState::default_for_volume("test".to_string(), [256, 256, 128]).with_viewport(512, 512);
    view_state.layers[0].opacity = 1.5; // Invalid: > 1.0

    let result = view_state.validate();
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("opacity must be in range"));

    // Test invalid intensity window
    view_state = ViewState::default_for_volume("test".to_string(), [256, 256, 128]);
    view_state.layers[0].intensity_window = (100.0, 50.0); // Invalid: min > max

    let result = view_state.validate();
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("intensity window invalid"));

    println!("✅ Validation tests passed!");
}

fn main() {
    println!("Running ViewState helper tests...");
    test_viewstate_builder_pattern();
    test_viewstate_from_basic_params();
    test_layer_config_builder();
    test_multi_layer_viewstate();
    test_viewstate_with_layer_method();
    test_viewstate_validation();
    println!("\n✅ All ViewState helper tests passed!");
}
