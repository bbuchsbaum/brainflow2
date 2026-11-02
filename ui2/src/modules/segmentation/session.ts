import { useSyncExternalStore } from 'react';
import type { SegmentationCommit, SegmentationOperation, SegmentationPaintOver, SegmentationPreview, SegmentationSavedLabels, SegmentationSessionInfo, SegmentationSessionSetup, SegmentationSlice, SegmentationStroke, SegmentationTool } from '@brainflow/api';
import { bridgeClient, captureActiveWorkspace, formatModuleError, isLiveDocument, isDocumentEditingFrozen, type ActiveWorkspaceLease, type WorkspaceDocumentIdentity } from '@/modules/api/host';

type StrokeInput = Omit<SegmentationStroke, 'owner'>;
const client = bridgeClient('segmentation');
const message = formatModuleError;
export interface SegmentationPresentation {
  info: SegmentationSessionInfo | null;
  document: WorkspaceDocumentIdentity;
  activeLabelId: number;
  hiddenLabelIds: number[];
  sliceIndex: number;
  tool: 'navigate' | SegmentationTool;
  radiusMm: number;
  paintOver: SegmentationPaintOver;
  fill: boolean;
  busy: boolean;
  error: string | null;
  /** The last file this tab saved; compared with the live revision for the save state. */
  lastSave: SegmentationSavedLabels | null;
}
export interface SegmentationRecord {
  document: WorkspaceDocumentIdentity;
  controller: SegmentationSessionController;
  snapshot: SegmentationPresentation;
}
const records = new Map<string, SegmentationRecord>();
const listeners = new Map<string, Set<() => void>>();
function update(record: SegmentationRecord, patch: Partial<SegmentationPresentation>): void {
  if (records.get(record.document.workspaceId) !== record) return;
  record.snapshot = { ...record.snapshot, ...patch };
  listeners.get(record.document.workspaceId)?.forEach((listener) => listener());
}

/** Backend identity/history outlive React and module activation. View replies carry a fresh navigation epoch. */
export class SegmentationSessionController {
  private info: SegmentationSessionInfo | null = null;
  private serial = 0;
  private previews = 0;
  private creating: Promise<SegmentationSessionInfo> | null = null;
  private readonly document: WorkspaceDocumentIdentity;
  constructor(document: WorkspaceDocumentIdentity) { this.document = document; }
  private lease(): ActiveWorkspaceLease | null {
    const lease = captureActiveWorkspace();
    return lease?.workspaceId === this.document.workspaceId && isLiveDocument(this.document) && !isDocumentEditingFrozen(this.document.workspaceId) ? lease : null;
  }
  private accept(info: SegmentationSessionInfo): void {
    if (!this.info || (info.snapshot.sessionId === this.info.snapshot.sessionId && info.snapshot.revision >= this.info.snapshot.revision)) this.info = info;
  }
  operation(): SegmentationOperation | null {
    const snapshot = this.info?.snapshot;
    return snapshot ? { ...this.document, sessionId: snapshot.sessionId, baseRevision: snapshot.revision } : null;
  }
  async create(setup: Omit<SegmentationSessionSetup, 'workspaceId' | 'workspaceInstance'>): Promise<SegmentationSessionInfo | null> {
    const lease = this.lease(); if (!lease) return null;
    if (this.info || this.creating) throw new Error('This workspace already has a session or a pending setup. Return to the existing session.');
    const request = ++this.serial;
    this.creating = client.invoke<SegmentationSessionInfo>('segmentation_create_session', { request: { ...setup, ...this.document } });
    try {
      const info = await this.creating;
      // Always remember an accepted document so get_session can reconcile after away/back.
      this.accept(info);
      return lease.isCurrent() && request === this.serial && isLiveDocument(this.document) ? info : null;
    } finally { this.creating = null; }
  }
  async refresh(): Promise<SegmentationSessionInfo | null> {
    const lease = this.lease(); if (!lease) return null;
    if (this.creating) { try { this.accept(await this.creating); } catch { return null; } }
    const owner = this.operation();
    const request = ++this.serial;
    const info = await client.invoke<SegmentationSessionInfo>('segmentation_get_session', { access: { workspace: this.document, sessionId: owner?.sessionId ?? null } });
    this.accept(info);
    return lease.isCurrent() && request === this.serial && isLiveDocument(this.document) ? this.info : null;
  }
  async preview(stroke: StrokeInput): Promise<SegmentationPreview | null> {
    const lease = this.lease(), owner = this.operation(); if (!lease || !owner) return null;
    const request = ++this.previews;
    const result = await client.invoke<SegmentationPreview>('segmentation_preview_stroke', { stroke: { ...stroke, owner } });
    return lease.isCurrent() && request === this.previews && owner.baseRevision === this.operation()?.baseRevision && isLiveDocument(this.document) ? result : null;
  }
  async slice(sliceIndex: number, dimensions: [number, number]): Promise<SegmentationSlice | null> {
    const lease = this.lease(), owner = this.operation(); if (!lease || !owner) return null;
    const result = await client.invoke<SegmentationSlice>('segmentation_get_slice', { owner, sliceIndex, dimensions, flips: [false, false] });
    return lease.isCurrent() && owner.baseRevision === this.operation()?.baseRevision && isLiveDocument(this.document) ? result : null;
  }
  private async mutate(command: 'segmentation_commit_stroke' | 'segmentation_undo' | 'segmentation_set_label_state', args: (owner: SegmentationOperation) => object): Promise<SegmentationSessionInfo | null> {
    const lease = this.lease(), owner = this.operation(); if (!lease || !owner) return null;
    const request = ++this.serial; ++this.previews;
    const result = await client.invoke<SegmentationCommit | SegmentationSessionInfo>(command, args(owner) as Record<string, unknown>);
    const info = 'snapshot' in result ? result : result.session;
    this.accept(info);
    return lease.isCurrent() && request === this.serial && isLiveDocument(this.document) ? info : null;
  }
  commit(stroke: StrokeInput) { return this.mutate('segmentation_commit_stroke', (owner) => ({ stroke: { ...stroke, owner } })); }
  undo(redo = false) { return this.mutate('segmentation_undo', (owner) => ({ owner, redo })); }
  setLabelState(labelId: number, locked: boolean, complete: boolean) { return this.mutate('segmentation_set_label_state', (owner) => ({ owner, labelId, locked, complete })); }
  cancelPreview() { ++this.previews; }
  /** Saves the displayed accepted revision; `null` means the dialog was cancelled. */
  async save(): Promise<SegmentationSavedLabels | null> {
    if (isDocumentEditingFrozen(this.document.workspaceId)) throw new Error('Labels cannot be saved while this workspace is closing. Cancel closing to save.');
    const lease = this.lease(), owner = this.operation();
    if (!lease || !owner) throw new Error('Labels can be saved only from the active segmentation session.');
    return client.invoke<SegmentationSavedLabels | null>('segmentation_save_labels', { owner });
  }
}

