import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBidsBrowserDataset } from '@/devHarness/app/bidsBrowserData';
import { getEventBus } from '@/events/EventBus';
import { selectBidsModel, useBidsStore } from '@/stores/bidsStore';
import { useLayoutSettingsStore } from '@/stores/layoutSettingsStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { BidsExplorerWorkspace } from '../BidsExplorerWorkspace';
import { BidsKeyHints } from '../BidsKeyHints';
import { BidsRunsDock } from '../BidsRunsDock';
import { BIDS_RUNS_TAB } from '../bidsDock';

const { openRunInViewer, openSelectedRun } = vi.hoisted(() => ({
  openRunInViewer: vi.fn(),
  openSelectedRun: vi.fn(),
}));
vi.mock('@/services/bids/openRunInViewer', () => ({ openRunInViewer, openSelectedRun }));

const dataset = createBidsBrowserDataset();

function load(partial = false) {
  const index = partial ? dataset.partial('s', 3) : dataset.index('s');
  useBidsStore.getState().reset();
  useBidsStore.setState({
    index,
    exclusions: index.exclusions,
    exclusionsLoaded: true,
    scanStatus: 'ready',
    datasetPath: index.dataset_path,
  });
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  openRunInViewer.mockClear();
  useWorkspaceStore.setState({ activeWorkspaceId: 'w' });
  useLayoutSettingsStore.setState({ bottomDockActiveTab: 'log' });
  load();
});

