import { beforeEach, describe, expect, it } from 'vitest';
import { useActivePanelStore } from '@/stores/activePanelStore';
import { useActiveRenderContextStore } from '@/stores/activeRenderContextStore';
import {
  DEFAULT_SURFACE_VIEW_SETTINGS,
  useSurfaceStore,
} from '@/stores/surfaceStore';

const SURFACE_VIEW_ID = 'surface-view-1';
const SURFACE_HANDLE = 'surface-1';

describe('surfaceStore surface view settings', () => {
  beforeEach(() => {
    useActivePanelStore.setState({
      componentType: null,
      componentState: null,
    });
    useActiveRenderContextStore.setState({
      activeId: null,
    });
    useSurfaceStore.setState({
      surfaceViewSettings: new Map(),
      surfaceViewHandles: new Map(),
      surfaceViewSelections: new Map(),
      activeSurfaceId: null,
      selectedItemType: null,
      selectedLayerId: null,
    });
    useSurfaceStore.getState().registerSurfaceView(SURFACE_VIEW_ID, SURFACE_HANDLE);
  });

  it('registers a surface view with a default geometry selection for its bound surface', () => {
    const state = useSurfaceStore.getState().surfaceViewSelections.get(SURFACE_VIEW_ID);

    expect(state).toEqual({
      activeSurfaceId: SURFACE_HANDLE,
      selectedItemType: 'geometry',
      selectedLayerId: null,
    });
  });

  it('updates display settings without replacing unrelated view settings slices', () => {
    const before = useSurfaceStore.getState().surfaceViewSettings.get(SURFACE_VIEW_ID)!;

    useSurfaceStore.getState().updateSurfaceViewDisplaySettings(SURFACE_VIEW_ID, {
      smoothing: 0.6,
      wireframe: true,
    });

    const after = useSurfaceStore.getState().surfaceViewSettings.get(SURFACE_VIEW_ID)!;
    expect(after.displaySettings).toMatchObject({
      smoothing: 0.6,
      wireframe: true,
      opacity: 1,
      flatShading: false,
    });
    expect(after.displaySettings).not.toBe(before.displaySettings);
    expect(after.lightingSettings).toBe(before.lightingSettings);
    expect(after.materialSettings).toBe(before.materialSettings);
    expect(after.projectionSettings).toBe(before.projectionSettings);
  });

  it('updates projection settings for every registered view bound to a surface', () => {
    const secondViewId = 'surface-view-2';
    useSurfaceStore.getState().registerSurfaceView(secondViewId, SURFACE_HANDLE);

    useSurfaceStore
      .getState()
      .updateSurfaceProjectionSettingsForSurface(SURFACE_HANDLE, { useGPUProjection: true });

    const first = useSurfaceStore.getState().surfaceViewSettings.get(SURFACE_VIEW_ID)!;
    const second = useSurfaceStore.getState().surfaceViewSettings.get(secondViewId)!;
    expect(first.projectionSettings).toEqual({ useGPUProjection: true });
    expect(second.projectionSettings).toEqual({ useGPUProjection: true });
  });

  it('keeps surface selection scoped to the active surface view', () => {
    const secondViewId = 'surface-view-2';
    useSurfaceStore.getState().registerSurfaceView(secondViewId, 'surface-2');

    useActiveRenderContextStore.setState({
      activeId: 'surfaceview:surface-1:surface-view-1',
    });
    useSurfaceStore.getState().setActiveSurface('surface-1');
    useSurfaceStore.getState().setSelectedItem('dataLayer', 'layer-a');

    useActiveRenderContextStore.setState({
      activeId: 'surfaceview:surface-2:surface-view-2',
    });
    useSurfaceStore.getState().setActiveSurface('surface-2');

    const state = useSurfaceStore.getState();
    expect(state.surfaceViewSelections.get(SURFACE_VIEW_ID)).toEqual({
      activeSurfaceId: 'surface-1',
      selectedItemType: 'dataLayer',
      selectedLayerId: 'layer-a',
    });
    expect(state.surfaceViewSelections.get(secondViewId)).toEqual({
      activeSurfaceId: 'surface-2',
      selectedItemType: 'geometry',
      selectedLayerId: null,
    });
  });

  it('does not back-propagate compatibility selection into a merely bound surface view', () => {
    const secondViewId = 'surface-view-2';
    useSurfaceStore.getState().registerSurfaceView(secondViewId, 'surface-2');

    useSurfaceStore.getState().setCompatibilitySelection('surface-2', 'dataLayer', 'layer-b');

    const state = useSurfaceStore.getState();
    expect(state.activeSurfaceId).toBe('surface-2');
    expect(state.selectedItemType).toBe('dataLayer');
    expect(state.selectedLayerId).toBe('layer-b');
    expect(state.surfaceViewSelections.get(SURFACE_VIEW_ID)).toEqual({
      activeSurfaceId: SURFACE_HANDLE,
      selectedItemType: 'geometry',
      selectedLayerId: null,
    });
    expect(state.surfaceViewSelections.get(secondViewId)).toEqual({
      activeSurfaceId: 'surface-2',
      selectedItemType: 'geometry',
      selectedLayerId: null,
    });
  });

  it('keeps compatibility selection separate even when a different surface view is explicitly focused', () => {
    const secondViewId = 'surface-view-2';
    useSurfaceStore.getState().registerSurfaceView(secondViewId, 'surface-2');
    useActiveRenderContextStore.setState({
      activeId: 'surfaceview:surface-2:surface-view-2',
    });

    useSurfaceStore.getState().setCompatibilitySelection('surface-1', 'geometry');

    const state = useSurfaceStore.getState();
    expect(state.activeSurfaceId).toBe('surface-1');
    expect(state.surfaceViewSelections.get(secondViewId)).toEqual({
      activeSurfaceId: 'surface-2',
      selectedItemType: 'geometry',
      selectedLayerId: null,
    });
  });

  it('activates a surface view by mirroring its scoped selection into legacy globals', () => {
    const secondViewId = 'surface-view-2';
    useSurfaceStore.getState().registerSurfaceView(secondViewId, 'surface-2');
    useSurfaceStore
      .getState()
      .setSurfaceSelectionForView(secondViewId, 'surface-2', 'dataLayer', 'layer-b');

    useSurfaceStore.getState().activateSurfaceView(secondViewId);

    const state = useSurfaceStore.getState();
    expect(state.activeSurfaceId).toBe('surface-2');
    expect(state.selectedItemType).toBe('dataLayer');
    expect(state.selectedLayerId).toBe('layer-b');
  });

  it('updates lighting and material settings independently for a single view', () => {
    useSurfaceStore.getState().updateSurfaceViewLightingSettings(SURFACE_VIEW_ID, {
      directionalLightIntensity: 1.7,
    });
    useSurfaceStore.getState().updateSurfaceViewMaterialSettings(SURFACE_VIEW_ID, {
      surfaceColor: '#112233',
      shininess: 88,
    });

    const state = useSurfaceStore.getState().surfaceViewSettings.get(SURFACE_VIEW_ID)!;
    expect(state.lightingSettings.directionalLightIntensity).toBe(1.7);
    expect(state.materialSettings).toMatchObject({
      surfaceColor: '#112233',
      shininess: 88,
      specularColor: '#ffffff',
    });
    expect(state.displaySettings).toEqual(DEFAULT_SURFACE_VIEW_SETTINGS.displaySettings);
    expect(state.projectionSettings).toEqual(DEFAULT_SURFACE_VIEW_SETTINGS.projectionSettings);
  });

  it('unregisters a surface view and removes its settings binding', () => {
    useSurfaceStore.getState().unregisterSurfaceView(SURFACE_VIEW_ID);

    const state = useSurfaceStore.getState();
    expect(state.surfaceViewSettings.has(SURFACE_VIEW_ID)).toBe(false);
    expect(state.surfaceViewHandles.has(SURFACE_VIEW_ID)).toBe(false);
    expect(state.surfaceViewSelections.has(SURFACE_VIEW_ID)).toBe(false);
  });
});
