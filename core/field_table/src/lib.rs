mod materialize;
pub mod neurotabs;
mod preview;
mod promote;

pub use materialize::materialize_compare_panes;
pub use preview::{
    preview_folder_ontology, preview_folder_ontology_with_discovery_inventory,
    preview_import_candidates, preview_import_candidates_with_discovery_inventory,
    DiscoveryInventory, DiscoveryInventoryFile, DiscoverySampleHeader,
    StudioFolderOntologyCandidate, StudioFolderOntologyFactor, StudioFolderOntologyPreviewRequest,
    StudioFolderOntologyRoleGuess, StudioFolderOntologySummary, StudioFolderOntologyWarning,
};
pub use promote::{build_discovery_neurotabs_package, promote_discovery_to_neurotabs};

#[cfg(test)]
pub(crate) use materialize::extract_volume_values;

#[cfg(test)]
mod tests {
    use super::*;
    use bridge_types::{
        StudioAlignmentClass, StudioAuditSeverity, StudioCompareBindingKind,
        StudioCompareCacheStatus, StudioCompareMaterializeRequest, StudioComparePaneStatus,
        StudioDiscoveryPromotionRequest, StudioFieldBindingAvailability,
        StudioFolderOntologyPreviewRequest, StudioImportCandidate, StudioImportCapability,
        StudioImportMode, StudioImportPreviewRequest, StudioImportReadiness, StudioMemberSummary,
        StudioReducerKind, StudioReducerSpec, StudioRoleBindingInput, StudioSupportKind,
    };
    use nifti::{writer::WriterOptions, NiftiHeader};
    use std::fs;
    use std::path::{Path, PathBuf};
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
        let header = NiftiHeader {
            dim: [3, dims[0], dims[1], dims[2], 1, 1, 1, 1],
            datatype: 16,
            bitpix: 32,
            sform_code: 1,
            qform_code: 0,
            srow_x: [1.0, 0.0, 0.0, 0.0],
            srow_y: [0.0, 1.0, 0.0, 0.0],
            srow_z: [0.0, 0.0, 1.0, 0.0],
            ..NiftiHeader::default()
        };
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

    fn assert_primary_binding(
        member: &StudioMemberSummary,
        role: &str,
        feature_id: &str,
        source_path: &Path,
    ) {
        let binding = member
            .bindings
            .as_ref()
            .expect("bindings")
            .iter()
            .find(|binding| binding.is_primary)
            .expect("primary binding");
        assert_eq!(binding.role, role);
        assert_eq!(binding.feature_id.as_deref(), Some(feature_id));
        assert_eq!(
            binding.source_path.as_deref(),
            Some(source_path.to_string_lossy().as_ref())
        );
        assert_eq!(
            binding.availability,
            StudioFieldBindingAvailability::Available
        );
    }

