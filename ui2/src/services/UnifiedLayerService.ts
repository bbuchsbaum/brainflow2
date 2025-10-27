/**
 * UnifiedLayerService - Facade Pattern Implementation
 * 
 * Provides a unified interface for managing both volume and surface layers
 * while keeping the underlying stores separate. This avoids backend changes
 * and maintains clean architecture.
 * 
 * @module UnifiedLayerService
 * @see {@link file://./../../docs/FACADE_PATTERN.md} for architectural details
 * 
 * Based on expert consensus from Gemini-2.5-Pro and O3 (2025-01-09)
 * 
 * @example
 * // Get singleton instance
 * const service = UnifiedLayerService.getInstance();
 * 
 * // Get all layers
 * const layers = service.getAllLayers();
 * 
 * // Update a layer property
 * service.updateLayerProperty('layer-id', 'visible', false);
 * 
 * // Create vol2surf mapping
 * const mappingId = await service.createVol2SurfMapping('vol-1', 'surf-1');
 */

import { useLayerStore, type LayerInfo } from '@/stores/layerStore';
import { useSurfaceStore, type LoadedSurface } from '@/stores/surfaceStore';
import { nanoid } from 'nanoid';

/**
 * Discriminated union type for unified layer representation
 * Allows type-safe handling of both volumes and surfaces
 */
export type ManagedLayer = 
  | { 
      id: string;
      type: 'volume';
      name: string;
      visible: boolean;
      opacity: number;
      data: LayerInfo;
    }
  | { 
      id: string;
      type: 'surface';
      name: string;
      visible: boolean;
      opacity: number;
      data: LoadedSurface;
      sourceVolumeId?: string; // For vol2surf mapping
    };

/**
 * Type guard for volume layers
 */
export function isVolumeLayer(layer: ManagedLayer): layer is ManagedLayer & { type: 'volume' } {
  return layer.type === 'volume';
}

/**
 * Type guard for surface layers
 */
export function isSurfaceLayer(layer: ManagedLayer): layer is ManagedLayer & { type: 'surface' } {
  return layer.type === 'surface';
}

/**
 * Type guard for vol2surf layers (surfaces with mapped volume data)
 */
export function isVol2SurfLayer(layer: ManagedLayer): boolean {
  return layer.type === 'surface' && !!layer.sourceVolumeId;
}

/**
 * Facade service that provides unified access to both volume and surface layers
 */
export class UnifiedLayerService {
  private static instance: UnifiedLayerService;

  /**
   * Singleton pattern - ensures single instance
   */
  public static getInstance(): UnifiedLayerService {
    if (!UnifiedLayerService.instance) {
      UnifiedLayerService.instance = new UnifiedLayerService();
    }
    return UnifiedLayerService.instance;
  }

  /**
   * Get all layers from both stores as a unified list
   */
  public getAllLayers(): ManagedLayer[] {
    const volumeLayers = useLayerStore.getState().layers;
    const surfaces = useSurfaceStore.getState().surfaces;
    
    // Map volume layers to ManagedLayer format
    const managedVolumes: ManagedLayer[] = volumeLayers.map(layer => ({
      id: layer.id,
      type: 'volume' as const,
      name: layer.name,
      visible: layer.visible,
      opacity: 1.0, // Volumes use visibility boolean, not opacity
      data: layer
    }));
    
    // Map surface layers to ManagedLayer format
    const managedSurfaces: ManagedLayer[] = Array.from(surfaces.values()).map(surface => {
      // Check if this surface has vol2surf mapping
      const sourceVolumeId = surface.metadata?.sourceVolumeId as string | undefined;
      
      return {
        id: surface.handle,
        type: 'surface' as const,
        name: surface.name,
        visible: true, // Surfaces are visible by default
        opacity: 1.0, // Could be extended to support surface opacity
        data: surface,
        sourceVolumeId
      };
    });
    
    return [...managedVolumes, ...managedSurfaces];
  }

  /**
   * Get only volume layers
   */
  public getVolumeLayers(): ManagedLayer[] {
    return this.getAllLayers().filter(isVolumeLayer);
  }

  /**
   * Get only surface layers
   */
  public getSurfaceLayers(): ManagedLayer[] {
    return this.getAllLayers().filter(isSurfaceLayer);
  }

  /**
   * Get only vol2surf layers (surfaces with mapped volume data)
   */
  public getVol2SurfLayers(): ManagedLayer[] {
    return this.getAllLayers().filter(isVol2SurfLayer);
  }

  /**
   * Get a specific layer by ID
   */
  public getLayerById(id: string): ManagedLayer | undefined {
    return this.getAllLayers().find(layer => layer.id === id);
  }

