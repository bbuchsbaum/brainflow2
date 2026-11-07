import { describe, expect, it } from 'vitest';

import {
  INTERVAL_KIND_IDS,
  INTERVAL_PRESETS,
  LEGACY_RECIPE_TOKENS,
  LEGACY_TRACE_TOKENS,
  centreBandPhrase,
  computeInterval,
  fromRecipeBandV1,
  fromTraceBandV1,
  intervalChoiceError,
  intervalDef,
  intervalDefinition,
  intervalKey,
  intervalLabel,
  intervalMenuLabel,
  parseIntervalKey,
  withDefaultLevel,
} from '../intervals';
import { normalQuantile } from '@/utils/distributions';

// The Rust roi_spread_band fixture: mean 40, SD = √(2800/6), n = 7.
const VALS = [10, 20, 30, 40, 50, 60, 70];
const SD = Math.sqrt(2800 / 6);
const SE = SD / Math.sqrt(7);

describe('interval registry', () => {
  it('has an entry for every kind, with consistent level handling', () => {
    for (const kind of INTERVAL_KIND_IDS) {
      const def = intervalDef(kind);
      expect(def.kind).toBe(kind);
      const c = withDefaultLevel({ kind });
      expect(intervalChoiceError(c)).toBeNull();
      expect(parseIntervalKey(intervalKey(c))).toEqual(c);
      expect(typeof intervalDefinition(c)).toBe('string');
    }
  });

  it('rejects unknown kinds and misplaced levels', () => {
    expect(intervalChoiceError({ kind: 'ci95' })).toMatch(/Unknown interval kind/);
    expect(intervalChoiceError({ kind: 'ci_t' })).toMatch(/needs a level/);
    expect(intervalChoiceError({ kind: 'ci_t', level: 95 })).toMatch(/needs a level/);
    expect(intervalChoiceError({ kind: 'sd', level: 0.95 })).toMatch(/takes no level/);
    expect(parseIntervalKey('ci_t@1.5')).toBeNull();
    expect(parseIntervalKey('ci_t@0.9@x')).toBeNull();
    expect(parseIntervalKey('sem95')).toBeNull();
  });

  it('computes each estimator against hand values', () => {
    const at = (c: Parameters<typeof computeInterval>[0]) => computeInterval(c, VALS, 40)!;
    expect(at(INTERVAL_PRESETS.sd).upper).toBeCloseTo(40 + SD, 9);
    expect(at(INTERVAL_PRESETS.se).lower).toBeCloseTo(40 - SE, 9);
    expect(at(INTERVAL_PRESETS.ciNormal95).upper).toBeCloseTo(40 + 1.959963984540054 * SE, 9);
    const t = at(INTERVAL_PRESETS.ciT95);
    expect(t.upper).toBeCloseTo(40 + 2.446911851144969 * SE, 8);
    expect(t.df).toBe(6);
    const q = at(INTERVAL_PRESETS.quantile95);
    expect(q.lower).toBeCloseTo(11.5, 9);
    expect(q.upper).toBeCloseTo(68.5, 9);
    expect(at(INTERVAL_PRESETS.iqr)).toEqual({ lower: 25, upper: 55 });
    expect(computeInterval(INTERVAL_PRESETS.ciT95, [5], 5)).toBeNull();
    expect(computeInterval(INTERVAL_PRESETS.none, VALS, 40)).toBeNull();
    expect(computeInterval({ kind: 'wsci_cm', level: 0.95 }, VALS, 40)).toBeNull();
  });

  it('normal quantile matches reference values', () => {
    expect(normalQuantile(0.975)).toBeCloseTo(1.959963984540054, 10);
    expect(normalQuantile(0.025)).toBeCloseTo(-1.959963984540054, 10);
    expect(normalQuantile(0.995)).toBeCloseTo(2.575829303548901, 10);
    expect(normalQuantile(0.5)).toBe(0);
    expect(normalQuantile(1)).toBeNaN();
  });

  it('labels name the quantity, not the legacy token', () => {
    expect(intervalLabel(INTERVAL_PRESETS.ciT95)).toBe('95% CI (t)');
    expect(intervalLabel(INTERVAL_PRESETS.ciNormal95)).toBe('95% CI (normal)');
    expect(intervalLabel(INTERVAL_PRESETS.iqr)).toBe('IQR');
    expect(intervalLabel(INTERVAL_PRESETS.quantile95)).toBe('95% quantile range');
    expect(intervalMenuLabel(INTERVAL_PRESETS.quantile95)).toBe(
      '95% quantile range (2.5th–97.5th)',
    );
    expect(intervalLabel({ kind: 'ci_t', level: 0.9 })).toBe('90% CI (t)');
    expect(intervalLabel({ kind: 'custom' })).toBe('interval (definition not supplied)');
    expect(intervalLabel({ kind: 'custom', definition: 'HDI 89%' })).toBe('HDI 89%');
    expect(intervalDefinition(INTERVAL_PRESETS.ciT95)).toBe('mean ± t(0.975, n − 1) · SD / √n');
    expect(intervalDefinition(INTERVAL_PRESETS.iqr)).toBe('25th–75th percentile (type 7)');
    expect(intervalDefinition({ kind: 'quantile_range', level: 0.98 })).toBe(
      '1st–99th percentile (type 7)',
    );
  });

  it('phrases a centre with its band', () => {
    expect(centreBandPhrase('mean', INTERVAL_PRESETS.ciT95)).toBe('mean ± 95% CI (t)');
    expect(centreBandPhrase('mean', INTERVAL_PRESETS.sd)).toBe('mean ± SD');
    expect(centreBandPhrase('median', INTERVAL_PRESETS.iqr)).toBe('median, IQR');
    expect(centreBandPhrase('mean', INTERVAL_PRESETS.none)).toBe('mean');
  });
});

describe('legacy band names', () => {
  it('translate ci95 by source', () => {
    expect(fromTraceBandV1('ci95')).toEqual(INTERVAL_PRESETS.quantile95);
    expect(fromRecipeBandV1('ci95')).toEqual(INTERVAL_PRESETS.ciT95);
    expect(fromTraceBandV1('sem95')).toEqual(INTERVAL_PRESETS.ciNormal95);
    expect(fromRecipeBandV1('sem95')).toEqual(INTERVAL_PRESETS.ciNormal95);
  });

  it('cover every v1 token and nothing else', () => {
    expect(LEGACY_TRACE_TOKENS.sort()).toEqual(['ci95', 'iqr', 'none', 'sd', 'sem95']);
    expect(LEGACY_RECIPE_TOKENS.sort()).toEqual(['ci95', 'iqr', 'none', 'sd', 'sem95']);
    for (const t of LEGACY_TRACE_TOKENS) expect(intervalChoiceError(fromTraceBandV1(t))).toBeNull();
    for (const t of LEGACY_RECIPE_TOKENS)
      expect(intervalChoiceError(fromRecipeBandV1(t))).toBeNull();
    expect(fromTraceBandV1('constructor')).toBeNull();
    expect(fromRecipeBandV1('ci_t')).toBeNull();
  });
});
