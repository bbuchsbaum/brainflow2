//! Display-only companions of a population slice: the anatomy drawn under the
//! maps and the slice that opens the view. Neither is a calculation operand,
//! an export input or part of the retained plane matrix.
use super::{input, Orientation, Plane, PopulationSliceRequest, SummaryKind};
use crate::{population_sampling::SampleCancellation, BridgeState};
use bridge_types::{BridgeResult, VolumeSendable};
use nalgebra::{Matrix4, Point3, Vector3};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

/// Anatomy shown beneath the population maps. Its own grid is sampled in
/// world space, so it need not share the population sources' grid.
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnderlayRequest {
    pub source_path: String,
}
/// Underlay intensities on the returned plane and, when requested, the
/// cutout plane. NaN marks pixels outside the anatomy image.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnderlayResult {
    pub values: Vec<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cutouts: Option<Vec<f32>>,
}

/// The peak search keeps one accumulator set per source voxel; beyond this
/// the view simply opens where it is.
const MAX_PEAK_VOXELS: usize = 8 * 1024 * 1024;
/// How far (mm) the population grid may reach past the anatomy's own field
/// of view: template-space grids share the template's box to within a voxel
/// or two, while scanner-space grids are offset and sized independently.
const UNDERLAY_FIELD_TOLERANCE_MM: f32 = 10.0;
/// A template that could not be fetched (offline, say) is not retried by
/// every slice evaluation.
const TEMPLATE_RETRY: Duration = Duration::from_secs(60);

/// Dimensions and voxel-to-world matrix of any invertible 3D grid. Unlike the
/// population sources, display images may be sheared: they are only sampled.
fn display_grid(volume: &VolumeSendable) -> BridgeResult<(Vec<usize>, Matrix4<f32>)> {
    let dimensions = crate::get_spatial_dims_from_volume(volume);
    let affine = *crate::get_affine_from_volume(volume)?.matrix();
    if dimensions.len() != 3
        || dimensions.contains(&0)
        || !affine.iter().all(|v| v.is_finite())
        || affine.try_inverse().is_none()
    {
        return Err(input(
            "Display images require an invertible three-dimensional grid.",
        ));
    }
    Ok((dimensions, affine))
}

enum Resolved {
    Path(PathBuf),
    Failed(String, Instant),
}
fn template_paths() -> &'static Mutex<HashMap<String, Resolved>> {
    static PATHS: OnceLock<Mutex<HashMap<String, Resolved>>> = OnceLock::new();
    PATHS.get_or_init(Default::default)
}

/// The anatomy file. A template resolves to its cached file, downloaded only
/// when missing and never decoded here (the sample cache reads it); the
/// answer is remembered per template id, failures for `TEMPLATE_RETRY`.
pub(super) async fn underlay_path(
    source: &UnderlayRequest,
    state: &BridgeState,
) -> Result<PathBuf, String> {
    let Some(id) = source.source_path.strip_prefix("template:") else {
        return Ok(PathBuf::from(&source.source_path));
    };
    if let Some(known) = template_paths()
        .lock()
        .ok()
        .and_then(|paths| match paths.get(id) {
            Some(Resolved::Path(path)) if path.exists() => Some(Ok(path.clone())),
            Some(Resolved::Failed(error, at)) if at.elapsed() < TEMPLATE_RETRY => {
                Some(Err(error.clone()))
            }
            _ => None,
        })
    {
        return known;
    }
    let resolved = async {
        let config = crate::parse_template_id(id).map_err(|e| e.to_string())?;
        let service = state.template_service.lock().await;
        service
            .ensure_cached(&config)
            .await
            .map_err(|e| format!("Template {id} is unavailable: {e}"))
    }
    .await;
    if let Ok(mut paths) = template_paths().lock() {
        paths.insert(
            id.to_string(),
            match &resolved {
                Ok(path) => Resolved::Path(path.clone()),
                Err(error) => Resolved::Failed(error.clone(), Instant::now()),
            },
        );
    }
    resolved
}

