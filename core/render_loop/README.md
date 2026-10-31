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

### Current Implementation (wgpu 0.20.1)

The workspace pins wgpu `=0.20.1` in the root `Cargo.toml`. WGSL shaders are
loaded at runtime with `create_shader_module`. The runtime masked shaders are
authoritative, and `src/shader_contract.rs` is the single source of truth for
group/binding indices (gate: `cargo test -p render_loop --test shader_contract_test`).

**Note**: The `typed-shaders` feature (build-time generation with `wgsl_to_wgpu`)
is intentionally disabled and fails fast with `compile_error!` while the
alpha-mask pipeline is active. It stays off until generation is retargeted to
the masked shaders; see `memory-bank/SHADER_BINDINGS_PLAN.md`.

### Shader Files

Located in `shaders/` directory:

- **slice_world_space_masked.wgsl** and **slice_world_space_optimized_masked.wgsl**:
  the active world-space slice shaders. They composite up to `MAX_TEXTURES`
  layers with per-layer masks, colormaps, window/level, thresholds and label
  lookup.
- The other `.wgsl` files are debug or legacy variants.

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

- [ ] Re-enable typed shader generation once it targets the masked shaders (`memory-bank/SHADER_BINDINGS_PLAN.md`)
- [ ] Add absolute value thresholding for bilateral activation maps
- [ ] Implement advanced blending modes (MIP, average intensity)
- [ ] Add compute shader support for gradients and filtering
- [ ] Full 3D volume rendering with ray marching
- [ ] Surface mesh rendering for cortical surfaces
- [ ] Multi-sample anti-aliasing (MSAA)
- [ ] HDR rendering support

## Build Configuration

### Typed Shaders (disabled)

`wgsl_to_wgpu` is an optional build dependency enabled only by the
`typed-shaders` feature, which currently stops the build with `compile_error!`
in `src/lib.rs`. Default builds load the masked WGSL at runtime and do not need
it. Re-enabling it is tracked in `memory-bank/SHADER_BINDINGS_PLAN.md`.

---
*Last Updated: 2025-01-23 - Sprint 0 Documentation (SUB-021)*