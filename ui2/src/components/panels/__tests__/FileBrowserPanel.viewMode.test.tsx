import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FileBrowserPanel } from '../FileBrowserPanel';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import { useLayerStore, type LayerInfo } from '@/stores/layerStore';
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
        id: '/data/study/anat',
        name: 'anat',
        path: '/data/study/anat',
        type: 'directory',
        depth: 1,
        children: [
          {
            id: '/data/study/anat/T1w.nii.gz',
            name: 'T1w.nii.gz',
            path: '/data/study/anat/T1w.nii.gz',
            type: 'file',
            depth: 2,
            size: 1000,
          },
          {
            id: '/data/study/anat/notes.txt',
            name: 'notes.txt',
            path: '/data/study/anat/notes.txt',
            type: 'file',
            depth: 2,
            size: 100,
          },
        ],
      },
    ],
  };
}

function resetStore() {
  const root = makeRoot();
  useFileBrowserStore.setState({
    currentPath: root.path,
    rootPath: root.path,
    entries: [root],
    expandedPaths: new Set([root.path]),
    selectedPath: null,
    loading: false,
    error: null,
    searchQuery: '',
    searchResults: [],
    showHidden: false,
    sortBy: 'name',
    sortOrder: 'asc',
    viewMode: 'tree',
  });
}

describe('FileBrowserPanel ViewModeTabs', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      }
    );
    setTransport({
      invoke: vi.fn().mockResolvedValue(false),
    } as BackendTransportLike);
    useLayerStore.setState({ layers: [], selectedLayerId: null });
  });

  it('renders the four tabs and switches to Images view', () => {
    resetStore();
    render(<FileBrowserPanel />);

    const tablist = screen.getByRole('tablist', { name: 'File view mode' });
    expect(tablist).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Tree/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /BIDS/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Images/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Loaded/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /Images/ }));

    expect(useFileBrowserStore.getState().viewMode).toBe('images');
    // Only the imaging file shows up in the flat list.
    expect(screen.getByText('T1w.nii.gz')).toBeInTheDocument();
    expect(screen.queryByText('notes.txt')).toBeNull();
    expect(screen.getByText('anat')).toBeInTheDocument();
  });

  it('shows "No layers loaded" empty state in the Loaded view', () => {
    resetStore();
    render(<FileBrowserPanel />);

    fireEvent.click(screen.getByRole('tab', { name: /Loaded/ }));

    expect(screen.getByText('No layers loaded')).toBeInTheDocument();
  });

  it('lists layers from useLayerStore when switching to Loaded view', () => {
    resetStore();
    const layer: LayerInfo = {
      id: 'layer-1',
      name: 'study-T1w',
      type: 'volume',
      visible: true,
      order: 0,
      volumeId: 'vol-1',
      source: 'file',
      sourcePath: '/data/study/anat/T1w.nii.gz',
      volumeType: 'Volume3D',
    };
    useLayerStore.setState({ layers: [layer], selectedLayerId: null });

    render(<FileBrowserPanel />);

    fireEvent.click(screen.getByRole('tab', { name: /Loaded/ }));

    expect(screen.getByText('study-T1w')).toBeInTheDocument();
  });
});
