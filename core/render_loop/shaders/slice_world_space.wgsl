// World-space slice shader with proper multi-resolution support
// Each layer samples from its own texture with correct resolution

// --- Frame Uniform Buffer Object (UBO) ---
// Provides view parameters (origin, basis vectors)
struct FrameUbo {
    origin_mm : vec4<f32>,   // World position at NDC (0,0) (homogeneous, w = 1)
    u_mm      : vec4<f32>,   // World vector for NDC [0,1] in X direction
    v_mm      : vec4<f32>,   // World vector for NDC [0,1] in Y direction
    atlas_dim : vec3<u32>,   // Dimensions of the 3D texture atlas
    _padding_frame: u32,     // Padding to maintain alignment
    target_dim: vec2<u32>,   // Dimensions of the render target
    _padding_target: vec2<u32>, // Padding to maintain 16-byte alignment
};

// --- Crosshair UBO ---
struct CrosshairUbo {
    world_position: vec3<f32>,
    show_crosshair: u32,     // 0 = hide, 1 = show
};

// --- Per-Layer Storage Buffer ---
// This MUST match the Rust LayerUboStd140 struct exactly (total size: 160 bytes).
// IMPORTANT: std140 layout rules apply - vec3 has 16-byte alignment!
struct LayerData {
    // --- 16-byte aligned types first ---
    world_to_voxel : mat4x4<f32>,      // 64 bytes, offset 0
    texture_coords : vec4<f32>,        // 16 bytes, offset 64
    
    // --- Volume info with explicit padding ---
    // In Rust: dim: [u32; 3] + pad_slices: u32 = 16 bytes total
    // In WGSL: Use vec3<u32> which has 16-byte alignment but 12-byte size
    dim            : vec3<u32>,        // 12 bytes (16-byte aligned), offset 80
    pad_slices     : u32,              // 4 bytes, offset 92
    
    // --- Rendering parameters ---
    colormap_id    : u32,              // 4 bytes, offset 96
    blend_mode     : u32,              // 4 bytes, offset 100
    texture_index  : u32,              // 4 bytes, offset 104
    threshold_mode : u32,              // 4 bytes, offset 108
    
    opacity        : f32,              // 4 bytes, offset 112
    intensity_min  : f32,              // 4 bytes, offset 116
    intensity_max  : f32,              // 4 bytes, offset 120
    thresh_low     : f32,              // 4 bytes, offset 124
    
    thresh_high    : f32,              // 4 bytes, offset 128
    is_mask        : u32,              // 4 bytes, offset 132
    has_alpha_mask : u32,              // 4 bytes, offset 136
    interpolation_mode : u32,          // 4 bytes, offset 140

    // --- Display options --- (next 16-byte block)
    drawSliceBorder : u32,             // 4 bytes, offset 144
    borderThicknessPx : f32,           // 4 bytes, offset 148
    _padMask0       : u32,             // 4 bytes, offset 152
    _padMask1       : u32,             // 4 bytes, offset 156
    // Total struct size: 160 bytes (matches Rust LayerUboStd140)
};

// --- Layer metadata ---
struct LayerMetadata {
    active_count: u32,
    _padding1: u32,
    _padding2: u32,
    _padding3: u32,
    _padding4: u32,
    _padding5: u32,
    _padding6: u32,
    _padding7: u32,
};

// --- Bind Group 0: Per-Frame Globals ---
@group(0) @binding(0) var<uniform> frame: FrameUbo;
@group(0) @binding(1) var<uniform> crosshair: CrosshairUbo;

// --- Bind Group 1: Layer Data (Storage Buffers) ---
@group(1) @binding(0) var<storage, read> layer_data: array<LayerData>;
@group(1) @binding(1) var<uniform> layer_metadata: LayerMetadata;

