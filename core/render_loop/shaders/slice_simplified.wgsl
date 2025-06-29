// Simplified slice shader without ViewPlaneUbo
// The view plane information is encoded in the frame's u/v vectors

// --- Frame Uniform Buffer Object (UBO) ---
// Provides view parameters (origin, basis vectors)
struct FrameUbo {
    origin_mm : vec4<f32>,   // World position at NDC (0,0) (homogeneous, w = 1)
    u_mm      : vec4<f32>,   // World vector for NDC [0,1] in X direction
    v_mm      : vec4<f32>,   // World vector for NDC [0,1] in Y direction
    atlas_dim : vec3<u32>,   // Dimensions of the 3D texture atlas
    _padding  : u32,         // Padding to maintain alignment
    target_dim: vec2<u32>,   // Dimensions of the render target
    _padding2 : vec2<u32>,   // Padding to maintain 16-byte alignment
};

// --- Crosshair UBO ---
struct CrosshairUbo {
    world_position: vec3<f32>,
    show_crosshair: u32,     // 0 = hide, 1 = show
};

// --- Per-Layer UBO ---
// Matches LayerUboStd140 in Rust (144 bytes, std140-compliant)
struct LayerUBO {
    // --- 16-byte aligned types first ---
    world_to_voxel : mat4x4<f32>,      // offset 0, size 64
    texture_coords : vec4<f32>,        // offset 64, size 16 (u_min, v_min, u_max, v_max)
    
    // --- vec3 + scalar to fill 16 bytes ---
    dim            : vec3<u32>,        // offset 80, size 12
    padSlices      : u32,              // offset 92, size 4 (completes 16-byte block)
    
    // --- 4 scalars to fill 16 bytes ---
    colormap_id    : u32,              // offset 96, size 4
    blend_mode     : u32,              // offset 100, size 4 (0=alpha, 1=add, 2=max, 3=min)
    layer_index    : u32,              // offset 104, size 4
    threshold_mode : u32,              // offset 108, size 4 (0=range, 1=absolute)
    
    // --- 4 scalars to fill 16 bytes ---
    opacity        : f32,              // offset 112, size 4
    intensity_min  : f32,              // offset 116, size 4
    intensity_max  : f32,              // offset 120, size 4
    thresh_low     : f32,              // offset 124, size 4
    
    // --- Final scalar + padding ---
    thresh_high    : f32,              // offset 128, size 4
    isMask         : u32,              // offset 132, size 4
    // Implicit padding to 144 bytes
};

// --- Bind Group 0: Per-Frame Globals ---
@group(0) @binding(0) var<uniform> frame: FrameUbo;
@group(0) @binding(1) var<uniform> crosshair: CrosshairUbo;

// --- Bind Group 1: Layer Data ---
@group(1) @binding(0) var<uniform> layerUBOs : array<LayerUBO, 8>; // Max 8 layers
@group(1) @binding(1) var<uniform> activeLayerCount : u32;

// --- Bind Group 2: Textures & Samplers ---
@group(2) @binding(0) var volumeTexture: texture_3d<f32>;
@group(2) @binding(1) var samplerLinear: sampler;
@group(2) @binding(2) var colormapLutTexture: texture_2d_array<f32>;
@group(2) @binding(3) var cmSampler: sampler;

// --- Vertex Shader Output ---
struct VsOut {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) world_mm: vec3<f32>,
};

// --- Vertex Shader ---
@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VsOut {
    // Generate full-screen quad vertices in NDC space [0, 1]
    var ndc: vec2<f32>;
    switch (vid) {
        case 0u: { ndc = vec2<f32>(0.0, 0.0); }  // Bottom-left
        case 1u: { ndc = vec2<f32>(1.0, 0.0); }  // Bottom-right
        case 2u: { ndc = vec2<f32>(0.0, 1.0); }  // Top-left
        case 3u: { ndc = vec2<f32>(0.0, 1.0); }  // Top-left
        case 4u: { ndc = vec2<f32>(1.0, 0.0); }  // Bottom-right
        default: { ndc = vec2<f32>(1.0, 1.0); }  // Top-right
    }
    
    // Convert to clip space [-1, 1]
    let clip_pos = ndc * 2.0 - 1.0;
    
    // Calculate world position using frame
    let world_pos = frame.origin_mm + ndc.x * frame.u_mm + ndc.y * frame.v_mm;
    
    var output: VsOut;
    output.clip_position = vec4<f32>(clip_pos, 0.0, 1.0);
    output.world_mm = world_pos.xyz;
    return output;
}

// --- Fragment Shader Helpers ---

