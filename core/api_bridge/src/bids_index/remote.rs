//! The server side of a remote scan, without any transport. `walk` lists the
//! dataset through a `RemoteDataset`, and `ScanFiles` serves the small files it
//! fetched to the same parsers a local scan uses. Images are never fetched.

use super::exclusions::EXCLUSIONS_REL_PATH;
use super::{rel_text, tsv_from, tsv_reader, TsvReader};
use bids_rs::{IndexedFileKind, ManifestEntry};
use std::cell::{Cell, RefCell};
use std::collections::{BTreeSet, HashMap};
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// Largest sidecar or table a scan fetches, confounds and MRIQC group tables
/// included. Each is held in memory; confounds and events only for their subject.
pub(crate) const MAX_FETCHED_FILE_BYTES: u64 = 32 << 20;
/// A listing stops here and is reported as incomplete.
const MAX_LISTED_FILES: usize = 2_000_000;
/// Directories or files asked for at once. Cancellation is seen between batches.
const BATCH: usize = 32;
/// Trees no scan reads, at any depth: fMRIPrep keeps `sourcedata` too.
const SKIPPED_NAMES: [&str; 3] = [".git", ".datalad", "sourcedata"];
const DERIVATIVE_IMAGE_ENDINGS: [&str; 4] = [".nii", ".nii.gz", ".gii", ".mgz"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RemoteKind {
    File,
    Directory,
    /// A link with no target, as with an annexed file not on the server.
    Dangling,
    Other,
}

/// One name in a server directory. Links are resolved: `size`, `modified` and
/// `kind` describe the target, and `symlink` says one was followed.
#[derive(Debug, Clone)]
pub(crate) struct RemoteEntry {
    pub name: String,
    pub kind: RemoteKind,
    pub size: u64,
    pub modified: Option<SystemTime>,
    pub symlink: bool,
}

/// A dataset on a server, by dataset-relative path; the root is `""`. Each call
/// answers one result per path, in order, with its own bounded concurrency. The
/// caller is the blocking scan thread.
pub(crate) trait RemoteDataset {
    fn list(&self, rel_dirs: &[String]) -> Vec<Result<Vec<RemoteEntry>, String>>;
    /// Whole files of at most `max_bytes`; a longer one is an error.
    fn fetch(&self, rel_paths: &[String], max_bytes: u64) -> Vec<Result<Vec<u8>, String>>;
    fn headers(&self, rel_paths: &[String]) -> Vec<Result<nifti_loader::HeaderSummary, String>>;
}

/// What a walk found. `files` is the manifest; a derivative image is only a name
/// in `derivative_images`, which is enough to count it as coverage.
#[derive(Debug, Default)]
pub(crate) struct Listing {
    pub files: Vec<ManifestEntry>,
    pub derivative_images: Vec<String>,
    pub directories: BTreeSet<String>,
    pub failed: Vec<(String, String)>,
    stopped: Option<String>,
}

impl Listing {
    /// True when the server walk reached every directory.
    pub fn complete(&self) -> bool {
        self.stopped.is_none() && self.failed.is_empty()
    }

    /// Why the listing is not complete.
    pub fn gap(&self) -> Option<String> {
        self.stopped
            .clone()
            .or_else(|| match self.failed.as_slice() {
                [] => None,
                [(dir, error), rest @ ..] => Some(format!(
                    "{} {} could not be listed ({error})",
                    if rest.is_empty() {
                        dir.clone()
                    } else {
                        format!("{dir} and {} more", rest.len())
                    },
                    if rest.is_empty() {
                        "directory"
                    } else {
                        "directories"
                    },
                )),
            })
    }

    fn add(&mut self, directory: &str, entry: RemoteEntry, next: &mut Vec<String>) {
        if SKIPPED_NAMES.contains(&entry.name.as_str()) {
            return;
        }
        let rel = match directory {
            "" => entry.name.clone(),
            parent => format!("{parent}/{}", entry.name),
        };
        match entry.kind {
            RemoteKind::Directory => {
                self.directories.insert(rel.clone());
                // As in a local walk, a link to a directory is not followed.
                if !entry.symlink {
                    next.push(rel);
                }
            }
            RemoteKind::File | RemoteKind::Dangling => {
                if is_derivative_image(&rel) {
                    self.derivative_images.push(rel);
                    return;
                }
                self.files.push(ManifestEntry {
                    relative_path: PathBuf::from(rel),
                    size: entry.size,
                    modified: entry.modified,
                    file_kind: if entry.symlink {
                        IndexedFileKind::Symlink
                    } else {
                        IndexedFileKind::Regular
                    },
                    is_available: entry.kind == RemoteKind::File,
                });
            }
            RemoteKind::Other => {}
        }
    }

    /// Files every scan reads, whatever changed: the root and each pipeline's
    /// description, root sidecars and events, participants, dated tables and
    /// exclusions.
    pub fn shared_paths(&self) -> Vec<String> {
        self.paths().filter(|rel| is_shared(rel)).collect()
    }

    /// Sidecars below subject directories, for the subjects `wanted`.
    pub fn subject_sidecars(&self, wanted: &dyn Fn(&str) -> bool) -> Vec<String> {
        self.paths()
            .filter(|rel| {
                rel.ends_with(".json")
                    && rel
                        .split('/')
                        .next()
                        .and_then(|first| first.strip_prefix("sub-"))
                        .is_some_and(wanted)
            })
            .collect()
    }

    fn paths(&self) -> impl Iterator<Item = String> + '_ {
        self.files.iter().map(|file| rel_text(&file.relative_path))
    }
}

