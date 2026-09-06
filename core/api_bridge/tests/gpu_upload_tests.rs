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
        let textures = service.multi_texture_manager.as_ref().unwrap();
        assert_eq!(textures.resident_slot_count(), 0);
        assert_eq!(textures.free_slot_count(), textures.max_textures() as usize);
        assert_eq!(textures.resident_bytes(), 0);
    }
}

// Exercise the app's allocate-new / release-old replacement order, keeping a
// base volume and a second overlay alive throughout. Layer counts and legacy
// atlas metrics alone cannot detect leaked world-space 3D textures.
#[tokio::test]
async fn image_set_switches_reuse_gpu_textures() {
    use mock_helpers::*;
    use render_loop::view_state::{LayerConfig, SliceOrientation, ViewId, ViewState};

    let state = setup_test_state().await;
    let service = Arc::new(Mutex::new(
        RenderLoopService::new()
            .await
            .expect("GPU adapter required"),
    ));
    *state.render_loop_service.lock().await = Some(Arc::clone(&service));
    service.lock().await.load_shaders().unwrap();
    let mut active_ids = Vec::new();
    let mut previous_pixel = None;

    for member in 0..63 {
        let id = format!("member-{member}");
        let size = if member % 2 == 0 { 16 } else { 24 };
        let (mut volume, metadata) = create_test_volume([size; 3]);
        if let VolumeSendable::VolF32(ref mut data, _) = volume {
            *data = DenseVolume3::from_data(
                data.space().clone(),
                vec![if member % 2 == 0 { 0.25 } else { 0.75 }; size * size * size],
            );
        }
        state
            .volume_registry
            .lock()
            .await
            .insert(id.clone(), volume, metadata);
        let spec = LayerSpec::Volume(VolumeLayerSpec {
            id: id.clone(),
            source_resource_id: id.clone(),
            colormap: "gray".into(),
            slice_axis: None,
            slice_index: None,
        });
        request_layer_gpu_resources_for_testing(spec, None, &state)
            .await
            .unwrap_or_else(|error| panic!("member {member}: {error:?}"));
        if active_ids.len() == 3 {
            let old_id = active_ids.pop().unwrap();
            let released = release_layer_gpu_resources_for_testing(old_id, &state)
                .await
                .unwrap();
            assert!(released.success);
        }
        active_ids.push(id);
        let mut renderer = service.lock().await;
        renderer.queue.submit([]);
        renderer.device.poll(wgpu::Maintain::Wait);
        assert_eq!(renderer.active_layer_count(), active_ids.len());
        let textures = renderer.multi_texture_manager.as_ref().unwrap();
        assert_eq!(
            textures.resident_slot_count(),
            active_ids.len(),
            "member {member}"
        );
        assert_eq!(
            textures.free_slot_count(),
            textures.max_textures() as usize - active_ids.len()
        );
        let view = ViewState::from_basic_params(
            active_ids.last().unwrap().clone(),
            [4.; 3],
            SliceOrientation::Axial,
            8.,
            [16, 16],
            (0., 1.),
        )
        .with_crosshair(false)
        .with_layers(
            active_ids
                .iter()
                .map(|id| LayerConfig::new(id.clone()).with_intensity_window(0., 1.))
                .collect(),
        );
        let frame = renderer
            .request_frame(ViewId::new("switch"), view)
            .await
            .unwrap();
        let center = &frame.image_data[(8 * 16 + 8) * 4..][..4];
        assert_eq!(center[3], 255, "member {member} must remain visible");
        if let Some(previous) = previous_pixel {
            assert_ne!(
                center[0], previous,
                "member {member} rendered stale texture data"
            );
        }
        previous_pixel = Some(center[0]);
    }

    assert_eq!(
        service
            .lock()
            .await
            .multi_texture_manager
            .as_ref()
            .unwrap()
            .resident_slot_count(),
        3
    );
    for id in active_ids {
        assert!(
            release_layer_gpu_resources_for_testing(id, &state)
                .await
                .unwrap()
                .success
        );
    }
    let renderer = service.lock().await;
    let textures = renderer.multi_texture_manager.as_ref().unwrap();
    assert_eq!(textures.resident_slot_count(), 0);
    assert_eq!(textures.resident_bytes(), 0);
    for slot in 0..textures.max_textures() {
        assert!(renderer.get_volume_data_range(slot).is_none());
    }
}

