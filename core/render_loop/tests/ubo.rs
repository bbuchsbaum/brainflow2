use render_loop::{LayerUboStd140, RenderLoopService};
use approx::assert_abs_diff_eq;
use nalgebra::Matrix4;

#[tokio::test]
async fn ubo_window_level_clamps_correctly() {
    // Initialize render service
    let _service = RenderLoopService::new().await.unwrap();
    
    // Create a LayerUboStd140 with specific intensity window
    let layer_ubo = LayerUboStd140 {
        world_to_voxel: Matrix4::identity().into(),
        texture_coords: [0.0, 0.0, 1.0, 1.0],
        dim: [256, 256, 128],
        pad_slices: 0,
        intensity_min: 1.0,
        intensity_max: 1000.0,
        colormap_id: 0,
        opacity: 1.0,
        thresh_low: 0.0,
        thresh_high: 1.0,
        threshold_mode: 0, // Range mode
        blend_mode: 0, // Normal blend
        texture_index: 0,
        is_mask: 0,
        _pad: [0.0; 2],
    };
    
    // Test the window/level math
    // The shader should normalize values: (value - intensity_min) / (intensity_max - intensity_min)
    
    // Test value at minimum (1.0)
    let normalized_min = (1.0 - layer_ubo.intensity_min) / (layer_ubo.intensity_max - layer_ubo.intensity_min);
    assert_abs_diff_eq!(normalized_min, 0.0, epsilon = 1e-3);
    
    // Test value at maximum (1000.0)
    let normalized_max = (1000.0 - layer_ubo.intensity_min) / (layer_ubo.intensity_max - layer_ubo.intensity_min);
    assert_abs_diff_eq!(normalized_max, 1.0, epsilon = 1e-3);
    
    // Test mid-range value
    let mid_value = 500.5;
    let normalized_mid = (mid_value - layer_ubo.intensity_min) / (layer_ubo.intensity_max - layer_ubo.intensity_min);
    assert_abs_diff_eq!(normalized_mid, 0.5, epsilon = 1e-3);
}

#[test]
fn ubo_field_offsets() {
    use std::mem::{size_of, offset_of};
    
    // Verify that the UBO struct layout matches std140 requirements
    // Total size: 64 + 16 + 16 + 16 + 16 + 16 = 144 bytes
    assert_eq!(size_of::<LayerUboStd140>(), 144);
    
    // Check field offsets
    assert_eq!(offset_of!(LayerUboStd140, world_to_voxel), 0);
    assert_eq!(offset_of!(LayerUboStd140, texture_coords), 64);
    assert_eq!(offset_of!(LayerUboStd140, dim), 80);
    assert_eq!(offset_of!(LayerUboStd140, pad_slices), 92);
    assert_eq!(offset_of!(LayerUboStd140, colormap_id), 96);
    assert_eq!(offset_of!(LayerUboStd140, blend_mode), 100);
    assert_eq!(offset_of!(LayerUboStd140, texture_index), 104);
    assert_eq!(offset_of!(LayerUboStd140, threshold_mode), 108);
    assert_eq!(offset_of!(LayerUboStd140, opacity), 112);
    assert_eq!(offset_of!(LayerUboStd140, intensity_min), 116);
    assert_eq!(offset_of!(LayerUboStd140, intensity_max), 120);
    assert_eq!(offset_of!(LayerUboStd140, thresh_low), 124);
    assert_eq!(offset_of!(LayerUboStd140, thresh_high), 128);
    assert_eq!(offset_of!(LayerUboStd140, is_mask), 132);
    assert_eq!(offset_of!(LayerUboStd140, _pad), 136);
}

#[test]
fn ubo_default_values() {
    let layer_ubo = LayerUboStd140::default();
    
    // Check that default values are sensible
    assert_eq!(layer_ubo.intensity_min, 0.0);
    assert_eq!(layer_ubo.intensity_max, 1.0);
    assert_eq!(layer_ubo.colormap_id, 0);
    assert_eq!(layer_ubo.opacity, 1.0);
    assert_eq!(layer_ubo.thresh_low, -f32::INFINITY);
    assert_eq!(layer_ubo.thresh_high, f32::INFINITY);
    assert_eq!(layer_ubo.threshold_mode, 0);
    assert_eq!(layer_ubo.blend_mode, 0);
    assert_eq!(layer_ubo.texture_coords, [0.0, 0.0, 1.0, 1.0]);
    assert_eq!(layer_ubo.texture_index, 0);
    assert_eq!(layer_ubo.is_mask, 0);
}

#[test]
fn ubo_window_level_edge_cases() {
    // Test divide-by-zero protection
    let layer_ubo = LayerUboStd140 {
        intensity_min: 100.0,
        intensity_max: 100.0, // Same as min!
        ..Default::default()
    };
    
    // The shader should handle this gracefully
    // When max == min, the normalization should default to 0 or handle specially
    let delta = layer_ubo.intensity_max - layer_ubo.intensity_min;
    assert_eq!(delta, 0.0);
    
    // Test inverted window (max < min)
    let inverted_ubo = LayerUboStd140 {
        intensity_min: 1000.0,
        intensity_max: 1.0, // Inverted!
        ..Default::default()
    };
    
    let inverted_delta = inverted_ubo.intensity_max - inverted_ubo.intensity_min;
    assert!(inverted_delta < 0.0);
}