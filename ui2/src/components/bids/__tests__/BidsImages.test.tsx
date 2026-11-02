import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBidsBrowserDataset } from '@/devHarness/app/bidsBrowserData';
import { setTransport } from '@/services/transport';
import { useBidsStore } from '@/stores/bidsStore';
import { BidsImages } from '../BidsImages';

const { openRunInViewer } = vi.hoisted(() => ({ openRunInViewer: vi.fn() }));
vi.mock('@/services/bids/openRunInViewer', () => ({ openRunInViewer }));

const image = { png_base64: 'AAAA', width: 4, height: 4, world_z_mm: 12, window_low: 10, window_high: 110, volumes_used: 3 };
const dataset = createBidsBrowserDataset();
function load() {
  const index = dataset.index('s');
  const bold = index.runs.filter((run) => run.suffix === 'bold' && run.series === 'task-nback_bold' && run.run === '1').slice(0, 3);
  const t1 = index.runs.filter((run) => run.suffix === 'T1w').slice(0, 2);
  const dwi = index.runs.filter((run) => run.suffix === 'dwi').slice(0, 2);
  index.runs = [...bold, ...t1, ...dwi];
  index.variants = [];
  index.findings = [];
  index.exclusions = [];
  useBidsStore.getState().reset();
  useBidsStore.setState({ index, datasetPath: index.dataset_path, scanStatus: 'ready', activeView: 'images', exclusions: [], selectedRunId: bold[0].id });
  return { index, bold, t1, dwi };
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', undefined);
  openRunInViewer.mockClear();
});

