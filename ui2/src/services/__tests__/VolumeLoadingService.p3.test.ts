import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/apiService', () => ({ getApiService: () => ({}) }));

import {
  anatomyUnderStatisticOrder,
  defaultCrosshairWorld,
  mayHaveLabelTable,
} from '../VolumeLoadingService';
import type { LayerInfo } from '@/stores/layerStore';

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

describe('anatomyUnderStatisticOrder', () => {
  const z = { id: 'z', name: 'p4_zmap', type: 'anatomical', statistic: { kind: 'z' } };
  const t1 = { id: 't1', name: 'T1w', type: 'anatomical' };
  const at = (...layers: object[]) => layers as unknown as LayerInfo[];

  it('puts a T1 opened after a z map under it (native R4-3)', () => {
    expect(anatomyUnderStatisticOrder(at(z, t1), 't1')).toEqual(['t1', 'z']);
    const atlas = { id: 'atlas', name: 'Atlas', type: 'label', source: 'atlas' };
    expect(anatomyUnderStatisticOrder(at(atlas, z, t1), 't1')).toEqual(['t1', 'atlas', 'z']);
  });

  it('keeps the order when the base is not a statistic or the new layer is not plain anatomy', () => {
    expect(anatomyUnderStatisticOrder(at(t1, z), 'z')).toBeNull();
    const t2 = { id: 't2', name: 'T2w', type: 'anatomical' };
    expect(anatomyUnderStatisticOrder(at(t1, t2), 't2')).toBeNull();
    const z2 = { ...z, id: 'z2' };
    expect(anatomyUnderStatisticOrder(at(z, z2), 'z2')).toBeNull();
    const seg = { id: 'seg', name: 'aseg', type: 'label', isLabelMap: true };
    expect(anatomyUnderStatisticOrder(at(z, seg), 'seg')).toBeNull();
    const bold = { id: 'bold', name: 'bold', type: 'anatomical', volumeType: 'TimeSeries4D' };
    expect(anatomyUnderStatisticOrder(at(z, bold), 'bold')).toBeNull();
    expect(anatomyUnderStatisticOrder(at(t1), 't1')).toBeNull();
  });
});
