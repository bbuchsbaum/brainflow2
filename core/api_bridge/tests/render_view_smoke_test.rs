use std::{convert::TryInto, path::PathBuf, sync::Arc};

use api_bridge::{
    render_view_for_testing, render_view_with_diagnostics_for_testing, render_views_for_testing,
    render_views_with_diagnostics_for_testing, submit_view_with_diagnostics_for_testing,
    BridgeState, VolumeMetadataInfo,
};
use bridge_types::{BridgeError, TimeSeriesInfo, VolumeSendable, VolumeType};
use render_loop::view_state::FrameReadbackMode;
use render_loop::{RenderLoopError, RenderLoopService};
use serde_json::json;
use tokio::sync::Mutex;
use volmath::{DenseNeuroVec, NeuroSpace};

fn get_test_data_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("test-data")
        .join("unit")
}

fn count_non_zero_rgba_pixels(bytes: &[u8]) -> usize {
    bytes
        .chunks_exact(4)
        .filter(|pixel| pixel[0] > 0 || pixel[1] > 0 || pixel[2] > 0)
        .count()
}

fn decode_raw_rgba_frame(bytes: &[u8]) -> (u32, u32, &[u8]) {
    let width = u32::from_le_bytes(bytes[0..4].try_into().unwrap());
    let height = u32::from_le_bytes(bytes[4..8].try_into().unwrap());
    let rgba = &bytes[8..];
    assert_eq!(rgba.len(), (width * height * 4) as usize);
    (width, height, rgba)
}

fn assert_has_visible_content(bytes: &[u8], width: u32, height: u32) {
    let coverage = count_non_zero_rgba_pixels(bytes) as f32 / (width * height) as f32;
    assert!(
        coverage > 0.001,
        "expected visible image content, got {:.4}% non-black coverage",
        coverage * 100.0
    );
}

fn view_vectors(view: &str) -> ([f32; 3], [f32; 3], [f32; 4], [f32; 4], [f32; 4]) {
    match view {
        "sagittal" => (
            [5.0, 0.0, 0.0],
            [0.0, 10.0, 0.0],
            [5.0, 0.0, 0.0, 1.0],
            [0.0, 10.0, 0.0, 0.0],
            [0.0, 0.0, 10.0, 0.0],
        ),
        "coronal" => (
            [0.0, 5.0, 0.0],
            [10.0, 0.0, 0.0],
            [0.0, 5.0, 0.0, 1.0],
            [10.0, 0.0, 0.0, 0.0],
            [0.0, 0.0, 10.0, 0.0],
        ),
        _ => (
            [0.0, 0.0, 5.0],
            [10.0, 0.0, 0.0],
            [0.0, 0.0, 5.0, 1.0],
            [10.0, 0.0, 0.0, 0.0],
            [0.0, 10.0, 0.0, 0.0],
        ),
    }
}

fn make_4d_volume_sendable() -> VolumeSendable {
    let dims = vec![8usize, 8, 8, 4];
    let spacing = vec![2.0, 2.0, 2.0, 1.0];
    let origin = vec![-8.0, -8.0, -8.0, 0.0];
    let space = NeuroSpace::new(dims, Some(spacing), Some(origin), None, None).unwrap();
    let vec4d = DenseNeuroVec::zeros(space).unwrap();
    VolumeSendable::Vec4DF32(vec4d)
}

async fn install_render_service_or_skip(bridge_state: &BridgeState) -> bool {
    let render_service = match RenderLoopService::new().await {
        Ok(service) => service,
        Err(RenderLoopError::AdapterRequestFailed | RenderLoopError::AdapterNotFound) => {
            eprintln!("Skipping render_view_smoke_test: no WGPU adapter available");
            return false;
        }
        Err(error) => panic!("initialize render loop: {error:?}"),
    };

    let mut slot = bridge_state.render_loop_service.lock().await;
    *slot = Some(Arc::new(Mutex::new(render_service)));
    true
}

