import { beforeEach, describe, expect, it } from 'vitest';
import { useSurfaceStore, type LoadedSurface } from '@/stores/surfaceStore';

function makeSurface(handle: string): LoadedSurface {
  return {
    handle,
    name: handle,
    geometry: {
      vertices: new Float32Array(0),
      faces: new Uint32Array(0),
      hemisphere: 'left',
      surfaceType: 'pial',
    },
    layers: new Map(),
    displayLayers: new Map(),
    metadata: {
      vertexCount: 0,
      faceCount: 0,
      hemisphere: 'left',
      surfaceType: 'pial',
      path: `templateflow://${handle}`,
    },
  };
}

describe('surfaceStore.addDataLayer', () => {
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

  it('updates surface layers immutably and defaults visible=true', () => {
    const surfaceId = 'surface-1';
    const originalSurface = makeSurface(surfaceId);
    const originalLayersRef = originalSurface.layers;

    useSurfaceStore.setState({
      surfaces: new Map([[surfaceId, originalSurface]]),
      activeSurfaceId: surfaceId,
    });

    useSurfaceStore.getState().addDataLayer(surfaceId, {
      id: 'layer-1',
      name: 'Schaefer 200',
      values: new Float32Array([1, 2, 3]),
      colormap: 'categorical',
      range: [0, 3],
      dataRange: [0, 3],
      opacity: 1.0,
    });

    const updatedSurface = useSurfaceStore.getState().surfaces.get(surfaceId);
    expect(updatedSurface).toBeDefined();
    expect(updatedSurface).not.toBe(originalSurface);
    expect(updatedSurface?.layers).not.toBe(originalLayersRef);
    expect(originalLayersRef.has('layer-1')).toBe(false);
    expect(updatedSurface?.layers.get('layer-1')?.visible).toBe(true);
  });

  it('no-ops for unknown surfaces', () => {
    const beforeSurfaces = useSurfaceStore.getState().surfaces;

    useSurfaceStore.getState().addDataLayer('missing-surface', {
      id: 'layer-1',
      name: 'noop',
      values: new Float32Array([1]),
      colormap: 'categorical',
      range: [0, 1],
      dataRange: [0, 1],
      opacity: 1.0,
    });

    expect(useSurfaceStore.getState().surfaces).toBe(beforeSurfaces);
  });
});
