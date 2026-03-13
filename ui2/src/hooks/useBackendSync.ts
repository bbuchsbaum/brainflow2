/**
 * Backend Sync Hook - Connects ViewState changes to backend updates
 * This is where the coalescing magic happens
 */

import { useEffect } from 'react';
import { coalesceUtils } from '@/stores/middleware/coalesceUpdatesMiddleware';
import { getApiService } from '@/services/apiService';

export function useBackendSync() {
  const apiService = getApiService();
  
  // Set up the backend update callback
  useEffect(() => {
    // Import and use OptimizedRenderService for intelligent rendering
    import('@/services/OptimizedRenderService').then(({ getOptimizedRenderService }) => {
      const optimizedRenderService = getOptimizedRenderService();
      
      const updateBackend = async (
        state: import('@/types/viewState').ViewState,
        revisions?: import('@/types/viewState').ViewStateRevisions,
        tag?: string
      ) => {
        try {
          // Use OptimizedRenderService for intelligent view-specific rendering
          await optimizedRenderService.renderChangedViews(state, tag, revisions);
          
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
  
  return {
    // Could return sync status, error states, etc.
    isConnected: true,
  };
}
