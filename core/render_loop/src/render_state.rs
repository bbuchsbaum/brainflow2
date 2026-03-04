// Render state management module

use crate::pipeline::PipelineKey;
use std::collections::HashMap;
use wgpu::{BindGroup, Buffer, TextureView};

/// Tracks the current render state to minimize redundant state changes
#[derive(Default)]
pub struct RenderState {
    /// Currently active pipeline
    active_pipeline: Option<PipelineKey>,
    /// Currently bound bind groups by slot
    bound_bind_groups: HashMap<u32, u64>, // slot -> bind group id
    /// Frame counter for statistics
    frame_count: u64,
    /// Draw call counter for current frame
    draw_calls: u32,
    /// Pipeline switches in current frame
    pipeline_switches: u32,
    /// Bind group changes in current frame
    bind_group_changes: u32,
}

impl RenderState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Begin a new frame
    pub fn begin_frame(&mut self) {
        self.frame_count += 1;
        self.draw_calls = 0;
        self.pipeline_switches = 0;
        self.bind_group_changes = 0;
    }

    /// End current frame and return statistics
    pub fn end_frame(&self) -> FrameStats {
        FrameStats {
            frame_number: self.frame_count,
            draw_calls: self.draw_calls,
            pipeline_switches: self.pipeline_switches,
            bind_group_changes: self.bind_group_changes,
        }
    }

    /// Check if pipeline needs to be set
    pub fn should_set_pipeline(&self, key: &PipelineKey) -> bool {
        self.active_pipeline.as_ref() != Some(key)
    }

    /// Record pipeline change
    pub fn set_pipeline(&mut self, key: PipelineKey) {
        if self.active_pipeline.as_ref() != Some(&key) {
            self.pipeline_switches += 1;
            self.active_pipeline = Some(key);
        }
    }

    /// Check if bind group needs to be set
    pub fn should_set_bind_group(&self, slot: u32, bind_group_id: u64) -> bool {
        self.bound_bind_groups.get(&slot) != Some(&bind_group_id)
    }

    /// Record bind group change
    pub fn set_bind_group(&mut self, slot: u32, bind_group_id: u64) {
        if self.bound_bind_groups.get(&slot) != Some(&bind_group_id) {
            self.bind_group_changes += 1;
            self.bound_bind_groups.insert(slot, bind_group_id);
        }
    }

    /// Record a draw call
    pub fn record_draw(&mut self) {
        self.draw_calls += 1;
    }

    /// Clear all cached state (e.g., after render pass change)
    pub fn clear_state(&mut self) {
        self.active_pipeline = None;
        self.bound_bind_groups.clear();
    }

    /// Get current frame statistics
    pub fn current_stats(&self) -> FrameStats {
        FrameStats {
            frame_number: self.frame_count,
            draw_calls: self.draw_calls,
            pipeline_switches: self.pipeline_switches,
            bind_group_changes: self.bind_group_changes,
        }
    }
}

/// Frame rendering statistics
#[derive(Debug, Clone, Copy)]
pub struct FrameStats {
    pub frame_number: u64,
    pub draw_calls: u32,
    pub pipeline_switches: u32,
    pub bind_group_changes: u32,
}

/// Manages render resources for a frame
pub struct FrameResources {
    /// Global bind group for frame uniforms
    pub global_bind_group: BindGroup,
    /// Layer bind group for layer data
    pub layer_bind_group: Option<BindGroup>,
    /// Texture bind group for atlas textures
    pub texture_bind_group: Option<BindGroup>,
    /// Current render target view
    pub target_view: TextureView,
}

