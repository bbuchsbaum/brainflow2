//! Replay exported descriptive calculations with explicit integrity/equivalence gates.
use super::{
    export::{export_checked, ExportRequest, ExportResult},
    *,
};
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::Read,
    path::{Path, PathBuf},
};

const MAX_RECORD_BYTES: u64 = 4 * 1024 * 1024;
const MAX_ARTIFACT_BYTES: u64 = 256 * 1024 * 1024;
#[derive(serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
struct Artifact {
    sha256: String,
    bytes: u64,
}
#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Source {
    member_id: String,
    revision: Revision,
}
#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Revision {
    sha256: String,
    source_bytes: u64,
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Record {
    schema: String,
    calculation: PopulationSliceRequest,
    context: serde_json::Value,
    sources: Vec<Source>,
    mask_revision: Option<Revision>,
    artifacts: HashMap<String, Artifact>,
    grid: serde_json::Value,
}
pub(super) struct ReplayProof {
    pub artifacts: serde_json::Map<String, serde_json::Value>,
    pub grid: serde_json::Value,
    pub sources: serde_json::Value,
    pub mask_revision: serde_json::Value,
    pub record_path: String,
    pub record_sha256: String,
    pub guard: QuerySourceGuard,
}
fn valid_digest(hash: &str) -> bool {
    hash.len() == 64 && hash.bytes().all(|c| c.is_ascii_hexdigit())
}
fn hash_file(path: &Path, limit: u64, token: &SampleCancellation) -> BridgeResult<(String, u64)> {
    let mut file = File::open(path).map_err(|e| {
        input(format!(
            "Cannot read saved bundle file {}: {e}",
            path.display()
        ))
    })?;
    if !file.metadata()?.is_file() || file.metadata()?.len() > limit {
        return Err(input(
            "Saved bundle file exceeds its size limit or is not a regular file.",
        ));
    }
    let mut hash = Sha256::new();
    let mut bytes = 0;
    let mut buffer = [0u8; 65536];
    loop {
        token.check()?;
        let n = file.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        bytes += n as u64;
        if bytes > limit {
            return Err(input("Saved bundle file exceeds its size limit."));
        }
        hash.update(&buffer[..n]);
    }
    Ok((format!("{:x}", hash.finalize()), bytes))
}
fn read_record(path: &Path, token: &SampleCancellation) -> BridgeResult<(Record, String)> {
    token.check()?;
    let file = File::open(path)?;
    if !file.metadata()?.is_file() || file.metadata()?.len() > MAX_RECORD_BYTES {
        return Err(input(
            "Population calculation records must be regular JSON files no larger than 4 MiB.",
        ));
    }
    let mut bytes = Vec::new();
    file.take(MAX_RECORD_BYTES + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_RECORD_BYTES {
        return Err(input("Population calculation record exceeds 4 MiB."));
    }
    token.check()?;
    let record: Record = serde_json::from_slice(&bytes)
        .map_err(|e| input(format!("Invalid population calculation record: {e}")))?;
    if record.schema != "brainflow.population-export.v1" {
        return Err(input("Unsupported population calculation schema."));
    }
    // The descriptive context is never interpreted as executable selection/weighting.
    let mut query = record.calculation.clone();
    query.dim_px = [1, 1];
    query.cutouts = None;
    validate(&query)?;
    if record.sources.len() != query.members.len() {
        return Err(input(
            "Saved source revisions do not cover the recorded observations.",
        ));
    }
    let mut seen = HashSet::new();
    for source in &record.sources {
        let member = query
            .members
            .iter()
            .find(|m| m.member_id == source.member_id)
            .ok_or_else(|| input("Unknown observation in saved source revisions."))?;
        if !seen.insert(&source.member_id)
            || !valid_digest(&source.revision.sha256)
            || source.revision.source_bytes == 0
            || member.expected_sha256.as_deref() != Some(&source.revision.sha256)
        {
            return Err(input(
                "Saved observation identities and frozen source revisions disagree.",
            ));
        }
    }
    match (&query.mask, &record.mask_revision) {
        (None, None) => {}
        (Some(mask), Some(revision))
            if valid_digest(&revision.sha256)
                && revision.source_bytes > 0
                && mask.expected_sha256.as_deref() == Some(&revision.sha256) => {}
        _ => return Err(input("Saved mask definition and revision disagree.")),
    }
    if record.artifacts.len() != 2
        || ["summary.nii.gz", "coverage.nii.gz"].iter().any(|name| {
            record.artifacts.get(*name).is_none_or(|a| {
                !valid_digest(&a.sha256) || a.bytes == 0 || a.bytes > MAX_ARTIFACT_BYTES
            })
        })
    {
        return Err(input(
            "Saved bundle requires summary and coverage artifact digests and sizes.",
        ));
    }
    Ok((record, format!("{:x}", Sha256::digest(bytes))))
}

async fn verified_bundle(
    provenance_path: String,
    token: SampleCancellation,
) -> BridgeResult<(Record, ReplayProof, Arc<tokio::sync::OwnedSemaphorePermit>)> {
    static ADMISSION: std::sync::OnceLock<Arc<tokio::sync::Semaphore>> = std::sync::OnceLock::new();
    let admission = Arc::clone(ADMISSION.get_or_init(|| Arc::new(tokio::sync::Semaphore::new(1))));
    let permit = tokio::select! {
        _ = token.cancelled() => return Err(crate::population_sampling::cancelled()),
        permit = admission.acquire_owned() => permit.map_err(|_| input("Saved calculation admission is closed."))?,
    };
    let _permit = Arc::new(permit);
    let worker_permit = _permit.clone();
    let path = PathBuf::from(&provenance_path);
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or_else(|| input("Choose the exported provenance.json inside its bundle directory."))?;
    // Fixed filenames only: record-provided artifact keys never become arbitrary paths.
    let bundle_paths = vec![
        path.clone(),
        parent.join("summary.nii.gz"),
        parent.join("coverage.nii.gz"),
    ];
    let guard = QuerySourceGuard::capture(bundle_paths, token.clone()).await?;
    let check = token.clone();
    let (record, record_sha256, artifacts) =
        tokio::task::spawn_blocking(move || -> BridgeResult<_> {
            let _permit = worker_permit;
            let (record, hash) = read_record(&path, &check)?;
            let parent = path.parent().unwrap();
            let mut artifacts = serde_json::Map::new();
            for name in ["summary.nii.gz", "coverage.nii.gz"] {
                let expected = &record.artifacts[name];
                let (digest, bytes) = hash_file(&parent.join(name), MAX_ARTIFACT_BYTES, &check)?;
                if digest != expected.sha256 || bytes != expected.bytes {
                    return Err(input(format!(
                        "Saved {name} no longer matches its calculation record."
                    )));
                }
                artifacts.insert(
                    name.into(),
                    serde_json::to_value(expected).map_err(|e| input(e.to_string()))?,
                );
            }
            Ok((record, hash, artifacts))
        })
        .await
        .map_err(|e| input(e.to_string()))??;
    guard.clone().validate(token.clone()).await?;
    let sources = serde_json::to_value(&record.sources).map_err(|e| input(e.to_string()))?;
    let mask_revision =
        serde_json::to_value(&record.mask_revision).map_err(|e| input(e.to_string()))?;
    let proof = ReplayProof {
        artifacts,
        grid: record.grid.clone(),
        sources,
        mask_revision,
        record_path: provenance_path,
        record_sha256,
        guard,
    };
    Ok((record, proof, _permit))
}

pub async fn replay(
    provenance_path: String,
    destination_directory: String,
    state: &BridgeState,
    token: SampleCancellation,
) -> BridgeResult<ExportResult> {
    let (record, proof, _permit) = verified_bundle(provenance_path, token.clone()).await?;
    export_checked(
        ExportRequest {
            population: record.calculation,
            destination_directory,
            context: record.context,
        },
        state,
        token,
        Some(proof),
    )
    .await
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedCalculation {
    pub record_path: String,
    pub record_sha256: String,
    pub calculation: PopulationSliceRequest,
    pub context: serde_json::Value,
}

/// Validate original inputs and bundle integrity without creating output files.
/// This is source verification, not a claim of full artifact recalculation.
pub async fn open(
    provenance_path: String,
    state: &BridgeState,
    token: SampleCancellation,
) -> BridgeResult<OpenedCalculation> {
    let (record, proof, _permit) = verified_bundle(provenance_path, token.clone()).await?;
    let mut query = record.calculation.clone();
    query.dim_px = [1, 1];
    query.cutouts = None;
    // Own a short-lived plane instead of displacing the live lens cache. Sampling
    // checks every source hash, frame and physical grid even outside the mask.
    let plane = build_plane(String::new(), &query, state, &token).await?;
    let affine = plane.plan.affine;
    let grid = serde_json::json!({
        "dimensions": plane.plan.dimensions,
        "voxelToWorld": (0..4).map(|r| (0..4).map(|c| affine[(r,c)]).collect::<Vec<_>>()).collect::<Vec<_>>(),
        "spatialUnits": "mm"
    });
    if grid != proof.grid
        || serde_json::to_value(&plane.sources).map_err(|e| input(e.to_string()))? != proof.sources
        || serde_json::to_value(&plane.mask_revision).map_err(|e| input(e.to_string()))?
            != proof.mask_revision
    {
        return Err(input(
            "Saved grid or source identities differ from the verified inputs.",
        ));
    }
    plane.guard.validate(token.clone()).await?;
    proof.guard.validate(token.clone()).await?;
    token.check()?;
    Ok(OpenedCalculation {
        record_path: proof.record_path,
        record_sha256: proof.record_sha256,
        calculation: record.calculation,
        context: record.context,
    })
}
