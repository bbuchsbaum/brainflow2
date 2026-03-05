import type { BackendTransport } from '@/services/transport';
import { getTransport } from '@/services/transport';
import type { AtlasStats } from '@/types/atlas';

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
}

export class LayerGpuService {
  private transport: BackendTransport;

  constructor(transport: BackendTransport = getTransport()) {
    this.transport = transport;
  }

  async requestLayerGpuResources(layerId: string, volumeId: string, metadataOnly?: boolean): Promise<any> {
    console.log(`LayerGpuService: Requesting GPU resources for layer ${layerId}, volume ${volumeId}, metadataOnly: ${metadataOnly}`);
    const result = await this.transport.invoke('request_layer_gpu_resources', {
      layerSpec: {
        Volume: {
          id: layerId,
          source_resource_id: volumeId,
          colormap: 'gray'
        }
      },
      metadataOnly: metadataOnly || false
    });
    console.log('LayerGpuService: GPU resources response:', result);
    return result;
  }

  async releaseLayerGpuResources(layerId: string): Promise<void> {
    return this.transport.invoke('release_layer_gpu_resources', { layerId });
  }

  async waitForLayerReady(
    layerId: string,
    timeoutMs: number = 5000,
    pollIntervalMs: number = 25
  ): Promise<boolean> {
    return this.transport.invoke<boolean>('wait_for_layer_ready', {
      layerId,
      timeoutMs,
      pollIntervalMs,
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

  /**
   * @deprecated Use layer service instead
   */
  async removeRenderLayer(layerId: string): Promise<void> {
    await this.transport.invoke('remove_render_layer', { layerId });
  }

  async getAtlasStats(): Promise<AtlasStats> {
    const raw = await this.transport.invoke<RawAtlasStats>('get_atlas_stats');
    return this.mapAtlasStats(raw);
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
      lastReleaseMs: raw.last_release_ms
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
