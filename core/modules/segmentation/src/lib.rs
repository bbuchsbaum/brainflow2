//! Segmentation sessions on a fixed reference grid. Domain code owns document
//! policy; hosts own publication, GPU residency and workspace teardown.
use label_store::{Change, LabelValue, LabelVolume, VoxelEdit, DEFAULT_HISTORY_BYTES};
use nalgebra::Matrix4;
use nifti::NiftiHeader;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use ts_rs::TS;
mod raster;
pub use raster::{rasterize, RasterRequest, Tool};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Invalid(String),
    #[error("This operation belongs to a closed or replaced workspace/session")]
    StaleOwner,
    #[error("Session revision conflict: expected {expected}, current {actual}")]
    Revision { expected: u32, actual: u32 },
    #[error("{0}")]
    Labels(#[from] label_store::Error),
}
pub type Result<T> = std::result::Result<T, Error>;
fn invalid(message: &str) -> Error {
    Error::Invalid(message.into())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "SegmentationIdentity")]
pub struct Identity {
    pub subject: String,
    pub session: String,
    pub hemisphere: String,
    pub rater: String,
    pub blind: bool,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "SegmentationLabelDefinition")]
pub struct LabelDefinition {
    pub id: u16,
    pub name: String,
    pub abbreviation: String,
    pub color: [u8; 3],
    pub parent: Option<u16>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(rename = "SegmentationRegistration")]
pub enum Registration {
    Aligned {
        confirmer: String,
        confirmed_at_ms: f64,
        transform_hash: String,
        view: [f32; 12],
    },
    WithoutSecondary {
        reason: String,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "SegmentationSessionSetup")]
pub struct SessionSetup {
    pub workspace_id: String,
    pub workspace_instance: String,
    pub reference_volume_id: String,
    pub identity: Identity,
    pub normal_axis: u8,
    pub labels: Vec<LabelDefinition>,
    pub secondary_volume_id: Option<String>,
    pub registration: Option<Registration>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "SegmentationOperation")]
pub struct Operation {
    pub workspace_id: String,
    pub workspace_instance: String,
    pub session_id: String,
    pub base_revision: u32,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(rename = "SegmentationPaintOver")]
pub enum PaintOver {
    Background,
    Unlocked,
    All,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "SegmentationStroke")]
pub struct Stroke {
    pub owner: Operation,
    pub label_id: u16,
    pub slice_index: u32,
    pub tool: Tool,
    pub radius_mm: f32,
    pub points_world: Vec<[f32; 3]>,
    pub paint_over: PaintOver,
}
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "SegmentationLabelStatus")]
pub struct LabelStatus {
    pub definition: LabelDefinition,
    pub locked: bool,
    pub complete: bool,
    pub voxels: f64,
    pub mm3: f64,
    pub slice_voxels: Vec<u32>,
}
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "SegmentationSnapshot")]
pub struct Snapshot {
    pub session_id: String,
    pub workspace_id: String,
    pub workspace_instance: String,
    pub reference_volume_id: String,
    pub secondary_volume_id: Option<String>,
    pub revision: u32,
    pub label_revision: u32,
    pub identity: Identity,
    pub dimensions: [u32; 3],
    pub voxel_to_world: [f32; 16],
    pub normal_axis: u8,
    pub labels: Vec<LabelStatus>,
    pub registration: Option<Registration>,
    pub source_header_original: bool,
    pub undo: Option<String>,
    pub redo: Option<String>,
}
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "SegmentationPreview")]
pub struct Preview {
    pub revision: u32,
    pub written: Vec<[u32; 3]>,
    pub blocked: Vec<[u32; 3]>,
    pub blocked_labels: Vec<u16>,
}
struct LabelMeta {
    definition: LabelDefinition,
    locked: bool,
    complete: bool,
}

pub struct Session {
    id: String,
    setup: SessionSetup,
    affine: Matrix4<f32>,
    header: NiftiHeader,
    labels: LabelVolume,
    table: BTreeMap<u16, LabelMeta>,
    revision: u32,
    source_header_original: bool,
}
impl Session {
    /// Parse the exact header captured when the reference was acquired, rather
    /// than opening a path whose contents may have changed since loading.
    pub fn create_from_header_bytes(
        id: String,
        setup: SessionSetup,
        affine: Matrix4<f32>,
        bytes: &[u8],
    ) -> Result<Self> {
        let header = NiftiHeader::from_reader(bytes).map_err(|error| {
            Error::Invalid(format!("Invalid retained reference header: {error}"))
        })?;
        Self::create(id, setup, affine, header)
    }