#[tokio::test]
async fn render_view_returns_rgba_buffer() {
    let bridge_state = BridgeState::default().expect("bridge state");

    if !install_render_service_or_skip(&bridge_state).await {
        return;
    }

    let test_file = get_test_data_path().join("toy_t1w.nii.gz");
    assert!(test_file.exists(), "test volume missing: {:?}", test_file);

    let (volume_sendable, _affine) =
        nifti_loader::load_nifti_volume_auto(&test_file).expect("load nifti volume");

    let volume_id = "unit-test-volume".to_string();
    let metadata = VolumeMetadataInfo {
        name: volume_id.clone(),
        path: test_file.to_string_lossy().into_owned(),
        dtype: "f32".into(),
        volume_type: VolumeType::Volume3D,
        time_series_info: None,
    };

    {
        let mut registry = bridge_state.volume_registry.lock().await;
        registry.insert(volume_id.clone(), volume_sendable, metadata);
    }

    let width = 128u32;
    let height = 128u32;
    let (axial_origin_3d, axial_u_3d, axial_origin, axial_u, axial_v) = view_vectors("axial");
    let (sagittal_origin_3d, sagittal_u_3d, _, _, _) = view_vectors("sagittal");
    let (coronal_origin_3d, coronal_u_3d, _, _, _) = view_vectors("coronal");

    let payload = json!({
        "views": {
            "axial": {
                "origin_mm": axial_origin_3d,
                "u_mm": axial_u_3d,
                "v_mm": [0.0, 10.0, 0.0]
            },
            "sagittal": {
                "origin_mm": sagittal_origin_3d,
                "u_mm": sagittal_u_3d,
                "v_mm": [0.0, 0.0, 10.0]
            },
            "coronal": {
                "origin_mm": coronal_origin_3d,
                "u_mm": coronal_u_3d,
                "v_mm": [0.0, 0.0, 10.0]
            }
        },
        "crosshair": {"world_mm": [5.0, 5.0, 5.0], "visible": false},
        "layers": [{
            "id": "layer-main",
            "volumeId": volume_id,
            "visible": true,
            "opacity": 1.0,
            "colormap": "gray",
            "intensity": [0.0, 1000.0],
            "threshold": [0.0, 0.0],
            "blendMode": "alpha",
            "interpolation": "linear"
        }],
        "requestedView": {
            "type": "axial",
            "origin_mm": axial_origin,
            "u_mm": axial_u,
            "v_mm": axial_v,
            "width": width,
            "height": height
        }
    });

    let result = render_view_for_testing(payload.to_string(), &bridge_state, Some("rgba"))
        .await
        .expect("render_view_for_testing succeeded");

    assert!(result.len() > 8, "expected rgba buffer plus header");

    let width_bytes: [u8; 4] = result[0..4].try_into().unwrap();
    let height_bytes: [u8; 4] = result[4..8].try_into().unwrap();
    let out_w = u32::from_le_bytes(width_bytes);
    let out_h = u32::from_le_bytes(height_bytes);

    assert_eq!(out_w, width);
    assert_eq!(out_h, height);
    assert_eq!(result.len(), 8 + (width as usize * height as usize * 4));

    let rgba = &result[8..];
    assert_has_visible_content(rgba, width, height);
}

