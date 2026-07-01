use bridge_types::{
    StudioAuditSeverity, StudioFieldBindingAvailability, StudioFieldBindingSummary,
    StudioImportCandidate, StudioImportCapability, StudioImportContract, StudioImportMode,
    StudioImportPreviewRequest, StudioImportProvenanceKind, StudioImportReadiness,
    StudioSupportKind,
};
use std::path::Path;

mod discovery;
mod manifest;
mod ontology;
mod source;
mod support;
mod table;
pub use bridge_types::{
    StudioFolderOntologyCandidate, StudioFolderOntologyFactor, StudioFolderOntologyPreviewRequest,
    StudioFolderOntologyRoleGuess, StudioFolderOntologySummary, StudioFolderOntologyWarning,
};
use discovery::regex_candidate;
pub use discovery::{DiscoveryInventory, DiscoveryInventoryFile, DiscoverySampleHeader};
use manifest::{manifest_candidate, FeatureBindingPreview};
pub use ontology::{preview_folder_ontology, preview_folder_ontology_with_discovery_inventory};
use source::{
    infer_source_path_index, inspect_resource_registry, resolve_relative_path, resolve_row_source,
    ResourceRegistryPreview,
};
use support::{
    feature_support_kind, infer_support_summary, inspect_table_volume_support,
    manifest_binding_support_label, table_support_label, validate_nifti_volume_support,
    TableSupportSignature,
};
use table::table_candidate;

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

fn derive_member_id_from_path(path: &str, fallback_index: usize) -> String {
    Path::new(path)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .map(|stem| stem.trim_end_matches(".nii").to_string())
        .filter(|stem| !stem.is_empty())
        .unwrap_or_else(|| format!("member-{:03}", fallback_index + 1))
}

fn title_case(value: &str) -> String {
    value.replace(['_', '-'], " ")
}
