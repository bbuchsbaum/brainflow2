import { describe, expect, it } from 'vitest';

import type { FrameRow, SampleFrame } from '@/plotting';
import { normalizeInterval, parseIntervalKind, parseLevel } from '../intervals';

const ok = <T>(r: { ok: T } | { error: string }): T => {
  if ('error' in r) throw new Error(r.error);
  return r.ok;
};
const err = (r: { ok: unknown } | { error: string }) => ('error' in r ? r.error : null);

describe('parseIntervalKind', () => {
  it.each([
    ['ci_t', 0.95, { kind: 'ci_t', level: 0.95 }],
    ['ci_t_99.5', undefined, { kind: 'ci_t', level: 0.995 }],
    ['ci-t (95%)', undefined, { kind: 'ci_t', level: 0.95 }],
    ['CI-T', 0.9, { kind: 'ci_t', level: 0.9 }],
    ['ci95_t', undefined, { kind: 'ci_t', level: 0.95 }],
    ['95%CI-t', undefined, { kind: 'ci_t', level: 0.95 }],
    ['t', '90%', { kind: 'ci_t', level: 0.9 }],
    ['normal', 95, { kind: 'ci_normal', level: 0.95 }],
    ['Wald', '95%', { kind: 'ci_normal', level: 0.95 }],
    ['sem', undefined, { kind: 'se' }],
    ['Standard Error', undefined, { kind: 'se' }],
    ['stdev', undefined, { kind: 'sd' }],
    ['IQR', undefined, { kind: 'quantile_range', level: 0.5 }],
    ['quantile_90', undefined, { kind: 'quantile_range', level: 0.9 }],
    ['percentile', 0.95, { kind: 'quantile_range', level: 0.95 }],
    ['cousineau-morey', 0.95, { kind: 'wsci_cm', level: 0.95 }],
    ['wsci95_cm', undefined, { kind: 'wsci_cm', level: 0.95 }],
    ['none', undefined, { kind: 'none' }],
  ])('%s (level %s)', (token, level, expected) => {
    expect(ok(parseIntervalKind(token, level))).toEqual(expected);
  });

  it.each([
    ['ci', /without its method/],
    ['95ci', /without its method/],
    ['conf.int', /without its method/],
    ['pi95', /prediction interval/],
    ['sem95', /legacy/],
    ['ci95', /legacy/],
    ['bootstrap', /Unknown interval kind/],
    ['t', /needs a stated level/],
    ['percentile', /needs a stated level/],
  ])('refuses %s', (token, message) => {
    expect(err(parseIntervalKind(token))).toMatch(message);
  });

  it('refuses conflicting or misplaced levels', () => {
    expect(err(parseIntervalKind('ci95_t', 0.9))).toMatch(/Conflicting/);
    expect(err(parseIntervalKind('sd', 0.95))).toMatch(/takes no level/);
    expect(err(parseIntervalKind('t', 'high'))).toMatch(/Unreadable interval level/);
  });

  it('reads levels as fractions, percentages or percent strings', () => {
    expect(ok(parseLevel(0.95))).toBe(0.95);
    expect(ok(parseLevel(95))).toBe(0.95);
    expect(ok(parseLevel('95%'))).toBe(0.95);
    expect(ok(parseLevel('0.9'))).toBe(0.9);
    expect(err(parseLevel(100))).toMatch(/Unreadable/);
    expect(err(parseLevel(1.5))).toMatch(/Unreadable/);
    expect(ok(parseLevel(99.5))).toBe(0.995);
    expect(err(parseLevel(0))).toMatch(/Unreadable/);
  });
});

const frameOf = (rows: FrameRow[]): SampleFrame => ({
  columns: Object.keys(rows[0]).map((name) => ({
    name,
    role: typeof rows[0][name] === 'number' ? ('quantitative' as const) : ('nominal' as const),
  })),
  rows,
});

