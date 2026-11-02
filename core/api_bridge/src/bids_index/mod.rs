//! Pure logic behind the BIDS browser: per-run index, effective metadata with
//! provenance, acquisition variants, content checks, FD, derivatives, the
//! stored index and the exclusion writer. Nothing here knows about Tauri;
//! `bids_commands.rs` is the adapter.

pub(crate) mod derivatives;
pub(crate) mod events;
pub(crate) mod exclusions;
pub(crate) mod fd;
pub(crate) mod fieldmap;
pub(crate) mod images;
pub(crate) mod meta;
pub(crate) mod remote;
pub(crate) mod scan;
pub(crate) mod series;
pub(crate) mod store;

#[cfg(test)]
mod real_data_tests;
#[cfg(test)]
mod tests;

use bridge_types::bids::BidsFinding;
use sha2::{Digest, Sha256};
use std::cmp::Ordering;
use std::collections::BTreeMap;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

/// A filename split into entities, suffix and extension.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ParsedName {
    pub stem: String,
    pub entities: BTreeMap<String, String>,
    pub suffix: String,
    pub extension: String,
}

impl ParsedName {
    pub fn entity(&self, key: &str) -> Option<&str> {
        self.entities.get(key).map(String::as_str)
    }

    pub fn subject(&self) -> Option<&str> {
        self.entity("sub")
    }
}

/// Split a BIDS filename. Returns `None` when it has no `key-value` entities.
pub(crate) fn parse_name(file_name: &str) -> Option<ParsedName> {
    let (stem, extension) = file_name.split_once('.')?;
    let (entity_part, suffix) = stem.rsplit_once('_')?;
    let mut entities = BTreeMap::new();
    for part in entity_part.split('_') {
        let (key, value) = part.split_once('-')?;
        if key.is_empty() || value.is_empty() {
            return None;
        }
        entities.insert(key.to_string(), value.to_string());
    }
    Some(ParsedName {
        stem: stem.to_string(),
        entities,
        suffix: suffix.to_string(),
        extension: format!(".{extension}"),
    })
}

pub(crate) fn is_image_extension(extension: &str) -> bool {
    matches!(extension, ".nii" | ".nii.gz")
}

/// Entities that split runs of one series from each other, not series.
const NON_SERIES_ENTITIES: [&str; 4] = ["sub", "ses", "run", "task"];
const SERIES_ORDER: [&str; 5] = ["acq", "ce", "rec", "dir", "echo"];

/// Series label: `task-nback_bold`, `T1w`, `epi_dir-AP`. `acq`, `ce`, `rec`,
/// `dir`, `echo` and any other non-subject entity keep series apart.
pub(crate) fn series_label(name: &ParsedName) -> String {
    let mut parts: Vec<String> = SERIES_ORDER
        .iter()
        .filter_map(|&key| name.entity(key).map(|value| format!("{key}-{value}")))
        .collect();
    parts.extend(
        name.entities
            .iter()
            .filter(|(key, _)| {
                !NON_SERIES_ENTITIES.contains(&key.as_str())
                    && !SERIES_ORDER.contains(&key.as_str())
            })
            .map(|(key, value)| format!("{key}-{value}")),
    );
    let mut out = Vec::with_capacity(parts.len() + 2);
    match name.entity("task") {
        Some(task) => {
            out.push(format!("task-{task}"));
            out.extend(parts);
            out.push(name.suffix.clone());
        }
        None => {
            out.push(name.suffix.clone());
            out.extend(parts);
        }
    }
    out.join("_")
}

/// Compare strings with digit runs ordered by value, so `run-2` < `run-10`.
pub(crate) fn natural_cmp(a: &str, b: &str) -> Ordering {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    let (mut i, mut j) = (0, 0);
    while i < a.len() && j < b.len() {
        if a[i].is_ascii_digit() && b[j].is_ascii_digit() {
            let (start_a, start_b) = (i, j);
            while i < a.len() && a[i].is_ascii_digit() {
                i += 1;
            }
            while j < b.len() && b[j].is_ascii_digit() {
                j += 1;
            }
            let trim = |digits: &'_ [u8]| -> Vec<u8> {
                let start = digits
                    .iter()
                    .position(|&d| d != b'0')
                    .unwrap_or(digits.len());
                digits[start..].to_vec()
            };
            let (da, db) = (trim(&a[start_a..i]), trim(&b[start_b..j]));
            let order = da.len().cmp(&db.len()).then_with(|| da.cmp(&db));
            if order != Ordering::Equal {
                return order;
            }
        } else {
            if a[i] != b[j] {
                return a[i].cmp(&b[j]);
            }
            i += 1;
            j += 1;
        }
    }
    (a.len() - i).cmp(&(b.len() - j))
}

