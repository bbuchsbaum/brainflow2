//! Native-grid export of the same observed estimand used by the live lens.
use super::*;
use ndarray::ShapeBuilder;
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::OnceLock,
};

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportRequest {
    #[serde(default)]
    pub include_inputs: bool,
    pub population: PopulationSliceRequest,
    pub destination_directory: String,
    /// Descriptive dataset/feature/metadata context, separate from executable operands.
    pub context: serde_json::Value,
}
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub directory: String,
    pub summary_path: String,
    pub coverage_path: String,
    pub provenance_path: String,
}
struct StagedBundle {
    path: PathBuf,
}
impl Drop for StagedBundle {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}
fn frozen(hash: Option<&str>) -> bool {
    hash.is_some_and(|h| h.len() == 64 && h.bytes().all(|c| c.is_ascii_hexdigit()))
}

pub async fn export(
    request: ExportRequest,
    state: &BridgeState,
    token: SampleCancellation,
) -> BridgeResult<ExportResult> {
    export_checked(request, state, token, None).await
}
pub(super) async fn export_checked(
    request: ExportRequest,
    state: &BridgeState,
    token: SampleCancellation,
    proof: Option<super::replay::ReplayProof>,
) -> BridgeResult<ExportResult> {
    let mut calculation = request.population.clone();
    calculation.focus_only = false;
    calculation.focus_window.clear();
    calculation.groups.clear();
    let mut population = calculation.clone();
    population.focus_only = false;
    population.focus_window.clear();
    // Camera/focus are provenance only; they never restrict the exported volume.
    population.dim_px = [1, 1];
    population.cutouts = None;
    validate(&population)?;
    if population.working_member_ids.is_empty() {
        return Err(input(
            "Select at least one observation before exporting a summary.",
        ));
    }
    if population
        .members
        .iter()
        .any(|m| !frozen(m.expected_sha256.as_deref()))
        || population
            .mask
            .as_ref()
            .is_some_and(|m| !frozen(m.expected_sha256.as_deref()))
    {
        return Err(input(
            "Export requires the exact source and mask digests from a completed population view.",
        ));
    }
    if serde_json::to_vec(&request.context)
        .map_err(|e| input(e.to_string()))?
        .len()
        > 1024 * 1024
    {
        return Err(input("Export context exceeds its 1 MiB metadata budget."));
    }
    static ADMISSION: OnceLock<Arc<tokio::sync::Semaphore>> = OnceLock::new();
    let admission = Arc::clone(ADMISSION.get_or_init(|| Arc::new(tokio::sync::Semaphore::new(1))));
    let permit = tokio::select! {
        _ = token.cancelled() => return Err(crate::population_sampling::cancelled()),
        permit = admission.acquire_owned() => permit.map_err(|_| input("Export admission closed."))?,
    };
    let permit = Arc::new(permit);
    let destination = PathBuf::from(&request.destination_directory);
    let destination = tokio::task::spawn_blocking(move || -> BridgeResult<PathBuf> {
        let path = fs::canonicalize(destination)?;
        if !path.is_dir() {
            return Err(input("Choose an existing export directory."));
        }
        Ok(path)
    })
    .await
    .map_err(|e| input(e.to_string()))??;
    let mut paths = Vec::new();
    for member in &population.members {
        token.check()?;
        paths.push(crate::resolve_member_source_path(&member.source_path, state).await?);
    }
    let mask_path = match &population.mask {
        Some(mask) => Some(crate::resolve_member_source_path(&mask.source_path, state).await?),
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
    let retained_mask_path = mask_path.clone();
    let mask = match (&population.mask, mask_path) {
        (Some(source), Some(path)) => {
            Some(crate::population_mask::prepare_mask(source, path, state, &token).await?)
        }
        _ => None,
    };
    let (dims, affine) = state
        .set_sample_cache
        .with_volume_cancelable(paths[0].clone(), token.clone(), |volume, _| grid(volume))
        .await?;
    let count = dims
        .iter()
        .try_fold(1usize, |n, &d| n.checked_mul(d))
        .ok_or_else(|| input("Export dimensions overflow."))?;
    // Admission covers every method-declared output plus summary/coverage and optional B.
    let channel_names = inference::artifact_names(&population);
    let output_count = 2 + channel_names.len() + if population.reference.is_some() { 2 } else { 0 };
    if count > 128 * 1024 * 1024 / (4 * output_count) || dims.iter().any(|&d| d > i16::MAX as usize)
    {
        return Err(input(
            "Export exceeds the 128 MiB output budget or NIfTI-1 dimensions.",
        ));
    }
    let mut summary = Vec::with_capacity(count);
    let mut coverage = Vec::with_capacity(count);
    let mut inference_values: Vec<Vec<f32>> = channel_names
        .iter()
        .map(|_| Vec::with_capacity(count))
        .collect();
    let mut reference_values = Vec::new();
    let mut reference_coverage = Vec::new();
    if population.reference.is_some() {
        reference_values.reserve(count);
        reference_coverage.reserve(count);
    }
    // Account for rows, voxel indices, pixel slots, moments and returned block arrays.
    let block_size = (32 * 1024 * 1024
        / (4 * population.members.len()
            + if population.inference.is_some() {
                512
            } else {
                256
            }))
    .clamp(1, 65536);
    let mut sources = Vec::new();
    for start in (0..count).step_by(block_size) {
        token.check()?;
        let end = (start + block_size).min(count);
        let voxels: Vec<_> = (start..end)
            .map(|i| {
                [
                    i % dims[0],
                    (i / dims[0]) % dims[1],
                    i / (dims[0] * dims[1]),
                ]
            })
            .collect();
        let pixels = voxels
            .iter()
            .enumerate()
            .map(|(i, &[x, y, z])| {
                if mask.as_ref().is_some_and(|m| !m.includes(x, y, z)) {
                    None
                } else {
                    Some(i)
                }
            })
            .collect();
        let plan = Arc::new(PixelPlan {
            plane: Plane {
                origin_mm: [0.; 3],
                u_mm: [0.; 3],
                v_mm: [0.; 3],
                dim_px: [(end - start) as u32, 1],
            },
            dimensions: dims.clone(),
            affine,
            center_world: [0.; 3],
            voxels,
            pixels,
            cutouts: None,
        });
        let mut rows = Vec::new();
        sources.clear();
        for (member, path) in population.members.iter().zip(&paths) {
            let member = member.clone();
            let source_permit = permit.clone();
            let plan = plan.clone();
            let mask = mask.clone();
            let check = token.clone();
            let (row, source) = state
                .set_sample_cache
                .with_volume_cancelable(path.clone(), token.clone(), move |volume, revision| {
                    let _permit = source_permit;
                    Ok((
                        sample_row(volume, revision, &member, &plan, &check, mask.as_deref())?,
                        SliceSource {
                            member_id: member.member_id.clone(),
                            revision: revision.clone(),
                        },
                    ))
                })
                .await?;
            rows.push(row);
            sources.push(source);
        }
        let cached = CachedPlane {
            key: String::new(),
            context_key: String::new(),
            plan,
            rows,
            sources: sources.clone(),
            mask_revision: mask.as_ref().map(|m| m.revision.clone()),
            guard: guard.clone(),
            bytes: 0,
        };
        let query = population.clone();
        let check = token.clone();
        let worker_permit = permit.clone();
        let result = tokio::task::spawn_blocking(move || {
            let _permit = worker_permit;
            reduce_plane(&cached, &query, false, &check)
        })
        .await
        .map_err(|e| input(e.to_string()))??;
        summary.extend(result.summary);
        if let Some(channels) = result.inference {
            for (out, channel) in inference_values.iter_mut().zip(
                &population
                    .inference
                    .as_ref()
                    .unwrap()
                    .method
                    .descriptor()
                    .channels,
            ) {
                out.extend(
                    channels
                        .selected(&channel.id)
                        .iter()
                        .map(|v| v.unwrap_or(f32::NAN)),
                );
            }
        }

        if let Some(reference) = result.reference {
            reference_values.extend(reference.values);
            for (i, n) in reference.valid_counts.into_iter().enumerate() {
                let index = start + i;
                let included = mask.as_ref().is_none_or(|m| {
                    m.includes(
                        index % dims[0],
                        (index / dims[0]) % dims[1],
                        index / (dims[0] * dims[1]),
                    )
                });
                reference_coverage.push(if included { n as f32 } else { f32::NAN });
            }
        }
        // Outside support is unavailable even for the companion coverage map.
        for (i, n) in result.valid_counts.into_iter().enumerate() {
            let index = start + i;
            let included = mask.as_ref().is_none_or(|m| {
                m.includes(
                    index % dims[0],
                    (index / dims[0]) % dims[1],
                    index / (dims[0] * dims[1]),
                )
            });
            coverage.push(if included { n as f32 } else { f32::NAN });
        }
    }
    guard.clone().validate(token.clone()).await?;
    token.check()?;
    let provenance = serde_json::json!({
        "replay": proof.as_ref().map(|p| serde_json::json!({"recordPath":p.record_path,"recordSha256":p.record_sha256,"verification":"byte-identical summary and coverage"})),
        "schema": inference::schema(&population),
        "methodContract": population.inference.as_ref().map(|s| s.method.descriptor()),
        "brainflowVersion": env!("CARGO_PKG_VERSION"),
        "calculation": calculation,
        "context": request.context,
        "sources": sources,
        "maskRevision": mask.as_ref().map(|m| &m.revision),
        "grid": { "dimensions": dims, "voxelToWorld": (0..4).map(|r| (0..4).map(|c| affine[(r,c)]).collect::<Vec<_>>()).collect::<Vec<_>>(), "spatialUnits": "mm" },
        "semantics": { "operation": if let Some(spec) = &population.inference { spec.method.descriptor().estimand.as_str() } else if population.difference { "mean(A)-mean(B); local finite means; overlap allowed; not a t-test" } else { "population summary" },
        "referenceCoverage": if population.reference.is_some() { "reference-coverage.nii.gz counts locally valid B analysis units; coverage.nii.gz counts A units, never an effective contrast sample size" } else { "none" }, "kind": if population.inference.is_some() { "exploratory inference; no p-values or multiplicity correction" } else { "descriptive" }, "inference": population.inference.as_ref().map(|s| &s.method.descriptor().estimand), "support": "full native grid; finite measurements within common binary mask", "missing": "NaN; measured zero is valid", "coverage": "locally valid analysis units", "withinParticipant": "finite voxelwise mean when declared; equal participant weighting", "sampleSdDof": 1, "sourceRetention": "hash-verified external sources; source images are not embedded" }
    });
    if let Some(proof) = &proof {
        if provenance["grid"] != proof.grid
            || provenance["sources"] != proof.sources
            || provenance["maskRevision"] != proof.mask_revision
        {
            return Err(input("Recalculated grid or source identities differ from the saved record. No new bundle was published."));
        }
    }
    let check = token.clone();
    let destination_copy = destination.clone();
    let expected_artifacts = proof.as_ref().map(|p| p.artifacts.clone());
    let include_inputs = request.include_inputs;
    let staged = tokio::task::spawn_blocking(move || -> BridgeResult<StagedBundle> {
        let _permit = permit;
        check.check()?;
        let path = destination_copy.join(format!(".population-{}.staging", uuid::Uuid::new_v4()));
        fs::create_dir(&path)?;
        let staged = StagedBundle { path };
        let mut header = nifti::NiftiHeader { sform_code: 1, qform_code: 0, xyzt_units: 2, ..Default::default() };
        for axis in 0..3 { header.pixdim[axis+1] = affine.fixed_view::<3,1>(0,axis).norm(); }
        header.srow_x = std::array::from_fn(|c| affine[(0,c)]);
        header.srow_y = std::array::from_fn(|c| affine[(1,c)]);
        header.srow_z = std::array::from_fn(|c| affine[(2,c)]);
        let mut artifacts = serde_json::Map::new();
        let mut outputs = vec![("summary.nii.gz", summary), ("coverage.nii.gz", coverage)];
        for (name, values) in channel_names.into_iter().zip(inference_values) {
            outputs.push((name, values));
        }
        if !reference_values.is_empty() { outputs.push(("reference.nii.gz", reference_values)); outputs.push(("reference-coverage.nii.gz", reference_coverage)); }
        for (name, values) in outputs {
            check.check()?;
            let array = ndarray::Array3::from_shape_vec((dims[0],dims[1],dims[2]).f(), values).map_err(|e| input(e.to_string()))?;
            let path = staged.path.join(name);
            nifti::writer::WriterOptions::new(&path).reference_header(&header).write_nifti(&array).map_err(|e| input(e.to_string()))?;
            let mut file = fs::File::open(&path)?;
            let mut hash = Sha256::new();
            std::io::copy(&mut file, &mut hash)?;
            artifacts.insert(name.into(), serde_json::json!({ "sha256": format!("{:x}", hash.finalize()), "bytes": file.metadata()?.len() }));
        }
        if expected_artifacts.as_ref().is_some_and(|expected| expected != &artifacts) {
            return Err(input("Recalculated maps differ from the saved bundle. No new bundle was published."));
        }
        let mut provenance = provenance;
        provenance["artifacts"] = artifacts.into();
        if include_inputs {
            let mut calculation: PopulationSliceRequest = serde_json::from_value(provenance["calculation"].clone()).map_err(|e|input(e.to_string()))?;
            retention::retain(&mut calculation, &paths, retained_mask_path.as_deref(), &staged.path, &check)?;
            provenance["calculation"] = serde_json::to_value(calculation).map_err(|e|input(e.to_string()))?;
            provenance["semantics"]["sourceRetention"] = "Included content-addressed inputs; hashes checked on every opening".into();
        }
        fs::write(staged.path.join("provenance.json"), serde_json::to_vec_pretty(&provenance).map_err(|e| input(e.to_string()))?)?;
        check.check()?;
        Ok(staged)
    }).await.map_err(|e| input(e.to_string()))??;
    guard.validate(token.clone()).await?;
    if let Some(proof) = proof {
        proof.guard.validate(token.clone()).await?;
    }
    token.check()?;
    tokio::task::spawn_blocking(move || publish(staged, &destination, &token))
        .await
        .map_err(|e| input(e.to_string()))?
}
fn publish(
    staged: StagedBundle,
    destination: &Path,
    token: &SampleCancellation,
) -> BridgeResult<ExportResult> {
    token.check()?;
    let directory = destination.join(format!("population-{}", uuid::Uuid::new_v4()));
    if directory.exists() {
        return Err(input("Export destination already exists."));
    }
    fs::rename(&staged.path, &directory)?;
    Ok(ExportResult {
        summary_path: directory.join("summary.nii.gz").to_string_lossy().into(),
        coverage_path: directory.join("coverage.nii.gz").to_string_lossy().into(),
        provenance_path: directory.join("provenance.json").to_string_lossy().into(),
        directory: directory.to_string_lossy().into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::set_sample_cache::TestSource;
    fn query(sources: &[&TestSource]) -> PopulationSliceRequest {
        PopulationSliceRequest {
            inference: None,
            groups: vec![],
            reference: None,
            difference: false,
            focus_only: false,
            focus_window: vec![],
            context_key: "export-test".into(),
            mask: None,
            members: sources
                .iter()
                .enumerate()
                .map(|(i, s)| SetMemberRef {
                    member_id: format!("s{i}"),
                    source_path: s.path.to_string_lossy().into(),
                    stack_index: None,
                    expected_sha256: None,
                    display_label: None,
                    design_values: vec![],
                })
                .collect(),
            working_member_ids: (0..sources.len()).map(|i| format!("s{i}")).collect(),
            focus_member_id: Some("s0".into()),
            crosshair_mm: [1.; 3],
            orientation: Orientation::Axial,
            dim_px: [3, 3],
            zoom: 1.,
            summary: SummaryKind::Mean,
            aggregation: None,
            cutouts: None,
        }
    }
    async fn freeze(
        query: &mut PopulationSliceRequest,
        state: &BridgeState,
    ) -> PopulationSliceResult {
        let result = state
            .population_slice
            .evaluate(query.clone(), state, SampleCancellation::default())
            .await
            .unwrap();
        for (m, s) in query.members.iter_mut().zip(&result.sources) {
            m.expected_sha256 = Some(s.revision.sha256.clone());
        }
        if let Some(mask) = &mut query.mask {
            mask.expected_sha256 = Some(result.mask_revision.as_ref().unwrap().sha256.clone());
        }
        result
    }
    struct Destination(PathBuf);
    impl Destination {
        fn new() -> Self {
            let p = std::env::temp_dir()
                .join(format!("population-export-test-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&p).unwrap();
            Self(p)
        }
    }
    impl Drop for Destination {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    async fn values(path: &str, state: &BridgeState) -> Vec<f32> {
        state
            .set_sample_cache
            .with_volume_cancelable(
                PathBuf::from(path),
                SampleCancellation::default(),
                |v, _| {
                    let d = crate::get_spatial_dims_from_volume(v);
                    Ok((0..d.iter().product())
                        .map(|i| {
                            crate::read_member_frame_at_voxel(
                                v,
                                i % d[0],
                                (i / d[0]) % d[1],
                                i / (d[0] * d[1]),
                                0,
                            )
                            .unwrap()
                        })
                        .collect())
                },
            )
            .await
            .unwrap()
    }
    #[tokio::test]
    async fn export_matches_live_participant_masked_estimands_and_records_artifact_hashes() {
        let a = TestSource::new(&[3, 3, 3], &[0.; 27]);
        let b = TestSource::new(&[3, 3, 3], &[4.; 27]);
        let mut c_values = vec![10.; 27];
        c_values[13] = f32::NAN;
        let c = TestSource::new(&[3, 3, 3], &c_values);
        let mask = TestSource::new(
            &[3, 3, 3],
            &(0..27)
                .map(|i| if i % 3 == 1 { 1. } else { 0. })
                .collect::<Vec<_>>(),
        );
        let state = BridgeState::default().unwrap();
        let dest = Destination::new();
        let mut q = query(&[&a, &b, &c]);
        q.mask = Some(crate::population_mask::MaskSource {
            source_path: mask.path.to_string_lossy().into(),
            expected_sha256: None,
        });
        q.aggregation = Some(ParticipantAggregation {
            within: WithinParticipant::Mean,
            groups: vec![
                ParticipantGroup {
                    participant_id: "p0".into(),
                    member_ids: vec!["s0".into(), "s1".into()],
                },
                ParticipantGroup {
                    participant_id: "p1".into(),
                    member_ids: vec!["s2".into()],
                },
            ],
        });
        for (kind, expected) in [
            (SummaryKind::Mean, 6.),
            (SummaryKind::SampleSd, 32f32.sqrt()),
            (SummaryKind::MeanAbsolute, 6.),
            (SummaryKind::Cancellation, 0.),
            (SummaryKind::Coverage, 2.),
        ] {
            q.summary = kind;
            let live = freeze(&mut q, &state).await;
            let result = export(
                ExportRequest {
                    include_inputs: false,
                    population: q.clone(),
                    destination_directory: dest.0.to_string_lossy().into(),
                    context: serde_json::json!({"feature":"contrast"}),
                },
                &state,
                SampleCancellation::default(),
            )
            .await
            .unwrap();
            let summary = values(&result.summary_path, &state).await;
            let coverage = values(&result.coverage_path, &state).await;
            assert_eq!(summary.len(), 27);
            for i in 0..27 {
                if i % 3 != 1 {
                    assert!(summary[i].is_nan());
                    assert!(coverage[i].is_nan());
                } else if i != 13 {
                    assert!((summary[i] - expected).abs() < 1e-5);
                    assert_eq!(coverage[i], 2.);
                } else {
                    assert_eq!(coverage[i], 1.);
                    if matches!(q.summary, SummaryKind::SampleSd) {
                        assert!(summary[i].is_nan());
                    }
                }
            }
            for (i, value) in live.summary.iter().enumerate() {
                let x = i % 3;
                let y = i / 3;
                let v: [usize; 3] = std::array::from_fn(|a| {
                    (live.plane.origin_mm[a]
                        + live.plane.u_mm[a] * x as f32
                        + live.plane.v_mm[a] * y as f32)
                        .round() as usize
                });
                if v.iter().all(|&n| n < 3) {
                    let expected = summary[v[0] + 3 * (v[1] + 3 * v[2])];
                    assert!(
                        (value.is_nan() && expected.is_nan()) || (value - expected).abs() < 1e-5
                    );
                }
            }
            let p: serde_json::Value =
                serde_json::from_slice(&fs::read(result.provenance_path).unwrap()).unwrap();
            assert_eq!(
                p["calculation"]["aggregation"]["groups"][0]["memberIds"],
                serde_json::json!(["s0", "s1"])
            );
            assert_eq!(
                p["maskRevision"]["sha256"],
                q.mask
                    .as_ref()
                    .unwrap()
                    .expected_sha256
                    .as_ref()
                    .unwrap()
                    .as_str()
            );
            assert_eq!(
                p["artifacts"]["summary.nii.gz"]["sha256"],
                format!(
                    "{:x}",
                    Sha256::digest(fs::read(&result.summary_path).unwrap())
                )
            );
            let header = nifti::NiftiHeader::from_file(&result.summary_path).unwrap();
            assert_eq!(header.srow_x, [1., 0., 0., 0.]);
            assert_eq!(header.xyzt_units, 2);
        }
        assert_eq!(fs::read_dir(&dest.0).unwrap().count(), 5);
    }
    #[tokio::test]
    async fn export_rejects_changed_sources_unfrozen_queries_and_empty_selections_without_publication(
    ) {
        let source = TestSource::new(&[3, 3, 3], &[1.; 27]);
        let state = BridgeState::default().unwrap();
        let dest = Destination::new();
        let mut q = query(&[&source]);
        let req = |q| ExportRequest {
            include_inputs: false,
            population: q,
            destination_directory: dest.0.to_string_lossy().into(),
            context: serde_json::json!({}),
        };
        assert!(
            export(req(q.clone()), &state, SampleCancellation::default())
                .await
                .is_err()
        );
        freeze(&mut q, &state).await;
        let mut empty = q.clone();
        empty.working_member_ids.clear();
        assert!(export(req(empty), &state, SampleCancellation::default())
            .await
            .is_err());
        let canceled = SampleCancellation::default();
        canceled.cancel();
        assert!(export(req(q.clone()), &state, canceled).await.is_err());
        let changed = TestSource::new(&[3, 3, 3], &[2.; 27]);
        fs::copy(&changed.path, &source.path).unwrap();
        assert!(export(req(q), &state, SampleCancellation::default())
            .await
            .is_err());
        assert_eq!(fs::read_dir(&dest.0).unwrap().count(), 0);
    }
    #[tokio::test]
    async fn export_covers_multiple_blocks_preserves_affine_and_uses_explicit_frame() {
        let dims = [41, 41, 41, 2];
        let count = 41usize.pow(3);
        let mut input_values = vec![-999.; count];
        input_values.extend((0..count).map(|i| (i % 997) as f32));
        let source = TestSource::new(&dims, &input_values);
        let mut bytes = fs::read(&source.path).unwrap();
        let rows = [[-2., 0., 0., 10.], [0., 3., 0., 20.], [0., 0., 4., -30.]];
        for (r, row) in rows.iter().enumerate() {
            for (c, &v) in row.iter().enumerate() {
                let at = 280 + r * 16 + c * 4;
                bytes[at..at + 4].copy_from_slice(&f32::to_le_bytes(v));
            }
        }
        fs::write(&source.path, bytes).unwrap();
        let state = BridgeState::default().unwrap();
        let dest = Destination::new();
        let mut q = query(&[&source]);
        q.members[0].stack_index = Some(1);
        freeze(&mut q, &state).await;
        let result = export(
            ExportRequest {
                include_inputs: false,
                population: q,
                destination_directory: dest.0.to_string_lossy().into(),
                context: serde_json::json!({}),
            },
            &state,
            SampleCancellation::default(),
        )
        .await
        .unwrap();
        let actual = values(&result.summary_path, &state).await;
        assert_eq!(actual.len(), count);
        for (i, &v) in actual.iter().enumerate() {
            assert_eq!(v, (i % 997) as f32, "native voxel {i}");
        }
        let header = nifti::NiftiHeader::from_file(result.summary_path).unwrap();
        assert_eq!(header.dim[0], 3);
        assert_eq!(header.srow_x, rows[0]);
        assert_eq!(header.srow_y, rows[1]);
        assert_eq!(header.srow_z, rows[2]);
        assert_eq!(&header.pixdim[1..4], &[2., 3., 4.]);
    }
    #[tokio::test]
    async fn population_comparison_bundle_replays_both_operands_and_coverage() {
        let a = TestSource::new(&[3, 3, 3], &[3.; 27]);
        let b = TestSource::new(&[3, 3, 3], &[-1.; 27]);
        let state = BridgeState::default().unwrap();
        let original = Destination::new();
        let target = Destination::new();
        let mut q = query(&[&a, &b]);
        q.working_member_ids = vec!["s0".into()];
        q.reference = Some(GroupRequest {
            id: "B".into(),
            member_ids: vec!["s1".into()],
            aggregation: None,
        });
        q.difference = true;
        freeze(&mut q, &state).await;
        let first = export(
            ExportRequest {
                include_inputs: false,
                population: q,
                destination_directory: original.0.to_string_lossy().into(),
                context: serde_json::json!({}),
            },
            &state,
            SampleCancellation::default(),
        )
        .await
        .unwrap();
        let replayed = super::super::replay::replay(
            first.provenance_path.clone(),
            target.0.to_string_lossy().into(),
            &state,
            SampleCancellation::default(),
        )
        .await
        .unwrap();
        let first_dir = Path::new(&first.provenance_path).parent().unwrap();
        let next_dir = Path::new(&replayed.provenance_path).parent().unwrap();
        for (name, expected) in [
            ("summary.nii.gz", 4.),
            ("coverage.nii.gz", 1.),
            ("reference.nii.gz", -1.),
            ("reference-coverage.nii.gz", 1.),
        ] {
            assert_eq!(
                fs::read(first_dir.join(name)).unwrap(),
                fs::read(next_dir.join(name)).unwrap()
            );
            assert_eq!(
                values(next_dir.join(name).to_str().unwrap(), &state).await,
                vec![expected; 27]
            );
        }
        fs::write(first_dir.join("reference.nii.gz"), b"changed").unwrap();
        let refused = Destination::new();
        assert!(super::super::replay::replay(
            first.provenance_path.clone(),
            refused.0.to_string_lossy().into(),
            &state,
            SampleCancellation::default()
        )
        .await
        .is_err());
        assert_eq!(fs::read_dir(&refused.0).unwrap().count(), 0);
    }

    #[tokio::test]
    async fn replay_preserves_participant_masked_maps_and_links_parent_record() {
        let a = TestSource::new(&[3, 3, 3], &[0.; 27]);
        let b = TestSource::new(&[3, 3, 3], &[4.; 27]);
        let mask = TestSource::new(
            &[3, 3, 3],
            &(0..27)
                .map(|i| if i == 0 { 0. } else { 1. })
                .collect::<Vec<_>>(),
        );
        let state = BridgeState::default().unwrap();
        let original = Destination::new();
        let target = Destination::new();
        let mut q = query(&[&a, &a, &b]);
        q.mask = Some(crate::population_mask::MaskSource {
            source_path: mask.path.to_string_lossy().into(),
            expected_sha256: None,
        });
        q.aggregation = Some(ParticipantAggregation {
            within: WithinParticipant::Mean,
            groups: vec![
                ParticipantGroup {
                    participant_id: "p0".into(),
                    member_ids: vec!["s0".into(), "s1".into()],
                },
                ParticipantGroup {
                    participant_id: "p1".into(),
                    member_ids: vec!["s2".into()],
                },
            ],
        });
        freeze(&mut q, &state).await;
        let first = export(
            ExportRequest {
                include_inputs: false,
                population: q,
                destination_directory: original.0.to_string_lossy().into(),
                context: serde_json::json!({"datasetId":"saved"}),
            },
            &state,
            SampleCancellation::default(),
        )
        .await
        .unwrap();
        let record = fs::read(&first.provenance_path).unwrap();
        let replayed = super::super::replay::replay(
            first.provenance_path.clone(),
            target.0.to_string_lossy().into(),
            &state,
            SampleCancellation::default(),
        )
        .await
        .unwrap();
        assert_eq!(
            fs::read(first.summary_path).unwrap(),
            fs::read(&replayed.summary_path).unwrap()
        );
        assert_eq!(
            fs::read(first.coverage_path).unwrap(),
            fs::read(&replayed.coverage_path).unwrap()
        );
        let saved: serde_json::Value =
            serde_json::from_slice(&fs::read(replayed.provenance_path).unwrap()).unwrap();
        assert_eq!(
            saved["replay"]["recordSha256"],
            format!("{:x}", Sha256::digest(record))
        );
        assert_eq!(saved["context"]["datasetId"], "saved");
        assert_eq!(
            saved["calculation"]["aggregation"]["groups"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        let actual = values(&replayed.summary_path, &state).await;
        assert!(actual[0].is_nan());
        assert_eq!(actual[1], 2.);
    }
    #[tokio::test]
    async fn replay_refuses_altered_records_artifacts_and_sources_without_partial_output() {
        let a = TestSource::new(&[3, 3, 3], &[0.; 27]);
        let b = TestSource::new(&[3, 3, 3], &[4.; 27]);
        let state = BridgeState::default().unwrap();
        let original = Destination::new();
        let target = Destination::new();
        let mut q = query(&[&a, &b]);
        freeze(&mut q, &state).await;
        let first = export(
            ExportRequest {
                include_inputs: false,
                population: q,
                destination_directory: original.0.to_string_lossy().into(),
                context: serde_json::json!({}),
            },
            &state,
            SampleCancellation::default(),
        )
        .await
        .unwrap();
        let record = fs::read(&first.provenance_path).unwrap();
        let saved: serde_json::Value = serde_json::from_slice(&record).unwrap();
        let mut changed = saved.clone();
        changed["calculation"]["workingMemberIds"] = serde_json::json!(["s0"]);
        let mut schema = saved.clone();
        schema["schema"] = "brainflow.population-export.v99".into();
        let mut grid = saved.clone();
        grid["grid"]["spatialUnits"] = "meters".into();
        let mut revision = saved.clone();
        revision["sources"][0]["revision"]["sourceBytes"] = 1.into();
        let mut missing = saved.clone();
        missing["sources"] = serde_json::json!([]);
        let mut paths = saved.clone();
        paths["artifacts"]["../../elsewhere"] =
            serde_json::json!({"sha256":"a".repeat(64),"bytes":100});
        for altered in [changed, schema, grid, revision, missing, paths] {
            fs::write(
                &first.provenance_path,
                serde_json::to_vec(&altered).unwrap(),
            )
            .unwrap();
            let result = super::super::replay::replay(
                first.provenance_path.clone(),
                target.0.to_string_lossy().into(),
                &state,
                SampleCancellation::default(),
            )
            .await;
            assert!(result.is_err());
            assert_eq!(fs::read_dir(&target.0).unwrap().count(), 0);
        }
        fs::write(&first.provenance_path, &record).unwrap();
        let artifact = fs::read(&first.summary_path).unwrap();
        fs::write(&first.summary_path, b"changed").unwrap();
        assert!(super::super::replay::replay(
            first.provenance_path.clone(),
            target.0.to_string_lossy().into(),
            &state,
            SampleCancellation::default()
        )
        .await
        .is_err());
        fs::write(&first.summary_path, artifact).unwrap();
        a.write(&[3, 3, 3], &[2.; 27]);
        assert!(super::super::replay::replay(
            first.provenance_path.clone(),
            target.0.to_string_lossy().into(),
            &state,
            SampleCancellation::default()
        )
        .await
        .is_err());
        let canceled = SampleCancellation::default();
        canceled.cancel();
        assert!(super::super::replay::replay(
            first.provenance_path.clone(),
            target.0.to_string_lossy().into(),
            &state,
            canceled
        )
        .await
        .is_err());
        fs::OpenOptions::new()
            .write(true)
            .open(&first.provenance_path)
            .unwrap()
            .set_len(4 * 1024 * 1024 + 1)
            .unwrap();
        assert!(super::super::replay::replay(
            first.provenance_path,
            target.0.to_string_lossy().into(),
            &state,
            SampleCancellation::default()
        )
        .await
        .is_err());
        assert_eq!(fs::read_dir(&target.0).unwrap().count(), 0);
    }
    #[tokio::test]
    async fn open_verifies_bundle_sources_mask_and_frame_without_publishing() {
        let a = TestSource::new(&[3, 3, 3, 2], &[vec![1.; 27], vec![7.; 27]].concat());
        let mask = TestSource::new(&[3, 3, 3], &[1.; 27]);
        let state = BridgeState::default().unwrap();
        let dest = Destination::new();
        let mut q = query(&[&a, &a]);
        q.members[0].stack_index = Some(1);
        q.members[1].stack_index = Some(0);
        q.working_member_ids = vec!["s0".into()];
        q.focus_member_id = Some("s1".into());
        q.mask = Some(crate::population_mask::MaskSource {
            source_path: mask.path.to_string_lossy().into(),
            expected_sha256: None,
        });
        q.aggregation = Some(ParticipantAggregation {
            within: WithinParticipant::Single,
            groups: vec![ParticipantGroup {
                participant_id: "person".into(),
                member_ids: vec!["s0".into()],
            }],
        });
        freeze(&mut q, &state).await;
        let original = serde_json::to_value(&q).unwrap();
        let result = export(
            ExportRequest {
                include_inputs: false,
                population: q,
                destination_directory: dest.0.to_string_lossy().into(),
                context: serde_json::json!({"datasetName":"Saved frames"}),
            },
            &state,
            SampleCancellation::default(),
        )
        .await
        .unwrap();
        let opened = super::super::replay::open(
            result.provenance_path.clone(),
            &state,
            SampleCancellation::default(),
        )
        .await
        .unwrap();
        assert_eq!(serde_json::to_value(&opened.calculation).unwrap(), original);
        assert_eq!(opened.context["datasetName"], "Saved frames");
        assert_eq!(
            opened.record_sha256,
            format!(
                "{:x}",
                Sha256::digest(fs::read(&result.provenance_path).unwrap())
            )
        );
        assert_eq!(fs::read_dir(&dest.0).unwrap().count(), 1);
        assert_eq!(fs::read_dir(&result.directory).unwrap().count(), 3);
        let bytes = fs::read(&result.provenance_path).unwrap();
        let mut invalid: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        invalid["calculation"]["members"][0]["stackIndex"] = 3.into();
        fs::write(
            &result.provenance_path,
            serde_json::to_vec(&invalid).unwrap(),
        )
        .unwrap();
        assert!(super::super::replay::open(
            result.provenance_path.clone(),
            &state,
            SampleCancellation::default()
        )
        .await
        .is_err());
        fs::write(&result.provenance_path, &bytes).unwrap();
        let artifact = fs::read(&result.coverage_path).unwrap();
        fs::write(&result.coverage_path, b"changed").unwrap();
        assert!(super::super::replay::open(
            result.provenance_path.clone(),
            &state,
            SampleCancellation::default()
        )
        .await
        .is_err());
        fs::write(&result.coverage_path, artifact).unwrap();
        mask.write(&[3, 3, 3], &[0.; 27]);
        assert!(super::super::replay::open(
            result.provenance_path.clone(),
            &state,
            SampleCancellation::default()
        )
        .await
        .is_err());
        mask.write(&[3, 3, 3], &[1.; 27]);
        a.write(&[3, 3, 3, 2], &[3.; 54]);
        assert!(super::super::replay::open(
            result.provenance_path.clone(),
            &state,
            SampleCancellation::default()
        )
        .await
        .is_err());
        let cancel = SampleCancellation::default();
        cancel.cancel();
        assert!(
            super::super::replay::open(result.provenance_path, &state, cancel)
                .await
                .is_err()
        );
        assert_eq!(fs::read_dir(&dest.0).unwrap().count(), 1);
    }
    #[tokio::test]
    async fn one_sample_channels_match_live_export_and_replay_with_local_missingness() {
        use field_table::population_inference::{
            Channel, FeatureRole, Method, SelectionOrigin, Specification,
        };
        let mut a = vec![1.; 27];
        let mut b = vec![3.; 27];
        let mut c = vec![5.; 27];
        a[0] = f32::NAN;
        b[0] = f32::NAN;
        c[0] = f32::NAN;
        b[1] = f32::NAN;
        c[1] = f32::NAN;
        a[2] = 2.;
        b[2] = 2.;
        c[2] = 2.;
        let a = TestSource::new(&[3, 3, 3], &a);
        let b = TestSource::new(&[3, 3, 3], &b);
        let c = TestSource::new(&[3, 3, 3], &c);
        let state = BridgeState::default().unwrap();
        let mut q = query(&[&a, &b, &c]);
        q.aggregation = Some(ParticipantAggregation {
            within: WithinParticipant::Single,
            groups: q
                .members
                .iter()
                .map(|m| ParticipantGroup {
                    participant_id: m.member_id.clone(),
                    member_ids: vec![m.member_id.clone()],
                })
                .collect(),
        });
        q.inference = Some(Specification {
            method: Method::OneSample,
            role: FeatureRole::Effect,
            units: "percent signal change".into(),
            null_value: 1.,
            independent_participants: true,
            selection_origin: SelectionOrigin::MapDerived,
            channel: Channel::T,
        });
        let live = freeze(&mut q, &state).await;
        assert!(live
            .summary
            .iter()
            .any(|v| (*v - 3_f32.sqrt()).abs() < 1e-6));
        assert_eq!(
            live.inference
                .as_ref()
                .unwrap()
                .selected(&Channel::T)
                .iter()
                .map(|v| v.unwrap_or(f32::NAN).to_bits())
                .collect::<Vec<_>>(),
            live.summary.iter().map(|v| v.to_bits()).collect::<Vec<_>>()
        );
        let destination = Destination::new();
        let out = export(
            ExportRequest {
                include_inputs: false,
                population: q.clone(),
                destination_directory: destination.0.to_string_lossy().into(),
                context: serde_json::json!({"discovery":"map-derived"}),
            },
            &state,
            SampleCancellation::default(),
        )
        .await
        .unwrap();
        let record: serde_json::Value =
            serde_json::from_slice(&fs::read(&out.provenance_path).unwrap()).unwrap();
        assert_eq!(record["schema"], "brainflow.population-export.v3");
        assert_eq!(record["artifacts"].as_object().unwrap().len(), 7);
        let field = |name: &str| {
            Path::new(&out.directory)
                .join(name)
                .to_string_lossy()
                .into_owned()
        };
        let effect = values(&field("effect.nii.gz"), &state).await;
        let se = values(&field("standard-error.nii.gz"), &state).await;
        let t = values(&field("t.nii.gz"), &state).await;
        let df = values(&field("df.nii.gz"), &state).await;
        let n = values(&field("count.nii.gz"), &state).await;
        assert!(effect[0].is_nan());
        assert_eq!(n[0], 0.);
        assert_eq!(effect[1], 0.);
        assert_eq!(n[1], 1.);
        assert!(df[1].is_nan());
        assert_eq!(se[2], 0.);
        assert!(t[2].is_nan());
        assert_eq!(effect[3], 2.);
        assert!((se[3] - 2. / 3_f32.sqrt()).abs() < 1e-6);
        assert!((t[3] - 3_f32.sqrt()).abs() < 1e-6);
        assert_eq!(df[3], 2.);
        assert_eq!(n[3], 3.);
        super::super::replay::replay(
            out.provenance_path.clone(),
            destination.0.to_string_lossy().into(),
            &state,
            SampleCancellation::default(),
        )
        .await
        .unwrap();
        let opened = super::super::replay::open(
            out.provenance_path.clone(),
            &state,
            SampleCancellation::default(),
        )
        .await
        .unwrap();
        assert_eq!(
            opened.calculation.inference.unwrap().units,
            "percent signal change"
        );
        // A changed sibling is rejected even if summary and coverage were untouched.
        use std::io::Write;
        fs::OpenOptions::new()
            .append(true)
            .open(field("t.nii.gz"))
            .unwrap()
            .write_all(b"changed")
            .unwrap();
        assert!(super::super::replay::open(
            out.provenance_path,
            &state,
            SampleCancellation::default()
        )
        .await
        .is_err());
        let mut invalid = q.clone();
        invalid.aggregation = None;
        assert!(validate(&invalid).is_err());
        invalid = q.clone();
        invalid.inference.as_mut().unwrap().role = FeatureRole::T;
        assert!(validate(&invalid).is_err());
        // Declared repeated rows contribute one participant mean, not two people.
        let ids: Vec<_> = q.members.iter().map(|m| m.member_id.clone()).collect();
        q.aggregation = Some(ParticipantAggregation {
            within: WithinParticipant::Mean,
            groups: vec![
                ParticipantGroup {
                    participant_id: "P1".into(),
                    member_ids: ids[..2].to_vec(),
                },
                ParticipantGroup {
                    participant_id: "P2".into(),
                    member_ids: ids[2..].to_vec(),
                },
            ],
        });
        let reduced = freeze(&mut q, &state).await;
        assert_eq!(reduced.unit_count, 2);
        assert!(reduced.summary.iter().any(|v| (*v - 5. / 3.).abs() < 1e-6));
    }
    #[tokio::test]
    async fn welch_channels_export_replay_and_method_contract_are_verified() {
        use field_table::population_inference::{
            Channel, FeatureRole, Method, SelectionOrigin, Specification,
        };
        let sources: Vec<_> = [1., 3., 5., 2., 6., 10.]
            .iter()
            .enumerate()
            .map(|(i, &v)| {
                let mut x = vec![v; 27];
                if i >= 3 {
                    x[0] = f32::NAN;
                }
                if i >= 4 {
                    x[1] = f32::NAN;
                }
                x[2] = 2.;
                TestSource::new(&[3, 3, 3], &x)
            })
            .collect();
        let state = BridgeState::default().unwrap();
        let mut q = query(&sources.iter().collect::<Vec<_>>());
        let ids: Vec<_> = q.members.iter().map(|m| m.member_id.clone()).collect();
        let aggregation = |ids: &[String]| {
            Some(ParticipantAggregation {
                within: WithinParticipant::Single,
                groups: ids
                    .iter()
                    .map(|id| ParticipantGroup {
                        participant_id: id.clone(),
                        member_ids: vec![id.clone()],
                    })
                    .collect(),
            })
        };
        q.working_member_ids = ids[..3].to_vec();
        q.aggregation = aggregation(&ids[..3]);
        q.reference = Some(GroupRequest {
            id: "B".into(),
            member_ids: ids[3..].to_vec(),
            aggregation: aggregation(&ids[3..]),
        });
        q.inference = Some(Specification {
            method: Method::Welch,
            role: FeatureRole::Effect,
            units: "a.u.".into(),
            null_value: 1.,
            independent_participants: true,
            selection_origin: SelectionOrigin::MapDerived,
            channel: Channel::T,
        });
        let live = freeze(&mut q, &state).await;
        assert!(live
            .summary
            .iter()
            .any(|&v| (v - -4. / (20_f32 / 3.).sqrt()).abs() < 1e-6));
        let dest = Destination::new();
        let out = export(
            ExportRequest {
                include_inputs: false,
                population: q.clone(),
                destination_directory: dest.0.to_string_lossy().into(),
                context: serde_json::json!({}),
            },
            &state,
            SampleCancellation::default(),
        )
        .await
        .unwrap();
        let bytes = fs::read(&out.provenance_path).unwrap();
        let mut record: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(record["schema"], "brainflow.population-export.v4");
        assert_eq!(record["methodContract"]["id"], "welch");
        assert_eq!(record["artifacts"].as_object().unwrap().len(), 10);
        let field = |name: &str| {
            Path::new(&out.directory)
                .join(name)
                .to_string_lossy()
                .into_owned()
        };
        let effect = values(&field("effect.nii.gz"), &state).await;
        let t = values(&field("t.nii.gz"), &state).await;
        let df = values(&field("df.nii.gz"), &state).await;
        let a = values(&field("count-a.nii.gz"), &state).await;
        let b = values(&field("count-b.nii.gz"), &state).await;
        assert!(effect[0].is_nan());
        assert_eq!(a[0], 3.);
        assert_eq!(b[0], 0.);
        assert_eq!(b[1], 1.);
        assert!(t[1].is_nan());
        assert!(df[1].is_nan());
        assert_eq!(effect[2], -1.);
        assert!(t[2].is_nan());
        assert!(df[2].is_nan());
        assert_eq!(effect[3], -4.);
        assert!((df[3] - 50. / 17.).abs() < 1e-6);
        super::super::replay::replay(
            out.provenance_path.clone(),
            dest.0.to_string_lossy().into(),
            &state,
            SampleCancellation::default(),
        )
        .await
        .unwrap();
        let opened = super::super::replay::open(
            out.provenance_path.clone(),
            &state,
            SampleCancellation::default(),
        )
        .await
        .unwrap();
        assert_eq!(opened.calculation.inference.unwrap().method, Method::Welch);
        record["methodContract"]["version"] = 2.into();
        fs::write(&out.provenance_path, serde_json::to_vec(&record).unwrap()).unwrap();
        assert!(super::super::replay::open(
            out.provenance_path.clone(),
            &state,
            SampleCancellation::default()
        )
        .await
        .is_err());
        fs::write(&out.provenance_path, &bytes).unwrap();
        // Only a companion is altered: opening must still fail.
        use std::io::Write;
        fs::OpenOptions::new()
            .append(true)
            .open(field("count-b.nii.gz"))
            .unwrap()
            .write_all(b"changed")
            .unwrap();
        assert!(super::super::replay::open(
            out.provenance_path,
            &state,
            SampleCancellation::default()
        )
        .await
        .is_err());
        let mut bad = q.clone();
        bad.reference
            .as_mut()
            .unwrap()
            .aggregation
            .as_mut()
            .unwrap()
            .groups[0]
            .participant_id = ids[0].clone();
        assert!(validate(&bad).is_err()); // Different rows, same person.
        bad = q.clone();
        bad.reference.as_mut().unwrap().aggregation = None;
        assert!(validate(&bad).is_err());
        bad = q.clone();
        bad.inference.as_mut().unwrap().channel = Channel::Count;
        assert!(validate(&bad).is_err());
    }
    #[tokio::test]
    async fn paired_local_counts_export_and_replay_preserve_matching() {
        use field_table::population_inference::{
            Channel, FeatureRole, Method, SelectionOrigin, Specification,
        };
        let sources: Vec<_> = [101., 202., 304., 100., 200., 300.]
            .iter()
            .enumerate()
            .map(|(i, &v)| {
                let mut x = vec![v; 27];
                if i == 4 {
                    x[0] = f32::NAN;
                }
                if i >= 3 {
                    x[1] = f32::NAN;
                }
                TestSource::new(&[3, 3, 3], &x)
            })
            .collect();
        let state = BridgeState::default().unwrap();
        let mut q = query(&sources.iter().collect::<Vec<_>>());
        let ids: Vec<_> = q.members.iter().map(|m| m.member_id.clone()).collect();
        let aggregation = |ids: &[String]| {
            Some(ParticipantAggregation {
                within: WithinParticipant::Single,
                groups: ids
                    .iter()
                    .enumerate()
                    .map(|(i, id)| ParticipantGroup {
                        participant_id: format!("P{i}"),
                        member_ids: vec![id.clone()],
                    })
                    .collect(),
            })
        };
        q.working_member_ids = ids[..3].to_vec();
        q.aggregation = aggregation(&ids[..3]);
        let mut b = aggregation(&ids[3..]);
        b.as_mut().unwrap().groups.reverse(); // Identity, never positional pairing.
        q.reference = Some(GroupRequest {
            id: "B".into(),
            member_ids: ids[3..].to_vec(),
            aggregation: b,
        });
        q.inference = Some(Specification {
            method: Method::Paired,
            role: FeatureRole::Effect,
            units: "a.u.".into(),
            null_value: 1.,
            independent_participants: true,
            selection_origin: SelectionOrigin::Metadata,
            channel: Channel::T,
        });
        let live = freeze(&mut q, &state).await;
        assert!(live
            .summary
            .iter()
            .any(|&v| (v - 4. / 7_f32.sqrt()).abs() < 1e-6));
        let dest = Destination::new();
        let out = export(
            ExportRequest {
                include_inputs: false,
                population: q.clone(),
                destination_directory: dest.0.to_string_lossy().into(),
                context: serde_json::json!({}),
            },
            &state,
            SampleCancellation::default(),
        )
        .await
        .unwrap();
        let counts = values(
            &Path::new(&out.directory)
                .join("count.nii.gz")
                .to_string_lossy(),
            &state,
        )
        .await;
        let effects = values(
            &Path::new(&out.directory)
                .join("effect.nii.gz")
                .to_string_lossy(),
            &state,
        )
        .await;
        assert_eq!(counts[0], 2.);
        assert_eq!(counts[1], 0.);
        assert_eq!(effects[0], 1.5);
        assert!(effects[1].is_nan());
        super::super::replay::replay(
            out.provenance_path.clone(),
            dest.0.to_string_lossy().into(),
            &state,
            SampleCancellation::default(),
        )
        .await
        .unwrap();
        let opened =
            super::super::replay::open(out.provenance_path, &state, SampleCancellation::default())
                .await
                .unwrap();
        assert_eq!(opened.calculation.inference.unwrap().method, Method::Paired);
        let mut bad = q.clone();
        bad.reference
            .as_mut()
            .unwrap()
            .aggregation
            .as_mut()
            .unwrap()
            .groups[0]
            .participant_id = "unmatched".into();
        assert!(validate(&bad).is_err());
        bad = q.clone();
        bad.reference.as_mut().unwrap().member_ids = q.working_member_ids.clone();
        bad.reference.as_mut().unwrap().aggregation = q.aggregation.clone();
        assert!(validate(&bad).is_err());
    }

    #[tokio::test]
    async fn retained_inputs_reopen_after_move_without_originals_and_reject_tampering() {
        let source = TestSource::new(&[3, 3, 3], &[7.; 27]);
        let state = BridgeState::default().unwrap();
        let mut q = query(&[&source, &source]);
        freeze(&mut q, &state).await;
        let dest = Destination::new();
        let out = export(
            ExportRequest {
                include_inputs: true,
                population: q,
                destination_directory: dest.0.to_string_lossy().into(),
                context: serde_json::json!({}),
            },
            &state,
            SampleCancellation::default(),
        )
        .await
        .unwrap();
        assert_eq!(
            fs::read_dir(Path::new(&out.directory).join("inputs"))
                .unwrap()
                .count(),
            1
        );
        let moved = dest.0.join("moved");
        fs::rename(&out.directory, &moved).unwrap();
        fs::remove_file(&source.path).unwrap();
        let record = moved.join("provenance.json").to_string_lossy().into_owned();
        let opened =
            super::super::replay::open(record.clone(), &state, SampleCancellation::default())
                .await
                .unwrap();
        assert!(opened.calculation.members[0].source_path.starts_with(
            &fs::canonicalize(&moved)
                .unwrap()
                .to_string_lossy()
                .to_string()
        ));
        super::super::replay::replay(
            record.clone(),
            dest.0.to_string_lossy().into(),
            &state,
            SampleCancellation::default(),
        )
        .await
        .unwrap();
        fs::write(&opened.calculation.members[0].source_path, b"changed").unwrap();
        assert!(
            super::super::replay::open(record, &state, SampleCancellation::default())
                .await
                .is_err()
        );
    }
}
