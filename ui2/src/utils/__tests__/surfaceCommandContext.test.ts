import { beforeEach, describe, expect, it } from 'vitest';
import { useActivePanelStore } from '@/stores/activePanelStore';
import { useActiveRenderContextStore } from '@/stores/activeRenderContextStore';
import { useSurfaceStore } from '@/stores/surfaceStore';
import {
  applySurfaceSelectionInContext,
  getActiveSurfaceCommandContext,
  resolveSurfaceSelectionViewId,
  resolveSurfaceTargetSurfaceId,
} from '@/utils/surfaceCommandContext';

describe('surfaceCommandContext', () => {
  beforeEach(() => {
    useActivePanelStore.setState({
      componentType: null,
      componentState: null,
    });
    useActiveRenderContextStore.setState({
      activeId: null,
    });
    useSurfaceStore.setState({
      surfaces: new Map(),
      activeSurfaceId: null,
      selectedItemType: null,
      selectedLayerId: null,
      surfaceViewSettings: new Map(),
      surfaceViewHandles: new Map(),
      surfaceViewSelections: new Map(),
      isLoading: false,
      loadError: null,
    });
  });

  it('captures the focused surface view as explicit command context', () => {
    useSurfaceStore.setState({
      surfaces: new Map([
        ['surface-a', { handle: 'surface-a' } as any],
        ['surface-b', { handle: 'surface-b' } as any],
      ]),
      activeSurfaceId: 'surface-a',
      selectedItemType: 'geometry',
      selectedLayerId: null,
      surfaceViewHandles: new Map([
        ['view-a', 'surface-a'],
        ['view-b', 'surface-b'],
      ]),
      surfaceViewSelections: new Map([
        ['view-a', {
          activeSurfaceId: 'surface-a',
          selectedItemType: 'geometry',
          selectedLayerId: null,
        }],
        ['view-b', {
          activeSurfaceId: 'surface-b',
          selectedItemType: 'dataLayer',
          selectedLayerId: 'layer-b',
        }],
      ]),
    });
    useActivePanelStore.setState({
      componentType: 'SurfaceView',
      componentState: {
        surfaceViewId: 'view-b',
        surfaceHandle: 'surface-b',
      },
    });

    expect(getActiveSurfaceCommandContext()).toEqual({
      surfaceViewId: 'view-b',
      explicitSurfaceViewId: 'view-b',
      activeSurfaceId: 'surface-b',
      selectedItemType: 'dataLayer',
      selectedLayerId: 'layer-b',
    });
  });

  it('applies selections to the scoped surface view when one is provided', () => {
    useSurfaceStore.setState({
      activeSurfaceId: 'surface-a',
      selectedItemType: 'geometry',
      selectedLayerId: null,
      surfaceViewHandles: new Map([
        ['view-a', 'surface-a'],
        ['view-b', 'surface-b'],
      ]),
      surfaceViewSelections: new Map([
        ['view-a', {
          activeSurfaceId: 'surface-a',
          selectedItemType: 'geometry',
          selectedLayerId: null,
        }],
        ['view-b', {
          activeSurfaceId: 'surface-b',
          selectedItemType: 'geometry',
          selectedLayerId: null,
        }],
      ]),
    });

    applySurfaceSelectionInContext('surface-b', 'dataLayer', 'layer-b', 'view-b');

    const state = useSurfaceStore.getState();
    expect(state.surfaceViewSelections.get('view-a')).toEqual({
      activeSurfaceId: 'surface-a',
      selectedItemType: 'geometry',
      selectedLayerId: null,
    });
    expect(state.surfaceViewSelections.get('view-b')).toEqual({
      activeSurfaceId: 'surface-b',
      selectedItemType: 'dataLayer',
      selectedLayerId: 'layer-b',
    });
    expect(state.activeSurfaceId).toBe('surface-b');
    expect(state.selectedItemType).toBe('dataLayer');
    expect(state.selectedLayerId).toBe('layer-b');
  });

  it('falls back to the compatibility selection when no surface view is active', () => {
    applySurfaceSelectionInContext('surface-a', 'geometry', null, null);

    expect(useSurfaceStore.getState().activeSurfaceId).toBe('surface-a');
    expect(useSurfaceStore.getState().selectedItemType).toBe('geometry');
    expect(useSurfaceStore.getState().selectedLayerId).toBeNull();
  });

  it('uses compatibility selection when an explicit surface view does not own the target surface', () => {
    useSurfaceStore.setState({
      activeSurfaceId: 'surface-b',
      selectedItemType: 'geometry',
      selectedLayerId: null,
      surfaceViewHandles: new Map([
        ['view-a', 'surface-a'],
        ['view-b', 'surface-b'],
      ]),
      surfaceViewSelections: new Map([
        ['view-a', {
          activeSurfaceId: 'surface-a',
          selectedItemType: 'geometry',
          selectedLayerId: null,
        }],
        ['view-b', {
          activeSurfaceId: 'surface-b',
          selectedItemType: 'geometry',
          selectedLayerId: null,
        }],
      ]),
    });

    applySurfaceSelectionInContext('surface-a', 'geometry', null, 'view-b');

    const state = useSurfaceStore.getState();
    expect(state.activeSurfaceId).toBe('surface-a');
    expect(state.surfaceViewSelections.get('view-b')).toEqual({
      activeSurfaceId: 'surface-b',
      selectedItemType: 'geometry',
      selectedLayerId: null,
    });
  });

  it('resolves a target surface id from context and loaded surfaces', () => {
    const surfaces = new Map<string, { handle: string }>([
      ['surface-a', { handle: 'surface-a' }],
      ['surface-b', { handle: 'surface-b' }],
    ]);

    expect(
      resolveSurfaceTargetSurfaceId(
        {
          activeSurfaceId: 'surface-b',
        },
        surfaces
      )
    ).toBe('surface-b');
    expect(
      resolveSurfaceTargetSurfaceId(
        {
          activeSurfaceId: null,
        },
        surfaces
      )
    ).toBe('surface-a');
  });

  it('only returns a scoped surface view id when that view owns the target surface', () => {
    useSurfaceStore.setState({
      surfaceViewHandles: new Map([
        ['view-a', 'surface-a'],
        ['view-b', 'surface-b'],
      ]),
    });

    expect(resolveSurfaceSelectionViewId('surface-b', 'view-b')).toBe('view-b');
    expect(resolveSurfaceSelectionViewId('surface-a', 'view-b')).toBeNull();
  });
});
