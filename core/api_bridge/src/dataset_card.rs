//! Dataset cards in the file browser: folder markers, the card of one folder
//! and the sidecar card of one image. All three are read-only probes with a
//! bound on everything they read. They work on a local folder and on a folder
//! of an active remote mount, where they list and read small files under the
//! mount's operation permits and never download an image or touch the cache.

use crate::bids_index::{natural_cmp, parse_name};
use crate::population_sampling::{self, SampleTicket};
use crate::{remote_transfer, BridgeState, RemoteMountEntry};
use bridge_types::{
    BridgeError, BridgeResult, DatasetAnalysis, DatasetCard, DatasetCardPhase, DatasetContainer,
    DatasetContents, DatasetDescription, DatasetGeneratedBy, DatasetImageKind, DatasetMarker,
    DatasetMarkerSummary, DatasetOtherField, DatasetPipelineRef, DatasetReadme, DatasetSource,
    SidecarCard, SidecarEntry, SidecarHeader, SidecarLevel,
};
use futures::StreamExt;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};
use std::future::Future;
use std::hash::{Hash, Hasher};
use std::path::{Component, Path, PathBuf};
use std::pin::Pin;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime};
use tauri::{command, State};

const DESCRIPTION: &str = "dataset_description.json";
/// README names, in the order they are preferred.
const README_NAMES: [&str; 4] = ["README", "README.md", "README.rst", "README.txt"];

/// Folders one `probe_dataset_markers` call answers.
pub(crate) const MAX_MARKER_PATHS: usize = 128;
/// Child folders a marker probe lists to count analyses.
const MARKER_ANALYSIS_CHILDREN: usize = 24;
/// Child folders a card lists for its analyses table.
const CARD_ANALYSIS_CHILDREN: usize = 64;
pub(crate) const MAX_DESCRIPTION_BYTES: u64 = 1 << 20;
/// Raw description text a card returns.
const MAX_RAW_BYTES: usize = 256 << 10;
pub(crate) const MAX_README_BYTES: u64 = 256 << 10;
/// Characters of one compact JSON value.
pub(crate) const MAX_VALUE_CHARS: usize = 2000;
const MAX_OTHER_FIELDS: usize = 200;
pub(crate) const MAX_IMAGE_KINDS: usize = 24;
/// Distinct image kinds a walk keeps apart before it stops telling them apart.
const MAX_TRACKED_KINDS: usize = 4096;
const MAX_LABELS: usize = 256;
/// Sidecars merged into one card.
pub(crate) const MAX_SIDECAR_FILES: usize = 16;
const MAX_SIDECAR_BYTES: u64 = 1 << 20;
/// Merged metadata entries one sidecar card returns.
pub(crate) const MAX_SIDECAR_ENTRIES: usize = 500;
/// Items of one list field of a description (authors, funding, ...).
const MAX_LIST_ITEMS: usize = 200;
/// Entries one local listing reads when its caller names no smaller bound.
const MAX_LISTED_ENTRIES: usize = 200_001;
/// Ancestors searched for a dataset root.
const MAX_ANCESTORS: usize = 16;
/// The same, for a local file with no browse root to stop at.
const MAX_UNBOUNDED_ANCESTORS: usize = 8;
/// Directories listed at once. Cancellation is seen between batches.
const LIST_BATCH: usize = 32;

/// A marker younger than this is returned without any I/O.
const MARKER_FRESH: Duration = Duration::from_secs(10);
/// A marker older than this is recomputed even if its folder looks unchanged.
const MARKER_TTL: Duration = Duration::from_secs(300);
/// Wall-clock time one `probe_dataset_markers` call may spend reading. A
/// folder not answered in time gets no marker and is asked about again.
const MARKER_BUDGET: Duration = Duration::from_secs(4);
/// Wall-clock time the descriptions phase of a card may spend reading, and
/// the same again for the analyses scan and description reads of the full
/// phase (its counting walk has [`WalkCaps::budget`]). What was read by then
/// is returned, marked as short, and not kept.
const CARD_READ_BUDGET: Duration = Duration::from_secs(15);
/// Folders whose refresh generation is tracked apart.
const MAX_TRACKED_GENERATIONS: usize = 1024;
const CARD_TTL: Duration = Duration::from_secs(600);
const MAX_CACHED_MARKERS: usize = 4096;
const MAX_CACHED_CARDS: usize = 32;

/// Bounds of a contents walk.
#[derive(Debug, Clone, Copy)]
pub(crate) struct WalkCaps {
    pub max_depth: usize,
    pub max_dirs: usize,
    pub max_entries: usize,
    pub budget: Duration,
    /// Time for everything the full phase reads before the walk: the
    /// analyses scan and the descriptions.
    pub read_budget: Duration,
}

impl Default for WalkCaps {
    fn default() -> Self {
        Self {
            max_depth: 8,
            max_dirs: 1500,
            max_entries: 200_000,
            budget: Duration::from_secs(20),
            read_budget: CARD_READ_BUDGET,
        }
    }
}

fn input(code: u16, details: impl Into<String>) -> BridgeError {
    BridgeError::Input {
        code,
        details: details.into(),
    }
}

fn io(code: u16, details: impl Into<String>) -> BridgeError {
    BridgeError::Io {
        code,
        details: details.into(),
    }
}

// ---- where a probe reads ----

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(crate) enum Kind {
    File,
    Dir,
    /// A link, not followed: it is never descended into, and it counts as a
    /// file where a file is expected (an annexed image or description).
    Link,
    /// A link known to lead to a folder (local listings only). Not followed.
    DirLink,
    Other,
}

#[derive(Debug, Clone)]
pub(crate) struct Entry {
    pub name: String,
    pub kind: Kind,
    pub size: u64,
    pub modified: Option<SystemTime>,
}

impl Entry {
    fn is_dir(&self) -> bool {
        self.kind == Kind::Dir
    }
    fn is_fileish(&self) -> bool {
        matches!(self.kind, Kind::File | Kind::Link)
    }
    /// A link that is, or by its name may be, a folder the probe did not
    /// enter. A remote listing does not resolve links, so there a link with
    /// no extension that is not a standard top-level file counts as one.
    fn is_skipped_folder_link(&self) -> bool {
        match self.kind {
            Kind::DirLink => true,
            Kind::Link => {
                !self.name.contains('.')
                    && !["README", "CHANGES", "LICENSE"]
                        .iter()
                        .any(|file| self.name.eq_ignore_ascii_case(file))
            }
            _ => false,
        }
    }
}

/// The filesystem a probe reads. Paths are always the paths the browser shows:
/// for a remote mount that is the path under the mount's local root, and each
/// operation maps it to the server path.
#[derive(Clone)]
pub(crate) enum CardFs {
    Local,
    Remote(Box<RemoteMountEntry>),
    /// The local disk with every batch of listings delayed: a slow mount.
    #[cfg(test)]
    Slow(Duration),
}

fn server_path(mount: &RemoteMountEntry, path: &Path) -> Result<String, String> {
    let relative = path
        .strip_prefix(&mount.local_root)
        .map_err(|_| "path is outside the remote mount".to_string())?;
    let mut remote = mount.remote_root.trim_end_matches('/').to_string();
    for component in relative.components() {
        match component {
            Component::Normal(segment) => {
                remote.push('/');
                remote.push_str(&segment.to_string_lossy());
            }
            Component::CurDir => {}
            _ => return Err("path leaves the remote mount".to_string()),
        }
    }
    if remote.is_empty() {
        remote.push('/');
    }
    Ok(remote)
}

/// At most `limit` entries of a local folder: reading stops there, so a
/// folder of millions of files costs no more than the caller's allowance.
fn list_local(dir: &Path, limit: usize) -> Result<Vec<Entry>, String> {
    let mut entries = Vec::new();
    if limit == 0 {
        return Ok(entries);
    }
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())?.flatten() {
        // Neither call follows a link.
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let metadata = entry.metadata().ok();
        entries.push(Entry {
            name: entry.file_name().to_string_lossy().into_owned(),
            kind: if file_type.is_symlink() {
                // Only the target's type is asked for; nothing in it is read.
                if std::fs::metadata(entry.path()).is_ok_and(|target| target.is_dir()) {
                    Kind::DirLink
                } else {
                    Kind::Link
                }
            } else if file_type.is_dir() {
                Kind::Dir
            } else if file_type.is_file() {
                Kind::File
            } else {
                Kind::Other
            },
            size: metadata.as_ref().map_or(0, |m| m.len()),
            modified: metadata.and_then(|m| m.modified().ok()),
        });
        if entries.len() >= limit {
            break;
        }
    }
    Ok(entries)
}

/// Refuse a local folder that resolves outside `contain`, as one reached
/// through a linked path component does. A folder that does not resolve at
/// all is left to fail when it is listed.
fn contained_dir(dir: &Path, contain: &Path) -> Result<(), String> {
    let Ok(real) = std::fs::canonicalize(dir) else {
        return Ok(());
    };
    match std::fs::canonicalize(contain) {
        Ok(root) if real.starts_with(&root) => Ok(()),
        _ => Err(format!(
            "'{}' is reached through a link that leaves the browsed folder '{}'.",
            dir.display(),
            contain.display()
        )),
    }
}

/// Refuse a local file that resolves outside `contain`, as a link out of the
/// browsed folder does, and anything that is not a regular file.
fn contained_file(path: &Path, contain: &Path) -> Result<PathBuf, String> {
    let real = std::fs::canonicalize(path).map_err(|e| e.to_string())?;
    let root = std::fs::canonicalize(contain).map_err(|e| e.to_string())?;
    if !real.starts_with(&root) {
        return Err("is a link that leaves the browsed folder; not read".to_string());
    }
    if !std::fs::metadata(&real).is_ok_and(|m| m.is_file()) {
        return Err("is not a regular file".to_string());
    }
    Ok(real)
}

