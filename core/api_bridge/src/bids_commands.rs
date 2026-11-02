//! Tauri adapter for the BIDS browser. Logic lives in `bids_index`; this file
//! owns scan identity, cancellation, remote policy and the decode semaphore.

use crate::bids_index::remote::{RemoteDataset, RemoteEntry};
use crate::bids_index::{exclusions, images, scan};
use crate::{remote_transfer, BridgeState};
use bridge_types::bids::*;
use bridge_types::{BridgeError, BridgeResult};
use directories::ProjectDirs;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use tauri::{command, Emitter, Runtime, State};
use tokio::sync::Semaphore;

const PROGRESS_EVENT: &str = "bids-scan-progress";
/// Whole-file decodes in flight; each can hold a run's full series in memory.
static DECODES: Semaphore = Semaphore::const_new(2);

fn input(details: impl Into<String>) -> BridgeError {
    BridgeError::Input {
        code: 6471,
        details: details.into(),
    }
}

fn io_failure(details: impl Into<String>) -> BridgeError {
    BridgeError::Io {
        code: 6472,
        details: details.into(),
    }
}

fn task_failure(error: tokio::task::JoinError) -> BridgeError {
    BridgeError::Internal {
        code: 6473,
        details: format!("BIDS task failed: {error}"),
    }
}

fn cache_root() -> BridgeResult<PathBuf> {
    ProjectDirs::from("org", "Brainflow", "Brainflow")
        .map(|dirs| dirs.cache_dir().to_path_buf())
        .ok_or_else(|| BridgeError::Internal {
            code: 6474,
            details: "Could not resolve the app cache directory".to_string(),
        })
}

struct ActiveScan {
    scan_id: String,
    cancel: Arc<AtomicBool>,
}

/// Running scans by dataset. A dataset has one: starting another supersedes
/// the first, which stops and may no longer write the stored index.
static SCANS: LazyLock<Mutex<HashMap<String, ActiveScan>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

struct ScanHandle {
    dataset: String,
    scan_id: String,
    cancel: Arc<AtomicBool>,
}

impl ScanHandle {
    fn register(dataset: &str, scan_id: &str) -> BridgeResult<Self> {
        let mut scans = SCANS.lock().map_err(|_| input("Scan registry poisoned"))?;
        if scans.values().any(|active| active.scan_id == scan_id) {
            return Err(input(format!("Scan {scan_id} is already running")));
        }
        let cancel = Arc::new(AtomicBool::new(false));
        let previous = scans.insert(
            dataset.to_string(),
            ActiveScan {
                scan_id: scan_id.to_string(),
                cancel: cancel.clone(),
            },
        );
        if let Some(previous) = previous {
            previous.cancel.store(true, Ordering::Relaxed);
        }
        Ok(Self {
            dataset: dataset.to_string(),
            scan_id: scan_id.to_string(),
            cancel,
        })
    }
}

impl scan::ScanControl for ScanHandle {
    fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }

    fn owns_index(&self) -> bool {
        SCANS.lock().is_ok_and(|scans| {
            scans
                .get(&self.dataset)
                .is_some_and(|active| active.scan_id == self.scan_id)
        })
    }
}

impl Drop for ScanHandle {
    fn drop(&mut self) {
        if let Ok(mut scans) = SCANS.lock() {
            if scans
                .get(&self.dataset)
                .is_some_and(|active| active.scan_id == self.scan_id)
            {
                scans.remove(&self.dataset);
            }
        }
    }
}

/// A mounted dataset on its server.
struct MountDataset {
    mount: crate::RemoteMountEntry,
    remote_root: String,
    runtime: tokio::runtime::Handle,
}

impl MountDataset {
    fn remote_paths(&self, rel_paths: &[String]) -> Vec<String> {
        rel_paths
            .iter()
            .map(|rel| match rel.as_str() {
                "" => self.remote_root.clone(),
                rel => crate::join_remote_child(&self.remote_root, rel),
            })
            .collect()
    }
}

fn text_error<T>(result: BridgeResult<T>) -> Result<T, String> {
    result.map_err(|e| e.to_string())
}

impl RemoteDataset for MountDataset {
    fn list(&self, rel_dirs: &[String]) -> Vec<Result<Vec<RemoteEntry>, String>> {
        let paths = self.remote_paths(rel_dirs);
        let results = self
            .runtime
            .block_on(remote_transfer::list_directories(&self.mount, &paths));
        results.into_iter().map(text_error).collect()
    }

