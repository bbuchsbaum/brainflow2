/**
 * The interval registry: one entry per kind. Labels, formula text, menu
 * options, validation and per-cell computation all derive from this table, so
 * no other module spells out what an interval is called or how it is computed.
 */
import { normalQuantile } from '@/utils/distributions';

import { normalInterval, quantileInterval, sdInterval, seInterval, tInterval } from './estimators';
import type { IntervalBounds, IntervalChoice, IntervalKind, IntervalSpec } from './types';
import { INTERVAL_KIND_IDS } from './types';

/** The summary a kind belongs to: a mean, a median, or either. */
export type IntervalCentre = 'mean' | 'median' | 'any';

export interface IntervalKindDef {
  readonly kind: IntervalKind;
  readonly centre: IntervalCentre;
  /** The level a menu offers by default; absent = the kind takes no level. */
  readonly defaultLevel?: number;
  /** Compact name for legends, tooltips and captions: "95% CI (t)", "± SD", "IQR". */
  shortLabel(level?: number, definition?: string): string;
  /** Explicit name for menus. */
  menuLabel(level?: number, definition?: string): string;
  /** The formula in words, for provenance and exports. */
  definition(level?: number, centre?: string, definition?: string): string;
  /** Per-cell estimator; absent when the kind can't be computed from one cell. */
  compute?(values: readonly number[], centre: number, level: number): IntervalBounds | null;
}

