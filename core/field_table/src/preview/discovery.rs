use super::{
    binding_summary, derive_member_id_from_path, import_contract, inspect_table_volume_support,
    table_support_label, title_case, unavailable_primary_binding, BindingSummaryInput,
    ImportContractInput, TableSupportSignature,
};
use bridge_types::{
    SpatialFieldSetSummary, StudioAlignmentClass, StudioAuditSeverity, StudioCohortOriginKind,
    StudioCohortSummary, StudioDesignRowPreview, StudioDesignTablePreview,
    StudioDiscoveryDesignValue, StudioDiscoveryMemberGroup, StudioDiscoveryPreviewSummary,
    StudioDiscoveryRoleBinding, StudioDiscoveryRolePattern, StudioExpressionKind,
    StudioFeatureSummary, StudioFieldBindingAvailability, StudioFieldBindingSummary,
    StudioFieldExpressionSummary, StudioImportCandidate, StudioImportCapability, StudioImportMode,
    StudioImportPreviewRequest, StudioImportProvenanceKind, StudioIngestAuditSummary,
    StudioJoinAuditSummary, StudioJoinIssueDetail, StudioMaterializationStatus,
    StudioMemberSummary, StudioSupportAuditSummary, StudioSupportKind,
};
use regex::Regex;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

#[derive(Clone, Debug, Default)]
pub struct DiscoveryInventory {
    pub root_exists: bool,
    pub source_label: Option<String>,
    pub root_issue: Option<String>,
    pub files: Vec<DiscoveryInventoryFile>,
    pub notes: Vec<String>,
    pub sample_header: Option<DiscoverySampleHeader>,
    pub sample_header_error: Option<String>,
}

#[derive(Clone, Debug)]
pub struct DiscoveryInventoryFile {
    pub source_path: String,
    pub relative_path: String,
}

#[derive(Clone, Debug)]
pub struct DiscoverySampleHeader {
    pub source_path: String,
    pub local_path: PathBuf,
    pub note: String,
}

pub(super) fn regex_candidate(
    request: &StudioImportPreviewRequest,
    discovery_inventory: Option<&DiscoveryInventory>,
) -> StudioImportCandidate {
    let discovery_root = request
        .discovery_root
        .clone()
        .unwrap_or_else(|| ".".to_string());
    let file_pattern = request
        .file_pattern
        .clone()
        .unwrap_or_else(|| String::from(r".*_statmap\.nii(\.gz)?$"));
    let regex = Regex::new(&file_pattern).ok();
    let root_exists = discovery_inventory
        .map(|inventory| inventory.root_exists)
        .unwrap_or_else(|| Path::new(&discovery_root).exists());
    let discovery = build_discovery_preview(
        request,
        &discovery_root,
        &file_pattern,
        regex.as_ref(),
        root_exists,
        discovery_inventory,
    );
    let regex_member_ids = discovery
        .member_summaries
        .iter()
        .map(|member| member.id.clone())
        .collect::<Vec<_>>();
    let feature_roles = if discovery.summary.observed_roles.is_empty() {
        vec!["statmap".to_string()]
    } else {
        discovery.summary.observed_roles.clone()
    };
    let features = feature_roles
        .iter()
        .map(|role| StudioFeatureSummary {
            id: role.clone(),
            label: title_case(role),
            kind: StudioSupportKind::Volume,
        })
        .collect::<Vec<_>>();
    let generated_cohorts = if regex_member_ids.is_empty() {
        Vec::new()
    } else {
        vec![StudioCohortSummary {
            id: "all-members".to_string(),
            label: "All members".to_string(),
            member_count: regex_member_ids.len(),
            description: "Discovery-backed cohort spanning all grouped members.".to_string(),
            member_ids: regex_member_ids.clone(),
            origin_kind: StudioCohortOriginKind::Imported,
            origin_label: Some("Regex discovery preview".to_string()),
        }]
    };
    let mut expressions = vec![StudioFieldExpressionSummary {
        id: "regex-member".to_string(),
        label: "Current member".to_string(),
        kind: StudioExpressionKind::Member,
        recipe: "member(sample)".to_string(),
        cohort_id: None,
    }];
    if discovery.ready_for_compare && !generated_cohorts.is_empty() {
        expressions.push(StudioFieldExpressionSummary {
            id: "regex-compare-zscore".to_string(),
            label: "Z-score vs all members".to_string(),
            kind: StudioExpressionKind::Comparison,
            recipe: "zscore(current, cohort:all-members)".to_string(),
            cohort_id: Some("all-members".to_string()),
        });
    }

    StudioImportCandidate {
        id: "candidate-regex-b".to_string(),
        label: "Regex discovery preview".to_string(),
        description: discovery.description.clone(),
        mode: StudioImportMode::Regex,
        source_hint: discovery.source_hint.clone(),
        contract: import_contract(ImportContractInput {
            provenance_kind: StudioImportProvenanceKind::RegexDiscovery,
            provenance_label: discovery.source_hint.clone(),
            member_count: regex_member_ids.len(),
            support_kind: StudioSupportKind::Volume,
            join_severity: &discovery.join_severity,
            support_severity: &discovery.support_severity,
            unmatched_rows: discovery.summary.unmatched_files,
            duplicate_keys: discovery.summary.duplicate_keys,
            ready_for_compare: discovery.ready_for_compare,
            extra_capabilities: vec![StudioImportCapability::ExportNeurotabs],
        }),
        set: SpatialFieldSetSummary {
            id: "study-regex-preview".to_string(),
            name: discovery.set_name.clone(),
            member_count: regex_member_ids.len(),
            primary_feature_id: Some(discovery.primary_role.clone()),
            support_kind: StudioSupportKind::Volume,
            support_label: discovery.support_label.clone(),
            alignment_class: discovery.alignment_class.clone(),
            design_columns: discovery.design_columns.clone(),
            design_table_preview: Some(StudioDesignTablePreview {
                columns: discovery.design_columns.clone(),
                rows: discovery.preview_rows.clone(),
            }),
            member_summaries: discovery.member_summaries.clone(),
            member_ids: regex_member_ids.clone(),
            saved_cohort_ids: generated_cohorts
                .iter()
                .map(|cohort| cohort.id.clone())
                .collect(),
            ingest_audit: StudioIngestAuditSummary {
                source_label: "Regex discovery".to_string(),
                join: StudioJoinAuditSummary {
                    matched_rows: discovery.summary.groups.len(),
                    unmatched_rows: discovery.summary.unmatched_files,
                    duplicate_keys: discovery.summary.duplicate_keys,
                    severity: discovery.join_severity.clone(),
                    issue_details: discovery.issue_details.clone(),
                },
                support: StudioSupportAuditSummary {
                    support_label: discovery.support_label.clone(),
                    alignment_class: discovery.alignment_class.clone(),
                    ready_for_compare: discovery.ready_for_compare,
                    severity: discovery.support_severity.clone(),
                },
                notes: discovery.notes.clone(),
            },
        },
        features,
        cohorts: generated_cohorts,
        expressions,
        materialization: Some(StudioMaterializationStatus {
            warm: 0,
            preview: regex_member_ids.len(),
            pending: 0,
            failed: discovery.summary.unmatched_files,
        }),
        discovery: Some(discovery.summary),
    }
}

