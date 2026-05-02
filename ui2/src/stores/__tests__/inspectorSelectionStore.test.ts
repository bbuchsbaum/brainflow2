import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useInspectorSelectionStore } from '@/stores/inspectorSelectionStore';
import { useLayerStore } from '@/stores/layerStore';
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
