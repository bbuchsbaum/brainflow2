//! Alpha blending and visual parameter application
//!
//! Handles conversion from scalar values to RGBA colors and
//! provides premultiplied alpha blending operations.

use neuro_types::{BlendMode, LayerVisual};

/// Apply visual parameters to a scalar value, returning RGBA premultiplied
pub fn apply_visual(value: f32, visual: &LayerVisual) -> [u8; 4] {
    // Apply threshold
    let visible = value >= visual.threshold_range.0 && value <= visual.threshold_range.1;

    if !visible {
        return [0, 0, 0, 0];
    }

    // Apply intensity window
    let (min, max) = visual.get_display_range();
    let normalized = if max > min {
        ((value - min) / (max - min)).clamp(0.0, 1.0)
    } else {
        0.5
    };

    // Apply colormap (for now, just grayscale)
    let gray = (normalized * 255.0) as u8;
    let alpha = (visual.opacity * 255.0) as u8;

    // Convert to premultiplied alpha
    let premul_gray = ((gray as f32 * visual.opacity) as u8).min(alpha);

    [premul_gray, premul_gray, premul_gray, alpha]
}

/// Blend source over destination using premultiplied alpha
pub fn blend_premultiplied(dst: [u8; 4], src: [u8; 4], blend_mode: BlendMode) -> [u8; 4] {
    match blend_mode {
        BlendMode::Normal => {
            // Standard over compositing with premultiplied alpha
            // out = src + dst * (1 - src.a)
            let src_alpha = src[3] as f32 / 255.0;
            let one_minus_src_alpha = 1.0 - src_alpha;

            [
                (src[0] as f32 + dst[0] as f32 * one_minus_src_alpha).min(255.0) as u8,
                (src[1] as f32 + dst[1] as f32 * one_minus_src_alpha).min(255.0) as u8,
                (src[2] as f32 + dst[2] as f32 * one_minus_src_alpha).min(255.0) as u8,
                (src[3] as f32 + dst[3] as f32 * one_minus_src_alpha).min(255.0) as u8,
            ]
        }
        BlendMode::Multiply => {
            // Multiply blend mode (darkening)
            let src_alpha = src[3] as f32 / 255.0;
            let dst_alpha = dst[3] as f32 / 255.0;

            // Unpremultiply for blend calculation
            let src_color = if src_alpha > 0.0 {
                [
                    src[0] as f32 / src_alpha,
                    src[1] as f32 / src_alpha,
                    src[2] as f32 / src_alpha,
                ]
            } else {
                [0.0, 0.0, 0.0]
            };

            let dst_color = if dst_alpha > 0.0 {
                [
                    dst[0] as f32 / dst_alpha,
                    dst[1] as f32 / dst_alpha,
                    dst[2] as f32 / dst_alpha,
                ]
            } else {
                [0.0, 0.0, 0.0]
            };

            // Multiply blend
            let blended = [
                src_color[0] * dst_color[0] / 255.0,
                src_color[1] * dst_color[1] / 255.0,
                src_color[2] * dst_color[2] / 255.0,
            ];

            // Composite with standard over
            let out_alpha = src_alpha + dst_alpha * (1.0 - src_alpha);

            // Premultiply result
            [
                (blended[0] * out_alpha).min(255.0) as u8,
                (blended[1] * out_alpha).min(255.0) as u8,
                (blended[2] * out_alpha).min(255.0) as u8,
                (out_alpha * 255.0) as u8,
            ]
        }
        BlendMode::Additive => {
            // Additive blending
            [
                (src[0] as u16 + dst[0] as u16).min(255) as u8,
                (src[1] as u16 + dst[1] as u16).min(255) as u8,
                (src[2] as u16 + dst[2] as u16).min(255) as u8,
                (src[3] as u16 + dst[3] as u16).min(255) as u8,
            ]
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_apply_visual_basic() {
        let visual = LayerVisual {
            opacity: 1.0,
            colormap_id: 0,
            intensity_range: (0.0, 1.0),
            display_range: None,
            threshold_range: (f32::NEG_INFINITY, f32::INFINITY),
            blend_mode: BlendMode::Normal,
            premultiplied: true,
            is_mask: false,
        };

        // Test middle gray
        let rgba = apply_visual(0.5, &visual);
        assert_eq!(rgba, [127, 127, 127, 255]);

        // Test with opacity
        let mut visual_half = visual.clone();
        visual_half.opacity = 0.5;
        let rgba = apply_visual(1.0, &visual_half);
        assert_eq!(rgba, [127, 127, 127, 127]); // Premultiplied
    }

    #[test]
    fn test_threshold() {
        let visual = LayerVisual {
            opacity: 1.0,
            colormap_id: 0,
            intensity_range: (0.0, 1.0),
            display_range: None,
            threshold_range: (0.3, 0.7),
            blend_mode: BlendMode::Normal,
            premultiplied: true,
            is_mask: false,
        };

        // Below threshold
        assert_eq!(apply_visual(0.2, &visual), [0, 0, 0, 0]);

        // Within threshold
        assert_eq!(apply_visual(0.5, &visual), [127, 127, 127, 255]);

        // Above threshold
        assert_eq!(apply_visual(0.8, &visual), [0, 0, 0, 0]);
    }

    #[test]
    fn test_blend_normal() {
        // Test basic over compositing
        let dst = [50, 50, 50, 100]; // Gray with partial alpha
        let src = [200, 200, 200, 128]; // Light gray with 50% alpha

        let result = blend_premultiplied(dst, src, BlendMode::Normal);

        // src + dst * (1 - src.a)
        // src.a = 128/255 ≈ 0.502
        // Expected ≈ [200 + 50 * 0.498, ..., 128 + 100 * 0.498]
        assert!(result[0] >= 200 && result[0] <= 230);
        assert!(result[3] >= 170 && result[3] <= 180);
    }

    #[test]
    fn test_blend_add() {
        let dst = [100, 100, 100, 200];
        let src = [100, 100, 100, 100];

        let result = blend_premultiplied(dst, src, BlendMode::Additive);
        assert_eq!(result, [200, 200, 200, 255]); // Clamped to 255
    }

    #[test]
    fn test_full_pipeline() {
        // Test full visual application and blending
        let visual1 = LayerVisual {
            opacity: 0.5,
            colormap_id: 0,
            intensity_range: (0.0, 1.0),
            display_range: None,
            threshold_range: (f32::NEG_INFINITY, f32::INFINITY),
            blend_mode: BlendMode::Normal,
            premultiplied: true,
            is_mask: false,
        };

        let visual2 = LayerVisual {
            opacity: 0.5,
            colormap_id: 0,
            intensity_range: (0.0, 1.0),
            display_range: None,
            threshold_range: (f32::NEG_INFINITY, f32::INFINITY),
            blend_mode: BlendMode::Normal,
            premultiplied: true,
            is_mask: false,
        };

        // First layer
        let rgba1 = apply_visual(0.5, &visual1);

        // Second layer
        let rgba2 = apply_visual(0.8, &visual2);

        // Composite
        let final_color = blend_premultiplied(rgba1, rgba2, BlendMode::Normal);

        // Both layers at 50% opacity should combine to more opaque
        assert!(final_color[3] > 127);
    }
}
