import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FileBrowserPanel } from '../FileBrowserPanel';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import { setTransport } from '@/services/transport';
import { getEventBus } from '@/events/EventBus';
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
        id: '/data/study/T1.nii.gz',
        name: 'T1.nii.gz',
        path: '/data/study/T1.nii.gz',
        type: 'file',
        depth: 1,
        size: 1000,
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
    viewMode: 'tree',
  });
}

describe('FileBrowserPanel panel-level keyboard handler', () => {
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

  it('emits a default-load file-open event when Enter is pressed on a selected file', () => {
    setTransport({ invoke: vi.fn().mockResolvedValue(undefined) } as BackendTransportLike);
    resetStore('/data/study/T1.nii.gz');

    const handler = vi.fn();
    const eventBus = getEventBus();
    eventBus.on('filebrowser.file.open', handler);

    const { container } = render(<FileBrowserPanel />);
    const panel = container.querySelector('.file-browser-panel') as HTMLDivElement;
    expect(panel).not.toBeNull();
    fireEvent.keyDown(panel, { key: 'Enter' });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/data/study/T1.nii.gz', intent: 'default' })
    );
  });

  it('invokes open_mount_dialog on ⌘O / Ctrl+O', () => {
    const invokeMock = vi.fn().mockResolvedValue(undefined);
    setTransport({ invoke: invokeMock } as BackendTransportLike);
    resetStore(null);

    const { container } = render(<FileBrowserPanel />);
    const panel = container.querySelector('.file-browser-panel') as HTMLDivElement;
    fireEvent.keyDown(panel, { key: 'o', metaKey: true });

    expect(invokeMock).toHaveBeenCalledWith('open_mount_dialog');
  });

  it('unmounts the selected root on ⌘⌫ / Ctrl+Backspace', async () => {
    const invokeMock = vi.fn().mockResolvedValue(undefined);
    setTransport({ invoke: invokeMock } as BackendTransportLike);
    resetStore('/data/study/T1.nii.gz');

    const { container } = render(<FileBrowserPanel />);
    const panel = container.querySelector('.file-browser-panel') as HTMLDivElement;

    fireEvent.keyDown(panel, { key: 'Backspace', metaKey: true });

    // Wait one microtask flush so the async unmount runs through.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(useFileBrowserStore.getState().entries).toHaveLength(0);
    expect(useFileBrowserStore.getState().selectedPath).toBeNull();
  });

  it('does not trigger Enter handler when typing in the search input', () => {
    setTransport({ invoke: vi.fn().mockResolvedValue(undefined) } as BackendTransportLike);
    resetStore('/data/study/T1.nii.gz');

    const handler = vi.fn();
    getEventBus().on('filebrowser.file.open', handler);

    render(<FileBrowserPanel />);
    const input = screen.getByLabelText('Search files') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(handler).not.toHaveBeenCalled();
  });
});
