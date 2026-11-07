/**
 * Recipe v2 intervals (docs/plans/interval-kinds.md): v1 recipes upgrade with
 * their own legacy table, stored bounds are drawn as given and labelled from
 * metadata, and the per-row interval columns travel with every summary row.
 */
import { describe, expect, it } from 'vitest';

import type { SampleFrame } from '@/plotting';
import {
  INTERVAL_PRESETS,
  centreBandPhrase,
  computedInterval,
  frameIntervalSummary,
  intervalLabel,
  rowInterval,
  type IntervalSpec,
} from '@/plotting/intervals';
import {
  composePopulationPlot,
  defaultPopulationPlotRecipe as base,
  upgradePlotRecipe,
  type PopulationPlotRecipe,
} from '../populationPlot';

const people: SampleFrame = {
  columns: [
    { name: 'member', role: 'nominal' },
    { name: 'person', role: 'nominal' },
    { name: 'time', role: 'nominal' },
    { name: 'value', role: 'quantitative' },
  ],
  rows: [
    { member: 'a', person: 'P1', time: '0', value: 1 },
    { member: 'b', person: 'P2', time: '0', value: 3 },
    { member: 'c', person: 'P3', time: '0', value: 8 },
  ],
};

const v1 = (band: string) => ({
  ...base,
  version: 1,
  band,
  within: 'single',
  repeatRows: undefined,
  x: 'time',
  detail: 'person',
  summary: band === 'iqr' ? 'median' : band === 'none' ? 'none' : 'mean',
  mark: 'point',
});

describe('recipe v1 → v2', () => {
  it('translates each v1 band with the recipe table (ci95 is the t interval here)', () => {
    const expected: Record<string, IntervalSpec> = {
      none: { kind: 'none', source: 'compute' },
      sd: computedInterval(INTERVAL_PRESETS.sd),
      sem95: computedInterval(INTERVAL_PRESETS.ciNormal95),
      ci95: computedInterval(INTERVAL_PRESETS.ciT95),
      iqr: computedInterval(INTERVAL_PRESETS.iqr),
    };
    for (const [token, band] of Object.entries(expected)) {
      const r = upgradePlotRecipe(v1(token));
      expect(r.version).toBe(2);
      expect(r.band).toEqual(band);
      expect(r.repeatRows).toBe('single');
      expect('within' in r).toBe(false);
      expect(() => composePopulationPlot(people, r)).not.toThrow();
    }
  });

  it('passes v2 through and refuses unknown versions and bands', () => {
    expect(upgradePlotRecipe(base)).toBe(base);
    expect(() => upgradePlotRecipe({ ...base, version: 3 })).toThrow(/Unsupported/);
    expect(() => upgradePlotRecipe(v1('ci_t'))).toThrow(/band: ci_t/);
    expect(() => upgradePlotRecipe(null)).toThrow(/Unsupported/);
  });

  it('a v1 study save reopens as v2 with the t interval', async () => {
    const { populationPlotService: service } = await import('../PopulationPlotService');
    const prepared = service.prepareSaved({
      version: 1,
      plots: [
        {
          id: 'old',
          label: 'v1 plot',
          datasetKey: 'old',
          setId: 'old',
          sessionRevision: 3,
          frame: people,
          recipe: v1('ci95'),
          query: { probe: { worldMm: [1, 2, 3] } },
        },
      ],
    });
    expect(prepared[0].recipe.band).toEqual(computedInterval(INTERVAL_PRESETS.ciT95));
    expect(prepared[0].recipe.repeatRows).toBe('single');
  });

  it('a v1 plot file reopens as v2', async () => {
    const { populationPlotService: service } = await import('../PopulationPlotService');
    const plot = {
      id: 'file',
      label: 'v1 file',
      datasetKey: 'f',
      setId: 'f',
      sessionRevision: 1,
      frame: people,
      recipe: v1('sem95'),
      query: { probe: { worldMm: [1, 2, 3] } },
    };
    service.reopen(JSON.stringify({ schema: 'brainflow.population-plot.v1', plot }));
    const opened = service.getSnapshot().at(-1)!;
    expect(opened.recipe.band).toEqual(computedInterval(INTERVAL_PRESETS.ciNormal95));
    service.close(opened.id);
  });
});

