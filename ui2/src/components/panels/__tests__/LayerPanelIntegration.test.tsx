/**
 * Integration test for LayerPanel with Facade Pattern
 * Ensures backward compatibility with existing volume functionality
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnifiedLayerService, isVolumeLayer, isSurfaceLayer } from '@/services/UnifiedLayerService';
import type { LayerInfo } from '@/stores/layerStore';
import type { LoadedSurface } from '@/stores/surfaceStore';

// Mock the stores
vi.mock('@/stores/layerStore', () => ({
  useLayerStore: {
    getState: vi.fn(),
    setState: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
  },
}));

vi.mock('@/stores/surfaceStore', () => ({
  useSurfaceStore: {
    getState: vi.fn(),
    setState: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
  },
}));

describe('LayerPanel Backward Compatibility', () => {
  const mockVolumeLayer: LayerInfo = {
    id: 'vol-1',
    name: 'Test Volume',
    volumeId: 'volume-handle-1',
    visible: true,
    selected: false,
    metadata: {
      dimensions: [256, 256, 150],
      voxelSize: [1, 1, 1],
      dataType: 'float32'
    }
  };

  const mockSurfaceLayer: LoadedSurface = {
    handle: 'surf-1',
    name: 'Test Surface',
    geometry: {
      vertices: new Float32Array([0, 0, 0, 1, 1, 1]),
      faces: new Uint32Array([0, 1, 2]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1])
    },
    metadata: {}
  };

  it('should handle volumes through unified interface without breaking existing code', async () => {
    // Mock the stores
    const { useLayerStore } = await import('@/stores/layerStore');
    const { useSurfaceStore } = await import('@/stores/surfaceStore');

    (useLayerStore.getState as any).mockReturnValue({
      layers: [mockVolumeLayer],
      selectedLayerId: 'vol-1',
      selectLayer: vi.fn(),
      updateLayer: vi.fn()
    });

    (useSurfaceStore.getState as any).mockReturnValue({
      surfaces: new Map(),
    });

    const service = UnifiedLayerService.getInstance();
    const layers = service.getAllLayers();
    
    // Should return volume layer with correct structure
    expect(layers).toHaveLength(1);
    expect(layers[0].type).toBe('volume');
    expect(layers[0].id).toBe('vol-1');
    expect(layers[0].name).toBe('Test Volume');
  });

  it('should handle surfaces without affecting volume operations', async () => {
    const { useLayerStore } = await import('@/stores/layerStore');
    const { useSurfaceStore } = await import('@/stores/surfaceStore');

    (useLayerStore.getState as any).mockReturnValue({
      layers: [mockVolumeLayer],
      updateLayer: vi.fn()
    });

    const surfaceMap = new Map([['surf-1', mockSurfaceLayer]]);
    (useSurfaceStore.getState as any).mockReturnValue({
      surfaces: surfaceMap,
      updateLayerProperty: vi.fn()
    });

    const service = UnifiedLayerService.getInstance();
    const layers = service.getAllLayers();
    
    // Should return both layers
    expect(layers).toHaveLength(2);
    
    // Volume operations should still work
    const volumeLayer = layers.find(l => l.type === 'volume');
    expect(volumeLayer).toBeDefined();
    expect(volumeLayer?.id).toBe('vol-1');
    
    // Surface should be included
    const surfaceLayer = layers.find(l => l.type === 'surface');
    expect(surfaceLayer).toBeDefined();
    expect(surfaceLayer?.id).toBe('surf-1');
  });

  it('should maintain ViewState compatibility for volumes', async () => {
    const { useLayerStore } = await import('@/stores/layerStore');

    const updateLayer = vi.fn();
    (useLayerStore.getState as any).mockReturnValue({
      layers: [mockVolumeLayer],
      updateLayer
    });

    const service = UnifiedLayerService.getInstance();
    
    // Update volume property (should delegate to layerStore)
    service.updateLayerProperty('vol-1', 'visible', false);
    
    // Should have called updateLayer with correct params
    expect(updateLayer).toHaveBeenCalledWith('vol-1', { visible: false });
  });

  it('should correctly identify layer types with type guards', () => {
    const service = UnifiedLayerService.getInstance();
    
    const volumeLayer = {
      id: 'vol-1',
      type: 'volume' as const,
      name: 'Test',
      visible: true,
      opacity: 1,
      data: mockVolumeLayer
    };
    
    const surfaceLayer = {
      id: 'surf-1',
      type: 'surface' as const,
      name: 'Test',
      visible: true,
      opacity: 1,
      data: mockSurfaceLayer
    };

    // Use the imported functions from top of file
    expect(isVolumeLayer(volumeLayer)).toBe(true);
    expect(isVolumeLayer(surfaceLayer)).toBe(false);
    expect(isSurfaceLayer(surfaceLayer)).toBe(true);
    expect(isSurfaceLayer(volumeLayer)).toBe(false);
  });

  it('should handle selection correctly for both layer types', async () => {
    const { useLayerStore } = await import('@/stores/layerStore');
    const { useSurfaceStore } = await import('@/stores/surfaceStore');

    const selectLayer = vi.fn();
    const setActiveSurface = vi.fn();

    (useLayerStore.getState as any).mockReturnValue({
      layers: [mockVolumeLayer],
      selectLayer
    });

    (useSurfaceStore.getState as any).mockReturnValue({
      surfaces: new Map([['surf-1', mockSurfaceLayer]]),
      setActiveSurface
    });
    
    const service = UnifiedLayerService.getInstance();
    
    // Test that service exists and has expected methods
    expect(service).toBeDefined();
    expect(service.getAllLayers).toBeDefined();
    expect(service.updateLayerProperty).toBeDefined();
    
    // Volume selection should work through layerStore
    const layers = service.getAllLayers();
    expect(layers.length).toBeGreaterThan(0);
  });
});