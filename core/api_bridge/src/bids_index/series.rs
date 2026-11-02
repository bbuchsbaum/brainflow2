//! Series-level results, computed once from all run records: modal values,
//! CuBIDS-style variant groups, and the checks that need a series to compare
//! against.

use super::fieldmap::meta_f64;
use super::meta::{canonical, hash_pairs, unique_times};
use super::{finding, FindingSpec};
use bridge_types::bids::{
    BidsFinding, BidsMetaValue, BidsRunRecord, BidsSeriesModal, BidsVariantGroup,
};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};

/// Keys that define an acquisition group. Voxel size and matrix come from the
/// NIfTI header; the number of volumes never defines a group, it is reported
/// as a consequence.
pub(crate) const VARIANT_KEYS: [&str; 13] = [
    "RepetitionTime",
    "EchoTime",
    "EchoTime1",
    "EchoTime2",
    "FlipAngle",
    "MultibandAccelerationFactor",
    "PhaseEncodingDirection",
    "SliceTiming",
    "SoftwareVersions",
    "EffectiveEchoSpacing",
    "TotalReadoutTime",
    "VoxelSize",
    "Matrix",
];

const HEADER_KEYS: [&str; 2] = ["VoxelSize", "Matrix"];

pub(crate) const NVOLUMES_KEY: &str = "NumberOfVolumes";

/// Per-run by nature: a modal value means nothing.
const LINK_KEYS: [&str; 3] = ["B0FieldIdentifier", "B0FieldSource", "IntendedFor"];

fn value_of<'a>(run: &'a BidsRunRecord, key: &str) -> Option<&'a BidsMetaValue> {
    run.sidecar.iter().find(|entry| entry.key == key)
}

fn parsed(entry: &BidsMetaValue) -> Value {
    serde_json::from_str(&entry.value).unwrap_or(Value::Null)
}

/// Reconstructed voxel sizes wobble in the third decimal between scans of one
/// protocol (1.2994 to 1.3006 mm in ds000114), so they compare at 0.01 mm.
fn voxel_canonical(text: &str) -> String {
    let rounded: Vec<String> = text
        .split('x')
        .map(|size| {
            size.parse::<f64>()
                .map_or_else(|_| size.to_string(), |value| format!("{value:.2}"))
        })
        .collect();
    rounded.join("x")
}

/// The form of a value that decides whether two runs share an acquisition.
fn compared(entry: &BidsMetaValue) -> String {
    match (entry.key.as_str(), parsed(entry)) {
        ("VoxelSize", Value::String(text)) => voxel_canonical(&text),
        (_, value) => canonical(&value),
    }
}

fn canon_of(run: &BidsRunRecord, key: &str) -> Option<String> {
    value_of(run, key).map(compared)
}

/// `key=value` pairs that define a run's acquisition group. A missing
/// SliceTiming is left out: it is a content finding, not an acquisition, and
/// counting it twice would inflate Findings. A run with no header says nothing
/// about the header keys, so an unfetched image is not an acquisition variant.
fn group_pairs(run: &BidsRunRecord) -> Vec<(String, String)> {
    VARIANT_KEYS
        .iter()
        .filter(|key| run.header.is_some() || !HEADER_KEYS.contains(key))
        .filter_map(|&key| match (canon_of(run, key), key) {
            (Some(value), _) => Some((key.to_string(), value)),
            (None, "SliceTiming") => None,
            (None, _) => Some((key.to_string(), "<absent>".to_string())),
        })
        .collect()
}

pub(crate) fn mode<T: Ord + Clone>(values: impl Iterator<Item = T>) -> Option<T> {
    let mut counts: BTreeMap<T, usize> = BTreeMap::new();
    for value in values {
        *counts.entry(value).or_default() += 1;
    }
    // Largest count; ties resolve to the smallest value, for stability.
    let mut best: Option<(T, usize)> = None;
    for (value, count) in counts {
        if best.as_ref().is_none_or(|(_, top)| count > *top) {
            best = Some((value, count));
        }
    }
    best.map(|(value, _)| value)
}

pub(crate) struct SeriesResults {
    pub modal: Vec<BidsSeriesModal>,
    pub variants: Vec<BidsVariantGroup>,
    pub findings: Vec<BidsFinding>,
}

