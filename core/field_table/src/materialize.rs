use bridge_types::{
    StudioCompareBindingKind, StudioCompareCacheStatus, StudioCompareMaterializeRequest,
    StudioComparePaneBinding, StudioComparePaneSpec, StudioComparePaneStatus,
    StudioFieldBindingAvailability, StudioReducerKind, StudioReducerSpec, StudioSupportKind,
};
use ndarray::ShapeBuilder;
use nifti::writer::WriterOptions;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::cell::RefCell;
use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::UNIX_EPOCH;

mod compare_inputs;
pub use compare_inputs::{
    clear_compare_cache, DecodedVolume, DecodedVolumeSource, NoDecodedVolumes,
};
use compare_inputs::{decode_volume, member_set_stats, MemberSetStats};

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

/// One Compare request's inputs: decoded member volumes are memoized for the
/// request, member-set moments come from the process cache when their sources
/// are unchanged, and a lent host volume replaces a decode when available.
struct CompareContext<'a> {
    source: &'a dyn DecodedVolumeSource,
    cancel: &'a AtomicBool,
    decoded: RefCell<HashMap<String, DecodedVolume>>,
}

impl<'a> CompareContext<'a> {
    fn new(source: &'a dyn DecodedVolumeSource, cancel: &'a AtomicBool) -> Self {
        Self {
            source,
            cancel,
            decoded: RefCell::new(HashMap::new()),
        }
    }

    fn check_cancel(&self) -> Result<(), String> {
        compare_inputs::check_cancel(self.cancel)
    }

    fn stats(
        &self,
        paths: &[String],
        dims_error: &compare_inputs::DimsError,
    ) -> Result<Arc<MemberSetStats>, String> {
        member_set_stats(paths, self.source, self.cancel, dims_error)
    }

    /// One member volume: memoized, then a retained member-set copy, then a
    /// lent host volume, then the NIfTI loader.
    fn volume(&self, path: &str) -> Result<DecodedVolume, String> {
        if let Some(decoded) = self.decoded.borrow().get(path) {
            return Ok(decoded.clone());
        }
        self.check_cancel()?;
        let decoded = match compare_inputs::retained_member(path) {
            Some(decoded) => decoded,
            None => decode_volume(path, self.source)?,
        };
        self.decoded
            .borrow_mut()
            .insert(path.to_string(), decoded.clone());
        Ok(decoded)
    }
}

pub fn materialize_compare_panes(
    request: StudioCompareMaterializeRequest,
) -> Vec<StudioComparePaneSpec> {
    materialize_compare_panes_with_source(request, &NoDecodedVolumes)
}

/// As [`materialize_compare_panes`], borrowing already-decoded volumes from
/// `source` where it has them instead of decoding those files again.
pub fn materialize_compare_panes_with_source(
    request: StudioCompareMaterializeRequest,
    source: &dyn DecodedVolumeSource,
) -> Vec<StudioComparePaneSpec> {
    materialize_compare_panes_cancelable(request, source, &AtomicBool::new(false))
}

/// As [`materialize_compare_panes_with_source`]; once `cancel` is set no
/// further member is decoded and the remaining panes report cancellation.
pub fn materialize_compare_panes_cancelable(
    request: StudioCompareMaterializeRequest,
    source: &dyn DecodedVolumeSource,
    cancel: &AtomicBool,
) -> Vec<StudioComparePaneSpec> {
    let started = std::time::Instant::now();
    let ctx = CompareContext::new(source, cancel);
    let panes = materialize_compare_panes_in(&request, &ctx);
    log::info!(
        "[perf] compare panes: {} panes, {} cohort members, {} ms",
        panes.len(),
        request.cohort_member_source_paths.len(),
        started.elapsed().as_millis()
    );
    panes
}

fn materialize_compare_panes_in(
    request: &StudioCompareMaterializeRequest,
    ctx: &CompareContext,
) -> Vec<StudioComparePaneSpec> {
    let request = request.clone();
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
        materialize_cohort_mean(&request, cohort_mean_key.as_deref(), ctx)
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
            ctx,
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
            ctx,
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
    panes.extend(materialize_reducer_panes(&request, ctx));
    panes
}

