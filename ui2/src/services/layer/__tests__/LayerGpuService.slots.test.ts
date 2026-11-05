import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getEventBus } from '@/events/EventBus';
import { LayerGpuService } from '../LayerGpuService';

describe('LayerGpuService slot events', () => {
  const invoke = vi.fn();
  const service = new LayerGpuService({ invoke } as never);
  const freed = vi.fn();
  let off: () => void = () => {};
  beforeEach(() => {
    invoke.mockReset();
    freed.mockReset();
    off = getEventBus().on('gpu.slots.freed', freed);
  });
  afterEach(() => off());

  it('announces gpu.slots.freed only for a release that freed a slot', async () => {
    invoke.mockResolvedValueOnce({ success: true, freed: false, message: 'already released' });
    await service.releaseLayerGpuResources('a');
    expect(freed).not.toHaveBeenCalled();
    invoke.mockResolvedValueOnce({ success: true, freed: true, message: 'released' });
    await service.releaseLayerGpuResources('b');
    expect(freed).toHaveBeenCalledWith({ reason: 'release', layerId: 'b' });
  });

  it('passes forUpload only for an eviction made for an upload', async () => {
    invoke.mockResolvedValue({ success: true, freed: true });
    await service.releaseLayerGpuResources('a');
    await service.releaseLayerGpuResources('b', { forUpload: true });
    expect(invoke.mock.calls).toEqual([
      ['release_layer_gpu_resources', { layerId: 'a' }],
      ['release_layer_gpu_resources', { layerId: 'b', forUpload: true }],
    ]);
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

  it('does not replay a typed pressure upload after its owner becomes invalid', async () => {
    let valid = true;
    invoke.mockRejectedValueOnce({
      GpuBudgetExceeded: { code: 6008, requested_bytes: 1, used_bytes: 10, budget_bytes: 10 },
    });

    const pending = service.requestLayerGpuResources('stale', 'volume', false, {
      isOperationValid: () => valid,
    });
    // The first transport call has already reported pressure.  Invalidate
    // before its serialized recovery reaches the next raw upload.
    valid = false;

    await expect(pending).rejects.toMatchObject({ name: 'GpuUploadCancelledError' });
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
