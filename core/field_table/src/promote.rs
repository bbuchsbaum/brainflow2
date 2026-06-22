use crate::neurotabs::{
    Alignment, FeatureEncoding, FeatureSchema, LogicalDType, LogicalFeatureSchema, LogicalKind,
    RefBinding, ScalarColumnSchema, ScalarDType, StorageProfile, StringValueSource, SupportSchema,
    TableFormat, TableRef, VolumeSupport,
};
use crate::{neurotabs::NeuroTabsManifest, preview_import_candidates};
use bridge_types::{
    StudioDiscoveryPromotionRequest, StudioDiscoveryPromotionResult, StudioDiscoveryRoleBinding,
    StudioGeneratedNeuroTabsFile, StudioImportCandidate, StudioImportMode,
    StudioImportPreviewRequest,
};
use csv::WriterBuilder;
use serde_json::json;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;
use std::path::{Path, PathBuf};

const MANIFEST_FILE: &str = "brainflow_nftab.yaml";
const OBSERVATIONS_FILE: &str = "brainflow_observations.csv";
const RESOURCES_FILE: &str = "brainflow_resources.csv";
const SUPPORT_REF: &str = "discovered_volume_grid";

#[derive(Debug, Clone)]
pub struct PromotedNeuroTabsPackage {
    pub dataset_id: String,
    pub manifest_yaml: String,
    pub observations_csv: String,
    pub resources_csv: String,
}

pub fn promote_discovery_to_neurotabs(
    request: StudioDiscoveryPromotionRequest,
) -> Result<StudioDiscoveryPromotionResult, String> {
    let package = build_discovery_neurotabs_package(&request.candidate)?;
    let files = vec![
        StudioGeneratedNeuroTabsFile {
            relative_path: MANIFEST_FILE.to_string(),
            contents: package.manifest_yaml.clone(),
        },
        StudioGeneratedNeuroTabsFile {
            relative_path: OBSERVATIONS_FILE.to_string(),
            contents: package.observations_csv.clone(),
        },
        StudioGeneratedNeuroTabsFile {
            relative_path: RESOURCES_FILE.to_string(),
            contents: package.resources_csv.clone(),
        },
    ];

    let mut manifest_path = None;
    let mut preview = None;
    let message = if let Some(output_dir) = request.output_dir.as_deref() {
        let output_dir = PathBuf::from(output_dir);
        write_package_files(&output_dir, &package)?;
        let written_manifest = output_dir.join(MANIFEST_FILE);
        manifest_path = Some(written_manifest.to_string_lossy().to_string());
        preview = preview_import_candidates(StudioImportPreviewRequest {
            mode: StudioImportMode::Manifest,
            manifest_path: Some(written_manifest.to_string_lossy().to_string()),
            discovery_root: None,
            file_pattern: None,
            table_source_label: None,
            table_headers: None,
            table_rows: None,
            table_file_path_column: None,
            table_subject_id_column: None,
            table_excluded_columns: None,
            discovery_max_depth: None,
            discovery_max_files: None,
            discovery_include_patterns: None,
            discovery_exclude_patterns: None,
            discovery_required_roles: None,
            discovery_role_patterns: None,
            discovery_dry_run: None,
            discovery_sample_headers: None,
        })
        .into_iter()
        .next();
        format!(
            "Saved NeuroTabs manifest package to {}.",
            output_dir.display()
        )
    } else {
        "Generated NeuroTabs manifest package in memory.".to_string()
    };

    Ok(StudioDiscoveryPromotionResult {
        dataset_id: package.dataset_id,
        manifest_path,
        files,
        preview,
        message,
    })
}

