import { beforeEach, describe, expect, it } from 'vitest';
import { useSurfaceStore } from '../surfaceStore';

/**
 * Review W2/M6 (QA 2026-10-29 fix wave): Reset layout remounts surface tabs
 * with the same surfaceViewId, and the old panel unmounts afterwards. Its
 * cleanup must not wipe the live tab; a re-pressed preset refits one tab.
 */
const VIEW = 'surface-view-1';
const HANDLE = 'surface-1';

function reset() {
  useSurfaceStore.setState({
    surfaceViewSettings: new Map(),
    surfaceViewHandles: new Map(),
    surfaceViewSelections: new Map(),
    surfaceViewViewpoints: new Map(),
    surfaceViewOwners: new Map(),
    surfaceViewViewpointNonces: new Map(),
    viewpointNonce: 0,
  });
}

describe('surfaceStore view ownership', () => {
  beforeEach(reset);

  it("an old owner's late cleanup leaves the remounted tab registered", () => {
    const store = useSurfaceStore.getState();
    store.registerSurfaceView(VIEW, HANDLE, 'old');
    store.registerSurfaceView(VIEW, HANDLE, 'new'); // remount claims the id first
    useSurfaceStore.getState().unregisterSurfaceView(VIEW, 'old');
    const state = useSurfaceStore.getState();
    expect(state.surfaceViewHandles.get(VIEW)).toBe(HANDLE);
    expect(state.surfaceViewSettings.has(VIEW)).toBe(true);

    useSurfaceStore.getState().unregisterSurfaceView(VIEW, 'new');
    expect(useSurfaceStore.getState().surfaceViewHandles.has(VIEW)).toBe(false);
  });

  it('re-registering keeps per-view settings', () => {
    const store = useSurfaceStore.getState();
    store.registerSurfaceView(VIEW, HANDLE, 'old');
    store.updateSurfaceViewDisplaySettings(VIEW, { wireframe: true });
    const before = useSurfaceStore.getState().surfaceViewSettings.get(VIEW);
    useSurfaceStore.getState().registerSurfaceView(VIEW, HANDLE, 'new');
    expect(useSurfaceStore.getState().surfaceViewSettings.get(VIEW)).toBe(before);
  });

  it('capture/restore carries settings, selection and viewpoint across an unmount in either order', () => {
    const store = useSurfaceStore.getState();
    store.registerSurfaceView(VIEW, HANDLE, 'old');
    store.updateSurfaceViewDisplaySettings(VIEW, { wireframe: true });
    store.setViewpoint('medial', VIEW);
    const snapshot = useSurfaceStore.getState().captureSurfaceView(VIEW)!;
    const settings = useSurfaceStore.getState().surfaceViewSettings.get(VIEW);
    expect(snapshot).not.toBeNull();

    // Old panel unmounts before the reset restores (worst case) ...
    useSurfaceStore.getState().unregisterSurfaceView(VIEW, 'old');
    useSurfaceStore.getState().restoreSurfaceView(VIEW, snapshot);
    // ... or after: restored entries are unowned, so 'old' cannot remove them.
    useSurfaceStore.getState().unregisterSurfaceView(VIEW, 'old');
    useSurfaceStore.getState().registerSurfaceView(VIEW, HANDLE, 'new');

    const state = useSurfaceStore.getState();
    expect(state.surfaceViewSettings.get(VIEW)).toEqual(settings);
    expect(state.surfaceViewViewpoints.get(VIEW)).toBe('medial');
    expect(state.surfaceViewHandles.get(VIEW)).toBe(HANDLE);
    expect(state.surfaceViewOwners.get(VIEW)).toBe('new');
  });

  it('captures nothing for an unknown view', () => {
    expect(useSurfaceStore.getState().captureSurfaceView('missing')).toBeNull();
  });
});

describe('surfaceStore.reapplyViewpoint', () => {
  beforeEach(reset);

  it('bumps only the named view (re-pressing a preset in tab A does not refit tab B)', () => {
    useSurfaceStore.getState().reapplyViewpoint('A');
    const state = useSurfaceStore.getState();
    expect(state.surfaceViewViewpointNonces.get('A')).toBe(1);
    expect(state.surfaceViewViewpointNonces.get('B')).toBeUndefined();
    expect(state.viewpointNonce).toBe(0);
  });

  it('without an id still bumps every view', () => {
    useSurfaceStore.getState().reapplyViewpoint();
    expect(useSurfaceStore.getState().viewpointNonce).toBe(1);
  });
});
