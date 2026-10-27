/**
 * Small readers for population plots (phase 4 E4): the numeric range of an
 * axis column (default transform windows) and a one-line statement of the
 * declared transforms from the frame's provenance.
 */
import type { SampleFrame } from '@/plotting';
import { populationTransformSummary } from '@/services/studio/populationPlot';

export function numericRange(frame: SampleFrame, column: string): [number, number] | null {
  const values = frame.rows.map((r) => Number(r[column])).filter(Number.isFinite);
  return values.length ? [Math.min(...values), Math.max(...values)] : null;
}

/**
 * "baseline: lag 0 TR subtracted per participant; faces − houses, paired"
 * (a caption clause: lower case, no full stop; empty without transforms).
 */
export function transformSummary(frame: SampleFrame): string {
  return populationTransformSummary(frame);
}

/** The same clause as a sentence ("Baseline: … paired. "), for running text. */
export function transformSentence(frame: SampleFrame): string {
  const clause = populationTransformSummary(frame);
  return clause ? `${clause[0].toUpperCase()}${clause.slice(1)}. ` : '';
}