fn is_derivative_image(rel: &str) -> bool {
    rel.starts_with("derivatives/")
        && DERIVATIVE_IMAGE_ENDINGS
            .iter()
            .any(|ending| rel.ends_with(ending))
}

fn is_shared(rel: &str) -> bool {
    if rel.starts_with("derivatives/") {
        return rel == EXCLUSIONS_REL_PATH
            || rel.split('/').count() == 3 && rel.ends_with("/dataset_description.json");
    }
    if rel.ends_with("_sessions.tsv") || rel.ends_with("_scans.tsv") {
        return true;
    }
    !rel.contains('/')
        && (rel == "participants.tsv" || rel.ends_with(".json") || rel.ends_with("events.tsv"))
}

/// Breadth-first over the server. The root must answer; a directory below it
/// that fails leaves the listing incomplete, and so does `cancelled`.
pub(crate) fn walk(
    remote: &dyn RemoteDataset,
    cancelled: &dyn Fn() -> bool,
) -> Result<Listing, String> {
    let mut listing = Listing::default();
    let root = remote
        .list(&[String::new()])
        .into_iter()
        .next()
        .unwrap_or_else(|| Err("No response".into()))
        .map_err(|error| format!("Cannot list the dataset on the server: {error}"))?;
    let mut frontier = Vec::new();
    for entry in root {
        listing.add("", entry, &mut frontier);
    }
    while !frontier.is_empty() {
        let mut next = Vec::new();
        for batch in frontier.chunks(BATCH) {
            if cancelled() {
                listing.stopped = Some("the scan was stopped during listing".into());
                return Ok(listing);
            }
            for (directory, result) in batch.iter().zip(remote.list(batch)) {
                match result {
                    Ok(entries) => {
                        for entry in entries {
                            listing.add(directory, entry, &mut next);
                        }
                    }
                    Err(error) => listing.failed.push((directory.clone(), error)),
                }
            }
            if listing.files.len() >= MAX_LISTED_FILES {
                listing.stopped = Some(format!("it passed {MAX_LISTED_FILES} files"));
                return Ok(listing);
            }
        }
        frontier = next;
    }
    Ok(listing)
}

/// Fetched contents of a remote dataset, by dataset-relative path.
pub(crate) struct RemoteFiles {
    root: PathBuf,
    /// Every listed name, with derivative images.
    listed: BTreeSet<String>,
    directories: BTreeSet<String>,
    sizes: HashMap<String, u64>,
    contents: RefCell<HashMap<String, Result<Vec<u8>, String>>>,
    fetched: Cell<u64>,
    bytes: Cell<u64>,
}

impl RemoteFiles {
    pub fn new(root: &Path, listing: &Listing) -> Self {
        let sizes: HashMap<String, u64> = listing
            .files
            .iter()
            .map(|file| (rel_text(&file.relative_path), file.size))
            .collect();
        Self {
            root: root.to_path_buf(),
            listed: sizes
                .keys()
                .cloned()
                .chain(listing.derivative_images.iter().cloned())
                .collect(),
            directories: listing.directories.clone(),
            sizes,
            contents: RefCell::default(),
            fetched: Cell::new(0),
            bytes: Cell::new(0),
        }
    }

    fn rel(&self, path: &Path) -> String {
        rel_text(path.strip_prefix(&self.root).unwrap_or(path))
    }

