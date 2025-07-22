//! GPU slice provider adapter
//! 
//! Implements the canonical SliceProvider trait for the GPU render loop,
//! enabling differential testing against CPU implementations.

use neuro_types::{SliceProvider, CompositeRequest, RgbaImage, Result as NeuroResult, SliceSpec, LayerSpec};
use crate::{RenderLoopService, RenderLoopError};
use crate::view_state::{ViewState, CameraState, SliceOrientation, LayerConfig, ThresholdConfig};
use crate::render_state::{BlendMode as GpuBlendMode, ThresholdMode};
use nalgebra::{Matrix4, Vector3};

/// Error conversion from RenderLoop to neuro-types
impl From<RenderLoopError> for neuro_types::Error {
    fn from(err: RenderLoopError) -> Self {
        neuro_types::Error::GpuError(err.to_string())
    }
}

/// Adapter that wraps the GPU RenderLoopService to implement SliceProvider
pub struct GpuSliceAdapter {
    render_service: std::cell::RefCell<RenderLoopService>,
}

impl GpuSliceAdapter {
    /// Create a new GPU slice adapter
    pub fn new(render_service: RenderLoopService) -> Self {
        Self { 
            render_service: std::cell::RefCell::new(render_service)
        }
    }
    
    /// Convert SliceSpec to ViewState for GPU rendering
    fn slice_spec_to_view_state(&self, request: &CompositeRequest) -> NeuroResult<ViewState> {
        let slice = &request.slice;
        
        // Calculate the center of the slice in world coordinates
        let center_x = slice.origin_mm[0] + slice.u_mm[0] * (slice.dim_px[0] as f32 / 2.0) + slice.v_mm[0] * (slice.dim_px[1] as f32 / 2.0);
        let center_y = slice.origin_mm[1] + slice.u_mm[1] * (slice.dim_px[0] as f32 / 2.0) + slice.v_mm[1] * (slice.dim_px[1] as f32 / 2.0);
        let center_z = slice.origin_mm[2] + slice.u_mm[2] * (slice.dim_px[0] as f32 / 2.0) + slice.v_mm[2] * (slice.dim_px[1] as f32 / 2.0);
        
        // Calculate field of view from slice vectors
        let u_length = (slice.u_mm[0].powi(2) + slice.u_mm[1].powi(2) + slice.u_mm[2].powi(2)).sqrt();
        let v_length = (slice.v_mm[0].powi(2) + slice.v_mm[1].powi(2) + slice.v_mm[2].powi(2)).sqrt();
        let fov_mm = (u_length * slice.dim_px[0] as f32).max(v_length * slice.dim_px[1] as f32);
        
        // Determine slice orientation from vectors
        let orientation = self.detect_slice_orientation(&slice.u_mm, &slice.v_mm)?;
        
        // Convert layers
        let gpu_layers = request.layers.iter()
            .map(|layer| self.layer_spec_to_layer_config(layer))
            .collect::<NeuroResult<Vec<_>>>()?;
        
        Ok(ViewState {
            layout_version: 1,
            camera: CameraState {
                world_center: [center_x, center_y, center_z],
                fov_mm,
                orientation,
                frame_origin: None,
                frame_u_vec: None,
                frame_v_vec: None,
            },
            crosshair_world: [center_x, center_y, center_z],
            layers: gpu_layers,
            viewport_size: slice.dim_px,
            show_crosshair: false,
        })
    }
    
    /// Convert LayerSpec to GPU LayerConfig
    fn layer_spec_to_layer_config(&self, layer: &LayerSpec) -> NeuroResult<LayerConfig> {
        Ok(LayerConfig {
            volume_id: format!("volume_{}", layer.volume_id.0), // Convert handle to string ID
            opacity: layer.visual.opacity,
            colormap_id: layer.visual.colormap_id,
            blend_mode: self.convert_blend_mode(layer.visual.blend_mode),
            intensity_window: layer.visual.intensity_range,
            threshold: if layer.visual.threshold_range.0 != f32::NEG_INFINITY || layer.visual.threshold_range.1 != f32::INFINITY {
                Some(ThresholdConfig {
                    mode: ThresholdMode::Range,
                    range: layer.visual.threshold_range,
                })
            } else {
                None
            },
            visible: layer.visual.opacity > 0.0,
        })
    }
    
    /// Convert neuro-types BlendMode to GPU BlendMode
    fn convert_blend_mode(&self, mode: neuro_types::BlendMode) -> GpuBlendMode {
        match mode {
            neuro_types::BlendMode::Normal => GpuBlendMode::Normal,
            neuro_types::BlendMode::Additive => GpuBlendMode::Additive,
            neuro_types::BlendMode::Multiply => GpuBlendMode::Multiply,
        }
    }
    
