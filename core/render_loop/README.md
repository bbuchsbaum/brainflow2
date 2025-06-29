# Render Loop Module

The render loop module provides GPU-based rendering infrastructure for BrainFlow's neuroimaging visualization.

## Overview

This module handles:
- WebGPU render pipeline management
- Shader compilation and hot-reload during development
- Texture atlas management for efficient multi-volume rendering
- Uniform buffer objects (UBOs) for frame and layer parameters
- Layer management with per-layer uniforms

## Architecture

### Core Components

1. **RenderLoopService** (`lib.rs`)
   - Main service orchestrating the render pipeline
   - Manages GPU device, queue, and surface
   - Handles volume atlas and layer allocations
   - Provides slice upload functionality

2. **Pipeline Management** (`pipeline.rs`)
   - Creates and caches render pipelines
   - Manages bind group layouts for textures and uniforms
   - Handles pipeline state transitions

3. **Shader System** (`shaders.rs`)
   - Runtime shader loading from WGSL files
   - Shader validation and error reporting
   - Hot-reload support with file watching (`shader_watcher.rs`)

4. **Texture Management** (`texture_manager.rs`)
   - Volume atlas for efficient GPU memory usage
   - Slice packing with automatic layout optimization
   - Texture coordinate mapping

5. **Uniform Buffer Objects** (`ubo.rs`, `layer_uniforms.rs`)
   - Frame UBO: viewport, crosshair, time
   - Layer uniforms: per-layer transformation and rendering parameters

## Shader Pipeline

### Current Implementation (wgpu 0.25)

Due to the upgrade to wgpu 0.25 for Tauri 2.5 compatibility, the shader pipeline has been updated to use runtime shader loading:

```rust
// Shaders are loaded at runtime from embedded strings
const VOLUME_SHADER_SOURCE: &str = include_str!("../shaders/volume.wgsl");
```

**Note**: The previous build-time shader compilation with `wgsl_to_wgpu` is temporarily disabled as it doesn't support wgpu 0.25 yet. When a compatible version is released, we can re-enable build-time compilation for better type safety.

### Shader Files

Located in `shaders/` directory:

- **volume.wgsl**: Main volume rendering shader
  - Vertex shader: Full-screen quad generation
  - Fragment shader: Multi-layer compositing with:
    - Per-layer opacity blending
    - Colormap application
    - Window/level adjustment
    - Threshold-based visualization (min/max range)
    - Crosshair overlay
    - View plane highlighting

### Shader Architecture

#### Vertex Stage
The vertex shader generates a full-screen quad using vertex indices:
```wgsl
// No vertex buffer needed - vertices generated from vertex_index
let uv = vec2<f32>(
    f32((vertex_index << 1u) & 2u),
    f32(vertex_index & 2u)
);
```

#### Fragment Stage
The fragment shader performs multi-layer compositing:
1. Iterates through active layers (up to MAX_LAYERS)
2. Samples volume texture using layer's texture coordinates
3. Applies colormap based on layer settings
4. Applies window/level transformation
5. Applies threshold range (for functional overlays)
6. Blends layers using opacity
7. Overlays crosshair if within range

### Uniform Buffer Objects (UBOs)

#### FrameUniforms (Binding 0)
```rust
pub struct FrameUniforms {
    pub view_proj: [[f32; 4]; 4],      // View-projection matrix
    pub world_to_voxel: [[f32; 4]; 4], // World to voxel space transform
    pub crosshair_voxel: [f32; 4],     // Crosshair position in voxel space
    pub view_plane_normal: [f32; 4],    // Current view plane normal
    pub view_plane_distance: f32,       // View plane distance from origin
}
```

#### LayerUniforms (Binding 1)
```rust
pub struct LayerUniforms {
    pub atlas_index: u32,      // Texture array layer index
    pub opacity: f32,          // Layer opacity (0-1)
    pub colormap: u32,         // Colormap ID
    pub window_center: f32,    // Window center for contrast
    pub window_width: f32,     // Window width for contrast
    pub threshold_low: f32,    // Lower threshold (functional data)
    pub threshold_high: f32,   // Upper threshold (functional data)
    pub u_min: f32,           // Texture coordinate bounds
    pub v_min: f32,
    pub u_max: f32,
    pub v_max: f32,
}
```

