//! The exclusion writer, the only code that writes into a dataset. It writes
//! fixed names below `derivatives/brainflow/`, takes no client path below the
//! dataset root, and refuses symlinked components.

use super::{derivatives::OWN_PIPELINE, write_atomic};
use bridge_types::bids::{
    BidsExclusion, BidsExclusionContext, BidsExclusionKey, BidsExclusionWrite,
};
use serde_json::{json, Map, Value};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

const COLUMNS: [&str; 10] = [
    "entity",
    "reason",
    "criterion",
    "value",
    "author",
    "date",
    "source",
    "threshold",
    "definition",
    "triggered_by",
];
/// Files written before rows carried their own criteria stay readable.
const LEGACY_COLUMNS: usize = 7;
const TSV_NAME: &str = "exclusions.tsv";
const LOCK_NAME: &str = ".exclusions.lock";
/// A lock this old belongs to a process that died mid-write.
const STALE_LOCK: Duration = Duration::from_secs(60);
const LOCK_TRIES: u32 = 50;
const LOCK_WAIT: Duration = Duration::from_millis(100);
/// The specification this derivative follows. Not the raw dataset's version:
/// a raw dataset may predate `DatasetType` and `GeneratedBy` (BIDS 1.4.0).
const BIDS_VERSION: &str = "1.9.0";

/// Serialises read-modify-write cycles within the app.
static WRITE_LOCK: Mutex<()> = Mutex::new(());

/// Serialises them across processes and machines sharing a drive: `create_new`
/// is atomic, so a second writer waits instead of losing rows. The file holds
/// its owner's token, so a writer whose lock was taken over leaves the new one.
#[derive(Debug)]
pub(crate) struct DatasetLock {
    path: PathBuf,
    token: String,
}

fn is_stale(path: &Path) -> bool {
    std::fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| SystemTime::now().duration_since(time).ok())
        .is_some_and(|age| age > STALE_LOCK)
}

/// Claim a dead lock. The rename is atomic, so of two takers only one gets it.
/// The other's retry can still follow a takeover that already made a new lock
/// between its age check and its rename: a fresh file is put back, without
/// replacing anything. A drive without hard links loses that one narrow case.
fn clear_stale(path: &Path) {
    let claimed = path.with_file_name(format!("{LOCK_NAME}.{}", uuid::Uuid::new_v4()));
    if std::fs::rename(path, &claimed).is_err() {
        return;
    }
    if !is_stale(&claimed) {
        let _ = std::fs::hard_link(&claimed, path);
    }
    let _ = std::fs::remove_file(&claimed);
}

impl DatasetLock {
    pub(crate) fn take(dir: &Path) -> Result<Self, String> {
        let path = dir.join(LOCK_NAME);
        let token = uuid::Uuid::new_v4().to_string();
        for _ in 0..LOCK_TRIES {
            match std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
            {
                Ok(mut file) => {
                    file.write_all(token.as_bytes())
                        .map_err(|e| format!("Cannot lock {}: {e}", path.display()))?;
                    return Ok(Self { path, token });
                }
                Err(e) if e.kind() == ErrorKind::AlreadyExists => {
                    if is_stale(&path) {
                        clear_stale(&path);
                        continue;
                    }
                    std::thread::sleep(LOCK_WAIT);
                }
                Err(e) => return Err(format!("Cannot lock {}: {e}", path.display())),
            }
        }
        Err("Another process is writing exclusions; nothing was changed.".to_string())
    }
}

impl Drop for DatasetLock {
    fn drop(&mut self) {
        let ours = std::fs::read_to_string(&self.path).is_ok_and(|held| held == self.token);
        if ours {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

/// BIDS TSV has no quoting, so separators in free text are backslash-escaped.
fn escape_cell(text: &str) -> String {
    if text.is_empty() {
        return "n/a".to_string();
    }
    text.replace('\\', "\\\\")
        .replace('\t', "\\t")
        .replace('\r', "\\r")
        .replace('\n', "\\n")
}

fn unescape_cell(text: &str) -> String {
    if text == "n/a" {
        return String::new();
    }
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('t') => out.push('\t'),
            Some('n') => out.push('\n'),
            Some('r') => out.push('\r'),
            Some(other) => out.push(other),
            None => out.push('\\'),
        }
    }
    out
}

/// `run`, `session` or `participant`, from the shape of the entity.
fn scope_of(entity: &str) -> &'static str {
    match entity.split('_').count() {
        1 => "participant",
        2 if entity
            .split('_')
            .nth(1)
            .is_some_and(|p| p.starts_with("ses-")) =>
        {
            "session"
        }
        _ => "run",
    }
}

fn valid_entity(entity: &str) -> bool {
    entity.starts_with("sub-")
        && entity.len() > 4
        && entity
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-'))
}

fn render_tsv(rows: &[BidsExclusion]) -> String {
    let mut out = COLUMNS.join("\t");
    out.push('\n');
    for row in rows {
        let cells = [
            &row.entity,
            &row.reason,
            &row.criterion,
            &row.value,
            &row.author,
            &row.date,
            &row.source,
            &row.threshold,
            &row.definition,
            &row.triggered_by,
        ];
        let cells: Vec<String> = cells.iter().map(|cell| escape_cell(cell)).collect();
        out.push_str(&cells.join("\t"));
        out.push('\n');
    }
    out
}

