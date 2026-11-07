/**
 * Tolerant reader for interval descriptions from other tools (neurotabs
 * frames, R/broom output, CSV). Known spelling variants map onto the canonical
 * vocabulary; anything ambiguous is an error with the reason, never a guess.
 * Brainflow itself writes only canonical names (`types.ts`).
 *
 * Every alias table below is plain data: adding a variant is one line plus a
 * test.
 */
import type { FrameColumn, FrameRow, SampleFrame } from '../types';
import {
  INTERVAL_PRESETS,
  intervalChoiceError,
  isIntervalKind,
  withDefaultLevel,
} from './registry';
import type { IntervalChoice, IntervalKind, IntervalSpec } from './types';
import { INTERVAL_COLUMNS } from './types';

/** Kind spellings after normalisation (lower case, `_` separators, level removed). */
const KIND_ALIASES: Readonly<Record<string, IntervalChoice>> = {
  t: { kind: 'ci_t' },
  t_ci: { kind: 'ci_t' },
  ci_student: { kind: 'ci_t' },
  student_t: { kind: 'ci_t' },
  normal: { kind: 'ci_normal' },
  z: { kind: 'ci_normal' },
  ci_z: { kind: 'ci_normal' },
  wald: { kind: 'ci_normal' },
  normal_ci: { kind: 'ci_normal' },
  sem: { kind: 'se' },
  stderr: { kind: 'se' },
  std_error: { kind: 'se' },
  standard_error: { kind: 'se' },
  std: { kind: 'sd' },
  stdev: { kind: 'sd' },
  std_dev: { kind: 'sd' },
  standard_deviation: { kind: 'sd' },
  iqr: INTERVAL_PRESETS.iqr,
  quantile: { kind: 'quantile_range' },
  quantiles: { kind: 'quantile_range' },
  percentile: { kind: 'quantile_range' },
  percentiles: { kind: 'quantile_range' },
  pi_quantile: { kind: 'quantile_range' },
  cousineau_morey: { kind: 'wsci_cm' },
  morey: { kind: 'wsci_cm' },
  wsci: { kind: 'wsci_cm' },
  ws_ci: { kind: 'wsci_cm' },
  within_subject_ci: { kind: 'wsci_cm' },
  heuristic: { kind: 'heuristic_se' },
  '': { kind: 'none' },
};

/** Tokens that don't say what was computed; refused with a reason. */
const AMBIGUOUS: Readonly<Record<string, string>> = {
  ci: 'a CI without its method; state t, normal or within-subject, or give a definition (custom)',
  conf_int:
    'a CI without its method; state t, normal or within-subject, or give a definition (custom)',
  pi: 'a "prediction interval" without its method; state quantile, or give a definition (custom)',
  sem95: 'a legacy brainflow name whose meaning depended on the plot; use ci_normal@0.95',
  ci95: 'a legacy brainflow name whose meaning depended on the plot; use ci_t, ci_normal or quantile_range',
};

/** Bound column pairs, tried in order when the input doesn't name them. */
const BOUND_PAIRS: readonly (readonly [string, string])[] = [
  ['lower', 'upper'],
  ['ci_low', 'ci_high'],
  ['ci_lower', 'ci_upper'],
  ['conf.low', 'conf.high'],
  ['lwr', 'upr'],
  ['ymin', 'ymax'],
  ['band_low', 'band_high'],
  ['lower_ci', 'upper_ci'],
];

/** Half-width columns (bounds = centre ± margin). */
const MARGIN_COLUMNS = ['margin', 'half_width', 'halfwidth', 'moe'];

/** Per-row metadata columns: canonical name ← accepted spellings, in order. */
const ROW_ALIASES: Readonly<Record<keyof typeof INTERVAL_COLUMNS, readonly string[]>> = {
  kind: [INTERVAL_COLUMNS.kind, 'interval_type', 'band_kind'],
  level: [INTERVAL_COLUMNS.level, 'conf.level', 'interval_level'],
  df: [INTERVAL_COLUMNS.df, 'interval_df', 'dof'],
  n: [INTERVAL_COLUMNS.n, 'n_obs', 'nobs'],
};

export type IngestResult<T> = { readonly ok: T } | { readonly error: string };

/** 0.95, 95 and "95%" → 0.95. */
export function parseLevel(value: unknown): IngestResult<number> {
  const text = typeof value === 'string' ? value.trim().replace(/%$/, '') : value;
  const n =
    typeof text === 'number'
      ? text
      : typeof text === 'string' && text !== ''
        ? Number(text)
        : Number.NaN;
  const percent = typeof value === 'string' && value.trim().endsWith('%');
  // A bare number above 1 is a percentage only in the range levels are given in.
  const level = percent || (n >= 50 && n < 100) ? n / 100 : n;
  return level > 0 && level < 1
    ? { ok: Number(level.toFixed(6)) }
    : { error: `Unreadable interval level: ${String(value)}` };
}

