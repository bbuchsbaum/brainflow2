use super::{
    binding_summary, feature_support_kind, import_contract, infer_source_path_index,
    infer_support_summary, inspect_resource_registry, manifest_binding_support_label,
    resolve_relative_path, resolve_row_source, title_case, unavailable_primary_binding,
    BindingSummaryInput, ImportContractInput, ResourceRegistryPreview,
};
use crate::neurotabs::{self, FeatureSchema, NeuroTabsManifest, TableFormat};
use bridge_types::{
    SpatialFieldSetSummary, StudioAlignmentClass, StudioAuditSeverity, StudioCohortOriginKind,
    StudioCohortSummary, StudioDesignRowPreview, StudioDesignTablePreview, StudioExpressionKind,
    StudioFeatureSummary, StudioFieldExpressionSummary, StudioImportCandidate, StudioImportMode,
    StudioImportPreviewRequest, StudioImportProvenanceKind, StudioIngestAuditSummary,
    StudioJoinAuditSummary, StudioJoinIssueDetail, StudioMaterializationStatus,
    StudioMemberSummary, StudioSupportAuditSummary, StudioSupportKind,
};
use csv::ReaderBuilder;
use std::collections::HashSet;
use std::fs;
use std::path::Path;

struct DelimitedTableInspectOptions<'a> {
    manifest_file: &'a Path,
    path: &'a Path,
    row_id: &'a str,
    observation_axes: &'a [String],
    preview_columns: &'a [String],
    primary_feature_id: Option<&'a str>,
    primary_feature: Option<&'a FeatureSchema>,
    feature_bindings: &'a [FeatureBindingPreview<'a>],
    resource_registry: &'a ResourceRegistryPreview,
    delimiter: u8,
}

#[derive(Debug, Clone)]
pub(super) struct FeatureBindingPreview<'a> {
    pub(super) feature_id: &'a str,
    pub(super) feature: &'a FeatureSchema,
    pub(super) support_kind: StudioSupportKind,
    pub(super) support_label: Option<String>,
    pub(super) is_primary: bool,
}

pub(super) fn manifest_candidate(request: &StudioImportPreviewRequest) -> StudioImportCandidate {
    let manifest_path = request
        .manifest_path
        .clone()
        .unwrap_or_else(|| "/data/studyA/studyA.neurotabs.yaml".to_string());

    match inspect_manifest_preview(&manifest_path) {
        Ok(preview) => {
            let contract = import_contract(ImportContractInput {
                provenance_kind: StudioImportProvenanceKind::Manifest,
                provenance_label: manifest_path.clone(),
                member_count: preview.set.member_count,
                support_kind: preview.set.support_kind.clone(),
                join_severity: &preview.set.ingest_audit.join.severity,
                support_severity: &preview.set.ingest_audit.support.severity,
                unmatched_rows: preview.set.ingest_audit.join.unmatched_rows,
                duplicate_keys: preview.set.ingest_audit.join.duplicate_keys,
                ready_for_compare: preview.set.ingest_audit.support.ready_for_compare,
                extra_capabilities: Vec::new(),
            });
            StudioImportCandidate {
                id: "candidate-manifest-a".to_string(),
                label: "NeuroTabs manifest preview".to_string(),
                description: preview.description,
                mode: StudioImportMode::Manifest,
                source_hint: manifest_path,
                contract,
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
                discovery: None,
            }
        }
        Err(message) => manifest_blocked_candidate(&manifest_path, &message),
    }
}

