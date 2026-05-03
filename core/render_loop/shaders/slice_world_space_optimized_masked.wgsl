// Optimized world-space slice shader with multi-resolution performance improvements
// Key optimizations:
// - Early exit for transparent regions
// - LOD-based sampling for better cache coherence
// - Vectorized bounds checking
// - Reduced branching in sampling paths

// Helper functions - WGSL doesn't have saturate() built-in
fn saturate(x: f32) -> f32 {
    return clamp(x, 0.0, 1.0);
}

fn saturate3(v: vec3<f32>) -> vec3<f32> {
    return clamp(v, vec3<f32>(0.0), vec3<f32>(1.0));
}

// --- Frame Uniform Buffer Object (UBO) ---
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
    crosshair_color: vec4<f32>,
};

// --- Per-Layer Storage Buffer ---
// This MUST match the Rust LayerUboStd140 struct exactly (total size: 160 bytes).
struct LayerData {
    // --- 16-byte aligned types first ---
    world_to_voxel : mat4x4<f32>,      // 64 bytes, offset 0
    texture_coords : vec4<f32>,        // 16 bytes, offset 64
    
    // --- Volume info with explicit padding ---
    dim            : vec3<u32>,        // 12 bytes, offset 80
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

    // --- Display options ---
    drawSliceBorder : u32,             // 4 bytes, offset 144
    borderThicknessPx : f32,           // 4 bytes, offset 148
    layer_mode      : u32,             // 4 bytes, offset 152 (0=scalar, 1=label, 2=mask)
    _padOpt1        : u32,             // 4 bytes, offset 156
    // Total struct size: 160 bytes (matches Rust LayerUboStd140)
};

// --- Layer metadata ---
struct LayerMetadata {
    active_count: u32,
    _padding: vec3<u32>,
};

// --- Optional slice feature uniforms ---
// Bound once at group 3 so new orthogonal slice features do not grow LayerData.
struct SliceFeatureUbo {
    outline_enabled: u32,
    outline_layer_index: u32,
    selected_label_id: u32,
    _pad0: u32,
    outline_color: vec4<f32>,
    outline_thickness_px: f32,
    _pad1_x: f32,
    _pad1_y: f32,
    _pad1_z: f32,
};

const LAYER_MODE_SCALAR: u32 = 0u;
const LAYER_MODE_LABEL: u32 = 1u;
const LAYER_MODE_MASK: u32 = 2u;

// --- Bind Group 0: Per-Frame Globals ---
@group(0) @binding(0) var<uniform> frame: FrameUbo;
@group(0) @binding(1) var<uniform> crosshair: CrosshairUbo;

// --- Bind Group 1: Layer Data (Storage Buffers) ---
@group(1) @binding(0) var<storage, read> layer_data: array<LayerData>;
@group(1) @binding(1) var<uniform> layer_metadata: LayerMetadata;

// --- Bind Group 2: Textures & Samplers ---
// Support up to 13 volume textures and matching masks
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

@group(2) @binding(13) var maskTexture0: texture_3d<f32>;
@group(2) @binding(14) var maskTexture1: texture_3d<f32>;
@group(2) @binding(15) var maskTexture2: texture_3d<f32>;
@group(2) @binding(16) var maskTexture3: texture_3d<f32>;
@group(2) @binding(17) var maskTexture4: texture_3d<f32>;
@group(2) @binding(18) var maskTexture5: texture_3d<f32>;
@group(2) @binding(19) var maskTexture6: texture_3d<f32>;
@group(2) @binding(20) var maskTexture7: texture_3d<f32>;
@group(2) @binding(21) var maskTexture8: texture_3d<f32>;
@group(2) @binding(22) var maskTexture9: texture_3d<f32>;
@group(2) @binding(23) var maskTexture10: texture_3d<f32>;
@group(2) @binding(24) var maskTexture11: texture_3d<f32>;
@group(2) @binding(25) var maskTexture12: texture_3d<f32>;

@group(2) @binding(26) var samplerLinear: sampler;
@group(2) @binding(27) var colormapLutTexture: texture_2d_array<f32>;
@group(2) @binding(28) var samplerNearest: sampler;

// --- Bind Group 3: Optional Feature Uniforms ---
@group(3) @binding(0) var<uniform> slice_features: SliceFeatureUbo;

