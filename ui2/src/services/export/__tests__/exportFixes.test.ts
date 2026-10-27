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
import { cropBox, cropVolumeIds } from '../compositeCapture';

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

  it('frames the head whichever end of the stack the anatomy is on', async () => {
    for (const layers of [
      [t1, z],
      [z, t1],
    ]) {
      const ids = cropVolumeIds(layers);
      expect(new Set(ids)).toEqual(new Set(['t1', 'z']));
      const box = await cropBox(ids, fetch);
      // The head box padded by half a voxel: never the overlay's box.
      expect(box!.worldMinMm).toEqual([-70.5, -100.5, -60.5]);
      expect(box!.worldMaxMm).toEqual([70.5, 70.5, 80.5]);
    }
  });

  it('keeps statistic voxels outside the anatomy in the frame (the union)', async () => {
    const wide = {
      ...fetch,
      nonzero: async (id: string) =>
        id === 'z' ? { worldMinMm: [-90, -60, -10], worldMaxMm: [42, 40, 50] } : boxes[id],
    };
    const box = await cropBox(cropVolumeIds([t1, z]), wide);
    expect(box!.worldMinMm[0]).toBe(-90.5);
    expect(box!.worldMaxMm[0]).toBe(70.5);
  });

  it('ignores hidden layers, and falls back to the bottom volume when none is visible', () => {
    expect(cropVolumeIds([t1, { ...z, visible: false }])).toEqual(['t1']);
    expect(cropVolumeIds([{ ...z, opacity: 0 }, t1])).toEqual(['t1']);
    expect(
      cropVolumeIds([
        { ...t1, visible: false },
        { ...z, visible: false },
      ]),
    ).toEqual(['t1']);
    expect(cropVolumeIds([])).toEqual([]);
  });

  it('is null (no crop) when no volume has a non-zero box', async () => {
    expect(await cropBox(['t1'], { ...fetch, nonzero: async () => null })).toBeNull();
  });
});

describe('crop thresholds (a dense noisy statistic must not widen the crop)', () => {
  it('statistic layers count |v| above their display threshold; anatomy and labels every non-zero voxel', async () => {
    const { cropThresholdsByVolume } = await import('../compositeCapture');
    const map = cropThresholdsByVolume(
      [
        { id: 't1', volumeId: 'v-t1', threshold: [0, 0] },
        { id: 'z', volumeId: 'v-z', threshold: [-3.1, 3.1] },
        { id: 'atlas', volumeId: 'v-atlas', threshold: [0, 0] },
      ],
      (id) => id === 'z',
    );
    expect(map.get('v-t1')).toBe(0);
    expect(map.get('v-z')).toBeCloseTo(3.1, 9);
    expect(map.get('v-atlas')).toBe(0);
  });
});
