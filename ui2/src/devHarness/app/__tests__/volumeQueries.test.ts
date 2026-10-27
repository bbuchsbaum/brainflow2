/**
 * The harness mirrors of compute_clusters / volume_extremum /
 * volume_nonzero_bbox must reproduce the fixture truth in p3_fixtures.json
 * exactly (sizes, peaks, centres of mass), or the harness judges a different
 * contract from the one the backend ships.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import meta from '../../fixtures/app/p3_fixtures.json';
import { findClusters, findExtremum, nonzeroBbox } from '../volumeQueries';
import type { VolumeFixture } from '../fixtures';

const dir = resolve(__dirname, '../../fixtures/app');
function fixture(file: string, kind: 'f32' | 'u8'): VolumeFixture {
  const bytes = gunzipSync(readFileSync(resolve(dir, file)));
  const data =
    kind === 'f32'
      ? new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
      : Float32Array.from(bytes);
  return {
    dims: meta.grid.dims as [number, number, number],
    affine: meta.grid.affine,
    data,
    range: [0, 0],
  };
}

const zmap = fixture('zmap_2mm.f32.gz', 'f32');
const tmap = fixture('tmap_2mm.f32.gz', 'f32');
const atlas = fixture('atlas3_2mm.u8.gz', 'u8');

type Truth = {
  sign: string;
  size_vox: number;
  size_mm3: number;
  peak_value: number;
  peak_ijk: number[];
  peak_mm: number[];
  com_ijk: number[];
  com_mm: number[];
};

const round3 = (v: number) => Math.round(v * 1000) / 1000;

describe('harness compute_clusters mirror', () => {
  for (const [name, vol] of [
    ['zmap', zmap],
    ['tmap', tmap],
  ] as const) {
    const truthTables = (meta.volumes[name] as { clusters: Record<string, Truth[]> }).clusters;
    for (const [key, truth] of Object.entries(truthTables)) {
      it(`${name} ${key} matches the fixture truth`, () => {
        const [, thr, conn] = /abs>([\d.]+),conn(\d+)/.exec(key)!;
        const table = findClusters(vol, { threshold: Number(thr), connectivity: Number(conn) });
        const got = table.clusters.map((c) => ({
          sign: c.sign,
          size_vox: c.voxelCount,
          size_mm3: c.volumeMm3,
          peak_value: round3(c.peakValue),
          peak_ijk: c.peakIjk,
          peak_mm: c.peakMm,
          com_ijk: c.centroidIjk.map(round3),
          com_mm: c.centroidMm.map(round3),
        }));
        const want = truth.map(({ sign, size_vox, size_mm3, peak_value, peak_ijk, peak_mm, com_ijk, com_mm }) => ({
          sign,
          size_vox,
          size_mm3,
          peak_value,
          peak_ijk,
          peak_mm,
          com_ijk,
          com_mm,
        }));
        const byPeak = (a: { peak_ijk: number[] }, b: { peak_ijk: number[] }) =>
          a.peak_ijk.join(',').localeCompare(b.peak_ijk.join(','));
        expect([...got].sort(byPeak)).toEqual([...want].sort(byPeak));
        // Backend order: |peak| descending.
        const peaks = table.clusters.map((c) => Math.abs(c.peakValue));
        expect(peaks).toEqual([...peaks].sort((a, b) => b - a));
      });
    }
  }

  it('applies the strict threshold to the 27 voxels exactly on f32(2.3)', () => {
    const strict = findClusters(zmap, { threshold: 2.3, connectivity: 26 });
    expect(strict.suprathresholdVoxels).toBe(1726);
  });

  it('separates signs and drops small components into discardedClusters', () => {
    const pos = findClusters(zmap, { threshold: 3.1, sign: 'positive', connectivity: 26 });
    expect(pos.clusters.every((c) => c.sign === 'positive')).toBe(true);
    const min5 = findClusters(zmap, { threshold: 3.1, connectivity: 26, minVoxels: 5 });
    expect(min5.discardedClusters).toBeGreaterThan(0);
    expect(min5.clusters.every((c) => c.voxelCount >= 5)).toBe(true);
  });
});

describe('harness volume_extremum / volume_nonzero_bbox mirrors', () => {
  it('finds the z map max and min at the fixture peaks', () => {
    expect(findExtremum(zmap, 'max')).toMatchObject({ ijk: [28, 56, 64], worldMm: [-39.5, -19.5, 50.5] });
    expect(round3(findExtremum(zmap, 'max')!.value)).toBe(meta.volumes.zmap.range[1]);
    expect(findExtremum(zmap, 'min')).toMatchObject({ ijk: [48, 86, 44], worldMm: [0.5, 40.5, 10.5] });
  });

  it('bounds the non-zero voxels of the atlas', () => {
    const bbox = nonzeroBbox(atlas)!;
    const voxels = Object.values(meta.volumes.atlas.voxels_per_region as Record<string, number>).reduce(
      (a, b) => a + b,
      0,
    );
    expect(bbox.voxelCount).toBe(voxels);
    expect(bbox.ijkMin.every((v, a) => v <= bbox.ijkMax[a])).toBe(true);
  });
});
