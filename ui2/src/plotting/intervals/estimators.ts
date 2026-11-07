/**
 * Pure per-cell interval estimators over finite values. Each returns null below
 * two values (no spread to estimate). The centre is supplied by the caller
 * (mean, median or an ROI reduction); dispersion is always about the mean.
 */
import { normalQuantile, sampleQuantile, tQuantile } from '@/utils/distributions';

import type { IntervalBounds } from './types';

/** Running mean (stable; equal weight per value). */
export const meanOf = (values: readonly number[]): number =>
  values.reduce((m, v, i) => m + (v - m) / (i + 1), 0);

/** Sample SD (n − 1) and SE = SD / √n; null below two values. */
export function spreadOf(values: readonly number[]): { sd: number; se: number } | null {
  const n = values.length;
  if (n < 2) return null;
  const mean = meanOf(values);
  const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
  return { sd, se: sd / Math.sqrt(n) };
}

const around = (centre: number, half: number, df?: number): IntervalBounds => ({
  lower: centre - half,
  upper: centre + half,
  ...(df === undefined ? {} : { df }),
});

export function sdInterval(values: readonly number[], centre: number): IntervalBounds | null {
  const s = spreadOf(values);
  return s ? around(centre, s.sd) : null;
}

export function seInterval(values: readonly number[], centre: number): IntervalBounds | null {
  const s = spreadOf(values);
  return s ? around(centre, s.se) : null;
}

export function normalInterval(
  values: readonly number[],
  centre: number,
  level: number,
): IntervalBounds | null {
  const s = spreadOf(values);
  return s ? around(centre, normalQuantile((1 + level) / 2) * s.se) : null;
}

export function tInterval(
  values: readonly number[],
  centre: number,
  level: number,
): IntervalBounds | null {
  const s = spreadOf(values);
  const df = values.length - 1;
  return s ? around(centre, tQuantile((1 + level) / 2, df) * s.se, df) : null;
}

/** Central `level` sample quantiles (type 7); independent of the centre. */
export function quantileInterval(
  values: readonly number[],
  _centre: number,
  level: number,
): IntervalBounds | null {
  if (values.length < 2) return null;
  return {
    lower: sampleQuantile(values, (1 - level) / 2),
    upper: sampleQuantile(values, (1 + level) / 2),
  };
}
