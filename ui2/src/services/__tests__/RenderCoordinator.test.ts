import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewState } from '@/types/viewState';
import { RenderCoordinator, setMultiViewBatchEnabled } from '@/services/RenderCoordinator';

const renderMock = vi.fn();
const renderBatchMock = vi.fn();

vi.mock('@/services/apiService', () => ({
  getApiService: () => ({
    createRenderSession: () => ({
      render: renderMock,
      renderBatch: renderBatchMock,
      dispose: vi.fn(),
      cancelActiveRenders: vi.fn()
    }),
    initRenderLoop: vi.fn()
  })
}));

function createViewState(): ViewState {
  return {
    layers: [
      {
        id: 'layer-1',
        name: 'Layer',
        volumeId: 'vol-1',
        visible: true,
        opacity: 1,
        colormap: 'gray',
        intensity: [0, 1],
        threshold: [0, 1]
      }
    ],
    crosshair: {
      world_mm: [0, 0, 0],
      visible: true
    },
    views: {
      axial: {
        origin_mm: [0, 0, 0],
        u_mm: [1, 0, 0],
        v_mm: [0, -1, 0],
        dim_px: [256, 256]
      },
      sagittal: {
        origin_mm: [0, 0, 0],
        u_mm: [0, 1, 0],
        v_mm: [0, 0, -1],
        dim_px: [256, 256]
      },
      coronal: {
        origin_mm: [0, 0, 0],
        u_mm: [1, 0, 0],
        v_mm: [0, 0, -1],
        dim_px: [256, 256]
      }
    }
  };
}

beforeEach(() => {
  renderMock.mockReset();
  renderBatchMock.mockReset();
  renderMock.mockImplementation(async () => ({
    bitmap: null as unknown as ImageBitmap,
    renderTime: 1,
    dimensions: [256, 256] as [number, number]
  }));
  renderBatchMock.mockImplementation(async (requests: Array<{ viewType: string }>) =>
    requests.map(() => ({
      bitmap: null as unknown as ImageBitmap,
      renderTime: 1,
      dimensions: [256, 256] as [number, number]
    }))
  );
  setMultiViewBatchEnabled(false);
});

describe('RenderCoordinator multi-view flag', () => {
  it('falls back to sequential rendering when multi-view batch is disabled', async () => {
    const coordinator = new RenderCoordinator();
    const viewState = createViewState();

    await coordinator.requestMultiViewRender({
      viewState,
      viewTypes: ['axial', 'sagittal', 'coronal'],
      reason: 'crosshair',
      priority: 'normal'
    });

    expect(renderBatchMock).not.toHaveBeenCalled();
    expect(renderMock).toHaveBeenCalledTimes(3);
    coordinator.dispose();
  });

  it('uses renderBatch when multi-view batch is enabled', async () => {
    setMultiViewBatchEnabled(true);
    const coordinator = new RenderCoordinator();
    const viewState = createViewState();

    await coordinator.requestMultiViewRender({
      viewState,
      viewTypes: ['axial', 'sagittal', 'coronal'],
      reason: 'crosshair',
      priority: 'normal'
    });

    expect(renderBatchMock).toHaveBeenCalledTimes(1);
    expect(renderMock).not.toHaveBeenCalled();
    coordinator.dispose();
  });
});
