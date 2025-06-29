<script lang="ts">
  /**
   * Annotation Demo - Demonstrates the annotation system
   * 
   * This page shows how to use the annotation system with SliceViewerGPU
   */
  import { onMount } from 'svelte';
  import SliceViewerGPU from '$lib/components/SliceViewerGPU.svelte';
  import AnnotationToolbar from '$lib/components/annotations/AnnotationToolbar.svelte';
  import AnnotationHandler from '$lib/components/annotations/AnnotationHandler.svelte';
  import type { VolumeMeta, Vec3, Plane } from '$lib/geometry/types';
  import { annotationStore } from '$lib/stores/annotationStore';
  
  // Demo volume metadata
  const volumeMeta: VolumeMeta = {
    dims: { x: 256, y: 256, z: 256 },
    origin: { x: -128, y: -128, z: -128 },
    spacing: { x: 1, y: 1, z: 1 },
    direction: [
      1, 0, 0,
      0, 1, 0,
      0, 0, 1
    ]
  };
  
  // View state
  let plane: Plane = 'axial';
  let sliceMm = 0;
  let zoom = 1;
  let pan = { x: 0, y: 0 };
  let crosshairWorld: Vec3 = { x: 0, y: 0, z: 0 };
  
  // Annotation handler
  let annotationHandler: AnnotationHandler;
  
  // Handle clicks from the viewer
  function handleViewerClick(event: CustomEvent<{ world: Vec3 }>) {
    if (annotationHandler) {
      annotationHandler.handleClick(event.detail.world);
    }
    
    // Update crosshair
    crosshairWorld = event.detail.world;
  }
  
  // Add some demo annotations
  onMount(() => {
    const store = annotationStore.getState();
    
    // Add a text annotation
    store.addAnnotation({
      type: 'text',
      worldCoord: { x: 0, y: 0, z: 0 },
      text: 'Center of brain',
      visible: true,
      color: '#00ff00',
      fontSize: 16,
      anchor: 'center',
      offset: { x: 0, y: -25 }
    });
    
    // Add some markers
    store.addAnnotation({
      type: 'marker',
      worldCoord: { x: 30, y: 0, z: 0 },
      style: 'cross',
      size: 12,
      color: '#ff0000',
      visible: true
    });
    
    store.addAnnotation({
      type: 'marker',
      worldCoord: { x: -30, y: 0, z: 0 },
      style: 'circle',
      size: 10,
      color: '#0000ff',
      visible: true,
      filled: true
    });
    
    // Add a line
    store.addAnnotation({
      type: 'line',
      worldCoord: { x: -50, y: -50, z: 0 },
      endCoord: { x: 50, y: 50, z: 0 },
      color: '#ffff00',
      strokeWidth: 2,
      visible: true,
      dashed: true,
      label: 'Diagonal'
    });
    
    // Add a circular ROI
    store.addAnnotation({
      type: 'roi',
      worldCoord: { x: 0, y: 40, z: 0 },
      shape: 'circle',
      dimensions: { radius: 20 },
      color: '#ff00ff',
      strokeWidth: 2,
      filled: true,
      fillOpacity: 0.2,
      visible: true,
      label: 'ROI 1'
    });
    
    // Add a measurement
    store.addAnnotation({
      type: 'measurement',
      worldCoord: { x: -60, y: 0, z: 0 },
      measurementType: 'distance',
      points: [
        { x: -60, y: 0, z: 0 },
        { x: 60, y: 0, z: 0 }
      ],
      color: '#00ffff',
      strokeWidth: 2,
      showValue: true,
      unit: 'mm',
      precision: 1,
      visible: true
    });
    
    // Cleanup on unmount
    return () => {
      store.clearAnnotations();
    };
  });
  
  // Keyboard shortcuts
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      annotationHandler?.cancelOperation();
      annotationStore.getState().setActiveToolMode('select');
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      const store = annotationStore.getState();
      const selectedIds = Array.from(store.selectedAnnotationIds);
      if (selectedIds.length > 0) {
        store.removeAnnotations(selectedIds);
      }
    } else if (e.ctrlKey || e.metaKey) {
      if (e.key === 'a') {
        e.preventDefault();
        annotationStore.getState().selectAll();
      } else if (e.key === 'd') {
        e.preventDefault();
        const store = annotationStore.getState();
        store.getSelectedAnnotations().forEach(annotation => {
          store.duplicateAnnotation(annotation.id, { x: 10, y: 10, z: 0 });
        });
      }
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="demo-container">
  <header>
    <h1>Annotation System Demo</h1>
    <p>Use the toolbar below to add annotations to the slice viewer</p>
  </header>
  
  <div class="toolbar-container">
    <AnnotationToolbar />
  </div>
  
  <div class="viewer-container">
    <SliceViewerGPU
      {volumeMeta}
      {plane}
      {sliceMm}
      {zoom}
      {pan}
      {crosshairWorld}
      showCrosshair={true}
      on:click={handleViewerClick}
      on:pan={(e) => pan = { x: pan.x + e.detail.dx, y: pan.y + e.detail.dy }}
      on:zoom={(e) => zoom *= e.detail.factor}
    />
  </div>
  
  <div class="controls">
    <label>
      Plane:
      <select bind:value={plane}>
        <option value="axial">Axial</option>
        <option value="coronal">Coronal</option>
        <option value="sagittal">Sagittal</option>
      </select>
    </label>
    
    <label>
      Slice (mm):
      <input 
        type="range" 
        bind:value={sliceMm}
        min={-128}
        max={127}
        step={1}
      />
      <span>{sliceMm.toFixed(0)}</span>
    </label>
    
    <label>
      Zoom:
      <input 
        type="range" 
        bind:value={zoom}
        min={0.1}
        max={5}
        step={0.1}
      />
      <span>{zoom.toFixed(1)}x</span>
    </label>
  </div>
  
  <div class="instructions">
    <h2>Instructions:</h2>
    <ul>
      <li><strong>Select tool:</strong> Click and drag to pan, click to select annotations</li>
      <li><strong>Text tool:</strong> Click to add a text label</li>
      <li><strong>Marker tool:</strong> Click to add a marker</li>
      <li><strong>Line tool:</strong> Click twice to draw a line</li>
      <li><strong>Circle/Rectangle:</strong> Click to place ROI, enter dimensions</li>
      <li><strong>Distance tool:</strong> Click twice to measure distance</li>
      <li><strong>Keyboard shortcuts:</strong>
        <ul>
          <li>Escape: Cancel current operation</li>
          <li>Delete: Delete selected annotations</li>
          <li>Ctrl+A: Select all</li>
          <li>Ctrl+D: Duplicate selected</li>
        </ul>
      </li>
    </ul>
  </div>
</div>

<!-- Hidden annotation handler -->
<AnnotationHandler bind:this={annotationHandler} />

<style>
  .demo-container {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: #1a1a1a;
    color: white;
    font-family: system-ui, -apple-system, sans-serif;
  }
  
  header {
    padding: 1rem;
    text-align: center;
    border-bottom: 1px solid #333;
  }
  
  h1 {
    margin: 0 0 0.5rem 0;
    font-size: 1.5rem;
  }
  
  p {
    margin: 0;
    color: #aaa;
  }
  
  .toolbar-container {
    display: flex;
    justify-content: center;
    padding: 1rem;
    border-bottom: 1px solid #333;
  }
  
  .viewer-container {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 0;
    background: #0a0a0a;
  }
  
  .controls {
    display: flex;
    gap: 2rem;
    padding: 1rem;
    border-top: 1px solid #333;
    justify-content: center;
    align-items: center;
  }
  
  label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  
  select, input[type="range"] {
    background: #333;
    color: white;
    border: 1px solid #555;
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
  }
  
  .instructions {
    padding: 1rem;
    background: rgba(0, 0, 0, 0.5);
    border-top: 1px solid #333;
    max-height: 200px;
    overflow-y: auto;
  }
  
  .instructions h2 {
    margin: 0 0 0.5rem 0;
    font-size: 1rem;
  }
  
  .instructions ul {
    margin: 0;
    padding-left: 1.5rem;
  }
  
  .instructions li {
    margin: 0.25rem 0;
    font-size: 0.875rem;
  }
  
  .instructions ul ul {
    margin-top: 0.25rem;
  }
</style>