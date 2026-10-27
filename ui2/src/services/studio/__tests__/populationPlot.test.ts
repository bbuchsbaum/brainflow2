import { expect, it } from 'vitest';
import {
  axisWindowText,
  composePopulationPlot,
  conditionAveragedPeakWindow,
  defaultPopulationPlotRecipe as base,
  populationTransformSummary,
} from '../populationPlot';
import type { SampleFrame } from '@/plotting';
const frame: SampleFrame = {
  columns: [
    { name: 'member', role: 'nominal' },
    { name: 'person', role: 'nominal' },
    { name: 'time', role: 'nominal' },
    { name: 'group', role: 'nominal' },
    { name: 'value', role: 'quantitative' },
  ],
  rows: [
    { member: 'a', person: 'P1', time: '0', group: 'A', value: 1 },
    { member: 'b', person: 'P1', time: '1', group: 'A', value: 3 },
    { member: 'c', person: 'P2', time: '0', group: 'A', value: 5 },
    { member: 'd', person: 'P2', time: '1', group: 'A', value: null },
  ],
};
it('computes local equal-participant means and explicitly defined bands', () => {
  const result = composePopulationPlot(frame, {
    ...base,
    x: 'time',
    axis: 'time',
    axisUnit: 's',
    detail: 'person',
    summary: 'mean',
    band: 'sem95',
    mark: 'line',
  });
  expect(result.frame.rows[0]).toMatchObject({ time: 0, value: 3, count: 2, member: null });
  expect(result.frame.rows[0].lower).toBeCloseTo(3 - 1.96 * 2, 12);
  expect(result.frame.rows[0].upper).toBeCloseTo(3 + 1.96 * 2, 12);
  expect(result.frame.rows[1]).toMatchObject({
    time: 1,
    value: 3,
    count: 1,
    lower: null,
    upper: null,
  });
  expect(JSON.parse(String(result.frame.rows[1].__contributors))).toEqual(['b', 'd']);
  expect(frame.rows[0].time).toBe('0');
});
it('refuses accidental repeated contributions and requires explicit within-person reduction', () => {
  const repeated = { ...frame, rows: [...frame.rows, { ...frame.rows[0], member: 'e', value: 3 }] };
  const recipe = { ...base, x: 'time', detail: 'person', summary: 'mean' as const };
  expect(() => composePopulationPlot(repeated, recipe)).toThrow(/Repeated rows/);
  expect(
    composePopulationPlot(repeated, { ...recipe, within: 'mean' }).frame.rows[0],
  ).toMatchObject({ value: 3.5, count: 2 });
});
it('requires declared physical time, finite measured values and trajectory identity', () => {
  expect(() => composePopulationPlot(frame, { ...base, x: 'time', axis: 'time' })).toThrow(/units/);
  expect(() => composePopulationPlot(frame, { ...base, mark: 'line' })).toThrow(/identity/);
  expect(() => composePopulationPlot(frame, { ...base, x: 'group', axis: 'number' })).toThrow(
    /invalid measured/,
  );
  expect(() => composePopulationPlot(frame, { ...base, x: 'unknown' })).toThrow(/unavailable/);
});
it('retains original identities, missing samples and explicit color/facet definitions', () => {
  const result = composePopulationPlot(frame, {
    ...base,
    x: 'time',
    detail: 'person',
    mark: 'line',
    color: 'group',
    facet: 'group',
  });
  expect(result.frame.rows.map((r) => r.member)).toEqual(['a', 'b', 'c', 'd']);
  expect(result.frame.rows[3].value).toBeNull();
  expect(result.spec.encoding).toMatchObject({ color: 'group', facet: 'group', detail: 'person' });
});
it('restores bounded sample recipes detached and refuses invalid cells before publication', async () => {
  const { populationPlotService: service } = await import('../PopulationPlotService');
  const receipt = {
    version: 1,
    plots: [
      {
        id: 'old',
        label: 'Regional samples',
        datasetKey: 'old',
        setId: 'old',
        sessionRevision: 3,
        frame,
        recipe: base,
        query: { probe: { worldMm: [1, 2, 3] } },
      },
    ],
  };
  const before = service.getSnapshot();
  const prepared = service.prepareSaved(receipt);
  expect(service.getSnapshot()).toBe(before);
  expect(prepared[0].frame).toEqual(frame);
  expect(prepared[0].sessionRevision).toBe(-1);
  expect(service.canLink(prepared[0])).toBe(false);
  const malformed = structuredClone(receipt);
  (malformed.plots[0].frame.rows[0] as Record<string, unknown>).value = { invalid: true };
  expect(() => service.prepareSaved(malformed)).toThrow('Invalid tabular');
  expect(service.getSnapshot()).toBe(before);
});

