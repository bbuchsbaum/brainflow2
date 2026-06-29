use bridge_types::{
    StudioCompareBindingKind, StudioCompareCacheStatus, StudioCompareMaterializeRequest,
    StudioComparePaneBinding, StudioComparePaneSpec, StudioComparePaneStatus,
    StudioFieldBindingAvailability, StudioReducerKind, StudioReducerSpec, StudioSupportKind,
};
use ndarray::ShapeBuilder;
use nifti::writer::WriterOptions;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct StudioCacheInputStamp {
    role: String,
    path: String,
    exists: bool,
    modified_at_ms: Option<u64>,
    size_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct StudioCacheManifest {
    version: u8,
    materialization_key: String,
    artifact_kind: String,
    recipe: Option<String>,
    support_label: String,
    output_path: String,
    created_at_ms: u64,
    input_stamps: Vec<StudioCacheInputStamp>,
    provenance: Value,
}

#[derive(Debug, Clone)]
struct StudioCompareMaterializationRecord {
    output_path: String,
    cache_status: StudioCompareCacheStatus,
    cache_message: String,
    provenance_path: Option<String>,
}

#[derive(Debug, Clone)]
struct CachePlan {
    reuse_record: Option<StudioCompareMaterializationRecord>,
    output_path: PathBuf,
    manifest_path: PathBuf,
    manifest: StudioCacheManifest,
    cache_status: StudioCompareCacheStatus,
    cache_message: String,
}

#[derive(Debug, Clone)]
struct RoleInput {
    member_id: String,
    path: String,
}

pub fn materialize_compare_panes(
    request: StudioCompareMaterializeRequest,
) -> Vec<StudioComparePaneSpec> {
    let has_member_path = request
        .active_member_source_path
        .as_ref()
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);
    let cohort_selected = request.compare_cohort_id.is_some();
    let cohort_mean_key = request.compare_cohort_id.as_ref().map(|cohort_id| {
        build_materialization_key("cohort-mean", &[&request.support_label, cohort_id])
    });
    let cohort_mean_materialization = if cohort_selected && request.compare_ready {
        materialize_cohort_mean(&request, cohort_mean_key.as_deref())
    } else {
        Err(if !cohort_selected {
            "No cohort selected.".to_string()
        } else {
            "Set ingest audit does not yet permit compare-safe reductions.".to_string()
        })
    };
    let cohort_mean_live_path = cohort_mean_materialization
        .as_ref()
        .ok()
        .map(|record| record.output_path.clone());
    let cohort_mean_ready = cohort_mean_live_path.is_some();
    let cohort_mean_reason = match &cohort_mean_materialization {
        Ok(record) => format_materialization_reason("Derived cohort mean", record),
        Err(message) => {
            if !cohort_selected {
                "No cohort selected.".to_string()
            } else if request.compare_ready {
                format!("Cohort mean materialization failed: {}", message)
            } else {
                "Set ingest audit does not yet permit compare-safe reductions.".to_string()
            }
        }
    };
    let residual_key = match (&request.active_member_id, &request.compare_cohort_id) {
        (Some(member_id), Some(cohort_id)) => Some(build_materialization_key(
            "residual",
            &[&request.support_label, member_id, cohort_id],
        )),
        _ => None,
    };
    let residual_materialization = if cohort_mean_ready && has_member_path {
        materialize_residual(
            &request,
            residual_key.as_deref(),
            cohort_mean_live_path.as_deref(),
        )
    } else {
        Err(if !has_member_path {
            "Needs a bound current member.".to_string()
        } else if !cohort_mean_ready {
            "Needs a materialized cohort mean before residuals can be computed.".to_string()
        } else {
            "Residual materialization is not ready.".to_string()
        })
    };
    let residual_live_path = residual_materialization
        .as_ref()
        .ok()
        .map(|record| record.output_path.clone());
    let residual_ready = residual_live_path.is_some();
    let residual_reason = match &residual_materialization {
        Ok(record) => format_materialization_reason("Derived residual", record),
        Err(message) => {
            if cohort_selected && request.compare_ready && has_member_path {
                format!("Residual materialization failed: {}", message)
            } else {
                "Needs a bound current member and compare-safe cohort.".to_string()
            }
        }
    };
    let zscore_key = match (
        &request.active_member_id,
        &request.compare_cohort_id,
        &request.active_expression_recipe,
    ) {
        (Some(member_id), Some(cohort_id), Some(recipe)) => Some(build_materialization_key(
            "zscore",
            &[&request.support_label, member_id, cohort_id, recipe],
        )),
        _ => None,
    };
    let zscore_materialization = if cohort_mean_ready && has_member_path {
        materialize_zscore(
            &request,
            zscore_key.as_deref(),
            cohort_mean_live_path.as_deref(),
        )
    } else {
        Err(if !has_member_path {
            "Needs a bound current member.".to_string()
        } else if !cohort_mean_ready {
            "Needs a materialized cohort mean before z-scores can be computed.".to_string()
        } else {
            "Z-score materialization is not ready.".to_string()
        })
    };
    let zscore_live_path = zscore_materialization
        .as_ref()
        .ok()
        .map(|record| record.output_path.clone());
    let zscore_ready = zscore_live_path.is_some();
    let zscore_reason = match &zscore_materialization {
        Ok(record) => format_materialization_reason("Derived z-score", record),
        Err(message) => {
            if cohort_selected
                && request.compare_ready
                && request.active_expression_recipe.is_some()
            {
                format!("Z-score materialization failed: {}", message)
            } else {
                "Needs an active comparison expression and compare-safe cohort.".to_string()
            }
        }
    };

    let mut panes = vec![
        StudioComparePaneSpec {
            id: "current".to_string(),
            title: request
                .active_member_id
                .clone()
                .unwrap_or_else(|| "Current member".to_string()),
            subtitle: request.support_label.clone(),
            status: if has_member_path {
                StudioComparePaneStatus::Live
            } else {
                StudioComparePaneStatus::Blocked
            },
            reason: if has_member_path {
                "Bound to a concrete member source path.".to_string()
            } else {
                "This member has no source path binding yet.".to_string()
            },
            recipe: request
                .active_member_id
                .as_ref()
                .map(|member_id| format!("member({})", member_id)),
            binding: Some(StudioComparePaneBinding {
                kind: StudioCompareBindingKind::MemberSource,
                ready: has_member_path,
                source_path: request.active_member_source_path.clone(),
                materialization_key: None,
                materialized_at_ms: request
                    .active_member_source_path
                    .as_deref()
                    .and_then(file_modified_ms),
                cache_status: if has_member_path {
                    StudioCompareCacheStatus::Source
                } else {
                    StudioCompareCacheStatus::Unavailable
                },
                cache_message: Some(if has_member_path {
                    "Bound directly to the active member source path.".to_string()
                } else {
                    "No member source path is available.".to_string()
                }),
                provenance_path: None,
            }),
        },
        StudioComparePaneSpec {
            id: "cohort-mean".to_string(),
            title: request
                .compare_cohort_label
                .clone()
                .unwrap_or_else(|| "Cohort mean".to_string()),
            subtitle: request
                .compare_cohort_member_count
                .map(|count| format!("{} members", count))
                .unwrap_or_else(|| "Select a cohort to enable derived panes".to_string()),
            status: if cohort_mean_ready {
                StudioComparePaneStatus::Live
            } else {
                StudioComparePaneStatus::Blocked
            },
            reason: cohort_mean_reason,
            recipe: request
                .compare_cohort_id
                .as_ref()
                .map(|cohort_id| format!("mean(cohort:{})", cohort_id)),
            binding: Some(derived_binding(
                &cohort_mean_materialization,
                cohort_mean_key,
                cohort_selected && request.compare_ready,
            )),
        },
        StudioComparePaneSpec {
            id: "residual".to_string(),
            title: "Residual".to_string(),
            subtitle: match (&request.active_member_id, &request.compare_cohort_id) {
                (Some(member_id), Some(_)) => format!("{} - cohort mean", member_id),
                _ => "Current minus cohort mean".to_string(),
            },
            status: if residual_ready {
                StudioComparePaneStatus::Live
            } else {
                StudioComparePaneStatus::Blocked
            },
            reason: residual_reason,
            recipe: match (&request.active_member_id, &request.compare_cohort_id) {
                (Some(member_id), Some(cohort_id)) => Some(format!(
                    "residual(member:{}, cohort:{})",
                    member_id, cohort_id
                )),
                _ => None,
            },
            binding: Some(derived_binding(
                &residual_materialization,
                residual_key,
                cohort_selected && request.compare_ready && has_member_path,
            )),
        },
        StudioComparePaneSpec {
            id: "zscore".to_string(),
            title: "Z-score".to_string(),
            subtitle: request
                .active_expression_label
                .clone()
                .unwrap_or_else(|| "Cohort-relative comparison".to_string()),
            status: if zscore_ready {
                StudioComparePaneStatus::Live
            } else {
                StudioComparePaneStatus::Blocked
            },
            reason: zscore_reason,
            recipe: request.active_expression_recipe.clone(),
            binding: Some(derived_binding(
                &zscore_materialization,
                zscore_key,
                cohort_selected
                    && request.compare_ready
                    && request.active_expression_recipe.is_some(),
            )),
        },
    ];
    panes.extend(materialize_reducer_panes(&request));
    panes
}