describe('normalizeInterval', () => {
  it.each([
    [{ lower: 1, upper: 3 }, ['lower', 'upper']],
    [{ ci_low: 1, ci_high: 3 }, ['ci_low', 'ci_high']],
    [{ 'conf.low': 1, 'conf.high': 3 }, ['conf.low', 'conf.high']],
    [{ lwr: 1, upr: 3 }, ['lwr', 'upr']],
    [{ ymin: 1, ymax: 3 }, ['ymin', 'ymax']],
    [{ band_low: 1, band_high: 3 }, ['band_low', 'band_high']],
  ])('detects the bound pair in %o', (cells, pair) => {
    const out = ok(normalizeInterval({ kind: 't', level: 0.95 }, frameOf([{ value: 2, ...cells }])));
    expect([out.spec.lower, out.spec.upper]).toEqual(pair);
    expect(out.spec).toMatchObject({ kind: 'ci_t', level: 0.95, source: 'columns' });
  });

  it('builds bounds from a half-width around the centre', () => {
    const out = ok(
      normalizeInterval(
        { kind: 'normal', level: 0.95 },
        frameOf([
          { value: 2, margin: 0.5 },
          { value: null as unknown as number, margin: 1 },
        ]),
      ),
    );
    expect(out.spec).toMatchObject({ lower: 'lower', upper: 'upper' });
    expect(out.frame.rows.map((r) => [r.lower, r.upper])).toEqual([
      [1.5, 2.5],
      [null, null],
    ]);
  });

  it('refuses ambiguous or missing bounds', () => {
    expect(
      err(normalizeInterval({}, frameOf([{ value: 2, lower: 1, upper: 3, lwr: 1, upr: 3 }]))),
    ).toMatch(/Several bound column pairs/);
    expect(err(normalizeInterval({}, frameOf([{ value: 2 }])))).toMatch(/No interval bounds/);
    expect(err(normalizeInterval({ lower: 'lo', upper: 'hi' }, frameOf([{ value: 2 }])))).toMatch(
      /unavailable: lo/,
    );
    expect(
      err(normalizeInterval({ kind: 'none' }, frameOf([{ value: 2, lower: 1, upper: 3 }]))),
    ).toMatch(/"none"/);
  });

  it('copies per-row metadata into canonical columns and infers the frame kind', () => {
    const out = ok(
      normalizeInterval(
        {},
        frameOf([
          { value: 2, lwr: 1, upr: 3, interval_type: 'CI-t', 'conf.level': 90, dof: 9, nobs: 10 },
          { value: 4, lwr: 3, upr: 5, interval_type: 'CI-t', 'conf.level': 90, dof: 9, nobs: 10 },
        ]),
      ),
    );
    expect(out.frame.rows[0]).toMatchObject({
      interval_kind: 'ci_t',
      conf_level: 0.9,
      df: 9,
      n: 10,
    });
    expect(out.spec).toMatchObject({ kind: 'ci_t', level: 0.9 });
  });

  it('invents no level: rows of one kind at several levels give a custom frame spec', () => {
    const out = ok(
      normalizeInterval(
        {},
        frameOf([
          { value: 2, lower: 1, upper: 3, interval_kind: 'ci_t', conf_level: 0.9 },
          { value: 4, lower: 3, upper: 5, interval_kind: 'ci_t', conf_level: 0.95 },
        ]),
      ),
    );
    expect(out.spec.kind).toBe('custom');
    expect(out.frame.rows.map((r) => r.conf_level)).toEqual([0.9, 0.95]);
    // A row kind that needs a level it doesn't have keeps its own words.
    const bare = ok(normalizeInterval({}, frameOf([{ value: 2, lower: 1, upper: 3, interval_kind: 'quantile' }])));
    expect(bare.frame.rows[0]).toMatchObject({ interval_kind: 'quantile' });
    expect(bare.frame.rows[0].conf_level ?? null).toBeNull();
  });

  it('reads neuromosaic summaries.csv rows as they are written', () => {
    const out = ok(
      normalizeInterval(
        {},
        frameOf([
          { estimate: 1.2, lower: 0.4, upper: 1.9, interval_kind: 'wsci_cm', conf_level: 0.95, df: 11, n: 12, level: 'cluster' },
          { estimate: 0.3, lower: -0.2, upper: 0.7, interval_kind: 'wsci_cm', conf_level: 0.95, df: 11, n: 12, level: 'cluster' },
        ]),
      ),
    );
    expect(out.spec).toEqual({ kind: 'wsci_cm', level: 0.95, source: 'columns', lower: 'lower', upper: 'upper' });
    expect(out.frame.rows[0]).toMatchObject({ interval_kind: 'wsci_cm', conf_level: 0.95, df: 11, n: 12, level: 'cluster' });
    expect(ok(parseIntervalKind('heuristic_se', 0.95))).toEqual({ kind: 'heuristic_se', level: 0.95 });
  });

  it('does not read generic columns as interval metadata', () => {
    const out = ok(normalizeInterval({ kind: 'sd' }, frameOf([{ value: 2, lower: 1, upper: 3, level: 80, count: 900 }])));
    expect(out.frame.rows[0].conf_level).toBeUndefined();
    expect(out.frame.rows[0].n).toBeUndefined();
  });

  it('keeps an unreadable per-row kind in its own words; no kind at all is custom', () => {
    const mixed = ok(
      normalizeInterval(
        {},
        frameOf([{ value: 2, lower: 1, upper: 3, interval_kind: 'bca bootstrap' }]),
      ),
    );
    expect(mixed.frame.rows[0].interval_kind).toBe('bca bootstrap');
    expect(mixed.spec.kind).toBe('custom');
    const bare = ok(
      normalizeInterval({ definition: ' 89% HDI ' }, frameOf([{ value: 2, lower: 1, upper: 3 }])),
    );
    expect(bare.spec).toEqual({
      kind: 'custom',
      source: 'columns',
      lower: 'lower',
      upper: 'upper',
      definition: '89% HDI',
    });
  });
});
