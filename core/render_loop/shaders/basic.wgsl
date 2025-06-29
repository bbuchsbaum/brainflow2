// Basic Passthrough Vertex Shader
@vertex
fn vs_main(@builtin(vertex_index) in_vertex_index: u32) -> @builtin(position) vec4<f32> {
    // Simple triangle covering the screen (Normalized Device Coordinates)
    var pos: vec2<f32>;
    if (in_vertex_index == 0u) {
        pos = vec2<f32>(-1.0, -1.0);
    } else if (in_vertex_index == 1u) {
        pos = vec2<f32>( 3.0, -1.0);
    } else {
        pos = vec2<f32>(-1.0,  3.0);
    }
    return vec4<f32>(pos, 0.0, 1.0);
}

// Basic Fragment Shader (Outputs solid color)
@fragment
fn fs_main() -> @location(0) vec4<f32> {
    return vec4<f32>(0.3, 0.2, 0.8, 1.0); // Purple color
} 