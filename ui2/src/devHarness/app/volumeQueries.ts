/**
 * Harness mirrors of the backend volume queries (core/api_bridge/src/
 * clusters.rs and volume_queries.rs): `compute_clusters`, `volume_extremum`
 * and `volume_nonzero_bbox`, run on the fixture arrays so the harness judges
 * the contract the app ships. Same rules: strict thresholds per sign,
 * 6/18/26 neighbours by Manhattan distance, x-fastest seed order, |peak|
 * ties keep the earliest voxel, rows sorted by |peak| desc, then size desc,
 * then first voxel. Sub-peaks (phase 4 C1) as `local_maxima` + `select_peaks`;
 * cluster-extent p (C2) through ./rftExtent.ts. An optional search mask
 * (S3, `searchMask`) as `resample_mask_nearest` + `search_voxels`.
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
import { applyExtentInference, type ExtentRequest } from './rftExtent';

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
  maxPeaksPerCluster?: number | null;
  minPeakDistanceMm?: number | null;
  extent?: ExtentRequest | null;
  emitLabelVolume?: boolean | null;
  /** Volume id of a mask bounding the search (resolved by the handler). */
  searchMask?: string | null;
}

const maskError = (details: string) => Object.assign(new Error(details), { code: 4081 });

/** Inverse of a row-major 4x4 affine's 3x4 part (voxel <- world). */
function invertAffine(m: number[][]): number[][] {
  const [a, b, c] = [m[0], m[1], m[2]];
  const det =
    a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  if (!Number.isFinite(det) || det === 0) throw maskError('The search mask affine is not invertible.');
  const r = [
    [(b[1] * c[2] - b[2] * c[1]) / det, (a[2] * c[1] - a[1] * c[2]) / det, (a[1] * b[2] - a[2] * b[1]) / det],
    [(b[2] * c[0] - b[0] * c[2]) / det, (a[0] * c[2] - a[2] * c[0]) / det, (a[2] * b[0] - a[0] * b[2]) / det],
    [(b[0] * c[1] - b[1] * c[0]) / det, (a[1] * c[0] - a[0] * c[1]) / det, (a[0] * b[1] - a[1] * b[0]) / det],
  ];
  const t = [a[3], b[3], c[3]];
  return r.map((row) => [...row, -(row[0] * t[0] + row[1] * t[1] + row[2] * t[2])]);
}

/**
 * `resample_mask_nearest`: a voxel of `vol` is inside when the nearest mask
 * voxel (by world position) holds a finite non-zero value. One-frame masks only.
 */
export function resampleMaskNearest(mask: VolumeFixture, vol: VolumeFixture): Uint8Array {
  if ((mask.frames?.length ?? 1) !== 1) throw maskError('A search mask must have one spatial frame.');
  const inside = (v: number) => Number.isFinite(v) && v !== 0;
  const same =
    mask.dims.every((d, i) => d === vol.dims[i]) &&
    mask.affine.every((row, r) => row.every((v, c) => v === vol.affine[r][c]));
  if (same) return Uint8Array.from(mask.data, (v) => (inside(v) ? 1 : 0));
  const inv = invertAffine(mask.affine);
  const [nx, ny] = vol.dims;
  const [mx, my, mz] = mask.dims;
  const out = new Uint8Array(vol.data.length);
  for (let n = 0; n < out.length; n++) {
    const w = voxelToWorld(vol.affine, [n % nx, Math.floor(n / nx) % ny, Math.floor(n / (nx * ny))]);
    const p = [0, 1, 2].map((r) => Math.round(inv[r][0] * w[0] + inv[r][1] * w[1] + inv[r][2] * w[2] + inv[r][3]));
    if (p[0] < 0 || p[1] < 0 || p[2] < 0 || p[0] >= mx || p[1] >= my || p[2] >= mz) continue;
    if (inside(mask.data[p[0] + mx * (p[1] + my * p[2])])) out[n] = 1;
  }
  return out;
}

/** Cluster ids (1-based rank, 0 elsewhere) on the analysed grid, as compute_clusters emits them (E3). */
export function clusterLabelData(
  vol: VolumeFixture,
  query: ClusterQuery,
  table: ClusterTable,
  mask: Uint8Array | null = null,
): Float32Array {
  // Same components as findClusters: re-flood from each row's peak with its sign.
  const [nx, ny, nz] = vol.dims;
  const out = new Float32Array(vol.data.length);
  const offsets = neighbourOffsets(query.connectivity ?? 26);
  const t = Math.fround(query.threshold);
  for (const c of table.clusters) {
    const s = c.sign === 'positive' ? 1 : -1;
    const seed = c.peakIjk[0] + nx * (c.peakIjk[1] + ny * c.peakIjk[2]);
    const stack = [seed];
    out[seed] = c.id;
    while (stack.length) {
      const n = stack.pop()!;
      const i = n % nx;
      const j = Math.floor(n / nx) % ny;
      const k = Math.floor(n / (nx * ny));
      for (const [di, dj, dk] of offsets) {
        const a = i + di;
        const b = j + dj;
        const cc = k + dk;
        if (a < 0 || b < 0 || cc < 0 || a >= nx || b >= ny || cc >= nz) continue;
        const m = a + nx * (b + ny * cc);
        if (out[m] === 0 && (!mask || mask[m]) && Number.isFinite(vol.data[m]) && vol.data[m] * s > t) {
          out[m] = c.id;
          stack.push(m);
        }
      }
    }
  }
  return out;
}

