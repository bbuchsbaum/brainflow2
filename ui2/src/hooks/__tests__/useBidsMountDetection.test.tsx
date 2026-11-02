import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getEventBus } from '@/events/EventBus';
import { setTransport } from '@/services/transport';
import { DEFAULT_FD_THRESHOLD_MM } from '@/stores/bidsModel';
import { useBidsStore } from '@/stores/bidsStore';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import { resetBidsMountDetection, useBidsMountDetection } from '../useBidsMountDetection';

describe('useBidsMountDetection', () => {
  const scanDataset = vi.fn(async () => undefined);
  let isBids = true;

  beforeEach(() => {
    isBids = true;
    scanDataset.mockClear();
    resetBidsMountDetection();
    setTransport({ invoke: vi.fn(async () => isBids) } as never);
    useBidsStore.setState({
      scanDataset,
      datasetPath: null,
      scanStatus: 'idle',
      index: null,
      lens: null,
      fdThreshold: DEFAULT_FD_THRESHOLD_MM,
      censor: null,
      undoStack: [],
    });
    useFileBrowserStore.setState({ lastMount: null });
    useFileBrowserStore.getState().setViewMode('tree');
  });

  let nonce = 0;
  const mount = (path: string, isRemote = false) =>
    act(() => useFileBrowserStore.setState({ lastMount: { path, nonce: ++nonce, remote: isRemote } }));

  it('shows a mounted dataset in the BIDS view and scans it', async () => {
    renderHook(() => useBidsMountDetection());
    mount('/d');
    await waitFor(() => expect(useFileBrowserStore.getState().viewMode).toBe('bids'));
    expect(scanDataset).toHaveBeenCalledWith('/d');
  });

  it('leaves another folder alone', async () => {
    isBids = false;
    renderHook(() => useBidsMountDetection());
    mount('/plain');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(useFileBrowserStore.getState().viewMode).toBe('tree');
    expect(scanDataset).not.toHaveBeenCalled();
  });

  it('offers a remote mount without scanning it', async () => {
    renderHook(() => useBidsMountDetection());
    mount('/r', true);
    await waitFor(() => expect(useFileBrowserStore.getState().viewMode).toBe('bids'));
    expect(scanDataset).not.toHaveBeenCalled();
  });

  it('acts once per mount, so going back to Tree sticks', async () => {
    const { rerender } = renderHook(() => useBidsMountDetection());
    mount('/d');
    await waitFor(() => expect(useFileBrowserStore.getState().viewMode).toBe('bids'));
    useFileBrowserStore.getState().setViewMode('tree');
    rerender();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(useFileBrowserStore.getState().viewMode).toBe('tree');
    expect(scanDataset).toHaveBeenCalledTimes(1);
  });

  it('remembers a mount across a remounted panel', async () => {
    const first = renderHook(() => useBidsMountDetection());
    mount('/d');
    await waitFor(() => expect(useFileBrowserStore.getState().viewMode).toBe('bids'));
    first.unmount();
    useFileBrowserStore.getState().setViewMode('tree');
    renderHook(() => useBidsMountDetection());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(useFileBrowserStore.getState().viewMode).toBe('tree');
    expect(scanDataset).toHaveBeenCalledTimes(1);
  });

  it('asks again when a panel left before the check answered', async () => {
    const first = renderHook(() => useBidsMountDetection());
    mount('/d');
    first.unmount();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(useFileBrowserStore.getState().viewMode).toBe('tree');
    renderHook(() => useBidsMountDetection());
    await waitFor(() => expect(scanDataset).toHaveBeenCalledWith('/d'));
  });

  it('asks again after a failed check', async () => {
    setTransport({ invoke: vi.fn().mockRejectedValueOnce(new Error('gone')).mockResolvedValue(true) } as never);
    const first = renderHook(() => useBidsMountDetection());
    mount('/d');
    await new Promise((resolve) => setTimeout(resolve, 0));
    first.unmount();
    renderHook(() => useBidsMountDetection());
    await waitFor(() => expect(scanDataset).toHaveBeenCalledWith('/d'));
  });

  it('selecting a file in another root neither flips the view nor scans', async () => {
    const invoke = vi.fn(async () => true);
    setTransport({ invoke } as never);
    useBidsStore.setState({ datasetPath: '/other', scanStatus: 'ready', index: { runs: [] } as never });
    const { rerender } = renderHook(() => useBidsMountDetection());
    useFileBrowserStore.getState().selectFile('/d/sub-01/anat/t1.nii.gz');
    rerender();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(useFileBrowserStore.getState().viewMode).toBe('tree');
    expect(invoke).not.toHaveBeenCalled();
    expect(scanDataset).not.toHaveBeenCalled();
  });

  describe('a mount request', () => {
    beforeEach(() => {
      useBidsStore.setState({ undoStack: [] });
    });

    it('replaces a dataset that is scanning', async () => {
      useBidsStore.setState({ datasetPath: '/other', scanStatus: 'scanning' });
      renderHook(() => useBidsMountDetection());
      mount('/d');
      await waitFor(() => expect(scanDataset).toHaveBeenCalledWith('/d'));
    });

    it('replaces a dataset that is loaded, and says when undo ends', async () => {
      useBidsStore.setState({
        datasetPath: '/old/ds1',
        scanStatus: 'ready',
        index: { runs: [] } as never,
        undoStack: [{ id: 1, added: [] }],
      });
      const notified = vi.fn();
      const stop = getEventBus().on('ui.notification', notified);
      renderHook(() => useBidsMountDetection());
      mount('/new/ds2');
      await waitFor(() => expect(scanDataset).toHaveBeenCalledWith('/new/ds2'));
      stop();
      expect(notified.mock.calls[0][0].message).toContain('Switched to ds2');
    });

    it('says when a lens or a threshold is dropped, and says nothing when none is', async () => {
      const notified = vi.fn();
      const stop = getEventBus().on('ui.notification', notified);
      useBidsStore.setState({ datasetPath: '/a', scanStatus: 'ready', index: { runs: [] } as never });
      renderHook(() => useBidsMountDetection());
      mount('/b');
      await waitFor(() => expect(scanDataset).toHaveBeenCalledWith('/b'));
      expect(notified).not.toHaveBeenCalled();
      useBidsStore.setState({
        datasetPath: '/b',
        lens: { id: 'l', label: 'L', predicate: { op: 'excluded' } } as never,
        fdThreshold: 0.5,
      });
      mount('/c');
      await waitFor(() => expect(scanDataset).toHaveBeenCalledWith('/c'));
      stop();
      expect(notified.mock.calls).toHaveLength(1);
      expect(notified.mock.calls[0][0].message).toBe('Switched to c. Cleared the lens and the motion thresholds.');
    });

    it('works for a root already mounted, again and again (Recents, back and forth)', async () => {
      useBidsStore.setState({ datasetPath: '/a', scanStatus: 'ready', index: { runs: [] } as never });
      renderHook(() => useBidsMountDetection());
      mount('/b');
      await waitFor(() => expect(scanDataset).toHaveBeenCalledWith('/b'));
      useBidsStore.setState({ datasetPath: '/b' });
      mount('/a');
      await waitFor(() => expect(scanDataset).toHaveBeenCalledWith('/a'));
      await waitFor(() => expect(useFileBrowserStore.getState().selectedPath).toBe('/a'));
    });

    it('does not rescan the dataset already current', async () => {
      useBidsStore.setState({ datasetPath: '/d', scanStatus: 'ready', index: { runs: [] } as never });
      renderHook(() => useBidsMountDetection());
      mount('/d');
      await waitFor(() => expect(useFileBrowserStore.getState().viewMode).toBe('bids'));
      expect(scanDataset).not.toHaveBeenCalled();
    });

    it('only offers a remote dataset', async () => {
      useBidsStore.setState({ datasetPath: '/other', scanStatus: 'ready', index: { runs: [] } as never });
      renderHook(() => useBidsMountDetection());
      mount('/r', true);
      await waitFor(() => expect(useFileBrowserStore.getState().viewMode).toBe('bids'));
      expect(scanDataset).not.toHaveBeenCalled();
    });

    it('leaves the current dataset alone for a plain folder', async () => {
      isBids = false;
      useBidsStore.setState({ datasetPath: '/a', scanStatus: 'ready', index: { runs: [] } as never });
      renderHook(() => useBidsMountDetection());
      mount('/plain');
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(scanDataset).not.toHaveBeenCalled();
    });
  });
});