    #[test]
    fn returns_manifest_previews() {
        let previews = preview_import_candidates(StudioImportPreviewRequest {
            mode: StudioImportMode::Manifest,
            manifest_path: Some("/tmp/demo.neurotabs.yaml".to_string()),
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
        });
        assert_eq!(previews.len(), 1);
        assert_eq!(previews[0].mode, StudioImportMode::Manifest);
        assert_eq!(previews[0].source_hint, "/tmp/demo.neurotabs.yaml");
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
            discovery_max_depth: None,
            discovery_max_files: None,
            discovery_include_patterns: None,
            discovery_exclude_patterns: None,
            discovery_required_roles: None,
            discovery_role_patterns: None,
            discovery_dry_run: None,
            discovery_sample_headers: None,
        });
        assert_eq!(previews.len(), 1);
        assert_eq!(previews[0].mode, StudioImportMode::Regex);
        assert!(previews[0].set.member_count > 0);
        assert!(previews[0].contract.can_import);
        assert!(previews[0]
            .contract
            .capabilities
            .contains(&StudioImportCapability::ExportNeurotabs));
    }

    #[test]
    fn regex_discovery_groups_subject_role_folders() {
        let temp_dir = make_temp_dir("discovery-roles");
        for subject in ["1001", "1002"] {
            let maps_dir = temp_dir.join(subject).join("maps");
            fs::create_dir_all(&maps_dir).expect("create subject maps dir");
            for role in ["beta", "tstat", "se", "pvalue"] {
                save_test_nifti(
                    &maps_dir.join(format!("{}.nii.gz", role)),
                    &[1.0],
                    [1, 1, 1],
                );
            }
        }
        let unmatched_dir = temp_dir.join("notes");
        fs::create_dir_all(&unmatched_dir).expect("create unmatched dir");
        save_test_nifti(&unmatched_dir.join("loose.nii.gz"), &[1.0], [1, 1, 1]);

        let previews = preview_import_candidates(StudioImportPreviewRequest {
            mode: StudioImportMode::Regex,
            manifest_path: None,
            discovery_root: Some(temp_dir.to_string_lossy().to_string()),
            file_pattern: Some(
                r"(?P<subject>\d{4})/maps/(?P<role>beta|tstat|se|pvalue)\.nii(\.gz)?$".to_string(),
            ),
            table_source_label: None,
            table_headers: None,
            table_rows: None,
            table_file_path_column: None,
            table_subject_id_column: None,
            table_excluded_columns: None,
            discovery_max_depth: Some(3),
            discovery_max_files: Some(20),
            discovery_include_patterns: None,
            discovery_exclude_patterns: None,
            discovery_required_roles: Some(vec![
                "beta".to_string(),
                "tstat".to_string(),
                "se".to_string(),
                "pvalue".to_string(),
            ]),
            discovery_role_patterns: None,
            discovery_dry_run: Some(true),
            discovery_sample_headers: Some(true),
        });

        let preview = &previews[0];
        let discovery = preview.discovery.as_ref().expect("discovery summary");
        assert_eq!(preview.mode, StudioImportMode::Regex);
        assert_eq!(preview.set.member_count, 2);
        assert_eq!(preview.set.primary_feature_id.as_deref(), Some("tstat"));
        assert_eq!(discovery.matched_files, 8);
        assert_eq!(discovery.unmatched_files, 1);
        assert_eq!(discovery.groups.len(), 2);
        assert_eq!(discovery.required_roles.len(), 4);
        assert!(discovery.observed_roles.contains(&"beta".to_string()));
        assert!(discovery.observed_roles.contains(&"pvalue".to_string()));
        assert!(discovery.capture_names.contains(&"subject".to_string()));
        assert!(discovery.capture_names.contains(&"role".to_string()));
        assert!(!discovery.role_patterns.is_empty());
        assert!(preview.set.ingest_audit.support.ready_for_compare);
        assert_eq!(
            preview.set.member_ids,
            vec!["1001".to_string(), "1002".to_string()]
        );
        assert!(preview.set.member_summaries.iter().all(|member| member
            .source_path
            .as_deref()
            .unwrap_or("")
            .contains("tstat")));
        let first_member = &preview.set.member_summaries[0];
        let mut binding_roles = first_member
            .bindings
            .as_ref()
            .expect("bindings")
            .iter()
            .map(|binding| binding.role.as_str())
            .collect::<Vec<_>>();
        binding_roles.sort_unstable();
        assert_eq!(binding_roles, vec!["beta", "pvalue", "se", "tstat"]);
        let tstat_binding = first_member
            .bindings
            .as_ref()
            .expect("bindings")
            .iter()
            .find(|binding| binding.role == "tstat")
            .expect("tstat binding");
        assert!(tstat_binding.is_primary);
        assert_eq!(
            tstat_binding.source_path.as_deref(),
            first_member.source_path.as_deref()
        );
        assert_eq!(
            tstat_binding.availability,
            StudioFieldBindingAvailability::Available
        );
        assert!(first_member
            .bindings
            .as_ref()
            .expect("bindings")
            .iter()
            .all(|binding| binding
                .support_label
                .as_deref()
                .unwrap_or("")
                .contains("sampled")));
        assert!(preview
            .set
            .ingest_audit
            .join
            .issue_details
            .iter()
            .any(|issue| issue.message.contains("did not match")));

        fs::remove_dir_all(temp_dir).expect("cleanup temp dir");
    }

    fn remote_discovery_request(root: &str, sample_headers: bool) -> StudioImportPreviewRequest {
        StudioImportPreviewRequest {
            mode: StudioImportMode::Regex,
            manifest_path: None,
            discovery_root: Some(root.to_string()),
            file_pattern: Some(
                r"(?P<subject>\d{4})/maps/(?P<role>beta|tstat|se|pvalue)\.nii(\.gz)?$".to_string(),
            ),
            table_source_label: None,
            table_headers: None,
            table_rows: None,
            table_file_path_column: None,
            table_subject_id_column: None,
            table_excluded_columns: None,
            discovery_max_depth: Some(3),
            discovery_max_files: Some(20),
            discovery_include_patterns: None,
            discovery_exclude_patterns: None,
            discovery_required_roles: Some(vec![
                "beta".to_string(),
                "tstat".to_string(),
                "se".to_string(),
                "pvalue".to_string(),
            ]),
            discovery_role_patterns: None,
            discovery_dry_run: Some(true),
            discovery_sample_headers: Some(sample_headers),
        }
    }

    fn remote_inventory_file(root: &str, relative_path: &str) -> DiscoveryInventoryFile {
        DiscoveryInventoryFile {
            source_path: format!("{}/{}", root.trim_end_matches('/'), relative_path),
            relative_path: relative_path.to_string(),
        }
    }

    fn complete_remote_inventory(root: &str) -> DiscoveryInventory {
        let mut files = Vec::new();
        for subject in ["1001", "1002"] {
            for role in ["beta", "tstat", "se", "pvalue"] {
                files.push(remote_inventory_file(
                    root,
                    &format!("{}/maps/{}.nii.gz", subject, role),
                ));
            }
        }
        files.push(remote_inventory_file(root, "notes/loose.nii.gz"));

        DiscoveryInventory {
            root_exists: true,
            source_label: Some("remote user@host:/study".to_string()),
            files,
            notes: vec![
                "Remote inventory listed files through the active mount without downloading NIfTI payloads."
                    .to_string(),
            ],
            ..DiscoveryInventory::default()
        }
    }

    #[test]
    fn remote_inventory_groups_subject_roles_without_cache_files() {
        let root = "/definitely/not/a/local/cache/mount-a";
        let previews = preview_import_candidates_with_discovery_inventory(
            remote_discovery_request(root, false),
            Some(complete_remote_inventory(root)),
        );

        let preview = &previews[0];
        let discovery = preview.discovery.as_ref().expect("discovery summary");
        assert_eq!(preview.mode, StudioImportMode::Regex);
        assert_eq!(preview.set.member_count, 2);
        assert_eq!(discovery.matched_files, 8);
        assert_eq!(discovery.unmatched_files, 1);
        assert_eq!(discovery.groups.len(), 2);
        assert!(preview.set.ingest_audit.support.ready_for_compare);
        assert!(preview
            .set
            .ingest_audit
            .notes
            .iter()
            .any(|note| note.contains("without downloading NIfTI payloads")));
        assert!(preview
            .set
            .member_summaries
            .iter()
            .filter_map(|member| member.source_path.as_deref())
            .all(|path| !Path::new(path).exists()));
    }

    #[test]
    fn remote_inventory_reports_inactive_mount_as_recoverable_preview_error() {
        let root = "/remote-cache/stale-mount/derivatives";
        let previews = preview_import_candidates_with_discovery_inventory(
            remote_discovery_request(root, false),
            Some(DiscoveryInventory {
                root_exists: false,
                source_label: Some("stale remote mount".to_string()),
                root_issue: Some(format!(
                    "Remote mount is not active for root '{}' (mount id stale-mount). Reconnect the remote folder and try again.",
                    root
                )),
                ..DiscoveryInventory::default()
            }),
        );

        let preview = &previews[0];
        assert_eq!(preview.set.member_count, 0);
        assert_eq!(
            preview.set.ingest_audit.join.severity,
            StudioAuditSeverity::Error
        );
        let issue = preview.set.ingest_audit.join.issue_details[0]
            .message
            .clone();
        assert!(issue.contains(root));
        assert!(issue.contains("stale-mount"));
        assert!(issue.contains("Reconnect"));
        assert_eq!(preview.contract.readiness, StudioImportReadiness::Blocked);
        assert!(!preview.contract.can_import);
    }

    #[test]
    fn remote_inventory_records_staged_sample_header_provenance() {
        let root = "/remote-cache/live-mount";
        let temp_dir = make_temp_dir("remote-sample-header");
        let staged_sample = temp_dir.join("sample-tstat.nii.gz");
        save_test_nifti(&staged_sample, &[1.0, 2.0], [2, 1, 1]);

        let mut inventory = complete_remote_inventory(root);
        inventory.sample_header = Some(DiscoverySampleHeader {
            source_path: format!("{}/1001/maps/tstat.nii.gz", root),
            local_path: staged_sample.clone(),
            note: format!(
                "Staged one remote sample header from {}/1001/maps/tstat.nii.gz at {}.",
                root,
                staged_sample.display()
            ),
        });

        let previews = preview_import_candidates_with_discovery_inventory(
            remote_discovery_request(root, true),
            Some(inventory),
        );

        let preview = &previews[0];
        assert_eq!(preview.set.alignment_class, StudioAlignmentClass::SameGrid);
        assert!(preview.set.support_label.contains("sampled"));
        assert!(preview
            .set
            .ingest_audit
            .notes
            .iter()
            .any(|note| note.contains("Staged one remote sample header")));

        fs::remove_dir_all(temp_dir).expect("cleanup temp dir");
    }

    #[test]
    fn regex_discovery_reports_missing_and_duplicate_roles() {
        let temp_dir = make_temp_dir("discovery-audit");
        let maps_dir = temp_dir.join("1001").join("maps");
        fs::create_dir_all(&maps_dir).expect("create maps dir");
        for name in ["beta", "beta_repeat", "tstat"] {
            save_test_nifti(
                &maps_dir.join(format!("{}.nii.gz", name)),
                &[1.0],
                [1, 1, 1],
            );
        }

        let previews = preview_import_candidates(StudioImportPreviewRequest {
            mode: StudioImportMode::Regex,
            manifest_path: None,
            discovery_root: Some(temp_dir.to_string_lossy().to_string()),
            file_pattern: Some(
                r"(?P<subject>\d{4})/maps/(?P<role>beta|tstat|se|pvalue)(?:_[^/]+)?\.nii(\.gz)?$"
                    .to_string(),
            ),
            table_source_label: None,
            table_headers: None,
            table_rows: None,
            table_file_path_column: None,
            table_subject_id_column: None,
            table_excluded_columns: None,
            discovery_max_depth: Some(3),
            discovery_max_files: Some(20),
            discovery_include_patterns: None,
            discovery_exclude_patterns: None,
            discovery_required_roles: Some(vec![
                "beta".to_string(),
                "tstat".to_string(),
                "se".to_string(),
                "pvalue".to_string(),
            ]),
            discovery_role_patterns: None,
            discovery_dry_run: Some(true),
            discovery_sample_headers: None,
        });

        let preview = &previews[0];
        let discovery = preview.discovery.as_ref().expect("discovery summary");
        assert_eq!(discovery.groups.len(), 1);
        assert_eq!(discovery.duplicate_keys, 1);
        assert_eq!(
            discovery.groups[0].missing_roles,
            vec!["pvalue".to_string(), "se".to_string()]
        );
        assert_eq!(
            discovery.groups[0].duplicate_roles,
            vec!["beta".to_string()]
        );
        assert!(!preview.set.ingest_audit.support.ready_for_compare);
        assert!(preview
            .set
            .ingest_audit
            .join
            .issue_details
            .iter()
            .any(|issue| issue.message.contains("missing required role")));
        assert!(preview
            .set
            .ingest_audit
            .join
            .issue_details
            .iter()
            .any(|issue| issue.message.contains("duplicate role")));

        fs::remove_dir_all(temp_dir).expect("cleanup temp dir");
    }

    #[test]
    fn promotes_multi_role_discovery_to_neurotabs_roundtrip() {
        let temp_dir = make_temp_dir("promote-multi-role");
        for subject in ["1001", "1002"] {
            let maps_dir = temp_dir.join(subject).join("maps");
            fs::create_dir_all(&maps_dir).expect("create subject maps dir");
            for role in ["beta", "tstat", "se", "pvalue"] {
                save_test_nifti(
                    &maps_dir.join(format!("{}.nii.gz", role)),
                    &[1.0, 2.0, 3.0, 4.0],
                    [2, 2, 1],
                );
            }
        }

        let discovered = preview_import_candidates(StudioImportPreviewRequest {
            mode: StudioImportMode::Regex,
            manifest_path: None,
            discovery_root: Some(temp_dir.to_string_lossy().to_string()),
            file_pattern: Some(
                r"(?P<subject>\d{4})/maps/(?P<role>beta|tstat|se|pvalue)\.nii(\.gz)?$".to_string(),
            ),
            table_source_label: None,
            table_headers: None,
            table_rows: None,
            table_file_path_column: None,
            table_subject_id_column: None,
            table_excluded_columns: None,
            discovery_max_depth: Some(3),
            discovery_max_files: Some(20),
            discovery_include_patterns: None,
            discovery_exclude_patterns: None,
            discovery_required_roles: Some(vec![
                "beta".to_string(),
                "tstat".to_string(),
                "se".to_string(),
                "pvalue".to_string(),
            ]),
            discovery_role_patterns: None,
            discovery_dry_run: Some(true),
            discovery_sample_headers: Some(true),
        })
        .into_iter()
        .next()
        .expect("discovery candidate");

        let promoted = promote_discovery_to_neurotabs(StudioDiscoveryPromotionRequest {
            candidate: discovered.clone(),
            output_dir: Some(temp_dir.to_string_lossy().to_string()),
        })
        .expect("promote discovery");
        let manifest_path = promoted.manifest_path.as_ref().expect("manifest path");
        assert!(Path::new(manifest_path).exists());
        assert_eq!(promoted.files.len(), 3);

        let roundtrip = promoted.preview.expect("roundtrip preview");
        assert_eq!(roundtrip.mode, StudioImportMode::Manifest);
        assert_eq!(roundtrip.set.id, "study_regex_preview");
        assert_eq!(roundtrip.set.member_ids, discovered.set.member_ids);
        assert_eq!(roundtrip.set.primary_feature_id.as_deref(), Some("tstat"));
        let feature_ids = roundtrip
            .features
            .iter()
            .map(|feature| feature.id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(feature_ids, vec!["tstat", "beta", "pvalue", "se"]);

        let first_member = &roundtrip.set.member_summaries[0];
        let bindings = first_member.bindings.as_ref().expect("bindings");
        let mut binding_roles = bindings
            .iter()
            .map(|binding| binding.role.as_str())
            .collect::<Vec<_>>();
        binding_roles.sort_unstable();
        assert_eq!(binding_roles, vec!["beta", "pvalue", "se", "tstat"]);
        let beta_binding = bindings
            .iter()
            .find(|binding| binding.role == "beta")
            .expect("beta binding");
        assert_eq!(
            beta_binding.source_locator.as_deref(),
            Some("1001/maps/beta.nii.gz")
        );
        assert_eq!(
            beta_binding.availability,
            StudioFieldBindingAvailability::Available
        );
        assert!(roundtrip.set.ingest_audit.support.ready_for_compare);

        fs::remove_dir_all(temp_dir).expect("cleanup temp dir");
    }

    #[test]
    fn promotes_ontology_condition_candidate_through_regex_roundtrip() {
        let temp_dir = make_temp_dir("ontology-condition-roundtrip");
        for subject in ["sub-01", "sub-02"] {
            let maps_dir = temp_dir.join("analysis-a").join(subject).join("maps");
            fs::create_dir_all(&maps_dir).expect("create subject maps dir");
            for condition in ["face", "house"] {
                save_test_nifti(
                    &maps_dir.join(format!("auc_{}.nii.gz", condition)),
                    &[1.0, 2.0, 3.0, 4.0],
                    [2, 2, 1],
                );
            }
        }

        let ontology = preview_folder_ontology(StudioFolderOntologyPreviewRequest {
            root: temp_dir.to_string_lossy().to_string(),
            max_depth: Some(4),
            max_files: Some(20),
            include_patterns: Vec::new(),
            exclude_patterns: Vec::new(),
        });
        let proposal = ontology
            .candidates
            .iter()
            .find(|candidate| candidate.id == "maps-role-condition")
            .expect("condition proposal");
        assert_eq!(proposal.groups.len(), 4);
        assert_eq!(proposal.duplicate_keys, 0);
        assert!(proposal
            .design_columns
            .iter()
            .any(|column| column == "condition"));

        let discovered = preview_import_candidates(StudioImportPreviewRequest {
            mode: StudioImportMode::Regex,
            manifest_path: None,
            discovery_root: Some(temp_dir.to_string_lossy().to_string()),
            file_pattern: Some(proposal.file_pattern.clone()),
            table_source_label: None,
            table_headers: None,
            table_rows: None,
            table_file_path_column: None,
            table_subject_id_column: None,
            table_excluded_columns: None,
            discovery_max_depth: Some(4),
            discovery_max_files: Some(20),
            discovery_include_patterns: None,
            discovery_exclude_patterns: None,
            discovery_required_roles: Some(proposal.required_roles.clone()),
            discovery_role_patterns: Some(proposal.role_patterns.clone()),
            discovery_dry_run: Some(true),
            discovery_sample_headers: Some(true),
        })
        .into_iter()
        .next()
        .expect("discovery candidate");

        let discovery = discovered.discovery.as_ref().expect("discovery summary");
        assert_eq!(discovery.groups.len(), 4);
        assert_eq!(discovery.matched_files, 4);
        assert_eq!(discovery.duplicate_keys, 0);
        assert!(discovery
            .inferred_design_columns
            .iter()
            .any(|column| column == "condition"));
        assert!(discovered.set.ingest_audit.support.ready_for_compare);

        let promoted = promote_discovery_to_neurotabs(StudioDiscoveryPromotionRequest {
            candidate: discovered.clone(),
            output_dir: Some(temp_dir.to_string_lossy().to_string()),
        })
        .expect("promote ontology discovery");
        let roundtrip = promoted.preview.expect("roundtrip preview");
        assert_eq!(roundtrip.mode, StudioImportMode::Manifest);
        assert_eq!(roundtrip.set.member_count, 4);
        assert_eq!(roundtrip.set.member_ids, discovered.set.member_ids);
        assert_eq!(roundtrip.set.primary_feature_id.as_deref(), Some("auc"));
        assert!(roundtrip
            .set
            .design_columns
            .iter()
            .any(|column| column == "condition"));
        assert!(roundtrip.set.ingest_audit.support.ready_for_compare);

        fs::remove_dir_all(temp_dir).expect("cleanup temp dir");
    }

    #[test]
    fn ontology_regex_handoff_blocks_mixed_volume_support() {
        let temp_dir = make_temp_dir("ontology-mixed-support");
        let sub_01_maps = temp_dir.join("sub-01").join("maps");
        let sub_02_maps = temp_dir.join("sub-02").join("maps");
        fs::create_dir_all(&sub_01_maps).expect("create sub-01 maps dir");
        fs::create_dir_all(&sub_02_maps).expect("create sub-02 maps dir");
        save_test_nifti(&sub_01_maps.join("auc.nii.gz"), &[1.0, 2.0], [2, 1, 1]);
        save_test_nifti(&sub_02_maps.join("auc.nii.gz"), &[1.0, 2.0, 3.0], [3, 1, 1]);

        let ontology = preview_folder_ontology(StudioFolderOntologyPreviewRequest {
            root: temp_dir.to_string_lossy().to_string(),
            max_depth: Some(3),
            max_files: Some(20),
            include_patterns: Vec::new(),
            exclude_patterns: Vec::new(),
        });
        let proposal = ontology
            .candidates
            .iter()
            .find(|candidate| candidate.id == "maps-basename-roles")
            .expect("basename role proposal");

        let discovered = preview_import_candidates(StudioImportPreviewRequest {
            mode: StudioImportMode::Regex,
            manifest_path: None,
            discovery_root: Some(temp_dir.to_string_lossy().to_string()),
            file_pattern: Some(proposal.file_pattern.clone()),
            table_source_label: None,
            table_headers: None,
            table_rows: None,
            table_file_path_column: None,
            table_subject_id_column: None,
            table_excluded_columns: None,
            discovery_max_depth: Some(3),
            discovery_max_files: Some(20),
            discovery_include_patterns: None,
            discovery_exclude_patterns: None,
            discovery_required_roles: Some(proposal.required_roles.clone()),
            discovery_role_patterns: Some(proposal.role_patterns.clone()),
            discovery_dry_run: Some(true),
            discovery_sample_headers: Some(true),
        })
        .into_iter()
        .next()
        .expect("discovery candidate");

        assert_eq!(discovered.set.member_count, 2);
        assert_eq!(
            discovered.set.ingest_audit.support.alignment_class,
            StudioAlignmentClass::Mixed
        );
        assert_eq!(
            discovered.set.ingest_audit.support.severity,
            StudioAuditSeverity::Error
        );
        assert!(!discovered.set.ingest_audit.support.ready_for_compare);
        assert_eq!(
            discovered.contract.readiness,
            StudioImportReadiness::InspectOnly
        );
        assert!(discovered
            .set
            .ingest_audit
            .join
            .issue_details
            .iter()
            .any(|issue| issue.message.contains("different grid")));

        fs::remove_dir_all(temp_dir).expect("cleanup temp dir");
    }

    #[test]
    fn folder_set_ingestion_end_to_end_smoke() {
        fn role_inputs_from_member(member: &StudioMemberSummary) -> Vec<StudioRoleBindingInput> {
            member
                .bindings
                .as_ref()
                .expect("member role bindings")
                .iter()
                .map(|binding| StudioRoleBindingInput {
                    member_id: member.id.clone(),
                    role: binding.role.clone(),
                    feature_id: binding.feature_id.clone(),
                    source_path: binding.source_path.clone(),
                    support_kind: binding.support_kind.clone(),
                    support_label: binding.support_label.clone(),
                    availability: binding.availability.clone(),
                })
                .collect()
        }

        let temp_dir = make_temp_dir("folder-set-e2e");
        for (subject_index, subject) in ["1001", "1002", "1003"].iter().enumerate() {
            let maps_dir = temp_dir.join(subject).join("maps");
            fs::create_dir_all(&maps_dir).expect("create subject maps dir");
            let offset = subject_index as f32 * 2.0;
            save_test_nifti(
                &maps_dir.join("tstat.nii.gz"),
                &[1.0 + offset, 3.0 + offset],
                [2, 1, 1],
            );
            save_test_nifti(
                &maps_dir.join("beta.nii.gz"),
                &[10.0 + offset, 20.0 + offset],
                [2, 1, 1],
            );
            save_test_nifti(&maps_dir.join("se.nii.gz"), &[0.1, 0.2], [2, 1, 1]);
            save_test_nifti(&maps_dir.join("pvalue.nii.gz"), &[0.01, 0.02], [2, 1, 1]);
        }

        let discovered = preview_import_candidates(StudioImportPreviewRequest {
            mode: StudioImportMode::Regex,
            manifest_path: None,
            discovery_root: Some(temp_dir.to_string_lossy().to_string()),
            file_pattern: Some(
                r"(?P<subject>\d{4})/maps/(?P<role>beta|tstat|se|pvalue)\.nii(\.gz)?$".to_string(),
            ),
            table_source_label: None,
            table_headers: None,
            table_rows: None,
            table_file_path_column: None,
            table_subject_id_column: None,
            table_excluded_columns: None,
            discovery_max_depth: Some(3),
            discovery_max_files: Some(30),
            discovery_include_patterns: None,
            discovery_exclude_patterns: None,
            discovery_required_roles: Some(vec![
                "beta".to_string(),
                "tstat".to_string(),
                "se".to_string(),
                "pvalue".to_string(),
            ]),
            discovery_role_patterns: None,
            discovery_dry_run: Some(true),
            discovery_sample_headers: Some(true),
        })
        .into_iter()
        .next()
        .expect("discovery candidate");

        let discovery = discovered.discovery.as_ref().expect("discovery summary");
        assert_eq!(discovery.groups.len(), 3);
        assert_eq!(discovery.matched_files, 12);
        assert_eq!(discovery.unmatched_files, 0);
        assert_eq!(discovery.duplicate_keys, 0);
        assert!(discovery
            .groups
            .iter()
            .all(|group| group.bindings.len() == 4 && group.missing_roles.is_empty()));
        assert!(discovered.set.ingest_audit.support.ready_for_compare);

        let promoted = promote_discovery_to_neurotabs(StudioDiscoveryPromotionRequest {
            candidate: discovered,
            output_dir: Some(temp_dir.to_string_lossy().to_string()),
        })
        .expect("promote discovery");
        assert!(promoted
            .manifest_path
            .as_deref()
            .is_some_and(|path| Path::new(path).exists()));
        assert!(promoted
            .files
            .iter()
            .any(|file| file.relative_path.ends_with("brainflow_nftab.yaml")));

        let confirmed = promoted.preview.expect("roundtrip preview");
        assert_eq!(confirmed.mode, StudioImportMode::Manifest);
        assert_eq!(confirmed.set.member_count, 3);
        assert_eq!(confirmed.set.primary_feature_id.as_deref(), Some("tstat"));
        assert!(confirmed.set.ingest_audit.support.ready_for_compare);

        let active_member = confirmed
            .set
            .member_summaries
            .iter()
            .find(|member| member.id == "1001")
            .expect("active member");
        let active_member_source_path = active_member
            .source_path
            .clone()
            .expect("active primary source path");
        let cohort_member_source_paths = confirmed
            .set
            .member_summaries
            .iter()
            .map(|member| {
                member
                    .source_path
                    .clone()
                    .expect("member primary source path")
            })
            .collect::<Vec<_>>();
        let active_member_role_bindings = role_inputs_from_member(active_member);
        let cohort_member_role_bindings = confirmed
            .set
            .member_summaries
            .iter()
            .flat_map(role_inputs_from_member)
            .collect::<Vec<_>>();

        let panes = materialize_compare_panes(StudioCompareMaterializeRequest {
            support_label: confirmed.set.support_label.clone(),
            compare_ready: true,
            force_rematerialize: false,
            active_member_id: Some("1001".to_string()),
            active_member_source_path: Some(active_member_source_path),
            cohort_member_source_paths,
            compare_cohort_id: Some("all-members".to_string()),
            compare_cohort_label: Some("All members".to_string()),
            compare_cohort_member_count: Some(3),
            active_expression_label: Some("Z-score vs all members".to_string()),
            active_expression_recipe: Some("zscore(current, cohort:all-members)".to_string()),
            reducer_specs: Some(vec![
                StudioReducerSpec {
                    id: "mean-tstat".to_string(),
                    label: "Mean tstat".to_string(),
                    kind: StudioReducerKind::Mean,
                    role: "tstat".to_string(),
                    cohort_id: Some("all-members".to_string()),
                    excluded_member_id: None,
                },
                StudioReducerSpec {
                    id: "sd-tstat".to_string(),
                    label: "SD tstat".to_string(),
                    kind: StudioReducerKind::Sd,
                    role: "tstat".to_string(),
                    cohort_id: Some("all-members".to_string()),
                    excluded_member_id: None,
                },
                StudioReducerSpec {
                    id: "loo-mean-tstat".to_string(),
                    label: "LOO mean tstat".to_string(),
                    kind: StudioReducerKind::LeaveOneOutMean,
                    role: "tstat".to_string(),
                    cohort_id: Some("all-members".to_string()),
                    excluded_member_id: Some("1001".to_string()),
                },
            ]),
            active_member_role_bindings: Some(active_member_role_bindings),
            cohort_member_role_bindings: Some(cohort_member_role_bindings),
        });

        for pane_id in [
            "current",
            "cohort-mean",
            "mean-tstat",
            "sd-tstat",
            "loo-mean-tstat",
        ] {
            let pane = panes
                .iter()
                .find(|pane| pane.id == pane_id)
                .expect("expected pane");
            assert_eq!(pane.status, StudioComparePaneStatus::Live, "{pane_id}");
            assert!(pane
                .binding
                .as_ref()
                .and_then(|binding| binding.source_path.as_ref())
                .is_some_and(|path| Path::new(path).exists()));
        }
        assert_eq!(pane_values(&panes, "mean-tstat"), vec![3.0, 5.0]);
        let sd_values = pane_values(&panes, "sd-tstat");
        assert!((sd_values[0] - 1.6329932).abs() < 1.0e-5);
        assert!((sd_values[1] - 1.6329932).abs() < 1.0e-5);
        assert_eq!(pane_values(&panes, "loo-mean-tstat"), vec![4.0, 6.0]);

        let reducer_provenance = panes
            .iter()
            .find(|pane| pane.id == "mean-tstat")
            .and_then(|pane| pane.binding.as_ref())
            .and_then(|binding| binding.provenance_path.as_ref())
            .expect("reducer provenance");
        let provenance_text = fs::read_to_string(reducer_provenance).expect("read provenance");
        assert!(provenance_text.contains("\"selectedRole\": \"tstat\""));
        assert!(provenance_text.contains("\"reducerSpec\""));

        fs::remove_dir_all(temp_dir).expect("cleanup temp dir");
    }

    #[test]
    fn promotes_one_image_per_subject_discovery_to_neurotabs_roundtrip() {
        let temp_dir = make_temp_dir("promote-single-role");
        for subject in ["sub001", "sub002"] {
            let subject_dir = temp_dir.join(subject);
            fs::create_dir_all(&subject_dir).expect("create subject dir");
            save_test_nifti(
                &subject_dir.join("statmap.nii.gz"),
                &[1.0, 2.0, 3.0, 4.0],
                [2, 2, 1],
            );
        }

        let discovered = preview_import_candidates(StudioImportPreviewRequest {
            mode: StudioImportMode::Regex,
            manifest_path: None,
            discovery_root: Some(temp_dir.to_string_lossy().to_string()),
            file_pattern: Some(r"(?P<subject>sub\d+)/statmap\.nii(\.gz)?$".to_string()),
            table_source_label: None,
            table_headers: None,
            table_rows: None,
            table_file_path_column: None,
            table_subject_id_column: None,
            table_excluded_columns: None,
            discovery_max_depth: Some(2),
            discovery_max_files: Some(10),
            discovery_include_patterns: None,
            discovery_exclude_patterns: None,
            discovery_required_roles: None,
            discovery_role_patterns: None,
            discovery_dry_run: Some(true),
            discovery_sample_headers: None,
        })
        .into_iter()
        .next()
        .expect("discovery candidate");

        let promoted = promote_discovery_to_neurotabs(StudioDiscoveryPromotionRequest {
            candidate: discovered,
            output_dir: Some(temp_dir.to_string_lossy().to_string()),
        })
        .expect("promote discovery");
        let roundtrip = promoted.preview.expect("roundtrip preview");

        assert_eq!(roundtrip.set.member_count, 2);
        assert_eq!(roundtrip.features.len(), 1);
        assert_eq!(roundtrip.features[0].id, "statmap");
        assert_eq!(
            roundtrip.set.member_summaries[0]
                .bindings
                .as_ref()
                .expect("bindings")[0]
                .source_locator
                .as_deref(),
            Some("sub001/statmap.nii.gz")
        );
        assert!(roundtrip.set.ingest_audit.support.ready_for_compare);

        fs::remove_dir_all(temp_dir).expect("cleanup temp dir");
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
            discovery_max_depth: None,
            discovery_max_files: None,
            discovery_include_patterns: None,
            discovery_exclude_patterns: None,
            discovery_required_roles: None,
            discovery_role_patterns: None,
            discovery_dry_run: None,
            discovery_sample_headers: None,
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
        assert_eq!(
            preview.contract.readiness,
            StudioImportReadiness::CompareReady
        );
        assert!(preview
            .contract
            .capabilities
            .contains(&StudioImportCapability::MaterializeCompare));
        assert_eq!(
            preview.set.member_ids,
            vec!["sub001".to_string(), "sub002".to_string()]
        );
        assert_eq!(
            preview.set.member_summaries[0].source_path.as_deref(),
            Some(member_a_path.to_string_lossy().as_ref())
        );
        assert_primary_binding(
            &preview.set.member_summaries[0],
            "statmap",
            "feature-statmap",
            &member_a_path,
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
        assert_eq!(preview.cohorts[0].id, "table-all-members");
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
        let support_label = format!("MNI152 2mm {}", temp_dir.display());
        save_test_nifti(&member_a_path, &[1.0, 3.0, 5.0, 7.0], [2, 2, 1]);
        save_test_nifti(&member_b_path, &[3.0, 5.0, 7.0, 9.0], [2, 2, 1]);

        let panes = materialize_compare_panes(StudioCompareMaterializeRequest {
            support_label: support_label.clone(),
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
            reducer_specs: None,
            active_member_role_bindings: None,
            cohort_member_role_bindings: None,
        });

        assert_eq!(panes.len(), 4);
        assert_eq!(panes[0].id, "current");
        assert_eq!(panes[0].status, StudioComparePaneStatus::Live);
        assert_eq!(
            panes[0].binding.as_ref().map(|binding| &binding.kind),
            Some(&StudioCompareBindingKind::MemberSource)
        );
        assert_eq!(
            panes[0]
                .binding
                .as_ref()
                .map(|binding| binding.cache_status.clone()),
            Some(StudioCompareCacheStatus::Source)
        );
        assert_eq!(panes[1].status, StudioComparePaneStatus::Live);
        assert!(panes[1]
            .binding
            .as_ref()
            .map(|binding| binding.ready)
            .unwrap_or(false));
        assert_eq!(
            panes[1]
                .binding
                .as_ref()
                .map(|binding| binding.cache_status.clone()),
            Some(StudioCompareCacheStatus::Miss)
        );
        let cohort_mean_path = panes[1]
            .binding
            .as_ref()
            .and_then(|binding| binding.source_path.as_ref())
            .expect("cohort mean path");
        assert!(Path::new(cohort_mean_path).exists());
        let cohort_mean_manifest_path = panes[1]
            .binding
            .as_ref()
            .and_then(|binding| binding.provenance_path.as_ref())
            .expect("cohort mean manifest path");
        assert!(Path::new(cohort_mean_manifest_path).exists());
        let residual_path = panes[2]
            .binding
            .as_ref()
            .and_then(|binding| binding.source_path.as_ref())
            .expect("residual path");
        assert_eq!(panes[2].status, StudioComparePaneStatus::Live);
        assert!(Path::new(residual_path).exists());
        assert_eq!(
            panes[2]
                .binding
                .as_ref()
                .map(|binding| binding.cache_status.clone()),
            Some(StudioCompareCacheStatus::Miss)
        );
        let zscore_path = panes[3]
            .binding
            .as_ref()
            .and_then(|binding| binding.source_path.as_ref())
            .expect("zscore path");
        assert_eq!(panes[3].status, StudioComparePaneStatus::Live);
        assert!(Path::new(zscore_path).exists());
        assert_eq!(
            panes[3]
                .binding
                .as_ref()
                .map(|binding| binding.cache_status.clone()),
            Some(StudioCompareCacheStatus::Miss)
        );
        assert!(panes[1]
            .binding
            .as_ref()
            .and_then(|binding| binding.materialization_key.as_ref())
            .map(|key| key.starts_with("cohort-mean:"))
            .unwrap_or(false));
        assert!(panes[1]
            .binding
            .as_ref()
            .and_then(|binding| binding.materialized_at_ms)
            .is_some());
        assert!(panes[3]
            .binding
            .as_ref()
            .and_then(|binding| binding.materialized_at_ms)
            .is_some());
        assert_eq!(
            panes[3].recipe.as_deref(),
            Some("zscore(current, cohort:controls)")
        );
        let (zscore_volume, _affine) =
            nifti_loader::load_nifti_volume_auto(Path::new(zscore_path)).expect("load zscore");
        let (zscore_values, _dims) =
            extract_volume_values(&zscore_volume).expect("extract zscore values");
        assert_eq!(zscore_values, vec![-1.0, -1.0, -1.0, -1.0]);

        let cached_panes = materialize_compare_panes(StudioCompareMaterializeRequest {
            support_label: support_label.clone(),
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
            reducer_specs: None,
            active_member_role_bindings: None,
            cohort_member_role_bindings: None,
        });
        assert_eq!(
            cached_panes[1]
                .binding
                .as_ref()
                .map(|binding| binding.cache_status.clone()),
            Some(StudioCompareCacheStatus::Hit)
        );
        assert_eq!(
            cached_panes[2]
                .binding
                .as_ref()
                .map(|binding| binding.cache_status.clone()),
            Some(StudioCompareCacheStatus::Hit)
        );
        assert_eq!(
            cached_panes[3]
                .binding
                .as_ref()
                .map(|binding| binding.cache_status.clone()),
            Some(StudioCompareCacheStatus::Hit)
        );

        let forced_panes = materialize_compare_panes(StudioCompareMaterializeRequest {
            support_label: support_label.clone(),
            compare_ready: true,
            force_rematerialize: true,
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
            reducer_specs: None,
            active_member_role_bindings: None,
            cohort_member_role_bindings: None,
        });
        assert_eq!(
            forced_panes[1]
                .binding
                .as_ref()
                .map(|binding| binding.cache_status.clone()),
            Some(StudioCompareCacheStatus::Forced)
        );
        assert_eq!(
            forced_panes[2]
                .binding
                .as_ref()
                .map(|binding| binding.cache_status.clone()),
            Some(StudioCompareCacheStatus::Forced)
        );
        assert_eq!(
            forced_panes[3]
                .binding
                .as_ref()
                .map(|binding| binding.cache_status.clone()),
            Some(StudioCompareCacheStatus::Forced)
        );

        save_test_nifti(&member_b_path, &[5.0, 7.0, 9.0, 11.0], [2, 2, 1]);
        let rebuilt_panes = materialize_compare_panes(StudioCompareMaterializeRequest {
            support_label,
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
            reducer_specs: None,
            active_member_role_bindings: None,
            cohort_member_role_bindings: None,
        });
        assert_eq!(
            rebuilt_panes[1]
                .binding
                .as_ref()
                .map(|binding| binding.cache_status.clone()),
            Some(StudioCompareCacheStatus::Stale)
        );
        assert_eq!(
            rebuilt_panes[2]
                .binding
                .as_ref()
                .map(|binding| binding.cache_status.clone()),
            Some(StudioCompareCacheStatus::Stale)
        );
        assert_eq!(
            rebuilt_panes[3]
                .binding
                .as_ref()
                .map(|binding| binding.cache_status.clone()),
            Some(StudioCompareCacheStatus::Stale)
        );

        fs::remove_dir_all(temp_dir).expect("cleanup temp dir");
    }

    fn reducer_binding(
        member_id: &str,
        role: &str,
        source_path: &Path,
        support_label: &str,
    ) -> StudioRoleBindingInput {
        StudioRoleBindingInput {
            member_id: member_id.to_string(),
            role: role.to_string(),
            feature_id: Some(role.to_string()),
            source_path: Some(source_path.to_string_lossy().into_owned()),
            support_kind: StudioSupportKind::Volume,
            support_label: Some(support_label.to_string()),
            availability: StudioFieldBindingAvailability::Available,
        }
    }

    fn pane_values(panes: &[bridge_types::StudioComparePaneSpec], pane_id: &str) -> Vec<f32> {
        let source_path = panes
            .iter()
            .find(|pane| pane.id == pane_id)
            .and_then(|pane| pane.binding.as_ref())
            .and_then(|binding| binding.source_path.as_ref())
            .expect("pane source path");
        let (volume, _affine) =
            nifti_loader::load_nifti_volume_auto(Path::new(source_path)).expect("load pane");
        let (values, _dims) = extract_volume_values(&volume).expect("extract pane values");
        values
    }

    #[test]
    fn materializes_role_aware_mean_sd_and_leave_one_out() {
        let temp_dir = make_temp_dir("role-reducers");
        let support_label = format!("role grid {}", temp_dir.display());
        let sub001_tstat = temp_dir.join("sub001_tstat.nii.gz");
        let sub002_tstat = temp_dir.join("sub002_tstat.nii.gz");
        let sub003_tstat = temp_dir.join("sub003_tstat.nii.gz");
        let sub001_beta = temp_dir.join("sub001_beta.nii.gz");
        save_test_nifti(&sub001_tstat, &[1.0, 3.0], [2, 1, 1]);
        save_test_nifti(&sub002_tstat, &[3.0, 5.0], [2, 1, 1]);
        save_test_nifti(&sub003_tstat, &[5.0, 7.0], [2, 1, 1]);
        save_test_nifti(&sub001_beta, &[100.0, 100.0], [2, 1, 1]);

        let panes = materialize_compare_panes(StudioCompareMaterializeRequest {
            support_label: support_label.clone(),
            compare_ready: true,
            force_rematerialize: false,
            active_member_id: Some("sub001".to_string()),
            active_member_source_path: Some(sub001_tstat.to_string_lossy().into_owned()),
            cohort_member_source_paths: vec![
                sub001_tstat.to_string_lossy().into_owned(),
                sub002_tstat.to_string_lossy().into_owned(),
                sub003_tstat.to_string_lossy().into_owned(),
            ],
            compare_cohort_id: Some("all".to_string()),
            compare_cohort_label: Some("All".to_string()),
            compare_cohort_member_count: Some(3),
            active_expression_label: Some("Z-score".to_string()),
            active_expression_recipe: Some("zscore(current, cohort:all)".to_string()),
            reducer_specs: Some(vec![
                StudioReducerSpec {
                    id: "mean-tstat".to_string(),
                    label: "Mean tstat".to_string(),
                    kind: StudioReducerKind::Mean,
                    role: "tstat".to_string(),
                    cohort_id: Some("all".to_string()),
                    excluded_member_id: None,
                },
                StudioReducerSpec {
                    id: "sd-tstat".to_string(),
                    label: "SD tstat".to_string(),
                    kind: StudioReducerKind::Sd,
                    role: "tstat".to_string(),
                    cohort_id: Some("all".to_string()),
                    excluded_member_id: None,
                },
                StudioReducerSpec {
                    id: "loo-mean-tstat".to_string(),
                    label: "LOO mean tstat".to_string(),
                    kind: StudioReducerKind::LeaveOneOutMean,
                    role: "tstat".to_string(),
                    cohort_id: Some("all".to_string()),
                    excluded_member_id: Some("sub001".to_string()),
                },
            ]),
            active_member_role_bindings: Some(vec![
                reducer_binding("sub001", "tstat", &sub001_tstat, &support_label),
                reducer_binding("sub001", "beta", &sub001_beta, &support_label),
            ]),
            cohort_member_role_bindings: Some(vec![
                reducer_binding("sub001", "tstat", &sub001_tstat, &support_label),
                reducer_binding("sub001", "beta", &sub001_beta, &support_label),
                reducer_binding("sub002", "tstat", &sub002_tstat, &support_label),
                reducer_binding("sub003", "tstat", &sub003_tstat, &support_label),
            ]),
        });

        assert_eq!(
            panes
                .iter()
                .find(|pane| pane.id == "mean-tstat")
                .map(|pane| pane.status.clone()),
            Some(StudioComparePaneStatus::Live)
        );
        assert_eq!(pane_values(&panes, "mean-tstat"), vec![3.0, 5.0]);
        let sd_values = pane_values(&panes, "sd-tstat");
        assert!((sd_values[0] - 1.6329932).abs() < 1.0e-5);
        assert!((sd_values[1] - 1.6329932).abs() < 1.0e-5);
        assert_eq!(pane_values(&panes, "loo-mean-tstat"), vec![4.0, 6.0]);
        let mean_manifest_path = panes
            .iter()
            .find(|pane| pane.id == "mean-tstat")
            .and_then(|pane| pane.binding.as_ref())
            .and_then(|binding| binding.provenance_path.as_ref())
            .expect("mean provenance path");
        let manifest_text = fs::read_to_string(mean_manifest_path).expect("read manifest");
        assert!(manifest_text.contains("\"selectedRole\": \"tstat\""));
        assert!(manifest_text.contains("\"reducerSpec\""));
        assert!(manifest_text.contains("\"role:tstat\""));

        fs::remove_dir_all(temp_dir).expect("cleanup temp dir");
    }

    #[test]
    fn role_aware_reducer_reports_missing_role_bindings() {
        let temp_dir = make_temp_dir("role-reducer-missing");
        let support_label = format!("role grid {}", temp_dir.display());
        let sub001_tstat = temp_dir.join("sub001_tstat.nii.gz");
        let sub002_beta = temp_dir.join("sub002_beta.nii.gz");
        save_test_nifti(&sub001_tstat, &[1.0, 3.0], [2, 1, 1]);
        save_test_nifti(&sub002_beta, &[5.0, 7.0], [2, 1, 1]);

        let panes = materialize_compare_panes(StudioCompareMaterializeRequest {
            support_label: support_label.clone(),
            compare_ready: true,
            force_rematerialize: false,
            active_member_id: Some("sub001".to_string()),
            active_member_source_path: Some(sub001_tstat.to_string_lossy().into_owned()),
            cohort_member_source_paths: vec![sub001_tstat.to_string_lossy().into_owned()],
            compare_cohort_id: Some("all".to_string()),
            compare_cohort_label: Some("All".to_string()),
            compare_cohort_member_count: Some(2),
            active_expression_label: Some("Z-score".to_string()),
            active_expression_recipe: Some("zscore(current, cohort:all)".to_string()),
            reducer_specs: Some(vec![StudioReducerSpec {
                id: "mean-tstat".to_string(),
                label: "Mean tstat".to_string(),
                kind: StudioReducerKind::Mean,
                role: "tstat".to_string(),
                cohort_id: Some("all".to_string()),
                excluded_member_id: None,
            }]),
            active_member_role_bindings: Some(vec![reducer_binding(
                "sub001",
                "tstat",
                &sub001_tstat,
                &support_label,
            )]),
            cohort_member_role_bindings: Some(vec![
                reducer_binding("sub001", "tstat", &sub001_tstat, &support_label),
                reducer_binding("sub002", "beta", &sub002_beta, &support_label),
            ]),
        });

        let pane = panes
            .iter()
            .find(|pane| pane.id == "mean-tstat")
            .expect("role reducer pane");
        assert_eq!(pane.status, StudioComparePaneStatus::Blocked);
        assert!(pane.reason.contains("Missing role 'tstat'"));
        assert!(pane.reason.contains("sub002"));

        fs::remove_dir_all(temp_dir).expect("cleanup temp dir");
    }

    fn preview_manifest_candidate(manifest_path: &Path) -> StudioImportCandidate {
        preview_import_candidates(StudioImportPreviewRequest {
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
        .next()
        .expect("manifest candidate")
    }

    fn issue_messages(candidate: &StudioImportCandidate) -> Vec<String> {
        candidate
            .set
            .ingest_audit
            .join
            .issue_details
            .iter()
            .map(|issue| issue.message.clone())
            .collect()
    }

    fn fixture_root() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures/neurotabs")
    }

    fn copy_dir_recursive(source: &Path, destination: &Path) {
        fs::create_dir_all(destination).expect("create destination fixture dir");
        for entry in fs::read_dir(source).expect("read fixture dir") {
            let entry = entry.expect("read fixture entry");
            let source_path = entry.path();
            let destination_path = destination.join(entry.file_name());
            if entry.file_type().expect("read fixture file type").is_dir() {
                copy_dir_recursive(&source_path, &destination_path);
            } else {
                fs::copy(&source_path, &destination_path).expect("copy fixture file");
            }
        }
    }

    fn copy_neurotabs_fixture(relative: &str, label: &str) -> PathBuf {
        let destination = make_temp_dir(label);
        copy_dir_recursive(&fixture_root().join(relative), &destination);
        destination
    }

    fn assert_issue_contains(candidate: &StudioImportCandidate, expected: &str) {
        let messages = issue_messages(candidate);
        assert!(
            messages.iter().any(|message| message.contains(expected)),
            "expected an issue containing '{expected}', got {messages:?}"
        );
    }

    #[test]
    fn neurotabs_faces_demo_fixture_is_compare_ready() {
        let package_dir = copy_neurotabs_fixture("faces-demo", "fixture-faces-demo");
        let maps_dir = package_dir.join("maps");
        fs::create_dir_all(&maps_dir).expect("create maps dir");
        save_test_nifti(
            &maps_dir.join("group_stats.nii.gz"),
            &[1.0, 2.0, 3.0, 4.0],
            [2, 2, 1],
        );

        let candidate = preview_manifest_candidate(&package_dir.join("nftab.yaml"));

        assert_eq!(candidate.set.id, "faces-demo");
        assert_eq!(candidate.set.member_count, 8);
        assert_eq!(candidate.set.primary_feature_id.as_deref(), Some("statmap"));
        assert_eq!(candidate.features[0].id, "statmap");
        assert_eq!(candidate.set.support_kind, StudioSupportKind::Volume);
        assert_eq!(
            candidate.set.alignment_class,
            StudioAlignmentClass::SameGrid
        );
        assert_eq!(
            candidate.set.ingest_audit.join.severity,
            StudioAuditSeverity::Ok
        );
        assert_eq!(candidate.set.ingest_audit.join.matched_rows, 8);
        assert_eq!(candidate.set.ingest_audit.join.unmatched_rows, 0);
        assert_eq!(candidate.set.ingest_audit.join.duplicate_keys, 0);
        assert!(candidate.set.ingest_audit.join.issue_details.is_empty());
        assert!(candidate.set.ingest_audit.support.ready_for_compare);
        assert_eq!(
            candidate.contract.readiness,
            StudioImportReadiness::CompareReady
        );
        assert!(candidate
            .contract
            .capabilities
            .contains(&StudioImportCapability::Compare));
        assert_eq!(candidate.cohorts[0].member_count, 8);
        assert_eq!(
            candidate.set.member_summaries[0].source_path.as_deref(),
            Some(
                maps_dir
                    .join("group_stats.nii.gz")
                    .to_string_lossy()
                    .as_ref()
            )
        );
        assert_primary_binding(
            &candidate.set.member_summaries[0],
            "statmap",
            "statmap",
            &maps_dir.join("group_stats.nii.gz"),
        );
        let binding = candidate.set.member_summaries[0]
            .bindings
            .as_ref()
            .expect("bindings")
            .iter()
            .find(|binding| binding.is_primary)
            .expect("primary binding");
        assert_eq!(
            binding.source_locator.as_deref(),
            Some("maps/group_stats.nii.gz")
        );
        assert_eq!(binding.selector.as_deref(), Some(r#"{"index":{"t":0}}"#));
        assert!(binding
            .support_label
            .as_deref()
            .unwrap_or("")
            .contains("MNI152NLin2009cAsym"));

        fs::remove_dir_all(package_dir).expect("cleanup fixture dir");
    }

    #[test]
    fn neurotabs_roi_only_fixture_imports_for_inspection_only() {
        let candidate = preview_manifest_candidate(&fixture_root().join("roi-only/nftab.yaml"));

        assert_eq!(candidate.set.id, "roi-only");
        assert_eq!(candidate.set.member_count, 8);
        assert_eq!(
            candidate.set.primary_feature_id.as_deref(),
            Some("roi_beta")
        );
        assert_eq!(candidate.features[0].id, "roi_beta");
        assert_eq!(candidate.set.support_kind, StudioSupportKind::Unknown);
        assert_eq!(
            candidate.set.ingest_audit.join.severity,
            StudioAuditSeverity::Ok
        );
        assert_eq!(candidate.set.ingest_audit.join.matched_rows, 8);
        assert!(candidate.set.ingest_audit.join.issue_details.is_empty());
        assert!(!candidate.set.ingest_audit.support.ready_for_compare);
        assert_eq!(
            candidate.contract.readiness,
            StudioImportReadiness::InspectOnly
        );
        assert!(candidate.contract.can_import);
        assert!(candidate
            .set
            .design_columns
            .iter()
            .any(|column| column == "age"));
    }

    #[test]
    fn neurotabs_surface_manifest_imports_for_inspection_only() {
        let package_dir = make_temp_dir("surface-inspect-only");
        fs::write(
            package_dir.join("surface.func.gii"),
            "placeholder surface data",
        )
        .expect("write surface placeholder");
        fs::write(
            package_dir.join("observations.csv"),
            "row_id,subject,surface_path\nrow001,sub001,surface.func.gii\n",
        )
        .expect("write observations");
        let manifest_path = package_dir.join("nftab.yaml");
        fs::write(
            &manifest_path,
            r#"
spec_version: "0.1.0"
dataset_id: surface_demo
storage_profile: table-package
observation_table:
  path: observations.csv
  format: csv
row_id: row_id
observation_axes: [subject]
observation_columns:
  row_id: { dtype: string }
  subject: { dtype: string }
  surface_path: { dtype: string }
features:
  surface_stat:
    logical:
      kind: surface
      axes: [vertex]
      dtype: float32
      support_ref: fsaverage_left
      shape: [3]
      alignment: same_topology
    encodings:
      - type: ref
        binding:
          backend: gifti
          locator:
            column: surface_path
supports:
  fsaverage_left:
    support_type: surface
    support_id: fsaverage-left-test
    template: fsaverage
    mesh_id: fsaverage-lh
    topology_id: fsaverage-lh
    hemisphere: left
"#,
        )
        .expect("write manifest");

        let candidate = preview_manifest_candidate(&manifest_path);

        assert_eq!(candidate.set.id, "surface_demo");
        assert_eq!(candidate.set.member_count, 1);
        assert_eq!(candidate.set.support_kind, StudioSupportKind::Surface);
        assert_eq!(
            candidate.set.alignment_class,
            StudioAlignmentClass::SameTopology
        );
        assert_eq!(
            candidate.set.ingest_audit.join.severity,
            StudioAuditSeverity::Ok
        );
        assert!(!candidate.set.ingest_audit.support.ready_for_compare);
        assert_eq!(
            candidate.contract.readiness,
            StudioImportReadiness::InspectOnly
        );
        assert!(candidate.contract.can_import);
        assert!(!candidate
            .contract
            .capabilities
            .contains(&StudioImportCapability::Compare));
        assert!(candidate
            .set
            .ingest_audit
            .notes
            .iter()
            .any(|note| note.contains("Surface compare materialization is not implemented")));

        fs::remove_dir_all(package_dir).expect("cleanup fixture dir");
    }

    #[test]
    fn neurotabs_invalid_fixtures_report_parser_failures() {
        for (relative_path, expected_message) in [
            ("invalid/malformed-yaml/nftab.yaml", "YAML parse error"),
            ("invalid/malformed-json/nftab.json", "JSON parse error"),
            ("invalid/unsupported-table-format/nftab.yaml", "xlsx"),
            (
                "invalid/missing-row-id-header/nftab.yaml",
                "Row id column row_id",
            ),
            ("invalid/missing-support-ref/nftab.yaml", "support_ref"),
            ("invalid/unknown-support-ref/nftab.yaml", "missing_mni"),
            (
                "invalid/invalid-extension-key/nftab.yaml",
                "$.extensions.bad-key",
            ),
        ] {
            let candidate = preview_manifest_candidate(&fixture_root().join(relative_path));
            assert_eq!(
                candidate.set.ingest_audit.join.severity,
                StudioAuditSeverity::Error
            );
            assert_eq!(candidate.set.member_count, 0);
            assert!(candidate.features.is_empty());
            assert!(candidate.cohorts.is_empty());
            assert!(candidate.expressions.is_empty());
            assert!(!candidate.set.ingest_audit.support.ready_for_compare);
            assert_eq!(candidate.contract.readiness, StudioImportReadiness::Blocked);
            assert!(!candidate.contract.can_import);
            assert!(candidate.contract.capabilities.is_empty());
            assert_issue_contains(&candidate, expected_message);
            assert!(candidate
                .set
                .ingest_audit
                .notes
                .iter()
                .any(|note| note.contains("No fallback data was generated")));
        }
    }

    #[test]
    fn neurotabs_invalid_fixtures_report_audit_failures() {
        let duplicate_keys =
            preview_manifest_candidate(&fixture_root().join("invalid/duplicate-keys/nftab.yaml"));
        assert_eq!(duplicate_keys.set.id, "duplicate_keys");
        assert_eq!(duplicate_keys.set.ingest_audit.join.duplicate_keys, 1);
        assert_eq!(
            duplicate_keys.set.ingest_audit.join.severity,
            StudioAuditSeverity::Warning
        );
        assert_issue_contains(&duplicate_keys, "Duplicate row_id");
        assert_issue_contains(&duplicate_keys, "Duplicate observation-axis tuple");

        let missing_source = preview_manifest_candidate(
            &fixture_root().join("invalid/missing-source-file/nftab.yaml"),
        );
        assert_eq!(missing_source.set.ingest_audit.join.unmatched_rows, 1);
        assert_eq!(
            missing_source.set.ingest_audit.join.severity,
            StudioAuditSeverity::Warning
        );
        assert!(!missing_source.set.ingest_audit.support.ready_for_compare);
        assert_issue_contains(&missing_source, "does not exist");

        let missing_registry = preview_manifest_candidate(
            &fixture_root().join("invalid/missing-resource-registry/nftab.yaml"),
        );
        assert_eq!(missing_registry.set.ingest_audit.join.unmatched_rows, 1);
        assert_issue_contains(&missing_registry, "no resources table is declared");
        assert_issue_contains(&missing_registry, "no resource registry record");

        let unresolved_resource = preview_manifest_candidate(
            &fixture_root().join("invalid/unresolved-resource-id/nftab.yaml"),
        );
        assert_eq!(unresolved_resource.set.ingest_audit.join.unmatched_rows, 1);
        assert_issue_contains(&unresolved_resource, "does not contain it");

        let package_dir =
            copy_neurotabs_fixture("invalid/shape-mismatch", "fixture-shape-mismatch");
        let maps_dir = package_dir.join("maps");
        fs::create_dir_all(&maps_dir).expect("create maps dir");
        save_test_nifti(
            &maps_dir.join("sub001_t.nii.gz"),
            &[1.0, 2.0, 3.0, 4.0],
            [2, 2, 1],
        );
        let shape_mismatch = preview_manifest_candidate(&package_dir.join("nftab.yaml"));
        assert_eq!(shape_mismatch.set.ingest_audit.join.unmatched_rows, 0);
        assert!(!shape_mismatch.set.ingest_audit.support.ready_for_compare);
        assert_issue_contains(&shape_mismatch, "does not match declared logical shape");
        fs::remove_dir_all(package_dir).expect("cleanup fixture dir");
    }

    #[test]
    fn manifest_missing_observation_table_is_audit_issue() {
        let temp_dir = make_temp_dir("manifest-missing-table");
        let manifest_path = temp_dir.join("missing-table.neurotabs.yaml");
        fs::write(
            &manifest_path,
            r#"
spec_version: "0.1.0"
dataset_id: missing_table
storage_profile: "table-package"
observation_table:
  path: missing.csv
  format: csv
row_id: row_id
observation_axes: [subject]
observation_columns:
  row_id: { dtype: string }
  subject: { dtype: string }
  statmap_path: { dtype: string }
primary_feature: statmap
features:
  statmap:
    logical:
      kind: volume
      axes: [x, y, z]
      dtype: float32
      support_ref: mni
      shape: [2, 2, 1]
      alignment: same_grid
    encodings:
      - type: ref
        binding:
          backend: nifti
          locator:
            column: statmap_path
supports:
  mni:
    support_type: volume
    support_id: mni-demo
    space: MNI152NLin2009cAsym
    grid_id: mni-grid
"#,
        )
        .expect("write manifest");

        let candidate = preview_manifest_candidate(&manifest_path);
        assert!(!candidate.set.ingest_audit.support.ready_for_compare);
        assert!(issue_messages(&candidate)
            .iter()
            .any(|message| message.contains("Observation table")));

        fs::remove_dir_all(temp_dir).expect("cleanup temp dir");
    }

    #[test]
    fn manifest_missing_source_file_blocks_compare_but_imports() {
        let temp_dir = make_temp_dir("manifest-missing-source");
        let manifest_path = temp_dir.join("missing-source.neurotabs.yaml");
        fs::write(
            temp_dir.join("observations.csv"),
            "row_id,subject,statmap_path\nsub001,s01,maps/missing.nii.gz\n",
        )
        .expect("write observations");
        fs::write(
            &manifest_path,
            r#"
spec_version: "0.1.0"
dataset_id: missing_source
storage_profile: "table-package"
observation_table:
  path: observations.csv
  format: csv
row_id: row_id
observation_axes: [subject]
observation_columns:
  row_id: { dtype: string }
  subject: { dtype: string }
  statmap_path: { dtype: string }
primary_feature: statmap
features:
  statmap:
    logical:
      kind: volume
      axes: [x, y, z]
      dtype: float32
      support_ref: mni
      shape: [2, 2, 1]
      alignment: same_grid
    encodings:
      - type: ref
        binding:
          backend: nifti
          locator:
            column: statmap_path
supports:
  mni:
    support_type: volume
    support_id: mni-demo
    space: MNI152NLin2009cAsym
    grid_id: mni-grid
"#,
        )
        .expect("write manifest");

        let candidate = preview_manifest_candidate(&manifest_path);
        assert_eq!(candidate.set.ingest_audit.join.matched_rows, 1);
        assert_eq!(candidate.set.ingest_audit.join.unmatched_rows, 1);
        assert!(!candidate.set.ingest_audit.support.ready_for_compare);
        assert!(issue_messages(&candidate)
            .iter()
            .any(|message| message.contains("does not exist")));

        fs::remove_dir_all(temp_dir).expect("cleanup temp dir");
    }

    #[test]
    fn manifest_resource_registry_failures_are_audit_issues() {
        let temp_dir = make_temp_dir("manifest-resources");
        fs::write(
            temp_dir.join("observations.csv"),
            "row_id,subject,stat_res\nsub001,s01,res_missing\n",
        )
        .expect("write observations");
        let no_registry_path = temp_dir.join("no-registry.neurotabs.yaml");
        fs::write(
            &no_registry_path,
            r#"
spec_version: "0.1.0"
dataset_id: no_registry
storage_profile: "table-package"
observation_table:
  path: observations.csv
  format: csv
row_id: row_id
observation_axes: [subject]
observation_columns:
  row_id: { dtype: string }
  subject: { dtype: string }
  stat_res: { dtype: string }
primary_feature: statmap
features:
  statmap:
    logical:
      kind: volume
      axes: [x, y, z]
      dtype: float32
      support_ref: mni
      shape: [2, 2, 1]
      alignment: same_grid
    encodings:
      - type: ref
        binding:
          resource_id:
            column: stat_res
supports:
  mni:
    support_type: volume
    support_id: mni-demo
    space: MNI152NLin2009cAsym
    grid_id: mni-grid
"#,
        )
        .expect("write manifest without registry");
        let no_registry = preview_manifest_candidate(&no_registry_path);
        assert!(!no_registry.set.ingest_audit.support.ready_for_compare);
        assert!(issue_messages(&no_registry)
            .iter()
            .any(|message| message.contains("no resources table is declared")));

        fs::write(
            temp_dir.join("resources.csv"),
            "resource_id,backend,locator\nother,nifti,maps/other.nii.gz\n",
        )
        .expect("write resources");
        let missing_id_path = temp_dir.join("missing-resource-id.neurotabs.yaml");
        fs::write(
            &missing_id_path,
            r#"
spec_version: "0.1.0"
dataset_id: missing_resource_id
storage_profile: "table-package"
observation_table:
  path: observations.csv
  format: csv
resources:
  path: resources.csv
  format: csv
row_id: row_id
observation_axes: [subject]
observation_columns:
  row_id: { dtype: string }
  subject: { dtype: string }
  stat_res: { dtype: string }
primary_feature: statmap
features:
  statmap:
    logical:
      kind: volume
      axes: [x, y, z]
      dtype: float32
      support_ref: mni
      shape: [2, 2, 1]
      alignment: same_grid
    encodings:
      - type: ref
        binding:
          resource_id:
            column: stat_res
supports:
  mni:
    support_type: volume
    support_id: mni-demo
    space: MNI152NLin2009cAsym
    grid_id: mni-grid
"#,
        )
        .expect("write manifest with registry");
        let missing_id = preview_manifest_candidate(&missing_id_path);
        assert!(!missing_id.set.ingest_audit.support.ready_for_compare);
        assert!(issue_messages(&missing_id)
            .iter()
            .any(|message| message.contains("does not contain it")));

        fs::remove_dir_all(temp_dir).expect("cleanup temp dir");
    }

    #[test]
    fn manifest_reports_missing_locator_columns_and_duplicate_keys() {
        let temp_dir = make_temp_dir("manifest-locator-column");
        let manifest_path = temp_dir.join("missing-locator-column.neurotabs.yaml");
        fs::write(
            temp_dir.join("observations.csv"),
            "row_id,subject\nsub001,s01\nsub001,s01\n",
        )
        .expect("write observations");
        fs::write(
            &manifest_path,
            r#"
spec_version: "0.1.0"
dataset_id: missing_locator_column
storage_profile: "table-package"
observation_table:
  path: observations.csv
  format: csv
row_id: row_id
observation_axes: [subject]
observation_columns:
  row_id: { dtype: string }
  subject: { dtype: string }
  statmap_path: { dtype: string }
primary_feature: statmap
features:
  statmap:
    logical:
      kind: volume
      axes: [x, y, z]
      dtype: float32
      support_ref: mni
      shape: [2, 2, 1]
      alignment: same_grid
    encodings:
      - type: ref
        binding:
          backend: nifti
          locator:
            column: statmap_path
supports:
  mni:
    support_type: volume
    support_id: mni-demo
    space: MNI152NLin2009cAsym
    grid_id: mni-grid
"#,
        )
        .expect("write manifest");

        let candidate = preview_manifest_candidate(&manifest_path);
        assert_eq!(candidate.set.ingest_audit.join.duplicate_keys, 1);
        assert_eq!(candidate.set.ingest_audit.join.unmatched_rows, 2);
        let messages = issue_messages(&candidate);
        assert!(messages
            .iter()
            .any(|message| message.contains("Locator column statmap_path")));
        assert!(messages
            .iter()
            .any(|message| message.contains("Duplicate row_id")));
        assert!(messages
            .iter()
            .any(|message| message.contains("Duplicate observation-axis tuple")));

        fs::remove_dir_all(temp_dir).expect("cleanup temp dir");
    }

    #[test]
    fn manifest_nifti_shape_mismatch_blocks_compare() {
        let temp_dir = make_temp_dir("manifest-shape-mismatch");
        let manifest_path = temp_dir.join("shape-mismatch.neurotabs.yaml");
        let maps_dir = temp_dir.join("maps");
        fs::create_dir_all(&maps_dir).expect("create maps dir");
        save_test_nifti(
            &maps_dir.join("sub001_t.nii.gz"),
            &[1.0, 2.0, 3.0, 4.0],
            [2, 2, 1],
        );
        fs::write(
            temp_dir.join("observations.csv"),
            "row_id,subject,statmap_path\nsub001,s01,maps/sub001_t.nii.gz\n",
        )
        .expect("write observations");
        fs::write(
            &manifest_path,
            r#"
spec_version: "0.1.0"
dataset_id: shape_mismatch
storage_profile: "table-package"
observation_table:
  path: observations.csv
  format: csv
row_id: row_id
observation_axes: [subject]
observation_columns:
  row_id: { dtype: string }
  subject: { dtype: string }
  statmap_path: { dtype: string }
primary_feature: statmap
features:
  statmap:
    logical:
      kind: volume
      axes: [x, y, z]
      dtype: float32
      support_ref: mni
      shape: [3, 3, 1]
      alignment: same_grid
    encodings:
      - type: ref
        binding:
          backend: nifti
          locator:
            column: statmap_path
supports:
  mni:
    support_type: volume
    support_id: mni-demo
    space: MNI152NLin2009cAsym
    grid_id: mni-grid
"#,
        )
        .expect("write manifest");

        let candidate = preview_manifest_candidate(&manifest_path);
        assert_eq!(candidate.set.ingest_audit.join.unmatched_rows, 0);
        assert!(!candidate.set.ingest_audit.support.ready_for_compare);
        assert!(issue_messages(&candidate)
            .iter()
            .any(|message| message.contains("does not match declared logical shape")));

        fs::remove_dir_all(temp_dir).expect("cleanup temp dir");
    }

    #[test]
    fn parses_manifest_and_observation_table_preview() {
        let temp_dir = make_temp_dir("manifest");
        let manifest_path = temp_dir.join("demo.neurotabs.yaml");
        let table_path = temp_dir.join("observations.csv");
        let maps_dir = temp_dir.join("maps");
        fs::create_dir_all(&maps_dir).expect("create maps dir");
        save_test_nifti(
            &maps_dir.join("sub001_t.nii.gz"),
            &[1.0, 2.0, 3.0, 4.0],
            [2, 2, 1],
        );
        save_test_nifti(
            &maps_dir.join("sub002_t.nii.gz"),
            &[2.0, 3.0, 4.0, 5.0],
            [2, 2, 1],
        );

        fs::write(
            &table_path,
            "member_id,subject,diagnosis,statmap_path\nsub001,s01,control,maps/sub001_t.nii.gz\nsub002,s02,case,maps/sub002_t.nii.gz\n",
        )
        .expect("write observation table");
        fs::write(
            &manifest_path,
            r#"
spec_version: "0.1.0"
dataset_id: demo_study
storage_profile: "table-package"
row_id: member_id
primary_feature: statmap
observation_axes:
  - subject
observation_columns:
  member_id: { dtype: string }
  subject: { dtype: string }
  diagnosis: { dtype: string }
  statmap_path: { dtype: string }
observation_table:
  path: observations.csv
  format: csv
supports:
  mni2mm:
    support_type: volume
    support_id: mni152-2mm-demo
    space: MNI152NLin2009cAsym
    grid_id: mni152-2mm
features:
  statmap:
    description: T statistic
    logical:
      kind: volume
      axes: [x, y, z]
      dtype: float32
      shape: [2, 2, 1]
      support_ref: mni2mm
      alignment: same_grid
    encodings:
      - type: ref
        binding:
          backend: nifti
          locator:
            column: statmap_path
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
            discovery_max_depth: None,
            discovery_max_files: None,
            discovery_include_patterns: None,
            discovery_exclude_patterns: None,
            discovery_required_roles: None,
            discovery_role_patterns: None,
            discovery_dry_run: None,
            discovery_sample_headers: None,
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
            vec!["subject".to_string(), "diagnosis".to_string(),]
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
        assert_primary_binding(
            &preview.set.member_summaries[0],
            "statmap",
            "statmap",
            &temp_dir.join("maps/sub001_t.nii.gz"),
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