  /**
   * Update a layer property, delegating to the appropriate store
   */
  public updateLayerProperty(id: string, property: string, value: any): void {
    const layer = this.getLayerById(id);
    if (!layer) {
      console.warn(`Layer ${id} not found`);
      return;
    }
    
    if (isVolumeLayer(layer)) {
      // Update volume layer via layerStore
      useLayerStore.getState().updateLayer(id, { [property]: value });
    } else if (isSurfaceLayer(layer)) {
      // Update surface layer via surfaceStore
      const surfaceStore = useSurfaceStore.getState();
      
      // Handle different property types
      switch (property) {
        case 'visible':
          // Toggle surface visibility (could be extended)
          break;
        case 'opacity':
          // Update surface opacity (could be extended)
          break;
        default:
          // Generic property update
          surfaceStore.updateLayerProperty(layer.data.handle, id, property, value);
      }
    }
  }

  /**
   * Toggle layer visibility
   */
  public toggleLayerVisibility(id: string): void {
    const layer = this.getLayerById(id);
    if (!layer) return;
    
    if (isVolumeLayer(layer)) {
      useLayerStore.getState().updateLayer(id, { visible: !layer.visible });
    } else {
      // Surface visibility would be handled here
      console.log(`Toggle surface ${id} visibility`);
    }
  }

  /**
   * Remove a layer
   */
  public removeLayer(id: string): void {
    const layer = this.getLayerById(id);
    if (!layer) return;
    
    if (isVolumeLayer(layer)) {
      useLayerStore.getState().removeLayer(id);
    } else {
      useSurfaceStore.getState().removeSurface(id);
    }
  }

  /**
   * Create a volume-to-surface mapping
   * This coordinates between the two stores to establish a relationship
   */
  public async createVol2SurfMapping(
    volumeId: string, 
    surfaceId: string,
    mappingOptions?: {
      method?: 'nearest' | 'trilinear' | 'weighted';
      projectionDepth?: number;
      smoothingKernel?: number;
    }
  ): Promise<string | null> {
    // Get the volume and surface
    const volume = useLayerStore.getState().layers.find(l => l.id === volumeId);
    const surface = useSurfaceStore.getState().surfaces.get(surfaceId);
    
    if (!volume || !surface) {
      console.error('Volume or surface not found for vol2surf mapping');
      return null;
    }
    
    // Create a new surface layer that references the volume
    const vol2surfId = nanoid();
    const vol2surfName = `${surface.name} ← ${volume.name}`;
    
    // Clone the surface with volume reference
    const vol2surfSurface: LoadedSurface = {
      ...surface,
      handle: vol2surfId,
      name: vol2surfName,
      metadata: {
        ...surface.metadata,
        sourceVolumeId: volumeId,
        mappingOptions: mappingOptions || {
          method: 'nearest',
          projectionDepth: 0,
          smoothingKernel: 0
        }
      }
    };
    
    // Add the new vol2surf layer to surface store
    useSurfaceStore.getState().surfaces.set(vol2surfId, vol2surfSurface);
    
    // TODO: Trigger actual vol2surf computation
    // This would involve calling a worker or backend service
    // to map the volume data onto the surface vertices
    
    return vol2surfId;
  }

  /**
   * Get available volumes for vol2surf mapping
   */
  public getAvailableVolumesForMapping(): ManagedLayer[] {
    return this.getVolumeLayers().filter(layer => layer.visible);
  }

  /**
   * Get available surfaces for vol2surf mapping
   */
  public getAvailableSurfacesForMapping(): ManagedLayer[] {
    // Return surfaces that aren't already vol2surf mapped
    return this.getSurfaceLayers().filter(layer => !layer.sourceVolumeId);
  }

  /**
   * Update vol2surf mapping parameters
   */
  public updateVol2SurfMapping(
    vol2surfId: string,
    mappingOptions: {
      method?: 'nearest' | 'trilinear' | 'weighted';
      projectionDepth?: number;
      smoothingKernel?: number;
    }
  ): void {
    const surface = useSurfaceStore.getState().surfaces.get(vol2surfId);
    if (!surface || !surface.metadata?.sourceVolumeId) {
      console.warn(`Vol2surf layer ${vol2surfId} not found`);
      return;
    }
    
    // Update mapping options
    surface.metadata.mappingOptions = {
      ...surface.metadata.mappingOptions,
      ...mappingOptions
    };
    
    // TODO: Trigger recomputation of vol2surf mapping
  }
}

// Export singleton instance
export const unifiedLayerService = UnifiedLayerService.getInstance();