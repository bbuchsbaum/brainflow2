use super::discovery::{DiscoveryInventory, DiscoveryInventoryFile};
use bridge_types::{
    StudioDiscoveryDesignValue, StudioDiscoveryMemberGroup, StudioDiscoveryRoleBinding,
    StudioDiscoveryRolePattern, StudioFolderOntologyCandidate, StudioFolderOntologyFactor,
    StudioFolderOntologyPreviewRequest, StudioFolderOntologyRoleGuess, StudioFolderOntologySummary,
    StudioFolderOntologyWarning,
};
use regex::Regex;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

const DEFAULT_ONTOLOGY_MAX_FILES: usize = 500;
const EXTENSION_PATTERN: &str = r"\.(?:nii(?:\.gz)?|(?:surf|func)\.gii|gii)$";

#[derive(Clone, Debug)]
struct OntologyFile {
    source_path: String,
    relative_path: String,
    segments: Vec<String>,
    stem: String,
}

#[derive(Clone, Debug)]
struct OntologyFileSet {
    root_exists: bool,
    source_label: Option<String>,
    scanned_files: usize,
    files: Vec<OntologyFile>,
    truncated: bool,
    warnings: Vec<StudioFolderOntologyWarning>,
}

#[derive(Clone, Debug)]
struct OntologyMatch {
    source_path: String,
    relative_path: String,
    member_id: String,
    role: String,
    role_confidence: f32,
    design_values: Vec<StudioDiscoveryDesignValue>,
}

#[derive(Clone, Debug)]
struct MapsContext {
    subject: String,
    session: Option<String>,
    analysis: Option<String>,
}

pub fn preview_folder_ontology(
    request: StudioFolderOntologyPreviewRequest,
) -> StudioFolderOntologySummary {
    build_folder_ontology(request, None)
}

pub fn preview_folder_ontology_with_discovery_inventory(
    request: StudioFolderOntologyPreviewRequest,
    discovery_inventory: DiscoveryInventory,
) -> StudioFolderOntologySummary {
    build_folder_ontology(request, Some(discovery_inventory))
}

fn build_folder_ontology(
    request: StudioFolderOntologyPreviewRequest,
    discovery_inventory: Option<DiscoveryInventory>,
) -> StudioFolderOntologySummary {
    let file_set = collect_ontology_files(&request, discovery_inventory.as_ref());
    let mut warnings = file_set.warnings.clone();
    if !file_set.root_exists {
        warnings.push(StudioFolderOntologyWarning {
            code: "root_unavailable".to_string(),
            message: discovery_inventory
                .as_ref()
                .and_then(|inventory| inventory.root_issue.clone())
                .unwrap_or_else(|| "Folder ontology root does not exist.".to_string()),
            paths: vec![request.root.clone()],
        });
    }
    if file_set.files.is_empty() && file_set.root_exists {
        warnings.push(StudioFolderOntologyWarning {
            code: "no_neuroimaging_files".to_string(),
            message: "No NIfTI or GIfTI files were found under the selected root.".to_string(),
            paths: Vec::new(),
        });
    }

    let mut candidates = Vec::new();
    if let Some(candidate) = maps_basename_roles_candidate(&file_set.files, file_set.files.len()) {
        candidates.push(candidate);
    }
    if let Some(candidate) = maps_role_condition_candidate(&file_set.files, file_set.files.len()) {
        candidates.push(candidate);
    }
    if let Some(candidate) = bids_entity_candidate(&file_set.files, file_set.files.len()) {
        candidates.push(candidate);
    }
    if let Some(candidate) = flat_statmap_candidate(&file_set.files, file_set.files.len()) {
        candidates.push(candidate);
    }

    candidates.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(left.id.cmp(&right.id))
    });

    StudioFolderOntologySummary {
        root: request.root,
        root_exists: file_set.root_exists,
        source_label: file_set.source_label,
        scanned_files: file_set.scanned_files,
        neuroimaging_files: file_set.files.len(),
        truncated: file_set.truncated,
        candidates,
        warnings,
    }
}

