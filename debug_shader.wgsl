// Debug shader to test colormap sampling directly

@group(0) @binding(0) var colormapTexture: texture_2d_array<f32>;
@group(0) @binding(1) var cmSampler: sampler;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
    var output: VertexOutput;
    
    // Generate fullscreen triangle
    let x = f32(i32(vertex_index & 1u) * 2 - 1);
    let y = f32(i32((vertex_index >> 1u) & 1u) * 2 - 1);
    
    output.position = vec4<f32>(x, y, 0.0, 1.0);
    output.uv = vec2<f32>((x + 1.0) * 0.5, (1.0 - y) * 0.5);
    
    return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    // Test colormap 0 (grayscale) at intensity 0.5
    let intensity = 0.5;
    let colormap_id = 0;
    
    let color = textureSample(colormapTexture, cmSampler, vec2<f32>(intensity, 0.5), colormap_id);
    
    return color;
}