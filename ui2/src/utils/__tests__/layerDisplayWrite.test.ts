import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useComparisonStore } from '@/stores/comparisonStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { writeLayerDisplayField } from '../layerDisplayWrite';

vi.mock('@/services/apiService', () => ({ getApiService: () => ({}) }));

describe('writeLayerDisplayField (one panel-aware writer, review R9)', () => {
  beforeEach(() => {
    useViewStateStore.getState().resetToDefaults();
    useViewStateStore.getState().setViewState((state) => {
      state.layers = [
        { id: 'z', name: 'z', volumeId: 'z', visible: true, opacity: 1, colormap: 'fmri', intensity: [-6, 6], threshold: [-3, 3] } as never,
      ];
    });
    vi.spyOn(useWorkspaceStore, 'getState').mockReturnValue({
      ...useWorkspaceStore.getState(),
      getActiveWorkspace: () => ({ id: 'ws', type: 'comparison' }),
    } as never);
    useComparisonStore.setState({
      panels: new Map([
        [
          'ws',
          [
            { id: 'pA', label: 'A', visibleLayerIds: new Set(['z']), viewType: 'axial' },
            { id: 'pB', label: 'B', visibleLayerIds: new Set(['z']), viewType: 'axial' },
          ],
        ],
      ]) as never,
      linkModes: new Map([['ws', 'none']]) as never,
      activePanelIds: new Map([['ws', 'pB']]) as never,
      editScopes: new Map([['ws', 'panel']]) as never,
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('unlinked, panel scope: a histogram / window drag sets the active panel only', () => {
    writeLayerDisplayField('z', 'intensity', [-4, 4]);
    const panelB = useComparisonStore.getState().panels.get('ws')!.find((p) => p.id === 'pB')!;
    expect(panelB.renderOverrides?.z?.intensity).toEqual([-4, 4]);
    // The shared layer (and so panel A) is unchanged.
    expect(useViewStateStore.getState().viewState.layers[0].intensity).toEqual([-6, 6]);
  });

  it('linked: the shared layer, as before', () => {
    useComparisonStore.setState({ linkModes: new Map([['ws', 'all']]) as never });
    writeLayerDisplayField('z', 'threshold', [-2, 2]);
    expect(useViewStateStore.getState().viewState.layers[0].threshold).toEqual([-2, 2]);
  });
});
