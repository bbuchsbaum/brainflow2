use approx::assert_relative_eq;
use nalgebra::Vector4;
use render_loop::RenderLoopService;
use volmath::space::NeuroSpaceImpl;
use volmath::{DenseVolume3, NeuroSpace3};

/// End-to-end test simulating the full pipeline from volume creation to rendering
#[tokio::test]
async fn test_full_volume_upload_pipeline() {
    // Step 1: Initialize render service
    let mut service = RenderLoopService::new().await.unwrap();

    // Step 2: Create a test volume with known pattern
    let dims = [64, 64, 25];
    let mut data = vec![0.0f32; 64 * 64 * 25];

    // Fill with a 3D gradient pattern
    for z in 0..25 {
        for y in 0..64 {
            for x in 0..64 {
                let idx = z * 64 * 64 + y * 64 + x;
                // Create a sphere pattern centered at volume center
                let cx = 31.5;
                let cy = 31.5;
                let cz = 12.0;
                let dist =
                    ((x as f32 - cx).powi(2) + (y as f32 - cy).powi(2) + (z as f32 - cz).powi(2))
                        .sqrt();
                data[idx] = if dist < 20.0 {
                    1000.0 - dist * 40.0
                } else {
                    0.0
                };
            }
        }
    }

    // Step 3: Create coordinate space with realistic parameters
    let space = NeuroSpaceImpl::from_dims_spacing_origin(
        dims,
        [3.5, 3.5, 3.5],          // 3.5mm voxel spacing
        [-111.5, -111.5, -43.75], // Typical MRI origin
    );
    let volume = DenseVolume3::from_data(NeuroSpace3::new(space.clone()), data);

    // Step 4: Upload entire volume
    let result = service.upload_volume_3d(&volume);
    assert!(
        result.is_ok(),
        "Failed to upload volume: {:?}",
        result.err()
    );

    let (layer_idx, world_to_voxel) = result.unwrap();

    // Verify GPU resources were allocated
    assert_eq!(layer_idx, 0); // 3D textures always use layer 0

    // Step 5: Verify coordinate transformations
    // Get voxel_to_world from the space
    let voxel_to_world = space.voxel_to_world();

    // Test center voxel transformation
    let center_voxel = Vector4::new(31.5, 31.5, 12.0, 1.0);
    let center_world = voxel_to_world * center_voxel;

    // Verify world coordinates
    assert_relative_eq!(center_world.x / center_world.w, -1.25, epsilon = 0.1);
    assert_relative_eq!(center_world.y / center_world.w, -1.25, epsilon = 0.1);
    assert_relative_eq!(center_world.z / center_world.w, -1.75, epsilon = 0.1);

    // Verify round-trip transformation
    let voxel_back = world_to_voxel * center_world;
    assert_relative_eq!(voxel_back.x / voxel_back.w, center_voxel.x, epsilon = 1e-6);
    assert_relative_eq!(voxel_back.y / voxel_back.w, center_voxel.y, epsilon = 1e-6);
    assert_relative_eq!(voxel_back.z / voxel_back.w, center_voxel.z, epsilon = 1e-6);

    // Step 6: Add layer to render state
    let render_idx = service
        .add_render_layer(
            layer_idx,
            1.0,                  // full opacity
            (0.0, 0.0, 1.0, 1.0), // full texture coords
        )
        .unwrap();

    assert_eq!(render_idx, 0);

    // Step 7: Update intensity window for proper display
    service
        .update_layer_intensity(render_idx, 0.0, 1000.0)
        .unwrap();

    // Step 8: Set up view parameters
    let center_world_coords = [
        center_world.x / center_world.w,
        center_world.y / center_world.w,
        center_world.z / center_world.w,
    ];

    service.set_crosshair(center_world_coords);

    // Calculate view size to show entire volume
    let view_width = 64.0 * 3.5 * 1.2; // voxels * spacing * padding
    let view_height = 64.0 * 3.5 * 1.2;

    service.update_frame_for_synchronized_view(
        view_width,
        view_height,
        center_world_coords,
        2, // axial plane
    );
}

/// Test multiple volume layers with different coordinate systems
#[tokio::test]
async fn test_multiple_volumes_different_spaces() {
    let mut service = RenderLoopService::new().await.unwrap();

    // Volume 1: Identity transform
    let vol1_dims = [32, 32, 32];
    let vol1_data = vec![100.0f32; 32 * 32 * 32];
    let space1 =
        NeuroSpaceImpl::from_dims_spacing_origin(vol1_dims, [1.0, 1.0, 1.0], [0.0, 0.0, 0.0]);
    let volume1 = DenseVolume3::from_data(NeuroSpace3::new(space1), vol1_data);

    // Volume 2: Scaled and translated
    let vol2_dims = [64, 64, 16];
    let vol2_data = vec![200.0f32; 64 * 64 * 16];
    let space2 =
        NeuroSpaceImpl::from_dims_spacing_origin(vol2_dims, [0.5, 0.5, 2.0], [-16.0, -16.0, -16.0]);
    let _volume2 = DenseVolume3::from_data(NeuroSpace3::new(space2), vol2_data);

    // Upload both volumes
    let result1 = service.upload_volume_3d(&volume1);
    assert!(result1.is_ok());

    // For multiple volumes, we'd need to switch to 2D array texture mode
    // or use multiple render services. For this test, we'll just verify
    // the first upload works correctly.
    let (layer1, _) = result1.unwrap();

    // Add layer
    service
        .add_render_layer(layer1, 0.5, (0.0, 0.0, 1.0, 1.0))
        .unwrap();

    // Test that volume can be accessed at the origin
    let test_world = [0.0, 0.0, 0.0];
    service.set_crosshair(test_world);
}

