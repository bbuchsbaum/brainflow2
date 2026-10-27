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
        json!({"volumes":0,"stagingBuffers":0,"stagingBytes":0})
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
        json!({"volumes":0,"stagingBuffers":0,"stagingBytes":0})
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
        .unwrap_err()
        .contains("3D"));
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