    /// Detect slice orientation from U and V vectors
    fn detect_slice_orientation(&self, u_mm: &[f32; 3], v_mm: &[f32; 3]) -> NeuroResult<SliceOrientation> {
        // Calculate the normal vector (cross product of U and V)
        let u = Vector3::new(u_mm[0], u_mm[1], u_mm[2]);
        let v = Vector3::new(v_mm[0], v_mm[1], v_mm[2]);
        let normal = u.cross(&v).normalize();
        
        // Determine dominant axis
        let abs_normal = [normal.x.abs(), normal.y.abs(), normal.z.abs()];
        let max_component = abs_normal.iter().enumerate()
            .max_by(|(_, a), (_, b)| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
            .map(|(i, _)| i)
            .unwrap_or(2);
        
        match max_component {
            0 => Ok(SliceOrientation::Sagittal),   // X-dominant normal
            1 => Ok(SliceOrientation::Coronal),    // Y-dominant normal
            2 => Ok(SliceOrientation::Axial),      // Z-dominant normal
            _ => Err(neuro_types::Error::InvalidSliceSpec("Cannot determine slice orientation".into())),
        }
    }
}

impl SliceProvider for GpuSliceAdapter {
    fn composite_rgba(&self, request: &CompositeRequest) -> NeuroResult<RgbaImage> {
        // Use the new composite_rgba method from RenderLoopService
        let rgba_data = self.render_service.borrow_mut().composite_rgba(request)
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
        let center_x = slice.origin_mm[0] + slice.u_mm[0] * (slice.dim_px[0] as f32 / 2.0) + slice.v_mm[0] * (slice.dim_px[1] as f32 / 2.0);
        let center_y = slice.origin_mm[1] + slice.u_mm[1] * (slice.dim_px[0] as f32 / 2.0) + slice.v_mm[1] * (slice.dim_px[1] as f32 / 2.0);
        let center_z = slice.origin_mm[2] + slice.u_mm[2] * (slice.dim_px[0] as f32 / 2.0) + slice.v_mm[2] * (slice.dim_px[1] as f32 / 2.0);
        
        // Calculate FOV
        let u_length = (slice.u_mm[0].powi(2) + slice.u_mm[1].powi(2) + slice.u_mm[2].powi(2)).sqrt();
        let v_length = (slice.v_mm[0].powi(2) + slice.v_mm[1].powi(2) + slice.v_mm[2].powi(2)).sqrt();
        let fov_mm = (u_length * slice.dim_px[0] as f32).max(v_length * slice.dim_px[1] as f32);
        
        // Simple orientation detection (can be enhanced)
        let orientation = if slice.u_mm[0].abs() > 0.5 && slice.v_mm[1].abs() > 0.5 {
            SliceOrientation::Axial
        } else if slice.u_mm[1].abs() > 0.5 && slice.v_mm[2].abs() > 0.5 {
            SliceOrientation::Sagittal
        } else {
            SliceOrientation::Coronal
        };
        
        // Convert layers (simplified - would need proper layer mapping)
        let gpu_layers = request.layers.iter()
            .map(|layer| LayerConfig {
                volume_id: format!("volume_{}", layer.volume_id.0),
                opacity: layer.visual.opacity,
                colormap_id: layer.visual.colormap_id,
                blend_mode: match layer.visual.blend_mode {
                    neuro_types::BlendMode::Normal => GpuBlendMode::Normal,
                    neuro_types::BlendMode::Additive => GpuBlendMode::Additive,
                    neuro_types::BlendMode::Multiply => GpuBlendMode::Multiply,
                },
                intensity_window: layer.visual.intensity_range,
                threshold: None, // Simplified for now
                visible: layer.visual.opacity > 0.0,
            })
            .collect();
        
        Ok(ViewState {
            layout_version: 1,
            camera: CameraState {
                world_center: [center_x, center_y, center_z],
                fov_mm,
                orientation,
                frame_origin: None,
                frame_u_vec: None,
                frame_v_vec: None,
            },
            crosshair_world: [center_x, center_y, center_z],
            layers: gpu_layers,
            viewport_size: slice.dim_px,
            show_crosshair: false,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use neuro_types::{SliceSpec, LayerSpec, LayerVisual, CompositeRequest, VolumeHandle};
    use nalgebra::Matrix4;
    
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
    
    // Note: These tests would require a real RenderLoopService instance
    // which requires GPU setup. For now, we test the static functions.
    
    #[test]
    fn test_static_blend_mode_conversion() {
        // Test the blend mode conversion logic without needing an adapter instance
        let normal_gpu = match neuro_types::BlendMode::Normal {
            neuro_types::BlendMode::Normal => GpuBlendMode::Normal,
            neuro_types::BlendMode::Additive => GpuBlendMode::Additive,
            neuro_types::BlendMode::Multiply => GpuBlendMode::Multiply,
        };
        assert_eq!(normal_gpu, GpuBlendMode::Normal);
    }
}