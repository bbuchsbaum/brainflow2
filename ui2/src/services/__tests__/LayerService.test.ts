/**
 * LayerService Tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { LayerService, initializeLayerService, getLayerService, type LayerApi } from '../LayerService';
import { getEventBus } from '@/events/EventBus';
import type { Layer, LayerRender } from '@/types/layers';

vi.mock('@/events/EventBus');

// Mock requestAnimationFrame
global.requestAnimationFrame = vi.fn((cb) => {
  setTimeout(cb, 16);
  return 1;
});

global.cancelAnimationFrame = vi.fn();

describe('LayerService', () => {
  let layerService: LayerService;
  let mockApi: LayerApi;
  let mockEventBus: any;

  const mockLayer: Layer = {
    id: 'layer1',
    name: 'Test Layer',
    volumeId: 'vol1',
    type: 'anatomical',
    visible: true,
    order: 0,
  };

  const mockLayerRender: LayerRender = {
    opacity: 1.0,
    intensity: [0, 100],
    threshold: [0, 100],
    colormap: 'gray',
    interpolation: 'linear',
  };

  beforeEach(() => {
    mockEventBus = {
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    };
    (getEventBus as any).mockReturnValue(mockEventBus);

    mockApi = {
      addLayer: vi.fn().mockResolvedValue(mockLayer),
      removeLayer: vi.fn().mockResolvedValue(undefined),
      updateLayer: vi.fn().mockResolvedValue(mockLayer),
      patchLayerRender: vi.fn().mockResolvedValue(undefined),
      reorderLayers: vi.fn().mockResolvedValue(undefined),
      loadLayerData: vi.fn().mockResolvedValue(undefined),
    };

    layerService = new LayerService(mockApi);
  });

  afterEach(() => {
    layerService.dispose();
    vi.clearAllTimers();
  });

  describe('initialization', () => {
    it('should initialize with default config', () => {
      expect(layerService).toBeDefined();
      expect(layerService.getLoadingLayers().size).toBe(0);
      expect(layerService.getErrorLayers().size).toBe(0);
    });

    it('should support singleton pattern', () => {
      const service = initializeLayerService(mockApi);
      const service2 = getLayerService();
      
      expect(service).toBe(service2);
    });
  });

  describe('layer lifecycle', () => {
    it('should add layer successfully', async () => {
      const newLayer = { ...mockLayer };
      delete (newLayer as any).id;

      const result = await layerService.addLayer(newLayer);

      expect(mockApi.addLayer).toHaveBeenCalledWith(newLayer);
      expect(result).toEqual(mockLayer);
      expect(mockEventBus.emit).toHaveBeenCalledWith('layer.loading', {
        layerId: newLayer.name,
        loading: true,
      });
      expect(mockEventBus.emit).toHaveBeenCalledWith('layer.loading', {
        layerId: mockLayer.id,
        loading: false,
      });
      expect(mockEventBus.emit).toHaveBeenCalledWith('layer.added', {
        layer: mockLayer,
      });
    });

    it('should handle add layer errors', async () => {
      const error = new Error('Failed to add layer');
      mockApi.addLayer = vi.fn().mockRejectedValue(error);

      const newLayer = { ...mockLayer };
      delete (newLayer as any).id;

      await expect(layerService.addLayer(newLayer)).rejects.toThrow(error);
      
      expect(mockEventBus.emit).toHaveBeenCalledWith('layer.error', {
        layerId: newLayer.name,
        error,
      });
    });

    it('should remove layer successfully', async () => {
      await layerService.removeLayer('layer1');

      expect(mockApi.removeLayer).toHaveBeenCalledWith('layer1');
      expect(mockEventBus.emit).toHaveBeenCalledWith('layer.removed', {
        layerId: 'layer1',
      });
    });

    it('should update layer successfully', async () => {
      const updates = { name: 'Updated Layer' };
      const updatedLayer = { ...mockLayer, ...updates };
      mockApi.updateLayer = vi.fn().mockResolvedValue(updatedLayer);

      const result = await layerService.updateLayer('layer1', updates);

      expect(mockApi.updateLayer).toHaveBeenCalledWith('layer1', updates);
      expect(result).toEqual(updatedLayer);
    });

    it('should emit visibility event on visibility update', async () => {
      const updates = { visible: false };
      const updatedLayer = { ...mockLayer, ...updates };
      mockApi.updateLayer = vi.fn().mockResolvedValue(updatedLayer);

      await layerService.updateLayer('layer1', updates);

      expect(mockEventBus.emit).toHaveBeenCalledWith('layer.visibility', {
        layerId: 'layer1',
        visible: false,
      });
    });
  });

  describe('batching', () => {
    it('should batch multiple patches', async () => {
      // Make multiple patch calls
      layerService.patchLayer('layer1', { opacity: 0.5 });
      layerService.patchLayer('layer1', { intensity: [10, 90] });
      layerService.patchLayer('layer2', { colormap: 'hot' });

      // Wait for batch to flush
      await new Promise(resolve => setTimeout(resolve, 20));

      // Should have made batched calls
      expect(mockApi.patchLayerRender).toHaveBeenCalledTimes(2);
      expect(mockApi.patchLayerRender).toHaveBeenCalledWith('layer1', {
        opacity: 0.5,
        intensity: [10, 90],
      });
      expect(mockApi.patchLayerRender).toHaveBeenCalledWith('layer2', {
        colormap: 'hot',
      });
    });

    it('should accumulate patches for same layer', async () => {
      layerService.patchLayer('layer1', { opacity: 0.3 });
      layerService.patchLayer('layer1', { opacity: 0.7 }); // Should override
      layerService.patchLayer('layer1', { colormap: 'viridis' });

      await new Promise(resolve => setTimeout(resolve, 20));

      expect(mockApi.patchLayerRender).toHaveBeenCalledWith('layer1', {
        opacity: 0.7, // Latest value
        colormap: 'viridis',
      });
    });

    it('should force immediate flush', async () => {
      layerService.patchLayer('layer1', { opacity: 0.5 });
      
      await layerService.flushImmediate();

      expect(mockApi.patchLayerRender).toHaveBeenCalledWith('layer1', {
        opacity: 0.5,
      });
    });
  });

  describe('optimized visibility', () => {
    it('should optimize visibility toggle', () => {
      layerService.toggleVisibility('layer1', false);

      // Should emit immediate event
      expect(mockEventBus.emit).toHaveBeenCalledWith('layer.visibility', {
        layerId: 'layer1',
        visible: false,
      });

      // Should also batch the render update (opacity change)
      // This will be verified when the batch flushes
    });
  });

  describe('error handling', () => {
    it('should track loading states', async () => {
      expect(layerService.isLayerLoading('layer1')).toBe(false);

      const addPromise = layerService.addLayer({
        name: 'Test Layer',
        volumeId: 'vol1',
        type: 'anatomical',
        visible: true,
        order: 0,
      });

      // Should be loading during the async operation
      // Note: This is a bit tricky to test due to timing
      
      await addPromise;
      
      expect(layerService.isLayerLoading('layer1')).toBe(false);
    });

    it('should track error states', async () => {
      const error = new Error('Test error');
      mockApi.addLayer = vi.fn().mockRejectedValue(error);

      try {
        await layerService.addLayer({
          name: 'Test Layer',
          volumeId: 'vol1',
          type: 'anatomical',
          visible: true,
          order: 0,
        });
      } catch (e) {
        // Expected
      }

      expect(layerService.getLayerError('Test Layer')).toBe(error);
    });

    it('should retry failed patches', async () => {
      const error = new Error('Network error');
      mockApi.patchLayerRender = vi.fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce(undefined);

      layerService.patchLayer('layer1', { opacity: 0.5 });

      // Wait for initial attempt and retry
      await new Promise(resolve => setTimeout(resolve, 20));
      await new Promise(resolve => setTimeout(resolve, 1100)); // Wait for retry delay

      // Should have tried twice (initial + 1 retry)
      expect(mockApi.patchLayerRender).toHaveBeenCalledTimes(2);
    });
  });

  describe('reordering', () => {
    it('should reorder layers', async () => {
      const layerIds = ['layer3', 'layer1', 'layer2'];

      await layerService.reorderLayers(layerIds);

      expect(mockApi.reorderLayers).toHaveBeenCalledWith(layerIds);
      expect(mockEventBus.emit).toHaveBeenCalledWith('layer.reordered', {
        layerIds,
      });
    });

    it('should handle reorder errors', async () => {
      const error = new Error('Reorder failed');
      mockApi.reorderLayers = vi.fn().mockRejectedValue(error);

      await expect(layerService.reorderLayers(['layer1'])).rejects.toThrow(error);
      
      expect(mockEventBus.emit).toHaveBeenCalledWith('layer.error', {
        layerId: 'reorder',
        error,
      });
    });
  });

  describe('data loading', () => {
    it('should load layer data', async () => {
      await layerService.loadLayerData('layer1');

      expect(mockApi.loadLayerData).toHaveBeenCalledWith('layer1');
      expect(mockEventBus.emit).toHaveBeenCalledWith('layer.loading', {
        layerId: 'layer1',
        loading: true,
      });
      expect(mockEventBus.emit).toHaveBeenCalledWith('layer.loading', {
        layerId: 'layer1',
        loading: false,
      });
    });

    it('should handle load data errors', async () => {
      const error = new Error('Load failed');
      mockApi.loadLayerData = vi.fn().mockRejectedValue(error);

      await expect(layerService.loadLayerData('layer1')).rejects.toThrow(error);
      
      expect(mockEventBus.emit).toHaveBeenCalledWith('layer.error', {
        layerId: 'layer1',
        error,
      });
    });
  });

  describe('state queries', () => {
    it('should return loading layers', () => {
      const loadingLayers = layerService.getLoadingLayers();
      expect(loadingLayers).toBeInstanceOf(Set);
      expect(loadingLayers.size).toBe(0);
    });

    it('should return error layers', () => {
      const errorLayers = layerService.getErrorLayers();
      expect(errorLayers).toBeInstanceOf(Map);
      expect(errorLayers.size).toBe(0);
    });
  });

  describe('cleanup', () => {
    it('should dispose properly', () => {
      layerService.patchLayer('layer1', { opacity: 0.5 });
      
      layerService.dispose();

      expect(layerService.getLoadingLayers().size).toBe(0);
      expect(layerService.getErrorLayers().size).toBe(0);
      expect(global.cancelAnimationFrame).toHaveBeenCalled();
    });
  });

  describe('configuration', () => {
    it('should respect custom config', () => {
      const customConfig = {
        maxBatchSize: 5,
        batchTimeoutMs: 32,
        maxRetries: 5,
        retryDelayMs: 500,
      };

      const customService = new LayerService(mockApi, customConfig);
      
      expect(customService).toBeDefined();
      
      customService.dispose();
    });
  });
});