/**
 * A kind token with any embedded level (`ci95_t`, `95%CI-t`, `quantile_90`)
 * split off. A separate `level` that conflicts with an embedded one is an error.
 */
export function parseIntervalKind(token: unknown, level?: unknown): IngestResult<IntervalChoice> {
  if (token !== undefined && token !== null && typeof token !== 'string')
    return { error: `Unreadable interval kind: ${String(token)}` };
  const raw = (token ?? '')
    .trim()
    .toLowerCase()
    // Separators become `_`; a dot between digits (99.5) is kept.
    .replace(/[\s\-/()]+|\.(?!\d)/g, '_')
    .replace(/^_+|_+$/g, '');
  if (Object.hasOwn(AMBIGUOUS, raw)) return { error: `"${token}" is ${AMBIGUOUS[raw]}.` };
  const embedded = /(?:^|_|[a-z])(\d{2}(?:\.\d+)?)%?(?=$|_|[a-z])/.exec(raw);
  const name = embedded
    ? raw.replace(embedded[1], '').replace(/%/g, '').replace(/_+/g, '_').replace(/^_|_$/g, '')
    : raw;
  if (name !== raw && Object.hasOwn(AMBIGUOUS, name)) return { error: `"${token}" is ${AMBIGUOUS[name]}.` };
  const base: IntervalChoice | null = isIntervalKind(name)
    ? { kind: name as IntervalKind }
    : Object.hasOwn(KIND_ALIASES, name)
      ? KIND_ALIASES[name]
      : null;
  if (!base) return { error: `Unknown interval kind: "${token}".` };
  let chosen = base.level;
  for (const source of [embedded?.[1], level]) {
    if (source === undefined || source === null || source === '') continue;
    const parsed = parseLevel(source);
    if ('error' in parsed) return parsed;
    if (chosen !== undefined && Math.abs(chosen - parsed.ok) > 1e-9)
      return { error: `Conflicting interval levels for "${token}": ${chosen} and ${parsed.ok}.` };
    chosen = parsed.ok;
  }
  // No default levels: a level the producer didn't state is not invented.
  const takesLevel = withDefaultLevel({ kind: base.kind }).level !== undefined;
  if (!takesLevel && chosen !== undefined)
    return { error: `The ${base.kind} interval takes no level ("${token}").` };
  if (takesLevel && chosen === undefined)
    return { error: `The ${base.kind} interval needs a stated level ("${token}").` };
  const choice: IntervalChoice = takesLevel ? { kind: base.kind, level: chosen } : { kind: base.kind };
  const err = intervalChoiceError(choice);
  return err ? { error: err } : { ok: choice };
}

/** What a producer said about its interval; every field optional. */
export interface IntervalDescription {
  readonly kind?: unknown;
  readonly level?: unknown;
  readonly lower?: string;
  readonly upper?: string;
  /** Half-width column; bounds become `centre ± margin`. */
  readonly margin?: string;
  /** Centre column for the half-width form (default `value`). */
  readonly centre?: string;
  readonly definition?: string;
}

const has = (frame: SampleFrame, name: string) => frame.columns.some((c) => c.name === name);

/**
 * Normalise an interval description against a frame: resolve the bounds (named,
 * detected from known pairs, or built from a half-width), copy per-row metadata
 * into the canonical columns, and return a `source: 'columns'` spec. With no
 * stated kind the bounds are `custom` (labelled "definition not supplied")
 * unless every row states the same kind.
 */
