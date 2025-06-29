<script lang="ts">
  /**
   * AnnotationHandler - Handles annotation creation based on active tool
   * 
   * This component manages the interaction between the annotation toolbar
   * and the slice viewer, creating annotations based on the active tool mode
   */
  import { annotationStore } from '$lib/stores/annotationStore';
  import type { Vec3 } from '$lib/geometry/types';
  import type { 
    TextAnnotation, 
    MarkerAnnotation, 
    LineAnnotation, 
    ROIAnnotation,
    MeasurementAnnotation 
  } from '$lib/types/annotations';
  
  export let onViewClick: ((world: Vec3) => void) | null = null;
  
  // Track state for multi-click tools
  let lineStartPoint: Vec3 | null = null;
  let measurementPoints: Vec3[] = [];
  
  // Get current tool mode
  let activeMode = annotationStore.getState().activeToolMode;
  
  annotationStore.subscribe((state) => {
    activeMode = state.activeToolMode;
    
    // Reset multi-click state when changing tools
    if (activeMode !== 'line') lineStartPoint = null;
    if (!activeMode?.startsWith('measure')) measurementPoints = [];
  });
  
  export function handleClick(world: Vec3) {
    if (!activeMode || activeMode === 'select') {
      // In select mode, just pass through the click
      onViewClick?.(world);
      return;
    }
    
    const store = annotationStore.getState();
    
    switch (activeMode) {
      case 'text':
        const text = prompt('Enter annotation text:');
        if (text) {
          store.addAnnotation({
            type: 'text',
            worldCoord: world,
            text,
            visible: true,
            color: '#00ff00',
            fontSize: 14,
            anchor: 'center',
            offset: { x: 0, y: -20 }
          });
        }
        break;
        
      case 'marker':
        store.addAnnotation({
          type: 'marker',
          worldCoord: world,
          style: 'cross',
          size: 10,
          color: '#ff0000',
          visible: true,
          filled: false
        });
        break;
        
      case 'line':
        if (!lineStartPoint) {
          // First click - set start point
          lineStartPoint = world;
          
          // Add temporary marker to show start point
          store.addAnnotation({
            type: 'marker',
            worldCoord: world,
            style: 'circle',
            size: 6,
            color: '#ffff00',
            visible: true,
            filled: true,
            userData: { temp: true }
          });
        } else {
          // Second click - create line
          store.addAnnotation({
            type: 'line',
            worldCoord: lineStartPoint,
            endCoord: world,
            color: '#00ffff',
            strokeWidth: 2,
            visible: true
          });
          
          // Remove temporary marker
          const tempMarkers = Array.from(store.annotations.values())
            .filter(a => a.userData?.temp === true);
          store.removeAnnotations(tempMarkers.map(a => a.id));
          
          // Reset
          lineStartPoint = null;
        }
        break;
        
      case 'circle':
        const radius = prompt('Enter radius in mm:', '10');
        if (radius && !isNaN(parseFloat(radius))) {
          store.addAnnotation({
            type: 'roi',
            worldCoord: world,
            shape: 'circle',
            dimensions: { radius: parseFloat(radius) },
            color: '#ff00ff',
            strokeWidth: 2,
            filled: false,
            visible: true
          });
        }
        break;
        
      case 'rectangle':
        const width = prompt('Enter width in mm:', '20');
        const height = prompt('Enter height in mm:', '20');
        if (width && height && !isNaN(parseFloat(width)) && !isNaN(parseFloat(height))) {
          store.addAnnotation({
            type: 'roi',
            worldCoord: world,
            shape: 'rectangle',
            dimensions: { 
              width: parseFloat(width), 
              height: parseFloat(height) 
            },
            color: '#00ff00',
            strokeWidth: 2,
            filled: false,
            visible: true
          });
        }
        break;
        
      case 'measure-distance':
        if (measurementPoints.length === 0) {
          // First point
          measurementPoints = [world];
          
          // Add temporary marker
          store.addAnnotation({
            type: 'marker',
            worldCoord: world,
            style: 'circle',
            size: 6,
            color: '#ffff00',
            visible: true,
            filled: true,
            userData: { temp: true }
          });
        } else {
          // Second point - create measurement
          store.addAnnotation({
            type: 'measurement',
            worldCoord: measurementPoints[0],
            measurementType: 'distance',
            points: [measurementPoints[0], world],
            color: '#ffff00',
            strokeWidth: 2,
            showValue: true,
            unit: 'mm',
            precision: 1,
            visible: true
          });
          
          // Remove temporary markers
          const tempMarkers = Array.from(store.annotations.values())
            .filter(a => a.userData?.temp === true);
          store.removeAnnotations(tempMarkers.map(a => a.id));
          
          // Reset
          measurementPoints = [];
        }
        break;
    }
  }
  
  // Export function to cancel multi-click operations
  export function cancelOperation() {
    const store = annotationStore.getState();
    
    // Remove any temporary markers
    const tempMarkers = Array.from(store.annotations.values())
      .filter(a => a.userData?.temp === true);
    store.removeAnnotations(tempMarkers.map(a => a.id));
    
    // Reset state
    lineStartPoint = null;
    measurementPoints = [];
  }
</script>