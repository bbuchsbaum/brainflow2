/**
 * Frame transforms + statistical helpers for the encoder (step 4).
 *
 * - `applyTransforms` rewrites a frame before encoding (currently `normalize`:
 *   z-score / percent-change of a quantitative column in place).
 * - `boxStats` / `linearFit` are pure stat helpers the `box` mark and the
 *   scatter `lmFit` overlay consume; kept here (not in the renderers) so they
 *   are unit-tested independently of any DOM.
 *
 * All pure: no React, no I/O.
 */

import { numericColumn } from "./frame";
import type { FrameRow, SampleFrame, Transform } from "./types";

// ---------------------------------------------------------------------------
// Box-and-whisker statistics
// ---------------------------------------------------------------------------

export interface BoxStats {
  readonly q1: number;
  readonly median: number;
  readonly q3: number;
  /** Whisker ends: the most extreme data values within 1.5·IQR of the box. */
  readonly whiskerLo: number;
  readonly whiskerHi: number;
  /** Values beyond the whiskers. */
  readonly outliers: number[];
  /** Number of finite values summarised. */
  readonly count: number;
}

/** Linear-interpolated quantile of an already-sorted, finite array. */
export function quantileSorted(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  const frac = pos - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
}

/** Box-and-whisker summary of a set of values (non-finite dropped). */
export function boxStats(values: readonly number[]): BoxStats | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const q1 = quantileSorted(sorted, 0.25);
  const median = quantileSorted(sorted, 0.5);
  const q3 = quantileSorted(sorted, 0.75);
  const iqr = q3 - q1;
  const loFence = q1 - 1.5 * iqr;
  const hiFence = q3 + 1.5 * iqr;
  let whiskerLo = sorted[0];
  let whiskerHi = sorted[sorted.length - 1];
  const outliers: number[] = [];
  for (const v of sorted) {
    if (v < loFence || v > hiFence) outliers.push(v);
  }
  whiskerLo = sorted.find((v) => v >= loFence) ?? sorted[0];
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    if (sorted[i] <= hiFence) {
      whiskerHi = sorted[i];
      break;
    }
  }
  return {
    q1,
    median,
    q3,
    whiskerLo,
    whiskerHi,
    outliers,
    count: sorted.length,
  };
}

// ---------------------------------------------------------------------------
// Ordinary least squares fit
// ---------------------------------------------------------------------------

export interface LinearFit {
  readonly slope: number;
  readonly intercept: number;
  /** Coefficient of determination (R²). */
  readonly r2: number;
}

/** Least-squares line through finite (x, y) points, or null if degenerate. */
export function linearFit(
  points: readonly { x: number; y: number }[],
): LinearFit | null {
  const pts = points.filter(
    (p) => Number.isFinite(p.x) && Number.isFinite(p.y),
  );
  const n = pts.length;
  if (n < 2) return null;
  let sx = 0;
  let sy = 0;
  for (const p of pts) {
    sx += p.x;
    sy += p.y;
  }
  const mx = sx / n;
  const my = sy / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of pts) {
    const dx = p.x - mx;
    const dy = p.y - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (sxx === 0) return null; // vertical / no x variance
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
  return { slope, intercept, r2 };
}

// ---------------------------------------------------------------------------
// Frame transforms
// ---------------------------------------------------------------------------

/** Normalize a quantitative column in place (z-score or percent-change). */
function normalizeColumn(
  frame: SampleFrame,
  field: string,
  method: "zscore" | "percentChange",
): SampleFrame {
  const col = frame.columns.find((c) => c.name === field);
  if (!col || col.role !== "quantitative") return frame;
  const values = numericColumn(frame, field);
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return frame;
  const mean = finite.reduce((a, v) => a + v, 0) / finite.length;

  let transform: (v: number) => number;
  if (method === "zscore") {
    const variance =
      finite.reduce((a, v) => a + (v - mean) * (v - mean), 0) / finite.length;
    const std = Math.sqrt(variance);
    transform = std === 0 ? () => 0 : (v) => (v - mean) / std;
  } else {
    transform = mean === 0 ? (v) => v : (v) => ((v - mean) / mean) * 100;
  }

  const rows: FrameRow[] = frame.rows.map((row) => {
    const v = row[field];
    return typeof v === "number" && Number.isFinite(v)
      ? { ...row, [field]: transform(v) }
      : row;
  });
  return { ...frame, rows };
}

/**
 * Apply a frame's transforms before encoding. Currently handles `normalize`;
 * `bin` is server-side, `lmFit` is a render overlay (read by the mark), and
 * `aggregate` is reserved for line-band / summary work — all pass through here.
 */
export function applyTransforms(
  frame: SampleFrame,
  transforms?: readonly Transform[],
): SampleFrame {
  let out = frame;
  for (const t of transforms ?? []) {
    if (t.kind === "normalize") out = normalizeColumn(out, t.field, t.method);
  }
  return out;
}
