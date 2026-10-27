import { afterEach, describe, expect, it } from 'vitest';
import {
  currentVoxelGridReference,
  nearestVoxelIndex,
  resolveVoxelGridReference,
  setVoxelGridReferenceProvider,
  snapWorldToVoxelCentre,
  voxelIndexInBounds,
  worldToVoxelIndex,
  type VoxelGridReference,
} from '../voxelSnap';
import type { VolumeMetadata } from '@/stores/layerStore';

/** Row-major 4x4 -> the backend's column-major flattening. */
const columnMajor = (m: number[][]) => [0, 1, 2, 3].flatMap((c) => [0, 1, 2, 3].map((r) => m[r][c]));

function invert(m: number[][]): number[][] {
  const [a, b, c] = [m[0], m[1], m[2]];
  const det =
    a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  const inv3 = [
    [(b[1] * c[2] - b[2] * c[1]) / det, (a[2] * c[1] - a[1] * c[2]) / det, (a[1] * b[2] - a[2] * b[1]) / det],
    [(b[2] * c[0] - b[0] * c[2]) / det, (a[0] * c[2] - a[2] * c[0]) / det, (a[2] * b[0] - a[0] * b[2]) / det],
    [(b[0] * c[1] - b[1] * c[0]) / det, (a[1] * c[0] - a[0] * c[1]) / det, (a[0] * b[1] - a[1] * b[0]) / det],
  ];
  const t = [0, 1, 2].map((r) => -(inv3[r][0] * m[0][3] + inv3[r][1] * m[1][3] + inv3[r][2] * m[2][3]));
  return [...inv3.map((row, r) => [...row, t[r]]), [0, 0, 0, 1]];
}

function reference(affine: number[][], dims: [number, number, number]): VoxelGridReference {
  return {
    layerId: 'base',
    name: 'base',
    voxelToWorld: columnMajor(affine),
    worldToVoxel: columnMajor(invert(affine)),
    dims,
  };
}

// The harness MNI grid (p3_fixtures.json): 2 mm, voxel centres at odd half-mm.
const MNI = reference(
  [
    [2, 0, 0, -95.5],
    [0, 2, 0, -131.5],
    [0, 0, 2, -77.5],
    [0, 0, 0, 1],
  ],
  [96, 114, 96],
);

describe('nearestVoxelIndex', () => {
  it('is floor(v + 0.5), like the backend nearest_voxel (ties round up)', () => {
    expect(nearestVoxelIndex([47.5, 56.5, -0.5])).toEqual([48, 57, 0]);
    expect(nearestVoxelIndex([47.49, 0.2, -0.51])).toEqual([47, 0, -1]);
  });
});

describe('snapWorldToVoxelCentre', () => {
  it('moves the geometric centre (a voxel edge on even grids) onto a voxel centre', () => {
    // (dims - 1) / 2 = (47.5, 56.5, 47.5) -> voxel (48, 57, 48).
    expect(snapWorldToVoxelCentre([-0.5, -18.5, 17.5], MNI)).toEqual([0.5, -17.5, 18.5]);
    expect(worldToVoxelIndex([0.5, -17.5, 18.5], MNI)).toEqual([48, 57, 48]);
  });

  it('lands on the voxel the backend samples (fixture truth: peak at ijk 28,56,64)', () => {
    // z-map peak ~(-40, -20, 50) is stored at voxel (28, 56, 64) = (-39.5, -19.5, 50.5) mm.
    expect(snapWorldToVoxelCentre([-40, -20, 50], MNI)).toEqual([-39.5, -19.5, 50.5]);
    expect(worldToVoxelIndex([-40, -20, 50], MNI)).toEqual([28, 56, 64]);
    // Region fixture point (42, -60, -10) -> ijk (69, 36, 34).
    expect(worldToVoxelIndex([42, -60, -10], MNI)).toEqual([69, 36, 34]);
    expect(snapWorldToVoxelCentre([42, -60, -10], MNI)).toEqual([42.5, -59.5, -9.5]);
  });

  it('is idempotent and a voxel centre maps back to an integer index', () => {
    const once = snapWorldToVoxelCentre([13.3, -71.9, 2.2], MNI);
    expect(snapWorldToVoxelCentre(once, MNI)).toEqual(once);
    expect(worldToVoxelIndex(once, MNI).every(Number.isInteger)).toBe(true);
  });

  it('follows a flipped, permuted, oblique affine through the full matrix', () => {
    const t = (12 * Math.PI) / 180;
    const affine = [
      [0, -Math.sin(t) * 1.5, -3, 40],
      [1.2 * Math.cos(t), 0, 0, -20],
      [1.2 * Math.sin(t), 1.5 * Math.cos(t), 0, -50],
      [0, 0, 0, 1],
    ];
    const ref = reference(affine, [30, 40, 50]);
    const voxel = [7, 11, 23];
    const centre = [0, 1, 2].map(
      (r) => affine[r][0] * voxel[0] + affine[r][1] * voxel[1] + affine[r][2] * voxel[2] + affine[r][3],
    ) as [number, number, number];
    const nudged: [number, number, number] = [centre[0] + 0.3, centre[1] - 0.2, centre[2] + 0.25];
    const snapped = snapWorldToVoxelCentre(nudged, ref);
    snapped.forEach((v, i) => expect(v).toBeCloseTo(centre[i], 5));
    expect(worldToVoxelIndex(nudged, ref)).toEqual(voxel);
  });

  it('snaps to the lattice outside the grid (no clamping) and leaves non-finite input alone', () => {
    const outside = snapWorldToVoxelCentre([-200, 0, 0], MNI);
    expect(outside[0]).toBe(-199.5);
    expect(voxelIndexInBounds(worldToVoxelIndex(outside, MNI), MNI.dims)).toBe(false);
    expect(snapWorldToVoxelCentre([NaN, 0, 0], MNI)).toEqual([NaN, 0, 0]);
  });
});

describe('resolveVoxelGridReference', () => {
  const meta = (dims: [number, number, number]): VolumeMetadata => ({
    voxelToWorld: MNI.voxelToWorld,
    worldToVoxel: MNI.worldToVoxel,
    dimensions: dims,
  });

  it('uses the bottom-most volume layer with an affine, whatever is selected or visible', () => {
    const layers = [
      { id: 'no-affine', name: 'a', volumeId: 'v0' },
      { id: 't1', name: 'T1', volumeId: 'v1' },
      { id: 'zmap', name: 'z', volumeId: 'v2' },
    ];
    const metadata = new Map<string, VolumeMetadata>([
      ['no-affine', { dimensions: [1, 1, 1] }],
      ['t1', meta([96, 114, 96])],
      ['zmap', meta([10, 10, 10])],
    ]);
    const ref = resolveVoxelGridReference(layers, metadata);
    expect(ref?.layerId).toBe('t1');
    expect(ref?.dims).toEqual([96, 114, 96]);
  });

  it('is null without a volume affine', () => {
    expect(resolveVoxelGridReference([], new Map())).toBeNull();
    expect(resolveVoxelGridReference([{ id: 's', name: 's', volumeId: '' }], new Map())).toBeNull();
  });
});

describe('voxel-grid reference provider', () => {
  afterEach(() => setVoxelGridReferenceProvider(null));

  it('returns whatever the registered provider resolves', () => {
    setVoxelGridReferenceProvider(null);
    expect(currentVoxelGridReference()).toBeNull();
    setVoxelGridReferenceProvider(() => MNI);
    expect(currentVoxelGridReference()).toBe(MNI);
  });
});
