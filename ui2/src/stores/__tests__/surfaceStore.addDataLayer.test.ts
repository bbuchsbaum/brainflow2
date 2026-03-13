import { beforeEach, describe, expect, it } from 'vitest';
import { useActivePanelStore } from '@/stores/activePanelStore';
import { useActiveRenderContextStore } from '@/stores/activeRenderContextStore';
import {
  useSurfaceStore,
  type LoadedSurface,
} from '@/stores/surfaceStore';

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
    expect(updatedSurface?.layers.get('layer-1')).toMatchObject({
      id: 'layer-1',
      name: 'Schaefer 200',
      visible: true,
      opacity: 1,
      colormap: 'categorical',
      range: [0, 3],
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
    expect(updatedSurface?.layers.get('layer-1')).toMatchObject({
      opacity: 0.45,
      visible: false,
      range: [1, 2],
    });
  });

  it('removes data layer and clears selection when it is removed', () => {
    const surfaceId = 'surface-1';
    useSurfaceStore.setState({
      surfaces: new Map([[surfaceId, makeSurface(surfaceId)]]),
      activeSurfaceId: surfaceId,
      selectedItemType: 'dataLayer',
      selectedLayerId: 'layer-1',
      surfaceViewHandles: new Map([['view-1', surfaceId]]),
      surfaceViewSelections: new Map([
        ['view-1', {
          activeSurfaceId: surfaceId,
          selectedItemType: 'dataLayer',
          selectedLayerId: 'layer-1',
        }],
      ]),
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
    expect(useSurfaceStore.getState().selectedItemType).toBe('geometry');
    expect(useSurfaceStore.getState().selectedLayerId).toBeNull();
    expect(useSurfaceStore.getState().surfaceViewSelections.get('view-1')).toEqual({
      activeSurfaceId: surfaceId,
      selectedItemType: 'geometry',
      selectedLayerId: null,
    });
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