fn materialize_reducer_panes(
    request: &StudioCompareMaterializeRequest,
    ctx: &CompareContext,
) -> Vec<StudioComparePaneSpec> {
    let specs = request.reducer_specs.as_deref().unwrap_or(&[]);
    specs
        .iter()
        .map(|spec| {
            let materialization_key = Some(reducer_materialization_key(request, spec));
            let materialization = if request.compare_ready {
                materialize_reducer(request, spec, materialization_key.as_deref(), ctx)
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
    ctx: &CompareContext,
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

    let paths: Vec<String> = role_inputs.iter().map(|input| input.path.clone()).collect();
    let role_dims_error = |path: &str, actual: &[usize], expected: &[usize]| {
        format!(
            "Role input {} has dims {:?}, expected {:?}.",
            path, actual, expected
        )
    };
    let leave_one_out = matches!(spec.kind, StudioReducerKind::LeaveOneOutMean);
    // A leave-one-out mean over a retained member set reduces the retained
    // values (bit-exact, no decode). Past the values budget it is downdated
    // from the full set's cached moments and the left-out member's values.
    let retained = if leave_one_out {
        compare_inputs::retained_set(&paths)
    } else {
        None
    };
    if leave_one_out && retained.is_none() {
        if let Some(data) = leave_one_out_by_downdate(request, spec, &role_inputs, ctx)? {
            let (data, dims) = data;
            write_f32_nifti(&cache_plan.output_path, &dims, &role_inputs[0].path, &data)
                .map_err(|error| format!("Failed to write reducer NIfTI: {}", error))?;
            write_cache_manifest(&cache_plan.manifest_path, &cache_plan.manifest)?;
            return Ok(StudioCompareMaterializationRecord {
                output_path: cache_plan.output_path.to_string_lossy().into_owned(),
                cache_status: cache_plan.cache_status,
                cache_message: cache_plan.cache_message,
                provenance_path: Some(cache_plan.manifest_path.to_string_lossy().into_owned()),
            });
        }
    }
    let stats;
    let reduced;
    let (moments, dims) = match retained {
        Some(values) => {
            let first = &values[0];
            let mut moments = crate::population::CompactMoments::new(first.values.len());
            for (input, decoded) in role_inputs.iter().zip(&values) {
                ctx.check_cancel()?;
                validate_grid_affines(&first.affine, &decoded.affine)
                    .map_err(|error| format!("{} ({})", error, input.path))?;
                if decoded.dims != first.dims {
                    return Err(role_dims_error(&input.path, &decoded.dims, &first.dims));
                }
                moments
                    .push(&decoded.values)
                    .map_err(|error| error.to_string())?;
            }
            reduced = moments;
            (&reduced, first.dims.clone())
        }
        None => {
            stats = ctx.stats(&paths, &role_dims_error)?;
            (&stats.moments, stats.dims.clone())
        }
    };
    let data = (0..moments.len())
        .map(|index| {
            summary_to_f32(match spec.kind {
                StudioReducerKind::Mean | StudioReducerKind::LeaveOneOutMean => moments.mean(index),
                StudioReducerKind::Sd => moments.sample_sd(index),
            })
        })
        .collect::<Result<Vec<_>, _>>()?;

    write_f32_nifti(&cache_plan.output_path, &dims, &role_inputs[0].path, &data)
        .map_err(|error| format!("Failed to write reducer NIfTI: {}", error))?;
    write_cache_manifest(&cache_plan.manifest_path, &cache_plan.manifest)?;

    Ok(StudioCompareMaterializationRecord {
        output_path: cache_plan.output_path.to_string_lossy().into_owned(),
        cache_status: cache_plan.cache_status,
        cache_message: cache_plan.cache_message,
        provenance_path: Some(cache_plan.manifest_path.to_string_lossy().into_owned()),
    })
}

/// Leave-one-out mean from the full role set's moments (shared with SD and
/// cached across pages) and the left-out member's values. `None` when the
/// exclusion is not exactly one member of the full set.
#[allow(clippy::type_complexity)] // (values, dims)
fn leave_one_out_by_downdate(
    request: &StudioCompareMaterializeRequest,
    spec: &StudioReducerSpec,
    loo_inputs: &[RoleInput],
    ctx: &CompareContext,
) -> Result<Option<(Vec<f32>, Vec<usize>)>, String> {
    let full_spec = StudioReducerSpec {
        kind: StudioReducerKind::Mean,
        excluded_member_id: None,
        ..spec.clone()
    };
    let full = resolve_role_inputs(request, &full_spec)?;
    let left_out: Vec<&RoleInput> = full
        .iter()
        .filter(|input| {
            !loo_inputs
                .iter()
                .any(|kept| kept.member_id == input.member_id)
        })
        .collect();
    let kept_in_order = full
        .iter()
        .filter(|input| {
            loo_inputs
                .iter()
                .any(|kept| kept.member_id == input.member_id)
        })
        .map(|input| &input.path)
        .eq(loo_inputs.iter().map(|input| &input.path));
    let [left_out] = left_out.as_slice() else {
        return Ok(None);
    };
    if !kept_in_order {
        return Ok(None);
    }
    let paths: Vec<String> = full.iter().map(|input| input.path.clone()).collect();
    let stats =
        ctx.stats(&paths, &|path: &str,
                            actual: &[usize],
                            expected: &[usize]| {
            format!(
                "Role input {} has dims {:?}, expected {:?}.",
                path, actual, expected
            )
        })?;
    let member = ctx.volume(&left_out.path)?;
    validate_grid_affines(&stats.affine, &member.affine)
        .map_err(|error| format!("{} ({})", error, left_out.path))?;
    if member.dims != stats.dims {
        return Err(format!(
            "Role input {} has dims {:?}, expected {:?}.",
            left_out.path, member.dims, stats.dims
        ));
    }
    let data = member
        .values
        .iter()
        .enumerate()
        .map(|(index, &value)| summary_to_f32(stats.moments.mean_without(index, value)))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Some((data, stats.dims.clone())))
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

/// Indexed reductions require matching world frames as well as dimensions.
/// The absolute tolerance is for header float rounding, never registration.
/// The comparison is `nifti_loader::affines_match` (1e-5 on the 3×3 block,
/// 1e-3 mm on the origin), which the Set studio grid audit and Population
/// sampling use too, so the three cannot drift apart.
fn validate_grid_affines(reference: &[f32], candidate: &[f32]) -> Result<(), String> {
    for affine in [reference, candidate] {
        if affine.len() != 16 || affine.iter().any(|value| !value.is_finite()) {
            return Err("Population input has an invalid world affine.".to_string());
        }
        // nalgebra's homogeneous matrices are column-major.
        let a = |row: usize, col: usize| f64::from(affine[row + 4 * col]);
        let determinant = a(0, 0) * (a(1, 1) * a(2, 2) - a(1, 2) * a(2, 1))
            - a(0, 1) * (a(1, 0) * a(2, 2) - a(1, 2) * a(2, 0))
            + a(0, 2) * (a(1, 0) * a(2, 1) - a(1, 1) * a(2, 0));
        if determinant == 0.0 {
            return Err("Population input has a singular world affine.".to_string());
        }
    }
    if !nifti_loader::affines_match(
        &nifti_loader::VoxelToWorld::from_column_slice(reference),
        &nifti_loader::VoxelToWorld::from_column_slice(candidate),
    ) {
        return Err(
            "Population inputs have different world affines; explicit resampling is required."
                .to_string(),
        );
    }
    Ok(())
}

#[cfg(test)]
fn mean_values(volumes: &[Vec<f32>]) -> Result<Vec<f32>, String> {
    reduce_population_values(volumes, |summary| summary.mean)
}

#[cfg(test)]
fn sd_values(volumes: &[Vec<f32>]) -> Result<Vec<f32>, String> {
    reduce_population_values(volumes, |summary| summary.sample_sd)
}

fn summary_to_f32(value: Option<f64>) -> Result<f32, String> {
    match value {
        None => Ok(f32::NAN),
        Some(value) if (value as f32).is_finite() => Ok(value as f32),
        Some(_) => Err("Population summary exceeds the float32 output range.".to_string()),
    }
}

/// Bound numerical scratch space independently of the full export grid.
#[cfg(test)]
fn reduce_population_values(
    volumes: &[Vec<f32>],
    select: impl Fn(crate::population::LocationSummary) -> Option<f64>,
) -> Result<Vec<f32>, String> {
    let first = volumes
        .first()
        .ok_or_else(|| "Cannot reduce zero input volumes.".to_string())?;
    if first.is_empty() {
        return Err("Population support must contain at least one location.".to_string());
    }
    if volumes.iter().any(|volume| volume.len() != first.len()) {
        return Err("Reducer inputs have mismatched voxel counts.".to_string());
    }
    let mut output = Vec::with_capacity(first.len());
    for start in (0..first.len()).step_by(16_384) {
        let end = (start + 16_384).min(first.len());
        let mut moments = crate::population::FieldMoments::new(end - start, 0.0)
            .map_err(|error| error.to_string())?;
        for volume in volumes {
            moments
                .push(&volume[start..end], None)
                .map_err(|error| error.to_string())?;
        }
        for summary in moments.summaries() {
            output.push(summary_to_f32(select(summary))?);
        }
    }
    Ok(output)
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
        StudioReducerKind::Sd => format!("sd(role={}, ddof=1)", spec.role),
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
        "reductionSemantics": {
            "accumulation": "float64_centered_moments",
            "missingValues": "exclude_nonfinite_per_location",
            "sdDenominator": "valid_count_minus_one",
            "analysisUnit": "input_observation",
        },
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
        // v2 invalidates float32/global-denominator reductions from v1.
        version: 2,
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
        "reductionSemantics": {
            "accumulation": "float64_centered_moments",
            "missingValues": "exclude_nonfinite_per_location",
            "analysisUnit": "input_observation",
            "zscore": "descriptive_population_standardization_ddof_0",
            "degenerateZscore": "unavailable",
        },
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
    ctx: &CompareContext,
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

    let stats = ctx.stats(&candidate_paths, &|path, actual, expected| {
        format!(
            "Cohort member {} has dims {:?}, expected {:?}.",
            path, actual, expected
        )
    })?;
    let mean_data = (0..stats.moments.len())
        .map(|index| summary_to_f32(stats.moments.mean(index)))
        .collect::<Result<Vec<_>, _>>()?;
    let dims = &stats.dims;
    let reference_source_path = stats.reference_path.as_str();
    write_f32_nifti(
        &cache_plan.output_path,
        dims,
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
    ctx: &CompareContext,
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

    let member = ctx.volume(member_source_path)?;
    // The cohort mean as the cached artifact stores it (f32): from the member
    // set's moments when they are already in memory, else the artifact itself.
    let (cohort_values, cohort_affine, cohort_dims) =
        match compare_inputs::cached_stats(&cohort_paths) {
            Some(stats) => (
                Arc::new(
                    (0..stats.moments.len())
                        .map(|index| summary_to_f32(stats.moments.mean(index)))
                        .collect::<Result<Vec<_>, _>>()?,
                ),
                stats.affine.clone(),
                stats.dims.clone(),
            ),
            None => {
                let mean = decode_volume(cohort_mean_path, &NoDecodedVolumes).map_err(|error| {
                    format!(
                        "Failed to load cached cohort mean {}: {}",
                        cohort_mean_path, error
                    )
                })?;
                (mean.values, mean.affine, mean.dims)
            }
        };

    validate_grid_affines(&member.affine, &cohort_affine)?;
    let (member_values, member_dims) = (&member.values, &member.dims);
    if *member_dims != cohort_dims {
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
        member_dims,
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
    ctx: &CompareContext,
) -> Result<StudioCompareMaterializationRecord, String> {
    let member_source_path = request
        .active_member_source_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .ok_or_else(|| "No active member source path was provided.".to_string())?;
    // Z-scores reduce the members directly; the mean artifact must exist.
    cohort_mean_path
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

    let member = ctx.volume(member_source_path)?;
    let stats = ctx.stats(&cohort_paths, &|path, actual, expected| {
        format!(
            "Cohort variance input {} has dims {:?}, expected {:?}.",
            path, actual, expected
        )
    })?;
    validate_grid_affines(&member.affine, &stats.affine)
        .map_err(|error| format!("{} ({})", error, stats.reference_path))?;
    let (member_values, member_dims) = (&member.values, &member.dims);
    if *member_dims != stats.dims {
        return Err(format!(
            "Z-score inputs have mismatched dims {:?} vs {:?}.",
            member_dims, stats.dims
        ));
    }

    let zscore_data: Vec<f32> = member_values
        .iter()
        .enumerate()
        .map(|(index, member)| {
            let value = match (
                stats.moments.mean(index),
                stats.moments.population_sd(index),
            ) {
                (Some(mean), Some(sd)) if member.is_finite() && sd > 0.0 => {
                    Some((f64::from(*member) - mean) / sd)
                }
                _ => None,
            };
            summary_to_f32(value)
        })
        .collect::<Result<Vec<_>, _>>()?;
    write_f32_nifti(
        &cache_plan.output_path,
        member_dims,
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

#[cfg(test)]
mod compare_tests;

#[cfg(test)]
mod population_reducers {
    use super::{mean_values, sd_values, validate_grid_affines};

    #[test]
    fn world_affines_must_be_finite_and_nonsingular() {
        let identity = [
            1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
        ];
        assert!(validate_grid_affines(&identity, &identity).is_ok());
        let mut flipped = identity;
        flipped[0] = -1.0;
        assert!(validate_grid_affines(&flipped, &flipped).is_ok());
        assert!(validate_grid_affines(&identity, &flipped).is_err());
        let mut singular = identity;
        singular[0] = 0.0;
        assert!(validate_grid_affines(&singular, &singular).is_err());
        let mut invalid = identity;
        invalid[12] = f32::NAN;
        assert!(validate_grid_affines(&invalid, &invalid).is_err());
    }

    /// The same rule as the grid audit and Population sampling
    /// (`nifti_loader::affines_match`): an origin one f32 step away is the
    /// same frame, a voxel axis 1.2e-5 away is not.
    #[test]
    fn world_affines_are_compared_as_the_grid_audit_compares_them() {
        // Column-major: 12..15 is the origin.
        let mut reference: [f32; 16] = [
            2.0, 0.0, 0.0, 0.0, 0.0, 2.0, 0.0, 0.0, 0.0, 0.0, 2.0, 0.0, -96.0, -132.0, -78.0, 1.0,
        ];
        let mut stepped = reference;
        stepped[13] = f32::from_bits(reference[13].to_bits() + 1);
        assert!((stepped[13] - reference[13]).abs() > 1e-5);
        assert!(validate_grid_affines(&reference, &stepped).is_ok());
        let mut moved = reference;
        moved[13] += 1.2e-3;
        assert!(validate_grid_affines(&reference, &moved).is_err());
        reference[12] = 0.0;
        let mut turned = reference;
        turned[4] += 1.2e-5;
        assert!(validate_grid_affines(&reference, &turned).is_err());
    }

    #[test]
    fn mean_uses_local_coverage_and_preserves_measured_zero() {
        let values = mean_values(&[
            vec![1.0, f32::NAN, 0.0, f32::INFINITY],
            vec![3.0, 5.0, f32::NAN, f32::NAN],
        ])
        .unwrap();
        assert_eq!(&values[..3], &[2.0, 5.0, 0.0]);
        assert!(values[3].is_nan());
    }

    #[test]
    fn spread_is_sample_sd_with_local_degrees_of_freedom() {
        let values = sd_values(&[vec![1.0, 5.0], vec![3.0, f32::NAN]]).unwrap();
        assert!((values[0] - 2.0f32.sqrt()).abs() < 1e-6);
        assert!(values[1].is_nan());
    }

    #[test]
    fn finite_inputs_do_not_overflow_float32_accumulation() {
        let values = mean_values(&[vec![f32::MAX], vec![f32::MAX]]).unwrap();
        assert_eq!(values, vec![f32::MAX]);
        let values = sd_values(&[vec![-1e30], vec![1e30]]).unwrap();
        let expected = 2.0f64.sqrt() * f64::from(1e30f32);
        assert!((f64::from(values[0]) / expected - 1.0).abs() < 1e-6);
        // This valid f64 sample SD cannot be represented by the output format.
        assert!(sd_values(&[vec![-f32::MAX], vec![f32::MAX]]).is_err());
    }
}