/// Manages render passes and their configuration
pub struct RenderPassManager {
    /// Current pass type
    current_pass: RenderPassType,
    /// Pass-specific configuration
    pass_configs: HashMap<RenderPassType, RenderPassConfig>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum RenderPassType {
    /// Main scene rendering
    Main,
    /// UI overlay rendering
    Overlay,
    /// Debug visualization
    Debug,
    /// Post-processing effects
    PostProcess,
}

/// Configuration for a render pass
#[derive(Debug, Clone)]
pub struct RenderPassConfig {
    /// Clear color for this pass
    pub clear_color: wgpu::Color,
    /// Whether to clear the color attachment
    pub clear: bool,
    /// Depth testing configuration
    pub depth_test: bool,
    /// Stencil testing configuration
    pub stencil_test: bool,
}

impl Default for RenderPassConfig {
    fn default() -> Self {
        Self {
            clear_color: wgpu::Color {
                r: 0.1,
                g: 0.1,
                b: 0.15,
                a: 1.0,
            },
            clear: true,
            depth_test: false,
            stencil_test: false,
        }
    }
}

impl RenderPassManager {
    pub fn new() -> Self {
        let mut pass_configs = HashMap::new();

        // Default configurations for different pass types
        pass_configs.insert(RenderPassType::Main, RenderPassConfig::default());

        pass_configs.insert(
            RenderPassType::Overlay,
            RenderPassConfig {
                clear_color: wgpu::Color::TRANSPARENT,
                clear: false,
                depth_test: false,
                stencil_test: false,
            },
        );

        pass_configs.insert(
            RenderPassType::Debug,
            RenderPassConfig {
                clear_color: wgpu::Color::TRANSPARENT,
                clear: false,
                depth_test: false,
                stencil_test: false,
            },
        );

        pass_configs.insert(
            RenderPassType::PostProcess,
            RenderPassConfig {
                clear_color: wgpu::Color::BLACK,
                clear: true,
                depth_test: false,
                stencil_test: false,
            },
        );

        Self {
            current_pass: RenderPassType::Main,
            pass_configs,
        }
    }

    /// Get configuration for a pass type
    pub fn get_config(&self, pass_type: RenderPassType) -> &RenderPassConfig {
        self.pass_configs
            .get(&pass_type)
            .unwrap_or(&self.pass_configs[&RenderPassType::Main])
    }

    /// Update configuration for a pass type
    pub fn set_config(&mut self, pass_type: RenderPassType, config: RenderPassConfig) {
        self.pass_configs.insert(pass_type, config);
    }

    /// Set the current render pass
    pub fn set_current_pass(&mut self, pass_type: RenderPassType) {
        self.current_pass = pass_type;
    }

    /// Get the current render pass type
    pub fn current_pass(&self) -> RenderPassType {
        self.current_pass
    }

    /// Get render pass load/store operations for current pass
    pub fn get_pass_operations(&self) -> (wgpu::LoadOp<wgpu::Color>, wgpu::StoreOp) {
        let config = self.get_config(self.current_pass);

        let load = if config.clear {
            wgpu::LoadOp::Clear(config.clear_color)
        } else {
            wgpu::LoadOp::Load
        };

        (load, wgpu::StoreOp::Store)
    }

    /// Get depth operations for current pass
    pub fn get_depth_operations(&self) -> Option<wgpu::Operations<f32>> {
        let config = self.get_config(self.current_pass);

        if config.depth_test {
            Some(wgpu::Operations {
                load: wgpu::LoadOp::Clear(1.0),
                store: wgpu::StoreOp::Store,
            })
        } else {
            None
        }
    }

    /// Get stencil operations for current pass
    pub fn get_stencil_operations(&self) -> Option<wgpu::Operations<u32>> {
        let config = self.get_config(self.current_pass);

        if config.stencil_test {
            Some(wgpu::Operations {
                load: wgpu::LoadOp::Clear(0),
                store: wgpu::StoreOp::Store,
            })
        } else {
            None
        }
    }