fn read_local(path: &Path, max_bytes: u64, contain: &Path) -> Result<(Vec<u8>, bool), String> {
    use std::io::Read;
    let real = contained_file(path, contain)?;
    let file = std::fs::File::open(real).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    file.take(max_bytes + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    let longer = bytes.len() as u64 > max_bytes;
    bytes.truncate(max_bytes as usize);
    Ok((bytes, longer))
}

impl CardFs {
    fn remote(&self) -> Option<&RemoteMountEntry> {
        match self {
            CardFs::Remote(mount) => Some(mount),
            _ => None,
        }
    }

    /// Whether a local folder may be listed: it must resolve inside `bound`.
    /// A remote path is mapped under the mount root and needs no check.
    fn admit(&self, dir: &Path, bound: Option<&Path>) -> Result<(), String> {
        match (self.remote(), bound) {
            (None, Some(bound)) => contained_dir(dir, bound),
            _ => Ok(()),
        }
    }

    /// One result per directory, in order.
    pub(crate) async fn list_many(&self, dirs: &[PathBuf]) -> Vec<Result<Vec<Entry>, String>> {
        self.list_many_within(dirs, MAX_LISTED_ENTRIES).await
    }

    /// [`Self::list_many`] reading at most `limit` entries in all from a
    /// local disk. A remote listing arrives whole; its caller bounds it in
    /// time instead.
    async fn list_many_within(
        &self,
        dirs: &[PathBuf],
        limit: usize,
    ) -> Vec<Result<Vec<Entry>, String>> {
        #[cfg(test)]
        if let CardFs::Slow(delay) = self {
            tokio::time::sleep(*delay).await;
        }
        match self.remote() {
            None => {
                let mut room = limit;
                let listed = dirs
                    .iter()
                    .map(|dir| {
                        let listing = list_local(dir, room);
                        if let Ok(entries) = &listing {
                            room = room.saturating_sub(entries.len());
                        }
                        listing
                    })
                    .collect();
                // Local reads never wait, so give a cancelled caller a point
                // at which the worker can stop.
                tokio::task::yield_now().await;
                listed
            }
            Some(mount) => {
                let mut results: Vec<Option<Result<Vec<Entry>, String>>> =
                    dirs.iter().map(|_| None).collect();
                let mut asked = Vec::new();
                let mut remote = Vec::new();
                for (index, dir) in dirs.iter().enumerate() {
                    match server_path(mount, dir) {
                        Ok(path) => {
                            asked.push(index);
                            remote.push(path);
                        }
                        Err(e) => results[index] = Some(Err(e)),
                    }
                }
                let listed = remote_transfer::list_unresolved(mount, &remote).await;
                for (index, result) in asked.into_iter().zip(listed) {
                    results[index] = Some(result.map_err(|e| e.to_string()).map(|entries| {
                        entries
                            .into_iter()
                            .filter(|entry| crate::is_single_remote_name(&entry.name))
                            .map(|entry| {
                                use remotely::fs::FileType;
                                Entry {
                                    kind: match entry.metadata.file_type {
                                        FileType::File => Kind::File,
                                        FileType::Directory => Kind::Dir,
                                        FileType::Symlink => Kind::Link,
                                        FileType::Other => Kind::Other,
                                    },
                                    size: entry.metadata.size,
                                    modified: entry.metadata.modified,
                                    name: entry.name,
                                }
                            })
                            .collect()
                    }));
                }
                results
                    .into_iter()
                    .map(|result| result.unwrap_or_else(|| Err("not listed".to_string())))
                    .collect()
            }
        }
    }

    pub(crate) async fn list(&self, dir: &Path) -> Result<Vec<Entry>, String> {
        self.list_many(&[dir.to_path_buf()])
            .await
            .pop()
            .unwrap_or_else(|| Err("not listed".to_string()))
    }

    /// The start of each file, at most `max_bytes`, and whether it is longer.
    /// A local file must resolve inside `contain`. A remote read follows the
    /// server's links, as every other read on a mount does.
    pub(crate) async fn read_many(
        &self,
        paths: &[PathBuf],
        max_bytes: u64,
        contain: &Path,
    ) -> Vec<Result<(Vec<u8>, bool), String>> {
        match self.remote() {
            None => {
                let read = paths
                    .iter()
                    .map(|path| read_local(path, max_bytes, contain))
                    .collect();
                tokio::task::yield_now().await;
                read
            }
            Some(mount) => {
                let remote: Vec<Result<String, String>> =
                    paths.iter().map(|path| server_path(mount, path)).collect();
                let asked: Vec<String> = remote.iter().flatten().cloned().collect();
                let mut read = remote_transfer::read_file_prefixes(mount, &asked, max_bytes)
                    .await
                    .into_iter();
                remote
                    .into_iter()
                    .map(|path| {
                        path?;
                        read.next()
                            .unwrap_or_else(|| Err(remote_transfer::error("not read")))
                            .map_err(|e| e.to_string())
                    })
                    .collect()
            }
        }
    }

    /// [`Self::read_many`] for files that may not exist: `Ok(None)` is a file
    /// that is not there, `Err` one that is there (or may be) and could not
    /// be read this time.
    async fn read_many_optional(
        &self,
        paths: &[PathBuf],
        max_bytes: u64,
        contain: &Path,
    ) -> Vec<Result<Option<(Vec<u8>, bool)>, String>> {
        match self.remote() {
            None => {
                let read = paths
                    .iter()
                    .map(|path| match std::fs::symlink_metadata(path) {
                        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
                        _ => read_local(path, max_bytes, contain).map(Some),
                    })
                    .collect();
                tokio::task::yield_now().await;
                read
            }
            Some(mount) => {
                let remote: Vec<Result<String, String>> =
                    paths.iter().map(|path| server_path(mount, path)).collect();
                let asked: Vec<String> = remote.iter().flatten().cloned().collect();
                let mut read =
                    remote_transfer::read_optional_file_prefixes(mount, &asked, max_bytes)
                        .await
                        .into_iter();
                remote
                    .into_iter()
                    .map(|path| {
                        path?;
                        read.next()
                            .unwrap_or_else(|| Err(remote_transfer::error("not read")))
                            .map_err(|e| e.to_string())
                    })
                    .collect()
            }
        }
    }

    async fn read(
        &self,
        path: &Path,
        max_bytes: u64,
        contain: &Path,
    ) -> Result<(Vec<u8>, bool), String> {
        self.read_many(&[path.to_path_buf()], max_bytes, contain)
            .await
            .pop()
            .unwrap_or_else(|| Err("not read".to_string()))
    }

    /// Header facts from the first bytes of a NIfTI file.
    async fn header(
        &self,
        path: &Path,
        contain: &Path,
    ) -> Result<nifti_loader::HeaderSummary, String> {
        match self.remote() {
            None => {
                let real = contained_file(path, contain)?;
                let header = nifti_loader::read_header_summary(&real).map_err(|e| e.to_string());
                tokio::task::yield_now().await;
                header
            }
            Some(mount) => {
                let remote = server_path(mount, path)?;
                remote_transfer::read_headers(mount, &[remote])
                    .await
                    .pop()
                    .unwrap_or_else(|| Err(remote_transfer::error("not read")))
                    .map_err(|e| e.to_string())
            }
        }
    }
}

/// Where one request reads, fixed before any I/O.
#[derive(Clone)]
pub(crate) struct Scope {
    pub fs: CardFs,
    /// Nothing above this folder is listed or read: the mount root, the browse
    /// root the caller named, or `None` for a local path with neither.
    pub bound: Option<PathBuf>,
    /// Cache identity: the remote endpoint and root, or the local disk.
    identity: String,
}

impl Scope {
    /// The cache key of `folder` read in this scope. The bound is part of
    /// it: what a probe may read, and so what it answers, depends on the
    /// folder it is contained in.
    fn key(&self, folder: &Path) -> CacheKey {
        (
            self.identity.clone(),
            self.bound.clone(),
            folder.to_path_buf(),
        )
    }
}

/// An absolute path with no `..`: the only paths a probe accepts. The text is
/// taken as written: a name may begin or end with a space.
fn checked_path(text: &str, what: &str) -> BridgeResult<PathBuf> {
    let path = Path::new(text);
    let mut clean = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(_) | Component::RootDir | Component::Normal(_) => {
                clean.push(component.as_os_str())
            }
            Component::CurDir => {}
            Component::ParentDir => {
                return Err(input(
                    8260,
                    format!("The {what} path must not contain '..': {text}"),
                ))
            }
        }
    }
    if !clean.is_absolute() {
        return Err(input(
            8260,
            format!("The {what} path must be absolute: {text}"),
        ));
    }
    Ok(clean)
}

/// Decide where `path` is read, and refuse one outside its browse root or
/// under a remote mount that is not connected.
pub(crate) async fn resolve_scope(
    state: &BridgeState,
    path: &str,
    root_path: Option<&str>,
) -> BridgeResult<(Scope, PathBuf)> {
    let path = checked_path(path, "requested")?;
    let root = root_path
        .filter(|root| !root.is_empty())
        .map(|root| checked_path(root, "browse root"))
        .transpose()?;
    if let Some(root) = &root {
        if !path.starts_with(root) {
            return Err(input(
                8261,
                format!(
                    "'{}' is outside the browsed folder '{}'.",
                    path.display(),
                    root.display()
                ),
            ));
        }
    }
    if let Some((mount, _)) = crate::resolve_remote_mount_for_local_path(state, &path).await {
        if mount.transfers.is_stopped() {
            return Err(inactive_mount(&path));
        }
        let bound = root
            .filter(|root| root.starts_with(&mount.local_root))
            .unwrap_or_else(|| mount.local_root.clone());
        let identity = format!(
            "remote:{}@{}:{}:{}",
            mount.user, mount.host, mount.port, mount.remote_root
        );
        return Ok((
            Scope {
                fs: CardFs::Remote(Box::new(mount)),
                bound: Some(bound),
                identity,
            },
            path,
        ));
    }
    if crate::remote_cache_root().is_ok_and(|cache| path.starts_with(cache)) {
        return Err(inactive_mount(&path));
    }
    Ok((
        Scope {
            fs: CardFs::Local,
            bound: root,
            identity: "local".into(),
        },
        path,
    ))
}

fn inactive_mount(path: &Path) -> BridgeError {
    input(
        8232,
        format!(
            "Remote mount is not active for '{}'. Reconnect the remote folder and try again.",
            path.display()
        ),
    )
}

/// What a probe read describes the mount captured before its I/O. If that
/// mount was unmounted or replaced meanwhile, the result is void.
async fn ensure_current(state: &BridgeState, scope: &Scope, path: &Path) -> BridgeResult<()> {
    let CardFs::Remote(mount) = &scope.fs else {
        return Ok(());
    };
    let current = !mount.transfers.is_stopped()
        && crate::resolve_remote_mount_for_local_path(state, path)
            .await
            .is_some_and(|(current, _)| current.mount_id == mount.mount_id);
    if current {
        Ok(())
    } else {
        Err(io(
            8262,
            format!(
                "Remote mount {} was unmounted or replaced while this folder was being read; reconnect the remote folder and try again.",
                mount.origin_label
            ),
        ))
    }
}

type Work<T> = Pin<Box<dyn Future<Output = T>>>;

/// Run a probe in an owned worker, like the remote adapters in
/// `remote_transfer`: the remote filesystem futures are not `Send`, and local
/// reads block. Dropping the returned future stops the worker at its next
/// await, which closes open remote handles and returns the mount's permits.
async fn owned<T, F>(work: F) -> BridgeResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> Work<T> + Send + 'static,
{
    let (caller_alive, mut caller_gone) = tokio::sync::oneshot::channel::<()>();
    let runtime = tokio::runtime::Handle::current();
    let worker = tokio::task::spawn_blocking(move || {
        runtime.block_on(async move {
            tokio::select! {
                biased;
                _ = &mut caller_gone => None,
                result = work() => Some(result),
            }
        })
    })
    .await;
    drop(caller_alive);
    match worker {
        Ok(Some(result)) => Ok(result),
        Ok(None) => Err(population_sampling::cancelled()),
        Err(e) => Err(io(8263, format!("Dataset card worker failed: {e}"))),
    }
}

// ---- description ----

fn cut(text: &str, max_chars: usize) -> (String, bool) {
    match text.char_indices().nth(max_chars) {
        Some((end, _)) => (text[..end].to_string(), true),
        None => (text.to_string(), false),
    }
}

/// A JSON value on one line, cut at [`MAX_VALUE_CHARS`].
pub(crate) fn compact(value: &Value) -> (String, bool) {
    cut(
        &serde_json::to_string(value).unwrap_or_default(),
        MAX_VALUE_CHARS,
    )
}

/// Collects the top-level entries of a JSON object as they parse, so the ones
/// before a syntax error survive it.
struct Salvage<'a>(&'a mut Vec<(String, Value)>);

impl<'de> serde::de::DeserializeSeed<'de> for Salvage<'_> {
    type Value = ();
    fn deserialize<D: serde::Deserializer<'de>>(self, deserializer: D) -> Result<(), D::Error> {
        deserializer.deserialize_map(self)
    }
}

impl<'de> serde::de::Visitor<'de> for Salvage<'_> {
    type Value = ();
    fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
        formatter.write_str("a JSON object")
    }
    fn visit_map<A: serde::de::MapAccess<'de>>(self, mut map: A) -> Result<(), A::Error> {
        while let Some((key, value)) = map.next_entry::<String, Value>()? {
            self.0.push((key, value));
        }
        Ok(())
    }
}