fn collect_ontology_files(
    request: &StudioFolderOntologyPreviewRequest,
    discovery_inventory: Option<&DiscoveryInventory>,
) -> OntologyFileSet {
    let max_files = request
        .max_files
        .unwrap_or(DEFAULT_ONTOLOGY_MAX_FILES)
        .max(1);
    let (include_regexes, invalid_include_patterns) = compile_patterns(&request.include_patterns);
    let (exclude_regexes, invalid_exclude_patterns) = compile_patterns(&request.exclude_patterns);
    let mut warnings = invalid_pattern_warnings("include", invalid_include_patterns);
    warnings.extend(invalid_pattern_warnings(
        "exclude",
        invalid_exclude_patterns,
    ));

    if let Some(inventory) = discovery_inventory {
        return collect_inventory_files(
            inventory,
            request.max_depth,
            max_files,
            &include_regexes,
            &exclude_regexes,
            warnings,
        );
    }

    let root_path = Path::new(&request.root);
    let root_exists = root_path.exists();
    let mut scanned_files = 0usize;
    let mut files = Vec::new();
    let mut truncated = false;
    if root_exists {
        let mut walker = WalkDir::new(root_path);
        if let Some(depth) = request.max_depth {
            walker = walker.max_depth(depth.saturating_add(1));
        }
        for entry in walker.into_iter().filter_map(Result::ok) {
            if !entry.file_type().is_file() {
                continue;
            }
            scanned_files += 1;
            let path = entry.path();
            let relative_path = path
                .strip_prefix(root_path)
                .map(normalize_path)
                .unwrap_or_else(|_| normalize_path(path));
            let source_path = path.to_string_lossy().to_string();
            if should_skip_path(
                &relative_path,
                &source_path,
                &include_regexes,
                &exclude_regexes,
            ) {
                continue;
            }
            if !is_neuroimaging_value(&relative_path) {
                continue;
            }
            if files.len() >= max_files {
                truncated = true;
                continue;
            }
            files.push(ontology_file(source_path, relative_path));
        }
    }

    files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    OntologyFileSet {
        root_exists,
        source_label: None,
        scanned_files,
        files,
        truncated,
        warnings,
    }
}

fn collect_inventory_files(
    inventory: &DiscoveryInventory,
    max_depth: Option<usize>,
    max_files: usize,
    include_regexes: &[Regex],
    exclude_regexes: &[Regex],
    mut warnings: Vec<StudioFolderOntologyWarning>,
) -> OntologyFileSet {
    let mut files = Vec::new();
    let mut truncated = false;
    for file in &inventory.files {
        if !inventory_file_within_depth(file, max_depth) {
            continue;
        }
        if should_skip_path(
            &file.relative_path,
            &file.source_path,
            include_regexes,
            exclude_regexes,
        ) {
            continue;
        }
        if !is_neuroimaging_value(&file.relative_path) && !is_neuroimaging_value(&file.source_path)
        {
            continue;
        }
        if files.len() >= max_files {
            truncated = true;
            continue;
        }
        files.push(ontology_file(
            file.source_path.clone(),
            normalize_relative_string(&file.relative_path),
        ));
    }
    if let Some(root_issue) = &inventory.root_issue {
        warnings.push(StudioFolderOntologyWarning {
            code: "inventory_root_issue".to_string(),
            message: root_issue.clone(),
            paths: Vec::new(),
        });
    }
    files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    OntologyFileSet {
        root_exists: inventory.root_exists,
        source_label: inventory.source_label.clone(),
        scanned_files: inventory.files.len(),
        files,
        truncated,
        warnings,
    }
}

fn maps_basename_roles_candidate(
    files: &[OntologyFile],
    total_files: usize,
) -> Option<StudioFolderOntologyCandidate> {
    let mut matches = Vec::new();
    let mut saw_analysis = false;
    let mut saw_session = false;
    for file in files {
        let Some(context) = maps_context(file) else {
            continue;
        };
        saw_analysis |= context.analysis.is_some();
        saw_session |= context.session.is_some();
        let role = sanitize_role(&file.stem).unwrap_or_else(|| "statmap".to_string());
        let design_values = maps_design_values(&context, None);
        matches.push(OntologyMatch {
            source_path: file.source_path.clone(),
            relative_path: file.relative_path.clone(),
            member_id: member_id_from_design_values(&design_values),
            role,
            role_confidence: 0.86,
            design_values,
        });
    }
    if matches.is_empty() {
        return None;
    }
    Some(candidate_from_matches(CandidateSpec {
        id: "maps-basename-roles",
        label: "Subject maps with basename roles",
        strategy: "path_subject_maps_basename_role",
        description: "Treat each file basename under a subject maps folder as an image role.",
        file_pattern: maps_file_pattern(false, saw_analysis, saw_session),
        matches,
        total_files,
        reasons: vec![
            "Found image files beneath maps folders.".to_string(),
            "Used the nearest subject-like ancestor as the member factor.".to_string(),
            "Used each basename as a role binding.".to_string(),
        ],
        warnings: Vec::new(),
        score_adjustment: 0.0,
    }))
}