// --- Vertex Shader Output ---
struct VsOut {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) world_mm: vec3<f32>,
    @location(1) @interpolate(flat) pixel_size: f32, // Precompute for fragment shader
};

// --- Vertex Shader ---
@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VsOut {
    // Generate full-screen quad vertices in NDC space [0, 1]
    let vertex_id = vid % 6u;
    let x = f32((vertex_id & 1u) ^ ((vertex_id >> 2u) & 1u));
    let y = f32((vertex_id >> 1u) & 1u);
    let ndc = vec2<f32>(x, y);
    
    // Convert to clip space [-1, 1]
    let clip_pos = ndc * 2.0 - 1.0;
    
    // Calculate world position using frame
    let world_pos = frame.origin_mm + ndc.x * frame.u_mm + ndc.y * frame.v_mm;
    
    // Precompute pixel size for LOD calculations
    let pixel_size = max(
        length(frame.u_mm.xyz) / f32(frame.target_dim.x),
        length(frame.v_mm.xyz) / f32(frame.target_dim.y)
    );
    
    var output: VsOut;
    output.clip_position = vec4<f32>(clip_pos, 0.0, 1.0);
    output.world_mm = world_pos.xyz;
    output.pixel_size = pixel_size;
    return output;
}

// --- Fragment Shader Helpers ---

// Optimized texture sampling with LOD support and interpolation mode
fn sampleVolumeTextureOptimized(texture_index: u32, coord: vec3<f32>, lod: f32, interpolation_mode: u32) -> f32 {
    // Select sampler based on interpolation mode
    // 0 = nearest, 1 = linear, 2+ = linear (future cubic will fallback to linear)
    if (interpolation_mode == 0u) {
        // Use nearest neighbor sampling
        switch (texture_index) {
            case 0u: { return textureSampleLevel(volumeTexture0, samplerNearest, coord, lod).r; }
            case 1u: { return textureSampleLevel(volumeTexture1, samplerNearest, coord, lod).r; }
            case 2u: { return textureSampleLevel(volumeTexture2, samplerNearest, coord, lod).r; }
            case 3u: { return textureSampleLevel(volumeTexture3, samplerNearest, coord, lod).r; }
            case 4u: { return textureSampleLevel(volumeTexture4, samplerNearest, coord, lod).r; }
            case 5u: { return textureSampleLevel(volumeTexture5, samplerNearest, coord, lod).r; }
            case 6u: { return textureSampleLevel(volumeTexture6, samplerNearest, coord, lod).r; }
            case 7u: { return textureSampleLevel(volumeTexture7, samplerNearest, coord, lod).r; }
            case 8u: { return textureSampleLevel(volumeTexture8, samplerNearest, coord, lod).r; }
            case 9u: { return textureSampleLevel(volumeTexture9, samplerNearest, coord, lod).r; }
            case 10u: { return textureSampleLevel(volumeTexture10, samplerNearest, coord, lod).r; }
            case 11u: { return textureSampleLevel(volumeTexture11, samplerNearest, coord, lod).r; }
            case 12u: { return textureSampleLevel(volumeTexture12, samplerNearest, coord, lod).r; }
            default: { return 0.0; }
        }
    } else {
        // Use linear sampling (default)
        switch (texture_index) {
            case 0u: { return textureSampleLevel(volumeTexture0, samplerLinear, coord, lod).r; }
            case 1u: { return textureSampleLevel(volumeTexture1, samplerLinear, coord, lod).r; }
            case 2u: { return textureSampleLevel(volumeTexture2, samplerLinear, coord, lod).r; }
            case 3u: { return textureSampleLevel(volumeTexture3, samplerLinear, coord, lod).r; }
            case 4u: { return textureSampleLevel(volumeTexture4, samplerLinear, coord, lod).r; }
            case 5u: { return textureSampleLevel(volumeTexture5, samplerLinear, coord, lod).r; }
            case 6u: { return textureSampleLevel(volumeTexture6, samplerLinear, coord, lod).r; }
            case 7u: { return textureSampleLevel(volumeTexture7, samplerLinear, coord, lod).r; }
            case 8u: { return textureSampleLevel(volumeTexture8, samplerLinear, coord, lod).r; }
            case 9u: { return textureSampleLevel(volumeTexture9, samplerLinear, coord, lod).r; }
            case 10u: { return textureSampleLevel(volumeTexture10, samplerLinear, coord, lod).r; }
            case 11u: { return textureSampleLevel(volumeTexture11, samplerLinear, coord, lod).r; }
        case 12u: { return textureSampleLevel(volumeTexture12, samplerLinear, coord, lod).r; }
        default: { return 0.0; }
    }
}
}

