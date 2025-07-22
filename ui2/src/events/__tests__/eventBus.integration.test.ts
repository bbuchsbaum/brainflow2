import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { EventBus } from '../EventBus';
import { useLayerStore } from '../../stores/layerStore';
import { useViewStateStore } from '../../stores/viewStateStore';
import { useAnnotationStore } from '../../stores/annotationStore';
import { LayerService } from '../../services/LayerService';
import { CrosshairService } from '../../services/CrosshairService';
import type { Layer } from '../../types/layers';
import type { WorldCoordinates } from '../../types/coordinates';

describe('EventBus Integration Tests', () => {
  let eventBus: EventBus;
  let layerStore: ReturnType<typeof useLayerStore>;
  let viewStateStore: ReturnType<typeof useViewStateStore>;
  let annotationStore: ReturnType<typeof useAnnotationStore>;
  let layerService: LayerService;
  let crosshairService: CrosshairService;

  beforeEach(() => {
    // Get fresh instances
    eventBus = EventBus.getInstance();
    layerStore = useLayerStore.getState();
    viewStateStore = useViewStateStore.getState();
    annotationStore = useAnnotationStore.getState();
    layerService = LayerService.getInstance();
    crosshairService = CrosshairService.getInstance();

    // Reset all stores
    layerStore.clearLayers();
    viewStateStore.resetToDefaults();
    annotationStore.clearAllAnnotations();
  });

  afterEach(() => {
    // Clean up event listeners
    eventBus.removeAllListeners();
  });

  describe('Layer Event Integration', () => {
    it('should coordinate layer events between service and store', () => {
      // Arrange
      const layer: Layer = {
        id: 'event-test-layer',
        name: 'Event Test Layer',
        type: 'volume',
        visible: true,
        source: { type: 'file', path: '/test/event.nii' }
      };

      const mockLayerHandler = vi.fn();
      const mockRenderHandler = vi.fn();

      // Set up event listeners
      eventBus.on('layer.added', mockLayerHandler);
      eventBus.on('layer.render.batch', mockRenderHandler);

      // Act - Add layer via store (should emit event)
      layerStore.addLayer(layer);
      eventBus.emit('layer.added', { layer });

      // Update render via service (should emit batch event)
      layerService.patchLayer(layer.id, { opacity: 0.5 });

      // Assert - Events should be handled
      expect(mockLayerHandler).toHaveBeenCalledWith({ layer });
      expect(mockRenderHandler).toHaveBeenCalledWith({
        layerId: layer.id,
        patch: { opacity: 0.5 }
      });
    });

    it('should handle layer visibility changes through events', () => {
      // Arrange
      const layer: Layer = {
        id: 'visibility-event-layer',
        name: 'Visibility Event Layer',
        type: 'overlay',
        visible: true,
        source: { type: 'file', path: '/test/visibility.nii' }
      };

      const visibilityHandler = vi.fn();
      eventBus.on('layer.visibility.changed', visibilityHandler);

      layerStore.addLayer(layer);

      // Act - Change visibility via store
      layerStore.updateLayer(layer.id, { visible: false });
      eventBus.emit('layer.visibility.changed', { 
        layerId: layer.id, 
        visible: false 
      });

      // Assert - Event should be emitted
      expect(visibilityHandler).toHaveBeenCalledWith({
        layerId: layer.id,
        visible: false
      });
    });

    it('should handle layer deletion events', () => {
      // Arrange
      const layer: Layer = {
        id: 'deletion-test-layer',
        name: 'Deletion Test Layer',
        type: 'surface',
        visible: true,
        source: { type: 'file', path: '/test/deletion.gii' }
      };

      const deletionHandler = vi.fn();
      eventBus.on('layer.removed', deletionHandler);

      layerStore.addLayer(layer);
      expect(layerStore.getState().layers).toHaveLength(1);

      // Act - Remove layer
      layerStore.removeLayer(layer.id);
      eventBus.emit('layer.removed', { layerId: layer.id });

      // Assert - Layer should be removed and event emitted
      expect(layerStore.getState().layers).toHaveLength(0);
      expect(deletionHandler).toHaveBeenCalledWith({ layerId: layer.id });
    });
  });

  describe('Crosshair Event Integration', () => {
    it('should coordinate crosshair events between service and store', () => {
      // Arrange
      const position: WorldCoordinates = [25, 35, 45];
      const crosshairHandler = vi.fn();

      eventBus.on('crosshair.moved', crosshairHandler);

      // Act - Update crosshair via service
      crosshairService.updateWorldPosition(position);
      eventBus.emit('crosshair.moved', { world_mm: position });

      // Assert - Event should be handled and store updated
      expect(crosshairHandler).toHaveBeenCalledWith({ world_mm: position });
      expect(viewStateStore.getState().crosshair.world_mm).toEqual(position);
    });

    it('should handle crosshair click events', () => {
      // Arrange
      const clickHandler = vi.fn();
      const screenPosition = [150, 200] as [number, number];
      const planeType = 'sagittal';

      eventBus.on('crosshair.clicked', clickHandler);

      // Act - Emit click event
      eventBus.emit('crosshair.clicked', {
        screen: screenPosition,
        plane: planeType
      });

      // Assert - Click should be handled
      expect(clickHandler).toHaveBeenCalledWith({
        screen: screenPosition,
        plane: planeType
      });
    });

    it('should handle crosshair visibility events', () => {
      // Arrange
      const visibilityHandler = vi.fn();
      eventBus.on('crosshair.visibility.changed', visibilityHandler);

      // Act - Change crosshair visibility
      crosshairService.setVisible(false);
      eventBus.emit('crosshair.visibility.changed', { visible: false });

      // Assert - Visibility change should be handled
      expect(visibilityHandler).toHaveBeenCalledWith({ visible: false });
      expect(viewStateStore.getState().crosshair.visible).toBe(false);
    });
  });

  describe('Annotation Event Integration', () => {
    it('should handle annotation creation events', () => {
      // Arrange
      const annotation = {
        id: 'event-annotation',
        type: 'marker' as const,
        world_mm: [10, 20, 30] as WorldCoordinates,
        symbol: 'circle' as const,
        size: 8,
        visible: true,
        selected: false,
        style: { color: '#FF0000' }
      };

      const annotationHandler = vi.fn();
      eventBus.on('annotation.added', annotationHandler);

      // Act - Add annotation
      annotationStore.addAnnotation(annotation);
      eventBus.emit('annotation.added', { annotation });

      // Assert - Event should be handled
      expect(annotationHandler).toHaveBeenCalledWith({ annotation });
      expect(annotationStore.getState().annotations).toHaveLength(1);
    });

    it('should handle annotation selection events', () => {
      // Arrange
      const annotation = {
        id: 'selectable-annotation',
        type: 'marker' as const,
        world_mm: [5, 15, 25] as WorldCoordinates,
        symbol: 'square' as const,
        size: 12,
        visible: true,
        selected: false,
        style: { color: '#00FF00' }
      };

      const selectionHandler = vi.fn();
      eventBus.on('annotation.selected', selectionHandler);

      annotationStore.addAnnotation(annotation);

      // Act - Select annotation
      annotationStore.selectAnnotation(annotation.id);
      eventBus.emit('annotation.selected', { annotationId: annotation.id });

      // Assert - Selection should be handled
      expect(selectionHandler).toHaveBeenCalledWith({ annotationId: annotation.id });
      expect(annotationStore.getState().selectedAnnotations).toContain(annotation.id);
    });
  });

  describe('Cross-Component Event Flow', () => {
    it('should handle complex event chains across components', () => {
      // Arrange
      const layer: Layer = {
        id: 'complex-layer',
        name: 'Complex Layer',
        type: 'volume',
        visible: true,
        source: { type: 'file', path: '/test/complex.nii' }
      };

      const crosshairPosition: WorldCoordinates = [40, 50, 60];

      const layerHandler = vi.fn();
      const crosshairHandler = vi.fn();
      const renderHandler = vi.fn();

      eventBus.on('layer.added', layerHandler);
      eventBus.on('crosshair.moved', crosshairHandler);
      eventBus.on('layer.render.batch', renderHandler);

      // Act - Simulate complex workflow
      // 1. Add layer
      layerStore.addLayer(layer);
      eventBus.emit('layer.added', { layer });

      // 2. Update crosshair
      crosshairService.updateWorldPosition(crosshairPosition);
      eventBus.emit('crosshair.moved', { world_mm: crosshairPosition });

      // 3. Update layer render settings
      layerService.patchLayer(layer.id, { 
        opacity: 0.8,
        colormap: 'viridis'
      });

      // Assert - All events should be handled in sequence
      expect(layerHandler).toHaveBeenCalledWith({ layer });
      expect(crosshairHandler).toHaveBeenCalledWith({ world_mm: crosshairPosition });
      expect(renderHandler).toHaveBeenCalledWith({
        layerId: layer.id,
        patch: { opacity: 0.8, colormap: 'viridis' }
      });

      // Store states should be consistent
      expect(layerStore.getState().layers).toHaveLength(1);
      expect(viewStateStore.getState().crosshair.world_mm).toEqual(crosshairPosition);
    });

    it('should handle event error scenarios gracefully', () => {
      // Arrange
      const errorHandler = vi.fn();
      const problematicHandler = vi.fn(() => {
        throw new Error('Handler error');
      });

      eventBus.on('test.event', problematicHandler);
      eventBus.on('test.event', errorHandler);

      // Act - Emit event that causes handler to throw
      expect(() => {
        eventBus.emit('test.event', { data: 'test' });
      }).not.toThrow(); // EventBus should handle errors gracefully

      // Assert - Other handlers should still be called
      expect(problematicHandler).toHaveBeenCalled();
      expect(errorHandler).toHaveBeenCalled();
    });
  });

  describe('Event Performance and Optimization', () => {
    it('should handle high-frequency events efficiently', () => {
      // Arrange
      const rapidHandler = vi.fn();
      eventBus.on('rapid.event', rapidHandler);

      const eventCount = 100;

      // Act - Emit many events rapidly
      const startTime = performance.now();
      
      for (let i = 0; i < eventCount; i++) {
        eventBus.emit('rapid.event', { index: i });
      }
      
      const endTime = performance.now();
      const duration = endTime - startTime;

      // Assert - Events should be handled efficiently
      expect(rapidHandler).toHaveBeenCalledTimes(eventCount);
      expect(duration).toBeLessThan(100); // Should complete within 100ms
    });

    it('should handle event listener cleanup properly', () => {
      // Arrange
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const handler3 = vi.fn();

      eventBus.on('cleanup.test', handler1);
      eventBus.on('cleanup.test', handler2);
      eventBus.on('other.event', handler3);

      // Verify handlers are registered
      eventBus.emit('cleanup.test', { data: 'test' });
      eventBus.emit('other.event', { data: 'other' });

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
      expect(handler3).toHaveBeenCalledTimes(1);

      // Act - Remove specific handler
      eventBus.off('cleanup.test', handler1);

      // Reset call counts
      handler1.mockClear();
      handler2.mockClear();
      handler3.mockClear();

      // Emit events again
      eventBus.emit('cleanup.test', { data: 'test2' });
      eventBus.emit('other.event', { data: 'other2' });

      // Assert - Only handler1 should be removed
      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalledTimes(1);
      expect(handler3).toHaveBeenCalledTimes(1);
    });
  });

  describe('Event Data Integrity', () => {
    it('should maintain event data integrity across the system', () => {
      // Arrange
      const originalData = {
        layerId: 'integrity-test',
        complex: {
          nested: {
            value: 42,
            array: [1, 2, 3],
            position: [10, 20, 30] as WorldCoordinates
          }
        }
      };

      const dataHandler = vi.fn();
      eventBus.on('data.integrity', dataHandler);

      // Act - Emit event with complex data
      eventBus.emit('data.integrity', originalData);

      // Assert - Data should be preserved exactly
      expect(dataHandler).toHaveBeenCalledWith(originalData);
      
      const receivedData = dataHandler.mock.calls[0][0];
      expect(receivedData).toEqual(originalData);
      expect(receivedData.complex.nested.value).toBe(42);
      expect(receivedData.complex.nested.array).toEqual([1, 2, 3]);
      expect(receivedData.complex.nested.position).toEqual([10, 20, 30]);
    });
  });
});