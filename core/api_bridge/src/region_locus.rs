//! Region loci: label regions (atlas parcels, label maps, cluster ids) as a
//! sampling locus for population and stack sampling.
//!
//! A region is the set of voxels of a label volume whose label is in
//! `labelIds`. Members on another grid are mapped voxel by voxel: a member
//! voxel belongs to the region when its centre, mapped through the member and
//! label affines, falls (nearest neighbour) on a region voxel of the label
//! grid. Each member voxel is counted once, so the region is resampled onto the
//! member grid rather than weighting member voxels by label-voxel hits. The
//! per-grid voxel list is cached on the prepared region, so members that share
//! a grid pay for the mapping once.
//!
//! A path-backed label volume joins the population query's source guard (its
//! stamp is rechecked after sampling) and reports its digest as
//! `regionRevision`; a frozen query (pinned member or mask digests) must also
//! pin it with `expectedSha256`.
use crate::population_sampling::SampleCancellation;
use crate::set_sample_cache::SampleSourceRevision;
use crate::volume_queries::nearest_voxel;
use crate::BridgeState;
use bridge_types::{BridgeError, BridgeResult, VolumeSendable};
use nalgebra::{Affine3, Point3};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};
use std::sync::{Arc, Mutex};
use ts_rs::TS;

/// Upper bound on label-grid voxels a region may be prepared from.
const MAX_LABEL_VOXELS: usize = 64 * 1024 * 1024;

/// Where the label volume of a region comes from.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum LabelSource {
    /// A loaded UI layer (e.g. an atlas or label map).
    Layer {
        #[serde(rename = "layerId")]
        layer_id: String,
    },
    /// A registered volume, e.g. the cluster label volume from
    /// `compute_clusters` (`labelVolumeId`).
    Volume {
        #[serde(rename = "volumeId")]
        volume_id: String,
    },
    /// A label image on disk (or `template:` id), optionally pinned by digest.
    Path {
        path: String,
        #[serde(default, rename = "expectedSha256")]
        #[ts(optional = nullable)]
        expected_sha256: Option<String>,
    },
}

/// A region locus: the voxels of `labelSource` whose label is in `labelIds`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RegionLocus {
    pub label_source: LabelSource,
    pub label_ids: Vec<u32>,
}

fn input(details: impl Into<String>) -> BridgeError {
    BridgeError::Input {
        code: 2027,
        details: details.into(),
    }
}

type GridKey = ([usize; 3], [u32; 12]);
type VoxelList = Arc<Vec<(usize, usize, usize)>>;

fn grid_key(dims: [usize; 3], affine: &Affine3<f32>) -> GridKey {
    let m = affine.matrix();
    let mut bits = [0u32; 12];
    for row in 0..3 {
        for col in 0..4 {
            bits[row * 4 + col] = m[(row, col)].to_bits();
        }
    }
    (dims, bits)
}

/// A region resolved against its label grid, ready to map onto member grids.
pub struct PreparedRegion {
    dims: [usize; 3],
    world_to_label: Affine3<f32>,
    label_to_world: Affine3<f32>,
    inside: Vec<bool>,
    /// Inclusive label-voxel bounding box of the region.
    lo: [usize; 3],
    hi: [usize; 3],
    pub voxel_count: usize,
    pub label_ids: Vec<u32>,
    /// Digest of a path-backed label source.
    pub revision: Option<SampleSourceRevision>,
    cache: Mutex<HashMap<GridKey, VoxelList>>,
}

impl std::fmt::Debug for PreparedRegion {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PreparedRegion")
            .field("dims", &self.dims)
            .field("voxel_count", &self.voxel_count)
            .field("label_ids", &self.label_ids)
            .finish()
    }
}

