use super::{
    binding_summary, import_contract, inspect_table_volume_support, table_support_label,
    BindingSummaryInput, ImportContractInput, TableSupportSignature,
};
use bridge_types::{
    SpatialFieldSetSummary, StudioAlignmentClass, StudioAuditSeverity, StudioCohortOriginKind,
    StudioCohortSummary, StudioDesignRowPreview, StudioDesignTablePreview, StudioExpressionKind,
    StudioFeatureSummary, StudioFieldBindingAvailability, StudioFieldExpressionSummary,
    StudioImportCandidate, StudioImportMode, StudioImportPreviewRequest,
    StudioImportProvenanceKind, StudioIngestAuditSummary, StudioJoinAuditSummary,
    StudioJoinIssueDetail, StudioMaterializationStatus, StudioMemberSummary,
    StudioSupportAuditSummary, StudioSupportKind,
};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

pub(super) fn table_candidate(request: &StudioImportPreviewRequest) -> StudioImportCandidate {
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

    let invalid_shape = headers
        .iter()
        .any(|header| header.trim().is_empty() || header != header.trim())
        || headers.iter().collect::<HashSet<_>>().len() != headers.len()
        || rows.iter().any(|row| row.len() != headers.len());
    if headers.is_empty()
        || rows.is_empty()
        || file_col_idx.is_none()
        || subject_col_idx.is_none()
        || invalid_shape
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
                            message: if invalid_shape {
                                "Table metadata requires unique nonempty column names and equal row widths.".to_string()
                            } else {
                                "File path and observation ID columns must be mapped before preview.".to_string()
                            },
                            member_ids: Vec::new(),
                        }],
                    },
                    support: StudioSupportAuditSummary {
                        support_label: "unknown (pending validation)".to_string(),
                        alignment_class: StudioAlignmentClass::Unknown,
                        ready_for_compare: false,
                        severity: StudioAuditSeverity::Error,
                    },
                    notes: vec!["Use unique nonempty column names, equal row widths, and map the file path and observation ID columns to continue.".to_string()],
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
            design_values: headers
                .iter()
                .enumerate()
                .filter(|(index, header)| {
                    *index == subject_col_idx
                        || (*index != file_col_idx && !excluded_columns.contains(*header))
                })
                .map(|(index, header)| (header.clone(), row[index].clone()))
                .collect(),
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
                    design_values: Some(detail.design_values.clone()),
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
    design_values: std::collections::BTreeMap<String, String>,
    subject_id: String,
    source_path: String,
}
