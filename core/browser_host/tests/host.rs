use browser_host::BrowserHost;
use serde_json::{json, Value};

const NIFTI: &[u8] = include_bytes!("../../../test-data/browser/oblique.nii");
const GZIP: &[u8] = include_bytes!("../../../test-data/browser/oblique.nii.gz");
const FRAME: &str = include_str!("../../../test-data/browser/frame.json");

#[tokio::test]
async fn one_slot_device_bounds_residency_and_reuses_after_unload() {
    let mut host = BrowserHost::configure_with_texture_limit(Some(3))
        .await
        .expect("Real GPU required");
    assert_eq!(host.capabilities().volume_slots, 1);
    assert_eq!(host.capabilities().sampled_texture_limit, 3);
    let first = host
        .load_nifti("first.nii".into(), NIFTI.to_vec())
        .await
        .unwrap();
    assert!(host
        .load_nifti("second.nii".into(), NIFTI.to_vec())
        .await
        .unwrap_err()
        .contains("up to 1 volumes"));
    host.unload(&first.id).await.unwrap();
    let reused = host
        .load_nifti("reused.nii".into(), NIFTI.to_vec())
        .await
        .unwrap();
    host.unload(&reused.id).await.unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&host.diagnostics()).unwrap(),
        json!({"volumes":0,"palettes":0,"stagingBuffers":0,"stagingBytes":0})
    );
}

#[tokio::test]
async fn oblique_voxels_match_independent_geometry_and_reclaim_after_failure_and_unload() {
    let mut host = BrowserHost::configure()
        .await
        .expect("Real native GPU required");
    let volume = host
        .load_nifti("oblique.nii".into(), NIFTI.to_vec())
        .await
        .unwrap();
    assert_eq!(volume.dims, vec![5, 7, 9]);
    assert_eq!(volume.center, [4., -1., 21.]);
    assert_eq!(volume.bounds, [[-3., -8.5, 3.], [11., 6.5, 39.]]);
    assert_eq!(volume.range, [0., 864.]);
    let frame = host.render_view(FRAME).await.unwrap();
    assert_eq!(frame.len(), 8 + 7 * 5 * 4);
    for y in 0..5 {
        for x in 0..7 {
            let pixel = &frame[8 + (y * 7 + x) * 4..8 + (y * 7 + x + 1) * 4];
            let expected = ((400 + 10 * x + y) as f32 / 864. * 255.).round() as i32;
            assert!(
                (pixel[0] as i32 - expected).abs() <= 2,
                "({x},{y}): {pixel:?} expected {expected}"
            );
            assert_eq!(pixel[0], pixel[1]);
            assert_eq!(pixel[1], pixel[2]);
            assert_eq!(pixel[3], 255);
        }
    }
    if let Ok(dir) = std::env::var("BROWSER_NATIVE_WITNESS_DIR") {
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            format!("{dir}/native-witness.json"),
            json!({"volume":volume,"packet":frame}).to_string(),
        )
        .unwrap();
    }
    host.unload(&volume.id).await.unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&host.diagnostics()).unwrap(),
        json!({"volumes":0,"palettes":0,"stagingBuffers":0,"stagingBytes":0})
    );
    assert!(host.render_view(FRAME).await.is_err());
    assert!(host
        .load_nifti("bad.nii".into(), vec![0; 400])
        .await
        .is_err());
    let mut multiple = NIFTI.to_vec();
    multiple[40..42].copy_from_slice(&4_i16.to_le_bytes());
    multiple[48..50].copy_from_slice(&2_i16.to_le_bytes());
    assert!(host
        .load_nifti("timeseries.nii".into(), multiple)
        .await
        .is_err());
    assert_eq!(
        serde_json::from_str::<Value>(&host.diagnostics()).unwrap()["volumes"],
        0
    );
    let compressed = host
        .load_nifti("oblique.nii.gz".into(), GZIP.to_vec())
        .await
        .unwrap();
    assert_eq!(compressed.center, [4., -1., 21.]);
    host.unload(&compressed.id).await.unwrap();
    // The source is valid and small, but a 32767-wide texture exceeds this
    // native adapter's 3D GPU limit. GPU rejection must roll back CPU publication.
    let mut too_wide = NIFTI[..352].to_vec();
    for (offset, dim) in [(42, 32767u16), (44, 1), (46, 1)] {
        too_wide[offset..offset + 2].copy_from_slice(&dim.to_le_bytes());
    }
    for _ in 0..32767 {
        too_wide.extend_from_slice(&1f32.to_le_bytes());
    }
    assert!(host
        .load_nifti("too-wide.nii".into(), too_wide)
        .await
        .is_err());
    assert_eq!(
        serde_json::from_str::<Value>(&host.diagnostics()).unwrap()["volumes"],
        0
    );
    let mut owned = Vec::new();
    for _ in 0..4 {
        owned.push(
            host.load_nifti("oblique.nii".into(), NIFTI.to_vec())
                .await
                .unwrap()
                .id,
        );
    }
    assert!(host
        .load_nifti("fifth.nii".into(), NIFTI.to_vec())
        .await
        .unwrap_err()
        .contains("up to 4 volumes"));
    assert_eq!(
        serde_json::from_str::<Value>(&host.diagnostics()).unwrap()["volumes"],
        4
    );
    for id in owned {
        host.unload(&id).await.unwrap();
    }
    assert_eq!(
        serde_json::from_str::<Value>(&host.diagnostics()).unwrap()["volumes"],
        0
    );
}