export function normalizeInterval(
  input: IntervalDescription,
  frame: SampleFrame,
): IngestResult<{ spec: IntervalSpec; frame: SampleFrame }> {
  let columns: FrameColumn[] = [...frame.columns];
  let rows: FrameRow[] = frame.rows.map((r) => ({ ...r }));
  const addColumn = (column: FrameColumn) => {
    if (!columns.some((c) => c.name === column.name)) columns = [...columns, column];
  };

  // Bounds.
  let lower = input.lower;
  let upper = input.upper;
  if (lower || upper) {
    for (const c of [lower, upper])
      if (!c || !has(frame, c))
        return { error: `Interval bound column is unavailable: ${c ?? '(unnamed)'}` };
  } else {
    const pairs = BOUND_PAIRS.filter(([lo, hi]) => has(frame, lo) && has(frame, hi));
    if (pairs.length > 1)
      return {
        error: `Several bound column pairs: ${pairs.map((p) => p.join('/')).join(', ')}. Name the pair to draw.`,
      };
    if (pairs.length === 1) [lower, upper] = pairs[0];
    else {
      const margins = input.margin ? [input.margin] : MARGIN_COLUMNS.filter((c) => has(frame, c));
      if (margins.length > 1)
        return { error: `Several half-width columns: ${margins.join(', ')}.` };
      const margin = margins[0];
      const centre = input.centre ?? 'value';
      if (!margin || !has(frame, margin) || !has(frame, centre))
        return { error: 'No interval bounds: name lower/upper columns or a half-width column.' };
      if (has(frame, 'lower') || has(frame, 'upper'))
        return { error: 'A half-width would overwrite existing lower/upper columns.' };
      rows = rows.map((r) => {
        const c = r[centre];
        const m = r[margin];
        const ok =
          typeof c === 'number' &&
          typeof m === 'number' &&
          Number.isFinite(c) &&
          Number.isFinite(m);
        return { ...r, lower: ok ? c - m : null, upper: ok ? c + m : null };
      });
      addColumn({ name: 'lower', role: 'quantitative' });
      addColumn({ name: 'upper', role: 'quantitative' });
      [lower, upper] = ['lower', 'upper'];
    }
  }

  // Per-row metadata into canonical columns (first matching spelling wins).
  const levelSource = ROW_ALIASES.level.find((name) => has(frame, name));
  for (const key of Object.keys(ROW_ALIASES) as (keyof typeof INTERVAL_COLUMNS)[]) {
    const canonical = INTERVAL_COLUMNS[key];
    const source = ROW_ALIASES[key].find((name) => has(frame, name));
    if (!source) continue;
    rows = rows.map((r) => {
      const v = r[source];
      if (key === 'kind') {
        if (typeof v !== 'string' || v.trim() === '') return { ...r, [canonical]: null };
        const ownLevel = levelSource ? r[levelSource] : undefined;
        // The row's own level column completes a kind that needs one; a row's
        // kind that conflicts with it is kept in its own words.
        const parsed = parseIntervalKind(v, ownLevel);
        // An unreadable per-row kind keeps its own words (labelled as custom).
        return {
          ...r,
          [canonical]: 'ok' in parsed ? parsed.ok.kind : v,
          ...('ok' in parsed && parsed.ok.level !== undefined && r[INTERVAL_COLUMNS.level] == null
            ? { [INTERVAL_COLUMNS.level]: parsed.ok.level }
            : {}),
        };
      }
      if (key === 'level') {
        if (v === null || v === undefined || v === '')
          return { ...r, [canonical]: r[canonical] ?? null };
        const parsed = parseLevel(v);
        return { ...r, [canonical]: 'ok' in parsed ? parsed.ok : null };
      }
      return { ...r, [canonical]: typeof v === 'number' && Number.isFinite(v) ? v : null };
    });
    addColumn({ name: canonical, role: key === 'kind' ? 'nominal' : 'quantitative' });
  }

  // The frame-level kind: stated, else the rows' consensus, else custom.
  let choice: IntervalChoice;
  if (input.kind !== undefined && input.kind !== null && input.kind !== '') {
    const parsed = parseIntervalKind(input.kind, input.level);
    if ('error' in parsed) return parsed;
    choice = parsed.ok;
  } else {
    const distinct = (col: string) =>
      new Set(rows.map((r) => r[col]).filter((v) => v !== null && v !== undefined && v !== ''));
    const kinds = distinct(INTERVAL_COLUMNS.kind);
    const levels = distinct(INTERVAL_COLUMNS.level);
    const only = kinds.size === 1 ? [...kinds][0] : null;
    const level = levels.size === 1 ? ([...levels][0] as number) : undefined;
    choice =
      typeof only === 'string' && isIntervalKind(only) && only !== 'none'
        ? withDefaultLevel(level === undefined ? { kind: only } : { kind: only, level })
        : { kind: 'custom' };
    // Rows of one kind but several (or no) levels: no frame-level level is invented.
    if (choice.kind !== 'custom' && choice.level !== undefined && level === undefined) choice = { kind: 'custom' };
  }
  if (choice.kind === 'none')
    return { error: 'Bounds were supplied with the interval kind "none".' };

  const spec: IntervalSpec = {
    ...choice,
    source: 'columns',
    lower,
    upper,
    ...(input.definition?.trim() ? { definition: input.definition.trim() } : {}),
  };
  return { ok: { spec, frame: { ...frame, columns, rows } } };
}