describe('computed summaries carry per-row interval metadata', () => {
  it('kind, level, df and n on every summary row', () => {
    const out = composePopulationPlot(people, {
      ...base,
      x: 'time',
      detail: 'person',
      summary: 'mean',
      band: computedInterval(INTERVAL_PRESETS.ciT95),
    });
    expect(out.frame.rows[0]).toMatchObject({
      n: 3,
      interval_kind: 'ci_t',
      conf_level: 0.95,
      df: 2,
    });
    expect(out.frame.columns.find((c) => c.name === 'interval_kind')?.role).toBe('nominal');
    expect(frameIntervalSummary(out.frame)).toEqual({ kind: 'ci_t', level: 0.95 });
  });

  it('wsci and custom intervals are never computed per cell', () => {
    const r = { ...base, x: 'time', detail: 'person', summary: 'mean' as const };
    expect(() =>
      composePopulationPlot(people, {
        ...r,
        band: { kind: 'wsci_cm', level: 0.95, source: 'compute' },
      }),
    ).toThrow(/declared design/);
    expect(() =>
      composePopulationPlot(people, { ...r, band: { kind: 'custom', source: 'compute' } }),
    ).toThrow(/stored bounds only/);
    expect(() =>
      composePopulationPlot(people, { ...r, band: { kind: 'ci_t', source: 'compute' } }),
    ).toThrow(/needs a level/);
  });
});

// One summary row per position from another tool (e.g. neuromosaic): bounds
// deliberately asymmetric, so any recomputation would be visible.
const stored: SampleFrame = {
  columns: [
    { name: 'member', role: 'nominal' },
    { name: 'condition', role: 'nominal' },
    { name: 'lag', role: 'quantitative' },
    { name: 'value', role: 'quantitative' },
    { name: 'ci_low', role: 'quantitative' },
    { name: 'ci_high', role: 'quantitative' },
    { name: 'n', role: 'quantitative' },
  ],
  rows: [
    { member: null, condition: 'faces', lag: 0, value: 1, ci_low: 0.2, ci_high: 1.9, n: 12 },
    { member: null, condition: 'faces', lag: 1, value: 2, ci_low: 1.5, ci_high: 3.4, n: 12 },
    { member: null, condition: 'houses', lag: 0, value: 0.5, ci_low: -0.1, ci_high: 0.6, n: 11 },
  ],
};
const storedRecipe: PopulationPlotRecipe = {
  ...base,
  x: 'lag',
  axis: 'number',
  color: 'condition',
  mark: 'line',
  summary: 'mean',
  band: { kind: 'wsci_cm', level: 0.95, source: 'columns', lower: 'ci_low', upper: 'ci_high' },
};

/** Stored rows in input order (a line mark sorts by x). */
const byPosition = (f: SampleFrame) =>
  stored.rows.map((src) => f.rows.find((r) => r.condition === src.condition && r.lag === src.lag)!);

