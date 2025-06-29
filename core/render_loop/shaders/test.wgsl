// Test shader for verifying shader compilation with wgpu 0.20
// Simple 2D triangle with color interpolation

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) color: vec3<f32>,
}

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VertexOutput {
    // Triangle vertices in clip space
    var position: vec2<f32>;
    var color: vec3<f32>;
    
    if (vid == 0u) {
        position = vec2<f32>(-0.5, -0.5);
        color = vec3<f32>(1.0, 0.0, 0.0); // Red
    } else if (vid == 1u) {
        position = vec2<f32>( 0.5, -0.5);
        color = vec3<f32>(0.0, 1.0, 0.0); // Green
    } else {
        position = vec2<f32>( 0.0,  0.5);
        color = vec3<f32>(0.0, 0.0, 1.0);  // Blue
    }
    
    var out: VertexOutput;
    out.clip_position = vec4<f32>(position, 0.0, 1.0);
    out.color = color;
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    return vec4<f32>(in.color, 1.0);
}