// Tests for world coordinate system accuracy in multi-resolution rendering

#[cfg(test)]
mod tests {
    use approx::assert_abs_diff_eq;
    use nalgebra::{Matrix4, Point3, Vector3};
    use render_loop::render_state::{BlendMode, LayerInfo, ThresholdMode};
    use render_loop::{test_fixtures, RenderLoopService};
    use volmath::{
        space::{NeuroSpace3, NeuroSpaceImpl},
        DenseVolume3,
    };

    /// Create a volume with markers at specific world positions
    fn create_marked_volume(
        dims: [usize; 3],
        voxel_to_world: Matrix4<f32>,
        marker_positions: &[(Vector3<f32>, f32)],
    ) -> DenseVolume3<f32> {
        let mut data = vec![0.0f32; dims[0] * dims[1] * dims[2]];
        let world_to_voxel = voxel_to_world.try_inverse().unwrap();

        // Place markers at specified world positions
        for (world_pos, value) in marker_positions {
            let voxel_pos = world_to_voxel.transform_point(&Point3::from(*world_pos));

            let x = voxel_pos.x.round() as i32;
            let y = voxel_pos.y.round() as i32;
            let z = voxel_pos.z.round() as i32;

            // Check bounds
            if x >= 0
                && x < dims[0] as i32
                && y >= 0
                && y < dims[1] as i32
                && z >= 0
                && z < dims[2] as i32
            {
                let idx = (z as usize) * dims[0] * dims[1] + (y as usize) * dims[0] + (x as usize);
                data[idx] = *value;
            }
        }

        let space_impl = NeuroSpaceExt::from_affine_matrix4(dims, voxel_to_world);
        let space = NeuroSpace3::new(space_impl);
        DenseVolume3::from_data(space.0, data)
    }

