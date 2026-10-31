//! Suprathreshold cluster table (connected components with peaks).
//!
//! Positive (`v > threshold`) and negative (`v < -threshold`) voxels are
//! labelled separately, so a positive blob touching a negative one stays two
//! clusters. One flood fill per component gives O(N · neighbours) time with a
//! u32 label per voxel. Non-finite values never pass the threshold.
//!
//! Sub-peaks follow SPM's table convention: local maxima of `value × polarity`
//! within the cluster, accepted greedily by |value| when at least
//! `minPeakDistanceMm` (world mm) from every accepted peak, up to
//! `maxPeaksPerCluster` including the main peak.
//!
//! Optional cluster-extent p values use Gaussian random field theory with a
//! user-supplied, stationary FWHM ([`crate::rft`]).
//!
//! A newer `compute_clusters` call for the same volume supersedes an older one:
//! the older call stops early and returns the "cancelled" input error 4077.
use crate::volume_queries::{resolve_volume, with_frame, world_envelope, Frame, ResolvedVolume};
use crate::BridgeState;
use bridge_types::{BridgeError, BridgeResult, StatisticKind};
use neuro_inference::{
    ClusterExtent, ClusterInference, ClusterMethod, ClusterSearch, Diagnostics, FieldKind,
    InferenceError, RftClusterExtent, Smoothness, StatField, Tails,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{command, State};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum ClusterSign {
    #[default]
    Both,
    Positive,
    Negative,
}

const DEFAULT_CONNECTIVITY: u8 = 26;
const DEFAULT_MAX_CLUSTERS: u32 = 500;
/// Upper bound on `maxClusters`; larger requests are rejected.
pub(crate) const MAX_CLUSTERS_LIMIT: u32 = 5000;
const DEFAULT_MAX_PEAKS: u32 = 3;
const MAX_PEAKS_LIMIT: u32 = 32;
const DEFAULT_MIN_PEAK_DISTANCE_MM: f32 = 8.0;
/// Error code of a computation superseded by a newer request.
pub(crate) const CANCELLED_CODE: u16 = 4077;

/// FWHM in mm: one isotropic value or one per voxel axis (i, j, k).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(untagged)]
pub enum FwhmMm {
    Isotropic(f32),
    PerAxis([f32; 3]),
}

impl FwhmMm {
    fn per_axis(self) -> [f32; 3] {
        match self {
            FwhmMm::Isotropic(v) => [v; 3],
            FwhmMm::PerAxis(v) => v,
        }
    }
}

/// Field type for cluster-extent inference.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum ExtentStatistic {
    Z,
    T,
    F,
}

/// Parameters of the `"rft-extent"` method (Gaussian random field theory).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RftExtentRequest {
    /// Smoothness of the statistic image, assumed stationary (user-supplied;
    /// never estimated from the map). Per-axis values follow the voxel axes.
    pub fwhm_mm: FwhmMm,
    /// Declares the field type when the header has no z/t/F intent, or
    /// overrides it. Default: the NIfTI header statistic.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub statistic: Option<ExtentStatistic>,
    /// Degrees of freedom: error df for t, numerator df for F (overrides the
    /// header).
    #[serde(default)]
    #[ts(optional = nullable)]
    pub df: Option<f32>,
    /// Denominator (error) df for F (overrides the header).
    #[serde(default)]
    #[ts(optional = nullable)]
    pub df2: Option<f32>,
}

/// Opt-in cluster-level inference, tagged by method id. Only `"rft-extent"`
/// is implemented; the id set lives in `neuro_inference::ClusterMethodId`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "method")]
pub enum ClusterExtentMethodRequest {
    #[serde(rename = "rft-extent")]
    RftExtent(RftExtentRequest),
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ComputeClustersRequest {
    #[serde(default)]
    #[ts(optional = nullable)]
    pub volume_id: Option<String>,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub layer_id: Option<String>,
    /// Absolute threshold (>= 0): positive voxels need `v > threshold`,
    /// negative voxels `v < -threshold`. Also the cluster-forming threshold
    /// for `extentP`.
    pub threshold: f32,
    /// Default "both".
    #[serde(default)]
    #[ts(optional = nullable)]
    pub sign: Option<ClusterSign>,
    /// Face (6), face+edge (18) or face+edge+corner (26) adjacency; default 26.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub connectivity: Option<u8>,
    /// Clusters smaller than this are dropped (counted in `discardedClusters`);
    /// default 1.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub min_voxels: Option<u32>,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub timepoint: Option<usize>,
    /// Cap on returned rows (default 500, at most 5000); `truncated` reports
    /// a cut.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub max_clusters: Option<u32>,
    /// Peaks reported per cluster including the main peak (default 3, 1..=32;
    /// 1 disables sub-peaks).
    #[serde(default)]
    #[ts(optional = nullable)]
    pub max_peaks_per_cluster: Option<u32>,
    /// Minimum world distance between reported peaks (default 8 mm).
    #[serde(default)]
    #[ts(optional = nullable)]
    pub min_peak_distance_mm: Option<f32>,
    /// Cluster-level p values; off by default.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub extent: Option<ClusterExtentMethodRequest>,
    /// Register a hidden cluster-id label volume and return its id in
    /// `labelVolumeId` (default false). It replaces the previous one emitted
    /// for the same source volume unless that one is displayed as a layer.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub emit_label_volume: Option<bool>,
    /// Registered mask volume (e.g. a brain mask) bounding the search: clusters
    /// form only inside it, and RFT resels/search voxels use mask ∩ finite map
    /// voxels. Other grids are resampled by nearest voxel. Default: the map's
    /// finite non-zero voxels.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub search_mask: Option<String>,
    /// A background request (the UI's clusters on load, default false): it is
    /// superseded only by newer background requests for the volume, never
    /// cancels a user's Compute and is never cancelled by one, and it never
    /// emits a label volume (that would replace the one of the table shown).
    #[serde(default)]
    #[ts(optional = nullable)]
    pub quiet: Option<bool>,
}

/// Which voxels were searched.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum SearchVolumeKind {
    /// The map's finite, non-zero voxels (default).
    #[serde(rename = "map-nonzero")]
    MapNonzero,
    /// A mask volume intersected with the map's finite voxels.
    #[serde(rename = "mask")]
    Mask,
}

/// The search volume a cluster table was computed on.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SearchVolume {
    pub kind: SearchVolumeKind,
    pub mask_volume_id: Option<String>,
    /// Searched voxels. `map-nonzero`: finite non-zero map voxels. `mask`:
    /// mask ∩ finite map voxels, zeros of the map included (they are searched
    /// and count toward RFT resels).
    #[ts(type = "number")]
    pub voxels: u64,
    /// `mask` only: mask voxels where the map is 0 or non-finite, i.e. where
    /// the map carries no value. Zeros are also counted in `voxels`; the
    /// non-finite ones are not. `null` for `map-nonzero`.
    #[ts(type = "number | null")]
    pub mask_voxels_outside_map: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum ClusterPolarity {
    Positive,
    Negative,
}

/// A secondary local maximum of a cluster.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SubPeak {
    pub value: f32,
    pub ijk: [u32; 3],
    /// World centre of the voxel.
    pub mm: [f32; 3],
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ClusterSummary {
    /// 1-based rank in the returned order (|peak| descending).
    pub id: u32,
    pub sign: ClusterPolarity,
    #[ts(type = "number")]
    pub voxel_count: u64,
    pub volume_mm3: f32,
    /// Signed value at the voxel with the largest |value|.
    pub peak_value: f32,
    pub peak_ijk: [u32; 3],
    /// World centre of the peak voxel.
    pub peak_mm: [f32; 3],
    /// Further local maxima (main peak excluded), strongest first.
    pub sub_peaks: Vec<SubPeak>,
    pub mean_value: f32,
    /// Unweighted centre of mass (mean voxel position), voxel coordinates.
    pub centroid_ijk: [f32; 3],
    /// Unweighted centre of mass in world mm.
    pub centroid_mm: [f32; 3],
    /// Centre of mass weighted by |value|, world mm.
    pub weighted_centroid_mm: [f32; 3],
    /// Inclusive voxel bounding box.
    pub bbox_ijk_min: [u32; 3],
    pub bbox_ijk_max: [u32; 3],
    /// World envelope of the bounding-box voxel centres.
    pub bbox_mm_min: [f32; 3],
    pub bbox_mm_max: [f32; 3],
    /// FWE-corrected cluster-extent p (only with `extentP`).
    pub p_fwe_extent: Option<f64>,
    /// Uncorrected `P(n >= k)` for this extent (only with `extentP`).
    pub p_uncorrected_extent: Option<f64>,
}

/// Table-level cluster inference results; every p value depends on
/// `assumption`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ClusterExtentInference {
    /// Method id, e.g. "rft-extent".
    pub method: String,
    /// FWHM along the voxel axes, mm (user-supplied).
    pub fwhm_mm: [f32; 3],
    pub statistic: ExtentStatistic,
    /// t error df, or F numerator df.
    pub df: Option<f32>,
    /// F denominator df.
    pub df2: Option<f32>,
    /// "header" or "request".
    pub statistic_source: String,
    pub cluster_forming_threshold: f32,
    /// Tails searched (2 when positive and negative clusters of a Z/T map
    /// were formed). `pFweExtent` is family-wise over these tails;
    /// `expectedClusters` is per tail.
    #[ts(type = "1 | 2")]
    pub tails: u8,
    /// Searched voxels: the finite non-zero voxels of the analysed frame, or
    /// with `searchMask` the mask ∩ finite map voxels (see `SearchVolume`).
    #[ts(type = "number")]
    pub search_voxels: u64,
    /// Resel counts `[R0, R1, R2, R3]` of the search volume.
    pub resels: [f64; 4],
    /// Voxels per resel (`FWHM_x · FWHM_y · FWHM_z` in voxels).
    pub voxels_per_resel: f64,
    /// Expected number of clusters per tail at the threshold.
    pub expected_clusters: f64,
    /// Expected voxels per cluster at the threshold.
    pub expected_voxels_per_cluster: f64,
    pub assumption: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ClusterTable {
    pub clusters: Vec<ClusterSummary>,
    pub threshold: f32,
    pub sign: ClusterSign,
    pub connectivity: u8,
    pub min_voxels: u32,
    /// Frame analysed (4D volumes only).
    pub timepoint: Option<usize>,
    pub voxel_volume_mm3: f32,
    /// Voxels passing the threshold, before the size filter.
    #[ts(type = "number")]
    pub suprathreshold_voxels: u64,
    /// Clusters at or above `minVoxels` (before `maxClusters` truncation).
    pub total_clusters: u32,
    /// Components dropped for being smaller than `minVoxels`.
    pub discarded_clusters: u32,
    pub truncated: bool,
    pub max_peaks_per_cluster: u32,
    pub min_peak_distance_mm: f32,
    /// Present only when `extent` was requested.
    pub extent_inference: Option<ClusterExtentInference>,
    /// Registered cluster-id label volume (`emitLabelVolume`): voxel value =
    /// cluster `id`, 0 elsewhere, on the analysed grid. Usable as a region
    /// locus (`labelSource: { type: "volume", volumeId }`, `labelIds: [id]`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub label_volume_id: Option<String>,
    /// Search volume used for cluster formation and extent inference (always
    /// set by `compute_clusters`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub search_volume: Option<SearchVolume>,
    /// Set when `extent` was requested but its p values were withheld (e.g. a
    /// pre-thresholded map without `searchMask`); `extentInference` and every
    /// `pFweExtent`/`pUncorrectedExtent` are then null.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub extent_withheld: Option<ExtentWithheld>,
}

