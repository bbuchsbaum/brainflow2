/**
 * useRenderCanvas Hook
 * 
 * Shared hook for canvas-based image rendering from backend events.
 * Extracts common logic from SliceView and RenderCell components.
 */

import { useRef, useCallback, useState, useEffect } from 'react';
import { useEvent } from '@/events/EventBus';
import { drawScaledImage } from '@/utils/canvasUtils';
import { ResourceMonitor } from '@/utils/ResourceMonitor';
import type { ImagePlacement } from '@/utils/canvasUtils';

interface UseRenderCanvasOptions {
  tag?: string;
  viewType?: 'axial' | 'sagittal' | 'coronal';
  onImageReceived?: (imageBitmap: ImageBitmap) => void;
  customRender?: (ctx: CanvasRenderingContext2D, placement: ImagePlacement) => void;
}

export function useRenderCanvas(options: UseRenderCanvasOptions = {}) {
  const { tag, viewType, onImageReceived, customRender } = options;
  
  // Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastImageRef = useRef<ImageBitmap | null>(null);
  const imagePlacementRef = useRef<ImagePlacement | null>(null);
  const resourceMonitor = useRef(ResourceMonitor.getInstance());
  
  // State
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Redraw function that can be called when canvas resizes
  const redrawCanvas = useCallback(() => {
    if (!canvasRef.current || !lastImageRef.current) return;
    
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    
    try {
      // Clear the canvas first
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      
      // Use the shared canvas utility to draw the image with proper scaling
      const placement = drawScaledImage(ctx, lastImageRef.current, canvasRef.current.width, canvasRef.current.height);
      
      // Store placement for potential future use
      imagePlacementRef.current = placement;
      
      // Call custom render function if provided
      if (customRender) {
        customRender(ctx, placement);
      }
      
      // Call callback if provided
      if (onImageReceived) {
        onImageReceived(lastImageRef.current);
      }
      
      return placement;
    } catch (error) {
      console.error(`[useRenderCanvas${tag ? ` ${tag}` : ''}] Failed to draw image:`, error);
      setError('Failed to draw image');
      return null;
    }
  }, [tag, onImageReceived, customRender]);
  
  // Handle render complete events
  const handleRenderComplete = useCallback((data: any) => {
    console.log(`[useRenderCanvas] DEBUG - render.complete event received:`, {
      myTag: tag,
      eventTag: data.tag,
      myViewType: viewType,
      eventViewType: data.viewType,
      hasImageBitmap: !!data.imageBitmap
    });
    
    // Filter based on tag or viewType
    // If we're looking for a specific tag, only match that tag
    if (tag && data.tag !== tag) {
      console.log(`[useRenderCanvas] DEBUG - Ignoring event: tag mismatch (${tag} !== ${data.tag})`);
      return;
    }
    
    // If we're looking for a viewType without a tag, don't match events that have tags
    if (viewType && !tag && data.tag) {
      console.log(`[useRenderCanvas] DEBUG - Ignoring event: viewType mode but event has tag`);
      return;
    }
    
    // If we're looking for a viewType, it must match
    if (viewType && data.viewType !== viewType) {
      console.log(`[useRenderCanvas] DEBUG - Ignoring event: viewType mismatch`);
      return;
    }
    
    // If we have neither tag nor viewType, only match events without tags or viewTypes
    if (!tag && !viewType && (data.tag || data.viewType)) {
      console.log(`[useRenderCanvas] DEBUG - Ignoring event: no filter but event has tag/viewType`);
      return;
    }
    
    console.log(`[useRenderCanvas${tag ? ` ${tag}` : viewType ? ` ${viewType}` : ''}] DEBUG - Event matched! Processing render.complete`);
    
    if (data.imageBitmap && canvasRef.current) {
      console.log(`[useRenderCanvas${tag ? ` ${tag}` : ''}] DEBUG - Drawing image to canvas`);
      setIsLoading(false);
      setError(null);
      
      // Dispose previous bitmap before storing new one
      if (lastImageRef.current) {
        lastImageRef.current.close();
        resourceMonitor.current.deallocate();
        console.debug(`[useRenderCanvas${tag ? ` ${tag}` : ''}] Disposed previous ImageBitmap`);
      }
      
      // Store the image for redrawing
      lastImageRef.current = data.imageBitmap;
      
      // Track allocation (but don't block rendering)
      resourceMonitor.current.allocate();
      const status = resourceMonitor.current.getStatus();
      if (status.utilizationPercent > 80) {
        console.warn(`[useRenderCanvas${tag ? ` ${tag}` : ''}] High GPU resource usage: ${status.allocated}/${status.max} bitmaps`);
      }
      
      // Draw the image
      const result = redrawCanvas();
      console.log(`[useRenderCanvas${tag ? ` ${tag}` : ''}] DEBUG - Draw result:`, result ? 'success' : 'failed');
    } else {
      console.log(`[useRenderCanvas${tag ? ` ${tag}` : ''}] DEBUG - Cannot draw:`, {
        hasImageBitmap: !!data.imageBitmap,
        hasCanvas: !!canvasRef.current
      });
    }
  }, [tag, viewType, redrawCanvas]);
  
  // Listen for render events
  useEvent('render.complete', handleRenderComplete);
  
  useEvent('render.start', useCallback((data: any) => {
    // Apply same filtering logic as render.complete
    if (tag && data.tag !== tag) return;
    if (viewType && !tag && data.tag) return;
    if (viewType && data.viewType !== viewType) return;
    if (!tag && !viewType && (data.tag || data.viewType)) return;
    
    setIsLoading(true);
    setError(null);
  }, [tag, viewType]));
  
  useEvent('render.error', useCallback((data: any) => {
    console.log(`[useRenderCanvas] DEBUG - render.error event received:`, {
      myTag: tag,
      eventTag: data.tag,
      error: data.error
    });
    
    // Apply same filtering logic as render.complete
    if (tag && data.tag !== tag) return;
    if (viewType && !tag && data.tag) return;
    if (viewType && data.viewType !== viewType) return;
    if (!tag && !viewType && (data.tag || data.viewType)) return;
    
    console.error(`[useRenderCanvas${tag ? ` ${tag}` : ''}] DEBUG - Error matched for this canvas:`, data.error);
    setError(data.error?.message || 'Render error');
    setIsLoading(false);
  }, [tag, viewType]));
  
  // Cleanup ImageBitmap on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (lastImageRef.current) {
        lastImageRef.current.close();
        lastImageRef.current = null;
        resourceMonitor.current.deallocate();
        console.debug(`[useRenderCanvas${tag ? ` ${tag}` : ''}] Cleaned up ImageBitmap on unmount`);
      }
    };
  }, [tag]);
  
  return {
    canvasRef,
    isLoading,
    error,
    imagePlacement: imagePlacementRef.current,
    lastImage: lastImageRef.current,
    redrawCanvas,
    setError
  };
}