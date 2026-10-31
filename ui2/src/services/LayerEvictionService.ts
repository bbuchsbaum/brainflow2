/**
 * LayerEvictionService - LRU eviction policy for GPU texture management
 *
 * When the number of loaded layers exceeds the GPU's volume texture slots
 * (the render loop's runtime texture capacity, from `get_atlas_stats`), this service
 * finds the least-recently-rendered invisible layer and releases its GPU
 * texture. The layer metadata (name, colormap, settings) is preserved so
 * it can be re-uploaded when it becomes visible again.
 */

import { useLayerStore } from '@/stores/layerStore';
import { getApiService } from './apiService';
import { useViewStateStore } from '@/stores/viewStateStore';
import { getEventBus } from '@/events/EventBus';
import { getStudioDerivedMapService } from '@/services/studio/StudioDerivedMapService';

/**
 * The budget used until the backend reports its real one (render loop not
 * started yet, or an older backend without `volume_texture_slots`).
 */
export const FALLBACK_GPU_TEXTURE_SLOTS = 16;

class LayerEvictionService {
  private static instance: LayerEvictionService;
  /** The backend's volume texture slots, once known. */
  private textureSlots: number | null = null;

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
      if (isVisible && meta && meta.gpuResident !== false) {
        setLayerMetadata(layer.id, { ...meta, evicted: false, lastRenderTime: now });
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
    if (meta && meta.gpuResident !== false) {
      setLayerMetadata(layerId, { ...meta, evicted: false, lastRenderTime: performance.now() });
    }
  }

  /**
   * The GPU's layer budget: the render loop's runtime texture capacity
   * (`resolve_runtime_capacity`, which depends on the adapter) or its render
   * state's layer cap, whichever is smaller; or
   * {@link FALLBACK_GPU_TEXTURE_SLOTS} until the backend has reported it.
   * A backend that answers without the field (built before 2026-10-31) is
   * remembered as the fallback, so it is not asked again.
   */
  async gpuTextureSlots(): Promise<number> {
    if (this.textureSlots !== null) return this.textureSlots;
    try {
      const stats = await getApiService().getAtlasStats();
      const positive = (n: unknown): n is number =>
        typeof n === 'number' && Number.isFinite(n) && n > 0;
      const slots = positive(stats?.volumeTextureSlots)
        ? stats.volumeTextureSlots
        : FALLBACK_GPU_TEXTURE_SLOTS;
      // The render state has its own layer cap (8; QA 2026-10-31 N2): the
      // budget is whichever runs out first.
      const layerCap = stats?.renderLayerCapacity;
      this.textureSlots = positive(layerCap) ? Math.min(slots, layerCap) : slots;
      return this.textureSlots;
    } catch {
      // Render loop not initialised yet: ask again next time.
    }
    return FALLBACK_GPU_TEXTURE_SLOTS;
  }

  /** The reported slot count, or null while it is not known. */
  knownGpuTextureSlots(): number | null {
    return this.textureSlots;
  }

  /** Test hook: forget the reported capacity. */
  resetGpuTextureSlotsForTests(): void {
    this.textureSlots = null;
  }

  /**
   * Free a texture slot BEFORE an upload: the render loop refuses an upload
   * once every slot is taken ("Maximum texture limit N reached",
   * multi_texture_manager.rs), so with `resident + derived >= slots` the
   * least-recently-rendered invisible layer is released first. Call it
   * before every GPU request that takes a slot (a new layer, a promoted
   * layer, a Set studio map). `uploadingLayerId` is never evicted.
   */
  async makeRoomForUpload(uploadingLayerId?: string): Promise<void> {
    const budget = await this.gpuTextureSlots();
    // Free slots one at a time until the upload fits or nothing can go
    // (bounded: each pass evicts a different layer).
    for (let pass = 0; pass < budget + 1; pass += 1) {
      const evicted = await this.evictOneIf((used) => used >= budget, uploadingLayerId);
      if (!evicted) return;
    }
  }

  /**
   * After an upload: evict the LRU invisible layer if the layers now exceed
   * the slots (a safety net; {@link makeRoomForUpload} keeps a slot free).
   */
  async checkAndEvict(): Promise<void> {
    const budget = await this.gpuTextureSlots();
    await this.evictOneIf((used) => used > budget);
  }

  /** Evict the LRU invisible resident layer when `over(slots in use)`. */
  private async evictOneIf(
    over: (slotsInUse: number) => boolean,
    keepLayerId?: string,
  ): Promise<boolean> {
    // Read the stores after any await: layers change while the backend answers.
    const { layers, layerMetadata, setLayerMetadata } = useLayerStore.getState();
    const shownSomewhere = layersShownInAnyWorkspace();

    // Count only layers that still hold live GPU resources.
    const activeGpuLayers = layers.filter((l) => layerMetadata.get(l.id)?.gpuResident !== false);

    // Set studio Compare maps take texture slots too, outside the layer
    // store (StudioDerivedMapService; QA wave 3 review W1).
    if (!over(activeGpuLayers.length + getStudioDerivedMapService().liveCount())) return false;

    // Candidates: GPU-resident layers hidden in every workspace. A layer shown
    // in a tab behind the front one (an Orthogonal tab while Set studio is in
    // front) stays: releasing it costs a visible re-upload on return.
    const candidates = activeGpuLayers.filter((layer) => {
      if (layer.id === keepLayerId) return false;
      const shown = shownSomewhere.get(layer.id);
      return !(shown ?? layer.visible);
    });
    // All GPU layers are visible: nothing can go.
    if (candidates.length === 0) return false;

    // Pick the least-recently-rendered candidate.
    const now = performance.now();
    let lruLayer = candidates[0];
    let lruTime = layerMetadata.get(lruLayer.id)?.lastRenderTime ?? 0;
    for (const candidate of candidates) {
      const t = layerMetadata.get(candidate.id)?.lastRenderTime ?? 0;
      if (t < lruTime) {
        lruTime = t;
        lruLayer = candidate;
      }
    }

    console.log(
      `[LayerEvictionService] Evicting layer "${lruLayer.name}" (${lruLayer.id}), ` +
        `last rendered ${lruTime > 0 ? `${((now - lruTime) / 1000).toFixed(1)}s ago` : 'never'}`,
    );

    // Release GPU resources but keep metadata.
    try {
      await getApiService().releaseLayerGpuResources(lruLayer.id);
    } catch (err) {
      console.warn(`[LayerEvictionService] Failed to release GPU resources for ${lruLayer.id}:`, err);
    }

    // Mark the layer as evicted in metadata (read fresh: the release awaited).
    const meta = useLayerStore.getState().layerMetadata.get(lruLayer.id);
    if (!meta) return false;
    setLayerMetadata(lruLayer.id, { ...meta, evicted: true, gpuResident: false });
    return true;
  }
}

/**
 * For each layer some workspace's view state lists: whether it is visible in
 * at least one of them (the active view state and every workspace's). A
 * layer no view state lists is absent from the map.
 */
function layersShownInAnyWorkspace(): Map<string, boolean> {
  const { viewState, workspaceViewStates } = useViewStateStore.getState();
  const shown = new Map<string, boolean>();
  const states = [viewState, ...(workspaceViewStates?.values() ?? [])];
  for (const state of states) {
    for (const viewLayer of state?.layers ?? []) {
      shown.set(viewLayer.id, Boolean(shown.get(viewLayer.id)) || Boolean(viewLayer.visible));
    }
  }
  return shown;
}

export const layerEvictionService = LayerEvictionService.getInstance();
