import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FileBrowserPanel } from '../FileBrowserPanel';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import { setTransport } from '@/services/transport';
import type { FileTreeNode, MountSource } from '@/types/filesystem';

vi.mock('react-arborist', () => ({
  Tree: () => <div data-testid="mock-tree" />,
}));

interface BackendTransportLike {
  invoke: (cmd: string, args?: unknown) => Promise<unknown>;
}

function makeRootNode(
  path: string,
  mountSource: MountSource
): FileTreeNode {
  return {
    id: path,
    name: 'mounted-root',
    path,
    type: 'directory',
    depth: 0,
    expanded: true,
    mountSource,
    children: [],
    modified: new Date(),
  };
}

function resetStore(entries: FileTreeNode[], selectedPath: string | null) {
  useFileBrowserStore.setState({
    currentPath: entries[0]?.path ?? '',
    rootPath: entries[0]?.path ?? '',
    entries,
    expandedPaths: new Set(entries.map((entry) => entry.path)),
    selectedPath,
    loading: false,
    error: null,
    searchQuery: '',
    searchResults: [],
    showHidden: false,
    sortBy: 'name',
    sortOrder: 'asc',
  });
}

describe('FileBrowserPanel unmount overflow action', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      }
    );
  });

  it('calls remote unmount and removes selected remote root', async () => {
    const invokeMock = vi.fn().mockResolvedValue({ success: true });
    setTransport({ invoke: invokeMock } as BackendTransportLike);

    const remoteRoot = '/tmp/brainflow/mounts/mount-remote-1';
    resetStore(
      [
        makeRootNode(remoteRoot, {
          kind: 'remote',
          label: 'alice@login.example.org:/data',
          mountId: 'mount-remote-1',
          host: 'login.example.org',
          port: 22,
          user: 'alice',
          remotePath: '/data',
        }),
      ],
      `${remoteRoot}/subdir/brain.nii.gz`
    );

    render(<FileBrowserPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Files actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Unmount Selected' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('remote_mount_unmount', {
        mountId: 'mount-remote-1',
        purgeCache: false,
      });
    });

    await waitFor(() => {
      const state = useFileBrowserStore.getState();
      expect(state.entries).toHaveLength(0);
      expect(state.selectedPath).toBeNull();
    });
  });

  it('unmounts local root without calling remote unmount command', async () => {
    const invokeMock = vi.fn().mockResolvedValue({ success: true });
    setTransport({ invoke: invokeMock } as BackendTransportLike);

    const localRoot = '/tmp/local-data';
    resetStore(
      [
        makeRootNode(localRoot, {
          kind: 'local',
        }),
      ],
      `${localRoot}/brain.nii.gz`
    );

    render(<FileBrowserPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Files actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Unmount Selected' }));

    await waitFor(() => {
      const state = useFileBrowserStore.getState();
      expect(state.entries).toHaveLength(0);
      expect(state.selectedPath).toBeNull();
    });

    expect(invokeMock).not.toHaveBeenCalledWith(
      'remote_mount_unmount',
      expect.anything()
    );
  });

  it('disables unmount action when no selected root is active', () => {
    const invokeMock = vi.fn().mockResolvedValue({ success: true });
    setTransport({ invoke: invokeMock } as BackendTransportLike);

    const localRoot = '/tmp/local-data';
    resetStore(
      [
        makeRootNode(localRoot, {
          kind: 'local',
        }),
      ],
      null
    );

    render(<FileBrowserPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Files actions' }));
    const unmountButton = screen.getByRole('button', { name: 'Unmount Selected' });
    expect(unmountButton).toBeDisabled();
  });
});
