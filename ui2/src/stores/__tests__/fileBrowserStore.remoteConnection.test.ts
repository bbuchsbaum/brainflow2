import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFileBrowserStore } from '../fileBrowserStore';
import { resetRemoteConnectionStore, useRemoteConnectionStore } from '../remoteConnectionStore';
import type { FileTreeNode } from '@/types/filesystem';

const listDirectory = vi.hoisted(() => vi.fn());
vi.mock('@/services/apiService', () => ({ getApiService: () => ({ listDirectory }) }));

const REMOTE = '/cache/remote_mounts/cache-aaa';
const LOCAL = '/data/study';

function root(path: string, remote: boolean): FileTreeNode {
  return {
    id: path,
    name: path.split('/').pop()!,
    path,
    type: 'directory',
    depth: 0,
    children: [],
    mountSource: remote
      ? { kind: 'remote', mountId: 'old', host: 'trillium.alliancecan.ca', remotePath: '/scratch/brad' }
      : { kind: 'local' },
  } as FileTreeNode;
}

const connection = () => useRemoteConnectionStore.getState();

beforeEach(() => {
  listDirectory.mockReset();
  resetRemoteConnectionStore();
  useFileBrowserStore.setState({
    entries: [root(REMOTE, true), root(LOCAL, false)],
    error: null,
    errorPath: null,
  });
});

describe('remote connection state learned from listings', () => {
  it('marks the mount down when listing a remote folder fails on a dropped session', async () => {
    listDirectory.mockRejectedValueOnce({ Io: { code: 8216, details: 'SSH error: SSH session disconnected' } });
    await useFileBrowserStore.getState().loadDirectory(`${REMOTE}/sub-04`);
    expect(connection().down).toEqual({ [REMOTE]: true });
    expect(useFileBrowserStore.getState().errorPath).toBe(`${REMOTE}/sub-04`);
  });

  it('marks it down for a cache path with no active mount (8232)', async () => {
    listDirectory.mockRejectedValueOnce({ Input: { code: 8232, details: 'Remote mount is not active' } });
    await useFileBrowserStore.getState().loadDirectory(REMOTE);
    expect(connection().down).toEqual({ [REMOTE]: true });
  });

  it('does not for another failure, or for a local folder', async () => {
    listDirectory.mockRejectedValueOnce({ Scope: { code: 8216, path: 'permission denied: /scratch/x' } });
    await useFileBrowserStore.getState().loadDirectory(`${REMOTE}/private`);
    listDirectory.mockRejectedValueOnce(new Error('SSH session disconnected'));
    await useFileBrowserStore.getState().loadDirectory(`${LOCAL}/x`);
    expect(connection().down).toEqual({});
  });

  it('announces the mount active once a listing answers again, and only then', async () => {
    listDirectory.mockResolvedValue([]);
    await useFileBrowserStore.getState().loadDirectory(REMOTE);
    expect(connection().activeEpoch).toEqual({});

    listDirectory.mockRejectedValueOnce({ Io: { code: 8216, details: 'SSH error: SSH session disconnected' } });
    await useFileBrowserStore.getState().loadDirectory(REMOTE);
    await useFileBrowserStore.getState().loadDirectory(REMOTE);
    expect(connection().down).toEqual({});
    expect(connection().activeEpoch).toEqual({ [REMOTE]: 1 });
    await useFileBrowserStore.getState().loadDirectory(REMOTE);
    expect(connection().activeEpoch).toEqual({ [REMOTE]: 1 });
  });

  it('takes the new mount id of a reconnected root, and forgets an unmounted one', () => {
    useFileBrowserStore.getState().updateMountSource(REMOTE, {
      kind: 'remote',
      mountId: 'new',
      host: 'trillium.alliancecan.ca',
    });
    expect(useFileBrowserStore.getState().entries[0].mountSource?.mountId).toBe('new');
    useRemoteConnectionStore.setState({ down: { [REMOTE]: true } });
    useFileBrowserStore.getState().unmountDirectory(REMOTE);
    expect(connection().down).toEqual({});
  });
});
