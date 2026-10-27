import { describe, expect, it } from 'vitest';
import type { SampleFrame } from '@/plotting';
import { defaultPopulationPlotRecipe } from '@/services/studio/populationPlot';
import { SERIES_X, type SetSeriesBinding } from '../seriesBinding';
import { composePopulationPlot } from '@/services/studio/populationPlot';
import { locusVoxels, seriesCaption, seriesCsv, seriesPlotParams, seriesSpec } from '../seriesPresentation';

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

  // Round 2 (v1 visual 6): the x axis is titled on the plot, so the caption no longer repeats it.
  it('caption: band · n · locus with voxels · transforms, separated by "·"', () => {
    expect(locusVoxels(frame)).toBe(123);
    expect(
      seriesCaption({ binding, recipe, participants: 6, locus: '6 mm sphere at −39.5, −19.5, 50.5 mm', voxels: 123, transforms: 'Baseline 0–0 subtracted.' }),
    ).toBe('mean ± 95% CI (t, df = 5) · 6 participants · 6 mm sphere at −39.5, −19.5, 50.5 mm, 123 voxels · Baseline 0–0 subtracted');
  });

  it('± 1.96 SE at small n says it is a normal approximation', () => {
    expect(seriesCaption({ binding, recipe: { ...recipe, band: 'sem95' }, participants: 6, locus: 'x', voxels: null, transforms: '' })).toContain(
      'mean ± 1.96 SE (normal approx., n = 6)',
    );
  });

  it('a window mean puts conditions on x and includes 0 on y; a baseline is passed on for hollow points', () => {
    const spec = { mark: 'point' as const, encoding: { x: SERIES_X, y: 'value' }, transforms: [], params: {} };
    const win = { ...recipe, color: 'condition', transforms: [{ kind: 'windowMean' as const, from: 1, to: 3 }] };
    expect(seriesSpec(spec, win, {}).params).toMatchObject({ yIncludeZero: true });
    expect(seriesSpec(spec, win, {}).encoding.x).toBe('condition');
    const base = { ...recipe, transforms: [{ kind: 'baseline' as const, from: 0, to: 1 }] };
    expect(seriesSpec(spec, base, {}).params.baselineRange).toEqual([0, 1]);
  });
});

describe('series CSV (round 2 X1)', () => {
  const rows = ['s1', 's2', 's3'].flatMap((subject, si) =>
    ['faces', 'houses'].flatMap((condition) =>
      [0, 1, 2].map((lag) => ({ member: `${subject}_${condition}_${lag}`, subject, condition, [SERIES_X]: lag, value: lag + si + (condition === 'faces' ? 1 : 0) })),
    ),
  );
  const fir: SampleFrame = {
    columns: [
      { name: 'member', role: 'nominal' },
      { name: 'subject', role: 'nominal' },
      { name: 'condition', role: 'nominal' },
      { name: SERIES_X, role: 'quantitative', label: 'Lag' },
      { name: 'value', role: 'quantitative' },
    ],
    rows,
  };
  const r = { ...recipe, axis: 'number' as const, axisUnit: 'TR', color: 'condition', mark: 'line' as const, within: 'mean' as const };
  const locus = { kind: 'sphere', label: '6 mm sphere at −39.5, −19.5, 50.5 mm', voxels: 123 };

  it('population: sd, se, n and the locus as columns; no comment lines; ASCII', () => {
    const out = composePopulationPlot(fir, r);
    const csv = seriesCsv(out.frame, r, binding, locus).trim().split('\n');
    expect(csv[0]).toBe('condition,lag_TR,n,mean,sd,se,band_low,band_high,band_definition,locus_kind,locus_label,n_voxels,transforms');
    const faces0 = csv.find((l) => l.startsWith('faces,0,'))!.split(',');
    expect(faces0.slice(0, 6)).toEqual(['faces', '0', '3', '2', '1', String(1 / Math.sqrt(3))]);
    expect(csv.at(-1)).toContain('sphere,"6 mm sphere at -39.5, -19.5, 50.5 mm",123,');
    expect(csv.every((l) => !l.startsWith('#') && /^[\x20-\x7e]*$/.test(l))).toBe(true);
  });

  it('participants: participant, condition, lag, value per row', () => {
    const out = composePopulationPlot(fir, { ...r, summary: 'none', band: 'none' });
    const csv = seriesCsv(out.frame, { ...r, summary: 'none', band: 'none' }, binding, locus).trim().split('\n');
    expect(csv[0]).toBe('participant,condition,lag_TR,value,locus_kind,locus_label,n_voxels,transforms');
    expect(csv).toContain('s2,houses,1,2,sphere,"6 mm sphere at -39.5, -19.5, 50.5 mm",123,');
    expect(csv).toHaveLength(1 + 18);
  });

  it('window mean: numeric window bounds and where the window came from', () => {
    const w = { ...r, mark: 'point' as const, transforms: [{ kind: 'windowMean' as const, from: 1, to: 2, source: 'condition-averaged-peak' as const }] };
    const out = composePopulationPlot(fir, w);
    const csv = seriesCsv(out.frame, w, binding, null).trim().split('\n');
    expect(csv[0]).toBe('condition,window_from_TR,window_to_TR,window_source,n,mean,sd,se,band_low,band_high,band_definition,locus_kind,locus_label,n_voxels,transforms');
    expect(csv[1]).toMatch(/^faces,1,2,condition-averaged peak \(data-driven\),3,/);
    expect(csv[1]).toMatch(/window lags 1-2 TR from the condition-averaged peak \(data-driven\)$/);
  });
});
