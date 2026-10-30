import { describe, expect, it } from 'vitest';
import {
  isSignedMap,
  looksLikeStatisticName,
  isSmallIntegerLabelMap,
  PlacementBand,
  placementBand,
  placementOrder,
  placementRole,
  planLayerPlacement,
  STACKED_CONTINUOUS_OPACITY,
  STACKED_OVERLAY_OPACITY,
  type PlacementLayer,
  type PlacementMetadata,
} from '../layerPlacement';

const t1: PlacementLayer = { id: 't1', type: 'anatomical', source: 'file' };
const t2: PlacementLayer = { id: 't2', type: 'anatomical', source: 'file' };
const z: PlacementLayer = { id: 'z', type: 'anatomical', statistic: { kind: 'z' } };
const atlas: PlacementLayer = { id: 'atlas', type: 'label', source: 'atlas' };
const mask: PlacementLayer = { id: 'mask', type: 'mask', source: 'file' };
const brain: PlacementLayer = { id: 'brain', type: 'mask', source: 'template' };
const bold: PlacementLayer = { id: 'bold', type: 'functional', volumeType: 'TimeSeries4D' };
const beta: PlacementLayer = { id: 'beta', type: 'anatomical', source: 'file' };
const meta: Record<string, PlacementMetadata> = {
  beta: { dataRange: { min: -3.2, max: 4.1 } },
  bold: { dataRange: { min: 0, max: 1200 } },
  brain: { isBinaryLike: false },
};
const metaOf = (id: string) => meta[id];

describe('placementRole', () => {
  it('anatomy, templates and EPI are underlays', () => {
    expect(placementRole(t1)).toBe('underlay');
    expect(placementRole(bold, meta.bold)).toBe('underlay');
    // A skull-stripped template brain is typed 'mask' but is an image.
    expect(placementRole(brain, meta.brain)).toBe('underlay');
  });

  it('statistics, labels, atlases, file masks and signed maps are overlays', () => {
    expect(placementRole(z)).toBe('overlay');
    expect(placementRole(atlas)).toBe('overlay');
    expect(placementRole({ id: 'seg', type: 'anatomical', isLabelMap: true })).toBe('overlay');
    expect(placementRole(mask)).toBe('overlay');
    expect(placementRole({ ...brain, id: 'bin' }, { isBinaryLike: true })).toBe('overlay');
    expect(placementRole(beta, meta.beta)).toBe('overlay');
  });
});

describe('planLayerPlacement / placementOrder', () => {
  it('puts a new underlay directly below the lowest overlay', () => {
    expect(placementOrder([atlas, z, t1], 't1')).toEqual(['t1', 'atlas', 'z']);
    expect(placementOrder([t1, z, t2], 't2')).toEqual(['t1', 't2', 'z']);
    expect(placementOrder([z, atlas, bold], 'bold', metaOf)).toEqual(['bold', 'z', 'atlas']);
  });

  it('puts a new underlay on top when there is no overlay', () => {
    expect(placementOrder([t1, t2], 't2')).toBeNull();
    expect(planLayerPlacement([t1], t2).index).toBe(1);
  });

  it('puts overlays over the images, statistics under labels', () => {
    expect(placementOrder([t1, z], 'z')).toBeNull();
    expect(placementOrder([t1, atlas, beta], 'beta', metaOf)).toEqual(['t1', 'beta', 'atlas']);
  });

  it('starts a categorical overlay over a visible overlay translucent', () => {
    expect(planLayerPlacement([t1, z], atlas)).toEqual({ index: 2, opacity: STACKED_OVERLAY_OPACITY });
    expect(planLayerPlacement([t1, atlas], mask)).toEqual({ index: 2, opacity: STACKED_OVERLAY_OPACITY });
  });

  it('keeps full opacity for a statistic, a first overlay, or over a hidden one', () => {
    expect(planLayerPlacement([t1, atlas], z)).toEqual({ index: 1 });
    expect(planLayerPlacement([t1], atlas)).toEqual({ index: 1 });
    expect(planLayerPlacement([t1, { ...z, visible: false }], atlas)).toEqual({ index: 2 });
  });
});

