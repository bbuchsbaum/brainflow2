/**
 * Native-check export fixes: readable file names (no "_-") and "Crop to
 * brain" framing the anatomy whatever the load order.
 */
import { describe, expect, it } from 'vitest';
import {
  exportFileBase,
  layoutFileName,
  mosaicFileName,
  sliceFileName,
  surfaceFileName,
} from '@/utils/exportFileName';
import {
  cropBox,
  cropKind,
  cropVolumeIds,
  hiddenBandMagnitude,
  statisticCropBox,
  type CropKind,
} from '../compositeCapture';

describe('export file names (native check: "zmap_synthetic_axial_-10.0mm.png")', () => {
  it('puts the axis letter before the signed value for a slice', () => {
    expect(sliceFileName('zmap_synthetic.nii.gz', 'axial', -10, 'png')).toBe(
      'zmap_synthetic_axial_z-10.0mm.png',
    );
    expect(sliceFileName('zmap_synthetic.nii', 'coronal', -60, 'jpg')).toBe(
      'zmap_synthetic_coronal_y-60.0mm.jpg',
    );
    expect(sliceFileName('T1w (brain)', 'sagittal', 42, 'png')).toBe(
      'T1w_brain_sagittal_x42.0mm.png',
    );
    // Negative zero folds to zero.
    expect(sliceFileName('t1', 'axial', -0.01, 'png')).toBe('t1_axial_z0.0mm.png');
  });

  it('names the figure row, the orthogonal layout and a mosaic range the same way', () => {
    expect(layoutFileName('zmap_synthetic.nii', 'row', [42, -60, -10], 'png')).toBe(
      'zmap_synthetic_row_x42.0_y-60.0_z-10.0mm.png',
    );
    expect(layoutFileName('zmap_synthetic.nii', 'orthogonal', [0, -18, 18], 'png')).toBe(
      'zmap_synthetic_orthogonal_x0.0_y-18.0_z18.0mm.png',
    );
    expect(mosaicFileName('zmap_synthetic.nii', 'axial', -3, 11, 'png')).toBe(
      'zmap_synthetic_mosaic_axial_z-3.0_to_z11.0mm.png',
    );
  });

  it('never writes "_-", "__", leading or trailing separators, or unsafe characters', () => {
    const names = [
      sliceFileName('  my scan: run-1 .nii.gz', 'axial', -12.25, 'png'),
      layoutFileName('a/b\\c*?.nii', 'row', [-1, -2, -3], 'png'),
      mosaicFileName(null, 'coronal', -80, -20, 'jpg'),
      sliceFileName(null, 'axial', -5, 'png'),
    ];
    for (const name of names) {
      expect(name).not.toMatch(/_-|__|^[_.-]/);
      expect(name).toMatch(/^[A-Za-z0-9_.-]+$/);
    }
    expect(exportFileBase('', 'view')).toBe('view');
    expect(exportFileBase('___', 'view')).toBe('view');
  });

  it('names the hemispheres of a surface figure once (v1 visual 9)', () => {
    expect(surfaceFileName('sensorimotor.func (lh, rh)', 'lat_med', ['left', 'right'], 'png')).toBe(
      'sensorimotor.func_lat_med_lh_rh.png',
    );
    expect(surfaceFileName('lh.sensorimotor.func.gii', 'surface', ['left'], 'png')).toBe('sensorimotor.func_surface_lh.png');
    expect(surfaceFileName(null, 'surface', ['right'], 'jpg')).toBe('surface_surface_rh.jpg');
  });
});