/// The top-level entries of a JSON object in file order, and what stopped the
/// parse if anything did.
pub(crate) fn object_entries(bytes: &[u8]) -> (Vec<(String, Value)>, Option<String>) {
    use serde::de::DeserializeSeed;
    let text = String::from_utf8_lossy(bytes);
    let text = text.trim_start_matches('\u{feff}');
    let mut entries = Vec::new();
    let mut deserializer = serde_json::Deserializer::from_str(text);
    let parsed = Salvage(&mut entries)
        .deserialize(&mut deserializer)
        .and_then(|()| deserializer.end());
    // A serde_json error names a position and a token, never file content.
    (entries, parsed.err().map(|e| e.to_string()))
}

/// A text field, cut like every other value a card returns. `shortened` is
/// set when a value was cut or a list lost items.
fn text_of(value: &Value, shortened: &mut bool) -> Option<String> {
    let text = match value {
        Value::String(text) => text.as_str(),
        Value::Number(number) => return Some(number.to_string()),
        _ => return None,
    };
    let (text, was_cut) = cut(text, MAX_VALUE_CHARS);
    *shortened |= was_cut;
    Some(text)
}

fn texts_of(value: &Value, shortened: &mut bool) -> Option<Vec<String>> {
    match value {
        Value::String(_) => Some(vec![text_of(value, shortened)?]),
        Value::Array(items) => {
            *shortened |= items.len() > MAX_LIST_ITEMS;
            Some(
                items
                    .iter()
                    .take(MAX_LIST_ITEMS)
                    .map(|item| {
                        text_of(item, shortened).unwrap_or_else(|| {
                            let (text, was_cut) = compact(item);
                            *shortened |= was_cut;
                            text
                        })
                    })
                    .collect(),
            )
        }
        _ => None,
    }
}

fn field(
    object: &serde_json::Map<String, Value>,
    key: &str,
    shortened: &mut bool,
) -> Option<String> {
    object.get(key).and_then(|value| text_of(value, shortened))
}

/// The objects of a field that is one object or a list of them.
fn objects_of<'a>(value: &'a Value, shortened: &mut bool) -> Option<Vec<&'a Value>> {
    match value {
        Value::Array(items) => {
            *shortened |= items.len() > MAX_LIST_ITEMS;
            Some(items.iter().take(MAX_LIST_ITEMS).collect())
        }
        Value::Object(_) => Some(vec![value]),
        _ => None,
    }
}

fn generated_by(value: &Value, shortened: &mut bool) -> Option<Vec<DatasetGeneratedBy>> {
    objects_of(value, shortened)?
        .into_iter()
        .map(|item| {
            let object = item.as_object()?;
            Some(DatasetGeneratedBy {
                name: field(object, "Name", shortened),
                version: field(object, "Version", shortened),
                description: field(object, "Description", shortened),
                code_url: field(object, "CodeURL", shortened),
                container: object
                    .get("Container")
                    .and_then(Value::as_object)
                    .map(|container| DatasetContainer {
                        container_type: field(container, "Type", shortened),
                        tag: field(container, "Tag", shortened),
                        uri: field(container, "URI", shortened),
                    }),
            })
        })
        .collect()
}

fn source_datasets(value: &Value, shortened: &mut bool) -> Option<Vec<DatasetSource>> {
    objects_of(value, shortened)?
        .into_iter()
        .map(|item| {
            let object = item.as_object()?;
            Some(DatasetSource {
                url: field(object, "URL", shortened),
                doi: field(object, "DOI", shortened),
                version: field(object, "Version", shortened),
            })
        })
        .collect()
}

pub(crate) struct ParsedDescription {
    pub description: Option<DatasetDescription>,
    pub issue: Option<String>,
}

/// Read a description as far as it goes. A syntax error keeps the fields
/// before it; a standard key with the wrong shape is kept among the other
/// fields. `longer` says the file exceeds what was read.
pub(crate) fn parse_description(bytes: &[u8], longer: bool) -> ParsedDescription {
    let (entries, error) = object_entries(bytes);
    let mut issues = Vec::new();
    if longer {
        issues.push(format!(
            "the file is larger than {} KiB; only its start was read",
            MAX_DESCRIPTION_BYTES >> 10
        ));
    } else if let Some(error) = error {
        issues.push(format!(
            "invalid JSON ({error}); {} field(s) before the error were read",
            entries.len()
        ));
    }
    let mut description = DatasetDescription::default();
    let mut misshapen = Vec::new();
    let mut shortened = Vec::new();
    let mut dropped = 0usize;
    for (key, value) in &entries {
        let mut was_cut = false;
        let cut = &mut was_cut;
        let mut text = |slot: &mut Option<String>| match text_of(value, cut) {
            Some(text) => {
                *slot = Some(text);
                true
            }
            None => false,
        };
        let known = match key.as_str() {
            "Name" => text(&mut description.name),
            "BIDSVersion" => text(&mut description.bids_version),
            "DatasetType" => text(&mut description.dataset_type),
            "License" => text(&mut description.license),
            "Acknowledgements" => text(&mut description.acknowledgements),
            "HowToAcknowledge" => text(&mut description.how_to_acknowledge),
            "DatasetDOI" => text(&mut description.dataset_doi),
            "Description" => text(&mut description.description),
            "Authors" => texts_of(value, cut)
                .map(|v| description.authors = v)
                .is_some(),
            "Funding" => texts_of(value, cut)
                .map(|v| description.funding = v)
                .is_some(),
            "EthicsApprovals" => texts_of(value, cut)
                .map(|v| description.ethics_approvals = v)
                .is_some(),
            "ReferencesAndLinks" => texts_of(value, cut)
                .map(|v| description.references_and_links = v)
                .is_some(),
            "HEDVersion" => texts_of(value, cut)
                .map(|v| description.hed_version = v)
                .is_some(),
            "GeneratedBy" => generated_by(value, cut)
                .map(|v| description.generated_by = v)
                .is_some(),
            "SourceDatasets" => source_datasets(value, cut)
                .map(|v| description.source_datasets = v)
                .is_some(),
            _ => {
                keep_other(&mut description, key, value, &mut dropped);
                continue;
            }
        };
        if !known {
            misshapen.push(key.as_str());
            keep_other(&mut description, key, value, &mut dropped);
        } else if was_cut {
            shortened.push(key.as_str());
        }
    }
    if !shortened.is_empty() {
        issues.push(format!(
            "{} is too long to show in full and was cut",
            shortened.join(", ")
        ));
    }
    if !misshapen.is_empty() {
        issues.push(format!(
            "{} has an unexpected shape and is shown as written",
            misshapen.join(", ")
        ));
    }
    if dropped > 0 {
        issues.push(format!("{dropped} further field(s) are not shown"));
    }
    ParsedDescription {
        description: (!entries.is_empty()).then_some(description),
        issue: (!issues.is_empty()).then(|| issues.join("; ")),
    }
}

fn keep_other(description: &mut DatasetDescription, key: &str, value: &Value, dropped: &mut usize) {
    if description.other_fields.len() >= MAX_OTHER_FIELDS {
        *dropped += 1;
        return;
    }
    let (value, truncated) = compact(value);
    description.other_fields.push(DatasetOtherField {
        key: cut(key, 200).0,
        value,
        truncated,
    });
}

fn pipeline_ref(description: &DatasetDescription) -> Option<DatasetPipelineRef> {
    description.generated_by.iter().find_map(|item| {
        Some(DatasetPipelineRef {
            name: item.name.clone()?,
            version: item.version.clone(),
        })
    })
}

/// Top-level keys a description may declare a date under. None is standard
/// BIDS, so only these plain spellings are taken, compared without case.
const DATE_KEYS: [&str; 8] = [
    "Date",
    "DateCreated",
    "DateGenerated",
    "DateModified",
    "CreationDate",
    "Created",
    "Generated",
    "GeneratedOn",
];
/// Characters of a declared date a card shows.
const MAX_DATE_CHARS: usize = 40;

/// Whether a text reads as a date: it starts with a four-digit year, as an
/// ISO 8601 date or date-time does.
fn starts_with_year(text: &str) -> bool {
    text.len() >= 4 && text.bytes().take(4).all(|byte| byte.is_ascii_digit())
}

/// The date a description declares, as written: the first text value under
/// one of [`DATE_KEYS`] that starts with a four-digit year. Other text under
/// such a key ("b", "March") is not shown as a date, and still appears among
/// the card's other fields. Nothing is guessed from names.
pub(crate) fn declared_date(description: &DatasetDescription) -> Option<String> {
    DATE_KEYS.iter().find_map(|wanted| {
        description
            .other_fields
            .iter()
            .filter(|field| !field.truncated && field.key.eq_ignore_ascii_case(wanted))
            .filter_map(|field| serde_json::from_str::<String>(&field.value).ok())
            .map(|text| text.trim().to_string())
            .find(|text| starts_with_year(text))
            .map(|text| cut(&text, MAX_DATE_CHARS).0)
    })
}

fn marker_summary(description: &DatasetDescription) -> DatasetMarkerSummary {
    DatasetMarkerSummary {
        name: description.name.clone(),
        dataset_type: description.dataset_type.clone(),
        generated_by: pipeline_ref(description),
    }
}

fn shown(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

// ---- names ----

/// `01` from `sub-01` when `key` is `sub`.
fn label<'a>(token: &'a str, key: &str) -> Option<&'a str> {
    token
        .strip_prefix(key)?
        .strip_prefix('-')
        .filter(|label| !label.is_empty())
}

/// The `key-value` label among a file name's `_`-separated parts.
fn name_label<'a>(file_name: &'a str, key: &str) -> Option<&'a str> {
    let stem = file_name.split('.').next().unwrap_or(file_name);
    stem.split('_').find_map(|token| label(token, key))
}

/// One path component with its subject, session and run labels replaced.
fn normalized(component: &str) -> String {
    let (stem, extension) = match component.find('.') {
        Some(dot) => component.split_at(dot),
        None => (component, ""),
    };
    let tokens: Vec<String> = stem
        .split('_')
        .map(|token| {
            if label(token, "sub").is_some() {
                "sub-*".to_string()
            } else if label(token, "ses").is_some() {
                "ses-*".to_string()
            } else if label(token, "run").is_some_and(|run| run.bytes().all(|b| b.is_ascii_digit()))
            {
                "run-*".to_string()
            } else {
                token.to_string()
            }
        })
        .collect();
    format!("{}{extension}", tokens.join("_"))
}

fn hidden_or_skipped(name: &str) -> bool {
    name.starts_with('.') || name == "sourcedata" || !crate::is_single_remote_name(name)
}

// ---- contents ----

struct WalkDir {
    path: PathBuf,
    depth: usize,
    subject: bool,
    /// Inside a subject folder: which folder that subject folder is a child
    /// of, as an index into [`Tally::levels`].
    level: Option<usize>,
    /// The normalized path below the subject folder, with a trailing `/`.
    kind_prefix: String,
}

/// Which subject folders the images of one kind sit in.
#[derive(Clone, Copy, PartialEq, Eq)]
enum KindLevel {
    /// In subject folders that are all children of one folder.
    One(usize),
    /// Not in a subject folder, or in subject folders of several folders.
    Unknown,
}

#[derive(Default)]
struct Tally {
    subjects: BTreeSet<String>,
    sessions: BTreeSet<String>,
    tasks: BTreeSet<String>,
    spaces: BTreeSet<String>,
    images: u32,
    group_images: u32,
    group_folder: bool,
    kinds: HashMap<String, (u32, KindLevel)>,
    /// Subject folders directly inside each folder that has any.
    levels: Vec<u32>,
    kinds_overflowed: bool,
    entries: usize,
    reasons: Vec<String>,
}

impl Tally {
    fn keep(set: &mut BTreeSet<String>, label: &str) {
        if set.len() < MAX_LABELS || set.contains(label) {
            set.insert(label.to_string());
        }
    }

