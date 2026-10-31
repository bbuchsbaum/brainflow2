import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FileBrowserPanel } from '../FileBrowserPanel';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import { setTransport } from '@/services/transport';
import type { FileTreeNode } from '@/types/filesystem';

/** QA 2026-10-30 F46: search empty state, open folders across a search, header root. */

interface CapturedTreeProps {
  data: Array<{ id: string; name: string; children?: Array<{ name: string }> }>;
  initialOpenState?: Record<string, boolean>;
  onToggle?: (id: string) => void;
}

const tree = vi.hoisted(() => ({
  props: null as CapturedTreeProps | null,
  mounts: 0,
  open: new Set<string>(),
  filtered: false,
}));

vi.mock('react-arborist', async () => {
  const ReactMod = await import('react');
  const Tree = ReactMod.forwardRef((props: CapturedTreeProps, ref) => {
    tree.props = props;
    ReactMod.useImperativeHandle(ref, () => ({
      get isFiltered() {
        return tree.filtered;
      },
      isOpen: (id: string) => tree.open.has(id),
    }));
    ReactMod.useEffect(() => {
      tree.mounts += 1;
    }, []);
    return <div data-testid="mock-tree" />;
  });
  return { Tree };
});

vi.mock('../RemoteMountDialog', () => ({ RemoteMountDialog: () => null }));
vi.mock('@/services/apiService', () => ({
  getApiService: () => ({ listDirectory: vi.fn().mockResolvedValue([]) }),
}));

const dir = (path: string, children: FileTreeNode[] = []): FileTreeNode => ({
  id: path,
  name: path.split('/').pop() ?? path,
  path,
  type: 'directory',
  depth: 0,
  expanded: false,
  children,
  mountSource: { kind: 'local' },
});
const file = (path: string): FileTreeNode => ({
  id: path,
  name: path.split('/').pop() ?? path,
  path,
  type: 'file',
  depth: 1,
  extension: '.nii',
});

function resetStore(entries: FileTreeNode[], selectedPath: string | null = null) {
  useFileBrowserStore.getState().clearSearch();
  useFileBrowserStore.setState({
    currentPath: entries[0]?.path ?? '',
    rootPath: entries[0]?.path ?? '',
    entries,
    expandedPaths: new Set(),
    loadingPaths: new Set(),
    selectedPath,
    loading: false,
    error: null,
    errorPath: null,
    searchQuery: '',
    searchResults: [],
    sortBy: 'name',
    sortOrder: 'asc',
    viewMode: 'tree',
  });
}

describe('Files panel (QA 2026-10-30 F46)', () => {
  beforeEach(() => {
    tree.props = null;
    tree.mounts = 0;
    tree.open = new Set();
    tree.filtered = false;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
    setTransport({ invoke: vi.fn().mockResolvedValue(false) } as never);
  });

  it('shows "No matching files" over the tree, which stays mounted', () => {
    resetStore([dir('/data/a', [file('/data/a/t1.nii')])]);
    render(<FileBrowserPanel />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search files' }), {
      target: { value: 'zzz-no-such-file' },
    });
    act(() => {
      useFileBrowserStore.setState({ searchIndexing: false });
    });
    expect(screen.getByTestId('files-search-empty')).toHaveTextContent('No matching files');
    expect(screen.getByTestId('mock-tree')).toBeInTheDocument();
    expect(tree.mounts).toBe(1);
  });

  it('a remounted tree reopens the folders the user had open, not ones opened by a search', () => {
    const a = dir('/data/a', [dir('/data/a/sub')]);
    resetStore([a]);
    const { rerender } = render(<FileBrowserPanel />);
    // The user opens /data/a.
    tree.open.add('/data/a');
    act(() => tree.props!.onToggle!('/data/a'));
    // A search opens /data/a::/data/a/sub in its own (filtered) state.
    tree.filtered = true;
    tree.open.add('/data/a::/data/a/sub');
    act(() => tree.props!.onToggle!('/data/a::/data/a/sub'));
    tree.filtered = false;
    // Mounting another root remounts the tree (its key is the root count).
    act(() => {
      useFileBrowserStore.setState({ entries: [a, dir('/data/b')] });
    });
    rerender(<FileBrowserPanel />);
    expect(tree.mounts).toBe(2);
    expect(tree.props!.initialOpenState).toEqual({ '/data/a': true });
    // Closing it is remembered too.
    tree.open.delete('/data/a');
    act(() => tree.props!.onToggle!('/data/a'));
    act(() => {
      useFileBrowserStore.setState({ entries: [a] });
    });
    rerender(<FileBrowserPanel />);
    expect(tree.props!.initialOpenState).toEqual({});
  });

  it('the header names the root mounted last when nothing is selected, else the selection’s root', () => {
    resetStore([dir('/data/first'), dir('/data/second')]);
    const { unmount } = render(<FileBrowserPanel />);
    expect(screen.getByRole('region', { name: 'Mounted source' })).toHaveTextContent('second');
    unmount();
    resetStore([dir('/data/first', [file('/data/first/t1.nii')]), dir('/data/second')], '/data/first/t1.nii');
    render(<FileBrowserPanel />);
    expect(screen.getByRole('region', { name: 'Mounted source' })).toHaveTextContent('first');
  });

  it('size sort breaks ties by name A→Z in either order', () => {
    const sized = (name: string, size: number) => ({ ...file(`/data/a/${name}`), size });
    for (const sortOrder of ['asc', 'desc'] as const) {
      resetStore([dir('/data/a', [sized('c.nii', 5), sized('b.nii', 5), sized('a.nii', 5), sized('big.nii', 9)])]);
      useFileBrowserStore.setState({ sortBy: 'size', sortOrder });
      const { unmount } = render(<FileBrowserPanel />);
      const names = tree.props!.data[0].children!.map((c) => c.name);
      expect(names).toEqual(sortOrder === 'asc' ? ['a.nii', 'b.nii', 'c.nii', 'big.nii'] : ['big.nii', 'a.nii', 'b.nii', 'c.nii']);
      unmount();
    }
  });
});