fn maps_role_condition_candidate(
    files: &[OntologyFile],
    total_files: usize,
) -> Option<StudioFolderOntologyCandidate> {
    let mut matches = Vec::new();
    let mut saw_modifier = false;
    let mut saw_analysis = false;
    let mut saw_session = false;
    let prefix_counts = basename_prefix_counts(files);
    for file in files {
        let Some(context) = maps_context(file) else {
            continue;
        };
        let parts = basename_parts(&file.stem);
        let Some(first) = parts.first() else {
            continue;
        };
        let first_role = sanitize_role(first).unwrap_or_else(|| "statmap".to_string());
        let has_modifier = parts.len() > 1;
        let prefix_is_role_like =
            is_role_like_token(first) || prefix_counts.get(first).copied().unwrap_or(0) > 1;
        if !has_modifier && !prefix_is_role_like {
            continue;
        }
        saw_modifier |= has_modifier;
        saw_analysis |= context.analysis.is_some();
        saw_session |= context.session.is_some();
        let condition = if has_modifier {
            Some(parts[1..].join("_"))
        } else {
            Some("overall".to_string())
        };
        let design_values = maps_design_values(&context, condition.as_deref());
        matches.push(OntologyMatch {
            source_path: file.source_path.clone(),
            relative_path: file.relative_path.clone(),
            member_id: member_id_from_design_values(&design_values),
            role: first_role,
            role_confidence: if has_modifier { 0.74 } else { 0.62 },
            design_values,
        });
    }
    if matches.is_empty() || !saw_modifier {
        return None;
    }
    Some(candidate_from_matches(CandidateSpec {
        id: "maps-role-condition",
        label: "Subject maps with filename condition factor",
        strategy: "path_subject_maps_role_condition",
        description:
            "Treat the first basename token as the role and remaining tokens as a condition factor.",
        file_pattern: maps_file_pattern(true, saw_analysis, saw_session),
        matches,
        total_files,
        reasons: vec![
            "Found underscore-delimited filename modifiers under maps folders.".to_string(),
            "Preserved those modifiers as a design factor instead of folding them into role names."
                .to_string(),
            "Included condition in member keys to avoid duplicate role bindings.".to_string(),
        ],
        warnings: vec![StudioFolderOntologyWarning {
            code: "ambiguous_basename_modifier".to_string(),
            message: "Filename modifiers may be conditions or distinct roles; confirm this mapping before export."
                .to_string(),
            paths: files
                .iter()
                .filter(|file| basename_parts(&file.stem).len() > 1)
                .take(8)
                .map(|file| file.relative_path.clone())
                .collect(),
        }],
        score_adjustment: 0.03,
    }))
}

fn bids_entity_candidate(
    files: &[OntologyFile],
    total_files: usize,
) -> Option<StudioFolderOntologyCandidate> {
    let mut matches = Vec::new();
    for file in files {
        let Some(entities) = bids_entities(file) else {
            continue;
        };
        let subject = entities
            .get("subject")
            .or_else(|| entities.get("sub"))
            .cloned()?;
        let role = bids_role(&entities, &file.stem);
        let mut design_values = Vec::new();
        push_design_value(&mut design_values, "subject", &subject);
        for key in ["session", "task", "run", "space", "desc", "hemi"] {
            if let Some(value) = entities.get(key) {
                push_design_value(&mut design_values, key, value);
            }
        }
        matches.push(OntologyMatch {
            source_path: file.source_path.clone(),
            relative_path: file.relative_path.clone(),
            member_id: member_id_from_design_values(&design_values),
            role,
            role_confidence: 0.78,
            design_values,
        });
    }
    if matches.is_empty() {
        return None;
    }
    Some(candidate_from_matches(CandidateSpec {
        id: "bids-entities",
        label: "BIDS-like filename entities",
        strategy: "bids_like_entities",
        description: "Use BIDS-style entities from paths and filenames as factors.",
        file_pattern: format!(r".*{}", EXTENSION_PATTERN),
        matches,
        total_files,
        reasons: vec![
            "Found BIDS-like key-value entities such as sub-, ses-, task-, or desc-.".to_string(),
            "Used entity values as design factors.".to_string(),
        ],
        warnings: Vec::new(),
        score_adjustment: -0.02,
    }))
}

fn flat_statmap_candidate(
    files: &[OntologyFile],
    total_files: usize,
) -> Option<StudioFolderOntologyCandidate> {
    if files.is_empty() {
        return None;
    }
    let matches = files
        .iter()
        .map(|file| {
            let member_id = sanitize_identifier(&file.stem);
            OntologyMatch {
                source_path: file.source_path.clone(),
                relative_path: file.relative_path.clone(),
                member_id: member_id.clone(),
                role: "statmap".to_string(),
                role_confidence: 0.5,
                design_values: vec![StudioDiscoveryDesignValue {
                    column: "subject".to_string(),
                    value: member_id,
                }],
            }
        })
        .collect::<Vec<_>>();
    Some(candidate_from_matches(CandidateSpec {
        id: "flat-statmaps",
        label: "Flat one-image-per-member collection",
        strategy: "flat_statmap_fallback",
        description: "Treat each image file as a separate member with a generic statmap role.",
        file_pattern: format!(r".*{}", EXTENSION_PATTERN),
        matches,
        total_files,
        reasons: vec![
            "Fallback candidate for image folders without a recognizable hierarchy.".to_string(),
            "Each file becomes its own member.".to_string(),
        ],
        warnings: vec![StudioFolderOntologyWarning {
            code: "fallback_schema".to_string(),
            message:
                "No richer hierarchy is required for this candidate; review member names carefully."
                    .to_string(),
            paths: Vec::new(),
        }],
        score_adjustment: -0.2,
    }))
}

