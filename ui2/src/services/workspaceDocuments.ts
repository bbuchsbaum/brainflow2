import { getEventBus } from '@/events/EventBus';
import { getConfirmationService } from '@/services/ConfirmationService';
import { getTransport } from '@/services/transport';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import {
  installWorkspaceCloseGuard,
  removeWorkspaceCloseGuard,
} from './workspaceCloseGuards';

export interface WorkspaceDocumentIdentity {
  workspaceId: string;
  workspaceInstance: string;
}

export interface RetainWorkspaceDocumentOptions {
  moduleId: string;
  label?: string;
  /** Loaded images required by this in-memory document, including while parked. */
  protectedVolumeIds?: readonly string[];
  freezeEditing?: () => void;
  onDiscarded?: () => void;
}

type RetainedDocument = WorkspaceDocumentIdentity & RetainWorkspaceDocumentOptions & {
  timestamp: number;
  pending?: Promise<boolean>;
};

const documents = new Map<string, RetainedDocument>();
const closeRequests = new Map<string, Promise<boolean>>();

const ownedWorkspace = (workspaceId: string) => {
  const state = useWorkspaceStore.getState();
  return state.workspaces.get(workspaceId) ?? state.parkedWorkspaces.get(workspaceId) ?? null;
};

const recordIsCurrent = (document: RetainedDocument): boolean =>
  documents.get(document.workspaceId)?.workspaceInstance === document.workspaceInstance;

const live = (document: RetainedDocument): boolean =>
  ownedWorkspace(document.workspaceId)?.timestamp === document.timestamp && recordIsCurrent(document);

/** Keep a module-owned session alive independently of its React module lifetime. */
export function retainWorkspaceDocument(
  workspaceId: string,
  options: RetainWorkspaceDocumentOptions,
): WorkspaceDocumentIdentity {
  const workspace = ownedWorkspace(workspaceId);
  if (!workspace) throw new Error(`Cannot retain unknown workspace ${workspaceId}`);
  const existing = documents.get(workspaceId);
  if (existing) {
    if (existing.timestamp !== workspace.timestamp) {
      throw new Error(`Workspace ${workspaceId} has a stale retained document; discard its identity first`);
    }
    // Module parking/reactivation recreates callbacks. The shell owns identity,
    // but the current activation owns the latest freeze callback and label.
    const protectedVolumeIds = [...new Set([...(existing.protectedVolumeIds ?? []), ...(options.protectedVolumeIds ?? [])])];
    Object.assign(existing, options, { protectedVolumeIds });
    return { workspaceId: existing.workspaceId, workspaceInstance: existing.workspaceInstance };
  }
  const retained: RetainedDocument = {
    workspaceId,
    workspaceInstance: crypto.randomUUID(),
    timestamp: workspace.timestamp,
    ...options,
  };
  documents.set(workspaceId, retained);
  installWorkspaceCloseGuard(workspaceId);
  return { workspaceId: retained.workspaceId, workspaceInstance: retained.workspaceInstance };
}

/** A document must be discarded before its required image/layer is removed. */
export function volumeDocumentRemovalReason(volumeId: string): string | null {
  for (const document of documents.values()) {
    if (document.protectedVolumeIds?.includes(volumeId)) return `Close ${document.label ?? 'the workspace session'} before removing this image.`;
  }
  return null;
}

export const workspaceHasDocument = (workspaceId: string): boolean => documents.has(workspaceId);
export const isLiveWorkspaceDocument = (identity: WorkspaceDocumentIdentity): boolean => {
  const document = documents.get(identity.workspaceId);
  return Boolean(document && document.workspaceInstance === identity.workspaceInstance && live(document));
};
export const isWorkspaceEditingFrozen = (workspaceId: string): boolean =>
  Boolean(documents.get(workspaceId)?.pending);

export async function discardWorkspaceDocument(identity: WorkspaceDocumentIdentity): Promise<boolean> {
  const document = documents.get(identity.workspaceId);
  if (!document || document.workspaceInstance !== identity.workspaceInstance) return false;
  if (document.pending) return document.pending;
  document.freezeEditing?.();
  document.pending = (async () => {
    try {
      await getTransport().invoke('dispose_module_workspace', { workspace: identity });
      // Disposal targets the opaque identity, so an old record can be cleaned
      // after a timestamp replacement. Never remove a newer record's guard.
      if (recordIsCurrent(document)) {
        documents.delete(identity.workspaceId);
        removeWorkspaceCloseGuard(identity.workspaceId);
        try { document.onDiscarded?.(); } catch (error) { console.error('Workspace document cleanup failed:', error); }
      }
      return true;
    } catch {
      if (recordIsCurrent(document)) {
        document.pending = undefined;
        getEventBus().emit('ui.notification', {
          type: 'error',
          message: `Could not discard ${document.label ?? 'this workspace session'}; it remains open.`,
        });
      }
      return false;
    }
  })();
  return document.pending;
}

/** Request a user close. Store mutation is deliberately last. */
export async function requestWorkspaceClose(workspaceId: string): Promise<boolean> {
  const existingRequest = closeRequests.get(workspaceId);
  if (existingRequest) return existingRequest;
  const request = requestWorkspaceCloseOnce(workspaceId);
  closeRequests.set(workspaceId, request);
  try {
    return await request;
  } finally {
    if (closeRequests.get(workspaceId) === request) closeRequests.delete(workspaceId);
  }
}

async function requestWorkspaceCloseOnce(workspaceId: string): Promise<boolean> {
  const document = documents.get(workspaceId);
  if (!document) return useWorkspaceStore.getState().closeWorkspace(workspaceId);
  if (document.pending) return false;
  const targetTimestamp = useWorkspaceStore.getState().workspaces.get(workspaceId)?.timestamp;
  // Closing a visible replacement through an old retained identity is unsafe.
  if (targetTimestamp === undefined || targetTimestamp !== document.timestamp) return false;
  const confirmed = await getConfirmationService().confirm({
    title: 'Discard session?',
    message: `Discard ${document.label ?? 'this session'}? This cannot be undone.`,
    tone: 'destructive',
    confirmLabel: 'Discard session',
    cancelLabel: 'Cancel',
    defaultValue: false,
  });
  if (!confirmed || !live(document)) return false;
  if (!await discardWorkspaceDocument(document)) return false;
  if (useWorkspaceStore.getState().workspaces.get(workspaceId)?.timestamp !== targetTimestamp) return false;
  return useWorkspaceStore.getState().closeWorkspace(workspaceId);
}
