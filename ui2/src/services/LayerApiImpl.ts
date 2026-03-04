/**
 * LayerApiImpl - Backend implementation of LayerApi
 * Connects LayerService to Tauri backend commands
 */

import type { LayerApi } from './LayerService';
import type { Layer, LayerRender } from '@/types/layers';
import { getApiService } from './apiService';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import type { ViewLayer } from '@/types/viewState';
import { VolumeHandleStore } from './VolumeHandleStore';
import type { LayerInfo } from '@/stores/layerStore';

export class LayerApiImpl implements LayerApi {
  private apiService = getApiService();

  private toViewLayer(layer: Layer): ViewLayer {
    const layerMetadata = useLayerStore.getState().getLayerMetadata(layer.id);
    const existing = useViewStateStore.getState().viewState.layers.find((item) => item.id === layer.id);
    if (existing) {
      return {
        ...existing,
        name: layer.name,
        volumeId: layer.volumeId,
        visible: layer.visible,
      };
    }

    const dataRange = layerMetadata?.dataRange;
    const defaultMin = dataRange?.min ?? 0;
    const defaultMax = dataRange?.max ?? 100;
    const metadataRenderProps = (layerMetadata as any)?.renderProps as LayerRender | undefined;
    const intensity: [number, number] = metadataRenderProps?.intensity ?? [defaultMin, defaultMax];
    const threshold: [number, number] = metadataRenderProps?.threshold ?? [defaultMin, defaultMin];

    return {
      id: layer.id,
      name: layer.name,
      volumeId: layer.volumeId,
      visible: layer.visible,
      opacity: metadataRenderProps?.opacity ?? (layer.visible ? 1.0 : 0.0),
      colormap: metadataRenderProps?.colormap ?? 'gray',
      intensity,
      threshold,
      blendMode: 'alpha',
      interpolation: metadataRenderProps?.interpolation ?? 'linear',
    };
  }

  private upsertViewLayer(layer: Layer): void {
    const nextLayer = this.toViewLayer(layer);
    useViewStateStore.getState().setViewState((state) => {
      const existingIndex = state.layers.findIndex((item) => item.id === nextLayer.id);
      if (existingIndex >= 0) {
        state.layers[existingIndex] = nextLayer;
        return;
      }
      state.layers.push(nextLayer);
    });
  }

  private removeViewLayer(id: string): void {
    useViewStateStore.getState().setViewState((state) => {
      state.layers = state.layers.filter((layer) => layer.id !== id);
    });
  }

  private setViewLayerVisibility(id: string, visible: boolean): void {
    useViewStateStore.getState().setViewState((state) => {
      const layer = state.layers.find((item) => item.id === id);
      if (!layer) {
        return;
      }
      layer.visible = visible;
      layer.opacity = visible ? 1.0 : 0.0;
    });
  }

  private reorderViewLayers(layerIds: string[]): void {
    useViewStateStore.getState().setViewState((state) => {
      const order = new Map(layerIds.map((id, index) => [id, index]));
      state.layers.sort((left, right) => {
        const leftIndex = order.get(left.id) ?? Number.MAX_SAFE_INTEGER;
        const rightIndex = order.get(right.id) ?? Number.MAX_SAFE_INTEGER;
        return leftIndex - rightIndex;
      });
    });
  }
  
