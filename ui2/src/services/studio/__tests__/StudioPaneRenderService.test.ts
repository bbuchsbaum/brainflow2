import { beforeEach, describe, expect, it, vi } from 'vitest';

const applyAndRenderViewState = vi.fn();
vi.mock('@/services/apiService', () => ({
  getApiService: () => ({ applyAndRenderViewState }),
}));

import {
  clearStudioPane,
  renderStudioPane,
  studioAnatomyDisplay,
  studioDerivedDisplay,
  studioPaneTag,
} from '../StudioPaneRenderService';
import { useRenderStateStore } from '@/stores/renderStateStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import type { ViewState } from '@/types/viewState';
import type { StudioDerivedMap } from '../StudioDerivedMapService';

const map: StudioDerivedMap = {
  layerId: 'studio-derived-1:vol-9',
  volumeId: 'vol-9',
  bounds: { min: [-10, -10, -10], max: [10, 10, 10] },
  dataRange: { min: -2, max: 3 },
};

describe('Studio Compare pane render (QA F8)', () => {
  beforeEach(() => {
    applyAndRenderViewState.mockReset();
    applyAndRenderViewState.mockResolvedValue({ width: 10, height: 10, close: vi.fn() });
    useViewStateStore.getState().setViewState((draft: ViewState) => {
      draft.layers = [{ id: 'member', visible: true } as never];
      draft.crosshair.world_mm = [0, 0, 0];
    });
  });

  it('draws only its own map, never the workspace layers, and drops its bitmap on unmount', async () => {
    const workspaceId = useViewStateStore.getState().activeWorkspaceKey!;
    const tag = studioPaneTag('zscore', 'axial');
    const anatomy = studioAnatomyDisplay({ ...map, layerId: 'studio-derived-2:t1', volumeId: 't1', dataRange: { min: 0, max: 900 } });
    const layer = studioDerivedDisplay(map, 'Z-score');
    const plane = await renderStudioPane({
      tag,
      workspaceId,
      map,
      layers: [anatomy, layer],
      plane: 'axial',
      width: 200,
      height: 100,
    });
    expect(plane).not.toBeNull();
    const [state, view] = applyAndRenderViewState.mock.calls[0];
    expect(view).toBe('axial');
    // The anatomy first, the map over it; never a workspace layer.
    expect((state as ViewState).layers.map((l) => [l.id, l.colormap])).toEqual([
      ['studio-derived-2:t1', 'gray'],
      [map.layerId, 'fmri'],
    ]);
    expect(useRenderStateStore.getState().states[tag]?.lastImage).toBeTruthy();
    clearStudioPane(tag);
    expect(useRenderStateStore.getState().states[tag]).toBeUndefined();
  });

  it('draws signed maps diverging and nonnegative ones sequential over the anatomy (N10, review L2)', () => {
    // A map with negative values: diverging, symmetric, near-zero hidden.
    expect(studioDerivedDisplay(map, 'Mean')).toMatchObject({
      colormap: 'fmri',
      intensity: [-3, 3],
      threshold: [-0.30000000000000004, 0.30000000000000004],
    });
    // A nonnegative cohort mean (GM density, FA, CBF): sequential Hot over its
    // own range, its lowest tenth hidden, not half a diverging map.
    const positive = { ...map, dataRange: { min: 0.5, max: 4 } };
    expect(studioDerivedDisplay(positive, 'Mean')).toMatchObject({
      colormap: 'hot',
      intensity: [0.5, 4],
      threshold: [0.5, 0.5 + 0.1 * 3.5],
    });
    // Residual and z-score are signed by construction, whatever this map holds.
    expect(studioDerivedDisplay(positive, 'Z', true)).toMatchObject({ colormap: 'fmri', intensity: [-4, 4] });
    expect(studioAnatomyDisplay(positive)).toMatchObject({ colormap: 'gray', intensity: [0.5, 4] });
  });
});