    fn image(&mut self, dir: &WalkDir, name: &str) {
        self.images += 1;
        if let Some(task) = name_label(name, "task") {
            Self::keep(&mut self.tasks, task);
        }
        if let Some(space) = name_label(name, "space") {
            Self::keep(&mut self.spaces, space);
        }
        if let Some(session) = name_label(name, "ses") {
            self.sessions.insert(session.to_string());
        }
        let named_subject = name_label(name, "sub");
        if let (false, Some(subject)) = (dir.subject, named_subject) {
            self.subjects.insert(subject.to_string());
        }
        if !dir.subject && named_subject.is_none() {
            self.group_images += 1;
            return;
        }
        let kind = format!("{}{}", dir.kind_prefix, normalized(name));
        if self.kinds.len() >= MAX_TRACKED_KINDS && !self.kinds.contains_key(&kind) {
            self.kinds_overflowed = true;
            return;
        }
        let level = dir.level.map_or(KindLevel::Unknown, KindLevel::One);
        let (count, known) = self.kinds.entry(kind).or_insert((0, level));
        *count += 1;
        if *known != level {
            *known = KindLevel::Unknown;
        }
    }
}

pub(crate) struct Counted {
    pub contents: DatasetContents,
    /// The counts fell short for a reason that may not hold next time (the
    /// time budget, a folder that could not be read), so they are not kept.
    pub transient: bool,
}

/// Count what a folder holds. `root_entries` is its listing; `excluded` names
/// the root-level folders that are datasets of their own (its analyses), which
/// with `derivatives/` are not part of this one. A walk that meets a bound
/// reports `truncated` and counts that are floors. `notes` are reasons the
/// caller already has for the counts being floors.
pub(crate) async fn count_contents(
    fs: &CardFs,
    root: &Path,
    root_entries: Vec<Entry>,
    excluded: &HashSet<String>,
    caps: WalkCaps,
    notes: Vec<String>,
) -> Counted {
    let started = Instant::now();
    let mut tally = Tally {
        reasons: notes,
        ..Tally::default()
    };
    let mut timed_out = false;
    let mut linked = 0usize;
    let mut queue: VecDeque<WalkDir> = VecDeque::new();
    let mut listed_dirs = 1usize;
    let mut unreadable = 0usize;
    let mut too_deep = false;
    let mut pending = Some((
        vec![WalkDir {
            path: root.to_path_buf(),
            depth: 0,
            subject: false,
            level: None,
            kind_prefix: String::new(),
        }],
        vec![Ok(root_entries)],
    ));

    'walk: loop {
        let (dirs, listings) = match pending.take() {
            Some(batch) => batch,
            None => {
                if queue.is_empty() {
                    break;
                }
                let remaining = caps.budget.saturating_sub(started.elapsed());
                if remaining.is_zero() {
                    timed_out = true;
                    break;
                }
                let room = caps.max_dirs.saturating_sub(listed_dirs);
                if room == 0 {
                    tally
                        .reasons
                        .push(format!("it holds more than {} folders", caps.max_dirs));
                    break;
                }
                let take = LIST_BATCH.min(room).min(queue.len());
                let dirs: Vec<WalkDir> = queue.drain(..take).collect();
                listed_dirs += dirs.len();
                let paths: Vec<PathBuf> = dirs.iter().map(|dir| dir.path.clone()).collect();
                // One entry past the allowance is enough to see the bound
                // met; a batch still running when the budget ends is dropped,
                // which returns its permits.
                let allowance = caps.max_entries.saturating_sub(tally.entries) + 1;
                let listing = fs.list_many_within(&paths, allowance);
                let Ok(listings) = tokio::time::timeout(remaining, listing).await else {
                    timed_out = true;
                    break;
                };
                (dirs, listings)
            }
        };
        for (dir, listing) in dirs.into_iter().zip(listings) {
            let Ok(entries) = listing else {
                unreadable += 1;
                continue;
            };
            // The subject folders of this folder, counted as they are met.
            let mut level = None;
            for entry in entries {
                tally.entries += 1;
                if tally.entries > caps.max_entries {
                    tally
                        .reasons
                        .push(format!("it holds more than {} entries", caps.max_entries));
                    break 'walk;
                }
                if hidden_or_skipped(&entry.name) {
                    continue;
                }
                if entry.is_dir() {
                    if dir.depth == 0 {
                        if entry.name == "derivatives" || excluded.contains(&entry.name) {
                            continue;
                        }
                        if entry.name == "group" {
                            tally.group_folder = true;
                        }
                    }
                    let subject = (!dir.subject)
                        .then(|| label(&entry.name, "sub").filter(|l| !l.contains('_')))
                        .flatten();
                    if let Some(subject) = subject {
                        tally.subjects.insert(subject.to_string());
                        let index = *level.get_or_insert_with(|| {
                            tally.levels.push(0);
                            tally.levels.len() - 1
                        });
                        tally.levels[index] += 1;
                    }
                    if let Some(session) = label(&entry.name, "ses").filter(|l| !l.contains('_')) {
                        tally.sessions.insert(session.to_string());
                    }
                    if dir.depth >= caps.max_depth {
                        too_deep = true;
                        continue;
                    }
                    queue.push_back(WalkDir {
                        path: dir.path.join(&entry.name),
                        depth: dir.depth + 1,
                        subject: dir.subject || subject.is_some(),
                        level: if subject.is_some() { level } else { dir.level },
                        kind_prefix: match subject {
                            Some(_) => dir.kind_prefix.clone(),
                            None => format!("{}{}/", dir.kind_prefix, normalized(&entry.name)),
                        },
                    });
                } else if entry.is_fileish() && crate::is_remote_neuroimaging_path(&entry.name) {
                    tally.image(&dir, &entry.name);
                } else if entry.is_skipped_folder_link() {
                    linked += 1;
                }
            }
        }
    }

    if timed_out {
        tally.reasons.push(format!(
            "the folder took longer than {} s to read",
            caps.budget.as_secs()
        ));
    }
    if linked > 0 {
        tally
            .reasons
            .push(format!("{linked} linked folder(s) were not followed"));
    }
    if too_deep {
        tally.reasons.push(format!(
            "folders below {} levels were not read",
            caps.max_depth
        ));
    }
    if unreadable > 0 {
        tally
            .reasons
            .push(format!("{unreadable} folder(s) could not be read"));
    }
    if tally.kinds_overflowed {
        tally.reasons.push(format!(
            "it holds more than {MAX_TRACKED_KINDS} kinds of image"
        ));
    }
    let mut kinds: Vec<DatasetImageKind> = tally
        .kinds
        .into_iter()
        .map(|(path, (count, level))| DatasetImageKind {
            path,
            count,
            subject_folders: match level {
                KindLevel::One(index) => tally.levels.get(index).copied(),
                KindLevel::Unknown => None,
            },
        })
        .collect();
    kinds.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.path.cmp(&b.path)));
    let image_kind_count = kinds.len() as u32;
    kinds.truncate(MAX_IMAGE_KINDS);
    let contents = DatasetContents {
        subject_count: tally.subjects.len() as u32,
        session_count: tally.sessions.len() as u32,
        tasks: tally.tasks.into_iter().collect(),
        spaces: tally.spaces.into_iter().collect(),
        image_count: tally.images,
        has_group_level: tally.group_folder || tally.group_images > 0,
        group_image_count: tally.group_images,
        image_kinds: kinds,
        image_kind_count,
        truncated: !tally.reasons.is_empty(),
        truncated_reason: (!tally.reasons.is_empty())
            .then(|| format!("Counts are a minimum: {}.", tally.reasons.join("; "))),
    };
    Counted {
        contents,
        transient: timed_out || unreadable > 0,
    }
}

// ---- analyses ----

pub(crate) struct AnalysisChild {
    pub path: PathBuf,
    pub name: String,
    pub has_description: bool,
    pub subject_count: u32,
    /// `sub-*` links were not followed: the count is a floor.
    pub subject_links: bool,
    pub has_group_level: bool,
}

pub(crate) struct AnalysisScan {
    /// The folder whose children these are.
    pub parent: PathBuf,
    pub children: Vec<AnalysisChild>,
    /// More child folders exist than were looked at.
    pub truncated: bool,
    /// The child folders beyond the bound, which were not looked at.
    pub unexamined: Vec<String>,
    /// The analyses are direct children of the probed folder.
    pub direct: bool,
}

pub(crate) struct Scanned {
    /// `None` when no child folder looks like an analysis.
    pub scan: Option<AnalysisScan>,
    /// Child folders that could not be listed, so may be analyses unseen.
    pub unreadable: usize,
    /// Why `derivatives/` could not be listed, when it could not.
    pub derivatives_error: Option<String>,
    /// The scan ran out of time: child folders were left unexamined.
    pub timed_out: bool,
}

/// `work`, given up at `deadline` when there is one. A future given up is
/// dropped, which returns the permits of a remote mount.
async fn until<T>(
    deadline: Option<tokio::time::Instant>,
    work: impl Future<Output = T>,
) -> Option<T> {
    match deadline {
        Some(deadline) => tokio::time::timeout_at(deadline, work).await.ok(),
        None => Some(work.await),
    }
}

fn has_file(entries: &[Entry], name: &str) -> bool {
    entries
        .iter()
        .any(|entry| entry.name == name && entry.is_fileish())
}

fn is_subject_dir(entry: &Entry) -> bool {
    entry.is_dir() && label(&entry.name, "sub").is_some()
}

/// A `sub-*` link the probe did not follow: probably a subject folder.
fn is_subject_link(entry: &Entry) -> bool {
    entry.is_skipped_folder_link()
        && label(&entry.name, "sub").is_some_and(|label| !label.contains('_'))
}

/// The child folders that may be analyses, before any of them is looked at.
pub(crate) struct Candidates {
    /// The folder whose children these are.
    pub parent: PathBuf,
    /// At most the bound asked for, in natural order.
    pub names: Vec<String>,
    /// More child folders exist than `names` holds.
    pub truncated: bool,
    /// The child folders beyond the bound.
    pub unexamined: Vec<String>,
    /// They are direct children of the probed folder.
    pub direct: bool,
}

/// Where a folder's analyses would be: in `derivatives/` when it has one,
/// else among its own children unless it holds subjects itself, as real
/// folders or as links that were not followed. `Err` is why `derivatives/`
/// could not be listed.
pub(crate) async fn analysis_candidates(
    fs: &CardFs,
    folder: &Path,
    entries: &[Entry],
    max_children: usize,
) -> Result<Option<Candidates>, String> {
    let derivatives = entries
        .iter()
        .any(|entry| entry.name == "derivatives" && entry.is_dir());
    let (parent, candidates, direct) = if derivatives {
        let parent = folder.join("derivatives");
        let listed = fs.list(&parent).await?;
        (parent, listed, false)
    } else if entries
        .iter()
        .any(|entry| is_subject_dir(entry) || is_subject_link(entry))
    {
        return Ok(None);
    } else {
        (folder.to_path_buf(), entries.to_vec(), true)
    };
    let mut names: Vec<String> = candidates
        .into_iter()
        .filter(|entry| {
            entry.is_dir()
                && !hidden_or_skipped(&entry.name)
                && !matches!(entry.name.as_str(), "code" | "stimuli")
                && label(&entry.name, "sub").is_none()
                && label(&entry.name, "ses").is_none()
        })
        .map(|entry| entry.name)
        .collect();
    names.sort_by(|a, b| natural_cmp(a, b));
    let truncated = names.len() > max_children;
    let unexamined = names.split_off(max_children.min(names.len()));
    Ok(Some(Candidates {
        parent,
        names,
        truncated,
        unexamined,
        direct,
    }))
}

