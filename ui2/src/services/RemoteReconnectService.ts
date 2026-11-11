/**
 * One way back to a remote (SSH) mount whose session dropped, for every
 * surface that meets the failure: the Deck's member card, the status bar, the
 * Files panel, a dataset card, the Studio's grid check and source fetch.
 *
 * `reconnectRemoteMount(pathOrMountId)` finds the mount that owns a local
 * cache path (or has that mount id), signs in again through the existing
 * `RemoteMountDialog` (opened on the folder's saved profile, connecting at
 * once; it stays up only for a prompt such as Duo), and resolves when the
 * mount is active again under the same local cache root. One reconnect runs
 * per mount: later callers join it.
 *
 * Success is announced through `remoteConnectionStore.activeEpoch`, which
 * `useRecoverOnReconnect` turns into one retry per surface that still wants
 * what failed.
 */
import type { MountSource } from '@/types/filesystem';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import { findOwningRoot } from '@/stores/fileBrowserSearch';
import {
  markRemoteMountActive,
  markRemoteMountDown,
  setRemoteMountReconnecting,
  useRemoteConnectionStore,
} from '@/stores/remoteConnectionStore';
import { formatTauriError, tauriErrorCode } from '@/utils/formatTauriError';
import { isRemoteConnectionLost } from '@/utils/remoteConnectionError';
import {
  buildRemoteMountMountOptions,
  mountConnectedRemoteDirectory,
  type ConnectedRemoteMount,
} from './RemoteMountService';
import { getTransport } from './transport';

export type RemoteReconnectOutcome =
  /** The mount at `root` is active again. */
  | { status: 'connected'; root: string }
  /** The user closed the sign-in. Nothing changed. */
  | { status: 'cancelled' }
  /** It could not be reconnected; `message` says why, in plain words. */
  | { status: 'failed'; message: string };

/** A remote mount as the UI knows it: its local cache root and where it lives. */
export interface RemoteMountRef {
  root: string;
  source: MountSource;
}

/** How long the "is it really down?" listing may take before the answer is yes. */
export const RECONNECT_PROBE_TIMEOUT_MS = 8_000;

const NO_MOUNT = 'No remote folder is known for this file. Mount it again from Files.';
const NO_DIALOG = 'The sign-in window is not available. Open the folder from Files › Recents.';
const OTHER_FOLDER =
  'A different remote folder was connected. Reconnect this one from Files › Recents.';

type MountLookup = Pick<
  ReturnType<typeof useFileBrowserStore.getState>,
  'entries' | 'recents' | 'pinned'
>;

/**
 * The remote mount that owns `pathOrMountId`: a local path under its cache
 * root, or its mount id. Mounted roots first; a folder unmounted from Files
 * is still found through Recents and Pinned, which keep where it lives.
 */
export function findRemoteMountFor(
  pathOrMountId: string | null | undefined,
  lookup: MountLookup = useFileBrowserStore.getState(),
): RemoteMountRef | null {
  const key = pathOrMountId?.trim();
  if (!key) return null;
  const groups: Array<Array<{ path: string; mountSource?: MountSource }>> = [
    lookup.entries,
    lookup.recents.filter((recent) => recent.kind === 'mount'),
    lookup.pinned,
  ];
  for (const group of groups) {
    const remote = group.filter(
      (candidate): candidate is { path: string; mountSource: MountSource } =>
        candidate.mountSource?.kind === 'remote' && Boolean(candidate.mountSource.host),
    );
    const match =
      remote.find((candidate) => candidate.mountSource.mountId === key) ??
      findOwningRoot(remote, key);
    if (match) return { root: match.path, source: match.mountSource };
  }
  return null;
}

/**
 * Record that a failure on `path` was a lost connection, so the Files panel
 * can say the mount is disconnected. Returns whether it was one.
 */
export function noteRemoteConnectionFailure(
  path: string | null | undefined,
  error: unknown,
): boolean {
  if (!isRemoteConnectionLost(error)) return false;
  const mount = findRemoteMountFor(path);
  if (mount) markRemoteMountDown(mount.root);
  return true;
}

const inFlight = new Map<string, Promise<RemoteReconnectOutcome>>();
const prompts = new Map<string, (mount: ConnectedRemoteMount | null) => void>();

/**
 * Sign in again to the remote mount that owns `pathOrMountId`.
 *
 * Resolves `connected` only when a mount is active under the same local cache
 * root; `cancelled` when the user closes the sign-in; `failed` with a plain
 * reason otherwise. It never rejects. Safe to call from several places: one
 * reconnect runs per mount and later callers get the same promise.
 */
