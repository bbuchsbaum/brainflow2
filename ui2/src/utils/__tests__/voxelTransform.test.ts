import { describe, expect, it } from 'vitest';
import { transformWorldToVoxelColumnMajor } from '../voxelTransform';

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
