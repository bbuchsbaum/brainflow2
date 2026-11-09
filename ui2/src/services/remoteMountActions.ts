/**
 * User actions on mounted remote folders, shared by the tree, the panel
 * header and the footer.
 */
import { getEventBus } from '@/events/EventBus';
import { refreshRemoteMountStatuses } from '@/hooks/useRemoteMountStatus';
import {
  cancelRemotePrefetch,
  startRemotePrefetch,
  type RemoteMountTarget,
} from '@/services/RemoteMountService';
import { getTransport } from '@/services/transport';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import { useRemoteMountStore } from '@/stores/remoteMountStore';
import type { FileTreeNode, MountSource } from '@/types/filesystem';
import { formatTauriError } from '@/utils/formatTauriError';

/** The mounted remote root that contains `path`, if any. */
export function findRemoteRoot(entries: FileTreeNode[], path: string): FileTreeNode | null {
  return (
    entries.find(
      (root) =>
        root.mountSource?.kind === 'remote' &&
        (path === root.path || path.startsWith(`${root.path}/`))
    ) ?? null
  );
}

export function targetFromMountSource(source: MountSource): RemoteMountTarget | null {
  if (!source.host) return null;
  return {
    host: source.host,
    port: source.port,
    user: source.user,
    remotePath: source.remotePath,
  };
}

/**
 * Bring a mounted remote folder back. A session that reconnects by itself is
 * nudged with a refresh; one that needs a sign-in opens the dialog on its
 * saved profile (which hands the new session to every folder on that host).
 */
export async function reconnectRemoteRoot(rootPath: string, source: MountSource): Promise<void> {
  const status = source.mountId
    ? useRemoteMountStore.getState().statuses[source.mountId]?.state
    : undefined;
  if (status === 'reconnecting') {
    await useFileBrowserStore.getState().refreshDirectory(rootPath);
    await refreshRemoteMountStatuses();
    const after = source.mountId
      ? useRemoteMountStore.getState().statuses[source.mountId]?.state
      : undefined;
    if (after === 'connected') return;
  }
  const target = targetFromMountSource(source);
  useRemoteMountStore.getState().openRemoteDialog(target, true);
}

/** After a (re)connect for a folder that is already in the tree, reload it. */
export async function refreshRevivedRemoteRoot(localPath: string): Promise<void> {
  const mounted = useFileBrowserStore.getState().entries.some((root) => root.path === localPath);
  if (mounted) {
    await useFileBrowserStore.getState().refreshDirectory(localPath);
  }
  await refreshRemoteMountStatuses();
}

export async function makeRemoteFolderAvailableOffline(path: string): Promise<void> {
  try {
    await startRemotePrefetch(path);
  } catch (error) {
    getEventBus().emit('ui.notification', {
      type: 'error',
      message: formatTauriError(error) || 'Could not start the download.',
    });
  }
}

export async function stopMakingAvailableOffline(jobId: string): Promise<void> {
  try {
    await cancelRemotePrefetch(jobId);
  } catch {
    // The job already finished.
  }
}

/** Unmount a remote root, optionally deleting its downloaded files. */
export async function unmountRemoteRoot(
  rootPath: string,
  source: MountSource,
  purgeCache: boolean
): Promise<void> {
  if (source.mountId) {
    await getTransport().invoke('remote_mount_unmount', {
      mountId: source.mountId,
      purgeCache,
    });
  }
  const store = useFileBrowserStore.getState();
  store.unmountDirectory(rootPath);
  const selected = store.selectedPath;
  if (selected && (selected === rootPath || selected.startsWith(`${rootPath}/`))) {
    store.selectFile(null);
  }
  await refreshRemoteMountStatuses();
}
