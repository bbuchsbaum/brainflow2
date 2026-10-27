/**
 * How a series reads (phase 4 v1, critique fixes F6/F7/F11): the axis
 * parameters the plot is drawn with and the caption grammar
 *   <x quantity (unit)> · <centre ± band> · n participants · <locus, voxels> · <transforms>
 * with the cluster definition for a cluster locus and the normal-approximation
 * note for ± 1.96 SE at small n.
 */
import type { ResolvedPlotSpec, SampleFrame } from '@/plotting';
import type { PopulationPlotRecipe } from '@/services/studio/populationPlot';
import { SERIES_X, type SetSeriesBinding } from './seriesBinding';
import { bandDescription, seriesAxisTitle } from './seriesRecipe';

/** Plot params: axis titles, integer lag ticks, half-step padding, a zero line on differences. */
export function seriesPlotParams(
  binding: SetSeriesBinding,
  frame: SampleFrame,
  recipe: PopulationPlotRecipe,
  yTitle: string,
): Record<string, unknown> {
  const xs = [...new Set(frame.rows.map((r) => Number(r[SERIES_X])).filter(Number.isFinite))].sort((a, b) => a - b);
  const step = xs.length > 1 ? Math.min(...xs.slice(1).map((x, i) => x - xs[i])) : 1;
  const integer = xs.every(Number.isInteger);
  const differences = (recipe.transforms ?? []).some((t) => t.kind === 'conditionDifference' || t.kind === 'baseline');
  return {
    xTitle: seriesAxisTitle(binding),
    yTitle,
    xIntegerTicks: integer,
    xPadHalfStep: step,
    zeroLine: differences,
  };
}

/** Voxels in the locus: the most any member reported (they share one grid). */
export function locusVoxels(frame: SampleFrame): number | null {
  const counts = (frame.meta?.sources ?? []).map((s) => s.validCount).filter((n): n is number => typeof n === 'number');
  return counts.length ? Math.max(...counts) : null;
}

/**
 * The spec a series is drawn with: the axis params, and for a window mean
 * (one value per condition) the conditions along x, as points with their
 * band as error bars (v1 user 3).
 */
export function seriesSpec(spec: ResolvedPlotSpec, recipe: PopulationPlotRecipe, params: Record<string, unknown>): ResolvedPlotSpec {
  const collapsed = (recipe.transforms ?? []).some((t) => t.kind === 'windowMean');
  if (collapsed && recipe.color) {
    return {
      ...spec,
      encoding: { ...spec.encoding, x: recipe.color },
      params: { ...spec.params, ...params, xTitle: undefined, xIntegerTicks: false, xPadHalfStep: undefined, jitter: false },
    };
  }
  return { ...spec, params: { ...spec.params, ...params } };
}

const csvCell = (v: unknown) => {
  const text = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * The plotted series as CSV (v1 user 4): per condition × position, n, centre,
 * band low / high and its definition, with the caption (locus, axis,
 * transforms) as a leading comment. ASCII minus.
 */
export function seriesCsv(
  frame: SampleFrame,
  recipe: PopulationPlotRecipe,
  binding: SetSeriesBinding,
  caption: string,
): string {
  const reduction = frame.meta?.populationReduction as { bandDefinition?: string } | undefined;
  const x = binding.kind === 'lag' ? 'lag' : 'time';
  const header = [
    binding.unit ? `${x}_${binding.unit}` : x,
    'condition',
    'n',
    recipe.summary === 'none' ? 'value' : recipe.summary,
    'band_low',
    'band_high',
    'band_definition',
  ];
  const ascii = (t: string) => t.replace(/[−\u2212]/g, '-').replace(/±/g, '+/-').replace(/≥/g, '>=').replace(/≤/g, '<=');
  const rows = frame.rows.map((r) => [
    r[SERIES_X],
    recipe.color ? r[recipe.color] : '',
    r.count ?? '',
    r.value,
    r.lower ?? '',
    r.upper ?? '',
    reduction?.bandDefinition ?? '',
  ]);
  return [`# ${ascii(caption)}`, header.join(','), ...rows.map((row) => row.map((c) => csvCell(typeof c === 'string' ? ascii(c) : c)).join(','))].join('\n') + '\n';
}

export interface SeriesCaptionInput {
  binding: SetSeriesBinding;
  recipe: PopulationPlotRecipe;
  participants: number;
  /** "6 mm sphere at …", "region L sensorimotor", "cluster 1 of zmap (…)". */
  locus: string;
  voxels: number | null;
  transforms: string;
  /** Participants per position after transforms (df = n − 1 for the t band). */
  bandN?: number;
}

export function seriesCaption(input: SeriesCaptionInput): string {
  const { recipe, participants } = input;
  const n = input.bandN ?? participants;
  const band =
    recipe.summary === 'mean' && recipe.band === 'ci95'
      ? `mean ± 95% CI (t, df = ${Math.max(0, n - 1)})`
      : recipe.band === 'sem95' && n < 30
        ? `${bandDescription(recipe)} (normal approx., n = ${n})`
        : bandDescription(recipe);
  const parts = [
    seriesAxisTitle(input.binding),
    band,
    `${participants} participant${participants === 1 ? '' : 's'}`,
    input.voxels !== null ? `${input.locus}, ${input.voxels.toLocaleString('en-US')} voxel${input.voxels === 1 ? '' : 's'}` : input.locus,
  ];
  if (input.transforms) parts.push(input.transforms.replace(/\.$/, ''));
  return parts.join(' · ');
}
