/**
 * Harness mirrors of the backend volume queries (core/api_bridge/src/
 * clusters.rs and volume_queries.rs): `compute_clusters`, `volume_extremum`
 * and `volume_nonzero_bbox`, run on the fixture arrays so the harness judges
 * the contract the app ships. Same rules: strict thresholds per sign,
 * 6/18/26 neighbours by Manhattan distance, x-fastest seed order, |peak|
 * ties keep the earliest voxel, rows sorted by |peak| desc, then size desc,
 * then first voxel.
 */
import type {
  ClusterPolarity,
  ClusterSign,
  ClusterSummary,
  ClusterTable,
  ExtremumKind,
  VolumeNonzeroBbox,
  VoxelLocation,
} from '@brainflow/api';
import type { VolumeFixture } from './fixtures';

type Vec3 = [number, number, number];

const f32 = (v: number) => Math.fround(v);

function voxelToWorld(affine: number[][], ijk: readonly number[]): Vec3 {
  return [0, 1, 2].map((r) =>
    f32(affine[r][0] * ijk[0] + affine[r][1] * ijk[1] + affine[r][2] * ijk[2] + affine[r][3]),
  ) as Vec3;
}

function voxelVolume(affine: number[][]): number {
  const [a, b, c] = [0, 1, 2].map((col) => [affine[0][col], affine[1][col], affine[2][col]]);
  const det =
    a[0] * (b[1] * c[2] - b[2] * c[1]) -
    b[0] * (a[1] * c[2] - a[2] * c[1]) +
    c[0] * (a[1] * b[2] - a[2] * b[1]);
  return f32(Math.abs(det));
}

function neighbourOffsets(connectivity: number): Vec3[] {
  const max = connectivity === 6 ? 1 : connectivity === 18 ? 2 : 3;
  const out: Vec3[] = [];
  for (let dk = -1; dk <= 1; dk++)
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        const m = Math.abs(di) + Math.abs(dj) + Math.abs(dk);
        if (m > 0 && m <= max) out.push([di, dj, dk]);
      }
  return out;
}

function worldEnvelope(
  affine: number[][],
  lo: readonly number[],
  hi: readonly number[],
): [Vec3, Vec3] {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const i of [lo[0], hi[0]])
    for (const j of [lo[1], hi[1]])
      for (const k of [lo[2], hi[2]]) {
        const w = voxelToWorld(affine, [i, j, k]);
        for (let a = 0; a < 3; a++) {
          min[a] = Math.min(min[a], w[a]);
          max[a] = Math.max(max[a], w[a]);
        }
      }
  return [min, max];
}

export interface ClusterQuery {
  threshold: number;
  sign?: ClusterSign | null;
  connectivity?: number | null;
  minVoxels?: number | null;
  maxClusters?: number | null;
}

