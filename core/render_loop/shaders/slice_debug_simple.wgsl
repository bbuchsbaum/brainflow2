// Ultra-simple debug shader to verify pipeline is working
// This shader outputs a gradient based on screen position, not world coordinates

struct VsOut {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) screen_uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VsOut {
    // Generate simple full-screen quad vertices
    var clip_uv: vec2<f32>;
    switch (vid) {
        case 0u: { clip_uv = vec2<f32>(-1.0, -1.0); }
        case 1u: { clip_uv = vec2<f32>( 1.0, -1.0); }
        case 2u: { clip_uv = vec2<f32>(-1.0,  1.0); }
        case 3u: { clip_uv = vec2<f32>( 1.0,  1.0); }
        case 4u: { clip_uv = vec2<f32>(-1.0,  1.0); }
        default: { clip_uv = vec2<f32>( 1.0,  1.0); }
    }

    var output : VsOut;
    output.clip_position = vec4<f32>(clip_uv, 0.0, 1.0);
    // Convert from clip space (-1 to 1) to UV space (0 to 1)
    output.screen_uv = (clip_uv + vec2(1.0)) * 0.5;
    return output;
}

@fragment
fn fs_main(input: VsOut) -> @location(0) vec4<f32> {
    // Output a simple gradient based on screen position
    // Red = horizontal position (0 to 1 from left to right)
    // Green = vertical position (0 to 1 from bottom to top)
    // Blue = 0.5 (constant)
    // This should ALWAYS show a gradient if the pipeline is working
    return vec4<f32>(input.screen_uv.x, input.screen_uv.y, 0.5, 1.0);
}