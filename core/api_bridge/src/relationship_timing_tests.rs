//! Similarity fit timing on a real-size set: 35 gzipped 91x109x91 float maps.
//! `cargo test -p api-bridge --release relationship_real_size_timing -- --ignored --nocapture`
//! Prints wall time per fit, the `[perf]` phase lines and a result digest so
//! two builds can be compared for identical output.
use crate::population_slice::relationship::{evaluate, Distance, Request};
use crate::{population_sampling::SampleCancellation, BridgeState, SetMemberRef};
use std::io::Write;
use std::path::PathBuf;
use std::time::Instant;

struct PerfLogger;
impl log::Log for PerfLogger {
    fn enabled(&self, _: &log::Metadata) -> bool {
        true
    }
    fn log(&self, record: &log::Record) {
        let message = record.args().to_string();
        if message.starts_with("[perf]") {
            println!("{message}");
        }
    }
    fn flush(&self) {}
}

struct TempDir(PathBuf);
impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn write_gz_nifti(path: &std::path::Path, dims: [usize; 3], values: &[f32]) {
    let mut bytes = vec![0u8; 352];
    bytes[0..4].copy_from_slice(&348i32.to_le_bytes());
    bytes[40..42].copy_from_slice(&3i16.to_le_bytes());
    for (i, &dim) in dims.iter().enumerate() {
        bytes[42 + i * 2..44 + i * 2].copy_from_slice(&(dim as i16).to_le_bytes());
    }
    for i in 3..7 {
        bytes[42 + i * 2..44 + i * 2].copy_from_slice(&1i16.to_le_bytes());
    }
    bytes[70..72].copy_from_slice(&16i16.to_le_bytes());
    bytes[72..74].copy_from_slice(&32i16.to_le_bytes());
    for i in 0..8 {
        bytes[76 + i * 4..80 + i * 4].copy_from_slice(&2f32.to_le_bytes());
    }
    bytes[108..112].copy_from_slice(&352f32.to_le_bytes());
    bytes[112..116].copy_from_slice(&1f32.to_le_bytes());
    bytes[123] = 10;
    bytes[254..256].copy_from_slice(&1i16.to_le_bytes());
    let srow = [
        [2f32, 0., 0., -90.],
        [0., 2., 0., -126.],
        [0., 0., 2., -72.],
    ];
    for (row, offset) in srow.iter().zip([280, 296, 312]) {
        for (k, v) in row.iter().enumerate() {
            bytes[offset + 4 * k..offset + 4 * k + 4].copy_from_slice(&v.to_le_bytes());
        }
    }
    bytes[344..348].copy_from_slice(b"n+1\0");
    for value in values {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    let file = std::fs::File::create(path).unwrap();
    let mut encoder = flate2::write::GzEncoder::new(file, flate2::Compression::default());
    encoder.write_all(&bytes).unwrap();
    encoder.finish().unwrap();
}

fn xorshift(state: &mut u64) -> f32 {
    *state ^= *state << 13;
    *state ^= *state >> 7;
    *state ^= *state << 17;
    ((*state >> 40) as f32 / (1u64 << 24) as f32) * 2.0 - 1.0
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "timing run; cargo test -p api-bridge --release relationship_real_size_timing -- --ignored --nocapture"]
async fn relationship_real_size_timing() {
    let _ = log::set_logger(&PerfLogger);
    log::set_max_level(log::LevelFilter::Info);
    let dims = [91usize, 109, 91];
    let count = dims.iter().product::<usize>();
    let dir = TempDir(std::env::temp_dir().join(format!(
        "brainflow-relationship-timing-{}",
        std::process::id()
    )));
    std::fs::create_dir_all(&dir.0).unwrap();
    let mut state = 0x9e3779b97f4a7c15u64;
    let mut members = Vec::new();
    for member in 0..35 {
        let group = member % 3;
        let mut data = vec![0.0f32; count];
        for z in 0..dims[2] {
            for y in 0..dims[1] {
                for x in 0..dims[0] {
                    let r = ((x as f32 - 45.0) / 36.0).powi(2)
                        + ((y as f32 - 54.0) / 44.0).powi(2)
                        + ((z as f32 - 45.0) / 36.0).powi(2);
                    if r < 1.0 {
                        let signal = match group {
                            0 => (x as f32 / 9.0).sin(),
                            1 => (y as f32 / 7.0).cos(),
                            _ => (z as f32 / 11.0).sin(),
                        };
                        data[x + dims[0] * (y + dims[1] * z)] = signal + xorshift(&mut state);
                    }
                }
            }
        }
        let path = dir.0.join(format!("sub-{member:03}_stat.nii.gz"));
        write_gz_nifti(&path, dims, &data);
        members.push(SetMemberRef {
            member_id: format!("sub-{member:03}"),
            display_label: None,
            design_values: Default::default(),
            source_path: path.to_string_lossy().into(),
            stack_index: None,
            expected_sha256: None,
        });
    }
    let bridge = BridgeState::default().unwrap();
    for distance in [Distance::Effect, Distance::PatternShape] {
        for pass in ["cold", "warm"] {
            if pass == "cold" {
                bridge.set_sample_cache.clear().await.unwrap();
            }
            let request = Request {
                explanation: None,
                eligibility: None,
                grouping: None,
                members: members.clone(),
                mask: None,
                region: None,
                distance: distance.clone(),
            };
            let started = Instant::now();
            let result = evaluate(request, &bridge, SampleCancellation::default())
                .await
                .unwrap();
            let elapsed = started.elapsed().as_millis();
            let g = &result.geometry;
            let distance_sum: f64 = g.distances.iter().flatten().sum();
            println!(
                "similarity timing: {distance:?} {pass} members=35 voxels={} wall_ms={elapsed} fit_id={} distance_sum={distance_sum:.17e} d01={:.17e} eig0={:.17e} stress={:.17e} merges={:?}",
                result.candidate_voxels,
                result.fit_id,
                g.distances[0][1],
                g.eigenvalues[0],
                g.stress,
                g.merges
                    .iter()
                    .map(|m| (m.left, m.right, m.count))
                    .collect::<Vec<_>>(),
            );
        }
    }
}
