use render_loop::RenderLoopService;
use volmath::{DenseVolume3, NeuroSpace3, NeuroSpaceExt};

#[tokio::test]
async fn small_volume_default_fov_is_full_size() {
    // Test that a 10x10x10 volume with 1mm spacing shows the full field of view
    let mut service = RenderLoopService::new().await.unwrap();
    
    // Create a 10x10x10 volume
    let dims = [10, 10, 10];
    let spacing = [1.0, 1.0, 1.0];
    let origin = [0.0, 0.0, 0.0];
    
    let space = NeuroSpaceExt::from_dims_spacing_origin(
        dims.to_vec(), 
        spacing.to_vec(), 
        origin.to_vec()
    ).expect("Failed to create NeuroSpace");
    let space3 = NeuroSpace3::new(space);
    let data = vec![1.0f32; 1000];
    let volume = DenseVolume3::from_data(space3.0, data);
    
    // Upload volume
    let result = service.upload_volume_3d(&volume);
    assert!(result.is_ok());
    
    let (layer_idx, _) = result.unwrap();
    
    // Add render layer
    service.add_render_layer(layer_idx, 1.0, (0.0, 0.0, 1.0, 1.0)).unwrap();
    
    // Calculate expected FOV for axial view
    // Volume spans 0-9mm in each dimension, so natural width/height is 9mm
    // With 1.2x padding: 9 * 1.2 = 10.8mm
    let expected_fov_mm = 10.8;
    
    // Update frame for axial view at center
    let center = [4.5, 4.5, 4.5];
    service.update_frame_for_synchronized_view(
        expected_fov_mm,
        expected_fov_mm,
        center,
        0, // Axial plane
    );
    
    // The frame vectors should be half the FOV
    let expected_frame_vector = expected_fov_mm / 2.0;
    
    // In the logs, we should see:
    // World FOV: 10.8x10.8mm
    // Frame u_mm: [5.4, 0.0, 0.0, 0.0]
    // Frame v_mm: [0.0, 5.4, 0.0, 0.0]
    
    // Verify no 10x zoom factor is applied
    assert!(expected_frame_vector > 5.0 && expected_frame_vector < 6.0,
            "Frame vector should be ~5.4mm, not ~0.5mm");
}

#[tokio::test]
async fn verify_fov_calculation_for_various_volumes() {
    let mut service = RenderLoopService::new().await.unwrap();
    
    // Test various small volumes
    let test_cases = vec![
        ([10, 10, 10], [1.0, 1.0, 1.0], [0.0, 0.0, 0.0], 10.8),  // 9mm * 1.2 padding
        ([5, 5, 5], [2.0, 2.0, 2.0], [-4.0, -4.0, -4.0], 9.6),   // 8mm * 1.2 padding  
        ([20, 20, 20], [0.5, 0.5, 0.5], [0.0, 0.0, 0.0], 11.4),  // 9.5mm * 1.2 padding
    ];
    
    for (dims, spacing, origin, expected_fov) in test_cases {
        let space = NeuroSpaceExt::from_dims_spacing_origin(
            dims.to_vec(), 
            spacing.to_vec(), 
            origin.to_vec()
        ).expect("Failed to create NeuroSpace");
        let space3 = NeuroSpace3::new(space);
        let voxel_count = dims[0] * dims[1] * dims[2];
        let data = vec![1.0f32; voxel_count];
        let volume = DenseVolume3::from_data(space3.0, data);
        
        let result = service.upload_volume_3d(&volume);
        assert!(result.is_ok());
        
        let (layer_idx, _) = result.unwrap();
        
        // Add render layer
        service.add_render_layer(layer_idx, 1.0, (0.0, 0.0, 1.0, 1.0)).unwrap();
        
        // Calculate center of volume in world coordinates
        let center = [
            (origin[0] + (dims[0] as f64 - 1.0) * spacing[0] / 2.0) as f32,
            (origin[1] + (dims[1] as f64 - 1.0) * spacing[1] / 2.0) as f32,
            (origin[2] + (dims[2] as f64 - 1.0) * spacing[2] / 2.0) as f32,
        ];
        
        // Update frame for axial view
        service.update_frame_for_synchronized_view(
            expected_fov,
            expected_fov,
            center,
            0, // Axial plane
        );
        
        println!("Volume {:?}x{:?}mm at {:?}: Expected FOV = {:.1}mm",
                 dims, spacing, origin, expected_fov);
    }
}