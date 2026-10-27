import { describe, expect, it } from 'vitest';
import { histogramAxisTicks } from '../histogram';

describe('histogramAxisTicks', () => {
  it('gives a label map integer ticks with no repeats', () => {
    const { values, format } = histogramAxisTicks([0, 0.5, 1, 1.5, 2, 2.5, 3], true);
    expect(values).toEqual([0, 1, 2, 3]);
    expect(values.map(format)).toEqual(['0', '1', '2', '3']);
  });

  it('carries the decimals a fractional step needs, with U+2212 minus', () => {
    const fractional = histogramAxisTicks([-1, -0.5, 0, 0.5, 1], false);
    expect(fractional.values.map(fractional.format)).toEqual(['−1.0', '−0.5', '0.0', '0.5', '1.0']);
    const whole = histogramAxisTicks([0, 50, 100], false);
    expect(whole.values.map(whole.format)).toEqual(['0', '50', '100']);
  });
});
