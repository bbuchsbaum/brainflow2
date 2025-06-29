<!--
  SliceViewerGPU Component - Migrated to new architecture
  GPU-accelerated slice viewer with event-driven annotation support
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { getService } from '$lib/di/Container';
  import { getEventBus } from '$lib/events/EventBus';
  import type { LayerService } from '$lib/services/LayerService';
  import type { AnnotationService } from '$lib/services/AnnotationService';
  import type { NotificationService } from '$lib/services/NotificationService';
  import type { EventBus } from '$lib/events/EventBus';
  import { annotationStore } from '$lib/stores/annotationStore';
  import { GpuRenderManager } from '$lib/gpu/renderManager';
  import type { ViewFrameExplicit, Vec2, Vec3, Plane } from '$lib/geometry/types';
  import { 
    screenToWorld, 
    worldToScreen, 
    pan as panFrame, 
    zoomAroundPoint,
    createFrameVersionGenerator,
    makeFrameExplicit
  } from '$lib/geometry/viewFrameExplicit';
  import type { VolumeMeta } from '$lib/geometry/types';
  import { AnnotationRenderer } from './annotations/AnnotationRenderer';
  import type { Annotation } from '$lib/types/annotations';
  
  // Props
  let {
    volumeMeta,
    plane = 'axial',
    sliceMm = 0,
    zoom = 1,
    pan = { x: 0, y: 0 },
    crosshairWorld = null,
    showCrosshair = true,
    layers = [],
    onFrameChange = null,
    onAnnotationClick = null,
    onWorldClick = null
  }: {
    volumeMeta: VolumeMeta;
    plane?: Plane;
    sliceMm?: number;
    zoom?: number;
    pan?: Vec2;
    crosshairWorld?: Vec3 | null;
    showCrosshair?: boolean;
    layers?: Array<{
      volumeId: string;
      colormapId: number;
      opacity: number;
      window: { level: number; width: number };
    }>;
    onFrameChange?: ((frame: ViewFrameExplicit) => void) | null;
    onAnnotationClick?: ((annotation: Annotation, world: Vec3, screen: Vec2) => void) | null;
    onWorldClick?: ((world: Vec3, screen: Vec2) => void) | null;
  } = $props();

  // Services
  let layerService: LayerService | null = null;
  let annotationService: AnnotationService | null = null;
  let notificationService: NotificationService | null = null;
  let eventBus: EventBus = getEventBus();

  // DOM elements
  let container: HTMLDivElement;
  let baseImage: HTMLImageElement;
  let overlayCanvas: HTMLCanvasElement;
  let overlayCtx: CanvasRenderingContext2D | null = null;

  // Dimensions
  let width = $state(512);
  let height = $state(512);
  
  // State
  let frame = $state<ViewFrameExplicit | null>(null);
  let renderManager = $state<GpuRenderManager | null>(null);
  let imageUrl = $state<string | null>(null);
  let isRendering = $state(false);
  let lastRenderTime = $state(0);
  let renderError = $state<Error | null>(null);
  
  // Annotation state
  let annotationRenderer = $state<AnnotationRenderer | null>(null);
  let annotationStoreState = $state(annotationStore.getState());
  
  // Derived values
  let visibleAnnotations = $derived(annotationStoreState.getVisibleAnnotations());
  let selectedAnnotationIds = $derived(annotationStoreState.selectedAnnotationIds);
  let hoveredAnnotationId = $derived(annotationStoreState.hoveredAnnotationId);
  let activeToolMode = $derived(annotationStoreState.activeToolMode);
  
  // Mouse interaction state
  let isDragging = $state(false);
  let lastMousePos = $state<Vec2 | null>(null);
  let cursor = $state('crosshair');
  
  const getNextVersion = createFrameVersionGenerator();
  
  // Initialize GPU render manager
  async function initializeRenderManager() {
    try {
      renderManager = new GpuRenderManager();
      await renderManager.initialize();
      
      // Set up overlay canvas context
      overlayCtx = overlayCanvas.getContext('2d');
      
      // Initialize annotation renderer
      annotationRenderer = new AnnotationRenderer({
        defaultColor: '#00ff00',
        selectedColor: '#ffff00',
        hoveredColor: '#ff00ff',
        shadowBlur: 2,
      });
      
      eventBus.emit('sliceviewer.gpu.initialized', { plane });
    } catch (error) {
      console.error('[SliceViewerGPU] Failed to initialize GPU:', error);
      renderError = error instanceof Error ? error : new Error('GPU initialization failed');
      notificationService?.error('Failed to initialize GPU rendering', { error: renderError });
    }
  }
  
  // Update frame when parameters change
  function updateFrame() {
    if (!volumeMeta || !renderManager || width === 0 || height === 0) return;
    
    frame = makeFrameExplicit(
      volumeMeta,
      plane,
      sliceMm,
      zoom,
      pan,
      { x: width, y: height },
      getNextVersion
    );
    
    onFrameChange?.(frame);
    eventBus.emit('sliceviewer.frame.updated', { plane, frame });
    
    requestRender();
  }
  
  // Request GPU render
  async function requestRender() {
    if (!renderManager || !frame || isRendering) return;
    
    isRendering = true;
    
    try {
      const startTime = performance.now();
      
      const result = await renderManager.render({
        frame,
        layers: layers.map(l => ({
          ...l,
          threshold: undefined,
          blendMode: 'over' as const
        })),
        showCrosshair,
        crosshairWorld: crosshairWorld || [0, 0, 0]
      });
      
      // Convert PNG data to blob URL
      const blob = new Blob([result.imageData], { type: 'image/png' });
      const newUrl = URL.createObjectURL(blob);
      
      // Clean up old URL
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }
      
      imageUrl = newUrl;
      lastRenderTime = performance.now() - startTime;
      
      // Update overlay after image loads
      if (baseImage) {
        baseImage.onload = () => drawOverlay();
      }
      
      eventBus.emit('sliceviewer.render.complete', { 
        plane, 
        renderTimeMs: lastRenderTime 
      });
    } catch (error) {
      console.error('[SliceViewerGPU] GPU render failed:', error);
      renderError = error instanceof Error ? error : new Error('Render failed');
      eventBus.emit('sliceviewer.render.error', { plane, error: renderError });
    } finally {
      isRendering = false;
    }
  }
  
  // Draw overlay annotations
  function drawOverlay() {
    if (!overlayCtx || !frame) return;
    
    overlayCtx.clearRect(0, 0, width, height);
    
    // Draw crosshair if enabled
    if (showCrosshair && crosshairWorld) {
      const screenPos = worldToScreen(frame, crosshairWorld);
      if (screenPos) {
        overlayCtx.strokeStyle = '#00ff00';
        overlayCtx.lineWidth = 1;
        overlayCtx.beginPath();
        
        // Horizontal line
        overlayCtx.moveTo(0, screenPos.y);
        overlayCtx.lineTo(width, screenPos.y);
        
        // Vertical line
        overlayCtx.moveTo(screenPos.x, 0);
        overlayCtx.lineTo(screenPos.x, height);
        
        overlayCtx.stroke();
      }
    }
    
    // Draw annotations
    if (annotationRenderer && visibleAnnotations.length > 0) {
      // Filter annotations to only show those on or near the current slice
      const sliceAnnotations = filterAnnotationsForSlice(visibleAnnotations, plane, sliceMm);
      
      annotationRenderer.render(
        overlayCtx,
        sliceAnnotations,
        frame,
        selectedAnnotationIds,
        hoveredAnnotationId
      );
    }
    
    // Draw render time indicator if enabled
    const showStats = annotationService?.configService?.get('debug.showRenderStats', false);
    if (showStats && lastRenderTime > 0) {
      overlayCtx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      overlayCtx.font = '12px monospace';
      overlayCtx.fillText(`${lastRenderTime.toFixed(1)}ms`, 5, height - 5);
    }
  }
  
  // Filter annotations based on slice position
  function filterAnnotationsForSlice(annotations: Annotation[], plane: Plane, sliceMm: number, tolerance = 5): Annotation[] {
    return annotations.filter(annotation => {
      const coord = annotation.worldCoord;
      
      switch (plane) {
        case 'axial':
          return Math.abs(coord.z - sliceMm) <= tolerance;
        case 'coronal':
          return Math.abs(coord.y - sliceMm) <= tolerance;
        case 'sagittal':
          return Math.abs(coord.x - sliceMm) <= tolerance;
        default:
          return true;
      }
    });
  }
  
  // Find annotation at position
  function findAnnotationAtPosition(world: Vec3, screen: Vec2): Annotation | null {
    const sliceAnnotations = filterAnnotationsForSlice(visibleAnnotations, plane, sliceMm);
    
    // Check in reverse order (top to bottom)
    for (let i = sliceAnnotations.length - 1; i >= 0; i--) {
      const annotation = sliceAnnotations[i];
      const annotationScreen = worldToScreen(frame!, annotation.worldCoord);
      
      if (!annotationScreen) continue;
      
      // Simple distance check - can be refined per annotation type
      const distance = Math.sqrt(
        Math.pow(screen.x - annotationScreen.x, 2) + 
        Math.pow(screen.y - annotationScreen.y, 2)
      );
      
      // Adjust hit tolerance based on annotation type
      let tolerance = 10;
      if (annotation.type === 'marker') {
        tolerance = (annotation as any).size / 2 + 5;
      } else if (annotation.type === 'text') {
        tolerance = 20;
      }
      
      if (distance <= tolerance) {
        return annotation;
      }
    }
    
    return null;
  }
  
  // Mouse event handlers
  function handleMouseDown(e: MouseEvent) {
    if (e.button === 0) { // Left button
      isDragging = true;
      lastMousePos = { x: e.clientX, y: e.clientY };
      e.preventDefault();
      
      eventBus.emit('sliceviewer.interaction.start', { plane, type: 'drag' });
    }
  }
  
  function handleMouseMove(e: MouseEvent) {
    if (!frame) return;
    
    const rect = container.getBoundingClientRect();
    const screen: Vec2 = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
    
    if (isDragging && lastMousePos) {
      const dx = e.clientX - lastMousePos.x;
      const dy = e.clientY - lastMousePos.y;
      
      // Pan the view
      frame = panFrame(frame, -dx, -dy, getNextVersion);
      onFrameChange?.(frame);
      
      lastMousePos = { x: e.clientX, y: e.clientY };
      requestRender();
      
      eventBus.emit('sliceviewer.pan', { plane, dx: -dx, dy: -dy });
    } else {
      // Check for annotation hover
      const world = screenToWorld(frame, screen);
      const hoveredAnnotation = findAnnotationAtPosition(world, screen);
      
      if (hoveredAnnotation) {
        if (hoveredAnnotation.id !== hoveredAnnotationId) {
          annotationService?.setHoveredAnnotation(hoveredAnnotation.id);
          cursor = 'pointer';
        }
      } else if (hoveredAnnotationId) {
        annotationService?.setHoveredAnnotation(null);
        cursor = activeToolMode && activeToolMode !== 'select' ? 'crosshair' : 'default';
      }
      
      // Emit mouse world coordinate for status bar
      eventBus.emit('mouse.worldcoord', { coord: world });
    }
  }
  
  function handleMouseUp(e: MouseEvent) {
    if (e.button === 0 && !isDragging && frame) {
      // Click event - convert to world coordinates
      const rect = container.getBoundingClientRect();
      const screen: Vec2 = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
      
      const world = screenToWorld(frame, screen);
      
      // Check if clicking on annotation
      const clickedAnnotation = findAnnotationAtPosition(world, screen);
      if (clickedAnnotation) {
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
          // Multi-select
          annotationService?.selectAnnotation(clickedAnnotation.id, true);
        } else {
          // Single select
          annotationService?.selectAnnotation(clickedAnnotation.id, false);
        }
        
        // Call prop callback
        onAnnotationClick?.(clickedAnnotation, world, screen);
        
        // Emit event
        eventBus.emit('sliceviewer.annotation.clicked', { 
          plane,
          annotation: clickedAnnotation,
          world,
          screen
        });
      } else {
        // Clear selection if not clicking on annotation
        if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
          annotationService?.clearSelection();
        }
        
        // Handle tool mode actions
        if (activeToolMode && activeToolMode !== 'select') {
          handleToolAction(activeToolMode, world, screen);
        }
        
        // Call prop callback
        onWorldClick?.(world, screen);
        
        // Emit regular click event
        eventBus.emit('sliceviewer.world.clicked', { plane, world, screen });
      }
    }
    
    isDragging = false;
    lastMousePos = null;
    
    eventBus.emit('sliceviewer.interaction.end', { plane, type: 'drag' });
  }
  
  function handleWheel(e: WheelEvent) {
    if (!frame) return;
    
    e.preventDefault();
    
    // Get mouse position in screen coordinates
    const rect = container.getBoundingClientRect();
    const screen: Vec2 = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
    
    // Convert to world coordinates for zoom focal point
    const worldPoint = screenToWorld(frame, screen);
    
    // Calculate zoom factor
    const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
    
    // Zoom around the mouse position
    frame = zoomAroundPoint(frame, worldPoint, zoomDelta, getNextVersion);
    onFrameChange?.(frame);
    
    requestRender();
    
    eventBus.emit('sliceviewer.zoom', { 
      plane,
      factor: zoomDelta,
      focal: worldPoint
    });
  }
  
  // Handle tool actions
  async function handleToolAction(tool: string, world: Vec3, screen: Vec2) {
    if (!annotationService) return;
    
    try {
      switch (tool) {
        case 'text':
          const text = prompt('Enter annotation text:');
          if (text) {
            await annotationService.addAnnotation({
              type: 'text',
              worldCoord: world,
              text,
              layerId: layers[0]?.volumeId
            });
          }
          break;
          
        case 'marker':
          await annotationService.addAnnotation({
            type: 'marker',
            worldCoord: world,
            style: 'cross',
            size: 10,
            color: '#ff0000',
            layerId: layers[0]?.volumeId
          });
          break;
          
        // Add more tool handlers as needed
      }
    } catch (error) {
      console.error('[SliceViewerGPU] Tool action failed:', error);
      notificationService?.error(`Failed to create ${tool} annotation`);
    }
  }
  
  // Subscribe to events
  let eventUnsubscribes: Array<() => void> = [];
  
  function subscribeToEvents() {
    // Re-render when layers change
    eventUnsubscribes.push(
      eventBus.on('layer.opacity.changed', () => requestRender())
    );
    
    eventUnsubscribes.push(
      eventBus.on('layer.colormap.changed', () => requestRender())
    );
    
    eventUnsubscribes.push(
      eventBus.on('layer.windowlevel.changed', () => requestRender())
    );
    
    // Re-draw overlay when annotations change
    eventUnsubscribes.push(
      eventBus.on('annotation.added', () => drawOverlay())
    );
    
    eventUnsubscribes.push(
      eventBus.on('annotation.updated', () => drawOverlay())
    );
    
    eventUnsubscribes.push(
      eventBus.on('annotation.removed', () => drawOverlay())
    );
    
    eventUnsubscribes.push(
      eventBus.on('annotation.visibility.changed', () => drawOverlay())
    );
    
    eventUnsubscribes.push(
      eventBus.on('annotation.selected', () => drawOverlay())
    );
    
    eventUnsubscribes.push(
      eventBus.on('annotation.hover.changed', () => drawOverlay())
    );
  }
  
  // Effects
  $effect(() => {
    if (volumeMeta && renderManager) {
      updateFrame();
    }
  });
  
  $effect(() => {
    // Update cursor based on tool mode
    if (activeToolMode && activeToolMode !== 'select') {
      cursor = 'crosshair';
    } else if (hoveredAnnotationId) {
      cursor = 'pointer';
    } else {
      cursor = 'default';
    }
  });
  
  // Lifecycle
  onMount(async () => {
    try {
      // Get services
      [layerService, annotationService, notificationService] = await Promise.all([
        getService<LayerService>('layerService'),
        getService<AnnotationService>('annotationService'),
        getService<NotificationService>('notificationService')
      ]);
      
      // Subscribe to annotation store
      const unsubscribeAnnotations = annotationStore.subscribe((state) => {
        annotationStoreState = state;
      });
      
      // Initialize GPU
      await initializeRenderManager();
      
      // Initial render
      updateFrame();
      
      // Set up resize observer
      const resizeObserver = new ResizeObserver(entries => {
        const entry = entries[0];
        if (entry) {
          const rect = entry.contentRect;
          width = Math.floor(rect.width);
          height = Math.floor(rect.height);
          updateFrame();
        }
      });
      resizeObserver.observe(container);
      
      // Subscribe to events
      subscribeToEvents();
      
      // Cleanup
      return () => {
        resizeObserver.disconnect();
        unsubscribeAnnotations();
        eventUnsubscribes.forEach(fn => fn());
        renderManager?.dispose();
        if (imageUrl) {
          URL.revokeObjectURL(imageUrl);
        }
      };
    } catch (error) {
      console.error('[SliceViewerGPU] Failed to initialize:', error);
      renderError = error instanceof Error ? error : new Error('Failed to initialize');
    }
  });
