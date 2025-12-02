import { DisplayLayer } from '../types/displayLayer';

/**
 * Helpers to translate shared DisplayLayer DTOs into neurosurface layer configs.
 * These are pure converters; actual application to a viewer/surface happens elsewhere.
 */
export type NeurosurfaceLayerConfig =
  | { type: 'base'; id: string; color?: number; opacity?: number; visible?: boolean; order?: number }
  | { type: 'data'; id: string; data: Float32Array | number[]; indices?: Uint32Array | number[]; colorMap?: any; range?: [number, number]; threshold?: [number, number]; opacity?: number; blendMode?: string; visible?: boolean; order?: number }
  | { type: 'rgba'; id: string; data: Float32Array | number[]; opacity?: number; blendMode?: string; visible?: boolean; order?: number }
  | { type: 'label'; id: string; labels: Uint32Array | Int32Array | number[]; labelDefs: Array<{ id: number; color: number; name?: string }>; defaultColor?: number; opacity?: number; visible?: boolean; order?: number }
  | { type: 'outline'; id: string; roiLabels: Uint32Array | Int32Array | number[]; color?: number; opacity?: number; width?: number; halo?: boolean; haloColor?: number; haloWidth?: number; offset?: number; roiSubset?: number[] | null; visible?: boolean; blendMode?: string; order?: number };

const toHex = (value: string | number | undefined): number | undefined => {
  if (value === undefined) return undefined;
  if (typeof value === 'number') return value;
  // strip leading '#' if present
  const trimmed = value.replace('#', '');
  const parsed = parseInt(trimmed, 16);
  return Number.isNaN(parsed) ? undefined : parsed;
};

/**
 * Convert a DisplayLayer into one or more neurosurface layer configs.
 * Label layers can optionally emit an outline layer if outline=true.
 */
export function toNeurosurfaceLayers(layer: DisplayLayer): NeurosurfaceLayerConfig[] {
  switch (layer.type) {
    case 'scalar': {
      return [
        {
          type: 'data',
          id: layer.id,
          data: [], // to be provided by caller
          colorMap: layer.colormap,
          range: layer.intensity,
          threshold: layer.threshold,
          opacity: layer.opacity,
          blendMode: layer.blendMode,
          visible: layer.visible,
          order: layer.order,
        },
      ];
    }
    case 'rgba': {
      return [
        {
          type: 'rgba',
          id: layer.id,
          data: layer.rgbaData || [],
          opacity: layer.opacity,
          blendMode: layer.blendMode,
          visible: layer.visible,
          order: layer.order,
        },
      ];
    }
    case 'label': {
      const labelLayer: NeurosurfaceLayerConfig = {
        type: 'label',
        id: layer.id,
        labels: layer.labels || [],
        labelDefs: (layer.labelDefs || []).map((d) => ({
          id: d.id,
          color: toHex(d.color) ?? 0xffffff,
          name: d.name,
        })),
        defaultColor: toHex(layer.defaultLabelColor),
        opacity: layer.opacity,
        visible: layer.visible,
        order: layer.order,
      };

      const outlineLayers: NeurosurfaceLayerConfig[] =
        layer.outline || layer.halo
          ? [
              {
                type: 'outline',
                id: `${layer.id}-outline`,
                roiLabels: layer.roiLabels || layer.labels || [],
                color: toHex(layer.outlineColor) ?? toHex(layer.defaultLabelColor),
                width: layer.outlineWidth,
                halo: layer.halo,
                haloColor: toHex(layer.haloColor),
                haloWidth: layer.haloWidth,
                roiSubset: layer.roiSubset ?? null,
                opacity: layer.opacity,
                blendMode: layer.blendMode,
                visible: layer.visible,
                order: layer.order !== undefined ? layer.order + 0.01 : undefined,
              },
            ]
          : [];

      return [labelLayer, ...outlineLayers];
    }
    case 'outline': {
      return [
        {
          type: 'outline',
          id: layer.id,
          roiLabels: layer.roiLabels || layer.labels || [],
          color: toHex(layer.outlineColor),
          width: layer.outlineWidth,
          halo: layer.halo,
          haloColor: toHex(layer.haloColor),
          haloWidth: layer.haloWidth,
          roiSubset: layer.roiSubset ?? null,
          opacity: layer.opacity,
          blendMode: layer.blendMode,
          visible: layer.visible,
          order: layer.order,
        },
      ];
    }
    default:
      return [];
  }
}
