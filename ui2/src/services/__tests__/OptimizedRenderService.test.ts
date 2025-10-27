import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewState, ViewType } from '@/types/viewState';
import { OptimizedRenderService } from '@/services/OptimizedRenderService';
import { useRenderStateStore } from '@/stores/renderStateStore';
import { setRenderCoordinator } from '@/services/RenderCoordinator';
import type { RenderCoordinator } from '@/services/RenderCoordinator';

const allViewTypes: ViewType[] = ['axial', 'sagittal', 'coronal'];

function createViewState(): ViewState {
  return {
    layers: [
      {
        id: 'layer-1',
        name: 'Test Layer',
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

describe('OptimizedRenderService', () => {
  let service: OptimizedRenderService;
  const requestRenderMock = vi.fn();
  const requestMultiViewRenderMock = vi.fn();

  beforeEach(() => {
    // Reset store state so previous tests do not leak render info
    useRenderStateStore.getState().clearAllStates();

    // Reset mocks
    requestRenderMock.mockReset();
    requestMultiViewRenderMock.mockReset();

    // Default mock implementations
    requestRenderMock.mockResolvedValue(null);
    requestMultiViewRenderMock.mockResolvedValue({
      axial: null,
      sagittal: null,
      coronal: null
    });

    // Replace the global render coordinator with a test stub
    const coordinatorStub = {
      requestRender: requestRenderMock,
      requestMultiViewRender: requestMultiViewRenderMock,
      dispose: vi.fn()
    } as Partial<RenderCoordinator>;

    setRenderCoordinator(coordinatorStub as RenderCoordinator);

    service = new OptimizedRenderService();
  });

  it('uses batched multi-view rendering when multiple views change', async () => {
    const viewState = createViewState();

    await service.renderChangedViews(viewState);

    expect(requestMultiViewRenderMock).toHaveBeenCalledTimes(1);
    expect(requestRenderMock).not.toHaveBeenCalled();

    const callArgs = requestMultiViewRenderMock.mock.calls[0][0];
    expect(new Set(callArgs.viewTypes)).toEqual(new Set(allViewTypes));
  });

  it('falls back to single-view rendering when only one view changes', async () => {
    const baseState = createViewState();
    await service.renderChangedViews(baseState);

    // Clear mocks to capture calls from the subsequent update only
    requestMultiViewRenderMock.mockClear();
    requestRenderMock.mockClear();

    const axialChanged = createViewState();
    axialChanged.views.axial = {
      ...axialChanged.views.axial,
      dim_px: [512, 256]
    };

    await service.renderChangedViews(axialChanged);

    expect(requestRenderMock).toHaveBeenCalledTimes(1);
    expect(requestMultiViewRenderMock).not.toHaveBeenCalled();

    const singleCall = requestRenderMock.mock.calls[0][0];
    expect(singleCall.viewType).toBe('axial');
    expect(singleCall.width).toBe(512);
    expect(singleCall.height).toBe(256);
  });
});
