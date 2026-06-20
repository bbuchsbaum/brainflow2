use serde::{Deserialize, Serialize};
use ts_rs::TS;

fn default_crosshair_color() -> [f32; 4] {
    [0.0, 1.0, 0.0, 0.8]
}

/// How a layer is blended with the layers below it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
pub enum BlendMode {
    /// Normal alpha blending.
    Normal = 0,
    /// Additive blending.
    Additive = 1,
    /// Maximum intensity.
    Maximum = 2,
    /// Minimum intensity.
    Minimum = 3,
    /// Multiplicative blending.
    Multiply = 4,
}

/// Threshold interpretation for a layer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
pub enum ThresholdMode {
    /// Range thresholding.
    Range = 0,
    /// Absolute value thresholding.
    Absolute = 1,
    /// Above threshold only.
    Above = 2,
    /// Below threshold only.
    Below = 3,
}

/// Shader-side layer semantics.
#[repr(u32)]
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum LayerMode {
    /// Continuous scalar intensity layer.
    #[default]
    Scalar = 0,
    /// Categorical integer label layer.
    Label = 1,
    /// Binary or alpha mask layer.
    Mask = 2,
}

/// Interpolation modes for volume sampling.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, TS)]
#[serde(rename_all = "lowercase")]
pub enum InterpolationMode {
    Nearest,
    Linear,
    #[serde(rename = "cubic")]
    Cubic,
}

impl Default for InterpolationMode {
    fn default() -> Self {
        Self::Linear
    }
}

/// Unique identifier for a view.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
pub struct ViewId(pub String);

impl ViewId {
    pub fn new(id: impl Into<String>) -> Self {
        ViewId(id.into())
    }
}

/// Complete state for rendering a view.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ViewState {
    /// Version for forward compatibility and validation.
    pub layout_version: u32,

    /// Camera state in world coordinates.
    pub camera: CameraState,

    /// Crosshair position in world space.
    pub crosshair_world: [f32; 3],

    /// Stack of layers to render.
    pub layers: Vec<LayerConfig>,

    /// Viewport dimensions.
    pub viewport_size: [u32; 2],

    /// Show/hide crosshair hint for UI layer.
    pub show_crosshair: bool,

    /// RGBA color for the crosshair [r, g, b, a] in 0.0-1.0 range.
    #[serde(default = "default_crosshair_color")]
    pub crosshair_color: [f32; 4],

    /// Current timepoint for 4D volumes (0-indexed).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timepoint: Option<usize>,
}

/// Camera configuration in world space.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct CameraState {
    /// Point we are looking at in world coordinates.
    pub world_center: [f32; 3],

    /// Field of view in mm.
    pub fov_mm: f32,

    /// Anatomical plane being viewed.
    pub orientation: SliceOrientation,

    /// Optional exact frame parameters for non-square FOVs.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frame_origin: Option<[f32; 4]>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub frame_u_vec: Option<[f32; 4]>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub frame_v_vec: Option<[f32; 4]>,
}

/// Anatomical viewing planes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
pub enum SliceOrientation {
    /// Axial/transverse - looking down Z axis.
    Axial,
    /// Coronal - looking down Y axis.
    Coronal,
    /// Sagittal - looking down X axis.
    Sagittal,
}

/// Shape of the intensity-modulated alpha ("transparent thresholding") ramp.
#[repr(u32)]
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum AlphaModMode {
    /// No modulation: opacity is the flat per-layer value (current behavior).
    #[default]
    Off = 0,
    /// Opacity rises linearly with normalized magnitude.
    Linear = 1,
    /// Opacity rises with magnitude raised to `gamma`.
    Gamma = 2,
}

/// Intensity-modulated alpha configuration for a layer.
///
/// When `mode != Off`, overlay opacity becomes a monotonic function of the
/// two-sided magnitude `|value - center|`, ramped from the threshold up to the
/// top of the visible intensity window. Weak supra-threshold voxels fade into
/// the background; strong voxels are opaque.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
pub struct AlphaModConfig {
    pub mode: AlphaModMode,
    /// Gamma exponent for the ramp (used when `mode == Gamma`).
    pub gamma: f32,
    /// Center for the two-sided magnitude (0.0 for signed/diverging maps).
    pub center: f32,
}

impl Default for AlphaModConfig {
    fn default() -> Self {
        Self {
            mode: AlphaModMode::Off,
            gamma: 1.0,
            center: 0.0,
        }
    }
}