#[tokio::test]
async fn render_view_reports_diagnostics() {
    let bridge_state = BridgeState::default().expect("bridge state");

    if !install_render_service_or_skip(&bridge_state).await {
        return;
    }

    let test_file = get_test_data_path().join("toy_t1w.nii.gz");
    let (volume_sendable, _affine) =
        nifti_loader::load_nifti_volume_auto(&test_file).expect("load nifti volume");

    let volume_id = "unit-test-volume-diag".to_string();
    let metadata = VolumeMetadataInfo {
        name: volume_id.clone(),
        path: test_file.to_string_lossy().into_owned(),
        dtype: "f32".into(),
        volume_type: VolumeType::Volume3D,
        time_series_info: None,
    };

    {
        let mut registry = bridge_state.volume_registry.lock().await;
        registry.insert(volume_id.clone(), volume_sendable, metadata);
    }

    let (axial_origin_3d, axial_u_3d, axial_origin, axial_u, axial_v) = view_vectors("axial");
    let (sagittal_origin_3d, sagittal_u_3d, _, _, _) = view_vectors("sagittal");
    let (coronal_origin_3d, coronal_u_3d, _, _, _) = view_vectors("coronal");

    let payload = json!({
        "views": {
            "axial": {
                "origin_mm": axial_origin_3d,
                "u_mm": axial_u_3d,
                "v_mm": [0.0, 10.0, 0.0]
            },
            "sagittal": {
                "origin_mm": sagittal_origin_3d,
                "u_mm": sagittal_u_3d,
                "v_mm": [0.0, 0.0, 10.0]
            },
            "coronal": {
                "origin_mm": coronal_origin_3d,
                "u_mm": coronal_u_3d,
                "v_mm": [0.0, 0.0, 10.0]
            }
        },
        "crosshair": {"world_mm": [5.0, 5.0, 5.0], "visible": false},
        "layers": [{
            "id": "layer-main",
            "volumeId": volume_id,
            "visible": true,
            "opacity": 1.0,
            "colormap": "gray",
            "intensity": [0.0, 1000.0],
            "threshold": [0.0, 0.0],
            "blendMode": "alpha",
            "interpolation": "linear"
        }],
        "requestedView": {
            "type": "axial",
            "origin_mm": axial_origin,
            "u_mm": axial_u,
            "v_mm": axial_v,
            "width": 96,
            "height": 96
        }
    });

    let result =
        render_view_with_diagnostics_for_testing(payload.to_string(), &bridge_state, Some("rgba"))
            .await
            .expect("render_view_with_diagnostics_for_testing succeeded");

    assert_eq!(result.diagnostics.requested_view.as_deref(), Some("axial"));
    assert_eq!(result.diagnostics.format, "rgba");
    assert_eq!(result.diagnostics.output_dimensions, [96, 96]);
    assert_eq!(result.diagnostics.visible_layer_count, 1);
    assert_eq!(result.diagnostics.frame.updated_layer_slots, 1);
    assert!(!result.diagnostics.frame.reused_layer_state);
    assert!(result.diagnostics.parse_ms >= 0.0);
    assert!(result.diagnostics.service_lock_ms >= 0.0);
    assert!(result.diagnostics.target_setup_ms >= 0.0);
    assert!(result.diagnostics.layer_processing_ms >= 0.0);
    assert!(result.diagnostics.render_loop_ms >= 0.0);
    assert!(result.diagnostics.total_ms >= result.diagnostics.render_loop_ms);
    assert_eq!(result.diagnostics.output_bytes, result.data.len());
    assert!(result.diagnostics.warnings.is_empty());
    assert_eq!(result.diagnostics.frame.visible_layers, 1);
    assert_eq!(
        result.diagnostics.frame.readback_mode,
        FrameReadbackMode::Blocking
    );
    assert!(result.diagnostics.frame.total_ms >= result.diagnostics.frame.readback_ms);

    let (out_w, out_h, rgba) = decode_raw_rgba_frame(&result.data);
    assert_eq!((out_w, out_h), (96, 96));
    assert_has_visible_content(rgba, out_w, out_h);
}

#[tokio::test]
async fn submit_view_reports_skip_readback_diagnostics() {
    let bridge_state = BridgeState::default().expect("bridge state");

    if !install_render_service_or_skip(&bridge_state).await {
        return;
    }

    let test_file = get_test_data_path().join("toy_t1w.nii.gz");
    let (volume_sendable, _affine) =
        nifti_loader::load_nifti_volume_auto(&test_file).expect("load nifti volume");

    let volume_id = "unit-test-volume-submit-diag".to_string();
    let metadata = VolumeMetadataInfo {
        name: volume_id.clone(),
        path: test_file.to_string_lossy().into_owned(),
        dtype: "f32".into(),
        volume_type: VolumeType::Volume3D,
        time_series_info: None,
    };

    {
        let mut registry = bridge_state.volume_registry.lock().await;
        registry.insert(volume_id.clone(), volume_sendable, metadata);
    }

    let (axial_origin_3d, axial_u_3d, axial_origin, axial_u, axial_v) = view_vectors("axial");
    let (sagittal_origin_3d, sagittal_u_3d, _, _, _) = view_vectors("sagittal");
    let (coronal_origin_3d, coronal_u_3d, _, _, _) = view_vectors("coronal");

    let payload = json!({
        "views": {
            "axial": {
                "origin_mm": axial_origin_3d,
                "u_mm": axial_u_3d,
                "v_mm": [0.0, 10.0, 0.0]
            },
            "sagittal": {
                "origin_mm": sagittal_origin_3d,
                "u_mm": sagittal_u_3d,
                "v_mm": [0.0, 0.0, 10.0]
            },
            "coronal": {
                "origin_mm": coronal_origin_3d,
                "u_mm": coronal_u_3d,
                "v_mm": [0.0, 0.0, 10.0]
            }
        },
        "crosshair": {"world_mm": [5.0, 5.0, 5.0], "visible": false},
        "layers": [{
            "id": "layer-main",
            "volumeId": volume_id,
            "visible": true,
            "opacity": 1.0,
            "colormap": "gray",
            "intensity": [0.0, 1000.0],
            "threshold": [0.0, 0.0],
            "blendMode": "alpha",
            "interpolation": "linear"
        }],
        "requestedView": {
            "type": "axial",
            "origin_mm": axial_origin,
            "u_mm": axial_u,
            "v_mm": axial_v,
            "width": 80,
            "height": 64
        }
    });

    let diagnostics = submit_view_with_diagnostics_for_testing(payload.to_string(), &bridge_state)
        .await
        .expect("submit_view_with_diagnostics_for_testing succeeded");

    assert_eq!(diagnostics.requested_view.as_deref(), Some("axial"));
    assert_eq!(diagnostics.format, "rgba");
    assert_eq!(diagnostics.output_dimensions, [80, 64]);
    assert_eq!(diagnostics.visible_layer_count, 1);
    assert_eq!(diagnostics.output_bytes, 0);
    assert!(diagnostics.warnings.is_empty());
    assert_eq!(diagnostics.frame.visible_layers, 1);
    assert_eq!(diagnostics.frame.updated_layer_slots, 1);
    assert!(!diagnostics.frame.reused_layer_state);
    assert_eq!(diagnostics.frame.readback_mode, FrameReadbackMode::Skip);
    assert_eq!(diagnostics.frame.readback_ms, 0.0);
    assert_eq!(diagnostics.encode_ms, 0.0);
    assert!(diagnostics.total_ms >= diagnostics.render_loop_ms);
    assert!(diagnostics.frame.total_ms >= diagnostics.frame.render_ms);
}