fn materialize_reducer_panes(
    request: &StudioCompareMaterializeRequest,
) -> Vec<StudioComparePaneSpec> {
    let specs = request.reducer_specs.as_deref().unwrap_or(&[]);
    specs
        .iter()
        .map(|spec| {
            let materialization_key = Some(reducer_materialization_key(request, spec));
            let materialization = if request.compare_ready {
                materialize_reducer(request, spec, materialization_key.as_deref())
            } else {
                Err("Set ingest audit does not yet permit compare-safe reductions.".to_string())
            };
            let status = if materialization.is_ok() {
                StudioComparePaneStatus::Live
            } else {
                StudioComparePaneStatus::Blocked
            };
            let reason = match &materialization {
                Ok(record) => format_materialization_reason(&spec.label, record),
                Err(message) => message.clone(),
            };
            StudioComparePaneSpec {
                id: spec.id.clone(),
                title: spec.label.clone(),
                subtitle: reducer_subtitle(spec),
                status,
                reason,
                recipe: Some(reducer_recipe(spec)),
                binding: Some(derived_binding(
                    &materialization,
                    materialization_key,
                    request.compare_ready,
                )),
            }
        })
        .collect()
}

fn materialize_reducer(
    request: &StudioCompareMaterializeRequest,
    spec: &StudioReducerSpec,
    materialization_key: Option<&str>,
) -> Result<StudioCompareMaterializationRecord, String> {
    let role_inputs = resolve_role_inputs(request, spec)?;
    let materialization_key = materialization_key
        .ok_or_else(|| "No materialization key was computed for the reducer.".to_string())?;
    let (output_path, _) = cache_paths(materialization_key)?;
    let input_stamps = role_inputs
        .iter()
        .map(|input| make_input_stamp(&format!("role:{}", spec.role), &input.path))
        .collect();
    let expected_manifest = build_cache_manifest(
        materialization_key,
        reducer_artifact_kind(&spec.kind),
        Some(reducer_recipe(spec)),
        &request.support_label,
        &output_path,
        input_stamps,
        build_reducer_provenance(request, spec, &role_inputs),
    );
    let cache_plan = resolve_cache_plan(expected_manifest, request.force_rematerialize)?;
    if let Some(record) = cache_plan.reuse_record {
        return Ok(record);
    }

    let (volumes, dims, reference_source_path) = load_role_input_values(&role_inputs)?;
    let data = match spec.kind {
        StudioReducerKind::Mean | StudioReducerKind::LeaveOneOutMean => mean_values(&volumes)?,
        StudioReducerKind::Sd => sd_values(&volumes)?,
    };

    write_f32_nifti(
        &cache_plan.output_path,
        &dims,
        &reference_source_path,
        &data,
    )
    .map_err(|error| format!("Failed to write reducer NIfTI: {}", error))?;
    write_cache_manifest(&cache_plan.manifest_path, &cache_plan.manifest)?;

    Ok(StudioCompareMaterializationRecord {
        output_path: cache_plan.output_path.to_string_lossy().into_owned(),
        cache_status: cache_plan.cache_status,
        cache_message: cache_plan.cache_message,
        provenance_path: Some(cache_plan.manifest_path.to_string_lossy().into_owned()),
    })
}

