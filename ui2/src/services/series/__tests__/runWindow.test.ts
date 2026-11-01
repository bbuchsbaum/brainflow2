import { beforeEach, describe, expect, it } from 'vitest';
import { computePercentileFromBins } from '@/services/IntensityRangeComputer';
import { multirunFixture } from '@/devHarness/app/multirun';
import { pooledWindow, resetRunWindows, shareRunWindow, type PoolHistogram } from '../runWindow';

/** A histogram of `values` on [lo, hi] with `n` bins (the mock's binning). */
function histogram(values: Float32Array, lo: number, hi: number, n: number): PoolHistogram {
  const width = (hi - lo) / n;
  const counts = new Array<number>(n).fill(0);
  for (const v of values) counts[Math.min(Math.floor((v - lo) / width), n - 1)] += 1;
  return {
    bins: counts.map((count, i) => ({ x0: lo + i * width, x1: lo + (i + 1) * width, count })),
    totalCount: values.length,
  };
}
const allFrames = (run: number) =>
  Float32Array.from(multirunFixture(run).frames!.flatMap((f) => Array.from(f)));
const nearestRank = (values: Float32Array, q: number) => {
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.ceil((q / 100) * sorted.length) - 1];
};
const percentile = computePercentileFromBins as Parameters<typeof pooledWindow>[1];

describe('pooled EPI window (native R3-2)', () => {
  beforeEach(() => resetRunWindows());

  it('is p2–p98 of the summed distribution of all runs, not the max of per-run p98s', () => {
    const runs = [1, 2, 3].map(allFrames);
    const lo = Math.min(...runs.map((r) => r.reduce((a, b) => Math.min(a, b), Infinity)));
    const hi = Math.max(...runs.map((r) => r.reduce((a, b) => Math.max(a, b), -Infinity)));
    const window = pooledWindow(
      runs.map((r) => histogram(r, lo, hi, 1024)),
      percentile,
    )!;
    const all = new Float32Array(runs.reduce((n, r) => n + r.length, 0));
    let o = 0;
    for (const r of runs) {
      all.set(r, o);
      o += r.length;
    }
    const binWidth = (hi - lo) / 1024;
    expect(window[0]).toBe(0);
    expect(Math.abs(window[1] - nearestRank(all, 98))).toBeLessThanOrEqual(binWidth);
    // The per-run maximum over-shoots (the native 114.56 vs 112.94 failure).
    const maxOfRuns = Math.max(...runs.map((r) => nearestRank(r, 98)));
    expect(maxOfRuns - nearestRank(all, 98)).toBeGreaterThan(binWidth);
  }, 30_000); // 3.6 M voxel-frames sorted for the reference percentile

  it('keeps a uniform-tissue run mid grey instead of a white slab (QA 2026-10-30 F16)', () => {
    // raw4d_bold.nii: 60 % zero background, the brain exactly 100, a few
    // responses up to 120.
    const values = new Float32Array(10000);
    for (let i = 6000; i < 9950; i += 1) values[i] = 100;
    for (let i = 9950; i < 10000; i += 1) values[i] = 120;
    const [low, top] = pooledWindow([histogram(values, 0, 120, 1024)], percentile)!;
    expect(low).toBe(0);
    // The brain sits near mid grey, not at the top of the window.
    expect((100 - low) / (top - low)).toBeGreaterThan(0.4);
    expect((100 - low) / (top - low)).toBeLessThan(0.6);
  });

  it('runs refined one at a time end on one window; a user window is left alone', () => {
    const view = new Map<string, [number, number]>();
    const current = (id: string) => view.get(id);
    const apply = (id: string, w: [number, number]) =>
      view.set(id, [Math.fround(w[0]), Math.fround(w[1])]);
    apply('r1', shareRunWindow('r1', [0, 112.57], current, apply, ['r1']));
    apply('r2', shareRunWindow('r2', [0, 112.94], current, apply, ['r1', 'r2']));
    expect(view.get('r1')).toEqual([0, Math.fround(112.94)]);
    view.set('r2', [10, 90]); // the user's window
    apply('r3', shareRunWindow('r3', [0, 112.9], current, apply, ['r1', 'r2', 'r3']));
    expect(view.get('r1')).toEqual([0, Math.fround(112.9)]);
    expect(view.get('r2')).toEqual([10, 90]);
  });
});
