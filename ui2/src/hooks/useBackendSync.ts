/**
 * Backend Sync Hook - Connects ViewState changes to backend updates
 * This is where the coalescing magic happens
 */

import { useEffect, useRef } from 'react';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useRenderStateStore } from '@/stores/renderStateStore';
import { coalesceUtils } from '@/stores/middleware/coalesceUpdatesMiddleware';
import { getApiService } from '@/services/apiService';
import type { ViewState } from '@/types/viewState';

export function useBackendSync() {
  const viewState = useViewStateStore(state => state.viewState);
  const prevViewStateRef = useRef<ViewState | null>(null);
  const apiService = getApiService();
  
  // Set up the backend update callback
  useEffect(() => {
    // Import and use OptimizedRenderService for intelligent rendering
    import('@/services/OptimizedRenderService').then(({ getOptimizedRenderService }) => {
      const optimizedRenderService = getOptimizedRenderService();
      
      const updateBackend = async (state: ViewState, tag?: string) => {
        const updateTime = performance.now();
        try {
          // Use OptimizedRenderService for intelligent view-specific rendering
          await optimizedRenderService.renderChangedViews(state, tag);
          
          // Log optimization metrics periodically
          const metrics = optimizedRenderService.getMetrics();
          if (metrics.totalRenders > 0 && metrics.totalRenders % 20 === 0) {
            console.log(`[useBackendSync] Optimization stats: Saved ${metrics.skippedRenders} renders (${(metrics.skippedRenders / (metrics.totalRenders + metrics.skippedRenders) * 100).toFixed(1)}% reduction)`);
          }
        } catch (error) {
          // Check if it's a render target error
          if (error && typeof error === 'object' && 'message' in error) {
            const errorMessage = (error as any).message || '';
            if (errorMessage.includes('No render target created')) {
              console.warn('Render target not yet created, skipping update');
              return;
            }
          }
          console.error('Backend update failed:', error);
        }
      };
      
      coalesceUtils.setBackendCallback(updateBackend);
    });
  }, [apiService]);
  
  // Schedule backend updates when ViewState changes
  useEffect(() => {
    // Skip initial mount
    if (prevViewStateRef.current === null) {
      prevViewStateRef.current = viewState;
      // console.log('[useBackendSync] Initial mount, skipping update');
      return;
    }
    
    // Check if state actually changed
    if (JSON.stringify(prevViewStateRef.current) !== JSON.stringify(viewState)) {
      // console.log('[useBackendSync] ViewState changed:', {
      //   layers: viewState.layers.length,
      //   layerIds: viewState.layers.map(l => l.id),
      //   crosshair: viewState.crosshair.world_mm
      // });
      
      // The coalescing middleware will handle scheduling
      // We just need to update our reference
      prevViewStateRef.current = viewState;
    }
  }, [viewState]);
  
  return {
    // Could return sync status, error states, etc.
    isConnected: true,
  };
}