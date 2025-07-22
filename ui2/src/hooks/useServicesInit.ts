/**
 * useServicesInit - Initialize singleton services on app startup
 */

import { useEffect } from 'react';
import { initializeLayerService } from '@/services/LayerService';
import { LayerApiImpl } from '@/services/LayerApiImpl';
import { initializeFileLoadingService } from '@/services/FileLoadingService';
import { initializeStoreSyncService } from '@/services/StoreSyncService';
// import { initializeViewStateRenderService } from '@/services/ViewStateRenderService'; // Removed - redundant with coalescing
import { coalesceUtils } from '@/stores/middleware/coalesceUpdatesMiddleware';
import { getApiService } from '@/services/apiService';
import { getEventBus } from '@/events/EventBus';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';

// Global flag to prevent double initialization in React StrictMode
let servicesInitialized = false;

export function useServicesInit() {
  useEffect(() => {
    if (servicesInitialized) {
      console.log('[useServicesInit] Services already initialized, skipping...');
      return;
    }
    
    console.log('[useServicesInit] Starting service initialization...');
    servicesInitialized = true;
    
    // Add a global event debug listener first
    const eventBus = getEventBus();
    eventBus.onAny((event, data) => {
      if (event === 'layer.added') {
        console.log(`[EventDebug] layer.added event fired!`, data);
        console.log(`[EventDebug] Current listeners: ${eventBus.listenerCount('layer.added')}`);
      }
    });
    
    // Initialize LayerService with backend API implementation
    const layerApi = new LayerApiImpl();
    initializeLayerService(layerApi);
    console.log('[useServicesInit] LayerService initialized');
    
    // Initialize FileLoadingService
    initializeFileLoadingService();
    console.log('[useServicesInit] FileLoadingService initialized');
    
    // Initialize StoreSyncService to keep stores in sync
    initializeStoreSyncService();
    console.log('[useServicesInit] StoreSyncService initialized');
    
    // Verify StoreSyncService is listening
    const listenerCount = eventBus.listenerCount('layer.added');
    console.log(`[useServicesInit] After init - listeners for 'layer.added': ${listenerCount}`);
    
    // Set up coalescing middleware callback
    const apiService = getApiService();
    
    console.log('Setting up coalescing middleware callback...');
    coalesceUtils.setBackendCallback(async (viewState) => {
      console.log('Coalescing callback: ViewState update with', viewState.layers.length, 'layers');
      console.log('Layers:', viewState.layers);
      
      // Log layer details including intensity
      viewState.layers.forEach(layer => {
        console.log(`[useServicesInit] Layer ${layer.id}:`, {
          visible: layer.visible,
          opacity: layer.opacity,
          colormap: layer.colormap,
          intensity: layer.intensity,
          threshold: layer.threshold
        });
      });
      
      // CRITICAL: Skip rendering if no layers are present
      if (!viewState.layers || viewState.layers.length === 0) {
        console.warn('[useServicesInit] Skipping render - no layers in ViewState');
        return;
      }
      
      // Additional check: ensure at least one layer has a volumeId
      const layersWithVolumes = viewState.layers.filter(l => l.volumeId);
      if (layersWithVolumes.length === 0) {
        console.warn('[useServicesInit] Skipping render - no layers have volumeId');
        console.log('Layer details:', viewState.layers.map(l => ({
          id: l.id,
          volumeId: l.volumeId,
          visible: l.visible
        })));
        return;
      }
      
      try {
        eventBus.emit('render.start', {});
        
        // For now, render each view separately
        // TODO: Eventually the backend should return all three views at once
        const viewTypes: Array<'axial' | 'sagittal' | 'coronal'> = ['axial', 'sagittal', 'coronal'];
        
        for (const viewType of viewTypes) {
          try {
            // Get the dimensions from the view state
            const view = viewState.views[viewType];
            const [width, height] = view.dim_px;
            
            console.log(`Rendering ${viewType} view: ${width}x${height}`);
            
            // Pass actual dimensions to render call
            const imageBitmap = await apiService.applyAndRenderViewState(
              viewState, 
              viewType,
              width,
              height
            );
            eventBus.emit('render.complete', { viewType, imageBitmap });
          } catch (error) {
            console.error(`Failed to render ${viewType} view:`, error);
            eventBus.emit('render.error', { viewType, error: error as Error });
          }
        }
      } catch (error) {
        console.error('Failed to render ViewState:', error);
        eventBus.emit('render.error', { error: error as Error });
      }
    });
    
    // ViewStateRenderService removed - coalescing middleware handles ViewState updates
    
    console.log('Services initialized successfully:');
    console.log('- LayerService: initialized');
    console.log('- FileLoadingService: initialized');
    console.log('- StoreSyncService: initialized');
    console.log('- Coalescing middleware: configured');
    
    // Test logging to make sure console works
    setTimeout(() => {
      console.log('TEST: Console logging is working!');
      console.log('TEST: Current layer count:', useLayerStore.getState().layers.length);
      console.log('TEST: Current viewState layers:', useViewStateStore.getState().viewState.layers.length);
    }, 2000);
  }, []);
}