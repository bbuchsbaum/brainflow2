import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/apiService', () => ({ getApiService: () => ({}) }));

import {
  STUDIO_HIDDEN_FRACTION,
  STUDIO_MAP_OPACITY,
  formatStudioWindow,
  sameStudioWindow,
  studioMapDisplay,
  studioMemberKind,
  studioRobustLimit,
  studioWindowLimit,
} from '../studioMapDisplay';
import { studioAnatomyDisplay, studioDerivedDisplay } from '../StudioPaneRenderService';
import type { StudioDerivedMap } from '../StudioDerivedMapService';

const derived = (min: number, max: number): StudioDerivedMap => ({
  layerId: 'studio-derived-1:v',
  volumeId: 'v',
  bounds: { min: [0, 0, 0], max: [1, 1, 1] },
  dataRange: { min, max },
});
const window = ({ colormap, intensity, threshold }: ReturnType<typeof studioMapDisplay>) => ({
  colormap,
  intensity,
  threshold,
});

describe('the Studio map rule (one for computed panes and the member layer)', () => {
  it('signed data: diverging, symmetric about zero, the tenth nearest zero hidden', () => {
    const display = studioMapDisplay({ min: -0.02, max: 0.0034 });
    expect(display).toMatchObject({ kind: 'diverging', colormap: 'fmri', intensity: [-0.02, 0.02] });
    expect(display.threshold[0]).toBe(-display.threshold[1]);
    expect(display.intensity[0]).toBe(-display.intensity[1]);
    expect(display.threshold[1]).toBeCloseTo(STUDIO_HIDDEN_FRACTION * display.intensity[1]);
  });

  it('all-positive data: the sequential map from the minimum, its lowest tenth hidden', () => {
    const display = studioMapDisplay({ min: 0.5, max: 4 });
    expect(display).toMatchObject({ kind: 'sequential', colormap: 'hot', intensity: [0.5, 4] });
    expect(display.threshold[0]).toBe(0.5);
    expect(display.threshold[1]).toBeCloseTo(0.85, 12);
    // A map signed by construction diverges even when no value is negative.
    expect(studioMapDisplay({ min: 0.5, max: 4 }, { signed: true })).toMatchObject({
      colormap: 'fmri',
      intensity: [-4, 4],
    });
  });

  it('anatomy: grey over its own range, nothing hidden', () => {
    expect(studioMapDisplay({ min: 0, max: 900 }, { anatomy: true })).toEqual({
      kind: 'anatomy',
      colormap: 'gray',
      intensity: [0, 900],
      threshold: [0, 0],
    });
  });

  it('a given limit is the window end, and the hidden band follows it', () => {
    const robust = studioMapDisplay({ min: -0.02, max: 0.0034 }, { limit: 0.0145 });
    expect(robust.intensity).toEqual([-0.0145, 0.0145]);
    expect(robust.threshold[0]).toBeCloseTo(-0.00145, 12);
    expect(robust.threshold[1]).toBeCloseTo(0.00145, 12);
    const positive = studioMapDisplay({ min: 0, max: 10 }, { limit: 6 });
    expect(positive.intensity).toEqual([0, 6]);
    expect(positive.threshold[0]).toBe(0);
    expect(positive.threshold[1]).toBeCloseTo(0.6, 12);
    // A limit that says nothing is not used.
    expect(studioMapDisplay({ min: -2, max: 3 }, { limit: 0 }).intensity).toEqual([-3, 3]);
    expect(studioMapDisplay({ min: -2, max: 3 }, { limit: Number.NaN }).intensity).toEqual([-3, 3]);
    expect(studioWindowLimit({ intensity: [-0.0145, 0.0145] })).toBe(0.0145);
    expect(studioWindowLimit({ intensity: [0, 6] })).toBe(6);
  });

  it('the computed panes are drawn by this rule, not by a copy of it', () => {
    for (const [min, max, signed] of [
      [-2, 3, false],
      [0.5, 4, false],
      [0.5, 4, true],
    ] as const) {
      const layer = studioDerivedDisplay(derived(min, max), 'Map', signed);
      expect(window(layer as never)).toEqual(window(studioMapDisplay({ min, max }, { signed })));
      expect(layer.opacity).toBe(STUDIO_MAP_OPACITY);
    }
    expect(window(studioAnatomyDisplay(derived(0, 900)) as never)).toEqual(
      window(studioMapDisplay({ min: 0, max: 900 }, { anatomy: true })),
    );
  });

  it('a shared display replaces a computed map’s own', () => {
    const shared = {
      colormap: 'fmri',
      intensity: [-0.0145, 0.0145] as [number, number],
      threshold: [-0.00145, 0.00145] as [number, number],
    };
    expect(studioDerivedDisplay(derived(-0.004, 0.006), 'Mean', false, shared)).toMatchObject(shared);
    // Without one, its own extreme (as before).
    expect(studioDerivedDisplay(derived(-0.004, 0.006), 'Mean').intensity).toEqual([-0.006, 0.006]);
  });
});