fn resolve_role_inputs(
    request: &StudioCompareMaterializeRequest,
    spec: &StudioReducerSpec,
) -> Result<Vec<RoleInput>, String> {
    let bindings = request
        .cohort_member_role_bindings
        .as_deref()
        .unwrap_or_default();
    if bindings.is_empty() {
        return resolve_legacy_role_inputs(request, spec);
    }

    let excluded_member_id = match spec.kind {
        StudioReducerKind::LeaveOneOutMean => spec.excluded_member_id.as_deref(),
        _ => None,
    };
    let mut expected_members = bindings
        .iter()
        .map(|binding| binding.member_id.clone())
        .collect::<BTreeSet<_>>();
    if expected_members.is_empty() {
        return Err(format!(
            "No cohort members were available for role {}.",
            spec.role
        ));
    }

    let mut missing = Vec::new();
    let mut support_issues = Vec::new();
    let mut inputs = Vec::new();
    for member_id in expected_members.iter() {
        if Some(member_id.as_str()) == excluded_member_id {
            continue;
        }
        let Some(binding) = bindings
            .iter()
            .find(|binding| binding.member_id == *member_id && binding.role == spec.role)
        else {
            missing.push(member_id.clone());
            continue;
        };
        if binding.availability != StudioFieldBindingAvailability::Available {
            missing.push(member_id.clone());
            continue;
        }
        if binding.support_kind != StudioSupportKind::Volume {
            support_issues.push(format!(
                "{}:{} is {:?}, expected volume",
                member_id, spec.role, binding.support_kind
            ));
            continue;
        }
        if let Some(support_label) = binding.support_label.as_deref() {
            if !support_label.trim().is_empty() && support_label != request.support_label {
                support_issues.push(format!(
                    "{}:{} support '{}' differs from '{}'",
                    member_id, spec.role, support_label, request.support_label
                ));
                continue;
            }
        }
        let Some(source_path) = binding
            .source_path
            .as_deref()
            .map(str::trim)
            .filter(|path| !path.is_empty())
        else {
            missing.push(member_id.clone());
            continue;
        };
        inputs.push(RoleInput {
            member_id: member_id.clone(),
            path: source_path.to_string(),
        });
    }

    if !missing.is_empty() {
        return Err(format!(
            "Missing role '{}' bindings for member(s): {}.",
            spec.role,
            missing.join(", ")
        ));
    }
    if !support_issues.is_empty() {
        return Err(format!(
            "Role '{}' support validation failed: {}.",
            spec.role,
            support_issues.join("; ")
        ));
    }
    if inputs.is_empty() {
        return Err(format!(
            "No usable input paths were available for reducer {}.",
            spec.id
        ));
    }
    expected_members.clear();
    Ok(inputs)
}

fn resolve_legacy_role_inputs(
    request: &StudioCompareMaterializeRequest,
    spec: &StudioReducerSpec,
) -> Result<Vec<RoleInput>, String> {
    let excluded_member_id = match spec.kind {
        StudioReducerKind::LeaveOneOutMean => spec.excluded_member_id.as_deref(),
        _ => None,
    };
    let mut paths = request
        .cohort_member_source_paths
        .iter()
        .map(|path| path.trim())
        .filter(|path| !path.is_empty())
        .enumerate()
        .filter_map(|(index, path)| {
            let member_id = format!("member-{}", index + 1);
            if Some(member_id.as_str()) == excluded_member_id {
                None
            } else {
                Some(RoleInput {
                    member_id,
                    path: path.to_string(),
                })
            }
        })
        .collect::<Vec<_>>();
    paths.sort_by(|left, right| left.path.cmp(&right.path));
    if paths.is_empty() {
        return Err(format!(
            "No cohort member source paths were provided for role {}.",
            spec.role
        ));
    }
    Ok(paths)
}

// Returns (per-input values, shared dims, reference path); a named alias adds no clarity here.
#[allow(clippy::type_complexity)]
fn load_role_input_values(
    inputs: &[RoleInput],
) -> Result<(Vec<Vec<f32>>, Vec<usize>, String), String> {
    let mut all_values = Vec::new();
    let mut dims: Option<Vec<usize>> = None;
    let mut reference_source_path = None;
    for input in inputs {
        let (volume, _affine) = nifti_loader::load_nifti_volume_auto(Path::new(&input.path))
            .map_err(|error| format!("Failed to load {}: {}", input.path, error))?;
        let (values, volume_dims) = extract_volume_values(&volume)
            .map_err(|error| format!("{} ({})", error, input.path))?;
        match &dims {
            Some(expected_dims) if expected_dims != &volume_dims => {
                return Err(format!(
                    "Role input {} has dims {:?}, expected {:?}.",
                    input.path, volume_dims, expected_dims
                ));
            }
            None => {
                dims = Some(volume_dims);
                reference_source_path = Some(input.path.clone());
            }
            _ => {}
        }
        all_values.push(values);
    }
    Ok((
        all_values,
        dims.ok_or_else(|| "Missing dimensions for reducer inputs.".to_string())?,
        reference_source_path
            .ok_or_else(|| "Missing reference source path for reducer inputs.".to_string())?,
    ))
}

