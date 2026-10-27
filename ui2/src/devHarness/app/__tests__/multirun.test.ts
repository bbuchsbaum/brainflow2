import { describe, expect, it } from 'vitest';
import truth from '@/devHarness/fixtures/app/p4_fixtures.json';
import { multirunFixture } from '../multirun';

// The harness runs mirror the truth (round 3 C1: textured brain, known course at the voxel).
describe('multirun fixture = p4_fixtures.json multirun', () => {
  const mr = (truth as unknown as { multirun: { voxelIjk: number[]; runs: { course: number[]; allFrameWithZeros: { p2: number; p98: number } }[] } }).multirun;
  it.each([0, 1, 2])('run %i: the course at the voxel and the EPI window percentiles', (r) => {
    const f = multirunFixture(r + 1);
    const [nx, ny] = f.dims;
    const [i, j, k] = mr.voxelIjk;
    const n = i + nx * (j + ny * k);
    expect(f.frames!.map((d) => d[n])).toEqual(mr.runs[r].course);
    const all = Float32Array.from(f.frames!.flatMap((d) => Array.from(d))).sort();
    const rank = (q: number) => all[Math.ceil((q / 100) * all.length) - 1];
    expect(rank(2)).toBe(mr.runs[r].allFrameWithZeros.p2);
    expect(rank(98)).toBeCloseTo(mr.runs[r].allFrameWithZeros.p98, 4);
  });
});