describe('stored bounds (band.source = columns)', () => {
  it('are drawn as given, never recomputed, and labelled from the declaration', () => {
    const out = composePopulationPlot(stored, storedRecipe);
    expect(out.summary).toBe(true);
    expect(out.spec.band).toEqual({ lower: 'lower', upper: 'upper' });
    expect(byPosition(out.frame).map((r) => [r.value, r.lower, r.upper, r.n])).toEqual([
      [1, 0.2, 1.9, 12],
      [2, 1.5, 3.4, 12],
      [0.5, -0.1, 0.6, 11],
    ]);
    expect(out.frame.rows[0]).toMatchObject({ interval_kind: 'wsci_cm', conf_level: 0.95 });
    expect(out.frame.meta?.populationReduction).toMatchObject({ weight: 'stored summaries' });
    const summary = frameIntervalSummary(out.frame);
    expect(summary).toEqual({ kind: 'wsci_cm', level: 0.95 });
    expect(centreBandPhrase('mean', summary as Exclude<typeof summary, 'mixed' | null>)).toBe(
      'mean ± 95% within-subject CI',
    );
  });

  it('a row that states its own kind wins; disagreeing rows read as mixed', () => {
    const mixed = structuredClone(stored);
    (mixed.rows[2] as Record<string, unknown>).interval_kind = 'ci_t';
    mixed.columns = [...mixed.columns, { name: 'interval_kind', role: 'nominal' }];
    const out = composePopulationPlot(mixed, storedRecipe);
    expect(byPosition(out.frame).map((r) => r.interval_kind)).toEqual(['wsci_cm', 'wsci_cm', 'ci_t']);
    expect(frameIntervalSummary(out.frame)).toBe('mixed');
  });

  it('bounds with no stated definition are never given a computed kind’s name', () => {
    const out = composePopulationPlot(stored, {
      ...storedRecipe,
      band: { ...storedRecipe.band, kind: 'custom', level: undefined },
    });
    expect(intervalLabel(rowInterval(out.frame.rows[0], null))).toBe(
      'interval (definition not supplied)',
    );
    const named = composePopulationPlot(stored, {
      ...storedRecipe,
      band: { ...storedRecipe.band, kind: 'custom', level: undefined, definition: '89% HDI' },
    });
    expect(frameIntervalSummary(named.frame)).toEqual({ kind: 'custom', definition: '89% HDI' });
    // An unknown per-row kind keeps the row's own words.
    expect(rowInterval({ interval_kind: 'bootstrap_bca' }, null)).toEqual({
      kind: 'custom',
      definition: 'bootstrap_bca',
    });
  });

  it('a declared level labels only rows of the declared kind', () => {
    const rows = structuredClone(stored);
    rows.columns = [...rows.columns, { name: 'interval_kind', role: 'nominal' }];
    rows.rows.forEach((r, i) => ((r as Record<string, unknown>).interval_kind = ['ci_t', 'sd', 'quantile_range'][i]));
    const out = composePopulationPlot(rows, {
      ...storedRecipe,
      band: { kind: 'ci_t', level: 0.9, source: 'columns', lower: 'ci_low', upper: 'ci_high' },
    });
    const labels = byPosition(out.frame).map((r) => intervalLabel(rowInterval(r, null)));
    expect(labels[0]).toBe('90% CI (t)');
    expect(labels[1]).toBe('± SD');
    // A quantile row without its own level is not given the CI's 0.9.
    expect(byPosition(out.frame)[2].conf_level).toBeNull();
  });

  it('the summary must name the centre the stored bounds describe', () => {
    expect(() => composePopulationPlot(stored, { ...storedRecipe, summary: 'median' })).toThrow(
      /Stored wsci_cm bounds describe a mean/,
    );
    const custom = { ...storedRecipe.band, kind: 'custom' as const, level: undefined };
    expect(() => composePopulationPlot(stored, { ...storedRecipe, summary: 'median', band: custom })).not.toThrow();
  });

  it('refuse repeated positions, missing columns, transforms and no summary', () => {
    const repeated = { ...stored, rows: [...stored.rows, stored.rows[0]] };
    expect(() => composePopulationPlot(repeated, storedRecipe)).toThrow(
      /one summary row per plotted position/,
    );
    expect(() =>
      composePopulationPlot(stored, {
        ...storedRecipe,
        band: { ...storedRecipe.band, upper: 'nope' },
      }),
    ).toThrow(/bound column is unavailable: nope/);
    expect(() =>
      composePopulationPlot(stored, {
        ...storedRecipe,
        detail: 'condition',
        transforms: [{ kind: 'baseline', from: 0, to: 0 }],
      }),
    ).toThrow(/stored summaries/);
    expect(() => composePopulationPlot(stored, { ...storedRecipe, summary: 'none' })).toThrow(
      /summary centre/,
    );
    expect(() =>
      composePopulationPlot(stored, {
        ...storedRecipe,
        band: { ...storedRecipe.band, kind: 'none', level: undefined },
      }),
    ).toThrow(/need an interval kind/);
  });
});
