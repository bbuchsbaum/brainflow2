import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setTransport } from '@/services/transport';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import {
  resetRemoteConnectionStore,
  useRemoteConnectionStore,
} from '@/stores/remoteConnectionStore';
import type { FileTreeNode } from '@/types/filesystem';
import type { ConnectedRemoteMount } from '../RemoteMountService';
import {
  RECONNECT_PROBE_TIMEOUT_MS,
  findRemoteMountFor,
  noteRemoteConnectionFailure,
  reconnectRemoteMount,
  resetRemoteReconnectService,
  settleRemoteReconnectPrompt,
} from '../RemoteReconnectService';

// The file browser lists through the api service: send it to the same fake backend.
vi.mock('@/services/apiService', async () => {
  const { getTransport } = await import('@/services/transport');
  return {
    getApiService: () => ({
      listDirectory: (path: string) =>
        getTransport()
          .invoke<{ nodes: unknown[] }>('fs_list_directory', { path, maxDepth: 1 })
          .then((result) => result.nodes),
    }),
  };
});

const ROOT_A = '/cache/remote_mounts/cache-aaa';
const ROOT_B = '/cache/remote_mounts/cache-bbb';
const MEMBER = `${ROOT_A}/sub-04/same_item.nii.gz`;
const DROPPED = { Io: { code: 8266, details: 'SSH error: SSH session disconnected' } };

function root(path: string, mountId: string, host: string): FileTreeNode {
  return {
    id: path,
    name: host,
    path,
    type: 'directory',
    depth: 0,
    children: [],
    mountSource: { kind: 'remote', mountId, host, port: 22, user: 'brad', remotePath: '/scratch/brad' },
  } as FileTreeNode;
}

function connected(path: string, mountId: string, host: string): ConnectedRemoteMount {
  return {
    mount_id: mountId,
    local_path: path,
    display_name: host,
    origin: { mount_id: mountId, label: `brad@${host}`, host, port: 22, user: 'brad', remote_path: '/scratch/brad' },
  } as ConnectedRemoteMount;
}

