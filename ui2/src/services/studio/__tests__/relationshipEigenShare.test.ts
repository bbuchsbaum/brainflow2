import { afterEach, describe, expect, it, vi } from 'vitest';
import { relationshipMapShare, type RelationshipFit } from '../PopulationRelationshipService';
import { populationMemberHover } from '../populationMemberHover';

const fitWith = (explainedFraction: unknown, eigenvalues: number[] = [3, 1, 0]) =>
  ({ geometry: { eigenvalues, explainedFraction } }) as unknown as RelationshipFit;

describe('the share of variance the 2-D map keeps', () => {
  it('is the backend\'s explainedFraction, not recomputed from the eigenvalues', () => {
    // Eigenvalues 4, 3, 2, 1 would give 0.7; the fit's own figure is used.
    expect(relationshipMapShare(fitWith(0.625, [4, 3, 2, 1, 0]))).toBe(0.625);
    expect(relationshipMapShare(fitWith(1))).toBe(1);
  });

  it('is null when the fraction is missing or not a number', () => {
    expect(relationshipMapShare(fitWith(null))).toBeNull();
    expect(relationshipMapShare(fitWith(undefined))).toBeNull();
    expect(relationshipMapShare(fitWith(Number.NaN))).toBeNull();
  });

  it('is null when nothing varies (the backend reports 1 for no variation)', () => {
    expect(relationshipMapShare(fitWith(1, [0, 0, 0]))).toBeNull();
    expect(relationshipMapShare(fitWith(1, []))).toBeNull();
  });
});

describe('the shared hover channel', () => {
  afterEach(() => populationMemberHover.reset());

  it('publishes a hovered subject with its source, and notifies only on change', () => {
    const listener = vi.fn();
    const stop = populationMemberHover.subscribe(listener);
    populationMemberHover.set('sub002', 'inspector');
    populationMemberHover.set('sub002', 'inspector');
    expect(populationMemberHover.getSnapshot()).toEqual({ memberId: 'sub002', source: 'inspector' });
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });

  it('a source withdraws only its own hover', () => {
    populationMemberHover.set('sub002', 'map');
    populationMemberHover.set(null, 'inspector');
    expect(populationMemberHover.getSnapshot().memberId).toBe('sub002');
    populationMemberHover.set(null, 'map');
    expect(populationMemberHover.getSnapshot()).toEqual({ memberId: null, source: null });
  });
});
