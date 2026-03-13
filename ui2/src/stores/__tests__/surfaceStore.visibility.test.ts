import { beforeEach, describe, expect, it } from 'vitest';
import { useActivePanelStore } from '@/stores/activePanelStore';
import { useActiveRenderContextStore } from '@/stores/activeRenderContextStore';
import {
  useSurfaceStore,
  type LoadedSurface,
} from '@/stores/surfaceStore';

function makeSurface(handle: string, hemisphere: 'left' | 'right'): LoadedSurface {
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
      path: `templateflow://fsaverage_pial_${hemisphere}`,
    },
  };
}

describe('surfaceStore.setSurfaceVisibility', () => {
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
      isLoading: false,
      loadError: null,
      surfaceViewSettings: new Map(),
      surfaceViewHandles: new Map(),
      surfaceViewSelections: new Map(),
    });
  });

  it('falls back active surface when hiding current active', () => {
    const left = makeSurface('lh', 'left');
    const right = makeSurface('rh', 'right');

    useSurfaceStore.setState({
      surfaces: new Map([
        ['lh', left],
        ['rh', right],
      ]),
      activeSurfaceId: 'lh',
      selectedItemType: 'dataLayer',
      selectedLayerId: 'layer-lh',
      surfaceViewHandles: new Map([['view-1', 'lh']]),
      surfaceViewSelections: new Map([
        ['view-1', {
          activeSurfaceId: 'lh',
          selectedItemType: 'dataLayer',
          selectedLayerId: 'layer-lh',
        }],
      ]),
    });

    useSurfaceStore.getState().setSurfaceVisibility('lh', false);

    const state = useSurfaceStore.getState();
    expect(state.surfaces.get('lh')?.visible).toBe(false);
    expect(state.activeSurfaceId).toBe('rh');
    expect(state.selectedItemType).toBe('geometry');
    expect(state.selectedLayerId).toBeNull();
    expect(state.surfaceViewSelections.get('view-1')).toEqual({
      activeSurfaceId: 'rh',
      selectedItemType: 'geometry',
      selectedLayerId: null,
    });
  });

  it('activates a surface when made visible and no active selection exists', () => {
    const left = makeSurface('lh', 'left');
    left.visible = false;

    useSurfaceStore.setState({
      surfaces: new Map([['lh', left]]),
      activeSurfaceId: null,
    });

    useSurfaceStore.getState().setSurfaceVisibility('lh', true);

    const state = useSurfaceStore.getState();
    expect(state.surfaces.get('lh')?.visible).toBe(true);
    expect(state.activeSurfaceId).toBe('lh');
  });
});
