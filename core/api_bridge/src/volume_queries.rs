//! Voxel-exact volume queries: nearest-voxel lookup, voxel-centred defaults,
//! extremum search and the suprathreshold bounding box.
//!
//! Voxel convention: the affine maps a voxel *index* to the world position of
//! that voxel's centre, and voxel `i` covers continuous coordinates
//! `[i - 0.5, i + 0.5)`. Nearest-voxel lookup is therefore `floor(v + 0.5)`,
//! which matches nearest texture sampling at `(v + 0.5) / n` in the renderer
//! for interior voxels.
//!
//! Edge mismatch (known, tracked separately): the masked slice shaders treat
//! `[0, n)` as inside (`voxel_coord < 0 || voxel_coord >= dim` is outside), so
//! the GPU drops the lower half of voxel 0 and, through ClampToEdge, extends
//! voxel `n - 1` over `[n - 1.5, n)`. This CPU path keeps the voxel-centre
//! convention `[-0.5, n - 0.5)`; the two disagree only in the outer half-voxel.
use crate::BridgeState;
use bridge_types::{BridgeError, BridgeResult, VolumeSendable};
use nalgebra::{Affine3, Point3};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{command, State};
use ts_rs::TS;
pub(crate) use volume_service::frames::{
    check_timepoint, extract_frame, frame_count, spatial_dims, Frame,
};

/// Index of the voxel containing continuous voxel coordinate `voxel`, or `None`
/// outside `[-0.5, n - 0.5)` on any axis (or for non-finite input).
pub(crate) fn nearest_voxel(voxel: [f32; 3], dims: [usize; 3]) -> Option<[usize; 3]> {
    let mut index = [0usize; 3];
    for axis in 0..3 {
        let v = voxel[axis];
        if !v.is_finite() {
            return None;
        }
        let rounded = (v + 0.5).floor();
        if rounded < 0.0 || rounded >= dims[axis] as f32 {
            return None;
        }
        index[axis] = rounded as usize;
    }
    Some(index)
}

/// Centre voxel index used for default placement: `floor((n - 1) / 2)` per
/// axis, so the default lands on a voxel centre even for even dimensions.
pub(crate) fn centre_voxel_index(dims: [usize; 3]) -> [usize; 3] {
    dims.map(|n| n.saturating_sub(1) / 2)
}

pub(crate) fn voxel_to_world(affine: &Affine3<f32>, ijk: [usize; 3]) -> [f32; 3] {
    let p = affine.transform_point(&Point3::new(ijk[0] as f32, ijk[1] as f32, ijk[2] as f32));
    [p.x, p.y, p.z]
}

/// World position of the centre voxel (see [`centre_voxel_index`]).
pub(crate) fn centre_voxel_world(affine: &Affine3<f32>, dims: [usize; 3]) -> [f32; 3] {
    voxel_to_world(affine, centre_voxel_index(dims))
}

/// Nearest-voxel value at continuous voxel coordinate `voxel`; 0 outside the
/// volume (the `sample_world_coordinate` contract). 4D volumes read
/// `timepoint`, which must be in range ([`check_timepoint`]); 3D volumes
/// ignore it.
pub(crate) fn sample_nearest(
    volume: &VolumeSendable,
    voxel: [f32; 3],
    timepoint: usize,
) -> BridgeResult<f32> {
    let t = match frame_count(volume) {
        Some(frames) => check_timepoint(timepoint, frames)?,
        None => 0,
    };
    let Some([x, y, z]) = nearest_voxel(voxel, spatial_dims(volume)) else {
        return Ok(0.0);
    };
    macro_rules! at_3d {
        ($vol:expr) => {
            $vol.get_at_coords(&[x, y, z])
                .map(|v| v as f32)
                .unwrap_or(0.0)
        };
    }
    macro_rules! at_4d {
        ($vec:expr) => {
            $vec.data[[x, y, z, t]] as f32
        };
    }
    Ok(match volume {
        VolumeSendable::VolF32(v, _) => at_3d!(v),
        VolumeSendable::VolF64(v, _) => at_3d!(v),
        VolumeSendable::VolI16(v, _) => at_3d!(v),
        VolumeSendable::VolI32(v, _) => at_3d!(v),
        VolumeSendable::VolU8(v, _) => at_3d!(v),
        VolumeSendable::VolU16(v, _) => at_3d!(v),
        VolumeSendable::VolU32(v, _) => at_3d!(v),
        VolumeSendable::VolI8(v, _) => at_3d!(v),
        VolumeSendable::Vec4DF32(v) => at_4d!(v),
        VolumeSendable::Vec4DF64(v) => at_4d!(v),
        VolumeSendable::Vec4DI16(v) => at_4d!(v),
        VolumeSendable::Vec4DI32(v) => at_4d!(v),
        VolumeSendable::Vec4DU8(v) => at_4d!(v),
        VolumeSendable::Vec4DU16(v) => at_4d!(v),
        VolumeSendable::Vec4DU32(v) => at_4d!(v),
        VolumeSendable::Vec4DI8(v) => at_4d!(v),
    })
}