    /// Fetch what is not held yet. A file over the bound, or one that fails, is
    /// kept as an error for whoever reads it. Stops early when `cancelled`.
    pub fn fetch(
        &self,
        remote: &dyn RemoteDataset,
        rel_paths: &[String],
        cancelled: &dyn Fn() -> bool,
    ) {
        let (over, wanted): (Vec<&String>, Vec<&String>) = rel_paths
            .iter()
            .filter(|rel| !self.contents.borrow().contains_key(*rel))
            .partition(|rel| self.sizes.get(*rel).copied().unwrap_or(0) > MAX_FETCHED_FILE_BYTES);
        let mut contents = self.contents.borrow_mut();
        for rel in over {
            let limit = MAX_FETCHED_FILE_BYTES >> 20;
            contents.insert(
                rel.clone(),
                Err(format!("Larger than the {limit} MiB read during a scan")),
            );
        }
        for batch in wanted.chunks(BATCH) {
            if cancelled() {
                return;
            }
            let batch: Vec<String> = batch.iter().map(|rel| (*rel).clone()).collect();
            let results = remote.fetch(&batch, MAX_FETCHED_FILE_BYTES);
            for (rel, result) in batch.into_iter().zip(results) {
                if let Ok(bytes) = &result {
                    self.fetched.set(self.fetched.get() + 1);
                    self.bytes.set(self.bytes.get() + bytes.len() as u64);
                }
                contents.insert(rel, result);
            }
        }
    }

    /// Drop tables a finished subject read. One that failed stays, for the note.
    pub fn forget_read(&self, rel_paths: &[String]) {
        let mut contents = self.contents.borrow_mut();
        for rel in rel_paths {
            if contents.get(rel).is_some_and(Result::is_ok) {
                contents.remove(rel);
            }
        }
    }

    /// Whether a fetch answered for `rel`, with its content or an error.
    pub fn answered(&self, rel: &str) -> bool {
        self.contents.borrow().contains_key(rel)
    }

    /// Paths that were asked for and could not be fetched, with why.
    pub fn failures(&self) -> Vec<(String, String)> {
        let contents = self.contents.borrow();
        let mut failed: Vec<(String, String)> = contents
            .iter()
            .filter_map(|(rel, result)| Some((rel.clone(), result.as_ref().err()?.clone())))
            .collect();
        failed.sort();
        failed
    }

    /// Files fetched so far, and their bytes.
    pub fn fetched(&self) -> (u64, u64) {
        (self.fetched.get(), self.bytes.get())
    }

    pub fn rel_of(&self, path: &Path) -> String {
        self.rel(path)
    }

    fn bytes_of(&self, path: &Path) -> Result<Vec<u8>, String> {
        let rel = self.rel(path);
        self.contents
            .borrow()
            .get(&rel)
            .cloned()
            .unwrap_or_else(|| Err(format!("{rel} was not fetched")))
    }

    fn children<'a>(
        &self,
        names: &'a BTreeSet<String>,
        directory: &Path,
    ) -> impl Iterator<Item = &'a String> {
        let parent = self.rel(directory);
        names.iter().filter(move |rel| {
            rel.strip_prefix(&parent)
                .and_then(|rest| rest.strip_prefix('/'))
                .is_some_and(|rest| !rest.contains('/'))
        })
    }
}

/// Where a scan's small files come from: the disk, or what was fetched.
pub(crate) enum ScanFiles {
    Disk,
    Remote(RemoteFiles),
}

impl ScanFiles {
    pub fn text(&self, path: &Path) -> Result<String, String> {
        match self {
            Self::Disk => std::fs::read_to_string(path)
                .map_err(|e| format!("Cannot read {}: {e}", path.display())),
            Self::Remote(files) => String::from_utf8(files.bytes_of(path)?)
                .map_err(|e| format!("Cannot read {}: {e}", path.display())),
        }
    }

    pub fn tsv(&self, path: &Path) -> Result<TsvReader, String> {
        match self {
            Self::Disk => tsv_reader(path),
            Self::Remote(files) => {
                let gzipped = path.extension().is_some_and(|ext| ext == "gz");
                Ok(tsv_from(Cursor::new(files.bytes_of(path)?), gzipped))
            }
        }
    }

    pub fn exists(&self, path: &Path) -> bool {
        match self {
            Self::Disk => path.exists(),
            Self::Remote(files) => files.listed.contains(&files.rel(path)),
        }
    }

    /// Names of the directories in `directory`.
    pub fn directories_in(&self, directory: &Path) -> Vec<String> {
        let name = |path: &Path| path.file_name()?.to_str().map(str::to_string);
        match self {
            Self::Disk => std::fs::read_dir(directory)
                .map(|entries| {
                    entries
                        .flatten()
                        .map(|entry| entry.path())
                        .filter(|path| path.is_dir())
                        .filter_map(|path| name(&path))
                        .collect()
                })
                .unwrap_or_default(),
            Self::Remote(files) => files
                .children(&files.directories, directory)
                .filter_map(|rel| name(Path::new(rel)))
                .collect(),
        }
    }

    /// Paths of what `directory` holds directly. On a server, files only.
    pub fn files_in(&self, directory: &Path) -> Vec<PathBuf> {
        match self {
            Self::Disk => std::fs::read_dir(directory)
                .map(|entries| entries.flatten().map(|entry| entry.path()).collect())
                .unwrap_or_default(),
            Self::Remote(files) => files
                .children(&files.listed, directory)
                .map(|rel| files.root.join(rel))
                .collect(),
        }
    }
}
