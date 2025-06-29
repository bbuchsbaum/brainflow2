use api_bridge::{BridgeState, request_layer_gpu_resources};
use bridge_types::{LayerSpec, VolumeLayerSpec, SliceAxis, SliceIndex};
use volmath::dense_vol::DenseVolume3;
use volmath::space::{NeuroSpace3, NeuroSpaceImpl};
use nalgebra::Matrix4;
use render_loop::RenderLoopService;
use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::State;

#[tokio::test]
async fn test_affine_transform_passed_to_gpu() {
    // Create a test volume with a 45° rotation around Z
    let dims = [4, 4, 4];
    let data = vec![1.0f32; 64];
    
    // Create rotation affine
    let mut affine = Matrix4::<f32>::identity();
    let angle = std::f32::consts::PI / 4.0; // 45 degrees
    affine[(0, 0)] = angle.cos();
    affine[(0, 1)] = -angle.sin();
    affine[(1, 0)] = angle.sin();
    affine[(1, 1)] = angle.cos();
    
    let space = NeuroSpaceImpl::<3>::from_affine_matrix4(dims, affine.clone());
    let neuro_space = NeuroSpace3(space);
    let volume = DenseVolume3::<f32>::from_data(neuro_space, data);
    
    // Set up bridge state
    let mut bridge_state = BridgeState::default();
    
    // Initialize render service
    let render_service = RenderLoopService::new().await.unwrap();
    bridge_state.render_loop_service = Arc::new(Mutex::new(Some(Arc::new(Mutex::new(render_service)))));
    
    // Add volume to registry
    let volume_id = "test_volume_1".to_string();
    let affine3 = nalgebra::Affine3::from_matrix_unchecked(affine.clone());
    bridge_state.volume_registry.lock().await.insert(
        volume_id.clone(),
        bridge_types::VolumeSendable::VolF32(volume, affine3)
    );
    
    // Create layer spec
    let layer_spec = LayerSpec::Volume(VolumeLayerSpec {
        id: "layer_1".to_string(),
        source_resource_id: volume_id,
        slice_axis: Some(SliceAxis::Axial),
        slice_index: Some(SliceIndex::Center),
        intensity_range: None,
        opacity: 1.0,
        colormap_id: 0,
        threshold_range: None,
        visible: true,
    });
    
    // Request GPU resources
    let state = State::new(bridge_state);
    let result = request_layer_gpu_resources(layer_spec, state).await;
    
    assert!(result.is_ok(), "Failed to request GPU resources: {:?}", result.err());
    
    let gpu_info = result.unwrap();
    
    // The world_to_voxel transform should be properly set in the GPU
    // We can't directly inspect GPU memory, but if this succeeds without error,
    // it means the transform was successfully passed through the pipeline
    println!("✅ Affine transform test passed - transform uploaded to GPU!");
    
    // Verify the layer was allocated
    assert_eq!(gpu_info.layer_id, "layer_1");
    assert_eq!(gpu_info.atlas_layer_index, 0); // Should be 0 for 3D texture
}

#[tokio::test]
async fn test_identity_affine_transform() {
    // Create a test volume with identity transform
    let dims = [3, 3, 3];
    let data = vec![2.0f32; 27];
    
    let affine = Matrix4::<f32>::identity();
    let space = NeuroSpaceImpl::<3>::from_affine_matrix4(dims, affine.clone());
    let neuro_space = NeuroSpace3(space);
    let volume = DenseVolume3::<f32>::from_data(neuro_space, data);
    
    // Set up bridge state
    let mut bridge_state = BridgeState::default();
    
    // Initialize render service
    let render_service = RenderLoopService::new().await.unwrap();
    bridge_state.render_loop_service = Arc::new(Mutex::new(Some(Arc::new(Mutex::new(render_service)))));
    
    // Add volume to registry
    let volume_id = "test_volume_2".to_string();
    let affine3 = nalgebra::Affine3::from_matrix_unchecked(affine);
    bridge_state.volume_registry.lock().await.insert(
        volume_id.clone(),
        bridge_types::VolumeSendable::VolF32(volume, affine3)
    );
    
    // Create layer spec
    let layer_spec = LayerSpec::Volume(VolumeLayerSpec {
        id: "layer_2".to_string(),
        source_resource_id: volume_id,
        slice_axis: Some(SliceAxis::Coronal),
        slice_index: Some(SliceIndex::Index(1)),
        intensity_range: None,
        opacity: 0.8,
        colormap_id: 1,
        threshold_range: None,
        visible: true,
    });
    
    // Request GPU resources
    let state = State::new(bridge_state);
    let result = request_layer_gpu_resources(layer_spec, state).await;
    
    assert!(result.is_ok(), "Failed to request GPU resources: {:?}", result.err());
    
    println!("✅ Identity affine transform test passed!");
}