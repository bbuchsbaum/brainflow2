/**
 * Atlas Provider
 *
 * Provides atlas region information at the hover location.
 * This is a placeholder that will be connected to the backend
 * atlas region lookup once that API is implemented.
 */

import type { HoverInfoProvider, HoverInfoEntry, HoverContext } from '@/types/hoverInfo';

// TODO: Import atlas query function once backend API is implemented
// import { queryAtlasRegion } from '../AtlasService';

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
 * Query atlas region at world coordinates.
 * This is a stub that will be replaced with actual backend call.
 */
async function queryAtlasRegion(
  _atlasId: string,
  _worldCoord: [number, number, number]
): Promise<AtlasRegionInfo | null> {
  // TODO: Implement backend call
  // return await invoke('plugin:api-bridge|query_atlas_region', {
  //   atlasId,
  //   worldCoord,
  // });
  return null;
}

export const atlasProvider: HoverInfoProvider = {
  id: 'atlas',
  displayName: 'Atlas Region',
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
      label: 'Region',
      value: region.name,
      priority: 30,
      group: 'atlas',
    });

    // Network if present
    if (region.network) {
      entries.push({
        label: 'Network',
        value: region.network,
        priority: 31,
        group: 'atlas',
      });
    }

    // Hemisphere if present
    if (region.hemisphere) {
      entries.push({
        label: 'Hemisphere',
        value: region.hemisphere,
        priority: 32,
        group: 'atlas',
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
          group: 'atlas',
        });
      }
    }

    return entries;
  },
};