#[tokio::test]
async fn render_views_returns_multi_payload() {
    let bridge_state = BridgeState::default().expect("bridge state");

    if !install_render_service_or_skip(&bridge_state).await {
        return;
    }

    let test_file = get_test_data_path().join("toy_t1w.nii.gz");
    assert!(test_file.exists(), "test volume missing: {:?}", test_file);

    let (volume_sendable, _affine) =
        nifti_loader::load_nifti_volume_auto(&test_file).expect("load nifti volume");

    let volume_id = "unit-test-volume".to_string();
    let metadata = VolumeMetadataInfo {
        name: volume_id.clone(),
        path: test_file.to_string_lossy().into_owned(),
        dtype: "f32".into(),
        volume_type: VolumeType::Volume3D,
        time_series_info: None,
    };

    {
        let mut registry = bridge_state.volume_registry.lock().await;
        registry.insert(volume_id.clone(), volume_sendable, metadata);
    }

    let requested_views = [
        ("axial", 128u32, 128u32),
        ("sagittal", 96u32, 128u32),
        ("coronal", 128u32, 96u32),
    ];
    let (axial_origin_3d, axial_u_3d, axial_origin, axial_u, axial_v) = view_vectors("axial");
    let (sagittal_origin_3d, sagittal_u_3d, sagittal_origin, sagittal_u, sagittal_v) =
        view_vectors("sagittal");
    let (coronal_origin_3d, coronal_u_3d, coronal_origin, coronal_u, coronal_v) =
        view_vectors("coronal");

    let payload = json!({
        "views": {
            "axial": {
                "origin_mm": axial_origin_3d,
                "u_mm": axial_u_3d,
                "v_mm": [0.0, 10.0, 0.0]
            },
            "sagittal": {
                "origin_mm": sagittal_origin_3d,
                "u_mm": sagittal_u_3d,
                "v_mm": [0.0, 0.0, 10.0]
            },
            "coronal": {
                "origin_mm": coronal_origin_3d,
                "u_mm": coronal_u_3d,
                "v_mm": [0.0, 0.0, 10.0]
            }
        },
        "crosshair": {"world_mm": [5.0, 5.0, 5.0], "visible": false},
        "layers": [{
            "id": "layer-main",
            "volumeId": volume_id,
            "visible": true,
            "opacity": 1.0,
            "colormap": "gray",
            "intensity": [0.0, 1000.0],
            "threshold": [0.0, 0.0],
            "blendMode": "alpha",
            "interpolation": "linear"
        }],
        "requestedViews": [
            {"type": "axial", "origin_mm": axial_origin, "u_mm": axial_u, "v_mm": axial_v, "width": requested_views[0].1, "height": requested_views[0].2},
            {"type": "sagittal", "origin_mm": sagittal_origin, "u_mm": sagittal_u, "v_mm": sagittal_v, "width": requested_views[1].1, "height": requested_views[1].2},
            {"type": "coronal", "origin_mm": coronal_origin, "u_mm": coronal_u, "v_mm": coronal_v, "width": requested_views[2].1, "height": requested_views[2].2}
        ]
    });

    let result = render_views_for_testing(payload.to_string(), &bridge_state, Some("rgba"))
        .await
        .expect("render_views_for_testing succeeded");

    assert!(result.len() > 4, "multi-render buffer should not be empty");

    let mut offset = 0usize;
    let count = u32::from_le_bytes(result[offset..offset + 4].try_into().unwrap());
    offset += 4;
    assert_eq!(count as usize, requested_views.len());

    let mut segments = Vec::new();
    for _ in 0..count {
        let view_code = result[offset];
        offset += 1;
        let width = u32::from_le_bytes(result[offset..offset + 4].try_into().unwrap());
        offset += 4;
        let height = u32::from_le_bytes(result[offset..offset + 4].try_into().unwrap());
        offset += 4;
        let len = u32::from_le_bytes(result[offset..offset + 4].try_into().unwrap());
        offset += 4;
        segments.push((view_code, width, height, len as usize));
    }

    for (idx, (view_code, width, height, len)) in segments.iter().enumerate() {
        assert!(*len > 0, "payload length must be non-zero");
        let data_end = offset + *len;
        assert!(data_end <= result.len(), "payload out of bounds");

        let expected_width = requested_views[idx].1;
        let expected_height = requested_views[idx].2;

        assert_eq!(*width, expected_width);
        assert_eq!(*height, expected_height);

        // For RGBA output, expect width * height * 4 bytes
        assert_eq!(*len, (*width as usize) * (*height as usize) * 4);

        // Basic sanity that view code is in expected range
        assert!(*view_code <= 2, "unexpected view code {}", view_code);

        let rgba = &result[offset..data_end];
        assert_has_visible_content(rgba, *width, *height);

        offset = data_end;
    }

    assert_eq!(offset, result.len(), "All payload bytes should be consumed");
}

