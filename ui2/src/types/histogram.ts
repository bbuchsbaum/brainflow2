/**
 * Histogram data types for volume data visualization
 */

export interface HistogramBin {
  /** Start value of the bin (inclusive) */
  x0: number;
  /** End value of the bin (exclusive) */
  x1: number;
  /** Count of values in this bin */
  count: number;
  /** Normalized count (0-1) for visualization */
  normalizedCount: number;
  /** Percentage of total values */
  percentage: number;
}

export interface HistogramData {
  /** Array of histogram bins */
  bins: HistogramBin[];
  /** Total number of values */
  totalCount: number;
  /** Minimum value in the dataset */
  minValue: number;
  /** Maximum value in the dataset */
  maxValue: number;
  /** Mean value */
  mean: number;
  /** Standard deviation */
  std: number;
  /** Number of bins */
  binCount: number;
  /** Layer ID this histogram belongs to */
  layerId: string;
  /** Exact zeros were left out of the bins and of mean/std (stated in the caption). */
  zerosExcluded?: boolean;
  /** Integer-valued data (label maps): integer x ticks. */
  integerValued?: boolean;
}

/**
 * Tick values and their labels for a histogram x axis: no repeated labels
 * (a 0..3 label map used to read "0 0 0 1 1 1 …"). Integer-valued data
 * (label maps) gets integer ticks only; otherwise labels carry as many
 * decimals as the tick step needs.
 */
export function histogramAxisTicks(
  ticks: number[],
  integerData: boolean,
): { values: number[]; format: (v: number) => string } {
  const values = integerData
    ? Array.from(new Set(ticks.filter((t) => Number.isInteger(t))))
    : ticks;
  const step = values.length > 1 ? Math.abs(values[1] - values[0]) : 1;
  const decimals = integerData || step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step)));
  return { values, format: (v: number) => v.toFixed(decimals).replace('-', '\u2212') };
}

export interface HistogramRequest {
  /** Layer ID to compute histogram for */
  layerId: string;
  /** Number of bins (default: 256) */
  binCount?: number;
  /** Optional value range to use for binning */
  range?: [number, number];
  /** Whether to exclude zero values */
  excludeZeros?: boolean;
}

export interface HistogramChartProps {
  /** Histogram data to display */
  data: HistogramData | null;
  /** Width of the chart */
  width: number;
  /** Height of the chart */
  height: number;
  /** Current intensity window */
  intensityWindow?: [number, number];
  /** Current threshold values */
  threshold?: [number, number];
  /** Colormap name for gradient */
  colormap?: string;
  /** Whether to show axes */
  showAxes?: boolean;
  /** Whether to show tooltips on hover */
  showTooltips?: boolean;
  /** Whether to use log scale for Y axis */
  useLogScale?: boolean;
  /** Callback when intensity window is changed by dragging */
  onIntensityChange?: (window: [number, number]) => void;
  /** Callback when threshold is changed by dragging */
  onThresholdChange?: (threshold: [number, number]) => void;
  /** Callback when log scale is toggled */
  onLogScaleChange?: (useLogScale: boolean) => void;
  /** Loading state */
  loading?: boolean;
  /** Error state */
  error?: Error | null;
}

export interface HistogramTooltipData {
  bin: HistogramBin;
  x: number;
  y: number;
}