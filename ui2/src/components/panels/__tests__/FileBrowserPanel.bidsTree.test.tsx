import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FileBrowserPanel } from '../FileBrowserPanel';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import { useBidsStore, type BidsDatasetSummary } from '@/stores/bidsStore';
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

function makeSummary(): BidsDatasetSummary {
  return {
    path: '/data/bids',
    name: 'demo',
    bids_version: '1.8.0',
    license: null,
    authors: [],
    subject_count: 2,
    session_ids: [],
    task_ids: ['rest', 'nback'],
    modalities: ['anat', 'func'],
    total_file_count: 0,
    total_size_bytes: 0,
    coverage: {
      subjects: ['sub-01', 'sub-02'],
      columns: [
        { session: null, modality: 'anat', suffix: 'T1w', task: null, label: 'anat T1w' },
        { session: null, modality: 'func', suffix: 'bold', task: 'rest', label: 'func rest' },
        { session: null, modality: 'func', suffix: 'bold', task: 'nback', label: 'func nback' },
      ],
      cells: [
        // sub-01 has both rest and nback
        [
          { present: true, run_count: 1, size_bytes: 0, file_paths: [] },
          { present: true, run_count: 1, size_bytes: 0, file_paths: [] },
          { present: true, run_count: 1, size_bytes: 0, file_paths: [] },
        ],
        // sub-02 only has rest
        [
          { present: true, run_count: 1, size_bytes: 0, file_paths: [] },
          { present: true, run_count: 1, size_bytes: 0, file_paths: [] },
          { present: false, run_count: 0, size_bytes: 0, file_paths: [] },
        ],
      ],
    },
    participants: [],
    participant_columns: [],
    task_designs: [],
    validation: { passed: true, critical_count: 0, warning_count: 0, issues: [] },
    storage_by_modality: {},
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
      summary: null,
      scanStatus: 'idle',
      scanError: null,
      eventsCache: new Map(),
      selection: { subjectId: null, sessionId: null, modality: null },
      hoveredCell: null,
      activeDetailTab: 'validation',
    });
  });

  it('renders Scan CTA when BIDS detected but summary not loaded', async () => {
    resetStore();
    render(<FileBrowserPanel />);

    fireEvent.click(screen.getByRole('tab', { name: /BIDS/ }));

    expect(await screen.findByText(/BIDS dataset detected\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Scan Dataset/ })).toBeInTheDocument();
  });

  it('renders subject/task tree once summary loads', async () => {
    resetStore();
    useBidsStore.setState({
      datasetPath: '/data/bids',
      summary: makeSummary(),
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
});