export function findClusters(
  vol: VolumeFixture,
  query: ClusterQuery,
  mask: Uint8Array | null = null,
  maskVolumeId: string | null = null,
): ClusterTable {
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
  const maxPeaks = query.maxPeaksPerCluster ?? 3;
  const minPeakDistance = query.minPeakDistanceMm ?? 8;
  if (!Number.isInteger(maxPeaks) || maxPeaks < 1 || maxPeaks > 32 || !Number.isFinite(minPeakDistance) || minPeakDistance < 0) {
    throw Object.assign(new Error('Peaks per cluster must be 1..32 and the peak distance finite and >= 0'), { code: 4079 });
  }
  const [nx, ny, nz] = vol.dims;
  const values = vol.data;
  // Searched voxels (`search_voxels`): mask ∩ finite, else finite non-zero.
  const searched = Uint8Array.from(values, (v, n) => (mask ? mask[n] && Number.isFinite(v) : Number.isFinite(v) && v !== 0) ? 1 : 0);
  let searchedCount = 0;
  for (const v of searched) searchedCount += v;
  if (mask && searchedCount === 0) throw maskError('The search mask has no finite map voxels on the analysed grid.');
  const polarityAt = (n: number): ClusterPolarity | null => (mask && !mask[n] ? null : polarity(values[n]));
  const polarity = (v: number): ClusterPolarity | null => {
    if (!Number.isFinite(v)) return null;
    if (v > threshold && sign !== 'negative') return 'positive';
    if (v < -threshold && sign !== 'positive') return 'negative';
    return null;
  };
  const offsets = neighbourOffsets(connectivity);
  // 0 = unlabelled, else the 1-based component (the backend's `labels`).
  const visited = new Int32Array(values.length);
  let nextLabel = 0;
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
    label: number;
    members: number[];
  }
  const kept: Acc[] = [];
  let discarded = 0;
  let supra = 0;
  for (let seed = 0; seed < values.length; seed++) {
    if (visited[seed]) continue;
    const pol = polarityAt(seed);
    if (!pol) continue;
    nextLabel += 1;
    visited[seed] = nextLabel;
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
      label: nextLabel,
      members: [],
    };
    while (stack.length) {
      const index = stack.pop()!;
      const i = index % nx;
      const j = Math.floor(index / nx) % ny;
      const k = Math.floor(index / (nx * ny));
      const v = values[index];
      acc.members.push(index);
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
        if (!visited[n] && polarityAt(n) === pol) {
          visited[n] = nextLabel;
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
  const ijkOf = (n: number): Vec3 => [n % nx, Math.floor(n / nx) % ny, Math.floor(n / (nx * ny))];
  // local_maxima: strictly above every same-cluster neighbour (ties: lower
  // index wins), strongest first; then select_peaks: greedy, >= min distance.
  const subPeaksOf = (acc: { polarity: ClusterPolarity; label: number; members: number[] }) => {
    const s = acc.polarity === 'positive' ? 1 : -1;
    const maxima = acc.members.filter((index) => {
      const value = values[index] * s;
      const [i, j, k] = ijkOf(index);
      return offsets.every(([di, dj, dk]) => {
        const a = i + di;
        const b = j + dj;
        const c = k + dk;
        if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz) return true;
        const n = a + nx * (b + ny * c);
        if (visited[n] !== acc.label) return true;
        const vn = values[n] * s;
        return vn < value || (vn === value && index < n);
      });
    });
    maxima.sort((a, b) => values[b] * s - values[a] * s || a - b);
    const accepted: Array<{ index: number; mm: Vec3 }> = [];
    for (const index of maxima) {
      if (accepted.length >= maxPeaks) break;
      const mm = voxelToWorld(vol.affine, ijkOf(index));
      if (accepted.every((o) => Math.hypot(mm[0] - o.mm[0], mm[1] - o.mm[1], mm[2] - o.mm[2]) >= minPeakDistance)) {
        accepted.push({ index, mm });
      }
    }
    return accepted.slice(1).map(({ index, mm }) => ({ value: values[index], ijk: ijkOf(index), mm }));
  };
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
      subPeaks: maxPeaks > 1 ? subPeaksOf(acc) : [],
      pFweExtent: null,
      pUncorrectedExtent: null,
    };
  });
  const table: ClusterTable = {
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
    maxPeaksPerCluster: maxPeaks,
    minPeakDistanceMm: minPeakDistance,
    extentInference: null,
    searchVolume: { kind: mask ? 'mask' : 'map-nonzero', maskVolumeId, voxels: searchedCount },
  };
  if (query.extent) applyExtentInference(table, vol, query.extent, searched);
  return table;
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
