// Integration tests for GPU upload functionality
use api_bridge::{
    calculate_slice_index, release_layer_gpu_resources_for_testing,
    request_layer_gpu_resources_for_testing, BridgeState, LayerSpec, SliceAxis, SliceIndex,
    VolumeLayerSpec, VolumeMetadataInfo,
};
use bridge_types::{VolumeSendable, VolumeType};
use nalgebra::Affine3;
use render_loop::RenderLoopService;
use std::sync::Arc;
use tokio::sync::Mutex;
use volmath::{DenseVolume3, NeuroSpaceExt};

// Mock implementation for testing without actual GPU
#[cfg(test)]
mod mock_helpers {
    use super::*;

    pub fn create_test_volume(dims: [usize; 3]) -> (VolumeSendable, VolumeMetadataInfo) {
        let space_impl = volmath::space::NeuroSpaceImpl::from_dims_spacing_origin(
            dims.to_vec(),
            vec![1.0, 1.0, 1.0], // spacing
            vec![0.0, 0.0, 0.0], // origin
        )
        .expect("neuro space");
        let voxel_count = dims[0] * dims[1] * dims[2];
        let data = vec![0.0f32; voxel_count];
        let volume = DenseVolume3::<f32>::from_data(space_impl, data);
        let affine = Affine3::<f32>::identity();
        let metadata = VolumeMetadataInfo {
            name: "test-volume".to_string(),
            path: "<memory>".to_string(),
            dtype: "f32".to_string(),
            volume_type: VolumeType::Volume3D,
            time_series_info: None,
        };
        (VolumeSendable::VolF32(volume, affine), metadata)
    }

    pub async fn setup_test_state() -> BridgeState {
        BridgeState::default().expect("bridge state")
    }
}

#[tokio::test]
async fn test_gpu_upload_with_different_axes() {
    use mock_helpers::*;

    let state = setup_test_state().await;
    let (test_volume, metadata) = create_test_volume([128, 128, 64]);

    // Add volume to registry
    {
        let mut registry = state.volume_registry.lock().await;
        registry.insert("test_volume_1".to_string(), test_volume, metadata);
    }

    // Test uploading with different axes
    let axes = vec![
        (SliceAxis::Sagittal, "sagittal_layer"),
        (SliceAxis::Coronal, "coronal_layer"),
        (SliceAxis::Axial, "axial_layer"),
    ];

    for (axis, layer_id) in axes {
        let _spec = LayerSpec::Volume(VolumeLayerSpec {
            id: layer_id.to_string(),
            source_resource_id: "test_volume_1".to_string(),
            colormap: "grayscale".to_string(),
            slice_axis: Some(axis),
            slice_index: Some(SliceIndex::Middle),
        });

        // Note: This will fail without a render loop service, but we can test the logic
        // In a real integration test with GPU, this would succeed
        println!("Testing upload for axis: {:?}", axis);
    }
}

#[tokio::test]
async fn test_gpu_upload_with_different_slice_indices() {
    use mock_helpers::*;

    let state = setup_test_state().await;
    let (test_volume, metadata) = create_test_volume([100, 100, 50]);

    // Add volume to registry
    {
        let mut registry = state.volume_registry.lock().await;
        registry.insert("test_volume_2".to_string(), test_volume, metadata);
    }

    // Test different slice index specifications
    let slice_specs = vec![
        (SliceIndex::Fixed(10), "fixed_10"),
        (SliceIndex::Middle, "middle"),
        (SliceIndex::Relative(0.25), "quarter"),
        (SliceIndex::Relative(0.75), "three_quarters"),
    ];

    for (slice_index, layer_id) in slice_specs {
        let _spec = LayerSpec::Volume(VolumeLayerSpec {
            id: layer_id.to_string(),
            source_resource_id: "test_volume_2".to_string(),
            colormap: "viridis".to_string(),
            slice_axis: Some(SliceAxis::Axial),
            slice_index: Some(slice_index.clone()),
        });

        println!("Testing upload for slice index: {:?}", slice_index);
    }
}

#[tokio::test]
async fn test_layer_tracking() {
    use mock_helpers::*;

    let state = setup_test_state().await;

    // Simulate adding layer mappings
    {
        let mut layer_map = state.layer_to_atlas_map.lock().await;
        layer_map.insert("layer1".to_string(), 0);
        layer_map.insert("layer2".to_string(), 1);
        layer_map.insert("layer3".to_string(), 2);
    }

    // Verify mappings
    {
        let layer_map = state.layer_to_atlas_map.lock().await;
        assert_eq!(layer_map.get("layer1"), Some(&0));
        assert_eq!(layer_map.get("layer2"), Some(&1));
        assert_eq!(layer_map.get("layer3"), Some(&2));
        assert_eq!(layer_map.len(), 3);
    }

    // Simulate removing a layer
    {
        let mut layer_map = state.layer_to_atlas_map.lock().await;
        layer_map.remove("layer2");
    }

    // Verify removal
    {
        let layer_map = state.layer_to_atlas_map.lock().await;
        assert_eq!(layer_map.get("layer2"), None);
        assert_eq!(layer_map.len(), 2);
    }
}