/// Child folders that look like analyses: each has its own description or
/// holds `sub-*` folders. They are looked for where [`analysis_candidates`]
/// says. One listing per child, at most `max_children` of them.
pub(crate) async fn scan_analyses(
    fs: &CardFs,
    folder: &Path,
    entries: &[Entry],
    max_children: usize,
) -> Scanned {
    scan_analyses_until(fs, folder, entries, max_children, None).await
}

/// [`scan_analyses`] that stops listing at `deadline`. The children not
/// reached by then are reported like those beyond the bound: unexamined.
pub(crate) async fn scan_analyses_until(
    fs: &CardFs,
    folder: &Path,
    entries: &[Entry],
    max_children: usize,
    deadline: Option<tokio::time::Instant>,
) -> Scanned {
    let mut scanned = Scanned {
        scan: None,
        unreadable: 0,
        derivatives_error: None,
        timed_out: false,
    };
    let candidates = analysis_candidates(fs, folder, entries, max_children);
    let Candidates {
        parent,
        names,
        mut truncated,
        mut unexamined,
        direct,
    } = match until(deadline, candidates).await {
        Some(Ok(Some(candidates))) => candidates,
        Some(Ok(None)) => return scanned,
        Some(Err(error)) => {
            scanned.derivatives_error = Some(error);
            return scanned;
        }
        None => {
            scanned.timed_out = true;
            return scanned;
        }
    };
    let paths: Vec<PathBuf> = names.iter().map(|name| parent.join(name)).collect();
    let mut children = Vec::new();
    for (index, batch) in paths.chunks(LIST_BATCH).enumerate() {
        let Some(listings) = until(deadline, fs.list_many(batch)).await else {
            scanned.timed_out = true;
            truncated = true;
            unexamined.splice(0..0, names[index * LIST_BATCH..].iter().cloned());
            break;
        };
        for (path, listing) in batch.iter().zip(listings) {
            let Ok(listing) = listing else {
                scanned.unreadable += 1;
                continue;
            };
            let has_description = has_file(&listing, DESCRIPTION);
            let subject_count = listing.iter().filter(|e| is_subject_dir(e)).count() as u32;
            let subject_links = listing.iter().any(is_subject_link);
            if !has_description && subject_count == 0 && !subject_links {
                continue;
            }
            children.push(AnalysisChild {
                name: path
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or_default(),
                path: path.clone(),
                has_description,
                subject_count,
                subject_links,
                has_group_level: listing.iter().any(|entry| {
                    (entry.is_dir() && entry.name == "group")
                        || (entry.is_fileish() && crate::is_remote_neuroimaging_path(&entry.name))
                }),
            });
        }
    }
    // Out of time with nothing found yet: the children left unexamined are
    // still kept apart from the folder's own contents.
    let found = !children.is_empty() || (scanned.timed_out && !unexamined.is_empty());
    scanned.scan = found.then_some(AnalysisScan {
        parent,
        children,
        truncated,
        unexamined,
        direct,
    });
    scanned
}

// ---- markers ----

/// A fingerprint of a listing: a folder whose names, kinds, sizes and times
/// are unchanged gives the same one.
fn stamp(entries: &[Entry]) -> u64 {
    let mut keyed: Vec<_> = entries
        .iter()
        .map(|entry| (&entry.name, entry.kind, entry.size, entry.modified))
        .collect();
    keyed.sort();
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    keyed.hash(&mut hasher);
    hasher.finish()
}

/// Where a folder is read from, the folder its reads are contained in, and
/// the folder.
type CacheKey = (String, Option<PathBuf>, PathBuf);

#[derive(Clone)]
struct CachedMarker {
    marker: DatasetMarker,
    stamp: u64,
    computed: Instant,
    checked: Instant,
}

struct CachedCard {
    card: DatasetCard,
    stamp: u64,
    computed: Instant,
}

/// Answers kept per (where, folder) and validated against the folder's listing.
#[derive(Default)]
pub(crate) struct DatasetCardCache {
    markers: Mutex<HashMap<CacheKey, CachedMarker>>,
    /// Whole cards.
    cards: Mutex<HashMap<CacheKey, CachedCard>>,
    /// Cards of the descriptions phase, for folders whose whole card is not
    /// known yet. A whole card answers both phases and replaces its outline.
    outlines: Mutex<HashMap<CacheKey, CachedCard>>,
    generations: Mutex<Generations>,
}

/// How many times each folder's card has been forgotten. A request notes its
/// folder's generation before it reads; an answer from before a refresh is
/// of an older generation and is not kept.
#[derive(Default)]
struct Generations {
    by_key: HashMap<CacheKey, u64>,
    /// The generation of every folder not in `by_key`.
    floor: u64,
    latest: u64,
}

fn cached_card(
    cards: &Mutex<HashMap<CacheKey, CachedCard>>,
    key: &CacheKey,
) -> Option<(DatasetCard, u64)> {
    let cards = cards.lock().unwrap_or_else(|e| e.into_inner());
    cards
        .get(key)
        .filter(|cached| cached.computed.elapsed() < CARD_TTL)
        .map(|cached| (cached.card.clone(), cached.stamp))
}

fn keep_cached_card(
    cards: &Mutex<HashMap<CacheKey, CachedCard>>,
    key: CacheKey,
    card: DatasetCard,
    stamp: u64,
) {
    let mut cards = cards.lock().unwrap_or_else(|e| e.into_inner());
    if cards.len() >= MAX_CACHED_CARDS && !cards.contains_key(&key) {
        let oldest = cards
            .iter()
            .min_by_key(|(_, cached)| cached.computed)
            .map(|(key, _)| key.clone());
        if let Some(oldest) = oldest {
            cards.remove(&oldest);
        }
    }
    cards.insert(
        key,
        CachedCard {
            card,
            stamp,
            computed: Instant::now(),
        },
    );
}

impl DatasetCardCache {
    fn marker(&self, key: &CacheKey) -> Option<CachedMarker> {
        let markers = self.markers.lock().unwrap_or_else(|e| e.into_inner());
        markers
            .get(key)
            .filter(|cached| cached.computed.elapsed() < MARKER_TTL)
            .cloned()
    }

    fn keep_marker(&self, key: CacheKey, cached: CachedMarker) {
        let mut markers = self.markers.lock().unwrap_or_else(|e| e.into_inner());
        if markers.len() >= MAX_CACHED_MARKERS && !markers.contains_key(&key) {
            markers.retain(|_, cached| cached.computed.elapsed() < MARKER_TTL);
            if markers.len() >= MAX_CACHED_MARKERS {
                markers.clear();
            }
        }
        markers.insert(key, cached);
    }

    /// The whole card of a folder.
    fn card(&self, key: &CacheKey) -> Option<(DatasetCard, u64)> {
        cached_card(&self.cards, key)
    }

    /// The descriptions-phase card of a folder whose whole card is not kept.
    fn outline(&self, key: &CacheKey) -> Option<(DatasetCard, u64)> {
        cached_card(&self.outlines, key)
    }

    /// The generation of a folder's card, to be noted before reading it.
    fn generation(&self, key: &CacheKey) -> u64 {
        let generations = self.generations.lock().unwrap_or_else(|e| e.into_inner());
        generations
            .by_key
            .get(key)
            .copied()
            .unwrap_or(generations.floor)
    }

    /// Keep a card read at `generation`, unless the folder was refreshed
    /// since: then the card is from before the refresh. Returns whether it
    /// was kept. The generation lock is held across the insert, so a refresh
    /// either precedes the check or removes what is inserted.
    fn keep_card(&self, key: CacheKey, generation: u64, card: DatasetCard, stamp: u64) -> bool {
        let generations = self.generations.lock().unwrap_or_else(|e| e.into_inner());
        let current = generations
            .by_key
            .get(&key)
            .copied()
            .unwrap_or(generations.floor);
        if current != generation {
            return false;
        }
        match card.phase {
            DatasetCardPhase::Descriptions => keep_cached_card(&self.outlines, key, card, stamp),
            DatasetCardPhase::Full => {
                self.outlines
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .remove(&key);
                keep_cached_card(&self.cards, key, card, stamp);
            }
        }
        true
    }

    /// Drop both phases of a folder's card: a refresh reads everything
    /// again, and a read that began before it keeps nothing.
    fn forget_card(&self, key: &CacheKey) {
        let mut generations = self.generations.lock().unwrap_or_else(|e| e.into_inner());
        generations.latest += 1;
        let latest = generations.latest;
        if generations.by_key.len() >= MAX_TRACKED_GENERATIONS {
            // Every folder moves to the newest generation: reads in flight
            // keep nothing, which costs one more read each.
            generations.by_key.clear();
            generations.floor = latest;
        }
        generations.by_key.insert(key.clone(), latest);
        for cards in [&self.cards, &self.outlines] {
            cards.lock().unwrap_or_else(|e| e.into_inner()).remove(key);
        }
    }
}

struct MarkerProbe {
    marker: DatasetMarker,
    /// The folder's listing fingerprint; `None` when it could not be listed.
    stamp: Option<u64>,
    /// The cached answer was still right, so nothing below the folder was read.
    reused: bool,
    /// Something could not be read this time: the answer is not kept.
    transient: bool,
}

fn no_marker(asked: &str) -> DatasetMarker {
    DatasetMarker {
        path: asked.to_string(),
        has_description: false,
        analysis_count: None,
        analysis_count_truncated: false,
        summary: None,
        issue: None,
    }
}

fn add_issue(slot: &mut Option<String>, issue: String) {
    *slot = Some(match slot.take() {
        Some(earlier) => format!("{earlier}; {issue}"),
        None => issue,
    });
}

/// Whether a marker probe lists a folder's children to count analyses. On a
/// remote mount every listing is a round trip under the mount's few permits,
/// so only a folder that announces derivatives is looked into; elsewhere the
/// card itself still finds the analyses.
fn marker_counts_analyses(remote: bool, folder: &Path, entries: &[Entry]) -> bool {
    !remote
        || folder.file_name().is_some_and(|name| name == "derivatives")
        || entries
            .iter()
            .any(|entry| entry.name == "derivatives" && entry.is_dir())
}

async fn probe_marker(
    fs: &CardFs,
    folder: &Path,
    contain: &Path,
    asked: &str,
    cached: Option<(DatasetMarker, u64)>,
) -> MarkerProbe {
    let mut marker = no_marker(asked);
    let entries = match fs.list(folder).await {
        Ok(entries) => entries,
        Err(error) => {
            marker.issue = Some(format!("This folder could not be read: {error}"));
            return MarkerProbe {
                marker,
                stamp: None,
                reused: false,
                transient: true,
            };
        }
    };
    let stamp = stamp(&entries);
    if let Some((marker, _)) = cached.filter(|(_, cached_stamp)| *cached_stamp == stamp) {
        return MarkerProbe {
            marker,
            stamp: Some(stamp),
            reused: true,
            transient: false,
        };
    }
    let mut transient = false;
    marker.has_description = has_file(&entries, DESCRIPTION);
    if marker.has_description {
        match fs
            .read(&folder.join(DESCRIPTION), MAX_DESCRIPTION_BYTES, contain)
            .await
        {
            Ok((bytes, longer)) => {
                let parsed = parse_description(&bytes, longer);
                marker.summary = parsed.description.as_ref().map(marker_summary);
                marker.issue = parsed.issue.map(|issue| format!("{DESCRIPTION}: {issue}"));
            }
            Err(error) => {
                transient = true;
                marker.issue = Some(format!("{DESCRIPTION} could not be read: {error}"));
            }
        }
    }
    if marker_counts_analyses(fs.remote().is_some(), folder, &entries) {
        let scanned = scan_analyses(fs, folder, &entries, MARKER_ANALYSIS_CHILDREN).await;
        transient |= scanned.unreadable > 0;
        if let Some(error) = scanned.derivatives_error {
            transient = true;
            add_issue(
                &mut marker.issue,
                format!("derivatives could not be read: {error}"),
            );
        }
        if let Some(scan) = scanned.scan {
            marker.analysis_count = Some(scan.children.len() as u32);
            marker.analysis_count_truncated = scan.truncated || scanned.unreadable > 0;
        }
    }
    MarkerProbe {
        marker,
        stamp: Some(stamp),
        reused: false,
        transient,
    }
}

