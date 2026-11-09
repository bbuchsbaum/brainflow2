import { describe, expect, it } from 'vitest';
import { sampleVolumeLabels } from '@brainflow/visualization/surface/projection';

const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
describe('shared nearest categorical volume sampling', () => {
  it('preserves sparse u32 IDs under a translated shear and half-voxel boundaries', () => {
    // Independently specified world=(i+j+10,j-7,k+5), x-fastest labels.
    const affine = new Float32Array([1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 10, -7, 5, 1]);
    const values = new Uint32Array([17, 16777217, 16777218, 4294967295, 4, 5, 6, 7]);
    const vertices = new Float32Array([
      10, -7, 5, 11, -7, 5, 11, -6, 5, 12, -6, 5, 9.5, -7, 5, 11.5, -7, 5, 9.4990234375, -7, 5,
      10.5, -7, 5, 10, -7, 6, 10, -7, 6.5, 11, -5.5, 5,
    ]);
    expect([...sampleVolumeLabels(vertices, values, [2, 2, 2], affine)]).toEqual([
      17, 16777217, 16777218, 4294967295, 17, 0, 0, 16777217, 4, 0, 0,
    ]);
  });
  it('uses the full rotated, anisotropic affine, including its negative axis', () => {
    // world=(10-2*j,-7+3*i,5+4*k), not a diagonal-only approximation.
    const affine = new Float32Array([0, 3, 0, 0, -2, 0, 0, 0, 0, 0, 4, 0, 10, -7, 5, 1]);
    const vertices = new Float32Array([10, -7, 5, 8, -4, 9, 8, -7, 5, 6, -7, 5]);
    expect([
      ...sampleVolumeLabels(
        vertices,
        new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]),
        [2, 2, 2],
        affine,
      ),
    ]).toEqual([1, 8, 3, 0]);
  });
  it('refuses malformed geometry, singular transforms and fractional labels', () => {
    const sample = (
      values: Float32Array,
      affine = identity,
      vertices = new Float32Array([0, 0, 0]),
    ) => sampleVolumeLabels(vertices, values, [1, 1, 1], affine);
    expect(() => sample(new Float32Array([1]), new Float32Array(16))).toThrow(/affine/);
    const singular = identity.slice();
    singular[0] = 0;
    expect(() => sample(new Float32Array([1]), singular)).toThrow(/invertible/);
    expect(() => sample(new Float32Array([1.5]))).toThrow(/integer labels/);
    expect(() => sample(new Float32Array([NaN]))).toThrow(/integer labels/);
    expect(() => sample(new Float32Array([-1]))).toThrow(/integer labels/);
    expect(() => sample(new Float32Array())).toThrow(/dimensions/);
    expect(() => sample(new Float32Array([1]), identity, new Float32Array([NaN, 0, 0]))).toThrow(
      /finite/,
    );
  });
});
