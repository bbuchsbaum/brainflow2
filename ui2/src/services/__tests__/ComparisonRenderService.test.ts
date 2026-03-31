import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ComparisonRenderService, comparisonTag } from '@/services/ComparisonRenderService';
import { useRenderStateStore } from '@/stores/renderStateStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useLayerStore } from '@/stores/layerStore';
import type { ViewState } from '@/types/viewState';

const applyAndRenderViewState = vi.fn();
const recalculateViewForDimensions = vi.fn();

vi.mock('@/services/apiService', () => ({
  getApiService: () => ({
    applyAndRenderViewState,
    recalculateViewForDimensions,
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
    recalculateViewForDimensions.mockReset();
    useRenderStateStore.getState().clearAllStates();
    useViewStateStore.getState().resetToDefaults();
    useViewStateStore.getState().setViewState(() => createViewState());
    useLayerStore.getState().clearLayers();
  });

  it('stores the resolved panel view and renders at its backend dimensions', async () => {
    const renderedImage = { width: 192, height: 256 } as ImageBitmap;
    applyAndRenderViewState.mockResolvedValue(renderedImage);
    recalculateViewForDimensions.mockResolvedValue({
      ...createViewState().views.axial,
      origin_mm: [-20, -30, 0],
      dim_px: [192, 256],
    });

    useLayerStore.getState().addLayer({
      id: 'layer-1',
      name: 'Layer 1',
      volumeId: 'vol-1',
      type: 'base',
      visible: true,
      order: 0,
    });
    useLayerStore.getState().setLayerMetadata('layer-1', {
      worldBounds: {
        min: [-50, -50, -50],
        max: [50, 50, 50],
      },
      centerWorld: [0, 0, 0],
    });

    const service = new ComparisonRenderService();
    const panel = {
      id: 'panel-1',
      label: 'Panel 1',
      visibleLayerIds: new Set(['layer-1']),
      viewType: 'axial' as const,
    };
    const tag = comparisonTag(panel.id, panel.viewType);

    await service.renderPanels([{ workspaceId: 'comparison-default', panel, width: 256, height: 256 }]);

    const renderState = useRenderStateStore.getState().getState(tag);
    expect(recalculateViewForDimensions).toHaveBeenCalledWith(
      'vol-1',
      'axial',
      [256, 256],
      [0, 0, 0]
    );
    expect(applyAndRenderViewState).toHaveBeenCalledWith(
      expect.objectContaining({
        views: expect.objectContaining({
          axial: expect.objectContaining({
            dim_px: [192, 256],
          }),
        }),
      }),
      'axial',
      192,
      256
    );
    expect(renderState.lastImage).toBe(renderedImage);
    expect(renderState.isRendering).toBe(false);
  });

  it('keeps the newest overlapping render alive until it completes', async () => {
    const firstImage = deferred<ImageBitmap | null>();
    const secondImage = deferred<ImageBitmap | null>();
    const resolvedSecondImage = { width: 144, height: 144 } as ImageBitmap;

    useLayerStore.getState().addLayer({
      id: 'layer-1',
      name: 'Layer 1',
      volumeId: 'vol-1',
      type: 'base',
      visible: true,
      order: 0,
    });
    useLayerStore.getState().setLayerMetadata('layer-1', {
      worldBounds: {
        min: [-50, -50, -50],
        max: [50, 50, 50],
      },
      centerWorld: [0, 0, 0],
    });

    const service = new ComparisonRenderService() as any;
    service.resolvePanelViewPlane = vi
      .fn()
      .mockResolvedValue({
        ...createViewState().views.axial,
        dim_px: [144, 144],
      });
    const panel = {
      id: 'panel-1',
      label: 'Panel 1',
      visibleLayerIds: new Set(['layer-1']),
      viewType: 'axial' as const,
    };
    const tag = comparisonTag(panel.id, panel.viewType);
    applyAndRenderViewState
      .mockImplementationOnce(() => firstImage.promise)
      .mockImplementationOnce(() => secondImage.promise);
    useRenderStateStore.getState().setRendering(tag, true);

    const firstRender = service.renderSinglePanel(createViewState(), {
      workspaceId: 'comparison-default',
      panel,
      width: 256,
      height: 256,
    });
    await Promise.resolve();
    const secondRender = service.renderSinglePanel(createViewState(), {
      workspaceId: 'comparison-default',
      panel,
      width: 256,
      height: 256,
    });
    await Promise.resolve();

    firstImage.resolve({ width: 128, height: 128 } as ImageBitmap);
    await Promise.resolve();
    secondImage.resolve(resolvedSecondImage);
    await firstRender;
    await secondRender;

    const renderState = useRenderStateStore.getState().getState(tag);
    expect(renderState.lastImage).toBe(resolvedSecondImage);
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
    const resizedView = {
      ...globalViewState.views.sagittal,
      origin_mm: [0, 0, -384] as [number, number, number],
      u_mm: [0, 2, 0] as [number, number, number],
      v_mm: [0, 0, 2] as [number, number, number],
      dim_px: [128, 512] as [number, number],
    };

    const panelState = service.buildPanelViewState(globalViewState, panel, resizedView);

    expect(panelState.views.sagittal.dim_px).toEqual([128, 512]);
    expect(panelState.views.sagittal.u_mm).toEqual([0, 2, 0]);
    expect(panelState.views.sagittal.v_mm).toEqual([0, 0, 2]);
  });
});
