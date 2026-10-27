import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sampleLayerAtWorld = vi.hoisted(() => vi.fn());
vi.mock('@/services/SamplingService', () => ({ sampleLayerAtWorld }));

import {
  __resetLayerValueCacheForTests,
  isInsideVolume,
  sampleLayerValue,
  useLayerValueAtWorld,
} from '../useLayerValueAtWorld';

const meta = {
  worldBounds: { min: [-90, -126, -72] as [number, number, number], max: [90, 90, 108] as [number, number, number] },
  dimensions: [91, 109, 91] as [number, number, number],
};

describe('isInsideVolume', () => {
  // 2 mm voxels, voxel 0 centred at x = -90; backend (volume_queries::nearest_voxel):
  // floor(v + 0.5) in [0, dim), i.e. every voxel's full extent.
  it('mirrors the backend bounds rule exactly (-0.5 <= v < dim - 0.5)', () => {
    expect(isInsideVolume([0, 0, 0], meta)).toBe(true);
    expect(isInsideVolume([-90, 0, 0], meta)).toBe(true); // v = 0
    expect(isInsideVolume([-90.4, 0, 0], meta)).toBe(true); // v = -0.2: still voxel 0
    expect(isInsideVolume([-91.0, 0, 0], meta)).toBe(true); // v = -0.5: voxel 0's low face
    expect(isInsideVolume([-91.1, 0, 0], meta)).toBe(false); // v = -0.55: outside
    expect(isInsideVolume([-89.2, 0, 0], meta)).toBe(true); // v = 0.4 -> voxel 0
    expect(isInsideVolume([90.9, 0, 0], meta)).toBe(true); // v = 90.45 -> voxel 90
    expect(isInsideVolume([91.0, 0, 0], meta)).toBe(false); // v = 90.5 rounds to dim
    expect(isInsideVolume([91.1, 0, 0], meta)).toBe(false); // v = n - 0.45
    expect(isInsideVolume([0, 0, -200], meta)).toBe(false);
    expect(isInsideVolume([1e6, 0, 0], undefined)).toBe(true);
  });

  it('follows the axis direction of a flipped affine', () => {
    // Column-major, the backend's flattening: translation in elements 12..14.
    const flipped = { ...meta, worldToVoxel: [-0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0.5, 0, 45, 63, 36, 1] };
    // Voxel 0 is at x = +90 now: the low face is on the + side.
    expect(isInsideVolume([90.4, 0, 0], flipped)).toBe(true); // v = -0.2
    expect(isInsideVolume([91.1, 0, 0], flipped)).toBe(false); // v = -0.55
    expect(isInsideVolume([90, 0, 0], flipped)).toBe(true);
    expect(isInsideVolume([-90.9, 0, 0], flipped)).toBe(true);
    expect(isInsideVolume([-91.0, 0, 0], flipped)).toBe(false);
  });

  it('matches the harness fixture faces (MNI 2 mm 96x114x96, x voxel 0 at -95.5)', () => {
    const mni = {
      worldBounds: { min: [-95.5, -131.5, -77.5] as [number, number, number], max: [94.5, 94.5, 112.5] as [number, number, number] },
      dimensions: [96, 114, 96] as [number, number, number],
    };
    expect(isInsideVolume([95.4, 0.5, 0.5], mni)).toBe(true); // v = 95.45
    expect(isInsideVolume([95.5, 0.5, 0.5], mni)).toBe(false); // v = 95.5 rounds to dim
    expect(isInsideVolume([-95.9, 0.5, 0.5], mni)).toBe(true); // v = -0.2: voxel 0
    expect(isInsideVolume([-96.6, 0.5, 0.5], mni)).toBe(false); // v = -0.55
    expect(isInsideVolume([-95.4, 0.5, 0.5], mni)).toBe(true); // v = 0.05
  });
});

/** 4x4 row-major matrix helpers for building affines in tests. */
type M4 = number[][];
const mul = (a: M4, b: M4): M4 =>
  a.map((row) => [0, 1, 2, 3].map((c) => row.reduce((acc, v, k) => acc + v * b[k][c], 0)));