pub(crate) fn sha256_hex(parts: &[&str]) -> String {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update(part.as_bytes());
        hasher.update([0u8]);
    }
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// Everything needed to build one finding. The id hashes the identity of the
/// problem, never its numbers, so it is stable across rescans.
pub(crate) struct FindingSpec<'a> {
    pub tag: &'a str,
    pub severity: &'a str,
    pub code: &'a str,
    pub title: String,
    pub detail: String,
    pub subject: Option<&'a str>,
    pub session: Option<&'a str>,
    pub run_ids: Vec<String>,
    pub file: Option<String>,
}

pub(crate) fn finding(spec: FindingSpec<'_>) -> BidsFinding {
    let mut sorted_runs = spec.run_ids.clone();
    sorted_runs.sort();
    let hash = sha256_hex(&[
        spec.tag,
        spec.code,
        spec.subject.unwrap_or(""),
        spec.session.unwrap_or(""),
        spec.file.as_deref().unwrap_or(""),
        &sorted_runs.join(","),
    ]);
    BidsFinding {
        id: format!("{}:{}", spec.code, &hash[..16]),
        tag: spec.tag.to_string(),
        severity: spec.severity.to_string(),
        code: spec.code.to_string(),
        title: spec.title,
        detail: spec.detail,
        subject: spec.subject.map(str::to_string),
        session: spec.session.map(str::to_string),
        run_ids: spec.run_ids,
        file: spec.file,
    }
}

/// A dataset-relative path with `/` separators on every platform, as BIDS and
/// the bridge contract spell it.
pub(crate) fn rel_text(path: &Path) -> String {
    let parts: Vec<String> = path
        .iter()
        .map(|part| part.to_string_lossy().into_owned())
        .collect();
    parts.join("/")
}

/// RFC 3339 in UTC, to the second.
pub(crate) fn rfc3339_utc(time: SystemTime) -> Option<String> {
    let secs = time.duration_since(UNIX_EPOCH).ok()?.as_secs() as i64;
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    // Civil-from-days (Howard Hinnant).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    Some(format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rem / 3_600,
        rem % 3_600 / 60,
        rem % 60
    ))
}

/// `size:mtime-ns` of a file, the unit of incremental rescans and image caches.
pub(crate) fn file_stamp(path: &Path) -> Option<String> {
    let meta = std::fs::metadata(path).ok()?;
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_nanos());
    Some(format!("{}:{mtime}", meta.len()))
}

/// The same `size:mtime-ns` from an index entry, taken from the walk's own stat
/// or the server's listing, so a stamp costs no further I/O. Empty for a dangling
/// link, as `file_stamp` gives none.
pub(crate) fn entry_stamp(entry: &bids_rs::IndexEntry) -> String {
    if !entry.is_available {
        return String::new();
    }
    let mtime = entry
        .modified
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_nanos());
    format!("{}:{mtime}", entry.size)
}

/// Write beside the target, fsync, rename. The temporary file is `create_new`
/// and is removed on failure.
pub(crate) fn write_atomic(target: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let parent = target
        .parent()
        .ok_or_else(|| format!("No parent directory for {}", target.display()))?;
    let name = target
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| format!("Invalid file name: {}", target.display()))?;
    let temp = parent.join(format!(".{name}.{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| -> std::io::Result<()> {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temp, target)
    })();
    if let Err(e) = result {
        let _ = std::fs::remove_file(&temp);
        return Err(format!("Failed to write {}: {e}", target.display()));
    }
    if let Ok(dir) = std::fs::File::open(parent) {
        let _ = dir.sync_all();
    }
    Ok(())
}

pub(crate) type TsvReader = csv::Reader<Box<dyn std::io::Read>>;

/// Tab-separated reader over any stream, gunzipping when `gzipped`. Quotes are
/// data in BIDS TSV.
pub(crate) fn tsv_from(stream: impl std::io::Read + 'static, gzipped: bool) -> TsvReader {
    let stream: Box<dyn std::io::Read> = if gzipped {
        Box::new(flate2::read::GzDecoder::new(stream))
    } else {
        Box::new(stream)
    };
    csv::ReaderBuilder::new()
        .delimiter(b'\t')
        .quoting(false)
        .flexible(true)
        .from_reader(stream)
}

/// Tab-separated reader for a local `.tsv` or `.tsv.gz`.
pub(crate) fn tsv_reader(path: &Path) -> Result<TsvReader, String> {
    let file =
        std::fs::File::open(path).map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
    Ok(tsv_from(
        file,
        path.extension().is_some_and(|ext| ext == "gz"),
    ))
}
