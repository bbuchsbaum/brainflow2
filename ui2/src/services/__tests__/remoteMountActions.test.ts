import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@/services/transport', () => ({
  getTransport: () => ({ invoke }),
  getHostCapabilities: () => ({ remoteMounts: true }),
}));

import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import { useRemoteMountStore } from '@/stores/remoteMountStore';
import {
  findRemoteRoot,
  reconnectRemoteRoot,
  unmountRemoteRoot,
} from '@/services/remoteMountActions';
import type { FileTreeNode, MountSource } from '@/types/filesystem';

const source: MountSource = {
  kind: 'remote',
  mountId: 'm1',
  host: 'login.example.org',
  port: 22,
  user: 'alice',
  remotePath: '/data',
};

function remoteRoot(): FileTreeNode {
  return {
    id: '/cache/r',
    name: 'data',
    path: '/cache/r',
    type: 'directory',
    depth: 0,
    children: [],
    mountSource: source,
  } as FileTreeNode;
}

describe('remote mount actions', () => {
  beforeEach(() => {
    invoke.mockReset();
    useRemoteMountStore.setState({
      statuses: {},
      prefetchJobs: {},
      dialog: { open: false, target: null, autoConnect: false },
    });
  });

  it('finds the remote root that contains a path', () => {
    const entries = [remoteRoot(), { ...remoteRoot(), path: '/local', mountSource: { kind: 'local' } } as FileTreeNode];
    expect(findRemoteRoot(entries, '/cache/r/sub/a.nii')?.path).toBe('/cache/r');
    expect(findRemoteRoot(entries, '/cache/r')?.path).toBe('/cache/r');
    expect(findRemoteRoot(entries, '/cache/rx')).toBeNull();
    expect(findRemoteRoot(entries, '/local/a.nii')).toBeNull();
  });

  it('opens the sign-in dialog on the folder when its session is gone', async () => {
    useRemoteMountStore.getState().setStatuses([
      { mount_id: 'm1', state: 'disconnected', shared_session_mounts: 1 },
    ]);
    await reconnectRemoteRoot('/cache/r', source);
    expect(useRemoteMountStore.getState().dialog).toEqual({
      open: true,
      autoConnect: true,
      target: { host: 'login.example.org', port: 22, user: 'alice', remotePath: '/data' },
    });
  });

  it('nudges a session that reconnects by itself instead of asking to sign in', async () => {
    useRemoteMountStore.getState().setStatuses([
      { mount_id: 'm1', state: 'reconnecting', shared_session_mounts: 1 },
    ]);
    const refreshDirectory = vi.fn().mockResolvedValue(undefined);
    useFileBrowserStore.setState({ refreshDirectory });
    invoke.mockImplementation((cmd: string) =>
      cmd === 'remote_mount_statuses'
        ? Promise.resolve([{ mount_id: 'm1', state: 'connected', shared_session_mounts: 1 }])
        : Promise.reject(new Error(cmd))
    );

    await reconnectRemoteRoot('/cache/r', source);

    expect(refreshDirectory).toHaveBeenCalledWith('/cache/r');
    expect(useRemoteMountStore.getState().statuses.m1.state).toBe('connected');
    expect(useRemoteMountStore.getState().dialog.open).toBe(false);
  });

  it('unmounts with cache purge when asked', async () => {
    const unmountDirectory = vi.fn();
    useFileBrowserStore.setState({ unmountDirectory, selectedPath: '/cache/r/a.nii' });
    invoke.mockResolvedValue([]);
    await unmountRemoteRoot('/cache/r', source, true);
    expect(invoke).toHaveBeenCalledWith('remote_mount_unmount', { mountId: 'm1', purgeCache: true });
    expect(unmountDirectory).toHaveBeenCalledWith('/cache/r');
    expect(useFileBrowserStore.getState().selectedPath).toBeNull();
  });

  it('ignores status updates that change nothing', () => {
    const status = { mount_id: 'm1', state: 'connected', shared_session_mounts: 2 };
    useRemoteMountStore.getState().setStatuses([status]);
    const first = useRemoteMountStore.getState().statuses;
    useRemoteMountStore.getState().setStatuses([{ ...status }]);
    expect(useRemoteMountStore.getState().statuses).toBe(first);
    useRemoteMountStore.getState().setStatuses([{ ...status, state: 'disconnected' }]);
    expect(useRemoteMountStore.getState().statuses).not.toBe(first);
  });
});
