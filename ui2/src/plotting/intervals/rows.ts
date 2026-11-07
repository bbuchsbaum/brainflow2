/**
 * Which interval a frame's bounds describe. Label resolution order:
 *   1. the row's own `interval_kind` / `interval_level`;
 *   2. the frame's declaration (a population summary's
 *      `meta.populationReduction.interval`, else `meta.interval`);
 *   3. nothing: the bounds are drawn but called "interval (definition not
 *      supplied)", never given a computed kind's name.
 */
import type { FrameRow, SampleFrame } from '../types';
import { intervalChoiceError, intervalKey, isIntervalKind } from './registry';
import type { IntervalChoice, IntervalSpec } from './types';
import { INTERVAL_COLUMNS } from './types';

export type LabelledInterval = IntervalChoice & { readonly definition?: string };

const UNLABELLED: LabelledInterval = { kind: 'custom' };

/** The frame-level declaration, if any. */
export function frameInterval(frame: SampleFrame): LabelledInterval | null {
  const meta = frame.meta as
    | {
        interval?: Partial<IntervalSpec>;
        populationReduction?: { interval?: Partial<IntervalSpec> };
      }
    | undefined;
  // A population stage's declaration wins over one carried from its input frame.
  const declared = meta?.populationReduction?.interval ?? meta?.interval;
  if (!declared || intervalChoiceError(declared)) return null;
  return {
    kind: declared.kind!,
    ...(declared.level === undefined ? {} : { level: declared.level }),
    ...(declared.definition ? { definition: declared.definition } : {}),
  };
}

/**
 * The interval one row's bounds describe. An unrecognised per-row kind is kept
 * as a `custom` interval named by the row's own text, not mapped to a guess.
 */
export function rowInterval(row: FrameRow, declared: LabelledInterval | null): LabelledInterval {
  const raw = row[INTERVAL_COLUMNS.kind];
  if (typeof raw !== 'string' || raw === '') return declared ?? UNLABELLED;
  if (!isIntervalKind(raw)) return { kind: 'custom', definition: raw };
  const levelCell = row[INTERVAL_COLUMNS.level];
  const level =
    typeof levelCell === 'number' && Number.isFinite(levelCell)
      ? levelCell
      : declared?.kind === raw
        ? declared.level
        : undefined;
  const choice: LabelledInterval = { kind: raw, ...(level === undefined ? {} : { level }) };
  if (intervalChoiceError(choice)) return { kind: 'custom', definition: raw };
  return raw === 'custom' && declared?.kind === 'custom' ? declared : choice;
}

/**
 * One interval for the whole frame (legend, plot label), or `'mixed'` when the
 * rows that carry bounds disagree. Null when no row carries bounds and nothing
 * is declared.
 */
export function frameIntervalSummary(
  frame: SampleFrame,
  bounds: { lower: string; upper: string } = { lower: 'lower', upper: 'upper' },
): LabelledInterval | 'mixed' | null {
  const declared = frameInterval(frame);
  const seen = new Map<string, LabelledInterval>();
  for (const row of frame.rows) {
    const lo = row[bounds.lower];
    const hi = row[bounds.upper];
    if (typeof lo !== 'number' || typeof hi !== 'number') continue;
    const iv = rowInterval(row, declared);
    seen.set(`${intervalKey(iv)}|${iv.definition ?? ''}`, iv);
  }
  if (seen.size > 1) return 'mixed';
  return seen.size === 1 ? [...seen.values()][0] : declared;
}