export function findClusters(vol: VolumeFixture, query: ClusterQuery): ClusterTable {
  const threshold = f32(query.threshold);
  if (!Number.isFinite(threshold) || threshold < 0) {
    throw new Error('Cluster threshold must be a finite absolute value >= 0');
  }
  const connectivity = query.connectivity ?? 26;
  if (![6, 18, 26].includes(connectivity)) {
    throw new Error(`Connectivity must be 6, 18 or 26 (got ${connectivity})`);
  }
  const sign: ClusterSign = query.sign ?? 'both';
  const minVoxels = query.minVoxels ?? 1;
  const maxClusters = Math.max(query.maxClusters ?? 500, 1);
  const [nx, ny, nz] = vol.dims;
  const values = vol.data;
  const polarity = (v: number): ClusterPolarity | null => {
    if (!Number.isFinite(v)) return null;
    if (v > threshold && sign !== 'negative') return 'positive';
    if (v < -threshold && sign !== 'positive') return 'negative';
    return null;
  };
  const offsets = neighbourOffsets(connectivity);
  const visited = new Uint8Array(values.length);
  const stack: number[] = [];
  interface Acc {
    polarity: ClusterPolarity;
    first: number;
    count: number;
    sumValue: number;
    sumIjk: Vec3;
    sumWeight: number;
    sumWeighted: Vec3;
    peakIndex: number;
    peakValue: number;
    lo: Vec3;
    hi: Vec3;
  }
  const kept: Acc[] = [];
  let discarded = 0;
  let supra = 0;
  for (let seed = 0; seed < values.length; seed++) {
    if (visited[seed]) continue;
    const pol = polarity(values[seed]);
    if (!pol) continue;
    visited[seed] = 1;
    stack.push(seed);
    const acc: Acc = {
      polarity: pol,
      first: seed,
      count: 0,
      sumValue: 0,
      sumIjk: [0, 0, 0],
      sumWeight: 0,
      sumWeighted: [0, 0, 0],
      peakIndex: seed,
      peakValue: values[seed],
      lo: [Infinity, Infinity, Infinity],
      hi: [0, 0, 0],
    };
    while (stack.length) {
      const index = stack.pop()!;
      const i = index % nx;
      const j = Math.floor(index / nx) % ny;
      const k = Math.floor(index / (nx * ny));
      const v = values[index];
      acc.count += 1;
      acc.sumValue += v;
      const w = Math.abs(v);
      acc.sumWeight += w;
      const ijk = [i, j, k];
      for (let a = 0; a < 3; a++) {
        acc.sumIjk[a] += ijk[a];
        acc.sumWeighted[a] += w * ijk[a];
        acc.lo[a] = Math.min(acc.lo[a], ijk[a]);
        acc.hi[a] = Math.max(acc.hi[a], ijk[a]);
      }
      if (w > Math.abs(acc.peakValue) || (w === Math.abs(acc.peakValue) && index < acc.peakIndex)) {
        acc.peakIndex = index;
        acc.peakValue = v;
      }
      for (const [di, dj, dk] of offsets) {
        const a = i + di;
        const b = j + dj;
        const c = k + dk;
        if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz) continue;
        const n = a + nx * (b + ny * c);
        if (!visited[n] && polarity(values[n]) === pol) {
          visited[n] = 1;
          stack.push(n);
        }
      }
    }
    supra += acc.count;
    if (acc.count < minVoxels) discarded += 1;
    else kept.push(acc);
  }
  kept.sort(
    (a, b) =>
      Math.abs(b.peakValue) - Math.abs(a.peakValue) || b.count - a.count || a.first - b.first,
  );
  const vv = voxelVolume(vol.affine);
  const clusters: ClusterSummary[] = kept.slice(0, maxClusters).map((acc, rank) => {
    const centroidIjk = acc.sumIjk.map((s) => f32(s / acc.count)) as Vec3;
    const weightedIjk =
      acc.sumWeight > 0
        ? (acc.sumWeighted.map((s) => f32(s / acc.sumWeight)) as Vec3)
        : centroidIjk;
    const p = acc.peakIndex;
    const peakIjk: Vec3 = [p % nx, Math.floor(p / nx) % ny, Math.floor(p / (nx * ny))];
    const [bboxMmMin, bboxMmMax] = worldEnvelope(vol.affine, acc.lo, acc.hi);
    return {
      id: rank + 1,
      sign: acc.polarity,
      voxelCount: acc.count,
      volumeMm3: f32(acc.count * vv),
      peakValue: acc.peakValue,
      peakIjk,
      peakMm: voxelToWorld(vol.affine, peakIjk),
      meanValue: f32(acc.sumValue / acc.count),
      centroidIjk,
      centroidMm: voxelToWorld(vol.affine, centroidIjk),
      weightedCentroidMm: voxelToWorld(vol.affine, weightedIjk),
      bboxIjkMin: [...acc.lo] as Vec3,
      bboxIjkMax: [...acc.hi] as Vec3,
      bboxMmMin,
      bboxMmMax,
    };
  });
  return {
    clusters,
    threshold,
    sign,
    connectivity,
    minVoxels,
    timepoint: null,
    voxelVolumeMm3: vv,
    suprathresholdVoxels: supra,
    totalClusters: kept.length,
    discardedClusters: discarded,
    truncated: kept.length > maxClusters,
  };
}

/** First voxel (x-fastest) holding the max / min / largest-|value| finite value. */
export function findExtremum(vol: VolumeFixture, kind: ExtremumKind): VoxelLocation | null {
  let best = -1;
  let bestKey = -Infinity;
  for (let n = 0; n < vol.data.length; n++) {
    const v = vol.data[n];
    if (!Number.isFinite(v)) continue;
    const key = kind === 'max' ? v : kind === 'min' ? -v : Math.abs(v);
    if (key > bestKey) {
      bestKey = key;
      best = n;
    }
  }
  if (best < 0) return null;
  const [nx, ny] = vol.dims;
  const ijk: Vec3 = [best % nx, Math.floor(best / nx) % ny, Math.floor(best / (nx * ny))];
  return { value: vol.data[best], ijk, worldMm: voxelToWorld(vol.affine, ijk), timepoint: null };
}

/** Bounding box of the voxels with |value| > threshold (mosaic crop). */
export function nonzeroBbox(vol: VolumeFixture, threshold = 0): VolumeNonzeroBbox | null {
  const [nx, ny] = vol.dims;
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-1, -1, -1];
  let count = 0;
  for (let n = 0; n < vol.data.length; n++) {
    const v = vol.data[n];
    if (!(Math.abs(v) > threshold)) continue;
    count += 1;
    const ijk = [n % nx, Math.floor(n / nx) % ny, Math.floor(n / (nx * ny))];
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], ijk[a]);
      hi[a] = Math.max(hi[a], ijk[a]);
    }
  }
  if (count === 0) return null;
  const [worldMinMm, worldMaxMm] = worldEnvelope(vol.affine, lo, hi);
  return { ijkMin: lo, ijkMax: hi, worldMinMm, worldMaxMm, voxelCount: count, timepoint: null };
}
