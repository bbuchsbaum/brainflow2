//! Remote-mount conveniences for people who reach the same machines often:
//! cancelling a connect, browsing remote folders before mounting, connection
//! status, profile edits, cache visibility and limits, "make available
//! offline" and the on-disk listing cache that keeps a tree browsable while
//! the server is unreachable.

use std::collections::{HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::UNIX_EPOCH;

use bridge_types::{
    BridgeError, BridgeResult, RemoteCacheFolderUsage, RemoteCacheUsage, RemoteFolderListing,
    RemoteMountConnectRequest, RemoteMountConnectResult, RemoteMountProfile, RemoteMountStatus,
    RemoteSessionInfo, TreePayload,
};
use log::{info, warn};
use remotely::RemoteClient;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{command, AppHandle, Emitter, Manager, Runtime, State};

use crate::{
    install_remote_recovery_hook, load_remote_profiles, load_user_ssh_config, map_remotely_error,
    materialize_remote_file_if_needed, normalize_remote_mount_request, remote_cache,
    remote_cache_metadata_root, remote_cache_root, resolve_remote_mount_for_local_path,
    save_remote_profiles, shared_remote_client_for_request, BridgeState,
    NormalizedRemoteMountRequest, RemoteMountEntry, REMOTE_FS_OPERATION_TIMEOUT,
};

const LISTINGS_DIR_NAME: &str = ".listings";
/// Recorded in each cache directory so the cache view can name folders that
/// are no longer mounted.
pub(crate) const ORIGIN_FILE_NAME: &str = ".origin";
/// Upper bounds for one "make available offline" job.
const PREFETCH_MAX_FILES: usize = 5000;
const PREFETCH_MAX_FOLDERS: usize = 2000;
const PREFETCH_MAX_DEPTH: usize = 8;

fn input_error(code: u16, details: impl Into<String>) -> BridgeError {
    BridgeError::Input {
        code,
        details: details.into(),
    }
}

// ---------------------------------------------------------------------------
// Cancelling a connect
// ---------------------------------------------------------------------------

fn cancelled() -> BridgeError {
    input_error(8250, "Connection cancelled")
}

/// Run `operation`, or fail with "cancelled" as soon as
/// `remote_mount_cancel_connect(attempt_id)` is called.
pub(crate) async fn cancellable<T>(
    state: &BridgeState,
    attempt_id: Option<&str>,
    operation: impl std::future::Future<Output = T>,
) -> BridgeResult<T> {
    let Some(attempt_id) = attempt_id else {
        return Ok(operation.await);
    };
    let mut cancel = {
        let mut attempts = state.remote_connect_attempts.lock().await;
        attempts
            .entry(attempt_id.to_string())
            .or_insert_with(|| tokio::sync::watch::channel(false).0)
            .subscribe()
    };
    if *cancel.borrow_and_update() {
        return Err(cancelled());
    }
    tokio::select! {
        biased;
        _ = async {
            loop {
                if cancel.changed().await.is_err() {
                    // Finished elsewhere: never resolve.
                    std::future::pending::<()>().await;
                }
                if *cancel.borrow() {
                    break;
                }
            }
        } => Err(cancelled()),
        output = operation => Ok(output),
    }
}

/// Drop the cancel flag of an attempt that finished. An attempt waiting on a
/// prompt keeps it for the respond or cancel that follows.
pub(crate) async fn settle(
    state: &BridgeState,
    attempt_id: Option<&str>,
    result: BridgeResult<RemoteMountConnectResult>,
) -> BridgeResult<RemoteMountConnectResult> {
    let waiting = matches!(
        result,
        Ok(RemoteMountConnectResult::NeedHostKey { .. }
            | RemoteMountConnectResult::NeedAuth { .. })
    );
    if !waiting {
        if let Some(id) = attempt_id {
            state.remote_connect_attempts.lock().await.remove(id);
        }
    }
    result
}

/// Abandon a connect attempt: stop its handshake and drop any host-key or
/// sign-in prompt it is waiting on (closing the half-open connection).
#[command]
#[tracing::instrument(skip_all, err, name = "api.remote_mount_cancel_connect")]
pub async fn remote_mount_cancel_connect(
    attempt_id: String,
    state: State<'_, BridgeState>,
) -> BridgeResult<bool> {
    Ok(cancel_attempt(state.inner(), &attempt_id).await)
}

pub(crate) async fn cancel_attempt(state: &BridgeState, attempt_id: &str) -> bool {
    let attempt_id = attempt_id.to_string();
    let flag = state
        .remote_connect_attempts
        .lock()
        .await
        .remove(&attempt_id);
    let signalled = flag.map(|sender| sender.send_replace(true)).is_some();
    let matches = |id: &Option<String>| id.as_deref() == Some(attempt_id.as_str());
    let mut dropped = 0;
    {
        let mut pending = state.pending_remote_host_key.lock().await;
        let before = pending.len();
        pending.retain(|_, (_, context)| !matches(&context.request.attempt_id));
        dropped += before - pending.len();
    }
    {
        let mut pending = state.pending_remote_auth.lock().await;
        let before = pending.len();
        pending.retain(|_, (_, context)| !matches(&context.request.attempt_id));
        dropped += before - pending.len();
    }
    signalled || dropped > 0
}

// ---------------------------------------------------------------------------
// Sessions: sharing, browsing, reviving
// ---------------------------------------------------------------------------

/// Key for one SSH endpoint: the host actually dialled, port and user.
pub(crate) fn endpoint_key(request: &NormalizedRemoteMountRequest) -> (String, u16, String) {
    (
        request.connect_host.to_ascii_lowercase(),
        request.port,
        request.user.clone(),
    )
}

async fn used_by_mount(state: &BridgeState, client: &Arc<RemoteClient>) -> bool {
    state
        .remote_mounts
        .lock()
        .await
        .values()
        .any(|mount| Arc::ptr_eq(&mount.client, client))
}

/// Describe a signed-in session for the folder picker.
pub(crate) async fn session_ready(
    request: &NormalizedRemoteMountRequest,
    client: &RemoteClient,
) -> BridgeResult<RemoteMountConnectResult> {
    let home = tokio::time::timeout(REMOTE_FS_OPERATION_TIMEOUT, client.fs().realpath("."))
        .await
        .map_err(|_| input_error(8251, "Timed out finding the remote home folder"))?
        .map_err(|e| map_remotely_error(e, 8251))?;
    Ok(RemoteMountConnectResult::SessionReady {
        session: RemoteSessionInfo {
            host: request.host.clone(),
            port: request.port,
            user: request.user.clone(),
            home,
        },
    })
}

/// Keep a session signed in to for browsing; mounting a folder on the same
/// host later reuses it.
pub(crate) async fn register_browse_session(
    state: &BridgeState,
    request: &NormalizedRemoteMountRequest,
    client: Arc<RemoteClient>,
) -> BridgeResult<RemoteMountConnectResult> {
    let previous = state
        .remote_browse_sessions
        .lock()
        .await
        .insert(endpoint_key(request), Arc::clone(&client));
    if let Some(previous) = previous {
        if !Arc::ptr_eq(&previous, &client) && !used_by_mount(state, &previous).await {
            let _ = previous.close().await;
        }
    }
    session_ready(request, &client).await
}

/// Subfolders of `path` (default: the home folder) on a host this app is
/// signed in to (a mounted folder's session or a browse session).
#[command]
#[tracing::instrument(skip_all, err, name = "api.remote_list_folders")]
pub async fn remote_list_folders(
    request: RemoteMountConnectRequest,
    path: Option<String>,
    state: State<'_, BridgeState>,
) -> BridgeResult<RemoteFolderListing> {
    let ssh_config = load_user_ssh_config().await;
    let normalized = normalize_remote_mount_request(request, &ssh_config)?;
    let client = shared_remote_client_for_request(state.inner(), &normalized)
        .await
        .ok_or_else(|| input_error(8252, "Sign in to this host to browse its folders"))?;
    let start = path
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .unwrap_or_else(|| ".".to_string());
    let fs = client.fs();
    let absolute = tokio::time::timeout(REMOTE_FS_OPERATION_TIMEOUT, fs.realpath(&start))
        .await
        .map_err(|_| input_error(8252, "Timed out opening the remote folder"))?
        .map_err(|e| map_remotely_error(e, 8252))?;
    let entries = tokio::time::timeout(REMOTE_FS_OPERATION_TIMEOUT, fs.list(&absolute))
        .await
        .map_err(|_| input_error(8252, "Timed out listing the remote folder"))?
        .map_err(|e| map_remotely_error(e, 8252))?;
    let mut folders: Vec<String> = entries
        .into_iter()
        .filter(|entry| entry.is_dir() && !entry.name.starts_with('.'))
        .map(|entry| entry.name)
        .collect();
    folders.sort_by_key(|name| name.to_lowercase());
    let parent = (absolute != "/").then(|| {
        Path::new(&absolute)
            .parent()
            .map(|parent| parent.to_string_lossy().into_owned())
            .filter(|parent| !parent.is_empty())
            .unwrap_or_else(|| "/".to_string())
    });
    Ok(RemoteFolderListing {
        path: absolute,
        parent,
        folders,
    })
}

/// Forget a browse session (the folder picker closed). A mounted folder
/// that took the session over keeps it open.
#[command]
#[tracing::instrument(skip_all, err, name = "api.remote_browse_close")]
pub async fn remote_browse_close(
    request: RemoteMountConnectRequest,
    state: State<'_, BridgeState>,
) -> BridgeResult<bool> {
    let ssh_config = load_user_ssh_config().await;
    let normalized = normalize_remote_mount_request(request, &ssh_config)?;
    let removed = state
        .remote_browse_sessions
        .lock()
        .await
        .remove(&endpoint_key(&normalized));
    let Some(client) = removed else {
        return Ok(false);
    };
    if !used_by_mount(state.inner(), &client).await {
        let _ = client.close().await;
    }
    Ok(true)
}

/// Hand a fresh session to every mounted folder on the same endpoint whose
/// session dropped for good (e.g. a 2FA session after sleep), so signing in
/// once brings them all back with their mount ids.
pub(crate) async fn revive_dropped_mounts<R: Runtime>(
    state: &BridgeState,
    request: &NormalizedRemoteMountRequest,
    client: &Arc<RemoteClient>,
    app: &AppHandle<R>,
) {
    let revived = swap_dropped_sessions(state, request, client).await;
    if let Some((mount_id, label)) = revived.first() {
        install_remote_recovery_hook(client, mount_id, label, app);
        info!(
            "Reconnected {} remote folder(s) on {}@{}",
            revived.len(),
            request.user,
            request.connect_host
        );
    }
}

/// Give `client` to the mounts on its endpoint whose session is gone for
/// good. Returns their `(mount_id, origin_label)`.
pub(crate) async fn swap_dropped_sessions(
    state: &BridgeState,
    request: &NormalizedRemoteMountRequest,
    client: &Arc<RemoteClient>,
) -> Vec<(String, String)> {
    let key = endpoint_key(request);
    let candidates: Vec<(String, String, Arc<RemoteClient>)> = {
        let mounts = state.remote_mounts.lock().await;
        mounts
            .values()
            .filter(|mount| {
                !mount.transfers.is_stopped()
                    && mount.connect_host.to_ascii_lowercase() == key.0
                    && mount.port == key.1
                    && mount.user == key.2
                    && !Arc::ptr_eq(&mount.client, client)
            })
            .map(|mount| {
                (
                    mount.mount_id.clone(),
                    mount.origin_label.clone(),
                    Arc::clone(&mount.client),
                )
            })
            .collect()
    };
    let mut dead = Vec::new();
    for (mount_id, label, old) in candidates {
        if !old.is_connected().await && !old.reconnects_automatically() {
            dead.push((mount_id, label));
        }
    }
    if !dead.is_empty() {
        let mut mounts = state.remote_mounts.lock().await;
        for (mount_id, _) in &dead {
            if let Some(mount) = mounts.get_mut(mount_id) {
                mount.client = Arc::clone(client);
            }
        }
    }
    dead
}

/// Connection state of every mounted remote folder.
#[command]
#[tracing::instrument(skip_all, err, name = "api.remote_mount_statuses")]
pub async fn remote_mount_statuses(
    state: State<'_, BridgeState>,
) -> BridgeResult<Vec<RemoteMountStatus>> {
    Ok(mount_statuses(state.inner()).await)
}

pub(crate) async fn mount_statuses(state: &BridgeState) -> Vec<RemoteMountStatus> {
    let mounts: Vec<(String, Arc<RemoteClient>)> = {
        let mounts = state.remote_mounts.lock().await;
        mounts
            .values()
            .map(|mount| (mount.mount_id.clone(), Arc::clone(&mount.client)))
            .collect()
    };
    let mut statuses = Vec::with_capacity(mounts.len());
    for (mount_id, client) in &mounts {
        let state = if client.is_connected().await {
            "connected"
        } else if client.reconnects_automatically() {
            "reconnecting"
        } else {
            "disconnected"
        };
        let shared = mounts
            .iter()
            .filter(|(_, other)| Arc::ptr_eq(other, client))
            .count();
        statuses.push(RemoteMountStatus {
            mount_id: mount_id.clone(),
            state: state.to_string(),
            shared_session_mounts: shared as u32,
        });
    }
    statuses.sort_by(|a, b| a.mount_id.cmp(&b.mount_id));
    statuses
}

// ---------------------------------------------------------------------------
// Saved profiles
// ---------------------------------------------------------------------------

/// Rename a saved profile or change its "reconnect when Brainflow starts"
/// setting without connecting.
#[command]
#[tracing::instrument(skip_all, err, name = "api.update_remote_mount_profile")]
pub async fn update_remote_mount_profile(
    profile_id: String,
    name: Option<String>,
    reconnect_on_launch: Option<bool>,
) -> BridgeResult<RemoteMountProfile> {
    let mut profiles = load_remote_profiles().await?;
    let profile = profiles
        .iter_mut()
        .find(|profile| profile.id == profile_id)
        .ok_or_else(|| input_error(8253, format!("Unknown remote profile: {profile_id}")))?;
    if let Some(name) = name {
        let name = name.trim();
        if name.is_empty() {
            return Err(input_error(8253, "Profile name cannot be empty"));
        }
        profile.name = name.to_string();
    }
    if let Some(reconnect) = reconnect_on_launch {
        profile.reconnect_on_launch = reconnect;
    }
    let updated = profile.clone();
    save_remote_profiles(&profiles).await?;
    Ok(updated)
}

// ---------------------------------------------------------------------------
// Cache visibility and limits
// ---------------------------------------------------------------------------

async fn active_roots(state: &BridgeState) -> HashSet<PathBuf> {
    state
        .remote_mounts
        .lock()
        .await
        .values()
        .map(|mount| mount.local_root.clone())
        .collect()
}

fn modified_unix_ms(path: &Path) -> Option<u64> {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
}

async fn cache_usage(state: &BridgeState) -> BridgeResult<RemoteCacheUsage> {
    let root = remote_cache_root()?;
    let mounted: Vec<(PathBuf, String, String)> = state
        .remote_mounts
        .lock()
        .await
        .values()
        .map(|mount| {
            (
                mount.local_root.clone(),
                mount.mount_id.clone(),
                mount.origin_label.clone(),
            )
        })
        .collect();
    let folders =
        tokio::task::spawn_blocking(move || -> BridgeResult<Vec<RemoteCacheFolderUsage>> {
            let mut folders = Vec::new();
            if !root.exists() {
                return Ok(folders);
            }
            let metadata_root = root.join(crate::REMOTE_CACHE_METADATA_DIR_NAME);
            for entry in std::fs::read_dir(&root)
                .map_err(|e| crate::remote_transfer::error(&e.to_string()))?
            {
                let Ok(entry) = entry else { continue };
                let path = entry.path();
                let name = entry.file_name().to_string_lossy().into_owned();
                if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false)
                    || !remote_cache::is_owned_cache_dir(&name)
                {
                    continue;
                }
                let mut bytes = remote_cache::directory_bytes(&path)?;
                let metadata = metadata_root.join(&name);
                if metadata.is_dir() {
                    bytes = bytes.saturating_add(remote_cache::directory_bytes(&metadata)?);
                }
                let mounted = mounted.iter().find(|(root, _, _)| *root == path);
                let label = mounted
                    .map(|(_, _, label)| label.clone())
                    .or_else(|| {
                        std::fs::read_to_string(path.join(ORIGIN_FILE_NAME))
                            .ok()
                            .map(|label| label.trim().to_string())
                            .filter(|label| !label.is_empty())
                    })
                    .unwrap_or(name);
                folders.push(RemoteCacheFolderUsage {
                    mount_id: mounted.map(|(_, id, _)| id.clone()),
                    label,
                    bytes,
                    last_used_ms: modified_unix_ms(&path.join(".last-used")),
                });
            }
            folders.sort_by(|a, b| b.bytes.cmp(&a.bytes));
            Ok(folders)
        })
        .await
        .map_err(|e| crate::remote_transfer::error(&e.to_string()))??;
    Ok(RemoteCacheUsage {
        total_bytes: folders.iter().map(|f| f.bytes).sum(),
        budget_bytes: remote_cache::budget(),
        budget_from_env: remote_cache::budget_from_env(),
        folders,
    })
}

