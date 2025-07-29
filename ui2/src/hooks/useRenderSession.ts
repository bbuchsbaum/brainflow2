/**
 * useRenderSession Hook
 * 
 * React hook that provides promise-based rendering using RenderSession.
 * This replaces the event-based useRenderCanvas hook with a cleaner API.
 * 
 * Benefits:
 * - No event filtering complexity
 * - Direct promise returns
 * - Automatic session lifecycle management
 * - Built-in error handling
 * - Performance tracking
 */

import { useRef, useCallback, useState, useEffect } from 'react';
import { getApiService } from '@/services/apiService';
import type { RenderSession, RenderResult } from '@/services/RenderSession';
import type { ViewState } from '@/types/viewState';
import { drawScaledImage } from '@/utils/canvasUtils';
import type { ImagePlacement } from '@/utils/canvasUtils';

interface UseRenderSessionOptions {
  sessionId?: string;
  onRenderComplete?: (result: RenderResult) => void;
  onRenderError?: (error: Error) => void;
}

interface UseRenderSessionReturn {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  isLoading: boolean;
  error: Error | null;
  lastRenderTime: number | null;
  imagePlacement: ImagePlacement | null;
  
  // Methods
  render: (
    viewState: ViewState,
    viewType: 'axial' | 'sagittal' | 'coronal',
    width?: number,
    height?: number
  ) => Promise<void>;
  
  renderToCanvas: (
    viewState: ViewState,
    viewType: 'axial' | 'sagittal' | 'coronal'
  ) => Promise<void>;
  
  redrawCanvas: () => void;
  clearError: () => void;
  getSessionMetadata: () => any;
}

export function useRenderSession(options: UseRenderSessionOptions = {}): UseRenderSessionReturn {
  const { sessionId, onRenderComplete, onRenderError } = options;
  
  // Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<RenderSession | null>(null);
  const lastImageRef = useRef<ImageBitmap | null>(null);
  const imagePlacementRef = useRef<ImagePlacement | null>(null);
  
  // State
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastRenderTime, setLastRenderTime] = useState<number | null>(null);
  
  // Initialize session
  useEffect(() => {
    const apiService = getApiService();
    sessionRef.current = apiService.createRenderSession(sessionId);
    
    console.log(`[useRenderSession] Created session ${sessionRef.current.getId()}`);
    
    // Cleanup on unmount
    return () => {
      if (sessionRef.current) {
        sessionRef.current.dispose();
        console.log(`[useRenderSession] Disposed session ${sessionRef.current.getId()}`);
      }
    };
  }, []); // Empty deps - only create once
  
  // Redraw the last image on the canvas
  const redrawCanvas = useCallback(() => {
    if (!canvasRef.current || !lastImageRef.current) return;
    
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    
    try {
      // Clear and redraw
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      const placement = drawScaledImage(
        ctx,
        lastImageRef.current,
        canvasRef.current.width,
        canvasRef.current.height
      );
      
      imagePlacementRef.current = placement;
    } catch (error) {
      console.error('[useRenderSession] Redraw error:', error);
    }
  }, []);
  
  // Core render method using RenderSession
  const render = useCallback(async (
    viewState: ViewState,
    viewType: 'axial' | 'sagittal' | 'coronal',
    width = 512,
    height = 512
  ) => {
    if (!sessionRef.current) {
      throw new Error('RenderSession not initialized');
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      const result = await sessionRef.current.render(
        viewState,
        viewType,
        width,
        height
      );
      
      // Store the image for redrawing
      lastImageRef.current = result.bitmap;
      setLastRenderTime(result.renderTime);
      
      // Call completion callback
      if (onRenderComplete) {
        onRenderComplete(result);
      }
      
      return result.bitmap;
    } catch (error) {
      const err = error as Error;
      setError(err);
      
      // Call error callback
      if (onRenderError) {
        onRenderError(err);
      }
      
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [onRenderComplete, onRenderError]);
  
  // Render directly to the canvas
  const renderToCanvas = useCallback(async (
    viewState: ViewState,
    viewType: 'axial' | 'sagittal' | 'coronal'
  ) => {
    if (!canvasRef.current) {
      throw new Error('Canvas not mounted');
    }
    
    const canvas = canvasRef.current;
    const width = canvas.width;
    const height = canvas.height;
    
    // Render using the session
    const bitmap = await render(viewState, viewType, width, height);
    
    // Draw to canvas
    const ctx = canvas.getContext('2d');
    if (ctx && bitmap) {
      ctx.clearRect(0, 0, width, height);
      const placement = drawScaledImage(ctx, bitmap, width, height);
      imagePlacementRef.current = placement;
    }
  }, [render]);
  
  // Clear error state
  const clearError = useCallback(() => {
    setError(null);
  }, []);
  
  // Get session metadata
  const getSessionMetadata = useCallback(() => {
    return sessionRef.current?.getMetadata();
  }, []);
  
  return {
    canvasRef,
    isLoading,
    error,
    lastRenderTime,
    imagePlacement: imagePlacementRef.current,
    render,
    renderToCanvas,
    redrawCanvas,
    clearError,
    getSessionMetadata
  };
}