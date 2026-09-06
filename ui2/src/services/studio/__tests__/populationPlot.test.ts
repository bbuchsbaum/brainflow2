import { expect, it } from 'vitest';
import { composePopulationPlot, defaultPopulationPlotRecipe as base } from '../populationPlot';
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
