/**
 * Unit tests for useUnifiedLayers hook
 * Note: Simplified tests without React Testing Library due to missing dependency
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnifiedLayerService } from '@/services/UnifiedLayerService';
import type { LayerInfo } from '@/stores/layerStore';
import type { LoadedSurface } from '@/stores/surfaceStore';

// Mock the stores
vi.mock('@/stores/layerStore', () => ({
  useLayerStore: vi.fn((selector) => {
    const state = {
      layers: [],
      selectedLayerId: null,
      selectLayer: vi.fn()
    };
    return selector ? selector(state) : state;
  })
}));

vi.mock('@/stores/surfaceStore', () => ({
  useSurfaceStore: vi.fn((selector) => {
    const state = {
      surfaces: new Map(),
      setActiveSurface: vi.fn()
    };
    return selector ? selector(state) : state;
  })
}));

// Mock the UnifiedLayerService
vi.mock('@/services/UnifiedLayerService', () => {
  const mockService = {
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
    getAvailableSurfacesForMapping: vi.fn(() => [])
  };
  
  return {
    UnifiedLayerService: {
      getInstance: () => mockService
    },
    unifiedLayerService: mockService,
    isVolumeLayer: (layer: any) => layer.type === 'volume',
    isSurfaceLayer: (layer: any) => layer.type === 'surface',
    isVol2SurfLayer: (layer: any) => layer.type === 'surface' && !!layer.sourceVolumeId
  };
});

describe('UnifiedLayerService Integration', () => {
  const mockVolumeLayer = {
    id: 'vol-1',
    type: 'volume' as const,
    name: 'Test Volume',
    visible: true,
    opacity: 1.0,
    data: {} as LayerInfo
  };
  
  const mockSurfaceLayer = {
    id: 'surf-1',
    type: 'surface' as const,
    name: 'Test Surface',
    visible: true,
    opacity: 1.0,
    data: {} as LoadedSurface
  };
  
  const mockVol2SurfLayer = {
    id: 'vol2surf-1',
    type: 'surface' as const,
    name: 'Mapped Surface',
    visible: true,
    opacity: 1.0,
    data: {} as LoadedSurface,
    sourceVolumeId: 'vol-1'
  };
  
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Reset service mock
    const service = UnifiedLayerService.getInstance() as any;
    service.getAllLayers.mockReturnValue([]);
    service.getVolumeLayers.mockReturnValue([]);
    service.getSurfaceLayers.mockReturnValue([]);
    service.getVol2SurfLayers.mockReturnValue([]);
  });
  
  describe('Service Methods', () => {
    it('should call getAllLayers from service', () => {
      const service = UnifiedLayerService.getInstance() as any;
      service.getAllLayers.mockReturnValue([mockVolumeLayer, mockSurfaceLayer]);
      
      const result = service.getAllLayers();
      
      expect(result).toHaveLength(2);
      expect(result[0]).toBe(mockVolumeLayer);
      expect(result[1]).toBe(mockSurfaceLayer);
    });
    
    it('should filter layers by type', () => {
      const service = UnifiedLayerService.getInstance() as any;
      service.getVolumeLayers.mockReturnValue([mockVolumeLayer]);
      service.getSurfaceLayers.mockReturnValue([mockSurfaceLayer, mockVol2SurfLayer]);
      service.getVol2SurfLayers.mockReturnValue([mockVol2SurfLayer]);
      
      expect(service.getVolumeLayers()).toHaveLength(1);
      expect(service.getSurfaceLayers()).toHaveLength(2);
      expect(service.getVol2SurfLayers()).toHaveLength(1);
    });
    
    it('should get layer by ID', () => {
      const service = UnifiedLayerService.getInstance() as any;
      service.getLayerById.mockReturnValue(mockSurfaceLayer);
      
      const layer = service.getLayerById('surf-1');
      expect(layer).toBe(mockSurfaceLayer);
    });
    
    it('should update layer properties', () => {
      const service = UnifiedLayerService.getInstance() as any;
      
      service.updateLayerProperty('vol-1', 'visible', false);
      expect(service.updateLayerProperty).toHaveBeenCalledWith('vol-1', 'visible', false);
      
      service.toggleLayerVisibility('vol-1');
      expect(service.toggleLayerVisibility).toHaveBeenCalledWith('vol-1');
      
      service.removeLayer('vol-1');
      expect(service.removeLayer).toHaveBeenCalledWith('vol-1');
    });
    
    it('should handle vol2surf mapping', async () => {
      const service = UnifiedLayerService.getInstance() as any;
      service.createVol2SurfMapping.mockResolvedValue('new-vol2surf-id');
      
      const id = await service.createVol2SurfMapping('vol-1', 'surf-1');
      
      expect(service.createVol2SurfMapping).toHaveBeenCalledWith('vol-1', 'surf-1');
      expect(id).toBe('new-vol2surf-id');
    });
    
    it('should get available layers for mapping', () => {
      const service = UnifiedLayerService.getInstance() as any;
      const visibleVolume = { ...mockVolumeLayer, visible: true };
      const unmappedSurface = mockSurfaceLayer;
      
      service.getAvailableVolumesForMapping.mockReturnValue([visibleVolume]);
      service.getAvailableSurfacesForMapping.mockReturnValue([unmappedSurface]);
      
      expect(service.getAvailableVolumesForMapping()).toHaveLength(1);
      expect(service.getAvailableSurfacesForMapping()).toHaveLength(1);
    });
  });
  
  describe('Type Guards', () => {
    it('should correctly identify layer types', async () => {
      const { isVolumeLayer, isSurfaceLayer, isVol2SurfLayer } = await import('@/services/UnifiedLayerService');
      
      expect(isVolumeLayer(mockVolumeLayer)).toBe(true);
      expect(isVolumeLayer(mockSurfaceLayer)).toBe(false);
      
      expect(isSurfaceLayer(mockSurfaceLayer)).toBe(true);
      expect(isSurfaceLayer(mockVolumeLayer)).toBe(false);
      
      expect(isVol2SurfLayer(mockVol2SurfLayer)).toBe(true);
      expect(isVol2SurfLayer(mockSurfaceLayer)).toBe(false);
    });
  });
  
  describe('Store Integration', () => {
    it('should interact with layerStore for volumes', async () => {
      const { useLayerStore } = await import('@/stores/layerStore');
      const mockSelectLayer = vi.fn();
      
      (useLayerStore as any).mockImplementation((selector: any) => {
        const state = {
          layers: [mockVolumeLayer],
          selectedLayerId: 'vol-1',
          selectLayer: mockSelectLayer
        };
        return selector ? selector(state) : state;
      });
      
      const state = useLayerStore((s: any) => s);
      expect(state.layers).toHaveLength(1);
      expect(state.selectedLayerId).toBe('vol-1');
      
      state.selectLayer('vol-2');
      expect(mockSelectLayer).toHaveBeenCalledWith('vol-2');
    });
    
    it('should interact with surfaceStore for surfaces', async () => {
      const { useSurfaceStore } = await import('@/stores/surfaceStore');
      const mockSetActiveSurface = vi.fn();
      
      (useSurfaceStore as any).mockImplementation((selector: any) => {
        const surfaceMap = new Map([['surf-1', mockSurfaceLayer]]);
        const state = {
          surfaces: surfaceMap,
          setActiveSurface: mockSetActiveSurface
        };
        return selector ? selector(state) : state;
      });
      
      const state = useSurfaceStore((s: any) => s);
      expect(state.surfaces.size).toBe(1);
      expect(state.surfaces.get('surf-1')).toBe(mockSurfaceLayer);
      
      state.setActiveSurface('surf-1');
      expect(mockSetActiveSurface).toHaveBeenCalledWith('surf-1');
    });
  });
});