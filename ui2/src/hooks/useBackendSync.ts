/**
 * Backend Sync Hook - Connects ViewState changes to backend updates
 * This is where the coalescing magic happens
 */

import { useEffect, useRef } from 'react';
import { useViewStateStore } from '@/stores/viewStateStore';
import { coalesceUtils } from '@/stores/middleware/coalesceUpdatesMiddleware';
import { getApiService } from '@/services/apiService';
import { getEventBus } from '@/events/EventBus';
import type { ViewState } from '@/types/viewState';

export function useBackendSync() {
  const viewState = useViewStateStore(state => state.viewState);
  const prevViewStateRef = useRef<ViewState | null>(null);
  const apiService = getApiService();
  
  // Set up the backend update callback
  useEffect(() => {
    const updateBackend = async (state: ViewState, tag?: string) => {
      const updateTime = performance.now();
      try {
        // For now, render all three views when state changes
        // In the future, this should be optimized to only render visible views
        const viewTypes: Array<'axial' | 'sagittal' | 'coronal'> = ['axial', 'sagittal', 'coronal'];
        
        // console.log(`[useBackendSync ${updateTime.toFixed(0)}ms] 🎯 SENDING TO BACKEND:`, {
        //   layers: state.layers.length,
        //   layerDetails: state.layers.map(l => ({ 
        //     id: l.id, 
        //     visible: l.visible, 
        //     opacity: l.opacity,
        //     intensity: l.intensity,
        //     colormap: l.colormap,
        //     threshold: l.threshold
        //   })),
        //   visibleLayers: state.layers.filter(l => l.visible).length,
        //   crosshair: state.crosshair.world_mm
        // });
        
        // Check for problematic intensity values being sent
        state.layers.forEach(layer => {
          if (layer.intensity && 
              layer.intensity[0] > 1969 && layer.intensity[0] < 1971 &&
              layer.intensity[1] > 7878 && layer.intensity[1] < 7879) {
            console.error(`[useBackendSync] 🎯 SENDING PROBLEMATIC INTENSITY TO BACKEND for layer ${layer.id}:`, layer.intensity);
            console.trace('Stack trace for problematic backend update:');
          }
        });
        
        for (const viewType of viewTypes) {
          try {
            // console.log(`[useBackendSync] Starting render for ${viewType} view`);
            const imageBitmap = await apiService.applyAndRenderViewState(state, viewType);
            
            if (imageBitmap) {
              // console.log(`[useBackendSync] ${viewType} view rendered successfully, dimensions:`, imageBitmap.width, 'x', imageBitmap.height);
              
              // Emit render complete event so SliceView can display it
              const eventBus = getEventBus();
              eventBus.emit('render.complete', {
                viewType,
                imageBitmap,
                ...(tag && { tag })
              });
              
              // Don't close the bitmap - SliceView needs it!
              // The SliceView will handle cleanup when it receives a new image
            } else {
              console.warn(`[useBackendSync] ${viewType} view render returned null`);
            }
          } catch (error) {
            console.error(`[useBackendSync] Failed to render ${viewType} view:`, error);
          }
        }
        
        // console.log('[useBackendSync] Backend update completed');
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