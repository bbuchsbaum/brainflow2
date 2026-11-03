import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useInspectorSelectionStore } from '@/stores/inspectorSelectionStore';
import { useLayerStore } from '@/stores/layerStore';
import { useSurfaceStore, type LoadedSurface } from '@/stores/surfaceStore';
import { useActivePanelStore } from '@/stores/activePanelStore';
import { useActiveRenderContextStore } from '@/stores/activeRenderContextStore';
import type { SceneItem } from '@/types/sceneItem';

function makeVolumeItem(id: string): SceneItem {
  return {
    id,
    kind: 'volume-overlay',
    group: 'volume',
    name: id,
    subtitle: 'volume overlay',
    visible: true,
    opacity: 1,
    ref: { type: 'volume', layerId: id },
  };
}

function makeSurfaceItem(): SceneItem {
  return {
    id: 's1',
    kind: 'surface-geometry',
    group: 'surface',
    name: 'fsaverage L',
    subtitle: 'surface geometry',
    visible: true,
    opacity: 1,
    ref: { type: 'surface-geometry', surfaceId: 's1' },
  };
}

/**
 * The bridge from inspectorSelection → layerStore is observable through
 * `layerStore.selectedLayerId`. Asserting on that real state side-effect
 * is more robust than spying on `selectLayer` (immer-zustand's frozen
 * state object refuses spy/restore). We snapshot the state before each
 * test and reset selection after.
 */
describe('inspectorSelectionStore', () => {
  beforeEach(() => {
    useInspectorSelectionStore.getState().clear();
    useLayerStore.getState().selectLayer(null);
  });

  afterEach(() => {
    useInspectorSelectionStore.getState().clear();
    useLayerStore.getState().selectLayer(null);
  });

  it('records the active scene item id and kind', () => {
    useInspectorSelectionStore.getState().setActive(makeVolumeItem('v1'));
    const state = useInspectorSelectionStore.getState();
    expect(state.activeItemId).toBe('v1');
    expect(state.activeItemKind).toBe('volume-overlay');
  });

  it('mirrors volume selection into layerStore.selectedLayerId', () => {
    useInspectorSelectionStore.getState().setActive(makeVolumeItem('v1'));
    expect(useLayerStore.getState().selectedLayerId).toBe('v1');
  });

  it('does not bridge surface selection into layerStore', () => {
    useLayerStore.getState().selectLayer(null);
    useInspectorSelectionStore.getState().setActive(makeSurfaceItem());
    expect(useLayerStore.getState().selectedLayerId).toBeNull();
  });

  it('clear() resets both id and kind', () => {
    useInspectorSelectionStore.getState().setActive(makeVolumeItem('v1'));
    useInspectorSelectionStore.getState().clear();
    const state = useInspectorSelectionStore.getState();
    expect(state.activeItemId).toBeNull();
    expect(state.activeItemKind).toBeNull();
  });

  it('setActive(null) clears selection without changing layerStore', () => {
    useLayerStore.getState().selectLayer(null);
    useInspectorSelectionStore.getState().setActive(null);
    expect(useInspectorSelectionStore.getState().activeItemId).toBeNull();
    expect(useLayerStore.getState().selectedLayerId).toBeNull();
  });
});

describe('focusVolumeLayer (shared scene classifier)', () => {
  beforeEach(() => {
    useLayerStore.getState().clearLayers();
    useInspectorSelectionStore.getState().clear();
  });

  it('classifies a user label map as an atlas item and never as the base', async () => {
    const { focusVolumeLayer } = await import('@/stores/inspectorSelectionStore');
    const add = (layer: object) =>
      useLayerStore.getState().addLayer({ name: 'x', volumeId: 'x', type: 'anatomical', visible: true, order: 0, ...layer } as never);
    add({ id: 'seg', isLabelMap: true });
    add({ id: 't1' });
    focusVolumeLayer('seg');
    expect(useInspectorSelectionStore.getState().activeItemKind).toBe('volume-overlay-atlas');
    focusVolumeLayer('t1');
    expect(useInspectorSelectionStore.getState()).toMatchObject({ activeItemId: 't1', activeItemKind: 'volume-base' });
    expect(useLayerStore.getState().selectedLayerId).toBe('t1');
  });
});