const DEFAULT_DISCOVERY_MAX_FILES: usize = 200;
const DEFAULT_DISCOVERY_ROLE: &str = "statmap";

#[derive(Clone, Debug)]
struct DiscoveryBuildResult {
    summary: StudioDiscoveryPreviewSummary,
    member_summaries: Vec<StudioMemberSummary>,
    design_columns: Vec<String>,
    preview_rows: Vec<StudioDesignRowPreview>,
    primary_role: String,
    support_label: String,
    alignment_class: StudioAlignmentClass,
    support_severity: StudioAuditSeverity,
    join_severity: StudioAuditSeverity,
    ready_for_compare: bool,
    issue_details: Vec<StudioJoinIssueDetail>,
    notes: Vec<String>,
    description: String,
    source_hint: String,
    set_name: String,
}

#[derive(Clone, Debug)]
struct DiscoveryFileMatch {
    source_path: String,
    relative_path: String,
    member_id: String,
    role: String,
    role_confidence: f32,
    design_values: Vec<StudioDiscoveryDesignValue>,
}

fn build_discovery_preview(
    request: &StudioImportPreviewRequest,
    discovery_root: &str,
    file_pattern: &str,
    regex: Option<&Regex>,
    root_exists: bool,
    discovery_inventory: Option<&DiscoveryInventory>,
) -> DiscoveryBuildResult {
    let max_files = request
        .discovery_max_files
        .unwrap_or(DEFAULT_DISCOVERY_MAX_FILES)
        .max(1);
    let max_depth = request.discovery_max_depth;
    let dry_run = request.discovery_dry_run.unwrap_or(true);
    let sample_headers = request.discovery_sample_headers.unwrap_or(false);
    let capture_names = regex
        .map(|regex| {
            regex
                .capture_names()
                .flatten()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let role_patterns = discovery_role_patterns(request);
    let (include_regexes, invalid_include_patterns) =
        compile_discovery_patterns(request.discovery_include_patterns.as_deref());
    let (exclude_regexes, invalid_exclude_patterns) =
        compile_discovery_patterns(request.discovery_exclude_patterns.as_deref());
    let mut invalid_filter_patterns = invalid_include_patterns;
    invalid_filter_patterns.extend(invalid_exclude_patterns);

    let mut issue_details = Vec::new();
    if !root_exists {
        issue_details.push(StudioJoinIssueDetail {
            message: discovery_inventory
                .and_then(|inventory| inventory.root_issue.clone())
                .unwrap_or_else(|| "Discovery root does not exist on disk.".to_string()),
            member_ids: Vec::new(),
        });
    } else if let Some(root_issue) =
        discovery_inventory.and_then(|inventory| inventory.root_issue.clone())
    {
        issue_details.push(StudioJoinIssueDetail {
            message: root_issue,
            member_ids: Vec::new(),
        });
    }
    if regex.is_none() {
        issue_details.push(StudioJoinIssueDetail {
            message: "The requested file pattern could not be compiled as a regex.".to_string(),
            member_ids: Vec::new(),
        });
    }
    if !invalid_filter_patterns.is_empty() {
        issue_details.push(StudioJoinIssueDetail {
            message: format!(
                "Invalid include/exclude regex pattern(s): {}.",
                invalid_filter_patterns.join(", ")
            ),
            member_ids: Vec::new(),
        });
    }

    let (matches, unmatched_files, truncated) = if root_exists {
        match regex {
            Some(regex) => {
                if let Some(inventory) = discovery_inventory {
                    discover_grouped_inventory_files(
                        &inventory.files,
                        regex,
                        &capture_names,
                        &include_regexes,
                        &exclude_regexes,
                        &role_patterns,
                        max_files,
                    )
                } else {
                    discover_grouped_files(
                        discovery_root,
                        regex,
                        &capture_names,
                        &include_regexes,
                        &exclude_regexes,
                        &role_patterns,
                        max_depth,
                        max_files,
                    )
                }
            }
            None => (Vec::new(), Vec::new(), false),
        }
    } else {
        (Vec::new(), Vec::new(), false)
    };

    let grouped = group_discovery_matches(matches, request.discovery_required_roles.as_deref());
    let observed_roles = grouped.observed_roles.clone();
    let required_roles = grouped.required_roles.clone();
    let design_columns = grouped.design_columns.clone();
    let mut member_summaries = grouped
        .groups
        .iter()
        .map(|group| StudioMemberSummary {
            id: group.member_id.clone(),
            source_path: select_primary_source_path(group, &grouped.primary_role),
            bindings: Some(discovery_member_bindings(
                group,
                &grouped.primary_role,
                Some("headers not sampled".to_string()),
            )),
        })
        .collect::<Vec<_>>();
    let preview_rows = grouped
        .groups
        .iter()
        .take(6)
        .map(|group| design_row_from_group(group, &design_columns))
        .collect::<Vec<_>>();

    let missing_role_members = grouped
        .groups
        .iter()
        .filter(|group| !group.missing_roles.is_empty())
        .map(|group| group.member_id.clone())
        .collect::<Vec<_>>();
    let duplicate_role_members = grouped
        .groups
        .iter()
        .filter(|group| !group.duplicate_roles.is_empty())
        .map(|group| group.member_id.clone())
        .collect::<Vec<_>>();

    if grouped.groups.is_empty() && root_exists && regex.is_some() {
        issue_details.push(StudioJoinIssueDetail {
            message: "No files matched the discovery pattern.".to_string(),
            member_ids: Vec::new(),
        });
    }
    if !unmatched_files.is_empty() {
        issue_details.push(StudioJoinIssueDetail {
            message: format!(
                "{} neuroimaging file(s) under the root did not match the discovery pattern.",
                unmatched_files.len()
            ),
            member_ids: unmatched_files.iter().take(8).cloned().collect(),
        });
    }
    if !missing_role_members.is_empty() {
        issue_details.push(StudioJoinIssueDetail {
            message: format!(
                "{} member group(s) are missing required role bindings.",
                missing_role_members.len()
            ),
            member_ids: missing_role_members,
        });
    }
    if !duplicate_role_members.is_empty() {
        issue_details.push(StudioJoinIssueDetail {
            message: format!(
                "{} member group(s) contain duplicate role bindings.",
                duplicate_role_members.len()
            ),
            member_ids: duplicate_role_members,
        });
    }
    if truncated {
        issue_details.push(StudioJoinIssueDetail {
            message: format!(
                "Discovery was truncated after {} matched file(s).",
                max_files
            ),
            member_ids: Vec::new(),
        });
    }

    let mut support_label = "headers not sampled".to_string();
    let mut alignment_class = StudioAlignmentClass::SameSpace;
    let mut support_severity = StudioAuditSeverity::Ok;
    if sample_headers {
        if discovery_inventory.is_none() {
            let support = inspect_local_discovery_support(&grouped.groups);
            support_label = support.support_label;
            alignment_class = support.alignment_class;
            support_severity = support.severity;
            issue_details.extend(support.issue_details);
        } else {
            let sample_header =
                discovery_inventory.and_then(|inventory| inventory.sample_header.as_ref());
            let sample_error =
                discovery_inventory.and_then(|inventory| inventory.sample_header_error.as_ref());
            let local_sample_path = sample_header.map(|sample| sample.local_path.as_path());

            match local_sample_path.map(inspect_table_volume_support) {
                Some(Ok(signature)) => {
                    support_label = format!("{} (sampled)", table_support_label(&signature));
                    alignment_class = StudioAlignmentClass::SameGrid;
                }
                Some(Err(message)) => {
                    support_label = "sample header could not be read".to_string();
                    support_severity = StudioAuditSeverity::Warning;
                    issue_details.push(StudioJoinIssueDetail {
                        message,
                        member_ids: Vec::new(),
                    });
                }
                None => {
                    if let Some(message) = sample_error {
                        support_label = "sample header could not be read".to_string();
                        support_severity = StudioAuditSeverity::Warning;
                        issue_details.push(StudioJoinIssueDetail {
                            message: message.clone(),
                            member_ids: Vec::new(),
                        });
                    } else if grouped.groups.is_empty() {
                        support_label = "no sampled source path".to_string();
                        support_severity = StudioAuditSeverity::Error;
                    } else {
                        support_label = "headers not sampled".to_string();
                        support_severity = StudioAuditSeverity::Warning;
                        issue_details.push(StudioJoinIssueDetail {
                            message:
                                "Remote discovery did not stage a sample header for validation."
                                    .to_string(),
                            member_ids: Vec::new(),
                        });
                    }
                }
            }
        }
    }
    for member in &mut member_summaries {
        for binding in member.bindings.iter_mut().flatten() {
            binding.support_label = Some(support_label.clone());
        }
    }

    let duplicate_keys = grouped
        .groups
        .iter()
        .map(|group| group.duplicate_roles.len())
        .sum::<usize>();
    let missing_role_count = grouped
        .groups
        .iter()
        .map(|group| group.missing_roles.len())
        .sum::<usize>();
    let has_error = !root_exists || regex.is_none() || grouped.groups.is_empty();
    let join_severity = if has_error {
        StudioAuditSeverity::Error
    } else if duplicate_keys > 0
        || missing_role_count > 0
        || !unmatched_files.is_empty()
        || truncated
        || !invalid_filter_patterns.is_empty()
    {
        StudioAuditSeverity::Warning
    } else {
        StudioAuditSeverity::Ok
    };
    let ready_for_compare = root_exists
        && regex.is_some()
        && !grouped.groups.is_empty()
        && duplicate_keys == 0
        && missing_role_count == 0
        && support_severity != StudioAuditSeverity::Error;

    let mut notes = discovery_notes(
        root_exists,
        regex.is_some(),
        grouped.groups.len(),
        observed_roles.as_slice(),
        required_roles.as_slice(),
        unmatched_files.len(),
        duplicate_keys,
        missing_role_count,
        truncated,
    );
    if let Some(inventory) = discovery_inventory {
        notes.extend(inventory.notes.clone());
        if let Some(sample_header) = &inventory.sample_header {
            notes.push(sample_header.note.clone());
        }
    }
    let description = if !root_exists {
        discovery_inventory
            .and_then(|inventory| inventory.root_issue.clone())
            .unwrap_or_else(|| format!("Discovery root {} does not exist.", discovery_root))
    } else if regex.is_none() {
        "Regex pattern could not be compiled.".to_string()
    } else {
        format!(
            "Grouped {} matched file(s) into {} member set(s) beneath {}.",
            grouped.matched_files,
            grouped.groups.len(),
            discovery_root
        )
    };
    let mut source_hint = format!(
        "root={} pattern={} maxDepth={} maxFiles={}",
        discovery_root,
        file_pattern,
        max_depth
            .map(|depth| depth.to_string())
            .unwrap_or_else(|| "unbounded".to_string()),
        max_files
    );
    if let Some(source_label) =
        discovery_inventory.and_then(|inventory| inventory.source_label.as_ref())
    {
        source_hint.push_str(&format!(" source={}", source_label));
    }
    let set_name = discovery_inventory
        .and_then(|inventory| inventory.source_label.clone())
        .map(|label| format!("{} / Discovery Import", label))
        .or_else(|| {
            Path::new(discovery_root)
                .file_name()
                .and_then(|value| value.to_str())
                .filter(|value| !value.is_empty())
                .map(|value| format!("{} / Discovery Import", value))
        })
        .unwrap_or_else(|| "Discovery Import".to_string());

    let summary = StudioDiscoveryPreviewSummary {
        root: discovery_root.to_string(),
        file_pattern: file_pattern.to_string(),
        include_patterns: request
            .discovery_include_patterns
            .clone()
            .unwrap_or_default(),
        exclude_patterns: request
            .discovery_exclude_patterns
            .clone()
            .unwrap_or_default(),
        role_patterns,
        max_depth,
        max_files,
        dry_run,
        sample_headers,
        capture_names,
        inferred_design_columns: design_columns.clone(),
        observed_roles,
        required_roles,
        matched_files: grouped.matched_files,
        unmatched_files: unmatched_files.len(),
        duplicate_keys,
        truncated,
        groups: grouped.groups,
    };

    DiscoveryBuildResult {
        summary,
        member_summaries,
        design_columns,
        preview_rows,
        primary_role: grouped.primary_role,
        support_label,
        alignment_class,
        support_severity,
        join_severity,
        ready_for_compare,
        issue_details,
        notes,
        description,
        source_hint,
        set_name,
    }
}

struct DiscoverySupportInspection {
    support_label: String,
    alignment_class: StudioAlignmentClass,
    severity: StudioAuditSeverity,
    issue_details: Vec<StudioJoinIssueDetail>,
}

fn inspect_local_discovery_support(
    groups: &[StudioDiscoveryMemberGroup],
) -> DiscoverySupportInspection {
    let mut reference: Option<TableSupportSignature> = None;
    let mut support_label = "no sampled source path".to_string();
    let mut read_error_members = Vec::new();
    let mut read_error_messages = Vec::new();
    let mut mismatch_members = Vec::new();

    for group in groups {
        for binding in &group.bindings {
            match inspect_table_volume_support(Path::new(&binding.source_path)) {
                Ok(signature) => {
                    if let Some(reference_signature) = reference.as_ref() {
                        if reference_signature != &signature {
                            mismatch_members.push(group.member_id.clone());
                        }
                    } else {
                        support_label = format!("{} (sampled)", table_support_label(&signature));
                        reference = Some(signature);
                    }
                }
                Err(message) => {
                    read_error_members.push(group.member_id.clone());
                    read_error_messages.push(message);
                }
            }
        }
    }

    let mut issue_details = Vec::new();
    if !read_error_messages.is_empty() {
        read_error_members.sort();
        read_error_members.dedup();
        issue_details.push(StudioJoinIssueDetail {
            message: format!(
                "{} matched image header(s) could not be read; first error: {}",
                read_error_messages.len(),
                read_error_messages[0]
            ),
            member_ids: read_error_members,
        });
    }
    if !mismatch_members.is_empty() {
        mismatch_members.sort();
        mismatch_members.dedup();
        issue_details.push(StudioJoinIssueDetail {
            message: format!(
                "{} member group(s) use a different grid than the first sampled image.",
                mismatch_members.len()
            ),
            member_ids: mismatch_members,
        });
    }

    if !issue_details.is_empty() {
        return DiscoverySupportInspection {
            support_label: if reference.is_some() {
                "mixed volume grids (sampled)".to_string()
            } else {
                "sample headers could not be read".to_string()
            },
            alignment_class: StudioAlignmentClass::Mixed,
            severity: StudioAuditSeverity::Error,
            issue_details,
        };
    }

    if reference.is_none() {
        return DiscoverySupportInspection {
            support_label,
            alignment_class: StudioAlignmentClass::SameSpace,
            severity: StudioAuditSeverity::Error,
            issue_details: Vec::new(),
        };
    }

    DiscoverySupportInspection {
        support_label,
        alignment_class: StudioAlignmentClass::SameGrid,
        severity: StudioAuditSeverity::Ok,
        issue_details,
    }
}

#[derive(Clone, Debug)]
struct DiscoveryGroupedResult {
    groups: Vec<StudioDiscoveryMemberGroup>,
    observed_roles: Vec<String>,
    required_roles: Vec<String>,
    design_columns: Vec<String>,
    primary_role: String,
    matched_files: usize,
}

// Discovery entry point threading root + many filter/grouping options positionally.
#[allow(clippy::too_many_arguments)]
fn discover_grouped_files(
    root: &str,
    regex: &Regex,
    capture_names: &[String],
    include_regexes: &[Regex],
    exclude_regexes: &[Regex],
    role_patterns: &[StudioDiscoveryRolePattern],
    max_depth: Option<usize>,
    max_files: usize,
) -> (Vec<DiscoveryFileMatch>, Vec<String>, bool) {
    let root_path = Path::new(root);
    let mut walker = WalkDir::new(root_path);
    if let Some(depth) = max_depth {
        walker = walker.max_depth(depth.saturating_add(1));
    }

    let mut matches = Vec::new();
    let mut unmatched_files = Vec::new();
    let mut truncated = false;

    for entry in walker.into_iter().filter_map(Result::ok) {
        if !entry.file_type().is_file() {
            continue;
        }

        let path = entry.path();
        let relative_path = path
            .strip_prefix(root_path)
            .map(normalize_path)
            .unwrap_or_else(|_| normalize_path(path));
        let source_path = path.to_string_lossy().to_string();
        let normalized_source_path = normalize_path(path);

        if matches_any(exclude_regexes, &relative_path, &normalized_source_path) {
            continue;
        }
        if !include_regexes.is_empty()
            && !matches_any(include_regexes, &relative_path, &normalized_source_path)
        {
            continue;
        }

        let Some(captures) = capture_named_values(
            regex,
            capture_names,
            &relative_path,
            &normalized_source_path,
        ) else {
            if is_neuroimaging_path(path) {
                unmatched_files.push(relative_path);
            }
            continue;
        };

        if matches.len() >= max_files {
            truncated = true;
            continue;
        }

        let member_id = derive_discovery_member_id(&captures, &relative_path, matches.len());
        let (role, role_confidence) = captures
            .get("role")
            .map(|value| {
                let normalized = normalize_role(value, role_patterns).unwrap_or_else(|| {
                    sanitize_role(value).unwrap_or(DEFAULT_DISCOVERY_ROLE.to_string())
                });
                (normalized, 1.0)
            })
            .unwrap_or_else(|| infer_role_from_path(&relative_path, role_patterns));
        let design_values = discovery_design_values(&captures, &member_id);

        matches.push(DiscoveryFileMatch {
            source_path,
            relative_path,
            member_id,
            role,
            role_confidence,
            design_values,
        });
    }

    matches.sort_by(|left, right| {
        left.member_id
            .cmp(&right.member_id)
            .then(left.role.cmp(&right.role))
            .then(left.relative_path.cmp(&right.relative_path))
    });
    unmatched_files.sort();
    (matches, unmatched_files, truncated)
}

fn discover_grouped_inventory_files(
    files: &[DiscoveryInventoryFile],
    regex: &Regex,
    capture_names: &[String],
    include_regexes: &[Regex],
    exclude_regexes: &[Regex],
    role_patterns: &[StudioDiscoveryRolePattern],
    max_files: usize,
) -> (Vec<DiscoveryFileMatch>, Vec<String>, bool) {
    let mut matches = Vec::new();
    let mut unmatched_files = Vec::new();
    let mut truncated = false;

    for file in files {
        let relative_path = normalize_path(Path::new(&file.relative_path));
        let normalized_source_path = normalize_path(Path::new(&file.source_path));

        if matches_any(exclude_regexes, &relative_path, &normalized_source_path) {
            continue;
        }
        if !include_regexes.is_empty()
            && !matches_any(include_regexes, &relative_path, &normalized_source_path)
        {
            continue;
        }

        let Some(captures) = capture_named_values(
            regex,
            capture_names,
            &relative_path,
            &normalized_source_path,
        ) else {
            if is_neuroimaging_value(&relative_path)
                || is_neuroimaging_value(&normalized_source_path)
            {
                unmatched_files.push(relative_path);
            }
            continue;
        };

        if matches.len() >= max_files {
            truncated = true;
            continue;
        }

        let member_id = derive_discovery_member_id(&captures, &relative_path, matches.len());
        let (role, role_confidence) = captures
            .get("role")
            .map(|value| {
                let normalized = normalize_role(value, role_patterns).unwrap_or_else(|| {
                    sanitize_role(value).unwrap_or(DEFAULT_DISCOVERY_ROLE.to_string())
                });
                (normalized, 1.0)
            })
            .unwrap_or_else(|| infer_role_from_path(&relative_path, role_patterns));
        let design_values = discovery_design_values(&captures, &member_id);

        matches.push(DiscoveryFileMatch {
            source_path: file.source_path.clone(),
            relative_path,
            member_id,
            role,
            role_confidence,
            design_values,
        });
    }

    matches.sort_by(|left, right| {
        left.member_id
            .cmp(&right.member_id)
            .then(left.role.cmp(&right.role))
            .then(left.relative_path.cmp(&right.relative_path))
    });
    unmatched_files.sort();
    (matches, unmatched_files, truncated)
}

fn group_discovery_matches(
    matches: Vec<DiscoveryFileMatch>,
    requested_required_roles: Option<&[String]>,
) -> DiscoveryGroupedResult {
    let matched_files = matches.len();
    let mut by_member: HashMap<String, Vec<DiscoveryFileMatch>> = HashMap::new();
    let mut observed_role_set = HashSet::new();
    let mut design_column_set = HashSet::new();

    for file_match in matches {
        observed_role_set.insert(file_match.role.clone());
        for design_value in &file_match.design_values {
            design_column_set.insert(design_value.column.clone());
        }
        by_member
            .entry(file_match.member_id.clone())
            .or_default()
            .push(file_match);
    }

    let mut observed_roles = observed_role_set.into_iter().collect::<Vec<_>>();
    observed_roles.sort();
    let required_roles = requested_required_roles
        .map(|roles| {
            roles
                .iter()
                .filter_map(|role| sanitize_role(role))
                .collect::<Vec<_>>()
        })
        .filter(|roles| !roles.is_empty())
        .unwrap_or_else(|| {
            if observed_roles.len() > 1 {
                observed_roles.clone()
            } else {
                Vec::new()
            }
        });
    let primary_role = preferred_primary_role(&observed_roles);

    let mut design_columns = ordered_design_columns(design_column_set);
    if !design_columns.iter().any(|column| column == "roles") {
        design_columns.push("roles".to_string());
    }

    let mut groups = by_member
        .into_iter()
        .map(|(member_id, mut file_matches)| {
            file_matches.sort_by(|left, right| {
                left.role
                    .cmp(&right.role)
                    .then(left.relative_path.cmp(&right.relative_path))
            });

            let mut role_counts = HashMap::new();
            for file_match in &file_matches {
                *role_counts.entry(file_match.role.clone()).or_insert(0usize) += 1;
            }
            let present_roles = role_counts.keys().cloned().collect::<HashSet<_>>();
            let mut duplicate_roles = role_counts
                .iter()
                .filter_map(
                    |(role, count)| {
                        if *count > 1 {
                            Some(role.clone())
                        } else {
                            None
                        }
                    },
                )
                .collect::<Vec<_>>();
            duplicate_roles.sort();
            let mut missing_roles = required_roles
                .iter()
                .filter(|role| !present_roles.contains(*role))
                .cloned()
                .collect::<Vec<_>>();
            missing_roles.sort();

            let mut design_values = Vec::new();
            let mut seen_design_columns = HashSet::new();
            for file_match in &file_matches {
                for design_value in &file_match.design_values {
                    if seen_design_columns.insert(design_value.column.clone()) {
                        design_values.push(design_value.clone());
                    }
                }
            }

            let confidence = if file_matches.is_empty() {
                0.0
            } else {
                file_matches
                    .iter()
                    .map(|file_match| file_match.role_confidence)
                    .sum::<f32>()
                    / file_matches.len() as f32
            };
            let bindings = file_matches
                .into_iter()
                .map(|file_match| StudioDiscoveryRoleBinding {
                    role: file_match.role,
                    source_path: file_match.source_path,
                    relative_path: file_match.relative_path,
                    confidence: file_match.role_confidence,
                })
                .collect::<Vec<_>>();

            StudioDiscoveryMemberGroup {
                member_id,
                design_values,
                bindings,
                missing_roles,
                duplicate_roles,
                confidence,
            }
        })
        .collect::<Vec<_>>();
    groups.sort_by(|left, right| left.member_id.cmp(&right.member_id));

    DiscoveryGroupedResult {
        groups,
        observed_roles,
        required_roles,
        design_columns,
        primary_role,
        matched_files,
    }
}

fn compile_discovery_patterns(patterns: Option<&[String]>) -> (Vec<Regex>, Vec<String>) {
    let mut regexes = Vec::new();
    let mut invalid = Vec::new();
    for pattern in patterns.unwrap_or(&[]) {
        match Regex::new(pattern) {
            Ok(regex) => regexes.push(regex),
            Err(_) => invalid.push(pattern.clone()),
        }
    }
    (regexes, invalid)
}

fn discovery_role_patterns(
    request: &StudioImportPreviewRequest,
) -> Vec<StudioDiscoveryRolePattern> {
    request
        .discovery_role_patterns
        .clone()
        .filter(|patterns| !patterns.is_empty())
        .unwrap_or_else(default_discovery_role_patterns)
}

fn default_discovery_role_patterns() -> Vec<StudioDiscoveryRolePattern> {
    vec![
        StudioDiscoveryRolePattern {
            role: "beta".to_string(),
            patterns: vec![
                r"(^|[_\-\./])(beta|cope|coef)([_\-\./]|$)".to_string(),
                r"^beta$".to_string(),
            ],
        },
        StudioDiscoveryRolePattern {
            role: "tstat".to_string(),
            patterns: vec![
                r"(^|[_\-\./])(tstat|t_stat|t-map|tmap|stat)([_\-\./]|$)".to_string(),
                r"^t(stat)?$".to_string(),
            ],
        },
        StudioDiscoveryRolePattern {
            role: "se".to_string(),
            patterns: vec![
                r"(^|[_\-\./])(se|stderr|std_err|standard_error)([_\-\./]|$)".to_string(),
                r"^se$".to_string(),
            ],
        },
        StudioDiscoveryRolePattern {
            role: "pvalue".to_string(),
            patterns: vec![
                r"(^|[_\-\./])(pvalue|p_value|pval|p-map|pmap)([_\-\./]|$)".to_string(),
                r"^p$".to_string(),
            ],
        },
        StudioDiscoveryRolePattern {
            role: DEFAULT_DISCOVERY_ROLE.to_string(),
            patterns: vec![r"(^|[_\-\./])(statmap|map)([_\-\./]|$)".to_string()],
        },
    ]
}

fn matches_any(regexes: &[Regex], relative_path: &str, source_path: &str) -> bool {
    regexes
        .iter()
        .any(|regex| regex.is_match(relative_path) || regex.is_match(source_path))
}

fn capture_named_values(
    regex: &Regex,
    capture_names: &[String],
    relative_path: &str,
    source_path: &str,
) -> Option<HashMap<String, String>> {
    for target in [relative_path, source_path] {
        if let Some(captures) = regex.captures(target) {
            let values = capture_names
                .iter()
                .filter_map(|name| {
                    captures
                        .name(name)
                        .map(|value| (name.clone(), value.as_str().to_string()))
                })
                .collect::<HashMap<_, _>>();
            return Some(values);
        }
    }
    None
}

fn derive_discovery_member_id(
    captures: &HashMap<String, String>,
    relative_path: &str,
    fallback_index: usize,
) -> String {
    let mut parts = Vec::new();
    if let Some(subject) = captures.get("subject").or_else(|| captures.get("sub")) {
        if !subject.trim().is_empty() {
            parts.push(subject.trim().to_string());
        }
    }
    for key in [
        "session",
        "contrast",
        "condition",
        "analysis",
        "task",
        "run",
    ] {
        if let Some(value) = captures.get(key) {
            if !value.trim().is_empty() {
                parts.push(value.trim().to_string());
            }
        }
    }

    if parts.is_empty() {
        derive_member_id_from_path(relative_path, fallback_index)
    } else {
        parts.join("_")
    }
}

fn discovery_design_values(
    captures: &HashMap<String, String>,
    member_id: &str,
) -> Vec<StudioDiscoveryDesignValue> {
    let mut values = Vec::new();
    let mut seen = HashSet::new();
    for key in ["subject", "session", "contrast"] {
        if let Some(value) = captures.get(key) {
            if !value.trim().is_empty() && seen.insert(key.to_string()) {
                values.push(StudioDiscoveryDesignValue {
                    column: key.to_string(),
                    value: value.trim().to_string(),
                });
            }
        }
    }
    if !seen.contains("subject") {
        values.insert(
            0,
            StudioDiscoveryDesignValue {
                column: "subject".to_string(),
                value: member_id.to_string(),
            },
        );
        seen.insert("subject".to_string());
    }

    let mut other_keys = captures
        .keys()
        .filter(|key| {
            !matches!(
                key.as_str(),
                "role" | "sub" | "subject" | "session" | "contrast"
            )
        })
        .cloned()
        .collect::<Vec<_>>();
    other_keys.sort();
    for key in other_keys {
        if let Some(value) = captures.get(&key) {
            if !value.trim().is_empty() && seen.insert(key.clone()) {
                values.push(StudioDiscoveryDesignValue {
                    column: key,
                    value: value.trim().to_string(),
                });
            }
        }
    }
    values
}

fn normalize_role(value: &str, role_patterns: &[StudioDiscoveryRolePattern]) -> Option<String> {
    let candidate = value.to_lowercase();
    for role_pattern in role_patterns {
        for pattern in &role_pattern.patterns {
            if Regex::new(pattern)
                .map(|regex| regex.is_match(&candidate))
                .unwrap_or(false)
            {
                return sanitize_role(&role_pattern.role);
            }
        }
    }
    sanitize_role(value)
}

fn infer_role_from_path(
    relative_path: &str,
    role_patterns: &[StudioDiscoveryRolePattern],
) -> (String, f32) {
    let lower = relative_path.to_lowercase();
    for role_pattern in role_patterns {
        for pattern in &role_pattern.patterns {
            if Regex::new(pattern)
                .map(|regex| regex.is_match(&lower))
                .unwrap_or(false)
            {
                return (
                    sanitize_role(&role_pattern.role)
                        .unwrap_or_else(|| DEFAULT_DISCOVERY_ROLE.to_string()),
                    0.75,
                );
            }
        }
    }
    (DEFAULT_DISCOVERY_ROLE.to_string(), 0.5)
}

fn sanitize_role(value: &str) -> Option<String> {
    let normalized = value
        .trim()
        .to_lowercase()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .to_string();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn ordered_design_columns(columns: HashSet<String>) -> Vec<String> {
    let mut ordered = Vec::new();
    for preferred in ["subject", "session", "contrast"] {
        if columns.contains(preferred) {
            ordered.push(preferred.to_string());
        }
    }
    let mut remaining = columns
        .into_iter()
        .filter(|column| !ordered.contains(column))
        .collect::<Vec<_>>();
    remaining.sort();
    ordered.extend(remaining);
    ordered
}

fn preferred_primary_role(observed_roles: &[String]) -> String {
    for preferred in ["statmap", "tstat", "beta"] {
        if observed_roles.iter().any(|role| role == preferred) {
            return preferred.to_string();
        }
    }
    observed_roles
        .first()
        .cloned()
        .unwrap_or_else(|| DEFAULT_DISCOVERY_ROLE.to_string())
}

fn select_primary_source_path(
    group: &StudioDiscoveryMemberGroup,
    primary_role: &str,
) -> Option<String> {
    group
        .bindings
        .iter()
        .find(|binding| binding.role == primary_role)
        .or_else(|| group.bindings.first())
        .map(|binding| binding.source_path.clone())
}

fn discovery_member_bindings(
    group: &StudioDiscoveryMemberGroup,
    primary_role: &str,
    support_label: Option<String>,
) -> Vec<StudioFieldBindingSummary> {
    if group.bindings.is_empty() {
        return vec![unavailable_primary_binding(
            primary_role,
            Some(primary_role),
            StudioSupportKind::Volume,
            support_label,
        )];
    }
    let primary_index = group
        .bindings
        .iter()
        .position(|binding| binding.role == primary_role)
        .unwrap_or(0);

    group
        .bindings
        .iter()
        .enumerate()
        .map(|(index, binding)| {
            binding_summary(BindingSummaryInput {
                role: binding.role.clone(),
                feature_id: Some(binding.role.clone()),
                source_locator: Some(binding.relative_path.clone()),
                source_path: Some(binding.source_path.clone()),
                relative_path: Some(binding.relative_path.clone()),
                selector: None,
                support_kind: StudioSupportKind::Volume,
                support_label: support_label.clone(),
                availability: StudioFieldBindingAvailability::Available,
                is_primary: index == primary_index,
            })
        })
        .collect()
}

fn design_row_from_group(
    group: &StudioDiscoveryMemberGroup,
    design_columns: &[String],
) -> StudioDesignRowPreview {
    StudioDesignRowPreview {
        id: group.member_id.clone(),
        cells: design_columns
            .iter()
            .map(|column| {
                if column == "roles" {
                    let mut roles = group
                        .bindings
                        .iter()
                        .map(|binding| binding.role.clone())
                        .collect::<Vec<_>>();
                    roles.sort();
                    roles.dedup();
                    roles.join(",")
                } else {
                    group
                        .design_values
                        .iter()
                        .find(|value| &value.column == column)
                        .map(|value| value.value.clone())
                        .unwrap_or_default()
                }
            })
            .collect(),
    }
}

fn normalize_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn is_neuroimaging_path(path: &Path) -> bool {
    is_neuroimaging_value(&path.to_string_lossy())
}

fn is_neuroimaging_value(value: &str) -> bool {
    let value = value.to_lowercase();
    value.ends_with(".nii")
        || value.ends_with(".nii.gz")
        || value.ends_with(".gii")
        || value.ends_with(".surf.gii")
        || value.ends_with(".func.gii")
}

// Builds human-readable discovery notes from many independent flags; struct adds no clarity.
#[allow(clippy::too_many_arguments)]
fn discovery_notes(
    root_exists: bool,
    regex_valid: bool,
    grouped_members: usize,
    observed_roles: &[String],
    required_roles: &[String],
    unmatched_files: usize,
    duplicate_keys: usize,
    missing_role_count: usize,
    truncated: bool,
) -> Vec<String> {
    if !root_exists {
        return vec!["Discovery root was not found on disk.".to_string()];
    }

    if !regex_valid {
        return vec!["Regex pattern was invalid and could not be compiled.".to_string()];
    }

    let mut notes = vec![format!(
        "Discovery grouped {} member set(s) under the requested root.",
        grouped_members
    )];
    if observed_roles.is_empty() {
        notes.push("No image roles were inferred.".to_string());
    } else {
        notes.push(format!("Observed role(s): {}.", observed_roles.join(", ")));
    }
    if !required_roles.is_empty() {
        notes.push(format!("Required role(s): {}.", required_roles.join(", ")));
    }
    if unmatched_files > 0 {
        notes.push(format!(
            "{} neuroimaging file(s) were left unmatched by the discovery pattern.",
            unmatched_files
        ));
    }
    if duplicate_keys > 0 {
        notes.push(format!(
            "{} duplicate member-role binding conflict(s) were detected.",
            duplicate_keys
        ));
    }
    if missing_role_count > 0 {
        notes.push(format!(
            "{} required role binding(s) are missing across grouped members.",
            missing_role_count
        ));
    }
    if truncated {
        notes.push("Discovery hit the requested max file count and was truncated.".to_string());
    }

    notes
}
