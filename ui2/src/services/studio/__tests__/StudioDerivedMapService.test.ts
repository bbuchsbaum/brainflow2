import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioDerivedMapService, isGpuTextureSlotsFull } from '../StudioDerivedMapService';
import { GpuSlotsFullError } from '@/utils/formatTauriError';

const AFFINE = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, -10, -10, -10, 1];

function setup() {
  let volumes = 0;
  const backend = {
    loadFile: vi.fn(async () => ({ id: `vol-${++volumes}` })),
    requestLayerGpuResources: vi.fn(async () => ({
      voxel_to_world: AFFINE,
      dim: [10, 10, 10],
      data_range: { min: -2, max: 3 },
    })),
    releaseLayerGpuResources: vi.fn(async () => undefined),
    unloadVolume: vi.fn(async () => undefined),
  };
  const makeRoom = vi.fn(async () => undefined);
  return { backend, makeRoom, service: new StudioDerivedMapService(() => backend, makeRoom) };
}

describe('StudioDerivedMapService', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a StrictMode remount keeps the one map: acquire, release, acquire (H1)', async () => {
    const { backend, service } = setup();
    const first = service.acquire('/c/mean.nii.gz');
    first.release();
    const second = service.acquire('/c/mean.nii.gz');
    await vi.runAllTimersAsync();
    expect(await second.map).toBe(await first.map);
    expect(backend.loadFile).toHaveBeenCalledTimes(1);
    expect(backend.unloadVolume).not.toHaveBeenCalled();
    expect(service.refCount('/c/mean.nii.gz')).toBe(1);
  });

  it('holds are per holder: a repeated release drops only its own hold (W3)', async () => {
    const { backend, service } = setup();
    const a = service.acquire('/c/z.nii.gz');
    const b = service.acquire('/c/z.nii.gz');
    const map = await a.map;
    expect(await b.map).toBe(map);
    expect(map?.bounds).toEqual({ min: [-11, -11, -11], max: [9, 9, 9] });
    a.release();
    a.release();
    await vi.runAllTimersAsync();
    expect(service.refCount('/c/z.nii.gz')).toBe(1);
    expect(backend.unloadVolume).not.toHaveBeenCalled();
    b.release();
    await vi.runAllTimersAsync();
    expect(backend.releaseLayerGpuResources).toHaveBeenCalledWith(map!.layerId);
    expect(backend.unloadVolume).toHaveBeenCalledWith(map!.volumeId);
  });

  it('a release after a failed load was forgotten never drops a later holder (W3)', async () => {
    const { backend, service } = setup();
    backend.loadFile.mockRejectedValueOnce(new Error('unreadable'));
    const failed = service.acquire('/c/bad.nii.gz');
    await expect(failed.map).rejects.toThrow('unreadable');
    const retry = service.acquire('/c/bad.nii.gz');
    expect(await retry.map).not.toBeNull();
    failed.release();
    await vi.runAllTimersAsync();
    expect(service.refCount('/c/bad.nii.gz')).toBe(1);
    expect(backend.unloadVolume).not.toHaveBeenCalled();
    expect(backend.loadFile).toHaveBeenCalledTimes(2);
  });

  it('an acquire during a removal waits for it and loads a fresh map', async () => {
    const { backend, service } = setup();
    let finishUnload!: () => void;
    backend.unloadVolume.mockImplementationOnce(
      () => new Promise<undefined>((resolve) => (finishUnload = () => resolve(undefined))),
    );
    const old = service.acquire('/c/r.nii.gz');
    const oldMap = await old.map;
    old.release();
    await vi.advanceTimersByTimeAsync(0);
    const next = service.acquire('/c/r.nii.gz');
    await vi.advanceTimersByTimeAsync(0);
    expect(backend.loadFile).toHaveBeenCalledTimes(1);
    finishUnload();
    const fresh = await next.map;
    expect(backend.loadFile).toHaveBeenCalledTimes(2);
    expect(fresh?.volumeId).not.toBe(oldMap?.volumeId);
  });

  it('a release before the load settles unloads once it settles (no leak)', async () => {
    const { backend, service } = setup();
    let finishLoad!: () => void;
    backend.loadFile.mockImplementationOnce(
      () => new Promise((resolve) => (finishLoad = () => resolve({ id: 'vol-late' }))),
    );
    const hold = service.acquire('/c/late.nii.gz');
    hold.release();
    await vi.runAllTimersAsync();
    expect(backend.unloadVolume).not.toHaveBeenCalled();
    finishLoad();
    await vi.runAllTimersAsync();
    expect(backend.unloadVolume).toHaveBeenCalledWith('vol-late');
    expect(service.liveCount()).toBe(0);
  });

  it('counts live maps for the GPU budget and makes room before taking a slot (W1)', async () => {
    const { makeRoom, service } = setup();
    const hold = service.acquire('/c/m.nii.gz');
    expect(service.liveCount()).toBe(1);
    await hold.map;
    expect(makeRoom).toHaveBeenCalledTimes(1);
    hold.release();
    await vi.runAllTimersAsync();
    expect(service.liveCount()).toBe(0);
  });

  it('a GPU request failure releases the lease, then the volume (L3), and says the slots are full (W1)', async () => {
    const { backend, service } = setup();
    backend.requestLayerGpuResources.mockRejectedValueOnce({
      GpuError: { code: 5000, details: 'Maximum texture limit 13 reached' },
    });
    const hold = service.acquire('/c/full.nii.gz');
    const error = await hold.map.catch((e) => e);
    expect(isGpuTextureSlotsFull(error)).toBe(true);
    expect(isGpuTextureSlotsFull(new Error('unreadable'))).toBe(false);
    const [layerId] = backend.requestLayerGpuResources.mock.calls[0] as unknown as [string];
    expect(backend.releaseLayerGpuResources).toHaveBeenCalledWith(layerId);
    expect(backend.unloadVolume).toHaveBeenCalledWith('vol-1');
    expect(backend.releaseLayerGpuResources.mock.invocationCallOrder[0]).toBeLessThan(
      backend.unloadVolume.mock.invocationCallOrder[0],
    );
  });

  // N18 review: with no slot to free, the map is refused before the backend
  // is asked, like a layer's show; its volume is unloaded.
  it('refuses a map when no GPU slot can be freed, without asking the backend', async () => {
    const { backend, makeRoom, service } = setup();
    makeRoom.mockRejectedValueOnce(new GpuSlotsFullError(8));
    const error = await service.acquire('/c/full.nii.gz').map.catch((e) => e);
    expect(isGpuTextureSlotsFull(error)).toBe(true);
    expect(backend.requestLayerGpuResources).not.toHaveBeenCalled();
    expect(backend.unloadVolume).toHaveBeenCalledWith('vol-1');
  });

  it('still asks the backend when the eviction fails for another reason', async () => {
    const { backend, makeRoom, service } = setup();
    makeRoom.mockRejectedValueOnce(new Error('stats unavailable'));
    await expect(service.acquire('/c/m.nii.gz').map).resolves.not.toBeNull();
    expect(backend.requestLayerGpuResources).toHaveBeenCalledTimes(1);
  });

  it('retries a volume still mapped (4048) once, and survives an unload failure (L1)', async () => {
    const { backend, service } = setup();
    backend.unloadVolume.mockRejectedValueOnce({ Input: { code: 4048, details: 'mapped' } });
    const hold = service.acquire('/c/race.nii.gz');
    await hold.map;
    hold.release();
    await vi.runAllTimersAsync();
    expect(backend.releaseLayerGpuResources).toHaveBeenCalledTimes(2);
    expect(backend.unloadVolume).toHaveBeenCalledTimes(2);

    // A failure that is not 4048 is logged; the service stays usable.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    backend.unloadVolume.mockRejectedValueOnce(new Error('disk gone'));
    const again = service.acquire('/c/other.nii.gz');
    await again.map;
    again.release();
    await vi.runAllTimersAsync();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Could not unload'), expect.any(Error));
    expect(service.liveCount()).toBe(0);
    expect(await service.acquire('/c/other.nii.gz').map).not.toBeNull();
    warn.mockRestore();
  });
});