/// Disk used by downloaded remote files, per folder, and the limit.
#[command]
#[tracing::instrument(skip_all, err, name = "api.remote_cache_usage")]
pub async fn remote_cache_usage(state: State<'_, BridgeState>) -> BridgeResult<RemoteCacheUsage> {
    cache_usage(state.inner()).await
}

/// Set the limit for downloaded remote files (kept across restarts).
#[command]
#[tracing::instrument(skip_all, err, name = "api.set_remote_cache_budget")]
pub async fn set_remote_cache_budget(
    budget_bytes: u64,
    state: State<'_, BridgeState>,
) -> BridgeResult<RemoteCacheUsage> {
    if remote_cache::budget_from_env() {
        return Err(input_error(
            8254,
            "The cache limit is set by BRAINFLOW_REMOTE_CACHE_BYTES",
        ));
    }
    tokio::task::spawn_blocking(move || remote_cache::save_budget(budget_bytes))
        .await
        .map_err(|e| crate::remote_transfer::error(&e.to_string()))??;
    cache_usage(state.inner()).await
}

/// Delete downloaded files of every remote folder that is not mounted.
#[command]
#[tracing::instrument(skip_all, err, name = "api.clear_inactive_remote_caches")]
pub async fn clear_inactive_remote_caches(
    state: State<'_, BridgeState>,
) -> BridgeResult<RemoteCacheUsage> {
    let root = remote_cache_root()?;
    {
        let _admission = remote_cache::ADMISSION.lock().await;
        let active = active_roots(state.inner()).await;
        let freed =
            tokio::task::spawn_blocking(move || remote_cache::evict_inactive(&root, &active))
                .await
                .map_err(|e| crate::remote_transfer::error(&e.to_string()))??;
        info!("Cleared {freed} bytes of inactive remote caches");
    }
    cache_usage(state.inner()).await
}

