use bridge_types::{
    SpatialFieldSetSummary, StudioAlignmentClass, StudioAuditSeverity, StudioCohortOriginKind,
    StudioCohortSummary, StudioCompareBindingKind, StudioCompareMaterializeRequest, StudioComparePaneBinding,
    StudioComparePaneSpec, StudioComparePaneStatus, StudioDesignRowPreview,
    StudioDesignTablePreview, StudioExpressionKind, StudioFeatureSummary,
    StudioFieldExpressionSummary, StudioImportCandidate, StudioImportMode,
    StudioImportPreviewRequest, StudioIngestAuditSummary, StudioJoinAuditSummary,
    StudioJoinIssueDetail,
    StudioMaterializationStatus, StudioMemberSummary, StudioSupportAuditSummary,
    StudioSupportKind,
};
use csv::ReaderBuilder;
use ndarray::ShapeBuilder;
use nifti::{writer::WriterOptions, NiftiObject, ReaderOptions};
use regex::Regex;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use walkdir::WalkDir;

pub fn preview_import_candidates(request: StudioImportPreviewRequest) -> Vec<StudioImportCandidate> {
    match request.mode {
        StudioImportMode::Manifest => vec![manifest_candidate(&request)],
        StudioImportMode::Regex => vec![regex_candidate(&request)],
        StudioImportMode::Table => vec![table_candidate(&request)],
    }
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
    let cohort_mean_live_path = cohort_mean_materialization.as_ref().ok().cloned();
    let cohort_mean_ready = cohort_mean_live_path.is_some();
    let cohort_mean_reason = match &cohort_mean_materialization {
        Ok(path) => format!("Derived cohort mean is cached at {}.", path),
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
    let residual_live_path = residual_materialization.as_ref().ok().cloned();
    let residual_ready = residual_live_path.is_some();
    let residual_reason = match &residual_materialization {
        Ok(path) => format!("Derived residual is cached at {}.", path),
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
    let zscore_live_path = zscore_materialization.as_ref().ok().cloned();
    let zscore_ready = zscore_live_path.is_some();
    let zscore_reason = match &zscore_materialization {
        Ok(path) => format!("Derived z-score is cached at {}.", path),
        Err(message) => {
            if cohort_selected && request.compare_ready && request.active_expression_recipe.is_some()
            {
                format!("Z-score materialization failed: {}", message)
            } else {
                "Needs an active comparison expression and compare-safe cohort.".to_string()
            }
        }
    };

    vec![
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
            } else if cohort_selected && request.compare_ready {
                StudioComparePaneStatus::Blocked
            } else {
                StudioComparePaneStatus::Blocked
            },
            reason: cohort_mean_reason,
            recipe: request
                .compare_cohort_id
                .as_ref()
                .map(|cohort_id| format!("mean(cohort:{})", cohort_id)),
            binding: Some(StudioComparePaneBinding {
                kind: StudioCompareBindingKind::DerivedField,
                ready: cohort_mean_ready,
                source_path: cohort_mean_live_path,
                materialization_key: cohort_mean_key,
                materialized_at_ms: cohort_mean_materialization
                    .as_ref()
                    .ok()
                    .and_then(|path| file_modified_ms(path)),
            }),
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
                (Some(member_id), Some(cohort_id)) => {
                    Some(format!("residual(member:{}, cohort:{})", member_id, cohort_id))
                }
                _ => None,
            },
            binding: Some(StudioComparePaneBinding {
                kind: StudioCompareBindingKind::DerivedField,
                ready: residual_ready,
                source_path: residual_live_path,
                materialization_key: residual_key,
                materialized_at_ms: residual_materialization
                    .as_ref()
                    .ok()
                    .and_then(|path| file_modified_ms(path)),
            }),
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
            binding: Some(StudioComparePaneBinding {
                kind: StudioCompareBindingKind::DerivedField,
                ready: zscore_ready,
                source_path: zscore_live_path,
                materialization_key: zscore_key,
                materialized_at_ms: zscore_materialization
                    .as_ref()
                    .ok()
                    .and_then(|path| file_modified_ms(path)),
            }),
        },
    ]
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