describe('BidsExplorerWorkspace', () => {
  it('lays out summary, view bar, coverage and key hints', () => {
    render(<BidsExplorerWorkspace workspaceId="w" />);
    expect(screen.getByTestId('bids-summary')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Coverage' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/No lens\. Click a claim or finding/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy summary' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy CuBIDS table' })).toBeInTheDocument();
    expect(screen.getByTestId('bids-coverage')).toBeInTheDocument();
    // The hints sit below the dock, outside the workspace (WorkspaceRouter.bids.test).
    expect(screen.queryByTestId('bids-key-hints')).toBeNull();
    render(<BidsKeyHints />);
    const hints = screen.getByTestId('bids-key-hints').textContent;
    expect(hints).toContain('open in viewer');
    expect(hints).toContain('compare with modal');
  });

  it('never blocks on a scan once rows exist, and shows the empty state before', () => {
    useBidsStore.getState().reset();
    const { rerender } = render(<BidsExplorerWorkspace workspaceId="w" />);
    expect(screen.queryByTestId('bids-ready')).toBeNull();
    act(() => useBidsStore.setState({ scanStatus: 'scanning' }));
    rerender(<BidsExplorerWorkspace workspaceId="w" />);
    expect(screen.getByText(/Scanning BIDS dataset/)).toBeInTheDocument();
    act(() => useBidsStore.setState({ index: dataset.partial('s', 3), scanProgress: dataset.progress('s')[2] }));
    expect(screen.getByTestId('bids-ready')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '8');
    expect(screen.getByRole('button', { name: 'Pause scan' })).toBeInTheDocument();
    expect(screen.getByTestId('bids-summary').textContent).toContain('so far');
  });

  it('keeps the error state, and reports a failure over rows without hiding them', () => {
    useBidsStore.getState().reset();
    act(() => useBidsStore.setState({ scanStatus: 'error', scanError: 'nope' }));
    render(<BidsExplorerWorkspace workspaceId="w" />);
    expect(screen.getByRole('alert')).toHaveTextContent('nope');
    act(() => useBidsStore.setState({ index: dataset.partial('s', 3) }));
    expect(screen.getByTestId('bids-coverage')).toBeInTheDocument();
    expect(screen.getByText(/Scan stopped: nope/)).toBeInTheDocument();
  });

  it('offers resume after a pause', () => {
    load(true);
    render(<BidsExplorerWorkspace workspaceId="w" />);
    expect(screen.getByRole('button', { name: 'Resume scan' })).toBeInTheDocument();
  });

  it('does not offer Images until it is built', () => {
    render(<BidsExplorerWorkspace workspaceId="w" />);
    expect(screen.getByRole('tab', { name: 'Coverage' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Images' })).toBeNull();
    expect(screen.getByTestId('bids-coverage')).toBeInTheDocument();
  });

  it('gives the lens its own row, so the view names keep theirs', () => {
    render(<BidsExplorerWorkspace workspaceId="w" />);
    const tab = screen.getByRole('tab', { name: 'Coverage' });
    expect(tab.parentElement?.closest('.shrink-0')).not.toBeNull();
    act(() => useBidsStore.getState().setLens({ id: 'l', label: 'Mine', predicate: { op: 'all' } }));
    const chip = screen.getByTestId('bids-lens-chip');
    expect(chip.parentElement?.contains(tab)).toBe(false);
  });

  it('shows the runs tab while in front and gives the dock back on leaving', () => {
    const view = render(<BidsExplorerWorkspace workspaceId="w" />);
    expect(useLayoutSettingsStore.getState().bottomDockActiveTab).toBe(BIDS_RUNS_TAB);
    act(() => useWorkspaceStore.setState({ activeWorkspaceId: 'other' }));
    expect(useLayoutSettingsStore.getState().bottomDockActiveTab).toBe('log');
    view.unmount();
  });

  it('a claim sets the lens, shows the chip, and clicking again clears it', () => {
    render(<BidsExplorerWorkspace workspaceId="w" />);
    const claim = screen.getByRole('button', { name: '5 have no second session' });
    fireEvent.click(claim);
    expect(claim).toHaveAttribute('aria-pressed', 'true');
    const chip = screen.getByTestId('bids-lens-chip');
    expect(chip.textContent).toContain('No second session · 5 participants');
    fireEvent.click(within(chip).getByRole('button', { name: 'only' }));
    expect(useBidsStore.getState().lensMode).toBe('only');
    expect(screen.getByText('runs present, of 5')).toBeInTheDocument();
    fireEvent.click(within(chip).getByRole('button', { name: 'save' }));
    const name = within(chip).getByLabelText('Lens name');
    fireEvent.change(name, { target: { value: 'Second-session upgrades' } });
    fireEvent.submit(name.closest('form')!);
    expect(useBidsStore.getState().savedLenses).toHaveLength(1);
    expect(useBidsStore.getState().savedLenses[0].label).toBe('Second-session upgrades');
    fireEvent.click(claim);
    expect(useBidsStore.getState().lens).toBeNull();
  });

  it('edits the FD threshold in the sentence', () => {
    render(<BidsExplorerWorkspace workspaceId="w" />);
    const before = selectBidsModel(useBidsStore.getState()).findings.total;
    const field = screen.getByTestId('bids-fd-threshold');
    fireEvent.change(field, { target: { value: '0.5' } });
    fireEvent.blur(field);
    expect(useBidsStore.getState().fdThreshold).toBe(0.5);
    expect(selectBidsModel(useBidsStore.getState()).findings.total).toBeLessThan(before);
  });

  it('restores the threshold field on invalid input', () => {
    render(<BidsExplorerWorkspace workspaceId="w" />);
    const field = screen.getByTestId('bids-fd-threshold') as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'abc' } });
    fireEvent.blur(field);
    expect(useBidsStore.getState().fdThreshold).toBe(0.25);
    expect(field.value).toBe('0.25');
  });

  it('copies the descriptor paragraph and the CuBIDS table', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const notified = vi.fn();
    const stop = getEventBus().on('ui.notification', notified);
    render(<BidsExplorerWorkspace workspaceId="w" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy summary' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(writeText.mock.calls[0][0]).toMatch(/^The dataset comprises 40 participants/);
    fireEvent.click(screen.getByRole('button', { name: 'Copy CuBIDS table' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(writeText.mock.calls[1][0]).toMatch(/^series\tgroup/);
    await waitFor(() => expect(notified).toHaveBeenCalledTimes(2));
    stop();
  });

  it('shows the undo strip for the last exclusion', () => {
    render(<BidsExplorerWorkspace workspaceId="w" />);
    expect(screen.queryByTestId('bids-undo-strip')).toBeNull();
    act(() =>
      useBidsStore.setState({
        undoStack: [
          {
            id: 1,
            added: [{ entity: 'sub-01', scope: '', reason: '', criterion: '', value: '', author: '', date: '', source: '' }],
            prior: [],
            context: { source_version: null, fd_definition: null, fd_source: null, fd_threshold_mm: null },
          },
        ],
      }),
    );
    expect(screen.getByTestId('bids-undo-strip').textContent).toContain('Excluded sub-01. 1 row written.');
  });
});

describe('BidsRunsDock', () => {
  const rows = () => within(screen.getByTestId('bids-runs-list')).getAllByRole('option');

  it('lists the runs in lens with denominators, highest FD first', () => {
    const model = selectBidsModel(useBidsStore.getState());
    act(() => {
      useBidsStore.getState().setLens(
        model.findings.groups.find((g) => g.id === 'variants')!.items[0].lens,
      );
    });
    render(<BidsRunsDock />);
    const lens = selectBidsModel(useBidsStore.getState()).lens;
    expect(screen.getByText('In lens')).toBeInTheDocument();
    expect(screen.getByTestId('bids-runs-count').textContent).toBe(
      `${lens.bold.length} of ${lens.ofBold} BOLD runs`,
    );
    expect(rows()[0].textContent).toContain('sub-33 ses-02');
    fireEvent.change(screen.getByLabelText('Task'), { target: { value: 'nback' } });
    const nback = lens.tasks.find((t) => t.task === 'nback')!;
    expect(screen.getByTestId('bids-runs-count').textContent).toBe(
      `${nback.runs} of ${lens.bold.length} ${lens.lens!.label} BOLD runs · task nback`,
    );
  });

  it('means BOLD by "run", with every image one choice away', () => {
    render(<BidsRunsDock />);
    const lens = selectBidsModel(useBidsStore.getState()).lens;
    expect(lens.ofRuns).toBeGreaterThan(lens.ofBold);
    expect(screen.getByTestId('bids-runs-count').textContent).toBe(`${lens.bold.length} of ${lens.ofBold} BOLD runs`);
    fireEvent.change(screen.getByLabelText('Images shown'), { target: { value: 'all' } });
    expect(screen.getByTestId('bids-runs-count').textContent).toBe(`${lens.runs.length} of ${lens.ofRuns} images`);
  });

  it('shows an echoed run once, and that row stands for whichever echo is selected', () => {
    const state = useBidsStore.getState();
    const base = state.index!.runs.find((run) => run.suffix === 'bold')!;
    const echoes = [1, 2, 3].map((echo) => ({
      ...base,
      id: `sub-01_task-me_run-7_echo-${echo}_bold`,
      task: 'me',
      run: '7',
      echo: String(echo),
    }));
    const before = selectBidsModel(state).lens.ofBold;
    act(() => useBidsStore.setState({ index: { ...state.index!, runs: [...state.index!.runs, ...echoes] } }));
    const ids = echoes.map((echo) => echo.id);
    act(() => useBidsStore.getState().setLens({ id: 'me', label: 'me', predicate: { op: 'runs', ids } }));
    render(<BidsRunsDock />);
    expect(selectBidsModel(useBidsStore.getState()).lens.ofBold).toBe(before + 1);
    expect(rows()).toHaveLength(1);
    for (const id of ids) {
      act(() => useBidsStore.getState().selectRun(id));
      expect(rows()[0].getAttribute('aria-selected')).toBe('true');
    }
  });

  it('sorts by a column and flips on a second click', () => {
    render(<BidsRunsDock />);
    const header = screen.getByRole('columnheader', { name: /tSNR/ });
    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-sort', 'descending');
    const top = rows()[0].textContent;
    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-sort', 'ascending');
    expect(rows()[0].textContent).not.toEqual(top);
  });

  it('renders a window of a long list', () => {
    const lensRuns = selectBidsModel(useBidsStore.getState()).lens.runs.length;
    render(<BidsRunsDock />);
    expect(lensRuns).toBeGreaterThan(100);
    expect(rows().length).toBeLessThan(40);
  });

  it('is keyboard navigable; Enter opens and Space asks for a quick look', () => {
    render(<BidsRunsDock />);
    const list = screen.getByTestId('bids-runs-list');
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    const first = useBidsStore.getState().selectedRunId;
    expect(first).not.toBeNull();
    fireEvent.keyDown(list, { key: 'j' });
    const second = useBidsStore.getState().selectedRunId;
    expect(second).not.toBe(first);
    expect(list).toHaveAttribute('aria-activedescendant', `bids-run-${second}`);
    fireEvent.keyDown(list, { key: 'k' });
    expect(useBidsStore.getState().selectedRunId).toBe(first);
    fireEvent.keyDown(list, { key: 'Enter' });
    expect(openRunInViewer).toHaveBeenCalledOnce();
    fireEvent.keyDown(list, { key: ' ' });
    expect(useBidsStore.getState().actionRequest?.kind).toBe('quick-look');
  });

  it('selects on click', () => {
    render(<BidsRunsDock />);
    fireEvent.click(rows()[1]);
    expect(useBidsStore.getState().selectedRunId).not.toBeNull();
  });

  it('says so when a finished scan found nothing, and offers a pause its resume', () => {
    const empty = { ...dataset.index('s'), runs: [], subjects: [], complete: false };
    act(() => useBidsStore.setState({ index: empty, scanStatus: 'ready' }));
    render(<BidsExplorerWorkspace workspaceId="w" />);
    expect(screen.getByText('Scan paused before any participant was read')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy();
  });

  it('offers the last dataset in a restored, empty tab', () => {
    localStorage.setItem('brainflow.bids.lastDataset', '/Volumes/x/ds000114');
    const scanDataset = vi.fn(async () => undefined);
    act(() => useBidsStore.setState({ index: null, scanStatus: 'idle', scanDataset }));
    render(<BidsExplorerWorkspace workspaceId="w" />);
    fireEvent.click(screen.getByRole('button', { name: 'Reopen ds000114' }));
    expect(scanDataset).toHaveBeenCalledWith('/Volumes/x/ds000114');
    localStorage.removeItem('brainflow.bids.lastDataset');
  });
});
