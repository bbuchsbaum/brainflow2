// Debug version 3: Sample texture and show raw values
// This shader samples the 3D texture and outputs raw intensity values

// --- Frame Uniform Buffer Object (UBO) ---
struct FrameUbo {
    origin_mm : vec4<f32>,
    u_mm      : vec4<f32>,
    v_mm      : vec4<f32>,
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
        case 3u: { clip_uv = vec2<f32>( 1.0,  1.0); }
        case 4u: { clip_uv = vec2<f32>(-1.0,  1.0); }
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
    // Check if we have any active layers
    if (activeLayerCount == 0u) {
        return vec4<f32>(1.0, 1.0, 0.0, 1.0); // Yellow = no active layers
    }
    
    // Get first layer
    let layer = layerUBOs[0];
    
    // Transform world to voxel coordinates
    let voxel_coord_h = layer.world_to_voxel * vec4<f32>(input.world_mm, 1.0);
    if (voxel_coord_h.w <= 0.0) { 
        return vec4<f32>(0.0, 0.0, 1.0, 1.0); // Blue = W problem
    }
    let voxel_coord = voxel_coord_h.xyz / voxel_coord_h.w;
    
    // Check bounds
    if (any(voxel_coord < vec3<f32>(0.0)) || any(voxel_coord >= vec3<f32>(layer.dim))) {
        return vec4<f32>(1.0, 0.0, 0.0, 1.0); // Red = out of bounds
    }
    
    // Normalize voxel coordinates for texture sampling
    let normalized_coord = voxel_coord / vec3<f32>(layer.dim);
    
    // Sample the 3D texture
    let raw_value = textureSample(volumeTexture, samplerLinear, normalized_coord).r;
    
    // Output raw value as grayscale
    // Also show some debug info in other channels:
    // R = raw texture value
    // G = layer opacity
    // B = intensity_min to intensity_max range indicator
    var range_indicator: f32 = 0.0;
    if ((layer.intensity_max - layer.intensity_min) > 0.1) {
        range_indicator = 1.0;
    }
    
    return vec4<f32>(raw_value, layer.opacity, range_indicator, 1.0);
}