describe('isSignedMap (review W4)', () => {
  it('needs a substantial negative tail', () => {
    expect(isSignedMap({ min: -3.2, max: 4.1 })).toBe(true);
    expect(isSignedMap({ min: -5, max: 0 })).toBe(true);
    // A T1 or bias-corrected image with a few negative voxels.
    expect(isSignedMap({ min: -40, max: 1200 })).toBe(false);
    // CT in Hounsfield units.
    expect(isSignedMap({ min: -1024, max: 3071 })).toBe(false);
    expect(isSignedMap({ min: 0, max: 10 })).toBe(false);
    expect(isSignedMap(undefined)).toBe(false);
  });

  it('keeps negative-valued anatomy and CT as underlays', () => {
    const ct: PlacementLayer = { id: 'ct', type: 'anatomical', source: 'file' };
    expect(placementRole(ct, { dataRange: { min: -1024, max: 3071 } })).toBe('underlay');
    expect(placementRole(t1, { dataRange: { min: -12, max: 900 } })).toBe('underlay');
    expect(placementOrder([z, ct], 'ct', () => ({ dataRange: { min: -1024, max: 3071 } }))).toEqual(['ct', 'z']);
  });
});

describe('statistic signals beat the value range', () => {
  const range = { dataRange: { min: -2.5, max: 6.1 } };

  it('a mostly-positive z map with a statistic intent is a statistic', () => {
    const zmap: PlacementLayer = { id: 'zmap', type: 'anatomical', source: 'file', statistic: { kind: 'z' } };
    expect(isSignedMap(range.dataRange)).toBe(false);
    expect(placementRole(zmap, range)).toBe('overlay');
    expect(placementOrder([t1, zmap], 'zmap', () => range)).toBeNull();
    expect(placementOrder([atlas, zmap], 'zmap', () => range)).toEqual(['zmap', 'atlas']);
  });

  it('so does one named like a statistic map without an intent', () => {
    const spm: PlacementLayer = { id: 'spm', type: 'anatomical', source: 'file', name: 'spmT_0001', sourcePath: '/d/spmT_0001.nii' };
    expect(placementRole(spm, range)).toBe('overlay');
    for (const name of ['faces_zmap.nii.gz', 'cope1_tstat2.nii', 'sub-01_zscore.nii', 'spmF_0002.nii']) {
      expect(looksLikeStatisticName({ sourcePath: `/d/${name}` })).toBe(true);
    }
    for (const name of ['sub-01_T1w.nii.gz', 'mni_template.nii', 'tmax.nii', 'zebra.nii']) {
      expect(looksLikeStatisticName({ sourcePath: `/d/${name}` })).toBe(false);
    }
  });
});

