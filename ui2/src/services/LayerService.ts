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

export class LayerService {
  private eventBus: EventBus;
  private api: LayerApi;
  
  // Simple batching for render updates only
  private pendingPatches = new Map<string, Partial<LayerRender>>();
  private flushTimer: number | null = null;
  
  constructor(api: LayerApi) {
    this.eventBus = getEventBus();
    this.api = api;
  }

  /**
   * Add a new layer
   */
  async addLayer(layer: Omit<Layer, 'id'>): Promise<Layer> {
    try {
      const newLayer = await this.api.addLayer(layer);
      
      // Emit event for StoreSyncService to handle
      this.eventBus.emit('layer.added', { layer: newLayer });
      
      return newLayer;
    } catch (error) {
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
      this.flushTimer = requestAnimationFrame(() => this.flushPatches());
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
      useLayerStore.getState().setLayerLoading(id, true);
      await this.api.loadLayerData(id);
      useLayerStore.getState().setLayerLoading(id, false);
    } catch (error) {
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
    this.flushTimer = null;
    
    // Copy and clear pending patches
    const patches = Array.from(this.pendingPatches.entries());
    this.pendingPatches.clear();
    
    // Send patches
    await Promise.all(
      patches.map(async ([id, patch]) => {
        try {
          await this.api.patchLayerRender(id, patch);
          this.eventBus.emit('layer.patched', { layerId: id, patch });
        } catch (error) {
          this.eventBus.emit('layer.error', { 
            layerId: id, 
            error: error as Error 
          });
        }
      })
    );
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
  config?: any // Config no longer used in simplified version
): LayerService {
  instance = new LayerService(api);
  return instance;
}