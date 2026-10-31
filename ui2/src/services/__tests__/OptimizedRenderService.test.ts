import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewState, ViewStateRevisions, ViewType } from '@/types/viewState';
import { OptimizedRenderService } from '@/services/OptimizedRenderService';

// Which slice views are on screen (the restore upgrades only those).
const visibleViews = vi.hoisted(() => new Set<string>(['axial', 'sagittal', 'coronal']));
vi.mock('@/services/ViewZoomService', () => ({
  hasVisibleSliceCanvas: (viewType: string) => visibleViews.has(viewType),
}));
import { useRenderStateStore } from '@/stores/renderStateStore';
import { setRenderCoordinator } from '@/services/RenderCoordinator';
import type { RenderCoordinator } from '@/services/RenderCoordinator';
import { cloneViewStateRevisions, createInitialViewStateRevisions } from '@/utils/viewStateTracking';
import {
  clearRenderLayerScope,
  resetRenderLayerScope,
  setRenderLayerScope,
} from '@/services/render/RenderLayerScope';

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

function createRevisions(): ViewStateRevisions {
  return createInitialViewStateRevisions();
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

    resetRenderLayerScope();
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

  describe('HiDPI (docs/plans/hidpi-slice-rendering-2026-10-31.md)', () => {
    const setDpr = (value: number) =>
      Object.defineProperty(window, 'devicePixelRatio', { value, configurable: true });
    beforeEach(async () => {
      const { resetRenderInteraction } = await import('@/utils/renderPixelRatio');
      resetRenderInteraction();
      setDpr(2);
      visibleViews.clear();
      for (const v of ['axial', 'sagittal', 'coronal']) visibleViews.add(v);
    });
    afterEach(async () => {
      const { resetRenderInteraction } = await import('@/utils/renderPixelRatio');
      resetRenderInteraction();
      setDpr(1);
    });

    const renderedViews = () => [
      ...requestRenderMock.mock.calls.map((c) => [c[0].viewType, c[0].width] as const),
      ...requestMultiViewRenderMock.mock.calls.flatMap((c) =>
        (c[0].viewTypes as ViewType[]).map((v) => [v, c[0].viewState.views[v].dim_px[0]] as const),
      ),
    ];

    it('renders at 2× at rest; the stored planes stay CSS', async () => {
      const viewState = createViewState();
      await service.renderChangedViews(viewState);
      const batch = requestMultiViewRenderMock.mock.calls[0][0];
      expect(batch.viewState.views.axial.dim_px).toEqual([512, 512]);
      expect(batch.viewState.views.axial.u_mm[0]).toBeCloseTo(0.5, 12);
      expect(viewState.views.axial.dim_px).toEqual([256, 256]);
    });

    it('a zoom notch re-renders only the zoomed view at 1×; the restore upgrades only it (review M2)', async () => {
      vi.useFakeTimers();
      try {
        const { pulseRenderInteraction, RATIO_RESTORE_MS } = await import('@/utils/renderPixelRatio');
        const viewState = createViewState();
        await service.renderChangedViews(viewState);
        requestMultiViewRenderMock.mockClear();
        requestRenderMock.mockClear();

        // One wheel notch over the axial view: the ratio drops, the axial plane changes.
        pulseRenderInteraction('zoom:axial');
        const zoomed = createViewState();
        zoomed.views.axial = { ...zoomed.views.axial, u_mm: [0.5, 0, 0], v_mm: [0, -0.5, 0] };
        await service.renderChangedViews(zoomed);
        // The drop alone forces nothing: only the changed view, at 1×.
        expect(renderedViews()).toEqual([['axial', 256]]);

        // Quiet: back to 2×; only the view drawn below it is redrawn.
        requestRenderMock.mockClear();
        vi.advanceTimersByTime(RATIO_RESTORE_MS);
        await service.renderChangedViews(zoomed);
        expect(renderedViews()).toEqual([['axial', 512]]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('the restore skips views that are not on screen', async () => {
      vi.useFakeTimers();
      try {
        const { beginRenderInteraction, endRenderInteraction, RATIO_RESTORE_MS } = await import(
          '@/utils/renderPixelRatio'
        );
        // First drawn during a drag: all three at 1×.
        beginRenderInteraction('layout-resize');
        await service.renderChangedViews(createViewState());
        requestMultiViewRenderMock.mockClear();
        endRenderInteraction('layout-resize');
        vi.advanceTimersByTime(RATIO_RESTORE_MS);
        visibleViews.delete('coronal');
        await service.renderChangedViews(createViewState());
        expect(renderedViews().map(([v]) => v).sort()).toEqual(['axial', 'sagittal']);
        expect(renderedViews().every(([, w]) => w === 512)).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('a single-view render asks for the 2× size and tags the bitmap', async () => {
      const { bitmapPixelRatio } = await import('@/utils/renderPixelRatio');
      const bitmap = {} as ImageBitmap;
      await service.renderChangedViews(createViewState());
      requestRenderMock.mockResolvedValue(bitmap);
      const axialChanged = createViewState();
      axialChanged.views.axial = { ...axialChanged.views.axial, dim_px: [300, 200] };
      await service.renderChangedViews(axialChanged);
      const call = requestRenderMock.mock.calls[0][0];
      expect([call.width, call.height]).toEqual([600, 400]);
      expect(bitmapPixelRatio(bitmap)).toBe(2);
    });
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

  it('uses revision snapshots to avoid broad fallback renders', async () => {
    const baseState = createViewState();
    const baseRevisions = createRevisions();

    await service.renderChangedViews(baseState, undefined, baseRevisions);

    requestMultiViewRenderMock.mockClear();
    requestRenderMock.mockClear();

    const nextState = createViewState();
    nextState.views.axial = {
      ...nextState.views.axial,
      dim_px: [512, 256]
    };

    const nextRevisions = cloneViewStateRevisions(baseRevisions);
    nextRevisions.state += 1;
    nextRevisions.views.axial += 1;

    await service.renderChangedViews(nextState, undefined, nextRevisions);

    expect(requestRenderMock).toHaveBeenCalledTimes(1);
    expect(requestMultiViewRenderMock).not.toHaveBeenCalled();
    expect(requestRenderMock.mock.calls[0][0].viewType).toBe('axial');
  });

  describe('render-layer scope (Set studio Deck)', () => {
    /** The main workspace scene: a T1 and two atlases, plus a Studio member. */
    function workspaceWithMember(): ViewState {
      const state = createViewState();
      const base = state.layers[0];
      state.layers = [
        { ...base, id: 't1', volumeId: 'vol-t1' },
        { ...base, id: 'aseg', volumeId: 'vol-aseg', colormap: 'atlas' },
        { ...base, id: 'olsen', volumeId: 'vol-olsen', colormap: 'atlas' },
        { ...base, id: 'member', volumeId: 'vol-member', colormap: 'hot' },
      ];
      return state;
    }

    const renderedLayerIds = () =>
      requestMultiViewRenderMock.mock.calls.at(-1)![0].viewState.layers.map(
        (layer: { id: string }) => layer.id,
      );

    it('keeps workspace layers out of the render request while scoped', async () => {
      setRenderLayerScope('deck', ['member']);

      await service.renderChangedViews(workspaceWithMember());

      expect(requestMultiViewRenderMock).toHaveBeenCalledTimes(1);
      expect(renderedLayerIds()).toEqual(['member']);
    });

    it('redraws every view when the scope is set or cleared', async () => {
      const state = workspaceWithMember();
      const revisions = createRevisions();
      await service.renderChangedViews(state, undefined, revisions);
      expect(renderedLayerIds()).toEqual(['t1', 'aseg', 'olsen', 'member']);

      setRenderLayerScope('deck', ['member']);
      await service.renderChangedViews(state, undefined, revisions);
      expect(requestMultiViewRenderMock).toHaveBeenCalledTimes(2);
      expect(renderedLayerIds()).toEqual(['member']);

      clearRenderLayerScope('deck');
      await service.renderChangedViews(state, undefined, revisions);
      expect(requestMultiViewRenderMock).toHaveBeenCalledTimes(3);
      expect(renderedLayerIds()).toEqual(['t1', 'aseg', 'olsen', 'member']);
    });

    it('blanks the views instead of drawing the workspace before the member loads', async () => {
      const { setImage } = useRenderStateStore.getState();
      setImage('axial', { width: 1, height: 1 } as ImageBitmap);
      setRenderLayerScope('deck', []);

      await service.renderChangedViews(workspaceWithMember());

      expect(requestMultiViewRenderMock).not.toHaveBeenCalled();
      expect(requestRenderMock).not.toHaveBeenCalled();
      expect(useRenderStateStore.getState().getState('axial').lastImage).toBeNull();
    });

    it('ignores a clear from an owner whose scope was replaced', async () => {
      setRenderLayerScope('deck', ['member']);
      setRenderLayerScope('compare', ['member']);
      clearRenderLayerScope('deck');

      await service.renderChangedViews(workspaceWithMember());
      expect(renderedLayerIds()).toEqual(['member']);
    });
  });
});
