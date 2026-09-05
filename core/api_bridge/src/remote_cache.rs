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

pub(crate) fn budget() -> u64 {
    std::env::var("BRAINFLOW_REMOTE_CACHE_BYTES")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_BUDGET)
}

fn directory_bytes(path: &Path) -> BridgeResult<u64> {
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
    let mut used = directory_bytes(root)?;
    let mut candidates = Vec::new();
    for entry in std::fs::read_dir(root).map_err(|e| error(&e.to_string()))? {
        let entry = entry.map_err(|e| error(&e.to_string()))?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let owned = name.starts_with("cache-") || uuid::Uuid::parse_str(&name).is_ok();
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