#[tokio::test]
async fn four_dimensional_frames_keep_geometry_and_reuse_one_gpu_slot() {
    let mut host = BrowserHost::configure_with_texture_limit(Some(3))
        .await
        .unwrap();
    let volume = host
        .load_nifti(
            "oblique4d.nii".into(),
            include_bytes!("../../../test-data/browser/oblique4d.nii").to_vec(),
        )
        .await
        .unwrap();
    assert_eq!(volume.frame_count, 3);
    assert_eq!(volume.center, [4., -1., 21.]);
    assert_eq!(volume.range, [0., 2864.]);
    let mut request: Value = serde_json::from_str(FRAME).unwrap();
    request["layers"][0]["intensity"] = json!([0, 2864]);
    let request = request.to_string();
    let mut packets = Vec::new();
    for t in [0, 2, 1, 0] {
        host.set_timepoint(&volume.id, t).await.unwrap();
        let frame = host.render_view(&request).await.unwrap();
        for y in 0..5 {
            for x in 0..7 {
                let expected = ((400 + 10 * x + y + 1000 * t) as f32 / 2864. * 255.).round() as i32;
                assert!((frame[8 + (y * 7 + x) * 4] as i32 - expected).abs() <= 2);
            }
        }
        packets.push(frame);
    }
    assert_eq!(packets[0], packets[3]);
    assert!(host.set_timepoint(&volume.id, 3).await.is_err());
    assert_eq!(host.render_view(&request).await.unwrap(), packets[0]);
    if let Ok(dir) = std::env::var("BROWSER_NATIVE_WITNESS_DIR") {
        std::fs::write(
            format!("{dir}/native-4d-witness.json"),
            json!({"packets":packets}).to_string(),
        )
        .unwrap();
    }
    host.unload(&volume.id).await.unwrap();
    assert!(host.set_timepoint(&volume.id, 0).await.is_err());
    assert_eq!(
        serde_json::from_str::<Value>(&host.diagnostics()).unwrap(),
        json!({"volumes":0,"palettes":0,"stagingBuffers":0,"stagingBytes":0})
    );
}