#[tokio::test]
async fn render_views_reports_diagnostics() {
    let bridge_state = BridgeState::default().expect("bridge state");

    if !install_render_service_or_skip(&bridge_state).await {
        return;
    }

    let test_file = get_test_data_path().join("toy_t1w.nii.gz");
    let (volume_sendable, _affine) =
        nifti_loader::load_nifti_volume_auto(&test_file).expect("load nifti volume");

    let volume_id = "unit-test-volume-multi-diag".to_string();
    let metadata = VolumeMetadataInfo {
        name: volume_id.clone(),
        path: test_file.to_string_lossy().into_owned(),
        dtype: "f32".into(),
        volume_type: VolumeType::Volume3D,
        time_series_info: None,
    };

    {
        let mut registry = bridge_state.volume_registry.lock().await;
        registry.insert(volume_id.clone(), volume_sendable, metadata);
    }

    let (axial_origin_3d, axial_u_3d, axial_origin, axial_u, axial_v) = view_vectors("axial");
    let (sagittal_origin_3d, sagittal_u_3d, sagittal_origin, sagittal_u, sagittal_v) =
        view_vectors("sagittal");
    let (coronal_origin_3d, coronal_u_3d, _, _, _) = view_vectors("coronal");

    let payload = json!({
        "views": {
            "axial": {
                "origin_mm": axial_origin_3d,
                "u_mm": axial_u_3d,
                "v_mm": [0.0, 10.0, 0.0]
            },
            "sagittal": {
                "origin_mm": sagittal_origin_3d,
                "u_mm": sagittal_u_3d,
                "v_mm": [0.0, 0.0, 10.0]
            },
            "coronal": {
                "origin_mm": coronal_origin_3d,
                "u_mm": coronal_u_3d,
                "v_mm": [0.0, 0.0, 10.0]
            }
        },
        "crosshair": {"world_mm": [5.0, 5.0, 5.0], "visible": false},
        "layers": [{
            "id": "layer-main",
            "volumeId": volume_id,
            "visible": true,
            "opacity": 1.0,
            "colormap": "gray",
            "intensity": [0.0, 1000.0],
            "threshold": [0.0, 0.0],
            "blendMode": "alpha",
            "interpolation": "linear"
        }],
        "requestedViews": [
          {
            "type": "axial",
            "origin_mm": axial_origin,
            "u_mm": axial_u,
            "v_mm": axial_v,
            "width": 96,
            "height": 96
          },
          {
            "type": "sagittal",
            "origin_mm": sagittal_origin,
            "u_mm": sagittal_u,
            "v_mm": sagittal_v,
            "width": 64,
            "height": 96
          }
        ]
    });

    let result =
        render_views_with_diagnostics_for_testing(payload.to_string(), &bridge_state, Some("rgba"))
            .await
            .expect("render_views_with_diagnostics_for_testing succeeded");

    assert_eq!(result.diagnostics.format, "rgba");
    assert_eq!(result.diagnostics.requested_view_count, 2);
    assert_eq!(result.diagnostics.per_view.len(), 2);
    assert!(result.diagnostics.parse_ms >= 0.0);
    assert!(result.diagnostics.packet_encode_ms >= 0.0);
    assert!(result.diagnostics.total_ms >= result.diagnostics.packet_encode_ms);
    assert_eq!(result.diagnostics.output_bytes, result.data.len());
    assert_eq!(
        result
            .diagnostics
            .per_view
            .iter()
            .map(|diag| diag.requested_view.as_deref())
            .collect::<Vec<_>>(),
        vec![Some("axial"), Some("sagittal")]
    );
    assert!(result.diagnostics.per_view.iter().all(|diag| {
        diag.visible_layer_count == 1
            && diag.output_bytes > 8
            && diag.service_lock_ms >= 0.0
            && diag.target_setup_ms >= 0.0
            && diag.frame.visible_layers == 1
            && diag.frame.readback_mode == FrameReadbackMode::Blocking
    }));
    assert_eq!(result.diagnostics.per_view[0].frame.updated_layer_slots, 1);
    assert_eq!(result.diagnostics.per_view[1].frame.updated_layer_slots, 0);
    assert!(!result.diagnostics.per_view[0].frame.reused_layer_state);
    assert!(result.diagnostics.per_view[1].frame.reused_layer_state);
}

