/**
 * Hook to ensure render loop is initialized before rendering
 */

import React, { useEffect, useState, useRef } from 'react';
import { getApiService } from '@/services/apiService';

interface RenderLoopState {
  isInitialized: boolean;
  isInitializing: boolean;
  error: Error | null;
}

// Global initialization state to prevent multiple init calls
let globalInitPromise: Promise<void> | null = null;
let globalInitialized = false;

// Export function to mark as initialized (for use by useServicesInit)
export function markRenderLoopAsInitialized() {
  globalInitialized = true;
}

export function useRenderLoopInit(width: number, height: number) {
  // Validate dimensions using useMemo to ensure stable values
  const { validWidth, validHeight } = React.useMemo(() => {
    const w = (width > 0 && width <= 8192) ? width : 512;
    const h = (height > 0 && height <= 8192) ? height : 512;
    
    if (width !== w || height !== h) {
      console.warn(`[useRenderLoopInit] Invalid dimensions provided: ${width}x${height}, using ${w}x${h}`);
    }
    
    return { validWidth: w, validHeight: h };
  }, [width, height]);
  
  const [state, setState] = useState<RenderLoopState>({
    isInitialized: globalInitialized,
    isInitializing: false,
    error: null
  });
  
  const apiService = React.useMemo(() => getApiService(), []);
  const isMounted = useRef(true);
  
  useEffect(() => {
    // Already initialized globally
    if (globalInitialized) {
      setState({
        isInitialized: true,
        isInitializing: false,
        error: null
      });
      return;
    }
    
    // Initialize render loop
    const initializeRenderLoop = async () => {
      // If already initializing, wait for it
      if (globalInitPromise) {
        setState(prev => ({ ...prev, isInitializing: true }));
        try {
          await globalInitPromise;
          if (isMounted.current) {
            setState({
              isInitialized: true,
              isInitializing: false,
              error: null
            });
          }
        } catch (error) {
          if (isMounted.current) {
            setState({
              isInitialized: false,
              isInitializing: false,
              error: error as Error
            });
          }
        }
        return;
      }
      
      // Start new initialization
      setState(prev => ({ ...prev, isInitializing: true }));
      
      globalInitPromise = (async () => {
        // First initialize the render loop with validated dimensions
        await apiService.initRenderLoop(validWidth, validHeight);
        // Then create the offscreen render target
        await apiService.createOffscreenRenderTarget(validWidth, validHeight);
      })();
      
      try {
        await globalInitPromise;
        globalInitialized = true;
        
        if (isMounted.current) {
          setState({
            isInitialized: true,
            isInitializing: false,
            error: null
          });
        }
      } catch (error) {
        globalInitPromise = null; // Reset so it can be retried
        
        if (isMounted.current) {
          setState({
            isInitialized: false,
            isInitializing: false,
            error: error as Error
          });
        }
      }
    };
    
    initializeRenderLoop();
    
    return () => {
      isMounted.current = false;
    };
  }, [apiService, validWidth, validHeight]);
  
  return state;
}

// Utility to reset initialization (useful for tests or recovery)
export function resetRenderLoopInit() {
  globalInitPromise = null;
  globalInitialized = false;
}