// --- Bind Group 2: Textures & Samplers ---
// Support up to 14 volume textures
@group(2) @binding(0) var volumeTexture0: texture_3d<f32>;
@group(2) @binding(1) var volumeTexture1: texture_3d<f32>;
@group(2) @binding(2) var volumeTexture2: texture_3d<f32>;
@group(2) @binding(3) var volumeTexture3: texture_3d<f32>;
@group(2) @binding(4) var volumeTexture4: texture_3d<f32>;
@group(2) @binding(5) var volumeTexture5: texture_3d<f32>;
@group(2) @binding(6) var volumeTexture6: texture_3d<f32>;
@group(2) @binding(7) var volumeTexture7: texture_3d<f32>;
@group(2) @binding(8) var volumeTexture8: texture_3d<f32>;
@group(2) @binding(9) var volumeTexture9: texture_3d<f32>;
@group(2) @binding(10) var volumeTexture10: texture_3d<f32>;
@group(2) @binding(11) var volumeTexture11: texture_3d<f32>;
@group(2) @binding(12) var volumeTexture12: texture_3d<f32>;
@group(2) @binding(13) var volumeTexture13: texture_3d<f32>;
@group(2) @binding(14) var samplerLinear: sampler;
@group(2) @binding(15) var colormapLutTexture: texture_2d_array<f32>;
// Nearest-neighbour sampler used when interpolation_mode == 0
@group(2) @binding(16) var samplerNearest: sampler;

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
        case 5u: { ndc = vec2<f32>(1.0, 1.0); }  // Top-right
        default: { ndc = vec2<f32>(0.0, 0.0); }  // Fallback
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

// Helper function to sample from the correct texture based on index and interpolation mode.
// interpolation_mode: 0 = nearest, 1 = linear, 2+ = linear (future cubic support)
fn sampleVolumeTexture(texture_index: u32, coord: vec3<f32>, interpolation_mode: u32) -> f32 {
    let use_nearest = interpolation_mode == 0u;

    if (use_nearest) {
        // Nearest-neighbour sampling
        switch (texture_index) {
            case 0u: { return textureSampleLevel(volumeTexture0, samplerNearest, coord, 0.0).r; }
            case 1u: { return textureSampleLevel(volumeTexture1, samplerNearest, coord, 0.0).r; }
            case 2u: { return textureSampleLevel(volumeTexture2, samplerNearest, coord, 0.0).r; }
            case 3u: { return textureSampleLevel(volumeTexture3, samplerNearest, coord, 0.0).r; }
            case 4u: { return textureSampleLevel(volumeTexture4, samplerNearest, coord, 0.0).r; }
            case 5u: { return textureSampleLevel(volumeTexture5, samplerNearest, coord, 0.0).r; }
            case 6u: { return textureSampleLevel(volumeTexture6, samplerNearest, coord, 0.0).r; }
            case 7u: { return textureSampleLevel(volumeTexture7, samplerNearest, coord, 0.0).r; }
            case 8u: { return textureSampleLevel(volumeTexture8, samplerNearest, coord, 0.0).r; }
            case 9u: { return textureSampleLevel(volumeTexture9, samplerNearest, coord, 0.0).r; }
            case 10u: { return textureSampleLevel(volumeTexture10, samplerNearest, coord, 0.0).r; }
            case 11u: { return textureSampleLevel(volumeTexture11, samplerNearest, coord, 0.0).r; }
            case 12u: { return textureSampleLevel(volumeTexture12, samplerNearest, coord, 0.0).r; }
            case 13u: { return textureSampleLevel(volumeTexture13, samplerNearest, coord, 0.0).r; }
            default: { return 0.0; }
        }
    } else {
        // Linear sampling (default)
        switch (texture_index) {
            case 0u: { return textureSampleLevel(volumeTexture0, samplerLinear, coord, 0.0).r; }
            case 1u: { return textureSampleLevel(volumeTexture1, samplerLinear, coord, 0.0).r; }
            case 2u: { return textureSampleLevel(volumeTexture2, samplerLinear, coord, 0.0).r; }
            case 3u: { return textureSampleLevel(volumeTexture3, samplerLinear, coord, 0.0).r; }
            case 4u: { return textureSampleLevel(volumeTexture4, samplerLinear, coord, 0.0).r; }
            case 5u: { return textureSampleLevel(volumeTexture5, samplerLinear, coord, 0.0).r; }
            case 6u: { return textureSampleLevel(volumeTexture6, samplerLinear, coord, 0.0).r; }
            case 7u: { return textureSampleLevel(volumeTexture7, samplerLinear, coord, 0.0).r; }
            case 8u: { return textureSampleLevel(volumeTexture8, samplerLinear, coord, 0.0).r; }
            case 9u: { return textureSampleLevel(volumeTexture9, samplerLinear, coord, 0.0).r; }
            case 10u: { return textureSampleLevel(volumeTexture10, samplerLinear, coord, 0.0).r; }
            case 11u: { return textureSampleLevel(volumeTexture11, samplerLinear, coord, 0.0).r; }
            case 12u: { return textureSampleLevel(volumeTexture12, samplerLinear, coord, 0.0).r; }
            case 13u: { return textureSampleLevel(volumeTexture13, samplerLinear, coord, 0.0).r; }
            default: { return 0.0; }
        }
    }
}