/// How the probe of one folder ended.
enum Probed {
    Done(MarkerProbe),
    /// The batch's time ran out before or while this folder was read.
    Late,
    /// A local folder that resolves outside the browse root.
    Refused,
}

pub(crate) async fn markers_impl(
    state: &BridgeState,
    paths: Vec<String>,
    root_path: Option<String>,
) -> BridgeResult<Vec<DatasetMarker>> {
    markers_within(state, paths, root_path, MARKER_BUDGET).await
}

/// [`markers_impl`] with its time budget named. One answer per path: a path
/// that is not acceptable, or is not reached within `budget`, gets an answer
/// that says nothing (or the last one known) and that is not kept.
pub(crate) async fn markers_within(
    state: &BridgeState,
    paths: Vec<String>,
    root_path: Option<String>,
    budget: Duration,
) -> BridgeResult<Vec<DatasetMarker>> {
    if paths.len() > MAX_MARKER_PATHS {
        return Err(input(
            8264,
            format!(
                "At most {MAX_MARKER_PATHS} folders can be probed at once; {} were asked for.",
                paths.len()
            ),
        ));
    }
    let cache = &state.dataset_cards;
    let mut answers: Vec<Option<DatasetMarker>> = paths.iter().map(|_| None).collect();
    let mut jobs = Vec::new();
    for (index, asked) in paths.iter().enumerate() {
        let (scope, folder) = match resolve_scope(state, asked, root_path.as_deref()).await {
            Ok(resolved) => resolved,
            // A path that is not acceptable has no marker; the others do.
            Err(BridgeError::Input {
                code: 8260 | 8261, ..
            }) => {
                answers[index] = Some(no_marker(asked));
                continue;
            }
            // A mount that is not connected fails every path under it.
            Err(error) => return Err(error),
        };
        let key = scope.key(&folder);
        let cached = cache.marker(&key);
        if let Some(cached) = cached
            .as_ref()
            .filter(|cached| cached.checked.elapsed() < MARKER_FRESH)
        {
            answers[index] = Some(DatasetMarker {
                path: asked.clone(),
                ..cached.marker.clone()
            });
            continue;
        }
        jobs.push((index, asked.clone(), scope, folder, key, cached));
    }
    if jobs.is_empty() {
        return Ok(answers.into_iter().flatten().collect());
    }
    log::debug!("Probing dataset markers for {} folder(s)", jobs.len());

    let work: Vec<_> = jobs
        .iter()
        .map(|(_, asked, scope, folder, _, cached)| {
            (
                asked.clone(),
                scope.clone(),
                folder.clone(),
                cached.as_ref().map(|c| (c.marker.clone(), c.stamp)),
            )
        })
        .collect();
    let probes = owned(move || {
        Box::pin(async move {
            let deadline = tokio::time::Instant::now() + budget;
            futures::stream::iter(work)
                .map(|(asked, scope, folder, cached)| async move {
                    if tokio::time::Instant::now() >= deadline {
                        return Probed::Late;
                    }
                    if scope.fs.admit(&folder, scope.bound.as_deref()).is_err() {
                        return Probed::Refused;
                    }
                    let contain = scope.bound.clone().unwrap_or_else(|| folder.clone());
                    let probe = probe_marker(&scope.fs, &folder, &contain, &asked, cached);
                    // A probe cut short is dropped, which returns its permits.
                    match tokio::time::timeout_at(deadline, probe).await {
                        Ok(probe) => Probed::Done(probe),
                        Err(_) => Probed::Late,
                    }
                })
                .buffered(crate::REMOTE_MOUNT_MAX_CONCURRENT_OPS)
                .collect::<Vec<Probed>>()
                .await
        })
    })
    .await?;

    for ((index, asked, scope, folder, key, cached), probed) in jobs.into_iter().zip(probes) {
        ensure_current(state, &scope, &folder).await?;
        let probe = match probed {
            Probed::Done(probe) => probe,
            // Not reached in time: what was known stands, and nothing is
            // kept, so the folder is read when it is next asked about.
            Probed::Late => {
                answers[index] = Some(match cached {
                    Some(cached) => DatasetMarker {
                        path: asked,
                        ..cached.marker
                    },
                    None => no_marker(&asked),
                });
                continue;
            }
            Probed::Refused => {
                answers[index] = Some(no_marker(&asked));
                continue;
            }
        };
        let mut marker = probe.marker;
        marker.path = asked;
        if let Some(stamp) = probe.stamp.filter(|_| !probe.transient) {
            let now = Instant::now();
            cache.keep_marker(
                key,
                CachedMarker {
                    marker: marker.clone(),
                    stamp,
                    // A reused answer keeps its age, so it is recomputed in time.
                    computed: match (probe.reused, cached) {
                        (true, Some(cached)) => cached.computed,
                        _ => now,
                    },
                    checked: now,
                },
            );
        }
        answers[index] = Some(marker);
    }
    Ok(answers.into_iter().flatten().collect())
}

// ---- dataset card ----

fn readme_entry(entries: &[Entry]) -> Option<&Entry> {
    README_NAMES.iter().find_map(|wanted| {
        entries
            .iter()
            .filter(|entry| entry.is_fileish())
            .find(|entry| entry.name == *wanted)
            .or_else(|| {
                entries
                    .iter()
                    .filter(|entry| entry.is_fileish())
                    .find(|entry| entry.name.eq_ignore_ascii_case(wanted))
            })
    })
}

pub(crate) struct BuiltCard {
    pub card: DatasetCard,
    /// Part of the card could not be read or ran out of time. Such a card is
    /// returned but not kept, so the next request reads the folder again.
    pub transient: bool,
}

fn empty_card(folder: &Path, entries: &[Entry], phase: DatasetCardPhase) -> DatasetCard {
    DatasetCard {
        phase,
        path: shown(folder),
        folder_name: folder
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| shown(folder)),
        has_description: has_file(entries, DESCRIPTION),
        description: None,
        description_issue: None,
        description_path: None,
        description_raw: None,
        description_raw_truncated: false,
        readme: None,
        contents: DatasetContents::default(),
        analyses: Vec::new(),
        analyses_path: None,
        analyses_truncated: false,
        source_paths: Vec::new(),
    }
}

/// Read the folder's own description and README into `card`. Returns whether
/// either could not be read this time.
async fn read_own_files(
    fs: &CardFs,
    folder: &Path,
    contain: &Path,
    entries: &[Entry],
    card: &mut DatasetCard,
) -> bool {
    let mut transient = false;
    if card.has_description {
        let path = folder.join(DESCRIPTION);
        card.description_path = Some(shown(&path));
        match fs.read(&path, MAX_DESCRIPTION_BYTES, contain).await {
            Ok((bytes, longer)) => {
                let parsed = parse_description(&bytes, longer);
                card.description = parsed.description;
                card.description_issue = parsed.issue;
                let text = String::from_utf8_lossy(&bytes);
                let mut end = text.len().min(MAX_RAW_BYTES);
                while !text.is_char_boundary(end) {
                    end -= 1;
                }
                card.description_raw_truncated = longer || end < text.len();
                card.description_raw = Some(text[..end].to_string());
                card.source_paths.push(shown(&path));
            }
            Err(error) => {
                transient = true;
                card.description_issue = Some(format!("The description could not be read: {error}"))
            }
        }
    }

    if let Some(entry) = readme_entry(entries) {
        let path = folder.join(&entry.name);
        match fs.read(&path, MAX_README_BYTES, contain).await {
            Ok((bytes, truncated)) => {
                card.readme = Some(DatasetReadme {
                    file_name: entry.name.clone(),
                    path: shown(&path),
                    text: String::from_utf8_lossy(&bytes).into_owned(),
                    truncated,
                });
                card.source_paths.push(shown(&path));
            }
            // The card has no field for a README that could not be read, so
            // the reason joins what is said about the description.
            Err(error) => {
                transient = true;
                add_issue(
                    &mut card.description_issue,
                    format!("{} could not be read: {error}", entry.name),
                );
            }
        }
    }
    transient
}

/// What a child's description says, on its row of the analyses table.
fn describe_analysis(analysis: &mut DatasetAnalysis, bytes: &[u8], longer: bool) {
    let parsed = parse_description(bytes, longer);
    if let Some(description) = &parsed.description {
        analysis.title = description.name.clone();
        analysis.generated_by = pipeline_ref(description);
        analysis.date = declared_date(description);
    }
    analysis.issue = parsed.issue;
}

/// The descriptions phase of a card: the folder's own description and README,
/// and the description of every child folder that has one. Each child's
/// description is asked for by name, without listing the child, so a folder
/// of analyses costs one read per child and no walk. Nothing is counted.
pub(crate) async fn build_outline(
    fs: &CardFs,
    folder: &Path,
    contain: &Path,
    entries: &[Entry],
) -> BuiltCard {
    build_outline_within(fs, folder, contain, entries, CARD_READ_BUDGET).await
}

fn out_of_time(budget: Duration) -> String {
    format!(
        "reading took longer than {} s and was stopped; what was read by then is shown",
        budget.as_secs()
    )
}

/// [`build_outline`] with its time budget named. A phase that runs out of
/// time returns what it read, says so, and is not kept.
pub(crate) async fn build_outline_within(
    fs: &CardFs,
    folder: &Path,
    contain: &Path,
    entries: &[Entry],
    budget: Duration,
) -> BuiltCard {
    let deadline = Some(tokio::time::Instant::now() + budget);
    let mut card = empty_card(folder, entries, DatasetCardPhase::Descriptions);
    let own = until(
        deadline,
        read_own_files(fs, folder, contain, entries, &mut card),
    )
    .await;
    let mut timed_out = own.is_none();
    let mut transient = own.unwrap_or(true);
    let candidates = match timed_out {
        true => None,
        false => {
            until(
                deadline,
                analysis_candidates(fs, folder, entries, CARD_ANALYSIS_CHILDREN),
            )
            .await
        }
    };
    match candidates {
        None => timed_out = true,
        Some(Err(_)) => {
            // The full card says why; here the table is only known to be short.
            transient = true;
            card.analyses_path = Some(shown(&folder.join("derivatives")));
            card.analyses_truncated = true;
        }
        Some(Ok(None)) => {}
        Some(Ok(Some(candidates))) => {
            let paths: Vec<PathBuf> = candidates
                .names
                .iter()
                .map(|name| candidates.parent.join(name).join(DESCRIPTION))
                .collect();
            let mut read = Vec::with_capacity(paths.len());
            for batch in paths.chunks(LIST_BATCH) {
                let batch = fs.read_many_optional(batch, MAX_DESCRIPTION_BYTES, contain);
                match until(deadline, batch).await {
                    Some(batch) => read.extend(batch),
                    None => {
                        timed_out = true;
                        break;
                    }
                }
            }
            // The children not reached in time are missing from the table.
            let short = read.len() < paths.len();
            for ((name, path), result) in candidates.names.iter().zip(&paths).zip(read) {
                let (bytes, longer) = match result {
                    Ok(Some(read)) => read,
                    // No description: the full card lists the child if it
                    // holds subjects.
                    Ok(None) => continue,
                    // A description that may be there and was not read this
                    // time. The full card says so on the child's row; this
                    // outline is short, and must not stand for the folder.
                    Err(_) => {
                        transient = true;
                        continue;
                    }
                };
                let mut analysis = DatasetAnalysis {
                    path: shown(&candidates.parent.join(name)),
                    folder_name: name.clone(),
                    title: None,
                    generated_by: None,
                    subject_count: 0,
                    subject_count_truncated: false,
                    has_group_level: false,
                    has_description: true,
                    issue: None,
                    date: None,
                };
                describe_analysis(&mut analysis, &bytes, longer);
                card.analyses.push(analysis);
                card.source_paths.push(shown(path));
            }
            if !card.analyses.is_empty() || short {
                card.analyses_path = Some(shown(&candidates.parent));
                card.analyses_truncated = candidates.truncated || short;
            }
        }
    }
    if timed_out {
        transient = true;
        add_issue(&mut card.description_issue, out_of_time(budget));
    }
    BuiltCard { card, transient }
}

