/**
 * How the Set studio draws a map: one rule for the computed Compare panes
 * (cohort mean, residual, z-score; StudioPaneRenderService) and for the
 * member layer the Studio shows in the Deck and Compare pane A
 * (StudioDisplayService). A member drawn by the general loader's rule and a
 * mean drawn by another could not be compared by eye.
 *
 * - Signed data: the diverging blue–white–red map, a window symmetric about
 *   zero, values within a tenth of the window of zero hidden so the anatomy
 *   shows through.
 * - Nonnegative data: the sequential Hot map from the data minimum, its
 *   lowest tenth hidden (review L2: no half of a diverging map is wasted).
 * - Anatomy: grey over its own range, nothing hidden.
 *
 * The window end is a `limit` the caller may give (a robust limit, or one
 * shared with another image); without one it is the data's own extreme.
 */

import { computePercentileFromBins } from '@/services/IntensityRangeComputer';
import {
  PlacementBand,
  placementBand,
  type PlacementLayer,
  type PlacementMetadata,
} from '@/services/layerPlacement';
import type { HistogramData } from '@/types/histogram';
import { formatReadoutValue } from '@/utils/valueFormat';

/** Share of a map's window hidden around zero (as in Population). */
export const STUDIO_HIDDEN_FRACTION = 0.1;

/**
 * The opacity of a map over the anatomy beneath it: opaque, in the computed
 * panes and for a member the rule draws. Its hidden band lets the anatomy
 * through, so no blending is needed (and a blended colour is not a value).
 */
export const STUDIO_MAP_OPACITY = 1;

export type StudioMapKind = 'diverging' | 'sequential';

/** The display fields the rule decides. */
export interface StudioMapWindow {
  colormap: string;
  intensity: [number, number];
  threshold: [number, number];
}

export interface StudioMapDisplay extends StudioMapWindow {
  kind: StudioMapKind | 'anatomy';
}

type Range = { min: number; max: number };

/** The kind of a map with this data range: signed data diverges. */
export function studioMapKind(range: Range | null | undefined, signed = false): StudioMapKind {
  return signed || (range?.min ?? -1) < 0 ? 'diverging' : 'sequential';
}

/**
 * The rule. `signed` forces the diverging form (a residual, a z-score, a
 * member of a set whose other members are signed); `limit` replaces the
 * data's own extreme as the window end; `anatomy` asks for the grey form.
 */
export function studioMapDisplay(
  range: Range | null | undefined,
  options: { signed?: boolean; limit?: number | null; anatomy?: boolean } = {},
): StudioMapDisplay {
  if (options.anatomy) {
    const min = range?.min ?? 0;
    const max = range?.max ?? 1;
    return {
      kind: 'anatomy',
      colormap: 'gray',
      intensity: [min, max > min ? max : min + 1],
      threshold: [min, min],
    };
  }
  const min = range?.min ?? -1;
  const max = range?.max ?? 1;
  const given =
    options.limit != null && Number.isFinite(options.limit) && options.limit > 0
      ? options.limit
      : null;
  if (studioMapKind(range, options.signed) === 'diverging') {
    const limit = given ?? (Math.max(Math.abs(min), Math.abs(max)) || 1);
    const band = STUDIO_HIDDEN_FRACTION * limit;
    return {
      kind: 'diverging',
      colormap: 'fmri',
      intensity: [-limit, limit],
      threshold: [-band, band],
    };
  }
  const ceiling = given ?? max;
  const top = ceiling > min ? ceiling : min + 1;
  const band = STUDIO_HIDDEN_FRACTION * (top - min);
  return {
    kind: 'sequential',
    colormap: 'hot',
    intensity: [min, top],
    threshold: [min, min + band],
  };
}

/** The window end of a display the rule made: ±limit, or the top of a sequential window. */
export function studioWindowLimit(window: Pick<StudioMapWindow, 'intensity'>): number {
  const [low, high] = window.intensity;
  return low < 0 ? Math.max(Math.abs(low), Math.abs(high)) : high;
}

/**
 * A robust window end from a histogram of the nonzero voxels: the larger
 * magnitude of the 2nd and 98th percentiles (diverging) or the 98th
 * percentile (sequential), the percentile rule Population and the loader's
 * windows use. A member's extreme voxels are noise: a window sized to them
 * leaves the map, and a group mean beside it, faint. Null when the histogram
 * says nothing.
 */