export function reconnectRemoteMount(
  pathOrMountId: string | null | undefined,
): Promise<RemoteReconnectOutcome> {
  const mount = findRemoteMountFor(pathOrMountId);
  if (!mount) return Promise.resolve({ status: 'failed', message: NO_MOUNT });
  const running = inFlight.get(mount.root);
  if (running) return running;
  setRemoteMountReconnecting(mount.root, true);
  const run = reconnect(mount)
    .catch((error): RemoteReconnectOutcome => ({
      status: 'failed',
      message: formatTauriError(error) || 'The remote folder could not be reconnected.',
    }))
    .finally(() => {
      inFlight.delete(mount.root);
      setRemoteMountReconnecting(mount.root, false);
    });
  inFlight.set(mount.root, run);
  return run;
}

async function reconnect(mount: RemoteMountRef): Promise<RemoteReconnectOutcome> {
  const transport = getTransport();
  // The backend may still hold this mount. If its session answers, there is
  // nothing to sign in to. If the backend says the session is gone, the
  // sign-in replaces the dead entry by itself (`register_remote_mount`). A
  // mount that does not answer at all is different: the backend still counts
  // its session as connected and would hand it back instead of dialling, so
  // that entry is unmounted first, keeping the cache.
  const registered = (
    await transport.invoke<ConnectedRemoteMount[]>('list_remote_mounts').catch(() => [])
  ).find((candidate) => candidate.local_path === mount.root);
  if (registered) {
    const probe = await probeMount(mount.root);
    if (probe === 'alive') return adopt(mount.root, registered);
    if (probe === 'silent') {
      try {
        await transport.invoke('remote_mount_unmount', {
          mountId: registered.mount_id,
          purgeCache: false,
        });
      } catch (error) {
        // 8228: already gone. Anything else leaves the silent entry in the way.
        if (tauriErrorCode(error) !== 8228) {
          return { status: 'failed', message: formatTauriError(error) };
        }
      }
    } else if (probe !== 'down') {
      return { status: 'failed', message: probe.message };
    }
  }

  if (useRemoteConnectionStore.getState().hosts === 0) {
    return { status: 'failed', message: NO_DIALOG };
  }
  const connected = await new Promise<ConnectedRemoteMount | null>((resolve) => {
    prompts.set(mount.root, resolve);
    useRemoteConnectionStore.setState((state) => ({
      requests: [
        ...state.requests,
        {
          root: mount.root,
          target: {
            host: mount.source.host ?? '',
            port: mount.source.port,
            user: mount.source.user,
            remotePath: mount.source.remotePath,
          },
        },
      ],
    }));
  });
  if (!connected) return { status: 'cancelled' };
  if (connected.local_path !== mount.root) {
    // The form was pointed at another folder: mount what was connected, but
    // the folder that was asked for is still down.
    await mountConnectedRemoteDirectory(connected);
    return { status: 'failed', message: OTHER_FOLDER };
  }
  return adopt(mount.root, connected);
}

/**
 * Whether the backend's mount at `root` still answers: `down` when the backend
 * reports the connection lost, `silent` when nothing came back in time.
 */
async function probeMount(
  root: string,
): Promise<'alive' | 'down' | 'silent' | { message: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<'silent'>((resolve) => {
    timer = setTimeout(() => resolve('silent'), RECONNECT_PROBE_TIMEOUT_MS);
  });
  const listing = getTransport()
    .invoke('fs_list_directory', { path: root, maxDepth: 1 })
    .then(
      (): 'alive' => 'alive',
      (error): 'down' | { message: string } =>
        isRemoteConnectionLost(error) ? 'down' : { message: formatTauriError(error) },
    );
  try {
    return await Promise.race([listing, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

/** The mount at `root` is usable: take its new mount id and tell who waits. */
function adopt(root: string, mount: ConnectedRemoteMount): RemoteReconnectOutcome {
  const files = useFileBrowserStore.getState();
  files.updateMountSource(root, buildRemoteMountMountOptions(mount).mountSource);
  markRemoteMountActive(root);
  const { error, errorPath } = useFileBrowserStore.getState();
  if (error && errorPath && findOwningRoot([{ path: root }], errorPath)) {
    void files.refreshDirectory(errorPath);
  }
  return { status: 'connected', root };
}

/**
 * The dialog host reports how the sign-in on screen ended: the mount it
 * connected, or null when it was closed without one.
 */
export function settleRemoteReconnectPrompt(
  root: string,
  mount: ConnectedRemoteMount | null,
): void {
  const resolve = prompts.get(root);
  prompts.delete(root);
  useRemoteConnectionStore.setState((state) => ({
    requests: state.requests.filter((request) => request.root !== root),
  }));
  resolve?.(mount);
}

/** Tests only: drop reconnects in flight. */
export function resetRemoteReconnectService(): void {
  inFlight.clear();
  prompts.clear();
}
