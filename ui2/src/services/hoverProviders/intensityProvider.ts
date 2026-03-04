/**
 * Intensity Provider
 *
 * Provides voxel intensity value at the hover location.
 */

import type { HoverInfoProvider, HoverInfoEntry, HoverContext } from '@/types/hoverInfo';
import { sampleLayerAtWorld } from '../SamplingService';

export const intensityProvider: HoverInfoProvider = {
  id: 'intensity',
  displayName: 'Intensity',
  priority: 20, // Show after coordinates

  async getInfo(ctx: HoverContext): Promise<HoverInfoEntry[] | null> {
    // Need an active layer to sample
    if (!ctx.activeLayerId) {
      return null;
    }

    const result = await sampleLayerAtWorld({
      layerId: ctx.activeLayerId,
      world: ctx.worldCoord,
    });

    if (result.value === null) {
      return null;
    }

    return [
      {
        label: 'Value',
        value: result.value.toFixed(3),
        priority: 20,
        group: 'intensity',
      },
    ];
  },
};
