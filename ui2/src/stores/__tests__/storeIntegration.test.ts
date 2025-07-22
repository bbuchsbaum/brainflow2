import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useLayerStore } from '../layerStore';
import { useViewStateStore } from '../viewStateStore';
import { useAnnotationStore } from '../annotationStore';
import { useFileBrowserStore } from '../fileBrowserStore';
import { EventBus } from '../../events/EventBus';
import type { Layer } from '../../types/layers';
import type { Annotation, Marker } from '../../types/annotations';
import type { WorldCoordinates } from '../../types/coordinates';

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

describe('Store Integration Tests', () => {
  let layerStore: ReturnType<typeof useLayerStore>;
  let viewStateStore: ReturnType<typeof useViewStateStore>;
  let annotationStore: ReturnType<typeof useAnnotationStore>;
  let fileBrowserStore: ReturnType<typeof useFileBrowserStore>;
  let mockEventBus: any;

  beforeEach(() => {
    // Reset all stores
    layerStore = useLayerStore.getState();
    viewStateStore = useViewStateStore.getState();
    annotationStore = useAnnotationStore.getState();
    fileBrowserStore = useFileBrowserStore.getState();

    layerStore.clearLayers();
    viewStateStore.resetToDefaults();
    annotationStore.clearAllAnnotations();
    fileBrowserStore.resetToDefaults();

    // Mock EventBus
    mockEventBus = {
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn()
    };
    (EventBus.getInstance as any).mockReturnValue(mockEventBus);
  });

  describe('Layer and View State Integration', () => {
    it('should coordinate layer loading with view state updates', () => {
      // Arrange
      const layer: Layer = {
        id: 'integration-layer',
        name: 'Integration Test Layer',
        type: 'volume',
        visible: true,
        source: { type: 'file', path: '/test/integration.nii' }
      };

      // Act - Add layer and update view state
      layerStore.addLayer(layer);
      layerStore.selectLayer(layer.id);

      // Update view state to show layer loading
      layerStore.setLayerLoading(layer.id, true);

      // Assert - Layer should be selected and loading
      expect(layerStore.getState().selectedLayerId).toBe(layer.id);
      expect(layerStore.getState().loadingLayers.has(layer.id)).toBe(true);
      expect(layerStore.getState().layers).toHaveLength(1);
    });

    it('should synchronize crosshair position with layer visibility', () => {
      // Arrange
      const layer: Layer = {
        id: 'crosshair-sync-layer',
        name: 'Crosshair Sync Layer',
        type: 'volume',
        visible: true,
        source: { type: 'file', path: '/test/crosshair.nii' }
      };

      const crosshairPosition: WorldCoordinates = [10, 20, 30];

      // Act - Add layer and update crosshair
      layerStore.addLayer(layer);
      viewStateStore.updateCrosshair({ world_mm: crosshairPosition });

      // Assert - Both stores should be updated
      expect(layerStore.getState().layers[0].visible).toBe(true);
      expect(viewStateStore.getState().crosshair.world_mm).toEqual(crosshairPosition);
    });
  });

  describe('Annotation and Layer Integration', () => {
    it('should associate annotations with layer coordinates', () => {
      // Arrange
      const layer: Layer = {
        id: 'annotation-layer',
        name: 'Annotation Layer',
        type: 'volume',
        visible: true,
        source: { type: 'file', path: '/test/annotations.nii' }
      };

      const annotation: Marker = {
        id: 'marker-1',
        type: 'marker',
        world_mm: [15, 25, 35],
        symbol: 'circle',
        size: 10,
        visible: true,
        selected: false,
        style: { color: '#FF0000', opacity: 1.0 }
      };

      // Act - Add layer and annotation
      layerStore.addLayer(layer);
      annotationStore.addAnnotation(annotation);

      // Assert - Both should be present
      expect(layerStore.getState().layers).toHaveLength(1);
      expect(annotationStore.getState().annotations).toHaveLength(1);
      expect(annotationStore.getState().annotations[0].world_mm).toEqual([15, 25, 35]);
    });

    it('should handle annotation visibility with layer changes', () => {
      // Arrange
      const layer: Layer = {
        id: 'visibility-layer',
        name: 'Visibility Layer',
        type: 'overlay',
        visible: true,
        source: { type: 'file', path: '/test/overlay.nii' }
      };

      const annotations: Annotation[] = [
        {
          id: 'ann-1',
          type: 'marker',
          world_mm: [1, 2, 3],
          symbol: 'circle',
          size: 8,
          visible: true,
          selected: false,
          style: { color: '#00FF00' }
        } as Marker,
        {
          id: 'ann-2',
          type: 'marker',
          world_mm: [4, 5, 6],
          symbol: 'square',
          size: 12,
          visible: true,
          selected: false,
          style: { color: '#0000FF' }
        } as Marker
      ];

      // Act - Add layer and annotations
      layerStore.addLayer(layer);
      annotations.forEach(ann => annotationStore.addAnnotation(ann));

      // Hide layer
      layerStore.updateLayer(layer.id, { visible: false });

      // Assert - Layer should be hidden but annotations remain
      expect(layerStore.getState().layers[0].visible).toBe(false);
      expect(annotationStore.getState().annotations).toHaveLength(2);
      expect(annotationStore.getState().annotations.every(ann => ann.visible)).toBe(true);
    });
  });

  describe('File Browser and Layer Integration', () => {
    it('should load layers from file browser selections', () => {
      // Arrange
      const filePath = '/data/subjects/sub-01/anat/sub-01_T1w.nii.gz';
      
      // Act - Select file in browser
      fileBrowserStore.selectFile(filePath);

      // Simulate loading the file as a layer
      const layer: Layer = {
        id: 'file-browser-layer',
        name: 'sub-01_T1w',
        type: 'volume',
        visible: true,
        source: { type: 'file', path: filePath }
      };

      layerStore.addLayer(layer);

      // Assert - File should be selected and layer created
      expect(fileBrowserStore.getState().selectedFiles).toContain(filePath);
      expect(layerStore.getState().layers).toHaveLength(1);
      expect(layerStore.getState().layers[0].source.path).toBe(filePath);
    });

    it('should handle multiple file selections for multi-layer loading', () => {
      // Arrange
      const filePaths = [
        '/data/sub-01/anat/T1w.nii.gz',
        '/data/sub-01/func/task-rest_bold.nii.gz',
        '/data/sub-01/dwi/dwi.nii.gz'
      ];

      // Act - Select multiple files
      filePaths.forEach(path => fileBrowserStore.selectFile(path));

      // Simulate loading each as a layer
      const layers: Layer[] = filePaths.map((path, index) => ({
        id: `multi-layer-${index}`,
        name: path.split('/').pop()!.replace('.nii.gz', ''),
        type: index === 0 ? 'volume' : index === 1 ? 'overlay' : 'volume',
        visible: true,
        source: { type: 'file', path }
      }));

      layers.forEach(layer => layerStore.addLayer(layer));

      // Assert - All files selected and layers created
      expect(fileBrowserStore.getState().selectedFiles).toHaveLength(3);
      expect(layerStore.getState().layers).toHaveLength(3);
      
      layers.forEach((layer, index) => {
        expect(layerStore.getState().layers[index].source.path).toBe(filePaths[index]);
      });
    });
  });

  describe('Cross-Store Event Coordination', () => {
    it('should coordinate events across multiple stores', () => {
      // Arrange
      const layer: Layer = {
        id: 'event-layer',
        name: 'Event Layer',
        type: 'volume',
        visible: true,
        source: { type: 'file', path: '/test/events.nii' }
      };

      const position: WorldCoordinates = [50, 60, 70];

      // Act - Perform actions that should trigger cross-store updates
      layerStore.addLayer(layer);
      layerStore.selectLayer(layer.id);
      viewStateStore.updateCrosshair({ world_mm: position });

      // Create annotation at crosshair position
      const annotation: Marker = {
        id: 'crosshair-marker',
        type: 'marker',
        world_mm: position,
        symbol: 'circle',
        size: 6,
        visible: true,
        selected: false,
        style: { color: '#FFFF00' }
      };

      annotationStore.addAnnotation(annotation);

      // Assert - All stores should be updated consistently
      expect(layerStore.getState().selectedLayerId).toBe(layer.id);
      expect(viewStateStore.getState().crosshair.world_mm).toEqual(position);
      expect(annotationStore.getState().annotations[0].world_mm).toEqual(position);
    });

    it('should handle complex multi-store interactions', () => {
      // Arrange - Complex scenario with multiple layers and annotations
      const layers: Layer[] = [
        {
          id: 'base-volume',
          name: 'Base Volume',
          type: 'volume',
          visible: true,
          source: { type: 'file', path: '/base.nii' }
        },
        {
          id: 'overlay-1',
          name: 'Functional Overlay',
          type: 'overlay',
          visible: true,
          source: { type: 'file', path: '/func.nii' }
        }
      ];

      const annotations: Annotation[] = [
        {
          id: 'roi-1',
          type: 'roi',
          world_mm: [0, 0, 0],
          geometry: { type: 'sphere', params: [5] },
          visible: true,
          selected: false,
          style: { color: '#FF00FF' }
        },
        {
          id: 'measurement-1',
          type: 'measurement',
          world_mm: [10, 10, 10],
          points: [[5, 5, 5], [15, 15, 15]],
          value: 14.14,
          unit: 'mm',
          visible: true,
          selected: false,
          style: { color: '#00FFFF' }
        }
      ];

      // Act - Complex sequence of operations
      layers.forEach(layer => layerStore.addLayer(layer));
      layerStore.selectLayer('overlay-1');
      
      annotations.forEach(ann => annotationStore.addAnnotation(ann));
      annotationStore.selectAnnotation('roi-1');
      
      viewStateStore.updateCrosshair({ world_mm: [5, 5, 5] });

      // Update layer render settings
      layerStore.updateLayerRender('overlay-1', {
        opacity: 0.7,
        intensity: [10, 90] as [number, number],
        colormap: 'hot'
      });

      // Assert - All state should be consistent
      expect(layerStore.getState().layers).toHaveLength(2);
      expect(layerStore.getState().selectedLayerId).toBe('overlay-1');
      expect(annotationStore.getState().annotations).toHaveLength(2);
      expect(annotationStore.getState().selectedAnnotations).toContain('roi-1');
      expect(viewStateStore.getState().crosshair.world_mm).toEqual([5, 5, 5]);
      
      const overlayRender = layerStore.getState().layerRender.get('overlay-1');
      expect(overlayRender?.opacity).toBe(0.7);
      expect(overlayRender?.colormap).toBe('hot');
    });
  });

  describe('State Persistence and Recovery', () => {
    it('should handle store reset and recovery scenarios', () => {
      // Arrange - Set up complex state
      const layer: Layer = {
        id: 'persistent-layer',
        name: 'Persistent Layer',
        type: 'volume',
        visible: true,
        source: { type: 'file', path: '/persistent.nii' }
      };

      const annotation: Marker = {
        id: 'persistent-marker',
        type: 'marker',
        world_mm: [100, 200, 300],
        symbol: 'diamond',
        size: 15,
        visible: true,
        selected: true,
        style: { color: '#800080' }
      };

      // Set up state
      layerStore.addLayer(layer);
      annotationStore.addAnnotation(annotation);
      viewStateStore.updateCrosshair({ world_mm: [100, 200, 300] });

      // Verify initial state
      expect(layerStore.getState().layers).toHaveLength(1);
      expect(annotationStore.getState().annotations).toHaveLength(1);

      // Act - Reset stores
      layerStore.clearLayers();
      annotationStore.clearAllAnnotations();
      viewStateStore.resetToDefaults();

      // Assert - Stores should be reset
      expect(layerStore.getState().layers).toHaveLength(0);
      expect(annotationStore.getState().annotations).toHaveLength(0);
      expect(viewStateStore.getState().crosshair.world_mm).toEqual([0, 0, 0]);

      // Act - Restore state
      layerStore.addLayer(layer);
      annotationStore.addAnnotation(annotation);
      viewStateStore.updateCrosshair({ world_mm: [100, 200, 300] });

      // Assert - State should be restored
      expect(layerStore.getState().layers).toHaveLength(1);
      expect(layerStore.getState().layers[0].id).toBe('persistent-layer');
      expect(annotationStore.getState().annotations).toHaveLength(1);
      expect(annotationStore.getState().annotations[0].id).toBe('persistent-marker');
      expect(viewStateStore.getState().crosshair.world_mm).toEqual([100, 200, 300]);
    });
  });
});