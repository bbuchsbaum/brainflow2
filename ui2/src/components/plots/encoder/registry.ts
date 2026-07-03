/**
 * Mark registry — the lookup {@link PlotEncoder} dispatches on, plus the list of
 * marks the encoder can render today (drives the panel's mark switch).
 *
 * Kept separate from `PlotEncoder.tsx` so that component file exports only a
 * component (fast-refresh friendly); adding a mark is a one-line edit here.
 */

import type { Mark } from '@/plotting';

import { areaMark, barMark, boxMark, heatmapMark, lineMark, pointMark } from './cartesianMarks';
import { histMark } from './histMark';
import type { MarkRenderer } from './types';

export const MARK_RENDERERS: Partial<Record<Mark, MarkRenderer>> = {
  line: lineMark,
  area: areaMark,
  point: pointMark,
  bar: barMark,
  box: boxMark,
  heatmap: heatmapMark,
  hist: histMark,
};

/** Marks the encoder can render today. */
export const SUPPORTED_MARKS: Mark[] = ['line', 'area', 'point', 'bar', 'box', 'heatmap', 'hist'];
