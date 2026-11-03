//! What makes a folder a BIDS dataset, and opening one that only looks like it.
//!
//! A folder with `dataset_description.json` is BIDS; `participants.tsv` is only
//! recommended by the spec. A folder without the description but with a BIDS
//! layout (`sub-<label>/[ses-<label>/]<datatype>/sub-<label>_*.<ext>`) is
//! `layout_only`: never treated as BIDS by itself, but the user may open it as
//! such. bids-rs requires the description on disk, so such a dataset opens from
//! a manifest of a local walk with a description made in memory. Nothing is
//! written to the dataset.

use super::rel_text;
use super::remote::{RemoteEntry, RemoteKind};
use bids_rs::{
    BidsProject, DerivativesMode, FileIndex, IndexingOptions, ManifestEntry, ProjectManifest,
    SidecarContent,
};
use bridge_types::bids::{BidsDirectoryProbe, BidsDirectoryStatus};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

pub(crate) const DESCRIPTION: &str = "dataset_description.json";
const PARTICIPANTS: &str = "participants.tsv";

/// The finding a dataset opened by layout carries.
pub(crate) const LAYOUT_ONLY_CODE: &str = "NO_DATASET_DESCRIPTION";
pub(crate) const LAYOUT_ONLY_TITLE: &str =
    "No dataset_description.json: not BIDS-valid; opened by layout.";
pub(crate) const LAYOUT_ONLY_DETAIL: &str = "This folder has subject and datatype folders with BIDS-named files but no dataset_description.json, which BIDS requires. It was opened by its layout. Name, BIDS version and other dataset fields are unknown, and exclusions are not written until the dataset has a description.";

/// Datatype folders of the BIDS specification.
const DATATYPES: [&str; 14] = [
    "anat", "func", "dwi", "fmap", "perf", "beh", "eeg", "meg", "ieeg", "pet", "micr", "nirs",
    "motion", "mrs",
];
/// Endings of data files and their sidecars.
const DATA_ENDINGS: [&str; 13] = [
    ".nii", ".nii.gz", ".json", ".tsv", ".tsv.gz", ".bval", ".bvec", ".edf", ".bdf", ".vhdr",
    ".set", ".fif", ".snirf",
];
/// The probe reads at most this many subjects, sessions per subject and
/// datatype folders, so a check on a large or remote folder stays cheap.
const PROBE_SUBJECTS: usize = 8;
const PROBE_SESSIONS: usize = 4;
const PROBE_DATATYPE_DIRS: usize = 32;

fn label_of<'a>(name: &'a str, prefix: &str) -> Option<&'a str> {
    name.strip_prefix(prefix)
        .filter(|label| !label.is_empty() && label.chars().all(|c| c.is_ascii_alphanumeric()))
}

/// True for a dataset-relative path shaped like a raw BIDS data file:
/// `sub-01/anat/sub-01_T1w.nii.gz` or `sub-01/ses-1/func/sub-01_ses-1_task-x_bold.json`.
pub(crate) fn is_layout_file(rel: &str) -> bool {
    let parts: Vec<&str> = rel.split('/').collect();
    let (subject, datatype, name) = match parts.as_slice() {
        [subject, datatype, name] => (*subject, *datatype, *name),
        [subject, session, datatype, name] if label_of(session, "ses-").is_some() => {
            (*subject, *datatype, *name)
        }
        _ => return false,
    };
    label_of(subject, "sub-").is_some()
        && DATATYPES.contains(&datatype)
        && name
            .strip_prefix(subject)
            .is_some_and(|rest| rest.starts_with('_'))
        && DATA_ENDINGS.iter().any(|ending| name.ends_with(ending))
}

fn is_file(entry: &RemoteEntry) -> bool {
    entry.kind == RemoteKind::File
}

fn is_dir(entry: &RemoteEntry) -> bool {
    entry.kind == RemoteKind::Directory
}

fn join(parent: &str, name: &str) -> String {
    match parent {
        "" => name.to_string(),
        parent => format!("{parent}/{name}"),
    }
}

/// Lists dataset-relative directories, one result per path, in order. The
/// root is `""`. Local disk and a remote mount answer through the same shape.
pub(crate) type Lister<'a> = &'a dyn Fn(&[String]) -> Vec<Result<Vec<RemoteEntry>, String>>;

