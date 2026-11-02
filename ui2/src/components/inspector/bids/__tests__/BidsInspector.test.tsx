import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBidsBrowserDataset } from '@/devHarness/app/bidsBrowserData';
import { setTransport } from '@/services/transport';
import { useBidsStore } from '@/stores/bidsStore';
import { BidsInspector } from '../BidsInspector';

const { openRunInViewer } = vi.hoisted(() => ({ openRunInViewer: vi.fn() }));
vi.mock('@/services/bids/openRunInViewer', () => ({ openRunInViewer }));

const dataset = createBidsBrowserDataset();
const RUN = 'sub-33_ses-02_task-nback_run-1_bold';
const OTHER = 'sub-34_ses-02_task-nback_run-1_bold';
const slice = {
  png_base64: 'AAAA',
  width: 10,
  height: 10,
  world_z_mm: 8,
  window_low: 0,
  window_high: 1,
  volumes_used: 8,
};

type Handler = (args: Record<string, unknown>) => unknown;

function installTransport(overrides: Record<string, Handler> = {}) {
  const invoke = vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => {
    if (overrides[cmd]) return overrides[cmd](args);
    switch (cmd) {
      case 'get_bids_run_detail':
        return dataset.detail(args.runId as string);
      case 'get_bids_events':
        return dataset.events(args.task as string);
      case 'get_bids_slice':
      case 'get_bids_carpet':
        return slice;
      case 'get_bids_median_slice':
        return { image: slice, runs_used: 15, runs_skipped: 0 };
      default:
        throw new Error(`unexpected ${cmd}`);
    }
  });
  setTransport({ invoke } as never);
  return invoke;
}

