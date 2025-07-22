/**
 * CrosshairService - Manages crosshair state and view synchronization
 * 
 * Handles coordinate transformations between screen positions and world coordinates,
 * synchronizes orthogonal views, and emits events for other services to consume.
 */

import { getEventBus } from '@/events/EventBus';
import type { EventBus } from '@/events/EventBus';
import type { ViewType, ViewPlane, WorldCoordinates } from '@/types/coordinates';

export interface VolumeInfo {
  dimensions: [number, number, number];
  voxel_size_mm: [number, number, number];
  origin_mm: WorldCoordinates;
  bounds_mm: {
    min: WorldCoordinates;
    max: WorldCoordinates;
  };
}

export interface CrosshairState {
  world_mm: WorldCoordinates;
  lastUpdatedView?: ViewType;
  isVisible: boolean;
}

export class CrosshairService {
  private eventBus: EventBus;
  private crosshairState: CrosshairState;
  private volumeInfo: VolumeInfo | null = null;
  private viewPlanes: Map<ViewType, ViewPlane> = new Map();
  
  constructor() {
    this.eventBus = getEventBus();
    this.crosshairState = {
      world_mm: [0, 0, 0],
      isVisible: true
    };
  }

  /**
   * Set volume information for bounds checking
   */
  setVolumeInfo(volumeInfo: VolumeInfo): void {
    this.volumeInfo = volumeInfo;
    
    // Initialize crosshair to volume center
    const center: WorldCoordinates = [
      (volumeInfo.bounds_mm.min[0] + volumeInfo.bounds_mm.max[0]) / 2,
      (volumeInfo.bounds_mm.min[1] + volumeInfo.bounds_mm.max[1]) / 2,
      (volumeInfo.bounds_mm.min[2] + volumeInfo.bounds_mm.max[2]) / 2,
    ];
    
    this.setCrosshair(center);
  }

  /**
   * Update view plane configuration
   */
  setViewPlane(viewType: ViewType, plane: ViewPlane): void {
    this.viewPlanes.set(viewType, plane);
  }

  /**
   * Get current crosshair state
   */
  getCrosshairState(): CrosshairState {
    return { ...this.crosshairState };
  }

  /**
   * Set crosshair position directly in world coordinates
   */
  setCrosshair(world_mm: WorldCoordinates, fromView?: ViewType): void {
    // Validate position is within volume bounds
    if (!this.isWithinVolume(world_mm)) {
      // Clamp to volume bounds
      world_mm = this.clampToVolume(world_mm);
    }

    this.crosshairState = {
      world_mm: [...world_mm] as WorldCoordinates,
      lastUpdatedView: fromView,
      isVisible: this.crosshairState.isVisible
    };

    // Synchronize all views
    this.synchronizeViews(world_mm);

    // Emit event
    this.eventBus.emit('crosshair.updated', { world_mm });
  }

  /**
   * Update crosshair from screen position in a specific view
   */
  updateFromScreenPos(x: number, y: number, viewType: ViewType): void {
    const plane = this.viewPlanes.get(viewType);
    if (!plane) {
      console.warn(`View plane not configured for ${viewType}`);
      return;
    }

    // Transform screen coordinates to world coordinates
    const world_mm = this.screenToWorld(x, y, plane);
    
    // Update crosshair
    this.setCrosshair(world_mm, viewType);
  }

  /**
   * Transform screen coordinates to world coordinates
   */
  private screenToWorld(
    screenX: number, 
    screenY: number, 
    plane: ViewPlane
  ): WorldCoordinates {
    // Calculate world position using the ViewPlane's u_mm and v_mm vectors
    // screenX corresponds to the u (right) direction
    // screenY corresponds to the v (down) direction
    
    const world_mm: WorldCoordinates = [
      plane.origin_mm[0] + screenX * plane.u_mm[0] + screenY * plane.v_mm[0],
      plane.origin_mm[1] + screenX * plane.u_mm[1] + screenY * plane.v_mm[1],
      plane.origin_mm[2] + screenX * plane.u_mm[2] + screenY * plane.v_mm[2],
    ];
    
    return world_mm;
  }