function templateSurface(handle: string, hemisphere: 'left' | 'right'): LoadedSurface {
  return {
    handle,
    name: handle,
    visible: true,
    geometry: {
      vertices: new Float32Array(0),
      faces: new Uint32Array(0),
      hemisphere,
      surfaceType: 'pial',
    },
    layers: new Map(),
    metadata: {
      vertexCount: 0,
      faceCount: 0,
      hemisphere,
      surfaceType: 'pial',
      path: `templateflow://fsaverage6_pial_${hemisphere}`,
    },
  };
}

function surfaceRow(surfaceId: string, layerId?: string): SceneItem {
  return {
    id: layerId ?? surfaceId,
    kind: layerId ? 'surface-overlay' : 'surface-geometry',
    group: 'surface',
    name: surfaceId,
    subtitle: 'surface',
    visible: true,
    opacity: 1,
    ref: layerId
      ? { type: 'surface-overlay', surfaceId, surfaceLayerId: layerId }
      : { type: 'surface-geometry', surfaceId },
  };
}

/**
 * Run 6 N35: an Inspector row click on rh must reach the surface view's
 * selection, which decides the hemisphere camera presets aim at.
 */
describe('inspectorSelectionStore surface mirroring', () => {
  beforeEach(() => {
    useActivePanelStore.setState({ componentType: null, componentState: null });
    useActiveRenderContextStore.setState({ activeId: null });
    useSurfaceStore.setState({
      surfaces: new Map([
        ['lh', templateSurface('lh', 'left')],
        ['rh', templateSurface('rh', 'right')],
        ['other', { ...templateSurface('other', 'right'), metadata: { ...templateSurface('other', 'right').metadata, path: '/elsewhere/other.gii' } }],
      ]),
      surfaceViewSettings: new Map(),
      surfaceViewHandles: new Map(),
      surfaceViewSelections: new Map(),
      activeSurfaceId: null,
      selectedItemType: null,
      selectedLayerId: null,
    });
    // The pair's tab is bound to lh; an unrelated tab shows `other`.
    useSurfaceStore.getState().registerSurfaceView('pair-view', 'lh');
    useSurfaceStore.getState().registerSurfaceView('other-view', 'other');
  });

  it('selecting a surface-geometry row selects it in the views that draw it', () => {
    useInspectorSelectionStore.getState().setActive(surfaceRow('rh'));
    const state = useSurfaceStore.getState();
    expect(state.surfaceViewSelections.get('pair-view')).toEqual({
      activeSurfaceId: 'rh',
      selectedItemType: 'geometry',
      selectedLayerId: null,
    });
    // A view that does not draw rh keeps its own selection.
    expect(state.surfaceViewSelections.get('other-view')?.activeSurfaceId).toBe('other');
    // The tab binding (render anchor) is unchanged.
    expect(state.surfaceViewHandles.get('pair-view')).toBe('lh');
    expect(state.activeSurfaceId).toBe('rh');
  });

  it('a surface-overlay row selects its data layer', () => {
    useInspectorSelectionStore.getState().setActive(surfaceRow('rh', 'overlay-1'));
    expect(useSurfaceStore.getState().surfaceViewSelections.get('pair-view')).toEqual({
      activeSurfaceId: 'rh',
      selectedItemType: 'dataLayer',
      selectedLayerId: 'overlay-1',
    });
  });

  it('a hidden surface only moves the compatibility selection', () => {
    const surfaces = new Map(useSurfaceStore.getState().surfaces);
    surfaces.set('rh', { ...surfaces.get('rh')!, visible: false });
    useSurfaceStore.setState({ surfaces });
    useInspectorSelectionStore.getState().setActive(surfaceRow('rh'));
    const state = useSurfaceStore.getState();
    expect(state.surfaceViewSelections.get('pair-view')?.activeSurfaceId).toBe('lh');
    expect(state.activeSurfaceId).toBe('rh');
  });
});