/// Group `runs` by series. Fills `variant_id` and returns the series results.
pub(crate) fn finalize(runs: &mut [BidsRunRecord]) -> SeriesResults {
    let mut by_series: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for (index, run) in runs.iter().enumerate() {
        by_series.entry(run.series.clone()).or_default().push(index);
    }
    let mut out = SeriesResults {
        modal: Vec::new(),
        variants: Vec::new(),
        findings: Vec::new(),
    };
    for (series, members) in by_series {
        // Group first, on a run's own values. A group's SliceTiming may then
        // be absent in some members, so a missing value joins the group with
        // the same remaining keys.
        let mut groups: BTreeMap<String, Vec<usize>> = BTreeMap::new();
        let with_timing: HashMap<String, String> = members
            .iter()
            .filter(|&&i| value_of(&runs[i], "SliceTiming").is_some())
            .map(|&i| {
                let pairs: Vec<_> = group_pairs(&runs[i])
                    .into_iter()
                    .filter(|(key, _)| key != "SliceTiming")
                    .collect();
                (hash_pairs(&pairs), hash_pairs(&group_pairs(&runs[i])))
            })
            .collect();
        let timed_hash = |run: &BidsRunRecord| {
            let hash = hash_pairs(&group_pairs(run));
            if value_of(run, "SliceTiming").is_none() {
                with_timing.get(&hash).cloned().unwrap_or(hash)
            } else {
                hash
            }
        };
        // The same for a run with no header: it joins the group it matches on
        // every other key.
        let with_header: HashMap<String, String> = members
            .iter()
            .filter(|&&i| runs[i].header.is_some())
            .flat_map(|&i| {
                let group = timed_hash(&runs[i]);
                let mut pairs = group_pairs(&runs[i]);
                pairs.retain(|(key, _)| !HEADER_KEYS.contains(&key.as_str()));
                let timed = hash_pairs(&pairs);
                pairs.retain(|(key, _)| key != "SliceTiming");
                [(timed, group.clone()), (hash_pairs(&pairs), group)]
            })
            .collect();
        for &index in &members {
            let hash = timed_hash(&runs[index]);
            let hash = if runs[index].header.is_none() {
                with_header.get(&hash).cloned().unwrap_or(hash)
            } else {
                hash
            };
            groups.entry(hash).or_default().push(index);
        }
        let mut ordered: Vec<(String, Vec<usize>)> = groups.into_iter().collect();
        ordered.sort_by(|a, b| b.1.len().cmp(&a.1.len()).then_with(|| a.0.cmp(&b.0)));
        let Some((_, modal_members)) = ordered.first().cloned() else {
            continue;
        };

        let modal_values = modal_values(runs, &modal_members);
        out.modal.push(BidsSeriesModal {
            series: series.clone(),
            values: modal_values.clone(),
            n_runs: members.len() as u32,
        });
        for (position, (_, group)) in ordered.iter().enumerate().skip(1) {
            let letter = variant_letter(position - 1);
            for &index in group {
                runs[index].variant_id = Some(letter.clone());
            }
            out.variants
                .push(describe_group(&series, letter, runs, group, &modal_values));
        }
        for (_, group) in &ordered {
            out.findings.extend(truncated_runs(&series, runs, group));
        }
        out.findings
            .extend(missing_slice_timing(&series, runs, &members, &modal_values));
    }
    out
}

fn variant_letter(index: usize) -> String {
    let letter = char::from(b'A' + (index % 26) as u8);
    if index < 26 {
        letter.to_string()
    } else {
        format!("{letter}{}", index / 26)
    }
}

fn modal_values(runs: &[BidsRunRecord], members: &[usize]) -> Vec<BidsMetaValue> {
    let mut keys: Vec<String> = Vec::new();
    for &index in members {
        for entry in &runs[index].sidecar {
            if !keys.contains(&entry.key) {
                keys.push(entry.key.clone());
            }
        }
    }
    keys.iter()
        .filter(|key| !LINK_KEYS.contains(&key.as_str()))
        .filter_map(|key| {
            // Half the group must carry a key for it to be modal.
            let carrying: Vec<&BidsMetaValue> = members
                .iter()
                .filter_map(|&index| value_of(&runs[index], key))
                .collect();
            if carrying.len() * 2 < members.len() {
                return None;
            }
            let top = mode(carrying.iter().map(|entry| compared(entry)))?;
            // Of the values that compare equal, show the most common spelling.
            let matching = || carrying.iter().filter(|entry| compared(entry) == top);
            let shown = mode(matching().map(|entry| entry.value.clone()))?;
            matching()
                .find(|entry| entry.value == shown)
                .map(|entry| (*entry).clone())
        })
        .collect()
}