/// Build the card of `folder` from its listing, in one go. `contain` bounds
/// local reads.
#[cfg(test)]
pub(crate) async fn build_card(
    fs: &CardFs,
    folder: &Path,
    contain: &Path,
    entries: Vec<Entry>,
    caps: WalkCaps,
) -> BuiltCard {
    build_card_after(fs, folder, contain, entries, caps, None).await
}

/// Build the whole card of `folder` from its listing. `contain` bounds local
/// reads. With `outline`, the descriptions phase of the same listing, what
/// that phase read is not read again.
pub(crate) async fn build_card_after(
    fs: &CardFs,
    folder: &Path,
    contain: &Path,
    entries: Vec<Entry>,
    caps: WalkCaps,
    outline: Option<DatasetCard>,
) -> BuiltCard {
    let mut transient = false;
    let deadline = Some(tokio::time::Instant::now() + caps.read_budget);
    let mut timed_out = false;
    let mut card = empty_card(folder, &entries, DatasetCardPhase::Full);
    let mut described_before: HashMap<String, DatasetAnalysis> = HashMap::new();
    match outline {
        Some(outline) => {
            let own: Vec<&String> = outline
                .description_path
                .iter()
                .chain(outline.readme.iter().map(|readme| &readme.path))
                .collect();
            card.source_paths = outline
                .source_paths
                .iter()
                .filter(|path| own.contains(path))
                .cloned()
                .collect();
            card.description = outline.description;
            card.description_issue = outline.description_issue;
            card.description_path = outline.description_path;
            card.description_raw = outline.description_raw;
            card.description_raw_truncated = outline.description_raw_truncated;
            card.readme = outline.readme;
            described_before = outline
                .analyses
                .into_iter()
                .map(|analysis| (analysis.path.clone(), analysis))
                .collect();
        }
        None => {
            let own = read_own_files(fs, folder, contain, &entries, &mut card);
            match until(deadline, own).await {
                Some(unread) => transient = unread,
                None => {
                    timed_out = true;
                    add_issue(&mut card.description_issue, out_of_time(caps.read_budget));
                }
            }
        }
    }

    let mut excluded = HashSet::new();
    let mut notes = Vec::new();
    let scanned = scan_analyses_until(fs, folder, &entries, CARD_ANALYSIS_CHILDREN, deadline).await;
    transient |= scanned.unreadable > 0;
    timed_out |= scanned.timed_out;
    if let Some(error) = scanned.derivatives_error {
        transient = true;
        card.analyses_path = Some(shown(&folder.join("derivatives")));
        card.analyses_truncated = true;
        notes.push(format!("derivatives could not be read ({error})"));
    }
    if let Some(scan) = scanned.scan {
        card.analyses_path = Some(shown(&scan.parent));
        card.analyses_truncated = scan.truncated || scanned.unreadable > 0;
        // Folders past the bound, or not reached in time, may be analyses
        // too. They are not counted as this folder's own contents, and the
        // counts say so.
        if scan.direct && !scan.unexamined.is_empty() {
            notes.push(if scanned.timed_out {
                format!("{} folder(s) were not examined", scan.unexamined.len())
            } else {
                format!(
                    "{} folder(s) beyond the first {CARD_ANALYSIS_CHILDREN} were not examined",
                    scan.unexamined.len()
                )
            });
            excluded.extend(scan.unexamined.iter().cloned());
        }
        let described: Vec<PathBuf> = scan
            .children
            .iter()
            .filter(|child| {
                child.has_description && !described_before.contains_key(&shown(&child.path))
            })
            .map(|child| child.path.join(DESCRIPTION))
            .collect();
        let mut read = Vec::with_capacity(described.len());
        for batch in described.chunks(LIST_BATCH) {
            let batch = fs.read_many(batch, MAX_DESCRIPTION_BYTES, contain);
            match until(deadline, batch).await {
                Some(batch) => read.extend(batch),
                None => {
                    timed_out = true;
                    break;
                }
            }
        }
        let mut read = read.into_iter();
        for child in scan.children {
            if scan.direct {
                excluded.insert(child.name.clone());
            }
            let mut analysis = DatasetAnalysis {
                path: shown(&child.path),
                folder_name: child.name,
                title: None,
                generated_by: None,
                subject_count: child.subject_count,
                subject_count_truncated: child.subject_links,
                has_group_level: child.has_group_level,
                has_description: child.has_description,
                issue: None,
                date: None,
            };
            if child.has_description {
                let source = shown(&child.path.join(DESCRIPTION));
                if let Some(before) = described_before.remove(&analysis.path) {
                    analysis.title = before.title;
                    analysis.generated_by = before.generated_by;
                    analysis.issue = before.issue;
                    analysis.date = before.date;
                    card.source_paths.push(source);
                } else {
                    match read.next() {
                        Some(Ok((bytes, longer))) => {
                            describe_analysis(&mut analysis, &bytes, longer);
                            card.source_paths.push(source);
                        }
                        Some(Err(error)) => {
                            transient = true;
                            analysis.issue = Some(format!("could not be read: {error}"))
                        }
                        // Not reached before the time ran out.
                        None => analysis.issue = Some("was not read in time".to_string()),
                    }
                }
            }
            card.analyses.push(analysis);
        }
    }
    if timed_out {
        transient = true;
        notes.push(format!(
            "its analyses and descriptions took longer than {} s to read",
            caps.read_budget.as_secs()
        ));
    }

    let counted = count_contents(fs, folder, entries, &excluded, caps, notes).await;
    card.contents = counted.contents;
    BuiltCard {
        card,
        transient: transient || counted.transient,
    }
}

/// The whole card, asked for alone.
#[cfg(test)]
pub(crate) async fn card_impl(
    state: &BridgeState,
    path: String,
    root_path: Option<String>,
    refresh: bool,
) -> BridgeResult<DatasetCard> {
    card_phase_impl(state, path, root_path, refresh, DatasetCardPhase::Full).await
}

/// One phase of a folder's card. A whole card that is still right answers
/// either phase; the full phase continues from the descriptions phase of the
/// same listing instead of reading the descriptions again. `refresh` forgets
/// both, so it is asked for with the first phase of a reload only.
pub(crate) async fn card_phase_impl(
    state: &BridgeState,
    path: String,
    root_path: Option<String>,
    refresh: bool,
    phase: DatasetCardPhase,
) -> BridgeResult<DatasetCard> {
    let (scope, folder) = resolve_scope(state, &path, root_path.as_deref()).await?;
    card_phase_in(state, scope, folder, refresh, phase).await
}

/// [`card_phase_impl`] once it is decided where the folder is read.
pub(crate) async fn card_phase_in(
    state: &BridgeState,
    scope: Scope,
    folder: PathBuf,
    refresh: bool,
    phase: DatasetCardPhase,
) -> BridgeResult<DatasetCard> {
    log::debug!(
        "Building the dataset card of {} ({phase:?})",
        folder.display()
    );
    let key = scope.key(&folder);
    if refresh {
        state.dataset_cards.forget_card(&key);
    }
    // Noted before any I/O: a refresh that arrives while this request reads
    // voids what it would keep.
    let generation = state.dataset_cards.generation(&key);
    let whole = state.dataset_cards.card(&key);
    let outline = state.dataset_cards.outline(&key);
    let worker_scope = scope.clone();
    let worker_folder = folder.clone();
    let outcome = owned(move || {
        Box::pin(async move {
            let fs = &worker_scope.fs;
            fs.admit(&worker_folder, worker_scope.bound.as_deref())
                .map_err(|outside| input(8261, outside))?;
            let entries = fs.list(&worker_folder).await.map_err(|error| {
                io(
                    8263,
                    format!("'{}' could not be read: {error}", worker_folder.display()),
                )
            })?;
            let stamp = stamp(&entries);
            if let Some((card, _)) = whole.filter(|(_, cached_stamp)| *cached_stamp == stamp) {
                return Ok((card, stamp, false));
            }
            let outline = outline
                .filter(|(_, cached_stamp)| *cached_stamp == stamp)
                .map(|(card, _)| card);
            let contain = worker_scope
                .bound
                .clone()
                .unwrap_or_else(|| worker_folder.clone());
            let built = match (phase, outline) {
                (DatasetCardPhase::Descriptions, Some(card)) => return Ok((card, stamp, false)),
                (DatasetCardPhase::Descriptions, None) => {
                    build_outline(fs, &worker_folder, &contain, &entries).await
                }
                (DatasetCardPhase::Full, outline) => {
                    let caps = WalkCaps::default();
                    build_card_after(fs, &worker_folder, &contain, entries, caps, outline).await
                }
            };
            Ok::<_, BridgeError>((built.card, stamp, !built.transient))
        })
    })
    .await?;
    ensure_current(state, &scope, &folder).await?;
    let (card, stamp, keep) = outcome?;
    if keep {
        state
            .dataset_cards
            .keep_card(key, generation, card.clone(), stamp);
    }
    Ok(card)
}

// ---- sidecar card ----

/// The `.json` names that are a file's own sidecar.
pub(crate) fn own_sidecar_names(file_name: &str) -> Vec<String> {
    const GIFTI_KINDS: [&str; 10] = [
        ".func", ".surf", ".shape", ".label", ".coord", ".time", ".rgba", ".tensor", ".topo",
        ".vector",
    ];
    let mut names = Vec::new();
    let lower = file_name.to_ascii_lowercase();
    let stem_len = [".nii.gz", ".tsv.gz", ".nii", ".gii", ".mgz", ".tsv"]
        .iter()
        .find(|ending| lower.ends_with(*ending))
        .map(|ending| file_name.len() - ending.len())
        .or_else(|| file_name.rfind('.').filter(|dot| *dot > 0));
    let Some(stem_len) = stem_len else {
        return vec![format!("{file_name}.json")];
    };
    let stem = &file_name[..stem_len];
    names.push(format!("{stem}.json"));
    if lower.ends_with(".gii") {
        if let Some(kind) = GIFTI_KINDS
            .iter()
            .find(|kind| stem.to_ascii_lowercase().ends_with(*kind))
        {
            names.push(format!("{}.json", &stem[..stem.len() - kind.len()]));
        }
    }
    names
}

/// A sidecar that applies to the file, before it is read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Applicable {
    pub path: PathBuf,
    pub level: SidecarLevel,
}

fn level_of(dir: &Path, dataset_root: Option<&Path>) -> SidecarLevel {
    if dataset_root == Some(dir) {
        return SidecarLevel::Dataset;
    }
    let name = dir
        .file_name()
        .map(|name| name.to_string_lossy())
        .unwrap_or_default();
    if label(&name, "sub").is_some_and(|l| !l.contains('_')) {
        SidecarLevel::Subject
    } else if label(&name, "ses").is_some_and(|l| !l.contains('_')) {
        SidecarLevel::Session
    } else {
        SidecarLevel::Directory
    }
}

