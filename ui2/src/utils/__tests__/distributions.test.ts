import { describe, expect, it } from 'vitest';
import { sampleQuantile, tQuantile } from '../distributions';

describe('distributions (E4)', () => {
  it('t quantiles match R qt()', () => {
    // qt(0.975, df) in R.
    expect(tQuantile(0.975, 1)).toBeCloseTo(12.70620473617471, 9);
    expect(tQuantile(0.975, 4)).toBeCloseTo(2.776445105197799, 10);
    expect(tQuantile(0.975, 10)).toBeCloseTo(2.228138851986274, 10);
    expect(tQuantile(0.975, 29)).toBeCloseTo(2.045229642132703, 10);
    expect(tQuantile(0.025, 7)).toBeCloseTo(-2.364624251592785, 10);
    expect(tQuantile(0.5, 3)).toBe(0);
    expect(tQuantile(0.975, 0)).toBeNaN();
  });

  it('type-7 quantiles match R quantile()', () => {
    const v = [3, 1, 4, 1, 5, 9, 2, 6];
    expect(sampleQuantile(v, 0.25)).toBeCloseTo(1.75, 12);
    expect(sampleQuantile(v, 0.5)).toBeCloseTo(3.5, 12);
    expect(sampleQuantile(v, 0.75)).toBeCloseTo(5.25, 12);
    expect(sampleQuantile([7], 0.25)).toBe(7);
  });
});