  async addLayer(layer: Omit<Layer, 'id'>): Promise<Layer> {
    const addLayerStartTime = performance.now();
    console.log(`[LayerApiImpl ${addLayerStartTime.toFixed(0)}ms] addLayer called with:`, JSON.stringify(layer));
    
    // Use volumeId as layer id for now
    const newLayer: Layer = {
      ...layer,
      id: layer.volumeId
    };
    console.log(`[LayerApiImpl ${performance.now() - addLayerStartTime}ms] Created layer with id=${newLayer.id}`);
    
    // Request GPU resources for the layer FIRST
    // This uploads the volume to GPU and adds it to the render state
    console.log(`[LayerApiImpl ${performance.now() - addLayerStartTime}ms] Starting GPU resource allocation for layer ${newLayer.id}, volume ${newLayer.volumeId}`);
    const gpuStartTime = performance.now();
    
    // Declare renderProps outside try block so it's accessible throughout the function
    let renderProps: LayerRender | undefined;
    
    try {
      const gpuInfo = await this.apiService.requestLayerGpuResources(newLayer.id, newLayer.volumeId);
      const gpuElapsed = performance.now() - gpuStartTime;
      console.log(`[LayerApiImpl ${performance.now() - addLayerStartTime}ms] GPU resources allocated in ${gpuElapsed.toFixed(0)}ms:`, JSON.stringify(gpuInfo));
      
      // Store volume metadata before adding the layer so view-layer defaults
      // can be derived deterministically from metadata.
      
      if (gpuInfo.data_range) {
        console.log(`[LayerApiImpl ${performance.now() - addLayerStartTime}ms] Volume data range: [${gpuInfo.data_range.min}, ${gpuInfo.data_range.max}]`);
        
        // Create render properties with 20-80% of data range for better default contrast
        // Note: Render properties are now managed in ViewState, not layerStore
        const min = gpuInfo.data_range.min;
        const max = gpuInfo.data_range.max;
        const range = max - min;
        
        // Use 20-80% of the range for initial display
        const intensityMin = min + (range * 0.20);
        const intensityMax = min + (range * 0.80);
        
        renderProps = {
            opacity: 1.0,
            intensity: [intensityMin, intensityMax],
          threshold: [min + (range / 2), min + (range / 2)],  // Default to midpoint
          colormap: 'gray',
          interpolation: 'linear',
        };
        
        console.log(`[LayerApiImpl ${performance.now() - addLayerStartTime}ms] Created render properties:`, JSON.stringify(renderProps));
        
        // Get existing metadata to preserve worldBounds that was set earlier
        const existingMetadata = useLayerStore.getState().getLayerMetadata(newLayer.id) || {};
        
        // Merge with new metadata from GPU info
        const metadata = {
          ...existingMetadata,  // Preserve existing metadata like worldBounds
          dataRange: gpuInfo.data_range,
          centerWorld: gpuInfo.center_world,
          isBinaryLike: gpuInfo.is_binary_like,
          // Add new metadata fields
          dimensions: gpuInfo.dim,
          spacing: gpuInfo.spacing,
          origin: gpuInfo.origin,
          voxelToWorld: gpuInfo.voxel_to_world,
          worldToVoxel: gpuInfo.world_to_voxel,
          // Map texture format to readable string
          dataType: gpuInfo.tex_format,
          // Persist initial render properties in metadata for deterministic defaults.
          renderProps: renderProps,
          // TODO: Add file path and format when available from volume handle
        };
        console.log(`[LayerApiImpl ${performance.now() - addLayerStartTime}ms] Setting layer metadata:`, JSON.stringify(metadata));
        useLayerStore.getState().setLayerMetadata(newLayer.id, metadata);
        
        // Validate render properties were created
        if (!renderProps) {
          const error = `[LayerApiImpl] Failed to create render properties for layer: ${newLayer.id}`;
          console.error(error);
          throw new Error(error);
        }
        
        // Validate metadata was stored
        const storedMetadata = useLayerStore.getState().layerMetadata.get(newLayer.id);
        if (!storedMetadata) {
          const error = `[LayerApiImpl] Failed to store metadata for layer: ${newLayer.id}`;
          console.error(error);
          throw new Error(error);
        }
        
        console.log(`[LayerApiImpl] Successfully created render properties for layer ${newLayer.id}:`, {
          intensityRange: [renderProps.intensity[0], renderProps.intensity[1]],
          thresholdRange: [renderProps.threshold[0], renderProps.threshold[1]],
          opacity: renderProps.opacity
        });
      } else {
        console.warn(`[LayerApiImpl ${performance.now() - addLayerStartTime}ms] No data_range in GPU info!`);
      }
      
      // Add a small delay to ensure GPU resources are fully ready
      // This is a temporary fix - ideally the backend would signal when ready
      console.log(`[LayerApiImpl ${performance.now() - addLayerStartTime}ms] Waiting 100ms for GPU resources to settle...`);
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      const elapsed = performance.now() - addLayerStartTime;
      console.error(`[LayerApiImpl ${elapsed}ms] Failed to allocate GPU resources:`, error);
      throw error;
    }
    
    // Only add layer after GPU resources are ready and metadata is present.
    // Then project both stores directly from this API call.
    console.log(`[LayerApiImpl ${performance.now() - addLayerStartTime}ms] Adding layer to store with render properties`);
    
    const stateBefore = useLayerStore.getState().layers.length;
    const viewStateBefore = useViewStateStore.getState().viewState.layers.length;
    console.log(`[LayerApiImpl ${performance.now() - addLayerStartTime}ms] State before addLayer:`);
    console.log(`  - layerStore: ${stateBefore} layers`);
    console.log(`  - viewStateStore: ${viewStateBefore} layers`);
    
    // Add to layer store first.
    useLayerStore.getState().addLayer(newLayer);
    // Then project explicit view-layer state directly.
    this.upsertViewLayer(newLayer);
    
    const stateAfter = useLayerStore.getState().layers.length;
    const viewStateAfter = useViewStateStore.getState().viewState.layers.length;
    console.log(`[LayerApiImpl ${performance.now() - addLayerStartTime}ms] State after addLayer:`);
    console.log(`  - layerStore: ${stateAfter} layers (was ${stateBefore})`);
    console.log(`  - viewStateStore: ${viewStateAfter} layers (was ${viewStateBefore})`);
    
    console.log(`[LayerApiImpl ${performance.now() - addLayerStartTime}ms] Current layers in layerStore:`, 
      useLayerStore
        .getState()
        .layers.map((layer: LayerInfo) => ({ id: layer.id, name: layer.name, visible: layer.visible })));
    
    console.log(`[LayerApiImpl ${performance.now() - addLayerStartTime}ms] addLayer completed in ${(performance.now() - addLayerStartTime).toFixed(0)}ms`);
    return newLayer;
  }
  
