import type { LayerInfo, VolumeMetadata } from '@/stores/layerStore';
import { transformWorldToVoxelColumnMajor } from '@/utils/voxelTransform';

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

export function computeTemporalHeatmapSliceIndex(
  metadata: Pick<VolumeMetadata, 'dimensions' | 'worldToVoxel'> | undefined,
  worldMm: [number, number, number],
  axisIndex: 0 | 1 | 2
): number {
  const dims = metadata?.dimensions;
  if (!dims) {
    return 0;
  }

  let voxelCoord = worldMm;
  if (metadata.worldToVoxel) {
    voxelCoord = transformWorldToVoxelColumnMajor(metadata.worldToVoxel, worldMm);
  }

  const maxIndex = Math.max(0, dims[axisIndex] - 1);
  return Math.max(0, Math.min(maxIndex, Math.round(voxelCoord[axisIndex])));
}
