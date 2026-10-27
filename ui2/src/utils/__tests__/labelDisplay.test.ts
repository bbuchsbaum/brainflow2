import { describe, expect, it } from 'vitest';
import {
  labelDisplayOf,
  labelRenderFields,
  OUTLINE_ONLY_FILL_OPACITY,
  DEFAULT_LABEL_OUTLINE,
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

  it('outline: an invisible fill that still draws, outline alpha from the layer opacity', () => {
    const { opacity, outline } = labelRenderFields({ ...label, labelDisplay: 'outline' });
    expect(opacity).toBe(OUTLINE_ONLY_FILL_OPACITY);
    expect(outline?.enabled).toBe(true);
    expect(outline?.selectedLabelId).toBe(0);
    expect(outline?.color[3]).toBeCloseTo(0.8);
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
    expect(outline?.haloColor?.[3]).toBeCloseTo(0.6 * 0.8);
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