fn sampleMaskTexture(texture_index: u32, coord: vec3<f32>) -> f32 {
    switch (texture_index) {
        case 0u: { return textureSampleLevel(maskTexture0, samplerNearest, coord, 0.0).r; }
        case 1u: { return textureSampleLevel(maskTexture1, samplerNearest, coord, 0.0).r; }
        case 2u: { return textureSampleLevel(maskTexture2, samplerNearest, coord, 0.0).r; }
        case 3u: { return textureSampleLevel(maskTexture3, samplerNearest, coord, 0.0).r; }
        case 4u: { return textureSampleLevel(maskTexture4, samplerNearest, coord, 0.0).r; }
        case 5u: { return textureSampleLevel(maskTexture5, samplerNearest, coord, 0.0).r; }
        case 6u: { return textureSampleLevel(maskTexture6, samplerNearest, coord, 0.0).r; }
        case 7u: { return textureSampleLevel(maskTexture7, samplerNearest, coord, 0.0).r; }
        case 8u: { return textureSampleLevel(maskTexture8, samplerNearest, coord, 0.0).r; }
        case 9u: { return textureSampleLevel(maskTexture9, samplerNearest, coord, 0.0).r; }
        case 10u: { return textureSampleLevel(maskTexture10, samplerNearest, coord, 0.0).r; }
        case 11u: { return textureSampleLevel(maskTexture11, samplerNearest, coord, 0.0).r; }
        case 12u: { return textureSampleLevel(maskTexture12, samplerNearest, coord, 0.0).r; }
        default: { return 1.0; }
    }
}

fn sampleLayerLabelIdOptimized(layer: LayerData, world_mm: vec3<f32>) -> u32 {
    let voxel_coord_h = layer.world_to_voxel * vec4<f32>(world_mm, 1.0);
    if (voxel_coord_h.w <= 0.0) { return 0u; }

    let voxel_coord = voxel_coord_h.xyz / voxel_coord_h.w;
    let dim_f = vec3<f32>(layer.dim);
    if (any(voxel_coord < vec3<f32>(0.0)) || any(voxel_coord >= dim_f)) {
        return 0u;
    }

    let tex_coord = voxel_coord / dim_f;
    let raw_value = sampleVolumeTextureOptimized(layer.texture_index, tex_coord, 0.0, 0u);
    return u32(max(round(raw_value), 0.0));
}

fn sampleSelectedLabelOutlineOptimized(layer: LayerData, world_mm: vec3<f32>) -> vec4<f32> {
    if (slice_features.outline_enabled == 0u || layer.layer_mode != LAYER_MODE_LABEL) {
        return vec4<f32>(0.0);
    }

    let selected_label = slice_features.selected_label_id;
    if (selected_label == 0u) {
        return vec4<f32>(0.0);
    }

    let center_label = sampleLayerLabelIdOptimized(layer, world_mm);
    if (center_label != selected_label) {
        return vec4<f32>(0.0);
    }

    let thickness_px = max(slice_features.outline_thickness_px, 1.0);
    let du = frame.u_mm.xyz / max(f32(frame.target_dim.x), 1.0) * thickness_px;
    let dv = frame.v_mm.xyz / max(f32(frame.target_dim.y), 1.0) * thickness_px;

    let neighbor_differs =
        sampleLayerLabelIdOptimized(layer, world_mm + du) != selected_label ||
        sampleLayerLabelIdOptimized(layer, world_mm - du) != selected_label ||
        sampleLayerLabelIdOptimized(layer, world_mm + dv) != selected_label ||
        sampleLayerLabelIdOptimized(layer, world_mm - dv) != selected_label;

    if (neighbor_differs) {
        return slice_features.outline_color;
    }

    return vec4<f32>(0.0);
}

