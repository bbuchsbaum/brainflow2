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

  it('both: fill plus outline; a hidden layer stays hidden', () => {
    expect(labelRenderFields({ ...label, labelDisplay: 'both' }).outline?.enabled).toBe(true);
    expect(labelRenderFields({ ...label, opacity: 0, labelDisplay: 'outline' }).opacity).toBe(0);
  });
});