it('rejects malformed column roles and units in imported plot receipts', () => {
  const invalidRole = structuredClone(frame);
  Object.assign(invalidRole.columns[0], { role: 'mystery' });
  expect(() => composePopulationPlot(invalidRole, base)).toThrow('Invalid tabular');
  const invalidUnit = structuredClone(frame);
  Object.assign(invalidUnit.columns[1], { unit: { symbol: 'beta' } });
  expect(() => composePopulationPlot(invalidUnit, base)).toThrow('Invalid tabular');
});

it('combines probes without multiplying overlapping observations and rejects inconsistent receipts', async () => {
  const { combinePopulationPlots } = await import('../populationPlotCombine');
  const { defaultPopulationPlotRecipe } = await import('../populationPlot');
  const make = (id: string, worldMm: [number, number, number]) => ({
    id,
    label: id,
    datasetKey: 'd',
    setId: 'set',
    sessionRevision: 1,
    frame: {
      ...frame,
      columns: frame.columns.map((c) => (c.name === 'value' ? { ...c, unit: 'beta' } : c)),
      meta: {
        sources: frame.rows.map((r) => ({
          memberId: String(r.member),
          sourceRevision: { sha256: 'a'.repeat(64), sourceBytes: 100 },
          stackIndex: null,
          validCount: 1,
          error: null,
        })),
      },
    },
    recipe: defaultPopulationPlotRecipe,
    query: {
      key: id,
      datasetKey: 'd',
      probe: { worldMm, radiusMm: 0, reduce: 'mean' as const, supportKey: 's' },
      request: {
        datasetId: 'set',
        reduce: 'mean' as const,
        locus: {
          kind: 'set' as const,
          members: frame.rows.map((r) => ({
            memberId: String(r.member),
            sourcePath: '/source.nii',
          })),
          worldMm,
          radiusMm: 0,
        },
      },
    },
  });
  const a = make('A', [0, 0, 0]);
  const b = make('B', [0, 0, 0]);
  const union = combinePopulationPlots([a, b]);
  expect(union.rows).toHaveLength(4);
  expect(JSON.parse(String(union.rows[0].__populationSets))).toEqual(['A', 'B']);
  expect(combinePopulationPlots([a, make('C', [1, 0, 0])]).rows).toHaveLength(8);
  const conflicting = structuredClone(b);
  conflicting.frame.rows[0].value = 99;
  expect(() => combinePopulationPlots([a, conflicting])).toThrow('disagree');
  const incompatible = structuredClone(b);
  incompatible.frame.columns.find((c) => c.name === 'value')!.unit = 't';
  expect(() => combinePopulationPlots([a, incompatible])).toThrow('units');
});

// Phase 4 E4: population-stage bands and declared collapse transforms.
// A 3 participant × 2 condition × 4 lag FIR table with known answers.
const fir: SampleFrame = {
  columns: [
    { name: 'member', role: 'nominal' },
    { name: 'subject', role: 'nominal' },
    { name: 'condition', role: 'nominal' },
    { name: 'lag', role: 'quantitative' },
    { name: 'value', role: 'quantitative' },
  ],
  rows: ['s1', 's2', 's3'].flatMap((subject, si) =>
    ['faces', 'houses'].flatMap((condition) =>
      [0, 1, 2, 3].map((lag) => ({
        member: `${subject}_${condition}_${lag}`,
        subject,
        condition,
        lag,
        // faces peak at lag 2, houses at lag 3; subject offsets 0, 1, 2.
        value: (condition === 'faces' ? [0, 2, 4, 1][lag] : [0, 1, 2, 5][lag]) + si,
      })),
    ),
  ),
};
const firRecipe = {
  ...base,
  x: 'lag',
  axis: 'number' as const,
  color: 'condition',
  detail: 'subject',
  mark: 'line' as const,
  summary: 'mean' as const,
};
const at = (rows: readonly Record<string, unknown>[], condition: string, lag: number | string) =>
  rows.find((r) => r.condition === condition && r.lag === lag)!;

