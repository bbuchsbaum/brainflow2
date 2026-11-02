//! Effective sidecar metadata with provenance.
//!
//! Merge order and provenance come from the `bids_rs` metadata snapshot; this
//! file keeps the acquisition keys and the canonical forms compared across runs.
//! The snapshot resolves all or nothing, so a run touched by a malformed sidecar
//! is merged here, one candidate at a time, with the same ordering.

use super::remote::ScanFiles;
use super::{sha256_hex, FindingSpec};
use bids_rs::metadata::{ancestor_chain, candidate_applies, direct_sidecar_path};
use bids_rs::{parse_bids_filename, BidsProject, MetadataScope, ResolvedMetadata};
use bridge_types::bids::{BidsFinding, BidsMetaValue};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};

/// Effective metadata keys the browser keeps per run.
pub(crate) const ACQUISITION_KEYS: [&str; 22] = [
    "RepetitionTime",
    "EchoTime",
    "EchoTime1",
    "EchoTime2",
    "FlipAngle",
    "MultibandAccelerationFactor",
    "ParallelReductionFactorInPlane",
    "PhaseEncodingDirection",
    "SliceEncodingDirection",
    "SliceTiming",
    "SoftwareVersions",
    "EffectiveEchoSpacing",
    "TotalReadoutTime",
    "InversionTime",
    "Manufacturer",
    "ManufacturersModelName",
    "MagneticFieldStrength",
    "B0FieldIdentifier",
    "B0FieldSource",
    "IntendedFor",
    "BandwidthPerPixelPhaseEncode",
    "TaskName",
];

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct EffectiveEntry {
    pub value: Value,
    pub source: String,
    pub source_kind: String,
}

pub(crate) type Effective = BTreeMap<String, EffectiveEntry>;

/// Resolves sidecars from a project's metadata snapshot, keeping what the scan
/// reports: which sidecars were used and which could not be.
pub(crate) struct SidecarResolver<'a> {
    project: &'a BidsProject,
    used: HashSet<PathBuf>,
    reported: HashSet<String>,
    /// Distinct sidecars this scan used.
    pub reads: u64,
    unreadable: Vec<(String, String)>,
    /// Raw sidecars by directory, built the first time a merge needs them.
    directories: Option<HashMap<PathBuf, Vec<PathBuf>>>,
    /// Each sidecar parsed by `merge_each`, or why it could not be.
    parsed: HashMap<PathBuf, Result<SidecarValues, String>>,
    /// Where those sidecars are read. `None` is the local disk.
    files: Option<&'a ScanFiles>,
}

type SidecarValues = HashMap<String, Value>;

impl<'a> SidecarResolver<'a> {
    pub fn new(project: &'a BidsProject) -> Self {
        Self {
            project,
            used: HashSet::new(),
            reported: HashSet::new(),
            reads: 0,
            unreadable: Vec::new(),
            directories: None,
            parsed: HashMap::new(),
            files: None,
        }
    }

    /// A resolver that reads sidecars through `files`, as a remote scan must.
    pub fn with_files(project: &'a BidsProject, files: &'a ScanFiles) -> Self {
        Self {
            files: Some(files),
            ..Self::new(project)
        }
    }

    fn rel(&self, path: &Path) -> String {
        super::rel_text(path.strip_prefix(self.project.path()).unwrap_or(path))
    }

    fn note_failure(&mut self, rel: String, detail: String) {
        if self.reported.insert(rel.clone()) {
            self.unreadable.push((rel, detail));
        }
    }

    fn read_sidecar(&mut self, path: &Path) -> Result<&SidecarValues, String> {
        let files = self.files;
        let parsed = self.parsed.entry(path.to_path_buf()).or_insert_with(|| {
            let text = match files {
                Some(files) => files.text(path),
                None => std::fs::read_to_string(path).map_err(|e| e.to_string()),
            }
            .map_err(|e| format!("could not read sidecar: {e}"))?;
            serde_json::from_str(&text).map_err(|e| format!("invalid JSON: {e}"))
        });
        parsed.as_ref().map_err(String::clone)
    }

    fn sidecars_in(&mut self, directory: &Path) -> Vec<PathBuf> {
        let project = self.project;
        let directories = self.directories.get_or_insert_with(|| {
            let mut map: HashMap<PathBuf, Vec<PathBuf>> = HashMap::new();
            for entry in project.index().files() {
                let json = entry.abs_path.extension().is_some_and(|ext| ext == "json");
                if json && !entry.is_derivative {
                    if let Some(parent) = entry.abs_path.parent() {
                        map.entry(parent.to_path_buf())
                            .or_default()
                            .push(entry.abs_path.clone());
                    }
                }
            }
            map
        });
        directories.get(directory).cloned().unwrap_or_default()
    }

