import { beforeEach, describe, expect, it, vi } from 'vitest';

const applyAndRenderViewState = vi.fn();
vi.mock('@/services/apiService', () => ({
  getApiService: () => ({ applyAndRenderViewState }),
}));

import {
  clearStudioPane,
  renderStudioPane,
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
    const layer = studioDerivedDisplay(map, true, 'Z-score');
    const plane = await renderStudioPane({ tag, workspaceId, map, layer, plane: 'axial', width: 200, height: 100 });
    expect(plane).not.toBeNull();
    const [state, view] = applyAndRenderViewState.mock.calls[0];
    expect(view).toBe('axial');
    expect((state as ViewState).layers.map((l) => l.id)).toEqual([map.layerId]);
    expect(useRenderStateStore.getState().states[tag]?.lastImage).toBeTruthy();
    clearStudioPane(tag);
    expect(useRenderStateStore.getState().states[tag]).toBeUndefined();
  });

  it('draws signed maps diverging and symmetric, nonnegative ones in grey over their range', () => {
    expect(studioDerivedDisplay(map, true, 'R')).toMatchObject({ colormap: 'fmri', intensity: [-3, 3] });
    const positive = { ...map, dataRange: { min: 0.5, max: 4 } };
    expect(studioDerivedDisplay(positive, false, 'M')).toMatchObject({ colormap: 'gray', intensity: [0.5, 4] });
    // A mean with negative values is signed too.
    expect(studioDerivedDisplay(map, false, 'M').colormap).toBe('fmri');
  });
});