pub fn build_discovery_neurotabs_package(
    candidate: &StudioImportCandidate,
) -> Result<PromotedNeuroTabsPackage, String> {
    let discovery = candidate.discovery.as_ref().ok_or_else(|| {
        "Only regex discovery candidates can be promoted to NeuroTabs.".to_string()
    })?;
    validate_clean_discovery(candidate)?;

    let dataset_id = sanitize_identifier(&candidate.set.id, "discovered_set");
    let roles = ordered_roles(candidate);
    let primary_role = candidate
        .set
        .primary_feature_id
        .as_deref()
        .and_then(|role| roles.iter().find(|candidate| candidate.as_str() == role))
        .cloned()
        .or_else(|| roles.first().cloned())
        .ok_or_else(|| "Discovery candidate did not contain any image roles.".to_string())?;
    let design_columns = promoted_design_columns(candidate);
    let role_columns = roles
        .iter()
        .map(|role| {
            (
                role.clone(),
                format!("{}_res", sanitize_identifier(role, "role")),
            )
        })
        .collect::<Vec<_>>();

    let mut observation_columns = BTreeMap::new();
    observation_columns.insert(
        "row_id".to_string(),
        column_schema(ScalarDType::String, false, Some("row_id")),
    );
    for column in &design_columns {
        observation_columns.insert(
            column.clone(),
            column_schema(ScalarDType::String, false, Some(column)),
        );
    }
    observation_columns.insert(
        "roles".to_string(),
        column_schema(ScalarDType::String, false, Some("roles")),
    );
    for (_, column) in &role_columns {
        observation_columns.insert(
            column.clone(),
            column_schema(ScalarDType::String, true, Some("resource_id")),
        );
    }

    let mut features = BTreeMap::new();
    for (role, column) in &role_columns {
        features.insert(
            role.clone(),
            FeatureSchema {
                logical: LogicalFeatureSchema {
                    kind: LogicalKind::Volume,
                    axes: vec!["x".to_string(), "y".to_string(), "z".to_string()],
                    dtype: LogicalDType::Float32,
                    support_ref: Some(SUPPORT_REF.to_string()),
                    shape: None,
                    axis_domains: BTreeMap::new(),
                    space: Some("discovered".to_string()),
                    alignment: Some(Alignment::SameGrid),
                    unit: None,
                    description: Some(format!("{} image discovered by Brainflow", role)),
                },
                encodings: vec![FeatureEncoding::Ref {
                    binding: RefBinding {
                        resource_id: Some(StringValueSource::Column {
                            column: column.clone(),
                        }),
                        backend: None,
                        locator: None,
                        selector: None,
                        checksum: None,
                    },
                }],
                nullable: false,
                description: Some(role.clone()),
            },
        );
    }

    let mut supports = BTreeMap::new();
    supports.insert(
        SUPPORT_REF.to_string(),
        SupportSchema::Volume(VolumeSupport {
            support_id: SUPPORT_REF.to_string(),
            space: "discovered".to_string(),
            grid_id: candidate.set.support_label.clone(),
            affine_id: None,
            description: Some("Grid inferred from discovered images.".to_string()),
            metadata: Some(json!({
                "source": "brainflow-discovery",
                "alignment_class": candidate.set.alignment_class,
                "root": discovery.root,
            })),
        }),
    );

    let manifest = NeuroTabsManifest {
        spec_version: "0.1.0".to_string(),
        dataset_id: dataset_id.clone(),
        storage_profile: StorageProfile::TablePackage,
        observation_table: TableRef {
            path: OBSERVATIONS_FILE.to_string(),
            format: TableFormat::Csv,
        },
        row_id: "row_id".to_string(),
        observation_axes: design_columns.clone(),
        observation_columns,
        features,
        supports,
        primary_feature: Some(primary_role),
        import_recipe: Some(json!({
            "tool": "brainflow",
            "kind": "regex-discovery",
            "root": discovery.root,
            "file_pattern": discovery.file_pattern,
            "capture_names": discovery.capture_names,
            "required_roles": discovery.required_roles,
            "role_patterns": discovery.role_patterns,
        })),
        resources: Some(TableRef {
            path: RESOURCES_FILE.to_string(),
            format: TableFormat::Csv,
        }),
        extensions: BTreeMap::new(),
    };
    manifest
        .validate_strict()
        .map_err(|error| format!("Generated NeuroTabs manifest failed validation: {error}"))?;

    Ok(PromotedNeuroTabsPackage {
        dataset_id,
        manifest_yaml: serde_yaml::to_string(&manifest)
            .map_err(|error| format!("Failed to serialize NeuroTabs manifest: {error}"))?,
        observations_csv: write_observations_csv(
            candidate,
            &roles,
            &role_columns,
            &design_columns,
        )?,
        resources_csv: write_resources_csv(candidate, &roles)?,
    })
}