impl PreparedRegion {
    /// Mark the label-grid voxels whose label is in `label_ids`. Labels are
    /// read from the single spatial frame and must be finite non-negative
    /// integers (within 1e-3) to match.
    pub fn prepare(
        volume: &VolumeSendable,
        label_ids: &[u32],
        revision: Option<SampleSourceRevision>,
        token: &SampleCancellation,
    ) -> BridgeResult<Self> {
        let wanted: BTreeSet<u32> = label_ids.iter().copied().filter(|id| *id != 0).collect();
        if wanted.is_empty() {
            return Err(input(
                "A region locus needs at least one non-background label id.",
            ));
        }
        if crate::stack_length_for_volume(volume) != 1 {
            return Err(input(
                "A region's label volume must have one spatial frame.",
            ));
        }
        let affine = crate::get_affine_from_volume(volume)?;
        let world_to_label = affine
            .try_inverse()
            .ok_or_else(|| input("The label volume's affine is not invertible."))?;
        let d = crate::get_spatial_dims_from_volume(volume);
        let dims = [
            d.first().copied().unwrap_or(0),
            d.get(1).copied().unwrap_or(0),
            d.get(2).copied().unwrap_or(0),
        ];
        let count = dims
            .iter()
            .try_fold(1usize, |acc, &n| acc.checked_mul(n))
            .filter(|n| *n > 0 && *n <= MAX_LABEL_VOXELS)
            .ok_or_else(|| input("The label volume grid is empty or too large."))?;
        let mut inside = vec![false; count];
        let mut lo = [usize::MAX; 3];
        let mut hi = [0usize; 3];
        let mut voxel_count = 0usize;
        for (index, slot) in inside.iter_mut().enumerate() {
            if index % 65_536 == 0 {
                token.check()?;
            }
            let x = index % dims[0];
            let y = (index / dims[0]) % dims[1];
            let z = index / (dims[0] * dims[1]);
            let Some(value) = crate::read_member_frame_at_voxel(volume, x, y, z, 0) else {
                continue;
            };
            let rounded = value.round();
            if !value.is_finite() || rounded < 0.0 || (value - rounded).abs() > 1e-3 {
                continue;
            }
            if wanted.contains(&(rounded as u32)) {
                *slot = true;
                voxel_count += 1;
                for (axis, c) in [x, y, z].into_iter().enumerate() {
                    lo[axis] = lo[axis].min(c);
                    hi[axis] = hi[axis].max(c);
                }
            }
        }
        if voxel_count == 0 {
            return Err(input(format!(
                "No voxels carry label ids {:?} in the label volume.",
                wanted.iter().collect::<Vec<_>>()
            )));
        }
        Ok(Self {
            dims,
            world_to_label,
            label_to_world: affine,
            inside,
            lo,
            hi,
            voxel_count,
            label_ids: wanted.into_iter().collect(),
            revision,
            cache: Mutex::new(HashMap::new()),
        })
    }

    fn contains_world(&self, world: &Point3<f32>) -> bool {
        let p = self.world_to_label.transform_point(world);
        nearest_voxel([p.x, p.y, p.z], self.dims)
            .is_some_and(|[x, y, z]| self.inside[x + self.dims[0] * (y + self.dims[1] * z)])
    }

    /// Member-grid voxels in the region (pure; not cached).
    pub fn voxels_for_grid(
        &self,
        dims: [usize; 3],
        affine: &Affine3<f32>,
    ) -> Vec<(usize, usize, usize)> {
        let Some(world_to_member) = affine.try_inverse() else {
            return Vec::new();
        };
        if dims.contains(&0) {
            return Vec::new();
        }
        // Member index range covering the region's label-voxel extent.
        let mut min = [f32::INFINITY; 3];
        let mut max = [f32::NEG_INFINITY; 3];
        for corner in 0..8 {
            let pick = |axis: usize, bit: usize| {
                if corner & bit == 0 {
                    self.lo[axis] as f32 - 0.5
                } else {
                    self.hi[axis] as f32 + 0.5
                }
            };
            let world = self.label_to_world.transform_point(&Point3::new(
                pick(0, 1),
                pick(1, 2),
                pick(2, 4),
            ));
            let m = world_to_member.transform_point(&world);
            for (axis, v) in [m.x, m.y, m.z].into_iter().enumerate() {
                min[axis] = min[axis].min(v);
                max[axis] = max[axis].max(v);
            }
        }
        if (0..3).any(|a| max[a] < -0.5 || min[a] > dims[a] as f32 - 0.5) {
            return Vec::new();
        }
        let range = |axis: usize| {
            let start = min[axis].floor().max(0.0) as usize;
            let end = (max[axis].ceil() as usize).min(dims[axis] - 1);
            start..=end
        };
        let mut voxels = Vec::new();
        for k in range(2) {
            for j in range(1) {
                for i in range(0) {
                    let world = affine.transform_point(&Point3::new(i as f32, j as f32, k as f32));
                    if self.contains_world(&world) {
                        voxels.push((i, j, k));
                    }
                }
            }
        }
        voxels
    }