function load(selected: string | null = RUN) {
  const index = dataset.index('s');
  useBidsStore.getState().reset();
  useBidsStore.setState({
    index,
    exclusions: index.exclusions,
    exclusionsLoaded: true,
    datasetPath: index.dataset_path,
    scanStatus: 'ready',
    selectedRunId: selected,
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  openRunInViewer.mockClear();
  load();
});

afterEach(() => {
  vi.useRealTimers();
});

const settle = () => act(async () => {
  await vi.advanceTimersByTimeAsync(200);
});

describe('BidsInspector', () => {
  it('says so when nothing is selected', () => {
    installTransport();
    load(null);
    render(<BidsInspector />);
    expect(screen.getByText('No run selected')).toBeInTheDocument();
  });

  it('shows the sections in design order', async () => {
    installTransport();
    render(<BidsInspector />);
    await settle();
    const headings = screen.getAllByRole('heading').map((node) => node.textContent);
    expect(headings).toEqual([
      'Framewise displacement and carpet',
      'Effective metadata vs modal',
      'Field map',
      expect.stringContaining('Events'),
      'Derivatives',
      'Actions',
    ]);
    const head = screen.getByTestId('bids-run-head');
    expect(within(head).getByText('patient · F 45')).toBeInTheDocument();
    expect(within(head).getByText('variant A')).toBeInTheDocument();
    expect(within(head).getByAltText('Mean EPI, axial')).toBeInTheDocument();
    expect(within(head).getByAltText('T1w, axial')).toBeInTheDocument();
  });

  it('quotes the mean of the drawn trace with its source and caveats', async () => {
    installTransport();
    render(<BidsInspector />);
    await settle();
    const trace = dataset.detail(RUN).fd_trace.filter((value): value is number => value !== null);
    const mean = trace.reduce((sum, value) => sum + value, 0) / trace.length;
    const over = trace.filter((value) => value > 0.5).length;
    const caption = screen.getByTestId('bids-fd-caption').textContent;
    expect(caption).toContain('FD (Power) · fmriprep 24.1.1 confounds');
    expect(caption).toContain(`mean ${mean.toFixed(2)} mm`);
    expect(caption).toContain(`${over} of ${trace.length} frames above the 0.5 mm censoring line`);
    expect(caption).toContain('Unfiltered.');
    expect(caption).toContain('not directly comparable with the modal TR 0.8 s group');
  });

  it('marks changed metadata and names each source', async () => {
    installTransport();
    render(<BidsInspector />);
    await settle();
    const table = screen.getByRole('table', { name: /Effective metadata/ });
    const row = within(table).getByText('RepetitionTime').closest('[role="row"]')!;
    expect(row).toHaveAttribute('data-changed', 'true');
    expect(row.textContent).toContain('0.8');
    expect(within(table).getByText('pixdim[4] vs TR').closest('[role="row"]')!.textContent).toContain('match');
  });

  it('drops a detail that arrives after the selection moved', async () => {
    let finishFirst: (value: unknown) => void = () => undefined;
    const first = new Promise((resolve) => {
      finishFirst = resolve;
    });
    installTransport({
      get_bids_run_detail: (args) =>
        args.runId === RUN ? first : dataset.detail(args.runId as string),
    });
    render(<BidsInspector />);
    await settle();
    act(() => useBidsStore.getState().selectRun(OTHER));
    await settle();
    const shown = screen.getByTestId('bids-inspector');
    expect(shown).toHaveAttribute('data-run', OTHER);
    const caption = screen.getByTestId('bids-fd-caption').textContent;
    await act(async () => {
      finishFirst({ ...dataset.detail(RUN), fd_source: 'stale source' });
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(screen.getByTestId('bids-fd-caption').textContent).toBe(caption);
    expect(screen.queryByText(/stale source/)).toBeNull();
  });

  it('drops events that arrive after the dataset changed', async () => {
    let finish: (value: unknown) => void = () => undefined;
    installTransport({ get_bids_events: () => new Promise((resolve) => (finish = resolve)) });
    render(<BidsInspector />);
    await settle();
    act(() => useBidsStore.getState().reset());
    await act(async () => {
      finish(dataset.events('nback'));
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(screen.getByText('No run selected')).toBeInTheDocument();
  });

  it('reports a slice failure and a dangling image without inventing anything', async () => {
    installTransport({
      get_bids_slice: () => {
        throw new Error('decode failed');
      },
    });
    render(<BidsInspector />);
    await settle();
    expect(screen.getAllByText(/Image could not be read: decode failed/)).not.toHaveLength(0);

    const invoke = installTransport();
    const index = dataset.index('t');
    const runs = index.runs.map((run) =>
      run.id === RUN ? { ...run, header: null, size_bytes: 0 } : run,
    );
    act(() => useBidsStore.setState({ index: { ...index, runs } }));
    await settle();
    expect(screen.getByText('Image not available here: annexed and not fetched.')).toBeInTheDocument();
    expect(screen.getByText(/^Carpet not available here/)).toBeInTheDocument();
    const paths = invoke.mock.calls
      .filter(([cmd]) => cmd === 'get_bids_slice')
      .map(([, args]) => (args as { request: { path: string } }).request.path);
    expect(paths.some((path) => path.endsWith(`${RUN}.nii.gz`))).toBe(false);
  });

  it('says when a run has no confounds, no field map or no events', async () => {
    installTransport({
      get_bids_run_detail: (args) => ({
        ...dataset.detail(args.runId as string),
        fd_trace: [],
        fd_source: null,
        fd_definition: null,
      }),
    });
    const index = dataset.index('t');
    const runs = index.runs.map((run) =>
      run.id === RUN ? { ...run, has_events: false, fmap: null, iqms: null, fd: null } : run,
    );
    act(() => useBidsStore.setState({ index: { ...index, runs } }));
    render(<BidsInspector />);
    await settle();
    expect(screen.getByText(/No confounds file for this run/)).toBeInTheDocument();
    expect(screen.getByText('No field map for this run.')).toBeInTheDocument();
    expect(screen.getByText('No events file for this run.')).toBeInTheDocument();
  });

  it('compares with the dataset median of the modal group at the same slice', async () => {
    const invoke = installTransport();
    render(<BidsInspector />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Compare with modal (C)' }));
    expect(useBidsStore.getState().actionRequest?.kind).toBe('compare');
    act(() => useBidsStore.setState({ compareWithModal: true }));
    await settle();
    await settle();
    expect(screen.getByAltText('Dataset median')).toBeInTheDocument();
    const call = invoke.mock.calls.find(([cmd]) => cmd === 'get_bids_median_slice')!;
    const args = call[1] as { paths: string[]; request: { world_z_mm: number } };
    expect(args.request.world_z_mm).toBe(8);
    const model = useBidsStore.getState().index!;
    const variantPaths = model.runs.filter((run) => run.variant_id).map((run) => run.path);
    expect(args.paths.some((path) => variantPaths.includes(path))).toBe(false);
    expect(screen.getByTestId('bids-compare').textContent).toContain('the same rule, not the same numbers');
  });

  it('opens the run and asks for exclusion', async () => {
    installTransport();
    render(<BidsInspector />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: /Open in viewer/ }));
    await waitFor(() => expect(openRunInViewer).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Exclude (X)' }));
    expect(useBidsStore.getState().actionRequest?.kind).toBe('exclude');
  });
});