/// A volume resolved for a query, with its source path (for header metadata).
pub(crate) struct ResolvedVolume {
    pub id: String,
    pub volume: Arc<VolumeSendable>,
    pub timepoint: usize,
    pub path: String,
}

/// True {0, 1} test for "binary-like" volumes (masks): every finite voxel is
/// 0 or 1 within 1e-6, non-finite voxels are ignored, and at least one voxel
/// is 1. An all-zero image is not reported as a mask (it has no foreground).
/// The scan stops at the first voxel outside {0, 1}, so non-mask maps are
/// rejected early; 4D volumes are tested over every frame.
pub(crate) fn is_binary_volume(volume: &VolumeSendable) -> bool {
    fn scan<I: Iterator<Item = f32>>(values: I) -> bool {
        let mut any_one = false;
        for v in values {
            if !v.is_finite() {
                continue;
            }
            if (v - 1.0).abs() <= 1e-6 {
                any_one = true;
            } else if v.abs() > 1e-6 {
                return false;
            }
        }
        any_one
    }
    macro_rules! scan_3d {
        ($vol:expr) => {
            scan($vol.values_contiguous().iter().map(|v| *v as f32))
        };
    }
    macro_rules! scan_4d {
        ($vec:expr) => {
            scan($vec.data.iter().map(|v| *v as f32))
        };
    }
    match volume {
        VolumeSendable::VolF32(v, _) => scan_3d!(v),
        VolumeSendable::VolF64(v, _) => scan_3d!(v),
        VolumeSendable::VolI16(v, _) => scan_3d!(v),
        VolumeSendable::VolI32(v, _) => scan_3d!(v),
        VolumeSendable::VolU8(v, _) => scan_3d!(v),
        VolumeSendable::VolU16(v, _) => scan_3d!(v),
        VolumeSendable::VolU32(v, _) => scan_3d!(v),
        VolumeSendable::VolI8(v, _) => scan_3d!(v),
        VolumeSendable::Vec4DF32(v) => scan_4d!(v),
        VolumeSendable::Vec4DF64(v) => scan_4d!(v),
        VolumeSendable::Vec4DI16(v) => scan_4d!(v),
        VolumeSendable::Vec4DI32(v) => scan_4d!(v),
        VolumeSendable::Vec4DU8(v) => scan_4d!(v),
        VolumeSendable::Vec4DU16(v) => scan_4d!(v),
        VolumeSendable::Vec4DU32(v) => scan_4d!(v),
        VolumeSendable::Vec4DI8(v) => scan_4d!(v),
    }
}

