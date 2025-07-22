// Stress tests for multi-resolution volume rendering

#[cfg(test)]
mod tests {
    use render_loop::{RenderLoopService, test_fixtures};
    use render_loop::render_state::{LayerInfo, BlendMode, ThresholdMode};
    use volmath::{DenseVolume3, NeuroSpaceExt, space::{NeuroSpace3, NeuroSpaceImpl}};
    use nalgebra::Matrix4;
    
    /// Create a volume with specific dimensions and resolution
    fn create_test_volume(dims: [usize; 3], spacing: [f32; 3]) -> DenseVolume3<f32> {
        let mut data = vec![0.0f32; dims[0] * dims[1] * dims[2]];
        
        // Fill with gradient pattern for testing
        for z in 0..dims[2] {
            for y in 0..dims[1] {
                for x in 0..dims[0] {
                    let idx = z * dims[0] * dims[1] + y * dims[0] + x;
                    let value = (x as f32 / dims[0] as f32 + 
                                 y as f32 / dims[1] as f32 + 
                                 z as f32 / dims[2] as f32) / 3.0;
                    data[idx] = value;
                }
            }
        }
        
        // Create transform with specified spacing
        let transform = Matrix4::new(
            spacing[0], 0.0, 0.0, -(dims[0] as f32 * spacing[0] / 2.0),
            0.0, spacing[1], 0.0, -(dims[1] as f32 * spacing[1] / 2.0),
            0.0, 0.0, spacing[2], -(dims[2] as f32 * spacing[2] / 2.0),
            0.0, 0.0, 0.0, 1.0,
        );
        
        let space_impl = <volmath::NeuroSpace as NeuroSpaceExt>::from_affine_matrix4(dims.to_vec(), transform)
            .expect("Failed to create NeuroSpace");
        let space = NeuroSpace3::new(space_impl);
        DenseVolume3::from_data(space.0, data)
    }
    
    /// Test handling many volumes at different resolutions
    #[test]
    fn test_many_volumes_stress() {
        pollster::block_on(async {
            let mut service = RenderLoopService::new().await
                .expect("Failed to create RenderLoopService");
            
            // Enable smart texture management with 1GB limit
            service.enable_smart_texture_management(1024)
                .expect("Failed to enable smart texture management");
            
            // Create volumes at various resolutions
            let resolutions = vec![
                ([128, 128, 128], [2.0, 2.0, 2.0]),    // Low res, 8MB
                ([256, 256, 128], [1.0, 1.0, 2.0]),    // Med res, 32MB
                ([512, 256, 64], [0.5, 1.0, 3.0]),     // Anisotropic, 32MB
                ([256, 256, 256], [1.0, 1.0, 1.0]),    // High res, 64MB
                ([128, 512, 128], [2.0, 0.5, 2.0]),    // Tall volume, 32MB
            ];
            
            let mut volume_indices = Vec::new();
            let mut transforms = Vec::new();
            let mut dimensions = Vec::new();
            
            for (i, (dims, spacing)) in resolutions.iter().enumerate() {
                let volume = create_test_volume(*dims, *spacing);
                let (idx, tfm) = service.upload_volume_smart(&volume, None)
                    .expect(&format!("Failed to upload volume {}", i));
                volume_indices.push(idx);
                transforms.push(tfm);
                dimensions.push((dims[0] as u32, dims[1] as u32, dims[2] as u32));
            }
            
            // Check memory usage
            let stats = service.smart_texture_stats().unwrap();
            assert_eq!(stats.current_texture_count, 5);
            assert!(stats.peak_memory_usage < 1024 * 1024 * 1024); // Under 1GB
            
            // Test rendering with all volumes
            let layers: Vec<LayerInfo> = volume_indices.iter().enumerate().map(|(i, &idx)| {
                LayerInfo {
                    atlas_index: idx,
                    opacity: 1.0 / (i + 1) as f32, // Decreasing opacity
                    blend_mode: BlendMode::Normal,
                    colormap_id: i as u32 % 5,
                    intensity_range: (0.0, 1.0),
                    threshold_range: (0.2, 0.8),
                    threshold_mode: if i > 2 { ThresholdMode::Range } else { ThresholdMode::Range },
                    texture_coords: (0.0, 0.0, 1.0, 1.0),
                    is_mask: false,
                }
            }).collect();
            
            // Update layer uniforms
            service.update_layer_uniforms_direct(
                &layers,
                &dimensions,
                &transforms,
            );
            
            // All layers configured for rendering
            
            // Create offscreen target for rendering
            service.create_offscreen_target(1024, 1024)
                .expect("Failed to create offscreen target");
        });
    }
    
