import { beforeEach, describe, expect, it } from 'vitest';
import { useComparisonStore } from '@/stores/comparisonStore';
import { ComparisonRenderService } from '@/services/ComparisonRenderService';
import { panelLetter } from '@/types/comparison';
import {
  compareEditTarget,
  isDisplayLinked,
  panelDisplayLayers,
  isFieldLinked,
  panelHasOverrides,
  thresholdMismatch,
  resolveActivePanel,
} from '@/utils/compareDisplay';
import type { ViewLayer } from '@/types/viewState';

const WS = 'ws-compare';

function zLayer(): ViewLayer {
  return {
    id: 'z',
    name: 'zmap',
    volumeId: 'vz',
    visible: true,
    opacity: 1,
    colormap: 'fmri_redblue',
    intensity: [-6, 6],
    threshold: [-3.1, 3.1],
  } as ViewLayer;
}

describe('Linked Compare (P3.9)', () => {
  beforeEach(() => {
    useComparisonStore.getState().clearWorkspace(WS);
    useComparisonStore.getState().initFromLayers(WS, ['z', 'z']);
  });

  it('letters panels A, B, … Z, AA', () => {
    expect([0, 1, 25, 26, 27].map(panelLetter)).toEqual(['A', 'B', 'Z', 'AA', 'AB']);
  });

  it('is linked by default, and linked state ignores overrides', () => {
    const state = useComparisonStore.getState();
    expect(isDisplayLinked(state, WS)).toBe(true);
    expect(compareEditTarget(state, WS)).toBeNull();
    const [, b] = state.panels.get(WS)!;
    state.setPanelOverride(WS, b.id, 'z', 'threshold', [-4.5, 4.5]);
    const panelB = useComparisonStore.getState().panels.get(WS)![1];
    expect(panelDisplayLayers([zLayer()], panelB, 'all')[0].threshold).toEqual([-3.1, 3.1]);
    expect(panelDisplayLayers([zLayer()], panelB, 'none')[0].threshold).toEqual([-4.5, 4.5]);
  });

  it('unlinking targets the first panel until another is activated', () => {
    const store = useComparisonStore.getState();
    store.setLinkMode(WS, 'none');
    expect(compareEditTarget(useComparisonStore.getState(), WS)?.letter).toBe('A');
    const b = useComparisonStore.getState().panels.get(WS)![1];
    store.setActivePanel(WS, b.id);
    const target = compareEditTarget(useComparisonStore.getState(), WS);
    expect(target?.letter).toBe('B');
    expect(target?.scope).toBe('panel');
    expect(target?.letters).toEqual(['A', 'B']);
  });

  it('falls back to the first panel when the active one is removed', () => {
    const store = useComparisonStore.getState();
    const b = store.panels.get(WS)![1];
    store.setActivePanel(WS, b.id);
    store.removePanel(WS, b.id);
    expect(resolveActivePanel(useComparisonStore.getState(), WS)?.letter).toBe('A');
  });

  it('clears one field in one panel, or in every panel', () => {
    const store = useComparisonStore.getState();
    const [a, b] = store.panels.get(WS)!;
    store.setPanelOverride(WS, a.id, 'z', 'threshold', [-2, 2]);
    store.setPanelOverride(WS, b.id, 'z', 'threshold', [-4, 4]);
    store.setPanelOverride(WS, b.id, 'z', 'colormap', 'hot');
    store.clearPanelOverride(WS, b.id, 'z', 'colormap');
    let panels = useComparisonStore.getState().panels.get(WS)!;
    expect(panels[1].renderOverrides?.z).toEqual({ threshold: [-4, 4] });
    store.clearPanelOverride(WS, null, 'z', 'threshold');
    panels = useComparisonStore.getState().panels.get(WS)!;
    expect(panels[0].renderOverrides?.z).toBeUndefined();
    expect(panels[1].renderOverrides?.z).toBeUndefined();
  });

  it('merges the panel override into the panel render state only while unlinked', () => {
    const store = useComparisonStore.getState();
    const b = store.panels.get(WS)![1];
    store.setPanelOverride(WS, b.id, 'z', 'intensity', [-3, 3]);
    const panel = useComparisonStore.getState().panels.get(WS)![1];
    const service = new ComparisonRenderService();
    const base = {
      layers: [zLayer()],
      views: {},
      crosshair: { world_mm: [0, 0, 0], visible: true },
    } as never;
    const plane = {
      origin_mm: [0, 0, 0],
      u_mm: [1, 0, 0],
      v_mm: [0, -1, 0],
      dim_px: [10, 10],
    } as never;
    const linked = service.buildPanelViewState(base, panel, plane, undefined, null, 'all');
    const unlinked = service.buildPanelViewState(base, panel, plane, undefined, null, 'none');
    expect(linked.layers[0].intensity).toEqual([-6, 6]);
    expect(unlinked.layers[0].intensity).toEqual([-3, 3]);
    expect(unlinked.layers[0].threshold).toEqual([-3.1, 3.1]);
  });

  it('applies only the fields a link mode leaves per panel', () => {
    const store = useComparisonStore.getState();
    const b = store.panels.get(WS)![1];
    store.setPanelOverride(WS, b.id, 'z', 'threshold', [-4.5, 4.5]);
    store.setPanelOverride(WS, b.id, 'z', 'intensity', [-3, 3]);
    const panel = useComparisonStore.getState().panels.get(WS)![1];
    const [windowLinked] = panelDisplayLayers([zLayer()], panel, 'window');
    expect(windowLinked.intensity).toEqual([-6, 6]);
    expect(windowLinked.threshold).toEqual([-4.5, 4.5]);
    const [thresholdLinked] = panelDisplayLayers([zLayer()], panel, 'threshold');
    expect(thresholdLinked.intensity).toEqual([-3, 3]);
    expect(thresholdLinked.threshold).toEqual([-3.1, 3.1]);
    expect(isFieldLinked('window', 'colormap')).toBe(false);
    expect(panelHasOverrides(panel, 'all')).toBe(false);
    expect(panelHasOverrides(panel, 'window')).toBe(true);
  });

  it('flags the same layer thresholded differently across panels', () => {
    const store = useComparisonStore.getState();
    const [a, b] = store.panels.get(WS)!;
    expect(thresholdMismatch(store.panels.get(WS)!, [zLayer()], 'none')).toBeNull();
    store.setPanelOverride(WS, b.id, 'z', 'threshold', [-4.5, 4.5]);
    const panels = useComparisonStore.getState().panels.get(WS)!;
    expect(thresholdMismatch(panels, [zLayer()], 'none')).toEqual({
      layerId: 'z',
      thresholds: [
        { letter: 'A', threshold: [-3.1, 3.1] },
        { letter: 'B', threshold: [-4.5, 4.5] },
      ],
    });
    // Shared threshold: no mismatch can exist.
    expect(thresholdMismatch(panels, [zLayer()], 'threshold')).toBeNull();
    expect(a.id).not.toBe(b.id);
  });
});
