// ViewState API - declarative rendering state management

use crate::render_state::{BlendMode, ThresholdMode};
use serde::{Deserialize, Serialize};

/// Interpolation modes for volume sampling
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum InterpolationMode {
    Nearest,
    Linear,
    #[serde(rename = "cubic")]
    Cubic,  // Future support - will fall back to linear for now
}

impl Default for InterpolationMode {
    fn default() -> Self {
        Self::Linear
    }
}

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

    /// Show/hide crosshair hint for UI layer
    /// Note: Crosshairs are rendered as UI overlays, not in the volume data.
    /// This field is preserved for UI components to determine crosshair visibility.
    pub show_crosshair: bool,

    /// Current timepoint for 4D volumes (0-indexed)
    /// Only used when displaying 4D time series data
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timepoint: Option<usize>,
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

    /// Optional exact frame parameters (for non-square FOVs)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frame_origin: Option<[f32; 4]>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub frame_u_vec: Option<[f32; 4]>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub frame_v_vec: Option<[f32; 4]>,
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

    /// Interpolation mode for sampling
    #[serde(default)]
    pub interpolation: InterpolationMode,
}

/// Threshold configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThresholdConfig {
    pub mode: ThresholdMode,
    pub range: (f32, f32),
}

impl LayerConfig {
    /// Create a new layer with default settings
    pub fn new(volume_id: String) -> Self {
        Self {
            volume_id,
            opacity: 1.0,
            colormap_id: 0,
            blend_mode: BlendMode::Normal,
            intensity_window: (0.0, 1.0),
            threshold: None,
            visible: true,
            interpolation: InterpolationMode::default(),
        }
    }

    /// Builder-style method to set opacity
    pub fn with_opacity(mut self, opacity: f32) -> Self {
        self.opacity = opacity;
        self
    }

    /// Builder-style method to set colormap
    pub fn with_colormap(mut self, colormap_id: u32) -> Self {
        self.colormap_id = colormap_id;
        self
    }

    /// Builder-style method to set blend mode
    pub fn with_blend_mode(mut self, blend_mode: BlendMode) -> Self {
        self.blend_mode = blend_mode;
        self
    }

    /// Builder-style method to set intensity window
    pub fn with_intensity_window(mut self, min: f32, max: f32) -> Self {
        self.intensity_window = (min, max);
        self
    }

    /// Builder-style method to set threshold
    pub fn with_threshold(mut self, mode: ThresholdMode, min: f32, max: f32) -> Self {
        self.threshold = Some(ThresholdConfig {
            mode,
            range: (min, max),
        });
        self
    }

    /// Builder-style method to set visibility
    pub fn with_visibility(mut self, visible: bool) -> Self {
        self.visible = visible;
        self
    }

