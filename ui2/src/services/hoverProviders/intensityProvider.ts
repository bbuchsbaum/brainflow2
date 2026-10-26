/**
 * Intensity Provider
 *
 * Provides voxel intensity value at the hover location.
 */

import type { HoverInfoProvider, HoverInfoEntry, HoverContext } from '@/types/hoverInfo';
import { sampleLayerAtWorld } from '../SamplingService';
import { useLayerStore } from '@/stores/layerStore';
import { formatLayerValue } from '@/utils/valueFormat';
import { formatStatisticValue } from '@/utils/statistic';
import { shortLayerLabel } from '@/components/views/viewportFrame/frameFormat';

export const intensityProvider: HoverInfoProvider = {
  id: 'intensity',
  displayName: 'Intensity',
  priority: 20, // Show after coordinates

  async getInfo(ctx: HoverContext): Promise<HoverInfoEntry[] | null> {
    // The opted-in layers ("Show value on hover"), else the view's primary.
    const ids = ctx.layerIds && ctx.layerIds.length > 0 ? ctx.layerIds : ctx.activeLayerId ? [ctx.activeLayerId] : [];
    if (ids.length === 0) {
      return null;
    }
    const { layers, layerMetadata } = useLayerStore.getState();
    const entries = await Promise.all(
      ids.map(async (layerId, index): Promise<HoverInfoEntry | null> => {
        const result = await sampleLayerAtWorld({ layerId, world: ctx.worldCoord });
        if (result.value === null) return null;
        // Name the sampled layer and format like the status bar: precision
        // from the value's scale, U+2212 minus, statistic symbol first.
        const layer = layers.find((l) => l.id === layerId);
        const dataRange = layerMetadata.get(layerId)?.dataRange;
        return {
          label: layer?.name ? shortLayerLabel(layer.name) : 'Value',
          value: formatStatisticValue(formatLayerValue(result.value), layer?.statistic, dataRange),
          priority: 20 + index / 100,
          group: 'intensity',
        };
      }),
    );
    const found = entries.filter((e): e is HoverInfoEntry => e !== null);
    return found.length > 0 ? found : null;
  },
};