/// A binary search mask on `frame`'s grid from a mask volume: a frame voxel is
/// inside when the nearest mask voxel (by world position, as region loci map
/// labels) holds a finite non-zero value. The mask must have one frame.
pub(crate) fn resample_mask_nearest(
    mask: &VolumeSendable,
    frame: &Frame,
) -> BridgeResult<Vec<bool>> {
    let invalid = |details: &str| BridgeError::Input {
        code: 4081,
        details: details.into(),
    };
    if crate::stack_length_for_volume(mask) != 1 {
        return Err(invalid("A search mask must have one spatial frame."));
    }
    let mask_frame = extract_frame(mask, 0)?;
    let inside = |v: f32| v.is_finite() && v != 0.0;
    if mask_frame.dims == frame.dims && mask_frame.affine == frame.affine {
        return Ok(mask_frame.values.iter().map(|v| inside(*v)).collect());
    }
    let world_to_mask = mask_frame
        .affine
        .try_inverse()
        .ok_or_else(|| invalid("The search mask affine is not invertible."))?;
    Ok((0..frame.values.len())
        .map(|index| {
            let [i, j, k] = frame.ijk(index);
            let world = frame
                .affine
                .transform_point(&Point3::new(i as f32, j as f32, k as f32));
            let p = world_to_mask.transform_point(&world);
            nearest_voxel([p.x, p.y, p.z], mask_frame.dims)
                .is_some_and(|[x, y, z]| inside(mask_frame.values[mask_frame.index(x, y, z)]))
        })
        .collect())
}

/// Resolve a volume (by id, or through a layer's mapping) and the frame to
/// read: the explicit `timepoint`, else the volume's current timepoint, else 0.
pub(crate) async fn resolve_volume(
    state: &BridgeState,
    volume_id: Option<&str>,
    layer_id: Option<&str>,
    timepoint: Option<usize>,
) -> BridgeResult<ResolvedVolume> {
    let volume_id = match (volume_id, layer_id) {
        (Some(id), _) => id.to_string(),
        (None, Some(layer)) => state
            .layer_to_volume_map
            .lock()
            .await
            .get(layer)
            .cloned()
            .ok_or_else(|| BridgeError::VolumeNotFound {
                code: 4072,
                details: format!("Layer {layer} is not mapped to a volume"),
            })?,
        (None, None) => {
            return Err(BridgeError::Input {
                code: 4073,
                details: "Provide volumeId or layerId".into(),
            })
        }
    };
    let registry = state.volume_registry.lock().await;
    let entry = registry
        .get_entry(&volume_id)
        .ok_or_else(|| BridgeError::VolumeNotFound {
            code: 4041,
            details: volume_id.clone(),
        })?;
    let volume = Arc::clone(&entry.data);
    let path = entry.metadata.path.clone();
    let timepoint = timepoint.or(entry.current_timepoint).unwrap_or(0);
    drop(registry);
    Ok(ResolvedVolume {
        id: volume_id,
        volume,
        timepoint,
        path,
    })
}

