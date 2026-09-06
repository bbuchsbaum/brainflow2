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
const MAX_CUTOUT_MEMBERS: usize = 96;
const MAX_CUTOUT_DIM: u32 = 64;

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SummaryKind {
    Mean,
    SampleSd,
    MeanAbsolute,
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
    #[serde(default)]
    pub mask: Option<crate::population_mask::MaskSource>,
    pub members: Vec<SetMemberRef>,
    pub working_member_ids: Vec<String>,
    pub focus_member_id: Option<String>,
    pub crosshair_mm: [f32; 3],
    pub orientation: Orientation,
    pub dim_px: [u32; 2],
    pub zoom: f32,
    pub summary: SummaryKind,
    #[serde(default)]
    pub aggregation: Option<ParticipantAggregation>,
    #[serde(default)]
    pub cutouts: Option<CutoutRequest>,
}
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WithinParticipant {
    Single,
    Mean,
}
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParticipantGroup {
    pub participant_id: String,
    pub member_ids: Vec<String>,
}
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParticipantAggregation {
    pub within: WithinParticipant,
    pub groups: Vec<ParticipantGroup>,
}
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CutoutRequest {
    pub center_mm: [f32; 3],
    /// Width and height of the square image edges, in world millimetres.
    pub width_mm: f32,
    pub dim_px: u32,
    pub member_ids: Vec<String>,
}
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CutoutMember {
    pub member_id: String,
    pub values: Vec<f32>,
    pub valid_pixels: usize,
}
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CutoutResult {
    pub plane: Plane,
    pub members: Vec<CutoutMember>,
}
struct CutoutPlan {
    plane: Plane,
    pixels: Vec<Option<usize>>,
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
    pub unit_count: usize,
    pub sources: Vec<SliceSource>,
    pub mask_revision: Option<SampleSourceRevision>,
    pub source_cache_hit: bool,
    pub cached_bytes: usize,
    pub sampling: &'static str,
    pub cutouts: Option<CutoutResult>,
}
struct PixelPlan {
    plane: Plane,
    dimensions: Vec<usize>,
    affine: Matrix4<f32>,
    center_world: [f32; 3],
    voxels: Vec<[usize; 3]>,
    pixels: Vec<Option<usize>>,
    cutouts: Option<CutoutPlan>,
}
struct CachedPlane {
    key: String,
    context_key: String,
    plan: Arc<PixelPlan>,
    rows: Vec<Vec<f32>>,
    sources: Vec<SliceSource>,
    mask_revision: Option<SampleSourceRevision>,
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
            &request.mask,
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
            request
                .cutouts
                .as_ref()
                .map(|cutouts| (cutouts.center_mm, cutouts.width_mm, cutouts.dim_px)),
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
    let cutout_pixels = request.cutouts.as_ref().map_or(0, |cutouts| {
        (cutouts.dim_px as usize).saturating_mul(cutouts.dim_px as usize)
    });
    let bytes = pixels
        .checked_add(cutout_pixels)
        .ok_or_else(|| input("Population support size overflow."))?
        .checked_mul(request.members.len())
        .and_then(|n| n.checked_mul(4))
        .ok_or_else(|| input("Population plane size overflow."))?;
    if bytes > MAX_BYTES {
        return Err(input("Visible observation samples exceed the 128 MiB plane budget; reduce raster size or context."));
    }
    let ids: HashSet<_> = request.members.iter().map(|m| &m.member_id).collect();
    if let Some(cutouts) = &request.cutouts {
        let cutout_ids: HashSet<_> = cutouts.member_ids.iter().collect();
        if cutouts.dim_px == 0
            || cutouts.dim_px > MAX_CUTOUT_DIM
            || cutouts.member_ids.is_empty()
            || cutouts.member_ids.len() > MAX_CUTOUT_MEMBERS
            || cutout_ids.len() != cutouts.member_ids.len()
            || cutout_ids.iter().any(|id| !ids.contains(id))
            || !cutouts.center_mm.iter().all(|v| v.is_finite())
            || !cutouts.width_mm.is_finite()
            || !(1.0..=200.0).contains(&cutouts.width_mm)
        {
            return Err(input("Cutouts require 1-96 unique eligible observations, a 1-64 pixel square, finite center, and width from 1 to 200 mm."));
        }
    }
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
    if let Some(aggregation) = &request.aggregation {
        let mut participants = HashSet::new();
        let mut grouped = HashSet::new();
        for group in &aggregation.groups {
            if group.participant_id.trim().is_empty()
                || group.participant_id.trim() != group.participant_id
                || !participants.insert(&group.participant_id)
                || group.member_ids.is_empty()
                || (matches!(aggregation.within, WithinParticipant::Single)
                    && group.member_ids.len() != 1)
            {
                return Err(input("Participant summaries require unique nonempty participant IDs and a supported nonempty within-person group."));
            }
            for member in &group.member_ids {
                if !selected.contains(member) || !grouped.insert(member) {
                    return Err(input("Participant groups must partition the selected observation IDs exactly once."));
                }
            }
        }
        if grouped != selected {
            return Err(input(
                "Participant groups must cover every selected observation.",
            ));
        }
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
    let cutouts = request.cutouts.as_ref().map(|cutouts| {
        let spacing = cutouts.width_mm / cutouts.dim_px as f32;
        let length = |v: [f32; 3]| v.iter().map(|v| v * v).sum::<f32>().sqrt();
        let u_mm = geometry.u_mm.map(|v| v * spacing / length(geometry.u_mm));
        let v_mm = geometry.v_mm.map(|v| v * spacing / length(geometry.v_mm));
        let origin_mm = std::array::from_fn(|axis| {
            cutouts.center_mm[axis] - (u_mm[axis] + v_mm[axis]) * (cutouts.dim_px - 1) as f32 / 2.0
        });
        let plane = Plane {
            origin_mm,
            u_mm,
            v_mm,
            dim_px: [cutouts.dim_px; 2],
        };
        let mut cutout_pixels =
            Vec::with_capacity(cutouts.dim_px as usize * cutouts.dim_px as usize);
        for y in 0..cutouts.dim_px {
            for x in 0..cutouts.dim_px {
                let world = std::array::from_fn(|axis| {
                    origin_mm[axis] + x as f32 * u_mm[axis] + y as f32 * v_mm[axis]
                });
                let point = inverse.transform_point(&Point3::from(world));
                let rounded = [point.x.round(), point.y.round(), point.z.round()];
                if (0..3).any(|axis| {
                    !rounded[axis].is_finite()
                        || rounded[axis] < 0.0
                        || rounded[axis] >= dimensions[axis] as f32
                }) {
                    cutout_pixels.push(None);
                    continue;
                }
                let coords = rounded.map(|value| value as usize);
                let slot = *index.entry(coords).or_insert_with(|| {
                    let slot = voxels.len();
                    voxels.push(coords);
                    slot
                });
                cutout_pixels.push(Some(slot));
            }
        }
        CutoutPlan {
            plane,
            pixels: cutout_pixels,
        }
    });
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
        cutouts,
    })
}
fn sample_row(
    volume: &VolumeSendable,
    revision: &SampleSourceRevision,
    member: &SetMemberRef,
    plan: &PixelPlan,
    cancellation: &SampleCancellation,
    mask: Option<&crate::population_mask::PreparedMask>,
) -> BridgeResult<Vec<f32>> {
    if let Some(mask) = mask {
        mask.validate_grid(volume)?;
    }
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
            Ok(if mask.is_some_and(|mask| !mask.includes(x, y, z)) {
                f32::NAN
            } else {
                crate::read_member_frame_at_voxel(volume, x, y, z, frame).unwrap_or(f32::NAN)
            })
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
    let mask_path = match &request.mask {
        Some(mask) => Some(crate::resolve_member_source_path(&mask.source_path, state).await?),
        None => None,
    };
    let guard = QuerySourceGuard::capture(
        paths
            .iter()
            .cloned()
            .chain(mask_path.iter().cloned())
            .collect(),
        cancellation.clone(),
    )
    .await?;
    let mask = match (&request.mask, mask_path) {
        (Some(source), Some(path)) => {
            Some(crate::population_mask::prepare_mask(source, path, state, cancellation).await?)
        }
        _ => None,
    };
    let mask_revision = mask.as_ref().map(|mask| mask.revision.clone());
    let first_mask = mask.clone();
    let first = request.members[0].clone();
    let req = request.clone();
    let token = cancellation.clone();
    let (plan, row, revision) = state
        .set_sample_cache
        .with_volume_cancelable(
            paths[0].clone(),
            cancellation.clone(),
            move |volume, revision| {
                let mut plan = pixel_plan(volume, &req)?;
                if let Some(mask) = &first_mask {
                    mask.validate_grid(volume)?;
                    let exclude = |slot: &mut Option<usize>| {
                        if slot.is_some_and(|index| {
                            let [x, y, z] = plan.voxels[index];
                            !mask.includes(x, y, z)
                        }) {
                            *slot = None;
                        }
                    };
                    plan.pixels.iter_mut().for_each(exclude);
                    if let Some(cutouts) = &mut plan.cutouts {
                        cutouts.pixels.iter_mut().for_each(exclude);
                    }
                }
                let row = sample_row(
                    volume,
                    revision,
                    &first,
                    &plan,
                    &token,
                    first_mask.as_deref(),
                )?;
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
        let mask = mask.clone();
        let plan = Arc::clone(&plan);
        let token = cancellation.clone();
        let (row, source) = state
            .set_sample_cache
            .with_volume_cancelable(path, cancellation.clone(), move |volume, revision| {
                Ok((
                    sample_row(volume, revision, &member, &plan, &token, mask.as_deref())?,
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
        + (plan.pixels.capacity()
            + plan
                .cutouts
                .as_ref()
                .map_or(0, |cutouts| cutouts.pixels.capacity()))
            * std::mem::size_of::<Option<usize>>();
    if bytes > MAX_BYTES {
        return Err(input("Population plane exceeds its retained byte budget."));
    }
    Ok(CachedPlane {
        key,
        context_key: request.context_key.clone(),
        plan,
        rows,
        sources,
        mask_revision,
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
        if let Some(aggregation) = &request.aggregation {
            let indices: HashMap<_, _> = cached
                .sources
                .iter()
                .enumerate()
                .map(|(index, source)| (&source.member_id, index))
                .collect();
            for group in &aggregation.groups {
                cancellation.check()?;
                let rows: Vec<&[f32]> = group
                    .member_ids
                    .iter()
                    .map(|id| cached.rows[indices[id]].as_slice())
                    .collect();
                match aggregation.within {
                    WithinParticipant::Single => moments.push(rows[0], None),
                    WithinParticipant::Mean => moments.push_mean(&rows),
                }
                .map_err(|e| input(e.to_string()))?;
            }
        } else {
            for (row, source) in cached.rows.iter().zip(&cached.sources) {
                cancellation.check()?;
                if selected.contains(&source.member_id) {
                    moments.push(row, None).map_err(|e| input(e.to_string()))?;
                }
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
                SummaryKind::MeanAbsolute => s.mean_absolute,
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
    let cutouts = match (&cached.plan.cutouts, &request.cutouts) {
        (Some(plan), Some(spec)) => {
            let mut members = Vec::with_capacity(spec.member_ids.len());
            for id in &spec.member_ids {
                cancellation.check()?;
                let row = cached
                    .sources
                    .iter()
                    .position(|source| &source.member_id == id)
                    .ok_or_else(|| {
                        input("Cutout observation is unavailable in the sampled context.")
                    })?;
                let values: Vec<_> = plan
                    .pixels
                    .iter()
                    .map(|slot| {
                        slot.map(|index| cached.rows[row][index])
                            .unwrap_or(f32::NAN)
                    })
                    .collect();
                let valid_pixels = values.iter().filter(|v| v.is_finite()).count();
                members.push(CutoutMember {
                    member_id: id.clone(),
                    values,
                    valid_pixels,
                });
            }
            Some(CutoutResult {
                plane: plan.plane.clone(),
                members,
            })
        }
        _ => None,
    };
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
        cutouts,
        context_range: range,
        plane: cached.plan.plane.clone(),
        center_world: cached.plan.center_world,
        summary,
        focused,
        valid_counts,
        eligible_count: selected.len(),
        unit_count: request
            .aggregation
            .as_ref()
            .map_or(selected.len(), |aggregation| aggregation.groups.len()),
        sources: cached.sources.clone(),
        mask_revision: cached.mask_revision.clone(),
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
            mask: None,
            context_key: "workspace:dataset:revision".into(),
            working_member_ids: members.iter().map(|m| m.member_id.clone()).collect(),
            focus_member_id: Some(members[0].member_id.clone()),
            members,
            crosshair_mm: [1., 1., 1.],
            orientation: Orientation::Axial,
            dim_px: [3, 3],
            zoom: 1.,
            summary: SummaryKind::Mean,
            aggregation: None,
            cutouts: None,
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
    async fn population_mask_applies_to_fields_cutouts_and_probe_counts() {
        use crate::population_mask::MaskSource;
        let sources = vec![
            TestSource::new(&[3, 3, 3], &[0.; 27]),
            TestSource::new(&[3, 3, 3], &[4.; 27]),
        ];
        let values: Vec<_> = (0..27).map(|i| if i % 3 == 1 { 1. } else { 0. }).collect();
        let mask = TestSource::new(&[3, 3, 3], &values);
        let state = BridgeState::default().unwrap();
        let mut req = request(&sources);
        req.mask = Some(MaskSource {
            source_path: mask.path.to_string_lossy().into_owned(),
            expected_sha256: None,
        });
        req.cutouts = Some(CutoutRequest {
            center_mm: [1.; 3],
            width_mm: 3.,
            dim_px: 3,
            member_ids: req.working_member_ids.clone(),
        });
        let result = evaluate(&state, req.clone()).await;
        let included: Vec<_> = (0..9)
            .map(|pixel| {
                (result.plane.origin_mm[0]
                    + result.plane.u_mm[0] * (pixel % 3) as f32
                    + result.plane.v_mm[0] * (pixel / 3) as f32)
                    .round()
                    == 1.
            })
            .collect();
        let included_count = included.iter().filter(|&&v| v).count();
        assert!(included_count > 0 && included_count < 9);
        for (index, &inside) in included.iter().enumerate() {
            if inside {
                assert_eq!(result.summary[index], 2.);
                assert_eq!(result.focused[index], 0.);
            } else {
                assert!(result.summary[index].is_nan());
                assert!(result.focused[index].is_nan());
            }
        }
        assert_eq!(
            result.valid_counts.iter().filter(|&&n| n == 2).count(),
            included_count
        );
        assert_eq!(result.cutouts.as_ref().unwrap().members[0].valid_pixels, 3);
        assert_eq!(
            finite(&result.cutouts.as_ref().unwrap().members[0].values),
            vec![0.; 3]
        );
        let revision = result.mask_revision.unwrap();
        req.summary = SummaryKind::Coverage;
        let coverage = evaluate(&state, req.clone()).await;
        assert!(coverage.source_cache_hit);
        assert_eq!(finite(&coverage.summary), vec![2.; included_count]); // excluded support is not coverage zero
        for (world, radius, count) in [([0., 1., 1.], 0., 0), ([1.; 3], 0., 1), ([1.; 3], 3., 9)] {
            let probe = crate::sample_set_trace_at_world_impl(
                &req.members,
                &world,
                radius,
                "mean",
                "sd",
                &state,
                &SampleCancellation::default(),
                req.mask.as_ref(),
            )
            .await
            .unwrap();
            assert!(probe.iter().all(|row| row.count == count));
            assert_eq!(
                probe[0].mask_revision.as_ref().unwrap().sha256,
                revision.sha256
            );
            if count > 0 {
                assert_eq!(probe[0].value, 0.);
                assert_eq!(probe[1].value, 4.);
            } else {
                assert!(probe.iter().all(|row| row.value.is_nan()));
            }
        }
        mask.write(&[3, 3, 3], &[0.; 27]);
        let empty = evaluate(&state, req.clone()).await;
        assert!(empty.summary.iter().all(|value| value.is_nan()));
        assert!(empty.valid_counts.iter().all(|&count| count == 0));
        assert!(empty.focused.iter().all(|value| value.is_nan()));
        let empty_probe = crate::sample_set_at_world_impl(
            &req.members,
            &[1.; 3],
            3.,
            "mean",
            &state,
            &SampleCancellation::default(),
            req.mask.as_ref(),
        )
        .await
        .unwrap();
        assert!(empty_probe
            .iter()
            .all(|row| row.count == 0 && row.value.is_nan()));
        // A mask edit invalidates the warm plane and the frozen hash contract.
        mask.write(&[3, 3, 3], &[1.; 27]);
        let changed = evaluate(&state, req.clone()).await;
        assert!(!changed.source_cache_hit);
        assert_eq!(finite(&changed.summary), vec![2.; 9]);
        assert_ne!(changed.mask_revision.unwrap().sha256, revision.sha256);
        req.mask.as_mut().unwrap().expected_sha256 = Some(revision.sha256);
        assert!(state
            .population_slice
            .evaluate(req, &state, SampleCancellation::default())
            .await
            .is_err());
    }

    #[tokio::test]
    async fn population_mask_rejects_nonbinary_mismatched_and_unavailable_sources() {
        use crate::population_mask::MaskSource;
        let sources = vec![TestSource::new(&[3, 3, 3], &[2.; 27])];
        let mask = TestSource::new(&[3, 3, 3], &[1.; 27]);
        let state = BridgeState::default().unwrap();
        let mut req = request(&sources);
        req.mask = Some(MaskSource {
            source_path: mask.path.to_string_lossy().into_owned(),
            expected_sha256: None,
        });
        for invalid in [0.5, -1., f32::NAN, f32::INFINITY] {
            let mut values = vec![1.; 27];
            values[0] = invalid;
            mask.write(&[3, 3, 3], &values);
            assert!(state
                .population_slice
                .evaluate(req.clone(), &state, SampleCancellation::default())
                .await
                .is_err());
            assert!(crate::sample_set_trace_at_world_impl(
                &req.members,
                &[1.; 3],
                0.,
                "mean",
                "none",
                &state,
                &SampleCancellation::default(),
                req.mask.as_ref()
            )
            .await
            .is_err());
        }
        mask.write(&[3, 3, 2], &[1.; 18]);
        assert!(state
            .population_slice
            .evaluate(req.clone(), &state, SampleCancellation::default())
            .await
            .is_err());
        assert!(crate::sample_set_trace_at_world_impl(
            &req.members,
            &[1.; 3],
            0.,
            "mean",
            "none",
            &state,
            &SampleCancellation::default(),
            req.mask.as_ref()
        )
        .await
        .is_err());
        mask.write(&[3, 3, 3], &[1.; 27]);
        let mut bytes = std::fs::read(&mask.path).unwrap();
        bytes[292..296].copy_from_slice(&1f32.to_le_bytes()); // same shape, different world translation
        std::fs::write(&mask.path, bytes).unwrap();
        assert!(state
            .population_slice
            .evaluate(req.clone(), &state, SampleCancellation::default())
            .await
            .is_err());
        assert!(crate::sample_set_trace_at_world_impl(
            &req.members,
            &[1.; 3],
            0.,
            "mean",
            "none",
            &state,
            &SampleCancellation::default(),
            req.mask.as_ref()
        )
        .await
        .is_err());
        mask.write(&[3, 3, 3, 2], &[1.; 54]);
        assert!(state
            .population_slice
            .evaluate(req.clone(), &state, SampleCancellation::default())
            .await
            .is_err());
        req.mask.as_mut().unwrap().source_path = "/missing/population-mask.nii".into();
        assert!(state
            .population_slice
            .evaluate(req, &state, SampleCancellation::default())
            .await
            .is_err());
    }

    #[tokio::test]
    async fn population_slice_participants_weight_people_and_reuse_observed_support() {
        let mut a = vec![0.; 27];
        a[13] = f32::NAN;
        let sources = vec![
            TestSource::new(&[3, 3, 3], &a),
            TestSource::new(&[3, 3, 3], &a),
            TestSource::new(&[3, 3, 3], &a),
            TestSource::new(&[3, 3, 3], &[8.; 27]),
        ];
        let state = BridgeState::default().unwrap();
        let mut req = request(&sources);
        let rows = evaluate(&state, req.clone()).await;
        assert_eq!(rows.summary[0], 2.);
        req.aggregation = Some(ParticipantAggregation {
            within: WithinParticipant::Mean,
            groups: vec![
                ParticipantGroup {
                    participant_id: "A".into(),
                    member_ids: req.working_member_ids[..3].to_vec(),
                },
                ParticipantGroup {
                    participant_id: "B".into(),
                    member_ids: req.working_member_ids[3..].to_vec(),
                },
            ],
        });
        let grouped = evaluate(&state, req.clone()).await;
        assert!(grouped.source_cache_hit);
        assert_eq!(grouped.unit_count, 2);
        assert_eq!(grouped.eligible_count, 4);
        // The full-extent raster need not have one pixel per native voxel.
        // Independently locate the missing source voxel using the declared plane.
        let missing: Vec<_> = (0..9)
            .map(|pixel| {
                (0..3).all(|axis| {
                    (grouped.plane.origin_mm[axis]
                        + grouped.plane.u_mm[axis] * (pixel % 3) as f32
                        + grouped.plane.v_mm[axis] * (pixel / 3) as f32)
                        .round()
                        == 1.
                })
            })
            .collect();
        assert!(missing.iter().any(|v| *v));
        assert!(missing.iter().any(|v| !*v));
        assert_eq!(
            grouped.summary,
            missing
                .iter()
                .map(|m| if *m { 8. } else { 4. })
                .collect::<Vec<_>>()
        );
        assert_eq!(
            grouped.valid_counts,
            missing
                .iter()
                .map(|m| if *m { 1 } else { 2 })
                .collect::<Vec<_>>()
        );
        assert_eq!(finite(&grouped.focused), finite(&rows.focused));
        assert!(grouped.focused[4].is_nan());
        req.summary = SummaryKind::SampleSd;
        let sd = evaluate(&state, req.clone()).await;
        assert!((sd.summary[0] - 32f32.sqrt()).abs() < 1e-6);
        assert!(sd.summary[4].is_nan());
        req.summary = SummaryKind::Coverage;
        let coverage = evaluate(&state, req.clone()).await;
        assert_eq!(
            coverage.summary,
            missing
                .iter()
                .map(|m| if *m { 1. } else { 2. })
                .collect::<Vec<_>>()
        );
        req.summary = SummaryKind::Mean;
        req.working_member_ids = vec!["person-3".into()];
        req.aggregation.as_mut().unwrap().groups.remove(0);
        let without_a = evaluate(&state, req.clone()).await;
        assert!(without_a.source_cache_hit);
        assert_eq!(without_a.summary, vec![8.; 9]);
        assert_eq!(without_a.unit_count, 1);
        req.working_member_ids.clear();
        req.aggregation.as_mut().unwrap().groups.clear();
        let empty = evaluate(&state, req).await;
        assert_eq!(empty.unit_count, 0);
        assert!(empty.summary.iter().all(|v| v.is_nan()));
    }

    #[test]
    fn population_slice_participant_groups_must_partition_selected_observations() {
        let sources = vec![
            TestSource::new(&[3, 3, 3], &[1.; 27]),
            TestSource::new(&[3, 3, 3], &[2.; 27]),
        ];
        let mut req = request(&sources);
        let groups = vec![
            ParticipantGroup {
                participant_id: "A".into(),
                member_ids: vec!["person-0".into()],
            },
            ParticipantGroup {
                participant_id: "B".into(),
                member_ids: vec!["person-1".into()],
            },
        ];
        req.aggregation = Some(ParticipantAggregation {
            within: WithinParticipant::Single,
            groups: groups.clone(),
        });
        assert!(validate(&req).is_ok());
        let invalid = vec![
            vec![groups[0].clone()],
            vec![groups[0].clone(), groups[0].clone()],
            vec![ParticipantGroup {
                participant_id: "A".into(),
                member_ids: req.working_member_ids.clone(),
            }],
            vec![
                groups[0].clone(),
                ParticipantGroup {
                    participant_id: "B".into(),
                    member_ids: vec!["absent".into()],
                },
            ],
            vec![
                groups[0].clone(),
                ParticipantGroup {
                    participant_id: " B".into(),
                    member_ids: vec!["person-1".into()],
                },
            ],
            vec![
                groups[0].clone(),
                ParticipantGroup {
                    participant_id: "B".into(),
                    member_ids: vec![],
                },
            ],
        ];
        for groups in invalid {
            req.aggregation.as_mut().unwrap().groups = groups;
            assert!(validate(&req).is_err());
        }
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
        req.summary = SummaryKind::MeanAbsolute;
        let magnitude = evaluate(&state, req.clone()).await;
        assert!(magnitude.source_cache_hit);
        assert!(finite(&magnitude.summary).iter().all(|v| *v == 2.));
        assert!(finite(&magnitude.focused).iter().all(|v| *v == -1.));
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
    async fn population_slice_magnitude_keeps_finite_counts_and_empty_is_unavailable() {
        let sources = vec![
            TestSource::new(&[3, 3, 3], &[f32::NAN; 27]),
            TestSource::new(&[3, 3, 3], &[0.; 27]),
            TestSource::new(&[3, 3, 3], &[-4.; 27]),
        ];
        let state = BridgeState::default().unwrap();
        let mut req = request(&sources);
        // Pin the public wire spelling as well as the numerical operator.
        req.summary = serde_json::from_str("\"meanAbsolute\"").unwrap();
        let magnitude = evaluate(&state, req.clone()).await;
        assert!(magnitude.summary.iter().all(|&value| value == 2.));
        assert!(magnitude.valid_counts.iter().all(|&count| count == 2));
        req.working_member_ids = vec!["person-1".into()];
        let zero = evaluate(&state, req.clone()).await;
        assert!(zero.source_cache_hit);
        assert!(zero.summary.iter().all(|&value| value == 0.));
        req.working_member_ids = vec!["person-0".into()];
        let missing = evaluate(&state, req.clone()).await;
        assert!(missing.summary.iter().all(|value| value.is_nan()));
        req.working_member_ids.clear();
        let empty = evaluate(&state, req).await;
        assert!(empty.summary.iter().all(|value| value.is_nan()));
        assert!(empty.valid_counts.iter().all(|&count| count == 0));
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
        req.cutouts = Some(CutoutRequest {
            center_mm: [1.; 3],
            width_mm: 3.,
            dim_px: 3,
            member_ids: vec!["person-0".into()],
        });
        for orientation in [
            Orientation::Axial,
            Orientation::Coronal,
            Orientation::Sagittal,
        ] {
            req.orientation = orientation;
            let result = evaluate(&state, req.clone()).await;
            assert_eq!(result.center_world, [1., 1., 1.]);
            let cutout = result.cutouts.as_ref().unwrap();
            assert_eq!(cutout.members[0].values[4], 111.);
            assert_eq!(cutout.members[0].valid_pixels, 9);
            let mut observed = cutout.members[0].values.clone();
            observed.sort_by(f32::total_cmp);
            // The named anatomical plane, independently enumerated from the
            // coordinate ramp, must contain every voxel in its 3x3 patch.
            let fixed_axis = match req.orientation {
                Orientation::Axial => 2,
                Orientation::Coronal => 1,
                Orientation::Sagittal => 0,
            };
            let mut expected: Vec<_> = (0..27)
                .filter(|index| [index % 3, index / 3 % 3, index / 9][fixed_axis] == 1)
                .map(|index| values[index])
                .collect();
            expected.sort_by(f32::total_cmp);
            assert_eq!(observed, expected);
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
        req.cutouts = Some(CutoutRequest {
            center_mm: [39.5, 39.5, 12.],
            width_mm: 32.,
            dim_px: 40,
            member_ids: req
                .members
                .iter()
                .map(|member| member.member_id.clone())
                .collect(),
        });
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
            let cutouts = result.cutouts.as_ref().unwrap();
            assert_eq!(cutouts.members.len(), 80);
            for (index, member) in cutouts.members.iter().enumerate() {
                assert_eq!(member.member_id, format!("person-{index}"));
                assert_eq!(member.valid_pixels, 1600);
                assert!(member.values.iter().all(|&value| value == index as f32));
            }
        }
        latencies.sort_by(f64::total_cmp);
        println!("POPULATION_SLICE_WITH_CUTOUTS_NATIVE debug 80x204800 gallery=80x40x40 cold_ms={cold_ms:.2} warm_p50_ms={:.2} warm_p95_ms={:.2} warm_max_ms={:.2} retained_plane_bytes={}", latencies[9], latencies[18], latencies[19], result.cached_bytes);
        state
            .population_slice
            .release(&req.context_key)
            .await
            .unwrap();
        assert!(state.population_slice.cache.lock().unwrap().is_none());
    }

    #[tokio::test]
    async fn population_cutouts_keep_pinned_geometry_and_observed_identity() {
        let ramp: Vec<_> = (0..27)
            .map(|i| (i % 3 + 10 * (i / 3 % 3) + 100 * (i / 9)) as f32)
            .collect();
        let sources = vec![
            TestSource::new(&[3, 3, 3], &ramp),
            TestSource::new(&[3, 3, 3], &ramp.iter().map(|v| -v).collect::<Vec<_>>()),
        ];
        let state = BridgeState::default().unwrap();
        let mut req = request(&sources);
        let main = evaluate(&state, req.clone()).await;
        req.cutouts = Some(CutoutRequest {
            center_mm: [1., 1., 2.],
            width_mm: 3.,
            dim_px: 3,
            member_ids: vec!["person-1".into(), "person-0".into()],
        });
        let result = evaluate(&state, req.clone()).await;
        assert_eq!(main.summary, result.summary);
        assert_eq!(main.focused, result.focused);
        let cutouts = result.cutouts.unwrap();
        assert_eq!(cutouts.plane.origin_mm, [0., 2., 2.]);
        assert_eq!(cutouts.members[0].member_id, "person-1");
        assert_eq!(
            cutouts.members[0].values,
            vec![-220., -221., -222., -210., -211., -212., -200., -201., -202.]
        );
        assert_eq!(cutouts.members[0].valid_pixels, 9);
        req.cutouts.as_mut().unwrap().member_ids = vec!["person-0".into()];
        req.focus_member_id = Some("person-1".into());
        let page = evaluate(&state, req.clone()).await;
        assert!(page.source_cache_hit);
        assert_eq!(page.cutouts.unwrap().members[0].values[4], 211.);
        req.crosshair_mm[2] = 0.;
        let navigated = evaluate(&state, req).await;
        assert_eq!(navigated.cutouts.unwrap().members[0].values[4], 211.);
        assert!(navigated.focused.iter().all(|v| *v >= -22.));
    }

    #[tokio::test]
    async fn population_cutouts_expose_shifted_patterns_and_missing_coverage() {
        let mut left = vec![0.; 27];
        left[12] = 8.;
        let mut right = vec![0.; 27];
        right[14] = 8.;
        let sources = vec![
            TestSource::new(&[3, 3, 3], &left),
            TestSource::new(&[3, 3, 3], &right),
            TestSource::new(&[3, 3, 3], &[f32::NAN; 27]),
        ];
        let state = BridgeState::default().unwrap();
        let mut req = request(&sources);
        req.cutouts = Some(CutoutRequest {
            center_mm: [1., 1., 1.],
            width_mm: 3.,
            dim_px: 3,
            member_ids: req.members.iter().map(|m| m.member_id.clone()).collect(),
        });
        let result = evaluate(&state, req.clone()).await;
        let cutouts = result.cutouts.unwrap();
        assert_eq!(cutouts.members[0].values[3], 8.);
        assert_eq!(cutouts.members[1].values[5], 8.);
        assert_eq!(cutouts.members[0].values[5], 0.);
        assert_eq!(cutouts.members[1].values[3], 0.);
        assert_eq!(cutouts.members[2].valid_pixels, 0);
        assert!(cutouts.members[2].values.iter().all(|v| v.is_nan()));
        assert!(result.summary.iter().all(|&v| v == 0. || v == 4.));
        req.cutouts.as_mut().unwrap().center_mm = [500.; 3];
        let outside = evaluate(&state, req.clone()).await;
        assert!(outside
            .cutouts
            .unwrap()
            .members
            .iter()
            .all(|m| m.valid_pixels == 0));
        req.cutouts
            .as_mut()
            .unwrap()
            .member_ids
            .push("unknown".into());
        assert!(validate(&req).is_err());
        req.cutouts.as_mut().unwrap().member_ids = vec!["person-0".into(); 97];
        assert!(validate(&req).is_err());
    }
}
