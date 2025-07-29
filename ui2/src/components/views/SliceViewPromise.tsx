/**
 * SliceViewPromise Component
 * 
 * A refactored version of SliceView that uses promise-based rendering
 * instead of event-based rendering. This demonstrates the new architecture.
 * 
 * Changes from original SliceView:
 * - Uses useRenderSession instead of useRenderCanvas
 * - Direct promise-based rendering without event filtering
 * - Cleaner error handling
 * - Performance tracking built-in
 */

import React, { useEffect, useCallback, useRef } from 'react';
import { useRenderSession } from '@/hooks/useRenderSession';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useCrosshairService } from '@/hooks/useCrosshairService';
import { useResizeObserver } from '@/hooks/useResizeObserver';
import { RenderOverlays } from './RenderOverlays';
import './SliceView.css';

interface SliceViewPromiseProps {
  viewType: 'axial' | 'sagittal' | 'coronal';
}

export function SliceViewPromise({ viewType }: SliceViewPromiseProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const crosshairService = useCrosshairService();
  
  // Use the new promise-based rendering hook
  const {
    canvasRef,
    isLoading,
    error,
    lastRenderTime,
    imagePlacement,
    renderToCanvas,
    redrawCanvas
  } = useRenderSession({
    sessionId: `slice-${viewType}`,
    onRenderComplete: (result) => {
      console.log(`[SliceViewPromise ${viewType}] Render complete in ${result.renderTime.toFixed(1)}ms`);
    },
    onRenderError: (error) => {
      console.error(`[SliceViewPromise ${viewType}] Render error:`, error);
    }
  });
  
  // Get view state from store
  const viewState = useViewStateStore(state => state.viewState);
  const setViewState = useViewStateStore(state => state.setViewState);
  
  // Track if this is the first render
  const isFirstRender = useRef(true);
  
  // Handle canvas resize
  const handleResize = useCallback((entry: ResizeObserverEntry) => {
    if (!canvasRef.current) return;
    
    const { width, height } = entry.contentRect;
    
    // Update canvas dimensions
    canvasRef.current.width = Math.floor(width);
    canvasRef.current.height = Math.floor(height);
    
    // Redraw if we have an image
    redrawCanvas();
  }, [redrawCanvas]);
  
  // Observe container resize
  useResizeObserver(containerRef, handleResize);
  
  // Trigger render when view state changes
  useEffect(() => {
    if (!canvasRef.current) return;
    
    // Check if we have any visible layers
    const hasVisibleLayers = viewState.layers.some(layer => 
      layer.visible && layer.opacity > 0
    );
    
    if (!hasVisibleLayers) {
      console.log(`[SliceViewPromise ${viewType}] No visible layers, skipping render`);
      return;
    }
    
    // Log render trigger
    if (isFirstRender.current) {
      console.log(`[SliceViewPromise ${viewType}] Initial render triggered`);
      isFirstRender.current = false;
    }
    
    // Render using promise-based API
    renderToCanvas(viewState, viewType).catch(error => {
      console.error(`[SliceViewPromise ${viewType}] Failed to render:`, error);
    });
  }, [viewState, viewType, renderToCanvas]);
  
  // Handle click events for crosshair updates
  const handleCanvasClick = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || !imagePlacement) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    // Convert click position to image coordinates
    const imageX = ((x - imagePlacement.x) / imagePlacement.width) * imagePlacement.imageWidth;
    const imageY = ((y - imagePlacement.y) / imagePlacement.height) * imagePlacement.imageHeight;
    
    // Check if click is within image bounds
    if (imageX >= 0 && imageX < imagePlacement.imageWidth &&
        imageY >= 0 && imageY < imagePlacement.imageHeight) {
      
      // Convert to normalized coordinates (0-1)
      const normalizedX = imageX / imagePlacement.imageWidth;
      const normalizedY = imageY / imagePlacement.imageHeight;
      
      // Update crosshair through service
      crosshairService.updateFromClick(viewType, normalizedX, normalizedY);
    }
  }, [viewType, imagePlacement, crosshairService]);
  
  return (
    <div 
      ref={containerRef} 
      className="slice-view"
      data-view-type={viewType}
    >
      <canvas
        ref={canvasRef}
        className="slice-canvas"
        onClick={handleCanvasClick}
      />
      
      {/* Render overlays */}
      <RenderOverlays
        viewType={viewType}
        imagePlacement={imagePlacement}
        showCrosshair={viewState.crosshair.visible}
        crosshairPosition={viewState.crosshair.world_mm}
        viewState={viewState}
      />
      
      {/* Loading indicator */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
          <div className="text-white text-sm">Rendering...</div>
        </div>
      )}
      
      {/* Error display */}
      {error && (
        <div className="absolute bottom-2 left-2 right-2 bg-red-500/80 text-white p-2 rounded text-sm">
          Error: {error.message}
        </div>
      )}
      
      {/* Performance indicator (dev only) */}
      {process.env.NODE_ENV === 'development' && lastRenderTime && (
        <div className="absolute bottom-2 right-2 bg-black/60 text-green-400 px-2 py-1 rounded text-xs font-mono">
          {lastRenderTime.toFixed(1)}ms
        </div>
      )}
    </div>
  );
}