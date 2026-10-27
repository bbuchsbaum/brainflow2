import type { ReactNode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MosaicViewPromise } from '@/components/views/MosaicViewPromise';
import { useViewStateStore } from '@/stores/viewStateStore';

const renderMosaicGridMock = vi.fn();
const cancelRendersMock = vi.fn();
const querySliceAxisMetaMock = vi.fn();
const getVolumeBoundsMock = vi.fn();

vi.mock('@/services/MosaicRenderService', () => ({
  createMosaicRenderService: () => ({
    destroy: vi.fn(),
    renderMosaicGrid: renderMosaicGridMock,
    cancelRenders: cancelRendersMock
  })
}));

vi.mock('@/services/apiService', () => ({
  getApiService: () => ({
    querySliceAxisMeta: querySliceAxisMetaMock,
    getVolumeBounds: getVolumeBoundsMock
  })
}));

vi.mock('@/components/ui/MosaicToolbar', () => ({
  MosaicToolbar: ({ totalSlices }: { totalSlices: number }) => <div data-testid="mosaic-toolbar">{totalSlices}</div>
}));

vi.mock('@/components/views/MosaicCell', () => ({
  MosaicCell: ({ tag }: { tag: string }) => <div data-testid={`cell-${tag}`} />
}));

vi.mock('@/components/views/MosaicCellErrorBoundary', () => ({
  MosaicCellErrorBoundary: ({ children }: { children: ReactNode }) => <>{children}</>
}));

vi.mock('@/components/ui/RenderErrorBoundary', () => ({
  RenderErrorBoundary: ({ children }: { children: ReactNode }) => <>{children}</>
}));

describe('MosaicViewPromise render scheduling', () => {
  beforeAll(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      }
    );

    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0)
    );
    vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      width: 640,
      height: 640,
      top: 0,
      left: 0,
      bottom: 640,
      right: 640,
      x: 0,
      y: 0,
      toJSON: () => ({})
    }));
  });

  beforeEach(() => {
    renderMosaicGridMock.mockReset();
    cancelRendersMock.mockReset();
    querySliceAxisMetaMock.mockReset();
    getVolumeBoundsMock.mockReset();

    querySliceAxisMetaMock.mockResolvedValue({ sliceCount: 16 });
    getVolumeBoundsMock.mockResolvedValue({
      min: [-96, -132, -78],
      max: [96, 96, 114]
    });

    useViewStateStore.getState().resetToDefaults();
    useViewStateStore.getState().setViewState((state) => {
      state.layers = [
        {
          id: 'layer-1',
          name: 'Layer 1',
          volumeId: 'volume-1',
          visible: true,
          opacity: 1,
          colormap: 'gray',
          intensity: [0, 1],
          threshold: [0, 1]
        }
      ];
      return state;
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('ignores metadata from a volume replaced while its request is pending', async () => {
    let resolveOld!: (value: { sliceCount: number }) => void;
    const oldMetadata = new Promise<{ sliceCount: number }>(resolve => { resolveOld = resolve; });
    querySliceAxisMetaMock.mockImplementation((id: string) =>
      id === 'volume-1' ? oldMetadata : Promise.resolve({ sliceCount: 64 }));
    render(<MosaicViewPromise workspaceId="test-workspace" />);
    await waitFor(() => expect(querySliceAxisMetaMock).toHaveBeenCalledWith('volume-1', 'axial'));
    act(() => {
      useViewStateStore.getState().setViewState(state => {
        state.layers[0].volumeId = 'volume-2';
      });
    });
    await waitFor(() => expect(screen.getByTestId('mosaic-toolbar')).toHaveTextContent('64'));
    await act(async () => { resolveOld({ sliceCount: 300 }); await oldMetadata; });
    expect(screen.getByTestId('mosaic-toolbar')).toHaveTextContent('64');
  });

  it('does not resubmit mosaic backend renders for pure crosshair moves', async () => {
    render(<MosaicViewPromise workspaceId="test-workspace" />);

    await waitFor(() => {
      expect(renderMosaicGridMock).toHaveBeenCalled();
    });
    // Let the layout settle first (the Auto grid and the brain-aspect tiles
    // re-render once the slicing and crop box arrive), then count.
    let settled = -1;
    while (settled !== renderMosaicGridMock.mock.calls.length) {
      settled = renderMosaicGridMock.mock.calls.length;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    }

    const initialCalls = renderMosaicGridMock.mock.calls.length;

    await act(async () => {
      await useViewStateStore.getState().setCrosshair([10, 20, 30]);
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(renderMosaicGridMock).toHaveBeenCalledTimes(initialCalls);

    act(() => {
      useViewStateStore.getState().setViewState((state) => {
        state.layers[0].opacity = 0.5;
        return state;
      });
    });

    await waitFor(() => {
      expect(renderMosaicGridMock.mock.calls.length).toBeGreaterThan(initialCalls);
    });
  });
  it('requests tiles only at the fitted size, and re-requests every visible cell after a resize cancels them', async () => {
    const settle = async () => {
      let settled = -1;
      while (settled !== renderMosaicGridMock.mock.calls.length) {
        settled = renderMosaicGridMock.mock.calls.length;
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
        });
      }
    };
    render(<MosaicViewPromise workspaceId="test-workspace" />);
    await waitFor(() => expect(renderMosaicGridMock).toHaveBeenCalled());
    await settle();

    type Req = { cellId: string; width: number; height: number };
    const sizes = renderMosaicGridMock.mock.calls.map(([reqs]: [Req[]]) => `${reqs[0].width}x${reqs[0].height}`);
    // No grid at the provisional 128 px / 4×4 layout: only the fitted size.
    expect(new Set(sizes).size).toBe(1);
    expect(sizes[0]).not.toBe('128x128');
    const before: Req[] = renderMosaicGridMock.mock.calls.at(-1)![0];
    const cellsBefore = before.map((r) => r.cellId);

    // The pane grows: the fit changes the tile size, the effect cleanup
    // cancels the in-flight cells, and the same visible cells are requested
    // again at the new size (nothing is left waiting on a cancelled render).
    const rect = vi.mocked(HTMLElement.prototype.getBoundingClientRect);
    rect.mockImplementation(() => ({
      width: 960, height: 960, top: 0, left: 0, bottom: 960, right: 960, x: 0, y: 0, toJSON: () => ({}),
    }) as DOMRect);
    cancelRendersMock.mockClear();
    renderMosaicGridMock.mockClear();
    try {
      await act(async () => {
        window.dispatchEvent(new Event('resize'));
      });
      await settle();
    } finally {
      rect.mockImplementation(() => ({
        width: 640, height: 640, top: 0, left: 0, bottom: 640, right: 640, x: 0, y: 0, toJSON: () => ({}),
      }) as DOMRect);
    }

    expect(cancelRendersMock).toHaveBeenCalledWith(cellsBefore);
    const after: Req[] = renderMosaicGridMock.mock.calls.at(-1)![0];
    expect(after[0].width).toBeGreaterThan(before[0].width);
    const visible = screen.getAllByTestId(/^cell-/).map((el) => el.dataset.testid!.slice('cell-'.length));
    expect(after.map((r) => r.cellId).sort()).toEqual([...visible].sort());
    // Every cancelled cell still on screen was requested again.
    for (const id of cellsBefore.filter((c) => visible.includes(c))) {
      expect(after.some((r) => r.cellId === id)).toBe(true);
    }
  });
});
