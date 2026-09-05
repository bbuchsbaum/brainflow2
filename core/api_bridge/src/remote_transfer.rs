//! Owned transfer workers. Cancellation is observed inside the blocking runtime
//! adapter, so dropping an outer timeout never abandons a writer or its permit.
use super::{map_remotely_error, BridgeError, BridgeResult, RemoteMountEntry};
use crate::remote_transfer;
use serde::Serialize;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::sync::watch;

#[derive(Clone, Debug, Serialize)]
pub(crate) struct Progress {
    pub path: String,
    pub bytes_downloaded: u64,
    pub total_bytes: Option<u64>,
}

#[derive(Default)]
pub(crate) struct Control {
    active: Mutex<HashMap<PathBuf, watch::Sender<bool>>>,
    stopped: std::sync::atomic::AtomicBool,
}
impl Control {
    pub fn begin(
        self: &Arc<Self>,
        path: &Path,
    ) -> BridgeResult<(Registration, watch::Receiver<bool>)> {
        let mut active = self.active.lock().unwrap_or_else(|e| e.into_inner());
        if self.stopped.load(std::sync::atomic::Ordering::Acquire) {
            return Err(error("Remote mount has been unmounted"));
        }
        if active.contains_key(path) {
            return Err(error("This remote file is already being downloaded"));
        }
        let (tx, rx) = watch::channel(false);
        active.insert(path.to_path_buf(), tx);
        Ok((
            Registration {
                control: Arc::clone(self),
                path: path.to_path_buf(),
            },
            rx,
        ))
    }
    pub fn cancel(&self, path: &Path) -> bool {
        self.active
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(path)
            .is_some_and(|tx| tx.send(true).is_ok())
    }
    pub fn is_stopped(&self) -> bool {
        self.stopped.load(std::sync::atomic::Ordering::Acquire)
    }
    pub fn stop(&self) {
        let active = self.active.lock().unwrap_or_else(|e| e.into_inner());
        self.stopped
            .store(true, std::sync::atomic::Ordering::Release);
        for tx in active.values() {
            let _ = tx.send(true);
        }
    }
}
pub(crate) struct Registration {
    control: Arc<Control>,
    path: PathBuf,
}
impl Drop for Registration {
    fn drop(&mut self) {
        self.control
            .active
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&self.path);
    }
}
pub(crate) fn error(message: &str) -> BridgeError {
    BridgeError::Io {
        code: 8218,
        details: message.into(),
    }
}

