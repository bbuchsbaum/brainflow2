/**
 * Unit tests for UnifiedLayerService facade
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnifiedLayerService, unifiedLayerService, isVolumeLayer, isSurfaceLayer, isVol2SurfLayer } from '../UnifiedLayerService';
import { useLayerStore } from '@/stores/layerStore';
import { useSurfaceStore } from '@/stores/surfaceStore';
import type { LayerInfo } from '@/stores/layerStore';
import type { LoadedSurface } from '@/stores/surfaceStore';

// Mock the stores
vi.mock('@/stores/layerStore', () => ({
  useLayerStore: {
    getState: vi.fn()
  }
}));

vi.mock('@/stores/surfaceStore', () => ({
  useSurfaceStore: {
    getState: vi.fn()
  }
}));

vi.mock('nanoid', () => ({
  nanoid: () => 'test-id-123'
}));

describe('UnifiedLayerService', () => {
  let service: UnifiedLayerService;
  
  // Mock data
  const mockVolumeLayer: LayerInfo = {
    id: 'vol-1',
    name: 'Test Volume',
    volumeId: 'volume-handle-1',
    visible: true,
    selected: false
  };
  
  const mockSurface: LoadedSurface = {
    handle: 'surf-1',
    name: 'Test Surface',
    geometry: {
      vertices: new Float32Array([]),
      faces: new Uint32Array([]),
      normals: new Float32Array([])
    },
    metadata: {}
  };
  
  const mockVol2Surface: LoadedSurface = {
    handle: 'vol2surf-1',
    name: 'Mapped Surface',
    geometry: {
      vertices: new Float32Array([]),
      faces: new Uint32Array([]),
      normals: new Float32Array([])
    },
    metadata: {
      sourceVolumeId: 'vol-1',
      mappingOptions: {
        method: 'nearest',
        projectionDepth: 0,
        smoothingKernel: 0
      }
    }
  };
  
  beforeEach(() => {
    vi.clearAllMocks();
    service = UnifiedLayerService.getInstance();
    
    // Setup default mock returns
    (useLayerStore.getState as any).mockReturnValue({
      layers: [],
      updateLayer: vi.fn(),
      removeLayer: vi.fn()
    });
    
    (useSurfaceStore.getState as any).mockReturnValue({
      surfaces: new Map(),
      removeSurface: vi.fn(),
      updateLayerProperty: vi.fn()
    });
  });
  
  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      const instance1 = UnifiedLayerService.getInstance();
      const instance2 = UnifiedLayerService.getInstance();
      expect(instance1).toBe(instance2);
    });
    
    it('should export singleton instance', () => {
      expect(unifiedLayerService).toBe(UnifiedLayerService.getInstance());
    });
  });
  
  describe('getAllLayers', () => {
    it('should return empty array when no layers exist', () => {
      const layers = service.getAllLayers();
      expect(layers).toEqual([]);
    });
    
    it('should combine volume and surface layers', () => {
      const surfaceMap = new Map([['surf-1', mockSurface]]);
      
      (useLayerStore.getState as any).mockReturnValue({
        layers: [mockVolumeLayer]
      });
      
      (useSurfaceStore.getState as any).mockReturnValue({
        surfaces: surfaceMap
      });
      
      const layers = service.getAllLayers();
      
      expect(layers).toHaveLength(2);
      expect(layers[0].type).toBe('volume');
      expect(layers[0].id).toBe('vol-1');
      expect(layers[1].type).toBe('surface');
      expect(layers[1].id).toBe('surf-1');
    });
    
    it('should properly format volume layers', () => {
      (useLayerStore.getState as any).mockReturnValue({
        layers: [mockVolumeLayer]
      });
      
      const layers = service.getAllLayers();
      const volumeLayer = layers[0];
      
      expect(volumeLayer).toEqual({
        id: 'vol-1',
        type: 'volume',
        name: 'Test Volume',
        visible: true,
        opacity: 1.0,
        data: mockVolumeLayer
      });
    });
    
    it('should properly format surface layers', () => {
      const surfaceMap = new Map([['surf-1', mockSurface]]);
      
      (useSurfaceStore.getState as any).mockReturnValue({
        surfaces: surfaceMap
      });
      
      const layers = service.getAllLayers();
      const surfaceLayer = layers[0];
      
      expect(surfaceLayer).toEqual({
        id: 'surf-1',
        type: 'surface',
        name: 'Test Surface',
        visible: true,
        opacity: 1.0,
        data: mockSurface,
        sourceVolumeId: undefined
      });
    });
    
    it('should detect vol2surf layers', () => {
      const surfaceMap = new Map([['vol2surf-1', mockVol2Surface]]);
      
      (useSurfaceStore.getState as any).mockReturnValue({
        surfaces: surfaceMap
      });
      
      const layers = service.getAllLayers();
      const vol2surfLayer = layers[0];
      
      expect(vol2surfLayer.sourceVolumeId).toBe('vol-1');
      expect(isVol2SurfLayer(vol2surfLayer)).toBe(true);
    });
  });
  
  describe('Type Guards', () => {
    it('isVolumeLayer should correctly identify volume layers', () => {
      const volumeLayer = {
        id: 'vol-1',
        type: 'volume' as const,
        name: 'Test',
        visible: true,
        opacity: 1,
        data: {} as LayerInfo
      };
      
      const surfaceLayer = {
        id: 'surf-1',
        type: 'surface' as const,
        name: 'Test',
        visible: true,
        opacity: 1,
        data: {} as LoadedSurface
      };
      
      expect(isVolumeLayer(volumeLayer)).toBe(true);
      expect(isVolumeLayer(surfaceLayer)).toBe(false);
    });
    
    it('isSurfaceLayer should correctly identify surface layers', () => {
      const volumeLayer = {
        id: 'vol-1',
        type: 'volume' as const,
        name: 'Test',
        visible: true,
        opacity: 1,
        data: {} as LayerInfo
      };
      
      const surfaceLayer = {
        id: 'surf-1',
        type: 'surface' as const,
        name: 'Test',
        visible: true,
        opacity: 1,
        data: {} as LoadedSurface
      };
      
      expect(isSurfaceLayer(surfaceLayer)).toBe(true);
      expect(isSurfaceLayer(volumeLayer)).toBe(false);
    });
    
    it('isVol2SurfLayer should identify surfaces with source volumes', () => {
      const regularSurface = {
        id: 'surf-1',
        type: 'surface' as const,
        name: 'Test',
        visible: true,
        opacity: 1,
        data: {} as LoadedSurface
      };
      
      const vol2surfLayer = {
        id: 'vol2surf-1',
        type: 'surface' as const,
        name: 'Test',
        visible: true,
        opacity: 1,
        data: {} as LoadedSurface,
        sourceVolumeId: 'vol-1'
      };
      
      expect(isVol2SurfLayer(regularSurface)).toBe(false);
      expect(isVol2SurfLayer(vol2surfLayer)).toBe(true);
    });
  });
  
  describe('Filtered Getters', () => {
    beforeEach(() => {
      const surfaceMap = new Map([
        ['surf-1', mockSurface],
        ['vol2surf-1', mockVol2Surface]
      ]);
      
      (useLayerStore.getState as any).mockReturnValue({
        layers: [mockVolumeLayer]
      });
      
      (useSurfaceStore.getState as any).mockReturnValue({
        surfaces: surfaceMap
      });
    });
    
    it('getVolumeLayers should return only volumes', () => {
      const volumes = service.getVolumeLayers();
      expect(volumes).toHaveLength(1);
      expect(volumes[0].type).toBe('volume');
    });
    
    it('getSurfaceLayers should return all surfaces', () => {
      const surfaces = service.getSurfaceLayers();
      expect(surfaces).toHaveLength(2);
      expect(surfaces.every(s => s.type === 'surface')).toBe(true);
    });
    
    it('getVol2SurfLayers should return only mapped surfaces', () => {
      const vol2surfs = service.getVol2SurfLayers();
      expect(vol2surfs).toHaveLength(1);
      expect(vol2surfs[0].sourceVolumeId).toBe('vol-1');
    });
  });
  
  describe('Layer Operations', () => {
    it('getLayerById should find layers', () => {
      (useLayerStore.getState as any).mockReturnValue({
        layers: [mockVolumeLayer]
      });
      
      const layer = service.getLayerById('vol-1');
      expect(layer).toBeDefined();
      expect(layer?.id).toBe('vol-1');
    });
    
    it('getLayerById should return undefined for non-existent layers', () => {
      const layer = service.getLayerById('non-existent');
      expect(layer).toBeUndefined();
    });
    
    it('updateLayerProperty should update volume layers', () => {
      const updateLayer = vi.fn();
      (useLayerStore.getState as any).mockReturnValue({
        layers: [mockVolumeLayer],
        updateLayer
      });
      
      service.updateLayerProperty('vol-1', 'visible', false);
      
      expect(updateLayer).toHaveBeenCalledWith('vol-1', { visible: false });
    });
    
    it('updateLayerProperty should handle surface layers', () => {
      const updateLayerProperty = vi.fn();
      const surfaceMap = new Map([['surf-1', mockSurface]]);
      
      (useSurfaceStore.getState as any).mockReturnValue({
        surfaces: surfaceMap,
        updateLayerProperty
      });
      
      service.updateLayerProperty('surf-1', 'customProp', 'value');
      
      expect(updateLayerProperty).toHaveBeenCalledWith('surf-1', 'surf-1', 'customProp', 'value');
    });
    
    it('toggleLayerVisibility should toggle volume visibility', () => {
      const updateLayer = vi.fn();
      (useLayerStore.getState as any).mockReturnValue({
        layers: [mockVolumeLayer],
        updateLayer
      });
      
      service.toggleLayerVisibility('vol-1');
      
      expect(updateLayer).toHaveBeenCalledWith('vol-1', { visible: false });
    });
    
    it('removeLayer should remove volume layers', () => {
      const removeLayer = vi.fn();
      (useLayerStore.getState as any).mockReturnValue({
        layers: [mockVolumeLayer],
        removeLayer
      });
      
      service.removeLayer('vol-1');
      
      expect(removeLayer).toHaveBeenCalledWith('vol-1');
    });
    
    it('removeLayer should remove surface layers', () => {
      const removeSurface = vi.fn();
      const surfaceMap = new Map([['surf-1', mockSurface]]);
      
      (useSurfaceStore.getState as any).mockReturnValue({
        surfaces: surfaceMap,
        removeSurface
      });
      
      service.removeLayer('surf-1');
      
      expect(removeSurface).toHaveBeenCalledWith('surf-1');
    });
  });
  
  describe('Vol2Surf Mapping', () => {
    it('createVol2SurfMapping should create mapped surface', async () => {
      const surfaceMap = new Map([['surf-1', mockSurface]]);
      
      (useLayerStore.getState as any).mockReturnValue({
        layers: [mockVolumeLayer]
      });
      
      (useSurfaceStore.getState as any).mockReturnValue({
        surfaces: surfaceMap
      });
      
      const result = await service.createVol2SurfMapping('vol-1', 'surf-1');
      
      expect(result).toBe('test-id-123');
      expect(surfaceMap.has('test-id-123')).toBe(true);
      
      const vol2surf = surfaceMap.get('test-id-123');
      expect(vol2surf?.metadata?.sourceVolumeId).toBe('vol-1');
      expect(vol2surf?.name).toBe('Test Surface ← Test Volume');
    });
    
    it('createVol2SurfMapping should return null for invalid inputs', async () => {
      const result = await service.createVol2SurfMapping('invalid', 'invalid');
      expect(result).toBeNull();
    });
    
    it('createVol2SurfMapping should use custom mapping options', async () => {
      const surfaceMap = new Map([['surf-1', mockSurface]]);
      
      (useLayerStore.getState as any).mockReturnValue({
        layers: [mockVolumeLayer]
      });
      
      (useSurfaceStore.getState as any).mockReturnValue({
        surfaces: surfaceMap
      });
      
      const options = {
        method: 'trilinear' as const,
        projectionDepth: 2.5,
        smoothingKernel: 3
      };
      
      await service.createVol2SurfMapping('vol-1', 'surf-1', options);
      
      const vol2surf = surfaceMap.get('test-id-123');
      expect(vol2surf?.metadata?.mappingOptions).toEqual(options);
    });
    
    it('getAvailableVolumesForMapping should return visible volumes', () => {
      const visibleVolume = { ...mockVolumeLayer, visible: true };
      const hiddenVolume = { ...mockVolumeLayer, id: 'vol-2', visible: false };
      
      (useLayerStore.getState as any).mockReturnValue({
        layers: [visibleVolume, hiddenVolume]
      });
      
      const available = service.getAvailableVolumesForMapping();
      
      expect(available).toHaveLength(1);
      expect(available[0].id).toBe('vol-1');
    });
    
    it('getAvailableSurfacesForMapping should return unmapped surfaces', () => {
      const surfaceMap = new Map([
        ['surf-1', mockSurface],
        ['vol2surf-1', mockVol2Surface]
      ]);
      
      (useSurfaceStore.getState as any).mockReturnValue({
        surfaces: surfaceMap
      });
      
      const available = service.getAvailableSurfacesForMapping();
      
      expect(available).toHaveLength(1);
      expect(available[0].id).toBe('surf-1');
    });
    
    it('updateVol2SurfMapping should update mapping options', () => {
      const surfaceMap = new Map([['vol2surf-1', mockVol2Surface]]);
      
      (useSurfaceStore.getState as any).mockReturnValue({
        surfaces: surfaceMap
      });
      
      const newOptions = {
        method: 'weighted' as const,
        projectionDepth: 5
      };
      
      service.updateVol2SurfMapping('vol2surf-1', newOptions);
      
      const updated = surfaceMap.get('vol2surf-1');
      expect(updated?.metadata?.mappingOptions?.method).toBe('weighted');
      expect(updated?.metadata?.mappingOptions?.projectionDepth).toBe(5);
      expect(updated?.metadata?.mappingOptions?.smoothingKernel).toBe(0); // Preserved
    });
  });
});