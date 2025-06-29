// Debug version of slice.wgsl to help diagnose rendering issues
// This shader visualizes intermediate values as colors

// --- Frame Uniform Buffer Object (UBO) ---
struct FrameUbo {
    origin_mm : vec4<f32>,   // Plane center in world mm (homogeneous, w = 1)
    u_mm      : vec4<f32>,   // World vector mapping to clip space +X (vector, w = 0)
    v_mm      : vec4<f32>,   // World vector mapping to clip space +Y (vector, w = 0)
    atlas_dim : vec3<u32>,   // Dimensions of the 3D texture atlas
    _padding  : u32,         // Padding to maintain alignment
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
    // Generate simple full-screen quad vertices
    var clip_uv: vec2<f32>;
    switch (vid) {
        case 0u: { clip_uv = vec2<f32>(-1.0, -1.0); }  // Bottom-left
        case 1u: { clip_uv = vec2<f32>( 1.0, -1.0); }  // Bottom-right
        case 2u: { clip_uv = vec2<f32>(-1.0,  1.0); }  // Top-left
        case 3u: { clip_uv = vec2<f32>(-1.0,  1.0); }  // Top-left
        case 4u: { clip_uv = vec2<f32>( 1.0, -1.0); }  // Bottom-right
        default: { clip_uv = vec2<f32>( 1.0,  1.0); }  // Top-right
    }

    // Calculate world position using FrameUbo
    let world_pos_h = frame.origin_mm + clip_uv.x * frame.u_mm + clip_uv.y * frame.v_mm;

    var output : VsOut;
    output.clip_position = vec4<f32>(clip_uv, 0.0, 1.0);
    output.world_mm = world_pos_h.xyz;
    return output;
}

// --- Debug Fragment Shader ---
@fragment
fn fs_main(input: VsOut) -> @location(0) vec4<f32> {
    // DEBUG MODE 1: Visualize world coordinates
    // Divide by 100.0 instead of 64.0 to see if we get ANY variation
    let normalized_world = input.world_mm / 100.0;
    
    // Output world X as red, Y as green, Z as blue
    // This should show a gradient if FrameUbo is working
    return vec4<f32>(normalized_world.x, normalized_world.y, normalized_world.z, 1.0);
}