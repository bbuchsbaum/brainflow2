import { volumeDocumentRemovalReason } from '@/services/workspaceDocuments';
/**
 * LayerEvictionService - GPU texture residency policy.
 *
 * Two limits, kept apart (docs/plans/gpu-residency-2026-11.md):
 *
 * - The residency budget is the render loop's volume texture slots (13 on
 *   Metal), global to the app. Every resident texture counts: layers, Set
 *   studio maps, and cached 4D resident-ring members, which the UI cannot see
 *   and reads from the backend (`get_atlas_stats`).
 * - The draw cap (16) is per view: how many layers one frame draws. It is
 *   enforced when a layer is shown in a workspace ({@link drawLayerCap}), not
 *   against residency.
 *
 * When an upload needs a slot, room is made in this order:
 *   1. cached 4D ring members (`reclaim_cached_image_slots`);
 *   2. layers hidden in every workspace, least recently rendered first;
 *   3. layers visible only in workspaces behind the front one, LRU.
 * Never evicted: the front workspace's visible layers, layers a mounted Set
 * studio pane borrows, layers a retained module document protects (its
 * source images) and editable segmentation label layers. An evicted layer
 * keeps its metadata and is uploaded again when shown, or when its
 * workspace comes to the front ({@link ensureFrontWorkspaceResident}).
 */

import { useLayerStore } from '@/stores/layerStore';
import { getApiService } from './apiService';
import { useViewStateStore } from '@/stores/viewStateStore';
import { getEventBus } from '@/events/EventBus';
import { getStudioDerivedMapService } from '@/services/studio/StudioDerivedMapService';
import type { AtlasStats } from '@/types/atlas';

/**
 * The budget used until the backend reports its real one (render loop not
 * started yet, or an older backend without `volume_texture_slots`).
 */
export const FALLBACK_GPU_TEXTURE_SLOTS = 16;

/** Layers one frame draws, until the backend reports `render_layer_capacity`. */
export const FALLBACK_DRAW_LAYER_CAP = 16;

/** Layer kinds whose layers stay resident while their module owns them. */
const PINNED_LAYER_KINDS = new Set(['segmentation.editable-label']);

/** The backend's own slot counts (a backend from 2026-11-02 or later). */
interface BackendSlots {
  free: number;
  resident: number;
  cached: number;
}

const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
const count = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;

class LayerEvictionService {
  private static instance: LayerEvictionService;
  /** The backend's volume texture slots, once known. */
  private textureSlots: number | null = null;
  /** The backend's per-frame draw cap, once known. */
  private drawCap: number | null = null;
  /**
   * Whether the backend reports its free/resident/cached slot counts. Null
   * until the first answer; false for an older backend, which is then not
   * asked again.
   */
  private backendCounts: boolean | null = null;

