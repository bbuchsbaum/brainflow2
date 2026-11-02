//! Field map graph for one subject, read from effective metadata:
//! B0FieldSource to B0FieldIdentifier, with IntendedFor as the fallback.
//!
//! `bids_rs::fieldmaps` is not used. It resolves all or nothing, where a run
//! here keeps every key its readable sidecars give, and it does not fall back to
//! IntendedFor when a B0FieldSource names no field map.

use super::{finding, FindingSpec};
use bridge_types::bids::{BidsCheck, BidsFieldmapLink, BidsFinding, BidsRunRecord};
use serde_json::Value;
use std::collections::{HashMap, HashSet};

fn meta(run: &BidsRunRecord, key: &str) -> Option<Value> {
    let entry = run.sidecar.iter().find(|entry| entry.key == key)?;
    serde_json::from_str(&entry.value).ok()
}

pub(crate) fn meta_f64(run: &BidsRunRecord, key: &str) -> Option<f64> {
    meta(run, key)?.as_f64()
}

fn meta_str(run: &BidsRunRecord, key: &str) -> Option<String> {
    meta(run, key)?.as_str().map(str::to_string)
}

/// A string or array of strings, as the spec allows for these keys.
fn string_list(run: &BidsRunRecord, key: &str) -> Vec<String> {
    match meta(run, key) {
        Some(Value::String(text)) => vec![text],
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(|item| item.as_str().map(str::to_string))
            .collect(),
        _ => Vec::new(),
    }
}

/// Dataset-relative path of an IntendedFor entry for this subject, or `None`
/// for a URI into another dataset.
fn intended_path(entry: &str, subject: &str) -> Option<String> {
    if let Some(path) = entry.strip_prefix("bids::") {
        return Some(path.to_string());
    }
    if entry.starts_with("bids:") {
        return None;
    }
    Some(format!("sub-{subject}/{entry}"))
}

fn opposed(a: &str, b: &str) -> bool {
    a.strip_suffix('-') == Some(b) || b.strip_suffix('-') == Some(a)
}

fn grid(run: &BidsRunRecord) -> Option<(Vec<u32>, Vec<String>)> {
    let header = run.header.as_ref()?;
    let dim = header.dim.iter().take(3).copied().collect();
    let pixdim = header
        .pixdim
        .iter()
        .take(3)
        .map(|value| format!("{value:.3}"))
        .collect();
    Some((dim, pixdim))
}

fn needs_fieldmap(run: &BidsRunRecord) -> bool {
    run.suffix == "bold" || run.suffix == "dwi"
}

fn check(ok: bool, severity: &str, text: String) -> BidsCheck {
    BidsCheck {
        ok,
        severity: if ok { "ok" } else { severity }.to_string(),
        text,
    }
}

struct Evaluated {
    checks: Vec<BidsCheck>,
    problems: Vec<(&'static str, String)>,
}

/// PE opposition, TotalReadoutTime and same grid and session, against the run
/// the field map corrects.
fn evaluate(run: &BidsRunRecord, fmaps: &[&BidsRunRecord]) -> Evaluated {
    let mut out = Evaluated {
        checks: Vec::new(),
        problems: Vec::new(),
    };
    let mut push = |code: &'static str, ok: bool, pass: String, fail: String| {
        if ok {
            out.checks.push(check(true, "ok", pass));
        } else {
            out.checks.push(check(false, "warning", fail.clone()));
            out.problems.push((code, fail));
        }
    };

    let epi: Vec<&&BidsRunRecord> = fmaps.iter().filter(|fmap| fmap.suffix == "epi").collect();
    if !epi.is_empty() {
        let mut directions: Vec<String> = epi
            .iter()
            .filter_map(|fmap| meta_str(fmap, "PhaseEncodingDirection"))
            .collect();
        if let Some(direction) = meta_str(run, "PhaseEncodingDirection") {
            directions.push(direction);
        }
        let ok = directions
            .iter()
            .enumerate()
            .any(|(i, a)| directions[i + 1..].iter().any(|b| opposed(a, b)));
        push(
            "FMAP_PE_NOT_OPPOSED",
            ok,
            "Phase encoding directions are opposed".into(),
            format!(
                "Phase encoding is not opposed ({})",
                if directions.is_empty() {
                    "no PhaseEncodingDirection".to_string()
                } else {
                    directions.join(", ")
                }
            ),
        );
        if let Some(readout) = meta_f64(run, "TotalReadoutTime") {
            let values: Vec<f64> = epi
                .iter()
                .filter_map(|fmap| meta_f64(fmap, "TotalReadoutTime"))
                .collect();
            if !values.is_empty() {
                let differs = values.iter().find(|value| (**value - readout).abs() > 1e-3);
                push(
                    "FMAP_READOUT_MISMATCH",
                    differs.is_none(),
                    "TotalReadoutTime matches".into(),
                    format!(
                        "TotalReadoutTime {:.4} s, field map {:.4} s",
                        readout,
                        differs.copied().unwrap_or(readout)
                    ),
                );
            }
        }
    }
    // Only an EPI field map is meant to share the run's grid. A phasediff is
    // resampled to the run: NARPS has 4.8 mm phasediff slices for 2.4 mm BOLD.
    if let Some(run_grid) = grid(run).filter(|_| !epi.is_empty()) {
        let same = epi
            .iter()
            .all(|fmap| grid(fmap).is_none_or(|g| g == run_grid));
        push(
            "FMAP_GRID_MISMATCH",
            same,
            "Field map shares the run's grid".into(),
            "Field map grid differs from the run's".into(),
        );
    }
    let same_session = fmaps.iter().all(|fmap| fmap.session == run.session);
    push(
        "FMAP_SESSION_MISMATCH",
        same_session,
        "Field map is from the same session".into(),
        "Field map is from a different session".into(),
    );
    out
}