fn short_name(key: &str) -> &str {
    match key {
        "RepetitionTime" => "TR",
        "EchoTime" => "TE",
        "EchoTime1" => "TE1",
        "EchoTime2" => "TE2",
        "FlipAngle" => "Flip",
        "MultibandAccelerationFactor" => "MB",
        "PhaseEncodingDirection" => "PE",
        "SoftwareVersions" => "Software",
        "EffectiveEchoSpacing" => "Echo spacing",
        "TotalReadoutTime" => "Readout",
        "VoxelSize" => "Voxel",
        other => other,
    }
}

fn plain(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        other => canonical(other),
    }
}

/// The value of a key for the diff line; vectors are shown by their count of
/// unique times, because the numbers themselves do not fit a line.
fn diff_part(key: &str, entry: Option<&BidsMetaValue>, modal: Option<&BidsMetaValue>) -> String {
    let render = |entry: Option<&BidsMetaValue>| -> String {
        match entry {
            None => "absent".to_string(),
            Some(entry) => {
                let value = parsed(entry);
                match (key, unique_times(&value)) {
                    ("SliceTiming", Some(count)) => format!("{count} unique times"),
                    _ => plain(&value),
                }
            }
        }
    };
    format!(
        "{} {} (modal {})",
        short_name(key),
        render(entry),
        render(modal)
    )
}

/// What a difference does to analysis. Stated consequences, not guesses about
/// why it happened.
fn consequence(key: &str) -> Option<&'static str> {
    match key {
        "RepetitionTime" | "MultibandAccelerationFactor" => {
            Some("FD is not comparable with the modal group without a caveat or filtered FD.")
        }
        "SliceTiming" => Some("Slice-time correction must use this group's own vector."),
        "PhaseEncodingDirection" => {
            Some("Distortion runs along a different direction; field map pairing must follow it.")
        }
        "VoxelSize" | "Matrix" => Some("Spatial resolution differs from the modal group."),
        "EchoTime" | "FlipAngle" => Some("Image contrast differs from the modal group."),
        "EffectiveEchoSpacing" | "TotalReadoutTime" => {
            Some("Distortion correction must use this group's readout values.")
        }
        "EchoTime1" | "EchoTime2" => {
            Some("Field map scaling must use this group's echo time difference.")
        }
        "SoftwareVersions" => Some("Reconstruction software differs from the modal group."),
        _ => None,
    }
}

fn describe_group(
    series: &str,
    id: String,
    runs: &[BidsRunRecord],
    group: &[usize],
    modal: &[BidsMetaValue],
) -> BidsVariantGroup {
    // The representative must carry SliceTiming if any member does.
    let first = group
        .iter()
        .map(|&index| &runs[index])
        .find(|run| value_of(run, "SliceTiming").is_some())
        .unwrap_or(&runs[group[0]]);
    let modal_entry = |key: &str| modal.iter().find(|entry| entry.key == key);
    let keys: Vec<String> = VARIANT_KEYS
        .iter()
        .filter(|&&key| {
            let own = canon_of(first, key);
            let reference = modal_entry(key).map(compared);
            own != reference && !(key == "SliceTiming" && own.is_none())
        })
        .map(|key| key.to_string())
        .collect();
    let mut parts: Vec<String> = keys
        .iter()
        .map(|key| diff_part(key, value_of(first, key), modal_entry(key)))
        .collect();
    let mut notes: Vec<&str> = keys.iter().filter_map(|key| consequence(key)).collect();
    notes.dedup();
    let own_volumes = canon_of(first, NVOLUMES_KEY);
    let modal_volumes = modal_entry(NVOLUMES_KEY).map(|entry| canonical(&parsed(entry)));
    if let (Some(own), Some(reference)) = (own_volumes, modal_volumes) {
        if own != reference {
            parts.push(format!("{own} volumes (modal {reference})"));
        }
    }
    let names: Vec<&str> = keys.iter().map(|key| short_name(key)).collect();
    BidsVariantGroup {
        id,
        series: series.to_string(),
        name: format!("{} differs", names.join(", ")),
        diff: parts.join(" · "),
        note: notes.join(" "),
        keys,
        run_ids: group.iter().map(|&index| runs[index].id.clone()).collect(),
    }
}

