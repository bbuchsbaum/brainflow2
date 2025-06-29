/**
 * CrosshairService - Service layer for crosshair management
 * Handles coordinate transformations, bounds checking, and synchronization
 */

import type { EventBus } from '$lib/events/EventBus';
import type { ValidationService } from '$lib/validation/ValidationService';
import type { VolumeService, VolumeMetadata } from './VolumeService';

export interface CrosshairServiceConfig {
  eventBus: EventBus;
  validator: ValidationService;
  volumeService: VolumeService;
}

export interface CrosshairState {
  worldCoord: [number, number, number];
  voxelCoords: Map<string, [number, number, number]>; // volumeId -> voxel coords
  visible: boolean;
  color: string;
  thickness: number;
}

export class CrosshairService {
  private config: CrosshairServiceConfig;
  private state: CrosshairState = {
    worldCoord: [0, 0, 0],
    voxelCoords: new Map(),
    visible: true,
    color: '#FF0000',
    thickness: 2
  };

  constructor(config: CrosshairServiceConfig) {
    this.config = config;
    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    // Update voxel coordinates when volumes are loaded/unloaded
    this.config.eventBus.on('volume.loaded', ({ volumeId }) => {
      this.updateVoxelCoordForVolume(volumeId);
    });

    this.config.eventBus.on('volume.unloaded', ({ volumeId }) => {
      this.state.voxelCoords.delete(volumeId);
    });

    // Sync with other components
    this.config.eventBus.on('crosshair.sync.request', ({ source }) => {
      this.config.eventBus.emit('crosshair.sync.response', {
        source: 'CrosshairService',
        state: this.getState()
      });
    });
  }

  /**
   * Get current crosshair state
   */
  getState(): Readonly<CrosshairState> {
    return {
      ...this.state,
      voxelCoords: new Map(this.state.voxelCoords)
    };
  }

  /**
   * Set world coordinates
   */
  async setWorldCoordinate(
    coord: [number, number, number],
    options?: {
      source?: string;
      animated?: boolean;
      updateVoxels?: boolean;
    }
  ) {
    try {
      // Validate coordinates
      const validCoord = this.config.validator.validate('WorldCoordinate', coord);
      
      // Check if coordinates are within any loaded volume
      const volumes = this.config.volumeService.getAllVolumes();
      if (volumes.length > 0 && !this.isCoordinateInAnyVolume(validCoord, volumes)) {
        this.config.eventBus.emit('crosshair.warning', {
          message: 'Coordinates outside all volume bounds'
        });
      }
      
      // Update state
      this.state.worldCoord = validCoord;
      
      // Update voxel coordinates for all volumes
      if (options?.updateVoxels !== false) {
        await this.updateAllVoxelCoords();
      }
      
      // Emit update event
      this.config.eventBus.emit('crosshair.updated', {
        worldCoord: validCoord,
        voxelCoords: this.state.voxelCoords,
        source: options?.source || 'CrosshairService',
        animated: options?.animated || false
      });
    } catch (error) {
      this.config.eventBus.emit('crosshair.error', {
        operation: 'setWorldCoordinate',
        error
      });
      throw error;
    }
  }

  /**
   * Set voxel coordinates for a specific volume
   */
  async setVoxelCoordinate(
    volumeId: string,
    voxelCoord: [number, number, number],
    options?: {
      source?: string;
      animated?: boolean;
      updateWorld?: boolean;
    }
  ) {
    try {
      // Get volume metadata
      const volume = this.config.volumeService.getVolumeMetadata(volumeId);
      if (!volume) {
        throw new Error(`Volume ${volumeId} not found`);
      }
      
      // Validate voxel coordinates
      this.validateVoxelCoordinate(voxelCoord, volume);
      
      // Convert to world coordinates if needed
      if (options?.updateWorld !== false) {
        const worldCoord = await this.config.volumeService.voxelToWorld(
          volumeId,
          voxelCoord
        );
        
        await this.setWorldCoordinate(worldCoord, {
          source: options?.source,
          animated: options?.animated,
          updateVoxels: false
        });
      }
      
      // Update voxel coordinate for this volume
      this.state.voxelCoords.set(volumeId, voxelCoord);
      
      // Emit update event
      this.config.eventBus.emit('crosshair.voxel.updated', {
        volumeId,
        voxelCoord,
        source: options?.source || 'CrosshairService'
      });
    } catch (error) {
      this.config.eventBus.emit('crosshair.error', {
        operation: 'setVoxelCoordinate',
        error
      });
      throw error;
    }
  }

  /**
   * Move crosshair by a delta in world space
   */
  async moveByWorld(
    delta: [number, number, number],
    options?: {
      source?: string;
      animated?: boolean;
    }
  ) {
    const newCoord: [number, number, number] = [
      this.state.worldCoord[0] + delta[0],
      this.state.worldCoord[1] + delta[1],
      this.state.worldCoord[2] + delta[2]
    ];
    
    await this.setWorldCoordinate(newCoord, options);
  }

  /**
   * Move crosshair by a delta in voxel space
   */
  async moveByVoxel(
    volumeId: string,
    delta: [number, number, number],
    options?: {
      source?: string;
      animated?: boolean;
    }
  ) {
    const currentVoxel = this.state.voxelCoords.get(volumeId);
    if (!currentVoxel) {
      throw new Error(`No voxel coordinate for volume ${volumeId}`);
    }
    
    const newVoxel: [number, number, number] = [
      Math.round(currentVoxel[0] + delta[0]),
      Math.round(currentVoxel[1] + delta[1]),
      Math.round(currentVoxel[2] + delta[2])
    ];
    
    await this.setVoxelCoordinate(volumeId, newVoxel, options);
  }

