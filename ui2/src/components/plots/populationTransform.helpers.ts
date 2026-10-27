/**
 * Small readers for population plots (phase 4 E4): the numeric range of an
 * axis column (default transform windows) and a one-line statement of the
 * declared transforms from the frame's provenance.
 */
import type { SampleFrame } from '@/plotting';
import type { PopulationTransformRecord } from '@/services/studio/populationPlot';

export function numericRange(frame: SampleFrame, column: string): [number, number] | null {
  const values = frame.rows.map((r) => Number(r[column])).filter(Number.isFinite);
  return values.length ? [Math.min(...values), Math.max(...values)] : null;
}

/** "Baseline 0–0 subtracted; faces − houses (2 of 3 participants paired)." */
export function transformSummary(frame: SampleFrame): string {
  const records = frame.meta?.populationTransforms as PopulationTransformRecord[] | undefined;
  if (!records?.length) return '';
  return records
    .map(({ transform: t, linesIn, linesOut }) => {
      const kept = linesOut < linesIn ? ` (${linesOut} of ${linesIn} lines kept)` : '';
      if (t.kind === 'baseline') return `Baseline ${t.from}–${t.to} subtracted${kept}`;
      if (t.kind === 'windowMean') return `Mean over ${t.from}–${t.to}${kept}`;
      return `${t.a} − ${t.b}, paired${linesOut < linesIn ? ` (${linesOut} of ${linesIn} participants paired)` : ''}`;
    })
    .join('; ')
    .concat('.');
}
