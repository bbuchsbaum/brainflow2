import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ComparisonRenderService,
  comparisonTag,
  padComparisonBounds,
  resolvePanelUnderlayId,
  frameAtSharedScale,
  sharedComparisonFitSize,
  sharedComparisonFrame,
} from '@/services/ComparisonRenderService';
import { useRenderStateStore } from '@/stores/renderStateStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useLayerStore } from '@/stores/layerStore';
import { useComparisonStore } from '@/stores/comparisonStore';
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

  it('panes of a small and a large image share one world scale (QA 2026-10-30 F7)', async () => {
    applyAndRenderViewState.mockResolvedValue({ width: 256, height: 256 } as ImageBitmap);
    const small = { min: [-10, -10, -10] as [number, number, number], max: [10, 10, 10] as [number, number, number] };
    const large = { min: [-90, -126, -72] as [number, number, number], max: [90, 90, 108] as [number, number, number] };
    useViewStateStore.getState().setViewState(() => {
      const state = createViewState();
      state.layers = [
        { ...state.layers[0], id: 'oblique', volumeId: 'vol-o' },
        { ...state.layers[0], id: 't1', volumeId: 'vol-t1' },
      ];
      return state;
    });
    for (const [id, bounds] of [['oblique', small], ['t1', large]] as const) {
      useLayerStore.getState().addLayer({ id, name: id, volumeId: `vol-${id}`, type: 'anatomical', visible: true, order: 0 });
      useLayerStore.getState().setLayerMetadata(id, { worldBounds: bounds, centerWorld: [0, 0, 0] });
    }
    useComparisonStore.getState().initFromLayers('comparison-default', ['oblique', 't1']);
    const panels = useComparisonStore.getState().getPanels('comparison-default');

    const service = new ComparisonRenderService();
    await service.renderPanels(panels.map((panel) => ({ workspaceId: 'comparison-default', panel, width: 256, height: 256 })));

    const planes = panels.map((panel) => useComparisonStore.getState().getPanelViewPlane(panel.id)!);
    expect(planes[0].u_mm).toEqual(planes[1].u_mm);
    expect(planes[0].origin_mm.slice(0, 2)).toEqual(planes[1].origin_mm.slice(0, 2));
    // The frame is the large image's.
    const padded = padComparisonBounds(large);
    expect(planes[0].u_mm[0]).toBeCloseTo((padded.max[1] - padded.min[1]) / 256, 6);
  });

  it('panes of different widths share one mm-per-pixel scale (QA 2026-10-31 N23)', async () => {
    // Run 5: p4_zmap (2 mm) in A with its colorbar column, the 1 mm T1 in B.
    // A's canvas was 128 px narrower, so fitted alone its brain came out smaller.
    applyAndRenderViewState.mockResolvedValue({ width: 256, height: 256 } as ImageBitmap);
    const zmap = { min: [-96, -132, -78] as [number, number, number], max: [96, 96, 114] as [number, number, number] };
    const t1 = { min: [-96, -132, -78] as [number, number, number], max: [96, 96, 114] as [number, number, number] };
    useViewStateStore.getState().setViewState(() => {
      const state = createViewState();
      state.layers = [
        { ...state.layers[0], id: 'zmap', volumeId: 'vol-zmap' },
        { ...state.layers[0], id: 't1', volumeId: 'vol-t1' },
      ];
      return state;
    });
    for (const [id, bounds] of [['zmap', zmap], ['t1', t1]] as const) {
      useLayerStore.getState().addLayer({ id, name: id, volumeId: `vol-${id}`, type: 'anatomical', visible: true, order: 0 });
      useLayerStore.getState().setLayerMetadata(id, { worldBounds: bounds, centerWorld: [0, 0, 0] });
    }
    useComparisonStore.getState().initFromLayers('comparison-n23', ['zmap', 't1']);
    const [a, b] = useComparisonStore.getState().getPanels('comparison-n23');
    // The panes' canvases, as ComparisonPanel publishes them: A gives up 128 px.
    const sizeA = { width: 272, height: 480 };
    const sizeB = { width: 400, height: 480 };
    useComparisonStore.getState().setPanelCanvasSize(a.id, sizeA);
    useComparisonStore.getState().setPanelCanvasSize(b.id, sizeB);

    const service = new ComparisonRenderService();
    await service.renderPanel({ workspaceId: 'comparison-n23', panel: a, ...sizeA });
    await service.renderPanel({ workspaceId: 'comparison-n23', panel: b, ...sizeB });

    const planeA = useComparisonStore.getState().getPanelViewPlane(a.id)!;
    const planeB = useComparisonStore.getState().getPanelViewPlane(b.id)!;
    expect(planeA.dim_px).toEqual([272, 480]);
    expect(planeB.dim_px).toEqual([400, 480]);
    // One scale: the frame fitted to the narrower pane.
    expect(planeB.u_mm[0]).toBeCloseTo(planeA.u_mm[0], 9);
    // Square pixels at that scale in both panes (v runs down: -y).
    expect(planeA.v_mm[1]).toBeCloseTo(-planeA.u_mm[0], 9);
    expect(planeB.v_mm[1]).toBeCloseTo(planeA.v_mm[1], 9);
    // ...and the same vertical centre.
    const centreY = (plane: ViewPlane) => plane.origin_mm[1] + (plane.v_mm[1] * plane.dim_px[1]) / 2;
    expect(centreY(planeA)).toBeCloseTo(centreY(planeB), 6);
    const padded = padComparisonBounds(t1);
    expect(planeA.u_mm[0]).toBeCloseTo((padded.max[0] - padded.min[0]) / 272, 6);
    // Both centred on the same world point: the frame centre at each canvas centre.
    const centreX = (plane: ViewPlane) => plane.origin_mm[0] + (plane.u_mm[0] * plane.dim_px[0]) / 2;
    expect(centreX(planeA)).toBeCloseTo(centreX(planeB), 6);
  });

  it('shared fit size: the smallest width and height among the panes', () => {
    expect(sharedComparisonFitSize([400, 480], [{ width: 272, height: 500 }, undefined, { width: 0, height: 10 }])).toEqual([
      272, 480,
    ]);
    const frame = { min: [-100, -120, -5] as [number, number, number], max: [100, 120, 5] as [number, number, number] };
    // Fitted to 200x480 the scale is 1 mm/px; a 400x480 pane gets a 400 mm wide frame at that scale.
    const wide = frameAtSharedScale(frame, 'axial', [400, 480], [200, 480]);
    expect(wide.min[0]).toBeCloseTo(-200);
    expect(wide.max[0]).toBeCloseTo(200);
    expect(wide.min[1]).toBeCloseTo(-240);
    expect(wide.min[2]).toBe(-5);
    // Its own size: unchanged.
    expect(frameAtSharedScale(frame, 'axial', [200, 240], [200, 240])).toEqual(frame);
  });

  it('a pane whose bounds come from the backend still sets the shared frame (review 4)', async () => {
    applyAndRenderViewState.mockResolvedValue({ width: 256, height: 256 } as ImageBitmap);
    const small = { min: [-10, -10, -10] as [number, number, number], max: [10, 10, 10] as [number, number, number] };
    const large = { min: [-90, -126, -72] as [number, number, number], max: [90, 90, 108] as [number, number, number] };
    useViewStateStore.getState().setViewState(() => {
      const state = createViewState();
      state.layers = [
        { ...state.layers[0], id: 'oblique', volumeId: 'vol-oblique' },
        { ...state.layers[0], id: 't1', volumeId: 'vol-t1' },
      ];
      return state;
    });
    useLayerStore.getState().addLayer({ id: 'oblique', name: 'oblique', volumeId: 'vol-oblique', type: 'anatomical', visible: true, order: 0 });
    useLayerStore.getState().setLayerMetadata('oblique', { worldBounds: small, centerWorld: [0, 0, 0] });
    // The T1 has no recorded bounds: only the backend knows them.
    useLayerStore.getState().addLayer({ id: 't1', name: 't1', volumeId: 'vol-t1', type: 'anatomical', visible: true, order: 1 });
    getVolumeBounds.mockImplementation(async (volumeId: string) => (volumeId === 'vol-t1' ? large : small));
    useComparisonStore.getState().initFromLayers('comparison-api', ['oblique', 't1']);
    const panels = useComparisonStore.getState().getPanels('comparison-api');

    const service = new ComparisonRenderService();
    // The oblique pane alone, as ComparisonPanel renders it.
    await service.renderPanel({ workspaceId: 'comparison-api', panel: panels[0], width: 256, height: 256 });
    const plane = useComparisonStore.getState().getPanelViewPlane(panels[0].id)!;
    const padded = padComparisonBounds(large);
    expect(plane.u_mm[0]).toBeCloseTo((padded.max[1] - padded.min[1]) / 256, 6);
    expect(getVolumeBounds).toHaveBeenCalledTimes(1);
  });

  it('boxes in different spaces (no overlap) are not combined', () => {
    const own = { min: [-10, -10, -10] as [number, number, number], max: [10, 10, 10] as [number, number, number] };
    const far = { min: [100, 100, 100] as [number, number, number], max: [200, 200, 200] as [number, number, number] };
    const near = { min: [-50, -50, -50] as [number, number, number], max: [50, 50, 50] as [number, number, number] };
    expect(sharedComparisonFrame(own, [far])).toEqual(own);
    expect(sharedComparisonFrame(own, [far, near])).toEqual(near);
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

  it('composes the base anatomy under an overlay-only panel', () => {
    const service = new ComparisonRenderService();
    const globalViewState = createViewState();
    globalViewState.layers.push({
      ...globalViewState.layers[0],
      id: 'stat',
      name: 'Stat',
      volumeId: 'vol-2',
      colormap: 'fmri',
    });
    const overlayPanel = {
      id: 'panel-2',
      label: 'Stat',
      visibleLayerIds: new Set(['stat']),
      viewType: 'axial' as const,
    };
    const layers = [
      { id: 'layer-1', source: 'file' },
      { id: 'stat', source: 'file' },
    ];
    expect(resolvePanelUnderlayId(overlayPanel, layers)).toBe('layer-1');
    expect(
      resolvePanelUnderlayId({ visibleLayerIds: new Set(['layer-1']) }, layers)
    ).toBeNull();
    expect(resolvePanelUnderlayId({ visibleLayerIds: new Set() }, layers)).toBeNull();

    const state = service.buildPanelViewState(
      globalViewState,
      overlayPanel,
      globalViewState.views.axial,
      undefined,
      'layer-1'
    );
    // Same order and display properties as the orthogonal composite.
    expect(state.layers.map(l => [l.id, l.visible])).toEqual([
      ['layer-1', true],
      ['stat', true],
    ]);
    const without = service.buildPanelViewState(globalViewState, overlayPanel, globalViewState.views.axial);
    expect(without.layers.map(l => l.visible)).toEqual([false, true]);
  });
});
