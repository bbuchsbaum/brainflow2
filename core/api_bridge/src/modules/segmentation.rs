//! Native adapter for reference-grid segmentation. Documents live in the state
//! slot across activation switches; ordinary layers own their GPU leases.
use super::{
    BridgeModule, ModuleCtx, ModuleDescriptor, ModuleSlots, ModuleStage, WorkspaceIdentity,
};
use crate::{BridgeState, VolumeMetadataInfo};
use async_trait::async_trait;
use bf_segmentation::{Operation, Session, SessionSetup, Snapshot, Stroke};
use bridge_types::{BridgeError, BridgeResult, VolumeSendable};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::State;
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
    session: Session,
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
            .filter_map(|id| sessions.remove(&id).map(|record| record.label_volume_id))
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
    let width = render_loop::texture_manager::COLORMAP_LUT_WIDTH as usize;
    let mut row = vec![0u8; width * 4];
    for label in &snapshot.labels {
        let at = usize::from(label.definition.id) * 4;
        row[at..at + 3].copy_from_slice(&label.definition.color);
        row[at + 3] = 255;
    }
    let renderer = state.render_loop_service.lock().await.clone();
    let mut render_error = render_error;
    let palette_id = if let Some(renderer) = renderer {
        match renderer
            .lock()
            .await
            .upsert_custom_colormap(format!("editable-label:{}", record.label_volume_id), &row)
        {
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
        palette_id,
        render_error,
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
    let mut sessions = module.sessions.lock().await;
    if sessions.values().any(|record| record.workspace == owner) {
        return Err(invalid("This workspace already has a segmentation session"));
    }
    if request.labels.iter().any(|label| {
        usize::from(label.id) >= render_loop::texture_manager::COLORMAP_LUT_WIDTH as usize
    }) {
        return Err(invalid(
            "This renderer supports categorical label ids from 1 to 2047",
        ));
    }
    let (source, header) = {
        let registry = state.volume_registry.lock().await;
        let entry = registry
            .get_entry(&request.reference_volume_id)
            .ok_or_else(|| invalid("Reference image is no longer loaded"))?;
        if entry.metadata.volume_type != bridge_types::VolumeType::Volume3D {
            return Err(invalid(
                "Select a single 3D reference image for this segmentation session",
            ));
        }
        if let Some(secondary) = request.secondary_volume_id.as_ref() {
            if secondary == &request.reference_volume_id {
                return Err(invalid("Select a distinct secondary contrast"));
            }
            let secondary = registry
                .get_entry(secondary)
                .ok_or_else(|| invalid("Secondary contrast is no longer loaded"))?;
            if secondary.metadata.volume_type != bridge_types::VolumeType::Volume3D {
                return Err(invalid("Select a single 3D secondary contrast"));
            }
        }
        (entry.data.clone(), entry.source_nifti_header.clone())
    };
    let dims = crate::get_spatial_dims_from_volume(&source);
    let dimensions = [dims[0] as u32, dims[1] as u32, dims[2] as u32];
    let affine = crate::get_affine_from_volume(&source)?;
    let matrix = affine.to_homogeneous();
    let id = uuid::Uuid::new_v4().to_string();
    let session = if let Some(header) = header.as_ref() {
        Session::create_from_header_bytes(id.clone(), request, matrix, header).map_err(domain)?
    } else {
        Session::create_on_derived_grid(id.clone(), request, dimensions, matrix).map_err(domain)?
    };
    if session.volume().dimensions() != dimensions {
        return Err(invalid(
            "Retained source header does not match the loaded reference grid",
        ));
    }
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
    {
        let mut registry = state.volume_registry.lock().await;
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
    }
    let record = Record {
        workspace: owner,
        label_volume_id,
        session,
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
    if !entry.retained_by_document
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
        let mut next = setup();
        next.workspace_instance = "opaque-test-b".into();
        assert!(create(&state, next).await.is_ok());
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
}
