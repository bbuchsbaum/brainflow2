import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FileBrowserPanel } from '../FileBrowserPanel';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import { useLayerStore, type LayerInfo } from '@/stores/layerStore';
import { useInspectorSelectionStore } from '@/stores/inspectorSelectionStore';
import { setTransport } from '@/services/transport';
import {
  FILE_DRAG_MIME,
  LAYER_DRAG_MIME,
  getActiveDragData,
  parseFileDragData,
  parseLayerDragData,
} from '@/utils/layerDrag';
import type { FileTreeNode } from '@/types/filesystem';

interface CapturedTreeProps {
  data: ReadonlyArray<{
    id: string;
    name: string;
    type: 'file' | 'directory';
    children?: ReadonlyArray<unknown>;
  }>;
}

const capturedTreeRef: { current: CapturedTreeProps | null } = { current: null };

vi.mock('react-arborist', () => ({
  Tree: (props: CapturedTreeProps) => {
    capturedTreeRef.current = props;
    return <div data-testid="mock-tree" />;
  },
}));

vi.mock('../RemoteMountDialog', () => ({
  RemoteMountDialog: () => null,
}));

interface BackendTransportLike {
  invoke: (cmd: string, args?: unknown) => Promise<unknown>;
}

function makeMixedRoot(): FileTreeNode {
  return {
    id: '/data/study',
    name: 'study',
    path: '/data/study',
    type: 'directory',
    depth: 0,
    expanded: true,
    mountSource: { kind: 'local' },
    modified: new Date('2026-01-01'),
    children: [
      {
        id: '/data/study/sub-01',
        name: 'sub-01',
        path: '/data/study/sub-01',
        type: 'directory',
        depth: 1,
        modified: new Date('2026-02-01'),
        children: [],
      },
      {
        id: '/data/study/T1w.nii.gz',
        name: 'T1w.nii.gz',
        path: '/data/study/T1w.nii.gz',
        type: 'file',
        depth: 1,
        size: 100,
        extension: '.gz',
        modified: new Date('2026-04-01'),
      },
      {
        id: '/data/study/anatomy.nii',
        name: 'anatomy.nii',
        path: '/data/study/anatomy.nii',
        type: 'file',
        depth: 1,
        size: 5000,
        extension: '.nii',
        modified: new Date('2026-03-01'),
      },
    ],
  };
}

function resetStore(overrides: Partial<ReturnType<typeof useFileBrowserStore.getState>> = {}) {
  const root = makeMixedRoot();
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
    ...overrides,
  });
}

// jsdom has no PointerEvent: give pointer events their MouseEvent fields (button, clientX).
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.isPrimary = init.isPrimary ?? true;
    }
  }
  (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = PointerEventPolyfill;
}

/**
 * In-app drags are pointer-driven (Tauri's native file drop swallows HTML5
 * drag events): press a row, move past the threshold, release over a drop
 * target, which receives a synthetic `drop` carrying the MIME payload.
 */
