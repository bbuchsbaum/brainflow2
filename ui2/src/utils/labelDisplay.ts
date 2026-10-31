/**
 * How a label layer is drawn (UI redesign phase 3, v1 critics): its regions
 * filled with their table colours, outlined, or both.
 *
 * The renderer draws one outline per frame (`slice_features`) for one label
 * layer: every region boundary when no label is selected, else the selected
 * region. Boundaries take each region's table colour ("lut") or one colour,
 * with an optional dark halo. "Outline" without a fill is drawn by
 * sending the layer with a near-zero fill opacity (the renderer skips layers
 * at opacity 0, and its outline pass only runs for a drawn layer); the
 * outline keeps the layer's opacity as its own alpha.
 */
import type { LayerOutlineConfig, ViewLayer } from '@/types/viewState';

export type LabelDisplay = 'fill' | 'outline' | 'both';

/** Lowest alpha of an outline-only label layer that is shown at all (review M4). */
export const OUTLINE_ALPHA_FLOOR = 0.7;

/**
 * Outline alpha for a layer opacity: 0 when the layer is at 0, else from
 * {@link OUTLINE_ALPHA_FLOOR} at the lowest opacity up to 1. The opacity
 * slider still changes it, but never below legible.
 */
export function outlineAlpha(opacity: number): number {
  if (!(opacity > 0)) return 0;
  const o = Math.min(1, opacity);
  return OUTLINE_ALPHA_FLOOR + (1 - OUTLINE_ALPHA_FLOOR) * o;
}

/** Fill opacity sent for "outline only": invisible (< half an 8-bit step), but drawn. */
export const OUTLINE_ONLY_FILL_OPACITY = 1e-3;

/**
 * Single outline colour, used when the colour mode is "uniform": a light
 * neutral that reads over both ends of a diverging statistic colormap.
 */
export const DEFAULT_LABEL_OUTLINE_COLOR: [number, number, number, number] = [0.92, 0.93, 0.94, 1];

/** Dark halo that separates region colours from a statistic map underneath. */
export const DEFAULT_LABEL_HALO_COLOR: [number, number, number, number] = [0, 0, 0, 0.6];

/**
 * Default outline (phase 4, user-approved): each region in its table colour
 * with a 1 px dark halo, so labels drawn above a statistic stay identifiable
 * without recolouring it. Fill remains the default display when a label layer
 * is alone (LabelTableService.applyLabelDisplayDefault).
 */
export const DEFAULT_LABEL_OUTLINE: LayerOutlineConfig = {
  enabled: false,
  selectedLabelId: 0,
  color: DEFAULT_LABEL_OUTLINE_COLOR,
  // 2 px: a 1 px boundary was too faint over a statistic map (v1 critics).
  thicknessPx: 2,
  colorMode: 'lut',
  haloPx: 1,
  haloColor: DEFAULT_LABEL_HALO_COLOR,
};

/**
 * Atlases with more regions than this default to one neutral 1 px line
 * without a halo (QA run 4, N17): 360 Glasser parcels each outlined in their
 * own LUT colour read as noise. Small atlases (e.g. ASEG) keep LUT colours.
 */
export const DENSE_ATLAS_REGION_THRESHOLD = 50;

export const DENSE_LABEL_OUTLINE: LayerOutlineConfig = {
  ...DEFAULT_LABEL_OUTLINE,
  thicknessPx: 1,
  colorMode: 'uniform',
  color: [DEFAULT_LABEL_OUTLINE_COLOR[0], DEFAULT_LABEL_OUTLINE_COLOR[1], DEFAULT_LABEL_OUTLINE_COLOR[2], 0.85],
  haloPx: 0,
};

/** Default outline for a label layer with `regionCount` regions (unknown: the small-atlas default). */
export function defaultLabelOutline(regionCount: number | undefined): LayerOutlineConfig {
  return (regionCount ?? 0) > DENSE_ATLAS_REGION_THRESHOLD ? DENSE_LABEL_OUTLINE : DEFAULT_LABEL_OUTLINE;
}

type LabelLike = Pick<ViewLayer, 'layerMode' | 'labelDisplay' | 'outline' | 'opacity'>;

/** The layer's display mode; non-label layers are always "fill". */
export function labelDisplayOf(layer: LabelLike): LabelDisplay {
  if (layer.layerMode !== 'label') return 'fill';
  return layer.labelDisplay ?? (layer.outline?.enabled ? 'both' : 'fill');
}

/** Opacity and outline to send to the renderer for a layer. */
export function labelRenderFields(layer: LabelLike): {
  opacity: number;
  outline: LayerOutlineConfig | undefined;
} {
  if (layer.layerMode !== 'label') return { opacity: layer.opacity, outline: layer.outline };
  const display = labelDisplayOf(layer);
  const base = layer.outline ?? DEFAULT_LABEL_OUTLINE;
  if (display === 'fill') {
    return { opacity: layer.opacity, outline: layer.outline ? { ...base, enabled: false } : undefined };
  }
  if (display === 'both') return { opacity: layer.opacity, outline: { ...base, enabled: true } };
  // Outline only: the layer's opacity scales the outline's (and halo's)
  // alpha above a floor, so the low fill opacity a label opens with over a
  // statistic or anatomy (0.25 / 0.35) never leaves a faint outline.
  const alpha = outlineAlpha(layer.opacity);
  const halo = base.haloColor;
  return {
    opacity: layer.opacity > 0 ? OUTLINE_ONLY_FILL_OPACITY : 0,
    outline: {
      ...base,
      enabled: true,
      color: [base.color[0], base.color[1], base.color[2], base.color[3] * alpha],
      ...(halo ? { haloColor: [halo[0], halo[1], halo[2], halo[3] * alpha] } : {}),
    },
  };
}