    fn fetch(&self, rel_paths: &[String], max_bytes: u64) -> Vec<Result<Vec<u8>, String>> {
        let paths = self.remote_paths(rel_paths);
        let results =
            self.runtime
                .block_on(remote_transfer::read_files(&self.mount, &paths, max_bytes));
        results.into_iter().map(text_error).collect()
    }

    fn headers(&self, rel_paths: &[String]) -> Vec<Result<nifti_loader::HeaderSummary, String>> {
        let paths = self.remote_paths(rel_paths);
        let results = self
            .runtime
            .block_on(remote_transfer::read_headers(&self.mount, &paths));
        results.into_iter().map(text_error).collect()
    }
}

async fn is_remote(state: &BridgeState, path: &Path) -> bool {
    crate::resolve_remote_mount_for_local_path(state, path)
        .await
        .is_some()
}

/// The UI matches this text to stop offering such a path.
const MIRROR_WITHOUT_MOUNT: &str = "is a cached copy of a remote dataset";
const NOT_ON_MIRROR: &str = "not available for a remote dataset";

/// True for a path in the remote mirrors, which are evictable and never the
/// dataset itself. It holds after a restart, when no mount names the path.
fn in_mirror(path: &Path, mirrors: &Path) -> bool {
    let real = |path: &Path| path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    path.starts_with(mirrors) || real(path).starts_with(real(mirrors))
}

async fn is_mirror(state: &BridgeState, path: &Path) -> bool {
    is_remote(state, path).await
        || crate::remote_cache_root().is_ok_and(|mirrors| in_mirror(path, &mirrors))
}

/// A mirror path no live mount answers for: scanning it would pass a partial,
/// evictable cache off as a local dataset.
fn refuse_unmounted_mirror(path: &Path, mounted: bool, mirrors: &Path) -> BridgeResult<()> {
    if !mounted && in_mirror(path, mirrors) {
        return Err(input(format!(
            "{} {MIRROR_WITHOUT_MOUNT} whose mount is not active. Connect the remote folder and open it from there.",
            path.display()
        )));
    }
    Ok(())
}

/// Per-run tables are read from disk, and a remote scan keeps them in memory
/// only: on a mirror they would read as absent, and absent is not empty.
fn refuse_mirror_read(what: &str, mirrored: bool) -> BridgeResult<()> {
    if mirrored {
        return Err(input(format!("{what} {NOT_ON_MIRROR}.")));
    }
    Ok(())
}

/// Stream a dataset scan. Each subject arrives as a `bids-scan-progress` event;
/// series results arrive only in the returned index.
#[command]
#[tracing::instrument(skip_all, err, name = "api.scan_bids_browser")]
pub(crate) async fn scan_bids_browser<R: Runtime>(
    dataset_path: String,
    scan_id: String,
    app: tauri::AppHandle<R>,
    state: State<'_, BridgeState>,
) -> BridgeResult<BidsBrowserIndex> {
    let dataset = PathBuf::from(&dataset_path);
    // Registered first: a scan can be cancelled or superseded from its first await.
    let handle = ScanHandle::register(&dataset_path, &scan_id)?;
    let mount = crate::resolve_remote_mount_for_local_path(state.inner(), &dataset).await;
    if let Ok(mirrors) = crate::remote_cache_root() {
        refuse_unmounted_mirror(&dataset, mount.is_some(), &mirrors)?;
    }
    let cache = cache_root()?;
    let server = mount.map(|(mount, remote_root)| MountDataset {
        mount,
        remote_root,
        runtime: tokio::runtime::Handle::current(),
    });
    tokio::task::spawn_blocking(move || {
        let request = scan::ScanRequest {
            dataset: &dataset,
            scan_id: &scan_id,
            remote: server.as_ref().map(|s| s as &dyn RemoteDataset),
            cache_root: &cache,
        };
        scan::run_scan(&request, &handle, |progress| {
            let _ = app.emit(PROGRESS_EVENT, &progress);
        })
    })
    .await
    .map_err(task_failure)?
    .map_err(input)
}

/// Stop a scan; it returns what it has with `complete: false`.
#[command]
#[tracing::instrument(skip_all, err, name = "api.cancel_bids_scan")]
pub(crate) async fn cancel_bids_scan(scan_id: String) -> BridgeResult<bool> {
    let scans = SCANS.lock().map_err(|_| input("Scan registry poisoned"))?;
    let active = scans.values().find(|active| active.scan_id == scan_id);
    if let Some(active) = active {
        active.cancel.store(true, Ordering::Relaxed);
    }
    Ok(active.is_some())
}

