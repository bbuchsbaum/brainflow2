import { beforeEach, describe, expect, it } from 'vitest';
import { useSurfaceStore } from '../surfaceStore';

/**
 * A surface view's geometry choice (pial / white / inflated of its scene):
 * set by the frame's switcher, kept across a remount, cleared when the user
 * selects a different mesh so that mesh is what the view shows.
 */
const VIEW = 'surface-view-1';

function reset() {
  useSurfaceStore.setState({
    surfaceViewSettings: new Map(),
    surfaceViewHandles: new Map(),
    surfaceViewSelections: new Map(),
    surfaceViewViewpoints: new Map(),
    surfaceViewGeometries: new Map(),
    surfaceViewOwners: new Map(),
  });
}

describe('surfaceStore view geometry', () => {
  beforeEach(reset);

  it('sets and clears a view’s geometry without touching others', () => {
    const store = useSurfaceStore.getState();
    store.setSurfaceViewGeometry(VIEW, 'inflated');
    store.setSurfaceViewGeometry('other', 'white');
    expect(useSurfaceStore.getState().surfaceViewGeometries.get(VIEW)).toBe('inflated');
    const before = useSurfaceStore.getState();
    store.setSurfaceViewGeometry(VIEW, 'inflated');
    expect(useSurfaceStore.getState()).toBe(before); // no-op write
    store.setSurfaceViewGeometry(VIEW, null);
    expect(useSurfaceStore.getState().surfaceViewGeometries.has(VIEW)).toBe(false);
    expect(useSurfaceStore.getState().surfaceViewGeometries.get('other')).toBe('white');
  });

  it('keeps the choice while the same mesh stays selected, clears it for another', () => {
    const store = useSurfaceStore.getState();
    store.registerSurfaceView(VIEW, 'lh-pial', 'owner');
    store.setSurfaceViewGeometry(VIEW, 'inflated');
    store.setSurfaceSelectionForView(VIEW, 'lh-pial', 'dataLayer', 'zstat');
    expect(useSurfaceStore.getState().surfaceViewGeometries.get(VIEW)).toBe('inflated');
    store.setSurfaceSelectionForView(VIEW, 'lh-white', 'geometry');
    expect(useSurfaceStore.getState().surfaceViewGeometries.has(VIEW)).toBe(false);
  });

  it('travels with the view across a remount and leaves with it', () => {
    const store = useSurfaceStore.getState();
    store.registerSurfaceView(VIEW, 'lh-pial', 'owner');
    store.setSurfaceViewGeometry(VIEW, 'inflated');
    const snapshot = store.captureSurfaceView(VIEW)!;
    store.unregisterSurfaceView(VIEW, 'owner');
    expect(useSurfaceStore.getState().surfaceViewGeometries.has(VIEW)).toBe(false);
    store.restoreSurfaceView(VIEW, snapshot);
    expect(useSurfaceStore.getState().surfaceViewGeometries.get(VIEW)).toBe('inflated');
  });
});