#[tokio::test]
async fn render_view_reports_single_slot_patch_when_one_layer_changes() {
    let bridge_state = BridgeState::default().expect("bridge state");

    if !install_render_service_or_skip(&bridge_state).await {
        return;
    }

    let test_file = get_test_data_path().join("toy_t1w.nii.gz");
    let (volume_sendable, _affine) =
        nifti_loader::load_nifti_volume_auto(&test_file).expect("load nifti volume");

    let volume_a = "unit-test-volume-patch-a".to_string();
    let volume_b = "unit-test-volume-patch-b".to_string();
    let metadata_a = VolumeMetadataInfo {
        name: volume_a.clone(),
        path: test_file.to_string_lossy().into_owned(),
        dtype: "f32".into(),
        volume_type: VolumeType::Volume3D,
        time_series_info: None,
    };
    let metadata_b = VolumeMetadataInfo {
        name: volume_b.clone(),
        path: test_file.to_string_lossy().into_owned(),
        dtype: "f32".into(),
        volume_type: VolumeType::Volume3D,
        time_series_info: None,
    };

    {
        let mut registry = bridge_state.volume_registry.lock().await;
        registry.insert(volume_a.clone(), volume_sendable.clone(), metadata_a);
        registry.insert(volume_b.clone(), volume_sendable, metadata_b);
    }

    let (axial_origin_3d, axial_u_3d, axial_origin, axial_u, axial_v) = view_vectors("axial");
    let (sagittal_origin_3d, sagittal_u_3d, _, _, _) = view_vectors("sagittal");
    let (coronal_origin_3d, coronal_u_3d, _, _, _) = view_vectors("coronal");

    let base_payload = json!({
        "views": {
            "axial": {
                "origin_mm": axial_origin_3d,
                "u_mm": axial_u_3d,
                "v_mm": [0.0, 10.0, 0.0]
            },
            "sagittal": {
                "origin_mm": sagittal_origin_3d,
                "u_mm": sagittal_u_3d,
                "v_mm": [0.0, 0.0, 10.0]
            },
            "coronal": {
                "origin_mm": coronal_origin_3d,
                "u_mm": coronal_u_3d,
                "v_mm": [0.0, 0.0, 10.0]
            }
        },
        "crosshair": {"world_mm": [5.0, 5.0, 5.0], "visible": false},
        "layers": [
            {
                "id": "layer-main-a",
                "volumeId": volume_a,
                "visible": true,
                "opacity": 1.0,
                "colormap": "gray",
                "intensity": [0.0, 1000.0],
                "threshold": [0.0, 0.0],
                "blendMode": "alpha",
                "interpolation": "linear"
            },
            {
                "id": "layer-main-b",
                "volumeId": volume_b,
                "visible": true,
                "opacity": 0.4,
                "colormap": "hot",
                "intensity": [0.0, 1000.0],
                "threshold": [0.0, 0.0],
                "blendMode": "alpha",
                "interpolation": "linear"
            }
        ],
        "requestedView": {
            "type": "axial",
            "origin_mm": axial_origin,
            "u_mm": axial_u,
            "v_mm": axial_v,
            "width": 96,
            "height": 96
        }
    });

    let first = render_view_with_diagnostics_for_testing(
        base_payload.to_string(),
        &bridge_state,
        Some("rgba"),
    )
    .await
    .expect("first render_view_with_diagnostics_for_testing succeeded");

    assert_eq!(first.diagnostics.frame.visible_layers, 2);
    assert_eq!(first.diagnostics.frame.updated_layer_slots, 2);
    assert!(!first.diagnostics.frame.reused_layer_state);

    let mut patched_payload = base_payload;
    patched_payload["layers"][1]["opacity"] = json!(0.7);

    let second = render_view_with_diagnostics_for_testing(
        patched_payload.to_string(),
        &bridge_state,
        Some("rgba"),
    )
    .await
    .expect("second render_view_with_diagnostics_for_testing succeeded");

    assert_eq!(second.diagnostics.frame.visible_layers, 2);
    assert_eq!(second.diagnostics.frame.updated_layer_slots, 1);
    assert!(!second.diagnostics.frame.reused_layer_state);
}