### Texture Bindings

- **Binding 2**: Volume texture array (texture_2d_array<f32>)
  - 2D texture array containing all volume slices
  - Each layer references a specific array index
  
- **Binding 3**: Colormap texture array (texture_2d_array<f32>)
  - Contains all available colormaps
  - 256x1 LUT per colormap
  
- **Binding 4**: Sampler
  - Linear filtering for smooth interpolation
  - Clamp to edge addressing

### Shader Features

1. **Multi-layer Rendering**: Supports up to 16 simultaneous layers
2. **Threshold Visualization**: For functional activation maps
   - Values outside [threshold_low, threshold_high] are transparent
   - Currently supports positive values only
   - TODO: Add absolute value thresholding for bilateral activations

3. **Crosshair Rendering**: 
   - World-space crosshair with configurable size
   - Automatically hidden when outside view bounds

4. **View Plane Highlighting**:
   - Highlights the current slice plane
   - Useful for 3D orientation

### Performance Optimizations

1. **Branchless Blending**: Uses step functions to avoid branches
2. **Early Fragment Discard**: Skip transparent fragments
3. **Texture Array**: Minimizes texture binding changes
4. **Uniform Buffer Pooling**: Reuses buffers across frames

## Usage Example

```rust
// Initialize render loop service
let service = RenderLoopService::new().await?;

// Upload a slice to GPU
let (atlas_layer, u_min, v_min, u_max, v_max) = 
    service.upload_slice(&volume, axis, slice_index)?;

// Update frame uniforms
service.update_frame_ubo(width, height, crosshair_x, crosshair_y, time_ms);

// Render frame
service.render()?;
```

## Layer Management

Each layer represents a slice of neuroimaging data:

1. **Layer Allocation**: Slices are allocated in the texture atlas
2. **Layer Uniforms**: Each layer has its own uniform buffer containing:
   - Transform matrices
   - Opacity and colormap settings
   - Texture coordinates
   - Metadata

3. **Dynamic Updates**: Layers can be added/removed during runtime

## Performance Considerations

- **Texture Atlas**: Minimizes texture switches and draw calls
- **Uniform Buffer Reuse**: Pre-allocated buffers for efficiency
- **Pipeline Caching**: Pipelines are created once and reused
- **Optimal Texture Formats**: Uses appropriate GPU formats for data types

## Testing

Comprehensive test coverage includes:
- Shader compilation and validation
- Pipeline creation
- Texture binding
- Uniform buffer updates
- Hot-reload functionality

Run tests with:
```bash
cargo test -p render_loop
```

## Future Enhancements

- [ ] Re-enable build-time shader compilation when wgsl_to_wgpu supports wgpu 0.25
- [ ] Add absolute value thresholding for bilateral activation maps
- [ ] Implement advanced blending modes (MIP, average intensity)
- [ ] Add compute shader support for gradients and filtering
- [ ] Full 3D volume rendering with ray marching
- [ ] Surface mesh rendering for cortical surfaces
- [ ] Multi-sample anti-aliasing (MSAA)
- [ ] HDR rendering support

## Build Configuration

### Temporary wgpu 0.25 Workaround

The `build.rs` file is currently disabled due to wgsl_to_wgpu incompatibility:

```toml
# In Cargo.toml - temporarily commented out
# [build-dependencies]
# wgsl_to_wgpu = "0.14.0"  # Waiting for wgpu 0.25 support
```

When updating:
1. Find a wgsl_to_wgpu version compatible with wgpu 0.25
2. Uncomment the build dependency
3. Re-enable build.rs shader compilation
4. Remove manual shader loading from lib.rs

---
*Last Updated: 2025-01-23 - Sprint 0 Documentation (SUB-021)*