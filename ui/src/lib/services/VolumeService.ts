/**
 * VolumeService - Service layer for volume management
 * Handles all volume-related business logic, separated from state management
 */

import type { EventBus } from '$lib/events/EventBus';
import type { ValidationService } from '$lib/validation/ValidationService';
import type { VolumeHandleInfo, SliceInfo, TimeSeriesResult, TextureCoordinates } from '@brainflow/api';
import type { GpuResourceManager } from '$lib/gpu/GpuResourceManager';
import { LRUCache } from '$lib/utils/LRUCache';

export interface VolumeServiceConfig {
  eventBus: EventBus;
  validator: ValidationService;
  api: any; // CoreAPI type
  gpuManager: GpuResourceManager;
}

export interface VolumeMetadata {
  id: string;
  path: string;
  name: string;
  dimensions: [number, number, number];
  voxelSize: [number, number, number];
  dataType: string;
  origin: [number, number, number];
  spacing: [number, number, number];
  loadedAt: number;
}

export class VolumeService {
  private config: VolumeServiceConfig;
  private volumeCache = new Map<string, VolumeMetadata>();
  private sliceCache = new LRUCache<string, SliceInfo>(50);
  private timeseriesCache = new LRUCache<string, TimeSeriesResult>(20);

  constructor(config: VolumeServiceConfig) {
    this.config = config;
    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    // Listen for cleanup events
    this.config.eventBus.on('volume.unload', ({ volumeId }) => {
      this.volumeCache.delete(volumeId);
      this.clearCachesForVolume(volumeId);
    });
  }

  /**
   * Load a volume file
   */
  async loadVolume(path: string, name?: string): Promise<VolumeHandleInfo> {
    try {
      // Validate path
      const validPath = this.config.validator.validate('FilePath', path);
      
      // Emit loading event
      this.config.eventBus.emit('volume.loading', { path: validPath });
      
      // Load the volume
      const startTime = performance.now();
      const volumeHandle = await this.config.api.load_file(validPath);
      const loadTime = performance.now() - startTime;
      
      // Validate volume handle
      if (volumeHandle && volumeHandle.id) {
        // Store metadata
        const metadata: VolumeMetadata = {
          id: volumeHandle.id,
          path: validPath,
          name: name || this.extractFileName(validPath),
          dimensions: volumeHandle.dims,
          voxelSize: [1, 1, 1], // Default voxel size since it's not in VolumeHandleInfo
          dataType: volumeHandle.dtype,
          origin: [0, 0, 0], // Default origin
          spacing: [1, 1, 1], // Default spacing
          loadedAt: Date.now()
        };
        
        this.volumeCache.set(volumeHandle.id, metadata);
        
        // Emit success event
        this.config.eventBus.emit('volume.loaded', {
          volumeId: volumeHandle.id,
          metadata,
          loadTime
        });
        
        return volumeHandle;
      }
      
      throw new Error('Invalid volume handle returned');
    } catch (error) {
      this.config.eventBus.emit('volume.load.failed', { path, error });
      throw error;
    }
  }

  /**
   * Unload a volume and free resources
   */
  async unloadVolume(volumeId: string): Promise<void> {
    try {
      // Release GPU resources
      await this.config.gpuManager.releaseResourcesForVolume(volumeId);
      
      // Clear caches
      this.clearCachesForVolume(volumeId);
      
      // Remove metadata
      this.volumeCache.delete(volumeId);
      
      // TODO: Call Rust API to release volume when available
      // await this.config.api.unload_volume(volumeId);
      
      this.config.eventBus.emit('volume.unloaded', { volumeId });
    } catch (error) {
      this.config.eventBus.emit('volume.unload.failed', { volumeId, error });
      throw error;
    }
  }

  /**
   * Get volume metadata
   */
  getVolumeMetadata(volumeId: string): VolumeMetadata | undefined {
    return this.volumeCache.get(volumeId);
  }

  /**
   * Get all loaded volumes
   */
  getAllVolumes(): VolumeMetadata[] {
    return Array.from(this.volumeCache.values());
  }

  /**
   * Get a slice from a volume
   */
  async getSlice(
    volumeId: string,
    axis: 'axial' | 'sagittal' | 'coronal',
    index: number
  ): Promise<SliceInfo> {
    const cacheKey = `${volumeId}:${axis}:${index}`;
    
    // Check cache
    const cached = this.sliceCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    
    try {
      // Validate parameters
      const metadata = this.volumeCache.get(volumeId);
      if (!metadata) {
        throw new Error(`Volume ${volumeId} not loaded`);
      }
      
      const maxIndex = this.getMaxSliceIndex(metadata, axis);
      if (index < 0 || index > maxIndex) {
        throw new Error(`Slice index ${index} out of bounds [0, ${maxIndex}]`);
      }
      
      // Get slice from API
      const slice = await this.config.api.get_slice(volumeId, axis, index);
      
      // Cache result
      this.sliceCache.set(cacheKey, slice);
      
      return slice;
    } catch (error) {
      this.config.eventBus.emit('volume.slice.failed', { volumeId, axis, index, error });
      throw error;
    }
  }