describe('bands (QA design decisions 2026-10-30 §2)', () => {
  const mean: PlacementLayer = { id: 'mean', type: 'functional', name: 'mean_bold' };
  const z2: PlacementLayer = { id: 'z2', type: 'anatomical', statistic: { kind: 'z' } };
  const atlas2: PlacementLayer = { id: 'atlas2', type: 'label', source: 'atlas' };
  const ids = (layers: PlacementLayer[]) => layers.map((layer) => layer.id);
  /** Opens `layers` one at a time, as loads do, and returns the stack. */
  function openInOrder(layers: PlacementLayer[], metadataOf = metaOf): PlacementLayer[] {
    let stack: PlacementLayer[] = [];
    for (const layer of layers) {
      const { index } = planLayerPlacement(stack, layer, metadataOf);
      stack = [...stack.slice(0, index), layer, ...stack.slice(index)];
    }
    return stack;
  }

  it('assigns anatomy, other continuous, statistic and label bands', () => {
    expect(placementBand(t1)).toBe(PlacementBand.Anatomy);
    expect(placementBand(brain, meta.brain)).toBe(PlacementBand.Anatomy);
    expect(placementBand(bold, meta.bold)).toBe(PlacementBand.Continuous);
    expect(placementBand(mean)).toBe(PlacementBand.Continuous);
    expect(placementBand(z)).toBe(PlacementBand.Statistic);
    expect(placementBand(beta, meta.beta)).toBe(PlacementBand.Statistic);
    expect(placementBand(atlas)).toBe(PlacementBand.Label);
    expect(placementBand(mask)).toBe(PlacementBand.Label);
    // A cluster mask named after its statistic is still a mask.
    expect(placementBand({ id: 'cm', type: 'mask', name: 'cluster_mask_zstat1' })).toBe(PlacementBand.Label);
  });

  it('sorts any load order into bands, bottom to top', () => {
    const orders = [
      [atlas, z, bold, t1],
      [t1, bold, z, atlas],
      [z, atlas, t1, bold],
      [bold, atlas, t1, z],
    ];
    for (const order of orders) {
      expect(ids(openInOrder(order))).toEqual(['t1', 'bold', 'z', 'atlas']);
    }
  });

  it('puts the newest layer on top within its band', () => {
    expect(ids(openInOrder([t1, z, atlas, t2]))).toEqual(['t1', 't2', 'z', 'atlas']);
    expect(ids(openInOrder([t1, bold, z, mean]))).toEqual(['t1', 'bold', 'mean', 'z']);
    expect(ids(openInOrder([t1, z, atlas, z2]))).toEqual(['t1', 'z', 'z2', 'atlas']);
    expect(ids(openInOrder([t1, atlas, z, atlas2]))).toEqual(['t1', 'z', 'atlas', 'atlas2']);
  });

  describe('a layer the user moved', () => {
    it('is never re-sorted', () => {
      // The user dragged the atlas under the T1.
      const stack = [{ ...atlas, userMoved: true }, t1, z];
      expect(placementOrder(stack, 'atlas')).toBeNull();
    });

    it('keeps its neighbours: new loads go by the bands of the rule-placed layers', () => {
      // Atlas moved between the T1 and the z map.
      const stack = [t1, { ...atlas, userMoved: true }, z];
      expect(placementOrder([...stack, t2], 't2')).toEqual(['t1', 't2', 'atlas', 'z']);
      expect(placementOrder([...stack, z2], 'z2')).toBeNull();
      expect(placementOrder([...stack, bold], 'bold', metaOf)).toEqual(['t1', 'bold', 'atlas', 'z']);
      expect(placementOrder([...stack, atlas2], 'atlas2')).toBeNull();
    });

    it('a new layer with no rule-placed layer at or below its band goes to the bottom', () => {
      // z moved to the bottom; the T1 is the only rule-placed layer.
      const stack = [{ ...z, userMoved: true }, bold];
      expect(placementOrder([...stack, t1], 't1', metaOf)).toEqual(['t1', 'z', 'bold']);
      expect(placementOrder([...stack, atlas], 'atlas', metaOf)).toBeNull();
    });

    it('only when every layer was moved do their own bands decide', () => {
      const stack = [{ ...t1, userMoved: true }, { ...z, userMoved: true }];
      expect(placementOrder([...stack, t2], 't2')).toEqual(['t1', 't2', 'z']);
      expect(placementOrder([...stack, atlas], 'atlas')).toBeNull();
      expect(placementOrder([{ ...atlas, userMoved: true }, t2], 't2')).toEqual(['t2', 'atlas']);
      expect(planLayerPlacement([{ ...atlas, userMoved: true }], t2).index).toBe(0);
    });
  });
});

describe('opacity of a new layer', () => {
  const mean: PlacementLayer = { id: 'mean', type: 'functional' };

  it('a continuous layer on a visible layer of its own band opens at 50 %', () => {
    expect(planLayerPlacement([t1], t2)).toEqual({ index: 1, opacity: STACKED_CONTINUOUS_OPACITY });
    expect(planLayerPlacement([t1, bold, z], mean, metaOf)).toEqual({ index: 2, opacity: STACKED_CONTINUOUS_OPACITY });
    // Below overlays, still on a T1.
    expect(planLayerPlacement([t1, z, atlas], t2)).toEqual({ index: 1, opacity: STACKED_CONTINUOUS_OPACITY });
  });

  it('opens at full opacity on another band, a hidden layer, or nothing', () => {
    expect(planLayerPlacement([t1], bold, metaOf)).toEqual({ index: 1 });
    expect(planLayerPlacement([bold], t1, metaOf)).toEqual({ index: 0 });
    expect(planLayerPlacement([{ ...t1, visible: false }], t2)).toEqual({ index: 1 });
    expect(planLayerPlacement([z, atlas], t1)).toEqual({ index: 0 });
    expect(planLayerPlacement([], t1)).toEqual({ index: 0 });
  });

  it('keeps the 60 % label-over-overlay rule and full-opacity statistics', () => {
    expect(planLayerPlacement([t1, atlas], { ...atlas, id: 'atlas2' })).toEqual({ index: 2, opacity: STACKED_OVERLAY_OPACITY });
    expect(planLayerPlacement([t1, z], { id: 'z2', statistic: { kind: 'z' } })).toEqual({ index: 2 });
    // A label over anatomy only: full opacity.
    expect(planLayerPlacement([t1, t2], atlas)).toEqual({ index: 2 });
  });
});

