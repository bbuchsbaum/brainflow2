import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FileBrowserPanel } from '../FileBrowserPanel';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import { useBidsStore } from '@/stores/bidsStore';
import type { BidsBrowserIndex, BidsRunRecord } from '@brainflow/api';
import { useLayerStore } from '@/stores/layerStore';
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
    id: '/data/bids',
    name: 'bids',
    path: '/data/bids',
    type: 'directory',
    depth: 0,
    expanded: true,
    mountSource: { kind: 'local' },
    modified: new Date(),
    children: [],
  };
}

function makeIndex(): BidsBrowserIndex {
  const run = (subject: string, task: string | null) =>
    ({ id: `sub-${subject}_task-${task}`, subject, task, session: null, suffix: 'bold', series: `task-${task}_bold`, sidecar: [] }) as unknown as BidsRunRecord;
  return {
    dataset_path: '/data/bids',
    complete: true,
    is_remote: false,
    listing_complete: true,
    session_order: [],
    new_subjects: [],
    derivatives: [],
    derivative_status: [],
    findings: [],
    variants: [],
    participants: [],
    participant_columns: [],
    exclusions: [],
    subjects: ['01', '02'],
    // sub-01 has both rest and nback; sub-02 only has rest.
    runs: [run('01', null), run('01', 'rest'), run('01', 'nback'), run('02', null), run('02', 'rest')],
  } as BidsBrowserIndex;
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

describe('FileBrowserPanel BidsView subject/task tree', () => {
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
      invoke: vi.fn().mockImplementation((cmd: string) => {
        if (cmd === 'check_bids_directory') return Promise.resolve(true);
        return Promise.resolve(null);
      }),
    } as BackendTransportLike);
    useLayerStore.setState({ layers: [], selectedLayerId: null });
    useBidsStore.setState({
      datasetPath: null,
      index: null,
      scanStatus: 'idle',
      scanError: null,
      eventsCache: new Map(),
      selection: { subjectId: null, sessionId: null, modality: null },
      hoveredCell: null,
      activeDetailTab: 'validation',
    });
  });

  it('renders Scan CTA when BIDS detected but no index loaded', async () => {
    resetStore();
    render(<FileBrowserPanel />);

    fireEvent.click(screen.getByRole('tab', { name: /BIDS/ }));

    expect(await screen.findByText(/BIDS dataset detected\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Scan Dataset/ })).toBeInTheDocument();
  });

  it('renders subject/task tree once the index loads', async () => {
    resetStore();
    useBidsStore.setState({
      datasetPath: '/data/bids',
      index: makeIndex(),
      scanStatus: 'ready',
    });

    render(<FileBrowserPanel />);

    fireEvent.click(screen.getByRole('tab', { name: /BIDS/ }));

    expect(await screen.findByText('sub-01')).toBeInTheDocument();
    expect(screen.getByText('sub-02')).toBeInTheDocument();
    // sub-01 row meta says "2 tasks", sub-02 row meta says "1 task".
    expect(screen.getByText('2 tasks')).toBeInTheDocument();
    expect(screen.getByText('1 task')).toBeInTheDocument();

    // Expand sub-01 and verify task rows appear.
    fireEvent.click(screen.getByText('sub-01'));
    expect(screen.getByText('task-rest')).toBeInTheDocument();
    expect(screen.getByText('task-nback')).toBeInTheDocument();
  });

  it('reveals the selected run: expands to it and scrolls, without moving focus', async () => {
    resetStore();
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const record = (id: string, task: string | null, run: string | null, datatype: string) =>
      ({
        id,
        subject: '01',
        session: '02',
        task,
        run,
        datatype,
        size_bytes: 318 * 2 ** 20,
        suffix: datatype === 'anat' ? 'T1w' : 'bold',
        series: task ? `task-${task}_bold` : 'T1w',
        sidecar: [],
      }) as unknown as BidsRunRecord;
    const longId = 'sub-01_ses-02_task-nback_acq-multibandhighres_run-2_bold';
    useBidsStore.setState({
      datasetPath: '/data/bids',
      index: {
        ...makeIndex(),
        subjects: ['01'],
        runs: [record('sub-01_ses-02_T1w', null, null, 'anat'), record(longId, 'nback', '2', 'func')],
      },
      scanStatus: 'ready',
      selectedRunId: null,
    });
    render(<FileBrowserPanel />);
    fireEvent.click(screen.getByRole('tab', { name: /BIDS/ }));
    await screen.findByText('sub-01');
    expect(screen.getByText(/follows selection/)).toBeInTheDocument();
    expect(screen.queryByText('ses-02')).toBeNull();

    const before = document.activeElement;
    act(() => useBidsStore.getState().selectRun(longId));
    const row = await screen.findByRole('treeitem', { selected: true });
    expect(screen.getByText('ses-02')).toBeInTheDocument();
    expect(screen.getByText('task-nback')).toBeInTheDocument();
    expect(row).toHaveAttribute('data-run-id', longId);
    // Middle-truncated with the run entity whole.
    expect(row.textContent).toContain('run-2_bold');
    expect(row.textContent).toContain('…');
    expect(row.textContent).toContain('318 MB');
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' }));
    expect(document.activeElement).toBe(before);

    // Moving on closes what only the reveal opened.
    act(() => useBidsStore.getState().selectRun(null));
    await waitFor(() => expect(screen.queryByText('ses-02')).toBeNull());
  });

  it('counts subjects with no images here instead of listing them as empty', async () => {
    resetStore();
    useBidsStore.setState({
      datasetPath: '/data/bids',
      index: { ...makeIndex(), subjects: ['01', '02', '03', '04'] },
      scanStatus: 'ready',
    });
    render(<FileBrowserPanel />);
    fireEvent.click(screen.getByRole('tab', { name: /BIDS/ }));
    await screen.findByText('sub-01');
    expect(screen.getByText(/2 participants · 2 with no images here/)).toBeInTheDocument();
    expect(screen.queryByText('sub-03')).toBeNull();
  });

  it('claims no absence while the scan is partial, as the model does not', async () => {
    resetStore();
    useBidsStore.setState({
      datasetPath: '/data/bids',
      index: { ...makeIndex(), subjects: ['01', '02', '03', '04'], complete: false },
      scanStatus: 'scanning',
    });
    render(<FileBrowserPanel />);
    fireEvent.click(screen.getByRole('tab', { name: /BIDS/ }));
    await screen.findByText('sub-01');
    expect(screen.queryByText(/with no images here/)).toBeNull();
  });

  it('selecting a run row selects the run in the store', async () => {
    resetStore();
    useBidsStore.setState({
      datasetPath: '/data/bids',
      index: makeIndex(),
      scanStatus: 'ready',
      selectedRunId: null,
    });
    render(<FileBrowserPanel />);
    fireEvent.click(screen.getByRole('tab', { name: /BIDS/ }));
    fireEvent.click(await screen.findByText('sub-01'));
    fireEvent.click(screen.getByText('task-rest'));
    fireEvent.click(screen.getByText(/task-rest$/, { selector: '[data-run-id] *' }));
    expect(useBidsStore.getState().selectedRunId).toBe('sub-01_task-rest');
  });

  it('keeps no tree for a dataset other than the mounted root', async () => {
    resetStore();
    useBidsStore.setState({ datasetPath: '/other', index: makeIndex(), scanStatus: 'ready' });
    render(<FileBrowserPanel />);
    fireEvent.click(screen.getByRole('tab', { name: /BIDS/ }));
    await screen.findByText(/BIDS dataset detected\./);
    expect(screen.queryByText('sub-01')).toBeNull();
  });
});
