import { describe, expect, it, vi } from 'vitest';
import { TemporalHeatmapService, type TemporalPlaneGrid } from '../TemporalHeatmapService';
import type { BackendTransport } from '../transport';

const GRID: TemporalPlaneGrid = {
  origin_mm: [1, 2, 3],
  u_mm: [2, 0, 0],
  v_mm: [0, 2, 0],
  width: 2,
  height: 2,
};

function setup(data: Array<number | null> = [1, null, 3, 4]) {
  const invoke = vi.fn().mockResolvedValue({ width: 2, height: 2, data });
  const service = new TemporalHeatmapService({ invoke } as unknown as BackendTransport);
  return { invoke, service };
}

describe('TemporalHeatmapService', () => {
  it('sends the plane in camelCase and restores NaN from JSON null', async () => {
    const { invoke, service } = setup();
    const map = await service.getPlaneMap('v', 'mean', GRID);
    expect(invoke).toHaveBeenCalledWith('plugin:api-bridge|compute_temporal_metric_plane', {
      volumeId: 'v',
      metric: 'mean',
      originMm: GRID.origin_mm,
      uMm: GRID.u_mm,
      vMm: GRID.v_mm,
      width: 2,
      height: 2,
    });
    expect(map.data[0]).toBe(1);
    expect(map.data[1]).toBeNaN();
  });

  it('caches by volume, metric, plane and grid', async () => {
    const { invoke, service } = setup();
    await service.getPlaneMap('v', 'mean', GRID);
    await service.getPlaneMap('v', 'mean', { ...GRID });
    expect(invoke).toHaveBeenCalledTimes(1);
    await service.getPlaneMap('w', 'mean', GRID);
    await service.getPlaneMap('v', 'variance', GRID);
    await service.getPlaneMap('v', 'mean', { ...GRID, origin_mm: [1, 2, 5] });
    await service.getPlaneMap('v', 'mean', { ...GRID, width: 4 });
    await service.getPlaneMap('v', 'mean', { ...GRID, u_mm: [0, 2, 0] });
    expect(invoke).toHaveBeenCalledTimes(6);
  });

  it('shares a request in flight, and a failure is not cached', async () => {
    const { invoke, service } = setup();
    invoke.mockRejectedValueOnce(new Error('nope'));
    const [a, b] = await Promise.allSettled([
      service.getPlaneMap('v', 'mean', GRID),
      service.getPlaneMap('v', 'mean', GRID),
    ]);
    expect(a.status).toBe('rejected');
    expect(b.status).toBe('rejected');
    expect(invoke).toHaveBeenCalledTimes(1);
    await service.getPlaneMap('v', 'mean', GRID);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('clears one volume only, even when ids share a prefix', async () => {
    const { invoke, service } = setup();
    await service.getPlaneMap('vol-1', 'mean', GRID);
    await service.getPlaneMap('vol-1-2', 'mean', GRID);
    service.clearVolume('vol-1');
    expect(service.peekPlaneMap('vol-1', 'mean', GRID)).toBeNull();
    expect(service.peekPlaneMap('vol-1-2', 'mean', GRID)).not.toBeNull();
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('a result arriving after the volume was released is not cached', async () => {
    const { invoke, service } = setup();
    let resolve!: (value: unknown) => void;
    invoke.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const request = service.getPlaneMap('v', 'mean', GRID);
    service.clearVolume('v');
    resolve({ width: 2, height: 2, data: [1, 2, 3, 4] });
    await request;
    expect(service.peekPlaneMap('v', 'mean', GRID)).toBeNull();
  });

  it('bounds the cache, oldest use first', async () => {
    const { service } = setup();
    const at = (z: number) => ({ ...GRID, origin_mm: [0, 0, z] as TemporalPlaneGrid['origin_mm'] });
    await service.getPlaneMap('v', 'mean', at(0));
    await service.getPlaneMap('v', 'mean', at(1));
    for (let z = 2; z < 64; z += 1) await service.getPlaneMap('v', 'mean', at(z));
    expect(service.peekPlaneMap('v', 'mean', at(0))).not.toBeNull(); // now the newest use
    await service.getPlaneMap('v', 'mean', at(64));
    expect(service.peekPlaneMap('v', 'mean', at(1))).toBeNull();
    expect(service.peekPlaneMap('v', 'mean', at(0))).not.toBeNull();
  });
});
