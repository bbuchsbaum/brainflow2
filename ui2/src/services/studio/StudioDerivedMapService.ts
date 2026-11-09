/**
 * StudioDerivedMapService - the materialized Compare maps (cohort mean,
 * residual, z-score) as GPU volumes that belong only to their panes.
 *
 * A derived map is not a workspace layer: it never enters the layer store or
 * a workspace ViewState, so it is absent from the Scene, legends, exports,
 * histograms and selection (QA wave 3 review M4). Its pane renders it through
 * StudioPaneRenderService with a ViewState of its own.
 *
 * Maps are shared by source path and held per pane: each acquire returns its
 * own hold, whose release is idempotent and inert once a failed load was
 * forgotten (review W3). The volume is unloaded only when nobody holds it,
 * one task after the last release, so a remount (StrictMode's double mount)
 * re-acquires the same map instead of racing its removal (review H1).
 *
 * A template underlay ("template:<id>") borrows the workspace's own layer of
 * that template when one is resident, instead of loading a second copy that
 * takes a second texture slot (gpu-residency plan, Phase 0). A borrowed layer
 * is pinned against eviction while a pane holds it, is not unloaded here,
 * and is not counted again against the GPU budget.
 */

import { getApiService } from '@/services/apiService';
import { getTransport } from '@/services/transport';
import { useLayerStore } from '@/stores/layerStore';
import type { WorldBox } from '@/utils/worldFrame';
import { edgeBoxFromAffine } from '@/utils/worldFrame';
import {
  formatTauriError,
  gpuBudgetExceeded,
  gpuBudgetExceededMessage,
  tauriErrorCode,
} from '@/utils/formatTauriError';

export interface StudioDerivedMap {
  /** Backend layer id (its GPU lease); never a layer-store id. */
  layerId: string;
  volumeId: string;
  /** World box of the outer voxel edges. */
  bounds: WorldBox;
  dataRange: { min: number; max: number } | null;
  /** A workspace layer's own lease, borrowed: never released or unloaded here. */
  borrowed?: boolean;
}

interface Entry {
  holders: Set<Hold>;
  map: Promise<StudioDerivedMap | null>;
  disposeTimer: ReturnType<typeof setTimeout> | null;
  /** Set once the load resolved to a borrowed workspace layer. */
  borrowedLayerId?: string;
  /** Set once the load resolved: what the panes draw (R5b demand). */
  loaded?: StudioDerivedMap;
}

/** A resident workspace layer the underlay can borrow (see {@link StudioDerivedMapService}). */
export interface BorrowableLayer {
  layerId: string;
  volumeId: string;
  voxelToWorld?: number[] | null;
  dimensions?: number[] | null;
  dataRange?: { min: number; max: number } | null;
}

interface Hold {
  entry: Entry;
  released: boolean;
}

/** One pane's hold on a derived map: `release` is idempotent. */
export interface StudioDerivedHold {
  map: Promise<StudioDerivedMap | null>;
  release(): void;
}

/** The GPU info fields a derived map uses (request_layer_gpu_resources). */
interface GpuInfo {
  voxel_to_world?: number[] | null;
  dim?: number[] | null;
  data_range?: { min: number; max: number } | null;
}

interface Backend {
  loadFile(path: string): Promise<{ id: string }>;
  /** A template anatomy ("template:<id>"), loaded as its own volume. */
  loadTemplate(templateId: string): Promise<{ id: string }>;
  requestLayerGpuResources(
    layerId: string,
    volumeId: string,
    metadataOnly?: boolean,
    options?: { isOperationValid?: () => boolean },
  ): Promise<GpuInfo>;
  releaseLayerGpuResources(layerId: string): Promise<void>;
  unloadVolume(volumeId: string): Promise<void>;
  /** The workspace's resident layer loaded from `sourcePath`, if any. */
  findResidentLayer?(sourcePath: string): BorrowableLayer | null;
}

/** Bridge code for "volume still has layer mappings" (volume_loading.rs). */
const VOLUME_IN_USE = 4048;

/** The GPU's volume texture slots are all taken (multi_texture_manager.rs). */
export function isGpuTextureSlotsFull(error: unknown): boolean {
  const budget = gpuBudgetExceeded(error);
  // A request larger than the whole budget cannot be helped by a later slot
  // release.  It remains a friendly budget refusal, but is not retryable.
  if (budget) return budget.requestedBytes <= budget.budgetBytes;
  return /maximum texture limit \d+ reached/i.test(formatTauriError(error));
}