/// Configuration for a single layer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct LayerConfig {
    /// Reference to the volume data.
    pub volume_id: String,

    /// Layer opacity [0.0 - 1.0].
    pub opacity: f32,

    /// Colormap index.
    pub colormap_id: u32,

    /// How to blend with layers below.
    pub blend_mode: BlendMode,

    /// Intensity window (min, max).
    pub intensity_window: (f32, f32),

    /// Optional threshold range.
    pub threshold: Option<ThresholdConfig>,

    /// Layer visibility.
    pub visible: bool,

    /// Interpolation mode for sampling.
    #[serde(default)]
    pub interpolation: InterpolationMode,

    /// Rendering mode for shader-side layer semantics.
    #[serde(default)]
    pub layer_mode: LayerMode,

    /// Optional intensity-modulated alpha ("transparent thresholding").
    /// `None` (or `mode == Off`) renders identically to a flat-opacity layer.
    #[serde(default)]
    pub alpha_mod: Option<AlphaModConfig>,
}

/// Threshold configuration.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ThresholdConfig {
    pub mode: ThresholdMode,
    pub range: (f32, f32),
}

impl LayerConfig {
    /// Create a new layer with default settings.
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
            layer_mode: LayerMode::default(),
            alpha_mod: None,
        }
    }

    pub fn with_alpha_mod(mut self, alpha_mod: AlphaModConfig) -> Self {
        self.alpha_mod = Some(alpha_mod);
        self
    }

    pub fn with_opacity(mut self, opacity: f32) -> Self {
        self.opacity = opacity;
        self
    }

    pub fn with_colormap(mut self, colormap_id: u32) -> Self {
        self.colormap_id = colormap_id;
        self
    }

    pub fn with_blend_mode(mut self, blend_mode: BlendMode) -> Self {
        self.blend_mode = blend_mode;
        self
    }

    pub fn with_intensity_window(mut self, min: f32, max: f32) -> Self {
        self.intensity_window = (min, max);
        self
    }

    pub fn with_threshold(mut self, mode: ThresholdMode, min: f32, max: f32) -> Self {
        self.threshold = Some(ThresholdConfig {
            mode,
            range: (min, max),
        });
        self
    }

    pub fn with_visibility(mut self, visible: bool) -> Self {
        self.visible = visible;
        self
    }

    pub fn with_interpolation(mut self, interpolation: InterpolationMode) -> Self {
        self.interpolation = interpolation;
        self
    }

    pub fn with_layer_mode(mut self, layer_mode: LayerMode) -> Self {
        self.layer_mode = layer_mode;
        self
    }
}

/// How a frame request should handle GPU readback.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum FrameReadbackMode {
    Blocking,
    Skip,
}

impl Default for FrameReadbackMode {
    fn default() -> Self {
        Self::Blocking
    }
}

/// Options controlling how request_frame completes after GPU submission.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, TS)]
pub struct FrameRequestOptions {
    #[serde(default)]
    pub readback_mode: FrameReadbackMode,
}

/// Timing breakdown for a single frame request.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct FrameDiagnostics {
    /// CPU-side setup and state preparation before GPU submission.
    pub prepare_ms: f32,

    /// Render pass encoding plus queue submission time.
    pub render_ms: f32,

    /// Texture copy, map, and CPU unpack time.
    pub readback_ms: f32,

    /// Total request_frame wall-clock time.
    pub total_ms: f32,

    /// Number of visible layers prepared for the frame.
    pub visible_layers: u32,

    /// Number of layer slots uploaded to the GPU for this frame.
    #[serde(default)]
    pub updated_layer_slots: u32,

    /// Whether the request reused the previously uploaded layer state package.
    #[serde(default)]
    pub reused_layer_state: bool,

    /// Whether the frame bytes were read back synchronously or skipped.
    #[serde(default)]
    pub readback_mode: FrameReadbackMode,
}

impl Default for FrameDiagnostics {
    fn default() -> Self {
        Self {
            prepare_ms: 0.0,
            render_ms: 0.0,
            readback_ms: 0.0,
            total_ms: 0.0,
            visible_layers: 0,
            updated_layer_slots: 0,
            reused_layer_state: false,
            readback_mode: FrameReadbackMode::Blocking,
        }
    }
}

/// Result of a frame render request.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct FrameResult {
    /// Rendered image as base64-encoded PNG or raw RGBA.
    pub image_data: Vec<u8>,

    /// Actual dimensions of rendered image.
    pub dimensions: [u32; 2],

    /// Time taken to render in milliseconds.
    pub render_time_ms: f32,

    /// Any warnings or non-fatal errors.
    pub warnings: Vec<String>,

    /// Layers that were actually rendered.
    pub rendered_layers: Vec<String>,

    /// Whether CPU fallback was used.
    pub used_cpu_fallback: bool,

    /// Stage timings for the live render path.
    pub diagnostics: FrameDiagnostics,
}