  /**
   * Check if world coordinates are within volume bounds
   */
  private isWithinVolume(world_mm: WorldCoordinates): boolean {
    if (!this.volumeInfo) return true; // No bounds checking if no volume info
    
    const { bounds_mm } = this.volumeInfo;
    
    return (
      world_mm[0] >= bounds_mm.min[0] && world_mm[0] <= bounds_mm.max[0] &&
      world_mm[1] >= bounds_mm.min[1] && world_mm[1] <= bounds_mm.max[1] &&
      world_mm[2] >= bounds_mm.min[2] && world_mm[2] <= bounds_mm.max[2]
    );
  }

  /**
   * Clamp world coordinates to volume bounds
   */
  private clampToVolume(world_mm: WorldCoordinates): WorldCoordinates {
    if (!this.volumeInfo) return world_mm;
    
    const { bounds_mm } = this.volumeInfo;
    
    return [
      Math.max(bounds_mm.min[0], Math.min(bounds_mm.max[0], world_mm[0])),
      Math.max(bounds_mm.min[1], Math.min(bounds_mm.max[1], world_mm[1])),
      Math.max(bounds_mm.min[2], Math.min(bounds_mm.max[2], world_mm[2])),
    ];
  }

  /**
   * Synchronize all orthogonal views to pass through the crosshair position
   */
  private synchronizeViews(world_mm: WorldCoordinates): void {
    // Update each view plane's origin so their intersection passes through world_mm
    
    for (const [viewType, plane] of this.viewPlanes) {
      let newOrigin: WorldCoordinates;
      
      switch (viewType) {
        case 'sagittal':
          // Sagittal shows YZ plane, update X origin to crosshair X
          newOrigin = [world_mm[0], plane.origin_mm[1], plane.origin_mm[2]];
          break;
          
        case 'coronal':
          // Coronal shows XZ plane, update Y origin to crosshair Y
          newOrigin = [plane.origin_mm[0], world_mm[1], plane.origin_mm[2]];
          break;
          
        case 'axial':
          // Axial shows XY plane, update Z origin to crosshair Z
          newOrigin = [plane.origin_mm[0], plane.origin_mm[1], world_mm[2]];
          break;
          
        default:
          continue;
      }
      
      // Update the view plane with new origin
      const updatedPlane: ViewPlane = {
        ...plane,
        origin_mm: newOrigin
      };
      
      this.viewPlanes.set(viewType, updatedPlane);
      
      // Emit view-specific update event
      this.eventBus.emit('view.plane.updated', {
        viewType,
        plane: updatedPlane
      });
    }
  }

  /**
   * Set crosshair visibility
   */
  setVisible(visible: boolean): void {
    if (this.crosshairState.isVisible !== visible) {
      this.crosshairState.isVisible = visible;
      this.eventBus.emit('crosshair.visibility', { visible });
    }
  }

  /**
   * Get the view plane for a specific view type
   */
  getViewPlane(viewType: ViewType): ViewPlane | undefined {
    return this.viewPlanes.get(viewType);
  }

  /**
   * Get all configured view planes
   */
  getViewPlanes(): Map<ViewType, ViewPlane> {
    return new Map(this.viewPlanes);
  }

  /**
   * Reset crosshair to volume center
   */
  resetToCenter(): void {
    if (this.volumeInfo) {
      const center: WorldCoordinates = [
        (this.volumeInfo.bounds_mm.min[0] + this.volumeInfo.bounds_mm.max[0]) / 2,
        (this.volumeInfo.bounds_mm.min[1] + this.volumeInfo.bounds_mm.max[1]) / 2,
        (this.volumeInfo.bounds_mm.min[2] + this.volumeInfo.bounds_mm.max[2]) / 2,
      ];
      this.setCrosshair(center);
    }
  }

  /**
   * Dispose of the service and cleanup resources
   */
  dispose(): void {
    this.viewPlanes.clear();
    this.volumeInfo = null;
  }
}

// Singleton instance
let crosshairServiceInstance: CrosshairService | null = null;

/**
 * Get the singleton CrosshairService instance
 */
export function getCrosshairService(): CrosshairService {
  if (!crosshairServiceInstance) {
    crosshairServiceInstance = new CrosshairService();
  }
  return crosshairServiceInstance;
}