fn manifest_blocked_candidate(manifest_path: &str, message: &str) -> StudioImportCandidate {
    let manifest_name = Path::new(manifest_path)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("Manifest Import");

    StudioImportCandidate {
        id: "candidate-manifest-blocked".to_string(),
        label: "NeuroTabs manifest blocked".to_string(),
        description: "Manifest preview failed; no fallback data was generated.".to_string(),
        mode: StudioImportMode::Manifest,
        source_hint: manifest_path.to_string(),
        contract: import_contract(ImportContractInput {
            provenance_kind: StudioImportProvenanceKind::BackendError,
            provenance_label: manifest_path.to_string(),
            member_count: 0,
            support_kind: StudioSupportKind::Unknown,
            join_severity: &StudioAuditSeverity::Error,
            support_severity: &StudioAuditSeverity::Error,
            unmatched_rows: 0,
            duplicate_keys: 0,
            ready_for_compare: false,
            extra_capabilities: Vec::new(),
        }),
        set: SpatialFieldSetSummary {
            id: "manifest-preview-blocked".to_string(),
            name: format!("{} / Manifest Import", manifest_name),
            member_count: 0,
            primary_feature_id: None,
            support_kind: StudioSupportKind::Unknown,
            support_label: "unknown (manifest preview failed)".to_string(),
            alignment_class: StudioAlignmentClass::Unknown,
            design_columns: Vec::new(),
            design_table_preview: None,
            member_summaries: Vec::new(),
            member_ids: Vec::new(),
            saved_cohort_ids: Vec::new(),
            ingest_audit: StudioIngestAuditSummary {
                source_label: "NeuroTabs manifest".to_string(),
                join: StudioJoinAuditSummary {
                    matched_rows: 0,
                    unmatched_rows: 0,
                    duplicate_keys: 0,
                    severity: StudioAuditSeverity::Error,
                    issue_details: vec![StudioJoinIssueDetail {
                        message: message.to_string(),
                        member_ids: Vec::new(),
                    }],
                },
                support: StudioSupportAuditSummary {
                    support_label: "unknown (manifest preview failed)".to_string(),
                    alignment_class: StudioAlignmentClass::Unknown,
                    ready_for_compare: false,
                    severity: StudioAuditSeverity::Error,
                },
                notes: vec![
                    message.to_string(),
                    "No fallback data was generated; fix the manifest and refresh the preview."
                        .to_string(),
                ],
            },
        },
        features: Vec::new(),
        cohorts: Vec::new(),
        expressions: Vec::new(),
        materialization: Some(StudioMaterializationStatus {
            warm: 0,
            preview: 0,
            pending: 0,
            failed: 1,
        }),
        discovery: None,
    }
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
        return Err(format!(
            "Manifest path {} was not found on disk.",
            manifest_path
        ));
    }

    let manifest_text = fs::read_to_string(manifest_file)
        .map_err(|error| format!("Failed to read manifest {}: {}", manifest_path, error))?;
    let manifest = neurotabs::parse_manifest_str(&manifest_text, manifest_file)
        .map_err(|error| format!("Invalid NeuroTabs manifest {}: {}", manifest_path, error))?;

    let dataset_id = manifest.dataset_id.clone();
    let primary_feature_id = manifest
        .primary_feature_id()
        .map(ToString::to_string)
        .ok_or_else(|| "Manifest does not declare any features.".to_string())?;
    let primary_feature = manifest.features.get(&primary_feature_id).ok_or_else(|| {
        format!(
            "Primary feature {} was not found in features.",
            primary_feature_id
        )
    })?;

    let feature_kind = primary_feature.logical.kind.as_str();
    let (support_kind, support_label, alignment_class, compare_ready, support_notes) =
        infer_support_summary(&manifest, primary_feature);
    let feature_bindings = manifest_feature_bindings(&manifest, &primary_feature_id);

    let observation_axes = manifest.observation_axes.clone();
    let observation_columns = &manifest.observation_columns;
    let row_id = manifest.row_id.clone();
    let feature_binding_columns: HashSet<String> = manifest
        .features
        .values()
        .flat_map(FeatureSchema::encoding_column_references)
        .map(ToString::to_string)
        .collect();
    let mut design_columns = Vec::new();
    let mut seen_columns = HashSet::new();
    for axis in &observation_axes {
        if seen_columns.insert(axis.clone()) {
            design_columns.push(axis.clone());
        }
    }
    for column in observation_columns.keys() {
        if column == &row_id || feature_binding_columns.contains(column) {
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
        inspect_observation_table(manifest_file, &manifest, &design_columns, &feature_bindings)?;
    let duplicate_keys = observation_table
        .duplicate_row_ids
        .max(observation_table.duplicate_axes);
    let unmatched_rows = observation_table.rows_missing_source_path;
    let has_source_or_support_issues =
        observation_table.source_issue_count > 0 || observation_table.support_issue_count > 0;
    let compare_ready = compare_ready
        && duplicate_keys == 0
        && observation_table.row_count > 0
        && unmatched_rows == 0
        && !has_source_or_support_issues;
    let join_severity = if duplicate_keys > 0
        || observation_table.row_count == 0
        || unmatched_rows > 0
        || observation_table.source_issue_count > 0
    {
        StudioAuditSeverity::Warning
    } else {
        StudioAuditSeverity::Ok
    };

    let mut notes = vec![
        format!(
            "Observation table preview loaded {} rows from {}.",
            observation_table.row_count, observation_table.table_path
        ),
        format!(
            "Primary feature {} has logical kind {}.",
            primary_feature_id, feature_kind
        ),
    ];
    notes.extend(support_notes);
    notes.extend(observation_table.notes);
    if observation_table.source_issue_count > 0 {
        notes.push(format!(
            "Source/resource audit reported {} issue(s).",
            observation_table.source_issue_count
        ));
    }
    if observation_table.support_issue_count > 0 {
        notes.push(format!(
            "Support compatibility audit reported {} issue(s).",
            observation_table.support_issue_count
        ));
    }

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
            source_label: "NeuroTabs manifest".to_string(),
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
                ready_for_compare: compare_ready,
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
        features: feature_bindings
            .iter()
            .map(|binding| StudioFeatureSummary {
                id: binding.feature_id.to_string(),
                label: binding
                    .feature
                    .description
                    .clone()
                    .unwrap_or_else(|| title_case(binding.feature_id)),
                kind: binding.support_kind.clone(),
            })
            .collect(),
        cohorts: vec![StudioCohortSummary {
            id: cohort_id.clone(),
            label: "All members".to_string(),
            member_count,
            description: "Cohort spanning all observation rows in the manifest preview."
                .to_string(),
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

fn manifest_feature_bindings<'a>(
    manifest: &'a NeuroTabsManifest,
    primary_feature_id: &'a str,
) -> Vec<FeatureBindingPreview<'a>> {
    let mut bindings = Vec::new();
    if let Some(primary_feature) = manifest.features.get(primary_feature_id) {
        bindings.push(FeatureBindingPreview {
            feature_id: primary_feature_id,
            feature: primary_feature,
            support_kind: feature_support_kind(primary_feature),
            support_label: manifest_binding_support_label(manifest, primary_feature),
            is_primary: true,
        });
    }

    for (feature_id, feature) in &manifest.features {
        if feature_id == primary_feature_id {
            continue;
        }
        bindings.push(FeatureBindingPreview {
            feature_id,
            feature,
            support_kind: feature_support_kind(feature),
            support_label: manifest_binding_support_label(manifest, feature),
            is_primary: false,
        });
    }
    bindings
}

#[derive(Debug)]
struct ObservationTablePreview {
    row_count: usize,
    duplicate_row_ids: usize,
    duplicate_axes: usize,
    rows_missing_source_path: usize,
    source_issue_count: usize,
    support_issue_count: usize,
    member_summaries: Vec<StudioMemberSummary>,
    member_ids: Vec<String>,
    design_table_preview: Option<StudioDesignTablePreview>,
    table_path: String,
    notes: Vec<String>,
    join_issue_details: Vec<StudioJoinIssueDetail>,
}

fn inspect_observation_table(
    manifest_file: &Path,
    manifest: &NeuroTabsManifest,
    preview_columns: &[String],
    feature_bindings: &[FeatureBindingPreview<'_>],
) -> Result<ObservationTablePreview, String> {
    let table_path_value = manifest.observation_table.path.as_str();
    let row_id = manifest.row_id.as_str();
    let observation_axes = &manifest.observation_axes;
    let primary_feature_id = manifest.primary_feature_id();
    let primary_feature =
        primary_feature_id.and_then(|feature_id| manifest.features.get(feature_id));
    let resource_registry = inspect_resource_registry(manifest_file, manifest, feature_bindings);

    let resolved_path = resolve_relative_path(manifest_file, table_path_value);
    if !resolved_path.exists() {
        let message = format!(
            "Observation table {} was not found.",
            resolved_path.display()
        );
        return Ok(ObservationTablePreview {
            row_count: 0,
            duplicate_row_ids: 0,
            duplicate_axes: 0,
            rows_missing_source_path: 0,
            source_issue_count: 1 + resource_registry.issue_count,
            support_issue_count: 0,
            member_summaries: Vec::new(),
            member_ids: Vec::new(),
            design_table_preview: Some(StudioDesignTablePreview {
                columns: preview_columns.iter().take(4).cloned().collect(),
                rows: Vec::new(),
            }),
            table_path: resolved_path.to_string_lossy().to_string(),
            notes: vec![message.clone()],
            join_issue_details: {
                let mut details = resource_registry.issue_details;
                details.push(StudioJoinIssueDetail {
                    message,
                    member_ids: Vec::new(),
                });
                details
            },
        });
    }

    match manifest.observation_table.format {
        TableFormat::Csv | TableFormat::Tsv => {
            inspect_delimited_table(DelimitedTableInspectOptions {
                manifest_file,
                path: &resolved_path,
                row_id,
                observation_axes,
                preview_columns,
                primary_feature_id,
                primary_feature,
                feature_bindings,
                resource_registry: &resource_registry,
                delimiter: if manifest.observation_table.format == TableFormat::Csv {
                    b','
                } else {
                    b'\t'
                },
            })
        }
        TableFormat::Parquet => Ok(ObservationTablePreview {
            row_count: 0,
            duplicate_row_ids: 0,
            duplicate_axes: 0,
            rows_missing_source_path: 0,
            source_issue_count: resource_registry.issue_count,
            support_issue_count: 0,
            member_summaries: Vec::new(),
            member_ids: Vec::new(),
            design_table_preview: Some(StudioDesignTablePreview {
                columns: preview_columns.iter().take(4).cloned().collect(),
                rows: Vec::new(),
            }),
            table_path: resolved_path.to_string_lossy().to_string(),
            notes: vec!["Parquet preview is not implemented yet.".to_string()],
            join_issue_details: {
                let mut details = resource_registry.issue_details;
                details.push(StudioJoinIssueDetail {
                    message: "Parquet preview is not implemented yet.".to_string(),
                    member_ids: Vec::new(),
                });
                details
            },
        }),
    }
}

fn inspect_delimited_table(
    options: DelimitedTableInspectOptions<'_>,
) -> Result<ObservationTablePreview, String> {
    let DelimitedTableInspectOptions {
        manifest_file,
        path,
        row_id,
        observation_axes,
        preview_columns,
        primary_feature_id,
        primary_feature,
        feature_bindings,
        resource_registry,
        delimiter,
    } = options;

    if !path.exists() {
        return Err(format!(
            "Observation table {} was not found.",
            path.display()
        ));
    }

    let mut reader = ReaderBuilder::new()
        .delimiter(delimiter)
        .from_path(path)
        .map_err(|error| {
            format!(
                "Failed to open observation table {}: {}",
                path.display(),
                error
            )
        })?;

    let headers = reader
        .headers()
        .map_err(|error| format!("Failed to read headers from {}: {}", path.display(), error))?
        .clone();

    let row_id_index = headers
        .iter()
        .position(|header| header == row_id)
        .ok_or_else(|| {
            format!(
                "Row id column {} was not found in {}.",
                row_id,
                path.display()
            )
        })?;
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
    let mut source_issue_count = resource_registry.issue_count;
    let mut support_issue_count = 0usize;
    let mut seen_row_ids = HashSet::new();
    let mut seen_axes = HashSet::new();
    let mut member_summaries = Vec::new();
    let mut member_ids = Vec::new();
    let mut preview_rows = Vec::new();
    let mut duplicate_row_id_values = Vec::new();
    let mut duplicate_axis_values = Vec::new();
    let mut missing_source_path_rows = Vec::new();
    let mut join_issue_details = resource_registry.issue_details.clone();

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

            let row_source = resolve_row_source(
                manifest_file,
                &headers,
                &record,
                row_id_value,
                primary_feature,
                resource_registry,
                source_path_index,
            );
            source_issue_count += row_source.source_issue_count;
            support_issue_count += row_source.support_issue_count;
            if row_source.source_issue_count > 0 {
                rows_missing_source_path += 1;
                if missing_source_path_rows.len() < 5 {
                    missing_source_path_rows.push(row_id_value.to_string());
                }
            }
            append_limited_issue_details(
                &mut join_issue_details,
                row_source.issue_details.clone(),
                24,
            );

            let mut bindings = Vec::new();
            for feature_binding in feature_bindings {
                let feature_row_source = if feature_binding.is_primary {
                    row_source.clone()
                } else {
                    let feature_source_path_index =
                        infer_source_path_index(&headers, Some(feature_binding.feature_id));
                    resolve_row_source(
                        manifest_file,
                        &headers,
                        &record,
                        row_id_value,
                        Some(feature_binding.feature),
                        resource_registry,
                        feature_source_path_index,
                    )
                };
                if !feature_binding.is_primary {
                    source_issue_count += feature_row_source.source_issue_count;
                    support_issue_count += feature_row_source.support_issue_count;
                    append_limited_issue_details(
                        &mut join_issue_details,
                        feature_row_source.issue_details.clone(),
                        24,
                    );
                }
                bindings.push(binding_summary(BindingSummaryInput {
                    role: feature_binding.feature_id.to_string(),
                    feature_id: Some(feature_binding.feature_id.to_string()),
                    source_locator: feature_row_source.source_locator.clone(),
                    source_path: feature_row_source.source_path.clone(),
                    relative_path: feature_row_source.relative_path.clone(),
                    selector: feature_row_source.selector.clone(),
                    support_kind: feature_binding.support_kind.clone(),
                    support_label: feature_binding.support_label.clone(),
                    availability: feature_row_source.availability.clone(),
                    is_primary: feature_binding.is_primary,
                }));
            }
            if bindings.is_empty() {
                bindings.push(unavailable_primary_binding(
                    primary_feature_id.unwrap_or("source"),
                    primary_feature_id,
                    StudioSupportKind::Unknown,
                    None,
                ));
            }

            member_summaries.push(StudioMemberSummary {
                id: row_id_value.to_string(),
                source_path: row_source.source_path.clone(),
                bindings: Some(bindings),
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
                message: format!("Duplicate observation-axis tuple detected: {}.", axis_value),
                member_ids: Vec::new(),
            });
        }
    }

    Ok(ObservationTablePreview {
        row_count,
        duplicate_row_ids,
        duplicate_axes,
        rows_missing_source_path,
        source_issue_count,
        support_issue_count,
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

fn append_limited_issue_details(
    target: &mut Vec<StudioJoinIssueDetail>,
    details: Vec<StudioJoinIssueDetail>,
    limit: usize,
) {
    let remaining = limit.saturating_sub(target.len());
    target.extend(details.into_iter().take(remaining));
}
