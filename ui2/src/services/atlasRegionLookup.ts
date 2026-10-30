/**
 * Atlas region lookup.
 *
 * Resolves the parcellation region under a world coordinate by sampling the
 * active atlas (label) layer and looking the sampled label id up in the layer's
 * cached palette legend (`LayerInfo.atlasPaletteLegend`, populated by
 * {@link AtlasPaletteService}). Shared by the crosshair-driven status-bar
 * readout and any hover-based consumer.
 */

import { useLayerStore, type LayerInfo } from "@/stores/layerStore";
import { sampleLayerAtWorld } from "./SamplingService";
import type { AtlasPaletteLegendEntry } from "@/types/atlasPalette";

export interface AtlasRegionHit {
  layerId: string;
  labelId: number;
  entry: AtlasPaletteLegendEntry;
}

/**
 * The atlas layer that names regions. `preferredLayerId` — the layer the
 * status bar's Layer/Value slots report — wins when it is itself a region
 * source, so Region never names a parcel from a different atlas than the
 * Value beside it. Otherwise the first label layer that carries atlas
 * metadata, mirroring the `activeAtlasId` heuristic used in the slice views.
 */
export function findActiveAtlasLayer(preferredLayerId?: string | null): LayerInfo | undefined {
  const layers = useLayerStore.getState().layers;
  if (preferredLayerId) {
    const preferred = layers.find((l) => l.id === preferredLayerId);
    if (preferred && isRegionSource(preferred)) return preferred;
  }
  return layers.find(isRegionSource) as LayerInfo | undefined;
}

/**
 * A layer that can name the region at a point: catalogue atlases carry
 * `atlasMetadata`; user-loaded label volumes with a label table carry only a
 * legend (LabelTableService).
 */
export function isRegionSource(l: Pick<LayerInfo, "type" | "atlasMetadata" | "atlasPaletteLegend">): boolean {
  return l.type === "label" && (!!l.atlasMetadata || (l.atlasPaletteLegend?.length ?? 0) > 0);
}

/** True when some layer can name regions (the status Region slot shows then). */
export function hasRegionSource(
  layers: ReadonlyArray<Pick<LayerInfo, "type" | "atlasMetadata" | "atlasPaletteLegend">>,
): boolean {
  return layers.some(isRegionSource);
}

/**
 * Resolve the atlas region at a world coordinate.
 *
 * Samples the parcellation's label value (nearest-voxel, so an exact integer
 * label id), rounds it, and looks it up in the layer legend. Returns null for
 * background (label 0), an unmapped id, a layer without a legend, or no atlas.
 */
export async function resolveAtlasRegionAtWorld(
  world: [number, number, number],
  preferredLayerId?: string | null,
): Promise<AtlasRegionHit | null> {
  const layer = findActiveAtlasLayer(preferredLayerId);
  const legend = layer?.atlasPaletteLegend;
  if (!layer || !legend || legend.length === 0) {
    return null;
  }

  const sample = await sampleLayerAtWorld({ layerId: layer.id, world });
  if (sample.value === null || !Number.isFinite(sample.value)) {
    return null;
  }

  const labelId = Math.round(sample.value);
  if (labelId <= 0) {
    return null; // background / outside any parcel
  }

  const entry = legend.find((e) => e.label_id === labelId);
  if (!entry) {
    return null;
  }
  return { layerId: layer.id, labelId, entry };
}

/**
 * Compact, human-readable region label for the status bar, e.g.
 * "LH VisCent ExStr 1". Underscores in the ROI name become spaces; the
 * hemisphere is prefixed as LH/RH when known. User-supplied label tables set
 * `displayName`, which is shown verbatim.
 */
export function formatRegionLabel(entry: AtlasPaletteLegendEntry): string {
  if (entry.displayName) return entry.displayName;
  const hemi =
    entry.hemisphere === "left"
      ? "LH"
      : entry.hemisphere === "right"
        ? "RH"
        : "";
  const name = entry.roi.replace(/_/g, " ");
  return [hemi, name].filter(Boolean).join(" ");
}
