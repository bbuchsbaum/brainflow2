/**
 * The population recipe a set series is drawn with (phase 4 E5): x = the
 * series axis, one line per condition, participants as the line identity,
 * repeated rows at one position averaged within participant, then the
 * population stage (centre and band) and the declared transforms.
 */
import type { PopulationPlotRecipe } from '@/services/studio/populationPlot';
import type { SeriesSettings } from '@/stores/seriesStore';
import { SERIES_X, type SetSeriesBinding } from './seriesBinding';

export function seriesRecipe(binding: SetSeriesBinding, settings: SeriesSettings): PopulationPlotRecipe {
  const collapsed = settings.transforms.some((t) => t.kind === 'windowMean');
  const summary = settings.display === 'summary';
  return {
    version: 1,
    x: SERIES_X,
    axis: binding.kind === 'time' && binding.unit ? 'time' : 'number',
    axisUnit: binding.unit ?? '',
    color: binding.conditionColumn,
    facet: null,
    detail: binding.subjectColumn,
    mark: collapsed ? 'point' : 'line',
    summary: summary ? settings.summary : 'none',
    band: summary ? (settings.summary === 'median' ? (settings.band === 'none' ? 'none' : 'iqr') : settings.band === 'iqr' ? 'ci95' : settings.band) : 'none',
    within: 'mean',
    transforms: settings.transforms,
  };
}

/** "Lag (TR)" / "Time (s)" / "Lag". */
export function seriesAxisTitle(binding: SetSeriesBinding): string {
  const name = binding.kind === 'lag' ? 'Lag' : 'Time';
  return binding.unit ? `${name} (${binding.unit})` : name;
}

/** "mean ± 95% CI (t)" and the like. */
export function bandDescription(recipe: PopulationPlotRecipe): string {
  if (recipe.summary === 'none') return 'participants';
  const centre = recipe.summary === 'median' ? 'median' : 'mean';
  const band = {
    none: '',
    sd: ' ± SD',
    sem95: ' ± 1.96 SE',
    ci95: ' ± 95% CI (t)',
    iqr: ', IQR',
  }[recipe.band];
  return `${centre}${band}`;
}