// ---------------------------------------------------------------------------
// Listing cache (instant trees, offline browsing)
// ---------------------------------------------------------------------------

fn listing_path(mount: &RemoteMountEntry, local_path: &Path) -> Option<PathBuf> {
    let relative = local_path.strip_prefix(&mount.local_root).ok()?;
    let identity = mount.local_root.file_name()?;
    let digest = Sha256::digest(relative.to_string_lossy().as_bytes());
    Some(
        remote_cache_metadata_root()
            .ok()?
            .join(identity)
            .join(LISTINGS_DIR_NAME)
            .join(format!("{digest:x}.json")),
    )
}

/// Remember a folder listing so the next visit can show it at once.
pub(crate) async fn save_cached_listing(
    mount: &RemoteMountEntry,
    local_path: &Path,
    payload: &TreePayload,
) {
    let Some(path) = listing_path(mount, local_path) else {
        return;
    };
    let Ok(bytes) = serde_json::to_vec(payload) else {
        return;
    };
    if let Some(parent) = path.parent() {
        if tokio::fs::create_dir_all(parent).await.is_err() {
            return;
        }
    }
    let tmp = path.with_extension(format!("json.{}", uuid::Uuid::new_v4()));
    if tokio::fs::write(&tmp, bytes).await.is_ok() && tokio::fs::rename(&tmp, &path).await.is_err()
    {
        let _ = tokio::fs::remove_file(&tmp).await;
    }
}

