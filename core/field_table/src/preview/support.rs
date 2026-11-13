use crate::neurotabs::{FeatureSchema, NeuroTabsManifest, SupportSchema};
use bridge_types::{StudioAlignmentClass, StudioJoinIssueDetail, StudioSupportKind};
use nifti_loader::HeaderSummary;
use std::path::Path;

/// The voxel grid of a 3D member: its shape, voxel size and placement in world
/// space. Two members share a grid only when [`Self::difference_from`] finds
/// none, so there is deliberately no `PartialEq`.
#[derive(Clone, Debug)]
pub(super) struct TableSupportSignature {
    dims: [usize; 3],
    voxel_sizes: [f32; 3],
    /// Voxel→world affine, as a load of the file would report it.
    affine: nifti_loader::VoxelToWorld,
}

/// How a member's grid departs from the reference grid of its set.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum GridDifference {
    /// Different matrix size or voxel size.
    Shape,
    /// Same matrix and voxel size, placed or oriented differently in space.
    Placement,
}

impl TableSupportSignature {
    /// `None` when `self` is on the grid of `reference`.
    ///
    /// Placement is judged by `nifti_loader::affines_match`, the comparison
    /// Population sampling applies to loaded members
    /// (`api_bridge::population_slice::sample_row`), so a set audited as one
    /// grid here is not refused there for its grid.
    pub(super) fn difference_from(&self, reference: &Self) -> Option<GridDifference> {
        if self.dims != reference.dims || self.voxel_sizes != reference.voxel_sizes {
            Some(GridDifference::Shape)
        } else if !nifti_loader::affines_match(&self.affine, &reference.affine) {
            Some(GridDifference::Placement)
        } else {
            None
        }
    }
}

pub(super) fn table_support_label(signature: &TableSupportSignature) -> String {
    format!(
        "{}×{}×{} voxels · {:.2}×{:.2}×{:.2} mm",
        signature.dims[0],
        signature.dims[1],
        signature.dims[2],
        signature.voxel_sizes[0],
        signature.voxel_sizes[1],
        signature.voxel_sizes[2]
    )
}

pub(super) fn inspect_table_volume_support(path: &Path) -> Result<TableSupportSignature, String> {
    let label = path.display().to_string();
    table_volume_support(&label, &read_local_header(path)?)
}

/// The grid signature of a 3D member from its header facts. Local files and
/// headers read over a remote mount both come through here, so a set audited
/// either way is judged by the same rule. `label` names the file in messages.
pub(super) fn table_volume_support(
    label: &str,
    header: &HeaderSummary,
) -> Result<TableSupportSignature, String> {
    let (signature, frames) = volume_support_and_frames(label, header)?;
    if frames > 1 {
        return Err(format!(
            "{label} is a 4D series; Studio table preview currently expects 3D members."
        ));
    }
    Ok(signature)
}

/// Header facts of a local file. Only the header is read, through the parser a
/// remote audit uses on a streamed prefix, so the same bytes are described the
/// same way on disk and over a mount, and no image payload is decoded.
fn read_local_header(path: &Path) -> Result<HeaderSummary, String> {
    nifti_loader::read_header_summary(path)
        .map_err(|error| format!("{}: {}", path.display(), error))
}

/// Spatial support plus the number of frames along the 4th axis (1 for 3D).
fn inspect_volume_support_and_frames(
    path: &Path,
) -> Result<(TableSupportSignature, usize), String> {
    volume_support_and_frames(&path.display().to_string(), &read_local_header(path)?)
}

fn volume_support_and_frames(
    label: &str,
    header: &HeaderSummary,
) -> Result<(TableSupportSignature, usize), String> {
    // `dim` and `pixdim` hold the used dimensions only, so their length is the rank.
    let (Some(dims), Some(voxel_sizes)) = (header.dim.get(..3), header.pixdim.get(..3)) else {
        return Err(format!("{label} is not a 3D volume."));
    };
    let frames = header
        .dim
        .get(3)
        .map_or(1, |&frames| frames.max(1) as usize);
    let signature = TableSupportSignature {
        dims: [dims[0] as usize, dims[1] as usize, dims[2] as usize],
        voxel_sizes: [voxel_sizes[0], voxel_sizes[1], voxel_sizes[2]],
        affine: header.affine,
    };
    Ok((signature, frames))
}