    /// The upstream merge, but a sidecar that cannot be used is reported and
    /// skipped so the others still apply. `None` for an unparseable filename.
    fn merge_each(&mut self, file: &Path) -> Option<ResolvedMetadata> {
        let name = file.file_name()?.to_str()?;
        let target = parse_bids_filename(name).ok()?;
        let entities = target.entities.as_map();
        let root = self.project.path().to_path_buf();
        let mut candidates = Vec::new();
        for (depth, directory) in ancestor_chain(file.parent()?, &root).iter().enumerate() {
            for path in self.sidecars_in(directory) {
                let applies = path
                    .file_name()
                    .and_then(|sidecar| sidecar.to_str())
                    .and_then(|sidecar| candidate_applies(sidecar, entities, &target.suffix));
                if let Some(entity_count) = applies {
                    candidates.push((depth, entity_count, path));
                }
            }
        }
        candidates.sort();
        let mut merged = ResolvedMetadata::default();
        for (_, _, path) in candidates {
            match self.read_sidecar(&path) {
                Ok(values) => {
                    for (key, value) in values {
                        merged.values.insert(key.clone(), value.clone());
                        merged.sources.insert(key.clone(), path.clone());
                    }
                    merged.sidecars.push(path);
                }
                Err(detail) => self.note_failure(self.rel(&path), detail),
            }
        }
        Some(merged)
    }

    /// Effective metadata for a file of the raw dataset.
    pub fn effective(&mut self, file: &Path) -> Effective {
        let upstream = self
            .project
            .get_metadata_with_provenance(file, true, MetadataScope::Raw);
        let resolved = match upstream {
            Ok(resolved) => resolved,
            Err(error) => self.merge_each(file).unwrap_or_else(|| {
                self.note_failure(self.rel(file), error.to_string());
                ResolvedMetadata::default()
            }),
        };
        for sidecar in &resolved.sidecars {
            if self.used.insert(sidecar.clone()) {
                self.reads += 1;
            }
        }
        let direct = direct_sidecar_path(file);
        let mut merged = Effective::new();
        for (key, value) in resolved.values {
            let Some(source) = resolved.sources.get(&key) else {
                continue;
            };
            let source_kind = if *source == direct { "run" } else { "dataset" };
            merged.insert(
                key,
                EffectiveEntry {
                    value,
                    source: self.rel(source),
                    source_kind: source_kind.to_string(),
                },
            );
        }
        merged
    }

    /// A sidecar above the subject level is named on no subject: every run
    /// that inherits it is affected, not only the first one scanned.
    pub fn take_findings(&mut self) -> Vec<BidsFinding> {
        self.unreadable
            .drain(..)
            .map(|(rel, detail)| {
                let subject = rel
                    .split('/')
                    .next()
                    .and_then(|first| first.strip_prefix("sub-"))
                    .filter(|_| rel.contains('/'))
                    .map(str::to_string);
                super::finding(FindingSpec {
                    tag: "content",
                    severity: "warning",
                    code: "SIDECAR_UNREADABLE",
                    title: format!("Sidecar could not be used: {rel}"),
                    detail,
                    subject: subject.as_deref(),
                    session: None,
                    run_ids: Vec::new(),
                    file: Some(rel),
                })
            })
            .collect()
    }
}

/// Acquisition keys of an effective set, in `ACQUISITION_KEYS` order.
pub(crate) fn acquisition_values(effective: &Effective) -> Vec<BidsMetaValue> {
    ACQUISITION_KEYS
        .iter()
        .filter_map(|&key| {
            effective.get(key).map(|entry| BidsMetaValue {
                key: key.to_string(),
                value: entry.value.to_string(),
                source: entry.source.clone(),
                source_kind: entry.source_kind.clone(),
            })
        })
        .collect()
}

/// A number rounded enough to absorb float noise from converters: to 1e-4, or
/// to five significant digits below 0.1, where 1e-4 would erase the value. An
/// EffectiveEchoSpacing of 0.00027 s and one of 0.00031 s are different readouts.
fn canon_number(number: f64) -> String {
    let magnitude = number.abs();
    let decimals = if magnitude >= 0.1 || magnitude == 0.0 {
        4
    } else {
        4 - magnitude.log10().floor() as i32
    };
    let scale = 10f64.powi(decimals);
    let rounded = (number * scale).round() / scale;
    format!("{rounded}")
}

/// Canonical text of a JSON value: the same numbers in any formatting compare
/// equal, and arrays such as SliceTiming compare as ordered vectors.
pub(crate) fn canonical(value: &Value) -> String {
    match value {
        Value::Number(number) => number
            .as_f64()
            .map_or_else(|| number.to_string(), canon_number),
        Value::Array(items) => {
            let parts: Vec<String> = items.iter().map(canonical).collect();
            format!("[{}]", parts.join(","))
        }
        Value::Object(map) => {
            let mut parts: Vec<String> = map
                .iter()
                .map(|(key, value)| format!("{key}:{}", canonical(value)))
                .collect();
            parts.sort();
            format!("{{{}}}", parts.join(","))
        }
        other => other.to_string(),
    }
}

/// Number of distinct times in a SliceTiming vector.
pub(crate) fn unique_times(value: &Value) -> Option<usize> {
    let items = value.as_array()?;
    let mut times: Vec<String> = items.iter().map(canonical).collect();
    times.sort();
    times.dedup();
    Some(times.len())
}

/// Hash of `key=value` pairs, independent of their order.
pub(crate) fn hash_pairs(pairs: &[(String, String)]) -> String {
    let mut lines: Vec<String> = pairs.iter().map(|(k, v)| format!("{k}={v}")).collect();
    lines.sort();
    let refs: Vec<&str> = lines.iter().map(String::as_str).collect();
    sha256_hex(&refs)
}