/// The last listing seen for a folder, if any.
pub(crate) async fn load_cached_listing(
    mount: &RemoteMountEntry,
    local_path: &Path,
) -> Option<TreePayload> {
    let path = listing_path(mount, local_path)?;
    let bytes = tokio::fs::read(path).await.ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// The last listing seen for a folder in a mounted remote folder, for showing
/// the tree before the live listing arrives. `None` for local folders and
/// folders never listed.
#[command]
#[tracing::instrument(skip_all, err, name = "api.cached_remote_directory")]
pub async fn cached_remote_directory(
    path: String,
    state: State<'_, BridgeState>,
) -> BridgeResult<Option<TreePayload>> {
    let local = PathBuf::from(&path);
    let Some((mount, _)) = resolve_remote_mount_for_local_path(state.inner(), &local).await else {
        return Ok(None);
    };
    Ok(load_cached_listing(&mount, &local).await)
}

#[cfg(test)]
pub(crate) async fn cached_listing_for_test(
    state: &BridgeState,
    local: &Path,
) -> Option<TreePayload> {
    let (mount, _) = resolve_remote_mount_for_local_path(state, local).await?;
    load_cached_listing(&mount, local).await
}

/// Whether a failed remote operation means the server cannot be reached
/// right now (as opposed to a missing file or a permission problem).
pub(crate) async fn is_unreachable(mount: &RemoteMountEntry, err: &BridgeError) -> bool {
    if mount.transfers.is_stopped() {
        return false;
    }
    let timed_out =
        matches!(err, BridgeError::Io { details, .. } if details.starts_with("Timed out"));
    timed_out || !mount.client.is_connected().await
}

// ---------------------------------------------------------------------------
// Make available offline
// ---------------------------------------------------------------------------

/// Progress of a "make available offline" job (`remote-prefetch-progress`).
#[derive(Debug, Clone, Serialize)]
struct PrefetchProgress {
    job_id: String,
    mount_id: String,
    folder: String,
    /// "scanning", "downloading", "done", "cancelled" or "failed".
    state: &'static str,
    files_done: usize,
    files_total: usize,
    bytes_done: u64,
    bytes_total: u64,
    current: Option<String>,
    error: Option<String>,
    /// Some files were skipped because the folder exceeds the job limits.
    truncated: bool,
}

/// Files worth keeping offline: images, surfaces and the small sidecars and
/// tables that describe them.
fn prefetch_wanted(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    [
        ".nii", ".nii.gz", ".gii", ".mgz", ".mgh", ".img", ".hdr", ".json", ".tsv", ".csv",
        ".label", ".annot",
    ]
    .iter()
    .any(|ext| lower.ends_with(ext))
}

/// Download every image (and sidecar) under a mounted remote folder into the
/// cache, so it opens instantly and stays available while the server is
/// unreachable. Progress arrives as `remote-prefetch-progress` events.
#[command]
#[tracing::instrument(skip_all, err, name = "api.remote_prefetch_folder")]
pub async fn remote_prefetch_folder<R: Runtime>(
    path: String,
    state: State<'_, BridgeState>,
    app: AppHandle<R>,
) -> BridgeResult<String> {
    let folder = PathBuf::from(&path);
    let Some((mount, _)) = resolve_remote_mount_for_local_path(state.inner(), &folder).await else {
        return Err(input_error(8255, "Not inside a mounted remote folder"));
    };
    let job_id = uuid::Uuid::new_v4().to_string();
    let cancel = Arc::new(AtomicBool::new(false));
    state
        .remote_prefetch_jobs
        .lock()
        .await
        .insert(job_id.clone(), Arc::clone(&cancel));

    let job = job_id.clone();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<BridgeState>();
        let mut progress = PrefetchProgress {
            job_id: job.clone(),
            mount_id: mount.mount_id.clone(),
            folder: folder.to_string_lossy().into_owned(),
            state: "scanning",
            files_done: 0,
            files_total: 0,
            bytes_done: 0,
            bytes_total: 0,
            current: None,
            error: None,
            truncated: false,
        };
        let emit = |progress: &PrefetchProgress| {
            let _ = app.emit("remote-prefetch-progress", progress);
        };
        emit(&progress);
        let result = run_prefetch(state.inner(), &folder, &cancel, &mut progress, &emit).await;
        progress.current = None;
        match result {
            Ok(()) if cancel.load(Ordering::Acquire) => progress.state = "cancelled",
            Ok(()) => progress.state = "done",
            Err(err) => {
                progress.state = "failed";
                progress.error = Some(err.to_string());
            }
        }
        emit(&progress);
        state.remote_prefetch_jobs.lock().await.remove(&job);
    });
    Ok(job_id)
}