fn mean_values(volumes: &[Vec<f32>]) -> Result<Vec<f32>, String> {
    let first = volumes
        .first()
        .ok_or_else(|| "Cannot compute mean with zero input volumes.".to_string())?;
    let mut mean = vec![0.0; first.len()];
    for volume in volumes {
        if volume.len() != mean.len() {
            return Err("Reducer inputs have mismatched voxel counts.".to_string());
        }
        for (target, value) in mean.iter_mut().zip(volume.iter()) {
            *target += *value;
        }
    }
    for value in &mut mean {
        *value /= volumes.len() as f32;
    }
    Ok(mean)
}

fn sd_values(volumes: &[Vec<f32>]) -> Result<Vec<f32>, String> {
    let mean = mean_values(volumes)?;
    let mut variance = vec![0.0; mean.len()];
    for volume in volumes {
        for ((variance_value, value), mean_value) in
            variance.iter_mut().zip(volume.iter()).zip(mean.iter())
        {
            let centered = value - mean_value;
            *variance_value += centered * centered;
        }
    }
    for value in &mut variance {
        *value = (*value / volumes.len() as f32).sqrt();
    }
    Ok(variance)
}

fn reducer_materialization_key(
    request: &StudioCompareMaterializeRequest,
    spec: &StudioReducerSpec,
) -> String {
    let role_inputs = request
        .cohort_member_role_bindings
        .as_deref()
        .unwrap_or_default()
        .iter()
        .filter(|binding| binding.role == spec.role)
        .filter_map(|binding| binding.source_path.as_deref())
        .collect::<Vec<_>>()
        .join("|");
    build_materialization_key(
        &format!("reducer-{}", reducer_artifact_kind(&spec.kind)),
        &[
            &request.support_label,
            &spec.id,
            &spec.role,
            spec.cohort_id.as_deref().unwrap_or(""),
            spec.excluded_member_id.as_deref().unwrap_or(""),
            &role_inputs,
        ],
    )
}

fn reducer_artifact_kind(kind: &StudioReducerKind) -> &'static str {
    match kind {
        StudioReducerKind::Mean => "mean",
        StudioReducerKind::Sd => "sd",
        StudioReducerKind::LeaveOneOutMean => "leave_one_out_mean",
    }
}

fn reducer_recipe(spec: &StudioReducerSpec) -> String {
    match spec.kind {
        StudioReducerKind::Mean => format!("mean(role={})", spec.role),
        StudioReducerKind::Sd => format!("sd(role={})", spec.role),
        StudioReducerKind::LeaveOneOutMean => format!(
            "leave_one_out_mean(role={}, excluded_member={})",
            spec.role,
            spec.excluded_member_id.as_deref().unwrap_or("")
        ),
    }
}

fn reducer_subtitle(spec: &StudioReducerSpec) -> String {
    match spec.kind {
        StudioReducerKind::LeaveOneOutMean => format!(
            "role {} excluding {}",
            spec.role,
            spec.excluded_member_id
                .as_deref()
                .unwrap_or("selected member")
        ),
        _ => format!("role {}", spec.role),
    }
}

fn build_reducer_provenance(
    request: &StudioCompareMaterializeRequest,
    spec: &StudioReducerSpec,
    inputs: &[RoleInput],
) -> Value {
    json!({
        "artifactKind": reducer_artifact_kind(&spec.kind),
        "reducerSpec": {
            "id": spec.id,
            "label": spec.label,
            "kind": spec.kind,
            "role": spec.role,
            "cohortId": spec.cohort_id,
            "excludedMemberId": spec.excluded_member_id,
        },
        "selectedRole": spec.role,
        "supportLabel": request.support_label,
        "compareCohortId": request.compare_cohort_id,
        "inputMembers": inputs.iter().map(|input| json!({
            "memberId": input.member_id,
            "path": input.path,
        })).collect::<Vec<_>>(),
    })
}

fn file_modified_ms(path: &str) -> Option<u64> {
    fs::metadata(path)
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
}

fn build_materialization_key(namespace: &str, parts: &[&str]) -> String {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in namespace.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    for part in parts {
        hash ^= 0xff;
        hash = hash.wrapping_mul(0x100000001b3);
        for byte in part.as_bytes() {
            hash ^= *byte as u64;
            hash = hash.wrapping_mul(0x100000001b3);
        }
    }
    format!("{}:{:016x}", namespace, hash)
}

fn current_timestamp_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn make_input_stamp(role: &str, path: &str) -> StudioCacheInputStamp {
    let trimmed_path = path.trim().to_string();
    let metadata = fs::metadata(&trimmed_path).ok();
    let modified_at_ms = metadata
        .as_ref()
        .and_then(|value| value.modified().ok())
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64);
    let size_bytes = metadata.as_ref().map(|value| value.len());
    StudioCacheInputStamp {
        role: role.to_string(),
        path: trimmed_path,
        exists: metadata.is_some(),
        modified_at_ms,
        size_bytes,
    }
}

fn build_cache_manifest(
    materialization_key: &str,
    artifact_kind: &str,
    recipe: Option<String>,
    support_label: &str,
    output_path: &Path,
    input_stamps: Vec<StudioCacheInputStamp>,
    provenance: Value,
) -> StudioCacheManifest {
    StudioCacheManifest {
        version: 1,
        materialization_key: materialization_key.to_string(),
        artifact_kind: artifact_kind.to_string(),
        recipe,
        support_label: support_label.to_string(),
        output_path: output_path.to_string_lossy().into_owned(),
        created_at_ms: current_timestamp_ms(),
        input_stamps,
        provenance,
    }
}

