import type { ReactNode } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MosaicViewPromise } from '@/components/views/MosaicViewPromise';
import { useViewStateStore } from '@/stores/viewStateStore';

const renderMosaicGridMock = vi.fn();
const cancelRendersMock = vi.fn();
const querySliceAxisMetaMock = vi.fn();
const getVolumeBoundsMock = vi.fn();

vi.mock('@/services/MosaicRenderService', () => ({
  getMosaicRenderService: () => ({
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
  MosaicToolbar: () => <div data-testid="mosaic-toolbar" />
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

  it('does not resubmit mosaic backend renders for pure crosshair moves', async () => {
    render(<MosaicViewPromise workspaceId="test-workspace" />);

    await waitFor(() => {
      expect(renderMosaicGridMock).toHaveBeenCalled();
    });

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
});
