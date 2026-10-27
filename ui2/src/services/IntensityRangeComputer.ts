/**
 * IntensityRangeComputer — adaptive intensity windowing from histogram data.
 *
 * Replaces the hardcoded 20-80% heuristic with percentile-based ranges:
 *   • Anatomical / template  → P2-P98 (excludeZeros already handled by caller)
 *   • Symmetric statistical  → [-maxAbs, +maxAbs] from P2/P98
 *   • Label / atlas / binary → full data range
 */

import type { HistogramData, HistogramBin } from '@/types/histogram';
import type { StatisticInfo } from '@brainflow/api';

// ── Public types ────────────────────────────────────────────────

export interface IntensityRangeResult {
  intensity: [number, number];
  threshold: [number, number];
  method: 'percentile' | 'symmetric-percentile' | 'full-range' | 'fallback' | 'statistic';
  suggestedColormap?: string;
}

export interface IntensityRangeOptions {
  layerType: string;               // 'anatomical' | 'functional' | 'mask' | 'label'
  source?: string;                 // 'template' | 'atlas' | 'file' | 'other'
  isBinaryLike?: boolean;
  dataRange: { min: number; max: number };
}

// ── Percentile from histogram bins ──────────────────────────────

/**
 * Compute the value at `percentile` (0-100) from pre-binned histogram data.
 * Uses linear interpolation within the crossing bin.
 */
export function computePercentileFromBins(
  bins: HistogramBin[],
  totalCount: number,
  percentile: number,
): number {
  if (bins.length === 0 || totalCount <= 0) return 0;

  const target = totalCount * (percentile / 100);
  let cumulative = 0;

  for (const bin of bins) {
    const prev = cumulative;
    cumulative += bin.count;
    if (cumulative >= target && bin.count > 0) {
      const fraction = (target - prev) / bin.count;
      return bin.x0 + (bin.x1 - bin.x0) * fraction;
    }
  }

  // Exceeded all bins — return the upper edge of the last bin
  const last = bins[bins.length - 1];
  return last.x1;
}

// ── Symmetric detection ─────────────────────────────────────────

/**
 * Heuristic: volume looks like a statistical map (t/z-scores)
 * when data spans negative values and is roughly symmetric around zero.
 */
export function isSymmetricStatisticalMap(
  dataRange: { min: number; max: number },
  mean: number,
): boolean {
  const { min, max } = dataRange;
  const range = max - min;
  if (range <= 0 || min >= 0) return false;

  // Center of data range should be near zero
  const center = (min + max) / 2;
  if (Math.abs(center) > 0.15 * range) return false;

  // Mean should be near zero
  if (Math.abs(mean) > 0.1 * range) return false;

  return true;
}

// ── Main entry point ────────────────────────────────────────────

export function computeAdaptiveIntensityRange(
  histogram: HistogramData,
  options: IntensityRangeOptions,
): IntensityRangeResult {
  const { layerType, source, isBinaryLike, dataRange } = options;

  // Label / atlas / binary → full range, no windowing
  if (layerType === 'label' || source === 'atlas' || isBinaryLike) {
    return {
      intensity: [dataRange.min, dataRange.max],
      threshold: [0, 0],
      method: 'full-range',
    };
  }

  const { bins, totalCount, mean } = histogram;
  if (bins.length === 0 || totalCount <= 0) {
    return computeFallbackIntensityRange(options);
  }

  // Symmetric statistical map → symmetric range from percentiles
  if (isSymmetricStatisticalMap(dataRange, mean)) {
    const p2 = computePercentileFromBins(bins, totalCount, 2);
    const p98 = computePercentileFromBins(bins, totalCount, 98);
    const maxAbs = Math.max(Math.abs(p2), Math.abs(p98));

    // Guard against degenerate case
    if (maxAbs <= 0) return computeFallbackIntensityRange(options);

    return {
      intensity: [-maxAbs, maxAbs],
      threshold: [0, 0],
      method: 'symmetric-percentile',
      suggestedColormap: 'fmri',
    };
  }

  // Anatomical / generic → P2-P98
  const p2 = computePercentileFromBins(bins, totalCount, 2);
  const p98 = computePercentileFromBins(bins, totalCount, 98);

  // Guard: if percentiles collapsed, fall back
  if (p98 - p2 < Number.EPSILON) {
    return computeFallbackIntensityRange(options);
  }

  return {
    intensity: [p2, p98],
    threshold: [0, 0],
    method: 'percentile',
  };
}