  private constructor() {
    // Subscribe to render.complete events to update lastRenderTime per layer
    const eventBus = getEventBus();
    eventBus.on('render.complete', () => {
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
      const viewLayer = viewLayers.find((vl) => vl.id === layer.id);
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
   * The residency budget: the render loop's runtime texture capacity
   * (`resolve_runtime_capacity`, which depends on the adapter), or
   * {@link FALLBACK_GPU_TEXTURE_SLOTS} until the backend has reported it.
   * The draw cap is not part of it: it bounds one view, not residency.
   * A backend that answers without the field (built before 2026-10-31) is
   * remembered as the fallback, so it is not asked again.
   */
  async gpuTextureSlots(): Promise<number> {
    if (this.textureSlots !== null) return this.textureSlots;
    try {
      this.remember(await getApiService().getAtlasStats());
      return this.textureSlots ?? FALLBACK_GPU_TEXTURE_SLOTS;
    } catch {
      // Render loop not initialised yet: ask again next time.
    }
    return FALLBACK_GPU_TEXTURE_SLOTS;
  }

  /** Cache the fixed capacities from a stats answer. */
  private remember(stats: AtlasStats | null | undefined): void {
    if (this.textureSlots === null) {
      this.textureSlots = positive(stats?.volumeTextureSlots)
        ? stats.volumeTextureSlots
        : FALLBACK_GPU_TEXTURE_SLOTS;
    }
    if (this.drawCap === null) {
      this.drawCap = positive(stats?.renderLayerCapacity)
        ? stats.renderLayerCapacity
        : FALLBACK_DRAW_LAYER_CAP;
    }
    if (this.backendCounts === null) {
      this.backendCounts = count(stats?.freeTextureSlots) && count(stats?.residentTextureSlots);
    }
  }

  /** The reported slot count, or null while it is not known. */
  knownGpuTextureSlots(): number | null {
    return this.textureSlots;
  }

  /**
   * Layers one view draws at once (the backend's `render_layer_capacity`,
   * else {@link FALLBACK_DRAW_LAYER_CAP}). Synchronous: a show is checked
   * against it before any backend call.
   */
  drawLayerCap(): number {
    return this.drawCap ?? FALLBACK_DRAW_LAYER_CAP;
  }

  /** Test hook: forget the reported capacity. */
  resetGpuTextureSlotsForTests(): void {
    this.textureSlots = null;
    this.drawCap = null;
    this.backendCounts = null;
  }

  /** The backend's current slot counts, or null when it does not report them. */
  private async backendSlots(): Promise<BackendSlots | null> {
    // Only a backend that answered with its counts is asked (an older one,
    // or a render loop not up yet, leaves the UI's count alone).
    if (this.backendCounts !== true) return null;
    try {
      const stats = await getApiService().getAtlasStats();
      this.remember(stats);
      if (!count(stats?.freeTextureSlots) || !count(stats?.residentTextureSlots)) return null;
      return {
        free: stats.freeTextureSlots,
        resident: stats.residentTextureSlots,
        cached: count(stats.cachedImageSlots) ? stats.cachedImageSlots : 0,
      };
    } catch {
      return null;
    }
  }

  /**
   * Free a texture slot BEFORE an upload: the render loop refuses an upload
   * once every slot is taken ("Maximum texture limit N reached",
   * multi_texture_manager.rs). Call it before every GPU request that takes a
   * slot (a new layer, a promoted layer, a Set studio map).
   * `uploadingLayerId` is never evicted.
   *
   * Resolves whether a slot is free afterwards: false when every slot holds
   * something pinned (or the eviction service cannot release one), so the
   * caller can refuse instead of overfilling the GPU.
   *
   * - `reserve`: hold the slot for `uploadingLayerId` until
   *   {@link releaseReservation}, so uploads running at once (Show all) each
   *   count the others' slots (QA 2026-10-31 N18 review).
   * - `counted`: the upload is already in the count (a Set studio map is
   *   counted by `liveCount` from its acquire), so the budget may be met.
   *
   * Calls run one at a time: two never pick the same layer to evict.
   */
  makeRoomForUpload(
    uploadingLayerId?: string,
    options: { reserve?: boolean; counted?: boolean } = {},
  ): Promise<boolean> {
    const run = this.roomQueue.then(() => this.makeRoomNow(uploadingLayerId, options));
    this.roomQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private roomQueue: Promise<void> = Promise.resolve();
  /** Layers holding a slot for an upload still in flight. */
  private readonly reserved = new Set<string>();

  private async makeRoomNow(
    uploadingLayerId: string | undefined,
    options: { reserve?: boolean; counted?: boolean },
  ): Promise<boolean> {
    const budget = await this.gpuTextureSlots();
    const full = (used: number) => (options.counted ? used > budget : used >= budget);
    let backend = await this.backendSlots();
    // Free slots one at a time until the upload fits or nothing can go
    // (bounded: each pass reclaims cached members or evicts a different layer).
    for (let pass = 0; pass < budget + 1; pass += 1) {
      // The uploading layer counts while room is made (a layer the store
      // lists before its upload may already be counted), not in the answer.
      const used = this.slotsHeld(undefined, backend);
      if (!full(used)) break;
      if (backend && backend.cached > 0) {
        const need = used - budget + (options.counted ? 0 : 1);
        const reclaimed = await getApiService()
          .reclaimCachedImageSlots(Math.max(1, need))
          .then((result) => result.reclaimed)
          .catch(() => 0);
        backend = await this.backendSlots();
        if (reclaimed > 0) continue;
        // Nothing came back: do not ask for those members again this call.
        if (backend) backend = { ...backend, cached: 0 };
      }
      const evicted = await this.evictOne(uploadingLayerId);
      if (!evicted) break;
      backend = await this.backendSlots();
    }
    // Checked and reserved together, after the last await.
    const room = !full(this.slotsHeld(uploadingLayerId, backend));
    if (room && options.reserve && uploadingLayerId) this.reserved.add(uploadingLayerId);
    return room;
  }

  /**
   * Slots held, as far as both sides know: the UI's count plus the cached 4D
   * members it cannot see, or the backend's resident count plus uploads in
   * flight, whichever is larger.
   */
  private slotsHeld(exceptLayerId: string | undefined, backend: BackendSlots | null): number {
    const ui = this.slotsInUse(exceptLayerId);
    if (!backend) return ui;
    const { layerMetadata } = useLayerStore.getState();
    let pending = 0;
    for (const id of this.reserved) {
      if (id !== exceptLayerId && layerMetadata.get(id)?.gpuResident === false) pending += 1;
    }
    return Math.max(ui + backend.cached, backend.resident + pending);
  }

  /** The upload of `layerId` is over (resident now, or failed): its slot is no longer held. */
  releaseReservation(layerId: string): void {
    this.reserved.delete(layerId);
  }

  /**
   * GPU slots the UI knows are held: resident layers, reserved uploads and
   * Set studio maps (`exceptLayerId` is not counted, the layer about to take
   * one). Cached 4D ring members are not in it; {@link makeRoomForUpload}
   * adds them from the backend.
   */
  slotsInUse(exceptLayerId?: string): number {
    const { layers, layerMetadata } = useLayerStore.getState();
    const held = new Set<string>();
    for (const l of layers) {
      if (layerMetadata.get(l.id)?.gpuResident !== false) held.add(l.id);
    }
    for (const id of this.reserved) held.add(id);
    if (exceptLayerId) held.delete(exceptLayerId);
    return held.size + getStudioDerivedMapService().liveCount();
  }

  /** Test hook: forget reservations. */
  resetReservationsForTests(): void {
    this.reserved.clear();
    this.roomQueue = Promise.resolve();
  }

  /**
   * After an upload: evict when the slots held exceed the budget (a safety
   * net; {@link makeRoomForUpload} keeps a slot free).
   */
  async checkAndEvict(): Promise<void> {
    const budget = await this.gpuTextureSlots();
    if (this.slotsInUse() > budget) await this.evictOne();
  }

  /**
   * Evict one layer, in policy order: hidden in every workspace, then
   * visible only behind the front workspace; least recently rendered first
   * within each tier. Pinned layers are never chosen.
   */
  private async evictOne(keepLayerId?: string): Promise<boolean> {
    // Read the stores after any await: layers change while the backend answers.
    const { layers, layerMetadata, setLayerMetadata } = useLayerStore.getState();
    const visibility = layerVisibility();
    const pinnedByStudio = studioPinnedLayerIds();

    const hiddenEverywhere: typeof layers = [];
    const backgroundOnly: typeof layers = [];
    for (const layer of layers) {
      if (layerMetadata.get(layer.id)?.gpuResident === false) continue;
      if (layer.id === keepLayerId || pinnedByStudio.has(layer.id)) continue;
      if (volumeDocumentRemovalReason(layer.volumeId)) continue;
      if (layer.layerKind && PINNED_LAYER_KINDS.has(layer.layerKind)) continue;
      const seen = visibility.get(layer.id);
      // A layer no view state lists falls back to its own flag, as shown in front.
      const front = seen ? seen.front : layer.visible;
      const background = seen?.background ?? false;
      if (front) continue;
      if (background) backgroundOnly.push(layer);
      else hiddenEverywhere.push(layer);
    }
    const tier = hiddenEverywhere.length > 0 ? hiddenEverywhere : backgroundOnly;
    if (tier.length === 0) return false;

    // Pick the least-recently-rendered candidate.
    const now = performance.now();
    let lruLayer = tier[0];
    let lruTime = layerMetadata.get(lruLayer.id)?.lastRenderTime ?? 0;
    for (const candidate of tier) {
      const t = layerMetadata.get(candidate.id)?.lastRenderTime ?? 0;
      if (t < lruTime) {
        lruTime = t;
        lruLayer = candidate;
      }
    }

    console.log(
      `[LayerEvictionService] Evicting layer "${lruLayer.name}" (${lruLayer.id}), ` +
        `${tier === hiddenEverywhere ? 'hidden everywhere' : 'shown only behind the front tab'}, ` +
        `last rendered ${lruTime > 0 ? `${((now - lruTime) / 1000).toFixed(1)}s ago` : 'never'}`,
    );

    // Release GPU resources but keep metadata.
    try {
      await getApiService().releaseLayerGpuResources(lruLayer.id);
    } catch (err) {
      console.warn(
        `[LayerEvictionService] Failed to release GPU resources for ${lruLayer.id}:`,
        err,
      );
    }

    // Mark the layer as evicted in metadata (read fresh: the release awaited).
    const meta = useLayerStore.getState().layerMetadata.get(lruLayer.id);
    if (!meta) return false;
    setLayerMetadata(lruLayer.id, { ...meta, evicted: true, gpuResident: false });
    // A tab switch during the release can have brought the layer to the
    // front; frontWorkspaceResidency re-uploads it then (review 2).
    getEventBus().emit('layer.gpu.evicted', { layerId: lruLayer.id, reason: 'eviction' });
    return true;
  }

  /**
   * Visible layers of the front workspace that are not resident (evicted
   * while their tab was behind): the ones to upload again now it is in front.
   */
  evictedFrontLayers(): string[] {
    const { layers, layerMetadata } = useLayerStore.getState();
    const front = useViewStateStore.getState().viewState;
    const shown = new Set((front?.layers ?? []).filter((l) => l.visible).map((l) => l.id));
    return layers
      .filter((layer) => shown.has(layer.id) && layerMetadata.get(layer.id)?.gpuResident === false)
      .map((layer) => layer.id);
  }
}

/** For each listed layer: visible in the front workspace, and in any other. */
function layerVisibility(): Map<string, { front: boolean; background: boolean }> {
  const { viewState, workspaceViewStates, activeWorkspaceKey } = useViewStateStore.getState();
  const result = new Map<string, { front: boolean; background: boolean }>();
  const entry = (id: string) => {
    let value = result.get(id);
    if (!value) result.set(id, (value = { front: false, background: false }));
    return value;
  };
  for (const viewLayer of viewState?.layers ?? []) {
    entry(viewLayer.id).front ||= Boolean(viewLayer.visible);
  }
  for (const [key, state] of workspaceViewStates?.entries() ?? []) {
    if (state === viewState || key === activeWorkspaceKey) continue;
    for (const viewLayer of state?.layers ?? []) {
      entry(viewLayer.id).background ||= Boolean(viewLayer.visible);
    }
  }
  return result;
}

function studioPinnedLayerIds(): ReadonlySet<string> {
  const studio = getStudioDerivedMapService() as { pinnedLayerIds?: () => ReadonlySet<string> };
  return studio.pinnedLayerIds?.() ?? new Set();
}

export const layerEvictionService = LayerEvictionService.getInstance();