// Debug: visualize raw sampling for a specific texture index.
// When SLICE_DEBUG_MODE == 1u and layer.texture_index == SLICE_DEBUG_TEXTURE_INDEX,
// the shader returns intensity as grayscale and bypasses thresholding/colormap.
// When SLICE_DEBUG_MODE == 2u the fragment shader bypasses geometry entirely and samples
// the center of SLICE_DEBUG_TEXTURE_INDEX in texture space (see fs_main).
const SLICE_DEBUG_MODE: u32 = 0u;
const SLICE_DEBUG_TEXTURE_INDEX: u32 = 3u; // top layer atlas index in current logs

// Sample a layer at the given world coordinate  
fn sampleLayer(layer: LayerData, world_mm: vec3<f32>) -> vec4<f32> {
    // Transform world to voxel coordinates
    let voxel_coord_h = layer.world_to_voxel * vec4<f32>(world_mm, 1.0);
    if (voxel_coord_h.w <= 0.0) { return vec4<f32>(0.0); }
    let voxel_coord = voxel_coord_h.xyz / voxel_coord_h.w;
    
    // Check bounds - return transparent for out-of-bounds
    let dim_f = vec3<f32>(layer.dim);
    if (any(voxel_coord < vec3<f32>(0.0)) || any(voxel_coord >= dim_f)) {
        return vec4<f32>(0.0);
    }
    
    // Convert voxel coordinates to normalized texture coordinates [0,1]
    let tex_coord = voxel_coord / dim_f;

    // Optional border overlay (per-layer)
    if (layer.drawSliceBorder == 1u) {
        let t_u = layer.borderThicknessPx / f32(frame.target_dim.x);
        let t_v = layer.borderThicknessPx / f32(frame.target_dim.y);
        let near_edge = tex_coord.x <= t_u || tex_coord.x >= (1.0 - t_u) ||
                        tex_coord.y <= t_v || tex_coord.y >= (1.0 - t_v);
        if (near_edge) {
            // White border with layer opacity
            return vec4<f32>(1.0, 1.0, 1.0, layer.opacity);
        }
    }
    
    // Sample from the appropriate texture using the layer's interpolation mode
    let raw_value = sampleVolumeTexture(layer.texture_index, tex_coord, layer.interpolation_mode);

    // Raw sampling debug mode: show intensity as grayscale for a single texture index.
    if (SLICE_DEBUG_MODE == 1u && layer.texture_index == SLICE_DEBUG_TEXTURE_INDEX) {
        let val = clamp(raw_value, 0.0, 1.0);
        return vec4<f32>(val, val, val, 1.0);
    }
    
    // Handle binary masks
    if (layer.is_mask == 1u) {
        // For binary masks, any non-zero value should be visible
        let alpha = select(0.0, layer.opacity, raw_value > 0.1);
        return vec4<f32>(vec3<f32>(1.0), alpha);
    }
    
    // Window/level normalization
    let intensity_delta = max(layer.intensity_max - layer.intensity_min, 1e-9);
    let intensity_norm = clamp((raw_value - layer.intensity_min) / intensity_delta, 0.0, 1.0);
    
    // THRESHOLD SEMANTICS (IMPORTANT - counterintuitive!):
    // Values WITHIN the threshold range [low, high] become TRANSPARENT (hidden).
    // Values OUTSIDE the range remain visible.
    // This allows hiding unwanted value ranges (e.g., background, low intensities).
    //
    // Default (0.0, 0.0): No values are within this point range (except exactly 0.0),
    // so effectively nothing is hidden - this disables thresholding.
    //
    // Example: thresh=(0.0, 0.5) hides values in [0, 0.5], showing only values > 0.5.
    //
    // For debugging alpha issues, we start from a fixed alpha of 1.0 instead of
    // reading layer.opacity from the UBO; when SLICE_DISABLE_THRESHOLD_DEBUG == 1u,
    // thresholding is skipped and alpha remains 1.0 for all layers.
    var alpha = 1.0;
    if (SLICE_DISABLE_THRESHOLD_DEBUG == 0u) {
        switch (layer.threshold_mode) {
            case 1u: { // Absolute value thresholding: hide if |value| is INSIDE [low, high]
                let abs_value = abs(raw_value);
                if (abs_value >= layer.thresh_low && abs_value <= layer.thresh_high) {
                    alpha = 0.0;
                }
            }
            case 2u: { // Above threshold: show only values >= thresh_low
                if (raw_value < layer.thresh_low) {
                    alpha = 0.0;
                }
            }
            case 3u: { // Below threshold: show only values <= thresh_high
                if (raw_value > layer.thresh_high) {
                    alpha = 0.0;
                }
            }
            default: { // Range thresholding (mode 0): hide values INSIDE [low, high]
                if (raw_value >= layer.thresh_low && raw_value <= layer.thresh_high) {
                    alpha = 0.0;
                }
            }
        }
    }
    
    // DEBUG: Uncomment to verify this shader is being used
    // return vec4<f32>(0.0, 1.0, 0.0, 1.0); // Should show green screen
    
    // Apply colormap
    let lut_coord = vec2<f32>(intensity_norm, 0.5);
    let rgb_color = textureSample(colormapLutTexture, samplerLinear, lut_coord, i32(layer.colormap_id)).rgb;
    
    return vec4<f32>(rgb_color, alpha);
}

