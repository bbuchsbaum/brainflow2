import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatasetMarker } from '@brainflow/api';
import { FileBrowserPanel } from '../FileBrowserPanel';
import { resetDatasetCardServiceForTests } from '@/services/DatasetCardService';
import { setTransport } from '@/services/transport';
import { getEventBus } from '@/events/EventBus';
import { markerKey, useDatasetCardStore } from '@/stores/datasetCardStore';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import type { FileTreeNode } from '@/types/filesystem';

/** Space on a browser row opens the pinned card; elsewhere it keeps its meaning. */

const ROOT = '/data/pcmri';
const GLM = `${ROOT}/glm_recog`;
const PLAIN = `${ROOT}/rsa_item`;
const IMAGE = `${ROOT}/sub-01_T1w.nii.gz`;
const TABLE = `${ROOT}/participants.tsv`;

interface FocusedNode {
  level: number;
  data: { path: string; type: 'file' | 'directory' };
  parent: unknown;
}
const tree = vi.hoisted(() => ({
  focused: null as FocusedNode | null,
  keyDown: null as ReturnType<typeof import('vitest').vi.fn> | null,
}));

// The real tree needs layout; this stand-in keeps what the panel reads from
// it: the node with keyboard focus, and a key handler that Space must not reach.
vi.mock('react-arborist', async () => {
  const ReactMod = await import('react');
  const Tree = ReactMod.forwardRef((_props: unknown, ref) => {
    ReactMod.useImperativeHandle(ref, () => ({
      get focusedNode() {
        return tree.focused;
      },
      isFiltered: false,
      isOpen: () => false,
    }));
    return (
      <div role="tree" tabIndex={0} onKeyDown={(event) => tree.keyDown?.(event.key)}>
        <div role="treeitem" tabIndex={-1} data-testid="row" />
      </div>
    );
  });
  return { Tree };
});
vi.mock('../RemoteMountDialog', () => ({ RemoteMountDialog: () => null }));

const node = (path: string, type: 'file' | 'directory'): FileTreeNode => ({
  id: path,
  name: path.split('/').pop() ?? path,
  path,
  type,
  depth: 1,
});

function marker(path: string): DatasetMarker {
  return {
    path,
    hasDescription: true,
    analysisCount: null,
    analysisCountTruncated: false,
    summary: null,
    issue: null,
  };
}

const invoke = vi.fn(async (cmd: string) => {
  if (cmd === 'get_dataset_card' || cmd === 'get_sidecar_card') return new Promise(() => {});
  if (cmd === 'probe_dataset_markers') return [];
  return undefined;
});
const cardCalls = () =>
  invoke.mock.calls.filter(([cmd]) => cmd === 'get_dataset_card' || cmd === 'get_sidecar_card');

function focus(path: string, type: 'file' | 'directory') {
  tree.focused = { level: 1, data: { path, type }, parent: { level: 0, data: { path: ROOT } } };
}

function mount(selectedPath: string | null = null) {
  const root: FileTreeNode = {
    ...node(ROOT, 'directory'),
    depth: 0,
    mountSource: { kind: 'local' },
    children: [
      node(GLM, 'directory'),
      node(PLAIN, 'directory'),
      node(IMAGE, 'file'),
      node(TABLE, 'file'),
    ],
  };
  useFileBrowserStore.setState({
    currentPath: ROOT,
    rootPath: ROOT,
    entries: [root],
    expandedPaths: new Set([ROOT]),
    loadingPaths: new Set(),
    selectedPath,
    loading: false,
    error: null,
    searchQuery: '',
    searchResults: [],
    sortBy: 'name',
    sortOrder: 'asc',
    viewMode: 'tree',
  });
  useDatasetCardStore.setState({
    markers: { [markerKey(ROOT, GLM)]: { marker: marker(GLM), fetchedAtMs: Date.now() } },
  });
  return render(<FileBrowserPanel />);
}

async function pressSpace(element: Element) {
  let notPrevented = true;
  await act(async () => {
    notPrevented = fireEvent.keyDown(element, { key: ' ', code: 'Space' });
  });
  return { prevented: !notPrevented };
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  resetDatasetCardServiceForTests();
  invoke.mockClear();
  setTransport({ invoke } as never);
  tree.focused = null;
  tree.keyDown = vi.fn();
});

