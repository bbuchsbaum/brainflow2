//! Distance of each observation to the group mean (QA features 2026-10-31 §5).
//!
//! The group mean is the voxelwise mean of the requested observations on
//! their common finite support: the voxels (inside the optional mask) where
//! every observation is finite. Each observation's distance to that mean is
//! the Euclidean distance over the support, with the correlation distance
//! (1 − Pearson r) alongside. Two passes over the sample cache keep memory at
//! O(voxels), never O(observations × voxels).
use super::*;

const MAX_MEMBERS: usize = 512;
const MAX_VOXELS: usize = 16_000_000;

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub members: Vec<SetMemberRef>,
    #[serde(default)]
    pub mask: Option<crate::population_mask::MaskSource>,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberDistance {
    pub member_id: String,
    /// sqrt(Σ (x − mean)²) over the common support.
    pub euclidean: f64,
    /// 1 − Pearson r between the observation and the mean; None when either
    /// is constant on the support.
    pub correlation: Option<f64>,
    /// Decoded source digest the distance was computed from.
    pub sha256: String,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Result {
    /// Request order.
    pub members: Vec<MemberDistance>,
    /// Voxels of the common finite support.
    pub support_voxels: usize,
    /// Candidate voxels (the grid, or the mask) before the finite intersection.
    pub candidate_voxels: usize,
}

/// Streaming distances of one observation to the mean on the support: the
/// squared Euclidean sum and the co-moments of (x, mean), updated stably one
/// voxel at a time (Welford), so no per-observation array is materialized.
#[derive(Default)]
struct Moments {
    n: f64,
    squared: f64,
    mean_x: f64,
    mean_m: f64,
    m2x: f64,
    m2m: f64,
    cxm: f64,
}

impl Moments {
    fn push(&mut self, x: f64, m: f64) {
        self.squared += (x - m).powi(2);
        self.n += 1.0;
        let (dx, dm) = (x - self.mean_x, m - self.mean_m);
        self.mean_x += dx / self.n;
        self.mean_m += dm / self.n;
        self.m2x += dx * (x - self.mean_x);
        self.m2m += dm * (m - self.mean_m);
        self.cxm += dx * (m - self.mean_m);
    }

    /// (Euclidean distance, correlation distance 1 − r or None if constant).
    fn distances(&self) -> (f64, Option<f64>) {
        let scale = (self.m2x * self.m2m).sqrt();
        let correlation = (scale > f64::EPSILON * self.m2x.max(self.m2m).max(1.0))
            .then(|| (1.0 - (self.cxm / scale).clamp(-1.0, 1.0)).max(0.0));
        (self.squared.sqrt(), correlation)
    }
}

/// The mean and the common support, shared read-only by pass 2.
type Reference = Arc<(Vec<f64>, Vec<bool>)>;

/// What every member read checks and visits.
#[derive(Clone)]
struct GridSpec {
    candidate: Arc<Candidate>,
    dims: Vec<usize>,
    affine: Matrix4<f32>,
    mask: Option<Arc<crate::population_mask::PreparedMask>>,
}

/// The voxels a calculation reads: the whole grid, or the mask's voxels as
/// u32 linear indices (no index array at all without a mask).
enum Candidate {
    Grid(usize),
    Mask(Vec<u32>),
}

impl Candidate {
    fn len(&self) -> usize {
        match self {
            Self::Grid(count) => *count,
            Self::Mask(indices) => indices.len(),
        }
    }
    fn index(&self, k: usize) -> usize {
        match self {
            Self::Grid(_) => k,
            Self::Mask(indices) => indices[k] as usize,
        }
    }
}

pub async fn evaluate(
    request: Request,
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
            "Distance to the group mean needs 2–512 uniquely identified observations.",
        ));
    }
    let mut paths = Vec::with_capacity(n);
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
        .ok_or_else(|| input("Distance grid overflow."))?;
    if count > u32::MAX as usize {
        return Err(input("Distance grid exceeds the 32-bit voxel index range."));
    }
    let candidate = match &mask {
        None => {
            if count > MAX_VOXELS {
                return Err(input(
                    "Distance to the group mean exceeds 16 million voxels. Choose a mask or a smaller grid.",
                ));
            }
            Candidate::Grid(count)
        }
        Some(mask) => {
            let mut indices = Vec::new();
            for index in 0..count {
                if index % 65_536 == 0 {
                    token.check()?;
                }
                let (x, y, z) = (
                    index % dimensions[0],
                    index / dimensions[0] % dimensions[1],
                    index / (dimensions[0] * dimensions[1]),
                );
                if mask.includes(x, y, z) {
                    indices.push(index as u32);
                    if indices.len() > MAX_VOXELS {
                        return Err(input(
                            "Distance to the group mean exceeds 16 million voxels. Choose a mask or a smaller grid.",
                        ));
                    }
                }
            }
            Candidate::Mask(indices)
        }
    };
    let candidate = Arc::new(candidate);
    let spec = GridSpec {
        candidate: candidate.clone(),
        dims: dimensions.clone(),
        affine,
        mask: mask.clone(),
    };

    // Visit one observation's candidate voxels inside the cache closure (no
    // copy of its values): `visit(k, value)` with NaN for missing, after the
    // grid, digest and frame checks. Returns the visitor's state and digest.
    async fn visit<S: Send + 'static>(
        state: &BridgeState,
        token: &SampleCancellation,
        grid_spec: &GridSpec,
        path: std::path::PathBuf,
        member: SetMemberRef,
        mut acc: S,
        visit: fn(&mut S, usize, f32),
    ) -> BridgeResult<(S, String)> {
        let check = token.clone();
        let GridSpec {
            candidate,
            dims,
            affine,
            mask,
        } = grid_spec.clone();
        state
            .set_sample_cache
            .with_volume_cancelable(path, token.clone(), move |volume, revision| {
                if let Some(mask) = mask {
                    mask.validate_grid(volume)?;
                }
                let (actual, transform) = grid(volume)?;
                if actual != dims
                    || transform.iter().zip(affine.iter()).any(|(a, b)| (a - b).abs() > 1e-5)
                {
                    return Err(input(
                        "Distance to the group mean requires identical voxel grids and world affines; resample explicitly first.",
                    ));
                }
                if member
                    .expected_sha256
                    .as_ref()
                    .is_some_and(|h| h != &revision.sha256)
                {
                    return Err(input(format!("Frozen source changed for {}.", member.member_id)));
                }
                let frames = crate::stack_length_for_volume(volume);
                let selected = member.stack_index.unwrap_or(0);
                if selected >= frames || (frames > 1 && member.stack_index.is_none()) {
                    return Err(input(format!(
                        "{} needs an explicit valid frame.",
                        member.member_id
                    )));
                }
                for k in 0..candidate.len() {
                    if k % 65_536 == 0 {
                        check.check()?;
                    }
                    let i = candidate.index(k);
                    let value = crate::read_member_frame_at_voxel(
                        volume,
                        i % dims[0],
                        i / dims[0] % dims[1],
                        i / (dims[0] * dims[1]),
                        selected,
                    )
                    .unwrap_or(f32::NAN);
                    visit(&mut acc, k, value);
                }
                Ok((acc, revision.sha256.clone()))
            })
            .await
    }

    // Pass 1: the voxelwise sum and the common finite support. The sum and
    // support move into each member's closure and back, so only one copy
    // exists; the sum then becomes the mean in place.
    let mut acc = (vec![0f64; candidate.len()], vec![true; candidate.len()]);
    let mut digests = Vec::with_capacity(n);
    for (index, path) in paths.iter().enumerate() {
        let (next, sha256) = visit(
            state,
            &token,
            &spec,
            path.clone(),
            request.members[index].clone(),
            acc,
            |(sum, support): &mut (Vec<f64>, Vec<bool>), k, v| {
                if v.is_finite() {
                    sum[k] += v as f64;
                } else {
                    support[k] = false;
                }
            },
        )
        .await?;
        acc = next;
        digests.push(sha256);
    }
    let (mut mean, support) = acc;
    let support_voxels = support.iter().filter(|&&s| s).count();
    if support_voxels < 2 {
        return Err(input(
            "The observations share fewer than two finite voxels; no distance to their mean.",
        ));
    }
    for (k, value) in mean.iter_mut().enumerate() {
        if k % 65_536 == 0 {
            token.check()?;
        }
        *value /= n as f64;
    }
    let reference: Reference = Arc::new((mean, support));

    // Pass 2: each observation against the mean, streamed.
    let mut members = Vec::with_capacity(n);
    for (index, first_digest) in digests.iter().enumerate() {
        let (moments, sha256) = visit(
            state,
            &token,
            &spec,
            paths[index].clone(),
            request.members[index].clone(),
            (Moments::default(), reference.clone()),
            |(moments, reference): &mut (Moments, Reference), k, v| {
                if reference.1[k] {
                    moments.push(v as f64, reference.0[k]);
                }
            },
        )
        .await?;
        if &sha256 != first_digest {
            return Err(input(format!(
                "{} changed while its distance was computed.",
                request.members[index].member_id
            )));
        }
        let (euclidean, correlation) = moments.0.distances();
        members.push(MemberDistance {
            member_id: request.members[index].member_id.clone(),
            euclidean,
            correlation,
            sha256,
        });
    }
    // The sources must not have changed under the calculation.
    guard.validate(token.clone()).await?;
    Ok(Result {
        members,
        support_voxels,
        candidate_voxels: candidate.len(),
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
        }
    }

    #[tokio::test]
    async fn distances_match_a_hand_computed_fixture() {
        // Five voxels; the fifth is missing in S0, so the support is the
        // first four. Mean there = [2, 2, 2, 4] (mean m̄ = 2.5).
        //   S0 − mean = [-1, 0, 1, 0]  → √2;   r = 3 / √(5·3) = 0.774597
        //   S1 − mean = [ 1, 0,-1,-4]  → √18;  r = −3 / √(5·3)
        //   S2 − mean = [ 0, 0, 0, 4]  → 4;    r = 9 / √(27·3) = 1
        let sources = vec![
            TestSource::new(&[5, 1, 1], &[1., 2., 3., 4., f32::NAN]),
            TestSource::new(&[5, 1, 1], &[3., 2., 1., 0., 100.]),
            TestSource::new(&[5, 1, 1], &[2., 2., 2., 8., 100.]),
        ];
        let state = BridgeState::default().unwrap();
        let result = evaluate(request(&sources), &state, SampleCancellation::default())
            .await
            .unwrap();
        assert_eq!(result.candidate_voxels, 5);
        assert_eq!(result.support_voxels, 4);
        let r = 3.0 / 15f64.sqrt();
        let expected = [
            (2f64.sqrt(), Some(1.0 - r)),
            (18f64.sqrt(), Some(1.0 + r)),
            (4.0, Some(0.0)),
        ];
        for (i, (member, (euclidean, correlation))) in
            result.members.iter().zip(expected).enumerate()
        {
            assert_eq!(member.member_id, format!("S{i}"));
            assert!((member.euclidean - euclidean).abs() < 1e-9, "{member:?}");
            let got = member.correlation.unwrap();
            assert!((got - correlation.unwrap()).abs() < 1e-9, "{member:?}");
            assert_eq!(member.sha256.len(), 64);
        }
    }

    #[tokio::test]
    async fn a_mask_restricts_the_support_to_its_voxels() {
        // The same maps as the hand-computed fixture, masked to voxels 0–2:
        // mean [2, 2, 2]; S0 − mean = [-1, 0, 1] → √2, S1 → √2, S2 → 0.
        let sources = vec![
            TestSource::new(&[5, 1, 1], &[1., 2., 3., 4., f32::NAN]),
            TestSource::new(&[5, 1, 1], &[3., 2., 1., 0., 100.]),
            TestSource::new(&[5, 1, 1], &[2., 2., 2., 8., 100.]),
        ];
        let mask = TestSource::new(&[5, 1, 1], &[1., 1., 1., 0., 0.]);
        let state = BridgeState::default().unwrap();
        let mut q = request(&sources);
        q.mask = Some(crate::population_mask::MaskSource {
            source_path: mask.path.to_string_lossy().into(),
            expected_sha256: None,
        });
        let result = evaluate(q, &state, SampleCancellation::default())
            .await
            .unwrap();
        assert_eq!(result.candidate_voxels, 3);
        assert_eq!(result.support_voxels, 3);
        assert!((result.members[0].euclidean - 2f64.sqrt()).abs() < 1e-9);
        assert!((result.members[1].euclidean - 2f64.sqrt()).abs() < 1e-9);
        assert!(result.members[2].euclidean.abs() < 1e-12);
        // The mean is constant on the masked support: no correlation distance.
        assert!(result.members.iter().all(|m| m.correlation.is_none()));
    }

    #[tokio::test]
    async fn a_cancelled_ticket_stops_the_calculation() {
        let sources = vec![
            TestSource::new(&[2, 1, 1], &[1., 2.]),
            TestSource::new(&[2, 1, 1], &[3., 4.]),
        ];
        let state = BridgeState::default().unwrap();
        let token = SampleCancellation::default();
        token.cancel();
        assert!(evaluate(request(&sources), &state, token).await.is_err());
    }

    #[tokio::test]
    async fn a_constant_observation_has_no_correlation_distance() {
        let sources = vec![
            TestSource::new(&[2, 2, 1], &[5.; 4]),
            TestSource::new(&[2, 2, 1], &[1., 2., 3., 4.]),
        ];
        let state = BridgeState::default().unwrap();
        let result = evaluate(request(&sources), &state, SampleCancellation::default())
            .await
            .unwrap();
        // Mean [3, 3.5, 4, 4.5]: S0 − mean = [2, 1.5, 1, 0.5] → √7.5.
        assert!((result.members[0].euclidean - 7.5f64.sqrt()).abs() < 1e-9);
        assert_eq!(result.members[0].correlation, None);
        assert!(result.members[1].correlation.unwrap().abs() < 1e-9);
    }

    #[tokio::test]
    async fn refuses_one_observation_and_duplicate_ids() {
        let sources = vec![
            TestSource::new(&[2, 1, 1], &[1., 2.]),
            TestSource::new(&[2, 1, 1], &[1., 2.]),
        ];
        let state = BridgeState::default().unwrap();
        let mut one = request(&sources);
        one.members.truncate(1);
        assert!(evaluate(one, &state, SampleCancellation::default())
            .await
            .is_err());
        let mut duplicate = request(&sources);
        duplicate.members[1].member_id = "S0".into();
        assert!(evaluate(duplicate, &state, SampleCancellation::default())
            .await
            .is_err());
    }

    #[tokio::test]
    async fn refuses_mismatched_grids() {
        let sources = vec![
            TestSource::new(&[2, 1, 1], &[1., 2.]),
            TestSource::new(&[3, 1, 1], &[1., 2., 3.]),
        ];
        let state = BridgeState::default().unwrap();
        let error = evaluate(request(&sources), &state, SampleCancellation::default())
            .await
            .unwrap_err();
        assert!(format!("{error:?}").contains("identical voxel grids"));
    }

    /// Timing on a real set (QA run fir3d: 72 maps of 41 × 49 × 40). Run with
    /// `BRAINFLOW_FIR3D_MAPS=<fir3d/maps> cargo test -p api-bridge --lib
    /// fir3d_timing -- --ignored --nocapture`; set
    /// `BRAINFLOW_SET_SAMPLE_CACHE_BYTES` small to force the pass-2 re-decode.
    #[tokio::test]
    #[ignore = "requires the fir3d fixture"]
    async fn fir3d_timing() {
        let dir = std::path::PathBuf::from(std::env::var("BRAINFLOW_FIR3D_MAPS").unwrap());
        let mut files: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().path())
            .filter(|p| p.to_string_lossy().ends_with(".nii.gz"))
            .collect();
        files.sort();
        let q = Request {
            members: files
                .iter()
                .enumerate()
                .map(|(i, path)| SetMemberRef {
                    member_id: format!("M{i:02}"),
                    display_label: None,
                    design_values: Default::default(),
                    source_path: path.to_string_lossy().into(),
                    stack_index: None,
                    expected_sha256: None,
                })
                .collect(),
            mask: None,
        };
        let state = BridgeState::default().unwrap();
        for run in ["cold", "warm"] {
            let now = std::time::Instant::now();
            let result = evaluate(q.clone(), &state, SampleCancellation::default())
                .await
                .unwrap();
            eprintln!(
                "FIR3D_MEAN_DISTANCE run={run} members={} support={} ms={:.1}",
                result.members.len(),
                result.support_voxels,
                now.elapsed().as_secs_f64() * 1000.0
            );
        }
    }
}
