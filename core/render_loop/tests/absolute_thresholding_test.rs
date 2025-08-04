#[cfg(test)]
mod tests {
    use nalgebra::Matrix4;
    use pollster;
    use render_loop::{
        render_state::{BlendMode, LayerInfo, ThresholdMode},
        RenderLoopService,
    };

    #[test]
    fn test_absolute_value_thresholding_support() {
        // Test that LayerInfo supports absolute value thresholding
        let layer = LayerInfo {
            atlas_index: 0,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            colormap_id: 0,
            intensity_range: (-1.0, 1.0),
            threshold_range: (0.5, 1.0), // Threshold on absolute values
            threshold_mode: ThresholdMode::Absolute,
            texture_coords: (0.0, 0.0, 1.0, 1.0),
            is_mask: false,
        };

        assert_eq!(layer.threshold_mode, ThresholdMode::Absolute);
    }

    #[test]
    fn test_threshold_mode_enum_values() {
        // Test that enum values match what we expect for GPU
        assert_eq!(ThresholdMode::Range as u32, 0);
        assert_eq!(ThresholdMode::Absolute as u32, 1);
    }

    #[test]
    fn test_layer_ubo_includes_threshold_mode() {
        use render_loop::LayerUboStd140;

        let ubo = LayerUboStd140 {
            world_to_voxel: Matrix4::identity().into(),
            texture_coords: [0.0, 0.0, 1.0, 1.0],
            dim: [256, 256, 128],
            pad_slices: 0,
            colormap_id: 0,
            blend_mode: 0,
            texture_index: 0,
            threshold_mode: 1, // Absolute thresholding
            opacity: 1.0,
            intensity_min: -1.0,
            intensity_max: 1.0,
            thresh_low: 0.5,
            thresh_high: 1.0,
            is_mask: 0,
            _pad: [0.0; 2],
        };

        assert_eq!(ubo.threshold_mode, 1);
        assert_eq!(std::mem::size_of::<LayerUboStd140>(), 144);
    }
}
