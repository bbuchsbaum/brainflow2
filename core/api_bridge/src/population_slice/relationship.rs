//! Bounded exact spatial relationship fit. Owns temporary arrays, not GPU layers.
use super::*;
use sha2::{Digest, Sha256};
use std::sync::OnceLock;
#[path = "relationship_math.rs"]
mod math;
const MAX_MEMBERS: usize = 128;
const MATRIX_BYTES: usize = 128 * 1024 * 1024;
const MAX_VOXELS: usize = 2_000_000;
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Distance {
    Effect,
    PatternShape,
}
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Region {
    pub world_mm: [f64; 3],
    pub radius_mm: f64,
}
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub members: Vec<SetMemberRef>,
    pub mask: Option<crate::population_mask::MaskSource>,
    pub region: Option<Region>,
    pub distance: Distance,
}
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Result {
    pub fit_id: String,
    pub request: Request,
    pub support_sha256: String,
    pub candidate_voxels: usize,
    pub common_voxels: usize,
    pub finite_counts: Vec<usize>,
    pub dimensions: Vec<usize>,
    pub affine: [[f32; 4]; 4],
    pub geometry: math::Geometry,
}
pub async fn evaluate(
    mut request: Request,
    state: &BridgeState,
    token: SampleCancellation,
) -> BridgeResult<Result> {
    let n = request.members.len();
    if !(2..=MAX_MEMBERS).contains(&n)
        || request
            .members
            .iter()
            .map(|m| &m.member_id)
            .collect::<HashSet<_>>()
            .len()
            != n
        || request
            .members
            .iter()
            .any(|m| m.member_id.trim().is_empty())
    {
        return Err(input(
            "Exact similarity requires 2–128 uniquely identified observations.",
        ));
    }
    if request.region.as_ref().is_some_and(|r| {
        !r.world_mm.iter().all(|v| v.is_finite())
            || !r.radius_mm.is_finite()
            || r.radius_mm <= 0.
            || r.radius_mm > 200.
    }) {
        return Err(input(
            "Choose a finite region with radius greater than zero and at most 200 mm.",
        ));
    }
    static ADMISSION: OnceLock<Arc<tokio::sync::Semaphore>> = OnceLock::new();
    let admission = Arc::clone(ADMISSION.get_or_init(|| Arc::new(tokio::sync::Semaphore::new(1))));
    let permit = tokio::select! { _=token.cancelled()=>return Err(crate::population_sampling::cancelled()),p=admission.acquire_owned()=>p.map_err(|_|input("Similarity admission closed."))? };
    let permit = Arc::new(permit);
    let mut paths = Vec::new();
    for m in &request.members {
        token.check()?;
        paths.push(crate::resolve_member_source_path(&m.source_path, state).await?);
    }
    let mask_path = match &request.mask {
        Some(m) => Some(crate::resolve_member_source_path(&m.source_path, state).await?),
        None => None,
    };
    let guard = QuerySourceGuard::capture(
        paths
            .iter()
            .cloned()
            .chain(mask_path.iter().cloned())
            .collect(),
        token.clone(),
    )
    .await?;
    let mask = match (&request.mask, mask_path) {
        (Some(m), Some(path)) => {
            Some(crate::population_mask::prepare_mask(m, path, state, &token).await?)
        }
        _ => None,
    };
    let (dimensions, affine) = state
        .set_sample_cache
        .with_volume_cancelable(paths[0].clone(), token.clone(), |volume, _| grid(volume))
        .await?;
    let count = dimensions
        .iter()
        .try_fold(1usize, |a, &b| a.checked_mul(b))
        .ok_or_else(|| input("Similarity grid overflow."))?;
    if count > 64_000_000 {
        return Err(input(
            "Similarity grid exceeds 64 million voxels. Use a smaller co-registered grid.",
        ));
    }
    let dims = dimensions.clone();
    let frame = affine;
    let support_mask = mask.clone();
    let region = request.region.clone();
    let check = token.clone();
    let held = permit.clone();
    let candidate = Arc::new(
        tokio::task::spawn_blocking(move || -> BridgeResult<Vec<usize>> {
            let _held = held;
            let mut indices = Vec::new();
            for index in 0..count {
                if index % 4096 == 0 {
                    check.check()?;
                }
                let x = index % dims[0];
                let y = index / dims[0] % dims[1];
                let z = index / (dims[0] * dims[1]);
                if support_mask.as_ref().is_some_and(|m| !m.includes(x, y, z)) {
                    continue;
                }
                if let Some(r) = &region {
                    let world = frame.transform_point(&Point3::new(x as f32, y as f32, z as f32));
                    if (0..3)
                        .map(|a| (world[a] as f64 - r.world_mm[a]).powi(2))
                        .sum::<f64>()
                        > r.radius_mm.powi(2)
                    {
                        continue;
                    }
                }
                if indices.len() >= MAX_VOXELS.min(MATRIX_BYTES / (4 * n)) {
                    return Err(input(
                        "Exact similarity exceeds its 128 MiB observation matrix or two-million-voxel support limit. Choose a mask/region, fewer observations or a smaller grid.",
                    ));
                }
                indices.push(index);
            }
            Ok(indices)
        })
        .await
        .map_err(|e| input(e.to_string()))??,
    );
    if candidate.len() < 2 {
        return Err(input(
            "The requested spatial support contains fewer than two voxels.",
        ));
    }
    let mut rows = Vec::with_capacity(n);
    let mut finite_counts = Vec::new();
    for (member, path) in request.members.iter_mut().zip(paths) {
        let m = member.clone();
        let indices = candidate.clone();
        let dims = dimensions.clone();
        let support_mask = mask.clone();
        let check = token.clone();
        let held = permit.clone();
        let (row, revision) = state
            .set_sample_cache
            .with_volume_cancelable(path, token.clone(), move |volume, revision| {
                let _held = held;
                if let Some(mask) = support_mask {
                    mask.validate_grid(volume)?;
                }
                let (actual, transform) = grid(volume)?;
                if actual != dims
                    || transform.iter().zip(affine.iter()).any(|(a, b)| (a - b).abs() > 1e-5)
                {
                    return Err(input(
                        "Similarity requires identical voxel grids and world affines; resample explicitly first.",
                    ));
                }
                if m.expected_sha256.as_ref().is_some_and(|h| h != &revision.sha256) {
                    return Err(input(format!("Frozen source changed for {}.", m.member_id)));
                }
                let frames = crate::stack_length_for_volume(volume);
                let selected = m.stack_index.unwrap_or(0);
                if selected >= frames || (frames > 1 && m.stack_index.is_none()) {
                    return Err(input(format!("{} needs an explicit valid frame.", m.member_id)));
                }
                let mut row = Vec::with_capacity(indices.len());
                for (k, &index) in indices.iter().enumerate() {
                    if k % 4096 == 0 {
                        check.check()?;
                    }
                    row.push(crate::read_member_frame_at_voxel(
                        volume,
                        index % dims[0],
                        index / dims[0] % dims[1],
                        index / (dims[0] * dims[1]),
                        selected,
                    ).unwrap_or(f32::NAN));
                }
                Ok((row, revision.clone()))
            })
            .await?;
        let finite = row.iter().filter(|v| v.is_finite()).count();
        if finite == 0 {
            return Err(input(format!("{} has no finite values on the requested support; change the context or support explicitly.",member.member_id)));
        }
        member.expected_sha256 = Some(revision.sha256);
        finite_counts.push(finite);
        rows.push(row);
    }
    if let (Some(source), Some(mask)) = (&mut request.mask, &mask) {
        source.expected_sha256 = Some(mask.revision.sha256.clone());
    }
    let labels: Vec<_> = request
        .members
        .iter()
        .map(|m| m.member_id.clone())
        .collect();
    let distance = request.distance.clone();
    let check = token.clone();
    let held = permit.clone();
    let candidates = candidate.clone();
    let (geometry, common_voxels, support_sha256) = tokio::task::spawn_blocking(move || {
        let _held = held;
        let mut common = Vec::new();
        let mut hash = Sha256::new();
        for (j, &index) in candidates.iter().enumerate() {
            if j % 4096 == 0 {
                check.check()?;
            }
            if rows.iter().all(|row| row[j].is_finite()) {
                common.push(j);
                hash.update((index as u64).to_le_bytes());
            }
        }
        if matches!(distance, Distance::PatternShape) && common.len() >= 2 {
            for (i, row) in rows.iter().enumerate() {
                if common.iter().all(|&j| row[j] == row[common[0]]) {
                    return Err(input(format!(
                        "{} is constant on common support; pattern shape is undefined. Use effect distance or change context/support.",
                        labels[i],
                    )));
                }
            }
        }
        let geometry = math::fit(&rows, &common, &distance, &check)?;
        Ok::<_, bridge_types::BridgeError>((
            geometry,
            common.len(),
            format!("{:x}", hash.finalize()),
        ))
    })
    .await
    .map_err(|e| input(e.to_string()))??;
    guard.validate(token.clone()).await?;
    token.check()?;
    let affine = std::array::from_fn(|r| std::array::from_fn(|c| affine[(r, c)]));
    let identity = serde_json::to_vec(&(
        "classical-mds-common-support-v1",
        &request,
        &dimensions,
        affine,
        &support_sha256,
    ))
    .map_err(|e| input(e.to_string()))?;
    Ok(Result {
        fit_id: format!("{:x}", Sha256::digest(identity)),
        request,
        support_sha256,
        candidate_voxels: candidate.len(),
        common_voxels,
        finite_counts,
        dimensions,
        affine,
        geometry,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::set_sample_cache::TestSource;
    fn request(sources: &[TestSource]) -> Request {
        Request {
            members: sources
                .iter()
                .enumerate()
                .map(|(i, s)| SetMemberRef {
                    member_id: format!("S{i}"),
                    display_label: None,
                    design_values: Default::default(),
                    source_path: s.path.to_string_lossy().into(),
                    stack_index: None,
                    expected_sha256: None,
                })
                .collect(),
            mask: None,
            region: None,
            distance: Distance::Effect,
        }
    }
    #[tokio::test]
    #[ignore = "requires audited external 80-map fixture"]
    async fn relationship_real_fixture_acceptance() {
        let root = std::path::PathBuf::from(
            std::env::var("BRAINFLOW_POPULATION_FIXTURE").expect("fixture directory"),
        );
        let expected: serde_json::Value =
            serde_json::from_slice(&std::fs::read(root.join("expected.json")).unwrap()).unwrap();
        let q:Request=serde_json::from_value(serde_json::json!({"members":(1..=80).map(|i|{let id=format!("S{i:03}");serde_json::json!({"memberId":id,"sourcePath":root.join(format!("maps/{id}.nii.gz")),"expectedSha256":expected["sourceSha256"][&id]})}).collect::<Vec<_>>(),"distance":"effect"})).unwrap();
        let state = BridgeState::default().unwrap();
        let now = std::time::Instant::now();
        let result = evaluate(q, &state, SampleCancellation::default())
            .await
            .unwrap();
        assert_eq!(result.geometry.coordinates.len(), 80);
        assert!(result.common_voxels > 1000);
        assert!(result.common_voxels < result.candidate_voxels);
        assert!(result.geometry.distances[0][1] < 1e-10);
        assert!(result.geometry.distances[0][40] > 0.);
        eprintln!("RELATIONSHIP_FIXTURE members=80 candidate={} common={} fit_ms={:.2} stress={:.6} retained={:.6} matrix_bytes={}",result.candidate_voxels,result.common_voxels,now.elapsed().as_secs_f64()*1000.,result.geometry.stress,result.geometry.explained_fraction,80*result.candidate_voxels*4);
    }
    #[tokio::test]
    async fn relationship_explicit_frames_and_binary_mask() {
        let a = TestSource::new(&[3, 3, 3, 2], &[vec![1.; 27], vec![9.; 27]].concat());
        let b = TestSource::new(&[3, 3, 3], &[3.; 27]);
        let sources = vec![a, b];
        let mask = TestSource::new(
            &[3, 3, 3],
            &(0..27)
                .map(|i| if i < 3 { 1. } else { 0. })
                .collect::<Vec<_>>(),
        );
        let state = BridgeState::default().unwrap();
        let mut q = request(&sources);
        assert!(evaluate(q.clone(), &state, SampleCancellation::default())
            .await
            .is_err());
        q.members[0].stack_index = Some(1);
        q.mask = Some(crate::population_mask::MaskSource {
            source_path: mask.path.to_string_lossy().into(),
            expected_sha256: None,
        });
        let result = evaluate(q, &state, SampleCancellation::default())
            .await
            .unwrap();
        assert_eq!(result.common_voxels, 3);
        assert!((result.geometry.distances[0][1] - 6.).abs() < 1e-12);
        assert!(result.request.mask.unwrap().expected_sha256.is_some());
    }
    #[tokio::test]
    async fn relationship_common_support_freezes_sources_and_uses_actual_frames() {
        let mut a = vec![1.; 27];
        a[0] = f32::NAN;
        let mut b = vec![5.; 27];
        b[1] = f32::NAN;
        let sources = vec![
            TestSource::new(&[3, 3, 3], &a),
            TestSource::new(&[3, 3, 3], &b),
        ];
        let state = BridgeState::default().unwrap();
        let result = evaluate(request(&sources), &state, SampleCancellation::default())
            .await
            .unwrap();
        assert_eq!(result.candidate_voxels, 27);
        assert_eq!(result.common_voxels, 25);
        assert_eq!(result.finite_counts, vec![26, 26]);
        assert!((result.geometry.distances[0][1] - 4.).abs() < 1e-12);
        assert!(result
            .request
            .members
            .iter()
            .all(|m| m.expected_sha256.as_ref().unwrap().len() == 64));
        let repeated = evaluate(
            result.request.clone(),
            &state,
            SampleCancellation::default(),
        )
        .await
        .unwrap();
        assert_eq!(result.fit_id, repeated.fit_id);
        let mut changed = result.request;
        changed.members[0].expected_sha256 = Some("0".repeat(64));
        assert!(evaluate(changed, &state, SampleCancellation::default())
            .await
            .is_err());
        let token = SampleCancellation::default();
        token.cancel();
        assert!(evaluate(request(&sources), &state, token).await.is_err());
    }
    #[tokio::test]
    async fn relationship_region_mask_and_constant_shape_refusals() {
        let sources = vec![
            TestSource::new(&[3, 3, 3], &[1.; 27]),
            TestSource::new(&[3, 3, 3], &[2.; 27]),
        ];
        let state = BridgeState::default().unwrap();
        let mut q = request(&sources);
        q.region = Some(Region {
            world_mm: [1., 1., 1.],
            radius_mm: 1.01,
        });
        let result = evaluate(q.clone(), &state, SampleCancellation::default())
            .await
            .unwrap();
        assert_eq!(result.common_voxels, 7);
        q.distance = Distance::PatternShape;
        assert!(evaluate(q, &state, SampleCancellation::default())
            .await
            .is_err());
        let disjoint = vec![
            TestSource::new(
                &[3, 3, 3],
                &(0..27)
                    .map(|i| if i == 0 { 1. } else { f32::NAN })
                    .collect::<Vec<_>>(),
            ),
            TestSource::new(
                &[3, 3, 3],
                &(0..27)
                    .map(|i| if i == 1 { 1. } else { f32::NAN })
                    .collect::<Vec<_>>(),
            ),
        ];
        assert!(
            evaluate(request(&disjoint), &state, SampleCancellation::default())
                .await
                .is_err()
        );
    }
}