it('t-based ci95: mean ± t(0.975, n−1)·SD/√n (E4)', () => {
  const out = composePopulationPlot(fir, { ...firRecipe, band: 'ci95' });
  // faces, lag 2: values 4, 5, 6 → mean 5, SD 1, n 3, t(0.975, 2) = 4.302652729911275.
  const row = at(out.frame.rows, 'faces', 2);
  expect(row.value).toBe(5);
  expect(row.lower).toBeCloseTo(5 - 4.302652729911275 / Math.sqrt(3), 9);
  expect(row.upper).toBeCloseTo(5 + 4.302652729911275 / Math.sqrt(3), 9);
  expect(out.frame.meta?.populationReduction).toMatchObject({ band: 'ci95', bandDefinition: 'mean ± t(0.975, n − 1) · SD / √n' });
});

it('median with the IQR band; mismatched centre/band pairs are refused (E4)', () => {
  const out = composePopulationPlot(fir, { ...firRecipe, summary: 'median', band: 'iqr' });
  const row = at(out.frame.rows, 'houses', 3); // 5, 6, 7
  expect([row.value, row.lower, row.upper]).toEqual([6, 5.5, 6.5]);
  expect(() => composePopulationPlot(fir, { ...firRecipe, summary: 'median', band: 'ci95' })).toThrow(/IQR/);
  expect(() => composePopulationPlot(fir, { ...firRecipe, band: 'iqr' })).toThrow(/median/);
});

it('baseline subtraction removes each line’s pre-onset mean (E4)', () => {
  const out = composePopulationPlot(fir, {
    ...firRecipe,
    band: 'none',
    transforms: [{ kind: 'baseline', from: 0, to: 0 }],
  });
  // Subject offsets cancel: every subject's faces lag 2 is 4 after the baseline.
  expect(at(out.frame.rows, 'faces', 2)).toMatchObject({ value: 4, count: 3 });
  expect(out.frame.meta?.populationTransforms).toEqual([
    { transform: { kind: 'baseline', from: 0, to: 0 }, linesIn: 6, linesOut: 6, dropped: [], axis: { label: 'lag', unit: '' } },
  ]);
});

it('condition difference is paired per participant; unpaired participants are dropped and named (E4)', () => {
  const missing = { ...fir, rows: fir.rows.filter((r) => !(r.subject === 's3' && r.condition === 'houses')) };
  const out = composePopulationPlot(missing, {
    ...firRecipe,
    band: 'sd',
    transforms: [{ kind: 'conditionDifference', column: 'condition', a: 'faces', b: 'houses' }],
  });
  const lag3 = at(out.frame.rows, 'faces − houses', 3);
  expect(lag3).toMatchObject({ value: -4, count: 2 });
  expect(out.frame.meta?.populationTransforms).toEqual([
    {
      transform: { kind: 'conditionDifference', column: 'condition', a: 'faces', b: 'houses' },
      linesIn: 3,
      linesOut: 2,
      dropped: ['s3'],
      axis: { label: 'lag', unit: '' },
    },
  ]);
});

