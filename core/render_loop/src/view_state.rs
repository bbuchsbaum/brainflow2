// ViewState API - declarative rendering state management

use serde::{Serialize, Deserialize};
use crate::render_state::{BlendMode, ThresholdMode};

/// Unique identifier for a view
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ViewId(pub String);

impl ViewId {
    pub fn new(id: impl Into<String>) -> Self {
        ViewId(id.into())
    }
}

/// Complete state for rendering a view
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ViewState {
    /// Version for forward compatibility and validation
    pub layout_version: u32,
    
    /// Camera state in world coordinates
    pub camera: CameraState,
    
    /// Crosshair position in world space
    pub crosshair_world: [f32; 3],
    
    /// Stack of layers to render
    pub layers: Vec<LayerConfig>,
    
    /// Viewport dimensions
    pub viewport_size: [u32; 2],
    
    /// Show/hide crosshair
    pub show_crosshair: bool,
}

/// Camera configuration in world space
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CameraState {
    /// Point we're looking at in world coordinates
    pub world_center: [f32; 3],
    
    /// Field of view in mm
    pub fov_mm: f32,
    
    /// Which anatomical plane we're viewing
    pub orientation: SliceOrientation,
}

/// Anatomical viewing planes
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SliceOrientation {
    /// Axial/Transverse - looking down Z axis
    Axial,
    /// Coronal - looking down Y axis  
    Coronal,
    /// Sagittal - looking down X axis
    Sagittal,
}

/// Configuration for a single layer
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayerConfig {
    /// Reference to the volume data
    pub volume_id: String,
    
    /// Layer opacity [0.0 - 1.0]
    pub opacity: f32,
    
    /// Colormap index
    pub colormap_id: u32,
    
    /// How to blend with layers below
    pub blend_mode: BlendMode,
    
    /// Intensity window (min, max)
    pub intensity_window: (f32, f32),
    
    /// Optional threshold range
    pub threshold: Option<ThresholdConfig>,
    
    /// Layer visibility
    pub visible: bool,
}

/// Threshold configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThresholdConfig {
    pub mode: ThresholdMode,
    pub range: (f32, f32),
}

/// Result of a frame render request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrameResult {
    /// Rendered image as base64-encoded PNG or raw RGBA
    pub image_data: Vec<u8>,
    
    /// Actual dimensions of rendered image
    pub dimensions: [u32; 2],
    
    /// Time taken to render in milliseconds
    pub render_time_ms: f32,
    
    /// Any warnings or non-fatal errors
    pub warnings: Vec<String>,
    
    /// Layers that were actually rendered
    pub rendered_layers: Vec<String>,
    
    /// Whether CPU fallback was used
    pub used_cpu_fallback: bool,
}

impl ViewState {
    /// Current version of the ViewState layout
    pub const CURRENT_VERSION: u32 = 1;
    
    /// Create a default ViewState for a volume
    pub fn default_for_volume(volume_id: String, volume_dims: [usize; 3]) -> Self {
        // Calculate reasonable center
        let center = [
            volume_dims[0] as f32 * 0.5,
            volume_dims[1] as f32 * 0.5,
            volume_dims[2] as f32 * 0.5,
        ];
        
        Self {
            layout_version: Self::CURRENT_VERSION,
            camera: CameraState {
                world_center: center,
                fov_mm: 256.0,
                orientation: SliceOrientation::Axial,
            },
            crosshair_world: center,
            layers: vec![LayerConfig {
                volume_id,
                opacity: 1.0,
                colormap_id: 0,
                blend_mode: BlendMode::Normal,
                intensity_window: (0.0, 1.0),
                threshold: None,
                visible: true,
            }],
            viewport_size: [512, 512],
            show_crosshair: true,
        }
    }
    