// The GPU upload now runs on a blocking thread that acquires the render-service
// lock itself (see request_layer_gpu_resources off-reactor path). Fire several
// uploads concurrently: their blocking tasks contend on that lock, so a wrong
// lock ordering would hang here. Reaching the assertions proves no deadlock and
// that concurrent loads each get a distinct atlas layer.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn concurrent_layer_uploads_do_not_deadlock() {
    use mock_helpers::*;

    let state = setup_test_state().await;
    let render_service = RenderLoopService::new().await.expect("render loop");
    {
        let mut guard = state.render_loop_service.lock().await;
        *guard = Some(Arc::new(Mutex::new(render_service)));
    }

    let volume_id = "concurrent_volume".to_string();
    {
        let (vol, meta) = create_test_volume([32, 32, 32]);
        let mut registry = state.volume_registry.lock().await;
        registry.insert(volume_id.clone(), vol, meta);
    }

    let mk = |layer: &str| {
        LayerSpec::Volume(VolumeLayerSpec {
            id: layer.to_string(),
            source_resource_id: volume_id.clone(),
            colormap: "gray".to_string(),
            slice_axis: Some(SliceAxis::Axial),
            slice_index: Some(SliceIndex::Middle),
        })
    };

    let (a, b, c, d) = tokio::join!(
        request_layer_gpu_resources_for_testing(mk("c0"), None, &state),
        request_layer_gpu_resources_for_testing(mk("c1"), None, &state),
        request_layer_gpu_resources_for_testing(mk("c2"), None, &state),
        request_layer_gpu_resources_for_testing(mk("c3"), None, &state),
    );

    let infos = [
        a.expect("c0"),
        b.expect("c1"),
        c.expect("c2"),
        d.expect("c3"),
    ];

    // Each concurrent upload must get a distinct atlas layer.
    let mut indices: Vec<u32> = infos.iter().map(|i| i.atlas_layer_index).collect();
    indices.sort_unstable();
    indices.dedup();
    assert_eq!(
        indices.len(),
        4,
        "concurrent uploads must each get a distinct atlas layer"
    );

    let map = state.layer_to_atlas_map.lock().await;
    for id in ["c0", "c1", "c2", "c3"] {
        assert!(map.contains_key(id), "layer {id} should be registered");
    }
}

/// Optional local-file receipt, using the same decoder and GPU command as the app.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "set BRAINFLOW_TEST_NIFTI_PATH to a local 3D float32 NIfTI to test the real upload"]
async fn local_nifti_decode_and_gpu_upload() {
    let path = std::env::var("BRAINFLOW_TEST_NIFTI_PATH").expect("NIfTI path");
    let (volume, _) =
        nifti_loader::load_nifti_volume_auto(std::path::Path::new(&path)).expect("decode");
    assert!(matches!(&volume, VolumeSendable::VolF32(..)));
    let state = mock_helpers::setup_test_state().await;
    let renderer = RenderLoopService::new().await.expect("GPU renderer");
    *state.render_loop_service.lock().await = Some(Arc::new(Mutex::new(renderer)));
    state.volume_registry.lock().await.insert(
        "nifti".into(),
        volume,
        VolumeMetadataInfo {
            name: "NIfTI upload check".into(),
            path,
            dtype: "f32".into(),
            volume_type: VolumeType::Volume3D,
            time_series_info: None,
        },
    );
    let result = request_layer_gpu_resources_for_testing(
        LayerSpec::Volume(VolumeLayerSpec {
            id: "nifti-layer".into(),
            source_resource_id: "nifti".into(),
            colormap: "gray".into(),
            slice_axis: None,
            slice_index: None,
        }),
        None,
        &state,
    )
    .await;
    eprintln!("NIfTI GPU allocation result: {result:?}");
    let info = result.expect("real NIfTI must upload");
    let range = info.data_range.expect("finite display range");
    assert!(range.min.is_finite() && range.max.is_finite());
    assert!(range.min <= range.max);
    release_layer_gpu_resources_for_testing("nifti-layer".into(), &state)
        .await
        .expect("release");
}
