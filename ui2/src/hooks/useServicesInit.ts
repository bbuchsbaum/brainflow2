/**
 * useServicesInit - Initialize singleton services on app startup
 */

import { useEffect } from 'react';
import { initializeLayerService } from '@/services/LayerService';
import { LayerApiImpl } from '@/services/LayerApiImpl';
import { initializeFileLoadingService } from '@/services/FileLoadingService';
import { initializeStoreSyncService } from '@/services/StoreSyncService';
import { initializeTemplateService } from '@/services/TemplateService';
import { getProgressService } from '@/services/ProgressService';
import { getMetadataStatusService } from '@/services/MetadataStatusService';
import { initializeViewRegistry } from '@/services/ViewRegistry';
// import { initializeViewStateRenderService } from '@/services/ViewStateRenderService'; // Removed - redundant with coalescing
import { coalesceUtils } from '@/stores/middleware/coalesceUpdatesMiddleware';
import { getApiService } from '@/services/apiService';
import { getRenderCoordinator } from '@/services/RenderCoordinator';
import { getEventBus } from '@/events/EventBus';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useRenderStateStore } from '@/stores/renderStateStore';
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
        
        // Initialize RenderLoop for GPU resources via RenderCoordinator
        // This must be done early so GPU resources are available for file loading
        const apiService = getApiService();
        const renderCoordinator = getRenderCoordinator();
        try {
          console.log('[useServicesInit] Initializing RenderLoop...');
          await apiService.initRenderLoop(512, 512);
          // Removed updateDimensions call - backend now handles per-view render targets
          console.log('[useServicesInit] RenderLoop initialized successfully');
          
          // Mark RenderLoop as globally initialized so individual views don't try to reinitialize
          markRenderLoopAsInitialized();
        } catch (error) {
          console.error('[useServicesInit] Failed to initialize RenderLoop:', error);
          // Don't throw - let the app continue and handle errors when actually trying to render
        }
    
    // 2. Initialize LayerService with error handling
    try {
      const layerApi = new LayerApiImpl();
      initializeLayerService(layerApi);
      console.log('[useServicesInit] LayerService initialized');
      
      // Emit specific event for LayerService
      getEventBus().emit('services.initialized', { service: 'LayerService' });
    } catch (error) {
      console.error('[useServicesInit] LayerService initialization failed:', error);
      // Emit error event that components can listen to
      getEventBus().emit('services.error', { service: 'LayerService', error: error instanceof Error ? error.message : 'Unknown error' });
      throw error; // Re-throw to prevent dependent services from initializing
    }
    
    // 3. Initialize FileLoadingService (depends on LayerService)
    try {
      initializeFileLoadingService();
      console.log('[useServicesInit] FileLoadingService initialized');
    } catch (error) {
      console.error('[useServicesInit] FileLoadingService initialization failed:', error);
      getEventBus().emit('services.error', { service: 'FileLoadingService', error: error instanceof Error ? error.message : 'Unknown error' });
      throw error;
    }
    
    // 4. Initialize StoreSyncService last (depends on all above)
    try {
      initializeStoreSyncService();
      console.log('[useServicesInit] StoreSyncService initialized');
    } catch (error) {
      console.error('[useServicesInit] StoreSyncService initialization failed:', error);
      getEventBus().emit('services.error', { service: 'StoreSyncService', error: error instanceof Error ? error.message : 'Unknown error' });
      throw error;
    }
    
    // Initialize TemplateService to handle template menu events
    await initializeTemplateService();
    console.log('[useServicesInit] TemplateService initialized');
    
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
      const callbackTime = performance.now();
      console.log(`[useServicesInit ${callbackTime.toFixed(0)}ms] 🎯 Backend callback invoked!`);
      console.log(`[useServicesInit] Crosshair position:`, viewState.crosshair.world_mm);
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
            
            console.log(`Rendering ${viewType} view: ${width}x${height} via RenderCoordinator`);
            
            // Mark as rendering in RenderStateStore
            useRenderStateStore.getState().setRendering(viewType, true);
            
            // ⭐ UNIFIED RENDER PATHWAY: Use RenderCoordinator for ALL renders
            const imageBitmap = await renderCoordinator.requestRender({
              viewState,
              viewType,
              width,
              height,
              reason: 'layer_change', // Could be layer_change, crosshair, etc.
              priority: 'normal'
            });
            
            console.log(`[useServicesInit] Render ${viewType} complete via RenderCoordinator:`, {
              imageBitmap,
              isImageBitmap: imageBitmap instanceof ImageBitmap,
              type: imageBitmap ? Object.prototype.toString.call(imageBitmap) : 'null',
              hasImage: !!imageBitmap
            });
            
            if (imageBitmap) {
              console.log(`[useServicesInit] ImageBitmap dimensions: ${imageBitmap.width}x${imageBitmap.height}`);
            }
            
            // Update RenderStateStore with the new image
            const { setImage, setRendering, setError } = useRenderStateStore.getState();
            setImage(viewType, imageBitmap);
            setRendering(viewType, false);
            setError(viewType, null);
            
            eventBus.emit('render.complete', { viewType, imageBitmap });
          } catch (error) {
            console.error(`Failed to render ${viewType} view:`, error);
            
            // Update RenderStateStore with error
            const { setError, setRendering } = useRenderStateStore.getState();
            setError(viewType, error as Error);
            setRendering(viewType, false);
            
            eventBus.emit('render.error', { viewType, error: error as Error });
          }
        }
        
        console.log(`[useServicesInit ${performance.now().toFixed(0)}ms] ✅ All renders complete for crosshair at:`, viewState.crosshair.world_mm);
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
        console.log('[useServicesInit] All services initialized successfully');
        
        // Emit a global success event
        getEventBus().emit('services.allInitialized', { success: true });
        
      } catch (error) {
        console.error('[useServicesInit] Service initialization failed:', error);
        // Emit a global error event that components can listen to
        getEventBus().emit('services.error', { 
          error: error instanceof Error ? error.message : 'Unknown error',
          fatal: true 
        });
        // Don't set servicesInitialized to true if there was an error
      } finally {
        initializationInProgress = false;
      }
    };
    
    // Call the async initialization
    initializeServices();
  }, []);
}