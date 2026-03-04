/**
 * useRenderCanvas Hook
 * 
 * Shared hook for canvas-based image rendering using RenderStateStore.
 * Supports both the new unified RenderContext and legacy tag/viewType for backward compatibility.
 * Includes comprehensive error handling and recovery.
 */

import { useRef, useCallback, useEffect } from 'react';
import { useRenderState, useRenderStateStore } from '@/stores/renderStateStore';
import { drawScaledImage } from '@/utils/canvasUtils';
import type { ImagePlacement } from '@/utils/canvasUtils';
import type { RenderContext } from '@/types/renderContext';

interface UseRenderCanvasOptions {
  // New unified approach
  context?: RenderContext;
  
  // Legacy approach (backward compatibility)
  tag?: string;
  viewType?: 'axial' | 'sagittal' | 'coronal';
  
  // Callbacks
  onImageReceived?: (imageBitmap: ImageBitmap) => void;
  customRender?: (ctx: CanvasRenderingContext2D, placement: ImagePlacement) => void;
}

export function useRenderCanvas(options: UseRenderCanvasOptions = {}) {
  const { context, tag, viewType, onImageReceived, customRender } = options;
  
  // Use context ID if provided, otherwise fall back to tag/viewType
  const storeKey = context?.id || tag || viewType || 'default';
  
  // Get render state from centralized store
  const { lastImage, isRendering: isLoading, error: errorObj } = useRenderState(storeKey);
  const error = errorObj?.message || null;
  
  // Get store methods for error handling
  const { setError } = useRenderStateStore();
  
  // Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imagePlacementRef = useRef<ImagePlacement | null>(null);
  const retryCountRef = useRef(0);
  const maxRetries = 3;
  const lastImageRef = useRef<ImageBitmap | null>(null);
  const errorRef = useRef<string | null>(null);

  useEffect(() => { lastImageRef.current = lastImage; }, [lastImage]);
  useEffect(() => { errorRef.current = error; }, [error]);
  
  // Redraw function that can be called when canvas resizes
  const redrawCanvas = useCallback(() => {
    const image = lastImageRef.current;
    if (!canvasRef.current || !image) return;
    
    const canvas = canvasRef.current;
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;
    
    // Validate canvas dimensions
    if (canvasWidth === 0 || canvasHeight === 0) {
      console.warn(`[useRenderCanvas ${storeKey}] Canvas has zero dimensions, skipping draw`);
      return;
    }
    
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      const errorMsg = 'Failed to get 2D context from canvas';
      console.error(`[useRenderCanvas ${storeKey}] ${errorMsg}`);
      setError(storeKey, new Error(errorMsg));
      return;
    }
    
    try {
      // Clear any previous error on successful draw attempt
      if (errorRef.current) {
        setError(storeKey, null);
      }
      
      // Reset retry count on new image
      retryCountRef.current = 0;
      
      // Always clear before drawing to avoid stale edge strips during splitter resizes.
      ctx.clearRect(0, 0, canvasWidth, canvasHeight);
      
      // Validate ImageBitmap before drawing
      if (!image.width || !image.height) {
        throw new Error(`Invalid ImageBitmap dimensions: ${image.width}x${image.height}`);
      }
      
      // Use the shared canvas utility to draw the image with proper scaling
      const placement = drawScaledImage(ctx, image, canvasWidth, canvasHeight);
      
      // Store placement for potential future use
      imagePlacementRef.current = placement;
      
      // Call custom render if provided (e.g., for crosshair)
      if (customRender) {
        try {
          customRender(ctx, placement);
        } catch (customError) {
          // Don't fail the entire render if custom render fails
          console.error(`[useRenderCanvas ${storeKey}] Custom render failed:`, customError);
        }
      }
      
      // Call callback if provided
      if (onImageReceived && image) {
        try {
          onImageReceived(image);
        } catch (callbackError) {
          // Don't fail the render if callback fails
          console.error(`[useRenderCanvas ${storeKey}] Image callback failed:`, callbackError);
        }
      }
      
      return placement;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[useRenderCanvas ${storeKey}] Failed to draw image:`, error);
      
      // Update error state in store
      setError(storeKey, new Error(`Render failed: ${errorMessage}`));
      
      // Attempt retry for transient errors
      if (retryCountRef.current < maxRetries) {
        retryCountRef.current++;
        console.log(`[useRenderCanvas ${storeKey}] Retrying render (attempt ${retryCountRef.current}/${maxRetries})`);
        
        // Retry after a short delay
        setTimeout(() => {
          redrawCanvas();
        }, 100 * retryCountRef.current); // Exponential backoff
      }
      
      return null;
    }
  }, [storeKey, onImageReceived, customRender, setError]);
  
  // React to changes in lastImage from the store
  // When RenderStateStore updates with a new image, draw it to the canvas
  useEffect(() => {
    if (lastImage && canvasRef.current) {
      const contextInfo = context ? `(${context.type})` : tag ? `(tag)` : viewType ? `(view)` : '';
      console.log(`[useRenderCanvas ${storeKey}${contextInfo}] New image from store, drawing to canvas`);
      
      try {
        // Draw the image with error handling
        // Browser handles memory management automatically
        redrawCanvas();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[useRenderCanvas ${storeKey}] Failed to process new image:`, error);
        setError(storeKey, new Error(`Failed to process image: ${errorMessage}`));
      }
    }
  }, [lastImage, redrawCanvas, storeKey, context, tag, viewType, setError]);
  
  // Cleanup is now handled by RenderStateStore
  // When the component unmounts, the store manages ImageBitmap lifecycle
  useEffect(() => {
    return () => {
      console.debug(`[useRenderCanvas ${storeKey}] Component unmounted`);
    };
  }, [storeKey]);
  
  return {
    canvasRef,
    isLoading,
    error,
    lastImage,
    redrawCanvas,
    imagePlacement: imagePlacementRef.current
  };
}