// ── Fallback (preserves legacy 20-80% behaviour) ────────────────

export function computeFallbackIntensityRange(
  options: IntensityRangeOptions,
): IntensityRangeResult {
  const { layerType, source, isBinaryLike, dataRange } = options;
  const { min, max } = dataRange;

  if (layerType === 'label' || source === 'atlas' || isBinaryLike) {
    return { intensity: [min, max], threshold: [0, 0], method: 'full-range' };
  }

  const range = max - min;
  return {
    intensity: [min + range * 0.20, min + range * 0.80],
    threshold: [min + range / 2, min + range / 2],
    method: 'fallback',
  };
}

// ── Statistic maps (declared or inferred) ───────────────────────

/** |z| / |t| hidden at first paint (the cluster panel's default too). */
export const DEFAULT_STAT_THRESHOLD = 3.1;

const SYMMETRIC_KINDS = new Set(['z', 't', 'correlation']);
const ONE_SIDED_KINDS = new Set(['f', 'chi2', 'logp', 'log10p']);

/**
 * First-paint display of a statistic layer, from its finite data range
 * (max |v|: the robust end for a map whose voxels are mostly tiny noise,
 * where histogram percentiles gave ±0.03 and painted the whole volume;
 * native check, v6):
 * - z, t, r: a symmetric window ±max|v| (fmri colormap); z and t hide
 *   |v| ≤ 3.1, the conventional cut the cluster panel also defaults to;
 *   r hides nothing.
 * - F, χ², −log p: one-sided [0, max]; no default threshold. A meaningful
 *   cut depends on the degrees of freedom (F) or is already the scale (−log p),
 *   and a data quantile would be arbitrary, so the user sets it.
 * Null for other layers (anatomy keeps its own defaults) and when the range
 * is not finite (the histogram refinement handles that case).
 */
export function statisticDefaultRange(
  statistic: Pick<StatisticInfo, 'kind'> | null | undefined,
  dataRange: { min: number; max: number } | null | undefined,
): IntensityRangeResult | null {
  const kind = statistic?.kind;
  if (!kind || !dataRange) return null;
  const { min, max } = dataRange;
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (SYMMETRIC_KINDS.has(kind)) {
    const maxAbs = Math.max(Math.abs(min), Math.abs(max));
    if (!(maxAbs > 0)) return null;
    const cut = kind === 'correlation' ? 0 : DEFAULT_STAT_THRESHOLD;
    return {
      intensity: [-maxAbs, maxAbs],
      threshold: cut > 0 ? [-cut, cut] : [0, 0],
      method: 'statistic',
      suggestedColormap: 'fmri',
    };
  }
  if (ONE_SIDED_KINDS.has(kind)) {
    if (!(max > 0)) return null;
    return { intensity: [0, max], threshold: [0, 0], method: 'statistic', suggestedColormap: 'hot' };
  }
  return null;
}

/**
 * The same rule from a histogram (non-finite data range: NaN / Inf in the
 * file): the ends are the 0.1 / 99.9 percentiles of the finite nonzero
 * voxels.
 */
export function statisticDefaultRangeFromHistogram(
  statistic: Pick<StatisticInfo, 'kind'> | null | undefined,
  histogram: HistogramData,
): IntensityRangeResult | null {
  if (histogram.bins.length === 0 || histogram.totalCount <= 0) return null;
  const lo = computePercentileFromBins(histogram.bins, histogram.totalCount, 0.1);
  const hi = computePercentileFromBins(histogram.bins, histogram.totalCount, 99.9);
  return statisticDefaultRange(statistic, { min: lo, max: hi });
}
