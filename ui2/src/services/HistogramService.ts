/**
 * HistogramService - Manages histogram data fetching and caching
 */

import { invoke } from '@tauri-apps/api/core';
import type { HistogramData, HistogramRequest } from '@/types/histogram';
import { useLayerStore } from '@/stores/layerStore';
import { getEventBus } from '@/events/EventBus';

class HistogramService {
  private static instance: HistogramService | null = null;
  private cache: Map<string, HistogramData> = new Map();
  private pendingRequests: Map<string, Promise<HistogramData>> = new Map();
  
  private constructor() {
    // Listen for layer events to invalidate cache
    const eventBus = getEventBus();
    
    eventBus.on('layer.removed', ({ layerId }) => {
      this.cache.delete(layerId);
      this.pendingRequests.delete(layerId);
    });
    
    eventBus.on('layer.updated', ({ layerId }) => {
      // Invalidate cache when layer is updated
      this.cache.delete(layerId);
    });
    
    eventBus.on('layer.render.changed', ({ layerId }) => {
      // Invalidate cache when layer render properties change
      this.clearLayerCache(layerId);
    });
  }
  
  static getInstance(): HistogramService {
    if (!HistogramService.instance) {
      HistogramService.instance = new HistogramService();
    }
    return HistogramService.instance;
  }
  
  /**
   * Compute histogram for a layer
   */
  async computeHistogram(request: HistogramRequest): Promise<HistogramData> {
    const cacheKey = this.getCacheKey(request);
    
    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached) {
      console.log(`[HistogramService] Returning cached histogram for ${request.layerId}`);
      return cached;
    }
    
    // Check if there's already a pending request
    const pending = this.pendingRequests.get(cacheKey);
    if (pending) {
      console.log(`[HistogramService] Returning pending request for ${request.layerId}`);
      return pending;
    }
    
    // GPU readiness is guaranteed before histogram requests (see LayerApiImpl),
    // so no retry logic is needed here.
    const promise = this.fetchHistogram(request);
    this.pendingRequests.set(cacheKey, promise);
    
    try {
      const data = await promise;
      this.cache.set(cacheKey, data);
      this.pendingRequests.delete(cacheKey);
      return data;
    } catch (error) {
      this.pendingRequests.delete(cacheKey);
      throw error;
    }
  }
  
  /**
   * Get histogram for the currently selected layer
   */
  async getSelectedLayerHistogram(options?: Partial<HistogramRequest>): Promise<HistogramData | null> {
    const { selectedLayerId } = useLayerStore.getState();
    if (!selectedLayerId) {
      return null;
    }
    
    return this.computeHistogram({
      layerId: selectedLayerId,
      binCount: 256,
      excludeZeros: false,
      ...options
    });
  }
  
  /**
   * Clear all cached histograms
   */
  clearCache(): void {
    this.cache.clear();
  }
  
  /**
   * Clear cached histogram for a specific layer
   */
  clearLayerCache(layerId: string): void {
    // Clear all cache entries for this layer
    for (const key of this.cache.keys()) {
      if (key.startsWith(layerId)) {
        this.cache.delete(key);
      }
    }
  }
  
  private async fetchHistogram(request: HistogramRequest): Promise<HistogramData> {
    console.log(`[HistogramService] Computing histogram for layer ${request.layerId}`);
    
    try {
      // Call backend to compute histogram
      const response = await invoke<{
        bins: Array<{
          x0: number;
          x1: number;
          count: number;
        }>;
        total_count: number;
        min_value: number;
        max_value: number;
        mean: number;
        std: number;
        bin_count: number;
      }>('plugin:api-bridge|compute_layer_histogram', {
        layerId: request.layerId,
        binCount: request.binCount || 256,
        range: request.range,
        excludeZeros: request.excludeZeros || false
      });
      
      // Transform response to frontend format
      const maxCount = Math.max(...response.bins.map(b => b.count));
      const bins = response.bins.map(bin => ({
        x0: bin.x0,
        x1: bin.x1,
        count: bin.count,
        normalizedCount: maxCount > 0 ? bin.count / maxCount : 0,
        percentage: response.total_count > 0 ? (bin.count / response.total_count) * 100 : 0
      }));
      
      // Debug logging
      console.log('[HistogramService] Received histogram response:', {
        totalCount: response.total_count,
        range: [response.min_value, response.max_value],
        binCount: response.bin_count,
        nonZeroBins: response.bins.filter(b => b.count > 0).length,
        maxCount,
        firstFewBins: response.bins.slice(0, 5)
      });
      
      return {
        bins,
        totalCount: response.total_count,
        minValue: response.min_value,
        maxValue: response.max_value,
        mean: response.mean,
        std: response.std,
        binCount: response.bin_count,
        layerId: request.layerId
      };
    } catch (error) {
      console.error('[HistogramService] Failed to compute histogram:', error);
      throw error;
    }
  }
  
  private getCacheKey(request: HistogramRequest): string {
    const parts = [
      request.layerId,
      request.binCount || 256,
      request.excludeZeros ? 'no-zeros' : 'with-zeros'
    ];
    
    if (request.range) {
      parts.push(`range-${request.range[0]}-${request.range[1]}`);
    }
    
    return parts.join('-');
  }
}

// Export singleton instance
export const histogramService = HistogramService.getInstance();