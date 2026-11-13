//! Bring the image files a Set studio computation reads into the remote cache.
//!
//! Population sampling and Compare materialization read member files by their
//! local path. On a remote mount only the files something has opened exist
//! there, so the lens asks for exactly the files it will read first. Every
//! file goes through `materialize_remote_file_for`: the same permits, cache
//! admission, staging-and-rename, size check and sidecar as an interactive
//! open. Files are fetched one at a time and the admission lock is released
//! between them, so an interactive open waits for at most the file in flight.
//! The fetch stops only the transfers it started: an interactive open of the
//! same file is never cancelled by it.
//!
//! The fetch is its own command, outside the two-minute population ticket.
//! A file that finished stays in the cache: a cancelled or failed fetch
//! continues from the files that are still missing.
use crate::{remote_transfer, BridgeError, BridgeResult, BridgeState, RemoteMountEntry};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tokio::sync::watch;

/// A fetch larger than this is not started until the user has agreed to it.
pub(crate) const LARGE_FETCH_CONFIRM_BYTES: u64 = 2 * 1024 * 1024 * 1024;
/// Cancellations kept for fetches that have not registered yet.
const MAX_PENDING_CANCELLATIONS: usize = 256;

/// The remote file is not on the server.
pub(crate) const CODE_MISSING: u16 = 8251;
/// No active mount serves the path, or its session is gone.
pub(crate) const CODE_NOT_CONNECTED: u16 = 8252;
pub(crate) const CODE_CANCELLED: u16 = 8254;
/// The file is on an active mount but not in the cache.
pub(crate) const CODE_NOT_FETCHED: u16 = 8255;
pub(crate) const CODE_FAILED: u16 = 8256;
/// The images do not fit in the remote cache; nothing was fetched.
pub(crate) const CODE_CACHE_FULL: u16 = 8257;

