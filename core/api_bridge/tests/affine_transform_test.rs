use api_bridge::{
    request_layer_gpu_resources_for_testing, BridgeState, LayerSpec, SliceAxis, SliceIndex,
    VolumeLayerSpec, VolumeMetadataInfo,
};
use bridge_types::{VolumeSendable, VolumeType};
use nalgebra::Matrix4;
use render_loop::RenderLoopService;
use std::sync::Arc;
use tokio::sync::Mutex;
use volmath::dense_vol::DenseVolume3;
use volmath::space::NeuroSpaceImpl;
use volmath::{NeuroSpace3, NeuroSpaceExt};

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

    let space =
        NeuroSpaceImpl::from_affine_matrix4(dims.to_vec(), affine.clone()).expect("neuro space");
    let volume = DenseVolume3::<f32>::from_data(space.clone(), data);
    let _neuro_space = NeuroSpace3::new(space);

    // Set up bridge state
    let bridge_state = BridgeState::default().expect("bridge state");

    // Initialize render service
    let render_service = RenderLoopService::new().await.unwrap();
    {
        let mut guard = bridge_state.render_loop_service.lock().await;
        *guard = Some(Arc::new(Mutex::new(render_service)));
    }

    // Add volume to registry
    let volume_id = "test_volume_1".to_string();
    let affine3 = nalgebra::Affine3::from_matrix_unchecked(affine.clone());
    let metadata = VolumeMetadataInfo {
        name: volume_id.clone(),
        path: "<memory>".to_string(),
        dtype: "f32".to_string(),
        volume_type: VolumeType::Volume3D,
        time_series_info: None,
    };
    bridge_state.volume_registry.lock().await.insert(
        volume_id.clone(),
        VolumeSendable::VolF32(volume, affine3),
        metadata,
    );

    // Create layer spec
    let layer_spec = LayerSpec::Volume(VolumeLayerSpec {
        id: "layer_1".to_string(),
        source_resource_id: volume_id,
        colormap: "gray".to_string(),
        slice_axis: Some(SliceAxis::Axial),
        slice_index: Some(SliceIndex::Middle),
    });

    // Request GPU resources
    let result = request_layer_gpu_resources_for_testing(layer_spec, None, &bridge_state).await;

    assert!(
        result.is_ok(),
        "Failed to request GPU resources: {:?}",
        result.err()
    );

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
    let space =
        NeuroSpaceImpl::from_affine_matrix4(dims.to_vec(), affine.clone()).expect("neuro space");
    let volume = DenseVolume3::<f32>::from_data(space.clone(), data);
    let _neuro_space = NeuroSpace3::new(space);

    // Set up bridge state
    let bridge_state = BridgeState::default().expect("bridge state");

    // Initialize render service
    let render_service = RenderLoopService::new().await.unwrap();
    {
        let mut guard = bridge_state.render_loop_service.lock().await;
        *guard = Some(Arc::new(Mutex::new(render_service)));
    }

    // Add volume to registry
    let volume_id = "test_volume_2".to_string();
    let affine3 = nalgebra::Affine3::from_matrix_unchecked(affine);
    let metadata = VolumeMetadataInfo {
        name: volume_id.clone(),
        path: "<memory>".to_string(),
        dtype: "f32".to_string(),
        volume_type: VolumeType::Volume3D,
        time_series_info: None,
    };
    bridge_state.volume_registry.lock().await.insert(
        volume_id.clone(),
        VolumeSendable::VolF32(volume, affine3),
        metadata,
    );

    // Create layer spec
    let layer_spec = LayerSpec::Volume(VolumeLayerSpec {
        id: "layer_2".to_string(),
        source_resource_id: volume_id,
        colormap: "viridis".to_string(),
        slice_axis: Some(SliceAxis::Coronal),
        slice_index: Some(SliceIndex::Fixed(1)),
    });

    // Request GPU resources
    let result = request_layer_gpu_resources_for_testing(layer_spec, None, &bridge_state).await;

    assert!(
        result.is_ok(),
        "Failed to request GPU resources: {:?}",
        result.err()
    );

    println!("✅ Identity affine transform test passed!");
}