/// Drop removes only this worker's UUID staging directory, including any .part
/// left by a cancelled upstream future. The worker retains its permit until drop.
pub(crate) struct Staging(pub PathBuf);
impl Staging {
    pub fn new(parent: &Path) -> BridgeResult<Self> {
        let path = parent.join(format!(".transfer-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&path)
            .map_err(|e| error(&format!("Unable to prepare transfer staging: {e}")))?;
        Ok(Self(path))
    }
}
impl Drop for Staging {
    fn drop(&mut self) {
        if let Err(e) = std::fs::remove_dir_all(&self.0) {
            log::warn!(
                "Failed to clean owned transfer staging {}: {e}",
                self.0.display()
            );
        }
    }
}

pub(crate) async fn supervised<T>(
    operation: impl std::future::Future<Output = BridgeResult<T>>,
    mut cancel: watch::Receiver<bool>,
    mut progress: watch::Receiver<tokio::time::Instant>,
    idle_timeout: Duration,
    total_timeout: Duration,
) -> BridgeResult<T> {
    if *cancel.borrow() {
        return Err(error("Remote download cancelled"));
    }
    tokio::pin!(operation);
    let deadline = tokio::time::Instant::now() + total_timeout;
    loop {
        let idle_deadline = *progress.borrow_and_update() + idle_timeout;
        tokio::select! {
            biased;
            _ = cancel.changed() => return Err(error("Remote download cancelled")),
            _ = tokio::time::sleep_until(deadline) => return Err(error("Remote download exceeded its maximum duration")),
            _ = tokio::time::sleep_until(idle_deadline) => return Err(error("Remote download stalled without receiving data")),
            result = &mut operation => return result,
            result = progress.changed() => { if result.is_err() { return Err(error("Remote progress channel closed unexpectedly")); } },
        }
    }
}

pub(crate) async fn stat_owned(
    mount: RemoteMountEntry,
    path: String,
) -> BridgeResult<remotely::fs::Metadata> {
    let runtime = tokio::runtime::Handle::current();
    tokio::task::spawn_blocking(move || {
        runtime.block_on(async move {
            let _permit = mount
                .op_semaphore
                .clone()
                .acquire_owned()
                .await
                .map_err(|_| error("Remote mount closed"))?;
            if mount.transfers.is_stopped() {
                return Err(error("Remote mount has been unmounted"));
            }
            tokio::time::timeout(
                crate::REMOTE_FS_OPERATION_TIMEOUT,
                mount.client.fs().stat(Path::new(&path)),
            )
            .await
            .map_err(|_| error("Timed out checking the remote file"))?
            .map_err(|e| map_remotely_error(e, 8243))
        })
    })
    .await
    .map_err(|e| error(&e.to_string()))?
}

pub(crate) async fn list_owned(
    mount: RemoteMountEntry,
    path: String,
) -> BridgeResult<Vec<remotely::fs::DirEntry>> {
    let runtime = tokio::runtime::Handle::current();
    tokio::task::spawn_blocking(move || {
        runtime.block_on(async move {
            let _permit = mount
                .op_semaphore
                .clone()
                .acquire_owned()
                .await
                .map_err(|_| error("Remote mount closed"))?;
            if mount.transfers.is_stopped() {
                return Err(error("Remote mount has been unmounted"));
            }
            tokio::time::timeout(
                crate::REMOTE_FS_OPERATION_TIMEOUT,
                mount.client.fs().list(Path::new(&path)),
            )
            .await
            .map_err(|_| error("Timed out listing the remote directory"))?
            .map_err(|e| map_remotely_error(e, 8216))
        })
    })
    .await
    .map_err(|e| error(&e.to_string()))?
}

pub(crate) async fn download_owned(
    mount: RemoteMountEntry,
    remote_path: String,
    path: PathBuf,
    expected_size: u64,
    idle_timeout: Duration,
) -> BridgeResult<()> {
    let (registration, cancel) = mount.transfers.begin(&path)?;
    let worker_mount = mount.clone();
    let worker_remote = remote_path.clone();
    let worker_path = path.to_path_buf();
    let runtime = tokio::runtime::Handle::current();
    // The adapter owns the registration, permit, future and staging cleanup.
    tokio::task::spawn_blocking(move || {
        runtime.block_on(async move {
            let _registration = registration;
            let (progress_tx, progress_rx) =
                tokio::sync::watch::channel(tokio::time::Instant::now());
            let _progress_keepalive = progress_tx.clone();
            let operation = async {
                let _permit = worker_mount
                    .op_semaphore
                    .clone()
                    .acquire_owned()
                    .await
                    .map_err(|_| remote_transfer::error("Remote mount has been unmounted"))?;
                let parent = worker_path
                    .parent()
                    .ok_or_else(|| remote_transfer::error("Invalid cache path"))?;
                let staging = remote_transfer::Staging::new(parent)?;
                let staged_file = staging.0.join("download");
                let notify = worker_mount.progress.clone();
                let notify_path = worker_path.to_string_lossy().into_owned();
                notify(remote_transfer::Progress {
                    path: notify_path.clone(),
                    bytes_downloaded: 0,
                    total_bytes: Some(expected_size),
                });
                let last_notification = std::sync::Mutex::new(std::time::Instant::now());
                worker_mount
                    .client
                    .fs()
                    .download_to_path(
                        Path::new(&worker_remote),
                        &staged_file,
                        remotely::DownloadOptions {
                            sync_on_finish: true,
                            progress: Some(Arc::new(move |progress| {
                                progress_tx.send_replace(tokio::time::Instant::now());
                                let mut last =
                                    last_notification.lock().unwrap_or_else(|e| e.into_inner());
                                if last.elapsed() >= Duration::from_millis(100)
                                    || progress.total_bytes == Some(progress.bytes_downloaded)
                                {
                                    *last = std::time::Instant::now();
                                    notify(remote_transfer::Progress {
                                        path: notify_path.clone(),
                                        bytes_downloaded: progress.bytes_downloaded,
                                        total_bytes: progress.total_bytes,
                                    });
                                }
                            })),
                            ..Default::default()
                        },
                    )
                    .await
                    .map_err(|e| map_remotely_error(e, 8218))?;
                let size = tokio::fs::metadata(&staged_file)
                    .await
                    .map_err(|e| remote_transfer::error(&e.to_string()))?
                    .len();
                if size != expected_size {
                    return Err(remote_transfer::error(
                        "Remote file changed during download; retry loading it",
                    ));
                }
                tokio::fs::rename(&staged_file, &worker_path)
                    .await
                    .map_err(|e| {
                        remote_transfer::error(&format!("Unable to publish remote cache file: {e}"))
                    })?;
                Ok(())
            };
            remote_transfer::supervised(
                operation,
                cancel,
                progress_rx,
                idle_timeout,
                Duration::from_secs(3600),
            )
            .await
        })
    })
    .await
    .map_err(|e| remote_transfer::error(&format!("Remote transfer worker failed: {e}")))?
}

#[cfg(test)]
#[path = "remote_transfer_tests.rs"]
mod integration_tests;

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test(start_paused = true)]
    async fn remote_transfer_progress_extends_idle_deadline() {
        let (_cancel, rx) = watch::channel(false);
        let (tx, progress) = watch::channel(tokio::time::Instant::now());
        let operation = async move {
            for _ in 0..4 {
                tokio::time::sleep(Duration::from_secs(20)).await;
                tx.send_replace(tokio::time::Instant::now());
            }
            Ok(80)
        };
        assert_eq!(
            supervised(
                operation,
                rx,
                progress,
                Duration::from_secs(30),
                Duration::from_secs(100)
            )
            .await
            .unwrap(),
            80
        );
    }
    #[tokio::test(start_paused = true)]
    async fn remote_transfer_stall_cancels_the_actual_future() {
        let (_cancel, rx) = watch::channel(false);
        let (_progress, progress) = watch::channel(tokio::time::Instant::now());
        let result = supervised(
            std::future::pending::<BridgeResult<()>>(),
            rx,
            progress,
            Duration::from_secs(30),
            Duration::from_secs(100),
        )
        .await;
        assert!(result.unwrap_err().to_string().contains("stalled"));
    }
    #[tokio::test]
    async fn remote_transfer_stop_and_cancel_release_owned_registration() {
        let control = Arc::new(Control::default());
        let path = Path::new("/fixture");
        let (registration, rx) = control.begin(path).unwrap();
        assert!(control.begin(path).is_err());
        assert!(control.cancel(path));
        let (_progress, progress) = watch::channel(tokio::time::Instant::now());
        assert!(supervised(
            std::future::pending::<BridgeResult<()>>(),
            rx,
            progress,
            Duration::from_secs(30),
            Duration::from_secs(100)
        )
        .await
        .is_err());
        drop(registration);
        assert!(!control.cancel(path));
        control.stop();
        assert!(control.begin(path).is_err());
    }
}
