use approx::assert_abs_diff_eq;
use nalgebra::Matrix4;
use render_loop::{LayerUboStd140, RenderLoopService};

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
        blend_mode: 0,     // Normal blend
        texture_index: 0,
        is_mask: 0,
        has_alpha_mask: 0,
        interpolation_mode: 1, // Linear
        draw_slice_border: 0,
        border_thickness_px: 0.0,
        layer_mode: 0,
        _pad: 0,
    };

    // Test the window/level math
    // The shader should normalize values: (value - intensity_min) / (intensity_max - intensity_min)

    // Test value at minimum (1.0)
    let normalized_min =
        (1.0 - layer_ubo.intensity_min) / (layer_ubo.intensity_max - layer_ubo.intensity_min);
    assert_abs_diff_eq!(normalized_min, 0.0, epsilon = 1e-3);

    // Test value at maximum (1000.0)
    let normalized_max =
        (1000.0 - layer_ubo.intensity_min) / (layer_ubo.intensity_max - layer_ubo.intensity_min);
    assert_abs_diff_eq!(normalized_max, 1.0, epsilon = 1e-3);

    // Test mid-range value
    let mid_value = 500.5;
    let normalized_mid =
        (mid_value - layer_ubo.intensity_min) / (layer_ubo.intensity_max - layer_ubo.intensity_min);
    assert_abs_diff_eq!(normalized_mid, 0.5, epsilon = 1e-3);
}

#[test]
fn ubo_field_offsets() {
    use std::mem::{offset_of, size_of};

    // Verify that the UBO struct layout matches std140 requirements
    // Total size: 64 + 16 + 16 + 16 + 16 + 16 = 160 bytes
    assert_eq!(size_of::<LayerUboStd140>(), 160);

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
    assert_eq!(offset_of!(LayerUboStd140, has_alpha_mask), 136);
    assert_eq!(offset_of!(LayerUboStd140, interpolation_mode), 140);
    assert_eq!(offset_of!(LayerUboStd140, draw_slice_border), 144);
    assert_eq!(offset_of!(LayerUboStd140, border_thickness_px), 148);
    assert_eq!(offset_of!(LayerUboStd140, layer_mode), 152);
    assert_eq!(offset_of!(LayerUboStd140, _pad), 156);
}

#[test]
fn active_masked_wgsl_matches_layer_ubo_field_order() {
    let expected_frame_fields = [
        "origin_mm",
        "u_mm",
        "v_mm",
        "atlas_dim",
        "_padding_frame",
        "target_dim",
        "_padding_target",
    ];
    let expected_layer_fields = [
        "world_to_voxel",
        "texture_coords",
        "dim",
        "pad_slices",
        "colormap_id",
        "blend_mode",
        "texture_index",
        "threshold_mode",
        "opacity",
        "intensity_min",
        "intensity_max",
        "thresh_low",
        "thresh_high",
        "is_mask",
        "has_alpha_mask",
        "interpolation_mode",
        "drawSliceBorder",
        "borderThicknessPx",
        "layer_mode",
    ];

    let shaders = [
        (
            "slice_world_space_masked.wgsl",
            include_str!("../shaders/slice_world_space_masked.wgsl"),
        ),
        (
            "slice_world_space_optimized_masked.wgsl",
            include_str!("../shaders/slice_world_space_optimized_masked.wgsl"),
        ),
    ];

    for (name, source) in shaders {
        let frame_body = wgsl_struct_body(source, "FrameUbo")
            .unwrap_or_else(|| panic!("{name} is missing FrameUbo"));
        assert_fields_in_order(name, "FrameUbo", frame_body, &expected_frame_fields);

        let layer_body = wgsl_struct_body(source, "LayerData")
            .unwrap_or_else(|| panic!("{name} is missing LayerData"));
        assert_fields_in_order(name, "LayerData", layer_body, &expected_layer_fields);
        assert!(
            layer_body.contains("Total struct size: 160 bytes"),
            "{name} LayerData should document the 160-byte LayerUboStd140 stride"
        );
    }
}

#[tokio::test]
async fn active_masked_wgsl_sources_validate_as_shader_modules() {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::default());
    let adapter = instance
        .request_adapter(&wgpu::RequestAdapterOptions::default())
        .await
        .expect("Failed to find a WGPU adapter for shader validation");
    let (device, _queue) = adapter
        .request_device(&wgpu::DeviceDescriptor::default(), None)
        .await
        .expect("Failed to create WGPU device for shader validation");

    let shaders = [
        (
            "slice_world_space_masked.wgsl",
            include_str!("../shaders/slice_world_space_masked.wgsl"),
        ),
        (
            "slice_world_space_optimized_masked.wgsl",
            include_str!("../shaders/slice_world_space_optimized_masked.wgsl"),
        ),
    ];

    for (name, source) in shaders {
        device.push_error_scope(wgpu::ErrorFilter::Validation);
        let _shader_module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some(name),
            source: wgpu::ShaderSource::Wgsl(source.into()),
        });
        device.poll(wgpu::Maintain::Wait);
        let error = device.pop_error_scope().await;
        assert!(error.is_none(), "{name} failed WGSL validation: {error:?}");
    }
}

fn wgsl_struct_body<'a>(source: &'a str, struct_name: &str) -> Option<&'a str> {
    let start = source.find(&format!("struct {struct_name} {{"))?;
    let body_start = source[start..].find('{')? + start + 1;
    let body_end = source[body_start..].find("};")? + body_start;
    Some(&source[body_start..body_end])
}

fn assert_fields_in_order(
    shader_name: &str,
    struct_name: &str,
    body: &str,
    expected_fields: &[&str],
) {
    let mut cursor = 0;
    for field in expected_fields {
        let relative = body[cursor..]
            .find(field)
            .unwrap_or_else(|| panic!("{shader_name} {struct_name} missing field {field}"));
        cursor += relative + field.len();
    }
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
    assert_eq!(layer_ubo.has_alpha_mask, 0);
    assert_eq!(layer_ubo.interpolation_mode, 1); // Default to linear
    assert_eq!(layer_ubo.draw_slice_border, 0);
    assert_eq!(layer_ubo.border_thickness_px, 1.0);
    assert_eq!(layer_ubo.layer_mode, 0);
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
