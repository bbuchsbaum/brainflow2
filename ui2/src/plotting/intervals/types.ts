/**
 * The interval vocabulary shared by every band brainflow draws (set traces,
 * population summaries, imported tables). See docs/plans/interval-kinds.md.
 *
 * `kind` names the quantity; `level` is a separate field (never part of the
 * name); `source` says whether brainflow computes the bounds or reads them.
 * Kind names match neuromosaic's implemented vocabulary; neurotabs is to be
 * the canonical home (plan Q1). Change spellings in this file only.
 */

export const INTERVAL_KIND_IDS = [
  'none',
  'sd', // centre ± 1 SD (n − 1)
  'se', // centre ± 1 SE
  'ci_normal', // mean ± z(level) · SE
  'ci_t', // mean ± t(level, n − 1) · SE
  'quantile_range', // central `level` sample quantiles (type 7); IQR at 0.5
  'wsci_cm', // Cousineau–Morey within-subject CI (needs a design; not computed per cell)
  'heuristic_se', // neuromosaic maps-only band: mean ± z · mean voxel SE; not a CI, not computed here
  'custom', // stored bounds whose definition is not a known kind
] as const;

export type IntervalKind = (typeof INTERVAL_KIND_IDS)[number];

/** What an interval is: a kind and, for kinds that take one, a level in (0, 1). */
export interface IntervalChoice {
  readonly kind: IntervalKind;
  readonly level?: number;
}

/**
 * A band declaration: what it is plus where its bounds come from. With
 * `source: 'columns'` the bounds are read from `lower`/`upper` and never
 * recomputed; `definition` states a `custom` interval in words.
 */
export interface IntervalSpec extends IntervalChoice {
  readonly source: 'compute' | 'columns';
  readonly lower?: string;
  readonly upper?: string;
  readonly definition?: string;
}

/** Computed bounds; `df` where the estimator has one (the t interval). */
export interface IntervalBounds {
  readonly lower: number;
  readonly upper: number;
  readonly df?: number;
}

/**
 * Per-row interval metadata columns (summary frames, imported tables). Names
 * follow neuromosaic's `summaries.csv` (interval_kind, conf_level, df, n), the
 * shared format until neurotabs defines one (plan Q1).
 */
export const INTERVAL_COLUMNS = {
  kind: 'interval_kind',
  level: 'conf_level',
  df: 'df',
  n: 'n',
} as const;
