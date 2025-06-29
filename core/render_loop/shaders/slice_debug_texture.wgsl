// Debug shader to test actual texture sampling
// This will sample the 3D texture and show raw values

// --- Frame Uniform Buffer Object (UBO) ---
struct FrameUbo {
    origin_mm : vec4<f32>,
    u_mm      : vec4<f32>,
    v_mm      : vec4<f32>,
    atlas_dim : vec3<u32>,
    _padding  : u32,
};

// --- Crosshair UBO ---
struct CrosshairUbo {
    world_position: vec3<f32>,
};

// --- View Plane UBO ---
struct ViewPlaneUbo {
    plane_id : u32,
    _padding : vec3<u32>,
};

// --- Per-Layer UBO ---
struct LayerUBO {
    world_to_voxel : mat4x4<f32>,
    texture_coords : vec4<f32>,
    dim            : vec3<u32>,
    padSlices      : u32,
    colormap_id    : u32,
    blend_mode     : u32,
    layer_index    : u32,
    threshold_mode : u32,
    opacity        : f32,
    intensity_min  : f32,
    intensity_max  : f32,
    thresh_low     : f32,
    thresh_high    : f32,
};

// --- Bind Groups ---
@group(0) @binding(0) var<uniform> frame: FrameUbo;
@group(0) @binding(1) var<uniform> crosshair: CrosshairUbo;
@group(0) @binding(2) var<uniform> viewPlane: ViewPlaneUbo;

@group(1) @binding(0) var<uniform> layerUBOs : array<LayerUBO, 8>;
@group(1) @binding(1) var<uniform> activeLayerCount : u32;

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
    var clip_uv: vec2<f32>;
    switch (vid) {
        case 0u: { clip_uv = vec2<f32>(-1.0, -1.0); }
        case 1u: { clip_uv = vec2<f32>( 1.0, -1.0); }
        case 2u: { clip_uv = vec2<f32>(-1.0,  1.0); }
        case 3u: { clip_uv = vec2<f32>(-1.0,  1.0); }
        case 4u: { clip_uv = vec2<f32>( 1.0, -1.0); }
        default: { clip_uv = vec2<f32>( 1.0,  1.0); }
    }

    let world_pos_h = frame.origin_mm + clip_uv.x * frame.u_mm + clip_uv.y * frame.v_mm;

    var output : VsOut;
    output.clip_position = vec4<f32>(clip_uv, 0.0, 1.0);
    output.world_mm = world_pos_h.xyz;
    return output;
}

// --- Debug Fragment Shader ---
@fragment
fn fs_main(input: VsOut) -> @location(0) vec4<f32> {
    if (activeLayerCount == 0u) {
        return vec4<f32>(1.0, 0.0, 1.0, 1.0); // Magenta = no layers
    }
    
    let layer = layerUBOs[0];
    
    // Transform world to voxel
    let voxel_coord_h = layer.world_to_voxel * vec4<f32>(input.world_mm, 1.0);
    if (voxel_coord_h.w <= 0.0) {
        return vec4<f32>(1.0, 1.0, 0.0, 1.0); // Yellow = bad W
    }
    
    let voxel_coord = voxel_coord_h.xyz / voxel_coord_h.w;
    
    // Check bounds
    if (any(voxel_coord < vec3<f32>(0.0)) || any(voxel_coord >= vec3<f32>(layer.dim))) {
        return vec4<f32>(0.3, 0.0, 0.0, 1.0); // Dark red = outside bounds
    }
    
    // Normalize to texture coordinates [0,1]
    let normalized_coord = voxel_coord / vec3<f32>(layer.dim);
    
    // Scale by volume/atlas ratio
    let atlas_scale_factor = vec3<f32>(layer.dim) / vec3<f32>(frame.atlas_dim);
    let final_coord = normalized_coord * atlas_scale_factor;
    
    // Sample the texture
    let raw_value = textureSample(volumeTexture, samplerLinear, final_coord).r;
    
    // Visualize the raw value directly
    // Map data range to 0-1 for visualization
    let intensity_delta = layer.intensity_max - layer.intensity_min;
    let normalized_intensity = (raw_value - layer.intensity_min) / intensity_delta;
    
    // Show as grayscale
    return vec4<f32>(normalized_intensity, normalized_intensity, normalized_intensity, 1.0);
}