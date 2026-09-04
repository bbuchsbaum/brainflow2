import { describe, expect, it } from 'vitest';
import { anatomicalLabels } from '../anatomicalLabels';

describe('anatomical labels follow affine world view axes', () => {
  it('labels positive X to the right without confusing negative voxel spacing with handedness', () => {
    expect(anatomicalLabels({ u_mm: [2, 0, 0], v_mm: [0, -2, 0] })).toEqual({
      left: 'L',
      right: 'R',
      top: 'A',
      bottom: 'P',
    });
    expect(anatomicalLabels({ u_mm: [-2, 0, 0], v_mm: [0, -2, 0] })).toEqual({
      left: 'R',
      right: 'L',
      top: 'A',
      bottom: 'P',
    });
  });
  it('labels sagittal and coronal superior directions from their actual bases', () => {
    expect(anatomicalLabels({ u_mm: [0, -1, 0], v_mm: [0, 0, -1] })).toEqual({
      left: 'A',
      right: 'P',
      top: 'S',
      bottom: 'I',
    });
    expect(anatomicalLabels({ u_mm: [1, 0, 0], v_mm: [0, 0, -1] })).toEqual({
      left: 'L',
      right: 'R',
      top: 'S',
      bottom: 'I',
    });
  });
});
