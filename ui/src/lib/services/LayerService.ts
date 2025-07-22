/**
 * LayerService - Handles all layer-related business logic
 * Separates API calls and business logic from state management
 */
import type { LayerSpec, VolumeLayerGpuInfo, CoreApi } from '$lib/api';
import { EventBus } from '$lib/events/EventBus';
import { ValidationService } from '$lib/validation/ValidationService';
import { LayerSpecSchema } from '$lib/validation/schemas';

export interface LayerServiceConfig {
  api: CoreApi;
  eventBus: EventBus;
  validator: ValidationService;
}

export class LayerService {
  constructor(private config: LayerServiceConfig) {}

  /**
   * Request GPU resources for a layer
   * Validates input and emits events for state updates
   */
  async requestGpuResources(spec: LayerSpec): Promise<VolumeLayerGpuInfo> {
    // Validate the spec
    const validatedSpec = this.config.validator.validate('LayerSpec', spec);
    
    try {
      // Emit start event
      this.config.eventBus.emit('layer.gpu.request.start', { 
        layerId: this.getLayerId(validatedSpec) 
      });
      
      // Make API call
      const gpuInfo = await this.config.api.request_layer_gpu_resources(validatedSpec);
      
      // Emit success event
      this.config.eventBus.emit('layer.gpu.request.success', { 
        layerId: this.getLayerId(validatedSpec),
        gpuInfo 
      });
      
      return gpuInfo;
    } catch (error) {
      // Emit error event
      this.config.eventBus.emit('layer.gpu.request.error', { 
        layerId: this.getLayerId(validatedSpec),
        error 
      });
      throw error;
    }
  }

  /**
   * Release GPU resources for a layer
   */
  async releaseGpuResources(layerId: string): Promise<void> {
    try {
      await this.config.api.release_view_resources(layerId);
      this.config.eventBus.emit('layer.gpu.released', { layerId });
    } catch (error) {
      this.config.eventBus.emit('layer.gpu.release.error', { layerId, error });
      throw error;
    }
  }

  /**
   * Add a new layer
   */
  async addLayer(spec: LayerSpec): Promise<string> {
    const validatedSpec = this.config.validator.validate('LayerSpec', spec);
    const layerId = this.getLayerId(validatedSpec);
    
    // Store will handle the actual addition via event
    this.config.eventBus.emit('layer.add.requested', { layerId, spec: validatedSpec });
    
    return layerId;
  }

  /**
   * Update layer properties
   */
  async updateLayer(layerId: string, updates: any): Promise<void> {
    // For now, emit update event - the store will handle it
    this.config.eventBus.emit('layer.update.requested', { layerId, updates });
    
    // If we have opacity changes, emit specific event
    if ('opacity' in updates) {
      this.config.eventBus.emit('layer.opacity.changed', { layerId, opacity: updates.opacity });
    }
    
    // If we have colormap changes, emit specific event
    if ('colormap' in updates) {
      this.config.eventBus.emit('layer.colormap.changed', { layerId, colormap: updates.colormap });
    }
    
    // If we have window/level changes, emit specific event
    if ('window' in updates) {
      this.config.eventBus.emit('layer.windowlevel.changed', { layerId, window: updates.window });
    }
  }
  
  /**
   * Set the active layer
   */
  setActiveLayer(layerId: string | null): void {
    this.config.eventBus.emit('layer.setactive.requested', { layerId });
  }

  /**
   * Helper to get layer ID from spec
   */
  private getLayerId(spec: LayerSpec): string {
    if ('Volume' in spec) {
      return spec.Volume.id;
    }
    throw new Error('Unsupported layer type');
  }
}

/**
 * Factory function to create LayerService
 */
export function createLayerService(config: LayerServiceConfig): LayerService {
  return new LayerService(config);
}