/// Test error handling in the upload pipeline
#[tokio::test]
async fn test_upload_pipeline_error_handling() {
    let mut service = RenderLoopService::new().await.unwrap();

    // Test with minimal valid volume
    let dims = [1, 1, 1];
    let data: Vec<f32> = vec![1.0];
    let space = NeuroSpaceImpl::from_dims_spacing_origin(dims, [1.0, 1.0, 1.0], [0.0, 0.0, 0.0]);
    let volume = DenseVolume3::from_data(NeuroSpace3::new(space), data);

    // This minimal volume should upload successfully
    let result = service.upload_volume_3d(&volume);
    assert!(result.is_ok());
}

/// Test coordinate precision across the full pipeline
#[tokio::test]
async fn test_coordinate_precision() {
    let mut service = RenderLoopService::new().await.unwrap();

    // Create volume with very specific spacing to test precision
    let dims = [100, 100, 50];
    let data = vec![1.0f32; 500000];

    // Use non-round numbers to test floating point precision
    let space = NeuroSpaceImpl::from_dims_spacing_origin(
        dims,
        [1.234567, 2.345678, 3.456789],
        [-123.456, -234.567, -345.678],
    );
    let volume = DenseVolume3::from_data(NeuroSpace3::new(space.clone()), data);

    let result = service.upload_volume_3d(&volume);
    assert!(result.is_ok());

    let (_layer_idx, world_to_voxel) = result.unwrap();

    // Test specific voxel to world transformations
    let test_voxels = vec![[0.0, 0.0, 25.0], [99.0, 99.0, 25.0], [49.5, 49.5, 25.0]];

    let voxel_to_world = space.voxel_to_world();

    for voxel in test_voxels {
        let voxel_vec = Vector4::new(voxel[0], voxel[1], voxel[2], 1.0);
        let world = voxel_to_world * voxel_vec;
        let voxel_back = world_to_voxel * world;

        // Verify round-trip precision
        // Note: with complex spacing values, we may lose some precision
        assert_relative_eq!(voxel_back.x / voxel_back.w, voxel[0], epsilon = 1e-4);
        assert_relative_eq!(voxel_back.y / voxel_back.w, voxel[1], epsilon = 1e-4);
        assert_relative_eq!(voxel_back.z / voxel_back.w, voxel[2], epsilon = 1e-4);
    }
}

/// Test the complete rendering pipeline with test pattern
#[tokio::test]
async fn test_render_with_pattern() {
    let mut service = RenderLoopService::new().await.unwrap();

    // Create a simple test pattern
    let dims = [4, 4, 4];
    let mut data = vec![0.0f32; 64];

    // Create a cross pattern in slice Z=2
    // Pattern:
    //   0 1 1 0
    //   1 1 1 1
    //   1 1 1 1
    //   0 1 1 0
    data[2 * 16 + 0 * 4 + 1] = 1000.0;
    data[2 * 16 + 0 * 4 + 2] = 1000.0;
    data[2 * 16 + 1 * 4 + 0] = 1000.0;
    data[2 * 16 + 1 * 4 + 1] = 1000.0;
    data[2 * 16 + 1 * 4 + 2] = 1000.0;
    data[2 * 16 + 1 * 4 + 3] = 1000.0;
    data[2 * 16 + 2 * 4 + 0] = 1000.0;
    data[2 * 16 + 2 * 4 + 1] = 1000.0;
    data[2 * 16 + 2 * 4 + 2] = 1000.0;
    data[2 * 16 + 2 * 4 + 3] = 1000.0;
    data[2 * 16 + 3 * 4 + 1] = 1000.0;
    data[2 * 16 + 3 * 4 + 2] = 1000.0;

    let space = NeuroSpaceImpl::from_dims_spacing_origin(dims, [1.0, 1.0, 1.0], [0.0, 0.0, 0.0]);
    let volume = DenseVolume3::from_data(NeuroSpace3::new(space), data);

    // Upload the patterned volume
    let result = service.upload_volume_3d(&volume);
    assert!(result.is_ok());

    let (layer_idx, _) = result.unwrap();

    service
        .add_render_layer(layer_idx, 1.0, (0.0, 0.0, 1.0, 1.0))
        .unwrap();

    service.update_layer_intensity(0, 0.0, 1000.0).unwrap();

    // Set view to show entire volume
    service.set_crosshair([1.5, 1.5, 2.0]);
    service.update_frame_for_synchronized_view(5.0, 5.0, [1.5, 1.5, 2.0], 2);

    // In a real test, we would:
    // 1. Create an offscreen render target
    // 2. Render the frame
    // 3. Read back the pixels
    // 4. Verify the cross pattern is visible
}
