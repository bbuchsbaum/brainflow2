import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ComparisonRenderService, comparisonTag } from '@/services/ComparisonRenderService';
import { useRenderStateStore } from '@/stores/renderStateStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import type { ViewState } from '@/types/viewState';

const applyAndRenderViewState = vi.fn();

vi.mock('@/services/apiService', () => ({
  getApiService: () => ({
    applyAndRenderViewState,
  }),
}));

function createViewState(): ViewState {
  return {
    layers: [
      {
        id: 'layer-1',
        name: 'Layer 1',
        volumeId: 'vol-1',
        visible: true,
        opacity: 1,
        colormap: 'gray',
        intensity: [0, 1],
        threshold: [0, 1],
      },
    ],
    crosshair: {
      world_mm: [0, 0, 0],
      visible: true,
    },
    views: {
      axial: {
        origin_mm: [0, 0, 0],
        u_mm: [1, 0, 0],
        v_mm: [0, 1, 0],
        dim_px: [256, 256],
      },
      sagittal: {
        origin_mm: [0, 0, 0],
        u_mm: [0, 1, 0],
        v_mm: [0, 0, 1],
        dim_px: [256, 256],
      },
      coronal: {
        origin_mm: [0, 0, 0],
        u_mm: [1, 0, 0],
        v_mm: [0, 0, 1],
        dim_px: [256, 256],
      },
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe('ComparisonRenderService', () => {
  beforeEach(() => {
    applyAndRenderViewState.mockReset();
    useRenderStateStore.getState().clearAllStates();
    useViewStateStore.getState().resetToDefaults();
    useViewStateStore.getState().setViewState(() => createViewState());
  });

  it('ignores canceled renders so stale images cannot overwrite newer state', async () => {
    const firstImage = { width: 100, height: 100 } as ImageBitmap;
    const secondImage = { width: 120, height: 120 } as ImageBitmap;
    const first = deferred<ImageBitmap | null>();
    const second = deferred<ImageBitmap | null>();

    applyAndRenderViewState
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const service = new ComparisonRenderService();
    const panel = {
      id: 'panel-1',
      label: 'Panel 1',
      visibleLayerIds: new Set(['layer-1']),
      viewType: 'axial' as const,
    };
    const tag = comparisonTag(panel.id, panel.viewType);

    const firstRender = service.renderPanels([{ panel, width: 256, height: 256 }]);
    service.cancelRenders([tag]);

    const secondRender = service.renderPanels([{ panel, width: 256, height: 256 }]);
    second.resolve(secondImage);
    await secondRender;

    first.resolve(firstImage);
    await firstRender;

    const renderState = useRenderStateStore.getState().getState(tag);
    expect(renderState.lastImage).toBe(secondImage);
    expect(renderState.isRendering).toBe(false);
  });

  it('rescales panel view geometry to the requested comparison render size', () => {
    const service = new ComparisonRenderService();
    const globalViewState = createViewState();
    const panel = {
      id: 'panel-1',
      label: 'Panel 1',
      visibleLayerIds: new Set(['layer-1']),
      viewType: 'sagittal' as const,
    };

    const panelState = service.buildPanelViewState(globalViewState, panel, 128, 512);

    expect(panelState.views.sagittal.dim_px).toEqual([128, 512]);
    expect(panelState.views.sagittal.u_mm).toEqual([0, 2, 0]);
    expect(panelState.views.sagittal.v_mm).toEqual([0, 0, 0.5]);
  });
});
