import { describe, it, expect } from 'vitest';
import {
  computePercentileFromBins,
  isSymmetricStatisticalMap,
  computeAdaptiveIntensityRange,
  computeFallbackIntensityRange,
} from '../IntensityRangeComputer';
import type { HistogramData, HistogramBin } from '@/types/histogram';

// ── Helpers ─────────────────────────────────────────────────────

/** Create uniform histogram bins from min to max with equal counts. */
function makeUniformHistogram(
  min: number,
  max: number,
  binCount: number,
  totalCount: number,
): HistogramData {
  const binWidth = (max - min) / binCount;
  const countPerBin = totalCount / binCount;
  const bins: HistogramBin[] = Array.from({ length: binCount }, (_, i) => ({
    x0: min + i * binWidth,
    x1: min + (i + 1) * binWidth,
    count: countPerBin,
    normalizedCount: 1,
    percentage: 100 / binCount,
  }));
  return {
    bins,
    totalCount,
    minValue: min,
    maxValue: max,
    mean: (min + max) / 2,
    std: (max - min) / Math.sqrt(12),
    binCount,
    layerId: 'test',
  };
}

/** Create a histogram with all counts in a single bin (constant-value volume). */
function makeConstantHistogram(value: number, count: number): HistogramData {
  return {
    bins: [{ x0: value, x1: value, count, normalizedCount: 1, percentage: 100 }],
    totalCount: count,
    minValue: value,
    maxValue: value,
    mean: value,
    std: 0,
    binCount: 1,
    layerId: 'test',
  };
}

// ── Tests ───────────────────────────────────────────────────────

describe('computePercentileFromBins', () => {
  it('returns correct percentiles for uniform distribution', () => {
    const hist = makeUniformHistogram(0, 100, 100, 10000);
    expect(computePercentileFromBins(hist.bins, hist.totalCount, 0)).toBeCloseTo(0, 0);
    expect(computePercentileFromBins(hist.bins, hist.totalCount, 50)).toBeCloseTo(50, 0);
    expect(computePercentileFromBins(hist.bins, hist.totalCount, 100)).toBeCloseTo(100, 0);
    expect(computePercentileFromBins(hist.bins, hist.totalCount, 2)).toBeCloseTo(2, 0);
    expect(computePercentileFromBins(hist.bins, hist.totalCount, 98)).toBeCloseTo(98, 0);
  });

  it('returns 0 for empty bins', () => {
    expect(computePercentileFromBins([], 0, 50)).toBe(0);
  });

  it('handles single-bin histogram', () => {
    const hist = makeConstantHistogram(42, 1000);
    expect(computePercentileFromBins(hist.bins, hist.totalCount, 50)).toBe(42);
  });
});

describe('isSymmetricStatisticalMap', () => {
  it('detects a symmetric t-map', () => {
    expect(isSymmetricStatisticalMap({ min: -5, max: 5 }, 0.01)).toBe(true);
  });

  it('detects approximate symmetry', () => {
    expect(isSymmetricStatisticalMap({ min: -4.8, max: 5.2 }, 0.05)).toBe(true);
  });

  it('rejects positive-only anatomical data', () => {
    expect(isSymmetricStatisticalMap({ min: 0, max: 10000 }, 5000)).toBe(false);
  });

  it('rejects highly asymmetric data', () => {
    expect(isSymmetricStatisticalMap({ min: -100, max: 5 }, -20)).toBe(false);
  });

  it('rejects zero-range data', () => {
    expect(isSymmetricStatisticalMap({ min: 0, max: 0 }, 0)).toBe(false);
  });
});

