//! The stored index, one JSON file per dataset in the app cache, outside the
//! evicted remote cache. It lets rescans skip unchanged subjects and gives
//! "since last scan" its baseline.

use super::{sha256_hex, write_atomic};
use bridge_types::bids::{BidsFinding, BidsRunRecord};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// Raise when results for unchanged files change, so old entries are not reused.
const STORE_VERSION: u32 = 5;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct SubjectCache {
    /// Hash of (path, size, mtime) of every file this subject's results read.
    pub fingerprint: String,
    pub runs: Vec<BidsRunRecord>,
    pub findings: Vec<BidsFinding>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct ValidatorCache {
    pub fingerprint: String,
    pub findings: Vec<BidsFinding>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct StoredIndex {
    pub version: u32,
    /// Time of the last complete scan; a cancelled scan leaves it alone.
    pub scanned_at: Option<String>,
    pub known_subjects: Vec<String>,
    pub subjects: BTreeMap<String, SubjectCache>,
    pub validator: Option<ValidatorCache>,
    /// Findings about files above the subject level.
    pub shared_findings: Vec<BidsFinding>,
}

impl Default for StoredIndex {
    fn default() -> Self {
        Self {
            version: STORE_VERSION,
            scanned_at: None,
            known_subjects: Vec::new(),
            subjects: BTreeMap::new(),
            validator: None,
            shared_findings: Vec::new(),
        }
    }
}

pub(crate) fn store_path(cache_root: &Path, dataset: &Path) -> PathBuf {
    let key = sha256_hex(&[&dataset.to_string_lossy()]);
    cache_root.join("bids-index").join(format!("{key}.json"))
}

/// A missing, corrupt or older index is a first scan.
pub(crate) fn load(cache_root: &Path, dataset: &Path) -> StoredIndex {
    std::fs::read(store_path(cache_root, dataset))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<StoredIndex>(&bytes).ok())
        .filter(|stored| stored.version == STORE_VERSION)
        .unwrap_or_default()
}

pub(crate) fn save(cache_root: &Path, dataset: &Path, stored: &StoredIndex) -> Result<(), String> {
    let path = store_path(cache_root, dataset);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Cannot create {}: {e}", parent.display()))?;
    }
    let bytes = serde_json::to_vec(stored).map_err(|e| format!("Cannot encode index: {e}"))?;
    write_atomic(&path, &bytes)
}
