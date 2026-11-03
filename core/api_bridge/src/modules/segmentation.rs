//! Native adapter for reference-grid segmentation. Documents live in the state
//! slot across activation switches; ordinary layers own their GPU leases.
use super::{
    BridgeModule, ModuleCtx, ModuleDescriptor, ModuleSlots, ModuleStage, WorkspaceIdentity,
};
use crate::{BridgeState, VolumeMetadataInfo};
use async_trait::async_trait;
use bf_segmentation::{
    LabelExport, Operation, SavedLabels, Session, SessionSetup, Snapshot, Stroke,
};
use bridge_types::{BridgeError, BridgeResult, VolumeSendable};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{AppHandle, Runtime, State};
use tauri_plugin_dialog::DialogExt;
use tokio::sync::Mutex;
use ts_rs::TS;
use volmath::{DenseVolume3, NeuroSpace, NeuroSpaceExt};

pub(crate) const ID: &str = "segmentation";
static DESCRIPTOR: ModuleDescriptor = ModuleDescriptor {
    id: ID,
    title: "Segmentation",
    version: "0.1.0",
    stage: ModuleStage::Experimental,
};
pub(crate) struct SegmentationModule;
pub(crate) static MODULE: SegmentationModule = SegmentationModule;
struct Record {
    workspace: WorkspaceIdentity,
    label_volume_id: String,
    /// Pinned sources plus the session-owned frozen frames, released together.
    source_volume_ids: Vec<String>,
    reference_display_volume_id: String,
    secondary_display_volume_id: Option<String>,
    /// Tiled categorical palette, built once: the label table is fixed for a
    /// session. The renderer skips the upload when the palette is unchanged.
    palette: Vec<u8>,
    session: Session,
    /// Folder of this document's last successful save: the next save dialog
    /// opens there.
    last_save_dir: Option<PathBuf>,
}