/// Runs short of the modal length of their own acquisition group: a variant
/// may legitimately have fewer volumes, which is not truncation.
fn truncated_runs(series: &str, runs: &[BidsRunRecord], group: &[usize]) -> Vec<BidsFinding> {
    let volumes = |index: usize| runs[index].header.as_ref().and_then(|h| h.n_volumes);
    let Some(modal) = mode(group.iter().filter_map(|&index| volumes(index))) else {
        return Vec::new();
    };
    group
        .iter()
        .filter(|&&index| volumes(index).is_some_and(|n| n < modal))
        .map(|&index| {
            let run = &runs[index];
            let n = volumes(index).unwrap_or(0);
            let ends = meta_f64(run, "RepetitionTime")
                .map(|tr| format!(" Run ends at {:.1} s.", f64::from(n) * tr))
                .unwrap_or_default();
            finding(FindingSpec {
                tag: "content",
                severity: "warning",
                code: "TRUNCATED_RUN",
                title: format!("Truncated run: {n} of {modal} volumes"),
                detail: format!("{series} modal length is {modal} volumes.{ends}"),
                subject: Some(&run.subject),
                session: run.session.as_deref(),
                run_ids: vec![run.id.clone()],
                file: None,
            })
        })
        .collect()
}

fn missing_slice_timing(
    series: &str,
    runs: &[BidsRunRecord],
    members: &[usize],
    modal: &[BidsMetaValue],
) -> Vec<BidsFinding> {
    let Some(reference) = modal.iter().find(|entry| entry.key == "SliceTiming") else {
        return Vec::new();
    };
    let unique = unique_times(&parsed(reference)).unwrap_or(0);
    members
        .iter()
        .filter(|&&index| value_of(&runs[index], "SliceTiming").is_none())
        .map(|&index| {
            let run = &runs[index];
            finding(FindingSpec {
                tag: "content",
                severity: "warning",
                code: "SLICE_TIMING_MISSING",
                title: "SliceTiming missing".into(),
                detail: format!(
                    "No sidecar in the chain gives SliceTiming. Other {series} runs have it ({unique} unique times)."
                ),
                subject: Some(&run.subject),
                session: run.session.as_deref(),
                run_ids: vec![run.id.clone()],
                file: None,
            })
        })
        .collect()
}

/// Aggregate per-session `NO_FIELDMAP` findings into one note when the dataset
/// has no field maps at all: one fact, not one finding per session. A partial
/// listing proves neither, and cached subjects may still carry such findings.
pub(crate) fn collapse_no_fieldmap(
    findings: &mut Vec<BidsFinding>,
    runs: &[BidsRunRecord],
    listing_complete: bool,
) {
    if !listing_complete {
        findings.retain(|f| !matches!(f.code.as_str(), "NO_FIELDMAP" | "INTENDEDFOR_BROKEN"));
        return;
    }
    if runs.iter().any(|run| run.datatype == "fmap") {
        return;
    }
    let run_ids: Vec<String> = findings
        .iter()
        .filter(|f| f.code == "NO_FIELDMAP")
        .flat_map(|f| f.run_ids.iter().cloned())
        .collect();
    if run_ids.is_empty() {
        return;
    }
    findings.retain(|f| f.code != "NO_FIELDMAP");
    findings.push(finding(FindingSpec {
        tag: "note",
        severity: "info",
        code: "NO_FIELDMAPS_IN_DATASET",
        title: "The dataset has no field maps".into(),
        detail: format!(
            "{} functional or diffusion runs cannot use field map distortion correction.",
            run_ids.len()
        ),
        subject: None,
        session: None,
        run_ids: Vec::new(),
        file: None,
    }));
}