fn validate_clean_discovery(candidate: &StudioImportCandidate) -> Result<(), String> {
    let discovery = candidate.discovery.as_ref().ok_or_else(|| {
        "Only regex discovery candidates can be promoted to NeuroTabs.".to_string()
    })?;
    if discovery.groups.is_empty() {
        return Err("Discovery candidate did not contain any member groups.".to_string());
    }
    if discovery.truncated {
        return Err("Discovery candidate was truncated; refresh with a higher max-files limit before exporting.".to_string());
    }
    if discovery.unmatched_files > 0 {
        return Err("Discovery candidate still has unmatched neuroimaging files.".to_string());
    }
    let dirty_groups = discovery
        .groups
        .iter()
        .filter(|group| !group.missing_roles.is_empty() || !group.duplicate_roles.is_empty())
        .map(|group| group.member_id.clone())
        .collect::<Vec<_>>();
    if !dirty_groups.is_empty() {
        return Err(format!(
            "Discovery candidate has missing or duplicate role bindings for: {}.",
            dirty_groups.join(", ")
        ));
    }
    Ok(())
}

fn promoted_design_columns(candidate: &StudioImportCandidate) -> Vec<String> {
    let mut columns = candidate
        .discovery
        .as_ref()
        .map(|discovery| discovery.inferred_design_columns.clone())
        .unwrap_or_else(|| candidate.set.design_columns.clone())
        .into_iter()
        .filter(|column| column != "roles")
        .collect::<Vec<_>>();
    if !columns.iter().any(|column| column == "subject") {
        columns.insert(0, "subject".to_string());
    }
    columns.sort_by_key(|column| match column.as_str() {
        "subject" => 0,
        "session" => 1,
        "contrast" => 2,
        _ => 3,
    });
    columns.dedup();
    columns
}

fn ordered_roles(candidate: &StudioImportCandidate) -> Vec<String> {
    let mut roles = BTreeSet::new();
    if let Some(discovery) = &candidate.discovery {
        roles.extend(discovery.observed_roles.iter().cloned());
        roles.extend(discovery.required_roles.iter().cloned());
        for group in &discovery.groups {
            roles.extend(group.bindings.iter().map(|binding| binding.role.clone()));
        }
    }
    roles
        .into_iter()
        .map(|role| sanitize_identifier(&role, "role"))
        .collect()
}

fn write_observations_csv(
    candidate: &StudioImportCandidate,
    roles: &[String],
    role_columns: &[(String, String)],
    design_columns: &[String],
) -> Result<String, String> {
    let discovery = candidate.discovery.as_ref().ok_or_else(|| {
        "Only regex discovery candidates can be promoted to NeuroTabs.".to_string()
    })?;
    let mut writer = WriterBuilder::new().from_writer(Vec::new());
    let mut headers = vec!["row_id".to_string()];
    headers.extend(design_columns.iter().cloned());
    headers.push("roles".to_string());
    headers.extend(role_columns.iter().map(|(_, column)| column.clone()));
    writer
        .write_record(headers)
        .map_err(|error| format!("Failed to write observations header: {error}"))?;

    for group in &discovery.groups {
        let binding_by_role = group
            .bindings
            .iter()
            .map(|binding| (sanitize_identifier(&binding.role, "role"), binding))
            .collect::<HashMap<_, _>>();
        let mut row = vec![group.member_id.clone()];
        for column in design_columns {
            row.push(design_value(group, column));
        }
        row.push(roles.join(","));
        for role in roles {
            let resource_id = binding_by_role
                .get(role)
                .map(|_| resource_id(&group.member_id, role))
                .unwrap_or_default();
            row.push(resource_id);
        }
        writer
            .write_record(row)
            .map_err(|error| format!("Failed to write observation row: {error}"))?;
    }

    writer_to_string(writer, "observations")
}