fn build_compare_provenance(
    artifact_kind: &str,
    request: &StudioCompareMaterializeRequest,
    cohort_source_count: usize,
) -> Value {
    json!({
        "artifactKind": artifact_kind,
        "supportLabel": request.support_label,
        "activeMemberId": request.active_member_id,
        "activeMemberSourcePath": request.active_member_source_path,
        "compareCohortId": request.compare_cohort_id,
        "compareCohortLabel": request.compare_cohort_label,
        "compareCohortMemberCount": request.compare_cohort_member_count,
        "activeExpressionLabel": request.active_expression_label,
        "activeExpressionRecipe": request.active_expression_recipe,
        "cohortSourceCount": cohort_source_count,
    })
}

fn cache_paths(materialization_key: &str) -> Result<(PathBuf, PathBuf), String> {
    let root = studio_cache_root()
        .map_err(|error| format!("Failed to prepare Studio cache directory: {}", error))?;
    Ok((
        root.join(format!("{}.nii.gz", materialization_key)),
        root.join(format!("{}.manifest.json", materialization_key)),
    ))
}

fn read_cache_manifest(path: &Path) -> Result<StudioCacheManifest, String> {
    let manifest_text = fs::read_to_string(path).map_err(|error| {
        format!(
            "Failed to read cache manifest {}: {}",
            path.display(),
            error
        )
    })?;
    serde_json::from_str(&manifest_text).map_err(|error| {
        format!(
            "Failed to parse cache manifest {}: {}",
            path.display(),
            error
        )
    })
}

fn write_cache_manifest(path: &Path, manifest: &StudioCacheManifest) -> Result<(), String> {
    let serialized = serde_json::to_string_pretty(manifest)
        .map_err(|error| format!("Failed to serialize cache manifest: {}", error))?;
    fs::write(path, serialized).map_err(|error| {
        format!(
            "Failed to write cache manifest {}: {}",
            path.display(),
            error
        )
    })
}

fn describe_input_stamp_delta(
    recorded: &[StudioCacheInputStamp],
    expected: &[StudioCacheInputStamp],
) -> Option<String> {
    if recorded.len() != expected.len() {
        return Some(format!(
            "Input set changed (recorded {} entries, current {}).",
            recorded.len(),
            expected.len()
        ));
    }

    for (recorded_stamp, expected_stamp) in recorded.iter().zip(expected.iter()) {
        if recorded_stamp.role != expected_stamp.role || recorded_stamp.path != expected_stamp.path
        {
            return Some(format!(
                "Input binding changed for role {} (recorded {}, current {}).",
                expected_stamp.role, recorded_stamp.path, expected_stamp.path
            ));
        }
        if recorded_stamp.exists != expected_stamp.exists {
            return Some(format!(
                "Input availability changed for {}.",
                expected_stamp.path
            ));
        }
        if recorded_stamp.modified_at_ms != expected_stamp.modified_at_ms {
            return Some(format!(
                "Input timestamp changed for {}.",
                expected_stamp.path
            ));
        }
        if recorded_stamp.size_bytes != expected_stamp.size_bytes {
            return Some(format!("Input size changed for {}.", expected_stamp.path));
        }
    }

    None
}

fn validate_cache_manifest(
    recorded: &StudioCacheManifest,
    expected: &StudioCacheManifest,
) -> Result<(), String> {
    if recorded.version != expected.version {
        return Err(format!(
            "Manifest version changed ({} -> {}).",
            recorded.version, expected.version
        ));
    }
    if recorded.materialization_key != expected.materialization_key {
        return Err("Materialization key changed.".to_string());
    }
    if recorded.artifact_kind != expected.artifact_kind {
        return Err("Artifact kind changed.".to_string());
    }
    if recorded.recipe != expected.recipe {
        return Err("Recipe changed.".to_string());
    }
    if recorded.support_label != expected.support_label {
        return Err("Support label changed.".to_string());
    }
    if recorded.output_path != expected.output_path {
        return Err("Output path changed.".to_string());
    }
    if let Some(delta) = describe_input_stamp_delta(&recorded.input_stamps, &expected.input_stamps)
    {
        return Err(delta);
    }
    if recorded.provenance != expected.provenance {
        return Err("Provenance contract changed.".to_string());
    }
    Ok(())
}

fn resolve_cache_plan(
    expected_manifest: StudioCacheManifest,
    force_rematerialize: bool,
) -> Result<CachePlan, String> {
    let (output_path, manifest_path) = cache_paths(&expected_manifest.materialization_key)?;

    if force_rematerialize {
        return Ok(CachePlan {
            reuse_record: None,
            output_path,
            manifest_path,
            manifest: expected_manifest,
            cache_status: StudioCompareCacheStatus::Forced,
            cache_message: "Force rematerialize was requested.".to_string(),
        });
    }

    match (output_path.exists(), manifest_path.exists()) {
        (true, true) => {
            let recorded_manifest = read_cache_manifest(&manifest_path)?;
            match validate_cache_manifest(&recorded_manifest, &expected_manifest) {
                Ok(()) => Ok(CachePlan {
                    reuse_record: Some(StudioCompareMaterializationRecord {
                        output_path: output_path.to_string_lossy().into_owned(),
                        cache_status: StudioCompareCacheStatus::Hit,
                        cache_message: "Manifest matched the current inputs.".to_string(),
                        provenance_path: Some(manifest_path.to_string_lossy().into_owned()),
                    }),
                    output_path,
                    manifest_path,
                    manifest: expected_manifest,
                    cache_status: StudioCompareCacheStatus::Hit,
                    cache_message: "Manifest matched the current inputs.".to_string(),
                }),
                Err(reason) => Ok(CachePlan {
                    reuse_record: None,
                    output_path,
                    manifest_path,
                    manifest: expected_manifest,
                    cache_status: StudioCompareCacheStatus::Stale,
                    cache_message: format!("Stale cache entry detected: {}", reason),
                }),
            }
        }
        (false, false) => Ok(CachePlan {
            reuse_record: None,
            output_path,
            manifest_path,
            manifest: expected_manifest,
            cache_status: StudioCompareCacheStatus::Miss,
            cache_message: "No prior cache entry was found.".to_string(),
        }),
        (true, false) => Ok(CachePlan {
            reuse_record: None,
            output_path,
            manifest_path,
            manifest: expected_manifest,
            cache_status: StudioCompareCacheStatus::Stale,
            cache_message: "Cached output existed without a manifest.".to_string(),
        }),
        (false, true) => Ok(CachePlan {
            reuse_record: None,
            output_path,
            manifest_path,
            manifest: expected_manifest,
            cache_status: StudioCompareCacheStatus::Stale,
            cache_message: "Cache manifest existed but the artifact file was missing.".to_string(),
        }),
    }
}

