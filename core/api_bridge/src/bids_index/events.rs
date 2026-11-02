//! `events.tsv` checks. They run once per run during the scan and again, with
//! the passing checks included, for the inspector.

use super::meta::Effective;
use super::{parse_name, rel_text, tsv_reader, ParsedName, TsvReader};
use bids_rs::IndexEntry;
use bridge_types::bids::BidsCheck;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};

/// Share of events without a response_time above which a note is raised.
pub(crate) const RT_MISSING_NOTE_RATE: f64 = 0.2;

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct EventIssue {
    pub code: &'static str,
    pub tag: &'static str,
    pub severity: &'static str,
    pub title: String,
    pub detail: String,
}

#[derive(Debug, Default)]
pub(crate) struct EventReport {
    pub checks: Vec<BidsCheck>,
    pub issues: Vec<EventIssue>,
    /// Latest event end, in seconds.
    pub events_duration: Option<f32>,
}

impl EventReport {
    fn pass(&mut self, text: impl Into<String>) {
        self.checks.push(BidsCheck {
            ok: true,
            severity: "ok".into(),
            text: text.into(),
        });
    }

    fn fail(&mut self, issue: EventIssue) {
        self.checks.push(BidsCheck {
            ok: false,
            severity: if issue.severity == "info" {
                "warning".into()
            } else {
                issue.severity.into()
            },
            text: issue.title.clone(),
        });
        self.issues.push(issue);
    }
}

fn warn(code: &'static str, title: String, detail: String) -> EventIssue {
    EventIssue {
        code,
        tag: "content",
        severity: "warning",
        title,
        detail,
    }
}

type Entities = BTreeMap<String, String>;

/// The raw dataset's events files by directory. By the inheritance principle a
/// file applies to every run whose entities include its own, so a root
/// `task-x_events.tsv` serves all runs of task x.
#[derive(Debug, Default)]
pub(crate) struct EventFiles {
    by_directory: HashMap<String, Vec<(Entities, PathBuf)>>,
}

impl EventFiles {
    pub fn new(entries: &[IndexEntry]) -> Self {
        let mut files = Self::default();
        for entry in entries {
            let name = entry.abs_path.file_name().and_then(|n| n.to_str());
            let Some(name) = name.filter(|_| !entry.is_derivative && entry.is_available) else {
                continue;
            };
            let entities = if name == "events.tsv" {
                Entities::new()
            } else if name.ends_with("_events.tsv") {
                match parse_name(name) {
                    Some(parsed) => parsed.entities,
                    None => continue,
                }
            } else {
                continue;
            };
            let directory = entry.rel_path.parent().map(rel_text).unwrap_or_default();
            files
                .by_directory
                .entry(directory)
                .or_default()
                .push((entities, entry.abs_path.clone()));
        }
        files
    }

    /// The events file for a run: nearest directory first, then the most
    /// entities. Events are one table per run, so files are not merged.
    pub fn applicable(&self, run_rel_path: &str, run: &ParsedName) -> Option<&Path> {
        let mut directories: Vec<&str> = run_rel_path.split('/').collect();
        directories.pop();
        (0..=directories.len()).rev().find_map(|depth| {
            let directory = directories[..depth].join("/");
            let candidates = self.by_directory.get(&directory)?;
            candidates
                .iter()
                .filter(|(entities, _)| {
                    entities
                        .iter()
                        .all(|(key, value)| run.entity(key) == Some(value.as_str()))
                })
                .max_by_key(|(entities, path)| (entities.len(), path))
                .map(|(_, path)| path.as_path())
        })
    }
}

/// `scan_end_s` is `n_volumes × TR`; an event may run on by up to one TR,
/// because that is within the last acquired volume's sampling uncertainty.
pub(crate) fn check_events(
    path: &Path,
    sidecar: &Effective,
    scan_end_s: Option<f64>,
    tr_s: Option<f64>,
) -> Result<EventReport, String> {
    check_table(tsv_reader(path)?, path, sidecar, scan_end_s, tr_s)
}

