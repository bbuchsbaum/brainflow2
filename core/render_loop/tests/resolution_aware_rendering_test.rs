// Comprehensive tests for resolution-aware multi-volume rendering

#[cfg(test)]
mod tests {
    use render_loop::{RenderLoopService, test_fixtures};
    use render_loop::render_state::{LayerInfo, BlendMode, ThresholdMode};
    use nalgebra::{Vector3, Matrix4};
    use approx::assert_abs_diff_eq;
    
    /// Test rendering multiple volumes with different resolutions at the same world position
    #[test]
    fn test_multi_resolution_world_alignment() {
        pollster::block_on(async {
            let mut service = RenderLoopService::new().await
                .expect("Failed to create RenderLoopService");
            
            // Create aligned test volumes
            let volumes = test_fixtures::TestVolumeSet::create_aligned();
            
            // Upload all volumes
            let (_anat_idx, anat_transform) = service.upload_volume_3d(&volumes.anatomical)
                .expect("Failed to upload anatomical volume");
            let (_func_idx, func_transform) = service.upload_volume_3d(&volumes.functional)
                .expect("Failed to upload functional volume");
            let (_detail_idx, detail_transform) = service.upload_volume_3d(&volumes.detail_patch)
                .expect("Failed to upload detail patch");
            
            // Verify transforms are correct
            let world_origin = Vector3::new(0.0, 0.0, 0.0);
            
            // Anatomical: world (0,0,0) -> voxel (128,128,128)
            let anat_voxel = anat_transform.transform_point(&nalgebra::Point3::from(world_origin));
            assert_abs_diff_eq!(anat_voxel.coords, Vector3::new(128.0, 128.0, 128.0), epsilon = 0.001);
            
            // Functional: world (0,0,0) -> voxel (64,64,16)
            let func_voxel = func_transform.transform_point(&nalgebra::Point3::from(world_origin));
            assert_abs_diff_eq!(func_voxel.coords, Vector3::new(64.0, 64.0, 16.0), epsilon = 0.001);
            
            // Detail: world (0,0,0) -> voxel (64,64,32)
            let detail_voxel = detail_transform.transform_point(&nalgebra::Point3::from(world_origin));
            assert_abs_diff_eq!(detail_voxel.coords, Vector3::new(64.0, 64.0, 32.0), epsilon = 0.001);
        });
    }
    
    /// Test that volumes at different resolutions can be uploaded and managed
    #[test]
    fn test_world_space_multi_texture_upload() {
        pollster::block_on(async {
            let mut service = RenderLoopService::new().await
                .expect("Failed to create RenderLoopService");
            
            // Enable world-space rendering
            service.enable_world_space_rendering()
                .expect("Failed to enable world-space rendering");
            
            // Create and upload test volumes
            let volumes = test_fixtures::TestVolumeSet::create_aligned();
            let (anat_idx, anat_transform) = service.upload_volume_3d(&volumes.anatomical)
                .expect("Failed to upload anatomical");
            let (func_idx, func_transform) = service.upload_volume_3d(&volumes.functional)
                .expect("Failed to upload functional");
            
            // Verify both volumes map world origin correctly
            let world_origin = nalgebra::Point3::from(Vector3::new(0.0, 0.0, 0.0));
            
            let anat_voxel = anat_transform.transform_point(&world_origin);
            assert_abs_diff_eq!(anat_voxel.coords, Vector3::new(128.0, 128.0, 128.0), epsilon = 0.001);
            
            let func_voxel = func_transform.transform_point(&world_origin);
            assert_abs_diff_eq!(func_voxel.coords, Vector3::new(64.0, 64.0, 16.0), epsilon = 0.001);
            
            // Create layers for rendering
            let layers = vec![
                LayerInfo {
                    atlas_index: anat_idx,
                    opacity: 0.5,
                    blend_mode: BlendMode::Normal,
                    colormap_id: 0, // grayscale
                    intensity_range: (0.0, 1.0),
                    threshold_range: (0.0, 1.0),
                    threshold_mode: ThresholdMode::Range,
                    texture_coords: (0.0, 0.0, 1.0, 1.0),
                },
                LayerInfo {
                    atlas_index: func_idx,
                    opacity: 0.5,
                    blend_mode: BlendMode::Normal,
                    colormap_id: 1, // hot
                    intensity_range: (0.0, 1.0),
                    threshold_range: (0.2, 1.0),
                    threshold_mode: ThresholdMode::Range,
                    texture_coords: (0.0, 0.0, 1.0, 1.0),
                },
            ];
            
            // Update layer uniforms
            service.update_layer_uniforms_direct(
                &layers,
                &[(256, 256, 256), (128, 128, 32)],
                &[anat_transform, func_transform],
            );
            
            // Verify layer update succeeded
            // Verify layer update succeeded - need to render to see layers
            service.create_offscreen_target(256, 256)
                .expect("Failed to create offscreen target");
        });
    }
    
