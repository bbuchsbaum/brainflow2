# CLAUDE.md - Core Rendering Architecture

This document provides a comprehensive overview of the rendering architecture in the Brainflow2 core module, focusing on the WebGPU-based render_loop system.

## Adding New Brain Templates

To add a new brain template (e.g., MNIColin27, MNIPediatric, etc.), you need to update 4 files:

### 1. Add Template Space (`core/templates/src/types.rs`)
```rust
pub enum TemplateSpace {
    // ... existing spaces
    MNIColin27,  // Add your new template space
}
```
Update the implementation methods: `as_str()`, `display_name()`, and `is_volume_space()`.

### 2. Add Template Entries (`core/templates/src/catalog.rs`)
Create a new method like `add_mnicolin27_templates()` with the template files:
```rust
fn add_mnicolin27_templates(&mut self) {
    let space = TemplateSpace::MNIColin27;
    self.add_template_entry(TemplateCatalogEntry {
        id: "MNIColin27_T1w_native".to_string(),
        download_url: Some("https://templateflow.s3.amazonaws.com/..."),
        // ... other fields
    });
}
```

### 3. Update Parser (`core/api_bridge/src/lib.rs`)
Add the new space to `parse_template_id()`:
```rust
"MNIColin27" => templates::TemplateSpace::MNIColin27,
```

### 4. Add Menu Items (`src-tauri/src/main.rs`)
Add the template submenu in the template menu builder:
```rust
let mut mnicolin27 = SubmenuBuilder::new(app, "MNI Colin27");
mnicolin27 = mnicolin27
    .item(&MenuItemBuilder::new("T1w")
        .id("template_MNIColin27_T1w_native")
        .build(app)?);
```

**Note**: We're working on dynamic template discovery using the `templateflow-rs` library which will eliminate the need for these manual updates.

## Overview

The render_loop module implements a high-performance GPU rendering system for neuroimaging visualization. It uses WebGPU for cross-platform compatibility and provides efficient multi-layer volume rendering with real-time interactivity.

## Architecture Components

### 1. Core Service (`lib.rs`)
- **RenderLoopService**: Main orchestrator managing GPU device, queue, and render pipeline
- Handles offscreen rendering to avoid Tauri window handle complications
- Manages volume texture uploads and layer allocations
- Provides frame rendering and buffer readback

### 2. Pipeline Management (`pipeline.rs`)
- **PipelineManager**: Creates and caches render pipelines
- Manages bind group layouts for textures and uniforms
- Supports multiple shader variants with hot-reload
- Handles pipeline state transitions efficiently

### 3. Shader System
- **ShaderManager** (`shaders.rs`): Runtime shader loading and validation
- **ShaderWatcher** (`shader_watcher.rs`): Development hot-reload support
- Key shader: `slice_world_space_optimized.wgsl` - Optimized world-space rendering

### 4. Texture Management
- **TextureManager** (`texture_manager.rs`): 2D texture atlas for legacy approach
- **MultiTextureManager** (`multi_texture_manager.rs`): 3D texture management for world-space rendering
- **SmartTextureManager** (`smart_texture_manager.rs`): Automatic format selection and memory optimization
- Supports up to 15 simultaneous volume textures

### 5. Layer System
- **LayerUniformManager** (`layer_uniforms.rs`): Traditional uniform buffer approach
- **LayerStorageManager** (`layer_storage.rs`): Modern storage buffer approach for dynamic layer count
- **LayerUboStd140** (`ubo.rs`): std140-compliant layer data structure

### 6. Render State Management
- **RenderState** (`render_state.rs`): Tracks current rendering configuration
- **ViewState** (`view_state.rs`): Per-view state management for multi-view rendering
- Supports multiple blend modes: alpha, additive, max, min

## Data Flow

1. **Volume Upload**:
   ```
   Volume Data → MultiTextureManager → GPU Texture3D
   ```

2. **Frame Rendering**:
   ```
   Update UBOs → Set Pipeline → Bind Resources → Draw → Readback
   ```