// Optimized layer sampling with early exit
fn sampleLayerOptimized(layer: LayerData, world_mm: vec3<f32>, pixel_size: f32) -> vec4<f32> {
    // Early exit if layer is fully transparent
    if (layer.opacity <= 0.0) { 
        return vec4<f32>(0.0); 
    }
    
    // Transform world to voxel coordinates
    let voxel_coord_h = layer.world_to_voxel * vec4<f32>(world_mm, 1.0);
    let w = voxel_coord_h.w;
    
    // Early exit for invalid homogeneous coordinate
    if (w <= 0.0) { 
        return vec4<f32>(0.0); 
    }
    
    let voxel_coord = voxel_coord_h.xyz / w;
    
    // Vectorized bounds check
    let dim_f = vec3<f32>(layer.dim);
    let in_bounds = all(voxel_coord >= vec3<f32>(0.0)) && all(voxel_coord < dim_f);
    if (!in_bounds) {
        return vec4<f32>(0.0);
    }
    
    // Convert to texture coordinates
    let tex_coord = voxel_coord / dim_f;
    
    // Calculate LOD based on pixel size
    // Estimate voxel size as 1.0 for now (could be calculated from transform)
    let voxel_size_estimate = 1.0;
    // DISABLED LOD for debugging - use 0.0 to match standard shader
    let lod = 0.0; // log2(max(1.0, pixel_size / max(voxel_size_estimate, 1e-6)));
    
    // Optional border overlay (per-layer)
    if (layer.drawSliceBorder == 1u) {
        let t_u = layer.borderThicknessPx / f32(frame.target_dim.x);
        let t_v = layer.borderThicknessPx / f32(frame.target_dim.y);
        let near_edge = tex_coord.x <= t_u || tex_coord.x >= (1.0 - t_u) ||
                        tex_coord.y <= t_v || tex_coord.y >= (1.0 - t_v);
        if (near_edge) {
            // Draw white border; alpha scaled by layer opacity
            return vec4<f32>(1.0, 1.0, 1.0, layer.opacity);
        }
    }

    // Label and mask layers must not interpolate categorical/binary IDs.
    let force_nearest = layer.layer_mode == LAYER_MODE_LABEL ||
                        layer.layer_mode == LAYER_MODE_MASK ||
                        layer.is_mask == 1u;
    let interpolation_mode = select(layer.interpolation_mode, 0u, force_nearest);
    let raw_sample = sampleVolumeTextureOptimized(layer.texture_index, tex_coord, lod, interpolation_mode);
    // Label mode treats samples as integer IDs for thresholding and palette lookup.
    let raw_value = select(raw_sample, round(raw_sample), layer.layer_mode == LAYER_MODE_LABEL);
    
    // Fast path for binary masks
    if (layer.is_mask == 1u || layer.layer_mode == LAYER_MODE_MASK) {
        let alpha = select(0.0, layer.opacity, raw_value > 0.1);
        return vec4<f32>(1.0, 1.0, 1.0, alpha);
    }
    
    // Calculate intensity normalization
    let intensity_delta = max(layer.intensity_max - layer.intensity_min, 1e-9);
    let intensity_norm = saturate((raw_value - layer.intensity_min) / intensity_delta);
    
    // Optimized thresholding with reduced branching
    var alpha = layer.opacity;
    
    // Use select() to avoid branching where possible
    if (layer.threshold_mode == 0u) {
        // Range mode (mode 0): hide samples inside the inclusive window so only
        // the “extremes” render, matching the legacy UI semantics.
        let within_range = raw_value >= layer.thresh_low && raw_value <= layer.thresh_high;
        alpha = select(alpha, 0.0, within_range);
        
        // DEBUG: Visualize threshold behavior
        // return vec4<f32>(within_range ? 1.0 : 0.0, 0.0, 0.0, 1.0);
    } else if (layer.threshold_mode == 1u) { // Absolute value range
        let abs_value = abs(raw_value);
        let within_abs_range = abs_value >= layer.thresh_low && abs_value <= layer.thresh_high;
        alpha = select(alpha, 0.0, within_abs_range);
    } else if (layer.threshold_mode == 2u) { // Above
        alpha = select(0.0, alpha, raw_value >= layer.thresh_low);
    } else { // Below
        alpha = select(0.0, alpha, raw_value <= layer.thresh_high);
    }

    if (layer.has_alpha_mask == 1u) {
        let mask_value = sampleMaskTexture(layer.texture_index, tex_coord);
        if (mask_value <= 0.0) {
            return vec4<f32>(0.0);
        }
        alpha *= mask_value;
    }
    
    // Early exit if transparent after thresholding
    if (alpha <= 0.0) {
        return vec4<f32>(0.0);
    }
    
    // DEBUG: Uncomment to verify shader is being used  
    // return vec4<f32>(1.0, 0.0, 0.0, 1.0); // Should show red screen
    
    // Apply colormap
    let lut_coord = vec2<f32>(intensity_norm, 0.5);
    let rgb_color = textureSample(colormapLutTexture, samplerLinear, lut_coord, i32(layer.colormap_id)).rgb;
    
    return vec4<f32>(rgb_color, alpha);
}

