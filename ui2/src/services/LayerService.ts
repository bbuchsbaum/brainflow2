/**
 * LayerService - Manages layer lifecycle with intelligent batching
 * 
 * Handles layer operations with efficient batching of updates, GPU resource management,
 * error handling, and loading state management.
 */

import { getEventBus } from '@/events/EventBus';
import type { EventBus } from '@/events/EventBus';
import type { Layer, LayerRender } from '@/types/layers';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';

export interface LayerApi {
  addLayer(layer: Omit<Layer, 'id'>): Promise<Layer>;
  removeLayer(id: string): Promise<void>;
  updateLayer(id: string, updates: Partial<Layer>): Promise<Layer>;
  patchLayerRender(id: string, patch: Partial<LayerRender>): Promise<void>;
  reorderLayers(layerIds: string[]): Promise<void>;
  loadLayerData(id: string): Promise<void>;
}

export interface LayerServiceConfig {
  maxBatchSize: number;
  batchTimeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
}

export interface PendingLayerOperation {
  type: 'add' | 'remove' | 'update' | 'patch' | 'reorder';
  layerId?: string;
  data?: any;
  timestamp: number;
  retries: number;
}

export class LayerService {
  private eventBus: EventBus;
  private api: LayerApi;
  private config: LayerServiceConfig;
  
  // Batching state
  private pendingPatches = new Map<string, Partial<LayerRender>>();
  private pendingOperations: PendingLayerOperation[] = [];
  private flushTimer: number | null = null;
  private isProcessing = false;
  
  // Layer state tracking
  private loadingLayers = new Set<string>();
  private errorLayers = new Map<string, Error>();
  
  // Circuit breaker state
  private failureTracker = new Map<string, number>();
  private circuitBreakers = new Map<string, boolean>();
  private readonly FAILURE_THRESHOLD = 3;
  private readonly CIRCUIT_RESET_TIME = 5000;
  
  constructor(
    api: LayerApi,
    config: Partial<LayerServiceConfig> = {}
  ) {
    this.eventBus = getEventBus();
    this.api = api;
    this.config = {
      maxBatchSize: 10,
      batchTimeoutMs: 16, // ~60fps
      maxRetries: 3,
      retryDelayMs: 1000,
      ...config
    };
  }

  /**
   * Add a new layer
   */
  async addLayer(layer: Omit<Layer, 'id'>): Promise<Layer> {
    const startTime = performance.now();
    console.log(`[LayerService ${startTime.toFixed(0)}ms] addLayer called with:`, JSON.stringify(layer));
    
    try {
      console.log(`[LayerService ${performance.now() - startTime}ms] Setting loading state for layer:`, layer.name);
      this.setLayerLoading(layer.name, true);
      
      console.log(`[LayerService ${performance.now() - startTime}ms] Calling API addLayer...`);
      const newLayer = await this.api.addLayer(layer);
      console.log(`[LayerService ${performance.now() - startTime}ms] API returned layer:`, JSON.stringify(newLayer));
      
      console.log(`[LayerService ${performance.now() - startTime}ms] Clearing loading state for layer:`, newLayer.id);
      this.setLayerLoading(newLayer.id, false);
      this.clearLayerError(newLayer.id);
      
      console.log(`[LayerService ${performance.now() - startTime}ms] Emitting layer.added event with layer:`, JSON.stringify(newLayer));
      
      // Check listener count before emitting
      const listenerCount = this.eventBus.listenerCount('layer.added');
      console.log(`[LayerService ${performance.now() - startTime}ms] Number of listeners for 'layer.added': ${listenerCount}`);
      
      // Emit the event
      console.log(`[LayerService ${performance.now() - startTime}ms] About to emit layer.added event...`);
      this.eventBus.emit('layer.added', { layer: newLayer });
      console.log(`[LayerService ${performance.now() - startTime}ms] Event emitted!`);
      
      // Check state immediately after emit
      setTimeout(() => {
        const viewStateLayers = useViewStateStore.getState().viewState.layers;
        console.log(`[LayerService] ViewState check 10ms after emit:`);
        console.log(`  - layers: ${viewStateLayers.length}`);
        console.log(`  - layer ids:`, viewStateLayers.map(l => l.id));
      }, 10);
      
      console.log(`[LayerService ${performance.now() - startTime}ms] addLayer completed successfully in ${(performance.now() - startTime).toFixed(0)}ms`);
      return newLayer;
    } catch (error) {
      console.error(`[LayerService ${performance.now() - startTime}ms] addLayer failed:`, error);
      this.setLayerLoading(layer.name, false);
      this.setLayerError(layer.name, error as Error);
      
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
      this.setLayerLoading(id, true);
      
      await this.api.removeLayer(id);
      
      this.setLayerLoading(id, false);
      this.clearLayerError(id);
      this.loadingLayers.delete(id);
      this.errorLayers.delete(id);
      
      this.eventBus.emit('layer.removed', { layerId: id });
    } catch (error) {
      this.setLayerLoading(id, false);
      this.setLayerError(id, error as Error);
      
      this.eventBus.emit('layer.error', { 
        layerId: id, 
        error: error as Error 
      });
      
      throw error;
    }
  }