async fn run_prefetch(
    state: &BridgeState,
    folder: &Path,
    cancel: &AtomicBool,
    progress: &mut PrefetchProgress,
    emit: &impl Fn(&PrefetchProgress),
) -> BridgeResult<()> {
    // Walk the remote tree through the normal listing path, which also
    // creates the local folders and stores each listing for offline use.
    let mut files: Vec<(PathBuf, u64)> = Vec::new();
    let mut queue = VecDeque::from([(folder.to_path_buf(), 0usize)]);
    let mut folders_seen = 0usize;
    while let Some((dir, depth)) = queue.pop_front() {
        if cancel.load(Ordering::Acquire) {
            return Ok(());
        }
        folders_seen += 1;
        let Some(listing) = crate::list_remote_directory_for_local_path(state, &dir).await? else {
            return Err(input_error(8255, "The remote folder is no longer mounted"));
        };
        for node in listing.nodes {
            if node.is_dir {
                if depth + 1 <= PREFETCH_MAX_DEPTH
                    && folders_seen + queue.len() < PREFETCH_MAX_FOLDERS
                {
                    queue.push_back((PathBuf::from(&node.id), depth + 1));
                } else {
                    progress.truncated = true;
                }
            } else if prefetch_wanted(&node.name) {
                if files.len() >= PREFETCH_MAX_FILES {
                    progress.truncated = true;
                    continue;
                }
                files.push((PathBuf::from(&node.id), node.size.unwrap_or(0)));
            }
        }
    }
    progress.files_total = files.len();
    progress.bytes_total = files.iter().map(|(_, size)| size).sum();
    let budget = remote_cache::budget();
    if progress.bytes_total > budget {
        return Err(input_error(
            8256,
            format!(
                "This folder has {} of files but the download cache holds {}. Raise the limit in Remote cache settings or choose a smaller folder.",
                human_bytes(progress.bytes_total),
                human_bytes(budget)
            ),
        ));
    }
    progress.state = "downloading";
    emit(progress);

    for (path, size) in files {
        if cancel.load(Ordering::Acquire) {
            return Ok(());
        }
        progress.current = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned());
        emit(progress);
        if let Err(err) = materialize_remote_file_if_needed(state, &path).await {
            warn!("Offline copy of {} failed: {err}", path.display());
            return Err(err);
        }
        progress.files_done += 1;
        progress.bytes_done = progress.bytes_done.saturating_add(size);
    }
    emit(progress);
    Ok(())
}

