/**
 * Hook to ensure render loop is initialized before rendering
 */

import { useEffect, useState, useRef } from 'react';
import { getApiService } from '@/services/apiService';

interface RenderLoopState {
  isInitialized: boolean;
  isInitializing: boolean;
  error: Error | null;
}

// Global initialization state to prevent multiple init calls
let globalInitPromise: Promise<void> | null = null;
let globalInitialized = false;

export function useRenderLoopInit(width: number, height: number) {
  const [state, setState] = useState<RenderLoopState>({
    isInitialized: globalInitialized,
    isInitializing: false,
    error: null
  });
  
  const apiService = getApiService();
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
        // First initialize the render loop
        await apiService.initRenderLoop(width, height);
        // Then create the offscreen render target
        await apiService.createOffscreenRenderTarget(width, height);
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
  }, [apiService, width, height]);
  
  return state;
}

// Utility to reset initialization (useful for tests or recovery)
export function resetRenderLoopInit() {
  globalInitPromise = null;
  globalInitialized = false;
}