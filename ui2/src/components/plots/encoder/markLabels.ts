import type { Mark } from '@/plotting';

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