impl ViewState {
    /// Current version of the ViewState layout.
    pub const CURRENT_VERSION: u32 = 1;

    /// Create a default ViewState for a volume.
    pub fn default_for_volume(volume_id: String, volume_dims: [usize; 3]) -> Self {
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
            layers: vec![LayerConfig::new(volume_id)],
            viewport_size: [512, 512],
            show_crosshair: true,
            crosshair_color: default_crosshair_color(),
            timepoint: None,
        }
    }

    /// Validate that the ViewState is well-formed.
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

        for (index, layer) in self.layers.iter().enumerate() {
            if layer.opacity < 0.0 || layer.opacity > 1.0 {
                return Err(format!("Layer {} opacity must be in range [0,1]", index));
            }

            if layer.intensity_window.0 >= layer.intensity_window.1 {
                return Err(format!(
                    "Layer {} intensity window invalid: min >= max",
                    index
                ));
            }
        }

        Ok(())
    }

    pub fn with_orientation(mut self, orientation: SliceOrientation) -> Self {
        self.camera.orientation = orientation;
        self
    }

    pub fn with_fov(mut self, fov_mm: f32) -> Self {
        self.camera.fov_mm = fov_mm;
        self
    }

    pub fn with_center(mut self, center: [f32; 3]) -> Self {
        self.camera.world_center = center;
        self.crosshair_world = center;
        self
    }

    pub fn with_viewport(mut self, width: u32, height: u32) -> Self {
        self.viewport_size = [width, height];
        self
    }

    pub fn with_layer(mut self, layer: LayerConfig) -> Self {
        self.layers.push(layer);
        self
    }

    pub fn with_layers(mut self, layers: Vec<LayerConfig>) -> Self {
        self.layers = layers;
        self
    }

    pub fn with_crosshair(mut self, show: bool) -> Self {
        self.show_crosshair = show;
        self
    }

    /// Create ViewState from basic parameters.
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
            layers: vec![LayerConfig::new(volume_id)
                .with_intensity_window(intensity_window.0, intensity_window.1)],
            viewport_size,
            show_crosshair: true,
            crosshair_color: default_crosshair_color(),
            timepoint: None,
        }
    }

    /// Create ViewState from ViewRectMm with exact frame parameters.
    pub fn from_view_rect(
        view_rect: &neuro_types::ViewRectMm,
        volume_id: String,
        intensity_window: (f32, f32),
    ) -> Self {
        let orientation = match (view_rect.u_mm, view_rect.v_mm) {
            ([u, 0.0, 0.0], [0.0, v, 0.0]) if u != 0.0 && v != 0.0 => SliceOrientation::Axial,
            ([u, 0.0, 0.0], [0.0, 0.0, v]) if u != 0.0 && v != 0.0 => SliceOrientation::Coronal,
            ([0.0, u, 0.0], [0.0, 0.0, v]) if u != 0.0 && v != 0.0 => SliceOrientation::Sagittal,
            _ => {
                if view_rect.u_mm[0] != 0.0 && view_rect.v_mm[1] != 0.0 {
                    SliceOrientation::Axial
                } else if view_rect.u_mm[0] != 0.0 && view_rect.v_mm[2] != 0.0 {
                    SliceOrientation::Coronal
                } else if view_rect.u_mm[1] != 0.0 && view_rect.v_mm[2] != 0.0 {
                    SliceOrientation::Sagittal
                } else {
                    SliceOrientation::Axial
                }
            }
        };

        let (origin, u_vec, v_vec) = view_rect.to_gpu_frame_params();

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
                origin[1] - u_vec[1] / 2.0,
                origin[2] + v_vec[2] / 2.0,
            ],
        };

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
                frame_origin: Some(origin),
                frame_u_vec: Some(u_vec),
                frame_v_vec: Some(v_vec),
            },
            crosshair_world: view_rect.origin_mm,
            layers: vec![LayerConfig::new(volume_id)
                .with_intensity_window(intensity_window.0, intensity_window.1)],
            viewport_size: [view_rect.width_px, view_rect.height_px],
            show_crosshair: true,
            crosshair_color: default_crosshair_color(),
            timepoint: None,
        }
    }

    /// Convert camera state to frame UBO parameters.
    pub fn camera_to_frame_params(&self) -> ([f32; 4], [f32; 4], [f32; 4]) {
        if let (Some(origin), Some(u_vec), Some(v_vec)) = (
            self.camera.frame_origin,
            self.camera.frame_u_vec,
            self.camera.frame_v_vec,
        ) {
            return (origin, u_vec, v_vec);
        }

        let half_fov = self.camera.fov_mm * 0.5;

        match self.camera.orientation {
            SliceOrientation::Axial => {
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
                let origin = [
                    self.camera.world_center[0],
                    self.camera.world_center[1] + half_fov,
                    self.camera.world_center[2] - half_fov,
                    1.0,
                ];
                let u_vec = [0.0, -self.camera.fov_mm, 0.0, 0.0];
                let v_vec = [0.0, 0.0, self.camera.fov_mm, 0.0];
                (origin, u_vec, v_vec)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn view_state_round_trips_through_json() {
        let state = ViewState::from_basic_params(
            "vol-1".to_string(),
            [10.0, 20.0, 30.0],
            SliceOrientation::Coronal,
            180.0,
            [320, 240],
            (-1.0, 2.0),
        )
        .with_crosshair(false);

        let json = serde_json::to_string(&state).unwrap();
        let decoded: ViewState = serde_json::from_str(&json).unwrap();

        assert_eq!(decoded, state);
    }

    #[test]
    fn generated_client_payload_deserializes_to_contract() {
        let payload = serde_json::json!({
            "layout_version": ViewState::CURRENT_VERSION,
            "camera": {
                "world_center": [1.0, 2.0, 3.0],
                "fov_mm": 192.0,
                "orientation": "Axial",
                "frame_origin": [0.0, 0.0, 3.0, 1.0],
                "frame_u_vec": [192.0, 0.0, 0.0, 0.0],
                "frame_v_vec": [0.0, 192.0, 0.0, 0.0]
            },
            "crosshair_world": [1.0, 2.0, 3.0],
            "layers": [{
                "volume_id": "volume-a",
                "opacity": 0.75,
                "colormap_id": 2,
                "blend_mode": "Normal",
                "intensity_window": [0.1, 0.9],
                "threshold": {
                    "mode": "Above",
                    "range": [0.2, 1.0]
                },
                "visible": true,
                "interpolation": "linear",
                "layer_mode": "scalar"
            }],
            "viewport_size": [640, 480],
            "show_crosshair": true,
            "crosshair_color": [0.0, 1.0, 0.0, 0.8],
            "timepoint": 4
        });

        let state: ViewState = serde_json::from_value(payload).unwrap();

        assert_eq!(state.viewport_size, [640, 480]);
        assert_eq!(state.camera.orientation, SliceOrientation::Axial);
        assert_eq!(state.camera.frame_origin, Some([0.0, 0.0, 3.0, 1.0]));
        assert_eq!(state.layers.len(), 1);
        assert_eq!(state.layers[0].blend_mode, BlendMode::Normal);
        assert_eq!(state.layers[0].interpolation, InterpolationMode::Linear);
        assert_eq!(state.layers[0].layer_mode, LayerMode::Scalar);
        assert_eq!(
            state.layers[0].threshold.as_ref().unwrap().mode,
            ThresholdMode::Above
        );
        assert_eq!(state.timepoint, Some(4));
        assert!(state.validate().is_ok());
    }

    #[test]
    fn view_state_validation_rejects_bad_payloads() {
        let mut state = ViewState::default_for_volume("test-vol".to_string(), [64, 64, 32]);
        assert!(state.validate().is_ok());

        state.layout_version = 999;
        assert!(state.validate().is_err());
        state.layout_version = ViewState::CURRENT_VERSION;

        state.viewport_size = [0, 512];
        assert!(state.validate().is_err());
        state.viewport_size = [512, 512];

        state.layers.clear();
        assert!(state.validate().is_err());
    }

    #[test]
    fn camera_to_frame_params_matches_axial_contract() {
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
            layers: vec![LayerConfig::new("vol-1".to_string())],
            viewport_size: [512, 512],
            show_crosshair: true,
            crosshair_color: default_crosshair_color(),
            timepoint: None,
        };

        let (origin, u, v) = state.camera_to_frame_params();

        assert_eq!(origin, [0.0, 0.0, 50.0, 1.0]);
        assert_eq!(u, [200.0, 0.0, 0.0, 0.0]);
        assert_eq!(v, [0.0, 200.0, 0.0, 0.0]);
    }
}
