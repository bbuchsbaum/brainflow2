import type { Mark } from '@/plotting';
import type { PopulationPlotRecipe } from '@/services/studio/populationPlot';

/** User-facing names of the plot marks (encoding caption and Mark select). */
export const MARK_LABELS: Record<Mark, string> = {
  line: 'Line',
  area: 'Area',
  point: 'Points',
  bar: 'Bars',
  hist: 'Histogram',
  box: 'Box',
  violin: 'Violin',
  heatmap: 'Heatmap',
};

/** "band: 95% CI" (or null when no band is drawn). */
export function bandLegendText(
  recipe: Pick<PopulationPlotRecipe, 'summary' | 'band'>,
): string | null {
  if (recipe.summary === 'none') return null;
  const name = { none: null, sd: '± SD', sem95: '± 1.96 SE', ci95: '95% CI', iqr: 'IQR' }[
    recipe.band
  ];
  return name ? `band: ${name}` : null;
}