describe('review W2: masks and label maps by their data, not their name', () => {
  const file = (id: string): PlacementLayer => ({ id, type: 'anatomical', source: 'file', name: id });

  it('a binary image is a mask whatever its name or source', () => {
    expect(placementBand(file('lesion'), { isBinaryLike: true })).toBe(PlacementBand.Label);
    expect(placementBand(file('roi_amygdala'), { isBinaryLike: true })).toBe(PlacementBand.Label);
    expect(placementBand({ ...brain, id: 'bm' }, { isBinaryLike: true })).toBe(PlacementBand.Label);
    // Non-binary template tissue maps and brains stay images.
    expect(placementBand(brain, { isBinaryLike: false })).toBe(PlacementBand.Anatomy);
    expect(placementBand({ id: 'gm', type: 'mask', source: 'template' })).toBe(PlacementBand.Anatomy);
  });

  it('a binary lesion opened over a z map goes above it at the label opacity', () => {
    const lesion = file('lesion');
    const metadataOf = (id: string) => (id === 'lesion' ? { isBinaryLike: true } : undefined);
    expect(planLayerPlacement([t1, z], lesion, metadataOf)).toEqual({ index: 2, opacity: STACKED_OVERLAY_OPACITY });
  });

  it('an integer image with a few small ids is a label map; integer anatomy is not', () => {
    const roi = { nativeDtype: 'u8', dataRange: { min: 0, max: 3 } };
    expect(isSmallIntegerLabelMap(roi)).toBe(true);
    expect(placementBand(file('rois'), roi)).toBe(PlacementBand.Label);
    expect(isSmallIntegerLabelMap({ nativeDtype: 'i16', dataRange: { min: 0, max: 64 } })).toBe(true);
    // A uint8 T1, an int16 CT, a float map and an unknown type stay images.
    expect(placementBand(file('t1u8'), { nativeDtype: 'u8', dataRange: { min: 0, max: 255 } })).toBe(PlacementBand.Anatomy);
    expect(isSmallIntegerLabelMap({ nativeDtype: 'i16', dataRange: { min: -1024, max: 30 } })).toBe(false);
    expect(isSmallIntegerLabelMap({ nativeDtype: 'float32', dataRange: { min: 0, max: 3 } })).toBe(false);
    expect(isSmallIntegerLabelMap({ dataRange: { min: 0, max: 3 } })).toBe(false);
    // A template is never re-read as labels.
    expect(placementBand({ id: 'tpl', type: 'anatomical', source: 'template' }, roi)).toBe(PlacementBand.Anatomy);
  });
});

describe('review W3: signed functional and 4D images stay continuous', () => {
  const signed = { dataRange: { min: -4, max: 4 } };

  it('demeaned or z-scored BOLD is continuous, a signed 3D map a statistic', () => {
    expect(placementBand({ id: 'dm', volumeType: 'TimeSeries4D' }, signed)).toBe(PlacementBand.Continuous);
    expect(placementBand({ id: 'f', type: 'functional' }, signed)).toBe(PlacementBand.Continuous);
    expect(placementBand(beta, signed)).toBe(PlacementBand.Statistic);
  });

  it('a 4D image declared or named as a statistic is still a statistic', () => {
    expect(placementBand({ id: 's', volumeType: 'TimeSeries4D', statistic: { kind: 'z' } }, signed)).toBe(PlacementBand.Statistic);
    expect(placementBand({ id: 'n', volumeType: 'TimeSeries4D', name: 'run1_zstat' }, signed)).toBe(PlacementBand.Statistic);
  });

  it('a signed BOLD run opened over a T1 and a z map goes under the z map', () => {
    const dm: PlacementLayer = { id: 'dm', type: 'functional', volumeType: 'TimeSeries4D' };
    expect(placementOrder([t1, z, dm], 'dm', (id) => (id === 'dm' ? signed : undefined))).toEqual(['t1', 'dm', 'z']);
  });
});
