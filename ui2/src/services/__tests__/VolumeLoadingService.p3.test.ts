import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/apiService', () => ({ getApiService: () => ({}) }));

import {
  applyStackedOverlayOpacity,
  anatomyUnderStatisticOrder,
  defaultCrosshairWorld,
  mayHaveLabelTable,
  startsAtVolumeFrame,
} from '../VolumeLoadingService';
import { useLayerStore, type LayerInfo } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { STACKED_CONTINUOUS_OPACITY, STACKED_OVERLAY_OPACITY } from '@/services/layerPlacement';

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
    expect(anatomyUnderStatisticOrder(at(t1), 't1')).toBeNull();
  });

  it('puts an EPI run under a statistic too (QA 2026-10-29 §5.2: the 4D BOLD covered the overlays)', () => {
    const bold = { id: 'bold', name: 'bold', type: 'anatomical', volumeType: 'TimeSeries4D' };
    expect(anatomyUnderStatisticOrder(at(z, bold), 'bold')).toEqual(['bold', 'z']);
  });
});

describe('applyStackedOverlayOpacity (review W9)', () => {
  it('gives a label map found by its sidecar the stacked opacity, once', () => {
    useLayerStore.getState().clearLayers();
    const base = { volumeId: 'x', type: 'anatomical', visible: true, order: 0 };
    useLayerStore.getState().addLayer({ ...base, id: 'z', name: 'z', statistic: { kind: 'z' } } as unknown as LayerInfo);
    useLayerStore.getState().addLayer({ ...base, id: 'seg', name: 'seg', isLabelMap: true } as unknown as LayerInfo);
    useViewStateStore.getState().setViewState((state) => {
      state.layers = [
        { id: 'z', opacity: 1, visible: true },
        { id: 'seg', opacity: 1, visible: true },
      ] as typeof state.layers;
    });

    applyStackedOverlayOpacity('seg');
    const opacityOf = (id: string) => useViewStateStore.getState().viewState.layers.find((l) => l.id === id)?.opacity;
    expect(opacityOf('seg')).toBe(STACKED_OVERLAY_OPACITY);
    expect(opacityOf('z')).toBe(1);

    // A user-set opacity is never overridden.
    useViewStateStore.getState().setViewState((state) => {
      state.layers[1].opacity = 0.9;
    });
    applyStackedOverlayOpacity('seg');
    expect(opacityOf('seg')).toBe(0.9);
  });
});

describe('applyStackedOverlayOpacity: continuous on continuous (QA decisions §2)', () => {
  it('gives a second anatomy over a visible one 50 %', () => {
    useLayerStore.getState().clearLayers();
    const base = { volumeId: 'x', type: 'anatomical', visible: true, order: 0 };
    useLayerStore.getState().addLayer({ ...base, id: 't1', name: 'T1w' } as unknown as LayerInfo);
    useLayerStore.getState().addLayer({ ...base, id: 'mni', name: 'MNI152', source: 'template' } as unknown as LayerInfo);
    useViewStateStore.getState().setViewState((state) => {
      state.layers = [
        { id: 't1', opacity: 1, visible: true },
        { id: 'mni', opacity: 1, visible: true },
      ] as typeof state.layers;
    });
    useLayerStore.getState().setLayerMetadata('mni', { renderProps: { opacity: 1, intensity: [0, 1], threshold: [0, 0], colormap: 'gray', interpolation: 'linear' } });
    applyStackedOverlayOpacity('mni');
    const opacityOf = (id: string) => useViewStateStore.getState().viewState.layers.find((l) => l.id === id)?.opacity;
    expect(opacityOf('mni')).toBe(STACKED_CONTINUOUS_OPACITY);
    expect(opacityOf('t1')).toBe(1);
    // Review minor 8: the layer's default render properties agree.
    expect(useLayerStore.getState().getLayerMetadata('mni')?.renderProps?.opacity).toBe(STACKED_CONTINUOUS_OPACITY);
  });
});

describe('startsAtVolumeFrame (QA 2026-10-30 F34)', () => {
  const kinds: Record<string, { volumeType?: string }> = { t1: {}, run1: { volumeType: 'TimeSeries4D' } };
  const layerOf = (id: string) => kinds[id];
  it('a 4D layer starts at its own frame unless another shown series owns the frame', () => {
    expect(startsAtVolumeFrame({ layers: [] }, layerOf)).toBe(true);
    // Frame 8 left over from a series no longer shown.
    expect(startsAtVolumeFrame({ timepoint: 8, layers: [{ id: 't1' }] }, layerOf)).toBe(true);
    expect(startsAtVolumeFrame({ timepoint: 8, layers: [{ id: 't1' }, { id: 'run1' }] }, layerOf)).toBe(false);
  });
});