  /**
   * Sample volume at world coordinates
   */
  async sampleWorldCoordinate(
    volumeId: string,
    worldCoord: [number, number, number]
  ): Promise<number> {
    try {
      const value = await this.config.api.sample_world_coordinate(volumeId, worldCoord);
      return value;
    } catch (error) {
      this.config.eventBus.emit('volume.sample.failed', { volumeId, worldCoord, error });
      throw error;
    }
  }

  /**
   * Get timeseries data at a voxel
   */
  async getTimeseries(
    volumeId: string,
    voxelCoord: [number, number, number]
  ): Promise<TimeSeriesResult> {
    const cacheKey = `${volumeId}:${voxelCoord.join(',')}`;
    
    // Check cache
    const cached = this.timeseriesCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    
    try {
      const timeseries = await this.config.api.get_timeseries_matrix(
        volumeId,
        voxelCoord,
        'voxel'
      );
      
      // Cache result
      this.timeseriesCache.set(cacheKey, timeseries);
      
      return timeseries;
    } catch (error) {
      this.config.eventBus.emit('volume.timeseries.failed', { volumeId, voxelCoord, error });
      throw error;
    }
  }

  /**
   * Transform coordinates between spaces
   */
  async worldToVoxel(
    volumeId: string,
    worldCoord: [number, number, number]
  ): Promise<[number, number, number]> {
    try {
      return await this.config.api.world_to_voxel(volumeId, worldCoord);
    } catch (error) {
      this.config.eventBus.emit('volume.transform.failed', { volumeId, worldCoord, error });
      throw error;
    }
  }

  async voxelToWorld(
    volumeId: string,
    voxelCoord: [number, number, number]
  ): Promise<[number, number, number]> {
    try {
      return await this.config.api.voxel_to_world(volumeId, voxelCoord);
    } catch (error) {
      this.config.eventBus.emit('volume.transform.failed', { volumeId, voxelCoord, error });
      throw error;
    }
  }

  /**
   * Get texture coordinates for rendering
   */
  async getTextureCoordinates(
    volumeId: string,
    worldCoord: [number, number, number]
  ): Promise<TextureCoordinates> {
    try {
      return await this.config.api.world_to_texture_coordinates(volumeId, worldCoord);
    } catch (error) {
      this.config.eventBus.emit('volume.texture.failed', { volumeId, worldCoord, error });
      throw error;
    }
  }

  /**
   * Calculate volume statistics
   */
  async calculateStatistics(volumeId: string): Promise<{
    min: number;
    max: number;
    mean: number;
    std: number;
    histogram: number[];
  }> {
    try {
      const metadata = this.volumeCache.get(volumeId);
      if (!metadata) {
        throw new Error(`Volume ${volumeId} not loaded`);
      }
      
      // This would ideally be computed in Rust
      // For now, return placeholder
      this.config.eventBus.emit('volume.statistics.start', { volumeId });
      
      // TODO: Implement actual statistics calculation
      const stats = {
        min: 0,
        max: 255,
        mean: 127.5,
        std: 50,
        histogram: new Array(256).fill(0)
      };
      
      this.config.eventBus.emit('volume.statistics.complete', { volumeId, stats });
      
      return stats;
    } catch (error) {
      this.config.eventBus.emit('volume.statistics.failed', { volumeId, error });
      throw error;
    }
  }

  /**
   * Helper methods
   */
  private extractFileName(path: string): string {
    return path.split('/').pop()?.split('.')[0] || 'Unnamed';
  }

  private getMaxSliceIndex(metadata: VolumeMetadata, axis: 'axial' | 'sagittal' | 'coronal'): number {
    switch (axis) {
      case 'axial':
        return metadata.dimensions[2] - 1;
      case 'sagittal':
        return metadata.dimensions[0] - 1;
      case 'coronal':
        return metadata.dimensions[1] - 1;
    }
  }

  private clearCachesForVolume(volumeId: string) {
    // Clear slice cache entries for this volume
    for (const key of this.sliceCache.keys()) {
      if (key.startsWith(`${volumeId}:`)) {
        this.sliceCache.delete(key);
      }
    }
    
    // Clear timeseries cache entries for this volume
    for (const key of this.timeseriesCache.keys()) {
      if (key.startsWith(`${volumeId}:`)) {
        this.timeseriesCache.delete(key);
      }
    }
  }

  /**
   * Dispose of the service
   */
  dispose() {
    this.volumeCache.clear();
    this.sliceCache.clear();
    this.timeseriesCache.clear();
  }
}

// Factory function for dependency injection
export function createVolumeService(config: VolumeServiceConfig): VolumeService {
  return new VolumeService(config);
}