function invertAffine(m: M4): M4 {
  // General 3x3 inverse + translation.
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  const r = [
    [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
  const t = [m[0][3], m[1][3], m[2][3]];
  return [
    ...r.map((row) => [...row, -(row[0] * t[0] + row[1] * t[1] + row[2] * t[2])]),
    [0, 0, 0, 1],
  ];
}
const columnMajor = (m: M4): number[] =>
  [0, 1, 2, 3].flatMap((c) => [0, 1, 2, 3].map((r) => m[r][c]));
const apply = (m: M4, p: readonly number[]): number[] =>
  [0, 1, 2].map((r) => m[r][0] * p[0] + m[r][1] * p[1] + m[r][2] * p[2] + m[r][3]);
/** The backend rule (volume_queries::nearest_voxel), computed independently. */
function backendInside(w2v: M4, dims: number[], world: readonly number[]): boolean {
  const v = apply(w2v, world);
  return v.every((c, i) => {
    const index = Math.floor(c + 0.5);
    return index >= 0 && index < dims[i];
  });
}

describe('isInsideVolume with non-diagonal affines (full column-major matrix)', () => {
  // Axis-swapped acquisition (e.g. a sagittal T1): voxel i runs along world
  // y, j along world z, k along world x; 1x2x3 mm; dims 40x50x60.
  const dims: [number, number, number] = [40, 50, 60];
  const permuted: M4 = [
    [0, 0, 3, -90],
    [1, 0, 0, -20],
    [0, 2, 0, -50],
    [0, 0, 0, 1],
  ];
  const rot = (deg: number): M4 => {
    const t = (deg * Math.PI) / 180;
    return [
      [Math.cos(t), -Math.sin(t), 0, 0],
      [Math.sin(t), Math.cos(t), 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ];
  };
  const oblique: M4 = mul(rot(10), [
    [2, 0, 0, -40],
    [0, 2, 0, -50],
    [0, 0, 2, -60],
    [0, 0, 0, 1],
  ]);

  for (const [name, affine] of [
    ['permuted', permuted],
    ['10° oblique', oblique],
  ] as const) {
    it(`matches the backend rule at every face (${name})`, () => {
      const w2v = invertAffine(affine as M4);
      const metadata = {
        dimensions: dims,
        worldToVoxel: columnMajor(w2v),
        // An AABB that would mislead a per-world-axis check.
        worldBounds: { min: [-1000, -1000, -1000] as [number, number, number], max: [1000, 1000, 1000] as [number, number, number] },
      };
      const probes = [-0.6, -0.2, -0.01, 0, 0.2, 0.49];
      let checked = 0;
      for (let axis = 0; axis < 3; axis += 1) {
        const n = dims[axis];
        const along = [...probes, n - 1, n - 0.6, n - 0.51, n - 0.5, n - 0.4, n - 0.01];
        for (const c of along) {
          const voxel = [dims[0] / 2, dims[1] / 2, dims[2] / 2];
          voxel[axis] = c;
          const world = apply(affine as M4, voxel) as [number, number, number];
          expect(isInsideVolume(world, metadata), `${name} axis ${axis} v=${c}`).toBe(
            backendInside(w2v, dims, world),
          );
          checked += 1;
        }
      }
      expect(checked).toBe(36);
      // Spot checks: a voxel-centre corner is inside, half a voxel past the high face is not.
      expect(isInsideVolume(apply(affine as M4, [0, 0, 0]) as [number, number, number], metadata)).toBe(true);
      expect(
        isInsideVolume(apply(affine as M4, [dims[0] - 0.5, 1, 1]) as [number, number, number], metadata),
      ).toBe(false);
    });
  }

  it('reads the matrix column-major (the row-major layout disagrees with the backend)', () => {
    const w2v = invertAffine(permuted);
    const colMeta = { dimensions: dims, worldToVoxel: columnMajor(w2v) };
    const rowMeta = { dimensions: dims, worldToVoxel: w2v.flat() };
    let rowMismatches = 0;
    for (const voxel of [
      [0, 0, 0],
      [20, 25, 30],
      [39, 49, 59],
      [10, 40, 5],
    ]) {
      const world = apply(permuted, voxel) as [number, number, number];
      expect(isInsideVolume(world, colMeta)).toBe(true);
      if (!isInsideVolume(world, rowMeta)) rowMismatches += 1;
    }
    // Read row-major, the inverse collapses every point near voxel 0, so points
    // well outside the grid wrongly read as inside.
    for (const voxel of [
      [-5, -5, -5],
      [45, 55, 65],
      [20, -10, 70],
    ]) {
      const world = apply(permuted, voxel) as [number, number, number];
      expect(isInsideVolume(world, colMeta)).toBe(false);
      if (isInsideVolume(world, rowMeta)) rowMismatches += 1;
    }
    expect(rowMismatches).toBeGreaterThan(0);
  });
});

describe('sampleLayerValue', () => {
  beforeEach(() => {
    __resetLayerValueCacheForTests();
    sampleLayerAtWorld.mockReset();
  });

  it('shares one backend request per layer and position', async () => {
    sampleLayerAtWorld.mockResolvedValue({ value: -4.579 });
    const [a, b] = await Promise.all([
      sampleLayerValue('stat', [0, 48, 6]),
      sampleLayerValue('stat', [0, 48, 6]),
    ]);
    expect(a).toBe(-4.579);
    expect(b).toBe(-4.579);
    expect(sampleLayerAtWorld).toHaveBeenCalledTimes(1);
  });

  it('maps non-finite and failed samples to null', async () => {
    sampleLayerAtWorld.mockResolvedValueOnce({ value: Number.NaN });
    expect(await sampleLayerValue('stat', [1, 2, 3])).toBeNull();
    sampleLayerAtWorld.mockResolvedValueOnce({ value: null, error: new Error('x') });
    expect(await sampleLayerValue('stat', [1, 2, 4])).toBeNull();
  });
});

describe('useLayerValueAtWorld', () => {
  beforeEach(() => {
    __resetLayerValueCacheForTests();
    sampleLayerAtWorld.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('debounces crosshair moves into one sample', async () => {
    sampleLayerAtWorld.mockImplementation(async ({ world }: { world: number[] }) => ({ value: world[2] }));
    const { result, rerender } = renderHook(({ z }) => useLayerValueAtWorld('stat', [0, 0, z]), {
      initialProps: { z: 1 },
    });
    rerender({ z: 2 });
    rerender({ z: 3 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(sampleLayerAtWorld).toHaveBeenCalledTimes(1);
    expect(result.current?.value).toBe(3);
  });

  it('reads null without a layer', () => {
    const { result } = renderHook(() => useLayerValueAtWorld(null, [0, 0, 0]));
    expect(result.current).toBeNull();
  });
});
