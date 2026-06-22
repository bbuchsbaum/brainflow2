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
 * The active atlas layer: the first visible-or-not label layer that carries
 * atlas metadata. Mirrors the `activeAtlasId` heuristic used in the slice views.
 */
export function findActiveAtlasLayer(): LayerInfo | undefined {
  return useLayerStore
    .getState()
    .layers.find(
      (l) => l.type === "label" && (l as LayerInfo).atlasMetadata,
    ) as LayerInfo | undefined;
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
): Promise<AtlasRegionHit | null> {
  const layer = findActiveAtlasLayer();
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
 * hemisphere is prefixed as LH/RH when known.
 */
export function formatRegionLabel(entry: AtlasPaletteLegendEntry): string {
  const hemi =
    entry.hemisphere === "left"
      ? "LH"
      : entry.hemisphere === "right"
        ? "RH"
        : "";
  const name = entry.roi.replace(/_/g, " ");
  return [hemi, name].filter(Boolean).join(" ");
}