    /// Validate that the ViewState is well-formed
    pub fn validate(&self) -> Result<(), String> {
        if self.layout_version != Self::CURRENT_VERSION {
            return Err(format!(
                "Unsupported ViewState version {}. Expected {}",
                self.layout_version,
                Self::CURRENT_VERSION
            ));
        }
        
        if self.viewport_size[0] == 0 || self.viewport_size[1] == 0 {
            return Err("Viewport dimensions must be non-zero".to_string());
        }
        
        if self.layers.is_empty() {
            return Err("At least one layer must be specified".to_string());
        }
        
        for (i, layer) in self.layers.iter().enumerate() {
            if layer.opacity < 0.0 || layer.opacity > 1.0 {
                return Err(format!("Layer {} opacity must be in range [0,1]", i));
            }
            
            if layer.intensity_window.0 >= layer.intensity_window.1 {
                return Err(format!(
                    "Layer {} intensity window invalid: min >= max", i
                ));
            }
        }
        
        Ok(())
    }
    
    /// Convert camera state to frame UBO parameters
    pub fn camera_to_frame_params(&self) -> ([f32; 4], [f32; 4], [f32; 4]) {
        let half_fov = self.camera.fov_mm * 0.5;
        
        match self.camera.orientation {
            SliceOrientation::Axial => {
                // Looking down Z axis, X->right, Y->up
                let origin = [
                    self.camera.world_center[0] - half_fov,
                    self.camera.world_center[1] - half_fov,
                    self.camera.world_center[2],
                    1.0,
                ];
                let u_vec = [self.camera.fov_mm, 0.0, 0.0, 0.0];
                let v_vec = [0.0, self.camera.fov_mm, 0.0, 0.0];
                (origin, u_vec, v_vec)
            },
            SliceOrientation::Coronal => {
                // Looking down Y axis, X->right, Z->up
                let origin = [
                    self.camera.world_center[0] - half_fov,
                    self.camera.world_center[1],
                    self.camera.world_center[2] - half_fov,
                    1.0,
                ];
                let u_vec = [self.camera.fov_mm, 0.0, 0.0, 0.0];
                let v_vec = [0.0, 0.0, self.camera.fov_mm, 0.0];
                (origin, u_vec, v_vec)
            },
            SliceOrientation::Sagittal => {
                // Looking down X axis, Y->right, Z->up
                let origin = [
                    self.camera.world_center[0],
                    self.camera.world_center[1] - half_fov,
                    self.camera.world_center[2] - half_fov,
                    1.0,
                ];
                let u_vec = [0.0, self.camera.fov_mm, 0.0, 0.0];
                let v_vec = [0.0, 0.0, self.camera.fov_mm, 0.0];
                (origin, u_vec, v_vec)
            }
        }
    }
}

/// Context for a specific view - owns render resources
pub struct ViewContext {
    pub id: ViewId,
    pub last_state: Option<ViewState>,
    pub render_texture: wgpu::Texture,
    pub render_target: wgpu::TextureView,
    pub dimensions: [u32; 2],
}

impl ViewContext {
    /// Check if render target needs resizing
    pub fn needs_resize(&self, new_size: [u32; 2]) -> bool {
        self.dimensions != new_size
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_viewstate_validation() {
        let mut state = ViewState::default_for_volume("test-vol".to_string(), [256, 256, 128]);
        
        // Valid state should pass
        assert!(state.validate().is_ok());
        
        // Invalid version
        state.layout_version = 999;
        assert!(state.validate().is_err());
        state.layout_version = ViewState::CURRENT_VERSION;
        
        // Zero viewport
        state.viewport_size = [0, 512];
        assert!(state.validate().is_err());
        state.viewport_size = [512, 512];
        
        // No layers
        state.layers.clear();
        assert!(state.validate().is_err());
    }
    
    #[test]
    fn test_camera_to_frame_params() {
        let state = ViewState {
            layout_version: ViewState::CURRENT_VERSION,
            camera: CameraState {
                world_center: [100.0, 100.0, 50.0],
                fov_mm: 200.0,
                orientation: SliceOrientation::Axial,
            },
            crosshair_world: [100.0, 100.0, 50.0],
            layers: vec![],
            viewport_size: [512, 512],
            show_crosshair: true,
        };
        
        let (origin, u, v) = state.camera_to_frame_params();
        
        // For axial view centered at (100,100,50) with 200mm FOV
        assert_eq!(origin, [0.0, 0.0, 50.0, 1.0]);
        assert_eq!(u, [200.0, 0.0, 0.0, 0.0]);
        assert_eq!(v, [0.0, 200.0, 0.0, 0.0]);
    }
}