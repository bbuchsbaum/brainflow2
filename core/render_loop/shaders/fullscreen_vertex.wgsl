// Two triangles covering the unit square, in image-independent NDC coordinates.
fn fullscreen_vertex(vid: u32) -> vec2<f32> {
    switch (vid) {
        case 0u: { return vec2<f32>(0.0, 0.0); }
        case 1u: { return vec2<f32>(1.0, 0.0); }
        case 2u: { return vec2<f32>(0.0, 1.0); }
        case 3u: { return vec2<f32>(0.0, 1.0); }
        case 4u: { return vec2<f32>(1.0, 0.0); }
        case 5u: { return vec2<f32>(1.0, 1.0); }
        default: { return vec2<f32>(0.0, 0.0); }
    }
}
