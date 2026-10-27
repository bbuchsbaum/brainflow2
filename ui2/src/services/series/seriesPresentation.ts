/**
 * How a series reads (phase 4 v1, critique fixes F6/F7/F11): the axis
 * parameters the plot is drawn with and the caption grammar
 *   <centre ± band> · n participants · <locus, voxels> · <transforms>
 * with the cluster definition for a cluster locus and the normal-approximation
 * note for ± 1.96 SE at small n.
 */
import type { ResolvedPlotSpec, SampleFrame } from '@/plotting';
import { populationTransformSummary, type PopulationPlotRecipe } from '@/services/studio/populationPlot';
import { SERIES_X, type SetSeriesBinding } from './seriesBinding';
import { bandDescription, seriesAxisTitle } from './seriesRecipe';
import type { useClusterStore } from '@/stores/clusterStore';
import { useLayerStore } from '@/stores/layerStore';
import { statisticUnits } from '@/utils/statistic';
import { formatLayerValue, formatWorldMm } from '@/utils/valueFormat';
import { shortLayerLabel, trueMinus } from '@/components/views/viewportFrame/frameFormat';

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
 * band as error bars (v1 user 3), on a y axis that includes 0 (v1 user 4).
 * A baseline window is passed on so its forced-zero positions are drawn
 * hollow, not as estimates (v1 user 7).
 */
export function seriesSpec(spec: ResolvedPlotSpec, recipe: PopulationPlotRecipe, params: Record<string, unknown>): ResolvedPlotSpec {
  const transforms = recipe.transforms ?? [];
  const collapsed = transforms.some((t) => t.kind === 'windowMean');
  if (collapsed && recipe.color) {
    return {
      ...spec,
      encoding: { ...spec.encoding, x: recipe.color },
      params: { ...spec.params, ...params, xTitle: undefined, xIntegerTicks: false, xPadHalfStep: undefined, jitter: false, yIncludeZero: true },
    };
  }
  const baseline = transforms.find((t) => t.kind === 'baseline');
  return {
    ...spec,
    params: {
      ...spec.params,
      ...params,
      ...(baseline && baseline.kind === 'baseline' ? { baselineRange: [baseline.from, baseline.to] } : {}),
    },
  };
}

const csvCell = (v: unknown) => {
  const text = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const ascii = (t: string) =>
  t.replace(/[−\u2212–]/g, '-').replace(/±/g, '+/-').replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/√\(?(\w+)\)?/g, 'sqrt($1)').replace(/·/g, '*');

/** The locus a series was sampled at, as CSV columns (stackable across loci). */
export interface SeriesCsvLocus {
  /** "voxel" | "sphere" | "region" | "cluster". */
  kind: string;
  /** "6 mm sphere at -39.5, -19.5, 50.5 mm", "region L sensorimotor", "cluster 1 of zmap". */
  label: string;
  voxels: number | null;
}

/**
 * The plotted series as CSV (v1 user 1/5), one header row and no comment
 * lines (default R / pandas readers take a `#` line as the header):
 * - participants: participant, condition, <axis>, value;
 * - population: <axis>, condition, n, <centre>, sd, se, band_low, band_high,
 *   band_definition;
 * - a window mean replaces <axis> with numeric window_from_<unit>,
 *   window_to_<unit> and window_source (declared | condition-averaged peak).
 * Every row ends with locus_kind, locus_label, n_voxels and `transforms`
 * (the declared transforms), so CSVs from several loci stack. ASCII only.
 */
