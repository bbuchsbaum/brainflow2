/**
 * LayerService - Simplified version
 * Manages layer operations with minimal complexity
 */

import { getEventBus } from '@/events/EventBus';
import type { EventBus } from '@/events/EventBus';
import type { Layer, LayerRender } from '@/types/layers';
import { useLayerStore } from '@/stores/layerStore';

export interface LayerApi {
  addLayer(layer: Omit<Layer, 'id'>): Promise<Layer>;
  removeLayer(id: string): Promise<void>;
  updateLayer(id: string, updates: Partial<Layer>): Promise<Layer>;
  patchLayerRender(id: string, patch: Partial<LayerRender>): Promise<void>;
  reorderLayers(layerIds: string[]): Promise<void>;
  loadLayerData(id: string): Promise<void>;
}

export interface LayerServiceConfig {
  batchTimeoutMs: number;
  maxBatchSize: number;
  maxRetries: number;
  retryDelayMs: number;
}

const DEFAULT_CONFIG: LayerServiceConfig = {
  batchTimeoutMs: 16,
  maxBatchSize: Number.POSITIVE_INFINITY,
  maxRetries: 1,
  retryDelayMs: 1000,
};

export class LayerService {
  private eventBus: EventBus;
  private api: LayerApi;
  private config: LayerServiceConfig;
  
  // Simple batching for render updates only
  private pendingPatches = new Map<string, Partial<LayerRender>>();
  private flushTimer: number | null = null;
  private loadingLayers = new Set<string>();
  private errorLayers = new Map<string, Error>();
  
  constructor(api: LayerApi, config?: Partial<LayerServiceConfig>) {
    this.eventBus = getEventBus();
    this.api = api;
    this.config = { ...DEFAULT_CONFIG, ...(config ?? {}) };
  }

  /**
   * Add a new layer
   */
  async addLayer(layer: Omit<Layer, 'id'>): Promise<Layer> {
    try {
      const provisionalId = layer.name ?? layer.volumeId;
      this.setLoadingState(provisionalId, true);

      const newLayer = await this.api.addLayer(layer);
      
      // Emit event for StoreSyncService to handle
      this.eventBus.emit('layer.added', { layer: newLayer });
      this.setLoadingState(provisionalId, false);
      this.setLoadingState(newLayer.id, false);
      this.clearError(provisionalId);
      this.clearError(newLayer.id);
      
      return newLayer;
    } catch (error) {
      const key = layer.name ?? layer.volumeId;
      this.setLoadingState(key, false);
      this.recordError(key, error as Error);
      this.eventBus.emit('layer.error', { 
        layerId: layer.name, 
        error: error as Error 
      });
      throw error;
    }
  }

  /**
   * Remove a layer
   */
  async removeLayer(id: string): Promise<void> {
    try {
      await this.api.removeLayer(id);
      this.eventBus.emit('layer.removed', { layerId: id });
      this.clearError(id);
      this.setLoadingState(id, false);
    } catch (error) {
      this.eventBus.emit('layer.error', { layerId: id, error: error as Error });
      throw error;
    }
  }

  /**
   * Update layer properties
   */
  async updateLayer(id: string, updates: Partial<Layer>): Promise<Layer> {
    try {
      const updatedLayer = await this.api.updateLayer(id, updates);
      
      // Update the layer in the store
      useLayerStore.getState().updateLayer(id, updates);
      this.clearError(id);
      
      // Emit visibility event if needed
      if ('visible' in updates) {
        this.eventBus.emit('layer.visibility', { 
          layerId: id, 
          visible: updates.visible! 
        });
      }
      
      return updatedLayer;
    } catch (error) {
      this.eventBus.emit('layer.error', { layerId: id, error: error as Error });
      throw error;
    }
  }

  /**
   * Patch layer rendering properties with simple batching
   */
  patchLayer(id: string, patch: Partial<LayerRender>): void {
    // Accumulate patches
    const existing = this.pendingPatches.get(id) || {};
    const merged = { ...existing, ...patch };
    this.pendingPatches.set(id, merged);
    
    // Schedule flush
    if (!this.flushTimer) {
      this.flushTimer = requestAnimationFrame(() => {
        this.flushTimer = null;
        void this.flushPatches();
      });
    }
  }

