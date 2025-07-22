import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useLayerStore } from '../stores/layerStore';
import { useViewStateStore } from '../stores/viewStateStore';
import { useAnnotationStore } from '../stores/annotationStore';
import { useFileBrowserStore } from '../stores/fileBrowserStore';
import { LayerService } from '../services/LayerService';
import { CrosshairService } from '../services/CrosshairService';
import { EventBus } from '../events/EventBus';
import type { Layer, LayerRender } from '../types/layers';
import type { Annotation, Marker, ROI } from '../types/annotations';
import type { WorldCoordinates, ViewPlane } from '../types/coordinates';

// Mock the EventBus
vi.mock('../events/EventBus', () => ({
  EventBus: {
    getInstance: vi.fn(() => ({
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      removeAllListeners: vi.fn()
    }))
  }
}));

describe('End-to-End Integration Tests', () => {
  let layerStore: ReturnType<typeof useLayerStore>;
  let viewStateStore: ReturnType<typeof useViewStateStore>;
  let annotationStore: ReturnType<typeof useAnnotationStore>;
  let fileBrowserStore: ReturnType<typeof useFileBrowserStore>;
  let layerService: LayerService;
  let crosshairService: CrosshairService;
  let eventBus: EventBus;

  beforeEach(() => {
    // Get fresh instances
    layerStore = useLayerStore.getState();
    viewStateStore = useViewStateStore.getState();
    annotationStore = useAnnotationStore.getState();
    fileBrowserStore = useFileBrowserStore.getState();
    layerService = LayerService.getInstance();
    crosshairService = CrosshairService.getInstance();
    eventBus = EventBus.getInstance();

    // Reset all stores
    layerStore.clearLayers();
    viewStateStore.resetToDefaults();
    annotationStore.clearAllAnnotations();
    fileBrowserStore.resetToDefaults();
  });

  describe('Complete Neuroimaging Workflow', () => {
    it('should handle a complete volume loading and analysis workflow', async () => {
      // Arrange - Simulate BIDS dataset structure
      const bidsFiles = [
        '/data/sub-01/anat/sub-01_T1w.nii.gz',
        '/data/sub-01/func/sub-01_task-rest_bold.nii.gz',
        '/data/sub-01/dwi/sub-01_dwi.nii.gz',
        '/data/derivatives/fmriprep/sub-01/func/sub-01_task-rest_space-MNI152NLin2009cAsym_desc-preproc_bold.nii.gz'
      ];

      // STEP 1: File Browser - Navigate and select files
      bidsFiles.forEach(file => {
        fileBrowserStore.addToFileTree(file);
      });

      // Select anatomical and functional files
      fileBrowserStore.selectFile(bidsFiles[0]); // T1w
      fileBrowserStore.selectFile(bidsFiles[1]); // BOLD

      expect(fileBrowserStore.getState().selectedFiles).toHaveLength(2);

      // STEP 2: Layer Loading - Load selected files as layers
      const anatomicalLayer: Layer = {
        id: 'anat-t1w',
        name: 'T1w Anatomical',
        type: 'volume',
        visible: true,
        source: { type: 'file', path: bidsFiles[0] }
      };

      const functionalLayer: Layer = {
        id: 'func-bold',
        name: 'BOLD Functional',
        type: 'overlay',
        visible: true,
        source: { type: 'file', path: bidsFiles[1] }
      };

      layerStore.addLayer(anatomicalLayer);
      layerStore.addLayer(functionalLayer);

      expect(layerStore.getState().layers).toHaveLength(2);

      // STEP 3: Layer Configuration - Set up render parameters
      const anatomicalRender: LayerRender = {
        opacity: 1.0,
        intensity: [0, 255] as [number, number],
        threshold: [10, 245] as [number, number],
        colormap: 'gray',
        interpolation: 'linear'
      };

      const functionalRender: LayerRender = {
        opacity: 0.7,
        intensity: [20, 200] as [number, number],
        threshold: [50, 150] as [number, number],
        colormap: 'hot',
        interpolation: 'linear'
      };

      layerStore.updateLayerRender(anatomicalLayer.id, anatomicalRender);
      layerStore.updateLayerRender(functionalLayer.id, functionalRender);

      // Verify render settings
      const anatRender = layerStore.getState().layerRender.get(anatomicalLayer.id);
      const funcRender = layerStore.getState().layerRender.get(functionalLayer.id);
      
      expect(anatRender).toEqual(anatomicalRender);
      expect(funcRender).toEqual(functionalRender);

      // STEP 4: View State Setup - Configure crosshair and view
      const initialCrosshairPosition: WorldCoordinates = [0, 0, 0]; // MNI center
      viewStateStore.updateCrosshair({ 
        world_mm: initialCrosshairPosition,
        visible: true 
      });

      // Select functional layer for analysis
      layerStore.selectLayer(functionalLayer.id);

      expect(viewStateStore.getState().crosshair.world_mm).toEqual(initialCrosshairPosition);
      expect(layerStore.getState().selectedLayerId).toBe(functionalLayer.id);

      // STEP 5: Interactive Analysis - Place annotations
      const roiPositions: WorldCoordinates[] = [
        [-45, -65, 30],  // Left angular gyrus
        [45, -65, 30],   // Right angular gyrus
        [0, 55, 10],     // Medial prefrontal cortex
        [-40, -20, 50]   // Left motor cortex
      ];

      const rois: ROI[] = roiPositions.map((pos, index) => ({
        id: `roi-${index + 1}`,
        type: 'roi',
        world_mm: pos,
        geometry: { type: 'sphere', params: [8] }, // 8mm radius
        visible: true,
        selected: false,
        style: { 
          color: ['#FF0000', '#00FF00', '#0000FF', '#FFFF00'][index],
          opacity: 0.6 
        }
      }));

      // Add ROIs sequentially, updating crosshair to each position
      rois.forEach((roi, index) => {
        // Move crosshair to ROI position
        crosshairService.updateWorldPosition(roi.world_mm);
        
        // Add ROI at crosshair position
        annotationStore.addAnnotation(roi);
        
        // Verify crosshair moved
        expect(viewStateStore.getState().crosshair.world_mm).toEqual(roi.world_mm);
      });

      expect(annotationStore.getState().annotations).toHaveLength(4);

      // STEP 6: ROI Analysis - Select and analyze regions
      // Select first ROI
      annotationStore.selectAnnotation(rois[0].id);
      expect(annotationStore.getState().selectedAnnotations).toContain(rois[0].id);

      // Add connectivity markers between ROIs
      const connectivityMarkers: Marker[] = [
        {
          id: 'connectivity-1-2',
          type: 'marker',
          world_mm: [0, -65, 30], // Midpoint between L/R angular
          symbol: 'diamond',
          size: 6,
          visible: true,
          selected: false,
          style: { color: '#FF00FF', opacity: 0.8 }
        },
        {
          id: 'connectivity-1-3',
          type: 'marker',
          world_mm: [-22.5, 20, 20], // Midpoint between angular and mPFC
          symbol: 'cross',
          size: 6,
          visible: true,
          selected: false,
          style: { color: '#00FFFF', opacity: 0.8 }
        }
      ];

      connectivityMarkers.forEach(marker => {
        annotationStore.addAnnotation(marker);
      });

      expect(annotationStore.getState().annotations).toHaveLength(6);

      // STEP 7: Layer Manipulation - Adjust visualization
      // Increase functional overlay opacity for better ROI visibility
      layerService.patchLayer(functionalLayer.id, { opacity: 0.9 });

      // Change colormap for better contrast
      layerService.patchLayer(functionalLayer.id, { colormap: 'viridis' });

      // Verify updates
      const updatedFuncRender = layerStore.getState().layerRender.get(functionalLayer.id);
      expect(updatedFuncRender?.opacity).toBe(0.9);
      expect(updatedFuncRender?.colormap).toBe('viridis');

      // STEP 8: Multi-View Coordination - Test view synchronization
      const viewPlanes: ViewPlane[] = [
        {
          type: 'axial',
          slice_mm: rois[0].world_mm[2], // Focus on first ROI's Z coordinate
          center_mm: rois[0].world_mm,
          u_mm: [1, 0, 0],
          v_mm: [0, 1, 0],
          normal_mm: [0, 0, 1],
          dim_px: [256, 256],
          fov_mm: [256, 256],
          origin_px: [128, 128]
        },
        {
          type: 'sagittal',
          slice_mm: rois[0].world_mm[0], // Focus on first ROI's X coordinate
          center_mm: rois[0].world_mm,
          u_mm: [0, 1, 0],
          v_mm: [0, 0, 1],
          normal_mm: [1, 0, 0],
          dim_px: [256, 256],
          fov_mm: [256, 256],
          origin_px: [128, 128]
        }
      ];

      // Test crosshair visibility in both views
      viewPlanes.forEach(plane => {
        const screenPos = crosshairService.worldToScreen(rois[0].world_mm, plane);
        expect(screenPos).toBeDefined();
        
        if (screenPos) {
          expect(screenPos[0]).toBeGreaterThanOrEqual(0);
          expect(screenPos[0]).toBeLessThanOrEqual(256);
          expect(screenPos[1]).toBeGreaterThanOrEqual(0);
          expect(screenPos[1]).toBeLessThanOrEqual(256);
        }
      });

      // STEP 9: Workflow Validation - Verify complete state consistency
      const finalState = {
        layers: layerStore.getState().layers,
        selectedLayer: layerStore.getState().selectedLayerId,
        annotations: annotationStore.getState().annotations,
        selectedAnnotations: annotationStore.getState().selectedAnnotations,
        crosshair: viewStateStore.getState().crosshair,
        selectedFiles: fileBrowserStore.getState().selectedFiles
      };

      // Validate final state
      expect(finalState.layers).toHaveLength(2);
      expect(finalState.selectedLayer).toBe(functionalLayer.id);
      expect(finalState.annotations).toHaveLength(6); // 4 ROIs + 2 connectivity markers
      expect(finalState.selectedAnnotations).toContain(rois[0].id);
      expect(finalState.crosshair.world_mm).toEqual(rois[3].world_mm); // Last ROI position
      expect(finalState.selectedFiles).toHaveLength(2);

      // Verify layer render states are properly configured
      const allLayerRenders = Array.from(layerStore.getState().layerRender.entries());
      expect(allLayerRenders).toHaveLength(2);
      
      allLayerRenders.forEach(([layerId, render]) => {
        expect(render.opacity).toBeGreaterThan(0);
        expect(render.opacity).toBeLessThanOrEqual(1);
        expect(['gray', 'hot', 'viridis'].includes(render.colormap)).toBe(true);
        expect(['nearest', 'linear'].includes(render.interpolation)).toBe(true);
      });

      // Verify annotation spatial distribution
      const annotationPositions = finalState.annotations.map(ann => ann.world_mm);
      const uniquePositions = new Set(annotationPositions.map(pos => pos.join(',')));
      expect(uniquePositions.size).toBe(6); // All annotations at different positions

      // STEP 10: Cleanup and Reset - Test workflow reset
      const resetWorkflow = () => {
        layerStore.clearLayers();
        annotationStore.clearAllAnnotations();
        viewStateStore.resetToDefaults();
        fileBrowserStore.resetToDefaults();
      };

      resetWorkflow();

      // Verify complete reset
      expect(layerStore.getState().layers).toHaveLength(0);
      expect(annotationStore.getState().annotations).toHaveLength(0);
      expect(viewStateStore.getState().crosshair.world_mm).toEqual([0, 0, 0]);
      expect(fileBrowserStore.getState().selectedFiles).toHaveLength(0);
    });

    it('should handle error scenarios gracefully in complex workflows', () => {
      // Arrange - Set up layers for error testing
      const problematicLayer: Layer = {
        id: 'error-layer',
        name: 'Problematic Layer',
        type: 'volume',
        visible: true,
        source: { type: 'file', path: '/nonexistent/file.nii' }
      };

      // STEP 1: Test layer loading error handling
      layerStore.addLayer(problematicLayer);
      
      // Simulate loading error
      const loadError = new Error('Failed to load volume: File not found');
      layerStore.setLayerError(problematicLayer.id, loadError);

      expect(layerStore.getState().errorLayers.has(problematicLayer.id)).toBe(true);
      expect(layerStore.getState().errorLayers.get(problematicLayer.id)).toBe(loadError);

      // STEP 2: Test recovery from error state
      // Attempt to retry loading (clear error)
      layerStore.clearLayerError(problematicLayer.id);
      layerStore.setLayerLoading(problematicLayer.id, true);

      expect(layerStore.getState().errorLayers.has(problematicLayer.id)).toBe(false);
      expect(layerStore.getState().loadingLayers.has(problematicLayer.id)).toBe(true);

      // Simulate successful load
      layerStore.setLayerLoading(problematicLayer.id, false);
      
      expect(layerStore.getState().loadingLayers.has(problematicLayer.id)).toBe(false);

      // STEP 3: Test annotation error handling
      const invalidAnnotation = {
        id: 'invalid-annotation',
        type: 'marker' as const,
        world_mm: [NaN, Infinity, -Infinity] as WorldCoordinates, // Invalid coordinates
        symbol: 'circle' as const,
        size: 0,
        visible: true,
        selected: false,
        style: { color: 'invalid-color' }
      };

      // Should handle invalid annotation gracefully
      expect(() => {
        annotationStore.addAnnotation(invalidAnnotation);
      }).not.toThrow();

      // STEP 4: Test coordinate transformation error handling
      const invalidPlane: ViewPlane = {
        type: 'axial',
        slice_mm: NaN,
        center_mm: [0, 0, 0],
        u_mm: [0, 0, 0], // Invalid (zero vector)
        v_mm: [0, 0, 0], // Invalid (zero vector)
        normal_mm: [0, 0, 0], // Invalid (zero vector)
        dim_px: [0, 0], // Invalid dimensions
        fov_mm: [-1, -1], // Invalid FOV
        origin_px: [NaN, NaN]
      };

      const validPosition: WorldCoordinates = [10, 20, 30];
      
      // Should handle invalid plane gracefully
      const result = crosshairService.worldToScreen(validPosition, invalidPlane);
      expect(result).toBeNull(); // Should return null for invalid transformations
    });
  });

  describe('Performance Integration Tests', () => {
    it('should handle high-volume operations efficiently', () => {
      const startTime = performance.now();

      // Create many layers
      const layerCount = 50;
      const layers: Layer[] = Array.from({ length: layerCount }, (_, i) => ({
        id: `perf-layer-${i}`,
        name: `Performance Layer ${i}`,
        type: 'overlay',
        visible: i % 2 === 0, // Alternate visibility
        source: { type: 'generated', data: `test-data-${i}` }
      }));

      layers.forEach(layer => layerStore.addLayer(layer));

      // Create many annotations
      const annotationCount = 100;
      const annotations: Annotation[] = Array.from({ length: annotationCount }, (_, i) => ({
        id: `perf-annotation-${i}`,
        type: 'marker',
        world_mm: [i, i * 2, i * 3] as WorldCoordinates,
        symbol: 'circle',
        size: 5,
        visible: true,
        selected: false,
        style: { color: `hsl(${i * 3.6}, 70%, 50%)` }
      }));

      annotations.forEach(ann => annotationStore.addAnnotation(ann));

      // Perform many rapid updates
      for (let i = 0; i < 20; i++) {
        const layerId = `perf-layer-${i}`;
        layerService.patchLayer(layerId, { 
          opacity: Math.random(),
          intensity: [Math.random() * 100, Math.random() * 100 + 100] as [number, number]
        });
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      // Verify operations completed
      expect(layerStore.getState().layers).toHaveLength(layerCount);
      expect(annotationStore.getState().annotations).toHaveLength(annotationCount);

      // Performance should be reasonable (less than 1 second for all operations)
      expect(duration).toBeLessThan(1000);

      console.log(`Performance test completed in ${duration.toFixed(2)}ms`);
    });
  });
});