/// Stop a "make available offline" job; files already downloaded stay.
#[command]
#[tracing::instrument(skip_all, err, name = "api.remote_prefetch_cancel")]
pub async fn remote_prefetch_cancel(
    job_id: String,
    state: State<'_, BridgeState>,
) -> BridgeResult<bool> {
    let job = state
        .remote_prefetch_jobs
        .lock()
        .await
        .get(&job_id)
        .cloned();
    Ok(job
        .map(|cancel| cancel.store(true, Ordering::Release))
        .is_some())
}

fn human_bytes(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{bytes} B")
    } else {
        format!("{value:.1} {}", UNITS[unit])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefetch_keeps_images_and_sidecars_only() {
        for name in [
            "sub-01_T1w.nii.gz",
            "a.NII",
            "lh.pial.gii",
            "brain.mgz",
            "events.tsv",
            "x.json",
        ] {
            assert!(prefetch_wanted(name), "{name}");
        }
        for name in ["notes.txt", "run.sh", "archive.tar.gz", "image.png"] {
            assert!(!prefetch_wanted(name), "{name}");
        }
    }

    #[test]
    fn bytes_read_like_a_person_would() {
        assert_eq!(human_bytes(512), "512 B");
        assert_eq!(human_bytes(1536), "1.5 KB");
        assert_eq!(human_bytes(4 * 1024 * 1024 * 1024), "4.0 GB");
    }
}
