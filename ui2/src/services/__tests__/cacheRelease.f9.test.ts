import { beforeEach, describe, expect, it, vi } from 'vitest';

/** QA 2026-10-30 F9: caches keyed by fresh ids must empty when their layer or volume goes. */

const { invokeMock, transportInvoke } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  transportInvoke: vi.fn(),
}));

vi.mock('@/services/transport', () => ({
  getTransport: () => ({ invoke: transportInvoke }),
  invokeBackend: invokeMock,
}));

import { getEventBus } from '@/events/EventBus';
import { histogramService } from '@/services/HistogramService';
import { clearNonzeroBbox, getNonzeroBbox, nonzeroBboxCacheSize } from '@/services/mosaic/brainBounds';
import { getTemporalHeatmapService } from '@/services/TemporalHeatmapService';
import { releaseVolumeCaches } from '@/services/volumeCacheRelease';

const histogramResponse = {
  bins: [{ x0: 0, x1: 1, count: 3 }],
  total_count: 3,
  min_value: 0,
  max_value: 1,
  mean: 0.5,
  std: 0.1,
  bin_count: 1,
};

describe('histogram cache release', () => {
  beforeEach(() => {
    histogramService.clearCache();
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(histogramResponse);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('layer.removed drops every histogram of the layer, and only its own', async () => {
    await histogramService.computeHistogram({ layerId: 'volume_1', binCount: 256 });
    await histogramService.computeHistogram({ layerId: 'volume_1', binCount: 64, excludeZeros: true });
    await histogramService.computeHistogram({ layerId: 'volume_10', binCount: 256 });
    expect(histogramService.cacheSize()).toBe(3);

    getEventBus().emit('layer.removed', { layerId: 'volume_1' });
    expect(histogramService.cacheSize()).toBe(1);

    getEventBus().emit('layer.removed', { layerId: 'volume_10' });
    expect(histogramService.cacheSize()).toBe(0);
  });

  it('a histogram in flight when its layer is removed is not cached afterwards', async () => {
    let resolve!: (v: typeof histogramResponse) => void;
    invokeMock.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const pending = histogramService.computeHistogram({ layerId: 'volume_7', binCount: 256 });
    expect(histogramService.cacheSize()).toBe(1);
    getEventBus().emit('layer.removed', { layerId: 'volume_7' });
    expect(histogramService.cacheSize()).toBe(0);
    resolve(histogramResponse);
    await expect(pending).resolves.toMatchObject({ totalCount: 3 });
    expect(histogramService.cacheSize()).toBe(0);
  });

  it('20 load/remove cycles leave nothing cached', async () => {
    for (let i = 0; i < 20; i += 1) {
      for (const n of [1, 2, 3, 4]) {
        await histogramService.computeHistogram({ layerId: `cycle${i}_${n}`, binCount: 256 });
      }
      for (const n of [1, 2, 3, 4]) getEventBus().emit('layer.removed', { layerId: `cycle${i}_${n}` });
    }
    expect(histogramService.cacheSize()).toBe(0);
  });
});

describe('volume cache release on unload', () => {
  beforeEach(() => {
    clearNonzeroBbox();
    getTemporalHeatmapService().clearAll();
    transportInvoke.mockReset();
  });

  it('drops the brain box at every threshold, and the temporal maps', async () => {
    transportInvoke.mockImplementation(async (command: string) =>
      command === 'volume_nonzero_bbox'
        ? { worldMinMm: [0, 0, 0], worldMaxMm: [1, 1, 1] }
        : { width: 2, height: 2, data: [1, 2, 3, 4] },
    );
    await getNonzeroBbox('vol_a');
    await getNonzeroBbox('vol_a', 2.3);
    await getNonzeroBbox('vol_ab');
    const heat = getTemporalHeatmapService();
    await heat.getMetricMap('vol_a', 'std' as never, 'axial' as never, 3);
    expect(nonzeroBboxCacheSize()).toBe(3);

    releaseVolumeCaches('vol_a');
    expect(nonzeroBboxCacheSize()).toBe(1);
    transportInvoke.mockClear();
    await heat.getMetricMap('vol_a', 'std' as never, 'axial' as never, 3);
    expect(transportInvoke).toHaveBeenCalledTimes(1);
  });
});
