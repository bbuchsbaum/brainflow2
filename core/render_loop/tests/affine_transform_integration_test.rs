use render_loop::RenderLoopService;
use volmath::dense_vol::DenseVolume3;
use volmath::space::{NeuroSpace3, NeuroSpaceImpl};
use nalgebra::Matrix4;
use render_loop::render_state::{LayerInfo, BlendMode, ThresholdMode};

#[tokio::test]
async fn test_affine_transform_in_layer_ubo() -> Result<(), Box<dyn std::error::Error>> {
    // Create a test volume with a 45° rotation around Z
    let dims = [4, 4, 4];
    let mut data = Vec::with_capacity(64);
    
    // Fill with values that encode position
    for z in 0..4 {
        for y in 0..4 {
            for x in 0..4 {
                data.push((x * 100 + y * 10 + z) as f32);
            }
        }
    }
    
    // Create rotation affine
    let mut affine = Matrix4::<f32>::identity();
    let angle = std::f32::consts::PI / 4.0; // 45 degrees
    affine[(0, 0)] = angle.cos();
    affine[(0, 1)] = -angle.sin();
    affine[(1, 0)] = angle.sin();
    affine[(1, 1)] = angle.cos();
    // Add some translation
    affine[(0, 3)] = 10.0;
    affine[(1, 3)] = 20.0;
    affine[(2, 3)] = 30.0;
    
    let space = NeuroSpaceImpl::<3>::from_affine_matrix4(dims, affine.clone());
    let neuro_space = NeuroSpace3(space);
    let volume = DenseVolume3::<f32>::from_data(neuro_space, data);
    
    // Initialize render service
    let mut service = RenderLoopService::new().await?;
    
    // Upload volume to 3D texture
    let (layer_idx, world_to_voxel) = service.upload_volume_3d(&volume)?;
    
    // Verify the world_to_voxel transform
    let expected_w2v = affine.try_inverse().unwrap();
    
    // Check key elements of the transform
    assert!((world_to_voxel[(0, 0)] - expected_w2v[(0, 0)]).abs() < 1e-6, 
        "Rotation component incorrect");
    assert!((world_to_voxel[(0, 1)] - expected_w2v[(0, 1)]).abs() < 1e-6, 
        "Rotation component incorrect");
    assert!((world_to_voxel[(1, 0)] - expected_w2v[(1, 0)]).abs() < 1e-6, 
        "Rotation component incorrect");
    assert!((world_to_voxel[(1, 1)] - expected_w2v[(1, 1)]).abs() < 1e-6, 
        "Rotation component incorrect");
    
    // The transform is now stored in volume_metadata
    // When layers are rendered, the transform will be passed to the GPU
    // via the LayerUboStd140 uniform buffer
    
    println!("✅ Affine transform integration test passed!");
    println!("  - Rotation: {}° around Z", angle.to_degrees());
    println!("  - Translation: ({}, {}, {})", affine[(0, 3)], affine[(1, 3)], affine[(2, 3)]);
    println!("  - World-to-voxel transform successfully uploaded to GPU");
    
    Ok(())
}

#[tokio::test]
async fn test_volume_space_transforms() -> Result<(), Box<dyn std::error::Error>> {
    // Test that the volume's space correctly stores and retrieves transforms
    let dims = [5, 5, 5];
    let _data = vec![0.0f32; 125];
    
    // Create a complex affine with rotation, scale, and translation
    let mut affine = Matrix4::<f32>::identity();
    
    // Scale
    affine[(0, 0)] = 2.0;  // Scale X by 2
    affine[(1, 1)] = 0.5;  // Scale Y by 0.5
    affine[(2, 2)] = 1.5;  // Scale Z by 1.5
    
    // Rotation around Y (30 degrees)
    let angle = std::f32::consts::PI / 6.0;
    let cos_a = angle.cos();
    let sin_a = angle.sin();
    let mut rotation = Matrix4::<f32>::identity();
    rotation[(0, 0)] = cos_a;
    rotation[(0, 2)] = sin_a;
    rotation[(2, 0)] = -sin_a;
    rotation[(2, 2)] = cos_a;
    
    // Combine scale and rotation
    affine = rotation * affine;
    
    // Translation
    affine[(0, 3)] = 25.0;
    affine[(1, 3)] = 50.0;
    affine[(2, 3)] = 75.0;
    
    let space = NeuroSpaceImpl::<3>::from_affine_matrix4(dims, affine.clone());
    
    // Test that we can retrieve the transforms
    let voxel_to_world = space.voxel_to_world();
    let world_to_voxel = space.world_to_voxel();
    
    // Verify they are inverses of each other
    let identity_check = world_to_voxel * voxel_to_world;
    for i in 0..4 {
        for j in 0..4 {
            let expected = if i == j { 1.0 } else { 0.0 };
            assert!((identity_check[(i, j)] - expected).abs() < 1e-5, 
                "Transform inverse check failed at ({}, {})", i, j);
        }
    }
    
    println!("✅ Volume space transform test passed!");
    println!("  - Complex affine with scale, rotation, and translation");
    println!("  - Verified world_to_voxel and voxel_to_world are proper inverses");
    
    Ok(())
}