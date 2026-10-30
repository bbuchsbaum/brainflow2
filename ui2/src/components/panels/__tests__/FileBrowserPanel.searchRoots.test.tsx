import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FileBrowserPanel } from '../FileBrowserPanel';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import { setTransport } from '@/services/transport';
import type { FileTreeNode } from '@/types/filesystem';

interface TreeNodeData {
  id: string;
  name: string;
  path: string;
  children?: TreeNodeData[];
}

interface CapturedTreeProps {
  data: TreeNodeData[];
  searchTerm?: string;
  searchMatch?: (node: { data: TreeNodeData }, term: string) => boolean;
}

const captured: { current: CapturedTreeProps | null } = { current: null };

vi.mock('react-arborist', () => ({
  Tree: (props: CapturedTreeProps) => {
    captured.current = props;
    return <div data-testid="mock-tree" />;
  },
}));

vi.mock('../RemoteMountDialog', () => ({ RemoteMountDialog: () => null }));

const { listDirectory } = vi.hoisted(() => ({ listDirectory: vi.fn() }));
vi.mock('@/services/apiService', () => ({
  getApiService: () => ({ listDirectory }),
}));

function dir(path: string, children: FileTreeNode[] = [], depth = 0): FileTreeNode {
  return {
    id: path,
    name: path.split('/').pop() ?? path,
    path,
    type: 'directory',
    depth,
    expanded: false,
    children,
    mountSource: { kind: 'local' },
  };
}

function file(path: string, depth = 1): FileTreeNode {
  return {
    id: path,
    name: path.split('/').pop() ?? path,
    path,
    type: 'file',
    depth,
    extension: '.nii',
  };
}

function resetStore(
  entries: FileTreeNode[],
  extra: Partial<ReturnType<typeof useFileBrowserStore.getState>> = {},
) {
  useFileBrowserStore.getState().clearSearch();
  useFileBrowserStore.setState({
    currentPath: '',
    rootPath: '',
    entries,
    expandedPaths: new Set(),
    loadingPaths: new Set(),
    selectedPath: null,
    loading: false,
    error: null,
    errorPath: null,
    searchQuery: '',
    searchResults: [],
    sortBy: 'name',
    sortOrder: 'asc',
    viewMode: 'tree',
    ...extra,
  });
}

function collectIds(nodes: TreeNodeData[], out: string[] = []): string[] {
  for (const node of nodes) {
    out.push(node.id);
    if (node.children) collectIds(node.children, out);
  }
  return out;
}