describe('BidsImages', () => {
  it('uses one slice and fixed window for every visible tile and selects a run', async () => {
    const { bold } = load();
    const invoke = vi.fn<(command: string, args: unknown) => Promise<typeof image>>().mockResolvedValue(image);
    setTransport({ invoke } as never);
    render(<BidsImages />);
    await waitFor(() => expect(screen.getAllByTestId('bids-image-tile')).toHaveLength(3));
    await waitFor(() => expect(invoke.mock.calls.length).toBeGreaterThanOrEqual(4));
    const requests = invoke.mock.calls.map(([, args]) => (args as { request: { window?: number[]; world_z_mm: number } }).request);
    expect(requests[0].window).toBeUndefined();
    expect(requests.slice(1).every((request) => JSON.stringify(request.window) === '[10,110]' && request.world_z_mm === 12)).toBe(true);
    expect(screen.getByText(/shared window 10.0–110/)).toHaveTextContent(
      'no registration implied. Mean of up to 8 volumes.',
    );
    const initial = screen.getAllByTestId('bids-image-tile');
    expect(initial.find((node) => node.getAttribute('data-run') === bold[0].id)).toHaveClass('bg-bf-bg-selected');
    expect(initial.find((node) => node.getAttribute('data-run') === bold[0].id)).toHaveTextContent(`${bold[0].subject} · ${bold[0].session}`);
    expect(initial.find((node) => node.getAttribute('data-run') === bold[1].id)).not.toHaveClass('bg-bf-bg-selected');
    const tile = screen.getAllByTestId('bids-image-tile').find((node) => node.getAttribute('data-run') === bold[1].id)!;
    fireEvent.click(tile);
    expect(useBidsStore.getState().selectedRunId).toBe(bold[1].id);
    fireEvent.keyDown(tile, { key: 'Enter' });
    expect(openRunInViewer).toHaveBeenCalledWith(bold[1]);
  });

  it('requests b0 with its dataset root and lets the user change the common slice', async () => {
    const { index, dwi } = load();
    expect(dwi.length).toBeGreaterThan(0);
    const invoke = vi.fn(async (_command: string, args: { request: { world_z_mm: number | null } }) => ({ ...image, world_z_mm: args.request.world_z_mm ?? 12 }));
    setTransport({ invoke } as never);
    render(<BidsImages />);
    await waitFor(() => expect(screen.getAllByTestId('bids-image-tile')).toHaveLength(3));
    fireEvent.click(screen.getByRole('radio', { name: 'b0' }));
    await waitFor(() => expect(invoke.mock.calls.some(([, args]) => (args as { request: { kind: string } }).request.kind === 'b0')).toBe(true));
    await waitFor(() => expect(screen.getByText(/shared window 10.0–110/)).toHaveTextContent(
      'no registration implied. Mean of volumes with b=0.',
    ));
    const b0 = invoke.mock.calls.find(([, args]) => (args as { request: { kind: string } }).request.kind === 'b0')![1] as { request: { dataset_root: string } };
    expect(b0.request.dataset_root).toBe(index.dataset_path);
    const z = await screen.findByLabelText('Slice z in millimeters');
    fireEvent.change(z, { target: { value: '24' } });
    fireEvent.blur(z);
    await waitFor(() => expect(invoke.mock.calls.some(([, args]) => (args as { request: { kind: string; world_z_mm: number } }).request.kind === 'b0' && (args as { request: { world_z_mm: number } }).request.world_z_mm === 24)).toBe(true));
  });

  it('follows a run selected in another panel into its image type', async () => {
    const { t1 } = load();
    setTransport({ invoke: vi.fn().mockResolvedValue(image) } as never);
    render(<BidsImages />);
    await waitFor(() => expect(screen.getAllByTestId('bids-image-tile')).toHaveLength(3));
    act(() => useBidsStore.getState().selectRun(t1[1].id));
    await waitFor(() => expect(screen.getByRole('radio', { name: 'T1w' })).toBeChecked());
    await waitFor(() => expect(screen.getAllByTestId('bids-image-tile').some((tile) => tile.getAttribute('data-run') === t1[1].id && tile.getAttribute('aria-pressed') === 'true')).toBe(true));
    expect(useBidsStore.getState().selectedRunId).toBe(t1[1].id);
  });

  it('highlights only lens members and filters them in only mode', async () => {
    const { bold } = load();
    setTransport({ invoke: vi.fn().mockResolvedValue(image) } as never);
    render(<BidsImages />);
    await waitFor(() => expect(screen.getAllByTestId('bids-image-tile')).toHaveLength(3));
    act(() => useBidsStore.getState().setLens({ id: 'two', label: 'Two runs', predicate: { op: 'runs', ids: [bold[0].id, bold[2].id] } }));
    const tile = (id: string) => screen.getAllByTestId('bids-image-tile').find((node) => node.getAttribute('data-run') === id)!;
    expect(tile(bold[2].id)).toHaveClass('bg-bf-bg-selected');
    expect(tile(bold[1].id)).not.toHaveClass('bg-bf-bg-selected');
    act(() => useBidsStore.getState().setLensMode('only'));
    await waitFor(() => expect(screen.getAllByTestId('bids-image-tile')).toHaveLength(2));
    expect(screen.getAllByTestId('bids-image-tile').map((node) => node.getAttribute('data-run'))).not.toContain(bold[1].id);
  });

  it('sorts by the requested quality measure and keeps missing values last', async () => {
    const { index, bold } = load();
    const values = [30, null, 70];
    const updated = index.runs.map((run) => {
      const position = bold.findIndex((item) => item.id === run.id);
      return position < 0 ? run : { ...run, fd: null, iqms: { tsnr: values[position], fd_mean: [0.1, null, 0.4][position], gsr_y: null, source: 'test' } };
    });
    useBidsStore.setState({ index: { ...index, runs: updated } });
    setTransport({ invoke: vi.fn().mockResolvedValue(image) } as never);
    render(<BidsImages />);
    await waitFor(() => expect(screen.getAllByTestId('bids-image-tile')).toHaveLength(3));
    await waitFor(() => expect(screen.getAllByTestId('bids-image-tile').every((tile) => tile.querySelector('img'))).toBe(true));
    const order = () => screen.getAllByTestId('bids-image-tile').map((tile) => tile.getAttribute('data-run'));
    fireEvent.click(screen.getByRole('radio', { name: 'tSNR', exact: true }));
    expect(order()).toEqual([bold[0].id, bold[2].id, bold[1].id]);
    fireEvent.click(screen.getByRole('radio', { name: 'FD', exact: true }));
    expect(order()).toEqual([bold[2].id, bold[0].id, bold[1].id]);
    expect(screen.getAllByTestId('bids-image-tile')[0]).toHaveTextContent('FD 0.40 mm');
  });

  it('bounds thumbnail work and starts the next tile when one finishes', async () => {
    load();
    const waiting: Array<(value: typeof image) => void> = [];
    const invoke = vi.fn().mockResolvedValueOnce(image).mockImplementation(() => new Promise((resolve) => waiting.push(resolve)));
    setTransport({ invoke } as never);
    const { unmount } = render(<BidsImages />);
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(3)); // anchor plus two active tiles
    expect(waiting).toHaveLength(2);
    await act(async () => waiting.shift()!(image));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(4));
    unmount();
    await act(async () => waiting.forEach((finish) => finish(image)));
  });

  it('does not publish a late reference from a dataset that has been replaced', async () => {
    const { index } = load();
    let finish: (value: typeof image) => void = () => undefined;
    const first = new Promise<typeof image>((resolve) => { finish = resolve; });
    const invoke = vi.fn().mockReturnValueOnce(first).mockResolvedValue(image);
    setTransport({ invoke } as never);
    render(<BidsImages />);
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    act(() => useBidsStore.setState({ datasetPath: '/new-dataset', index: { ...index, dataset_path: '/new-dataset' }, imageReference: null }));
    await act(async () => { finish(image); });
    await waitFor(() => expect(useBidsStore.getState().imageReference?.datasetPath).toBe('/new-dataset'));
  });
});
