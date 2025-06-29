// Debug version 2: Check if voxel coordinates are in bounds
// This shader visualizes the bounds check results

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
        // Out of bounds - show which dimension failed
        var color = vec3<f32>(0.0);
        if (voxel_coord.x < 0.0 || voxel_coord.x >= f32(layer.dim.x)) { color.r = 1.0; }
        if (voxel_coord.y < 0.0 || voxel_coord.y >= f32(layer.dim.y)) { color.g = 1.0; }
        if (voxel_coord.z < 0.0 || voxel_coord.z >= f32(layer.dim.z)) { color.b = 1.0; }
        return vec4<f32>(color, 1.0); // Red/Green/Blue = X/Y/Z out of bounds
    }
    
    // In bounds - show voxel coordinates as color
    let normalized_voxel = voxel_coord / vec3<f32>(layer.dim);
    return vec4<f32>(normalized_voxel, 1.0);
}