/// Frames a manifest feature declares along a series (`lag`/`time`) axis in
/// position 3 (`axes: [x, y, z, lag]`), as `Some(count)` where the count is
/// known from `logical.shape` or the axis domain `size`, or `Some(None)` when
/// the axis is declared without a count. `None` when there is no such axis.
fn declared_series_frames(feature: &FeatureSchema) -> Option<Option<usize>> {
    let axis = feature.logical.axes.get(3)?;
    bridge_types::SeriesAxisKind::from_convention_name(axis)?;
    Some(
        feature
            .logical
            .shape
            .as_ref()
            .and_then(|shape| shape.get(3).copied())
            .or_else(|| {
                feature
                    .logical
                    .axis_domains
                    .get(axis)
                    .and_then(|domain| domain.size)
            }),
    )
}

pub(super) fn infer_support_summary(
    manifest: &NeuroTabsManifest,
    primary_feature: &FeatureSchema,
) -> (
    StudioSupportKind,
    String,
    StudioAlignmentClass,
    bool,
    Vec<String>,
) {
    let logical_kind = primary_feature.logical.kind.as_str();
    let logical_alignment = primary_feature
        .logical
        .alignment
        .map(|alignment| map_alignment_class(alignment.as_str()));

    if let Some(support_ref) = primary_feature.logical.support_ref.as_deref() {
        if let Some(support) = manifest.supports.get(support_ref) {
            match support {
                SupportSchema::Volume(support) => {
                    return (
                        StudioSupportKind::Volume,
                        format!("{} ({})", support.space, support.grid_id),
                        logical_alignment.unwrap_or(StudioAlignmentClass::SameGrid),
                        true,
                        vec![format!(
                            "Primary feature resolves against support {} with exact grid {}.",
                            support_ref, support.grid_id
                        )],
                    );
                }
                SupportSchema::Surface(support) => {
                    let hemisphere = format!("{:?}", support.hemisphere).to_lowercase();
                    return (
                        StudioSupportKind::Surface,
                        format!(
                            "{} / {} / {}",
                            support.template, hemisphere, support.topology_id
                        ),
                        logical_alignment.unwrap_or(StudioAlignmentClass::SameTopology),
                        false,
                        vec![
                            format!("Primary feature resolves against surface support {}.", support_ref),
                            "Surface compare materialization is not implemented yet; import is inspect-only.".to_string(),
                        ],
                    );
                }
                SupportSchema::Parcel(support) => {
                    return (
                        StudioSupportKind::Unknown,
                        format!("{} ({} parcels)", support.space, support.n_parcels),
                        logical_alignment.unwrap_or(StudioAlignmentClass::Unknown),
                        false,
                        vec![format!(
                            "Primary feature resolves against parcel support {}.",
                            support_ref
                        )],
                    );
                }
                SupportSchema::Generic(support) => {
                    return (
                        StudioSupportKind::Unknown,
                        support.support_id.clone(),
                        logical_alignment.unwrap_or(StudioAlignmentClass::Unknown),
                        false,
                        vec![format!(
                            "Primary feature resolves against generic support {}.",
                            support_ref
                        )],
                    );
                }
            }
        }
    }

    let support_kind = match logical_kind {
        "volume" => StudioSupportKind::Volume,
        "surface" => StudioSupportKind::Surface,
        _ => StudioSupportKind::Unknown,
    };
    let support_label = primary_feature
        .logical
        .space
        .as_deref()
        .unwrap_or("Unknown support")
        .to_string();
    (
        support_kind,
        support_label,
        logical_alignment.unwrap_or(StudioAlignmentClass::Unknown),
        false,
        vec!["Primary feature does not reference an exact support descriptor.".to_string()],
    )
}

