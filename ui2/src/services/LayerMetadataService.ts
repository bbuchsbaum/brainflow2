/**
 * LayerMetadataService - Service for fetching layer metadata without GPU allocation
 */

import { getApiService } from './apiService';
import { useLayerStore } from '@/stores/layerStore';
import type { VolumeMetadata } from '@/stores/layerStore';

export class LayerMetadataService {
  private apiService = getApiService();
  
  /**
   * Fetch metadata for a layer without allocating GPU resources
   */
  async fetchMetadata(layerId: string): Promise<VolumeMetadata | null> {
    try {
      // Get the layer to find its volumeId
      const layer = useLayerStore.getState().getLayer(layerId);
      if (!layer) {
        console.error(`[LayerMetadataService] Layer ${layerId} not found`);
        return null;
      }
      
      // Request metadata only (no GPU allocation)
      const gpuInfo = await this.apiService.requestLayerGpuResources(
        layerId,
        layer.volumeId,
        true // metadataOnly flag
      );
      
      if (!gpuInfo) {
        console.error(`[LayerMetadataService] No metadata returned for layer ${layerId}`);
        return null;
      }
      
      // Convert GPU info to metadata format
      const metadata: VolumeMetadata = {
        dataRange: gpuInfo.data_range,
        centerWorld: gpuInfo.center_world,
        isBinaryLike: gpuInfo.is_binary_like,
        dimensions: gpuInfo.dim,
        spacing: gpuInfo.spacing,
        origin: gpuInfo.origin,
        voxelToWorld: gpuInfo.voxel_to_world,
        worldToVoxel: gpuInfo.world_to_voxel,
        dataType: gpuInfo.tex_format,
      };
      
      // Store the metadata
      useLayerStore.getState().setLayerMetadata(layerId, metadata);
      
      return metadata;
    } catch (error) {
      console.error(`[LayerMetadataService] Failed to fetch metadata for layer ${layerId}:`, error);
      return null;
    }
  }
  
  /**
   * Ensure metadata is available for a layer
   * If metadata exists, returns it; otherwise fetches it
   */
  async ensureMetadata(layerId: string): Promise<VolumeMetadata | null> {
    // Check if metadata already exists
    const existingMetadata = useLayerStore.getState().getLayerMetadata(layerId);
    
    // If we have comprehensive metadata, return it
    if (existingMetadata && existingMetadata.dimensions) {
      return existingMetadata;
    }
    
    // Otherwise fetch it
    return this.fetchMetadata(layerId);
  }
}

// Singleton instance
let instance: LayerMetadataService | null = null;

export function getLayerMetadataService(): LayerMetadataService {
  if (!instance) {
    instance = new LayerMetadataService();
  }
  return instance;
}