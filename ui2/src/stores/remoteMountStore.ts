/**
 * Cross-panel state for remote (SSH) mounts: live connection status per
 * mount, "make available offline" jobs, and the remote-mount dialog request
 * (so any panel can ask to reconnect a folder).
 */
import { create } from 'zustand';
import type {
  RemoteMountStatus,
  RemoteMountTarget,
  RemotePrefetchProgress,
} from '@/services/RemoteMountService';

export type RemoteConnectionState = 'connected' | 'reconnecting' | 'disconnected';

interface RemoteDialogRequest {
  open: boolean;
  /** Open on this folder (Recents/Pinned/Reconnect) instead of a blank form. */
  target: RemoteMountTarget | null;
  /** Connect straight away when the target has a usable saved profile. */
  autoConnect: boolean;
}

interface RemoteMountStoreState {
  statuses: Record<string, RemoteMountStatus>;
  prefetchJobs: Record<string, RemotePrefetchProgress>;
  dialog: RemoteDialogRequest;
  setStatuses: (statuses: RemoteMountStatus[]) => void;
  applyPrefetchProgress: (progress: RemotePrefetchProgress) => void;
  dismissPrefetchJob: (jobId: string) => void;
  openRemoteDialog: (target?: RemoteMountTarget | null, autoConnect?: boolean) => void;
  closeRemoteDialog: () => void;
}

const CLOSED_DIALOG: RemoteDialogRequest = { open: false, target: null, autoConnect: false };

function sameStatuses(
  current: Record<string, RemoteMountStatus>,
  next: RemoteMountStatus[]
): boolean {
  const keys = Object.keys(current);
  if (keys.length !== next.length) return false;
  return next.every((status) => {
    const existing = current[status.mount_id];
    return (
      existing !== undefined &&
      existing.state === status.state &&
      existing.shared_session_mounts === status.shared_session_mounts
    );
  });
}

export const useRemoteMountStore = create<RemoteMountStoreState>((set, get) => ({
  statuses: {},
  prefetchJobs: {},
  dialog: CLOSED_DIALOG,

  setStatuses: (statuses) => {
    if (sameStatuses(get().statuses, statuses)) return;
    const byId: Record<string, RemoteMountStatus> = {};
    for (const status of statuses) byId[status.mount_id] = status;
    set({ statuses: byId });
  },

  applyPrefetchProgress: (progress) => {
    set((state) => ({
      prefetchJobs: { ...state.prefetchJobs, [progress.job_id]: progress },
    }));
  },

  dismissPrefetchJob: (jobId) => {
    if (!(jobId in get().prefetchJobs)) return;
    set((state) => {
      const next = { ...state.prefetchJobs };
      delete next[jobId];
      return { prefetchJobs: next };
    });
  },

  openRemoteDialog: (target = null, autoConnect = false) => {
    set({ dialog: { open: true, target, autoConnect: Boolean(target) && autoConnect } });
  },

  closeRemoteDialog: () => {
    if (!get().dialog.open) return;
    set({ dialog: CLOSED_DIALOG });
  },
}));

/** Whether a prefetch job is still running. */
export function isPrefetchActive(progress: RemotePrefetchProgress): boolean {
  return progress.state === 'scanning' || progress.state === 'downloading';
}