/// A remote scan keeps its files in memory, so the mirror can be empty. The
/// exclusions read needs a dataset root there, best effort.
async fn mirror_description(state: &BridgeState, dataset: &Path) {
    let description = dataset.join("dataset_description.json");
    if let Err(error) = crate::materialize_remote_file_if_needed(state, &description).await {
        log::info!("{} not materialized: {error:?}", description.display());
    }
}

/// Per-volume FD, events checks and derivative provenance for one run.
#[command]
#[tracing::instrument(skip_all, err, name = "api.get_bids_run_detail")]
pub(crate) async fn get_bids_run_detail(
    dataset_path: String,
    run_id: String,
    state: State<'_, BridgeState>,
) -> BridgeResult<BidsRunDetail> {
    let mirrored = is_mirror(state.inner(), Path::new(&dataset_path)).await;
    refuse_mirror_read(
        "Run detail (motion, event checks and provenance) is",
        mirrored,
    )?;
    tokio::task::spawn_blocking(move || scan::run_detail(Path::new(&dataset_path), &run_id))
        .await
        .map_err(task_failure)?
        .map_err(input)
}

/// The events table that applies to a run, including an inherited one.
#[command]
#[tracing::instrument(skip_all, err, name = "api.get_bids_run_events")]
pub(crate) async fn get_bids_run_events(
    dataset_path: String,
    run_id: String,
    state: State<'_, BridgeState>,
) -> BridgeResult<Vec<BidsEventRow>> {
    let mirrored = is_mirror(state.inner(), Path::new(&dataset_path)).await;
    refuse_mirror_read("The events table is", mirrored)?;
    tokio::task::spawn_blocking(move || scan::run_events(Path::new(&dataset_path), &run_id))
        .await
        .map_err(task_failure)?
        .map_err(input)
}

fn require_image_path(path: &str) -> BridgeResult<()> {
    if path.ends_with(".nii") || path.ends_with(".nii.gz") {
        Ok(())
    } else {
        Err(input(format!("Not a NIfTI file: {path}")))
    }
}

async fn materialize(state: &BridgeState, path: &str) -> BridgeResult<()> {
    crate::materialize_remote_file_if_needed(state, Path::new(path)).await
}

/// One thumbnail, from the disk cache or decoded under the semaphore.
#[command]
#[tracing::instrument(skip_all, err, name = "api.get_bids_slice")]
pub(crate) async fn get_bids_slice(
    request: BidsSliceRequest,
    state: State<'_, BridgeState>,
) -> BridgeResult<BidsSliceImage> {
    require_image_path(&request.path)?;
    let cache = cache_root()?;
    if !matches!(request.kind.as_str(), "mean" | "first" | "tsnr" | "anat") {
        return Err(input(format!("Unknown slice kind: {}", request.kind)));
    }
    if let Some(image) = images::cached_slice(&cache, &request) {
        return Ok(image);
    }
    materialize(state.inner(), &request.path).await?;
    let _permit = DECODES.acquire().await.map_err(|e| input(e.to_string()))?;
    tokio::task::spawn_blocking(move || images::get_slice(&cache, &request))
        .await
        .map_err(task_failure)?
        .map_err(input)
}

/// Median of up to 15 runs' slices, windowed alike, on the modal grid.
#[command]
#[tracing::instrument(skip_all, err, name = "api.get_bids_median_slice")]
pub(crate) async fn get_bids_median_slice(
    paths: Vec<String>,
    request: BidsSliceRequest,
    state: State<'_, BridgeState>,
) -> BridgeResult<BidsMedianSliceImage> {
    if paths.is_empty() {
        return Err(input("A median image needs at least one run."));
    }
    for path in &paths {
        require_image_path(path)?;
    }
    // Only the runs a median uses, and none at all when it is already cached.
    let paths = images::median_runs(&paths);
    let cache = cache_root()?;
    if let Some(cached) = images::cached_median(&cache, &paths, &request) {
        return Ok(cached);
    }
    for path in &paths {
        materialize(state.inner(), path).await?;
    }
    let _permit = DECODES.acquire().await.map_err(|e| input(e.to_string()))?;
    tokio::task::spawn_blocking(move || images::get_median_slice(&cache, &paths, &request))
        .await
        .map_err(task_failure)?
        .map_err(input)
}

