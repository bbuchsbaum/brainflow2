# Critical Rendering Issue Context

## Problem Summary
Three fundamental rendering tests are failing in a WebGPU-based neuroimaging visualization system:

1. **test_render_single_volume_grayscale** - Should render a gradient in grayscale, but produces wrong colors
2. **test_render_two_layer_overlay** - Layer compositing not working
3. **test_render_threshold_modes** - Thresholding not filtering pixels correctly

## Key Symptoms
- Expected grayscale pixel [95, 95, 95, 255] but got [13, 251, 18, 255] (green-dominant)
- Most pixels show background color [89, 89, 108, 255] (blue-tinted due to clear color 0.1, 0.1, 0.15)
- Gradient pattern not visible - uniform values across image
- Brightest pixel at wrong location in coordinate test

## What We've Already Fixed
1. FrameUbo struct mismatch between Rust (80 bytes) and WGSL (64 bytes) - FIXED
2. Matrix layout mismatch (nalgebra row-major vs WGSL column-major) - FIXED by transposing
3. Shader compilation and basic pipeline creation - WORKING
4. Volume upload and texture creation - WORKING

## System Architecture
- **Rust Backend**: Uses wgpu for WebGPU rendering
- **Shader**: slice_world_space.wgsl samples 3D textures and applies colormaps
- **Colormap System**: 
  - Texture array with dimensions 256x1xN (N colormaps)
  - Format: Rgba8UnormSrgb
  - Colormap 0 should be grayscale
- **Rendering Pipeline**:
  1. Volume data uploaded as 3D texture (R32Float or R16Float)
  2. World-to-voxel transform in storage buffer
  3. Fragment shader samples texture, normalizes intensity, applies colormap
  4. Output should be colored based on selected colormap

## Current Test Setup
```rust
// Creates 8x8x8 volume with diagonal gradient
data[idx] = (x + y + z) / 21.0 * 1000.0;  // Values 0-1000

// Volume transform shifts origin
Matrix4::new_translation(&Vector3::new(-4.0, -4.0, -4.0))

// View setup (after fixes)
origin: [-4.0, -4.0, 0.0, 1.0]  // Bottom-left of volume
u: [8.0, 0.0, 0.0, 0.0]         // X span
v: [0.0, 8.0, 0.0, 0.0]         // Y span
```

## Shader Colormap Sampling (slice_world_space.wgsl)
```wgsl
// Line 202-203
let lut_coord = vec2<f32>(intensity_norm, 0.5);
let rgb_color = textureSample(colormapLutTexture, cmSampler, lut_coord, i32(layer.colormap_id)).rgb;
```

## Questions to Investigate
1. Is the colormap texture properly initialized with grayscale data?
2. Is the colormap texture correctly bound in the world-space bind groups?
3. Is colormap_id 0 actually grayscale, or is there an off-by-one error?
4. Is the texture format (Rgba8UnormSrgb) causing color space issues?
5. Is the shader sampling the correct layer of the texture array?
6. Are the bind group indices correct in the shader?