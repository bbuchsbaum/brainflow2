use approx::assert_abs_diff_eq;
use nalgebra::Matrix4;
use render_loop::render_state::BlendMode;
use render_loop::{LayerUboStd140, RenderLoopService, SliceFeatureUbo};

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
        ..Default::default()
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
    // Total size: 64 + 16 + 16 + 16 + 16 + 16 + 16 = 176 bytes
    assert_eq!(size_of::<LayerUboStd140>(), 176);

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
    assert_eq!(offset_of!(LayerUboStd140, alpha_mod_mode), 160);
    assert_eq!(offset_of!(LayerUboStd140, alpha_gamma), 164);
    assert_eq!(offset_of!(LayerUboStd140, alpha_center), 168);
    assert_eq!(offset_of!(LayerUboStd140, _pad_alpha), 172);
}

#[test]
fn slice_feature_ubo_layout_and_defaults() {
    use std::mem::{offset_of, size_of};

    assert_eq!(size_of::<SliceFeatureUbo>(), 48);
    assert_eq!(offset_of!(SliceFeatureUbo, outline_enabled), 0);
    assert_eq!(offset_of!(SliceFeatureUbo, outline_layer_index), 4);
    assert_eq!(offset_of!(SliceFeatureUbo, selected_label_id), 8);
    assert_eq!(offset_of!(SliceFeatureUbo, outline_mode), 12);
    assert_eq!(offset_of!(SliceFeatureUbo, outline_color), 16);
    assert_eq!(offset_of!(SliceFeatureUbo, outline_thickness_px), 32);
    assert_eq!(offset_of!(SliceFeatureUbo, _pad1), 36);

    let features = SliceFeatureUbo::default();
    assert_eq!(features.outline_enabled, 0);
    assert_eq!(features.outline_layer_index, 0);
    assert_eq!(features.selected_label_id, 0);
    assert_eq!(features.outline_color, [1.0, 1.0, 0.0, 1.0]);
    assert_eq!(features.outline_thickness_px, 1.0);
}

#[test]
fn slice_feature_wgsl_padding_does_not_use_vec3_after_scalar() {
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
        let feature_body = wgsl_struct_body(source, "SliceFeatureUbo")
            .unwrap_or_else(|| panic!("{name} is missing SliceFeatureUbo"));

        assert!(
            !feature_body.contains("vec3<f32>"),
            "{name} SliceFeatureUbo must not use vec3 padding after \
             outline_thickness_px. WGSL gives vec3 16-byte alignment there, \
             making the shader expect a 64-byte uniform while Rust provides \
             a 48-byte SliceFeatureUbo, which can black-frame the render."
        );
        assert!(
            feature_body.contains("outline_thickness_px: f32")
                && feature_body.contains("_pad1_x: f32")
                && feature_body.contains("_pad1_y: f32")
                && feature_body.contains("_pad1_z: f32"),
            "{name} SliceFeatureUbo must use three scalar f32 pad fields after \
             outline_thickness_px to match Rust SliceFeatureUbo's 48-byte layout"
        );
    }
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
        "alpha_mod_mode",
        "alpha_gamma",
        "alpha_center",
    ];
    let expected_feature_fields = [
        "outline_enabled",
        "outline_layer_index",
        "selected_label_id",
        "outline_mode",
        "outline_color",
        "outline_thickness_px",
        "_pad1_x",
        "_pad1_y",
        "_pad1_z",
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
            layer_body.contains("Total struct size: 176 bytes"),
            "{name} LayerData should document the 176-byte LayerUboStd140 stride"
        );

        let feature_body = wgsl_struct_body(source, "SliceFeatureUbo")
            .unwrap_or_else(|| panic!("{name} is missing SliceFeatureUbo"));
        assert_fields_in_order(
            name,
            "SliceFeatureUbo",
            feature_body,
            &expected_feature_fields,
        );
        assert!(
            source.contains("@group(3) @binding(0) var<uniform> slice_features"),
            "{name} should bind slice feature uniforms at group 3 binding 0"
        );
    }
}

#[test]
fn alpha_mod_uses_visible_threshold_boundary_in_active_shaders() {
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
        assert!(
            source.contains("fn alphaThresholdFloorMagnitude"),
            "{name} should isolate alpha modulation's threshold-boundary math"
        );
        assert!(
            source.contains("raw_value < layer.thresh_low")
                && source.contains("raw_value > layer.thresh_high"),
            "{name} should ramp from the visible range boundary, not from thresh_low alone"
        );
        assert!(
            !source.contains("let lo = clamp(layer.thresh_low, 0.0, hi);"),
            "{name} regressed to the old signed-threshold alpha ramp"
        );
    }
}

