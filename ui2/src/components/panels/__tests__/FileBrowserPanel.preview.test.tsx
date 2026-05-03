import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { FileBrowserPanel } from '../FileBrowserPanel';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import { setTransport } from '@/services/transport';
import type { FileTreeNode } from '@/types/filesystem';

vi.mock('react-arborist', () => ({
  Tree: () => <div data-testid="mock-tree" />,
}));

vi.mock('../RemoteMountDialog', () => ({
  RemoteMountDialog: () => null,
}));

interface BackendTransportLike {
  invoke: (cmd: string, args?: unknown) => Promise<unknown>;
}

function makeRoot(): FileTreeNode {
  return {
    id: '/data/study',
    name: 'study',
    path: '/data/study',
    type: 'directory',
    depth: 0,
    expanded: true,
    mountSource: { kind: 'local' },
    modified: new Date(),
    children: [
      {
        id: '/data/study/brain.nii.gz',
        name: 'brain.nii.gz',
        path: '/data/study/brain.nii.gz',
        type: 'file',
        depth: 1,
        size: 4_200_000,
      },
    ],
  };
}

function resetStore(selectedPath: string | null) {
  const root = makeRoot();
  useFileBrowserStore.setState({
    currentPath: root.path,
    rootPath: root.path,
    entries: [root],
    expandedPaths: new Set([root.path]),
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

describe('FileBrowserPanel SelectedFileSummary', () => {
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

  it('does not render the summary when no file is selected', () => {
    resetStore(null);
    setTransport({ invoke: vi.fn().mockResolvedValue({}) } as BackendTransportLike);

    render(<FileBrowserPanel />);

    expect(screen.queryByRole('region', { name: 'Selected file summary' })).toBeNull();
  });

  it('invokes peek_volume_metadata for the selected file and shows dims', async () => {
    const invokeMock = vi.fn(async (cmd: string) => {
      if (cmd === 'peek_volume_metadata') {
        return {
          dims: [128, 128, 64, 100],
          voxelSize: [2, 2, 2],
          dtype: 'f32',
          isFourD: true,
          numTimepoints: 100,
        };
      }
      return {};
    });
    setTransport({ invoke: invokeMock } as BackendTransportLike);

    resetStore('/data/study/brain.nii.gz');

    render(<FileBrowserPanel />);

    expect(screen.getByRole('region', { name: 'Selected file summary' })).toBeInTheDocument();
    expect(screen.getByText('brain.nii.gz')).toBeInTheDocument();

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'peek_volume_metadata',
        { path: '/data/study/brain.nii.gz' }
      );
    });

    await waitFor(() => {
      expect(screen.getByText('128 × 128 × 64 × 100')).toBeInTheDocument();
    });
    expect(screen.getByText('100t')).toBeInTheDocument();
  });

  it('falls back to file size when peek_volume_metadata rejects', async () => {
    const invokeMock = vi.fn(async (cmd: string) => {
      if (cmd === 'peek_volume_metadata') {
        throw new Error('command not registered');
      }
      return {};
    });
    setTransport({ invoke: invokeMock } as BackendTransportLike);

    resetStore('/data/study/brain.nii.gz');

    render(<FileBrowserPanel />);

    await waitFor(() => {
      expect(screen.getByText('Quick preview unavailable.')).toBeInTheDocument();
    });
    // Falls back to file size meta when peek is unavailable.
    expect(screen.getByText('4.0MB')).toBeInTheDocument();
  });
});
