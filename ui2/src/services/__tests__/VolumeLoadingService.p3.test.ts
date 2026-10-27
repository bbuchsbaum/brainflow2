import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/apiService', () => ({ getApiService: () => ({}) }));

import { defaultCrosshairWorld, mayHaveLabelTable } from '../VolumeLoadingService';

describe('defaultCrosshairWorld', () => {
  it('prefers the voxel-centred centre over the geometric one', () => {
    expect(
      defaultCrosshairWorld({
        min: [-95.5, -131.5, -77.5],
        max: [94.5, 94.5, 112.5],
        center: [-0.5, -18.5, 17.5],
        dims: [96, 114, 96],
        center_voxel_world: [-1.5, -19.5, 16.5],
      }),
    ).toEqual([-1.5, -19.5, 16.5]);
  });

  it('falls back to the geometric centre for older backends', () => {
    expect(
      defaultCrosshairWorld({ min: [0, 0, 0], max: [2, 2, 2], center: [1, 1, 1], dims: [2, 2, 2] }),
    ).toEqual([1, 1, 1]);
  });
});

describe('mayHaveLabelTable', () => {
  it('checks label layers and label intents only, never a plain integer image (review D3)', () => {
    expect(mayHaveLabelTable('label', { dtype: 'f32' })).toBe(true);
    expect(mayHaveLabelTable('volume', { dtype: 'i16', is_label_map: true })).toBe(true);
    // An int16 T1 or uint8 BOLD run is not sniffed for a sidecar.
    expect(mayHaveLabelTable('volume', { dtype: 'u8' })).toBe(false);
    expect(mayHaveLabelTable('volume', { dtype: 'i16' })).toBe(false);
    expect(mayHaveLabelTable('volume', { dtype: 'f32' })).toBe(false);
  });
});