struct CandidateSpec {
    id: &'static str,
    label: &'static str,
    strategy: &'static str,
    description: &'static str,
    file_pattern: String,
    matches: Vec<OntologyMatch>,
    total_files: usize,
    reasons: Vec<String>,
    warnings: Vec<StudioFolderOntologyWarning>,
    score_adjustment: f32,
}

fn candidate_from_matches(spec: CandidateSpec) -> StudioFolderOntologyCandidate {
    let observed_roles = observed_roles(&spec.matches);
    let required_roles = if observed_roles.len() > 1 {
        observed_roles.clone()
    } else {
        Vec::new()
    };
    let groups = group_ontology_matches(spec.matches, &required_roles);
    let duplicate_keys = groups
        .iter()
        .map(|group| group.duplicate_roles.len())
        .sum::<usize>();
    let missing_role_bindings = groups
        .iter()
        .map(|group| group.missing_roles.len())
        .sum::<usize>();
    let clean_group_count = groups
        .iter()
        .filter(|group| group.duplicate_roles.is_empty() && group.missing_roles.is_empty())
        .count();
    let matched_files = groups
        .iter()
        .map(|group| group.bindings.len())
        .sum::<usize>();
    let coverage = ratio(matched_files, spec.total_files);
    let completeness = ratio(clean_group_count, groups.len());
    let factors = factors_from_groups(&groups);
    let roles = role_guesses_from_groups(&groups);
    let design_columns = design_columns_from_groups(&groups);
    let mut warnings = spec.warnings;
    if duplicate_keys > 0 {
        warnings.push(StudioFolderOntologyWarning {
            code: "duplicate_role_bindings".to_string(),
            message: format!(
                "{} duplicate role binding(s) would need review before compare/export.",
                duplicate_keys
            ),
            paths: Vec::new(),
        });
    }
    if missing_role_bindings > 0 {
        warnings.push(StudioFolderOntologyWarning {
            code: "missing_role_bindings".to_string(),
            message: format!(
                "{} required role binding(s) are missing across inferred members.",
                missing_role_bindings
            ),
            paths: Vec::new(),
        });
    }

    let role_signal = (observed_roles.len().min(4) as f32) / 4.0;
    let factor_signal = (factors
        .iter()
        .filter(|factor| factor.name != "subject")
        .count()
        .min(4) as f32)
        / 4.0;
    let score = (0.48 * coverage)
        + (0.34 * completeness)
        + (0.1 * role_signal)
        + (0.08 * factor_signal)
        + spec.score_adjustment
        - (duplicate_keys as f32 * 0.03)
        - (missing_role_bindings as f32 * 0.02);

    StudioFolderOntologyCandidate {
        id: spec.id.to_string(),
        label: spec.label.to_string(),
        description: spec.description.to_string(),
        strategy: spec.strategy.to_string(),
        score: score.clamp(0.0, 1.0),
        coverage,
        completeness,
        matched_files,
        unmatched_files: spec.total_files.saturating_sub(matched_files),
        duplicate_keys,
        missing_role_bindings,
        file_pattern: spec.file_pattern,
        design_columns,
        observed_roles: observed_roles.clone(),
        required_roles,
        role_patterns: role_patterns_for_roles(&observed_roles),
        factors,
        roles,
        groups,
        reasons: spec.reasons,
        warnings,
    }
}

fn group_ontology_matches(
    matches: Vec<OntologyMatch>,
    required_roles: &[String],
) -> Vec<StudioDiscoveryMemberGroup> {
    let mut by_member: BTreeMap<String, Vec<OntologyMatch>> = BTreeMap::new();
    for file_match in matches {
        by_member
            .entry(file_match.member_id.clone())
            .or_default()
            .push(file_match);
    }
    by_member
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
            let mut seen_design = HashSet::new();
            for file_match in &file_matches {
                for value in &file_match.design_values {
                    if seen_design.insert(value.column.clone()) {
                        design_values.push(value.clone());
                    }
                }
            }
            let confidence = file_matches
                .iter()
                .map(|file_match| file_match.role_confidence)
                .sum::<f32>()
                / file_matches.len().max(1) as f32;
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
        .collect()
}

