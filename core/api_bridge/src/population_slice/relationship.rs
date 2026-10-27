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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub explanation: Option<ExplanationRequest>,
    /// Absent: v1 (refuse on any unusable member). Present: v2 eligibility,
    /// which reports unusable members as unassigned instead of refusing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eligibility: Option<Eligibility>,
    pub members: Vec<SetMemberRef>,
    pub mask: Option<crate::population_mask::MaskSource>,
    pub region: Option<Region>,
    pub distance: Distance,
}
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Eligibility {
    /// Members whose finite count on the candidate support is below
    /// `tau x median` (median over members with any finite value) are unassigned.
    pub low_coverage_tau: f64,
}
const LABEL_V1: &str = "classical-mds-common-support-v1";
const LABEL_V2: &str = "classical-mds-common-support-v2";
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum UnassignedReason {
    /// No finite value on the candidate support.
    AllMissing,
    /// Finite count divided by the median finite count of non-missing members.
    LowCoverage { fraction: f64 },
    /// Pattern shape only: constant on the voxels shared by the eligible members
    /// before this exclusion. The support is then recomputed once without it and
    /// it stays excluded even if it varies on the larger recomputed support
    /// (re-admitting it could shrink the support again). The reason therefore
    /// describes the pre-exclusion shared voxels, not the fitted support.
    ZeroVarianceOnSupport,
}
impl UnassignedReason {
    fn describe(&self) -> String {
        match self {
            Self::AllMissing => "no finite values".into(),
            Self::LowCoverage { fraction } => {
                format!("low coverage, {:.1}% of the median", 100. * fraction)
            }
            Self::ZeroVarianceOnSupport => "constant on the shared voxels before exclusion".into(),
        }
    }
}
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Unassigned {
    pub member_id: String,
    pub reason: UnassignedReason,
    /// Finite voxels on the candidate support.
    pub finite_count: usize,
    /// Common (fitted) voxels this member would have removed had it been fitted.
    pub support_loss_voxels: usize,
}
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum ExplanationKind {
    Pair { a: String, b: String },
    Component { axis: usize },
    Reconstruction { member: String, components: usize },
}
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExplanationRequest {
    pub field: ExplanationKind,
    pub crosshair_mm: [f32; 3],
    pub orientation: Orientation,
}
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Explanation {
    pub plane: Plane,
    pub values: Vec<Option<f64>>,
    pub total: f64,
    pub label: String,
}
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Result {
    pub explanation: Option<Explanation>,
    pub fit_id: String,
    pub request: Request,
    pub support_sha256: String,
    pub candidate_voxels: usize,
    /// Common finite voxels of the fitted members.
    pub common_voxels: usize,
    /// Per request member, on the candidate support.
    pub finite_counts: Vec<usize>,
    /// Geometry rows/columns follow this order. v1: every request member.
    pub fitted_member_ids: Vec<String>,
    /// Request members excluded by v2 eligibility, in request order. v1: empty.
    pub unassigned: Vec<Unassigned>,
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
    if request.eligibility.as_ref().is_some_and(|e| {
        !e.low_coverage_tau.is_finite() || !(0.0..=1.0).contains(&e.low_coverage_tau)
    }) {
        return Err(input(
            "The low-coverage threshold must be a finite fraction between 0 and 1.",
        ));
    }
    let strict = request.eligibility.is_none();
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
    let explanation_plan = if let Some(explanation) = &request.explanation {
        let q = PopulationSliceRequest {
            inference: None,
            groups: vec![],
            reference: None,
            difference: false,
            focus_only: false,
            focus_window: vec![],
            context_key: "relationship-explanation".into(),
            mask: None,
            members: request.members.clone(),
            working_member_ids: vec![],
            focus_stack_index: None,
            focus_member_id: None,
            crosshair_mm: explanation.crosshair_mm,
            orientation: explanation.orientation.clone(),
            dim_px: [128, 128],
            zoom: 1.,
            summary: SummaryKind::Mean,
            aggregation: None,
            cutouts: None,
        };
        validate(&q)?;
        Some(
            state
                .set_sample_cache
                .with_volume_cancelable(paths[0].clone(), token.clone(), move |volume, _| {
                    pixel_plan(volume, &q)
                })
                .await?,
        )
    } else {
        None
    };
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
        if finite == 0 && strict {
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
    let explanation_request = request.explanation.clone();
    let eligibility = request.eligibility.clone();
    let counts = finite_counts.clone();
    let (geometry, common_voxels, support_sha256, explanation, fitted_member_ids, unassigned) =
        tokio::task::spawn_blocking(move || {
            let _held = held;
            let mut rows = rows;
            let selection = select_members(
                &rows,
                &candidates,
                &counts,
                &distance,
                eligibility.as_ref(),
                &labels,
                &check,
            )?;
            if let Some(request) = &explanation_request {
                refuse_unassigned_explanation(&request.field, &selection.unassigned)?;
            }
            let fitted_labels: Vec<String> = selection
                .fitted
                .iter()
                .map(|&i| labels[i].clone())
                .collect();
            let fitted_rows: Vec<Vec<f32>> = selection
                .fitted
                .iter()
                .map(|&i| std::mem::take(&mut rows[i]))
                .collect();
            drop(rows);
            let common = selection.common;
            let geometry = math::fit(&fitted_rows, &common, &distance, &check)?;
            let explanation = match (explanation_request, explanation_plan) {
                (Some(request), Some(plan)) => {
                    let (values, total, label) = math::explain(
                        &fitted_rows,
                        &common,
                        &distance,
                        &geometry,
                        &request.field,
                        &fitted_labels,
                        &check,
                    )?;
                    let by_index: HashMap<_, _> = common
                        .iter()
                        .zip(values)
                        .map(|(&j, value)| (candidates[j], value))
                        .collect();
                    let raster = plan
                        .pixels
                        .iter()
                        .map(|slot| {
                            slot.and_then(|i| {
                                let v = plan.voxels[i];
                                by_index
                                    .get(
                                        &(v[0]
                                            + v[1] * plan.dimensions[0]
                                            + v[2] * plan.dimensions[0] * plan.dimensions[1]),
                                    )
                                    .copied()
                            })
                        })
                        .collect();
                    Some(Explanation {
                        plane: plan.plane,
                        values: raster,
                        total,
                        label,
                    })
                }
                _ => None,
            };
            Ok::<_, bridge_types::BridgeError>((
                geometry,
                common.len(),
                selection.support_sha256,
                explanation,
                fitted_labels,
                selection.unassigned,
            ))
        })
        .await
        .map_err(|e| input(e.to_string()))??;
    guard.validate(token.clone()).await?;
    token.check()?;
    let affine = std::array::from_fn(|r| std::array::from_fn(|c| affine[(r, c)]));
    let fit_id = fit_identity(&request, &dimensions, affine, &support_sha256)?;
    Ok(Result {
        explanation,
        fit_id,
        request,
        support_sha256,
        candidate_voxels: candidate.len(),
        common_voxels,
        finite_counts,
        fitted_member_ids,
        unassigned,
        dimensions,
        affine,
        geometry,
    })
}
/// Fit identity: SHA-256 of the definition label, the request without its
/// explanation, the grid and the support hash. v1 requests (no eligibility)
/// serialize exactly as before eligibility existed, so v1 fit ids are unchanged.
fn fit_identity(
    request: &Request,
    dimensions: &[usize],
    affine: [[f32; 4]; 4],
    support_sha256: &str,
) -> BridgeResult<String> {
    let mut identity_request = request.clone();
    identity_request.explanation = None;
    let label = if request.eligibility.is_none() {
        LABEL_V1
    } else {
        LABEL_V2
    };
    let identity =
        serde_json::to_vec(&(label, &identity_request, dimensions, affine, support_sha256))
            .map_err(|e| input(e.to_string()))?;
    Ok(format!("{:x}", Sha256::digest(identity)))
}
/// Members fitted on one common support, the unassigned remainder and the support.
struct Selection {
    fitted: Vec<usize>,
    unassigned: Vec<Unassigned>,
    /// Positions in the candidate list that are finite for every fitted member.
    common: Vec<usize>,
    support_sha256: String,
}
fn common_support(
    rows: &[Vec<f32>],
    members: &[usize],
    candidates: &[usize],
    check: &SampleCancellation,
) -> BridgeResult<(Vec<usize>, String)> {
    let mut common = Vec::new();
    let mut hash = Sha256::new();
    for (j, &index) in candidates.iter().enumerate() {
        if j % 4096 == 0 {
            check.check()?;
        }
        if members.iter().all(|&i| rows[i][j].is_finite()) {
            common.push(j);
            hash.update((index as u64).to_le_bytes());
        }
    }
    Ok((common, format!("{:x}", hash.finalize())))
}
fn constant_on(row: &[f32], common: &[usize]) -> bool {
    common.iter().all(|&j| row[j] == row[common[0]])
}
/// v1 (`eligibility` absent) reproduces the original refusals. v2 applies, in
/// order: AllMissing; LowCoverage against `tau x median` finite count of the
/// non-missing members on the candidate support; the common support of the rest;
/// for pattern shape, ZeroVarianceOnSupport followed by one recomputation of the
/// support. One pass suffices: the recomputed support is a superset of the
/// previous one, so a member that varied there still varies. Fewer than two
/// fitted members or common voxels remains a refusal.
fn select_members(
    rows: &[Vec<f32>],
    candidates: &[usize],
    counts: &[usize],
    distance: &Distance,
    eligibility: Option<&Eligibility>,
    labels: &[String],
    check: &SampleCancellation,
) -> BridgeResult<Selection> {
    let n = rows.len();
    let shape = matches!(distance, Distance::PatternShape);
    let Some(eligibility) = eligibility else {
        let fitted: Vec<usize> = (0..n).collect();
        let (common, support_sha256) = common_support(rows, &fitted, candidates, check)?;
        if shape && common.len() >= 2 {
            for (i, row) in rows.iter().enumerate() {
                if constant_on(row, &common) {
                    return Err(input(format!(
                        "{} is constant on common support; pattern shape is undefined. Use effect distance or change context/support.",
                        labels[i],
                    )));
                }
            }
        }
        return Ok(Selection {
            fitted,
            unassigned: vec![],
            common,
            support_sha256,
        });
    };
    let mut reasons: Vec<Option<UnassignedReason>> = counts
        .iter()
        .map(|&c| (c == 0).then_some(UnassignedReason::AllMissing))
        .collect();
    let mut present: Vec<usize> = counts.iter().copied().filter(|&c| c > 0).collect();
    present.sort_unstable();
    // Median of the non-missing finite counts; mean of the two middle values when even.
    let median = present.get(present.len() / 2).map(|&upper| {
        if present.len() % 2 == 1 {
            upper as f64
        } else {
            (present[present.len() / 2 - 1] + upper) as f64 / 2.
        }
    });
    if let Some(median) = median {
        let threshold = eligibility.low_coverage_tau * median;
        for (reason, &count) in reasons.iter_mut().zip(counts) {
            if reason.is_none() && (count as f64) < threshold {
                *reason = Some(UnassignedReason::LowCoverage {
                    fraction: count as f64 / median,
                });
            }
        }
    }
    let mut fitted: Vec<usize> = (0..n).filter(|&i| reasons[i].is_none()).collect();
    let (mut common, mut support_sha256) = common_support(rows, &fitted, candidates, check)?;
    if shape && common.len() >= 2 {
        let constant: Vec<usize> = fitted
            .iter()
            .copied()
            .filter(|&i| constant_on(&rows[i], &common))
            .collect();
        if !constant.is_empty() {
            for &i in &constant {
                reasons[i] = Some(UnassignedReason::ZeroVarianceOnSupport);
            }
            fitted.retain(|i| !constant.contains(i));
            (common, support_sha256) = common_support(rows, &fitted, candidates, check)?;
        }
    }
    let unassigned: Vec<Unassigned> = reasons
        .into_iter()
        .enumerate()
        .filter_map(|(i, reason)| {
            reason.map(|reason| Unassigned {
                member_id: labels[i].clone(),
                reason,
                finite_count: counts[i],
                support_loss_voxels: common.iter().filter(|&&j| !rows[i][j].is_finite()).count(),
            })
        })
        .collect();
    if fitted.len() < 2 || common.len() < 2 {
        let excluded = if unassigned.is_empty() {
            "none".to_string()
        } else {
            unassigned
                .iter()
                .map(|u| {
                    format!(
                        "{} ({}; would remove {} of {} common voxels)",
                        u.member_id,
                        u.reason.describe(),
                        u.support_loss_voxels,
                        common.len()
                    )
                })
                .collect::<Vec<_>>()
                .join(", ")
        };
        let rule = format!(
            "low-coverage τ = {} × median finite count {}",
            eligibility.low_coverage_tau,
            median.map_or("unavailable (no member has finite values)".into(), |m| m
                .to_string()),
        );
        return Err(input(if fitted.len() < 2 {
            format!(
                "The declared eligibility rule ({rule}) left {} fitted observation(s); similarity needs at least 2. Excluded: {excluded}.",
                fitted.len(),
            )
        } else {
            format!(
                "The {} fitted observations share {} common finite voxel(s); similarity needs at least 2. Eligibility rule: {rule}. Excluded: {excluded}.",
                fitted.len(),
                common.len(),
            )
        }));
    }
    Ok(Selection {
        fitted,
        unassigned,
        common,
        support_sha256,
    })
}
/// An explanation may name only fitted members.
fn refuse_unassigned_explanation(
    field: &ExplanationKind,
    unassigned: &[Unassigned],
) -> BridgeResult<()> {
    let named: Vec<&String> = match field {
        ExplanationKind::Pair { a, b } => vec![a, b],
        ExplanationKind::Reconstruction { member, .. } => vec![member],
        ExplanationKind::Component { .. } => vec![],
    };
    for name in named {
        if let Some(u) = unassigned.iter().find(|u| &u.member_id == name) {
            return Err(input(format!(
                "{name} is unassigned in this fit ({}); choose a fitted observation.",
                u.reason.describe()
            )));
        }
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::set_sample_cache::TestSource;
    fn request(sources: &[TestSource]) -> Request {
        Request {
            explanation: None,
            eligibility: None,
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
    async fn explanation_slice_preserves_fit_and_exact_distance_contributions() {
        let sources = vec![
            TestSource::new(&[3, 3, 3], &[1.; 27]),
            TestSource::new(&[3, 3, 3], &[3.; 27]),
        ];
        let state = BridgeState::default().unwrap();
        let mut q = request(&sources);
        let fit = evaluate(q.clone(), &state, SampleCancellation::default())
            .await
            .unwrap();
        q.explanation = Some(ExplanationRequest {
            field: ExplanationKind::Pair {
                a: "S0".into(),
                b: "S1".into(),
            },
            crosshair_mm: [1., 1., 1.],
            orientation: Orientation::Axial,
        });
        let shown = evaluate(q, &state, SampleCancellation::default())
            .await
            .unwrap();
        assert_eq!(shown.fit_id, fit.fit_id);
        let image = shown.explanation.unwrap();
        assert_eq!(image.values.len(), 128 * 128);
        assert!((image.total - 4.).abs() < 1e-12);
        assert!(image.values.iter().any(Option::is_some));
        for value in image.values.into_iter().flatten() {
            assert!((value - 4. / 27.).abs() < 1e-12);
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
    fn grid(values: impl Fn(usize) -> f32) -> TestSource {
        TestSource::new(&[3, 3, 3], &(0..27).map(values).collect::<Vec<_>>())
    }
    fn ramp() -> TestSource {
        grid(|i| i as f32)
    }
    fn wave() -> TestSource {
        grid(|i| ((i * 7) % 11) as f32)
    }
    fn with_tau(sources: &[TestSource], tau: f64, distance: Distance) -> Request {
        let mut q = request(sources);
        q.eligibility = Some(Eligibility {
            low_coverage_tau: tau,
        });
        q.distance = distance;
        q
    }
    async fn run(q: Request) -> BridgeResult<Result> {
        evaluate(
            q,
            &BridgeState::default().unwrap(),
            SampleCancellation::default(),
        )
        .await
    }
    fn reasons(result: &Result) -> Vec<(String, UnassignedReason, usize, usize)> {
        result
            .unassigned
            .iter()
            .map(|u| {
                (
                    u.member_id.clone(),
                    u.reason.clone(),
                    u.finite_count,
                    u.support_loss_voxels,
                )
            })
            .collect()
    }
    fn identity(result: &Result, label: &str) -> String {
        let mut q = result.request.clone();
        q.explanation = None;
        format!(
            "{:x}",
            Sha256::digest(
                serde_json::to_vec(&(
                    label,
                    &q,
                    &result.dimensions,
                    result.affine,
                    &result.support_sha256
                ))
                .unwrap()
            )
        )
    }
    #[test]
    fn eligibility_wire_shape_defaults_to_v1() {
        let base = serde_json::json!({"members":[],"mask":null,"region":null,"distance":"effect"});
        let q: Request = serde_json::from_value(base.clone()).unwrap();
        assert!(q.eligibility.is_none());
        assert!(!serde_json::to_string(&q).unwrap().contains("eligibility"));
        let mut v2 = base.clone();
        v2["eligibility"] = serde_json::json!({"lowCoverageTau":0.9});
        let q: Request = serde_json::from_value(v2).unwrap();
        assert_eq!(q.eligibility.unwrap().low_coverage_tau, 0.9);
        let mut unknown = base;
        unknown["eligibility"] = serde_json::json!({"lowCoverageTau":0.9,"other":1});
        assert!(serde_json::from_value::<Request>(unknown).is_err());
    }
    #[tokio::test]
    async fn no_eligibility_keeps_v1_identity_and_shape() {
        let sources = vec![ramp(), wave(), grid(|i| (i % 4) as f32)];
        let v1 = run(request(&sources)).await.unwrap();
        // The identity formula and label are unchanged from before eligibility existed.
        assert_eq!(v1.fit_id, identity(&v1, "classical-mds-common-support-v1"));
        assert_eq!(v1.fitted_member_ids, vec!["S0", "S1", "S2"]);
        assert!(v1.unassigned.is_empty());
        let json = serde_json::to_value(&v1).unwrap();
        assert!(json["request"].get("eligibility").is_none());
        assert_eq!(
            json["fittedMemberIds"],
            serde_json::json!(["S0", "S1", "S2"])
        );
        assert_eq!(json["unassigned"], serde_json::json!([]));
        // v2 with nothing excluded: same support and geometry, new label and fit id.
        let v2 = run(with_tau(&sources, 0.9, Distance::Effect))
            .await
            .unwrap();
        assert_eq!(v2.fit_id, identity(&v2, "classical-mds-common-support-v2"));
        assert_ne!(v2.fit_id, v1.fit_id);
        assert_eq!(v2.support_sha256, v1.support_sha256);
        assert_eq!(v2.geometry.distances, v1.geometry.distances);
        assert!(v2.unassigned.is_empty());
        let again = run(v2.request.clone()).await.unwrap();
        assert_eq!(again.fit_id, v2.fit_id);
    }
    #[tokio::test]
    async fn v2_all_missing_is_unassigned_and_geometry_covers_fitted_members() {
        let sources = vec![grid(|_| 1.), grid(|_| 3.), grid(|_| f32::NAN)];
        assert!(run(request(&sources)).await.is_err());
        let result = run(with_tau(&sources, 0.9, Distance::Effect))
            .await
            .unwrap();
        assert_eq!(result.request.members.len(), 3);
        assert_eq!(result.finite_counts, vec![27, 27, 0]);
        assert_eq!(result.fitted_member_ids, vec!["S0", "S1"]);
        assert_eq!(
            reasons(&result),
            vec![("S2".into(), UnassignedReason::AllMissing, 0, 27)]
        );
        assert_eq!(result.common_voxels, 27);
        assert_eq!(result.geometry.coordinates.len(), 2);
        assert_eq!(result.geometry.distances.len(), 2);
        assert_eq!(result.geometry.merges.len(), 1);
        assert!((result.geometry.distances[0][1] - 2.).abs() < 1e-12);
        // Support hash equals that of a v1 fit over the fitted members alone.
        let alone = run(request(&sources[..2])).await.unwrap();
        assert_eq!(result.support_sha256, alone.support_sha256);
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(
            json["unassigned"],
            serde_json::json!([{"memberId":"S2","reason":{"kind":"allMissing"},"finiteCount":0,"supportLossVoxels":27}])
        );
    }
    #[tokio::test]
    async fn v2_low_coverage_reports_partial_support_loss() {
        // S2 covers 14 of 27 voxels (for example one hemisphere).
        let sources = vec![ramp(), wave(), grid(|i| if i < 14 { 2. } else { f32::NAN })];
        let v1 = run(request(&sources)).await.unwrap();
        assert_eq!(v1.common_voxels, 14);
        let result = run(with_tau(&sources, 0.9, Distance::Effect))
            .await
            .unwrap();
        assert_eq!(result.fitted_member_ids, vec!["S0", "S1"]);
        assert_eq!(result.common_voxels, 27);
        assert_eq!(
            reasons(&result),
            vec![(
                "S2".into(),
                UnassignedReason::LowCoverage {
                    fraction: 14. / 27.
                },
                14,
                13
            )]
        );
        assert_eq!(result.finite_counts, vec![27, 27, 14]);
    }
    #[tokio::test]
    async fn v2_low_coverage_threshold_is_strict_at_tau_times_median() {
        // Finite counts 20, 20, 20, 10, 9: median 20, tau 0.5, threshold 10.
        let count = |k: usize| move |i: usize| if i < k { (i * i % 5) as f32 } else { f32::NAN };
        let sources = vec![
            grid(count(20)),
            grid(|i| if i < 20 { i as f32 } else { f32::NAN }),
            grid(|i| if i < 20 { (i % 3) as f32 } else { f32::NAN }),
            grid(|i| if i < 10 { (10 - i) as f32 } else { f32::NAN }),
            grid(count(9)),
        ];
        let result = run(with_tau(&sources, 0.5, Distance::Effect))
            .await
            .unwrap();
        assert_eq!(result.finite_counts, vec![20, 20, 20, 10, 9]);
        assert_eq!(result.fitted_member_ids, vec!["S0", "S1", "S2", "S3"]);
        assert_eq!(
            reasons(&result),
            vec![(
                "S4".into(),
                UnassignedReason::LowCoverage { fraction: 0.45 },
                9,
                1
            )]
        );
        assert_eq!(result.common_voxels, 10);
    }
    #[tokio::test]
    async fn v2_median_excludes_all_missing_members() {
        // Non-missing counts 27, 27, 20: median 27, threshold 24.3, S4 excluded.
        // Counting the two missing members would give median 20 and keep S4.
        let sources = vec![
            ramp(),
            wave(),
            grid(|_| f32::NAN),
            grid(|_| f32::NAN),
            grid(|i| if i < 20 { 1. } else { f32::NAN }),
        ];
        let result = run(with_tau(&sources, 0.9, Distance::Effect))
            .await
            .unwrap();
        assert_eq!(result.fitted_member_ids, vec!["S0", "S1"]);
        assert_eq!(
            reasons(&result),
            vec![
                ("S2".into(), UnassignedReason::AllMissing, 0, 27),
                ("S3".into(), UnassignedReason::AllMissing, 0, 27),
                (
                    "S4".into(),
                    UnassignedReason::LowCoverage {
                        fraction: 20. / 27.
                    },
                    20,
                    7
                ),
            ]
        );
    }
    #[tokio::test]
    async fn v2_zero_variance_recomputes_support_once() {
        // S2 is constant where finite and missing on voxels 0..3; S0 misses voxel 0.
        let sources = vec![
            grid(|i| if i == 0 { f32::NAN } else { i as f32 }),
            wave(),
            grid(|i| if i < 3 { f32::NAN } else { 5. }),
        ];
        assert!(run(with_tau(&sources, 0.9, Distance::Effect))
            .await
            .unwrap()
            .unassigned
            .is_empty());
        let mut v1 = request(&sources);
        v1.distance = Distance::PatternShape;
        assert!(run(v1).await.is_err());
        let result = run(with_tau(&sources, 0.9, Distance::PatternShape))
            .await
            .unwrap();
        assert_eq!(result.fitted_member_ids, vec!["S0", "S1"]);
        // Support grows from voxels 3..27 to 1..27 after the exclusion.
        assert_eq!(result.common_voxels, 26);
        assert_eq!(
            reasons(&result),
            vec![("S2".into(), UnassignedReason::ZeroVarianceOnSupport, 24, 2)]
        );
        let alone = {
            let mut q = request(&sources[..2]);
            q.distance = Distance::PatternShape;
            run(q).await.unwrap()
        };
        assert_eq!(result.support_sha256, alone.support_sha256);
        assert_eq!(result.geometry.distances, alone.geometry.distances);
    }
    #[tokio::test]
    async fn v2_mixed_reasons_keep_request_order() {
        let sources = vec![
            grid(|_| 4.),
            ramp(),
            grid(|_| f32::NAN),
            wave(),
            grid(|i| if i < 5 { i as f32 } else { f32::NAN }),
            grid(|i| (i % 4) as f32),
        ];
        let result = run(with_tau(&sources, 0.9, Distance::PatternShape))
            .await
            .unwrap();
        assert_eq!(result.fitted_member_ids, vec!["S1", "S3", "S5"]);
        assert_eq!(
            reasons(&result),
            vec![
                ("S0".into(), UnassignedReason::ZeroVarianceOnSupport, 27, 0),
                ("S2".into(), UnassignedReason::AllMissing, 0, 27),
                (
                    "S4".into(),
                    UnassignedReason::LowCoverage { fraction: 5. / 27. },
                    5,
                    22
                ),
            ]
        );
        assert_eq!(result.finite_counts, vec![27, 27, 0, 27, 5, 27]);
        assert_eq!(result.geometry.coordinates.len(), 3);
        assert_eq!(result.geometry.merges.len(), 2);
    }
    #[tokio::test]
    async fn v2_refuses_fewer_than_two_eligible_or_common_voxels() {
        let few = vec![ramp(), grid(|_| f32::NAN), grid(|_| f32::NAN)];
        let error = run(with_tau(&few, 0.9, Distance::Effect))
            .await
            .unwrap_err()
            .to_string();
        assert!(error.contains("left 1 fitted observation(s)"), "{error}");
        assert!(error.contains("needs at least 2"), "{error}");
        assert!(error.contains("S1 (no finite values"), "{error}");
        // Overlap on one voxel only: counts 14 and 14, no low coverage.
        let thin = vec![
            grid(|i| if i < 14 { i as f32 } else { f32::NAN }),
            grid(|i| if i >= 13 { i as f32 } else { f32::NAN }),
        ];
        assert!(run(request(&thin)).await.is_err());
        let error = run(with_tau(&thin, 0.9, Distance::Effect))
            .await
            .unwrap_err()
            .to_string();
        assert!(error.contains("share 1 common finite voxel(s)"), "{error}");
        let bad_tau = with_tau(&thin, 1.5, Distance::Effect);
        assert!(run(bad_tau).await.is_err());
    }
    #[tokio::test]
    async fn v2_disjoint_and_constant_refusals_still_refuse() {
        let sources = vec![grid(|_| 1.), grid(|_| 2.)];
        let mut q = with_tau(&sources, 0.9, Distance::Effect);
        q.region = Some(Region {
            world_mm: [1., 1., 1.],
            radius_mm: 1.01,
        });
        assert_eq!(run(q.clone()).await.unwrap().common_voxels, 7);
        q.distance = Distance::PatternShape;
        let error = run(q).await.unwrap_err().to_string();
        assert!(
            error.contains("constant on the shared voxels before exclusion"),
            "{error}"
        );
        let disjoint = vec![
            grid(|i| if i == 0 { 1. } else { f32::NAN }),
            grid(|i| if i == 1 { 1. } else { f32::NAN }),
        ];
        assert!(run(with_tau(&disjoint, 0.9, Distance::Effect))
            .await
            .is_err());
    }
    #[tokio::test]
    async fn v2_explanation_refuses_unassigned_members() {
        let sources = vec![grid(|_| 1.), grid(|_| 3.), grid(|_| f32::NAN)];
        let q = with_tau(&sources, 0.9, Distance::Effect);
        let fit = run(q.clone()).await.unwrap();
        let explain = |a: &str, b: &str| {
            let mut q = q.clone();
            q.explanation = Some(ExplanationRequest {
                field: ExplanationKind::Pair {
                    a: a.into(),
                    b: b.into(),
                },
                crosshair_mm: [1., 1., 1.],
                orientation: Orientation::Axial,
            });
            q
        };
        let shown = run(explain("S0", "S1")).await.unwrap();
        assert_eq!(shown.fit_id, fit.fit_id);
        assert!((shown.explanation.unwrap().total - 4.).abs() < 1e-12);
        let error = run(explain("S0", "S2")).await.unwrap_err().to_string();
        assert!(error.contains("S2 is unassigned"), "{error}");
        let mut reconstruct = q.clone();
        reconstruct.explanation = Some(ExplanationRequest {
            field: ExplanationKind::Reconstruction {
                member: "S2".into(),
                components: 0,
            },
            crosshair_mm: [1., 1., 1.],
            orientation: Orientation::Axial,
        });
        assert!(run(reconstruct).await.is_err());
    }
    /// A fixed v1 request: the literal id pins the v1 identity bytes, computed on
    /// the None path and unchanged from before eligibility existed.
    #[test]
    fn v1_fit_identity_is_pinned() {
        let q: Request = serde_json::from_value(serde_json::json!({
            "members": [
                {"memberId": "S0", "sourcePath": "/data/S0.nii", "expectedSha256": "a".repeat(64)},
                {"memberId": "S1", "sourcePath": "/data/S1.nii", "stackIndex": 2, "expectedSha256": "b".repeat(64)}
            ],
            "mask": null,
            "region": {"worldMm": [1.0, 2.0, 3.0], "radiusMm": 4.5},
            "distance": "pattern-shape"
        }))
        .unwrap();
        let affine = [
            [2., 0., 0., -90.],
            [0., 2., 0., -126.],
            [0., 0., 2., -72.],
            [0., 0., 0., 1.],
        ];
        let support = "c".repeat(64);
        let id = fit_identity(&q, &[91, 109, 91], affine, &support).unwrap();
        assert_eq!(
            id,
            "c35d763f31eb74303563933dd8003cfb6f898ce1a3cf2b686bc3a885d181391c"
        );
        let mut v2 = q.clone();
        v2.eligibility = Some(Eligibility {
            low_coverage_tau: 0.9,
        });
        assert_ne!(
            fit_identity(&v2, &[91, 109, 91], affine, &support).unwrap(),
            id
        );
    }
    #[tokio::test]
    async fn v2_two_members_refuse_when_coverage_rule_leaves_one() {
        // Counts 14 and 27: median 20.5, threshold 18.45, so only S1 remains.
        let sources = vec![grid(|i| if i < 14 { i as f32 } else { f32::NAN }), ramp()];
        assert!(run(request(&sources)).await.is_ok());
        let error = run(with_tau(&sources, 0.9, Distance::Effect))
            .await
            .unwrap_err()
            .to_string();
        assert!(error.contains("left 1 fitted observation(s)"), "{error}");
        assert!(error.contains("needs at least 2"), "{error}");
        assert!(
            error.contains("τ = 0.9 × median finite count 20.5"),
            "{error}"
        );
        assert!(error.contains("S0 (low coverage"), "{error}");
    }
    #[tokio::test]
    async fn v2_even_count_median_is_mean_of_middle_counts() {
        // Counts 20, 24, 27, 27: median 25.5, threshold 22.95. S0 is excluded and
        // S1 kept; an upper-middle median (27, threshold 24.3) would exclude S1.
        let sources = vec![
            grid(|i| if i < 20 { (i % 6) as f32 } else { f32::NAN }),
            grid(|i| if i < 24 { (i % 5) as f32 } else { f32::NAN }),
            ramp(),
            wave(),
        ];
        let result = run(with_tau(&sources, 0.9, Distance::Effect))
            .await
            .unwrap();
        assert_eq!(result.finite_counts, vec![20, 24, 27, 27]);
        assert_eq!(result.fitted_member_ids, vec!["S1", "S2", "S3"]);
        assert_eq!(
            reasons(&result),
            vec![(
                "S0".into(),
                UnassignedReason::LowCoverage {
                    fraction: 20. / 25.5
                },
                20,
                4
            )]
        );
    }
    #[tokio::test]
    async fn v2_tau_one_and_zero_bound_the_rule() {
        let sources = vec![
            ramp(),
            wave(),
            grid(|i| if i < 26 { (i % 3) as f32 } else { f32::NAN }),
            grid(|i| if i < 5 { i as f32 } else { f32::NAN }),
        ];
        // tau = 1: anything below the median (27, 27, 26, 5 -> 26.5) is excluded.
        let strictest = run(with_tau(&sources, 1., Distance::Effect)).await.unwrap();
        assert_eq!(strictest.fitted_member_ids, vec!["S0", "S1"]);
        assert_eq!(strictest.unassigned.len(), 2);
        assert_eq!(strictest.common_voxels, 27);
        // tau = 0: the low-coverage rule never excludes; every member is fitted.
        let none = run(with_tau(&sources, 0., Distance::Effect)).await.unwrap();
        assert!(none.unassigned.is_empty());
        assert_eq!(none.common_voxels, 5);
        let v1 = run(request(&sources)).await.unwrap();
        assert_eq!(none.support_sha256, v1.support_sha256);
        assert_eq!(none.geometry.distances, v1.geometry.distances);
    }
}