fn format_materialization_reason(
    label: &str,
    record: &StudioCompareMaterializationRecord,
) -> String {
    match record.cache_status {
        StudioCompareCacheStatus::Hit => format!("{} cache hit at {}.", label, record.output_path),
        StudioCompareCacheStatus::Miss => {
            format!(
                "{} materialized after cache miss at {}.",
                label, record.output_path
            )
        }
        StudioCompareCacheStatus::Stale => {
            format!(
                "{} rebuilt a stale cache entry at {}.",
                label, record.output_path
            )
        }
        StudioCompareCacheStatus::Forced => {
            format!(
                "{} was force-rematerialized at {}.",
                label, record.output_path
            )
        }
        StudioCompareCacheStatus::Synthetic => {
            format!(
                "{} is using a synthetic preview at {}.",
                label, record.output_path
            )
        }
        StudioCompareCacheStatus::Source => {
            format!("{} is source-backed at {}.", label, record.output_path)
        }
        StudioCompareCacheStatus::Unavailable => format!("{} is not available yet.", label),
        StudioCompareCacheStatus::Failed => format!("{} materialization failed.", label),
    }
}

fn derived_binding(
    materialization: &Result<StudioCompareMaterializationRecord, String>,
    materialization_key: Option<String>,
    eligible_for_materialization: bool,
) -> StudioComparePaneBinding {
    match materialization {
        Ok(record) => StudioComparePaneBinding {
            kind: StudioCompareBindingKind::DerivedField,
            ready: true,
            source_path: Some(record.output_path.clone()),
            materialization_key,
            materialized_at_ms: file_modified_ms(&record.output_path),
            cache_status: record.cache_status.clone(),
            cache_message: Some(record.cache_message.clone()),
            provenance_path: record.provenance_path.clone(),
        },
        Err(message) => StudioComparePaneBinding {
            kind: StudioCompareBindingKind::DerivedField,
            ready: false,
            source_path: None,
            materialization_key,
            materialized_at_ms: None,
            cache_status: if eligible_for_materialization {
                StudioCompareCacheStatus::Failed
            } else {
                StudioCompareCacheStatus::Unavailable
            },
            cache_message: Some(message.clone()),
            provenance_path: None,
        },
    }
}

fn materialize_cohort_mean(
    request: &StudioCompareMaterializeRequest,
    materialization_key: Option<&str>,
) -> Result<StudioCompareMaterializationRecord, String> {
    let mut candidate_paths: Vec<String> = request
        .cohort_member_source_paths
        .iter()
        .map(|path| path.trim())
        .filter(|path| !path.is_empty())
        .map(ToOwned::to_owned)
        .collect();
    candidate_paths.sort();
    if candidate_paths.is_empty() {
        return Err("No cohort member source paths were provided.".to_string());
    }

    let materialization_key = materialization_key
        .ok_or_else(|| "No materialization key was computed for the cohort mean.".to_string())?;
    let (output_path, _) = cache_paths(materialization_key)?;
    let expected_manifest = build_cache_manifest(
        materialization_key,
        "cohort_mean",
        request
            .compare_cohort_id
            .as_ref()
            .map(|cohort_id| format!("mean(cohort:{})", cohort_id)),
        &request.support_label,
        &output_path,
        candidate_paths
            .iter()
            .map(|path| make_input_stamp("cohort_member", path))
            .collect(),
        build_compare_provenance("cohort_mean", request, candidate_paths.len()),
    );
    let cache_plan = resolve_cache_plan(expected_manifest, request.force_rematerialize)?;
    if let Some(record) = cache_plan.reuse_record {
        return Ok(record);
    }

    let mut sum_data: Option<Vec<f32>> = None;
    let mut dims: Option<Vec<usize>> = None;
    let mut reference_source_path: Option<&str> = None;
    let mut used_paths = 0usize;

    for source_path in &candidate_paths {
        let path = Path::new(source_path);
        let (volume, _affine) = nifti_loader::load_nifti_volume_auto(path)
            .map_err(|error| format!("Failed to load {}: {}", source_path, error))?;
        let (values, volume_dims) = extract_volume_values(&volume)
            .map_err(|error| format!("{} ({})", error, source_path))?;

        match &dims {
            Some(existing_dims) if existing_dims != &volume_dims => {
                return Err(format!(
                    "Cohort member {} has dims {:?}, expected {:?}.",
                    source_path, volume_dims, existing_dims
                ));
            }
            None => {
                dims = Some(volume_dims.clone());
                reference_source_path = Some(source_path.as_str());
                sum_data = Some(vec![0.0; values.len()]);
            }
            _ => {}
        }

        if let Some(sum) = sum_data.as_mut() {
            for (target, value) in sum.iter_mut().zip(values.iter()) {
                *target += *value;
            }
        }
        used_paths += 1;
    }

    if used_paths == 0 {
        return Err("No cohort members could be loaded for the cohort mean.".to_string());
    }

    let mut mean_data =
        sum_data.ok_or_else(|| "Cohort mean accumulation never initialized.".to_string())?;
    for value in &mut mean_data {
        *value /= used_paths as f32;
    }

    let dims = dims.ok_or_else(|| "Missing dimensions for cohort mean.".to_string())?;
    let reference_source_path = reference_source_path
        .ok_or_else(|| "Missing reference source path for cohort mean.".to_string())?;
    write_f32_nifti(
        &cache_plan.output_path,
        &dims,
        reference_source_path,
        &mean_data,
    )
    .map_err(|error| format!("Failed to write cohort mean NIfTI: {}", error))?;
    write_cache_manifest(&cache_plan.manifest_path, &cache_plan.manifest)?;

    Ok(StudioCompareMaterializationRecord {
        output_path: cache_plan.output_path.to_string_lossy().into_owned(),
        cache_status: cache_plan.cache_status,
        cache_message: cache_plan.cache_message,
        provenance_path: Some(cache_plan.manifest_path.to_string_lossy().into_owned()),
    })
}