/// Trilinear world-space samples of the first frame on `plane`.
pub(super) fn sample_plane(
    volume: &VolumeSendable,
    plane: &Plane,
    cancellation: &SampleCancellation,
) -> BridgeResult<Vec<f32>> {
    let (dimensions, affine) = display_grid(volume)?;
    let inverse = affine
        .try_inverse()
        .ok_or_else(|| input("Invalid underlay affine."))?;
    let read = |x: usize, y: usize, z: usize| {
        crate::read_member_frame_at_voxel(volume, x, y, z, 0).filter(|v| v.is_finite())
    };
    let [width, height] = plane.dim_px;
    let mut values = Vec::with_capacity(width as usize * height as usize);
    for y in 0..height {
        cancellation.check()?;
        for x in 0..width {
            let world = neuro_types::pixel_to_world_raw(
                plane.origin_mm,
                plane.u_mm,
                plane.v_mm,
                x as f32,
                y as f32,
            );
            let p = inverse.transform_point(&Point3::from(world));
            let p = [p.x, p.y, p.z];
            if (0..3).any(|i| !p[i].is_finite() || p[i] < -0.5 || p[i] > dimensions[i] as f32 - 0.5)
            {
                values.push(f32::NAN);
                continue;
            }
            let base = p.map(|v| v.clamp(0.0, f32::MAX).floor());
            let (mut total, mut weight) = (0.0f32, 0.0f32);
            for corner in 0..8 {
                let mut index = [0usize; 3];
                let mut w = 1.0;
                for axis in 0..3 {
                    let high = corner >> axis & 1 == 1;
                    let at = (base[axis] as usize + high as usize).min(dimensions[axis] - 1);
                    let t = (p[axis] - base[axis]).clamp(0.0, 1.0);
                    index[axis] = at;
                    w *= if high { t } else { 1.0 - t };
                }
                if w > 0.0 {
                    if let Some(v) = read(index[0], index[1], index[2]) {
                        total += w * v;
                        weight += w;
                    }
                }
            }
            values.push(if weight > 0.0 {
                total / weight
            } else {
                f32::NAN
            });
        }
    }
    Ok(values)
}

/// Whether the population grid lies within the anatomy's world box, the
/// minimum for both to be in one space. A subject-native grid labelled with a
/// template space fails here instead of being drawn over the wrong anatomy.
fn covers(anatomy: (&[usize], &Matrix4<f32>), population: (&[usize], &Matrix4<f32>)) -> bool {
    fn corners(dims: &[usize], affine: &Matrix4<f32>) -> Vec<Point3<f32>> {
        (0..8usize)
            .map(|corner| {
                affine.transform_point(&Point3::from(std::array::from_fn::<f32, 3, _>(|axis| {
                    if corner >> axis & 1 == 1 {
                        dims[axis].saturating_sub(1) as f32
                    } else {
                        0.0
                    }
                })))
            })
            .collect()
    }
    let mut low = [f32::INFINITY; 3];
    let mut high = [f32::NEG_INFINITY; 3];
    for p in corners(anatomy.0, anatomy.1) {
        for axis in 0..3 {
            low[axis] = low[axis].min(p[axis]);
            high[axis] = high[axis].max(p[axis]);
        }
    }
    corners(population.0, population.1).iter().all(|p| {
        (0..3).all(|axis| {
            p[axis] >= low[axis] - UNDERLAY_FIELD_TOLERANCE_MM
                && p[axis] <= high[axis] + UNDERLAY_FIELD_TOLERANCE_MM
        })
    })
}

/// The anatomy for this plane, or why it is unavailable. `path` was resolved
/// before slice admission. Cancellation is the only failure that aborts the
/// population result.
pub(super) async fn underlay(
    path: Result<PathBuf, String>,
    plane: &Plane,
    cutout_plane: Option<&Plane>,
    population_grid: (Vec<usize>, Matrix4<f32>),
    state: &BridgeState,
    cancellation: &SampleCancellation,
) -> BridgeResult<Result<UnderlayResult, String>> {
    let path = match path {
        Ok(path) => path,
        Err(error) => return Ok(Err(error)),
    };
    let plane = plane.clone();
    let cutout_plane = cutout_plane.cloned();
    let token = cancellation.clone();
    let sampled = state
        .set_sample_cache
        .with_volume_cancelable(path, cancellation.clone(), move |volume, _| {
            let (dimensions, affine) = display_grid(volume)?;
            if !covers(
                (&dimensions, &affine),
                (&population_grid.0, &population_grid.1),
            ) {
                return Err(input(
                    "The anatomy image does not cover the population grid; they are not in one space.",
                ));
            }
            Ok(UnderlayResult {
                values: sample_plane(volume, &plane, &token)?,
                cutouts: match &cutout_plane {
                    Some(plane) => Some(sample_plane(volume, plane, &token)?),
                    None => None,
                },
            })
        })
        .await;
    cancellation.check()?;
    Ok(sampled.map_err(|error| error.to_string()))
}

/// Per-voxel sums over the working observations, only those the summary needs.
#[derive(Default)]
struct Sums {
    count: Vec<u32>,
    sum: Vec<f64>,
    magnitude: Vec<f32>,
    square: Vec<f64>,
}

