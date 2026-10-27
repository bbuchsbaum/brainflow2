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
import { findClusters, findExtremum, nonzeroBbox, resampleMaskNearest } from '../volumeQueries';
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

// Phase 4 C1: the backend's sub-peak cases (core/api_bridge/src/clusters.rs
// tests), on the same Gaussian blobs along x (2 mm voxels, origin 0).
function blobs(list: Array<[number, number]>): VolumeFixture {
  const [nx, ny, nz] = [40, 13, 13];
  const data = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const r2 = (j - 6) ** 2 + (k - 6) ** 2;
        data[i + nx * (j + ny * k)] = list.reduce(
          (s, [c, a]) => s + Math.fround(a * Math.exp(-((i - c) ** 2 + r2) / 2)),
          0,
        );
      }
  return { dims: [nx, ny, nz], affine: [[2, 0, 0, 0], [0, 2, 0, 0], [0, 0, 2, 0], [0, 0, 0, 1]], data, range: [0, 0] };
}

describe('harness sub-peaks mirror the backend (C1)', () => {
  it('merged blobs closer than the minimum distance report no sub-peak; 5 mm does', () => {
    const vol = blobs([[10, 10], [13, 8]]);
    const t8 = findClusters(vol, { threshold: 0.1, maxPeaksPerCluster: 3, minPeakDistanceMm: 8 });
    expect(t8.clusters).toHaveLength(1);
    expect(t8.clusters[0].peakIjk).toEqual([10, 6, 6]);
    expect(t8.clusters[0].subPeaks).toEqual([]);
    const t5 = findClusters(vol, { threshold: 0.1, maxPeaksPerCluster: 3, minPeakDistanceMm: 5 });
    expect(t5.clusters[0].subPeaks.map((p) => [p.ijk, p.mm])).toEqual([[[13, 6, 6], [26, 12, 12]]]);
  });

  it('three blobs 12 mm apart: sub-peaks strongest first; the count includes the main peak', () => {
    const vol = blobs([[8, 10], [14, 6], [20, 8]]);
    const t = findClusters(vol, { threshold: 0.1, maxPeaksPerCluster: 3, minPeakDistanceMm: 8 });
    expect(t.clusters[0].subPeaks.map((p) => p.ijk)).toEqual([[20, 6, 6], [14, 6, 6]]);
    expect(findClusters(vol, { threshold: 0.1, maxPeaksPerCluster: 2 }).clusters[0].subPeaks).toHaveLength(1);
    const one = findClusters(vol, { threshold: 0.1, maxPeaksPerCluster: 1 });
    expect(one.clusters[0].subPeaks).toEqual([]);
    expect([one.maxPeaksPerCluster, one.minPeakDistanceMm]).toEqual([1, 8]);
  });

  it('a negative cluster takes its most negative peaks', () => {
    const t = findClusters(blobs([[8, -10], [14, -7], [30, 4]]), { threshold: 0.1, maxPeaksPerCluster: 3, minPeakDistanceMm: 8 });
    const neg = t.clusters.filter((c) => c.sign === 'negative');
    expect(neg).toHaveLength(1);
    expect(neg[0].subPeaks.map((p) => p.ijk)).toEqual([[14, 6, 6]]);
    expect(t.clusters.find((c) => c.sign === 'positive')!.subPeaks).toEqual([]);
  });
});

describe('harness compute_clusters search mask (S3)', () => {
  const all = (vol: VolumeFixture, value: number): VolumeFixture => ({ ...vol, data: new Float32Array(vol.data.length).fill(value) });

  it('a mask covering the grid forms the same clusters, over every finite voxel', () => {
    const plain = findClusters(zmap, { threshold: 3.1 });
    const mask = resampleMaskNearest(all(zmap, 1), zmap);
    const masked = findClusters(zmap, { threshold: 3.1 }, mask, 'vol-mask');
    expect(masked.clusters.map((c) => c.voxelCount)).toEqual(plain.clusters.map((c) => c.voxelCount));
    expect(plain.searchVolume).toEqual({ kind: 'map-nonzero', maskVolumeId: null, voxels: zmap.data.filter((v) => Number.isFinite(v) && v !== 0).length });
    expect(masked.searchVolume).toEqual({ kind: 'mask', maskVolumeId: 'vol-mask', voxels: zmap.data.filter((v) => Number.isFinite(v)).length });
  });

  it('clusters form only inside the mask; another grid is resampled by nearest voxel', () => {
    const plain = findClusters(zmap, { threshold: 3.1 });
    const peak = plain.clusters[0].peakIjk;
    const [nx, ny] = zmap.dims;
    // Only cluster 1's peak voxel is inside.
    const one = new Float32Array(zmap.data.length);
    one[peak[0] + nx * (peak[1] + ny * peak[2])] = 1;
    const masked = findClusters(zmap, { threshold: 3.1 }, resampleMaskNearest({ ...zmap, data: one }, zmap), 'm');
    expect(masked.clusters.map((c) => c.voxelCount)).toEqual([1]);
    expect(masked.clusters[0].peakIjk).toEqual(peak);
    // A 2x-coarser mask grid with the same world extent, all inside.
    const coarse: VolumeFixture = {
      dims: zmap.dims.map((d) => Math.ceil(d / 2)) as [number, number, number],
      affine: zmap.affine.map((row, r) => (r < 3 ? [row[0] * 2, row[1] * 2, row[2] * 2, row[3]] : row)),
      data: new Float32Array(Math.ceil(zmap.dims[0] / 2) * Math.ceil(zmap.dims[1] / 2) * Math.ceil(zmap.dims[2] / 2)).fill(1),
      range: [0, 1],
    };
    expect(findClusters(zmap, { threshold: 3.1 }, resampleMaskNearest(coarse, zmap), 'c').clusters.map((c) => c.voxelCount)).toEqual(
      plain.clusters.map((c) => c.voxelCount),
    );
  });

  it('an empty search is an input error (4081)', () => {
    expect(() => findClusters(zmap, { threshold: 3.1 }, resampleMaskNearest(all(zmap, 0), zmap), 'm')).toThrow(
      expect.objectContaining({ code: 4081 }),
    );
  });
});