/// Classify a folder with a few bounded listings. Only the root must answer;
/// a subject or datatype folder that fails to list is skipped.
pub(crate) fn probe(list: Lister<'_>) -> Result<BidsDirectoryProbe, String> {
    let root = list(&[String::new()])
        .into_iter()
        .next()
        .unwrap_or_else(|| Err("No response".into()))?;
    let has = |name: &str| {
        root.iter()
            .any(|entry| entry.name == name && is_file(entry))
    };
    let has_description = has(DESCRIPTION);
    let mut missing = Vec::new();
    if !has_description {
        missing.push(DESCRIPTION.to_string());
    }
    if !has(PARTICIPANTS) {
        missing.push(PARTICIPANTS.to_string());
    }
    if has_description {
        return Ok(BidsDirectoryProbe {
            status: BidsDirectoryStatus::Bids,
            missing,
        });
    }
    let status = if has_layout(list, &root) {
        BidsDirectoryStatus::LayoutOnly
    } else {
        BidsDirectoryStatus::None
    };
    Ok(BidsDirectoryProbe { status, missing })
}

fn has_layout(list: Lister<'_>, root: &[RemoteEntry]) -> bool {
    let mut subjects: Vec<String> = root
        .iter()
        .filter(|entry| is_dir(entry) && label_of(&entry.name, "sub-").is_some())
        .map(|entry| entry.name.clone())
        .collect();
    subjects.sort();
    subjects.truncate(PROBE_SUBJECTS);
    if subjects.is_empty() {
        return false;
    }

    let mut datatype_dirs = Vec::new();
    let mut session_dirs = Vec::new();
    for (subject, listed) in subjects.iter().zip(list(&subjects)) {
        let Ok(entries) = listed else { continue };
        let mut sessions = 0;
        for entry in entries.iter().filter(|entry| is_dir(entry)) {
            if DATATYPES.contains(&entry.name.as_str()) {
                datatype_dirs.push(join(subject, &entry.name));
            } else if label_of(&entry.name, "ses-").is_some() && sessions < PROBE_SESSIONS {
                sessions += 1;
                session_dirs.push(join(subject, &entry.name));
            }
        }
    }
    if !session_dirs.is_empty() {
        for (session, listed) in session_dirs.iter().zip(list(&session_dirs)) {
            let Ok(entries) = listed else { continue };
            datatype_dirs.extend(
                entries
                    .iter()
                    .filter(|entry| is_dir(entry) && DATATYPES.contains(&entry.name.as_str()))
                    .map(|entry| join(session, &entry.name)),
            );
        }
    }
    datatype_dirs.truncate(PROBE_DATATYPE_DIRS);
    if datatype_dirs.is_empty() {
        return false;
    }
    datatype_dirs
        .iter()
        .zip(list(&datatype_dirs))
        .any(|(dir, listed)| {
            listed.is_ok_and(|entries| {
                entries
                    .iter()
                    .any(|entry| is_file(entry) && is_layout_file(&join(dir, &entry.name)))
            })
        })
}

/// One directory on local disk, as a probe listing. A link is resolved, as on
/// a remote mount.
pub(crate) fn list_local(
    root: &Path,
    rel_dirs: &[String],
) -> Vec<Result<Vec<RemoteEntry>, String>> {
    rel_dirs
        .iter()
        .map(|rel| {
            let dir = if rel.is_empty() {
                root.to_path_buf()
            } else {
                root.join(rel)
            };
            let entries = std::fs::read_dir(&dir)
                .map_err(|e| format!("Cannot read {}: {e}", dir.display()))?;
            Ok(entries
                .flatten()
                .map(|entry| {
                    let path = entry.path();
                    let symlink = entry.file_type().is_ok_and(|kind| kind.is_symlink());
                    let (kind, size, modified) = match std::fs::metadata(&path) {
                        Ok(meta) if meta.is_dir() => (RemoteKind::Directory, 0, None),
                        Ok(meta) if meta.is_file() => {
                            (RemoteKind::File, meta.len(), meta.modified().ok())
                        }
                        Ok(_) => (RemoteKind::Other, 0, None),
                        Err(_) if symlink => (RemoteKind::Dangling, 0, None),
                        Err(_) => (RemoteKind::Other, 0, None),
                    };
                    RemoteEntry {
                        name: entry.file_name().to_string_lossy().into_owned(),
                        kind,
                        size,
                        modified,
                        symlink,
                    }
                })
                .collect())
        })
        .collect()
}