</script>

<div 
  bind:this={container}
  class="slice-viewer-gpu"
  class:error={renderError}
  onmousedown={handleMouseDown}
  onmousemove={handleMouseMove}
  onmouseup={handleMouseUp}
  onmouseleave={handleMouseUp}
  onwheel={handleWheel}
  style:cursor={cursor}
  role="img"
  aria-label="Slice view of {plane} plane at {sliceMm}mm"
>
  {#if renderError}
    <div class="error-message">
      <p>Rendering Error</p>
      <p class="details">{renderError.message}</p>
    </div>
  {:else}
    <!-- Base image layer -->
    {#if imageUrl}
      <img 
        bind:this={baseImage}
        src={imageUrl} 
        alt="Slice view"
        class="base-image"
        style="width: {width}px; height: {height}px;"
      />
    {/if}
    
    <!-- Overlay canvas for annotations -->
    <canvas 
      bind:this={overlayCanvas}
      width={width}
      height={height}
      class="overlay-canvas"
    />
    
    <!-- Loading indicator -->
    {#if isRendering}
      <div class="loading-indicator">
        <div class="spinner" />
      </div>
    {/if}
  {/if}
</div>

<style>
  .slice-viewer-gpu {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #000;
    user-select: none;
  }
  
  .slice-viewer-gpu.error {
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  .error-message {
    text-align: center;
    color: var(--color-error, #ff6b6b);
    padding: 2rem;
  }
  
  .error-message .details {
    font-size: 0.875rem;
    margin-top: 0.5rem;
    opacity: 0.8;
  }
  
  .base-image {
    position: absolute;
    top: 0;
    left: 0;
    image-rendering: pixelated; /* Preserve pixel accuracy */
    user-select: none;
    pointer-events: none;
  }
  
  .overlay-canvas {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
  }
  
  .loading-indicator {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    pointer-events: none;
  }
  
  .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid rgba(255, 255, 255, 0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>