export function seriesCsv(
  frame: SampleFrame,
  recipe: PopulationPlotRecipe,
  binding: SetSeriesBinding,
  /** The sampled locus; a string (a caption, from older callers) is ignored. */
  locus?: SeriesCsvLocus | string | null,
): string {
  const where: SeriesCsvLocus | null = locus && typeof locus === 'object' ? locus : null;
  const reduction = frame.meta?.populationReduction as { bandDefinition?: string } | undefined;
  const axisName = binding.kind === 'lag' ? 'lag' : 'time';
  const suffix = binding.unit ? `_${binding.unit}` : '';
  const window = (recipe.transforms ?? []).find((t) => t.kind === 'windowMean');
  const axisHeader =
    window && window.kind === 'windowMean'
      ? [`window_from${suffix}`, `window_to${suffix}`, 'window_source']
      : [`${axisName}${suffix}`];
  const axisCells = (row: Record<string, unknown>) =>
    window && window.kind === 'windowMean'
      ? [window.from, window.to, window.source === 'condition-averaged-peak' ? 'condition-averaged peak (data-driven)' : 'declared']
      : [row[SERIES_X]];
  const condition = (row: Record<string, unknown>) => (recipe.color ? row[recipe.color] : '');
  const tail = [where?.kind ?? '', where?.label ?? '', where?.voxels ?? '', populationTransformSummary(frame)];
  const tailHeader = ['locus_kind', 'locus_label', 'n_voxels', 'transforms'];
  let header: string[];
  let rows: unknown[][];
  if (recipe.summary === 'none') {
    header = ['participant', 'condition', ...axisHeader, 'value', ...tailHeader];
    rows = frame.rows.map((r) => [recipe.detail ? r[recipe.detail] : r.member, condition(r), ...axisCells(r), r.value, ...tail]);
  } else {
    header = ['condition', ...axisHeader, 'n', recipe.summary, 'sd', 'se', 'band_low', 'band_high', 'band_definition', ...tailHeader];
    rows = frame.rows.map((r) => [
      condition(r),
      ...axisCells(r),
      r.count ?? '',
      r.value,
      r.sd ?? '',
      r.se ?? '',
      r.lower ?? '',
      r.upper ?? '',
      reduction?.bandDefinition ?? '',
      ...tail,
    ]);
  }
  return [header.join(','), ...rows.map((row) => row.map((c) => csvCell(typeof c === 'string' ? ascii(c) : c)).join(','))].join('\n') + '\n';
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

/**
 * <centre ± band> · n participants · <locus, voxels> · <transforms>. The x
 * axis is titled on the plot, so the caption does not repeat it (v1 visual 6);
 * the CSV header and the exported image keep it.
 */
export function seriesCaption(input: SeriesCaptionInput): string {
  const { recipe, participants } = input;
  const n = input.bandN ?? participants;
  const band =
    recipe.summary === 'mean' && recipe.band === 'ci95'
      ? `mean ± 95% CI (t, df = ${Math.max(0, n - 1)})`
      : recipe.band === 'sem95' && n < 30
        ? `${bandDescription(recipe)} (normal approx., n = ${n})`
        : bandDescription(recipe);
  const who = `${participants} participant${participants === 1 ? '' : 's'}`;
  const one = (recipe.transforms ?? []).some((t) => t.kind === 'windowMean') ? 'point' : 'line';
  const parts = [
    // Participants mode names its unit once (v4 user: not "participants · 6 participants").
    ...(recipe.summary === 'none' ? [`${who}, one ${one} each`] : [band, who]),
    input.voxels !== null ? `${input.locus}, ${input.voxels.toLocaleString('en-US')} voxel${input.voxels === 1 ? '' : 's'}` : input.locus,
  ];
  if (input.transforms) parts.push(input.transforms.replace(/\.$/, ''));
  return parts.join(' · ');
}

type ClusterResult = ReturnType<typeof useClusterStore.getState>['result'];

/**
 * A cluster locus, defined once (v1 visual 6, v1 fidelity 4): "cluster 1 of
 * zmap_synthetic (|z| > 3.1, 26-connected; 398 voxels; peak z 5.97 at −39.5,
 * −19.5, 50.5 mm)". The statistic is the table layer's ("|z|"), else
 * "|value|". Null when the row is not in the table.
 */
export function clusterLocusText(result: ClusterResult | null, id: number | null): string | null {
  const cluster = result?.table.clusters.find((c) => c.id === id);
  if (!result || !cluster) return null;
  const t = result.table;
  const layers = useLayerStore.getState();
  const symbol = statisticUnits(
    layers.layers?.find?.((l) => l.id === result.layerId)?.statistic,
    layers.layerMetadata?.get?.(result.layerId)?.dataRange,
  );
  const v = symbol ? symbol.replace(/\(.*\)$/, '') : 'value';
  const u = formatLayerValue(t.threshold);
  const test = t.sign === 'both' ? `|${v}| > ${u}` : t.sign === 'positive' ? `${v} > ${u}` : `${v} < −${u}`;
  const n = cluster.voxelCount.toLocaleString('en-US');
  return `cluster ${cluster.id} of ${shortLayerLabel(result.layerName)} (${test}, ${t.connectivity}-connected; ${n} voxel${cluster.voxelCount === 1 ? '' : 's'}; peak ${v} ${trueMinus(cluster.peakValue.toFixed(2))} at ${cluster.peakMm.map((x) => formatWorldMm(x)).join(', ')} mm)`;
}