// Optimized compositing with early exit
fn compositeOptimized(dst: vec4<f32>, src: vec4<f32>, mode: u32) -> vec4<f32> {
    // Early exit for transparent source
    if (src.a <= 0.0) { 
        return dst; 
    }
    
    // Early exit for opaque source with normal blending
    if (src.a >= 1.0 && mode == 0u) {
        return src;
    }
    
    // Optimized blending modes
    if (mode == 0u) { // Alpha blending (most common)
        let out_alpha = src.a + dst.a * (1.0 - src.a);
        let inv_src_a = 1.0 - src.a;
        let out_rgb = src.rgb * src.a + dst.rgb * dst.a * inv_src_a;
        return vec4<f32>(out_rgb / max(out_alpha, 0.00001), out_alpha);
    } else if (mode == 1u) { // Additive
        return vec4<f32>(saturate3(dst.rgb + src.rgb * src.a), max(dst.a, src.a));
    } else if (mode == 2u) { // Max
        return vec4<f32>(max(dst.rgb, src.rgb), max(dst.a, src.a));
    } else { // Min
        return vec4<f32>(min(dst.rgb, src.rgb), max(dst.a, src.a));
    }
}

// Optimized crosshair drawing
fn drawCrosshairOptimized(world_mm: vec3<f32>, pixel_size: f32) -> vec4<f32> {
    let dist = abs(world_mm - crosshair.world_position);
    let thickness = pixel_size;
    
    // Calculate frame normal for visibility
    let normal = normalize(cross(frame.u_mm.xyz, frame.v_mm.xyz));
    let abs_normal = abs(normal);
    
    // Optimized visibility and distance check
    let x_visible = abs_normal.x < 0.9 && dist.x < thickness && max(dist.y, dist.z) < thickness * 20.0;
    let y_visible = abs_normal.y < 0.9 && dist.y < thickness && max(dist.x, dist.z) < thickness * 20.0;
    let z_visible = abs_normal.z < 0.9 && dist.z < thickness && max(dist.x, dist.y) < thickness * 20.0;
    
    if (x_visible || y_visible || z_visible) {
        return crosshair.crosshair_color;
    }

    return vec4<f32>(0.0);
}

// --- Optimized Fragment Shader ---
@fragment
fn fs_main(input: VsOut) -> @location(0) vec4<f32> {
    var final_color = vec4<f32>(0.0);
    let world_mm = input.world_mm;
    let pixel_size = input.pixel_size;
    
    // Composite all active layers with optimizations
    let layer_count = min(layer_metadata.active_count, 13u); // Ensure we don't exceed texture count (13 volume textures)
    
    for (var i: u32 = 0u; i < layer_count; i = i + 1u) {
        let layer = layer_data[i];
        let layer_color = sampleLayerOptimized(layer, world_mm, pixel_size);
        // NOTE: We render layers in Back-to-Front order (bottom → top),
        // so an opaque bottom layer must NOT short-circuit the loop.
        // Early-exit is only valid for Front-to-Back compositing.
        final_color = compositeOptimized(final_color, layer_color, layer.blend_mode);

        if (slice_features.outline_enabled == 1u && i == slice_features.outline_layer_index) {
            let outline_color = sampleSelectedLabelOutlineOptimized(layer, world_mm);
            final_color = compositeOptimized(final_color, outline_color, 0u);
        }
    }
    
    // Draw crosshair if enabled
    if (crosshair.show_crosshair == 1u) {
        let crosshair_color = drawCrosshairOptimized(world_mm, pixel_size);
        if (crosshair_color.a > 0.0) {
            final_color = compositeOptimized(final_color, crosshair_color, 0u);
        }
    }
    
    return final_color;
}