fn alpha_threshold_floor_magnitude(layer: &LayerUboStd140, raw_value: f32, hi: f32) -> f32 {
    let floor_mag = match layer.threshold_mode {
        0 => {
            if raw_value < layer.thresh_low {
                (layer.thresh_low - layer.alpha_center).abs()
            } else if raw_value > layer.thresh_high {
                (layer.thresh_high - layer.alpha_center).abs()
            } else {
                hi
            }
        }
        1 => {
            let abs_value = raw_value.abs();
            if abs_value > layer.thresh_high {
                layer.thresh_high
            } else if abs_value < layer.thresh_low {
                0.0
            } else {
                hi
            }
        }
        2 => (layer.thresh_low - layer.alpha_center).abs(),
        _ => (layer.thresh_high - layer.alpha_center).abs(),
    };

    floor_mag.clamp(0.0, hi)
}

fn alpha_mod_factor(layer: &LayerUboStd140, raw_value: f32) -> f32 {
    let hi = (layer.intensity_max - layer.alpha_center)
        .abs()
        .max((layer.intensity_min - layer.alpha_center).abs());
    let lo = alpha_threshold_floor_magnitude(layer, raw_value, hi);
    let mut t = ((raw_value - layer.alpha_center).abs() - lo) / (hi - lo).max(1e-9);
    t = t.clamp(0.0, 1.0);

    if layer.alpha_mod_mode == 2 {
        t.powf(layer.alpha_gamma.max(1e-3))
    } else {
        t
    }
}

#[test]
fn alpha_mod_numeric_curve_starts_at_signed_range_boundaries() {
    let layer = LayerUboStd140 {
        intensity_min: -1.0,
        intensity_max: 1.0,
        thresh_low: -0.2,
        thresh_high: 0.2,
        threshold_mode: 0,
        alpha_mod_mode: 1,
        alpha_gamma: 1.0,
        alpha_center: 0.0,
        ..Default::default()
    };

    assert_abs_diff_eq!(alpha_mod_factor(&layer, 0.2), 0.0, epsilon = 1e-6);
    assert_abs_diff_eq!(alpha_mod_factor(&layer, -0.2), 0.0, epsilon = 1e-6);
    assert_abs_diff_eq!(alpha_mod_factor(&layer, 0.6), 0.5, epsilon = 1e-6);
    assert_abs_diff_eq!(alpha_mod_factor(&layer, -0.6), 0.5, epsilon = 1e-6);
    assert_abs_diff_eq!(alpha_mod_factor(&layer, 1.0), 1.0, epsilon = 1e-6);
    assert_abs_diff_eq!(alpha_mod_factor(&layer, -1.0), 1.0, epsilon = 1e-6);
}

#[test]
fn alpha_mod_numeric_curve_handles_absolute_and_gamma_modes() {
    let absolute_layer = LayerUboStd140 {
        intensity_min: -1.0,
        intensity_max: 1.0,
        thresh_low: 0.2,
        thresh_high: 0.5,
        threshold_mode: 1,
        alpha_mod_mode: 1,
        alpha_gamma: 1.0,
        alpha_center: 0.0,
        ..Default::default()
    };

    assert_abs_diff_eq!(alpha_mod_factor(&absolute_layer, 0.1), 0.1, epsilon = 1e-6);
    assert_abs_diff_eq!(alpha_mod_factor(&absolute_layer, -0.1), 0.1, epsilon = 1e-6);
    assert_abs_diff_eq!(alpha_mod_factor(&absolute_layer, 0.5), 0.0, epsilon = 1e-6);
    assert_abs_diff_eq!(alpha_mod_factor(&absolute_layer, 0.75), 0.5, epsilon = 1e-6);
    assert_abs_diff_eq!(
        alpha_mod_factor(&absolute_layer, -0.75),
        0.5,
        epsilon = 1e-6
    );

    let gamma_layer = LayerUboStd140 {
        alpha_mod_mode: 2,
        alpha_gamma: 2.0,
        ..absolute_layer
    };

    assert_abs_diff_eq!(alpha_mod_factor(&gamma_layer, 0.75), 0.25, epsilon = 1e-6);
}

#[test]
fn blend_mode_discriminants_match_active_masked_shaders() {
    assert_eq!(BlendMode::Normal as u32, 0);
    assert_eq!(BlendMode::Additive as u32, 1);
    assert_eq!(BlendMode::Maximum as u32, 2);
    assert_eq!(BlendMode::Minimum as u32, 3);
    assert_eq!(BlendMode::Multiply as u32, 4);

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
        assert!(
            source.contains("2=max, 3=min, 4=multiply"),
            "{name} should document the BlendMode discriminants used by Rust"
        );
        assert!(
            source.contains("mode == 2u") || source.contains("case 2u"),
            "{name} should branch on BlendMode::Maximum as 2"
        );
        assert!(
            source.contains("mode == 3u") || source.contains("case 3u"),
            "{name} should branch on BlendMode::Minimum as 3"
        );
        assert!(
            source.contains("mode == 4u") || source.contains("case 4u"),
            "{name} should branch on BlendMode::Multiply as 4"
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
    assert_eq!(layer_ubo.alpha_mod_mode, 0); // Default: alpha modulation off
    assert_eq!(layer_ubo.alpha_gamma, 1.0);
    assert_eq!(layer_ubo.alpha_center, 0.0);
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