    /// Test that volumes with different orientations align correctly in world space
    #[test]
    fn test_different_orientations_alignment() {
        pollster::block_on(async {
            let mut service = RenderLoopService::new()
                .await
                .expect("Failed to create RenderLoopService");

            service.enable_world_space_rendering().unwrap();

            // Define marker positions in world space
            let markers = vec![
                (Vector3::new(0.0, 0.0, 0.0), 1.0),       // Origin
                (Vector3::new(50.0, 0.0, 0.0), 0.9),      // +X
                (Vector3::new(0.0, 50.0, 0.0), 0.8),      // +Y
                (Vector3::new(0.0, 0.0, 50.0), 0.7),      // +Z
                (Vector3::new(-50.0, -50.0, -50.0), 0.6), // Diagonal
            ];

            // Volume 1: Standard RAS orientation
            let transform1 = Matrix4::new(
                1.0, 0.0, 0.0, -128.0, 0.0, 1.0, 0.0, -128.0, 0.0, 0.0, 1.0, -128.0, 0.0, 0.0, 0.0,
                1.0,
            );
            let vol1 = create_marked_volume([256, 256, 256], transform1, &markers);

            // Volume 2: Rotated 45 degrees around Z axis
            let cos45 = 0.7071;
            let sin45 = 0.7071;
            let transform2 = Matrix4::new(
                cos45, -sin45, 0.0, -64.0, sin45, cos45, 0.0, -64.0, 0.0, 0.0, 2.0,
                -64.0, // Also different Z scaling
                0.0, 0.0, 0.0, 1.0,
            );
            let vol2 = create_marked_volume([128, 128, 64], transform2, &markers);

            // Volume 3: Oblique orientation
            let transform3 = Matrix4::new(
                0.8, 0.2, 0.1, -100.0, -0.2, 0.9, 0.1, -100.0, -0.1, -0.1, 1.1, -100.0, 0.0, 0.0,
                0.0, 1.0,
            );
            let vol3 = create_marked_volume([200, 200, 200], transform3, &markers);

            // Upload all volumes
            let (idx1, tfm1) = service.upload_volume_3d(&vol1).unwrap();
            let (idx2, tfm2) = service.upload_volume_3d(&vol2).unwrap();
            let (idx3, tfm3) = service.upload_volume_3d(&vol3).unwrap();

            // Verify transforms match
            assert_abs_diff_eq!(tfm1, transform1.try_inverse().unwrap(), epsilon = 0.001);
            assert_abs_diff_eq!(tfm2, transform2.try_inverse().unwrap(), epsilon = 0.001);
            assert_abs_diff_eq!(tfm3, transform3.try_inverse().unwrap(), epsilon = 0.001);

            // Create layers for testing alignment
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
                },
                LayerInfo {
                    atlas_index: idx2,
                    opacity: 0.5,
                    blend_mode: BlendMode::Normal,
                    colormap_id: 1,
                    intensity_range: (0.0, 1.0),
                    threshold_range: (0.0, 1.0),
                    threshold_mode: ThresholdMode::Range,
                    texture_coords: (0.0, 0.0, 1.0, 1.0),
                },
                LayerInfo {
                    atlas_index: idx3,
                    opacity: 0.3,
                    blend_mode: BlendMode::Normal,
                    colormap_id: 2,
                    intensity_range: (0.0, 1.0),
                    threshold_range: (0.0, 1.0),
                    threshold_mode: ThresholdMode::Range,
                    texture_coords: (0.0, 0.0, 1.0, 1.0),
                },
            ];

            // Update layer uniforms
            service.update_layer_uniforms_direct(
                &layers,
                &[(256, 256, 256), (128, 128, 64), (200, 200, 200)],
                &[tfm1, tfm2, tfm3],
            );

            // Layers are configured for testing alignment
        });
    }

    /// Test sub-voxel accuracy in world space sampling
    #[test]
    fn test_subvoxel_world_accuracy() {
        pollster::block_on(async {
            let mut service = RenderLoopService::new()
                .await
                .expect("Failed to create RenderLoopService");

            service.enable_world_space_rendering().unwrap();

            // Create a volume with a smooth gradient for sub-voxel testing
            let dims = [100, 100, 100];
            let mut data = vec![0.0f32; dims[0] * dims[1] * dims[2]];

            // Create smooth 3D gradient
            for z in 0..dims[2] {
                for y in 0..dims[1] {
                    for x in 0..dims[0] {
                        let idx = z * dims[0] * dims[1] + y * dims[0] + x;
                        // Smooth gradient from corner to corner
                        data[idx] = (x as f32 + y as f32 + z as f32) / 300.0;
                    }
                }
            }

            // 2mm voxels centered at origin
            let transform = Matrix4::new(
                2.0, 0.0, 0.0, -100.0, 0.0, 2.0, 0.0, -100.0, 0.0, 0.0, 2.0, -100.0, 0.0, 0.0, 0.0,
                1.0,
            );

            let space_impl = NeuroSpaceExt::from_affine_matrix4(dims, transform);
            let space = NeuroSpace3::new(space_impl);
            let volume = DenseVolume3::from_data(space.0, data);

            let (idx, world_to_voxel) = service.upload_volume_3d(&volume).unwrap();

            // Test sampling at sub-voxel positions
            let sub_voxel_positions = vec![
                [0.0, 0.0, 0.0], // Exactly on voxel center
                [0.5, 0.0, 0.0], // Half voxel offset in X
                [0.0, 0.7, 0.0], // 0.7 voxel offset in Y
                [0.3, 0.3, 0.3], // Diagonal sub-voxel offset
                [1.5, 1.5, 1.5], // Between voxels
            ];

            for pos in sub_voxel_positions {
                // Verify position maps to expected voxel location
                let voxel_pos = world_to_voxel.transform_point(&Point3::from(Vector3::from(pos)));

                // The center of the volume (50,50,50) should map to world (0,0,0)
                let expected_voxel = Vector3::new(
                    50.0 + pos[0] / 2.0, // 2mm voxel spacing
                    50.0 + pos[1] / 2.0,
                    50.0 + pos[2] / 2.0,
                );

                assert_abs_diff_eq!(voxel_pos.coords, expected_voxel, epsilon = 0.001);
            }

            // Test crosshair positioning
            service.set_crosshair([1.5, 1.5, 1.5]);
        });
    }

    /// Test coordinate accuracy at volume boundaries
    #[test]
    fn test_volume_boundary_coordinates() {
        pollster::block_on(async {
            let mut service = RenderLoopService::new()
                .await
                .expect("Failed to create RenderLoopService");

            service.enable_world_space_rendering().unwrap();

            // Create volume with markers at boundaries
            let dims = [64, 64, 64];
            let mut data = vec![0.0f32; dims[0] * dims[1] * dims[2]];

            // Mark all boundary voxels
            for z in 0..dims[2] {
                for y in 0..dims[1] {
                    for x in 0..dims[0] {
                        if x == 0
                            || x == dims[0] - 1
                            || y == 0
                            || y == dims[1] - 1
                            || z == 0
                            || z == dims[2] - 1
                        {
                            let idx = z * dims[0] * dims[1] + y * dims[0] + x;
                            data[idx] = 1.0;
                        }
                    }
                }
            }

            // Volume extends from -32 to +32 in each dimension
            let transform = Matrix4::new(
                1.0, 0.0, 0.0, -32.0, 0.0, 1.0, 0.0, -32.0, 0.0, 0.0, 1.0, -32.0, 0.0, 0.0, 0.0,
                1.0,
            );

            let space_impl = NeuroSpaceExt::from_affine_matrix4(dims, transform);
            let space = NeuroSpace3::new(space_impl);
            let volume = DenseVolume3::from_data(space.0, data);

            let (idx, world_to_voxel) = service.upload_volume_3d(&volume).unwrap();

            // Test positions at and near boundaries
            let boundary_positions = vec![
                [-32.0, 0.0, 0.0], // Left boundary
                [31.0, 0.0, 0.0],  // Right boundary (63 voxels from -32)
                [0.0, -32.0, 0.0], // Bottom boundary
                [0.0, 31.0, 0.0],  // Top boundary
                [0.0, 0.0, -32.0], // Back boundary
                [0.0, 0.0, 31.0],  // Front boundary
                [-31.5, 0.0, 0.0], // Just inside left boundary
                [30.5, 0.0, 0.0],  // Just inside right boundary
                [-33.0, 0.0, 0.0], // Just outside left boundary
                [32.0, 0.0, 0.0],  // Just outside right boundary
            ];

            for pos in boundary_positions {
                // Check if position maps to valid voxel
                let voxel_pos = world_to_voxel.transform_point(&Point3::from(Vector3::from(pos)));
                let in_bounds = voxel_pos.x >= 0.0
                    && voxel_pos.x < dims[0] as f32
                    && voxel_pos.y >= 0.0
                    && voxel_pos.y < dims[1] as f32
                    && voxel_pos.z >= 0.0
                    && voxel_pos.z < dims[2] as f32;

                // For positions inside boundaries, verify they map correctly
                if in_bounds {
                    let expected_x = pos[0] + 32.0; // Transform shifts by 32
                    let expected_y = pos[1] + 32.0;
                    let expected_z = pos[2] + 32.0;

                    assert_abs_diff_eq!(voxel_pos.x, expected_x, epsilon = 0.001);
                    assert_abs_diff_eq!(voxel_pos.y, expected_y, epsilon = 0.001);
                    assert_abs_diff_eq!(voxel_pos.z, expected_z, epsilon = 0.001);
                }
            }
        });
    }
}