pub(crate) fn parse_tsv(text: &str) -> Result<Vec<BidsExclusion>, String> {
    let mut lines = text.lines();
    let header = lines.next().unwrap_or("");
    let legacy = header == COLUMNS[..LEGACY_COLUMNS].join("\t");
    if !legacy && header != COLUMNS.join("\t") {
        return Err(format!(
            "{TSV_NAME} has unexpected columns; it was not changed."
        ));
    }
    let mut rows = Vec::new();
    for line in lines.filter(|line| !line.is_empty()) {
        let mut cells: Vec<String> = line.split('\t').map(unescape_cell).collect();
        if legacy && cells.len() == LEGACY_COLUMNS {
            cells.resize(COLUMNS.len(), String::new());
        }
        let [entity, reason, criterion, value, author, date, source, threshold, definition, triggered_by] =
            <[String; 10]>::try_from(cells)
                .map_err(|_| format!("{TSV_NAME} has a malformed row; it was not changed."))?;
        rows.push(BidsExclusion {
            scope: scope_of(&entity).to_string(),
            entity,
            reason,
            criterion,
            value,
            author,
            date,
            source,
            threshold,
            definition,
            triggered_by,
        });
    }
    Ok(rows)
}

/// The dataset root, checked, or an error. Only an existing BIDS root passes.
fn checked_root(dataset: &Path) -> Result<PathBuf, String> {
    let root = dataset
        .canonicalize()
        .map_err(|e| format!("Cannot access {}: {e}", dataset.display()))?;
    if !root.join("dataset_description.json").is_file() {
        return Err(format!("{} is not a BIDS dataset root.", root.display()));
    }
    Ok(root)
}

/// Require a real directory; `create` makes it when absent.
fn checked_dir(path: &Path, create: bool) -> Result<bool, String> {
    match std::fs::symlink_metadata(path) {
        Ok(meta) if meta.is_dir() => Ok(true),
        Ok(_) => Err(format!(
            "{} is not a real directory; refusing to write through it.",
            path.display()
        )),
        Err(e) if e.kind() == ErrorKind::NotFound => {
            if !create {
                return Ok(false);
            }
            match std::fs::create_dir(path) {
                Ok(()) => Ok(true),
                // Lost a race: look again, so a planted symlink still fails.
                Err(e) if e.kind() == ErrorKind::AlreadyExists => checked_dir(path, false),
                Err(e) => Err(format!("Cannot create {}: {e}", path.display())),
            }
        }
        Err(e) => Err(format!("Cannot inspect {}: {e}", path.display())),
    }
}

/// The real output directory, or `None` when it does not exist and `create`
/// is false.
fn output_dir(root: &Path, create: bool) -> Result<Option<PathBuf>, String> {
    let derivatives = root.join("derivatives");
    if !checked_dir(&derivatives, create)? {
        return Ok(None);
    }
    let out = derivatives.join(OWN_PIPELINE);
    Ok(checked_dir(&out, create)?.then_some(out))
}

/// An output file must be absent or a regular file: renaming over a symlink
/// is safe for its target, but it would hide a tampered tree.
fn checked_file(path: &Path) -> Result<(), String> {
    match std::fs::symlink_metadata(path) {
        Ok(meta) if meta.is_file() => Ok(()),
        Ok(_) => Err(format!(
            "{} is not a regular file; refusing to write it.",
            path.display()
        )),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Cannot inspect {}: {e}", path.display())),
    }
}

fn read_rows(dir: &Path) -> Result<Vec<BidsExclusion>, String> {
    let path = dir.join(TSV_NAME);
    checked_file(&path)?;
    match std::fs::read_to_string(&path) {
        Ok(text) => parse_tsv(&text),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(format!("Cannot read {}: {e}", path.display())),
    }
}

/// Rows on disk, for the scan. Absence is an empty list.
/// The table's dataset-relative path.
pub(crate) const EXCLUSIONS_REL_PATH: &str = "derivatives/brainflow/exclusions.tsv";

pub(crate) fn read_exclusions(dataset: &Path) -> Result<Vec<BidsExclusion>, String> {
    let root = checked_root(dataset)?;
    match output_dir(&root, false)? {
        Some(dir) => read_rows(&dir),
        None => Ok(Vec::new()),
    }
}

