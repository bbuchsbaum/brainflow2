import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LayerGpuService } from '../LayerGpuService';

describe('LayerGpuService', () => {
  const invoke = vi.fn();
  const service = new LayerGpuService({ invoke } as never);
  beforeEach(() => invoke.mockReset());

  it('releases a lease with the layer id only', async () => {
    invoke.mockResolvedValueOnce({ success: true, freed: true });
    await service.releaseLayerGpuResources('a');
    expect(invoke.mock.calls).toEqual([['release_layer_gpu_resources', { layerId: 'a' }]]);
  });

  it('asks the backend once and passes its refusal through (the backend makes room)', async () => {
    const refusal = { GpuError: { code: 6024, details: 'Maximum texture limit 8 reached' } };
    invoke.mockRejectedValueOnce(refusal);
    await expect(service.requestLayerGpuResources('a', 'vol-a')).rejects.toBe(refusal);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('does not ask the backend for an upload whose operation is no longer valid', async () => {
    await expect(
      service.requestLayerGpuResources('a', 'vol-a', false, { isOperationValid: () => false }),
    ).rejects.toMatchObject({ name: 'GpuUploadCancelledError' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('asks whether a layer is resident with one check, no wait', async () => {
    invoke.mockResolvedValueOnce(true);
    await expect(service.isLayerGpuResident('a')).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith('wait_for_layer_ready', { layerId: 'a', timeoutMs: 0, pollIntervalMs: 5 });
  });

  it('maps cumulative texture-binding diagnostics from atlas stats', async () => {
    invoke.mockResolvedValueOnce({
      total_layers: 13,
      used_layers: 2,
      free_layers: 11,
      allocations: 2,
      releases: 0,
      high_watermark: 2,
      full_events: 0,
      is_3d: true,
      binding_frames: 3,
      binding_groups_created: 1,
      binding_cache_hits: 2,
    });

    await expect(service.getAtlasStats()).resolves.toMatchObject({
      bindingFrames: 3,
      bindingGroupsCreated: 1,
      bindingCacheHits: 2,
    });
  });

  it('maps byte-residency diagnostics without repurposing draw texture capacity', async () => {
    invoke.mockResolvedValueOnce({
      total_layers: 20, used_layers: 14, free_layers: 6, allocations: 14, releases: 0,
      high_watermark: 14, full_events: 0, is_3d: false,
      volume_texture_slots: 13,
      residency_mode: 'bytes', residency_budget_bytes: 512 * 1024 * 1024,
      resident_texture_bytes: 300 * 1024 * 1024, free_residency_bytes: 212 * 1024 * 1024,
      resident_texture_limit: 20, draw_texture_capacity: 13,
    });

    await expect(service.getAtlasStats()).resolves.toMatchObject({
      volumeTextureSlots: 13,
      residencyMode: 'bytes',
      residencyBudgetBytes: 512 * 1024 * 1024,
      residentTextureBytes: 300 * 1024 * 1024,
      residentTextureLimit: 20,
      drawTextureCapacity: 13,
    });
  });
});