fn materialize_residual(
    request: &StudioCompareMaterializeRequest,
    materialization_key: Option<&str>,
    cohort_mean_path: Option<&str>,
) -> Result<StudioCompareMaterializationRecord, String> {
    let member_source_path = request
        .active_member_source_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .ok_or_else(|| "No active member source path was provided.".to_string())?;
    let cohort_mean_path = cohort_mean_path
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .ok_or_else(|| "No cohort mean path was provided.".to_string())?;
    let materialization_key = materialization_key
        .ok_or_else(|| "No materialization key was computed for the residual.".to_string())?;
    let mut cohort_paths: Vec<String> = request
        .cohort_member_source_paths
        .iter()
        .map(|path| path.trim())
        .filter(|path| !path.is_empty())
        .map(ToOwned::to_owned)
        .collect();
    cohort_paths.sort();
    let (output_path, _) = cache_paths(materialization_key)?;
    let mut input_stamps = vec![make_input_stamp("active_member", member_source_path)];
    input_stamps.extend(
        cohort_paths
            .iter()
            .map(|path| make_input_stamp("cohort_member", path)),
    );
    let expected_manifest = build_cache_manifest(
        materialization_key,
        "residual",
        match (&request.active_member_id, &request.compare_cohort_id) {
            (Some(member_id), Some(cohort_id)) => Some(format!(
                "residual(member:{}, cohort:{})",
                member_id, cohort_id
            )),
            _ => None,
        },
        &request.support_label,
        &output_path,
        input_stamps,
        build_compare_provenance("residual", request, cohort_paths.len()),
    );
    let cache_plan = resolve_cache_plan(expected_manifest, request.force_rematerialize)?;
    if let Some(record) = cache_plan.reuse_record {
        return Ok(record);
    }

    let (member_volume, _member_affine) =
        nifti_loader::load_nifti_volume_auto(Path::new(member_source_path)).map_err(|error| {
            format!(
                "Failed to load member source {}: {}",
                member_source_path, error
            )
        })?;
    let (cohort_mean_volume, _mean_affine) =
        nifti_loader::load_nifti_volume_auto(Path::new(cohort_mean_path)).map_err(|error| {
            format!(
                "Failed to load cached cohort mean {}: {}",
                cohort_mean_path, error
            )
        })?;

    let (member_values, member_dims) = extract_volume_values(&member_volume)
        .map_err(|error| format!("{} ({})", error, member_source_path))?;
    let (cohort_values, cohort_dims) = extract_volume_values(&cohort_mean_volume)
        .map_err(|error| format!("{} ({})", error, cohort_mean_path))?;
    if member_dims != cohort_dims {
        return Err(format!(
            "Residual inputs have mismatched dims {:?} vs {:?}.",
            member_dims, cohort_dims
        ));
    }

    let residual_data: Vec<f32> = member_values
        .iter()
        .zip(cohort_values.iter())
        .map(|(member, cohort)| member - cohort)
        .collect();
    write_f32_nifti(
        &cache_plan.output_path,
        &member_dims,
        member_source_path,
        &residual_data,
    )
    .map_err(|error| format!("Failed to write residual NIfTI: {}", error))?;
    write_cache_manifest(&cache_plan.manifest_path, &cache_plan.manifest)?;

    Ok(StudioCompareMaterializationRecord {
        output_path: cache_plan.output_path.to_string_lossy().into_owned(),
        cache_status: cache_plan.cache_status,
        cache_message: cache_plan.cache_message,
        provenance_path: Some(cache_plan.manifest_path.to_string_lossy().into_owned()),
    })
}

