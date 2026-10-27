//! GPU slice provider adapter
//!
//! Implements the canonical SliceProvider trait for the GPU render loop,
//! enabling differential testing against CPU implementations.

use crate::render_state::{BlendMode as GpuBlendMode, ThresholdMode};
use crate::view_state::{
    CameraState, InterpolationMode, LayerConfig, SliceOrientation, ThresholdConfig, ViewState,
};
use crate::{RenderLoopError, RenderLoopService};
use neuro_types::{
    CompositeRequest, InterpolationMethod, LayerSpec, Result as NeuroResult, RgbaImage,
    SliceGeometry, SliceProvider,
};

/// Error conversion from RenderLoop to neuro-types
impl From<RenderLoopError> for neuro_types::Error {
    fn from(err: RenderLoopError) -> Self {
        neuro_types::Error::GpuError(err.to_string())
    }
}

/// Adapter that wraps the GPU RenderLoopService to implement SliceProvider
#[allow(dead_code)]
pub struct GpuSliceAdapter {
    render_service: std::cell::RefCell<RenderLoopService>,
}

impl GpuSliceAdapter {
    /// Create a new GPU slice adapter
    pub fn new(render_service: RenderLoopService) -> Self {
        Self {
            render_service: std::cell::RefCell::new(render_service),
        }
    }
}

impl SliceProvider for GpuSliceAdapter {
    fn composite_rgba(&self, request: &CompositeRequest) -> NeuroResult<RgbaImage> {
        // Use the new composite_rgba method from RenderLoopService
        let rgba_data = self
            .render_service
            .borrow_mut()
            .composite_rgba(request)
            .map_err(|e| neuro_types::Error::GpuError(e.to_string()))?;
        Ok(rgba_data)
    }
}

/// Slice specification mapper for converting between coordinate systems
pub struct SliceSpecMapper;

impl SliceSpecMapper {
    /// Convert SliceSpec to ViewState (static version)
    pub fn to_view_state(request: &CompositeRequest) -> NeuroResult<ViewState> {
        // This is a static version of the conversion logic
        // that can be used without a GpuSliceAdapter instance
        let slice = &request.slice;

        // Calculate slice center
        let center_x = slice.origin_mm[0]
            + slice.u_mm[0] * (slice.dim_px[0] as f32 / 2.0)
            + slice.v_mm[0] * (slice.dim_px[1] as f32 / 2.0);
        let center_y = slice.origin_mm[1]
            + slice.u_mm[1] * (slice.dim_px[0] as f32 / 2.0)
            + slice.v_mm[1] * (slice.dim_px[1] as f32 / 2.0);
        let center_z = slice.origin_mm[2]
            + slice.u_mm[2] * (slice.dim_px[0] as f32 / 2.0)
            + slice.v_mm[2] * (slice.dim_px[1] as f32 / 2.0);

        // Calculate FOV
        let u_length =
            (slice.u_mm[0].powi(2) + slice.u_mm[1].powi(2) + slice.u_mm[2].powi(2)).sqrt();
        let v_length =
            (slice.v_mm[0].powi(2) + slice.v_mm[1].powi(2) + slice.v_mm[2].powi(2)).sqrt();
        let fov_mm = (u_length * slice.dim_px[0] as f32).max(v_length * slice.dim_px[1] as f32);

        // Simple orientation detection (can be enhanced)
        let orientation = if slice.u_mm[0].abs() > 0.5 && slice.v_mm[1].abs() > 0.5 {
            SliceOrientation::Axial
        } else if slice.u_mm[1].abs() > 0.5 && slice.v_mm[2].abs() > 0.5 {
            SliceOrientation::Sagittal
        } else {
            SliceOrientation::Coronal
        };

        // Preserve the EXACT slice frame (see slice_spec_to_view_state).
        let (frame_origin, frame_u_vec, frame_v_vec) = exact_frame_params(slice);

        let interpolation = match slice.interp {
            InterpolationMethod::Nearest => InterpolationMode::Nearest,
            InterpolationMethod::Linear => InterpolationMode::Linear,
            InterpolationMethod::Cubic => {
                return Err(neuro_types::Error::InvalidSliceSpec(
                    "GPU slice rendering does not support cubic interpolation".into(),
                ))
            }
        };
        let gpu_layers = request
            .layers
            .iter()
            .map(|layer| map_layer(layer, interpolation))
            .collect::<NeuroResult<Vec<_>>>()?;

        Ok(ViewState {
            layout_version: 1,
            camera: CameraState {
                world_center: [center_x, center_y, center_z],
                fov_mm,
                orientation,
                frame_origin: Some(frame_origin),
                frame_u_vec: Some(frame_u_vec),
                frame_v_vec: Some(frame_v_vec),
            },
            crosshair_world: [center_x, center_y, center_z],
            layers: gpu_layers,
            viewport_size: slice.dim_px,
            show_crosshair: false,
            crosshair_color: [0.0, 1.0, 0.0, 0.8],
            timepoint: None,
        })
    }
}