export function studioRobustLimit(
  histogram: Pick<HistogramData, 'bins' | 'totalCount'> | null | undefined,
  kind: StudioMapKind,
): number | null {
  if (!histogram || histogram.bins.length === 0 || !(histogram.totalCount > 0)) return null;
  const at = (p: number) => computePercentileFromBins(histogram.bins, histogram.totalCount, p);
  const limit = kind === 'diverging' ? Math.max(Math.abs(at(2)), Math.abs(at(98))) : at(98);
  return Number.isFinite(limit) && limit > 0 ? limit : null;
}

/** The fields of a layer the member rule reads. */
export type StudioMemberLayer = PlacementLayer & {
  timeSeriesInfo?: { num_timepoints: number } | null;
};

/**
 * A file named for an anatomical or functional modality by its last name
 * part (the BIDS suffix: sub-01_T1w.nii.gz, run-1_bold): an image drawn in
 * grey. A map derived from one (sub-01_T1w_coef.nii.gz) is not matched.
 */
const ANATOMY_NAME =
  /(^|[_\-.\s])(t1w?|t2w?|t2starw?|flair|pdw?|inplane[12]?|mp2?rage|unit1|angio|swi|ct|bold|sbref|boldref|epi|meanfunc)(\.(nii|mgz|mgh|img|hdr|gz))*$/i;

const INTEGER_DTYPE = /^(u|i|uint|int)(8|16|32|64)$/i;

/** Anatomy stored as integers (a uint8 T1, an int16 CT): whole values over a wide range. */
function isIntegerImage(meta: PlacementMetadata | undefined): boolean {
  const range = meta?.dataRange;
  if (!range || !meta?.nativeDtype || !INTEGER_DTYPE.test(meta.nativeDtype)) return false;
  return Number.isInteger(range.min) && Number.isInteger(range.max) && range.max - range.min > 64;
}

/**
 * Whether a member's layer is a map the Studio rule draws, and of which
 * kind; null for a layer that keeps the display its load gave it:
 * anatomy-like images (a template, a 4D or functional series, a file named
 * for an anatomical or functional modality, integer-stored intensities),
 * labels, masks and atlases, layers of a module-declared kind, and a layer
 * whose data range is not known.
 */
export function studioMemberKind(
  layer: StudioMemberLayer | null | undefined,
  meta: PlacementMetadata | null | undefined,
): StudioMapKind | null {
  const range = meta?.dataRange;
  if (!layer || !range) return null;
  if (!Number.isFinite(range.min) || !Number.isFinite(range.max) || !(range.max > range.min))
    return null;
  if (layer.layerKind || layer.source === 'template' || layer.source === 'atlas') return null;
  if (placementBand(layer, meta ?? undefined) === PlacementBand.Label) return null;
  if (
    layer.type === 'functional' ||
    layer.volumeType === 'TimeSeries4D' ||
    (layer.timeSeriesInfo?.num_timepoints ?? 0) >= 2
  )
    return null;
  // A declared statistic is a map whatever its file is called.
  if (!layer.statistic) {
    const file = layer.sourcePath?.split(/[\\/]/).pop() ?? '';
    if (ANATOMY_NAME.test(file) || ANATOMY_NAME.test(layer.name ?? '')) return null;
    if (isIntegerImage(meta ?? undefined)) return null;
  }
  return studioMapKind(range);
}

/** A window end for a legend or a note: three significant digits below 1, U+2212. */
export function formatStudioScaleValue(value: number): string {
  return formatReadoutValue(value);
}

/** A window as one phrase: "±0.0145" when symmetric about zero, else "−0.01 to 0.02". */
export function formatStudioWindow(intensity: readonly [number, number]): string {
  const [low, high] = intensity;
  if (low < 0 && Math.abs(low + high) <= 1e-9 * Math.max(Math.abs(low), Math.abs(high)))
    return `±${formatStudioScaleValue(high)}`;
  return `${formatStudioScaleValue(low)} to ${formatStudioScaleValue(high)}`;
}

/** Whether two displays are the same colour map, window and threshold. */
export function sameStudioWindow(
  a: Pick<StudioMapWindow, 'colormap' | 'intensity' | 'threshold'> | null | undefined,
  b: Pick<StudioMapWindow, 'colormap' | 'intensity' | 'threshold'> | null | undefined,
): boolean {
  if (!a || !b) return false;
  return (
    a.colormap === b.colormap &&
    a.intensity?.[0] === b.intensity?.[0] &&
    a.intensity?.[1] === b.intensity?.[1] &&
    a.threshold?.[0] === b.threshold?.[0] &&
    a.threshold?.[1] === b.threshold?.[1]
  );
}