fn read_raw_description(root: &Path) -> Map<String, Value> {
    std::fs::read_to_string(root.join("dataset_description.json"))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// `SourceDatasets` entry: the raw DOI when it has one, else the raw dataset
/// by relative URI from `derivatives/brainflow`.
fn source_dataset(raw: &Map<String, Value>, version: Option<&str>) -> Value {
    let doi = raw.get("DatasetDOI").and_then(Value::as_str);
    let mut entry = Map::new();
    match doi {
        Some(doi) if doi.starts_with("doi:") => {
            entry.insert("DOI".into(), json!(doi));
        }
        Some(doi) if !doi.is_empty() => {
            entry.insert("DOI".into(), json!(format!("doi:{doi}")));
        }
        _ => {
            entry.insert("URL".into(), json!("../.."));
        }
    }
    if let Some(version) = version {
        entry.insert("Version".into(), json!(version));
    }
    Value::Object(entry)
}

fn description_json(
    raw: &Map<String, Value>,
    context: &BidsExclusionContext,
    app_version: &str,
) -> Value {
    let version = context.source_version.as_deref().or_else(|| {
        ["DatasetVersion", "Version"]
            .iter()
            .find_map(|key| raw.get(*key).and_then(Value::as_str))
    });
    json!({
        "Name": "Brainflow exclusions",
        "BIDSVersion": BIDS_VERSION,
        "DatasetType": "derivative",
        "GeneratedBy": [{ "Name": "Brainflow", "Version": app_version }],
        "SourceDatasets": [source_dataset(raw, version)],
    })
}

/// Describes the columns. Criteria live on each row, not here: one sidecar
/// cannot speak for rows made under different thresholds.
fn sidecar_json() -> Value {
    json!({
        "entity": {
            "Description": "What is excluded: a run (file stem with suffix), sub-XX_ses-YY, or sub-XX."
        },
        "reason": { "Description": "Why it is excluded, in the author's words." },
        "criterion": { "Description": "The criterion applied, for example fd_mean>0.25." },
        "value": {
            "Description": "The value that met the criterion. For a session or participant row, the value of the run in triggered_by."
        },
        "author": { "Description": "Who made the exclusion." },
        "date": { "Description": "Date of the exclusion (YYYY-MM-DD)." },
        "source": { "Description": "Where the value came from, with tool and version." },
        "threshold": { "Description": "The threshold the criterion used, or n/a." },
        "definition": { "Description": "The framewise displacement definition behind value, or n/a." },
        "triggered_by": {
            "Description": "For a session or participant row: the run the value was measured on."
        },
    })
}

fn pretty(value: &Value) -> Result<Vec<u8>, String> {
    let mut bytes =
        serde_json::to_vec_pretty(value).map_err(|e| format!("Cannot encode JSON: {e}"))?;
    bytes.push(b'\n');
    Ok(bytes)
}

/// Add rows; an entity already excluded under the same criterion stays as it
/// is. Metadata goes first, so a failure leaves no row without its description.
/// The first write creates the derivative's metadata.
pub(crate) fn write_exclusions(
    dataset: &Path,
    rows: &[BidsExclusion],
    context: &BidsExclusionContext,
    app_version: &str,
) -> Result<BidsExclusionWrite, String> {
    if let Some(row) = rows.iter().find(|row| !valid_entity(&row.entity)) {
        return Err(format!("Invalid exclusion entity: {}", row.entity));
    }
    let _guard = WRITE_LOCK.lock().map_err(|_| "Exclusion lock poisoned")?;
    let root = checked_root(dataset)?;
    let dir = output_dir(&root, true)?.ok_or("Could not create the output directory")?;
    let (tsv, sidecar, description) = (
        dir.join(TSV_NAME),
        dir.join("exclusions.json"),
        dir.join("dataset_description.json"),
    );
    for path in [&tsv, &sidecar, &description] {
        checked_file(path)?;
    }
    let _lock = DatasetLock::take(&dir)?;
    let mut all = read_rows(&dir)?;
    let mut added = Vec::new();
    for row in rows {
        let duplicate = all
            .iter()
            .any(|old| old.entity == row.entity && old.criterion == row.criterion);
        if !duplicate {
            let mut row = row.clone();
            row.scope = scope_of(&row.entity).to_string();
            all.push(row.clone());
            added.push(row);
        }
    }
    write_atomic(&sidecar, &pretty(&sidecar_json())?)?;
    if !description.exists() {
        let raw = read_raw_description(&root);
        write_atomic(
            &description,
            &pretty(&description_json(&raw, context, app_version))?,
        )?;
    }
    write_atomic(&tsv, render_tsv(&all).as_bytes())?;
    Ok(BidsExclusionWrite { all, added })
}

/// Remove exactly these rows, in one rewrite. Returns the rows that remain.
pub(crate) fn revert_exclusions(
    dataset: &Path,
    keys: &[BidsExclusionKey],
) -> Result<Vec<BidsExclusion>, String> {
    let _guard = WRITE_LOCK.lock().map_err(|_| "Exclusion lock poisoned")?;
    let root = checked_root(dataset)?;
    let Some(dir) = output_dir(&root, false)? else {
        return Ok(Vec::new());
    };
    let _lock = DatasetLock::take(&dir)?;
    let mut rows = read_rows(&dir)?;
    let before = rows.len();
    rows.retain(|row| {
        !keys
            .iter()
            .any(|key| key.entity == row.entity && key.criterion == row.criterion)
    });
    if rows.len() != before {
        write_atomic(&dir.join(TSV_NAME), render_tsv(&rows).as_bytes())?;
    }
    Ok(rows)
}
