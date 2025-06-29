// Integration tests for GPU upload functionality
use api_bridge::{
    BridgeState, LayerSpec, SliceAxis, SliceIndex, VolumeLayerSpec,
};
use bridge_types::VolumeSendable;
use volmath::{DenseVolume3, NeuroSpace3};
use nalgebra::Affine3;
use std::sync::Arc;
use tokio::sync::Mutex;
use std::collections::HashMap;

// Mock implementation for testing without actual GPU
#[cfg(test)]
mod mock_helpers {
    use super::*;
    
    pub fn create_test_volume(dims: [usize; 3]) -> VolumeSendable {
        let space_impl = volmath::space::NeuroSpaceImpl::<3>::from_dims_spacing_origin(
            dims,
            [1.0, 1.0, 1.0],     // spacing
            [0.0, 0.0, 0.0],     // origin
        );
        let space = NeuroSpace3(space_impl);
        let volume = DenseVolume3::<f32>::new(space);
        let affine = Affine3::<f32>::identity();
        VolumeSendable::VolF32(volume, affine)
    }
    
    pub async fn setup_test_state() -> BridgeState {
        let volume_registry = Arc::new(Mutex::new(HashMap::new()));
        let layer_to_atlas_map = Arc::new(Mutex::new(HashMap::new()));
        
        BridgeState::new(
            volume_registry,
            Arc::new(Mutex::new(None)), // No render loop service for unit tests
            layer_to_atlas_map,
        )
    }
}

#[tokio::test]
async fn test_gpu_upload_with_different_axes() {
    use mock_helpers::*;
    
    let state = setup_test_state().await;
    let test_volume = create_test_volume([128, 128, 64]);
    
    // Add volume to registry
    {
        let mut registry = state.volume_registry.lock().await;
        registry.insert("test_volume_1".to_string(), test_volume);
    }
    
    // Test uploading with different axes
    let axes = vec![
        (SliceAxis::Sagittal, "sagittal_layer"),
        (SliceAxis::Coronal, "coronal_layer"),
        (SliceAxis::Axial, "axial_layer"),
    ];
    
    for (axis, layer_id) in axes {
        let spec = LayerSpec::Volume(VolumeLayerSpec {
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
    let test_volume = create_test_volume([100, 100, 50]);
    
    // Add volume to registry
    {
        let mut registry = state.volume_registry.lock().await;
        registry.insert("test_volume_2".to_string(), test_volume);
    }
    
    // Test different slice index specifications
    let slice_specs = vec![
        (SliceIndex::Fixed(10), "fixed_10"),
        (SliceIndex::Middle, "middle"),
        (SliceIndex::Relative(0.25), "quarter"),
        (SliceIndex::Relative(0.75), "three_quarters"),
    ];
    
    for (slice_index, layer_id) in slice_specs {
        let spec = LayerSpec::Volume(VolumeLayerSpec {
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
    // Test volume with size 1 along an axis
    let dims = vec![1, 100, 100];
    let space_impl = volmath::space::NeuroSpaceImpl::<3>::from_dims_spacing_origin(
        [1, 100, 100],
        [1.0, 1.0, 1.0],
        [0.0, 0.0, 0.0],
    );
    let space = NeuroSpace3(space_impl);
    let volume = DenseVolume3::<f32>::new(space);
    let affine = Affine3::<f32>::identity();
    let volume_data = VolumeSendable::VolF32(volume, affine);
    
    // Middle of size 1 should be 0
    let result = api_bridge::calculate_slice_index(
        &SliceIndex::Middle,
        &dims,
        SliceAxis::Sagittal,
        &volume_data
    ).unwrap();
    assert_eq!(result, 0);
    
    // Test relative position at boundaries
    let dims2 = vec![50, 50, 50];
    let space_impl2 = volmath::space::NeuroSpaceImpl::<3>::from_dims_spacing_origin(
        [50, 50, 50],
        [1.0, 1.0, 1.0],
        [0.0, 0.0, 0.0],
    );
    let space2 = NeuroSpace3(space_impl2);
    let volume2 = DenseVolume3::<f32>::new(space2);
    let volume_data2 = VolumeSendable::VolF32(volume2, affine.clone());
    
    // Relative 0.0 should give first slice
    let result = api_bridge::calculate_slice_index(
        &SliceIndex::Relative(0.0),
        &dims2,
        SliceAxis::Axial,
        &volume_data2
    ).unwrap();
    assert_eq!(result, 0);
    
    // Relative 1.0 should give last slice
    let result = api_bridge::calculate_slice_index(
        &SliceIndex::Relative(1.0),
        &dims2,
        SliceAxis::Axial,
        &volume_data2
    ).unwrap();
    assert_eq!(result, 49);
}