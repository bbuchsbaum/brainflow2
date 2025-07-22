import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LayerService } from '../LayerService';
import { useLayerStore } from '../../stores/layerStore';
import { EventBus } from '../../events/EventBus';
import type { Layer, LayerRender } from '../../types/layers';

// Mock the EventBus
vi.mock('../../events/EventBus', () => ({
  EventBus: {
    getInstance: vi.fn(() => ({
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn()
    }))
  }
}));

describe('LayerService Integration Tests', () => {
  let layerService: LayerService;
  let layerStore: ReturnType<typeof useLayerStore>;
  let mockEventBus: any;

  beforeEach(() => {
    // Reset all stores before each test
    layerStore = useLayerStore.getState();
    layerStore.clearLayers();
    
    // Get fresh service instance
    layerService = LayerService.getInstance();
    
    // Mock EventBus
    mockEventBus = {
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn()
    };
    (EventBus.getInstance as any).mockReturnValue(mockEventBus);
  });

  describe('Layer Management Integration', () => {
    it('should coordinate layer updates between service and store', async () => {
      // Arrange
      const mockLayer: Layer = {
        id: 'test-layer-1',
        name: 'Test Volume',
        type: 'volume',
        visible: true,
        source: { type: 'file', path: '/test/volume.nii' }
      };

      const renderPatch: Partial<LayerRender> = {
        opacity: 0.5,
        intensity: [10, 90] as [number, number]
      };

      // Act - Add layer to store
      layerStore.addLayer(mockLayer);
      
      // Verify layer was added
      expect(layerStore.getState().layers).toHaveLength(1);
      expect(layerStore.getState().layers[0]).toEqual(mockLayer);

      // Act - Patch layer via service
      layerService.patchLayer(mockLayer.id, renderPatch);

      // Assert - Verify service emitted batch update event
      expect(mockEventBus.emit).toHaveBeenCalledWith('layer.render.batch', {
        layerId: mockLayer.id,
        patch: renderPatch
      });
    });

    it('should handle layer visibility changes through service', () => {
      // Arrange
      const layer: Layer = {
        id: 'visibility-test',
        name: 'Visibility Test',
        type: 'overlay',
        visible: true,
        source: { type: 'generated', data: 'test' }
      };

      layerStore.addLayer(layer);

      // Act - Toggle visibility via store
      layerStore.updateLayer(layer.id, { visible: false });

      // Assert - Layer should be updated in store
      const updatedLayer = layerStore.getState().layers.find(l => l.id === layer.id);
      expect(updatedLayer?.visible).toBe(false);
    });

    it('should handle layer reordering integration', () => {
      // Arrange
      const layers: Layer[] = [
        {
          id: 'layer-1',
          name: 'First Layer',
          type: 'volume',
          visible: true,
          source: { type: 'file', path: '/first.nii' }
        },
        {
          id: 'layer-2', 
          name: 'Second Layer',
          type: 'overlay',
          visible: true,
          source: { type: 'file', path: '/second.nii' }
        },
        {
          id: 'layer-3',
          name: 'Third Layer', 
          type: 'surface',
          visible: false,
          source: { type: 'file', path: '/third.gii' }
        }
      ];

      // Add layers in order
      layers.forEach(layer => layerStore.addLayer(layer));

      // Act - Reorder layers (reverse order)
      const reorderedLayers = [...layers].reverse();
      layerStore.reorderLayers(reorderedLayers);

      // Assert - Layers should be in new order
      const currentLayers = layerStore.getState().layers;
      expect(currentLayers).toHaveLength(3);
      expect(currentLayers[0].id).toBe('layer-3');
      expect(currentLayers[1].id).toBe('layer-2');
      expect(currentLayers[2].id).toBe('layer-1');
    });
  });

  describe('Layer Render State Integration', () => {
    it('should synchronize layer render settings between service and store', () => {
      // Arrange
      const layer: Layer = {
        id: 'render-test',
        name: 'Render Test',
        type: 'volume',
        visible: true,
        source: { type: 'file', path: '/render-test.nii' }
      };

      layerStore.addLayer(layer);

      const renderSettings: LayerRender = {
        opacity: 0.8,
        intensity: [20, 200] as [number, number],
        threshold: [0, 100] as [number, number],
        colormap: 'viridis',
        interpolation: 'linear'
      };

      // Act - Update render settings via store
      layerStore.updateLayerRender(layer.id, renderSettings);

      // Assert - Render settings should be stored
      const storedRender = layerStore.getState().layerRender.get(layer.id);
      expect(storedRender).toEqual(renderSettings);
    });

    it('should handle batch render updates efficiently', async () => {
      // Arrange
      const layer: Layer = {
        id: 'batch-test',
        name: 'Batch Test',
        type: 'volume',
        visible: true,
        source: { type: 'file', path: '/batch.nii' }
      };

      layerStore.addLayer(layer);

      // Act - Perform multiple rapid updates via service
      const updates = [
        { opacity: 0.1 },
        { opacity: 0.2 },
        { opacity: 0.3 },
        { intensity: [0, 50] as [number, number] },
        { colormap: 'hot' }
      ];

      updates.forEach(update => {
        layerService.patchLayer(layer.id, update);
      });

      // Assert - Service should emit batch events for optimization
      expect(mockEventBus.emit).toHaveBeenCalledTimes(5);
      
      // Each call should be a batch update
      updates.forEach((update, index) => {
        expect(mockEventBus.emit).toHaveBeenNthCalledWith(index + 1, 'layer.render.batch', {
          layerId: layer.id,
          patch: update
        });
      });
    });
  });

  describe('Error Handling Integration', () => {
    it('should handle layer loading errors properly', () => {
      // Arrange
      const layer: Layer = {
        id: 'error-test',
        name: 'Error Test',
        type: 'volume',
        visible: true,
        source: { type: 'file', path: '/nonexistent.nii' }
      };

      layerStore.addLayer(layer);

      // Act - Simulate loading error
      const error = new Error('Failed to load volume');
      layerStore.setLayerError(layer.id, error);

      // Assert - Error should be stored
      const storedError = layerStore.getState().errorLayers.get(layer.id);
      expect(storedError).toBe(error);
      expect(storedError?.message).toBe('Failed to load volume');
    });

    it('should clear errors when layer is successfully updated', () => {
      // Arrange
      const layer: Layer = {
        id: 'error-clear-test',
        name: 'Error Clear Test',
        type: 'volume',
        visible: true,
        source: { type: 'file', path: '/test.nii' }
      };

      layerStore.addLayer(layer);
      const error = new Error('Initial error');
      layerStore.setLayerError(layer.id, error);

      // Verify error exists
      expect(layerStore.getState().errorLayers.has(layer.id)).toBe(true);

      // Act - Clear error
      layerStore.clearLayerError(layer.id);

      // Assert - Error should be cleared
      expect(layerStore.getState().errorLayers.has(layer.id)).toBe(false);
    });
  });

  describe('Loading State Integration', () => {
    it('should manage loading states during layer operations', () => {
      // Arrange
      const layer: Layer = {
        id: 'loading-test',
        name: 'Loading Test',
        type: 'volume',
        visible: true,
        source: { type: 'file', path: '/loading.nii' }
      };

      layerStore.addLayer(layer);

      // Act - Set loading state
      layerStore.setLayerLoading(layer.id, true);

      // Assert - Loading state should be set
      expect(layerStore.getState().loadingLayers.has(layer.id)).toBe(true);

      // Act - Clear loading state
      layerStore.setLayerLoading(layer.id, false);

      // Assert - Loading state should be cleared
      expect(layerStore.getState().loadingLayers.has(layer.id)).toBe(false);
    });
  });

  describe('Layer Selection Integration', () => {
    it('should handle layer selection changes', () => {
      // Arrange
      const layers: Layer[] = [
        {
          id: 'selectable-1',
          name: 'Selectable 1',
          type: 'volume',
          visible: true,
          source: { type: 'file', path: '/sel1.nii' }
        },
        {
          id: 'selectable-2',
          name: 'Selectable 2',
          type: 'overlay',
          visible: true,
          source: { type: 'file', path: '/sel2.nii' }
        }
      ];

      layers.forEach(layer => layerStore.addLayer(layer));

      // Act - Select first layer
      layerStore.selectLayer('selectable-1');

      // Assert - First layer should be selected
      expect(layerStore.getState().selectedLayerId).toBe('selectable-1');

      // Act - Select second layer
      layerStore.selectLayer('selectable-2');

      // Assert - Second layer should be selected
      expect(layerStore.getState().selectedLayerId).toBe('selectable-2');

      // Act - Deselect by selecting same layer
      layerStore.selectLayer('selectable-2');

      // Assert - No layer should be selected
      expect(layerStore.getState().selectedLayerId).toBeNull();
    });
  });
});