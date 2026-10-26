import { describe, expect, it } from 'vitest';
import { frameToHistogramData } from '../histMark';

describe('frameToHistogramData flags', () => {
  it('carries zeros-excluded and integer-valued through a stashed histogram', () => {
    const histogram = { bins: [{ x0: 0, x1: 1, count: 3 }], totalCount: 3, minValue: 0, maxValue: 3, mean: 1, std: 0.5, binCount: 1, layerId: 'a' };
    const data = frameToHistogramData({
      columns: [],
      rows: [],
      meta: { histogram, zerosExcluded: true, integerValued: true },
    } as never);
    expect(data).toMatchObject({ zerosExcluded: true, integerValued: true, mean: 1 });
  });
});