/// The sidecars that apply to `file_name`, farthest first, by the BIDS
/// inheritance principle: in each folder from the root down to the file's
/// own, a `.json` applies if its suffix is the file's and its entities are a
/// subset of the file's (`bids_rs::metadata::candidate_applies`); in one
/// folder the more specific one comes later. A file whose name is not
/// entities and a suffix takes only its own same-named `.json`.
///
/// `chain` is the folders from the root down to the file's, each with the
/// names of the `.json` files in it.
pub(crate) fn applicable_sidecars(
    file_name: &str,
    chain: &[(PathBuf, Vec<String>)],
    dataset_root: Option<&Path>,
) -> (Vec<Applicable>, bool) {
    let own = own_sidecar_names(file_name);
    let parsed = parse_name(file_name);
    let entities: Option<(HashMap<String, String>, &str)> = parsed.as_ref().map(|name| {
        (
            name.entities
                .iter()
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect(),
            name.suffix.as_str(),
        )
    });
    let last = chain.len().saturating_sub(1);
    let mut applicable = Vec::new();
    for (index, (dir, names)) in chain.iter().enumerate() {
        let mut here: Vec<(usize, &String, SidecarLevel)> = Vec::new();
        for name in names {
            if !name.ends_with(".json") || name == DESCRIPTION || name == "participants.json" {
                continue;
            }
            if index == last && own.contains(name) {
                here.push((usize::MAX, name, SidecarLevel::File));
            } else if let Some((entities, suffix)) = &entities {
                if let Some(count) = bids_rs::metadata::candidate_applies(name, entities, suffix) {
                    here.push((count, name, level_of(dir, dataset_root)));
                }
            }
        }
        here.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(b.1)));
        applicable.extend(here.into_iter().map(|(_, name, level)| Applicable {
            path: dir.join(name),
            level,
        }));
    }
    let truncated = applicable.len() > MAX_SIDECAR_FILES;
    if truncated {
        applicable.drain(..applicable.len() - MAX_SIDECAR_FILES);
    }
    (applicable, truncated)
}

/// Merge parsed sidecars, farthest first: a nearer one overrides a farther.
/// At most [`MAX_SIDECAR_ENTRIES`] are returned, the first by key, with the
/// number left out.
pub(crate) fn merge_sidecars(
    sidecars: Vec<(Applicable, Vec<(String, Value)>)>,
) -> (Vec<SidecarEntry>, usize) {
    let mut merged: BTreeMap<String, SidecarEntry> = BTreeMap::new();
    for (sidecar, entries) in sidecars {
        let source_path = shown(&sidecar.path);
        for (key, value) in entries {
            let (value, value_truncated) = compact(&value);
            let mut overridden_paths = match merged.remove(&key) {
                Some(mut farther) => {
                    farther.overridden_paths.push(farther.source_path);
                    farther.overridden_paths
                }
                None => Vec::new(),
            };
            overridden_paths.retain(|path| *path != source_path);
            merged.insert(
                key.clone(),
                SidecarEntry {
                    key,
                    value,
                    value_truncated,
                    source_level: sidecar.level,
                    source_path: source_path.clone(),
                    overridden_paths,
                },
            );
        }
    }
    let omitted = merged.len().saturating_sub(MAX_SIDECAR_ENTRIES);
    (
        merged.into_values().take(MAX_SIDECAR_ENTRIES).collect(),
        omitted,
    )
}

fn json_names(entries: &[Entry]) -> Vec<String> {
    entries
        .iter()
        .filter(|entry| entry.is_fileish() && entry.name.ends_with(".json"))
        .map(|entry| entry.name.clone())
        .collect()
}

pub(crate) async fn build_sidecar_card(
    fs: &CardFs,
    file: &Path,
    bound: Option<&Path>,
) -> Result<SidecarCard, String> {
    let file_name = file
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .ok_or("the path names no file")?;
    let parent = file.parent().ok_or("the path names no file")?;

    // Walk up to the nearest dataset root, keeping each folder's sidecars.
    let mut chain: Vec<(PathBuf, Vec<String>)> = Vec::new();
    let mut dataset_root = None;
    let limit = if bound.is_some() {
        MAX_ANCESTORS
    } else {
        MAX_UNBOUNDED_ANCESTORS
    };
    let mut dir = parent.to_path_buf();
    for level in 0..limit {
        // A folder reached through a link out of the browse root is not
        // listed, whichever level of the path the link is at.
        let entries = match fs.admit(&dir, bound) {
            Ok(()) => fs.list(&dir).await,
            Err(outside) => Err(outside),
        };
        let entries = match entries {
            Ok(entries) => entries,
            Err(error) if level == 0 => return Err(error),
            Err(_) => break,
        };
        if level == 0 && !has_file(&entries, &file_name) {
            return Err("the file is not in its folder".to_string());
        }
        let is_root = has_file(&entries, DESCRIPTION);
        chain.push((dir.clone(), json_names(&entries)));
        if is_root {
            dataset_root = Some(dir.clone());
            break;
        }
        if bound == Some(dir.as_path()) {
            break;
        }
        match dir.parent() {
            Some(up) if bound.is_none_or(|bound| up.starts_with(bound)) => dir = up.to_path_buf(),
            _ => break,
        }
    }
    // With neither a dataset root nor a browse root to stop at, nothing above
    // the file's own folder is known to belong with it.
    if dataset_root.is_none() && bound.is_none() {
        chain.truncate(1);
    }
    chain.reverse();
    let contain = dataset_root
        .as_deref()
        .or(bound)
        .unwrap_or(parent)
        .to_path_buf();

    let (applicable, truncated) = applicable_sidecars(&file_name, &chain, dataset_root.as_deref());
    let paths: Vec<PathBuf> = applicable.iter().map(|a| a.path.clone()).collect();
    let nifti = crate::is_remote_nifti_path(&file_name);
    let (read, header) = futures::join!(fs.read_many(&paths, MAX_SIDECAR_BYTES, &contain), async {
        if nifti {
            Some(fs.header(file, &contain).await)
        } else {
            None
        }
    });

    let mut issues = Vec::new();
    let mut parsed = Vec::new();
    let mut sidecar_paths = Vec::new();
    for (sidecar, result) in applicable.into_iter().zip(read) {
        let name = sidecar
            .path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        match result {
            Ok((_, true)) => issues.push(format!(
                "{name} is larger than {} KiB and was not read",
                MAX_SIDECAR_BYTES >> 10
            )),
            Ok((bytes, false)) => {
                let (entries, error) = object_entries(&bytes);
                if let Some(error) = error {
                    issues.push(format!(
                        "{name}: invalid JSON ({error}); {} field(s) before the error were read",
                        entries.len()
                    ));
                }
                sidecar_paths.push(shown(&sidecar.path));
                parsed.push((sidecar, entries));
            }
            Err(error) => issues.push(format!("{name} could not be read: {error}")),
        }
    }

    let (header, header_issue) = match header {
        None => (
            None,
            Some("Header facts are read from NIfTI files (.nii, .nii.gz) only.".to_string()),
        ),
        Some(Err(error)) => (None, Some(format!("The header could not be read: {error}"))),
        Some(Ok(summary)) => (
            Some(SidecarHeader {
                dim: summary.dim,
                voxel_sizes: summary.pixdim,
                datatype: (!summary.datatype.is_empty()).then_some(summary.datatype),
                tr_seconds: summary.tr_seconds,
                n_volumes: summary.n_volumes,
                qform_code: summary.qform_code,
                sform_code: summary.sform_code,
            }),
            None,
        ),
    };

    let (entries, omitted) = merge_sidecars(parsed);
    if omitted > 0 {
        issues.push(format!(
            "{omitted} further field(s) are not shown: the card lists at most {MAX_SIDECAR_ENTRIES}"
        ));
    }
    Ok(SidecarCard {
        path: shown(file),
        entity_named: parse_name(&file_name).is_some(),
        file_name,
        header,
        header_issue,
        dataset_root: dataset_root.as_deref().map(shown),
        entries,
        sidecar_paths,
        issues,
        truncated,
    })
}

pub(crate) async fn sidecar_impl(
    state: &BridgeState,
    path: String,
    root_path: Option<String>,
) -> BridgeResult<SidecarCard> {
    let (scope, file) = resolve_scope(state, &path, root_path.as_deref()).await?;
    if scope.bound.as_deref() == Some(file.as_path()) {
        return Err(input(8265, "The path names a folder, not an image file."));
    }
    log::debug!("Building the sidecar card of {}", file.display());
    let worker_scope = scope.clone();
    let worker_file = file.clone();
    let outcome = owned(move || {
        Box::pin(async move {
            let bound = worker_scope.bound.as_deref();
            if let Some(parent) = worker_file.parent() {
                worker_scope
                    .fs
                    .admit(parent, bound)
                    .map_err(|outside| input(8261, outside))?;
            }
            build_sidecar_card(&worker_scope.fs, &worker_file, bound)
                .await
                .map_err(|error| {
                    io(
                        8263,
                        format!("'{}' could not be read: {error}", worker_file.display()),
                    )
                })
        })
    })
    .await?;
    ensure_current(state, &scope, &file).await?;
    outcome
}

// ---- commands ----

/// Run `work` until it finishes or its ticket is cancelled or expires. A
/// cancelled probe is dropped, which stops its worker and returns its permits.
async fn cancellable<T>(
    state: &BridgeState,
    ticket: Option<SampleTicket>,
    work: impl Future<Output = BridgeResult<T>>,
) -> BridgeResult<T> {
    let cancellation = ticket
        .as_ref()
        .map(|ticket| state.population_sampling.begin(ticket))
        .transpose()?
        .unwrap_or_default();
    cancellation.check()?;
    // A cancelled request is answered as cancelled even when its work ended
    // in the same moment: the caller has moved on (a refresh, another card).
    tokio::select! {
        biased;
        _ = cancellation.cancelled() => Err(population_sampling::cancelled()),
        result = work => result,
    }
}

/// Markers for the folder rows the browser shows: one answer per path, in
/// order. Cheap to repeat; see the module constants for its bounds.
#[command]
#[tracing::instrument(skip_all, err, name = "api.probe_dataset_markers")]
pub(crate) async fn probe_dataset_markers(
    paths: Vec<String>,
    root_path: Option<String>,
    ticket: Option<SampleTicket>,
    state: State<'_, BridgeState>,
) -> BridgeResult<Vec<DatasetMarker>> {
    let state = state.inner();
    cancellable(state, ticket, markers_impl(state, paths, root_path)).await
}

/// The dataset card of one folder, in one of two phases: `descriptions`
/// (what the description files say, without counting) or `full`, the default.
/// `refresh` forgets what is known of the folder and reads it again; a reload
/// passes it with the first phase it asks for.
#[command]
#[tracing::instrument(skip_all, err, name = "api.get_dataset_card")]
pub(crate) async fn get_dataset_card(
    path: String,
    root_path: Option<String>,
    refresh: Option<bool>,
    phase: Option<DatasetCardPhase>,
    ticket: Option<SampleTicket>,
    state: State<'_, BridgeState>,
) -> BridgeResult<DatasetCard> {
    let state = state.inner();
    cancellable(
        state,
        ticket,
        card_phase_impl(
            state,
            path,
            root_path,
            refresh.unwrap_or(false),
            phase.unwrap_or_default(),
        ),
    )
    .await
}

/// Header facts and merged sidecar metadata of one image file.
#[command]
#[tracing::instrument(skip_all, err, name = "api.get_sidecar_card")]
pub(crate) async fn get_sidecar_card(
    path: String,
    root_path: Option<String>,
    ticket: Option<SampleTicket>,
    state: State<'_, BridgeState>,
) -> BridgeResult<SidecarCard> {
    let state = state.inner();
    cancellable(state, ticket, sidecar_impl(state, path, root_path)).await
}

#[cfg(test)]
#[path = "dataset_card_tests.rs"]
mod tests;