/** Save state of the displayed labels against this tab's last save (label revision). */
export function segmentationSaveState(presentation: SegmentationPresentation): 'unsaved' | 'saved' | 'changed since the last save' {
  const snapshot = presentation.info?.snapshot, saved = presentation.lastSave;
  if (!snapshot || !saved || saved.sessionId !== snapshot.sessionId) return 'unsaved';
  return saved.labelRevision === snapshot.labelRevision ? 'saved' : 'changed since the last save';
}
/** Plain-language frame provenance, e.g. "reference frame t = 3"; empty for 3D sources. */
export function segmentationFrames(snapshot: { referenceFrame: number | null; secondaryFrame: number | null }): string {
  return [snapshot.referenceFrame != null ? `reference frame t = ${snapshot.referenceFrame}` : '', snapshot.secondaryFrame != null ? `secondary frame t = ${snapshot.secondaryFrame}` : ''].filter(Boolean).join(' · ');
}
export function getSegmentationSession(workspaceId: string): SegmentationRecord | null { return records.get(workspaceId) ?? null; }
export function useSegmentationSession(workspaceId: string): SegmentationPresentation | null {
  return useSyncExternalStore((listener) => {
    let set = listeners.get(workspaceId); if (!set) listeners.set(workspaceId, (set = new Set()));
    set.add(listener); return () => { set.delete(listener); if (!set.size) listeners.delete(workspaceId); };
  }, () => records.get(workspaceId)?.snapshot ?? null, () => null);
}
export function ensureSegmentationSession(_lease: ActiveWorkspaceLease, document: WorkspaceDocumentIdentity): SegmentationRecord {
  const existing = records.get(document.workspaceId);
  if (existing?.document.workspaceInstance === document.workspaceInstance) return existing;
  const record: SegmentationRecord = { document, controller: new SegmentationSessionController(document), snapshot: {
    info: null, document, activeLabelId: 1, hiddenLabelIds: [], sliceIndex: 0, tool: 'navigate', radiusMm: 2, paintOver: 'unlocked', fill: false, busy: false, error: null, lastSave: null,
  }};
  records.set(document.workspaceId, record); update(record, {}); return record;
}
function adopt(record: SegmentationRecord, info: SegmentationSessionInfo, error: string | null): void {
  const labels = info.snapshot.labels;
  update(record, { info, error, activeLabelId: labels.some((row) => row.definition.id === record.snapshot.activeLabelId) ? record.snapshot.activeLabelId : labels[0].definition.id,
    sliceIndex: Math.min(record.snapshot.sliceIndex, info.snapshot.dimensions[info.snapshot.normalAxis] - 1) });
}
async function run(record: SegmentationRecord, action: () => Promise<SegmentationSessionInfo | null>, recover = true): Promise<SegmentationSessionInfo | null> {
  if (record.snapshot.busy) return null;
  update(record, { busy: true, error: null });
  const restore = async () => {
    const current = captureActiveWorkspace();
    if (!recover || current?.workspaceId !== record.document.workspaceId || !isLiveDocument(record.document) || isDocumentEditingFrozen(record.document.workspaceId)) return null;
    try { return await record.controller.refresh(); } catch { return null; }
  };
  try {
    const result = await action();
    // Returning before a late create/edit finishes must not strand the tab on
    // old data. Reconcile from native state with a fresh navigation epoch.
    const info = result ?? await restore();
    if (info) adopt(record, info, info.renderError);
    return info;
  } catch (error) {
    // IPC can lose an acknowledgement after native creation succeeded. Discover
    // that document through its retained incarnation; never create a duplicate.
    const info = await restore();
    if (info) { adopt(record, info, info.renderError ?? message(error)); return info; }
    update(record, { error: message(error) }); return null;
  } finally { update(record, { busy: false }); }
}
export async function createSegmentationSession(record: SegmentationRecord, setup: Omit<SegmentationSessionSetup, 'workspaceId' | 'workspaceInstance'>) {
  const info = await run(record, () => record.controller.create(setup));
  if (info) update(record, { activeLabelId: info.snapshot.labels[0]?.definition.id ?? 1 });
  return info;
}
export function setSegmentationLabelState(workspaceId: string, labelId: number, locked: boolean, complete: boolean) {
  const record = records.get(workspaceId); return record ? run(record, () => record.controller.setLabelState(labelId, locked, complete)) : Promise.resolve(null);
}
export function reconcileSegmentationSession(workspaceId: string) {
  const record = records.get(workspaceId); return record ? run(record, () => record.controller.refresh(), false) : Promise.resolve(null);
}
export function commitSegmentationStroke(workspaceId: string, stroke: StrokeInput) {
  const record = records.get(workspaceId); return record ? run(record, () => record.controller.commit(stroke)) : Promise.resolve(null);
}
export function travelSegmentationHistory(workspaceId: string, redo = false) {
  const record = records.get(workspaceId); return record ? run(record, () => record.controller.undo(redo)) : Promise.resolve(null);
}
/** Save the accepted document through the native dialog. Edits wait while it is open. */
export async function saveSegmentationLabels(workspaceId: string): Promise<SegmentationSavedLabels | null> {
  const record = records.get(workspaceId);
  if (!record || record.snapshot.busy) return null;
  update(record, { busy: true, error: null });
  try {
    const saved = await record.controller.save();
    if (saved) update(record, { lastSave: saved });
    return saved;
  } catch (error) {
    // A refused save (for example a late accepted edit moved the revision)
    // shows the current native document so the user saves what they see.
    const info = await record.controller.refresh().catch(() => null);
    if (info) adopt(record, info, message(error)); else update(record, { error: message(error) });
    return null;
  } finally { update(record, { busy: false }); }
}
export function setSegmentationPresentation(workspaceId: string, patch: Partial<Omit<SegmentationPresentation, 'info' | 'document'>>) {
  const record = records.get(workspaceId); if (record) update(record, patch);
}

/** Called only after core document disposal succeeded. Late replies cannot republish a removed record. */
export function forgetSegmentationSession(identity: WorkspaceDocumentIdentity): void {
  const record = records.get(identity.workspaceId);
  if (record?.document.workspaceInstance !== identity.workspaceInstance) return;
  record.controller.cancelPreview(); records.delete(identity.workspaceId);
  listeners.get(identity.workspaceId)?.forEach((listener) => listener());
}