// Sample a layer at the given world coordinate
fn sampleLayer(layer: LayerUBO, world_mm: vec3<f32>) -> vec4<f32> {
    // Transform world to voxel coordinates
    let voxel_coord_h = layer.world_to_voxel * vec4<f32>(world_mm, 1.0);
    if (voxel_coord_h.w <= 0.0) { return vec4<f32>(0.0); }
    let voxel_coord = voxel_coord_h.xyz / voxel_coord_h.w;
    
    // Check bounds - return a debug color for out-of-bounds
    if (any(voxel_coord < vec3<f32>(0.0)) || any(voxel_coord >= vec3<f32>(layer.dim))) {
        // Return red for out-of-bounds debugging
        // return vec4<f32>(1.0, 0.0, 0.0, 0.5);
        return vec4<f32>(0.0);
    }
    
    // Convert voxel coordinates to texture coordinates
    let atlas_size = vec3<f32>(frame.atlas_dim);
    let normalized_coord = voxel_coord / atlas_size;
    
    // Sample texture
    let raw_value = textureSample(volumeTexture, samplerLinear, normalized_coord).r;
    
    // Handle binary masks
    if (layer.isMask == 1u) {
        // For binary masks, any non-zero value should be visible
        // Since R8Unorm normalizes 0-255 to 0-1, a value of 128 becomes 0.5
        let alpha = select(0.0, layer.opacity, raw_value > 0.1);
        return vec4<f32>(vec3<f32>(1.0), alpha);
    }
    
    // Window/level normalization
    let intensity_delta = max(layer.intensity_max - layer.intensity_min, 1e-9);
    let intensity_norm = clamp((raw_value - layer.intensity_min) / intensity_delta, 0.0, 1.0);
    
    // Apply thresholding
    var alpha = layer.opacity;
    if (layer.threshold_mode == 1u) {
        // Absolute value thresholding
        let abs_value = abs(raw_value);
        if (abs_value < layer.thresh_low || abs_value > layer.thresh_high) {
            alpha = 0.0;
        }
    } else {
        // Range thresholding
        if (raw_value < layer.thresh_low || raw_value > layer.thresh_high) {
            alpha = 0.0;
        }
    }
    
    // Apply colormap
    let lut_coord = vec2<f32>(intensity_norm, 0.5);
    let rgb_color = textureSample(colormapLutTexture, cmSampler, lut_coord, i32(layer.colormap_id)).rgb;
    
    return vec4<f32>(rgb_color, alpha);
}

// Composite source onto destination based on blend mode
fn composite(dst: vec4<f32>, src: vec4<f32>, mode: u32) -> vec4<f32> {
    if (src.a <= 0.0) { return dst; }
    
    var result: vec4<f32>;
    switch (mode) {
        case 1u: { // Additive
            result = vec4<f32>(clamp(dst.rgb + src.rgb * src.a, vec3(0.0), vec3(1.0)), max(dst.a, src.a));
        }
        case 2u: { // Max intensity
            result = vec4<f32>(max(dst.rgb, src.rgb), max(dst.a, src.a));
        }
        case 3u: { // Min intensity
            result = vec4<f32>(min(dst.rgb, src.rgb), max(dst.a, src.a));
        }
        default: { // Alpha blending (over)
            let out_alpha = src.a + dst.a * (1.0 - src.a);
            if (out_alpha < 0.00001) {
                result = vec4<f32>(0.0);
            } else {
                let out_rgb = (src.rgb * src.a + dst.rgb * dst.a * (1.0 - src.a)) / out_alpha;
                result = vec4<f32>(out_rgb, out_alpha);
            }
        }
    }
    return result;
}

// Detect which axes are visible based on frame vectors
fn getVisibleAxes() -> vec3<bool> {
    // Calculate frame normal (u × v)
    let normal = normalize(cross(frame.u_mm.xyz, frame.v_mm.xyz));
    
    // Check which axis the normal is most aligned with
    let abs_normal = abs(normal);
    let threshold = 0.9; // Consider axis hidden if normal is nearly aligned
    
    return vec3<bool>(
        abs_normal.x < threshold, // X visible if normal not aligned with X
        abs_normal.y < threshold, // Y visible if normal not aligned with Y
        abs_normal.z < threshold  // Z visible if normal not aligned with Z
    );
}

// --- Main Fragment Shader ---
@fragment
fn fs_main(input: VsOut) -> @location(0) vec4<f32> {
    var final_color = vec4<f32>(0.0, 0.0, 0.0, 0.0);
    let world_mm = input.world_mm;
    
    // Simple test - output a gradient based on position
    if (false) {
        let uv = (input.clip_position.xy + 1.0) * 0.5; // Convert from [-1,1] to [0,1]
        return vec4<f32>(uv.x, uv.y, 0.5, 1.0);
    }
    
    // DEBUG: Check if we have active layers
    if (false) {
        if (activeLayerCount == 0u) {
            // No layers - show red
            return vec4<f32>(1.0, 0.0, 0.0, 1.0);
        } else {
            // Have layers - show green (intensity based on count)
            let intensity = f32(activeLayerCount) / 8.0;
            return vec4<f32>(0.0, intensity, 0.0, 1.0);
        }
    }
    
    // Composite all layers
    for (var i: u32 = 0u; i < activeLayerCount; i = i + 1u) {
        let layer = layerUBOs[i];
        let layer_color = sampleLayer(layer, world_mm);
        final_color = composite(final_color, layer_color, layer.blend_mode);
    }
    
    // Draw crosshair if enabled
    if (crosshair.show_crosshair == 1u) {
        let crosshair_color = vec4<f32>(0.0, 1.0, 0.0, 0.8); // Green
        
        // Calculate pixel size in world space
        let pixel_size_x = length(frame.u_mm.xyz) / f32(frame.target_dim.x);
        let pixel_size_y = length(frame.v_mm.xyz) / f32(frame.target_dim.y);
        
        // Crosshair thickness
        let thickness_x = pixel_size_x * 1.0; // 1 pixel
        let thickness_y = pixel_size_y * 1.0; // 1 pixel
        
        // Distance from crosshair
        let dist = abs(world_mm - crosshair.world_position);
        let visible_axes = getVisibleAxes();
        
        // Draw lines for visible axes
        if (visible_axes.x && dist.x < thickness_x && 
            dist.y < thickness_y * 20.0 && dist.z < thickness_y * 20.0) {
            final_color = composite(final_color, crosshair_color, 0u);
        }
        if (visible_axes.y && dist.y < thickness_y && 
            dist.x < thickness_x * 20.0 && dist.z < thickness_x * 20.0) {
            final_color = composite(final_color, crosshair_color, 0u);
        }
        if (visible_axes.z && dist.z < thickness_y && 
            dist.x < thickness_x * 20.0 && dist.y < thickness_x * 20.0) {
            final_color = composite(final_color, crosshair_color, 0u);
        }
    }
    
    return final_color;
}