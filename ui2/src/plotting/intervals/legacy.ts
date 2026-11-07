/**
 * Pre-registry band names, translated by where they came from. The same token
 * meant different quantities on different paths: `ci95` was the 2.5–97.5%
 * quantile range on a set trace and the t-based CI of the mean in a population
 * recipe. Never translate a legacy token without knowing its source.
 */
import { INTERVAL_PRESETS } from './registry';
import type { IntervalChoice } from './types';

/** Set-trace bands (`TraceBand`, persisted `plotSpecStore` v3, bridge `band` argument). */
const TRACE_BAND_V1: Readonly<Record<string, IntervalChoice>> = {
  none: INTERVAL_PRESETS.none,
  sd: INTERVAL_PRESETS.sd,
  sem95: INTERVAL_PRESETS.ciNormal95,
  ci95: INTERVAL_PRESETS.quantile95,
  iqr: INTERVAL_PRESETS.iqr,
};

/** Population-recipe bands (`PopulationPlotRecipe` v1: study saves and plot files). */
const RECIPE_BAND_V1: Readonly<Record<string, IntervalChoice>> = {
  none: INTERVAL_PRESETS.none,
  sd: INTERVAL_PRESETS.sd,
  sem95: INTERVAL_PRESETS.ciNormal95,
  ci95: INTERVAL_PRESETS.ciT95,
  iqr: INTERVAL_PRESETS.iqr,
};

const lookup = (table: Readonly<Record<string, IntervalChoice>>, token: unknown) =>
  typeof token === 'string' && Object.hasOwn(table, token) ? table[token] : null;

export const fromTraceBandV1 = (token: unknown): IntervalChoice | null =>
  lookup(TRACE_BAND_V1, token);
export const fromRecipeBandV1 = (token: unknown): IntervalChoice | null =>
  lookup(RECIPE_BAND_V1, token);

/** The v1 tokens each source knew (for totality tests). */
export const LEGACY_TRACE_TOKENS = Object.keys(TRACE_BAND_V1);
export const LEGACY_RECIPE_TOKENS = Object.keys(RECIPE_BAND_V1);
