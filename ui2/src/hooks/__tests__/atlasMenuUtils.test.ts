import { beforeEach, describe, expect, it } from 'vitest';
import { useActivePanelStore } from '@/stores/activePanelStore';
import { useActiveRenderContextStore } from '@/stores/activeRenderContextStore';
import { useSurfaceStore, type LoadedSurface } from '@/stores/surfaceStore';
import { inferPreferredSurfaceType } from '../atlasMenuUtils';

function makeSurface(
  handle: string,
  surfaceType: 'pial' | 'white' | 'inflated'
): LoadedSurface {
  return {
    handle,
    name: handle,
    visible: true,
    geometry: {
      vertices: new Float32Array(0),
      faces: new Uint32Array(0),
      hemisphere: 'left',
      surfaceType,
    },
    layers: new Map(),
    metadata: {
      vertexCount: 0,
      faceCount: 0,
      hemisphere: 'left',
      surfaceType,
      path: `templateflow://${handle}`,
    },
  };
}

describe('inferPreferredSurfaceType', () => {
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

  it('prefers the focused surface view selection over the compatibility global', () => {
    useSurfaceStore.setState({
      surfaces: new Map([
        ['surface-1', makeSurface('surface-1', 'pial')],
        ['surface-2', makeSurface('surface-2', 'inflated')],
      ]),
      activeSurfaceId: 'surface-1',
      surfaceViewHandles: new Map([
        ['view-1', 'surface-1'],
        ['view-2', 'surface-2'],
      ]),
      surfaceViewSelections: new Map([
        ['view-1', {
          activeSurfaceId: 'surface-1',
          selectedItemType: 'geometry',
          selectedLayerId: null,
        }],
        ['view-2', {
          activeSurfaceId: 'surface-2',
          selectedItemType: 'geometry',
          selectedLayerId: null,
        }],
      ]),
    });
    useActivePanelStore.setState({
      componentType: 'SurfaceView',
      componentState: {
        surfaceViewId: 'view-2',
        surfaceHandle: 'surface-2',
      },
    });

    expect(inferPreferredSurfaceType()).toBe('inflated');
  });
});
