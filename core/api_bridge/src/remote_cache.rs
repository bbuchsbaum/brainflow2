//! Stable cache identity and bounded, inactive-mount eviction. Active mounts are
//! pinned: reclaiming their files can race a decoder opening a materialized path.
use crate::{remote_transfer::error, BridgeResult};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    time::SystemTime,
};

pub(crate) const DEFAULT_BUDGET: u64 = 4 * 1024 * 1024 * 1024;
pub(crate) static ADMISSION: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

pub(crate) fn identity(host: &str, port: u16, user: &str, remote_root: &str) -> String {
    let identity =
        serde_json::to_vec(&(host, port, user, remote_root)).expect("string tuple serialization");
    format!("cache-{:x}", Sha256::digest(identity))
}

/// Smallest and largest budgets the app accepts from the user.
pub(crate) const MIN_BUDGET: u64 = 256 * 1024 * 1024;
pub(crate) const MAX_BUDGET: u64 = 2 * 1024 * 1024 * 1024 * 1024;
const SETTINGS_FILE: &str = "remote_cache.json";

/// The budget chosen in the app (0 = none), loaded once from the settings file.
static SAVED_BUDGET: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
static SAVED_BUDGET_LOADED: std::sync::Once = std::sync::Once::new();

#[derive(serde::Serialize, serde::Deserialize)]
struct Settings {
    budget_bytes: u64,
}

fn settings_path() -> Option<PathBuf> {
    directories::ProjectDirs::from("org", "Brainflow", "Brainflow")
        .map(|dirs| dirs.config_dir().join(SETTINGS_FILE))
}

fn env_budget() -> Option<u64> {
    std::env::var("BRAINFLOW_REMOTE_CACHE_BYTES")
        .ok()
        .and_then(|v| v.parse().ok())
}

fn saved_budget() -> Option<u64> {
    SAVED_BUDGET_LOADED.call_once(|| {
        let saved = settings_path()
            .and_then(|path| std::fs::read(path).ok())
            .and_then(|bytes| serde_json::from_slice::<Settings>(&bytes).ok())
            .map(|settings| settings.budget_bytes.clamp(MIN_BUDGET, MAX_BUDGET))
            .unwrap_or(0);
        SAVED_BUDGET.store(saved, std::sync::atomic::Ordering::Relaxed);
    });
    match SAVED_BUDGET.load(std::sync::atomic::Ordering::Relaxed) {
        0 => None,
        bytes => Some(bytes),
    }
}

/// `BRAINFLOW_REMOTE_CACHE_BYTES`, else the budget saved in the app, else 4 GiB.
pub(crate) fn budget() -> u64 {
    env_budget().or_else(saved_budget).unwrap_or(DEFAULT_BUDGET)
}

/// Whether the environment variable fixes the budget.
pub(crate) fn budget_from_env() -> bool {
    env_budget().is_some()
}

/// Save the budget chosen in the app.
pub(crate) fn save_budget(bytes: u64) -> BridgeResult<()> {
    if !(MIN_BUDGET..=MAX_BUDGET).contains(&bytes) {
        return Err(error("Cache limit must be between 256 MB and 2 TB"));
    }
    let path = settings_path().ok_or_else(|| error("No settings directory for the cache limit"))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| error(&e.to_string()))?;
    }
    let payload = serde_json::to_vec_pretty(&Settings {
        budget_bytes: bytes,
    })
    .map_err(|e| error(&e.to_string()))?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, payload).map_err(|e| error(&e.to_string()))?;
    std::fs::rename(&tmp, &path).map_err(|e| error(&e.to_string()))?;
    saved_budget();
    SAVED_BUDGET.store(bytes, std::sync::atomic::Ordering::Relaxed);
    Ok(())
}

/// Cache directories this module owns (`cache-*`, or legacy UUID names).
pub(crate) fn is_owned_cache_dir(name: &str) -> bool {
    name.starts_with("cache-") || uuid::Uuid::parse_str(name).is_ok()
}

/// Remove every owned cache directory that is not mounted, with its
/// metadata. Called under ADMISSION. Returns the bytes freed.
pub(crate) fn evict_inactive(root: &Path, active: &HashSet<PathBuf>) -> BridgeResult<u64> {
    if !root.exists() {
        return Ok(0);
    }
    let mut freed = 0u64;
    for entry in std::fs::read_dir(root).map_err(|e| error(&e.to_string()))? {
        let entry = entry.map_err(|e| error(&e.to_string()))?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if !is_dir || !is_owned_cache_dir(&name) || active.contains(&path) {
            continue;
        }
        freed = freed.saturating_add(directory_bytes(&path)?);
        std::fs::remove_dir_all(&path)
            .map_err(|e| error(&format!("Unable to clear remote cache: {e}")))?;
        let metadata = root.join(crate::REMOTE_CACHE_METADATA_DIR_NAME).join(&name);
        if metadata.is_dir() {
            freed = freed.saturating_add(directory_bytes(&metadata)?);
            std::fs::remove_dir_all(metadata).map_err(|e| error(&e.to_string()))?;
        }
    }
    Ok(freed)
}

