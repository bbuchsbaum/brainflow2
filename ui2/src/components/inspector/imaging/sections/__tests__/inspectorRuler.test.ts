import { describe, expect, it } from 'vitest';
import { inspectorRuler } from '../RenderSection';

describe('inspectorRuler (one ruler for Intensity, Threshold and the colormap strip)', () => {
  it('maps the window, the data range and the hidden band onto the same x', () => {
    // overlay-colorbar fixture: data -4.58..6.15, window -6..6, threshold ±2.3
    const r = inspectorRuler([-4.58, 6.15], [-6, 6], [-2.3, 2.3]);
    expect(r.min).toBe(-6);
    expect(r.max).toBe(6.15);
    const x = (v: number) => (v - r.min) / (r.max - r.min);
    expect(r.windowSpan![0]).toBeCloseTo(x(-6));
    expect(r.windowSpan![1]).toBeCloseTo(x(6));
    expect(r.dataSpan![0]).toBeCloseTo(x(-4.58));
    expect(r.dataSpan![1]).toBeCloseTo(x(6.15));
    // The strip's cut-out uses exactly the fractions the threshold track's
    // band uses ((value - min) / span on the same min/max).
    expect(r.hiddenSpan![0]).toBeCloseTo(x(-2.3));
    expect(r.hiddenSpan![1]).toBeCloseTo(x(2.3));
  });

  it('is the data range when the window lies inside it, and has no band without a threshold', () => {
    const r = inspectorRuler([0, 255], [30, 200], [0, 0]);
    expect([r.min, r.max]).toEqual([0, 255]);
    expect(r.dataSpan).toEqual([0, 1]);
    expect(r.hiddenSpan).toBeNull();
  });

  it('keeps a frozen domain while the window moves inside it (no inward ratchet)', () => {
    const live = inspectorRuler([-4.58, 6.15], [-5.5, 6], [-2.3, 2.3]);
    expect(live.min).toBe(-5.5);
    const frozen = inspectorRuler([-4.58, 6.15], [-5.5, 6], [-2.3, 2.3], [-6, 6.15]);
    expect([frozen.min, frozen.max]).toEqual([-6, 6.15]);
    expect(frozen.windowSpan![0]).toBeCloseTo(0.5 / 12.15);
  });

  it('always contains its anchor windows (default and first-seen), so it never shrinks between interactions', () => {
    // Window narrowed to −4.18…6; data −4.58…6.15; first-seen window −6…6.
    const r = inspectorRuler([-4.58, 6.15], [-4.18, 6], [-2.3, 2.3], null, [[-6, 6], null]);
    expect([r.min, r.max]).toEqual([-6, 6.15]);
    const withDefault = inspectorRuler([0, 255], [30, 200], [0, 0], null, [[-10, 300]]);
    expect([withDefault.min, withDefault.max]).toEqual([-10, 300]);
  });
});
