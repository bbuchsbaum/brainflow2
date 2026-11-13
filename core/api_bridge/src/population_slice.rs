//! Visible-support evaluation for observed population fields. The retained
//! plane matrix has a byte budget and never enters the volume/GPU registries.
mod display;
pub mod export;
pub mod inference;
pub mod mean_distance;
pub mod relationship;
pub mod replay;
mod retention;
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
/// Largest cutout edge. A cutout is sampled nearest-voxel, so an edge past the
/// image's own in-plane voxel count adds no detail; 256 covers a 1 mm brain.
const MAX_CUTOUT_DIM: u32 = 256;
/// Cutout values returned by one request, over all its members: each is one
/// f32 here and one number in the response (the picture and the hover value
/// are the same array). 2^20 values is 4 MiB of samples: 80 members at
/// 112 x 112, 64 at 128 x 128, 16 at 256 x 256.
const MAX_CUTOUT_VALUES: usize = 1 << 20;
/// Largest reported native edge (the request edge is still at most MAX_CUTOUT_DIM).
const MAX_NATIVE_DIM: u32 = 4096;
/// Voxels the rows may hold for a cutout square beyond the plane raster's own.
const MAX_COVER_VOXELS: usize = 1 << 20;

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SummaryKind {
    Mean,
    Median,
    Mad,
    SampleSd,
    MeanAbsolute,
    Cancellation,
    Coverage,
    /// One-sample t of the mean against zero: mean / (sample SD / sqrt(n))
    /// over the finite members; unavailable below two members or at zero spread.
    OneSampleT,
    /// Sign share: positive members / (positive + negative members), exact
    /// zeros (mostly outside the head) counted as neither; unavailable when no
    /// finite member is nonzero.
    PositiveFraction,
}
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Orientation {
    Axial,
    Coronal,
    Sagittal,
}
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PopulationSliceRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inference: Option<field_table::population_inference::Specification>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub groups: Vec<GroupRequest>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reference: Option<GroupRequest>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub difference: bool,
    /// Transport optimization only; never an exported calculation operand.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub focus_only: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub focus_window: Vec<String>,
    pub context_key: String,
    #[serde(default)]
    pub mask: Option<crate::population_mask::MaskSource>,
    pub members: Vec<SetMemberRef>,
    pub working_member_ids: Vec<String>,
    pub focus_member_id: Option<String>,
    /// Display-only frame override; cohort members retain their declared frames.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub focus_stack_index: Option<usize>,
    pub crosshair_mm: [f32; 3],
    pub orientation: Orientation,
    pub dim_px: [u32; 2],
    pub zoom: f32,
    pub summary: SummaryKind,
    #[serde(default)]
    pub aggregation: Option<ParticipantAggregation>,
    #[serde(default)]
    pub cutouts: Option<CutoutRequest>,
    /// Display-only anatomy under the maps; never a calculation operand.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub underlay: Option<display::UnderlayRequest>,
}
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupRequest {
    pub id: String,
    pub member_ids: Vec<String>,
    #[serde(default)]
    pub aggregation: Option<ParticipantAggregation>,
}
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupResult {
    pub id: String,
    pub values: Vec<f32>,
    pub valid_counts: Vec<u32>,
    pub unit_count: usize,
    pub eligible_count: usize,
    #[serde(skip)]
    means: Vec<f64>,
    #[serde(skip)]
    summaries: Vec<field_table::population::LocationSummary>,
}
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[derive(PartialEq, Eq)]
pub enum WithinParticipant {
    Single,
    Mean,
}
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParticipantGroup {
    pub participant_id: String,
    pub member_ids: Vec<String>,
}
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParticipantAggregation {
    pub within: WithinParticipant,
    pub groups: Vec<ParticipantGroup>,
}
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CutoutRequest {
    #[serde(default)]
    pub whole_plane: bool,
    pub center_mm: [f32; 3],
    /// Width and height of the square image edges, in world millimetres.
    pub width_mm: f32,
    /// Pixels along each edge. Zero asks for the image's own resolution (the
    /// voxels the edge spans), lowered only as far as the request's value
    /// budget requires for its members.
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
    /// Voxels the cutout's edge spans along its finer in-plane axis: the edge
    /// (in pixels) past which nearest-voxel sampling repeats voxels.
    pub native_dim_px: u32,
    pub members: Vec<CutoutMember>,
}
/// The square a request's cutouts cover. The plane's rows hold every voxel a
/// pixel of this square can fall in, so a cutout of any resolution is planned
/// from them without sampling the images again.
struct CutoutRegion {
    center_mm: [f32; 3],
    width_mm: f32,
    native_dim_px: u32,
}
/// One request's cutout raster over a cached plane.
struct CutoutPlan {
    plane: Plane,
    native_dim_px: u32,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inference: Option<inference::Channels>,
    pub groups: Vec<GroupResult>,
    pub reference: Option<GroupResult>,
    pub focus_window: Vec<CutoutMember>,
    pub plane: Plane,
    /// One voxel step along the plane's normal, in mm: the distance that moves
    /// the sampled slice to the next voxel layer of the population grid.
    pub normal_step_mm: f32,
    pub center_world: [f32; 3],
    pub context_range: Option<[f32; 2]>,
    /// The 98th percentile of |v| over every member's finite nonzero values
    /// on the sampled plane: the default symmetric colour limit of the
    /// set's maps (the strongest 2 % saturate, not the bulk). None when the
    /// plane holds no such value.
    pub context_magnitude: Option<f32>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub underlay: Option<display::UnderlayResult>,
    /// Why a requested underlay is missing; the maps are still valid.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub underlay_issue: Option<String>,
}
struct PixelPlan {
    plane: Plane,
    dimensions: Vec<usize>,
    affine: Matrix4<f32>,
    center_world: [f32; 3],
    voxels: Vec<[usize; 3]>,
    /// Row slot of each sampled voxel.
    index: HashMap<[usize; 3], usize>,
    /// Voxels the common mask leaves out, by row slot; None without a mask.
    outside_mask: Option<Vec<bool>>,
    pixels: Vec<Option<usize>>,
    cutouts: Option<CutoutRegion>,
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
    /// `PopulationSliceResult::context_magnitude`, computed once per plane.
    magnitude: Option<f32>,
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
        // The anatomy file is resolved (a template fetched if missing) before
        // admission, so a cold template cache never holds up other slices.
        // Focus-only reads sample it too when asked (the scatter peek draws
        // on it); the lens's own focus reads reuse the shown plane's and do
        // not ask.
        let underlay_path = match &request.underlay {
            Some(source) => Some(tokio::select! {
                _ = cancellation.cancelled() => return Err(crate::population_sampling::cancelled()),
                path = display::underlay_path(source, state) => path,
            }),
            _ => None,
        };
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
            // Not the cutouts' resolution: the rows cover the whole square, so
            // another tile size re-plans the cutouts and samples nothing.
            request
                .cutouts
                .as_ref()
                .map(|cutouts| (cutouts.center_mm, cutouts.width_mm, cutouts.whole_plane)),
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
        let focused_override = if let Some(frame) = request.focus_stack_index {
            let index = request
                .members
                .iter()
                .position(|m| Some(&m.member_id) == request.focus_member_id.as_ref())
                .ok_or_else(|| input("A focused frame requires an identified observation."))?;
            let mut member = request.members[index].clone();
            member.stack_index = Some(frame);
            member.expected_sha256 = Some(cached.sources[index].revision.sha256.clone());
            let path = crate::resolve_member_source_path(&member.source_path, state).await?;
            let plan = Arc::clone(&cached.plan);
            let token = cancellation.clone();
            Some(
                state
                    .set_sample_cache
                    .with_volume_cancelable(path, cancellation.clone(), move |volume, revision| {
                        // The plane's pixel map already excludes the common mask.
                        sample_row(volume, revision, &member, &plan, &token, None)
                    })
                    .await?,
            )
        } else {
            None
        };
        // The anatomy is sampled outside the retained plane matrix and only
        // with a full result; focus-only reads reuse the shown one.
        let cutout = match (&cached.plan.cutouts, &request.cutouts) {
            (Some(region), Some(spec)) if !request.focus_only => {
                Some(plan_cutout(&cached.plan, region, spec)?)
            }
            _ => None,
        };
        let underlay = match underlay_path {
            Some(path) => {
                let plan = &cached.plan;
                Some(
                    display::underlay(
                        path,
                        &plan.plane,
                        cutout.as_ref().map(|cutouts| &cutouts.plane),
                        (plan.dimensions.clone(), plan.affine),
                        state,
                        &cancellation,
                    )
                    .await?,
                )
            }
            None => None,
        };
        let guard = cached.guard.clone();
        let token = cancellation.clone();
        let result = tokio::task::spawn_blocking(move || {
            let _permit = permit; // A canceled async caller cannot release a running reduction.
            reduce_plane(
                &cached,
                &request,
                cache_hit,
                &cancellation,
                focused_override.as_deref(),
                cutout.as_ref(),
            )
        })
        .await
        .map_err(|error| input(format!("Population reduction failed: {error}")))??;
        guard.validate(token).await?;
        let mut result = result;
        match underlay {
            Some(Ok(underlay)) => result.underlay = Some(underlay),
            Some(Err(issue)) => result.underlay_issue = Some(issue),
            None => {}
        }
        Ok(result)
    }
}
/// Where a population view opens: the slice with the most summary signal
/// along the view normal. Outside slice admission and the plane cache, so the
/// search never delays a displayed slice. Null without signal or on failure.
pub async fn peak_slice(
    request: PopulationSliceRequest,
    state: &BridgeState,
    cancellation: SampleCancellation,
) -> BridgeResult<Option<[f32; 3]>> {
    validate(&request)?;
    display::peak_slice(&request, state, &cancellation).await
}
fn validate(request: &PopulationSliceRequest) -> BridgeResult<()> {
    if request.focus_stack_index.is_some()
        && (request.focus_member_id.is_none() || !request.focus_window.is_empty())
    {
        return Err(input(
            "A focused frame requires one observation and no canonical focus window.",
        ));
    }
    let window: HashSet<_> = request.focus_window.iter().collect();
    if window.len() != request.focus_window.len()
        || window.len() > 8
        || window
            .iter()
            .any(|id| !request.members.iter().any(|m| &m.member_id == *id))
    {
        return Err(input(
            "Focus window requires at most eight unique context observations.",
        ));
    }
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
    // The plane's rows: one value per member and sampled voxel, of which the
    // raster has at most one per pixel. A cutout adds no rows of its own
    // (its pixels read the same voxels; `build_plane` checks the voxels it
    // really adds) and returns values for its own members only, bounded by
    // MAX_CUTOUT_VALUES below.
    let bytes = pixels
        .checked_mul(request.members.len())
        .and_then(|n| n.checked_mul(4))
        .ok_or_else(|| input("Population plane size overflow."))?;
    if bytes > MAX_BYTES {
        return Err(input("Visible observation samples exceed the 128 MiB plane budget; reduce raster size or context."));
    }
    let ids: HashSet<_> = request.members.iter().map(|m| &m.member_id).collect();
    if let Some(cutouts) = &request.cutouts {
        let cutout_ids: HashSet<_> = cutouts.member_ids.iter().collect();
        if cutouts.dim_px > MAX_CUTOUT_DIM
            || cutouts.member_ids.is_empty()
            || cutouts.member_ids.len() > MAX_CUTOUT_MEMBERS
            || cutout_pixels.saturating_mul(cutouts.member_ids.len()) > MAX_CUTOUT_VALUES
            || cutout_ids.len() != cutouts.member_ids.len()
            || cutout_ids.iter().any(|id| !ids.contains(id))
            || !cutouts.center_mm.iter().all(|v| v.is_finite())
            || !cutouts.width_mm.is_finite()
            || !(1.0..=200.0).contains(&cutouts.width_mm)
        {
            return Err(input("Cutouts require 1-96 unique eligible observations, a square of up to 256 pixels (0: the image's own resolution), at most 1048576 values in all, finite center, and width from 1 to 200 mm."));
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
    inference::validate(request)?;
    if request.groups.len() > 4
        || request
            .groups
            .iter()
            .map(|g| &g.id)
            .collect::<HashSet<_>>()
            .len()
            != request.groups.len()
    {
        return Err(input(
            "At most four uniquely identified group summaries can be displayed at once.",
        ));
    }
    if request.difference
        && (!matches!(request.summary, SummaryKind::Mean)
            || request.reference.is_none()
            || selected.is_empty())
    {
        return Err(input(
            "A descriptive difference requires A and B and the mean reducer.",
        ));
    }
    for group in request.groups.iter().chain(request.reference.iter()) {
        if group.id.trim().is_empty() || group.member_ids.is_empty() {
            return Err(input(
                "Group summaries require a name and nonempty membership.",
            ));
        }
        if !match (&request.aggregation, &group.aggregation) {
            (None, None) => true,
            (Some(a), Some(b)) => a.within == b.within,
            _ => false,
        } {
            return Err(input(
                "Group summaries must use the declared analysis unit.",
            ));
        }
        let mut child = request.clone();
        child.inference = None;
        child.groups.clear();
        child.reference = None;
        child.difference = false;
        child.working_member_ids = group.member_ids.clone();
        child.aggregation = group.aggregation.clone();
        validate(&child)?;
    }
    let mut identities = std::collections::HashMap::new();
    for aggregation in request.aggregation.iter().chain(
        request
            .groups
            .iter()
            .chain(request.reference.iter())
            .filter_map(|g| g.aggregation.as_ref()),
    ) {
        for group in &aggregation.groups {
            for member in &group.member_ids {
                if identities
                    .insert(member, &group.participant_id)
                    .is_some_and(|previous| previous != &group.participant_id)
                {
                    return Err(input(
                        "An observation must identify the same participant in every group.",
                    ));
                }
            }
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
        let length = |v: [f32; 3]| v.iter().map(|v| v * v).sum::<f32>().sqrt();
        let width = if cutouts.whole_plane {
            (length(geometry.u_mm) * geometry.dim_px[0] as f32)
                .max(length(geometry.v_mm) * geometry.dim_px[1] as f32)
        } else {
            cutouts.width_mm
        };
        let center: [f32; 3] = if cutouts.whole_plane {
            std::array::from_fn(|axis| {
                geometry.origin_mm[axis]
                    + geometry.u_mm[axis] * (geometry.dim_px[0] - 1) as f32 / 2.
                    + geometry.v_mm[axis] * (geometry.dim_px[1] - 1) as f32 / 2.
            })
        } else {
            cutouts.center_mm
        };
        // Voxels per millimetre along each edge, from the grid's own affine.
        let unit = |direction: [f32; 3]| direction.map(|v| v / length(direction));
        let voxels_per_mm = |direction: [f32; 3]| {
            let unit = unit(direction);
            let from = inverse.transform_point(&Point3::from(center));
            let to =
                inverse.transform_point(&Point3::from(std::array::from_fn::<f32, 3, _>(|axis| {
                    center[axis] + unit[axis]
                })));
            (to - from).norm()
        };
        let native =
            (width * voxels_per_mm(geometry.u_mm).max(voxels_per_mm(geometry.v_mm))).ceil();
        let native_dim_px = if native.is_finite() {
            native.clamp(1.0, MAX_NATIVE_DIM as f32) as u32
        } else {
            1
        };
        // Every voxel a pixel of the square can fall in, at any resolution:
        // nearest-voxel rounding is monotonic, so those voxels lie in the box
        // spanned by the rounded corners of the square.
        let (u, v) = (unit(geometry.u_mm), unit(geometry.v_mm));
        let mut low = [f32::INFINITY; 3];
        let mut high = [f32::NEG_INFINITY; 3];
        for (su, sv) in [(-0.5, -0.5), (0.5, -0.5), (-0.5, 0.5), (0.5, 0.5)] {
            let corner =
                inverse.transform_point(&Point3::from(std::array::from_fn::<f32, 3, _>(|axis| {
                    center[axis] + width * (su * u[axis] + sv * v[axis])
                })));
            for (axis, value) in [corner.x, corner.y, corner.z].into_iter().enumerate() {
                low[axis] = low[axis].min(value.round());
                high[axis] = high[axis].max(value.round());
            }
        }
        let range: [Option<(usize, usize)>; 3] = std::array::from_fn(|axis| {
            let first = low[axis].max(0.0);
            let last = high[axis].min(dimensions[axis] as f32 - 1.0);
            (first.is_finite() && last.is_finite() && first <= last)
                .then_some((first as usize, last as usize))
        });
        if let [Some(x), Some(y), Some(z)] = range {
            let count = (x.1 - x.0 + 1)
                .saturating_mul(y.1 - y.0 + 1)
                .saturating_mul(z.1 - z.0 + 1);
            if count <= MAX_COVER_VOXELS {
                for k in z.0..=z.1 {
                    for j in y.0..=y.1 {
                        for i in x.0..=x.1 {
                            index.entry([i, j, k]).or_insert_with(|| {
                                voxels.push([i, j, k]);
                                voxels.len() - 1
                            });
                        }
                    }
                }
            }
            // A square steeply oblique to the grid spans too many voxels to
            // hold: its cutouts then read the plane raster's voxels alone.
        }
        CutoutRegion {
            center_mm: center,
            width_mm: width,
            native_dim_px,
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
        index,
        outside_mask: None,
        pixels,
        cutouts,
    })
}
/// The distance along `plane`'s normal that moves one voxel layer through the
/// grid of `affine` (voxel to world): `1 / max_a |(A⁻¹ n)_a|`, so an
/// axis-aligned slice steps by that axis's voxel size and an oblique one by
/// the smallest move that changes some voxel index by one. 1 mm when the
/// plane or the grid is degenerate.
fn normal_step_mm(plane: &Plane, affine: &Matrix4<f32>) -> f32 {
    let u = nalgebra::Vector3::from(plane.u_mm);
    let v = nalgebra::Vector3::from(plane.v_mm);
    let normal = u.cross(&v);
    let Some(normal) = normal.try_normalize(f32::EPSILON) else {
        return 1.0;
    };
    let linear = affine.fixed_view::<3, 3>(0, 0).into_owned();
    let Some(inverse) = linear.try_inverse() else {
        return 1.0;
    };
    let per_mm = (inverse * normal).amax();
    if per_mm.is_finite() && per_mm > 0.0 {
        1.0 / per_mm
    } else {
        1.0
    }
}

/// The edge a request's cutouts are sampled at: what it asks for, or (zero)
/// the image's own resolution, lowered only as far as the value budget
/// requires for the request's members.
fn cutout_dim(spec: &CutoutRequest, native_dim_px: u32) -> u32 {
    if spec.dim_px > 0 {
        return spec.dim_px;
    }
    let per_member = MAX_CUTOUT_VALUES / spec.member_ids.len().max(1);
    let fits = (per_member as f64).sqrt().floor() as u32;
    native_dim_px.min(MAX_CUTOUT_DIM).min(fits).max(1)
}
/// One request's cutout raster over the cached plane: each pixel reads the row
/// slot of its nearest voxel. No image is opened.
fn plan_cutout(
    plan: &PixelPlan,
    region: &CutoutRegion,
    spec: &CutoutRequest,
) -> BridgeResult<CutoutPlan> {
    let length = |v: [f32; 3]| v.iter().map(|v| v * v).sum::<f32>().sqrt();
    let inverse = plan
        .affine
        .try_inverse()
        .ok_or_else(|| input("Invalid population affine."))?;
    let dim = cutout_dim(spec, region.native_dim_px);
    let spacing = region.width_mm / dim as f32;
    let u_mm = plan
        .plane
        .u_mm
        .map(|v| v * spacing / length(plan.plane.u_mm));
    let v_mm = plan
        .plane
        .v_mm
        .map(|v| v * spacing / length(plan.plane.v_mm));
    let origin_mm = std::array::from_fn(|axis| {
        region.center_mm[axis] - (u_mm[axis] + v_mm[axis]) * (dim - 1) as f32 / 2.0
    });
    let mut pixels = Vec::with_capacity(dim as usize * dim as usize);
    for y in 0..dim {
        for x in 0..dim {
            let world = std::array::from_fn(|axis| {
                origin_mm[axis] + x as f32 * u_mm[axis] + y as f32 * v_mm[axis]
            });
            let point = inverse.transform_point(&Point3::from(world));
            let rounded = [point.x.round(), point.y.round(), point.z.round()];
            let slot = if (0..3).any(|axis| {
                !rounded[axis].is_finite()
                    || rounded[axis] < 0.0
                    || rounded[axis] >= plan.dimensions[axis] as f32
            }) {
                None
            } else {
                plan.index
                    .get(&rounded.map(|value| value as usize))
                    .copied()
                    .filter(|&slot| {
                        plan.outside_mask
                            .as_ref()
                            .is_none_or(|outside| !outside[slot])
                    })
            };
            pixels.push(slot);
        }
    }
    Ok(CutoutPlan {
        plane: Plane {
            origin_mm,
            u_mm,
            v_mm,
            dim_px: [dim; 2],
        },
        native_dim_px: region.native_dim_px,
        pixels,
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
    // The Set studio grid audit (`field_table`'s `TableSupportSignature`)
    // decides "one grid" from headers through this same comparison, so a set
    // it passes is not refused here for its grid.
    if dimensions != plan.dimensions || !nifti_loader::affines_match(&affine, &plan.affine) {
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
    let members = request.members.len();
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
                    plan.outside_mask = Some(
                        plan.voxels
                            .iter()
                            .map(|&[x, y, z]| !mask.includes(x, y, z))
                            .collect(),
                    );
                }
                // What the rows will hold: one value per member and sampled voxel.
                if plan
                    .voxels
                    .len()
                    .saturating_mul(members)
                    .saturating_mul(4)
                    > MAX_BYTES
                {
                    return Err(input(
                        "Visible observation samples exceed the 128 MiB plane budget; reduce raster size or context.",
                    ));
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
        + plan.index.capacity() * std::mem::size_of::<([usize; 3], usize)>()
        + plan.pixels.capacity() * std::mem::size_of::<Option<usize>>();
    if bytes > MAX_BYTES {
        return Err(input("Population plane exceeds its retained byte budget."));
    }
    let (rows, magnitude) = context_magnitude(rows).await?;
    Ok(CachedPlane {
        key,
        context_key: request.context_key.clone(),
        plan,
        rows,
        sources,
        mask_revision,
        guard,
        bytes,
        magnitude,
    })
}
/// The quantile of |v| the set's default colour limit sits at.
const CONTEXT_MAGNITUDE_QUANTILE: f64 = 0.98;
/// Rows up to this many values are reduced on the async task; larger ones
/// (up to the 128 MiB plane budget: 32 Mi values, copied and partially sorted)
/// on the blocking pool, so the quantile never stalls the async runtime.
const INLINE_MAGNITUDE_VALUES: usize = 1 << 16;
/// The set's context magnitude (`magnitude_quantile` at
/// `CONTEXT_MAGNITUDE_QUANTILE`), off the async runtime for large planes. The
/// rows are handed back unchanged; the value is exactly `magnitude_quantile`'s.
async fn context_magnitude(rows: Vec<Vec<f32>>) -> BridgeResult<(Vec<Vec<f32>>, Option<f32>)> {
    let values: usize = rows.iter().map(Vec::len).sum();
    if values <= INLINE_MAGNITUDE_VALUES {
        let magnitude = magnitude_quantile(&rows, CONTEXT_MAGNITUDE_QUANTILE);
        return Ok((rows, magnitude));
    }
    tokio::task::spawn_blocking(move || {
        let magnitude = magnitude_quantile(&rows, CONTEXT_MAGNITUDE_QUANTILE);
        (rows, magnitude)
    })
    .await
    .map_err(|error| input(format!("Population context magnitude failed: {error}")))
}
/// The `q` quantile of |v| over the finite nonzero values of `rows` (zeros
/// are mostly outside the head and would pull a sparse map's limit to
/// nothing); None when there are none.
fn magnitude_quantile(rows: &[Vec<f32>], q: f64) -> Option<f32> {
    let mut magnitudes: Vec<f32> = rows
        .iter()
        .flatten()
        .filter(|v| v.is_finite() && **v != 0.0)
        .map(|v| v.abs())
        .collect();
    if magnitudes.is_empty() {
        return None;
    }
    let rank = ((q * magnitudes.len() as f64).floor() as usize).min(magnitudes.len() - 1);
    let (_, value, _) = magnitudes.select_nth_unstable_by(rank, f32::total_cmp);
    Some(*value)
}
fn collect_moments(
    cached: &CachedPlane,
    members: &[String],
    aggregation: &Option<ParticipantAggregation>,
    cancellation: &SampleCancellation,
) -> BridgeResult<FieldMoments> {
    let selected: HashSet<_> = members.iter().collect();
    // A view fully outside the volume has no native samples; its entire raster
    // is unavailable. One dummy accumulator location keeps that case explicit.
    let mut moments = FieldMoments::new(cached.plan.voxels.len().max(1), 0.0)
        .map_err(|e| input(e.to_string()))?;
    if !cached.plan.voxels.is_empty() {
        if let Some(aggregation) = aggregation {
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
    Ok(moments)
}
fn robust_plane(
    cached: &CachedPlane,
    request: &PopulationSliceRequest,
    token: &SampleCancellation,
) -> BridgeResult<Vec<(Option<f64>, Option<f64>)>> {
    let indices: HashMap<_, _> = cached
        .sources
        .iter()
        .enumerate()
        .map(|(i, s)| (&s.member_id, i))
        .collect();
    let groups: Vec<Vec<usize>> = if let Some(aggregation) = &request.aggregation {
        aggregation
            .groups
            .iter()
            .map(|g| g.member_ids.iter().map(|id| indices[id]).collect())
            .collect()
    } else {
        request
            .working_member_ids
            .iter()
            .map(|id| vec![indices[id]])
            .collect()
    };
    (0..cached.plan.voxels.len())
        .map(|j| {
            if j % 4096 == 0 {
                token.check()?;
            }
            Ok(field_table::population::median_mad(groups.iter().map(
                |g| {
                    let (mut n, mut mean) = (0, 0.);
                    for &i in g {
                        let v = cached.rows[i][j];
                        if v.is_finite() {
                            n += 1;
                            mean += (v as f64 - mean) / n as f64;
                        }
                    }
                    if n > 0 {
                        mean
                    } else {
                        f64::NAN
                    }
                },
            )))
        })
        .collect()
}
/// One-sample t of a location's mean against zero (finite members only).
fn one_sample_t(s: &field_table::population::LocationSummary) -> Option<f64> {
    let (mean, sd) = (s.mean?, s.sample_sd?);
    if s.valid_count < 2 || sd.is_nan() || sd <= 0.0 {
        return None;
    }
    let t = mean / (sd / (s.valid_count as f64).sqrt());
    t.is_finite().then_some(t)
}
/// Share of a location's signed (nonzero) finite members that are positive.
fn positive_fraction(s: &field_table::population::LocationSummary) -> Option<f64> {
    let signed = s.signs.positive + s.signs.negative;
    (signed > 0).then(|| s.signs.positive as f64 / signed as f64)
}
fn reduce_group(
    cached: &CachedPlane,
    group: &GroupRequest,
    cancellation: &SampleCancellation,
) -> BridgeResult<GroupResult> {
    let moments = collect_moments(cached, &group.member_ids, &group.aggregation, cancellation)?;
    let summaries: Vec<_> = moments.summaries().collect();
    let means: Vec<_> = cached
        .plan
        .pixels
        .iter()
        .map(|slot| slot.and_then(|i| summaries[i].mean).unwrap_or(f64::NAN))
        .collect();
    let valid_counts = cached
        .plan
        .pixels
        .iter()
        .map(|slot| slot.map(|i| summaries[i].valid_count as u32).unwrap_or(0))
        .collect();
    Ok(GroupResult {
        id: group.id.clone(),
        values: means.iter().map(|&v| v as f32).collect(),
        means,
        summaries,
        valid_counts,
        unit_count: group
            .aggregation
            .as_ref()
            .map_or(group.member_ids.len(), |a| a.groups.len()),
        eligible_count: group.member_ids.len(),
    })
}
fn reduce_plane(
    cached: &CachedPlane,
    request: &PopulationSliceRequest,
    cache_hit: bool,
    cancellation: &SampleCancellation,
    focused_override: Option<&[f32]>,
    cutout: Option<&CutoutPlan>,
) -> BridgeResult<PopulationSliceResult> {
    let selected: HashSet<_> = request.working_member_ids.iter().collect();
    let focus = request
        .focus_member_id
        .as_ref()
        .and_then(|id| cached.sources.iter().position(|s| &s.member_id == id));
    let moments = if request.focus_only {
        FieldMoments::new(1, 0.0).map_err(|e| input(e.to_string()))?
    } else {
        collect_moments(
            cached,
            &request.working_member_ids,
            &request.aggregation,
            cancellation,
        )?
    };
    let reference = if request.focus_only {
        None
    } else {
        request
            .reference
            .as_ref()
            .map(|g| reduce_group(cached, g, cancellation))
            .transpose()?
    };
    let groups = if request.focus_only {
        Vec::new()
    } else {
        request
            .groups
            .iter()
            .map(|g| reduce_group(cached, g, cancellation))
            .collect::<BridgeResult<Vec<_>>>()?
    };
    let summaries: Vec<_> = moments.summaries().collect();
    let inference = request
        .inference
        .as_ref()
        .filter(|_| !request.focus_only)
        .map(|spec| {
            inference::channels(
                cached,
                request,
                cancellation,
                &summaries,
                reference.as_ref().map(|r| r.summaries.as_slice()),
                &cached.plan.pixels,
                spec,
            )
        })
        .transpose()?;
    let robust = if !request.focus_only
        && matches!(request.summary, SummaryKind::Median | SummaryKind::Mad)
    {
        Some(robust_plane(cached, request, cancellation)?)
    } else {
        None
    };
    let mut summary = Vec::with_capacity(cached.plan.pixels.len());
    let mut focused = Vec::with_capacity(summary.capacity());
    let mut valid_counts = Vec::with_capacity(summary.capacity());
    for (pixel, slot) in cached.plan.pixels.iter().enumerate() {
        if pixel % 4096 == 0 {
            cancellation.check()?;
        }
        if !request.focus_only {
            let value = slot.and_then(|index| {
                let s = &summaries[index];
                match request.summary {
                    SummaryKind::Mean => s.mean,
                    SummaryKind::Median => robust.as_ref().and_then(|r| r[index].0),
                    SummaryKind::Mad => robust.as_ref().and_then(|r| r[index].1),
                    SummaryKind::SampleSd => s.sample_sd,
                    SummaryKind::MeanAbsolute => s.mean_absolute,
                    SummaryKind::Cancellation => s.cancellation,
                    SummaryKind::Coverage => Some(s.valid_count as f64),
                    SummaryKind::OneSampleT => one_sample_t(s),
                    SummaryKind::PositiveFraction => positive_fraction(s),
                }
            });
            let value = if let Some(channels) = &inference {
                channels.selected(&request.inference.as_ref().unwrap().channel)[pixel]
                    .map(f64::from)
            } else if request.difference {
                value.and_then(|a| {
                    let b = reference.as_ref().unwrap().means[pixel];
                    b.is_finite().then_some(a - b)
                })
            } else {
                value
            };
            summary.push(value.map(|v| v as f32).unwrap_or(f32::NAN));
            valid_counts.push(
                slot.map(|index| summaries[index].valid_count as u32)
                    .unwrap_or(0),
            );
        }
        focused.push(
            slot.and_then(|index| {
                focus.map(|focus| focused_override.unwrap_or(&cached.rows[focus])[index])
            })
            .unwrap_or(f32::NAN),
        );
    }
    let cutouts = match (cutout, &request.cutouts) {
        (Some(plan), Some(spec)) if !request.focus_only => {
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
                native_dim_px: plan.native_dim_px,
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
    let mut focus_window = Vec::new();
    for id in &request.focus_window {
        cancellation.check()?;
        let row = cached
            .sources
            .iter()
            .position(|s| &s.member_id == id)
            .unwrap();
        let values: Vec<_> = cached
            .plan
            .pixels
            .iter()
            .map(|slot| slot.map(|i| cached.rows[row][i]).unwrap_or(f32::NAN))
            .collect();
        let valid_pixels = values.iter().filter(|v| v.is_finite()).count();
        focus_window.push(CutoutMember {
            member_id: id.clone(),
            values,
            valid_pixels,
        });
    }
    Ok(PopulationSliceResult {
        inference,
        groups,
        reference,
        focus_window,
        cutouts,
        context_range: range,
        context_magnitude: cached.magnitude,
        plane: cached.plan.plane.clone(),
        normal_step_mm: normal_step_mm(&cached.plan.plane, &cached.plan.affine),
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
        underlay: None,
        underlay_issue: None,
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
            inference: None,
            groups: vec![],
            reference: None,
            difference: false,
            focus_only: false,
            focus_window: vec![],
            mask: None,
            context_key: "workspace:dataset:revision".into(),
            working_member_ids: members.iter().map(|m| m.member_id.clone()).collect(),
            focus_member_id: Some(members[0].member_id.clone()),
            focus_stack_index: None,
            members,
            crosshair_mm: [1., 1., 1.],
            orientation: Orientation::Axial,
            dim_px: [3, 3],
            zoom: 1.,
            summary: SummaryKind::Mean,
            aggregation: None,
            cutouts: None,
            underlay: None,
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

    #[test]
    fn normal_step_is_one_voxel_layer_along_the_slice_normal() {
        // Voxels of 2 × 3 × 4 mm with an origin offset (the translation is ignored).
        let affine = Matrix4::new(
            2.0, 0.0, 0.0, -90.0, //
            0.0, 3.0, 0.0, -126.0, //
            0.0, 0.0, 4.0, -72.0, //
            0.0, 0.0, 0.0, 1.0,
        );
        let plane = |u: [f32; 3], v: [f32; 3]| Plane {
            origin_mm: [0.0; 3],
            u_mm: u,
            v_mm: v,
            dim_px: [8, 8],
        };
        let close = |a: f32, b: f32| (a - b).abs() < 1e-5;
        // Axial (normal z), coronal (normal y), sagittal (normal x); in-plane
        // pixel size and sign do not matter.
        assert!(close(
            normal_step_mm(&plane([0.5, 0.0, 0.0], [0.0, -0.5, 0.0]), &affine),
            4.0
        ));
        assert!(close(
            normal_step_mm(&plane([1.0, 0.0, 0.0], [0.0, 0.0, -1.0]), &affine),
            3.0
        ));
        assert!(close(
            normal_step_mm(&plane([0.0, 1.0, 0.0], [0.0, 0.0, 1.0]), &affine),
            2.0
        ));
        // Oblique (normal (0, 1, 1)/√2): the smallest move that changes an
        // index by one is along y, 3·√2 mm.
        let oblique = plane([1.0, 0.0, 0.0], [0.0, -1.0, 1.0]);
        assert!(close(normal_step_mm(&oblique, &affine), 3.0 * 2f32.sqrt()));
        // Degenerate plane or grid: 1 mm.
        assert_eq!(
            normal_step_mm(&plane([1.0, 0.0, 0.0], [2.0, 0.0, 0.0]), &affine),
            1.0
        );
        assert_eq!(
            normal_step_mm(&plane([1.0, 0.0, 0.0], [0.0, 1.0, 0.0]), &Matrix4::zeros()),
            1.0
        );
    }

    #[test]
    fn population_context_magnitude_is_a_quantile_of_absolute_nonzero_values() {
        // 100 values of |v| 1..=100 (signs alternate), plus zeros and NaNs ignored.
        let mut a: Vec<f32> = (1..=50).map(|v| -(v as f32 * 2.0 - 1.0)).collect();
        a.extend([0.0, f32::NAN]);
        let mut b: Vec<f32> = (1..=50).map(|v| v as f32 * 2.0).collect();
        b.push(f32::INFINITY);
        let q = magnitude_quantile(&[a, b], 0.98).unwrap();
        assert_eq!(q, 99.0);
        // The most negative value counts by its magnitude.
        let q = magnitude_quantile(&[vec![-10.0, 1.0, 1.0, 1.0]], 0.98).unwrap();
        assert_eq!(q, 10.0);
        assert_eq!(magnitude_quantile(&[vec![0.0, f32::NAN]], 0.98), None);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn population_context_magnitude_matches_the_quantile_and_yields_on_large_planes() {
        // Small planes: the same value, inline, rows handed back unchanged.
        let small = vec![vec![-10.0, 1.0, 1.0, 1.0], vec![0.0, f32::NAN]];
        let (rows, magnitude) = context_magnitude(small.clone()).await.unwrap();
        assert_eq!(
            magnitude,
            magnitude_quantile(&small, CONTEXT_MAGNITUDE_QUANTILE)
        );
        assert_eq!(rows.len(), small.len());
        assert_eq!(rows[0], small[0]);
        // Large planes: the async runtime keeps running while the quantile is
        // taken (a task spawned before it gets to run before it returns).
        let large: Vec<Vec<f32>> = (0..4)
            .map(|row| {
                (0..1_000_000)
                    .map(|i| ((i * 7 + row) % 1_000) as f32 - 500.0)
                    .collect()
            })
            .collect();
        let expected = magnitude_quantile(&large, CONTEXT_MAGNITUDE_QUANTILE);
        let ticked = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let flag = std::sync::Arc::clone(&ticked);
        let ticker = tokio::spawn(async move {
            flag.store(true, std::sync::atomic::Ordering::SeqCst);
        });
        let (rows, magnitude) = context_magnitude(large).await.unwrap();
        assert!(
            ticked.load(std::sync::atomic::Ordering::SeqCst),
            "the runtime was blocked while the context magnitude was taken"
        );
        assert_eq!(magnitude, expected);
        assert_eq!(rows.len(), 4);
        assert_eq!(rows[0].len(), 1_000_000);
        ticker.await.unwrap();
    }

    #[tokio::test]
    async fn population_group_difference_preserves_local_counts_and_overlap() {
        let sources = vec![
            TestSource::new(&[3, 3, 3], &[2.; 27]),
            TestSource::new(&[3, 3, 3], &[6.; 27]),
            TestSource::new(&[3, 3, 3], &[f32::NAN; 27]),
        ];
        let state = BridgeState::default().unwrap();
        let mut q = request(&sources);
        q.working_member_ids = vec!["person-0".into(), "person-2".into()];
        q.reference = Some(GroupRequest {
            id: "B".into(),
            member_ids: vec!["person-0".into(), "person-1".into()],
            aggregation: None,
        });
        q.groups = vec![q.reference.clone().unwrap()];
        q.difference = true;
        let result = evaluate(&state, q.clone()).await;
        assert_eq!(result.summary, vec![-2.; 9]);
        assert_eq!(result.valid_counts, vec![1; 9]);
        assert_eq!(result.reference.as_ref().unwrap().valid_counts, vec![2; 9]);
        assert_eq!(result.groups[0].values, vec![4.; 9]);
        q.reference.as_mut().unwrap().member_ids = vec!["person-2".into()];
        let missing = evaluate(&state, q).await;
        assert!(missing.summary.iter().all(|v| v.is_nan()));
        assert!(missing.source_cache_hit);
        assert_eq!(missing.reference.unwrap().valid_counts, vec![0; 9]);
    }

    #[tokio::test]
    async fn population_group_difference_subtracts_before_float32_rounding() {
        let sources = vec![
            TestSource::new(&[3, 3, 3], &[16_777_216.; 27]),
            TestSource::new(&[3, 3, 3], &[16_777_218.; 27]),
        ];
        let state = BridgeState::default().unwrap();
        let mut q = request(&sources);
        q.reference = Some(GroupRequest {
            id: "B".into(),
            member_ids: vec!["person-0".into()],
            aggregation: None,
        });
        q.difference = true;
        assert_eq!(evaluate(&state, q).await.summary, vec![1.; 9]);
    }

    #[tokio::test]
    async fn population_group_participant_policy_is_consistent_across_operands() {
        let sources = vec![
            TestSource::new(&[3, 3, 3], &[0.; 27]),
            TestSource::new(&[3, 3, 3], &[4.; 27]),
            TestSource::new(&[3, 3, 3], &[8.; 27]),
        ];
        let state = BridgeState::default().unwrap();
        let mut q = request(&sources);
        q.aggregation = Some(ParticipantAggregation {
            within: WithinParticipant::Mean,
            groups: vec![
                ParticipantGroup {
                    participant_id: "P".into(),
                    member_ids: vec!["person-0".into(), "person-1".into()],
                },
                ParticipantGroup {
                    participant_id: "Q".into(),
                    member_ids: vec!["person-2".into()],
                },
            ],
        });
        q.reference = Some(GroupRequest {
            id: "B".into(),
            member_ids: vec!["person-0".into()],
            aggregation: Some(ParticipantAggregation {
                within: WithinParticipant::Mean,
                groups: vec![ParticipantGroup {
                    participant_id: "P".into(),
                    member_ids: vec!["person-0".into()],
                }],
            }),
        });
        q.difference = true;
        assert_eq!(evaluate(&state, q.clone()).await.summary, vec![5.; 9]);
        q.reference
            .as_mut()
            .unwrap()
            .aggregation
            .as_mut()
            .unwrap()
            .groups[0]
            .participant_id = "other".into();
        assert!(validate(&q).is_err());
        q.reference.as_mut().unwrap().aggregation = None;
        assert!(validate(&q).is_err());
        q.reference = None;
        q.difference = false;
        q.aggregation = None;
        q.groups = (0..5)
            .map(|i| GroupRequest {
                id: i.to_string(),
                member_ids: vec!["person-0".into()],
                aggregation: None,
            })
            .collect();
        assert!(validate(&q).is_err());
    }

    #[tokio::test]
    async fn population_cutouts_report_native_resolution_and_keep_values_exact_above_it() {
        // Voxel value = 100 x + 10 y + z on a 3 x 3 x 3 identity grid.
        let ramp: Vec<f32> = (0..27)
            .map(|i| (i % 3) as f32 * 100. + ((i / 3) % 3) as f32 * 10. + (i / 9) as f32)
            .collect();
        let sources = vec![TestSource::new(&[3, 3, 3], &ramp)];
        let state = BridgeState::default().unwrap();
        let mut q = request(&sources);
        q.cutouts = Some(CutoutRequest {
            whole_plane: false,
            center_mm: [1.; 3],
            width_mm: 3.,
            // Four pixels per voxel: above the grid's own resolution.
            dim_px: 12,
            member_ids: vec!["person-0".into()],
        });
        let result = evaluate(&state, q.clone()).await;
        let cutouts = result.cutouts.as_ref().unwrap();
        // The 3 mm edge spans three 1 mm voxels.
        assert_eq!(cutouts.native_dim_px, 3);
        assert_eq!(cutouts.plane.dim_px, [12, 12]);
        // Square pixels of a quarter millimetre, on the main plane's axes.
        let length = |v: [f32; 3]| v.iter().map(|v| v * v).sum::<f32>().sqrt();
        assert!((length(cutouts.plane.u_mm) - 0.25).abs() < 1e-6);
        assert!((length(cutouts.plane.v_mm) - 0.25).abs() < 1e-6);
        let unit = |v: [f32; 3]| v.map(|x| x / length(v));
        assert_eq!(unit(cutouts.plane.u_mm), unit(result.plane.u_mm));
        assert_eq!(unit(cutouts.plane.v_mm), unit(result.plane.v_mm));
        // Every pixel holds the value of the voxel its centre falls in: the
        // value a hover reads is the value drawn, at any resolution.
        let values = &cutouts.members[0].values;
        assert_eq!(values.len(), 144);
        let mut inside = 0;
        for y in 0..12u32 {
            for x in 0..12u32 {
                let world = neuro_types::pixel_to_world_raw(
                    cutouts.plane.origin_mm,
                    cutouts.plane.u_mm,
                    cutouts.plane.v_mm,
                    x as f32,
                    y as f32,
                );
                let voxel = world.map(|v| v.round());
                let value = values[(y * 12 + x) as usize];
                if voxel.iter().all(|v| (0.0..=2.0).contains(v)) {
                    assert_eq!(value, voxel[0] * 100. + voxel[1] * 10. + voxel[2]);
                    inside += 1;
                } else {
                    assert!(value.is_nan());
                }
            }
        }
        assert!(inside >= 100);
        // A whole-plane cutout reports the voxels its own edge spans.
        q.cutouts.as_mut().unwrap().whole_plane = true;
        let whole = evaluate(&state, q).await;
        let whole = whole.cutouts.as_ref().unwrap();
        let edge = length(whole.plane.u_mm) * 12.;
        assert_eq!(whole.native_dim_px, edge.ceil() as u32);
    }

    #[tokio::test]
    async fn population_cutouts_are_bounded_by_edge_and_by_values_per_request() {
        let sources: Vec<_> = (0..17)
            .map(|_| TestSource::new(&[3, 3, 3], &[1.; 27]))
            .collect();
        let state = BridgeState::default().unwrap();
        let cutouts = |dim_px: u32, members: usize| CutoutRequest {
            whole_plane: false,
            center_mm: [1.; 3],
            width_mm: 3.,
            dim_px,
            member_ids: (0..members).map(|i| format!("person-{i}")).collect(),
        };
        let refused = |q: PopulationSliceRequest| {
            let state = &state;
            async move {
                state
                    .population_slice
                    .evaluate(q, state, SampleCancellation::default())
                    .await
                    .is_err()
            }
        };
        // 16 members at 256 x 256 is exactly the budget of 2^20 values.
        assert_eq!(16 * 256 * 256, MAX_CUTOUT_VALUES);
        let mut q = request(&sources);
        q.cutouts = Some(cutouts(256, 16));
        let result = evaluate(&state, q.clone()).await;
        let returned = result.cutouts.as_ref().unwrap();
        assert_eq!(returned.members.len(), 16);
        assert!(returned.members.iter().all(|m| m.values.len() == 256 * 256));
        // One member more is over it; so is an edge past the limit.
        q.cutouts = Some(cutouts(256, 17));
        assert!(refused(q.clone()).await);
        q.cutouts = Some(cutouts(257, 1));
        assert!(refused(q.clone()).await);
        // Fewer pixels buy more members: 17 fit easily at 128 x 128.
        q.cutouts = Some(cutouts(128, 17));
        assert_eq!(evaluate(&state, q).await.cutouts.unwrap().members.len(), 17);
    }

    #[test]
    fn population_plane_budget_counts_rows_not_cutout_pixels_for_every_member() {
        // 300 subjects on a 256 x 256 raster: 300 x 65536 x 4 bytes = 75 MiB of rows.
        let members: Vec<_> = (0..300)
            .map(|i| SetMemberRef {
                member_id: format!("S{i:03}"),
                display_label: None,
                design_values: Default::default(),
                source_path: format!("/data/S{i:03}.nii.gz"),
                stack_index: None,
                expected_sha256: None,
            })
            .collect();
        let mut q = PopulationSliceRequest {
            inference: None,
            groups: vec![],
            reference: None,
            difference: false,
            focus_only: false,
            focus_window: vec![],
            mask: None,
            context_key: "workspace:dataset:revision".into(),
            working_member_ids: members.iter().map(|m| m.member_id.clone()).collect(),
            focus_member_id: Some(members[0].member_id.clone()),
            focus_stack_index: None,
            members,
            crosshair_mm: [1., 1., 1.],
            orientation: Orientation::Axial,
            dim_px: [256, 256],
            zoom: 1.,
            summary: SummaryKind::Mean,
            aggregation: None,
            cutouts: None,
            underlay: None,
        };
        assert!(validate(&q).is_ok());
        // A page of 16 tiles at 256 px is 4 MiB of values for those 16 subjects.
        // Counted once per context member it was another 75 MiB, and refused.
        const { assert!((65536 + 65536) * 300 * 4 > MAX_BYTES) };
        q.cutouts = Some(CutoutRequest {
            whole_plane: true,
            center_mm: [1.; 3],
            width_mm: 32.,
            dim_px: 256,
            member_ids: (0..16).map(|i| format!("S{i:03}")).collect(),
        });
        assert!(validate(&q).is_ok());
        // Asking for the image's own resolution is a valid request too.
        q.cutouts.as_mut().unwrap().dim_px = 0;
        q.cutouts.as_mut().unwrap().member_ids = (0..80).map(|i| format!("S{i:03}")).collect();
        assert!(validate(&q).is_ok());
        // The rows themselves are still bounded: 600 subjects are 150 MiB.
        let more: Vec<_> = (0..600)
            .map(|i| SetMemberRef {
                member_id: format!("T{i:03}"),
                ..q.members[0].clone()
            })
            .collect();
        q.working_member_ids = more.iter().map(|m| m.member_id.clone()).collect();
        q.focus_member_id = Some(more[0].member_id.clone());
        q.members = more;
        q.cutouts = None;
        assert!(validate(&q).is_err());
    }

    #[test]
    fn population_native_cutouts_lower_resolution_only_as_far_as_the_budget_requires() {
        let spec = |dim_px: u32, members: usize| CutoutRequest {
            whole_plane: true,
            center_mm: [0.; 3],
            width_mm: 32.,
            dim_px,
            member_ids: (0..members).map(|i| format!("S{i}")).collect(),
        };
        // A 2 mm slice (109 voxels): 80 tiles at 109 x 109 are 950 480 values, within 2^20.
        assert_eq!(cutout_dim(&spec(0, 80), 109), 109);
        const { assert!(80 * 109 * 109 <= MAX_CUTOUT_VALUES) };
        // A 1 mm slice (218 voxels) does not fit 80 times: 114 x 114 is the most that does.
        assert_eq!(cutout_dim(&spec(0, 80), 218), 114);
        const { assert!(80 * 114 * 114 <= MAX_CUTOUT_VALUES && 80 * 115 * 115 > MAX_CUTOUT_VALUES) };
        // A shorter page keeps the image's own resolution.
        assert_eq!(cutout_dim(&spec(0, 22), 218), 218);
        // The edge limit bounds very fine images.
        assert_eq!(cutout_dim(&spec(0, 1), 400), MAX_CUTOUT_DIM);
        // An explicit edge is taken as asked.
        assert_eq!(cutout_dim(&spec(40, 80), 218), 40);
    }

    #[tokio::test]
    async fn population_cutouts_of_another_resolution_reuse_the_sampled_plane() {
        let ramp: Vec<f32> = (0..27)
            .map(|i| (i % 3) as f32 * 100. + ((i / 3) % 3) as f32 * 10. + (i / 9) as f32)
            .collect();
        let sources = vec![
            TestSource::new(&[3, 3, 3], &ramp),
            TestSource::new(&[3, 3, 3], &[7.; 27]),
        ];
        let state = BridgeState::default().unwrap();
        let mut q = request(&sources);
        let cutouts = |dim_px: u32| CutoutRequest {
            whole_plane: false,
            center_mm: [1.; 3],
            width_mm: 3.,
            dim_px,
            member_ids: vec!["person-0".into(), "person-1".into()],
        };
        // Opening asks for the image's own resolution: one request, three voxels an edge.
        q.cutouts = Some(cutouts(0));
        let native = evaluate(&state, q.clone()).await;
        assert!(!native.source_cache_hit);
        let shown = native.cutouts.as_ref().unwrap();
        assert_eq!(shown.native_dim_px, 3);
        assert_eq!(shown.plane.dim_px, [3, 3]);
        // Another tile size plans new cutouts over the same rows: nothing is sampled again.
        for dim in [12u32, 2, 5] {
            q.cutouts = Some(cutouts(dim));
            let again = evaluate(&state, q.clone()).await;
            assert!(again.source_cache_hit, "dim {dim} re-sampled the plane");
            let cutout = again.cutouts.as_ref().unwrap();
            assert_eq!(cutout.plane.dim_px, [dim, dim]);
            assert_eq!(cutout.native_dim_px, 3);
            // Each pixel still holds its nearest voxel's value.
            for y in 0..dim {
                for x in 0..dim {
                    let world = neuro_types::pixel_to_world_raw(
                        cutout.plane.origin_mm,
                        cutout.plane.u_mm,
                        cutout.plane.v_mm,
                        x as f32,
                        y as f32,
                    );
                    let voxel = world.map(|v| v.round());
                    let value = cutout.members[0].values[(y * dim + x) as usize];
                    if voxel.iter().all(|v| (0.0..=2.0).contains(v)) {
                        assert_eq!(value, voxel[0] * 100. + voxel[1] * 10. + voxel[2]);
                        assert_eq!(cutout.members[1].values[(y * dim + x) as usize], 7.);
                    } else {
                        assert!(value.is_nan());
                    }
                }
            }
        }
        // A different square is a different plane.
        let mut moved = cutouts(3);
        moved.width_mm = 2.;
        q.cutouts = Some(moved);
        assert!(!evaluate(&state, q).await.source_cache_hit);
    }

    #[test]
    fn population_cutout_response_size_for_a_page_of_native_tiles() {
        // 80 tiles of a 2 mm slice at 112 x 112: what one slice step returns.
        let values: Vec<f32> = (0..112 * 112)
            .map(|i| ((i as f32 * 0.618_034).sin() * 3.217).mul_add(1.0, 0.000_123))
            .collect();
        let result = CutoutResult {
            plane: Plane {
                origin_mm: [0.; 3],
                u_mm: [1., 0., 0.],
                v_mm: [0., 1., 0.],
                dim_px: [112, 112],
            },
            native_dim_px: 109,
            members: (0..80)
                .map(|i| CutoutMember {
                    member_id: format!("sub-{i:04}"),
                    values: values.clone(),
                    valid_pixels: values.len(),
                })
                .collect(),
        };
        let bytes = serde_json::to_vec(&result).unwrap().len();
        println!(
            "cutout payload: 80 tiles x 112 x 112 = {} values, {} bytes of JSON ({:.1} MiB)",
            80 * 112 * 112,
            bytes,
            bytes as f64 / (1024. * 1024.)
        );
        assert!(bytes < 16 * 1024 * 1024);
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
            whole_plane: false,
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
    async fn population_slice_one_sample_t_and_sign_share_are_exact() {
        let state = BridgeState::default().unwrap();
        // Members [1, 2, 3, 6]: mean 3, sample SD sqrt(14/3), n 4,
        // so t = 3 / (sqrt(14/3) / 2) at every voxel.
        let sources: Vec<_> = [1f32, 2., 3., 6.]
            .iter()
            .map(|&v| TestSource::new(&[3, 3, 3], &[v; 27]))
            .collect();
        let mut req = request(&sources);
        req.summary = SummaryKind::OneSampleT;
        let t = finite(&evaluate(&state, req.clone()).await.summary);
        let expected_t = 3.0 / ((14.0f64 / 3.0).sqrt() / 2.0);
        assert!(!t.is_empty());
        assert!(t.iter().all(|v| (f64::from(*v) - expected_t).abs() < 1e-5));
        // Negative means give negative t: [-1, -2, -3, -6].
        let negative: Vec<_> = [-1f32, -2., -3., -6.]
            .iter()
            .map(|&v| TestSource::new(&[3, 3, 3], &[v; 27]))
            .collect();
        let mut req = request(&negative);
        req.summary = SummaryKind::OneSampleT;
        let t = finite(&evaluate(&state, req).await.summary);
        assert!(t.iter().all(|v| (f64::from(*v) + expected_t).abs() < 1e-5));
        // Members [1, -2, 0, 3]: two positive, one negative, one exact zero
        // (neither): the sign share is 2/3.
        let signs: Vec<_> = [1f32, -2., 0., 3.]
            .iter()
            .map(|&v| TestSource::new(&[3, 3, 3], &[v; 27]))
            .collect();
        let mut req = request(&signs);
        req.summary = SummaryKind::PositiveFraction;
        let share = finite(&evaluate(&state, req).await.summary);
        assert!(!share.is_empty());
        assert!(share.iter().all(|v| (*v - 2. / 3.).abs() < 1e-6));
    }

    #[tokio::test]
    async fn population_slice_one_sample_t_and_sign_share_are_unavailable_without_evidence() {
        // No spread: t is undefined (not infinite). All zeros: no sign.
        let sources: Vec<_> = (0..3)
            .map(|_| TestSource::new(&[3, 3, 3], &[0.; 27]))
            .collect();
        let state = BridgeState::default().unwrap();
        let mut req = request(&sources);
        req.summary = SummaryKind::OneSampleT;
        assert!(finite(&evaluate(&state, req.clone()).await.summary).is_empty());
        req.summary = SummaryKind::PositiveFraction;
        assert!(finite(&evaluate(&state, req.clone()).await.summary).is_empty());
        // One member: no sample SD, so no t; its sign is still a share.
        let one = vec![TestSource::new(&[3, 3, 3], &[-2.; 27])];
        let mut req = request(&one);
        req.summary = SummaryKind::OneSampleT;
        assert!(finite(&evaluate(&state, req.clone()).await.summary).is_empty());
        req.summary = SummaryKind::PositiveFraction;
        let share = evaluate(&state, req).await;
        assert!(!finite(&share.summary).is_empty());
        assert!(finite(&share.summary).iter().all(|v| *v == 0.));
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
            whole_plane: false,
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
    async fn focused_time_frame_preserves_population_and_rejects_invalid_frames() {
        let sources = vec![TestSource::new(
            &[3, 3, 3, 2],
            &[vec![1.; 27], vec![7.; 27]].concat(),
        )];
        let state = BridgeState::default().unwrap();
        let mut req = request(&sources);
        req.members[0].stack_index = Some(0);
        let base = evaluate(&state, req.clone()).await;
        req.focus_stack_index = Some(1);
        let changed = evaluate(&state, req.clone()).await;
        assert!(changed.source_cache_hit);
        assert_eq!(base.summary, changed.summary);
        assert!(changed
            .focused
            .iter()
            .filter(|v| v.is_finite())
            .all(|&v| v == 7.));
        assert!(base
            .focused
            .iter()
            .filter(|v| v.is_finite())
            .all(|&v| v == 1.));
        req.focus_stack_index = Some(2);
        assert!(state
            .population_slice
            .evaluate(req, &state, SampleCancellation::default())
            .await
            .unwrap_err()
            .to_string()
            .contains("valid explicit frame"));
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

    /// Set studio audits a set's grid from file headers; Population checks it
    /// again on the loaded volumes. Both go through
    /// `nifti_loader::affines_match`, so they agree at the tolerance's edge:
    /// what the headers call one grid is sampled, and what they call two is
    /// refused.
    #[tokio::test]
    async fn population_slice_grid_check_agrees_with_the_header_audit() {
        // The origin tolerance is `GRID_ORIGIN_TOLERANCE_MM` (1e-3 mm): a
        // shift above the 3×3 block's 1e-5 is still one grid.
        for (shift, same_grid) in [
            (0.9e-5f32, true),
            (1.2e-5, true),
            (0.9e-3, true),
            (1.2e-3, false),
            (10.0, false),
        ] {
            let sources = vec![
                TestSource::new(&[3, 3, 3], &[1.; 27]),
                TestSource::new(&[3, 3, 3], &[2.; 27]),
            ];
            let mut bytes = std::fs::read(&sources[1].path).unwrap();
            let origin = f32::from_le_bytes(bytes[292..296].try_into().unwrap());
            assert_eq!(origin, 0.0, "the shift must not be absorbed by rounding");
            bytes[292..296].copy_from_slice(&shift.to_le_bytes()); // sform translation
            std::fs::write(&sources[1].path, bytes).unwrap();

            let headers = sources
                .iter()
                .map(|source| nifti_loader::read_header_summary(&source.path).unwrap())
                .collect::<Vec<_>>();
            assert_eq!(headers[0].dim, headers[1].dim);
            assert_eq!(
                nifti_loader::affines_match(&headers[0].affine, &headers[1].affine),
                same_grid,
                "header audit at shift {shift}"
            );

            let state = BridgeState::default().unwrap();
            let result = state
                .population_slice
                .evaluate(request(&sources), &state, SampleCancellation::default())
                .await;
            match result {
                Ok(_) => assert!(same_grid, "population accepted shift {shift}"),
                Err(error) => {
                    assert!(!same_grid, "population refused shift {shift}: {error}");
                    assert!(error.to_string().contains("different voxel grids"));
                }
            }
        }
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
    #[ignore = "Generate the fixture with tools/create_population_movie_fixture.py; set BRAINFLOW_POPULATION_FIXTURE"]
    async fn population_movie_fixture_native_acceptance() {
        let root = std::path::PathBuf::from(
            std::env::var("BRAINFLOW_POPULATION_FIXTURE").expect("fixture directory"),
        );
        let preview: bridge_types::StudioImportPreviewRequest =
            serde_json::from_value(serde_json::json!({
                "mode": "manifest", "manifestPath": root.join("nftab.json")
            }))
            .unwrap();
        let candidates = field_table::preview_import_candidates(preview);
        let candidate = &candidates[0];
        assert_eq!(
            candidate.contract.readiness,
            bridge_types::StudioImportReadiness::CompareReady,
            "{}",
            candidate.contract.reason
        );
        assert_eq!(candidate.set.member_count, 80);
        let expected: serde_json::Value =
            serde_json::from_slice(&std::fs::read(root.join("expected.json")).unwrap()).unwrap();
        let mut req: PopulationSliceRequest = serde_json::from_value(serde_json::json!({
            "contextKey": "audited-movie-fixture", "members": (1..=80).map(|i| {
                let id = format!("S{i:03}");
                serde_json::json!({"memberId":id,"sourcePath":root.join(format!("maps/{id}.nii.gz")),"expectedSha256":expected["sourceSha256"][&id]})
            }).collect::<Vec<_>>(),
            "workingMemberIds": (1..=20).map(|i| format!("S{i:03}")).collect::<Vec<_>>(),
            "focusMemberId":"S001","crosshairMm":[1.,1.,1.],"orientation":"axial","dimPx":[128,128],"zoom":1.,"summary":"mean",
            "cutouts":{"wholePlane":true,"centerMm":[1.,1.,1.],"widthMm":32.,"dimPx":40,"memberIds":(1..=80).map(|i|format!("S{i:03}")).collect::<Vec<_>>()}
        })).unwrap();
        let state = BridgeState::default().unwrap();
        let start = std::time::Instant::now();
        let full = evaluate(&state, req.clone()).await;
        let cold = start.elapsed().as_secs_f64() * 1000.;
        assert!(full
            .summary
            .iter()
            .filter(|v| v.is_finite())
            .all(|&v| v == 1.));
        assert!(full.summary.iter().any(|v| v.is_nan()));
        assert!(full.summary.iter().filter(|v| v.is_finite()).count() > 100);
        assert_eq!(full.cutouts.as_ref().unwrap().members.len(), 80);
        let mut times = Vec::new();
        for i in 1..=80 {
            req.focus_only = true;
            req.focus_member_id = Some(format!("S{i:03}"));
            req.focus_window = vec![format!("S{i:03}")];
            let start = std::time::Instant::now();
            let result = evaluate(&state, req.clone()).await;
            times.push(start.elapsed().as_secs_f64() * 1000.);
            assert!(result.summary.is_empty() && result.valid_counts.is_empty());
            assert_eq!(result.sources.len(), 80);
            assert!(result.focused.iter().filter(|v| v.is_finite()).count() > 100);
            assert_eq!(result.focus_window[0].member_id, format!("S{i:03}"));
            if i <= 60 {
                let value = if i <= 20 {
                    1.
                } else if i <= 30 {
                    3.
                } else if i <= 40 {
                    -1.
                } else if i <= 42 {
                    10.
                } else {
                    0.
                };
                assert!(result
                    .focused
                    .iter()
                    .filter(|v| v.is_finite())
                    .all(|&v| v == value));
            }
        }
        times.sort_by(f64::total_cmp);
        println!("POPULATION_MOVIE_FIXTURE audited=80 geometry=32x32x32 raster=128x128 cold_ms={cold:.2} focus_p50_ms={:.2} focus_p95_ms={:.2} focus_max_ms={:.2} plane_bytes={}", times[39], times[75], times[79], full.cached_bytes);
        state
            .population_slice
            .release(&req.context_key)
            .await
            .unwrap();
        assert!(state.population_slice.cache.lock().unwrap().is_none());
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
            whole_plane: false,
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
        let mut focus_latencies = Vec::new();
        req.focus_only = true;
        req.focus_window = (0..8).map(|i| format!("person-{i}")).collect();
        for i in 0..20 {
            req.focus_member_id = Some(format!("person-{i}"));
            let start = std::time::Instant::now();
            let focus = evaluate(&state, req.clone()).await;
            focus_latencies.push(start.elapsed().as_secs_f64() * 1000.);
            assert!(focus.source_cache_hit);
            assert!(
                focus.summary.is_empty()
                    && focus.valid_counts.is_empty()
                    && focus.cutouts.is_none()
            );
            assert!(focus.focused.iter().all(|&v| v == i as f32));
            for (index, member) in focus.focus_window.iter().enumerate() {
                assert_eq!(member.member_id, format!("person-{index}"));
                assert!(member.values.iter().all(|&v| v == index as f32));
            }
        }
        focus_latencies.sort_by(f64::total_cmp);
        println!(
            "POPULATION_FOCUS_NATIVE window=8 p50_ms={:.2} p95_ms={:.2} max_ms={:.2}",
            focus_latencies[9], focus_latencies[18], focus_latencies[19]
        );
        req.focus_window.push("person-8".into());
        assert!(validate(&req).is_err());
        req.focus_window = vec!["unknown".into()];
        assert!(validate(&req).is_err());
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
            whole_plane: false,
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
            whole_plane: false,
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

    #[tokio::test]
    async fn population_underlay_is_sampled_on_the_returned_planes() {
        let ramp: Vec<f32> = (0..27)
            .map(|i| (i % 3) as f32 * 10. + (i / 9) as f32)
            .collect();
        let sources = vec![TestSource::new(&[3, 3, 3], &ramp)];
        let anatomy = TestSource::new(&[3, 3, 3], &ramp);
        let state = BridgeState::default().unwrap();
        let mut q = request(&sources);
        q.underlay = Some(display::UnderlayRequest {
            source_path: anatomy.path.to_string_lossy().into_owned(),
        });
        q.cutouts = Some(CutoutRequest {
            whole_plane: true,
            center_mm: [1., 1., 1.],
            width_mm: 3.,
            dim_px: 3,
            member_ids: vec!["person-0".into()],
        });
        let result = evaluate(&state, q.clone()).await;
        let underlay = result.underlay.expect("underlay");
        assert!(result.underlay_issue.is_none());
        // The ramp is linear in world space (identity affine), so trilinear
        // samples equal it exactly wherever a pixel lands on either plane.
        let expected = |plane: &Plane| -> Vec<f32> {
            (0..plane.dim_px[1])
                .flat_map(|y| (0..plane.dim_px[0]).map(move |x| (x, y)))
                .map(|(x, y)| {
                    let w = neuro_types::pixel_to_world_raw(
                        plane.origin_mm,
                        plane.u_mm,
                        plane.v_mm,
                        x as f32,
                        y as f32,
                    );
                    if w.iter().all(|v| (-0.5..=2.5).contains(v)) {
                        10. * w[0].clamp(0., 2.) + w[2].clamp(0., 2.)
                    } else {
                        f32::NAN
                    }
                })
                .collect()
        };
        let close = |a: &[f32], b: &[f32]| {
            a.len() == b.len()
                && a.iter()
                    .zip(b)
                    .all(|(a, b)| (a.is_nan() && b.is_nan()) || (a - b).abs() < 1e-4)
        };
        assert!(close(&underlay.values, &expected(&result.plane)));
        let cutout_plane = &result.cutouts.as_ref().unwrap().plane;
        assert!(close(
            underlay.cutouts.as_deref().unwrap(),
            &expected(cutout_plane)
        ));
        assert!(underlay.values.iter().any(|v| v.is_finite()));
        // A focus-only read samples the anatomy when it asks (the scatter
        // peek), on its own plane; the lens's focus reads reuse the shown
        // plane's anatomy and do not ask, so they get none.
        q.focus_only = true;
        let focused = evaluate(&state, q.clone()).await;
        assert!(close(
            &focused.underlay.expect("focus-only underlay").values,
            &expected(&focused.plane)
        ));
        let mut reuse = q.clone();
        reuse.underlay = None;
        assert!(evaluate(&state, reuse).await.underlay.is_none());
        // A missing anatomy image leaves the maps valid and says why.
        q.focus_only = false;
        q.underlay = Some(display::UnderlayRequest {
            source_path: "/nonexistent/anatomy.nii".into(),
        });
        let missing = evaluate(&state, q).await;
        assert!(missing.underlay.is_none());
        assert!(missing.underlay_issue.is_some());
        assert_eq!(finite(&missing.summary), finite(&result.summary));
    }

    #[tokio::test]
    async fn population_underlay_refuses_anatomy_from_another_space() {
        // A 40 mm grid against 3 mm of anatomy cannot share one space; a
        // larger anatomy field of view that contains the grid can.
        let wide = vec![1.; 40 * 3 * 3];
        let sources = vec![TestSource::new(&[40, 3, 3], &wide)];
        let small = TestSource::new(&[3, 3, 3], &[5.; 27]);
        let large = TestSource::new(&[45, 3, 3], &vec![5.; 45 * 3 * 3]);
        let state = BridgeState::default().unwrap();
        let mut q = request(&sources);
        q.underlay = Some(display::UnderlayRequest {
            source_path: small.path.to_string_lossy().into_owned(),
        });
        let mismatch = evaluate(&state, q.clone()).await;
        assert!(mismatch.underlay.is_none());
        assert!(mismatch
            .underlay_issue
            .as_deref()
            .is_some_and(|issue| issue.contains("not in one space")));
        assert!(mismatch.summary.iter().any(|v| v.is_finite()));
        q.underlay = Some(display::UnderlayRequest {
            source_path: large.path.to_string_lossy().into_owned(),
        });
        let covered = evaluate(&state, q).await;
        assert!(covered.underlay.is_some() && covered.underlay_issue.is_none());
    }

    async fn peak(state: &BridgeState, request: PopulationSliceRequest) -> Option<[f32; 3]> {
        peak_slice(request, state, SampleCancellation::default())
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn population_peak_slice_follows_summed_summary_magnitude() {
        // Signal on z = 3 for the mean (opposite signs cancel on z = 1), and
        // on z = 1 for the mean absolute magnitude.
        let field = |z1: f32, z3: f32| -> Vec<f32> {
            (0..45)
                .map(|i| match i / 9 {
                    1 => z1,
                    3 => z3,
                    _ => 0.,
                })
                .collect()
        };
        let sources = vec![
            TestSource::new(&[3, 3, 5], &field(4., 1.)),
            TestSource::new(&[3, 3, 5], &field(-4., 1.)),
        ];
        let state = BridgeState::default().unwrap();
        let mut q = request(&sources);
        q.crosshair_mm = [0.5, 1., 0.];
        assert_eq!(peak(&state, q.clone()).await, Some([0.5, 1., 3.]));
        q.summary = SummaryKind::MeanAbsolute;
        assert_eq!(peak(&state, q.clone()).await, Some([0.5, 1., 1.]));
        q.summary = SummaryKind::SampleSd;
        assert_eq!(peak(&state, q.clone()).await, Some([0.5, 1., 1.]));
        q.orientation = Orientation::Coronal;
        q.summary = SummaryKind::Coverage;
        // Every voxel is observed by both: the first slice of equal coverage.
        assert_eq!(peak(&state, q.clone()).await, Some([0.5, 0., 0.]));
        let silent = vec![TestSource::new(&[3, 3, 5], &[0.; 45])];
        assert!(peak(&state, request(&silent)).await.is_none());
    }

    #[tokio::test]
    async fn population_peak_slice_ranks_sign_share_not_mean_magnitude() {
        // z = 1: one large positive and three small negatives (mean 1.75,
        // positive share 0.25); z = 3: a weak but unanimous +0.1 (share 1).
        // The sign-share peak is the unanimous slice, not the large mean.
        let field = |z1: f32| -> Vec<f32> {
            (0..45)
                .map(|i| match i / 9 {
                    1 => z1,
                    3 => 0.1,
                    _ => 0.,
                })
                .collect()
        };
        let sources = vec![
            TestSource::new(&[3, 3, 5], &field(10.)),
            TestSource::new(&[3, 3, 5], &field(-1.)),
            TestSource::new(&[3, 3, 5], &field(-1.)),
            TestSource::new(&[3, 3, 5], &field(-1.)),
        ];
        let state = BridgeState::default().unwrap();
        let mut q = request(&sources);
        assert_eq!(peak(&state, q.clone()).await.map(|p| p[2]), Some(1.));
        q.summary = SummaryKind::PositiveFraction;
        assert_eq!(peak(&state, q.clone()).await.map(|p| p[2]), Some(3.));
        // A constant slice has no spread and so no t: z = 1 holds the t peak.
        q.summary = SummaryKind::OneSampleT;
        assert_eq!(peak(&state, q).await.map(|p| p[2]), Some(1.));
    }

    #[tokio::test]
    async fn population_peak_slice_ranks_participant_means_like_the_display() {
        // Participant A: three observations of +1 on z = 1; participant B: one
        // of -3 there. The observation mean is 0 on z = 1, the participant
        // mean -1. A weaker shared +0.5 on z = 3 decides the observation peak.
        let field = |z1: f32| -> Vec<f32> {
            (0..45)
                .map(|i| match i / 9 {
                    1 => z1,
                    3 => 0.5,
                    _ => 0.,
                })
                .collect()
        };
        let sources = vec![
            TestSource::new(&[3, 3, 5], &field(1.)),
            TestSource::new(&[3, 3, 5], &field(1.)),
            TestSource::new(&[3, 3, 5], &field(1.)),
            TestSource::new(&[3, 3, 5], &field(-3.)),
        ];
        let state = BridgeState::default().unwrap();
        let mut q = request(&sources);
        assert_eq!(peak(&state, q.clone()).await.map(|p| p[2]), Some(3.));
        q.aggregation = Some(ParticipantAggregation {
            within: WithinParticipant::Mean,
            groups: vec![
                ParticipantGroup {
                    participant_id: "A".into(),
                    member_ids: vec!["person-0".into(), "person-1".into(), "person-2".into()],
                },
                ParticipantGroup {
                    participant_id: "B".into(),
                    member_ids: vec!["person-3".into()],
                },
            ],
        });
        // The displayed summary is the participant mean: -1 on z = 1, 0.5 on z = 3.
        assert_eq!(
            finite(&evaluate(&state, q.clone()).await.summary),
            vec![-1.; 9]
        );
        let mut upper = q.clone();
        upper.crosshair_mm[2] = 3.;
        assert_eq!(finite(&evaluate(&state, upper).await.summary), vec![0.5; 9]);
        assert_eq!(peak(&state, q.clone()).await.map(|p| p[2]), Some(1.));
        // Coverage counts participants, not rows: equal on every slice.
        q.summary = SummaryKind::Coverage;
        assert_eq!(peak(&state, q).await.map(|p| p[2]), Some(0.));
    }

    #[tokio::test]
    async fn population_peak_slice_respects_the_common_mask() {
        use crate::population_mask::MaskSource;
        // The strongest slice (z = 3) is outside the mask; z = 1 is inside.
        let values: Vec<f32> = (0..45)
            .map(|i| match i / 9 {
                1 => 1.,
                3 => 9.,
                _ => 0.,
            })
            .collect();
        let sources = vec![TestSource::new(&[3, 3, 5], &values)];
        let inside: Vec<f32> = (0..45).map(|i| if i / 9 == 3 { 0. } else { 1. }).collect();
        let mask = TestSource::new(&[3, 3, 5], &inside);
        let state = BridgeState::default().unwrap();
        let mut q = request(&sources);
        assert_eq!(peak(&state, q.clone()).await.map(|p| p[2]), Some(3.));
        q.mask = Some(MaskSource {
            source_path: mask.path.to_string_lossy().into_owned(),
            expected_sha256: None,
        });
        assert_eq!(peak(&state, q.clone()).await.map(|p| p[2]), Some(1.));
        // The mask admission is released: a masked slice still evaluates.
        assert!(!finite(&evaluate(&state, q).await.summary).is_empty());
    }

    #[tokio::test]
    async fn population_peak_slice_failure_is_no_peak_and_leaves_maps_intact() {
        let sources = vec![
            TestSource::new(&[3, 3, 3], &[1.; 27]),
            TestSource::new(&[3, 3, 3], &[3.; 27]),
        ];
        let state = BridgeState::default().unwrap();
        let q = request(&sources);
        let maps = evaluate(&state, q.clone()).await;
        // An unreadable source fails the search, which reports no peak.
        let mut broken = q.clone();
        broken.members[1].source_path = "/nonexistent/population-source.nii".into();
        assert!(peak(&state, broken).await.is_none());
        let again = evaluate(&state, q.clone()).await;
        assert_eq!(again.summary, maps.summary);
        assert!(again.source_cache_hit);
        // Cancellation is still an error.
        let cancelled = SampleCancellation::default();
        cancelled.cancel();
        assert!(peak_slice(q, &state, cancelled).await.is_err());
    }
}
