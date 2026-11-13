//! Golden digests of the similarity maths, computed with the pre-optimization
//! code (commit 8dd77bed) on fixed fixtures. Any change to the Gram matrix,
//! eigen-decomposition, average linkage or common support that alters a single
//! bit of the v1/v2 geometry fails here.
use super::*;
use sha2::{Digest, Sha256};

fn fixture(missing: bool) -> Vec<Vec<f32>> {
    let mut state = 0x9e3779b97f4a7c15u64;
    let mut next = move || {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        ((state >> 40) as f32 / (1u64 << 24) as f32) * 2.0 - 1.0
    };
    (0..9)
        .map(|member| {
            (0..5000)
                .map(|voxel| {
                    let signal = match member % 3 {
                        0 => (voxel as f32 / 37.).sin(),
                        1 => (voxel as f32 / 53.).cos() * 1.5,
                        _ => (voxel as f32 / 71.).sin() + 0.25,
                    };
                    let value = signal + 0.4 * next() + 1000.;
                    if missing && (voxel * 7 + member * 13) % 97 == 0 {
                        f32::NAN
                    } else {
                        value
                    }
                })
                .collect()
        })
        .collect()
}

fn geometry_digest(g: &math::Geometry) -> String {
    let mut hash = Sha256::new();
    let mut put = |v: f64| hash.update(v.to_bits().to_le_bytes());
    for c in &g.coordinates {
        put(c[0]);
        put(c[1]);
    }
    for row in g.component_scores.iter().chain(&g.distances) {
        row.iter().for_each(|&v| put(v));
    }
    g.eigenvalues.iter().for_each(|&v| put(v));
    put(g.explained_fraction);
    put(g.stress);
    put(f64::from(u8::from(g.orderable)));
    for m in &g.merges {
        put(m.left as f64);
        put(m.right as f64);
        put(m.count as f64);
        put(m.distance);
    }
    format!("{:x}", hash.finalize())
}

#[test]
fn similarity_geometry_matches_pre_optimization_digests() {
    let rows = fixture(false);
    let support: Vec<usize> = (0..5000).collect();
    let token = SampleCancellation::default();
    let effect = geometry_digest(&math::fit(&rows, &support, &Distance::Effect, &token).unwrap());
    let shape =
        geometry_digest(&math::fit(&rows, &support, &Distance::PatternShape, &token).unwrap());
    let gappy = fixture(true);
    let candidates: Vec<usize> = (0..5000).map(|v| v * 3 + 1).collect();
    let members: Vec<usize> = (0..9).collect();
    let (common, support_sha) = common_support(&gappy, &members, &candidates, &token).unwrap();
    let gappy_shape =
        geometry_digest(&math::fit(&gappy, &common, &Distance::PatternShape, &token).unwrap());
    assert_eq!(common.len(), 4536);
    assert_eq!(
        effect,
        "cdcf35ec7dde02d18586034cdbf67ad2d4df21b1c58333455b69090ab9051853"
    );
    assert_eq!(
        shape,
        "adaa08e8bece6e1bb0345631d256df2b9cdcdab25041fa7054b82ebb8b29490f"
    );
    assert_eq!(
        support_sha,
        "449c3b3014189657b828dfa329ca6ec80b2f8c5cc21728017c22c0b5e6bcfb06"
    );
    assert_eq!(
        gappy_shape,
        "32086aefbd0ff8eb42bc85d41f4d8f51b8772140dedd726d5a77ab2afca20da7"
    );
}