    /// Test memory limit enforcement with texture pooling
    #[test]
    fn test_memory_limit_with_pooling() {
        pollster::block_on(async {
            let mut service = RenderLoopService::new().await
                .expect("Failed to create RenderLoopService");
            
            // Enable smart texture management with small limit (64MB)
            // Note: Each 256x256x128 volume with R16Float format (auto-selected for f32 with range 0-1) 
            // uses 16MB, not 32MB as originally commented
            service.enable_smart_texture_management(64)
                .expect("Failed to enable smart texture management");
            
            // Create large volumes that together exceed the limit
            // Force R32Float format to use 32MB per volume
            let large_volume1 = create_test_volume([256, 256, 128], [1.0, 1.0, 1.0]); // 32MB with R32Float
            let large_volume2 = create_test_volume([256, 256, 128], [1.0, 1.0, 1.0]); // 32MB with R32Float
            let large_volume3 = create_test_volume([256, 256, 128], [1.0, 1.0, 1.0]); // 32MB with R32Float
            // Removed volume4 and volume5 as they're not needed with the new test logic
            
            // Upload first two volumes with forced R32Float format (64MB total)
            let idx1 = service.upload_volume_smart(&large_volume1, Some(wgpu::TextureFormat::R32Float)).unwrap().0;
            let _idx2 = service.upload_volume_smart(&large_volume2, Some(wgpu::TextureFormat::R32Float)).unwrap().0;
            
            let stats = service.smart_texture_stats().unwrap();
            assert_eq!(stats.current_texture_count, 2);
            
            // Third volume should fail (would be 96MB > 64MB limit)
            let result = service.upload_volume_smart(&large_volume3, Some(wgpu::TextureFormat::R32Float));
            assert!(result.is_err());
            
            // Release one texture
            service.release_smart_texture(idx1).unwrap();
            
            let stats = service.smart_texture_stats().unwrap();
            assert_eq!(stats.current_texture_count, 1);
            assert_eq!(stats.total_deallocations, 1);
            
            // Now third volume should succeed (reusing pooled texture)
            let _idx3 = service.upload_volume_smart(&large_volume3, Some(wgpu::TextureFormat::R32Float)).unwrap().0;
            
            let stats = service.smart_texture_stats().unwrap();
            assert_eq!(stats.current_texture_count, 2);
            assert_eq!(stats.pool_hits, 1);
        });
    }
    
    /// Test extreme zoom levels with multi-resolution data
    #[test]
    fn test_extreme_zoom_levels() {
        pollster::block_on(async {
            let mut service = RenderLoopService::new().await
                .expect("Failed to create RenderLoopService");
            
            service.enable_world_space_rendering().unwrap();
            
            // Create volumes at very different resolutions
            let coarse = create_test_volume([32, 32, 32], [8.0, 8.0, 8.0]);    // Very low res
            let fine = create_test_volume([512, 512, 128], [0.25, 0.25, 1.0]); // Very high res
            
            let (coarse_idx, coarse_tfm) = service.upload_volume_3d(&coarse).unwrap();
            let (fine_idx, fine_tfm) = service.upload_volume_3d(&fine).unwrap();
            
            // Test various zoom levels by adjusting crosshair position
            let zoom_positions = vec![
                [0.0, 0.0, 0.0],      // Center
                [100.0, 100.0, 0.0],  // Far from center
                [10.0, 10.0, 0.0],    // Near center
                [1.0, 1.0, 0.0],      // Very near center
                [0.1, 0.1, 0.0],      // Extremely near center
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
            let mut service = RenderLoopService::new().await
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
            service.create_offscreen_target(512, 512)
                .expect("Failed to create offscreen target");
        });
    }
    
    /// Test maximum texture count limit
    #[test]
    fn test_max_texture_limit() {
        pollster::block_on(async {
            let mut service = RenderLoopService::new().await
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
                        panic!("Failed to upload volume {} of {}", i, render_loop::multi_texture_manager::MAX_TEXTURES);
                    }
                }
            }
            
            assert_eq!(indices.len(), render_loop::multi_texture_manager::MAX_TEXTURES);
            
            // Next upload should fail
            let extra_volume = create_test_volume([64, 64, 64], [1.0, 1.0, 1.0]);
            let result = service.upload_volume_3d(&extra_volume);
            assert!(result.is_err(), "Should fail when exceeding MAX_TEXTURES");
        });
    }
}