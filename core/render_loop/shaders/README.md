# Shader Organization

This directory contains all WGSL shaders for the brainflow2 rendering pipeline.

## Structure

```
shaders/
├── README.md           # This file
├── basic.wgsl         # Basic passthrough shader for debugging
├── slice.wgsl         # Main slice rendering shader
├── test.wgsl          # Test shader with color interpolation
└── volume/            # Volume rendering shaders (future)
    └── ray_march.wgsl # Ray marching shader (future)
```

## Shader Compilation

Shaders are compiled at runtime using wgpu 0.20's `create_shader_module` API.
The `src/shaders.rs` module handles:
- Runtime shader loading and caching
- Bind group layout definitions
- Uniform buffer structures matching WGSL definitions

## Key Shaders

### slice.wgsl
The main production shader for rendering 2D slices from 3D volumes.
- Supports multiple layers with different blend modes
- Handles world-to-voxel transformations
- Implements colormap lookup tables
- Provides crosshair overlay support

### basic.wgsl
A minimal shader for testing the rendering pipeline.
- Full-screen triangle covering clip space
- Outputs solid purple color
- Useful for debugging surface/swapchain issues

### test.wgsl
Test shader with vertex colors for validation.
- Renders a colored triangle
- Tests vertex attribute interpolation
- Validates shader compilation setup

## Uniform Buffer Alignment

All uniform buffers follow std140 layout rules:
- vec3 types are padded to 16 bytes
- Matrices are column-major
- Struct sizes are multiples of 16 bytes

See `src/ubo.rs` for Rust struct definitions.