/// Id k at texel (k % WIDTH, k / WIDTH), sized to the largest declared id, so
/// tables within 1–2047 keep the one-row LUT.
fn label_palette(labels: &[bf_segmentation::LabelDefinition]) -> Vec<u8> {
    let row_bytes = render_loop::texture_manager::COLORMAP_ROW_BYTES;
    let width = render_loop::texture_manager::COLORMAP_LUT_WIDTH as usize;
    let largest = labels
        .iter()
        .map(|label| usize::from(label.id))
        .max()
        .unwrap_or(0);
    let mut palette = vec![0u8; (largest / width + 1) * row_bytes];
    for label in labels {
        let at = usize::from(label.id) * 4;
        palette[at..at + 3].copy_from_slice(&label.color);
        palette[at + 3] = 255;
    }
    palette
}
pub(crate) struct SegmentationState {
    sessions: Mutex<HashMap<String, Record>>,
}
#[async_trait]
impl BridgeModule for SegmentationModule {
    fn descriptor(&self) -> &'static ModuleDescriptor {
        &DESCRIPTOR
    }
    fn register_state(&self, slots: &mut ModuleSlots) {
        slots.insert(SegmentationState {
            sessions: Mutex::new(HashMap::new()),
        });
    }
    // Disabling revokes editing through the gate; unsaved documents/history and
    // their ordinary display layers remain owned. No module-specific GPU pool.
    async fn on_workspace_dispose(
        &self,
        ctx: &ModuleCtx<'_>,
        workspace: &WorkspaceIdentity,
    ) -> Vec<String> {
        let Some(state) = ctx.state::<SegmentationState>() else {
            return Vec::new();
        };
        let mut sessions = state.sessions.lock().await;
        let ids: Vec<_> = sessions
            .iter()
            .filter(|(_, record)| record.workspace == *workspace)
            .map(|(id, _)| id.clone())
            .collect();
        ids.into_iter()
            .flat_map(|id| {
                sessions.remove(&id).into_iter().flat_map(|record| {
                    std::iter::once(record.label_volume_id).chain(record.source_volume_ids)
                })
            })
            .collect()
    }
}
fn invalid(details: impl Into<String>) -> BridgeError {
    BridgeError::Input {
        code: 12100,
        details: details.into(),
    }
}
fn domain(error: bf_segmentation::Error) -> BridgeError {
    invalid(error.to_string())
}
fn workspace(owner: &Operation) -> WorkspaceIdentity {
    WorkspaceIdentity {
        workspace_id: owner.workspace_id.clone(),
        workspace_instance: owner.workspace_instance.clone(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SegmentationAccess {
    pub workspace: WorkspaceIdentity,
    pub session_id: Option<String>,
}
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SegmentationSessionInfo {
    pub snapshot: Snapshot,
    pub label_volume_id: String,
    /// The 3D volume to display as the reference: the reference itself, or
    /// a session-owned copy of the chosen frame of a 4D reference.
    pub reference_display_volume_id: String,
    pub secondary_display_volume_id: Option<String>,
    pub palette_id: Option<u32>,
    pub render_error: Option<String>,
}
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SegmentationSlice {
    pub revision: u32,
    pub plane: neuro_types::ViewRectMm,
    pub labels: Vec<[u32; 4]>,
    pub previous_labels: Vec<[u32; 4]>,
    pub next_labels: Vec<[u32; 4]>,
}
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SegmentationCommit {
    pub session: SegmentationSessionInfo,
    pub preview: Option<bf_segmentation::Preview>,
}

async fn info(
    record: &Record,
    state: &BridgeState,
    render_error: Option<String>,
    operation: &tokio::sync::MutexGuard<'_, ()>,
) -> SegmentationSessionInfo {
    let render_error = match admit_edit(state, record).await {
        Err(error) => Some(error.to_string()),
        Ok(()) => render_error,
    };
    let render_error = render_error.or(
        match crate::editable_labels::synchronize_locked(
            state,
            operation,
            &record.label_volume_id,
            None,
        )
        .await
        {
            Ok(error) => error,
            Err(error) => Some(error.to_string()),
        },
    );
    let snapshot = record.session.snapshot();
    let renderer = state.render_loop_service.lock().await.clone();
    let mut render_error = render_error;
    let palette_id = if let Some(renderer) = renderer {
        match renderer.lock().await.upsert_custom_colormap(
            format!("editable-label:{}", record.label_volume_id),
            &record.palette,
        ) {
            Ok(id) => Some(id),
            Err(error) => {
                render_error = Some(error.to_string());
                None
            }
        }
    } else {
        None
    };
    SegmentationSessionInfo {
        snapshot,
        label_volume_id: record.label_volume_id.clone(),
        reference_display_volume_id: record.reference_display_volume_id.clone(),
        secondary_display_volume_id: record.secondary_display_volume_id.clone(),
        palette_id,
        render_error,
    }
}

/// A 3D source is used as loaded. A 4D source needs an explicit frame, which
/// is copied into a session-owned 3D volume on the 4D NeuroSpace's spatial
/// grid, so tracing never follows the shared time cursor.
fn frozen_frame(
    source: &VolumeSendable,
    metadata: &VolumeMetadataInfo,
    frame: Option<u32>,
    role: &str,
) -> BridgeResult<Option<(VolumeSendable, VolumeMetadataInfo)>> {
    use bridge_types::VolumeType;
    match (&metadata.volume_type, frame) {
        (VolumeType::Volume3D, None) => Ok(None),
        (VolumeType::Volume3D, Some(_)) => Err(invalid(format!(
            "The {role} is a single 3D volume; do not choose a frame"
        ))),
        (VolumeType::TimeSeries4D, None) => Err(invalid(format!(
            "Choose which volume of the 4D {role} to use"
        ))),
        (VolumeType::TimeSeries4D, Some(timepoint)) => {
            let frame = volume_service::frames::extract_frame(source, timepoint as usize)?;
            let space =
                NeuroSpace::from_affine_matrix4(frame.dims.to_vec(), frame.affine.to_homogeneous())
                    .map_err(|error| invalid(error.to_string()))?;
            let affine = frame.affine;
            let volume = VolumeSendable::VolF32(
                DenseVolume3::from_data(space, frame.values.into_owned()),
                affine,
            );
            Ok(Some((
                volume,
                VolumeMetadataInfo {
                    name: format!("{} · frame {timepoint}", metadata.name),
                    path: "memory:segmentation-frame".into(),
                    dtype: "f32".into(),
                    volume_type: VolumeType::Volume3D,
                    time_series_info: None,
                },
            )))
        }
    }
}

async fn create(
    state: &BridgeState,
    request: SessionSetup,
) -> BridgeResult<SegmentationSessionInfo> {
    let owner = WorkspaceIdentity {
        workspace_id: request.workspace_id.clone(),
        workspace_instance: request.workspace_instance.clone(),
    };
    let module = state
        .modules
        .enter_workspace::<SegmentationState>(ID, &owner)
        .await?;
    let _operation = state.volume_operations.lock().await;
    let duplicate = |sessions: &HashMap<String, Record>| {
        if sessions.values().any(|record| record.workspace == owner) {
            Err(invalid("This workspace already has a segmentation session"))
        } else {
            Ok(())
        }
    };
    duplicate(&*module.sessions.lock().await)?;
    let palette = label_palette(&request.labels);
    let source_volume_ids: Vec<_> = std::iter::once(request.reference_volume_id.clone())
        .chain(request.secondary_volume_id.iter().cloned())
        .collect();
    // Every u16 id has a palette texel; the domain rejects id 0.
    const _: () = assert!(render_loop::texture_manager::LABEL_LUT_CAPACITY > u16::MAX as u32);
    if request.secondary_frame.is_some() && request.secondary_volume_id.is_none() {
        return Err(invalid("A secondary frame needs a secondary contrast"));
    }
    let (source, header, reference_metadata, secondary) = {
        let registry = state.volume_registry.lock().await;
        let entry = registry
            .get_entry(&request.reference_volume_id)
            .ok_or_else(|| invalid("Reference image is no longer loaded"))?;
        let secondary = match request.secondary_volume_id.as_ref() {
            Some(secondary) if secondary == &request.reference_volume_id => {
                return Err(invalid("Select a distinct secondary contrast"));
            }
            Some(secondary) => {
                let secondary = registry
                    .get_entry(secondary)
                    .ok_or_else(|| invalid("Secondary contrast is no longer loaded"))?;
                Some((secondary.data.clone(), secondary.metadata.clone()))
            }
            None => None,
        };
        (
            entry.data.clone(),
            entry.source_nifti_header.clone(),
            entry.metadata.clone(),
            secondary,
        )
    };
    let dims = crate::get_spatial_dims_from_volume(&source);
    let dimensions = [dims[0] as u32, dims[1] as u32, dims[2] as u32];
    // For 4D sources this reads the origin from the transform's LAST column.
    let affine = crate::get_affine_from_volume(&source)?;
    let matrix = affine.to_homogeneous();
    let id = uuid::Uuid::new_v4().to_string();
    let session = if let Some(header) = header.as_ref() {
        Session::create_from_header_bytes(id.clone(), request, matrix, header).map_err(domain)?
    } else {
        let frames = volume_service::frames::frame_count(&source).map(|n| n as u32);
        Session::create_on_derived_grid(id.clone(), request, dimensions, matrix, frames)
            .map_err(domain)?
    };
    if session.volume().dimensions() != dimensions {
        return Err(invalid(
            "Retained source header does not match the loaded reference grid",
        ));
    }
    // Volume operations are held, so the sources stay registered while their
    // frames are copied on a blocking thread, without the registry or session
    // locks. The duplicate check is repeated before publication.
    let (reference_frame, secondary_frame) = {
        let source = source.clone();
        let (reference_choice, secondary_choice) = {
            let snapshot = session.snapshot();
            (snapshot.reference_frame, snapshot.secondary_frame)
        };
        tokio::task::spawn_blocking(move || {
            let reference = frozen_frame(
                &source,
                &reference_metadata,
                reference_choice,
                "reference image",
            )?;
            let secondary = match &secondary {
                Some((data, metadata)) => {
                    frozen_frame(data, metadata, secondary_choice, "secondary contrast")?
                }
                None => None,
            };
            Ok::<_, BridgeError>((reference, secondary))
        })
        .await
        .map_err(|error| BridgeError::Internal {
            code: 12104,
            details: format!("Frame copy task failed: {error}"),
        })??
    };
    let count = dims[..3]
        .iter()
        .try_fold(1usize, |n, &v| n.checked_mul(v))
        .ok_or_else(|| invalid("Reference grid is too large"))?;
    let mut labels = Vec::<u16>::new();
    labels
        .try_reserve_exact(count)
        .map_err(|_| invalid("Insufficient memory for the label volume"))?;
    labels.resize(count, 0);
    let space = NeuroSpace::from_affine_matrix4(dims[..3].to_vec(), matrix)
        .map_err(|error| invalid(error.to_string()))?;
    let volume = VolumeSendable::VolU16(DenseVolume3::from_data(space, labels), affine);
    let label_volume_id = format!("segmentation_labels_{id}");
    let frame_id = |role: &str| format!("segmentation_frame_{id}_{role}");
    let reference_display_volume_id = if reference_frame.is_some() {
        frame_id("reference")
    } else {
        source_volume_ids[0].clone()
    };
    let secondary_display_volume_id = match (&secondary_frame, source_volume_ids.get(1)) {
        (Some(_), _) => Some(frame_id("secondary")),
        (None, Some(secondary)) => Some(secondary.clone()),
        (None, None) => None,
    };
    let mut owned_volume_ids = Vec::new();
    let mut sessions = module.sessions.lock().await;
    duplicate(&sessions)?;
    {
        let mut registry = state.volume_registry.lock().await;
        // Validate every source and every increment before publishing the label
        // document. Under volume_operations these entries remain stable through
        // session installation, so no fallible path leaves a partial pin behind.
        for source_id in &source_volume_ids {
            let source = registry
                .get_entry(source_id)
                .ok_or_else(|| invalid("Segmentation source is no longer loaded"))?;
            source
                .document_references
                .checked_add(1)
                .ok_or_else(|| invalid("Segmentation source reference count is exhausted"))?;
        }
        registry.insert_editable_labels(
            label_volume_id.clone(),
            volume,
            VolumeMetadataInfo {
                name: "Segmentation labels".into(),
                path: "memory:editable-labels".into(),
                dtype: "u16".into(),
                volume_type: bridge_types::VolumeType::Volume3D,
                time_series_info: None,
            },
            0,
        )?;
        let entry = registry
            .volumes
            .get_mut(&label_volume_id)
            .expect("published labels");
        entry.source_nifti_header = header;
        registry.parcel_dictionaries.insert(
            label_volume_id.clone(),
            atlases::parcel_dictionary::ParcelDictionary {
                name: "Segmentation labels".into(),
                labels: session
                    .snapshot()
                    .labels
                    .iter()
                    .map(|label| {
                        neuroatlas::Label::new(
                            u32::from(label.definition.id),
                            label.definition.name.clone(),
                        )
                    })
                    .collect(),
                full_labels: None,
            },
        );
        // Frozen frames are owned by this document alone (one reference).
        for (frame_volume_id, frame) in [
            (frame_id("reference"), reference_frame),
            (frame_id("secondary"), secondary_frame),
        ] {
            if let Some((data, metadata)) = frame {
                registry.insert(frame_volume_id.clone(), data, metadata);
                registry
                    .volumes
                    .get_mut(&frame_volume_id)
                    .expect("published frame")
                    .document_references = 1;
                owned_volume_ids.push(frame_volume_id);
            }
        }
        for source_id in &source_volume_ids {
            registry
                .volumes
                .get_mut(source_id)
                .expect("validated segmentation source")
                .document_references += 1;
        }
    }
    let record = Record {
        workspace: owner,
        label_volume_id,
        source_volume_ids: source_volume_ids
            .into_iter()
            .chain(owned_volume_ids)
            .collect(),
        reference_display_volume_id,
        secondary_display_volume_id,
        palette,
        session,
        last_save_dir: None,
    };
    let result = info(&record, state, None, &_operation).await;
    sessions.insert(id, record);
    Ok(result)
}

async fn get(
    state: &BridgeState,
    access: SegmentationAccess,
) -> BridgeResult<SegmentationSessionInfo> {
    let module = state
        .modules
        .enter_workspace::<SegmentationState>(ID, &access.workspace)
        .await?;
    let _operation = state.volume_operations.lock().await;
    let sessions = module.sessions.lock().await;
    let record = match access.session_id.as_deref() {
        Some(id) => sessions
            .get(id)
            .filter(|record| record.workspace == access.workspace),
        None => sessions
            .values()
            .find(|record| record.workspace == access.workspace),
    }
    .ok_or_else(|| invalid("Segmentation session was closed or replaced"))?;
    Ok(info(record, state, None, &_operation).await)
}
async fn preview(state: &BridgeState, stroke: Stroke) -> BridgeResult<bf_segmentation::Preview> {
    let module = state
        .modules
        .enter_workspace::<SegmentationState>(ID, &workspace(&stroke.owner))
        .await?;
    let _operation = state.volume_operations.lock().await;
    let sessions = module.sessions.lock().await;
    let record = sessions
        .get(&stroke.owner.session_id)
        .ok_or_else(|| invalid("Segmentation session was closed"))?;
    record.session.preview(&stroke).map_err(domain)
}
/// Check the authoritative publication before mutating domain history. The
/// caller holds volume_operations, so normal unload/publication cannot race.
async fn admit_edit(state: &BridgeState, record: &Record) -> BridgeResult<()> {
    let registry = state.volume_registry.lock().await;
    let entry = registry
        .get_entry(&record.label_volume_id)
        .ok_or_else(|| invalid("Editable labels are no longer published"))?;
    if entry.document_references == 0
        || entry.editable_revision != Some(record.session.volume().revision())
        || !matches!(entry.data.as_ref(), VolumeSendable::VolU16(_, _))
        || crate::get_spatial_dims_from_volume(&entry.data)[..3]
            != record.session.volume().dimensions().map(|n| n as usize)
    {
        return Err(invalid(
            "Editable label publication does not match the session; editing is frozen",
        ));
    }
    Ok(())
}

fn allocate_region(region: label_store::Region) -> BridgeResult<Vec<u16>> {
    let count = region
        .dimensions()
        .iter()
        .try_fold(1usize, |n, &v| n.checked_mul(v as usize))
        .ok_or_else(|| invalid("Publication region overflows"))?;
    let mut labels = Vec::new();
    labels
        .try_reserve_exact(count)
        .map_err(|_| invalid("Insufficient memory for label publication; no edit was applied"))?;
    labels.resize(count, 0);
    Ok(labels)
}
fn preview_region(preview: &bf_segmentation::Preview) -> Option<label_store::Region> {
    let first = *preview.written.first()?;
    let mut region = label_store::Region {
        origin: first,
        end: first.map(|v| v + 1),
    };
    for voxel in &preview.written {
        for (axis, &v) in voxel.iter().enumerate() {
            region.origin[axis] = region.origin[axis].min(v);
            region.end[axis] = region.end[axis].max(v + 1);
        }
    }
    Some(region)
}
async fn commit(state: &BridgeState, stroke: Stroke) -> BridgeResult<SegmentationCommit> {
    commit_with_allocator(state, stroke, allocate_region).await
}
async fn commit_with_allocator(
    state: &BridgeState,
    stroke: Stroke,
    allocate: impl FnOnce(label_store::Region) -> BridgeResult<Vec<u16>>,
) -> BridgeResult<SegmentationCommit> {
    let module = state
        .modules
        .enter_workspace::<SegmentationState>(ID, &workspace(&stroke.owner))
        .await?;
    let operation = state.volume_operations.lock().await;
    let mut sessions = module.sessions.lock().await;
    let record = sessions
        .get_mut(&stroke.owner.session_id)
        .ok_or_else(|| invalid("Segmentation session was closed"))?;
    admit_edit(state, record).await?;
    let previous = record.session.volume().revision();
    let planned = record.session.preview(&stroke).map_err(domain)?;
    let reserved = preview_region(&planned)
        .map(|region| allocate(region).map(|labels| (region, labels)))
        .transpose()?;
    let (preview, change) = record.session.stroke(&stroke).map_err(domain)?;
    let render_error = if change.bounds.is_some() {
        let (region, mut labels) = reserved.expect("changed stroke has reserved bounds");
        record
            .session
            .volume()
            .read_region_into(region, &mut labels)
            .expect("validated publication buffer");
        crate::editable_labels::publish_locked(
            state,
            &operation,
            &record.label_volume_id,
            &render_loop::LabelRegionUpdate {
                expected_revision: previous,
                revision: change.revision,
                origin: region.origin,
                dimensions: region.dimensions(),
                labels: &labels,
                data_range: record.session.volume().data_range(),
            },
        )
        .await?
    } else {
        None
    };
    Ok(SegmentationCommit {
        session: info(record, state, render_error, &operation).await,
        preview: Some(preview),
    })
}
async fn undo(
    state: &BridgeState,
    owner: Operation,
    redo: bool,
) -> BridgeResult<SegmentationCommit> {
    undo_with_allocator(state, owner, redo, allocate_region).await
}
async fn undo_with_allocator(
    state: &BridgeState,
    owner: Operation,
    redo: bool,
    allocate: impl FnOnce(label_store::Region) -> BridgeResult<Vec<u16>>,
) -> BridgeResult<SegmentationCommit> {
    let module = state
        .modules
        .enter_workspace::<SegmentationState>(ID, &workspace(&owner))
        .await?;
    let operation = state.volume_operations.lock().await;
    let mut sessions = module.sessions.lock().await;
    let record = sessions
        .get_mut(&owner.session_id)
        .ok_or_else(|| invalid("Segmentation session was closed"))?;
    admit_edit(state, record).await?;
    record.session.check(&owner).map_err(domain)?;
    let previous = record.session.volume().revision();
    let reserved = record
        .session
        .volume()
        .history_region(redo)
        .map(|region| allocate(region).map(|labels| (region, labels)))
        .transpose()?;
    let change = record.session.undo(&owner, redo).map_err(domain)?;
    let render_error = if change.bounds.is_some() {
        let (region, mut labels) = reserved.expect("history travel has reserved bounds");
        record
            .session
            .volume()
            .read_region_into(region, &mut labels)
            .expect("validated publication buffer");
        crate::editable_labels::publish_locked(
            state,
            &operation,
            &record.label_volume_id,
            &render_loop::LabelRegionUpdate {
                expected_revision: previous,
                revision: change.revision,
                origin: region.origin,
                dimensions: region.dimensions(),
                labels: &labels,
                data_range: record.session.volume().data_range(),
            },
        )
        .await?
    } else {
        None
    };
    Ok(SegmentationCommit {
        session: info(record, state, render_error, &operation).await,
        preview: None,
    })
}
async fn label_state(
    state: &BridgeState,
    owner: Operation,
    label_id: u16,
    locked: bool,
    complete: bool,
) -> BridgeResult<SegmentationSessionInfo> {
    let module = state
        .modules
        .enter_workspace::<SegmentationState>(ID, &workspace(&owner))
        .await?;
    let _operation = state.volume_operations.lock().await;
    let mut sessions = module.sessions.lock().await;
    let record = sessions
        .get_mut(&owner.session_id)
        .ok_or_else(|| invalid("Segmentation session was closed"))?;
    record
        .session
        .set_label_state(&owner, label_id, locked, complete)
        .map_err(domain)?;
    Ok(info(record, state, None, &_operation).await)
}
async fn slice(
    state: &BridgeState,
    owner: Operation,
    slice_index: u32,
    dimensions: [u32; 2],
    flips: [bool; 2],
) -> BridgeResult<SegmentationSlice> {
    let module = state
        .modules
        .enter_workspace::<SegmentationState>(ID, &workspace(&owner))
        .await?;
    let _operation = state.volume_operations.lock().await;
    let sessions = module.sessions.lock().await;
    let record = sessions
        .get(&owner.session_id)
        .ok_or_else(|| invalid("Segmentation session was closed"))?;
    record.session.check(&owner).map_err(domain)?;
    let labels = record.session.slice_labels(slice_index).map_err(domain)?;
    let count = record.session.volume().dimensions()[usize::from(record.session.normal_axis())];
    Ok(SegmentationSlice {
        revision: owner.base_revision,
        plane: record
            .session
            .native_plane(slice_index, dimensions, flips)
            .map_err(domain)?,
        labels,
        previous_labels: if slice_index > 0 {
            record
                .session
                .slice_labels(slice_index - 1)
                .map_err(domain)?
        } else {
            Vec::new()
        },
        next_labels: if slice_index + 1 < count {
            record
                .session
                .slice_labels(slice_index + 1)
                .map_err(domain)?
        } else {
            Vec::new()
        },
    })
}

/// Copy the accepted revision the caller displayed. The module gate and the
/// document locks are released before any dialog is shown.
#[cfg(test)]
async fn export_labels(state: &BridgeState, owner: Operation) -> BridgeResult<LabelExport> {
    Ok(export_with_folder(state, owner).await?.0)
}

/// The export plus the folder the save dialog should open in: the document's
/// last save folder, else the reference image's folder (never the app's
/// working directory, which is a repository folder in development).
async fn export_with_folder(
    state: &BridgeState,
    owner: Operation,
) -> BridgeResult<(LabelExport, Option<PathBuf>)> {
    // Copy what the folder choice needs, then release the module gate and
    // document locks before touching the filesystem: a stalled network mount
    // must not hang every segmentation command.
    let (export, last_save_dir, reference_path) = {
        let module = state
            .modules
            .enter_workspace::<SegmentationState>(ID, &workspace(&owner))
            .await?;
        let _operation = state.volume_operations.lock().await;
        let sessions = module.sessions.lock().await;
        let record = sessions
            .get(&owner.session_id)
            .filter(|record| record.workspace == workspace(&owner))
            .ok_or_else(|| invalid("Segmentation session was closed"))?;
        let export = record.session.export(&owner).map_err(domain)?;
        let reference_path = state
            .volume_registry
            .lock()
            .await
            .get_entry(record.session.reference_volume_id())
            .map(|entry| entry.metadata.path.clone());
        (export, record.last_save_dir.clone(), reference_path)
    };
    let folder = tokio::task::spawn_blocking(move || {
        default_save_folder(last_save_dir.as_deref(), reference_path.as_deref())
    })
    .await
    .unwrap_or(None);
    Ok((export, folder))
}

/// First existing folder of: the last save folder, the reference file's folder.
fn default_save_folder(
    last_save_dir: Option<&std::path::Path>,
    reference_path: Option<&str>,
) -> Option<PathBuf> {
    let reference_dir = reference_path
        .map(std::path::Path::new)
        .filter(|path| path.is_absolute())
        .and_then(std::path::Path::parent);
    last_save_dir
        .into_iter()
        .chain(reference_dir)
        .find(|dir| dir.is_dir())
        .map(std::path::Path::to_path_buf)
}

/// Remember where this document was saved, for its next save dialog.
async fn remember_save_folder(state: &BridgeState, owner: &Operation, label_path: &str) {
    let Some(folder) = std::path::Path::new(label_path).parent() else {
        return;
    };
    let Ok(module) = state
        .modules
        .enter_workspace::<SegmentationState>(ID, &workspace(owner))
        .await
    else {
        return;
    };
    let mut sessions = module.sessions.lock().await;
    if let Some(record) = sessions
        .get_mut(&owner.session_id)
        .filter(|record| record.workspace == workspace(owner))
    {
        record.last_save_dir = Some(folder.to_path_buf());
    }
}
/// Write a copied revision to the path picked in the save dialog.
async fn save_labels_to(export: LabelExport, picked: PathBuf) -> BridgeResult<SavedLabels> {
    tokio::task::spawn_blocking(move || {
        let target = bf_segmentation::resolve_destination(&picked).map_err(domain)?;
        bf_segmentation::write_export(&export, &target).map_err(|error| BridgeError::Io {
            code: 12101,
            details: format!(
                "Could not save labels to {}: {error}",
                target.label_path.display()
            ),
        })
    })
    .await
    .map_err(|error| BridgeError::Internal {
        code: 12102,
        details: format!("Label save task failed: {error}"),
    })?
}

#[tauri::command]
pub(crate) async fn segmentation_create_session(
    request: SessionSetup,
    state: State<'_, BridgeState>,
) -> BridgeResult<SegmentationSessionInfo> {
    create(state.inner(), request).await
}
#[tauri::command]
pub(crate) async fn segmentation_get_session(
    access: SegmentationAccess,
    state: State<'_, BridgeState>,
) -> BridgeResult<SegmentationSessionInfo> {
    get(state.inner(), access).await
}
#[tauri::command]
pub(crate) async fn segmentation_preview_stroke(
    stroke: Stroke,
    state: State<'_, BridgeState>,
) -> BridgeResult<bf_segmentation::Preview> {
    preview(state.inner(), stroke).await
}
#[tauri::command]
pub(crate) async fn segmentation_commit_stroke(
    stroke: Stroke,
    state: State<'_, BridgeState>,
) -> BridgeResult<SegmentationCommit> {
    commit(state.inner(), stroke).await
}
#[tauri::command]
pub(crate) async fn segmentation_undo(
    owner: Operation,
    redo: bool,
    state: State<'_, BridgeState>,
) -> BridgeResult<SegmentationCommit> {
    undo(state.inner(), owner, redo).await
}
#[tauri::command]
pub(crate) async fn segmentation_set_label_state(
    owner: Operation,
    label_id: u16,
    locked: bool,
    complete: bool,
    state: State<'_, BridgeState>,
) -> BridgeResult<SegmentationSessionInfo> {
    label_state(state.inner(), owner, label_id, locked, complete).await
}
#[tauri::command]
pub(crate) async fn segmentation_get_slice(
    owner: Operation,
    slice_index: u32,
    dimensions: [u32; 2],
    flips: [bool; 2],
    state: State<'_, BridgeState>,
) -> BridgeResult<SegmentationSlice> {
    slice(state.inner(), owner, slice_index, dimensions, flips).await
}

/// Save the accepted label document (the caller's displayed revision) as
/// NIfTI plus its dseg.tsv, to a destination chosen in a native save dialog.
/// Returns `null` when the dialog is cancelled. There is deliberately no path
/// argument: writes always go through the dialog.
#[tauri::command]
pub(crate) async fn segmentation_save_labels<R: Runtime>(
    owner: Operation,
    app: AppHandle<R>,
    state: State<'_, BridgeState>,
) -> BridgeResult<Option<SavedLabels>> {
    let (export, folder) = export_with_folder(state.inner(), owner.clone()).await?;
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut dialog = app
        .dialog()
        .file()
        .set_title("Save labels as NIfTI")
        .set_file_name(export.suggested_name.clone());
    if let Some(folder) = folder {
        dialog = dialog.set_directory(folder);
    }
    dialog.save_file(move |picked| {
        let _ = tx.send(picked);
    });
    let picked = rx.await.map_err(|_| BridgeError::Internal {
        code: 12103,
        details: "Save dialog closed without a response".into(),
    })?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let picked = picked
        .into_path()
        .map_err(|error| invalid(format!("Unsupported save location: {error}")))?;
    let saved = save_labels_to(export, picked).await?;
    remember_save_folder(state.inner(), &owner, &saved.label_path).await;
    Ok(Some(saved))
}

#[cfg(test)]
mod tests {
    use super::*;
    use bf_segmentation::{Identity, LabelDefinition, PaintOver, Tool};
    fn setup() -> SessionSetup {
        SessionSetup {
            workspace_id: "synthetic-view".into(),
            workspace_instance: "opaque-test-a".into(),
            reference_volume_id: "reference".into(),
            identity: Identity {
                subject: "synthetic-01".into(),
                session: "01".into(),
                hemisphere: "left".into(),
                rater: "rater-a".into(),
                blind: true,
            },
            normal_axis: 1,
            labels: vec![LabelDefinition {
                id: 1,
                name: "ROI A".into(),
                abbreviation: "A".into(),
                color: [200, 100, 30],
                parent: None,
            }],
            secondary_volume_id: None,
            registration: None,
            reference_frame: None,
            secondary_frame: None,
        }
    }
    fn state() -> BridgeState {
        let state = BridgeState::default().unwrap();
        let source = DenseVolume3::from_data(
            NeuroSpace::from_dims_spacing_origin(vec![5, 3, 7], vec![0.4, 2.0, 0.4], vec![0.0; 3])
                .unwrap(),
            vec![1f32; 105],
        );
        let affine = nalgebra::Affine3::from_matrix_unchecked(source.space().voxel_to_world());
        state.volume_registry.blocking_lock().insert(
            "reference".into(),
            VolumeSendable::VolF32(source, affine),
            VolumeMetadataInfo {
                name: "Synthetic reference".into(),
                path: "memory:reference".into(),
                dtype: "f32".into(),
                volume_type: bridge_types::VolumeType::Volume3D,
                time_series_info: None,
            },
        );
        state
    }
    fn access(info: &SegmentationSessionInfo) -> SegmentationAccess {
        SegmentationAccess {
            workspace: WorkspaceIdentity {
                workspace_id: info.snapshot.workspace_id.clone(),
                workspace_instance: info.snapshot.workspace_instance.clone(),
            },
            session_id: Some(info.snapshot.session_id.clone()),
        }
    }
    fn operation(info: &SegmentationSessionInfo) -> Operation {
        Operation {
            workspace_id: info.snapshot.workspace_id.clone(),
            workspace_instance: info.snapshot.workspace_instance.clone(),
            session_id: info.snapshot.session_id.clone(),
            base_revision: info.snapshot.revision,
        }
    }
    fn stroke(info: &SegmentationSessionInfo) -> Stroke {
        Stroke {
            owner: operation(info),
            label_id: 1,
            slice_index: 1,
            tool: Tool::Brush,
            radius_mm: 0.41,
            points_world: vec![[0.8, 2.0, 1.2]],
            paint_over: PaintOver::Unlocked,
        }
    }

    #[tokio::test]
    async fn native_document_survives_disable_and_restores_exact_undo_history() {
        let state = tokio::task::spawn_blocking(state).await.unwrap();
        let created = create(&state, setup()).await.unwrap();
        let recovered = get(
            &state,
            SegmentationAccess {
                workspace: workspace(&operation(&created)),
                session_id: None,
            },
        )
        .await
        .unwrap();
        assert_eq!(recovered.snapshot.session_id, created.snapshot.session_id, "a lost create acknowledgement can be recovered by its retained opaque workspace identity");
        let previewed = preview(&state, stroke(&created)).await.unwrap();
        assert_eq!(previewed.written.len(), 5);
        let painted = commit(&state, stroke(&created)).await.unwrap().session;
        assert_eq!(painted.snapshot.labels[0].voxels, 5.0);
        let before = state
            .volume_registry
            .lock()
            .await
            .get_arc(&painted.label_volume_id)
            .unwrap();
        state.modules.set_enabled(&[]).await.unwrap();
        assert!(matches!(
            get(&state, access(&painted)).await,
            Err(BridgeError::ModuleDisabled { .. })
        ));
        assert!(matches!(
            preview(&state, stroke(&painted)).await,
            Err(BridgeError::ModuleDisabled { .. })
        ));
        assert!(state
            .volume_registry
            .lock()
            .await
            .contains(&painted.label_volume_id));
        state.modules.set_enabled(&[ID.into()]).await.unwrap();
        let restored = get(&state, access(&painted)).await.unwrap();
        assert_eq!(restored.snapshot.revision, painted.snapshot.revision);
        assert_eq!(restored.snapshot.undo, painted.snapshot.undo);
        assert_eq!(restored.snapshot.labels[0].slice_voxels, [0, 5, 0]);
        let undone = undo(&state, operation(&restored), false)
            .await
            .unwrap()
            .session;
        assert_eq!(undone.snapshot.labels[0].voxels, 0.0);
        let redone = undo(&state, operation(&undone), true)
            .await
            .unwrap()
            .session;
        let after = state
            .volume_registry
            .lock()
            .await
            .get_arc(&redone.label_volume_id)
            .unwrap();
        assert_eq!(before.as_ref(), after.as_ref());
        let view = slice(&state, operation(&redone), 1, [5, 7], [false, true])
            .await
            .unwrap();
        assert_eq!(view.labels.len(), 5);
        assert_eq!((view.plane.width_px, view.plane.height_px), (5, 7));
    }

    #[tokio::test]
    async fn disabled_document_disposal_reclaims_unreferenced_labels_and_rejects_resurrection() {
        let state = tokio::task::spawn_blocking(state).await.unwrap();
        let created = create(&state, setup()).await.unwrap();
        let owner = access(&created).workspace;
        state.modules.set_enabled(&[]).await.unwrap();
        state
            .modules
            .dispose_workspace(&state, &owner)
            .await
            .unwrap();
        assert!(!state
            .volume_registry
            .lock()
            .await
            .contains(&created.label_volume_id));
        state.modules.set_enabled(&[ID.into()]).await.unwrap();
        assert!(create(&state, setup()).await.is_err());
        assert!(get(&state, access(&created)).await.is_err());
        // The last document release also frees its source pin. A fresh
        // workspace must use a freshly loaded source, never resurrect one.
        let source = DenseVolume3::from_data(
            NeuroSpace::from_dims_spacing_origin(vec![5, 3, 7], vec![0.4, 2.0, 0.4], vec![0.0; 3])
                .unwrap(),
            vec![1f32; 105],
        );
        let affine = nalgebra::Affine3::from_matrix_unchecked(source.space().voxel_to_world());
        state.volume_registry.lock().await.insert(
            "reference".into(),
            VolumeSendable::VolF32(source, affine),
            VolumeMetadataInfo {
                name: "Reloaded reference".into(),
                path: "memory:reference-reloaded".into(),
                dtype: "f32".into(),
                volume_type: bridge_types::VolumeType::Volume3D,
                time_series_info: None,
            },
        );
        let mut next = setup();
        next.workspace_instance = "opaque-test-b".into();
        assert!(create(&state, next).await.is_ok());
    }

    #[tokio::test]
    async fn shared_source_pins_survive_disabled_unload_until_the_last_workspace_disposes() {
        use volume_service::VolumeRepository;

        let state = tokio::task::spawn_blocking(state).await.unwrap();
        {
            let mut registry = state.volume_registry.lock().await;
            let (data, metadata) = {
                let reference = registry.get_entry("reference").unwrap();
                (reference.data.as_ref().clone(), reference.metadata.clone())
            };
            registry.insert("secondary".into(), data, metadata);
        }
        let mut first_request = setup();
        first_request.secondary_volume_id = Some("secondary".into());
        first_request.registration = Some(bf_segmentation::Registration::Aligned {
            confirmer: "rater-a".into(),
            confirmed_at_ms: 1.0,
            transform_hash: "shared-source-fixture".into(),
            view: [0.0; 12],
        });
        let first = create(&state, first_request.clone()).await.unwrap();
        let mut second_request = first_request;
        second_request.workspace_instance = "opaque-test-b".into();
        let second = create(&state, second_request).await.unwrap();
        let painted_second = commit(&state, stroke(&second)).await.unwrap().session;

        state.modules.set_enabled(&[]).await.unwrap();
        crate::volume_loading::DesktopVolumeRepository(&state)
            .remove("reference")
            .await
            .unwrap();
        crate::volume_loading::DesktopVolumeRepository(&state)
            .remove("secondary")
            .await
            .unwrap();
        {
            let registry = state.volume_registry.lock().await;
            for id in ["reference", "secondary"] {
                assert!(registry.contains(id), "disabled unload retained {id}");
                assert_eq!(registry.get_entry(id).unwrap().document_references, 2);
            }
        }

        state
            .modules
            .dispose_workspace(&state, &access(&first).workspace)
            .await
            .unwrap();
        {
            let registry = state.volume_registry.lock().await;
            for id in ["reference", "secondary"] {
                assert!(registry.contains(id), "other document still pins {id}");
                assert_eq!(registry.get_entry(id).unwrap().document_references, 1);
            }
        }
        state.modules.set_enabled(&[ID.into()]).await.unwrap();
        let restored = get(&state, access(&painted_second)).await.unwrap();
        assert_eq!(restored.snapshot.undo, painted_second.snapshot.undo);
        assert_eq!(restored.snapshot.labels[0].voxels, 5.0);

        state.modules.set_enabled(&[]).await.unwrap();
        state
            .modules
            .dispose_workspace(&state, &access(&painted_second).workspace)
            .await
            .unwrap();
        let registry = state.volume_registry.lock().await;
        assert!(!registry.contains("reference"));
        assert!(!registry.contains("secondary"));
    }

    #[tokio::test]
    async fn publication_allocation_failure_keeps_revisions_history_and_cpu_bytes_then_allows_retry(
    ) {
        let state = tokio::task::spawn_blocking(state).await.unwrap();
        let created = create(&state, setup()).await.unwrap();
        let fail = |_| Err(invalid("injected publication allocation failure"));
        assert!(commit_with_allocator(&state, stroke(&created), fail)
            .await
            .is_err());
        let unchanged = get(&state, access(&created)).await.unwrap();
        assert_eq!(unchanged.snapshot.revision, 0);
        assert_eq!(unchanged.snapshot.label_revision, 0);
        assert_eq!(unchanged.snapshot.undo, None);
        assert_eq!(unchanged.snapshot.labels[0].voxels, 0.0);
        let painted = commit(&state, stroke(&unchanged)).await.unwrap().session;
        let bytes = state
            .volume_registry
            .lock()
            .await
            .get_arc(&painted.label_volume_id)
            .unwrap();
        assert!(
            undo_with_allocator(&state, operation(&painted), false, fail)
                .await
                .is_err()
        );
        let current = get(&state, access(&painted)).await.unwrap();
        assert_eq!(current.snapshot.revision, painted.snapshot.revision);
        assert_eq!(current.snapshot.undo, painted.snapshot.undo);
        assert_eq!(current.snapshot.redo, painted.snapshot.redo);
        assert_eq!(
            state
                .volume_registry
                .lock()
                .await
                .get_arc(&painted.label_volume_id)
                .unwrap()
                .as_ref(),
            bytes.as_ref()
        );
        let undone = undo(&state, operation(&current), false)
            .await
            .unwrap()
            .session;
        assert!(undo_with_allocator(&state, operation(&undone), true, fail)
            .await
            .is_err());
        let current = get(&state, access(&undone)).await.unwrap();
        assert_eq!(current.snapshot.revision, undone.snapshot.revision);
        assert_eq!(
            current.snapshot.label_revision,
            undone.snapshot.label_revision
        );
        assert_eq!(current.snapshot.undo, undone.snapshot.undo);
        assert_eq!(current.snapshot.redo, undone.snapshot.redo);
        assert_eq!(current.snapshot.labels[0].voxels, 0.0);
        let redone = undo(&state, operation(&current), true)
            .await
            .unwrap()
            .session;
        assert_eq!(redone.snapshot.labels[0].voxels, 5.0);
        assert_eq!(
            state
                .volume_registry
                .lock()
                .await
                .get_arc(&painted.label_volume_id)
                .unwrap()
                .as_ref(),
            bytes.as_ref()
        );
    }

    #[tokio::test]
    async fn secondary_confirmation_records_the_actual_loaded_source_and_confirmer() {
        let state = tokio::task::spawn_blocking(state).await.unwrap();
        let mut request = setup();
        request.secondary_volume_id = Some("secondary".into());
        request.registration = Some(bf_segmentation::Registration::Aligned {
            confirmer: "rater-a".into(),
            confirmed_at_ms: 42.0,
            transform_hash: "synthetic-two-affine-digest".into(),
            view: [0.0; 12],
        });
        assert!(
            create(&state, request.clone()).await.is_err(),
            "a missing secondary cannot be confirmed"
        );
        {
            let mut registry = state.volume_registry.lock().await;
            assert_eq!(
                registry.volumes.len(),
                1,
                "rejected setup never publishes provisional labels"
            );
            let source = registry.get_entry("reference").unwrap();
            let data = source.data.as_ref().clone();
            let metadata = source.metadata.clone();
            registry.insert("secondary".into(), data, metadata);
        }
        let created = create(&state, request).await.unwrap();
        assert_eq!(
            created.snapshot.secondary_volume_id.as_deref(),
            Some("secondary")
        );
        assert!(
            matches!(created.snapshot.registration, Some(bf_segmentation::Registration::Aligned { ref confirmer, confirmed_at_ms: 42.0, .. }) if confirmer == "rater-a")
        );
    }

    #[tokio::test]
    async fn inconsistent_publication_rejects_edit_before_domain_history_changes() {
        let state = tokio::task::spawn_blocking(state).await.unwrap();
        let session = create(&state, setup()).await.unwrap();
        state
            .volume_registry
            .lock()
            .await
            .volumes
            .get_mut(&session.label_volume_id)
            .unwrap()
            .editable_revision = Some(99);
        let owner = operation(&session);
        assert!(commit(&state, stroke(&session)).await.is_err());
        assert!(undo(&state, owner, false).await.is_err());
        let snapshot = get(
            &state,
            SegmentationAccess {
                workspace: workspace(&operation(&session)),
                session_id: Some(session.snapshot.session_id.clone()),
            },
        )
        .await
        .unwrap();
        assert_eq!(snapshot.snapshot.revision, 0);
        assert_eq!(snapshot.snapshot.label_revision, 0);
        assert_eq!(snapshot.snapshot.undo, None);
        state.modules.set_enabled(&[]).await.unwrap();
        let guard = state.modules.begin_document_exit(&state).await;
        assert!(
            guard.has_documents(),
            "disabled unsaved documents still block quit"
        );
        drop(guard);
    }

    #[tokio::test]
    async fn duplicate_setup_and_stale_revisions_never_replace_existing_labels() {
        let state = tokio::task::spawn_blocking(state).await.unwrap();
        let created = create(&state, setup()).await.unwrap();
        assert!(create(&state, setup()).await.is_err());
        let painted = commit(&state, stroke(&created)).await.unwrap().session;
        assert!(commit(&state, stroke(&created)).await.is_err());
        label_state(&state, operation(&painted), 1, true, true)
            .await
            .unwrap();
        let current = get(&state, access(&painted)).await.unwrap();
        assert!(commit(&state, stroke(&current)).await.is_err());
        assert_eq!(
            get(&state, access(&current)).await.unwrap().snapshot.labels[0].voxels,
            5.0
        );
    }

    #[tokio::test]
    async fn save_writes_the_displayed_revision_and_refuses_stale_or_disabled_owners() {
        use nifti::{NiftiObject, RandomAccessNiftiVolume};
        let state = tokio::task::spawn_blocking(state).await.unwrap();
        let created = create(&state, setup()).await.unwrap();
        let painted = commit(&state, stroke(&created)).await.unwrap().session;
        assert!(
            export_labels(&state, operation(&created)).await.is_err(),
            "a stale revision is never saved as if it were current"
        );
        let mut foreign = operation(&painted);
        foreign.workspace_instance = "opaque-test-b".into();
        assert!(export_labels(&state, foreign).await.is_err());
        let export = export_labels(&state, operation(&painted)).await.unwrap();
        assert_eq!(
            export.suggested_name,
            "sub-synthetic01_ses-01_desc-ratera_dseg.nii.gz"
        );
        let dir = std::env::temp_dir().join(format!("bf-seg-save-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let saved = save_labels_to(export, dir.join("labels")).await.unwrap();
        assert_eq!(saved.revision, painted.snapshot.revision);
        assert_eq!(saved.session_id, painted.snapshot.session_id);
        let object = nifti::ReaderOptions::new()
            .read_file(&saved.label_path)
            .unwrap();
        assert_eq!(object.header().intent_code, 1002);
        let mut labelled = 0;
        for z in 0..7u16 {
            for y in 0..3u16 {
                for x in 0..5u16 {
                    labelled += u32::from(object.volume().get_u16(&[x, y, z]).unwrap() == 1);
                }
            }
        }
        assert_eq!(labelled, 5);
        assert!(std::fs::read_to_string(&saved.table_path)
            .unwrap()
            .contains("1\tROI A\tA\t#c8641e\tn/a"));
        state.modules.set_enabled(&[]).await.unwrap();
        assert!(matches!(
            export_labels(&state, operation(&painted)).await,
            Err(BridgeError::ModuleDisabled { .. })
        ));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[tokio::test]
    async fn label_ids_across_the_u16_range_are_accepted_and_painted() {
        let state = tokio::task::spawn_blocking(state).await.unwrap();
        let mut request = setup();
        request.labels[0].id = u16::MAX;
        let created = create(&state, request).await.unwrap();
        let mut paint = stroke(&created);
        paint.label_id = u16::MAX;
        let painted = commit(&state, paint).await.unwrap().session;
        assert_eq!(painted.snapshot.labels[0].voxels, 5.0);
        let registry = state.volume_registry.lock().await;
        let VolumeSendable::VolU16(labels, _) = registry.get(&painted.label_volume_id).unwrap()
        else {
            panic!("editable labels are u16")
        };
        assert_eq!(
            labels.values().iter().filter(|&&v| v == u16::MAX).count(),
            5
        );
    }

    #[test]
    fn the_save_dialog_opens_in_the_last_save_folder_else_the_reference_folder() {
        let root = std::env::temp_dir().join(format!("bf-seg-folder-{}", uuid::Uuid::new_v4()));
        let (data, saved) = (root.join("data"), root.join("saved"));
        std::fs::create_dir_all(&data).unwrap();
        std::fs::create_dir_all(&saved).unwrap();
        let reference = data.join("sub-01_T1w.nii.gz");
        let reference = reference.to_str().unwrap();
        assert_eq!(
            default_save_folder(None, Some(reference)),
            Some(data.clone())
        );
        assert_eq!(
            default_save_folder(Some(&saved), Some(reference)),
            Some(saved.clone())
        );
        // A vanished last folder falls back to the reference folder.
        assert_eq!(
            default_save_folder(Some(&root.join("gone")), Some(reference)),
            Some(data.clone())
        );
        // In-memory or relative sources give no folder (the dialog default).
        assert_eq!(default_save_folder(None, Some("memory:reference")), None);
        assert_eq!(default_save_folder(None, None), None);
        std::fs::remove_dir_all(&root).unwrap();
    }

    /// Paint at the top-centre pixel of the native coronal (normal j) plane and
    /// return the painted voxels: the top row must be superior (high k).
    async fn paint_top_centre(
        state: &BridgeState,
        created: &SegmentationSessionInfo,
    ) -> Vec<[u32; 4]> {
        let (w, h) = (50, 70);
        let plane = slice(state, operation(created), 1, [w, h], [false, false])
            .await
            .unwrap()
            .plane;
        let point: [f32; 3] = std::array::from_fn(|a| {
            plane.origin_mm[a] + plane.u_mm[a] * (w / 2) as f32 + plane.v_mm[a] * 2.0
        });
        let mut paint = stroke(created);
        paint.points_world = vec![point];
        let painted = commit(state, paint).await.unwrap().session;
        assert!(painted.snapshot.labels[0].voxels > 0.0);
        let labels = slice(state, operation(&painted), 1, [w, h], [false, false])
            .await
            .unwrap()
            .labels;
        assert!(!labels.is_empty());
        labels
    }

    #[tokio::test]
    async fn the_top_of_a_native_coronal_slice_paints_superior_voxels() {
        let state = tokio::task::spawn_blocking(state).await.unwrap();
        let created = create(&state, setup()).await.unwrap();
        let dims = created.snapshot.dimensions;
        for voxel in paint_top_centre(&state, &created).await {
            assert!(
                voxel[2] * 2 > dims[2],
                "voxel {voxel:?} painted from the top of the slice must be superior"
            );
            assert_eq!(voxel[1], 1);
        }
    }

    #[tokio::test]
    async fn the_top_of_a_native_coronal_slice_of_a_4d_reference_paints_superior_voxels() {
        use volmath::DenseNeuroVec;
        let state = tokio::task::spawn_blocking(state).await.unwrap();
        let space = NeuroSpace::new(
            vec![5, 3, 7, 4],
            Some(vec![0.4, 2.0, 0.4, 1.0]),
            Some(vec![-10.0, 7.0, -4.0, 0.0]),
            None,
            None,
        )
        .unwrap();
        state.volume_registry.lock().await.insert(
            "series".into(),
            VolumeSendable::Vec4DF32(DenseNeuroVec::zeros(space).unwrap()),
            VolumeMetadataInfo {
                name: "Synthetic series".into(),
                path: "memory:series".into(),
                dtype: "f32".into(),
                volume_type: bridge_types::VolumeType::TimeSeries4D,
                time_series_info: None,
            },
        );
        let mut request = setup();
        request.reference_volume_id = "series".into();
        request.reference_frame = Some(1);
        let created = create(&state, request).await.unwrap();
        let dims = created.snapshot.dimensions;
        for voxel in paint_top_centre(&state, &created).await {
            assert!(
                voxel[2] * 2 > dims[2],
                "voxel {voxel:?} painted from the top of the slice must be superior"
            );
        }
    }

    #[tokio::test]
    async fn a_4d_reference_is_traced_on_one_explicit_frozen_frame() {
        use volmath::DenseNeuroVec;
        let state = tokio::task::spawn_blocking(state).await.unwrap();
        // 5x3x7 spatial grid, four frames; NeuroSpace keeps the origin in the
        // LAST column of its 5x5 transform.
        let space = NeuroSpace::new(
            vec![5, 3, 7, 4],
            Some(vec![0.4, 2.0, 0.4, 1.0]),
            Some(vec![-10.0, 7.0, -4.0, 0.0]),
            None,
            None,
        )
        .unwrap();
        let mut series = DenseNeuroVec::zeros(space).unwrap();
        for t in 0..4 {
            series.data[[1, 2, 3, t]] = 10.0 + t as f32;
        }
        state.volume_registry.lock().await.insert(
            "series".into(),
            VolumeSendable::Vec4DF32(series),
            VolumeMetadataInfo {
                name: "Synthetic series".into(),
                path: "memory:series".into(),
                dtype: "f32".into(),
                volume_type: bridge_types::VolumeType::TimeSeries4D,
                time_series_info: None,
            },
        );
        let mut request = setup();
        request.reference_volume_id = "series".into();
        assert!(
            create(&state, request.clone()).await.is_err(),
            "a 4D reference needs an explicit frame"
        );
        request.reference_frame = Some(4);
        assert!(create(&state, request.clone()).await.is_err());
        assert_eq!(
            state.volume_registry.lock().await.volumes.len(),
            2,
            "refused setups publish nothing"
        );
        let mut framed_3d = setup();
        framed_3d.reference_frame = Some(0);
        assert!(create(&state, framed_3d).await.is_err());

        request.reference_frame = Some(2);
        let created = create(&state, request).await.unwrap();
        assert_eq!(created.snapshot.reference_frame, Some(2));
        assert_eq!(created.snapshot.reference_volume_id, "series");
        assert_eq!(created.snapshot.dimensions, [5, 3, 7]);
        assert_eq!(
            created.snapshot.voxel_to_world[12..15],
            [-10.0, 7.0, -4.0],
            "the grid origin comes from the 4D transform's last column"
        );
        assert_eq!(
            created.snapshot.voxel_to_world[..11],
            [0.4, 0.0, 0.0, 0.0, 0.0, 2.0, 0.0, 0.0, 0.0, 0.0, 0.4]
        );
        let display = created.reference_display_volume_id.clone();
        assert_ne!(display, "series");
        {
            let registry = state.volume_registry.lock().await;
            let frame = registry.get_entry(&display).unwrap();
            assert_eq!(
                frame.metadata.volume_type,
                bridge_types::VolumeType::Volume3D
            );
            assert_eq!(frame.document_references, 1);
            let VolumeSendable::VolF32(volume, affine) = frame.data.as_ref() else {
                panic!("the frozen frame is a 3D f32 volume")
            };
            assert_eq!(volume.get_at_coords(&[1, 2, 3]), Some(12.0), "frame 2 only");
            let world = affine.transform_point(&nalgebra::Point3::new(1.0, 2.0, 3.0));
            assert_eq!([world.x, world.y, world.z], [-9.6, 11.0, -2.8]);
            assert_eq!(registry.get_entry("series").unwrap().document_references, 1);
        }
        // Moving the shared time cursor does not change the traced frame.
        state
            .volume_registry
            .lock()
            .await
            .set_timepoint("series", 0)
            .unwrap();
        let mut paint = stroke(&created);
        paint.points_world = vec![[0.8 - 10.0, 2.0 + 7.0, 1.2 - 4.0]];
        let painted = commit(&state, paint).await.unwrap().session;
        assert_eq!(painted.snapshot.labels[0].voxels, 5.0);
        let export = export_labels(&state, operation(&painted)).await.unwrap();
        assert!(String::from_utf8_lossy(&export.header.descrip)
            .starts_with("Brainflow segmentation r1; ref frame 2 (0-based)"));
        assert_eq!(export.header.dim[..4], [3, 5, 3, 7]);

        state
            .modules
            .dispose_workspace(&state, &access(&painted).workspace)
            .await
            .unwrap();
        let registry = state.volume_registry.lock().await;
        assert!(
            !registry.contains(&display),
            "the frozen frame is reclaimed"
        );
    }

    #[tokio::test]
    async fn a_4d_secondary_contrast_uses_its_chosen_frame() {
        use volmath::DenseNeuroVec;
        let state = tokio::task::spawn_blocking(state).await.unwrap();
        let space = NeuroSpace::new(
            vec![5, 3, 7, 3],
            Some(vec![0.4, 2.0, 0.4, 1.0]),
            None,
            None,
            None,
        )
        .unwrap();
        let mut series = DenseNeuroVec::zeros(space).unwrap();
        series.data[[0, 0, 0, 1]] = 5.0;
        state.volume_registry.lock().await.insert(
            "secondary-series".into(),
            VolumeSendable::Vec4DF32(series),
            VolumeMetadataInfo {
                name: "Synthetic secondary series".into(),
                path: "memory:secondary-series".into(),
                dtype: "f32".into(),
                volume_type: bridge_types::VolumeType::TimeSeries4D,
                time_series_info: None,
            },
        );
        let mut request = setup();
        request.secondary_volume_id = Some("secondary-series".into());
        request.registration = Some(bf_segmentation::Registration::Aligned {
            confirmer: "rater-a".into(),
            confirmed_at_ms: 1.0,
            transform_hash: "fixture".into(),
            view: [0.0; 12],
        });
        assert!(create(&state, request.clone()).await.is_err());
        request.secondary_frame = Some(1);
        let created = create(&state, request).await.unwrap();
        assert_eq!(created.snapshot.secondary_frame, Some(1));
        assert_eq!(created.reference_display_volume_id, "reference");
        let display = created.secondary_display_volume_id.unwrap();
        let registry = state.volume_registry.lock().await;
        let VolumeSendable::VolF32(volume, _) = registry.get(&display).unwrap() else {
            panic!("the frozen secondary frame is 3D f32")
        };
        assert_eq!(volume.get_at_coords(&[0, 0, 0]), Some(5.0));
        assert_eq!(
            registry
                .get_entry("secondary-series")
                .unwrap()
                .document_references,
            1
        );
    }

    #[tokio::test]
    async fn a_displayed_frozen_frame_is_unpinned_on_discard_and_then_removable_as_a_layer() {
        use volmath::DenseNeuroVec;
        use volume_service::VolumeRepository;
        let state = tokio::task::spawn_blocking(state).await.unwrap();
        let space = NeuroSpace::new(
            vec![5, 3, 7, 2],
            Some(vec![0.4, 2.0, 0.4, 1.0]),
            None,
            None,
            None,
        )
        .unwrap();
        state.volume_registry.lock().await.insert(
            "series".into(),
            VolumeSendable::Vec4DF32(DenseNeuroVec::zeros(space).unwrap()),
            VolumeMetadataInfo {
                name: "Synthetic series".into(),
                path: "memory:series".into(),
                dtype: "f32".into(),
                volume_type: bridge_types::VolumeType::TimeSeries4D,
                time_series_info: None,
            },
        );
        let mut request = setup();
        request.reference_volume_id = "series".into();
        request.reference_frame = Some(1);
        let created = create(&state, request).await.unwrap();
        let frame = created.reference_display_volume_id.clone();
        // The viewport attached the frame as an ordinary (hidden) layer.
        state
            .layer_to_volume_map
            .lock()
            .await
            .insert("frame-layer".into(), frame.clone());
        // While the document is open its frame cannot be unloaded.
        let _ = crate::volume_loading::DesktopVolumeRepository(&state)
            .remove(&frame)
            .await;
        assert!(state.volume_registry.lock().await.contains(&frame));
        state
            .modules
            .dispose_workspace(&state, &access(&created).workspace)
            .await
            .unwrap();
        {
            let registry = state.volume_registry.lock().await;
            let entry = registry
                .get_entry(&frame)
                .expect("a displayed frame stays loaded");
            assert_eq!(
                entry.document_references, 0,
                "the discarded document no longer pins it"
            );
        }
        // The UI removes the frame layer on discard; the ordinary unload then frees it.
        state.layer_to_volume_map.lock().await.remove("frame-layer");
        crate::volume_loading::DesktopVolumeRepository(&state)
            .remove(&frame)
            .await
            .unwrap();
        assert!(!state.volume_registry.lock().await.contains(&frame));
    }
}
