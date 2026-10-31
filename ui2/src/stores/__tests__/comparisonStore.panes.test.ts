import { beforeEach, describe, expect, it } from 'vitest';
import { useComparisonStore } from '@/stores/comparisonStore';
import {
  comparePaneCandidates,
  comparePickerOptions,
  DEFAULT_COMPARE_PANES,
  paneUnderlayId,
} from '@/utils/comparePanes';
import { resolvePanelUnderlayId } from '@/services/ComparisonRenderService';

/** QA features 2026-10-31 §6: two panes, a pane count, a layer picker per pane. */
const WS = 'compare-ws';
const panes = () => useComparisonStore.getState().getPanels(WS);
const shown = () => panes().map((p) => [...p.visibleLayerIds]);

describe('comparePaneCandidates', () => {
  const layers = [{ id: 't1' }, { id: 'aseg', source: 'atlas' }, { id: 'z1' }, { id: 'z2' }];
  it('lists the maps over the anatomy, then the anatomy', () => {
    expect(comparePaneCandidates(['t1', 'aseg', 'z1', 'z2'], layers)).toEqual(['aseg', 'z1', 'z2', 't1']);
    expect(comparePaneCandidates(['t1'], layers)).toEqual(['t1']);
    // An atlas first in the stack is not the base; a hidden base is not offered.
    expect(comparePaneCandidates(['z1'], [{ id: 'a', source: 'atlas' }, { id: 'z1' }])).toEqual(['z1']);
    expect(comparePaneCandidates(['z1', 'z2'], layers)).toEqual(['z1', 'z2']);
  });
});

describe('Compare panes', () => {
  beforeEach(() => useComparisonStore.getState().clearWorkspace(WS));

  it('opens with two panes, whatever the layer count', () => {
    useComparisonStore.getState().initPanes(WS, ['z1', 'z2', 'z3', 't1']);
    expect(DEFAULT_COMPARE_PANES).toBe(2);
    expect(shown()).toEqual([['z1'], ['z2']]);
    useComparisonStore.getState().initPanes(WS, ['t1']);
    // Fewer layers than panes: the second pane starts empty (its picker chooses).
    expect(shown()).toEqual([['t1'], []]);
  });

  it('a pane count adds panes with the next unshown layer, and removes from the end', () => {
    const store = useComparisonStore.getState();
    store.initPanes(WS, ['z1', 'z2', 'z3', 't1']);
    store.setPaneCount(WS, 4, ['z1', 'z2', 'z3', 't1']);
    expect(shown()).toEqual([['z1'], ['z2'], ['z3'], ['t1']]);
    const kept = panes().slice(0, 2).map((p) => p.id);
    store.setActivePanel(WS, panes()[3].id);
    store.setPaneCount(WS, 2, ['z1', 'z2', 'z3', 't1']);
    expect(panes().map((p) => p.id)).toEqual(kept);
    expect(useComparisonStore.getState().activePanelIds.has(WS)).toBe(false);
    store.setPaneCount(WS, 3, ['z1', 'z2']);
    expect(shown()).toEqual([['z1'], ['z2'], []]);
  });

  it('the header picker swaps the pane’s own layer and keeps the others', () => {
    const store = useComparisonStore.getState();
    store.initPanes(WS, ['z1', 'z2']);
    const [a] = panes();
    store.addLayerToPanel(WS, a.id, 'aseg');
    store.setPanelOverride(WS, a.id, 'z1', 'threshold', [-4, 4]);
    useComparisonStore.getState().setPanelLayer(WS, a.id, 'z3', 'z1', 'Map 3');
    const next = panes()[0];
    expect([...next.visibleLayerIds].sort()).toEqual(['aseg', 'z3']);
    expect(next.label).toBe('Map 3');
    expect(next.renderOverrides?.z1).toBeUndefined();
    // An empty pane takes the chosen layer.
    store.setPaneCount(WS, 3, []);
    const empty = panes()[2];
    useComparisonStore.getState().setPanelLayer(WS, empty.id, 'z1', null);
    expect([...panes()[2].visibleLayerIds]).toEqual(['z1']);
  });
});

describe('comparePickerOptions (review: a hidden pick showed only the anatomy)', () => {
  const loaded = [
    { id: 't1', name: 'T1', volumeId: 'v1' },
    { id: 'z1', name: 'zmap', volumeId: 'v2' },
    { id: 'z2', name: 'hidden map', volumeId: 'v3' },
    { id: 'srf', name: 'surface overlay', volumeId: null },
  ];
  const view = (hidden: string[]) =>
    ['t1', 'z1', 'z2', 'srf'].map((id) => ({ id, visible: !hidden.includes(id) }));

  it('offers only visible volumes, maps first then the anatomy', () => {
    expect(comparePickerOptions(view(['z2']), loaded, 'z1')).toEqual([
      { id: 'z1', name: 'zmap' },
      { id: 't1', name: 'T1' },
    ]);
  });

  it('keeps the pane’s own layer listed, marked hidden, after it is hidden', () => {
    expect(comparePickerOptions(view(['z2']), loaded, 'z2').at(-1)).toEqual({ id: 'z2', name: 'hidden map (hidden)' });
  });
});

describe('fillEmptyPanes (QA 2026-10-31: ⌘4 opened two empty panes)', () => {
  beforeEach(() => useComparisonStore.getState().clearWorkspace(WS));

  it('fills panes that show nothing (empty or stale ids) from the candidates', () => {
    const store = useComparisonStore.getState();
    store.setPaneCount(WS, 2, []);
    store.fillEmptyPanes(WS, ['t1'], new Set(['t1']));
    // Only an anatomy: it goes to pane A.
    expect(shown()).toEqual([['t1'], []]);
    store.initPanes(WS, ['old-z', 'old-t1']);
    store.fillEmptyPanes(WS, ['z', 't1'], new Set(['z', 't1']));
    expect(shown()).toEqual([['z'], ['t1']]);
  });

  it('leaves panes alone once any pane shows a present layer', () => {
    const store = useComparisonStore.getState();
    store.initPanes(WS, ['z']);
    const before = panes();
    store.fillEmptyPanes(WS, ['t1', 'z'], new Set(['t1', 'z']));
    expect(panes()).toBe(before);
  });
});

describe('paneUnderlayId matches the renderer’s underlay rule', () => {
  const layers = [{ id: 'a', source: 'atlas' }, { id: 't1' }, { id: 'z' }];
  it.each([[[]], [['z']], [['t1']], [['a', 'z']]])('for a pane showing %j', (ids) => {
    const set = new Set<string>(ids as string[]);
    expect(paneUnderlayId(set, layers)).toBe(resolvePanelUnderlayId({ visibleLayerIds: set }, layers));
  });
});