pub(crate) const NOT_CONNECTED: &str = "The remote folder is not connected. Reconnect to continue.";

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioSourceRef {
    pub path: String,
    /// The member the file belongs to, as the user knows it ("sub-1014").
    #[serde(default)]
    pub label: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioSourceFetchRequest {
    pub fetch_id: String,
    pub sources: Vec<StudioSourceRef>,
    /// The user agreed to a fetch above [`LARGE_FETCH_CONFIRM_BYTES`].
    #[serde(default)]
    pub allow_large: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StudioSourceFetchStatus {
    Ready,
    NeedsConfirmation,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioSourceFetchResult {
    pub status: StudioSourceFetchStatus,
    /// The host the files come from; `None` when no source is remote.
    pub mount_label: Option<String>,
    /// Sources on a remote mount.
    pub remote_count: usize,
    /// Of those, the files that were not in the cache when the fetch began.
    pub fetch_count: usize,
    pub fetch_bytes: u64,
    /// Files this call downloaded.
    pub fetched_count: usize,
    /// Cached sources that could not be compared with the server because it
    /// is not connected. They are usable; they may not be the latest.
    pub unverified_count: usize,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioSourceFetchProgress {
    pub fetch_id: String,
    /// Remote sources that are in the cache now.
    pub done: usize,
    pub total: usize,
    pub mount_label: String,
}

#[derive(Default)]
pub struct StudioSourceFetches {
    /// `true` is a cancellation that arrived before its fetch registered.
    active: Mutex<HashMap<String, watch::Sender<bool>>>,
}

pub(crate) struct FetchRegistration {
    fetches: Arc<StudioSourceFetches>,
    id: String,
}
impl Drop for FetchRegistration {
    fn drop(&mut self) {
        self.fetches
            .active
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&self.id);
    }
}

impl StudioSourceFetches {
    pub(crate) fn begin(
        self: &Arc<Self>,
        id: &str,
    ) -> BridgeResult<(FetchRegistration, watch::Receiver<bool>)> {
        let mut active = self.active.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(existing) = active.get(id) {
            if *existing.borrow() {
                active.remove(id);
                return Err(cancelled());
            }
            return Err(BridgeError::Input {
                code: CODE_FAILED,
                details: "This image fetch is already running.".into(),
            });
        }
        let (tx, rx) = watch::channel(false);
        active.insert(id.to_string(), tx);
        Ok((
            FetchRegistration {
                fetches: Arc::clone(self),
                id: id.to_string(),
            },
            rx,
        ))
    }

    /// Stop the fetch, or refuse it if it has not started yet.
    pub(crate) fn cancel(&self, id: &str) -> bool {
        let mut active = self.active.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(existing) = active.get(id) {
            return !existing.send_replace(true);
        }
        if active.len() >= MAX_PENDING_CANCELLATIONS {
            active.retain(|_, tx| !*tx.borrow());
        }
        active.insert(id.to_string(), watch::channel(true).0);
        false
    }
}

pub(crate) fn cancelled() -> BridgeError {
    BridgeError::Input {
        code: CODE_CANCELLED,
        details: "Image fetch cancelled.".into(),
    }
}

fn not_connected() -> BridgeError {
    BridgeError::Io {
        code: CODE_NOT_CONNECTED,
        details: NOT_CONNECTED.into(),
    }
}

/// "sub-1014: same_item.nii.gz", or the file name alone without a label.
fn source_name(label: Option<&str>, path: &Path) -> String {
    let file = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned());
    match label.map(str::trim).filter(|label| !label.is_empty()) {
        Some(label) => format!("{label}: {file}"),
        None => file,
    }
}

fn under_remote_cache(path: &Path) -> bool {
    crate::remote_cache_root().is_ok_and(|root| path.starts_with(root))
}

/// Refuse to read `path` when it is a remote file that is not in the cache,
/// in words the lens can show. A path that is local, or already cached, passes.
///
/// This checks that a file exists, not that it is current: the server is not
/// asked and the sidecar is not read. Currency is the fetch's to establish.
pub(crate) async fn require_local(state: &BridgeState, path: &Path) -> BridgeResult<()> {
    if tokio::fs::try_exists(path).await.unwrap_or(false) {
        return Ok(());
    }
    match crate::resolve_remote_mount_for_local_path(state, path).await {
        Some((mount, _)) if !mount.transfers.is_stopped() => Err(BridgeError::Io {
            code: CODE_NOT_FETCHED,
            details: format!(
                "{} has not been fetched from {} yet.",
                source_name(None, path),
                mount.host
            ),
        }),
        Some(_) => Err(not_connected()),
        None if under_remote_cache(path) => Err(not_connected()),
        None => Ok(()),
    }
}

struct Wanted {
    path: PathBuf,
    remote_path: String,
    name: String,
}

/// "3.2 GB", in the units the lens uses for a fetch.
fn size(bytes: u64) -> String {
    const MB: f64 = 1024.0 * 1024.0;
    let bytes = bytes as f64;
    if bytes >= 1024.0 * MB {
        format!("{:.1} GB", bytes / (1024.0 * MB))
    } else {
        format!("{:.0} MB", (bytes / MB).ceil())
    }
}

/// Why a fetch of `fetch_bytes` cannot fit, when it cannot: the cache holds
/// `pinned` bytes that eviction never reclaims (connected folders are kept),
/// so downloading would only fail at the file that crosses `budget`.
pub(crate) fn over_budget(
    fetch_bytes: u64,
    pinned: u64,
    budget: u64,
    host: &str,
) -> Option<BridgeError> {
    if pinned.saturating_add(fetch_bytes) <= budget {
        return None;
    }
    let why = if fetch_bytes > budget {
        format!("more than the {} the remote cache may hold", size(budget))
    } else {
        format!(
            "but the remote cache may hold {} and connected folders already use {} of it",
            size(budget),
            size(pinned)
        )
    };
    Some(BridgeError::Io {
        code: CODE_CACHE_FULL,
        details: format!(
            "These images need {} from {host}, {why}. Nothing was fetched. Unmount a remote folder you are not using and purge its cache, or raise BRAINFLOW_REMOTE_CACHE_BYTES.",
            size(fetch_bytes)
        ),
    })
}

/// "a is not on host.", or the count with up to three names.
fn missing(absent: &[&str], host: &str) -> BridgeError {
    let details = match absent {
        [only] => format!("{only} is not on {host}."),
        _ => {
            let named = &absent[..absent.len().min(3)];
            let rest = absent.len() - named.len();
            let names = match (named, rest) {
                ([head @ .., last], 0) => format!("{} and {last}", head.join(", ")),
                (_, 1) => format!("{} and 1 other", named.join(", ")),
                (_, rest) => format!("{} and {rest} others", named.join(", ")),
            };
            format!("{} images are not on {host}: {names}.", absent.len())
        }
    };
    BridgeError::Io {
        code: CODE_MISSING,
        details,
    }
}

/// Whether `mount` is still the mount that serves its folder.
async fn still_mounted(state: &BridgeState, mount: &RemoteMountEntry) -> bool {
    !mount.transfers.is_stopped()
        && state
            .remote_mounts
            .lock()
            .await
            .get(&mount.mount_id)
            .is_some_and(|current| Arc::ptr_eq(&current.transfers, &mount.transfers))
}

/// A transfer failure in the user's terms: the folder is gone, or this file
/// could not be fetched and why.
async fn plain_failure(
    state: &BridgeState,
    mount: &RemoteMountEntry,
    name: &str,
    error: BridgeError,
) -> BridgeError {
    if !still_mounted(state, mount).await || !mount.client.is_connected().await {
        return not_connected();
    }
    let details = match &error {
        BridgeError::Io { details, .. }
        | BridgeError::Input { details, .. }
        | BridgeError::Internal { details, .. } => details.clone(),
        other => other.to_string(),
    };
    BridgeError::Io {
        code: CODE_FAILED,
        details: format!("{name} could not be fetched from {}: {details}", mount.host),
    }
}

/// Make every remote source local, or say what stands in the way.
pub(crate) async fn fetch_sources(
    state: &BridgeState,
    request: &StudioSourceFetchRequest,
    mut cancel: watch::Receiver<bool>,
    progress: &(dyn Fn(StudioSourceFetchProgress) + Send + Sync),
) -> BridgeResult<StudioSourceFetchResult> {
    let mut seen = HashSet::new();
    let mut mount: Option<RemoteMountEntry> = None;
    let mut wanted = Vec::new();
    for source in &request.sources {
        let path = PathBuf::from(source.path.trim());
        if !path.is_absolute() || !seen.insert(path.clone()) {
            continue;
        }
        let Some((found, remote_path)) =
            crate::resolve_remote_mount_for_local_path(state, &path).await
        else {
            if under_remote_cache(&path) {
                return Err(not_connected());
            }
            continue;
        };
        if found.transfers.is_stopped() {
            return Err(not_connected());
        }
        match &mount {
            None => mount = Some(found),
            Some(first) if first.mount_id == found.mount_id => {}
            Some(_) => {
                return Err(BridgeError::Input {
                    code: CODE_FAILED,
                    details: "These images are in more than one remote folder; fetch each folder's images separately.".into(),
                })
            }
        }
        wanted.push(Wanted {
            name: source_name(source.label.as_deref(), &path),
            path,
            remote_path,
        });
    }
    let Some(mount) = mount else {
        return Ok(StudioSourceFetchResult {
            status: StudioSourceFetchStatus::Ready,
            mount_label: None,
            remote_count: 0,
            fetch_count: 0,
            fetch_bytes: 0,
            fetched_count: 0,
            unverified_count: 0,
        });
    };
    let label = mount.host.clone();
    let total = wanted.len();

    // One stat pass: what is absent on the server, what the cache already
    // holds, and how much the rest weighs.
    let stat_jobs: Vec<_> = wanted
        .iter()
        .map(|item| remote_transfer::stat_optional_owned(mount.clone(), item.remote_path.clone()))
        .collect();
    let stats = tokio::select! {
        biased;
        _ = remote_transfer::wait_cancelled(&mut cancel) => return Err(cancelled()),
        stats = futures::stream::iter(stat_jobs)
            .buffered(crate::REMOTE_MOUNT_MAX_CONCURRENT_OPS)
            .collect::<Vec<_>>() => stats,
    };
    let mut absent = Vec::new();
    let mut to_fetch = Vec::new();
    let mut fetch_bytes = 0u64;
    let mut unverified_count = 0;
    for (item, stat) in wanted.iter().zip(stats) {
        match stat {
            Err(error) => {
                // The server cannot be asked. An image that is already in the
                // cache is still readable; one that is not needs the folder.
                let failure = plain_failure(state, &mount, &item.name, error).await;
                let offline =
                    matches!(&failure, BridgeError::Io { code, .. } if *code == CODE_NOT_CONNECTED);
                if offline
                    && crate::remote_cache_copy_exists(&mount, &item.remote_path, &item.path).await
                {
                    unverified_count += 1;
                } else {
                    return Err(failure);
                }
            }
            Ok(None) => absent.push(item.name.as_str()),
            Ok(Some(stat)) => {
                if !crate::remote_cache_copy_is_current(
                    &mount,
                    &item.remote_path,
                    &item.path,
                    &stat,
                )
                .await?
                {
                    fetch_bytes = fetch_bytes.saturating_add(stat.size);
                    to_fetch.push(item);
                }
            }
        }
    }
    if !absent.is_empty() {
        return Err(missing(&absent, &label));
    }
    let result = |status, fetched_count| StudioSourceFetchResult {
        status,
        mount_label: Some(label.clone()),
        remote_count: total,
        fetch_count: to_fetch.len(),
        fetch_bytes,
        fetched_count,
        unverified_count,
    };
    if !to_fetch.is_empty() {
        // Connected folders are never evicted, so a fetch that cannot fit
        // beside them is refused here instead of at the file that fails.
        let active_roots = state
            .remote_mounts
            .lock()
            .await
            .values()
            .map(|entry| entry.local_root.clone())
            .collect();
        let cache_root = crate::remote_cache_root()?;
        let pinned = tokio::task::spawn_blocking(move || {
            crate::remote_cache::pinned_bytes(&cache_root, &active_roots)
        })
        .await
        .map_err(|e| remote_transfer::error(&e.to_string()))??;
        if let Some(refusal) =
            over_budget(fetch_bytes, pinned, crate::remote_cache::budget(), &label)
        {
            return Err(refusal);
        }
    }
    if fetch_bytes > LARGE_FETCH_CONFIRM_BYTES && !request.allow_large {
        return Ok(result(StudioSourceFetchStatus::NeedsConfirmation, 0));
    }

    let report = |done| {
        progress(StudioSourceFetchProgress {
            fetch_id: request.fetch_id.clone(),
            done,
            total,
            mount_label: label.clone(),
        })
    };
    let mut done = total - to_fetch.len();
    if !to_fetch.is_empty() {
        report(done);
    }
    for item in &to_fetch {
        if *cancel.borrow() {
            return Err(cancelled());
        }
        if !still_mounted(state, &mount).await {
            return Err(not_connected());
        }
        // The fetch's own signal goes down into the transfer: it stops this
        // download, and the wait for cache admission before it, and nothing
        // that another caller started for the same file.
        let outcome = crate::materialize_remote_file_for(
            state,
            mount.clone(),
            item.remote_path.clone(),
            &item.path,
            Some(cancel.clone()),
        )
        .await;
        if let Err(error) = outcome {
            if *cancel.borrow() {
                return Err(cancelled());
            }
            return Err(plain_failure(state, &mount, &item.name, error).await);
        }
        done += 1;
        report(done);
    }
    if !still_mounted(state, &mount).await {
        return Err(not_connected());
    }
    Ok(result(StudioSourceFetchStatus::Ready, to_fetch.len()))
}