fn materialize_cohort_mean(
    request: &StudioCompareMaterializeRequest,
    materialization_key: Option<&str>,
) -> Result<String, String> {
    let candidate_paths: Vec<&str> = request
        .cohort_member_source_paths
        .iter()
        .map(|path| path.trim())
        .filter(|path| !path.is_empty())
        .collect();
    if candidate_paths.is_empty() {
        return Err("No cohort member source paths were provided.".to_string());
    }

    let materialization_key = materialization_key
        .ok_or_else(|| "No materialization key was computed for the cohort mean.".to_string())?;
    let output_path = studio_cache_root()
        .map_err(|error| format!("Failed to prepare Studio cache directory: {}", error))?
        .join(format!("{}.nii.gz", materialization_key));

    if output_path.exists() && !request.force_rematerialize {
        return Ok(output_path.to_string_lossy().into_owned());
    }

    let mut sum_data: Option<Vec<f32>> = None;
    let mut dims: Option<Vec<usize>> = None;
    let mut reference_source_path: Option<&str> = None;
    let mut used_paths = 0usize;

    for source_path in candidate_paths {
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
                reference_source_path = Some(source_path);
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
    let reference_source_path =
        reference_source_path.ok_or_else(|| "Missing reference source path for cohort mean.".to_string())?;
    write_f32_nifti(&output_path, &dims, reference_source_path, &mean_data)
        .map_err(|error| format!("Failed to write cohort mean NIfTI: {}", error))?;

    Ok(output_path.to_string_lossy().into_owned())
}

fn materialize_residual(
    request: &StudioCompareMaterializeRequest,
    materialization_key: Option<&str>,
    cohort_mean_path: Option<&str>,
) -> Result<String, String> {
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
    let output_path = studio_cache_root()
        .map_err(|error| format!("Failed to prepare Studio cache directory: {}", error))?
        .join(format!("{}.nii.gz", materialization_key));

    if output_path.exists() && !request.force_rematerialize {
        return Ok(output_path.to_string_lossy().into_owned());
    }

    let (member_volume, _member_affine) =
        nifti_loader::load_nifti_volume_auto(Path::new(member_source_path))
            .map_err(|error| format!("Failed to load member source {}: {}", member_source_path, error))?;
    let (cohort_mean_volume, _mean_affine) =
        nifti_loader::load_nifti_volume_auto(Path::new(cohort_mean_path))
            .map_err(|error| format!("Failed to load cached cohort mean {}: {}", cohort_mean_path, error))?;

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
    write_f32_nifti(&output_path, &member_dims, member_source_path, &residual_data)
        .map_err(|error| format!("Failed to write residual NIfTI: {}", error))?;

    Ok(output_path.to_string_lossy().into_owned())
}

fn materialize_zscore(
    request: &StudioCompareMaterializeRequest,
    materialization_key: Option<&str>,
    cohort_mean_path: Option<&str>,
) -> Result<String, String> {
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
    let output_path = studio_cache_root()
        .map_err(|error| format!("Failed to prepare Studio cache directory: {}", error))?
        .join(format!("{}.nii.gz", materialization_key));

    if output_path.exists() && !request.force_rematerialize {
        return Ok(output_path.to_string_lossy().into_owned());
    }

    let cohort_paths: Vec<&str> = request
        .cohort_member_source_paths
        .iter()
        .map(|path| path.trim())
        .filter(|path| !path.is_empty())
        .collect();
    if cohort_paths.is_empty() {
        return Err("No cohort member source paths were provided.".to_string());
    }

    let (member_volume, _member_affine) =
        nifti_loader::load_nifti_volume_auto(Path::new(member_source_path))
            .map_err(|error| format!("Failed to load member source {}: {}", member_source_path, error))?;
    let (cohort_mean_volume, _mean_affine) =
        nifti_loader::load_nifti_volume_auto(Path::new(cohort_mean_path))
            .map_err(|error| format!("Failed to load cached cohort mean {}: {}", cohort_mean_path, error))?;

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
    for cohort_path in cohort_paths {
        let (cohort_volume, _cohort_affine) =
            nifti_loader::load_nifti_volume_auto(Path::new(cohort_path))
                .map_err(|error| format!("Failed to load cohort member {}: {}", cohort_path, error))?;
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
    write_f32_nifti(&output_path, &member_dims, member_source_path, &zscore_data)
        .map_err(|error| format!("Failed to write z-score NIfTI: {}", error))?;

    Ok(output_path.to_string_lossy().into_owned())
}

fn studio_cache_root() -> Result<PathBuf, std::io::Error> {
    let root = std::env::temp_dir().join("brainflow_set_studio_cache");
    fs::create_dir_all(&root)?;
    Ok(root)
}

fn extract_volume_values(
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
        _ => Err("Only 3D NIfTI volumes are currently supported for cohort mean materialization.".to_string()),
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

fn manifest_candidate(request: &StudioImportPreviewRequest) -> StudioImportCandidate {
    let manifest_path = request
        .manifest_path
        .clone()
        .unwrap_or_else(|| "/data/studyA/studyA.nftab.yaml".to_string());

    match inspect_manifest_preview(&manifest_path) {
        Ok(preview) => StudioImportCandidate {
            id: "candidate-manifest-a".to_string(),
            label: "NFTab manifest preview".to_string(),
            description: preview.description,
            mode: StudioImportMode::Manifest,
            source_hint: manifest_path,
            set: preview.set,
            features: preview.features,
            cohorts: preview.cohorts,
            expressions: preview.expressions,
            materialization: Some(StudioMaterializationStatus {
                warm: 2,
                preview: 1,
                pending: 0,
                failed: 0,
            }),
        },
        Err(message) => manifest_fallback_candidate(&manifest_path, &message),
    }
}

fn manifest_fallback_candidate(manifest_path: &str, message: &str) -> StudioImportCandidate {
    let manifest_name = Path::new(manifest_path)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("Manifest Import");

    StudioImportCandidate {
        id: "candidate-manifest-a".to_string(),
        label: "NFTab manifest preview".to_string(),
        description: "Manifest preview fell back to seeded assumptions.".to_string(),
        mode: StudioImportMode::Manifest,
        source_hint: manifest_path.to_string(),
        set: SpatialFieldSetSummary {
            id: "study-manifest-preview".to_string(),
            name: format!("{} / Manifest Import", manifest_name),
            member_count: 36,
            primary_feature_id: Some("tstat".to_string()),
            support_kind: StudioSupportKind::Volume,
            support_label: "MNI152 2mm template".to_string(),
            alignment_class: StudioAlignmentClass::SameGrid,
            design_columns: vec![
                "subject".to_string(),
                "diagnosis".to_string(),
                "sex".to_string(),
                "age_band".to_string(),
                "site".to_string(),
            ],
            design_table_preview: Some(StudioDesignTablePreview {
                columns: vec![
                    "subject".to_string(),
                    "diagnosis".to_string(),
                    "sex".to_string(),
                    "age_band".to_string(),
                ],
                rows: vec![
                    StudioDesignRowPreview {
                        id: "sub101".to_string(),
                        cells: vec![
                            "sub101".to_string(),
                            "control".to_string(),
                            "F".to_string(),
                            "20-29".to_string(),
                        ],
                    },
                    StudioDesignRowPreview {
                        id: "sub102".to_string(),
                        cells: vec![
                            "sub102".to_string(),
                            "control".to_string(),
                            "M".to_string(),
                            "30-39".to_string(),
                        ],
                    },
                ],
            }),
            member_summaries: vec![
                StudioMemberSummary {
                    id: "sub101".to_string(),
                    source_path: None,
                },
                StudioMemberSummary {
                    id: "sub102".to_string(),
                    source_path: None,
                },
                StudioMemberSummary {
                    id: "sub103".to_string(),
                    source_path: None,
                },
                StudioMemberSummary {
                    id: "sub104".to_string(),
                    source_path: None,
                },
                StudioMemberSummary {
                    id: "sub105".to_string(),
                    source_path: None,
                },
                StudioMemberSummary {
                    id: "sub106".to_string(),
                    source_path: None,
                },
            ],
            member_ids: vec![
                "sub101".to_string(),
                "sub102".to_string(),
                "sub103".to_string(),
                "sub104".to_string(),
                "sub105".to_string(),
                "sub106".to_string(),
            ],
            saved_cohort_ids: vec!["all-members".to_string()],
            ingest_audit: StudioIngestAuditSummary {
                source_label: "NFTab manifest".to_string(),
            join: StudioJoinAuditSummary {
                matched_rows: 36,
                unmatched_rows: 1,
                duplicate_keys: 0,
                severity: StudioAuditSeverity::Warning,
                issue_details: vec![StudioJoinIssueDetail {
                    message: message.to_string(),
                    member_ids: Vec::new(),
                }],
            },
                support: StudioSupportAuditSummary {
                    support_label: "MNI152 2mm template".to_string(),
                    alignment_class: StudioAlignmentClass::SameGrid,
                    ready_for_compare: false,
                    severity: StudioAuditSeverity::Warning,
                },
                notes: vec![
                    message.to_string(),
                    "Preview fell back to seeded candidate values so the workflow stays usable."
                        .to_string(),
                ],
            },
        },
        features: vec![StudioFeatureSummary {
            id: "tstat".to_string(),
            label: "T Statistic".to_string(),
            kind: StudioSupportKind::Volume,
        }],
        cohorts: vec![StudioCohortSummary {
            id: "all-members".to_string(),
            label: "All members".to_string(),
            member_count: 36,
            description: "Fallback cohort spanning all manifest rows.".to_string(),
            member_ids: vec![
                "sub101".to_string(),
                "sub102".to_string(),
                "sub103".to_string(),
                "sub104".to_string(),
                "sub105".to_string(),
                "sub106".to_string(),
            ],
            origin_kind: StudioCohortOriginKind::Imported,
            origin_label: Some("Fallback manifest preview".to_string()),
        }],
        expressions: vec![
            StudioFieldExpressionSummary {
                id: "manifest-member".to_string(),
                label: "Current member".to_string(),
                kind: StudioExpressionKind::Member,
                recipe: "member(sample)".to_string(),
                cohort_id: None,
            },
            StudioFieldExpressionSummary {
                id: "manifest-compare-zscore".to_string(),
                label: "Z-score vs all members".to_string(),
                kind: StudioExpressionKind::Comparison,
                recipe: "zscore(current, cohort:all-members)".to_string(),
                cohort_id: Some("all-members".to_string()),
            },
        ],
        materialization: Some(StudioMaterializationStatus {
            warm: 2,
            preview: 1,
            pending: 0,
            failed: 0,
        }),
    }
}

fn regex_candidate(request: &StudioImportPreviewRequest) -> StudioImportCandidate {
    let discovery_root = request
        .discovery_root
        .clone()
        .unwrap_or_else(|| ".".to_string());
    let file_pattern = request
        .file_pattern
        .clone()
        .unwrap_or_else(|| String::from(r".*_statmap\.nii(\.gz)?$"));
    let regex = Regex::new(&file_pattern).ok();
    let root_exists = Path::new(&discovery_root).exists();
    let matched_paths = discover_matching_files(&discovery_root, regex.as_ref(), 24);
    let matched_files = matched_paths.len();
    let matched_rows = if matched_files > 0 { matched_files } else { 28 };
    let unmatched_rows = if matched_files > 0 { matched_files.min(3) } else { 0 };
    let duplicate_keys = if matched_files > 8 { 1 } else { 0 };
    let severity = if root_exists && regex.is_some() {
        if duplicate_keys > 0 || unmatched_rows > 0 {
            StudioAuditSeverity::Warning
        } else {
            StudioAuditSeverity::Ok
        }
    } else {
        StudioAuditSeverity::Error
    };

    let regex_member_summaries = if matched_paths.is_empty() {
        vec![
            StudioMemberSummary {
                id: "sub201".to_string(),
                source_path: None,
            },
            StudioMemberSummary {
                id: "sub202".to_string(),
                source_path: None,
            },
            StudioMemberSummary {
                id: "sub203".to_string(),
                source_path: None,
            },
            StudioMemberSummary {
                id: "sub204".to_string(),
                source_path: None,
            },
            StudioMemberSummary {
                id: "sub205".to_string(),
                source_path: None,
            },
            StudioMemberSummary {
                id: "sub206".to_string(),
                source_path: None,
            },
        ]
    } else {
        matched_paths
            .iter()
            .enumerate()
            .map(|(index, path)| StudioMemberSummary {
                id: derive_member_id_from_path(path, index),
                source_path: Some(path.clone()),
            })
            .collect()
    };
    let regex_member_ids: Vec<String> = regex_member_summaries
        .iter()
        .map(|member| member.id.clone())
        .collect();
    let regex_preview_rows: Vec<StudioDesignRowPreview> = regex_member_summaries
        .iter()
        .take(6)
        .map(|member| StudioDesignRowPreview {
            id: member.id.clone(),
            cells: vec![
                member.id.clone(),
                if member.id.contains("case") { "case" } else { "control" }.to_string(),
                format!("ses-{:02}", (regex_member_ids.iter().position(|id| id == &member.id).unwrap_or(0) % 2) + 1),
                "site-b".to_string(),
            ],
        })
        .collect();

    StudioImportCandidate {
        id: "candidate-regex-b".to_string(),
        label: "Regex discovery preview".to_string(),
        description: if root_exists && regex.is_some() {
            format!(
                "Discovered {} files beneath {} using the requested pattern.",
                matched_files, discovery_root
            )
        } else if !root_exists {
            format!(
                "Discovery root {} does not exist; using fallback discovery preview.",
                discovery_root
            )
        } else {
            "Regex pattern could not be compiled; using fallback discovery preview.".to_string()
        },
        mode: StudioImportMode::Regex,
        source_hint: format!("root={} pattern={}", discovery_root, file_pattern),
        set: SpatialFieldSetSummary {
            id: "study-regex-preview".to_string(),
            name: "Discovery Import / Site B".to_string(),
            member_count: matched_rows,
            primary_feature_id: Some("statmap".to_string()),
            support_kind: StudioSupportKind::Volume,
            support_label: "MNI152 3mm template".to_string(),
            alignment_class: StudioAlignmentClass::SameSpace,
            design_columns: vec![
                "subject".to_string(),
                "diagnosis".to_string(),
                "session".to_string(),
                "site".to_string(),
            ],
            design_table_preview: Some(StudioDesignTablePreview {
                columns: vec![
                    "subject".to_string(),
                    "diagnosis".to_string(),
                    "session".to_string(),
                    "site".to_string(),
                ],
                rows: regex_preview_rows,
            }),
            member_summaries: regex_member_summaries,
            member_ids: regex_member_ids.clone(),
            saved_cohort_ids: vec!["all-members".to_string()],
            ingest_audit: StudioIngestAuditSummary {
                source_label: "Regex discovery".to_string(),
                join: StudioJoinAuditSummary {
                    matched_rows,
                    unmatched_rows,
                    duplicate_keys,
                    severity: severity.clone(),
                    issue_details: build_regex_issue_details(
                        root_exists,
                        regex.is_some(),
                        matched_files,
                        unmatched_rows,
                        duplicate_keys,
                    ),
                },
                support: StudioSupportAuditSummary {
                    support_label: "MNI152 3mm template".to_string(),
                    alignment_class: StudioAlignmentClass::SameSpace,
                    ready_for_compare: root_exists && regex.is_some() && duplicate_keys == 0,
                    severity,
                },
                notes: discovery_notes(root_exists, regex.is_some(), matched_files, duplicate_keys),
            },
        },
        features: vec![StudioFeatureSummary {
            id: "statmap".to_string(),
            label: "Stat Map".to_string(),
            kind: StudioSupportKind::Volume,
        }],
        cohorts: vec![StudioCohortSummary {
            id: "all-members".to_string(),
            label: "All members".to_string(),
            member_count: matched_rows,
            description: "Discovery-backed cohort spanning all matched files.".to_string(),
            member_ids: regex_member_ids.clone(),
            origin_kind: StudioCohortOriginKind::Imported,
            origin_label: Some("Regex discovery preview".to_string()),
        }],
        expressions: vec![StudioFieldExpressionSummary {
            id: "regex-member".to_string(),
            label: "Current member".to_string(),
            kind: StudioExpressionKind::Member,
            recipe: "member(sample)".to_string(),
            cohort_id: None,
        }],
        materialization: Some(StudioMaterializationStatus {
            warm: 1,
            preview: 2,
            pending: 0,
            failed: 0,
        }),
    }
}

#[derive(Clone, Debug, PartialEq)]
struct TableSupportSignature {
    dims: [usize; 3],
    voxel_sizes: [f32; 3],
}

fn table_candidate(request: &StudioImportPreviewRequest) -> StudioImportCandidate {
    let headers = request.table_headers.clone().unwrap_or_default();
    let rows = request.table_rows.clone().unwrap_or_default();
    let source_label = request
        .table_source_label
        .clone()
        .unwrap_or_else(|| "Table import".to_string());
    let file_column = request.table_file_path_column.clone().unwrap_or_default();
    let subject_column = request.table_subject_id_column.clone().unwrap_or_default();
    let excluded_columns: HashSet<String> = request
        .table_excluded_columns
        .clone()
        .unwrap_or_default()
        .into_iter()
        .collect();

    let file_col_idx = headers.iter().position(|header| header == &file_column);
    let subject_col_idx = headers.iter().position(|header| header == &subject_column);

    if headers.is_empty() || rows.is_empty() || file_col_idx.is_none() || subject_col_idx.is_none() {
        return StudioImportCandidate {
            id: "candidate-table-preview".to_string(),
            label: "Table import preview".to_string(),
            description: "The table preview is incomplete; map the file path and subject ID columns first."
                .to_string(),
            mode: StudioImportMode::Table,
            source_hint: source_label.clone(),
            set: SpatialFieldSetSummary {
                id: "table-import-preview".to_string(),
                name: source_label.clone(),
                member_count: 0,
                primary_feature_id: Some("feature-statmap".to_string()),
                support_kind: StudioSupportKind::Volume,
                support_label: "unknown (pending validation)".to_string(),
                alignment_class: StudioAlignmentClass::Unknown,
                design_columns: Vec::new(),
                design_table_preview: None,
                member_summaries: Vec::new(),
                member_ids: Vec::new(),
                saved_cohort_ids: Vec::new(),
                ingest_audit: StudioIngestAuditSummary {
                    source_label: source_label.clone(),
                    join: StudioJoinAuditSummary {
                        matched_rows: 0,
                        unmatched_rows: 0,
                        duplicate_keys: 0,
                        severity: StudioAuditSeverity::Error,
                        issue_details: vec![StudioJoinIssueDetail {
                            message: "File path and subject ID columns must be mapped before preview."
                                .to_string(),
                            member_ids: Vec::new(),
                        }],
                    },
                    support: StudioSupportAuditSummary {
                        support_label: "unknown (pending validation)".to_string(),
                        alignment_class: StudioAlignmentClass::Unknown,
                        ready_for_compare: false,
                        severity: StudioAuditSeverity::Error,
                    },
                    notes: vec!["Map the table columns to continue.".to_string()],
                },
            },
            features: vec![StudioFeatureSummary {
                id: "feature-statmap".to_string(),
                label: "Stat Map".to_string(),
                kind: StudioSupportKind::Volume,
            }],
            cohorts: Vec::new(),
            expressions: vec![StudioFieldExpressionSummary {
                id: "table-deck-member".to_string(),
                label: "Active member".to_string(),
                kind: StudioExpressionKind::Member,
                recipe: "member(current)".to_string(),
                cohort_id: None,
            }],
            materialization: Some(StudioMaterializationStatus {
                warm: 0,
                preview: 0,
                pending: 0,
                failed: 0,
            }),
        };
    }

    let file_col_idx = file_col_idx.unwrap();
    let subject_col_idx = subject_col_idx.unwrap();
    let design_columns: Vec<String> = headers
        .iter()
        .enumerate()
        .filter(|(index, header)| {
            *index != file_col_idx && *index != subject_col_idx && !excluded_columns.contains(*header)
        })
        .map(|(_, header)| header.clone())
        .collect();
    let preview_columns = std::iter::once(headers[subject_col_idx].clone())
        .chain(design_columns.iter().take(3).cloned())
        .collect::<Vec<_>>();
    let preview_rows = rows
        .iter()
        .take(5)
        .enumerate()
        .map(|(row_index, row)| StudioDesignRowPreview {
            id: row
                .get(subject_col_idx)
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
                .unwrap_or_else(|| format!("row-{}", row_index + 1)),
            cells: preview_columns
                .iter()
                .map(|column| {
                    headers
                        .iter()
                        .position(|header| header == column)
                        .and_then(|index| row.get(index))
                        .cloned()
                        .unwrap_or_default()
                })
                .collect(),
        })
        .collect::<Vec<_>>();

    let row_details = rows
        .iter()
        .map(|row| TableRowDetail {
            subject_id: row
                .get(subject_col_idx)
                .map(|value| value.trim())
                .unwrap_or("")
                .to_string(),
            source_path: row
                .get(file_col_idx)
                .map(|value| value.trim())
                .unwrap_or("")
                .to_string(),
        })
        .collect::<Vec<_>>();
    let mut subject_counts = HashMap::new();
    for detail in &row_details {
        if !detail.subject_id.is_empty() {
            *subject_counts.entry(detail.subject_id.clone()).or_insert(0usize) += 1;
        }
    }
    let duplicate_subject_ids = subject_counts
        .iter()
        .filter_map(|(subject_id, count)| if *count > 1 { Some(subject_id.clone()) } else { None })
        .collect::<Vec<_>>();
    let duplicate_subject_set = duplicate_subject_ids.iter().cloned().collect::<HashSet<_>>();
    let missing_subject_rows = row_details
        .iter()
        .filter(|detail| detail.subject_id.is_empty())
        .count();
    let missing_path_subjects = row_details
        .iter()
        .filter(|detail| !detail.subject_id.is_empty() && detail.source_path.is_empty())
        .map(|detail| detail.subject_id.clone())
        .collect::<Vec<_>>();

    let candidate_rows = row_details
        .iter()
        .filter(|detail| {
            !detail.subject_id.is_empty()
                && !detail.source_path.is_empty()
                && !duplicate_subject_set.contains(&detail.subject_id)
        })
        .cloned()
        .collect::<Vec<_>>();

    let mut member_summaries = Vec::new();
    let mut missing_files = Vec::new();
    let mut invalid_files = Vec::new();
    let mut support_mismatch_subjects = Vec::new();
    let mut support_signature: Option<TableSupportSignature> = None;

    for detail in &candidate_rows {
        let source_path = PathBuf::from(&detail.source_path);
        if !source_path.exists() {
            missing_files.push(detail.subject_id.clone());
            continue;
        }

        match inspect_table_volume_support(&source_path) {
            Ok(signature) => {
                if let Some(existing_signature) = &support_signature {
                    if existing_signature != &signature {
                        support_mismatch_subjects.push(detail.subject_id.clone());
                        continue;
                    }
                } else {
                    support_signature = Some(signature);
                }

                member_summaries.push(StudioMemberSummary {
                    id: detail.subject_id.clone(),
                    source_path: Some(detail.source_path.clone()),
                });
            }
            Err(_) => invalid_files.push(detail.subject_id.clone()),
        }
    }

    let member_ids = member_summaries
        .iter()
        .map(|member| member.id.clone())
        .collect::<Vec<_>>();
    let duplicate_keys = row_details
        .iter()
        .filter(|detail| !detail.subject_id.is_empty() && duplicate_subject_set.contains(&detail.subject_id))
        .count();
    let unmatched_rows = rows.len().saturating_sub(member_summaries.len());
    let mut issue_details = Vec::new();
    if missing_subject_rows > 0 {
        issue_details.push(StudioJoinIssueDetail {
            message: format!("{} row(s) are missing subject IDs.", missing_subject_rows),
            member_ids: Vec::new(),
        });
    }
    if !missing_path_subjects.is_empty() {
        issue_details.push(StudioJoinIssueDetail {
            message: format!(
                "{} row(s) are missing file paths.",
                missing_path_subjects.len()
            ),
            member_ids: missing_path_subjects.clone(),
        });
    }
    if !duplicate_subject_ids.is_empty() {
        issue_details.push(StudioJoinIssueDetail {
            message: format!(
                "Duplicate subject IDs detected: {}.",
                duplicate_subject_ids.join(", ")
            ),
            member_ids: duplicate_subject_ids.clone(),
        });
    }
    if !missing_files.is_empty() {
        issue_details.push(StudioJoinIssueDetail {
            message: format!("{} file path(s) do not exist on disk.", missing_files.len()),
            member_ids: missing_files.clone(),
        });
    }
    if !invalid_files.is_empty() {
        issue_details.push(StudioJoinIssueDetail {
            message: format!(
                "{} file(s) could not be read as supported NIfTI volumes.",
                invalid_files.len()
            ),
            member_ids: invalid_files.clone(),
        });
    }

    let support_label = support_signature
        .as_ref()
        .map(|signature| {
            format!(
                "{}×{}×{} voxels · {:.2}×{:.2}×{:.2} mm",
                signature.dims[0],
                signature.dims[1],
                signature.dims[2],
                signature.voxel_sizes[0],
                signature.voxel_sizes[1],
                signature.voxel_sizes[2]
            )
        })
        .unwrap_or_else(|| "unknown (pending validation)".to_string());
    let alignment_class = if support_signature.is_some() && support_mismatch_subjects.is_empty() {
        StudioAlignmentClass::SameGrid
    } else if support_signature.is_some() {
        StudioAlignmentClass::Mixed
    } else {
        StudioAlignmentClass::Unknown
    };
    let support_severity = if member_summaries.is_empty() {
        StudioAuditSeverity::Error
    } else if support_mismatch_subjects.is_empty() {
        StudioAuditSeverity::Ok
    } else {
        StudioAuditSeverity::Warning
    };
    let join_severity = if member_summaries.is_empty() {
        StudioAuditSeverity::Error
    } else if issue_details.is_empty() {
        StudioAuditSeverity::Ok
    } else {
        StudioAuditSeverity::Warning
    };
    let ready_for_compare = !member_summaries.is_empty()
        && issue_details.is_empty()
        && support_mismatch_subjects.is_empty();
    let mut notes = vec![format!(
        "{} design column(s): {}",
        design_columns.len(),
        if design_columns.is_empty() {
            "none".to_string()
        } else {
            design_columns.join(", ")
        }
    )];
    if !ready_for_compare {
        notes.push("File paths and NIfTI support need cleanup before compare-safe reductions."
            .to_string());
    } else {
        notes.push("All validated rows resolve to same-grid NIfTI volumes.".to_string());
    }
    if !support_mismatch_subjects.is_empty() {
        notes.push(format!(
            "Support mismatch detected for {} member(s): {}.",
            support_mismatch_subjects.len(),
            support_mismatch_subjects.join(", ")
        ));
    }

    let generated_cohorts = if member_ids.is_empty() {
        Vec::new()
    } else {
        vec![StudioCohortSummary {
            id: "table-all-members".to_string(),
            label: "All members".to_string(),
            member_count: member_ids.len(),
            description: "All valid rows from the imported table.".to_string(),
            member_ids: member_ids.clone(),
            origin_kind: StudioCohortOriginKind::Imported,
            origin_label: Some(source_label.clone()),
        }]
    };
    let mut expressions = vec![StudioFieldExpressionSummary {
        id: "table-deck-member".to_string(),
        label: "Active member".to_string(),
        kind: StudioExpressionKind::Member,
        recipe: "member(current)".to_string(),
        cohort_id: None,
    }];
    if ready_for_compare && !generated_cohorts.is_empty() {
        expressions.push(StudioFieldExpressionSummary {
            id: "table-compare-zscore".to_string(),
            label: "Z-score vs all members".to_string(),
            kind: StudioExpressionKind::Comparison,
            recipe: "zscore(current, cohort:table-all-members)".to_string(),
            cohort_id: Some("table-all-members".to_string()),
        });
    }

    StudioImportCandidate {
        id: "candidate-table-preview".to_string(),
        label: format!("Table import ({})", source_label),
        description: if ready_for_compare {
            format!("Validated {} importable member files from the table.", member_ids.len())
        } else {
            format!(
                "Validated {} importable member files with {} audit issue(s).",
                member_ids.len(),
                issue_details.len()
            )
        },
        mode: StudioImportMode::Table,
        source_hint: source_label.clone(),
        set: SpatialFieldSetSummary {
            id: "table-import-preview".to_string(),
            name: Path::new(&source_label)
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("Table Import")
                .to_string(),
            member_count: member_ids.len(),
            primary_feature_id: Some("feature-statmap".to_string()),
            support_kind: StudioSupportKind::Volume,
            support_label: support_label.clone(),
            alignment_class: alignment_class.clone(),
            design_columns: design_columns.clone(),
            design_table_preview: Some(StudioDesignTablePreview {
                columns: preview_columns,
                rows: preview_rows,
            }),
            member_summaries,
            member_ids: member_ids.clone(),
            saved_cohort_ids: generated_cohorts
                .iter()
                .map(|cohort| cohort.id.clone())
                .collect(),
            ingest_audit: StudioIngestAuditSummary {
                source_label: source_label.clone(),
                join: StudioJoinAuditSummary {
                    matched_rows: member_ids.len(),
                    unmatched_rows,
                    duplicate_keys,
                    severity: join_severity,
                    issue_details,
                },
                support: StudioSupportAuditSummary {
                    support_label,
                    alignment_class,
                    ready_for_compare,
                    severity: support_severity,
                },
                notes,
            },
        },
        features: vec![StudioFeatureSummary {
            id: "feature-statmap".to_string(),
            label: "Stat Map".to_string(),
            kind: StudioSupportKind::Volume,
        }],
        cohorts: generated_cohorts,
        expressions,
        materialization: Some(StudioMaterializationStatus {
            warm: 0,
            preview: member_ids.len(),
            pending: 0,
            failed: unmatched_rows,
        }),
    }
}

#[derive(Clone, Debug)]
struct TableRowDetail {
    subject_id: String,
    source_path: String,
}

fn inspect_table_volume_support(path: &Path) -> Result<TableSupportSignature, String> {
    let object = ReaderOptions::new()
        .read_file(path)
        .map_err(|error| format!("{}: {}", path.display(), error))?;
    let header = object.header();
    let ndim = header.dim[0] as usize;
    if ndim < 3 {
        return Err(format!("{} is not a 3D volume.", path.display()));
    }
    if ndim >= 4 && header.dim[4] > 1 {
        return Err(format!(
            "{} is a 4D series; Studio table preview currently expects 3D members.",
            path.display()
        ));
    }

    Ok(TableSupportSignature {
        dims: [
            header.dim[1] as usize,
            header.dim[2] as usize,
            header.dim[3] as usize,
        ],
        voxel_sizes: [header.pixdim[1], header.pixdim[2], header.pixdim[3]],
    })
}

#[derive(Debug)]
struct ManifestPreview {
    description: String,
    set: SpatialFieldSetSummary,
    features: Vec<StudioFeatureSummary>,
    cohorts: Vec<StudioCohortSummary>,
    expressions: Vec<StudioFieldExpressionSummary>,
}

fn inspect_manifest_preview(manifest_path: &str) -> Result<ManifestPreview, String> {
    let manifest_file = Path::new(manifest_path);
    if !manifest_file.exists() {
        return Err(format!("Manifest path {} was not found on disk.", manifest_path));
    }

    let manifest_text = fs::read_to_string(manifest_file)
        .map_err(|error| format!("Failed to read manifest {}: {}", manifest_path, error))?;
    let manifest_value = parse_manifest_value(&manifest_text, manifest_file)?;

    let dataset_id = get_string(&manifest_value, "dataset_id")
        .unwrap_or_else(|| manifest_file.file_stem().and_then(|stem| stem.to_str()).unwrap_or("dataset").to_string());
    let primary_feature_id = get_string(&manifest_value, "primary_feature")
        .or_else(|| manifest_value.get("features").and_then(|features| features.as_object()).and_then(|map| map.keys().next().cloned()))
        .ok_or_else(|| "Manifest does not declare any features.".to_string())?;
    let feature_map = manifest_value
        .get("features")
        .and_then(|value| value.as_object())
        .ok_or_else(|| "Manifest features section is missing or invalid.".to_string())?;
    let primary_feature = feature_map
        .get(&primary_feature_id)
        .ok_or_else(|| format!("Primary feature {} was not found in features.", primary_feature_id))?;

    let feature_kind = primary_feature
        .get("logical")
        .and_then(|logical| logical.get("kind"))
        .and_then(Value::as_str)
        .unwrap_or("array");
    let support_ref = primary_feature
        .get("logical")
        .and_then(|logical| logical.get("support_ref"))
        .and_then(Value::as_str);

    let (support_kind, support_label, alignment_class, compare_ready, support_notes) =
        infer_support_summary(&manifest_value, primary_feature, support_ref);

    let observation_axes = get_string_array(&manifest_value, "observation_axes");
    let observation_columns = manifest_value
        .get("observation_columns")
        .and_then(Value::as_object)
        .ok_or_else(|| "Manifest observation_columns section is missing or invalid.".to_string())?;
    let row_id = get_string(&manifest_value, "row_id")
        .ok_or_else(|| "Manifest row_id is missing.".to_string())?;
    let mut design_columns = Vec::new();
    let mut seen_columns = HashSet::new();
    for axis in &observation_axes {
        if seen_columns.insert(axis.clone()) {
            design_columns.push(axis.clone());
        }
    }
    for column in observation_columns.keys() {
        if column == &row_id {
            continue;
        }
        if seen_columns.insert(column.clone()) {
            design_columns.push(column.clone());
        }
        if design_columns.len() >= 5 {
            break;
        }
    }

    let observation_table =
        inspect_observation_table(manifest_file, &manifest_value, &design_columns)?;
    let duplicate_keys = observation_table.duplicate_row_ids.max(observation_table.duplicate_axes);
    let unmatched_rows = observation_table.rows_missing_source_path;
    let join_severity = if duplicate_keys > 0 || observation_table.row_count == 0 || unmatched_rows > 0 {
        StudioAuditSeverity::Warning
    } else {
        StudioAuditSeverity::Ok
    };

    let mut notes = vec![
        format!(
            "Observation table preview loaded {} rows from {}.",
            observation_table.row_count, observation_table.table_path
        ),
        format!("Primary feature {} has logical kind {}.", primary_feature_id, feature_kind),
    ];
    notes.extend(support_notes);
    notes.extend(observation_table.notes);

    let feature_label = feature_map
        .get(&primary_feature_id)
        .and_then(|feature| feature.get("description"))
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .unwrap_or_else(|| title_case(&primary_feature_id));

    let member_count = observation_table.row_count.max(1);
    let current_member_id = observation_table
        .member_ids
        .first()
        .cloned()
        .unwrap_or_else(|| "sample".to_string());
    let cohort_id = "all-members".to_string();
    let set = SpatialFieldSetSummary {
        id: dataset_id.clone(),
        name: title_case(&dataset_id),
        member_count,
        primary_feature_id: Some(primary_feature_id.clone()),
        support_kind: support_kind.clone(),
        support_label: support_label.clone(),
        alignment_class: alignment_class.clone(),
        design_columns,
        design_table_preview: observation_table.design_table_preview,
        member_summaries: observation_table.member_summaries,
        member_ids: observation_table.member_ids,
        saved_cohort_ids: vec![cohort_id.clone()],
        ingest_audit: StudioIngestAuditSummary {
            source_label: "NFTab manifest".to_string(),
            join: StudioJoinAuditSummary {
                matched_rows: observation_table.row_count,
                unmatched_rows,
                duplicate_keys,
                severity: join_severity,
                issue_details: observation_table.join_issue_details,
            },
            support: StudioSupportAuditSummary {
                support_label,
                alignment_class,
                ready_for_compare: compare_ready && duplicate_keys == 0 && observation_table.row_count > 0,
                severity: if compare_ready {
                    StudioAuditSeverity::Ok
                } else {
                    StudioAuditSeverity::Warning
                },
            },
            notes,
        },
    };

    Ok(ManifestPreview {
        description: format!(
            "Parsed manifest {} with {} observation rows and primary feature {}.",
            manifest_path, observation_table.row_count, primary_feature_id
        ),
        features: vec![StudioFeatureSummary {
            id: primary_feature_id.clone(),
            label: feature_label.clone(),
            kind: support_kind,
        }],
        cohorts: vec![StudioCohortSummary {
            id: cohort_id.clone(),
            label: "All members".to_string(),
            member_count,
            description: "Cohort spanning all observation rows in the manifest preview.".to_string(),
            member_ids: set.member_ids.clone(),
            origin_kind: StudioCohortOriginKind::Imported,
            origin_label: Some("Manifest observation table".to_string()),
        }],
        expressions: vec![
            StudioFieldExpressionSummary {
                id: "manifest-member".to_string(),
                label: "Current member".to_string(),
                kind: StudioExpressionKind::Member,
                recipe: format!("member({})", current_member_id),
                cohort_id: None,
            },
            StudioFieldExpressionSummary {
                id: "manifest-compare-zscore".to_string(),
                label: "Z-score vs all members".to_string(),
                kind: StudioExpressionKind::Comparison,
                recipe: format!("zscore(current, cohort:{})", cohort_id),
                cohort_id: Some(cohort_id),
            },
        ],
        set,
    })
}

fn parse_manifest_value(text: &str, path: &Path) -> Result<Value, String> {
    let extension = path.extension().and_then(|ext| ext.to_str()).unwrap_or_default();
    if extension.eq_ignore_ascii_case("json") {
        serde_json::from_str(text).map_err(|error| format!("Failed to parse JSON manifest: {}", error))
    } else {
        serde_yaml::from_str(text).map_err(|error| format!("Failed to parse YAML manifest: {}", error))
    }
}

#[derive(Debug)]
struct ObservationTablePreview {
    row_count: usize,
    duplicate_row_ids: usize,
    duplicate_axes: usize,
    rows_missing_source_path: usize,
    member_summaries: Vec<StudioMemberSummary>,
    member_ids: Vec<String>,
    design_table_preview: Option<StudioDesignTablePreview>,
    table_path: String,
    notes: Vec<String>,
    join_issue_details: Vec<StudioJoinIssueDetail>,
}

fn inspect_observation_table(
    manifest_file: &Path,
    manifest_value: &Value,
    preview_columns: &[String],
) -> Result<ObservationTablePreview, String> {
    let observation_table = manifest_value
        .get("observation_table")
        .and_then(Value::as_object)
        .ok_or_else(|| "Manifest observation_table section is missing or invalid.".to_string())?;
    let table_path_value = observation_table
        .get("path")
        .and_then(Value::as_str)
        .ok_or_else(|| "Manifest observation_table.path is missing.".to_string())?;
    let format_value = observation_table
        .get("format")
        .and_then(Value::as_str)
        .unwrap_or("csv");
    let row_id = get_string(manifest_value, "row_id")
        .ok_or_else(|| "Manifest row_id is missing.".to_string())?;
    let observation_axes = get_string_array(manifest_value, "observation_axes");
    let primary_feature_id = get_string(manifest_value, "primary_feature");

    let resolved_path = resolve_relative_path(manifest_file, table_path_value);
    match format_value {
        "csv" | "tsv" => inspect_delimited_table(
            manifest_file,
            &resolved_path,
            &row_id,
            &observation_axes,
            preview_columns,
            primary_feature_id.as_deref(),
            if format_value == "csv" { b',' } else { b'\t' },
        ),
        "parquet" => Ok(ObservationTablePreview {
            row_count: 0,
            duplicate_row_ids: 0,
            duplicate_axes: 0,
            rows_missing_source_path: 0,
            member_summaries: Vec::new(),
            member_ids: Vec::new(),
            design_table_preview: Some(StudioDesignTablePreview {
                columns: preview_columns.iter().take(4).cloned().collect(),
                rows: Vec::new(),
            }),
            table_path: resolved_path.to_string_lossy().to_string(),
            notes: vec!["Parquet preview is not implemented yet.".to_string()],
            join_issue_details: vec![StudioJoinIssueDetail {
                message: "Parquet preview is not implemented yet.".to_string(),
                member_ids: Vec::new(),
            }],
        }),
        other => Err(format!("Unsupported observation table format {}.", other)),
    }
}

fn inspect_delimited_table(
    manifest_file: &Path,
    path: &Path,
    row_id: &str,
    observation_axes: &[String],
    preview_columns: &[String],
    primary_feature_id: Option<&str>,
    delimiter: u8,
) -> Result<ObservationTablePreview, String> {
    if !path.exists() {
        return Err(format!("Observation table {} was not found.", path.display()));
    }

    let mut reader = ReaderBuilder::new()
        .delimiter(delimiter)
        .from_path(path)
        .map_err(|error| format!("Failed to open observation table {}: {}", path.display(), error))?;

    let headers = reader
        .headers()
        .map_err(|error| format!("Failed to read headers from {}: {}", path.display(), error))?
        .clone();

    let row_id_index = headers
        .iter()
        .position(|header| header == row_id)
        .ok_or_else(|| format!("Row id column {} was not found in {}.", row_id, path.display()))?;
    let axis_indices: Vec<usize> = observation_axes
        .iter()
        .filter_map(|axis| headers.iter().position(|header| header == axis))
        .collect();
    let preview_columns: Vec<String> = preview_columns.iter().take(4).cloned().collect();
    let preview_column_indices: Vec<Option<usize>> = preview_columns
        .iter()
        .map(|column| headers.iter().position(|header| header == column))
        .collect();
    let source_path_index = infer_source_path_index(&headers, primary_feature_id);

    let mut row_count = 0usize;
    let mut duplicate_row_ids = 0usize;
    let mut duplicate_axes = 0usize;
    let mut rows_missing_source_path = 0usize;
    let mut seen_row_ids = HashSet::new();
    let mut seen_axes = HashSet::new();
    let mut member_summaries = Vec::new();
    let mut member_ids = Vec::new();
    let mut preview_rows = Vec::new();
    let mut duplicate_row_id_values = Vec::new();
    let mut duplicate_axis_values = Vec::new();
    let mut missing_source_path_rows = Vec::new();

    for record in reader.records() {
        let record = record.map_err(|error| {
            format!(
                "Failed to read observation row from {}: {}",
                path.display(),
                error
            )
        })?;
        row_count += 1;

        if let Some(row_id_value) = record.get(row_id_index) {
            member_ids.push(row_id_value.to_string());
            if !seen_row_ids.insert(row_id_value.to_string()) {
                duplicate_row_ids += 1;
                if duplicate_row_id_values.len() < 5 {
                    duplicate_row_id_values.push(row_id_value.to_string());
                }
            }

            let source_path = source_path_index
                .and_then(|index| record.get(index))
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| resolve_relative_path(manifest_file, value).to_string_lossy().to_string());
            if source_path.is_none() {
                rows_missing_source_path += 1;
                if missing_source_path_rows.len() < 5 {
                    missing_source_path_rows.push(row_id_value.to_string());
                }
            }
            member_summaries.push(StudioMemberSummary {
                id: row_id_value.to_string(),
                source_path,
            });

            if preview_rows.len() < 6 {
                let cells = preview_column_indices
                    .iter()
                    .map(|index| {
                        index
                            .and_then(|value| record.get(value))
                            .unwrap_or("—")
                            .to_string()
                    })
                    .collect();
                preview_rows.push(StudioDesignRowPreview {
                    id: row_id_value.to_string(),
                    cells,
                });
            }
        }

        if !axis_indices.is_empty() {
            let axis_key = axis_indices
                .iter()
                .filter_map(|index| record.get(*index))
                .collect::<Vec<_>>()
                .join("|");
            if !seen_axes.insert(axis_key) {
                duplicate_axes += 1;
                if duplicate_axis_values.len() < 5 {
                    duplicate_axis_values.push(
                        axis_indices
                            .iter()
                            .filter_map(|index| record.get(*index))
                            .collect::<Vec<_>>()
                            .join("|"),
                    );
                }
            }
        }
    }

    let mut notes = Vec::new();
    if duplicate_row_ids > 0 {
        notes.push(format!(
            "Detected {} duplicate row_id values in the observation table.",
            duplicate_row_ids
        ));
    }
    if duplicate_axes > 0 {
        notes.push(format!(
            "Detected {} duplicate observation-axis tuples in the observation table.",
            duplicate_axes
        ));
    }
    if notes.is_empty() {
        notes.push("Observation table keys appear unique in the preview.".to_string());
    }

    let mut join_issue_details = Vec::new();
    if rows_missing_source_path > 0 {
        for row_id in &missing_source_path_rows {
            join_issue_details.push(StudioJoinIssueDetail {
                message: format!("Row {} is missing a bindable source path.", row_id),
                member_ids: vec![row_id.clone()],
            });
        }
        if rows_missing_source_path > missing_source_path_rows.len() {
            join_issue_details.push(StudioJoinIssueDetail {
                message: format!(
                    "{} additional rows are missing bindable source paths.",
                    rows_missing_source_path - missing_source_path_rows.len()
                ),
                member_ids: Vec::new(),
            });
        }
    }
    if duplicate_row_ids > 0 {
        for row_id in &duplicate_row_id_values {
            join_issue_details.push(StudioJoinIssueDetail {
                message: format!("Duplicate row_id detected: {}.", row_id),
                member_ids: vec![row_id.clone()],
            });
        }
    }
    if duplicate_axes > 0 {
        for axis_value in &duplicate_axis_values {
            join_issue_details.push(StudioJoinIssueDetail {
                message: format!(
                    "Duplicate observation-axis tuple detected: {}.",
                    axis_value
                ),
                member_ids: Vec::new(),
            });
        }
    }

    Ok(ObservationTablePreview {
        row_count,
        duplicate_row_ids,
        duplicate_axes,
        rows_missing_source_path,
        member_summaries,
        member_ids,
        design_table_preview: Some(StudioDesignTablePreview {
            columns: preview_columns,
            rows: preview_rows,
        }),
        table_path: path.to_string_lossy().to_string(),
        notes,
        join_issue_details,
    })
}

fn resolve_relative_path(manifest_file: &Path, raw_path: &str) -> PathBuf {
    let path = PathBuf::from(raw_path);
    if path.is_absolute() {
        return path;
    }

    manifest_file
        .parent()
        .map(|parent| parent.join(&path))
        .unwrap_or(path)
}

fn infer_support_summary(
    manifest_value: &Value,
    primary_feature: &Value,
    support_ref: Option<&str>,
) -> (
    StudioSupportKind,
    String,
    StudioAlignmentClass,
    bool,
    Vec<String>,
) {
    let logical = primary_feature.get("logical").and_then(Value::as_object);
    let logical_kind = logical
        .and_then(|value| value.get("kind"))
        .and_then(Value::as_str)
        .unwrap_or("array");
    let logical_alignment = logical
        .and_then(|value| value.get("alignment"))
        .and_then(Value::as_str)
        .map(map_alignment_class);

    if let Some(support_ref) = support_ref {
        if let Some(support) = manifest_value
            .get("supports")
            .and_then(Value::as_object)
            .and_then(|supports| supports.get(support_ref))
        {
            let support_type = support
                .get("support_type")
                .and_then(Value::as_str)
                .unwrap_or("generic");
            match support_type {
                "volume" => {
                    let space = support
                        .get("space")
                        .and_then(Value::as_str)
                        .unwrap_or("Unknown volume space");
                    let grid_id = support
                        .get("grid_id")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown-grid");
                    return (
                        StudioSupportKind::Volume,
                        format!("{} ({})", space, grid_id),
                        logical_alignment.unwrap_or(StudioAlignmentClass::SameGrid),
                        true,
                        vec![format!(
                            "Primary feature resolves against support {} with exact grid {}.",
                            support_ref, grid_id
                        )],
                    );
                }
                "surface" => {
                    let template = support
                        .get("template")
                        .and_then(Value::as_str)
                        .unwrap_or("Unknown surface template");
                    let hemisphere = support
                        .get("hemisphere")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown");
                    let topology = support
                        .get("topology_id")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown-topology");
                    return (
                        StudioSupportKind::Surface,
                        format!("{} / {} / {}", template, hemisphere, topology),
                        logical_alignment.unwrap_or(StudioAlignmentClass::SameTopology),
                        true,
                        vec![format!(
                            "Primary feature resolves against surface support {}.",
                            support_ref
                        )],
                    );
                }
                _ => {}
            }
        }
    }

    let support_kind = match logical_kind {
        "volume" => StudioSupportKind::Volume,
        "surface" => StudioSupportKind::Surface,
        _ => StudioSupportKind::Unknown,
    };
    let support_label = logical
        .and_then(|value| value.get("space"))
        .and_then(Value::as_str)
        .unwrap_or("Unknown support")
        .to_string();
    (
        support_kind,
        support_label,
        logical_alignment.unwrap_or(StudioAlignmentClass::Unknown),
        false,
        vec!["Primary feature does not reference an exact support descriptor.".to_string()],
    )
}

fn map_alignment_class(value: &str) -> StudioAlignmentClass {
    match value {
        "same-grid" => StudioAlignmentClass::SameGrid,
        "same-space" => StudioAlignmentClass::SameSpace,
        "same-topology" => StudioAlignmentClass::SameTopology,
        "mixed" => StudioAlignmentClass::Mixed,
        _ => StudioAlignmentClass::Unknown,
    }
}

fn get_string(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(ToString::to_string)
}

fn get_string_array(value: &Value, key: &str) -> Vec<String> {
    value.get(key)
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(ToString::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn discover_matching_files(root: &str, regex: Option<&Regex>, limit: usize) -> Vec<String> {
    let Some(regex) = regex else {
        return Vec::new();
    };
    let root_path = Path::new(root);
    if !root_path.exists() {
        return Vec::new();
    }

    let mut matched = WalkDir::new(root_path)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
        .filter(|entry| regex.is_match(&entry.path().to_string_lossy()))
        .map(|entry| entry.path().to_string_lossy().to_string())
        .collect::<Vec<_>>();
    matched.sort();
    matched.truncate(limit);
    matched
}

fn derive_member_id_from_path(path: &str, fallback_index: usize) -> String {
    Path::new(path)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .map(|stem| stem.trim_end_matches(".nii").to_string())
        .filter(|stem| !stem.is_empty())
        .unwrap_or_else(|| format!("member-{:03}", fallback_index + 1))
}

fn infer_source_path_index(
    headers: &csv::StringRecord,
    primary_feature_id: Option<&str>,
) -> Option<usize> {
    let mut candidates = Vec::new();
    if let Some(feature_id) = primary_feature_id {
        candidates.push(feature_id.to_string());
        candidates.push(format!("{}_path", feature_id));
        candidates.push(format!("{}_file", feature_id));
        candidates.push(format!("{}_filepath", feature_id));
        candidates.push(format!("{}_uri", feature_id));
    }
    candidates.extend([
        "path".to_string(),
        "file".to_string(),
        "filepath".to_string(),
        "uri".to_string(),
    ]);

    candidates
        .iter()
        .find_map(|candidate| headers.iter().position(|header| header == candidate))
}

fn discovery_notes(
    root_exists: bool,
    regex_valid: bool,
    matched_files: usize,
    duplicate_keys: usize,
) -> Vec<String> {
    if !root_exists {
        return vec![
            "Discovery root was not found on disk.".to_string(),
            "Preview fell back to seeded candidate values so the workflow stays usable."
                .to_string(),
        ];
    }

    if !regex_valid {
        return vec![
            "Regex pattern was invalid and could not be compiled.".to_string(),
            "Preview fell back to seeded candidate values so the workflow stays usable."
                .to_string(),
        ];
    }

    let mut notes = vec![format!(
        "Discovery matched {} files under the requested root.",
        matched_files
    )];

    if duplicate_keys > 0 {
        notes.push(
            "A duplicate subject-session key was inferred from the discovery preview."
                .to_string(),
        );
    } else {
        notes.push("No duplicate keys were inferred from the discovery preview.".to_string());
    }

    notes
}

fn build_regex_issue_details(
    root_exists: bool,
    regex_valid: bool,
    matched_files: usize,
    unmatched_rows: usize,
    duplicate_keys: usize,
) -> Vec<StudioJoinIssueDetail> {
    let mut issues = Vec::new();
    if !root_exists {
        issues.push(StudioJoinIssueDetail {
            message: "Discovery root does not exist on disk.".to_string(),
            member_ids: Vec::new(),
        });
    }
    if !regex_valid {
        issues.push(StudioJoinIssueDetail {
            message: "The requested file pattern could not be compiled as a regex.".to_string(),
            member_ids: Vec::new(),
        });
    }
    if unmatched_rows > 0 {
        issues.push(StudioJoinIssueDetail {
            message: format!(
                "{} discovered files did not resolve to clean preview row bindings.",
                unmatched_rows
            ),
            member_ids: Vec::new(),
        });
    }
    if duplicate_keys > 0 {
        issues.push(StudioJoinIssueDetail {
            message: format!(
                "{} duplicate discovery key conflicts were detected.",
                duplicate_keys
            ),
            member_ids: Vec::new(),
        });
    }
    if issues.is_empty() && matched_files > 0 {
        issues.push(StudioJoinIssueDetail {
            message: format!(
                "Discovery preview matched {} files without join conflicts.",
                matched_files
            ),
            member_ids: Vec::new(),
        });
    }
    issues
}

fn title_case(value: &str) -> String {
    value.replace(['_', '-'], " ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use nifti::{writer::WriterOptions, NiftiHeader};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn make_temp_dir(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("field-table-{}-{}", label, unique));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    fn save_test_nifti(path: &Path, data: &[f32], dims: [u16; 3]) {
        let mut header = NiftiHeader::default();
        header.dim = [3, dims[0], dims[1], dims[2], 1, 1, 1, 1];
        header.datatype = 16;
        header.bitpix = 32;
        header.sform_code = 1;
        header.qform_code = 0;
        header.srow_x = [1.0, 0.0, 0.0, 0.0];
        header.srow_y = [0.0, 1.0, 0.0, 0.0];
        header.srow_z = [0.0, 0.0, 1.0, 0.0];
        WriterOptions::new(path)
            .reference_header(&header)
            .write_nifti(
                &ndarray::Array3::from_shape_vec(
                    (dims[0] as usize, dims[1] as usize, dims[2] as usize),
                    data.to_vec(),
                )
                .expect("build ndarray for test nifti"),
            )
            .expect("write test nifti");
    }

    #[test]
    fn returns_manifest_previews() {
        let previews = preview_import_candidates(StudioImportPreviewRequest {
            mode: StudioImportMode::Manifest,
            manifest_path: Some("/tmp/demo.nftab.yaml".to_string()),
            discovery_root: None,
            file_pattern: None,
            table_source_label: None,
            table_headers: None,
            table_rows: None,
            table_file_path_column: None,
            table_subject_id_column: None,
            table_excluded_columns: None,
        });
        assert_eq!(previews.len(), 1);
        assert_eq!(previews[0].mode, StudioImportMode::Manifest);
        assert_eq!(previews[0].source_hint, "/tmp/demo.nftab.yaml");
    }

    #[test]
    fn returns_regex_previews() {
        let previews = preview_import_candidates(StudioImportPreviewRequest {
            mode: StudioImportMode::Regex,
            manifest_path: None,
            discovery_root: Some(".".to_string()),
            file_pattern: Some(String::from(r".*Cargo\.toml$")),
            table_source_label: None,
            table_headers: None,
            table_rows: None,
            table_file_path_column: None,
            table_subject_id_column: None,
            table_excluded_columns: None,
        });
        assert_eq!(previews.len(), 1);
        assert_eq!(previews[0].mode, StudioImportMode::Regex);
        assert!(previews[0].set.member_count > 0);
    }

    #[test]
    fn validates_table_import_preview_from_rows() {
        let temp_dir = make_temp_dir("table-preview");
        let member_a_path = temp_dir.join("sub001.nii.gz");
        let member_b_path = temp_dir.join("sub002.nii.gz");
        save_test_nifti(&member_a_path, &[1.0, 3.0, 5.0, 7.0], [2, 2, 1]);
        save_test_nifti(&member_b_path, &[3.0, 5.0, 7.0, 9.0], [2, 2, 1]);

        let previews = preview_import_candidates(StudioImportPreviewRequest {
            mode: StudioImportMode::Table,
            manifest_path: None,
            discovery_root: None,
            file_pattern: None,
            table_source_label: Some("subjects.csv".to_string()),
            table_headers: Some(vec![
                "subject".to_string(),
                "filepath".to_string(),
                "diagnosis".to_string(),
                "site".to_string(),
            ]),
            table_rows: Some(vec![
                vec![
                    "sub001".to_string(),
                    member_a_path.to_string_lossy().into_owned(),
                    "control".to_string(),
                    "A".to_string(),
                ],
                vec![
                    "sub002".to_string(),
                    member_b_path.to_string_lossy().into_owned(),
                    "case".to_string(),
                    "A".to_string(),
                ],
            ]),
            table_file_path_column: Some("filepath".to_string()),
            table_subject_id_column: Some("subject".to_string()),
            table_excluded_columns: Some(vec!["site".to_string()]),
        });

        assert_eq!(previews.len(), 1);
        let preview = &previews[0];
        assert_eq!(preview.mode, StudioImportMode::Table);
        assert_eq!(preview.set.member_count, 2);
        assert_eq!(preview.set.support_kind, StudioSupportKind::Volume);
        assert_eq!(preview.set.alignment_class, StudioAlignmentClass::SameGrid);
        assert_eq!(preview.set.design_columns, vec!["diagnosis".to_string()]);
        assert_eq!(preview.set.ingest_audit.join.matched_rows, 2);
        assert_eq!(preview.set.ingest_audit.join.unmatched_rows, 0);
        assert!(preview.set.ingest_audit.support.ready_for_compare);
        assert_eq!(preview.set.member_ids, vec!["sub001".to_string(), "sub002".to_string()]);
        assert_eq!(
            preview.set.member_summaries[0].source_path.as_deref(),
            Some(member_a_path.to_string_lossy().as_ref())
        );
        assert_eq!(
            preview
                .set
                .design_table_preview
                .as_ref()
                .expect("design preview")
                .columns,
            vec!["subject".to_string(), "diagnosis".to_string()]
        );
        assert_eq!(
            preview
                .set
                .design_table_preview
                .as_ref()
                .expect("design preview")
                .rows[0]
                .cells,
            vec!["sub001".to_string(), "control".to_string()]
        );
        assert_eq!(
            preview.cohorts[0].id,
            "table-all-members"
        );
        assert_eq!(
            preview.expressions[1].recipe,
            "zscore(current, cohort:table-all-members)"
        );

        fs::remove_dir_all(temp_dir).expect("cleanup temp dir");
    }

    #[test]
    fn materializes_compare_pane_specs() {
        let temp_dir = make_temp_dir("compare-materialize");
        let member_a_path = temp_dir.join("sub001.nii.gz");
        let member_b_path = temp_dir.join("sub002.nii.gz");
        save_test_nifti(&member_a_path, &[1.0, 3.0, 5.0, 7.0], [2, 2, 1]);
        save_test_nifti(&member_b_path, &[3.0, 5.0, 7.0, 9.0], [2, 2, 1]);

        let panes = materialize_compare_panes(StudioCompareMaterializeRequest {
            support_label: "MNI152 2mm".to_string(),
            compare_ready: true,
            force_rematerialize: false,
            active_member_id: Some("sub001".to_string()),
            active_member_source_path: Some(member_a_path.to_string_lossy().into_owned()),
            cohort_member_source_paths: vec![
                member_a_path.to_string_lossy().into_owned(),
                member_b_path.to_string_lossy().into_owned(),
            ],
            compare_cohort_id: Some("controls".to_string()),
            compare_cohort_label: Some("Controls".to_string()),
            compare_cohort_member_count: Some(12),
            active_expression_label: Some("Z-score vs controls".to_string()),
            active_expression_recipe: Some("zscore(current, cohort:controls)".to_string()),
        });

        assert_eq!(panes.len(), 4);
        assert_eq!(panes[0].id, "current");
        assert_eq!(panes[0].status, StudioComparePaneStatus::Live);
        assert_eq!(
            panes[0].binding.as_ref().map(|binding| &binding.kind),
            Some(&StudioCompareBindingKind::MemberSource)
        );
        assert_eq!(panes[1].status, StudioComparePaneStatus::Live);
        assert!(
            panes[1]
                .binding
                .as_ref()
                .map(|binding| binding.ready)
                .unwrap_or(false)
        );
        let cohort_mean_path = panes[1]
            .binding
            .as_ref()
            .and_then(|binding| binding.source_path.as_ref())
            .expect("cohort mean path");
        assert!(Path::new(cohort_mean_path).exists());
        let residual_path = panes[2]
            .binding
            .as_ref()
            .and_then(|binding| binding.source_path.as_ref())
            .expect("residual path");
        assert_eq!(panes[2].status, StudioComparePaneStatus::Live);
        assert!(Path::new(residual_path).exists());
        let zscore_path = panes[3]
            .binding
            .as_ref()
            .and_then(|binding| binding.source_path.as_ref())
            .expect("zscore path");
        assert_eq!(panes[3].status, StudioComparePaneStatus::Live);
        assert!(Path::new(zscore_path).exists());
        assert!(
            panes[1]
                .binding
                .as_ref()
                .and_then(|binding| binding.materialization_key.as_ref())
                .map(|key| key.starts_with("cohort-mean:"))
                .unwrap_or(false)
        );
        assert!(
            panes[1]
                .binding
                .as_ref()
                .and_then(|binding| binding.materialized_at_ms)
                .is_some()
        );
        assert!(
            panes[3]
                .binding
                .as_ref()
                .and_then(|binding| binding.materialized_at_ms)
                .is_some()
        );
        assert_eq!(panes[3].recipe.as_deref(), Some("zscore(current, cohort:controls)"));
        let (zscore_volume, _affine) =
            nifti_loader::load_nifti_volume_auto(Path::new(zscore_path)).expect("load zscore");
        let (zscore_values, _dims) = extract_volume_values(&zscore_volume).expect("extract zscore values");
        assert_eq!(zscore_values, vec![-1.0, -1.0, -1.0, -1.0]);

        fs::remove_dir_all(temp_dir).expect("cleanup temp dir");
    }

    #[test]
    fn parses_manifest_and_observation_table_preview() {
        let temp_dir = make_temp_dir("manifest");
        let manifest_path = temp_dir.join("demo.nftab.yaml");
        let table_path = temp_dir.join("observations.csv");

        fs::write(
            &table_path,
            "member_id,subject,diagnosis,statmap_path\nsub001,s01,control,maps/sub001_t.nii.gz\nsub002,s02,case,maps/sub002_t.nii.gz\n",
        )
        .expect("write observation table");
        fs::write(
            &manifest_path,
            r#"
dataset_id: demo_study
row_id: member_id
primary_feature: statmap
observation_axes:
  - subject
observation_columns:
  member_id: { dtype: string }
  subject: { dtype: string }
  diagnosis: { dtype: string }
observation_table:
  path: observations.csv
  format: csv
supports:
  mni2mm:
    support_type: volume
    space: MNI152NLin2009cAsym
    grid_id: mni152-2mm
features:
  statmap:
    description: T statistic
    logical:
      kind: volume
      support_ref: mni2mm
      alignment: same-grid
"#,
        )
        .expect("write manifest");

        let previews = preview_import_candidates(StudioImportPreviewRequest {
            mode: StudioImportMode::Manifest,
            manifest_path: Some(manifest_path.to_string_lossy().to_string()),
            discovery_root: None,
            file_pattern: None,
            table_source_label: None,
            table_headers: None,
            table_rows: None,
            table_file_path_column: None,
            table_subject_id_column: None,
            table_excluded_columns: None,
        });

        assert_eq!(previews.len(), 1);
        let preview = &previews[0];
        assert_eq!(preview.mode, StudioImportMode::Manifest);
        assert_eq!(preview.set.id, "demo_study");
        assert_eq!(preview.set.member_count, 2);
        assert_eq!(preview.set.support_kind, StudioSupportKind::Volume);
        assert_eq!(preview.set.alignment_class, StudioAlignmentClass::SameGrid);
        assert_eq!(preview.set.ingest_audit.join.matched_rows, 2);
        assert_eq!(preview.set.ingest_audit.join.duplicate_keys, 0);
        assert!(preview.set.ingest_audit.support.ready_for_compare);
        assert!(preview.set.support_label.contains("MNI152NLin2009cAsym"));
        assert_eq!(
            preview
                .set
                .design_table_preview
                .as_ref()
                .expect("design preview")
                .columns,
            vec![
                "subject".to_string(),
                "diagnosis".to_string(),
            ]
        );
        assert_eq!(
            preview
                .set
                .design_table_preview
                .as_ref()
                .expect("design preview")
                .rows[0]
                .cells,
            vec!["s01".to_string(), "control".to_string()]
        );
        assert_eq!(preview.features[0].id, "statmap");
        assert_eq!(preview.expressions[0].recipe, "member(sub001)");
        assert_eq!(
            preview.set.member_summaries[0].source_path.as_deref(),
            Some(
                temp_dir
                    .join("maps/sub001_t.nii.gz")
                    .to_string_lossy()
                    .as_ref()
            )
        );
        assert!(
            preview
                .set
                .ingest_audit
                .notes
                .iter()
                .any(|note| note.contains("loaded 2 rows")),
            "expected row-count note in ingest audit"
        );

        fs::remove_dir_all(temp_dir).expect("cleanup temp dir");
    }
}