it('window mean collapses lags to one value per line, after a difference (E4)', () => {
  const out = composePopulationPlot(fir, {
    ...firRecipe,
    mark: 'point',
    band: 'ci95',
    transforms: [
      { kind: 'conditionDifference', column: 'condition', a: 'faces', b: 'houses' },
      { kind: 'windowMean', from: 1, to: 2 },
    ],
  });
  // faces − houses at lags 1, 2: 1, 2 → mean 1.5 for every subject; SD 0.
  expect(out.frame.rows).toHaveLength(1);
  expect(out.frame.rows[0]).toMatchObject({ lag: '1–2', condition: 'faces − houses', value: 1.5, lower: 1.5, upper: 1.5, count: 3 });
  expect(out.frame.columns.find((c) => c.name === 'lag')?.role).toBe('nominal');
  expect(() =>
    composePopulationPlot(fir, { ...firRecipe, transforms: [{ kind: 'windowMean', from: 1, to: 2 }] }),
  ).toThrow(/use points/);
  expect(() =>
    composePopulationPlot(fir, { ...firRecipe, axis: 'category', transforms: [{ kind: 'baseline', from: 0, to: 0 }] }),
  ).toThrow(/measured/);
});

it('summary rows carry SD and SE; the transforms read as one clause (round 2 X1/S1)', () => {
  const out = composePopulationPlot(fir, {
    ...firRecipe,
    band: 'ci95',
    transforms: [
      { kind: 'baseline', from: 0, to: 0 },
      { kind: 'conditionDifference', column: 'condition', a: 'faces', b: 'houses' },
    ],
  });
  // faces − houses at lag 2 after baseline: 2 for every subject → SD 0.
  expect(at(out.frame.rows, 'faces − houses', 2)).toMatchObject({ value: 2, sd: 0, se: 0, count: 3 });
  expect(populationTransformSummary(out.frame)).toBe(
    'baseline: lag 0 subtracted per participant; faces − houses, paired',
  );
  const raw = composePopulationPlot(fir, { ...firRecipe, band: 'sd' });
  const row = at(raw.frame.rows, 'faces', 2); // 4, 5, 6
  expect(row.sd).toBeCloseTo(1, 12);
  expect(row.se).toBeCloseTo(1 / Math.sqrt(3), 12);
});

it('window text and provenance: typed vs from the condition-averaged peak (round 2 S1)', () => {
  expect(axisWindowText(1, 3, { label: 'Lag', unit: 'TR' })).toBe('lags 1–3 TR');
  expect(axisWindowText(0, 0, { label: 'Lag', unit: 'TR' })).toBe('lag 0 TR');
  expect(axisWindowText(-2, 4, { label: 'Time', unit: 's' })).toBe('t \u22122–4 s');
  const declared = composePopulationPlot(fir, {
    ...firRecipe,
    mark: 'point',
    transforms: [{ kind: 'windowMean', from: 1, to: 3 }],
  });
  expect(populationTransformSummary(declared.frame)).toBe('window lags 1–3');
  const peak = composePopulationPlot(fir, {
    ...firRecipe,
    mark: 'point',
    transforms: [{ kind: 'windowMean', from: 1, to: 3, source: 'condition-averaged-peak' }],
  });
  expect(populationTransformSummary(peak.frame)).toBe(
    'window lags 1–3 from the condition-averaged peak (data-driven)',
  );
});

it('the condition-averaged peak weighs conditions equally, ± one axis step (round 2 S1)', () => {
  // Condition means (over s1..s3, offsets +1): faces [1,3,5,2], houses [1,2,3,6];
  // averaged [1, 2.5, 4, 4] → the first maximum, lag 2 → window 1–3.
  expect(conditionAveragedPeakWindow(fir, { x: 'lag', color: 'condition' })).toEqual([1, 3]);
  // Unbalanced rows (houses twice as many) must not tilt it towards houses.
  const extra = { ...fir, rows: [...fir.rows, ...fir.rows.filter((r) => r.condition === 'houses').map((r) => ({ ...r, member: `${r.member}b` }))] };
  expect(conditionAveragedPeakWindow(extra, { x: 'lag', color: 'condition' })).toEqual([1, 3]);
  // Faces alone peaks at lag 2; houses alone at lag 3, clamped to the axis.
  const houses = { ...fir, rows: fir.rows.filter((r) => r.condition === 'houses') };
  expect(conditionAveragedPeakWindow(houses, { x: 'lag', color: 'condition' })).toEqual([2, 3]);
});