/// Fill `run.fmap` for one subject's runs and return the findings. Without a
/// complete listing an absent file or field map is unknown, not missing, so
/// nothing is said about it.
pub(crate) fn link_subject(
    subject: &str,
    runs: &mut [BidsRunRecord],
    known_files: &HashSet<String>,
    listing_complete: bool,
) -> Vec<BidsFinding> {
    let snapshot: Vec<BidsRunRecord> = runs.to_vec();
    let fmaps: Vec<&BidsRunRecord> = snapshot.iter().filter(|r| r.datatype == "fmap").collect();
    let mut findings = Vec::new();

    let mut by_identifier: HashMap<String, Vec<&BidsRunRecord>> = HashMap::new();
    let mut by_target: HashMap<String, Vec<&BidsRunRecord>> = HashMap::new();
    let path_to_rel: HashMap<&str, &BidsRunRecord> =
        snapshot.iter().map(|r| (r.rel_path.as_str(), r)).collect();
    for fmap in &fmaps {
        for identifier in string_list(fmap, "B0FieldIdentifier") {
            by_identifier.entry(identifier).or_default().push(fmap);
        }
        for entry in string_list(fmap, "IntendedFor") {
            let Some(path) = intended_path(&entry, subject) else {
                continue;
            };
            if !known_files.contains(&path) && !known_files.contains(&format!("{path}.gz")) {
                if !listing_complete {
                    continue;
                }
                findings.push(finding(FindingSpec {
                    tag: "content",
                    severity: "error",
                    code: "INTENDEDFOR_BROKEN",
                    title: "IntendedFor points to a missing file".into(),
                    detail: format!("{} lists {entry}, which does not exist.", fmap.id),
                    subject: Some(subject),
                    session: fmap.session.as_deref(),
                    run_ids: vec![fmap.id.clone()],
                    file: Some(entry.clone()),
                }));
                continue;
            }
            if let Some(target) = path_to_rel.get(path.as_str()) {
                by_target.entry(target.id.clone()).or_default().push(fmap);
            }
        }
    }

    let mut unlinked: HashMap<Option<String>, Vec<String>> = HashMap::new();
    for run in runs.iter_mut() {
        let sources = string_list(run, "B0FieldSource");
        let via_source: Vec<&BidsRunRecord> = sources
            .iter()
            .filter_map(|source| by_identifier.get(source))
            .flatten()
            .copied()
            .collect();
        let (via, linked, source_id) = if !via_source.is_empty() {
            ("B0FieldSource", via_source, sources.first().cloned())
        } else if let Some(linked) = by_target.get(&run.id) {
            ("IntendedFor", linked.clone(), None)
        } else {
            ("none", Vec::new(), sources.first().cloned())
        };
        if linked.is_empty() {
            if needs_fieldmap(run) && listing_complete {
                unlinked
                    .entry(run.session.clone())
                    .or_default()
                    .push(run.id.clone());
                run.fmap = Some(BidsFieldmapLink {
                    source_id,
                    fmap_run_ids: Vec::new(),
                    via: via.to_string(),
                    checks: vec![check(false, "warning", "No field map".to_string())],
                });
            }
            continue;
        }
        let evaluated = evaluate(run, &linked);
        for (code, title) in evaluated.problems {
            findings.push(finding(FindingSpec {
                tag: "content",
                severity: "warning",
                code,
                title,
                detail: format!(
                    "{} is corrected by {}.",
                    run.id,
                    linked
                        .iter()
                        .map(|fmap| fmap.id.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                ),
                subject: Some(subject),
                session: run.session.as_deref(),
                run_ids: vec![run.id.clone()],
                file: None,
            }));
        }
        run.fmap = Some(BidsFieldmapLink {
            source_id,
            fmap_run_ids: linked.iter().map(|fmap| fmap.id.clone()).collect(),
            via: via.to_string(),
            checks: evaluated.checks,
        });
    }

    for (session, run_ids) in unlinked {
        findings.push(finding(FindingSpec {
            tag: "content",
            severity: "warning",
            code: "NO_FIELDMAP",
            title: format!("{} runs have no field map", run_ids.len()),
            detail: "No B0FieldSource or IntendedFor link reaches these runs, so distortion cannot be corrected from a field map.".into(),
            subject: Some(subject),
            session: session.as_deref(),
            run_ids,
            file: None,
        }));
    }
    findings
}