/// The crosshair moved along the view normal onto the source slice with the
/// largest summed |summary|. Mean, mean absolute magnitude, cancellation,
/// sample SD and coverage are exact; median and MAD use the mean and the SD,
/// whose voxelwise order they share closely and which need no retained
/// observations. Groups, comparisons and tests use the working mean. Null
/// when the population holds no signal, or when the search fails: it only
/// chooses where the view opens. Cancellation is still an error.
pub(super) async fn peak_slice(
    request: &PopulationSliceRequest,
    state: &BridgeState,
    cancellation: &SampleCancellation,
) -> BridgeResult<Option<[f32; 3]>> {
    match search_peak(request, state, cancellation).await {
        Ok(peak) => Ok(peak),
        Err(error) => {
            cancellation.check()?;
            tracing::warn!("Population peak search failed: {error}");
            Ok(None)
        }
    }
}

async fn search_peak(
    request: &PopulationSliceRequest,
    state: &BridgeState,
    cancellation: &SampleCancellation,
) -> BridgeResult<Option<[f32; 3]>> {
    let working: std::collections::HashSet<_> = request.working_member_ids.iter().collect();
    let members: Vec<_> = request
        .members
        .iter()
        .filter(|m| working.contains(&m.member_id))
        .cloned()
        .collect();
    if members.is_empty() {
        return Ok(None);
    }
    // Held only for this scan; the global mask admission is released on return.
    let mask = match &request.mask {
        Some(source) => {
            let path = crate::resolve_member_source_path(&source.source_path, state).await?;
            Some(crate::population_mask::prepare_mask(source, path, state, cancellation).await?)
        }
        None => None,
    };
    let kind =
        if request.inference.is_some() || request.reference.is_some() || !request.groups.is_empty()
        {
            SummaryKind::Mean
        } else {
            request.summary.clone()
        };
    let (want_sum, want_magnitude, want_square) = match kind {
        SummaryKind::Mean | SummaryKind::Median => (true, false, false),
        SummaryKind::MeanAbsolute => (false, true, false),
        SummaryKind::Cancellation => (true, true, false),
        SummaryKind::SampleSd | SummaryKind::Mad => (true, false, true),
        SummaryKind::Coverage => (false, false, false),
    };
    let mut sums = Sums::default();
    let mut shape: Option<(Vec<usize>, Matrix4<f32>)> = None;
    for member in members {
        cancellation.check()?;
        let path = crate::resolve_member_source_path(&member.source_path, state).await?;
        let token = cancellation.clone();
        let mask = mask.clone();
        let expected = shape.clone();
        let mut taken = std::mem::take(&mut sums);
        let (returned, grid_shape) = state
            .set_sample_cache
            .with_volume_cancelable(path, cancellation.clone(), move |volume, _| {
                if let Some(mask) = &mask {
                    mask.validate_grid(volume)?;
                }
                let (dimensions, affine) = display_grid(volume)?;
                if let Some((d, a)) = &expected {
                    if *d != dimensions
                        || a.iter()
                            .zip(affine.iter())
                            .any(|(a, b)| (a - b).abs() > 1e-5)
                    {
                        return Err(input(
                            "Population sources have different voxel grids or world affines.",
                        ));
                    }
                }
                let voxels: usize = dimensions.iter().product();
                if voxels > MAX_PEAK_VOXELS {
                    return Ok((None, (dimensions, affine)));
                }
                if taken.count.is_empty() {
                    taken.count = vec![0; voxels];
                    if want_sum {
                        taken.sum = vec![0.0; voxels];
                    }
                    if want_magnitude {
                        taken.magnitude = vec![0.0; voxels];
                    }
                    if want_square {
                        taken.square = vec![0.0; voxels];
                    }
                }
                let frame = member.stack_index.unwrap_or(0);
                let [nx, ny] = [dimensions[0], dimensions[1]];
                for index in 0..voxels {
                    if index % 65_536 == 0 {
                        token.check()?;
                    }
                    let (x, y, z) = (index % nx, index / nx % ny, index / (nx * ny));
                    if mask.as_ref().is_some_and(|mask| !mask.includes(x, y, z)) {
                        continue;
                    }
                    let Some(v) = crate::read_member_frame_at_voxel(volume, x, y, z, frame)
                        .filter(|v| v.is_finite())
                    else {
                        continue;
                    };
                    taken.count[index] += 1;
                    if want_sum {
                        taken.sum[index] += v as f64;
                    }
                    if want_magnitude {
                        taken.magnitude[index] += v.abs();
                    }
                    if want_square {
                        taken.square[index] += (v as f64) * (v as f64);
                    }
                }
                Ok((Some(taken), (dimensions, affine)))
            })
            .await?;
        let Some(returned) = returned else {
            return Ok(None);
        };
        sums = returned;
        shape = Some(grid_shape);
    }
    drop(mask);
    let Some((dimensions, affine)) = shape else {
        return Ok(None);
    };
    // Population views are world-aligned planes (see `pixel_plan`).
    let normal = match request.orientation {
        Orientation::Axial => Vector3::new(0.0, 0.0, 1.0),
        Orientation::Coronal => Vector3::new(0.0, 1.0, 0.0),
        Orientation::Sagittal => Vector3::new(1.0, 0.0, 0.0),
    };
    // The source axis the view normal crosses most directly.
    let inverse = affine
        .try_inverse()
        .ok_or_else(|| input("Invalid population affine."))?;
    let direction = inverse.transform_vector(&normal);
    let axis = (0..3)
        .max_by(|&a, &b| direction[a].abs().total_cmp(&direction[b].abs()))
        .unwrap_or(2);
    let mut profile = vec![0.0f64; dimensions[axis]];
    let (nx, ny) = (dimensions[0], dimensions[1]);
    for (index, &n) in sums.count.iter().enumerate() {
        if index % 65_536 == 0 {
            cancellation.check()?;
        }
        if n == 0 {
            continue;
        }
        let count = n as f64;
        let mean = || sums.sum[index] / count;
        let score = match kind {
            SummaryKind::Mean | SummaryKind::Median => mean().abs(),
            SummaryKind::MeanAbsolute => sums.magnitude[index] as f64 / count,
            SummaryKind::Cancellation => {
                (sums.magnitude[index] as f64 / count - mean().abs()).max(0.0)
            }
            SummaryKind::SampleSd | SummaryKind::Mad if n > 1 => {
                let m = mean();
                ((sums.square[index] - count * m * m).max(0.0) / (count - 1.0)).sqrt()
            }
            SummaryKind::SampleSd | SummaryKind::Mad => 0.0,
            SummaryKind::Coverage => count,
        };
        if score.is_finite() {
            let coords = [index % nx, index / nx % ny, index / (nx * ny)];
            profile[coords[axis]] += score;
        }
    }
    let Some((slice, &best)) = profile
        .iter()
        .enumerate()
        .max_by(|a, b| a.1.total_cmp(b.1).then(b.0.cmp(&a.0)))
    else {
        return Ok(None);
    };
    if best.is_nan() || best <= 0.0 {
        return Ok(None);
    }
    let mut center = [
        (dimensions[0] - 1) as f32 / 2.0,
        (dimensions[1] - 1) as f32 / 2.0,
        (dimensions[2] - 1) as f32 / 2.0,
    ];
    center[axis] = slice as f32;
    let target = affine.transform_point(&Point3::from(center));
    let crosshair = Vector3::from(request.crosshair_mm);
    let offset = (target.coords - crosshair).dot(&normal);
    let moved = crosshair + normal * offset;
    Ok(Some([moved.x, moved.y, moved.z]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn template_paths_are_remembered_without_decoding_or_refetching() {
        let state = BridgeState::default().unwrap();
        let file = crate::set_sample_cache::TestSource::new(&[1, 1, 1], &[1.]);
        // A remembered cached file is returned as is: no template service
        // call, no download, no decode.
        template_paths().lock().unwrap().insert(
            "Remembered_T1w_1mm".into(),
            Resolved::Path(file.path.clone()),
        );
        let remembered = UnderlayRequest {
            source_path: "template:Remembered_T1w_1mm".into(),
        };
        let guard = state.template_service.lock().await;
        let quick = |request: &UnderlayRequest| {
            let request = request.clone();
            let state = &state;
            async move {
                tokio::time::timeout(Duration::from_secs(5), underlay_path(&request, state))
                    .await
                    .expect("resolved without the template service")
            }
        };
        assert_eq!(quick(&remembered).await, Ok(file.path.clone()));
        drop(guard);
        // A failure is remembered too, so later slices do not retry it.
        let unknown = UnderlayRequest {
            source_path: "template:Unknown_T1w_1mm".into(),
        };
        let first = underlay_path(&unknown, &state).await.unwrap_err();
        let guard = state.template_service.lock().await;
        assert_eq!(quick(&unknown).await, Err(first));
        drop(guard);
        // Plain files pass through.
        let plain = UnderlayRequest {
            source_path: "/data/anatomy.nii.gz".into(),
        };
        assert_eq!(
            underlay_path(&plain, &state).await,
            Ok(PathBuf::from("/data/anatomy.nii.gz"))
        );
    }
}
