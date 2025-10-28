/**
 * TemplateService - Service for loading brain templates like MNI152
 * Templates are pre-registered volumes that can be loaded from the backend
 */

import { invoke } from '@tauri-apps/api/core';
import type { Unlisten } from '@/utils/eventUtils';
import { safeListen, safeUnlisten } from '@/utils/eventUtils';
import type { VolumeHandle } from './apiService';
import type { LayerInfo } from '@/stores/layerStore';
import { getEventBus, type EventBus } from '@/events/EventBus';
import { useLoadingQueueStore } from '@/stores/loadingQueueStore';
import { getVolumeLoadingService, type VolumeLoadingService } from './VolumeLoadingService';

// Template metadata from backend
interface TemplateMetadata {
  id: string;
  name: string;
  description?: string;
  resolution?: string;
  template_type: string;
}

// Result from load_template_by_id command
interface TemplateLoadResult {
  template_id: string;
  template_metadata: TemplateMetadata;
  volume_handle_info: {
    id: string;
    name: string;
    dims: number[];
    dtype: string;
    volume_type: 'Volume3D' | 'TimeSeries4D';
    current_timepoint?: number;
    num_timepoints?: number;
    time_series_info?: {
      num_timepoints: number;
      tr: number | null;
      temporal_unit: string | null;
      acquisition_time: number | null;
    };
  };
}

export class TemplateService {
  private static instance: TemplateService | null = null;
  private eventBus: EventBus;
  private volumeLoadingService: VolumeLoadingService;
  private unlistenFn: Unlisten | null = null;
  private initialized = false;
  
  private constructor() {
    this.eventBus = getEventBus();
    this.volumeLoadingService = getVolumeLoadingService();
  }
  
  public static getInstance(): TemplateService {
    if (!TemplateService.instance) {
      TemplateService.instance = new TemplateService();
    }
    return TemplateService.instance;
  }
  
  /**
   * Initialize event listeners
   */
  async initialize() {
    if (this.initialized) {
      return;
    }
    
    try {
      // Listen for template menu action events from backend
      this.unlistenFn = await safeListen('template-menu-action', async (event) => {
        console.log('[TemplateService] Received template menu action:', event.payload);
        
        const { action, payload } = event.payload as {
          action: string;
          payload: any;
        };
        
        if (action === 'load-template') {
          console.log('[TemplateService] Loading template with ID:', payload.template_id);
          try {
            await this.loadTemplate(payload.template_id);
          } catch (error) {
            console.error('[TemplateService] Failed to load template from menu:', error);
          }
        }
      });

      console.log('[TemplateService] Template action listeners initialized');
      this.initialized = true;
    } catch (error) {
      console.error('[TemplateService] Failed to initialize event listeners:', error);
    }
  }