fn maps_context(file: &OntologyFile) -> Option<MapsContext> {
    let maps_index = file
        .segments
        .iter()
        .position(|segment| segment.eq_ignore_ascii_case("maps"))?;
    let subject_index = file
        .segments
        .iter()
        .take(maps_index)
        .enumerate()
        .rev()
        .find_map(|(index, segment)| {
            if is_subjectish_segment(segment) {
                Some(index)
            } else {
                None
            }
        })?;
    let subject = file.segments[subject_index].clone();
    let session = file.segments[subject_index + 1..maps_index]
        .iter()
        .find(|segment| segment.to_lowercase().starts_with("ses-"))
        .cloned();
    let analysis = if subject_index > 0 {
        Some(file.segments[subject_index - 1].clone())
    } else {
        None
    };
    Some(MapsContext {
        subject,
        session,
        analysis,
    })
}

fn maps_design_values(
    context: &MapsContext,
    condition: Option<&str>,
) -> Vec<StudioDiscoveryDesignValue> {
    let mut values = Vec::new();
    push_design_value(&mut values, "subject", &context.subject);
    if let Some(session) = &context.session {
        push_design_value(&mut values, "session", session);
    }
    if let Some(condition) = condition {
        push_design_value(&mut values, "condition", condition);
    }
    if let Some(analysis) = &context.analysis {
        push_design_value(&mut values, "analysis", analysis);
    }
    values
}

fn bids_entities(file: &OntologyFile) -> Option<BTreeMap<String, String>> {
    let mut entities = BTreeMap::new();
    for segment in &file.segments {
        collect_bids_token(segment, &mut entities);
    }
    for token in file.stem.split('_') {
        collect_bids_token(token, &mut entities);
    }
    if entities.contains_key("subject") || entities.contains_key("sub") {
        Some(entities)
    } else {
        None
    }
}

fn collect_bids_token(token: &str, entities: &mut BTreeMap<String, String>) {
    let Some((key, value)) = token.split_once('-') else {
        return;
    };
    let normalized_key = match key {
        "sub" => "subject",
        "ses" => "session",
        "task" => "task",
        "run" => "run",
        "space" => "space",
        "desc" => "desc",
        "hemi" => "hemi",
        "stat" => "stat",
        _ => return,
    };
    if !value.is_empty() {
        entities.insert(normalized_key.to_string(), value.to_string());
    }
}

fn bids_role(entities: &BTreeMap<String, String>, stem: &str) -> String {
    if let Some(stat) = entities.get("stat") {
        return match stat.as_str() {
            "t" | "tstat" => "tstat".to_string(),
            "z" | "zstat" => "zstat".to_string(),
            "p" | "pvalue" | "pval" => "pvalue".to_string(),
            other => sanitize_role(other).unwrap_or_else(|| "statmap".to_string()),
        };
    }
    if let Some(desc) = entities.get("desc") {
        if is_role_like_token(desc) {
            return sanitize_role(desc).unwrap_or_else(|| "statmap".to_string());
        }
    }
    basename_parts(stem)
        .into_iter()
        .rev()
        .find(|part| is_role_like_token(part))
        .and_then(|part| sanitize_role(&part))
        .unwrap_or_else(|| "statmap".to_string())
}

fn maps_file_pattern(with_condition: bool, with_analysis: bool, with_session: bool) -> String {
    let analysis = if with_analysis {
        r"(?:(?P<analysis>[^/]+)/)?"
    } else {
        ""
    };
    let session = if with_session {
        r"(?:/(?P<session>ses-[^/]+))?"
    } else {
        ""
    };
    let role = if with_condition {
        r"(?P<role>[A-Za-z0-9]+)(?:_(?P<condition>[^/]+))?"
    } else {
        r"(?P<role>[^/]+)"
    };
    format!(
        r"{}(?P<subject>[^/]+){}/maps/{}{}",
        analysis, session, role, EXTENSION_PATTERN
    )
}

fn role_patterns_for_roles(roles: &[String]) -> Vec<StudioDiscoveryRolePattern> {
    roles
        .iter()
        .map(|role| StudioDiscoveryRolePattern {
            role: role.clone(),
            patterns: vec![format!(r"(^|[_\-\./]){}([_\-\./]|$)", regex::escape(role))],
        })
        .collect()
}

fn factors_from_groups(groups: &[StudioDiscoveryMemberGroup]) -> Vec<StudioFolderOntologyFactor> {
    let mut values_by_column: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for group in groups {
        for value in &group.design_values {
            values_by_column
                .entry(value.column.clone())
                .or_default()
                .insert(value.value.clone());
        }
    }
    values_by_column
        .into_iter()
        .map(|(name, values)| StudioFolderOntologyFactor {
            source: factor_source(&name).to_string(),
            confidence: factor_confidence(&name),
            name,
            values: values.into_iter().collect(),
        })
        .collect()
}