type Handler = (args: Record<string, unknown>) => unknown;
let handlers: Record<string, Handler>;
let calls: Array<[string, Record<string, unknown>]>;
const requests = () => useRemoteConnectionStore.getState().requests;
const flush = async () => {
  for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

beforeEach(() => {
  resetRemoteReconnectService();
  resetRemoteConnectionStore();
  // A dialog host is mounted (App).
  useRemoteConnectionStore.setState({ hosts: 1 });
  useFileBrowserStore.setState({
    entries: [root(ROOT_A, 'old-a', 'trillium.alliancecan.ca'), root(ROOT_B, 'old-b', 'other.example.org')],
    recents: [],
    pinned: [],
    error: null,
    errorPath: null,
  });
  calls = [];
  handlers = {
    // The backend still holds the dead mount.
    list_remote_mounts: () => [connected(ROOT_A, 'old-a', 'trillium.alliancecan.ca')],
    fs_list_directory: () => Promise.reject(DROPPED),
    remote_mount_unmount: () => ({}),
  };
  setTransport({
    invoke: (cmd: string, args?: unknown) => {
      calls.push([cmd, (args ?? {}) as Record<string, unknown>]);
      const handler = handlers[cmd];
      if (!handler) return Promise.reject(new Error(`unexpected command ${cmd}`));
      return Promise.resolve().then(() => handler((args ?? {}) as Record<string, unknown>));
    },
  } as never);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('findRemoteMountFor', () => {
  it('finds the remote mount that owns a cache path, or has a mount id', () => {
    expect(findRemoteMountFor(MEMBER)?.root).toBe(ROOT_A);
    expect(findRemoteMountFor(ROOT_B)?.source.host).toBe('other.example.org');
    expect(findRemoteMountFor('old-b')?.root).toBe(ROOT_B);
    expect(findRemoteMountFor('/data/local/x.nii.gz')).toBeNull();
    expect(findRemoteMountFor(null)).toBeNull();
  });

  it('still finds a folder unmounted from Files through Recents', () => {
    const [entry] = useFileBrowserStore.getState().entries;
    useFileBrowserStore.setState({
      entries: [],
      recents: [
        { path: ROOT_A, displayName: 'trillium', mountSource: entry.mountSource!, lastOpened: 1, kind: 'mount' },
      ],
    });
    expect(findRemoteMountFor(MEMBER)).toEqual({ root: ROOT_A, source: entry.mountSource });
  });
});

describe('noteRemoteConnectionFailure', () => {
  it('marks the owning mount down for a dropped connection only', () => {
    expect(noteRemoteConnectionFailure(MEMBER, new Error('not a NIfTI file'))).toBe(false);
    expect(useRemoteConnectionStore.getState().down).toEqual({});
    expect(noteRemoteConnectionFailure(MEMBER, DROPPED)).toBe(true);
    expect(useRemoteConnectionStore.getState().down).toEqual({ [ROOT_A]: true });
  });
});

describe('reconnectRemoteMount', () => {
  it('signs in on the saved folder and resolves once the mount is active under the same root', async () => {
    noteRemoteConnectionFailure(MEMBER, DROPPED);
    let settled = false;
    const run = reconnectRemoteMount(MEMBER).then((outcome) => {
      settled = true;
      return outcome;
    });
    expect(useRemoteConnectionStore.getState().reconnecting).toEqual({ [ROOT_A]: true });
    await flush();

    // The backend said the session is gone: the sign-in replaces that entry
    // itself, so nothing is unmounted here.
    expect(calls.map(([cmd]) => cmd)).toEqual(['list_remote_mounts', 'fs_list_directory']);
    // The dialog is asked for, prefilled: no host, user or folder to retype.
    expect(requests()).toEqual([
      {
        root: ROOT_A,
        target: { host: 'trillium.alliancecan.ca', port: 22, user: 'brad', remotePath: '/scratch/brad' },
      },
    ]);
    expect(settled).toBe(false);

    settleRemoteReconnectPrompt(ROOT_A, connected(ROOT_A, 'new-a', 'trillium.alliancecan.ca'));
    await expect(run).resolves.toEqual({ status: 'connected', root: ROOT_A });

    const state = useRemoteConnectionStore.getState();
    expect(state.requests).toEqual([]);
    expect(state.reconnecting).toEqual({});
    expect(state.down).toEqual({});
    expect(state.activeEpoch).toEqual({ [ROOT_A]: 1 });
    // The mounted root keeps its path and takes the new session's mount id.
    const entry = useFileBrowserStore.getState().entries.find((e) => e.path === ROOT_A);
    expect(entry?.mountSource?.mountId).toBe('new-a');
  });

  it('joins callers that ask while one reconnect of the mount is running', async () => {
    const first = reconnectRemoteMount(MEMBER);
    const second = reconnectRemoteMount(`${ROOT_A}/sub-09/other.nii.gz`);
    const third = reconnectRemoteMount('old-a');
    expect(second).toBe(first);
    expect(third).toBe(first);
    await flush();
    expect(requests()).toHaveLength(1);
    expect(calls.filter(([cmd]) => cmd === 'fs_list_directory')).toHaveLength(1);
    expect(calls.filter(([cmd]) => cmd === 'remote_mount_unmount')).toHaveLength(0);

    settleRemoteReconnectPrompt(ROOT_A, connected(ROOT_A, 'new-a', 'trillium.alliancecan.ca'));
    const outcomes = await Promise.all([first, second, third]);
    expect(outcomes.every((outcome) => outcome.status === 'connected')).toBe(true);
    expect(useRemoteConnectionStore.getState().activeEpoch[ROOT_A]).toBe(1);

    // Finished: the next call is a new reconnect.
    expect(reconnectRemoteMount(MEMBER)).not.toBe(first);
  });

  it('keeps mounts apart: reconnecting one says nothing about the other', async () => {
    handlers.list_remote_mounts = () => [];
    const a = reconnectRemoteMount(MEMBER);
    const b = reconnectRemoteMount(`${ROOT_B}/x.nii.gz`);
    expect(b).not.toBe(a);
    await flush();
    expect(requests().map((request) => request.root)).toEqual([ROOT_A, ROOT_B]);
    settleRemoteReconnectPrompt(ROOT_B, connected(ROOT_B, 'new-b', 'other.example.org'));
    await expect(b).resolves.toEqual({ status: 'connected', root: ROOT_B });
    expect(useRemoteConnectionStore.getState().activeEpoch).toEqual({ [ROOT_B]: 1 });
    expect(useRemoteConnectionStore.getState().reconnecting).toEqual({ [ROOT_A]: true });
    settleRemoteReconnectPrompt(ROOT_A, null);
    await expect(a).resolves.toEqual({ status: 'cancelled' });
  });

  it('reports a cancelled sign-in and changes nothing', async () => {
    noteRemoteConnectionFailure(MEMBER, DROPPED);
    const run = reconnectRemoteMount(MEMBER);
    await flush();
    settleRemoteReconnectPrompt(ROOT_A, null);
    await expect(run).resolves.toEqual({ status: 'cancelled' });
    const state = useRemoteConnectionStore.getState();
    expect(state.activeEpoch).toEqual({});
    expect(state.down).toEqual({ [ROOT_A]: true });
    expect(state.reconnecting).toEqual({});
    expect(state.requests).toEqual([]);
  });

  it('does not sign in again when the mount still answers', async () => {
    noteRemoteConnectionFailure(MEMBER, DROPPED);
    handlers.fs_list_directory = () => ({ nodes: [] });
    await expect(reconnectRemoteMount(MEMBER)).resolves.toEqual({ status: 'connected', root: ROOT_A });
    expect(calls.some(([cmd]) => cmd === 'remote_mount_unmount')).toBe(false);
    expect(requests()).toEqual([]);
    expect(useRemoteConnectionStore.getState().activeEpoch).toEqual({ [ROOT_A]: 1 });
  });

  it('fails plainly, keeping the mount, when the folder fails for another reason', async () => {
    handlers.fs_list_directory = () =>
      Promise.reject({ Scope: { code: 8216, path: 'permission denied: /scratch/brad' } });
    await expect(reconnectRemoteMount(MEMBER)).resolves.toEqual({
      status: 'failed',
      message: 'permission denied: /scratch/brad',
    });
    expect(calls.some(([cmd]) => cmd === 'remote_mount_unmount')).toBe(false);
    expect(requests()).toEqual([]);
    expect(useRemoteConnectionStore.getState().reconnecting).toEqual({});
  });

  it('treats a mount that does not answer in time as down', async () => {
    vi.useFakeTimers();
    handlers.fs_list_directory = () => new Promise(() => {});
    const run = reconnectRemoteMount(MEMBER);
    await vi.advanceTimersByTimeAsync(RECONNECT_PROBE_TIMEOUT_MS + 1);
    // The backend still counts this session as connected and would hand it
    // back: the entry is released first, keeping the cache.
    const unmounts = calls.filter(([cmd]) => cmd === 'remote_mount_unmount');
    expect(unmounts).toHaveLength(1);
    expect(unmounts[0][1]).toEqual({ mountId: 'old-a', purgeCache: false });
    expect(requests()).toHaveLength(1);
    settleRemoteReconnectPrompt(ROOT_A, null);
    await expect(run).resolves.toEqual({ status: 'cancelled' });
  });

  it('fails when a silent mount cannot be released, and when the path has no remote mount', async () => {
    vi.useFakeTimers();
    handlers.fs_list_directory = () => new Promise(() => {});
    handlers.remote_mount_unmount = () =>
      Promise.reject({ Internal: { code: 8229, details: 'close failed' } });
    const run = reconnectRemoteMount(MEMBER);
    await vi.advanceTimersByTimeAsync(RECONNECT_PROBE_TIMEOUT_MS + 1);
    await expect(run).resolves.toEqual({
      status: 'failed',
      message: 'close failed',
    });
    await expect(reconnectRemoteMount('/data/local/x.nii.gz')).resolves.toMatchObject({
      status: 'failed',
    });
    expect(requests()).toEqual([]);
  });

  it('does not count another folder as this mount coming back', async () => {
    handlers.list_remote_mounts = () => [];
    handlers.fs_list_directory = () => ({ nodes: [] });
    const run = reconnectRemoteMount(MEMBER);
    await flush();
    const elsewhere = '/cache/remote_mounts/cache-ccc';
    settleRemoteReconnectPrompt(ROOT_A, connected(elsewhere, 'new-c', 'trillium.alliancecan.ca'));
    await expect(run).resolves.toMatchObject({ status: 'failed' });
    expect(useRemoteConnectionStore.getState().activeEpoch[ROOT_A]).toBeUndefined();
    // What was connected is mounted all the same.
    expect(useFileBrowserStore.getState().entries.some((e) => e.path === elsewhere)).toBe(true);
  });

  it('lists the failed folder again once the mount is back', async () => {
    handlers.list_remote_mounts = () => [];
    useFileBrowserStore.setState({ error: 'SSH error: SSH session disconnected', errorPath: `${ROOT_A}/sub-04` });
    const run = reconnectRemoteMount(MEMBER);
    await flush();
    handlers.fs_list_directory = () => ({ nodes: [] });
    settleRemoteReconnectPrompt(ROOT_A, connected(ROOT_A, 'new-a', 'trillium.alliancecan.ca'));
    await run;
    await flush();
    expect(calls.some(([cmd, args]) => cmd === 'fs_list_directory' && args.path === `${ROOT_A}/sub-04`)).toBe(true);
    expect(useFileBrowserStore.getState().error).toBeNull();
  });

  it('says so when no sign-in window is mounted', async () => {
    useRemoteConnectionStore.setState({ hosts: 0 });
    handlers.list_remote_mounts = () => [];
    await expect(reconnectRemoteMount(MEMBER)).resolves.toMatchObject({ status: 'failed' });
    expect(requests()).toEqual([]);
  });
});