#[tokio::test]
async fn render_view_reuploads_4d_layer_when_timepoint_changes() {
    let bridge_state = BridgeState::default().expect("bridge state");

    if !install_render_service_or_skip(&bridge_state).await {
        return;
    }

    let volume_id = "unit-test-volume-4d-timepoint".to_string();
    let metadata = VolumeMetadataInfo {
        name: volume_id.clone(),
        path: "memory://unit-test-4d".into(),
        dtype: "f32".into(),
        volume_type: VolumeType::TimeSeries4D,
        time_series_info: Some(TimeSeriesInfo {
            num_timepoints: 4,
            tr: Some(1.5),
            temporal_unit: Some("seconds".into()),
            acquisition_time: Some(6.0),
        }),
    };

    {
        let mut registry = bridge_state.volume_registry.lock().await;
        registry.insert(volume_id.clone(), make_4d_volume_sendable(), metadata);
    }

    let (axial_origin_3d, axial_u_3d, axial_origin, axial_u, axial_v) = view_vectors("axial");
    let (sagittal_origin_3d, sagittal_u_3d, _, _, _) = view_vectors("sagittal");
    let (coronal_origin_3d, coronal_u_3d, _, _, _) = view_vectors("coronal");

    let base_payload = json!({
        "views": {
            "axial": {
                "origin_mm": axial_origin_3d,
                "u_mm": axial_u_3d,
                "v_mm": [0.0, 10.0, 0.0]
            },
            "sagittal": {
                "origin_mm": sagittal_origin_3d,
                "u_mm": sagittal_u_3d,
                "v_mm": [0.0, 0.0, 10.0]
            },
            "coronal": {
                "origin_mm": coronal_origin_3d,
                "u_mm": coronal_u_3d,
                "v_mm": [0.0, 0.0, 10.0]
            }
        },
        "crosshair": {"world_mm": [0.0, 0.0, 0.0], "visible": false},
        "layers": [{
            "id": "layer-4d-main",
            "volumeId": volume_id,
            "visible": true,
            "opacity": 1.0,
            "colormap": "gray",
            "intensity": [0.0, 1.0],
            "threshold": [0.0, 0.0],
            "blendMode": "alpha",
            "interpolation": "linear"
        }],
        "requestedView": {
            "type": "axial",
            "origin_mm": axial_origin,
            "u_mm": axial_u,
            "v_mm": axial_v,
            "width": 64,
            "height": 64
        },
        "timepoint": 1
    });

    let first = render_view_with_diagnostics_for_testing(
        base_payload.to_string(),
        &bridge_state,
        Some("rgba"),
    )
    .await
    .expect("first 4D render succeeded");

    assert_eq!(first.diagnostics.frame.visible_layers, 1);
    assert_eq!(first.diagnostics.frame.updated_layer_slots, 1);
    assert!(!first.diagnostics.frame.reused_layer_state);
    assert_eq!(
        bridge_state
            .layer_to_timepoint_map
            .lock()
            .await
            .get("layer-4d-main")
            .copied(),
        Some(Some(1))
    );

    let mut second_payload = base_payload.clone();
    second_payload["timepoint"] = json!(2);

    let second = render_view_with_diagnostics_for_testing(
        second_payload.to_string(),
        &bridge_state,
        Some("rgba"),
    )
    .await
    .expect("second 4D render succeeded");

    assert_eq!(second.diagnostics.frame.visible_layers, 1);
    assert_eq!(second.diagnostics.frame.updated_layer_slots, 1);
    assert!(!second.diagnostics.frame.reused_layer_state);
    assert_eq!(
        bridge_state
            .layer_to_timepoint_map
            .lock()
            .await
            .get("layer-4d-main")
            .copied(),
        Some(Some(2))
    );

    let third = render_view_with_diagnostics_for_testing(
        second_payload.to_string(),
        &bridge_state,
        Some("rgba"),
    )
    .await
    .expect("third 4D render succeeded");

    assert_eq!(third.diagnostics.frame.visible_layers, 1);
    assert_eq!(third.diagnostics.frame.updated_layer_slots, 0);
    assert!(third.diagnostics.frame.reused_layer_state);
    assert_eq!(
        bridge_state
            .layer_to_timepoint_map
            .lock()
            .await
            .get("layer-4d-main")
            .copied(),
        Some(Some(2))
    );
}

