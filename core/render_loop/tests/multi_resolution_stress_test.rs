// Stress tests for multi-resolution volume rendering

#[cfg(test)]
mod tests {
    use nalgebra::Matrix4;
    use render_loop::render_state::{BlendMode, LayerInfo, ThresholdMode};
    use render_loop::RenderLoopService;
    use volmath::{space::NeuroSpace3, DenseVolume3, NeuroSpaceExt};

    /// Create a volume with specific dimensions and resolution
    fn create_test_volume(dims: [usize; 3], spacing: [f32; 3]) -> DenseVolume3<f32> {
        let mut data = vec![0.0f32; dims[0] * dims[1] * dims[2]];

        // Fill with gradient pattern for testing
        for z in 0..dims[2] {
            for y in 0..dims[1] {
                for x in 0..dims[0] {
                    let idx = z * dims[0] * dims[1] + y * dims[0] + x;
                    let value = (x as f32 / dims[0] as f32
                        + y as f32 / dims[1] as f32
                        + z as f32 / dims[2] as f32)
                        / 3.0;
                    data[idx] = value;
                }
            }
        }

        // Create transform with specified spacing
        let transform = Matrix4::new(
            spacing[0],
            0.0,
            0.0,
            -(dims[0] as f32 * spacing[0] / 2.0),
            0.0,
            spacing[1],
            0.0,
            -(dims[1] as f32 * spacing[1] / 2.0),
            0.0,
            0.0,
            spacing[2],
            -(dims[2] as f32 * spacing[2] / 2.0),
            0.0,
            0.0,
            0.0,
            1.0,
        );

        let space_impl =
            <volmath::NeuroSpace as NeuroSpaceExt>::from_affine_matrix4(dims.to_vec(), transform)
                .expect("Failed to create NeuroSpace");
        let space = NeuroSpace3::new(space_impl);
        DenseVolume3::from_data(space.0, data)
    }

    /// Test extreme zoom levels with multi-resolution data
    #[test]
    fn test_extreme_zoom_levels() {
        pollster::block_on(async {
            let mut service = RenderLoopService::new()
                .await
                .expect("Failed to create RenderLoopService");

            service.enable_world_space_rendering().unwrap();

            // Create volumes at very different resolutions
            let coarse = create_test_volume([32, 32, 32], [8.0, 8.0, 8.0]); // Very low res
            let fine = create_test_volume([512, 512, 128], [0.25, 0.25, 1.0]); // Very high res

            let (coarse_idx, coarse_tfm) = service.upload_volume_3d(&coarse).unwrap();
            let (fine_idx, fine_tfm) = service.upload_volume_3d(&fine).unwrap();

            // Test various zoom levels by adjusting crosshair position
            let zoom_positions = vec![
                [0.0, 0.0, 0.0],     // Center
                [100.0, 100.0, 0.0], // Far from center
                [10.0, 10.0, 0.0],   // Near center
                [1.0, 1.0, 0.0],     // Very near center
                [0.1, 0.1, 0.0],     // Extremely near center
            ];

            for pos in zoom_positions {
                service.set_crosshair(pos);

                let layers = vec![
                    LayerInfo {
                        atlas_index: coarse_idx,
                        opacity: 0.5,
                        blend_mode: BlendMode::Normal,
                        colormap_id: 0,
                        intensity_range: (0.0, 1.0),
                        threshold_range: (0.0, 1.0),
                        threshold_mode: ThresholdMode::Range,
                        texture_coords: (0.0, 0.0, 1.0, 1.0),
                        is_mask: false,
                        ..LayerInfo::default()
                    },
                    LayerInfo {
                        atlas_index: fine_idx,
                        opacity: 0.5,
                        blend_mode: BlendMode::Normal,
                        colormap_id: 1,
                        intensity_range: (0.0, 1.0),
                        threshold_range: (0.0, 1.0),
                        threshold_mode: ThresholdMode::Range,
                        texture_coords: (0.0, 0.0, 1.0, 1.0),
                        is_mask: false,
                        ..LayerInfo::default()
                    },
                ];

                service.update_layer_uniforms_direct(
                    &layers,
                    &[(32, 32, 32), (512, 512, 128)],
                    &[coarse_tfm, fine_tfm],
                );

                // Layers updated for this zoom level
            }
        });
    }