fn role_guesses_from_groups(
    groups: &[StudioDiscoveryMemberGroup],
) -> Vec<StudioFolderOntologyRoleGuess> {
    let mut examples_by_role: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut confidence_by_role: HashMap<String, Vec<f32>> = HashMap::new();
    for group in groups {
        for binding in &group.bindings {
            let examples = examples_by_role.entry(binding.role.clone()).or_default();
            if examples.len() < 5 {
                examples.push(binding.relative_path.clone());
            }
            confidence_by_role
                .entry(binding.role.clone())
                .or_default()
                .push(binding.confidence);
        }
    }
    examples_by_role
        .into_iter()
        .map(|(role, examples)| {
            let confidence_values = confidence_by_role.remove(&role).unwrap_or_default();
            let confidence = confidence_values.iter().sum::<f32>() / confidence_values.len() as f32;
            StudioFolderOntologyRoleGuess {
                role,
                source: "filename".to_string(),
                examples,
                confidence,
            }
        })
        .collect()
}

fn design_columns_from_groups(groups: &[StudioDiscoveryMemberGroup]) -> Vec<String> {
    let columns = groups
        .iter()
        .flat_map(|group| group.design_values.iter().map(|value| value.column.clone()))
        .collect::<HashSet<_>>();
    let mut ordered = Vec::new();
    for preferred in ["subject", "session", "condition", "analysis", "task", "run"] {
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

fn observed_roles(matches: &[OntologyMatch]) -> Vec<String> {
    let mut roles = matches
        .iter()
        .map(|file_match| file_match.role.clone())
        .collect::<Vec<_>>();
    roles.sort();
    roles.dedup();
    roles
}

fn factor_source(name: &str) -> &'static str {
    match name {
        "subject" | "session" => "path_entity",
        "condition" => "filename_modifier",
        "analysis" => "ancestor_folder",
        "task" | "run" | "space" | "desc" | "hemi" => "bids_entity",
        _ => "inferred",
    }
}

fn factor_confidence(name: &str) -> f32 {
    match name {
        "subject" => 0.95,
        "session" => 0.9,
        "analysis" => 0.78,
        "condition" => 0.7,
        "task" | "run" | "space" | "desc" | "hemi" => 0.82,
        _ => 0.6,
    }
}

fn member_id_from_design_values(values: &[StudioDiscoveryDesignValue]) -> String {
    let mut parts = Vec::new();
    for preferred in ["subject", "session", "condition", "analysis", "task", "run"] {
        if let Some(value) = values.iter().find(|value| value.column == preferred) {
            parts.push(sanitize_identifier(&value.value));
        }
    }
    if parts.is_empty() {
        "member".to_string()
    } else {
        parts.join("_")
    }
}

fn push_design_value(values: &mut Vec<StudioDiscoveryDesignValue>, column: &str, value: &str) {
    if value.trim().is_empty() || values.iter().any(|existing| existing.column == column) {
        return;
    }
    values.push(StudioDiscoveryDesignValue {
        column: column.to_string(),
        value: value.trim().to_string(),
    });
}

fn basename_prefix_counts(files: &[OntologyFile]) -> HashMap<String, usize> {
    let mut counts = HashMap::new();
    for file in files {
        if let Some(first) = basename_parts(&file.stem).first() {
            *counts.entry(first.clone()).or_insert(0usize) += 1;
        }
    }
    counts
}

fn basename_parts(stem: &str) -> Vec<String> {
    stem.split('_')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn is_role_like_token(token: &str) -> bool {
    matches!(
        sanitize_role(token).as_deref(),
        Some(
            "auc"
                | "beta"
                | "cope"
                | "coef"
                | "contrast"
                | "effect"
                | "mask"
                | "p"
                | "pval"
                | "pvalue"
                | "prob"
                | "probmap"
                | "se"
                | "stat"
                | "statmap"
                | "t"
                | "tmap"
                | "tstat"
                | "z"
                | "zmap"
                | "zstat"
        )
    )
}

fn is_subjectish_segment(segment: &str) -> bool {
    let lower = segment.to_lowercase();
    lower.starts_with("sub-")
        || (lower.starts_with("sub") && lower[3..].chars().all(|char| char.is_ascii_digit()))
        || (lower.len() >= 2 && lower.len() <= 8 && lower.chars().all(|char| char.is_ascii_digit()))
}

fn ontology_file(source_path: String, relative_path: String) -> OntologyFile {
    let normalized = normalize_relative_string(&relative_path);
    let segments = normalized
        .split('/')
        .filter(|segment| !segment.is_empty())
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    let stem = strip_neuroimaging_extension(
        Path::new(&normalized)
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or(&normalized),
    );
    OntologyFile {
        source_path,
        relative_path: normalized,
        segments,
        stem,
    }
}

fn strip_neuroimaging_extension(file_name: &str) -> String {
    let lower = file_name.to_lowercase();
    for extension in [".nii.gz", ".surf.gii", ".func.gii", ".nii", ".gii"] {
        if lower.ends_with(extension) {
            let keep = file_name.len() - extension.len();
            return file_name[..keep].to_string();
        }
    }
    file_name.to_string()
}

fn compile_patterns(patterns: &[String]) -> (Vec<Regex>, Vec<String>) {
    let mut regexes = Vec::new();
    let mut invalid = Vec::new();
    for pattern in patterns {
        match Regex::new(pattern) {
            Ok(regex) => regexes.push(regex),
            Err(_) => invalid.push(pattern.clone()),
        }
    }
    (regexes, invalid)
}

fn invalid_pattern_warnings(kind: &str, patterns: Vec<String>) -> Vec<StudioFolderOntologyWarning> {
    patterns
        .into_iter()
        .map(|pattern| StudioFolderOntologyWarning {
            code: format!("invalid_{}_pattern", kind),
            message: format!("Invalid {} regex pattern: {}", kind, pattern),
            paths: Vec::new(),
        })
        .collect()
}

fn should_skip_path(
    relative_path: &str,
    source_path: &str,
    include_regexes: &[Regex],
    exclude_regexes: &[Regex],
) -> bool {
    if exclude_regexes
        .iter()
        .any(|regex| regex.is_match(relative_path) || regex.is_match(source_path))
    {
        return true;
    }
    !include_regexes.is_empty()
        && !include_regexes
            .iter()
            .any(|regex| regex.is_match(relative_path) || regex.is_match(source_path))
}

fn inventory_file_within_depth(file: &DiscoveryInventoryFile, max_depth: Option<usize>) -> bool {
    let Some(max_depth) = max_depth else {
        return true;
    };
    normalize_relative_string(&file.relative_path)
        .split('/')
        .filter(|segment| !segment.is_empty())
        .count()
        <= max_depth
}

fn normalize_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn normalize_relative_string(path: &str) -> String {
    let normalized = PathBuf::from(path);
    normalize_path(&normalized)
}

fn is_neuroimaging_value(value: &str) -> bool {
    let value = value.to_lowercase();
    value.ends_with(".nii")
        || value.ends_with(".nii.gz")
        || value.ends_with(".gii")
        || value.ends_with(".surf.gii")
        || value.ends_with(".func.gii")
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

fn sanitize_identifier(value: &str) -> String {
    let sanitized = value
        .trim()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '.') {
                character
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .to_string();
    if sanitized.is_empty() {
        "value".to_string()
    } else {
        sanitized
    }
}

fn ratio(numerator: usize, denominator: usize) -> f32 {
    if denominator == 0 {
        0.0
    } else {
        numerator as f32 / denominator as f32
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn make_temp_dir(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("field-table-ontology-{}-{}", label, unique));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    fn touch(path: &Path) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create parent");
        }
        fs::write(path, []).expect("write placeholder image");
    }

    fn inventory_file(root: &str, relative_path: &str) -> DiscoveryInventoryFile {
        DiscoveryInventoryFile {
            source_path: format!("{}/{}", root.trim_end_matches('/'), relative_path),
            relative_path: relative_path.to_string(),
        }
    }

    fn candidate<'a>(
        summary: &'a StudioFolderOntologySummary,
        id: &str,
    ) -> &'a StudioFolderOntologyCandidate {
        summary
            .candidates
            .iter()
            .find(|candidate| candidate.id == id)
            .expect("candidate")
    }

    #[test]
    fn infers_subject_maps_basename_roles_from_local_folder() {
        let root = make_temp_dir("maps-roles");
        for subject in ["sub-01", "sub-02"] {
            for role in ["auc", "tstat"] {
                touch(
                    &root
                        .join(subject)
                        .join("maps")
                        .join(format!("{}.nii.gz", role)),
                );
            }
        }

        let summary = preview_folder_ontology(StudioFolderOntologyPreviewRequest {
            root: root.to_string_lossy().to_string(),
            max_depth: Some(3),
            max_files: Some(20),
            include_patterns: Vec::new(),
            exclude_patterns: Vec::new(),
        });

        assert_eq!(summary.neuroimaging_files, 4);
        let maps = candidate(&summary, "maps-basename-roles");
        assert_eq!(maps.matched_files, 4);
        assert_eq!(
            maps.observed_roles,
            vec!["auc".to_string(), "tstat".to_string()]
        );
        assert_eq!(maps.required_roles, maps.observed_roles);
        assert_eq!(maps.groups.len(), 2);
        assert!(maps
            .factors
            .iter()
            .any(|factor| factor.name == "subject" && factor.values.len() == 2));
        assert!(maps.file_pattern.contains("(?P<subject>"));

        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn proposes_condition_factor_for_ambiguous_filename_modifiers() {
        let root = make_temp_dir("condition");
        for subject in ["sub-01", "sub-02"] {
            for condition in ["face", "house"] {
                touch(
                    &root
                        .join("analysis-a")
                        .join(subject)
                        .join("maps")
                        .join(format!("auc_{}.nii.gz", condition)),
                );
            }
        }

        let summary = preview_folder_ontology(StudioFolderOntologyPreviewRequest::new(
            root.to_string_lossy().to_string(),
        ));
        let condition = candidate(&summary, "maps-role-condition");

        assert_eq!(condition.observed_roles, vec!["auc".to_string()]);
        assert_eq!(condition.groups.len(), 4);
        assert!(condition
            .factors
            .iter()
            .any(|factor| factor.name == "condition"
                && factor.values == vec!["face".to_string(), "house".to_string()]));
        assert!(condition
            .factors
            .iter()
            .any(|factor| factor.name == "analysis"
                && factor.values == vec!["analysis-a".to_string()]));
        assert!(condition
            .warnings
            .iter()
            .any(|warning| warning.code == "ambiguous_basename_modifier"));
        assert!(condition.score > candidate(&summary, "flat-statmaps").score);

        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn infers_analysis_factor_for_multi_analysis_root() {
        let root = make_temp_dir("multi-analysis");
        for analysis in ["analysis-a", "analysis-b"] {
            for subject in ["sub-01", "sub-02"] {
                touch(
                    &root
                        .join(analysis)
                        .join(subject)
                        .join("maps")
                        .join("auc.nii.gz"),
                );
            }
        }

        let summary = preview_folder_ontology(StudioFolderOntologyPreviewRequest::new(
            root.to_string_lossy().to_string(),
        ));
        let maps = candidate(&summary, "maps-basename-roles");

        assert_eq!(maps.groups.len(), 4);
        assert_eq!(maps.duplicate_keys, 0);
        assert!(maps.factors.iter().any(|factor| factor.name == "analysis"
            && factor.values == vec!["analysis-a".to_string(), "analysis-b".to_string()]));
        assert!(maps
            .groups
            .iter()
            .any(|group| group.member_id == "sub-01_analysis-a"));
        assert!(maps
            .groups
            .iter()
            .any(|group| group.member_id == "sub-01_analysis-b"));

        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn remote_inventory_inference_does_not_require_local_cache_files() {
        let root = "/remote-cache/live-mount/derivatives";
        let files = ["sub-01", "sub-02"]
            .into_iter()
            .flat_map(|subject| {
                ["beta", "tstat"].into_iter().map(move |role| {
                    inventory_file(root, &format!("{}/maps/{}.nii.gz", subject, role))
                })
            })
            .collect::<Vec<_>>();

        let summary = preview_folder_ontology_with_discovery_inventory(
            StudioFolderOntologyPreviewRequest {
                root: root.to_string(),
                max_depth: Some(3),
                max_files: Some(20),
                include_patterns: Vec::new(),
                exclude_patterns: Vec::new(),
            },
            DiscoveryInventory {
                root_exists: true,
                source_label: Some("remote user@host:/derivatives".to_string()),
                files,
                notes: vec!["listed through remote inventory".to_string()],
                ..DiscoveryInventory::default()
            },
        );

        assert!(summary.root_exists);
        assert_eq!(
            summary.source_label.as_deref(),
            Some("remote user@host:/derivatives")
        );
        let maps = candidate(&summary, "maps-basename-roles");
        assert_eq!(maps.groups.len(), 2);
        assert!(maps.groups.iter().all(|group| {
            group
                .bindings
                .iter()
                .all(|binding| !Path::new(&binding.source_path).exists())
        }));
    }

    #[test]
    fn reports_missing_and_duplicate_role_bindings_in_candidate() {
        let root = make_temp_dir("audit");
        touch(&root.join("sub-01").join("maps").join("beta.nii.gz"));
        touch(&root.join("sub-01").join("maps").join("beta_repeat.nii.gz"));
        touch(&root.join("sub-01").join("maps").join("tstat.nii.gz"));
        touch(&root.join("sub-02").join("maps").join("beta.nii.gz"));

        let summary = preview_folder_ontology(StudioFolderOntologyPreviewRequest::new(
            root.to_string_lossy().to_string(),
        ));
        let maps = candidate(&summary, "maps-role-condition");

        assert!(maps.duplicate_keys > 0 || maps.missing_role_bindings > 0);
        assert!(maps
            .warnings
            .iter()
            .any(|warning| warning.code == "duplicate_role_bindings"
                || warning.code == "missing_role_bindings"));

        fs::remove_dir_all(root).expect("cleanup");
    }
}
