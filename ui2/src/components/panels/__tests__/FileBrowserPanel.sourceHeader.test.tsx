import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FileBrowserPanel } from '../FileBrowserPanel';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import type { FileTreeNode, MountSource } from '@/types/filesystem';

vi.mock('react-arborist', () => ({
  Tree: () => <div data-testid="mock-tree" />,
}));

vi.mock('../RemoteMountDialog', () => ({
  RemoteMountDialog: () => null,
}));

function makeRootNode(
  path: string,
  name: string,
  mountSource: MountSource
): FileTreeNode {
  return {
    id: path,
    name,
    path,
    type: 'directory',
    depth: 0,
    expanded: true,
    mountSource,
    children: [],
    modified: new Date(),
  };
}

function resetStore(entries: FileTreeNode[]) {
  useFileBrowserStore.setState({
    currentPath: entries[0]?.path ?? '',
    rootPath: entries[0]?.path ?? '',
    entries,
    expandedPaths: new Set(entries.map((entry) => entry.path)),
    selectedPath: null,
    loading: false,
    error: null,
    searchQuery: '',
    searchResults: [],
    showHidden: false,
    sortBy: 'name',
    sortOrder: 'asc',
  });
}

describe('FileBrowserPanel SourceHeader', () => {
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

  it('renders the Local chip and basename for a local mount', () => {
    resetStore([
      makeRootNode('/Volumes/data/study1', 'study1', { kind: 'local' }),
    ]);

    render(<FileBrowserPanel />);

    expect(screen.getByText('study1')).toBeInTheDocument();
    expect(screen.getByText('Local')).toBeInTheDocument();
    const region = screen.getByRole('region', { name: 'Mounted source' });
    expect(region).toHaveAttribute('title', '/Volumes/data/study1');
  });

  it('renders the SSH chip and remote path breadcrumb for a remote mount', () => {
    resetStore([
      makeRootNode(
        '/tmp/brainflow/mounts/mount-remote-1',
        'study-remote',
        {
          kind: 'remote',
          mountId: 'mount-remote-1',
          host: 'login.example.org',
          port: 2222,
          user: 'alice',
          remotePath: '/data/study',
        }
      ),
    ]);

    render(<FileBrowserPanel />);

    expect(screen.getByText('study-remote')).toBeInTheDocument();
    expect(screen.getByText('SSH')).toBeInTheDocument();
    expect(screen.getByText('/data/study')).toBeInTheDocument();
    const region = screen.getByRole('region', { name: 'Mounted source' });
    expect(region).toHaveAttribute(
      'title',
      'alice@login.example.org:2222:/data/study\nLocal cache: /tmp/brainflow/mounts/mount-remote-1'
    );
  });

  it('does not render the SourceHeader when no directory is mounted', () => {
    resetStore([]);
    useFileBrowserStore.setState({ rootPath: '' });

    render(<FileBrowserPanel />);

    expect(screen.queryByRole('region', { name: 'Mounted source' })).toBeNull();
  });

  it('marks a remote mount whose session dropped as disconnected, with Reconnect', async () => {
    const { markRemoteMountDown, resetRemoteConnectionStore, setRemoteMountReconnecting } =
      await import('@/stores/remoteConnectionStore');
    const { act } = await import('@testing-library/react');
    resetRemoteConnectionStore();
    const root = '/tmp/brainflow/mounts/mount-remote-1';
    resetStore([
      makeRootNode(root, 'study-remote', {
        kind: 'remote',
        mountId: 'mount-remote-1',
        host: 'login.example.org',
        user: 'alice',
        remotePath: '/data/study',
      }),
    ]);
    useFileBrowserStore.setState({ recents: [], pinned: [], errorPath: null });

    render(<FileBrowserPanel />);
    expect(screen.queryByTestId('fb-source-disconnected')).toBeNull();
    expect(screen.queryByTestId('fb-source-reconnect')).toBeNull();

    act(() => markRemoteMountDown(root));
    expect(screen.getByTestId('fb-source-disconnected')).toHaveTextContent('Disconnected');
    expect(screen.getByTestId('fb-source-reconnect')).toHaveTextContent('Reconnect');

    // A listing that failed for this reason says so and offers the same action.
    act(() =>
      useFileBrowserStore.setState({
        error: 'SSH error: SSH session disconnected',
        errorPath: `${root}/sub-04`,
      }),
    );
    expect(screen.getByText('The connection to login.example.org was lost')).toBeInTheDocument();
    expect(screen.queryByText('SSH error: SSH session disconnected')).toBeNull();
    expect(screen.getByTestId('fb-error-reconnect')).toHaveTextContent('Reconnect');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();

    act(() => setRemoteMountReconnecting(root, true));
    expect(screen.getByTestId('fb-source-disconnected')).toHaveTextContent('Reconnecting');
    expect(screen.queryByTestId('fb-source-reconnect')).toBeNull();
    expect(screen.getByTestId('fb-error-reconnect')).toBeDisabled();
    act(() => resetRemoteConnectionStore());
    useFileBrowserStore.setState({ error: null, errorPath: null });
  });
});
