import { beforeEach, describe, expect, it } from 'vitest';
import { useSurfaceStore, type LoadedSurface } from '@/stores/surfaceStore';

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
    displayLayers: new Map(),
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
    useSurfaceStore.setState({
      surfaces: new Map(),
      activeSurfaceId: null,
      selectedItemType: null,
      selectedLayerId: null,
      isLoading: false,
      loadError: null,
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
    });

    useSurfaceStore.getState().setSurfaceVisibility('lh', false);

    const state = useSurfaceStore.getState();
    expect(state.surfaces.get('lh')?.visible).toBe(false);
    expect(state.activeSurfaceId).toBe('rh');
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