    /// A derived in-memory grid has no original NIfTI header. State that fact
    /// explicitly; record its actual affine as sform and do not invent qform.
    pub fn create_on_derived_grid(
        id: String,
        setup: SessionSetup,
        dimensions: [u32; 3],
        affine: Matrix4<f32>,
    ) -> Result<Self> {
        if dimensions.iter().any(|&n| n == 0 || n > 32767) {
            return Err(invalid("Invalid derived reference dimensions"));
        }
        let mut header = NiftiHeader {
            dim: [
                3,
                dimensions[0] as u16,
                dimensions[1] as u16,
                dimensions[2] as u16,
                1,
                1,
                1,
                1,
            ],
            qform_code: 0,
            sform_code: 2,
            xyzt_units: 2,
            ..Default::default()
        };
        for axis in 0..3 {
            header.pixdim[axis + 1] = affine.fixed_view::<3, 1>(0, axis).norm();
        }
        header.srow_x = std::array::from_fn(|column| affine[(0, column)]);
        header.srow_y = std::array::from_fn(|column| affine[(1, column)]);
        header.srow_z = std::array::from_fn(|column| affine[(2, column)]);
        let mut session = Self::create(id, setup, affine, header)?;
        session.source_header_original = false;
        Ok(session)
    }

    pub fn create(
        id: String,
        setup: SessionSetup,
        affine: Matrix4<f32>,
        header: NiftiHeader,
    ) -> Result<Self> {
        if id.trim().is_empty()
            || setup.workspace_id.is_empty()
            || setup.workspace_instance.is_empty()
            || setup.reference_volume_id.is_empty()
            || setup.identity.subject.trim().is_empty()
            || setup.identity.rater.trim().is_empty()
            || !["left", "right", "bilateral"].contains(&setup.identity.hemisphere.as_str())
        {
            return Err(invalid(
                "Subject, rater, hemisphere and workspace identity are required",
            ));
        }
        if header.dim[0] < 3 || header.dim[0] > 7 || header.dim[4..].iter().any(|&n| n > 1) {
            return Err(invalid("Select a single 3D reference image; a multi-frame source needs an explicit frozen-frame adapter"));
        }
        let dimensions = [
            u32::from(header.dim[1]),
            u32::from(header.dim[2]),
            u32::from(header.dim[3]),
        ];
        let slice_count = dimensions
            .get(usize::from(setup.normal_axis))
            .copied()
            .ok_or_else(|| invalid("Select a native normal axis from 0 to 2"))?
            as usize;
        // Bounds the dense per-label slice-count metadata returned with every
        // snapshot, independently of sparse voxel/history storage.
        if setup.labels.is_empty()
            || setup
                .labels
                .len()
                .checked_mul(slice_count)
                .is_none_or(|n| n > 2_000_000)
        {
            return Err(invalid(
                "Provide at least one label and at most two million label-by-slice counts",
            ));
        }
        let labels = LabelVolume::new(dimensions, DEFAULT_HISTORY_BYTES)?;
        neuro_types::native_slice_geometry(
            &neuro_types::VolumeMetadata {
                dimensions: dimensions.map(|n| n as usize),
                voxel_to_world: affine,
            },
            setup.normal_axis,
            0,
            [1; 2],
            [false; 2],
        )
        .map_err(|e| Error::Invalid(e.to_string()))?;
        if setup.secondary_volume_id.is_some() && setup.registration.is_none() {
            return Err(invalid(
                "Confirm registration or explicitly continue without the secondary contrast",
            ));
        }
        if let Some(registration) = &setup.registration {
            match registration {
                Registration::Aligned {
                    confirmer,
                    confirmed_at_ms,
                    transform_hash,
                    view,
                } => {
                    if confirmer.trim() != setup.identity.rater.trim()
                        || !confirmed_at_ms.is_finite()
                        || *confirmed_at_ms <= 0.0
                        || transform_hash.trim().is_empty()
                        || !view.iter().all(|v| v.is_finite())
                    {
                        return Err(invalid("Registration confirmation must record the rater, time, transform hash and view"));
                    }
                }
                Registration::WithoutSecondary { reason } => {
                    if reason.trim().is_empty() {
                        return Err(invalid(
                            "Record why tracing continues without the secondary contrast",
                        ));
                    }
                }
            }
        }
        let mut table = BTreeMap::new();
        for row in &setup.labels {
            if row.id == 0 || row.name.trim().is_empty() || table.contains_key(&row.id) {
                return Err(invalid("Label ids must be unique, nonzero and named"));
            }
            table.insert(
                row.id,
                LabelMeta {
                    definition: row.clone(),
                    locked: false,
                    complete: false,
                },
            );
        }
        for row in &setup.labels {
            let mut parent = row.parent;
            let mut visited = HashSet::from([row.id]);
            while let Some(id) = parent {
                if !visited.insert(id) {
                    return Err(invalid("Label hierarchy contains a cycle"));
                }
                parent = table
                    .get(&id)
                    .ok_or_else(|| invalid("Label parent is not in the table"))?
                    .definition
                    .parent;
            }
        }
        Ok(Self {
            id,
            setup,
            affine,
            header,
            labels,
            table,
            revision: 0,
            source_header_original: true,
        })
    }
    pub fn check(&self, owner: &Operation) -> Result<()> {
        if owner.workspace_id != self.setup.workspace_id
            || owner.workspace_instance != self.setup.workspace_instance
            || owner.session_id != self.id
        {
            return Err(Error::StaleOwner);
        }
        if owner.base_revision != self.revision {
            return Err(Error::Revision {
                expected: owner.base_revision,
                actual: self.revision,
            });
        }
        Ok(())
    }
    pub fn snapshot(&self) -> Snapshot {
        let axis = usize::from(self.setup.normal_axis);
        let mut slice_counts: BTreeMap<_, Vec<u32>> = self
            .table
            .keys()
            .map(|&id| (id, vec![0; self.labels.dimensions()[axis] as usize]))
            .collect();
        for (voxel, value) in self.labels.label_voxels() {
            if let Some(counts) = slice_counts.get_mut(&value.label) {
                counts[voxel[axis] as usize] += 1;
            }
        }

        let voxel_mm3 = self
            .affine
            .cast::<f64>()
            .fixed_view::<3, 3>(0, 0)
            .determinant()
            .abs();
        Snapshot {
            session_id: self.id.clone(),
            workspace_id: self.setup.workspace_id.clone(),
            workspace_instance: self.setup.workspace_instance.clone(),
            reference_volume_id: self.setup.reference_volume_id.clone(),
            secondary_volume_id: self.setup.secondary_volume_id.clone(),
            revision: self.revision,
            label_revision: self.labels.revision() as u32,
            identity: self.setup.identity.clone(),
            dimensions: self.labels.dimensions(),
            voxel_to_world: self.affine.as_slice().try_into().unwrap(),
            normal_axis: self.setup.normal_axis,
            labels: self
                .table
                .values()
                .map(|row| {
                    let count = *self
                        .labels
                        .label_counts()
                        .get(&row.definition.id)
                        .unwrap_or(&0) as f64;
                    LabelStatus {
                        definition: row.definition.clone(),
                        locked: row.locked,
                        complete: row.complete,
                        voxels: count,
                        mm3: count * voxel_mm3,
                        slice_voxels: slice_counts
                            .remove(&row.definition.id)
                            .expect("declared label"),
                    }
                })
                .collect(),
            registration: self.setup.registration.clone(),
            source_header_original: self.source_header_original,
            undo: self.labels.undo_description().map(str::to_owned),
            redo: self.labels.redo_description().map(str::to_owned),
        }
    }
    pub fn native_plane(
        &self,
        slice_index: u32,
        dimensions: [u32; 2],
        flips: [bool; 2],
    ) -> Result<neuro_types::ViewRectMm> {
        let plane = neuro_types::native_slice_geometry(
            &neuro_types::VolumeMetadata {
                dimensions: self.labels.dimensions().map(|v| v as usize),
                voxel_to_world: self.affine,
            },
            self.setup.normal_axis,
            slice_index,
            dimensions,
            flips,
        )
        .map_err(|error| Error::Invalid(error.to_string()))?;
        Ok(neuro_types::ViewRectMm::from(&plane))
    }