3. **Layer Compositing**:
   - Each layer samples from its 3D texture
   - Applies colormap, intensity windowing, and thresholding
   - Composites using specified blend mode
   - Final output includes optional crosshair overlay

## Shader Architecture

### World-Space Rendering Pipeline
The optimized world-space shader (`slice_world_space_optimized.wgsl`) implements:

1. **Vertex Stage**: Generates full-screen quad from vertex indices
2. **Fragment Stage**: 
   - Transforms world coordinates to voxel space per layer
   - Samples 3D textures with LOD optimization
   - Applies rendering parameters (colormap, threshold, opacity)
   - Composites multiple layers with various blend modes

### Uniform Buffer Objects (UBOs)

#### Frame UBO (Bind Group 0)
```rust
struct FrameUbo {
    origin_mm: vec4<f32>,    // World position at NDC (0,0)
    u_mm: vec4<f32>,         // World vector for NDC X
    v_mm: vec4<f32>,         // World vector for NDC Y
    target_dim: vec2<u32>,   // Render target dimensions
}
```

#### Layer Data (Storage Buffer - Bind Group 1)
```rust
struct LayerData {
    world_to_voxel: mat4x4<f32>,  // Transform matrix
    dim: vec3<u32>,               // Volume dimensions
    texture_index: u32,           // Which texture to sample
    colormap_id: u32,             // Colormap LUT index
    blend_mode: u32,              // Blending mode
    threshold_mode: u32,          // Threshold type
    opacity: f32,                 // Layer opacity
    intensity_min/max: f32,       // Intensity window
    thresh_low/high: f32,         // Threshold bounds
}
```

### Performance Optimizations

1. **Early Exit**: Skip transparent pixels and layers
2. **LOD Sampling**: Automatic mip level selection based on pixel size
3. **Vectorized Operations**: SIMD-friendly bounds checking
4. **Reduced Branching**: Uses select() instead of if-else where possible
5. **Texture Arrays**: Minimizes bind group switches

## Coordinate System

The rendering system handles the critical Y-axis convention difference:
- **GPU/WebGPU**: Y=0 at bottom (OpenGL convention)
- **CPU/Images**: Y=0 at top (image convention)

The Y-flip is isolated to the buffer readback phase in `render_to_buffer()`, keeping all coordinate calculations consistent.

## Testing Infrastructure

Comprehensive test coverage includes:
- Shader compilation and validation
- Multi-volume overlay rendering
- Coordinate transform accuracy
- Performance benchmarking
- Resource management
- World-space rendering accuracy

Key test patterns:
- `*_test.rs`: Integration tests
- `test_fixtures.rs`: Shared test utilities
- Visual debugging outputs (debug_render_*.png)

## Future Enhancements

1. **Compute Shaders**: For gradient calculation and advanced filtering
2. **Ray Marching**: Full 3D volume rendering
3. **Surface Rendering**: Cortical surface mesh support
4. **MSAA**: Multi-sample anti-aliasing
5. **HDR Support**: High dynamic range rendering

## Usage Example

```rust
// Initialize render service
let service = RenderLoopService::new_headless()?;

// Upload volume
let (texture_index, transform) = service.upload_volume(&volume)?;

// Update frame parameters
service.update_frame_ubo(origin, u_vec, v_vec, width, height);

// Add layer
service.add_layer(LayerInfo {
    texture_index,
    opacity: 1.0,
    colormap_id: 0,
    blend_mode: BlendMode::Alpha,
    // ... other parameters
});

// Render and get buffer
let buffer = service.render_to_buffer(width, height)?;
```

## Key Design Decisions

1. **Storage Buffers**: Enables dynamic layer count without pipeline recreation
2. **3D Textures**: Direct volume sampling without atlas packing
3. **World-Space Rendering**: Consistent coordinate system across views
4. **Offscreen Rendering**: Avoids Tauri integration complexity
5. **Hot Reload**: Rapid shader development iteration

This architecture provides a flexible, performant foundation for neuroimaging visualization with room for future enhancements.