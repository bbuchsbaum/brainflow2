mod materialize;
pub mod neurotabs;
pub mod population;
pub mod population_inference;
mod preview;
mod promote;
mod series;

pub use materialize::materialize_compare_panes;
pub use preview::{
    preview_folder_ontology, preview_folder_ontology_with_discovery_inventory,
    preview_import_candidates, preview_import_candidates_with_discovery_inventory,
    DiscoveryHeaderAudit, DiscoveryInventory, DiscoveryInventoryFile,
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
        save_test_nifti_at_origin(path, data, dims, 0.0);
    }

    fn save_test_nifti_at_origin(path: &Path, data: &[f32], dims: [u16; 3], origin_x: f32) {
        let header = NiftiHeader {
            dim: [3, dims[0], dims[1], dims[2], 1, 1, 1, 1],
            datatype: 16,
            bitpix: 32,
            sform_code: 1,
            qform_code: 0,
            srow_x: [1.0, 0.0, 0.0, origin_x],
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
        assert_eq!(
            first_member.design_values.as_ref().unwrap()["subject"],
            "1001"
        );
        assert_eq!(
            preview.set.member_summaries[1]
                .design_values
                .as_ref()
                .unwrap()["subject"],
            "1002"
        );
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
        assert!(!preview.set.ingest_audit.support.ready_for_compare);
        assert_eq!(preview.set.alignment_class, StudioAlignmentClass::Unknown);
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

    /// An inventory that arrives without a header audit says nothing about
    /// the grid, so the set is never comparable, however complete its files.
    #[test]
    fn remote_inventory_without_a_header_audit_is_never_compare_ready() {
        let root = "/remote-cache/live-mount";
        let previews = preview_import_candidates_with_discovery_inventory(
            remote_discovery_request(root, true),
            Some(complete_remote_inventory(root)),
        );

        let preview = &previews[0];
        assert_eq!(preview.set.alignment_class, StudioAlignmentClass::Unknown);
        assert_eq!(preview.set.support_label, "headers not sampled");
        assert!(!preview.set.ingest_audit.support.ready_for_compare);
        assert_ne!(
            preview.contract.readiness,
            StudioImportReadiness::CompareReady
        );
        support_issue(preview, "did not read image headers");
    }

    /// Header facts as a remote audit obtains them: parsed from the leading
    /// bytes of a real gzipped NIfTI file.
    fn streamed_header(dims: [u16; 3]) -> nifti_loader::HeaderSummary {
        let dir = make_temp_dir("streamed-header");
        let path = dir.join("member.nii.gz");
        let voxels = dims.iter().map(|&d| d as usize).product::<usize>();
        save_test_nifti(&path, &vec![1.0; voxels], dims);
        let bytes = fs::read(&path).expect("read fixture bytes");
        fs::remove_dir_all(dir).expect("cleanup temp dir");
        nifti_loader::header_summary_from_prefix(&bytes)
            .expect("parse header prefix")
            .expect("complete header")
    }

    /// The inventory of [`complete_remote_inventory`] with a header for every
    /// file the discovery binds.
    fn audited_remote_inventory(root: &str) -> DiscoveryInventory {
        let mut inventory = complete_remote_inventory(root);
        let header = streamed_header([2, 3, 4]);
        inventory.header_audit = Some(DiscoveryHeaderAudit {
            headers: inventory
                .files
                .iter()
                .filter(|file| !file.relative_path.starts_with("notes/"))
                .map(|file| (file.source_path.clone(), Ok(header.clone())))
                .collect(),
            ..DiscoveryHeaderAudit::default()
        });
        inventory
    }

    fn remote_audit_preview(root: &str, inventory: DiscoveryInventory) -> StudioImportCandidate {
        // The unmatched notes/loose.nii.gz is a join warning of its own, so
        // these tests exclude it to isolate the support audit.
        let mut request = remote_discovery_request(root, true);
        request.discovery_exclude_patterns = Some(vec!["^notes/".to_string()]);
        preview_import_candidates_with_discovery_inventory(request, Some(inventory)).remove(0)
    }

    fn support_issue<'a>(
        preview: &'a StudioImportCandidate,
        needle: &str,
    ) -> &'a bridge_types::StudioJoinIssueDetail {
        preview
            .set
            .ingest_audit
            .join
            .issue_details
            .iter()
            .find(|issue| issue.message.contains(needle))
            .unwrap_or_else(|| panic!("no issue mentioning {needle:?}"))
    }

    #[test]
    fn remote_inventory_with_every_header_on_one_grid_is_compare_ready() {
        let root = "/remote-cache/live-mount";
        let preview = remote_audit_preview(root, audited_remote_inventory(root));

        assert_eq!(preview.set.member_count, 2);
        assert_eq!(preview.set.alignment_class, StudioAlignmentClass::SameGrid);
        assert!(preview.set.ingest_audit.support.ready_for_compare);
        assert_eq!(
            preview.contract.readiness,
            StudioImportReadiness::CompareReady
        );
        assert!(preview
            .contract
            .capabilities
            .contains(&StudioImportCapability::Compare));
        // No file was downloaded to reach that verdict.
        assert!(preview
            .set
            .member_summaries
            .iter()
            .filter_map(|member| member.source_path.as_deref())
            .all(|path| !Path::new(path).exists()));
    }

    /// A set audited over a mount and the same files audited on disk must be
    /// described identically, label included: downstream code reads the label.
    #[test]
    fn remote_header_audit_matches_the_local_audit_of_the_same_files() {
        let local_root = make_temp_dir("remote-local-parity");
        let mut headers = std::collections::HashMap::new();
        let mut files = Vec::new();
        for subject in ["1001", "1002"] {
            let maps = local_root.join(subject).join("maps");
            fs::create_dir_all(&maps).expect("create maps dir");
            for role in ["beta", "tstat", "se", "pvalue"] {
                let path = maps.join(format!("{role}.nii.gz"));
                save_test_nifti(&path, &[1.0; 24], [2, 3, 4]);
                let relative = format!("{subject}/maps/{role}.nii.gz");
                let file = remote_inventory_file("/remote-cache/live-mount", &relative);
                let bytes = fs::read(&path).expect("read fixture bytes");
                headers.insert(
                    file.source_path.clone(),
                    Ok(nifti_loader::header_summary_from_prefix(&bytes)
                        .expect("parse header prefix")
                        .expect("complete header")),
                );
                files.push(file);
            }
        }
        let local = preview_import_candidates(remote_discovery_request(
            &local_root.to_string_lossy(),
            true,
        ))
        .remove(0);
        let remote = preview_import_candidates_with_discovery_inventory(
            remote_discovery_request("/remote-cache/live-mount", true),
            Some(DiscoveryInventory {
                root_exists: true,
                files,
                header_audit: Some(DiscoveryHeaderAudit {
                    headers,
                    ..DiscoveryHeaderAudit::default()
                }),
                ..DiscoveryInventory::default()
            }),
        )
        .remove(0);

        assert!(local.set.ingest_audit.support.ready_for_compare);
        assert_eq!(
            local.set.support_label,
            "2×3×4 voxels · 1.00×1.00×1.00 mm (sampled)"
        );
        assert_eq!(remote.set.support_label, local.set.support_label);
        assert_eq!(remote.set.alignment_class, local.set.alignment_class);
        assert_eq!(
            remote.set.ingest_audit.support.ready_for_compare,
            local.set.ingest_audit.support.ready_for_compare
        );
        assert_eq!(remote.contract.readiness, local.contract.readiness);
        assert_eq!(remote.contract.capabilities, local.contract.capabilities);
        fs::remove_dir_all(local_root).expect("cleanup temp dir");
    }

    #[test]
    fn remote_inventory_with_one_differing_grid_names_the_member_and_is_not_ready() {
        let root = "/remote-cache/live-mount";
        let mut inventory = audited_remote_inventory(root);
        inventory.header_audit.as_mut().unwrap().headers.insert(
            format!("{root}/1002/maps/se.nii.gz"),
            Ok(streamed_header([2, 3, 5])),
        );
        let preview = remote_audit_preview(root, inventory);

        assert_eq!(preview.set.alignment_class, StudioAlignmentClass::Mixed);
        assert_eq!(preview.set.support_label, "mixed volume grids (sampled)");
        assert!(!preview.set.ingest_audit.support.ready_for_compare);
        assert_eq!(
            preview.set.ingest_audit.support.severity,
            StudioAuditSeverity::Error
        );
        assert_eq!(
            preview.contract.readiness,
            StudioImportReadiness::InspectOnly
        );
        let issue = support_issue(&preview, "different grid");
        assert_eq!(issue.member_ids, vec!["1002".to_string()]);
        assert!(
            issue.message.contains("dimensions or voxel size differ"),
            "{}",
            issue.message
        );
    }

    /// The audited inventory with one member file's affine replaced.
    fn remote_preview_with_affine(
        relative_path: &str,
        edit: impl FnOnce(&mut nifti_loader::VoxelToWorld),
    ) -> StudioImportCandidate {
        let root = "/remote-cache/live-mount";
        let mut inventory = audited_remote_inventory(root);
        let mut header = streamed_header([2, 3, 4]);
        edit(&mut header.affine);
        inventory
            .header_audit
            .as_mut()
            .unwrap()
            .headers
            .insert(format!("{root}/{relative_path}"), Ok(header));
        remote_audit_preview(root, inventory)
    }

    fn assert_mixed_by_placement(preview: &StudioImportCandidate, member: &str) {
        assert_eq!(preview.set.alignment_class, StudioAlignmentClass::Mixed);
        assert_eq!(preview.set.support_label, "mixed volume grids (sampled)");
        assert!(!preview.set.ingest_audit.support.ready_for_compare);
        assert_eq!(
            preview.set.ingest_audit.support.severity,
            StudioAuditSeverity::Error
        );
        assert_eq!(
            preview.contract.readiness,
            StudioImportReadiness::InspectOnly
        );
        let issue = support_issue(preview, "different grid");
        assert_eq!(issue.member_ids, vec![member.to_string()]);
        assert!(
            issue.message.contains("position or orientation"),
            "{}",
            issue.message
        );
        assert!(
            !issue.message.contains("voxel size differ"),
            "{}",
            issue.message
        );
    }

    /// Subject-native maps: one matrix and voxel size, each in its own place.
    /// Population refuses them, so the audit must not call them one grid.
    #[test]
    fn same_shape_at_a_shifted_origin_is_a_mixed_grid() {
        let preview = remote_preview_with_affine("1002/maps/se.nii.gz", |affine| {
            affine[(0, 3)] += 4.0;
        });
        assert_mixed_by_placement(&preview, "1002");
    }

    #[test]
    fn same_shape_in_a_rotated_or_flipped_orientation_is_a_mixed_grid() {
        // Left-right flip of the first axis.
        let flipped = remote_preview_with_affine("1001/maps/tstat.nii.gz", |affine| {
            affine[(0, 0)] = -affine[(0, 0)];
        });
        assert_mixed_by_placement(&flipped, "1001");
        // First two axes exchanged (a 90° in-plane rotation up to sign).
        let rotated = remote_preview_with_affine("1002/maps/beta.nii.gz", |affine| {
            affine.swap_columns(0, 1);
        });
        assert_mixed_by_placement(&rotated, "1002");
    }

    /// The audit's tolerance is Population's: `nifti_loader::affines_match`.
    #[test]
    fn affines_within_the_grid_tolerance_are_one_grid_and_just_outside_are_not() {
        let inside = remote_preview_with_affine("1002/maps/se.nii.gz", |affine| {
            affine[(1, 3)] += 0.9e-5;
            affine[(2, 0)] -= 0.9e-5;
        });
        assert_eq!(inside.set.alignment_class, StudioAlignmentClass::SameGrid);
        assert!(inside.set.ingest_audit.support.ready_for_compare);
        assert_eq!(
            inside.contract.readiness,
            StudioImportReadiness::CompareReady
        );

        let outside = remote_preview_with_affine("1002/maps/se.nii.gz", |affine| {
            affine[(2, 0)] += 1.2e-5;
        });
        assert_mixed_by_placement(&outside, "1002");
    }

    /// The origin has its own tolerance (`GRID_ORIGIN_TOLERANCE_MM`): one f32
    /// step at an MNI origin exceeds 1e-5 and is still the same grid.
    #[test]
    fn origins_within_a_micrometre_are_one_grid_and_just_outside_are_not() {
        // The control: one file at -132 among files at 0 is a real mismatch.
        let control = remote_preview_with_affine("1002/maps/se.nii.gz", |affine| {
            affine[(1, 3)] = -132.0;
        });
        assert_mixed_by_placement(&control, "1002");

        let root = "/remote-cache/live-mount";
        let preview_with_origins = |origin: f32, other: f32| {
            let mut inventory = audited_remote_inventory(root);
            let headers = &mut inventory.header_audit.as_mut().unwrap().headers;
            for (path, header) in headers.iter_mut() {
                let header = header.as_mut().expect("audited header");
                header.affine[(1, 3)] = if path.ends_with("1002/maps/se.nii.gz") {
                    other
                } else {
                    origin
                };
            }
            remote_audit_preview(root, inventory)
        };
        let step = f32::from_bits((-132.0f32).to_bits() + 1);
        assert!((step - -132.0f32).abs() > 1e-5);
        let same = preview_with_origins(-132.0, step);
        assert_eq!(same.set.alignment_class, StudioAlignmentClass::SameGrid);
        assert!(same.set.ingest_audit.support.ready_for_compare);

        let apart = preview_with_origins(-132.0, -132.0 + 1.2e-3);
        assert_mixed_by_placement(&apart, "1002");
    }

    /// Shape and placement mismatches are reported separately, each naming
    /// its own members.
    #[test]
    fn shape_and_placement_mismatches_are_reported_apart() {
        let root = "/remote-cache/live-mount";
        let mut inventory = audited_remote_inventory(root);
        let mut shifted = streamed_header([2, 3, 4]);
        shifted.affine[(2, 3)] = -30.0;
        let headers = &mut inventory.header_audit.as_mut().unwrap().headers;
        // The reference is the first bound file, which belongs to 1001.
        headers.insert(format!("{root}/1002/maps/se.nii.gz"), Ok(shifted));
        headers.insert(
            format!("{root}/1002/maps/beta.nii.gz"),
            Ok(streamed_header([2, 3, 5])),
        );
        let preview = remote_audit_preview(root, inventory);

        assert_eq!(preview.set.alignment_class, StudioAlignmentClass::Mixed);
        let shape = support_issue(&preview, "dimensions or voxel size differ");
        assert_eq!(shape.member_ids, vec!["1002".to_string()]);
        let placement = support_issue(&preview, "position or orientation");
        assert_eq!(placement.member_ids, vec!["1002".to_string()]);
        assert_ne!(shape.message, placement.message);
    }

    fn local_origin_discovery(label: &str, origins: [f32; 2]) -> (PathBuf, StudioImportCandidate) {
        let root = make_temp_dir(label);
        for (subject, origin) in ["1001", "1002"].iter().zip(origins) {
            let maps = root.join(subject).join("maps");
            fs::create_dir_all(&maps).expect("create maps dir");
            for role in ["beta", "tstat", "se", "pvalue"] {
                save_test_nifti_at_origin(
                    &maps.join(format!("{role}.nii.gz")),
                    &[1.0; 24],
                    [2, 3, 4],
                    origin,
                );
            }
        }
        let preview =
            preview_import_candidates(remote_discovery_request(&root.to_string_lossy(), true))
                .remove(0);
        (root, preview)
    }

    /// The local audit reads the same affine from files on disk.
    #[test]
    fn local_folder_with_a_shifted_member_is_a_mixed_grid() {
        let (root, shifted) = local_origin_discovery("local-shifted-origin", [0.0, 6.0]);
        assert_mixed_by_placement(&shifted, "1002");
        fs::remove_dir_all(root).expect("cleanup temp dir");

        let (root, aligned) = local_origin_discovery("local-shared-origin", [6.0, 6.0]);
        assert_eq!(aligned.set.alignment_class, StudioAlignmentClass::SameGrid);
        assert!(aligned.set.ingest_audit.support.ready_for_compare);
        fs::remove_dir_all(root).expect("cleanup temp dir");
    }

    /// The local audit reads headers only, as the remote one does. A member
    /// whose image data is cut short therefore audits the same both ways: its
    /// header is intact, so the set is one grid and compare-ready, and the
    /// damage surfaces when that member is loaded.
    #[test]
    fn truncated_payload_audits_alike_locally_and_remotely() {
        let local_root = make_temp_dir("truncated-payload");
        let remote_root = "/remote-cache/live-mount";
        let mut headers = std::collections::HashMap::new();
        let mut files = Vec::new();
        for subject in ["1001", "1002"] {
            let maps = local_root.join(subject).join("maps");
            fs::create_dir_all(&maps).expect("create maps dir");
            for role in ["beta", "tstat", "se", "pvalue"] {
                let path = maps.join(format!("{role}.nii"));
                save_test_nifti(&path, &vec![1.0; 6000], [10, 20, 30]);
                if (subject, role) == ("1002", "se") {
                    let whole = fs::read(&path).expect("read fixture bytes");
                    assert_eq!(whole.len(), 352 + 4 * 6000);
                    fs::write(&path, &whole[..352 + 100]).expect("truncate payload");
                    assert!(nifti_loader::load_nifti_volume_auto(&path).is_err());
                }
                let bytes = fs::read(&path).expect("read fixture bytes");
                let file =
                    remote_inventory_file(remote_root, &format!("{subject}/maps/{role}.nii"));
                headers.insert(
                    file.source_path.clone(),
                    Ok(nifti_loader::header_summary_from_prefix(&bytes)
                        .expect("parse header prefix")
                        .expect("complete header")),
                );
                files.push(file);
            }
        }
        let local = preview_import_candidates(remote_discovery_request(
            &local_root.to_string_lossy(),
            true,
        ))
        .remove(0);
        let remote = preview_import_candidates_with_discovery_inventory(
            remote_discovery_request(remote_root, true),
            Some(DiscoveryInventory {
                root_exists: true,
                files,
                header_audit: Some(DiscoveryHeaderAudit {
                    headers,
                    ..DiscoveryHeaderAudit::default()
                }),
                ..DiscoveryInventory::default()
            }),
        )
        .remove(0);

        assert_eq!(local.set.alignment_class, StudioAlignmentClass::SameGrid);
        assert!(local.set.ingest_audit.support.ready_for_compare);
        assert_eq!(
            local.set.support_label,
            "10×20×30 voxels · 1.00×1.00×1.00 mm (sampled)"
        );
        assert_eq!(remote.set.support_label, local.set.support_label);
        assert_eq!(remote.set.alignment_class, local.set.alignment_class);
        assert_eq!(
            remote.set.ingest_audit.support.ready_for_compare,
            local.set.ingest_audit.support.ready_for_compare
        );
        assert_eq!(remote.contract.readiness, local.contract.readiness);
        fs::remove_dir_all(local_root).expect("cleanup temp dir");
    }

    #[test]
    fn remote_inventory_with_an_unreadable_header_is_not_ready() {
        let root = "/remote-cache/live-mount";
        let mut inventory = audited_remote_inventory(root);
        let unreadable = format!("{root}/1001/maps/pvalue.nii.gz");
        inventory.header_audit.as_mut().unwrap().headers.insert(
            unreadable.clone(),
            Err(format!("{unreadable}: File has no complete NIfTI header")),
        );
        let preview = remote_audit_preview(root, inventory);

        assert!(!preview.set.ingest_audit.support.ready_for_compare);
        // The headers that were read agree: the set is unchecked, not mixed.
        assert_eq!(preview.set.alignment_class, StudioAlignmentClass::Unknown);
        assert_eq!(preview.set.support_label, "header audit incomplete");
        assert_eq!(
            preview.set.ingest_audit.support.severity,
            StudioAuditSeverity::Error
        );
        assert_ne!(
            preview.contract.readiness,
            StudioImportReadiness::CompareReady
        );
        let issue = support_issue(&preview, "could not be read");
        assert_eq!(issue.member_ids, vec!["1001".to_string()]);
        assert!(issue.message.contains(&unreadable));
        assert!(issue.message.starts_with("1 matched image header(s)"));
    }

    /// A real mismatch among the headers that were read stays mixed, whatever
    /// else could not be read.
    #[test]
    fn remote_inventory_with_an_unreadable_header_and_a_differing_grid_is_mixed() {
        let root = "/remote-cache/live-mount";
        let mut inventory = audited_remote_inventory(root);
        let headers = &mut inventory.header_audit.as_mut().unwrap().headers;
        headers.insert(
            format!("{root}/1001/maps/pvalue.nii.gz"),
            Err("no complete NIfTI header".to_string()),
        );
        headers.insert(
            format!("{root}/1002/maps/se.nii.gz"),
            Ok(streamed_header([2, 3, 5])),
        );
        let preview = remote_audit_preview(root, inventory);

        assert_eq!(preview.set.alignment_class, StudioAlignmentClass::Mixed);
        assert_eq!(
            preview.set.ingest_audit.support.severity,
            StudioAuditSeverity::Error
        );
        support_issue(&preview, "could not be read");
        support_issue(&preview, "different grid");
    }

    /// No header could be read at all: nothing is known about the grids.
    #[test]
    fn remote_inventory_with_no_readable_header_is_unchecked_not_mixed() {
        let root = "/remote-cache/live-mount";
        let mut inventory = audited_remote_inventory(root);
        let headers = &mut inventory.header_audit.as_mut().unwrap().headers;
        let count = headers.len();
        for header in headers.values_mut() {
            *header = Err("connection reset".to_string());
        }
        let preview = remote_audit_preview(root, inventory);

        assert_eq!(preview.set.alignment_class, StudioAlignmentClass::Unknown);
        assert_eq!(
            preview.set.support_label,
            "sample headers could not be read"
        );
        assert!(!preview.set.ingest_audit.support.ready_for_compare);
        let issue = support_issue(&preview, "could not be read");
        assert!(
            issue
                .message
                .starts_with(&format!("{count} matched image header(s)")),
            "{}",
            issue.message
        );
    }

    #[test]
    fn remote_inventory_with_a_4d_member_is_not_ready() {
        let root = "/remote-cache/live-mount";
        let mut inventory = audited_remote_inventory(root);
        let mut series = streamed_header([2, 3, 4]);
        series.dim.push(10);
        series.pixdim.push(2.0);
        inventory
            .header_audit
            .as_mut()
            .unwrap()
            .headers
            .insert(format!("{root}/1002/maps/beta.nii.gz"), Ok(series));
        let preview = remote_audit_preview(root, inventory);

        assert!(!preview.set.ingest_audit.support.ready_for_compare);
        let issue = support_issue(&preview, "could not be read");
        // Named by the path under the chosen folder, not the cache location.
        assert!(
            issue
                .message
                .contains("first error: 1002/maps/beta.nii.gz is a 4D series"),
            "{}",
            issue.message
        );
        assert!(!issue.message.contains(root), "{}", issue.message);
        assert_eq!(issue.member_ids, vec!["1002".to_string()]);
    }

    #[test]
    fn remote_inventory_with_a_partial_header_audit_is_not_ready() {
        let root = "/remote-cache/live-mount";
        let mut inventory = audited_remote_inventory(root);
        let audit = inventory.header_audit.as_mut().unwrap();
        audit
            .headers
            .remove(&format!("{root}/1002/maps/tstat.nii.gz"));
        audit.headers.remove(&format!("{root}/1002/maps/se.nii.gz"));
        let preview = remote_audit_preview(root, inventory);

        // Every header that was read agrees, and that is still not enough.
        assert!(!preview.set.ingest_audit.support.ready_for_compare);
        assert_eq!(preview.set.alignment_class, StudioAlignmentClass::Unknown);
        assert_eq!(preview.set.support_label, "header audit incomplete");
        assert_eq!(
            preview.set.ingest_audit.support.severity,
            StudioAuditSeverity::Warning
        );
        assert_eq!(
            preview.contract.readiness,
            StudioImportReadiness::ReviewRequired
        );
        let issue = support_issue(&preview, "were not read");
        assert!(issue.message.starts_with("2 matched image header(s)"));
        assert_eq!(issue.member_ids, vec!["1002".to_string()]);
    }

    #[test]
    fn remote_inventory_whose_header_audit_failed_is_not_ready() {
        let root = "/remote-cache/live-mount";
        let mut inventory = audited_remote_inventory(root);
        inventory.header_audit.as_mut().unwrap().failure =
            Some("Remote mount changed while image headers were being read.".to_string());
        let preview = remote_audit_preview(root, inventory);

        // The per-file results came from a mount that is gone; none is trusted.
        assert!(!preview.set.ingest_audit.support.ready_for_compare);
        assert_eq!(preview.set.alignment_class, StudioAlignmentClass::Unknown);
        assert_eq!(preview.set.support_label, "header audit incomplete");
        support_issue(&preview, "Remote mount changed");
    }

    #[test]
    fn remote_inventory_truncation_blocks_readiness_despite_a_clean_header_audit() {
        let root = "/remote-cache/live-mount";
        let mut inventory = audited_remote_inventory(root);
        inventory.truncated = true;
        let preview = remote_audit_preview(root, inventory);
        assert_eq!(preview.set.alignment_class, StudioAlignmentClass::SameGrid);
        assert!(!preview.set.ingest_audit.support.ready_for_compare);
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
    fn generic_folder_review_preserves_images_and_opens_real_sources() {
        let root = make_temp_dir("generic-folder-review");
        for member in ["1001", "1002"] {
            for image in ["rsa-A.nii.gz", "rsa_A.nii.gz", "session-2/rsa-A.nii.gz"] {
                if member == "1002" && image == "rsa_A.nii.gz" {
                    continue;
                }
                let path = root.join(member).join(image);
                fs::create_dir_all(path.parent().unwrap()).unwrap();
                save_test_nifti(&path, &[1.0, 3.0], [2, 1, 1]);
            }
        }
        let ontology = preview_folder_ontology(StudioFolderOntologyPreviewRequest {
            root: root.to_string_lossy().into(),
            max_depth: Some(4),
            max_files: Some(50),
            include_patterns: vec![],
            exclude_patterns: vec![],
        });
        let proposal = &ontology.candidates[0];
        assert_eq!(proposal.id, "member-folders");
        assert!(proposal.required_roles.is_empty());
        assert_eq!(proposal.observed_roles.len(), 3);
        let mut request = remote_discovery_request(&root.to_string_lossy(), false);
        request.file_pattern = Some(proposal.file_pattern.clone());
        request.discovery_required_roles = Some(vec![]);
        request.discovery_role_patterns = Some(vec![]);
        let discovered = preview_import_candidates(request.clone()).remove(0);
        if let Ok(path) = std::env::var("BRAINFLOW_FOLDER_REVIEW_FIXTURE") {
            fs::write(
                path,
                serde_json::to_vec_pretty(&serde_json::json!({
                    "root": root.to_string_lossy(), "ontology": ontology, "candidate": discovered,
                }))
                .unwrap(),
            )
            .unwrap();
        }
        assert!(discovered.contract.can_import);
        assert!(!discovered.set.ingest_audit.support.ready_for_compare);
        assert_eq!(
            discovered.set.alignment_class,
            StudioAlignmentClass::Unknown
        );
        assert_eq!(discovered.set.member_ids, ["1001", "1002"]);
        assert!(discovered
            .features
            .iter()
            .all(|feature| feature.value_role.is_none()));
        let groups = &discovered.discovery.as_ref().unwrap().groups;
        assert_eq!(groups[0].bindings.len(), 3);
        assert_eq!(groups[1].bindings.len(), 2);
        assert!(groups.iter().all(|group| group.missing_roles.is_empty()));
        for group in groups {
            for binding in &group.bindings {
                assert_eq!(
                    binding.relative_path,
                    format!("{}/{}", group.member_id, binding.role)
                );
                assert!(Path::new(&binding.source_path).is_file());
                let (volume, _) =
                    nifti_loader::load_nifti_volume_auto(Path::new(&binding.source_path)).unwrap();
                let (values, _) = extract_volume_values(&volume).unwrap();
                assert_eq!(values, vec![1.0, 3.0]);
            }
        }
        // Only a complete local header check can grant comparison readiness.
        request.discovery_sample_headers = Some(true);
        assert!(
            preview_import_candidates(request)
                .remove(0)
                .set
                .ingest_audit
                .support
                .ready_for_compare
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn upstream_inventory_truncation_blocks_opening_even_below_match_limit() {
        let root = "/remote-origin/study";
        let mut inventory = complete_remote_inventory(root);
        inventory.truncated = true;
        let preview = preview_import_candidates_with_discovery_inventory(
            remote_discovery_request(root, false),
            Some(inventory.clone()),
        )
        .remove(0);
        assert!(preview.discovery.unwrap().truncated);
        assert!(!preview.contract.can_import);
        let summary = preview_folder_ontology_with_discovery_inventory(
            StudioFolderOntologyPreviewRequest {
                root: root.into(),
                max_depth: None,
                max_files: Some(500),
                include_patterns: vec![],
                exclude_patterns: vec![],
            },
            inventory,
        );
        assert!(summary.truncated);
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
        assert!((sd_values[0] - 2.0).abs() < 1.0e-5);
        assert!((sd_values[1] - 2.0).abs() < 1.0e-5);
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
    fn complete_table_metadata_is_independent_of_preview_limits() {
        let dir = make_temp_dir("full-metadata");
        let image = dir.join("map.nii.gz");
        save_test_nifti(&image, &[1., 2., 3., 4.], [2, 2, 1]);
        let rows: Vec<_> = (0..160)
            .map(|i| {
                vec![
                    format!("obs-{i}"),
                    image.to_string_lossy().into_owned(),
                    format!("person-{}", i / 2),
                    if i < 80 { "A".into() } else { "B".into() },
                    "faces".into(),
                    i.to_string(),
                    "kept beyond preview".into(),
                    "excluded".into(),
                ]
            })
            .collect();
        let request: StudioImportPreviewRequest = serde_json::from_value(serde_json::json!({
            "mode": "table", "tableHeaders": ["observation", "path", "participant", "site", "condition", "run", "late", "private"],
            "tableRows": rows, "tableFilePathColumn": "path", "tableSubjectIdColumn": "observation", "tableExcludedColumns": ["private"]
        })).unwrap();
        let candidates = preview_import_candidates(request.clone());
        let set = &candidates[0].set;
        assert_eq!(set.member_count, 160);
        assert_eq!(set.design_table_preview.as_ref().unwrap().rows.len(), 5);
        let last = set.member_summaries.last().unwrap();
        assert_eq!(last.id, "obs-159");
        let values = last.design_values.as_ref().unwrap();
        assert_eq!(values["participant"], "person-79");
        assert_eq!(values["site"], "B");
        assert_eq!(values["late"], "kept beyond preview");
        assert!(!values.contains_key("private"));
        assert!(!values.contains_key("path"));
        let serialized = serde_json::to_value(last).unwrap();
        let roundtrip: bridge_types::StudioMemberSummary =
            serde_json::from_value(serialized.clone()).unwrap();
        assert_eq!(roundtrip.design_values, last.design_values);
        let mut legacy = serialized;
        legacy.as_object_mut().unwrap().remove("designValues");
        let legacy: bridge_types::StudioMemberSummary = serde_json::from_value(legacy).unwrap();
        assert!(legacy.design_values.is_none());
        let mut ambiguous = request.clone();
        ambiguous.table_headers.as_mut().unwrap()[6] = "participant".into();
        assert!(!preview_import_candidates(ambiguous)[0].contract.can_import);
        let mut ragged = request;
        ragged.table_rows.as_mut().unwrap()[100].pop();
        assert!(!preview_import_candidates(ragged)[0].contract.can_import);
        fs::remove_dir_all(dir).unwrap();
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

    fn population_export_request(root: &Path, paths: &[&Path]) -> StudioCompareMaterializeRequest {
        StudioCompareMaterializeRequest {
            support_label: format!("population fixture {}", root.display()),
            compare_ready: true,
            force_rematerialize: false,
            active_member_id: Some("member-1".to_string()),
            active_member_source_path: Some(paths[0].to_string_lossy().into_owned()),
            cohort_member_source_paths: paths
                .iter()
                .map(|p| p.to_string_lossy().into_owned())
                .collect(),
            compare_cohort_id: Some("all".to_string()),
            compare_cohort_label: Some("All observations".to_string()),
            compare_cohort_member_count: Some(paths.len()),
            active_expression_label: Some("Descriptive standardization".to_string()),
            active_expression_recipe: Some("zscore(current, cohort:all)".to_string()),
            reducer_specs: Some(vec![StudioReducerSpec {
                id: "sample-sd".to_string(),
                label: "Observed sample SD".to_string(),
                kind: StudioReducerKind::Sd,
                role: "effect".to_string(),
                cohort_id: Some("all".to_string()),
                excluded_member_id: None,
            }]),
            active_member_role_bindings: None,
            cohort_member_role_bindings: None,
        }
    }

    #[test]
    fn population_exports_use_local_counts_and_invalidate_old_calculations() {
        let root = make_temp_dir("population-export");
        let a = root.join("a.nii.gz");
        let b = root.join("b.nii.gz");
        save_test_nifti(&a, &[0.0, f32::NAN, 4.0, f32::MAX, 0.0], [5, 1, 1]);
        save_test_nifti(&b, &[2.0, 6.0, f32::NAN, f32::MAX, 0.0], [5, 1, 1]);
        let request = population_export_request(&root, &[&a, &b]);
        let panes = materialize_compare_panes(request.clone());
        assert_eq!(
            pane_values(&panes, "cohort-mean"),
            vec![1.0, 6.0, 4.0, f32::MAX, 0.0]
        );
        let sd = pane_values(&panes, "sample-sd");
        assert!((sd[0] - 2.0f32.sqrt()).abs() < 1e-6);
        assert!(sd[1].is_nan() && sd[2].is_nan());
        assert_eq!(&sd[3..], &[0.0, 0.0]);
        let zscore = pane_values(&panes, "zscore");
        assert_eq!(zscore[0], -1.0);
        assert!(zscore[1..].iter().all(|value| value.is_nan()));

        let binding = panes
            .iter()
            .find(|pane| pane.id == "cohort-mean")
            .unwrap()
            .binding
            .as_ref()
            .unwrap();
        let manifest_path = binding.provenance_path.as_ref().unwrap();
        let mut manifest: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(manifest_path).unwrap()).unwrap();
        assert_eq!(manifest["version"], 2);
        assert_eq!(
            manifest["provenance"]["reductionSemantics"]["analysisUnit"],
            "input_observation"
        );
        // Simulate a cached result produced by the former global-denominator
        // implementation, keeping source stamps unchanged.
        manifest["version"] = serde_json::json!(1);
        fs::write(manifest_path, serde_json::to_string(&manifest).unwrap()).unwrap();
        save_test_nifti(
            Path::new(binding.source_path.as_ref().unwrap()),
            &[99.0; 5],
            [5, 1, 1],
        );
        let refreshed = materialize_compare_panes(request);
        assert_eq!(
            pane_values(&refreshed, "cohort-mean"),
            vec![1.0, 6.0, 4.0, f32::MAX, 0.0]
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn population_exports_reject_equal_dimensions_in_different_world_frames() {
        let root = make_temp_dir("population-affine");
        let a = root.join("a.nii.gz");
        let b = root.join("b.nii.gz");
        save_test_nifti(&a, &[1.0, 2.0], [2, 1, 1]);
        save_test_nifti_at_origin(&b, &[3.0, 4.0], [2, 1, 1], 1.0);
        let panes = materialize_compare_panes(population_export_request(&root, &[&a, &b]));
        for id in ["cohort-mean", "sample-sd"] {
            let pane = panes.iter().find(|pane| pane.id == id).unwrap();
            assert_ne!(pane.status, StudioComparePaneStatus::Live);
            assert!(
                pane.reason.contains("different world affines"),
                "{}",
                pane.reason
            );
        }
        fs::remove_dir_all(root).unwrap();
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
        assert!((sd_values[0] - 2.0).abs() < 1.0e-5);
        assert!((sd_values[1] - 2.0).abs() < 1.0e-5);
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
    fn manifest_metadata_retains_declared_columns_beyond_preview_and_rejects_bad_headers() {
        let dir = copy_neurotabs_fixture("faces-demo", "manifest-full-metadata");
        fs::create_dir_all(dir.join("maps")).unwrap();
        save_test_nifti(
            &dir.join("maps/group_stats.nii.gz"),
            &[1., 2., 3., 4.],
            [2, 2, 1],
        );
        let manifest_path = dir.join("nftab.yaml");
        let manifest = fs::read_to_string(&manifest_path).unwrap().replace(
            "\nfeatures:",
            "\n  age:\n    dtype: string\n  site:\n    dtype: string\n  z_late:\n    dtype: string\n\nfeatures:",
        );
        fs::write(&manifest_path, manifest).unwrap();
        let table_path = dir.join("observations.csv");
        let mut reader = csv::Reader::from_path(&table_path).unwrap();
        let mut headers = reader.headers().unwrap().clone();
        for name in ["age", "site", "z_late"] {
            headers.push_field(name);
        }
        let records: Vec<_> = reader.records().map(Result::unwrap).collect();
        drop(reader);
        let write_table = |headers: &csv::StringRecord| {
            let mut writer = csv::Writer::from_path(&table_path).unwrap();
            writer.write_record(headers).unwrap();
            for (index, record) in records.iter().enumerate() {
                let mut row = record.clone();
                for value in ["40", "B", &format!("late-{index}")] {
                    row.push_field(value);
                }
                writer.write_record(&row).unwrap();
            }
            writer.flush().unwrap();
        };
        write_table(&headers);
        let candidate = preview_manifest_candidate(&manifest_path);
        assert!(candidate.contract.can_import);
        assert_eq!(
            candidate
                .set
                .design_table_preview
                .as_ref()
                .unwrap()
                .columns
                .len(),
            4
        );
        assert_eq!(
            candidate
                .set
                .design_table_preview
                .as_ref()
                .unwrap()
                .rows
                .len(),
            6
        );
        let metadata = candidate.set.member_summaries[7]
            .design_values
            .as_ref()
            .unwrap();
        assert_eq!(metadata["z_late"], "late-7");
        assert_eq!(metadata.len(), 8);
        assert!(!metadata.contains_key("roi_1"));
        assert!(!metadata.contains_key("stat_sel"));
        let mut invalid: Vec<_> = headers.iter().map(str::to_owned).collect();
        *invalid.last_mut().unwrap() = "age".into();
        write_table(&csv::StringRecord::from(invalid.clone()));
        let blocked = preview_manifest_candidate(&manifest_path);
        assert!(!blocked.contract.can_import);
        assert_issue_contains(&blocked, "unique, nonempty column names");
        *invalid.last_mut().unwrap() = "undeclared".into();
        write_table(&csv::StringRecord::from(invalid));
        let blocked = preview_manifest_candidate(&manifest_path);
        assert!(!blocked.contract.can_import);
        assert_issue_contains(&blocked, "metadata column z_late is missing");
        fs::remove_dir_all(dir).unwrap();
    }

    fn save_test_nifti_4d(
        path: &Path,
        dims: [u16; 4],
        value: impl Fn(usize, usize, usize, usize) -> f32,
    ) {
        let header = NiftiHeader {
            dim: [4, dims[0], dims[1], dims[2], dims[3], 1, 1, 1],
            datatype: 16,
            bitpix: 32,
            sform_code: 1,
            srow_x: [1.0, 0.0, 0.0, 0.0],
            srow_y: [0.0, 1.0, 0.0, 0.0],
            srow_z: [0.0, 0.0, 1.0, 0.0],
            ..NiftiHeader::default()
        };
        let shape = dims.map(usize::from);
        let data = ndarray::Array4::from_shape_fn(
            (shape[0], shape[1], shape[2], shape[3]),
            |(i, j, k, t)| value(i, j, k, t),
        );
        WriterOptions::new(path)
            .reference_header(&header)
            .write_nifti(&data)
            .expect("write 4D test nifti");
    }

    /// A FIR-style package: two subjects x two conditions, each member one 4D
    /// image (2x2x2 voxels x `frames` lags). `axes` is the feature's logical
    /// axes and `shape` its declared shape.
    fn write_series_package(label: &str, axes: &str, shape: &str, frames: u16) -> PathBuf {
        let dir = make_temp_dir(label);
        fs::create_dir_all(dir.join("maps")).unwrap();
        let mut observations = String::from("row_id,subject,condition,fir_res\n");
        let mut resources = String::from("resource_id,backend,locator\n");
        for subject in ["s01", "s02"] {
            for condition in ["faces", "houses"] {
                let id = format!("{subject}_{condition}");
                observations.push_str(&format!("{id},{subject},{condition},{id}\n"));
                resources.push_str(&format!("{id},nifti,maps/{id}.nii.gz\n"));
                save_test_nifti_4d(
                    &dir.join(format!("maps/{id}.nii.gz")),
                    [2, 2, 2, frames],
                    |_, _, _, t| t as f32,
                );
            }
        }
        fs::write(dir.join("observations.csv"), observations).unwrap();
        fs::write(dir.join("resources.csv"), resources).unwrap();
        fs::write(
            dir.join("nftab.yaml"),
            format!(
                r#"spec_version: "0.1.0"
dataset_id: "fir-series"
storage_profile: "table-package"
observation_table: {{ path: "observations.csv", format: "csv" }}
row_id: "row_id"
observation_axes: ["subject", "condition"]
observation_columns:
  row_id:    {{ dtype: string, nullable: false, semantic_role: row_id }}
  subject:   {{ dtype: string, nullable: false, semantic_role: subject }}
  condition: {{ dtype: string, nullable: false, semantic_role: condition }}
  fir_res:   {{ dtype: string, nullable: true }}
features:
  fir:
    logical:
      kind: volume
      axes: {axes}
      dtype: float32
      support_ref: "grid"
      shape: {shape}
      axis_domains:
        lag: {{ unit: "TR", start: 0.0, step: 1.0 }}
    encodings:
      - type: ref
        binding: {{ resource_id: {{ column: "fir_res" }} }}
resources: {{ path: "resources.csv", format: "csv" }}
supports:
  grid:
    support_type: volume
    support_id: "grid-2"
    space: "MNI152NLin2009cAsym"
    grid_id: "grid-2"
"#
            ),
        )
        .unwrap();
        dir
    }

    #[test]
    fn four_d_members_with_a_declared_series_axis_are_compare_ready() {
        let dir = write_series_package(
            "fir4d-ready",
            r#"["x", "y", "z", "lag"]"#,
            "[2, 2, 2, 6]",
            6,
        );
        let candidate = preview_manifest_candidate(&dir.join("nftab.yaml"));
        assert_eq!(
            candidate.contract.readiness,
            StudioImportReadiness::CompareReady,
            "{:?}",
            issue_messages(&candidate)
        );
        assert!(issue_messages(&candidate).is_empty());
        assert_eq!(candidate.set.member_count, 4);
        let axes = candidate.set.series_axes.as_ref().expect("series axes");
        assert_eq!(axes.len(), 1);
        assert_eq!(
            (axes[0].start, axes[0].step, axes[0].count),
            (Some(0.0), Some(1.0), Some(6))
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn four_d_members_without_a_series_axis_or_with_a_wrong_count_need_review() {
        // No series axis: the 4th dimension is ambiguous.
        let plain = write_series_package("fir4d-plain", r#"["x", "y", "z"]"#, "[2, 2, 2]", 6);
        let candidate = preview_manifest_candidate(&plain.join("nftab.yaml"));
        assert_ne!(
            candidate.contract.readiness,
            StudioImportReadiness::CompareReady
        );
        assert_issue_contains(&candidate, "declare a lag or time axis");
        fs::remove_dir_all(plain).unwrap();
        // Declared 4 lags, files hold 6.
        let mismatch = write_series_package(
            "fir4d-count",
            r#"["x", "y", "z", "lag"]"#,
            "[2, 2, 2, 4]",
            6,
        );
        let candidate = preview_manifest_candidate(&mismatch.join("nftab.yaml"));
        assert_ne!(
            candidate.contract.readiness,
            StudioImportReadiness::CompareReady
        );
        assert_issue_contains(&candidate, "has 6 frames but the series axis declares 4");
        fs::remove_dir_all(mismatch).unwrap();
        // Single-frame members against a declared 6-lag axis are flagged too.
        let single = write_series_package(
            "fir4d-single",
            r#"["x", "y", "z", "lag"]"#,
            "[2, 2, 2, 6]",
            1,
        );
        let candidate = preview_manifest_candidate(&single.join("nftab.yaml"));
        assert_ne!(
            candidate.contract.readiness,
            StudioImportReadiness::CompareReady
        );
        assert_issue_contains(&candidate, "has 1 frames but the series axis declares 6");
        fs::remove_dir_all(single).unwrap();
    }

    /// Synthetic FIR packages (generated by
    /// .hillclimb/native-check/p4/gen/make_fixtures.py): fir3d stores one 3D
    /// map per subject x condition x lag (lag observation column), fir4d one
    /// 4D map per subject x condition (lag feature axis).
    #[test]
    fn fir_fixtures_are_compare_ready_with_lag_axes() {
        let fir3d = copy_neurotabs_fixture("fir3d", "fixture-fir3d");
        let candidate = preview_manifest_candidate(&fir3d.join("nftab.yaml"));
        assert_eq!(
            candidate.contract.readiness,
            StudioImportReadiness::CompareReady,
            "fir3d: {:?}",
            issue_messages(&candidate)
        );
        assert_eq!(candidate.set.member_count, 72);
        let axes = candidate
            .set
            .series_axes
            .as_ref()
            .expect("fir3d series axes");
        assert_eq!(axes.len(), 1);
        assert_eq!(axes[0].kind, bridge_types::SeriesAxisKind::Lag);
        assert_eq!(
            axes[0].source,
            bridge_types::SeriesAxisSource::ObservationColumn {
                column: "lag".into()
            }
        );
        assert_eq!(axes[0].unit.as_deref(), Some("TR"));
        fs::remove_dir_all(fir3d).unwrap();

        let fir4d = copy_neurotabs_fixture("fir4d", "fixture-fir4d");
        let candidate = preview_manifest_candidate(&fir4d.join("nftab.yaml"));
        assert_eq!(
            candidate.contract.readiness,
            StudioImportReadiness::CompareReady,
            "fir4d: {:?}",
            issue_messages(&candidate)
        );
        assert_eq!(candidate.set.member_count, 12);
        let axes = candidate
            .set
            .series_axes
            .as_ref()
            .expect("fir4d series axes");
        assert_eq!(axes.len(), 1);
        assert_eq!(
            (axes[0].start, axes[0].step, axes[0].count),
            (Some(0.0), Some(1.0), Some(6))
        );
        fs::remove_dir_all(fir4d).unwrap();
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
        assert_eq!(
            candidate
                .set
                .design_table_preview
                .as_ref()
                .unwrap()
                .rows
                .len(),
            6
        );
        let last_metadata = candidate
            .set
            .member_summaries
            .last()
            .unwrap()
            .design_values
            .as_ref()
            .unwrap();
        assert!(last_metadata.contains_key("subject"));
        assert!(!last_metadata.contains_key("roi_3")); // inline feature data is not metadata
        assert!(!last_metadata.contains_key("stat_res"));
        assert!(candidate.set.member_summaries.iter().all(|member| member
            .design_values
            .as_ref()
            .unwrap()
            .len()
            == 5));
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
