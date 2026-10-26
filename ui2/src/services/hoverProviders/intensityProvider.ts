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

    // Name the sampled layer (the readout is one layer's value, not every
    // visible layer's), and format like the status bar: precision from the
    // value's scale, U+2212 minus, statistic symbol first ("z 5.97").
    const { layers, layerMetadata } = useLayerStore.getState();
    const layer = layers.find((l) => l.id === ctx.activeLayerId);
    const dataRange = layerMetadata.get(ctx.activeLayerId)?.dataRange;
    return [
      {
        label: layer?.name ? shortLayerLabel(layer.name) : 'Value',
        value: formatStatisticValue(formatLayerValue(result.value), layer?.statistic, dataRange),
        priority: 20,
        group: 'intensity',
      },
    ];
  },
};
