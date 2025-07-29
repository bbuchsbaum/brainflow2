/**
 * useRenderCanvas Hook
 * 
 * Shared hook for canvas-based image rendering from backend events.
 * Extracts common logic from SliceView and RenderCell components.
 */

import { useRef, useCallback, useState, useEffect } from 'react';
import { useEvent } from '@/events/EventBus';
import { drawScaledImage } from '@/utils/canvasUtils';
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
    // Filter based on tag or viewType
    // If we're looking for a specific tag, only match that tag
    if (tag && data.tag !== tag) return;
    
    // If we're looking for a viewType without a tag, don't match events that have tags
    if (viewType && !tag && data.tag) return;
    
    // If we're looking for a viewType, it must match
    if (viewType && data.viewType !== viewType) return;
    
    // If we have neither tag nor viewType, only match events without tags or viewTypes
    if (!tag && !viewType && (data.tag || data.viewType)) return;
    
    // Log only in development
    if (process.env.NODE_ENV === 'development') {
      console.log(`[useRenderCanvas${tag ? ` ${tag}` : viewType ? ` ${viewType}` : ''}] render.complete`, {
        hasImage: !!data.imageBitmap
      });
    }
    
    if (data.imageBitmap && canvasRef.current) {
      setIsLoading(false);
      setError(null);
      
      // Store the image for redrawing
      lastImageRef.current = data.imageBitmap;
      
      // Draw the image
      redrawCanvas();
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
    // Apply same filtering logic as render.complete
    if (tag && data.tag !== tag) return;
    if (viewType && !tag && data.tag) return;
    if (viewType && data.viewType !== viewType) return;
    if (!tag && !viewType && (data.tag || data.viewType)) return;
    
    setError(data.error?.message || 'Render error');
    setIsLoading(false);
  }, [tag, viewType]));
  
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