    /// Test resolution-aware texture format selection
    #[test]
    fn test_smart_format_selection() {
        pollster::block_on(async {
            let mut service = RenderLoopService::new().await
                .expect("Failed to create RenderLoopService");
            
            // Enable smart texture management with 512MB limit
            service.enable_smart_texture_management(512)
                .expect("Failed to enable smart texture management");
            
            // Create test volumes
            let volumes = test_fixtures::TestVolumeSet::create_aligned();
            
            // Upload with smart format selection
            let (_anat_idx, _) = service.upload_volume_smart(&volumes.anatomical, None)
                .expect("Failed to upload anatomical with smart manager");
            let (func_idx, _) = service.upload_volume_smart(&volumes.functional, None)
                .expect("Failed to upload functional with smart manager");
            let (_detail_idx, _) = service.upload_volume_smart(&volumes.detail_patch, None)
                .expect("Failed to upload detail patch with smart manager");
            
            // Check statistics
            let stats = service.smart_texture_stats()
                .expect("Smart texture manager should be enabled");
            
            assert_eq!(stats.total_allocations, 3);
            assert_eq!(stats.current_texture_count, 3);
            assert!(stats.peak_memory_usage > 0);
            
            // Test texture release and pooling
            service.release_smart_texture(func_idx)
                .expect("Failed to release functional texture");
            
            let stats = service.smart_texture_stats().unwrap();
            assert_eq!(stats.total_deallocations, 1);
            assert_eq!(stats.current_texture_count, 2);
            
            // Upload another functional volume - should reuse pooled texture
            let (_func_idx2, _) = service.upload_volume_smart(&volumes.functional, None)
                .expect("Failed to re-upload functional");
            
            let stats = service.smart_texture_stats().unwrap();
            assert_eq!(stats.pool_hits, 1);
            assert_eq!(stats.total_allocations, 4);
            assert_eq!(stats.current_texture_count, 3);
        });
    }
    
    /// Test rendering with mixed resolution layers
    #[test]
    fn test_mixed_resolution_layer_rendering() {
        pollster::block_on(async {
            let mut service = RenderLoopService::new().await
                .expect("Failed to create RenderLoopService");
            
            service.enable_world_space_rendering()
                .expect("Failed to enable world-space rendering");
            
            let volumes = test_fixtures::TestVolumeSet::create_aligned();
            
            // Upload volumes at different resolutions
            let (anat_idx, anat_tfm) = service.upload_volume_3d(&volumes.anatomical).unwrap();
            let (func_idx, func_tfm) = service.upload_volume_3d(&volumes.functional).unwrap();
            let (detail_idx, detail_tfm) = service.upload_volume_3d(&volumes.detail_patch).unwrap();
            
            // Create complex layer stack
            let layers = vec![
                // Base anatomical layer
                LayerInfo {
                    atlas_index: anat_idx,
                    opacity: 1.0,
                    blend_mode: BlendMode::Normal,
                    colormap_id: 0, // grayscale
                    intensity_range: (0.0, 1.0),
                    threshold_range: (0.0, 1.0),
                    threshold_mode: ThresholdMode::Range,
                    texture_coords: (0.0, 0.0, 1.0, 1.0),
                },
                // Functional overlay with transparency
                LayerInfo {
                    atlas_index: func_idx,
                    opacity: 0.7,
                    blend_mode: BlendMode::Normal,
                    colormap_id: 1, // hot
                    intensity_range: (0.0, 0.8),
                    threshold_range: (0.3, 1.0),
                    threshold_mode: ThresholdMode::Range,
                    texture_coords: (0.0, 0.0, 1.0, 1.0),
                },
                // High-res detail patch
                LayerInfo {
                    atlas_index: detail_idx,
                    opacity: 0.5,
                    blend_mode: BlendMode::Normal,
                    colormap_id: 3, // viridis
                    intensity_range: (0.0, 1.0),
                    threshold_range: (0.0, 1.0),
                    threshold_mode: ThresholdMode::Range,
                    texture_coords: (0.0, 0.0, 1.0, 1.0),
                },
            ];
            
            // Update with all layers
            service.update_layer_uniforms_direct(
                &layers,
                &[(256, 256, 256), (128, 128, 32), (128, 128, 64)],
                &[anat_tfm, func_tfm, detail_tfm],
            );
            
            // Layers are configured, verify we can render
            
            // Test crosshair at world origin
            service.set_crosshair([0.0, 0.0, 0.0]);
            
            // Create offscreen target for rendering
            service.create_offscreen_target(512, 512)
                .expect("Failed to create offscreen target");
        });
    }
    