/// Why requested cluster-extent p values were not computed.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ExtentWithheld {
    /// Error code the request would otherwise have failed with (4080).
    pub code: u16,
    /// User-facing explanation.
    pub reason: String,
}

pub(crate) struct ClusterParams {
    pub threshold: f32,
    pub sign: ClusterSign,
    pub connectivity: u8,
    pub min_voxels: u32,
    pub max_clusters: u32,
    pub max_peaks: u32,
    pub min_peak_distance_mm: f32,
    /// Also return a cluster-id label image (see [`ClusterRun::label_image`]).
    pub emit_labels: bool,
}

/// Output of [`find_clusters`].
#[derive(Debug)]
pub(crate) struct ClusterRun {
    pub table: ClusterTable,
    /// Frame-shaped (x-fastest) image holding each returned cluster's `id`
    /// on its voxels and 0 elsewhere; present when `emit_labels` is set.
    pub label_image: Option<Vec<f32>>,
}

/// Per-volume generation counters; a newer request bumps the counter and
/// older computations notice at their next check.
fn generations() -> &'static Mutex<HashMap<String, Arc<AtomicU64>>> {
    static GENERATIONS: OnceLock<Mutex<HashMap<String, Arc<AtomicU64>>>> = OnceLock::new();
    GENERATIONS.get_or_init(Default::default)
}

#[cfg(test)]
pub(crate) fn has_generation(volume_id: &str) -> bool {
    generations()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .contains_key(volume_id)
}

/// Supersede order of a request: user requests per volume, background
/// (`quiet`) requests in their own order, so neither cancels the other.
pub(crate) fn generation_key(volume_id: &str, quiet: bool) -> String {
    if quiet {
        format!("auto:{volume_id}")
    } else {
        volume_id.to_string()
    }
}

/// Drop the generation counter of an unloaded volume (unload path), so the
/// map does not grow with every volume ever clustered. A computation still
/// running for it keeps its own `Arc` and finishes or is refused at
/// registration.
pub(crate) fn forget_generation(volume_id: &str) {
    let mut map = generations()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    map.remove(volume_id);
    map.remove(&generation_key(volume_id, true));
}

#[derive(Clone)]
pub(crate) struct Generation {
    counter: Arc<AtomicU64>,
    generation: u64,
}

impl Generation {
    pub(crate) fn begin(key: &str) -> Self {
        let counter = Arc::clone(
            generations()
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .entry(key.to_string())
                .or_default(),
        );
        let generation = counter.fetch_add(1, Ordering::AcqRel) + 1;
        Self {
            counter,
            generation,
        }
    }

    pub(crate) fn is_superseded(&self) -> bool {
        self.counter.load(Ordering::Acquire) != self.generation
    }
}

pub(crate) fn cancelled() -> BridgeError {
    BridgeError::Input {
        code: CANCELLED_CODE,
        details: "Cluster computation cancelled: superseded by a newer request".into(),
    }
}

fn neighbour_offsets(connectivity: u8) -> Vec<[isize; 3]> {
    let max_manhattan = match connectivity {
        6 => 1,
        18 => 2,
        _ => 3,
    };
    let mut offsets = Vec::new();
    for dk in -1isize..=1 {
        for dj in -1isize..=1 {
            for di in -1isize..=1 {
                let manhattan = di.abs() + dj.abs() + dk.abs();
                if manhattan > 0 && manhattan <= max_manhattan {
                    offsets.push([di, dj, dk]);
                }
            }
        }
    }
    offsets
}

/// Index of `ijk + offset` if inside the grid.
fn neighbour(frame: &Frame, ijk: [usize; 3], offset: [isize; 3]) -> Option<usize> {
    let mut out = [0usize; 3];
    for axis in 0..3 {
        let c = ijk[axis] as isize + offset[axis];
        if c < 0 || c >= frame.dims[axis] as isize {
            return None;
        }
        out[axis] = c as usize;
    }
    Some(frame.index(out[0], out[1], out[2]))
}

struct Accumulator {
    polarity: ClusterPolarity,
    label: u32,
    first_index: usize,
    /// Range of this component's voxels in the shared member list.
    members: std::ops::Range<usize>,
    count: u64,
    sum_value: f64,
    sum_ijk: [f64; 3],
    sum_weight: f64,
    sum_weighted_ijk: [f64; 3],
    peak_index: usize,
    peak_value: f32,
    lo: [usize; 3],
    hi: [usize; 3],
}

impl Accumulator {
    fn new(polarity: ClusterPolarity, label: u32, first_index: usize, first_value: f32) -> Self {
        Self {
            polarity,
            label,
            first_index,
            members: 0..0,
            count: 0,
            sum_value: 0.0,
            sum_ijk: [0.0; 3],
            sum_weight: 0.0,
            sum_weighted_ijk: [0.0; 3],
            peak_index: first_index,
            peak_value: first_value,
            lo: [usize::MAX; 3],
            hi: [0; 3],
        }
    }

    fn add(&mut self, index: usize, ijk: [usize; 3], value: f32) {
        self.count += 1;
        self.sum_value += f64::from(value);
        let weight = f64::from(value.abs());
        self.sum_weight += weight;
        for (axis, &c) in ijk.iter().enumerate() {
            self.sum_ijk[axis] += c as f64;
            self.sum_weighted_ijk[axis] += weight * c as f64;
            self.lo[axis] = self.lo[axis].min(c);
            self.hi[axis] = self.hi[axis].max(c);
        }
        // Ties keep the earliest voxel in x-fastest order.
        if value.abs() > self.peak_value.abs()
            || (value.abs() == self.peak_value.abs() && index < self.peak_index)
        {
            self.peak_index = index;
            self.peak_value = value;
        }
    }

    fn summary(&self, frame: &Frame, voxel_volume_mm3: f32) -> ClusterSummary {
        let n = self.count as f64;
        let centroid_ijk = self.sum_ijk.map(|s| (s / n) as f32);
        let weighted_ijk = if self.sum_weight > 0.0 {
            self.sum_weighted_ijk.map(|s| (s / self.sum_weight) as f32)
        } else {
            centroid_ijk
        };
        let to_world = |ijk: [f32; 3]| {
            let p = frame
                .affine
                .transform_point(&nalgebra::Point3::new(ijk[0], ijk[1], ijk[2]));
            [p.x, p.y, p.z]
        };
        let peak_ijk = frame.ijk(self.peak_index);
        let (bbox_mm_min, bbox_mm_max) = world_envelope(frame, self.lo, self.hi);
        ClusterSummary {
            id: 0,
            sign: self.polarity,
            voxel_count: self.count,
            volume_mm3: self.count as f32 * voxel_volume_mm3,
            peak_value: self.peak_value,
            peak_ijk: peak_ijk.map(|v| v as u32),
            peak_mm: frame.world(peak_ijk),
            sub_peaks: Vec::new(),
            mean_value: (self.sum_value / n) as f32,
            centroid_ijk,
            centroid_mm: to_world(centroid_ijk),
            weighted_centroid_mm: to_world(weighted_ijk),
            bbox_ijk_min: self.lo.map(|v| v as u32),
            bbox_ijk_max: self.hi.map(|v| v as u32),
            bbox_mm_min,
            bbox_mm_max,
            p_fwe_extent: None,
            p_uncorrected_extent: None,
        }
    }
}

pub(crate) fn validate_params(
    threshold: f32,
    connectivity: u8,
    max_clusters: Option<u32>,
) -> BridgeResult<u32> {
    if !threshold.is_finite() || threshold < 0.0 {
        return Err(BridgeError::Input {
            code: 4075,
            details: "Cluster threshold must be a finite absolute value >= 0".into(),
        });
    }
    if !matches!(connectivity, 6 | 18 | 26) {
        return Err(BridgeError::Input {
            code: 4076,
            details: format!("Connectivity must be 6, 18 or 26 (got {connectivity})"),
        });
    }
    let max_clusters = max_clusters.unwrap_or(DEFAULT_MAX_CLUSTERS);
    if max_clusters > MAX_CLUSTERS_LIMIT {
        return Err(BridgeError::Input {
            code: 4078,
            details: format!(
                "maxClusters must be at most {MAX_CLUSTERS_LIMIT} (got {max_clusters})"
            ),
        });
    }
    Ok(max_clusters.max(1))
}

fn validate_peak_params(
    max_peaks: Option<u32>,
    min_distance: Option<f32>,
) -> BridgeResult<(u32, f32)> {
    let max_peaks = max_peaks.unwrap_or(DEFAULT_MAX_PEAKS);
    let min_distance = min_distance.unwrap_or(DEFAULT_MIN_PEAK_DISTANCE_MM);
    if !(1..=MAX_PEAKS_LIMIT).contains(&max_peaks)
        || !min_distance.is_finite()
        || min_distance < 0.0
    {
        return Err(BridgeError::Input {
            code: 4079,
            details: format!(
                "maxPeaksPerCluster must be 1..={MAX_PEAKS_LIMIT} and minPeakDistanceMm a finite \
                 value >= 0"
            ),
        });
    }
    Ok((max_peaks, min_distance))
}

/// Local maxima of `value × polarity` among a cluster's voxels (neighbours
/// under the clustering connectivity, restricted to the same cluster), with
/// ties broken by the lower linear index: in a plateau of equal values only
/// voxels with no equal neighbour of lower index qualify. That is exactly one
/// voxel for a convex (box-like) plateau; a non-convex plateau can yield
/// several, which the distance rule in [`select_peaks`] then thins. Returns
/// indices, strongest first.
fn local_maxima(
    frame: &Frame,
    labels: &[u32],
    members: &[u32],
    acc: &Accumulator,
    offsets: &[[isize; 3]],
) -> Vec<usize> {
    let sign = match acc.polarity {
        ClusterPolarity::Positive => 1.0f32,
        ClusterPolarity::Negative => -1.0,
    };
    let mut maxima: Vec<usize> = members
        .iter()
        .map(|&m| m as usize)
        .filter(|&index| {
            let s = frame.values[index] * sign;
            let ijk = frame.ijk(index);
            offsets
                .iter()
                .all(|&offset| match neighbour(frame, ijk, offset) {
                    Some(n) if labels[n] == acc.label => {
                        let sn = frame.values[n] * sign;
                        sn < s || (sn == s && index < n)
                    }
                    _ => true,
                })
        })
        .collect();
    maxima.sort_by(|&a, &b| {
        (frame.values[b] * sign)
            .total_cmp(&(frame.values[a] * sign))
            .then(a.cmp(&b))
    });
    maxima
}