  /**
   * Update layer properties (non-render properties)
   */
  async updateLayer(id: string, updates: Partial<Layer>): Promise<Layer> {
    try {
      this.setLayerLoading(id, true);
      
      const updatedLayer = await this.api.updateLayer(id, updates);
      
      this.setLayerLoading(id, false);
      this.clearLayerError(id);
      
      // Emit specific events for certain updates
      if ('visible' in updates) {
        this.eventBus.emit('layer.visibility', { 
          layerId: id, 
          visible: updates.visible! 
        });
      }
      
      return updatedLayer;
    } catch (error) {
      this.setLayerLoading(id, false);
      this.setLayerError(id, error as Error);
      
      this.eventBus.emit('layer.error', { 
        layerId: id, 
        error: error as Error 
      });
      
      throw error;
    }
  }

  /**
   * Patch layer rendering properties with batching
   */
  patchLayer(id: string, patch: Partial<LayerRender>): void {
    // Guard against empty patches
    if (Object.keys(patch).length === 0) {
      console.trace("[LayerService] Empty patch detected for layer:", id);
      return;
    }
    
    // Accumulate patches for the same layer
    const existing = this.pendingPatches.get(id) || {};
    const merged = { ...existing, ...patch };
    this.pendingPatches.set(id, merged);
    
    // Schedule flush if not already scheduled
    this.scheduleBatchFlush();
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
   * Optimized visibility toggle that batches if multiple calls
   */
  toggleVisibility(id: string, visible: boolean): void {
    // For visibility, we can batch the render update
    this.patchLayer(id, { opacity: visible ? 1.0 : 0.0 });
    
    // But also emit immediate event for UI responsiveness
    this.eventBus.emit('layer.visibility', { layerId: id, visible });
  }

  /**
   * Load layer data with progress tracking
   */
  async loadLayerData(id: string): Promise<void> {
    try {
      this.setLayerLoading(id, true);
      
      await this.api.loadLayerData(id);
      
      this.setLayerLoading(id, false);
      this.clearLayerError(id);
    } catch (error) {
      this.setLayerLoading(id, false);
      this.setLayerError(id, error as Error);
      
      this.eventBus.emit('layer.error', { 
        layerId: id, 
        error: error as Error 
      });
      
      throw error;
    }
  }

  /**
   * Schedule a batch flush using requestAnimationFrame
   */
  private scheduleBatchFlush(): void {
    if (this.flushTimer !== null || this.isProcessing) {
      return; // Already scheduled or processing
    }
    
    this.flushTimer = requestAnimationFrame(() => {
      this.flushPatches();
    });
  }

  /**
   * Flush all pending patches to the backend
   */
  private async flushPatches(): Promise<void> {
    if (this.isProcessing || this.pendingPatches.size === 0) {
      return;
    }
    
    this.isProcessing = true;
    this.flushTimer = null;
    
    // Copy and clear pending patches
    const patches = Array.from(this.pendingPatches.entries());
    this.pendingPatches.clear();
    
    try {
      // Send patches in parallel but respect max batch size
      const batches = this.chunkArray(patches, this.config.maxBatchSize);
      
      for (const batch of batches) {
        await Promise.all(
          batch.map(async ([id, patch]) => {
            // Skip empty patches
            if (Object.keys(patch).length === 0) {
              console.warn("[LayerService] Skipping empty patch in flush for layer:", id);
              return;
            }
            
            // Check circuit breaker
            if (this.circuitBreakers.get(id)) {
              console.warn(`[LayerService] Circuit open for layer ${id}, skipping patch`);
              return;
            }
            
            try {
              await this.api.patchLayerRender(id, patch);
              
              // Reset failure count on success
              this.failureTracker.delete(id);
              this.eventBus.emit('layer.patched', { layerId: id, patch });
              this.clearLayerError(id);
            } catch (error) {
              // Track failures
              const failures = (this.failureTracker.get(id) || 0) + 1;
              this.failureTracker.set(id, failures);
              
              if (failures >= this.FAILURE_THRESHOLD) {
                console.error(`[LayerService] Opening circuit for layer ${id} after ${failures} failures`);
                this.circuitBreakers.set(id, true);
                
                // Auto-reset circuit after timeout
                setTimeout(() => {
                  this.circuitBreakers.delete(id);
                  this.failureTracker.delete(id);
                  console.log(`[LayerService] Circuit reset for layer ${id}`);
                }, this.CIRCUIT_RESET_TIME);
                
                // Emit a specific error for circuit breaker
                this.eventBus.emit('layer.error', { 
                  layerId: id, 
                  error: new Error(`Circuit breaker opened after ${failures} failures. Will retry in ${this.CIRCUIT_RESET_TIME}ms`) 
                });
              } else {
                this.setLayerError(id, error as Error);
                
                this.eventBus.emit('layer.error', { 
                  layerId: id, 
                  error: error as Error 
                });
                
                // Only retry if circuit is not open
                this.retryPatch(id, patch);
              }
            }
          })
        );
      }
    } finally {
      this.isProcessing = false;
      
      // If more patches accumulated during processing, schedule another flush
      if (this.pendingPatches.size > 0) {
        this.scheduleBatchFlush();
      }
    }
  }

  /**
   * Retry a failed patch with exponential backoff
   */
  private async retryPatch(
    id: string, 
    patch: Partial<LayerRender>, 
    attempt: number = 1
  ): Promise<void> {
    // Don't retry if a newer patch is already pending
    if (this.pendingPatches.has(id)) {
      console.log(`[LayerService] Skipping retry for layer ${id}, newer patch pending`);
      return;
    }
    
    if (attempt > this.config.maxRetries) {
      console.error(`Failed to patch layer ${id} after ${this.config.maxRetries} attempts`);
      return;
    }
    
    const delay = this.config.retryDelayMs * Math.pow(2, attempt - 1);
    
    setTimeout(async () => {
      try {
        await this.api.patchLayerRender(id, patch);
        
        this.eventBus.emit('layer.patched', { layerId: id, patch });
        this.clearLayerError(id);
      } catch (error) {
        this.retryPatch(id, patch, attempt + 1);
      }
    }, delay);
  }

  /**
   * Utility to chunk arrays for batching
   */
  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * Set layer loading state
   */
  private setLayerLoading(id: string, loading: boolean): void {
    if (loading) {
      this.loadingLayers.add(id);
    } else {
      this.loadingLayers.delete(id);
    }
    
    // Update store directly to avoid circular dependency
    useLayerStore.getState().setLayerLoading(id, loading);
  }

  /**
   * Set layer error state
   */
  private setLayerError(id: string, error: Error): void {
    this.errorLayers.set(id, error);
  }

  /**
   * Clear layer error state
   */
  private clearLayerError(id: string): void {
    this.errorLayers.delete(id);
  }

  /**
   * Get current loading layers
   */
  getLoadingLayers(): Set<string> {
    return new Set(this.loadingLayers);
  }

  /**
   * Get current error layers
   */
  getErrorLayers(): Map<string, Error> {
    return new Map(this.errorLayers);
  }

  /**
   * Check if layer is currently loading
   */
  isLayerLoading(id: string): boolean {
    return this.loadingLayers.has(id);
  }

  /**
   * Get layer error if any
   */
  getLayerError(id: string): Error | undefined {
    return this.errorLayers.get(id);
  }

  /**
   * Force flush any pending patches immediately
   */
  async flushImmediate(): Promise<void> {
    if (this.flushTimer !== null) {
      cancelAnimationFrame(this.flushTimer);
      this.flushTimer = null;
    }
    
    await this.flushPatches();
  }

  /**
   * Clear all pending operations and state
   */
  dispose(): void {
    if (this.flushTimer !== null) {
      cancelAnimationFrame(this.flushTimer);
      this.flushTimer = null;
    }
    
    this.pendingPatches.clear();
    this.pendingOperations.length = 0;
    this.loadingLayers.clear();
    this.errorLayers.clear();
    this.failureTracker.clear();
    this.circuitBreakers.clear();
    this.isProcessing = false;
  }
}

// Singleton instance
let layerServiceInstance: LayerService | null = null;

/**
 * Get the singleton LayerService instance
 * Note: Requires API to be set before first use
 */
export function getLayerService(): LayerService {
  if (!layerServiceInstance) {
    throw new Error('LayerService not initialized. Call initializeLayerService first.');
  }
  return layerServiceInstance;
}

/**
 * Initialize the LayerService singleton
 */
export function initializeLayerService(
  api: LayerApi, 
  config?: Partial<LayerServiceConfig>
): LayerService {
  layerServiceInstance = new LayerService(api, config);
  return layerServiceInstance;
}