// Toggleable debug mode: when set to 1u, each layer is rendered
// as a flat tint color instead of sampling the volume data.
// This is used for debugging layer compositing only.
const SLICE_TINT_DEBUG_MODE: u32 = 0u; // 0u = normal sampling, 1u = tint debug

// Toggleable debug: when set to 1u, thresholding is disabled
// and layer alpha is taken directly from layer.opacity.
// This is used to verify whether threshold logic hides layers.
const SLICE_DISABLE_THRESHOLD_DEBUG: u32 = 0u; // 0u = normal thresholding, 1u = disable

fn debugLayerTint(index: u32) -> vec4<f32> {
    let alpha = 0.6;
    if (index == 0u) {
        // Bottom layer: green
        return vec4<f32>(0.0, 1.0, 0.0, alpha);
    } else if (index == 1u) {
        // Second layer: red
        return vec4<f32>(1.0, 0.0, 0.0, alpha);
    } else if (index == 2u) {
        // Third layer: blue
        return vec4<f32>(0.0, 0.0, 1.0, alpha);
    } else {
        // Additional layers: magenta
        return vec4<f32>(1.0, 0.0, 1.0, alpha);
    }
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
    let world_mm = input.world_mm;

    // Debug mode 2: bypass geometry and sample the center of a single volume
    // directly in texture space to verify that the texture bound at
    // SLICE_DEBUG_TEXTURE_INDEX contains non-zero data and is sampled correctly.
    if (SLICE_DEBUG_MODE == 2u) {
        let tex_coord = vec3<f32>(0.5, 0.5, 0.5);
        let raw_value = sampleVolumeTexture(SLICE_DEBUG_TEXTURE_INDEX, tex_coord, 1u);
        let val = clamp(raw_value, 0.0, 1.0);
        return vec4<f32>(val, val, val, 1.0);
    }

    var final_color = vec4<f32>(0.0, 0.0, 0.0, 0.0);
    
    // Composite all active layers
    for (var i: u32 = 0u; i < layer_metadata.active_count; i = i + 1u) {
        let layer = layer_data[i];
        var layer_color: vec4<f32>;
        if (SLICE_TINT_DEBUG_MODE == 1u) {
            // Debug mode: ignore voxel data, use flat tints per layer index
            layer_color = debugLayerTint(i);
        } else {
            // Normal mode: sample the volume and apply colormap/thresholding
            layer_color = sampleLayer(layer, world_mm);
        }
        final_color = composite(final_color, layer_color, layer.blend_mode);
    }
    
    // Draw crosshair if enabled
    if (crosshair.show_crosshair == 1u) {
        let crosshair_color = vec4<f32>(0.0, 1.0, 0.0, 0.8); // Green
        
        // Calculate pixel size in world space (guard against division by zero)
        let pixel_size_x = length(frame.u_mm.xyz) / max(f32(frame.target_dim.x), 1.0);
        let pixel_size_y = length(frame.v_mm.xyz) / max(f32(frame.target_dim.y), 1.0);
        
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
