//! Framewise displacement from fMRIPrep confounds, and MRIQC group metrics.
//!
//! `bids_rs::ConfoundsReader` reads gzip but fills `n/a` with a column statistic.
//! Here `n/a` must stay a gap, so frames keep their alignment with volumes and
//! a leading `n/a` is not counted, and the TSV is read directly.

use super::derivatives::Pipeline;
use super::remote::ScanFiles;
use super::{parse_name, tsv_reader, ParsedName, TsvReader};
use bridge_types::bids::{BidsFdSummary, BidsIqms};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

pub(crate) const FD_DEFINITION: &str = "Power";
const SPARK_POINTS: usize = 28;

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct FdTrace {
    /// One entry per volume; `None` where the file says `n/a`.
    pub values: Vec<Option<f32>>,
    pub filtered: bool,
    /// Ascending 0-based volumes flagged as non-steady-state.
    pub non_steady: Vec<u32>,
}

/// A one-hot outlier regressor: fMRIPrep's name, or the older CamelCase one.
fn is_non_steady_column(name: &str) -> bool {
    name.starts_with("non_steady_state_outlier") || name.starts_with("NonSteadyStateOutlier")
}

/// Read the FD column and the non-steady-state flags.
/// `framewise_displacement_filtered`, when a pipeline provides it, is preferred
/// and reported as filtered.
pub(crate) fn read_fd(path: &Path) -> Result<FdTrace, String> {
    fd_from(tsv_reader(path)?, path)
}

/// The FD column of an open table. `path` names it in errors.
pub(crate) fn fd_from(mut reader: TsvReader, path: &Path) -> Result<FdTrace, String> {
    let headers = reader
        .headers()
        .map_err(|e| format!("Cannot read {}: {e}", path.display()))?
        .clone();
    let find = |name: &str| headers.iter().position(|column| column == name);
    let filtered_column = find("framewise_displacement_filtered");
    let filtered = filtered_column.is_some();
    let column = filtered_column
        .or_else(|| find("framewise_displacement"))
        .ok_or_else(|| format!("{} has no framewise_displacement column", path.display()))?;
    let flag_columns: Vec<usize> = headers
        .iter()
        .enumerate()
        .filter(|(_, name)| is_non_steady_column(name))
        .map(|(column, _)| column)
        .collect();
    let mut values = Vec::new();
    let mut non_steady = Vec::new();
    for (volume, record) in reader.records().enumerate() {
        let record = record.map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
        let flagged = flag_columns.iter().any(|&flag| {
            record
                .get(flag)
                .and_then(|cell| cell.trim().parse::<f32>().ok())
                .is_some_and(|value| value != 0.0)
        });
        if flagged {
            non_steady.push(volume as u32);
        }
        let value = record
            .get(column)
            .and_then(|cell| cell.trim().parse::<f32>().ok())
            .filter(|value| value.is_finite());
        values.push(value);
    }
    Ok(FdTrace {
        values,
        filtered,
        non_steady,
    })
}

/// The first volume after the leading run of flagged volumes, 0 if there is no
/// such run or no volume follows it. `flagged` is ascending.
fn first_valid_volume(flagged: &[u32], n_volumes: usize) -> u32 {
    let leading = flagged
        .iter()
        .zip(0u32..)
        .take_while(|(volume, expected)| **volume == *expected)
        .count();
    if leading < n_volumes {
        leading as u32
    } else {
        0
    }
}

/// Per-run summary. The mean is the mean of the trace that is drawn; frames
/// without a value are left out of the mean and of `n_frames`.
///
/// `mean`, `max`, `n_frames`, the over-threshold counts and `trace` use every
/// frame, flagged or not, so they keep matching the raw confounds and checks
/// that do not depend on MRIQC. Only `peak_volume` skips flagged frames and the
/// frame after each: FD there measures the jump out of the flagged volume. If
/// that leaves no frame, it is the largest value of all frames.
pub(crate) fn summarize(trace: &FdTrace, source: &str) -> Option<BidsFdSummary> {
    let flagged: HashSet<u32> = trace.non_steady.iter().copied().collect();
    let (mut sum, mut count, mut max, mut peak) = (0f64, 0u32, f32::MIN, 0u32);
    let (mut over_0_2, mut over_0_5) = (0u32, 0u32);
    let mut steady_peak: Option<(u32, f32)> = None;
    for (index, value) in trace.values.iter().enumerate() {
        let Some(value) = *value else { continue };
        sum += f64::from(value);
        count += 1;
        over_0_2 += u32::from(value > 0.2);
        over_0_5 += u32::from(value > 0.5);
        if value > max {
            max = value;
            peak = index as u32;
        }
        let volume = index as u32;
        let excluded = flagged.contains(&volume)
            || volume.checked_sub(1).is_some_and(|v| flagged.contains(&v));
        if !excluded && steady_peak.is_none_or(|(_, best)| value > best) {
            steady_peak = Some((volume, value));
        }
    }
    (count > 0).then(|| BidsFdSummary {
        mean: (sum / f64::from(count)) as f32,
        max,
        n_frames: count,
        over_0_2,
        over_0_5,
        peak_volume: steady_peak.map_or(peak, |(volume, _)| volume),
        first_valid_volume: first_valid_volume(&trace.non_steady, trace.values.len()),
        non_steady_volumes: trace.non_steady.clone(),
        trace: downsample_max(&trace.values, SPARK_POINTS),
        source: source.to_string(),
        definition: FD_DEFINITION.to_string(),
        filtered: trace.filtered,
    })
}