    /// Get label for current pass
    pub fn get_pass_label(&self) -> String {
        format!("{:?} Render Pass", self.current_pass)
    }
}

/// Tracks and manages layer state
pub struct LayerStateManager {
    /// Currently active layers
    active_layers: Vec<LayerInfo>,
    /// Maximum number of layers
    max_layers: usize,
    /// Layer uniform buffer
    layer_buffer: Option<Buffer>,
    /// Active layer count buffer
    count_buffer: Option<Buffer>,
}

#[derive(Debug, Clone)]
pub struct LayerInfo {
    /// Atlas layer index
    pub atlas_index: u32,
    /// Layer opacity
    pub opacity: f32,
    /// Blend mode
    pub blend_mode: BlendMode,
    /// Colormap ID
    pub colormap_id: u32,
    /// Intensity range
    pub intensity_range: (f32, f32),
    /// Threshold range
    pub threshold_range: (f32, f32),
    /// Threshold mode (Range or Absolute)
    pub threshold_mode: ThresholdMode,
    /// Texture coordinates within atlas (u_min, v_min, u_max, v_max)
    pub texture_coords: (f32, f32, f32, f32),
    /// Whether this layer is a binary mask (true) or continuous data (false)
    pub is_mask: bool,
    /// Whether this layer has an alpha mask attached.
    pub has_alpha_mask: bool,
    /// Interpolation mode (0=nearest, 1=linear, 2=cubic)
    pub interpolation_mode: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum BlendMode {
    /// Normal alpha blending
    Normal = 0,
    /// Additive blending
    Additive = 1,
    /// Multiplicative blending
    Multiply = 2,
    /// Maximum intensity
    Maximum = 3,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum ThresholdMode {
    /// Range thresholding (default)
    Range = 0,
    /// Absolute value thresholding
    Absolute = 1,
    /// Above threshold only
    Above = 2,
    /// Below threshold only
    Below = 3,
}

impl LayerStateManager {
    pub fn new(max_layers: usize) -> Self {
        Self {
            active_layers: Vec::with_capacity(max_layers),
            max_layers,
            layer_buffer: None,
            count_buffer: None,
        }
    }

    /// Add a layer to the active set
    pub fn add_layer(&mut self, layer: LayerInfo) -> Result<usize, &'static str> {
        if self.active_layers.len() >= self.max_layers {
            return Err("Maximum layer count exceeded");
        }

        self.active_layers.push(layer);
        Ok(self.active_layers.len() - 1)
    }

    /// Remove a layer by index
    pub fn remove_layer(&mut self, index: usize) -> Option<LayerInfo> {
        if index < self.active_layers.len() {
            Some(self.active_layers.remove(index))
        } else {
            None
        }
    }

    /// Clear all layers
    pub fn clear_layers(&mut self) {
        self.active_layers.clear();
    }

    /// Get active layer count
    pub fn layer_count(&self) -> usize {
        self.active_layers.len()
    }

    /// Get layer at index
    pub fn get_layer(&self, index: usize) -> Option<&LayerInfo> {
        self.active_layers.get(index)
    }

    /// Get mutable layer at index
    pub fn get_layer_mut(&mut self, index: usize) -> Option<&mut LayerInfo> {
        self.active_layers.get_mut(index)
    }

    /// Get all active layers
    pub fn layers(&self) -> &[LayerInfo] {
        &self.active_layers
    }

    /// Set the alpha-mask state for the layer with the given atlas index.
    pub fn set_layer_has_alpha_mask(&mut self, atlas_index: u32, has_mask: bool) -> bool {
        if let Some(layer) = self
            .active_layers
            .iter_mut()
            .find(|layer| layer.atlas_index == atlas_index)
        {
            layer.has_alpha_mask = has_mask;
            true
        } else {
            false
        }
    }

    /// Set the layer uniform buffer
    pub fn set_layer_buffer(&mut self, buffer: Buffer) {
        self.layer_buffer = Some(buffer);
    }

    /// Set the count uniform buffer
    pub fn set_count_buffer(&mut self, buffer: Buffer) {
        self.count_buffer = Some(buffer);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_render_state_tracking() {
        let mut state = RenderState::new();
        state.begin_frame();

        let key1 = PipelineKey::new("test", wgpu::TextureFormat::Bgra8UnormSrgb);
        let key2 = PipelineKey::new("test2", wgpu::TextureFormat::Bgra8UnormSrgb);

        // First pipeline set
        assert!(state.should_set_pipeline(&key1));
        state.set_pipeline(key1.clone());
        assert!(!state.should_set_pipeline(&key1));

        // Different pipeline
        assert!(state.should_set_pipeline(&key2));
        state.set_pipeline(key2);

        // Bind groups
        assert!(state.should_set_bind_group(0, 12345));
        state.set_bind_group(0, 12345);
        assert!(!state.should_set_bind_group(0, 12345));

        // Draw calls
        state.record_draw();
        state.record_draw();

        let stats = state.end_frame();
        assert_eq!(stats.draw_calls, 2);
        assert_eq!(stats.pipeline_switches, 2);
        assert_eq!(stats.bind_group_changes, 1);
    }

    #[test]
    fn test_layer_manager() {
        let mut manager = LayerStateManager::new(4);

        let layer1 = LayerInfo {
            atlas_index: 0,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            colormap_id: 0,
            intensity_range: (0.0, 1.0),
            threshold_range: (0.0, 1.0),
            threshold_mode: ThresholdMode::Range,
            texture_coords: (0.0, 0.0, 1.0, 1.0),
            is_mask: false,
            has_alpha_mask: false,
            interpolation_mode: 0, // nearest neighbor
        };

        let idx = manager.add_layer(layer1.clone()).unwrap();
        assert_eq!(idx, 0);
        assert_eq!(manager.layer_count(), 1);

        // Remove layer
        let removed = manager.remove_layer(0).unwrap();
        assert_eq!(removed.atlas_index, layer1.atlas_index);
        assert_eq!(manager.layer_count(), 0);
    }
}