const pct = (level = 0) => String(Number((level * 100).toFixed(6)));
const ordinal = (p: number) => {
  const s = pct(p);
  if (s.includes('.')) return `${s}th`;
  const n = Number(s);
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${s}${teen ? 'th' : (({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th')}`;
};
const tail = (level = 0.95) => Number(((1 + level) / 2).toFixed(6));
const isIqr = (level?: number) => level === 0.5;
const z = (level = 0.95) => normalQuantile((1 + level) / 2).toFixed(2);

const DEFS: { readonly [K in IntervalKind]: IntervalKindDef } = {
  none: {
    kind: 'none',
    centre: 'any',
    shortLabel: () => '',
    menuLabel: () => 'None',
    definition: () => 'none',
  },
  sd: {
    kind: 'sd',
    centre: 'mean',
    shortLabel: () => '± SD',
    menuLabel: () => '± SD',
    definition: (_l, centre = 'mean') => `${centre} ± SD (n − 1)`,
    compute: sdInterval,
  },
  se: {
    kind: 'se',
    centre: 'mean',
    shortLabel: () => '± SE',
    menuLabel: () => '± SE',
    definition: (_l, centre = 'mean') => `${centre} ± SD / √n`,
    compute: seInterval,
  },
  ci_normal: {
    kind: 'ci_normal',
    centre: 'mean',
    defaultLevel: 0.95,
    shortLabel: (l) => `${pct(l)}% CI (normal)`,
    menuLabel: (l) => `${pct(l)}% CI of the mean (normal approx.)`,
    definition: (l, centre = 'mean') =>
      `${centre} ± z(${tail(l)}) · SD / √n (normal approximation)`,
    compute: normalInterval,
  },
  ci_t: {
    kind: 'ci_t',
    centre: 'mean',
    defaultLevel: 0.95,
    shortLabel: (l) => `${pct(l)}% CI (t)`,
    menuLabel: (l) => `${pct(l)}% CI of the mean (t, n − 1 df)`,
    definition: (l, centre = 'mean') => `${centre} ± t(${tail(l)}, n − 1) · SD / √n`,
    compute: tInterval,
  },
  quantile_range: {
    kind: 'quantile_range',
    centre: 'median',
    defaultLevel: 0.5,
    shortLabel: (l) => (isIqr(l) ? 'IQR' : `${pct(l)}% quantile range`),
    menuLabel: (l) =>
      isIqr(l)
        ? 'Interquartile range'
        : `${pct(l)}% quantile range (${ordinal((1 - (l ?? 0)) / 2)}–${ordinal((1 + (l ?? 0)) / 2)})`,
    definition: (l = 0.5) => `${ordinal((1 - l) / 2)}–${ordinal((1 + l) / 2)} percentile (type 7)`,
    compute: quantileInterval,
  },
  wsci_cm: {
    kind: 'wsci_cm',
    centre: 'mean',
    defaultLevel: 0.95,
    shortLabel: (l) => `${pct(l)}% within-subject CI`,
    menuLabel: (l) => `${pct(l)}% within-subject CI (Cousineau–Morey)`,
    definition: (l) =>
      `mean ± t(${tail(l)}, n − 1) · SE of subject-normalised values · √(J / (J − 1)) (Cousineau–Morey)`,
  },
  heuristic_se: {
    kind: 'heuristic_se',
    centre: 'mean',
    defaultLevel: 0.95,
    shortLabel: (l) => `± ${z(l)} × mean voxel SE (heuristic)`,
    menuLabel: (l) => `Heuristic band: ± ${z(l)} × mean voxel SE (not a CI)`,
    definition: (l, centre = 'mean') =>
      `regional ${centre} ± z(${tail(l)}) · mean voxel SE (heuristic; not a confidence interval)`,
  },
  custom: {
    kind: 'custom',
    centre: 'any',
    shortLabel: (_l, d) => d?.trim() || 'interval (definition not supplied)',
    menuLabel: (_l, d) => d?.trim() || 'Interval (definition not supplied)',
    definition: (_l, _c, d) => d?.trim() || 'definition not supplied',
  },
};

export function isIntervalKind(value: unknown): value is IntervalKind {
  return typeof value === 'string' && (INTERVAL_KIND_IDS as readonly string[]).includes(value);
}

export function intervalDef(kind: IntervalKind): IntervalKindDef {
  return DEFS[kind];
}

/** Named choices the UI offers; surfaces pick and order their own lists. */
export const INTERVAL_PRESETS = {
  none: { kind: 'none' },
  sd: { kind: 'sd' },
  se: { kind: 'se' },
  ciNormal95: { kind: 'ci_normal', level: 0.95 },
  ciT95: { kind: 'ci_t', level: 0.95 },
  iqr: { kind: 'quantile_range', level: 0.5 },
  quantile95: { kind: 'quantile_range', level: 0.95 },
} as const satisfies Record<string, IntervalChoice>;

export const NO_INTERVAL: IntervalSpec = { kind: 'none', source: 'compute' };

/** A choice brainflow computes itself. */
export const computedInterval = (c: IntervalChoice): IntervalSpec => ({ ...c, source: 'compute' });

/**
 * Why a choice is unusable, or null. Kinds with a level must have one in
 * (0, 1); kinds without must not carry one.
 */
export function intervalChoiceError(c: unknown): string | null {
  const choice = c as Partial<IntervalChoice> | null;
  if (!choice || typeof choice !== 'object' || !isIntervalKind(choice.kind))
    return `Unknown interval kind: ${String(choice?.kind ?? choice)}`;
  const takesLevel = DEFS[choice.kind].defaultLevel !== undefined;
  if (takesLevel && !(typeof choice.level === 'number' && choice.level > 0 && choice.level < 1))
    return `The ${choice.kind} interval needs a level between 0 and 1.`;
  if (!takesLevel && choice.level !== undefined)
    return `The ${choice.kind} interval takes no level.`;
  return null;
}

/** Fill the default level for a kind that takes one; drop a level it doesn't. */
export function withDefaultLevel(c: IntervalChoice): IntervalChoice {
  const def = DEFS[c.kind];
  if (def.defaultLevel === undefined) return { kind: c.kind };
  return { kind: c.kind, level: c.level ?? def.defaultLevel };
}

/** Kinds valid around a summary centre (validation and menus). */
export function intervalFitsCentre(kind: IntervalKind, centre: 'mean' | 'median'): boolean {
  const c = DEFS[kind].centre;
  return c === 'any' || c === centre;
}

/**
 * The string form of a choice: `kind` or `kind@level`. Used as a menu value
 * and as the bridge's `band` argument (plan Q2: no separate level argument).
 */
export function intervalKey(c: IntervalChoice): string {
  return c.level === undefined ? c.kind : `${c.kind}@${Number(c.level.toFixed(6))}`;
}

export function parseIntervalKey(key: string): IntervalChoice | null {
  const [kind, level, extra] = key.split('@');
  if (extra !== undefined || !isIntervalKind(kind)) return null;
  const choice: IntervalChoice = level === undefined ? { kind } : { kind, level: Number(level) };
  return intervalChoiceError(choice) ? null : choice;
}

export const sameInterval = (a: IntervalChoice, b: IntervalChoice) =>
  intervalKey(a) === intervalKey(b);

export function intervalLabel(s: IntervalChoice & { definition?: string }): string {
  return DEFS[s.kind].shortLabel(s.level, s.definition);
}

export function intervalMenuLabel(s: IntervalChoice & { definition?: string }): string {
  return DEFS[s.kind].menuLabel(s.level, s.definition);
}

export function intervalDefinition(
  s: IntervalChoice & { definition?: string },
  centre?: string,
): string {
  return DEFS[s.kind].definition(s.level, centre, s.definition);
}

/** Menu options for a list of choices: `{ value: intervalKey, label }`. */
export function intervalOptions(
  choices: readonly IntervalChoice[],
  style: 'short' | 'menu' = 'menu',
): { value: string; label: string }[] {
  return choices.map((c) => ({
    value: intervalKey(c),
    label: c.kind === 'none' ? 'None' : style === 'short' ? intervalLabel(c) : intervalMenuLabel(c),
  }));
}

/** "mean ± 95% CI (t)", "median, IQR", "mean ± SD", "mean". */
export function centreBandPhrase(
  centre: string,
  s: IntervalChoice & { definition?: string },
): string {
  if (s.kind === 'none') return centre;
  const label = intervalLabel(s);
  if (s.kind === 'quantile_range' || s.kind === 'custom') return `${centre}, ${label}`;
  return `${centre} ${label.startsWith('±') ? label : `± ${label}`}`;
}

/**
 * Bounds for one cell, or null when the kind can't be computed per cell, takes
 * no bounds, or there are fewer than two values.
 */
export function computeInterval(
  c: IntervalChoice,
  values: readonly number[],
  centre: number,
): IntervalBounds | null {
  const def = DEFS[c.kind];
  if (!def.compute || !Number.isFinite(centre)) return null;
  return def.compute(values, centre, c.level ?? def.defaultLevel ?? 0.95);
}
