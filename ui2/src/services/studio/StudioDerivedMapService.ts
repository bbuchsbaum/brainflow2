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
 */

import { getApiService } from '@/services/apiService';
import { getTransport } from '@/services/transport';
import type { WorldBox } from '@/utils/worldFrame';
import { edgeBoxFromAffine } from '@/utils/worldFrame';
import { formatTauriError, tauriErrorCode } from '@/utils/formatTauriError';

export interface StudioDerivedMap {
  /** Backend layer id (its GPU lease); never a layer-store id. */
  layerId: string;
  volumeId: string;
  /** World box of the outer voxel edges. */
  bounds: WorldBox;
  dataRange: { min: number; max: number } | null;
}

interface Entry {
  holders: Set<Hold>;
  map: Promise<StudioDerivedMap | null>;
  disposeTimer: ReturnType<typeof setTimeout> | null;
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
  requestLayerGpuResources(layerId: string, volumeId: string, metadataOnly?: boolean): Promise<GpuInfo>;
  releaseLayerGpuResources(layerId: string): Promise<void>;
  unloadVolume(volumeId: string): Promise<void>;
}

/** Bridge code for "volume still has layer mappings" (volume_loading.rs). */
const VOLUME_IN_USE = 4048;

/** The GPU's volume texture slots are all taken (multi_texture_manager.rs). */
export function isGpuTextureSlotsFull(error: unknown): boolean {
  return /maximum texture limit \d+ reached/i.test(formatTauriError(error));
}

export class StudioDerivedMapService {
  private readonly entries = new Map<string, Entry>();
  /** Disposals in progress: a new acquire of the path waits for them. */
  private readonly disposing = new Map<string, Promise<void>>();
  private nextId = 1;

  private readonly backend: () => Backend;
  /** Frees GPU room before a map takes a texture slot (LRU layer eviction). */
  private readonly makeRoom: () => Promise<void>;

  constructor(
    backend: () => Backend = defaultBackend,
    makeRoom: () => Promise<void> = () => Promise.resolve(),
  ) {
    this.backend = backend;
    this.makeRoom = makeRoom;
  }

  /** Hold the map at `sourcePath`, loading it if needed. */
  acquire(sourcePath: string): StudioDerivedHold {
    const path = sourcePath.trim();
    if (!path) return { map: Promise.resolve(null), release: () => {} };
    let entry = this.entries.get(path);
    if (entry) {
      if (entry.disposeTimer) {
        clearTimeout(entry.disposeTimer);
        entry.disposeTimer = null;
      }
    } else {
      const pending = this.disposing.get(path);
      const map = (pending ? pending.catch(() => undefined) : Promise.resolve()).then(() =>
        this.load(path),
      );
      const created: Entry = { holders: new Set(), map, disposeTimer: null };
      this.entries.set(path, created);
      // A failed or empty load is not cached: the next acquire retries, and
      // its holders' releases no longer refer to it.
      const forget = () => {
        if (this.entries.get(path) === created) this.entries.delete(path);
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

  /** Holds on `sourcePath` (tests, diagnostics). */
  refCount(sourcePath: string): number {
    return this.entries.get(sourcePath.trim())?.holders.size ?? 0;
  }

  /**
   * Maps that hold, or are about to hold, a GPU texture slot: the layer
   * eviction policy counts them against the GPU budget (review W1).
   */
  liveCount(): number {
    return this.entries.size + this.disposing.size;
  }

  private async load(path: string): Promise<StudioDerivedMap | null> {
    const backend = this.backend();
    const handle = path.startsWith('template:')
      ? await backend.loadTemplate(path.slice('template:'.length))
      : await backend.loadFile(path);
    const layerId = `studio-derived-${this.nextId++}:${handle.id}`;
    let info: GpuInfo;
    try {
      // This map is already counted (liveCount): evict a hidden layer if the
      // budget is over.
      await this.makeRoom().catch(() => undefined);
      info = await backend.requestLayerGpuResources(layerId, handle.id, false);
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
  private async unload(map: Pick<StudioDerivedMap, 'layerId' | 'volumeId'>): Promise<void> {
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
    requestLayerGpuResources: (layerId, volumeId, metadataOnly) =>
      api.requestLayerGpuResources(layerId, volumeId, metadataOnly),
    releaseLayerGpuResources: (layerId) => api.releaseLayerGpuResources(layerId),
    unloadVolume: (volumeId) => api.unloadVolume(volumeId),
  };
}

let instance: StudioDerivedMapService | null = null;

export function getStudioDerivedMapService(): StudioDerivedMapService {
  if (!instance)
    instance = new StudioDerivedMapService(
      defaultBackend,
      () => import('@/services/LayerEvictionService').then((m) => m.layerEvictionService.makeRoomForUpload()),
    );
  return instance;
}