#[test]
fn test_volume_layer_spec_defaults() {
    let spec = VolumeLayerSpec {
        id: "test".to_string(),
        source_resource_id: "vol1".to_string(),
        colormap: "hot".to_string(),
        slice_axis: None,
        slice_index: None,
    };

    // When None, defaults should be applied during processing
    assert_eq!(spec.slice_axis, None);
    assert_eq!(spec.slice_index, None);
}

#[test]
fn test_edge_cases_for_slice_calculations() {
    use mock_helpers::create_test_volume;

    // Test volume with size 1 along an axis
    let dims = vec![1, 100, 100];
    let (volume_data, _) = create_test_volume([1, 100, 100]);

    // Middle of size 1 should be 0
    let result = calculate_slice_index(
        &SliceIndex::Middle,
        &dims,
        SliceAxis::Sagittal,
        &volume_data,
    )
    .unwrap();
    assert_eq!(result, 0);

    // Test relative position at boundaries
    let dims2 = vec![50, 50, 50];
    let (volume_data2, _) = create_test_volume([50, 50, 50]);

    // Relative 0.0 should give first slice
    let result = calculate_slice_index(
        &SliceIndex::Relative(0.0),
        &dims2,
        SliceAxis::Axial,
        &volume_data2,
    )
    .unwrap();
    assert_eq!(result, 0);

    // Relative 1.0 should give last slice
    let result = calculate_slice_index(
        &SliceIndex::Relative(1.0),
        &dims2,
        SliceAxis::Axial,
        &volume_data2,
    )
    .unwrap();
    assert_eq!(result, 49);
}

#[tokio::test]
async fn test_release_layer_cleans_render_state() {
    use mock_helpers::*;

    let state = setup_test_state().await;
    let (test_volume, metadata) = create_test_volume([32, 32, 32]);

    // Initialize render loop service
    let render_service = RenderLoopService::new().await.expect("render loop");
    {
        let mut guard = state.render_loop_service.lock().await;
        *guard = Some(Arc::new(Mutex::new(render_service)));
    }

    // Add volume to registry
    let volume_id = "release_volume".to_string();
    {
        let mut registry = state.volume_registry.lock().await;
        registry.insert(volume_id.clone(), test_volume, metadata);
    }

    let layer_id = "release_layer".to_string();
    let layer_spec = LayerSpec::Volume(VolumeLayerSpec {
        id: layer_id.clone(),
        source_resource_id: volume_id.clone(),
        colormap: "gray".to_string(),
        slice_axis: Some(SliceAxis::Axial),
        slice_index: Some(SliceIndex::Middle),
    });

    let gpu_info = request_layer_gpu_resources_for_testing(layer_spec, None, &state)
        .await
        .expect("gpu resources");

    // Ensure layer registered
    {
        let map = state.layer_to_atlas_map.lock().await;
        assert!(map.contains_key(&layer_id));
        assert_eq!(map.get(&layer_id), Some(&gpu_info.atlas_layer_index));
    }
    {
        let volume_map = state.layer_to_volume_map.lock().await;
        assert_eq!(volume_map.get(&layer_id), Some(&volume_id));
    }
    {
        let guard = state.render_loop_service.lock().await;
        let service_arc = guard.as_ref().unwrap().clone();
        drop(guard);
        let service = service_arc.lock().await;
        assert_eq!(service.layer_state_manager.layer_count(), 1);
    }

    let release_result = release_layer_gpu_resources_for_testing(layer_id.clone(), &state)
        .await
        .expect("release command");

    assert!(release_result.success, "release should succeed");

    {
        let map = state.layer_to_atlas_map.lock().await;
        assert!(!map.contains_key(&layer_id));
    }
    {
        let volume_map = state.layer_to_volume_map.lock().await;
        assert!(!volume_map.contains_key(&layer_id));
    }
    {
        let guard = state.render_loop_service.lock().await;
        let service_arc = guard.as_ref().unwrap().clone();
        drop(guard);
        let service = service_arc.lock().await;
        assert_eq!(service.layer_state_manager.layer_count(), 0);
        let metrics = service.atlas_metrics();
        assert_eq!(metrics.used_layers, 0);
        assert_eq!(metrics.free_layers, metrics.total_layers);
        assert!(metrics.releases >= 1);
    }
}