describe('FileBrowserPanel search, roots and retry', () => {
  beforeEach(() => {
    captured.current = null;
    listDirectory.mockReset();
    listDirectory.mockResolvedValue([]);
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

  it('gives every tree row a unique id even when a folder is mounted inside another root', () => {
    const refs = dir('/data/test-data/refs', [file('/data/test-data/refs/a.nii', 1)]);
    const parent = dir('/data/test-data', [
      dir('/data/test-data/refs', [file('/data/test-data/refs/a.nii', 2)], 1),
    ]);
    resetStore([parent, refs]);
    render(<FileBrowserPanel />);

    const ids = collectIds(captured.current!.data);
    expect(new Set(ids).size).toBe(ids.length);
    // Roots keep their path; rows are qualified by the root they sit under.
    expect(ids).toContain('/data/test-data/refs');
    expect(ids).toContain('/data/test-data::/data/test-data/refs/a.nii');
    expect(ids).toContain('/data/test-data/refs::/data/test-data/refs/a.nii');
  });

  it('row ids do not change when the sort changes', () => {
    const refs = dir('/data/test-data/refs', [file('/data/test-data/refs/a.nii', 1)]);
    const parent = dir('/data/test-data', [
      dir('/data/test-data/refs', [file('/data/test-data/refs/a.nii', 2)], 1),
      { ...file('/data/test-data/z.nii'), size: 1 },
      { ...file('/data/test-data/b.nii'), size: 9 },
    ]);
    resetStore([parent, refs]);
    const { rerender } = render(<FileBrowserPanel />);
    const byPath = (nodes: TreeNodeData[]) => {
      const out = new Map<string, string[]>();
      const visit = (list: TreeNodeData[]) => {
        for (const n of list) {
          out.set(n.path, [...(out.get(n.path) ?? []), n.id].sort());
          if (n.children) visit(n.children);
        }
      };
      visit(nodes);
      return out;
    };
    const before = byPath(captured.current!.data);

    useFileBrowserStore.setState({ sortBy: 'size', sortOrder: 'desc' });
    rerender(<FileBrowserPanel />);
    expect(byPath(captured.current!.data)).toEqual(before);
  });

  it('says the search was partial when it stopped at its limits', () => {
    const root = dir('/data/study', [file('/data/study/oblique.nii')]);
    resetStore([root]);
    render(<FileBrowserPanel />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search files' }), {
      target: { value: 'oblique' },
    });
    act(() => {
      useFileBrowserStore.setState({ searchTruncated: true, searchIndexing: false });
    });
    expect(
      screen.getAllByRole('status').some((el) => /Searched in part/.test(el.textContent ?? '')),
    ).toBe(true);
  });

  it('filters the full tree through react-arborist searchTerm instead of a flat result list', () => {
    const root = dir('/data/study', [
      dir('/data/study/browser', [file('/data/study/browser/oblique.nii', 2)], 1),
      file('/data/study/T1w.nii'),
    ]);
    resetStore([root]);
    render(<FileBrowserPanel />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Search files' }), {
      target: { value: 'oblique' },
    });

    const tree = captured.current!;
    expect(tree.searchTerm).toBe('oblique');
    // Same nested data as without a search: nothing duplicated or flattened.
    expect(tree.data).toHaveLength(1);
    expect(tree.data[0].children?.map((c) => c.name)).toEqual(['browser', 'T1w.nii']);
    expect(
      tree.searchMatch!({ data: { id: 'x', name: 'Oblique4d.nii', path: 'x' } }, 'oblique'),
    ).toBe(true);
    expect(tree.searchMatch!({ data: { id: 'x', name: 'T1w.nii', path: 'x' } }, 'oblique')).toBe(
      false,
    );
  });

  it('search input disables autocorrect, autocapitalize and spellcheck', () => {
    resetStore([dir('/data/study')]);
    render(<FileBrowserPanel />);
    const input = screen.getByRole('textbox', { name: 'Search files' });
    expect(input).toHaveAttribute('autocorrect', 'off');
    expect(input).toHaveAttribute('autocapitalize', 'off');
    expect(input).toHaveAttribute('spellcheck', 'false');
  });

  it('Unmount selected removes the root that owns the selection (longest prefix), not its parent', async () => {
    const parent = dir('/data/test-data');
    const refs = dir('/data/test-data/refs');
    resetStore([parent, refs], { selectedPath: '/data/test-data/refs' });
    render(<FileBrowserPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Files actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Unmount selected' }));

    await waitFor(() => {
      expect(useFileBrowserStore.getState().entries.map((e) => e.path)).toEqual([
        '/data/test-data',
      ]);
    });
  });

  it('Retry after a listing error lists the folder that failed, not currentPath ""', async () => {
    const root = dir('/data/refs');
    listDirectory.mockRejectedValueOnce(new Error("Directory '/data/refs' does not exist"));
    resetStore([root]);
    await useFileBrowserStore.getState().loadDirectory('/data/refs');
    expect(useFileBrowserStore.getState().errorPath).toBe('/data/refs');
    expect(useFileBrowserStore.getState().currentPath).toBe('');

    render(<FileBrowserPanel />);
    listDirectory.mockResolvedValueOnce([]);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(listDirectory).toHaveBeenLastCalledWith('/data/refs', 1);
      expect(useFileBrowserStore.getState().error).toBeNull();
    });
  });
});
