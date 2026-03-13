import type { VolumeMetadata } from '@/stores/layerStore';

export function formatVolumeDimensions(metadata: VolumeMetadata): string {
  if (!metadata.dimensions) {
    return 'Unknown';
  }
  return metadata.dimensions.join(' × ');
}

export function formatVolumeSpacing(metadata: VolumeMetadata): string {
  if (!metadata.spacing) {
    return 'Unknown';
  }
  return metadata.spacing.map((spacing) => `${spacing.toFixed(2)} mm`).join(' × ');
}

export function formatVolumeDataRange(metadata: VolumeMetadata): string {
  if (!metadata.dataRange) {
    return 'Unknown';
  }
  return `[${metadata.dataRange.min.toFixed(2)}, ${metadata.dataRange.max.toFixed(2)}]`;
}

export function formatVolumeVoxelSummary(metadata: VolumeMetadata): string | null {
  if (!metadata.totalVoxels) {
    return null;
  }

  const millions = (metadata.totalVoxels / 1_000_000).toFixed(1);

  if (!metadata.nonZeroVoxels) {
    return `${millions}M voxels`;
  }

  const percentage = ((metadata.nonZeroVoxels / metadata.totalVoxels) * 100).toFixed(1);
  return `${millions}M voxels (${percentage}% non-zero)`;
}
