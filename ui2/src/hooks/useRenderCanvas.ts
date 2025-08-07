/**
 * useRenderCanvas Hook
 * 
 * Shared hook for canvas-based image rendering using RenderStateStore.
 * Replaces EventBus pattern with centralized state management.
 */

import { useRef, useCallback, useEffect } from 'react';
import { useRenderState } from '@/stores/renderStateStore';
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
  
  // Use tag or viewType as the store key
  const storeKey = tag || viewType || 'default';
  
  // Get render state from centralized store
  const { lastImage, isRendering: isLoading, error: errorObj } = useRenderState(storeKey);
  const error = errorObj?.message || null;
  
  // Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imagePlacementRef = useRef<ImagePlacement | null>(null);
  const resourceMonitor = useRef(ResourceMonitor.getInstance());
  
  // Redraw function that can be called when canvas resizes
  const redrawCanvas = useCallback(() => {
    if (!canvasRef.current || !lastImage) return;
    
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    
    try {
      // Clear the canvas first
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      
      // Use the shared canvas utility to draw the image with proper scaling
      const placement = drawScaledImage(ctx, lastImage, canvasRef.current.width, canvasRef.current.height);
      
      // Store placement for potential future use
      imagePlacementRef.current = placement;
      
      // Call custom render if provided (e.g., for crosshair)
      if (customRender) {
        customRender(ctx, placement);
      }
      
      // Call callback if provided
      if (onImageReceived && lastImage) {
        onImageReceived(lastImage);
      }
      
      return placement;
    } catch (error) {
      console.error(`[useRenderCanvas${tag ? ` ${tag}` : ''}] Failed to draw image:`, error);
      // Note: Error is now managed by RenderStateStore
      return null;
    }
  }, [tag, onImageReceived, customRender, lastImage]);
  
  // React to changes in lastImage from the store
  // When RenderStateStore updates with a new image, draw it to the canvas
  useEffect(() => {
    if (lastImage && canvasRef.current) {
      console.log(`[useRenderCanvas${tag ? ` ${tag}` : viewType ? ` ${viewType}` : ''}] New image from store, drawing to canvas`);
      
      // Track resource allocation
      resourceMonitor.current.allocate();
      const status = resourceMonitor.current.getStatus();
      if (status.utilizationPercent > 80) {
        console.warn(`[useRenderCanvas${tag ? ` ${tag}` : ''}] High memory usage:`, status);
      }
      
      // Draw the image
      redrawCanvas();
    }
  }, [lastImage, tag, viewType, redrawCanvas]);
  
  // Cleanup is now handled by RenderStateStore
  // When the component unmounts, the store manages ImageBitmap lifecycle
  useEffect(() => {
    return () => {
      // Deallocate from resource monitor when unmounting
      resourceMonitor.current.deallocate();
      console.debug(`[useRenderCanvas${tag ? ` ${tag}` : ''}] Component unmounted`);
    };
  }, [tag]);
  
  return {
    canvasRef,
    isLoading,
    error,
    redrawCanvas,
    imagePlacement: imagePlacementRef.current
  };
}