fn materialize_zscore(
    request: &StudioCompareMaterializeRequest,
    materialization_key: Option<&str>,
    cohort_mean_path: Option<&str>,
) -> Result<StudioCompareMaterializationRecord, String> {
    let member_source_path = request
        .active_member_source_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .ok_or_else(|| "No active member source path was provided.".to_string())?;
    let cohort_mean_path = cohort_mean_path
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .ok_or_else(|| "No cohort mean path was provided.".to_string())?;
    let materialization_key = materialization_key
        .ok_or_else(|| "No materialization key was computed for the z-score.".to_string())?;
    let mut cohort_paths: Vec<String> = request
        .cohort_member_source_paths
        .iter()
        .map(|path| path.trim())
        .filter(|path| !path.is_empty())
        .map(ToOwned::to_owned)
        .collect();
    cohort_paths.sort();
    if cohort_paths.is_empty() {
        return Err("No cohort member source paths were provided.".to_string());
    }
    let (output_path, _) = cache_paths(materialization_key)?;
    let mut input_stamps = vec![make_input_stamp("active_member", member_source_path)];
    input_stamps.extend(
        cohort_paths
            .iter()
            .map(|path| make_input_stamp("cohort_member", path)),
    );
    let expected_manifest = build_cache_manifest(
        materialization_key,
        "zscore",
        request.active_expression_recipe.clone(),
        &request.support_label,
        &output_path,
        input_stamps,
        build_compare_provenance("zscore", request, cohort_paths.len()),
    );
    let cache_plan = resolve_cache_plan(expected_manifest, request.force_rematerialize)?;
    if let Some(record) = cache_plan.reuse_record {
        return Ok(record);
    }

    let (member_volume, _member_affine) =
        nifti_loader::load_nifti_volume_auto(Path::new(member_source_path)).map_err(|error| {
            format!(
                "Failed to load member source {}: {}",
                member_source_path, error
            )
        })?;
    let (cohort_mean_volume, _mean_affine) =
        nifti_loader::load_nifti_volume_auto(Path::new(cohort_mean_path)).map_err(|error| {
            format!(
                "Failed to load cached cohort mean {}: {}",
                cohort_mean_path, error
            )
        })?;

    let (member_values, member_dims) = extract_volume_values(&member_volume)
        .map_err(|error| format!("{} ({})", error, member_source_path))?;
    let (cohort_mean_values, cohort_mean_dims) = extract_volume_values(&cohort_mean_volume)
        .map_err(|error| format!("{} ({})", error, cohort_mean_path))?;
    if member_dims != cohort_mean_dims {
        return Err(format!(
            "Z-score inputs have mismatched dims {:?} vs {:?}.",
            member_dims, cohort_mean_dims
        ));
    }

    let mut variance = vec![0.0f32; member_values.len()];
    let mut cohort_count = 0usize;
    for cohort_path in &cohort_paths {
        let (cohort_volume, _cohort_affine) =
            nifti_loader::load_nifti_volume_auto(Path::new(cohort_path)).map_err(|error| {
                format!("Failed to load cohort member {}: {}", cohort_path, error)
            })?;
        let (cohort_values, cohort_dims) = extract_volume_values(&cohort_volume)
            .map_err(|error| format!("{} ({})", error, cohort_path))?;
        if cohort_dims != member_dims {
            return Err(format!(
                "Cohort variance input {} has dims {:?}, expected {:?}.",
                cohort_path, cohort_dims, member_dims
            ));
        }
        for ((variance_value, cohort_value), mean_value) in variance
            .iter_mut()
            .zip(cohort_values.iter())
            .zip(cohort_mean_values.iter())
        {
            let centered = cohort_value - mean_value;
            *variance_value += centered * centered;
        }
        cohort_count += 1;
    }

    if cohort_count == 0 {
        return Err("No cohort members could be loaded for the z-score.".to_string());
    }

    let zscore_data: Vec<f32> = member_values
        .iter()
        .zip(cohort_mean_values.iter())
        .zip(variance.iter())
        .map(|((member, mean), variance_sum)| {
            let std = (*variance_sum / cohort_count as f32).sqrt();
            if std <= 1.0e-6 {
                0.0
            } else {
                (member - mean) / std
            }
        })
        .collect();
    write_f32_nifti(
        &cache_plan.output_path,
        &member_dims,
        member_source_path,
        &zscore_data,
    )
    .map_err(|error| format!("Failed to write z-score NIfTI: {}", error))?;
    write_cache_manifest(&cache_plan.manifest_path, &cache_plan.manifest)?;

    Ok(StudioCompareMaterializationRecord {
        output_path: cache_plan.output_path.to_string_lossy().into_owned(),
        cache_status: cache_plan.cache_status,
        cache_message: cache_plan.cache_message,
        provenance_path: Some(cache_plan.manifest_path.to_string_lossy().into_owned()),
    })
}

fn studio_cache_root() -> Result<PathBuf, std::io::Error> {
    let root = std::env::temp_dir().join("brainflow_set_studio_cache");
    fs::create_dir_all(&root)?;
    Ok(root)
}

pub(crate) fn extract_volume_values(
    volume: &bridge_types::VolumeSendable,
) -> Result<(Vec<f32>, Vec<usize>), String> {
    match volume {
        bridge_types::VolumeSendable::VolF32(vol, _) => Ok((vol.values(), vol.space().dim.clone())),
        bridge_types::VolumeSendable::VolI16(vol, _) => Ok((
            vol.values().into_iter().map(|value| value as f32).collect(),
            vol.space().dim.clone(),
        )),
        bridge_types::VolumeSendable::VolU8(vol, _) => Ok((
            vol.values().into_iter().map(|value| value as f32).collect(),
            vol.space().dim.clone(),
        )),
        bridge_types::VolumeSendable::VolI8(vol, _) => Ok((
            vol.values().into_iter().map(|value| value as f32).collect(),
            vol.space().dim.clone(),
        )),
        bridge_types::VolumeSendable::VolU16(vol, _) => Ok((
            vol.values().into_iter().map(|value| value as f32).collect(),
            vol.space().dim.clone(),
        )),
        bridge_types::VolumeSendable::VolI32(vol, _) => Ok((
            vol.values().into_iter().map(|value| value as f32).collect(),
            vol.space().dim.clone(),
        )),
        bridge_types::VolumeSendable::VolU32(vol, _) => Ok((
            vol.values().into_iter().map(|value| value as f32).collect(),
            vol.space().dim.clone(),
        )),
        bridge_types::VolumeSendable::VolF64(vol, _) => Ok((
            vol.values().into_iter().map(|value| value as f32).collect(),
            vol.space().dim.clone(),
        )),
        _ => Err(
            "Only 3D NIfTI volumes are currently supported for cohort mean materialization."
                .to_string(),
        ),
    }
}

fn write_f32_nifti(
    path: &Path,
    dims: &[usize],
    reference_source_path: &str,
    data: &[f32],
) -> Result<(), Box<dyn std::error::Error>> {
    if dims.len() != 3 {
        return Err(format!("Expected 3 dims for NIfTI output, got {:?}", dims).into());
    }

    let array = ndarray::Array3::from_shape_vec((dims[0], dims[1], dims[2]).f(), data.to_vec())?;
    WriterOptions::new(path)
        .reference_file(&Path::new(reference_source_path))
        .write_nifti(&array)?;
    Ok(())
}