    /// Native voxel coordinates and ids for the SVG partition overlay. Display
    /// projects these through the same reference affine as the rendered image.
    pub fn slice_labels(&self, slice_index: u32) -> Result<Vec<[u32; 4]>> {
        let axis = usize::from(self.setup.normal_axis);
        if slice_index >= self.labels.dimensions()[axis] {
            return Err(invalid("Slice is outside the reference grid"));
        }
        Ok(self
            .labels
            .label_voxels()
            .filter(|(voxel, _)| voxel[axis] == slice_index)
            .map(|(voxel, value)| [voxel[0], voxel[1], voxel[2], u32::from(value.label)])
            .collect())
    }

    pub fn normal_axis(&self) -> u8 {
        self.setup.normal_axis
    }
    pub fn volume(&self) -> &LabelVolume {
        &self.labels
    }
    pub fn header(&self) -> &NiftiHeader {
        &self.header
    }
    pub fn affine(&self) -> Matrix4<f32> {
        self.affine
    }
    pub fn preview(&self, stroke: &Stroke) -> Result<Preview> {
        self.check(&stroke.owner)?;
        let target = self
            .table
            .get(&stroke.label_id)
            .ok_or_else(|| invalid("Select a label from the table before tracing"))?;
        if target.locked {
            return Err(invalid("The active label is locked"));
        }
        let footprint = rasterize(&RasterRequest {
            dimensions: self.labels.dimensions(),
            affine: self.affine,
            normal_axis: self.setup.normal_axis,
            slice_index: stroke.slice_index,
            tool: stroke.tool,
            radius_mm: stroke.radius_mm,
            points_world: &stroke.points_world,
        })?;
        let mut written = Vec::new();
        let mut blocked = Vec::new();
        let mut blocked_labels = HashSet::new();
        for voxel in footprint {
            let current = self.labels.get(voxel)?.label;
            let next = if stroke.tool == Tool::Eraser {
                0
            } else {
                stroke.label_id
            };
            if current == next {
                continue;
            }
            if stroke.tool == Tool::Eraser {
                // Erasing is label-local: paint-over policy never allows an
                // eraser to clear another label, locked or otherwise.
                if current == stroke.label_id {
                    written.push(voxel);
                }
                continue;
            }
            if current != 0
                && (self.table.get(&current).is_some_and(|l| l.locked)
                    || stroke.paint_over == PaintOver::Background)
            {
                blocked.push(voxel);
                blocked_labels.insert(current);
            } else {
                written.push(voxel);
            }
        }
        let mut blocked_labels: Vec<_> = blocked_labels.into_iter().collect();
        blocked_labels.sort_unstable();
        Ok(Preview {
            revision: self.revision,
            written,
            blocked,
            blocked_labels,
        })
    }
    pub fn stroke(&mut self, stroke: &Stroke) -> Result<(Preview, Change)> {
        let preview = self.preview(stroke)?;
        let next = self
            .revision
            .checked_add(1)
            .ok_or_else(|| invalid("Session revision exhausted"))?;
        if self.labels.revision() >= u64::from(u32::MAX) {
            return Err(invalid("Label revision exhausted"));
        }
        let label = if stroke.tool == Tool::Eraser {
            0
        } else {
            stroke.label_id
        };
        let edits: Vec<_> = preview
            .written
            .iter()
            .map(|&voxel| VoxelEdit {
                voxel,
                value: LabelValue {
                    label,
                    provenance: 1,
                },
            })
            .collect();
        let change = self.labels.commit(
            self.labels.revision(),
            format!(
                "{:?} · {}",
                stroke.tool, self.table[&stroke.label_id].definition.name
            ),
            &edits,
        )?;
        if change.changed_voxels > 0 {
            self.revision = next;
        }
        Ok((preview, change))
    }
    pub fn set_label_state(
        &mut self,
        owner: &Operation,
        id: u16,
        locked: bool,
        complete: bool,
    ) -> Result<()> {
        self.check(owner)?;
        let next = self
            .revision
            .checked_add(1)
            .ok_or_else(|| invalid("Session revision exhausted"))?;
        let row = self
            .table
            .get_mut(&id)
            .ok_or_else(|| invalid("Label is not in this session"))?;
        if row.locked != locked || row.complete != complete {
            row.locked = locked;
            row.complete = complete;
            self.revision = next;
        }
        Ok(())
    }
    pub fn undo(&mut self, owner: &Operation, redo: bool) -> Result<Change> {
        self.check(owner)?;
        let next = self
            .revision
            .checked_add(1)
            .ok_or_else(|| invalid("Session revision exhausted"))?;
        if self.labels.revision() >= u64::from(u32::MAX) {
            return Err(invalid("Label revision exhausted"));
        }
        let change = if redo {
            self.labels.redo(self.labels.revision())?
        } else {
            self.labels.undo(self.labels.revision())?
        };
        if change.changed_voxels > 0 {
            self.revision = next;
        }
        Ok(change)
    }
}
