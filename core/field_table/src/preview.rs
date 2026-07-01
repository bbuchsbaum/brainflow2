use crate::neurotabs::{
    self, FeatureEncoding, FeatureSchema, JsonValueSource, NeuroTabsManifest, StringValueSource,
    SupportSchema, TableFormat,
};
use bridge_types::{
    SpatialFieldSetSummary, StudioAlignmentClass, StudioAuditSeverity, StudioCohortOriginKind,
    StudioCohortSummary, StudioDesignRowPreview, StudioDesignTablePreview, StudioExpressionKind,
    StudioFeatureSummary, StudioFieldBindingAvailability, StudioFieldBindingSummary,
    StudioFieldExpressionSummary, StudioImportCandidate, StudioImportCapability,
    StudioImportContract, StudioImportMode, StudioImportPreviewRequest, StudioImportProvenanceKind,
    StudioImportReadiness, StudioIngestAuditSummary, StudioJoinAuditSummary, StudioJoinIssueDetail,
    StudioMaterializationStatus, StudioMemberSummary, StudioSupportAuditSummary, StudioSupportKind,
};
use csv::ReaderBuilder;
use nifti::{NiftiObject, ReaderOptions};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

mod discovery;
use discovery::regex_candidate;
pub use discovery::{DiscoveryInventory, DiscoveryInventoryFile, DiscoverySampleHeader};

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
struct FeatureBindingPreview<'a> {
    feature_id: &'a str,
    feature: &'a FeatureSchema,
    support_kind: StudioSupportKind,
    support_label: Option<String>,
    is_primary: bool,
}

pub fn preview_import_candidates(
    request: StudioImportPreviewRequest,
) -> Vec<StudioImportCandidate> {
    preview_import_candidates_with_discovery_inventory(request, None)
}

pub fn preview_import_candidates_with_discovery_inventory(
    request: StudioImportPreviewRequest,
    discovery_inventory: Option<DiscoveryInventory>,
) -> Vec<StudioImportCandidate> {
    match request.mode {
        StudioImportMode::Manifest => vec![manifest_candidate(&request)],
        StudioImportMode::Regex => vec![regex_candidate(&request, discovery_inventory.as_ref())],
        StudioImportMode::Table => vec![table_candidate(&request)],
    }
}

struct ImportContractInput<'a> {
    provenance_kind: StudioImportProvenanceKind,
    provenance_label: String,
    member_count: usize,
    support_kind: StudioSupportKind,
    join_severity: &'a StudioAuditSeverity,
    support_severity: &'a StudioAuditSeverity,
    unmatched_rows: usize,
    duplicate_keys: usize,
    ready_for_compare: bool,
    extra_capabilities: Vec<StudioImportCapability>,
}

fn import_contract(input: ImportContractInput<'_>) -> StudioImportContract {
    let has_join_problems = input.unmatched_rows > 0 || input.duplicate_keys > 0;
    let has_error = input.join_severity == &StudioAuditSeverity::Error
        || input.support_severity == &StudioAuditSeverity::Error;
    let unsupported_compare_support = !input.ready_for_compare
        && !matches!(input.support_kind, StudioSupportKind::Volume)
        && input.member_count > 0;

    let readiness = if input.member_count == 0 && has_error {
        StudioImportReadiness::Blocked
    } else if input.ready_for_compare && !has_join_problems {
        StudioImportReadiness::CompareReady
    } else if unsupported_compare_support || has_error {
        StudioImportReadiness::InspectOnly
    } else {
        StudioImportReadiness::ReviewRequired
    };

    let can_import = readiness != StudioImportReadiness::Blocked;
    let mut capabilities = if can_import {
        vec![StudioImportCapability::Import, StudioImportCapability::Deck]
    } else {
        Vec::new()
    };
    if readiness == StudioImportReadiness::CompareReady {
        capabilities.push(StudioImportCapability::Compare);
        capabilities.push(StudioImportCapability::MaterializeCompare);
    }
    if can_import {
        for capability in input.extra_capabilities {
            if !capabilities.contains(&capability) {
                capabilities.push(capability);
            }
        }
    }

    let reason = match readiness {
        StudioImportReadiness::CompareReady => {
            "Backend audit marks this preview compare-ready.".to_string()
        }
        StudioImportReadiness::ReviewRequired => {
            "Backend audit found warnings; import for review before compare.".to_string()
        }
        StudioImportReadiness::InspectOnly => {
            "Backend audit blocks trusted compare; import for inspection only.".to_string()
        }
        StudioImportReadiness::Blocked => {
            "Backend audit found blocking errors and no importable members.".to_string()
        }
    };

    StudioImportContract {
        readiness,
        provenance_kind: input.provenance_kind,
        provenance_label: input.provenance_label,
        can_import,
        capabilities,
        reason,
    }
}

