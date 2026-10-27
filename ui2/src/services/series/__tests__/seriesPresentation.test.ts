import { describe, expect, it } from 'vitest';
import type { SampleFrame } from '@/plotting';
import { defaultPopulationPlotRecipe } from '@/services/studio/populationPlot';
import { SERIES_X, type SetSeriesBinding } from '../seriesBinding';
import { locusVoxels, seriesCaption, seriesPlotParams } from '../seriesPresentation';

const binding: SetSeriesBinding = {
  setId: 's', kind: 'lag', unit: 'TR', column: 'lag', frames: null, subjectColumn: 'subject', conditionColumn: 'condition', origin: 'manifest',
};
const frame: SampleFrame = {
  columns: [{ name: 'member', role: 'nominal' }, { name: 'value', role: 'quantitative' }, { name: SERIES_X, role: 'quantitative' }],
  rows: [0, 1, 2, 3].map((x) => ({ member: `m${x}`, value: x, [SERIES_X]: x })),
  meta: { sources: [{ memberId: 'm0', sourceRevision: null, stackIndex: null, validCount: 123, error: null }] },
};
const recipe = { ...defaultPopulationPlotRecipe, x: SERIES_X, summary: 'mean' as const, band: 'ci95' as const, detail: 'subject' };

describe('series presentation (v1 F6/F7/F11)', () => {
  it('axis params: titles, integer lag ticks, half-step padding; a zero line only for differences', () => {
    expect(seriesPlotParams(binding, frame, recipe, 'FIR beta (a.u.)')).toEqual({
      xTitle: 'Lag (TR)', yTitle: 'FIR beta (a.u.)', xIntegerTicks: true, xPadHalfStep: 1, zeroLine: false,
    });
    const diff = { ...recipe, transforms: [{ kind: 'conditionDifference' as const, column: 'condition', a: 'faces', b: 'houses' }] };
    expect(seriesPlotParams(binding, frame, diff, 'y').zeroLine).toBe(true);
  });

  it('caption: axis · band · n · locus with voxels · transforms, separated by "·"', () => {
    expect(locusVoxels(frame)).toBe(123);
    expect(
      seriesCaption({ binding, recipe, participants: 6, locus: '6 mm sphere at −39.5, −19.5, 50.5 mm', voxels: 123, transforms: 'Baseline 0–0 subtracted.' }),
    ).toBe('Lag (TR) · mean ± 95% CI (t, df = 5) · 6 participants · 6 mm sphere at −39.5, −19.5, 50.5 mm, 123 voxels · Baseline 0–0 subtracted');
  });

  it('± 1.96 SE at small n says it is a normal approximation', () => {
    expect(seriesCaption({ binding, recipe: { ...recipe, band: 'sem95' }, participants: 6, locus: 'x', voxels: null, transforms: '' })).toContain(
      'mean ± 1.96 SE (normal approx., n = 6)',
    );
  });
});
