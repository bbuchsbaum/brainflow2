/**
 * The population recipe a set series is drawn with (phase 4 E5): x = the
 * series axis, one line per condition, participants as the line identity,
 * repeated rows at one position averaged within participant, then the
 * population stage (centre and band) and the declared transforms.
 */
import {
  INTERVAL_PRESETS,
  NO_INTERVAL,
  centreBandPhrase,
  computedInterval,
  type IntervalChoice,
} from '@/plotting/intervals';
import { bandForCentre, type PopulationPlotRecipe } from '@/services/studio/populationPlot';
import type { SeriesSettings } from '@/stores/seriesStore';
import { SERIES_X, type SetSeriesBinding } from './seriesBinding';

/** The series toolbar's bands per centre, in menu order. */
export const SERIES_MEAN_BANDS: readonly IntervalChoice[] = [
  INTERVAL_PRESETS.ciT95,
  INTERVAL_PRESETS.ciNormal95,
  INTERVAL_PRESETS.sd,
  INTERVAL_PRESETS.none,
];
export const SERIES_MEDIAN_BANDS: readonly IntervalChoice[] = [INTERVAL_PRESETS.iqr, INTERVAL_PRESETS.none];

export function seriesRecipe(binding: SetSeriesBinding, settings: SeriesSettings): PopulationPlotRecipe {
  const collapsed = settings.transforms.some((t) => t.kind === 'windowMean');
  const summary = settings.display === 'summary';
  return {
    version: 2,
    x: SERIES_X,
    axis: binding.kind === 'time' && binding.unit ? 'time' : 'number',
    axisUnit: binding.unit ?? '',
    color: binding.conditionColumn,
    // Runs (E5b): one panel per run on a shared y axis, else pooled within participant.
    facet: settings.datasetRunsFaceted && binding.segmentColumn ? binding.segmentColumn : null,
    detail: binding.subjectColumn,
    mark: collapsed ? 'point' : 'line',
    summary: summary ? settings.summary : 'none',
    band: summary ? computedInterval(bandForCentre(settings.band, settings.summary)) : NO_INTERVAL,
    repeatRows: 'mean',
    transforms: settings.transforms,
  };
}

/** "Lag (TR)" / "Time (s)" / "Lag". */
export function seriesAxisTitle(binding: SetSeriesBinding): string {
  const name = binding.kind === 'lag' ? 'Lag' : 'Time';
  return binding.unit ? `${name} (${binding.unit})` : name;
}

/** "mean ± 95% CI (t)", "median, IQR" and the like. */
export function bandDescription(recipe: PopulationPlotRecipe): string {
  if (recipe.summary === 'none') return 'participants';
  return centreBandPhrase(recipe.summary, recipe.band);
}