/// `check_events` on an open table. `path` names it in errors.
pub(crate) fn check_table(
    mut reader: TsvReader,
    path: &Path,
    sidecar: &Effective,
    scan_end_s: Option<f64>,
    tr_s: Option<f64>,
) -> Result<EventReport, String> {
    let mut report = EventReport::default();
    let headers = reader
        .headers()
        .map_err(|e| format!("Cannot read {}: {e}", path.display()))?
        .clone();
    let find = |name: &str| headers.iter().position(|column| column == name);
    let (onset, duration) = (find("onset"), find("duration"));
    let (trial_type, response_time) = (find("trial_type"), find("response_time"));
    let missing: Vec<&str> = [("onset", onset), ("duration", duration)]
        .iter()
        .filter(|(_, column)| column.is_none())
        .map(|(name, _)| *name)
        .collect();
    if missing.is_empty() {
        report.pass("Required onset and duration columns present");
    } else {
        report.fail(warn(
            "EVENTS_COLUMNS_MISSING",
            format!("events.tsv has no {} column", missing.join(" or ")),
            "BIDS requires onset and duration in every events file.".into(),
        ));
    }

    let (mut rows, mut na_onsets, mut rt_missing) = (0usize, 0usize, 0usize);
    let mut last_end: Option<f64> = None;
    let mut last_onset: Option<f64> = None;
    let mut after_scan = 0usize;
    let mut levels = BTreeSet::new();
    for record in reader.records() {
        let record = record.map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
        rows += 1;
        let cell = |column: Option<usize>| column.and_then(|c| record.get(c)).map(str::trim);
        let onset_value = cell(onset).and_then(|text| text.parse::<f64>().ok());
        if onset.is_some() && onset_value.is_none() {
            na_onsets += 1;
        }
        if let Some(start) = onset_value {
            let length = cell(duration)
                .and_then(|text| text.parse::<f64>().ok())
                .unwrap_or(0.0);
            let end = start + length;
            last_end = Some(last_end.map_or(end, |value| value.max(end)));
            last_onset = Some(last_onset.map_or(start, |value| value.max(start)));
            if let Some(scan_end) = scan_end_s {
                after_scan += usize::from(end > scan_end + tr_s.unwrap_or(0.0));
            }
        }
        if let Some(level) = cell(trial_type).filter(|text| !text.is_empty() && *text != "n/a") {
            levels.insert(level.to_string());
        }
        if response_time.is_some()
            && cell(response_time).is_none_or(|text| text.parse::<f64>().is_err())
        {
            rt_missing += 1;
        }
    }
    report.events_duration = last_end.map(|value| value as f32);

    if onset.is_some() {
        if na_onsets == 0 {
            report.pass("Every onset has a value");
        } else {
            report.fail(warn(
                "EVENTS_NA_ONSET",
                format!("{na_onsets} of {rows} onsets are n/a"),
                "Events without an onset cannot be modelled.".into(),
            ));
        }
    }
    if let Some(scan_end) = scan_end_s {
        if after_scan == 0 {
            report.pass(format!("All events end within the scan ({scan_end:.1} s)"));
        } else {
            report.fail(warn(
                "EVENTS_AFTER_SCAN",
                format!("{after_scan} events after scan end"),
                format!(
                    "Last onset {:.1} s, run duration {scan_end:.1} s. Check the events onset reference.",
                    last_onset.unwrap_or(0.0)
                ),
            ));
        }
    }
    if trial_type.is_some() {
        if let Some(declared) = declared_levels(sidecar) {
            let undeclared: Vec<&str> = levels
                .iter()
                .filter(|level| !declared.contains(*level))
                .map(String::as_str)
                .collect();
            if undeclared.is_empty() {
                report.pass("trial_type levels match events.json");
            } else {
                report.fail(warn(
                    "EVENTS_UNDECLARED_LEVELS",
                    format!("{} trial_type levels not in events.json", undeclared.len()),
                    format!("Undeclared: {}.", undeclared.join(", ")),
                ));
            }
        }
    }
    if response_time.is_some() && rows > 0 {
        let rate = rt_missing as f64 / rows as f64;
        let text = format!(
            "response_time missing for {rt_missing} of {rows} events ({:.0}%)",
            rate * 100.0
        );
        if rate > RT_MISSING_NOTE_RATE {
            report.fail(EventIssue {
                code: "EVENTS_RT_MISSING",
                tag: "note",
                severity: "info",
                title: text,
                detail: "Omitted responses reduce the trials available to response-time models."
                    .into(),
            });
        } else {
            report.pass(text);
        }
    }
    Ok(report)
}

fn declared_levels(sidecar: &Effective) -> Option<BTreeSet<String>> {
    let levels = sidecar
        .get("trial_type")?
        .value
        .get("Levels")?
        .as_object()?;
    Some(levels.keys().cloned().collect())
}