/** Friendly pressure detail for Studio panes; null for unrelated failures. */
export function gpuTexturePressureMessage(error: unknown): string | null {
  const budget = gpuBudgetExceeded(error);
  if (budget) return gpuBudgetExceededMessage(budget);
  return isGpuTextureSlotsFull(error)
    ? 'GPU texture slots full: hide or remove a layer to show this map.'
    : null;
}

export class StudioDerivedMapService {
  private readonly entries = new Map<string, Entry>();
  /** Disposals in progress: a new acquire of the path waits for them. */
  private readonly disposing = new Map<string, Promise<void>>();
  private nextId = 1;
  /** Told when the held maps change (R5b residency demand). */
  private readonly listeners = new Set<() => void>();

  private readonly backend: () => Backend;

  constructor(backend: () => Backend = defaultBackend) {
    this.backend = backend;
  }

  /** Hold the map at `sourcePath`, loading it if needed. */
  acquire(sourcePath: string): StudioDerivedHold {
    const path = sourcePath.trim();
    if (!path) return { map: Promise.resolve(null), release: () => {} };
    let entry = this.entries.get(path);
    // A borrowed workspace layer that was removed (or lost its slot) since:
    // load the template afresh instead of handing out a dead layer.
    if (entry?.borrowedLayerId && !this.stillBorrowable(path, entry.borrowedLayerId)) {
      this.entries.delete(path);
      entry = undefined;
      this.changed();
    }
    if (entry) {
      if (entry.disposeTimer) {
        clearTimeout(entry.disposeTimer);
        entry.disposeTimer = null;
      }
    } else {
      const pending = this.disposing.get(path);
      const map = (pending ? pending.catch(() => undefined) : Promise.resolve()).then(() =>
        this.load(path, () => this.entries.get(path) === created),
      );
      const created: Entry = { holders: new Set(), map, disposeTimer: null };
      this.entries.set(path, created);
      map.then(
        (loaded) => {
          if (loaded?.borrowed) created.borrowedLayerId = loaded.layerId;
          if (loaded && this.entries.get(path) === created) {
            created.loaded = loaded;
            this.changed();
          }
        },
        () => undefined,
      );
      // A failed or empty load is not cached: the next acquire retries, and
      // its holders' releases no longer refer to it.
      const forget = () => {
        if (this.entries.get(path) === created) {
          this.entries.delete(path);
          this.changed();
        }
        created.holders.clear();
      };
      map.then((loaded) => loaded ?? forget(), forget);
      entry = created;
    }
    const hold: Hold = { entry, released: false };
    entry.holders.add(hold);
    return { map: entry.map, release: () => this.release(path, hold) };
  }

  /** Give up one hold; the map is unloaded once no pane holds it. */
  private release(path: string, hold: Hold): void {
    if (hold.released) return;
    hold.released = true;
    const { entry } = hold;
    if (!entry.holders.delete(hold)) return;
    if (entry.holders.size > 0 || entry.disposeTimer) return;
    entry.disposeTimer = setTimeout(() => {
      entry.disposeTimer = null;
      if (entry.holders.size > 0 || this.entries.get(path) !== entry) return;
      this.entries.delete(path);
      this.changed();
      const run = entry.map
        .then((map) => (map ? this.unload(map) : undefined))
        .catch((error) => {
          console.warn(`[StudioDerivedMapService] Could not unload ${path}:`, error);
        })
        .finally(() => {
          if (this.disposing.get(path) === run) this.disposing.delete(path);
        });
      this.disposing.set(path, run);
    }, 0);
  }

  /** The maps panes hold now, once loaded (borrowed underlays included). */
  heldMaps(): StudioDerivedMap[] {
    const maps: StudioDerivedMap[] = [];
    for (const entry of this.entries.values()) if (entry.loaded) maps.push(entry.loaded);
    return maps;
  }

  /** Be told when {@link heldMaps} or {@link pinnedLayerIds} may have changed. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private changed(): void {
    for (const listener of [...this.listeners]) listener();
  }

  /** Holds on `sourcePath` (tests, diagnostics). */
  refCount(sourcePath: string): number {
    return this.entries.get(sourcePath.trim())?.holders.size ?? 0;
  }

  /**
   * Maps that hold, or are about to hold, a GPU texture slot: the layer
   * eviction policy counts them against the GPU budget (review W1).
   */
  liveCount(): number {
    let borrowed = 0;
    for (const entry of this.entries.values()) if (entry.borrowedLayerId) borrowed += 1;
    return this.entries.size - borrowed + this.disposing.size;
  }

  /**
   * Workspace layers a pane holds as its underlay: the eviction policy must
   * not release them while the pane draws them.
   */
  pinnedLayerIds(): ReadonlySet<string> {
    const pinned = new Set<string>();
    for (const entry of this.entries.values()) {
      if (entry.borrowedLayerId) pinned.add(entry.borrowedLayerId);
    }
    return pinned;
  }