describe('Crop to brain (native check: cropped to the overlay, cut into the head)', () => {
  // T1 head box and a small statistic box inside it (a z map nonzero only
  // in a central block), both 1 mm.
  const boxes: Record<string, { worldMinMm: number[]; worldMaxMm: number[] }> = {
    t1: { worldMinMm: [-70, -100, -60], worldMaxMm: [70, 70, 80] },
    z: { worldMinMm: [-40, -60, -10], worldMaxMm: [42, 40, 50] },
  };
  const fetch = {
    nonzero: async (id: string) => boxes[id] ?? null,
    bounds: async () => ({ min: [-96, -132, -78], max: [96, 96, 114], dims: [193, 229, 193] }),
  };
  const t1 = { id: 't1', volumeId: 't1', visible: true, opacity: 1 };
  const z = { id: 'z', volumeId: 'z', visible: true, opacity: 1 };

  // Round 3 R3-3 (deliberate change: was the union of the visible volumes, a
  // statistic counting only |v| above its display threshold): the crop is the
  // support of one volume — a brain mask, else the bottom anatomy, else the
  // bottom volume — never the rendered or thresholded pixels.
  const kinds: Record<string, CropKind> = { t1: 'anatomical', z: 'statistic', mask: 'mask' };
  const kindOf = (id: string | undefined) => kinds[id ?? ''] ?? 'anatomical';

  it('frames the head whichever end of the stack the anatomy is on', async () => {
    for (const layers of [
      [t1, z],
      [z, t1],
    ]) {
      const ids = cropVolumeIds(layers, kindOf);
      expect(ids).toEqual(['t1']);
      const box = await cropBox(ids, fetch);
      // The head box padded by half a voxel: never the overlay's box.
      expect(box!.worldMinMm).toEqual([-70.5, -100.5, -60.5]);
      expect(box!.worldMaxMm).toEqual([70.5, 70.5, 80.5]);
    }
  });

  it('a brain mask wins, visible or not; a statistic alone is its own crop volume', () => {
    const mask = { id: 'mask', volumeId: 'mask', visible: false, opacity: 0 };
    expect(cropVolumeIds([t1, z, mask], kindOf)).toEqual(['mask']);
    expect(cropVolumeIds([{ ...t1, visible: false }, z], kindOf)).toEqual(['t1']);
    // The z map as the only (base) layer (framed by statisticCropBox).
    expect(cropVolumeIds([z], kindOf)).toEqual(['z']);
    expect(cropVolumeIds([], kindOf)).toEqual([]);
  });

  it('classifies layers for the crop: mask by name token or binary flag, labels, statistics, anatomy', () => {
    expect(cropKind({ name: 'MNI152_T1_2mm_brain_mask.nii.gz' }, { isStatistic: false })).toBe('mask');
    expect(cropKind({ name: 'roi', sourcePath: '/d/sub-01_desc-brainmask.nii.gz' }, { isStatistic: false })).toBe('mask');
    expect(cropKind({ name: 'x' }, { isStatistic: false, isBinaryLike: true })).toBe('mask');
    expect(cropKind({ name: 'bold_masked.nii.gz' }, { isStatistic: false })).toBe('anatomical');
    expect(cropKind({ name: 'atlas', type: 'label' }, { isStatistic: false })).toBe('label');
    expect(cropKind({ name: 'p4_zmap.nii' }, { isStatistic: true })).toBe('statistic');
  });

  it('frames a statistic alone by its visible voxels with a margin, inside its support (native R4-3)', () => {
    const support = { worldMinMm: [-70, -100, -60], worldMaxMm: [70, 70, 80] };
    // Three small blobs left of the midline.
    const blobs = { worldMinMm: [-50, -20, 10], worldMaxMm: [-30, -16, 14] };
    const box = statisticCropBox(support, blobs);
    // x: 20 mm of blobs + 15 mm each side = 50 mm, under half the 140 mm
    // support, so 70 mm about the blobs' centre (-40), shifted inside.
    expect(box.worldMinMm[0]).toBeCloseTo(-70);
    expect(box.worldMaxMm[0]).toBeCloseTo(0);
    // y: half of 170 mm about -18.
    expect(box.worldMaxMm[1] - box.worldMinMm[1]).toBeCloseTo(85);
    expect(box.worldMinMm[1]).toBeCloseTo(-60.5);
    // Never outside the support; nothing visible keeps the support.
    for (let a = 0; a < 3; a += 1) {
      expect(box.worldMinMm[a]).toBeGreaterThanOrEqual(support.worldMinMm[a]);
      expect(box.worldMaxMm[a]).toBeLessThanOrEqual(support.worldMaxMm[a]);
    }
    expect(statisticCropBox(support, null)).toBe(support);
    // Blobs spanning most of the support keep the padded blob box.
    const wide = statisticCropBox(support, { worldMinMm: [-60, -90, -50], worldMaxMm: [60, 60, 70] });
    expect(wide).toEqual(support);
  });

  it('reads the hidden band from a symmetric threshold only', () => {
    expect(hiddenBandMagnitude([-3.1, 3.1])).toBeCloseTo(3.1);
    expect(hiddenBandMagnitude([-2, 3])).toBe(2);
    expect(hiddenBandMagnitude([0, 0])).toBe(0);
    expect(hiddenBandMagnitude([1, 5])).toBe(0);
    expect(hiddenBandMagnitude(undefined)).toBe(0);
  });

  it('is null (no crop) when no volume has a non-zero box', async () => {
    expect(await cropBox(['t1'], { ...fetch, nonzero: async () => null })).toBeNull();
  });
});

describe('export colorbar title wrap (round 3 S1)', () => {
  it('never breaks inside "(lh, rh)"', async () => {
    const { wrapAtBoundaries } = await import('../compositeExport');
    // One unit per character.
    const ctx = { measureText: (t: string) => ({ width: t.length }) as TextMetrics };
    expect(wrapAtBoundaries(ctx, 'sensorimotor.func (lh, rh)', 20, 2)).toEqual(['sensorimotor.func ', '(lh, rh)']);
    expect(wrapAtBoundaries(ctx, 'sensorimotor.func (lh, rh)', 23, 2)).toEqual(['sensorimotor.func ', '(lh, rh)']);
  });
});
