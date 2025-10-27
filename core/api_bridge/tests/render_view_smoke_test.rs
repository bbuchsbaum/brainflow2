use std::{convert::TryInto, path::PathBuf, sync::Arc};

use api_bridge::{
    render_view_for_testing, render_views_for_testing, BridgeState, VolumeMetadataInfo,
};
use bridge_types::VolumeType;
use render_loop::RenderLoopService;
use serde_json::json;
use tokio::sync::Mutex;

fn get_test_data_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("test-data")
        .join("unit")
}

#[tokio::test]
async fn render_view_returns_rgba_buffer() {
    let bridge_state = BridgeState::default().expect("bridge state");

    let render_service = RenderLoopService::new()
        .await
        .expect("initialize render loop");
    {
        let mut slot = bridge_state.render_loop_service.lock().await;
        *slot = Some(Arc::new(Mutex::new(render_service)));
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

    let payload = json!({
        "views": {
            "axial": {
                "origin_mm": [0.0, 0.0, 0.0],
                "u_mm": [1.0, 0.0, 0.0],
                "v_mm": [0.0, 1.0, 0.0]
            },
            "sagittal": {
                "origin_mm": [0.0, 0.0, 0.0],
                "u_mm": [0.0, 0.0, -1.0],
                "v_mm": [0.0, 1.0, 0.0]
            },
            "coronal": {
                "origin_mm": [0.0, 0.0, 0.0],
                "u_mm": [1.0, 0.0, 0.0],
                "v_mm": [0.0, 0.0, -1.0]
            }
        },
        "crosshair": {"world_mm": [0.0, 0.0, 0.0], "visible": true},
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
            "origin_mm": [0.0, 0.0, 0.0, 1.0],
            "u_mm": [1.0, 0.0, 0.0, 0.0],
            "v_mm": [0.0, 1.0, 0.0, 0.0],
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
}

#[tokio::test]
async fn render_views_returns_multi_payload() {
    let bridge_state = BridgeState::default().expect("bridge state");

    let render_service = RenderLoopService::new()
        .await
        .expect("initialize render loop");
    {
        let mut slot = bridge_state.render_loop_service.lock().await;
        *slot = Some(Arc::new(Mutex::new(render_service)));
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

    let payload = json!({
        "views": {
            "axial": {
                "origin_mm": [0.0, 0.0, 0.0],
                "u_mm": [1.0, 0.0, 0.0],
                "v_mm": [0.0, 1.0, 0.0]
            },
            "sagittal": {
                "origin_mm": [0.0, 0.0, 0.0],
                "u_mm": [0.0, 0.0, -1.0],
                "v_mm": [0.0, 1.0, 0.0]
            },
            "coronal": {
                "origin_mm": [0.0, 0.0, 0.0],
                "u_mm": [1.0, 0.0, 0.0],
                "v_mm": [0.0, 0.0, -1.0]
            }
        },
        "crosshair": {"world_mm": [0.0, 0.0, 0.0], "visible": true},
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
        "requestedViews": requested_views.iter().map(|(view, w, h)| json!({
            "type": view,
            "origin_mm": [0.0, 0.0, 0.0, 1.0],
            "u_mm": [1.0, 0.0, 0.0, 0.0],
            "v_mm": [0.0, 1.0, 0.0, 0.0],
            "width": w,
            "height": h
        })).collect::<Vec<_>>()
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

        offset = data_end;
    }

    assert_eq!(offset, result.len(), "All payload bytes should be consumed");
}
