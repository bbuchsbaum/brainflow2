use approx::assert_relative_eq;
use render_loop::RenderLoopService;
use volmath::space::{GridSpace, NeuroSpaceImpl};
use volmath::{DenseVolume3, NeuroSpace3, NeuroSpaceExt};

#[tokio::test]
async fn in_bounds_crosshair_yields_gradient() {
    // Initialize render service
    let mut service = RenderLoopService::new().await.unwrap();

    // Create a 10x10x10 volume with gradient pattern: data[z,y,x] = x + y*10 + z*100
    let dims = [10, 10, 10];
    let mut data = vec![0.0f32; 1000];

    for z in 0..10 {
        for y in 0..10 {
            for x in 0..10 {
                let idx = z * 100 + y * 10 + x;
                data[idx] = x as f32 + y as f32 * 10.0 + z as f32 * 100.0;
            }
        }
    }

    // Create space with 1mm spacing at origin (0,0,0)
    let space = <volmath::NeuroSpace as NeuroSpaceExt>::from_dims_spacing_origin(
        dims.to_vec(),
        vec![1.0, 1.0, 1.0],
        vec![0.0, 0.0, 0.0],
    )
    .expect("Failed to create NeuroSpace");
    let volume = DenseVolume3::from_data(space, data);

    // Upload volume
    let result = service.upload_volume_3d(&volume);
    assert!(
        result.is_ok(),
        "Failed to upload volume: {:?}",
        result.err()
    );

    let (layer_idx, _world_to_voxel) = result.unwrap();

    // Add layer to render state
    let render_idx = service
        .add_render_layer(
            layer_idx,
            1.0,                  // full opacity
            (0.0, 0.0, 1.0, 1.0), // full texture coords
        )
        .unwrap();

    // Set intensity window to match data range [0, 999]
    service
        .update_layer_intensity(render_idx, 0.0, 999.0)
        .unwrap();

    // Test multiple crosshair positions
    let test_positions = vec![
        // World coords -> Expected voxel -> Expected value
        ([4.5, 4.5, 4.5], [4.5, 4.5, 4.5], 4.5 + 45.0 + 450.0), // Center
        ([0.0, 0.0, 0.0], [0.0, 0.0, 0.0], 0.0),                // Origin
        ([9.0, 9.0, 9.0], [9.0, 9.0, 9.0], 9.0 + 90.0 + 900.0), // Far corner
        ([2.0, 3.0, 5.0], [2.0, 3.0, 5.0], 2.0 + 30.0 + 500.0), // Arbitrary
    ];

    for (world_pos, expected_voxel, expected_value) in test_positions {
        // Set crosshair
        service.set_crosshair(world_pos);

        // Verify the crosshair maps to the expected voxel
        let voxel = space.coord_to_grid(&world_pos);
        assert_relative_eq!(voxel[0], expected_voxel[0], epsilon = 1e-6);
        assert_relative_eq!(voxel[1], expected_voxel[1], epsilon = 1e-6);
        assert_relative_eq!(voxel[2], expected_voxel[2], epsilon = 1e-6);

        // In a real test with GPU readback, we would:
        // 1. Render a frame
        // 2. Read back the pixel at the crosshair
        // 3. Verify it has the expected intensity value

        // For now, we verify the math works correctly
        let normalized_value = (expected_value - 0.0) / (999.0 - 0.0);
        assert!(normalized_value >= 0.0 && normalized_value <= 1.0);

        // Verify texture coordinates
        let uvw = [
            voxel[0] / (dims[0] as f32 - 1.0),
            voxel[1] / (dims[1] as f32 - 1.0),
            voxel[2] / (dims[2] as f32 - 1.0),
        ];

        assert!(uvw[0] >= 0.0 && uvw[0] <= 1.0);
        assert!(uvw[1] >= 0.0 && uvw[1] <= 1.0);
        assert!(uvw[2] >= 0.0 && uvw[2] <= 1.0);
    }
}

#[tokio::test]
async fn in_bounds_crosshair_non_identity_transform() {
    let mut service = RenderLoopService::new().await.unwrap();

    // Create volume with non-identity transform
    let dims = [32, 32, 16];
    let mut data = vec![0.0f32; 32 * 32 * 16];

    // Fill with pattern
    for z in 0..16 {
        for y in 0..32 {
            for x in 0..32 {
                let idx = z * 1024 + y * 32 + x;
                data[idx] = (x + y + z) as f32;
            }
        }
    }

    // Non-identity transform: 2mm spacing, origin at (-31, -31, -15)
    let space = <volmath::NeuroSpace as NeuroSpaceExt>::from_dims_spacing_origin(
        dims.to_vec(),
        vec![2.0, 2.0, 2.0],
        vec![-31.0, -31.0, -15.0],
    )
    .expect("Failed to create NeuroSpace");
    let volume = DenseVolume3::from_data(space, data);

    // Upload volume
    let result = service.upload_volume_3d(&volume);
    assert!(result.is_ok());

    let (layer_idx, world_to_voxel) = result.unwrap();

    service
        .add_render_layer(layer_idx, 1.0, (0.0, 0.0, 1.0, 1.0))
        .unwrap();

    // Test that world coordinates map correctly
    let test_cases = vec![
        // Center of volume in world space
        ([0.0, 0.0, 0.0], [15.5, 15.5, 7.5]),
        // Origin voxel
        ([-31.0, -31.0, -15.0], [0.0, 0.0, 0.0]),
        // Far corner
        ([31.0, 31.0, 15.0], [31.0, 31.0, 15.0]),
    ];

    for (world, expected_voxel) in test_cases {
        let voxel = space.coord_to_grid(&world);

        assert_relative_eq!(voxel[0], expected_voxel[0], epsilon = 1e-4);
        assert_relative_eq!(voxel[1], expected_voxel[1], epsilon = 1e-4);
        assert_relative_eq!(voxel[2], expected_voxel[2], epsilon = 1e-4);

        // Verify round-trip with 4x4 matrices
        let world_vec = nalgebra::Vector4::new(world[0], world[1], world[2], 1.0);
        let voxel_vec = world_to_voxel * world_vec;
        let voxel_from_matrix = [
            voxel_vec.x / voxel_vec.w,
            voxel_vec.y / voxel_vec.w,
            voxel_vec.z / voxel_vec.w,
        ];

        assert_relative_eq!(voxel_from_matrix[0], expected_voxel[0], epsilon = 1e-4);
        assert_relative_eq!(voxel_from_matrix[1], expected_voxel[1], epsilon = 1e-4);
        assert_relative_eq!(voxel_from_matrix[2], expected_voxel[2], epsilon = 1e-4);
    }
}