/// Run a CPU scan over a resolved frame on a blocking worker.
pub(crate) async fn with_frame<T, F>(
    volume: Arc<VolumeSendable>,
    timepoint: usize,
    work: F,
) -> BridgeResult<T>
where
    T: Send + 'static,
    F: for<'a> FnOnce(Frame<'a>) -> BridgeResult<T> + Send + 'static,
{
    tokio::task::spawn_blocking(move || work(extract_frame(&volume, timepoint)?))
        .await
        .map_err(|error| BridgeError::Internal {
            code: 5072,
            details: format!("Volume query task failed: {error}"),
        })?
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum ExtremumKind {
    Max,
    Min,
    /// Largest |value|; the returned `value` keeps its sign.
    AbsMax,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct VolumeExtremumRequest {
    #[serde(default)]
    #[ts(optional = nullable)]
    pub volume_id: Option<String>,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub layer_id: Option<String>,
    pub kind: ExtremumKind,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub timepoint: Option<usize>,
}

/// A voxel located by a volume query: value, voxel index and world centre.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct VoxelLocation {
    pub value: f32,
    pub ijk: [u32; 3],
    /// World position of the voxel centre.
    pub world_mm: [f32; 3],
    /// Frame read (4D volumes only).
    pub timepoint: Option<usize>,
}

/// First voxel (x-fastest order) holding the extremum of the finite values.
pub(crate) fn find_extremum(frame: &Frame, kind: ExtremumKind) -> Option<VoxelLocation> {
    let score = |v: f32| match kind {
        ExtremumKind::Max => v,
        ExtremumKind::Min => -v,
        ExtremumKind::AbsMax => v.abs(),
    };
    let mut best: Option<(usize, f32)> = None;
    for (index, &value) in frame.values.iter().enumerate() {
        if value.is_finite() && best.is_none_or(|(_, b)| score(value) > score(b)) {
            best = Some((index, value));
        }
    }
    best.map(|(index, value)| {
        let ijk = frame.ijk(index);
        VoxelLocation {
            value,
            ijk: ijk.map(|v| v as u32),
            world_mm: frame.world(ijk),
            timepoint: frame.timepoint,
        }
    })
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct VolumeNonzeroBboxRequest {
    #[serde(default)]
    #[ts(optional = nullable)]
    pub volume_id: Option<String>,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub layer_id: Option<String>,
    /// Voxels with |value| > threshold count as non-zero (default 0).
    #[serde(default)]
    #[ts(optional = nullable)]
    pub threshold: Option<f32>,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub timepoint: Option<usize>,
}

/// Bounding box of the voxels with |value| > threshold.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct VolumeNonzeroBbox {
    /// Inclusive voxel index bounds.
    pub ijk_min: [u32; 3],
    pub ijk_max: [u32; 3],
    /// World bounds of the voxel *centres* at the box corners (axis-aligned
    /// envelope of the 8 transformed corners). Add half a voxel per side for
    /// the voxel-edge extent.
    pub world_min_mm: [f32; 3],
    pub world_max_mm: [f32; 3],
    #[ts(type = "number")]
    pub voxel_count: u64,
    pub timepoint: Option<usize>,
}

pub(crate) fn nonzero_bbox(frame: &Frame, threshold: f32) -> Option<VolumeNonzeroBbox> {
    let mut lo = [usize::MAX; 3];
    let mut hi = [0usize; 3];
    let mut count = 0u64;
    for k in 0..frame.dims[2] {
        for j in 0..frame.dims[1] {
            for i in 0..frame.dims[0] {
                let value = frame.values[frame.index(i, j, k)];
                if value.is_finite() && value.abs() > threshold {
                    count += 1;
                    for (axis, c) in [i, j, k].into_iter().enumerate() {
                        lo[axis] = lo[axis].min(c);
                        hi[axis] = hi[axis].max(c);
                    }
                }
            }
        }
    }
    if count == 0 {
        return None;
    }
    let (world_min_mm, world_max_mm) = world_envelope(frame, lo, hi);
    Some(VolumeNonzeroBbox {
        ijk_min: lo.map(|v| v as u32),
        ijk_max: hi.map(|v| v as u32),
        world_min_mm,
        world_max_mm,
        voxel_count: count,
        timepoint: frame.timepoint,
    })
}

/// Axis-aligned world envelope of the voxel-centre box `lo..=hi`.
pub(crate) fn world_envelope(
    frame: &Frame,
    lo: [usize; 3],
    hi: [usize; 3],
) -> ([f32; 3], [f32; 3]) {
    let mut min = [f32::INFINITY; 3];
    let mut max = [f32::NEG_INFINITY; 3];
    for corner in 0..8 {
        let ijk = [
            if corner & 1 == 0 { lo[0] } else { hi[0] },
            if corner & 2 == 0 { lo[1] } else { hi[1] },
            if corner & 4 == 0 { lo[2] } else { hi[2] },
        ];
        let world = frame.world(ijk);
        for axis in 0..3 {
            min[axis] = min[axis].min(world[axis]);
            max[axis] = max[axis].max(world[axis]);
        }
    }
    (min, max)
}

fn validate_threshold(threshold: f32) -> BridgeResult<f32> {
    if threshold.is_finite() && threshold >= 0.0 {
        Ok(threshold)
    } else {
        Err(BridgeError::Input {
            code: 4074,
            details: "threshold must be a finite value >= 0".into(),
        })
    }
}

/// Location of the max, min or largest-|value| voxel of a volume frame.
/// Returns `null` when the frame holds no finite value.
#[command]
#[tracing::instrument(skip_all, err, name = "api.volume_extremum")]
pub(crate) async fn volume_extremum(
    request: VolumeExtremumRequest,
    state: State<'_, BridgeState>,
) -> BridgeResult<Option<VoxelLocation>> {
    volume_extremum_impl(request, state.inner()).await
}

pub(crate) async fn volume_extremum_impl(
    request: VolumeExtremumRequest,
    state: &BridgeState,
) -> BridgeResult<Option<VoxelLocation>> {
    let ResolvedVolume {
        volume, timepoint, ..
    } = resolve_volume(
        state,
        request.volume_id.as_deref(),
        request.layer_id.as_deref(),
        request.timepoint,
    )
    .await?;
    let kind = request.kind;
    with_frame(volume, timepoint, move |frame| {
        Ok(find_extremum(&frame, kind))
    })
    .await
}

/// Bounding box of the voxels with |value| > threshold (mosaic crop). Returns
/// `null` when no voxel passes.
#[command]
#[tracing::instrument(skip_all, err, name = "api.volume_nonzero_bbox")]
pub(crate) async fn volume_nonzero_bbox(
    request: VolumeNonzeroBboxRequest,
    state: State<'_, BridgeState>,
) -> BridgeResult<Option<VolumeNonzeroBbox>> {
    volume_nonzero_bbox_impl(request, state.inner()).await
}

pub(crate) async fn volume_nonzero_bbox_impl(
    request: VolumeNonzeroBboxRequest,
    state: &BridgeState,
) -> BridgeResult<Option<VolumeNonzeroBbox>> {
    let threshold = validate_threshold(request.threshold.unwrap_or(0.0))?;
    let ResolvedVolume {
        volume, timepoint, ..
    } = resolve_volume(
        state,
        request.volume_id.as_deref(),
        request.layer_id.as_deref(),
        request.timepoint,
    )
    .await?;
    with_frame(volume, timepoint, move |frame| {
        Ok(nonzero_bbox(&frame, threshold))
    })
    .await
}

#[cfg(test)]
pub(crate) mod test_support {
    use super::*;
    use std::borrow::Cow;

    /// Owned frame with an axis-aligned affine (spacing, origin).
    pub(crate) fn frame_3d(
        dims: [usize; 3],
        spacing: [f32; 3],
        origin: [f32; 3],
        values: Vec<f32>,
    ) -> Frame<'static> {
        assert_eq!(values.len(), dims.iter().product::<usize>());
        Frame {
            values: Cow::Owned(values),
            dims,
            affine: Affine3::from_matrix_unchecked(nalgebra::Matrix4::new(
                spacing[0], 0.0, 0.0, origin[0], 0.0, spacing[1], 0.0, origin[1], 0.0, 0.0,
                spacing[2], origin[2], 0.0, 0.0, 0.0, 1.0,
            )),
            timepoint: None,
        }
    }
    use volmath::{DenseVolume3, NeuroSpace, NeuroSpace3, NeuroSpaceExt};

    /// 3D f32 volume with spacing/origin and x-fastest `values`.
    pub(crate) fn volume_3d(
        dims: [usize; 3],
        spacing: [f32; 3],
        origin: [f32; 3],
        values: Vec<f32>,
    ) -> VolumeSendable {
        let space = <NeuroSpace as NeuroSpaceExt>::from_dims_spacing_origin(
            dims.to_vec(),
            spacing.to_vec(),
            origin.to_vec(),
        )
        .expect("space");
        let space = NeuroSpace3::new(space);
        let affine = Affine3::from_matrix_unchecked(nalgebra::Matrix4::new(
            spacing[0], 0.0, 0.0, origin[0], 0.0, spacing[1], 0.0, origin[1], 0.0, 0.0, spacing[2],
            origin[2], 0.0, 0.0, 0.0, 1.0,
        ));
        VolumeSendable::VolF32(DenseVolume3::<f32>::from_data(space.0, values), affine)
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::volume_3d;
    use super::*;
    use std::borrow::Cow;
    use volmath::{DenseNeuroVec, NeuroSpace};

    fn ramp(dims: [usize; 3]) -> Vec<f32> {
        (0..dims.iter().product::<usize>())
            .map(|v| v as f32)
            .collect()
    }

    #[test]
    fn nearest_voxel_accepts_half_voxel_border() {
        let dims = [4, 4, 4];
        assert_eq!(nearest_voxel([-0.5, 0.0, 0.0], dims), Some([0, 0, 0]));
        assert_eq!(nearest_voxel([-0.49, -0.2, 0.49], dims), Some([0, 0, 0]));
        assert_eq!(nearest_voxel([0.5, 1.5, 2.49], dims), Some([1, 2, 2]));
        assert_eq!(nearest_voxel([3.49, 0.0, 0.0], dims), Some([3, 0, 0]));
        assert_eq!(nearest_voxel([-0.51, 0.0, 0.0], dims), None);
        assert_eq!(nearest_voxel([3.5, 0.0, 0.0], dims), None);
        assert_eq!(nearest_voxel([f32::NAN, 0.0, 0.0], dims), None);
    }

    #[test]
    fn sample_nearest_reads_voxel_zero_over_its_whole_extent() {
        let dims = [4, 3, 2];
        let volume = volume_3d(
            dims,
            [1.0; 3],
            [0.0; 3],
            ramp(dims).iter().map(|v| v + 1.0).collect(),
        );
        // Voxel (0,0,0) holds 1.0 over [-0.5, 0.5).
        assert_eq!(sample_nearest(&volume, [-0.4, -0.4, -0.4], 0).unwrap(), 1.0);
        // x-fastest: (1,2,1) -> 1 + 4*(2 + 3*1) = 21 -> value 22.
        assert_eq!(sample_nearest(&volume, [1.2, 1.6, 0.9], 0).unwrap(), 22.0);
        // Last voxel up to n - 0.5 and nothing beyond.
        assert_eq!(sample_nearest(&volume, [3.4, 2.4, 1.4], 0).unwrap(), 24.0);
        assert_eq!(sample_nearest(&volume, [3.5, 0.0, 0.0], 0).unwrap(), 0.0);
    }

    #[test]
    fn sample_nearest_4d_does_not_panic_at_upper_half_voxel() {
        let dims = vec![2usize, 2, 2, 3];
        let space =
            NeuroSpace::new(dims, Some(vec![1.0; 4]), Some(vec![0.0; 4]), None, None).unwrap();
        let mut vec4d = DenseNeuroVec::<f32>::zeros(space).unwrap();
        vec4d.data[[1, 1, 1, 2]] = 7.0;
        let volume = VolumeSendable::Vec4DF32(vec4d);
        assert_eq!(sample_nearest(&volume, [1.3, 1.3, 1.3], 2).unwrap(), 7.0);
        // Used to round to index 2 and panic on the 4D array index.
        assert_eq!(sample_nearest(&volume, [1.7, 1.0, 1.0], 2).unwrap(), 0.0);
    }

    #[test]
    fn out_of_range_timepoint_is_the_same_error_for_sampling_and_frames() {
        let space = NeuroSpace::new(
            vec![2, 2, 2, 3],
            Some(vec![1.0; 4]),
            Some(vec![0.0; 4]),
            None,
            None,
        )
        .unwrap();
        let volume = VolumeSendable::Vec4DF32(DenseNeuroVec::<f32>::zeros(space).unwrap());
        let code = |result: BridgeResult<()>| match result {
            Err(BridgeError::Input { code, details }) => {
                assert!(details.contains("3 frame(s)"), "{details}");
                code
            }
            other => panic!("expected an input error, got {other:?}"),
        };
        // Even outside the volume, a bad frame index is reported, not masked.
        let sample = code(sample_nearest(&volume, [9.0, 9.0, 9.0], 3).map(|_| ()));
        let frame = code(extract_frame(&volume, 3).map(|_| ()));
        assert_eq!((sample, frame), (4071, 4071));
        assert!(sample_nearest(&volume, [0.0; 3], 2).is_ok());
        // 3D volumes ignore the timepoint.
        let flat = volume_3d([2, 2, 2], [1.0; 3], [0.0; 3], vec![1.0; 8]);
        assert_eq!(sample_nearest(&flat, [0.0; 3], 7).unwrap(), 1.0);
        assert!(extract_frame(&flat, 7).is_ok());
    }

    #[test]
    fn centre_voxel_lands_on_a_voxel_centre_for_even_dims() {
        assert_eq!(centre_voxel_index([4, 5, 1]), [1, 2, 0]);
        let affine = Affine3::from_matrix_unchecked(nalgebra::Matrix4::new(
            2.0, 0.0, 0.0, -10.0, 0.0, 2.0, 0.0, 20.0, 0.0, 0.0, 3.0, 0.0, 0.0, 0.0, 0.0, 1.0,
        ));
        // Geometric centre of a 4-voxel axis is index 1.5 (a voxel edge); the
        // voxel-centred default is index 1.
        assert_eq!(centre_voxel_world(&affine, [4, 4, 4]), [-8.0, 22.0, 3.0]);
    }

    #[test]
    fn frame_extraction_is_x_fastest_for_3d_and_4d() {
        let dims = [3, 2, 2];
        let volume = volume_3d(dims, [1.0; 3], [0.0; 3], ramp(dims));
        let frame = extract_frame(&volume, 0).unwrap();
        assert_eq!(frame.values.as_ref(), ramp(dims).as_slice());
        // f32 volumes are borrowed, not copied.
        assert!(matches!(frame.values, Cow::Borrowed(_)));
        assert_eq!(frame.ijk(7), [1, 0, 1]);
        assert_eq!(frame.index(1, 0, 1), 7);

        let space = NeuroSpace::new(
            vec![3, 2, 2, 2],
            Some(vec![1.0; 4]),
            Some(vec![0.0; 4]),
            None,
            None,
        )
        .unwrap();
        let mut vec4d = DenseNeuroVec::<f32>::zeros(space).unwrap();
        vec4d.data[[2, 1, 0, 1]] = 5.0;
        let volume_4d = VolumeSendable::Vec4DF32(vec4d.clone());
        let frame = extract_frame(&volume_4d, 1).unwrap();
        assert_eq!(frame.values[frame.index(2, 1, 0)], 5.0);
        assert_eq!(frame.timepoint, Some(1));
        assert!(extract_frame(&VolumeSendable::Vec4DF32(vec4d), 2).is_err());
    }

    #[test]
    fn extremum_and_bbox_report_voxel_and_world_positions() {
        let dims = [5, 5, 5];
        let mut values = vec![0.0f32; 125];
        let frame_of = |values: Vec<f32>| test_support::frame_3d(dims, [2.0; 3], [-4.0; 3], values);
        let index = |i: usize, j: usize, k: usize| i + 5 * (j + 5 * k);
        values[index(1, 2, 3)] = 4.0;
        values[index(3, 1, 1)] = -6.0;
        values[index(2, 2, 2)] = f32::NAN;
        let frame = frame_of(values);

        let max = find_extremum(&frame, ExtremumKind::Max).unwrap();
        assert_eq!((max.value, max.ijk), (4.0, [1, 2, 3]));
        assert_eq!(max.world_mm, [-2.0, 0.0, 2.0]);
        let min = find_extremum(&frame, ExtremumKind::Min).unwrap();
        assert_eq!((min.value, min.ijk), (-6.0, [3, 1, 1]));
        let abs = find_extremum(&frame, ExtremumKind::AbsMax).unwrap();
        assert_eq!(abs.value, -6.0);

        let bbox = nonzero_bbox(&frame, 0.0).unwrap();
        assert_eq!((bbox.ijk_min, bbox.ijk_max), ([1, 1, 1], [3, 2, 3]));
        assert_eq!(bbox.world_min_mm, [-2.0, -2.0, -2.0]);
        assert_eq!(bbox.world_max_mm, [2.0, 0.0, 2.0]);
        assert_eq!(bbox.voxel_count, 2);
        assert_eq!(nonzero_bbox(&frame, 5.0).unwrap().voxel_count, 1);
        assert!(nonzero_bbox(&frame, 10.0).is_none());
        assert!(find_extremum(&frame_of(vec![f32::NAN; 125]), ExtremumKind::Max).is_none());
        assert_eq!(frame.voxel_volume_mm3(), 8.0);
    }

    #[tokio::test]
    async fn commands_resolve_volume_by_id_or_layer() {
        let state = BridgeState::default().unwrap();
        let dims = [3, 3, 3];
        let mut values = vec![0.0f32; 27];
        values[13] = 9.0;
        state.volume_registry.lock().await.insert(
            "vol".into(),
            volume_3d(dims, [1.0; 3], [0.0; 3], values),
            crate::VolumeMetadataInfo {
                name: "vol".into(),
                path: "<memory>".into(),
                dtype: "f32".into(),
                volume_type: bridge_types::VolumeType::Volume3D,
                time_series_info: None,
            },
        );
        state
            .layer_to_volume_map
            .lock()
            .await
            .insert("layer".into(), "vol".into());
        let by_layer = volume_extremum_impl(
            VolumeExtremumRequest {
                volume_id: None,
                layer_id: Some("layer".into()),
                kind: ExtremumKind::Max,
                timepoint: None,
            },
            &state,
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!((by_layer.value, by_layer.ijk), (9.0, [1, 1, 1]));
        let bbox = volume_nonzero_bbox_impl(
            VolumeNonzeroBboxRequest {
                volume_id: Some("vol".into()),
                layer_id: None,
                threshold: None,
                timepoint: None,
            },
            &state,
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(bbox.ijk_min, [1, 1, 1]);
        assert!(volume_nonzero_bbox_impl(
            VolumeNonzeroBboxRequest {
                volume_id: Some("vol".into()),
                layer_id: None,
                threshold: Some(-1.0),
                timepoint: None,
            },
            &state,
        )
        .await
        .is_err());
        assert!(volume_extremum_impl(
            VolumeExtremumRequest {
                volume_id: Some("missing".into()),
                layer_id: None,
                kind: ExtremumKind::Min,
                timepoint: None,
            },
            &state,
        )
        .await
        .is_err());
    }

    #[test]
    fn binary_test_requires_values_in_zero_one_with_foreground() {
        let mask = volume_3d([2, 2, 1], [1.0; 3], [0.0; 3], vec![0.0, 1.0, 1.0, f32::NAN]);
        assert!(is_binary_volume(&mask), "{{0, 1}} mask (NaN ignored)");
        let probability = volume_3d([2, 2, 1], [1.0; 3], [0.0; 3], vec![0.0, 0.25, 0.9, 1.0]);
        assert!(!is_binary_volume(&probability), "0-1 probability map");
        let zeros = volume_3d([2, 2, 1], [1.0; 3], [0.0; 3], vec![0.0; 4]);
        assert!(!is_binary_volume(&zeros), "all-zero has no foreground");
        let near = volume_3d([2, 1, 1], [1.0; 3], [0.0; 3], vec![1.0 + 5e-7, 0.0]);
        assert!(is_binary_volume(&near), "within 1e-6");
        let space = NeuroSpace::new(vec![2, 1, 1, 2], None, None, None, None).unwrap();
        let mut vec4d = DenseNeuroVec::<f32>::zeros(space).unwrap();
        vec4d.data[[0, 0, 0, 0]] = 1.0;
        vec4d.data[[1, 0, 0, 1]] = 0.5;
        assert!(
            !is_binary_volume(&VolumeSendable::Vec4DF32(vec4d)),
            "any frame counts"
        );
    }
}
