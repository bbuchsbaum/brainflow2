import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ComparisonRenderService,
  comparisonTag,
  padComparisonBounds,
} from '@/services/ComparisonRenderService';
import { useRenderStateStore } from '@/stores/renderStateStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useLayerStore } from '@/stores/layerStore';
import type { ViewState } from '@/types/viewState';
import type { ViewPlane } from '@/types/coordinates';

const applyAndRenderViewState = vi.fn();
const recalculateViewForDimensions = vi.fn();
const getVolumeBounds = vi.fn();

vi.mock('@/services/apiService', () => ({
  getApiService: () => ({
    applyAndRenderViewState,
    recalculateViewForDimensions,
    getVolumeBounds,
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
    recalculateViewForDimensions.mockImplementation(
      async (_volumeId: string, viewType: 'axial' | 'sagittal' | 'coronal', dimensions: [number, number]) => ({
        ...createViewState().views[viewType],
        dim_px: dimensions,
      })
    );
    getVolumeBounds.mockReset();
    useRenderStateStore.getState().clearAllStates();
    useViewStateStore.getState().resetToDefaults();
    useViewStateStore.getState().setViewState(() => createViewState());
    useLayerStore.getState().clearLayers();
  });

  it('stores the resolved panel view and renders at the panel dimensions', async () => {
    const renderedImage = { width: 256, height: 256 } as ImageBitmap;
    applyAndRenderViewState.mockResolvedValue(renderedImage);
    const bounds = {
      min: [-50, -50, -50] as [number, number, number],
      max: [50, 50, 50] as [number, number, number],
    };
    const paddedBounds = padComparisonBounds(bounds);
    const expectedPixelSize = (paddedBounds.max[1] - paddedBounds.min[1]) / 256;

    useLayerStore.getState().addLayer({
      id: 'layer-1',
      name: 'Layer 1',
      volumeId: 'vol-1',
      type: 'base',
      visible: true,
      order: 0,
    });
    useLayerStore.getState().setLayerMetadata('layer-1', {
      worldBounds: bounds,
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
    expect(recalculateViewForDimensions).not.toHaveBeenCalled();
    expect(applyAndRenderViewState).toHaveBeenCalledWith(
      expect.objectContaining({
        views: expect.objectContaining({
          axial: expect.objectContaining({
            dim_px: [256, 256],
            origin_mm: [paddedBounds.min[0], paddedBounds.max[1], 0],
            u_mm: [expectedPixelSize, 0, 0],
            v_mm: [0, -expectedPixelSize, 0],
          }),
        }),
      }),
      'axial',
      256,
      256
    );
    expect(renderState.lastImage).toBe(renderedImage);
    expect(renderState.isRendering).toBe(false);
  });

  it('computes a fresh volume-aware panel fit even when the layer contains the crosshair', async () => {
    const renderedImage = { width: 320, height: 240 } as ImageBitmap;
    applyAndRenderViewState.mockResolvedValue(renderedImage);
    const bounds = {
      min: [-50, -50, -50] as [number, number, number],
      max: [50, 50, 50] as [number, number, number],
    };
    const paddedBounds = padComparisonBounds(bounds);
    const expectedPixelSize = (paddedBounds.max[1] - paddedBounds.min[1]) / 240;
    const expectedXOffset = (320 - (paddedBounds.max[0] - paddedBounds.min[0]) / expectedPixelSize) * expectedPixelSize / 2;

    useLayerStore.getState().addLayer({
      id: 'layer-1',
      name: 'Layer 1',
      volumeId: 'vol-1',
      type: 'base',
      visible: true,
      order: 0,
    });
    useLayerStore.getState().setLayerMetadata('layer-1', {
      worldBounds: bounds,
      centerWorld: [0, 0, 0],
    });

    const service = new ComparisonRenderService();
    const panel = {
      id: 'panel-1',
      label: 'Panel 1',
      visibleLayerIds: new Set(['layer-1']),
      viewType: 'axial' as const,
    };

    await service.renderPanels([{ workspaceId: 'comparison-default', panel, width: 320, height: 240 }]);

    expect(recalculateViewForDimensions).not.toHaveBeenCalled();
    expect(applyAndRenderViewState).toHaveBeenCalledWith(
      expect.objectContaining({
        views: expect.objectContaining({
          axial: expect.objectContaining({
            dim_px: [320, 240],
            origin_mm: [paddedBounds.min[0] - expectedXOffset, paddedBounds.max[1], 0],
            u_mm: [expectedPixelSize, 0, 0],
            v_mm: [0, -expectedPixelSize, 0],
          }),
        }),
      }),
      'axial',
      320,
      240
    );
  });

  it('uses full-canvas bounds fitting for wide MNI-like comparison panels', async () => {
    const renderedImage = { width: 730, height: 429 } as ImageBitmap;
    applyAndRenderViewState.mockResolvedValue(renderedImage);
    const bounds = {
      min: [-90, -126, -72] as [number, number, number],
      max: [90, 90, 108] as [number, number, number],
    };
    const paddedBounds = padComparisonBounds(bounds);
    const widthMm = paddedBounds.max[0] - paddedBounds.min[0];
    const heightMm = paddedBounds.max[1] - paddedBounds.min[1];
    const expectedPixelSize = Math.max(widthMm / 730, heightMm / 429);
    const expectedXOffset = (730 - widthMm / expectedPixelSize) * expectedPixelSize / 2;
    const expectedYOffset = (429 - heightMm / expectedPixelSize) * expectedPixelSize / 2;

    useLayerStore.getState().addLayer({
      id: 'layer-1',
      name: 'MNI152 T1w',
      volumeId: 'vol-1',
      type: 'base',
      visible: true,
      order: 0,
    });
    useLayerStore.getState().setLayerMetadata('layer-1', {
      worldBounds: bounds,
      centerWorld: [0, -18, 18],
    });

    const service = new ComparisonRenderService();
    const panel = {
      id: 'panel-1',
      label: 'MNI152 T1w',
      visibleLayerIds: new Set(['layer-1']),
      viewType: 'axial' as const,
    };

    await service.renderPanels([{ workspaceId: 'comparison-default', panel, width: 730, height: 429 }]);

    expect(recalculateViewForDimensions).not.toHaveBeenCalled();
    const [viewStateArg, viewTypeArg, widthArg, heightArg] = applyAndRenderViewState.mock.calls[0];
    expect(viewTypeArg).toBe('axial');
    expect(widthArg).toBe(730);
    expect(heightArg).toBe(429);
    expect(viewStateArg.views.axial.dim_px).toEqual([730, 429]);
    expect(viewStateArg.views.axial.origin_mm[0]).toBeCloseTo(paddedBounds.min[0] - expectedXOffset);
    expect(viewStateArg.views.axial.origin_mm[1]).toBeCloseTo(paddedBounds.max[1] + expectedYOffset);
    expect(viewStateArg.views.axial.origin_mm[2]).toBeCloseTo(0);
    expect(viewStateArg.views.axial.u_mm[0]).toBeCloseTo(expectedPixelSize);
    expect(viewStateArg.views.axial.u_mm[1]).toBeCloseTo(0);
    expect(viewStateArg.views.axial.u_mm[2]).toBeCloseTo(0);
    expect(viewStateArg.views.axial.v_mm[0]).toBeCloseTo(0);
    expect(viewStateArg.views.axial.v_mm[1]).toBeCloseTo(-expectedPixelSize);
    expect(viewStateArg.views.axial.v_mm[2]).toBeCloseTo(0);
  });

  it('fits a coronal MNI panel without leaving the top half black', async () => {
    const renderedImage = { width: 1700, height: 900 } as ImageBitmap;
    applyAndRenderViewState.mockResolvedValue(renderedImage);
    const bounds = {
      min: [-90, -126, -72] as [number, number, number],
      max: [90, 90, 108] as [number, number, number],
    };
    const paddedBounds = padComparisonBounds(bounds);
    const widthMm = paddedBounds.max[0] - paddedBounds.min[0]; // X extent
    const heightMm = paddedBounds.max[2] - paddedBounds.min[2]; // Z extent
    const expectedPixelSize = Math.max(widthMm / 1700, heightMm / 900); // 0.2
    const expectedXOffset = (1700 - widthMm / expectedPixelSize) * expectedPixelSize / 2;
    const expectedYOffset = (900 - heightMm / expectedPixelSize) * expectedPixelSize / 2;

    useLayerStore.getState().addLayer({
      id: 'layer-1',
      name: 'MNI152 T1w',
      volumeId: 'vol-1',
      type: 'base',
      visible: true,
      order: 0,
    });
    useLayerStore.getState().setLayerMetadata('layer-1', {
      worldBounds: bounds,
      centerWorld: [0, -18, 18],
    });
    useViewStateStore.getState().setCrosshair([25.8, -22.9, 18], true);

    const service = new ComparisonRenderService();
    const panel = {
      id: 'panel-coronal',
      label: 'MNI152 T1w',
      visibleLayerIds: new Set(['layer-1']),
      viewType: 'coronal' as const,
    };

    await service.renderPanels([{ workspaceId: 'comparison-default', panel, width: 1700, height: 900 }]);

    const [viewStateArg, viewTypeArg, widthArg, heightArg] = applyAndRenderViewState.mock.calls[0];
    expect(recalculateViewForDimensions).not.toHaveBeenCalled();
    expect(viewTypeArg).toBe('coronal');
    expect(widthArg).toBe(1700);
    expect(heightArg).toBe(900);
    expect(viewStateArg.views.coronal.dim_px).toEqual([1700, 900]);
    // Slice depth = crosshair Y
    expect(viewStateArg.views.coronal.origin_mm[1]).toBeCloseTo(-22.9);
    // X centering: origin starts at Xmin - xOffset
    expect(viewStateArg.views.coronal.origin_mm[0]).toBeCloseTo(paddedBounds.min[0] - expectedXOffset);
    // Z origin: bitmap top at Zmax + zOffset (zOffset=0 here, exact fit)
    expect(viewStateArg.views.coronal.origin_mm[2]).toBeCloseTo(paddedBounds.max[2] + expectedYOffset);
    // v_mm pointing down (Z decreasing)
    expect(viewStateArg.views.coronal.u_mm[0]).toBeCloseTo(expectedPixelSize);
    expect(viewStateArg.views.coronal.v_mm[2]).toBeCloseTo(-expectedPixelSize);

    // CRITICAL: bitmap top must be at-or-above Zmax, bitmap bottom must be at-or-below Zmin.
    // If origin_z + v_mm[2]*height does NOT reach Zmin, the top half (or some portion)
    // of the bitmap is out-of-volume = black.
    const originZ = viewStateArg.views.coronal.origin_mm[2];
    const vmmZ = viewStateArg.views.coronal.v_mm[2];
    const bitmapTopZ = originZ;
    const bitmapBottomZ = originZ + vmmZ * 900;
    expect(bitmapTopZ).toBeGreaterThanOrEqual(paddedBounds.max[2] - 1e-6); // bitmap top covers Zmax
    expect(bitmapBottomZ).toBeLessThanOrEqual(paddedBounds.min[2] + 1e-6); // bitmap bottom covers Zmin
  });

  it('uses the request workspace view state instead of the active global state', async () => {
    const workspaceState: ViewState = {
      ...createViewState(),
      layers: [
        {
          ...createViewState().layers[0],
          id: 'workspace-layer',
          volumeId: 'workspace-vol',
        },
      ],
      views: {
        ...createViewState().views,
        axial: {
          ...createViewState().views.axial,
          origin_mm: [10, 20, 30],
        },
      },
    };
    applyAndRenderViewState.mockResolvedValue({ width: 200, height: 200 } as ImageBitmap);

    useViewStateStore.setState((state) => ({
      workspaceViewStates: new Map(state.workspaceViewStates).set('compare-workspace', workspaceState),
    }));
    useLayerStore.getState().addLayer({
      id: 'workspace-layer',
      name: 'Workspace Layer',
      volumeId: 'workspace-vol',
      type: 'base',
      visible: true,
      order: 0,
    });
    useLayerStore.getState().setLayerMetadata('workspace-layer', {
      worldBounds: {
        min: [10, 10, 10],
        max: [50, 50, 50],
      },
      centerWorld: [0, 0, 0],
    });

    const service = new ComparisonRenderService();
    const panel = {
      id: 'panel-1',
      label: 'Panel 1',
      visibleLayerIds: new Set(['workspace-layer']),
      viewType: 'axial' as const,
    };

    await service.renderPanels([
      { workspaceId: 'compare-workspace', panel, width: 320, height: 240 },
    ]);

    expect(recalculateViewForDimensions).not.toHaveBeenCalled();
    expect(applyAndRenderViewState).toHaveBeenCalledWith(
      expect.objectContaining({
        layers: [
          expect.objectContaining({
            id: 'workspace-layer',
            volumeId: 'workspace-vol',
            visible: true,
          }),
        ],
        crosshair: expect.objectContaining({
          world_mm: [30, 30, 30],
        }),
      }),
      'axial',
      320,
      240
    );
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
