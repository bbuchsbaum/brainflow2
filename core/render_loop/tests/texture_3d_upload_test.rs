use render_loop::{RenderLoopService, RenderLoopError};
use volmath::dense_vol::DenseVolume3;
use volmath::space::{NeuroSpace3, NeuroSpaceImpl};
use nalgebra::Matrix4;

#[tokio::test]
async fn test_3d_texture_upload() -> Result<(), RenderLoopError> {
    // Create a 3x3x3 volume with unique values
    let dims = [3, 3, 3];
    let mut data = Vec::with_capacity(27);
    
    // Fill with values that encode position: value = x*100 + y*10 + z
    for z in 0..3 {
        for y in 0..3 {
            for x in 0..3 {
                data.push((x * 100 + y * 10 + z) as f32);
            }
        }
    }
    
    // Create identity space
    let affine = Matrix4::<f32>::identity();
    let space = NeuroSpaceImpl::<3>::from_affine_matrix4(dims, affine);
    let neuro_space = NeuroSpace3(space);
    let volume = DenseVolume3::<f32>::from_data(neuro_space, data);
    
    // Initialize render service
    let mut service = RenderLoopService::new().await?;
    
    // Upload volume to 3D texture
    let (layer_idx, world_to_voxel) = service.upload_volume_3d(&volume)?;
    
    // Verify results
    assert_eq!(layer_idx, 0, "3D texture should always use layer index 0");
    
    // Check that world_to_voxel is the identity matrix (since we used identity affine)
    for i in 0..4 {
        for j in 0..4 {
            let expected = if i == j { 1.0 } else { 0.0 };
            assert!((world_to_voxel[(i, j)] - expected).abs() < 1e-6, 
                "World-to-voxel transform incorrect at ({}, {})", i, j);
        }
    }
    
    println!("✅ 3D texture upload test passed!");
    Ok(())
}

#[tokio::test]
async fn test_3d_texture_with_rotation() -> Result<(), RenderLoopError> {
    // Create a 4x4x4 volume
    let dims = [4, 4, 4];
    let data = vec![1.0f32; 64]; // Dummy data
    
    // Create 45° rotation around Z axis
    let mut affine = Matrix4::<f32>::identity();
    let angle = std::f32::consts::PI / 4.0; // 45 degrees
    affine[(0, 0)] = angle.cos();
    affine[(0, 1)] = -angle.sin();
    affine[(1, 0)] = angle.sin();
    affine[(1, 1)] = angle.cos();
    
    let space = NeuroSpaceImpl::<3>::from_affine_matrix4(dims, affine.clone());
    let neuro_space = NeuroSpace3(space);
    let volume = DenseVolume3::<f32>::from_data(neuro_space, data);
    
    // Initialize render service
    let mut service = RenderLoopService::new().await?;
    
    // Upload volume to 3D texture
    let (layer_idx, world_to_voxel) = service.upload_volume_3d(&volume)?;
    
    assert_eq!(layer_idx, 0);
    
    // World-to-voxel should be inverse of affine
    let expected_w2v = affine.try_inverse().unwrap();
    
    for i in 0..4 {
        for j in 0..4 {
            assert!((world_to_voxel[(i, j)] - expected_w2v[(i, j)]).abs() < 1e-6, 
                "World-to-voxel transform incorrect at ({}, {}): got {}, expected {}", 
                i, j, world_to_voxel[(i, j)], expected_w2v[(i, j)]);
        }
    }
    
    println!("✅ 3D texture with rotation test passed!");
    Ok(())
}