/// Greedy SPM-style peak selection; the first accepted peak is the main peak.
fn select_peaks(
    frame: &Frame,
    candidates: &[usize],
    max_peaks: u32,
    min_distance_mm: f32,
) -> Vec<usize> {
    let mut accepted: Vec<(usize, [f32; 3])> = Vec::new();
    for &index in candidates {
        if accepted.len() >= max_peaks as usize {
            break;
        }
        let mm = frame.world(frame.ijk(index));
        let far_enough = accepted.iter().all(|(_, other)| {
            let d2: f32 = (0..3).map(|a| (mm[a] - other[a]).powi(2)).sum();
            d2.sqrt() >= min_distance_mm
        });
        if far_enough {
            accepted.push((index, mm));
        }
    }
    accepted.into_iter().map(|(index, _)| index).collect()
}

pub(crate) fn find_clusters(
    frame: &Frame,
    params: &ClusterParams,
    search_mask: Option<&[bool]>,
    is_superseded: &dyn Fn() -> bool,
) -> BridgeResult<ClusterRun> {
    if u32::try_from(frame.values.len()).is_err() {
        return Err(BridgeError::Input {
            code: 4082,
            details: "The volume has more voxels than cluster labelling supports (2^32).".into(),
        });
    }
    let threshold = params.threshold;
    // Voxels outside an explicit search mask never pass.
    let polarity_of = |index: usize| -> Option<ClusterPolarity> {
        let v = frame.values[index];
        if !v.is_finite() || search_mask.is_some_and(|mask| !mask[index]) {
            None
        } else if v > threshold && params.sign != ClusterSign::Negative {
            Some(ClusterPolarity::Positive)
        } else if v < -threshold && params.sign != ClusterSign::Positive {
            Some(ClusterPolarity::Negative)
        } else {
            None
        }
    };
    let offsets = neighbour_offsets(params.connectivity);
    // 0 = unlabelled; otherwise 1-based component number.
    let mut labels = vec![0u32; frame.values.len()];
    // Every suprathreshold voxel, grouped by component (fill order).
    let mut members: Vec<u32> = Vec::new();
    let mut stack = Vec::new();
    let mut kept = Vec::new();
    let mut discarded = 0u32;
    let mut next_label = 0u32;
    let mut work = 0usize;

    for seed in 0..frame.values.len() {
        if seed.is_multiple_of(4096) && is_superseded() {
            return Err(cancelled());
        }
        if labels[seed] != 0 {
            continue;
        }
        let Some(polarity) = polarity_of(seed) else {
            continue;
        };
        next_label += 1;
        labels[seed] = next_label;
        stack.push(seed);
        let mut acc = Accumulator::new(polarity, next_label, seed, frame.values[seed]);
        let start = members.len();
        while let Some(index) = stack.pop() {
            work += 1;
            if work.is_multiple_of(65_536) && is_superseded() {
                return Err(cancelled());
            }
            // Checked at entry: every index fits in u32.
            members.push(index as u32);
            let ijk = frame.ijk(index);
            acc.add(index, ijk, frame.values[index]);
            for &offset in &offsets {
                let Some(n) = neighbour(frame, ijk, offset) else {
                    continue;
                };
                if labels[n] == 0 && polarity_of(n) == Some(polarity) {
                    labels[n] = next_label;
                    stack.push(n);
                }
            }
        }
        acc.members = start..members.len();
        if acc.count < u64::from(params.min_voxels) {
            discarded += 1;
        } else {
            kept.push(acc);
        }
    }
    let suprathreshold = members.len() as u64;

    kept.sort_by(|a, b| {
        b.peak_value
            .abs()
            .total_cmp(&a.peak_value.abs())
            .then(b.count.cmp(&a.count))
            .then(a.first_index.cmp(&b.first_index))
    });
    let total_clusters = kept.len() as u32;
    let truncated = kept.len() > params.max_clusters as usize;
    let voxel_volume_mm3 = frame.voxel_volume_mm3();
    let mut clusters = Vec::with_capacity(kept.len().min(params.max_clusters as usize));
    for (rank, acc) in kept.iter().take(params.max_clusters as usize).enumerate() {
        if is_superseded() {
            return Err(cancelled());
        }
        let mut summary = ClusterSummary {
            id: rank as u32 + 1,
            ..acc.summary(frame, voxel_volume_mm3)
        };
        if params.max_peaks > 1 {
            let candidates =
                local_maxima(frame, &labels, &members[acc.members.clone()], acc, &offsets);
            summary.sub_peaks = select_peaks(
                frame,
                &candidates,
                params.max_peaks,
                params.min_peak_distance_mm,
            )
            .into_iter()
            .skip(1)
            .map(|index| {
                let ijk = frame.ijk(index);
                SubPeak {
                    value: frame.values[index],
                    ijk: ijk.map(|v| v as u32),
                    mm: frame.world(ijk),
                }
            })
            .collect();
        }
        clusters.push(summary);
    }
    let label_image = params.emit_labels.then(|| {
        let mut image = vec![0.0f32; frame.values.len()];
        for (rank, acc) in kept.iter().take(params.max_clusters as usize).enumerate() {
            for &index in &members[acc.members.clone()] {
                image[index as usize] = (rank + 1) as f32;
            }
        }
        image
    });
    let table = ClusterTable {
        clusters,
        threshold,
        sign: params.sign,
        connectivity: params.connectivity,
        min_voxels: params.min_voxels,
        timepoint: frame.timepoint,
        voxel_volume_mm3,
        suprathreshold_voxels: suprathreshold,
        total_clusters,
        discarded_clusters: discarded,
        truncated,
        max_peaks_per_cluster: params.max_peaks,
        min_peak_distance_mm: params.min_peak_distance_mm,
        extent_inference: None,
        label_volume_id: None,
        search_volume: None,
        extent_withheld: None,
    };
    Ok(ClusterRun { table, label_image })
}

/// Field type for extent inference, with where it came from.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ResolvedField {
    pub kind: FieldKind,
    pub from_request: bool,
}

fn extent_error(details: impl Into<String>) -> BridgeError {
    BridgeError::Input {
        code: 4080,
        details: details.into(),
    }
}

fn inference_error(error: InferenceError) -> BridgeError {
    extent_error(match error {
        InferenceError::InvalidInput(m)
        | InferenceError::Unsupported(m)
        | InferenceError::EmptySearchVolume(m) => {
            let mut m = m;
            if let Some(first) = m.get_mut(0..1) {
                first.make_ascii_uppercase();
            }
            format!("{m}.")
        }
    })
}

/// Choose the field type: the request's declaration wins, else the header's
/// z, t or F intent. Degrees of freedom come from the request, else the header.
pub(crate) fn resolve_field(
    request: &RftExtentRequest,
    header: Option<&bridge_types::StatisticInfo>,
) -> BridgeResult<ResolvedField> {
    let (statistic, from_request) = match (request.statistic, header.map(|s| s.kind)) {
        (Some(kind), _) => (kind, true),
        (None, Some(StatisticKind::Z)) => (ExtentStatistic::Z, false),
        (None, Some(StatisticKind::T)) => (ExtentStatistic::T, false),
        (None, Some(StatisticKind::F)) => (ExtentStatistic::F, false),
        (None, _) => {
            let found = header
                .map(|s| s.label.clone())
                .filter(|l| !l.is_empty())
                .unwrap_or_else(|| "no statistic".into());
            return Err(extent_error(format!(
                "Cluster-extent p needs a z, t or F map; the header declares {found}. Declare \
                 the statistic (and df) in the request."
            )));
        }
    };
    let header_dof = |kind: StatisticKind, index: usize| {
        header
            .filter(|s| s.kind == kind)
            .and_then(|s| s.dof.get(index).copied())
    };
    let positive = |d: Option<f32>| d.filter(|d| d.is_finite() && *d > 0.0).map(f64::from);
    let kind = match statistic {
        ExtentStatistic::Z => FieldKind::Z,
        ExtentStatistic::T => {
            let Some(df) = positive(request.df.or(header_dof(StatisticKind::T, 0))) else {
                return Err(extent_error("A t field needs degrees of freedom (df > 0)."));
            };
            FieldKind::T { df }
        }
        ExtentStatistic::F => {
            let df1 = positive(request.df.or(header_dof(StatisticKind::F, 0)));
            let df2 = positive(request.df2.or(header_dof(StatisticKind::F, 1)));
            let (Some(df1), Some(df2)) = (df1, df2) else {
                return Err(extent_error(
                    "An F field needs both degrees of freedom (df and df2 > 0).",
                ));
            };
            FieldKind::F { df1, df2 }
        }
    };
    Ok(ResolvedField { kind, from_request })
}

/// Voxel edge lengths (mm) along the voxel axes.
fn voxel_sizes(frame: &Frame) -> [f64; 3] {
    let m = frame.affine.matrix();
    [0, 1, 2].map(|c| f64::from((m[(0, c)].powi(2) + m[(1, c)].powi(2) + m[(2, c)].powi(2)).sqrt()))
}

/// Why cluster-extent p is withheld for a pre-thresholded map (also the 4080
/// error text when `apply_extent_inference` is called directly).
pub(crate) fn pre_thresholded_reason(kind: FieldKind, threshold: f32) -> String {
    let stat = match kind {
        FieldKind::Z => "z",
        FieldKind::T { .. } => "t",
        FieldKind::F { .. } => "F",
    };
    format!(
        "This map looks pre-thresholded (no |{stat}| < {threshold} among non-zero voxels); \
         cluster p needs the unthresholded map or a search mask."
    )
}

/// A map whose finite non-zero voxels all exceed the threshold (|v| > u) was
/// thresholded before export (e.g. SPM `_thresh`, FSL `thresh_zstat`): its
/// non-zero support is the union of its clusters, not a search volume.
pub(crate) fn looks_pre_thresholded(frame: &Frame, threshold: f32) -> bool {
    let mut nonzero = 0usize;
    for v in frame.values.iter() {
        if v.is_finite() && *v != 0.0 {
            if v.abs() <= threshold {
                return false;
            }
            nonzero += 1;
        }
    }
    nonzero > 0
}

/// The searched voxels: `mask ∩ finite` with an explicit mask, else the map's
/// finite non-zero voxels.
pub(crate) fn search_voxels(frame: &Frame, search_mask: Option<&[bool]>) -> Vec<bool> {
    frame
        .values
        .iter()
        .enumerate()
        .map(|(index, v)| match search_mask {
            Some(mask) => mask[index] && v.is_finite(),
            None => v.is_finite() && *v != 0.0,
        })
        .collect()
}

