/**
 * LayerEvictionService - LRU eviction policy for GPU texture management
 *
 * When the number of loaded layers exceeds MAX_GPU_LAYERS, this service
 * finds the least-recently-rendered invisible layer and releases its GPU
 * texture. The layer metadata (name, colormap, settings) is preserved so
 * it can be re-uploaded when it becomes visible again.
 */

import { useLayerStore } from '@/stores/layerStore';
import { getApiService } from './apiService';
import { useViewStateStore } from '@/stores/viewStateStore';
import { getEventBus } from '@/events/EventBus';

export const MAX_GPU_LAYERS = 16;

class LayerEvictionService {
  private static instance: LayerEvictionService;

  private constructor() {
    // Subscribe to render.complete events to update lastRenderTime per layer
    const eventBus = getEventBus();
    eventBus.on('render.complete', (event: any) => {
      // The render event carries volumeId or layerIds in metadata when available.
      // As a best-effort approach: update all currently visible layers' lastRenderTime.
      this.touchVisibleLayers();
    });
  }

  static getInstance(): LayerEvictionService {
    if (!LayerEvictionService.instance) {
      LayerEvictionService.instance = new LayerEvictionService();
    }
    return LayerEvictionService.instance;
  }

  /**
   * Update lastRenderTime for all currently visible (non-evicted) layers.
   * Called on every render.complete event.
   */
  private touchVisibleLayers(): void {
    const { layers, layerMetadata, setLayerMetadata } = useLayerStore.getState();
    const viewLayers = useViewStateStore.getState().viewState.layers;
    const now = performance.now();

    for (const layer of layers) {
      const viewLayer = viewLayers.find(vl => vl.id === layer.id);
      const isVisible = viewLayer?.visible ?? layer.visible;
      const meta = layerMetadata.get(layer.id);
      if (isVisible && meta && !meta.evicted) {
        setLayerMetadata(layer.id, { ...meta, lastRenderTime: now });
      }
    }
  }

  /**
   * Update lastRenderTime for a specific layer by ID.
   * Call this when a specific layer is known to have been rendered.
   */
  touchLayer(layerId: string): void {
    const { layerMetadata, setLayerMetadata } = useLayerStore.getState();
    const meta = layerMetadata.get(layerId);
    if (meta) {
      setLayerMetadata(layerId, { ...meta, lastRenderTime: performance.now() });
    }
  }

  /**
   * Check if eviction is needed and evict the LRU invisible layer if so.
   * Should be called after each new layer is added.
   */
  async checkAndEvict(): Promise<void> {
    const { layers, layerMetadata, setLayerMetadata } = useLayerStore.getState();
    const viewLayers = useViewStateStore.getState().viewState.layers;

    // Count only non-evicted layers (layers with actual GPU textures)
    const activeGpuLayers = layers.filter(l => {
      const meta = layerMetadata.get(l.id);
      return !meta?.evicted;
    });

    if (activeGpuLayers.length <= MAX_GPU_LAYERS) {
      return;
    }

    // Find candidates: invisible, non-evicted layers
    const candidates = activeGpuLayers.filter(layer => {
      const viewLayer = viewLayers.find(vl => vl.id === layer.id);
      const isVisible = viewLayer?.visible ?? layer.visible;
      return !isVisible;
    });

    if (candidates.length === 0) {
      // No invisible layers to evict — all GPU layers are visible, nothing we can do
      return;
    }

    // Pick the least-recently-rendered candidate
    const now = performance.now();
    let lruLayer = candidates[0];
    let lruTime = layerMetadata.get(lruLayer.id)?.lastRenderTime ?? 0;

    for (const candidate of candidates) {
      const meta = layerMetadata.get(candidate.id);
      const t = meta?.lastRenderTime ?? 0;
      if (t < lruTime) {
        lruTime = t;
        lruLayer = candidate;
      }
    }

    console.log(
      `[LayerEvictionService] Evicting layer "${lruLayer.name}" (${lruLayer.id}), ` +
      `last rendered ${lruTime > 0 ? `${((now - lruTime) / 1000).toFixed(1)}s ago` : 'never'}`
    );

    // Release GPU resources but keep metadata
    try {
      await getApiService().releaseLayerGpuResources(lruLayer.id);
    } catch (err) {
      console.warn(`[LayerEvictionService] Failed to release GPU resources for ${lruLayer.id}:`, err);
    }

    // Mark the layer as evicted in metadata
    const meta = layerMetadata.get(lruLayer.id);
    if (meta) {
      setLayerMetadata(lruLayer.id, { ...meta, evicted: true });
    }
  }
}

export const layerEvictionService = LayerEvictionService.getInstance();