  /**
   * Toggle layer visibility
   */
  toggleVisibility(id: string, visible: boolean): void {
    // Update opacity (single source of truth)
    this.patchLayer(id, { opacity: visible ? 1.0 : 0.0 });
    
    // Emit event for immediate UI update
    this.eventBus.emit('layer.visibility', { layerId: id, visible });
  }

  /**
   * Reorder layers
   */
  async reorderLayers(layerIds: string[]): Promise<void> {
    try {
      await this.api.reorderLayers(layerIds);
      this.eventBus.emit('layer.reordered', { layerIds });
    } catch (error) {
      this.eventBus.emit('layer.error', { 
        layerId: 'reorder', 
        error: error as Error 
      });
      throw error;
    }
  }

  /**
   * Load layer data
   */
  async loadLayerData(id: string): Promise<void> {
    try {
      this.setLoadingState(id, true);
      useLayerStore.getState().setLayerLoading(id, true);
      await this.api.loadLayerData(id);
      this.setLoadingState(id, false);
      useLayerStore.getState().setLayerLoading(id, false);
      this.clearError(id);
    } catch (error) {
      this.setLoadingState(id, false);
      this.recordError(id, error as Error);
      useLayerStore.getState().setLayerLoading(id, false);
      useLayerStore.getState().setLayerError(id, error as Error);
      this.eventBus.emit('layer.error', { layerId: id, error: error as Error });
      throw error;
    }
  }

  /**
   * Flush pending patches
   */
  private async flushPatches(): Promise<void> {
    // Copy and clear pending patches
    const patches = Array.from(this.pendingPatches.entries());
    this.pendingPatches.clear();
    
    // Send patches
    patches.slice(0, this.config.maxBatchSize).forEach(([id, patch]) => {
      void this.dispatchPatch(id, patch, 0);
    });
  }

  private async dispatchPatch(id: string, patch: Partial<LayerRender>, attempt: number): Promise<void> {
    try {
      await this.api.patchLayerRender(id, patch);
      this.clearError(id);
      this.eventBus.emit('layer.patched', { layerId: id, patch });
    } catch (err) {
      const error = err as Error;
      this.recordError(id, error);
      this.eventBus.emit('layer.error', { layerId: id, error });

      if (attempt < this.config.maxRetries) {
        setTimeout(() => {
          void this.dispatchPatch(id, patch, attempt + 1);
        }, this.config.retryDelayMs);
      }
    }
  }

  /**
   * Force immediate flush
   */
  async flushImmediate(): Promise<void> {
    if (this.flushTimer) {
      cancelAnimationFrame(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flushPatches();
  }

  /**
   * Cleanup
   */
  dispose(): void {
    if (this.flushTimer) {
      cancelAnimationFrame(this.flushTimer);
      this.flushTimer = null;
    }
    this.pendingPatches.clear();
    this.loadingLayers.clear();
    this.errorLayers.clear();
  }

  isLayerLoading(id: string): boolean {
    return this.loadingLayers.has(id);
  }

  getLayerError(id: string): Error | undefined {
    return this.errorLayers.get(id);
  }

  getLoadingLayers(): Set<string> {
    return new Set(this.loadingLayers);
  }

  getErrorLayers(): Map<string, Error> {
    return new Map(this.errorLayers);
  }

  private setLoadingState(layerId: string | undefined, isLoading: boolean): void {
    if (!layerId) {
      return;
    }

    if (isLoading) {
      this.loadingLayers.add(layerId);
    } else {
      this.loadingLayers.delete(layerId);
    }

    this.eventBus.emit('layer.loading', { layerId, loading: isLoading });
  }

  private recordError(layerId: string | undefined, error: Error): void {
    if (!layerId) {
      return;
    }
    this.errorLayers.set(layerId, error);
  }

  private clearError(layerId: string | undefined): void {
    if (!layerId) {
      return;
    }
    this.errorLayers.delete(layerId);
  }
}

// Singleton instance
let instance: LayerService | null = null;

export function getLayerService(): LayerService {
  if (!instance) {
    throw new Error('LayerService not initialized. Call initializeLayerService first.');
  }
  return instance;
}

export function initializeLayerService(
  api: LayerApi, 
  config?: Partial<LayerServiceConfig>
): LayerService {
  instance = new LayerService(api, config);
  return instance;
}