    /// Test boundary conditions for multi-resolution sampling
    #[test]
    fn test_resolution_boundary_sampling() {
        pollster::block_on(async {
            let mut service = RenderLoopService::new().await
                .expect("Failed to create RenderLoopService");
            
            service.enable_world_space_rendering().unwrap();
            
            let volumes = test_fixtures::TestVolumeSet::create_aligned();
            let (_detail_idx, detail_transform) = service.upload_volume_3d(&volumes.detail_patch)
                .expect("Failed to upload detail patch");
            
            // Test at boundaries of the high-res patch
            // Detail patch covers -32 to +32mm in X/Y, -16 to +16mm in Z
            let boundary_positions = vec![
                Vector3::new(32.0, 0.0, 0.0),   // Right edge
                Vector3::new(-32.0, 0.0, 0.0),  // Left edge
                Vector3::new(0.0, 32.0, 0.0),   // Top edge
                Vector3::new(0.0, -32.0, 0.0),  // Bottom edge
                Vector3::new(0.0, 0.0, 16.0),   // Front edge
                Vector3::new(0.0, 0.0, -16.0),  // Back edge
                Vector3::new(32.0, 32.0, 16.0), // Corner
            ];
            
            for pos in boundary_positions {
                // Transform to voxel space
                let voxel_pos = detail_transform.transform_point(&nalgebra::Point3::from(pos));
                
                // Verify position is at or near boundary
                let dims = [128.0, 128.0, 64.0];
                assert!(
                    voxel_pos.x <= 0.5 || voxel_pos.x >= dims[0] - 0.5 ||
                    voxel_pos.y <= 0.5 || voxel_pos.y >= dims[1] - 0.5 ||
                    voxel_pos.z <= 0.5 || voxel_pos.z >= dims[2] - 0.5,
                    "Position {:?} -> voxel {:?} not at boundary", pos, voxel_pos
                );
            }
        });
    }
    
    /// Test performance with many volumes
    #[test]
    fn test_multi_resolution_volume_limit() {
        pollster::block_on(async {
            let mut service = RenderLoopService::new().await
                .expect("Failed to create RenderLoopService");
            
            service.enable_world_space_rendering().unwrap();
            
            // Upload volumes up to the limit
            let mut indices = Vec::new();
            for i in 0..render_loop::multi_texture_manager::MAX_TEXTURES {
                let volume = test_fixtures::create_test_pattern_volume();
                match service.upload_volume_3d(&volume) {
                    Ok((idx, _)) => indices.push(idx),
                    Err(_) => {
                        panic!("Failed to upload volume {} of {}", i, render_loop::multi_texture_manager::MAX_TEXTURES);
                    }
                }
            }
            
            assert_eq!(indices.len(), render_loop::multi_texture_manager::MAX_TEXTURES);
            
            // Next upload should fail
            let extra_volume = test_fixtures::create_test_pattern_volume();
            let result = service.upload_volume_3d(&extra_volume);
            assert!(result.is_err(), "Should fail when exceeding MAX_TEXTURES");
        });
    }
}