/// `points` bins, each holding the largest value in it, so a spike survives.
pub(crate) fn downsample_max(values: &[Option<f32>], points: usize) -> Vec<f32> {
    if values.is_empty() {
        return Vec::new();
    }
    (0..points)
        .map(|bin| {
            let start = bin * values.len() / points;
            let end = ((bin + 1) * values.len() / points).max(start + 1);
            values[start.min(values.len() - 1)..end.min(values.len())]
                .iter()
                .flatten()
                .fold(0f32, |acc, &value| acc.max(value))
        })
        .collect()
}

/// Entities that identify the run a derivative describes. `echo` is left out:
/// fMRIPrep confounds are per run, not per echo.
pub(crate) fn run_key(name: &ParsedName) -> String {
    let run = name
        .entity("run")
        .map(|run| run.trim_start_matches('0').to_string());
    format!(
        "{}|{}|{}|{}|{}|{}|{}|{}",
        name.entity("sub").unwrap_or(""),
        name.entity("ses").unwrap_or(""),
        name.entity("task").unwrap_or(""),
        name.entity("acq").unwrap_or(""),
        name.entity("ce").unwrap_or(""),
        name.entity("rec").unwrap_or(""),
        name.entity("dir").unwrap_or(""),
        run.as_deref().unwrap_or(""),
    )
}

pub(crate) fn is_confounds(name: &ParsedName) -> bool {
    name.entity("desc") == Some("confounds")
        && matches!(name.suffix.as_str(), "timeseries" | "regressors")
        && matches!(name.extension.as_str(), ".tsv" | ".tsv.gz")
}

/// Confounds for one run, probing the run's folder in each pipeline. Used for
/// lazy detail so it never depends on a finished scan.
pub(crate) fn find_confounds(
    root: &Path,
    pipelines: &[Pipeline],
    run: &ParsedName,
) -> Option<(PathBuf, usize)> {
    let key = run_key(run);
    let subject = format!("sub-{}", run.subject()?);
    for (index, pipeline) in pipelines.iter().enumerate() {
        let mut dir = root.join(&pipeline.root).join(&subject);
        if let Some(session) = run.entity("ses") {
            dir.push(format!("ses-{session}"));
        }
        dir.push("func");
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let parsed = path
                .file_name()
                .and_then(|n| n.to_str())
                .and_then(parse_name);
            if parsed.is_some_and(|name| is_confounds(&name) && run_key(&name) == key) {
                return Some((path, index));
            }
        }
    }
    None
}

/// Join key of a run id or MRIQC `bids_name`. Pipelines may reformat the run
/// index (fMRIPrep writes `run-1` for `run-01`), so names are not compared as
/// text. Unlike `run_key` it keeps the echo and the suffix: MRIQC reports per
/// echo, and a T1w row must not reach a bold run.
pub(crate) fn iqm_key(id: &str) -> Option<String> {
    let name = parse_name(&format!("{id}.nii"))?;
    Some(format!(
        "{}|{}|{}|{}",
        run_key(&name),
        name.entity("echo").unwrap_or(""),
        name.entity("part").unwrap_or(""),
        name.suffix
    ))
}

/// `derivatives/<mriqc>/group_*.tsv` rows by `iqm_key` of their `bids_name`.
pub(crate) fn read_mriqc(
    root: &Path,
    pipelines: &[Pipeline],
    files: &ScanFiles,
) -> HashMap<String, BidsIqms> {
    let mut iqms = HashMap::new();
    for pipeline in pipelines.iter().filter(|p| p.is_mriqc()) {
        let source = pipeline.label();
        for path in pipeline.group_tables(root, files) {
            let Ok(mut reader) = files.tsv(&path) else {
                continue;
            };
            let Ok(headers) = reader.headers().cloned() else {
                continue;
            };
            let find = |name: &str| headers.iter().position(|column| column == name);
            let Some(name_column) = find("bids_name") else {
                continue;
            };
            let (tsnr, fd_mean, gsr_y) = (find("tsnr"), find("fd_mean"), find("gsr_y"));
            for record in reader.records().flatten() {
                let number = |column: Option<usize>| {
                    column
                        .and_then(|c| record.get(c))
                        .and_then(|cell| cell.trim().parse::<f32>().ok())
                        .filter(|value| value.is_finite())
                };
                if let Some(key) = record.get(name_column).and_then(iqm_key) {
                    iqms.insert(
                        key,
                        BidsIqms {
                            tsnr: number(tsnr),
                            fd_mean: number(fd_mean),
                            gsr_y: number(gsr_y),
                            source: source.clone(),
                        },
                    );
                }
            }
        }
    }
    iqms
}