  /**
   * Load a template by its menu ID (e.g., "MNI152NLin2009cAsym_T1w_1mm")
   */
  private async loadTemplate(templateId: string): Promise<void> {
    const startTime = performance.now();
    console.log(`[TemplateService ${startTime.toFixed(0)}ms] Loading template: ${templateId}`);

    // Check if already loading
    const templatePath = `template:${templateId}`;
    if (useLoadingQueueStore.getState().isLoading(templatePath)) {
      console.warn(`[TemplateService] Template already loading:`, templateId);
      this.eventBus.emit('ui.notification', {
        type: 'info',
        message: `Template is already being loaded: ${templateId}`
      });
      return;
    }
    
    // Add to loading queue
    const queueId = useLoadingQueueStore.getState().enqueue({
      type: 'template',
      path: templatePath,
      displayName: templateId
    });

    try {
      // Start loading
      useLoadingQueueStore.getState().startLoading(queueId);
      
      // Emit loading event for backward compatibility
      this.eventBus.emit('file.loading', { path: templatePath });
      
      // Update progress: starting backend load
      useLoadingQueueStore.getState().updateProgress(queueId, 10);

      // Load template via backend
      console.log(`[TemplateService ${performance.now() - startTime}ms] Calling backend load_template_by_id with templateId:`, templateId);
      const templateResult = await invoke('plugin:api-bridge|load_template_by_id', {
        templateId: templateId
      }) as TemplateLoadResult;
      
      console.log(`[TemplateService ${performance.now() - startTime}ms] Template loaded:`, JSON.stringify(templateResult));

      // Update progress: backend load complete
      useLoadingQueueStore.getState().updateProgress(queueId, 50);

      // Extract volume handle info from the result
      const volumeHandleInfo = templateResult.volume_handle_info;
      
      // Create volume handle object from the VolumeHandleInfo structure
      const volumeHandle = {
        id: volumeHandleInfo.id,
        name: volumeHandleInfo.name,
        path: templatePath,
        dims: volumeHandleInfo.dims as [number, number, number],
        dtype: volumeHandleInfo.dtype,
        volume_type: volumeHandleInfo.volume_type,
        current_timepoint: volumeHandleInfo.current_timepoint || 0,
        num_timepoints: volumeHandleInfo.num_timepoints,
        time_series_info: volumeHandleInfo.time_series_info
      };

      // Use unified volume loading service
      const addedLayer = await this.volumeLoadingService.loadVolume({
        volumeHandle: volumeHandle,
        displayName: templateResult.template_metadata.name,
        source: 'template',
        sourcePath: templatePath,
        layerType: this.inferLayerType(templateResult.template_metadata.template_type),
        visible: true
      });
      
      console.log(`[TemplateService ${performance.now() - startTime}ms] Layer added successfully with ID: ${addedLayer.id}`);

      // Mark as complete in queue
      useLoadingQueueStore.getState().markComplete(queueId, {
        layerId: addedLayer.id,
        volumeId: volumeHandle.id
      });

      // Emit success events for backward compatibility
      this.eventBus.emit('file.loaded', { 
        path: templatePath, 
        volumeId: volumeHandle.id 
      });
      
      this.eventBus.emit('ui.notification', {
        type: 'info',
        message: `Loaded template: ${templateResult.template_metadata.name}`
      });

      console.log(`[TemplateService ${performance.now() - startTime}ms] Template load complete`);

    } catch (error) {
      console.error('[TemplateService] Failed to load template:', error);
      
      // Mark as error in queue
      useLoadingQueueStore.getState().markError(queueId, error as Error);

      // Emit error events for backward compatibility
      this.eventBus.emit('file.error', { 
        path: templatePath, 
        error: error as Error 
      });
      
      this.eventBus.emit('ui.notification', {
        type: 'error',
        message: `Failed to load template ${templateId}: ${(error as Error).message}`
      });
    }
  }


  /**
   * Infer layer type from template type
   */
  private inferLayerType(templateType: string): LayerInfo['type'] {
    const lower = templateType.toLowerCase();
    
    if (lower.includes('mask') || lower.includes('brain')) {
      return 'mask';
    } else if (lower.includes('gray') || lower.includes('white') || lower.includes('csf')) {
      return 'mask'; // Tissue probability maps are treated as masks
    } else {
      return 'anatomical'; // T1w, T2w, etc.
    }
  }

  /**
   * Get available templates from backend
   */
  async getTemplateCatalog() {
    try {
      return await invoke('plugin:api-bridge|get_template_catalog');
    } catch (error) {
      console.error('[TemplateService] Failed to get template catalog:', error);
      throw error;
    }
  }

  /**
   * Clean up event listeners
   */
  destroy() {
    if (this.unlistenFn) {
      void safeUnlisten(this.unlistenFn);
      this.unlistenFn = null;
    }
    this.initialized = false;
  }
}

// Singleton accessor functions
let templateServiceInstance: TemplateService | null = null;

export function getTemplateService(): TemplateService {
  if (!templateServiceInstance) {
    templateServiceInstance = TemplateService.getInstance();
  }
  return templateServiceInstance;
}

export async function initializeTemplateService(): Promise<TemplateService> {
  const service = getTemplateService();
  await service.initialize();
  return service;
}
