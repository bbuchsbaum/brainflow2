/**
 * How a label layer is drawn (UI redesign phase 3, v1 critics): its regions
 * filled with their table colours, outlined, or both.
 *
 * The renderer draws one outline per frame (`slice_features`), in a single
 * colour, for one label layer: every region boundary when no label is
 * selected, else the selected region. "Outline" without a fill is drawn by
 * sending the layer with a near-zero fill opacity (the renderer skips layers
 * at opacity 0, and its outline pass only runs for a drawn layer); the
 * outline keeps the layer's opacity as its own alpha.
 */
import type { LayerOutlineConfig, ViewLayer } from '@/types/viewState';

export type LabelDisplay = 'fill' | 'outline' | 'both';

/** Fill opacity sent for "outline only": invisible (< half an 8-bit step), but drawn. */
export const OUTLINE_ONLY_FILL_OPACITY = 1e-3;

/**
 * Default outline colour for region boundaries: a light neutral that reads
 * over both ends of a diverging statistic colormap. (Per-region LUT colours
 * need the shader to read the label's LUT texel; see the P3 report.)
 */
export const DEFAULT_LABEL_OUTLINE_COLOR: [number, number, number, number] = [0.92, 0.93, 0.94, 1];

export const DEFAULT_LABEL_OUTLINE: LayerOutlineConfig = {
  enabled: false,
  selectedLabelId: 0,
  color: DEFAULT_LABEL_OUTLINE_COLOR,
  // 2 px: a 1 px boundary was too faint over a statistic map (v1 critics).
  thicknessPx: 2,
};

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
  // Outline only: the layer's opacity becomes the outline's alpha.
  return {
    opacity: layer.opacity > 0 ? OUTLINE_ONLY_FILL_OPACITY : 0,
    outline: {
      ...base,
      enabled: true,
      color: [base.color[0], base.color[1], base.color[2], base.color[3] * layer.opacity],
    },
  };
}
