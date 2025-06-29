// Simplified version of slice.wgsl that bypasses colormap
// This helps debug if the issue is in colormap lookup

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
    @location(1) clip_uv: vec2<f32>, // DEBUG: pass clip coordinates
};

// --- Vertex Shader ---
@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VsOut {
    var clip_uv: vec2<f32>;
    if (vid == 0u) {
        clip_uv = vec2<f32>(-1.0, -1.0);
    } else if (vid == 1u) {
        clip_uv = vec2<f32>( 1.0, -1.0);
    } else if (vid == 2u) {
        clip_uv = vec2<f32>(-1.0,  1.0);
    } else if (vid == 3u) {
        clip_uv = vec2<f32>(-1.0,  1.0);
    } else if (vid == 4u) {
        clip_uv = vec2<f32>( 1.0, -1.0);
    } else {
        clip_uv = vec2<f32>( 1.0,  1.0);
    }

    let world_pos_h = frame.origin_mm + clip_uv.x * frame.u_mm + clip_uv.y * frame.v_mm;

    var output : VsOut;
    output.clip_position = vec4<f32>(clip_uv, 0.0, 1.0);
    output.world_mm = world_pos_h.xyz;
    output.clip_uv = clip_uv; // DEBUG: pass clip coordinates
    return output;
}

// --- Simplified Fragment Shader ---
@fragment
fn fs_main(input: VsOut) -> @location(0) vec4<f32> {
    var final_color = vec4<f32>(0.0, 0.0, 0.0, 0.0);
    
    for (var i: u32 = 0u; i < activeLayerCount; i = i + 1u) {
        let layer = layerUBOs[i];
        
        // Transform to voxel coordinates
        let voxel_coord_h = layer.world_to_voxel * vec4<f32>(input.world_mm, 1.0);
        if (voxel_coord_h.w <= 0.0) { continue; }
        let voxel_coord = voxel_coord_h.xyz / voxel_coord_h.w;
        
        // Check bounds
        if (any(voxel_coord < vec3<f32>(0.0)) || any(voxel_coord >= vec3<f32>(layer.dim))) {
            continue;
        }
        
        // Use textureLoad for exact texel access (avoids filtering issues)
        let ivoxel = vec3<i32>(round(voxel_coord));
        if (any(ivoxel < vec3<i32>(0)) || any(ivoxel >= vec3<i32>(layer.dim))) {
            continue;
        }
        
        let raw_value = textureLoad(volumeTexture, ivoxel, 0).r;
        
        // Window/Level
        let intensity_delta = max(layer.intensity_max - layer.intensity_min, 1e-6);
        let intensity_norm = clamp((raw_value - layer.intensity_min) / intensity_delta, 0.0, 1.0);
        
        // Simple threshold check
        if (raw_value < layer.thresh_low || raw_value > layer.thresh_high) {
            continue;
        }
        
        // BYPASS COLORMAP - just use grayscale
        let gray = intensity_norm;
        let layer_color = vec4<f32>(gray, gray, gray, layer.opacity);
        
        // Simple alpha blending
        final_color = final_color + layer_color * (1.0 - final_color.a);
    }
    
    return final_color;
}