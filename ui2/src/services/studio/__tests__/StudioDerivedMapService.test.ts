import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  StudioDerivedMapService,
  gpuTexturePressureMessage,
  isGpuTextureSlotsFull,
} from '../StudioDerivedMapService';
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

  it('classifies only budget-fit typed pressure as retryable and keeps oversized detail', () => {
    const budget = 512 * 1024 * 1024;
    const fit = { GpuBudgetExceeded: { code: 6008, requested_bytes: 32 * 1024 * 1024, used_bytes: budget, budget_bytes: budget } };
    const oversized = { GpuBudgetExceeded: { code: 6008, requested_bytes: budget + 1, used_bytes: 0, budget_bytes: budget } };
    expect(isGpuTextureSlotsFull(fit)).toBe(true);
    expect(isGpuTextureSlotsFull(oversized)).toBe(false);
    expect(gpuTexturePressureMessage(oversized)).toContain('GPU residency budget exceeded');
    expect(isGpuTextureSlotsFull({ Input: { code: 1885, details: 'Maximum layer count reached' } })).toBe(false);
  });

  // gpu-residency Phase 0: the template underlay reuses the workspace's own
  // resident layer of that template instead of a second texture slot.
  describe('template underlay borrowing', () => {
    function withWorkspaceTemplate() {
      const { backend, makeRoom, service } = setup();
      let resident: { layerId: string; volumeId: string } | null = {
        layerId: 'ws-mni',
        volumeId: 'vol-mni',
      };
      const full = Object.assign(backend, {
        loadTemplate: vi.fn(async () => ({ id: 'fresh-mni' })),
        findResidentLayer: vi.fn((path: string) =>
          path === 'template:MNI152NLin2009cAsym_T1w_1mm' && resident
            ? { ...resident, voxelToWorld: AFFINE, dimensions: [10, 10, 10], dataRange: { min: 0, max: 99 } }
            : null,
        ),
      });
      return { backend: full, makeRoom, service, drop: () => (resident = null) };
    }

    it('borrows the resident workspace layer: no load, no slot, pinned, never unloaded', async () => {
      const { backend, makeRoom, service } = withWorkspaceTemplate();
      const hold = service.acquire('template:MNI152NLin2009cAsym_T1w_1mm');
      const map = await hold.map;
      expect(map).toMatchObject({ layerId: 'ws-mni', volumeId: 'vol-mni', borrowed: true });
      expect(map?.dataRange).toEqual({ min: 0, max: 99 });
      expect(backend.loadTemplate).not.toHaveBeenCalled();
      expect(backend.requestLayerGpuResources).not.toHaveBeenCalled();
      expect(makeRoom).not.toHaveBeenCalled();
      expect(service.liveCount()).toBe(0);
      expect([...service.pinnedLayerIds()]).toEqual(['ws-mni']);
      hold.release();
      await vi.runAllTimersAsync();
      expect(backend.releaseLayerGpuResources).not.toHaveBeenCalled();
      expect(backend.unloadVolume).not.toHaveBeenCalled();
      expect(service.pinnedLayerIds().size).toBe(0);
    });

    it('loads its own copy once the borrowed layer is gone', async () => {
      const { backend, service, drop } = withWorkspaceTemplate();
      const first = service.acquire('template:MNI152NLin2009cAsym_T1w_1mm');
      expect((await first.map)?.borrowed).toBe(true);
      drop();
      const second = service.acquire('template:MNI152NLin2009cAsym_T1w_1mm');
      const map = await second.map;
      expect(map?.borrowed).toBeFalsy();
      expect(map?.volumeId).toBe('fresh-mni');
      expect(backend.loadTemplate).toHaveBeenCalledTimes(1);
      expect(service.liveCount()).toBe(1);
      first.release();
      second.release();
      await vi.runAllTimersAsync();
      expect(backend.unloadVolume).toHaveBeenCalledWith('fresh-mni');
      expect(backend.unloadVolume).not.toHaveBeenCalledWith('vol-mni');
    });

    it('never borrows for a file path', async () => {
      const { backend, service } = withWorkspaceTemplate();
      const map = await service.acquire('/c/mean.nii.gz').map;
      expect(map?.borrowed).toBeFalsy();
      expect(backend.findResidentLayer).not.toHaveBeenCalled();
    });
  });

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

  it('keeps a shared entry valid when one holder releases during the upload grace period', async () => {
    const { backend } = setup();
    let openRoom!: () => void;
    const makeRoom = vi.fn(() => new Promise<void>((resolve) => (openRoom = resolve)));
    const service = new StudioDerivedMapService(() => backend, makeRoom);
    const first = service.acquire('/c/shared.nii.gz');
    const second = service.acquire('/c/shared.nii.gz');
    await Promise.resolve();
    first.release();
    await vi.advanceTimersByTimeAsync(0);
    openRoom();
    await second.map;

    const options = backend.requestLayerGpuResources.mock.calls[0]?.[3] as
      | { isOperationValid?: () => boolean }
      | undefined;
    expect(options?.isOperationValid?.()).toBe(true);
    expect(service.refCount('/c/shared.nii.gz')).toBe(1);
  });

  it('marks the entry invalid only after final-holder disposal removes it', async () => {
    const { backend } = setup();
    const rawUpload = vi.fn(async () => ({ voxel_to_world: AFFINE, dim: [10, 10, 10] }));
    backend.requestLayerGpuResources.mockImplementation(
      (_layerId: string, _volumeId: string, _metadataOnly: boolean, options?: { isOperationValid?: () => boolean }) => {
        if (!options?.isOperationValid?.()) {
          const error = new Error('GPU upload operation is no longer valid');
          error.name = 'GpuUploadCancelledError';
          return Promise.reject(error);
        }
        return rawUpload();
      },
    );
    let openRoom!: () => void;
    const makeRoom = vi.fn(() => new Promise<void>((resolve) => (openRoom = resolve)));
    const service = new StudioDerivedMapService(() => backend, makeRoom);
    const hold = service.acquire('/c/disposed.nii.gz');
    await Promise.resolve();
    hold.release();
    await vi.advanceTimersByTimeAsync(0);
    openRoom();
    await hold.map.catch(() => undefined);

    const options = backend.requestLayerGpuResources.mock.calls[0]?.[3] as
      | { isOperationValid?: () => boolean }
      | undefined;
    expect(options?.isOperationValid?.()).toBe(false);
    expect(rawUpload).not.toHaveBeenCalled();
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

  it('reacquires a settled failed entry immediately, before disposal timers run', async () => {
    const { backend, service } = setup();
    backend.requestLayerGpuResources.mockRejectedValueOnce(new Error('budget refused'));
    const failed = service.acquire('/c/retry-now.nii.gz');
    await expect(failed.map).rejects.toThrow('budget refused');
    // No timer advancement: a retry must never inherit the settled rejection.
    const retry = service.acquire('/c/retry-now.nii.gz');
    await expect(retry.map).resolves.not.toBeNull();
    expect(backend.requestLayerGpuResources).toHaveBeenCalledTimes(2);
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
