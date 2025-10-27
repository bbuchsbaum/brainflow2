use pollster;
use render_loop::RenderLoopService;

#[test]
#[ignore = "Border overlay test depends on precise UBO layout across shaders; enable once stabilized."]
fn test_slice_border_renders_visible_outline() {
    pollster::block_on(async {
        let mut service = RenderLoopService::new()
            .await
            .expect("create service");
        service.load_shaders().expect("load shaders");
        service
            .enable_world_space_rendering()
            .expect("enable world-space");

        // Create a tiny synthetic 3D volume (single voxel non-zero) via helper fixture
        let vol = render_loop::test_fixtures::create_test_pattern_volume();
        let (atlas_idx, tfm) = service
            .upload_volume_multi_texture(&vol, wgpu::TextureFormat::R8Unorm)
            .expect("upload vol");
        service.initialize_colormap().expect("init colormap");
        service
            .create_world_space_bind_groups()
            .expect("bind groups");

        // Add as a render layer
        let layer_index = service
            .add_layer_3d(atlas_idx, tfm.clone(), (64, 64, 25), 1.0, 0, 1)
            .expect("add layer");

        // Turn on border and render to 128x128
        service
            .set_layer_border(layer_index, true, 2.0)
            .expect("set border");

        // Set frame covering the texture fully
        let origin = [0.0, 0.0, 12.0, 1.0];
        let u = [64.0, 0.0, 0.0, 0.0];
        let v = [0.0, 64.0, 0.0, 0.0];
        service.update_frame_ubo(origin, u, v);

        service
            .create_offscreen_target(512, 512)
            .expect("offscreen");
        let rgba = service.render_to_buffer().expect("render");

        // Count bright border pixels near edges (white border => high RGB)
        let mut edge_hits = 0usize;
        for y in 0..512u32 {
            for x in 0..512u32 {
                if x < 2 || x >= 510 || y < 2 || y >= 510 {
                    let idx = (y as usize * 512 + x as usize) * 4;
                    let r = rgba[idx] as u32;
                    let g = rgba[idx + 1] as u32;
                    let b = rgba[idx + 2] as u32;
                    if r + g + b > 550 { // near white
                        edge_hits += 1;
                    }
                }
            }
        }
        assert!(edge_hits > 200, "expected visible border, got {} edge hits", edge_hits);

        // Turn border off and confirm reduction
        service
            .set_layer_border(layer_index, false, 1.0)
            .expect("disable border");
        let rgba2 = service.render_to_buffer().expect("render2");
        let mut edge_hits2 = 0usize;
        for y in 0..512u32 {
            for x in 0..512u32 {
                if x < 2 || x >= 510 || y < 2 || y >= 510 {
                    let idx = (y as usize * 512 + x as usize) * 4;
                    let r = rgba2[idx] as u32;
                    let g = rgba2[idx + 1] as u32;
                    let b = rgba2[idx + 2] as u32;
                    if r + g + b > 550 {
                        edge_hits2 += 1;
                    }
                }
            }
        }
        assert!(edge_hits2 < edge_hits / 2, "edge hits did not drop after disabling border");
    })
}
