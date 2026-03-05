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
    expect(updatedSurface?.displayLayers.get('layer-1')).toMatchObject({
      id: 'layer-1',
      name: 'Schaefer 200',
      type: 'scalar',
      visible: true,
      opacity: 1,
      colormap: 'categorical',
      intensity: [0, 3],
    });
  });

  it('keeps derived display layer synchronized on property updates', () => {
    const surfaceId = 'surface-1';
    useSurfaceStore.setState({
      surfaces: new Map([[surfaceId, makeSurface(surfaceId)]]),
      activeSurfaceId: surfaceId,
    });

    useSurfaceStore.getState().addDataLayer(surfaceId, {
      id: 'layer-1',
      name: 'sync-target',
      values: new Float32Array([1, 2, 3]),
      colormap: 'viridis',
      range: [0, 3],
      dataRange: [0, 3],
      opacity: 1.0,
    });

    useSurfaceStore.getState().updateLayerProperty(surfaceId, 'layer-1', 'opacity', 0.45);
    useSurfaceStore.getState().updateLayerProperty(surfaceId, 'layer-1', 'visible', false);
    useSurfaceStore.getState().updateLayerProperty(surfaceId, 'layer-1', 'range', [1, 2]);

    const updatedSurface = useSurfaceStore.getState().surfaces.get(surfaceId);
    expect(updatedSurface?.layers.get('layer-1')?.opacity).toBe(0.45);
    expect(updatedSurface?.layers.get('layer-1')?.visible).toBe(false);
    expect(updatedSurface?.displayLayers.get('layer-1')).toMatchObject({
      opacity: 0.45,
      visible: false,
      intensity: [1, 2],
    });
  });

  it('removes display layer mirror when data layer is removed', () => {
    const surfaceId = 'surface-1';
    useSurfaceStore.setState({
      surfaces: new Map([[surfaceId, makeSurface(surfaceId)]]),
      activeSurfaceId: surfaceId,
      selectedItemType: 'dataLayer',
      selectedLayerId: 'layer-1',
    });

    useSurfaceStore.getState().addDataLayer(surfaceId, {
      id: 'layer-1',
      name: 'to-remove',
      values: new Float32Array([1]),
      colormap: 'viridis',
      range: [0, 1],
      dataRange: [0, 1],
      opacity: 1,
    });

    useSurfaceStore.getState().removeDataLayer(surfaceId, 'layer-1');

    const updatedSurface = useSurfaceStore.getState().surfaces.get(surfaceId);
    expect(updatedSurface?.layers.has('layer-1')).toBe(false);
    expect(updatedSurface?.displayLayers.has('layer-1')).toBe(false);
    expect(useSurfaceStore.getState().selectedItemType).toBeNull();
    expect(useSurfaceStore.getState().selectedLayerId).toBeNull();
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
