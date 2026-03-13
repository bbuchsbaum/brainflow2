import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useVolToSurfProjection } from '../useVolToSurfProjection';
import { useLayerStore } from '@/stores/layerStore';
import { useActivePanelStore } from '@/stores/activePanelStore';
import { useActiveRenderContextStore } from '@/stores/activeRenderContextStore';
import {
  useSurfaceStore,
  createDefaultSurfaceViewSettings,
  type LoadedSurface,
} from '@/stores/surfaceStore';
import { useViewStateStore } from '@/stores/viewStateStore';

const { mockProjectAndDisplay, mockCreateSampler, mockApplySampler } = vi.hoisted(() => ({
  mockProjectAndDisplay: vi.fn(),
  mockCreateSampler: vi.fn(),
  mockApplySampler: vi.fn(),
}));

vi.mock('@/services/VolumeSurfaceProjectionService', () => ({
  getVolumeSurfaceProjectionService: () => ({
    projectAndDisplay: mockProjectAndDisplay,
    createSampler: mockCreateSampler,
    applySampler: mockApplySampler,
  }),
}));

function makeSurface(handle: string): LoadedSurface {
  return {
    handle,
    name: handle,
    visible: true,
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

describe('useVolToSurfProjection', () => {
  beforeEach(() => {
    useActivePanelStore.setState({
      componentType: null,
      componentState: null,
    });
    useActiveRenderContextStore.setState({
      activeId: null,
    });
    useLayerStore.setState({
      layers: [],
      selectedLayerId: null,
      loadingLayers: new Set(),
      errorLayers: new Map(),
      layerMetadata: new Map(),
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
    useViewStateStore.getState().resetToDefaults();
    mockProjectAndDisplay.mockReset();
    mockCreateSampler.mockReset();
    mockApplySampler.mockReset();
  });

  it('derives surface ids from the Map-backed surface store', () => {
    useLayerStore.setState({
      layers: [
        {
          id: 'layer-1',
          name: 'Layer 1',
          type: 'volume',
          volumeId: 'volume-1',
          visible: true,
          order: 0,
        } as any,
      ],
    });
    useSurfaceStore.setState({
      surfaces: new Map([['surface-1', makeSurface('surface-1')]]),
      surfaceViewSettings: new Map([
        ['view-1', {
          lightingSettings: {
            ambientLightIntensity: 0.4,
            directionalLightIntensity: 1,
            fillLightIntensity: 0.5,
            lightPosition: [100, 100, 100],
          },
          displaySettings: {
            wireframe: false,
            opacity: 1,
            smoothing: 0,
            flatShading: false,
          },
          materialSettings: {
            surfaceColor: '#cccccc',
            shininess: 30,
            specularColor: '#ffffff',
            emissiveColor: '#000000',
            emissiveIntensity: 0,
          },
          projectionSettings: {
            useGPUProjection: true,
          },
        }],
      ]),
      surfaceViewHandles: new Map([['view-1', 'surface-1']]),
      activeSurfaceId: 'surface-1',
    });

    const { result } = renderHook(() => useVolToSurfProjection());

    expect(result.current.volumeIds).toEqual(['volume-1']);
    expect(result.current.surfaceIds).toEqual(['surface-1']);
    expect(result.current.canProject).toBe(true);
  });

  it('uses the focused surface view for GPU projection settings instead of the compatibility global', () => {
    useLayerStore.setState({
      layers: [
        {
          id: 'layer-1',
          name: 'Layer 1',
          type: 'volume',
          volumeId: 'volume-1',
          visible: true,
          order: 0,
        } as any,
      ],
    });
    useSurfaceStore.setState({
      surfaces: new Map([
        ['surface-1', makeSurface('surface-1')],
        ['surface-2', makeSurface('surface-2')],
      ]),
      activeSurfaceId: 'surface-1',
      surfaceViewSettings: new Map([
        ['view-1', {
          lightingSettings: {
            ambientLightIntensity: 0.4,
            directionalLightIntensity: 1,
            fillLightIntensity: 0.5,
            lightPosition: [100, 100, 100],
          },
          displaySettings: {
            wireframe: false,
            opacity: 1,
            smoothing: 0,
            flatShading: false,
          },
          materialSettings: {
            surfaceColor: '#cccccc',
            shininess: 30,
            specularColor: '#ffffff',
            emissiveColor: '#000000',
            emissiveIntensity: 0,
          },
          projectionSettings: {
            useGPUProjection: false,
          },
        }],
        ['view-2', {
          lightingSettings: {
            ambientLightIntensity: 0.4,
            directionalLightIntensity: 1,
            fillLightIntensity: 0.5,
            lightPosition: [100, 100, 100],
          },
          displaySettings: {
            wireframe: false,
            opacity: 1,
            smoothing: 0,
            flatShading: false,
          },
          materialSettings: {
            surfaceColor: '#cccccc',
            shininess: 30,
            specularColor: '#ffffff',
            emissiveColor: '#000000',
            emissiveIntensity: 0,
          },
          projectionSettings: {
            useGPUProjection: true,
          },
        }],
      ]),
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

    const { result } = renderHook(() => useVolToSurfProjection());

    expect(result.current.useGPUProjection).toBe(true);
  });

  it('passes the resolved surface view id into projection requests', async () => {
    useLayerStore.setState({
      layers: [
        {
          id: 'layer-1',
          name: 'Layer 1',
          type: 'volume',
          volumeId: 'volume-1',
          visible: true,
          order: 0,
        } as any,
      ],
    });
    useSurfaceStore.setState({
      surfaces: new Map([
        ['surface-1', makeSurface('surface-1')],
        ['surface-2', makeSurface('surface-2')],
      ]),
      activeSurfaceId: 'surface-1',
      surfaceViewSettings: new Map([
        ['view-1', createDefaultSurfaceViewSettings()],
        ['view-2', {
          ...createDefaultSurfaceViewSettings(),
          projectionSettings: {
            useGPUProjection: true,
          },
        }],
      ]),
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
    mockProjectAndDisplay.mockResolvedValue({
      id: 'projection-layer',
      name: 'Projected',
      dataHandle: 'volume-1',
      surfaceId: 'surface-2',
      colormap: 'viridis',
      range: [0, 1],
      opacity: 1,
    });

    const { result } = renderHook(() => useVolToSurfProjection());

    await act(async () => {
      await result.current.projectVolume('volume-1', 'surface-2', 'Projected');
    });

    expect(mockProjectAndDisplay).toHaveBeenCalledWith(
      'volume-1',
      'surface-2',
      'Projected',
      expect.objectContaining({
        surfaceViewId: 'view-2',
        useGPUProjection: true,
      })
    );
  });
});
