use super::{inspect_table_volume_support, FeatureBindingPreview};
use crate::neurotabs::{
    FeatureEncoding, FeatureSchema, JsonValueSource, NeuroTabsManifest, StringValueSource,
    TableFormat,
};
use bridge_types::{StudioFieldBindingAvailability, StudioJoinIssueDetail};
use csv::ReaderBuilder;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Default)]
pub(super) struct ResourceRegistryPreview {
    records: HashMap<String, ResourceRecord>,
    pub(super) issue_count: usize,
    pub(super) issue_details: Vec<StudioJoinIssueDetail>,
}

#[derive(Debug, Clone)]
struct ResourceRecord {
    backend: String,
    locator: String,
}

#[derive(Debug, Clone)]
pub(super) struct RowSourceResolution {
    pub(super) source_locator: Option<String>,
    pub(super) source_path: Option<String>,
    pub(super) relative_path: Option<String>,
    pub(super) selector: Option<String>,
    pub(super) availability: StudioFieldBindingAvailability,
    pub(super) source_issue_count: usize,
    pub(super) support_issue_count: usize,
    pub(super) issue_details: Vec<StudioJoinIssueDetail>,
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

pub(super) fn inspect_resource_registry(
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

pub(super) fn resolve_row_source(
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

pub(super) fn resolve_relative_path(manifest_file: &Path, raw_path: &str) -> PathBuf {
    let path = PathBuf::from(raw_path);
    if path.is_absolute() {
        return path;
    }

    manifest_file
        .parent()
        .map(|parent| parent.join(&path))
        .unwrap_or(path)
}

pub(super) fn infer_source_path_index(
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