    /// Member voxels in the region, cached per member grid.
    pub fn member_voxels(
        &self,
        volume: &VolumeSendable,
    ) -> BridgeResult<Arc<Vec<(usize, usize, usize)>>> {
        let affine = crate::get_affine_from_volume(volume)?;
        let d = crate::get_spatial_dims_from_volume(volume);
        let dims = [
            d.first().copied().unwrap_or(0),
            d.get(1).copied().unwrap_or(0),
            d.get(2).copied().unwrap_or(0),
        ];
        let key = grid_key(dims, &affine);
        if let Some(hit) = self
            .cache
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .get(&key)
        {
            return Ok(Arc::clone(hit));
        }
        let voxels = Arc::new(self.voxels_for_grid(dims, &affine));
        self.cache
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .insert(key, Arc::clone(&voxels));
        Ok(voxels)
    }
}

/// Resolve `locus.label_source` and prepare the region.
pub async fn prepare_region(
    locus: &RegionLocus,
    state: &BridgeState,
    token: &SampleCancellation,
) -> BridgeResult<Arc<PreparedRegion>> {
    let label_ids = locus.label_ids.clone();
    let registered = match &locus.label_source {
        LabelSource::Layer { layer_id } => Some(
            state
                .layer_to_volume_map
                .lock()
                .await
                .get(layer_id)
                .cloned()
                .ok_or_else(|| input(format!("Layer {layer_id} is not mapped to a volume.")))?,
        ),
        LabelSource::Volume { volume_id } => Some(volume_id.clone()),
        LabelSource::Path { .. } => None,
    };
    if let Some(volume_id) = registered {
        let volume = state
            .volume_registry
            .lock()
            .await
            .get_arc(&volume_id)
            .ok_or_else(|| BridgeError::VolumeNotFound {
                code: 4041,
                details: volume_id.clone(),
            })?;
        let check = token.clone();
        return tokio::task::spawn_blocking(move || {
            PreparedRegion::prepare(&volume, &label_ids, None, &check).map(Arc::new)
        })
        .await
        .map_err(|error| BridgeError::Internal {
            code: 5073,
            details: format!("Region preparation failed: {error}"),
        })?;
    }
    let LabelSource::Path {
        path,
        expected_sha256,
    } = &locus.label_source
    else {
        unreachable!("registered sources returned above");
    };
    let path = crate::resolve_member_source_path(path, state).await?;
    let expected = expected_sha256.clone();
    let check = token.clone();
    state
        .set_sample_cache
        .with_volume_cancelable(path, token.clone(), move |volume, revision| {
            if expected
                .as_ref()
                .is_some_and(|hash| hash != &revision.sha256)
            {
                return Err(input("The frozen region label volume revision changed."));
            }
            PreparedRegion::prepare(volume, &label_ids, Some(revision.clone()), &check)
                .map(Arc::new)
        })
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::volume_queries::test_support::volume_3d;

    /// 6^3 label grid (2 mm, origin 0): label 3 on the 2x2x2 block i,j,k in
    /// 2..=3, label 5 on the single voxel (5,5,5).
    fn labels() -> VolumeSendable {
        let mut values = vec![0.0f32; 216];
        let at = |i: usize, j: usize, k: usize| i + 6 * (j + 6 * k);
        for k in 2..=3 {
            for j in 2..=3 {
                for i in 2..=3 {
                    values[at(i, j, k)] = 3.0;
                }
            }
        }
        values[at(5, 5, 5)] = 5.0;
        volume_3d([6, 6, 6], [2.0; 3], [0.0; 3], values)
    }

    fn prepared(ids: &[u32]) -> PreparedRegion {
        PreparedRegion::prepare(&labels(), ids, None, &SampleCancellation::default()).unwrap()
    }

    #[test]
    fn same_grid_region_is_the_labelled_voxels() {
        let region = prepared(&[3]);
        assert_eq!(region.voxel_count, 8);
        let member = labels();
        let voxels = region.member_voxels(&member).unwrap();
        assert_eq!(voxels.len(), 8);
        assert!(voxels.iter().all(|&(i, j, k)| (2..=3).contains(&i)
            && (2..=3).contains(&j)
            && (2..=3).contains(&k)));
        // Union of labels; background id 0 is ignored.
        assert_eq!(prepared(&[0, 3, 5]).voxel_count, 9);
        assert_eq!(prepared(&[3, 5]).label_ids, vec![3, 5]);
    }

    #[test]
    fn finer_member_grid_resamples_the_region() {
        // Member grid of 1 mm voxels over the same field of view (12^3,
        // origin 0): label voxels 2..=3 at 2 mm cover world [3, 7) mm, so the
        // member voxel centres 3..=6 on each axis are inside -> 4^3 = 64.
        let region = prepared(&[3]);
        let member = volume_3d([12, 12, 12], [1.0; 3], [0.0; 3], vec![1.0; 1728]);
        let voxels = region.member_voxels(&member).unwrap();
        assert_eq!(voxels.len(), 64);
        assert!(voxels
            .iter()
            .all(|&(i, _, _)| (3..=6).contains(&i) || i == 7 || i == 4));
        let xs: BTreeSet<usize> = voxels.iter().map(|v| v.0).collect();
        assert_eq!(xs.into_iter().collect::<Vec<_>>(), vec![3, 4, 5, 6]);
        // Cached per grid: the same Arc comes back.
        let again = region.member_voxels(&member).unwrap();
        assert!(Arc::ptr_eq(&voxels, &again));
    }

    #[test]
    fn shifted_coarser_member_grid_maps_by_world_position() {
        // 4 mm member voxels, origin 2 mm: member voxel centres at x = 2, 6, 10 ...
        // Region covers world [3, 7) mm -> centre 6 mm (index 1) only.
        let region = prepared(&[3]);
        let member = volume_3d([4, 4, 4], [4.0; 3], [2.0; 3], vec![1.0; 64]);
        let voxels = region.member_voxels(&member).unwrap();
        assert_eq!(voxels.as_slice(), &[(1, 1, 1)]);
        // A member grid entirely outside the region yields nothing.
        let far = volume_3d([4, 4, 4], [2.0; 3], [100.0; 3], vec![1.0; 64]);
        assert!(region.member_voxels(&far).unwrap().is_empty());
    }

    #[test]
    fn rejects_empty_or_absent_labels() {
        let token = SampleCancellation::default();
        assert!(PreparedRegion::prepare(&labels(), &[0], None, &token).is_err());
        assert!(PreparedRegion::prepare(&labels(), &[7], None, &token).is_err());
        assert!(PreparedRegion::prepare(&labels(), &[], None, &token).is_err());
    }

    #[test]
    fn locus_serialises_with_tagged_source() {
        let locus: RegionLocus = serde_json::from_str(
            r#"{"labelSource":{"type":"layer","layerId":"atlas"},"labelIds":[3,5]}"#,
        )
        .unwrap();
        assert_eq!(
            locus.label_source,
            LabelSource::Layer {
                layer_id: "atlas".into()
            }
        );
        let path: RegionLocus = serde_json::from_str(
            r#"{"labelSource":{"type":"path","path":"/a.nii","expectedSha256":"ab"},"labelIds":[1]}"#,
        )
        .unwrap();
        assert!(matches!(
            path.label_source,
            LabelSource::Path {
                expected_sha256: Some(_),
                ..
            }
        ));
    }

    fn x_ramp(dims: [usize; 3], offset: f32) -> Vec<f32> {
        (0..dims.iter().product::<usize>())
            .map(|index| (index % dims[0]) as f32 + offset)
            .collect()
    }

    #[test]
    fn member_values_are_gathered_over_the_resampled_region() {
        let region = prepared(&[3]);
        // Same grid: values = i, region i in {2, 3} -> 4 x 2 + 4 x 3.
        let member = volume_3d([6, 6, 6], [2.0; 3], [0.0; 3], x_ramp([6, 6, 6], 0.0));
        let mut vals =
            crate::gather_member_roi_values(&member, &[0.0; 3], 0.0, 0, None, Some(&region));
        vals.sort_by(f32::total_cmp);
        assert_eq!(vals, vec![2.0, 2.0, 2.0, 2.0, 3.0, 3.0, 3.0, 3.0]);
        // 1 mm member grid: centres 3..=6 on each axis -> mean of i is 4.5.
        let fine = volume_3d([12, 12, 12], [1.0; 3], [0.0; 3], x_ramp([12, 12, 12], 0.0));
        let vals = crate::gather_member_roi_values(&fine, &[0.0; 3], 0.0, 0, None, Some(&region));
        assert_eq!(vals.len(), 64);
        assert_eq!(vals.iter().sum::<f32>() / 64.0, 4.5);
    }

    async fn register(state: &BridgeState, id: &str, volume: VolumeSendable) {
        let metadata = crate::VolumeMetadataInfo {
            name: id.into(),
            path: "<memory>".into(),
            dtype: "f32".into(),
            volume_type: if crate::stack_length_for_volume(&volume) > 1 {
                bridge_types::VolumeType::TimeSeries4D
            } else {
                bridge_types::VolumeType::Volume3D
            },
            time_series_info: None,
        };
        state
            .volume_registry
            .lock()
            .await
            .insert(id.into(), volume, metadata);
        state
            .layer_to_volume_map
            .lock()
            .await
            .insert(format!("layer-{id}"), id.into());
    }

    #[tokio::test]
    async fn stack_sampling_reduces_a_region_per_frame_across_grids() {
        use volmath::{DenseNeuroVec, NeuroSpace};
        let state = BridgeState::default().unwrap();
        register(&state, "atlas", labels()).await;
        // 4D data on a 1 mm grid, 3 frames: value = 10 * frame + i.
        let space = NeuroSpace::new(
            vec![12, 12, 12, 3],
            Some(vec![1.0, 1.0, 1.0, 1.0]),
            Some(vec![0.0; 4]),
            None,
            None,
        )
        .unwrap();
        let mut data = DenseNeuroVec::<f32>::zeros(space).unwrap();
        for t in 0..3 {
            for k in 0..12 {
                for j in 0..12 {
                    for i in 0..12 {
                        data.data[[i, j, k, t]] = 10.0 * t as f32 + i as f32;
                    }
                }
            }
        }
        register(&state, "bold", VolumeSendable::Vec4DF32(data)).await;
        let locus = RegionLocus {
            label_source: LabelSource::Layer {
                layer_id: "layer-atlas".into(),
            },
            label_ids: vec![3],
        };
        let series =
            crate::sample_stack_locus_impl("layer-bold", &[], 0.0, "mean", Some(&locus), &state)
                .await
                .unwrap();
        assert_eq!(series, vec![4.5, 14.5, 24.5]);
        // The point path is unchanged.
        let point =
            crate::sample_stack_for_testing("layer-bold", &[5.0f32, 5.0, 5.0], 0.0, "mean", &state)
                .await
                .unwrap();
        assert_eq!(point, vec![5.0, 15.0, 25.0]);
        // A volume id source works the same; an unknown label is an error.
        let by_volume = RegionLocus {
            label_source: LabelSource::Volume {
                volume_id: "atlas".into(),
            },
            label_ids: vec![3],
        };
        let again = crate::sample_stack_locus_impl(
            "layer-bold",
            &[],
            0.0,
            "mean",
            Some(&by_volume),
            &state,
        )
        .await
        .unwrap();
        assert_eq!(again, series);
        let missing = RegionLocus {
            label_ids: vec![9],
            ..by_volume
        };
        assert!(crate::sample_stack_locus_impl(
            "layer-bold",
            &[],
            0.0,
            "mean",
            Some(&missing),
            &state
        )
        .await
        .is_err());
    }

    fn write_nifti(values: &[f32], dims: [usize; 3], spacing: f32) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("bf-region-{}.nii", uuid::Uuid::new_v4()));
        let mut header = nifti::NiftiHeader {
            sform_code: 1,
            srow_x: [spacing, 0.0, 0.0, 0.0],
            srow_y: [0.0, spacing, 0.0, 0.0],
            srow_z: [0.0, 0.0, spacing, 0.0],
            ..Default::default()
        };
        header.pixdim[1..4].copy_from_slice(&[spacing; 3]);
        let mut array = ndarray::Array3::<f32>::zeros((dims[0], dims[1], dims[2]));
        for k in 0..dims[2] {
            for j in 0..dims[1] {
                for i in 0..dims[0] {
                    array[[i, j, k]] = values[i + dims[0] * (j + dims[1] * k)];
                }
            }
        }
        nifti::writer::WriterOptions::new(&path)
            .reference_header(&header)
            .write_nifti(&array)
            .expect("write nifti");
        path
    }

    #[tokio::test]
    async fn population_traces_use_a_path_label_region() {
        let state = BridgeState::default().unwrap();
        let VolumeSendable::VolF32(label_volume, _) = labels() else {
            unreachable!()
        };
        let label_path = write_nifti(&label_volume.values(), [6, 6, 6], 2.0);
        let members: Vec<crate::SetMemberRef> = [0.0f32, 100.0]
            .iter()
            .enumerate()
            .map(|(n, offset)| crate::SetMemberRef {
                member_id: format!("s{n}"),
                source_path: write_nifti(&x_ramp([6, 6, 6], *offset), [6, 6, 6], 2.0)
                    .to_string_lossy()
                    .into_owned(),
                stack_index: None,
                expected_sha256: None,
                display_label: None,
                design_values: Vec::new(),
            })
            .collect();
        let locus = RegionLocus {
            label_source: LabelSource::Path {
                path: label_path.to_string_lossy().into_owned(),
                expected_sha256: None,
            },
            label_ids: vec![3],
        };
        let traces = crate::sample_set_trace_at_locus_impl(
            &members,
            &[],
            0.0,
            "mean",
            "sd",
            &state,
            &SampleCancellation::default(),
            None,
            Some(&locus),
        )
        .await
        .unwrap();
        assert_eq!(traces.len(), 2);
        assert_eq!((traces[0].value, traces[0].count), (2.5, 8));
        assert_eq!((traces[1].value, traces[1].count), (102.5, 8));
        assert!(traces.iter().all(|trace| trace.region_revision.is_some()));
        // Sample SD of four 2s and four 3s: sqrt(2 / 7).
        let sd = (2.0f32 / 7.0).sqrt();
        assert!((traces[0].upper - traces[0].lower - 2.0 * sd).abs() < 1e-5);
        // A frozen query (pinned member digests) must pin the label too.
        let frozen: Vec<crate::SetMemberRef> = members
            .iter()
            .zip(&traces)
            .map(|(member, trace)| crate::SetMemberRef {
                expected_sha256: trace.source_revision.as_ref().map(|r| r.sha256.clone()),
                ..member.clone()
            })
            .collect();
        match crate::sample_set_trace_at_locus_impl(
            &frozen,
            &[],
            0.0,
            "mean",
            "none",
            &state,
            &SampleCancellation::default(),
            None,
            Some(&locus),
        )
        .await
        {
            Err(BridgeError::Input { code, details }) => {
                assert_eq!(code, 2027);
                assert!(details.contains("expectedSha256"), "{details}");
            }
            other => panic!("expected a pin requirement, got {other:?}"),
        }
        let label_sha = traces[0].region_revision.as_ref().unwrap().sha256.clone();
        let pinned_ok = RegionLocus {
            label_source: LabelSource::Path {
                path: label_path.to_string_lossy().into_owned(),
                expected_sha256: Some(label_sha),
            },
            label_ids: vec![3],
        };
        let frozen_traces = crate::sample_set_trace_at_locus_impl(
            &frozen,
            &[],
            0.0,
            "mean",
            "none",
            &state,
            &SampleCancellation::default(),
            None,
            Some(&pinned_ok),
        )
        .await
        .unwrap();
        assert_eq!(frozen_traces[1].value, 102.5);
        // A pinned digest that does not match is rejected.
        let pinned = RegionLocus {
            label_source: LabelSource::Path {
                path: label_path.to_string_lossy().into_owned(),
                expected_sha256: Some("0".repeat(64)),
            },
            label_ids: vec![3],
        };
        assert!(crate::sample_set_trace_at_locus_impl(
            &members,
            &[],
            0.0,
            "mean",
            "none",
            &state,
            &SampleCancellation::default(),
            None,
            Some(&pinned),
        )
        .await
        .is_err());
        std::fs::remove_file(label_path).ok();
        for member in &members {
            std::fs::remove_file(&member.source_path).ok();
        }
    }
}