/// Neuro thresholds retain the inclusive range, while GPU Range hides it.
/// Above, Below, and Inside implement matching inclusive boundaries.
fn map_layer(layer: &LayerSpec, interpolation: InterpolationMode) -> NeuroResult<LayerConfig> {
    let (low, high) = layer.visual.threshold_range;
    if low.is_nan() || high.is_nan() || low > high {
        return Err(neuro_types::Error::InvalidSliceSpec(
            "Invalid layer threshold range".into(),
        ));
    }
    let mode = if high == f32::INFINITY {
        ThresholdMode::Above
    } else if low == f32::NEG_INFINITY {
        ThresholdMode::Below
    } else {
        ThresholdMode::Inside
    };
    Ok(LayerConfig {
        volume_id: format!("volume_{}", layer.volume_id.0),
        opacity: layer.visual.opacity,
        colormap_id: layer.visual.colormap_id,
        blend_mode: match layer.visual.blend_mode {
            neuro_types::BlendMode::Normal => GpuBlendMode::Normal,
            neuro_types::BlendMode::Additive => GpuBlendMode::Additive,
            neuro_types::BlendMode::Multiply => GpuBlendMode::Multiply,
        },
        intensity_window: layer.visual.get_display_range(),
        threshold: Some(ThresholdConfig {
            mode,
            range: (low, high),
        }),
        visible: layer.visual.opacity > 0.0,
        interpolation,
        layer_mode: Default::default(),
        alpha_mod: None,
    })
}

/// Exact GPU frame parameters for a slice, routed through the single
/// [`SliceGeometry::to_gpu_frame_params`] contract: origin (w=1) plus the u/v
/// vectors scaled by the full pixel extent (w=0).
fn exact_frame_params(slice: &neuro_types::SliceSpec) -> ([f32; 4], [f32; 4], [f32; 4]) {
    SliceGeometry {
        origin_mm: slice.origin_mm,
        u_mm: slice.u_mm,
        v_mm: slice.v_mm,
        dim_px: slice.dim_px,
    }
    .to_gpu_frame_params()
}

#[cfg(test)]
mod tests {
    use super::*;
    use nalgebra::Matrix4;
    use neuro_types::{CompositeRequest, LayerSpec, LayerVisual, SliceSpec, VolumeHandle};

    #[test]
    fn test_slice_spec_mapper() {
        let slice = SliceSpec::axial_at([0.0, 0.0, 0.0], [100.0, 100.0], [256, 256]);
        let layer = LayerSpec {
            volume_id: VolumeHandle::new(0),
            world_from_voxel: Matrix4::identity(),
            visual: LayerVisual::default(),
        };
        let request = CompositeRequest::new(slice, vec![layer]);

        let view_state = SliceSpecMapper::to_view_state(&request).unwrap();

        assert_eq!(view_state.viewport_size, [256, 256]);
        assert_eq!(view_state.layers.len(), 1);
        assert!((view_state.camera.fov_mm - 100.0).abs() < 1e-6);
    }

    #[test]
    fn maps_display_threshold_and_interpolation() {
        let mut slice = SliceSpec::axial_at([0.0; 3], [10.0; 2], [10; 2]);
        slice.interp = InterpolationMethod::Nearest;
        let mut visual = LayerVisual::overlay(3, 0.5, 2.5);
        visual.intensity_range = (0.0, 10.0);
        visual.display_range = Some((1.0, 8.0));
        let layer = LayerSpec {
            volume_id: VolumeHandle::new(1),
            world_from_voxel: Matrix4::identity(),
            visual,
        };
        let mut request = CompositeRequest::single_layer(slice, layer);
        let view = SliceSpecMapper::to_view_state(&request).unwrap();
        let config = &view.layers[0];
        assert_eq!(config.intensity_window, (1.0, 8.0));
        assert_eq!(config.interpolation, InterpolationMode::Nearest);
        let threshold = config.threshold.as_ref().unwrap();
        assert_eq!(threshold.mode, ThresholdMode::Above);
        assert_eq!(threshold.range, (2.5, f32::INFINITY));
        assert_eq!(config.blend_mode, GpuBlendMode::Additive);

        request.slice.interp = InterpolationMethod::Linear;
        request.layers[0].visual.display_range = None;
        request.layers[0].visual.threshold_range = (f32::NEG_INFINITY, 4.0);
        let view = SliceSpecMapper::to_view_state(&request).unwrap();
        assert_eq!(view.layers[0].interpolation, InterpolationMode::Linear);
        assert_eq!(view.layers[0].intensity_window, (0.0, 10.0));
        assert_eq!(
            view.layers[0].threshold.as_ref().unwrap().mode,
            ThresholdMode::Below
        );
        request.layers[0].visual.threshold_range = (f32::NEG_INFINITY, f32::INFINITY);
        assert_eq!(
            SliceSpecMapper::to_view_state(&request).unwrap().layers[0]
                .threshold
                .as_ref()
                .unwrap()
                .mode,
            ThresholdMode::Above
        );
    }

    #[test]
    fn rejects_unsupported_or_invalid_requests() {
        let slice = SliceSpec::axial_at([0.0; 3], [10.0; 2], [10; 2]);
        let layer = LayerSpec {
            volume_id: VolumeHandle::new(0),
            world_from_voxel: Matrix4::identity(),
            visual: LayerVisual::default(),
        };
        let mut request = CompositeRequest::single_layer(slice, layer);
        request.layers[0].visual.threshold_range = (1.0, 2.0);
        let view = SliceSpecMapper::to_view_state(&request).unwrap();
        let threshold = view.layers[0].threshold.as_ref().unwrap();
        assert_eq!(threshold.mode, ThresholdMode::Inside);
        assert_eq!(threshold.range, (1.0, 2.0));
        request.layers[0].visual.threshold_range = (f32::NAN, f32::INFINITY);
        assert!(SliceSpecMapper::to_view_state(&request).is_err());
        request.layers[0].visual.threshold_range = (f32::NEG_INFINITY, f32::INFINITY);
        request.slice.interp = InterpolationMethod::Cubic;
        assert!(SliceSpecMapper::to_view_state(&request).is_err());
    }
}