#[tokio::test]
async fn render_view_rejects_4d_request_without_timepoint() {
    let bridge_state = BridgeState::default().expect("bridge state");

    if !install_render_service_or_skip(&bridge_state).await {
        return;
    }

    let volume_id = "unit-test-volume-4d-missing-timepoint".to_string();
    let metadata = VolumeMetadataInfo {
        name: volume_id.clone(),
        path: "memory://unit-test-4d-missing-timepoint".into(),
        dtype: "f32".into(),
        volume_type: VolumeType::TimeSeries4D,
        time_series_info: Some(TimeSeriesInfo {
            num_timepoints: 4,
            tr: Some(1.5),
            temporal_unit: Some("seconds".into()),
            acquisition_time: Some(6.0),
        }),
    };

    {
        let mut registry = bridge_state.volume_registry.lock().await;
        registry.insert(volume_id.clone(), make_4d_volume_sendable(), metadata);
    }

    let (axial_origin_3d, axial_u_3d, axial_origin, axial_u, axial_v) = view_vectors("axial");
    let (sagittal_origin_3d, sagittal_u_3d, _, _, _) = view_vectors("sagittal");
    let (coronal_origin_3d, coronal_u_3d, _, _, _) = view_vectors("coronal");

    let payload = json!({
        "views": {
            "axial": {
                "origin_mm": axial_origin_3d,
                "u_mm": axial_u_3d,
                "v_mm": [0.0, 10.0, 0.0]
            },
            "sagittal": {
                "origin_mm": sagittal_origin_3d,
                "u_mm": sagittal_u_3d,
                "v_mm": [0.0, 0.0, 10.0]
            },
            "coronal": {
                "origin_mm": coronal_origin_3d,
                "u_mm": coronal_u_3d,
                "v_mm": [0.0, 0.0, 10.0]
            }
        },
        "crosshair": {"world_mm": [0.0, 0.0, 0.0], "visible": false},
        "layers": [{
            "id": "layer-4d-missing-timepoint",
            "volumeId": volume_id,
            "visible": true,
            "opacity": 1.0,
            "colormap": "gray",
            "intensity": [0.0, 1.0],
            "threshold": [0.0, 0.0],
            "blendMode": "alpha",
            "interpolation": "linear"
        }],
        "requestedView": {
            "type": "axial",
            "origin_mm": axial_origin,
            "u_mm": axial_u,
            "v_mm": axial_v,
            "width": 64,
            "height": 64
        }
    });

    let error =
        render_view_with_diagnostics_for_testing(payload.to_string(), &bridge_state, Some("rgba"))
            .await
            .expect_err("4D render without timepoint should fail");

    match error {
        BridgeError::Input { code, details } => {
            assert_eq!(code, 4103);
            assert!(details.contains(&volume_id));
            assert!(details.contains("timepoint"));
        }
        other => panic!("expected BridgeError::Input, got {:?}", other),
    }
}
