/**
 * useServicesInit - Initialize singleton services on app startup
 */

import { useEffect } from 'react';
import { initializeLayerService } from '@/services/LayerService';
import { LayerApiImpl } from '@/services/LayerApiImpl';
import { initializeFileLoadingService } from '@/services/FileLoadingService';
import { initializeTemplateService } from '@/services/TemplateService';
import { getProgressService } from '@/services/ProgressService';
import { getMetadataStatusService } from '@/services/MetadataStatusService';
import { initializeViewRegistry } from '@/services/ViewRegistry';
// import { initializeViewStateRenderService } from '@/services/ViewStateRenderService'; // Removed - redundant with coalescing
import { coalesceUtils } from '@/stores/middleware/coalesceUpdatesMiddleware';
import { getApiService } from '@/services/apiService';
import { getRenderCoordinator, setMultiViewBatchEnabled } from '@/services/RenderCoordinator';
import { getEventBus } from '@/events/EventBus';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useRenderStateStore } from '@/stores/renderStateStore';
import { markRenderLoopAsInitialized } from './useRenderLoopInit';
import { useFeatureFlagStore } from '@/stores/featureFlagStore';

const DEBUG_SERVICES_INIT =
  import.meta.env.DEV &&
  typeof window !== 'undefined' &&
  window.localStorage.getItem('brainflow2-debug-services-init') === 'true';

const serviceInitDebugLog = (...args: unknown[]) => {
  if (DEBUG_SERVICES_INIT) {
    console.log(...args);
  }
};

// Global flag to prevent double initialization in React StrictMode
let servicesInitialized = false;
let initializationInProgress = false;
let featureFlagSubscription: (() => void) | null = null;