/// Attach random-field extent p values to `table` (clusters formed at
/// `table.threshold`) through `neuro_inference`. The search volume is the
/// frame's finite, non-zero voxels.
pub(crate) fn apply_extent_inference(
    table: &mut ClusterTable,
    frame: &Frame,
    fwhm_mm: [f32; 3],
    field: ResolvedField,
    search_mask: Option<&[bool]>,
) -> BridgeResult<()> {
    if matches!(field.kind, FieldKind::F { .. }) && table.sign == ClusterSign::Negative {
        return Err(extent_error(
            "F maps are non-negative: search positive clusters for cluster-extent p.",
        ));
    }
    if search_mask.is_none() && looks_pre_thresholded(frame, table.threshold) {
        return Err(extent_error(pre_thresholded_reason(
            field.kind,
            table.threshold,
        )));
    }
    let mask = search_voxels(frame, search_mask);
    let stat_field = StatField::new(field.kind, frame.dims, voxel_sizes(frame), &mask)
        .map_err(inference_error)?;
    let method = ClusterMethod::RftExtent(RftClusterExtent::new(Smoothness::FwhmMm(
        fwhm_mm.map(f64::from),
    )));
    let extents: Vec<ClusterExtent> = table
        .clusters
        .iter()
        .map(|c| ClusterExtent::new(c.voxel_count))
        .collect();
    // Both signs of a symmetric field are two tails; F fields have only one.
    let tails = if table.sign == ClusterSign::Both && !matches!(field.kind, FieldKind::F { .. }) {
        Tails::Two
    } else {
        Tails::One
    };
    let search = ClusterSearch {
        forming_threshold: f64::from(table.threshold),
        tails,
    };
    let result = method
        .infer(&stat_field, &extents, &search)
        .map_err(inference_error)?;
    for (cluster, p) in table.clusters.iter_mut().zip(&result.clusters) {
        cluster.p_fwe_extent = Some(p.p_corrected);
        cluster.p_uncorrected_extent = p.p_uncorrected;
    }
    let rft = match result.summary.diagnostics {
        Diagnostics::Rft(d) => d,
        #[allow(unreachable_patterns)]
        _ => return Err(extent_error("Unexpected diagnostics for rft-extent.")),
    };
    let (statistic, df, df2) = match field.kind {
        FieldKind::Z => (ExtentStatistic::Z, None, None),
        FieldKind::T { df } => (ExtentStatistic::T, Some(df as f32), None),
        FieldKind::F { df1, df2 } => (ExtentStatistic::F, Some(df1 as f32), Some(df2 as f32)),
    };
    table.extent_inference = Some(ClusterExtentInference {
        method: result.summary.method.as_str().to_string(),
        fwhm_mm,
        statistic,
        df,
        df2,
        statistic_source: if field.from_request {
            "request"
        } else {
            "header"
        }
        .into(),
        cluster_forming_threshold: table.threshold,
        tails: result.summary.tails.count(),
        search_voxels: rft.search_voxels,
        resels: rft.resels,
        voxels_per_resel: 1.0 / rft.resels_per_voxel,
        expected_clusters: rft.expected_clusters,
        expected_voxels_per_cluster: rft.expected_voxels_per_cluster,
        assumption: result.summary.assumptions.join(" "),
    });
    Ok(())
}

/// Connected suprathreshold clusters of a volume frame, sorted by |peak|.
#[command]
#[tracing::instrument(skip_all, err, name = "api.compute_clusters")]
pub(crate) async fn compute_clusters(
    request: ComputeClustersRequest,
    state: State<'_, BridgeState>,
) -> BridgeResult<ClusterTable> {
    compute_clusters_impl(request, state.inner()).await
}

pub(crate) async fn compute_clusters_impl(
    request: ComputeClustersRequest,
    state: &BridgeState,
) -> BridgeResult<ClusterTable> {
    let connectivity = request.connectivity.unwrap_or(DEFAULT_CONNECTIVITY);
    let quiet = request.quiet.unwrap_or(false);
    let max_clusters = validate_params(request.threshold, connectivity, request.max_clusters)?;
    let (max_peaks, min_peak_distance_mm) =
        validate_peak_params(request.max_peaks_per_cluster, request.min_peak_distance_mm)?;
    let params = ClusterParams {
        threshold: request.threshold,
        sign: request.sign.unwrap_or_default(),
        connectivity,
        min_voxels: request.min_voxels.unwrap_or(1),
        max_clusters,
        max_peaks,
        min_peak_distance_mm,
        emit_labels: !quiet && request.emit_label_volume.unwrap_or(false),
    };
    let ResolvedVolume {
        id,
        volume,
        timepoint,
        path,
    } = resolve_volume(
        state,
        request.volume_id.as_deref(),
        request.layer_id.as_deref(),
        request.timepoint,
    )
    .await?;
    let generation = Generation::begin(&generation_key(&id, quiet));
    let extent = match &request.extent {
        Some(ClusterExtentMethodRequest::RftExtent(rft)) => {
            let header = crate::stat_metadata::read_volume_intent(path.into()).await;
            Some((
                rft.fwhm_mm.per_axis(),
                resolve_field(rft, header.statistic.as_ref())?,
            ))
        }
        None => None,
    };
    let mask_volume = match &request.search_mask {
        Some(mask_id) => Some((
            mask_id.clone(),
            state
                .volume_registry
                .lock()
                .await
                .get_arc(mask_id)
                .ok_or_else(|| BridgeError::VolumeNotFound {
                    code: 4041,
                    details: format!("Search mask volume {mask_id} not found"),
                })?,
        )),
        None => None,
    };
    let worker_generation = generation.clone();
    let (mut table, label_volume) = with_frame(volume, timepoint, move |frame| {
        let generation = worker_generation;
        let superseded = || generation.is_superseded();
        let search_mask = mask_volume
            .as_ref()
            .map(|(_, mask)| crate::volume_queries::resample_mask_nearest(mask, &frame))
            .transpose()?;
        let searched = search_voxels(&frame, search_mask.as_deref());
        let searched_count = searched.iter().filter(|v| **v).count() as u64;
        let mask_voxels_outside_map = search_mask.as_deref().map(|mask| {
            mask.iter()
                .zip(frame.values.iter())
                .filter(|(inside, v)| **inside && (**v == 0.0 || !v.is_finite()))
                .count() as u64
        });
        if search_mask.is_some() && searched_count == 0 {
            return Err(BridgeError::Input {
                code: 4081,
                details: "The search mask has no finite map voxels on the analysed grid.".into(),
            });
        }
        let ClusterRun {
            mut table,
            label_image,
        } = find_clusters(&frame, &params, search_mask.as_deref(), &superseded)?;
        table.search_volume = Some(SearchVolume {
            kind: if search_mask.is_some() {
                SearchVolumeKind::Mask
            } else {
                SearchVolumeKind::MapNonzero
            },
            mask_volume_id: mask_volume.as_ref().map(|(id, _)| id.clone()),
            voxels: searched_count,
            mask_voxels_outside_map,
        });
        if let Some((fwhm_mm, field)) = extent {
            if search_mask.is_none() && looks_pre_thresholded(&frame, table.threshold) {
                // Clusters and peaks stand; only the extent p is withheld.
                table.extent_withheld = Some(ExtentWithheld {
                    code: 4080,
                    reason: pre_thresholded_reason(field.kind, table.threshold),
                });
            } else {
                apply_extent_inference(&mut table, &frame, fwhm_mm, field, search_mask.as_deref())?;
            }
        }
        if generation.is_superseded() {
            return Err(cancelled());
        }
        let label_volume = label_image
            .map(|image| {
                crate::cluster_labels::label_volume_from_image(image, frame.dims, frame.affine)
            })
            .transpose()?;
        Ok((table, label_volume))
    })
    .await?;
    if let Some(volume) = label_volume {
        let clusters = table.clusters.len() as u32;
        table.label_volume_id =
            Some(crate::cluster_labels::register(state, &id, volume, clusters, &generation).await?);
    }
    Ok(table)
}

#[cfg(test)]
// Reference values are pasted with full printed precision.
#[allow(clippy::excessive_precision)]
mod tests {
    use super::*;
    use crate::volume_queries::test_support::frame_3d;

    const DIMS: [usize; 3] = [12, 10, 8];

    fn idx(i: usize, j: usize, k: usize) -> usize {
        i + DIMS[0] * (j + DIMS[1] * k)
    }

