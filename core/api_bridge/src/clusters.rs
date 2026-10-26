//! Suprathreshold cluster table (connected components with peaks).
//!
//! Positive (`v > threshold`) and negative (`v < -threshold`) voxels are
//! labelled separately, so a positive blob touching a negative one stays two
//! clusters. One flood fill per component gives O(N · neighbours) time with a
//! u32 label per voxel. Non-finite values never pass the threshold.
use crate::volume_queries::{resolve_volume, with_frame, world_envelope, Frame};
use crate::BridgeState;
use bridge_types::{BridgeError, BridgeResult};
use serde::{Deserialize, Serialize};
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
    /// negative voxels `v < -threshold`.
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
    /// Cap on returned rows (default 500); `truncated` reports a cut.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub max_clusters: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum ClusterPolarity {
    Positive,
    Negative,
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
}

pub(crate) struct ClusterParams {
    pub threshold: f32,
    pub sign: ClusterSign,
    pub connectivity: u8,
    pub min_voxels: u32,
    pub max_clusters: u32,
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

struct Accumulator {
    polarity: ClusterPolarity,
    first_index: usize,
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
    fn new(polarity: ClusterPolarity, first_index: usize, first_value: f32) -> Self {
        Self {
            polarity,
            first_index,
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
            mean_value: (self.sum_value / n) as f32,
            centroid_ijk,
            centroid_mm: to_world(centroid_ijk),
            weighted_centroid_mm: to_world(weighted_ijk),
            bbox_ijk_min: self.lo.map(|v| v as u32),
            bbox_ijk_max: self.hi.map(|v| v as u32),
            bbox_mm_min,
            bbox_mm_max,
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
    Ok(max_clusters.unwrap_or(500).max(1))
}

pub(crate) fn find_clusters(frame: &Frame, params: &ClusterParams) -> ClusterTable {
    let [nx, ny, nz] = frame.dims;
    let threshold = params.threshold;
    let polarity_of = |v: f32| -> Option<ClusterPolarity> {
        if !v.is_finite() {
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
    let mut visited = vec![false; frame.values.len()];
    let mut stack = Vec::new();
    let mut kept = Vec::new();
    let mut discarded = 0u32;
    let mut suprathreshold = 0u64;

    for seed in 0..frame.values.len() {
        if visited[seed] {
            continue;
        }
        let Some(polarity) = polarity_of(frame.values[seed]) else {
            continue;
        };
        visited[seed] = true;
        stack.push(seed);
        let mut acc = Accumulator::new(polarity, seed, frame.values[seed]);
        while let Some(index) = stack.pop() {
            let ijk = frame.ijk(index);
            acc.add(index, ijk, frame.values[index]);
            for offset in &offsets {
                let i = ijk[0] as isize + offset[0];
                let j = ijk[1] as isize + offset[1];
                let k = ijk[2] as isize + offset[2];
                if i < 0
                    || j < 0
                    || k < 0
                    || i >= nx as isize
                    || j >= ny as isize
                    || k >= nz as isize
                {
                    continue;
                }
                let neighbour = frame.index(i as usize, j as usize, k as usize);
                if !visited[neighbour] && polarity_of(frame.values[neighbour]) == Some(polarity) {
                    visited[neighbour] = true;
                    stack.push(neighbour);
                }
            }
        }
        suprathreshold += acc.count;
        if acc.count < u64::from(params.min_voxels) {
            discarded += 1;
        } else {
            kept.push(acc);
        }
    }

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
    let clusters = kept
        .iter()
        .take(params.max_clusters as usize)
        .enumerate()
        .map(|(rank, acc)| ClusterSummary {
            id: rank as u32 + 1,
            ..acc.summary(frame, voxel_volume_mm3)
        })
        .collect();
    ClusterTable {
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
    }
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
    let max_clusters = validate_params(request.threshold, connectivity, request.max_clusters)?;
    let params = ClusterParams {
        threshold: request.threshold,
        sign: request.sign.unwrap_or_default(),
        connectivity,
        min_voxels: request.min_voxels.unwrap_or(1),
        max_clusters,
    };
    let (volume, timepoint) = resolve_volume(
        state,
        request.volume_id.as_deref(),
        request.layer_id.as_deref(),
        request.timepoint,
    )
    .await?;
    with_frame(volume, timepoint, move |frame| {
        Ok(find_clusters(&frame, &params))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::volume_queries::extract_frame;
    use crate::volume_queries::test_support::volume_3d;

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
    fn fixture() -> Frame {
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
        extract_frame(&volume_3d(DIMS, [2.0; 3], [-10.0; 3], values), 0).unwrap()
    }

    fn params(sign: ClusterSign, connectivity: u8, min_voxels: u32) -> ClusterParams {
        ClusterParams {
            threshold: 2.0,
            sign,
            connectivity,
            min_voxels,
            max_clusters: 500,
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
}