  private stillBorrowable(path: string, layerId: string): boolean {
    return this.backend().findResidentLayer?.(path)?.layerId === layerId;
  }

  /** The workspace's resident layer of this template, as a map; null when there is none. */
  private borrowTemplate(path: string): StudioDerivedMap | null {
    if (!path.startsWith('template:')) return null;
    const layer = this.backend().findResidentLayer?.(path);
    if (!layer) return null;
    const bounds = edgeBoxFromAffine(layer.voxelToWorld ?? undefined, layer.dimensions ?? undefined);
    if (!bounds) return null;
    return {
      layerId: layer.layerId,
      volumeId: layer.volumeId,
      bounds,
      dataRange: layer.dataRange ?? null,
      borrowed: true,
    };
  }

  private async load(path: string, isOperationValid: () => boolean): Promise<StudioDerivedMap | null> {
    const borrowed = this.borrowTemplate(path);
    if (borrowed) return borrowed;
    const backend = this.backend();
    const handle = path.startsWith('template:')
      ? await backend.loadTemplate(path.slice('template:'.length))
      : await backend.loadFile(path);
    const layerId = `studio-derived-${this.nextId++}:${handle.id}`;
    let info: GpuInfo;
    try {
      // The backend makes room (or refuses) under its own residency policy.
      info = await backend.requestLayerGpuResources(layerId, handle.id, false, { isOperationValid });
    } catch (error) {
      await this.unload({ layerId, volumeId: handle.id }).catch(() => undefined);
      throw error;
    }
    const bounds = edgeBoxFromAffine(info?.voxel_to_world, info?.dim);
    const map: StudioDerivedMap = {
      layerId,
      volumeId: handle.id,
      bounds: bounds ?? { min: [0, 0, 0], max: [0, 0, 0] },
      dataRange: info?.data_range ?? null,
    };
    if (!bounds) {
      await this.unload(map);
      return null;
    }
    return map;
  }

  /** Release the GPU lease, then the volume (which refuses while mapped). */
  private async unload(
    map: Pick<StudioDerivedMap, 'layerId' | 'volumeId'> & { borrowed?: boolean },
  ): Promise<void> {
    // A borrowed workspace layer belongs to its workspace.
    if (map.borrowed) return;
    const backend = this.backend();
    const releaseLease = () =>
      backend.releaseLayerGpuResources(map.layerId).catch((error) => {
        console.warn(`[StudioDerivedMapService] Could not release ${map.layerId}:`, error);
      });
    await releaseLease();
    try {
      await backend.unloadVolume(map.volumeId);
    } catch (error) {
      // A render racing the release can map the layer again: release once
      // more and retry, so the volume is not orphaned (review L1).
      if (tauriErrorCode(error) !== VOLUME_IN_USE) throw error;
      await releaseLease();
      await backend.unloadVolume(map.volumeId);
    }
  }
}

function defaultBackend(): Backend {
  const api = getApiService();
  return {
    loadFile: (path) => api.loadFile(path),
    // Each load registers a fresh volume handle, so unloading it never
    // touches a workspace layer of the same template.
    loadTemplate: async (templateId) => {
      const result = await getTransport().invoke<{ volume_handle_info: { id: string } }>(
        'load_template_by_id',
        { templateId },
      );
      return { id: result.volume_handle_info.id };
    },
    requestLayerGpuResources: (layerId, volumeId, metadataOnly, options) =>
      api.requestLayerGpuResources(layerId, volumeId, metadataOnly, options),
    releaseLayerGpuResources: (layerId) => api.releaseLayerGpuResources(layerId),
    unloadVolume: (volumeId) => api.unloadVolume(volumeId),
    findResidentLayer: (sourcePath) => {
      const { layers, layerMetadata } = useLayerStore.getState();
      for (const layer of layers) {
        if (layer.sourcePath !== sourcePath) continue;
        const meta = layerMetadata.get(layer.id);
        // Only a layer holding its own slot now, at the template's grid.
        if (!meta || meta.gpuResident === false || !meta.voxelToWorld || !meta.dimensions) continue;
        if (layer.volumeType === 'TimeSeries4D') continue;
        return {
          layerId: layer.id,
          volumeId: layer.volumeId,
          voxelToWorld: meta.voxelToWorld,
          dimensions: meta.dimensions,
          dataRange: meta.dataRange ?? null,
        };
      }
      return null;
    },
  };
}

let instance: StudioDerivedMapService | null = null;

export function getStudioDerivedMapService(): StudioDerivedMapService {
  if (!instance) instance = new StudioDerivedMapService(defaultBackend);
  return instance;
}