    /// Synthetic map with known answers (2 mm isotropic, origin -10,-10,-10):
    /// - A: positive 2x2x2 cube at i,j,k in 1..=2, values 3 except peak 5.0 at (2,2,2)
    /// - B: positive 3-voxel bar at i 7..=9, j=2, k=2 with values 4, 4.5, 4
    /// - C: negative 2x2x1 sheet at i 1..=2, j 6..=7, k=5, value -6 with peak -7 at (1,7,5)
    /// - speck: single positive voxel 9.0 at (10,8,6) (below min_voxels = 2)
    /// - D: two positive voxels touching only diagonally, (6,6,1) = 3.5 and (7,7,2) = 3.5
    /// - E: negative voxel -2.5 face-adjacent to A at (3,1,1): stays a separate cluster
    fn fixture() -> Frame<'static> {
        let mut values = vec![0.0f32; DIMS.iter().product()];
        for k in 1..=2 {
            for j in 1..=2 {
                for i in 1..=2 {
                    values[idx(i, j, k)] = 3.0;
                }
            }
        }
        values[idx(2, 2, 2)] = 5.0;
        values[idx(7, 2, 2)] = 4.0;
        values[idx(8, 2, 2)] = 4.5;
        values[idx(9, 2, 2)] = 4.0;
        for j in 6..=7 {
            for i in 1..=2 {
                values[idx(i, j, 5)] = -6.0;
            }
        }
        values[idx(1, 7, 5)] = -7.0;
        values[idx(10, 8, 6)] = 9.0;
        values[idx(6, 6, 1)] = 3.5;
        values[idx(7, 7, 2)] = 3.5;
        values[idx(3, 1, 1)] = -2.5;
        values[idx(5, 5, 5)] = f32::NAN;
        frame_3d(DIMS, [2.0; 3], [-10.0; 3], values)
    }

    fn find_clusters(frame: &Frame, params: &ClusterParams) -> ClusterTable {
        super::find_clusters(frame, params, None, &|| false)
            .unwrap()
            .table
    }

    fn params(sign: ClusterSign, connectivity: u8, min_voxels: u32) -> ClusterParams {
        ClusterParams {
            threshold: 2.0,
            sign,
            connectivity,
            min_voxels,
            max_clusters: 500,
            max_peaks: 3,
            min_peak_distance_mm: 8.0,
            emit_labels: false,
        }
    }

    #[test]
    fn known_clusters_sorted_by_absolute_peak_with_26_connectivity() {
        let table = find_clusters(&fixture(), &params(ClusterSign::Both, 26, 2));
        let rows: Vec<_> = table
            .clusters
            .iter()
            .map(|c| (c.sign, c.voxel_count, c.peak_value, c.peak_ijk))
            .collect();
        assert_eq!(
            rows,
            vec![
                (ClusterPolarity::Negative, 4, -7.0, [1, 7, 5]),
                (ClusterPolarity::Positive, 8, 5.0, [2, 2, 2]),
                (ClusterPolarity::Positive, 3, 4.5, [8, 2, 2]),
                (ClusterPolarity::Positive, 2, 3.5, [6, 6, 1]),
            ]
        );
        assert_eq!(
            table.clusters.iter().map(|c| c.id).collect::<Vec<_>>(),
            vec![1, 2, 3, 4]
        );
        // Speck (1 voxel) and E (1 voxel) are below min_voxels.
        assert_eq!(table.discarded_clusters, 2);
        assert_eq!(table.total_clusters, 4);
        assert_eq!(table.suprathreshold_voxels, 8 + 3 + 4 + 1 + 2 + 1);
        assert_eq!(table.voxel_volume_mm3, 8.0);
        assert!(!table.truncated);

        let cube = &table.clusters[1];
        assert_eq!(cube.volume_mm3, 64.0);
        assert_eq!(cube.peak_mm, [-6.0, -6.0, -6.0]);
        assert_eq!(cube.centroid_ijk, [1.5, 1.5, 1.5]);
        assert_eq!(cube.centroid_mm, [-7.0, -7.0, -7.0]);
        assert_eq!(
            (cube.bbox_ijk_min, cube.bbox_ijk_max),
            ([1, 1, 1], [2, 2, 2])
        );
        assert_eq!((cube.bbox_mm_min, cube.bbox_mm_max), ([-8.0; 3], [-6.0; 3]));
        assert!((cube.mean_value - 26.0 / 8.0).abs() < 1e-6);
        // Value-weighted centroid is pulled toward the 5.0 peak at (2,2,2).
        // sum(|v| * i) = 3 * (4 * 1 + 4 * 2) + 2 * 2 = 40; sum(|v|) = 26.
        let weighted_i = 40.0f32 / 26.0;
        let expected = -10.0 + 2.0 * weighted_i;
        assert!(cube
            .weighted_centroid_mm
            .iter()
            .all(|v| (v - expected).abs() < 1e-5));
        assert!(cube.weighted_centroid_mm[0] > cube.centroid_mm[0]);
    }

    #[test]
    fn connectivity_separates_diagonal_neighbours() {
        let frame = fixture();
        let count_d = |connectivity| {
            find_clusters(&frame, &params(ClusterSign::Positive, connectivity, 1))
                .clusters
                .iter()
                .filter(|c| c.peak_value == 3.5)
                .count()
        };
        // (6,6,1) and (7,7,2) differ on all three axes: corner-adjacent only.
        assert_eq!(count_d(26), 1);
        assert_eq!(count_d(18), 2);
        assert_eq!(count_d(6), 2);
    }

    #[test]
    fn sign_filter_and_min_voxels() {
        let frame = fixture();
        let positive = find_clusters(&frame, &params(ClusterSign::Positive, 26, 1));
        assert!(positive
            .clusters
            .iter()
            .all(|c| c.sign == ClusterPolarity::Positive));
        // A, B, D, speck.
        assert_eq!(positive.clusters.len(), 4);
        assert_eq!(positive.clusters[0].peak_value, 9.0);
        let negative = find_clusters(&frame, &params(ClusterSign::Negative, 6, 1));
        assert_eq!(
            negative
                .clusters
                .iter()
                .map(|c| c.voxel_count)
                .collect::<Vec<_>>(),
            vec![4, 1]
        );
        let large = find_clusters(&frame, &params(ClusterSign::Both, 26, 5));
        assert_eq!(large.clusters.len(), 1);
        assert_eq!(large.clusters[0].voxel_count, 8);
    }

    #[test]
    fn threshold_is_strict_and_truncation_reported() {
        let frame = fixture();
        let mut p = params(ClusterSign::Both, 26, 1);
        p.threshold = 4.0;
        // Strictly above 4: A peak 5, B middle 4.5, C (-6/-7), speck 9.
        let table = find_clusters(&frame, &p);
        assert_eq!(table.suprathreshold_voxels, 1 + 1 + 4 + 1);
        p.max_clusters = 2;
        let cut = find_clusters(&frame, &p);
        assert_eq!(
            (cut.clusters.len(), cut.total_clusters, cut.truncated),
            (2, 4, true)
        );
    }

    #[test]
    fn rejects_invalid_parameters() {
        assert!(validate_params(-1.0, 26, None).is_err());
        assert!(validate_params(f32::NAN, 26, None).is_err());
        assert!(validate_params(1.0, 8, None).is_err());
        assert_eq!(validate_params(1.0, 18, Some(0)).unwrap(), 1);
        assert_eq!(validate_params(1.0, 18, Some(5000)).unwrap(), 5000);
        assert!(validate_params(1.0, 18, Some(5001)).is_err());
        assert!(validate_peak_params(Some(0), None).is_err());
        assert!(validate_peak_params(Some(33), None).is_err());
        assert!(validate_peak_params(None, Some(-1.0)).is_err());
        assert_eq!(validate_peak_params(None, None).unwrap(), (3, 8.0));
    }

    #[test]
    fn request_defaults_deserialize_from_camel_case() {
        let request: ComputeClustersRequest =
            serde_json::from_str(r#"{"layerId":"l","threshold":3.1}"#).unwrap();
        assert_eq!(request.sign, None);
        assert_eq!(request.layer_id.as_deref(), Some("l"));
        let request: ComputeClustersRequest = serde_json::from_str(
            r#"{"volumeId":"v","threshold":2,"sign":"negative","connectivity":6,"minVoxels":10}"#,
        )
        .unwrap();
        assert_eq!(request.sign, Some(ClusterSign::Negative));
        assert_eq!(
            (request.connectivity, request.min_voxels),
            (Some(6), Some(10))
        );
    }

    // --- Sub-peaks ---

    /// 2 mm isotropic grid, origin 0, with Gaussian blobs (sigma 1 voxel) on
    /// the x axis through (·, 6, 6). `blobs` are (centre i, signed amplitude).
    fn blob_frame(blobs: &[(f32, f32)]) -> Frame<'static> {
        let dims = [40, 13, 13];
        let mut values = vec![0.0f32; 40 * 13 * 13];
        for k in 0..13 {
            for j in 0..13 {
                for i in 0..40 {
                    let r2_yz = (j as f32 - 6.0).powi(2) + (k as f32 - 6.0).powi(2);
                    values[i + 40 * (j + 13 * k)] = blobs
                        .iter()
                        .map(|(c, a)| a * (-((i as f32 - c).powi(2) + r2_yz) / 2.0).exp())
                        .sum();
                }
            }
        }
        frame_3d(dims, [2.0; 3], [0.0; 3], values)
    }

    fn peak_params(threshold: f32, max_peaks: u32, min_distance: f32) -> ClusterParams {
        ClusterParams {
            threshold,
            sign: ClusterSign::Both,
            connectivity: 26,
            min_voxels: 1,
            max_clusters: 500,
            max_peaks,
            min_peak_distance_mm: min_distance,
            emit_labels: false,
        }
    }

    #[test]
    fn merged_blobs_closer_than_min_distance_report_no_sub_peak() {
        // Centres 3 voxels = 6 mm apart; still two local maxima (separation > 2 sigma).
        let frame = blob_frame(&[(10.0, 10.0), (13.0, 8.0)]);
        let table = find_clusters(&frame, &peak_params(0.1, 3, 8.0));
        assert_eq!(table.clusters.len(), 1, "blobs merge into one cluster");
        let cluster = &table.clusters[0];
        assert_eq!(cluster.peak_ijk, [10, 6, 6]);
        assert!(cluster.sub_peaks.is_empty(), "6 mm < 8 mm separation");
        // With a 5 mm separation the second maximum is reported.
        let table = find_clusters(&frame, &peak_params(0.1, 3, 5.0));
        let sub = &table.clusters[0].sub_peaks;
        assert_eq!(sub.len(), 1);
        assert_eq!((sub[0].ijk, sub[0].mm), ([13, 6, 6], [26.0, 12.0, 12.0]));
        assert!((sub[0].value - 8.1).abs() < 0.05);
    }

    #[test]
    fn merged_blobs_beyond_min_distance_report_sub_peaks_in_order() {
        // Centres 6 voxels = 12 mm apart, three blobs in one cluster.
        let frame = blob_frame(&[(8.0, 10.0), (14.0, 6.0), (20.0, 8.0)]);
        let table = find_clusters(&frame, &peak_params(0.1, 3, 8.0));
        assert_eq!(table.clusters.len(), 1);
        let cluster = &table.clusters[0];
        assert_eq!(cluster.peak_ijk, [8, 6, 6]);
        let sub: Vec<_> = cluster.sub_peaks.iter().map(|p| p.ijk).collect();
        // Strongest first: 8.0 at i = 20, then 6.0 at i = 14.
        assert_eq!(sub, vec![[20, 6, 6], [14, 6, 6]]);
        // maxPeaksPerCluster counts the main peak.
        let two = find_clusters(&frame, &peak_params(0.1, 2, 8.0));
        assert_eq!(two.clusters[0].sub_peaks.len(), 1);
        let one = find_clusters(&frame, &peak_params(0.1, 1, 8.0));
        assert!(one.clusters[0].sub_peaks.is_empty());
        assert_eq!(
            (one.max_peaks_per_cluster, one.min_peak_distance_mm),
            (1, 8.0)
        );
    }

    #[test]
    fn plateau_counts_as_one_maximum() {
        // A 3x3x3 plateau of 5.0 inside a 5x5x5 block of 2.0.
        let dims = [12, 12, 12];
        let mut values = vec![0.0f32; 12 * 12 * 12];
        let at = |i: usize, j: usize, k: usize| i + 12 * (j + 12 * k);
        for k in 1..=5 {
            for j in 1..=5 {
                for i in 1..=5 {
                    values[at(i, j, k)] = 2.0;
                }
            }
        }
        for k in 2..=4 {
            for j in 2..=4 {
                for i in 2..=4 {
                    values[at(i, j, k)] = 5.0;
                }
            }
        }
        let frame = frame_3d(dims, [2.0; 3], [0.0; 3], values);
        // Even with no distance limit, the plateau yields a single maximum.
        let table = find_clusters(&frame, &peak_params(1.0, 32, 0.0));
        assert_eq!(table.clusters.len(), 1);
        let cluster = &table.clusters[0];
        assert!(cluster.sub_peaks.is_empty(), "{:?}", cluster.sub_peaks);
        // Main peak: lowest linear index of the plateau.
        assert_eq!(cluster.peak_ijk, [2, 2, 2]);
    }

    #[test]
    fn negative_clusters_use_most_negative_peaks() {
        let frame = blob_frame(&[(8.0, -10.0), (14.0, -7.0), (30.0, 4.0)]);
        let table = find_clusters(&frame, &peak_params(0.1, 3, 8.0));
        let negative: Vec<_> = table
            .clusters
            .iter()
            .filter(|c| c.sign == ClusterPolarity::Negative)
            .collect();
        assert_eq!(negative.len(), 1);
        assert_eq!(negative[0].peak_ijk, [8, 6, 6]);
        assert!(negative[0].peak_value < -9.9);
        assert_eq!(negative[0].sub_peaks.len(), 1);
        assert_eq!(negative[0].sub_peaks[0].ijk, [14, 6, 6]);
        assert!(negative[0].sub_peaks[0].value < -6.9);
        // The positive blob is its own cluster with no sub-peaks.
        let positive: Vec<_> = table
            .clusters
            .iter()
            .filter(|c| c.sign == ClusterPolarity::Positive)
            .collect();
        assert_eq!(positive.len(), 1);
        assert!(positive[0].sub_peaks.is_empty());
    }

    // --- Cancellation ---

    #[test]
    fn newer_generation_supersedes_older_for_the_same_volume_only() {
        let key = format!("vol-{}", uuid::Uuid::new_v4());
        let first = Generation::begin(&key);
        assert!(!first.is_superseded());
        let other = Generation::begin(&format!("{key}-other"));
        let second = Generation::begin(&key);
        assert!(first.is_superseded());
        assert!(!second.is_superseded());
        assert!(!other.is_superseded());
    }

    #[test]
    fn background_requests_have_their_own_supersede_order() {
        let volume = format!("vol-{}", uuid::Uuid::new_v4());
        let user = Generation::begin(&generation_key(&volume, false));
        let auto = Generation::begin(&generation_key(&volume, true));
        // A background run starting after the user's Compute leaves it running…
        assert!(!user.is_superseded());
        // …and a user Compute does not cancel the background run.
        let user2 = Generation::begin(&generation_key(&volume, false));
        assert!(user.is_superseded());
        assert!(!auto.is_superseded());
        // Only a newer background run supersedes a background run.
        let auto2 = Generation::begin(&generation_key(&volume, true));
        assert!(auto.is_superseded());
        assert!(!user2.is_superseded());
        assert!(!auto2.is_superseded());
        forget_generation(&volume);
        assert!(!has_generation(&volume));
        assert!(!has_generation(&generation_key(&volume, true)));
    }

    #[test]
    fn superseded_computation_returns_cancelled_error() {
        let frame = fixture();
        match super::find_clusters(&frame, &params(ClusterSign::Both, 26, 1), None, &|| true) {
            Err(BridgeError::Input { code, .. }) => assert_eq!(code, CANCELLED_CODE),
            other => panic!("expected cancellation, got {other:?}"),
        }
    }

    // --- Cluster-extent inference ---

    /// 20^3 grid of 2 mm voxels, background 0.5 (inside the search mask),
    /// a 3x3x3 cluster of 5.0 and a 2x2x2 cluster of 4.0.
    fn extent_frame() -> Frame<'static> {
        let mut values = vec![0.5f32; 8000];
        let at = |i: usize, j: usize, k: usize| i + 20 * (j + 20 * k);
        for k in 4..7 {
            for j in 4..7 {
                for i in 4..7 {
                    values[at(i, j, k)] = 5.0;
                }
            }
        }
        for k in 12..14 {
            for j in 12..14 {
                for i in 12..14 {
                    values[at(i, j, k)] = 4.0;
                }
            }
        }
        frame_3d([20, 20, 20], [2.0; 3], [0.0; 3], values)
    }

    fn close(actual: f64, expected: f64) {
        assert!(
            ((actual - expected) / expected).abs() < 1e-9,
            "{actual:e} vs {expected:e}"
        );
    }

    #[test]
    fn extent_p_matches_independent_reference_end_to_end() {
        let frame = extent_frame();
        let mut p = peak_params(3.1, 3, 8.0);
        p.sign = ClusterSign::Positive;
        let mut table = find_clusters(&frame, &p);
        let field = ResolvedField {
            kind: FieldKind::Z,
            from_request: false,
        };
        apply_extent_inference(&mut table, &frame, [4.0; 3], field, None).unwrap();
        // Box of 20^3 voxels at 0.5 FWHM per voxel: R = [1, 28.5, 270.75, 857.375];
        // reference from core/neuro-inference/tests/fixtures/rft_reference.py
        // (p_rf) at u = f64::from(3.1f32), the threshold the f32 request carries.
        let inference = table.extent_inference.as_ref().unwrap();
        assert_eq!(inference.resels, [1.0, 28.5, 270.75, 857.375]);
        assert_eq!(inference.search_voxels, 8000);
        assert_eq!(inference.voxels_per_resel, 8.0);
        assert_eq!(inference.statistic, ExtentStatistic::Z);
        assert_eq!(inference.statistic_source, "header");
        close(inference.expected_clusters, 8.341739657639305e+00);
        close(inference.expected_voxels_per_cluster, 9.388597535635710e-01);
        assert!(inference.assumption.contains("4 mm FWHM (user-supplied)"));
        // 4 mm on 2 mm voxels is 2 voxels FWHM: below the smoothness guide.
        assert!(inference.assumption.contains("only 2.0 voxels FWHM"));
        assert_eq!(
            (inference.method.as_str(), inference.df2),
            ("rft-extent", None)
        );
        let big = &table.clusters[0];
        assert_eq!(big.voxel_count, 27);
        close(big.p_fwe_extent.unwrap(), 9.833503809353328e-05);
        close(big.p_uncorrected_extent.unwrap(), 1.178889264547693e-05);
        let small = &table.clusters[1];
        assert_eq!(small.voxel_count, 8);
        close(small.p_fwe_extent.unwrap(), 5.238049147289381e-02);
        close(small.p_uncorrected_extent.unwrap(), 6.449760099913261e-03);

        // t field with 20 df, same geometry.
        let mut table = find_clusters(&frame, &p);
        let t = ResolvedField {
            kind: FieldKind::T { df: 20.0 },
            from_request: true,
        };
        apply_extent_inference(&mut table, &frame, [4.0; 3], t, None).unwrap();
        let inference = table.extent_inference.as_ref().unwrap();
        assert_eq!(
            (inference.df, inference.statistic_source.as_str()),
            (Some(20.0), "request")
        );
        close(inference.expected_clusters, 2.329695452106121e+01);
        close(
            table.clusters[0].p_fwe_extent.unwrap(),
            4.000060058326760e-04,
        );
        close(
            table.clusters[0].p_uncorrected_extent.unwrap(),
            1.717331890801469e-05,
        );
    }

    #[test]
    fn both_signs_report_two_tails_with_sidak_familywise_p() {
        let frame = extent_frame();
        let z = ResolvedField {
            kind: FieldKind::Z,
            from_request: false,
        };
        let mut p = peak_params(3.1, 3, 8.0);
        p.sign = ClusterSign::Positive;
        let mut one = find_clusters(&frame, &p);
        apply_extent_inference(&mut one, &frame, [4.0; 3], z, None).unwrap();
        p.sign = ClusterSign::Both;
        let mut two = find_clusters(&frame, &p);
        apply_extent_inference(&mut two, &frame, [4.0; 3], z, None).unwrap();
        let (a, b) = (
            one.extent_inference.as_ref().unwrap(),
            two.extent_inference.as_ref().unwrap(),
        );
        assert_eq!((a.tails, b.tails), (1, 2));
        // E[m] and the search volume are per tail and unchanged.
        assert_eq!(a.expected_clusters, b.expected_clusters);
        assert_eq!((a.search_voxels, a.resels), (b.search_voxels, b.resels));
        assert!(b.assumption.contains("Both tails searched"));
        assert!(b.assumption.contains("Search volume: 8000 voxels"));
        for (x, y) in one.clusters.iter().zip(&two.clusters) {
            let p1 = x.p_fwe_extent.unwrap();
            close(y.p_fwe_extent.unwrap(), 1.0 - (1.0 - p1).powi(2));
            assert_eq!(x.p_uncorrected_extent, y.p_uncorrected_extent);
        }
        // F maps have one tail even when both signs are requested.
        let f = ResolvedField {
            kind: FieldKind::F {
                df1: 2.0,
                df2: 30.0,
            },
            from_request: true,
        };
        let mut table = find_clusters(&frame, &p);
        apply_extent_inference(&mut table, &frame, [4.0; 3], f, None).unwrap();
        assert_eq!(table.extent_inference.unwrap().tails, 1);
    }

    #[test]
    fn pre_thresholded_maps_need_a_search_mask() {
        // Zero background with only suprathreshold blobs: an exported
        // thresholded map. Its non-zero voxels are not a search volume.
        let values: Vec<f32> = extent_frame()
            .values
            .iter()
            .map(|v| if *v > 3.1 { *v } else { 0.0 })
            .collect();
        let frame = frame_3d([20, 20, 20], [2.0; 3], [0.0; 3], values);
        assert!(looks_pre_thresholded(&frame, 3.1));
        assert!(!looks_pre_thresholded(&extent_frame(), 3.1));
        let z = ResolvedField {
            kind: FieldKind::Z,
            from_request: false,
        };
        let mut p = peak_params(3.1, 3, 8.0);
        p.sign = ClusterSign::Positive;
        let mut table = find_clusters(&frame, &p);
        match apply_extent_inference(&mut table, &frame, [4.0; 3], z, None) {
            Err(BridgeError::Input { code, details }) => {
                assert_eq!(code, 4080);
                assert!(details.contains("pre-thresholded"), "{details}");
            }
            other => panic!("expected a pre-threshold refusal, got {other:?}"),
        }
        // With an explicit (whole-grid) mask the same map is fine, and gives
        // the same answer as the unthresholded map over the same grid.
        let whole = vec![true; 8000];
        apply_extent_inference(&mut table, &frame, [4.0; 3], z, Some(&whole)).unwrap();
        close(
            table.clusters[0].p_fwe_extent.unwrap(),
            9.833503809353328e-05,
        );
        // F maps cannot be searched for negative clusters.
        let f = ResolvedField {
            kind: FieldKind::F {
                df1: 2.0,
                df2: 30.0,
            },
            from_request: true,
        };
        let mut n = peak_params(3.1, 3, 8.0);
        n.sign = ClusterSign::Negative;
        let mut negative = find_clusters(&extent_frame(), &n);
        assert!(apply_extent_inference(&mut negative, &extent_frame(), [4.0; 3], f, None).is_err());
    }

    #[test]
    fn extent_inference_is_off_by_default_and_validates_inputs() {
        let frame = extent_frame();
        let table = find_clusters(&frame, &peak_params(3.1, 3, 8.0));
        assert!(table.extent_inference.is_none());
        assert!(table.clusters.iter().all(|c| c.p_fwe_extent.is_none()));
        let z = ResolvedField {
            kind: FieldKind::Z,
            from_request: false,
        };
        let mut t = table.clone();
        assert!(apply_extent_inference(&mut t, &frame, [0.0, 4.0, 4.0], z, None).is_err());
        let mut zero = find_clusters(&frame, &peak_params(0.0, 3, 8.0));
        assert!(apply_extent_inference(&mut zero, &frame, [4.0; 3], z, None).is_err());
        // An all-zero image has no search volume.
        let empty = frame_3d([4, 4, 4], [2.0; 3], [0.0; 3], vec![0.0; 64]);
        let mut e = find_clusters(&empty, &peak_params(3.1, 3, 8.0));
        assert!(apply_extent_inference(&mut e, &empty, [4.0; 3], z, None).is_err());
    }

    #[test]
    fn field_comes_from_request_or_header() {
        let request = |statistic, df| RftExtentRequest {
            fwhm_mm: FwhmMm::Isotropic(8.0),
            statistic,
            df,
            df2: None,
        };
        let z = bridge_types::StatisticInfo::from_intent(5, [0.0; 3], "", "");
        let t = bridge_types::StatisticInfo::from_intent(3, [24.0, 0.0, 0.0], "", "");
        let p = bridge_types::StatisticInfo::from_intent(22, [0.0; 3], "", "");
        assert_eq!(
            resolve_field(&request(None, None), Some(&z)).unwrap(),
            ResolvedField {
                kind: FieldKind::Z,
                from_request: false
            }
        );
        assert_eq!(
            resolve_field(&request(None, None), Some(&t)).unwrap().kind,
            FieldKind::T { df: 24.0 }
        );
        // Request df overrides the header df; a declared statistic wins.
        assert_eq!(
            resolve_field(&request(None, Some(30.0)), Some(&t))
                .unwrap()
                .kind,
            FieldKind::T { df: 30.0 }
        );
        let declared = resolve_field(&request(Some(ExtentStatistic::Z), None), Some(&t)).unwrap();
        assert_eq!((declared.kind, declared.from_request), (FieldKind::Z, true));
        // p maps and unlabelled images need a declaration; t needs df.
        assert!(resolve_field(&request(None, None), Some(&p)).is_err());
        assert!(resolve_field(&request(None, None), None).is_err());
        assert!(resolve_field(&request(Some(ExtentStatistic::T), None), None).is_err());
        // F from the header dof, with request overrides.
        let f = bridge_types::StatisticInfo::from_intent(4, [2.0, 30.0, 0.0], "", "");
        assert_eq!(
            resolve_field(&request(None, None), Some(&f)).unwrap().kind,
            FieldKind::F {
                df1: 2.0,
                df2: 30.0
            }
        );
        let mut only_df1 = request(Some(ExtentStatistic::F), Some(3.0));
        assert!(resolve_field(&only_df1, None).is_err());
        only_df1.df2 = Some(40.0);
        assert_eq!(
            resolve_field(&only_df1, None).unwrap().kind,
            FieldKind::F {
                df1: 3.0,
                df2: 40.0
            }
        );
        assert!(
            resolve_field(&request(Some(ExtentStatistic::T), Some(12.0)), None)
                .unwrap()
                .kind
                == FieldKind::T { df: 12.0 }
        );
    }

    #[test]
    fn extent_request_accepts_scalar_or_per_axis_fwhm() {
        let r: ComputeClustersRequest = serde_json::from_str(
            r#"{"volumeId":"v","threshold":3.1,"extent":{"method":"rft-extent","fwhmMm":8}}"#,
        )
        .unwrap();
        let Some(ClusterExtentMethodRequest::RftExtent(extent)) = r.extent else {
            panic!("rft-extent request expected");
        };
        assert_eq!(extent.fwhm_mm.per_axis(), [8.0; 3]);
        // Unknown or unimplemented methods are rejected at deserialisation.
        for method in ["tfce", "spm"] {
            let json = format!(
                r#"{{"volumeId":"v","threshold":3.1,"extent":{{"method":"{method}","fwhmMm":8}}}}"#
            );
            assert!(serde_json::from_str::<ComputeClustersRequest>(&json).is_err());
        }
        let r: ComputeClustersRequest = serde_json::from_str(
            r#"{"volumeId":"v","threshold":3.1,"maxPeaksPerCluster":5,"minPeakDistanceMm":6,
               "extent":{"method":"rft-extent","fwhmMm":[6,7,8],"statistic":"t","df":20}}"#,
        )
        .unwrap();
        let Some(ClusterExtentMethodRequest::RftExtent(extent)) = r.extent else {
            panic!("rft-extent request expected");
        };
        assert_eq!(extent.fwhm_mm.per_axis(), [6.0, 7.0, 8.0]);
        assert_eq!(
            (extent.statistic, extent.df),
            (Some(ExtentStatistic::T), Some(20.0))
        );
        assert_eq!(
            (r.max_peaks_per_cluster, r.min_peak_distance_mm),
            (Some(5), Some(6.0))
        );
    }

    /// Clusters on load (QA features 2026-10-31 §8): the request the UI sends
    /// for a z map at its default threshold (|z| > 3.1, both signs, 26-connected,
    /// ≥ 1 voxel, default peaks) against the p4 fixture truth
    /// (`~/Documents/brainflow-p4-native/fixtures/truth.json`). The fixture
    /// lives outside the repository, so the test is ignored by default and
    /// fails (does not skip) when run without it:
    /// `cargo test -p api-bridge --lib p4_zmap_clusters_match_fixture_truth -- --ignored`.
    #[tokio::test]
    #[ignore = "needs ~/Documents/brainflow-p4-native/fixtures (run with --ignored)"]
    async fn p4_zmap_clusters_match_fixture_truth() {
        let home = std::env::var_os("HOME").expect("HOME");
        let path = std::path::Path::new(&home)
            .join("Documents/brainflow-p4-native/fixtures/zmap/p4_zmap.nii");
        assert!(path.exists(), "fixture missing: {}", path.display());
        let (volume, _affine) = nifti_loader::load_nifti_volume_auto(&path).unwrap();
        let state = BridgeState::default().unwrap();
        state.volume_registry.lock().await.insert(
            "p4".into(),
            volume,
            crate::VolumeMetadataInfo {
                name: "p4_zmap".into(),
                path: path.display().to_string(),
                dtype: "f32".into(),
                volume_type: bridge_types::VolumeType::Volume3D,
                time_series_info: None,
            },
        );
        let request: ComputeClustersRequest = serde_json::from_str(
            r#"{"volumeId":"p4","threshold":3.1,"sign":"both","connectivity":26,"minVoxels":1}"#,
        )
        .unwrap();
        let table = compute_clusters_impl(request, &state).await.unwrap();
        // (voxels, peak value, peak mm, peak ijk) per truth.json b_zmap_clusters.
        let truth: [(u64, f32, [f32; 3], [u32; 3]); 3] = [
            (165, 6.4052, [-40.0, -20.0, 50.0], [28, 56, 64]),
            (31, 4.9027, [42.0, -60.0, -10.0], [69, 36, 34]),
            (26, -4.75, [0.0, 40.0, 10.0], [48, 86, 44]),
        ];
        assert_eq!(table.clusters.len(), 3);
        for (cluster, (voxels, peak, mm, ijk)) in table.clusters.iter().zip(truth) {
            assert_eq!(cluster.voxel_count, voxels);
            assert!(
                (cluster.peak_value - peak).abs() < 1e-3,
                "{} vs {peak}",
                cluster.peak_value
            );
            for axis in 0..3 {
                assert!(
                    (cluster.peak_mm[axis] - mm[axis]).abs() < 1e-3,
                    "{:?} vs {mm:?}",
                    cluster.peak_mm
                );
            }
            assert_eq!(cluster.peak_ijk, ijk);
        }
        // Cluster 1's sub-peaks (max 3, ≥ 8 mm apart).
        let sub: Vec<[f32; 3]> = table.clusters[0].sub_peaks.iter().map(|p| p.mm).collect();
        assert_eq!(sub, vec![[-28.0, -20.0, 50.0], [-16.0, -20.0, 50.0]]);
    }

    #[tokio::test]
    async fn compute_clusters_command_reports_extent_and_sub_peaks() {
        use crate::volume_queries::test_support::volume_3d;
        let state = BridgeState::default().unwrap();
        let frame = extent_frame();
        state.volume_registry.lock().await.insert(
            "stat".into(),
            volume_3d([20, 20, 20], [2.0; 3], [0.0; 3], frame.values.to_vec()),
            crate::VolumeMetadataInfo {
                name: "stat".into(),
                path: "<memory>".into(),
                dtype: "f32".into(),
                volume_type: bridge_types::VolumeType::Volume3D,
                time_series_info: None,
            },
        );
        let request: ComputeClustersRequest = serde_json::from_str(
            r#"{"volumeId":"stat","threshold":3.1,"sign":"positive",
               "extent":{"method":"rft-extent","fwhmMm":4,"statistic":"z"}}"#,
        )
        .unwrap();
        let table = compute_clusters_impl(request, &state).await.unwrap();
        assert_eq!(table.clusters.len(), 2);
        close(
            table.clusters[0].p_fwe_extent.unwrap(),
            9.833503809353328e-05,
        );
        // No header statistic and no declaration: a clear error.
        let request: ComputeClustersRequest = serde_json::from_str(
            r#"{"volumeId":"stat","threshold":3.1,"extent":{"method":"rft-extent","fwhmMm":4}}"#,
        )
        .unwrap();
        match compute_clusters_impl(request, &state).await {
            Err(BridgeError::Input { code, details }) => {
                assert_eq!(code, 4080);
                assert!(details.contains("z, t or F"), "{details}");
            }
            other => panic!("expected extent error, got {other:?}"),
        }
    }

    /// Review H2: a background run never emits labels, so the label volume of
    /// the table the user is looking at stays registered.
    #[tokio::test]
    async fn quiet_request_keeps_the_user_label_volume() {
        use crate::volume_queries::test_support::volume_3d;
        let state = BridgeState::default().unwrap();
        state.volume_registry.lock().await.insert(
            "stat-quiet".into(),
            volume_3d(DIMS, [2.0; 3], [-10.0; 3], fixture().values.to_vec()),
            crate::VolumeMetadataInfo {
                name: "stat".into(),
                path: "<memory>".into(),
                dtype: "f32".into(),
                volume_type: bridge_types::VolumeType::Volume3D,
                time_series_info: None,
            },
        );
        let user: ComputeClustersRequest = serde_json::from_str(
            r#"{"volumeId":"stat-quiet","threshold":2.0,"minVoxels":2,"emitLabelVolume":true}"#,
        )
        .unwrap();
        let shown = compute_clusters_impl(user, &state).await.unwrap();
        let label_id = shown.label_volume_id.clone().expect("label volume");
        let quiet: ComputeClustersRequest = serde_json::from_str(
            r#"{"volumeId":"stat-quiet","threshold":3.0,"minVoxels":2,"emitLabelVolume":true,"quiet":true}"#,
        )
        .unwrap();
        let background = compute_clusters_impl(quiet, &state).await.unwrap();
        assert!(background.label_volume_id.is_none());
        assert!(state
            .volume_registry
            .lock()
            .await
            .get_entry(&label_id)
            .is_some());
    }

    #[tokio::test]
    async fn emitted_label_volume_is_a_region_locus_for_each_cluster() {
        use crate::region_locus::{LabelSource, RegionLocus};
        use crate::volume_queries::test_support::volume_3d;
        let state = BridgeState::default().unwrap();
        let frame = fixture();
        let metadata = |name: &str| crate::VolumeMetadataInfo {
            name: name.into(),
            path: "<memory>".into(),
            dtype: "f32".into(),
            volume_type: bridge_types::VolumeType::Volume3D,
            time_series_info: None,
        };
        state.volume_registry.lock().await.insert(
            "stat-e3".into(),
            volume_3d(DIMS, [2.0; 3], [-10.0; 3], frame.values.to_vec()),
            metadata("stat"),
        );
        state
            .layer_to_volume_map
            .lock()
            .await
            .insert("layer-stat".into(), "stat-e3".into());
        let request: ComputeClustersRequest = serde_json::from_str(
            r#"{"volumeId":"stat-e3","threshold":2.0,"minVoxels":2,"emitLabelVolume":true}"#,
        )
        .unwrap();
        let table = compute_clusters_impl(request.clone(), &state)
            .await
            .unwrap();
        let label_id = table.label_volume_id.clone().expect("label volume");
        // Each cluster's region on the stat map recovers its size and mean.
        for cluster in &table.clusters {
            let locus = RegionLocus {
                label_source: LabelSource::Volume {
                    volume_id: label_id.clone(),
                },
                label_ids: vec![cluster.id],
            };
            let series = crate::sample_stack_locus_impl(
                "layer-stat",
                &[],
                0.0,
                "mean",
                Some(&locus),
                &state,
            )
            .await
            .unwrap();
            assert!((series[0] - cluster.mean_value).abs() < 1e-5, "{cluster:?}");
            let region = crate::region_locus::prepare_region(
                &locus,
                &state,
                &crate::population_sampling::SampleCancellation::default(),
            )
            .await
            .unwrap();
            assert_eq!(region.voxel_count as u64, cluster.voxel_count);
        }
        // Discarded clusters (below minVoxels) are 0 in the label image.
        let speck = RegionLocus {
            label_source: LabelSource::Volume {
                volume_id: label_id.clone(),
            },
            label_ids: vec![table.clusters.len() as u32 + 1],
        };
        assert!(crate::region_locus::prepare_region(
            &speck,
            &state,
            &crate::population_sampling::SampleCancellation::default()
        )
        .await
        .is_err());
        // A second emission replaces the first (not displayed as a layer).
        let second = compute_clusters_impl(request, &state).await.unwrap();
        let second_id = second.label_volume_id.unwrap();
        assert_ne!(second_id, label_id);
        let registry = state.volume_registry.lock().await;
        assert!(registry.get(&label_id).is_none());
        assert!(registry.get(&second_id).is_some());
    }

    async fn register_volume(state: &BridgeState, id: &str, volume: bridge_types::VolumeSendable) {
        state.volume_registry.lock().await.insert(
            id.into(),
            volume,
            crate::VolumeMetadataInfo {
                name: id.into(),
                path: "<memory>".into(),
                dtype: "f32".into(),
                volume_type: bridge_types::VolumeType::Volume3D,
                time_series_info: None,
            },
        );
    }

    /// Half-volume mask (i < 10) on the 20^3, 2 mm extent grid.
    fn half_mask() -> Vec<f32> {
        (0..8000)
            .map(|index| if index % 20 < 10 { 1.0 } else { 0.0 })
            .collect()
    }

    #[tokio::test]
    async fn search_mask_bounds_clusters_and_rft_search_volume() {
        use crate::volume_queries::test_support::volume_3d;
        let state = BridgeState::default().unwrap();
        let stat = format!("stat-mask-{}", uuid::Uuid::new_v4());
        let frame = extent_frame();
        register_volume(
            &state,
            &stat,
            volume_3d([20; 3], [2.0; 3], [0.0; 3], frame.values.to_vec()),
        )
        .await;
        register_volume(
            &state,
            "mask-half",
            volume_3d([20; 3], [2.0; 3], [0.0; 3], half_mask()),
        )
        .await;
        let request = |mask: Option<&str>| -> ComputeClustersRequest {
            let mask = mask
                .map(|m| format!(r#","searchMask":"{m}""#))
                .unwrap_or_default();
            serde_json::from_str(&format!(
                r#"{{"volumeId":"{stat}","threshold":3.1,"sign":"positive"{mask},
                    "extent":{{"method":"rft-extent","fwhmMm":4,"statistic":"z"}}}}"#
            ))
            .unwrap()
        };
        // Default: the map's non-zero voxels (background 0.5 everywhere).
        let full = compute_clusters_impl(request(None), &state).await.unwrap();
        assert_eq!(
            full.search_volume,
            Some(SearchVolume {
                kind: SearchVolumeKind::MapNonzero,
                mask_volume_id: None,
                voxels: 8000,
                mask_voxels_outside_map: None,
            })
        );
        assert_eq!(full.clusters.len(), 2);
        // Half mask: the 8-voxel cluster at i = 12..13 is outside; resels are
        // those of a 10 x 20 x 20 box: R = [1, 23.5, 175.75, 406.125].
        let half = compute_clusters_impl(request(Some("mask-half")), &state)
            .await
            .unwrap();
        assert_eq!(
            half.search_volume,
            Some(SearchVolume {
                kind: SearchVolumeKind::Mask,
                mask_volume_id: Some("mask-half".into()),
                voxels: 4000,
                // Background 0.5 everywhere: every mask voxel has a map value.
                mask_voxels_outside_map: Some(0),
            })
        );
        assert_eq!(half.clusters.len(), 1);
        assert_eq!(half.clusters[0].voxel_count, 27);
        let inference = half.extent_inference.as_ref().unwrap();
        assert_eq!(inference.resels, [1.0, 23.5, 175.75, 406.125]);
        assert_eq!(inference.search_voxels, 4000);
        // Reference: rft_reference.py p_rf(27 * 0.125, f32(3.1), "Z", R).
        close(inference.expected_clusters, 4.185829301833703e+00);
        close(
            half.clusters[0].p_fwe_extent.unwrap(),
            4.934507476339611e-05,
        );
        close(
            half.clusters[0].p_uncorrected_extent.unwrap(),
            1.178889264547693e-05,
        );
    }

    #[tokio::test]
    async fn search_mask_counts_zero_map_voxels_and_resamples_other_grids() {
        use crate::volume_queries::test_support::volume_3d;
        let state = BridgeState::default().unwrap();
        let stat = format!("stat-zero-{}", uuid::Uuid::new_v4());
        // Map: 8^3, 2 mm, zero background with one 2x2x2 blob of 5.
        let mut values = vec![0.0f32; 512];
        for k in 2..4 {
            for j in 2..4 {
                for i in 2..4 {
                    values[i + 8 * (j + 8 * k)] = 5.0;
                }
            }
        }
        // One non-finite voxel inside the mask region.
        values[0] = f32::NAN;
        register_volume(&state, &stat, volume_3d([8; 3], [2.0; 3], [0.0; 3], values)).await;
        // Mask on a 4 mm grid: mask voxels i = 0..=2 (centres 0, 4, 8 mm).
        let coarse: Vec<f32> = (0..64)
            .map(|index| if index % 4 < 3 { 1.0 } else { 0.0 })
            .collect();
        register_volume(
            &state,
            "mask-coarse",
            volume_3d([4; 3], [4.0; 3], [0.0; 3], coarse),
        )
        .await;
        let run = |mask: Option<&str>| {
            let mask = mask
                .map(|m| format!(r#","searchMask":"{m}""#))
                .unwrap_or_default();
            serde_json::from_str::<ComputeClustersRequest>(&format!(
                r#"{{"volumeId":"{stat}","threshold":1.0{mask}}}"#
            ))
            .unwrap()
        };
        let default = compute_clusters_impl(run(None), &state).await.unwrap();
        // Non-zero map voxels only: the blob.
        let default_volume = default.search_volume.unwrap();
        assert_eq!(
            (
                default_volume.voxels,
                default_volume.mask_voxels_outside_map
            ),
            (8, None)
        );
        let masked = compute_clusters_impl(run(Some("mask-coarse")), &state)
            .await
            .unwrap();
        // Map voxel centres x = 2i mm map to mask voxel floor(x / 4 + 0.5):
        // along x, i = 0..=4 (x <= 8 mm) land on mask voxels 0..=2; along y and
        // z, j, k = 0..=6 land inside the 4-voxel mask grid (14 mm maps to
        // index 4, outside) -> 5 x 7 x 7 = 245 mask voxels on the map grid;
        // the blob (i, j, k = 2, 3) stays whole. One of them is NaN, so 244
        // are searched (zeros included), and 245 - 8 blob = 237 carry no map
        // value (236 zeros + 1 NaN).
        let volume = masked.search_volume.unwrap();
        assert_eq!(
            (volume.kind, volume.voxels, volume.mask_voxels_outside_map),
            (SearchVolumeKind::Mask, 244, Some(237))
        );
        assert_eq!(masked.clusters.len(), 1);
        assert_eq!(masked.clusters[0].voxel_count, 8);
        // Missing or empty masks are errors.
        assert!(compute_clusters_impl(run(Some("no-such-mask")), &state)
            .await
            .is_err());
        register_volume(
            &state,
            "mask-empty",
            volume_3d([4; 3], [4.0; 3], [0.0; 3], vec![0.0; 64]),
        )
        .await;
        match compute_clusters_impl(run(Some("mask-empty")), &state).await {
            Err(BridgeError::Input { code, .. }) => assert_eq!(code, 4081),
            other => panic!("expected empty-mask error, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn pre_thresholded_map_keeps_clusters_and_withholds_extent_p() {
        use crate::volume_queries::test_support::volume_3d;
        let state = BridgeState::default().unwrap();
        let stat = format!("stat-thresh-{}", uuid::Uuid::new_v4());
        let thresholded: Vec<f32> = extent_frame()
            .values
            .iter()
            .map(|v| if *v > 3.1 { *v } else { 0.0 })
            .collect();
        register_volume(
            &state,
            &stat,
            volume_3d([20; 3], [2.0; 3], [0.0; 3], thresholded),
        )
        .await;
        register_volume(
            &state,
            "mask-whole",
            volume_3d([20; 3], [2.0; 3], [0.0; 3], vec![1.0; 8000]),
        )
        .await;
        let run = |mask: Option<&str>| {
            let mask = mask
                .map(|m| format!(r#","searchMask":"{m}""#))
                .unwrap_or_default();
            serde_json::from_str::<ComputeClustersRequest>(&format!(
                r#"{{"volumeId":"{stat}","threshold":3.1,"sign":"positive"{mask},
                    "extent":{{"method":"rft-extent","fwhmMm":4,"statistic":"z"}}}}"#
            ))
            .unwrap()
        };
        let withheld = compute_clusters_impl(run(None), &state).await.unwrap();
        assert_eq!(withheld.clusters.len(), 2, "clusters still computed");
        assert!(withheld.extent_inference.is_none());
        assert!(withheld.clusters.iter().all(|c| c.p_fwe_extent.is_none()));
        let reason = withheld.extent_withheld.expect("withheld");
        assert_eq!(reason.code, 4080);
        assert_eq!(
            reason.reason,
            "This map looks pre-thresholded (no |z| < 3.1 among non-zero voxels); cluster p \
             needs the unthresholded map or a search mask."
        );
        // A search mask lifts the refusal and reproduces the reference p.
        let masked = compute_clusters_impl(run(Some("mask-whole")), &state)
            .await
            .unwrap();
        assert!(masked.extent_withheld.is_none());
        close(
            masked.clusters[0].p_fwe_extent.unwrap(),
            9.833503809353328e-05,
        );
    }
}
