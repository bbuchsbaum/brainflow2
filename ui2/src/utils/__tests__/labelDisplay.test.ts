import { describe, expect, it } from 'vitest';
import {
  labelDisplayOf,
  labelRenderFields,
  OUTLINE_ONLY_FILL_OPACITY,
  OUTLINE_ALPHA_FLOOR,
  outlineAlpha,
  DEFAULT_LABEL_OUTLINE,
  DENSE_ATLAS_REGION_THRESHOLD,
  defaultLabelOutline,
} from '../labelDisplay';

describe('labelRenderFields', () => {
  const label = { layerMode: 'label' as const, opacity: 0.8, outline: undefined };

  it('leaves scalar layers alone', () => {
    expect(labelRenderFields({ layerMode: 'scalar', opacity: 0.5, outline: undefined })).toEqual({
      opacity: 0.5,
      outline: undefined,
    });
    expect(labelDisplayOf({ layerMode: 'scalar', opacity: 1 })).toBe('fill');
  });

  it('fill: no outline', () => {
    expect(
      labelRenderFields({
        ...label,
        labelDisplay: 'fill',
        outline: { ...DEFAULT_LABEL_OUTLINE, enabled: true },
      }),
    ).toEqual({ opacity: 0.8, outline: { ...DEFAULT_LABEL_OUTLINE, enabled: false } });
  });

  it('outline: an invisible fill that still draws, outline alpha from the layer opacity above a floor', () => {
    const { opacity, outline } = labelRenderFields({ ...label, labelDisplay: 'outline' });
    expect(opacity).toBe(OUTLINE_ONLY_FILL_OPACITY);
    expect(outline?.enabled).toBe(true);
    expect(outline?.selectedLabelId).toBe(0);
    // Layer opacity 0.8 -> 0.7 + 0.3 * 0.8.
    expect(outline?.color[3]).toBeCloseTo(outlineAlpha(0.8));
    expect(outlineAlpha(0.8)).toBeCloseTo(0.94);
  });

  it('a label opened translucent keeps a legible outline (review M4)', () => {
    // Over a statistic (0.25) or anatomy (0.35): never below the floor.
    for (const opacity of [0.25, 0.35, 0.05]) {
      const { outline } = labelRenderFields({ ...label, opacity, labelDisplay: 'outline' });
      expect(outline!.color[3]).toBeGreaterThanOrEqual(OUTLINE_ALPHA_FLOOR);
    }
    // Still monotonic in the slider, and hidden at 0.
    expect(outlineAlpha(0.25)).toBeLessThan(outlineAlpha(0.35));
    expect(outlineAlpha(0)).toBe(0);
    expect(outlineAlpha(1)).toBe(1);
  });

  it('defaults to region colours with a dark halo', () => {
    expect(DEFAULT_LABEL_OUTLINE.colorMode).toBe('lut');
    expect(DEFAULT_LABEL_OUTLINE.haloPx).toBe(1);
    expect(DEFAULT_LABEL_OUTLINE.haloColor).toEqual([0, 0, 0, 0.6]);
    const { outline } = labelRenderFields({ ...label, labelDisplay: 'both' });
    expect(outline).toMatchObject({ colorMode: 'lut', haloPx: 1, haloColor: [0, 0, 0, 0.6] });
  });

  it('outline only: the layer opacity also fades the halo', () => {
    const { outline } = labelRenderFields({ ...label, labelDisplay: 'outline' });
    expect(outline?.haloColor?.[3]).toBeCloseTo(0.6 * outlineAlpha(0.8));
    const uniform = labelRenderFields({
      ...label,
      labelDisplay: 'outline',
      outline: { enabled: true, selectedLabelId: 0, color: [1, 1, 1, 1], thicknessPx: 2 },
    }).outline;
    expect(uniform?.haloColor).toBeUndefined();
  });

  it('both: fill plus outline; a hidden layer stays hidden', () => {
    expect(labelRenderFields({ ...label, labelDisplay: 'both' }).outline?.enabled).toBe(true);
    expect(labelRenderFields({ ...label, opacity: 0, labelDisplay: 'outline' }).opacity).toBe(0);
  });
});

describe('defaultLabelOutline', () => {
  it('keeps region colours and a halo for small atlases', () => {
    expect(defaultLabelOutline(undefined)).toBe(DEFAULT_LABEL_OUTLINE);
    expect(defaultLabelOutline(40)).toBe(DEFAULT_LABEL_OUTLINE);
    expect(defaultLabelOutline(DENSE_ATLAS_REGION_THRESHOLD)).toBe(DEFAULT_LABEL_OUTLINE);
  });

  it('gives a dense atlas one neutral 1 px line without a halo', () => {
    const dense = defaultLabelOutline(360);
    expect(dense).toMatchObject({
      enabled: false,
      colorMode: 'uniform',
      thicknessPx: 1,
      haloPx: 0,
    });
    const [r, g, b, a] = dense.color;
    // Neutral: no chroma, light enough to read over a dark underlay.
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(0.05);
    expect(r).toBeGreaterThan(0.8);
    expect(a).toBeGreaterThan(0.5);
  });
});