pub(super) fn feature_support_kind(feature: &FeatureSchema) -> StudioSupportKind {
    match feature.logical.kind.as_str() {
        "volume" => StudioSupportKind::Volume,
        "surface" => StudioSupportKind::Surface,
        _ => StudioSupportKind::Unknown,
    }
}

pub(super) fn manifest_binding_support_label(
    manifest: &NeuroTabsManifest,
    feature: &FeatureSchema,
) -> Option<String> {
    let support_ref = feature.logical.support_ref.as_deref()?;
    let support = manifest.supports.get(support_ref)?;
    Some(match support {
        SupportSchema::Volume(support) => format!("{} ({})", support.space, support.grid_id),
        SupportSchema::Surface(support) => {
            let hemisphere = format!("{:?}", support.hemisphere).to_lowercase();
            format!(
                "{} / {} / {}",
                support.template, hemisphere, support.topology_id
            )
        }
        SupportSchema::Parcel(support) => {
            format!("{} ({} parcels)", support.space, support.n_parcels)
        }
        SupportSchema::Generic(support) => support.support_id.clone(),
    })
}

fn map_alignment_class(value: &str) -> StudioAlignmentClass {
    match value {
        "same_grid" | "same-grid" => StudioAlignmentClass::SameGrid,
        "same_space" | "same-space" => StudioAlignmentClass::SameSpace,
        "same_topology" | "same-topology" => StudioAlignmentClass::SameTopology,
        "loose" | "mixed" => StudioAlignmentClass::Mixed,
        "none" => StudioAlignmentClass::Unknown,
        _ => StudioAlignmentClass::Unknown,
    }
}

pub(super) fn validate_nifti_volume_support(
    row_id: &str,
    feature: &FeatureSchema,
    backend: &str,
    path: &Path,
) -> Vec<StudioJoinIssueDetail> {
    if !backend.eq_ignore_ascii_case("nifti") {
        return vec![StudioJoinIssueDetail {
            message: format!(
                "Row {} uses backend {}, but Brainflow compare validation currently expects nifti.",
                row_id, backend
            ),
            member_ids: vec![row_id.to_string()],
        }];
    }

    let (signature, frames) = match inspect_volume_support_and_frames(path) {
        Ok(found) => found,
        Err(message) => {
            return vec![StudioJoinIssueDetail {
                message,
                member_ids: vec![row_id.to_string()],
            }];
        }
    };
    // A 4D member is unambiguous only when the feature declares a series axis
    // (e.g. `axes: [x, y, z, lag]`). Import only validates frame counts: every
    // member, 3D or 4D, must match the declared count (strict manifest
    // validation requires one, so members of different lengths cannot form a
    // set). Expansion into one observation per frame (stackIndex) happens
    // later, in the UI's series mode.
    match (frames > 1, declared_series_frames(feature)) {
        (true, None) => {
            return vec![StudioJoinIssueDetail {
                message: format!(
                    "{} is a 4D series; declare a lag or time axis (logical.axes \
                     [x, y, z, lag|time]) to compare its frames.",
                    path.display()
                ),
                member_ids: vec![row_id.to_string()],
            }];
        }
        (_, Some(Some(declared))) if declared != frames => {
            return vec![StudioJoinIssueDetail {
                message: format!(
                    "Row {} has {} frames but the series axis declares {}.",
                    row_id, frames, declared
                ),
                member_ids: vec![row_id.to_string()],
            }];
        }
        _ => {}
    }
    let Some(shape) = &feature.logical.shape else {
        return Vec::new();
    };
    if shape.len() >= 3 && signature.dims != [shape[0], shape[1], shape[2]] {
        return vec![StudioJoinIssueDetail {
            message: format!(
                "Row {} volume shape {:?} does not match declared logical shape {:?}.",
                row_id, signature.dims, shape
            ),
            member_ids: vec![row_id.to_string()],
        }];
    }
    Vec::new()
}