  /**
   * Center crosshair in volume
   */
  async centerInVolume(volumeId: string, animated = true) {
    const volume = this.config.volumeService.getVolumeMetadata(volumeId);
    if (!volume) {
      throw new Error(`Volume ${volumeId} not found`);
    }
    
    const centerVoxel: [number, number, number] = [
      Math.floor(volume.dimensions[0] / 2),
      Math.floor(volume.dimensions[1] / 2),
      Math.floor(volume.dimensions[2] / 2)
    ];
    
    await this.setVoxelCoordinate(volumeId, centerVoxel, {
      animated,
      source: 'center-command'
    });
  }

  /**
   * Set crosshair visibility
   */
  setVisible(visible: boolean) {
    if (this.state.visible !== visible) {
      this.state.visible = visible;
      this.config.eventBus.emit('crosshair.visibility.changed', { visible });
    }
  }

  /**
   * Toggle crosshair visibility
   */
  toggleVisible() {
    this.setVisible(!this.state.visible);
  }

  /**
   * Set crosshair appearance
   */
  setAppearance(options: { color?: string; thickness?: number }) {
    let changed = false;
    
    if (options.color && options.color !== this.state.color) {
      this.state.color = options.color;
      changed = true;
    }
    
    if (options.thickness && options.thickness !== this.state.thickness) {
      this.state.thickness = options.thickness;
      changed = true;
    }
    
    if (changed) {
      this.config.eventBus.emit('crosshair.appearance.changed', {
        color: this.state.color,
        thickness: this.state.thickness
      });
    }
  }

  /**
   * Get slice indices for all orientations
   */
  getSliceIndices(volumeId: string): {
    axial: number;
    sagittal: number;
    coronal: number;
  } | null {
    const voxelCoord = this.state.voxelCoords.get(volumeId);
    if (!voxelCoord) {
      return null;
    }
    
    return {
      axial: Math.round(voxelCoord[2]),
      sagittal: Math.round(voxelCoord[0]),
      coronal: Math.round(voxelCoord[1])
    };
  }

  /**
   * Snap to nearest voxel center
   */
  async snapToVoxel(volumeId?: string) {
    const targetVolumeId = volumeId || this.getFirstVolumeId();
    if (!targetVolumeId) {
      return;
    }
    
    const voxelCoord = await this.config.volumeService.worldToVoxel(
      targetVolumeId,
      this.state.worldCoord
    );
    
    // Round to nearest integer voxel
    const snappedVoxel: [number, number, number] = [
      Math.round(voxelCoord[0]),
      Math.round(voxelCoord[1]),
      Math.round(voxelCoord[2])
    ];
    
    await this.setVoxelCoordinate(targetVolumeId, snappedVoxel, {
      source: 'snap-command'
    });
  }

  /**
   * Private helper methods
   */
  private async updateAllVoxelCoords() {
    const volumes = this.config.volumeService.getAllVolumes();
    
    await Promise.all(
      volumes.map(volume => this.updateVoxelCoordForVolume(volume.id))
    );
  }

  private async updateVoxelCoordForVolume(volumeId: string) {
    try {
      const voxelCoord = await this.config.volumeService.worldToVoxel(
        volumeId,
        this.state.worldCoord
      );
      
      this.state.voxelCoords.set(volumeId, voxelCoord);
    } catch (error) {
      // Volume might not support coordinate transformation
      console.warn(`Failed to update voxel coord for volume ${volumeId}:`, error);
    }
  }

  private isCoordinateInAnyVolume(
    coord: [number, number, number],
    volumes: VolumeMetadata[]
  ): boolean {
    return volumes.some(volume => this.isCoordinateInVolume(coord, volume));
  }

  private isCoordinateInVolume(
    coord: [number, number, number],
    volume: VolumeMetadata
  ): boolean {
    // Simple bounding box check
    // In reality, this would need to consider the affine transformation
    const min = volume.origin;
    const max = [
      min[0] + volume.dimensions[0] * volume.spacing[0],
      min[1] + volume.dimensions[1] * volume.spacing[1],
      min[2] + volume.dimensions[2] * volume.spacing[2]
    ];
    
    return (
      coord[0] >= Math.min(min[0], max[0]) &&
      coord[0] <= Math.max(min[0], max[0]) &&
      coord[1] >= Math.min(min[1], max[1]) &&
      coord[1] <= Math.max(min[1], max[1]) &&
      coord[2] >= Math.min(min[2], max[2]) &&
      coord[2] <= Math.max(min[2], max[2])
    );
  }

  private validateVoxelCoordinate(
    coord: [number, number, number],
    volume: VolumeMetadata
  ) {
    for (let i = 0; i < 3; i++) {
      if (coord[i] < 0 || coord[i] >= volume.dimensions[i]) {
        throw new Error(
          `Voxel coordinate ${coord[i]} out of bounds [0, ${volume.dimensions[i] - 1}] for axis ${i}`
        );
      }
    }
  }

  private getFirstVolumeId(): string | undefined {
    const volumes = this.config.volumeService.getAllVolumes();
    return volumes[0]?.id;
  }

  /**
   * Dispose of the service
   */
  dispose() {
    this.state.voxelCoords.clear();
  }
}

// Factory function for dependency injection
export function createCrosshairService(config: CrosshairServiceConfig): CrosshairService {
  return new CrosshairService(config);
}