/// The description a dataset opened by layout stands in with. In memory only.
pub(crate) fn synthesized_description(root: &Path) -> String {
    let name = root
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    serde_json::json!({ "Name": name }).to_string()
}

/// Open a local dataset. With a description this is bids-rs's own open. Without
/// one, a folder with a BIDS layout opens from a manifest of a local walk with
/// a description made in memory, and `true` says so. A folder with neither
/// fails as before.
pub(crate) fn open_project(
    root: &Path,
    derivatives: DerivativesMode,
    options: IndexingOptions,
) -> Result<(BidsProject, bool), String> {
    if root.join(DESCRIPTION).exists() {
        return BidsProject::with_indexing_options(root, derivatives, false, options)
            .map(|project| (project, false))
            .map_err(|e| format!("Failed to load BIDS dataset: {e}"));
    }
    let root = root
        .canonicalize()
        .map_err(|e| format!("Cannot access {}: {e}", root.display()))?;
    let index = FileIndex::build_with_options(&root, &options)
        .map_err(|e| format!("Failed to load BIDS dataset: {e}"))?;
    let laid_out = index
        .files()
        .iter()
        .any(|entry| is_layout_file(&rel_text(&entry.rel_path)));
    if !laid_out {
        return Err(format!(
            "Failed to load BIDS dataset: {} has no {DESCRIPTION} and no BIDS layout",
            root.display()
        ));
    }

    let mut files: Vec<ManifestEntry> = index
        .files()
        .iter()
        .map(|entry| ManifestEntry {
            relative_path: entry.rel_path.clone(),
            size: entry.size,
            modified: entry.modified,
            file_kind: entry.file_kind,
            is_available: entry.is_available,
        })
        .collect();
    let mut sidecars: HashMap<PathBuf, SidecarContent> = HashMap::new();
    for file in files.iter().filter(|file| {
        file.is_available && file.relative_path.extension().is_some_and(|e| e == "json")
    }) {
        let content = match std::fs::read_to_string(root.join(&file.relative_path)) {
            Ok(text) => SidecarContent::Json(text),
            Err(error) => SidecarContent::Unavailable(error.to_string()),
        };
        sidecars.insert(file.relative_path.clone(), content);
    }
    // A pipeline whose description is not an object would fail the whole
    // manifest; a local open without discovery never reads it. Leave it out.
    let is_object = |content: Option<&SidecarContent>| match content {
        Some(SidecarContent::Json(text)) => {
            serde_json::from_str::<Value>(text).is_ok_and(|value| value.is_object())
        }
        _ => false,
    };
    let dropped: Vec<PathBuf> = files
        .iter()
        .map(|file| file.relative_path.clone())
        .filter(|rel| {
            let text = rel_text(rel);
            text.starts_with("derivatives/")
                && text.split('/').count() == 3
                && text.ends_with(&format!("/{DESCRIPTION}"))
                && !is_object(sidecars.get(rel))
        })
        .collect();
    files.retain(|file| !dropped.contains(&file.relative_path));
    for rel in &dropped {
        sidecars.remove(rel);
    }

    let description = synthesized_description(&root);
    files.push(ManifestEntry::new(DESCRIPTION, description.len() as u64));
    sidecars.insert(
        PathBuf::from(DESCRIPTION),
        SidecarContent::Json(description),
    );

    let participants = files
        .iter()
        .any(|file| file.relative_path == Path::new(PARTICIPANTS))
        .then(|| std::fs::read_to_string(root.join(PARTICIPANTS)).ok())
        .flatten();
    let manifest = |participants: Option<String>| {
        let mut listed = files.clone();
        if participants.is_none() {
            listed.retain(|file| file.relative_path != Path::new(PARTICIPANTS));
        }
        ProjectManifest {
            files: listed,
            sidecars: sidecars.clone(),
            participants_tsv: participants,
        }
    };
    // As without a description: an unusable participants table is not fatal;
    // subjects come from the folders.
    let project = match BidsProject::from_manifest_with_options(
        &root,
        manifest(participants.clone()),
        options.clone(),
    ) {
        Ok(project) => project,
        Err(_) if participants.is_some() => {
            BidsProject::from_manifest_with_options(&root, manifest(None), options)
                .map_err(|e| format!("Failed to load BIDS dataset: {e}"))?
        }
        Err(e) => return Err(format!("Failed to load BIDS dataset: {e}")),
    };
    Ok((project, true))
}