pub(crate) fn directory_bytes(path: &Path) -> BridgeResult<u64> {
    let mut bytes = 0u64;
    for entry in walkdir::WalkDir::new(path).follow_links(false) {
        let entry = entry.map_err(|e| error(&format!("Unable to inspect remote cache: {e}")))?;
        if entry.file_type().is_file() {
            bytes =
                bytes.saturating_add(entry.metadata().map_err(|e| error(&e.to_string()))?.len());
        }
    }
    Ok(bytes)
}

/// Called under ADMISSION; reserve enough space for the full staging download
/// as well as the existing cached copy. Eviction never follows symlinks.
pub(crate) fn make_room(
    root: &Path,
    active: &HashSet<PathBuf>,
    incoming: u64,
    budget: u64,
) -> BridgeResult<()> {
    if incoming > budget {
        return Err(error("Remote file exceeds the configured cache budget"));
    }
    // No cache yet (first download on this machine): nothing to evict.
    if !root.exists() {
        return Ok(());
    }
    let mut used = directory_bytes(root)?;
    let mut candidates = Vec::new();
    for entry in std::fs::read_dir(root).map_err(|e| error(&e.to_string()))? {
        let entry = entry.map_err(|e| error(&e.to_string()))?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let owned = is_owned_cache_dir(&name);
        if owned
            && entry
                .file_type()
                .map_err(|e| error(&e.to_string()))?
                .is_dir()
            && !active.contains(&path)
        {
            let modified = std::fs::metadata(path.join(".last-used"))
                .or_else(|_| entry.metadata())
                .and_then(|m| m.modified())
                .unwrap_or(SystemTime::UNIX_EPOCH);
            candidates.push((modified, path));
        }
    }
    candidates.sort_by_key(|(modified, _)| *modified);
    for (_, path) in candidates {
        if used.saturating_add(incoming) <= budget {
            break;
        }
        let bytes = directory_bytes(&path)?;
        std::fs::remove_dir_all(&path)
            .map_err(|e| error(&format!("Unable to evict inactive remote cache: {e}")))?;
        used = used.saturating_sub(bytes);
        if let Some(name) = path.file_name() {
            let metadata = root.join(crate::REMOTE_CACHE_METADATA_DIR_NAME).join(name);
            if metadata.is_dir() {
                let bytes = directory_bytes(&metadata)?;
                std::fs::remove_dir_all(metadata).map_err(|e| error(&e.to_string()))?;
                used = used.saturating_sub(bytes);
            }
        }
    }
    if used.saturating_add(incoming) > budget {
        return Err(error("Remote cache is full. Unmount unused remote folders and retry, or increase BRAINFLOW_REMOTE_CACHE_BYTES"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn make_room_admits_into_a_cache_that_does_not_exist_yet() {
        let root =
            std::env::temp_dir().join(format!("brainflow-no-cache-{}", uuid::Uuid::new_v4()));
        assert!(!root.exists());
        make_room(&root, &HashSet::new(), 10, 100).expect("a missing cache root is empty");
        assert!(
            make_room(&root, &HashSet::new(), 101, 100).is_err(),
            "budget still applies"
        );
    }

    #[test]
    fn evict_inactive_keeps_mounted_and_foreign_directories() {
        let root =
            std::env::temp_dir().join(format!("brainflow-evict-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let cleanup = crate::remote_transfer::Staging(root.clone());
        let active = root.join("cache-active");
        let inactive = root.join("cache-old");
        let foreign = root.join("keep-me");
        let metadata = root
            .join(crate::REMOTE_CACHE_METADATA_DIR_NAME)
            .join("cache-old");
        for path in [&active, &inactive, &foreign, &metadata] {
            std::fs::create_dir_all(path).unwrap();
            std::fs::write(path.join("data"), vec![1; 10]).unwrap();
        }
        let freed = evict_inactive(&root, &HashSet::from([active.clone()])).unwrap();
        assert_eq!(freed, 20);
        assert!(active.exists() && foreign.exists());
        assert!(!inactive.exists() && !metadata.exists());
        drop(cleanup);
    }

    #[test]
    fn remote_cache_identity_is_session_independent_and_endpoint_specific() {
        assert_eq!(
            identity("host", 22, "user", "/data"),
            identity("host", 22, "user", "/data")
        );
        assert_ne!(
            identity("host", 22, "user", "/data"),
            identity("host", 22, "other", "/data")
        );
        assert_ne!(
            identity("host", 22, "user", "/data"),
            identity("host", 2222, "user", "/data")
        );
    }
    #[test]
    fn remote_cache_evicts_only_inactive_owned_roots_and_enforces_budget() {
        let root =
            std::env::temp_dir().join(format!("brainflow-cache-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let cleanup = crate::remote_transfer::Staging(root.clone());
        let active = root.join("cache-active");
        let inactive = root.join("cache-old");
        let foreign = root.join("other");
        for path in [&active, &inactive, &foreign] {
            std::fs::create_dir(path).unwrap();
            std::fs::write(path.join("data"), vec![1; 20]).unwrap();
        }
        let pinned = HashSet::from([active.clone()]);
        make_room(&root, &pinned, 20, 65).unwrap();
        assert!(!inactive.exists());
        assert!(active.exists());
        assert!(foreign.exists());
        assert!(make_room(&root, &pinned, 30, 65).is_err());
        assert!(make_room(&root, &pinned, 66, 65).is_err());
        drop(cleanup);
    }
}