fn write_resources_csv(
    candidate: &StudioImportCandidate,
    roles: &[String],
) -> Result<String, String> {
    let discovery = candidate.discovery.as_ref().ok_or_else(|| {
        "Only regex discovery candidates can be promoted to NeuroTabs.".to_string()
    })?;
    let mut writer = WriterBuilder::new().from_writer(Vec::new());
    writer
        .write_record(["resource_id", "backend", "locator"])
        .map_err(|error| format!("Failed to write resources header: {error}"))?;
    for group in &discovery.groups {
        let bindings = group
            .bindings
            .iter()
            .map(|binding| (sanitize_identifier(&binding.role, "role"), binding))
            .collect::<HashMap<_, _>>();
        for role in roles {
            if let Some(binding) = bindings.get(role) {
                writer
                    .write_record([
                        resource_id(&group.member_id, role),
                        "nifti".to_string(),
                        resource_locator(binding),
                    ])
                    .map_err(|error| format!("Failed to write resource row: {error}"))?;
            }
        }
    }
    writer_to_string(writer, "resources")
}

fn writer_to_string(writer: csv::Writer<Vec<u8>>, label: &str) -> Result<String, String> {
    String::from_utf8(
        writer
            .into_inner()
            .map_err(|error| format!("Failed to finalize {label} CSV: {error}"))?,
    )
    .map_err(|error| format!("Generated {label} CSV was not UTF-8: {error}"))
}

fn write_package_files(
    output_dir: &Path,
    package: &PromotedNeuroTabsPackage,
) -> Result<(), String> {
    fs::create_dir_all(output_dir).map_err(|error| {
        format!(
            "Failed to create NeuroTabs output directory {}: {}",
            output_dir.display(),
            error
        )
    })?;
    fs::write(output_dir.join(MANIFEST_FILE), &package.manifest_yaml)
        .map_err(|error| format!("Failed to write {}: {}", MANIFEST_FILE, error))?;
    fs::write(
        output_dir.join(OBSERVATIONS_FILE),
        &package.observations_csv,
    )
    .map_err(|error| format!("Failed to write {}: {}", OBSERVATIONS_FILE, error))?;
    fs::write(output_dir.join(RESOURCES_FILE), &package.resources_csv)
        .map_err(|error| format!("Failed to write {}: {}", RESOURCES_FILE, error))?;
    Ok(())
}

fn design_value(group: &bridge_types::StudioDiscoveryMemberGroup, column: &str) -> String {
    if column == "subject" {
        return group
            .design_values
            .iter()
            .find(|value| value.column == column)
            .map(|value| value.value.clone())
            .unwrap_or_else(|| group.member_id.clone());
    }
    group
        .design_values
        .iter()
        .find(|value| value.column == column)
        .map(|value| value.value.clone())
        .unwrap_or_default()
}

fn resource_locator(binding: &StudioDiscoveryRoleBinding) -> String {
    if binding.relative_path.trim().is_empty() {
        binding.source_path.clone()
    } else {
        binding.relative_path.clone()
    }
}

fn resource_id(member_id: &str, role: &str) -> String {
    format!(
        "{}_{}",
        sanitize_identifier(member_id, "member"),
        sanitize_identifier(role, "role")
    )
}

fn sanitize_identifier(value: &str, fallback: &str) -> String {
    let sanitized = value
        .trim()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .to_string();
    if sanitized.is_empty() {
        fallback.to_string()
    } else {
        sanitized
    }
}

fn column_schema(
    dtype: ScalarDType,
    nullable: bool,
    semantic_role: Option<&str>,
) -> ScalarColumnSchema {
    ScalarColumnSchema {
        dtype,
        nullable,
        semantic_role: semantic_role.map(ToString::to_string),
        levels: None,
        unit: None,
        description: None,
    }
}
