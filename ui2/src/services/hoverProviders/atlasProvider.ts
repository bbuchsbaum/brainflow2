/**
 * Atlas Provider
 *
 * Provides atlas region information at the hover location.
 * This is a placeholder that will be connected to the backend
 * atlas region lookup once that API is implemented.
 */

import type {
  HoverInfoProvider,
  HoverInfoEntry,
  HoverContext,
} from "@/types/hoverInfo";
import { useLayerStore, type LayerInfo } from "@/stores/layerStore";
import { sampleLayerAtWorld } from "../SamplingService";

export interface AtlasRegionInfo {
  /** Primary region name (e.g., "IPS-01") */
  name: string;
  /** Region index/label value */
  index?: number;
  /** Network name if applicable (e.g., "Fronto-Parietal") */
  network?: string;
  /** Hemisphere (e.g., "L", "R") */
  hemisphere?: string;
  /** Any additional labels/attributes */
  attributes?: Record<string, string>;
}

/**
 * Resolve the atlas region under the cursor.
 *
 * Samples the parcellation's label value at the world position, rounds it to a
 * label id, and looks up the region in the layer's cached palette legend
 * (populated by {@link AtlasPaletteService} when the palette is applied). Returns
 * null for background (label 0), an unmapped id, or a layer without a legend.
 */
async function queryAtlasRegion(
  atlasId: string,
  worldCoord: [number, number, number],
): Promise<AtlasRegionInfo | null> {
  const sample = await sampleLayerAtWorld({
    layerId: atlasId,
    world: worldCoord,
  });
  if (sample.value === null || !Number.isFinite(sample.value)) {
    return null;
  }

  const labelId = Math.round(sample.value);
  if (labelId <= 0) {
    return null; // background / outside any parcel
  }

  const layer = useLayerStore.getState().getLayer(atlasId) as
    | LayerInfo
    | undefined;
  const legend = layer?.atlasPaletteLegend;
  if (!legend || legend.length === 0) {
    return null;
  }

  const entry = legend.find((e) => e.label_id === labelId);
  if (!entry) {
    return null;
  }

  return {
    name: entry.roi,
    index: entry.label_id,
    network: entry.network ?? undefined,
    hemisphere: entry.hemisphere ?? undefined,
  };
}

export const atlasProvider: HoverInfoProvider = {
  id: "atlas",
  displayName: "Atlas Region",
  priority: 30, // Show after intensity

  async getInfo(ctx: HoverContext): Promise<HoverInfoEntry[] | null> {
    // Need an active atlas to query
    if (!ctx.activeAtlasId) {
      return null;
    }

    const region = await queryAtlasRegion(ctx.activeAtlasId, ctx.worldCoord);

    if (!region) {
      return null;
    }

    const entries: HoverInfoEntry[] = [];

    // Primary region name
    entries.push({
      label: "Region",
      value: region.name,
      priority: 30,
      group: "atlas",
    });

    // Network if present
    if (region.network) {
      entries.push({
        label: "Network",
        value: region.network,
        priority: 31,
        group: "atlas",
      });
    }

    // Hemisphere if present
    if (region.hemisphere) {
      entries.push({
        label: "Hemisphere",
        value: region.hemisphere,
        priority: 32,
        group: "atlas",
      });
    }

    // Any additional attributes
    if (region.attributes) {
      let priorityOffset = 33;
      for (const [key, value] of Object.entries(region.attributes)) {
        entries.push({
          label: key,
          value: value,
          priority: priorityOffset++,
          group: "atlas",
        });
      }
    }

    return entries;
  },
};