function pointerDragTo(row: Element, target: Element): DataTransfer | null {
  let received: DataTransfer | null = null;
  const onDrop = (event: Event) => {
    received = (event as DragEvent).dataTransfer;
    event.preventDefault();
  };
  const onDragOver = (event: Event) => event.preventDefault();
  target.addEventListener('dragover', onDragOver);
  target.addEventListener('drop', onDrop);
  const originalElementFromPoint = document.elementFromPoint;
  document.elementFromPoint = () => target;
  try {
    fireEvent.pointerDown(row, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(document, { clientX: 40, clientY: 40, buttons: 1 });
    fireEvent.pointerUp(document, { clientX: 40, clientY: 40 });
  } finally {
    document.elementFromPoint = originalElementFromPoint;
    target.removeEventListener('drop', onDrop);
    target.removeEventListener('dragover', onDragOver);
  }
  return received;
}

describe('FileBrowserPanel sort + drag wiring', () => {
  beforeEach(() => {
    capturedTreeRef.current = null;
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
    useInspectorSelectionStore.setState({ activeItemId: null, activeItemKind: null });
  });

  it('keeps directories above files and sorts files by name asc', () => {
    resetStore();
    render(<FileBrowserPanel />);

    const tree = capturedTreeRef.current;
    expect(tree).not.toBeNull();
    const root = tree!.data[0] as { children: ReadonlyArray<{ name: string; type: string }> };
    const order = root.children.map((c) => c.name);
    expect(order).toEqual(['sub-01', 'anatomy.nii', 'T1w.nii.gz']);
  });

  it('reverses non-directory order when sortOrder=desc', () => {
    resetStore({ sortOrder: 'desc' });
    render(<FileBrowserPanel />);

    const tree = capturedTreeRef.current;
    expect(tree).not.toBeNull();
    const root = tree!.data[0] as { children: ReadonlyArray<{ name: string; type: string }> };
    const order = root.children.map((c) => c.name);
    // Directories still first, files reversed.
    expect(order).toEqual(['sub-01', 'T1w.nii.gz', 'anatomy.nii']);
  });

  it('sorts files by size when sortBy=size', () => {
    resetStore({ sortBy: 'size', sortOrder: 'asc' });
    render(<FileBrowserPanel />);

    const tree = capturedTreeRef.current!;
    const root = tree.data[0] as { children: ReadonlyArray<{ name: string }> };
    const order = root.children.map((c) => c.name);
    // dir first; then T1w.nii.gz (size 100) before anatomy.nii (5000)
    expect(order).toEqual(['sub-01', 'T1w.nii.gz', 'anatomy.nii']);
  });

  it('sorts files largest-first when sortBy=size desc, keeping folders A→Z', () => {
    const root = makeMixedRoot();
    root.children = [
      { id: '/data/study/unit', name: 'unit', path: '/data/study/unit', type: 'directory', depth: 1, children: [] },
      { id: '/data/study/anat', name: 'anat', path: '/data/study/anat', type: 'directory', depth: 1, children: [] },
      ...root.children!,
      {
        id: '/data/study/zz_small.nii',
        name: 'zz_small.nii',
        path: '/data/study/zz_small.nii',
        type: 'file',
        depth: 1,
        size: 10,
      },
      {
        id: '/data/study/unknown.nii',
        name: 'unknown.nii',
        path: '/data/study/unknown.nii',
        type: 'file',
        depth: 1,
      },
    ];
    resetStore({ entries: [root], sortBy: 'size', sortOrder: 'desc' });
    render(<FileBrowserPanel />);

    const tree = capturedTreeRef.current!;
    const order = (tree.data[0] as { children: ReadonlyArray<{ name: string }> }).children.map(
      (c) => c.name,
    );
    // Folders carry no size: they stay grouped first and A→Z; files run
    // largest to smallest, with a file of unknown size last.
    expect(order).toEqual([
      'anat',
      'sub-01',
      'unit',
      'anatomy.nii',
      'T1w.nii.gz',
      'zz_small.nii',
      'unknown.nii',
    ]);
  });

  it('emits FILE_DRAG_MIME from ImagesView rows', () => {
    resetStore();
    render(<FileBrowserPanel />);

    fireEvent.click(screen.getByRole('tab', { name: /Images/ }));

    const row = screen.getByTitle('/data/study/T1w.nii.gz');
    expect(row).not.toHaveAttribute('draggable');

    const target = document.createElement('div');
    document.body.appendChild(target);
    const transfer = pointerDragTo(row, target);
    target.remove();

    expect(transfer).not.toBeNull();
    expect(parseFileDragData(transfer!.getData(FILE_DRAG_MIME))?.path).toBe(
      '/data/study/T1w.nii.gz',
    );
    expect(transfer!.getData('application/json')).toBe(transfer!.getData(FILE_DRAG_MIME));
    expect(transfer!.getData('text/plain')).toBe('/data/study/T1w.nii.gz');
    expect(Array.from(transfer!.files)).toEqual([]);
    // The cross-panel bridge is cleared once the drag ends.
    expect(getActiveDragData()).toBeNull();
  });

  it('emits LAYER_DRAG_MIME from LoadedView rows and focuses the inspector', () => {
    const layer: LayerInfo = {
      id: 'layer-1',
      name: 'study-T1w',
      type: 'volume',
      visible: true,
      order: 0,
      volumeId: 'vol-1',
      source: 'file',
      sourcePath: '/data/study/T1w.nii.gz',
      volumeType: 'Volume3D',
    };
    useLayerStore.setState({ layers: [layer], selectedLayerId: null });

    resetStore();
    render(<FileBrowserPanel />);

    fireEvent.click(screen.getByRole('tab', { name: /Loaded/ }));

    // Loaded rows are bf SelectableRows (role="option" in a listbox), not buttons.
    const row = screen.getByRole('option', { name: /study-T1w/ });
    expect(row).not.toBeNull();

    const target = document.createElement('div');
    document.body.appendChild(target);
    const transfer = pointerDragTo(row!, target);
    target.remove();
    const parsed = parseLayerDragData(transfer?.getData(LAYER_DRAG_MIME));
    expect(parsed?.layerId).toBe('layer-1');

    fireEvent.click(row!);
    expect(useInspectorSelectionStore.getState().activeItemId).toBe('layer-1');
    // The first non-atlas volume becomes the base scene item.
    expect(useInspectorSelectionStore.getState().activeItemKind).toBe('volume-base');
    // Layer selection mirrors into layerStore.
    expect(useLayerStore.getState().selectedLayerId).toBe('layer-1');
  });
});

