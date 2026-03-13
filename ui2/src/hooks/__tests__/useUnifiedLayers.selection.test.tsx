import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUnifiedLayers } from '@/hooks/useUnifiedLayers';

const {
  mockSelectLayerInStore,
  mockApplySurfaceSelectionInContext,
  layerStoreState,
  surfaceStoreState,
  mockUnifiedLayerService,
} = vi.hoisted(() => ({
  mockSelectLayerInStore: vi.fn(),
  mockApplySurfaceSelectionInContext: vi.fn(),
  layerStoreState: {
    layers: [] as Array<Record<string, unknown>>,
    selectedLayerId: null as string | null,
    selectLayer: vi.fn(),
  },
  surfaceStoreState: {
    surfaces: new Map<string, unknown>(),
  },
  mockUnifiedLayerService: {
    getAllLayers: vi.fn(() => []),
    getVolumeLayers: vi.fn(() => []),
    getSurfaceLayers: vi.fn(() => []),
    getVol2SurfLayers: vi.fn(() => []),
    getLayerById: vi.fn(),
    updateLayerProperty: vi.fn(),
    toggleLayerVisibility: vi.fn(),
    removeLayer: vi.fn(),
    createVol2SurfMapping: vi.fn(),
    getAvailableVolumesForMapping: vi.fn(() => []),
    getAvailableSurfacesForMapping: vi.fn(() => []),
  },
}));

vi.mock('@/stores/layerStore', () => ({
  useLayerStore: vi.fn((selector) => {
    const state = {
      ...layerStoreState,
      selectLayer: mockSelectLayerInStore,
    };
    return selector ? selector(state) : state;
  }),
}));

vi.mock('@/stores/surfaceStore', () => ({
  useSurfaceStore: vi.fn((selector) => {
    return selector ? selector(surfaceStoreState) : surfaceStoreState;
  }),
}));

vi.mock('@/utils/surfaceCommandContext', () => ({
  applySurfaceSelectionInContext: mockApplySurfaceSelectionInContext,
}));

vi.mock('@/services/UnifiedLayerService', () => ({
  UnifiedLayerService: {
    getInstance: () => mockUnifiedLayerService,
  },
  unifiedLayerService: mockUnifiedLayerService,
  isVolumeLayer: (layer: any) => layer.type === 'volume',
  isSurfaceLayer: (layer: any) => layer.type === 'surface',
  isVol2SurfLayer: (layer: any) => layer.type === 'surface' && !!layer.sourceVolumeId,
}));

describe('useUnifiedLayers selection routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    layerStoreState.layers = [];
    layerStoreState.selectedLayerId = null;
    surfaceStoreState.surfaces = new Map();
    mockUnifiedLayerService.getAllLayers.mockReturnValue([]);
  });

  it('routes surface selection through the shared surface selection helper without targeting a surface view', () => {
    const surfaceLayer = {
      id: 'surface-1',
      type: 'surface',
      name: 'Surface 1',
      visible: true,
      opacity: 1,
      data: {},
    };
    mockUnifiedLayerService.getAllLayers.mockReturnValue([surfaceLayer]);

    const { result } = renderHook(() => useUnifiedLayers());

    act(() => {
      result.current.selectLayer('surface-1');
    });

    expect(mockSelectLayerInStore).toHaveBeenCalledWith(null);
    expect(mockApplySurfaceSelectionInContext).toHaveBeenCalledWith('surface-1', 'geometry', null, null);
  });

  it('keeps volume selection on the volume layer store path', () => {
    const volumeLayer = {
      id: 'volume-1',
      type: 'volume',
      name: 'Volume 1',
      visible: true,
      opacity: 1,
      data: {},
    };
    mockUnifiedLayerService.getAllLayers.mockReturnValue([volumeLayer]);

    const { result } = renderHook(() => useUnifiedLayers());

    act(() => {
      result.current.selectLayer('volume-1');
    });

    expect(mockSelectLayerInStore).toHaveBeenCalledWith('volume-1');
    expect(mockApplySurfaceSelectionInContext).not.toHaveBeenCalled();
  });
});