    /// Builder-style method to set interpolation mode
    pub fn with_interpolation(mut self, interpolation: InterpolationMode) -> Self {
        self.interpolation = interpolation;
        self
    }
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
                frame_origin: None,
                frame_u_vec: None,
                frame_v_vec: None,
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
                interpolation: InterpolationMode::default(),
            }],
            viewport_size: [512, 512],
            show_crosshair: true,
            timepoint: None,
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
                return Err(format!("Layer {} intensity window invalid: min >= max", i));
            }
        }

        Ok(())
    }

    /// Builder-style method to set orientation
    pub fn with_orientation(mut self, orientation: SliceOrientation) -> Self {
        self.camera.orientation = orientation;
        self
    }

    /// Builder-style method to set field of view
    pub fn with_fov(mut self, fov_mm: f32) -> Self {
        self.camera.fov_mm = fov_mm;
        self
    }

    /// Builder-style method to set world center
    pub fn with_center(mut self, center: [f32; 3]) -> Self {
        self.camera.world_center = center;
        self.crosshair_world = center;
        self
    }

    /// Builder-style method to set viewport size
    pub fn with_viewport(mut self, width: u32, height: u32) -> Self {
        self.viewport_size = [width, height];
        self
    }

    /// Builder-style method to add a layer
    pub fn with_layer(mut self, layer: LayerConfig) -> Self {
        self.layers.push(layer);
        self
    }

    /// Builder-style method to replace all layers
    pub fn with_layers(mut self, layers: Vec<LayerConfig>) -> Self {
        self.layers = layers;
        self
    }

    /// Builder-style method to show/hide crosshair
    pub fn with_crosshair(mut self, show: bool) -> Self {
        self.show_crosshair = show;
        self
    }

    /// Create ViewState from basic parameters (convenience method)
    pub fn from_basic_params(
        volume_id: String,
        center: [f32; 3],
        orientation: SliceOrientation,
        fov_mm: f32,
        viewport_size: [u32; 2],
        intensity_window: (f32, f32),
    ) -> Self {
        Self {
            layout_version: Self::CURRENT_VERSION,
            camera: CameraState {
                world_center: center,
                fov_mm,
                orientation,
                frame_origin: None,
                frame_u_vec: None,
                frame_v_vec: None,
            },
            crosshair_world: center,
            layers: vec![LayerConfig {
                volume_id,
                opacity: 1.0,
                colormap_id: 0,
                blend_mode: BlendMode::Normal,
                intensity_window,
                threshold: None,
                visible: true,
                interpolation: InterpolationMode::Linear,
            }],
            viewport_size,
            show_crosshair: true,
            timepoint: None,
        }
    }

    /// Create ViewState from ViewRectMm with exact frame parameters
    pub fn from_view_rect(
        view_rect: &neuro_types::ViewRectMm,
        volume_id: String,
        intensity_window: (f32, f32),
    ) -> Self {

        // Determine orientation from view rect vectors
        let orientation = match (view_rect.u_mm, view_rect.v_mm) {
            ([u, 0.0, 0.0], [0.0, v, 0.0]) if u != 0.0 && v != 0.0 => SliceOrientation::Axial,
            ([u, 0.0, 0.0], [0.0, 0.0, v]) if u != 0.0 && v != 0.0 => SliceOrientation::Coronal,
            ([0.0, u, 0.0], [0.0, 0.0, v]) if u != 0.0 && v != 0.0 => SliceOrientation::Sagittal,
            _ => {
                // More complex detection for non-axis-aligned views
                if view_rect.u_mm[0] != 0.0 && view_rect.v_mm[1] != 0.0 {
                    SliceOrientation::Axial
                } else if view_rect.u_mm[0] != 0.0 && view_rect.v_mm[2] != 0.0 {
                    SliceOrientation::Coronal
                } else if view_rect.u_mm[1] != 0.0 && view_rect.v_mm[2] != 0.0 {
                    SliceOrientation::Sagittal
                } else {
                    SliceOrientation::Axial // Default fallback
                }
            }
        };

        // Get exact frame parameters
        let (origin, u_vec, v_vec) = view_rect.to_gpu_frame_params();

        // Calculate world center from frame parameters
        let world_center = match orientation {
            SliceOrientation::Axial => [
                origin[0] + u_vec[0] / 2.0,
                origin[1] + v_vec[1] / 2.0,
                origin[2],
            ],
            SliceOrientation::Coronal => [
                origin[0] + u_vec[0] / 2.0,
                origin[1],
                origin[2] + v_vec[2] / 2.0,
            ],
            SliceOrientation::Sagittal => [
                origin[0],
                origin[1] - u_vec[1] / 2.0, // Note: sagittal often has negative u
                origin[2] + v_vec[2] / 2.0,
            ],
        };

        // Calculate FOV as the maximum extent
        let fov_mm = u_vec[0]
            .abs()
            .max(u_vec[1].abs())
            .max(v_vec[1].abs())
            .max(v_vec[2].abs());

        Self {
            layout_version: Self::CURRENT_VERSION,
            camera: CameraState {
                world_center,
                fov_mm,
                orientation,
                // Store exact frame parameters
                frame_origin: Some(origin),
                frame_u_vec: Some(u_vec),
                frame_v_vec: Some(v_vec),
            },
            crosshair_world: view_rect.origin_mm,
            layers: vec![LayerConfig {
                volume_id,
                opacity: 1.0,
                colormap_id: 0,
                blend_mode: BlendMode::Normal,
                intensity_window,
                threshold: None,
                visible: true,
                interpolation: InterpolationMode::Linear,
            }],
            viewport_size: [view_rect.width_px, view_rect.height_px],
            show_crosshair: true,
            timepoint: None,
        }
    }

    /// Convert camera state to frame UBO parameters
    pub fn camera_to_frame_params(&self) -> ([f32; 4], [f32; 4], [f32; 4]) {
        // If we have exact frame parameters stored, use them
        if let (Some(origin), Some(u_vec), Some(v_vec)) = (
            self.camera.frame_origin,
            self.camera.frame_u_vec,
            self.camera.frame_v_vec,
        ) {
            return (origin, u_vec, v_vec);
        }

        // Otherwise fall back to FOV-based calculation
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
            }
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
            }
            SliceOrientation::Sagittal => {
                // Looking down X axis, Y->right, Z->up
                // Apply neurological convention: anterior on left (negative Y)
                let origin = [
                    self.camera.world_center[0],
                    self.camera.world_center[1] + half_fov, // Flip origin to match negated Y
                    self.camera.world_center[2] - half_fov,
                    1.0,
                ];
                let u_vec = [0.0, -self.camera.fov_mm, 0.0, 0.0]; // Negate Y for neurological convention
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
                frame_origin: None,
                frame_u_vec: None,
                frame_v_vec: None,
            },
            crosshair_world: [100.0, 100.0, 50.0],
            layers: vec![],
            viewport_size: [512, 512],
            show_crosshair: true,
            timepoint: None,
        };

        let (origin, u, v) = state.camera_to_frame_params();

        // For axial view centered at (100,100,50) with 200mm FOV
        assert_eq!(origin, [0.0, 0.0, 50.0, 1.0]);
        assert_eq!(u, [200.0, 0.0, 0.0, 0.0]);
        assert_eq!(v, [0.0, 200.0, 0.0, 0.0]);
    }
}
