import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/apiService', () => ({ getApiService: () => ({}) }));

import { HOT_ROBUST_HIGH, overlayDisplay } from '../LayerApiImpl';
import { useLayerStore } from '@/stores/layerStore';

const range = {
  intensity: [0.09, 1.05] as [number, number],
  threshold: [0, 0] as [number, number],
  suggestedColormap: undefined,
};
const fourD = { id: 'fir', type: 'volume', timeSeriesInfo: { num_timepoints: 8 } };
const overT1 = () =>
  useLayerStore.setState({
    layers: [
      { id: 't1', name: 'T1', volumeId: 't1', type: 'volume', visible: true, order: 0 },
      {
        id: 'fir',
        name: 'fir',
        volumeId: 'fir',
        type: 'volume',
        visible: true,
        order: 1,
        timeSeriesInfo: { num_timepoints: 8 },
      },
    ],
  } as never);
const lutOf = (shown: { intensity: [number, number] }) => (v: number) =>
  (v - shown.intensity[0]) / (shown.intensity[1] - shown.intensity[0]);

describe('a 4D series display (v1 G4, round 2 R3, round 3 F1)', () => {
  beforeEach(overT1);

  it('a signed map over another volume: hot ramp, below-window hidden, window inside the data', () => {
    const shown = overlayDisplay(fourD, range, { min: -0.1, max: 2.4 }, false);
    expect(shown).toMatchObject({ suggestedColormap: 'hot', threshold: [-0.1, 0.09] });
    expect(shown.intensity[0]).toBeGreaterThanOrEqual(-0.1);
    expect(shown.intensity[1]).toBeLessThanOrEqual(2.4);
  });

  it('with the all-frame histogram of a FIR map: the near-zero bulk hidden, the lowest visible above black, the peak not clipped', () => {
    // 100,000 values: the bulk in −0.1..0.1, a focal response 2..2.5.
    const bins = [
      { x0: -0.1, x1: 0.1, count: 99990 },
      { x0: 0.1, x1: 2, count: 0 },
      { x0: 2, x1: 2.5, count: 10 },
    ];
    const shown = overlayDisplay(
      fourD,
      { intensity: [-0.1, 0.1], threshold: [0, 0] },
      { min: -0.1, max: 2.5 },
      false,
      {
        bins,
        totalCount: 100000,
        minValue: -0.1,
        maxValue: 2.5,
      },
    );
    const lut = lutOf(shown);
    expect(shown.suggestedColormap).toBe('hot');
    expect(shown.threshold[1]).toBeGreaterThan(0.1);
    // Dark red, not the near-black ring of v1 (hot LUT red ramps over 0..0.365).
    expect(lut(shown.threshold[1])).toBeGreaterThan(0.12);
    expect(lut(2.5)).toBeLessThanOrEqual(1);
    expect(lut(2.0)).toBeGreaterThan(HOT_ROBUST_HIGH - 0.2);
    // Data-domain window ends only (no LUT placement values outside the data).
    expect(shown.intensity[0]).toBeGreaterThanOrEqual(-0.1);
    expect(shown.intensity[1]).toBeLessThanOrEqual(2.5);
  });

  it('a BOLD run is an EPI image: greyscale, never a sub-bin window (multirun run 2: 102 → 122)', () => {
    // The brain at baseline 102 in every frame, a 27-voxel block peaking at 122.
    const bins = [
      { x0: 102, x1: 102.08, count: 500000 },
      { x0: 102.08, x1: 122, count: 27 * 24 },
    ];
    const run = { ...fourD, id: 'run2', name: 'Faces BOLD (sub-01, run-2)' };
    const shown = overlayDisplay(
      run,
      { intensity: [102, 102.007], threshold: [0, 0] },
      { min: 0, max: 122 },
      false,
      {
        bins,
        totalCount: 500000 + 27 * 24,
        minValue: 102,
        maxValue: 122,
      },
    );
    expect(shown.suggestedColormap).toBe('gray');
    expect(shown.threshold).toEqual([0, 0]);
    expect(shown.intensity).toEqual([102, 122]);
  });

  it('an unnamed EPI with a noisy background (swraf*.nii) is an image, not a hot overlay (REVIEW M3)', () => {
    // 60% background noise 0.5–20, the brain 600–1200: p2 near 0, all positive.
    const bins = [
      { x0: 0.5, x1: 20, count: 6000 },
      { x0: 600, x1: 900, count: 2000 },
      { x0: 900, x1: 1200, count: 2000 },
    ];
    const run = { ...fourD, name: 'swrafunc', sourcePath: '/spm/swrafunc.nii' };
    const shown = overlayDisplay(run, range, { min: 0, max: 1200 }, false, { bins, totalCount: 10000, minValue: 0.5, maxValue: 1200 });
    expect(shown.suggestedColormap).toBe('gray');
    expect(shown.threshold).toEqual([0, 0]);
    // A lower-case "bold" in the layer name counts too.
    expect(overlayDisplay({ ...fourD, name: 'func_bold_mcf' }, range, { min: -1, max: 2 }, false).suggestedColormap).toBe('gray');
  });

  it('a positive large-baseline series is BOLD-like by its values, without the name', () => {
    const bins = Array.from({ length: 10 }, (_, i) => ({
      x0: 900 + i * 40,
      x1: 940 + i * 40,
      count: 1000,
    }));
    const shown = overlayDisplay(fourD, range, { min: 0, max: 1300 }, false, {
      bins,
      totalCount: 10000,
      minValue: 900,
      maxValue: 1300,
    });
    expect(shown.suggestedColormap).toBe('gray');
    expect(shown.intensity[0]).toBeGreaterThan(900);
    expect(shown.intensity[1]).toBeLessThan(1300);
  });

  it('the base 4D map, a 3D volume and a statistic keep their own display', () => {
    useLayerStore.setState({
      layers: [
        {
          id: 'fir',
          name: 'fir',
          volumeId: 'fir',
          type: 'volume',
          visible: true,
          order: 0,
          timeSeriesInfo: { num_timepoints: 8 },
        },
      ],
    } as never);
    expect(overlayDisplay(fourD, range, { min: -0.1, max: 2.4 }, false)).toBe(range);
    expect(overlayDisplay({ id: 'x', type: 'volume' }, range, { min: 0, max: 1 }, false)).toBe(
      range,
    );
    expect(overlayDisplay(fourD, range, { min: 0, max: 1 }, true)).toBe(range);
  });
});