#[tokio::test]
async fn categorical_ids_colors_nearest_sampling_and_owned_cleanup() {
    let mut host = BrowserHost::configure().await.expect("Real GPU required");
    let bytes = include_bytes!("../../../test-data/browser/labels.nii");
    let volume = host
        .load_nifti("labels.nii".into(), bytes.to_vec())
        .await
        .unwrap();
    assert_eq!(volume.label_ids, Some(vec![0, 17, 1024, 2047]));
    assert_eq!(
        host.label_at_world(&volume.id, [4., -1., 21.]).unwrap(),
        Some(17)
    );
    assert_eq!(
        host.label_at_world(&volume.id, [100., -1., 21.]).unwrap(),
        None
    );
    assert!(host.label_at_world(&volume.id, [f64::NAN, 0., 0.]).is_err());
    let mut row = vec![0; 2048 * 4];
    for (id, rgb) in [(17, [255, 0, 0]), (1024, [0, 255, 0]), (2047, [0, 0, 255])] {
        row[id * 4..id * 4 + 4].copy_from_slice(&[rgb[0], rgb[1], rgb[2], 255]);
    }
    assert!(host.set_label_palette(&volume.id, &[0; 4]).await.is_err());
    host.set_label_palette(&volume.id, &row).await.unwrap();
    let mut request: Value = serde_json::from_str(FRAME).unwrap();
    // Sample 0.4 voxels away from centers while deliberately asking for linear.
    // The label host must enforce nearest; no intermediate IDs are meaningful.
    request["requestedView"]["origin_mm"][1] = json!(-7.3);
    request["layers"][0]["interpolation"] = json!("linear");
    let packet = host.render_view(&request.to_string()).await.unwrap();
    for y in 0..5 {
        for x in 0..7 {
            let expected = [
                [0, 0, 0, 255],
                [255, 0, 0, 255],
                [0, 255, 0, 255],
                [0, 0, 255, 255],
            ][(x + y) % 4];
            assert_eq!(
                &packet[8 + (y * 7 + x) * 4..8 + (y * 7 + x + 1) * 4],
                &expected,
                "({x},{y})"
            );
        }
    }
    if let Ok(dir) = std::env::var("BROWSER_NATIVE_WITNESS_DIR") {
        std::fs::write(
            format!("{dir}/native-label-witness.json"),
            json!({"packet":packet}).to_string(),
        )
        .unwrap();
    }
    // Background transmits an underlying anatomical layer; opacity applies to colors.
    let base = host
        .load_nifti("base.nii".into(), NIFTI.to_vec())
        .await
        .unwrap();
    let mut under: Value = serde_json::from_str(FRAME).unwrap();
    under["layers"][0]["volumeId"] = json!(base.id);
    let baseline = host.render_view(&under.to_string()).await.unwrap();
    let mut overlay = under["layers"][0].clone();
    overlay["volumeId"] = json!(volume.id);
    overlay["opacity"] = json!(0.5);
    under["layers"].as_array_mut().unwrap().push(overlay);
    let composite = host.render_view(&under.to_string()).await.unwrap();
    for y in 0..5 {
        for x in 0..7 {
            let index = 8 + (y * 7 + x) * 4;
            if (x + y) % 4 == 0 {
                assert_eq!(&composite[index..index + 4], &baseline[index..index + 4]);
            } else {
                let rgb = [[0, 0, 0], [255, 0, 0], [0, 255, 0], [0, 0, 255]][(x + y) % 4];
                for c in 0..3 {
                    assert!(
                        (composite[index + c] as f32
                            - (baseline[index + c] as f32 + rgb[c] as f32) / 2.)
                            .abs()
                            <= 2.
                    );
                }
            }
        }
    }
    host.unload(&base.id).await.unwrap();
    host.unload(&volume.id).await.unwrap();
    assert!(host.label_at_world(&volume.id, [0.; 3]).is_err());
    assert_eq!(
        serde_json::from_str::<Value>(&host.diagnostics()).unwrap(),
        json!({"volumes":0,"palettes":0,"stagingBuffers":0,"stagingBytes":0})
    );
    // Native integer and f64 sources use the same exact label path.
    for datatype in [4i16, 64] {
        let mut typed = bytes[..352].to_vec();
        typed[70..72].copy_from_slice(&datatype.to_le_bytes());
        typed[72..74].copy_from_slice(&(if datatype == 4 { 16i16 } else { 64i16 }).to_le_bytes());
        for _ in 0..315 {
            if datatype == 4 {
                typed.extend_from_slice(&1024i16.to_le_bytes());
            } else {
                typed.extend_from_slice(&1024f64.to_le_bytes());
            }
        }
        let v = host
            .load_nifti("native-label.nii".into(), typed)
            .await
            .unwrap();
        assert_eq!(v.label_ids, Some(vec![1024]));
        assert_eq!(host.label_at_world(&v.id, v.center).unwrap(), Some(1024));
        host.unload(&v.id).await.unwrap();
    }
    let mut scaled = bytes.to_vec();
    scaled[112..116].copy_from_slice(&2f32.to_le_bytes());
    assert!(host
        .load_nifti("scaled-label.nii".into(), scaled)
        .await
        .unwrap_err()
        .contains("identity"));
    // GPU admission failure must release the provisional CPU registration too.
    let mut wide = bytes[..352].to_vec();
    for (offset, dim) in [(42, 32767u16), (44, 1), (46, 1)] {
        wide[offset..offset + 2].copy_from_slice(&dim.to_le_bytes());
    }
    for _ in 0..32767 {
        wide.extend_from_slice(&17f32.to_le_bytes());
    }
    assert!(host
        .load_nifti("wide-label.nii".into(), wide)
        .await
        .is_err());
    assert_eq!(
        serde_json::from_str::<Value>(&host.diagnostics()).unwrap()["volumes"],
        0
    );
    // Invalid raw f64 must fail BEFORE f32 conversion can round to 17.
    for bad in [17.00000001, -1., 2048., f64::NAN] {
        let mut invalid = bytes[..352].to_vec();
        invalid[70..72].copy_from_slice(&64i16.to_le_bytes());
        invalid[72..74].copy_from_slice(&64i16.to_le_bytes());
        for _ in 0..315 {
            invalid.extend_from_slice(&bad.to_le_bytes());
        }
        assert!(host
            .load_nifti("invalid.nii".into(), invalid)
            .await
            .unwrap_err()
            .contains("Label IDs"));
    }
    assert_eq!(
        serde_json::from_str::<Value>(&host.diagnostics()).unwrap()["volumes"],
        0
    );
    // Repeated loads must reuse palette slots rather than exhaust their pool.
    for _ in 0..20 {
        let v = host
            .load_label_nifti("again.nii".into(), bytes.to_vec())
            .await
            .unwrap();
        host.set_label_palette(&v.id, &row).await.unwrap();
        host.unload(&v.id).await.unwrap();
    }
    assert_eq!(
        serde_json::from_str::<Value>(&host.diagnostics()).unwrap()["palettes"],
        0
    );
}
