import { describe, expect, it } from 'vitest';
import {
  isAffine4x4,
  transformVoxelToWorldColumnMajor,
  transformWorldToVoxelColumnMajor,
} from '../voxelTransform';

describe('transformWorldToVoxelColumnMajor', () => {
  it('handles identity matrices', () => {
    const matrix = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];

    expect(transformWorldToVoxelColumnMajor(matrix, [4, 5, 6])).toEqual([4, 5, 6]);
  });

  it('handles translation encoded in column-major order', () => {
    const matrix = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      -10, 20, 5, 1,
    ];

    expect(transformWorldToVoxelColumnMajor(matrix, [12, 4, 8])).toEqual([2, 24, 13]);
  });

  it('handles scaling and translation for non-identity affines', () => {
    const matrix = [
      0.5, 0, 0, 0,
      0, 2, 0, 0,
      0, 0, -1, 0,
      3, -4, 7, 1,
    ];

    expect(transformWorldToVoxelColumnMajor(matrix, [10, 3, 8])).toEqual([8, 2, -1]);
  });
});

describe('transformVoxelToWorldColumnMajor', () => {
  it('maps voxel indices through a column-major voxel_to_world and round-trips with its inverse', () => {
    // x = -2 i + 90, y = 2 j - 126, z = 2 k - 72 (column-major flattening).
    const v2w = [-2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 90, -126, -72, 1];
    const w2v = [-0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0.5, 0, 45, 63, 36, 1];
    expect(transformVoxelToWorldColumnMajor(v2w, [45, 63, 54])).toEqual([0, 0, 36]);
    expect(transformWorldToVoxelColumnMajor(w2v, transformVoxelToWorldColumnMajor(v2w, [10, 20, 30]))).toEqual([
      10, 20, 30,
    ]);
  });

  it('isAffine4x4 rejects short or non-finite matrices', () => {
    expect(isAffine4x4(new Array(16).fill(1))).toBe(true);
    expect(isAffine4x4([1, 2, 3])).toBe(false);
    expect(isAffine4x4([...new Array(15).fill(1), Number.NaN])).toBe(false);
    expect(isAffine4x4(undefined)).toBe(false);
  });
});