  async removeLayer(id: string): Promise<void> {
    const layer = useLayerStore.getState().getLayer(id);
    const volumeId = layer?.volumeId ?? id;

    // Release GPU resources first
    await this.apiService.releaseLayerGpuResources(id);

    // Best-effort volume-registry cleanup for symmetric unload flow.
    try {
      await this.apiService.unloadVolume(volumeId);
    } catch (error) {
      console.warn(`[LayerApiImpl] unloadVolume failed for ${volumeId}:`, error);
    }

    VolumeHandleStore.clearVolumeHandle(volumeId);
    
    // Remove from both stores explicitly.
    useLayerStore.getState().removeLayer(id);
    this.removeViewLayer(id);
  }
  
  async updateLayer(id: string, updates: Partial<Layer>): Promise<Layer> {
    // For now, layer metadata is managed on frontend only
    // Backend only cares about render properties
    
    // If visibility changed, update opacity
    if ('visible' in updates) {
      await this.patchLayerRender(id, { 
        opacity: updates.visible ? 1.0 : 0.0 
      });
      this.setViewLayerVisibility(id, updates.visible ?? true);
    }
    
    // Return the updated layer (frontend manages the actual state)
    return { id, ...updates } as Layer;
  }
  
  async patchLayerRender(id: string, patch: Partial<LayerRender>): Promise<void> {
    // Map frontend render properties to backend format
    const backendPatch: Record<string, any> = {};
    
    if ('opacity' in patch) {
      backendPatch.opacity = patch.opacity;
    }
    
    if ('intensity' in patch) {
      // Use snake_case for Rust backend
      backendPatch.intensity_min = patch.intensity![0];
      backendPatch.intensity_max = patch.intensity![1];
    }
    
    if ('threshold' in patch) {
      // Use snake_case for Rust backend
      backendPatch.threshold_low = patch.threshold![0];
      backendPatch.threshold_high = patch.threshold![1];
    }
    
    if ('colormap' in patch) {
      // Map colormap names to backend IDs
      // Note: Some UI colormaps might not have exact backend equivalents
      const colormapIds: Record<string, number> = {
        'gray': 0,
        'hot': 1,
        'cool': 2,
        'jet': 3,          // Using red-yellow slot for jet
        'viridis': 4,      // Using blue-lightblue slot for viridis  
        'plasma': 5,       // Using red slot for plasma
        'inferno': 6,      // Using green slot for inferno
        'magma': 7,        // Using blue slot for magma
        'winter': 8,       // Using yellow slot for winter
        'summer': 9,       // Using cyan slot for summer
        'spring': 10,      // Using magenta slot for spring
        'autumn': 11,      // Using warm slot for autumn
        'cool-warm': 12,
        'spectral': 13,
        'turbo': 14
      };
      
      // Use snake_case for Rust backend
      backendPatch.colormap_id = colormapIds[patch.colormap!] || 0;
      console.log(`[LayerApiImpl] Mapping colormap '${patch.colormap}' to ID ${backendPatch.colormap_id}`);
    }
    
    // Guard against empty patches
    if (Object.keys(backendPatch).length === 0) {
      console.warn("[LayerApiImpl] Skipping empty patch for layer:", id);
      return;
    }
    
    // Log the patch being sent for debugging
    console.log("[LayerApiImpl] Sending patch to backend:", { id, backendPatch });
    
    // Send patch to backend
    await this.apiService.patchLayer(id, backendPatch);
  }
  
  async reorderLayers(layerIds: string[]): Promise<void> {
    // Backend doesn't currently support explicit ordering
    // This would need to be implemented in the render loop
    // For now, just log the intended order
    console.log('Layer order update requested:', layerIds);
    const layerById = new Map<string, LayerInfo>(
      useLayerStore.getState().layers.map((layer: LayerInfo) => [layer.id, layer])
    );
    const ordered: LayerInfo[] = layerIds
      .map((id, index) => {
        const layer = layerById.get(id);
        if (!layer) {
          return undefined;
        }
        return { ...layer, order: index };
      })
      .filter((layer): layer is LayerInfo => layer !== undefined);

    const covered = new Set(ordered.map((layer) => layer.id));
    const tail: LayerInfo[] = useLayerStore
      .getState()
      .layers.filter((layer: LayerInfo) => !covered.has(layer.id))
      .map((layer: LayerInfo, index: number) => ({ ...layer, order: ordered.length + index }));

    useLayerStore.getState().reorderLayers([...ordered, ...tail]);
    this.reorderViewLayers(layerIds);
  }
  
  async loadLayerData(id: string): Promise<void> {
    // Data is already loaded when volume is loaded
    // This could be used for lazy loading in the future
    console.log('Layer data request for:', id);
  }
}