/// Carpet plot of a 4D run.
#[command]
#[tracing::instrument(skip_all, err, name = "api.get_bids_carpet")]
pub(crate) async fn get_bids_carpet(
    path: String,
    width: u32,
    height: u32,
    state: State<'_, BridgeState>,
) -> BridgeResult<BidsSliceImage> {
    require_image_path(&path)?;
    let cache = cache_root()?;
    if let Some(image) = images::cached_carpet(&cache, Path::new(&path), width, height) {
        return Ok(image);
    }
    materialize(state.inner(), &path).await?;
    let _permit = DECODES.acquire().await.map_err(|e| input(e.to_string()))?;
    tokio::task::spawn_blocking(move || images::get_carpet(&cache, Path::new(&path), width, height))
        .await
        .map_err(task_failure)?
        .map_err(input)
}

async fn reject_remote(state: &BridgeState, path: &Path) -> BridgeResult<()> {
    if is_mirror(state, path).await {
        return Err(input(
            "Exclusions can only be written to a local dataset: a mirror's copy would not reach the server.",
        ));
    }
    Ok(())
}

/// Append exclusion rows below `derivatives/brainflow/`. The raw dataset is
/// never touched and no path is taken from the client below the dataset root.
#[command]
#[tracing::instrument(skip_all, err, name = "api.write_bids_exclusions")]
pub(crate) async fn write_bids_exclusions<R: Runtime>(
    dataset_path: String,
    rows: Vec<BidsExclusion>,
    context: BidsExclusionContext,
    app: tauri::AppHandle<R>,
    state: State<'_, BridgeState>,
) -> BridgeResult<BidsExclusionWrite> {
    let dataset = PathBuf::from(&dataset_path);
    reject_remote(state.inner(), &dataset).await?;
    let version = app.package_info().version.to_string();
    tokio::task::spawn_blocking(move || {
        exclusions::write_exclusions(&dataset, &rows, &context, &version)
    })
    .await
    .map_err(task_failure)?
    .map_err(io_failure)
}

/// The exclusion rows on disk, before any scan has finished.
#[command]
#[tracing::instrument(skip_all, err, name = "api.read_bids_exclusions")]
pub(crate) async fn read_bids_exclusions(
    dataset_path: String,
    state: State<'_, BridgeState>,
) -> BridgeResult<Vec<BidsExclusion>> {
    let dataset = Path::new(&dataset_path);
    mirror_description(state.inner(), dataset).await;
    let table = dataset.join(exclusions::EXCLUSIONS_REL_PATH);
    if let Err(error) = crate::materialize_remote_file_if_needed(state.inner(), &table).await {
        log::info!("{} not materialized: {error:?}", table.display());
    }
    tokio::task::spawn_blocking(move || exclusions::read_exclusions(Path::new(&dataset_path)))
        .await
        .map_err(task_failure)?
        .map_err(io_failure)
}

/// Remove exclusion rows by entity and criterion, atomically. Returns the rows
/// that remain.
#[command]
#[tracing::instrument(skip_all, err, name = "api.revert_bids_exclusions")]
pub(crate) async fn revert_bids_exclusions(
    dataset_path: String,
    keys: Vec<BidsExclusionKey>,
    state: State<'_, BridgeState>,
) -> BridgeResult<Vec<BidsExclusion>> {
    let dataset = PathBuf::from(&dataset_path);
    reject_remote(state.inner(), &dataset).await?;
    tokio::task::spawn_blocking(move || exclusions::revert_exclusions(&dataset, &keys))
        .await
        .map_err(task_failure)?
        .map_err(io_failure)
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIRRORS: &str = "/cache/remote_mounts";

    #[test]
    fn a_path_in_the_mirrors_is_known_without_a_mount() {
        let mirrors = Path::new(MIRRORS);
        assert!(in_mirror(Path::new("/cache/remote_mounts/m1/ds"), mirrors));
        assert!(!in_mirror(Path::new("/cache/remote_mounts2/ds"), mirrors));
        assert!(!in_mirror(Path::new("/data/ds"), mirrors));
    }

    #[test]
    fn a_mirror_without_a_mount_is_refused_and_says_so() {
        let mirrors = Path::new(MIRRORS);
        let path = Path::new("/cache/remote_mounts/m1/ds");
        let message = refuse_unmounted_mirror(path, false, mirrors)
            .unwrap_err()
            .to_string();
        assert!(message.contains(MIRROR_WITHOUT_MOUNT), "{message}");
        assert!(refuse_unmounted_mirror(path, true, mirrors).is_ok());
        assert!(refuse_unmounted_mirror(Path::new("/data/ds"), false, mirrors).is_ok());
    }

    #[test]
    fn a_remote_run_read_is_an_error_and_never_empty() {
        let message = refuse_mirror_read("The events table is", true)
            .unwrap_err()
            .to_string();
        assert!(message.contains("not available"), "{message}");
        assert!(refuse_mirror_read("The events table is", false).is_ok());
    }
}