export function useServicesInit() {
  useEffect(() => {
    if (servicesInitialized || initializationInProgress) {
      console.log('[useServicesInit] Services already initialized or in progress, skipping...');
      return;
    }
    
    initializationInProgress = true;
    serviceInitDebugLog('[useServicesInit] Starting service initialization...');
    
    // Initialize services asynchronously
    const initializeServices = async () => {
      try {
        // Initialize ViewRegistry first (needed for workspace creation)
        initializeViewRegistry();
        serviceInitDebugLog('[useServicesInit] ViewRegistry initialized');
        
        const eventBus = getEventBus();
        
        // Initialize RenderLoop for GPU resources via RenderCoordinator
        // This must be done early so GPU resources are available for file loading
        const apiService = getApiService();
        const renderCoordinator = getRenderCoordinator();
        const featureFlags = useFeatureFlagStore.getState();

        // Ensure coordinator reflects persisted flag state before any renders
        setMultiViewBatchEnabled(featureFlags.multiViewBatch);

        if (!featureFlagSubscription) {
          featureFlagSubscription = useFeatureFlagStore.subscribe(
            (state) => state.multiViewBatch,
            (enabled) => setMultiViewBatchEnabled(enabled)
          );
        }
        try {
          serviceInitDebugLog('[useServicesInit] Initializing RenderLoop...');
          await apiService.initRenderLoop(512, 512);
          // Removed updateDimensions call - backend now handles per-view render targets
          serviceInitDebugLog('[useServicesInit] RenderLoop initialized successfully');
          
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
      serviceInitDebugLog('[useServicesInit] LayerService initialized');
      
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
      serviceInitDebugLog('[useServicesInit] FileLoadingService initialized');
    } catch (error) {
      console.error('[useServicesInit] FileLoadingService initialization failed:', error);
      getEventBus().emit('services.error', { service: 'FileLoadingService', error: error instanceof Error ? error.message : 'Unknown error' });
      throw error;
    }
    
    // Initialize TemplateService to handle template menu events
    await initializeTemplateService();
    serviceInitDebugLog('[useServicesInit] TemplateService initialized');
    
    // Initialize ProgressService
    const progressService = getProgressService();
    serviceInitDebugLog('[useServicesInit] ProgressService initialized');
    
    // Initialize MetadataStatusService
    const metadataStatusService = getMetadataStatusService();
    metadataStatusService.initialize();
    serviceInitDebugLog('[useServicesInit] MetadataStatusService initialized');
    
    // Set up coalescing middleware callback
    // apiService is already declared above
    
    // Import OptimizedRenderService
    const { getOptimizedRenderService } = await import('@/services/OptimizedRenderService');
    const optimizedRenderService = getOptimizedRenderService();

    const { initializeAtlasPressureMonitor } = await import('@/services/AtlasPressureMonitor');
    const atlasPressureMonitor = initializeAtlasPressureMonitor();
    
    serviceInitDebugLog('Setting up coalescing middleware callback with optimized rendering...');
    coalesceUtils.setBackendCallback(async (viewState) => {
      const callbackTime = performance.now();
      serviceInitDebugLog(`[useServicesInit ${callbackTime.toFixed(0)}ms] Backend callback invoked`);
      serviceInitDebugLog(`[useServicesInit] Crosshair position:`, viewState.crosshair.world_mm);
      serviceInitDebugLog('Coalescing callback: ViewState update with', viewState.layers.length, 'layers');
      
      // Use OptimizedRenderService to intelligently render only changed views
      try {
        await optimizedRenderService.renderChangedViews(viewState);
        
        // Log metrics periodically
        const metrics = optimizedRenderService.getMetrics();
        if (metrics.totalRenders % 10 === 0 && metrics.totalRenders > 0) {
          serviceInitDebugLog('[useServicesInit] Render optimization metrics:', {
            totalRenders: metrics.totalRenders,
            skippedRenders: metrics.skippedRenders,
            savingsPercent: `${(metrics.skippedRenders / (metrics.totalRenders + metrics.skippedRenders) * 100).toFixed(1)}%`,
            avgRenderTimes: metrics.averageRenderTimes
          });
        }
      } catch (error) {
        console.error('[useServicesInit] Optimized render failed:', error);
        eventBus.emit('render.error', { error: error as Error });
      }
    });

    if (typeof window !== 'undefined') {
      (window as any).setRenderMultiViewEnabled = (enabled: boolean) => {
        useFeatureFlagStore.getState().setMultiViewBatchEnabled(Boolean(enabled));
      };
      (window as any).isRenderMultiViewEnabled = () => useFeatureFlagStore.getState().multiViewBatch;
    }
    
    // ViewStateRenderService removed - coalescing middleware handles ViewState updates
    
        serviceInitDebugLog('Services initialized successfully:');
        serviceInitDebugLog('- ViewRegistry: initialized');
        serviceInitDebugLog('- RenderLoop: initialized');
        serviceInitDebugLog('- LayerService: initialized');
        serviceInitDebugLog('- FileLoadingService: initialized');
        serviceInitDebugLog('- ProgressService: initialized');
        serviceInitDebugLog('- MetadataStatusService: initialized');
        serviceInitDebugLog('- Coalescing middleware: configured');
        serviceInitDebugLog('- AtlasPressureMonitor: started');
    
    // Expose services to window for debugging/testing in development
    if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
      (window as any).__BRAINFLOW_SERVICES = {
        apiService,
        progressService,
        eventBus,
        atlasPressureMonitor,
        // Add getters for other services to avoid double initialization
        get fileLoadingService() {
          return require('@/services/FileLoadingService').getFileLoadingService();
        },
        get layerService() {
          return require('@/services/LayerService').getLayerService();
        }
      };
      serviceInitDebugLog('[useServicesInit] Services exposed to window.__BRAINFLOW_SERVICES for debugging');
    }
    
        // Test logging to make sure console works
        setTimeout(() => {
          serviceInitDebugLog('TEST: Console logging is working!');
          serviceInitDebugLog('TEST: Current layer count:', useLayerStore.getState().layers.length);
          serviceInitDebugLog('TEST: Current viewState layers:', useViewStateStore.getState().viewState.layers.length);
        }, 2000);
        
        servicesInitialized = true;
        serviceInitDebugLog('[useServicesInit] All services initialized successfully');
        
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