describe('the robust window end (the percentile rule, not the extreme voxel)', () => {
  // 100 equal bins over −0.02 … 0.02, uniform counts.
  const bins = Array.from({ length: 100 }, (_, i) => ({
    x0: -0.02 + i * 0.0004,
    x1: -0.02 + (i + 1) * 0.0004,
    count: 10,
    normalizedCount: 1,
    percentage: 1,
  }));

  it('signed: the larger magnitude of the 2nd and 98th percentiles', () => {
    expect(studioRobustLimit({ bins, totalCount: 1000 }, 'diverging')).toBeCloseTo(0.0192, 6);
  });

  it('nonnegative: the 98th percentile', () => {
    const positive = bins.map((bin) => ({ ...bin, x0: bin.x0 + 0.02, x1: bin.x1 + 0.02 }));
    expect(studioRobustLimit({ bins: positive, totalCount: 1000 }, 'sequential')).toBeCloseTo(0.0392, 6);
  });

  it('is null when the histogram says nothing', () => {
    expect(studioRobustLimit(null, 'diverging')).toBeNull();
    expect(studioRobustLimit({ bins: [], totalCount: 0 }, 'diverging')).toBeNull();
    expect(studioRobustLimit({ bins, totalCount: 0 }, 'sequential')).toBeNull();
  });
});

describe('which member layers the rule draws', () => {
  const meta = (min: number, max: number, nativeDtype = 'float32') => ({
    dataRange: { min, max },
    nativeDtype,
  });
  const layer = (sourcePath: string, more: Record<string, unknown> = {}) => ({
    id: 'l',
    type: 'anatomical',
    name: sourcePath.split('/').pop(),
    sourcePath,
    ...more,
  });

  it('a signed map diverges, however lopsided (the member that drew grey)', () => {
    expect(studioMemberKind(layer('/set/sub-1002_rsa_coef.nii.gz'), meta(-0.02, 0.0034))).toBe('diverging');
    expect(studioMemberKind(layer('/set/sub-1003_rsa_coef.nii.gz'), meta(-0.001, 0.02))).toBe('diverging');
  });

  it('an all-positive map is sequential', () => {
    expect(studioMemberKind(layer('/set/sub-01_FA.nii.gz'), meta(0, 0.9))).toBe('sequential');
  });

  it('anatomy-like images keep the display their load gave them', () => {
    // Named for a modality by the last name part.
    expect(studioMemberKind(layer('/set/sub-01_T1w.nii.gz'), meta(0, 1.7))).toBeNull();
    expect(studioMemberKind(layer('/set/sub-01_task-rest_bold.nii.gz'), meta(-3, 900))).toBeNull();
    // Intensities stored as integers.
    expect(studioMemberKind(layer('/set/s01.nii'), meta(0, 4095, 'i16'))).toBeNull();
    // A series, a template, a label map.
    expect(studioMemberKind(layer('/set/s01.nii', { volumeType: 'TimeSeries4D' }), meta(-2, 2))).toBeNull();
    expect(studioMemberKind(layer('/set/s01.nii', { source: 'template' }), meta(0, 1))).toBeNull();
    expect(studioMemberKind(layer('/set/s01_dseg.nii', { type: 'label' }), meta(0, 12))).toBeNull();
    // Nothing known of its values.
    expect(studioMemberKind(layer('/set/s01.nii'), {})).toBeNull();
    expect(studioMemberKind(null, meta(-1, 1))).toBeNull();
  });

  it('a map derived from an anatomical image, or a declared statistic, is a map', () => {
    expect(studioMemberKind(layer('/set/sub-01_T1w_coef.nii.gz'), meta(-1, 1))).toBe('diverging');
    expect(
      studioMemberKind(layer('/set/sub-01_bold.nii.gz', { statistic: { kind: 'z' } }), meta(-4, 6)),
    ).toBe('diverging');
  });
});

describe('how a window is written', () => {
  it('a symmetric window is ± its end, with enough digits and the true minus', () => {
    expect(formatStudioWindow([-0.0145, 0.0145])).toBe('±0.0145');
    expect(formatStudioWindow([-0.01, 0.02])).toBe('−0.01 to 0.02');
    expect(formatStudioWindow([0, 6])).toBe('0 to 6');
  });

  it('two displays are the same when colour map, window and threshold are', () => {
    const a = { colormap: 'fmri', intensity: [-1, 1] as [number, number], threshold: [-0.1, 0.1] as [number, number] };
    expect(sameStudioWindow(a, { ...a, intensity: [-1, 1] })).toBe(true);
    expect(sameStudioWindow(a, { ...a, colormap: 'hot' })).toBe(false);
    expect(sameStudioWindow(a, { ...a, threshold: [-0.2, 0.2] })).toBe(false);
    expect(sameStudioWindow(a, null)).toBe(false);
  });
});
