import type { LayerInfo } from '@/stores/layerStore';

export function isTemporalHeatmapEligible(
  layer: Pick<LayerInfo, 'volumeId' | 'volumeType' | 'timeSeriesInfo'> | null | undefined
): boolean {
  if (!layer?.volumeId) {
    return false;
  }

  return (
    layer.volumeType === 'TimeSeries4D' ||
    (layer.timeSeriesInfo?.num_timepoints ?? 0) > 1
  );
}