fn manifest_candidate(request: &StudioImportPreviewRequest) -> StudioImportCandidate {
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

#[derive(Clone, Debug, PartialEq)]
struct TableSupportSignature {
    dims: [usize; 3],
    voxel_sizes: [f32; 3],
}

fn table_support_label(signature: &TableSupportSignature) -> String {
    format!(
        "{}×{}×{} voxels · {:.2}×{:.2}×{:.2} mm",
        signature.dims[0],
        signature.dims[1],
        signature.dims[2],
        signature.voxel_sizes[0],
        signature.voxel_sizes[1],
        signature.voxel_sizes[2]
    )
}

struct BindingSummaryInput {
    role: String,
    feature_id: Option<String>,
    source_locator: Option<String>,
    source_path: Option<String>,
    relative_path: Option<String>,
    selector: Option<String>,
    support_kind: StudioSupportKind,
    support_label: Option<String>,
    availability: StudioFieldBindingAvailability,
    is_primary: bool,
}

fn binding_summary(input: BindingSummaryInput) -> StudioFieldBindingSummary {
    StudioFieldBindingSummary {
        role: input.role,
        feature_id: input.feature_id,
        source_locator: input.source_locator,
        source_path: input.source_path,
        relative_path: input.relative_path,
        selector: input.selector,
        support_kind: input.support_kind,
        support_label: input.support_label,
        availability: input.availability,
        is_primary: input.is_primary,
    }
}

fn unavailable_primary_binding(
    role: &str,
    feature_id: Option<&str>,
    support_kind: StudioSupportKind,
    support_label: Option<String>,
) -> StudioFieldBindingSummary {
    binding_summary(BindingSummaryInput {
        role: role.to_string(),
        feature_id: feature_id.map(ToString::to_string),
        source_locator: None,
        source_path: None,
        relative_path: None,
        selector: None,
        support_kind,
        support_label,
        availability: StudioFieldBindingAvailability::Unavailable,
        is_primary: true,
    })
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

    if headers.is_empty() || rows.is_empty() || file_col_idx.is_none() || subject_col_idx.is_none()
    {
        return StudioImportCandidate {
            id: "candidate-table-preview".to_string(),
            label: "Table import preview".to_string(),
            description:
                "The table preview is incomplete; map the file path and subject ID columns first."
                    .to_string(),
            mode: StudioImportMode::Table,
            source_hint: source_label.clone(),
            contract: import_contract(ImportContractInput {
                provenance_kind: StudioImportProvenanceKind::Table,
                provenance_label: source_label.clone(),
                member_count: 0,
                support_kind: StudioSupportKind::Volume,
                join_severity: &StudioAuditSeverity::Error,
                support_severity: &StudioAuditSeverity::Error,
                unmatched_rows: 0,
                duplicate_keys: 0,
                ready_for_compare: false,
                extra_capabilities: Vec::new(),
            }),
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
                            message:
                                "File path and subject ID columns must be mapped before preview."
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
            discovery: None,
        };
    }

    let file_col_idx = file_col_idx.unwrap();
    let subject_col_idx = subject_col_idx.unwrap();
    let design_columns: Vec<String> = headers
        .iter()
        .enumerate()
        .filter(|(index, header)| {
            *index != file_col_idx
                && *index != subject_col_idx
                && !excluded_columns.contains(*header)
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
            *subject_counts
                .entry(detail.subject_id.clone())
                .or_insert(0usize) += 1;
        }
    }
    let duplicate_subject_ids = subject_counts
        .iter()
        .filter_map(|(subject_id, count)| {
            if *count > 1 {
                Some(subject_id.clone())
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    let duplicate_subject_set = duplicate_subject_ids
        .iter()
        .cloned()
        .collect::<HashSet<_>>();
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
                let support_label = table_support_label(&signature);
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
                    bindings: Some(vec![binding_summary(BindingSummaryInput {
                        role: "statmap".to_string(),
                        feature_id: Some("feature-statmap".to_string()),
                        source_locator: Some(detail.source_path.clone()),
                        source_path: Some(detail.source_path.clone()),
                        relative_path: None,
                        selector: None,
                        support_kind: StudioSupportKind::Volume,
                        support_label: Some(support_label),
                        availability: StudioFieldBindingAvailability::Available,
                        is_primary: true,
                    })]),
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
        .filter(|detail| {
            !detail.subject_id.is_empty() && duplicate_subject_set.contains(&detail.subject_id)
        })
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
        .map(table_support_label)
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
        notes.push(
            "File paths and NIfTI support need cleanup before compare-safe reductions.".to_string(),
        );
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
            format!(
                "Validated {} importable member files from the table.",
                member_ids.len()
            )
        } else {
            format!(
                "Validated {} importable member files with {} audit issue(s).",
                member_ids.len(),
                issue_details.len()
            )
        },
        mode: StudioImportMode::Table,
        source_hint: source_label.clone(),
        contract: import_contract(ImportContractInput {
            provenance_kind: StudioImportProvenanceKind::Table,
            provenance_label: source_label.clone(),
            member_count: member_ids.len(),
            support_kind: StudioSupportKind::Volume,
            join_severity: &join_severity,
            support_severity: &support_severity,
            unmatched_rows,
            duplicate_keys,
            ready_for_compare,
            extra_capabilities: Vec::new(),
        }),
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
        discovery: None,
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

#[derive(Debug, Default)]
struct ResourceRegistryPreview {
    records: HashMap<String, ResourceRecord>,
    issue_count: usize,
    issue_details: Vec<StudioJoinIssueDetail>,
}

#[derive(Debug, Clone)]
struct ResourceRecord {
    backend: String,
    locator: String,
}

#[derive(Debug, Clone)]
struct RowSourceResolution {
    source_locator: Option<String>,
    source_path: Option<String>,
    relative_path: Option<String>,
    selector: Option<String>,
    availability: StudioFieldBindingAvailability,
    source_issue_count: usize,
    support_issue_count: usize,
    issue_details: Vec<StudioJoinIssueDetail>,
}

impl Default for RowSourceResolution {
    fn default() -> Self {
        Self {
            source_locator: None,
            source_path: None,
            relative_path: None,
            selector: None,
            availability: StudioFieldBindingAvailability::Unavailable,
            source_issue_count: 0,
            support_issue_count: 0,
            issue_details: Vec::new(),
        }
    }
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

fn inspect_resource_registry(
    manifest_file: &Path,
    manifest: &NeuroTabsManifest,
    feature_bindings: &[FeatureBindingPreview<'_>],
) -> ResourceRegistryPreview {
    let mut preview = ResourceRegistryPreview::default();
    let needs_resources = feature_bindings
        .iter()
        .any(|binding| feature_uses_resource_id(binding.feature));

    let Some(resources) = manifest.resources.as_ref() else {
        if needs_resources {
            push_registry_issue(
                &mut preview,
                "One or more manifest features use resource_id but no resources table is declared.",
            );
        }
        return preview;
    };

    let registry_path = resolve_relative_path(manifest_file, &resources.path);
    if !registry_path.exists() {
        push_registry_issue(
            &mut preview,
            format!(
                "Resource registry {} was not found.",
                registry_path.display()
            ),
        );
        return preview;
    }

    let delimiter = match resources.format {
        TableFormat::Csv => b',',
        TableFormat::Tsv => b'\t',
        TableFormat::Parquet => {
            push_registry_issue(
                &mut preview,
                "Parquet resource registry preview is not implemented yet.",
            );
            return preview;
        }
    };

    let mut reader = match ReaderBuilder::new()
        .delimiter(delimiter)
        .from_path(&registry_path)
    {
        Ok(reader) => reader,
        Err(error) => {
            push_registry_issue(
                &mut preview,
                format!(
                    "Failed to open resource registry {}: {}",
                    registry_path.display(),
                    error
                ),
            );
            return preview;
        }
    };

    let headers = match reader.headers() {
        Ok(headers) => headers.clone(),
        Err(error) => {
            push_registry_issue(
                &mut preview,
                format!(
                    "Failed to read headers from resource registry {}: {}",
                    registry_path.display(),
                    error
                ),
            );
            return preview;
        }
    };
    let Some(resource_id_index) = headers.iter().position(|header| header == "resource_id") else {
        push_registry_issue(
            &mut preview,
            "Resource registry is missing required resource_id column.",
        );
        return preview;
    };
    let Some(backend_index) = headers.iter().position(|header| header == "backend") else {
        push_registry_issue(
            &mut preview,
            "Resource registry is missing required backend column.",
        );
        return preview;
    };
    let Some(locator_index) = headers.iter().position(|header| header == "locator") else {
        push_registry_issue(
            &mut preview,
            "Resource registry is missing required locator column.",
        );
        return preview;
    };

    for record in reader.records() {
        let record = match record {
            Ok(record) => record,
            Err(error) => {
                push_registry_issue(
                    &mut preview,
                    format!(
                        "Failed to read row from resource registry {}: {}",
                        registry_path.display(),
                        error
                    ),
                );
                continue;
            }
        };
        let resource_id = record.get(resource_id_index).map(str::trim).unwrap_or("");
        let backend = record.get(backend_index).map(str::trim).unwrap_or("");
        let locator = record.get(locator_index).map(str::trim).unwrap_or("");
        if resource_id.is_empty() {
            push_registry_issue(
                &mut preview,
                "Resource registry contains a row with an empty resource_id.",
            );
            continue;
        }
        if backend.is_empty() || locator.is_empty() {
            push_registry_issue(
                &mut preview,
                format!(
                    "Resource registry row {} has empty backend or locator.",
                    resource_id
                ),
            );
            continue;
        }
        if preview.records.contains_key(resource_id) {
            push_registry_issue(
                &mut preview,
                format!(
                    "Resource registry contains duplicate resource_id {}.",
                    resource_id
                ),
            );
            continue;
        }
        preview.records.insert(
            resource_id.to_string(),
            ResourceRecord {
                backend: backend.to_string(),
                locator: locator.to_string(),
            },
        );
    }

    preview
}

fn feature_uses_resource_id(feature: &FeatureSchema) -> bool {
    feature.encodings.iter().any(|encoding| {
        matches!(
            encoding,
            FeatureEncoding::Ref { binding } if binding.resource_id.is_some()
        )
    })
}

fn push_registry_issue(preview: &mut ResourceRegistryPreview, message: impl Into<String>) {
    preview.issue_count += 1;
    preview.issue_details.push(StudioJoinIssueDetail {
        message: message.into(),
        member_ids: Vec::new(),
    });
}

fn resolve_row_source(
    manifest_file: &Path,
    headers: &csv::StringRecord,
    record: &csv::StringRecord,
    row_id: &str,
    primary_feature: Option<&FeatureSchema>,
    resource_registry: &ResourceRegistryPreview,
    fallback_source_path_index: Option<usize>,
) -> RowSourceResolution {
    if let Some(feature) = primary_feature {
        let mut saw_ref_encoding = false;
        for encoding in &feature.encodings {
            let FeatureEncoding::Ref { binding } = encoding else {
                continue;
            };
            saw_ref_encoding = true;
            let selector =
                match resolve_selector_source(headers, record, binding.selector.as_ref(), row_id) {
                    Ok(selector) => selector,
                    Err(resolution) => return resolution,
                };

            if let Some(resource_source) = &binding.resource_id {
                match resolve_string_source(headers, record, resource_source) {
                    SourceValue::Value(resource_id) => {
                        return resolve_resource_id_source(
                            manifest_file,
                            row_id,
                            feature,
                            resource_registry,
                            &resource_id,
                            selector,
                        );
                    }
                    SourceValue::MissingColumn(column) => {
                        return row_source_issue(
                            row_id,
                            format!(
                                "Resource id column {} was not found in the observation table.",
                                column
                            ),
                        );
                    }
                    SourceValue::Null => {}
                }
            }

            let Some(backend_source) = &binding.backend else {
                continue;
            };
            let Some(locator_source) = &binding.locator else {
                continue;
            };
            let backend = match resolve_string_source(headers, record, backend_source) {
                SourceValue::Value(value) => value,
                SourceValue::MissingColumn(column) => {
                    return row_source_issue(
                        row_id,
                        format!(
                            "Backend column {} was not found in the observation table.",
                            column
                        ),
                    );
                }
                SourceValue::Null => continue,
            };
            let locator = match resolve_string_source(headers, record, locator_source) {
                SourceValue::Value(value) => value,
                SourceValue::MissingColumn(column) => {
                    return row_source_issue(
                        row_id,
                        format!(
                            "Locator column {} was not found in the observation table.",
                            column
                        ),
                    );
                }
                SourceValue::Null => continue,
            };

            return resolve_locator_source(
                manifest_file,
                row_id,
                feature,
                &backend,
                &locator,
                Some(locator.clone()),
                if locator.contains("://") {
                    None
                } else {
                    Some(locator.clone())
                },
                selector,
            );
        }

        if saw_ref_encoding {
            return row_source_issue(
                row_id,
                "No applicable ref encoding resolved to a source for this row.",
            );
        }
    }

    resolve_fallback_source(manifest_file, record, row_id, fallback_source_path_index)
}

enum SourceValue {
    Value(String),
    Null,
    MissingColumn(String),
}

fn resolve_string_source(
    headers: &csv::StringRecord,
    record: &csv::StringRecord,
    source: &StringValueSource,
) -> SourceValue {
    match source {
        StringValueSource::Literal(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                SourceValue::Null
            } else {
                SourceValue::Value(trimmed.to_string())
            }
        }
        StringValueSource::Column { column } => {
            let Some(index) = headers.iter().position(|header| header == column) else {
                return SourceValue::MissingColumn(column.clone());
            };
            let trimmed = record.get(index).map(str::trim).unwrap_or("");
            if trimmed.is_empty() {
                SourceValue::Null
            } else {
                SourceValue::Value(trimmed.to_string())
            }
        }
    }
}

// Err variant carries rich row-resolution diagnostics by design; boxing would lose ergonomics.
#[allow(clippy::result_large_err)]
fn resolve_selector_source(
    headers: &csv::StringRecord,
    record: &csv::StringRecord,
    selector: Option<&JsonValueSource>,
    row_id: &str,
) -> Result<Option<String>, RowSourceResolution> {
    match selector {
        None => Ok(None),
        Some(JsonValueSource::Literal(value)) if value.is_null() => Ok(None),
        Some(JsonValueSource::Literal(value)) => Ok(Some(value.to_string())),
        Some(JsonValueSource::Column { column }) => {
            let Some(index) = headers.iter().position(|header| header == column) else {
                return Err(row_source_issue(
                    row_id,
                    format!(
                        "Selector column {} was not found in the observation table.",
                        column
                    ),
                ));
            };
            let trimmed = record.get(index).map(str::trim).unwrap_or("");
            if trimmed.is_empty() {
                Ok(None)
            } else {
                Ok(Some(trimmed.to_string()))
            }
        }
    }
}

fn resolve_resource_id_source(
    manifest_file: &Path,
    row_id: &str,
    feature: &FeatureSchema,
    resource_registry: &ResourceRegistryPreview,
    resource_id: &str,
    selector: Option<String>,
) -> RowSourceResolution {
    if resource_registry.records.is_empty() {
        return row_source_issue(
            row_id,
            format!(
                "Row {} uses resource_id {} but no resource registry record is available.",
                row_id, resource_id
            ),
        );
    }
    let Some(record) = resource_registry.records.get(resource_id) else {
        return row_source_issue(
            row_id,
            format!(
                "Row {} references resource_id {}, but the resource registry does not contain it.",
                row_id, resource_id
            ),
        );
    };
    resolve_locator_source(
        manifest_file,
        row_id,
        feature,
        &record.backend,
        &record.locator,
        Some(record.locator.clone()),
        if record.locator.contains("://") {
            None
        } else {
            Some(record.locator.clone())
        },
        selector,
    )
}

// Locator resolution threads manifest context + selectors positionally; struct adds no clarity.
#[allow(clippy::too_many_arguments)]
fn resolve_locator_source(
    manifest_file: &Path,
    row_id: &str,
    feature: &FeatureSchema,
    backend: &str,
    locator: &str,
    source_locator: Option<String>,
    relative_path: Option<String>,
    selector: Option<String>,
) -> RowSourceResolution {
    if locator.contains("://") {
        return RowSourceResolution {
            source_locator,
            source_path: None,
            relative_path,
            selector,
            availability: StudioFieldBindingAvailability::Unavailable,
            source_issue_count: 1,
            support_issue_count: 0,
            issue_details: vec![StudioJoinIssueDetail {
                message: format!(
                    "Row {} uses URI locator {}, which is not available to local preview.",
                    row_id, locator
                ),
                member_ids: vec![row_id.to_string()],
            }],
        };
    }
    let resolved_path = resolve_relative_path(manifest_file, locator);
    let source_path = Some(resolved_path.to_string_lossy().to_string());
    if !resolved_path.exists() {
        return RowSourceResolution {
            source_locator,
            source_path,
            relative_path,
            selector,
            availability: StudioFieldBindingAvailability::Missing,
            source_issue_count: 1,
            support_issue_count: 0,
            issue_details: vec![StudioJoinIssueDetail {
                message: format!(
                    "Resolved locator for row {} does not exist: {}.",
                    row_id,
                    resolved_path.display()
                ),
                member_ids: vec![row_id.to_string()],
            }],
        };
    }

    let mut resolution = RowSourceResolution {
        source_locator,
        source_path,
        relative_path,
        selector,
        availability: StudioFieldBindingAvailability::Available,
        source_issue_count: 0,
        support_issue_count: 0,
        issue_details: Vec::new(),
    };
    if feature.logical.kind.as_str() == "volume" {
        resolution
            .issue_details
            .extend(validate_nifti_volume_support(
                row_id,
                feature,
                backend,
                &resolved_path,
            ));
        resolution.support_issue_count = resolution.issue_details.len();
        if resolution.support_issue_count > 0 {
            resolution.availability = StudioFieldBindingAvailability::Invalid;
        }
    }
    resolution
}

fn validate_nifti_volume_support(
    row_id: &str,
    feature: &FeatureSchema,
    backend: &str,
    path: &Path,
) -> Vec<StudioJoinIssueDetail> {
    if !backend.eq_ignore_ascii_case("nifti") {
        return vec![StudioJoinIssueDetail {
            message: format!(
                "Row {} uses backend {}, but Brainflow compare validation currently expects nifti.",
                row_id, backend
            ),
            member_ids: vec![row_id.to_string()],
        }];
    }

    let signature = match inspect_table_volume_support(path) {
        Ok(signature) => signature,
        Err(message) => {
            return vec![StudioJoinIssueDetail {
                message,
                member_ids: vec![row_id.to_string()],
            }];
        }
    };
    let Some(shape) = &feature.logical.shape else {
        return Vec::new();
    };
    if shape.len() >= 3 && signature.dims != [shape[0], shape[1], shape[2]] {
        return vec![StudioJoinIssueDetail {
            message: format!(
                "Row {} volume shape {:?} does not match declared logical shape {:?}.",
                row_id, signature.dims, shape
            ),
            member_ids: vec![row_id.to_string()],
        }];
    }
    Vec::new()
}

fn resolve_fallback_source(
    manifest_file: &Path,
    record: &csv::StringRecord,
    row_id: &str,
    fallback_source_path_index: Option<usize>,
) -> RowSourceResolution {
    let Some(index) = fallback_source_path_index else {
        return RowSourceResolution::default();
    };
    let Some(raw_path) = record
        .get(index)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return row_source_issue(row_id, "Row is missing a bindable source path.");
    };
    let resolved_path = resolve_relative_path(manifest_file, raw_path);
    let source_path = Some(resolved_path.to_string_lossy().to_string());
    if !resolved_path.exists() {
        return RowSourceResolution {
            source_locator: Some(raw_path.to_string()),
            source_path,
            relative_path: Some(raw_path.to_string()),
            selector: None,
            availability: StudioFieldBindingAvailability::Missing,
            source_issue_count: 1,
            support_issue_count: 0,
            issue_details: vec![StudioJoinIssueDetail {
                message: format!(
                    "Resolved source path for row {} does not exist: {}.",
                    row_id,
                    resolved_path.display()
                ),
                member_ids: vec![row_id.to_string()],
            }],
        };
    }
    RowSourceResolution {
        source_locator: Some(raw_path.to_string()),
        source_path,
        relative_path: Some(raw_path.to_string()),
        selector: None,
        availability: StudioFieldBindingAvailability::Available,
        source_issue_count: 0,
        support_issue_count: 0,
        issue_details: Vec::new(),
    }
}

fn row_source_issue(row_id: &str, message: impl Into<String>) -> RowSourceResolution {
    RowSourceResolution {
        source_locator: None,
        source_path: None,
        relative_path: None,
        selector: None,
        availability: StudioFieldBindingAvailability::Missing,
        source_issue_count: 1,
        support_issue_count: 0,
        issue_details: vec![StudioJoinIssueDetail {
            message: message.into(),
            member_ids: vec![row_id.to_string()],
        }],
    }
}

fn append_limited_issue_details(
    target: &mut Vec<StudioJoinIssueDetail>,
    details: Vec<StudioJoinIssueDetail>,
    limit: usize,
) {
    let remaining = limit.saturating_sub(target.len());
    target.extend(details.into_iter().take(remaining));
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
    manifest: &NeuroTabsManifest,
    primary_feature: &FeatureSchema,
) -> (
    StudioSupportKind,
    String,
    StudioAlignmentClass,
    bool,
    Vec<String>,
) {
    let logical_kind = primary_feature.logical.kind.as_str();
    let logical_alignment = primary_feature
        .logical
        .alignment
        .map(|alignment| map_alignment_class(alignment.as_str()));

    if let Some(support_ref) = primary_feature.logical.support_ref.as_deref() {
        if let Some(support) = manifest.supports.get(support_ref) {
            match support {
                SupportSchema::Volume(support) => {
                    return (
                        StudioSupportKind::Volume,
                        format!("{} ({})", support.space, support.grid_id),
                        logical_alignment.unwrap_or(StudioAlignmentClass::SameGrid),
                        true,
                        vec![format!(
                            "Primary feature resolves against support {} with exact grid {}.",
                            support_ref, support.grid_id
                        )],
                    );
                }
                SupportSchema::Surface(support) => {
                    let hemisphere = format!("{:?}", support.hemisphere).to_lowercase();
                    return (
                        StudioSupportKind::Surface,
                        format!(
                            "{} / {} / {}",
                            support.template, hemisphere, support.topology_id
                        ),
                        logical_alignment.unwrap_or(StudioAlignmentClass::SameTopology),
                        false,
                        vec![
                            format!("Primary feature resolves against surface support {}.", support_ref),
                            "Surface compare materialization is not implemented yet; import is inspect-only.".to_string(),
                        ],
                    );
                }
                SupportSchema::Parcel(support) => {
                    return (
                        StudioSupportKind::Unknown,
                        format!("{} ({} parcels)", support.space, support.n_parcels),
                        logical_alignment.unwrap_or(StudioAlignmentClass::Unknown),
                        false,
                        vec![format!(
                            "Primary feature resolves against parcel support {}.",
                            support_ref
                        )],
                    );
                }
                SupportSchema::Generic(support) => {
                    return (
                        StudioSupportKind::Unknown,
                        support.support_id.clone(),
                        logical_alignment.unwrap_or(StudioAlignmentClass::Unknown),
                        false,
                        vec![format!(
                            "Primary feature resolves against generic support {}.",
                            support_ref
                        )],
                    );
                }
            }
        }
    }

    let support_kind = match logical_kind {
        "volume" => StudioSupportKind::Volume,
        "surface" => StudioSupportKind::Surface,
        _ => StudioSupportKind::Unknown,
    };
    let support_label = primary_feature
        .logical
        .space
        .as_deref()
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

fn feature_support_kind(feature: &FeatureSchema) -> StudioSupportKind {
    match feature.logical.kind.as_str() {
        "volume" => StudioSupportKind::Volume,
        "surface" => StudioSupportKind::Surface,
        _ => StudioSupportKind::Unknown,
    }
}

fn manifest_binding_support_label(
    manifest: &NeuroTabsManifest,
    feature: &FeatureSchema,
) -> Option<String> {
    let support_ref = feature.logical.support_ref.as_deref()?;
    let support = manifest.supports.get(support_ref)?;
    Some(match support {
        SupportSchema::Volume(support) => format!("{} ({})", support.space, support.grid_id),
        SupportSchema::Surface(support) => {
            let hemisphere = format!("{:?}", support.hemisphere).to_lowercase();
            format!(
                "{} / {} / {}",
                support.template, hemisphere, support.topology_id
            )
        }
        SupportSchema::Parcel(support) => {
            format!("{} ({} parcels)", support.space, support.n_parcels)
        }
        SupportSchema::Generic(support) => support.support_id.clone(),
    })
}

fn map_alignment_class(value: &str) -> StudioAlignmentClass {
    match value {
        "same_grid" | "same-grid" => StudioAlignmentClass::SameGrid,
        "same_space" | "same-space" => StudioAlignmentClass::SameSpace,
        "same_topology" | "same-topology" => StudioAlignmentClass::SameTopology,
        "loose" | "mixed" => StudioAlignmentClass::Mixed,
        "none" => StudioAlignmentClass::Unknown,
        _ => StudioAlignmentClass::Unknown,
    }
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

fn title_case(value: &str) -> String {
    value.replace(['_', '-'], " ")
}
