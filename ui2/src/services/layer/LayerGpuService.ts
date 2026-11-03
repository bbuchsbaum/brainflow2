import type { BackendTransport } from '@/services/transport';
import { getTransport } from '@/services/transport';
import type { AtlasStats, ReclaimCachedSlotsResult } from '@/types/atlas';
import { getEventBus } from '@/events/EventBus';

interface RawAtlasStats {
  total_layers: number;
  used_layers: number;
  free_layers: number;
  allocations: number;
  releases: number;
  high_watermark: number;
  full_events: number;
  is_3d: boolean;
  last_allocation_ms?: number;
  last_release_ms?: number;
  /** Absent from backends built before 2026-10-31. */
  volume_texture_slots?: number;
  render_layer_capacity?: number;
  /** Absent from backends built before 2026-11-02. */
  free_texture_slots?: number;
  resident_texture_slots?: number;
  cached_image_slots?: number;
}

export class LayerGpuService {
  private transport: BackendTransport;

  constructor(transport: BackendTransport = getTransport()) {
    this.transport = transport;
  }

  async requestLayerGpuResources(
    layerId: string,
    volumeId: string,
    metadataOnly?: boolean,
  ): Promise<any> {
    console.log(
      `LayerGpuService: Requesting GPU resources for layer ${layerId}, volume ${volumeId}, metadataOnly: ${metadataOnly}`,
    );
    const result = await this.transport.invoke('request_layer_gpu_resources', {
      layerSpec: {
        Volume: {
          id: layerId,
          source_resource_id: volumeId,
          colormap: 'gray',
        },
      },
      metadataOnly: metadataOnly || false,
    });
    console.log('LayerGpuService: GPU resources response:', result);
    return result;
  }

  /**
   * Release a layer's GPU lease. `forUpload`: the slot is freed for an upload
   * the caller requests next, so the backend does not let frames retry
   * starved layers into it before that upload completes.
   */
  async releaseLayerGpuResources(layerId: string, options: { forUpload?: boolean } = {}): Promise<void> {
    const result = await this.transport.invoke<{ success?: boolean; freed?: boolean } | null>(
      'release_layer_gpu_resources',
      options.forUpload ? { layerId, forUpload: true } : { layerId },
    );
    // Only a release that freed a slot: a failed load's cleanup (nothing
    // held) must not wake the panes that retry on this event.
    if (result?.freed === true) {
      getEventBus().emit('gpu.slots.freed', { reason: 'release', layerId });
    }
    return result as never;
  }

  async waitForLayerReady(
    layerId: string,
    timeoutMs: number = 5000,
    pollIntervalMs: number = 25,
  ): Promise<boolean> {
    return this.transport.invoke<boolean>('wait_for_layer_ready', {
      layerId,
      timeoutMs,
      pollIntervalMs,
    });
  }

  /**
   * Whether the backend holds GPU resources for `layerId` now (one check, no
   * wait). A frame can allocate a visible layer on demand, so after a tab
   * switch a layer the UI evicted may already be resident again.
   */
  async isLayerGpuResident(layerId: string): Promise<boolean> {
    return this.transport.invoke<boolean>('wait_for_layer_ready', {
      layerId,
      timeoutMs: 0,
      pollIntervalMs: 5,
    });
  }

  async patchLayer(layerId: string, patch: Record<string, any>): Promise<void> {
    return this.transport.invoke('patch_layer', { layerId, patch });
  }

  /**
   * @deprecated Use layer service instead
   */
  async addRenderLayer(layerId: string, volumeId: string): Promise<void> {
    await this.transport.invoke('add_render_layer', { layerId, volumeId });
  }

  async getAtlasStats(): Promise<AtlasStats> {
    const raw = await this.transport.invoke<RawAtlasStats>('get_atlas_stats');
    return this.mapAtlasStats(raw);
  }

  /**
   * Free up to `count` texture slots held by cached (not displayed) 4D
   * resident-ring members. The displayed member of every ring is kept.
   */
  async reclaimCachedImageSlots(count: number): Promise<ReclaimCachedSlotsResult> {
    const raw = await this.transport.invoke<{ reclaimed: number; free_texture_slots: number } | null>(
      'reclaim_cached_image_slots',
      { count },
    );
    const result = { reclaimed: raw?.reclaimed ?? 0, freeTextureSlots: raw?.free_texture_slots ?? 0 };
    if (result.reclaimed > 0) getEventBus().emit('gpu.slots.freed', { reason: 'reclaim' });
    return result;
  }

  private mapAtlasStats(raw: RawAtlasStats): AtlasStats {
    return {
      totalLayers: raw.total_layers,
      usedLayers: raw.used_layers,
      freeLayers: raw.free_layers,
      allocations: raw.allocations,
      releases: raw.releases,
      highWatermark: raw.high_watermark,
      fullEvents: raw.full_events,
      is3D: raw.is_3d,
      lastAllocationMs: raw.last_allocation_ms,
      lastReleaseMs: raw.last_release_ms,
      volumeTextureSlots: raw.volume_texture_slots,
      renderLayerCapacity: raw.render_layer_capacity,
      freeTextureSlots: raw.free_texture_slots,
      residentTextureSlots: raw.resident_texture_slots,
      cachedImageSlots: raw.cached_image_slots,
    };
  }
}

let instance: LayerGpuService | null = null;

export function getLayerGpuService(): LayerGpuService {
  if (!instance) {
    instance = new LayerGpuService();
  }
  return instance;
}

export function resetLayerGpuService(): void {
  instance = null;
}