describe('computeAdaptiveIntensityRange', () => {
  it('returns P2-P98 for anatomical volume', () => {
    const hist = makeUniformHistogram(0, 1000, 256, 100000);
    const result = computeAdaptiveIntensityRange(hist, {
      layerType: 'anatomical',
      dataRange: { min: 0, max: 1000 },
    });
    expect(result.method).toBe('percentile');
    expect(result.intensity[0]).toBeCloseTo(20, -1);   // ~P2 of [0,1000]
    expect(result.intensity[1]).toBeCloseTo(980, -1);   // ~P98 of [0,1000]
  });

  it('returns symmetric range for statistical map', () => {
    const hist = makeUniformHistogram(-5, 5, 256, 100000);
    const result = computeAdaptiveIntensityRange(hist, {
      layerType: 'functional',
      dataRange: { min: -5, max: 5 },
    });
    expect(result.method).toBe('symmetric-percentile');
    expect(result.intensity[0]).toBeCloseTo(-result.intensity[1], 1);
    expect(result.intensity[1]).toBeGreaterThan(0);
    expect(result.suggestedColormap).toBe('fmri');
  });

  it('does not suggest colormap for anatomical volumes', () => {
    const hist = makeUniformHistogram(0, 1000, 256, 100000);
    const result = computeAdaptiveIntensityRange(hist, {
      layerType: 'anatomical',
      dataRange: { min: 0, max: 1000 },
    });
    expect(result.suggestedColormap).toBeUndefined();
  });

  it('returns full range for label layers', () => {
    const hist = makeUniformHistogram(0, 100, 256, 100000);
    const result = computeAdaptiveIntensityRange(hist, {
      layerType: 'label',
      dataRange: { min: 0, max: 100 },
    });
    expect(result.method).toBe('full-range');
    expect(result.intensity).toEqual([0, 100]);
  });

  it('returns full range for atlas source', () => {
    const hist = makeUniformHistogram(0, 100, 256, 100000);
    const result = computeAdaptiveIntensityRange(hist, {
      layerType: 'anatomical',
      source: 'atlas',
      dataRange: { min: 0, max: 100 },
    });
    expect(result.method).toBe('full-range');
  });

  it('returns full range for binary-like volumes', () => {
    const hist = makeUniformHistogram(0, 1, 256, 100000);
    const result = computeAdaptiveIntensityRange(hist, {
      layerType: 'mask',
      isBinaryLike: true,
      dataRange: { min: 0, max: 1 },
    });
    expect(result.method).toBe('full-range');
  });

  it('falls back when histogram is empty', () => {
    const emptyHist: HistogramData = {
      bins: [],
      totalCount: 0,
      minValue: 0,
      maxValue: 0,
      mean: 0,
      std: 0,
      binCount: 0,
      layerId: 'test',
    };
    const result = computeAdaptiveIntensityRange(emptyHist, {
      layerType: 'anatomical',
      dataRange: { min: 0, max: 1000 },
    });
    expect(result.method).toBe('fallback');
  });
});

describe('computeFallbackIntensityRange', () => {
  it('returns 20-80% for generic volumes', () => {
    const result = computeFallbackIntensityRange({
      layerType: 'anatomical',
      dataRange: { min: 0, max: 1000 },
    });
    expect(result.method).toBe('fallback');
    expect(result.intensity).toEqual([200, 800]);
    expect(result.threshold).toEqual([500, 500]);
  });

  it('returns full range for labels', () => {
    const result = computeFallbackIntensityRange({
      layerType: 'label',
      dataRange: { min: 0, max: 100 },
    });
    expect(result.method).toBe('full-range');
    expect(result.intensity).toEqual([0, 100]);
  });
});


import { statisticDefaultRange, statisticDefaultRangeFromHistogram } from '../IntensityRangeComputer';

describe('statisticDefaultRange (native v6: statistic first paint)', () => {
  it('z / t: symmetric ±max|v|, |v| ≤ 3.1 hidden, fmri', () => {
    expect(statisticDefaultRange({ kind: 'z' }, { min: -5, max: 6 })).toMatchObject({
      intensity: [-6, 6],
      threshold: [-3.1, 3.1],
      suggestedColormap: 'fmri',
    });
    expect(statisticDefaultRange({ kind: 't' }, { min: -7.5, max: 4 })?.intensity).toEqual([-7.5, 7.5]);
  });
  it('r: symmetric, nothing hidden; F / −log p: one-sided, no default cut', () => {
    expect(statisticDefaultRange({ kind: 'correlation' }, { min: -0.6, max: 0.8 })?.threshold).toEqual([0, 0]);
    expect(statisticDefaultRange({ kind: 'f' }, { min: 0, max: 40 })).toMatchObject({ intensity: [0, 40], threshold: [0, 0] });
  });
  it('anatomy, unknown kinds and non-finite ranges: no statistic default', () => {
    expect(statisticDefaultRange(undefined, { min: 0, max: 900 })).toBeNull();
    expect(statisticDefaultRange({ kind: 'estimate' }, { min: -2, max: 2 })).toBeNull();
    expect(statisticDefaultRange({ kind: 'z' }, { min: -Infinity, max: 6 })).toBeNull();
  });
  it('from a histogram (NaN / Inf in the file): the 0.1 / 99.9 percentile ends', () => {
    const bins = Array.from({ length: 100 }, (_, i) => ({ x0: -5 + i * 0.1, x1: -5 + (i + 1) * 0.1, count: 10 }));
    const r = statisticDefaultRangeFromHistogram({ kind: 'z' }, { bins, totalCount: 1000, mean: 0 } as never);
    expect(r?.intensity[1]).toBeGreaterThan(4.9);
    expect(r?.threshold).toEqual([-3.1, 3.1]);
  });
});
