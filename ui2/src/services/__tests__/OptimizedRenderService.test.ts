import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewState, ViewStateRevisions, ViewType } from '@/types/viewState';
import { OptimizedRenderService } from '@/services/OptimizedRenderService';
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