    /// Test rapid view changes with multiple resolutions
    #[test]
    fn test_rapid_view_changes() {
        pollster::block_on(async {
            let mut service = RenderLoopService::new()
                .await
                .expect("Failed to create RenderLoopService");

            service.enable_world_space_rendering().unwrap();

            // Create test volumes
            let vol1 = create_test_volume([128, 128, 64], [1.0, 1.0, 2.0]);
            let vol2 = create_test_volume([256, 128, 32], [0.5, 1.0, 4.0]);

            let (idx1, tfm1) = service.upload_volume_3d(&vol1).unwrap();
            let (idx2, tfm2) = service.upload_volume_3d(&vol2).unwrap();

            let layers = vec![
                LayerInfo {
                    atlas_index: idx1,
                    opacity: 1.0,
                    blend_mode: BlendMode::Normal,
                    colormap_id: 0,
                    intensity_range: (0.0, 1.0),
                    threshold_range: (0.0, 1.0),
                    threshold_mode: ThresholdMode::Range,
                    texture_coords: (0.0, 0.0, 1.0, 1.0),
                    is_mask: false,
                    ..LayerInfo::default()
                },
                LayerInfo {
                    atlas_index: idx2,
                    opacity: 0.5,
                    blend_mode: BlendMode::Normal,
                    colormap_id: 3,
                    intensity_range: (0.0, 1.0),
                    threshold_range: (0.3, 0.7),
                    threshold_mode: ThresholdMode::Range,
                    texture_coords: (0.0, 0.0, 1.0, 1.0),
                    is_mask: false,
                    ..LayerInfo::default()
                },
            ];

            // Simulate rapid navigation
            let positions = vec![
                [0.0, 0.0, 0.0],
                [10.0, 0.0, 0.0],
                [10.0, 10.0, 0.0],
                [0.0, 10.0, 0.0],
                [0.0, 0.0, 10.0],
                [-10.0, 0.0, 10.0],
                [-10.0, -10.0, 0.0],
                [0.0, -10.0, 0.0],
            ];

            for pos in positions {
                service.set_crosshair(pos);

                service.update_layer_uniforms_direct(
                    &layers,
                    &[(128, 128, 64), (256, 128, 32)],
                    &[tfm1, tfm2],
                );

                // Layers updated for this zoom level
            }

            // Create offscreen target for verification
            service
                .create_offscreen_target(512, 512)
                .expect("Failed to create offscreen target");
        });
    }

    /// Test maximum texture count limit
    #[test]
    fn test_max_texture_limit() {
        pollster::block_on(async {
            let mut service = RenderLoopService::new()
                .await
                .expect("Failed to create RenderLoopService");

            service.enable_world_space_rendering().unwrap();

            let mut indices = Vec::new();

            // Try to upload MAX_TEXTURES volumes
            for i in 0..render_loop::multi_texture_manager::MAX_TEXTURES {
                let volume = create_test_volume([64, 64, 64], [1.0, 1.0, 1.0]);
                match service.upload_volume_3d(&volume) {
                    Ok((idx, _)) => indices.push(idx),
                    Err(_) => {
                        // Should succeed for all MAX_TEXTURES
                        panic!(
                            "Failed to upload volume {} of {}",
                            i,
                            render_loop::multi_texture_manager::MAX_TEXTURES
                        );
                    }
                }
            }

            assert_eq!(
                indices.len(),
                render_loop::multi_texture_manager::MAX_TEXTURES
            );

            // Next upload should fail
            let extra_volume = create_test_volume([64, 64, 64], [1.0, 1.0, 1.0]);
            let result = service.upload_volume_3d(&extra_volume);
            assert!(result.is_err(), "Should fail when exceeding MAX_TEXTURES");
        });
    }
}