describe('Space in the file tree', () => {
  it('opens the dataset card of the focused folder, before the tree can toggle it', async () => {
    mount();
    focus(GLM, 'directory');
    const { prevented } = await pressSpace(screen.getByTestId('row'));
    expect(prevented).toBe(true);
    expect(tree.keyDown).not.toHaveBeenCalled();
    expect(useDatasetCardStore.getState().card).toMatchObject({
      kind: 'dataset',
      rootPath: ROOT,
      path: GLM,
    });
    expect(invoke).toHaveBeenCalledWith(
      'get_dataset_card',
      expect.objectContaining({ path: GLM, rootPath: ROOT }),
    );
    expect(await screen.findByTestId('dataset-card')).toBeInTheDocument();
  });

  it('pressed again on the same row, closes the card', async () => {
    mount();
    focus(GLM, 'directory');
    await pressSpace(screen.getByTestId('row'));
    // Opening the card moves focus into it: the second Space is pressed there.
    const card = await screen.findByTestId('dataset-card');
    await waitFor(() => expect(card).toHaveFocus());
    const { prevented } = await pressSpace(document.activeElement as Element);
    expect(prevented).toBe(true);
    expect(useDatasetCardStore.getState().card).toBeNull();
  });

  it('pressed again on the row itself (focus brought back by the pointer), closes the card', async () => {
    mount();
    focus(GLM, 'directory');
    await pressSpace(screen.getByTestId('row'));
    await screen.findByTestId('dataset-card');
    await pressSpace(screen.getByTestId('row'));
    expect(useDatasetCardStore.getState().card).toBeNull();
  });

  it('opens the sidecar card of a focused image file', async () => {
    mount();
    focus(IMAGE, 'file');
    await pressSpace(screen.getByTestId('row'));
    expect(tree.keyDown).not.toHaveBeenCalled();
    expect(useDatasetCardStore.getState().card).toMatchObject({
      kind: 'sidecar',
      rootPath: ROOT,
      path: IMAGE,
    });
  });

  it('leaves Space to the tree on a folder without a description', async () => {
    mount();
    focus(PLAIN, 'directory');
    await pressSpace(screen.getByTestId('row'));
    expect(tree.keyDown).toHaveBeenCalledWith(' ');
    expect(useDatasetCardStore.getState().card).toBeNull();
    expect(cardCalls()).toHaveLength(0);
  });

  it('leaves Space to the tree on a file that is not an image', async () => {
    mount();
    focus(TABLE, 'file');
    await pressSpace(screen.getByTestId('row'));
    expect(tree.keyDown).toHaveBeenCalledWith(' ');
    expect(useDatasetCardStore.getState().card).toBeNull();
  });

  it('leaves every other key to the tree', async () => {
    mount();
    focus(GLM, 'directory');
    for (const key of ['ArrowDown', 'Enter', 'a']) {
      fireEvent.keyDown(screen.getByTestId('row'), { key });
    }
    expect(tree.keyDown?.mock.calls.map(([key]) => key)).toEqual(['ArrowDown', 'Enter', 'a']);
    expect(useDatasetCardStore.getState().card).toBeNull();
  });
});

describe('Space on the panel, outside the tree', () => {
  it('opens the card of the selected marked folder', async () => {
    const { container } = mount(GLM);
    const panel = container.querySelector('.file-browser-panel') as HTMLElement;
    const { prevented } = await pressSpace(panel);
    expect(prevented).toBe(true);
    expect(useDatasetCardStore.getState().card).toMatchObject({ kind: 'dataset', path: GLM });
  });

  it('opens the sidecar card of the selected image', async () => {
    const { container } = mount(IMAGE);
    await pressSpace(container.querySelector('.file-browser-panel') as HTMLElement);
    expect(useDatasetCardStore.getState().card).toMatchObject({ kind: 'sidecar', path: IMAGE });
  });

  it('does nothing for a selected folder without a description', async () => {
    const { container } = mount(PLAIN);
    const { prevented } = await pressSpace(
      container.querySelector('.file-browser-panel') as HTMLElement,
    );
    expect(prevented).toBe(false);
    expect(useDatasetCardStore.getState().card).toBeNull();
  });

  it('does not take Space typed into the search field', async () => {
    const { container } = mount(GLM);
    const search = container.querySelector('input') as HTMLInputElement;
    const { prevented } = await pressSpace(search);
    expect(prevented).toBe(false);
    expect(useDatasetCardStore.getState().card).toBeNull();
  });
});

describe('keys pressed inside the pinned card', () => {
  it('are not taken as the panel’s file shortcuts', async () => {
    const opened = vi.fn();
    getEventBus().on('filebrowser.file.open', opened);
    const { container } = mount(IMAGE);
    await pressSpace(container.querySelector('.file-browser-panel') as HTMLElement);
    const card = await screen.findByTestId('dataset-card');
    const close = within(card).getByRole('button', { name: 'Close' });
    // The card is portaled, but React still bubbles its events to the panel.
    fireEvent.keyDown(close, { key: 'Enter' });
    // Space on a control of the card is that control's own.
    const { prevented } = await pressSpace(close);
    expect(opened).not.toHaveBeenCalled();
    expect(prevented).toBe(false);
    expect(useDatasetCardStore.getState().card).toMatchObject({ kind: 'sidecar', path: IMAGE });
  });

  it('Space on the card itself closes it, and is still not a file shortcut', async () => {
    const selected = vi.spyOn(useFileBrowserStore.getState(), 'selectFile');
    const { container } = mount(IMAGE);
    await pressSpace(container.querySelector('.file-browser-panel') as HTMLElement);
    const card = await screen.findByTestId('dataset-card');
    selected.mockClear();
    const { prevented } = await pressSpace(card);
    expect(prevented).toBe(true);
    expect(useDatasetCardStore.getState().card).toBeNull();
    expect(selected).not.toHaveBeenCalled();
    selected.mockRestore();
  });
});

describe('footer hint', () => {
  const HINT = 'Space shows the description of the selected folder';

  it('shows only while the selected folder has a description', () => {
    mount(GLM);
    expect(screen.getByText(HINT)).toBeInTheDocument();
  });

  it('is absent for an unmarked folder and for a file', () => {
    const first = mount(PLAIN);
    expect(screen.queryByText(HINT)).toBeNull();
    first.unmount();
    mount(IMAGE);
    expect(screen.queryByText(HINT)).toBeNull();
  });
});
