/**
 * Spec resolution: turn a {@link SampleFrame} (+ optional user override) into a
 * concrete {@link ResolvedPlotSpec} a mark renderer can consume.
 *
 * Defaults are inferred from column *roles* — the "data-dependent" behaviour —
 * so the same dataset always opens with a sensible plot, while the user can
 * rebind any channel or switch marks on top (the parameterization). Provider
 * frames may carry an explicit `meta.suggested` hint (the locus knows what it
 * produced); inference prefers it, then falls back to role heuristics so
 * frames from any source still resolve.
 *
 * Step 2 ships the resolver + basic inference; step 4 enriches the heuristics
 * and adds named presets.
 */

import type { Encoding, Mark, PlotSpec, SampleFrame, Transform } from './types';
import { columnsByRole, getColumn } from './frame';

/** Channels a user/inference can bind, in a stable order for UI. */
export const ENCODING_CHANNELS = ['x', 'y', 'color', 'facet', 'detail'] as const;
export type EncodingChannel = (typeof ENCODING_CHANNELS)[number];

/**
 * A dispersion band binding: the frame columns holding the lower and upper
 * bounds of a CI/error ribbon, drawn under a line/area mark. Distinct from the
 * `x`/`y` encoding channels because a band spans two y positions per x, not one
 * (the same reason Vega-Lite splits `y`/`y2` for ranged area).
 */
export interface BandEncoding {
  readonly lower: string;
  readonly upper: string;
}

/** An explicit default hint a producer can attach via `frame.meta.suggested`. */
export interface SuggestedSpec {
  readonly mark: Mark;
  readonly encoding: Encoding;
  /** Optional CI/error ribbon columns (e.g. the cross-set trace). */
  readonly band?: BandEncoding;
}

/** A fully concrete spec: mark + frame-valid encoding + transforms + params. */
export interface ResolvedPlotSpec {
  readonly mark: Mark;
  readonly encoding: Encoding;
  readonly transforms: readonly Transform[];
  readonly params: Readonly<Record<string, unknown>>;
  /**
   * Resolved CI/error band, present only when the frame suggested one AND both
   * bound columns exist in the current frame. Line/area marks draw it as a
   * shaded ribbon; other marks ignore it.
   */
  readonly band?: BandEncoding;
}

function readSuggested(frame: SampleFrame): SuggestedSpec | undefined {
  const s = frame.meta?.suggested as SuggestedSpec | undefined;
  return s && typeof s.mark === 'string' && s.encoding ? s : undefined;
}

/**
 * Resolve a suggested band against the current frame: kept only when both bound
 * columns actually exist, so a stale band (carried across a dataset switch) can
 * never reference a missing column.
 */
function resolveBand(
  frame: SampleFrame,
  suggested: SuggestedSpec | undefined,
): BandEncoding | undefined {
  const band = suggested?.band;
  if (!band) return undefined;
  if (getColumn(frame, band.lower) && getColumn(frame, band.upper)) {
    return { lower: band.lower, upper: band.upper };
  }
  return undefined;
}

/**
 * Among `candidates`, pick the best grouping column for a by-factor plot: one
 * with >= 2 distinct non-null values where at least one level repeats (so it
 * forms real groups, not a per-row identifier like a subject id), preferring
 * the lowest cardinality. Role-agnostic, so a numeric-coded factor ("1"/"2")
 * is still eligible. Returns undefined when no candidate groups the data.
 */
export function pickGroupingColumn(
  frame: SampleFrame,
  candidates: readonly string[],
): string | undefined {
  let best: { name: string; distinct: number } | undefined;
  for (const name of candidates) {
    if (!getColumn(frame, name)) continue;
    const vals = frame.rows.map((r) => r[name]).filter((v) => v !== null && v !== '');
    if (vals.length < 2) continue;
    const distinct = new Set(vals).size;
    if (distinct >= 2 && distinct < vals.length && (!best || distinct < best.distinct)) {
      best = { name, distinct };
    }
  }
  return best?.name;
}

/** True when any value of `column` repeats across rows (a per-level distribution). */
function hasMultiplePerLevel(frame: SampleFrame, column: string): boolean {
  const seen = new Set<unknown>();
  for (const row of frame.rows) {
    const key = row[column];
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

/**
 * Infer a default {@link PlotSpec} from a frame. Honours a producer's
 * `meta.suggested` hint first, then role heuristics:
 *   temporal × quantitative -> line; nominal × quantitative -> bar;
 *   quantitative × quantitative -> point; single quantitative -> hist.
 */
export function inferDefaultSpec(frame: SampleFrame): PlotSpec {
  const suggested = readSuggested(frame);
  if (suggested) {
    return { mark: suggested.mark, encoding: { ...suggested.encoding } };
  }

  const quant = columnsByRole(frame, 'quantitative');
  const temporal = columnsByRole(frame, 'temporal');
  const ordinal = columnsByRole(frame, 'ordinal');
  const nominal = columnsByRole(frame, 'nominal');

  if (temporal.length >= 1 && quant.length >= 1) {
    return {
      mark: 'line',
      encoding: { x: temporal[0].name, y: quant[0].name },
    };
  }
  if ((nominal.length >= 1 || ordinal.length >= 1) && quant.length >= 1) {
    const cat = (ordinal[0] ?? nominal[0]).name;
    // One value per category -> bar (e.g. region means); a distribution
    // (multiple rows per category) -> box (e.g. value grouped by factor).
    const mark = hasMultiplePerLevel(frame, cat) ? 'box' : 'bar';
    return { mark, encoding: { x: cat, y: quant[0].name } };
  }
  if (quant.length >= 2) {
    return { mark: 'point', encoding: { x: quant[0].name, y: quant[1].name } };
  }
  if (quant.length === 1) {
    return { mark: 'hist', encoding: { x: quant[0].name } };
  }
  return { mark: 'point', encoding: {} };
}

/** Keep only the encoding channels whose bound column exists in the frame. */
function validEncoding(frame: SampleFrame, encoding: Encoding): Record<string, string> {
  const out: Record<string, string> = {};
  for (const ch of ENCODING_CHANNELS) {
    const col = encoding[ch];
    if (col && getColumn(frame, col)) out[ch] = col;
  }
  return out;
}

/**
 * Resolve a frame plus an optional user override into a concrete spec. The
 * inferred default supplies the baseline (always frame-valid); the override
 * then changes the mark and/or rebinds channels — but only to columns that
 * exist in the *current* frame, so a stale override (e.g. carried across a
 * dataset switch) can never bind a channel to a missing column.
 */
export function resolveSpec(
  frame: SampleFrame,
  override?: Partial<PlotSpec> | null,
): ResolvedPlotSpec {
  const base = inferDefaultSpec(frame);
  // Mutable working copy; assignable to the readonly Encoding on return.
  const encoding: Record<string, string> = validEncoding(frame, base.encoding);

  if (override?.encoding) {
    for (const ch of ENCODING_CHANNELS) {
      const col = override.encoding[ch];
      if (col === undefined) continue;
      // Empty string clears a channel; a name binds it only if it exists.
      if (col === '') delete encoding[ch];
      else if (getColumn(frame, col)) encoding[ch] = col;
    }
  }

  const band = resolveBand(frame, readSuggested(frame));

  return {
    mark: override?.mark ?? base.mark,
    encoding,
    transforms: override?.transforms ?? base.transforms ?? [],
    params: override?.params ?? base.params ?? {},
    ...(band ? { band } : {}),
  };
}
