/**
 * TemplateService - Handles template loading from menu events
 * Listens for template-action events from Tauri menu and loads templates
 */

import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { getEventBus, type EventBus } from '@/events/EventBus';
import { getVolumeLoadingService, type VolumeLoadingService } from './VolumeLoadingService';
import { getApiService, type ApiService } from './apiService';
import { useLayerStore } from '@/stores/layerStore';
import { VolumeHandleStore } from './VolumeHandleStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import type { LayerInfo } from '@/stores/layerStore';

interface TemplateLoadResult {
  template_metadata: {
    id: string;
    name: string;
    description: string;
    space: string;
    resolution: string;
    template_type: string;
    bounds_mm?: number[];
    data_range?: [number, number];
  };
  volume_handle_info: {
    id: string;
    name: string;
    dims: number[];
    dtype: string;
    volume_type: 'Volume3D' | 'TimeSeries4D';
    num_timepoints?: number;
    current_timepoint?: number;
    time_series_info?: {
      num_timepoints: number;
      tr?: number;
      temporal_unit?: string;
      acquisition_time?: number;
    };
  };
}

interface TemplateActionEvent {
  action: string;
  payload: {
    template_id: string;
  };
}

export class TemplateService {
  private static instance: TemplateService | null = null;
  private eventBus: EventBus;
  private volumeLoadingService: VolumeLoadingService;
  private apiService: ApiService;
  private unlistenFn: (() => void) | null = null;
  private initialized = false;

  private constructor() {
    this.eventBus = getEventBus();
    this.volumeLoadingService = getVolumeLoadingService();
    this.apiService = getApiService();
    this.initializeEventListeners();
  }

  public static getInstance(): TemplateService {
    if (!TemplateService.instance) {
      TemplateService.instance = new TemplateService();
    }
    return TemplateService.instance;
  }

  private async initializeEventListeners() {
    if (this.initialized) {
      console.warn('[TemplateService] Already initialized, skipping...');
      return;
    }

    try {
      // Listen for template-action events from Tauri menu
      this.unlistenFn = await listen<TemplateActionEvent>('template-action', async (event) => {
        console.log('[TemplateService] Received template-action event:', event.payload);
        
        const { action, payload } = event.payload;
        
        if (action === 'load-template') {
          await this.loadTemplate(payload.template_id);
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

    try {
      // Emit loading event
      this.eventBus.emit('file.loading', { path: `template:${templateId}` });
      
      // Create temporary layer ID for loading state
      const tempLayerId = `template-loading-${Date.now()}`;
      useLayerStore.getState().setLayerLoading(tempLayerId, true);

      // Load template via backend
      console.log(`[TemplateService ${performance.now() - startTime}ms] Calling backend load_template_by_id...`);
      const templateResult = await invoke('plugin:api-bridge|load_template_by_id', {
        templateId: templateId
      }) as TemplateLoadResult;
      
      console.log(`[TemplateService ${performance.now() - startTime}ms] Template loaded:`, JSON.stringify(templateResult));

      // Extract volume handle info from the result
      const volumeHandleInfo = templateResult.volume_handle_info;
      
      // Create volume handle object from the VolumeHandleInfo structure
      const volumeHandle = {
        id: volumeHandleInfo.id,
        name: volumeHandleInfo.name,
        path: `template:${templateId}`,
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
        sourcePath: `template:${templateId}`,
        layerType: this.inferLayerType(templateResult.template_metadata.template_type),
        visible: true
      });
      
      console.log(`[TemplateService ${performance.now() - startTime}ms] Layer added successfully with ID: ${addedLayer.id}`);

      // Clear temporary loading state
      useLayerStore.getState().setLayerLoading(tempLayerId, false);

      // Emit success events
      this.eventBus.emit('file.loaded', { 
        path: `template:${templateId}`, 
        volumeId: volumeHandle.id 
      });
      
      this.eventBus.emit('ui.notification', {
        type: 'info',
        message: `Loaded template: ${templateResult.template_metadata.name}`
      });

      console.log(`[TemplateService ${performance.now() - startTime}ms] Template load complete`);

    } catch (error) {
      console.error('[TemplateService] Failed to load template:', error);
      
      // Clear any loading states
      useLayerStore.getState().loadingLayers.forEach(id => {
        useLayerStore.getState().setLayerLoading(id, false);
      });

      // Emit error events
      this.eventBus.emit('file.error', { 
        path: `template:${templateId}`, 
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
      this.unlistenFn();
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

export function initializeTemplateService(): TemplateService {
  return getTemplateService();
}