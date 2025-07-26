/**
 * useServicesInit - Initialize singleton services on app startup
 */

import { useEffect } from 'react';
import { initializeLayerService } from '@/services/LayerService';
import { LayerApiImpl } from '@/services/LayerApiImpl';
import { initializeFileLoadingService } from '@/services/FileLoadingService';
import { initializeStoreSyncService } from '@/services/StoreSyncService';
import { getProgressService } from '@/services/ProgressService';
import { getMetadataStatusService } from '@/services/MetadataStatusService';
import { initializeViewRegistry } from '@/services/ViewRegistry';
// import { initializeViewStateRenderService } from '@/services/ViewStateRenderService'; // Removed - redundant with coalescing
import { coalesceUtils } from '@/stores/middleware/coalesceUpdatesMiddleware';
import { getApiService } from '@/services/apiService';
import { getEventBus } from '@/events/EventBus';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { markRenderLoopAsInitialized } from './useRenderLoopInit';

// Global flag to prevent double initialization in React StrictMode
let servicesInitialized = false;
let initializationInProgress = false;

export function useServicesInit() {
  useEffect(() => {
    if (servicesInitialized || initializationInProgress) {
      console.log('[useServicesInit] Services already initialized or in progress, skipping...');
      return;
    }
    
    initializationInProgress = true;
    console.log('[useServicesInit] Starting service initialization...');
    
    // Initialize services asynchronously
    const initializeServices = async () => {
      try {
        // Initialize ViewRegistry first (needed for workspace creation)
        initializeViewRegistry();
        console.log('[useServicesInit] ViewRegistry initialized');
        
        // Add a global event debug listener first
        const eventBus = getEventBus();
        eventBus.onAny((event, data) => {
          if (event === 'layer.added') {
            console.log(`[EventDebug] layer.added event fired!`, data);
            console.log(`[EventDebug] Current listeners: ${eventBus.listenerCount('layer.added')}`);
          }
        });
        
        // Initialize RenderLoop for GPU resources
        // This must be done early so GPU resources are available for file loading
        const apiService = getApiService();
        try {
          console.log('[useServicesInit] Initializing RenderLoop...');
          await apiService.initRenderLoop(512, 512);
          await apiService.createOffscreenRenderTarget(512, 512);
          console.log('[useServicesInit] RenderLoop initialized successfully');
          
          // Mark RenderLoop as globally initialized so individual views don't try to reinitialize
          markRenderLoopAsInitialized();
        } catch (error) {
          console.error('[useServicesInit] Failed to initialize RenderLoop:', error);
          // Don't throw - let the app continue and handle errors when actually trying to render
        }
    
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
    
    // Initialize ProgressService
    const progressService = getProgressService();
    console.log('[useServicesInit] ProgressService initialized');
    
    // Initialize MetadataStatusService
    const metadataStatusService = getMetadataStatusService();
    metadataStatusService.initialize();
    console.log('[useServicesInit] MetadataStatusService initialized');
    
    // Verify StoreSyncService is listening
    const listenerCount = eventBus.listenerCount('layer.added');
    console.log(`[useServicesInit] After init - listeners for 'layer.added': ${listenerCount}`);
    
    // Set up coalescing middleware callback
    // apiService is already declared above
    
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
            
            console.log(`[useServicesInit] Render ${viewType} complete:`, {
              imageBitmap,
              isImageBitmap: imageBitmap instanceof ImageBitmap,
              type: imageBitmap ? Object.prototype.toString.call(imageBitmap) : 'null',
              hasImage: !!imageBitmap
            });
            
            if (imageBitmap) {
              console.log(`[useServicesInit] ImageBitmap dimensions: ${imageBitmap.width}x${imageBitmap.height}`);
            }
            
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
        console.log('- ViewRegistry: initialized');
        console.log('- RenderLoop: initialized');
        console.log('- LayerService: initialized');
        console.log('- FileLoadingService: initialized');
        console.log('- StoreSyncService: initialized');
        console.log('- ProgressService: initialized');
        console.log('- MetadataStatusService: initialized');
        console.log('- Coalescing middleware: configured');
    
    // Expose services to window for debugging/testing in development
    if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
      (window as any).__BRAINFLOW_SERVICES = {
        apiService,
        progressService,
        eventBus,
        // Add getters for other services to avoid double initialization
        get fileLoadingService() {
          return require('@/services/FileLoadingService').getFileLoadingService();
        },
        get layerService() {
          return require('@/services/LayerService').getLayerService();
        }
      };
      console.log('[useServicesInit] Services exposed to window.__BRAINFLOW_SERVICES for debugging');
    }
    
        // Test logging to make sure console works
        setTimeout(() => {
          console.log('TEST: Console logging is working!');
          console.log('TEST: Current layer count:', useLayerStore.getState().layers.length);
          console.log('TEST: Current viewState layers:', useViewStateStore.getState().viewState.layers.length);
        }, 2000);
        
        servicesInitialized = true;
      } catch (error) {
        console.error('[useServicesInit] Error during initialization:', error);
      } finally {
        initializationInProgress = false;
      }
    };
    
    // Call the async initialization
    initializeServices();
  }, []);
}