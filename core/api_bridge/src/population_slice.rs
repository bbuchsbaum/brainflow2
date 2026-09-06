//! Visible-support evaluation for observed population fields. The retained
//! plane matrix has a byte budget and never enters the volume/GPU registries.
use crate::{
    population_sampling::SampleCancellation,
    set_sample_cache::{QuerySourceGuard, SampleSourceRevision},
    BridgeState, SetMemberRef,
};
use bridge_types::{BridgeError, BridgeResult, VolumeSendable};
use field_table::population::FieldMoments;
use nalgebra::{Matrix4, Point3};
use neuro_types::{Handedness, SliceGeometry, ViewOrientation, VolumeMetadata};
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
};

const MAX_BYTES: usize = 128 * 1024 * 1024;
const MAX_PIXELS: usize = 512 * 512;

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SummaryKind {
    Mean,
    SampleSd,
    Cancellation,
    Coverage,
}
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Orientation {
    Axial,
    Coronal,
    Sagittal,
}
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PopulationSliceRequest {
    pub context_key: String,
    pub members: Vec<SetMemberRef>,
    pub working_member_ids: Vec<String>,
    pub focus_member_id: Option<String>,
    pub crosshair_mm: [f32; 3],
    pub orientation: Orientation,
    pub dim_px: [u32; 2],
    pub zoom: f32,
    pub summary: SummaryKind,
}
#[derive(Clone, Debug, serde::Serialize)]
pub struct Plane {
    pub origin_mm: [f32; 3],
    pub u_mm: [f32; 3],
    pub v_mm: [f32; 3],
    pub dim_px: [u32; 2],
}
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SliceSource {
    pub member_id: String,
    pub revision: SampleSourceRevision,
}
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PopulationSliceResult {
    pub plane: Plane,
    pub center_world: [f32; 3],
    pub context_range: Option<[f32; 2]>,
    pub summary: Vec<f32>,
    pub focused: Vec<f32>,
    pub valid_counts: Vec<u32>,
    pub eligible_count: usize,
    pub sources: Vec<SliceSource>,
    pub source_cache_hit: bool,
    pub cached_bytes: usize,
    pub sampling: &'static str,
}
struct PixelPlan {
    plane: Plane,
    dimensions: Vec<usize>,
    affine: Matrix4<f32>,
    center_world: [f32; 3],
    voxels: Vec<[usize; 3]>,
    pixels: Vec<Option<usize>>,
}
struct CachedPlane {
    key: String,
    context_key: String,
    plan: Arc<PixelPlan>,
    rows: Vec<Vec<f32>>,
    sources: Vec<SliceSource>,
    guard: QuerySourceGuard,
    bytes: usize,
}
pub struct PopulationSliceEngine {
    cache: Mutex<Option<Arc<CachedPlane>>>,
    admission: Arc<tokio::sync::Semaphore>,
}
impl Default for PopulationSliceEngine {
    fn default() -> Self {
        Self {
            cache: Mutex::new(None),
            admission: Arc::new(tokio::sync::Semaphore::new(1)),
        }
    }
}
impl PopulationSliceEngine {
    pub async fn release(&self, context_key: &str) -> BridgeResult<()> {
        let _permit = self
            .admission
            .acquire()
            .await
            .map_err(|_| input("Population slice admission is closed."))?;
        let mut cache = self
            .cache
            .lock()
            .map_err(|_| input("Population slice cache unavailable."))?;
        if cache
            .as_ref()
            .is_some_and(|entry| entry.context_key == context_key)
        {
            *cache = None;
        }
        Ok(())
    }
    pub async fn evaluate(
        &self,
        request: PopulationSliceRequest,
        state: &BridgeState,
        cancellation: SampleCancellation,
    ) -> BridgeResult<PopulationSliceResult> {
        validate(&request)?;
        let permit = tokio::select! {
            _ = cancellation.cancelled() => return Err(crate::population_sampling::cancelled()),
            permit = Arc::clone(&self.admission).acquire_owned() => permit.map_err(|_| input("Population slice admission is closed."))?,
        };
        let key = serde_json::to_string(&(
            &request.context_key,
            request
                .members
                .iter()
                .map(|m| {
                    (
                        &m.member_id,
                        &m.source_path,
                        m.stack_index,
                        &m.expected_sha256,
                    )
                })
                .collect::<Vec<_>>(),
            request.crosshair_mm,
            &request.orientation,
            request.dim_px,
            request.zoom,
        ))
        .map_err(|error| input(error.to_string()))?;
        let candidate = self
            .cache
            .lock()
            .map_err(|_| input("Population slice cache unavailable."))?
            .as_ref()
            .filter(|entry| entry.key == key)
            .cloned();
        let mut cached = None;
        if let Some(candidate) = candidate {
            if candidate
                .guard
                .clone()
                .validate(cancellation.clone())
                .await
                .is_ok()
            {
                cached = Some(candidate);
            }
            cancellation.check()?;
        }
        let cache_hit = cached.is_some();
        let cached = match cached {
            Some(cached) => cached,
            None => {
                // Release the previous matrix before admitting another one.
                *self
                    .cache
                    .lock()
                    .map_err(|_| input("Population slice cache unavailable."))? = None;
                let built = Arc::new(build_plane(key, &request, state, &cancellation).await?);
                cancellation.check()?;
                *self
                    .cache
                    .lock()
                    .map_err(|_| input("Population slice cache unavailable."))? =
                    Some(Arc::clone(&built));
                built
            }
        };
        let guard = cached.guard.clone();
        let token = cancellation.clone();
        let result = tokio::task::spawn_blocking(move || {
            let _permit = permit; // A canceled async caller cannot release a running reduction.
            reduce_plane(&cached, &request, cache_hit, &cancellation)
        })
        .await
        .map_err(|error| input(format!("Population reduction failed: {error}")))??;
        guard.validate(token).await?;
        Ok(result)
    }
}
fn validate(request: &PopulationSliceRequest) -> BridgeResult<()> {
    crate::validate_set_sample_request(&request.members, &request.crosshair_mm, 0.0, "mean")?;
    let pixels = (request.dim_px[0] as usize)
        .checked_mul(request.dim_px[1] as usize)
        .ok_or_else(|| input("Population raster dimensions overflow."))?;
    if request.members.is_empty()
        || pixels == 0
        || pixels > MAX_PIXELS
        || request.dim_px.iter().any(|&v| v > 1024)
        || !request.zoom.is_finite()
        || !(0.25..=8.0).contains(&request.zoom)
    {
        return Err(input("Population slices require observations, a bounded nonempty raster and zoom from 0.25 to 8."));
    }
    let bytes = pixels
        .checked_mul(request.members.len())
        .and_then(|n| n.checked_mul(4))
        .ok_or_else(|| input("Population plane size overflow."))?;
    if bytes > MAX_BYTES {
        return Err(input("Visible observation samples exceed the 128 MiB plane budget; reduce raster size or context."));
    }
    let ids: HashSet<_> = request.members.iter().map(|m| &m.member_id).collect();
    let selected: HashSet<_> = request.working_member_ids.iter().collect();
    if selected.len() != request.working_member_ids.len()
        || selected.iter().any(|id| !ids.contains(id))
        || request
            .focus_member_id
            .as_ref()
            .is_some_and(|id| !ids.contains(id))
    {
        return Err(input(
            "Population focus and working selection must identify unique eligible observations.",
        ));
    }
    Ok(())
}
fn grid(volume: &VolumeSendable) -> BridgeResult<(Vec<usize>, Matrix4<f32>)> {
    let dimensions = crate::get_spatial_dims_from_volume(volume);
    let affine = *crate::get_affine_from_volume(volume)?.matrix();
    if dimensions.len() != 3
        || dimensions.contains(&0)
        || !affine.iter().all(|v| v.is_finite())
        || affine.try_inverse().is_none()
        || (0..4)
            .any(|column| (affine[(3, column)] - if column == 3 { 1.0 } else { 0.0 }).abs() > 1e-5)
    {
        return Err(input(
            "Population sources require finite, invertible three-dimensional world grids.",
        ));
    }
    // The shared viewport assumes orthogonal, square screen pixels. Rotated
    // grids are supported; a sheared native basis needs a resampling adapter.
    for a in 0..3 {
        for b in a + 1..3 {
            let x = affine.fixed_view::<3, 1>(0, a);
            let y = affine.fixed_view::<3, 1>(0, b);
            if x.dot(&y).abs() > 1e-5 * x.norm() * y.norm() {
                return Err(input("Population slices require an orthogonal native grid; explicitly resample sheared sources first."));
            }
        }
    }
    Ok((dimensions, affine))
}
fn pixel_plan(
    volume: &VolumeSendable,
    request: &PopulationSliceRequest,
) -> BridgeResult<PixelPlan> {
    let (dimensions, affine) = grid(volume)?;
    let center = affine.transform_point(&Point3::new(
        (dimensions[0] - 1) as f32 / 2.0,
        (dimensions[1] - 1) as f32 / 2.0,
        (dimensions[2] - 1) as f32 / 2.0,
    ));
    let orientation = match request.orientation {
        Orientation::Axial => ViewOrientation::Axial,
        Orientation::Coronal => ViewOrientation::Coronal,
        Orientation::Sagittal => ViewOrientation::Sagittal,
    };
    let mut geometry = SliceGeometry::full_extent(
        orientation,
        request.crosshair_mm,
        &VolumeMetadata {
            dimensions: [dimensions[0], dimensions[1], dimensions[2]],
            voxel_to_world: affine,
        },
        request.dim_px,
        Handedness::Neurological,
    );
    for axis in 0..3 {
        let center = geometry.origin_mm[axis]
            + geometry.u_mm[axis] * (geometry.dim_px[0] - 1) as f32 / 2.0
            + geometry.v_mm[axis] * (geometry.dim_px[1] - 1) as f32 / 2.0;
        geometry.u_mm[axis] /= request.zoom;
        geometry.v_mm[axis] /= request.zoom;
        geometry.origin_mm[axis] = center
            - geometry.u_mm[axis] * (geometry.dim_px[0] - 1) as f32 / 2.0
            - geometry.v_mm[axis] * (geometry.dim_px[1] - 1) as f32 / 2.0;
    }
    let inverse = affine
        .try_inverse()
        .ok_or_else(|| input("Invalid population affine."))?;
    let mut voxels = Vec::new();
    let mut pixels = Vec::new();
    let mut index = HashMap::new();
    for y in 0..geometry.dim_px[1] {
        for x in 0..geometry.dim_px[0] {
            let world = geometry.pixel_to_world(x, y);
            let v = inverse.transform_point(&Point3::from(world));
            let rounded = [v.x.round(), v.y.round(), v.z.round()];
            if (0..3).any(|i| {
                !rounded[i].is_finite() || rounded[i] < 0.0 || rounded[i] >= dimensions[i] as f32
            }) {
                pixels.push(None);
                continue;
            }
            let coords = rounded.map(|v| v as usize);
            let slot = *index.entry(coords).or_insert_with(|| {
                let slot = voxels.len();
                voxels.push(coords);
                slot
            });
            pixels.push(Some(slot));
        }
    }
    Ok(PixelPlan {
        plane: Plane {
            origin_mm: geometry.origin_mm,
            u_mm: geometry.u_mm,
            v_mm: geometry.v_mm,
            dim_px: geometry.dim_px,
        },
        dimensions,
        affine,
        center_world: [center.x, center.y, center.z],
        voxels,
        pixels,
    })
}
fn sample_row(
    volume: &VolumeSendable,
    revision: &SampleSourceRevision,
    member: &SetMemberRef,
    plan: &PixelPlan,
    cancellation: &SampleCancellation,
) -> BridgeResult<Vec<f32>> {
    let (dimensions, affine) = grid(volume)?;
    if dimensions != plan.dimensions
        || affine
            .iter()
            .zip(plan.affine.iter())
            .any(|(a, b)| (a - b).abs() > 1e-5)
    {
        return Err(input(
            "Population sources have different voxel grids or world affines.",
        ));
    }
    if member
        .expected_sha256
        .as_ref()
        .is_some_and(|hash| hash != &revision.sha256)
    {
        return Err(input("A frozen population source revision changed."));
    }
    let frames = crate::stack_length_for_volume(volume);
    let frame = member.stack_index.unwrap_or(0);
    if (frames > 1 && member.stack_index.is_none()) || frame >= frames {
        return Err(input(
            "Population source needs a valid explicit frame selection.",
        ));
    }
    plan.voxels
        .iter()
        .enumerate()
        .map(|(i, &[x, y, z])| {
            if i % 4096 == 0 {
                cancellation.check()?;
            }
            Ok(crate::read_member_frame_at_voxel(volume, x, y, z, frame).unwrap_or(f32::NAN))
        })
        .collect()
}
async fn build_plane(
    key: String,
    request: &PopulationSliceRequest,
    state: &BridgeState,
    cancellation: &SampleCancellation,
) -> BridgeResult<CachedPlane> {
    let mut paths = Vec::with_capacity(request.members.len());
    for member in &request.members {
        cancellation.check()?;
        paths.push(crate::resolve_member_source_path(&member.source_path, state).await?);
    }
    let guard = QuerySourceGuard::capture(paths.clone(), cancellation.clone()).await?;
    let first = request.members[0].clone();
    let req = request.clone();
    let token = cancellation.clone();
    let (plan, row, revision) = state
        .set_sample_cache
        .with_volume_cancelable(
            paths[0].clone(),
            cancellation.clone(),
            move |volume, revision| {
                let plan = pixel_plan(volume, &req)?;
                let row = sample_row(volume, revision, &first, &plan, &token)?;
                Ok((Arc::new(plan), row, revision.clone()))
            },
        )
        .await?;
    let mut rows = vec![row];
    let mut sources = vec![SliceSource {
        member_id: request.members[0].member_id.clone(),
        revision,
    }];
    for (member, path) in request.members.iter().zip(paths).skip(1) {
        cancellation.check()?;
        let member = member.clone();
        let plan = Arc::clone(&plan);
        let token = cancellation.clone();
        let (row, source) = state
            .set_sample_cache
            .with_volume_cancelable(path, cancellation.clone(), move |volume, revision| {
                Ok((
                    sample_row(volume, revision, &member, &plan, &token)?,
                    SliceSource {
                        member_id: member.member_id.clone(),
                        revision: revision.clone(),
                    },
                ))
            })
            .await?;
        rows.push(row);
        sources.push(source);
    }
    guard.clone().validate(cancellation.clone()).await?;
    let bytes = rows.iter().map(|row| row.capacity() * 4).sum::<usize>()
        + plan.voxels.capacity() * std::mem::size_of::<[usize; 3]>()
        + plan.pixels.capacity() * std::mem::size_of::<Option<usize>>();
    if bytes > MAX_BYTES {
        return Err(input("Population plane exceeds its retained byte budget."));
    }
    Ok(CachedPlane {
        key,
        context_key: request.context_key.clone(),
        plan,
        rows,
        sources,
        guard,
        bytes,
    })
}
fn reduce_plane(
    cached: &CachedPlane,
    request: &PopulationSliceRequest,
    cache_hit: bool,
    cancellation: &SampleCancellation,
) -> BridgeResult<PopulationSliceResult> {
    let selected: HashSet<_> = request.working_member_ids.iter().collect();
    let focus = request
        .focus_member_id
        .as_ref()
        .and_then(|id| cached.sources.iter().position(|s| &s.member_id == id));
    // A view fully outside the volume has no native samples; its entire raster
    // is unavailable. One dummy accumulator location keeps that case explicit.
    let mut moments = FieldMoments::new(cached.plan.voxels.len().max(1), 0.0)
        .map_err(|e| input(e.to_string()))?;
    if !cached.plan.voxels.is_empty() {
        for (row, source) in cached.rows.iter().zip(&cached.sources) {
            cancellation.check()?;
            if selected.contains(&source.member_id) {
                moments.push(row, None).map_err(|e| input(e.to_string()))?;
            }
        }
    }
    let summaries: Vec<_> = moments.summaries().collect();
    let mut summary = Vec::with_capacity(cached.plan.pixels.len());
    let mut focused = Vec::with_capacity(summary.capacity());
    let mut valid_counts = Vec::with_capacity(summary.capacity());
    for (pixel, slot) in cached.plan.pixels.iter().enumerate() {
        if pixel % 4096 == 0 {
            cancellation.check()?;
        }
        let value = slot.and_then(|index| {
            let s = &summaries[index];
            match request.summary {
                SummaryKind::Mean => s.mean,
                SummaryKind::SampleSd => s.sample_sd,
                SummaryKind::Cancellation => s.cancellation,
                SummaryKind::Coverage => Some(s.valid_count as f64),
            }
        });
        summary.push(value.map(|v| v as f32).unwrap_or(f32::NAN));
        focused.push(
            slot.and_then(|index| focus.map(|focus| cached.rows[focus][index]))
                .unwrap_or(f32::NAN),
        );
        valid_counts.push(
            slot.map(|index| summaries[index].valid_count as u32)
                .unwrap_or(0),
        );
    }
    let mut range: Option<[f32; 2]> = None;
    for row in &cached.rows {
        cancellation.check()?;
        for &value in row.iter().filter(|value| value.is_finite()) {
            let bounds = range.get_or_insert([value, value]);
            bounds[0] = bounds[0].min(value);
            bounds[1] = bounds[1].max(value);
        }
    }
    cancellation.check()?;
    Ok(PopulationSliceResult {
        context_range: range,
        plane: cached.plan.plane.clone(),
        center_world: cached.plan.center_world,
        summary,
        focused,
        valid_counts,
        eligible_count: selected.len(),
        sources: cached.sources.clone(),
        source_cache_hit: cache_hit,
        cached_bytes: cached.bytes,
        sampling: "nearest",
    })
}
fn input(details: impl Into<String>) -> BridgeError {
    BridgeError::Input {
        code: 2027,
        details: details.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::set_sample_cache::TestSource;

    fn request(sources: &[TestSource]) -> PopulationSliceRequest {
        let members: Vec<_> = sources
            .iter()
            .enumerate()
            .map(|(i, source)| SetMemberRef {
                member_id: format!("person-{i}"),
                display_label: None,
                design_values: Default::default(),
                source_path: source.path.to_string_lossy().into_owned(),
                stack_index: None,
                expected_sha256: None,
            })
            .collect();
        PopulationSliceRequest {
            context_key: "workspace:dataset:revision".into(),
            working_member_ids: members.iter().map(|m| m.member_id.clone()).collect(),
            focus_member_id: Some(members[0].member_id.clone()),
            members,
            crosshair_mm: [1., 1., 1.],
            orientation: Orientation::Axial,
            dim_px: [3, 3],
            zoom: 1.,
            summary: SummaryKind::Mean,
        }
    }
    async fn evaluate(
        state: &BridgeState,
        request: PopulationSliceRequest,
    ) -> PopulationSliceResult {
        state
            .population_slice
            .evaluate(request, state, SampleCancellation::default())
            .await
            .unwrap()
    }
    fn finite(result: &[f32]) -> Vec<f32> {
        result.iter().copied().filter(|v| v.is_finite()).collect()
    }

    #[tokio::test]
    async fn population_slice_opposing_people_reuses_observations_for_focus_and_selection() {
        let sources: Vec<_> = (0..80)
            .map(|i| TestSource::new(&[3, 3, 3], &[if i < 40 { 3. } else { -1. }; 27]))
            .collect();
        let state = BridgeState::default().unwrap();
        let mut req = request(&sources);
        let first = evaluate(&state, req.clone()).await;
        assert!(!first.source_cache_hit);
        assert_eq!(first.eligible_count, 80);
        assert!(finite(&first.summary).iter().all(|v| *v == 1.));
        assert!(first.valid_counts.iter().all(|&n| n == 80));
        assert!(finite(&first.focused).iter().all(|v| *v == 3.));
        req.focus_member_id = Some("person-79".into());
        req.summary = SummaryKind::Cancellation;
        let cancellation = evaluate(&state, req.clone()).await;
        assert!(cancellation.source_cache_hit);
        assert!(finite(&cancellation.summary).iter().all(|v| *v == 1.));
        assert!(finite(&cancellation.focused).iter().all(|v| *v == -1.));
        req.summary = SummaryKind::SampleSd;
        let sd = evaluate(&state, req.clone()).await;
        assert!(finite(&sd.summary)
            .iter()
            .all(|v| (*v - (320f32 / 79.).sqrt()).abs() < 1e-6));
        req.working_member_ids = vec!["person-0".into()];
        req.summary = SummaryKind::Mean;
        let selected = evaluate(&state, req.clone()).await;
        assert!(selected.source_cache_hit);
        assert!(finite(&selected.summary).iter().all(|v| *v == 3.));
        assert!(finite(&selected.focused).iter().all(|v| *v == -1.));
        req.working_member_ids.clear();
        let empty = evaluate(&state, req).await;
        assert!(empty.summary.iter().all(|v| v.is_nan()));
        assert!(empty.valid_counts.iter().all(|&n| n == 0));
        assert!(empty.cached_bytes < MAX_BYTES);
    }

    #[tokio::test]
    async fn population_slice_missing_is_not_zero_and_sources_refresh() {
        let sources = vec![
            TestSource::new(&[3, 3, 3], &[f32::NAN; 27]),
            TestSource::new(&[3, 3, 3], &[0.; 27]),
        ];
        let state = BridgeState::default().unwrap();
        let req = request(&sources);
        let first = evaluate(&state, req.clone()).await;
        assert!(first.summary.iter().all(|&v| v == 0.));
        assert!(first.focused.iter().all(|v| v.is_nan()));
        assert!(first.valid_counts.iter().all(|&n| n == 1));
        sources[0].write(&[3, 3, 3], &[4.; 27]);
        let next = evaluate(&state, req.clone()).await;
        assert!(!next.source_cache_hit);
        assert!(next.summary.iter().all(|&v| v == 2.));
        assert_ne!(
            first.sources[0].revision.sha256,
            next.sources[0].revision.sha256
        );
        state.population_slice.release("unrelated").await.unwrap();
        assert!(evaluate(&state, req.clone()).await.source_cache_hit);
        state
            .population_slice
            .release(&req.context_key)
            .await
            .unwrap();
        assert!(state.population_slice.cache.lock().unwrap().is_none());
        assert!(!evaluate(&state, req).await.source_cache_hit);
    }

    #[tokio::test]
    async fn population_slice_pixels_match_world_locations_in_every_orientation() {
        // Independent x-fastest coordinate ramp; values encode voxel identity.
        let values: Vec<_> = (0..27)
            .map(|i| (i % 3 + 10 * (i / 3 % 3) + 100 * (i / 9)) as f32)
            .collect();
        let sources = vec![TestSource::new(&[3, 3, 3], &values)];
        let state = BridgeState::default().unwrap();
        let mut req = request(&sources);
        for orientation in [
            Orientation::Axial,
            Orientation::Coronal,
            Orientation::Sagittal,
        ] {
            req.orientation = orientation;
            let result = evaluate(&state, req.clone()).await;
            assert_eq!(result.center_world, [1., 1., 1.]);
            let plane = &result.plane;
            assert_eq!(
                plane
                    .u_mm
                    .iter()
                    .zip(plane.v_mm)
                    .map(|(a, b)| a * b)
                    .sum::<f32>(),
                0.
            );
            for y in 0..plane.dim_px[1] {
                for x in 0..plane.dim_px[0] {
                    let coords: Vec<_> = (0..3)
                        .map(|axis| {
                            (plane.origin_mm[axis]
                                + x as f32 * plane.u_mm[axis]
                                + y as f32 * plane.v_mm[axis])
                                .round()
                        })
                        .collect();
                    let expected = coords[0] + 10. * coords[1] + 100. * coords[2];
                    assert_eq!(result.focused[(y * plane.dim_px[0] + x) as usize], expected);
                }
            }
        }
        req.crosshair_mm = [1000.; 3];
        let outside = evaluate(&state, req).await;
        assert!(outside.summary.iter().all(|v| v.is_nan()));
        assert!(outside.valid_counts.iter().all(|&n| n == 0));
    }

    #[tokio::test]
    async fn population_slice_requires_matching_support_and_explicit_frames() {
        let sources = vec![
            TestSource::new(&[3, 3, 3], &[1.; 27]),
            TestSource::new(&[3, 3, 3], &[2.; 27]),
        ];
        let mut bytes = std::fs::read(&sources[1].path).unwrap();
        bytes[292..296].copy_from_slice(&10f32.to_le_bytes()); // sform translation
        std::fs::write(&sources[1].path, bytes).unwrap();
        let state = BridgeState::default().unwrap();
        let error = state
            .population_slice
            .evaluate(request(&sources), &state, SampleCancellation::default())
            .await
            .unwrap_err();
        assert!(error.to_string().contains("different voxel grids"));
        let sources = vec![TestSource::new(
            &[3, 3, 3, 2],
            &[vec![1.; 27], vec![7.; 27]].concat(),
        )];
        let mut req = request(&sources);
        assert!(state
            .population_slice
            .evaluate(req.clone(), &state, SampleCancellation::default())
            .await
            .is_err());
        req.members[0].stack_index = Some(1);
        assert!(evaluate(&state, req.clone())
            .await
            .focused
            .iter()
            .all(|&v| v == 7.));
        req.members[0].expected_sha256 = Some("changed".into());
        assert!(state
            .population_slice
            .evaluate(req, &state, SampleCancellation::default())
            .await
            .is_err());
    }

    #[tokio::test]
    async fn population_slice_cancellation_and_invalid_selection_do_not_publish() {
        let sources = vec![TestSource::new(&[3, 3, 3], &[1.; 27])];
        let state = BridgeState::default().unwrap();
        let mut req = request(&sources);
        let token = SampleCancellation::default();
        token.cancel();
        assert!(state
            .population_slice
            .evaluate(req.clone(), &state, token)
            .await
            .is_err());
        assert!(state.population_slice.cache.lock().unwrap().is_none());
        req.working_member_ids.push("not eligible".into());
        assert!(validate(&req).is_err());
        req = request(&sources);
        req.dim_px = [u32::MAX, u32::MAX];
        assert!(validate(&req).is_err());
    }

    #[tokio::test]
    async fn population_slice_realistic_context_reports_warm_reduction_cost() {
        // 80 x 204,800 float32 measurements = 65,536,000 decoded bytes.
        // This measures native evaluation only; IPC/canvas presentation has a
        // separate end-to-end gate and is deliberately not claimed here.
        let sources: Vec<_> = (0..80)
            .map(|i| TestSource::new(&[80, 80, 32], &vec![i as f32; 204_800]))
            .collect();
        let state = BridgeState::default().unwrap();
        let mut req = request(&sources);
        req.dim_px = [128, 128];
        req.crosshair_mm = [39.5, 39.5, 15.5];
        let cold = std::time::Instant::now();
        let result = evaluate(&state, req.clone()).await;
        let cold_ms = cold.elapsed().as_secs_f64() * 1000.;
        assert!(result.summary.iter().all(|&v| v == 39.5));
        let mut latencies = Vec::new();
        for i in 0..20 {
            req.focus_member_id = Some(format!("person-{i}"));
            req.working_member_ids = (0..40 + i).map(|j| format!("person-{j}")).collect();
            let start = std::time::Instant::now();
            let result = evaluate(&state, req.clone()).await;
            latencies.push(start.elapsed().as_secs_f64() * 1000.);
            assert!(result.source_cache_hit);
            assert!(result.summary.iter().all(|&v| v == (39 + i) as f32 / 2.));
            assert!(result.focused.iter().all(|&v| v == i as f32));
        }
        latencies.sort_by(f64::total_cmp);
        println!("POPULATION_SLICE_NATIVE debug 80x204800 cold_ms={cold_ms:.2} warm_p50_ms={:.2} warm_p95_ms={:.2} warm_max_ms={:.2} retained_plane_bytes={}", latencies[9], latencies[18], latencies[19], result.cached_bytes);
        state
            .population_slice
            .release(&req.context_key)
            .await
            .unwrap();
        assert!(state.population_slice.cache.lock().unwrap().is_none());
    }
}
