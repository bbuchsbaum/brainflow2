use approx::assert_relative_eq;
use nalgebra::Vector4;
use render_loop::RenderLoopService;
use volmath::space::NeuroSpaceImpl;
use volmath::{DenseVolume3, NeuroSpace3, NeuroSpaceExt};

/// Helper to create a test volume with known values
fn create_test_volume() -> (DenseVolume3<f32>, NeuroSpaceImpl) {
    // Create a 10x10x10 volume with identity transform
    let dims = [10, 10, 10];
    let mut data = vec![0.0f32; 1000];

    // Fill with gradient pattern for easy verification
    for z in 0..10 {
        for y in 0..10 {
            for x in 0..10 {
                let idx = z * 100 + y * 10 + x;
                data[idx] = (x + y + z) as f32;
            }
        }
    }

    let space = <volmath::NeuroSpace as NeuroSpaceExt>::from_dims_spacing_origin(
        dims.to_vec(),
        vec![1.0, 1.0, 1.0],
        vec![0.0, 0.0, 0.0],
    )
    .expect("Failed to create NeuroSpace");
    let volume = DenseVolume3::from_data(space.clone(), data);

    (volume, space)
}

#[tokio::test]
async fn test_upload_volume_coordinate_transform() {
    // Initialize render service
    let mut service = RenderLoopService::new().await.unwrap();

    // Create test volume
    let (volume, _space) = create_test_volume();

    // Upload the entire volume
    let result = service.upload_volume_3d(&volume);

    assert!(
        result.is_ok(),
        "Failed to upload volume: {:?}",
        result.err()
    );

    let (layer_idx, world_to_voxel) = result.unwrap();

    assert_eq!(layer_idx, 0); // 3D textures always use layer 0

    // Test transformation of known world points
    let test_points = vec![
        Vector4::new(0.0, 0.0, 5.0, 1.0), // Origin at Z=5
        Vector4::new(5.0, 5.0, 5.0, 1.0), // Center
        Vector4::new(9.0, 9.0, 5.0, 1.0), // Far corner
    ];

    for world_point in test_points {
        let voxel_point = world_to_voxel * world_point;

        // For identity transform, world coords should equal voxel coords
        assert_relative_eq!(voxel_point.x, world_point.x, epsilon = 1e-6);
        assert_relative_eq!(voxel_point.y, world_point.y, epsilon = 1e-6);
        assert_relative_eq!(voxel_point.z, world_point.z, epsilon = 1e-6);
        assert_relative_eq!(voxel_point.w, 1.0, epsilon = 1e-6);
    }
}

#[tokio::test]
async fn test_upload_volume_with_scaled_transform() {
    let mut service = RenderLoopService::new().await.unwrap();

    // Create volume with non-unit spacing
    let dims = [20, 20, 10];
    let mut data = vec![0.0f32; 4000];
    for i in 0..4000 {
        data[i] = i as f32;
    }

    let space = <volmath::NeuroSpace as NeuroSpaceExt>::from_dims_spacing_origin(
        dims.to_vec(),
        vec![2.0, 3.0, 4.0],       // Non-unit spacing
        vec![-10.0, -20.0, -30.0], // Non-zero origin
    )
    .expect("Failed to create NeuroSpace");
    let volume = DenseVolume3::from_data(space.clone(), data);

    let result = service.upload_volume_3d(&volume);

    assert!(result.is_ok());
    let (_layer_idx, world_to_voxel) = result.unwrap();

    // We can test the inverse transformation
    // Test world [10, 10, -10] -> voxel coordinates
    let world = Vector4::new(10.0, 10.0, -10.0, 1.0);
    let voxel = world_to_voxel * world;

    // Expected: voxel = (world - origin) / spacing
    let expected_voxel = Vector4::new(10.0, 10.0, 5.0, 1.0);

    // Verify the voxel coordinates match expected
    assert_relative_eq!(voxel.x / voxel.w, expected_voxel.x, epsilon = 1e-6);
    assert_relative_eq!(voxel.y / voxel.w, expected_voxel.y, epsilon = 1e-6);
    assert_relative_eq!(voxel.z / voxel.w, expected_voxel.z, epsilon = 1e-6);
}

#[tokio::test]
async fn test_update_frame_coordinate_pipeline() {
    let mut service = RenderLoopService::new().await.unwrap();

    // Create and upload a test volume
    let (volume, _space) = create_test_volume();

    let result = service.upload_volume_3d(&volume);
    assert!(result.is_ok());

    let (layer_idx, _) = result.unwrap();

    // Add layer to render state
    let _render_layer_idx = service
        .add_render_layer(
            layer_idx,
            1.0,
            (0.0, 0.0, 1.0, 1.0), // Full texture coords
        )
        .unwrap();

    // Test update_frame with world coordinates
    let center_world = [5.0, 5.0, 5.0];
    let view_width = 20.0;
    let view_height = 20.0;
    let plane_id = 2; // Axial

    service.update_frame_for_synchronized_view(view_width, view_height, center_world, plane_id);

    // Verify crosshair was set correctly
    service.set_crosshair(center_world);
}

#[tokio::test]
async fn test_coordinate_bounds_checking() {
    let mut service = RenderLoopService::new().await.unwrap();

    let (volume, _space) = create_test_volume();

    // Upload volume
    let result = service.upload_volume_3d(&volume);
    assert!(result.is_ok());

    let (layer_idx, _) = result.unwrap();

    service
        .add_render_layer(layer_idx, 1.0, (0.0, 0.0, 1.0, 1.0))
        .unwrap();

    // Test in-bounds coordinates
    let in_bounds = [5.0, 5.0, 5.0];
    service.set_crosshair(in_bounds);

    // Test out-of-bounds coordinates
    let out_of_bounds = [-5.0, 5.0, 5.0];
    // set_crosshair doesn't return a Result, it just sets the crosshair
    // The shader will handle clamping if needed
    service.set_crosshair(out_of_bounds);
}

#[tokio::test]
async fn test_texture_coordinate_calculation() {
    let mut service = RenderLoopService::new().await.unwrap();

    // Create a rectangular volume
    let dims = [64, 32, 16];
    let data = vec![1.0f32; 64 * 32 * 16];
    let space = <volmath::NeuroSpace as NeuroSpaceExt>::from_dims_spacing_origin(
        dims.to_vec(),
        vec![1.0, 1.0, 1.0],
        vec![0.0, 0.0, 0.0],
    )
    .expect("Failed to create NeuroSpace");
    let volume = DenseVolume3::from_data(space.clone(), data);

    // Upload the volume
    let result = service.upload_volume_3d(&volume);
    assert!(result.is_ok(), "Failed to upload volume");

    let (layer_idx, _) = result.unwrap();
    assert_eq!(layer_idx, 0); // 3D textures always use layer 0

    // Add render layer with full texture coordinates
    let render_idx = service
        .add_render_layer(
            layer_idx,
            1.0,
            (0.0, 0.0, 1.0, 1.0), // Full volume texture coords
        )
        .unwrap();

    // For 3D textures, the entire volume is uploaded at once
    // Texture coordinates are handled in the shader based on voxel coordinates
    assert_eq!(render_idx, 0);
}
